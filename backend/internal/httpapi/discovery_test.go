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
	"writing.local/community/internal/draft"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/publication"
)

func TestDiscoveryHTTPContractAndOperatorBoundary(t *testing.T) {
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
		if _, e = db.Exec("INSERT INTO accounts(id,email,nickname) VALUES(?,?,?)", id[:], id.String()+"@example.test", "发现测试"); e != nil {
			t.Fatal(e)
		}
	}
	defer func() {
		db.Exec("DELETE FROM favorite_mutations WHERE account_id IN (?,?)", owner[:], other[:])
		db.Exec("DELETE f FROM work_favorites f JOIN works w ON w.id=f.work_id WHERE w.owner_id=?", owner[:])
		db.Exec("DELETE FROM work_state_mutations WHERE owner_id=?", owner[:])
		db.Exec("DELETE e FROM work_events e JOIN works w ON w.id=e.work_id WHERE w.owner_id=?", owner[:])
		db.Exec("DELETE q FROM publication_review_tasks q JOIN works w ON w.id=q.work_id WHERE w.owner_id=?", owner[:])
		db.Exec("DELETE FROM publication_mutations WHERE owner_id=?", owner[:])
		db.Exec("DELETE v FROM work_versions v JOIN works w ON w.id=v.work_id WHERE w.owner_id=?", owner[:])
		db.Exec("DELETE FROM publication_previews WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM works WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM draft_mutations WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM drafts WHERE owner_id=?", owner[:])
		for _, id := range []uuid.UUID{owner, other} {
			db.Exec("DELETE FROM sessions WHERE account_id=?", id[:])
			db.Exec("DELETE FROM accounts WHERE id=?", id[:])
		}
	}()
	ctx := context.Background()
	connection, e := db.Conn(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer connection.Close()
	var locked int
	if e = connection.QueryRowContext(ctx, "SELECT GET_LOCK('tako_community_fixture',30)").Scan(&locked); e != nil || locked != 1 {
		t.Fatal("fixture lock", e)
	}
	defer connection.ExecContext(ctx, "DO RELEASE_LOCK('tako_community_fixture')")
	if e = insertLegacySession(ctx, db, owner, token); e != nil {
		t.Fatal(e)
	}
	if e = insertLegacySession(ctx, db, other, otherToken); e != nil {
		t.Fatal(e)
	}
	s := publication.Store{DB: db}
	d, e := (draft.Store{DB: db}).Write(ctx, owner, "create", draft.Write{MutationID: uuid.New(), Title: "发现契约作品", Content: "不会出现在发现卡片的正文"})
	if e != nil {
		t.Fatal(e)
	}
	p, e := s.Prepare(ctx, owner, publication.Prepare{MutationID: uuid.New(), DraftID: d.DraftID, SourceRevision: 1, RightsConfirmed: true, Tags: []string{"幻想"}, Introduction: "仅由作者提供的简介"})
	if e != nil {
		t.Fatal(e)
	}
	published, e := s.Publish(ctx, owner, publication.Publish{MutationID: uuid.New(), PreviewID: p.ID})
	if e != nil {
		t.Fatal(e)
	}
	r := gin.New()
	if e = (API{DB: db, Identity: &identity.Service{DB: db}, Origin: "http://localhost:3000", EnablePublications: true, OperatorAccounts: owner.String()}).Register(r); e != nil {
		t.Fatal(e)
	}
	call := func(method, path string, body any, cookie string, want int) *httptest.ResponseRecorder {
		t.Helper()
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(method, path, strings.NewReader(string(raw)))
		req.Header.Set("Origin", "http://localhost:3000")
		req.Header.Set("Content-Type", "application/json")
		if cookie != "" {
			req.AddCookie(&http.Cookie{Name: "tako_session", Value: cookie})
		}
		res := httptest.NewRecorder()
		r.ServeHTTP(res, req)
		validateResponse(t, req, res)
		if res.Code != want {
			t.Fatalf("%s %s got %d want %d", method, path, res.Code, want)
		}
		return res
	}
	call("GET", "/api/community", nil, "", 200)
	url := "/api/my/favorites/" + published.WorkID.String()
	call("GET", "/api/my/favorites", nil, "", 401)
	call("GET", url, nil, token, 200)
	favorite := publication.FavoriteChange{MutationID: uuid.New(), ExpectedAccountID: other, Favorite: true}
	call("POST", url, favorite, otherToken, 200)
	call("POST", url, favorite, otherToken, 200)
	call("POST", url, favorite, token, 409)
	call("POST", url, map[string]any{"mutation_id": uuid.NewString(), "expected_revision": 0}, otherToken, 400)
	call("GET", "/api/my/favorites", nil, otherToken, 200)
	call("GET", "/api/my/favorites?cursor=bad", nil, otherToken, 400)
	call("GET", "/api/community?cursor=invalid", nil, "", 400)
	call("GET", "/api/me/access", nil, "", 401)
	access := call("GET", "/api/me/access", nil, otherToken, 200)
	if !strings.Contains(access.Body.String(), `"operator":false`) {
		t.Fatal("ordinary user granted operator UI")
	}
	call("GET", "/api/ops/curation", nil, "", 401)
	call("GET", "/api/ops/curation", nil, otherToken, 403)
	call("GET", "/api/ops/curation", nil, token, 200)
	call("GET", "/api/ops/curation/"+published.WorkID.String(), nil, token, 200)
	current, e := s.Curations(ctx)
	if e != nil {
		t.Fatal(e)
	}
	candidate, e := s.CurationCandidate(ctx, published.WorkID)
	if e != nil {
		t.Fatal(e)
	}
	action := publication.CurationChange{MutationID: uuid.New(), ExpectedRevision: current.Revision, Slot: 1, WorkID: &published.WorkID, ExpectedWorkRevision: candidate.StateRevision}
	call("POST", "/api/ops/curation", action, otherToken, 403)
	original := call("POST", "/api/ops/curation", action, token, 200)
	repeat := call("POST", "/api/ops/curation", action, token, 200)
	if original.Body.String() != repeat.Body.String() {
		t.Fatal("receipt changed")
	}
	action.MutationID = uuid.New()
	call("POST", "/api/ops/curation", action, token, 409)
	state, e := s.AuthorState(ctx, owner, published.WorkID)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Change(ctx, owner, published.WorkID, publication.Change{MutationID: uuid.New(), ExpectedStateRevision: state.StateRevision, Action: "hide"}); e != nil {
		t.Fatal(e)
	}
	hidden := call("GET", "/api/community", nil, "", 200)
	privateFavorites := call("GET", "/api/my/favorites", nil, otherToken, 200)
	if strings.Contains(privateFavorites.Body.String(), "发现契约作品") || !strings.Contains(privateFavorites.Body.String(), `"work":null`) {
		t.Fatal("favorite metadata leaked")
	}
	favorite.MutationID = uuid.New()
	favorite.ExpectedRevision = 1
	favorite.Favorite = false
	call("POST", url, favorite, otherToken, 200)
	if strings.Contains(hidden.Body.String(), "发现契约作品") || strings.Contains(hidden.Body.String(), "仅由作者提供") {
		t.Fatal("hidden metadata leaked")
	}
	call("GET", "/api/ops/curation/"+published.WorkID.String(), nil, token, 404)
	call("GET", "/api/ops/curation", nil, token, 200)
	current, e = s.Curations(ctx)
	if e != nil {
		t.Fatal(e)
	}
	call("POST", "/api/ops/curation", publication.CurationChange{MutationID: uuid.New(), ExpectedRevision: current.Revision, Slot: 1}, token, 200)
}
