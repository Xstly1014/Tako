package identity

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

type captureSender struct{ Code string }

func (s *captureSender) Send(_ context.Context, _ string, code string) error {
	s.Code = code
	return nil
}

func TestLoginConsumptionAndSession(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("real MySQL required")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	lockMailTests(t, db)
	sender := &captureSender{}
	service := Service{DB: db, Pepper: []byte("integration-test-pepper-not-for-production"), Sender: sender, QueueKey: []byte("0123456789abcdef0123456789abcdef")}
	ctx := context.Background()
	email := uuid.NewString() + "@example.test"
	ip := uuid.NewString()
	t.Cleanup(func() {
		var id []byte
		if db.QueryRow("SELECT id FROM accounts WHERE email=?", email).Scan(&id) == nil {
			db.Exec("DELETE FROM sessions WHERE account_id=?", id)
			db.Exec("DELETE FROM accounts WHERE id=?", id)
		}
		db.Exec("DELETE FROM login_challenges WHERE email=?", email)
		db.Exec("DELETE FROM login_mail_outbox WHERE email=?", email)
	})
	deliveryID := uuid.New()
	if _, err = service.Enqueue(ctx, email, ip, deliveryID); err != nil {
		t.Fatal(err)
	}
	if _, err = service.ProcessOne(ctx, nil, deliveryID); err != nil {
		t.Fatal(err)
	}
	if len(sender.Code) != 6 {
		t.Fatal("sender did not receive code")
	}
	if _, err = service.Enqueue(ctx, email, ip, uuid.New()); !errors.Is(err, ErrLimited) {
		t.Fatalf("resend not limited: %v", err)
	}
	wrong := "000000"
	if wrong == sender.Code {
		wrong = "000001"
	}
	if _, _, err = service.Verify(ctx, email, wrong, ip); !errors.Is(err, ErrInvalid) {
		t.Fatalf("wrong code: %v", err)
	}
	start := make(chan struct{})
	var wg sync.WaitGroup
	type outcome struct {
		account Account
		token   string
		err     error
	}
	results := make(chan outcome, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			a, token, e := service.Verify(ctx, email, sender.Code, ip)
			results <- outcome{a, token, e}
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	var successes, denied int
	var token string
	var expected Account
	for out := range results {
		if out.err == nil {
			successes++
			token = out.token
			expected = out.account
		} else if errors.Is(out.err, ErrInvalid) {
			denied++
		} else {
			t.Fatal(out.err)
		}
	}
	if successes != 1 || denied != 1 {
		t.Fatalf("code reused: successes %d denied %d", successes, denied)
	}
	account, err := service.Authenticate(ctx, token)
	if err != nil || account.ID != expected.ID {
		t.Fatalf("session: %v", err)
	}
	if err = service.Logout(ctx, token); err != nil {
		t.Fatal(err)
	}
	if _, err = service.Authenticate(ctx, token); !errors.Is(err, ErrInvalid) {
		t.Fatalf("logout did not revoke: %v", err)
	}
}

// Mail integration suites share a development DB across Go package processes.
// Serialize their fixtures, while the individual tests still exercise workers concurrently.
func lockMailTests(t *testing.T, db *sql.DB) {
	t.Helper()
	conn, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var locked int
	if err = conn.QueryRowContext(context.Background(), "SELECT GET_LOCK('tako_mail_integration',30)").Scan(&locked); err != nil || locked != 1 {
		conn.Close()
		t.Fatalf("mail fixture lock: %v", err)
	}
	t.Cleanup(func() {
		conn.ExecContext(context.Background(), "DO RELEASE_LOCK('tako_mail_integration')")
		conn.Close()
	})
}

func TestNormalizeEmail(t *testing.T) {
	got, err := NormalizeEmail(" Writer+one@EXAMPLE.COM ")
	if err != nil || got != "Writer+one@example.com" {
		t.Fatalf("normalization: %q %v", got, err)
	}
	for _, in := range []string{"name <a@example.com>", "a@example.com\r\nBcc: victim@example.com", "bad"} {
		if _, err := NormalizeEmail(in); err == nil {
			t.Errorf("accepted %q", in)
		}
	}
}
