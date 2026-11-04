package novel

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

var (
	ErrPreviewExpired      = errors.New("chapter_preview_expired")
	ErrPublicationConflict = errors.New("chapter_publication_conflict")
	ErrSourceUnavailable   = errors.New("source_revision_unavailable")
	ErrPublicationLimited  = errors.New("rate_limited")
	ErrNickname            = errors.New("nickname_required")
)

type PrepareChapter struct {
	MutationID     uuid.UUID `json:"mutation_id"`
	DraftID        uuid.UUID `json:"draft_id"`
	SourceRevision uint64    `json:"source_revision"`
	BookRevision   uint64    `json:"book_revision"`
}
type SubmitChapter struct {
	MutationID      uuid.UUID `json:"mutation_id"`
	PreviewID       uuid.UUID `json:"preview_id"`
	RightsConfirmed bool      `json:"rights_confirmed"`
}
type DecideChapter struct {
	MutationID uuid.UUID `json:"mutation_id"`
	Decision   string    `json:"decision"`
	Reason     string    `json:"reason"`
}
type WithdrawChapter struct {
	MutationID uuid.UUID `json:"mutation_id"`
}

// The snapshot owns its text: draft-history retention never changes a preview.
type ChapterPreview struct {
	ID                   uuid.UUID `json:"id"`
	NovelID              uuid.UUID `json:"novel_id"`
	ChapterID            uuid.UUID `json:"chapter_id"`
	DraftID              uuid.UUID `json:"draft_id"`
	SourceRevision       uint64    `json:"source_revision"`
	Title                string    `json:"title"`
	Content              string    `json:"content"`
	BookTitle            string    `json:"book_title"`
	Introduction         string    `json:"introduction"`
	Tags                 []string  `json:"tags"`
	Ordinal              uint64    `json:"ordinal"`
	Reserved             bool      `json:"reserved"`
	ExpectedLastPosition uint64    `json:"expected_last_position"`
	ExpectedVersion      uint64    `json:"expected_version"`
	CandidateVersion     uint64    `json:"candidate_version"`
	ReviewRequired       bool      `json:"review_required"`
	BookHidden           bool      `json:"book_hidden"`
	ChapterHidden        bool      `json:"chapter_hidden"`
	Restricted           bool      `json:"restricted"`
	ExpiresAt            time.Time `json:"expires_at"`
}

// A receipt records the accepted operation, never the object's current state.
// Preview text is deliberately not copied into the idempotency ledger.
type ChapterReceipt struct {
	MutationID   uuid.UUID  `json:"mutation_id"`
	Operation    string     `json:"operation"`
	NovelID      uuid.UUID  `json:"novel_id"`
	ChapterID    uuid.UUID  `json:"chapter_id"`
	PreviewID    uuid.UUID  `json:"preview_id"`
	SubmissionID *uuid.UUID `json:"submission_id"`
	Ordinal      uint64     `json:"ordinal"`
	State        string     `json:"state"`
	Version      uint64     `json:"version"`
	AcceptedAt   time.Time  `json:"accepted_at"`
}

type publicationBook struct {
	book            Book
	last            uint64
	hidden, limited bool
	completed       sql.NullTime
}
type publicationChapter struct {
	ordinal         sql.NullInt64
	last            uint64
	hidden, limited bool
	pending         []byte
}

