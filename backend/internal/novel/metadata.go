package novel

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"strings"
	"time"
)

type SubmitMetadata struct {
	MutationID       uuid.UUID `json:"mutation_id"`
	SourceRevision   uint64    `json:"source_revision"`
	ExpectedRevision uint64    `json:"expected_revision"`
	RightsConfirmed  bool      `json:"rights_confirmed"`
}
type MetadataReceipt struct {
	MutationID        uuid.UUID `json:"mutation_id"`
	NovelID           uuid.UUID `json:"novel_id"`
	SubmissionID      uuid.UUID `json:"submission_id"`
	Operation         string    `json:"operation"`
	State             string    `json:"state"`
	Revision          uint64    `json:"revision"`
	CandidateRevision uint64    `json:"candidate_revision"`
	SourceRevision    uint64    `json:"source_revision"`
}
type MetadataSubmission struct {
	ID                uuid.UUID  `json:"id"`
	NovelID           uuid.UUID  `json:"novel_id"`
	Title             string     `json:"title"`
	Introduction      string     `json:"introduction"`
	Tags              []string   `json:"tags"`
	SourceRevision    uint64     `json:"source_revision"`
	ExpectedRevision  uint64     `json:"expected_revision"`
	CandidateRevision uint64     `json:"candidate_revision"`
	State             string     `json:"state"`
	Current           bool       `json:"current"`
	Reason            string     `json:"reason"`
	SubmittedAt       time.Time  `json:"submitted_at"`
	DecidedAt         *time.Time `json:"decided_at"`
	PostReviewedAt    *time.Time `json:"post_reviewed_at"`
}
type MetadataPage struct {
	Items      []MetadataSubmission `json:"items"`
	NextCursor string               `json:"next_cursor"`
}

