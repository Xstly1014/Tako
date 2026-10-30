package publication_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"writing.local/community/internal/draft"
	. "writing.local/community/internal/publication"
)

func setup(t *testing.T) (Store, uuid.UUID, uuid.UUID, uuid.UUID) {
	t.Helper()
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("real MySQL required")
	}
	db, e := sql.Open("mysql", dsn)
	if e != nil {
		t.Fatal(e)
	}
	owner, other := uuid.New(), uuid.New()
	for _, id := range []uuid.UUID{owner, other} {
		if _, e = db.Exec("INSERT INTO accounts (id,email,nickname) VALUES (?,?,?)", id[:], id.String()+"@example.test", "测试作者"); e != nil {
			t.Fatal(e)
		}
	}
	t.Cleanup(func() {
		db.Exec("DELETE q FROM publication_review_tasks q JOIN works w ON w.id=q.work_id WHERE w.owner_id=?", owner[:])
		db.Exec("DELETE FROM publication_mutations WHERE owner_id=?", owner[:])
		db.Exec("DELETE v FROM work_versions v JOIN works w ON w.id=v.work_id WHERE w.owner_id=?", owner[:])
		db.Exec("DELETE FROM publication_previews WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM works WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM publication_policies WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM draft_mutations WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM drafts WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM accounts WHERE id IN (?,?)", owner[:], other[:])
		db.Close()
	})
	d, e := (draft.Store{DB: db}).Write(context.Background(), owner, "create", draft.Write{MutationID: uuid.New(), Title: "第七站", Content: "有起点也有结尾的短篇。"})
	if e != nil {
		t.Fatal(e)
	}
	return Store{DB: db}, owner, other, d.DraftID
}
func prepare(t *testing.T, s Store, owner, d uuid.UUID) Preview {
	t.Helper()
	p, e := s.Prepare(context.Background(), owner, Prepare{MutationID: uuid.New(), DraftID: d, SourceRevision: 1, Introduction: "作者填写的简介", Tags: []string{"冒险", "幻想"}, RightsConfirmed: true})
	if e != nil {
		t.Fatal(e)
	}
	return p
}
func TestFixedPreviewAtomicPublication(t *testing.T) {
	s, owner, other, d := setup(t)
	ctx := context.Background()
	p := prepare(t, s, owner, d)
	if _, e := s.ReadPreview(ctx, other, p.ID); !errors.Is(e, ErrNotFound) {
		t.Fatal("cross-owner preview", e)
	}
	if _, e := s.Publish(ctx, other, Publish{MutationID: uuid.New(), PreviewID: p.ID}); !errors.Is(e, ErrNotFound) {
		t.Fatal("cross-owner publication", e)
	}
	_, e := (draft.Store{DB: s.DB}).Write(ctx, owner, "save", draft.Write{MutationID: uuid.New(), DraftID: d, BaseRevision: 1, Title: "新标题", Content: "仍在编辑、不准备公开的新稿"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.DB.Exec("DELETE FROM draft_revisions WHERE draft_id=? AND revision=1", d[:]); e != nil {
		t.Fatal(e)
	}
	pp, e := s.ReadPreview(ctx, owner, p.ID)
	if e != nil || pp.Content != p.Content {
		t.Fatal("fixed preview lost", e)
	}
	in := Publish{MutationID: uuid.New(), PreviewID: p.ID}
	out, e := s.Publish(ctx, owner, in)
	if e != nil {
		t.Fatal(e)
	}
	again, e := s.Publish(ctx, owner, in)
	if e != nil || again != out {
		t.Fatal("retry changed", e)
	}
	alias, e := s.Publish(ctx, owner, Publish{MutationID: uuid.New(), PreviewID: p.ID})
	if e != nil || alias != out {
		t.Fatal("preview double consumed", e)
	}
	current, e := (draft.Store{DB: s.DB}).Read(ctx, owner, d)
	if e != nil || current.Revision != 2 || current.Title != "新标题" {
		t.Fatal("work draft overwritten", e)
	}
	work, e := s.Read(ctx, out.WorkID, 0)
	if e != nil || work.Content != p.Content || work.Title != p.Title {
		t.Fatal("published wrong content", e)
	}
	var n int
	s.DB.QueryRow("SELECT COUNT(*) FROM publication_review_tasks WHERE work_id=?", out.WorkID[:]).Scan(&n)
	if n != 1 {
		t.Fatalf("review tasks %d", n)
	}
	changed := in
	changed.ExpectedVersion = 1
	if _, e = s.Publish(ctx, owner, changed); !errors.Is(e, ErrKeyReuse) {
		t.Fatal("key reuse", e)
	}
	// A late retry confirms the old commit but cannot undo a later hiding decision.
	s.DB.Exec("UPDATE works SET author_hidden=TRUE WHERE id=?", out.WorkID[:])
	if _, e = s.Read(ctx, out.WorkID, 0); !errors.Is(e, ErrNotFound) {
		t.Fatal("hidden read", e)
	}
	late, e := s.Publish(ctx, owner, in)
	if e != nil || late != out {
		t.Fatal("late ack", e)
	}
	if _, e = s.Read(ctx, out.WorkID, 0); !errors.Is(e, ErrNotFound) {
		t.Fatal("retry reopened hidden work", e)
	}
}
func TestConcurrentFirstPublication(t *testing.T) {
	s, owner, _, d := setup(t)
	ctx := context.Background()
	p1, p2 := prepare(t, s, owner, d), prepare(t, s, owner, d)
	start := make(chan struct{})
	out := make(chan error, 2)
	var wg sync.WaitGroup
	for _, p := range []Preview{p1, p2} {
		wg.Add(1)
		go func(p Preview) {
			defer wg.Done()
			<-start
			_, e := s.Publish(ctx, owner, Publish{MutationID: uuid.New(), PreviewID: p.ID})
			out <- e
		}(p)
	}
	close(start)
	wg.Wait()
	close(out)
	ok, conflicts := 0, 0
	for e := range out {
		if e == nil {
			ok++
		} else if errors.Is(e, ErrConflict) {
			conflicts++
		} else {
			t.Fatal(e)
		}
	}
	if ok != 1 || conflicts != 1 {
		t.Fatalf("success=%d conflict=%d", ok, conflicts)
	}
	var n int
	s.DB.QueryRow("SELECT COUNT(*) FROM works WHERE source_draft_id=?", d[:]).Scan(&n)
	if n != 1 {
		t.Fatal("duplicate work")
	}
}
func TestPreviewExpiryCleanupAndPolicy(t *testing.T) {
	s, owner, _, d := setup(t)
	ctx := context.Background()
	in := Prepare{MutationID: uuid.New(), DraftID: d, SourceRevision: 1, Tags: []string{"日常"}, RightsConfirmed: true}
	p, e := s.Prepare(ctx, owner, in)
	if e != nil {
		t.Fatal(e)
	}
	p2, e := s.Prepare(ctx, owner, in)
	if e != nil || p2.ID != p.ID {
		t.Fatal("prepare retry", e)
	}
	in.Introduction = "变更"
	if _, e = s.Prepare(ctx, owner, in); !errors.Is(e, ErrKeyReuse) {
		t.Fatal("prepare mutation reuse", e)
	}
	if _, e = s.DB.Exec("INSERT INTO publication_policies (owner_id,observation_until) VALUES (?,?)", owner[:], time.Now().UTC().Add(time.Hour)); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Publish(ctx, owner, Publish{MutationID: uuid.New(), PreviewID: p.ID}); !errors.Is(e, ErrUnsupported) {
		t.Fatal("observation bypass", e)
	}
	s.DB.Exec("UPDATE publication_previews SET expires_at=? WHERE id=?", time.Now().UTC().Add(-time.Second), p.ID[:])
	if _, e = s.Publish(ctx, owner, Publish{MutationID: uuid.New(), PreviewID: p.ID}); !errors.Is(e, ErrExpired) {
		t.Fatal("expired publish", e)
	}
	if _, e = s.CleanupPreviews(ctx, time.Now()); e != nil {
		t.Fatal(e)
	}
	var content sql.NullString
	s.DB.QueryRow("SELECT content FROM publication_previews WHERE id=?", p.ID[:]).Scan(&content)
	if content.Valid {
		t.Fatal("expired body retained")
	}
	if _, e = s.ReadPreview(ctx, owner, p.ID); !errors.Is(e, ErrExpired) {
		t.Fatal("expired read", e)
	}
	if _, e := (draft.Store{DB: s.DB}).Read(ctx, owner, d); e != nil {
		t.Fatal("draft deleted", e)
	}
}
func TestReviewFailureRollsBackWholePublication(t *testing.T) {
	s, owner, _, d := setup(t)
	ctx := context.Background()
	p := prepare(t, s, owner, d)
	failing := reviewFailureDB(t)
	s.DB = failing
	if _, e := s.Publish(ctx, owner, Publish{MutationID: uuid.New(), PreviewID: p.ID}); e == nil {
		t.Fatal("injected failure ignored")
	}
	var n int
	s.DB.QueryRow("SELECT COUNT(*) FROM works WHERE owner_id=?", owner[:]).Scan(&n)
	if n != 0 {
		t.Fatal("half-published work survived")
	}
	var consumed sql.NullTime
	s.DB.QueryRow("SELECT consumed_at FROM publication_previews WHERE id=?", p.ID[:]).Scan(&consumed)
	if consumed.Valid {
		t.Fatal("failed transaction consumed preview")
	}
}
func TestReadingUsesAllVisibilityDimensions(t *testing.T) {
	s, owner, _, d := setup(t)
	ctx := context.Background()
	p := prepare(t, s, owner, d)
	r, e := s.Publish(ctx, owner, Publish{MutationID: uuid.New(), PreviewID: p.ID})
	if e != nil {
		t.Fatal(e)
	}
	second := prepare(t, s, owner, d)
	r2, e := s.Publish(ctx, owner, Publish{MutationID: uuid.New(), PreviewID: second.ID, ExpectedVersion: 1})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Read(ctx, r.WorkID, 1); !errors.Is(e, ErrNotFound) {
		t.Fatal("history leaked", e)
	}
	s.DB.Exec("UPDATE works SET history_open=TRUE WHERE id=?", r.WorkID[:])
	if _, e = s.Read(ctx, r.WorkID, 1); e != nil {
		t.Fatal(e)
	}
	s.DB.Exec("UPDATE work_versions SET platform_limited=TRUE WHERE work_id=? AND version=?", r.WorkID[:], r2.Version)
	if _, e = s.Read(ctx, r.WorkID, 0); !errors.Is(e, ErrNotFound) {
		t.Fatal("limited current version read", e)
	}
	if _, e = s.Read(ctx, r.WorkID, 1); e != nil {
		t.Fatal("healthy history blocked", e)
	}
	s.DB.Exec("UPDATE works SET platform_limited=TRUE WHERE id=?", r.WorkID[:])
	if _, e = s.Read(ctx, r.WorkID, 1); !errors.Is(e, ErrNotFound) {
		t.Fatal("work limit bypass", e)
	}
}

func TestConcurrentRetryAndExpiryAfterCommit(t *testing.T) {
	s, owner, _, d := setup(t)
	ctx := context.Background()
	p := prepare(t, s, owner, d)
	in := Publish{MutationID: uuid.New(), PreviewID: p.ID}
	start := make(chan struct{})
	results := make(chan Result, 6)
	errs := make(chan error, 6)
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); <-start; r, e := s.Publish(ctx, owner, in); results <- r; errs <- e }()
	}
	close(start)
	wg.Wait()
	close(results)
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	var first Result
	for r := range results {
		if first.WorkID == uuid.Nil {
			first = r
		}
		if first != r {
			t.Fatal("concurrent retries returned different commits")
		}
	}
	if _, e := s.DB.Exec("UPDATE publication_previews SET expires_at=? WHERE id=?", time.Now().UTC().Add(-time.Hour), p.ID[:]); e != nil {
		t.Fatal(e)
	}
	if _, e := s.CleanupPreviews(ctx, time.Now().UTC()); e != nil {
		t.Fatal(e)
	}
	if r, e := s.Publish(ctx, owner, in); e != nil || r != first {
		t.Fatal("committed retry lost after expiry", e)
	}
	var body sql.NullString
	s.DB.QueryRow("SELECT content FROM publication_previews WHERE id=?", p.ID[:]).Scan(&body)
	if !body.Valid {
		t.Fatal("submitted preview incorrectly cleaned")
	}
	var n int
	s.DB.QueryRow("SELECT COUNT(*) FROM work_versions WHERE work_id=?", first.WorkID[:]).Scan(&n)
	if n != 1 {
		t.Fatal("concurrent retry duplicated version")
	}
}
