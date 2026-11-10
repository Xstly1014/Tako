package novel

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

type GrantRectification struct {
	MutationID   uuid.UUID `json:"mutation_id"`
	ChapterID    uuid.UUID `json:"chapter_id"`
	BaseVersion  uint64    `json:"base_version"`
	CaseID       uint64    `json:"case_id"`
	CaseRevision uint64    `json:"case_revision"`
	Reason       string    `json:"reason"`
}
type RectificationAction struct {
	MutationID       uuid.UUID `json:"mutation_id"`
	ExpectedRevision uint64    `json:"expected_revision"`
	Reason           string    `json:"reason"`
	RevokeCase       bool      `json:"revoke_case"`
}
type PrepareRectification struct {
	MutationID       uuid.UUID `json:"mutation_id"`
	ExpectedRevision uint64    `json:"expected_revision"`
	DraftID          uuid.UUID `json:"draft_id"`
	SourceRevision   uint64    `json:"source_revision"`
}
type SubmitRectification struct {
	MutationID       uuid.UUID `json:"mutation_id"`
	ExpectedRevision uint64    `json:"expected_revision"`
	PreviewID        uuid.UUID `json:"preview_id"`
	RightsConfirmed  bool      `json:"rights_confirmed"`
}
type Rectification struct {
	ID               uuid.UUID  `json:"id"`
	NovelID          uuid.UUID  `json:"novel_id"`
	ChapterID        uuid.UUID  `json:"chapter_id"`
	CaseID           uint64     `json:"case_id"`
	CaseRevision     uint64     `json:"case_revision"`
	BaseVersion      uint64     `json:"base_version"`
	Revision         uint64     `json:"revision"`
	State            string     `json:"state"`
	Reason           string     `json:"reason"`
	DecisionReason   string     `json:"decision_reason"`
	PreviewID        *uuid.UUID `json:"preview_id"`
	CreatedAt        time.Time  `json:"created_at"`
	SubmittedAt      *time.Time `json:"submitted_at"`
	DecidedAt        *time.Time `json:"decided_at"`
	PublishedVersion uint64     `json:"published_version"`
	RevokedCase      bool       `json:"revoked_case"`
	TargetCurrent    bool       `json:"target_current"`
}
type RectificationPreview struct {
	ID             uuid.UUID `json:"id"`
	GrantID        uuid.UUID `json:"grant_id"`
	NovelID        uuid.UUID `json:"novel_id"`
	ChapterID      uuid.UUID `json:"chapter_id"`
	BaseVersion    uint64    `json:"base_version"`
	GrantRevision  uint64    `json:"grant_revision"`
	DraftID        uuid.UUID `json:"draft_id"`
	SourceRevision uint64    `json:"source_revision"`
	Title          string    `json:"title"`
	Content        string    `json:"content"`
	ExpiresAt      time.Time `json:"expires_at"`
}
type RectificationDetail struct {
	Grant     Rectification         `json:"grant"`
	Submitted *RectificationPreview `json:"submitted"`
	Source    *RectificationSource  `json:"source"`
}

// Author-only current source metadata. Never projected to operators.
type RectificationSource struct {
	DraftID  uuid.UUID `json:"draft_id"`
	Title    string    `json:"title"`
	Revision uint64    `json:"revision"`
}
type RectificationPage struct {
	Items []Rectification `json:"items"`
	Next  uint64          `json:"next"`
}

const rectificationColumns = "g.id,g.novel_id,g.chapter_id,g.case_id,g.case_revision,g.base_version,g.revision,g.state,g.reason,g.decision_reason,g.preview_id,g.created_at,g.submitted_at,g.decided_at,g.published_version,g.revoked_case,(m.state='active' AND m.revision=g.case_revision AND c.last_version=g.base_version AND n.completed_at IS NOT NULL)"
const rectificationJoin = " FROM novel_rectifications g JOIN novel_moderation_cases m ON m.id=g.case_id JOIN novel_chapters c ON c.id=g.chapter_id JOIN novels n ON n.id=g.novel_id "

