-- +goose Up
CREATE TABLE short_posts (
 id BINARY(16) PRIMARY KEY,
 owner_id BINARY(16) NOT NULL,
 preview_id BINARY(16) NOT NULL,
 mutation_id BINARY(16) NOT NULL,
 submitted_at DATETIME(6) NOT NULL,
 initial_pre_review BOOLEAN NOT NULL,
 first_published_at DATETIME(6) NULL,
 UNIQUE KEY short_post_submission(owner_id,mutation_id),
 UNIQUE KEY short_post_once_per_preview(owner_id,preview_id),
 KEY short_post_public_order(first_published_at,id),
 FOREIGN KEY(owner_id,preview_id) REFERENCES short_post_previews(owner_id,id)
) ENGINE=InnoDB;

-- +goose Down
CREATE TEMPORARY TABLE tako_short_post_rollback_guard(n BIGINT NOT NULL CHECK(n=0));
INSERT INTO tako_short_post_rollback_guard SELECT COUNT(*) FROM short_posts;
DROP TEMPORARY TABLE tako_short_post_rollback_guard;
DROP TABLE short_posts;
