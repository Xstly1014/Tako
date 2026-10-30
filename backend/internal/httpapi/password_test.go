package httpapi

import (
	"context"
	"crypto/sha256"
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

func TestPasswordHTTPContractAndLegacySetup(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("real MySQL required")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	email, legacyEmail := uuid.NewString()+"@example.test", uuid.NewString()+"@example.test"
	legacyID := uuid.New()
	if _, err = db.Exec("INSERT INTO accounts (id,email,nickname) VALUES (?,?,?)", legacyID[:], legacyEmail, "保留笔名"); err != nil {
		t.Fatal(err)
	}
	defer func() {
		for _, address := range []string{email, legacyEmail} {
			var raw []byte
			if db.QueryRow("SELECT id FROM accounts WHERE email=?", address).Scan(&raw) == nil {
				db.Exec("DELETE FROM sessions WHERE account_id=?", raw)
				db.Exec("DELETE FROM accounts WHERE id=?", raw)
			}
		}
	}()
	auth := &identity.Service{DB: db, Pepper: []byte(uuid.NewString())}
	r := gin.New()
	if err = (API{AuthMode: "password", Identity: auth, DB: db, Origin: "http://localhost:3000"}).Register(r); err != nil {
		t.Fatal(err)
	}
	var cookie *http.Cookie
	call := func(method, path string, body any, want int) *httptest.ResponseRecorder {
		t.Helper()
		data, _ := json.Marshal(body)
		req := httptest.NewRequest(method, path, strings.NewReader(string(data)))
		req.Header.Set("Origin", "http://localhost:3000")
		req.Header.Set("Content-Type", "application/json")
		if cookie != nil {
			req.AddCookie(cookie)
		}
		res := httptest.NewRecorder()
		r.ServeHTTP(res, req)
		validateResponse(t, req, res)
		if res.Code != want {
			t.Fatalf("%s %s status=%d want=%d", method, path, res.Code, want)
		}
		return res
	}
	call("GET", "/api/auth/methods", nil, 200)
	call("POST", "/api/auth/code", map[string]string{"email": email, "delivery_id": uuid.NewString()}, 403)
	call("POST", "/api/auth/verify", map[string]string{"email": email, "code": "123456"}, 403)
	call("POST", "/api/me/password", map[string]string{"password": "example-test-password"}, 401)
	call("POST", "/api/auth/register", map[string]string{"email": email, "password": "short"}, 400)
	registered := call("POST", "/api/auth/register", map[string]string{"email": email, "password": "example-test-password"}, 200)
	var account identity.Account
	json.Unmarshal(registered.Body.Bytes(), &account)
	cookies := registered.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteLaxMode {
		t.Fatal("unsafe or missing session")
	}
	cookie = cookies[0]
	call("GET", "/api/me/password", nil, 200)
	call("POST", "/api/auth/register", map[string]string{"email": email, "password": "different-password"}, 409)
	call("POST", "/api/auth/register", map[string]string{"email": legacyEmail, "password": "different-password"}, 409)
	call("POST", "/api/auth/login", map[string]string{"email": legacyEmail, "password": "different-password"}, 401)
	call("POST", "/api/auth/login", map[string]string{"email": email, "password": "different-password"}, 401)
	call("POST", "/api/auth/login", map[string]string{"email": uuid.NewString() + "@example.test", "password": "different-password"}, 401)
	call("POST", "/api/auth/logout", map[string]string{}, 204)
	call("GET", "/api/me", nil, 401)
	cookie = nil
	login := call("POST", "/api/auth/login", map[string]string{"email": email, "password": "example-test-password"}, 200)
	var logged identity.Account
	json.Unmarshal(login.Body.Bytes(), &logged)
	if logged.ID != account.ID {
		t.Fatal("lost registered identity")
	}
	cookie = login.Result().Cookies()[0]
	call("POST", "/api/me/password", map[string]string{"password": "different-password"}, 409)
	call("POST", "/api/me/password", map[string]string{"password": "example-test-password"}, 204)
	// Synthetic legacy session models only the preexisting authenticated account;
	// registration and password login above use the real public endpoints.
	token := strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", "")
	if len(token) != 64 {
		t.Fatal("fixture token length")
	}
	if err = insertLegacySession(context.Background(), db, legacyID, token); err != nil {
		t.Fatal(err)
	}
	cookie = &http.Cookie{Name: "tako_session", Value: token}
	call("POST", "/api/me/password", map[string]string{"password": "legacy-test-password"}, 204)
	cookie = nil
	old := call("POST", "/api/auth/login", map[string]string{"email": legacyEmail, "password": "legacy-test-password"}, 200)
	json.Unmarshal(old.Body.Bytes(), &logged)
	if logged.ID != legacyID || logged.Nickname != "保留笔名" {
		t.Fatal("legacy identity changed")
	}
}

func insertLegacySession(ctx context.Context, db *sql.DB, id uuid.UUID, token string) error {
	hash := sha256.Sum256([]byte(token))
	_, err := db.ExecContext(ctx, "INSERT INTO sessions (token_hash,account_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 1 DAY))", hash[:], id[:])
	return err
}
