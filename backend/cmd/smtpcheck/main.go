// smtpcheck performs ONE targeted outbox attempt. It never runs the global
// worker, prints credentials/codes, or automatically loops on SMTP failure.
package main

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"os"
	"strconv"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"writing.local/community/internal/identity"
)

func main() {
	if !run() {
		os.Exit(1)
	}
}
func run() bool {
	logger := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	fail := func(code string) bool { logger.Error("smtp_check_stopped", "failure_code", code); return false }
	to, err := identity.NormalizeEmail(os.Getenv("SMTP_CHECK_TO"))
	if err != nil {
		return fail("test_recipient_required")
	}
	id, err := uuid.Parse(os.Getenv("SMTP_CHECK_DELIVERY_ID"))
	if err != nil || id == uuid.Nil {
		return fail("stable_delivery_id_required")
	}
	key, err := hex.DecodeString(os.Getenv("MAIL_ENCRYPTION_KEY"))
	if err != nil || len(key) != 32 {
		return fail("queue_key_invalid")
	}
	pepper := []byte(os.Getenv("AUTH_PEPPER"))
	if len(pepper) < 32 {
		return fail("auth_pepper_invalid")
	}
	var sender identity.Sender
	if os.Getenv("MAIL_PROVIDER") == "resend" {
		configured := identity.Resend{APIKey: os.Getenv("RESEND_API_KEY"), From: os.Getenv("RESEND_FROM")}
		if err := configured.Validate(); err != nil {
			return fail("resend_configuration_incomplete")
		}
		sender = configured
	} else {
		if provider := os.Getenv("MAIL_PROVIDER"); provider != "" && provider != "smtp" {
			return fail("mail_provider_invalid")
		}
		port, err := strconv.Atoi(os.Getenv("SMTP_PORT"))
		if err != nil {
			return fail("smtp_port_invalid")
		}
		mode := os.Getenv("SMTP_TLS_MODE")
		if mode != "implicit" && mode != "starttls" {
			return fail("smtp_tls_mode_invalid")
		}
		configured := identity.SMTP{Host: os.Getenv("SMTP_HOST"), Port: port, Username: os.Getenv("SMTP_USERNAME"), Password: os.Getenv("SMTP_PASSWORD"), From: os.Getenv("SMTP_FROM"), ImplicitTLS: mode == "implicit"}
		if err := configured.Validate(); err != nil {
			return fail("smtp_configuration_incomplete")
		}
		sender = configured
	}
	dsn := os.Getenv("MYSQL_DSN")
	if dsn == "" {
		return fail("database_configuration_missing")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return fail("database_configuration_invalid")
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	service := identity.Service{DB: db, Pepper: pepper, QueueKey: key, Sender: sender}
	if _, err = service.Enqueue(ctx, to, "smtp-check", id); err != nil {
		return fail("enqueue_failed")
	}
	if _, err = service.ProcessOne(ctx, logger, id); err != nil {
		return fail("targeted_attempt_failed")
	}
	result, err := service.Enqueue(ctx, to, "smtp-check", id)
	if err != nil {
		return fail("status_read_failed")
	}
	if err = json.NewEncoder(os.Stdout).Encode(result); err != nil {
		return fail("status_output_failed")
	}
	return result.Status == "sent"
}
