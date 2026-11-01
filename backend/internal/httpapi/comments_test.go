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
	"strings"
	"testing"
	"writing.local/community/internal/draft"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/publication"
)

func TestCommentHTTPContextContractAndRoles(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("real MySQL required")
	}
	db, e := sql.Open("mysql", dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	ctx := context.Background()
	owner, reader := uuid.New(), uuid.New()
	tokens := map[uuid.UUID]string{owner: strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""), reader: strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", "")}
	for _, id := range []uuid.UUID{owner, reader} {
		if _, e = db.Exec("INSERT INTO accounts(id,email,nickname) VALUES(?,?,?)", id[:], id.String()+"@example.test", "评论验收"); e != nil {
			t.Fatal(e)
		}
		if e = insertLegacySession(ctx, db, id, tokens[id]); e != nil {
			t.Fatal(e)
		}
	}
	s := publication.Store{DB: db}
	d, e := (draft.Store{DB: db}).Write(ctx, owner, "create", draft.Write{MutationID: uuid.New(), Title: "评论契约测试", Content: "普通正文"})
	if e != nil {
		t.Fatal(e)
	}
	preview, e := s.Prepare(ctx, owner, publication.Prepare{MutationID: uuid.New(), DraftID: d.DraftID, SourceRevision: 1, RightsConfirmed: true, Tags: []string{"日常"}})
	if e != nil {
		t.Fatal(e)
	}
	published, e := s.Publish(ctx, owner, publication.Publish{MutationID: uuid.New(), PreviewID: preview.ID})
	if e != nil {
		t.Fatal(e)
	}
	work := published.WorkID
	defer func() {
		db.Exec("DELETE a FROM comment_actions a JOIN work_comments c ON c.id=a.comment_id WHERE c.work_id=?", work[:])
		for _, id := range []uuid.UUID{owner, reader} {
			db.Exec("DELETE FROM comment_mutations WHERE actor_id=?", id[:])
		}
		db.Exec("DELETE FROM work_comments WHERE work_id=? AND root_id IS NOT NULL ORDER BY sequence DESC", work[:])
		db.Exec("DELETE FROM work_comments WHERE work_id=?", work[:])
		db.Exec("DELETE FROM publication_review_tasks WHERE work_id=?", work[:])
		db.Exec("DELETE FROM publication_mutations WHERE work_id=?", work[:])
		db.Exec("DELETE FROM work_versions WHERE work_id=?", work[:])
		db.Exec("DELETE FROM publication_previews WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM works WHERE id=?", work[:])
		db.Exec("DELETE FROM draft_mutations WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM drafts WHERE owner_id=?", owner[:])
		for _, id := range []uuid.UUID{owner, reader} {
			db.Exec("DELETE FROM sessions WHERE account_id=?", id[:])
			db.Exec("DELETE FROM accounts WHERE id=?", id[:])
		}
	}()
	api := API{DB: db, Identity: &identity.Service{DB: db, Pepper: []byte(strings.Repeat("x", 32))}, Origin: "http://localhost:3000", EnablePublications: true, OperatorAccounts: owner.String()}
	router := gin.New()
	if e = api.Register(router); e != nil {
		t.Fatal(e)
	}
	call := func(method, path string, body any, token string, status int) *httptest.ResponseRecorder {
		t.Helper()
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(method, path, strings.NewReader(string(raw)))
		req.Header.Set("Origin", api.Origin)
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.AddCookie(&http.Cookie{Name: "tako_session", Value: token})
		}
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		validateResponse(t, req, res)
		if res.Code != status {
			t.Fatalf("%s %s: got %d want %d", method, path, res.Code, status)
		}
		return res
	}
	path := "/api/works/" + work.String()
	read := call("GET", path, nil, "", 200)
	var body publication.Work
	if e = json.Unmarshal(read.Body.Bytes(), &body); e != nil || body.CommentContext == "" {
		t.Fatal("context missing", e)
	}
	in := publication.CommentCreate{MutationID: uuid.New(), ExpectedAccountID: reader, Content: "不保存版本", Context: body.CommentContext}
	call("POST", path+"/comments", in, "", 401)
	invalid := in
	invalid.Context += "bad"
	call("POST", path+"/comments", invalid, tokens[reader], 409)
	result := call("POST", path+"/comments", in, tokens[reader], 200)
	again := call("POST", path+"/comments", in, tokens[reader], 200)
	if result.Body.String() != again.Body.String() {
		t.Fatal("receipt differs")
	}
	var out publication.CommentResult
	json.Unmarshal(result.Body.Bytes(), &out)
	call("GET", path+"/comments", nil, "", 200)
	call("GET", path+"/comments?root=invalid", nil, "", 400)
	call("GET", "/api/ops/comments", nil, tokens[reader], 403)
	call("GET", "/api/ops/comments", nil, tokens[owner], 200)
	action := publication.CommentAction{MutationID: uuid.New(), ExpectedAccountID: owner, ExpectedRevision: 1, Action: "block", Reason: "测试风险原因"}
	call("POST", "/api/ops/comments/"+out.ID.String()+"/actions", action, tokens[owner], 200)
	own := call("GET", "/api/my/comments", nil, tokens[reader], 200)
	if !strings.Contains(own.Body.String(), "测试风险原因") {
		t.Fatal("own reason missing")
	}
	other := call("GET", "/api/my/comments", nil, tokens[owner], 200)
	if strings.Contains(other.Body.String(), "测试风险原因") {
		t.Fatal("private reason leaked")
	}
	public := call("GET", path+"/comments", nil, "", 200)
	if strings.Contains(public.Body.String(), "不保存版本") {
		t.Fatal("blocked body leaked")
	}
	action.MutationID = uuid.New()
	action.Action = "unblock"
	action.ExpectedRevision = 2
	call("POST", "/api/ops/comments/"+out.ID.String()+"/actions", action, tokens[owner], 200)
	action.MutationID = uuid.New()
	action.Action = "delete"
	action.ExpectedRevision = 3
	action.ExpectedAccountID = reader
	action.Reason = ""
	call("POST", "/api/comments/"+out.ID.String()+"/actions", action, tokens[reader], 200)
}
