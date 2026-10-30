package publication

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

const discoveryFrom = ` FROM works w JOIN work_versions v ON v.work_id=w.id AND v.version=w.display_version JOIN work_versions initial ON initial.work_id=w.id AND initial.version=1 JOIN accounts a ON a.id=w.owner_id `
const discoveryVisible = `w.author_hidden=FALSE AND w.platform_limited=FALSE AND v.platform_limited=FALSE`
const cardColumns = `w.id,v.version,v.title,v.introduction,v.tags,a.nickname,initial.published_at`

type WorkCard struct {
	ID               uuid.UUID `json:"id"`
	Version          uint64    `json:"version"`
	Title            string    `json:"title"`
	Introduction     string    `json:"introduction"`
	Tags             []string  `json:"tags"`
	AuthorNickname   string    `json:"author_nickname"`
	FirstPublishedAt time.Time `json:"first_published_at"`
}
type DiscoveryTag struct {
	Name  string `json:"name"`
	Count uint64 `json:"count"`
}
type DiscoveryPage struct {
	Items      []WorkCard     `json:"items"`
	Featured   []WorkCard     `json:"featured"`
	Tags       []DiscoveryTag `json:"tags"`
	NextCursor string         `json:"next_cursor"`
}
type discoveryCursor struct {
	Tag string    `json:"tag"`
	At  time.Time `json:"at"`
	ID  uuid.UUID `json:"id"`
}