func publicationHash(operation string, book, target uuid.UUID, in any) [32]byte {
	raw, _ := json.Marshal(struct {
		Operation    string
		Book, Target uuid.UUID
		Input        any
	}{operation, book, target, in})
	return sha256.Sum256(raw)
}
func lockAccount(ctx context.Context, tx *sql.Tx, id uuid.UUID, nickname bool) error {
	var name string
	err := tx.QueryRowContext(ctx, "SELECT COALESCE(nickname,'') FROM accounts WHERE id=? FOR UPDATE", id[:]).Scan(&name)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err == nil && nickname && name == "" {
		return ErrNickname
	}
	return err
}
func lockPublicationBook(ctx context.Context, tx *sql.Tx, owner, id uuid.UUID) (publicationBook, error) {
	var b publicationBook
	var tags []byte
	b.book.ID = id
	err := tx.QueryRowContext(ctx, `SELECT title,introduction,tags,revision,last_position,author_hidden,platform_limited,completed_at FROM novels WHERE id=? AND owner_id=? FOR UPDATE`, id[:], owner[:]).Scan(&b.book.Title, &b.book.Introduction, &tags, &b.book.Revision, &b.last, &b.hidden, &b.limited, &b.completed)
	if errors.Is(err, sql.ErrNoRows) {
		return b, ErrNotFound
	}
	if err == nil {
		err = json.Unmarshal(tags, &b.book.Tags)
	}
	return b, err
}
func lockPublicationChapter(ctx context.Context, tx *sql.Tx, owner, book, chapter uuid.UUID) (publicationChapter, error) {
	var c publicationChapter
	err := tx.QueryRowContext(ctx, `SELECT ordinal,last_version,author_hidden,platform_limited,current_submission_id FROM novel_chapters WHERE id=? AND novel_id=? AND owner_id=? FOR UPDATE`, chapter[:], book[:], owner[:]).Scan(&c.ordinal, &c.last, &c.hidden, &c.limited, &c.pending)
	if errors.Is(err, sql.ErrNoRows) {
		return c, ErrNotFound
	}
	return c, err
}
func publicationRetry(ctx context.Context, tx *sql.Tx, actor, book, mutation uuid.UUID, hash [32]byte) (ChapterReceipt, bool, error) {
	var result ChapterReceipt
	var previous, raw, parent []byte
	err := tx.QueryRowContext(ctx, "SELECT novel_id,payload_hash,result FROM novel_publication_requests WHERE owner_id=? AND mutation_id=?", actor[:], mutation[:]).Scan(&parent, &previous, &raw)
	if errors.Is(err, sql.ErrNoRows) {
		return result, false, nil
	}
	if err != nil {
		return result, false, err
	}
	if string(previous) != string(hash[:]) || string(parent) != string(book[:]) {
		return result, false, ErrKeyReuse
	}
	err = json.Unmarshal(raw, &result)
	return result, true, err
}
func savePublicationReceipt(ctx context.Context, tx *sql.Tx, actor uuid.UUID, hash [32]byte, r ChapterReceipt) error {
	raw, err := json.Marshal(r)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO novel_publication_requests(owner_id,mutation_id,novel_id,operation,payload_hash,result) VALUES(?,?,?,?,?,?)", actor[:], r.MutationID[:], r.NovelID[:], r.Operation, hash[:], raw)
	return err
}
func observation(ctx context.Context, tx *sql.Tx, owner uuid.UUID) (bool, error) {
	var until sql.NullTime
	err := tx.QueryRowContext(ctx, "SELECT observation_until FROM publication_policies WHERE owner_id=?", owner[:]).Scan(&until)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return until.Valid && until.Time.After(time.Now().UTC()), err
}

func (s Store) ChapterPublicationReceipt(ctx context.Context, actor, book, mutation uuid.UUID) (ChapterReceipt, error) {
	var r ChapterReceipt
	var raw []byte
	err := s.DB.QueryRowContext(ctx, "SELECT result FROM novel_publication_requests WHERE owner_id=? AND novel_id=? AND mutation_id=?", actor[:], book[:], mutation[:]).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return r, ErrNotFound
	}
	if err == nil {
		err = json.Unmarshal(raw, &r)
	}
	return r, err
}

