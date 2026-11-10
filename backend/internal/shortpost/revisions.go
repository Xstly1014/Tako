package shortpost

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"writing.local/community/internal/novel"
)

const maxPostRevision uint64 = 9007199254740991

type RevisePost struct {
	SubmitPost
	ExpectedRevision uint64 `json:"expected_revision"`
}

type RevisionSnapshot struct {
	SubmissionReceipt
	PostReviewPending bool            `json:"post_review_pending"`
	State             string          `json:"state"`
	Version           *uint64         `json:"version"`
	Title             string          `json:"title"`
	Content           string          `json:"content"`
	Images            []ImageMetadata `json:"images"`
	Reason            string          `json:"review_reason"`
}

func (s PostStore) Revise(ctx context.Context, owner, post, id uuid.UUID, in RevisePost) (SubmissionReceipt, error) {
	if id == uuid.Nil || in.PreviewID == uuid.Nil || !in.RightsConfirmed || in.ExpectedRevision == 0 || in.ExpectedRevision >= maxPostRevision {
		return SubmissionReceipt{}, ErrInvalidSubmission
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return SubmissionReceipt{}, err
	}
	defer tx.Rollback()
	var locked uuid.UUID
	if err = tx.QueryRowContext(ctx, "SELECT id FROM accounts WHERE id=? FOR UPDATE", owner[:]).Scan(&locked); err != nil {
		return SubmissionReceipt{}, err
	}
	var prior SubmissionReceipt
	var priorExpected uint64
	var preReview bool
	err = tx.QueryRowContext(ctx, `SELECT id,preview_id,post_id,initial_pre_review,submitted_at,expected_revision
 FROM short_post_revision_submissions WHERE owner_id=? AND id=?`, owner[:], id[:]).
		Scan(&prior.ID, &prior.PreviewID, &prior.PostID, &preReview, &prior.SubmittedAt, &priorExpected)
	if err == nil {
		if prior.PostID != post || prior.PreviewID != in.PreviewID || priorExpected != in.ExpectedRevision {
			return SubmissionReceipt{}, ErrPreviewIDReused
		}
		prior.Status = submissionStatus(preReview)
		return prior, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return SubmissionReceipt{}, err
	}
	var revision, last uint64
	err = tx.QueryRowContext(ctx, "SELECT state_revision,last_version FROM short_posts WHERE owner_id=? AND id=? FOR UPDATE", owner[:], post[:]).Scan(&revision, &last)
	if err != nil {
		return SubmissionReceipt{}, err
	}
	if revision != in.ExpectedRevision || last == 0 || last >= maxPostRevision {
		return SubmissionReceipt{}, ErrStateConflict
	}
	if err = availablePreview(ctx, tx, owner, in.PreviewID); err != nil {
		return SubmissionReceipt{}, err
	}
	preReview, err = novel.UnderObservation(ctx, tx, owner)
	if err != nil {
		return SubmissionReceipt{}, err
	}
	result, err := tx.ExecContext(ctx, "UPDATE short_post_revision_submissions SET status='superseded' WHERE post_id=? AND status='pending'", post[:])
	if err != nil {
		return SubmissionReceipt{}, err
	}
	replaced, err := result.RowsAffected()
	if err != nil {
		return SubmissionReceipt{}, err
	}
	preReview = preReview || replaced > 0
	state := "pending"
	var version any
	if !preReview {
		last++
		if err = insertPostVersion(ctx, tx, owner, post, in.PreviewID, last); err != nil {
			return SubmissionReceipt{}, err
		}
		version = last
		state = "published"
		if _, err = tx.ExecContext(ctx, "UPDATE short_posts SET last_version=?,display_version=? WHERE id=?", last, last, post[:]); err != nil {
			return SubmissionReceipt{}, err
		}
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO short_post_revision_submissions
 (owner_id,id,post_id,preview_id,expected_revision,initial_pre_review,status,version,post_review_pending,submitted_at)
 VALUES(?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(6))`, owner[:], id[:], post[:], in.PreviewID[:], in.ExpectedRevision, preReview, state, version, !preReview); err != nil {
		return SubmissionReceipt{}, err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE short_posts SET state_revision=state_revision+1 WHERE id=?", post[:]); err != nil {
		return SubmissionReceipt{}, err
	}
	out := SubmissionReceipt{ID: id, PostID: post, PreviewID: in.PreviewID, Status: submissionStatus(preReview)}
	if err = tx.QueryRowContext(ctx, "SELECT submitted_at FROM short_post_revision_submissions WHERE owner_id=? AND id=?", owner[:], id[:]).Scan(&out.SubmittedAt); err != nil {
		return SubmissionReceipt{}, err
	}
	return out, tx.Commit()
}

func submissionStatus(preReview bool) string {
	if preReview {
		return "pre_review"
	}
	return "published"
}

func insertPostVersion(ctx context.Context, tx *sql.Tx, owner, post, preview uuid.UUID, version uint64) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO short_post_versions(post_id,owner_id,preview_id,version,published_at)
 VALUES(?,?,?,?,UTC_TIMESTAMP(6))`, post[:], owner[:], preview[:], version)
	return err
}

