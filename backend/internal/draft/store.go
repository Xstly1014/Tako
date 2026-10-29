package draft

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

var (
	ErrNotFound = errors.New("draft_not_found")
	ErrConflict = errors.New("revision_conflict")
	ErrKeyReuse = errors.New("mutation_id_reused")
	ErrInvalid  = errors.New("invalid_draft")
)

type Draft struct {
	ID       uuid.UUID `json:"id"`
	Title    string    `json:"title"`
	Content  string    `json:"content"`
	Revision uint64    `json:"revision"`
	SavedAt  time.Time `json:"saved_at"`
}

type Write struct {
	MutationID   uuid.UUID `json:"mutation_id"`
	DraftID      uuid.UUID `json:"draft_id,omitzero"`
	BaseRevision uint64    `json:"base_revision,omitempty"`
	Title        string    `json:"title"`
	Content      string    `json:"content"`
}

type Result struct {
	DraftID  uuid.UUID `json:"draft_id"`
	Revision uint64    `json:"revision"`
	SavedAt  time.Time `json:"saved_at"`
}

type Store struct{ DB *sql.DB }

func (s Store) Read(ctx context.Context, owner, id uuid.UUID) (Draft, error) {
	d := Draft{ID: id}
	err := s.DB.QueryRowContext(ctx, "SELECT title, content, revision,updated_at FROM drafts WHERE id=? AND owner_id=?", id[:], owner[:]).Scan(&d.Title, &d.Content, &d.Revision, &d.SavedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Draft{}, ErrNotFound
	}
	return d, err
}

// Write serializes each owner's mutations through their account row. This keeps
// retries deterministic, including concurrent creation and recovery requests.
// The coarse lock is deliberate for A; never hold it across SMTP or HTTP calls.
func (s Store) Write(ctx context.Context, owner uuid.UUID, op string, in Write) (Result, error) {
	if owner == uuid.Nil || in.MutationID == uuid.Nil || !utf8.ValidString(in.Title) || !utf8.ValidString(in.Content) || utf8.RuneCountInString(in.Title) > 200 || len(in.Content) > 1<<20 {
		return Result{}, ErrInvalid
	}
	if op != "create" && op != "save" && op != "recover" {
		return Result{}, ErrInvalid
	}
	if op != "create" && in.DraftID == uuid.Nil {
		return Result{}, ErrInvalid
	}
	if op == "save" && in.BaseRevision == 0 {
		return Result{}, ErrInvalid
	}
	encoded, err := json.Marshal(struct {
		Operation string
		Input     Write
	}{op, in})
	if err != nil {
		return Result{}, err
	}
	hash := sha256.Sum256(encoded)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Result{}, err
	}
	defer tx.Rollback()
	var accountID []byte
	if err = tx.QueryRowContext(ctx, "SELECT id FROM accounts WHERE id=? FOR UPDATE", owner[:]).Scan(&accountID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Result{}, ErrNotFound
		}
		return Result{}, err
	}
	var previousHash, previousID []byte
	var previousRevision uint64
	var previousSavedAt time.Time
	err = tx.QueryRowContext(ctx, "SELECT payload_hash, result_draft_id, result_revision,result_saved_at FROM draft_mutations WHERE owner_id=? AND mutation_id=?", owner[:], in.MutationID[:]).Scan(&previousHash, &previousID, &previousRevision, &previousSavedAt)
	if err == nil {
		if string(previousHash) != string(hash[:]) {
			return Result{}, ErrKeyReuse
		}
		id, parseErr := uuid.FromBytes(previousID)
		if parseErr != nil {
			return Result{}, parseErr
		}
		return Result{DraftID: id, Revision: previousRevision, SavedAt: previousSavedAt}, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Result{}, err
	}
	err = nil
	result := Result{Revision: 1}
	switch op {
	case "create", "recover":
		var source any
		if op == "recover" {
			var sourceID []byte
			err = tx.QueryRowContext(ctx, "SELECT id FROM drafts WHERE id=? AND owner_id=?", in.DraftID[:], owner[:]).Scan(&sourceID)
			if errors.Is(err, sql.ErrNoRows) {
				return Result{}, ErrNotFound
			}
			if err != nil {
				return Result{}, err
			}
			source = in.DraftID[:]
		}
		result.DraftID = uuid.New()
		_, err = tx.ExecContext(ctx, "INSERT INTO drafts (id,owner_id,title,content,recovered_from_id) VALUES (?,?,?,?,?)", result.DraftID[:], owner[:], in.Title, in.Content, source)
	case "save":
		res, execErr := tx.ExecContext(ctx, "UPDATE drafts SET title=?,content=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP(6) WHERE id=? AND owner_id=? AND revision=?", in.Title, in.Content, in.DraftID[:], owner[:], in.BaseRevision)
		if execErr != nil {
			return Result{}, execErr
		}
		count, countErr := res.RowsAffected()
		if countErr != nil {
			return Result{}, countErr
		}
		if count == 0 {
			var revision uint64
			err = tx.QueryRowContext(ctx, "SELECT revision FROM drafts WHERE id=? AND owner_id=?", in.DraftID[:], owner[:]).Scan(&revision)
			if errors.Is(err, sql.ErrNoRows) {
				return Result{}, ErrNotFound
			}
			if err != nil {
				return Result{}, err
			}
			return Result{}, ErrConflict
		}
		result = Result{DraftID: in.DraftID, Revision: in.BaseRevision + 1}
	}
	if err != nil {
		return Result{}, err
	}
	if err = tx.QueryRowContext(ctx, "SELECT updated_at FROM drafts WHERE id=? AND owner_id=?", result.DraftID[:], owner[:]).Scan(&result.SavedAt); err != nil {
		return Result{}, err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO draft_revisions (draft_id,revision,title,content,saved_at) VALUES (?,?,?,?,?)", result.DraftID[:], result.Revision, in.Title, in.Content, result.SavedAt)
	if err != nil {
		return Result{}, err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO draft_mutations (owner_id,mutation_id,operation,payload_hash,result_draft_id,result_revision,result_saved_at) VALUES (?,?,?,?,?,?,?)", owner[:], in.MutationID[:], op, hash[:], result.DraftID[:], result.Revision, result.SavedAt)
	if err != nil {
		return Result{}, fmt.Errorf("record mutation: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return Result{}, err
	}
	return result, nil
}
