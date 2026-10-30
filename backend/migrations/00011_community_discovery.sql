-- +goose Up
ALTER TABLE works ADD COLUMN discovery_revision BIGINT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE work_versions ADD KEY versions_first_publication (version,published_at,work_id);
CREATE TABLE community_curation_state (
 id TINYINT UNSIGNED PRIMARY KEY,
 revision BIGINT UNSIGNED NOT NULL DEFAULT 1
) ENGINE=InnoDB;
INSERT INTO community_curation_state(id) VALUES(1);
CREATE TABLE community_curations (
 slot TINYINT UNSIGNED PRIMARY KEY,
 work_id BINARY(16) NULL,
 discovery_revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
 selected_by BINARY(16) NULL,
 selected_at DATETIME(6) NULL,
 UNIQUE KEY curations_work (work_id),
 CONSTRAINT curation_work_fk FOREIGN KEY(work_id) REFERENCES works(id) ON DELETE SET NULL
) ENGINE=InnoDB;
INSERT INTO community_curations(slot) VALUES(1),(2),(3),(4),(5),(6);
CREATE TABLE community_curation_mutations (
 actor_id BINARY(16) NOT NULL,
 mutation_id BINARY(16) NOT NULL,
 payload_hash BINARY(32) NOT NULL,
 input JSON NOT NULL,
 result JSON NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(actor_id,mutation_id),
 CONSTRAINT curation_actor_fk FOREIGN KEY(actor_id) REFERENCES accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- +goose Down
DROP TABLE community_curation_mutations;
DROP TABLE community_curations;
DROP TABLE community_curation_state;
ALTER TABLE work_versions DROP INDEX versions_first_publication;
ALTER TABLE works DROP COLUMN discovery_revision;
