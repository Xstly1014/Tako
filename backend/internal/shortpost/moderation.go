package shortpost

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
	ErrInvalidAction  = errors.New("invalid short-post action")
	ErrStateConflict  = errors.New("short-post state changed")
	ErrPostRestricted = errors.New("short post is restricted")
)

type PostAction struct {
	MutationID       uuid.UUID  `json:"mutation_id"`
	ExpectedRevision uint64     `json:"expected_revision"`
	Action           string     `json:"action"`
	Reason           string     `json:"reason,omitempty"`
	Version          uint64     `json:"version,omitempty"`
	RevisionID       *uuid.UUID `json:"revision_id,omitempty"`
}

type PostState struct {
	ID              uuid.UUID  `json:"id"`
	Revision        uint64     `json:"state_revision"`
	ReviewStatus    string     `json:"review_status"`
	AuthorHidden    bool       `json:"author_hidden"`
	PlatformLimited bool       `json:"platform_limited"`
	PublishedAt     *time.Time `json:"published_at"`
}

type ManagedPost struct {
	PostState
	Title          string          `json:"title"`
	Content        string          `json:"content"`
	SubmittedAt    time.Time       `json:"submitted_at"`
	Images         []ImageMetadata `json:"images"`
	DisplayVersion uint64          `json:"display_version"`
	HistoryEnabled bool            `json:"history_enabled"`
	Reason         string          `json:"review_reason"`
}

func (s PostStore) Manage(ctx context.Context, post, owner uuid.UUID) (ManagedPost, error) {
	var out ManagedPost
	out.ID = post
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	var ownerID, preview uuid.UUID
	query := `SELECT s.owner_id,p.id,s.state_revision,s.review_status,s.author_hidden,s.platform_limited,
 s.first_published_at,s.submitted_at,p.title,p.content,s.display_version,s.history_enabled,
 COALESCE((SELECT reason FROM short_post_actions WHERE post_id=s.id AND target_revision_id IS NULL AND target_version IS NULL AND action IN ('approve','reject','limit','revoke_limit')
 ORDER BY state_revision DESC LIMIT 1),'')
 FROM short_posts s
 LEFT JOIN short_post_versions v ON v.post_id=s.id AND v.version=s.display_version AND ?
 JOIN short_post_previews p ON p.owner_id=s.owner_id AND p.id=COALESCE(v.preview_id,s.preview_id) WHERE s.id=?`
	args := []any{owner != uuid.Nil, post[:]}
	if owner != uuid.Nil {
		query += " AND s.owner_id=?"
		args = append(args, owner[:])
	}
	err = tx.QueryRowContext(ctx, query, args...).Scan(&ownerID, &preview, &out.Revision, &out.ReviewStatus,
		&out.AuthorHidden, &out.PlatformLimited, &out.PublishedAt, &out.SubmittedAt, &out.Title, &out.Content, &out.DisplayVersion, &out.HistoryEnabled, &out.Reason)
	if err != nil {
		return out, err
	}
	out.Images, err = previewImages(ctx, tx, ownerID, preview)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}

func (s PostStore) ReviewImage(ctx context.Context, post, image uuid.UUID) (string, []byte, error) {
	var mediaType string
	var content []byte
	err := s.DB.QueryRowContext(ctx, `SELECT i.media_type,i.content FROM short_posts s
 JOIN short_post_preview_images p ON p.owner_id=s.owner_id AND p.preview_id=s.preview_id
 JOIN short_post_images i ON i.owner_id=p.owner_id AND i.id=p.image_id
 WHERE s.id=? AND i.id=?`, post[:], image[:]).Scan(&mediaType, &content)
	return mediaType, content, err
}

