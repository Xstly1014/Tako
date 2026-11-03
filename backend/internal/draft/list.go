package draft

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"github.com/google/uuid"
	"time"
)

type Summary struct {
	ID            uuid.UUID  `json:"id"`
	Title         string     `json:"title"`
	Revision      uint64     `json:"revision"`
	SavedAt       time.Time  `json:"saved_at"`
	CreatedAt     time.Time  `json:"created_at"`
	RecoveredFrom *uuid.UUID `json:"recovered_from"`
}
type Page struct {
	Items      []Summary `json:"items"`
	NextCursor string    `json:"next_cursor"`
}
type cursor struct {
	NovelID   uuid.UUID `json:"novel_id,omitzero"`
	ChapterID uuid.UUID `json:"chapter_id,omitzero"`
	Owner     uuid.UUID `json:"owner"`
	CreatedAt time.Time `json:"created_at"`
	ID        uuid.UUID `json:"id"`
}

func (s Store) List(ctx context.Context, owner uuid.UUID, limit int, token string) (Page, error) {
	if owner == uuid.Nil || limit < 1 || limit > 100 || len(token) > 512 {
		return Page{}, ErrInvalid
	}
	if err := s.parent(ctx, owner); err != nil {
		return Page{}, err
	}
	query := "SELECT id,title,revision,updated_at,created_at,recovered_from_id FROM drafts WHERE owner_id=?"
	args := []any{owner[:]}
	query, args = s.scoped(query, "", args...)
	if token != "" {
		raw, err := base64.RawURLEncoding.DecodeString(token)
		if err != nil {
			return Page{}, ErrInvalid
		}
		var c cursor
		if err = json.Unmarshal(raw, &c); err != nil || c.Owner != owner || c.ID == uuid.Nil || c.CreatedAt.IsZero() {
			return Page{}, ErrInvalid
		}
		if s.Chapter == nil {
			if c.NovelID != uuid.Nil || c.ChapterID != uuid.Nil {
				return Page{}, ErrInvalid
			}
		} else if c.NovelID != s.Chapter.NovelID || c.ChapterID != s.Chapter.ChapterID {
			return Page{}, ErrInvalid
		}
		query += " AND (created_at<? OR (created_at=? AND id<?))"
		args = append(args, c.CreatedAt, c.CreatedAt, c.ID[:])
	}
	query += " ORDER BY created_at DESC,id DESC LIMIT ?"
	args = append(args, limit+1)
	rows, err := s.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return Page{}, err
	}
	defer rows.Close()
	page := Page{Items: []Summary{}}
	for rows.Next() {
		var raw, source []byte
		var item Summary
		if err = rows.Scan(&raw, &item.Title, &item.Revision, &item.SavedAt, &item.CreatedAt, &source); err != nil {
			return Page{}, err
		}
		item.ID, err = uuid.FromBytes(raw)
		if err != nil {
			return Page{}, err
		}
		if source != nil {
			parent, parseErr := uuid.FromBytes(source)
			if parseErr != nil {
				return Page{}, parseErr
			}
			item.RecoveredFrom = &parent
		}
		page.Items = append(page.Items, item)
	}
	if err = rows.Err(); err != nil {
		return Page{}, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		last := page.Items[limit-1]
		c := cursor{Owner: owner, CreatedAt: last.CreatedAt, ID: last.ID}
		if s.Chapter != nil {
			c.NovelID = s.Chapter.NovelID
			c.ChapterID = s.Chapter.ChapterID
		}
		raw, err := json.Marshal(c)
		if err != nil {
			return Page{}, err
		}
		page.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	return page, nil
}
