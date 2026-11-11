-- +goose Up
ALTER TABLE short_post_previews
 ADD COLUMN purged_at DATETIME(6) NULL,
 ADD KEY short_post_preview_retention(purged_at,expires_at,owner_id,id);
ALTER TABLE short_post_images
 ADD COLUMN purged_at DATETIME(6) NULL,
 ADD KEY short_post_image_retention(purged_at,created_at,owner_id,id);

-- +goose Down
CREATE TEMPORARY TABLE tako_short_retention_rollback_guard(n BIGINT NOT NULL CHECK(n=0));
INSERT INTO tako_short_retention_rollback_guard
 SELECT EXISTS(SELECT 1 FROM short_post_previews WHERE purged_at IS NOT NULL)
     OR EXISTS(SELECT 1 FROM short_post_images WHERE purged_at IS NOT NULL);
DROP TEMPORARY TABLE tako_short_retention_rollback_guard;
ALTER TABLE short_post_images DROP KEY short_post_image_retention, DROP COLUMN purged_at;
ALTER TABLE short_post_previews DROP KEY short_post_preview_retention, DROP COLUMN purged_at;
