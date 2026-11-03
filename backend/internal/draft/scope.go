package draft

import (
	"context"
	"database/sql"
	"errors"
	"github.com/google/uuid"
	"strings"
)

// ChapterScope is server constructed; it is never accepted from a draft body.
// A nil scope retains the original middle-form API, including its mutation hash.
type ChapterScope struct{ NovelID, ChapterID uuid.UUID }

func (s Store) validScope() bool {
	return s.Chapter == nil || (s.Chapter.NovelID != uuid.Nil)
}
func (s Store) scoped(query, alias string, args ...any) (string, []any) {
	if alias != "" {
		alias += "."
	}
	if s.Chapter == nil {
		return query, args
	}
	query += " AND " + alias + "novel_id=?"
	args = append(args, s.Chapter.NovelID[:])
	if s.Chapter.ChapterID != uuid.Nil {
		query += " AND " + alias + "chapter_id=?"
		args = append(args, s.Chapter.ChapterID[:])
	}
	return s.query(query), args
}
func (s Store) parent(ctx context.Context, owner uuid.UUID) error {
	if s.Chapter == nil {
		return nil
	}
	if !s.validScope() {
		return ErrInvalid
	}
	var id []byte
	if s.Chapter.ChapterID == uuid.Nil {
		err := s.DB.QueryRowContext(ctx, "SELECT id FROM novels WHERE id=? AND owner_id=?", s.Chapter.NovelID[:], owner[:]).Scan(&id)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	err := s.DB.QueryRowContext(ctx, "SELECT c.id FROM novel_chapters c JOIN novels n ON n.id=c.novel_id AND n.owner_id=c.owner_id WHERE c.id=? AND c.novel_id=? AND c.owner_id=?", s.Chapter.ChapterID[:], s.Chapter.NovelID[:], owner[:]).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
func (s Store) lockChapter(ctx context.Context, tx *sql.Tx, owner uuid.UUID, create bool) ([]byte, error) {
	if s.Chapter == nil {
		return nil, nil
	}
	var id []byte
	err := tx.QueryRowContext(ctx, "SELECT id FROM novels WHERE id=? AND owner_id=? FOR UPDATE", s.Chapter.NovelID[:], owner[:]).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	var book, author, primary []byte
	err = tx.QueryRowContext(ctx, "SELECT novel_id,owner_id,primary_draft_id FROM novel_chapters WHERE id=? FOR UPDATE", s.Chapter.ChapterID[:]).Scan(&book, &author, &primary)
	if errors.Is(err, sql.ErrNoRows) {
		if !create {
			return nil, ErrNotFound
		}
		_, err = tx.ExecContext(ctx, "INSERT INTO novel_chapters(id,novel_id,owner_id) VALUES(?,?,?)", s.Chapter.ChapterID[:], s.Chapter.NovelID[:], owner[:])
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	if string(book) != string(s.Chapter.NovelID[:]) || string(author) != string(owner[:]) {
		return nil, ErrNotFound
	}
	return primary, nil
}

// Fixed server-owned identifiers only: no request value reaches this mapping.
func (s Store) query(query string) string {
	if s.Chapter == nil {
		return query
	}
	return strings.NewReplacer("draft_mutations", "chapter_draft_mutations", "draft_revisions", "chapter_draft_revisions", "drafts", "chapter_drafts").Replace(query)
}