func (s Store) SubmitMetadata(ctx context.Context, owner, book uuid.UUID, in SubmitMetadata) (MetadataReceipt, error) {
	var out MetadataReceipt
	if owner == uuid.Nil || book == uuid.Nil || in.MutationID == uuid.Nil || !in.RightsConfirmed || in.SourceRevision == 0 || in.SourceRevision > maxRevision || in.ExpectedRevision == 0 || in.ExpectedRevision >= maxRevision {
		return out, ErrInvalid
	}
	hash := publicationHash("submit_metadata", book, book, in)
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
	b, err := lockPublicationBook(ctx, tx, owner, book)
	if err != nil {
		return out, err
	}
	state, err := readNovelState(ctx, tx, owner, book)
	if err != nil {
		return out, err
	}
	if state.Formal == nil || b.book.Revision != in.SourceRevision || state.Formal.Revision != in.ExpectedRevision || state.StateRevision > maxRevision-2 {
		return out, ErrStateConflict
	}
	var n int
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM novel_metadata_submissions WHERE owner_id=? AND created_at>DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 HOUR)", owner[:]).Scan(&n); err != nil {
		return out, err
	}
	if n >= 30 {
		return out, ErrPublicationLimited
	}
	if state.MetadataSubmissionID != nil {
		if _, err = tx.ExecContext(ctx, "UPDATE novel_metadata_submissions SET state='superseded',decided_at=UTC_TIMESTAMP(6) WHERE id=? AND state='pending'", state.MetadataSubmissionID[:]); err != nil {
			return out, err
		}
	}
	pending, err := observation(ctx, tx, owner)
	pending = pending || state.MetadataSubmissionID != nil
	if err != nil {
		return out, err
	}
	id := uuid.New()
	tags, _ := json.Marshal(b.book.Tags)
	_, err = tx.ExecContext(ctx, `INSERT INTO novel_metadata_submissions(id,novel_id,owner_id,source_revision,expected_revision,candidate_revision,title,introduction,tags,state) VALUES(?,?,?,?,?,?,?,?,?,'pending')`, id[:], book[:], owner[:], in.SourceRevision, in.ExpectedRevision, in.ExpectedRevision+1, b.book.Title, b.book.Introduction, tags)
	if err != nil {
		return out, err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE novels SET metadata_submission_id=?,state_revision=state_revision+1 WHERE id=?", id[:], book[:]); err != nil {
		return out, err
	}
	out = MetadataReceipt{MutationID: in.MutationID, NovelID: book, SubmissionID: id, Operation: "submit_metadata", State: "pending", CandidateRevision: in.ExpectedRevision + 1, SourceRevision: in.SourceRevision}
	if !pending {
		item := MetadataSubmission{ID: id, NovelID: book, Title: b.book.Title, Introduction: b.book.Introduction, Tags: b.book.Tags, SourceRevision: in.SourceRevision, ExpectedRevision: in.ExpectedRevision, CandidateRevision: in.ExpectedRevision + 1}
		if err = publishMetadata(ctx, tx, owner, uuid.Nil, item); err != nil {
			return out, err
		}
		out.State = "published"
		out.Revision = item.CandidateRevision
	}
	if err = saveManagement(ctx, tx, owner, book, in.MutationID, hash, out); err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func publishMetadata(ctx context.Context, tx *sql.Tx, owner, actor uuid.UUID, item MetadataSubmission) error {
	now := time.Now().UTC().Truncate(time.Microsecond)
	tags, _ := json.Marshal(item.Tags)
	var reviewer, post any
	if actor != uuid.Nil {
		reviewer = actor[:]
		post = now
	}
	_, err := tx.ExecContext(ctx, "INSERT INTO novel_metadata_versions(novel_id,owner_id,revision,submission_id,title,introduction,tags,published_at) VALUES(?,?,?,?,?,?,?,?)", item.NovelID[:], owner[:], item.CandidateRevision, item.ID[:], item.Title, item.Introduction, tags, now)
	if err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, "UPDATE novel_publications SET title=?,introduction=?,tags=?,revision=?,updated_at=? WHERE novel_id=? AND owner_id=? AND revision=?", item.Title, item.Introduction, tags, item.CandidateRevision, now, item.NovelID[:], owner[:], item.ExpectedRevision)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return ErrStateConflict
	}
	if _, err = tx.ExecContext(ctx, "UPDATE novel_metadata_submissions SET state='published',decided_by=?,decided_at=?,post_reviewed_at=? WHERE id=?", reviewer, now, post, item.ID[:]); err != nil {
		return err
	}
	// Visibility and completion stay independent. This emits no chapter event.
	_, err = tx.ExecContext(ctx, "UPDATE novels SET metadata_submission_id=NULL,state_revision=state_revision+1 WHERE id=?", item.NovelID[:])
	return err
}

const metadataColumns = `m.id,m.novel_id,m.title,m.introduction,m.tags,m.source_revision,m.expected_revision,m.candidate_revision,m.state,(n.metadata_submission_id=m.id AND m.state='pending'),m.decision_reason,m.created_at,m.decided_at,m.post_reviewed_at`
const metadataJoin = ` FROM novel_metadata_submissions m JOIN novels n ON n.id=m.novel_id AND n.owner_id=m.owner_id `

