-- +goose Up
CREATE TABLE novel_completion_checks (
 id BINARY(16) PRIMARY KEY,
 novel_id BINARY(16) NOT NULL,
 owner_id BINARY(16) NOT NULL,
 snapshot JSON NOT NULL,
 fingerprint BINARY(32) NOT NULL,
 expires_at DATETIME(6) NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 KEY completion_owner_created(owner_id,created_at),
 CONSTRAINT completion_parent_fk FOREIGN KEY(novel_id,owner_id) REFERENCES novels(id,owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE novel_rectifications (
 id BINARY(16) PRIMARY KEY,
 sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
 novel_id BINARY(16) NOT NULL,
 chapter_id BINARY(16) NOT NULL,
 owner_id BINARY(16) NOT NULL,
 case_id BIGINT UNSIGNED NOT NULL,
 case_revision BIGINT UNSIGNED NOT NULL,
 base_version BIGINT UNSIGNED NOT NULL,
 state ENUM('available','submitted','approved','rejected','cancelled','withdrawn') NOT NULL DEFAULT 'available',
 active_slot TINYINT UNSIGNED NULL DEFAULT 1,
 revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 reason VARCHAR(2000) NOT NULL,
 actor_id BINARY(16) NOT NULL,
 preview_id BINARY(16) NULL,
 submitted_at DATETIME(6) NULL,
 decided_at DATETIME(6) NULL,
 decided_by BINARY(16) NULL,
 decision_reason VARCHAR(2000) NOT NULL DEFAULT '',
 revoked_case BOOLEAN NOT NULL DEFAULT FALSE,
 published_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY rectification_one_active(chapter_id,active_slot),
 KEY rectification_author(owner_id,novel_id,created_at,id),
 CHECK((state IN ('available','submitted') AND active_slot=1 AND active_slot IS NOT NULL) OR (state NOT IN ('available','submitted') AND active_slot IS NULL)),
 CONSTRAINT rectification_parent_fk FOREIGN KEY(chapter_id,novel_id,owner_id) REFERENCES novel_chapters(id,novel_id,owner_id),
 CONSTRAINT rectification_case_fk FOREIGN KEY(case_id) REFERENCES novel_moderation_cases(id),
 CONSTRAINT rectification_actor_fk FOREIGN KEY(actor_id) REFERENCES accounts(id),
 CONSTRAINT rectification_decider_fk FOREIGN KEY(decided_by) REFERENCES accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE novel_rectification_previews (
 id BINARY(16) PRIMARY KEY,
 grant_id BINARY(16) NOT NULL,
 novel_id BINARY(16) NOT NULL,
 owner_id BINARY(16) NOT NULL,
 snapshot JSON NULL,
 expires_at DATETIME(6) NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 KEY rectification_preview_expiry(expires_at,id),
 KEY rectification_preview_author(owner_id,created_at),
 CONSTRAINT rectification_preview_grant_fk FOREIGN KEY(grant_id) REFERENCES novel_rectifications(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE novel_rectifications ADD CONSTRAINT rectification_submitted_preview_fk FOREIGN KEY(preview_id) REFERENCES novel_rectification_previews(id);
ALTER TABLE chapter_versions MODIFY submission_id BINARY(16) NULL,
 ADD COLUMN rectification_id BINARY(16) NULL,
 ADD UNIQUE KEY chapter_version_rectification(rectification_id),
 ADD CONSTRAINT chapter_version_rectification_fk FOREIGN KEY(rectification_id) REFERENCES novel_rectifications(id),
 ADD CONSTRAINT chapter_version_one_source CHECK((submission_id IS NULL) <> (rectification_id IS NULL));
-- +goose Down
DROP TEMPORARY TABLE IF EXISTS tako_completion_rollback_guard;
CREATE TEMPORARY TABLE tako_completion_rollback_guard(n BIGINT NOT NULL CHECK(n=0));
INSERT INTO tako_completion_rollback_guard SELECT (SELECT COUNT(*) FROM novel_completion_checks)+(SELECT COUNT(*) FROM novel_rectifications)+(SELECT COUNT(*) FROM novel_rectification_previews)+(SELECT COUNT(*) FROM novels WHERE completed_at IS NOT NULL);
DROP TEMPORARY TABLE tako_completion_rollback_guard;
ALTER TABLE chapter_versions DROP CHECK chapter_version_one_source, DROP FOREIGN KEY chapter_version_rectification_fk, DROP INDEX chapter_version_rectification, DROP COLUMN rectification_id, MODIFY submission_id BINARY(16) NOT NULL;
ALTER TABLE novel_rectifications DROP FOREIGN KEY rectification_submitted_preview_fk;
DROP TABLE novel_rectification_previews;
DROP TABLE novel_rectifications;
DROP TABLE novel_completion_checks;
