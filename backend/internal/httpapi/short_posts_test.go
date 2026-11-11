package httpapi

import (
	"bytes"
	"database/sql"
	"image/png"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"writing.local/community/internal/shortpost"
)

func verifyShortPostSubmission(t *testing.T, db *sql.DB, owner, other, operator, book uuid.UUID, preview, textOnly shortpost.Preview,
	request func(method string, actor uuid.UUID, path string, in any, want int, code string) *httptest.ResponseRecorder) {
	t.Helper()
	setHidden := func(hidden bool) {
		t.Helper()
		if _, err := db.Exec("UPDATE novels SET author_hidden=? WHERE id=? AND owner_id=?", hidden, book[:], owner[:]); err != nil {
			t.Fatal(err)
		}
	}
	const submitPrefix = "/api/my/short-post-submissions/"
	const publicPrefix = "/api/short-posts/"
	submission := submitPrefix + uuid.NewString()
	in := shortpost.SubmitPost{PreviewID: preview.ID, RightsConfirmed: true}
	request("PUT", uuid.Nil, submission, in, 401, "authentication_required")
	request("PUT", other, submission, in, 404, "resource_not_found")
	noRights := in
	noRights.RightsConfirmed = false
	request("PUT", owner, submission, noRights, 400, "invalid_input")
	setHidden(true)
	request("PUT", owner, submission, in, 409, "short_post_novel_unavailable")
	request("GET", owner, submission, nil, 404, "resource_not_found")
	setHidden(false)
	original := request("PUT", owner, submission, in, 200, "").Body.Bytes()
	published := novelResult[shortpost.SubmissionReceipt](t, original)
	if published.Status != "published" || published.PreviewID != preview.ID || published.PostID == uuid.Nil {
		t.Fatal("incorrect published receipt")
	}
	if !bytes.Equal(original, request("GET", owner, submission, nil, 200, "").Body.Bytes()) {
		t.Fatal("original receipt lookup differs")
	}
	request("GET", other, submission, nil, 404, "resource_not_found")
	request("PUT", owner, submitPrefix+uuid.NewString(), in, 409, "publication_conflict")
	request("PUT", owner, submission, shortpost.SubmitPost{PreviewID: textOnly.ID, RightsConfirmed: true}, 409, "mutation_id_reused")
	public := publicPrefix + published.PostID.String()
	imageURL := public + "/versions/1/images/" + preview.Images[0].ID.String()
	body := novelResult[shortpost.PublicPost](t, request("GET", uuid.Nil, public, nil, 200, "").Body.Bytes())
	if body.Novel == nil || body.Novel.ID != book || body.Novel.Title == "" || body.Title != preview.Title || body.Content != preview.Content || len(body.Images) != 4 || body.Images[0] != preview.Images[0] || body.Version != 1 {
		t.Fatal("public snapshot does not match the fixed preview")
	}
	photo := request("GET", uuid.Nil, imageURL, nil, 200, "")
	if _, err := png.Decode(photo.Body); err != nil || photo.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("invalid public image response")
	}
	request("GET", uuid.Nil, public+"/versions/1/images/"+uuid.NewString(), nil, 404, "resource_not_found")
	setHidden(true)
	body = novelResult[shortpost.PublicPost](t, request("GET", uuid.Nil, public, nil, 200, "").Body.Bytes())
	if body.Novel != nil || body.Content != preview.Content {
		t.Fatal("hidden association leaked or changed the post")
	}
	ownerSnapshot := novelResult[shortpost.ManagedPost](t,
		request("GET", owner, "/api/my/short-posts/"+published.PostID.String(), nil, 200, "").Body.Bytes())
	if ownerSnapshot.NovelID == nil || *ownerSnapshot.NovelID != book {
		t.Fatal("private revision source lost the original association")
	}
	if !bytes.Equal(original, request("PUT", owner, submission, in, 200, "").Body.Bytes()) {
		t.Fatal("association visibility changed original submission receipt")
	}
	setHidden(false)
	body = novelResult[shortpost.PublicPost](t, request("GET", uuid.Nil, public, nil, 200, "").Body.Bytes())
	if body.Novel == nil || body.Novel.ID != book {
		t.Fatal("restored association missing")
	}

	if _, err := db.Exec("INSERT INTO publication_policies(owner_id,observation_until) VALUES(?,UTC_TIMESTAMP(6)+INTERVAL 1 HOUR)", owner[:]); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := db.Exec("DELETE FROM publication_policies WHERE owner_id=?", owner[:]); err != nil {
			t.Errorf("policy fixture cleanup: %v", err)
		}
	})
	pendingPreview := uuid.New()
	request("PUT", owner, "/api/my/short-post-previews/"+pendingPreview.String(), shortpost.PreparePreview{
		Title: "先审合成正文", Content: "仅固定提交", ImageIDs: []uuid.UUID{preview.Images[0].ID},
	}, 200, "")
	pendingPath := submitPrefix + uuid.NewString()
	pendingInput := shortpost.SubmitPost{PreviewID: pendingPreview, RightsConfirmed: true}
	pendingRaw := request("PUT", owner, pendingPath, pendingInput, 200, "").Body.Bytes()
	pending := novelResult[shortpost.SubmissionReceipt](t, pendingRaw)
	if pending.Status != "pre_review" {
		t.Fatal("observed author bypassed review")
	}
	pendingPost := publicPrefix + pending.PostID.String()
	request("GET", uuid.Nil, pendingPost, nil, 404, "resource_not_found")
	request("GET", uuid.Nil, pendingPost+"/versions/1/images/"+preview.Images[0].ID.String(), nil, 404, "resource_not_found")
	if _, err := db.Exec("UPDATE publication_policies SET observation_until=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE owner_id=?", owner[:]); err != nil {
		t.Fatal(err)
	}
	request("GET", uuid.Nil, pendingPost, nil, 404, "resource_not_found")
	if !bytes.Equal(pendingRaw, request("PUT", owner, pendingPath, pendingInput, 200, "").Body.Bytes()) {
		t.Fatal("observation expiry changed the submission receipt")
	}

	verifyShortPostManagement(t, db, owner, other, operator, published, pending, preview.Images[0].ID, request)
	verifyShortPostRevisions(t, db, owner, other, operator, published.PostID, preview.Images[0].ID, request)

	if _, err := db.Exec("UPDATE short_post_previews SET expires_at=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE owner_id=? AND id=?", owner[:], textOnly.ID[:]); err != nil {
		t.Fatal(err)
	}
	request("PUT", owner, submitPrefix+uuid.NewString(), shortpost.SubmitPost{PreviewID: textOnly.ID, RightsConfirmed: true}, 410, "preview_expired")
}
