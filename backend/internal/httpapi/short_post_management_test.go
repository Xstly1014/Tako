package httpapi

import (
	"bytes"
	"database/sql"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"writing.local/community/internal/shortpost"
)

func verifyShortPostManagement(t *testing.T, db *sql.DB, owner, other, operator uuid.UUID, published, pending shortpost.SubmissionReceipt, image uuid.UUID,
	request func(method string, actor uuid.UUID, path string, in any, want int, code string) *httptest.ResponseRecorder) {
	t.Helper()
	ownerPath := "/api/my/short-posts/" + published.PostID.String()
	publicPath := "/api/short-posts/" + published.PostID.String()
	imagePath := publicPath + "/versions/1/images/" + image.String()
	opsPath := "/api/ops/short-posts/" + published.PostID.String()
	pendingOps := "/api/ops/short-posts/" + pending.PostID.String()
	pendingPublic := "/api/short-posts/" + pending.PostID.String()
	const queue = "/api/ops/short-posts"
	const feed = "/api/short-posts"
	request("GET", other, queue, nil, 403, "operator_required")
	request("GET", other, ownerPath, nil, 404, "resource_not_found")
	request("GET", other, pendingOps+"/images/"+image.String(), nil, 403, "operator_required")
	request("GET", operator, pendingOps+"/images/"+image.String(), nil, 200, "")
	initial := novelResult[shortpost.ManagedPost](t, request("GET", operator, pendingOps, nil, 200, "").Body.Bytes())
	if initial.ReviewStatus != "pending" || initial.PublishedAt != nil || len(initial.Images) != 1 || initial.Images[0].ID != image {
		t.Fatal("operator did not see the submitted pending snapshot")
	}
	queueHas := func(post uuid.UUID) bool {
		t.Helper()
		page := novelResult[shortpost.PostPage[shortpost.QueueItem]](t, request("GET", operator, queue, nil, 200, "").Body.Bytes())
		for _, item := range page.Items {
			if item.ID == post {
				return true
			}
		}
		return false
	}
	feedHas := func(post uuid.UUID) bool {
		t.Helper()
		page := novelResult[shortpost.PostPage[shortpost.FeedItem]](t, request("GET", uuid.Nil, feed, nil, 200, "").Body.Bytes())
		for _, item := range page.Items {
			if item.ID == post {
				return true
			}
		}
		return false
	}
	if !queueHas(pending.PostID) || !queueHas(published.PostID) || !feedHas(published.PostID) || feedHas(pending.PostID) {
		t.Fatal("initial feed or review queue visibility")
	}
	act := func(actor uuid.UUID, path string, in shortpost.PostAction, want int, code string) []byte {
		t.Helper()
		return bytes.Clone(request("POST", actor, path+"/actions", in, want, code).Body.Bytes())
	}
	action := func(name string, revision uint64, reason string) shortpost.PostAction {
		return shortpost.PostAction{MutationID: uuid.New(), ExpectedRevision: revision, Action: name, Reason: reason}
	}
	approved := action("approve", 1, "")
	approvedState := novelResult[shortpost.PostState](t, act(operator, pendingOps, approved, 200, ""))
	if approvedState.PublishedAt == nil || approvedState.ReviewStatus != "reviewed" || queueHas(pending.PostID) || !feedHas(pending.PostID) {
		t.Fatal("pre-review approval did not publish exactly once")
	}
	request("GET", uuid.Nil, pendingPublic+"/versions/1/images/"+image.String(), nil, 200, "")
	receipt := novelResult[shortpost.SubmissionReceipt](t, request("GET", owner, "/api/my/short-post-submissions/"+pending.ID.String(), nil, 200, "").Body.Bytes())
	if receipt.Status != "pre_review" {
		t.Fatal("approval rewrote the original submission receipt")
	}
	hide := action("hide", 1, "")
	hideRaw := act(owner, ownerPath, hide, 200, "")
	request("GET", uuid.Nil, publicPath, nil, 404, "resource_not_found")
	request("GET", uuid.Nil, imagePath, nil, 404, "resource_not_found")
	if feedHas(published.PostID) {
		t.Fatal("hidden post remained in feed")
	}
	act(operator, opsPath, action("limit", 1, "过期操作"), 409, "work_state_conflict")
	act(operator, opsPath, action("limit", 2, "合成限制原因"), 200, "")
	act(owner, ownerPath, action("restore", 3, ""), 409, "work_restricted")
	managed := novelResult[shortpost.ManagedPost](t, request("GET", owner, ownerPath, nil, 200, "").Body.Bytes())
	if !managed.AuthorHidden || !managed.PlatformLimited || managed.Reason != "合成限制原因" {
		t.Fatal("owner could not see the current moderation reason")
	}
	act(operator, opsPath, action("revoke_limit", 3, "合成撤销原因"), 200, "")
	request("GET", uuid.Nil, imagePath, nil, 404, "resource_not_found")
	act(owner, ownerPath, action("restore", 4, ""), 200, "")
	if !bytes.Equal(hideRaw, act(owner, ownerPath, hide, 200, "")) {
		t.Fatal("retry rewrote the original action receipt")
	}
	request("GET", uuid.Nil, imagePath, nil, 200, "")
	if !feedHas(published.PostID) {
		t.Fatal("restored post missing")
	}
	restored := novelResult[shortpost.ManagedPost](t, request("GET", owner, ownerPath, nil, 200, "").Body.Bytes())
	if restored.PublishedAt == nil || managed.PublishedAt == nil || !restored.PublishedAt.Equal(*managed.PublishedAt) {
		t.Fatal("restore changed the first release timestamp")
	}
	act(operator, pendingOps, action("limit", 2, "仅平台限制"), 200, "")
	request("GET", uuid.Nil, pendingPublic, nil, 404, "resource_not_found")
	request("GET", uuid.Nil, pendingPublic+"/versions/1/images/"+image.String(), nil, 404, "resource_not_found")
	act(operator, pendingOps, action("revoke_limit", 3, "撤销平台限制"), 200, "")

	// Exercise keyset pagination with an anchor that later becomes hidden.
	for range 11 {
		createShortPostFixture(t, request, owner)
	}
	first := novelResult[shortpost.PostPage[shortpost.FeedItem]](t, request("GET", uuid.Nil, feed, nil, 200, "").Body.Bytes())
	if len(first.Items) != 12 || first.NextCursor == "" || first.Items[0].Cover != nil {
		t.Fatal("first feed page or optional cover")
	}
	anchor := "/api/my/short-posts/" + first.NextCursor
	anchorState := novelResult[shortpost.ManagedPost](t, request("GET", owner, anchor, nil, 200, "").Body.Bytes())
	act(owner, anchor, action("hide", anchorState.Revision, ""), 200, "")
	second := novelResult[shortpost.PostPage[shortpost.FeedItem]](t, request("GET", uuid.Nil, feed+"?cursor="+first.NextCursor, nil, 200, "").Body.Bytes())
	if len(second.Items) != 1 || second.Items[0].ID == first.Items[11].ID || second.Items[0].ID != published.PostID {
		t.Fatal("hidden cursor anchor skipped or repeated an item")
	}

	if _, err := db.Exec("UPDATE publication_policies SET observation_until=UTC_TIMESTAMP(6)+INTERVAL 1 HOUR WHERE owner_id=?", owner[:]); err != nil {
		t.Fatal(err)
	}
	rejected := createShortPostFixture(t, request, owner)
	rejectedOps := "/api/ops/short-posts/" + rejected.PostID.String()
	act(operator, rejectedOps, action("reject", 1, ""), 400, "invalid_input")
	act(operator, rejectedOps, action("reject", 1, "合成驳回理由"), 200, "")
	denied := novelResult[shortpost.ManagedPost](t, request("GET", owner, "/api/my/short-posts/"+rejected.PostID.String(), nil, 200, "").Body.Bytes())
	if denied.ReviewStatus != "rejected" || denied.Reason != "合成驳回理由" || denied.PublishedAt != nil {
		t.Fatal("rejection visibility or reason")
	}
	request("GET", uuid.Nil, "/api/short-posts/"+rejected.PostID.String(), nil, 404, "resource_not_found")
}

func createShortPostFixture(t *testing.T, request func(string, uuid.UUID, string, any, int, string) *httptest.ResponseRecorder, owner uuid.UUID) shortpost.SubmissionReceipt {
	t.Helper()
	preview := uuid.New()
	request("PUT", owner, "/api/my/short-post-previews/"+preview.String(), shortpost.PreparePreview{
		Title: "频道合成短帖", Content: "短帖合成正文", ImageIDs: []uuid.UUID{},
	}, 200, "")
	return novelResult[shortpost.SubmissionReceipt](t, request("PUT", owner, "/api/my/short-post-submissions/"+uuid.NewString(), shortpost.SubmitPost{
		PreviewID: preview, RightsConfirmed: true,
	}, 200, "").Body.Bytes())
}
