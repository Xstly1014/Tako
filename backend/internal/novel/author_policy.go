package novel

import (
	"context"
	"database/sql"
	"errors"
	"github.com/google/uuid"
	"strings"
	"time"
)

type AuthorPolicy struct {
	Revision         uint64     `json:"revision"`
	Active           bool       `json:"active"`
	ObservationUntil *time.Time `json:"observation_until"`
	Reason           string     `json:"reason"`
}
type AuthorPolicyEvent struct {
	ContextKind      string     `json:"context_kind"`
	ContextID        uuid.UUID  `json:"context_id"`
	MutationID       uuid.UUID  `json:"mutation_id"`
	Action           string     `json:"action"`
	Revision         uint64     `json:"revision"`
	Reason           string     `json:"reason"`
	PreviousUntil    *time.Time `json:"previous_until"`
	ObservationUntil *time.Time `json:"observation_until"`
	CreatedAt        time.Time  `json:"created_at"`
}
type AuthorPolicyPage struct {
	Policy AuthorPolicy        `json:"policy"`
	Items  []AuthorPolicyEvent `json:"items"`
	Next   uint64              `json:"next"`
}
type AuthorPolicyAction struct {
	MutationID       uuid.UUID `json:"mutation_id"`
	ExpectedRevision uint64    `json:"expected_revision"`
	Action           string    `json:"action"`
	Reason           string    `json:"reason"`
}

func policyOwner(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, owner, book uuid.UUID, kind string) (uuid.UUID, error) {
	var raw []byte
	query := "SELECT owner_id FROM novels WHERE id=?"
	args := []any{book[:]}
	if owner != uuid.Nil {
		query += " AND owner_id=?"
		args = append(args, owner[:])
	} else {
		query = "SELECT owner_id FROM novel_publications WHERE novel_id=?"
		if kind == "work" {
			query = "SELECT owner_id FROM works WHERE id=? AND last_version>0"
		}
	}
	if e := q.QueryRowContext(ctx, query, args...).Scan(&raw); e != nil {
		if errors.Is(e, sql.ErrNoRows) {
			return uuid.Nil, ErrNotFound
		}
		return uuid.Nil, e
	}
	return uuid.FromBytes(raw)
}
func readAuthorPolicy(ctx context.Context, tx *sql.Tx, owner uuid.UUID) (AuthorPolicy, error) {
	var out AuthorPolicy
	e := tx.QueryRowContext(ctx, "SELECT revision,observation_until,reason FROM publication_policies WHERE owner_id=?", owner[:]).Scan(&out.Revision, &out.ObservationUntil, &out.Reason)
	if errors.Is(e, sql.ErrNoRows) {
		return out, nil
	}
	out.Active = out.ObservationUntil != nil && out.ObservationUntil.After(time.Now().UTC())
	return out, e
}

const policyEventColumns = "context_kind,context_id,mutation_id,action,revision,reason,previous_until,observation_until,created_at"

