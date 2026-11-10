package httpapi

import (
	"bytes"
	"database/sql"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"writing.local/community/internal/shortpost"
)

func verifyShortPostRevisions(t *testing.T, db *sql.DB, owner, other, operator, post, image uuid.UUID,
	request func(string, uuid.UUID, string, any, int, string) *httptest.ResponseRecorder) {
	t.Helper()
	ownerPath := "/api/my/short-posts/" + post.String()
	opsPath := "/api/ops/short-posts/" + post.String()
	publicPath := "/api/short-posts/" + post.String()
	v1Image := publicPath + "/versions/1/images/" + image.String()
	setObservation := func(active bool) {
		t.Helper()
		interval := "UTC_TIMESTAMP(6)-INTERVAL 1 SECOND"
		if active {
			interval = "UTC_TIMESTAMP(6)+INTERVAL 1 HOUR"
		}
		if _, err := db.Exec("UPDATE publication_policies SET observation_until="+interval+" WHERE owner_id=?", owner[:]); err != nil {
			t.Fatal(err)
		}
	}
	managed := func() shortpost.ManagedPost {
		t.Helper()
		return novelResult[shortpost.ManagedPost](t, request("GET", owner, ownerPath, nil, 200, "").Body.Bytes())
	}
	revise := func(title string, images ...uuid.UUID) (uuid.UUID, shortpost.RevisePost, []byte) {
		t.Helper()
		preview, id := uuid.New(), uuid.New()
		request("PUT", owner, "/api/my/short-post-previews/"+preview.String(), shortpost.PreparePreview{Title: title, Content: "固定修订内容", ImageIDs: append([]uuid.UUID{}, images...)}, 200, "")
		in := shortpost.RevisePost{SubmitPost: shortpost.SubmitPost{PreviewID: preview, RightsConfirmed: true}, ExpectedRevision: managed().Revision}
		result := request("PUT", owner, ownerPath+"/revisions/"+id.String(), in, 200, "")
		return id, in, bytes.Clone(result.Body.Bytes())
	}
	act := func(actor uuid.UUID, path, action string, version uint64, submission *uuid.UUID, want int, code string) {
		t.Helper()
		in := shortpost.PostAction{MutationID: uuid.New(), ExpectedRevision: managed().Revision, Action: action, Version: version, RevisionID: submission}
		if action == "reject" || action == "limit_version" || action == "revoke_version_limit" {
			in.Reason = "合成审核原因"
		}
		request("POST", actor, path+"/actions", in, want, code)
	}
	readVersion := func(want uint64) {
		t.Helper()
		got := novelResult[shortpost.PublicPost](t, request("GET", uuid.Nil, publicPath, nil, 200, "").Body.Bytes())
		if got.Version != want {
			t.Fatalf("display version %d want %d", got.Version, want)
		}
	}
	initial := managed()
	setObservation(false)
	first, in, raw := revise("第二版", image)
	if got := novelResult[shortpost.SubmissionReceipt](t, raw); got.Status != "published" {
		t.Fatal("normal revision failed")
	}
	if !bytes.Equal(raw, request("PUT", owner, ownerPath+"/revisions/"+first.String(), in, 200, "").Body.Bytes()) {
		t.Fatal("revision receipt changed")
	}
	queuePath := "/api/ops/short-post-revisions"
	queue := func() shortpost.PostPage[shortpost.RevisionQueueItem] {
		t.Helper()
		return novelResult[shortpost.PostPage[shortpost.RevisionQueueItem]](t, request("GET", operator, queuePath, nil, 200, "").Body.Bytes())
	}
	queued := queue()
	if len(queued.Items) != 1 || queued.Items[0].ID != first || queued.Items[0].PreReview || queued.Items[0].Version == nil || *queued.Items[0].Version != 2 {
		t.Fatal("normal revision missing from the post-review queue")
	}
	act(operator, opsPath, "approve", 0, &first, 200, "")
	if len(queue().Items) != 0 {
		t.Fatal("reviewed revision stayed in queue")
	}
	postReview := novelResult[shortpost.RevisionSnapshot](t, request("GET", owner, ownerPath+"/revisions/"+first.String(), nil, 200, "").Body.Bytes())
	if postReview.PostReviewPending || postReview.Version == nil || *postReview.Version != 2 {
		t.Fatal("post-review created a new official version or left the revision pending")
	}
	readVersion(2)
	request("GET", uuid.Nil, publicPath+"/versions/2/images/"+image.String(), nil, 200, "")
	request("GET", uuid.Nil, publicPath+"/versions/1", nil, 404, "resource_not_found")
	request("GET", uuid.Nil, v1Image, nil, 404, "resource_not_found")
	request("GET", owner, ownerPath+"/versions/1", nil, 200, "")
	request("GET", other, ownerPath+"/versions/1", nil, 404, "resource_not_found")
	timeline := novelResult[[]shortpost.VersionNode](t, request("GET", uuid.Nil, publicPath+"/versions", nil, 200, "").Body.Bytes())
	if len(timeline) != 2 || timeline[0].Version != 2 || !timeline[0].Readable || timeline[1].Readable {
		t.Fatal("closed history leaked an old version")
	}
	act(owner, ownerPath, "history_open", 0, nil, 200, "")
	request("GET", uuid.Nil, v1Image, nil, 200, "")
	act(owner, ownerPath, "show_version", 1, nil, 200, "")
	act(owner, ownerPath, "history_close", 0, nil, 200, "")
	readVersion(1)
	request("GET", uuid.Nil, publicPath+"/versions/2", nil, 404, "resource_not_found")
	act(owner, ownerPath, "hide", 0, nil, 200, "")
	request("GET", uuid.Nil, publicPath+"/versions", nil, 404, "resource_not_found")
	act(owner, ownerPath, "restore", 0, nil, 200, "")
	readVersion(2)
	if current := managed(); initial.PublishedAt == nil || current.PublishedAt == nil || !initial.PublishedAt.Equal(*current.PublishedAt) {
		t.Fatal("revision changed first publication ordering")
	}
	setObservation(true)
	old, _, oldRaw := revise("旧待审版")
	if novelResult[shortpost.SubmissionReceipt](t, oldRaw).Status != "pre_review" {
		t.Fatal("observation bypassed")
	}
	setObservation(false)
	replacement, replacementIn, replacementRaw := revise("新待审版", image)
	if novelResult[shortpost.SubmissionReceipt](t, replacementRaw).Status != "pre_review" {
		t.Fatal("replaced pending revision bypassed manual review")
	}
	readVersion(2)
	if got := novelResult[shortpost.RevisionSnapshot](t, request("GET", operator, opsPath+"/revisions/"+old.String(), nil, 200, "").Body.Bytes()); got.State != "superseded" || got.Version != nil {
		t.Fatal("replacement left an official version")
	}
	request("GET", other, queuePath, nil, 403, "operator_required")
	queued = queue()
	if len(queued.Items) != 1 || queued.Items[0].ID != replacement || !queued.Items[0].PreReview || queued.Items[0].Version != nil {
		t.Fatal("review queue did not keep only the current submission")
	}
	reviewImage := opsPath + "/revisions/" + replacement.String() + "/images/" + image.String()
	request("GET", other, reviewImage, nil, 403, "operator_required")
	request("GET", operator, reviewImage, nil, 200, "")
	act(operator, opsPath, "approve", 0, &old, 409, "work_state_conflict")
	act(operator, opsPath, "approve", 0, &replacement, 200, "")
	readVersion(3)
	if !bytes.Equal(replacementRaw, request("PUT", owner, ownerPath+"/revisions/"+replacement.String(), replacementIn, 200, "").Body.Bytes()) {
		t.Fatal("approval rewrote original receipt")
	}
	got := novelResult[shortpost.RevisionSnapshot](t, request("GET", owner, ownerPath+"/revisions/"+replacement.String(), nil, 200, "").Body.Bytes())
	if got.State != "published" || got.Version == nil || *got.Version != 3 {
		t.Fatal("approval did not assign next version")
	}
	setObservation(true)
	rejected, _, _ := revise("将驳回")
	act(operator, opsPath, "reject", 0, &rejected, 200, "")
	got = novelResult[shortpost.RevisionSnapshot](t, request("GET", owner, ownerPath+"/revisions/"+rejected.String(), nil, 200, "").Body.Bytes())
	if got.State != "rejected" || got.Version != nil || got.Reason == "" {
		t.Fatal("rejected revision leaked or lost reason")
	}
	readVersion(3)
	setObservation(false)
	v4, _, _ := revise("第四版", image)
	readVersion(4)
	act(owner, ownerPath, "history_open", 0, nil, 200, "")
	act(operator, opsPath, "limit_version", 4, nil, 200, "")
	if len(queue().Items) != 0 {
		t.Fatal("limited revision stayed in post-review queue")
	}
	limited := novelResult[shortpost.OwnedPostVersion](t, request("GET", owner, ownerPath+"/versions/4", nil, 200, "").Body.Bytes())
	if !limited.PlatformLimited || limited.ReviewReason != "合成审核原因" || limited.Content == "" {
		t.Fatal("author restriction details incorrect")
	}
	request("GET", uuid.Nil, publicPath, nil, 404, "resource_not_found")
	request("GET", uuid.Nil, publicPath+"/versions/4", nil, 404, "resource_not_found")
	v4Image := publicPath + "/versions/4/images/" + image.String()
	request("GET", uuid.Nil, v4Image, nil, 404, "resource_not_found")
	request("GET", uuid.Nil, publicPath+"/versions/2/images/"+image.String(), nil, 200, "")
	nodes := novelResult[[]shortpost.VersionNode](t, request("GET", uuid.Nil, publicPath+"/versions", nil, 200, "").Body.Bytes())
	if len(nodes) != 3 || nodes[0].Version != 3 {
		t.Fatal("public timeline exposed the limited version")
	}
	page := novelResult[shortpost.PostPage[shortpost.FeedItem]](t, request("GET", uuid.Nil, "/api/short-posts", nil, 200, "").Body.Bytes())
	for _, item := range page.Items {
		if item.ID == post {
			t.Fatal("limited display version remained in feed")
		}
	}
	act(owner, ownerPath, "show_version", 2, nil, 200, "")
	act(owner, ownerPath, "show_version", 4, nil, 409, "work_restricted")
	act(owner, ownerPath, "hide", 0, nil, 200, "")
	act(owner, ownerPath, "restore", 0, nil, 200, "")
	readVersion(3)
	act(operator, opsPath, "revoke_version_limit", 4, nil, 200, "")
	readVersion(3)
	request("GET", uuid.Nil, v4Image, nil, 200, "")
	act(owner, ownerPath, "show_version", 4, nil, 200, "")
	readVersion(4)
	postReview = novelResult[shortpost.RevisionSnapshot](t, request("GET", owner, ownerPath+"/revisions/"+v4.String(), nil, 200, "").Body.Bytes())
	if postReview.PostReviewPending || postReview.Version == nil || *postReview.Version != 4 {
		t.Fatal("restriction reversal changed publication or post-review history")
	}
	verifyShortPostAppeals(t, db, owner, other, operator, post, image, request)
	verifyFirstShortPostReplacement(t, db, owner, operator, image, request)
}

