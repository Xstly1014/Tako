package novel

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"strings"
	"time"
	"unicode/utf8"
)

var ErrReadingConflict = errors.New("reading_position_conflict")

type ReadingLocator struct {
	Algorithm uint64 `json:"algorithm"`
	Paragraph uint64 `json:"paragraph"`
	Offset    uint64 `json:"offset"`
}
type ReadingPosition struct {
	NovelID   uuid.UUID      `json:"novel_id"`
	ChapterID uuid.UUID      `json:"chapter_id"`
	Version   uint64         `json:"version"`
	Locator   ReadingLocator `json:"locator"`
	Revision  uint64         `json:"revision"`
	SavedAt   time.Time      `json:"saved_at"`
}
type ReadingWrite struct {
	MutationID   uuid.UUID      `json:"mutation_id"`
	BaseRevision uint64         `json:"base_revision"`
	ChapterID    uuid.UUID      `json:"chapter_id"`
	Version      uint64         `json:"version"`
	Locator      ReadingLocator `json:"locator"`
}
type ReadingState struct {
	Position       *ReadingPosition `json:"position"`
	Readable       bool             `json:"readable"`
	CurrentVersion *uint64          `json:"current_version"`
}

func validLocator(content string, l ReadingLocator) bool {
	if l.Algorithm != 1 {
		return false
	}
	lines := strings.Split(strings.ReplaceAll(strings.ReplaceAll(content, "\r\n", "\n"), "\r", "\n"), "\n")
	return l.Paragraph < uint64(len(lines)) && l.Offset <= uint64(utf8.RuneCountInString(lines[l.Paragraph]))
}
func scanReading(row interface{ Scan(...any) error }) (ReadingPosition, error) {
	var p ReadingPosition
	var b, c []byte
	e := row.Scan(&b, &c, &p.Version, &p.Locator.Algorithm, &p.Locator.Paragraph, &p.Locator.Offset, &p.Revision, &p.SavedAt)
	if errors.Is(e, sql.ErrNoRows) {
		return p, ErrNotFound
	}
	if e != nil {
		return p, e
	}
	p.NovelID, e = uuid.FromBytes(b)
	if e != nil {
		return p, e
	}
	p.ChapterID, e = uuid.FromBytes(c)
	return p, e
}

const readingColumns = "novel_id,chapter_id,version,algorithm,paragraph_index,codepoint_offset,revision,saved_at"

// Availability is re-evaluated without returning old titles or text.
func (s Store) ReadingState(ctx context.Context, reader, book uuid.UUID) (ReadingState, error) {
	var out ReadingState
	if reader == uuid.Nil || book == uuid.Nil {
		return out, ErrInvalid
	}
	tx, e := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	p, e := scanReading(tx.QueryRowContext(ctx, "SELECT "+readingColumns+" FROM novel_reading_positions WHERE account_id=? AND novel_id=?", reader[:], book[:]))
	if errors.Is(e, ErrNotFound) {
		return out, tx.Commit()
	}
	if e != nil {
		return out, e
	}
	out.Position = &p
	var version uint64
	e = tx.QueryRowContext(ctx, `SELECT c.display_version FROM novel_chapters c JOIN novels n ON n.id=c.novel_id JOIN chapter_versions v ON v.chapter_id=c.id AND v.version=c.display_version WHERE c.id=? AND c.novel_id=? AND n.author_hidden=FALSE AND n.platform_limited=FALSE AND c.author_hidden=FALSE AND c.platform_limited=FALSE AND v.platform_limited=FALSE`, p.ChapterID[:], book[:]).Scan(&version)
	if e == nil {
		out.Readable = true
		out.CurrentVersion = &version
	} else if !errors.Is(e, sql.ErrNoRows) {
		return out, e
	}
	return out, tx.Commit()
}
func (s Store) ReadingReceipt(ctx context.Context, reader, book, mutation uuid.UUID) (ReadingPosition, error) {
	var p ReadingPosition
	var raw []byte
	e := s.DB.QueryRowContext(ctx, "SELECT result FROM novel_reading_requests WHERE account_id=? AND novel_id=? AND mutation_id=?", reader[:], book[:], mutation[:]).Scan(&raw)
	if errors.Is(e, sql.ErrNoRows) {
		return p, ErrNotFound
	}
	if e != nil {
		return p, e
	}
	e = json.Unmarshal(raw, &p)
	return p, e
}

