package identity

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"time"

	"github.com/google/uuid"
)

var ErrDeliveryReuse = errors.New("delivery_id_reused")

type Delivery struct {
	ID        uuid.UUID `json:"delivery_id"`
	Status    string    `json:"status"`
	ExpiresAt time.Time `json:"expires_at"`
}

func (s *Service) seal(id uuid.UUID, email, code string) ([]byte, error) {
	block, err := aes.NewCipher(s.QueueKey)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, []byte(code), []byte(id.String()+":"+email)), nil
}
func (s *Service) open(id uuid.UUID, email string, data []byte) (string, error) {
	block, err := aes.NewCipher(s.QueueKey)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(data) < gcm.NonceSize() {
		return "", errors.New("queue_payload_invalid")
	}
	plain, err := gcm.Open(nil, data[:gcm.NonceSize()], data[gcm.NonceSize():], []byte(id.String()+":"+email))
	return string(plain), err
}

type queryRower interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func readDelivery(ctx context.Context, q queryRower, id uuid.UUID, email string) (Delivery, error) {
	var owner, state string
	var expires time.Time
	var challenge []byte
	var consumed sql.NullBool
	err := q.QueryRowContext(ctx, "SELECT o.email,o.state,o.expires_at,c.challenge_id,c.consumed FROM login_mail_outbox o LEFT JOIN login_challenges c ON c.email=o.email WHERE o.delivery_id=?", id[:]).Scan(&owner, &state, &expires, &challenge, &consumed)
	if err != nil {
		return Delivery{}, err
	}
	if owner != email {
		return Delivery{}, ErrDeliveryReuse
	}
	if (state == "queued" || state == "sending") && (!time.Now().UTC().Before(expires) || string(challenge) != string(id[:]) || consumed.Bool) {
		state = "expired"
	}
	return Delivery{id, state, expires}, nil
}

func (s *Service) Enqueue(ctx context.Context, email, ip string, id uuid.UUID) (Delivery, error) {
	if s.DB == nil {
		return Delivery{}, ErrUnavailable
	}
	normalized, err := NormalizeEmail(email)
	if err != nil || id == uuid.Nil {
		return Delivery{}, ErrInvalid
	}
	if old, err := readDelivery(ctx, s.DB, id, normalized); err == nil {
		return old, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return Delivery{}, err
	}
	if s.Sender == nil || len(s.Pepper) < 32 || len(s.QueueKey) != 32 {
		return Delivery{}, ErrUnavailable
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Delivery{}, err
	}
	defer tx.Rollback()
	now := time.Now().UTC().Truncate(time.Microsecond)
	// Serialize only short enqueue transactions; never hold a DB lock during SMTP.
	globalHash := s.digest("rate:global:send")
	if _, err = tx.ExecContext(ctx, "INSERT INTO auth_rate_limits (bucket_hash,window_started,hits) VALUES (?,?,0) ON DUPLICATE KEY UPDATE bucket_hash=VALUES(bucket_hash)", globalHash, now); err != nil {
		return Delivery{}, err
	}
	var locked []byte
	if err = tx.QueryRowContext(ctx, "SELECT bucket_hash FROM auth_rate_limits WHERE bucket_hash=? FOR UPDATE", globalHash).Scan(&locked); err != nil {
		return Delivery{}, err
	}
	if old, err := readDelivery(ctx, tx, id, normalized); err == nil {
		return old, tx.Commit()
	} else if !errors.Is(err, sql.ErrNoRows) {
		return Delivery{}, err
	}
	for _, limit := range []struct {
		key    string
		max    uint64
		window time.Duration
	}{{"global:send", 100, time.Hour}, {"ip:send:" + ip, 10, time.Hour}, {"email:send:" + normalized, 1, time.Minute}} {
		if err = s.consumeRate(ctx, tx, limit.key, limit.max, limit.window, now); err != nil {
			return Delivery{}, err
		}
	}
	number, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return Delivery{}, err
	}
	code := fmt.Sprintf("%06d", number.Int64())
	encrypted, err := s.seal(id, normalized, code)
	if err != nil {
		return Delivery{}, err
	}
	expiry := now.Add(10 * time.Minute)
	hash := s.digest("code:" + normalized + ":" + id.String() + ":" + code)
	_, err = tx.ExecContext(ctx, "INSERT INTO login_challenges (email,challenge_id,code_hash,expires_at,attempts,consumed,sent_at) VALUES (?,?,?,?,0,FALSE,?) ON DUPLICATE KEY UPDATE challenge_id=VALUES(challenge_id),code_hash=VALUES(code_hash),expires_at=VALUES(expires_at),attempts=0,consumed=FALSE,sent_at=VALUES(sent_at)", normalized, id[:], hash, expiry, now)
	if err != nil {
		return Delivery{}, err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO login_mail_outbox (delivery_id,email,encrypted_code,state,next_attempt_at,expires_at,created_at,updated_at) VALUES (?,?,?,'queued',?,?,?,?)", id[:], normalized, encrypted, now, expiry, now, now)
	if err != nil {
		return Delivery{}, err
	}
	if err = tx.Commit(); err != nil {
		return Delivery{}, err
	}
	return Delivery{id, "queued", expiry}, nil
}

