package identity

import (
	"context"
	"database/sql"
	"errors"
	"github.com/google/uuid"
	"os"
	"sync"
	"testing"
	"time"
)

type recordingMail struct {
	mu    sync.Mutex
	codes []string
	fail  bool
}

func (s *recordingMail) Send(_ context.Context, _ string, code string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.codes = append(s.codes, code)
	if s.fail {
		return errors.New("simulated SMTP timeout")
	}
	return nil
}

func mailFixture(t *testing.T) (*Service, *recordingMail, string, string) {
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
	lockMailTests(t, db)
	sender := &recordingMail{}
	s := &Service{DB: db, Pepper: []byte("outbox-test-pepper-not-for-production"), QueueKey: []byte("0123456789abcdef0123456789abcdef"), Sender: sender}
	email := uuid.NewString() + "@example.test"
	ip := uuid.NewString()
	t.Cleanup(func() {
		db.Exec("DELETE FROM login_mail_outbox WHERE email=?", email)
		db.Exec("DELETE FROM login_challenges WHERE email=?", email)
		for _, key := range []string{"global:send", "ip:send:" + ip, "email:send:" + email, "ip:verify:" + ip} {
			db.Exec("DELETE FROM auth_rate_limits WHERE bucket_hash=?", s.digest("rate:"+key))
		}
	})
	return s, sender, email, ip
}
func mustExec(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}

func TestEnqueueAtomicAndIdempotent(t *testing.T) {
	s, _, email, ip := mailFixture(t)
	ctx := context.Background()
	id := uuid.New()
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := s.Enqueue(ctx, email, ip, id); results <- err }()
	}
	wg.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err := s.DB.QueryRow("SELECT COUNT(*) FROM login_mail_outbox WHERE email=?", email).Scan(&count); err != nil || count != 1 {
		t.Fatalf("jobs=%d err=%v", count, err)
	}
	var hits uint64
	if err := s.DB.QueryRow("SELECT hits FROM auth_rate_limits WHERE bucket_hash=?", s.digest("rate:email:send:"+email)).Scan(&hits); err != nil || hits != 1 {
		t.Fatalf("duplicate consumed rate: %d %v", hits, err)
	}
	original, err := s.Enqueue(ctx, email, ip, id)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Enqueue(ctx, "other@example.test", ip, id); !errors.Is(err, ErrDeliveryReuse) {
		t.Fatalf("different payload: %v", err)
	}
	if _, err = s.Enqueue(ctx, email, ip, uuid.New()); !errors.Is(err, ErrLimited) {
		t.Fatalf("cooldown: %v", err)
	}
	repeated, err := s.Enqueue(ctx, email, ip, id)
	if err != nil || !repeated.ExpiresAt.Equal(original.ExpiresAt) {
		t.Fatalf("expiry changed: %v", err)
	}
	var encrypted []byte
	if err = s.DB.QueryRow("SELECT encrypted_code FROM login_mail_outbox WHERE delivery_id=?", id[:]).Scan(&encrypted); err != nil {
		t.Fatal(err)
	}
	plain, err := s.open(id, email, encrypted)
	if err != nil || len(plain) != 6 {
		t.Fatal("encrypted payload could not be recovered")
	}
	if string(encrypted) == plain {
		t.Fatal("plaintext queued")
	}
	if _, err = s.open(uuid.New(), email, encrypted); err == nil {
		t.Fatal("payload not bound to task")
	}
	// A failed enqueue must not partially replace the active challenge or insert a job.
	var current []byte
	if err = s.DB.QueryRow("SELECT challenge_id FROM login_challenges WHERE email=?", email).Scan(&current); err != nil || string(current) != string(id[:]) {
		t.Fatal("rate-limited request changed challenge")
	}
}

func TestWorkerRetryKeepsCodeAcrossRestart(t *testing.T) {
	s, sender, email, ip := mailFixture(t)
	ctx := context.Background()
	id := uuid.New()
	if _, err := s.Enqueue(ctx, email, ip, id); err != nil {
		t.Fatal(err)
	}
	sender.fail = true
	if _, err := s.ProcessOne(ctx, nil, id); err != nil {
		t.Fatal(err)
	}
	pending, err := s.Enqueue(ctx, email, ip, id)
	if err != nil || pending.Status != "queued" {
		t.Fatalf("retry state: %v %v", pending, err)
	}
	mustExec(t, s.DB, "UPDATE login_mail_outbox SET next_attempt_at=? WHERE delivery_id=?", time.Now().UTC().Add(-time.Second), id[:])
	sender.fail = false
	restarted := &Service{DB: s.DB, Pepper: s.Pepper, QueueKey: s.QueueKey, Sender: sender}
	if _, err = restarted.ProcessOne(ctx, nil, id); err != nil {
		t.Fatal(err)
	}
	if len(sender.codes) != 2 || sender.codes[0] != sender.codes[1] {
		t.Fatal("retry generated different code")
	}
	result, err := s.Enqueue(ctx, email, ip, id)
	if err != nil || result.Status != "sent" {
		t.Fatalf("sent state: %v %v", result, err)
	}
	var ciphertext []byte
	if err = s.DB.QueryRow("SELECT encrypted_code FROM login_mail_outbox WHERE delivery_id=?", id[:]).Scan(&ciphertext); err != nil || len(ciphertext) != 0 {
		t.Fatal("terminal payload retained")
	}
}

