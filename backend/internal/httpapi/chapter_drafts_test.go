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

func TestPrivateChapterDraftIsolationAndLegacyCompatibility(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("real MySQL required")
	}
	db, e := sql.Open("mysql", dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	owner, other := uuid.New(), uuid.New()
	token, otherToken := strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""), strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", "")
	for _, id := range []uuid.UUID{owner, other} {
		if _, e = db.Exec("INSERT INTO accounts(id,email,nickname) VALUES(?,?,?)", id[:], id.String()+"@example.test", "章节测试"); e != nil {
			t.Fatal(e)
		}
	}
	defer func() {
		db.Exec("UPDATE novel_chapters SET primary_draft_id=NULL WHERE owner_id=?", owner[:])
		db.Exec("UPDATE chapter_drafts SET recovered_from_id=NULL WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM chapter_draft_mutations WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM chapter_drafts WHERE owner_id=?", owner[:])
		db.Exec("UPDATE drafts SET recovered_from_id=NULL WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM draft_mutations WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM drafts WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM novel_chapters WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM novel_mutations WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM novels WHERE owner_id=?", owner[:])
		for _, id := range []uuid.UUID{owner, other} {
			db.Exec("DELETE FROM sessions WHERE account_id=?", id[:])
			db.Exec("DELETE FROM accounts WHERE id=?", id[:])
		}
	}()
	ctx := context.Background()
	if e = insertLegacySession(ctx, db, owner, token); e != nil {
		t.Fatal(e)
	}
	if e = insertLegacySession(ctx, db, other, otherToken); e != nil {
		t.Fatal(e)
	}
	r := gin.New()
	if e = (API{DB: db, Drafts: draft.Store{DB: db}, Identity: &identity.Service{DB: db}, Origin: "http://localhost:3000", EnablePublications: true}).Register(r); e != nil {
		t.Fatal(e)
	}
	call := func(method, path string, body any, cookie string, want int) *httptest.ResponseRecorder {
		t.Helper()
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(method, path, strings.NewReader(string(raw)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "http://localhost:3000")
		if cookie != "" {
			req.AddCookie(&http.Cookie{Name: "tako_session", Value: cookie})
		}
		out := httptest.NewRecorder()
		r.ServeHTTP(out, req)
		validateResponse(t, req, out)
		if out.Code != want {
			t.Fatalf("%s %s status %d want %d", method, path, out.Code, want)
		}
		return out
	}
	book, e := (novel.Store{DB: db}).Write(ctx, owner, uuid.Nil, novel.Write{MutationID: uuid.New(), Title: "私密章节书", Tags: []string{"冒险"}})
	if e != nil {
		t.Fatal(e)
	}
	another, e := (novel.Store{DB: db}).Write(ctx, owner, uuid.Nil, novel.Write{MutationID: uuid.New(), Title: "另一本私密书", Tags: []string{"日常"}})
	if e != nil {
		t.Fatal(e)
	}
	root := "/api/my/novels/" + book.ID.String() + "/chapter-drafts"
	in := draft.Write{MutationID: uuid.New(), Title: "章稿😀", Content: "私密章节正文"}
	chapter := privateChapterID(book.ID, owner, in.MutationID, "create")
	call("GET", "/api/my/novels/"+book.ID.String()+"/chapters", nil, "", 401)
	call("POST", root+"/create", in, otherToken, 404)
	var first draft.Result
	json.Unmarshal(call("POST", root+"/create", in, token, 200).Body.Bytes(), &first)
	var replay draft.Result
	json.Unmarshal(call("POST", root+"/create", in, token, 200).Body.Bytes(), &replay)
	if replay != first {
		t.Fatal("duplicate chapter creation")
	}
	newRequest := in
	newRequest.MutationID = uuid.New()
	call("POST", root+"/create", newRequest, token, 200)
	duplicate := uuid.New()
	if _, e = db.Exec("INSERT INTO chapter_drafts(id,owner_id,title,content,novel_id,chapter_id) SELECT ?,owner_id,'duplicate','synthetic',novel_id,chapter_id FROM chapter_drafts WHERE id=?", duplicate[:], first.DraftID[:]); e == nil {
		t.Fatal("one chapter accepted multiple working drafts")
	}
	readPath := root + "/" + first.DraftID.String()
	call("GET", readPath, nil, token, 200)
	call("GET", readPath, nil, otherToken, 404)
	call("GET", "/api/drafts/"+first.DraftID.String(), nil, token, 404)
	save := draft.Write{MutationID: uuid.New(), DraftID: first.DraftID, BaseRevision: 1, Title: "修改章稿", Content: "保留的章节正文"}
	call("POST", "/api/drafts/save", save, token, 404)
	call("POST", "/api/drafts/recover", map[string]any{"mutation_id": uuid.New(), "draft_id": first.DraftID, "title": "误投", "content": "不得作为中篇副本"}, token, 404)
	call("POST", "/api/publication-previews", map[string]any{"mutation_id": uuid.New(), "draft_id": first.DraftID, "source_revision": 1, "rights_confirmed": true, "tags": []string{"幻想"}, "introduction": ""}, token, 404)
	foreignRoot := "/api/my/novels/" + another.ID.String() + "/chapter-drafts"
	call("GET", foreignRoot+"/"+first.DraftID.String(), nil, token, 404)
	call("POST", foreignRoot+"/save", save, token, 404)
	unknownChapter := privateChapterID(another.ID, owner, in.MutationID, "create")
	reuseRoot := "/api/my/novels/" + another.ID.String() + "/chapter-drafts"
	call("POST", reuseRoot+"/create", in, token, 409)
	var count int
	if e = db.QueryRow("SELECT COUNT(*) FROM novel_chapters WHERE id=?", unknownChapter[:]).Scan(&count); e != nil || count != 0 {
		t.Fatal("failed mutation leaked chapter", e)
	}
	scoped := draft.Store{DB: db, Chapter: &draft.ChapterScope{NovelID: book.ID, ChapterID: chapter}}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			input := save
			input.MutationID = uuid.New()
			_, err := scoped.Write(ctx, owner, "save", input)
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	ok, conflict := 0, 0
	for err := range results {
		if err == nil {
			ok++
		} else if errors.Is(err, draft.ErrConflict) {
			conflict++
		} else {
			t.Fatal(err)
		}
	}
	if ok != 1 || conflict != 1 {
		t.Fatal("chapter CAS overwrite")
	}
	call("POST", root+"/save", save, token, 409)
	if _, e = (draft.Store{DB: db}).ReadRevision(ctx, owner, first.DraftID, 1); !errors.Is(e, draft.ErrNotFound) {
		t.Fatal("old history exposed chapter", e)
	}
	if old, e := scoped.ReadRevision(ctx, owner, first.DraftID, 1); e != nil || old.Content != in.Content {
		t.Fatal("scoped history unavailable", e)
	}
	legacyInput := draft.Write{MutationID: uuid.New(), Title: "旧中篇", Content: "独立正文"}
	legacy, e := (draft.Store{DB: db}).Write(ctx, owner, "create", legacyInput)
	if e != nil {
		t.Fatal(e)
	}
	replayLegacy, e := (draft.Store{DB: db}).Write(ctx, owner, "create", legacyInput)
	if e != nil || legacy != replayLegacy {
		t.Fatal("legacy hash changed", e)
	}
	call("GET", root+"/"+legacy.DraftID.String(), nil, token, 404)
	var oldList draft.Page
	json.Unmarshal(call("GET", "/api/drafts", nil, token, 200).Body.Bytes(), &oldList)
	if len(oldList.Items) != 1 || oldList.Items[0].ID != legacy.DraftID {
		t.Fatal("legacy list contains chapter")
	}
	call("GET", root+"?cursor=bad", nil, token, 400)
	recovery := draft.Write{MutationID: uuid.New(), DraftID: first.DraftID, BaseRevision: 1, Title: "独立恢复章", Content: "冲突端文字"}
	var recovered draft.Result
	json.Unmarshal(call("POST", root+"/recover", recovery, token, 200).Body.Bytes(), &recovered)
	var recoveredAgain draft.Result
	json.Unmarshal(call("POST", root+"/recover", recovery, token, 200).Body.Bytes(), &recoveredAgain)
	if recovered != recoveredAgain || recovered.DraftID == first.DraftID {
		t.Fatal("recovery duplicated or overwrote")
	}
	recoveryChapter := privateChapterID(book.ID, owner, recovery.MutationID, "recover")
	var storedChapter []byte
	if e = db.QueryRow("SELECT chapter_id FROM chapter_drafts WHERE id=?", recovered.DraftID[:]).Scan(&storedChapter); e != nil || string(storedChapter) != string(recoveryChapter[:]) || recoveryChapter == chapter {
		t.Fatal("recovery is not independent chapter", e)
	}
	if _, e = scoped.Read(ctx, owner, recovered.DraftID); !errors.Is(e, draft.ErrNotFound) {
		t.Fatal("recovery retained old chapter scope", e)
	}
	if original, e := scoped.Read(ctx, owner, first.DraftID); e != nil || original.Revision != 2 || original.Content == recovery.Content {
		t.Fatal("recovery changed original", e)
	}
	call("GET", "/api/drafts/"+recovered.DraftID.String(), nil, token, 404)
	foreignRecovery := recovery
	foreignRecovery.MutationID = uuid.New()
	call("POST", foreignRoot+"/recover", foreignRecovery, token, 404)

	var page novel.ChapterPage
	json.Unmarshal(call("GET", "/api/my/novels/"+book.ID.String()+"/chapters", nil, token, 200).Body.Bytes(), &page)
	if len(page.Items) != 3 {
		t.Fatal("chapter identity")
	}
	call("GET", "/api/my/novels/"+book.ID.String()+"/chapters", nil, otherToken, 404)
	for range 20 {
		s := draft.Store{DB: db, Chapter: &draft.ChapterScope{NovelID: book.ID, ChapterID: uuid.New()}}
		input := in
		input.MutationID = uuid.New()
		if _, e = s.Write(ctx, owner, "create", input); e != nil {
			t.Fatal(e)
		}
	}
	json.Unmarshal(call("GET", "/api/my/novels/"+book.ID.String()+"/chapters", nil, token, 200).Body.Bytes(), &page)
	if len(page.Items) != 20 || page.NextCursor == "" {
		t.Fatal("chapter pagination")
	}
	call("GET", "/api/my/novels/"+another.ID.String()+"/chapters?cursor="+page.NextCursor, nil, token, 400)
	var tail novel.ChapterPage
	json.Unmarshal(call("GET", "/api/my/novels/"+book.ID.String()+"/chapters?cursor="+page.NextCursor, nil, token, 200).Body.Bytes(), &tail)
	if len(tail.Items) != 3 || tail.NextCursor != "" {
		t.Fatal("chapter page tail")
	}
	if e = db.QueryRow("SELECT COUNT(*) FROM works WHERE owner_id=?", owner[:]).Scan(&count); e != nil || count != 0 {
		t.Fatal("private chapter became public Work", e)
	}
	// The separate history table must participate in retention, while both the
	// current source revision and the independently recovered chapter survive.
	if _, e = db.Exec("UPDATE chapter_draft_revisions SET saved_at=? WHERE draft_id=?", time.Now().UTC().Add(-40*24*time.Hour), first.DraftID[:]); e != nil {
		t.Fatal(e)
	}
	if removed, err := scoped.CleanupRevisions(ctx, time.Now().UTC()); err != nil || removed != 1 {
		t.Fatal("chapter retention did not remove only old non-current history", err)
	}
	if _, err := scoped.ReadRevision(ctx, owner, first.DraftID, 1); !errors.Is(err, draft.ErrNotFound) {
		t.Fatal("expired chapter history retained", err)
	}
	if _, err := scoped.ReadRevision(ctx, owner, first.DraftID, 2); err != nil {
		t.Fatal("current chapter history removed", err)
	}
	if kept, err := (draft.Store{DB: db, Chapter: &draft.ChapterScope{NovelID: book.ID}}).Read(ctx, owner, recovered.DraftID); err != nil || kept.Content != recovery.Content {
		t.Fatal("retention changed recovery chapter", err)
	}
}