func (s PostStore) Revision(ctx context.Context, owner, post, id uuid.UUID) (RevisionSnapshot, error) {
	var out RevisionSnapshot
	out.ID, out.PostID = id, post
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	query := `SELECT r.owner_id,r.preview_id,r.initial_pre_review,r.status,r.version,r.submitted_at,r.reason,p.title,p.content,r.post_review_pending
 FROM short_post_revision_submissions r JOIN short_post_previews p ON p.owner_id=r.owner_id AND p.id=r.preview_id
 WHERE r.post_id=? AND r.id=?`
	args := []any{post[:], id[:]}
	if owner != uuid.Nil {
		query += " AND r.owner_id=?"
		args = append(args, owner[:])
	}
	var actualOwner uuid.UUID
	var pending bool
	err = tx.QueryRowContext(ctx, query, args...).Scan(&actualOwner, &out.PreviewID, &pending, &out.State, &out.Version, &out.SubmittedAt, &out.Reason, &out.Title, &out.Content, &out.PostReviewPending)
	if err != nil {
		return out, err
	}
	out.Status = submissionStatus(pending)
	out.Images, err = previewImages(ctx, tx, actualOwner, out.PreviewID)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}

func decideRevision(ctx context.Context, tx *sql.Tx, post, id uuid.UUID, last uint64, approve bool, reason string) (uint64, error) {
	var owner, preview uuid.UUID
	var state string
	var postReview bool
	err := tx.QueryRowContext(ctx, `SELECT owner_id,preview_id,status,post_review_pending FROM short_post_revision_submissions
 WHERE post_id=? AND id=? FOR UPDATE`, post[:], id[:]).Scan(&owner, &preview, &state, &postReview)
	if err != nil {
		return 0, err
	}
	if state == "published" && postReview && approve {
		_, err = tx.ExecContext(ctx, "UPDATE short_post_revision_submissions SET post_review_pending=FALSE,reason=? WHERE owner_id=? AND id=?", reason, owner[:], id[:])
		return last, err
	}
	if state != "pending" {
		return 0, ErrStateConflict
	}
	var version any
	state = "rejected"
	if approve {
		last++
		if err = insertPostVersion(ctx, tx, owner, post, preview, last); err != nil {
			return 0, err
		}
		version = last
		state = "published"
	}
	_, err = tx.ExecContext(ctx, "UPDATE short_post_revision_submissions SET status=?,version=?,reason=? WHERE owner_id=? AND id=?", state, version, reason, owner[:], id[:])
	return last, err
}

type VersionNode struct {
	Version     uint64    `json:"version"`
	PublishedAt time.Time `json:"published_at"`
	Readable    bool      `json:"readable"`
}

