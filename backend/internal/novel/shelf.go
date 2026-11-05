package novel

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"strings"
	"time"
)

var ErrShelfConflict = errors.New("novel_shelf_conflict")

type ShelfState struct {
	NovelID    uuid.UUID  `json:"novel_id"`
	InShelf    bool       `json:"in_shelf"`
	Following  bool       `json:"following"`
	Revision   uint64     `json:"revision"`
	Generation uint64     `json:"generation"`
	AddedAt    *time.Time `json:"added_at"`
	UpdatedAt  *time.Time `json:"updated_at"`
}
type ShelfWrite struct {
	MutationID   uuid.UUID `json:"mutation_id"`
	BaseRevision uint64    `json:"base_revision"`
	Operation    string    `json:"operation"`
}
type ShelfReceipt struct {
	MutationID uuid.UUID  `json:"mutation_id"`
	Operation  string     `json:"operation"`
	State      ShelfState `json:"state"`
	AcceptedAt time.Time  `json:"accepted_at"`
}
type ShelfItem struct {
	Relation ShelfState   `json:"relation"`
	Book     *PublicNovel `json:"book"`
}
type ShelfPage struct {
	Items      []ShelfItem `json:"items"`
	NextCursor string      `json:"next_cursor"`
}

const shelfColumns = "novel_id,in_shelf,following,revision,generation,added_at,updated_at"

func scanShelf(row interface{ Scan(...any) error }) (ShelfState, error) {
	var out ShelfState
	var raw []byte
	var added, updated time.Time
	e := row.Scan(&raw, &out.InShelf, &out.Following, &out.Revision, &out.Generation, &added, &updated)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	out.NovelID, e = uuid.FromBytes(raw)
	out.AddedAt = &added
	out.UpdatedAt = &updated
	return out, e
}
func (s Store) ShelfState(ctx context.Context, reader, book uuid.UUID) (ShelfState, error) {
	if reader == uuid.Nil || book == uuid.Nil {
		return ShelfState{}, ErrInvalid
	}
	out, e := scanShelf(s.DB.QueryRowContext(ctx, "SELECT "+shelfColumns+" FROM novel_shelves WHERE account_id=? AND novel_id=?", reader[:], book[:]))
	if errors.Is(e, ErrNotFound) {
		return ShelfState{NovelID: book}, nil
	}
	return out, e
}
func (s Store) ShelfReceipt(ctx context.Context, reader, book, mutation uuid.UUID) (ShelfReceipt, error) {
	var out ShelfReceipt
	var raw []byte
	e := s.DB.QueryRowContext(ctx, "SELECT result FROM novel_shelf_requests WHERE account_id=? AND novel_id=? AND mutation_id=?", reader[:], book[:], mutation[:]).Scan(&raw)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	e = json.Unmarshal(raw, &out)
	return out, e
}

// Account -> book -> relation is shared with reader mutations. Never lock the author's account.
// Tombstones and immutable receipts prevent late requests from reviving a removed subscription.
func (s Store) WriteShelf(ctx context.Context, reader, book uuid.UUID, in ShelfWrite) (ShelfReceipt, error) {
	var out ShelfReceipt
	if reader == uuid.Nil || book == uuid.Nil || in.MutationID == uuid.Nil || in.BaseRevision >= maxRevision {
		return out, ErrInvalid
	}
	if in.Operation != "join" && in.Operation != "follow" && in.Operation != "unfollow" && in.Operation != "remove" {
		return out, ErrInvalid
	}
	hash := publicationHash("shelf", book, book, in)
	tx, e := s.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	if e = lockAccount(ctx, tx, reader, false); e != nil {
		return out, e
	}
	var old, raw []byte
	e = tx.QueryRowContext(ctx, "SELECT payload_hash,result FROM novel_shelf_requests WHERE account_id=? AND mutation_id=?", reader[:], in.MutationID[:]).Scan(&old, &raw)
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
	var existing []byte
	e = tx.QueryRowContext(ctx, "SELECT id FROM novels WHERE id=? FOR SHARE", book[:]).Scan(&existing)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	state, e := scanShelf(tx.QueryRowContext(ctx, "SELECT "+shelfColumns+" FROM novel_shelves WHERE account_id=? AND novel_id=? FOR UPDATE", reader[:], book[:]))
	if errors.Is(e, ErrNotFound) {
		state = ShelfState{NovelID: book}
	} else if e != nil {
		return out, e
	}
	if state.Revision != in.BaseRevision {
		return out, ErrShelfConflict
	}
	enabling := in.Operation == "join" || in.Operation == "follow"
	if enabling {
		// Current public metadata + at least one readable formal chapter, never a private draft.
		var visible []byte
		e = tx.QueryRowContext(ctx, "SELECT n.id"+publicNovelJoin+readableNovel+" AND n.id=?", book[:]).Scan(&visible)
		if errors.Is(e, sql.ErrNoRows) {
			return out, ErrNotFound
		}
		if e != nil {
			return out, e
		}
	}
	switch in.Operation {
	case "join":
		if state.InShelf {
			return out, ErrShelfConflict
		}
	case "follow":
		if !state.InShelf || state.Following {
			return out, ErrShelfConflict
		}
	case "unfollow":
		if !state.InShelf || !state.Following {
			return out, ErrShelfConflict
		}
	case "remove":
		if !state.InShelf {
			return out, ErrShelfConflict
		}
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	if in.Operation == "join" {
		state.InShelf = true
		state.AddedAt = &now
	}
	var start uint64
	if state.Revision > 0 {
		if e = tx.QueryRowContext(ctx, "SELECT start_sequence FROM novel_shelves WHERE account_id=? AND novel_id=?", reader[:], book[:]).Scan(&start); e != nil {
			return out, e
		}
	}
	if enabling {
		if state.Generation >= maxRevision {
			return out, ErrShelfConflict
		}
		state.Generation++
		state.Following = true
		if e = tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(release_sequence),0) FROM chapter_release_events WHERE novel_id=?", book[:]).Scan(&start); e != nil {
			return out, e
		}
	} else {
		state.Following = false
	}
	if in.Operation == "remove" {
		state.InShelf = false
	}
	state.Revision++
	state.UpdatedAt = &now
	_, e = tx.ExecContext(ctx, `INSERT INTO novel_shelves(account_id,novel_id,in_shelf,following,revision,generation,start_sequence,added_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE in_shelf=VALUES(in_shelf),following=VALUES(following),revision=VALUES(revision),generation=VALUES(generation),start_sequence=VALUES(start_sequence),added_at=VALUES(added_at),updated_at=VALUES(updated_at)`, reader[:], book[:], state.InShelf, state.Following, state.Revision, state.Generation, start, *state.AddedAt, now)
	if e != nil {
		return out, e
	}
	out = ShelfReceipt{MutationID: in.MutationID, Operation: in.Operation, State: state, AcceptedAt: now}
	raw, e = json.Marshal(out)
	if e != nil {
		return out, e
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO novel_shelf_requests(account_id,mutation_id,novel_id,payload_hash,result,created_at) VALUES(?,?,?,?,?,?)", reader[:], in.MutationID[:], book[:], hash[:], raw, now)
	if e != nil {
		return out, e
	}
	return out, tx.Commit()
}

