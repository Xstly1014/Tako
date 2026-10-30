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
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"writing.local/community/internal/draft"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/publication"
)

func TestPublicationHTTPContractAndAccess(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("real MySQL required")
	}
	db, e := sql.Open("mysql", dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	owner := uuid.New()
	token := strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", "")
	hash := sha256.Sum256([]byte(token))
	now := time.Now().UTC()
	if _, e = db.Exec("INSERT INTO accounts (id,email,nickname) VALUES (?,?,?)", owner[:], owner.String()+"@example.test", "作者"); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("INSERT INTO sessions (token_hash,account_id,expires_at) VALUES (?,?,?)", hash[:], owner[:], now.Add(time.Hour)); e != nil {
		t.Fatal(e)
	}
	defer func() {
		db.Exec("DELETE FROM work_state_mutations WHERE owner_id=?", owner[:])
		db.Exec("DELETE e FROM work_events e JOIN works w ON w.id=e.work_id WHERE w.owner_id=?", owner[:])
		db.Exec("DELETE q FROM publication_review_tasks q JOIN works w ON w.id=q.work_id WHERE w.owner_id=?", owner[:])
		db.Exec("DELETE FROM publication_mutations WHERE owner_id=?", owner[:])
		db.Exec("DELETE v FROM work_versions v JOIN works w ON w.id=v.work_id WHERE w.owner_id=?", owner[:])
		db.Exec("DELETE FROM publication_previews WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM works WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM draft_mutations WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM drafts WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM sessions WHERE account_id=?", owner[:])
		db.Exec("DELETE FROM accounts WHERE id=?", owner[:])
	}()
	d, e := (draft.Store{DB: db}).Write(context.Background(), owner, "create", draft.Write{MutationID: uuid.New(), Title: "契约测试作品", Content: "只有明确确认的内容才会公开。"})
	if e != nil {
		t.Fatal(e)
	}
	r := gin.New()
	if e = (API{DB: db, Identity: &identity.Service{DB: db}, Origin: "http://localhost:3000", EnablePublications: true}).Register(r); e != nil {
		t.Fatal(e)
	}
	call := func(method, path string, body any, auth bool, want int) *httptest.ResponseRecorder {
		t.Helper()
		data, _ := json.Marshal(body)
		req := httptest.NewRequest(method, path, strings.NewReader(string(data)))
		req.Header.Set("Origin", "http://localhost:3000")
		req.Header.Set("Content-Type", "application/json")
		if auth {
			req.AddCookie(&http.Cookie{Name: "tako_session", Value: token})
		}
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		validateResponse(t, req, rec)
		if rec.Code != want {
			t.Fatalf("%s %s status %d expected %d", method, path, rec.Code, want)
		}
		if rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("private/public content cached")
		}
		return rec
	}
	in := publication.Prepare{MutationID: uuid.New(), DraftID: d.DraftID, SourceRevision: 1, Tags: []string{"日常"}, RightsConfirmed: true}
	call("POST", "/api/publication-previews", in, false, 401)
	rec := call("POST", "/api/publication-previews", in, true, 200)
	var preview publication.Preview
	if e = json.Unmarshal(rec.Body.Bytes(), &preview); e != nil {
		t.Fatal(e)
	}
	call("GET", "/api/publication-previews/"+preview.ID.String(), nil, false, 401)
	call("GET", "/api/publication-previews/"+preview.ID.String(), nil, true, 200)
	rec = call("POST", "/api/publications", publication.Publish{MutationID: uuid.New(), PreviewID: preview.ID}, true, 200)
	var result publication.Result
	json.Unmarshal(rec.Body.Bytes(), &result)
	call("GET", "/api/publication-previews/"+preview.ID.String(), nil, true, 200)
	path := "/api/works/" + result.WorkID.String()
	call("GET", path, nil, false, 200)
	call("GET", path+"/versions/1", nil, false, 200)
	call("GET", "/api/my/works", nil, true, 200)
	call("GET", "/api/my/works/"+result.WorkID.String()+"/versions", nil, true, 200)
	call("GET", "/api/my/works/"+result.WorkID.String()+"/versions/1", nil, true, 200)
	call("GET", path+"/timeline", nil, false, 200)
	stateResponse := call("GET", "/api/my/works/"+result.WorkID.String(), nil, true, 200)
	var state publication.State
	if e = json.Unmarshal(stateResponse.Body.Bytes(), &state); e != nil {
		t.Fatal(e)
	}
	change := publication.Change{MutationID: uuid.New(), ExpectedStateRevision: state.StateRevision, Action: "hide"}
	call("POST", "/api/my/works/"+result.WorkID.String()+"/actions", change, true, 200)
	call("POST", "/api/my/works/"+result.WorkID.String()+"/actions", change, true, 200)
	call("GET", path+"/timeline", nil, false, 404)
	call("GET", "/api/my/works/"+result.WorkID.String()+"/versions", nil, true, 200)
	call("GET", "/api/my/works/"+result.WorkID.String()+"/versions/1", nil, true, 200)
	blocked := call("GET", path, nil, false, 404)
	if strings.Contains(blocked.Body.String(), "契约测试作品") {
		t.Fatal("hidden title leaked")
	}
	// No bypass by requesting the specific version URL.
	call("GET", path+"/versions/1", nil, false, 404)
	fresh, e := (publication.Store{DB: db}).Prepare(context.Background(), owner, publication.Prepare{MutationID: uuid.New(), DraftID: d.DraftID, SourceRevision: 1, Tags: []string{"日常"}, RightsConfirmed: true})
	if e != nil {
		t.Fatal(e)
	}
	db.Exec("UPDATE publication_previews SET expires_at=? WHERE id=?", now.Add(-time.Minute), fresh.ID[:])
	call("GET", "/api/publication-previews/"+fresh.ID.String(), nil, true, 410)
	disabled := gin.New()
	if e = (API{Identity: &identity.Service{}, Origin: "http://localhost:3000"}).Register(disabled); e != nil {
		t.Fatal(e)
	}
	req := httptest.NewRequest("GET", path, nil)
	res := httptest.NewRecorder()
	disabled.ServeHTTP(res, req)
	validateResponse(t, req, res)
	if res.Code != 503 || !strings.Contains(res.Body.String(), "publication_disabled") {
		t.Fatal("feature not default-off")
	}
}
