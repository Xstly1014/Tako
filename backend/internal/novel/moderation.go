package novel

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"strings"
	"time"
)

var ErrAppealPending = errors.New("appeal_pending")
var ErrAppealCooldown = errors.New("appeal_cooldown")

type LimitNovel struct {
	MutationID       uuid.UUID  `json:"mutation_id"`
	Scope            string     `json:"scope"`
	ChapterID        *uuid.UUID `json:"chapter_id"`
	Version          uint64     `json:"version"`
	ExpectedRevision uint64     `json:"expected_revision"`
	Reason           string     `json:"reason"`
}
type NovelCaseAction struct {
	MutationID       uuid.UUID `json:"mutation_id"`
	ExpectedRevision uint64    `json:"expected_revision"`
	Decision         string    `json:"decision"`
	Reason           string    `json:"reason"`
	AppealID         uint64    `json:"appeal_id"`
}
type NovelCaseResult struct {
	Operation string    `json:"operation"`
	NovelID   uuid.UUID `json:"novel_id"`
	CaseID    uint64    `json:"case_id"`
	ID        uint64    `json:"id"`
	State     string    `json:"state"`
	Revision  uint64    `json:"revision"`
}
type NovelCase struct {
	ID             uint64     `json:"id"`
	NovelID        uuid.UUID  `json:"novel_id"`
	TargetID       uuid.UUID  `json:"target_id"`
	Scope          string     `json:"scope"`
	Version        uint64     `json:"version"`
	Reason         string     `json:"reason"`
	State          string     `json:"state"`
	Revision       uint64     `json:"revision"`
	CreatedAt      time.Time  `json:"created_at"`
	NextAppealAt   *time.Time `json:"next_appeal_at"`
	DecisionReason string     `json:"decision_reason"`
}
type NovelAppeal struct {
	NovelID        uuid.UUID  `json:"novel_id"`
	ID             uint64     `json:"id"`
	CaseID         uint64     `json:"case_id"`
	Reason         string     `json:"reason"`
	State          string     `json:"state"`
	DecisionReason string     `json:"decision_reason"`
	CreatedAt      time.Time  `json:"created_at"`
	DecidedAt      *time.Time `json:"decided_at"`
}
type NovelCasePage struct {
	Items []NovelCase `json:"items"`
	Next  uint64      `json:"next"`
}
type NovelAppealPage struct {
	Items []NovelAppeal `json:"items"`
	Next  uint64        `json:"next"`
}
type NovelCaseDetail struct {
	Case    NovelCase       `json:"case"`
	Appeals NovelAppealPage `json:"appeals"`
}