func (s PostStore) ChangeState(ctx context.Context, actor, post uuid.UUID, operator bool, in PostAction) (PostState, error) {
	const maxRevision = 9007199254740991
	in.Reason = strings.TrimSpace(in.Reason)
	ownerAction := in.Action == "hide" || in.Action == "restore" || in.Action == "history_open" || in.Action == "history_close" || in.Action == "show_version"
	versionLimit := in.Action == "limit_version" || in.Action == "revoke_version_limit"
	operatorAction := in.Action == "approve" || in.Action == "reject" || in.Action == "limit" || in.Action == "revoke_limit" || versionLimit
	if actor == uuid.Nil || post == uuid.Nil || in.MutationID == uuid.Nil || in.ExpectedRevision == 0 || in.ExpectedRevision >= maxRevision ||
		(operator && !operatorAction) || (!operator && !ownerAction) ||
		(in.Action == "show_version" || versionLimit) != (in.Version > 0) || in.Version > maxRevision ||
		(in.RevisionID != nil && (!operator || *in.RevisionID == uuid.Nil || (in.Action != "approve" && in.Action != "reject"))) ||
		!utf8.ValidString(in.Reason) || utf8.RuneCountInString(in.Reason) > 500 || (!operator && in.Reason != "") ||
		(operator && in.Action != "approve" && in.Reason == "") {
		return PostState{}, ErrInvalidAction
	}
	payload, err := json.Marshal(in)
	if err != nil {
		return PostState{}, err
	}
	digest := sha256.Sum256(payload)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return PostState{}, err
	}
	defer tx.Rollback()
	var locked uuid.UUID
	if err = tx.QueryRowContext(ctx, "SELECT id FROM accounts WHERE id=? FOR UPDATE", actor[:]).Scan(&locked); err != nil {
		return PostState{}, err
	}
	out := PostState{ID: post}
	var priorPost uuid.UUID
	var priorHash, receipt []byte
	err = tx.QueryRowContext(ctx, "SELECT post_id,payload_hash,receipt FROM short_post_actions WHERE actor_id=? AND mutation_id=?", actor[:], in.MutationID[:]).Scan(&priorPost, &priorHash, &receipt)
	if err == nil {
		if priorPost != post || !bytes.Equal(digest[:], priorHash) {
			return PostState{}, ErrPreviewIDReused
		}
		if err = json.Unmarshal(receipt, &out); err != nil {
			return PostState{}, err
		}
		return out, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PostState{}, err
	}
	var lastVersion, displayVersion uint64
	var history bool
	query := `SELECT state_revision,review_status,author_hidden,platform_limited,first_published_at,last_version,display_version,history_enabled
 FROM short_posts WHERE id=?`
	args := []any{post[:]}
	if !operator {
		query += " AND owner_id=?"
		args = append(args, actor[:])
	}
	err = tx.QueryRowContext(ctx, query+" FOR UPDATE", args...).Scan(&out.Revision, &out.ReviewStatus, &out.AuthorHidden, &out.PlatformLimited, &out.PublishedAt, &lastVersion, &displayVersion, &history)
	if err != nil {
		return PostState{}, err
	}
	if out.Revision != in.ExpectedRevision {
		return PostState{}, ErrStateConflict
	}
	switch {
	case versionLimit:
		if err = changeVersionLimit(ctx, tx, post, in.Version, in.Action == "limit_version"); err != nil {
			return PostState{}, err
		}
		if in.Version == 1 && in.Action == "limit_version" {
			out.ReviewStatus = "reviewed"
		}
	case in.RevisionID != nil:
		if lastVersion == 0 {
			return PostState{}, ErrStateConflict
		}
		priorLast := lastVersion
		lastVersion, err = decideRevision(ctx, tx, post, *in.RevisionID, lastVersion, in.Action == "approve", in.Reason)
		if err != nil {
			return PostState{}, err
		}
		if lastVersion != priorLast {
			displayVersion = lastVersion
		}
	case in.Action == "history_open" || in.Action == "history_close":
		open := in.Action == "history_open"
		if lastVersion == 0 || history == open {
			return PostState{}, ErrStateConflict
		}
		history = open
	case in.Action == "show_version":
		if in.Version > lastVersion || in.Version == displayVersion {
			return PostState{}, ErrStateConflict
		}
		if out.PlatformLimited {
			return PostState{}, ErrPostRestricted
		}
		var limited bool
		if err = tx.QueryRowContext(ctx, "SELECT platform_limited FROM short_post_versions WHERE post_id=? AND version=? FOR UPDATE", post[:], in.Version).Scan(&limited); err != nil {
			return PostState{}, err
		}
		if limited {
			return PostState{}, ErrPostRestricted
		}
		displayVersion = in.Version
	default:
		if err = applyPostAction(ctx, tx, &out, in.Action); err != nil {
			return PostState{}, err
		}
		if in.Action == "restore" {
			err = tx.QueryRowContext(ctx, "SELECT version FROM short_post_versions WHERE post_id=? AND platform_limited=FALSE ORDER BY version DESC LIMIT 1 FOR UPDATE", post[:]).Scan(&displayVersion)
			if errors.Is(err, sql.ErrNoRows) {
				return PostState{}, ErrPostRestricted
			}
			if err != nil {
				return PostState{}, err
			}
		}
	}
	firstPublication := lastVersion == 0 && out.PublishedAt != nil
	if firstPublication {
		lastVersion, displayVersion = 1, 1
	}
	out.Revision++
	if _, err = tx.ExecContext(ctx, `UPDATE short_posts SET state_revision=?,review_status=?,author_hidden=?,platform_limited=?,first_published_at=?,last_version=?,display_version=?,history_enabled=? WHERE id=?`,
		out.Revision, out.ReviewStatus, out.AuthorHidden, out.PlatformLimited, out.PublishedAt, lastVersion, displayVersion, history, post[:]); err != nil {
		return PostState{}, err
	}
	if firstPublication {
		if err = insertFirstVersion(ctx, tx, post); err != nil {
			return PostState{}, err
		}
	}
	receipt, err = json.Marshal(out)
	if err != nil {
		return PostState{}, err
	}
	var targetRevision, targetVersion any
	if versionLimit {
		targetVersion = in.Version
	}
	if in.RevisionID != nil {
		targetRevision = (*in.RevisionID)[:]
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO short_post_actions(actor_id,mutation_id,post_id,state_revision,action,reason,payload_hash,receipt,target_revision_id,target_version)
 VALUES(?,?,?,?,?,?,?,?,?,?)`, actor[:], in.MutationID[:], post[:], out.Revision, in.Action, in.Reason, digest[:], receipt, targetRevision, targetVersion); err != nil {
		return PostState{}, err
	}
	return out, tx.Commit()
}

func applyPostAction(ctx context.Context, tx *sql.Tx, out *PostState, action string) error {
	switch action {
	case "approve":
		if out.ReviewStatus != "pending" {
			return ErrStateConflict
		}
		if out.PublishedAt == nil {
			var now time.Time
			if err := tx.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP(6)").Scan(&now); err != nil {
				return err
			}
			out.PublishedAt = &now
		}
		out.ReviewStatus = "reviewed"
	case "reject":
		if out.ReviewStatus != "pending" || out.PublishedAt != nil {
			return ErrStateConflict
		}
		out.ReviewStatus = "rejected"
	case "limit":
		if out.PublishedAt == nil || out.PlatformLimited {
			return ErrStateConflict
		}
		out.ReviewStatus = "reviewed"
		out.PlatformLimited = true
	case "revoke_limit":
		if !out.PlatformLimited {
			return ErrStateConflict
		}
		out.PlatformLimited = false
	case "hide":
		if out.PublishedAt == nil || out.AuthorHidden {
			return ErrStateConflict
		}
		out.AuthorHidden = true
	case "restore":
		if out.PublishedAt == nil || !out.AuthorHidden {
			return ErrStateConflict
		}
		if out.PlatformLimited {
			return ErrPostRestricted
		}
		out.AuthorHidden = false
	}
	return nil
}

func changeVersionLimit(ctx context.Context, tx *sql.Tx, post uuid.UUID, version uint64, limit bool) error {
	result, err := tx.ExecContext(ctx, "UPDATE short_post_versions SET platform_limited=? WHERE post_id=? AND version=? AND platform_limited<>?", limit, post[:], version, limit)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed != 1 {
		return ErrStateConflict
	}
	if limit {
		_, err = tx.ExecContext(ctx, "UPDATE short_post_revision_submissions SET post_review_pending=FALSE WHERE post_id=? AND version=?", post[:], version)
	}
	return err
}
