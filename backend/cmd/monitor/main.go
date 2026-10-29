// Independent local monitor. It does not rely on the mail queue it monitors.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/ops"
)

type state struct {
	Signature   string    `json:"signature"`
	AcceptedAt  time.Time `json:"accepted_at"`
	AttemptedAt time.Time `json:"attempted_at"`
	APIFailures uint64    `json:"api_failures"`
}

func main() {
	test := flag.Bool("test-alert", false, "send one explicitly authorized notification test")
	once := flag.Bool("once", false, "perform one check")
	flag.Parse()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger, *test, *once); err != nil {
		logger.Error("monitor_stopped", "failure_code", "configuration_or_dependency_failure")
		os.Exit(1)
	}
}

func run(logger *slog.Logger, test, once bool) error {
	prefix := "Tako"
	if instance := os.Getenv("ALERT_INSTANCE"); instance != "" {
		if ok, _ := regexp.MatchString("^[a-zA-Z0-9._-]{1,32}$", instance); !ok {
			return identity.ErrInvalid
		}
		prefix += " [" + instance + "]"
	}
	recipient, err := identity.NormalizeEmail(os.Getenv("ALERT_TO"))
	if err != nil {
		return err
	}
	sender := identity.Resend{APIKey: os.Getenv("RESEND_API_KEY"), From: os.Getenv("RESEND_FROM")}
	if err = sender.Validate(); err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if test {
		check, cancel := context.WithTimeout(ctx, 15*time.Second)
		defer cancel()
		if err = sender.SendMessage(check, recipient, prefix+" 故障通知测试", "这是一封经授权的运行告警测试邮件。用于验证通知通道，不包含用户正文、验证码或凭据。"); err != nil {
			return err
		}
		logger.Info("monitor_test_accepted")
		return nil
	}
	db, err := sql.Open("mysql", os.Getenv("MYSQL_DSN"))
	if err != nil {
		return err
	}
	defer db.Close()
	limit := uint64(512 << 20)
	if raw := os.Getenv("DATABASE_WARNING_BYTES"); raw != "" {
		limit, err = strconv.ParseUint(raw, 10, 64)
		if err != nil || limit == 0 {
			return identity.ErrInvalid
		}
	}
	path := os.Getenv("MONITOR_STATE_FILE")
	if path == "" {
		path = "/state/monitor.json"
	}
	previous := state{}
	if data, readErr := os.ReadFile(path); readErr == nil {
		if err = json.Unmarshal(data, &previous); err != nil {
			return err
		}
	} else if !os.IsNotExist(readErr) {
		return readErr
	}
	for ctx.Err() == nil {
		check, cancel := context.WithTimeout(ctx, 8*time.Second)
		issues, checkErr := ops.Check(check, db, time.Now().UTC(), limit)
		var failures uint64
		if checkErr == nil {
			checkErr = db.QueryRowContext(check, "SELECT failure_count FROM runtime_health WHERE role='api'").Scan(&failures)
			if checkErr == nil && failures > previous.APIFailures {
				issues = append(issues, "api_server_errors")
			}
		}
		cancel()
		if path := os.Getenv("BACKUP_STATUS_FILE"); path != "" {
			data, readErr := os.ReadFile(path)
			if readErr != nil {
				issues = append(issues, "backup_status_unavailable")
			} else {
				issues = append(issues, ops.BackupIssues(data, time.Now().UTC())...)
			}
		}
		if checkErr != nil {
			issues = []string{"database_or_diagnostics_unavailable"}
		}
		sort.Strings(issues)
		signature := strings.Join(issues, ",")
		now := time.Now().UTC()
		shouldSend := len(issues) > 0 && (signature != previous.Signature || now.Sub(previous.AcceptedAt) > 10*time.Minute)
		recovery := len(issues) == 0 && previous.Signature != ""
		if (shouldSend || recovery) && now.Sub(previous.AttemptedAt) > time.Minute {
			previous.AttemptedAt = now
			if err = save(path, previous); err != nil {
				return err
			}
			subject, text := prefix+" 运行故障", "检测时间（UTC）："+now.Format(time.RFC3339)+"\n故障代码："+signature+"\n请检查运行进程、队列和数据库。此邮件不含用户内容。"
			if recovery {
				subject = prefix + " 运行已恢复"
				text = "运行检查已恢复正常。时间（UTC）：" + now.Format(time.RFC3339)
			}
			sendCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
			sendErr := sender.SendMessage(sendCtx, recipient, subject, text)
			cancel()
			if sendErr != nil {
				logger.Error("monitor_notification_failed", "failure_code", "mail_delivery_failed")
			} else {
				previous.Signature = signature
				previous.AcceptedAt = now
				previous.APIFailures = failures
				if err = save(path, previous); err != nil {
					return err
				}
				logger.Info("monitor_notification_accepted", "issues", signature)
			}
		}
		logger.Info("monitor_check", "issues", signature)
		if once {
			return nil
		}
		timer := time.NewTimer(30 * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
	}
	return nil
}

func save(path string, value state) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if err = os.WriteFile(path+".tmp", data, 0600); err != nil {
		return err
	}
	return os.Rename(path+".tmp", path)
}
