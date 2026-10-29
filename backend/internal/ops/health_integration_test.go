package ops

import (
	"context"
	"database/sql"
	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"os"
	"testing"
	"time"
)

func TestHeartbeatFailureDoesNotEraseLastSuccess(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("real MySQL required")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	role := "test_" + uuid.NewString()[:12]
	defer db.Exec("DELETE FROM runtime_health WHERE role=?", role)
	ctx := context.Background()
	if err = Beat(ctx, db, role, true, 0); err != nil {
		t.Fatal(err)
	}
	var first time.Time
	if err = db.QueryRow("SELECT last_success FROM runtime_health WHERE role=?", role).Scan(&first); err != nil {
		t.Fatal(err)
	}
	if err = Beat(ctx, db, role, false, 2); err != nil {
		t.Fatal(err)
	}
	var last time.Time
	var failures uint64
	if err = db.QueryRow("SELECT last_success,failure_count FROM runtime_health WHERE role=?", role).Scan(&last, &failures); err != nil {
		t.Fatal(err)
	}
	if !first.Equal(last) || failures != 2 {
		t.Fatal("failure overwrote success or count")
	}
	issues, err := Check(ctx, db, time.Now().UTC(), 0)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, issue := range issues {
		if issue == "database_capacity_warning" {
			found = true
		}
	}
	if !found {
		t.Fatal("capacity breach was not detected")
	}
}
