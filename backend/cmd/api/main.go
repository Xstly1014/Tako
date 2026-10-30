package main

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	_ "github.com/go-sql-driver/mysql"
	"writing.local/community/internal/draft"
	"writing.local/community/internal/httpapi"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/ops"
)

// This initial liveness endpoint does not claim database readiness.
func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	addr := os.Getenv("HTTP_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	dsn := os.Getenv("MYSQL_DSN")
	if dsn == "" {
		logger.Error("MYSQL_DSN is required")
		os.Exit(1)
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		logger.Error("database_configuration_invalid")
		os.Exit(1)
	}
	defer db.Close()
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(3 * time.Minute)
	if os.Getenv("APP_ROLE") == "maintenance" {
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		draft.Store{DB: db}.RunMaintenance(ctx, logger)
		return
	}
	gin.SetMode(gin.ReleaseMode)
	mux := gin.New()
	mux.Use(gin.CustomRecoveryWithWriter(io.Discard, func(c *gin.Context, _ any) {
		logger.Error("request_panicked", "request_id", c.GetString("request_id"))
		c.AbortWithStatusJSON(500, gin.H{"error": "internal_error", "request_id": c.GetString("request_id")})
	}))
	mux.GET("/health/live", func(c *gin.Context) { c.Header("Cache-Control", "no-store"); c.JSON(200, gin.H{"status": "alive"}) })
	mux.GET("/health/ready", func(c *gin.Context) {
		checkCtx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		c.Header("Cache-Control", "no-store")
		if err := db.PingContext(checkCtx); err != nil {
			c.JSON(503, gin.H{"status": "not_ready"})
			return
		}
		c.JSON(200, gin.H{"status": "ready", "scope": "database_connectivity_only"})
	})
	pepper := os.Getenv("AUTH_PEPPER")
	if len(pepper) < 32 {
		logger.Error("AUTH_PEPPER must contain at least 32 random bytes")
		os.Exit(1)
	}
	auth := &identity.Service{DB: db, Pepper: []byte(pepper)}
	queueKey, keyErr := hex.DecodeString(os.Getenv("MAIL_ENCRYPTION_KEY"))
	if keyErr != nil || len(queueKey) != 32 {
		logger.Error("MAIL_ENCRYPTION_KEY must be a 32-byte hex-encoded random key")
		os.Exit(1)
	}
	auth.QueueKey = queueKey
	if os.Getenv("MAIL_PROVIDER") == "resend" {
		sender := identity.Resend{APIKey: os.Getenv("RESEND_API_KEY"), From: os.Getenv("RESEND_FROM")}
		if err := sender.Validate(); err != nil {
			logger.Error("resend_configuration_invalid")
			os.Exit(1)
		}
		auth.Sender = sender
	} else if provider := os.Getenv("MAIL_PROVIDER"); provider != "" && provider != "smtp" {
		logger.Error("mail_provider_invalid")
		os.Exit(1)
	} else if os.Getenv("SMTP_HOST") != "" {
		port, parseErr := strconv.Atoi(os.Getenv("SMTP_PORT"))
		if parseErr != nil || port < 1 || port > 65535 {
			logger.Error("SMTP_PORT invalid")
			os.Exit(1)
		}
		mode := os.Getenv("SMTP_TLS_MODE")
		if mode == "" {
			mode = "starttls"
		}
		if mode != "starttls" && mode != "implicit" {
			logger.Error("SMTP_TLS_MODE must be starttls or implicit")
			os.Exit(1)
		}
		smtp := identity.SMTP{Host: os.Getenv("SMTP_HOST"), Port: port, Username: os.Getenv("SMTP_USERNAME"), Password: os.Getenv("SMTP_PASSWORD"), From: os.Getenv("SMTP_FROM"), ImplicitTLS: mode == "implicit"}
		if err := smtp.Validate(); err != nil {
			logger.Error("smtp_configuration_invalid", "failure_code", err.Error())
			os.Exit(1)
		}
		auth.Sender = smtp
	} else if os.Getenv("SMTP_USERNAME") != "" || os.Getenv("SMTP_PASSWORD") != "" || os.Getenv("SMTP_FROM") != "" {
		logger.Error("SMTP_HOST required when SMTP settings are supplied")
		os.Exit(1)
	}
	api := httpapi.API{Identity: auth, Drafts: draft.Store{DB: db}, DB: db, Origin: os.Getenv("APP_ORIGIN"), SecureCookie: os.Getenv("COOKIE_SECURE") != "false", Logger: logger, EnableDocs: os.Getenv("API_ENABLE_DOCS") == "true", EnablePublications: os.Getenv("PUBLICATION_ENABLED") == "true"}
	if err := api.Register(mux); err != nil {
		logger.Error("api_configuration_invalid", "error", err.Error())
		os.Exit(1)
	}
	server := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if os.Getenv("APP_ROLE") == "mail-worker" {
		if auth.Sender == nil {
			logger.Error("Mail provider configuration is required for mail-worker")
			os.Exit(1)
		}
		logger.Info("mail_worker_starting")
		auth.RunWorker(ctx, logger)
		return
	}
	role := "api"
	if os.Getenv("OPS_API_ROLE") == "mobile-api" {
		role = "mobile-api"
	}
	go ops.RunAPI(ctx, db, role)
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			logger.Error("shutdown_failed", "error", err.Error())
		}
	}()
	logger.Info("api_starting", "address", addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("api_failed", "error", err.Error())
		os.Exit(1)
	}
}
