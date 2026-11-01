package identity

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"

	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"
)

var ErrInvalid = errors.New("invalid_credentials")
var ErrLimited = errors.New("rate_limited")
var ErrUnavailable = errors.New("mail_unavailable")

type Sender interface {
	Send(context.Context, string, string) error
}
type Service struct {
	DB       *sql.DB
	Pepper   []byte
	Sender   Sender
	QueueKey []byte
}
type Account struct {
	ID       uuid.UUID `json:"id"`
	Nickname string    `json:"nickname"`
}

func NormalizeEmail(input string) (string, error) {
	input = strings.TrimSpace(input)
	if len(input) > 254 || strings.ContainsAny(input, "\r\n") {
		return "", ErrInvalid
	}
	address, err := mail.ParseAddress(input)
	if err != nil || address.Address != input {
		return "", ErrInvalid
	}
	at := strings.LastIndexByte(input, '@')
	if at <= 0 {
		return "", ErrInvalid
	}
	return input[:at] + "@" + strings.ToLower(input[at+1:]), nil
}
func (s *Service) digest(value string) []byte {
	h := hmac.New(sha256.New, s.Pepper)
	h.Write([]byte(value))
	return h.Sum(nil)
}

// All rate buckets are hashed, so database rows do not expose source IPs.
func (s *Service) rate(ctx context.Context, key string, max uint64, window time.Duration) error {
	hash := s.digest("rate:" + key)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := time.Now().UTC().Truncate(time.Microsecond)
	_, err = tx.ExecContext(ctx, "INSERT INTO auth_rate_limits (bucket_hash,window_started,hits) VALUES (?,?,0) ON DUPLICATE KEY UPDATE bucket_hash=VALUES(bucket_hash)", hash, now)
	if err != nil {
		return err
	}
	var start time.Time
	var hits uint64
	if err = tx.QueryRowContext(ctx, "SELECT window_started,hits FROM auth_rate_limits WHERE bucket_hash=? FOR UPDATE", hash).Scan(&start, &hits); err != nil {
		return err
	}
	if now.Sub(start) >= window {
		start = now
		hits = 0
	}
	if hits >= max {
		return ErrLimited
	}
	_, err = tx.ExecContext(ctx, "UPDATE auth_rate_limits SET window_started=?,hits=? WHERE bucket_hash=?", start, hits+1, hash)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) Verify(ctx context.Context, email, code, ip string) (Account, string, error) {
	normalized, err := NormalizeEmail(email)
	if err != nil {
		return Account{}, "", ErrInvalid
	}
	if len(code) != 6 || strings.IndexFunc(code, func(r rune) bool { return r < '0' || r > '9' }) >= 0 {
		return Account{}, "", ErrInvalid
	}
	if err = s.rate(ctx, "ip:verify:"+ip, 30, time.Minute); err != nil {
		return Account{}, "", err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Account{}, "", err
	}
	defer tx.Rollback()
	var rawID, hash []byte
	var expiry time.Time
	var attempts uint64
	var consumed bool
	err = tx.QueryRowContext(ctx, "SELECT challenge_id,code_hash,expires_at,attempts,consumed FROM login_challenges WHERE email=? FOR UPDATE", normalized).Scan(&rawID, &hash, &expiry, &attempts, &consumed)
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, "", ErrInvalid
	}
	if err != nil {
		return Account{}, "", err
	}
	if consumed || attempts >= 5 || !time.Now().UTC().Before(expiry) {
		return Account{}, "", ErrInvalid
	}
	id, err := uuid.FromBytes(rawID)
	if err != nil {
		return Account{}, "", err
	}
	expected := s.digest("code:" + normalized + ":" + id.String() + ":" + code)
	if subtle.ConstantTimeCompare(hash, expected) != 1 {
		if _, err = tx.ExecContext(ctx, "UPDATE login_challenges SET attempts=attempts+1 WHERE email=?", normalized); err != nil {
			return Account{}, "", err
		}
		if err = tx.Commit(); err != nil {
			return Account{}, "", err
		}
		return Account{}, "", ErrInvalid
	}
	accountID := uuid.New()
	if _, err = tx.ExecContext(ctx, "INSERT INTO accounts (id,email) VALUES (?,?) ON DUPLICATE KEY UPDATE email=VALUES(email)", accountID[:], normalized); err != nil {
		return Account{}, "", err
	}
	var actual []byte
	var nickname string
	if err = tx.QueryRowContext(ctx, "SELECT id,nickname FROM accounts WHERE email=?", normalized).Scan(&actual, &nickname); err != nil {
		return Account{}, "", err
	}
	accountID, err = uuid.FromBytes(actual)
	if err != nil {
		return Account{}, "", err
	}
	// Mailbox ownership cannot take over an unverified password account, even
	// if a deployment accidentally switches back to the legacy email mode.
	var passwordCount int
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM account_passwords WHERE account_id=?", accountID[:]).Scan(&passwordCount); err != nil {
		return Account{}, "", err
	}
	if passwordCount != 0 {
		return Account{}, "", ErrInvalid
	}
	bytes := make([]byte, 32)
	if _, err = rand.Read(bytes); err != nil {
		return Account{}, "", err
	}
	token := hex.EncodeToString(bytes)
	tokenHash := sha256.Sum256([]byte(token))
	if _, err = tx.ExecContext(ctx, "INSERT INTO sessions (token_hash,account_id,expires_at) VALUES (?,?,?)", tokenHash[:], accountID[:], time.Now().UTC().Add(7*24*time.Hour)); err != nil {
		return Account{}, "", err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE login_challenges SET consumed=TRUE WHERE email=?", normalized); err != nil {
		return Account{}, "", err
	}
	if err = tx.Commit(); err != nil {
		return Account{}, "", err
	}
	return Account{accountID, nickname}, token, nil
}

func (s *Service) Authenticate(ctx context.Context, token string) (Account, error) {
	if len(token) != 64 {
		return Account{}, ErrInvalid
	}
	return s.authenticateSession(ctx, token)
}

func (s *Service) AuthenticateApp(ctx context.Context, token string) (Account, error) {
	if len(token) != 73 || !strings.HasPrefix(token, "tako_app_") {
		return Account{}, ErrInvalid
	}
	if _, err := hex.DecodeString(token[9:]); err != nil {
		return Account{}, ErrInvalid
	}
	return s.authenticateSession(ctx, token)
}

func (s *Service) authenticateSession(ctx context.Context, token string) (Account, error) {
	hash := sha256.Sum256([]byte(token))
	var raw []byte
	var name string
	err := s.DB.QueryRowContext(ctx, "SELECT a.id,a.nickname FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(6)", hash[:]).Scan(&raw, &name)
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, ErrInvalid
	}
	if err != nil {
		return Account{}, err
	}
	id, err := uuid.FromBytes(raw)
	return Account{id, name}, err
}
func (s *Service) Logout(ctx context.Context, token string) error {
	hash := sha256.Sum256([]byte(token))
	_, err := s.DB.ExecContext(ctx, "DELETE FROM sessions WHERE token_hash=?", hash[:])
	return err
}
