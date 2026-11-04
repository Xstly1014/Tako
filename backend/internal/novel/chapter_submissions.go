package novel

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

type ChapterSubmissionSummary struct {
	ID               uuid.UUID  `json:"id"`
	NovelID          uuid.UUID  `json:"novel_id"`
	ChapterID        uuid.UUID  `json:"chapter_id"`
	PreviewID        uuid.UUID  `json:"preview_id"`
	Title            string     `json:"title"`
	Ordinal          uint64     `json:"ordinal"`
	CandidateVersion uint64     `json:"candidate_version"`
	State            string     `json:"state"`
	Current          bool       `json:"current"`
	Reason           string     `json:"reason"`
	SubmittedAt      time.Time  `json:"submitted_at"`
	DecidedAt        *time.Time `json:"decided_at"`
}
type ChapterSubmissionDetail struct {
	Submission ChapterSubmissionSummary `json:"submission"`
	Preview    ChapterPreview           `json:"preview"`
}
type ChapterSubmissionPage struct {
	Items      []ChapterSubmissionSummary `json:"items"`
	NextCursor string                     `json:"next_cursor"`
}
type submissionCursor struct {
	Owner, Book, ID uuid.UUID
	Chapter         uuid.UUID
	PendingOnly     bool
	Time            time.Time
}

const submissionColumns = `s.id,s.novel_id,s.chapter_id,s.preview_id,JSON_UNQUOTE(JSON_EXTRACT(p.snapshot,'$.title')),s.ordinal,s.candidate_version,s.state,(c.current_submission_id=s.id AND s.state='pending'),s.decision_reason,s.created_at,s.decided_at`
const submissionJoin = ` FROM chapter_submissions s JOIN chapter_previews p ON p.id=s.preview_id JOIN novel_chapters c ON c.id=s.chapter_id `

func scanSubmission(row interface{ Scan(...any) error }) (ChapterSubmissionSummary, error) {
	var out ChapterSubmissionSummary
	var id, book, chapter, preview []byte
	var current sql.NullBool
	err := row.Scan(&id, &book, &chapter, &preview, &out.Title, &out.Ordinal, &out.CandidateVersion, &out.State, &current, &out.Reason, &out.SubmittedAt, &out.DecidedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	out.Current = current.Valid && current.Bool
	for _, pair := range []struct {
		raw  []byte
		dest *uuid.UUID
	}{{id, &out.ID}, {book, &out.NovelID}, {chapter, &out.ChapterID}, {preview, &out.PreviewID}} {
		*pair.dest, err = uuid.FromBytes(pair.raw)
		if err != nil {
			return out, err
		}
	}
	return out, nil
}
func (s Store) ChapterSubmission(ctx context.Context, owner, book, id uuid.UUID) (ChapterSubmissionDetail, error) {
	return s.readChapterSubmission(ctx, owner, book, id, false)
}
func (s Store) OperatorChapterSubmission(ctx context.Context, book, id uuid.UUID) (ChapterSubmissionDetail, error) {
	return s.readChapterSubmission(ctx, uuid.Nil, book, id, true)
}
func (s Store) readChapterSubmission(ctx context.Context, owner, book, id uuid.UUID, operator bool) (ChapterSubmissionDetail, error) {
	var out ChapterSubmissionDetail
	q := "SELECT " + submissionColumns + ",p.snapshot" + submissionJoin + " WHERE s.novel_id=? AND s.id=?"
	args := []any{book[:], id[:]}
	if !operator {
		q += " AND s.owner_id=?"
		args = append(args, owner[:])
	}
	// One read view for fixed content and its current pending pointer.
	var raw []byte
	var sid, bid, cid, pid []byte
	var current sql.NullBool
	x := &out.Submission
	err := s.DB.QueryRowContext(ctx, q, args...).Scan(&sid, &bid, &cid, &pid, &x.Title, &x.Ordinal, &x.CandidateVersion, &x.State, &current, &x.Reason, &x.SubmittedAt, &x.DecidedAt, &raw)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	x.Current = current.Valid && current.Bool
	for _, pair := range []struct {
		raw  []byte
		dest *uuid.UUID
	}{{sid, &x.ID}, {bid, &x.NovelID}, {cid, &x.ChapterID}, {pid, &x.PreviewID}} {
		*pair.dest, err = uuid.FromBytes(pair.raw)
		if err != nil {
			return out, err
		}
	}
	err = json.Unmarshal(raw, &out.Preview)
	return out, err
}
func (s Store) ChapterSubmissions(ctx context.Context, owner, book uuid.UUID, token string) (ChapterSubmissionPage, error) {
	if _, err := s.Read(ctx, owner, book); err != nil {
		return ChapterSubmissionPage{}, err
	}
	return s.listChapterSubmissions(ctx, owner, book, token, false, uuid.Nil)
}

// Only called behind the operator HTTP boundary. No private working draft is
// read: the queue contains the exact accepted snapshots awaiting a decision.
func (s Store) ChapterReviewQueue(ctx context.Context, token string) (ChapterSubmissionPage, error) {
	return s.listChapterSubmissions(ctx, uuid.Nil, uuid.Nil, token, true, uuid.Nil)
}
func (s Store) listChapterSubmissions(ctx context.Context, owner, book uuid.UUID, token string, pending bool, chapter uuid.UUID) (ChapterSubmissionPage, error) {
	out := ChapterSubmissionPage{Items: []ChapterSubmissionSummary{}}
	if len(token) > 512 {
		return out, ErrInvalid
	}
	q := "SELECT " + submissionColumns + submissionJoin + " WHERE 1=1"
	args := []any{}
	if pending {
		q += " AND s.state='pending' AND c.current_submission_id=s.id"
	} else {
		q += " AND s.owner_id=? AND s.novel_id=?"
		args = append(args, owner[:], book[:])
	}
	if chapter != uuid.Nil {
		q += " AND s.chapter_id=?"
		args = append(args, chapter[:])
	}
	if token != "" {
		var c submissionCursor
		raw, e := base64.RawURLEncoding.DecodeString(token)
		if e != nil || json.Unmarshal(raw, &c) != nil || c.Owner != owner || c.Book != book || c.PendingOnly != pending || c.Chapter != chapter || c.ID == uuid.Nil || c.Time.IsZero() {
			return out, ErrInvalid
		}
		q += " AND (s.created_at<? OR (s.created_at=? AND s.id<?))"
		args = append(args, c.Time, c.Time, c.ID[:])
	}
	rows, err := s.DB.QueryContext(ctx, q+" ORDER BY s.created_at DESC,s.id DESC LIMIT 21", args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		item, e := scanSubmission(rows)
		if e != nil {
			return out, e
		}
		out.Items = append(out.Items, item)
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	if len(out.Items) > 20 {
		out.Items = out.Items[:20]
		last := out.Items[19]
		raw, _ := json.Marshal(submissionCursor{Owner: owner, Book: book, ID: last.ID, Chapter: chapter, PendingOnly: pending, Time: last.SubmittedAt})
		out.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	return out, nil
}

func (s Store) ChapterSubmissionsFor(ctx context.Context, owner, book, chapter uuid.UUID, token string) (ChapterSubmissionPage, error) {
	if chapter == uuid.Nil {
		return ChapterSubmissionPage{}, ErrNotFound
	}
	if _, e := s.ChapterState(ctx, owner, book, chapter); e != nil {
		return ChapterSubmissionPage{}, e
	}
	return s.listChapterSubmissions(ctx, owner, book, token, false, chapter)
}
