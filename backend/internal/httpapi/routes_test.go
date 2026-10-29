package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"writing.local/community/internal/draft"
	"writing.local/community/internal/identity"
)

type testMail struct{ code string }

func TestUnavailableSessionStoreIsNotReportedAsExpiredLogin(t *testing.T) {
	db, err := sql.Open("mysql", "fixture:fixture@tcp(127.0.0.1:1)/writing_test")
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	if err = (API{Identity: &identity.Service{DB: db}, DB: db, Origin: "http://localhost:3000"}).Register(r); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("GET", "/api/me", nil)
	request.AddCookie(&http.Cookie{Name: "tako_session", Value: strings.Repeat("0", 64)})
	response := httptest.NewRecorder()
	r.ServeHTTP(response, request)
	if response.Code != 503 || !strings.Contains(response.Body.String(), "service_unavailable") {
		t.Fatal("dependency failure misclassified as invalid login")
	}
	if response.Header().Get("Set-Cookie") != "" {
		t.Fatal("dependency failure cleared login cookie")
	}
	validateResponse(t, request, response)
}

func (s *testMail) Send(_ context.Context, _ string, code string) error { s.code = code; return nil }

func TestLoginToSavedDraft(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("real MySQL required")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	mailConn, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var mailLocked int
	if err = mailConn.QueryRowContext(context.Background(), "SELECT GET_LOCK('tako_mail_integration',30)").Scan(&mailLocked); err != nil || mailLocked != 1 {
		mailConn.Close()
		t.Fatalf("mail fixture lock: %v", err)
	}
	t.Cleanup(func() {
		mailConn.ExecContext(context.Background(), "DO RELEASE_LOCK('tako_mail_integration')")
		mailConn.Close()
	})
	sender := &testMail{}
	auth := &identity.Service{DB: db, Pepper: []byte("http-integration-test-" + uuid.NewString()), Sender: sender, QueueKey: []byte("0123456789abcdef0123456789abcdef")}
	email := uuid.NewString() + "@example.test"
	t.Cleanup(func() {
		var id []byte
		if db.QueryRow("SELECT id FROM accounts WHERE email=?", email).Scan(&id) == nil {
			db.Exec("DELETE FROM draft_mutations WHERE owner_id=?", id)
			db.Exec("DELETE FROM drafts WHERE owner_id=?", id)
			db.Exec("DELETE FROM sessions WHERE account_id=?", id)
			db.Exec("DELETE FROM accounts WHERE id=?", id)
		}
		db.Exec("DELETE FROM login_challenges WHERE email=?", email)
		db.Exec("DELETE FROM login_mail_outbox WHERE email=?", email)
	})
	r := gin.New()
	if err = (API{Identity: auth, Drafts: draft.Store{DB: db}, DB: db, Origin: "http://localhost:3000"}).Register(r); err != nil {
		t.Fatal(err)
	}
	var cookie *http.Cookie
	call := func(method, path string, body any, want int) *httptest.ResponseRecorder {
		t.Helper()
		data, _ := json.Marshal(body)
		request := httptest.NewRequest(method, path, strings.NewReader(string(data)))
		request.Header.Set("Origin", "http://localhost:3000")
		request.Header.Set("Content-Type", "application/json")
		if cookie != nil {
			request.AddCookie(cookie)
		}
		response := httptest.NewRecorder()
		r.ServeHTTP(response, request)
		validateResponse(t, request, response)
		if response.Code != want {
			t.Fatalf("%s %s status=%d body=%s", method, path, response.Code, response.Body.String())
		}
		return response
	}
	deliveryInput := map[string]string{"email": email, "delivery_id": uuid.NewString()}
	queued := call("POST", "/api/auth/code", deliveryInput, 202)
	replayed := call("POST", "/api/auth/code", deliveryInput, 202)
	if queued.Body.String() != replayed.Body.String() {
		t.Fatal("queued replay changed task or expiry")
	}
	if _, err = auth.ProcessOne(context.Background(), nil, uuid.MustParse(deliveryInput["delivery_id"])); err != nil {
		t.Fatal(err)
	}
	login := call("POST", "/api/auth/verify", map[string]string{"email": email, "code": sender.code}, 200)
	cookies := login.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatal("missing session cookie")
	}
	cookie = cookies[0]
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode {
		t.Fatal("unsafe cookie")
	}
	call("PATCH", "/api/me", map[string]string{"nickname": "试读作者"}, 200)
	input := draft.Write{MutationID: uuid.New(), Title: "测试", Content: "关闭后仍需保留的正文"}
	created := call("POST", "/api/drafts/create", input, 200)
	var first draft.Result
	if err = json.Unmarshal(created.Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	repeated := call("POST", "/api/drafts/create", input, 200)
	if repeated.Body.String() != created.Body.String() {
		t.Fatal("create was not idempotent")
	}
	got := call("GET", "/api/drafts/"+first.DraftID.String(), nil, 200)
	call("GET", "/api/drafts?limit=1", nil, 200)
	var saved draft.Draft
	if err = json.Unmarshal(got.Body.Bytes(), &saved); err != nil || saved.Content != input.Content {
		t.Fatalf("content not preserved: %v", err)
	}
	call("POST", "/api/auth/logout", map[string]string{}, 204)
	// Keep the old cookie to prove server-side revocation, not just browser deletion.
	call("GET", "/api/drafts/"+first.DraftID.String(), nil, 401)
}

func TestWriteOriginAndUnavailableMail(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	a := API{Identity: &identity.Service{}, Origin: "http://localhost:3000"}
	if err := a.Register(r); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		origin string
		status int
	}{{"https://attacker.example", 403}, {"", 403}, {"http://localhost:3000", 503}} {
		request := httptest.NewRequest("POST", "/api/auth/code", strings.NewReader(`{"email":"a@example.com","delivery_id":"c3950ccd-3cd4-47a8-8046-ce935f441d95"}`))
		request.Header.Set("Origin", test.origin)
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		r.ServeHTTP(response, request)
		if response.Code != test.status {
			t.Fatalf("origin %q: got %d body %s", test.origin, response.Code, response.Body.String())
		}
	}
	request := httptest.NewRequest("GET", "/api/me", nil)
	response := httptest.NewRecorder()
	r.ServeHTTP(response, request)
	if response.Code != 401 {
		t.Fatalf("unauthenticated request status %d", response.Code)
	}
}
