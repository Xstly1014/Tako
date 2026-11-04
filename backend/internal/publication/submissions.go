package publication

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"strings"
	"time"
	"unicode/utf8"
)

// A pre-review receipt is acceptance, never a formal version or publication time.
func (r Result) MarshalJSON() ([]byte, error) {
	var published *time.Time
	if r.ReviewStatus != "pre_review" {
		published = &r.PublishedAt
	}
	return json.Marshal(struct {
		WorkID       uuid.UUID  `json:"work_id"`
		Version      uint64     `json:"version"`
		PublishedAt  *time.Time `json:"published_at"`
		ReviewStatus string     `json:"review_status"`
		SubmissionID *uuid.UUID `json:"submission_id,omitempty"`
		SubmittedAt  *time.Time `json:"submitted_at,omitempty"`
	}{r.WorkID, r.Version, published, r.ReviewStatus, r.SubmissionID, r.SubmittedAt})
}
func submissionRequest(ctx context.Context, tx *sql.Tx, actor, mutation uuid.UUID, hash [32]byte, out any) (bool, error) {
	var prior, raw []byte
	e := tx.QueryRowContext(ctx, "SELECT payload_hash,result FROM work_submission_requests WHERE actor_id=? AND mutation_id=?", actor[:], mutation[:]).Scan(&prior, &raw)
	if errors.Is(e, sql.ErrNoRows) {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	if string(prior) != string(hash[:]) {
		return false, ErrKeyReuse
	}
	return true, json.Unmarshal(raw, out)
}
func saveSubmissionRequest(ctx context.Context, tx *sql.Tx, actor, mutation uuid.UUID, hash [32]byte, out any) error {
	raw, e := json.Marshal(out)
	if e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO work_submission_requests(actor_id,mutation_id,payload_hash,result) VALUES(?,?,?,?)", actor[:], mutation[:], hash[:], raw)
	return e
}
func mustPreReview(ctx context.Context, tx *sql.Tx, owner, work uuid.UUID, now time.Time) (bool, error) {
	var until sql.NullTime
	e := tx.QueryRowContext(ctx, "SELECT observation_until FROM publication_policies WHERE owner_id=?", owner[:]).Scan(&until)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		return false, e
	}
	var count int
	e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM work_submissions WHERE work_id=? AND state='pending'", work[:]).Scan(&count)
	return count > 0 || (until.Valid && until.Time.After(now)), e
}
func pendingPreviewResult(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, owner, preview, work uuid.UUID, at time.Time) (Result, error) {
	var raw []byte
	e := q.QueryRowContext(ctx, "SELECT id FROM work_submissions WHERE owner_id=? AND work_id=? AND preview_id=?", owner[:], work[:], preview[:]).Scan(&raw)
	if e != nil {
		return Result{}, e
	}
	id, e := uuid.FromBytes(raw)
	return Result{WorkID: work, ReviewStatus: "pre_review", SubmissionID: &id, SubmittedAt: &at}, e
}
func acceptWorkSubmission(ctx context.Context, tx *sql.Tx, owner, work uuid.UUID, p Preview, candidate uint64, now time.Time) (Result, error) {
	var old []byte
	first := now
	e := tx.QueryRowContext(ctx, "SELECT id,first_waiting_at FROM work_submissions WHERE work_id=? AND state='pending' FOR UPDATE", work[:]).Scan(&old, &first)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		return Result{}, e
	}
	if e == nil {
		if _, e = tx.ExecContext(ctx, "UPDATE work_submissions SET state='superseded',current_slot=NULL,decided_at=? WHERE id=?", now, old); e != nil {
			return Result{}, e
		}
	}
	id := uuid.New()
	if _, e = tx.ExecContext(ctx, "INSERT INTO work_submissions(id,work_id,owner_id,preview_id,candidate_version,accepted_at,first_waiting_at) VALUES(?,?,?,?,?,?,?)", id[:], work[:], owner[:], p.ID[:], candidate, now, first); e != nil {
		return Result{}, e
	}
	if _, e = tx.ExecContext(ctx, "UPDATE publication_previews SET consumed_work_id=?,consumed_version=NULL,consumed_at=? WHERE id=?", work[:], now, p.ID[:]); e != nil {
		return Result{}, e
	}
	if _, e = tx.ExecContext(ctx, "UPDATE works SET state_revision=state_revision+1 WHERE id=?", work[:]); e != nil {
		return Result{}, e
	}
	return Result{WorkID: work, ReviewStatus: "pre_review", SubmissionID: &id, SubmittedAt: &now}, nil
}

