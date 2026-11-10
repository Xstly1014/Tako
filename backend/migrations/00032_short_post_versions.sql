-- +goose Up
ALTER TABLE short_posts
 ADD COLUMN last_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
 ADD COLUMN display_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
 ADD COLUMN history_enabled BOOLEAN NOT NULL DEFAULT FALSE,
 ADD UNIQUE KEY short_post_owner_identity(id,owner_id);
CREATE TABLE short_post_versions (
 post_id BINARY(16) NOT NULL,
 owner_id BINARY(16) NOT NULL,
 version BIGINT UNSIGNED NOT NULL,
 preview_id BINARY(16) NOT NULL,
 published_at DATETIME(6) NOT NULL,
 PRIMARY KEY(post_id,version),
 UNIQUE KEY short_post_version_preview(owner_id,preview_id),
 FOREIGN KEY(post_id,owner_id) REFERENCES short_posts(id,owner_id),
 FOREIGN KEY(owner_id,preview_id) REFERENCES short_post_previews(owner_id,id)
) ENGINE=InnoDB;
INSERT INTO short_post_versions(post_id,owner_id,version,preview_id,published_at)
 SELECT id,owner_id,1,preview_id,first_published_at FROM short_posts WHERE first_published_at IS NOT NULL;
UPDATE short_posts SET last_version=1,display_version=1 WHERE first_published_at IS NOT NULL;

ALTER TABLE short_post_actions ADD COLUMN target_revision_id BINARY(16) NULL;
CREATE TABLE short_post_revision_submissions (
 owner_id BINARY(16) NOT NULL,
 id BINARY(16) NOT NULL,
 post_id BINARY(16) NOT NULL,
 preview_id BINARY(16) NOT NULL,
 expected_revision BIGINT UNSIGNED NOT NULL,
 initial_pre_review BOOLEAN NOT NULL,
 status ENUM('pending','published','superseded','rejected') NOT NULL,
 version BIGINT UNSIGNED NULL,
 submitted_at DATETIME(6) NOT NULL,
 reason VARCHAR(500) NOT NULL DEFAULT '',
 PRIMARY KEY(owner_id,id),
 UNIQUE KEY short_post_revision_preview(owner_id,preview_id),
 KEY short_post_revision_pending(post_id,status),
 FOREIGN KEY(post_id,owner_id) REFERENCES short_posts(id,owner_id),
 FOREIGN KEY(owner_id,preview_id) REFERENCES short_post_previews(owner_id,id),
 FOREIGN KEY(post_id,version) REFERENCES short_post_versions(post_id,version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- +goose Down
CREATE TEMPORARY TABLE tako_short_post_versions_rollback(n BIGINT NOT NULL CHECK(n=0));
INSERT INTO tako_short_post_versions_rollback SELECT
 (SELECT COUNT(*) FROM short_post_versions WHERE version>1)+
 (SELECT COUNT(*) FROM short_post_revision_submissions)+
 (SELECT COUNT(*) FROM short_post_actions WHERE target_revision_id IS NOT NULL OR action IN ('show_version','history_open','history_close'));
DROP TEMPORARY TABLE tako_short_post_versions_rollback;
ALTER TABLE short_post_actions DROP COLUMN target_revision_id;
DROP TABLE short_post_revision_submissions;
DROP TABLE short_post_versions;
ALTER TABLE short_posts DROP INDEX short_post_owner_identity,
 DROP COLUMN last_version, DROP COLUMN display_version, DROP COLUMN history_enabled;
