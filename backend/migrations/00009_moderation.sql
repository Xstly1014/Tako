-- +goose NO TRANSACTION
-- +goose Up
ALTER TABLE publication_review_tasks ADD COLUMN task_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE, ADD COLUMN revision BIGINT UNSIGNED NOT NULL DEFAULT 1;
CREATE TABLE moderation_cases (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 owner_id BINARY(16) NOT NULL, work_id BINARY(16) NOT NULL, version BIGINT UNSIGNED NOT NULL,
 scope VARCHAR(16) CHARACTER SET ascii NOT NULL, reason TEXT NOT NULL,
 state VARCHAR(16) CHARACTER SET ascii NOT NULL DEFAULT 'active', revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 created_at DATETIME(6) NOT NULL, next_appeal_at DATETIME(6) NULL,
 KEY moderation_owner(owner_id,id),
 FOREIGN KEY(work_id,version) REFERENCES work_versions(work_id,version)
) ENGINE=InnoDB;
CREATE TABLE moderation_appeals (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 case_id BIGINT UNSIGNED NOT NULL, reason TEXT NOT NULL, state VARCHAR(16) CHARACTER SET ascii NOT NULL DEFAULT 'pending',
 decision_reason TEXT NOT NULL, created_at DATETIME(6) NOT NULL, decided_at DATETIME(6) NULL,
 pending_case BIGINT UNSIGNED GENERATED ALWAYS AS (IF(state='pending',case_id,NULL)) STORED,
 UNIQUE KEY one_pending_appeal(pending_case), KEY moderation_appeal_case(case_id,id),
 FOREIGN KEY(case_id) REFERENCES moderation_cases(id)
) ENGINE=InnoDB;
CREATE TABLE moderation_mutations (
 actor_id BINARY(16) NOT NULL, mutation_id BINARY(16) NOT NULL, owner_id BINARY(16) NOT NULL,
 work_id BINARY(16) NOT NULL, kind VARCHAR(32) CHARACTER SET ascii NOT NULL, reason TEXT NOT NULL,
 payload_hash BINARY(32) NOT NULL, result JSON NOT NULL, created_at DATETIME(6) NOT NULL,
 PRIMARY KEY(actor_id,mutation_id), KEY moderation_audit(work_id,created_at),
 FOREIGN KEY(actor_id) REFERENCES accounts(id), FOREIGN KEY(work_id) REFERENCES works(id)
) ENGINE=InnoDB;
-- Preserve pre-existing platform flags as independent active restrictions.
INSERT INTO moderation_cases(owner_id,work_id,version,scope,reason,created_at)
 SELECT w.owner_id,w.id,v.version,'version','既有限制（迁移保留）',UTC_TIMESTAMP(6) FROM works w JOIN work_versions v ON v.work_id=w.id WHERE v.platform_limited=TRUE;
INSERT INTO moderation_cases(owner_id,work_id,version,scope,reason,created_at)
 SELECT owner_id,id,display_version,'work','既有限制（迁移保留）',UTC_TIMESTAMP(6) FROM works WHERE platform_limited=TRUE;
-- +goose Down
-- Destructive development rollback only; never a production data rollback.
DROP TABLE moderation_mutations;
DROP TABLE moderation_appeals;
DROP TABLE moderation_cases;
ALTER TABLE publication_review_tasks DROP COLUMN revision, DROP COLUMN task_id;
