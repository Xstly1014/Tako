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
	"github.com/google/uuid"
	"writing.local/community/internal/identity"
)

func TestAppIdentityContractAndCredentialIsolation(t *testing.T) {
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
	if e = (API{DB: db, Identity: service, AuthMode: "password", Origin: "http://localhost:3000", EnablePublications: true}).Register(r); e != nil {
		t.Fatal(e)
	}
	email := uuid.NewString() + "@example.test"
	defer func() {
		var raw []byte
		if db.QueryRow("SELECT id FROM accounts WHERE email=?", email).Scan(&raw) == nil {
			db.Exec("DELETE FROM sessions WHERE account_id=?", raw)
			db.Exec("DELETE FROM accounts WHERE id=?", raw)
		}
	}()
	call := func(method, path string, body any, token, origin, cookie string, want int) *httptest.ResponseRecorder {
		t.Helper()
		data, _ := json.Marshal(body)
		req := httptest.NewRequest(method, path, strings.NewReader(string(data)))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		if cookie != "" {
			req.AddCookie(&http.Cookie{Name: "tako_session", Value: cookie})
		}
		res := httptest.NewRecorder()
		r.ServeHTTP(res, req)
		validateResponse(t, req, res)
		if res.Code != want {
			t.Fatalf("%s %s: %d want %d", method, path, res.Code, want)
		}
		return res
	}
	creds := map[string]string{"email": email, "password": "native-test-password"}
	call("POST", "/api/app/auth/register", creds, "", "https://evil.test", "", 403)
	call("POST", "/api/app/auth/register", creds, "", "", "ambient", 403)
	call("POST", "/api/app/auth/register", map[string]string{"email": email, "password": "short"}, "", "", "", 400)
	reg := call("POST", "/api/app/auth/register", creds, "", "", "", 200)
	if len(reg.Result().Cookies()) != 0 {
		t.Fatal("native login must not create ambient cookie")
	}
	var session struct {
		Account identity.Account `json:"account"`
		Token   string           `json:"access_token"`
	}
	if json.Unmarshal(reg.Body.Bytes(), &session) != nil || session.Account.ID == uuid.Nil {
		t.Fatal("bad session")
	}
	if _, e = service.Authenticate(context.Background(), session.Token); e != identity.ErrInvalid {
		t.Fatal("app token accepted as browser")
	}
	call("POST", "/api/app/auth/register", creds, "", "", "", 409)
	call("GET", "/api/me", nil, session.Token, "", "", 200)
	call("GET", "/api/me", nil, session.Token, "http://localhost:3000", "", 403)
	call("GET", "/api/me", nil, session.Token, "", "ambient", 403)
	call("GET", "/api/me", nil, "", "", session.Token, 401)
	call("PATCH", "/api/me", map[string]string{"nickname": "原生读者"}, session.Token, "", "", 200)
	call("GET", "/api/my/favorites", nil, session.Token, "", "", 200)
	call("GET", "/api/my/favorites", nil, "bogus", "", "", 401)
	call("POST", "/api/auth/login", creds, session.Token, "", "", 403)
	browser := call("POST", "/api/auth/login", creds, "", "http://localhost:3000", "", 200)
	cookie := browser.Result().Cookies()[0].Value
	call("GET", "/api/me", nil, cookie, "", "", 401)
	call("PATCH", "/api/me", map[string]string{"nickname": "wrong"}, "", "", cookie, 403)
	call("POST", "/api/app/auth/login", map[string]string{"email": email, "password": "wrong-password"}, "", "", "", 401)
	login := call("POST", "/api/app/auth/login", creds, "", "", "", 200)
	var second struct {
		Token string `json:"access_token"`
	}
	json.Unmarshal(login.Body.Bytes(), &second)
	if second.Token == session.Token {
		t.Fatal("login reused a session")
	}
	call("POST", "/api/app/auth/logout", map[string]string{}, session.Token, "", "", 204)
	call("POST", "/api/app/auth/logout", map[string]string{}, session.Token, "", "", 204)
	call("GET", "/api/me", nil, session.Token, "", "", 401)
	call("GET", "/api/me", nil, second.Token, "", "", 200)
	call("GET", "/api/me", nil, "", "", cookie, 200)
	hashAccount := session.Account.ID
	if _, e = db.Exec("UPDATE sessions SET expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 DAY) WHERE account_id=?", hashAccount[:]); e != nil {
		t.Fatal(e)
	}
	call("GET", "/api/me", nil, second.Token, "", "", 401)
}
