package publication

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"strings"
	"time"
	"unicode/utf8"
)

var ErrReviewConflict = errors.New("review_conflict")
var ErrAppealPending = errors.New("appeal_pending")
var ErrAppealCooldown = errors.New("appeal_cooldown")

type ModerationAction struct {
	MutationID       uuid.UUID `json:"mutation_id"`
	ExpectedRevision uint64    `json:"expected_revision"`
	Decision         string    `json:"decision"`
	Reason           string    `json:"reason"`
	AppealID         uint64    `json:"appeal_id,omitempty"`
}
type ModerationResult struct {
	ID       uint64 `json:"id"`
	State    string `json:"state"`
	Revision uint64 `json:"revision"`
}
type ModerationCase struct {
	ID           uint64     `json:"id"`
	WorkID       uuid.UUID  `json:"work_id"`
	Version      uint64     `json:"version"`
	Scope        string     `json:"scope"`
	Reason       string     `json:"reason"`
	State        string     `json:"state"`
	Revision     uint64     `json:"revision"`
	CreatedAt    time.Time  `json:"created_at"`
	NextAppealAt *time.Time `json:"next_appeal_at"`
}
type ModerationAppeal struct {
	ID             uint64     `json:"id"`
	CaseID         uint64     `json:"case_id"`
	Reason         string     `json:"reason"`
	State          string     `json:"state"`
	DecisionReason string     `json:"decision_reason"`
	CreatedAt      time.Time  `json:"created_at"`
	DecidedAt      *time.Time `json:"decided_at"`
}
type ReviewTask struct {
	ID             uint64    `json:"id"`
	WorkID         uuid.UUID `json:"work_id"`
	Version        uint64    `json:"version"`
	Revision       uint64    `json:"revision"`
	State          string    `json:"state"`
	FirstWaitingAt time.Time `json:"first_waiting_at"`
	IsCurrent      bool      `json:"is_current"`
	Title          string    `json:"title"`
}
type ReviewPage struct {
	Items []ReviewTask `json:"items"`
	Next  uint64       `json:"next"`
}
type CasePage struct {
	Items []ModerationCase `json:"items"`
	Next  uint64           `json:"next"`
}
type AppealPage struct {
	Items []ModerationAppeal `json:"items"`
	Next  uint64             `json:"next"`
}
type ReviewDetail struct {
	Task ReviewTask `json:"task"`
	Work Work       `json:"work"`
}
type CaseDetail struct {
	Case       ModerationCase        `json:"case"`
	Appeals    AppealPage            `json:"appeals"`
	Work       Work                  `json:"work"`
	Revocation *ModerationRevocation `json:"revocation"`
}
type ModerationRevocation struct {
	Reason    string    `json:"reason"`
	CreatedAt time.Time `json:"created_at"`
}

func validModeration(in ModerationAction) bool {
	return in.MutationID != uuid.Nil && in.ExpectedRevision > 0 && in.ExpectedRevision <= MaxSequence && utf8.ValidString(in.Reason) && strings.TrimSpace(in.Reason) != "" && utf8.RuneCountInString(in.Reason) <= 2000 && in.AppealID <= MaxSequence
}