func scanCard(row interface{ Scan(...any) error }) (WorkCard, error) {
	var c WorkCard
	var raw, tags []byte
	e := row.Scan(&raw, &c.Version, &c.Title, &c.Introduction, &tags, &c.AuthorNickname, &c.FirstPublishedAt)
	if errors.Is(e, sql.ErrNoRows) {
		return c, ErrNotFound
	}
	if e != nil {
		return c, e
	}
	c.ID, e = uuid.FromBytes(raw)
	if e != nil {
		return c, e
	}
	e = json.Unmarshal(tags, &c.Tags)
	return c, e
}
func validDiscoveryTag(tag string) bool {
	if tag == "" {
		return true
	}
	for _, t := range Tags {
		if t == tag {
			return true
		}
	}
	return false
}
func readCards(ctx context.Context, tx *sql.Tx, query string, args ...any) ([]WorkCard, error) {
	rows, e := tx.QueryContext(ctx, query, args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []WorkCard{}
	for rows.Next() {
		c, e := scanCard(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// The three sections share one snapshot; no draft body or old-version metadata
// enters discovery. First publication is V1's timestamp, never the last update.
func (s Store) Discover(ctx context.Context, tag, cursor string) (DiscoveryPage, error) {
	out := DiscoveryPage{Items: []WorkCard{}, Featured: []WorkCard{}, Tags: []DiscoveryTag{}}
	if !validDiscoveryTag(tag) || len(cursor) > 512 {
		return out, ErrInvalid
	}
	var after discoveryCursor
	if cursor != "" {
		raw, e := base64.RawURLEncoding.DecodeString(cursor)
		if e != nil || json.Unmarshal(raw, &after) != nil || after.ID == uuid.Nil || after.At.IsZero() || after.Tag != tag {
			return out, ErrInvalid
		}
	}
	tx, e := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	filter := ""
	args := []any{}
	if tag != "" {
		filter += " AND JSON_CONTAINS(v.tags,JSON_QUOTE(?))"
		args = append(args, tag)
	}
	if cursor != "" {
		filter += " AND (initial.published_at<? OR (initial.published_at=? AND w.id<?))"
		args = append(args, after.At, after.At, after.ID[:])
	}
	out.Items, e = readCards(ctx, tx, "SELECT "+cardColumns+discoveryFrom+" WHERE "+discoveryVisible+filter+" ORDER BY initial.published_at DESC,w.id DESC LIMIT 13", args...)
	if e != nil {
		return out, e
	}
	if len(out.Items) > 12 {
		last := out.Items[11]
		out.Items = out.Items[:12]
		raw, _ := json.Marshal(discoveryCursor{Tag: tag, At: last.FirstPublishedAt, ID: last.ID})
		out.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	out.Featured, e = readCards(ctx, tx, "SELECT "+cardColumns+discoveryFrom+" JOIN community_curations c ON c.work_id=w.id AND c.discovery_revision=w.discovery_revision WHERE "+discoveryVisible+" ORDER BY c.slot LIMIT 6")
	if e != nil {
		return out, e
	}
	rows, e := tx.QueryContext(ctx, `SELECT jt.name,COUNT(*)`+discoveryFrom+` JOIN JSON_TABLE(v.tags,'$[*]' COLUMNS(name VARCHAR(20) PATH '$')) jt WHERE `+discoveryVisible+` GROUP BY jt.name ORDER BY jt.name`)
	if e != nil {
		return out, e
	}
	for rows.Next() {
		var t DiscoveryTag
		if e = rows.Scan(&t.Name, &t.Count); e != nil {
			rows.Close()
			return out, e
		}
		out.Tags = append(out.Tags, t)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return out, e
	}
	return out, tx.Commit()
}

type CurationCandidate struct {
	Work          WorkCard `json:"work"`
	StateRevision uint64   `json:"state_revision"`
}

func (s Store) CurationCandidate(ctx context.Context, id uuid.UUID) (CurationCandidate, error) {
	var out CurationCandidate
	tx, e := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	out.Work, e = scanCard(tx.QueryRowContext(ctx, "SELECT "+cardColumns+discoveryFrom+" WHERE "+discoveryVisible+" AND w.id=?", id[:]))
	if e != nil {
		return out, e
	}
	e = tx.QueryRowContext(ctx, "SELECT state_revision FROM works WHERE id=?", id[:]).Scan(&out.StateRevision)
	if e != nil {
		return out, e
	}
	return out, tx.Commit()
}

type CurationSlot struct {
	Slot   uint64     `json:"slot"`
	WorkID *uuid.UUID `json:"work_id"`
	Work   *WorkCard  `json:"work"`
}
type CurationState struct {
	Revision uint64         `json:"revision"`
	Slots    []CurationSlot `json:"slots"`
}
type CurationChange struct {
	MutationID           uuid.UUID  `json:"mutation_id"`
	ExpectedRevision     uint64     `json:"expected_revision"`
	Slot                 uint64     `json:"slot"`
	WorkID               *uuid.UUID `json:"work_id"`
	ExpectedWorkRevision uint64     `json:"expected_work_revision"`
}
type CurationResult struct {
	Revision uint64 `json:"revision"`
}

var ErrCurationConflict = errors.New("curation_conflict")

func (s Store) Curations(ctx context.Context) (CurationState, error) {
	out := CurationState{Slots: []CurationSlot{}}
	tx, e := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	if e = tx.QueryRowContext(ctx, "SELECT revision FROM community_curation_state WHERE id=1").Scan(&out.Revision); e != nil {
		return out, e
	}
	rows, e := tx.QueryContext(ctx, "SELECT slot,work_id,discovery_revision FROM community_curations ORDER BY slot")
	if e != nil {
		return out, e
	}
	epochs := map[uint64]uint64{}
	for rows.Next() {
		var c CurationSlot
		var raw []byte
		var epoch uint64
		if e = rows.Scan(&c.Slot, &raw, &epoch); e != nil {
			rows.Close()
			return out, e
		}
		if raw != nil {
			id, e := uuid.FromBytes(raw)
			if e != nil {
				rows.Close()
				return out, e
			}
			c.WorkID = &id
		}
		out.Slots = append(out.Slots, c)
		epochs[c.Slot] = epoch
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return out, e
	}
	for i := range out.Slots {
		c := &out.Slots[i]
		if c.WorkID == nil {
			continue
		}
		card, err := scanCard(tx.QueryRowContext(ctx, "SELECT "+cardColumns+discoveryFrom+" WHERE "+discoveryVisible+" AND w.id=? AND w.discovery_revision=?", (*c.WorkID)[:], epochs[c.Slot]))
		if err != nil && !errors.Is(err, ErrNotFound) {
			return out, err
		}
		if err == nil {
			c.Work = &card
		}
	}
	return out, tx.Commit()
}

// A single six-slot editorial list has a global revision. Work state is checked
// under its row lock. Hide/limit advance a work generation; restoring visibility
// never reinstates a selection from a previous generation.
func (s Store) ChangeCuration(ctx context.Context, actor uuid.UUID, in CurationChange) (CurationResult, error) {
	if actor == uuid.Nil || in.MutationID == uuid.Nil || in.ExpectedRevision == 0 || in.ExpectedRevision >= MaxSequence || in.Slot < 1 || in.Slot > 6 || in.ExpectedWorkRevision > MaxSequence {
		return CurationResult{}, ErrInvalid
	}
	if (in.WorkID == nil && in.ExpectedWorkRevision != 0) || (in.WorkID != nil && (*in.WorkID == uuid.Nil || in.ExpectedWorkRevision == 0)) {
		return CurationResult{}, ErrInvalid
	}
	hash, e := digest(in)
	if e != nil {
		return CurationResult{}, e
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return CurationResult{}, e
	}
	defer tx.Rollback()
	var revision uint64
	if e = tx.QueryRowContext(ctx, "SELECT revision FROM community_curation_state WHERE id=1 FOR UPDATE").Scan(&revision); e != nil {
		return CurationResult{}, e
	}
	var oldHash, result []byte
	e = tx.QueryRowContext(ctx, "SELECT payload_hash,result FROM community_curation_mutations WHERE actor_id=? AND mutation_id=?", actor[:], in.MutationID[:]).Scan(&oldHash, &result)
	if e == nil {
		if string(oldHash) != string(hash[:]) {
			return CurationResult{}, ErrKeyReuse
		}
		var out CurationResult
		if e = json.Unmarshal(result, &out); e != nil {
			return out, e
		}
		return out, tx.Commit()
	}
	if !errors.Is(e, sql.ErrNoRows) {
		return CurationResult{}, e
	}
	if revision != in.ExpectedRevision || revision >= MaxSequence {
		return CurationResult{}, ErrCurationConflict
	}
	var work any
	var generation uint64
	if in.WorkID != nil {
		var hidden, limited bool
		var display, state uint64
		e = tx.QueryRowContext(ctx, "SELECT author_hidden,platform_limited,display_version,state_revision,discovery_revision FROM works WHERE id=? FOR UPDATE", (*in.WorkID)[:]).Scan(&hidden, &limited, &display, &state, &generation)
		if errors.Is(e, sql.ErrNoRows) {
			return CurationResult{}, ErrNotFound
		}
		if e != nil {
			return CurationResult{}, e
		}
		if state != in.ExpectedWorkRevision {
			return CurationResult{}, ErrStateConflict
		}
		if hidden || limited {
			return CurationResult{}, ErrNotFound
		}
		if e = tx.QueryRowContext(ctx, "SELECT platform_limited FROM work_versions WHERE work_id=? AND version=?", (*in.WorkID)[:], display).Scan(&limited); e != nil {
			return CurationResult{}, e
		}
		if limited {
			return CurationResult{}, ErrNotFound
		}
		work = (*in.WorkID)[:]
		if _, e = tx.ExecContext(ctx, "UPDATE community_curations SET work_id=NULL,discovery_revision=0 WHERE work_id=?", work); e != nil {
			return CurationResult{}, e
		}
	}
	if _, e = tx.ExecContext(ctx, "UPDATE community_curations SET work_id=?,discovery_revision=?,selected_by=?,selected_at=UTC_TIMESTAMP(6) WHERE slot=?", work, generation, actor[:], in.Slot); e != nil {
		return CurationResult{}, e
	}
	out := CurationResult{Revision: revision + 1}
	result, e = json.Marshal(out)
	if e != nil {
		return out, e
	}
	if _, e = tx.ExecContext(ctx, "UPDATE community_curation_state SET revision=? WHERE id=1", out.Revision); e != nil {
		return out, e
	}
	if _, e = tx.ExecContext(ctx, "INSERT INTO community_curation_mutations(actor_id,mutation_id,payload_hash,input,result) VALUES(?,?,?,?,?)", actor[:], in.MutationID[:], hash[:], mustCurationInput(in), result); e != nil {
		return out, e
	}
	return out, tx.Commit()
}

func mustCurationInput(in CurationChange) []byte { raw, _ := json.Marshal(in); return raw }