func (s Store) PrepareChapter(ctx context.Context, owner, book uuid.UUID, in PrepareChapter) (ChapterReceipt, error) {
	var zero ChapterReceipt
	if owner == uuid.Nil || book == uuid.Nil || in.MutationID == uuid.Nil || in.DraftID == uuid.Nil || in.SourceRevision == 0 || in.SourceRevision > maxRevision || in.BookRevision == 0 || in.BookRevision > maxRevision {
		return zero, ErrInvalid
	}
	hash := publicationHash("prepare", book, in.DraftID, in)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return zero, err
	}
	defer tx.Rollback()
	if err = lockAccount(ctx, tx, owner, true); err != nil {
		return zero, err
	}
	if previous, ok, e := publicationRetry(ctx, tx, owner, book, in.MutationID, hash); e != nil || ok {
		if e != nil {
			return zero, e
		}
		return previous, tx.Commit()
	}
	b, err := lockPublicationBook(ctx, tx, owner, book)
	if err != nil {
		return zero, err
	}
	if b.completed.Valid || b.book.Revision != in.BookRevision {
		return zero, ErrPublicationConflict
	}
	var chapterRaw []byte
	err = tx.QueryRowContext(ctx, "SELECT chapter_id FROM chapter_drafts WHERE id=? AND novel_id=? AND owner_id=?", in.DraftID[:], book[:], owner[:]).Scan(&chapterRaw)
	if errors.Is(err, sql.ErrNoRows) {
		return zero, ErrNotFound
	}
	if err != nil {
		return zero, err
	}
	chapter, err := uuid.FromBytes(chapterRaw)
	if err != nil {
		return zero, err
	}
	c, err := lockPublicationChapter(ctx, tx, owner, book, chapter)
	if err != nil {
		return zero, err
	}
	p := ChapterPreview{ID: uuid.New(), NovelID: book, ChapterID: chapter, DraftID: in.DraftID, SourceRevision: in.SourceRevision, BookTitle: b.book.Title, Introduction: b.book.Introduction, Tags: b.book.Tags, ExpectedLastPosition: b.last, ExpectedVersion: c.last, CandidateVersion: c.last + 1, BookHidden: b.hidden, ChapterHidden: c.hidden, Restricted: b.limited || c.limited, ExpiresAt: time.Now().UTC().Truncate(time.Microsecond).Add(24 * time.Hour)}
	err = tx.QueryRowContext(ctx, "SELECT title,content FROM chapter_draft_revisions WHERE draft_id=? AND revision=?", in.DraftID[:], in.SourceRevision).Scan(&p.Title, &p.Content)
	if errors.Is(err, sql.ErrNoRows) {
		return zero, ErrSourceUnavailable
	}
	if err != nil {
		return zero, err
	}
	if !validText(p.Title, 200) || strings.TrimSpace(p.Title) == "" || len(p.Content) > 1<<20 || !utf8.ValidString(p.Content) || strings.TrimSpace(p.Content) == "" {
		return zero, ErrInvalid
	}
	if c.last >= maxRevision || (!c.ordinal.Valid && b.last >= maxRevision) {
		return zero, ErrPublicationConflict
	}
	p.Ordinal = b.last + 1
	if c.ordinal.Valid {
		p.Reserved = true
		p.Ordinal = uint64(c.ordinal.Int64)
	}
	var formalTags []byte
	err = tx.QueryRowContext(ctx, "SELECT title,introduction,tags FROM novel_publications WHERE novel_id=? AND owner_id=?", book[:], owner[:]).Scan(&p.BookTitle, &p.Introduction, &formalTags)
	if err == nil {
		err = json.Unmarshal(formalTags, &p.Tags)
	} else if errors.Is(err, sql.ErrNoRows) {
		err = nil
	}
	if err != nil {
		return zero, err
	}
	p.ReviewRequired, err = observation(ctx, tx, owner)
	p.ReviewRequired = p.ReviewRequired || len(c.pending) != 0
	if err != nil {
		return zero, err
	}
	var recent int
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM chapter_previews WHERE owner_id=? AND created_at>DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 HOUR)", owner[:]).Scan(&recent); err != nil {
		return zero, err
	}
	if recent >= 30 {
		return zero, ErrPublicationLimited
	}
	raw, err := json.Marshal(p)
	if err != nil {
		return zero, err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO chapter_previews(id,owner_id,novel_id,chapter_id,snapshot,expires_at) VALUES(?,?,?,?,?,?)", p.ID[:], owner[:], book[:], chapter[:], raw, p.ExpiresAt)
	if err != nil {
		return zero, err
	}
	r := ChapterReceipt{MutationID: in.MutationID, Operation: "prepare", NovelID: book, ChapterID: chapter, PreviewID: p.ID, Ordinal: p.Ordinal, State: "prepared", AcceptedAt: time.Now().UTC().Truncate(time.Microsecond)}
	if err = savePublicationReceipt(ctx, tx, owner, hash, r); err != nil {
		return zero, err
	}
	return r, tx.Commit()
}

