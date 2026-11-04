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
	"strconv"
	"strings"
	"sync"
	"testing"
	"writing.local/community/internal/draft"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/novel"
)

func novelResult[T any](t *testing.T, raw []byte) T {
	t.Helper()
	var out T
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal("response decode failed")
	}
	return out
}
func TestNovelManagementMetadataAndVisibility(t *testing.T) {
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
			for _, q := range []string{"DELETE FROM novel_management_requests WHERE actor_id=?", "DELETE FROM novel_publication_requests WHERE owner_id=?"} {
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
	state := novelResult[novel.NovelState](t, call("GET", root+"/formal-state", nil, owner, 200))
	if state.Formal != nil || state.MetadataSubmissionID != nil {
		t.Fatal("private book looks published")
	}
	call("GET", root+"/formal-state", nil, other, 404)
	call("GET", root+"/formal-state", nil, uuid.Nil, 401)
	call("POST", root+"/visibility", novel.VisibilityAction{MutationID: uuid.New(), ExpectedRevision: 1, Action: "hide"}, owner, 409)
	call("POST", root+"/metadata-submissions", novel.SubmitMetadata{MutationID: uuid.New(), SourceRevision: 1, ExpectedRevision: 1, RightsConfirmed: true}, owner, 409)
	chapter := uuid.New()
	ds := draft.Store{DB: db, Chapter: &draft.ChapterScope{NovelID: book.ID, ChapterID: chapter}}
	d, err := ds.Write(ctx, owner, "create", draft.Write{MutationID: uuid.New(), Title: "第一章", Content: "原正文😀\r\n第二段"})
	if err != nil {
		t.Fatal(err)
	}
	chapterRoot := root + "/chapters/" + chapter.String()
	cs := novelResult[novel.ChapterState](t, call("GET", chapterRoot+"/state", nil, owner, 200))
	if cs.Ordinal != nil || cs.LastVersion != 0 {
		t.Fatal("private chapter reserved")
	}
	publish := func() {
		t.Helper()
		p, e := s.PrepareChapter(ctx, owner, book.ID, novel.PrepareChapter{MutationID: uuid.New(), DraftID: d.DraftID, SourceRevision: d.Revision, BookRevision: book.Revision})
		if e != nil {
			t.Fatal(e)
		}
		if _, e = s.SubmitChapter(ctx, owner, book.ID, novel.SubmitChapter{MutationID: uuid.New(), PreviewID: p.PreviewID, RightsConfirmed: true}); e != nil {
			t.Fatal(e)
		}
	}
	publish()
	first, err := s.NovelState(ctx, owner, book.ID)
	if err != nil || first.Formal == nil {
		t.Fatal("first formal metadata", err)
	}
	firstTime := first.Formal.FirstPublishedAt
	// Concurrent same-state changes cannot silently overwrite each other.
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, e := s.ChangeVisibility(ctx, owner, book.ID, uuid.Nil, novel.VisibilityAction{MutationID: uuid.New(), ExpectedRevision: first.StateRevision, Action: "hide"})
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
		t.Fatal("visibility CAS lost", ok, conflict)
	}
	state, _ = s.NovelState(ctx, owner, book.ID)
	noop := novel.VisibilityAction{MutationID: uuid.New(), ExpectedRevision: state.StateRevision, Action: "hide"}
	hide := novelResult[novel.VisibilityReceipt](t, call("POST", root+"/visibility", noop, owner, 200))
	if hide.StateRevision != state.StateRevision || !hide.AuthorHidden {
		t.Fatal("no-op changed state")
	}
	call("POST", root+"/visibility", noop, other, 404)
	// Editing private metadata alone must not change what readers will see.
	edit := func(title string) {
		t.Helper()
		var e error
		book, e = s.Write(ctx, owner, book.ID, novel.Write{MutationID: uuid.New(), BaseRevision: book.Revision, Title: title, Introduction: "公开简介", Tags: []string{"冒险"}})
		if e != nil {
			t.Fatal(e)
		}
	}
	edit("资料二")
	state, _ = s.NovelState(ctx, owner, book.ID)
	if state.Formal.Title != "第一份公开资料" {
		t.Fatal("private edit published")
	}
	submit := func(expected uint64) novel.MetadataReceipt {
		t.Helper()
		return novelResult[novel.MetadataReceipt](t, call("POST", root+"/metadata-submissions", novel.SubmitMetadata{MutationID: uuid.New(), SourceRevision: book.Revision, ExpectedRevision: expected, RightsConfirmed: true}, owner, 200))
	}
	mr := submit(1)
	if mr.State != "published" || mr.Revision != 2 {
		t.Fatal("normal metadata not formal")
	}
	state, _ = s.NovelState(ctx, owner, book.ID)
	if state.Formal.Title != "资料二" || !state.AuthorHidden || !state.Formal.FirstPublishedAt.Equal(firstTime) {
		t.Fatal("metadata altered visibility or first time")
	}
	call("GET", root+"/metadata-requests/"+mr.MutationID.String(), nil, other, 404)
	call("GET", root+"/visibility-requests/"+mr.MutationID.String(), nil, owner, 404)
	call("GET", root+"/metadata-requests/"+noop.MutationID.String(), nil, owner, 404)
	call("GET", "/api/ops/novels/metadata-review-queue?mode=post", nil, owner, 403)
	queue := novelResult[novel.MetadataPage](t, call("GET", "/api/ops/novels/metadata-review-queue?mode=post", nil, operator, 200))
	found := false
	for _, item := range queue.Items {
		if item.ID == mr.SubmissionID {
			found = true
		}
	}
	if !found {
		t.Fatal("missing metadata post review")
	}
	reviewPath := func(id uuid.UUID) string {
		return "/api/ops/novels/" + book.ID.String() + "/metadata-submissions/" + id.String() + "/review"
	}
	call("POST", reviewPath(mr.SubmissionID), novel.DecideChapter{MutationID: uuid.New(), Decision: "approve"}, operator, 200)
	if _, err = db.Exec("INSERT INTO publication_policies(owner_id,observation_until) VALUES(?,DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 1 DAY))", owner[:]); err != nil {
		t.Fatal(err)
	}
	edit("待审资料三")
	old := submit(2)
	if old.State != "pending" || old.Revision != 0 {
		t.Fatal("observation bypass")
	}
	edit("待审资料四")
	pending := submit(2)
	state, _ = s.NovelState(ctx, owner, book.ID)
	if state.Formal.Title != "资料二" || state.MetadataSubmissionID == nil || *state.MetadataSubmissionID != pending.SubmissionID {
		t.Fatal("pending metadata leaked")
	}
	detail := novelResult[novel.MetadataSubmission](t, call("GET", root+"/metadata-submissions/"+old.SubmissionID.String(), nil, owner, 200))
	if detail.State != "superseded" || detail.Current {
		t.Fatal("old metadata still current")
	}
	call("POST", reviewPath(old.SubmissionID), novel.DecideChapter{MutationID: uuid.New(), Decision: "approve"}, operator, 409)
	call("POST", reviewPath(pending.SubmissionID), novel.DecideChapter{MutationID: uuid.New(), Decision: "approve"}, owner, 403)
	call("GET", root+"/metadata-submissions/"+pending.SubmissionID.String(), nil, other, 404)
	call("GET", root+"/metadata-submissions", nil, other, 404)
	call("GET", "/api/ops/novels/metadata-review-queue?mode=bad", nil, operator, 400)
	// Later private edits and ending observation cannot alter or auto-approve it.
	edit("后续私有资料五")
	if _, err = db.Exec("UPDATE publication_policies SET observation_until=NULL WHERE owner_id=?", owner[:]); err != nil {
		t.Fatal(err)
	}
	state, _ = s.NovelState(ctx, owner, book.ID)
	if state.MetadataSubmissionID == nil {
		t.Fatal("pending automatically released")
	}
	approved := novel.DecideChapter{MutationID: uuid.New(), Decision: "approve"}
	call("POST", reviewPath(pending.SubmissionID), approved, operator, 200)
	call("POST", reviewPath(pending.SubmissionID), approved, operator, 200)
	state, _ = s.NovelState(ctx, owner, book.ID)
	if state.Formal.Title != "待审资料四" || state.Formal.Revision != 3 || book.Title != "后续私有资料五" {
		t.Fatal("review adopted current private input")
	}
	// Changed payload with an accepted key cannot become another operation.
	call("POST", root+"/visibility", novel.VisibilityAction{MutationID: pending.MutationID, ExpectedRevision: state.StateRevision, Action: "restore"}, owner, 409)
	call("POST", root+"/metadata-submissions", novel.SubmitMetadata{MutationID: uuid.New(), SourceRevision: 1, ExpectedRevision: 3, RightsConfirmed: true}, owner, 409)
	if _, err = db.Exec("UPDATE publication_policies SET observation_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 1 DAY) WHERE owner_id=?", owner[:]); err != nil {
		t.Fatal(err)
	}
	reject := submit(3)
	call("POST", reviewPath(reject.SubmissionID), novel.DecideChapter{MutationID: uuid.New(), Decision: "reject", Reason: " "}, operator, 400)
	call("POST", reviewPath(reject.SubmissionID), novel.DecideChapter{MutationID: uuid.New(), Decision: "reject", Reason: "需改进简介"}, operator, 200)
	next := submit(3)
	withdrawPath := root + "/metadata-submissions/" + next.SubmissionID.String() + "/withdraw"
	withdraw := novel.WithdrawChapter{MutationID: uuid.New()}
	call("POST", withdrawPath, withdraw, other, 404)
	call("POST", withdrawPath, withdraw, owner, 200)
	call("POST", withdrawPath, withdraw, owner, 200)
	// Chapter visibility and readable private versions remain independent.
	if _, err = ds.Write(ctx, owner, "save", draft.Write{MutationID: uuid.New(), DraftID: d.DraftID, BaseRevision: 1, Title: "修订章", Content: "修订正文"}); err != nil {
		t.Fatal(err)
	}
	d.Revision = 2
	if _, err = db.Exec("UPDATE publication_policies SET observation_until=NULL WHERE owner_id=?", owner[:]); err != nil {
		t.Fatal(err)
	}
	publish()
	cs, _ = s.ChapterState(ctx, owner, book.ID, chapter)
	chapterHide := novel.VisibilityAction{MutationID: uuid.New(), ExpectedRevision: cs.StateRevision, Action: "hide"}
	call("POST", chapterRoot+"/visibility", chapterHide, owner, 200)
	call("GET", chapterRoot+"/versions/1", nil, owner, 200)
	call("GET", chapterRoot+"/versions/1", nil, other, 404)
	page := novelResult[novel.ChapterVersionPage](t, call("GET", chapterRoot+"/versions?before=2", nil, owner, 200))
	if len(page.Items) != 1 || page.Items[0].Version != 1 {
		t.Fatal("version paging")
	}
	call("GET", chapterRoot+"/versions?before=-1", nil, owner, 400)
	if _, err = db.Exec("UPDATE chapter_versions SET platform_limited=TRUE WHERE chapter_id=? AND version=2", chapter[:]); err != nil {
		t.Fatal(err)
	}
	cs, _ = s.ChapterState(ctx, owner, book.ID, chapter)
	restoreChapter := novel.VisibilityAction{MutationID: uuid.New(), ExpectedRevision: cs.StateRevision, Action: "restore"}
	call("POST", chapterRoot+"/visibility", restoreChapter, owner, 409)
	version := novelResult[novel.ChapterVersion](t, call("GET", chapterRoot+"/versions/2", nil, owner, 200))
	if !version.PlatformLimited || version.Content != "修订正文" {
		t.Fatal("author cannot export restricted content")
	}
	if _, err = db.Exec("UPDATE novels SET platform_limited=TRUE WHERE id=?", book.ID[:]); err != nil {
		t.Fatal(err)
	}
	state, _ = s.NovelState(ctx, owner, book.ID)
	call("POST", root+"/visibility", novel.VisibilityAction{MutationID: uuid.New(), ExpectedRevision: state.StateRevision, Action: "restore"}, owner, 409)
	// Completion doesn't erase metadata management or hide/restore rights.
	if _, err = db.Exec("UPDATE novels SET completed_at=UTC_TIMESTAMP(6) WHERE id=?", book.ID[:]); err != nil {
		t.Fatal(err)
	}
	finished := submit(3)
	if finished.Revision != 4 {
		t.Fatal("completion blocked metadata")
	}
	if _, err = db.Exec("UPDATE chapter_versions SET platform_limited=FALSE WHERE chapter_id=? AND version=2", chapter[:]); err != nil {
		t.Fatal(err)
	}
	call("POST", chapterRoot+"/visibility", restoreChapter, owner, 200)
	cs, _ = s.ChapterState(ctx, owner, book.ID, chapter)
	if cs.AuthorHidden || !cs.ParentLimited || !cs.ParentHidden || cs.DisplayVersion != 2 || !cs.Completed {
		t.Fatal("restore cleared independent state")
	}
	// Immutable confirmations do not pretend the object is still hidden.
	replay := novelResult[novel.VisibilityReceipt](t, call("POST", chapterRoot+"/visibility", chapterHide, owner, 200))
	if !replay.AuthorHidden {
		t.Fatal("visibility receipt became current")
	}
	call("GET", root+"/visibility-requests/"+chapterHide.MutationID.String(), nil, owner, 200)
	var events, history int
	if err = db.QueryRow("SELECT COUNT(*) FROM chapter_release_events WHERE novel_id=?", book.ID[:]).Scan(&events); err != nil || events != 1 {
		t.Fatal("management emitted chapter event", err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM novel_metadata_versions WHERE novel_id=?", book.ID[:]).Scan(&history); err != nil || history != 4 {
		t.Fatal("metadata history missing", err, history)
	}
	final, _ := s.NovelState(ctx, owner, book.ID)
	if !final.Formal.FirstPublishedAt.Equal(firstTime) || !final.Completed || !final.PlatformLimited {
		t.Fatal("metadata cleared first publication or lifecycle")
	}
	private, e := s.Read(ctx, owner, book.ID)
	if e != nil || private.Revision != 5 || private.Title != "后续私有资料五" {
		t.Fatal("formal metadata rewrote private source", e)
	}

	// Layered formal restrictions and text appeals never alter hidden/private
	// state or restore another scope. Fixture reset only removes the earlier
	// manually injected flag, before testing actual governance operations.
	if _, err = db.Exec("UPDATE novels SET platform_limited=FALSE WHERE id=?", book.ID[:]); err != nil {
		t.Fatal(err)
	}
	opsRoot := "/api/ops/novels/" + book.ID.String()
	call("GET", opsRoot+"/formal-state", nil, owner, 403)
	call("GET", opsRoot+"/formal-state", nil, operator, 200)
	call("GET", opsRoot+"/chapters/"+chapter.String()+"/state", nil, operator, 200)
	limit := func(scope string, version uint64) novel.NovelCaseResult {
		t.Helper()
		st, _ := s.NovelState(ctx, owner, book.ID)
		revision := st.StateRevision
		var target *uuid.UUID
		if scope != "book" {
			target = &chapter
			chapterState, _ := s.ChapterState(ctx, owner, book.ID, chapter)
			revision = chapterState.StateRevision
		}
		in := novel.LimitNovel{MutationID: uuid.New(), Scope: scope, ChapterID: target, Version: version, ExpectedRevision: revision, Reason: "测试明确内容问题"}
		call("POST", opsRoot+"/limits", in, owner, 403)
		return novelResult[novel.NovelCaseResult](t, call("POST", opsRoot+"/limits", in, operator, 200))
	}
	bookCase, chapterCase, versionCase := limit("book", 0), limit("chapter", 0), limit("version", 2)
	casePath := func(ops bool, id uint64) string {
		base := root
		if ops {
			base = opsRoot
		}
		return base + "/moderation/" + strconv.FormatUint(id, 10)
	}
	call("GET", casePath(false, versionCase.ID), nil, other, 404)
	call("GET", casePath(true, versionCase.ID), nil, owner, 403)
	call("GET", opsRoot+"/chapters/"+chapter.String()+"/versions/2", nil, operator, 200)
	appealMutation := uuid.New()
	appealInput := map[string]any{"mutation_id": appealMutation, "expected_revision": 1, "reason": "申请重新核对"}
	call("POST", casePath(false, versionCase.ID), appealInput, other, 404)
	appeal := novelResult[novel.NovelCaseResult](t, call("POST", casePath(false, versionCase.ID), appealInput, owner, 200))
	if appeal.State != "pending" || appeal.Operation != "appeal" {
		t.Fatal("appeal not recorded")
	}
	call("POST", casePath(false, versionCase.ID), appealInput, owner, 200)
	call("POST", casePath(false, versionCase.ID), map[string]any{"mutation_id": uuid.New(), "expected_revision": 1, "reason": "重复申请"}, owner, 409)
	call("GET", "/api/ops/novels/appeals", nil, owner, 403)
	appeals := novelResult[novel.NovelAppealPage](t, call("GET", "/api/ops/novels/appeals", nil, operator, 200))
	matched := false
	for _, item := range appeals.Items {
		if item.ID == appeal.ID && item.NovelID == book.ID {
			matched = true
		}
	}
	if !matched {
		t.Fatal("pending appeal missing")
	}
	uphold := novel.NovelCaseAction{MutationID: uuid.New(), ExpectedRevision: 1, Decision: "uphold", Reason: "复核后维持", AppealID: appeal.ID}
	call("POST", casePath(true, versionCase.ID), uphold, operator, 200)
	cd := novelResult[novel.NovelCaseDetail](t, call("GET", casePath(false, versionCase.ID), nil, owner, 200))
	if cd.Case.Revision != 2 || cd.Case.NextAppealAt == nil || cd.Appeals.Items[0].State != "upheld" {
		t.Fatal("uphold missing cooldown")
	}
	call("POST", casePath(false, versionCase.ID), map[string]any{"mutation_id": uuid.New(), "expected_revision": 2, "reason": "冷静期再提交"}, owner, 409)
	call("GET", root+"/moderation-requests/"+appealMutation.String(), nil, owner, 200)
	call("GET", root+"/moderation-requests/"+appealMutation.String(), nil, other, 404)
	call("GET", root+"/metadata-requests/"+appealMutation.String(), nil, owner, 404)
	// The older V1 post-review can be acknowledged without changing V2.
	post := novelResult[novel.NovelPostReviewPage](t, call("GET", "/api/ops/novels/post-reviews", nil, operator, 200))
	var task uuid.UUID
	for _, item := range post.Items {
		if item.NovelID == book.ID && item.Version == 1 {
			task = item.SubmissionID
			if item.Current {
				t.Fatal("old version marked current")
			}
		}
		if item.NovelID == book.ID && item.Version == 2 {
			t.Fatal("restricted version remains in post queue")
		}
	}
	if task == uuid.Nil {
		t.Fatal("old formal post-review missing")
	}
	postMutation := novel.WithdrawChapter{MutationID: uuid.New()}
	postPath := opsRoot + "/post-reviews/" + task.String()
	call("POST", postPath, postMutation, owner, 403)
	call("POST", postPath, postMutation, operator, 200)
	call("POST", postPath, postMutation, operator, 200)
	call("GET", opsRoot+"/post-review-requests/"+postMutation.MutationID.String(), nil, operator, 200)
	call("POST", postPath, novel.WithdrawChapter{MutationID: uuid.New()}, operator, 409)
	// Active revoke is allowed even during appeal cooldown. It clears only V2.
	revoke := novel.NovelCaseAction{MutationID: uuid.New(), ExpectedRevision: 2, Decision: "revoke", Reason: "主动纠错撤销"}
	call("POST", casePath(true, versionCase.ID), revoke, operator, 200)
	cs, _ = s.ChapterState(ctx, owner, book.ID, chapter)
	if !cs.PlatformLimited || !cs.ParentLimited || cs.DisplayVersion != 2 {
		t.Fatal("version revoke changed another dimension")
	}
	call("POST", chapterRoot+"/visibility", novel.VisibilityAction{MutationID: uuid.New(), ExpectedRevision: cs.StateRevision, Action: "restore"}, owner, 409)
	for _, caseID := range []uint64{chapterCase.ID, bookCase.ID} {
		call("POST", casePath(true, caseID), novel.NovelCaseAction{MutationID: uuid.New(), ExpectedRevision: 1, Decision: "revoke", Reason: "独立撤销此措施"}, operator, 200)
	}
	cs, _ = s.ChapterState(ctx, owner, book.ID, chapter)
	final, _ = s.NovelState(ctx, owner, book.ID)
	if cs.PlatformLimited || cs.ParentLimited || !final.AuthorHidden || !final.Completed || cs.DisplayVersion != 2 {
		t.Fatal("governance cleared hiding/lifecycle or retained revoked restriction")
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM chapter_release_events WHERE novel_id=?", book.ID[:]).Scan(&events); err != nil || events != 1 {
		t.Fatal("governance emitted chapter event", err)
	}
	allCases := novelResult[novel.NovelCasePage](t, call("GET", root+"/moderation", nil, owner, 200))
	if len(allCases.Items) != 3 {
		t.Fatal("missing author history")
	}
	// Summary is one private projection: formal titles do not follow private edits.
	catalogBook, e := s.Write(ctx, owner, uuid.Nil, novel.Write{MutationID: uuid.New(), Title: "管理摘要测试", Tags: []string{"幻想"}})
	if e != nil {
		t.Fatal(e)
	}
	catalogRoot := "/api/my/novels/" + catalogBook.ID.String() + "/publication-chapters"
	call("GET", catalogRoot, nil, other, 404)
	call("GET", catalogRoot, nil, uuid.Nil, 401)
	call("GET", catalogRoot+"?cursor=bad", nil, owner, 400)
	empty := novelResult[novel.ManagedChapterPage](t, call("GET", catalogRoot, nil, owner, 200))
	if len(empty.Items) != 0 || empty.NextCursor != "" {
		t.Fatal("empty catalog")
	}
	var draftIDs []uuid.UUID
	for i := 0; i < 23; i++ {
		draftStore := draft.Store{DB: db, Chapter: &draft.ChapterScope{NovelID: catalogBook.ID, ChapterID: uuid.New()}}
		made, e := draftStore.Write(ctx, owner, "create", draft.Write{MutationID: uuid.New(), Title: "私稿标题", Content: "不应出现在摘要中的正文"})
		if e != nil {
			t.Fatal(e)
		}
		draftIDs = append(draftIDs, made.DraftID)
	}
	prepareCatalog := func(index int) novel.ChapterReceipt {
		p, e := s.PrepareChapter(ctx, owner, catalogBook.ID, novel.PrepareChapter{MutationID: uuid.New(), DraftID: draftIDs[index], SourceRevision: 1, BookRevision: 1})
		if e != nil {
			t.Fatal(e)
		}
		r, e := s.SubmitChapter(ctx, owner, catalogBook.ID, novel.SubmitChapter{MutationID: uuid.New(), PreviewID: p.PreviewID, RightsConfirmed: true})
		if e != nil {
			t.Fatal(e)
		}
		return r
	}
	if _, e = db.Exec("UPDATE publication_policies SET observation_until=NULL WHERE owner_id=?", owner[:]); e != nil {
		t.Fatal(e)
	}
	published := prepareCatalog(5)
	var primary []byte
	if e = db.QueryRow("SELECT chapter_id FROM chapter_drafts WHERE id=?", draftIDs[5][:]).Scan(&primary); e != nil {
		t.Fatal(e)
	}
	primaryID, e := uuid.FromBytes(primary)
	if e != nil {
		t.Fatal(e)
	}
	editStore := draft.Store{DB: db, Chapter: &draft.ChapterScope{NovelID: catalogBook.ID, ChapterID: primaryID}}
	if _, e = editStore.Write(ctx, owner, "save", draft.Write{MutationID: uuid.New(), DraftID: draftIDs[5], BaseRevision: 1, Title: "后续私稿不得冒充正式标题", Content: "新正文"}); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("UPDATE publication_policies SET observation_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 1 DAY) WHERE owner_id=?", owner[:]); e != nil {
		t.Fatal(e)
	}
	pendingCatalog := prepareCatalog(8)
	// Revisions pending on an existing formal chapter must keep the public title primary.
	p, e := s.PrepareChapter(ctx, owner, catalogBook.ID, novel.PrepareChapter{MutationID: uuid.New(), DraftID: draftIDs[5], SourceRevision: 2, BookRevision: 1})
	if e != nil {
		t.Fatal(e)
	}
	revision, e := s.SubmitChapter(ctx, owner, catalogBook.ID, novel.SubmitChapter{MutationID: uuid.New(), PreviewID: p.PreviewID, RightsConfirmed: true})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("UPDATE chapter_versions SET platform_limited=TRUE WHERE chapter_id=? AND version=1", published.ChapterID[:]); e != nil {
		t.Fatal(e)
	}
	rawCatalog := call("GET", catalogRoot, nil, owner, 200)
	if strings.Contains(string(rawCatalog), "不应出现在摘要中的正文") || strings.Contains(string(rawCatalog), "\"content\"") {
		t.Fatal("management summary downloaded content")
	}
	managed := novelResult[novel.ManagedChapterPage](t, rawCatalog)
	if len(managed.Items) != 20 || managed.NextCursor == "" {
		t.Fatal("catalog first page")
	}
	firstManaged := managed.Items[0]
	if firstManaged.ChapterID != published.ChapterID || firstManaged.Title != "私稿标题" || firstManaged.TitleSource != "formal" || !firstManaged.VersionLimited || firstManaged.CurrentSubmissionID == nil || revision.SubmissionID == nil || *firstManaged.CurrentSubmissionID != *revision.SubmissionID {
		t.Fatal("formal management source/status")
	}
	if firstManaged.PendingTitle == nil || *firstManaged.PendingTitle != "后续私稿不得冒充正式标题" {
		t.Fatal("pending title separate")
	}
	if managed.Items[1].ChapterID != pendingCatalog.ChapterID || managed.Items[1].TitleSource != "pending" || managed.Items[1].DisplayVersion != 0 {
		t.Fatal("first pending summary")
	}
	rest := novelResult[novel.ManagedChapterPage](t, call("GET", catalogRoot+"?cursor="+managed.NextCursor, nil, owner, 200))
	if len(rest.Items) != 3 || rest.NextCursor != "" {
		t.Fatal("catalog last page")
	}
	seen := map[uuid.UUID]bool{}
	for _, item := range append(managed.Items, rest.Items...) {
		if seen[item.ChapterID] {
			t.Fatal("duplicate chapter")
		}
		seen[item.ChapterID] = true
	}
	call("GET", root+"/publication-chapters?cursor="+managed.NextCursor, nil, owner, 400)
	call("GET", catalogRoot+"?cursor="+managed.NextCursor, nil, other, 400)

	scopedRoot := "/api/my/novels/" + catalogBook.ID.String() + "/chapters/" + published.ChapterID.String() + "/submissions"
	scoped := novelResult[novel.ChapterSubmissionPage](t, call("GET", scopedRoot, nil, owner, 200))
	if len(scoped.Items) != 2 {
		t.Fatal("scoped submissions lost original record")
	}
	for _, item := range scoped.Items {
		if item.ChapterID != published.ChapterID {
			t.Fatal("another chapter in scoped history")
		}
	}
	call("GET", scopedRoot, nil, other, 404)
	call("GET", root+"/chapters/"+published.ChapterID.String()+"/submissions", nil, owner, 404)
	// Twenty-two immutable submissions prove the cursor cannot be reused for another chapter/book queue.
	for i := 0; i < 21; i++ {
		p, e := s.PrepareChapter(ctx, owner, catalogBook.ID, novel.PrepareChapter{MutationID: uuid.New(), DraftID: draftIDs[5], SourceRevision: 2, BookRevision: 1})
		if e != nil {
			t.Fatal(e)
		}
		if _, e = s.SubmitChapter(ctx, owner, catalogBook.ID, novel.SubmitChapter{MutationID: uuid.New(), PreviewID: p.PreviewID, RightsConfirmed: true}); e != nil {
			t.Fatal(e)
		}
	}
	historyPage := novelResult[novel.ChapterSubmissionPage](t, call("GET", scopedRoot, nil, owner, 200))
	if len(historyPage.Items) != 20 || historyPage.NextCursor == "" {
		t.Fatal("scoped history first page")
	}
	historyLast := novelResult[novel.ChapterSubmissionPage](t, call("GET", scopedRoot+"?cursor="+historyPage.NextCursor, nil, owner, 200))
	if len(historyLast.Items) != 3 || historyLast.NextCursor != "" {
		t.Fatal("scoped history last page")
	}
	call("GET", "/api/my/novels/"+catalogBook.ID.String()+"/chapters/"+pendingCatalog.ChapterID.String()+"/submissions?cursor="+historyPage.NextCursor, nil, owner, 400)
	call("GET", "/api/my/novels/"+catalogBook.ID.String()+"/chapter-submissions?cursor="+historyPage.NextCursor, nil, owner, 400)

}
