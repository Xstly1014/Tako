package identity

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"time"
	"unicode/utf8"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

var ErrAccountExists = errors.New("account_exists")
var ErrPasswordSet = errors.New("password_already_set")
var ErrPassword = errors.New("invalid_password")
var ErrLogin = errors.New("invalid_login")

// Limit CPU-intensive operations independently of per-IP limits, including requests
// cancelled by their clients. A small ECS must keep serving draft saves during login.
var passwordSlots = make(chan struct{}, 2)

func passwordWork(ctx context.Context, fn func() error) error {
	select {
	case passwordSlots <- struct{}{}:
	default:
		return ErrLimited
	}
	defer func() { <-passwordSlots }()
	if err := ctx.Err(); err != nil {
		return err
	}
	return fn()
}

func validPassword(password string) bool {
	return utf8.ValidString(password) && utf8.RuneCountInString(password) >= 8 && len(password) <= 72
}

func passwordHash(ctx context.Context, password string) ([]byte, error) {
	if !validPassword(password) {
		return nil, ErrPassword
	}
	var hash []byte
	err := passwordWork(ctx, func() error { var e error; hash, e = bcrypt.GenerateFromPassword([]byte(password), 12); return e })
	return hash, err
}

func (s *Service) passwordRate(ctx context.Context, action, email, ip string) error {
	if err := s.rate(ctx, "password:ip:"+action+":"+ip, 20, time.Minute); err != nil {
		return err
	}
	return s.rate(ctx, "password:email:"+action+":"+email, 10, time.Minute)
}

func createPasswordSession(ctx context.Context, tx *sql.Tx, account Account, native bool) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := hex.EncodeToString(raw)
	if native {
		token = "tako_app_" + token
	}
	hash := sha256.Sum256([]byte(token))
	_, err := tx.ExecContext(ctx, "INSERT INTO sessions (token_hash,account_id,expires_at) VALUES (?,?,?)", hash[:], account.ID[:], time.Now().UTC().Add(7*24*time.Hour))
	return token, err
}

func (s *Service) RegisterPassword(ctx context.Context, email, password, ip string) (Account, string, error) {
	return s.registerPassword(ctx, email, password, ip, false)
}

func (s *Service) RegisterAppPassword(ctx context.Context, email, password, ip string) (Account, string, error) {
	return s.registerPassword(ctx, email, password, ip, true)
}

func (s *Service) registerPassword(ctx context.Context, email, password, ip string, native bool) (Account, string, error) {
	email, err := NormalizeEmail(email)
	if err != nil {
		return Account{}, "", ErrInvalid
	}
	if err = s.passwordRate(ctx, "register", email, ip); err != nil {
		return Account{}, "", err
	}
	hash, err := passwordHash(ctx, password)
	if err != nil {
		return Account{}, "", err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Account{}, "", err
	}
	defer tx.Rollback()
	account := Account{ID: uuid.New()}
	if _, err = tx.ExecContext(ctx, "INSERT INTO accounts (id,email) VALUES (?,?)", account.ID[:], email); err != nil {
		var duplicate *mysql.MySQLError
		if errors.As(err, &duplicate) && duplicate.Number == 1062 {
			return Account{}, "", ErrAccountExists
		}
		return Account{}, "", err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO account_passwords (account_id,password_hash) VALUES (?,?)", account.ID[:], hash); err != nil {
		return Account{}, "", err
	}
	token, err := createPasswordSession(ctx, tx, account, native)
	if err != nil {
		return Account{}, "", err
	}
	if err = tx.Commit(); err != nil {
		return Account{}, "", err
	}
	return account, token, nil
}

// An unknown address performs the same bcrypt work as a wrong password. Neither
// an absent password nor an unverified mailbox grants access to an old account.
var dummyPasswordHash = []byte("$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW")

func (s *Service) LoginPassword(ctx context.Context, email, password, ip string) (Account, string, error) {
	return s.loginPassword(ctx, email, password, ip, false)
}

func (s *Service) LoginAppPassword(ctx context.Context, email, password, ip string) (Account, string, error) {
	return s.loginPassword(ctx, email, password, ip, true)
}

func (s *Service) loginPassword(ctx context.Context, email, password, ip string, native bool) (Account, string, error) {
	email, err := NormalizeEmail(email)
	if err != nil {
		return Account{}, "", ErrLogin
	}
	if !validPassword(password) {
		return Account{}, "", ErrLogin
	}
	if err = s.passwordRate(ctx, "login", email, ip); err != nil {
		return Account{}, "", err
	}
	var raw, hash []byte
	var nickname string
	err = s.DB.QueryRowContext(ctx, "SELECT a.id,a.nickname,p.password_hash FROM accounts a JOIN account_passwords p ON p.account_id=a.id WHERE a.email=?", email).Scan(&raw, &nickname, &hash)
	missing := errors.Is(err, sql.ErrNoRows)
	if err != nil && !missing {
		return Account{}, "", err
	}
	if missing {
		hash = dummyPasswordHash
	}
	err = passwordWork(ctx, func() error { return bcrypt.CompareHashAndPassword(hash, []byte(password)) })
	if errors.Is(err, ErrLimited) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return Account{}, "", err
	}
	if err != nil || missing {
		return Account{}, "", ErrLogin
	}
	id, err := uuid.FromBytes(raw)
	if err != nil {
		return Account{}, "", err
	}
	account := Account{ID: id, Nickname: nickname}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Account{}, "", err
	}
	defer tx.Rollback()
	token, err := createPasswordSession(ctx, tx, account, native)
	if err != nil {
		return Account{}, "", err
	}
	if err = tx.Commit(); err != nil {
		return Account{}, "", err
	}
	return account, token, nil
}

func (s *Service) HasPassword(ctx context.Context, id uuid.UUID) (bool, error) {
	var count int
	err := s.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM account_passwords WHERE account_id=?", id[:]).Scan(&count)
	return count != 0, err
}

// Setup is only for an authenticated existing account. Repeating the same setup
// is safe after a lost response; a different password cannot overwrite it.
func (s *Service) SetupPassword(ctx context.Context, id uuid.UUID, password, ip string) error {
	if err := s.passwordRate(ctx, "setup", id.String(), ip); err != nil {
		return err
	}
	hash, err := passwordHash(ctx, password)
	if err != nil {
		return err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var raw []byte
	if err = tx.QueryRowContext(ctx, "SELECT id FROM accounts WHERE id=? FOR UPDATE", id[:]).Scan(&raw); err != nil {
		return err
	}
	var existing []byte
	err = tx.QueryRowContext(ctx, "SELECT password_hash FROM account_passwords WHERE account_id=?", id[:]).Scan(&existing)
	if err == nil {
		if err = passwordWork(ctx, func() error { return bcrypt.CompareHashAndPassword(existing, []byte(password)) }); err != nil {
			if errors.Is(err, ErrLimited) {
				return err
			}
			return ErrPasswordSet
		}
		return tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO account_passwords (account_id,password_hash) VALUES (?,?)", id[:], hash); err != nil {
		return err
	}
	return tx.Commit()
}