func readChapterPreview(ctx context.Context, tx *sql.Tx, owner, book, id uuid.UUID, valid bool) (ChapterPreview, error) {
	var p ChapterPreview
	var raw []byte
	var expires time.Time
	query := "SELECT snapshot,expires_at FROM chapter_previews WHERE owner_id=? AND novel_id=? AND id=?"
	if valid {
		query += " FOR UPDATE"
	}
	err := tx.QueryRowContext(ctx, query, owner[:], book[:], id[:]).Scan(&raw, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return p, ErrNotFound
	}
	if err != nil {
		return p, err
	}
	if len(raw) == 0 || (valid && !expires.After(time.Now().UTC())) {
		return p, ErrPreviewExpired
	}
	err = json.Unmarshal(raw, &p)
	return p, err
}
func (s Store) ChapterPreview(ctx context.Context, owner, book, id uuid.UUID) (ChapterPreview, error) {
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return ChapterPreview{}, err
	}
	defer tx.Rollback()
	p, err := readChapterPreview(ctx, tx, owner, book, id, false)
	if err != nil {
		return p, err
	}
	// Accepted snapshots survive expiry; an unsubmitted preview does not.
	if !p.ExpiresAt.After(time.Now().UTC()) {
		var n int
		if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM chapter_submissions WHERE preview_id=?", id[:]).Scan(&n); err != nil {
			return p, err
		}
		if n == 0 {
			return ChapterPreview{}, ErrPreviewExpired
		}
	}
	return p, tx.Commit()
}

