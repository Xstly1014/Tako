package novel

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"time"
)

var ErrCompletionExpired = errors.New("completion_check_expired")

type LifecycleReceipt struct {
	MutationID uuid.UUID `json:"mutation_id"`
	Operation  string    `json:"operation"`
	NovelID    uuid.UUID `json:"novel_id"`
	TargetID   uuid.UUID `json:"target_id"`
	State      string    `json:"state"`
	Revision   uint64    `json:"revision"`
	Version    uint64    `json:"version"`
	AcceptedAt time.Time `json:"accepted_at"`
}
type CompletionCheck struct {
	ID                  uuid.UUID  `json:"id"`
	NovelID             uuid.UUID  `json:"novel_id"`
	StateRevision       uint64     `json:"state_revision"`
	FormalChapters      uint64     `json:"formal_chapters"`
	LastFormalChapter   *uuid.UUID `json:"last_formal_chapter"`
	LastFormalOrdinal   uint64     `json:"last_formal_ordinal"`
	LastReservedOrdinal uint64     `json:"last_reserved_ordinal"`
	HiddenChapters      uint64     `json:"hidden_chapters"`
	RestrictedChapters  uint64     `json:"restricted_chapters"`
	PendingChapters     uint64     `json:"pending_chapters"`
	UnpublishedDrafts   uint64     `json:"unpublished_drafts"`
	AuthorHidden        bool       `json:"author_hidden"`
	PlatformLimited     bool       `json:"platform_limited"`
	Completed           bool       `json:"completed"`
	Eligible            bool       `json:"eligible"`
	ExpiresAt           time.Time  `json:"expires_at"`
}
type PrepareCompletion struct {
	MutationID uuid.UUID `json:"mutation_id"`
}
type ConfirmCompletion struct {
	MutationID            uuid.UUID `json:"mutation_id"`
	CheckID               uuid.UUID `json:"check_id"`
	IrreversibleConfirmed bool      `json:"irreversible_confirmed"`
}

