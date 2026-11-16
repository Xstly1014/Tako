package shortpost

import (
	"context"
	"database/sql"
	"time"

	"github.com/google/uuid"
)

type SubmissionNode struct {
	ID                uuid.UUID `json:"id"`
	Title             string    `json:"title"`
	State             string    `json:"state"`
	Version           *uint64   `json:"version"`
	PostReviewPending bool      `json:"post_review_pending"`
	SubmittedAt       time.Time `json:"submitted_at"`
}

type SubmissionPage struct {
	Initial    SubmissionNode   `json:"initial"`
	Items      []SubmissionNode `json:"items"`
	NextBefore uint64           `json:"next_before"`
}

func initialSubmission(ctx context.Context, tx *sql.Tx, owner, post uuid.UUID) (RevisionSnapshot, error) {
	out := RevisionSnapshot{}
	out.PostID = post
	var preReview bool
	err := tx.QueryRowContext(ctx, `SELECT s.mutation_id,s.preview_id,s.submitted_at,s.initial_pre_review,
 COALESCE(s.initial_review_archive,IF(s.first_published_at IS NULL,s.review_status,'published')),
 IF(s.initial_review_archive IS NULL AND s.first_published_at IS NOT NULL,1,NULL),
 s.initial_review_archive IS NULL AND s.first_published_at IS NOT NULL AND s.review_status='pending',
 p.title,p.content,p.novel_id,
 COALESCE((SELECT a.reason FROM short_post_actions a WHERE a.post_id=s.id AND a.target_revision_id IS NULL
 AND a.target_version IS NULL AND a.action IN ('approve','reject') ORDER BY a.state_revision DESC LIMIT 1),'')
 FROM short_posts s JOIN short_post_previews p ON p.owner_id=s.owner_id AND p.id=s.preview_id
 WHERE s.id=? AND s.owner_id=?`, post[:], owner[:]).
		Scan(&out.ID, &out.PreviewID, &out.SubmittedAt, &preReview, &out.State, &out.Version, &out.PostReviewPending,
			&out.Title, &out.Content, &out.NovelID, &out.Reason)
	out.Status = submissionStatus(preReview)
	return out, err
}

func (s PostStore) InitialSubmission(ctx context.Context, owner, post uuid.UUID) (RevisionSnapshot, error) {
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return RevisionSnapshot{}, err
	}
	defer tx.Rollback()
	out, err := initialSubmission(ctx, tx, owner, post)
	if err != nil {
		return RevisionSnapshot{}, err
	}
	out.Images, err = previewImages(ctx, tx, owner, out.PreviewID)
	if err != nil {
		return RevisionSnapshot{}, err
	}
	return out, tx.Commit()
}

func (s PostStore) SubmissionHistory(ctx context.Context, owner, post uuid.UUID, before uint64) (SubmissionPage, error) {
	out := SubmissionPage{Items: []SubmissionNode{}}
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	initial, err := initialSubmission(ctx, tx, owner, post)
	if err != nil {
		return out, err
	}
	out.Initial = SubmissionNode{ID: initial.ID, Title: initial.Title, State: initial.State,
		Version: initial.Version, PostReviewPending: initial.PostReviewPending, SubmittedAt: initial.SubmittedAt}
	query := `SELECT r.id,p.title,r.status,r.version,r.post_review_pending,r.submitted_at,r.expected_revision
 FROM short_post_revision_submissions r
 JOIN short_post_previews p ON p.owner_id=r.owner_id AND p.id=r.preview_id
 WHERE r.post_id=? AND r.owner_id=?`
	args := []any{post[:], owner[:]}
	if before > 0 {
		query += " AND r.expected_revision<?"
		args = append(args, before)
	}
	rows, err := tx.QueryContext(ctx, query+" ORDER BY r.expected_revision DESC LIMIT 13", args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	var anchor uint64
	for rows.Next() {
		var node SubmissionNode
		var revision uint64
		if err := rows.Scan(&node.ID, &node.Title, &node.State, &node.Version, &node.PostReviewPending, &node.SubmittedAt, &revision); err != nil {
			return out, err
		}
		if len(out.Items) == postPageSize {
			out.NextBefore = anchor
			break
		}
		anchor = revision
		out.Items = append(out.Items, node)
	}
	if err := rows.Err(); err != nil {
		return out, err
	}
	if err := rows.Close(); err != nil {
		return out, err
	}
	return out, tx.Commit()
}
