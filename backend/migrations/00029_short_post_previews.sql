-- +goose Up
CREATE TABLE short_post_previews (
 owner_id BINARY(16) NOT NULL,
 id BINARY(16) NOT NULL,
 payload_hash BINARY(32) NOT NULL,
 title VARCHAR(80) NOT NULL,
 content TEXT NOT NULL,
 novel_id BINARY(16) NULL,
 expires_at DATETIME(6) NOT NULL,
 PRIMARY KEY(owner_id,id),
 KEY short_post_preview_owner_expiry(owner_id,expires_at),
 FOREIGN KEY(owner_id) REFERENCES accounts(id),
 FOREIGN KEY(novel_id,owner_id) REFERENCES novels(id,owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE short_post_preview_images (
 owner_id BINARY(16) NOT NULL,
 preview_id BINARY(16) NOT NULL,
 image_id BINARY(16) NOT NULL,
 position TINYINT UNSIGNED NOT NULL CHECK(position BETWEEN 1 AND 4),
 PRIMARY KEY(owner_id,preview_id,position),
 UNIQUE KEY short_post_preview_image_once(owner_id,preview_id,image_id),
 FOREIGN KEY(owner_id,preview_id) REFERENCES short_post_previews(owner_id,id),
 FOREIGN KEY(owner_id,image_id) REFERENCES short_post_images(owner_id,id)
) ENGINE=InnoDB;

-- +goose Down
CREATE TEMPORARY TABLE tako_short_preview_rollback_guard(n BIGINT NOT NULL CHECK(n=0));
INSERT INTO tako_short_preview_rollback_guard SELECT COUNT(*) FROM short_post_previews;
DROP TEMPORARY TABLE tako_short_preview_rollback_guard;
DROP TABLE short_post_preview_images;
DROP TABLE short_post_previews;
