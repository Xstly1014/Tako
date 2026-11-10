-- +goose Up
CREATE TABLE short_post_images (
 owner_id BINARY(16) NOT NULL,
 id BINARY(16) NOT NULL,
 input_hash BINARY(32) NOT NULL,
 media_type VARCHAR(16) CHARACTER SET ascii NOT NULL,
 width INT UNSIGNED NOT NULL,
 height INT UNSIGNED NOT NULL,
 content MEDIUMBLOB NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(owner_id,id),
 FOREIGN KEY(owner_id) REFERENCES accounts(id),
 CHECK(media_type IN ('image/jpeg','image/png')),
 CHECK(width > 0 AND height > 0 AND width * height <= 12000000),
 CHECK(OCTET_LENGTH(content) BETWEEN 1 AND 8388608)
) ENGINE=InnoDB;

-- +goose Down
CREATE TEMPORARY TABLE tako_short_image_rollback_guard(n BIGINT NOT NULL CHECK(n=0));
INSERT INTO tako_short_image_rollback_guard SELECT COUNT(*) FROM short_post_images;
DROP TEMPORARY TABLE tako_short_image_rollback_guard;
DROP TABLE short_post_images;
