-- +goose NO TRANSACTION
-- +goose Up
ALTER TABLE works ADD COLUMN state_revision BIGINT UNSIGNED NOT NULL DEFAULT 1;
CREATE INDEX works_owner_created ON works (owner_id,created_at,id);
CREATE TABLE work_events (
 work_id BINARY(16) NOT NULL,
 sequence BIGINT UNSIGNED NOT NULL,
 kind VARCHAR(32) CHARACTER SET ascii NOT NULL,
 version BIGINT UNSIGNED NOT NULL,
 public_visible BOOLEAN NOT NULL,
 created_at DATETIME(6) NOT NULL,
 PRIMARY KEY (work_id,sequence),
 CONSTRAINT work_events_version_fk FOREIGN KEY (work_id,version) REFERENCES work_versions(work_id,version)
) ENGINE=InnoDB;
CREATE TABLE work_state_mutations (
 owner_id BINARY(16) NOT NULL,
 mutation_id BINARY(16) NOT NULL,
 payload_hash BINARY(32) NOT NULL,
 work_id BINARY(16) NOT NULL,
 result JSON NOT NULL,
 created_at DATETIME(6) NOT NULL,
 PRIMARY KEY (owner_id,mutation_id),
 CONSTRAINT work_state_mutations_owner_fk FOREIGN KEY (owner_id) REFERENCES accounts(id),
 CONSTRAINT work_state_mutations_work_fk FOREIGN KEY (work_id) REFERENCES works(id)
) ENGINE=InnoDB;
-- +goose Down
-- Never use this destructive migration as a real-data application rollback.
DROP TABLE work_state_mutations;
DROP TABLE work_events;
DROP INDEX works_owner_created ON works;
ALTER TABLE works DROP COLUMN state_revision;
