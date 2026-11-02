package novel

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
)

var (
	ErrInvalid  = errors.New("invalid_input")
	ErrNotFound = errors.New("resource_not_found")
	ErrConflict = errors.New("novel_revision_conflict")
	ErrKeyReuse = errors.New("mutation_id_reused")
)

const maxRevision = 9007199254740991

type Book struct {
	ID           uuid.UUID `json:"id"`
	Title        string    `json:"title"`
	Introduction string    `json:"introduction"`
	Tags         []string  `json:"tags"`
	Revision     uint64    `json:"revision"`
	CreatedAt    time.Time `json:"created_at"`
	SavedAt      time.Time `json:"saved_at"`
}
type Write struct {
	MutationID   uuid.UUID `json:"mutation_id"`
	BaseRevision uint64    `json:"base_revision"`
	Title        string    `json:"title"`
	Introduction string    `json:"introduction"`
	Tags         []string  `json:"tags"`
}
type Page struct {
	Items      []Book `json:"items"`
	NextCursor string `json:"next_cursor"`
}
type Store struct{ DB *sql.DB }

func validText(s string, max int) bool {
	return utf8.ValidString(s) && utf8.RuneCountInString(s) <= max && !strings.ContainsFunc(s, func(r rune) bool { return unicode.IsControl(r) && r != '\n' && r != '\t' })
}
func Valid(in Write) bool {
	if in.MutationID == uuid.Nil || in.BaseRevision > maxRevision || !validText(in.Title, 200) || strings.TrimSpace(in.Title) == "" || !validText(in.Introduction, 300) || len(in.Tags) < 1 || len(in.Tags) > 3 {
		return false
	}
	allowed := map[string]bool{"幻想": true, "冒险": true, "日常": true, "情感": true, "悬疑": true, "科幻": true}
	seen := map[string]bool{}
	for _, tag := range in.Tags {
		if !allowed[tag] || seen[tag] {
			return false
		}
		seen[tag] = true
	}
	return true
}
func scanBook(row interface{ Scan(...any) error }) (Book, error) {
	var b Book
	var raw, tags []byte
	err := row.Scan(&raw, &b.Title, &b.Introduction, &tags, &b.Revision, &b.CreatedAt, &b.SavedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return b, ErrNotFound
	}
	if err != nil {
		return b, err
	}
	b.ID, err = uuid.FromBytes(raw)
	if err != nil {
		return b, err
	}
	err = json.Unmarshal(tags, &b.Tags)
	return b, err
}

const columns = "id,title,introduction,tags,revision,created_at,updated_at"

func (s Store) Read(ctx context.Context, owner, id uuid.UUID) (Book, error) {
	return scanBook(s.DB.QueryRowContext(ctx, "SELECT "+columns+" FROM novels WHERE owner_id=? AND id=?", owner[:], id[:]))
}
func (s Store) Receipt(ctx context.Context, owner, id uuid.UUID) (Book, error) {
	var raw []byte
	err := s.DB.QueryRowContext(ctx, "SELECT result FROM novel_mutations WHERE owner_id=? AND mutation_id=?", owner[:], id[:]).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return Book{}, ErrNotFound
	}
	if err != nil {
		return Book{}, err
	}
	var b Book
	err = json.Unmarshal(raw, &b)
	return b, err
}