type WorkSubmission struct {
	ID               uuid.UUID  `json:"id"`
	WorkID           uuid.UUID  `json:"work_id"`
	PreviewID        uuid.UUID  `json:"preview_id"`
	CandidateVersion uint64     `json:"candidate_version"`
	State            string     `json:"state"`
	Title            string     `json:"title"`
	Reason           string     `json:"reason"`
	AcceptedAt       time.Time  `json:"accepted_at"`
	FirstWaitingAt   time.Time  `json:"first_waiting_at"`
	DecidedAt        *time.Time `json:"decided_at"`
}
type WorkSubmissionPage struct {
	Items      []WorkSubmission `json:"items"`
	NextCursor string           `json:"next_cursor"`
}
type WorkSubmissionDetail struct {
	Submission WorkSubmission `json:"submission"`
	Preview    Preview        `json:"preview"`
}

const submissionColumns = "s.id,s.work_id,s.preview_id,s.candidate_version,s.state,p.title,s.reason,s.accepted_at,s.first_waiting_at,s.decided_at"

func scanWorkSubmission(row interface{ Scan(...any) error }) (WorkSubmission, error) {
	var out WorkSubmission
	var id, work, preview []byte
	e := row.Scan(&id, &work, &preview, &out.CandidateVersion, &out.State, &out.Title, &out.Reason, &out.AcceptedAt, &out.FirstWaitingAt, &out.DecidedAt)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	if out.ID, e = uuid.FromBytes(id); e != nil {
		return out, e
	}
	if out.WorkID, e = uuid.FromBytes(work); e != nil {
		return out, e
	}
	out.PreviewID, e = uuid.FromBytes(preview)
	return out, e
}

type workSubmissionCursor struct {
	Owner, Work, ID uuid.UUID
	At              time.Time
	Ops             bool
}

func (s Store) WorkSubmissions(ctx context.Context, owner, work uuid.UUID, token string) (WorkSubmissionPage, error) {
	out := WorkSubmissionPage{Items: []WorkSubmission{}}
	if len(token) > 512 {
		return out, ErrInvalid
	}
	ops := owner == uuid.Nil
	var c workSubmissionCursor
	if token != "" {
		raw, e := base64.RawURLEncoding.DecodeString(token)
		if e != nil || json.Unmarshal(raw, &c) != nil || c.Owner != owner || c.Work != work || c.Ops != ops || c.ID == uuid.Nil || c.At.IsZero() {
			return out, ErrInvalid
		}
	}
	q := "SELECT " + submissionColumns + " FROM work_submissions s JOIN publication_previews p ON p.id=s.preview_id WHERE 1=1"
	args := []any{}
	at := "s.accepted_at"
	direction, compare := " DESC", "<"
	if ops {
		q += " AND s.state='pending'"
		at = "s.first_waiting_at"
		direction, compare = " ASC", ">"
	} else {
		q += " AND s.owner_id=?"
		args = append(args, owner[:])
	}
	if work != uuid.Nil {
		q += " AND s.work_id=?"
		args = append(args, work[:])
	}
	if token != "" {
		q += " AND (" + at + compare + "? OR (" + at + "=? AND s.id" + compare + "?))"
		args = append(args, c.At, c.At, c.ID[:])
	}
	rows, e := s.DB.QueryContext(ctx, q+" ORDER BY "+at+direction+",s.id"+direction+" LIMIT 21", args...)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		item, e := scanWorkSubmission(rows)
		if e != nil {
			return out, e
		}
		out.Items = append(out.Items, item)
	}
	if e = rows.Err(); e != nil {
		return out, e
	}
	if len(out.Items) > 20 {
		out.Items = out.Items[:20]
		last := out.Items[19]
		at := last.AcceptedAt
		if ops {
			at = last.FirstWaitingAt
		}
		raw, _ := json.Marshal(workSubmissionCursor{owner, work, last.ID, at, ops})
		out.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	return out, nil
}
func (s Store) WorkSubmissionDetail(ctx context.Context, owner, id uuid.UUID) (WorkSubmissionDetail, error) {
	var out WorkSubmissionDetail
	tx, e := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	q := "SELECT " + submissionColumns + " FROM work_submissions s JOIN publication_previews p ON p.id=s.preview_id WHERE s.id=?"
	args := []any{id[:]}
	if owner != uuid.Nil {
		q += " AND s.owner_id=?"
		args = append(args, owner[:])
	}
	out.Submission, e = scanWorkSubmission(tx.QueryRowContext(ctx, q, args...))
	if e != nil {
		return out, e
	}
	out.Preview, e = scanPreview(tx.QueryRowContext(ctx, "SELECT "+previewFields+" FROM publication_previews WHERE id=?", out.Submission.PreviewID[:]))
	if e != nil {
		return out, e
	}
	return out, tx.Commit()
}

