-- +goose Up
ALTER TABLE novels
 ADD COLUMN last_position BIGINT UNSIGNED NOT NULL DEFAULT 0,
 ADD COLUMN state_revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 ADD COLUMN author_hidden BOOLEAN NOT NULL DEFAULT FALSE,
 ADD COLUMN platform_limited BOOLEAN NOT NULL DEFAULT FALSE,
 ADD COLUMN completed_at DATETIME(6) NULL;
ALTER TABLE novel_chapters
 ADD COLUMN ordinal BIGINT UNSIGNED NULL,
 ADD COLUMN last_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
 ADD COLUMN display_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
 ADD COLUMN state_revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 ADD COLUMN author_hidden BOOLEAN NOT NULL DEFAULT FALSE,
 ADD COLUMN platform_limited BOOLEAN NOT NULL DEFAULT FALSE,
 ADD COLUMN current_submission_id BINARY(16) NULL,
 ADD UNIQUE KEY chapters_fixed_order(novel_id,ordinal);
CREATE TABLE novel_publications (
 novel_id BINARY(16) PRIMARY KEY,
 owner_id BINARY(16) NOT NULL,
 title VARCHAR(200) NOT NULL,
 introduction VARCHAR(300) NOT NULL,
 tags JSON NOT NULL,
 revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 first_published_at DATETIME(6) NOT NULL,
 updated_at DATETIME(6) NOT NULL,
 KEY novels_public_order(first_published_at,novel_id),
 CONSTRAINT novel_publications_owner_fk FOREIGN KEY(novel_id,owner_id) REFERENCES novels(id,owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE chapter_previews (
 id BINARY(16) PRIMARY KEY,
 owner_id BINARY(16) NOT NULL,
 novel_id BINARY(16) NOT NULL,
 chapter_id BINARY(16) NOT NULL,
 snapshot JSON NULL,
 expires_at DATETIME(6) NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 KEY chapter_previews_owner_time(owner_id,created_at),
 KEY chapter_previews_expiry(expires_at,id),
 CONSTRAINT chapter_previews_parent_fk FOREIGN KEY(chapter_id,novel_id,owner_id) REFERENCES novel_chapters(id,novel_id,owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE chapter_submissions (
 id BINARY(16) PRIMARY KEY,
 owner_id BINARY(16) NOT NULL,
 novel_id BINARY(16) NOT NULL,
 chapter_id BINARY(16) NOT NULL,
 preview_id BINARY(16) NOT NULL,
 ordinal BIGINT UNSIGNED NOT NULL,
 candidate_version BIGINT UNSIGNED NOT NULL,
 state ENUM('pending','published','rejected','withdrawn','superseded') NOT NULL,
 decision_reason VARCHAR(2000) NOT NULL DEFAULT '',
 decided_by BINARY(16) NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 decided_at DATETIME(6) NULL,
 UNIQUE KEY chapter_submission_preview(preview_id),
 KEY chapter_submissions_pending(state,created_at,id),
 KEY chapter_submissions_author(owner_id,novel_id,created_at,id),
 CONSTRAINT chapter_submission_parent_fk FOREIGN KEY(chapter_id,novel_id,owner_id) REFERENCES novel_chapters(id,novel_id,owner_id),
 CONSTRAINT chapter_submission_preview_fk FOREIGN KEY(preview_id) REFERENCES chapter_previews(id),
 CONSTRAINT chapter_submission_operator_fk FOREIGN KEY(decided_by) REFERENCES accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE chapter_versions (
 chapter_id BINARY(16) NOT NULL,
 novel_id BINARY(16) NOT NULL,
 owner_id BINARY(16) NOT NULL,
 version BIGINT UNSIGNED NOT NULL,
 submission_id BINARY(16) NOT NULL,
 title VARCHAR(200) NOT NULL,
 content LONGTEXT NOT NULL,
 platform_limited BOOLEAN NOT NULL DEFAULT FALSE,
 published_at DATETIME(6) NOT NULL,
 PRIMARY KEY(chapter_id,version),
 UNIQUE KEY chapter_version_submission(submission_id),
 UNIQUE KEY chapter_version_identity(chapter_id,novel_id,version),
 CONSTRAINT chapter_version_parent_fk FOREIGN KEY(chapter_id,novel_id,owner_id) REFERENCES novel_chapters(id,novel_id,owner_id),
 CONSTRAINT chapter_version_submission_fk FOREIGN KEY(submission_id) REFERENCES chapter_submissions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE novel_publication_requests (
 owner_id BINARY(16) NOT NULL,
 mutation_id BINARY(16) NOT NULL,
 novel_id BINARY(16) NOT NULL,
 operation VARCHAR(32) CHARACTER SET ascii NOT NULL,
 payload_hash BINARY(32) NOT NULL,
 result JSON NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(owner_id,mutation_id),
 CONSTRAINT novel_publication_request_owner_fk FOREIGN KEY(owner_id) REFERENCES accounts(id),
 CONSTRAINT novel_publication_request_book_fk FOREIGN KEY(novel_id) REFERENCES novels(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE chapter_post_review_tasks (
 submission_id BINARY(16) PRIMARY KEY,
 chapter_id BINARY(16) NOT NULL,
 novel_id BINARY(16) NOT NULL,
 owner_id BINARY(16) NOT NULL,
 version BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(6) NOT NULL,
 reviewed_at DATETIME(6) NULL,
 reviewed_by BINARY(16) NULL,
 KEY chapter_post_review_queue(reviewed_at,created_at,submission_id),
 CONSTRAINT chapter_post_review_version_fk FOREIGN KEY(chapter_id,novel_id,version) REFERENCES chapter_versions(chapter_id,novel_id,version),
 CONSTRAINT chapter_post_review_parent_fk FOREIGN KEY(chapter_id,novel_id,owner_id) REFERENCES novel_chapters(id,novel_id,owner_id),
 CONSTRAINT chapter_post_review_submission_fk FOREIGN KEY(submission_id) REFERENCES chapter_submissions(id),
 CONSTRAINT chapter_post_review_operator_fk FOREIGN KEY(reviewed_by) REFERENCES accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE chapter_release_events (
 chapter_id BINARY(16) PRIMARY KEY,
 novel_id BINARY(16) NOT NULL,
 owner_id BINARY(16) NOT NULL,
 ordinal BIGINT UNSIGNED NOT NULL,
 published_at DATETIME(6) NOT NULL,
 CONSTRAINT chapter_release_parent_fk FOREIGN KEY(chapter_id,novel_id,owner_id) REFERENCES novel_chapters(id,novel_id,owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- +goose Down
DROP TEMPORARY TABLE IF EXISTS tako_chapter_publication_rollback_guard;
CREATE TEMPORARY TABLE tako_chapter_publication_rollback_guard(n BIGINT NOT NULL CHECK(n=0));
INSERT INTO tako_chapter_publication_rollback_guard SELECT
 (SELECT COUNT(*) FROM novel_publication_requests)+(SELECT COUNT(*) FROM chapter_previews)+
 (SELECT COUNT(*) FROM chapter_submissions)+(SELECT COUNT(*) FROM chapter_versions)+
 (SELECT COUNT(*) FROM novel_publications)+(SELECT COUNT(*) FROM chapter_release_events)+(SELECT COUNT(*) FROM chapter_post_review_tasks)+
 (SELECT COUNT(*) FROM novel_chapters WHERE ordinal IS NOT NULL);
DROP TEMPORARY TABLE tako_chapter_publication_rollback_guard;
DROP TABLE chapter_release_events;
DROP TABLE chapter_post_review_tasks;
DROP TABLE novel_publication_requests;
DROP TABLE chapter_versions;
DROP TABLE chapter_submissions;
DROP TABLE chapter_previews;
DROP TABLE novel_publications;
ALTER TABLE novel_chapters DROP INDEX chapters_fixed_order,
 DROP COLUMN ordinal,DROP COLUMN last_version,DROP COLUMN display_version,DROP COLUMN state_revision,
 DROP COLUMN author_hidden,DROP COLUMN platform_limited,DROP COLUMN current_submission_id;
ALTER TABLE novels DROP COLUMN last_position,DROP COLUMN state_revision,DROP COLUMN author_hidden,
 DROP COLUMN platform_limited,DROP COLUMN completed_at;