func scanRectification(row interface{ Scan(...any) error }) (Rectification, error) {
	var out Rectification
	var id, book, chapter, preview []byte
	err := row.Scan(&id, &book, &chapter, &out.CaseID, &out.CaseRevision, &out.BaseVersion, &out.Revision, &out.State, &out.Reason, &out.DecisionReason, &preview, &out.CreatedAt, &out.SubmittedAt, &out.DecidedAt, &out.PublishedVersion, &out.RevokedCase, &out.TargetCurrent)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	if out.ID, err = uuid.FromBytes(id); err != nil {
		return out, err
	}
	if out.NovelID, err = uuid.FromBytes(book); err != nil {
		return out, err
	}
	if out.ChapterID, err = uuid.FromBytes(chapter); err != nil {
		return out, err
	}
	out.PreviewID, err = nullableUUID(preview)
	return out, err
}
func validRectificationReason(reason string) bool {
	return validText(reason, 2000) && strings.TrimSpace(reason) != ""
}
func (s Store) GrantRectification(ctx context.Context, actor, book uuid.UUID, in GrantRectification) (LifecycleReceipt, error) {
	var out LifecycleReceipt
	if actor == uuid.Nil || book == uuid.Nil || in.MutationID == uuid.Nil || in.ChapterID == uuid.Nil || in.BaseVersion == 0 || in.BaseVersion >= maxRevision || in.CaseID == 0 || in.CaseID > maxRevision || in.CaseRevision == 0 || in.CaseRevision >= maxRevision || !validRectificationReason(in.Reason) {
		return out, ErrInvalid
	}
	owner, err := s.formalOwner(ctx, book)
	if err != nil {
		return out, err
	}
	hash := publicationHash("rectification_grant", book, in.ChapterID, in)
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
	b, err := lockPublicationBook(ctx, tx, owner, book)
	if err != nil {
		return out, err
	}
	if !b.completed.Valid {
		return out, ErrStateConflict
	}
	c, err := lockPublicationChapter(ctx, tx, owner, book, in.ChapterID)
	if err != nil {
		return out, err
	}
	if c.last != in.BaseVersion {
		return out, ErrStateConflict
	}
	item, err := scanNovelCase(tx.QueryRowContext(ctx, "SELECT "+novelCaseColumns+" FROM novel_moderation_cases WHERE id=? AND novel_id=? FOR UPDATE", in.CaseID, book[:]))
	if err != nil {
		return out, err
	}
	if item.State != "active" || item.Revision != in.CaseRevision || (item.Scope != "book" && item.TargetID != in.ChapterID) || (item.Scope == "version" && item.Version != in.BaseVersion) {
		return out, ErrStateConflict
	}
	var active int
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM novel_rectifications WHERE chapter_id=? AND active_slot=1", in.ChapterID[:]).Scan(&active); err != nil {
		return out, err
	}
	if active > 0 {
		return out, ErrStateConflict
	}
	id := uuid.New()
	now := time.Now().UTC().Truncate(time.Microsecond)
	if _, err = tx.ExecContext(ctx, "INSERT INTO novel_rectifications(id,novel_id,chapter_id,owner_id,case_id,case_revision,base_version,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", id[:], book[:], in.ChapterID[:], owner[:], in.CaseID, in.CaseRevision, in.BaseVersion, in.Reason, actor[:], now); err != nil {
		return out, err
	}
	out = LifecycleReceipt{in.MutationID, "rectification_grant", book, id, "available", 1, 0, now}
	if err = saveManagement(ctx, tx, actor, book, in.MutationID, hash, out); err != nil {
		return out, err
	}
	return out, tx.Commit()
}

