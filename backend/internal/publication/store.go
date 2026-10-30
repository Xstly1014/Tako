package publication

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
)

var (
	ErrInvalid     = errors.New("invalid_input")
	ErrNotFound    = errors.New("resource_not_found")
	ErrSource      = errors.New("source_revision_unavailable")
	ErrExpired     = errors.New("preview_expired")
	ErrKeyReuse    = errors.New("mutation_id_reused")
	ErrConflict    = errors.New("publication_conflict")
	ErrUnsupported = errors.New("unsupported_publication_state")
	ErrNickname    = errors.New("nickname_required")
	ErrLimited     = errors.New("rate_limited")
)

const MaxSequence uint64 = 9007199254740991

var Tags = []string{"幻想", "冒险", "日常", "情感", "悬疑", "科幻"}

type Store struct {
	DB              *sql.DB
	ModerationClock func() time.Time
}
type Prepare struct {
	MutationID      uuid.UUID `json:"mutation_id"`
	DraftID         uuid.UUID `json:"draft_id"`
	SourceRevision  uint64    `json:"source_revision"`
	Introduction    string    `json:"introduction"`
	Tags            []string  `json:"tags"`
	RightsConfirmed bool      `json:"rights_confirmed"`
}
type Preview struct {
	ID              uuid.UUID `json:"id"`
	DraftID         uuid.UUID `json:"draft_id"`
	SourceRevision  uint64    `json:"source_revision"`
	ExpectedVersion uint64    `json:"expected_version"`
	Title           string    `json:"title"`
	Content         string    `json:"content"`
	Introduction    string    `json:"introduction"`
	Tags            []string  `json:"tags"`
	CreatedAt       time.Time `json:"created_at"`
	ExpiresAt       time.Time `json:"expires_at"`
	Published       *Result   `json:"published,omitempty"`
}
type Publish struct {
	MutationID      uuid.UUID `json:"mutation_id"`
	PreviewID       uuid.UUID `json:"preview_id"`
	ExpectedVersion uint64    `json:"expected_version"`
}
type Result struct {
	WorkID       uuid.UUID `json:"work_id"`
	Version      uint64    `json:"version"`
	PublishedAt  time.Time `json:"published_at"`
	ReviewStatus string    `json:"review_status"`
}

func digest(v any) ([32]byte, error) { b, e := json.Marshal(v); return sha256.Sum256(b), e }
func normalized(in Prepare) (Prepare, error) {
	if in.MutationID == uuid.Nil || in.DraftID == uuid.Nil || in.SourceRevision == 0 || in.SourceRevision > MaxSequence || !in.RightsConfirmed || !utf8.ValidString(in.Introduction) || utf8.RuneCountInString(in.Introduction) > 300 || len(in.Tags) < 1 || len(in.Tags) > 3 {
		return in, ErrInvalid
	}
	in.Tags = append([]string(nil), in.Tags...)
	sort.Strings(in.Tags)
	for i, t := range in.Tags {
		found := false
		for _, valid := range Tags {
			if t == valid {
				found = true
				break
			}
		}
		if !found || (i > 0 && t == in.Tags[i-1]) {
			return in, ErrInvalid
		}
	}
	return in, nil
}
func lockOwner(ctx context.Context, tx *sql.Tx, owner uuid.UUID) error {
	var nickname string
	e := tx.QueryRowContext(ctx, "SELECT nickname FROM accounts WHERE id=? FOR UPDATE", owner[:]).Scan(&nickname)
	if errors.Is(e, sql.ErrNoRows) {
		return ErrNotFound
	}
	if e != nil {
		return e
	}
	if strings.TrimSpace(nickname) == "" {
		return ErrNickname
	}
	return nil
}
func policy(ctx context.Context, tx *sql.Tx, owner uuid.UUID, now time.Time) error {
	var until sql.NullTime
	e := tx.QueryRowContext(ctx, "SELECT observation_until FROM publication_policies WHERE owner_id=?", owner[:]).Scan(&until)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		return e
	}
	if until.Valid && until.Time.After(now) {
		return ErrUnsupported
	}
	return nil
}
func scanPreview(row interface{ Scan(...any) error }) (Preview, error) {
	var out Preview
	var id, draft, tags []byte
	var title, content, intro sql.NullString
	e := row.Scan(&id, &draft, &out.SourceRevision, &out.ExpectedVersion, &title, &content, &intro, &tags, &out.CreatedAt, &out.ExpiresAt)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	if out.ID, e = uuid.FromBytes(id); e != nil {
		return out, e
	}
	if out.DraftID, e = uuid.FromBytes(draft); e != nil {
		return out, e
	}
	if !content.Valid {
		return out, ErrExpired
	}
	out.Title = title.String
	out.Content = content.String
	out.Introduction = intro.String
	if e = json.Unmarshal(tags, &out.Tags); e != nil {
		return out, e
	}
	return out, nil
}

const previewFields = "id,draft_id,source_revision,expected_version,title,content,introduction,tags,created_at,expires_at"

