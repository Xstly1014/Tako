package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
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

func TestNovelNoticesHTTPDeliveryAndVisibility(t *testing.T) {
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
			for _, q := range []string{"DELETE FROM novel_notice_deliveries WHERE account_id=?", "DELETE FROM novel_notices WHERE account_id=?", "DELETE FROM novel_shelf_requests WHERE account_id=?", "DELETE FROM novel_shelves WHERE account_id=?", "DELETE FROM novel_reading_requests WHERE account_id=?", "DELETE FROM novel_reading_positions WHERE account_id=?", "DELETE FROM novel_author_policy_events WHERE actor_id=?", "DELETE FROM novel_management_requests WHERE actor_id=?", "DELETE FROM novel_publication_requests WHERE owner_id=?"} {
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

	book, err := s.Write(ctx, owner, uuid.Nil, novel.Write{MutationID: uuid.New(), Title: "书架合成书", Tags: []string{"日常"}})
	if err != nil {
		t.Fatal(err)
	}
	chapter := uuid.New()
	ds := draft.Store{DB: db, Chapter: &draft.ChapterScope{NovelID: book.ID, ChapterID: chapter}}
	d, e := ds.Write(ctx, owner, "create", draft.Write{MutationID: uuid.New(), Title: "第一章", Content: "😀甲乙\r\n\r\n末尾\r"})
	if e != nil {
		t.Fatal(e)
	}
	p, e := s.PrepareChapter(ctx, owner, book.ID, novel.PrepareChapter{MutationID: uuid.New(), DraftID: d.DraftID, SourceRevision: d.Revision, BookRevision: book.Revision})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.SubmitChapter(ctx, owner, book.ID, novel.SubmitChapter{MutationID: uuid.New(), PreviewID: p.PreviewID, RightsConfirmed: true}); e != nil {
		t.Fatal(e)
	}
	root := "/api/my/novel-notices"
	call("GET", root, nil, uuid.Nil, 401)
	page := novelResult[novel.NoticePage](t, call("GET", root, nil, other, 200))
	if len(page.Items) != 0 {
		t.Fatal("foreign notices")
	}
	join, e := s.WriteShelf(ctx, other, book.ID, novel.ShelfWrite{MutationID: uuid.New(), Operation: "join"})
	if e != nil {
		t.Fatal(e)
	}
	if n, err := s.DispatchNovelNotices(ctx, 25); err != nil || n != 0 {
		t.Fatal("historical chapter notified", err)
	}
	publish := func() uuid.UUID {
		t.Helper()
		cs := draft.Store{DB: db, Chapter: &draft.ChapterScope{NovelID: book.ID, ChapterID: uuid.New()}}
		d, err := cs.Write(ctx, owner, "create", draft.Write{MutationID: uuid.New(), Title: "新章合成标题", Content: "不进入消息的正文"})
		if err != nil {
			t.Fatal(err)
		}
		preview, err := s.PrepareChapter(ctx, owner, book.ID, novel.PrepareChapter{MutationID: uuid.New(), DraftID: d.DraftID, SourceRevision: d.Revision, BookRevision: book.Revision})
		if err != nil {
			t.Fatal(err)
		}
		accepted, err := s.SubmitChapter(ctx, owner, book.ID, novel.SubmitChapter{MutationID: uuid.New(), PreviewID: preview.PreviewID, RightsConfirmed: true})
		if err != nil {
			t.Fatal(err)
		}
		return accepted.ChapterID
	}
	visibility := func(ch uuid.UUID, action string) {
		t.Helper()
		var rev uint64
		if ch == uuid.Nil {
			st, err := s.NovelState(ctx, owner, book.ID)
			if err != nil {
				t.Fatal(err)
			}
			rev = st.StateRevision
		} else {
			st, err := s.ChapterState(ctx, owner, book.ID, ch)
			if err != nil {
				t.Fatal(err)
			}
			rev = st.StateRevision
		}
		if _, err := s.ChangeVisibility(ctx, owner, book.ID, ch, novel.VisibilityAction{MutationID: uuid.New(), ExpectedRevision: rev, Action: action}); err != nil {
			t.Fatal(err)
		}
	}
	visibility(uuid.Nil, "hide")
	hidden := []uuid.UUID{}
	for i := 0; i < 103; i++ {
		// A long hidden period spans hours. Age only this fixture's preview quota rows;
		// real publication, first-release events and production limits remain intact.
		if i%20 == 0 {
			if _, e = db.Exec("UPDATE chapter_previews SET created_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 2 HOUR) WHERE owner_id=?", owner[:]); e != nil {
				t.Fatal(e)
			}
		}
		hidden = append(hidden, publish())
	}
	visibility(hidden[51], "hide")
	backlog, e := s.NovelNoticeBacklog(ctx)
	if e != nil || backlog.Ready != 0 || backlog.Waiting != 1 {
		t.Fatal("hidden backlog misclassified", e)
	}
	if n, err := s.DispatchNovelNotices(ctx, 25); err != nil || n != 0 {
		t.Fatal("hidden notification", err)
	}
	visibility(uuid.Nil, "restore")
	// Two workers must cover the entire readable set once, not once per page.
	var wg sync.WaitGroup
	results := make(chan error, 2)
	sent := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); n, err := s.DispatchNovelNotices(ctx, 25); sent <- n; results <- err }()
	}
	wg.Wait()
	close(results)
	close(sent)
	for err := range results {
		if err != nil {
			t.Fatal(err)
		}
	}
	total := 0
	for n := range sent {
		total += n
	}
	if total != 1 {
		t.Fatal("multiworker duplicated summary")
	}
	page = novelResult[novel.NoticePage](t, call("GET", root, nil, other, 200))
	if len(page.Items) != 1 || page.Items[0].ReadableChapters != 102 {
		t.Fatal("multi-page hidden summary split or skipped")
	}
	notice := page.Items[0]
	detailRoot := root + "/" + notice.ID.String()
	call("GET", detailRoot, nil, owner, 404)
	call("POST", detailRoot+"/read", map[string]any{}, operator, 404)
	detail := novelResult[novel.NoticeDetail](t, call("GET", detailRoot, nil, other, 200))
	if len(detail.Items) != 50 || detail.NextCursor == "" {
		t.Fatal("unbounded details")
	}
	next := novelResult[novel.NoticeDetail](t, call("GET", detailRoot+"?cursor="+detail.NextCursor, nil, other, 200))
	if len(next.Items) != 50 || next.NextCursor == "" {
		t.Fatal("second detail page missing")
	}
	last := novelResult[novel.NoticeDetail](t, call("GET", detailRoot+"?cursor="+next.NextCursor, nil, other, 200))
	if len(last.Items) != 2 {
		t.Fatal("hidden hole leaked into summary")
	}
	for _, item := range append(append(detail.Items, next.Items...), last.Items...) {
		if item.ID == hidden[51] || !item.Readable || item.Title == nil {
			t.Fatal("unreadable chapter covered")
		}
	}
	read := novelResult[novel.NoticeRead](t, call("POST", detailRoot+"/read", map[string]any{}, other, 200))
	again := novelResult[novel.NoticeRead](t, call("POST", detailRoot+"/read", map[string]any{}, other, 200))
	if !reflect.DeepEqual(read, again) {
		t.Fatal("read time overwritten")
	}
	call("POST", detailRoot+"/read", map[string]any{"account_id": owner.String()}, other, 400)
	visibility(hidden[51], "restore")
	if n, err := s.DispatchNovelNotices(ctx, 25); err != nil || n != 1 {
		t.Fatal("late restored hole lost", err)
	}
	page = novelResult[novel.NoticePage](t, call("GET", root, nil, other, 200))
	if len(page.Items) != 2 || page.Items[0].ReadableChapters != 1 {
		t.Fatal("late chapter not separate summary")
	}
	// Immutable coverage: the already-read first summary never absorbs the late chapter.
	detail = novelResult[novel.NoticeDetail](t, call("GET", detailRoot, nil, other, 200))
	if detail.Notice.ReadableChapters != 102 || detail.Notice.ReadAt == nil {
		t.Fatal("old read message expanded")
	}
	if n, err := s.DispatchNovelNotices(ctx, 25); err != nil || n != 0 {
		t.Fatal("restore repeated notification", err)
	}
	visibility(hidden[0], "hide")
	detail = novelResult[novel.NoticeDetail](t, call("GET", detailRoot, nil, other, 200))
	if detail.Notice.ReadableChapters != 101 || detail.Items[0].Title != nil || detail.Items[0].Readable {
		t.Fatal("sent hidden chapter title leaked")
	}
	visibility(uuid.Nil, "hide")
	detail = novelResult[novel.NoticeDetail](t, call("GET", detailRoot, nil, other, 200))
	if detail.Notice.Book != nil || detail.Notice.ReadableChapters != 0 || len(detail.Items) != 0 {
		t.Fatal("sent hidden book leaked")
	}
	visibility(uuid.Nil, "restore")
	// Closing and reopening starts beyond the closed generation's new release.
	off, e := s.WriteShelf(ctx, other, book.ID, novel.ShelfWrite{MutationID: uuid.New(), BaseRevision: join.State.Revision, Operation: "unfollow"})
	if e != nil {
		t.Fatal(e)
	}
	closedChapter := publish()
	on, e := s.WriteShelf(ctx, other, book.ID, novel.ShelfWrite{MutationID: uuid.New(), BaseRevision: off.State.Revision, Operation: "follow"})
	if e != nil {
		t.Fatal(e)
	}
	if n, err := s.DispatchNovelNotices(ctx, 25); err != nil || n != 0 {
		t.Fatal("closed backlog crossed generation", err)
	}
	var leaked int
	if e = db.QueryRow("SELECT COUNT(*) FROM novel_notice_deliveries WHERE account_id=? AND chapter_id=?", other[:], closedChapter[:]).Scan(&leaked); e != nil || leaked != 0 {
		t.Fatal("closed event covered", e)
	}
	// A cancelled, lock-blocked transaction must not commit an orphan header.
	publish()
	blocker, e := db.Conn(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = blocker.ExecContext(ctx, "LOCK TABLES novel_notice_deliveries READ"); e != nil {
		blocker.Close()
		t.Fatal(e)
	}
	// Failure injection uses only the isolated schema's table lock; no SUPER grant
	// or log_bin_trust_function_creators relaxation is required.
	blockedCtx, cancel := context.WithTimeout(ctx, 250*time.Millisecond)
	_, dispatchErr := s.DispatchNovelNotices(blockedCtx, 25)
	cancel()
	_, unlockErr := blocker.ExecContext(ctx, "UNLOCK TABLES")
	blocker.Close()
	if unlockErr != nil {
		t.Fatal(unlockErr)
	}
	if dispatchErr == nil {
		t.Fatal("blocked transaction did not cancel")
	}
	var count int
	if e = db.QueryRow("SELECT COUNT(*) FROM novel_notices WHERE account_id=?", other[:]).Scan(&count); e != nil || count != 2 {
		t.Fatal("orphan header committed", e)
	}
	if n, err := s.DispatchNovelNotices(ctx, 25); err != nil || n != 1 {
		t.Fatal("failed dispatch did not recover", err)
	}
	// Build enough independent, frozen summaries for inbox pagination.
	for i := 0; i < 11; i++ {
		if _, e = db.Exec("UPDATE chapter_previews SET created_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 2 HOUR) WHERE owner_id=?", owner[:]); e != nil {
			t.Fatal(e)
		}
		publish()
		if _, e = s.DispatchNovelNotices(ctx, 25); e != nil {
			t.Fatal(e)
		}
	}
	page = novelResult[novel.NoticePage](t, call("GET", root, nil, other, 200))
	if len(page.Items) != 12 || page.NextCursor == "" {
		t.Fatal("inbox not paginated")
	}
	second := novelResult[novel.NoticePage](t, call("GET", root+"?cursor="+page.NextCursor, nil, other, 200))
	if len(second.Items) != 2 || second.NextCursor != "" {
		t.Fatal("inbox tail missing")
	}
	call("GET", root+"?cursor="+page.NextCursor, nil, owner, 400)
	if _, e = s.WriteShelf(ctx, other, book.ID, novel.ShelfWrite{MutationID: uuid.New(), BaseRevision: on.State.Revision, Operation: "remove"}); e != nil {
		t.Fatal(e)
	}
	kept := novelResult[novel.NoticePage](t, call("GET", root, nil, other, 200))
	if len(kept.Items) != 12 {
		t.Fatal("removal deleted historical messages")
	}
	// A lower reserved ordinal may become formal after a higher ordinal has already notified.
	if _, e = s.WriteShelf(ctx, owner, book.ID, novel.ShelfWrite{MutationID: uuid.New(), Operation: "join"}); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ChangeAuthorPolicy(ctx, operator, book.ID, novel.AuthorPolicyAction{MutationID: uuid.New(), Action: "start", Reason: "审核乱序合成验收"}); e != nil {
		t.Fatal(e)
	}
	a, b := publish(), publish()
	if n, err := s.DispatchNovelNotices(ctx, 25); err != nil || n != 0 {
		t.Fatal("pending chapters notified", err)
	}
	approve := func(ch uuid.UUID) {
		t.Helper()
		var raw []byte
		if err := db.QueryRow("SELECT current_submission_id FROM novel_chapters WHERE id=?", ch[:]).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		submission, err := uuid.FromBytes(raw)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = s.DecideChapter(ctx, operator, book.ID, submission, novel.DecideChapter{MutationID: uuid.New(), Decision: "approve"}); err != nil {
			t.Fatal(err)
		}
		if n, err := s.DispatchNovelNotices(ctx, 25); err != nil || n != 1 {
			t.Fatal("late reviewed release missing", err)
		}
	}
	approve(b)
	approve(a)
	late := novelResult[novel.NoticePage](t, call("GET", root, nil, owner, 200))
	if len(late.Items) != 2 {
		t.Fatal("out of order review lost notice")
	}
	seen := map[uuid.UUID]bool{}
	for _, n := range late.Items {
		detail := novelResult[novel.NoticeDetail](t, call("GET", root+"/"+n.ID.String(), nil, owner, 200))
		if len(detail.Items) != 1 {
			t.Fatal("late event changed frozen coverage")
		}
		seen[detail.Items[0].ID] = true
	}
	if !seen[a] || !seen[b] {
		t.Fatal("low ordinal late approval skipped")
	}

}
