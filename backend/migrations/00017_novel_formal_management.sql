-- +goose Up
ALTER TABLE novels ADD COLUMN metadata_submission_id BINARY(16) NULL;
CREATE TABLE novel_management_requests (
 actor_id BINARY(16) NOT NULL,
 mutation_id BINARY(16) NOT NULL,
 novel_id BINARY(16) NOT NULL,
 payload_hash BINARY(32) NOT NULL,
 result JSON NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(actor_id,mutation_id),
 CONSTRAINT novel_management_actor_fk FOREIGN KEY(actor_id) REFERENCES accounts(id),
 CONSTRAINT novel_management_book_fk FOREIGN KEY(novel_id) REFERENCES novels(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE novel_metadata_submissions (
 id BINARY(16) PRIMARY KEY,
 novel_id BINARY(16) NOT NULL,
 owner_id BINARY(16) NOT NULL,
 source_revision BIGINT UNSIGNED NOT NULL,
 expected_revision BIGINT UNSIGNED NOT NULL,
 candidate_revision BIGINT UNSIGNED NOT NULL,
 title VARCHAR(200) NOT NULL,
 introduction VARCHAR(300) NOT NULL,
 tags JSON NOT NULL,
 state ENUM('pending','published','rejected','withdrawn','superseded') NOT NULL,
 decision_reason VARCHAR(2000) NOT NULL DEFAULT '',
 decided_by BINARY(16) NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 decided_at DATETIME(6) NULL,
 post_reviewed_at DATETIME(6) NULL,
 KEY novel_metadata_author(owner_id,novel_id,created_at,id),
 KEY novel_metadata_queue(state,created_at,id),
 CONSTRAINT novel_metadata_book_fk FOREIGN KEY(novel_id,owner_id) REFERENCES novels(id,owner_id),
 CONSTRAINT novel_metadata_operator_fk FOREIGN KEY(decided_by) REFERENCES accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE novel_metadata_versions (
 novel_id BINARY(16) NOT NULL,
 owner_id BINARY(16) NOT NULL,
 revision BIGINT UNSIGNED NOT NULL,
 submission_id BINARY(16) NULL,
 title VARCHAR(200) NOT NULL,
 introduction VARCHAR(300) NOT NULL,
 tags JSON NOT NULL,
 published_at DATETIME(6) NOT NULL,
 PRIMARY KEY(novel_id,revision),
 UNIQUE KEY novel_metadata_version_submission(submission_id),
 CONSTRAINT novel_metadata_version_book_fk FOREIGN KEY(novel_id,owner_id) REFERENCES novels(id,owner_id),
 CONSTRAINT novel_metadata_version_submission_fk FOREIGN KEY(submission_id) REFERENCES novel_metadata_submissions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- Capture the actual known formal revision; do not invent older snapshots.
INSERT INTO novel_metadata_versions(novel_id,owner_id,revision,title,introduction,tags,published_at)
 SELECT novel_id,owner_id,revision,title,introduction,tags,updated_at FROM novel_publications;
-- +goose Down
DROP TEMPORARY TABLE IF EXISTS tako_novel_management_rollback_guard;
CREATE TEMPORARY TABLE tako_novel_management_rollback_guard(n BIGINT NOT NULL CHECK(n=0));
INSERT INTO tako_novel_management_rollback_guard SELECT
 (SELECT COUNT(*) FROM novel_management_requests)+(SELECT COUNT(*) FROM novel_metadata_submissions)+
 (SELECT COUNT(*) FROM novel_metadata_versions WHERE submission_id IS NOT NULL);
DROP TEMPORARY TABLE tako_novel_management_rollback_guard;
DROP TABLE novel_metadata_versions;
DROP TABLE novel_metadata_submissions;
DROP TABLE novel_management_requests;
ALTER TABLE novels DROP COLUMN metadata_submission_id;
