-- +goose Up
-- Independent private book metadata: never repurpose works.source_draft_id.
CREATE TABLE novels (
 id BINARY(16) PRIMARY KEY,
 owner_id BINARY(16) NOT NULL,
 title VARCHAR(200) NOT NULL,
 introduction VARCHAR(300) NOT NULL,
 tags JSON NOT NULL,
 revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 KEY novels_owner_created(owner_id,created_at,id),
 CONSTRAINT novels_owner_fk FOREIGN KEY(owner_id) REFERENCES accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE novel_mutations (
 owner_id BINARY(16) NOT NULL,
 mutation_id BINARY(16) NOT NULL,
 payload_hash BINARY(32) NOT NULL,
 novel_id BINARY(16) NOT NULL,
 result JSON NOT NULL,
 PRIMARY KEY(owner_id,mutation_id),
 CONSTRAINT novel_mutations_owner_fk FOREIGN KEY(owner_id) REFERENCES accounts(id),
 CONSTRAINT novel_mutations_novel_fk FOREIGN KEY(novel_id) REFERENCES novels(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- +goose Down
DROP TABLE novel_mutations;
DROP TABLE novels;
