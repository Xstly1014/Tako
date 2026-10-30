package identity

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestConcurrentRegistrationCannotOverwriteAndOTPDoesNotTakeOver(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("real MySQL required")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := Service{DB: db, Pepper: []byte(uuid.NewString())}
	email := uuid.NewString() + "@example.test"
	defer func() {
		var raw []byte
		if db.QueryRow("SELECT id FROM accounts WHERE email=?", email).Scan(&raw) == nil {
			db.Exec("DELETE FROM sessions WHERE account_id=?", raw)
			db.Exec("DELETE FROM accounts WHERE id=?", raw)
		}
		db.Exec("DELETE FROM login_challenges WHERE email=?", email)
	}()
	ctx := context.Background()
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, _, e := s.RegisterPassword(ctx, email, "concurrent-test-password", uuid.NewString())
			results <- e
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	ok, duplicate := 0, 0
	for e := range results {
		if e == nil {
			ok++
		} else if errors.Is(e, ErrAccountExists) {
			duplicate++
		} else {
			t.Fatalf("registration failed: %v", e)
		}
	}
	if ok != 1 || duplicate != 1 {
		t.Fatal("registration did not choose exactly one owner")
	}
	account, token, err := s.LoginPassword(ctx, email, "concurrent-test-password", uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	restored, err := s.Authenticate(ctx, token)
	if err != nil || restored.ID != account.ID {
		t.Fatal("session identity mismatch")
	}
	challenge := uuid.New()
	code := "123456"
	hash := s.digest("code:" + email + ":" + challenge.String() + ":" + code)
	_, err = db.Exec("INSERT INTO login_challenges (email,challenge_id,code_hash,expires_at,attempts,consumed,sent_at) VALUES (?,?,?,?,0,FALSE,?)", email, challenge[:], hash, time.Now().UTC().Add(time.Minute), time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.Verify(ctx, email, code, uuid.NewString()); !errors.Is(err, ErrInvalid) {
		t.Fatal("OTP took over password identity")
	}
	var stored []byte
	if err = db.QueryRow("SELECT password_hash FROM account_passwords WHERE account_id=?", account.ID[:]).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if string(stored) == "concurrent-test-password" {
		t.Fatal("plaintext password stored")
	}
	if !validPassword("中文密码测试八个字") || validPassword("密码短") || validPassword("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
		t.Fatal("password boundary mismatch")
	}
}
