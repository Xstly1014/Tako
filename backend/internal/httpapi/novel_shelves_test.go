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

func TestNovelShelfHTTPPrivacyCASAndSubscriptions(t *testing.T) {
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
			for _, q := range []string{"DELETE FROM novel_shelf_requests WHERE account_id=?", "DELETE FROM novel_shelves WHERE account_id=?", "DELETE FROM novel_reading_requests WHERE account_id=?", "DELETE FROM novel_reading_positions WHERE account_id=?", "DELETE FROM novel_author_policy_events WHERE actor_id=?", "DELETE FROM novel_management_requests WHERE actor_id=?", "DELETE FROM novel_publication_requests WHERE owner_id=?"} {
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
	root := "/api/my/novel-shelf/" + book.ID.String()
	call("GET", root, nil, uuid.Nil, 401)
	empty := novelResult[novel.ShelfState](t, call("GET", root, nil, other, 200))
	if empty.InShelf || empty.Following || empty.Revision != 0 || empty.AddedAt != nil {
		t.Fatal("empty relation leaked")
	}
	call("GET", "/api/my/novel-shelf/"+uuid.NewString(), nil, other, 200)
	private, e := s.Write(ctx, owner, uuid.Nil, novel.Write{MutationID: uuid.New(), Title: "private title", Tags: []string{"日常"}})
	if e != nil {
		t.Fatal(e)
	}
	call("POST", "/api/my/novel-shelf/"+private.ID.String(), novel.ShelfWrite{MutationID: uuid.New(), Operation: "join"}, other, 404)
	join := novel.ShelfWrite{MutationID: uuid.New(), Operation: "join"}
	first := novelResult[novel.ShelfReceipt](t, call("POST", root, join, other, 200))
	if !first.State.InShelf || !first.State.Following || first.State.Revision != 1 || first.State.Generation != 1 {
		t.Fatal("join not atomic")
	}
	retry := novelResult[novel.ShelfReceipt](t, call("POST", root, join, other, 200))
	if !reflect.DeepEqual(first, retry) {
		t.Fatal("receipt changed")
	}
	call("GET", root+"/requests/"+join.MutationID.String(), nil, owner, 404)
	call("GET", root+"/requests/"+join.MutationID.String(), nil, operator, 404)
	call("GET", "/api/my/novel-shelf/"+private.ID.String()+"/requests/"+join.MutationID.String(), nil, other, 404)
	call("POST", "/api/my/novel-shelf/"+private.ID.String(), join, other, 409)
	bad := join
	bad.Operation = "remove"
	call("POST", root, bad, other, 409)
	var start, want uint64
	if e = db.QueryRow("SELECT start_sequence FROM novel_shelves WHERE account_id=? AND novel_id=?", other[:], book.ID[:]).Scan(&start); e != nil {
		t.Fatal(e)
	}
	if e = db.QueryRow("SELECT MAX(release_sequence) FROM chapter_release_events WHERE novel_id=?", book.ID[:]).Scan(&want); e != nil || start != want || start == 0 {
		t.Fatal("wrong event boundary", e)
	}
	pos, e := s.SaveReading(ctx, other, book.ID, novel.ReadingWrite{MutationID: uuid.New(), ChapterID: chapter, Version: 1, Locator: novel.ReadingLocator{Algorithm: 1}})
	if e != nil {
		t.Fatal(e)
	}
	change := func(op string, base uint64) novel.ShelfReceipt {
		t.Helper()
		return novelResult[novel.ShelfReceipt](t, call("POST", root, novel.ShelfWrite{MutationID: uuid.New(), Operation: op, BaseRevision: base}, other, 200))
	}
	off := change("unfollow", 1)
	if !off.State.InShelf || off.State.Following || off.State.Generation != 1 {
		t.Fatal("unfollow removed shelf")
	}
	call("POST", root, novel.ShelfWrite{MutationID: uuid.New(), Operation: "follow", BaseRevision: 1}, other, 409)
	// A genuine chapter first-releases while following is off. Reopening starts
	// after this committed event; it must not inherit the old subscription backlog.
	extra := draft.Store{DB: db, Chapter: &draft.ChapterScope{NovelID: book.ID, ChapterID: uuid.New()}}
	ed, err := extra.Write(ctx, owner, "create", draft.Write{MutationID: uuid.New(), Title: "关闭期间的新章", Content: "合成正文"})
	if err != nil {
		t.Fatal(err)
	}
	ep, err := s.PrepareChapter(ctx, owner, book.ID, novel.PrepareChapter{MutationID: uuid.New(), DraftID: ed.DraftID, SourceRevision: ed.Revision, BookRevision: book.Revision})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.SubmitChapter(ctx, owner, book.ID, novel.SubmitChapter{MutationID: uuid.New(), PreviewID: ep.PreviewID, RightsConfirmed: true}); err != nil {
		t.Fatal(err)
	}
	on := change("follow", 2)
	if on.State.Generation != 2 || !on.State.Following || !on.State.AddedAt.Equal(*first.State.AddedAt) {
		t.Fatal("follow generation/order wrong")
	}
	var reopened uint64
	if e = db.QueryRow("SELECT start_sequence FROM novel_shelves WHERE account_id=? AND novel_id=?", other[:], book.ID[:]).Scan(&reopened); e != nil || reopened <= start {
		t.Fatal("reopening inherited old event boundary", e)
	}
	removed := change("remove", 3)
	if removed.State.InShelf || removed.State.Following {
		t.Fatal("remove kept following")
	}
	saved, e := s.ReadingState(ctx, other, book.ID)
	if e != nil || saved.Position == nil || !reflect.DeepEqual(*saved.Position, pos) {
		t.Fatal("remove lost private position", e)
	}
	retry = novelResult[novel.ShelfReceipt](t, call("POST", root, join, other, 200))
	current, e := s.ShelfState(ctx, other, book.ID)
	if e != nil || !reflect.DeepEqual(first, retry) || current.InShelf || current.Revision != 4 {
		t.Fatal("old receipt revived relation", e)
	}
	// A transaction hides while join is waiting on the same book. Eligibility must
	// read after that lock, not the snapshot opened by the earlier receipt lookup.
	tx, e := db.BeginTx(ctx, nil)
	if e != nil {
		t.Fatal(e)
	}
	var locked []byte
	if e = tx.QueryRow("SELECT id FROM novels WHERE id=? FOR UPDATE", book.ID[:]).Scan(&locked); e != nil {
		tx.Rollback()
		t.Fatal(e)
	}
	if _, e = tx.Exec("UPDATE novels SET author_hidden=TRUE WHERE id=?", book.ID[:]); e != nil {
		tx.Rollback()
		t.Fatal(e)
	}
	waiting := make(chan error, 1)
	go func() {
		_, err := s.WriteShelf(ctx, other, book.ID, novel.ShelfWrite{MutationID: uuid.New(), BaseRevision: 4, Operation: "join"})
		waiting <- err
	}()
	select {
	case <-waiting:
		tx.Rollback()
		t.Fatal("join bypassed book lock")
	case <-time.After(80 * time.Millisecond):
	}
	if e = tx.Commit(); e != nil {
		t.Fatal(e)
	}
	select {
	case e = <-waiting:
		if !errors.Is(e, novel.ErrNotFound) {
			t.Fatal("stale visibility snapshot", e)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("book lock did not release")
	}
	if _, e = db.Exec("UPDATE novels SET author_hidden=FALSE WHERE id=?", book.ID[:]); e != nil {
		t.Fatal(e)
	}
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.WriteShelf(ctx, other, book.ID, novel.ShelfWrite{MutationID: uuid.New(), BaseRevision: 4, Operation: "join"})
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	ok, conflicts := 0, 0
	for err := range results {
		if err == nil {
			ok++
		} else if errors.Is(err, novel.ErrShelfConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if ok != 1 || conflicts != 1 {
		t.Fatal("concurrent joins not CAS")
	}
	current, e = s.ShelfState(ctx, other, book.ID)
	if e != nil || current.Revision != 5 || current.Generation != 3 {
		t.Fatal("race created extra generation", e)
	}
	state, e := s.NovelState(ctx, owner, book.ID)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.ChangeVisibility(ctx, owner, book.ID, uuid.Nil, novel.VisibilityAction{MutationID: uuid.New(), ExpectedRevision: state.StateRevision, Action: "hide"}); e != nil {
		t.Fatal(e)
	}
	page := novelResult[novel.ShelfPage](t, call("GET", "/api/my/novel-shelf", nil, other, 200))
	if len(page.Items) != 1 || page.Items[0].Book != nil || !page.Items[0].Relation.InShelf {
		t.Fatal("unavailable shelf lost or leaked metadata")
	}
	change("unfollow", 5)
	call("POST", root, novel.ShelfWrite{MutationID: uuid.New(), Operation: "follow", BaseRevision: 6}, other, 404)
	change("remove", 6)
	call("POST", root, novel.ShelfWrite{MutationID: uuid.New(), Operation: "join"}, operator, 404)
	// The unavailable gap did not alter either the private pointer or its owner.
	saved, e = s.ReadingState(ctx, other, book.ID)
	if e != nil || saved.Position == nil || !reflect.DeepEqual(*saved.Position, pos) {
		t.Fatal("hidden controls lost position", e)
	}
	emptyPage := novelResult[novel.ShelfPage](t, call("GET", "/api/my/novel-shelf", nil, owner, 200))
	if len(emptyPage.Items) != 0 {
		t.Fatal("cross-account shelf exposed")
	}
	// Book-level platform restriction also blocks new subscriptions without
	// discarding existing relation tombstones or the private position.
	if _, e = db.Exec("UPDATE novels SET author_hidden=FALSE,platform_limited=TRUE WHERE id=?", book.ID[:]); e != nil {
		t.Fatal(e)
	}
	call("POST", root, novel.ShelfWrite{MutationID: uuid.New(), Operation: "join", BaseRevision: 7}, other, 404)
	call("POST", root, map[string]any{"mutation_id": uuid.NewString(), "operation": "join", "base_revision": 7, "owner_id": owner.String()}, other, 400)
	disabled := gin.New()
	if e = (API{DB: db, Drafts: draft.Store{DB: db}, Identity: &identity.Service{DB: db}, Origin: "http://localhost:3000"}).Register(disabled); e != nil {
		t.Fatal(e)
	}
	active := r
	r = disabled
	call("GET", root, nil, other, 503)
	r = active
	// Actual publication creates each public fixture; no direct fake public rows.
	for i := 0; i < 14; i++ {
		b, err := s.Write(ctx, owner, uuid.Nil, novel.Write{MutationID: uuid.New(), Title: "分页书", Tags: []string{"日常"}})
		if err != nil {
			t.Fatal(err)
		}
		cs := draft.Store{DB: db, Chapter: &draft.ChapterScope{NovelID: b.ID, ChapterID: uuid.New()}}
		d, err := cs.Write(ctx, owner, "create", draft.Write{MutationID: uuid.New(), Title: "正式章", Content: "分页正文"})
		if err != nil {
			t.Fatal(err)
		}
		preview, err := s.PrepareChapter(ctx, owner, b.ID, novel.PrepareChapter{MutationID: uuid.New(), DraftID: d.DraftID, SourceRevision: d.Revision, BookRevision: b.Revision})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = s.SubmitChapter(ctx, owner, b.ID, novel.SubmitChapter{MutationID: uuid.New(), PreviewID: preview.PreviewID, RightsConfirmed: true}); err != nil {
			t.Fatal(err)
		}
		if _, err = s.WriteShelf(ctx, other, b.ID, novel.ShelfWrite{MutationID: uuid.New(), Operation: "join"}); err != nil {
			t.Fatal(err)
		}
	}
	page = novelResult[novel.ShelfPage](t, call("GET", "/api/my/novel-shelf", nil, other, 200))
	if len(page.Items) != 12 || page.NextCursor == "" {
		t.Fatal("unbounded shelf page")
	}
	page2 := novelResult[novel.ShelfPage](t, call("GET", "/api/my/novel-shelf?cursor="+page.NextCursor, nil, other, 200))
	if len(page2.Items) != 2 || page2.NextCursor != "" {
		t.Fatal("shelf pagination missing")
	}
	seen := map[uuid.UUID]bool{}
	for _, item := range append(page.Items, page2.Items...) {
		if seen[item.Relation.NovelID] || item.Book == nil || item.Book.ID != item.Relation.NovelID {
			t.Fatal("duplicate or mixed shelf projection")
		}
		seen[item.Relation.NovelID] = true
	}
	call("GET", "/api/my/novel-shelf?cursor="+page.NextCursor, nil, owner, 400)
	call("GET", "/api/my/novel-shelf?cursor=broken", nil, other, 400)
}
