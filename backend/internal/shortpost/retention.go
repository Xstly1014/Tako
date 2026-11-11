package shortpost

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"
)

const materialBatchSize = 50

// A submitted preview remains an audit snapshot, including after a rejection or replacement.
const previewUnsubmitted = `NOT EXISTS (SELECT 1 FROM short_posts s WHERE s.owner_id=p.owner_id AND s.preview_id=p.preview_id)
 AND NOT EXISTS (SELECT 1 FROM short_post_revision_submissions s WHERE s.owner_id=p.owner_id AND s.preview_id=p.preview_id)
 AND NOT EXISTS (SELECT 1 FROM short_post_versions v WHERE v.owner_id=p.owner_id AND v.preview_id=p.preview_id)`

const expiredPreview = `purged_at IS NULL AND expires_at<=UTC_TIMESTAMP(6)
 AND NOT EXISTS (
   SELECT 1 FROM short_posts s WHERE s.owner_id=p.owner_id AND s.preview_id=p.id
 )
 AND NOT EXISTS (
   SELECT 1 FROM short_post_revision_submissions s WHERE s.owner_id=p.owner_id AND s.preview_id=p.id
 )
 AND NOT EXISTS (
   SELECT 1 FROM short_post_versions v WHERE v.owner_id=p.owner_id AND v.preview_id=p.id
 )`

const orphanedImage = `purged_at IS NULL AND created_at<=UTC_TIMESTAMP(6)-INTERVAL 24 HOUR
 AND NOT EXISTS (SELECT 1 FROM short_post_preview_images p WHERE p.owner_id=i.owner_id AND p.image_id=i.id)`

type materialKey struct {
	owner uuid.UUID
	id    uuid.UUID
}

// CleanupTemporaryMaterial releases expired content while preserving request IDs.
// Every deletion decision is rechecked under the same owner lock used for upload,
// preview preparation and submission.
func CleanupTemporaryMaterial(ctx context.Context, db *sql.DB) (previews, images int, err error) {
	previews, err = purgeMaterial(ctx, db,
		`SELECT owner_id,id FROM short_post_previews p WHERE `+expiredPreview+` ORDER BY expires_at,owner_id,id LIMIT ?`,
		`UPDATE short_post_previews p SET title='',content='',novel_id=NULL,purged_at=UTC_TIMESTAMP(6)
 WHERE p.owner_id=? AND p.id=? AND `+expiredPreview,
		`DELETE FROM short_post_preview_images WHERE owner_id=? AND preview_id=?`)
	if err != nil {
		return previews, 0, err
	}
	// A one-byte tombstone preserves the original blob constraint and upload ID.
	images, err = purgeMaterial(ctx, db,
		`SELECT owner_id,id FROM short_post_images i WHERE `+orphanedImage+` ORDER BY created_at,owner_id,id LIMIT ?`,
		`UPDATE short_post_images i SET content=X'00',purged_at=UTC_TIMESTAMP(6)
 WHERE i.owner_id=? AND i.id=? AND `+orphanedImage,
		"")
	return previews, images, err
}

func purgeMaterial(ctx context.Context, db *sql.DB, selectBatch, purge, unlink string) (int, error) {
	rows, err := db.QueryContext(ctx, selectBatch, materialBatchSize)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var batch []materialKey
	for rows.Next() {
		var key materialKey
		if err := rows.Scan(&key.owner, &key.id); err != nil {
			return 0, err
		}
		batch = append(batch, key)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}

	var removed int
	for _, key := range batch {
		n, err := purgeMaterialItem(ctx, db, key, purge, unlink)
		if err != nil {
			return removed, err
		}
		removed += n
	}
	return removed, nil
}

func purgeMaterialItem(ctx context.Context, db *sql.DB, key materialKey, purge, unlink string) (int, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var locked []byte
	err = tx.QueryRowContext(ctx, "SELECT id FROM accounts WHERE id=? FOR UPDATE", key.owner[:]).Scan(&locked)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	result, err := tx.ExecContext(ctx, purge, key.owner[:], key.id[:])
	if err != nil {
		return 0, err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	if n > 0 && unlink != "" {
		if _, err := tx.ExecContext(ctx, unlink, key.owner[:], key.id[:]); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return int(n), nil
}
