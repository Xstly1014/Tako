-- +goose NO TRANSACTION
-- +goose Up
CREATE TABLE publication_policies (
 owner_id BINARY(16) PRIMARY KEY,
 observation_until DATETIME(6) NULL,
 CONSTRAINT publication_policy_owner_fk FOREIGN KEY (owner_id) REFERENCES accounts(id)
) ENGINE=InnoDB;

CREATE TABLE works (
 id BINARY(16) PRIMARY KEY,
 owner_id BINARY(16) NOT NULL,
 source_draft_id BINARY(16) NOT NULL,
 last_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
 display_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
 author_hidden BOOLEAN NOT NULL DEFAULT FALSE,
 history_open BOOLEAN NOT NULL DEFAULT FALSE,
 platform_limited BOOLEAN NOT NULL DEFAULT FALSE,
 created_at DATETIME(6) NOT NULL,
 UNIQUE KEY works_source_draft (source_draft_id),
 KEY works_owner (owner_id,id),
 CONSTRAINT works_owner_fk FOREIGN KEY (owner_id) REFERENCES accounts(id),
 CONSTRAINT works_draft_fk FOREIGN KEY (source_draft_id) REFERENCES drafts(id)
) ENGINE=InnoDB;

CREATE TABLE publication_previews (
 id BINARY(16) PRIMARY KEY,
 owner_id BINARY(16) NOT NULL,
 mutation_id BINARY(16) NOT NULL,
 payload_hash BINARY(32) NOT NULL,
 draft_id BINARY(16) NOT NULL,
 source_revision BIGINT UNSIGNED NOT NULL,
 expected_version BIGINT UNSIGNED NOT NULL,
 title VARCHAR(200) NULL,
 content MEDIUMTEXT NULL,
 introduction VARCHAR(300) NULL,
 tags JSON NULL,
 created_at DATETIME(6) NOT NULL,
 expires_at DATETIME(6) NOT NULL,
 consumed_work_id BINARY(16) NULL,
 consumed_version BIGINT UNSIGNED NULL,
 consumed_at DATETIME(6) NULL,
 UNIQUE KEY previews_mutation (owner_id,mutation_id),
 KEY previews_expiry (expires_at,id),
 CONSTRAINT previews_owner_fk FOREIGN KEY (owner_id) REFERENCES accounts(id),
 CONSTRAINT previews_draft_fk FOREIGN KEY (draft_id) REFERENCES drafts(id),
 CONSTRAINT previews_work_fk FOREIGN KEY (consumed_work_id) REFERENCES works(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE work_versions (
 work_id BINARY(16) NOT NULL,
 version BIGINT UNSIGNED NOT NULL,
 preview_id BINARY(16) NOT NULL,
 title VARCHAR(200) NOT NULL,
 content MEDIUMTEXT NOT NULL,
 introduction VARCHAR(300) NOT NULL,
 tags JSON NOT NULL,
 platform_limited BOOLEAN NOT NULL DEFAULT FALSE,
 published_at DATETIME(6) NOT NULL,
 PRIMARY KEY (work_id,version),
 UNIQUE KEY versions_preview (preview_id),
 CONSTRAINT versions_work_fk FOREIGN KEY (work_id) REFERENCES works(id),
 CONSTRAINT versions_preview_fk FOREIGN KEY (preview_id) REFERENCES publication_previews(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE publication_mutations (
 owner_id BINARY(16) NOT NULL,
 mutation_id BINARY(16) NOT NULL,
 payload_hash BINARY(32) NOT NULL,
 work_id BINARY(16) NOT NULL,
 version BIGINT UNSIGNED NOT NULL,
 published_at DATETIME(6) NOT NULL,
 PRIMARY KEY (owner_id,mutation_id),
 CONSTRAINT publication_mutations_owner_fk FOREIGN KEY (owner_id) REFERENCES accounts(id),
 CONSTRAINT publication_mutations_version_fk FOREIGN KEY (work_id,version) REFERENCES work_versions(work_id,version)
) ENGINE=InnoDB;

CREATE TABLE publication_review_tasks (
 work_id BINARY(16) NOT NULL,
 version BIGINT UNSIGNED NOT NULL,
 state VARCHAR(20) CHARACTER SET ascii NOT NULL DEFAULT 'pending',
 first_waiting_at DATETIME(6) NOT NULL,
 PRIMARY KEY (work_id,version),
 KEY publication_review_wait (state,first_waiting_at,work_id,version),
 CONSTRAINT publication_review_version_fk FOREIGN KEY (work_id,version) REFERENCES work_versions(work_id,version)
) ENGINE=InnoDB;

-- +goose Down
-- Destructive: do not run against real B content as an application rollback.
DROP TABLE publication_review_tasks;
DROP TABLE publication_mutations;
DROP TABLE work_versions;
DROP TABLE publication_previews;
DROP TABLE works;
DROP TABLE publication_policies;
