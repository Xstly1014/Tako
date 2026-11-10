package shortpost

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
	"writing.local/community/internal/novel"
)

var (
	ErrInvalidSubmission = errors.New("invalid short-post submission")
	ErrAlreadySubmitted  = errors.New("short-post preview already submitted")
)

type PostStore struct {
	DB *sql.DB
}

type SubmitPost struct {
	PreviewID       uuid.UUID `json:"preview_id"`
	RightsConfirmed bool      `json:"rights_confirmed"`
}

type SubmissionReceipt struct {
	ID          uuid.UUID `json:"id"`
	PreviewID   uuid.UUID `json:"preview_id"`
	PostID      uuid.UUID `json:"post_id"`
	Status      string    `json:"status"`
	SubmittedAt time.Time `json:"submitted_at"`
}

const submissionSelect = "SELECT mutation_id,preview_id,id,initial_pre_review,submitted_at FROM short_posts WHERE owner_id=? AND mutation_id=?"

func scanSubmission(row *sql.Row) (SubmissionReceipt, error) {
	var receipt SubmissionReceipt
	var pending bool
	err := row.Scan(&receipt.ID, &receipt.PreviewID, &receipt.PostID, &pending, &receipt.SubmittedAt)
	if err == nil {
		receipt.Status = "published"
		if pending {
			receipt.Status = "pre_review"
		}
	}
	return receipt, err
}

func (s PostStore) Receipt(ctx context.Context, owner, id uuid.UUID) (SubmissionReceipt, error) {
	return scanSubmission(s.DB.QueryRowContext(ctx, submissionSelect, owner[:], id[:]))
}

func (s PostStore) Submit(ctx context.Context, owner, id uuid.UUID, in SubmitPost) (SubmissionReceipt, error) {
	if id == uuid.Nil || in.PreviewID == uuid.Nil || !in.RightsConfirmed {
		return SubmissionReceipt{}, ErrInvalidSubmission
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return SubmissionReceipt{}, err
	}
	defer tx.Rollback()
	// The policy and novel visibility writers use the same author lock.
	var locked []byte
	if err = tx.QueryRowContext(ctx, "SELECT id FROM accounts WHERE id=? FOR UPDATE", owner[:]).Scan(&locked); err != nil {
		return SubmissionReceipt{}, err
	}
	prior, err := scanSubmission(tx.QueryRowContext(ctx, submissionSelect, owner[:], id[:]))
	if err == nil {
		if prior.PreviewID != in.PreviewID {
			return SubmissionReceipt{}, ErrPreviewIDReused
		}
		return prior, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return SubmissionReceipt{}, err
	}
	var consumed bool
	if err = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM short_posts WHERE owner_id=? AND preview_id=?)", owner[:], in.PreviewID[:]).Scan(&consumed); err != nil {
		return SubmissionReceipt{}, err
	}
	if consumed {
		return SubmissionReceipt{}, ErrAlreadySubmitted
	}
	var linked uuid.NullUUID
	var expired bool
	err = tx.QueryRowContext(ctx, "SELECT novel_id,expires_at<=UTC_TIMESTAMP(6) FROM short_post_previews WHERE owner_id=? AND id=? FOR UPDATE", owner[:], in.PreviewID[:]).Scan(&linked, &expired)
	if err != nil {
		return SubmissionReceipt{}, err
	}
	if expired {
		return SubmissionReceipt{}, ErrPreviewExpired
	}
	if linked.Valid {
		readable, err := novel.IsOwnedPublic(ctx, tx, owner, linked.UUID)
		if err != nil {
			return SubmissionReceipt{}, err
		}
		if !readable {
			return SubmissionReceipt{}, ErrNovelUnavailable
		}
	}
	pending, err := novel.UnderObservation(ctx, tx, owner)
	if err != nil {
		return SubmissionReceipt{}, err
	}
	post := uuid.New()
	if _, err = tx.ExecContext(ctx, `INSERT INTO short_posts(id,owner_id,preview_id,mutation_id,submitted_at,initial_pre_review,first_published_at)
 VALUES(?,?,?,?,UTC_TIMESTAMP(6),?,IF(?,NULL,UTC_TIMESTAMP(6)))`, post[:], owner[:], in.PreviewID[:], id[:], pending, pending); err != nil {
		return SubmissionReceipt{}, err
	}
	out, err := scanSubmission(tx.QueryRowContext(ctx, submissionSelect, owner[:], id[:]))
	if err != nil {
		return SubmissionReceipt{}, err
	}
	return out, tx.Commit()
}

type RelatedNovel struct {
	ID    uuid.UUID `json:"id"`
	Title string    `json:"title"`
}

type PublicPost struct {
	ID          uuid.UUID       `json:"id"`
	Title       string          `json:"title"`
	Content     string          `json:"content"`
	Author      string          `json:"author"`
	Version     int             `json:"version"`
	PublishedAt time.Time       `json:"published_at"`
	Images      []ImageMetadata `json:"images"`
	Novel       *RelatedNovel   `json:"novel"`
}

const readablePost = "s.first_published_at IS NOT NULL AND s.author_hidden=FALSE AND s.platform_limited=FALSE"

func (s PostStore) Public(ctx context.Context, id uuid.UUID) (PublicPost, error) {
	out := PublicPost{ID: id, Version: 1}
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return PublicPost{}, err
	}
	defer tx.Rollback()
	var owner, preview uuid.UUID
	var book uuid.NullUUID
	err = tx.QueryRowContext(ctx, `SELECT s.owner_id,s.preview_id,p.title,p.content,p.novel_id,a.nickname,s.first_published_at
 FROM short_posts s JOIN short_post_previews p ON p.owner_id=s.owner_id AND p.id=s.preview_id
 JOIN accounts a ON a.id=s.owner_id WHERE s.id=? AND `+readablePost, id[:]).Scan(&owner, &preview, &out.Title, &out.Content, &book, &out.Author, &out.PublishedAt)
	if err != nil {
		return PublicPost{}, err
	}
	out.Images, err = previewImages(ctx, tx, owner, preview)
	if err != nil {
		return PublicPost{}, err
	}
	if book.Valid {
		title, err := novel.OwnedPublicTitle(ctx, tx, owner, book.UUID)
		switch {
		case err == nil:
			out.Novel = &RelatedNovel{ID: book.UUID, Title: title}
		case !errors.Is(err, sql.ErrNoRows):
			return PublicPost{}, err
		}
	}
	return out, tx.Commit()
}

func (s PostStore) PublicImage(ctx context.Context, post, image uuid.UUID) (string, []byte, error) {
	var mediaType string
	var content []byte
	err := s.DB.QueryRowContext(ctx, `SELECT i.media_type,i.content FROM short_posts s
 JOIN short_post_preview_images p ON p.owner_id=s.owner_id AND p.preview_id=s.preview_id
 JOIN short_post_images i ON i.owner_id=p.owner_id AND i.id=p.image_id
 WHERE s.id=? AND `+readablePost+" AND i.id=?", post[:], image[:]).Scan(&mediaType, &content)
	return mediaType, content, err
}
