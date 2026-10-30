package publication

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

type Work struct {
	ID             uuid.UUID `json:"id"`
	Version        uint64    `json:"version"`
	Title          string    `json:"title"`
	Content        string    `json:"content"`
	Introduction   string    `json:"introduction"`
	Tags           []string  `json:"tags"`
	AuthorNickname string    `json:"author_nickname"`
	PublishedAt    time.Time `json:"published_at"`
}

// Read uses one statement so visibility and content come from one consistent read.
func (s Store) Read(ctx context.Context, id uuid.UUID, version uint64) (Work, error) {
	out := Work{ID: id}
	var tags []byte
	e := s.DB.QueryRowContext(ctx, `SELECT v.version,v.title,v.content,v.introduction,v.tags,a.nickname,v.published_at
 FROM works w JOIN work_versions v ON v.work_id=w.id JOIN accounts a ON a.id=w.owner_id
 WHERE w.id=? AND w.author_hidden=FALSE AND w.platform_limited=FALSE AND v.platform_limited=FALSE
 AND v.version=IF(?=0,w.display_version,?) AND (v.version=w.display_version OR w.history_open=TRUE)`, id[:], version, version).Scan(&out.Version, &out.Title, &out.Content, &out.Introduction, &tags, &out.AuthorNickname, &out.PublishedAt)
	if errors.Is(e, sql.ErrNoRows) {
		return Work{}, ErrNotFound
	}
	if e != nil {
		return Work{}, e
	}
	e = json.Unmarshal(tags, &out.Tags)
	return out, e
}

// Only unsubmitted expired preview bodies are removed. Keep the small idempotency
// tombstone so the same ID cannot silently create a new preview after expiry.
func (s Store) CleanupPreviews(ctx context.Context, now time.Time) (int, error) {
	rows, e := s.DB.QueryContext(ctx, "SELECT id,owner_id FROM publication_previews WHERE consumed_at IS NULL AND content IS NOT NULL AND expires_at<=? ORDER BY expires_at,id LIMIT 100", now.UTC())
	if e != nil {
		return 0, e
	}
	type item struct{ id, owner []byte }
	var items []item
	for rows.Next() {
		var x item
		if e = rows.Scan(&x.id, &x.owner); e != nil {
			rows.Close()
			return 0, e
		}
		items = append(items, x)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return 0, e
	}
	count := 0
	for _, x := range items {
		tx, e := s.DB.BeginTx(ctx, nil)
		if e != nil {
			return count, e
		}
		var owner []byte
		if e = tx.QueryRowContext(ctx, "SELECT id FROM accounts WHERE id=? FOR UPDATE", x.owner).Scan(&owner); e != nil {
			tx.Rollback()
			return count, e
		}
		res, e := tx.ExecContext(ctx, "UPDATE publication_previews SET title=NULL,content=NULL,introduction=NULL,tags=NULL WHERE id=? AND owner_id=? AND consumed_at IS NULL AND expires_at<=? AND content IS NOT NULL", x.id, x.owner, now.UTC())
		if e != nil {
			tx.Rollback()
			return count, e
		}
		n, e := res.RowsAffected()
		if e != nil {
			tx.Rollback()
			return count, e
		}
		if e = tx.Commit(); e != nil {
			return count, e
		}
		count += int(n)
	}
	return count, nil
}
