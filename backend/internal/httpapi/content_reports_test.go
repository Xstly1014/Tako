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
	"strconv"
	"strings"
	"testing"
	"writing.local/community/internal/draft"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/publication"
)

func TestContentReportJourney(t *testing.T) {
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
	store := publication.Store{DB: db}
	d, e := (draft.Store{DB: db}).Write(ctx, owner, "create", draft.Write{MutationID: uuid.New(), Title: "举报链路", Content: "原始正式内容"})
	if e != nil {
		t.Fatal(e)
	}
	preview, e := store.Prepare(ctx, owner, publication.Prepare{MutationID: uuid.New(), DraftID: d.DraftID, SourceRevision: 1, RightsConfirmed: true, Tags: []string{"日常"}})
	if e != nil {
		t.Fatal(e)
	}
	published, e := store.Publish(ctx, owner, publication.Publish{MutationID: uuid.New(), PreviewID: preview.ID})
	if e != nil {
		t.Fatal(e)
	}
	work := published.WorkID
	defer func() {
		if os.Getenv("TAKO_REPORT_BROWSER_FIXTURE") == "1" {
			return
		}
		for _, query := range []string{
			"DELETE FROM content_reports WHERE work_id=?",
			"DELETE FROM moderation_mutations WHERE work_id=?",
			"DELETE FROM moderation_cases WHERE work_id=?",
			"DELETE FROM publication_review_tasks WHERE work_id=?",
			"DELETE FROM publication_mutations WHERE work_id=?",
			"DELETE FROM work_versions WHERE work_id=?",
		} {
			if _, err := db.Exec(query, work[:]); err != nil {
				t.Error("content report fixture cleanup failed")
			}
		}
		if _, err := db.Exec("DELETE FROM publication_previews WHERE owner_id=?", owner[:]); err != nil {
			t.Error("preview fixture cleanup failed")
		}
		if _, err := db.Exec("DELETE FROM works WHERE id=?", work[:]); err != nil {
			t.Error("work fixture cleanup failed")
		}
		for _, query := range []string{"DELETE FROM draft_mutations WHERE owner_id=?", "DELETE FROM drafts WHERE owner_id=?"} {
			if _, err := db.Exec(query, owner[:]); err != nil {
				t.Error("content report author fixture cleanup failed")
			}
		}
		for _, id := range []uuid.UUID{owner, reader, other} {
			if _, err := db.Exec("DELETE FROM sessions WHERE account_id=?", id[:]); err != nil {
				t.Error("session cleanup failed")
			}
			if _, err := db.Exec("DELETE FROM accounts WHERE id=?", id[:]); err != nil {
				t.Error("account cleanup failed")
			}
		}
	}()
	api := API{DB: db, Identity: &identity.Service{DB: db, Pepper: []byte(strings.Repeat("x", 32))}, EnvironmentName: "test", Origin: "http://localhost:3000", EnablePublications: true, OperatorAccounts: owner.String()}
	if os.Getenv("TAKO_REPORT_BROWSER_FIXTURE") == "1" {
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
	target := "/api/works/" + work.String() + "/versions/1/reports"
	call("POST", target, map[string]any{"reason": "具体问题"}, uuid.Nil, 401)
	call("POST", target, map[string]any{"reason": "具体问题", "owner_id": owner.String()}, reader, 400)
	var report publication.ContentReport
	json.Unmarshal(call("POST", target, map[string]string{"reason": "具体问题"}, reader, 200).Body.Bytes(), &report)
	if report.ID == 0 || report.State != "pending" {
		t.Fatal("missing report")
	}
	path := "/api/my/content-reports/" + fmtID(report.ID)
	call("GET", path, nil, other, 404)
	call("GET", "/api/ops/content-reports", nil, reader, 403)
	var duplicate publication.ContentReport
	json.Unmarshal(call("POST", target, map[string]string{"reason": "不覆盖原说明"}, reader, 200).Body.Bytes(), &duplicate)
	if duplicate.ID != report.ID || duplicate.Reason != "具体问题" {
		t.Fatal("duplicate overwrote original")
	}
	var second publication.ContentReport
	json.Unmarshal(call("POST", target, map[string]string{"reason": "第二条独立举报"}, owner, 200).Body.Bytes(), &second)
	detail, e := store.ReviewDetail(ctx, work, 1)
	if e != nil {
		t.Fatal(e)
	}
	result, e := store.Review(ctx, owner, work, 1, publication.ModerationAction{MutationID: uuid.New(), ExpectedRevision: detail.Task.Revision, Decision: "restrict_version", Reason: "核查后限制"})
	if e != nil {
		t.Fatal(e)
	}
	call("GET", "/api/works/"+work.String(), nil, uuid.Nil, 404)
	call("GET", path, nil, reader, 200)
	call("POST", target, map[string]string{"reason": "隐藏后重查"}, reader, 200)
	call("POST", target, map[string]string{"reason": "新用户不能借此举报隐藏内容"}, other, 404)
	ops := "/api/ops/content-reports/" + fmtID(report.ID)
	call("POST", ops, map[string]any{"expected_revision": 1, "outcome": "handled", "response": "不能关联不存在的处置", "case_id": uint64(9007199254740991)}, owner, 409)
	if result.CaseID == nil {
		t.Fatal("restriction case identifier missing")
	}
	body := map[string]any{"expected_revision": 1, "outcome": "handled", "response": "已核查并限制原版本", "case_id": *result.CaseID}
	call("POST", ops, body, owner, 200)
	call("POST", ops, body, owner, 200)
	body["response"] = "不能覆盖已结案回执"
	call("POST", ops, body, owner, 409)
	var receipt publication.ContentReport
	json.Unmarshal(call("GET", path, nil, reader, 200).Body.Bytes(), &receipt)
	if receipt.State != "resolved" || receipt.Revision != 2 || receipt.CaseID != nil {
		t.Fatal("receipt missing or private case leaked")
	}
	call("POST", target, map[string]string{"reason": "结案后仍返回原记录"}, reader, 200)
	call("POST", "/api/ops/content-reports/"+fmtID(second.ID), map[string]any{"expected_revision": 1, "outcome": "dismissed", "response": "核查后无需进一步处理", "case_id": nil}, owner, 200)
	if os.Getenv("TAKO_REPORT_BROWSER_FIXTURE") == "1" {
		// Isolated test binary only. Production binaries never include these bootstrap routes.
		draftValue, err := (draft.Store{DB: db}).Write(ctx, owner, "create", draft.Write{MutationID: uuid.New(), Title: "举报 Web 联调原文", Content: "这是供运营核查的固定正式正文。"})
		if err != nil {
			t.Fatal(err)
		}
		fixed, err := store.Prepare(ctx, owner, publication.Prepare{MutationID: uuid.New(), DraftID: draftValue.DraftID, SourceRevision: 1, RightsConfirmed: true, Tags: []string{"日常"}})
		if err != nil {
			t.Fatal(err)
		}
		formal, err := store.Publish(ctx, owner, publication.Publish{MutationID: uuid.New(), PreviewID: fixed.ID})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = store.CreateContentReport(ctx, reader, formal.WorkID, 1, "页面联调：请核查这段固定内容"); err != nil {
			t.Fatal(err)
		}
		r.GET("/api/_report_fixture/:who", func(c *gin.Context) {
			if c.Param("who") == "native" {
				account, token, err := api.Identity.RegisterAppPassword(ctx, uuid.NewString()+"@example.test", uuid.NewString()+"-test-password", uuid.NewString())
				if err != nil {
					c.Status(500)
					return
				}
				c.JSON(200, gin.H{"account": account, "access_token": token, "token_type": "Bearer", "expires_in": 604800, "fixture_work_id": formal.WorkID})
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
			c.Redirect(302, "/ops/content-reports")
		})
		t.Log("content report isolated browser fixture ready")
		if err = http.ListenAndServe(":8080", r); err != nil {
			t.Fatal(err)
		}
	}
}
