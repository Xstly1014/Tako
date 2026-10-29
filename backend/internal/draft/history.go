package draft

import (
	"context"
	"database/sql"
	"errors"
	"github.com/google/uuid"
	"log/slog"
	"time"
	"writing.local/community/internal/ops"
)

// ReadRevision is private-resource access for recovery tooling, not a public
// history editor. Recover using Write(recover) to a NEW draft, never rewind one.
func (s Store) ReadRevision(ctx context.Context, owner, id uuid.UUID, revision uint64) (Draft, error) {
	d := Draft{ID: id, Revision: revision}
	err := s.DB.QueryRowContext(ctx, "SELECT r.title,r.content,r.saved_at FROM draft_revisions r JOIN drafts d ON d.id=r.draft_id WHERE r.draft_id=? AND r.revision=? AND d.owner_id=?", id[:], revision, owner[:]).Scan(&d.Title, &d.Content, &d.SavedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Draft{}, ErrNotFound
	}
	return d, err
}

// Policy: every save for 24h, latest revision per Shanghai calendar day until
// 30 days. The current revision is exempt, regardless of age. Bounded batches.
func (s Store) CleanupRevisions(ctx context.Context, now time.Time) (int, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT r.draft_id,r.revision,d.owner_id FROM draft_revisions r JOIN drafts d ON d.id=r.draft_id
 WHERE r.revision<>d.revision AND (r.saved_at<? OR (r.saved_at<? AND EXISTS(
 SELECT 1 FROM draft_revisions newer WHERE newer.draft_id=r.draft_id AND newer.revision>r.revision
 AND DATE(newer.saved_at + INTERVAL 8 HOUR)=DATE(r.saved_at + INTERVAL 8 HOUR))))
 ORDER BY r.saved_at,r.draft_id,r.revision LIMIT 100`, now.UTC().Add(-30*24*time.Hour), now.UTC().Add(-24*time.Hour))
	if err != nil {
		return 0, err
	}
	type candidate struct {
		id, owner uuid.UUID
		revision  uint64
	}
	var candidates []candidate
	for rows.Next() {
		var id, owner []byte
		var revision uint64
		if err = rows.Scan(&id, &revision, &owner); err != nil {
			rows.Close()
			return 0, err
		}
		d, e := uuid.FromBytes(id)
		if e != nil {
			rows.Close()
			return 0, e
		}
		o, e := uuid.FromBytes(owner)
		if e != nil {
			rows.Close()
			return 0, e
		}
		candidates = append(candidates, candidate{d, o, revision})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	removed := 0
	for _, c := range candidates {
		// Lock in the same order as writes; recheck current revision before deleting.
		tx, e := s.DB.BeginTx(ctx, nil)
		if e != nil {
			return removed, e
		}
		var owner []byte
		if e = tx.QueryRowContext(ctx, "SELECT id FROM accounts WHERE id=? FOR UPDATE", c.owner[:]).Scan(&owner); e != nil {
			tx.Rollback()
			return removed, e
		}
		result, e := tx.ExecContext(ctx, "DELETE r FROM draft_revisions r JOIN drafts d ON d.id=r.draft_id WHERE r.draft_id=? AND r.revision=? AND d.owner_id=? AND r.revision<>d.revision", c.id[:], c.revision, c.owner[:])
		if e != nil {
			tx.Rollback()
			return removed, e
		}
		count, e := result.RowsAffected()
		if e != nil {
			tx.Rollback()
			return removed, e
		}
		if e = tx.Commit(); e != nil {
			return removed, e
		}
		removed += int(count)
	}
	return removed, nil
}

func (s Store) RunMaintenance(ctx context.Context, logger *slog.Logger) {
	for ctx.Err() == nil {
		runCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		removed, err := s.CleanupRevisions(runCtx, time.Now().UTC())
		if err != nil {
			_ = ops.Beat(runCtx, s.DB, "maintenance", false, 1)
		} else {
			_ = ops.Beat(runCtx, s.DB, "maintenance", true, 0)
		}
		cancel()
		if err != nil {
			logger.Error("draft_retention_failed", "failure_code", "database_failure")
		} else if removed > 0 {
			logger.Info("draft_retention_completed", "removed", removed)
		}
		timer := time.NewTimer(time.Minute)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}
