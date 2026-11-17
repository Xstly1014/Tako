package shortpost

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
	ID           uint64     `json:"id"`
	PostID       uuid.UUID  `json:"post_id"`
	Version      uint64     `json:"version"`
	Reason       string     `json:"reason"`
	State        string     `json:"state"`
	Revision     uint64     `json:"revision"`
	Outcome      string     `json:"outcome"`
	Response     string     `json:"response"`
	CaseRevision *uint64    `json:"case_revision,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	DecidedAt    *time.Time `json:"decided_at"`
}
type ContentReportPage struct {
	Items []ContentReport `json:"items"`
	Next  uint64          `json:"next"`
}
type ReportDecision struct {
	ExpectedRevision uint64  `json:"expected_revision"`
	Outcome          string  `json:"outcome"`
	Response         string  `json:"response"`
	CaseRevision     *uint64 `json:"case_revision"`
}

const reportColumns = "id,post_id,version,reason,state,revision,outcome,response,case_revision,created_at,decided_at"

type reportScanner interface{ Scan(...any) error }

func scanReport(row reportScanner) (ContentReport, error) {
	var out ContentReport
	var work []byte
	e := row.Scan(&out.ID, &work, &out.Version, &out.Reason, &out.State, &out.Revision, &out.Outcome, &out.Response, &out.CaseRevision, &out.CreatedAt, &out.DecidedAt)
	if errors.Is(e, sql.ErrNoRows) {
		return out, sql.ErrNoRows
	}
	if e != nil {
		return out, e
	}
	out.PostID, e = uuid.FromBytes(work)
	return out, e
}
func validReportText(text string) bool {
	return utf8.ValidString(text) && strings.TrimSpace(text) != "" && utf8.RuneCountInString(text) <= 2000
}

// Semantic idempotency is (session account, immutable work version), not a client owner id.
func (s PostStore) CreateContentReport(ctx context.Context, actor, work uuid.UUID, version uint64, reason string) (ContentReport, error) {
	if actor == uuid.Nil || work == uuid.Nil || version == 0 || version > maxPostRevision || !validReportText(reason) {
		return ContentReport{}, ErrInvalidAction
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return ContentReport{}, e
	}
	defer tx.Rollback()
	var locked uuid.UUID
	if e = tx.QueryRowContext(ctx, "SELECT id FROM accounts WHERE id=? FOR UPDATE", actor[:]).Scan(&locked); e != nil {
		return ContentReport{}, e
	}
	out, e := scanReport(tx.QueryRowContext(ctx, "SELECT "+reportColumns+" FROM short_post_reports WHERE reporter_id=? AND post_id=? AND version=?", actor[:], work[:], version))
	if e == nil {
		out.CaseRevision = nil
		return out, tx.Commit()
	}
	if !errors.Is(e, sql.ErrNoRows) {
		return out, e
	}
	var found uint64
	e = tx.QueryRowContext(ctx, `SELECT v.version FROM short_posts s JOIN short_post_versions v ON v.post_id=s.id
 WHERE s.id=? AND v.version=? AND s.first_published_at IS NOT NULL AND s.author_hidden=FALSE AND s.platform_limited=FALSE AND v.platform_limited=FALSE
 AND (v.version=s.display_version OR s.history_enabled=TRUE) FOR SHARE`, work[:], version).Scan(&found)
	if errors.Is(e, sql.ErrNoRows) {
		return out, sql.ErrNoRows
	}
	if e != nil {
		return out, e
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	result, e := tx.ExecContext(ctx, "INSERT INTO short_post_reports(reporter_id,post_id,version,reason,response,created_at) VALUES(?,?,?,?,'',?)", actor[:], work[:], version, strings.TrimSpace(reason), now)
	if e != nil {
		return out, e
	}
	id, e := result.LastInsertId()
	if e != nil {
		return out, e
	}
	out, e = scanReport(tx.QueryRowContext(ctx, "SELECT "+reportColumns+" FROM short_post_reports WHERE id=?", id))
	if e != nil {
		return out, e
	}
	return out, tx.Commit()
}
func (s PostStore) ContentReport(ctx context.Context, owner *uuid.UUID, id uint64) (ContentReport, error) {
	q := "SELECT " + reportColumns + " FROM short_post_reports WHERE id=?"
	args := []any{id}
	if owner != nil {
		q += " AND reporter_id=?"
		args = append(args, (*owner)[:])
	}
	out, e := scanReport(s.DB.QueryRowContext(ctx, q, args...))
	if owner != nil {
		out.CaseRevision = nil
	}
	return out, e
}
func (s PostStore) ContentReports(ctx context.Context, owner *uuid.UUID, before uint64, state string) (ContentReportPage, error) {
	out := ContentReportPage{Items: []ContentReport{}}
	if before > maxPostRevision || (state != "all" && state != "pending" && state != "resolved") {
		return out, ErrInvalidAction
	}
	q := "SELECT " + reportColumns + " FROM short_post_reports WHERE (?=0 OR id<?) AND (?='all' OR state=?)"
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
			item.CaseRevision = nil
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
func (s PostStore) ResolveContentReport(ctx context.Context, actor uuid.UUID, id uint64, in ReportDecision) (ContentReport, error) {
	if actor == uuid.Nil || in.ExpectedRevision == 0 || in.ExpectedRevision > maxPostRevision || !validReportText(in.Response) ||
		(in.Outcome != "dismissed" && in.Outcome != "handled") || (in.Outcome == "handled" && (in.CaseRevision == nil || *in.CaseRevision == 0)) || (in.Outcome == "dismissed" && in.CaseRevision != nil) {
		return ContentReport{}, ErrInvalidAction
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return ContentReport{}, e
	}
	defer tx.Rollback()
	// Restriction writers lock the post first. Preserve the same order for revocation races.
	var post uuid.UUID
	if e = tx.QueryRowContext(ctx, "SELECT post_id FROM short_post_reports WHERE id=?", id).Scan(&post); e != nil {
		return ContentReport{}, e
	}
	var locked uuid.UUID
	if e = tx.QueryRowContext(ctx, "SELECT id FROM short_posts WHERE id=? FOR UPDATE", post[:]).Scan(&locked); e != nil {
		return ContentReport{}, e
	}
	out, e := scanReport(tx.QueryRowContext(ctx, "SELECT "+reportColumns+" FROM short_post_reports WHERE id=? FOR UPDATE", id))
	if e != nil {
		return out, e
	}
	sameCase := out.CaseRevision == nil && in.CaseRevision == nil || out.CaseRevision != nil && in.CaseRevision != nil && *out.CaseRevision == *in.CaseRevision
	if out.State == "resolved" {
		if out.Revision == in.ExpectedRevision+1 && out.Outcome == in.Outcome && out.Response == strings.TrimSpace(in.Response) && sameCase {
			return out, tx.Commit()
		}
		return out, ErrStateConflict
	}
	if out.Revision != in.ExpectedRevision || out.Revision >= maxPostRevision {
		return out, ErrStateConflict
	}
	if in.CaseRevision != nil {
		version, err := activeAppealCase(ctx, tx, out.PostID, *in.CaseRevision)
		if errors.Is(err, sql.ErrNoRows) || errors.Is(err, ErrStateConflict) || (err == nil && version != nil && *version != out.Version) {
			return out, ErrStateConflict
		}
		if err != nil {
			return out, err
		}
	}

	now := time.Now().UTC().Truncate(time.Microsecond)
	_, e = tx.ExecContext(ctx, "UPDATE short_post_reports SET state='resolved',revision=revision+1,outcome=?,response=?,case_revision=?,operator_id=?,decided_at=? WHERE id=?", in.Outcome, strings.TrimSpace(in.Response), in.CaseRevision, actor[:], now, id)
	if e != nil {
		return out, e
	}
	out, e = scanReport(tx.QueryRowContext(ctx, "SELECT "+reportColumns+" FROM short_post_reports WHERE id=?", id))
	if e != nil {
		return out, e
	}
	return out, tx.Commit()
}
