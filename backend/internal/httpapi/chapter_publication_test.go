package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"writing.local/community/internal/draft"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/novel"
)

func TestChapterPublicationReservationReviewAndRecovery(t *testing.T) {
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
	store := novel.Store{DB: db}
	owner, other, operator := uuid.New(), uuid.New(), uuid.New()
	ids := []uuid.UUID{owner, other, operator}
	tokens := map[uuid.UUID]string{}
	for _, id := range ids {
		if _, err = db.Exec("INSERT INTO accounts(id,email,nickname) VALUES(?,?,?)", id[:], id.String()+"@example.test", "章节发布测试"); err != nil {
			t.Fatal(err)
		}
		tokens[id] = strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", "")
		if err = insertLegacySession(ctx, db, id, tokens[id]); err != nil {
			t.Fatal(err)
		}
	}
	defer func() {
		// Only random accounts created above, in FK order; never touch shared fixtures.
		for _, id := range ids {
			if _, e := db.Exec("DELETE FROM novel_management_requests WHERE actor_id=?", id[:]); e != nil {
				t.Errorf("fixture management cleanup: %v", e)
			}
			if _, e := db.Exec("DELETE FROM novel_publication_requests WHERE owner_id=?", id[:]); e != nil {
				t.Errorf("fixture receipts cleanup: %v", e)
			}
		}
		for _, id := range ids {
			for _, q := range []string{
				"DELETE FROM novel_publication_requests WHERE owner_id=?",
				"DELETE FROM chapter_release_events WHERE owner_id=?",
				"DELETE FROM chapter_post_review_tasks WHERE owner_id=?",
				"DELETE FROM chapter_versions WHERE owner_id=?",
				"DELETE FROM chapter_submissions WHERE owner_id=?",
				"DELETE FROM chapter_previews WHERE owner_id=?",
				"DELETE FROM novel_metadata_versions WHERE owner_id=?",
				"DELETE FROM novel_metadata_submissions WHERE owner_id=?",
				"DELETE FROM novel_publications WHERE owner_id=?",
				"UPDATE novel_chapters SET primary_draft_id=NULL WHERE owner_id=?",
				"UPDATE chapter_drafts SET recovered_from_id=NULL WHERE owner_id=?",
				"DELETE FROM chapter_draft_mutations WHERE owner_id=?",
				"DELETE FROM chapter_drafts WHERE owner_id=?",
				"DELETE FROM novel_chapters WHERE owner_id=?",
				"DELETE FROM novel_mutations WHERE owner_id=?",
				"DELETE FROM novels WHERE owner_id=?",
				"DELETE FROM publication_policies WHERE owner_id=?",
				"DELETE FROM sessions WHERE account_id=?",
				"DELETE FROM accounts WHERE id=?",
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
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "http://localhost:3000")
		if who != uuid.Nil {
			req.AddCookie(&http.Cookie{Name: "tako_session", Value: tokens[who]})
		}
		out := httptest.NewRecorder()
		r.ServeHTTP(out, req)
		validateResponse(t, req, out)
		if out.Code != want {
			var result struct {
				Error string `json:"error"`
			}
			json.Unmarshal(out.Body.Bytes(), &result)
			t.Fatalf("%s status %d want %d code %s", method, out.Code, want, result.Error)
		}
		return out.Body.Bytes()
	}
	newBook := func(title string) novel.Book {
		t.Helper()
		b, e := store.Write(ctx, owner, uuid.Nil, novel.Write{MutationID: uuid.New(), Title: title, Tags: []string{"冒险"}})
		if e != nil {
			t.Fatal(e)
		}
		return b
	}
	newDraft := func(book novel.Book, title string) (draft.Result, uuid.UUID) {
		t.Helper()
		m := uuid.New()
		chapter := privateChapterID(book.ID, owner, m, "create")
		d, e := (draft.Store{DB: db, Chapter: &draft.ChapterScope{NovelID: book.ID, ChapterID: chapter}}).Write(ctx, owner, "create", draft.Write{MutationID: m, Title: title, Content: "已同步正文😀\n第二段"})
		if e != nil {
			t.Fatal(e)
		}
		return d, chapter
	}
	prepare := func(book novel.Book, d draft.Result) novel.ChapterReceipt {
		t.Helper()
		var out novel.ChapterReceipt
		json.Unmarshal(call("POST", "/api/my/novels/"+book.ID.String()+"/chapter-previews", novel.PrepareChapter{MutationID: uuid.New(), DraftID: d.DraftID, SourceRevision: d.Revision, BookRevision: book.Revision}, owner, 200), &out)
		return out
	}
	submit := func(book novel.Book, p novel.ChapterReceipt) novel.ChapterReceipt {
		t.Helper()
		var out novel.ChapterReceipt
		json.Unmarshal(call("POST", "/api/my/novels/"+book.ID.String()+"/chapter-submissions", novel.SubmitChapter{MutationID: uuid.New(), PreviewID: p.PreviewID, RightsConfirmed: true}, owner, 200), &out)
		return out
	}
	reviewPath := func(b novel.Book, s novel.ChapterReceipt) string {
		return "/api/ops/novels/" + b.ID.String() + "/chapter-submissions/" + s.SubmissionID.String() + "/review"
	}
	b := newBook("A先预览资料")
	da, ca := newDraft(b, "A第一章")
	dbb, cb := newDraft(b, "B第二章")
	root := "/api/my/novels/" + b.ID.String()
	call("POST", root+"/chapter-previews", novel.PrepareChapter{MutationID: uuid.New(), DraftID: da.DraftID, SourceRevision: 1, BookRevision: 1}, uuid.Nil, 401)
	call("POST", root+"/chapter-previews", novel.PrepareChapter{MutationID: uuid.New(), DraftID: da.DraftID, SourceRevision: 1, BookRevision: 1}, other, 404)
	call("POST", root+"/chapter-previews", map[string]any{"mutation_id": uuid.New(), "draft_id": da.DraftID, "source_revision": 1, "book_revision": 1, "owner_id": owner}, owner, 400)
	call("POST", root+"/chapter-previews", novel.PrepareChapter{MutationID: uuid.New(), DraftID: da.DraftID, SourceRevision: 999, BookRevision: 1}, owner, 409)
	// Concurrent previews don't reserve. Another accepted slot must force re-preview.
	pa, pb := prepare(b, da), prepare(b, dbb)
	var slots int
	if err = db.QueryRow("SELECT COUNT(*) FROM novel_chapters WHERE novel_id=? AND ordinal IS NOT NULL", b.ID[:]).Scan(&slots); err != nil || slots != 0 {
		t.Fatal("preview reserved slot", err)
	}
	if _, err = db.Exec("INSERT INTO publication_policies(owner_id,observation_until) VALUES(?,DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 1 DAY))", owner[:]); err != nil {
		t.Fatal(err)
	}
	sa := submit(b, pa)
	if sa.State != "pending" || sa.Ordinal != 1 || sa.Version != 0 {
		t.Fatal("accepted is not formal")
	}
	call("POST", root+"/chapter-submissions", novel.SubmitChapter{MutationID: uuid.New(), PreviewID: pa.PreviewID, RightsConfirmed: true}, owner, 409)
	call("POST", root+"/chapter-submissions", novel.SubmitChapter{MutationID: uuid.New(), PreviewID: pb.PreviewID, RightsConfirmed: true}, owner, 409)
	// B's preview freezes newer book metadata, which must win if B publishes first.
	b, err = store.Write(ctx, owner, b.ID, novel.Write{MutationID: uuid.New(), BaseRevision: 1, Title: "B先正式资料", Tags: []string{"幻想"}})
	if err != nil {
		t.Fatal(err)
	}
	sb := submit(b, prepare(b, dbb))
	if sb.Ordinal != 2 || sb.State != "pending" {
		t.Fatal("second independent pending")
	}
	call("GET", root+"/chapter-submissions", nil, other, 404)
	call("GET", "/api/ops/novels/chapter-review-queue", nil, owner, 403)
	var queue novel.ChapterSubmissionPage
	json.Unmarshal(call("GET", "/api/ops/novels/chapter-review-queue", nil, operator, 200), &queue)
	found := map[uuid.UUID]bool{}
	for _, item := range queue.Items {
		if item.NovelID == b.ID {
			found[item.ID] = true
			if !item.Current || item.State != "pending" {
				t.Fatal("stale queue entry")
			}
		}
	}
	if !found[*sa.SubmissionID] || !found[*sb.SubmissionID] {
		t.Fatal("independent pending missing from queue")
	}
	call("GET", "/api/ops/novels/chapter-review-queue?cursor=bad", nil, operator, 400)
	var detail novel.ChapterSubmissionDetail
	json.Unmarshal(call("GET", root+"/chapter-submissions/"+sa.SubmissionID.String(), nil, owner, 200), &detail)
	if detail.Preview.Content != "已同步正文😀\n第二段" || !detail.Submission.Current {
		t.Fatal("accepted detail is not fixed")
	}
	call("GET", root+"/chapter-submissions/"+sa.SubmissionID.String(), nil, other, 404)
	call("GET", "/api/ops/novels/"+b.ID.String()+"/chapter-submissions/"+sa.SubmissionID.String(), nil, operator, 200)
	approve := novel.DecideChapter{MutationID: uuid.New(), Decision: "approve", Reason: ""}
	call("POST", reviewPath(b, sb), approve, owner, 403)
	call("POST", reviewPath(b, sb), approve, operator, 200)
	publicRoot := "/api/novels/" + b.ID.String()
	firstPublic := novelResult[novel.PublicNovel](t, call("GET", publicRoot, nil, uuid.Nil, 200))
	if firstPublic.Title != "B先正式资料" || firstPublic.ChapterCount != 1 {
		t.Fatal("B-first public projection")
	}
	firstDirectory := novelResult[novel.DirectoryPage](t, call("GET", publicRoot+"/directory", nil, uuid.Nil, 200))
	if len(firstDirectory.Items) != 1 || firstDirectory.Items[0].Ordinal != 2 || firstDirectory.Items[0].ID != cb {
		t.Fatal("pending A exposed or B renumbered")
	}
	call("GET", publicRoot+"/chapters/"+ca.String(), nil, uuid.Nil, 404)
	// Observation cancellation must not automatically approve A.
	if _, err = db.Exec("UPDATE publication_policies SET observation_until=NULL WHERE owner_id=?", owner[:]); err != nil {
		t.Fatal(err)
	}
	var aState string
	if err = db.QueryRow("SELECT state FROM chapter_submissions WHERE id=?", sa.SubmissionID[:]).Scan(&aState); err != nil || aState != "pending" {
		t.Fatal("pending escaped review", err)
	}
	approve.MutationID = uuid.New()
	call("POST", reviewPath(b, sa), approve, operator, 200)
	laterDirectory := novelResult[novel.DirectoryPage](t, call("GET", publicRoot+"/directory", nil, uuid.Nil, 200))
	if len(laterDirectory.Items) != 2 || laterDirectory.Items[0].Ordinal != 1 || laterDirectory.Items[1].Ordinal != 2 {
		t.Fatal("late A did not fill original position")
	}
	var title string
	if err = db.QueryRow("SELECT title FROM novel_publications WHERE novel_id=?", b.ID[:]).Scan(&title); err != nil || title != "B先正式资料" {
		t.Fatal("late A reverted metadata", err)
	}
	// Replay ignores later state; changing payload with the same key conflicts.
	var replay novel.ChapterReceipt
	json.Unmarshal(call("POST", reviewPath(b, sa), approve, operator, 200), &replay)
	if replay.Version != 1 {
		t.Fatal("review replay")
	}
	wrong := approve
	wrong.Decision = "reject"
	wrong.Reason = "changed"
	call("POST", reviewPath(b, sa), wrong, operator, 409)
	call("GET", root+"/publication-requests/"+sa.MutationID.String(), nil, other, 404)
	call("GET", root+"/chapter-previews/"+pa.PreviewID.String(), nil, other, 404)
	var frozen novel.ChapterPreview
	json.Unmarshal(call("GET", root+"/chapter-previews/"+pa.PreviewID.String(), nil, owner, 200), &frozen)
	if frozen.Content != "已同步正文😀\n第二段" || frozen.BookTitle != "A先预览资料" {
		t.Fatal("preview changed")
	}
	// Revision doesn't reserve again or emit another first-release event.
	revised := submit(b, prepare(b, da))
	if revised.Ordinal != 1 || revised.Version != 2 || revised.State != "published" {
		t.Fatal("revision renumbered")
	}
	var events, position int
	if err = db.QueryRow("SELECT COUNT(*) FROM chapter_release_events WHERE novel_id=?", b.ID[:]).Scan(&events); err != nil || events != 2 {
		t.Fatal("duplicate first release", err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM chapter_post_review_tasks WHERE novel_id=?", b.ID[:]).Scan(&events); err != nil || events != 1 {
		t.Fatal("normal publish missing post-review task", err)
	}
	if err = db.QueryRow("SELECT last_position FROM novels WHERE id=?", b.ID[:]).Scan(&position); err != nil || position != 2 {
		t.Fatal("reservation changed", err)
	}
	var originTitle, originBody string
	var originRevision uint64
	if err = db.QueryRow("SELECT title,content,revision FROM chapter_drafts WHERE id=?", da.DraftID[:]).Scan(&originTitle, &originBody, &originRevision); err != nil || originRevision != 1 || originTitle != "A第一章" || originBody != frozen.Content {
		t.Fatal("formal operation changed draft", err)
	}
	// A rejected or withdrawn first chapter retains its slot. Same-chapter
	// replacement retains one candidate V; superseded reviews are rejected.
	if _, err = db.Exec("UPDATE publication_policies SET observation_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 1 DAY) WHERE owner_id=?", owner[:]); err != nil {
		t.Fatal(err)
	}
	dc, cc := newDraft(b, "C第三章")
	sc := submit(b, prepare(b, dc))
	old := sc
	sc = submit(b, prepare(b, dc))
	call("POST", reviewPath(b, old), novel.DecideChapter{MutationID: uuid.New(), Decision: "approve", Reason: ""}, operator, 409)
	json.Unmarshal(call("GET", root+"/chapter-submissions/"+old.SubmissionID.String(), nil, owner, 200), &detail)
	if detail.Submission.Current || detail.Submission.State != "superseded" {
		t.Fatal("superseded submission still current")
	}
	reject := novel.DecideChapter{MutationID: uuid.New(), Decision: "reject", Reason: "需要修改"}
	call("POST", reviewPath(b, sc), novel.DecideChapter{MutationID: uuid.New(), Decision: "reject", Reason: " "}, operator, 400)
	call("POST", reviewPath(b, sc), reject, operator, 200)
	sc = submit(b, prepare(b, dc))
	if sc.Ordinal != 3 || sc.Version != 0 {
		t.Fatal("rejection recycled slot")
	}
	withdraw := novel.WithdrawChapter{MutationID: uuid.New()}
	call("POST", root+"/chapter-submissions/"+sc.SubmissionID.String()+"/withdraw", withdraw, other, 404)
	call("POST", root+"/chapter-submissions/"+sc.SubmissionID.String()+"/withdraw", withdraw, owner, 200)
	call("POST", root+"/chapter-submissions/"+sc.SubmissionID.String()+"/withdraw", withdraw, owner, 200)
	sc = submit(b, prepare(b, dc))
	if sc.Ordinal != 3 {
		t.Fatal("withdraw recycled slot")
	}
	// Hidden state survives first publication and later review.
	if _, err = db.Exec("UPDATE novels SET author_hidden=TRUE WHERE id=?", b.ID[:]); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("UPDATE novel_chapters SET author_hidden=TRUE WHERE id=?", cc[:]); err != nil {
		t.Fatal(err)
	}
	call("POST", reviewPath(b, sc), novel.DecideChapter{MutationID: uuid.New(), Decision: "approve", Reason: ""}, operator, 200)
	var hidden bool
	if err = db.QueryRow("SELECT author_hidden FROM novel_chapters WHERE id=?", cc[:]).Scan(&hidden); err != nil || !hidden {
		t.Fatal("review unhid chapter", err)
	}
	// Consumed preview survives expiry/cleanup; unused preview returns 410.
	expired := prepare(b, da)
	if _, err = db.Exec("UPDATE chapter_previews SET expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 DAY) WHERE owner_id=?", owner[:]); err != nil {
		t.Fatal(err)
	}
	call("POST", root+"/chapter-submissions", novel.SubmitChapter{MutationID: uuid.New(), PreviewID: expired.PreviewID, RightsConfirmed: true}, owner, 410)
	if _, err = store.PruneChapterPreviews(ctx); err != nil {
		t.Fatal(err)
	}
	call("GET", root+"/chapter-previews/"+expired.PreviewID.String(), nil, owner, 410)
	call("GET", root+"/chapter-previews/"+pa.PreviewID.String(), nil, owner, 200)
	call("GET", root+"/publication-requests/"+expired.MutationID.String(), nil, owner, 200)
	var historical novel.ChapterReceipt
	json.Unmarshal(call("POST", root+"/chapter-submissions", novel.SubmitChapter{MutationID: sa.MutationID, PreviewID: pa.PreviewID, RightsConfirmed: true}, owner, 200), &historical)
	if historical.State != "pending" || historical.Version != 0 {
		t.Fatal("immutable receipt became current state")
	}
	// Atomic contention: one candidate wins, the other remains a private draft.
	raceBook := newBook("并发预约")
	call("POST", "/api/my/novels/"+raceBook.ID.String()+"/chapter-submissions", novel.SubmitChapter{MutationID: sa.MutationID, PreviewID: pa.PreviewID, RightsConfirmed: true}, owner, 409)
	rd1, _ := newDraft(raceBook, "竞争一")
	rd2, _ := newDraft(raceBook, "竞争二")
	rp1, rp2 := prepare(raceBook, rd1), prepare(raceBook, rd2)
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for _, p := range []novel.ChapterReceipt{rp1, rp2} {
		wg.Add(1)
		go func(p novel.ChapterReceipt) {
			defer wg.Done()
			_, e := store.SubmitChapter(ctx, owner, raceBook.ID, novel.SubmitChapter{MutationID: uuid.New(), PreviewID: p.PreviewID, RightsConfirmed: true})
			results <- e
		}(p)
	}
	wg.Wait()
	close(results)
	ok, conflict := 0, 0
	for e := range results {
		if e == nil {
			ok++
		} else if errors.Is(e, novel.ErrPublicationConflict) {
			conflict++
		} else {
			t.Fatal(e)
		}
	}
	if ok != 1 || conflict != 1 {
		t.Fatal("reservation race", ok, conflict)
	}
	// Missing acknowledgement: replaying the same accepted request is immutable.
	samePreview := prepare(raceBook, rd1)
	sameIn := novel.SubmitChapter{MutationID: uuid.New(), PreviewID: samePreview.PreviewID, RightsConfirmed: true}
	got, e := store.SubmitChapter(ctx, owner, raceBook.ID, sameIn)
	if e != nil {
		t.Fatal(e)
	}
	again, e := store.SubmitChapter(ctx, owner, raceBook.ID, sameIn)
	if e != nil || got != again { // UUID pointers are separately decoded; compare JSON below.
		x, _ := json.Marshal(got)
		y, _ := json.Marshal(again)
		if e != nil || string(x) != string(y) {
			t.Fatal("accepted retry changed", e)
		}
	}
	sameIn.RightsConfirmed = false
	if _, e = store.SubmitChapter(ctx, owner, raceBook.ID, sameIn); !errors.Is(e, novel.ErrInvalid) {
		t.Fatal("authorization bypass", e)
	}
	// Frozen source survives later save and history pruning.
	historyPreview := prepare(raceBook, rd2)
	if _, err = db.Exec("DELETE FROM chapter_draft_revisions WHERE draft_id=?", rd2.DraftID[:]); err != nil {
		t.Fatal(err)
	}
	if _, err = store.ChapterPreview(ctx, owner, raceBook.ID, historyPreview.PreviewID); err != nil {
		t.Fatal("preview depended on draft history", err)
	}
	if _, err = store.PrepareChapter(ctx, owner, raceBook.ID, novel.PrepareChapter{MutationID: historyPreview.MutationID, DraftID: rd2.DraftID, SourceRevision: rd2.Revision, BookRevision: raceBook.Revision}); err != nil {
		t.Fatal("prepare replay depended on pruned history", err)
	}
	// Pending first chapters are not formal versions, nor are their gaps reused.
	_ = ca
	_ = cb
	var n int
	if err = db.QueryRow("SELECT COUNT(*) FROM chapter_versions WHERE novel_id=?", b.ID[:]).Scan(&n); err != nil || n != 4 {
		t.Fatal("formal version count", err, n)
	}
	// Unsubmitted tombstones keep idempotency keys; same prepare request cannot
	// silently make a fresh preview after its body has been scrubbed.
	prepIn := novel.PrepareChapter{MutationID: uuid.New(), DraftID: da.DraftID, SourceRevision: 1, BookRevision: b.Revision}
	before, e := store.PrepareChapter(ctx, owner, b.ID, prepIn)
	if e != nil {
		t.Fatal(e)
	}
	if _, err = db.Exec("UPDATE chapter_previews SET expires_at=? WHERE id=?", time.Now().UTC().Add(-time.Hour), before.PreviewID[:]); err != nil {
		t.Fatal(err)
	}
	if _, err = store.PruneChapterPreviews(ctx); err != nil {
		t.Fatal(err)
	}
	after, e := store.PrepareChapter(ctx, owner, b.ID, prepIn)
	if e != nil || after.PreviewID != before.PreviewID {
		t.Fatal("expired operation reborn", e)
	}
	// Fresh prepares use the same 30/hour threshold as middle-form previews,
	// counted independently in this domain;
	// an original request remains confirmable when that budget is exhausted.
	limited := false
	for range 31 {
		_, e = store.PrepareChapter(ctx, owner, raceBook.ID, novel.PrepareChapter{MutationID: uuid.New(), DraftID: rd1.DraftID, SourceRevision: 1, BookRevision: 1})
		if errors.Is(e, novel.ErrPublicationLimited) {
			limited = true
			break
		}
		if e != nil {
			t.Fatal(e)
		}
	}
	if !limited {
		t.Fatal("preview rate limit missing")
	}
	if _, e = store.PrepareChapter(ctx, owner, b.ID, prepIn); e != nil {
		t.Fatal("rate limit blocked original receipt", e)
	}
}