func lockNovelActors(ctx context.Context, tx *sql.Tx, owner, actor uuid.UUID) error {
	first, second := owner, actor
	if bytes.Compare(first[:], second[:]) > 0 {
		first, second = second, first
	}
	if err := lockAccount(ctx, tx, first, false); err != nil {
		return err
	}
	if first != second {
		return lockAccount(ctx, tx, second, false)
	}
	return nil
}
func (s Store) formalOwner(ctx context.Context, book uuid.UUID) (uuid.UUID, error) {
	var raw []byte
	err := s.DB.QueryRowContext(ctx, "SELECT owner_id FROM novel_publications WHERE novel_id=?", book[:]).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return uuid.Nil, ErrNotFound
	}
	if err != nil {
		return uuid.Nil, err
	}
	return uuid.FromBytes(raw)
}
func (s Store) LimitNovel(ctx context.Context, actor, book uuid.UUID, in LimitNovel) (NovelCaseResult, error) {
	var out NovelCaseResult
	if actor == uuid.Nil || book == uuid.Nil || in.MutationID == uuid.Nil || in.ExpectedRevision == 0 || in.ExpectedRevision >= maxRevision || !validText(in.Reason, 2000) || strings.TrimSpace(in.Reason) == "" {
		return out, ErrInvalid
	}
	target := book
	switch in.Scope {
	case "book":
		if in.ChapterID != nil || in.Version != 0 {
			return out, ErrInvalid
		}
	case "chapter", "version":
		if in.ChapterID == nil || *in.ChapterID == uuid.Nil {
			return out, ErrInvalid
		}
		target = *in.ChapterID
		if (in.Scope == "chapter" && in.Version != 0) || (in.Scope == "version" && (in.Version == 0 || in.Version > maxRevision)) {
			return out, ErrInvalid
		}
	default:
		return out, ErrInvalid
	}
	owner, err := s.formalOwner(ctx, book)
	if err != nil {
		return out, err
	}
	hash := publicationHash("novel_limit", book, target, in)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = lockNovelActors(ctx, tx, owner, actor); err != nil {
		return out, err
	}
	if found, e := managementRetry(ctx, tx, actor, book, in.MutationID, hash, &out); e != nil || found {
		if e != nil {
			return out, e
		}
		return out, tx.Commit()
	}
	if _, err = lockPublicationBook(ctx, tx, owner, book); err != nil {
		return out, err
	}
	var revision uint64
	var limited bool
	if in.Scope == "book" {
		err = tx.QueryRowContext(ctx, "SELECT state_revision,platform_limited FROM novels WHERE id=?", book[:]).Scan(&revision, &limited)
	} else {
		c, e := lockPublicationChapter(ctx, tx, owner, book, target)
		if e != nil {
			return out, e
		}
		if c.last == 0 {
			return out, ErrNotFound
		}
		err = tx.QueryRowContext(ctx, "SELECT state_revision,platform_limited FROM novel_chapters WHERE id=?", target[:]).Scan(&revision, &limited)
		if err == nil && in.Scope == "version" {
			err = tx.QueryRowContext(ctx, "SELECT platform_limited FROM chapter_versions WHERE chapter_id=? AND novel_id=? AND version=?", target[:], book[:], in.Version).Scan(&limited)
			if errors.Is(err, sql.ErrNoRows) {
				return out, ErrNotFound
			}
		}
	}
	if err != nil {
		return out, err
	}
	if limited || revision != in.ExpectedRevision {
		return out, ErrStateConflict
	}
	result, err := tx.ExecContext(ctx, "INSERT INTO novel_moderation_cases(novel_id,owner_id,target_id,scope,version,reason,actor_id) VALUES(?,?,?,?,?,?,?)", book[:], owner[:], target[:], in.Scope, in.Version, in.Reason, actor[:])
	if err != nil {
		return out, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return out, err
	}
	if id <= 0 || uint64(id) > maxRevision {
		return out, ErrStateConflict
	}
	if err = setNovelRestriction(ctx, tx, book, target, in.Scope, in.Version, true); err != nil {
		return out, err
	}
	// A precise version restriction is also a completed post-review of that
	// exact text. Book/whole-chapter restrictions do not certify other tasks.
	if in.Scope == "version" {
		if _, err = tx.ExecContext(ctx, "UPDATE chapter_post_review_tasks SET reviewed_at=UTC_TIMESTAMP(6),reviewed_by=? WHERE chapter_id=? AND novel_id=? AND version=? AND reviewed_at IS NULL", actor[:], target[:], book[:], in.Version); err != nil {
			return out, err
		}
	}
	out = NovelCaseResult{Operation: "limit", NovelID: book, CaseID: uint64(id), ID: uint64(id), State: "active", Revision: 1}
	if err = saveManagement(ctx, tx, actor, book, in.MutationID, hash, out); err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func setNovelRestriction(ctx context.Context, tx *sql.Tx, book, target uuid.UUID, scope string, version uint64, limited bool) error {
	changed := func(q string, args ...any) error {
		result, e := tx.ExecContext(ctx, q, args...)
		if e != nil {
			return e
		}
		n, e := result.RowsAffected()
		if e != nil {
			return e
		}
		if n != 1 {
			return ErrStateConflict
		}
		return nil
	}
	if scope == "book" {
		return changed("UPDATE novels SET platform_limited=?,state_revision=state_revision+1 WHERE id=? AND state_revision<?", limited, book[:], maxRevision)
	}
	if scope == "chapter" {
		return changed("UPDATE novel_chapters SET platform_limited=?,state_revision=state_revision+1 WHERE id=? AND novel_id=? AND state_revision<?", limited, target[:], book[:], maxRevision)
	}
	if _, err := tx.ExecContext(ctx, "UPDATE chapter_versions SET platform_limited=? WHERE chapter_id=? AND novel_id=? AND version=?", limited, target[:], book[:], version); err != nil {
		return err
	}
	return changed("UPDATE novel_chapters SET state_revision=state_revision+1 WHERE id=? AND novel_id=? AND state_revision<?", target[:], book[:], maxRevision)
}

const novelCaseColumns = "id,novel_id,target_id,scope,version,reason,state,revision,created_at,next_appeal_at,decision_reason"

func scanNovelCase(row interface{ Scan(...any) error }) (NovelCase, error) {
	var out NovelCase
	var book, target []byte
	err := row.Scan(&out.ID, &book, &target, &out.Scope, &out.Version, &out.Reason, &out.State, &out.Revision, &out.CreatedAt, &out.NextAppealAt, &out.DecisionReason)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	out.NovelID, err = uuid.FromBytes(book)
	if err != nil {
		return out, err
	}
	out.TargetID, err = uuid.FromBytes(target)
	return out, err
}
func (s Store) caseOwner(ctx context.Context, book uuid.UUID, id uint64) (uuid.UUID, error) {
	var raw []byte
	err := s.DB.QueryRowContext(ctx, "SELECT owner_id FROM novel_moderation_cases WHERE novel_id=? AND id=?", book[:], id).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return uuid.Nil, ErrNotFound
	}
	if err != nil {
		return uuid.Nil, err
	}
	return uuid.FromBytes(raw)
}
func (s Store) AppealNovelCase(ctx context.Context, owner, book uuid.UUID, id uint64, in NovelCaseAction) (NovelCaseResult, error) {
	actual, err := s.caseOwner(ctx, book, id)
	if err != nil {
		return NovelCaseResult{}, err
	}
	if actual != owner {
		return NovelCaseResult{}, ErrNotFound
	}
	in.Decision = "appeal"
	return s.changeNovelCase(ctx, owner, owner, book, id, in)
}
func (s Store) DecideNovelCase(ctx context.Context, actor, book uuid.UUID, id uint64, in NovelCaseAction) (NovelCaseResult, error) {
	if in.Decision != "uphold" && in.Decision != "revoke" {
		return NovelCaseResult{}, ErrInvalid
	}
	owner, err := s.caseOwner(ctx, book, id)
	if err != nil {
		return NovelCaseResult{}, err
	}
	return s.changeNovelCase(ctx, actor, owner, book, id, in)
}
func (s Store) changeNovelCase(ctx context.Context, actor, owner, book uuid.UUID, id uint64, in NovelCaseAction) (NovelCaseResult, error) {
	var out NovelCaseResult
	if id == 0 || id > maxRevision || in.MutationID == uuid.Nil || in.ExpectedRevision == 0 || in.ExpectedRevision >= maxRevision || in.AppealID > maxRevision || !validText(in.Reason, 2000) || strings.TrimSpace(in.Reason) == "" || (in.Decision == "uphold" && in.AppealID == 0) || (in.Decision == "appeal" && in.AppealID != 0) {
		return out, ErrInvalid
	}
	hash := publicationHash("novel_case_action", book, book, struct {
		ID    uint64
		Input NovelCaseAction
	}{id, in})
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = lockNovelActors(ctx, tx, owner, actor); err != nil {
		return out, err
	}
	if found, e := managementRetry(ctx, tx, actor, book, in.MutationID, hash, &out); e != nil || found {
		if e != nil {
			return out, e
		}
		return out, tx.Commit()
	}
	if _, err = lockPublicationBook(ctx, tx, owner, book); err != nil {
		return out, err
	}
	item, err := scanNovelCase(tx.QueryRowContext(ctx, "SELECT "+novelCaseColumns+" FROM novel_moderation_cases WHERE id=? AND novel_id=? FOR UPDATE", id, book[:]))
	if err != nil {
		return out, err
	}
	if item.State != "active" || item.Revision != in.ExpectedRevision {
		return out, ErrStateConflict
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	if in.Decision == "appeal" {
		var n int
		if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM novel_moderation_appeals WHERE case_id=? AND state='pending'", id).Scan(&n); err != nil {
			return out, err
		}
		if n != 0 {
			return out, ErrAppealPending
		}
		if item.NextAppealAt != nil && now.Before(*item.NextAppealAt) {
			return out, ErrAppealCooldown
		}
		result, e := tx.ExecContext(ctx, "INSERT INTO novel_moderation_appeals(case_id,reason) VALUES(?,?)", id, in.Reason)
		if e != nil {
			return out, e
		}
		nID, e := result.LastInsertId()
		if e != nil {
			return out, e
		}
		if nID <= 0 || uint64(nID) > maxRevision {
			return out, ErrStateConflict
		}
		out = NovelCaseResult{Operation: "appeal", NovelID: book, CaseID: id, ID: uint64(nID), State: "pending", Revision: item.Revision}
	} else {
		if in.AppealID != 0 {
			var state string
			err = tx.QueryRowContext(ctx, "SELECT state FROM novel_moderation_appeals WHERE case_id=? AND id=? FOR UPDATE", id, in.AppealID).Scan(&state)
			if errors.Is(err, sql.ErrNoRows) {
				return out, ErrNotFound
			}
			if err != nil {
				return out, err
			}
			if state != "pending" {
				return out, ErrStateConflict
			}
		}
		if in.Decision == "uphold" {
			if _, err = tx.ExecContext(ctx, "UPDATE novel_moderation_appeals SET state='upheld',pending_slot=NULL,decision_reason=?,decided_at=? WHERE id=?", in.Reason, now, in.AppealID); err != nil {
				return out, err
			}
			if _, err = tx.ExecContext(ctx, "UPDATE novel_moderation_cases SET next_appeal_at=?,revision=revision+1,decision_reason=?,actor_id=? WHERE id=?", now.Add(24*time.Hour), in.Reason, actor[:], id); err != nil {
				return out, err
			}
			out = NovelCaseResult{Operation: "uphold", NovelID: book, CaseID: id, ID: id, State: "active", Revision: item.Revision + 1}
		} else {
			if _, err = tx.ExecContext(ctx, "UPDATE novel_moderation_cases SET state='revoked',active_slot=NULL,revision=revision+1,decision_reason=?,actor_id=? WHERE id=?", in.Reason, actor[:], id); err != nil {
				return out, err
			}
			if _, err = tx.ExecContext(ctx, "UPDATE novel_moderation_appeals SET state='revoked',pending_slot=NULL,decision_reason=?,decided_at=? WHERE case_id=? AND state='pending'", in.Reason, now, id); err != nil {
				return out, err
			}
			if err = setNovelRestriction(ctx, tx, book, item.TargetID, item.Scope, item.Version, false); err != nil {
				return out, err
			}
			out = NovelCaseResult{Operation: "revoke", NovelID: book, CaseID: id, ID: id, State: "revoked", Revision: item.Revision + 1}
		}
	}
	if err = saveManagement(ctx, tx, actor, book, in.MutationID, hash, out); err != nil {
		return out, err
	}
	return out, tx.Commit()
}

