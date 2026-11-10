package shortpost

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

var (
	ErrAppealPending  = errors.New("short-post appeal pending")
	ErrAppealCooldown = errors.New("short-post appeal cooldown")
)

type FileAppeal struct {
	CaseRevision uint64 `json:"case_revision"`
	Reason       string `json:"reason"`
}

type Appeal struct {
	ID             uuid.UUID  `json:"id"`
	PostID         uuid.UUID  `json:"post_id"`
	CaseRevision   uint64     `json:"case_revision"`
	Version        *uint64    `json:"version"`
	State          string     `json:"state"`
	Reason         string     `json:"reason"`
	DecisionReason string     `json:"decision_reason"`
	SubmittedAt    time.Time  `json:"submitted_at"`
	DecidedAt      *time.Time `json:"decided_at"`
}

type AppealPage struct {
	Items      []Appeal `json:"items"`
	NextBefore uint64   `json:"next_before"`
}

const appealSelect = `SELECT a.id,a.post_id,a.case_revision,c.target_version,a.state,a.reason,a.decision_reason,a.submitted_at,a.decided_at`
const appealFrom = ` FROM short_post_appeals a JOIN short_post_actions c ON c.post_id=a.post_id AND c.state_revision=a.case_revision`

func appealFields(out *Appeal) []any {
	return []any{&out.ID, &out.PostID, &out.CaseRevision, &out.Version, &out.State, &out.Reason, &out.DecisionReason, &out.SubmittedAt, &out.DecidedAt}
}

