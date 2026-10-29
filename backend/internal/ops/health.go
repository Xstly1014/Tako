package ops

import (
	"context"
	"database/sql"
	"sync/atomic"
	"time"
)

var requestFailures atomic.Uint64

func RecordRequest(status int) {
	if status >= 500 {
		requestFailures.Add(1)
	}
}

// Health contains only operational summaries, never user identifiers or content.
func Beat(ctx context.Context, db *sql.DB, role string, successful bool, failures uint64) error {
	var success any
	if successful {
		success = time.Now().UTC()
	}
	_, err := db.ExecContext(ctx, `INSERT INTO runtime_health(role,last_seen,last_success,failure_count) VALUES (?,?,?,?)
 ON DUPLICATE KEY UPDATE last_seen=VALUES(last_seen),last_success=COALESCE(VALUES(last_success),last_success),failure_count=failure_count+VALUES(failure_count)`, role, time.Now().UTC(), success, failures)
	return err
}

func RunAPI(ctx context.Context, db *sql.DB, role string) {
	for ctx.Err() == nil {
		check, cancel := context.WithTimeout(ctx, 3*time.Second)
		failures := requestFailures.Swap(0)
		if Beat(check, db, role, failures == 0, failures) != nil {
			requestFailures.Add(failures)
		}
		cancel()
		timer := time.NewTimer(15 * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func Check(ctx context.Context, db *sql.DB, now time.Time, maxBytes uint64) ([]string, error) {
	issues := []string{}
	for _, role := range []string{"api", "mail-worker", "maintenance"} {
		var seen time.Time
		var success sql.NullTime
		err := db.QueryRowContext(ctx, "SELECT last_seen,last_success FROM runtime_health WHERE role=?", role).Scan(&seen, &success)
		if err == sql.ErrNoRows {
			issues = append(issues, role+"_missing")
			continue
		}
		if err != nil {
			return nil, err
		}
		if now.Sub(seen) > 150*time.Second {
			issues = append(issues, role+"_stale")
		}
		if !success.Valid || now.Sub(success.Time) > 180*time.Second {
			issues = append(issues, role+"_unhealthy")
		}
	}
	var count int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM login_mail_outbox WHERE state IN ('queued','sending') AND expires_at>? AND created_at<?`, now, now.Add(-2*time.Minute)).Scan(&count); err != nil {
		return nil, err
	}
	if count > 0 {
		issues = append(issues, "mail_backlog")
	}
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM login_mail_outbox WHERE state='failed' AND updated_at>?", now.Add(-5*time.Minute)).Scan(&count); err != nil {
		return nil, err
	}
	if count > 0 {
		issues = append(issues, "mail_delivery_failed")
	}
	var size uint64
	if err := db.QueryRowContext(ctx, "SELECT COALESCE(SUM(data_length+index_length),0) FROM information_schema.tables WHERE table_schema=DATABASE()").Scan(&size); err != nil {
		return nil, err
	}
	if size > maxBytes {
		issues = append(issues, "database_capacity_warning")
	}
	return issues, nil
}
