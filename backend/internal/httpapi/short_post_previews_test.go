package httpapi

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/shortpost"
)

func verifyShortPostPreview(t *testing.T, db *sql.DB, owner, publicBook, privateBook uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	other, operator := uuid.New(), uuid.New()
	for _, id := range []uuid.UUID{other, operator} {
		if _, err := db.Exec("INSERT INTO accounts(id,email,nickname) VALUES(?,?,?)", id[:], id.String()+"@example.test", "短帖验证账号"); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if _, err := db.Exec("DELETE FROM accounts WHERE id=?", id[:]); err != nil {
				t.Errorf("fixture cleanup: %v", err)
			}
		})
	}
	tokens := map[uuid.UUID]string{}
	for _, account := range []uuid.UUID{owner, other, operator} {
		t.Cleanup(func() {
			for _, query := range []string{"DELETE FROM short_post_revision_submissions WHERE owner_id=?", "DELETE FROM short_post_versions WHERE owner_id=?", "DELETE FROM short_posts WHERE owner_id=?", "DELETE FROM short_post_preview_images WHERE owner_id=?", "DELETE FROM short_post_previews WHERE owner_id=?", "DELETE FROM short_post_images WHERE owner_id=?", "DELETE FROM sessions WHERE account_id=?"} {
				if _, err := db.Exec(query, account[:]); err != nil {
					t.Errorf("preview fixture cleanup: %v", err)
				}
			}
		})
		tokens[account] = strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", "")
		if err := insertLegacySession(ctx, db, account, tokens[account]); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		if _, err := db.Exec("DELETE FROM short_post_actions WHERE actor_id IN (?,?)", owner[:], operator[:]); err != nil {
			t.Errorf("action fixture cleanup: %v", err)
		}
	})
	const origin = "http://localhost:3000"
	router := gin.New()
	api := API{DB: db, Identity: &identity.Service{DB: db}, Origin: origin, EnablePublications: true, EnvironmentName: "test", OperatorAccounts: operator.String()}
	if err := api.Register(router); err != nil {
		t.Fatal(err)
	}
	request := func(method string, actor uuid.UUID, path string, in any, want int, code string) *httptest.ResponseRecorder {
		t.Helper()
		var body *bytes.Reader
		if method == "PUT" || method == "POST" {
			data, err := json.Marshal(in)
			if err != nil {
				t.Fatal(err)
			}
			body = bytes.NewReader(data)
		} else {
			body = bytes.NewReader(nil)
		}
		req := httptest.NewRequest(method, path, body)
		if actor != uuid.Nil {
			req.AddCookie(&http.Cookie{Name: api.sessionCookieName(), Value: tokens[actor]})
		}
		if method == "PUT" || method == "POST" {
			req.Header.Set("Origin", origin)
			req.Header.Set("Content-Type", "application/json")
		}
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		validateResponse(t, req, out)
		if out.Code != want {
			t.Fatalf("%s returned %d want %d", method, out.Code, want)
		}
		if code != "" {
			var got struct {
				Error string `json:"error"`
			}
			if err := json.Unmarshal(out.Body.Bytes(), &got); err != nil || got.Error != code {
				t.Fatalf("unexpected error code %q want %q", got.Error, code)
			}
		}
		return out
	}
	call := func(method string, actor, id uuid.UUID, in shortpost.PreparePreview, want int, code string) []byte {
		t.Helper()
		return bytes.Clone(request(method, actor, "/api/my/short-post-previews/"+id.String(), in, want, code).Body.Bytes())
	}
	var sample bytes.Buffer
	if err := png.Encode(&sample, image.NewRGBA(image.Rect(0, 0, 3, 2))); err != nil {
		t.Fatal(err)
	}
	images := shortpost.ImageStore{DB: db}
	saveImage := func(actor uuid.UUID) uuid.UUID {
		t.Helper()
		id := uuid.New()
		if _, err := images.Save(ctx, actor, id, "image/png", sample.Bytes()); err != nil {
			t.Fatal(err)
		}
		return id
	}
	good := shortpost.PreparePreview{Title: " 合成短帖 ", Content: "第一行\r\n第二行", ImageIDs: []uuid.UUID{saveImage(owner), saveImage(owner), saveImage(owner), saveImage(owner)}, NovelID: &publicBook}
	id := uuid.New()
	first := call("PUT", owner, id, good, 200, "")
	out := novelResult[shortpost.Preview](t, first)
	if out.Title != "合成短帖" || out.Content != "第一行\n第二行" || out.NovelID == nil || *out.NovelID != publicBook || len(out.Images) != 4 {
		t.Fatal("incorrect fixed preview")
	}
	for i, image := range out.Images {
		if image.ID != good.ImageIDs[i] {
			t.Fatal("image order changed")
		}
	}
	if got := call("GET", owner, id, good, 200, ""); !bytes.Equal(first, got) {
		t.Fatal("read changed the preview")
	}
	if got := call("PUT", owner, id, good, 200, ""); !bytes.Equal(first, got) {
		t.Fatal("retry changed the preview")
	}
	withoutImages := shortpost.PreparePreview{Title: "纯文字", Content: "合成正文", ImageIDs: []uuid.UUID{}}
	textOnly := novelResult[shortpost.Preview](t, call("PUT", owner, uuid.New(), withoutImages, 200, ""))
	if textOnly.NovelID != nil || textOnly.Images == nil || len(textOnly.Images) != 0 {
		t.Fatal("incorrect text-only preview")
	}
	referenced := good.ImageIDs[0]
	if _, err := db.Exec("DELETE FROM short_post_images WHERE owner_id=? AND id=?", owner[:], referenced[:]); err == nil {
		t.Fatal("database allowed deleting a referenced image")
	}
	call("GET", other, id, good, 404, "resource_not_found")
	call("GET", uuid.Nil, id, good, 401, "authentication_required")
	changed := good
	changed.ImageIDs = []uuid.UUID{good.ImageIDs[1], good.ImageIDs[0]}
	call("PUT", owner, id, changed, 409, "mutation_id_reused")
	changed.ImageIDs = append(append([]uuid.UUID{}, good.ImageIDs...), uuid.New())
	call("PUT", owner, uuid.New(), changed, 400, "invalid_input")
	changed.ImageIDs = []uuid.UUID{good.ImageIDs[0], good.ImageIDs[0]}
	call("PUT", owner, uuid.New(), changed, 400, "invalid_input")
	badID := uuid.New()
	changed.ImageIDs = []uuid.UUID{good.ImageIDs[0], saveImage(other)}
	call("PUT", owner, badID, changed, 409, "short_post_image_unavailable")
	call("GET", owner, badID, good, 404, "resource_not_found")
	changed.ImageIDs = []uuid.UUID{}
	call("PUT", other, badID, changed, 409, "short_post_novel_unavailable")
	changed.NovelID = &privateBook
	call("PUT", owner, badID, changed, 409, "short_post_novel_unavailable")
	verifyShortPostSubmission(t, db, owner, other, operator, publicBook, out, textOnly, request)
	if _, err := db.Exec("UPDATE novels SET author_hidden=TRUE WHERE id=? AND owner_id=?", publicBook[:], owner[:]); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := db.Exec("UPDATE novels SET author_hidden=FALSE WHERE id=? AND owner_id=?", publicBook[:], owner[:]); err != nil {
			t.Errorf("restore fixture: %v", err)
		}
	})
	call("PUT", owner, badID, good, 409, "short_post_novel_unavailable")
	if got := call("PUT", owner, id, good, 200, ""); !bytes.Equal(first, got) {
		t.Fatal("hidden book changed the fixed preview")
	}
	if _, err := db.Exec("UPDATE short_post_previews SET expires_at=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE owner_id=? AND id=?", owner[:], id[:]); err != nil {
		t.Fatal(err)
	}
	call("GET", owner, id, good, 410, "preview_expired")
	call("PUT", owner, id, good, 410, "preview_expired")
}
