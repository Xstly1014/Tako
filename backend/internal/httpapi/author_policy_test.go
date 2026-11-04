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
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
	"writing.local/community/internal/draft"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/novel"
)

func TestNovelAuthorObservationPolicy(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("real MySQL required")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	s := novel.Store{DB: db}
	owner, other, operator := uuid.New(), uuid.New(), uuid.New()
	ids := []uuid.UUID{owner, other, operator}
	tokens := map[uuid.UUID]string{}
	for _, id := range ids {
		if _, err = db.Exec("INSERT INTO accounts(id,email,nickname) VALUES(?,?,?)", id[:], id.String()+"@example.test", "正式资料测试"); err != nil {
			t.Fatal(err)
		}
		tokens[id] = strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", "")
		if err = insertLegacySession(ctx, db, id, tokens[id]); err != nil {
			t.Fatal(err)
		}
	}
	defer func() {
		for _, id := range ids {
			for _, q := range []string{"DELETE FROM novel_author_policy_events WHERE actor_id=?", "DELETE FROM novel_management_requests WHERE actor_id=?", "DELETE FROM novel_publication_requests WHERE owner_id=?"} {
				if _, e := db.Exec(q, id[:]); e != nil {
					t.Errorf("receipt cleanup: %v", e)
				}
			}
		}
		for _, id := range ids {
			for _, q := range []string{
				"DELETE a FROM novel_moderation_appeals a JOIN novel_moderation_cases c ON c.id=a.case_id WHERE c.owner_id=?", "DELETE FROM novel_moderation_cases WHERE owner_id=?",
				"DELETE FROM novel_metadata_versions WHERE owner_id=?", "DELETE FROM novel_metadata_submissions WHERE owner_id=?",
				"DELETE FROM chapter_release_events WHERE owner_id=?", "DELETE FROM chapter_post_review_tasks WHERE owner_id=?", "DELETE FROM chapter_versions WHERE owner_id=?", "DELETE FROM chapter_submissions WHERE owner_id=?", "DELETE FROM chapter_previews WHERE owner_id=?", "DELETE FROM novel_publications WHERE owner_id=?",
				"UPDATE novel_chapters SET primary_draft_id=NULL WHERE owner_id=?", "UPDATE chapter_drafts SET recovered_from_id=NULL WHERE owner_id=?", "DELETE FROM chapter_draft_mutations WHERE owner_id=?", "DELETE FROM chapter_drafts WHERE owner_id=?", "DELETE FROM novel_chapters WHERE owner_id=?", "DELETE FROM novel_mutations WHERE owner_id=?", "DELETE FROM novels WHERE owner_id=?", "DELETE FROM publication_policies WHERE owner_id=?", "DELETE FROM sessions WHERE account_id=?", "DELETE FROM accounts WHERE id=?",
			} {
				if _, e := db.Exec(q, id[:]); e != nil {
					t.Errorf("fixture cleanup: %v", e)
				}
			}
		}
	}()
	r := gin.New()
	if err = (API{DB: db, Drafts: draft.Store{DB: db}, Identity: &identity.Service{DB: db}, Origin: "http://localhost:3000", EnablePublications: true, OperatorAccounts: operator.String()}).Register(r); err != nil {
		t.Fatal(err)
	}
	call := func(method, path string, body any, who uuid.UUID, want int) []byte {
		t.Helper()
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(method, path, strings.NewReader(string(raw)))
		req.Header.Set("Origin", "http://localhost:3000")
		req.Header.Set("Content-Type", "application/json")
		if who != uuid.Nil {
			req.AddCookie(&http.Cookie{Name: "tako_session", Value: tokens[who]})
		}
		out := httptest.NewRecorder()
		r.ServeHTTP(out, req)
		validateResponse(t, req, out)
		if out.Code != want {
			var failure struct {
				Error string `json:"error"`
			}
			json.Unmarshal(out.Body.Bytes(), &failure)
			t.Fatalf("%s status %d want %d code %s", method, out.Code, want, failure.Error)
		}
		return out.Body.Bytes()
	}
	book, err := s.Write(ctx, owner, uuid.Nil, novel.Write{MutationID: uuid.New(), Title: "第一份公开资料", Tags: []string{"幻想"}})
	if err != nil {
		t.Fatal(err)
	}
	root := "/api/my/novels/" + book.ID.String()
	ops := "/api/ops/novels/" + book.ID.String() + "/author-policy"
	call("GET", root+"/author-policy", nil, other, 404)
	call("GET", root+"/author-policy", nil, uuid.Nil, 401)
	call("GET", ops, nil, owner, 403)
	call("GET", ops, nil, operator, 404) // no private book discovery for operators
	chapter := uuid.New()
	ds := draft.Store{DB: db, Chapter: &draft.ChapterScope{NovelID: book.ID, ChapterID: chapter}}
	d, e := ds.Write(ctx, owner, "create", draft.Write{MutationID: uuid.New(), Title: "策略测试第一章", Content: "固定正式内容"})
	if e != nil {
		t.Fatal(e)
	}
	p, e := s.PrepareChapter(ctx, owner, book.ID, novel.PrepareChapter{MutationID: uuid.New(), DraftID: d.DraftID, SourceRevision: d.Revision, BookRevision: book.Revision})
	if e != nil {
		t.Fatal(e)
	}
	_, e = s.SubmitChapter(ctx, owner, book.ID, novel.SubmitChapter{MutationID: uuid.New(), PreviewID: p.PreviewID, RightsConfirmed: true})
	if e != nil {
		t.Fatal(e)
	}
	state := novelResult[novel.AuthorPolicyPage](t, call("GET", ops, nil, operator, 200))
	if state.Policy.Active || state.Policy.Revision != 0 || len(state.Items) != 0 {
		t.Fatal("unexpected baseline")
	}
	call("GET", ops+"?before=invalid", nil, operator, 400)
	start := novel.AuthorPolicyAction{MutationID: uuid.New(), Action: "start", Reason: "运营确认违规后开启观察", ExpectedRevision: 0}
	call("POST", ops, start, owner, 403)
	bad := start
	bad.Reason = " "
	call("POST", ops, bad, operator, 400)
	result := novelResult[novel.AuthorPolicyEvent](t, call("POST", ops, start, operator, 200))
	if result.Revision != 1 || result.ObservationUntil == nil || result.ObservationUntil.Sub(result.CreatedAt) != 7*24*time.Hour {
		t.Fatal("start duration")
	}
	retry := novelResult[novel.AuthorPolicyEvent](t, call("POST", ops, start, operator, 200))
	if !reflect.DeepEqual(retry, result) {
		t.Fatal("retry changed result")
	}
	read := novelResult[novel.AuthorPolicyEvent](t, call("GET", ops+"/requests/"+start.MutationID.String(), nil, operator, 200))
	if !reflect.DeepEqual(read, result) {
		t.Fatal("receipt changed")
	}
	bad = start
	bad.Reason = "different"
	call("POST", ops, bad, operator, 409)
	call("GET", ops+"/requests/"+uuid.NewString(), nil, operator, 404)
	// Both observation changes and publication serialize on the owner account lock.
	pendingChapter := uuid.New()
	pendingDraft, e := (draft.Store{DB: db, Chapter: &draft.ChapterScope{NovelID: book.ID, ChapterID: pendingChapter}}).Write(ctx, owner, "create", draft.Write{MutationID: uuid.New(), Title: "策略待审第二章", Content: "仅提交后可供审核的固定内容"})
	if e != nil {
		t.Fatal(e)
	}
	pp, e := s.PrepareChapter(ctx, owner, book.ID, novel.PrepareChapter{MutationID: uuid.New(), DraftID: pendingDraft.DraftID, SourceRevision: pendingDraft.Revision, BookRevision: book.Revision})
	if e != nil {
		t.Fatal(e)
	}
	pending, e := s.SubmitChapter(ctx, owner, book.ID, novel.SubmitChapter{MutationID: uuid.New(), PreviewID: pp.PreviewID, RightsConfirmed: true})
	if e != nil || pending.State != "pending" {
		t.Fatal("observation did not hold submission", e)
	}
	extended := novelResult[novel.AuthorPolicyEvent](t, call("POST", ops, novel.AuthorPolicyAction{MutationID: uuid.New(), Action: "extend", ExpectedRevision: 1, Reason: "再次确认违规后延长"}, operator, 200))
	if extended.ObservationUntil.Sub(*result.ObservationUntil) != 7*24*time.Hour {
		t.Fatal("extension reset clock")
	}
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, e := s.ChangeAuthorPolicy(ctx, operator, book.ID, novel.AuthorPolicyAction{MutationID: uuid.New(), Action: "extend", ExpectedRevision: 2, Reason: "并发延长"})
			results <- e
		}()
	}
	wg.Wait()
	close(results)
	ok, conflict := 0, 0
	for e := range results {
		if e == nil {
			ok++
		} else if errors.Is(e, novel.ErrStateConflict) {
			conflict++
		} else {
			t.Fatal(e)
		}
	}
	if ok != 1 || conflict != 1 {
		t.Fatal("policy CAS lost")
	}
	metaPending, e := s.SubmitMetadata(ctx, owner, book.ID, novel.SubmitMetadata{MutationID: uuid.New(), SourceRevision: book.Revision, ExpectedRevision: 1, RightsConfirmed: true})
	if e != nil || metaPending.State != "pending" {
		t.Fatal("metadata not pending", e)
	}
	revoked := novelResult[novel.AuthorPolicyEvent](t, call("POST", ops, novel.AuthorPolicyAction{MutationID: uuid.New(), Action: "revoke", ExpectedRevision: 3, Reason: "提前结束观察并保留待审"}, operator, 200))
	if revoked.Revision != 4 || revoked.ObservationUntil != nil {
		t.Fatal("revoke failed")
	}
	state = novelResult[novel.AuthorPolicyPage](t, call("GET", root+"/author-policy", nil, owner, 200))
	if state.Policy.Active || len(state.Items) != 4 {
		t.Fatal("policy history")
	}
	// Revoke does not publish or clear the pending record; resubmission stays pending.
	cs, e := s.ChapterState(ctx, owner, book.ID, pendingChapter)
	if e != nil || cs.CurrentSubmissionID == nil || cs.LastVersion != 0 {
		t.Fatal("revoke released pending")
	}
	pp, e = s.PrepareChapter(ctx, owner, book.ID, novel.PrepareChapter{MutationID: uuid.New(), DraftID: pendingDraft.DraftID, SourceRevision: pendingDraft.Revision, BookRevision: book.Revision})
	if e != nil {
		t.Fatal(e)
	}
	replaced, e := s.SubmitChapter(ctx, owner, book.ID, novel.SubmitChapter{MutationID: uuid.New(), PreviewID: pp.PreviewID, RightsConfirmed: true})
	if e != nil || replaced.State != "pending" {
		t.Fatal("replaced pending auto published", e)
	}
	metaReplaced, e := s.SubmitMetadata(ctx, owner, book.ID, novel.SubmitMetadata{MutationID: uuid.New(), SourceRevision: book.Revision, ExpectedRevision: 1, RightsConfirmed: true})
	if e != nil || metaReplaced.State != "pending" {
		t.Fatal("metadata replacement escaped review", e)
	}
	// Natural expiry is read-time, keeps the original reason/end/history; explicit start creates a new event.
	_, e = s.ChangeAuthorPolicy(ctx, operator, book.ID, novel.AuthorPolicyAction{MutationID: uuid.New(), Action: "start", ExpectedRevision: 4, Reason: "再次开始观察"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("UPDATE publication_policies SET observation_until=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE owner_id=?", owner[:]); e != nil {
		t.Fatal(e)
	}
	state = novelResult[novel.AuthorPolicyPage](t, call("GET", ops, nil, operator, 200))
	if state.Policy.Active || state.Policy.ObservationUntil == nil || state.Policy.Revision != 5 {
		t.Fatal("expiry not respected")
	}
	restarted := novelResult[novel.AuthorPolicyEvent](t, call("POST", ops, novel.AuthorPolicyAction{MutationID: uuid.New(), Action: "start", ExpectedRevision: 5, Reason: "到期后再次确认违规"}, operator, 200))
	if restarted.ObservationUntil.Sub(restarted.CreatedAt) != 7*24*time.Hour {
		t.Fatal("restart duration")
	}
	// 20-event keyset history and stale revisions remain bounded.
	revision := uint64(6)
	for range 17 {
		revision++
		_, e = s.ChangeAuthorPolicy(ctx, operator, book.ID, novel.AuthorPolicyAction{MutationID: uuid.New(), Action: "extend", ExpectedRevision: revision - 1, Reason: "独立已确认测试事件"})
		if e != nil {
			t.Fatal(e)
		}
	}
	state = novelResult[novel.AuthorPolicyPage](t, call("GET", ops, nil, operator, 200))
	if len(state.Items) != 20 || state.Next != 4 {
		t.Fatal("history first page")
	}
	page := novelResult[novel.AuthorPolicyPage](t, call("GET", ops+"?before=4", nil, operator, 200))
	if len(page.Items) != 3 || page.Next != 0 {
		t.Fatal("history second page")
	}
}