func TestWorkerLeaseRecoveryAndDuplicateAcceptance(t *testing.T) {
	s, sender, email, ip := mailFixture(t)
	ctx := context.Background()
	id := uuid.New()
	if _, err := s.Enqueue(ctx, email, ip, id); err != nil {
		t.Fatal(err)
	}
	job, err := s.claim(ctx, id)
	if err != nil || job == nil {
		t.Fatalf("claim: %v", err)
	}
	code, err := s.open(job.id, job.email, job.encrypted)
	if err != nil {
		t.Fatal(err)
	}
	// Simulate SMTP acceptance followed by process loss BEFORE acknowledging DB.
	sender.Send(ctx, email, code)
	if worked, err := s.ProcessOne(ctx, nil, id); err != nil || worked {
		t.Fatalf("active lease stolen: %v", err)
	}
	mustExec(t, s.DB, "UPDATE login_mail_outbox SET lease_until=? WHERE delivery_id=?", time.Now().UTC().Add(-time.Second), id[:])
	restarted := &Service{DB: s.DB, Pepper: s.Pepper, QueueKey: s.QueueKey, Sender: sender}
	if _, err = restarted.ProcessOne(ctx, nil, id); err != nil {
		t.Fatal(err)
	}
	if len(sender.codes) != 2 || sender.codes[0] != sender.codes[1] {
		t.Fatal("crash recovery did not reuse code")
	}
}

func TestTwoWorkersDoNotShareActiveLease(t *testing.T) {
	s, sender, email, ip := mailFixture(t)
	ctx := context.Background()
	id := uuid.New()
	if _, err := s.Enqueue(ctx, email, ip, id); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := s.ProcessOne(ctx, nil, id); results <- err }()
	}
	wg.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatal(err)
		}
	}
	if len(sender.codes) != 1 {
		t.Fatalf("send count=%d", len(sender.codes))
	}
}

func TestExpiredOrSupersededTaskIsNotSent(t *testing.T) {
	for _, mode := range []string{"expired", "superseded", "consumed"} {
		t.Run(mode, func(t *testing.T) {
			s, sender, email, ip := mailFixture(t)
			ctx := context.Background()
			id := uuid.New()
			if _, err := s.Enqueue(ctx, email, ip, id); err != nil {
				t.Fatal(err)
			}
			switch mode {
			case "expired":
				mustExec(t, s.DB, "UPDATE login_mail_outbox SET expires_at=? WHERE delivery_id=?", time.Now().UTC().Add(-time.Second), id[:])
			case "superseded":
				other := uuid.New()
				mustExec(t, s.DB, "UPDATE login_challenges SET challenge_id=? WHERE email=?", other[:], email)
			case "consumed":
				mustExec(t, s.DB, "UPDATE login_challenges SET consumed=TRUE WHERE email=?", email)
			}
			if _, err := s.ProcessOne(ctx, nil, id); err != nil {
				t.Fatal(err)
			}
			if len(sender.codes) != 0 {
				t.Fatal("unusable code sent")
			}
			result, err := s.Enqueue(ctx, email, ip, id)
			if err != nil || result.Status != "expired" {
				t.Fatalf("terminal state: %v %v", result, err)
			}
		})
	}
}

func TestTerminalFailureInvalidatesCode(t *testing.T) {
	s, sender, email, ip := mailFixture(t)
	ctx := context.Background()
	id := uuid.New()
	if _, err := s.Enqueue(ctx, email, ip, id); err != nil {
		t.Fatal(err)
	}
	sender.fail = true
	mustExec(t, s.DB, "UPDATE login_mail_outbox SET attempts=4 WHERE delivery_id=?", id[:])
	if _, err := s.ProcessOne(ctx, nil, id); err != nil {
		t.Fatal(err)
	}
	result, err := s.Enqueue(ctx, email, ip, id)
	if err != nil || result.Status != "failed" {
		t.Fatalf("failed state: %v %v", result, err)
	}
	var consumed bool
	if err = s.DB.QueryRow("SELECT consumed FROM login_challenges WHERE email=?", email).Scan(&consumed); err != nil || !consumed {
		t.Fatal("failed code still valid")
	}
}