// Reader account serializes first writes and payload-bound retry receipts.
func (s Store) SaveReading(ctx context.Context, reader, book uuid.UUID, in ReadingWrite) (ReadingPosition, error) {
	var out ReadingPosition
	if reader == uuid.Nil || book == uuid.Nil || in.MutationID == uuid.Nil || in.ChapterID == uuid.Nil || in.BaseRevision >= maxRevision || in.Version == 0 || in.Version > maxRevision || in.Locator.Algorithm != 1 || in.Locator.Paragraph > maxRevision || in.Locator.Offset > maxRevision {
		return out, ErrInvalid
	}
	data, _ := json.Marshal(struct {
		Book  uuid.UUID
		Input ReadingWrite
	}{book, in})
	hash := sha256.Sum256(data)
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	var account []byte
	if e = tx.QueryRowContext(ctx, "SELECT id FROM accounts WHERE id=? FOR UPDATE", reader[:]).Scan(&account); e != nil {
		return out, e
	}
	var old, raw []byte
	e = tx.QueryRowContext(ctx, "SELECT payload_hash,result FROM novel_reading_requests WHERE account_id=? AND mutation_id=?", reader[:], in.MutationID[:]).Scan(&old, &raw)
	if e == nil {
		if string(old) != string(hash[:]) {
			return out, ErrKeyReuse
		}
		if e = json.Unmarshal(raw, &out); e != nil {
			return out, e
		}
		return out, tx.Commit()
	}
	if !errors.Is(e, sql.ErrNoRows) {
		return out, e
	}
	var content string
	// Both the currently displayed chapter and source formal version must be readable.
	// A now-hidden loaded page keeps its local candidate; it grants no new server access.
	e = tx.QueryRowContext(ctx, `SELECT source.content FROM novel_chapters c JOIN novels n ON n.id=c.novel_id JOIN chapter_versions source ON source.chapter_id=c.id AND source.version=? JOIN chapter_versions cv ON cv.chapter_id=c.id AND cv.version=c.display_version WHERE c.id=? AND c.novel_id=? AND n.author_hidden=FALSE AND n.platform_limited=FALSE AND c.author_hidden=FALSE AND c.platform_limited=FALSE AND source.platform_limited=FALSE AND cv.platform_limited=FALSE FOR SHARE`, in.Version, in.ChapterID[:], book[:]).Scan(&content)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	if !validLocator(content, in.Locator) {
		return out, ErrInvalid
	}
	var revision uint64
	e = tx.QueryRowContext(ctx, "SELECT revision FROM novel_reading_positions WHERE account_id=? AND novel_id=? FOR UPDATE", reader[:], book[:]).Scan(&revision)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		return out, e
	}
	if revision != in.BaseRevision {
		return out, ErrReadingConflict
	}
	out = ReadingPosition{NovelID: book, ChapterID: in.ChapterID, Version: in.Version, Locator: in.Locator, Revision: revision + 1, SavedAt: time.Now().UTC().Truncate(time.Microsecond)}
	_, e = tx.ExecContext(ctx, `INSERT INTO novel_reading_positions(account_id,novel_id,chapter_id,version,algorithm,paragraph_index,codepoint_offset,revision,saved_at) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE chapter_id=VALUES(chapter_id),version=VALUES(version),algorithm=VALUES(algorithm),paragraph_index=VALUES(paragraph_index),codepoint_offset=VALUES(codepoint_offset),revision=VALUES(revision),saved_at=VALUES(saved_at)`, reader[:], book[:], in.ChapterID[:], in.Version, in.Locator.Algorithm, in.Locator.Paragraph, in.Locator.Offset, out.Revision, out.SavedAt)
	if e != nil {
		return out, e
	}
	raw, e = json.Marshal(out)
	if e != nil {
		return out, e
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO novel_reading_requests(account_id,mutation_id,novel_id,payload_hash,result,created_at) VALUES(?,?,?,?,?,?)", reader[:], in.MutationID[:], book[:], hash[:], raw, out.SavedAt)
	if e != nil {
		return out, e
	}
	return out, tx.Commit()
}

// Receipts are eligible after 30 days; current private positions are never pruned here.
// The bound and index keep routine maintenance transactions small.
func (s Store) CleanupReadingReceipts(ctx context.Context, now time.Time) (int64, error) {
	if now.IsZero() {
		return 0, ErrInvalid
	}
	result, err := s.DB.ExecContext(ctx, "DELETE FROM novel_reading_requests WHERE created_at<? ORDER BY created_at,account_id,mutation_id LIMIT 500", now.UTC().Add(-30*24*time.Hour))
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}
