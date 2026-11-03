package publication

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
)

type AuthorCatalogQuery struct {
	Query       string
	Visibility  string
	Restriction string
}

type AuthorCatalogItem struct {
	AuthorWorkSummary
	LatestTitle    string `json:"latest_title"`
	DisplayLimited bool   `json:"display_limited"`
}

type AuthorCatalogPage struct {
	Items      []AuthorCatalogItem `json:"items"`
	NextCursor string              `json:"next_cursor"`
}

type authorCatalogCursor struct {
	Version int       `json:"v"`
	ID      uuid.UUID `json:"id"`
	Scope   string    `json:"scope"`
}

func normalizeCatalogQuery(in AuthorCatalogQuery) (AuthorCatalogQuery, error) {
	if !utf8.ValidString(in.Query) || strings.IndexFunc(in.Query, unicode.IsControl) >= 0 {
		return in, ErrInvalid
	}
	in.Query = strings.ToLower(strings.TrimSpace(in.Query))
	if utf8.RuneCountInString(in.Query) > 64 {
		return in, ErrInvalid
	}
	if in.Visibility == "" {
		in.Visibility = "all"
	}
	if in.Restriction == "" {
		in.Restriction = "all"
	}
	if in.Visibility != "all" && in.Visibility != "shown" && in.Visibility != "hidden" {
		return in, ErrInvalid
	}
	if in.Restriction != "all" && in.Restriction != "restricted" && in.Restriction != "unrestricted" {
		return in, ErrInvalid
	}
	return in, nil
}

// AuthorCatalog is an owner-scoped live keyset query. The old AuthorWorks method
// remains the compatibility path; catalog cursors never carry raw search text.
func (s Store) AuthorCatalog(ctx context.Context, owner uuid.UUID, in AuthorCatalogQuery, cursor string) (AuthorCatalogPage, error) {
	out := AuthorCatalogPage{Items: []AuthorCatalogItem{}}
	query, err := normalizeCatalogQuery(in)
	if err != nil || owner == uuid.Nil || len(cursor) > 512 {
		return out, ErrInvalid
	}
	rawScope, _ := json.Marshal(struct {
		Owner uuid.UUID
		Query AuthorCatalogQuery
	}{owner, query})
	hash := sha256.Sum256(rawScope)
	scope := hex.EncodeToString(hash[:])
	var after authorCatalogCursor
	if cursor != "" {
		raw, e := base64.RawURLEncoding.DecodeString(cursor)
		if e != nil || json.Unmarshal(raw, &after) != nil || after.Version != 1 || after.ID == uuid.Nil || after.Scope != scope {
			return out, ErrInvalid
		}
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	statement := `SELECT w.id,v.title,w.source_draft_id,w.author_hidden,w.platform_limited,w.display_version,w.last_version,latest.title,v.platform_limited
	 FROM works w JOIN work_versions v ON v.work_id=w.id AND v.version=w.display_version
	 JOIN work_versions latest ON latest.work_id=w.id AND latest.version=w.last_version WHERE w.owner_id=?`
	args := []any{owner[:]}
	if query.Query != "" {
		pattern := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(query.Query) + "%"
		statement += " AND (LOWER(v.title) LIKE ? ESCAPE '!' OR LOWER(latest.title) LIKE ? ESCAPE '!')"
		args = append(args, pattern, pattern)
	}
	if query.Visibility != "all" {
		statement += " AND w.author_hidden=?"
		args = append(args, query.Visibility == "hidden")
	}
	if query.Restriction == "restricted" {
		statement += " AND (w.platform_limited=1 OR v.platform_limited=1)"
	}
	if query.Restriction == "unrestricted" {
		statement += " AND w.platform_limited=0 AND v.platform_limited=0"
	}
	if cursor != "" {
		var created time.Time
		err = tx.QueryRowContext(ctx, "SELECT created_at FROM works WHERE id=? AND owner_id=?", after.ID[:], owner[:]).Scan(&created)
		if err == sql.ErrNoRows {
			return out, ErrInvalid
		}
		if err != nil {
			return out, err
		}
		statement += " AND (w.created_at<? OR (w.created_at=? AND w.id<?))"
		args = append(args, created, created, after.ID[:])
	}
	statement += " ORDER BY w.created_at DESC,w.id DESC LIMIT 21"
	rows, err := tx.QueryContext(ctx, statement, args...)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var item AuthorCatalogItem
		var id, draft []byte
		if err = rows.Scan(&id, &item.Title, &draft, &item.AuthorHidden, &item.PlatformLimited, &item.DisplayVersion, &item.LastVersion, &item.LatestTitle, &item.DisplayLimited); err != nil {
			rows.Close()
			return out, err
		}
		if item.ID, err = uuid.FromBytes(id); err != nil {
			rows.Close()
			return out, err
		}
		if item.DraftID, err = uuid.FromBytes(draft); err != nil {
			rows.Close()
			return out, err
		}
		out.Items = append(out.Items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	if len(out.Items) > pageSize {
		out.Items = out.Items[:pageSize]
		raw, _ := json.Marshal(authorCatalogCursor{Version: 1, ID: out.Items[pageSize-1].ID, Scope: scope})
		out.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	return out, tx.Commit()
}
