package publication_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	. "writing.local/community/internal/publication"
)

func published(t *testing.T) (Store, uuid.UUID, uuid.UUID, uuid.UUID, Result) {
	t.Helper()
	s, owner, other, d := setup(t)
	p := prepare(t, s, owner, d)
	r, e := s.Publish(context.Background(), owner, Publish{MutationID: uuid.New(), PreviewID: p.ID})
	if e != nil {
		t.Fatal(e)
	}
	return s, owner, other, d, r
}
func change(t *testing.T, s Store, owner, id uuid.UUID, action string, version *uint64, history *bool) State {
	t.Helper()
	st, e := s.AuthorState(context.Background(), owner, id)
	if e != nil {
		t.Fatal(e)
	}
	out, e := s.Change(context.Background(), owner, id, Change{MutationID: uuid.New(), ExpectedStateRevision: st.StateRevision, Action: action, Version: version, HistoryOpen: history})
	if e != nil {
		t.Fatal(e)
	}
	return out
}
func TestHiddenPublicationAndExplicitRestore(t *testing.T) {
	s, owner, other, d, r := published(t)
	ctx := context.Background()
	if _, e := s.AuthorState(ctx, other, r.WorkID); !errors.Is(e, ErrNotFound) {
		t.Fatal("state ownership", e)
	}
	if _, e := s.AuthorVersion(ctx, other, r.WorkID, 1); !errors.Is(e, ErrNotFound) {
		t.Fatal("version ownership", e)
	}
	if _, e := s.AuthorTimeline(ctx, other, r.WorkID, 0, 0); !errors.Is(e, ErrNotFound) {
		t.Fatal("timeline ownership", e)
	}
	hidden := change(t, s, owner, r.WorkID, "hide", nil, nil)
	p := prepare(t, s, owner, d)
	next, e := s.Publish(ctx, owner, Publish{MutationID: uuid.New(), PreviewID: p.ID, ExpectedVersion: 1})
	if e != nil {
		t.Fatal(e)
	}
	st, e := s.AuthorState(ctx, owner, r.WorkID)
	if e != nil || !st.AuthorHidden || st.LastVersion != 2 || st.StateRevision <= hidden.StateRevision {
		t.Fatal("hidden publication state", e)
	}
	if _, e = s.Read(ctx, r.WorkID, 0); !errors.Is(e, ErrNotFound) {
		t.Fatal("hidden content exposed", e)
	}
	if _, e = s.Change(ctx, owner, r.WorkID, Change{MutationID: uuid.New(), ExpectedStateRevision: hidden.StateRevision, Action: "restore"}); !errors.Is(e, ErrStateConflict) {
		t.Fatal("stale restore accepted", e)
	}
	restored := change(t, s, owner, r.WorkID, "restore", nil, nil)
	if restored.DisplayVersion != next.Version || restored.AuthorHidden {
		t.Fatal("restore did not choose latest")
	}
	if _, e = s.Read(ctx, r.WorkID, 1); !errors.Is(e, ErrNotFound) {
		t.Fatal("closed history read", e)
	}
	yes := true
	change(t, s, owner, r.WorkID, "set_history", nil, &yes)
	if _, e = s.Read(ctx, r.WorkID, 1); e != nil {
		t.Fatal(e)
	}
	change(t, s, owner, r.WorkID, "hide", nil, nil)
	if _, e = s.DB.Exec("UPDATE work_versions SET platform_limited=TRUE WHERE work_id=? AND version=2", r.WorkID[:]); e != nil {
		t.Fatal(e)
	}
	st, _ = s.AuthorState(ctx, owner, r.WorkID)
	if _, e = s.Change(ctx, owner, r.WorkID, Change{MutationID: uuid.New(), ExpectedStateRevision: st.StateRevision, Action: "restore"}); !errors.Is(e, ErrVersionUnavailable) {
		t.Fatal("limited latest silently restored", e)
	}
	one := uint64(1)
	restored = change(t, s, owner, r.WorkID, "restore", &one, nil)
	if restored.DisplayVersion != 1 {
		t.Fatal("explicit fallback ignored")
	}
	if _, e = s.AuthorVersion(ctx, owner, r.WorkID, 2); e != nil {
		t.Fatal("author lost own restricted content", e)
	}
	if _, e = s.Read(ctx, r.WorkID, 2); !errors.Is(e, ErrNotFound) {
		t.Fatal("restricted version public", e)
	}
	if _, e = s.Change(ctx, owner, r.WorkID, Change{MutationID: uuid.New(), ExpectedStateRevision: restored.StateRevision, Action: "switch_display", Version: &next.Version}); !errors.Is(e, ErrVersionUnavailable) {
		t.Fatal("restricted display selected", e)
	}
	timeline, e := s.Timeline(ctx, r.WorkID, 0, 0)
	if e != nil {
		t.Fatal(e)
	}
	if len(timeline.Versions) != 1 || timeline.Versions[0].Version != 1 {
		t.Fatal("restricted version node leaked")
	}
	for _, event := range timeline.Events {
		if event.Version == 2 {
			t.Fatal("restricted target event leaked")
		}
	}
	serialized, _ := json.Marshal(timeline)
	if strings.Contains(string(serialized), "title") || strings.Contains(string(serialized), "content") {
		t.Fatal("timeline exposed private fields")
	}
	change(t, s, owner, r.WorkID, "hide", nil, nil)
	s.DB.Exec("UPDATE works SET platform_limited=TRUE,state_revision=state_revision+1 WHERE id=?", r.WorkID[:])
	st, _ = s.AuthorState(ctx, owner, r.WorkID)
	if _, e = s.Change(ctx, owner, r.WorkID, Change{MutationID: uuid.New(), ExpectedStateRevision: st.StateRevision, Action: "restore", Version: &one}); !errors.Is(e, ErrWorkRestricted) {
		t.Fatal("whole-work limitation bypassed", e)
	}
	p = prepare(t, s, owner, d)
	if _, e = s.Publish(ctx, owner, Publish{MutationID: uuid.New(), PreviewID: p.ID, ExpectedVersion: 2}); e != nil {
		t.Fatal("limited work cannot prepare correction", e)
	}
	if _, e = s.Read(ctx, r.WorkID, 0); !errors.Is(e, ErrNotFound) {
		t.Fatal("correction removed work limitation", e)
	}
}
func TestManagementRetriesAndStateCompetition(t *testing.T) {
	s, owner, _, _, r := published(t)
	ctx := context.Background()
	st, _ := s.AuthorState(ctx, owner, r.WorkID)
	yes := true
	inputs := []Change{{MutationID: uuid.New(), ExpectedStateRevision: st.StateRevision, Action: "hide"}, {MutationID: uuid.New(), ExpectedStateRevision: st.StateRevision, Action: "set_history", HistoryOpen: &yes}}
	start := make(chan struct{})
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for _, in := range inputs {
		wg.Add(1)
		go func(in Change) { defer wg.Done(); <-start; _, e := s.Change(ctx, owner, r.WorkID, in); errs <- e }(in)
	}
	close(start)
	wg.Wait()
	close(errs)
	ok, conflicts := 0, 0
	for e := range errs {
		if e == nil {
			ok++
		} else if errors.Is(e, ErrStateConflict) {
			conflicts++
		} else {
			t.Fatal(e)
		}
	}
	if ok != 1 || conflicts != 1 {
		t.Fatal("stale window overwrote new settings")
	}
	st, _ = s.AuthorState(ctx, owner, r.WorkID)
	in := Change{MutationID: uuid.New(), ExpectedStateRevision: st.StateRevision, Action: "hide"}
	first, e := s.Change(ctx, owner, r.WorkID, in)
	if e != nil {
		t.Fatal(e)
	}
	no := false
	change(t, s, owner, r.WorkID, "set_history", nil, &no)
	again, e := s.Change(ctx, owner, r.WorkID, in)
	if e != nil || again != first {
		t.Fatal("retry changed receipt", e)
	}
	current, _ := s.AuthorState(ctx, owner, r.WorkID)
	if current.HistoryOpen {
		t.Fatal("late receipt undid current history decision")
	}
	in.Action = "restore"
	if _, e = s.Change(ctx, owner, r.WorkID, in); !errors.Is(e, ErrKeyReuse) {
		t.Fatal("management key reuse", e)
	}
}
func TestTimelinePaginationAndPrivateEvents(t *testing.T) {
	s, owner, _, d, r := published(t)
	ctx := context.Background()
	for i := 1; i < 23; i++ {
		p := prepare(t, s, owner, d)
		if _, e := s.Publish(ctx, owner, Publish{MutationID: uuid.New(), PreviewID: p.ID, ExpectedVersion: uint64(i)}); e != nil {
			t.Fatal(e)
		}
	}
	for i := 0; i < 23; i++ {
		v := uint64(i%2 + 1)
		change(t, s, owner, r.WorkID, "switch_display", &v, nil)
	}
	yes := true
	change(t, s, owner, r.WorkID, "set_history", nil, &yes)
	page, e := s.Timeline(ctx, r.WorkID, 0, 0)
	if e != nil || len(page.Versions) != 20 || len(page.Events) != 20 || page.NextVersionBefore == 0 || page.NextEventBefore == 0 {
		t.Fatal("first page", e)
	}
	more, e := s.Timeline(ctx, r.WorkID, page.NextVersionBefore, page.NextEventBefore)
	if e != nil || len(more.Versions) != 3 || len(more.Events) != 3 {
		t.Fatal("next page", e)
	}
	for _, event := range page.Events {
		if event.Kind == "history_opened" {
			t.Fatal("private settings exposed")
		}
	}
	ownerPage, e := s.AuthorTimeline(ctx, owner, r.WorkID, 0, 0)
	if e != nil || ownerPage.Versions[0].Title == "" {
		t.Fatal("author history", e)
	}
	list, e := s.AuthorWorks(ctx, owner, "")
	if e != nil || len(list.Items) != 1 || list.Items[0].ID != r.WorkID {
		t.Fatal("author works", e)
	}
	change(t, s, owner, r.WorkID, "hide", nil, nil)
	if _, e = s.Timeline(ctx, r.WorkID, 0, 0); !errors.Is(e, ErrNotFound) {
		t.Fatal("hidden timeline leaked", e)
	}
}

func TestManagementEventFailureRollsBack(t *testing.T) {
	s, owner, _, _, r := published(t)
	ctx := context.Background()
	before, e := s.AuthorState(ctx, owner, r.WorkID)
	if e != nil {
		t.Fatal(e)
	}
	failing := Store{DB: failureDB(t, "INSERT INTO work_events ")}
	if _, e = failing.Change(ctx, owner, r.WorkID, Change{MutationID: uuid.New(), ExpectedStateRevision: before.StateRevision, Action: "hide"}); e == nil {
		t.Fatal("event failure ignored")
	}
	after, e := s.AuthorState(ctx, owner, r.WorkID)
	if e != nil || after != before {
		t.Fatal("failed event left changed visibility", e)
	}
	var n int
	s.DB.QueryRow("SELECT COUNT(*) FROM work_state_mutations WHERE owner_id=?", owner[:]).Scan(&n)
	if n != 0 {
		t.Fatal("failed action returned durable success")
	}
}
