package shortpost

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
)

const postPageSize = 12

var ErrInvalidCursor = errors.New("invalid short-post page cursor")

type QueueItem struct {
	ID          uuid.UUID `json:"id"`
	Title       string    `json:"title"`
	SubmittedAt time.Time `json:"submitted_at"`
	PreReview   bool      `json:"pre_review"`
}

type FeedItem struct {
	ID          uuid.UUID      `json:"id"`
	Title       string         `json:"title"`
	Excerpt     string         `json:"excerpt"`
	Author      string         `json:"author"`
	PublishedAt time.Time      `json:"published_at"`
	Cover       *ImageMetadata `json:"cover"`
}

type PostPage[T any] struct {
	Items      []T    `json:"items"`
	NextCursor string `json:"next_cursor"`
}

func (s PostStore) Queue(ctx context.Context, cursor string) (PostPage[QueueItem], error) {
	out := PostPage[QueueItem]{Items: []QueueItem{}}
	clause, args, err := s.pageBefore(ctx, "submitted_at", cursor)
	if err != nil {
		return out, err
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT s.id,p.title,s.submitted_at,s.initial_pre_review FROM short_posts s
 JOIN short_post_previews p ON p.owner_id=s.owner_id AND p.id=s.preview_id
 WHERE s.review_status='pending'`+clause+" ORDER BY s.submitted_at DESC,s.id DESC LIMIT 13", args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var item QueueItem
		if err := rows.Scan(&item.ID, &item.Title, &item.SubmittedAt, &item.PreReview); err != nil {
			return out, err
		}
		out.Items = append(out.Items, item)
	}
	if len(out.Items) > postPageSize {
		out.Items = out.Items[:postPageSize]
		out.NextCursor = out.Items[postPageSize-1].ID.String()
	}
	return out, rows.Err()
}

func (s PostStore) Feed(ctx context.Context, cursor string) (PostPage[FeedItem], error) {
	out := PostPage[FeedItem]{Items: []FeedItem{}}
	clause, args, err := s.pageBefore(ctx, "first_published_at", cursor)
	if err != nil {
		return out, err
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT s.id,p.title,LEFT(p.content,120),a.nickname,s.first_published_at,
 i.id,COALESCE(i.media_type,''),COALESCE(i.width,0),COALESCE(i.height,0)
 FROM short_posts s JOIN short_post_previews p ON p.owner_id=s.owner_id AND p.id=s.preview_id
 JOIN accounts a ON a.id=s.owner_id
 LEFT JOIN short_post_preview_images m ON m.owner_id=s.owner_id AND m.preview_id=s.preview_id AND m.position=1
 LEFT JOIN short_post_images i ON i.owner_id=m.owner_id AND i.id=m.image_id
 WHERE `+readablePost+clause+" ORDER BY s.first_published_at DESC,s.id DESC LIMIT 13", args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var item FeedItem
		var id uuid.NullUUID
		var cover ImageMetadata
		if err := rows.Scan(&item.ID, &item.Title, &item.Excerpt, &item.Author, &item.PublishedAt, &id, &cover.MediaType, &cover.Width, &cover.Height); err != nil {
			return out, err
		}
		if id.Valid {
			cover.ID = id.UUID
			item.Cover = &cover
		}
		out.Items = append(out.Items, item)
	}
	if len(out.Items) > postPageSize {
		out.Items = out.Items[:postPageSize]
		out.NextCursor = out.Items[postPageSize-1].ID.String()
	}
	return out, rows.Err()
}

// field is the fixed, immutable sort column selected by the two callers above.
// Once a post has been listed, visibility changes do not invalidate its anchor.
func (s PostStore) pageBefore(ctx context.Context, field, cursor string) (string, []any, error) {
	if cursor == "" {
		return "", nil, nil
	}
	id, err := uuid.Parse(cursor)
	if err != nil || id == uuid.Nil {
		return "", nil, ErrInvalidCursor
	}
	var at sql.NullTime
	err = s.DB.QueryRowContext(ctx, "SELECT "+field+" FROM short_posts WHERE id=?", id[:]).Scan(&at)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !at.Valid) {
		return "", nil, ErrInvalidCursor
	}
	if err != nil {
		return "", nil, err
	}
	return " AND (s." + field + ",s.id)<(?,?)", []any{at.Time, id[:]}, nil
}
