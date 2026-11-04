package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"writing.local/community/internal/draft"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/novel"
	"writing.local/community/internal/publication"
)

func TestWorkPreReviewHTTPStateAndRights(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("real MySQL required")
	}
	db, e := sql.Open("mysql", dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	ctx := context.Background()
	owner, other, operator := uuid.New(), uuid.New(), uuid.New()
	ids := []uuid.UUID{owner, other, operator}
	tokens := map[uuid.UUID]string{}
	for _, id := range ids {
		if _, e = db.Exec("INSERT INTO accounts(id,email,nickname) VALUES(?,?,?)", id[:], id.String()+"@example.test", "先审测试"); e != nil {
			t.Fatal(e)
		}
		tokens[id] = strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", "")
		if e = insertLegacySession(ctx, db, id, tokens[id]); e != nil {
			t.Fatal(e)
		}
	}
	defer func() {
		for _, id := range ids {
			for _, q := range []string{"DELETE FROM novel_author_policy_events WHERE owner_id=?", "DELETE FROM work_submission_requests WHERE actor_id=?", "DELETE FROM work_submissions WHERE owner_id=?", "DELETE FROM work_state_mutations WHERE owner_id=?", "DELETE e FROM work_events e JOIN works w ON w.id=e.work_id WHERE w.owner_id=?", "DELETE q FROM publication_review_tasks q JOIN works w ON w.id=q.work_id WHERE w.owner_id=?", "DELETE FROM publication_mutations WHERE owner_id=?", "DELETE v FROM work_versions v JOIN works w ON w.id=v.work_id WHERE w.owner_id=?", "DELETE FROM publication_previews WHERE owner_id=?", "DELETE FROM works WHERE owner_id=?", "DELETE FROM publication_policies WHERE owner_id=?", "DELETE FROM draft_mutations WHERE owner_id=?", "DELETE r FROM draft_revisions r JOIN drafts d ON d.id=r.draft_id WHERE d.owner_id=?", "DELETE FROM drafts WHERE owner_id=?", "DELETE FROM sessions WHERE account_id=?", "DELETE FROM accounts WHERE id=?"} {
				if _, e := db.Exec(q, id[:]); e != nil {
					t.Errorf("fixture cleanup failed: %v", e)
				}
			}
		}
	}()
	r := gin.New()
	if e = (API{DB: db, Drafts: draft.Store{DB: db}, Identity: &identity.Service{DB: db}, Origin: "http://localhost:3000", EnablePublications: true, OperatorAccounts: operator.String()}).Register(r); e != nil {
		t.Fatal(e)
	}
	call := func(method, path string, body any, actor uuid.UUID, want int) []byte {
		t.Helper()
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(method, path, strings.NewReader(string(raw)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "http://localhost:3000")
		if actor != uuid.Nil {
			req.AddCookie(&http.Cookie{Name: "tako_session", Value: tokens[actor]})
		}
		out := httptest.NewRecorder()
		r.ServeHTTP(out, req)
		validateResponse(t, req, out)
		if out.Code != want {
			var f struct {
				Error string `json:"error"`
			}
			json.Unmarshal(out.Body.Bytes(), &f)
			t.Fatalf("status %d want %d code %s", out.Code, want, f.Error)
		}
		return out.Body.Bytes()
	}
	ds := draft.Store{DB: db}
	ps := publication.Store{DB: db}
	d, e := ds.Write(ctx, owner, "create", draft.Write{MutationID: uuid.New(), Title: "先审初稿", Content: "固定正文R1😀"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("INSERT INTO publication_policies(owner_id,observation_until) VALUES(?,DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 7 DAY))", owner[:]); e != nil {
		t.Fatal(e)
	}
	prepare := func() publication.Preview {
		t.Helper()
		return novelResult[publication.Preview](t, call("POST", "/api/publication-previews", publication.Prepare{MutationID: uuid.New(), DraftID: d.DraftID, SourceRevision: d.Revision, Tags: []string{"幻想"}, RightsConfirmed: true}, owner, 200))
	}
	publish := func(p publication.Preview) publication.Result {
		t.Helper()
		return novelResult[publication.Result](t, call("POST", "/api/publications", publication.Publish{MutationID: uuid.New(), PreviewID: p.ID, ExpectedVersion: p.ExpectedVersion}, owner, 200))
	}
	p := prepare()
	if !p.ReviewRequired {
		t.Fatal("pre-review warning missing")
	}
	input := publication.Publish{MutationID: uuid.New(), PreviewID: p.ID, ExpectedVersion: 0}
	pending := novelResult[publication.Result](t, call("POST", "/api/publications", input, owner, 200))
	if pending.ReviewStatus != "pre_review" || pending.Version != 0 || pending.SubmissionID == nil || pending.SubmittedAt == nil || !pending.PublishedAt.IsZero() {
		t.Fatal("pending represented as formal")
	}
	retry := novelResult[publication.Result](t, call("POST", "/api/publications", input, owner, 200))
	if retry.SubmissionID == nil || *retry.SubmissionID != *pending.SubmissionID {
		t.Fatal("pending retry duplicated")
	}
	preview := novelResult[publication.Preview](t, call("GET", "/api/publication-previews/"+p.ID.String(), nil, owner, 200))
	if preview.Published == nil || preview.Published.Version != 0 || preview.Published.ReviewStatus != "pre_review" {
		t.Fatal("pending recovery wrong")
	}
	root := "/api/my/work-submissions/"
	ops := "/api/ops/work-submissions/"
	get := func(id uuid.UUID) publication.WorkSubmissionDetail {
		return novelResult[publication.WorkSubmissionDetail](t, call("GET", root+id.String(), nil, owner, 200))
	}
	first := get(*pending.SubmissionID)
	call("GET", root+pending.SubmissionID.String(), nil, other, 404)
	call("GET", root+pending.SubmissionID.String(), nil, uuid.Nil, 401)
	call("GET", strings.TrimSuffix(ops, "/"), nil, owner, 403)
	call("GET", "/api/works/"+pending.WorkID.String(), nil, uuid.Nil, 404)
	d, e = ds.Write(ctx, owner, "save", draft.Write{MutationID: uuid.New(), DraftID: d.DraftID, BaseRevision: 1, Title: "后来的私稿R2", Content: "固定正文R2"})
	if e != nil {
		t.Fatal(e)
	}
	if get(*pending.SubmissionID).Preview.Content != "固定正文R1😀" {
		t.Fatal("pending changed with draft")
	}
	second := publish(prepare())
	if get(*pending.SubmissionID).Submission.State != "superseded" {
		t.Fatal("old submission not superseded")
	}
	if !get(*second.SubmissionID).Submission.FirstWaitingAt.Equal(first.Submission.FirstWaitingAt) {
		t.Fatal("replacement reset waiting")
	}
	call("POST", ops+pending.SubmissionID.String()+"/review", publication.WorkSubmissionDecision{MutationID: uuid.New(), Decision: "approve"}, operator, 409)
	if _, e = db.Exec("UPDATE publication_policies SET observation_until=NULL WHERE owner_id=?", owner[:]); e != nil {
		t.Fatal(e)
	}
	third := publish(prepare())
	if third.ReviewStatus != "pre_review" || third.Version != 0 {
		t.Fatal("revoke bypassed review")
	}
	call("POST", ops+third.SubmissionID.String()+"/review", publication.WorkSubmissionDecision{MutationID: uuid.New(), Decision: "reject", Reason: " "}, operator, 400)
	call("POST", ops+third.SubmissionID.String()+"/review", publication.WorkSubmissionDecision{MutationID: uuid.New(), Decision: "reject", Reason: "请补全内容"}, operator, 200)
	if get(*third.SubmissionID).Submission.Reason != "请补全内容" {
		t.Fatal("reject reason missing")
	}
	if _, e = db.Exec("UPDATE publication_policies SET observation_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 7 DAY) WHERE owner_id=?", owner[:]); e != nil {
		t.Fatal(e)
	}
	fourth := publish(prepare())
	state, e := ps.AuthorState(ctx, owner, fourth.WorkID)
	if e != nil {
		t.Fatal(e)
	}
	_, e = ps.Change(ctx, owner, fourth.WorkID, publication.Change{MutationID: uuid.New(), ExpectedStateRevision: state.StateRevision, Action: "hide"})
	if e != nil {
		t.Fatal(e)
	}
	decision := publication.WorkSubmissionDecision{MutationID: uuid.New(), Decision: "approve"}
	approved := novelResult[publication.WorkSubmissionReceipt](t, call("POST", ops+fourth.SubmissionID.String()+"/review", decision, operator, 200))
	if approved.Version != 1 || approved.State != "published" {
		t.Fatal("approval failed")
	}
	call("POST", ops+fourth.SubmissionID.String()+"/review", decision, operator, 200)
	call("GET", "/api/work-submission-requests/"+decision.MutationID.String(), nil, operator, 200)
	call("GET", "/api/work-submission-requests/"+decision.MutationID.String(), nil, owner, 404)
	call("GET", "/api/works/"+fourth.WorkID.String(), nil, uuid.Nil, 404)
	state, _ = ps.AuthorState(ctx, owner, fourth.WorkID)
	if !state.AuthorHidden {
		t.Fatal("approval cleared hiding")
	}
	_, e = ps.Change(ctx, owner, fourth.WorkID, publication.Change{MutationID: uuid.New(), ExpectedStateRevision: state.StateRevision, Action: "restore"})
	if e != nil {
		t.Fatal(e)
	}
	call("GET", "/api/works/"+fourth.WorkID.String(), nil, uuid.Nil, 200)
	// Operator policy is available for middle-only authors and still affects the same account.
	call("GET", "/api/ops/works/"+fourth.WorkID.String()+"/author-policy", nil, operator, 200)
	call("GET", "/api/my/author-policy", nil, owner, 200)
	policyRoot := "/api/ops/works/" + fourth.WorkID.String() + "/author-policy"
	extended := novelResult[novel.AuthorPolicyEvent](t, call("POST", policyRoot, novel.AuthorPolicyAction{MutationID: uuid.New(), ExpectedRevision: 0, Action: "extend", Reason: "中篇正式内容确认违规后延长"}, operator, 200))
	if extended.ContextKind != "work" || extended.ContextID != fourth.WorkID {
		t.Fatal("work policy context wrong")
	}
	call("POST", policyRoot, novel.AuthorPolicyAction{MutationID: uuid.New(), ExpectedRevision: 1, Action: "revoke", Reason: "中篇账号提前结束观察"}, operator, 200)
	call("POST", policyRoot, novel.AuthorPolicyAction{MutationID: uuid.New(), ExpectedRevision: 2, Action: "start", Reason: "再次确认开始观察"}, operator, 200)
	// Concurrent approval and withdrawal cannot both succeed.
	fifth := publish(prepare())
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for _, withdraw := range []bool{false, true} {
		wg.Add(1)
		go func(withdraw bool) {
			defer wg.Done()
			actor, decision := operator, "approve"
			if withdraw {
				actor = owner
				decision = "withdraw"
			}
			_, e := ps.DecideWorkSubmission(ctx, actor, *fifth.SubmissionID, withdraw, publication.WorkSubmissionDecision{MutationID: uuid.New(), Decision: decision})
			results <- e
		}(withdraw)
	}
	wg.Wait()
	close(results)
	ok, conflict := 0, 0
	for e := range results {
		if e == nil {
			ok++
		} else if errors.Is(e, publication.ErrReviewConflict) {
			conflict++
		} else {
			t.Fatal(e)
		}
	}
	if ok != 1 || conflict != 1 {
		t.Fatal("withdraw approve race")
	}
	// A pending replacement stream remains one candidate and supports stable owner pagination.
	for range 21 {
		publish(prepare())
	}
	page := novelResult[publication.WorkSubmissionPage](t, call("GET", "/api/my/work-submissions", nil, owner, 200))
	if len(page.Items) != 20 || page.NextCursor == "" {
		t.Fatal("submission paging")
	}
	call("GET", "/api/my/work-submissions?cursor="+page.NextCursor, nil, other, 400)
	call("GET", "/api/ops/work-submissions?cursor="+page.NextCursor, nil, operator, 400)
	next := novelResult[publication.WorkSubmissionPage](t, call("GET", "/api/my/work-submissions?cursor="+page.NextCursor, nil, owner, 200))
	if len(next.Items) != 6 || next.NextCursor != "" {
		t.Fatal("submission second page")
	}
	var count int
	if e = db.QueryRow("SELECT COUNT(*) FROM work_submissions WHERE work_id=? AND state='pending'", fifth.WorkID[:]).Scan(&count); e != nil || count != 1 {
		t.Fatal("multiple current pending")
	}
}