func (s Store) SubmitChapter(ctx context.Context, owner, book uuid.UUID, in SubmitChapter) (ChapterReceipt, error) {
	var zero ChapterReceipt
	if owner == uuid.Nil || book == uuid.Nil || in.MutationID == uuid.Nil || in.PreviewID == uuid.Nil || !in.RightsConfirmed {
		return zero, ErrInvalid
	}
	hash := publicationHash("submit", book, in.PreviewID, in)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return zero, err
	}
	defer tx.Rollback()
	if err = lockAccount(ctx, tx, owner, true); err != nil {
		return zero, err
	}
	if r, ok, e := publicationRetry(ctx, tx, owner, book, in.MutationID, hash); e != nil || ok {
		if e != nil {
			return zero, e
		}
		return r, tx.Commit()
	}
	b, err := lockPublicationBook(ctx, tx, owner, book)
	if err != nil {
		return zero, err
	}
	if b.completed.Valid {
		return zero, ErrPublicationConflict
	}
	p, err := readChapterPreview(ctx, tx, owner, book, in.PreviewID, true)
	if err != nil {
		return zero, err
	}
	c, err := lockPublicationChapter(ctx, tx, owner, book, p.ChapterID)
	if err != nil {
		return zero, err
	}
	if c.last != p.ExpectedVersion || c.last >= maxRevision {
		return zero, ErrPublicationConflict
	}
	var consumed int
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM chapter_submissions WHERE preview_id=?", p.ID[:]).Scan(&consumed); err != nil {
		return zero, err
	}
	if consumed != 0 {
		return zero, ErrPublicationConflict
	}
	if c.ordinal.Valid {
		if !p.Reserved || uint64(c.ordinal.Int64) != p.Ordinal {
			return zero, ErrPublicationConflict
		}
	} else {
		if p.Reserved || p.ExpectedLastPosition != b.last || p.Ordinal != b.last+1 || b.last >= maxRevision {
			return zero, ErrPublicationConflict
		}
		if _, err = tx.ExecContext(ctx, "UPDATE novels SET last_position=? WHERE id=?", p.Ordinal, book[:]); err != nil {
			return zero, err
		}
		if _, err = tx.ExecContext(ctx, "UPDATE novel_chapters SET ordinal=? WHERE id=?", p.Ordinal, p.ChapterID[:]); err != nil {
			return zero, err
		}
	}
	// A pending replacement consumes no formal version. Audit rows remain immutable.
	if len(c.pending) != 0 {
		if _, err = tx.ExecContext(ctx, "UPDATE chapter_submissions SET state='superseded',decided_at=UTC_TIMESTAMP(6) WHERE id=? AND state='pending'", c.pending); err != nil {
			return zero, err
		}
	}
	pending, err := observation(ctx, tx, owner)
	pending = pending || len(c.pending) != 0
	if err != nil {
		return zero, err
	}
	id := uuid.New()
	now := time.Now().UTC().Truncate(time.Microsecond)
	r := ChapterReceipt{MutationID: in.MutationID, Operation: "submit", NovelID: book, ChapterID: p.ChapterID, PreviewID: p.ID, SubmissionID: &id, Ordinal: p.Ordinal, State: "pending", AcceptedAt: now}
	_, err = tx.ExecContext(ctx, "INSERT INTO chapter_submissions(id,owner_id,novel_id,chapter_id,preview_id,ordinal,candidate_version,state) VALUES(?,?,?,?,?,?,?,'pending')", id[:], owner[:], book[:], p.ChapterID[:], p.ID[:], p.Ordinal, p.CandidateVersion)
	if err != nil {
		return zero, err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE novel_chapters SET current_submission_id=?,state_revision=state_revision+1 WHERE id=?", id[:], p.ChapterID[:]); err != nil {
		return zero, err
	}
	if !pending {
		if err = publishChapter(ctx, tx, owner, id, p, uuid.Nil, now); err != nil {
			return zero, err
		}
		r.State = "published"
		r.Version = p.CandidateVersion
	}
	if err = savePublicationReceipt(ctx, tx, owner, hash, r); err != nil {
		return zero, err
	}
	return r, tx.Commit()
}