type shelfCursor struct {
	Book  uuid.UUID
	Added time.Time
}

// Two bounded queries project current public metadata; no stale title snapshots are stored.
func (s Store) Shelves(ctx context.Context, reader uuid.UUID, token string) (ShelfPage, error) {
	out := ShelfPage{Items: []ShelfItem{}}
	if reader == uuid.Nil || len(token) > 512 {
		return out, ErrInvalid
	}
	tx, e := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	q := "SELECT " + shelfColumns + " FROM novel_shelves WHERE account_id=? AND in_shelf=TRUE"
	args := []any{reader[:]}
	if token != "" {
		var c shelfCursor
		raw, err := base64.RawURLEncoding.DecodeString(token)
		if err != nil || json.Unmarshal(raw, &c) != nil || c.Book == uuid.Nil || c.Added.IsZero() {
			return out, ErrInvalid
		}
		var anchor int
		e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM novel_shelves WHERE account_id=? AND novel_id=? AND added_at=?", reader[:], c.Book[:], c.Added).Scan(&anchor)
		if e != nil {
			return out, e
		}
		if anchor != 1 {
			return out, ErrInvalid
		}
		q += " AND (added_at<? OR (added_at=? AND novel_id<?))"
		args = append(args, c.Added, c.Added, c.Book[:])
	}
	rows, e := tx.QueryContext(ctx, q+" ORDER BY added_at DESC,novel_id DESC LIMIT 13", args...)
	if e != nil {
		return out, e
	}
	for rows.Next() {
		state, err := scanShelf(rows)
		if err != nil {
			rows.Close()
			return out, err
		}
		out.Items = append(out.Items, ShelfItem{Relation: state})
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return out, e
	}
	if len(out.Items) > 12 {
		out.Items = out.Items[:12]
		last := out.Items[11].Relation
		raw, _ := json.Marshal(shelfCursor{last.NovelID, *last.AddedAt})
		out.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	if len(out.Items) > 0 {
		placeholders := make([]string, len(out.Items))
		ids := make([]any, len(out.Items))
		index := map[uuid.UUID]int{}
		for i, item := range out.Items {
			placeholders[i] = "?"
			ids[i] = item.Relation.NovelID[:]
			index[item.Relation.NovelID] = i
		}
		rows, e = tx.QueryContext(ctx, "SELECT "+publicNovelColumns+publicNovelJoin+readableNovel+" AND n.id IN ("+strings.Join(placeholders, ",")+")", ids...)
		if e != nil {
			return out, e
		}
		for rows.Next() {
			b, err := scanPublicNovel(rows)
			if err != nil {
				rows.Close()
				return out, err
			}
			i, ok := index[b.ID]
			if !ok {
				rows.Close()
				return out, ErrInvalid
			}
			out.Items[i].Book = &b
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return out, e
		}
	}
	return out, tx.Commit()
}