func (s PostStore) FileAppeal(ctx context.Context, owner, post, id uuid.UUID, in FileAppeal) (Appeal, error) {
	var out Appeal
	in.Reason = strings.TrimSpace(in.Reason)
	if id == uuid.Nil || in.CaseRevision == 0 || in.CaseRevision > maxPostRevision || !utf8.ValidString(in.Reason) ||
		in.Reason == "" || utf8.RuneCountInString(in.Reason) > 500 {
		return out, ErrInvalidAction
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	var locked uuid.UUID
	if err = tx.QueryRowContext(ctx, "SELECT id FROM short_posts WHERE id=? AND owner_id=? FOR UPDATE", post[:], owner[:]).Scan(&locked); err != nil {
		return out, err
	}
	query := appealSelect + appealFrom + " WHERE a.post_id=? AND a.id=?"
	err = tx.QueryRowContext(ctx, query, post[:], id[:]).Scan(appealFields(&out)...)
	if err == nil {
		if out.CaseRevision != in.CaseRevision || out.Reason != in.Reason {
			return Appeal{}, ErrPreviewIDReused
		}
		return out, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return out, err
	}
	if _, err = activeAppealCase(ctx, tx, post, in.CaseRevision); err != nil {
		return out, err
	}
	var pending, cooldown bool
	err = tx.QueryRowContext(ctx, `SELECT
 EXISTS(SELECT 1 FROM short_post_appeals WHERE post_id=? AND pending_case=?),
 EXISTS(SELECT 1 FROM short_post_appeals WHERE post_id=? AND case_revision=? AND state='upheld' AND decided_at>UTC_TIMESTAMP(6)-INTERVAL 24 HOUR)`,
		post[:], in.CaseRevision, post[:], in.CaseRevision).Scan(&pending, &cooldown)
	if err != nil {
		return out, err
	}
	if pending {
		return out, ErrAppealPending
	}
	if cooldown {
		return out, ErrAppealCooldown
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO short_post_appeals(id,post_id,owner_id,case_revision,state,reason,submitted_at)
 VALUES(?,?,?,?,'pending',?,UTC_TIMESTAMP(6))`, id[:], post[:], owner[:], in.CaseRevision, in.Reason); err != nil {
		return out, err
	}
	if err = tx.QueryRowContext(ctx, query, post[:], id[:]).Scan(appealFields(&out)...); err != nil {
		return out, err
	}
	return out, tx.Commit()
}

// All restriction writers and appeal decisions hold the post lock before
// resolving the current restriction event. An old event can never match a relimit.
func latestLimitEvent(ctx context.Context, tx *sql.Tx, post uuid.UUID, version *uint64) (uint64, string, error) {
	var revision uint64
	var action string
	err := tx.QueryRowContext(ctx, `SELECT state_revision,action FROM short_post_actions
 WHERE post_id=? AND target_version<=>? AND action IN ('limit','limit_version','revoke_limit','revoke_version_limit','appeal_revoke')
 ORDER BY state_revision DESC LIMIT 1 FOR UPDATE`, post[:], version).Scan(&revision, &action)
	return revision, action, err
}

func activeAppealCase(ctx context.Context, tx *sql.Tx, post uuid.UUID, revision uint64) (*uint64, error) {
	var version *uint64
	err := tx.QueryRowContext(ctx, `SELECT target_version FROM short_post_actions
 WHERE post_id=? AND state_revision=? AND action IN ('limit','limit_version') FOR UPDATE`, post[:], revision).Scan(&version)
	if err != nil {
		return nil, err
	}
	current, action, err := latestLimitEvent(ctx, tx, post, version)
	if err != nil {
		return nil, err
	}
	if current != revision || (action != "limit" && action != "limit_version") {
		return nil, ErrStateConflict
	}
	return version, nil
}

func decideAppeal(ctx context.Context, tx *sql.Tx, out *PostState, id uuid.UUID, revoke bool, reason string) (*uint64, error) {
	var state string
	var revision uint64
	err := tx.QueryRowContext(ctx, "SELECT case_revision,state FROM short_post_appeals WHERE post_id=? AND id=? FOR UPDATE", out.ID[:], id[:]).Scan(&revision, &state)
	if err != nil {
		return nil, err
	}
	if state != "pending" {
		return nil, ErrStateConflict
	}
	version, err := activeAppealCase(ctx, tx, out.ID, revision)
	if err != nil {
		return nil, err
	}
	state = "upheld"
	if revoke {
		state = "revoked"
		if version == nil {
			out.PlatformLimited = false
		} else if err = changeVersionLimit(ctx, tx, out.ID, *version, false); err != nil {
			return nil, err
		}
	}
	_, err = tx.ExecContext(ctx, "UPDATE short_post_appeals SET state=?,decision_reason=?,decided_at=UTC_TIMESTAMP(6) WHERE post_id=? AND id=?", state, reason, out.ID[:], id[:])
	return version, err
}

func closeAppealsOnRevocation(ctx context.Context, tx *sql.Tx, post uuid.UUID, version *uint64, reason string) error {
	caseRevision, _, err := latestLimitEvent(ctx, tx, post, version)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE short_post_appeals SET state='revoked',decision_reason=?,decided_at=UTC_TIMESTAMP(6)
 WHERE post_id=? AND pending_case=?`, reason, post[:], caseRevision)
	return err
}

func (s PostStore) ReadAppeal(ctx context.Context, owner, post, id uuid.UUID) (Appeal, error) {
	var out Appeal
	query := appealSelect + appealFrom + " WHERE a.post_id=? AND a.id=?"
	args := []any{post[:], id[:]}
	if owner != uuid.Nil {
		query += " AND a.owner_id=?"
		args = append(args, owner[:])
	}
	err := s.DB.QueryRowContext(ctx, query, args...).Scan(appealFields(&out)...)
	return out, err
}

func (s PostStore) Appeals(ctx context.Context, owner, post uuid.UUID, before uint64) (AppealPage, error) {
	out := AppealPage{Items: []Appeal{}}
	query := appealSelect + ",a.sequence" + appealFrom
	var args []any
	if owner == uuid.Nil {
		query += " WHERE a.state='pending'"
	} else {
		var owned uuid.UUID
		if err := s.DB.QueryRowContext(ctx, "SELECT id FROM short_posts WHERE id=? AND owner_id=?", post[:], owner[:]).Scan(&owned); err != nil {
			return out, err
		}
		query += " WHERE a.post_id=? AND a.owner_id=?"
		args = append(args, post[:], owner[:])
	}
	if before > 0 {
		query += " AND a.sequence<?"
		args = append(args, before)
	}
	rows, err := s.DB.QueryContext(ctx, query+" ORDER BY a.sequence DESC LIMIT 13", args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	var anchor uint64
	for rows.Next() {
		var item Appeal
		var sequence uint64
		if err := rows.Scan(append(appealFields(&item), &sequence)...); err != nil {
			return out, err
		}
		if len(out.Items) == postPageSize {
			out.NextBefore = anchor
			break
		}
		out.Items = append(out.Items, item)
		anchor = sequence
	}
	return out, rows.Err()
}