// Operator privilege is checked at HTTP, owner==Nil is never a public route.
func (s Store) Rectifications(ctx context.Context, owner, book uuid.UUID, before uint64) (RectificationPage, error) {
	out := RectificationPage{Items: []Rectification{}}
	if book == uuid.Nil || before > maxRevision {
		return out, ErrInvalid
	}
	if owner != uuid.Nil {
		if _, err := s.Read(ctx, owner, book); err != nil {
			return out, err
		}
	} else {
		if _, err := s.formalOwner(ctx, book); err != nil {
			return out, err
		}
	}
	q := "SELECT " + rectificationColumns + ",g.sequence" + rectificationJoin + "WHERE g.novel_id=?"
	args := []any{book[:]}
	if owner != uuid.Nil {
		q += " AND g.owner_id=?"
		args = append(args, owner[:])
	}
	if before > 0 {
		q += " AND g.sequence<?"
		args = append(args, before)
	}
	// Scan sequence separately while retaining one shared metadata decoder.
	rows, err := s.DB.QueryContext(ctx, q+" ORDER BY g.sequence DESC LIMIT 21", args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	var sequence uint64
	for rows.Next() {
		row := trailingSequence{rows, &sequence}
		item, e := scanRectification(row)
		if e != nil {
			return out, e
		}
		out.Items = append(out.Items, item)
		if len(out.Items) == 20 {
			out.Next = sequence
		}
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	if len(out.Items) <= 20 {
		out.Next = 0
	} else {
		out.Items = out.Items[:20]
	}
	return out, nil
}

type trailingSequence struct {
	row      *sql.Rows
	sequence *uint64
}

func (t trailingSequence) Scan(dest ...any) error { return t.row.Scan(append(dest, t.sequence)...) }
func (s Store) Rectification(ctx context.Context, owner, book, id uuid.UUID) (RectificationDetail, error) {
	var out RectificationDetail
	q := "SELECT " + rectificationColumns + rectificationJoin + "WHERE g.id=? AND g.novel_id=?"
	args := []any{id[:], book[:]}
	if owner != uuid.Nil {
		q += " AND g.owner_id=?"
		args = append(args, owner[:])
	}
	var err error
	out.Grant, err = scanRectification(s.DB.QueryRowContext(ctx, q, args...))
	if err != nil {
		return out, err
	}
	if owner != uuid.Nil {
		var source RectificationSource
		var raw []byte
		err = s.DB.QueryRowContext(ctx, `SELECT d.id,d.title,d.revision FROM novel_chapters c JOIN chapter_drafts d ON d.id=c.primary_draft_id AND d.chapter_id=c.id AND d.novel_id=c.novel_id AND d.owner_id=c.owner_id WHERE c.id=? AND c.novel_id=? AND c.owner_id=?`, out.Grant.ChapterID[:], book[:], owner[:]).Scan(&raw, &source.Title, &source.Revision)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return out, err
		}
		if err == nil {
			source.DraftID, err = uuid.FromBytes(raw)
			if err != nil {
				return out, err
			}
			out.Source = &source
		}
	}
	if out.Grant.PreviewID != nil {
		var raw []byte
		err = s.DB.QueryRowContext(ctx, "SELECT snapshot FROM novel_rectification_previews WHERE id=? AND grant_id=?", out.Grant.PreviewID[:], id[:]).Scan(&raw)
		if err != nil {
			return out, err
		}
		var p RectificationPreview
		if err = json.Unmarshal(raw, &p); err != nil {
			return out, err
		}
		out.Submitted = &p
	}
	return out, nil
}
func (s Store) RectificationPreview(ctx context.Context, owner, book, id uuid.UUID) (RectificationPreview, error) {
	var out RectificationPreview
	var raw []byte
	var expires time.Time
	err := s.DB.QueryRowContext(ctx, `SELECT p.snapshot,p.expires_at FROM novel_rectification_previews p JOIN novel_rectifications g ON g.id=p.grant_id WHERE p.id=? AND p.novel_id=? AND p.owner_id=?`, id[:], book[:], owner[:]).Scan(&raw, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	if !time.Now().UTC().Before(expires) {
		return out, ErrPreviewExpired
	}
	if err = json.Unmarshal(raw, &out); err != nil {
		return out, err
	}
	return out, nil
}

// All grant transitions share account/book locks with moderation and publishing.
func lockRectification(ctx context.Context, tx *sql.Tx, owner, book, id uuid.UUID) (Rectification, error) {
	// Lock only the grant here; book lock already serializes target/case changes.
	var found []byte
	err := tx.QueryRowContext(ctx, "SELECT id FROM novel_rectifications WHERE id=? AND novel_id=? AND owner_id=? FOR UPDATE", id[:], book[:], owner[:]).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return Rectification{}, ErrNotFound
	}
	if err != nil {
		return Rectification{}, err
	}
	return scanRectification(tx.QueryRowContext(ctx, "SELECT "+rectificationColumns+rectificationJoin+"WHERE g.id=?", id[:]))
}
func (s Store) PrepareRectification(ctx context.Context, owner, book, grant uuid.UUID, in PrepareRectification) (LifecycleReceipt, error) {
	var out LifecycleReceipt
	if owner == uuid.Nil || book == uuid.Nil || grant == uuid.Nil || in.MutationID == uuid.Nil || in.DraftID == uuid.Nil || in.ExpectedRevision == 0 || in.ExpectedRevision >= maxRevision || in.SourceRevision == 0 || in.SourceRevision > maxRevision {
		return out, ErrInvalid
	}
	hash := publicationHash("rectification_prepare", book, grant, in)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = lockAccount(ctx, tx, owner, true); err != nil {
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
	g, err := lockRectification(ctx, tx, owner, book, grant)
	if err != nil {
		return out, err
	}
	if g.State != "available" || g.Revision != in.ExpectedRevision || !g.TargetCurrent {
		return out, ErrStateConflict
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	p := RectificationPreview{ID: uuid.New(), GrantID: grant, NovelID: book, ChapterID: g.ChapterID, BaseVersion: g.BaseVersion, GrantRevision: g.Revision, DraftID: in.DraftID, SourceRevision: in.SourceRevision, ExpiresAt: now.Add(24 * time.Hour)}
	err = tx.QueryRowContext(ctx, `SELECT r.title,r.content FROM chapter_drafts d JOIN chapter_draft_revisions r ON r.draft_id=d.id WHERE d.id=? AND d.owner_id=? AND d.novel_id=? AND d.chapter_id=? AND r.revision=?`, in.DraftID[:], owner[:], book[:], g.ChapterID[:], in.SourceRevision).Scan(&p.Title, &p.Content)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrSourceUnavailable
	}
	if err != nil {
		return out, err
	}
	if !validText(p.Title, 200) || strings.TrimSpace(p.Title) == "" || len(p.Content) > 1<<20 || !utf8.ValidString(p.Content) || strings.TrimSpace(p.Content) == "" {
		return out, ErrInvalid
	}
	var recent int
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM novel_rectification_previews WHERE owner_id=? AND created_at>UTC_TIMESTAMP(6)-INTERVAL 1 HOUR", owner[:]).Scan(&recent); err != nil {
		return out, err
	}
	if recent >= 100 {
		return out, ErrPublicationLimited
	}
	raw, _ := json.Marshal(p)
	if _, err = tx.ExecContext(ctx, "INSERT INTO novel_rectification_previews(id,grant_id,novel_id,owner_id,snapshot,expires_at,created_at) VALUES(?,?,?,?,?,?,?)", p.ID[:], grant[:], book[:], owner[:], raw, p.ExpiresAt, now); err != nil {
		return out, err
	}
	out = LifecycleReceipt{in.MutationID, "rectification_prepare", book, p.ID, "prepared", g.Revision, 0, now}
	if err = saveManagement(ctx, tx, owner, book, in.MutationID, hash, out); err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func (s Store) SubmitRectification(ctx context.Context, owner, book, grant uuid.UUID, in SubmitRectification) (LifecycleReceipt, error) {
	var out LifecycleReceipt
	if owner == uuid.Nil || book == uuid.Nil || grant == uuid.Nil || in.MutationID == uuid.Nil || in.PreviewID == uuid.Nil || in.ExpectedRevision == 0 || in.ExpectedRevision >= maxRevision || !in.RightsConfirmed {
		return out, ErrInvalid
	}
	hash := publicationHash("rectification_submit", book, grant, in)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = lockAccount(ctx, tx, owner, true); err != nil {
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
	g, err := lockRectification(ctx, tx, owner, book, grant)
	if err != nil {
		return out, err
	}
	if g.State != "available" || g.Revision != in.ExpectedRevision || !g.TargetCurrent {
		return out, ErrStateConflict
	}
	var raw []byte
	var expires time.Time
	err = tx.QueryRowContext(ctx, "SELECT snapshot,expires_at FROM novel_rectification_previews WHERE id=? AND grant_id=? AND novel_id=? AND owner_id=?", in.PreviewID[:], grant[:], book[:], owner[:]).Scan(&raw, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	if !time.Now().UTC().Before(expires) {
		return out, ErrPreviewExpired
	}
	var p RectificationPreview
	if err = json.Unmarshal(raw, &p); err != nil {
		return out, err
	}
	if p.GrantRevision != g.Revision || p.BaseVersion != g.BaseVersion || p.ChapterID != g.ChapterID {
		return out, ErrStateConflict
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	if _, err = tx.ExecContext(ctx, "UPDATE novel_rectifications SET state='submitted',revision=revision+1,preview_id=?,submitted_at=? WHERE id=?", in.PreviewID[:], now, grant[:]); err != nil {
		return out, err
	}
	out = LifecycleReceipt{in.MutationID, "rectification_submit", book, grant, "submitted", g.Revision + 1, 0, now}
	if err = saveManagement(ctx, tx, owner, book, in.MutationID, hash, out); err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func (s Store) ResolveRectification(ctx context.Context, actor, book, grant uuid.UUID, action string, in RectificationAction) (LifecycleReceipt, error) {
	var out LifecycleReceipt
	if actor == uuid.Nil || book == uuid.Nil || grant == uuid.Nil || in.MutationID == uuid.Nil || in.ExpectedRevision == 0 || in.ExpectedRevision >= maxRevision || !validRectificationReason(in.Reason) || (action != "approve" && in.RevokeCase) {
		return out, ErrInvalid
	}
	if action != "approve" && action != "reject" && action != "withdraw" && action != "cancel" {
		return out, ErrInvalid
	}
	var ownerRaw []byte
	q := "SELECT owner_id FROM novel_rectifications WHERE id=? AND novel_id=?"
	args := []any{grant[:], book[:]}
	if action == "withdraw" {
		q += " AND owner_id=?"
		args = append(args, actor[:])
	}
	err := s.DB.QueryRowContext(ctx, q, args...).Scan(&ownerRaw)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	owner, err := uuid.FromBytes(ownerRaw)
	if err != nil {
		return out, err
	}
	operation := "rectification_" + action
	hash := publicationHash(operation, book, grant, in)
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
	b, err := lockPublicationBook(ctx, tx, owner, book)
	if err != nil {
		return out, err
	}
	g, err := lockRectification(ctx, tx, owner, book, grant)
	if err != nil {
		return out, err
	}
	if g.Revision != in.ExpectedRevision {
		return out, ErrStateConflict
	}
	if action == "cancel" {
		if g.State != "available" && g.State != "submitted" {
			return out, ErrStateConflict
		}
	} else if g.State != "submitted" {
		return out, ErrStateConflict
	}
	state := map[string]string{"cancel": "cancelled", "withdraw": "withdrawn", "approve": "approved", "reject": "rejected"}[action]
	now := time.Now().UTC().Truncate(time.Microsecond)
	version := uint64(0)
	if action == "approve" {
		if !b.completed.Valid || !g.TargetCurrent || g.BaseVersion >= maxRevision || g.PreviewID == nil {
			return out, ErrStateConflict
		}
		c, e := lockPublicationChapter(ctx, tx, owner, book, g.ChapterID)
		if e != nil {
			return out, e
		}
		if c.last != g.BaseVersion || len(c.pending) > 0 {
			return out, ErrStateConflict
		}
		var chapterRevision uint64
		if err = tx.QueryRowContext(ctx, "SELECT state_revision FROM novel_chapters WHERE id=?", g.ChapterID[:]).Scan(&chapterRevision); err != nil {
			return out, err
		}
		if chapterRevision >= maxRevision-1 {
			return out, ErrStateConflict
		}
		var raw []byte
		if err = tx.QueryRowContext(ctx, "SELECT snapshot FROM novel_rectification_previews WHERE id=? AND grant_id=?", g.PreviewID[:], grant[:]).Scan(&raw); err != nil {
			return out, err
		}
		var p RectificationPreview
		if err = json.Unmarshal(raw, &p); err != nil {
			return out, err
		}
		version = g.BaseVersion + 1
		if _, err = tx.ExecContext(ctx, "INSERT INTO chapter_versions(chapter_id,novel_id,owner_id,version,rectification_id,title,content,published_at) VALUES(?,?,?,?,?,?,?,?)", g.ChapterID[:], book[:], owner[:], version, grant[:], p.Title, p.Content, now); err != nil {
			return out, err
		}
		if _, err = tx.ExecContext(ctx, "UPDATE novel_chapters SET last_version=?,display_version=?,state_revision=state_revision+1 WHERE id=?", version, version, g.ChapterID[:]); err != nil {
			return out, err
		}
		if in.RevokeCase {
			item, e := scanNovelCase(tx.QueryRowContext(ctx, "SELECT "+novelCaseColumns+" FROM novel_moderation_cases WHERE id=? AND novel_id=? FOR UPDATE", g.CaseID, book[:]))
			if e != nil {
				return out, e
			}
			if item.State != "active" || item.Revision != g.CaseRevision {
				return out, ErrStateConflict
			}
			if _, err = tx.ExecContext(ctx, "UPDATE novel_moderation_cases SET state='revoked',active_slot=NULL,revision=revision+1,decision_reason=?,actor_id=? WHERE id=?", in.Reason, actor[:], g.CaseID); err != nil {
				return out, err
			}
			if _, err = tx.ExecContext(ctx, "UPDATE novel_moderation_appeals SET state='revoked',pending_slot=NULL,decision_reason=?,decided_at=? WHERE case_id=? AND state='pending'", in.Reason, now, g.CaseID); err != nil {
				return out, err
			}
			if err = setNovelRestriction(ctx, tx, book, item.TargetID, item.Scope, item.Version, false); err != nil {
				return out, err
			}
		}
	}
	if _, err = tx.ExecContext(ctx, "UPDATE novel_rectifications SET state=?,active_slot=NULL,revision=revision+1,decided_at=?,decided_by=?,decision_reason=?,revoked_case=?,published_version=? WHERE id=?", state, now, actor[:], in.Reason, in.RevokeCase, version, grant[:]); err != nil {
		return out, err
	}
	out = LifecycleReceipt{in.MutationID, operation, book, grant, state, g.Revision + 1, version, now}
	if err = saveManagement(ctx, tx, actor, book, in.MutationID, hash, out); err != nil {
		return out, err
	}
	return out, tx.Commit()
}

// Keep expired preview metadata and receipts, but release unsubmitted text.
func (s Store) PruneRectificationPreviews(ctx context.Context) (int64, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT p.id,p.owner_id FROM novel_rectification_previews p WHERE p.expires_at<UTC_TIMESTAMP(6) AND p.snapshot IS NOT NULL AND NOT EXISTS(SELECT 1 FROM novel_rectifications g WHERE g.preview_id=p.id) ORDER BY p.expires_at,p.id LIMIT 100`)
	if err != nil {
		return 0, err
	}
	type item struct{ id, owner uuid.UUID }
	items := []item{}
	for rows.Next() {
		var id, owner []byte
		if err = rows.Scan(&id, &owner); err != nil {
			rows.Close()
			return 0, err
		}
		i, e := uuid.FromBytes(id)
		if e != nil {
			rows.Close()
			return 0, e
		}
		o, e := uuid.FromBytes(owner)
		if e != nil {
			rows.Close()
			return 0, e
		}
		items = append(items, item{i, o})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	var count int64
	for _, p := range items {
		tx, e := s.DB.BeginTx(ctx, nil)
		if e != nil {
			return count, e
		}
		if e = lockAccount(ctx, tx, p.owner, false); e == nil {
			var result sql.Result
			result, e = tx.ExecContext(ctx, `UPDATE novel_rectification_previews SET snapshot=NULL WHERE id=? AND expires_at<UTC_TIMESTAMP(6) AND snapshot IS NOT NULL AND NOT EXISTS(SELECT 1 FROM novel_rectifications WHERE preview_id=?)`, p.id[:], p.id[:])
			if e == nil {
				var n int64
				n, e = result.RowsAffected()
				if e == nil {
					e = tx.Commit()
					if e == nil {
						count += n
					}
				}
			}
		}
		tx.Rollback()
		if e != nil {
			return count, e
		}
	}
	return count, nil
}