func (s PostStore) Versions(ctx context.Context, post uuid.UUID, before uint64) ([]VersionNode, error) {
	query := `SELECT v.version,v.published_at,COALESCE(s.history_enabled OR v.version=s.display_version,FALSE)
 FROM short_posts s LEFT JOIN short_post_versions v ON v.post_id=s.id AND v.platform_limited=FALSE`
	var args []any
	if before > 0 {
		query += " AND v.version<?"
		args = append(args, before)
	}
	query += " WHERE s.id=? AND " + readablePost
	args = append(args, post[:])
	rows, err := s.DB.QueryContext(ctx, query+" ORDER BY v.version DESC LIMIT 20", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []VersionNode{}
	exists := false
	for rows.Next() {
		exists = true
		var version sql.NullInt64
		var at sql.NullTime
		var readable bool
		if err := rows.Scan(&version, &at, &readable); err != nil {
			return nil, err
		}
		if version.Valid {
			out = append(out, VersionNode{Version: uint64(version.Int64), PublishedAt: at.Time, Readable: readable})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if !exists {
		return nil, sql.ErrNoRows
	}
	return out, nil
}

func (s PostStore) RevisionReviewImage(ctx context.Context, post, id, image uuid.UUID) (string, []byte, error) {
	var mediaType string
	var body []byte
	err := s.DB.QueryRowContext(ctx, `SELECT i.media_type,i.content FROM short_post_revision_submissions r
 JOIN short_post_preview_images p ON p.owner_id=r.owner_id AND p.preview_id=r.preview_id
 JOIN short_post_images i ON i.owner_id=p.owner_id AND i.id=p.image_id
 WHERE r.post_id=? AND r.id=? AND i.id=?`, post[:], id[:], image[:]).Scan(&mediaType, &body)
	return mediaType, body, err
}

type RevisionQueueItem struct {
	PreReview   bool      `json:"pre_review"`
	Version     *uint64   `json:"version"`
	ID          uuid.UUID `json:"id"`
	PostID      uuid.UUID `json:"post_id"`
	Title       string    `json:"title"`
	SubmittedAt time.Time `json:"submitted_at"`
}

func (s PostStore) RevisionQueue(ctx context.Context, cursor string) (PostPage[RevisionQueueItem], error) {
	out := PostPage[RevisionQueueItem]{Items: []RevisionQueueItem{}}
	query := `SELECT r.id,r.post_id,p.title,r.submitted_at,(r.status='pending'),r.version FROM short_post_revision_submissions r
 JOIN short_post_previews p ON p.owner_id=r.owner_id AND p.id=r.preview_id WHERE (r.status='pending' OR r.post_review_pending)`
	var args []any
	if cursor != "" {
		left, right, ok := strings.Cut(cursor, ".")
		post, postErr := uuid.Parse(left)
		id, idErr := uuid.Parse(right)
		if !ok || postErr != nil || idErr != nil || post == uuid.Nil || id == uuid.Nil {
			return out, ErrInvalidCursor
		}
		var at time.Time
		err := s.DB.QueryRowContext(ctx, "SELECT submitted_at FROM short_post_revision_submissions WHERE post_id=? AND id=?", post[:], id[:]).Scan(&at)
		if errors.Is(err, sql.ErrNoRows) {
			return out, ErrInvalidCursor
		}
		if err != nil {
			return out, err
		}
		query += " AND (r.submitted_at,r.post_id,r.id)<(?,?,?)"
		args = append(args, at, post[:], id[:])
	}
	rows, err := s.DB.QueryContext(ctx, query+" ORDER BY r.submitted_at DESC,r.post_id DESC,r.id DESC LIMIT 13", args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var item RevisionQueueItem
		if err := rows.Scan(&item.ID, &item.PostID, &item.Title, &item.SubmittedAt, &item.PreReview, &item.Version); err != nil {
			return out, err
		}
		out.Items = append(out.Items, item)
	}
	if len(out.Items) > postPageSize {
		out.Items = out.Items[:postPageSize]
		last := out.Items[postPageSize-1]
		out.NextCursor = last.PostID.String() + "." + last.ID.String()
	}
	return out, rows.Err()
}
