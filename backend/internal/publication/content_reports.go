package publication

import (
	"context"
	"database/sql"
	"errors"
	"github.com/google/uuid"
	"strings"
	"time"
	"unicode/utf8"
)

type ContentReport struct {
	ID        uint64     `json:"id"`
	WorkID    uuid.UUID  `json:"work_id"`
	Version   uint64     `json:"version"`
	Reason    string     `json:"reason"`
	State     string     `json:"state"`
	Revision  uint64     `json:"revision"`
	Outcome   string     `json:"outcome"`
	Response  string     `json:"response"`
	CaseID    *uint64    `json:"case_id,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	DecidedAt *time.Time `json:"decided_at"`
}
type ContentReportPage struct {
	Items []ContentReport `json:"items"`
	Next  uint64          `json:"next"`
}
type ReportDecision struct {
	ExpectedRevision uint64  `json:"expected_revision"`
	Outcome          string  `json:"outcome"`
	Response         string  `json:"response"`
	CaseID           *uint64 `json:"case_id"`
}

const reportColumns = "id,work_id,version,reason,state,revision,outcome,response,case_id,created_at,decided_at"

type reportScanner interface{ Scan(...any) error }

func scanReport(row reportScanner) (ContentReport, error) {
	var out ContentReport
	var work []byte
	e := row.Scan(&out.ID, &work, &out.Version, &out.Reason, &out.State, &out.Revision, &out.Outcome, &out.Response, &out.CaseID, &out.CreatedAt, &out.DecidedAt)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	out.WorkID, e = uuid.FromBytes(work)
	return out, e
}
func validReportText(text string) bool {
	return utf8.ValidString(text) && strings.TrimSpace(text) != "" && utf8.RuneCountInString(text) <= 2000
}

// Semantic idempotency is (session account, immutable work version), not a client owner id.
func (s Store) CreateContentReport(ctx context.Context, actor, work uuid.UUID, version uint64, reason string) (ContentReport, error) {
	if actor == uuid.Nil || work == uuid.Nil || version == 0 || version > MaxSequence || !validReportText(reason) {
		return ContentReport{}, ErrInvalid
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return ContentReport{}, e
	}
	defer tx.Rollback()
	if e = lockOwner(ctx, tx, actor); e != nil {
		return ContentReport{}, e
	}
	out, e := scanReport(tx.QueryRowContext(ctx, "SELECT "+reportColumns+" FROM content_reports WHERE reporter_id=? AND work_id=? AND version=?", actor[:], work[:], version))
	if e == nil {
		out.CaseID = nil
		return out, tx.Commit()
	}
	if !errors.Is(e, ErrNotFound) {
		return out, e
	}
	var found uint64
	e = tx.QueryRowContext(ctx, `SELECT v.version FROM works w JOIN work_versions v ON v.work_id=w.id
 WHERE w.id=? AND v.version=? AND w.author_hidden=FALSE AND w.platform_limited=FALSE AND v.platform_limited=FALSE
 AND (v.version=w.display_version OR w.history_open=TRUE) FOR SHARE`, work[:], version).Scan(&found)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	result, e := tx.ExecContext(ctx, "INSERT INTO content_reports(reporter_id,work_id,version,reason,response,created_at) VALUES(?,?,?,?,'',?)", actor[:], work[:], version, strings.TrimSpace(reason), now)
	if e != nil {
		return out, e
	}
	id, e := result.LastInsertId()
	if e != nil {
		return out, e
	}
	out, e = scanReport(tx.QueryRowContext(ctx, "SELECT "+reportColumns+" FROM content_reports WHERE id=?", id))
	if e != nil {
		return out, e
	}
	return out, tx.Commit()
}
func (s Store) ContentReport(ctx context.Context, owner *uuid.UUID, id uint64) (ContentReport, error) {
	q := "SELECT " + reportColumns + " FROM content_reports WHERE id=?"
	args := []any{id}
	if owner != nil {
		q += " AND reporter_id=?"
		args = append(args, (*owner)[:])
	}
	out, e := scanReport(s.DB.QueryRowContext(ctx, q, args...))
	if owner != nil {
		out.CaseID = nil
	}
	return out, e
}
func (s Store) ContentReports(ctx context.Context, owner *uuid.UUID, before uint64, state string) (ContentReportPage, error) {
	out := ContentReportPage{Items: []ContentReport{}}
	if before > MaxSequence || (state != "all" && state != "pending" && state != "resolved") {
		return out, ErrInvalid
	}
	q := "SELECT " + reportColumns + " FROM content_reports WHERE (?=0 OR id<?) AND (?='all' OR state=?)"
	args := []any{before, before, state, state}
	if owner != nil {
		q += " AND reporter_id=?"
		args = append(args, (*owner)[:])
	}
	rows, e := s.DB.QueryContext(ctx, q+" ORDER BY id DESC LIMIT 21", args...)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		item, e := scanReport(rows)
		if e != nil {
			return out, e
		}
		if owner != nil {
			item.CaseID = nil
		}
		out.Items = append(out.Items, item)
	}
	if e = rows.Err(); e != nil {
		return out, e
	}
	if len(out.Items) > 20 {
		out.Items = out.Items[:20]
		out.Next = out.Items[19].ID
	}
	return out, nil
}
func (s Store) ResolveContentReport(ctx context.Context, actor uuid.UUID, id uint64, in ReportDecision) (ContentReport, error) {
	if actor == uuid.Nil || in.ExpectedRevision == 0 || in.ExpectedRevision > MaxSequence || !validReportText(in.Response) ||
		(in.Outcome != "dismissed" && in.Outcome != "handled") || (in.Outcome == "handled" && (in.CaseID == nil || *in.CaseID == 0)) || (in.Outcome == "dismissed" && in.CaseID != nil) {
		return ContentReport{}, ErrInvalid
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return ContentReport{}, e
	}
	defer tx.Rollback()
	out, e := scanReport(tx.QueryRowContext(ctx, "SELECT "+reportColumns+" FROM content_reports WHERE id=? FOR UPDATE", id))
	if e != nil {
		return out, e
	}
	sameCase := out.CaseID == nil && in.CaseID == nil || out.CaseID != nil && in.CaseID != nil && *out.CaseID == *in.CaseID
	if out.State == "resolved" {
		if out.Revision == in.ExpectedRevision+1 && out.Outcome == in.Outcome && out.Response == strings.TrimSpace(in.Response) && sameCase {
			return out, tx.Commit()
		}
		return out, ErrReviewConflict
	}
	if out.Revision != in.ExpectedRevision || out.Revision >= MaxSequence {
		return out, ErrReviewConflict
	}
	if in.CaseID != nil {
		var found uint64
		e = tx.QueryRowContext(ctx, "SELECT id FROM moderation_cases WHERE id=? AND work_id=? AND state='active' AND (scope='work' OR version=?) FOR SHARE", *in.CaseID, out.WorkID[:], out.Version).Scan(&found)
		if errors.Is(e, sql.ErrNoRows) {
			return out, ErrReviewConflict
		}
		if e != nil {
			return out, e
		}
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	_, e = tx.ExecContext(ctx, "UPDATE content_reports SET state='resolved',revision=revision+1,outcome=?,response=?,case_id=?,operator_id=?,decided_at=? WHERE id=?", in.Outcome, strings.TrimSpace(in.Response), in.CaseID, actor[:], now, id)
	if e != nil {
		return out, e
	}
	out, e = scanReport(tx.QueryRowContext(ctx, "SELECT "+reportColumns+" FROM content_reports WHERE id=?", id))
	if e != nil {
		return out, e
	}
	return out, tx.Commit()
}