func publishChapter(ctx context.Context, tx *sql.Tx, owner, submission uuid.UUID, p ChapterPreview, operator uuid.UUID, now time.Time) error {
	_, err := tx.ExecContext(ctx, "INSERT INTO chapter_versions(chapter_id,novel_id,owner_id,version,submission_id,title,content,published_at) VALUES(?,?,?,?,?,?,?,?)", p.ChapterID[:], p.NovelID[:], owner[:], p.CandidateVersion, submission[:], p.Title, p.Content, now)
	if err != nil {
		return err
	}
	var actor any
	if operator != uuid.Nil {
		actor = operator[:]
	}
	if _, err = tx.ExecContext(ctx, "UPDATE chapter_submissions SET state='published',decided_by=?,decided_at=? WHERE id=?", actor, now, submission[:]); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE novel_chapters SET last_version=?,display_version=?,current_submission_id=NULL,state_revision=state_revision+1 WHERE id=?", p.CandidateVersion, p.CandidateVersion, p.ChapterID[:]); err != nil {
		return err
	}
	tags, _ := json.Marshal(p.Tags)
	if _, err = tx.ExecContext(ctx, "INSERT INTO novel_publications(novel_id,owner_id,title,introduction,tags,first_published_at,updated_at) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE novel_id=novel_publications.novel_id", p.NovelID[:], owner[:], p.BookTitle, p.Introduction, tags, now, now); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO novel_metadata_versions(novel_id,owner_id,revision,title,introduction,tags,published_at) SELECT novel_id,owner_id,revision,title,introduction,tags,updated_at FROM novel_publications WHERE novel_id=? AND revision=1 ON DUPLICATE KEY UPDATE novel_id=novel_metadata_versions.novel_id`, p.NovelID[:]); err != nil {
		return err
	}
	if p.CandidateVersion == 1 {
		_, err = tx.ExecContext(ctx, "INSERT INTO chapter_release_events(chapter_id,novel_id,owner_id,ordinal,published_at) VALUES(?,?,?,?,?)", p.ChapterID[:], p.NovelID[:], owner[:], p.Ordinal, now)
	}
	if err == nil && operator == uuid.Nil {
		_, err = tx.ExecContext(ctx, "INSERT INTO chapter_post_review_tasks(submission_id,chapter_id,novel_id,owner_id,version,created_at) VALUES(?,?,?,?,?,?)", submission[:], p.ChapterID[:], p.NovelID[:], owner[:], p.CandidateVersion, now)
	}
	return err
}

// Operator authorization is performed by the HTTP boundary. The transaction
// locks involved accounts in stable order before the book. This also serializes
// a single operator's mutation IDs across reviews of different authors.
func (s Store) DecideChapter(ctx context.Context, actor, book, submission uuid.UUID, in DecideChapter) (ChapterReceipt, error) {
	return s.resolveChapter(ctx, actor, book, submission, in, false)
}
func (s Store) WithdrawChapter(ctx context.Context, owner, book, submission uuid.UUID, in WithdrawChapter) (ChapterReceipt, error) {
	return s.resolveChapter(ctx, owner, book, submission, DecideChapter{MutationID: in.MutationID, Decision: "withdraw"}, true)
}
func (s Store) resolveChapter(ctx context.Context, actor, book, submission uuid.UUID, in DecideChapter, withdraw bool) (ChapterReceipt, error) {
	var zero ChapterReceipt
	if actor == uuid.Nil || book == uuid.Nil || submission == uuid.Nil || in.MutationID == uuid.Nil || !validText(in.Reason, 2000) || (!withdraw && in.Decision != "approve" && in.Decision != "reject") || (in.Decision == "reject" && strings.TrimSpace(in.Reason) == "") {
		return zero, ErrInvalid
	}
	operation := "review"
	if withdraw {
		operation = "withdraw"
	}
	hash := publicationHash(operation, book, submission, in)
	var ownerRaw []byte
	q := "SELECT owner_id FROM chapter_submissions WHERE id=? AND novel_id=?"
	args := []any{submission[:], book[:]}
	if withdraw {
		q += " AND owner_id=?"
		args = append(args, actor[:])
	}
	err := s.DB.QueryRowContext(ctx, q, args...).Scan(&ownerRaw)
	if errors.Is(err, sql.ErrNoRows) {
		return zero, ErrNotFound
	}
	if err != nil {
		return zero, err
	}
	owner, err := uuid.FromBytes(ownerRaw)
	if err != nil {
		return zero, err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return zero, err
	}
	defer tx.Rollback()
	first, second := owner, actor
	if bytes.Compare(first[:], second[:]) > 0 {
		first, second = second, first
	}
	if err = lockAccount(ctx, tx, first, false); err != nil {
		return zero, err
	}
	if first != second {
		if err = lockAccount(ctx, tx, second, false); err != nil {
			return zero, err
		}
	}
	if r, ok, e := publicationRetry(ctx, tx, actor, book, in.MutationID, hash); e != nil || ok {
		if e != nil {
			return zero, e
		}
		return r, tx.Commit()
	}
	b, err := lockPublicationBook(ctx, tx, owner, book)
	if err != nil {
		return zero, err
	}
	var chapterRaw, previewRaw []byte
	var state string
	err = tx.QueryRowContext(ctx, "SELECT chapter_id,preview_id,state FROM chapter_submissions WHERE id=? AND novel_id=?", submission[:], book[:]).Scan(&chapterRaw, &previewRaw, &state)
	if err != nil {
		return zero, err
	}
	chapter, e := uuid.FromBytes(chapterRaw)
	if e != nil {
		return zero, e
	}
	preview, e := uuid.FromBytes(previewRaw)
	if e != nil {
		return zero, e
	}
	c, err := lockPublicationChapter(ctx, tx, owner, book, chapter)
	if err != nil {
		return zero, err
	}
	if state != "pending" || string(c.pending) != string(submission[:]) || b.completed.Valid {
		return zero, ErrPublicationConflict
	}
	p, err := readChapterPreview(ctx, tx, owner, book, preview, false)
	if err != nil {
		return zero, err
	}
	if c.last != p.ExpectedVersion {
		return zero, ErrPublicationConflict
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	r := ChapterReceipt{MutationID: in.MutationID, Operation: operation, NovelID: book, ChapterID: chapter, PreviewID: preview, SubmissionID: &submission, Ordinal: p.Ordinal, State: "rejected", AcceptedAt: now}
	if in.Decision == "approve" {
		if err = publishChapter(ctx, tx, owner, submission, p, actor, now); err != nil {
			return zero, err
		}
		r.State = "published"
		r.Version = p.CandidateVersion
	} else {
		var operator any = actor[:]
		if withdraw {
			r.State = "withdrawn"
			operator = nil
		}
		if _, err = tx.ExecContext(ctx, "UPDATE chapter_submissions SET state=?,decision_reason=?,decided_by=?,decided_at=? WHERE id=?", r.State, in.Reason, operator, now, submission[:]); err != nil {
			return zero, err
		}
		if _, err = tx.ExecContext(ctx, "UPDATE novel_chapters SET current_submission_id=NULL,state_revision=state_revision+1 WHERE id=?", chapter[:]); err != nil {
			return zero, err
		}
	}
	if err = savePublicationReceipt(ctx, tx, actor, hash, r); err != nil {
		return zero, err
	}
	return r, tx.Commit()
}

// Bounded housekeeping only scrubs never-submitted preview bodies. Receipts
// remain so an old mutation can never become a new publication operation.
func (s Store) PruneChapterPreviews(ctx context.Context) (int64, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT p.id,p.owner_id FROM chapter_previews p LEFT JOIN chapter_submissions s ON s.preview_id=p.id WHERE p.expires_at<UTC_TIMESTAMP(6) AND p.snapshot IS NOT NULL AND s.id IS NULL ORDER BY p.expires_at,p.id LIMIT 100`)
	if err != nil {
		return 0, err
	}
	type candidate struct{ id, owner uuid.UUID }
	items := []candidate{}
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
		items = append(items, candidate{i, o})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	var total int64
	for _, item := range items {
		tx, e := s.DB.BeginTx(ctx, nil)
		if e != nil {
			return total, e
		}
		// Same author lock as submit; recheck after acquiring it. This protects a
		// just-accepted preview even when expiry occurred during submission.
		if e = lockAccount(ctx, tx, item.owner, false); e != nil {
			tx.Rollback()
			return total, e
		}
		result, e := tx.ExecContext(ctx, `UPDATE chapter_previews SET snapshot=NULL WHERE id=? AND expires_at<UTC_TIMESTAMP(6) AND snapshot IS NOT NULL AND NOT EXISTS(SELECT 1 FROM chapter_submissions WHERE preview_id=?)`, item.id[:], item.id[:])
		if e != nil {
			tx.Rollback()
			return total, e
		}
		n, e := result.RowsAffected()
		if e != nil {
			tx.Rollback()
			return total, e
		}
		if e = tx.Commit(); e != nil {
			return total, e
		}
		total += n
	}
	return total, nil
}
