package shortpost

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"image"
	"image/jpeg"
	"image/png"

	"github.com/google/uuid"
)

const (
	MaxImageBytes   = 8 << 20
	maxImagePixels  = 12_000_000
	maxStagedImages = 16
)

var (
	ErrInvalidImage   = errors.New("invalid image")
	ErrImageTooLarge  = errors.New("image too large")
	ErrImageQuota     = errors.New("staged image quota reached")
	ErrUploadIDReused = errors.New("image upload id reused")
)

type ImageStore struct {
	DB *sql.DB
}

type ImageMetadata struct {
	ID        uuid.UUID `json:"id"`
	MediaType string    `json:"media_type"`
	Width     int       `json:"width"`
	Height    int       `json:"height"`
}

type boundedImage struct {
	bytes.Buffer
}

func (b *boundedImage) Write(p []byte) (int, error) {
	if len(p) > MaxImageBytes-b.Len() {
		return 0, ErrImageTooLarge
	}
	return b.Buffer.Write(p)
}

func sanitizeImage(input []byte, mediaType string) (ImageMetadata, []byte, error) {
	if len(input) > MaxImageBytes {
		return ImageMetadata{}, nil, ErrImageTooLarge
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(input))
	if err != nil || (format != "jpeg" && format != "png") || "image/"+format != mediaType {
		return ImageMetadata{}, nil, ErrInvalidImage
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > maxImagePixels/config.Height {
		return ImageMetadata{}, nil, ErrImageTooLarge
	}
	decoded, _, err := image.Decode(bytes.NewReader(input))
	if err != nil {
		return ImageMetadata{}, nil, ErrInvalidImage
	}
	var output boundedImage
	if format == "jpeg" {
		err = jpeg.Encode(&output, decoded, &jpeg.Options{Quality: 90})
	} else {
		err = png.Encode(&output, decoded)
	}
	if err != nil {
		return ImageMetadata{}, nil, err
	}
	return ImageMetadata{MediaType: mediaType, Width: config.Width, Height: config.Height}, output.Bytes(), nil
}

func (s ImageStore) Save(ctx context.Context, owner, id uuid.UUID, mediaType string, input []byte) (ImageMetadata, error) {
	digest := sha256.Sum256(input)
	// Keep image decoding outside the transaction. The account row serializes quota
	// and upload-id decisions across requests and API processes.
	metadata, content, err := sanitizeImage(input, mediaType)
	if err != nil {
		return ImageMetadata{}, err
	}
	metadata.ID = id
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return ImageMetadata{}, err
	}
	defer tx.Rollback()
	var locked []byte
	if err = tx.QueryRowContext(ctx, "SELECT id FROM accounts WHERE id=? FOR UPDATE", owner[:]).Scan(&locked); err != nil {
		return ImageMetadata{}, err
	}
	var priorHash []byte
	var purged bool
	var prior ImageMetadata
	prior.ID = id
	err = tx.QueryRowContext(ctx,
		"SELECT input_hash,media_type,width,height,purged_at IS NOT NULL FROM short_post_images WHERE owner_id=? AND id=?",
		owner[:], id[:]).Scan(&priorHash, &prior.MediaType, &prior.Width, &prior.Height, &purged)
	if err == nil {
		if !bytes.Equal(digest[:], priorHash) || prior.MediaType != mediaType {
			return ImageMetadata{}, ErrUploadIDReused
		}
		if purged {
			return ImageMetadata{}, ErrImageUnavailable
		}
		return prior, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return ImageMetadata{}, err
	}
	var count int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM short_post_images i
 WHERE i.owner_id=? AND i.purged_at IS NULL AND NOT EXISTS (
   SELECT 1 FROM short_post_preview_images p WHERE p.owner_id=i.owner_id AND p.image_id=i.id
     AND NOT (`+previewUnsubmitted+`)
 )`, owner[:]).Scan(&count); err != nil {
		return ImageMetadata{}, err
	}
	if count >= maxStagedImages {
		return ImageMetadata{}, ErrImageQuota
	}
	if _, err = tx.ExecContext(ctx,
		"INSERT INTO short_post_images(owner_id,id,input_hash,media_type,width,height,content) VALUES(?,?,?,?,?,?,?)",
		owner[:], id[:], digest[:], mediaType, metadata.Width, metadata.Height, content); err != nil {
		return ImageMetadata{}, err
	}
	return metadata, tx.Commit()
}

func (s ImageStore) Read(ctx context.Context, owner, id uuid.UUID) (string, []byte, error) {
	var mediaType string
	var content []byte
	err := s.DB.QueryRowContext(ctx, "SELECT media_type,content FROM short_post_images WHERE owner_id=? AND id=? AND purged_at IS NULL", owner[:], id[:]).Scan(&mediaType, &content)
	return mediaType, content, err
}