func (s Store) NovelCases(ctx context.Context, owner, book uuid.UUID, before uint64, state string) (NovelCasePage, error) {
	out := NovelCasePage{Items: []NovelCase{}}
	if before > maxRevision || (state != "" && state != "all" && state != "active" && state != "revoked") {
		return out, ErrInvalid
	}
	q := "SELECT " + novelCaseColumns + " FROM novel_moderation_cases WHERE 1=1"
	args := []any{}
	if owner != uuid.Nil {
		if _, err := s.Read(ctx, owner, book); err != nil {
			return out, err
		}
		q += " AND owner_id=? AND novel_id=?"
		args = append(args, owner[:], book[:])
	} else if book != uuid.Nil {
		q += " AND novel_id=?"
		args = append(args, book[:])
	}
	if state != "" && state != "all" {
		q += " AND state=?"
		args = append(args, state)
	}
	if before > 0 {
		q += " AND id<?"
		args = append(args, before)
	}
	rows, err := s.DB.QueryContext(ctx, q+" ORDER BY id DESC LIMIT 21", args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		item, e := scanNovelCase(rows)
		if e != nil {
			return out, e
		}
		out.Items = append(out.Items, item)
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	if len(out.Items) > 20 {
		out.Items = out.Items[:20]
		out.Next = out.Items[19].ID
	}
	return out, nil
}
func (s Store) NovelCaseDetail(ctx context.Context, owner, book uuid.UUID, id, before uint64) (NovelCaseDetail, error) {
	var out NovelCaseDetail
	if id == 0 || id > maxRevision || before > maxRevision {
		return out, ErrInvalid
	}
	// One read view keeps case revision and appeal decisions consistent.
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	q := "SELECT " + novelCaseColumns + " FROM novel_moderation_cases WHERE id=? AND novel_id=?"
	args := []any{id, book[:]}
	if owner != uuid.Nil {
		q += " AND owner_id=?"
		args = append(args, owner[:])
	}
	out.Case, err = scanNovelCase(tx.QueryRowContext(ctx, q, args...))
	if err != nil {
		return out, err
	}
	out.Appeals.Items = []NovelAppeal{}
	q = "SELECT id,case_id,reason,state,decision_reason,created_at,decided_at FROM novel_moderation_appeals WHERE case_id=?"
	args = []any{id}
	if before > 0 {
		q += " AND id<?"
		args = append(args, before)
	}
	rows, err := tx.QueryContext(ctx, q+" ORDER BY id DESC LIMIT 21", args...)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var item NovelAppeal
		item.NovelID = book
		if err = rows.Scan(&item.ID, &item.CaseID, &item.Reason, &item.State, &item.DecisionReason, &item.CreatedAt, &item.DecidedAt); err != nil {
			rows.Close()
			return out, err
		}
		out.Appeals.Items = append(out.Appeals.Items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	if len(out.Appeals.Items) > 20 {
		out.Appeals.Items = out.Appeals.Items[:20]
		out.Appeals.Next = out.Appeals.Items[19].ID
	}
	return out, tx.Commit()
}
func (s Store) NovelPendingAppeals(ctx context.Context, after uint64) (NovelAppealPage, error) {
	out := NovelAppealPage{Items: []NovelAppeal{}}
	if after > maxRevision {
		return out, ErrInvalid
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT a.id,a.case_id,c.novel_id,a.reason,a.state,a.decision_reason,a.created_at,a.decided_at FROM novel_moderation_appeals a JOIN novel_moderation_cases c ON c.id=a.case_id WHERE a.state='pending' AND c.state='active' AND a.id>? ORDER BY a.id LIMIT 21`, after)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var item NovelAppeal
		var raw []byte
		if err = rows.Scan(&item.ID, &item.CaseID, &raw, &item.Reason, &item.State, &item.DecisionReason, &item.CreatedAt, &item.DecidedAt); err != nil {
			return out, err
		}
		item.NovelID, err = uuid.FromBytes(raw)
		if err != nil {
			return out, err
		}
		out.Items = append(out.Items, item)
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	if len(out.Items) > 20 {
		out.Items = out.Items[:20]
		out.Next = out.Items[19].ID
	}
	return out, nil
}
func (s Store) NovelCaseReceipt(ctx context.Context, actor, book, mutation uuid.UUID) (NovelCaseResult, error) {
	var out NovelCaseResult
	var raw []byte
	err := s.DB.QueryRowContext(ctx, "SELECT result FROM novel_management_requests WHERE actor_id=? AND novel_id=? AND mutation_id=?", actor[:], book[:], mutation[:]).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	var tag struct {
		Operation string `json:"operation"`
	}
	if err = json.Unmarshal(raw, &tag); err != nil {
		return out, err
	}
	if tag.Operation != "limit" && tag.Operation != "appeal" && tag.Operation != "uphold" && tag.Operation != "revoke" {
		return out, ErrNotFound
	}
	err = json.Unmarshal(raw, &out)
	return out, err
}