func (s Store) ReadPreview(ctx context.Context, owner, id uuid.UUID) (Preview, error) {
	out, e := scanPreview(s.DB.QueryRowContext(ctx, "SELECT "+previewFields+" FROM publication_previews WHERE id=? AND owner_id=?", id[:], owner[:]))
	if e != nil {
		return out, e
	}
	var consumedID []byte
	var consumedVersion sql.NullInt64
	var consumedAt sql.NullTime
	e = s.DB.QueryRowContext(ctx, "SELECT consumed_work_id,consumed_version,consumed_at FROM publication_previews WHERE id=? AND owner_id=?", id[:], owner[:]).Scan(&consumedID, &consumedVersion, &consumedAt)
	if e != nil {
		return Preview{}, e
	}
	if consumedAt.Valid {
		work, e := uuid.FromBytes(consumedID)
		if e != nil {
			return Preview{}, e
		}
		out.Published = &Result{WorkID: work, Version: uint64(consumedVersion.Int64), PublishedAt: consumedAt.Time, ReviewStatus: "pending"}
	} else if !time.Now().UTC().Before(out.ExpiresAt) {
		return Preview{}, ErrExpired
	}
	return out, nil
}
func (s Store) Prepare(ctx context.Context, owner uuid.UUID, in Prepare) (Preview, error) {
	in, e := normalized(in)
	if e != nil {
		return Preview{}, e
	}
	hash, e := digest(in)
	if e != nil {
		return Preview{}, e
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return Preview{}, e
	}
	defer tx.Rollback()
	if e = lockOwner(ctx, tx, owner); e != nil {
		return Preview{}, e
	}
	var oldID, oldHash []byte
	e = tx.QueryRowContext(ctx, "SELECT id,payload_hash FROM publication_previews WHERE owner_id=? AND mutation_id=?", owner[:], in.MutationID[:]).Scan(&oldID, &oldHash)
	if e == nil {
		if string(oldHash) != string(hash[:]) {
			return Preview{}, ErrKeyReuse
		}
		id, e := uuid.FromBytes(oldID)
		if e != nil {
			return Preview{}, e
		}
		if e = tx.Commit(); e != nil {
			return Preview{}, e
		}
		return s.ReadPreview(ctx, owner, id)
	}
	if !errors.Is(e, sql.ErrNoRows) {
		return Preview{}, e
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	var count int
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM publication_previews WHERE owner_id=? AND created_at>?", owner[:], now.Add(-time.Hour)).Scan(&count); e != nil {
		return Preview{}, e
	}
	// Capacity guard, not a quality judgement. Replays do not consume this budget.
	if count >= 30 {
		return Preview{}, ErrLimited
	}
	var title, content string
	e = tx.QueryRowContext(ctx, "SELECT r.title,r.content FROM draft_revisions r JOIN drafts d ON d.id=r.draft_id WHERE r.draft_id=? AND r.revision=? AND d.owner_id=?", in.DraftID[:], in.SourceRevision, owner[:]).Scan(&title, &content)
	if errors.Is(e, sql.ErrNoRows) {
		var id []byte
		err := tx.QueryRowContext(ctx, "SELECT id FROM drafts WHERE id=? AND owner_id=?", in.DraftID[:], owner[:]).Scan(&id)
		if errors.Is(err, sql.ErrNoRows) {
			return Preview{}, ErrNotFound
		}
		if err != nil {
			return Preview{}, err
		}
		return Preview{}, ErrSource
	}
	if e != nil {
		return Preview{}, e
	}
	if strings.TrimSpace(title) == "" || strings.TrimSpace(content) == "" || utf8.RuneCountInString(title) > 200 || len(content) > 1<<20 {
		return Preview{}, ErrInvalid
	}
	var expected uint64
	e = tx.QueryRowContext(ctx, "SELECT last_version FROM works WHERE source_draft_id=? AND owner_id=?", in.DraftID[:], owner[:]).Scan(&expected)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		return Preview{}, e
	}
	out := Preview{ID: uuid.New(), DraftID: in.DraftID, SourceRevision: in.SourceRevision, ExpectedVersion: expected, Title: title, Content: content, Introduction: in.Introduction, Tags: in.Tags, CreatedAt: now, ExpiresAt: now.Add(24 * time.Hour)}
	tags, _ := json.Marshal(in.Tags)
	_, e = tx.ExecContext(ctx, "INSERT INTO publication_previews (id,owner_id,mutation_id,payload_hash,draft_id,source_revision,expected_version,title,content,introduction,tags,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", out.ID[:], owner[:], in.MutationID[:], hash[:], in.DraftID[:], in.SourceRevision, expected, title, content, in.Introduction, tags, now, out.ExpiresAt)
	if e != nil {
		return Preview{}, e
	}
	return out, tx.Commit()
}
func (s Store) Publish(ctx context.Context, owner uuid.UUID, in Publish) (Result, error) {
	if owner == uuid.Nil || in.PreviewID == uuid.Nil || in.MutationID == uuid.Nil || in.ExpectedVersion > MaxSequence {
		return Result{}, ErrInvalid
	}
	hash, e := digest(in)
	if e != nil {
		return Result{}, e
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return Result{}, e
	}
	defer tx.Rollback()
	if e = lockOwner(ctx, tx, owner); e != nil {
		return Result{}, e
	}
	result := Result{ReviewStatus: "pending"}
	var oldHash, workID []byte
	e = tx.QueryRowContext(ctx, "SELECT payload_hash,work_id,version,published_at FROM publication_mutations WHERE owner_id=? AND mutation_id=?", owner[:], in.MutationID[:]).Scan(&oldHash, &workID, &result.Version, &result.PublishedAt)
	if e == nil {
		if string(oldHash) != string(hash[:]) {
			return Result{}, ErrKeyReuse
		}
		if result.WorkID, e = uuid.FromBytes(workID); e != nil {
			return Result{}, e
		}
		return result, tx.Commit()
	}
	if !errors.Is(e, sql.ErrNoRows) {
		return Result{}, e
	}
	var consumedID []byte
	var consumedVersion sql.NullInt64
	var consumedAt sql.NullTime
	e = tx.QueryRowContext(ctx, "SELECT consumed_work_id,consumed_version,consumed_at FROM publication_previews WHERE id=? AND owner_id=? FOR UPDATE", in.PreviewID[:], owner[:]).Scan(&consumedID, &consumedVersion, &consumedAt)
	if errors.Is(e, sql.ErrNoRows) {
		return Result{}, ErrNotFound
	}
	if e != nil {
		return Result{}, e
	}
	preview, e := scanPreview(tx.QueryRowContext(ctx, "SELECT "+previewFields+" FROM publication_previews WHERE id=? AND owner_id=?", in.PreviewID[:], owner[:]))
	if e != nil {
		return Result{}, e
	}
	if in.ExpectedVersion != preview.ExpectedVersion {
		return Result{}, ErrConflict
	}
	if consumedAt.Valid {
		if result.WorkID, e = uuid.FromBytes(consumedID); e != nil {
			return Result{}, e
		}
		result.Version = uint64(consumedVersion.Int64)
		result.PublishedAt = consumedAt.Time
	} else {
		now := time.Now().UTC().Truncate(time.Microsecond)
		if !now.Before(preview.ExpiresAt) {
			return Result{}, ErrExpired
		}
		if e = policy(ctx, tx, owner, now); e != nil {
			return Result{}, e
		}
		var workBytes []byte
		var last uint64
		stateRevision := uint64(1)
		e = tx.QueryRowContext(ctx, "SELECT id,last_version,state_revision FROM works WHERE source_draft_id=? AND owner_id=? FOR UPDATE", preview.DraftID[:], owner[:]).Scan(&workBytes, &last, &stateRevision)
		if errors.Is(e, sql.ErrNoRows) {
			result.WorkID = uuid.New()
			_, e = tx.ExecContext(ctx, "INSERT INTO works (id,owner_id,source_draft_id,created_at) VALUES (?,?,?,?)", result.WorkID[:], owner[:], preview.DraftID[:], now)
		} else if e == nil {
			result.WorkID, e = uuid.FromBytes(workBytes)
		}
		if e != nil {
			return Result{}, e
		}
		if last != in.ExpectedVersion || last >= MaxSequence || stateRevision >= MaxSequence {
			return Result{}, ErrConflict
		}
		result.Version = last + 1
		result.PublishedAt = now
		tags, _ := json.Marshal(preview.Tags)
		_, e = tx.ExecContext(ctx, "INSERT INTO work_versions (work_id,version,preview_id,title,content,introduction,tags,published_at) VALUES (?,?,?,?,?,?,?,?)", result.WorkID[:], result.Version, preview.ID[:], preview.Title, preview.Content, preview.Introduction, tags, now)
		if e != nil {
			return Result{}, e
		}
		_, e = tx.ExecContext(ctx, "UPDATE works SET last_version=?,display_version=?,state_revision=state_revision+1 WHERE id=?", result.Version, result.Version, result.WorkID[:])
		if e != nil {
			return Result{}, e
		}
		_, e = tx.ExecContext(ctx, "INSERT INTO publication_review_tasks (work_id,version,first_waiting_at) VALUES (?,?,?)", result.WorkID[:], result.Version, now)
		if e != nil {
			return Result{}, e
		}
		_, e = tx.ExecContext(ctx, "UPDATE publication_previews SET consumed_work_id=?,consumed_version=?,consumed_at=? WHERE id=?", result.WorkID[:], result.Version, now, preview.ID[:])
		if e != nil {
			return Result{}, e
		}
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO publication_mutations (owner_id,mutation_id,payload_hash,work_id,version,published_at) VALUES (?,?,?,?,?,?)", owner[:], in.MutationID[:], hash[:], result.WorkID[:], result.Version, result.PublishedAt)
	if e != nil {
		return Result{}, e
	}
	return result, tx.Commit()
}

// SuggestedLength counts the same non-whitespace Unicode characters as the UI.
func SuggestedLength(content string) int {
	n := 0
	for _, r := range content {
		if !unicode.IsSpace(r) {
			n++
		}
	}
	return n
}