// The immutable receipt is also the operator audit trail; no content is logged.
func (s Store) moderationWrite(ctx context.Context, actor, owner, work uuid.UUID, kind string, target any, in ModerationAction, apply func(*sql.Tx, time.Time) (ModerationResult, error)) (ModerationResult, error) {
	hash, e := digest(struct {
		Kind   string
		Target any
		Input  ModerationAction
	}{kind, target, in})
	if e != nil {
		return ModerationResult{}, e
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return ModerationResult{}, e
	}
	defer tx.Rollback()
	if e = lockOwner(ctx, tx, owner); e != nil {
		return ModerationResult{}, e
	}
	var oldHash, oldResult []byte
	e = tx.QueryRowContext(ctx, "SELECT payload_hash,result FROM moderation_mutations WHERE actor_id=? AND mutation_id=?", actor[:], in.MutationID[:]).Scan(&oldHash, &oldResult)
	if e == nil {
		if string(hash[:]) != string(oldHash) {
			return ModerationResult{}, ErrKeyReuse
		}
		var out ModerationResult
		if e = json.Unmarshal(oldResult, &out); e != nil {
			return out, e
		}
		return out, tx.Commit()
	}
	if !errors.Is(e, sql.ErrNoRows) {
		return ModerationResult{}, e
	}
	var revision uint64
	if e = tx.QueryRowContext(ctx, "SELECT state_revision FROM works WHERE id=? AND owner_id=? FOR UPDATE", work[:], owner[:]).Scan(&revision); e != nil {
		return ModerationResult{}, e
	}
	if revision >= MaxSequence {
		return ModerationResult{}, ErrReviewConflict
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	if s.ModerationClock != nil {
		now = s.ModerationClock().UTC().Truncate(time.Microsecond)
	}
	out, e := apply(tx, now)
	if e != nil {
		return out, e
	}
	data, e := json.Marshal(out)
	if e != nil {
		return out, e
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO moderation_mutations(actor_id,mutation_id,owner_id,work_id,kind,reason,payload_hash,result,created_at) VALUES(?,?,?,?,?,?,?,?,?)", actor[:], in.MutationID[:], owner[:], work[:], kind, in.Reason, hash[:], data, now)
	if e != nil {
		return out, e
	}
	return out, tx.Commit()
}
func (s Store) moderationOwner(ctx context.Context, work uuid.UUID) (uuid.UUID, error) {
	var b []byte
	e := s.DB.QueryRowContext(ctx, "SELECT owner_id FROM works WHERE id=?", work[:]).Scan(&b)
	if errors.Is(e, sql.ErrNoRows) {
		return uuid.Nil, ErrNotFound
	}
	if e != nil {
		return uuid.Nil, e
	}
	return uuid.FromBytes(b)
}
func (s Store) Review(ctx context.Context, actor, work uuid.UUID, version uint64, in ModerationAction) (ModerationResult, error) {
	if !validModeration(in) || version == 0 || version > MaxSequence || in.AppealID != 0 || (in.Decision != "approve" && in.Decision != "restrict_version" && in.Decision != "restrict_work") {
		return ModerationResult{}, ErrInvalid
	}
	owner, e := s.moderationOwner(ctx, work)
	if e != nil {
		return ModerationResult{}, e
	}
	return s.moderationWrite(ctx, actor, owner, work, "review", struct {
		Work    uuid.UUID
		Version uint64
	}{work, version}, in, func(tx *sql.Tx, now time.Time) (ModerationResult, error) {
		var state string
		var rev, id uint64
		e := tx.QueryRowContext(ctx, "SELECT task_id,state,revision FROM publication_review_tasks WHERE work_id=? AND version=? FOR UPDATE", work[:], version).Scan(&id, &state, &rev)
		if errors.Is(e, sql.ErrNoRows) {
			return ModerationResult{}, ErrNotFound
		}
		if e != nil {
			return ModerationResult{}, e
		}
		if state != "pending" || rev != in.ExpectedRevision || rev >= MaxSequence {
			return ModerationResult{}, ErrReviewConflict
		}
		resultState := "approved"
		if in.Decision != "approve" {
			resultState = "restricted"
			scope := "version"
			if in.Decision == "restrict_work" {
				scope = "work"
			}
			_, e = tx.ExecContext(ctx, "INSERT INTO moderation_cases(owner_id,work_id,version,scope,reason,created_at) VALUES(?,?,?,?,?,?)", owner[:], work[:], version, scope, in.Reason, now)
			if e != nil {
				return ModerationResult{}, e
			}
			if scope == "work" {
				_, e = tx.ExecContext(ctx, "UPDATE works SET platform_limited=TRUE WHERE id=?", work[:])
			} else {
				_, e = tx.ExecContext(ctx, "UPDATE work_versions SET platform_limited=TRUE WHERE work_id=? AND version=?", work[:], version)
			}
			if e != nil {
				return ModerationResult{}, e
			}
		}
		if _, e = tx.ExecContext(ctx, "UPDATE publication_review_tasks SET state=?,revision=revision+1 WHERE work_id=? AND version=?", resultState, work[:], version); e != nil {
			return ModerationResult{}, e
		}
		_, e = tx.ExecContext(ctx, "UPDATE works SET state_revision=state_revision+1 WHERE id=?", work[:])
		return ModerationResult{ID: id, State: resultState, Revision: rev + 1}, e
	})
}

const caseColumns = "id,work_id,version,scope,reason,state,revision,created_at,next_appeal_at"

func scanCase(row interface{ Scan(...any) error }) (ModerationCase, error) {
	var c ModerationCase
	var b []byte
	e := row.Scan(&c.ID, &b, &c.Version, &c.Scope, &c.Reason, &c.State, &c.Revision, &c.CreatedAt, &c.NextAppealAt)
	if errors.Is(e, sql.ErrNoRows) {
		return c, ErrNotFound
	}
	if e != nil {
		return c, e
	}
	c.WorkID, e = uuid.FromBytes(b)
	return c, e
}
func (s Store) caseOwner(ctx context.Context, id uint64) (uuid.UUID, uuid.UUID, error) {
	var o, w []byte
	e := s.DB.QueryRowContext(ctx, "SELECT owner_id,work_id FROM moderation_cases WHERE id=?", id).Scan(&o, &w)
	if errors.Is(e, sql.ErrNoRows) {
		return uuid.Nil, uuid.Nil, ErrNotFound
	}
	if e != nil {
		return uuid.Nil, uuid.Nil, e
	}
	owner, e := uuid.FromBytes(o)
	if e != nil {
		return uuid.Nil, uuid.Nil, e
	}
	work, e := uuid.FromBytes(w)
	return owner, work, e
}
func (s Store) Appeal(ctx context.Context, owner uuid.UUID, id uint64, in ModerationAction) (ModerationResult, error) {
	o, _, e := s.caseOwner(ctx, id)
	if e != nil {
		return ModerationResult{}, e
	}
	if o != owner {
		return ModerationResult{}, ErrNotFound
	}
	in.Decision = "appeal"
	return s.changeCase(ctx, owner, id, in)
}
func (s Store) DecideCase(ctx context.Context, actor uuid.UUID, id uint64, in ModerationAction) (ModerationResult, error) {
	if in.Decision != "uphold" && in.Decision != "revoke" {
		return ModerationResult{}, ErrInvalid
	}
	return s.changeCase(ctx, actor, id, in)
}
func (s Store) changeCase(ctx context.Context, actor uuid.UUID, id uint64, in ModerationAction) (ModerationResult, error) {
	if !validModeration(in) || id == 0 || id > MaxSequence || (in.Decision == "uphold" && in.AppealID == 0) || (in.Decision == "appeal" && in.AppealID != 0) {
		return ModerationResult{}, ErrInvalid
	}
	owner, work, e := s.caseOwner(ctx, id)
	if e != nil {
		return ModerationResult{}, e
	}
	return s.moderationWrite(ctx, actor, owner, work, "case", id, in, func(tx *sql.Tx, now time.Time) (ModerationResult, error) {
		c, e := scanCase(tx.QueryRowContext(ctx, "SELECT "+caseColumns+" FROM moderation_cases WHERE id=? FOR UPDATE", id))
		if e != nil {
			return ModerationResult{}, e
		}
		if c.State != "active" || c.Revision != in.ExpectedRevision || c.Revision >= MaxSequence {
			return ModerationResult{}, ErrReviewConflict
		}
		if in.Decision == "appeal" {
			var pending int
			if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM moderation_appeals WHERE case_id=? AND state='pending'", id).Scan(&pending); e != nil {
				return ModerationResult{}, e
			}
			if pending != 0 {
				return ModerationResult{}, ErrAppealPending
			}
			if c.NextAppealAt != nil && now.Before(*c.NextAppealAt) {
				return ModerationResult{}, ErrAppealCooldown
			}
			res, e := tx.ExecContext(ctx, "INSERT INTO moderation_appeals(case_id,reason,decision_reason,created_at) VALUES(?,?,'',?)", id, in.Reason, now)
			if e != nil {
				return ModerationResult{}, e
			}
			n, e := res.LastInsertId()
			return ModerationResult{ID: uint64(n), State: "pending", Revision: c.Revision}, e
		}
		if in.AppealID != 0 {
			var state string
			e = tx.QueryRowContext(ctx, "SELECT state FROM moderation_appeals WHERE id=? AND case_id=? FOR UPDATE", in.AppealID, id).Scan(&state)
			if errors.Is(e, sql.ErrNoRows) {
				return ModerationResult{}, ErrNotFound
			}
			if e != nil {
				return ModerationResult{}, e
			}
			if state != "pending" {
				return ModerationResult{}, ErrReviewConflict
			}
		}
		if in.Decision == "uphold" {
			next := now.Add(24 * time.Hour)
			if _, e = tx.ExecContext(ctx, "UPDATE moderation_cases SET next_appeal_at=?,revision=revision+1 WHERE id=?", next, id); e != nil {
				return ModerationResult{}, e
			}
			_, e = tx.ExecContext(ctx, "UPDATE moderation_appeals SET state='upheld',decision_reason=?,decided_at=? WHERE id=?", in.Reason, now, in.AppealID)
			return ModerationResult{ID: id, State: "active", Revision: c.Revision + 1}, e
		}
		if _, e = tx.ExecContext(ctx, "UPDATE moderation_cases SET state='revoked',revision=revision+1 WHERE id=?", id); e != nil {
			return ModerationResult{}, e
		}
		if _, e = tx.ExecContext(ctx, "UPDATE moderation_appeals SET state='revoked',decision_reason=?,decided_at=? WHERE case_id=? AND state='pending'", in.Reason, now, id); e != nil {
			return ModerationResult{}, e
		}
		if c.Scope == "work" {
			_, e = tx.ExecContext(ctx, "UPDATE works SET platform_limited=EXISTS(SELECT 1 FROM moderation_cases WHERE work_id=? AND scope='work' AND state='active') WHERE id=?", work[:], work[:])
		} else {
			_, e = tx.ExecContext(ctx, "UPDATE work_versions SET platform_limited=EXISTS(SELECT 1 FROM moderation_cases WHERE work_id=? AND version=? AND scope='version' AND state='active') WHERE work_id=? AND version=?", work[:], c.Version, work[:], c.Version)
		}
		if e != nil {
			return ModerationResult{}, e
		}
		_, e = tx.ExecContext(ctx, "UPDATE works SET state_revision=state_revision+1 WHERE id=?", work[:])
		return ModerationResult{ID: id, State: "revoked", Revision: c.Revision + 1}, e
	})
}
