package publication

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

var ErrStateConflict = errors.New("work_state_conflict")
var ErrVersionUnavailable = errors.New("version_unavailable")
var ErrWorkRestricted = errors.New("work_restricted")

type State struct {
	ID              uuid.UUID `json:"id"`
	DraftID         uuid.UUID `json:"draft_id"`
	LastVersion     uint64    `json:"last_version"`
	DisplayVersion  uint64    `json:"display_version"`
	AuthorHidden    bool      `json:"author_hidden"`
	HistoryOpen     bool      `json:"history_open"`
	PlatformLimited bool      `json:"platform_limited"`
	StateRevision   uint64    `json:"state_revision"`
}

const stateFields = "id,source_draft_id,last_version,display_version,author_hidden,history_open,platform_limited,state_revision"

func scanState(row interface{ Scan(...any) error }) (State, error) {
	var s State
	var id, draft []byte
	e := row.Scan(&id, &draft, &s.LastVersion, &s.DisplayVersion, &s.AuthorHidden, &s.HistoryOpen, &s.PlatformLimited, &s.StateRevision)
	if errors.Is(e, sql.ErrNoRows) {
		return s, ErrNotFound
	}
	if e != nil {
		return s, e
	}
	if s.ID, e = uuid.FromBytes(id); e != nil {
		return s, e
	}
	s.DraftID, e = uuid.FromBytes(draft)
	return s, e
}
func (s Store) AuthorState(ctx context.Context, owner, id uuid.UUID) (State, error) {
	return scanState(s.DB.QueryRowContext(ctx, "SELECT "+stateFields+" FROM works WHERE id=? AND owner_id=?", id[:], owner[:]))
}

type Change struct {
	MutationID            uuid.UUID `json:"mutation_id"`
	ExpectedStateRevision uint64    `json:"expected_state_revision"`
	Action                string    `json:"action"`
	Version               *uint64   `json:"version,omitempty"`
	HistoryOpen           *bool     `json:"history_open,omitempty"`
}

