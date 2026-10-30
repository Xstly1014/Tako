package publication

import (
	"context"
	"database/sql"
	"errors"
	"github.com/google/uuid"
)

const taskColumns = "t.task_id,t.work_id,t.version,t.revision,t.state,t.first_waiting_at,(w.display_version=t.version),v.title"

func scanTask(row interface{ Scan(...any) error }) (ReviewTask, error) {
	var t ReviewTask
	var b []byte
	e := row.Scan(&t.ID, &b, &t.Version, &t.Revision, &t.State, &t.FirstWaitingAt, &t.IsCurrent, &t.Title)
	if errors.Is(e, sql.ErrNoRows) {
		return t, ErrNotFound
	}
	if e != nil {
		return t, e
	}
	t.WorkID, e = uuid.FromBytes(b)
	return t, e
}
func (s Store) Reviews(ctx context.Context, after uint64) (ReviewPage, error) {
	out := ReviewPage{Items: []ReviewTask{}}
	rows, e := s.DB.QueryContext(ctx, "SELECT "+taskColumns+" FROM publication_review_tasks t JOIN works w ON w.id=t.work_id JOIN work_versions v ON v.work_id=t.work_id AND v.version=t.version WHERE t.state='pending' AND t.task_id>? ORDER BY t.task_id LIMIT 21", after)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		t, e := scanTask(rows)
		if e != nil {
			return out, e
		}
		out.Items = append(out.Items, t)
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
func (s Store) ReviewDetail(ctx context.Context, work uuid.UUID, version uint64) (ReviewDetail, error) {
	var out ReviewDetail
	t, e := scanTask(s.DB.QueryRowContext(ctx, "SELECT "+taskColumns+" FROM publication_review_tasks t JOIN works w ON w.id=t.work_id JOIN work_versions v ON v.work_id=t.work_id AND v.version=t.version WHERE t.work_id=? AND t.version=?", work[:], version))
	if e != nil {
		return out, e
	}
	owner, e := s.moderationOwner(ctx, work)
	if e != nil {
		return out, e
	}
	body, e := s.AuthorVersion(ctx, owner, work, version)
	return ReviewDetail{Task: t, Work: body}, e
}
func (s Store) Cases(ctx context.Context, owner uuid.UUID, before uint64) (CasePage, error) {
	out := CasePage{Items: []ModerationCase{}}
	rows, e := s.DB.QueryContext(ctx, "SELECT "+caseColumns+" FROM moderation_cases WHERE (?=TRUE OR owner_id=?) AND (?=0 OR id<?) ORDER BY id DESC LIMIT 21", owner == uuid.Nil, owner[:], before, before)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		c, e := scanCase(rows)
		if e != nil {
			return out, e
		}
		out.Items = append(out.Items, c)
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

const appealColumns = "id,case_id,reason,state,decision_reason,created_at,decided_at"

func scanAppeal(row interface{ Scan(...any) error }) (ModerationAppeal, error) {
	var a ModerationAppeal
	e := row.Scan(&a.ID, &a.CaseID, &a.Reason, &a.State, &a.DecisionReason, &a.CreatedAt, &a.DecidedAt)
	return a, e
}
func (s Store) Appeals(ctx context.Context, caseID, before uint64, pendingOnly bool) (AppealPage, error) {
	out := AppealPage{Items: []ModerationAppeal{}}
	comparison, order := "<", "DESC"
	if pendingOnly {
		comparison, order = ">", "ASC"
	}
	rows, e := s.DB.QueryContext(ctx, "SELECT "+appealColumns+" FROM moderation_appeals WHERE (?=0 OR case_id=?) AND (?=0 OR id"+comparison+"?) AND (?=FALSE OR state='pending') ORDER BY id "+order+" LIMIT 21", caseID, caseID, before, before, pendingOnly)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		a, e := scanAppeal(rows)
		if e != nil {
			return out, e
		}
		out.Items = append(out.Items, a)
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

// owner=nil is reserved for an operator-authorized HTTP route.
func (s Store) ModerationCase(ctx context.Context, owner *uuid.UUID, id, before uint64) (CaseDetail, error) {
	var out CaseDetail
	o, _, e := s.caseOwner(ctx, id)
	if e != nil {
		return out, e
	}
	if owner != nil && *owner != o {
		return out, ErrNotFound
	}
	out.Case, e = scanCase(s.DB.QueryRowContext(ctx, "SELECT "+caseColumns+" FROM moderation_cases WHERE id=?", id))
	if e != nil {
		return out, e
	}
	out.Work, e = s.AuthorVersion(ctx, o, out.Case.WorkID, out.Case.Version)
	if e != nil {
		return out, e
	}
	out.Appeals, e = s.Appeals(ctx, id, before, false)
	if e == nil && out.Case.State == "revoked" {
		var result ModerationRevocation
		e = s.DB.QueryRowContext(ctx, "SELECT reason,created_at FROM moderation_mutations WHERE work_id=? AND kind='case' AND JSON_UNQUOTE(JSON_EXTRACT(result,'$.state'))='revoked' AND CAST(JSON_UNQUOTE(JSON_EXTRACT(result,'$.id')) AS UNSIGNED)=? ORDER BY created_at DESC LIMIT 1", out.Case.WorkID[:], id).Scan(&result.Reason, &result.CreatedAt)
		if e == nil {
			out.Revocation = &result
		}
	}
	return out, e
}