func (s *Service) consumeRate(ctx context.Context, tx *sql.Tx, key string, max uint64, window time.Duration, now time.Time) error {
	hash := s.digest("rate:" + key)
	if _, err := tx.ExecContext(ctx, "INSERT INTO auth_rate_limits (bucket_hash,window_started,hits) VALUES (?,?,0) ON DUPLICATE KEY UPDATE bucket_hash=VALUES(bucket_hash)", hash, now); err != nil {
		return err
	}
	var start time.Time
	var hits uint64
	if err := tx.QueryRowContext(ctx, "SELECT window_started,hits FROM auth_rate_limits WHERE bucket_hash=? FOR UPDATE", hash).Scan(&start, &hits); err != nil {
		return err
	}
	if now.Sub(start) >= window {
		start = now
		hits = 0
	}
	if hits >= max {
		return ErrLimited
	}
	_, err := tx.ExecContext(ctx, "UPDATE auth_rate_limits SET window_started=?,hits=? WHERE bucket_hash=?", start, hits+1, hash)
	return err
}

type mailJob struct {
	id        uuid.UUID
	email     string
	encrypted []byte
	expires   time.Time
	attempts  uint64
	lease     uuid.UUID
}

func (s *Service) claim(ctx context.Context, onlyDelivery ...uuid.UUID) (*mailJob, error) {
	if len(onlyDelivery) > 1 || (len(onlyDelivery) == 1 && onlyDelivery[0] == uuid.Nil) {
		return nil, ErrInvalid
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	now := time.Now().UTC().Truncate(time.Microsecond)
	var raw []byte
	j := &mailJob{}
	query := "SELECT delivery_id,email,encrypted_code,expires_at,attempts FROM login_mail_outbox WHERE ((state='queued' AND next_attempt_at<=?) OR (state='sending' AND lease_until<=?))"
	args := []any{now, now}
	if len(onlyDelivery) == 1 {
		query += " AND delivery_id=?"
		args = append(args, onlyDelivery[0][:])
	}
	query += " ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED"
	err = tx.QueryRowContext(ctx, query, args...).Scan(&raw, &j.email, &j.encrypted, &j.expires, &j.attempts)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	j.id, err = uuid.FromBytes(raw)
	if err != nil {
		return nil, err
	}
	var current []byte
	var consumed bool
	err = tx.QueryRowContext(ctx, "SELECT challenge_id,consumed FROM login_challenges WHERE email=?", j.email).Scan(&current, &consumed)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	state := ""
	if !now.Before(j.expires) || errors.Is(err, sql.ErrNoRows) || string(current) != string(j.id[:]) || consumed {
		state = "expired"
	} else if j.attempts >= 5 {
		state = "failed"
	}
	if state != "" {
		_, err = tx.ExecContext(ctx, "UPDATE login_mail_outbox SET state=?,encrypted_code=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE delivery_id=?", state, now, j.id[:])
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, "UPDATE login_challenges SET consumed=TRUE WHERE email=? AND challenge_id=?", j.email, j.id[:]); err != nil {
			return nil, err
		}
		return nil, tx.Commit()
	}
	j.lease = uuid.New()
	j.attempts++
	_, err = tx.ExecContext(ctx, "UPDATE login_mail_outbox SET state='sending',attempts=?,lease_token=?,lease_until=?,updated_at=? WHERE delivery_id=?", j.attempts, j.lease[:], now.Add(30*time.Second), now, j.id[:])
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return j, nil
}

