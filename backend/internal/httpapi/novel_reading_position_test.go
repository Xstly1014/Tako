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

func TestNovelReadingPositionHTTPPrivacyAndRecovery(t *testing.T) {
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

	book, err := s.Write(ctx, owner, uuid.Nil, novel.Write{MutationID: uuid.New(), Title: "续读合成书", Tags: []string{"日常"}})
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
	root := "/api/my/novel-reading/" + book.ID.String()
	call("GET", root, nil, uuid.Nil, 401)
	empty := novelResult[novel.ReadingState](t, call("GET", root, nil, other, 200))
	if empty.Position != nil || empty.Readable || empty.CurrentVersion != nil {
		t.Fatal("empty reading state leaked")
	}
	call("GET", "/api/my/novel-reading/"+uuid.NewString(), nil, other, 200)
	input := novel.ReadingWrite{MutationID: uuid.New(), ChapterID: chapter, Version: 1, Locator: novel.ReadingLocator{Algorithm: 1, Paragraph: 0, Offset: 2}}
	got := novelResult[novel.ReadingPosition](t, call("POST", root, input, other, 200))
	if got.Revision != 1 || got.ChapterID != chapter {
		t.Fatal("position receipt mismatch")
	}
	retry := novelResult[novel.ReadingPosition](t, call("POST", root, input, other, 200))
	if !reflect.DeepEqual(got, retry) {
		t.Fatal("retry changed")
	}
	receipt := root + "/requests/" + input.MutationID.String()
	call("GET", receipt, nil, owner, 404)
	call("GET", receipt, nil, operator, 404)
	state := novelResult[novel.ReadingState](t, call("GET", root, nil, other, 200))
	if state.Position == nil || !state.Readable || state.CurrentVersion == nil || *state.CurrentVersion != 1 {
		t.Fatal("state mismatch")
	}
	empty = novelResult[novel.ReadingState](t, call("GET", root, nil, owner, 200))
	if empty.Position != nil {
		t.Fatal("author read another reader")
	}
	bad := input
	bad.MutationID = uuid.New()
	bad.Locator.Offset = 4
	call("POST", root, bad, other, 400)
	bad.Locator = novel.ReadingLocator{Algorithm: 1, Paragraph: 4}
	call("POST", root, bad, other, 400)
	bad.Locator = novel.ReadingLocator{Algorithm: 1}
	bad.Version = 2
	call("POST", root, bad, other, 404)
	bad.Version = 1
	bad.ChapterID = uuid.New()
	call("POST", root, bad, other, 404)
	bad = input
	bad.Locator.Offset = 1
	call("POST", root, bad, other, 409)
	call("POST", root, map[string]any{"owner_id": owner, "mutation_id": uuid.New(), "base_revision": 1, "chapter_id": chapter, "version": 1, "locator": input.Locator}, other, 400)
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, off := range []uint64{0, 1} {
		wg.Add(1)
		go func(off uint64) {
			defer wg.Done()
			_, e := s.SaveReading(ctx, other, book.ID, novel.ReadingWrite{MutationID: uuid.New(), BaseRevision: 1, ChapterID: chapter, Version: 1, Locator: novel.ReadingLocator{Algorithm: 1, Offset: off}})
			results <- e
		}(off)
	}
	wg.Wait()
	close(results)
	success, conflicts := 0, 0
	for e := range results {
		if e == nil {
			success++
		} else if errors.Is(e, novel.ErrReadingConflict) {
			conflicts++
		} else {
			t.Fatal(e)
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatal("reading CAS failed")
	}
	stale := input
	stale.MutationID = uuid.New()
	call("POST", root, stale, other, 409)
	// A deliberate backward reading choice is valid, not max(chapter,offset).
	backward := input
	backward.MutationID = uuid.New()
	backward.BaseRevision = 2
	backward.Locator = novel.ReadingLocator{Algorithm: 1, Paragraph: 1, Offset: 0}
	call("POST", root, backward, other, 200)
	if _, e = db.Exec("UPDATE novels SET author_hidden=TRUE WHERE id=?", book.ID[:]); e != nil {
		t.Fatal(e)
	}
	state = novelResult[novel.ReadingState](t, call("GET", root, nil, other, 200))
	if state.Position == nil || state.Readable || state.CurrentVersion != nil {
		t.Fatal("unreadable location not preserved")
	}
	call("GET", receipt, nil, other, 200)
	call("POST", root, input, other, 200)
	hidden := backward
	hidden.MutationID = uuid.New()
	hidden.BaseRevision = 3
	call("POST", root, hidden, other, 404)
	call("GET", root+"/requests/"+uuid.NewString(), nil, other, 404)
	// Retention cannot erase current progress, and a missing old receipt never bypasses CAS.
	now := time.Now().UTC().Truncate(time.Microsecond)
	if _, e = db.Exec("UPDATE novel_reading_requests SET created_at=? WHERE account_id=?", now, other[:]); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("UPDATE novel_reading_requests SET created_at=? WHERE account_id=? AND mutation_id=?", now.Add(-31*24*time.Hour), other[:], input.MutationID[:]); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("UPDATE novel_reading_requests SET created_at=? WHERE account_id=? AND mutation_id=?", now.Add(-30*24*time.Hour), other[:], backward.MutationID[:]); e != nil {
		t.Fatal(e)
	}
	removed, e := s.CleanupReadingReceipts(ctx, now)
	if e != nil || removed != 1 {
		t.Fatal("retention boundary failed")
	}
	call("GET", receipt, nil, other, 404)
	call("GET", root+"/requests/"+backward.MutationID.String(), nil, other, 200)
	if _, e = db.Exec("UPDATE novels SET author_hidden=FALSE WHERE id=?", book.ID[:]); e != nil {
		t.Fatal(e)
	}
	call("POST", root, input, other, 409)
	retained := novelResult[novel.ReadingState](t, call("GET", root, nil, other, 200))
	if retained.Position == nil || retained.Position.Revision != 3 {
		t.Fatal("retention lost position")
	}
	// Synthetic stale receipts exercise the per-tick bound; they are never business responses.
	values := make([]string, 501)
	args := make([]any, 0, 501*4)
	for i := range values {
		mid := uuid.New()
		values[i] = "(?,?,?,?,JSON_OBJECT(),?)"
		args = append(args, other[:], mid[:], book.ID[:], make([]byte, 32), now.Add(-31*24*time.Hour))
	}
	if _, e = db.Exec("INSERT INTO novel_reading_requests(account_id,mutation_id,novel_id,payload_hash,result,created_at) VALUES "+strings.Join(values, ","), args...); e != nil {
		t.Fatal(e)
	}
	removed, e = s.CleanupReadingReceipts(ctx, now)
	if e != nil || removed != 500 {
		t.Fatal("retention batch unbounded")
	}
	removed, e = s.CleanupReadingReceipts(ctx, now)
	if e != nil || removed != 1 {
		t.Fatal("retention next batch failed")
	}

}
