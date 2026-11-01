package publication

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"time"
)

var ErrFavoriteConflict = errors.New("favorite_conflict")

type FavoriteState struct {
	WorkID   uuid.UUID `json:"work_id"`
	Favorite bool      `json:"favorite"`
	Revision uint64    `json:"revision"`
}
type FavoriteChange struct {
	MutationID        uuid.UUID `json:"mutation_id"`
	ExpectedAccountID uuid.UUID `json:"expected_account_id"`
	ExpectedRevision  uint64    `json:"expected_revision"`
	Favorite          bool      `json:"favorite"`
}
type FavoriteItem struct {
	WorkID   uuid.UUID `json:"work_id"`
	Revision uint64    `json:"revision"`
	SavedAt  time.Time `json:"saved_at"`
	Work     *WorkCard `json:"work"`
}
type FavoritePage struct {
	Items      []FavoriteItem `json:"items"`
	NextCursor string         `json:"next_cursor"`
}
type favoriteCursor struct {
	At time.Time `json:"at"`
	ID uuid.UUID `json:"id"`
}

func (s Store) Favorite(ctx context.Context, account, work uuid.UUID) (FavoriteState, error) {
	out := FavoriteState{WorkID: work}
	e := s.DB.QueryRowContext(ctx, "SELECT active,revision FROM work_favorites WHERE account_id=? AND work_id=?", account[:], work[:]).Scan(&out.Favorite, &out.Revision)
	if errors.Is(e, sql.ErrNoRows) {
		e = nil
	}
	return out, e
}
func (s Store) ChangeFavorite(ctx context.Context, account, work uuid.UUID, in FavoriteChange) (FavoriteState, error) {
	out := FavoriteState{WorkID: work}
	if account == uuid.Nil || work == uuid.Nil || in.MutationID == uuid.Nil || in.ExpectedRevision >= MaxSequence {
		return out, ErrInvalid
	}
	if in.ExpectedAccountID != account {
		return out, ErrFavoriteConflict
	}
	hash, e := digest(struct {
		Work  uuid.UUID
		Input FavoriteChange
	}{work, in})
	if e != nil {
		return out, e
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	var locked []byte
	if e = tx.QueryRowContext(ctx, "SELECT id FROM accounts WHERE id=? FOR UPDATE", account[:]).Scan(&locked); e != nil {
		return out, e
	}
	var oldHash, raw []byte
	e = tx.QueryRowContext(ctx, "SELECT payload_hash,result FROM favorite_mutations WHERE account_id=? AND mutation_id=?", account[:], in.MutationID[:]).Scan(&oldHash, &raw)
	if e == nil {
		if string(oldHash) != string(hash[:]) {
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
	var hidden, limited bool
	var display uint64
	e = tx.QueryRowContext(ctx, "SELECT author_hidden,platform_limited,display_version FROM works WHERE id=? FOR UPDATE", work[:]).Scan(&hidden, &limited, &display)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	e = tx.QueryRowContext(ctx, "SELECT active,revision FROM work_favorites WHERE account_id=? AND work_id=?", account[:], work[:]).Scan(&out.Favorite, &out.Revision)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		return out, e
	}
	if out.Revision != in.ExpectedRevision {
		return out, ErrFavoriteConflict
	}
	if in.Favorite {
		var versionLimited bool
		e = tx.QueryRowContext(ctx, "SELECT platform_limited FROM work_versions WHERE work_id=? AND version=?", work[:], display).Scan(&versionLimited)
		if errors.Is(e, sql.ErrNoRows) || hidden || limited || versionLimited {
			return out, ErrNotFound
		}
		if e != nil {
			return out, e
		}
	}
	if out.Favorite != in.Favorite || out.Revision == 0 {
		out.Favorite = in.Favorite
		out.Revision++
		_, e = tx.ExecContext(ctx, "INSERT INTO work_favorites(account_id,work_id,active,revision,saved_at) VALUES(?,?,?,?,UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE active=VALUES(active),revision=VALUES(revision),saved_at=IF(VALUES(active),VALUES(saved_at),saved_at)", account[:], work[:], out.Favorite, out.Revision)
		if e != nil {
			return out, e
		}
	}
	raw, e = json.Marshal(out)
	if e != nil {
		return out, e
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO favorite_mutations(account_id,mutation_id,payload_hash,result) VALUES(?,?,?,?)", account[:], in.MutationID[:], hash[:], raw)
	if e != nil {
		return out, e
	}
	return out, tx.Commit()
}
func (s Store) Favorites(ctx context.Context, account uuid.UUID, cursor string) (FavoritePage, error) {
	out := FavoritePage{Items: []FavoriteItem{}}
	var c favoriteCursor
	if cursor != "" {
		if len(cursor) > 512 {
			return out, ErrInvalid
		}
		raw, e := base64.RawURLEncoding.DecodeString(cursor)
		if e != nil || json.Unmarshal(raw, &c) != nil || c.ID == uuid.Nil || c.At.IsZero() {
			return out, ErrInvalid
		}
	}
	// Join protected metadata only when the current display version is public.
	q := `SELECT f.work_id,f.revision,f.saved_at,v.version,v.title,v.introduction,v.tags,a.nickname,initial.published_at
 FROM work_favorites f JOIN works w ON w.id=f.work_id
 LEFT JOIN work_versions v ON v.work_id=w.id AND v.version=w.display_version AND w.author_hidden=FALSE AND w.platform_limited=FALSE AND v.platform_limited=FALSE
 LEFT JOIN accounts a ON a.id=w.owner_id AND v.work_id IS NOT NULL
 LEFT JOIN work_versions initial ON initial.work_id=w.id AND initial.version=1 AND v.work_id IS NOT NULL
 WHERE f.account_id=? AND f.active=TRUE`
	args := []any{account[:]}
	if cursor != "" {
		q += " AND (f.saved_at<? OR (f.saved_at=? AND f.work_id<?))"
		args = append(args, c.At, c.At, c.ID[:])
	}
	q += " ORDER BY f.saved_at DESC,f.work_id DESC LIMIT 21"
	rows, e := s.DB.QueryContext(ctx, q, args...)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		var item FavoriteItem
		var id, tags []byte
		var version sql.NullInt64
		var title, intro, nickname sql.NullString
		var first sql.NullTime
		if e = rows.Scan(&id, &item.Revision, &item.SavedAt, &version, &title, &intro, &tags, &nickname, &first); e != nil {
			return out, e
		}
		item.WorkID, e = uuid.FromBytes(id)
		if e != nil {
			return out, e
		}
		if len(out.Items) == 20 {
			last := out.Items[19]
			raw, _ := json.Marshal(favoriteCursor{last.SavedAt, last.WorkID})
			out.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
			break
		}
		if version.Valid {
			card := WorkCard{ID: item.WorkID, Version: uint64(version.Int64), Title: title.String, Introduction: intro.String, AuthorNickname: nickname.String, FirstPublishedAt: first.Time}
			if e = json.Unmarshal(tags, &card.Tags); e != nil {
				return out, e
			}
			item.Work = &card
		}
		out.Items = append(out.Items, item)
	}
	return out, rows.Err()
}