func (s Store) Change(ctx context.Context, owner, id uuid.UUID, in Change) (State, error) {
	if in.MutationID == uuid.Nil || id == uuid.Nil || in.ExpectedStateRevision == 0 || in.ExpectedStateRevision > MaxSequence {
		return State{}, ErrInvalid
	}
	switch in.Action {
	case "hide":
		if in.Version != nil || in.HistoryOpen != nil {
			return State{}, ErrInvalid
		}
	case "restore":
		if in.HistoryOpen != nil {
			return State{}, ErrInvalid
		}
	case "switch_display":
		if in.Version == nil || in.HistoryOpen != nil {
			return State{}, ErrInvalid
		}
	case "set_history":
		if in.HistoryOpen == nil || in.Version != nil {
			return State{}, ErrInvalid
		}
	default:
		return State{}, ErrInvalid
	}
	if in.Version != nil && (*in.Version == 0 || *in.Version > MaxSequence) {
		return State{}, ErrInvalid
	}
	hash, e := digest(struct {
		WorkID uuid.UUID
		Input  Change
	}{id, in})
	if e != nil {
		return State{}, e
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return State{}, e
	}
	defer tx.Rollback()
	if e = lockOwner(ctx, tx, owner); e != nil {
		return State{}, e
	}
	var oldHash, oldResult []byte
	e = tx.QueryRowContext(ctx, "SELECT payload_hash,result FROM work_state_mutations WHERE owner_id=? AND mutation_id=?", owner[:], in.MutationID[:]).Scan(&oldHash, &oldResult)
	if e == nil {
		if string(oldHash) != string(hash[:]) {
			return State{}, ErrKeyReuse
		}
		var result State
		if e = json.Unmarshal(oldResult, &result); e != nil {
			return State{}, e
		}
		return result, tx.Commit()
	}
	if !errors.Is(e, sql.ErrNoRows) {
		return State{}, e
	}
	current, e := scanState(tx.QueryRowContext(ctx, "SELECT "+stateFields+" FROM works WHERE id=? AND owner_id=? FOR UPDATE", id[:], owner[:]))
	if e != nil {
		return State{}, e
	}
	if current.StateRevision != in.ExpectedStateRevision || current.StateRevision >= MaxSequence {
		return State{}, ErrStateConflict
	}
	before := current
	kind := ""
	available := func(version uint64) error {
		var limited bool
		e := tx.QueryRowContext(ctx, "SELECT platform_limited FROM work_versions WHERE work_id=? AND version=?", id[:], version).Scan(&limited)
		if errors.Is(e, sql.ErrNoRows) || limited {
			return ErrVersionUnavailable
		}
		return e
	}
	switch in.Action {
	case "hide":
		current.AuthorHidden = true
		kind = "hidden"
	case "set_history":
		current.HistoryOpen = *in.HistoryOpen
		kind = "history_closed"
		if current.HistoryOpen {
			kind = "history_opened"
		}
	case "switch_display":
		if e = available(*in.Version); e != nil {
			return State{}, e
		}
		current.DisplayVersion = *in.Version
		kind = "display_changed"
	case "restore":
		if !current.AuthorHidden {
			return State{}, ErrInvalid
		}
		if current.PlatformLimited {
			return State{}, ErrWorkRestricted
		}
		target := current.LastVersion
		latestErr := available(target)
		if latestErr != nil && !errors.Is(latestErr, ErrVersionUnavailable) {
			return State{}, latestErr
		}
		if in.Version != nil {
			if latestErr == nil && *in.Version != target {
				return State{}, ErrInvalid
			}
			target = *in.Version
		}
		if e = available(target); e != nil {
			return State{}, e
		}
		current.AuthorHidden = false
		current.DisplayVersion = target
		kind = "restored"
	}
	if current != before {
		current.StateRevision++
		_, e = tx.ExecContext(ctx, "UPDATE works SET display_version=?,author_hidden=?,history_open=?,state_revision=? WHERE id=? AND owner_id=?", current.DisplayVersion, current.AuthorHidden, current.HistoryOpen, current.StateRevision, id[:], owner[:])
		if e != nil {
			return State{}, e
		}
		public := !current.AuthorHidden && !current.PlatformLimited && (kind == "display_changed" || kind == "restored")
		_, e = tx.ExecContext(ctx, "INSERT INTO work_events (work_id,sequence,kind,version,public_visible,created_at) VALUES (?,?,?,?,?,?)", id[:], current.StateRevision, kind, current.DisplayVersion, public, time.Now().UTC().Truncate(time.Microsecond))
		if e != nil {
			return State{}, e
		}
	}
	result, e := json.Marshal(current)
	if e != nil {
		return State{}, e
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO work_state_mutations (owner_id,mutation_id,payload_hash,work_id,result,created_at) VALUES (?,?,?,?,?,?)", owner[:], in.MutationID[:], hash[:], id[:], result, time.Now().UTC().Truncate(time.Microsecond))
	if e != nil {
		return State{}, e
	}
	return current, tx.Commit()
}

// Author reading is separate from the anonymous permission path. Moderation does
// not remove the author's ability to inspect or export their own fixed content.
func (s Store) AuthorVersion(ctx context.Context, owner, id uuid.UUID, version uint64) (Work, error) {
	out := Work{ID: id}
	var tags []byte
	e := s.DB.QueryRowContext(ctx, `SELECT v.version,v.title,v.content,v.introduction,v.tags,a.nickname,v.published_at FROM works w JOIN work_versions v ON v.work_id=w.id JOIN accounts a ON a.id=w.owner_id WHERE w.id=? AND w.owner_id=? AND v.version=?`, id[:], owner[:], version).Scan(&out.Version, &out.Title, &out.Content, &out.Introduction, &tags, &out.AuthorNickname, &out.PublishedAt)
	if errors.Is(e, sql.ErrNoRows) {
		return Work{}, ErrNotFound
	}
	if e != nil {
		return Work{}, e
	}
	e = json.Unmarshal(tags, &out.Tags)
	return out, e
}
