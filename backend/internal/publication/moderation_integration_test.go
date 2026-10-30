package publication_test

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"sync"
	"testing"
	"time"
	. "writing.local/community/internal/publication"
)

func moderationFixture(t *testing.T) (Store, uuid.UUID, uuid.UUID, uuid.UUID, Result) {
	s, o, op, d, r := published(t)
	t.Cleanup(func() {
		s.DB.Exec("DELETE FROM moderation_mutations WHERE owner_id=?", o[:])
		s.DB.Exec("DELETE a FROM moderation_appeals a JOIN moderation_cases c ON c.id=a.case_id WHERE c.owner_id=?", o[:])
		s.DB.Exec("DELETE FROM moderation_cases WHERE owner_id=?", o[:])
	})
	return s, o, op, d, r
}
func action(decision string, rev uint64) ModerationAction {
	return ModerationAction{MutationID: uuid.New(), ExpectedRevision: rev, Decision: decision, Reason: "人工查看固定版本后的明确说明。"}
}
func TestModerationRestrictionAppealCooldownAndRevoke(t *testing.T) {
	s, owner, op, d, r := moderationFixture(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Microsecond)
	s.ModerationClock = func() time.Time { return now }
	in := action("restrict_version", 1)
	out, e := s.Review(ctx, op, r.WorkID, 1, in)
	if e != nil || out.State != "restricted" {
		t.Fatal(out, e)
	}
	again, e := s.Review(ctx, op, r.WorkID, 1, in)
	if e != nil || again != out {
		t.Fatal("receipt replay", e)
	}
	if _, e = s.Read(ctx, r.WorkID, 0); !errors.Is(e, ErrNotFound) {
		t.Fatal("reader must be blocked", e)
	}
	if _, e = s.AuthorVersion(ctx, owner, r.WorkID, 1); e != nil {
		t.Fatal(e)
	}
	cases, e := s.Cases(ctx, owner, 0)
	if e != nil || len(cases.Items) != 1 {
		t.Fatal(cases, e)
	}
	c := cases.Items[0]
	if _, e = s.ModerationCase(ctx, &op, c.ID, 0); !errors.Is(e, ErrNotFound) {
		t.Fatal("ownership", e)
	}
	req := action("appeal", 1)
	appeal, e := s.Appeal(ctx, owner, c.ID, req)
	if e != nil {
		t.Fatal(e)
	}
	if replay, e := s.Appeal(ctx, owner, c.ID, req); e != nil || replay != appeal {
		t.Fatal("appeal replay", e)
	}
	if _, e = s.Appeal(ctx, owner, c.ID, action("appeal", 1)); !errors.Is(e, ErrAppealPending) {
		t.Fatal("one pending", e)
	}
	up := action("uphold", 1)
	up.AppealID = appeal.ID
	if _, e = s.DecideCase(ctx, op, c.ID, up); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Appeal(ctx, owner, c.ID, req); e != nil {
		t.Fatal("old successful receipt survives cooldown", e)
	}
	now = now.Add(24*time.Hour - time.Microsecond)
	if _, e = s.Appeal(ctx, owner, c.ID, action("appeal", 2)); !errors.Is(e, ErrAppealCooldown) {
		t.Fatal("early appeal", e)
	}
	now = now.Add(time.Microsecond)
	if _, e = s.Appeal(ctx, owner, c.ID, action("appeal", 2)); e != nil {
		t.Fatal("exact expiry", e)
	}
	// A newer normal formal version must not be overwritten by revoking V1.
	preview := prepare(t, s, owner, d)
	if _, e = s.Publish(ctx, owner, Publish{MutationID: uuid.New(), PreviewID: preview.ID, ExpectedVersion: 1}); e != nil {
		t.Fatal(e)
	}
	change(t, s, owner, r.WorkID, "hide", nil, nil)
	revoke := action("revoke", 2)
	if _, e = s.DecideCase(ctx, op, c.ID, revoke); e != nil {
		t.Fatal(e)
	}
	st, e := s.AuthorState(ctx, owner, r.WorkID)
	if e != nil || !st.AuthorHidden || st.DisplayVersion != 2 {
		t.Fatal("revoke changed unrelated state", st, e)
	}
	if _, e = s.Read(ctx, r.WorkID, 0); !errors.Is(e, ErrNotFound) {
		t.Fatal("must stay hidden")
	}
	detail, e := s.ModerationCase(ctx, &owner, c.ID, 0)
	if e != nil || detail.Case.State != "revoked" || detail.Revocation == nil || detail.Revocation.Reason != revoke.Reason || len(detail.Appeals.Items) != 2 || detail.Appeals.Items[0].State != "revoked" {
		t.Fatal(detail, e)
	}
}
func TestConcurrentModerationAndRollback(t *testing.T) {
	s, o, op, _, r := moderationFixture(t)
	ctx := context.Background()
	bad := s
	bad.DB = failureDB(t, "INSERT INTO moderation_mutations")
	if _, e := bad.Review(ctx, op, r.WorkID, 1, action("restrict_version", 1)); e == nil {
		t.Fatal("missing injected failure")
	}
	if _, e := s.Read(ctx, r.WorkID, 0); e != nil {
		t.Fatal("failed transaction leaked restriction", e)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, e := s.Review(ctx, op, r.WorkID, 1, action("restrict_version", 1))
			errs <- e
		}()
	}
	wg.Wait()
	close(errs)
	ok, conflicts := 0, 0
	for e := range errs {
		if e == nil {
			ok++
		} else if errors.Is(e, ErrReviewConflict) {
			conflicts++
		} else {
			t.Fatal(e)
		}
	}
	if ok != 1 || conflicts != 1 {
		t.Fatal(ok, conflicts)
	}
	cases, _ := s.Cases(ctx, o, 0)
	c := cases.Items[0]
	errs = make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, e := s.Appeal(ctx, o, c.ID, action("appeal", 1)); errs <- e }()
	}
	wg.Wait()
	close(errs)
	ok = 0
	for e := range errs {
		if e == nil {
			ok++
		} else if !errors.Is(e, ErrAppealPending) {
			t.Fatal(e)
		}
	}
	if ok != 1 {
		t.Fatal("concurrent appeals", ok)
	}
}
func TestRevokingWorkRestrictionPreservesOtherActiveCase(t *testing.T) {
	s, o, op, d, r := moderationFixture(t)
	ctx := context.Background()
	if _, e := s.Review(ctx, op, r.WorkID, 1, action("restrict_work", 1)); e != nil {
		t.Fatal(e)
	}
	p := prepare(t, s, o, d)
	if _, e := s.Publish(ctx, o, Publish{MutationID: uuid.New(), PreviewID: p.ID, ExpectedVersion: 1}); e != nil {
		t.Fatal(e)
	}
	if _, e := s.Review(ctx, op, r.WorkID, 2, action("restrict_work", 1)); e != nil {
		t.Fatal(e)
	}
	cases, _ := s.Cases(ctx, o, 0)
	if len(cases.Items) != 2 {
		t.Fatal(cases)
	}
	if _, e := s.DecideCase(ctx, op, cases.Items[0].ID, action("revoke", 1)); e != nil {
		t.Fatal(e)
	}
	st, _ := s.AuthorState(ctx, o, r.WorkID)
	if !st.PlatformLimited {
		t.Fatal("another active work restriction was removed")
	}
	if _, e := s.DecideCase(ctx, op, cases.Items[1].ID, action("revoke", 1)); e != nil {
		t.Fatal(e)
	}
	st, _ = s.AuthorState(ctx, o, r.WorkID)
	if st.PlatformLimited {
		t.Fatal("last restriction not removed")
	}
}
