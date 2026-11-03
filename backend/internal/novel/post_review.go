package novel

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"time"
)

type NovelPostReview struct {
	SubmissionID uuid.UUID `json:"submission_id"`
	NovelID      uuid.UUID `json:"novel_id"`
	ChapterID    uuid.UUID `json:"chapter_id"`
	Version      uint64    `json:"version"`
	Title        string    `json:"title"`
	CreatedAt    time.Time `json:"created_at"`
	Current      bool      `json:"current"`
}
type NovelPostReviewPage struct {
	Items      []NovelPostReview `json:"items"`
	NextCursor string            `json:"next_cursor"`
}
type NovelPostReviewReceipt struct {
	MutationID   uuid.UUID `json:"mutation_id"`
	Operation    string    `json:"operation"`
	NovelID      uuid.UUID `json:"novel_id"`
	SubmissionID uuid.UUID `json:"submission_id"`
	ChapterID    uuid.UUID `json:"chapter_id"`
	Version      uint64    `json:"version"`
	State        string    `json:"state"`
}
type postCursor struct {
	Time time.Time
	ID   uuid.UUID
}

func (s Store) NovelPostReviews(ctx context.Context, token string) (NovelPostReviewPage, error) {
	out := NovelPostReviewPage{Items: []NovelPostReview{}}
	if len(token) > 512 {
		return out, ErrInvalid
	}
	q := `SELECT t.submission_id,t.novel_id,t.chapter_id,t.version,v.title,t.created_at,(c.display_version=t.version) FROM chapter_post_review_tasks t JOIN chapter_versions v ON v.chapter_id=t.chapter_id AND v.version=t.version JOIN novel_chapters c ON c.id=t.chapter_id WHERE t.reviewed_at IS NULL`
	args := []any{}
	if token != "" {
		raw, e := base64.RawURLEncoding.DecodeString(token)
		var cursor postCursor
		if e != nil || json.Unmarshal(raw, &cursor) != nil || cursor.ID == uuid.Nil || cursor.Time.IsZero() {
			return out, ErrInvalid
		}
		q += " AND (t.created_at>? OR (t.created_at=? AND t.submission_id>?))"
		args = append(args, cursor.Time, cursor.Time, cursor.ID[:])
	}
	rows, err := s.DB.QueryContext(ctx, q+" ORDER BY t.created_at,t.submission_id LIMIT 21", args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var item NovelPostReview
		var id, book, chapter []byte
		if err = rows.Scan(&id, &book, &chapter, &item.Version, &item.Title, &item.CreatedAt, &item.Current); err != nil {
			return out, err
		}
		item.SubmissionID, err = uuid.FromBytes(id)
		if err != nil {
			return out, err
		}
		item.NovelID, err = uuid.FromBytes(book)
		if err != nil {
			return out, err
		}
		item.ChapterID, err = uuid.FromBytes(chapter)
		if err != nil {
			return out, err
		}
		out.Items = append(out.Items, item)
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	if len(out.Items) > 20 {
		out.Items = out.Items[:20]
		last := out.Items[19]
		raw, _ := json.Marshal(postCursor{last.CreatedAt, last.SubmissionID})
		out.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	return out, nil
}
func (s Store) ApproveNovelPostReview(ctx context.Context, actor, book, submission uuid.UUID, in WithdrawChapter) (NovelPostReviewReceipt, error) {
	var out NovelPostReviewReceipt
	if actor == uuid.Nil || book == uuid.Nil || submission == uuid.Nil || in.MutationID == uuid.Nil {
		return out, ErrInvalid
	}
	owner, err := s.formalOwner(ctx, book)
	if err != nil {
		return out, err
	}
	hash := publicationHash("novel_post_review", book, submission, in)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = lockNovelActors(ctx, tx, owner, actor); err != nil {
		return out, err
	}
	if found, e := managementRetry(ctx, tx, actor, book, in.MutationID, hash, &out); e != nil || found {
		if e != nil {
			return out, e
		}
		return out, tx.Commit()
	}
	if _, err = lockPublicationBook(ctx, tx, owner, book); err != nil {
		return out, err
	}
	var raw []byte
	var reviewed sql.NullTime
	err = tx.QueryRowContext(ctx, "SELECT chapter_id,version,reviewed_at FROM chapter_post_review_tasks WHERE novel_id=? AND submission_id=? FOR UPDATE", book[:], submission[:]).Scan(&raw, &out.Version, &reviewed)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	if reviewed.Valid {
		return out, ErrStateConflict
	}
	out.ChapterID, err = uuid.FromBytes(raw)
	if err != nil {
		return out, err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE chapter_post_review_tasks SET reviewed_at=UTC_TIMESTAMP(6),reviewed_by=? WHERE submission_id=?", actor[:], submission[:]); err != nil {
		return out, err
	}
	out.MutationID = in.MutationID
	out.Operation = "post_review"
	out.NovelID = book
	out.SubmissionID = submission
	out.State = "reviewed"
	if err = saveManagement(ctx, tx, actor, book, in.MutationID, hash, out); err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func (s Store) NovelPostReviewReceipt(ctx context.Context, actor, book, mutation uuid.UUID) (NovelPostReviewReceipt, error) {
	var out NovelPostReviewReceipt
	var raw []byte
	err := s.DB.QueryRowContext(ctx, "SELECT result FROM novel_management_requests WHERE actor_id=? AND novel_id=? AND mutation_id=?", actor[:], book[:], mutation[:]).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	var tag struct {
		Operation string `json:"operation"`
	}
	if err = json.Unmarshal(raw, &tag); err != nil {
		return out, err
	}
	if tag.Operation != "post_review" {
		return out, ErrNotFound
	}
	err = json.Unmarshal(raw, &out)
	return out, err
}
