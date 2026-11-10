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
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"writing.local/community/internal/novel"
)

const maxPreviewImages = 4

var (
	ErrInvalidPreview   = errors.New("invalid short-post preview")
	ErrPreviewExpired   = errors.New("short-post preview expired")
	ErrPreviewIDReused  = errors.New("short-post preview ID reused")
	ErrPreviewQuota     = errors.New("short-post preview quota reached")
	ErrImageUnavailable = errors.New("short-post image unavailable")
	ErrNovelUnavailable = errors.New("short-post linked novel unavailable")
)

type PreviewStore struct {
	DB *sql.DB
}

type PreparePreview struct {
	Title    string      `json:"title"`
	Content  string      `json:"content"`
	ImageIDs []uuid.UUID `json:"image_ids"`
	NovelID  *uuid.UUID  `json:"novel_id"`
}

type Preview struct {
	ID        uuid.UUID       `json:"id"`
	Title     string          `json:"title"`
	Content   string          `json:"content"`
	NovelID   *uuid.UUID      `json:"novel_id"`
	Images    []ImageMetadata `json:"images"`
	ExpiresAt time.Time       `json:"expires_at"`
}

func normalizePreview(in PreparePreview) (PreparePreview, error) {
	in.Title = strings.TrimSpace(in.Title)
	in.Content = strings.TrimSpace(strings.ReplaceAll(in.Content, "\r\n", "\n"))
	if !utf8.ValidString(in.Title) || !utf8.ValidString(in.Content) ||
		in.Title == "" || utf8.RuneCountInString(in.Title) > 80 ||
		in.Content == "" || utf8.RuneCountInString(in.Content) > 2000 ||
		strings.IndexFunc(in.Title, unicode.IsControl) >= 0 ||
		strings.IndexFunc(in.Content, func(r rune) bool { return unicode.IsControl(r) && r != '\n' && r != '\t' }) >= 0 ||
		len(in.ImageIDs) > maxPreviewImages || (in.NovelID != nil && *in.NovelID == uuid.Nil) {
		return in, ErrInvalidPreview
	}
	if in.ImageIDs == nil {
		in.ImageIDs = []uuid.UUID{}
	}
	seen := make(map[uuid.UUID]bool, len(in.ImageIDs))
	for _, imageID := range in.ImageIDs {
		if imageID == uuid.Nil || seen[imageID] {
			return in, ErrInvalidPreview
		}
		seen[imageID] = true
	}
	return in, nil
}

func (s PreviewStore) Prepare(ctx context.Context, owner, id uuid.UUID, in PreparePreview) (Preview, error) {
	in, err := normalizePreview(in)
	if err != nil || id == uuid.Nil {
		return Preview{}, ErrInvalidPreview
	}
	encoded, err := json.Marshal(in)
	if err != nil {
		return Preview{}, err
	}
	digest := sha256.Sum256(encoded)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Preview{}, err
	}
	defer tx.Rollback()
	// Account serialization protects duplicate requests, the per-author quota,
	// and the ordering of image ownership checks against future removals.
	var locked []byte
	if err = tx.QueryRowContext(ctx, "SELECT id FROM accounts WHERE id=? FOR UPDATE", owner[:]).Scan(&locked); err != nil {
		return Preview{}, err
	}
	var priorHash []byte
	err = tx.QueryRowContext(ctx, "SELECT payload_hash FROM short_post_previews WHERE owner_id=? AND id=?", owner[:], id[:]).Scan(&priorHash)
	if err == nil {
		if !bytes.Equal(digest[:], priorHash) {
			return Preview{}, ErrPreviewIDReused
		}
		out, err := loadPreview(ctx, tx, owner, id)
		if err != nil {
			return Preview{}, err
		}
		return out, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Preview{}, err
	}
	var count int
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM short_post_previews WHERE owner_id=? AND expires_at>UTC_TIMESTAMP(6)", owner[:]).Scan(&count); err != nil {
		return Preview{}, err
	}
	if count >= 32 {
		return Preview{}, ErrPreviewQuota
	}
	var book any
	if in.NovelID != nil {
		readable, err := novel.IsOwnedPublic(ctx, tx, owner, *in.NovelID)
		if err != nil {
			return Preview{}, err
		}
		if !readable {
			return Preview{}, ErrNovelUnavailable
		}
		book = (*in.NovelID)[:]
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO short_post_previews(owner_id,id,payload_hash,title,content,novel_id,expires_at) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(6)+INTERVAL 24 HOUR)",
		owner[:], id[:], digest[:], in.Title, in.Content, book); err != nil {
		return Preview{}, err
	}
	for index, imageID := range in.ImageIDs {
		result, err := tx.ExecContext(ctx, "INSERT INTO short_post_preview_images(owner_id,preview_id,image_id,position) SELECT owner_id,?,id,? FROM short_post_images WHERE owner_id=? AND id=?",
			id[:], index+1, owner[:], imageID[:])
		if err != nil {
			return Preview{}, err
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return Preview{}, err
		}
		if rows == 0 {
			return Preview{}, ErrImageUnavailable
		}
	}
	out, err := loadPreview(ctx, tx, owner, id)
	if err != nil {
		return Preview{}, err
	}
	return out, tx.Commit()
}

func (s PreviewStore) Read(ctx context.Context, owner, id uuid.UUID) (Preview, error) {
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return Preview{}, err
	}
	defer tx.Rollback()
	out, err := loadPreview(ctx, tx, owner, id)
	if err != nil {
		return Preview{}, err
	}
	return out, tx.Commit()
}

func loadPreview(ctx context.Context, tx *sql.Tx, owner, id uuid.UUID) (Preview, error) {
	out := Preview{ID: id, Images: []ImageMetadata{}}
	var expired bool
	var book uuid.NullUUID
	err := tx.QueryRowContext(ctx, "SELECT title,content,novel_id,expires_at,expires_at<=UTC_TIMESTAMP(6) FROM short_post_previews WHERE owner_id=? AND id=?",
		owner[:], id[:]).Scan(&out.Title, &out.Content, &book, &out.ExpiresAt, &expired)
	if err != nil {
		return Preview{}, err
	}
	if expired {
		return Preview{}, ErrPreviewExpired
	}
	if book.Valid {
		out.NovelID = &book.UUID
	}
	out.Images, err = previewImages(ctx, tx, owner, id)
	return out, err
}

func previewImages(ctx context.Context, tx *sql.Tx, owner, id uuid.UUID) ([]ImageMetadata, error) {
	images := []ImageMetadata{}
	rows, err := tx.QueryContext(ctx, `SELECT i.id,i.media_type,i.width,i.height
 FROM short_post_preview_images p JOIN short_post_images i ON i.owner_id=p.owner_id AND i.id=p.image_id
 WHERE p.owner_id=? AND p.preview_id=? ORDER BY p.position`, owner[:], id[:])
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var item ImageMetadata
		if err := rows.Scan(&item.ID, &item.MediaType, &item.Width, &item.Height); err != nil {
			return nil, err
		}
		images = append(images, item)
	}
	return images, rows.Err()
}