// The caller holds the owner and book locks shared by every public transition.
// A private draft's text/revision is deliberately excluded from this public-state
// fingerprint: typing is not publication and drafts are never consumed here.
func completionSnapshot(ctx context.Context, tx *sql.Tx, owner, book uuid.UUID) (CompletionCheck, [32]byte, error) {
	out := CompletionCheck{NovelID: book}
	state, err := readNovelState(ctx, tx, owner, book)
	if err != nil {
		return out, [32]byte{}, err
	}
	out.StateRevision = state.StateRevision
	out.AuthorHidden = state.AuthorHidden
	out.PlatformLimited = state.PlatformLimited
	out.Completed = state.Completed
	out.LastReservedOrdinal = state.LastPosition
	type chapterState struct {
		ID                              uuid.UUID
		Ordinal                         sql.NullInt64
		Last, Display, Revision         uint64
		Hidden, Limited, VersionLimited bool
		Pending                         []byte
	}
	chapters := []chapterState{}
	rows, err := tx.QueryContext(ctx, `SELECT c.id,c.ordinal,c.last_version,c.display_version,c.state_revision,c.author_hidden,c.platform_limited,COALESCE(v.platform_limited,FALSE),c.current_submission_id FROM novel_chapters c LEFT JOIN chapter_versions v ON v.chapter_id=c.id AND v.version=c.display_version WHERE c.novel_id=? AND c.owner_id=? ORDER BY c.id`, book[:], owner[:])
	if err != nil {
		return out, [32]byte{}, err
	}
	for rows.Next() {
		var c chapterState
		var id []byte
		if err = rows.Scan(&id, &c.Ordinal, &c.Last, &c.Display, &c.Revision, &c.Hidden, &c.Limited, &c.VersionLimited, &c.Pending); err != nil {
			rows.Close()
			return out, [32]byte{}, err
		}
		c.ID, err = uuid.FromBytes(id)
		if err != nil {
			rows.Close()
			return out, [32]byte{}, err
		}
		chapters = append(chapters, c)
		if c.Last > 0 {
			out.FormalChapters++
			if c.Hidden {
				out.HiddenChapters++
			}
			if c.Limited || c.VersionLimited {
				out.RestrictedChapters++
			}
			if c.Ordinal.Valid && uint64(c.Ordinal.Int64) > out.LastFormalOrdinal {
				id := c.ID
				out.LastFormalChapter = &id
				out.LastFormalOrdinal = uint64(c.Ordinal.Int64)
			}
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, [32]byte{}, err
	}
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM chapter_submissions WHERE novel_id=? AND owner_id=? AND state='pending'", book[:], owner[:]).Scan(&out.PendingChapters); err != nil {
		return out, [32]byte{}, err
	}
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM chapter_drafts d JOIN novel_chapters c ON c.id=d.chapter_id AND c.novel_id=d.novel_id WHERE d.novel_id=? AND d.owner_id=? AND c.last_version=0`, book[:], owner[:]).Scan(&out.UnpublishedDrafts); err != nil {
		return out, [32]byte{}, err
	}
	out.Eligible = !out.Completed && out.FormalChapters > 0 && out.PendingChapters == 0
	raw, _ := json.Marshal(struct {
		State    NovelState
		Chapters []chapterState
		Pending  uint64
	}{state, chapters, out.PendingChapters})
	return out, sha256.Sum256(raw), nil
}
func (s Store) PrepareCompletion(ctx context.Context, owner, book uuid.UUID, in PrepareCompletion) (LifecycleReceipt, error) {
	var out LifecycleReceipt
	if owner == uuid.Nil || book == uuid.Nil || in.MutationID == uuid.Nil {
		return out, ErrInvalid
	}
	hash := publicationHash("completion_check", book, book, in)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = lockAccount(ctx, tx, owner, false); err != nil {
		return out, err
	}
	if found, e := managementRetry(ctx, tx, owner, book, in.MutationID, hash, &out); e != nil || found {
		if e != nil {
			return out, e
		}
		return out, tx.Commit()
	}
	if _, err = lockPublicationBook(ctx, tx, owner, book); err != nil {
		return out, err
	}
	var recent int
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM novel_completion_checks WHERE owner_id=? AND created_at>UTC_TIMESTAMP(6)-INTERVAL 1 HOUR", owner[:]).Scan(&recent); err != nil {
		return out, err
	}
	if recent >= 100 {
		return out, ErrPublicationLimited
	}
	summary, fingerprint, err := completionSnapshot(ctx, tx, owner, book)
	if err != nil {
		return out, err
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	summary.ID = uuid.New()
	summary.ExpiresAt = now.Add(24 * time.Hour)
	raw, _ := json.Marshal(summary)
	if _, err = tx.ExecContext(ctx, "INSERT INTO novel_completion_checks(id,novel_id,owner_id,snapshot,fingerprint,expires_at) VALUES(?,?,?,?,?,?)", summary.ID[:], book[:], owner[:], raw, fingerprint[:], summary.ExpiresAt); err != nil {
		return out, err
	}
	out = LifecycleReceipt{in.MutationID, "completion_check", book, summary.ID, "prepared", summary.StateRevision, 0, now}
	if err = saveManagement(ctx, tx, owner, book, in.MutationID, hash, out); err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func (s Store) CompletionCheck(ctx context.Context, owner, book, id uuid.UUID) (CompletionCheck, error) {
	var out CompletionCheck
	var raw []byte
	var expires time.Time
	err := s.DB.QueryRowContext(ctx, "SELECT snapshot,expires_at FROM novel_completion_checks WHERE id=? AND novel_id=? AND owner_id=?", id[:], book[:], owner[:]).Scan(&raw, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	if !time.Now().UTC().Before(expires) {
		return out, ErrCompletionExpired
	}
	err = json.Unmarshal(raw, &out)
	return out, err
}
func (s Store) ConfirmCompletion(ctx context.Context, owner, book uuid.UUID, in ConfirmCompletion) (LifecycleReceipt, error) {
	var out LifecycleReceipt
	if owner == uuid.Nil || book == uuid.Nil || in.MutationID == uuid.Nil || in.CheckID == uuid.Nil || !in.IrreversibleConfirmed {
		return out, ErrInvalid
	}
	hash := publicationHash("complete", book, in.CheckID, in)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = lockAccount(ctx, tx, owner, false); err != nil {
		return out, err
	}
	if found, e := managementRetry(ctx, tx, owner, book, in.MutationID, hash, &out); e != nil || found {
		if e != nil {
			return out, e
		}
		return out, tx.Commit()
	}
	if _, err = lockPublicationBook(ctx, tx, owner, book); err != nil {
		return out, err
	}
	var previous []byte
	var expires time.Time
	err = tx.QueryRowContext(ctx, "SELECT fingerprint,expires_at FROM novel_completion_checks WHERE id=? AND novel_id=? AND owner_id=?", in.CheckID[:], book[:], owner[:]).Scan(&previous, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	if !time.Now().UTC().Before(expires) {
		return out, ErrCompletionExpired
	}
	summary, fingerprint, err := completionSnapshot(ctx, tx, owner, book)
	if err != nil {
		return out, err
	}
	if !summary.Eligible || summary.StateRevision >= maxRevision || string(previous) != string(fingerprint[:]) {
		return out, ErrStateConflict
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	if _, err = tx.ExecContext(ctx, "UPDATE novels SET completed_at=?,state_revision=state_revision+1 WHERE id=?", now, book[:]); err != nil {
		return out, err
	}
	out = LifecycleReceipt{in.MutationID, "complete", book, in.CheckID, "completed", summary.StateRevision + 1, 0, now}
	if err = saveManagement(ctx, tx, owner, book, in.MutationID, hash, out); err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func (s Store) LifecycleReceipt(ctx context.Context, actor, book, mutation uuid.UUID) (LifecycleReceipt, error) {
	var out LifecycleReceipt
	var raw []byte
	err := s.DB.QueryRowContext(ctx, "SELECT result FROM novel_management_requests WHERE actor_id=? AND novel_id=? AND mutation_id=?", actor[:], book[:], mutation[:]).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	if err = json.Unmarshal(raw, &out); err != nil {
		return out, err
	}
	switch out.Operation {
	case "completion_check", "complete", "rectification_grant", "rectification_prepare", "rectification_submit", "rectification_cancel", "rectification_withdraw", "rectification_approve", "rectification_reject":
		return out, nil
	default:
		return LifecycleReceipt{}, ErrNotFound
	}
}
