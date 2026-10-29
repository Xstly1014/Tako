// Operator-only recovery after a recorded owner request. No content is printed.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"flag"
	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"os"
	"time"
	"writing.local/community/internal/draft"
)

func main() {
	if !run() {
		os.Stderr.WriteString("draft_recovery_failed: check ownership, retained revision, authorization reference and audit storage\n")
		os.Exit(1)
	}
}
func run() bool {
	ownerFlag := flag.String("owner", "", "owner UUID verified against the actual user request")
	draftFlag := flag.String("draft", "", "source draft UUID")
	revision := flag.Uint64("revision", 0, "retained revision to recover")
	mutationFlag := flag.String("mutation", "", "stable recovery UUID, reused on retry")
	authorizationFlag := flag.String("authorization-ref", "", "UUID referencing a separately recorded owner request")
	apply := flag.Bool("apply", false, "create a new draft, never replace the source")
	flag.Parse()
	ids := []uuid.UUID{}
	for _, raw := range []string{*ownerFlag, *draftFlag, *mutationFlag, *authorizationFlag} {
		id, err := uuid.Parse(raw)
		if err != nil || id == uuid.Nil {
			return false
		}
		ids = append(ids, id)
	}
	if *revision == 0 {
		return false
	}
	db, err := sql.Open("mysql", os.Getenv("MYSQL_DSN"))
	if err != nil {
		return false
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	store := draft.Store{DB: db}
	snapshot, err := store.ReadRevision(ctx, ids[0], ids[1], *revision)
	if err != nil {
		return false
	}
	if !*apply {
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"status": "available", "revision": snapshot.Revision, "saved_at": snapshot.SavedAt, "source_unchanged": true}) == nil
	}
	auditPath := os.Getenv("RECOVERY_AUDIT_FILE")
	if auditPath == "" {
		return false
	}
	audit, err := os.OpenFile(auditPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return false
	}
	defer audit.Close()
	entry := map[string]any{"event": "recovery_requested", "owner_id": ids[0], "source_draft_id": ids[1], "source_revision": *revision, "mutation_id": ids[2], "authorization_ref": ids[3], "at": time.Now().UTC()}
	if json.NewEncoder(audit).Encode(entry) != nil || audit.Sync() != nil {
		return false
	}
	result, err := store.Write(ctx, ids[0], "recover", draft.Write{MutationID: ids[2], DraftID: ids[1], BaseRevision: *revision, Title: snapshot.Title, Content: snapshot.Content})
	if err != nil {
		return false
	}
	entry["event"] = "recovery_completed"
	entry["new_draft_id"] = result.DraftID
	if json.NewEncoder(audit).Encode(entry) != nil || audit.Sync() != nil {
		return false
	}
	return json.NewEncoder(os.Stdout).Encode(result) == nil
}
