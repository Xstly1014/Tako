-- +goose Up
CREATE TABLE novel_moderation_cases (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 novel_id BINARY(16) NOT NULL,
 owner_id BINARY(16) NOT NULL,
 target_id BINARY(16) NOT NULL,
 scope ENUM('book','chapter','version') NOT NULL,
 version BIGINT UNSIGNED NOT NULL DEFAULT 0,
 reason VARCHAR(2000) NOT NULL,
 state ENUM('active','revoked') NOT NULL DEFAULT 'active',
 active_slot TINYINT UNSIGNED NULL DEFAULT 1,
 revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 actor_id BINARY(16) NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 next_appeal_at DATETIME(6) NULL,
 decision_reason VARCHAR(2000) NOT NULL DEFAULT '',
 UNIQUE KEY novel_case_active_target(scope,target_id,version,active_slot),
 CHECK((state='active' AND active_slot IS NOT NULL AND active_slot=1) OR (state='revoked' AND active_slot IS NULL)),
 KEY novel_case_author(owner_id,novel_id,id),
 CONSTRAINT novel_case_book_fk FOREIGN KEY(novel_id,owner_id) REFERENCES novels(id,owner_id),
 CONSTRAINT novel_case_actor_fk FOREIGN KEY(actor_id) REFERENCES accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE novel_moderation_appeals (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 case_id BIGINT UNSIGNED NOT NULL,
 reason VARCHAR(2000) NOT NULL,
 state ENUM('pending','upheld','revoked') NOT NULL DEFAULT 'pending',
 pending_slot TINYINT UNSIGNED NULL DEFAULT 1,
 decision_reason VARCHAR(2000) NOT NULL DEFAULT '',
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 decided_at DATETIME(6) NULL,
 UNIQUE KEY novel_appeal_one_pending(case_id,pending_slot),
 CHECK((state='pending' AND pending_slot IS NOT NULL AND pending_slot=1) OR (state<>'pending' AND pending_slot IS NULL)),
 CONSTRAINT novel_appeal_case_fk FOREIGN KEY(case_id) REFERENCES novel_moderation_cases(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- +goose Down
DROP TEMPORARY TABLE IF EXISTS tako_novel_moderation_rollback_guard;
CREATE TEMPORARY TABLE tako_novel_moderation_rollback_guard(n BIGINT NOT NULL CHECK(n=0));
INSERT INTO tako_novel_moderation_rollback_guard SELECT (SELECT COUNT(*) FROM novel_moderation_cases)+(SELECT COUNT(*) FROM novel_moderation_appeals);
DROP TEMPORARY TABLE tako_novel_moderation_rollback_guard;
DROP TABLE novel_moderation_appeals;
DROP TABLE novel_moderation_cases;
