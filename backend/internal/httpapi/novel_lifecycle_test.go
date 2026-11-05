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
	"strconv"
	"strings"
	"sync"
	"testing"
	"writing.local/community/internal/draft"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/novel"
)

func TestNovelCompletionRectificationHTTP(t *testing.T) {
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
			for _, q := range []string{"DELETE FROM novel_reading_requests WHERE account_id=?", "DELETE FROM novel_reading_positions WHERE account_id=?", "DELETE FROM novel_author_policy_events WHERE actor_id=?", "DELETE FROM novel_management_requests WHERE actor_id=?", "DELETE FROM novel_publication_requests WHERE owner_id=?"} {
				if _, e := db.Exec(q, id[:]); e != nil {
					t.Errorf("receipt cleanup: %v", e)
				}
			}
		}
		for _, id := range ids {
			for _, q := range []string{
				"DELETE FROM chapter_post_review_tasks WHERE owner_id=?", "DELETE FROM chapter_versions WHERE owner_id=?", "UPDATE novel_rectifications SET preview_id=NULL WHERE owner_id=?", "DELETE FROM novel_rectification_previews WHERE owner_id=?", "DELETE FROM novel_rectifications WHERE owner_id=?", "DELETE FROM novel_completion_checks WHERE owner_id=?",
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

	book, err := s.Write(ctx, owner, uuid.Nil, novel.Write{MutationID: uuid.New(), Title: "完结整改合成书", Tags: []string{"日常"}})
	if err != nil {
		t.Fatal(err)
	}
	root := "/api/my/novels/" + book.ID.String()
	ops := "/api/ops/novels/" + book.ID.String()
	post := func(path string, in any, who uuid.UUID, want int) novel.LifecycleReceipt {
		t.Helper()
		raw := call("POST", path, in, who, want)
		if want != 200 {
			return novel.LifecycleReceipt{}
		}
		return novelResult[novel.LifecycleReceipt](t, raw)
	}
	check := func() novel.LifecycleReceipt {
		t.Helper()
		return post(root+"/completion-checks", novel.PrepareCompletion{MutationID: uuid.New()}, owner, 200)
	}
	empty := check()
	summary := novelResult[novel.CompletionCheck](t, call("GET", root+"/completion-checks/"+empty.TargetID.String(), nil, owner, 200))
	if summary.Eligible || summary.FormalChapters != 0 || summary.LastFormalChapter != nil {
		t.Fatal("zero chapter eligibility")
	}
	post(root+"/completion", novel.ConfirmCompletion{MutationID: uuid.New(), CheckID: empty.TargetID, IrreversibleConfirmed: true}, owner, 409)
	call("GET", root+"/completion-checks/"+empty.TargetID.String(), nil, other, 404)
	call("POST", root+"/completion-checks", novel.PrepareCompletion{MutationID: uuid.New()}, uuid.Nil, 401)
	call("POST", root+"/completion-checks", map[string]any{"mutation_id": uuid.New(), "owner_id": owner}, owner, 400)
	type chapterFixture struct {
		id uuid.UUID
		ds draft.Store
		d  draft.Result
		p  novel.ChapterReceipt
	}
	// Use the actual draft and publication services, not handcrafted formal rows.
	create := func(title string) chapterFixture {
		t.Helper()
		id := uuid.New()
		ds := draft.Store{DB: db, Chapter: &draft.ChapterScope{NovelID: book.ID, ChapterID: id}}
		d, e := ds.Write(ctx, owner, "create", draft.Write{MutationID: uuid.New(), Title: title, Content: "原始正式内容\n第二段"})
		if e != nil {
			t.Fatal(e)
		}
		p, e := s.PrepareChapter(ctx, owner, book.ID, novel.PrepareChapter{MutationID: uuid.New(), DraftID: d.DraftID, SourceRevision: d.Revision, BookRevision: book.Revision})
		if e != nil {
			t.Fatal(e)
		}
		return chapterFixture{id, ds, d, p}
	}
	publish := func(c chapterFixture) {
		t.Helper()
		if _, e := s.SubmitChapter(ctx, owner, book.ID, novel.SubmitChapter{MutationID: uuid.New(), PreviewID: c.p.PreviewID, RightsConfirmed: true}); e != nil {
			t.Fatal(e)
		}
	}
	c1 := create("第一章")
	publish(c1)
	stale := check()
	c2 := create("第二章")
	publish(c2)
	post(root+"/completion", novel.ConfirmCompletion{MutationID: uuid.New(), CheckID: stale.TargetID, IrreversibleConfirmed: true}, owner, 409)
	expired := check()
	if _, err = db.Exec("UPDATE novel_completion_checks SET expires_at=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE id=?", expired.TargetID[:]); err != nil {
		t.Fatal(err)
	}
	call("GET", root+"/completion-checks/"+expired.TargetID.String(), nil, owner, 410)
	post(root+"/completion", novel.ConfirmCompletion{MutationID: uuid.New(), CheckID: expired.TargetID, IrreversibleConfirmed: true}, owner, 410)
	if _, err = db.Exec("INSERT INTO publication_policies(owner_id,observation_until) VALUES(?,UTC_TIMESTAMP(6)+INTERVAL 7 DAY)", owner[:]); err != nil {
		t.Fatal(err)
	}
	c3 := create("第三章待审")
	pending, e := s.SubmitChapter(ctx, owner, book.ID, novel.SubmitChapter{MutationID: uuid.New(), PreviewID: c3.p.PreviewID, RightsConfirmed: true})
	if e != nil {
		t.Fatal(e)
	}
	blocked := check()
	summary = novelResult[novel.CompletionCheck](t, call("GET", root+"/completion-checks/"+blocked.TargetID.String(), nil, owner, 200))
	if summary.Eligible || summary.PendingChapters != 1 {
		t.Fatal("pending chapter not counted")
	}
	post(root+"/completion", novel.ConfirmCompletion{MutationID: uuid.New(), CheckID: blocked.TargetID, IrreversibleConfirmed: true}, owner, 409)
	if _, e = s.WithdrawChapter(ctx, owner, book.ID, *pending.SubmissionID, novel.WithdrawChapter{MutationID: uuid.New()}); e != nil {
		t.Fatal(e)
	}
	if _, err = db.Exec("DELETE FROM publication_policies WHERE owner_id=?", owner[:]); err != nil {
		t.Fatal(err)
	}
	c3.p, e = s.PrepareChapter(ctx, owner, book.ID, novel.PrepareChapter{MutationID: uuid.New(), DraftID: c3.d.DraftID, SourceRevision: c3.d.Revision, BookRevision: book.Revision})
	if e != nil {
		t.Fatal(e)
	}
	raceCheck := check()
	confirm := novel.ConfirmCompletion{MutationID: uuid.New(), CheckID: raceCheck.TargetID, IrreversibleConfirmed: true}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	wg.Add(2)
	go func() { defer wg.Done(); _, e := s.ConfirmCompletion(ctx, owner, book.ID, confirm); results <- e }()
	go func() {
		defer wg.Done()
		_, e := s.SubmitChapter(ctx, owner, book.ID, novel.SubmitChapter{MutationID: uuid.New(), PreviewID: c3.p.PreviewID, RightsConfirmed: true})
		results <- e
	}()
	wg.Wait()
	close(results)
	successes := 0
	for e := range results {
		if e == nil {
			successes++
		} else if !errors.Is(e, novel.ErrStateConflict) && !errors.Is(e, novel.ErrPublicationConflict) {
			t.Fatal(e)
		}
	}
	if successes != 1 {
		t.Fatal("completion and publication both changed the checked book")
	}
	state, e := s.NovelState(ctx, owner, book.ID)
	if e != nil {
		t.Fatal(e)
	}
	if !state.Completed {
		fresh := check()
		confirm = novel.ConfirmCompletion{MutationID: uuid.New(), CheckID: fresh.TargetID, IrreversibleConfirmed: true}
	}
	done := post(root+"/completion", confirm, owner, 200)
	if done.State != "completed" {
		t.Fatal("completion receipt")
	}
	if _, err = db.Exec("UPDATE novel_completion_checks SET expires_at=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE id=?", confirm.CheckID[:]); err != nil {
		t.Fatal(err)
	}
	retry := post(root+"/completion", confirm, owner, 200)
	if !reflect.DeepEqual(done, retry) {
		t.Fatal("completion original receipt changed")
	}
	call("GET", root+"/lifecycle-requests/"+confirm.MutationID.String(), nil, other, 404)
	got := novelResult[novel.LifecycleReceipt](t, call("GET", root+"/lifecycle-requests/"+confirm.MutationID.String(), nil, owner, 200))
	if !reflect.DeepEqual(done, got) {
		t.Fatal("lost completion response recovery")
	}
	changed := confirm
	changed.IrreversibleConfirmed = false
	post(root+"/completion", changed, owner, 400)
	_, e = s.PrepareChapter(ctx, owner, book.ID, novel.PrepareChapter{MutationID: uuid.New(), DraftID: c1.d.DraftID, SourceRevision: c1.d.Revision, BookRevision: book.Revision})
	if !errors.Is(e, novel.ErrPublicationConflict) {
		t.Fatal("completed book allowed ordinary preview")
	}
	_, e = s.SubmitChapter(ctx, owner, book.ID, novel.SubmitChapter{MutationID: uuid.New(), PreviewID: c3.p.PreviewID, RightsConfirmed: true})
	if !errors.Is(e, novel.ErrPublicationConflict) {
		t.Fatal("old preview bypassed completion")
	}
	// Ordinary private editing survives. A fixed rectification preview never follows later text.
	edited, e := c1.ds.Write(ctx, owner, "save", draft.Write{MutationID: uuid.New(), DraftID: c1.d.DraftID, BaseRevision: c1.d.Revision, Title: "整改第一章", Content: "已核对整改正文"})
	if e != nil {
		t.Fatal(e)
	}
	state, e = s.NovelState(ctx, owner, book.ID)
	if e != nil {
		t.Fatal(e)
	}
	bookCase, e := s.LimitNovel(ctx, operator, book.ID, novel.LimitNovel{MutationID: uuid.New(), Scope: "book", ExpectedRevision: state.StateRevision, Reason: "整书处置保留"})
	if e != nil {
		t.Fatal(e)
	}
	cs, e := s.ChapterState(ctx, owner, book.ID, c1.id)
	if e != nil {
		t.Fatal(e)
	}
	chapterCase, e := s.LimitNovel(ctx, operator, book.ID, novel.LimitNovel{MutationID: uuid.New(), Scope: "chapter", ChapterID: &c1.id, ExpectedRevision: cs.StateRevision, Reason: "本章整改"})
	if e != nil {
		t.Fatal(e)
	}
	grantInput := novel.GrantRectification{MutationID: uuid.New(), ChapterID: c1.id, BaseVersion: 1, CaseID: chapterCase.CaseID, CaseRevision: 1, Reason: "仅指定第一章整改"}
	post(ops+"/rectifications", grantInput, owner, 403)
	grant := post(ops+"/rectifications", grantInput, operator, 200)
	if grant.State != "available" {
		t.Fatal("grant not available")
	}
	post(ops+"/rectifications", novel.GrantRectification{MutationID: uuid.New(), ChapterID: c1.id, BaseVersion: 1, CaseID: chapterCase.CaseID, CaseRevision: 1, Reason: "重复授权"}, operator, 409)
	path := root + "/rectifications/" + grant.TargetID.String()
	opPath := ops + "/rectifications/" + grant.TargetID.String()
	call("GET", path, nil, other, 404)
	detail := novelResult[novel.RectificationDetail](t, call("GET", opPath, nil, operator, 200))
	if detail.Submitted != nil || detail.Source != nil || !detail.Grant.TargetCurrent {
		t.Fatal("operator saw unsubmitted draft")
	}
	authorDetail := novelResult[novel.RectificationDetail](t, call("GET", path, nil, owner, 200))
	if authorDetail.Source == nil || authorDetail.Source.DraftID != c1.d.DraftID || authorDetail.Source.Revision != edited.Revision {
		t.Fatal("author source metadata mismatch")
	}
	call("GET", ops+"/chapters", nil, owner, 403)
	directory := novelResult[novel.OperatorChapterPage](t, call("GET", ops+"/chapters", nil, operator, 200))
	if len(directory.Items) < 2 {
		t.Fatal("operator missing formal chapters")
	}
	var last uint64
	for _, c := range directory.Items {
		if c.Ordinal <= last || c.Version == 0 || c.Title == "后续私稿" {
			t.Fatal("operator directory contains private or unordered chapters")
		}
		last = c.Ordinal
	}
	afterOne := novelResult[novel.OperatorChapterPage](t, call("GET", ops+"/chapters?after=1", nil, operator, 200))
	for _, c := range afterOne.Items {
		if c.Ordinal <= 1 {
			t.Fatal("operator pagination repeated chapter")
		}
	}
	prep := post(path+"/previews", novel.PrepareRectification{MutationID: uuid.New(), ExpectedRevision: 1, DraftID: c1.d.DraftID, SourceRevision: edited.Revision}, owner, 200)
	call("GET", root+"/rectification-previews/"+prep.TargetID.String(), nil, other, 404)
	fixed := novelResult[novel.RectificationPreview](t, call("GET", root+"/rectification-previews/"+prep.TargetID.String(), nil, owner, 200))
	if fixed.Content != "已核对整改正文" {
		t.Fatal("fixed preview content")
	}
	later, e := c1.ds.Write(ctx, owner, "save", draft.Write{MutationID: uuid.New(), DraftID: c1.d.DraftID, BaseRevision: edited.Revision, Title: "后续私稿", Content: "不能被审核看到的后续工作稿"})
	if e != nil {
		t.Fatal(e)
	}
	submit := novel.SubmitRectification{MutationID: uuid.New(), ExpectedRevision: 1, PreviewID: prep.TargetID, RightsConfirmed: true}
	accepted := post(path+"/submission", submit, owner, 200)
	again := post(path+"/submission", submit, owner, 200)
	if !reflect.DeepEqual(accepted, again) {
		t.Fatal("rectification retry changed")
	}
	post(path+"/submission", novel.SubmitRectification{MutationID: uuid.New(), ExpectedRevision: 1, PreviewID: prep.TargetID, RightsConfirmed: true}, owner, 409)
	detail = novelResult[novel.RectificationDetail](t, call("GET", opPath, nil, operator, 200))
	if detail.Submitted == nil || detail.Submitted.Content != fixed.Content {
		t.Fatal("submitted candidate follows private draft")
	}
	var releases uint64
	if err = db.QueryRow("SELECT COUNT(*) FROM chapter_release_events WHERE novel_id=?", book.ID[:]).Scan(&releases); err != nil {
		t.Fatal(err)
	}
	approve := novel.RectificationAction{MutationID: uuid.New(), ExpectedRevision: 2, Reason: "人工核对通过，保留关联处置"}
	approved := post(opPath+"/actions/approve", approve, operator, 200)
	if approved.Version != 2 {
		t.Fatal("rectification did not produce V2")
	}
	if !reflect.DeepEqual(approved, post(opPath+"/actions/approve", approve, operator, 200)) {
		t.Fatal("approval replay")
	}
	state, e = s.NovelState(ctx, owner, book.ID)
	if e != nil || !state.Completed || !state.PlatformLimited {
		t.Fatal("rectification reset book restriction/lifecycle")
	}
	cs, e = s.ChapterState(ctx, owner, book.ID, c1.id)
	if e != nil || !cs.PlatformLimited || cs.LastVersion != 2 {
		t.Fatal("default approval cleared chapter restriction")
	}
	var after uint64
	if err = db.QueryRow("SELECT COUNT(*) FROM chapter_release_events WHERE novel_id=?", book.ID[:]).Scan(&after); err != nil || after != releases {
		t.Fatal("rectification emitted a new chapter event")
	}
	current, e := c1.ds.Read(ctx, owner, c1.d.DraftID)
	if e != nil || current.Revision != later.Revision || current.Content != "不能被审核看到的后续工作稿" {
		t.Fatal("rectification consumed private draft")
	}
	// A second explicit grant may revoke exactly its associated chapter case.
	grantInput.MutationID = uuid.New()
	grantInput.BaseVersion = 2
	g2 := post(ops+"/rectifications", grantInput, operator, 200)
	p2 := root + "/rectifications/" + g2.TargetID.String()
	o2 := ops + "/rectifications/" + g2.TargetID.String()
	pre2 := post(p2+"/previews", novel.PrepareRectification{MutationID: uuid.New(), ExpectedRevision: 1, DraftID: c1.d.DraftID, SourceRevision: edited.Revision}, owner, 200)
	post(p2+"/submission", novel.SubmitRectification{MutationID: uuid.New(), ExpectedRevision: 1, PreviewID: pre2.TargetID, RightsConfirmed: true}, owner, 200)
	post(o2+"/actions/approve", novel.RectificationAction{MutationID: uuid.New(), ExpectedRevision: 2, Reason: "仅撤销该章关联处置", RevokeCase: true}, operator, 200)
	cs, e = s.ChapterState(ctx, owner, book.ID, c1.id)
	if e != nil || cs.PlatformLimited || !cs.ParentLimited || cs.LastVersion != 3 {
		t.Fatal("explicit revoke affected other restriction")
	}
	bookDetail, e := s.NovelCaseDetail(ctx, owner, book.ID, bookCase.CaseID, 0)
	if e != nil || bookDetail.Case.State != "active" {
		t.Fatal("unrelated book case changed")
	}
	list := novelResult[novel.RectificationPage](t, call("GET", root+"/rectifications", nil, owner, 200))
	if len(list.Items) != 2 || list.Next != 0 {
		t.Fatal("author grant list")
	}
	call("GET", root+"/rectifications", nil, other, 404)
	// Irreversible completion still allows author hiding; rectification never clears it.
	state, e = s.NovelState(ctx, owner, book.ID)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.ChangeVisibility(ctx, owner, book.ID, uuid.Nil, novel.VisibilityAction{MutationID: uuid.New(), ExpectedRevision: state.StateRevision, Action: "hide"}); e != nil {
		t.Fatal(e)
	}
	cs, e = s.ChapterState(ctx, owner, book.ID, c1.id)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.ChangeVisibility(ctx, owner, book.ID, c1.id, novel.VisibilityAction{MutationID: uuid.New(), ExpectedRevision: cs.StateRevision, Action: "hide"}); e != nil {
		t.Fatal(e)
	}
	cs, e = s.ChapterState(ctx, owner, book.ID, c1.id)
	if e != nil {
		t.Fatal(e)
	}
	versionCase, e := s.LimitNovel(ctx, operator, book.ID, novel.LimitNovel{MutationID: uuid.New(), Scope: "version", ChapterID: &c1.id, Version: 3, ExpectedRevision: cs.StateRevision, Reason: "固定V3整改"})
	if e != nil {
		t.Fatal(e)
	}
	newGrant := func() (novel.LifecycleReceipt, string, string) {
		t.Helper()
		g := post(ops+"/rectifications", novel.GrantRectification{MutationID: uuid.New(), ChapterID: c1.id, BaseVersion: 3, CaseID: versionCase.CaseID, CaseRevision: 1, Reason: "指定V3一次整改"}, operator, 200)
		return g, root + "/rectifications/" + g.TargetID.String(), ops + "/rectifications/" + g.TargetID.String()
	}
	_, gpath, gops := newGrant()
	post(gpath+"/previews", novel.PrepareRectification{MutationID: uuid.New(), ExpectedRevision: 1, DraftID: c2.d.DraftID, SourceRevision: c2.d.Revision}, owner, 409)
	exp := post(gpath+"/previews", novel.PrepareRectification{MutationID: uuid.New(), ExpectedRevision: 1, DraftID: c1.d.DraftID, SourceRevision: edited.Revision}, owner, 200)
	if _, err = db.Exec("UPDATE novel_rectification_previews SET expires_at=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE id=?", exp.TargetID[:]); err != nil {
		t.Fatal(err)
	}
	call("GET", root+"/rectification-previews/"+exp.TargetID.String(), nil, owner, 410)
	post(gpath+"/submission", novel.SubmitRectification{MutationID: uuid.New(), ExpectedRevision: 1, PreviewID: exp.TargetID, RightsConfirmed: true}, owner, 410)
	if _, e = s.PruneRectificationPreviews(ctx); e != nil {
		t.Fatal(e)
	}
	var pruned bool
	if err = db.QueryRow("SELECT snapshot IS NULL FROM novel_rectification_previews WHERE id=?", exp.TargetID[:]).Scan(&pruned); err != nil || !pruned {
		t.Fatal("expired preview body not pruned")
	}
	freshPreview := func(path string) novel.LifecycleReceipt {
		t.Helper()
		return post(path+"/previews", novel.PrepareRectification{MutationID: uuid.New(), ExpectedRevision: 1, DraftID: c1.d.DraftID, SourceRevision: edited.Revision}, owner, 200)
	}
	submitAt := func(path string) {
		t.Helper()
		p := freshPreview(path)
		post(path+"/submission", novel.SubmitRectification{MutationID: uuid.New(), ExpectedRevision: 1, PreviewID: p.TargetID, RightsConfirmed: true}, owner, 200)
	}
	submitAt(gpath)
	post(gops+"/actions/reject", novel.RectificationAction{MutationID: uuid.New(), ExpectedRevision: 2, Reason: "拒绝不能附带撤销", RevokeCase: true}, operator, 400)
	post(gops+"/actions/reject", novel.RectificationAction{MutationID: uuid.New(), ExpectedRevision: 2, Reason: "内容尚未满足整改"}, operator, 200)
	post(gpath+"/previews", novel.PrepareRectification{MutationID: uuid.New(), ExpectedRevision: 3, DraftID: c1.d.DraftID, SourceRevision: edited.Revision}, owner, 409)
	// Submitted cancellation is terminal; a late approval must not publish it.
	_, gpath, gops = newGrant()
	submitAt(gpath)
	post(gops+"/actions/cancel", novel.RectificationAction{MutationID: uuid.New(), ExpectedRevision: 2, Reason: "运营取消本次候选"}, operator, 200)
	post(gops+"/actions/approve", novel.RectificationAction{MutationID: uuid.New(), ExpectedRevision: 2, Reason: "迟到审核"}, operator, 409)
	_, gpath, gops = newGrant()
	submitAt(gpath)
	post(gpath+"/withdraw", novel.RectificationAction{MutationID: uuid.New(), ExpectedRevision: 2, Reason: "作者主动撤回"}, other, 404)
	post(gpath+"/withdraw", novel.RectificationAction{MutationID: uuid.New(), ExpectedRevision: 2, Reason: "作者主动撤回"}, owner, 200)
	post(gpath+"/submission", novel.SubmitRectification{MutationID: uuid.New(), ExpectedRevision: 3, PreviewID: exp.TargetID, RightsConfirmed: true}, owner, 409)
	// Case revision changes invalidate the old authorization, without deleting the candidate.
	staleGrant, gpath, gops := newGrant()
	submitAt(gpath)
	if _, e = s.DecideNovelCase(ctx, operator, book.ID, versionCase.CaseID, novel.NovelCaseAction{MutationID: uuid.New(), ExpectedRevision: 1, Decision: "revoke", Reason: "原处置已撤销"}); e != nil {
		t.Fatal(e)
	}
	detail = novelResult[novel.RectificationDetail](t, call("GET", gpath, nil, owner, 200))
	if detail.Grant.TargetCurrent || detail.Submitted == nil {
		t.Fatal("stale authorization did not retain submitted evidence")
	}
	post(gops+"/actions/approve", novel.RectificationAction{MutationID: uuid.New(), ExpectedRevision: 2, Reason: "迟到通过"}, operator, 409)
	cancel := novel.RectificationAction{MutationID: uuid.New(), ExpectedRevision: 2, Reason: "清理失效授权"}
	cancelled := post(gops+"/actions/cancel", cancel, operator, 200)
	original := novelResult[novel.LifecycleReceipt](t, call("GET", ops+"/lifecycle-requests/"+cancel.MutationID.String(), nil, operator, 200))
	if !reflect.DeepEqual(original, cancelled) {
		t.Fatal("operator unknown recovery")
	}
	call("GET", ops+"/lifecycle-requests/"+cancel.MutationID.String(), nil, owner, 403)
	call("GET", root+"/lifecycle-requests/"+cancel.MutationID.String(), nil, owner, 404)
	changedCancel := cancel
	changedCancel.Reason = "不同载荷"
	post(ops+"/rectifications/"+staleGrant.TargetID.String()+"/actions/cancel", changedCancel, operator, 409)
	cs, e = s.ChapterState(ctx, owner, book.ID, c1.id)
	if e != nil || cs.LastVersion != 3 || !cs.AuthorHidden || !cs.ParentHidden || !cs.ParentLimited {
		t.Fatal("rejected/cancelled/withdrawn candidate affected public state or hidden flags")
	}
	// Page one can be followed without duplicate grants, including terminal history.
	var firstSequence uint64
	if err = db.QueryRow("SELECT sequence FROM novel_rectifications WHERE id=?", staleGrant.TargetID[:]).Scan(&firstSequence); err != nil {
		t.Fatal(err)
	}
	earlier := novelResult[novel.RectificationPage](t, call("GET", root+"/rectifications?before="+strconv.FormatUint(firstSequence, 10), nil, owner, 200))
	for _, g := range earlier.Items {
		if g.ID == staleGrant.TargetID {
			t.Fatal("pagination repeated cursor")
		}
	}

	// Approval and cancellation of one fixed candidate cannot both commit.
	raceGrant := post(ops+"/rectifications", novel.GrantRectification{MutationID: uuid.New(), ChapterID: c1.id, BaseVersion: 3, CaseID: bookCase.CaseID, CaseRevision: 1, Reason: "人工审核竞争测试"}, operator, 200)
	racePath := root + "/rectifications/" + raceGrant.TargetID.String()
	submitAt(racePath)
	outcomes := make(chan error, 2)
	wg.Add(2)
	for _, action := range []string{"approve", "cancel"} {
		action := action
		go func() {
			defer wg.Done()
			_, e := s.ResolveRectification(ctx, operator, book.ID, raceGrant.TargetID, action, novel.RectificationAction{MutationID: uuid.New(), ExpectedRevision: 2, Reason: "互斥决定"})
			outcomes <- e
		}()
	}
	wg.Wait()
	close(outcomes)
	successes = 0
	for e := range outcomes {
		if e == nil {
			successes++
		} else if !errors.Is(e, novel.ErrStateConflict) {
			t.Fatal(e)
		}
	}
	if successes != 1 {
		t.Fatal("two rectification decisions committed")
	}
	final, e := s.Rectification(ctx, owner, book.ID, raceGrant.TargetID)
	if e != nil {
		t.Fatal(e)
	}
	cs, e = s.ChapterState(ctx, owner, book.ID, c1.id)
	if e != nil {
		t.Fatal(e)
	}
	expected := uint64(3)
	if final.Grant.State == "approved" {
		expected = 4
	}
	if cs.LastVersion != expected || !cs.AuthorHidden || !cs.ParentHidden || !cs.ParentLimited {
		t.Fatal("racing decision changed unrelated state")
	}

}
