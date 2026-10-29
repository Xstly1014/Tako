package draft

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"os"
	"strings"
	"testing"
	"time"
)

func draftFixture(t *testing.T) (Store, uuid.UUID, uuid.UUID) {
	t.Helper()
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("real MySQL required")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	owner, other := uuid.New(), uuid.New()
	for _, id := range []uuid.UUID{owner, other} {
		if _, err = db.Exec("INSERT INTO accounts (id,email) VALUES (?,?)", id[:], id.String()+"@example.test"); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		for _, id := range []uuid.UUID{owner, other} {
			db.Exec("DELETE FROM draft_mutations WHERE owner_id=?", id[:])
			db.Exec("UPDATE drafts SET recovered_from_id=NULL WHERE owner_id=?", id[:])
			db.Exec("DELETE FROM drafts WHERE owner_id=?", id[:])
			db.Exec("DELETE FROM accounts WHERE id=?", id[:])
		}
	})
	return Store{DB: db}, owner, other
}
func TestDraftListStableAndPrivate(t *testing.T) {
	s, owner, other := draftFixture(t)
	ctx := context.Background()
	var initial []uuid.UUID
	for i := 0; i < 5; i++ {
		out, err := s.Write(ctx, owner, "create", Write{MutationID: uuid.New(), Title: "标题", Content: "PRIVATE_BODY"})
		if err != nil {
			t.Fatal(err)
		}
		initial = append(initial, out.DraftID)
	}
	if _, err := s.Write(ctx, other, "create", Write{MutationID: uuid.New(), Content: "OTHER_PRIVATE_BODY"}); err != nil {
		t.Fatal(err)
	}
	tie := time.Now().UTC().Add(-time.Hour).Truncate(time.Microsecond)
	if _, err := s.DB.Exec("UPDATE drafts SET created_at=? WHERE owner_id=?", tie, owner[:]); err != nil {
		t.Fatal(err)
	}
	page, err := s.List(ctx, owner, 2, "")
	if err != nil || len(page.Items) != 2 || page.NextCursor == "" {
		t.Fatalf("first page: %v %v", page, err)
	}
	encoded, _ := json.Marshal(page)
	if strings.Contains(string(encoded), "PRIVATE_BODY") || strings.Contains(string(encoded), "\"content\"") {
		t.Fatal("list leaked body")
	}
	if _, err = s.List(ctx, other, 2, page.NextCursor); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cross account cursor: %v", err)
	}
	if _, err = s.List(ctx, owner, 2, "not valid base64!"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid cursor: %v", err)
	}
	if _, err = s.Write(ctx, owner, "save", Write{MutationID: uuid.New(), DraftID: initial[0], BaseRevision: 1, Content: "edited during pagination"}); err != nil {
		t.Fatal(err)
	}
	newlyCreated, err := s.Write(ctx, owner, "create", Write{MutationID: uuid.New(), Title: "new"})
	if err != nil {
		t.Fatal(err)
	}
	seen := map[uuid.UUID]bool{}
	for {
		for _, item := range page.Items {
			if seen[item.ID] {
				t.Fatal("duplicate page item")
			}
			if item.ID == newlyCreated.DraftID {
				t.Fatal("new draft inserted into continuation")
			}
			seen[item.ID] = true
		}
		if page.NextCursor == "" {
			break
		}
		page, err = s.List(ctx, owner, 2, page.NextCursor)
		if err != nil {
			t.Fatal(err)
		}
	}
	if len(seen) != 5 {
		t.Fatalf("pagination skipped drafts: %d", len(seen))
	}
}