type WorkSubmissionDecision struct {
	MutationID uuid.UUID `json:"mutation_id"`
	Decision   string    `json:"decision"`
	Reason     string    `json:"reason"`
}
type WorkSubmissionReceipt struct {
	MutationID   uuid.UUID `json:"mutation_id"`
	SubmissionID uuid.UUID `json:"submission_id"`
	WorkID       uuid.UUID `json:"work_id"`
	State        string    `json:"state"`
	Version      uint64    `json:"version"`
}

func lockSubmissionActors(ctx context.Context, tx *sql.Tx, owner, actor uuid.UUID) error {
	first, second := owner, actor
	if bytes.Compare(first[:], second[:]) > 0 {
		first, second = second, first
	}
	var raw []byte
	for _, id := range []uuid.UUID{first, second} {
		if e := tx.QueryRowContext(ctx, "SELECT id FROM accounts WHERE id=? FOR UPDATE", id[:]).Scan(&raw); e != nil {
			return e
		}
		if first == second {
			break
		}
	}
	return nil
}
func (s Store) DecideWorkSubmission(ctx context.Context, actor, id uuid.UUID, withdraw bool, in WorkSubmissionDecision) (WorkSubmissionReceipt, error) {
	var out WorkSubmissionReceipt
	if actor == uuid.Nil || id == uuid.Nil || in.MutationID == uuid.Nil || !utf8.ValidString(in.Reason) || utf8.RuneCountInString(in.Reason) > 2000 || (withdraw && (in.Decision != "withdraw" || in.Reason != "")) || (!withdraw && (in.Decision != "approve" && in.Decision != "reject")) || (in.Decision == "reject" && strings.TrimSpace(in.Reason) == "") {
		return out, ErrInvalid
	}
	var raw, workRaw []byte
	e := s.DB.QueryRowContext(ctx, "SELECT owner_id,work_id FROM work_submissions WHERE id=?", id[:]).Scan(&raw, &workRaw)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	owner, e := uuid.FromBytes(raw)
	if e != nil {
		return out, e
	}
	work, e := uuid.FromBytes(workRaw)
	if e != nil {
		return out, e
	}
	if withdraw && owner != actor {
		return out, ErrNotFound
	}
	hash, e := digest(struct {
		ID       uuid.UUID
		Input    WorkSubmissionDecision
		Withdraw bool
	}{id, in, withdraw})
	if e != nil {
		return out, e
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	if e = lockSubmissionActors(ctx, tx, owner, actor); e != nil {
		return out, e
	}
	if found, e := submissionRequest(ctx, tx, actor, in.MutationID, hash, &out); found || e != nil {
		if e != nil {
			return out, e
		}
		return out, tx.Commit()
	}
	state, e := scanState(tx.QueryRowContext(ctx, "SELECT "+stateFields+" FROM works WHERE id=? AND owner_id=? FOR UPDATE", work[:], owner[:]))
	if e != nil {
		return out, e
	}
	sub, e := scanWorkSubmission(tx.QueryRowContext(ctx, "SELECT "+submissionColumns+" FROM work_submissions s JOIN publication_previews p ON p.id=s.preview_id WHERE s.id=? FOR UPDATE", id[:]))
	if e != nil {
		return out, e
	}
	if sub.State != "pending" || state.LastVersion+1 != sub.CandidateVersion || state.StateRevision >= MaxSequence {
		return out, ErrReviewConflict
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	out = WorkSubmissionReceipt{MutationID: in.MutationID, SubmissionID: id, WorkID: work, State: "rejected"}
	if withdraw {
		out.State = "withdrawn"
	}
	if in.Decision == "approve" {
		p, e := scanPreview(tx.QueryRowContext(ctx, "SELECT "+previewFields+" FROM publication_previews WHERE id=?", sub.PreviewID[:]))
		if e != nil {
			return out, e
		}
		tags, _ := json.Marshal(p.Tags)
		if _, e = tx.ExecContext(ctx, "INSERT INTO work_versions(work_id,version,preview_id,title,content,introduction,tags,published_at) VALUES(?,?,?,?,?,?,?,?)", work[:], sub.CandidateVersion, p.ID[:], p.Title, p.Content, p.Introduction, tags, now); e != nil {
			return out, e
		}
		if _, e = tx.ExecContext(ctx, "UPDATE works SET last_version=?,display_version=?,state_revision=state_revision+1 WHERE id=?", sub.CandidateVersion, sub.CandidateVersion, work[:]); e != nil {
			return out, e
		}
		if _, e = tx.ExecContext(ctx, "INSERT INTO publication_review_tasks(work_id,version,state,first_waiting_at) VALUES(?,?,'approved',?)", work[:], sub.CandidateVersion, sub.FirstWaitingAt); e != nil {
			return out, e
		}
		out.State = "published"
		out.Version = sub.CandidateVersion
	} else {
		if _, e = tx.ExecContext(ctx, "UPDATE works SET state_revision=state_revision+1 WHERE id=?", work[:]); e != nil {
			return out, e
		}
	}
	if _, e = tx.ExecContext(ctx, "UPDATE work_submissions SET state=?,current_slot=NULL,reason=?,decided_at=? WHERE id=?", out.State, in.Reason, now, id[:]); e != nil {
		return out, e
	}
	if e = saveSubmissionRequest(ctx, tx, actor, in.MutationID, hash, out); e != nil {
		return out, e
	}
	return out, tx.Commit()
}
func (s Store) WorkSubmissionReceipt(ctx context.Context, actor, mutation uuid.UUID) (WorkSubmissionReceipt, error) {
	var out WorkSubmissionReceipt
	var raw []byte
	e := s.DB.QueryRowContext(ctx, "SELECT result FROM work_submission_requests WHERE actor_id=? AND mutation_id=?", actor[:], mutation[:]).Scan(&raw)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	if e = json.Unmarshal(raw, &out); e != nil {
		return out, e
	}
	if out.MutationID != mutation || out.SubmissionID == uuid.Nil {
		return out, ErrNotFound
	}
	return out, nil
}

func preReviewDraft(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, owner, draft uuid.UUID, now time.Time) (bool, error) {
	var required bool
	e := q.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM publication_policies WHERE owner_id=? AND observation_until>?) OR EXISTS(SELECT 1 FROM work_submissions s JOIN works w ON w.id=s.work_id WHERE s.owner_id=? AND w.source_draft_id=? AND s.state='pending')", owner[:], now, owner[:], draft[:]).Scan(&required)
	return required, e
}