func TestQueueCleanupPreservesLiveAndRecentRecords(t *testing.T) {
	s, _, email, ip := mailFixture(t)
	ctx := context.Background()
	id := uuid.New()
	if _, err := s.Enqueue(ctx, email, ip, id); err != nil {
		t.Fatal(err)
	}
	if err := s.CleanupMail(ctx); err != nil {
		t.Fatal(err)
	}
	if d, err := s.Enqueue(ctx, email, ip, id); err != nil || d.Status != "queued" {
		t.Fatalf("live job changed: %v %v", d, err)
	}
	mustExec(t, s.DB, "UPDATE login_mail_outbox SET expires_at=? WHERE delivery_id=?", time.Now().UTC().Add(-time.Second), id[:])
	if err := s.CleanupMail(ctx); err != nil {
		t.Fatal(err)
	}
	var state string
	var encrypted []byte
	if err := s.DB.QueryRow("SELECT state,encrypted_code FROM login_mail_outbox WHERE delivery_id=?", id[:]).Scan(&state, &encrypted); err != nil || state != "expired" || len(encrypted) != 0 {
		t.Fatalf("expired cleanup: %s %v", state, err)
	}
	mustExec(t, s.DB, "UPDATE login_mail_outbox SET created_at=? WHERE delivery_id=?", time.Now().UTC().Add(-25*time.Hour), id[:])
	if err := s.CleanupMail(ctx); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.DB.QueryRow("SELECT COUNT(*) FROM login_mail_outbox WHERE delivery_id=?", id[:]).Scan(&count); err != nil || count != 0 {
		t.Fatalf("old terminal record not removed: %d %v", count, err)
	}
}

func TestMaxAttemptsAfterLostAcknowledgementStopsRetry(t *testing.T) {
	s, sender, email, ip := mailFixture(t)
	ctx := context.Background()
	id := uuid.New()
	if _, err := s.Enqueue(ctx, email, ip, id); err != nil {
		t.Fatal(err)
	}
	mustExec(t, s.DB, "UPDATE login_mail_outbox SET state='sending',attempts=5,lease_until=? WHERE delivery_id=?", time.Now().UTC().Add(-time.Second), id[:])
	if _, err := s.ProcessOne(ctx, nil, id); err != nil {
		t.Fatal(err)
	}
	var consumed bool
	if err := s.DB.QueryRow("SELECT consumed FROM login_challenges WHERE email=?", email).Scan(&consumed); err != nil || !consumed {
		t.Fatal("terminal reclaim did not invalidate challenge")
	}
	if len(sender.codes) != 0 {
		t.Fatal("max attempts sent again")
	}
}

func TestTargetedAttemptCannotSendOtherJobs(t *testing.T) {
	s, sender, email, ip := mailFixture(t)
	ctx := context.Background()
	first, second := uuid.New(), uuid.New()
	if _, err := s.Enqueue(ctx, email, ip, first); err != nil {
		t.Fatal(err)
	}
	other := uuid.NewString() + "@example.test"
	t.Cleanup(func() {
		s.DB.Exec("DELETE FROM login_mail_outbox WHERE email=?", other)
		s.DB.Exec("DELETE FROM login_challenges WHERE email=?", other)
	})
	if _, err := s.Enqueue(ctx, other, ip, second); err != nil {
		t.Fatal(err)
	}
	if worked, err := s.ProcessOne(ctx, nil, second); err != nil || !worked {
		t.Fatalf("targeted attempt: %v", err)
	}
	a, err := s.Enqueue(ctx, email, ip, first)
	if err != nil || a.Status != "queued" {
		t.Fatalf("other job affected: %v %v", a, err)
	}
	b, err := s.Enqueue(ctx, other, ip, second)
	if err != nil || b.Status != "sent" {
		t.Fatalf("target not sent: %v %v", b, err)
	}
	if len(sender.codes) != 1 {
		t.Fatalf("send count %d", len(sender.codes))
	}
	if _, err := s.ProcessOne(ctx, nil, uuid.Nil); err == nil {
		t.Fatal("empty target fell back to global queue")
	}
}

// A permanent provider rejection must not spend the remaining retry budget.
type rejectedMail struct{}

func (rejectedMail) Send(context.Context, string, string) error { return errMailRejected }
func TestProviderRejectionTerminatesImmediately(t *testing.T) {
	s, _, email, ip := mailFixture(t)
	s.Sender = rejectedMail{}
	ctx := context.Background()
	id := uuid.New()
	if _, err := s.Enqueue(ctx, email, ip, id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ProcessOne(ctx, nil, id); err != nil {
		t.Fatal(err)
	}
	var state, failure string
	var attempts int
	var payload []byte
	if err := s.DB.QueryRow("SELECT state,failure_code,attempts,encrypted_code FROM login_mail_outbox WHERE delivery_id=?", id[:]).Scan(&state, &failure, &attempts, &payload); err != nil {
		t.Fatal(err)
	}
	if state != "failed" || failure != "mail_provider_rejected" || attempts != 1 || len(payload) != 0 {
		t.Fatal("rejection not finalized safely")
	}
	var consumed bool
	if err := s.DB.QueryRow("SELECT consumed FROM login_challenges WHERE email=?", email).Scan(&consumed); err != nil || !consumed {
		t.Fatal("rejected challenge remained valid")
	}
	if worked, err := s.ProcessOne(ctx, nil, id); err != nil || worked {
		t.Fatal("terminal rejection retried")
	}
}