func TestSavedTimeReplayAndHistoricalRecovery(t *testing.T) {
	s, owner, other := draftFixture(t)
	ctx := context.Background()
	input := Write{MutationID: uuid.New(), Title: "原题", Content: "第一版"}
	first, err := s.Write(ctx, owner, "create", input)
	if err != nil {
		t.Fatal(err)
	}
	if first.SavedAt.IsZero() {
		t.Fatal("missing DB confirmation time")
	}
	second, err := s.Write(ctx, owner, "save", Write{MutationID: uuid.New(), DraftID: first.DraftID, BaseRevision: 1, Title: "新题", Content: "第二版"})
	if err != nil {
		t.Fatal(err)
	}
	replay, err := s.Write(ctx, owner, "create", input)
	if err != nil || replay != first {
		t.Fatalf("ack changed after later save: %v", err)
	}
	old, err := s.ReadRevision(ctx, owner, first.DraftID, 1)
	if err != nil || old.Content != "第一版" || !old.SavedAt.Equal(first.SavedAt) {
		t.Fatalf("snapshot: %v %v", old, err)
	}
	if _, err = s.ReadRevision(ctx, other, first.DraftID, 1); !errors.Is(err, ErrNotFound) {
		t.Fatalf("history ownership: %v", err)
	}
	recovered, err := s.Write(ctx, owner, "recover", Write{MutationID: uuid.New(), DraftID: first.DraftID, BaseRevision: old.Revision, Title: old.Title, Content: old.Content})
	if err != nil {
		t.Fatal(err)
	}
	if recovered.DraftID == first.DraftID {
		t.Fatal("recovery rewound original")
	}
	current, err := s.Read(ctx, owner, first.DraftID)
	if err != nil || current.Content != "第二版" || current.Revision != second.Revision {
		t.Fatal("recovery changed current content")
	}
}

func TestRevisionRetentionProtectsCurrentAndRecovery(t *testing.T) {
	s, owner, _ := draftFixture(t)
	ctx := context.Background()
	out, err := s.Write(ctx, owner, "create", Write{MutationID: uuid.New(), Content: "v1"})
	if err != nil {
		t.Fatal(err)
	}
	for rev := uint64(1); rev < 9; rev++ {
		out, err = s.Write(ctx, owner, "save", Write{MutationID: uuid.New(), DraftID: out.DraftID, BaseRevision: rev, Content: "later"})
		if err != nil {
			t.Fatal(err)
		}
	}
	now := time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)
	times := []time.Time{now.Add(-40 * 24 * time.Hour), time.Date(2026, 10, 26, 15, 50, 0, 0, time.UTC), time.Date(2026, 10, 26, 15, 55, 0, 0, time.UTC), time.Date(2026, 10, 26, 16, 5, 0, 0, time.UTC), now.Add(-23 * time.Hour), now.Add(-22 * time.Hour), now.Add(-21 * time.Hour), now.Add(-20 * time.Hour), now.Add(-50 * 24 * time.Hour)}
	for i, saved := range times {
		if _, err = s.DB.Exec("UPDATE draft_revisions SET saved_at=? WHERE draft_id=? AND revision=?", saved, out.DraftID[:], i+1); err != nil {
			t.Fatal(err)
		}
	}
	recovered, err := s.Write(ctx, owner, "recover", Write{MutationID: uuid.New(), DraftID: out.DraftID, Content: "独立恢复副本"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.DB.Exec("UPDATE draft_revisions SET saved_at=? WHERE draft_id=?", now.Add(-60*24*time.Hour), recovered.DraftID[:]); err != nil {
		t.Fatal(err)
	}
	// May clean other expired fixture rows too, so assert ownership-specific results.
	if _, err = s.CleanupRevisions(ctx, now); err != nil {
		t.Fatal(err)
	}
	for _, rev := range []uint64{1, 2} {
		if _, err = s.ReadRevision(ctx, owner, out.DraftID, rev); !errors.Is(err, ErrNotFound) {
			t.Fatalf("revision %d retained: %v", rev, err)
		}
	}
	for _, rev := range []uint64{3, 4, 5, 6, 7, 8, 9} {
		if _, err = s.ReadRevision(ctx, owner, out.DraftID, rev); err != nil {
			t.Fatalf("revision %d lost: %v", rev, err)
		}
	}
	if d, err := s.ReadRevision(ctx, owner, recovered.DraftID, 1); err != nil || d.Content != "独立恢复副本" {
		t.Fatal("recovery draft pruned")
	}
}