func verifyFirstShortPostReplacement(t *testing.T, db *sql.DB, owner, operator, image uuid.UUID,
	request func(string, uuid.UUID, string, any, int, string) *httptest.ResponseRecorder) {
	t.Helper()
	if _, err := db.Exec("UPDATE publication_policies SET observation_until=UTC_TIMESTAMP(6)+INTERVAL 1 HOUR WHERE owner_id=?", owner[:]); err != nil {
		t.Fatal(err)
	}
	initial := createShortPostFixture(t, request, owner)
	if initial.Status != "pre_review" {
		t.Fatal("first submission was not pending")
	}
	ownerPath := "/api/my/short-posts/" + initial.PostID.String()
	opsPath := "/api/ops/short-posts/" + initial.PostID.String()
	publicPath := "/api/short-posts/" + initial.PostID.String()
	manage := func() shortpost.ManagedPost {
		return novelResult[shortpost.ManagedPost](t, request("GET", owner, ownerPath, nil, 200, "").Body.Bytes())
	}
	if _, err := db.Exec("UPDATE publication_policies SET observation_until=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE owner_id=?", owner[:]); err != nil {
		t.Fatal(err)
	}
	submitReplacement := func(title string) uuid.UUID {
		preview, id := uuid.New(), uuid.New()
		request("PUT", owner, "/api/my/short-post-previews/"+preview.String(), shortpost.PreparePreview{Title: title, Content: "合成替换正文", ImageIDs: []uuid.UUID{image}}, 200, "")
		in := shortpost.RevisePost{SubmitPost: shortpost.SubmitPost{PreviewID: preview, RightsConfirmed: true}, ExpectedRevision: manage().Revision}
		out := novelResult[shortpost.SubmissionReceipt](t, request("PUT", owner, ownerPath+"/revisions/"+id.String(), in, 200, "").Body.Bytes())
		if out.Status != "pre_review" || out.PostID != initial.PostID {
			t.Fatal("replacement escaped first review")
		}
		return id
	}
	first := submitReplacement("首次替换")
	latest := submitReplacement("第二次替换")
	request("GET", uuid.Nil, publicPath, nil, 404, "resource_not_found")
	current := manage()
	if current.Title != "第二次替换" || current.LatestSubmissionID == nil || *current.LatestSubmissionID != latest || current.DisplayVersion != 0 {
		t.Fatal("author management did not show the latest private submission")
	}
	original := novelResult[shortpost.ManagedPost](t, request("GET", operator, opsPath, nil, 200, "").Body.Bytes())
	if original.ReviewStatus != "superseded" {
		t.Fatal("original first review was not archived")
	}
	decide := func(action string, id *uuid.UUID, want int, code string) {
		in := shortpost.PostAction{MutationID: uuid.New(), ExpectedRevision: manage().Revision, Action: action, RevisionID: id, Reason: "合成审核"}
		request("POST", operator, opsPath+"/actions", in, want, code)
	}
	decide("approve", nil, 409, "work_state_conflict")
	decide("approve", &first, 409, "work_state_conflict")
	decide("reject", &latest, 200, "")
	if got := manage(); got.ReviewStatus != "rejected" || got.Reason != "合成审核" {
		t.Fatal("author cannot recover the rejection result")
	}
	final := submitReplacement("最终首发")
	decide("approve", &final, 200, "")
	post := novelResult[shortpost.PublicPost](t, request("GET", uuid.Nil, publicPath, nil, 200, "").Body.Bytes())
	if post.Version != 1 || post.Title != "最终首发" || len(post.Images) != 1 {
		t.Fatal("approved replacement was not the only first version")
	}
	request("GET", uuid.Nil, publicPath+"/versions/1/images/"+image.String(), nil, 200, "")
	receipt := novelResult[shortpost.SubmissionReceipt](t, request("GET", owner, "/api/my/short-post-submissions/"+initial.ID.String(), nil, 200, "").Body.Bytes())
	if receipt != initial {
		t.Fatal("replacement changed the original receipt")
	}
}
