package httpapi

import (
	"bytes"
	"database/sql"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"writing.local/community/internal/shortpost"
)

func verifyShortPostAppeals(t *testing.T, db *sql.DB, owner, other, operator, post, image uuid.UUID,
	request func(string, uuid.UUID, string, any, int, string) *httptest.ResponseRecorder) {
	t.Helper()
	ownerPath := "/api/my/short-posts/" + post.String()
	opsPath := "/api/ops/short-posts/" + post.String()
	publicPath := "/api/short-posts/" + post.String()
	photo := publicPath + "/versions/4/images/" + image.String()
	manage := func() shortpost.ManagedPost {
		return novelResult[shortpost.ManagedPost](t, request("GET", owner, ownerPath, nil, 200, "").Body.Bytes())
	}
	version := func() shortpost.OwnedPostVersion {
		return novelResult[shortpost.OwnedPostVersion](t, request("GET", owner, ownerPath+"/versions/4", nil, 200, "").Body.Bytes())
	}
	action := func(name string, version uint64, appeal *uuid.UUID) shortpost.PostAction {
		return shortpost.PostAction{MutationID: uuid.New(), ExpectedRevision: manage().Revision, Action: name, Version: version, AppealID: appeal, Reason: "合成处理原因"}
	}
	act := func(in shortpost.PostAction, want int, code string) []byte {
		t.Helper()
		return bytes.Clone(request("POST", operator, opsPath+"/actions", in, want, code).Body.Bytes())
	}
	act(action("limit_version", 4, nil), 200, "")
	firstCase := version().LimitCaseRevision
	if firstCase == nil {
		t.Fatal("active version case absent")
	}
	act(action("limit", 0, nil), 200, "")
	globalCase := manage().LimitCaseRevision
	if globalCase == nil {
		t.Fatal("active post case absent")
	}
	create := func(id uuid.UUID, actor uuid.UUID, caseID uint64, want int, code string) []byte {
		t.Helper()
		in := shortpost.FileAppeal{CaseRevision: caseID, Reason: "合成复核申请"}
		return bytes.Clone(request("PUT", actor, ownerPath+"/appeals/"+id.String(), in, want, code).Body.Bytes())
	}
	original, global := uuid.New(), uuid.New()
	create(original, other, *firstCase, 404, "resource_not_found")
	originalRaw := create(original, owner, *firstCase, 200, "")
	if !bytes.Equal(originalRaw, create(original, owner, *firstCase, 200, "")) {
		t.Fatal("duplicate filing changed the pending record")
	}
	create(uuid.New(), owner, *firstCase, 409, "appeal_pending")
	create(global, owner, *globalCase, 200, "")
	request("GET", other, ownerPath+"/appeals/"+original.String(), nil, 404, "resource_not_found")
	request("GET", other, "/api/ops/short-post-appeals", nil, 403, "operator_required")
	queue := novelResult[shortpost.AppealPage](t, request("GET", operator, "/api/ops/short-post-appeals", nil, 200, "").Body.Bytes())
	if len(queue.Items) != 2 || queue.Items[0].ID != global || queue.Items[1].Version == nil || *queue.Items[1].Version != 4 {
		t.Fatal("appeal queue did not preserve separate case scopes")
	}
	request("GET", operator, opsPath+"/appeals/"+original.String(), nil, 200, "")
	uphold := action("appeal_uphold", 0, &original)
	result := act(uphold, 200, "")
	if !bytes.Equal(result, act(uphold, 200, "")) {
		t.Fatal("decision replay changed the original state receipt")
	}
	create(uuid.New(), owner, *firstCase, 409, "appeal_cooldown")
	if _, err := db.Exec("UPDATE short_post_appeals SET decided_at=UTC_TIMESTAMP(6)-INTERVAL 25 HOUR WHERE post_id=? AND id=?", post[:], original[:]); err != nil {
		t.Fatal(err)
	}
	second := uuid.New()
	create(second, owner, *firstCase, 200, "")
	act(action("revoke_version_limit", 4, nil), 200, "")
	get := func(id uuid.UUID) shortpost.Appeal {
		return novelResult[shortpost.Appeal](t, request("GET", owner, ownerPath+"/appeals/"+id.String(), nil, 200, "").Body.Bytes())
	}
	if state := get(second); state.State != "revoked" || state.DecisionReason == "" {
		t.Fatal("manual revocation did not settle the corresponding appeal")
	}
	act(action("limit_version", 4, nil), 200, "")
	newerCase := version().LimitCaseRevision
	if newerCase == nil || *newerCase == *firstCase {
		t.Fatal("relimit reused the old case")
	}
	create(uuid.New(), owner, *firstCase, 409, "work_state_conflict")
	act(action("appeal_revoke", 0, &second), 409, "work_state_conflict")
	third := uuid.New()
	create(third, owner, *newerCase, 200, "")
	act(action("appeal_revoke", 0, &third), 200, "")
	if version().PlatformLimited || !manage().PlatformLimited || get(third).State != "revoked" {
		t.Fatal("version appeal altered the independent post restriction")
	}
	request("GET", uuid.Nil, photo, nil, 404, "resource_not_found")
	hide := shortpost.PostAction{MutationID: uuid.New(), ExpectedRevision: manage().Revision, Action: "hide"}
	request("POST", owner, ownerPath+"/actions", hide, 200, "")
	act(action("appeal_revoke", 0, &global), 200, "")
	if !manage().AuthorHidden || manage().PlatformLimited {
		t.Fatal("work appeal overrode author visibility")
	}
	request("GET", uuid.Nil, photo, nil, 404, "resource_not_found")
	restore := shortpost.PostAction{MutationID: uuid.New(), ExpectedRevision: manage().Revision, Action: "restore"}
	request("POST", owner, ownerPath+"/actions", restore, 200, "")
	request("GET", uuid.Nil, photo, nil, 200, "")
	history := novelResult[shortpost.AppealPage](t, request("GET", owner, ownerPath+"/appeals", nil, 200, "").Body.Bytes())
	if len(history.Items) != 4 || get(original).State != "upheld" || get(global).State != "revoked" {
		t.Fatal("author appeal history lost a decided request")
	}
}
