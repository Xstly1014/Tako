package draft

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"sync"
	"testing"

	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
)

func TestMySQLSaveInvariants(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN required for real MySQL test")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	ctx := context.Background()
	owner, other := uuid.New(), uuid.New()
	for _, id := range []uuid.UUID{owner, other} {
		_, err = db.ExecContext(ctx, "INSERT INTO accounts (id,email) VALUES (?,?)", id[:], id.String()+"@example.test")
		if err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		db.Exec("DELETE FROM draft_mutations WHERE owner_id=?", owner[:])
		db.Exec("UPDATE drafts SET recovered_from_id=NULL WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM drafts WHERE owner_id=?", owner[:])
		db.Exec("DELETE FROM accounts WHERE id IN (?,?)", owner[:], other[:])
	})
	s := Store{db}
	create := Write{MutationID: uuid.New(), Title: "标题", Content: "原始文字"}
	first, err := s.Write(ctx, owner, "create", create)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := s.Write(ctx, owner, "create", create)
	if err != nil || retry != first {
		t.Fatalf("retry: %v %v", retry, err)
	}
	create.Content = "changed"
	if _, err = s.Write(ctx, owner, "create", create); !errors.Is(err, ErrKeyReuse) {
		t.Fatalf("key reuse: %v", err)
	}
	if _, err = s.Read(ctx, other, first.DraftID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ownership: %v", err)
	}
	start := make(chan struct{})
	outcomes := make(chan error, 2)
	var wg sync.WaitGroup
	for _, text := range []string{"电脑内容", "手机内容"} {
		wg.Add(1)
		go func(text string) {
			defer wg.Done()
			<-start
			_, err := s.Write(ctx, owner, "save", Write{MutationID: uuid.New(), DraftID: first.DraftID, BaseRevision: 1, Content: text})
			outcomes <- err
		}(text)
	}
	close(start)
	wg.Wait()
	close(outcomes)
	var saved, conflicts int
	for err := range outcomes {
		if err == nil {
			saved++
		} else if errors.Is(err, ErrConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if saved != 1 || conflicts != 1 {
		t.Fatalf("saved=%d conflict=%d", saved, conflicts)
	}
	current, err := s.Read(ctx, owner, first.DraftID)
	if err != nil || current.Revision != 2 {
		t.Fatalf("read: %v %v", current, err)
	}
	recovery := Write{MutationID: uuid.New(), DraftID: first.DraftID, BaseRevision: 1, Content: "未同步内容"}
	a, err := s.Write(ctx, owner, "recover", recovery)
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.Write(ctx, owner, "recover", recovery)
	if err != nil || a != b {
		t.Fatalf("duplicate recovery: %v", err)
	}
	if _, err = s.Write(ctx, other, "recover", Write{MutationID: uuid.New(), DraftID: first.DraftID, Content: "偷取"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("recover ownership: %v", err)
	}
}
