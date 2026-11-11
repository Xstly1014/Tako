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
	Version     uint64         `json:"version"`
	PublishedAt time.Time      `json:"published_at"`
	Cover       *ImageMetadata `json:"cover"`
}

type PostPage[T any] struct {
	Items      []T    `json:"items"`
	NextCursor string `json:"next_cursor"`
}

func (s PostStore) Queue(ctx context.Context, cursor string) (PostPage[QueueItem], error) {
	out := PostPage[QueueItem]{Items: []QueueItem{}}
	clause, args, err := s.pageBefore(ctx, "submitted_at", cursor, uuid.Nil)
	if err != nil {
		return out, err
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT s.id,p.title,s.submitted_at,s.initial_pre_review FROM short_posts s
 JOIN short_post_previews p ON p.owner_id=s.owner_id AND p.id=s.preview_id
 WHERE s.review_status='pending' AND s.initial_review_archive IS NULL`+clause+" ORDER BY s.submitted_at DESC,s.id DESC LIMIT 13", args...)
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
	clause, args, err := s.pageBefore(ctx, "first_published_at", cursor, uuid.Nil)
	if err != nil {
		return out, err
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT s.id,p.title,LEFT(p.content,120),a.nickname,v.version,s.first_published_at,
 i.id,COALESCE(i.media_type,''),COALESCE(i.width,0),COALESCE(i.height,0)
 FROM short_posts s JOIN short_post_versions v ON v.post_id=s.id AND v.version=s.display_version AND v.platform_limited=FALSE
 JOIN short_post_previews p ON p.owner_id=v.owner_id AND p.id=v.preview_id
 JOIN accounts a ON a.id=s.owner_id
 LEFT JOIN short_post_preview_images m ON m.owner_id=v.owner_id AND m.preview_id=v.preview_id AND m.position=1
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
		if err := rows.Scan(&item.ID, &item.Title, &item.Excerpt, &item.Author, &item.Version, &item.PublishedAt, &id, &cover.MediaType, &cover.Width, &cover.Height); err != nil {
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

type OwnedPostItem struct {
	PostState
	Title          string    `json:"title"`
	SubmittedAt    time.Time `json:"submitted_at"`
	DisplayVersion uint64    `json:"display_version"`
}

func (s PostStore) OwnedPosts(ctx context.Context, owner uuid.UUID, cursor string) (PostPage[OwnedPostItem], error) {
	out := PostPage[OwnedPostItem]{Items: []OwnedPostItem{}}
	if owner == uuid.Nil {
		return out, ErrInvalidCursor
	}
	clause, pageArgs, err := s.pageBefore(ctx, "submitted_at", cursor, owner)
	if err != nil {
		return out, err
	}
	args := append([]any{owner[:]}, pageArgs...)
	rows, err := s.DB.QueryContext(ctx, `SELECT s.id,s.state_revision,s.review_status,s.author_hidden,
 s.platform_limited,s.first_published_at,s.submitted_at,s.display_version,p.title
 FROM short_posts s
 LEFT JOIN short_post_versions v ON v.post_id=s.id AND v.version=s.display_version
 LEFT JOIN short_post_revision_submissions r ON r.post_id=s.id AND r.owner_id=s.owner_id AND s.display_version=0
 AND r.id=(SELECT sr.id FROM short_post_revision_submissions sr WHERE sr.post_id=s.id ORDER BY sr.expected_revision DESC LIMIT 1)
 JOIN short_post_previews p ON p.owner_id=s.owner_id AND p.id=COALESCE(v.preview_id,r.preview_id,s.preview_id)
 WHERE s.owner_id=?`+clause+" ORDER BY s.submitted_at DESC,s.id DESC LIMIT 13", args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var item OwnedPostItem
		if err := rows.Scan(&item.ID, &item.Revision, &item.ReviewStatus, &item.AuthorHidden,
			&item.PlatformLimited, &item.PublishedAt, &item.SubmittedAt, &item.DisplayVersion, &item.Title); err != nil {
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

// field is a fixed, immutable sort column selected by the caller.
// Once a post has been listed, visibility changes do not invalidate its anchor.
func (s PostStore) pageBefore(ctx context.Context, field, cursor string, owner uuid.UUID) (string, []any, error) {
	if cursor == "" {
		return "", nil, nil
	}
	id, err := uuid.Parse(cursor)
	if err != nil || id == uuid.Nil {
		return "", nil, ErrInvalidCursor
	}
	var at sql.NullTime
	query := "SELECT " + field + " FROM short_posts WHERE id=?"
	args := []any{id[:]}
	if owner != uuid.Nil {
		query += " AND owner_id=?"
		args = append(args, owner[:])
	}
	err = s.DB.QueryRowContext(ctx, query, args...).Scan(&at)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !at.Valid) {
		return "", nil, ErrInvalidCursor
	}
	if err != nil {
		return "", nil, err
	}
	return " AND (s." + field + ",s.id)<(?,?)", []any{at.Time, id[:]}, nil
}
