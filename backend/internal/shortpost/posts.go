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
	if err = availablePreview(ctx, tx, owner, in.PreviewID); err != nil {
		return SubmissionReceipt{}, err
	}
	pending, err := novel.UnderObservation(ctx, tx, owner)
	if err != nil {
		return SubmissionReceipt{}, err
	}
	post := uuid.New()
	if _, err = tx.ExecContext(ctx, `INSERT INTO short_posts(id,owner_id,preview_id,mutation_id,submitted_at,initial_pre_review,first_published_at,last_version,display_version)
 VALUES(?,?,?,?,UTC_TIMESTAMP(6),?,IF(?,NULL,UTC_TIMESTAMP(6)),IF(?,0,1),IF(?,0,1))`, post[:], owner[:], in.PreviewID[:], id[:], pending, pending, pending, pending); err != nil {
		return SubmissionReceipt{}, err
	}
	if !pending {
		if err = insertFirstVersion(ctx, tx, post); err != nil {
			return SubmissionReceipt{}, err
		}
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
	Version     uint64          `json:"version"`
	PublishedAt time.Time       `json:"published_at"`
	Images      []ImageMetadata `json:"images"`
	Novel       *RelatedNovel   `json:"novel"`
}

const readablePost = "s.first_published_at IS NOT NULL AND s.author_hidden=FALSE AND s.platform_limited=FALSE"

type OwnedPostVersion struct {
	PublicPost
	PlatformLimited   bool    `json:"platform_limited"`
	ReviewReason      string  `json:"review_reason"`
	LimitCaseRevision *uint64 `json:"limit_case_revision"`
}

func (s PostStore) Public(ctx context.Context, id uuid.UUID, version uint64) (PublicPost, error) {
	out, err := s.readVersion(ctx, id, version, uuid.Nil)
	return out.PublicPost, err
}

func (s PostStore) OwnerVersion(ctx context.Context, id, owner uuid.UUID, version uint64) (OwnedPostVersion, error) {
	return s.readVersion(ctx, id, version, owner)
}

func (s PostStore) readVersion(ctx context.Context, id uuid.UUID, version uint64, ownerScope uuid.UUID) (OwnedPostVersion, error) {
	out := OwnedPostVersion{PublicPost: PublicPost{ID: id}}
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return OwnedPostVersion{}, err
	}
	defer tx.Rollback()
	var owner, preview uuid.UUID
	var book uuid.NullUUID
	query := `SELECT s.owner_id,v.preview_id,p.title,p.content,p.novel_id,a.nickname,v.version,v.published_at,v.platform_limited
 FROM short_posts s JOIN short_post_versions v ON v.post_id=s.id
 JOIN short_post_previews p ON p.owner_id=v.owner_id AND p.id=v.preview_id
 JOIN accounts a ON a.id=s.owner_id WHERE s.id=?`
	args := []any{id[:]}
	if ownerScope == uuid.Nil {
		query += " AND " + readablePost + " AND v.platform_limited=FALSE"
	} else {
		query += " AND s.owner_id=?"
		args = append(args, ownerScope[:])
	}
	if version == 0 {
		query += " AND v.version=s.display_version"
	} else {
		query += " AND v.version=?"
		args = append(args, version)
		if ownerScope == uuid.Nil {
			query += " AND (v.version=s.display_version OR s.history_enabled)"
		}
	}
	err = tx.QueryRowContext(ctx, query, args...).Scan(&owner, &preview, &out.Title, &out.Content, &book, &out.Author, &out.Version, &out.PublishedAt, &out.PlatformLimited)
	if err != nil {
		return OwnedPostVersion{}, err
	}
	if ownerScope != uuid.Nil {
		var caseRevision uint64
		err = tx.QueryRowContext(ctx, "SELECT state_revision,reason FROM short_post_actions WHERE post_id=? AND target_version=? ORDER BY state_revision DESC LIMIT 1", id[:], out.Version).Scan(&caseRevision, &out.ReviewReason)
		if err == nil && out.PlatformLimited {
			out.LimitCaseRevision = &caseRevision
		}
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return OwnedPostVersion{}, err
		}
	}
	out.Images, err = previewImages(ctx, tx, owner, preview)
	if err != nil {
		return OwnedPostVersion{}, err
	}
	if book.Valid {
		title, err := novel.OwnedPublicTitle(ctx, tx, owner, book.UUID)
		switch {
		case err == nil:
			out.Novel = &RelatedNovel{ID: book.UUID, Title: title}
		case !errors.Is(err, sql.ErrNoRows):
			return OwnedPostVersion{}, err
		}
	}
	return out, tx.Commit()
}

func (s PostStore) PublicImage(ctx context.Context, post, image uuid.UUID, version uint64) (string, []byte, error) {
	var mediaType string
	var content []byte
	err := s.DB.QueryRowContext(ctx, `SELECT i.media_type,i.content FROM short_posts s
 JOIN short_post_versions v ON v.post_id=s.id
 JOIN short_post_preview_images p ON p.owner_id=v.owner_id AND p.preview_id=v.preview_id
 JOIN short_post_images i ON i.owner_id=p.owner_id AND i.id=p.image_id
 WHERE s.id=? AND `+readablePost+" AND i.id=? AND v.version=? AND v.platform_limited=FALSE AND (v.version=s.display_version OR s.history_enabled)", post[:], image[:], version).Scan(&mediaType, &content)
	return mediaType, content, err
}

func insertFirstVersion(ctx context.Context, tx *sql.Tx, post uuid.UUID) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO short_post_versions(post_id,owner_id,version,preview_id,published_at)
 SELECT id,owner_id,1,preview_id,first_published_at FROM short_posts WHERE id=?`, post[:])
	return err
}

func availablePreview(ctx context.Context, tx *sql.Tx, owner, preview uuid.UUID) error {
	var consumed bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM short_posts WHERE owner_id=? AND preview_id=?)
 OR EXISTS(SELECT 1 FROM short_post_revision_submissions WHERE owner_id=? AND preview_id=?)`,
		owner[:], preview[:], owner[:], preview[:]).Scan(&consumed); err != nil {
		return err
	}
	if consumed {
		return ErrAlreadySubmitted
	}
	var linked uuid.NullUUID
	var expired bool
	err := tx.QueryRowContext(ctx, "SELECT novel_id,expires_at<=UTC_TIMESTAMP(6) FROM short_post_previews WHERE owner_id=? AND id=? FOR UPDATE", owner[:], preview[:]).Scan(&linked, &expired)
	if err != nil {
		return err
	}
	if expired {
		return ErrPreviewExpired
	}
	if linked.Valid {
		readable, err := novel.IsOwnedPublic(ctx, tx, owner, linked.UUID)
		if err != nil {
			return err
		}
		if !readable {
			return ErrNovelUnavailable
		}
	}
	return nil
}
