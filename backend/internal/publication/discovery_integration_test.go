package publication_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"writing.local/community/internal/draft"
	. "writing.local/community/internal/publication"
)

func lockDiscovery(t *testing.T, s Store) {
	t.Helper()
	connection, e := s.DB.Conn(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	var locked int
	if e = connection.QueryRowContext(context.Background(), "SELECT GET_LOCK('tako_community_fixture',30)").Scan(&locked); e != nil || locked != 1 {
		connection.Close()
		t.Fatal("community fixture lock", e)
	}
	t.Cleanup(func() {
		connection.ExecContext(context.Background(), "DO RELEASE_LOCK('tako_community_fixture')")
		connection.Close()
	})
}
func curate(t *testing.T, s Store, actor, work uuid.UUID, slot uint64) CurationChange {
	t.Helper()
	ctx := context.Background()
	state, e := s.Curations(ctx)
	if e != nil {
		t.Fatal(e)
	}
	candidate, e := s.CurationCandidate(ctx, work)
	if e != nil {
		t.Fatal(e)
	}
	in := CurationChange{MutationID: uuid.New(), ExpectedRevision: state.Revision, Slot: slot, WorkID: &work, ExpectedWorkRevision: candidate.StateRevision}
	if _, e = s.ChangeCuration(ctx, actor, in); e != nil {
		t.Fatal(e)
	}
	return in
}
func findCard(items []WorkCard, id uuid.UUID) *WorkCard {
	for i := range items {
		if items[i].ID == id {
			return &items[i]
		}
	}
	return nil
}

func TestDiscoveryVisibilitySelectionInvalidationAndReceipt(t *testing.T) {
	s, owner, actor, d, r := published(t)
	lockDiscovery(t, s)
	ctx := context.Background()
	original := curate(t, s, actor, r.WorkID, 1)
	first, e := s.Discover(ctx, "", "")
	if e != nil || findCard(first.Featured, r.WorkID) == nil {
		t.Fatal("selected work absent", e)
	}
	t.Cleanup(func() {
		s.DB.Exec("DELETE FROM moderation_mutations WHERE owner_id=?", owner[:])
		s.DB.Exec("DELETE a FROM moderation_appeals a JOIN moderation_cases c ON c.id=a.case_id WHERE c.owner_id=?", owner[:])
		s.DB.Exec("DELETE FROM moderation_cases WHERE owner_id=?", owner[:])
	})
	change(t, s, owner, r.WorkID, "hide", nil, nil)
	hidden, e := s.Discover(ctx, "", "")
	if e != nil || findCard(hidden.Items, r.WorkID) != nil || findCard(hidden.Featured, r.WorkID) != nil {
		t.Fatal("hidden work discovered", e)
	}
	if _, e = s.CurationCandidate(ctx, r.WorkID); !errors.Is(e, ErrNotFound) {
		t.Fatal("hidden candidate exposed")
	}
	change(t, s, owner, r.WorkID, "restore", nil, nil)
	restored, e := s.Discover(ctx, "", "")
	if e != nil || findCard(restored.Featured, r.WorkID) != nil {
		t.Fatal("restored work auto-selected", e)
	}
	// A lost response retry confirms the old action without reapplying selection.
	if _, e = s.ChangeCuration(ctx, actor, original); e != nil {
		t.Fatal(e)
	}
	restored, e = s.Discover(ctx, "", "")
	if e != nil || findCard(restored.Featured, r.WorkID) != nil {
		t.Fatal("receipt revived expired selection", e)
	}
	original.Slot = 2
	if _, e = s.ChangeCuration(ctx, actor, original); !errors.Is(e, ErrKeyReuse) {
		t.Fatal("mutation reuse accepted", e)
	}
	curate(t, s, actor, r.WorkID, 1)
	// A new formal version changes all card fields together, not its original date.
	saved, e := (draft.Store{DB: s.DB}).Write(ctx, owner, "save", draft.Write{MutationID: uuid.New(), DraftID: d, BaseRevision: 1, Title: "新的公开标题", Content: "新的正式正文，不应出现在作品卡片中。"})
	if e != nil {
		t.Fatal(e)
	}
	p, e := s.Prepare(ctx, owner, Prepare{MutationID: uuid.New(), DraftID: d, SourceRevision: saved.Revision, RightsConfirmed: true, Introduction: "新版作者简介", Tags: []string{"科幻"}})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Publish(ctx, owner, Publish{MutationID: uuid.New(), PreviewID: p.ID, ExpectedVersion: 1}); e != nil {
		t.Fatal(e)
	}
	latest, e := s.Discover(ctx, "科幻", "")
	if e != nil {
		t.Fatal(e)
	}
	card := findCard(latest.Items, r.WorkID)
	if card == nil || card.Version != 2 || card.Title != "新的公开标题" || card.Introduction != "新版作者简介" || !card.FirstPublishedAt.Equal(r.PublishedAt) {
		t.Fatal("card did not follow displayed formal version")
	}
	encoded, _ := json.Marshal(latest)
	if strings.Contains(string(encoded), "新的正式正文") {
		t.Fatal("body leaked into discovery")
	}
	// Limiting an old, non-displayed version does not evict the current work.
	task, e := s.ReviewDetail(ctx, r.WorkID, 1)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Review(ctx, actor, r.WorkID, 1, ModerationAction{MutationID: uuid.New(), ExpectedRevision: task.Task.Revision, Decision: "restrict_version", Reason: "旧版测试限制"}); e != nil {
		t.Fatal(e)
	}
	latest, e = s.Discover(ctx, "", "")
	if e != nil || findCard(latest.Featured, r.WorkID) == nil {
		t.Fatal("unrelated old limit removed current selection", e)
	}
	task, e = s.ReviewDetail(ctx, r.WorkID, 2)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Review(ctx, actor, r.WorkID, 2, ModerationAction{MutationID: uuid.New(), ExpectedRevision: task.Task.Revision, Decision: "restrict_version", Reason: "当前版测试限制"}); e != nil {
		t.Fatal(e)
	}
	latest, e = s.Discover(ctx, "", "")
	if e != nil || findCard(latest.Featured, r.WorkID) != nil || findCard(latest.Items, r.WorkID) != nil {
		t.Fatal("current limit leaked", e)
	}
	cases, e := s.Cases(ctx, owner, 0)
	if e != nil {
		t.Fatal(e)
	}
	for _, c := range cases.Items {
		if c.Version == 2 {
			if _, e = s.DecideCase(ctx, actor, c.ID, ModerationAction{MutationID: uuid.New(), ExpectedRevision: c.Revision, Decision: "revoke", Reason: "恢复测试"}); e != nil {
				t.Fatal(e)
			}
		}
	}
	latest, e = s.Discover(ctx, "", "")
	if e != nil || findCard(latest.Featured, r.WorkID) != nil {
		t.Fatal("revocation auto-selected work", e)
	}
}

func TestDiscoveryPaginationAndStaleEditorialChanges(t *testing.T) {
	s, owner, actor, _ := setup(t)
	lockDiscovery(t, s)
	ctx := context.Background()
	ids := map[uuid.UUID]bool{}
	for i := 0; i < 14; i++ {
		d, e := (draft.Store{DB: s.DB}).Write(ctx, owner, "create", draft.Write{MutationID: uuid.New(), Title: "分页测试作品", Content: "独立分页测试正文"})
		if e != nil {
			t.Fatal(e)
		}
		p := prepare(t, s, owner, d.DraftID)
		r, e := s.Publish(ctx, owner, Publish{MutationID: uuid.New(), PreviewID: p.ID})
		if e != nil {
			t.Fatal(e)
		}
		ids[r.WorkID] = true
		if _, e = s.DB.Exec("UPDATE work_versions SET published_at='2035-01-01 00:00:00.000001' WHERE work_id=? AND version=1", r.WorkID[:]); e != nil {
			t.Fatal(e)
		}
	}
	page, e := s.Discover(ctx, "", "")
	if e != nil || len(page.Items) != 12 || page.NextCursor == "" {
		t.Fatal("pagination missing", e)
	}
	seen := map[uuid.UUID]bool{}
	for _, card := range page.Items {
		if ids[card.ID] {
			seen[card.ID] = true
		}
	}
	next, e := s.Discover(ctx, "", page.NextCursor)
	if e != nil {
		t.Fatal(e)
	}
	for _, card := range next.Items {
		if seen[card.ID] {
			t.Fatal("duplicate across pages")
		}
		if ids[card.ID] {
			seen[card.ID] = true
		}
	}
	if len(seen) != 14 {
		t.Fatal("missing same-timestamp works")
	}
	if _, e = s.Discover(ctx, "幻想", page.NextCursor); !errors.Is(e, ErrInvalid) {
		t.Fatal("cross-tag cursor accepted")
	}
	if _, e = s.Discover(ctx, "不存在", ""); !errors.Is(e, ErrInvalid) {
		t.Fatal("unknown tag accepted")
	}
	state, e := s.Curations(ctx)
	if e != nil {
		t.Fatal(e)
	}
	candidate, e := s.CurationCandidate(ctx, page.Items[0].ID)
	if e != nil {
		t.Fatal(e)
	}
	in := CurationChange{MutationID: uuid.New(), ExpectedRevision: state.Revision, Slot: 1, WorkID: &candidate.Work.ID, ExpectedWorkRevision: candidate.StateRevision}
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		action := in
		action.MutationID = uuid.New()
		action.Slot = uint64(i + 1)
		wg.Add(1)
		go func() { defer wg.Done(); <-start; _, e := s.ChangeCuration(ctx, actor, action); results <- e }()
	}
	close(start)
	wg.Wait()
	close(results)
	ok, conflict := 0, 0
	for e := range results {
		if e == nil {
			ok++
		} else if errors.Is(e, ErrCurationConflict) {
			conflict++
		} else {
			t.Fatal(e)
		}
	}
	if ok != 1 || conflict != 1 {
		t.Fatal("concurrent curation overwrote")
	}
	state, e = s.Curations(ctx)
	if e != nil {
		t.Fatal(e)
	}
	in.ExpectedRevision = state.Revision
	in.MutationID = uuid.New()
	change(t, s, owner, candidate.Work.ID, "hide", nil, nil)
	change(t, s, owner, candidate.Work.ID, "restore", nil, nil)
	if _, e = s.ChangeCuration(ctx, actor, in); !errors.Is(e, ErrStateConflict) {
		t.Fatal("stale pre-hide candidate selected", e)
	}
}

