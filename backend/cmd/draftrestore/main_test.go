package main

import (
	"context"
	"database/sql"
	"flag"
	"github.com/google/uuid"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"writing.local/community/internal/draft"
)

func TestAuthorizedRecoveryPreservesCurrentAndIsIdempotent(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("real MySQL required")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	owner := uuid.New()
	if _, err = db.Exec("INSERT INTO accounts(id,email) VALUES (?,?)", owner[:], owner.String()+"@example.test"); err != nil {
		t.Fatal(err)
	}
	defer func() {
		db.Exec("DELETE FROM draft_mutations WHERE owner_id=?", owner[:])
		db.Exec("UPDATE drafts SET recovered_from_id=NULL WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM drafts WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM accounts WHERE id=?", owner[:])
	}()
	store := draft.Store{DB: db}
	ctx := context.Background()
	first, err := store.Write(ctx, owner, "create", draft.Write{MutationID: uuid.New(), Title: "fixture", Content: "PRIVATE_OLD_FIXTURE"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.Write(ctx, owner, "save", draft.Write{MutationID: uuid.New(), DraftID: first.DraftID, BaseRevision: 1, Title: "fixture", Content: "PRIVATE_CURRENT_FIXTURE"})
	if err != nil {
		t.Fatal(err)
	}
	audit := filepath.Join(t.TempDir(), "audit.jsonl")
	t.Setenv("MYSQL_DSN", dsn)
	t.Setenv("RECOVERY_AUDIT_FILE", audit)
	mutation := uuid.NewString()
	invoke := func(target uuid.UUID, apply bool) bool {
		oldArgs, oldFlags := os.Args, flag.CommandLine
		defer func() { os.Args = oldArgs; flag.CommandLine = oldFlags }()
		flag.CommandLine = flag.NewFlagSet("recovery-test", flag.ContinueOnError)
		os.Args = []string{"draftrestore", "-owner", target.String(), "-draft", first.DraftID.String(), "-revision", "1", "-mutation", mutation, "-authorization-ref", uuid.NewString()}
		if apply {
			os.Args = append(os.Args, "-apply")
		}
		return run()
	}
	if invoke(uuid.New(), true) {
		t.Fatal("wrong owner accepted")
	}
	if !invoke(owner, false) {
		t.Fatal("dry run failed")
	}
	var count int
	db.QueryRow("SELECT COUNT(*) FROM drafts WHERE owner_id=?", owner[:]).Scan(&count)
	if count != 1 {
		t.Fatal("dry run wrote a draft")
	}
	if !invoke(owner, true) || !invoke(owner, true) {
		t.Fatal("recovery retry failed")
	}
	db.QueryRow("SELECT COUNT(*) FROM drafts WHERE owner_id=?", owner[:]).Scan(&count)
	if count != 2 {
		t.Fatal("retry duplicated recovery")
	}
	current, err := store.Read(ctx, owner, first.DraftID)
	if err != nil || current.Content != "PRIVATE_CURRENT_FIXTURE" || current.Revision != 2 {
		t.Fatal("current draft changed")
	}
	data, err := os.ReadFile(audit)
	if err != nil || strings.Contains(string(data), "PRIVATE_") {
		t.Fatal("audit missing or exposed content")
	}
}
