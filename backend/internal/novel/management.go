package novel

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"time"
)

var ErrStateConflict = errors.New("novel_state_conflict")
var ErrRestricted = errors.New("novel_restricted")

type FormalBook struct {
	Title            string    `json:"title"`
	Introduction     string    `json:"introduction"`
	Tags             []string  `json:"tags"`
	Revision         uint64    `json:"revision"`
	FirstPublishedAt time.Time `json:"first_published_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}
type NovelState struct {
	NovelID              uuid.UUID   `json:"novel_id"`
	StateRevision        uint64      `json:"state_revision"`
	AuthorHidden         bool        `json:"author_hidden"`
	PlatformLimited      bool        `json:"platform_limited"`
	Completed            bool        `json:"completed"`
	LastPosition         uint64      `json:"last_position"`
	Formal               *FormalBook `json:"formal"`
	MetadataSubmissionID *uuid.UUID  `json:"metadata_submission_id"`
}
type ChapterState struct {
	NovelID             uuid.UUID  `json:"novel_id"`
	ChapterID           uuid.UUID  `json:"chapter_id"`
	Ordinal             *uint64    `json:"ordinal"`
	StateRevision       uint64     `json:"state_revision"`
	LastVersion         uint64     `json:"last_version"`
	DisplayVersion      uint64     `json:"display_version"`
	AuthorHidden        bool       `json:"author_hidden"`
	PlatformLimited     bool       `json:"platform_limited"`
	ParentHidden        bool       `json:"parent_hidden"`
	ParentLimited       bool       `json:"parent_limited"`
	Completed           bool       `json:"completed"`
	CurrentSubmissionID *uuid.UUID `json:"current_submission_id"`
}
type VisibilityAction struct {
	MutationID       uuid.UUID `json:"mutation_id"`
	ExpectedRevision uint64    `json:"expected_revision"`
	Action           string    `json:"action"`
}
type VisibilityReceipt struct {
	MutationID      uuid.UUID  `json:"mutation_id"`
	NovelID         uuid.UUID  `json:"novel_id"`
	ChapterID       *uuid.UUID `json:"chapter_id"`
	Action          string     `json:"action"`
	StateRevision   uint64     `json:"state_revision"`
	AuthorHidden    bool       `json:"author_hidden"`
	PlatformLimited bool       `json:"platform_limited"`
	DisplayVersion  uint64     `json:"display_version"`
}
type ChapterVersion struct {
	NovelID         uuid.UUID `json:"novel_id"`
	ChapterID       uuid.UUID `json:"chapter_id"`
	Version         uint64    `json:"version"`
	Title           string    `json:"title"`
	Content         string    `json:"content"`
	PlatformLimited bool      `json:"platform_limited"`
	PublishedAt     time.Time `json:"published_at"`
}
type ChapterVersionSummary struct {
	Version         uint64    `json:"version"`
	Title           string    `json:"title"`
	PlatformLimited bool      `json:"platform_limited"`
	PublishedAt     time.Time `json:"published_at"`
}
type ChapterVersionPage struct {
	Items      []ChapterVersionSummary `json:"items"`
	NextBefore uint64                  `json:"next_before"`
}

func (s Store) OperatorNovelState(ctx context.Context, book uuid.UUID) (NovelState, error) {
	owner, err := s.formalOwner(ctx, book)
	if err != nil {
		return NovelState{}, err
	}
	return s.NovelState(ctx, owner, book)
}
func (s Store) OperatorChapterState(ctx context.Context, book, chapter uuid.UUID) (ChapterState, error) {
	owner, err := s.formalOwner(ctx, book)
	if err != nil {
		return ChapterState{}, err
	}
	out, err := s.ChapterState(ctx, owner, book, chapter)
	if err == nil && out.LastVersion == 0 {
		return ChapterState{}, ErrNotFound
	}
	return out, err
}
func (s Store) OperatorChapterVersion(ctx context.Context, book, chapter uuid.UUID, version uint64) (ChapterVersion, error) {
	owner, err := s.formalOwner(ctx, book)
	if err != nil {
		return ChapterVersion{}, err
	}
	return s.ChapterVersion(ctx, owner, book, chapter, version)
}

func nullableUUID(raw []byte) (*uuid.UUID, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	id, err := uuid.FromBytes(raw)
	return &id, err
}
func readNovelState(ctx context.Context, tx *sql.Tx, owner, book uuid.UUID) (NovelState, error) {
	out := NovelState{NovelID: book}
	var completed sql.NullTime
	var pending []byte
	err := tx.QueryRowContext(ctx, "SELECT state_revision,author_hidden,platform_limited,completed_at,last_position,metadata_submission_id FROM novels WHERE id=? AND owner_id=?", book[:], owner[:]).Scan(&out.StateRevision, &out.AuthorHidden, &out.PlatformLimited, &completed, &out.LastPosition, &pending)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	out.Completed = completed.Valid
	out.MetadataSubmissionID, err = nullableUUID(pending)
	if err != nil {
		return out, err
	}
	var formal FormalBook
	var tags []byte
	err = tx.QueryRowContext(ctx, "SELECT title,introduction,tags,revision,first_published_at,updated_at FROM novel_publications WHERE novel_id=? AND owner_id=?", book[:], owner[:]).Scan(&formal.Title, &formal.Introduction, &tags, &formal.Revision, &formal.FirstPublishedAt, &formal.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	if err = json.Unmarshal(tags, &formal.Tags); err != nil {
		return out, err
	}
	out.Formal = &formal
	return out, nil
}
func (s Store) NovelState(ctx context.Context, owner, book uuid.UUID) (NovelState, error) {
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return NovelState{}, err
	}
	defer tx.Rollback()
	out, err := readNovelState(ctx, tx, owner, book)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func (s Store) ChapterState(ctx context.Context, owner, book, chapter uuid.UUID) (ChapterState, error) {
	out := ChapterState{NovelID: book, ChapterID: chapter}
	var ordinal sql.NullInt64
	var completed sql.NullTime
	var pending []byte
	err := s.DB.QueryRowContext(ctx, `SELECT c.ordinal,c.state_revision,c.last_version,c.display_version,c.author_hidden,c.platform_limited,n.author_hidden,n.platform_limited,n.completed_at,c.current_submission_id FROM novel_chapters c JOIN novels n ON n.id=c.novel_id AND n.owner_id=c.owner_id WHERE c.id=? AND c.novel_id=? AND c.owner_id=?`, chapter[:], book[:], owner[:]).Scan(&ordinal, &out.StateRevision, &out.LastVersion, &out.DisplayVersion, &out.AuthorHidden, &out.PlatformLimited, &out.ParentHidden, &out.ParentLimited, &completed, &pending)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	if ordinal.Valid {
		v := uint64(ordinal.Int64)
		out.Ordinal = &v
	}
	out.Completed = completed.Valid
	out.CurrentSubmissionID, err = nullableUUID(pending)
	return out, err
}

// A shared, payload-bound ledger for the novel's management operations, separate
// from publication receipts. It stores original confirmations, never live state.
func managementRetry(ctx context.Context, tx *sql.Tx, actor, book, mutation uuid.UUID, hash [32]byte, out any) (bool, error) {
	var raw, prior, parent []byte
	err := tx.QueryRowContext(ctx, "SELECT novel_id,payload_hash,result FROM novel_management_requests WHERE actor_id=? AND mutation_id=?", actor[:], mutation[:]).Scan(&parent, &prior, &raw)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if string(parent) != string(book[:]) || string(prior) != string(hash[:]) {
		return false, ErrKeyReuse
	}
	return true, json.Unmarshal(raw, out)
}
func saveManagement(ctx context.Context, tx *sql.Tx, actor, book, mutation uuid.UUID, hash [32]byte, out any) error {
	raw, err := json.Marshal(out)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO novel_management_requests(actor_id,mutation_id,novel_id,payload_hash,result) VALUES(?,?,?,?,?)", actor[:], mutation[:], book[:], hash[:], raw)
	return err
}
func validVisibility(in VisibilityAction) bool {
	return in.MutationID != uuid.Nil && in.ExpectedRevision > 0 && in.ExpectedRevision < maxRevision && (in.Action == "hide" || in.Action == "restore")
}
func (s Store) ChangeVisibility(ctx context.Context, owner, book, chapter uuid.UUID, in VisibilityAction) (VisibilityReceipt, error) {
	var out VisibilityReceipt
	if owner == uuid.Nil || book == uuid.Nil || !validVisibility(in) {
		return out, ErrInvalid
	}
	op := "book_visibility"
	if chapter != uuid.Nil {
		op = "chapter_visibility"
	}
	hash := publicationHash(op, book, chapter, in)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = lockAccount(ctx, tx, owner, false); err != nil {
		return out, err
	}
	if found, e := managementRetry(ctx, tx, owner, book, in.MutationID, hash, &out); e != nil || found {
		if e != nil {
			return out, e
		}
		return out, tx.Commit()
	}
	if _, err = lockPublicationBook(ctx, tx, owner, book); err != nil {
		return out, err
	}
	out = VisibilityReceipt{MutationID: in.MutationID, NovelID: book, Action: in.Action}
	table := "novels"
	target := book
	if chapter == uuid.Nil {
		state, e := readNovelState(ctx, tx, owner, book)
		if e != nil {
			return out, e
		}
		if state.Formal == nil {
			return out, ErrStateConflict
		}
		out.StateRevision = state.StateRevision
		out.AuthorHidden = state.AuthorHidden
		out.PlatformLimited = state.PlatformLimited
	} else {
		c, e := lockPublicationChapter(ctx, tx, owner, book, chapter)
		if e != nil {
			return out, e
		}
		if c.last == 0 {
			return out, ErrStateConflict
		}
		out.ChapterID = &chapter
		out.AuthorHidden = c.hidden
		out.PlatformLimited = c.limited
		err = tx.QueryRowContext(ctx, "SELECT state_revision,display_version FROM novel_chapters WHERE id=?", chapter[:]).Scan(&out.StateRevision, &out.DisplayVersion)
		if err != nil {
			return out, err
		}
		table = "novel_chapters"
		target = chapter
		if in.Action == "restore" {
			var limited bool
			if err = tx.QueryRowContext(ctx, "SELECT platform_limited FROM chapter_versions WHERE chapter_id=? AND version=?", chapter[:], c.last).Scan(&limited); err != nil {
				return out, err
			}
			if limited {
				return out, ErrRestricted
			}
			out.DisplayVersion = c.last
		}
	}
	if out.StateRevision != in.ExpectedRevision {
		return out, ErrStateConflict
	}
	if in.Action == "restore" && out.PlatformLimited {
		return out, ErrRestricted
	}
	nextHidden := in.Action == "hide"
	// An already-confirmed no-op keeps its state revision. Restore only un-hides;
	// it cannot remove platform restrictions, edit content, or emit a new chapter.
	var existingDisplay uint64
	if chapter != uuid.Nil {
		if err = tx.QueryRowContext(ctx, "SELECT display_version FROM novel_chapters WHERE id=?", chapter[:]).Scan(&existingDisplay); err != nil {
			return out, err
		}
	}
	if nextHidden != out.AuthorHidden || (chapter != uuid.Nil && existingDisplay != out.DisplayVersion) {
		q := "UPDATE " + table + " SET author_hidden=?,state_revision=state_revision+1"
		args := []any{nextHidden}
		if chapter != uuid.Nil {
			q += ",display_version=?"
			args = append(args, out.DisplayVersion)
		}
		q += " WHERE id=?"
		args = append(args, target[:])
		if _, err = tx.ExecContext(ctx, q, args...); err != nil {
			return out, err
		}
		out.StateRevision++
	}
	out.AuthorHidden = nextHidden
	if err = saveManagement(ctx, tx, owner, book, in.MutationID, hash, out); err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func (s Store) ChapterVersion(ctx context.Context, owner, book, chapter uuid.UUID, version uint64) (ChapterVersion, error) {
	out := ChapterVersion{NovelID: book, ChapterID: chapter, Version: version}
	if version == 0 || version > maxRevision {
		return out, ErrInvalid
	}
	err := s.DB.QueryRowContext(ctx, "SELECT title,content,platform_limited,published_at FROM chapter_versions WHERE owner_id=? AND novel_id=? AND chapter_id=? AND version=?", owner[:], book[:], chapter[:], version).Scan(&out.Title, &out.Content, &out.PlatformLimited, &out.PublishedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	return out, err
}
func (s Store) ChapterVersions(ctx context.Context, owner, book, chapter uuid.UUID, before uint64) (ChapterVersionPage, error) {
	out := ChapterVersionPage{Items: []ChapterVersionSummary{}}
	if before > maxRevision {
		return out, ErrInvalid
	}
	if _, err := s.ChapterState(ctx, owner, book, chapter); err != nil {
		return out, err
	}
	q := "SELECT version,title,platform_limited,published_at FROM chapter_versions WHERE owner_id=? AND novel_id=? AND chapter_id=?"
	args := []any{owner[:], book[:], chapter[:]}
	if before > 0 {
		q += " AND version<?"
		args = append(args, before)
	}
	rows, err := s.DB.QueryContext(ctx, q+" ORDER BY version DESC LIMIT 51", args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var v ChapterVersionSummary
		if err = rows.Scan(&v.Version, &v.Title, &v.PlatformLimited, &v.PublishedAt); err != nil {
			return out, err
		}
		out.Items = append(out.Items, v)
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	if len(out.Items) > 50 {
		out.Items = out.Items[:50]
		out.NextBefore = out.Items[49].Version
	}
	return out, nil
}
