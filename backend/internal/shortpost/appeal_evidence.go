package shortpost

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
)

type AppealEvidence struct {
	Title   string          `json:"title"`
	Content string          `json:"content"`
	Version *uint64         `json:"version"`
	Images  []ImageMetadata `json:"images"`
}

// A version case always reads its exact formal snapshot. A whole-post case
// reviews the post's current formal snapshot, or the original submission
// when the post has no formal version.
const appealEvidenceSource = appealFrom + `
 JOIN short_posts s ON s.id=a.post_id AND s.owner_id=a.owner_id
 LEFT JOIN short_post_versions v ON v.post_id=s.id AND v.owner_id=s.owner_id
 AND v.version=COALESCE(c.target_version,s.display_version)
 JOIN short_post_previews p ON p.owner_id=s.owner_id
 AND p.id=IF(c.target_version IS NULL,COALESCE(v.preview_id,s.preview_id),v.preview_id)`

func (s PostStore) AppealEvidence(ctx context.Context, post, appeal uuid.UUID) (AppealEvidence, error) {
	var out AppealEvidence
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	var owner, preview uuid.UUID
	err = tx.QueryRowContext(ctx, "SELECT p.owner_id,p.id,p.title,p.content,v.version"+appealEvidenceSource+
		" WHERE a.post_id=? AND a.id=?", post[:], appeal[:]).
		Scan(&owner, &preview, &out.Title, &out.Content, &out.Version)
	if err != nil {
		return out, err
	}
	out.Images, err = previewImages(ctx, tx, owner, preview)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}

func (s PostStore) AppealEvidenceImage(ctx context.Context, post, appeal, image uuid.UUID, version uint64) (string, []byte, error) {
	var mediaType string
	var body []byte
	err := s.DB.QueryRowContext(ctx, "SELECT i.media_type,i.content"+appealEvidenceSource+`
 JOIN short_post_preview_images m ON m.owner_id=p.owner_id AND m.preview_id=p.id
 JOIN short_post_images i ON i.owner_id=m.owner_id AND i.id=m.image_id
 WHERE a.post_id=? AND a.id=? AND i.id=? AND COALESCE(v.version,0)=?`,
		post[:], appeal[:], image[:], version).Scan(&mediaType, &body)
	return mediaType, body, err
}
