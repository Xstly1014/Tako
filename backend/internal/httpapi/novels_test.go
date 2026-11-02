package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/novel"
)

func TestPrivateNovelsContractIsolationAndConcurrency(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("real MySQL required")
	}
	db, e := sql.Open("mysql", dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	service := &identity.Service{DB: db, Pepper: []byte(uuid.NewString())}
	r := gin.New()
	if e = (API{DB: db, Identity: service, AuthMode: "password", Origin: "http://localhost:3000"}).Register(r); e != nil {
		t.Fatal(e)
	}
	call := func(method, path string, body any, token string, want int) *httptest.ResponseRecorder {
		t.Helper()
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(method, path, strings.NewReader(string(raw)))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		out := httptest.NewRecorder()
		r.ServeHTTP(out, req)
		validateResponse(t, req, out)
		if out.Code != want {
			t.Fatalf("%s %s status %d want %d", method, path, out.Code, want)
		}
		return out
	}
	type session struct {
		Token   string           `json:"access_token"`
		Account identity.Account `json:"account"`
	}
	sessions := []session{}
	defer func() {
		for _, ss := range sessions {
			db.Exec("DELETE FROM novel_mutations WHERE owner_id=?", ss.Account.ID[:])
			db.Exec("DELETE FROM novels WHERE owner_id=?", ss.Account.ID[:])
			db.Exec("DELETE FROM sessions WHERE account_id=?", ss.Account.ID[:])
			db.Exec("DELETE FROM accounts WHERE id=?", ss.Account.ID[:])
		}
	}()
	for range 2 {
		out := call("POST", "/api/app/auth/register", map[string]string{"email": uuid.NewString() + "@example.test", "password": "novel-test-password"}, "", 200)
		var ss session
		if json.Unmarshal(out.Body.Bytes(), &ss) != nil {
			t.Fatal("session")
		}
		sessions = append(sessions, ss)
		call("PATCH", "/api/me", map[string]string{"nickname": "小说测试"}, ss.Token, 200)
	}
	a, b := sessions[0], sessions[1]
	in := novel.Write{MutationID: uuid.New(), Title: "冒险🚀", Introduction: "测试资料", Tags: []string{"幻想", "冒险"}}
	call("GET", "/api/my/novels", nil, "", 401)
	var book novel.Book
	if e = json.Unmarshal(call("POST", "/api/my/novels", in, a.Token, 200).Body.Bytes(), &book); e != nil {
		t.Fatal(e)
	}
	var retry novel.Book
	json.Unmarshal(call("POST", "/api/my/novels", in, a.Token, 200).Body.Bytes(), &retry)
	if retry.ID != book.ID || retry.Revision != 1 || !retry.SavedAt.Equal(book.SavedAt) {
		t.Fatal("create retry changed result")
	}
	path := "/api/my/novels/" + book.ID.String()
	reused := in
	reused.BaseRevision = 1
	call("POST", path, reused, a.Token, 409)
	call("GET", path, nil, b.Token, 404)
	call("GET", "/api/my/novel-mutations/"+in.MutationID.String(), nil, b.Token, 404)
	wrong := in
	wrong.Title = "改变的载荷"
	call("POST", "/api/my/novels", wrong, a.Token, 409)
	wrong.MutationID = uuid.New()
	wrong.BaseRevision = 1
	call("POST", path, wrong, b.Token, 404)
	call("POST", path, in, a.Token, 400)
	invalid := in
	invalid.MutationID = uuid.New()
	invalid.Tags = []string{"幻想", "幻想"}
	call("POST", "/api/my/novels", invalid, a.Token, 400)
	invalid.Tags = []string{"幻想"}
	invalid.Title = strings.Repeat("字", 201)
	call("POST", "/api/my/novels", invalid, a.Token, 400)
	invalid.Title = "空字符\x00"
	call("POST", "/api/my/novels", invalid, a.Token, 400)
	call("POST", "/api/my/novels", map[string]any{"owner_id": b.Account.ID, "mutation_id": uuid.New(), "base_revision": 0, "title": "注入", "introduction": "", "tags": []string{"幻想"}}, a.Token, 400)
	call("GET", "/api/my/novels?cursor=invalid", nil, a.Token, 400)
	store := novel.Store{DB: db}
	ctx := context.Background()
	inputs := []novel.Write{wrong, wrong}
	inputs[0].MutationID = uuid.New()
	inputs[1].MutationID = uuid.New()
	inputs[1].Title = "另一端"
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, v := range inputs {
		wg.Add(1)
		go func(in novel.Write) {
			defer wg.Done()
			_, err := store.Write(ctx, a.Account.ID, book.ID, in)
			results <- err
		}(v)
	}
	wg.Wait()
	close(results)
	ok, conflict := 0, 0
	for err := range results {
		if err == nil {
			ok++
		} else if err == novel.ErrConflict {
			conflict++
		} else {
			t.Fatal(err)
		}
	}
	if ok != 1 || conflict != 1 {
		t.Fatal("concurrent overwrite")
	}
	current, e := store.Read(ctx, a.Account.ID, book.ID)
	if e != nil || current.Revision != 2 {
		t.Fatal("current revision", e)
	}
	call("GET", "/api/my/novel-mutations/"+in.MutationID.String(), nil, a.Token, 200)
	var original novel.Book
	json.Unmarshal(call("POST", "/api/my/novels", in, a.Token, 200).Body.Bytes(), &original)
	if original.Revision != 1 {
		t.Fatal("receipt not immutable")
	}
	stale := wrong
	stale.MutationID = uuid.New()
	call("POST", path, stale, a.Token, 409)
	for range 21 {
		extra := in
		extra.MutationID = uuid.New()
		if _, e = store.Write(ctx, a.Account.ID, uuid.Nil, extra); e != nil {
			t.Fatal(e)
		}
	}
	var page novel.Page
	json.Unmarshal(call("GET", "/api/my/novels", nil, a.Token, 200).Body.Bytes(), &page)
	if len(page.Items) != 20 || page.NextCursor == "" {
		t.Fatal("bounded page")
	}
	call("GET", "/api/my/novels?cursor="+page.NextCursor, nil, b.Token, 400)
	var tail novel.Page
	json.Unmarshal(call("GET", "/api/my/novels?cursor="+page.NextCursor, nil, a.Token, 200).Body.Bytes(), &tail)
	if len(tail.Items) != 2 || tail.NextCursor != "" {
		t.Fatal("tail")
	}
	for _, x := range tail.Items {
		for _, y := range page.Items {
			if x.ID == y.ID {
				t.Fatal("duplicate page")
			}
		}
	}
	var count int
	if e = db.QueryRow("SELECT COUNT(*) FROM drafts WHERE owner_id=?", a.Account.ID[:]).Scan(&count); e != nil || count != 0 {
		t.Fatal("novel created mid draft", e)
	}
	// No public longform route is installed in this private phase.
	req := httptest.NewRequest("GET", "/api/novels/"+book.ID.String(), nil)
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)
	if res.Code != 400 && res.Code != 404 {
		t.Fatal("private book exposed")
	}
}