// ProcessOne sends at least once. A crash after SMTP acceptance but before DB
// acknowledgement can resend the SAME code after lease expiry, never a new code.
func (s *Service) ProcessOne(ctx context.Context, logger *slog.Logger, onlyDelivery ...uuid.UUID) (bool, error) {
	if s.Sender == nil || len(s.QueueKey) != 32 {
		return false, ErrUnavailable
	}
	j, err := s.claim(ctx, onlyDelivery...)
	if err != nil || j == nil {
		return false, err
	}
	code, decryptErr := s.open(j.id, j.email, j.encrypted)
	sendErr := decryptErr
	if sendErr == nil {
		remaining := time.Until(j.expires)
		if remaining <= 0 {
			sendErr = errors.New("expired")
		} else {
			if remaining > 15*time.Second {
				remaining = 15 * time.Second
			}
			sendCtx, cancel := context.WithTimeout(ctx, remaining)
			sendErr = s.Sender.Send(sendCtx, j.email, code)
			cancel()
		}
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	state, failure := "sent", ""
	next := now
	if sendErr != nil {
		failure = "mail_delivery_failed"
		state = "queued"
		next = now.Add(time.Duration(5*(1<<min(j.attempts-1, 4))) * time.Second)
		if decryptErr != nil {
			state = "failed"
			failure = "payload_invalid"
		} else if errors.Is(sendErr, errMailRejected) {
			state = "failed"
			failure = "mail_provider_rejected"
		} else if !now.Before(j.expires) {
			state = "expired"
		} else if j.attempts >= 5 {
			state = "failed"
		}
	}
	// Finalization is independent of a canceled request/shutdown context. The
	// lease token prevents an old worker from overwriting a newer worker's result.
	finishCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	tx, err := s.DB.BeginTx(finishCtx, nil)
	if err != nil {
		return true, err
	}
	defer tx.Rollback()
	var payload any
	if state == "queued" {
		payload = j.encrypted
	}
	result, err := tx.ExecContext(finishCtx, "UPDATE login_mail_outbox SET state=?,encrypted_code=?,lease_token=NULL,lease_until=NULL,next_attempt_at=?,updated_at=?,failure_code=? WHERE delivery_id=? AND lease_token=?", state, payload, next, now, failure, j.id[:], j.lease[:])
	if err != nil {
		return true, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return true, err
	}
	if count != 1 {
		return true, errors.New("mail_lease_lost")
	}
	if state == "failed" || state == "expired" {
		if _, err = tx.ExecContext(finishCtx, "UPDATE login_challenges SET consumed=TRUE WHERE email=? AND challenge_id=?", j.email, j.id[:]); err != nil {
			return true, err
		}
	}
	if err = tx.Commit(); err != nil {
		return true, err
	}
	if logger != nil {
		logger.Info("mail_task_finished", "delivery_id", j.id.String(), "state", state, "attempt", j.attempts, "failure_code", failure)
	}
	return true, nil
}

func (s *Service) RunWorker(ctx context.Context, logger *slog.Logger) {
	var lastCleanup time.Time
	for ctx.Err() == nil {
		if time.Since(lastCleanup) >= time.Minute {
			if err := s.CleanupMail(ctx); err != nil {
				if logger != nil {
					logger.Error("mail_cleanup_failed", "failure_code", "database_failure")
				}
			} else {
				lastCleanup = time.Now()
			}
		}
		worked, err := s.ProcessOne(ctx, logger)
		if err != nil && logger != nil {
			logger.Error("mail_worker_failed", "failure_code", "queue_or_dependency_failure")
		}
		if err != nil || !worked {
			timer := time.NewTimer(time.Second)
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
		}
	}
}

// Keep idempotency records for at least 24 hours. Delete only bounded batches;
// never delete active leases or still-valid authentication state.
func (s *Service) CleanupMail(ctx context.Context) error {
	now := time.Now().UTC().Truncate(time.Microsecond)
	cutoff := now.Add(-24 * time.Hour)
	statements := []struct {
		query string
		args  []any
	}{
		{"UPDATE login_mail_outbox SET state='expired',encrypted_code=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE expires_at<=? AND (state='queued' OR (state='sending' AND lease_until<=?)) LIMIT 100", []any{now, now, now}},
		{"DELETE FROM login_mail_outbox WHERE state IN ('sent','failed','expired') AND created_at<? LIMIT 100", []any{cutoff}},
		{"DELETE FROM login_challenges WHERE expires_at<? LIMIT 100", []any{cutoff}},
		{"DELETE FROM sessions WHERE expires_at<? LIMIT 100", []any{now}},
		{"DELETE FROM auth_rate_limits WHERE window_started<? LIMIT 100", []any{cutoff}},
	}
	for _, statement := range statements {
		if _, err := s.DB.ExecContext(ctx, statement.query, statement.args...); err != nil {
			return err
		}
	}
	return nil
}