// Account lock makes payload-bound retries and concurrent creation deterministic.
// Receipts are immutable snapshots; callers must GET current state after recovery.
func (s Store) Write(ctx context.Context, owner, id uuid.UUID, in Write) (Book, error) {
	if owner == uuid.Nil || !Valid(in) || (id == uuid.Nil && in.BaseRevision != 0) || (id != uuid.Nil && in.BaseRevision == 0) {
		return Book{}, ErrInvalid
	}
	data, _ := json.Marshal(struct {
		ID    uuid.UUID
		Input Write
	}{id, in})
	hash := sha256.Sum256(data)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Book{}, err
	}
	defer tx.Rollback()
	var account []byte
	if err = tx.QueryRowContext(ctx, "SELECT id FROM accounts WHERE id=? FOR UPDATE", owner[:]).Scan(&account); err != nil {
		return Book{}, err
	}
	var previous, raw []byte
	err = tx.QueryRowContext(ctx, "SELECT payload_hash,result FROM novel_mutations WHERE owner_id=? AND mutation_id=?", owner[:], in.MutationID[:]).Scan(&previous, &raw)
	if err == nil {
		if string(previous) != string(hash[:]) {
			return Book{}, ErrKeyReuse
		}
		var b Book
		if err = json.Unmarshal(raw, &b); err != nil {
			return b, err
		}
		return b, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Book{}, err
	}
	tags, _ := json.Marshal(in.Tags)
	if id == uuid.Nil {
		id = uuid.New()
		_, err = tx.ExecContext(ctx, "INSERT INTO novels(id,owner_id,title,introduction,tags) VALUES(?,?,?,?,?)", id[:], owner[:], in.Title, in.Introduction, tags)
	} else {
		var result sql.Result
		result, err = tx.ExecContext(ctx, "UPDATE novels SET title=?,introduction=?,tags=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP(6) WHERE id=? AND owner_id=? AND revision=? AND revision<?", in.Title, in.Introduction, tags, id[:], owner[:], in.BaseRevision, maxRevision)
		if err == nil {
			var n int64
			n, err = result.RowsAffected()
			if err == nil && n == 0 {
				var revision uint64
				err = tx.QueryRowContext(ctx, "SELECT revision FROM novels WHERE id=? AND owner_id=?", id[:], owner[:]).Scan(&revision)
				if errors.Is(err, sql.ErrNoRows) {
					return Book{}, ErrNotFound
				}
				if err != nil {
					return Book{}, err
				}
				return Book{}, ErrConflict
			}
		}
	}
	if err != nil {
		return Book{}, err
	}
	b, err := scanBook(tx.QueryRowContext(ctx, "SELECT "+columns+" FROM novels WHERE owner_id=? AND id=?", owner[:], id[:]))
	if err != nil {
		return b, err
	}
	raw, err = json.Marshal(b)
	if err != nil {
		return b, err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO novel_mutations(owner_id,mutation_id,payload_hash,novel_id,result) VALUES(?,?,?,?,?)", owner[:], in.MutationID[:], hash[:], id[:], raw)
	if err != nil {
		return Book{}, err
	}
	return b, tx.Commit()
}

type cursor struct {
	Owner   uuid.UUID
	Created time.Time
	ID      uuid.UUID
}

func (s Store) List(ctx context.Context, owner uuid.UUID, token string) (Page, error) {
	page := Page{Items: []Book{}}
	if owner == uuid.Nil || len(token) > 512 {
		return page, ErrInvalid
	}
	q := "SELECT " + columns + " FROM novels WHERE owner_id=?"
	args := []any{owner[:]}
	if token != "" {
		raw, e := base64.RawURLEncoding.DecodeString(token)
		if e != nil {
			return page, ErrInvalid
		}
		var c cursor
		if json.Unmarshal(raw, &c) != nil || c.Owner != owner || c.ID == uuid.Nil || c.Created.IsZero() {
			return page, ErrInvalid
		}
		q += " AND (created_at<? OR (created_at=? AND id<?))"
		args = append(args, c.Created, c.Created, c.ID[:])
	}
	rows, err := s.DB.QueryContext(ctx, q+" ORDER BY created_at DESC,id DESC LIMIT 21", args...)
	if err != nil {
		return page, err
	}
	defer rows.Close()
	for rows.Next() {
		b, e := scanBook(rows)
		if e != nil {
			return page, e
		}
		page.Items = append(page.Items, b)
	}
	if err = rows.Err(); err != nil {
		return page, err
	}
	if len(page.Items) > 20 {
		page.Items = page.Items[:20]
		last := page.Items[19]
		raw, _ := json.Marshal(cursor{owner, last.CreatedAt, last.ID})
		page.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	return page, nil
}
