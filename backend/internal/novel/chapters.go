package novel

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"github.com/google/uuid"
	"time"
)

type ChapterSummary struct {
	ID        uuid.UUID `json:"id"`
	Title     string    `json:"title"`
	DraftID   uuid.UUID `json:"draft_id"`
	Revision  uint64    `json:"revision"`
	CreatedAt time.Time `json:"created_at"`
}
type ChapterPage struct {
	Items      []ChapterSummary `json:"items"`
	NextCursor string           `json:"next_cursor"`
}
type chapterCursor struct {
	Owner, NovelID, ID uuid.UUID
	Created            time.Time
}

func (s Store) Chapters(ctx context.Context, owner, book uuid.UUID, token string) (ChapterPage, error) {
	page := ChapterPage{Items: []ChapterSummary{}}
	if len(token) > 512 || book == uuid.Nil {
		return page, ErrInvalid
	}
	if _, err := s.Read(ctx, owner, book); err != nil {
		return page, err
	}
	q := "SELECT c.id,d.title,d.id,d.revision,c.created_at FROM novel_chapters c JOIN chapter_drafts d ON d.id=c.primary_draft_id AND d.novel_id=c.novel_id AND d.chapter_id=c.id AND d.owner_id=c.owner_id WHERE c.owner_id=? AND c.novel_id=?"
	args := []any{owner[:], book[:]}
	if token != "" {
		raw, e := base64.RawURLEncoding.DecodeString(token)
		if e != nil {
			return page, ErrInvalid
		}
		var c chapterCursor
		if json.Unmarshal(raw, &c) != nil || c.Owner != owner || c.NovelID != book || c.ID == uuid.Nil || c.Created.IsZero() {
			return page, ErrInvalid
		}
		q += " AND (c.created_at<? OR (c.created_at=? AND c.id<?))"
		args = append(args, c.Created, c.Created, c.ID[:])
	}
	rows, err := s.DB.QueryContext(ctx, q+" ORDER BY c.created_at DESC,c.id DESC LIMIT 21", args...)
	if err != nil {
		return page, err
	}
	defer rows.Close()
	for rows.Next() {
		var item ChapterSummary
		var id, draft []byte
		if err = rows.Scan(&id, &item.Title, &draft, &item.Revision, &item.CreatedAt); err != nil {
			return page, err
		}
		item.ID, err = uuid.FromBytes(id)
		if err != nil {
			return page, err
		}
		item.DraftID, err = uuid.FromBytes(draft)
		if err != nil {
			return page, err
		}
		page.Items = append(page.Items, item)
	}
	if err = rows.Err(); err != nil {
		return page, err
	}
	if len(page.Items) > 20 {
		page.Items = page.Items[:20]
		last := page.Items[19]
		raw, _ := json.Marshal(chapterCursor{owner, book, last.ID, last.CreatedAt})
		page.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	return page, nil
}