func TestCurationReceiptFailureRollsBackSelectionAndRevision(t *testing.T) {
	s, owner, actor, _, r := published(t)
	lockDiscovery(t, s)
	ctx := context.Background()
	before, e := s.Curations(ctx)
	if e != nil {
		t.Fatal(e)
	}
	candidate, e := s.CurationCandidate(ctx, r.WorkID)
	if e != nil {
		t.Fatal(e)
	}
	input := CurationChange{MutationID: uuid.New(), ExpectedRevision: before.Revision, Slot: 1, WorkID: &r.WorkID, ExpectedWorkRevision: candidate.StateRevision}
	fault := Store{DB: failureDB(t, "INSERT INTO community_curation_mutations")}
	if _, e = fault.ChangeCuration(ctx, actor, input); e == nil {
		t.Fatal("injected receipt error ignored")
	}
	after, e := s.Curations(ctx)
	if e != nil {
		t.Fatal(e)
	}
	a, _ := json.Marshal(before)
	b, _ := json.Marshal(after)
	if string(a) != string(b) {
		t.Fatal("partial editorial update committed")
	}
	curate(t, s, actor, r.WorkID, 1)
	work, e := s.AuthorState(ctx, owner, r.WorkID)
	if e != nil {
		t.Fatal(e)
	}
	fault = Store{DB: failureDB(t, "INSERT INTO work_events ")}
	if _, e = fault.Change(ctx, owner, r.WorkID, Change{MutationID: uuid.New(), ExpectedStateRevision: work.StateRevision, Action: "hide"}); e == nil {
		t.Fatal("injected hide error ignored")
	}
	page, e := s.Discover(ctx, "", "")
	if e != nil || findCard(page.Featured, r.WorkID) == nil {
		t.Fatal("failed hide invalidated selected work", e)
	}
}
