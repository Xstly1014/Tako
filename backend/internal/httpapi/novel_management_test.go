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
}