func scanPolicyEvent(row interface{ Scan(...any) error }) (AuthorPolicyEvent, error) {
	var out AuthorPolicyEvent
	var raw, book []byte
	e := row.Scan(&out.ContextKind, &book, &raw, &out.Action, &out.Revision, &out.Reason, &out.PreviousUntil, &out.ObservationUntil, &out.CreatedAt)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	out.ContextID, e = uuid.FromBytes(book)
	if e != nil {
		return out, e
	}
	out.MutationID, e = uuid.FromBytes(raw)
	return out, e
}
func (s Store) authorPolicyFor(ctx context.Context, owner, book uuid.UUID, kind string, before uint64) (AuthorPolicyPage, error) {
	out := AuthorPolicyPage{Items: []AuthorPolicyEvent{}}
	if (book == uuid.Nil && owner == uuid.Nil) || before > maxRevision {
		return out, ErrInvalid
	}
	tx, e := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	actual := owner
	if book != uuid.Nil {
		actual, e = policyOwner(ctx, tx, owner, book, kind)
	}
	if e != nil {
		return out, e
	}
	if out.Policy, e = readAuthorPolicy(ctx, tx, actual); e != nil {
		return out, e
	}
	query := "SELECT " + policyEventColumns + " FROM novel_author_policy_events WHERE owner_id=?"
	args := []any{actual[:]}
	if before > 0 {
		query += " AND revision<?"
		args = append(args, before)
	}
	rows, e := tx.QueryContext(ctx, query+" ORDER BY revision DESC LIMIT 21", args...)
	if e != nil {
		return out, e
	}
	for rows.Next() {
		item, e := scanPolicyEvent(rows)
		if e != nil {
			rows.Close()
			return out, e
		}
		out.Items = append(out.Items, item)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return out, e
	}
	if len(out.Items) > 20 {
		out.Items = out.Items[:20]
		out.Next = out.Items[19].Revision
	}
	return out, tx.Commit()
}
func (s Store) changeAuthorPolicy(ctx context.Context, actor, book uuid.UUID, kind string, in AuthorPolicyAction) (AuthorPolicyEvent, error) {
	var out AuthorPolicyEvent
	if actor == uuid.Nil || book == uuid.Nil || in.MutationID == uuid.Nil || in.ExpectedRevision >= maxRevision || !validText(in.Reason, 2000) || strings.TrimSpace(in.Reason) == "" || (in.Action != "start" && in.Action != "extend" && in.Action != "revoke") {
		return out, ErrInvalid
	}
	owner, e := policyOwner(ctx, s.DB, uuid.Nil, book, kind)
	if e != nil {
		return out, e
	}
	hash := publicationHash("author_observation_"+kind, book, owner, in)
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	if e = lockNovelActors(ctx, tx, owner, actor); e != nil {
		return out, e
	}
	var priorHash, parent, raw []byte
	e = tx.QueryRowContext(ctx, "SELECT payload_hash,context_id,owner_id FROM novel_author_policy_events WHERE actor_id=? AND mutation_id=?", actor[:], in.MutationID[:]).Scan(&priorHash, &parent, &raw)
	if e == nil {
		if string(priorHash) != string(hash[:]) || string(parent) != string(book[:]) || string(raw) != string(owner[:]) {
			return out, ErrKeyReuse
		}
		out, e = scanPolicyEvent(tx.QueryRowContext(ctx, "SELECT "+policyEventColumns+" FROM novel_author_policy_events WHERE actor_id=? AND mutation_id=?", actor[:], in.MutationID[:]))
		if e != nil {
			return out, e
		}
		return out, tx.Commit()
	}
	if !errors.Is(e, sql.ErrNoRows) {
		return out, e
	}
	current, e := readAuthorPolicy(ctx, tx, owner)
	if e != nil {
		return out, e
	}
	if current.Revision != in.ExpectedRevision || (in.Action == "start" && current.Active) || (in.Action != "start" && !current.Active) {
		return out, ErrStateConflict
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	out = AuthorPolicyEvent{ContextKind: kind, ContextID: book, MutationID: in.MutationID, Action: in.Action, Revision: current.Revision + 1, Reason: in.Reason, PreviousUntil: current.ObservationUntil, CreatedAt: now}
	if in.Action != "revoke" {
		base := now
		if in.Action == "extend" {
			base = *current.ObservationUntil
		}
		until := base.Add(7 * 24 * time.Hour)
		if until.Year() > 9999 {
			return out, ErrInvalid
		}
		out.ObservationUntil = &until
	}
	if _, e = tx.ExecContext(ctx, "INSERT INTO publication_policies(owner_id,revision,observation_until,reason) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE revision=VALUES(revision),observation_until=VALUES(observation_until),reason=VALUES(reason)", owner[:], out.Revision, out.ObservationUntil, out.Reason); e != nil {
		return out, e
	}
	if _, e = tx.ExecContext(ctx, "INSERT INTO novel_author_policy_events(owner_id,revision,actor_id,mutation_id,context_id,context_kind,action,reason,previous_until,observation_until,created_at,payload_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", owner[:], out.Revision, actor[:], in.MutationID[:], book[:], kind, out.Action, out.Reason, out.PreviousUntil, out.ObservationUntil, out.CreatedAt, hash[:]); e != nil {
		return out, e
	}
	return out, tx.Commit()
}
func (s Store) authorPolicyReceipt(ctx context.Context, actor, book, mutation uuid.UUID, kind string) (AuthorPolicyEvent, error) {
	return scanPolicyEvent(s.DB.QueryRowContext(ctx, "SELECT "+policyEventColumns+" FROM novel_author_policy_events WHERE actor_id=? AND context_id=? AND context_kind=? AND mutation_id=?", actor[:], book[:], kind, mutation[:]))
}

// The immutable event is the original operation result, not a projection of today's policy.

func (s Store) AuthorPolicyFor(ctx context.Context, owner, book uuid.UUID, before uint64) (AuthorPolicyPage, error) {
	return s.authorPolicyFor(ctx, owner, book, "novel", before)
}
func (s Store) AuthorPolicyForContext(ctx context.Context, owner, id uuid.UUID, kind string, before uint64) (AuthorPolicyPage, error) {
	if kind != "novel" && kind != "work" {
		return AuthorPolicyPage{}, ErrInvalid
	}
	return s.authorPolicyFor(ctx, owner, id, kind, before)
}
func (s Store) ChangeAuthorPolicy(ctx context.Context, actor, book uuid.UUID, in AuthorPolicyAction) (AuthorPolicyEvent, error) {
	return s.changeAuthorPolicy(ctx, actor, book, "novel", in)
}
func (s Store) ChangeAuthorPolicyForContext(ctx context.Context, actor, id uuid.UUID, kind string, in AuthorPolicyAction) (AuthorPolicyEvent, error) {
	if kind != "novel" && kind != "work" {
		return AuthorPolicyEvent{}, ErrInvalid
	}
	return s.changeAuthorPolicy(ctx, actor, id, kind, in)
}
func (s Store) AuthorPolicyReceipt(ctx context.Context, actor, book, mutation uuid.UUID) (AuthorPolicyEvent, error) {
	return s.authorPolicyReceipt(ctx, actor, book, mutation, "novel")
}
func (s Store) AuthorPolicyReceiptForContext(ctx context.Context, actor, id, mutation uuid.UUID, kind string) (AuthorPolicyEvent, error) {
	if kind != "novel" && kind != "work" {
		return AuthorPolicyEvent{}, ErrInvalid
	}
	return s.authorPolicyReceipt(ctx, actor, id, mutation, kind)
}
