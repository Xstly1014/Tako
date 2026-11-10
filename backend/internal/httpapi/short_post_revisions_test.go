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
		if action == "reject" {
			in.Reason = "合成驳回原因"
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
	queuePath := "/api/ops/short-post-revisions"
	request("GET", other, queuePath, nil, 403, "operator_required")
	queue := novelResult[shortpost.PostPage[shortpost.RevisionQueueItem]](t, request("GET", operator, queuePath, nil, 200, "").Body.Bytes())
	if len(queue.Items) != 1 || queue.Items[0].ID != replacement {
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
}