func scanMetadata(row interface{ Scan(...any) error }) (MetadataSubmission, error) {
	var out MetadataSubmission
	var id, book, tags []byte
	var current sql.NullBool
	err := row.Scan(&id, &book, &out.Title, &out.Introduction, &tags, &out.SourceRevision, &out.ExpectedRevision, &out.CandidateRevision, &out.State, &current, &out.Reason, &out.SubmittedAt, &out.DecidedAt, &out.PostReviewedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	out.ID, err = uuid.FromBytes(id)
	if err != nil {
		return out, err
	}
	out.NovelID, err = uuid.FromBytes(book)
	if err != nil {
		return out, err
	}
	out.Current = current.Valid && current.Bool
	err = json.Unmarshal(tags, &out.Tags)
	return out, err
}
func (s Store) MetadataSubmission(ctx context.Context, owner, book, id uuid.UUID) (MetadataSubmission, error) {
	return scanMetadata(s.DB.QueryRowContext(ctx, "SELECT "+metadataColumns+metadataJoin+" WHERE m.owner_id=? AND m.novel_id=? AND m.id=?", owner[:], book[:], id[:]))
}
func (s Store) OperatorMetadataSubmission(ctx context.Context, book, id uuid.UUID) (MetadataSubmission, error) {
	return scanMetadata(s.DB.QueryRowContext(ctx, "SELECT "+metadataColumns+metadataJoin+" WHERE m.novel_id=? AND m.id=?", book[:], id[:]))
}

type metadataCursor struct {
	Owner, Book, ID uuid.UUID
	Mode            string
	Time            time.Time
}

func (s Store) MetadataSubmissions(ctx context.Context, owner, book uuid.UUID, token string) (MetadataPage, error) {
	if _, err := s.Read(ctx, owner, book); err != nil {
		return MetadataPage{}, err
	}
	return s.listMetadata(ctx, owner, book, token, "author")
}
func (s Store) MetadataReviewQueue(ctx context.Context, token, mode string) (MetadataPage, error) {
	if mode == "" {
		mode = "pre"
	}
	if mode != "pre" && mode != "post" {
		return MetadataPage{}, ErrInvalid
	}
	return s.listMetadata(ctx, uuid.Nil, uuid.Nil, token, mode)
}
func (s Store) listMetadata(ctx context.Context, owner, book uuid.UUID, token, mode string) (MetadataPage, error) {
	out := MetadataPage{Items: []MetadataSubmission{}}
	if len(token) > 512 {
		return out, ErrInvalid
	}
	q := "SELECT " + metadataColumns + metadataJoin + " WHERE 1=1"
	args := []any{}
	switch mode {
	case "author":
		q += " AND m.owner_id=? AND m.novel_id=?"
		args = append(args, owner[:], book[:])
	case "pre":
		q += " AND m.state='pending' AND n.metadata_submission_id=m.id"
	case "post":
		q += " AND m.state='published' AND m.post_reviewed_at IS NULL"
	}
	if token != "" {
		raw, e := base64.RawURLEncoding.DecodeString(token)
		var c metadataCursor
		if e != nil || json.Unmarshal(raw, &c) != nil || c.Owner != owner || c.Book != book || c.Mode != mode || c.ID == uuid.Nil || c.Time.IsZero() {
			return out, ErrInvalid
		}
		q += " AND (m.created_at<? OR (m.created_at=? AND m.id<?))"
		args = append(args, c.Time, c.Time, c.ID[:])
	}
	rows, err := s.DB.QueryContext(ctx, q+" ORDER BY m.created_at DESC,m.id DESC LIMIT 21", args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		item, e := scanMetadata(rows)
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
		last := out.Items[19]
		raw, _ := json.Marshal(metadataCursor{owner, book, last.ID, mode, last.SubmittedAt})
		out.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	return out, nil
}
func (s Store) DecideMetadata(ctx context.Context, actor, book, id uuid.UUID, in DecideChapter) (MetadataReceipt, error) {
	return s.resolveMetadata(ctx, actor, book, id, in, false)
}
func (s Store) WithdrawMetadata(ctx context.Context, owner, book, id uuid.UUID, in WithdrawChapter) (MetadataReceipt, error) {
	return s.resolveMetadata(ctx, owner, book, id, DecideChapter{MutationID: in.MutationID, Decision: "withdraw"}, true)
}
func (s Store) resolveMetadata(ctx context.Context, actor, book, id uuid.UUID, in DecideChapter, withdraw bool) (MetadataReceipt, error) {
	var out MetadataReceipt
	if actor == uuid.Nil || book == uuid.Nil || id == uuid.Nil || in.MutationID == uuid.Nil || !validText(in.Reason, 2000) || (!withdraw && in.Decision != "approve" && in.Decision != "reject") || (in.Decision == "reject" && strings.TrimSpace(in.Reason) == "") {
		return out, ErrInvalid
	}
	op := "review_metadata"
	if withdraw {
		op = "withdraw_metadata"
	}
	hash := publicationHash(op, book, id, in)
	q := "SELECT owner_id FROM novel_metadata_submissions WHERE novel_id=? AND id=?"
	args := []any{book[:], id[:]}
	if withdraw {
		q += " AND owner_id=?"
		args = append(args, actor[:])
	}
	var ownerRaw []byte
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
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	first, second := owner, actor
	if bytes.Compare(first[:], second[:]) > 0 {
		first, second = second, first
	}
	if err = lockAccount(ctx, tx, first, false); err != nil {
		return out, err
	}
	if first != second {
		if err = lockAccount(ctx, tx, second, false); err != nil {
			return out, err
		}
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
	state, err := readNovelState(ctx, tx, owner, book)
	if err != nil {
		return out, err
	}
	if state.StateRevision >= maxRevision {
		return out, ErrStateConflict
	}
	item, err := scanMetadata(tx.QueryRowContext(ctx, "SELECT "+metadataColumns+metadataJoin+" WHERE m.novel_id=? AND m.id=?", book[:], id[:]))
	if err != nil {
		return out, err
	}
	out = MetadataReceipt{MutationID: in.MutationID, NovelID: book, SubmissionID: id, Operation: op, State: "rejected", CandidateRevision: item.CandidateRevision, SourceRevision: item.SourceRevision}
	if !withdraw && item.State == "published" && item.PostReviewedAt == nil && in.Decision == "approve" {
		// Acknowledge this exact past formal revision without modifying today's one.
		if _, err = tx.ExecContext(ctx, "UPDATE novel_metadata_submissions SET post_reviewed_at=UTC_TIMESTAMP(6),decided_by=? WHERE id=?", actor[:], id[:]); err != nil {
			return out, err
		}
		out.State = "published"
		out.Revision = item.CandidateRevision
	} else {
		if item.State != "pending" || !item.Current || state.Formal == nil || state.Formal.Revision != item.ExpectedRevision {
			return out, ErrStateConflict
		}
		if in.Decision == "approve" {
			if err = publishMetadata(ctx, tx, owner, actor, item); err != nil {
				return out, err
			}
			out.State = "published"
			out.Revision = item.CandidateRevision
		} else {
			var reviewer any = actor[:]
			if withdraw {
				out.State = "withdrawn"
				reviewer = nil
			}
			if _, err = tx.ExecContext(ctx, "UPDATE novel_metadata_submissions SET state=?,decision_reason=?,decided_by=?,decided_at=UTC_TIMESTAMP(6) WHERE id=?", out.State, in.Reason, reviewer, id[:]); err != nil {
				return out, err
			}
			if _, err = tx.ExecContext(ctx, "UPDATE novels SET metadata_submission_id=NULL,state_revision=state_revision+1 WHERE id=?", book[:]); err != nil {
				return out, err
			}
		}
	}
	if err = saveManagement(ctx, tx, actor, book, in.MutationID, hash, out); err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func (s Store) MetadataReceipt(ctx context.Context, actor, book, id uuid.UUID) (MetadataReceipt, error) {
	var out MetadataReceipt
	var raw []byte
	err := s.DB.QueryRowContext(ctx, "SELECT result FROM novel_management_requests WHERE actor_id=? AND novel_id=? AND mutation_id=?", actor[:], book[:], id[:]).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	if err = json.Unmarshal(raw, &out); err != nil {
		return out, err
	}
	if out.Operation != "submit_metadata" && out.Operation != "review_metadata" && out.Operation != "withdraw_metadata" {
		return MetadataReceipt{}, ErrNotFound
	}
	return out, nil
}
func (s Store) VisibilityReceipt(ctx context.Context, actor, book, id uuid.UUID) (VisibilityReceipt, error) {
	var out VisibilityReceipt
	var raw []byte
	err := s.DB.QueryRowContext(ctx, "SELECT result FROM novel_management_requests WHERE actor_id=? AND novel_id=? AND mutation_id=?", actor[:], book[:], id[:]).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	if err = json.Unmarshal(raw, &out); err != nil {
		return out, err
	}
	if out.Action != "hide" && out.Action != "restore" {
		return VisibilityReceipt{}, ErrNotFound
	}
	return out, nil
}
