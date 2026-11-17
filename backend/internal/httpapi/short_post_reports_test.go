package httpapi

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/shortpost"
)

func TestShortPostReportJourney(t *testing.T) {
	fmtID := func(id uint64) string { return strconv.FormatUint(id, 10) }
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
	owner, reader, other := uuid.New(), uuid.New(), uuid.New()
	tokens := map[uuid.UUID]string{}
	for _, id := range []uuid.UUID{owner, reader, other} {
		tokens[id] = strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", "")
		if _, e = db.Exec("INSERT INTO accounts(id,email,nickname) VALUES(?,?,?)", id[:], id.String()+"@example.test", "举报验收"); e != nil {
			t.Fatal(e)
		}
		if e = insertLegacySession(ctx, db, id, tokens[id]); e != nil {
			t.Fatal(e)
		}
	}

	store := shortpost.PostStore{DB: db}
	var photos []uuid.UUID
	for range 2 {
		var raw bytes.Buffer
		if e = png.Encode(&raw, image.NewRGBA(image.Rect(0, 0, 2, 3))); e != nil {
			t.Fatal(e)
		}
		photo, e := (shortpost.ImageStore{DB: db}).Save(ctx, owner, uuid.New(), "image/png", raw.Bytes())
		if e != nil {
			t.Fatal(e)
		}
		photos = append(photos, photo.ID)
	}
	prepare := func(title string, photo uuid.UUID) uuid.UUID {
		t.Helper()
		id := uuid.New()
		if _, err := (shortpost.PreviewStore{DB: db}).Prepare(ctx, owner, id, shortpost.PreparePreview{Title: title, Content: "固定图文正文 " + title, ImageIDs: []uuid.UUID{photo}}); err != nil {
			t.Fatal(err)
		}
		return id
	}
	receipt, e := store.Submit(ctx, owner, uuid.New(), shortpost.SubmitPost{PreviewID: prepare("原版", photos[0]), RightsConfirmed: true})
	if e != nil {
		t.Fatal(e)
	}
	post := receipt.PostID
	defer func() {
		if os.Getenv("TAKO_SHORT_REPORT_BROWSER_FIXTURE") == "1" {
			return
		}
		for _, query := range []string{"DELETE FROM short_post_reports WHERE post_id IN (SELECT id FROM short_posts WHERE owner_id=?)", "DELETE FROM short_post_appeals WHERE owner_id=?", "DELETE FROM short_post_actions WHERE post_id IN (SELECT id FROM short_posts WHERE owner_id=?)", "DELETE FROM short_post_revision_submissions WHERE owner_id=?", "DELETE FROM short_post_versions WHERE owner_id=?", "DELETE FROM short_posts WHERE owner_id=?", "DELETE FROM short_post_preview_images WHERE owner_id=?", "DELETE FROM short_post_previews WHERE owner_id=?", "DELETE FROM short_post_images WHERE owner_id=?", "DELETE FROM publication_policies WHERE owner_id=?"} {
			if _, err := db.Exec(query, owner[:]); err != nil {
				t.Error("short report fixture cleanup failed")
			}
		}
		for _, id := range []uuid.UUID{owner, reader, other} {
			for _, q := range []string{"DELETE FROM sessions WHERE account_id=?", "DELETE FROM accounts WHERE id=?"} {
				if _, err := db.Exec(q, id[:]); err != nil {
					t.Error("account fixture cleanup failed")
				}
			}
		}
	}()
	api := API{DB: db, Identity: &identity.Service{DB: db, Pepper: []byte(strings.Repeat("x", 32))}, EnvironmentName: "test", Origin: "http://localhost:3000", EnablePublications: true, OperatorAccounts: owner.String()}
	if os.Getenv("TAKO_SHORT_REPORT_BROWSER_FIXTURE") == "1" {
		api.Origin = "http://127.0.0.1:3102"
	}
	r := gin.New()
	if e = api.Register(r); e != nil {
		t.Fatal(e)
	}
	call := func(method, path string, body any, who uuid.UUID, status int) *httptest.ResponseRecorder {
		t.Helper()
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(method, path, strings.NewReader(string(raw)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", api.Origin)
		if who != uuid.Nil {
			req.AddCookie(&http.Cookie{Name: "tako_session", Value: tokens[who]})
		}
		res := httptest.NewRecorder()
		r.ServeHTTP(res, req)
		validateResponse(t, req, res)
		if res.Code != status {
			t.Fatalf("%s %s: status %d wanted %d", method, path, res.Code, status)
		}
		return res
	}

	public := "/api/short-posts/" + post.String()
	target := public + "/versions/1/reports"
	create := func(who uuid.UUID, version uint64) shortpost.ContentReport {
		t.Helper()
		var out shortpost.ContentReport
		json.Unmarshal(call("POST", public+"/versions/"+fmtID(version)+"/reports", map[string]string{"reason": "请核查原图文"}, who, 200).Body.Bytes(), &out)
		return out
	}
	call("POST", target, map[string]string{"reason": "说明"}, uuid.Nil, 401)
	call("POST", target, map[string]any{"reason": "说明", "owner_id": owner}, reader, 400)
	original := create(reader, 1)
	second := create(owner, 1)
	duplicate := create(reader, 1)
	if original.ID == 0 || duplicate.ID != original.ID || duplicate.Reason != original.Reason {
		t.Fatal("semantic duplicate failed")
	}
	mine := func(id uint64) string { return "/api/my/short-post-reports/" + fmtID(id) }
	ops := func(id uint64) string { return "/api/ops/short-post-reports/" + fmtID(id) }
	call("GET", mine(original.ID), nil, other, 404)
	call("GET", ops(original.ID), nil, reader, 403)
	call("GET", ops(original.ID)+"/evidence", nil, reader, 403)
	revised, e := store.Revise(ctx, owner, post, uuid.New(), shortpost.RevisePost{SubmitPost: shortpost.SubmitPost{PreviewID: prepare("新版", photos[1]), RightsConfirmed: true}, ExpectedRevision: 1})
	if e != nil || revised.Status != "published" {
		t.Fatal("revision failed", e)
	}
	call("POST", target, map[string]string{"reason": "历史未开放不可新报"}, other, 404)
	latest := create(reader, 2)
	var evidence shortpost.ReportEvidence
	json.Unmarshal(call("GET", ops(original.ID)+"/evidence", nil, owner, 200).Body.Bytes(), &evidence)
	if evidence.Version == nil || *evidence.Version != 1 || evidence.Title != "原版" || len(evidence.Images) != 1 || evidence.Images[0].ID != photos[0] {
		t.Fatal("report did not retain exact original evidence")
	}
	imageURL := func(version uint64, image uuid.UUID) string {
		return public + "/versions/" + fmtID(version) + "/images/" + image.String()
	}
	call("GET", imageURL(2, photos[1]), nil, uuid.Nil, 200)
	call("GET", ops(original.ID)+"/evidence/images/"+photos[1].String(), nil, owner, 404)
	act := func(action string, version uint64) shortpost.PostState {
		t.Helper()
		current, err := store.Manage(ctx, post, uuid.Nil)
		if err != nil {
			t.Fatal(err)
		}
		out, err := store.ChangeState(ctx, owner, post, true, shortpost.PostAction{MutationID: uuid.New(), ExpectedRevision: current.Revision, Action: action, Version: version, Reason: "给作者的处置原因"})
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	limited := act("limit_version", 1)
	call("GET", public, nil, uuid.Nil, 200)
	call("GET", imageURL(1, photos[0]), nil, uuid.Nil, 404)
	protectedPhoto := call("GET", ops(original.ID)+"/evidence/images/"+photos[0].String(), nil, owner, 200)
	if protectedPhoto.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("protected photo cache leak")
	}
	decision := func(id, revision uint64, status int) {
		t.Helper()
		call("POST", ops(id), map[string]any{"expected_revision": 1, "outcome": "handled", "response": "给举报人的核查回执", "case_revision": revision}, owner, status)
	}
	decision(latest.ID, limited.Revision, 409)
	act("revoke_version_limit", 1)
	decision(original.ID, limited.Revision, 409)
	relimited := act("limit_version", 1)
	decision(original.ID, limited.Revision, 409)
	decision(original.ID, relimited.Revision, 200)
	decision(original.ID, relimited.Revision, 200)
	call("POST", ops(original.ID), map[string]any{"expected_revision": 1, "outcome": "handled", "response": "不能改已结案回执", "case_revision": relimited.Revision}, owner, 409)
	whole := act("limit", 0)
	decision(latest.ID, whole.Revision, 200)
	call("GET", public, nil, uuid.Nil, 404)
	call("GET", imageURL(2, photos[1]), nil, uuid.Nil, 404)
	if create(reader, 2).ID != latest.ID {
		t.Fatal("resolved duplicate created a second report")
	}
	call("POST", public+"/versions/2/reports", map[string]string{"reason": "其他人不能新报已关闭内容"}, other, 404)
	call("POST", ops(second.ID), map[string]any{"expected_revision": 1, "outcome": "dismissed", "response": "核查后无需重复处置", "case_revision": nil}, owner, 200)
	var result shortpost.ContentReport
	json.Unmarshal(call("GET", mine(original.ID), nil, reader, 200).Body.Bytes(), &result)
	if result.State != "resolved" || result.CaseRevision != nil || result.Response != "给举报人的核查回执" {
		t.Fatal("receipt leak or missing result")
	}
	current, err := store.OwnerVersion(ctx, post, owner, 1)
	if err != nil || current.ReviewReason != "给作者的处置原因" {
		t.Fatal("reporter response copied to author", err)
	}
	call("GET", "/api/my/short-post-reports?before="+fmtID(latest.ID), nil, reader, 200)
	call("GET", "/api/ops/short-post-reports?state=resolved", nil, owner, 200)
	if _, e = db.Exec("INSERT INTO publication_policies(owner_id,observation_until) VALUES(?,UTC_TIMESTAMP(6)+INTERVAL 1 HOUR)", owner[:]); e != nil {
		t.Fatal(e)
	}
	pending, e := store.Submit(ctx, owner, uuid.New(), shortpost.SubmitPost{PreviewID: prepare("先审", photos[0]), RightsConfirmed: true})
	if e != nil {
		t.Fatal(e)
	}
	call("POST", "/api/short-posts/"+pending.PostID.String()+"/versions/1/reports", map[string]string{"reason": "先审不是正式版"}, reader, 404)
	if os.Getenv("TAKO_SHORT_REPORT_BROWSER_FIXTURE") == "1" {
		if _, err := db.Exec("DELETE FROM publication_policies WHERE owner_id=?", owner[:]); err != nil {
			t.Fatal(err)
		}
		fixture, err := store.Submit(ctx, owner, uuid.New(), shortpost.SubmitPost{PreviewID: prepare("页面原版", photos[0]), RightsConfirmed: true})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = store.CreateContentReport(ctx, reader, fixture.PostID, 1, "页面联调：核查原图文"); err != nil {
			t.Fatal(err)
		}
		r.GET("/api/_short_report_fixture/:who", func(c *gin.Context) {
			if c.Param("who") == "native" {
				account, token, err := api.Identity.RegisterAppPassword(ctx, uuid.NewString()+"@example.test", uuid.NewString()+"-test-password", uuid.NewString())
				if err != nil {
					c.Status(500)
					return
				}
				c.JSON(200, gin.H{"account": account, "access_token": token, "token_type": "Bearer", "expires_in": 604800, "fixture_post_id": fixture.PostID})
				return
			}
			id := reader
			if c.Param("who") == "operator" {
				id = owner
			} else if c.Param("who") != "reader" {
				c.Status(404)
				return
			}
			c.SetCookie("tako_session", tokens[id], 0, "/", "", false, true)
			c.Redirect(302, "/ops/short-post-reports")
		})
		t.Log("short report browser fixture ready")
		if err := http.ListenAndServe(":8080", r); err != nil {
			t.Fatal(err)
		}
	}

}
