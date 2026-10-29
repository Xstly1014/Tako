-- +goose Up
CREATE TABLE accounts (
    id BINARY(16) PRIMARY KEY,
    email VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    nickname VARCHAR(64) NOT NULL DEFAULT '',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY accounts_email_unique (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE drafts (
    id BINARY(16) PRIMARY KEY,
    owner_id BINARY(16) NOT NULL,
    title VARCHAR(200) NOT NULL DEFAULT '',
    content MEDIUMTEXT NOT NULL,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
    recovered_from_id BINARY(16) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    KEY drafts_owner_updated (owner_id, updated_at, id),
    CONSTRAINT drafts_owner_fk FOREIGN KEY (owner_id) REFERENCES accounts(id),
    CONSTRAINT drafts_recovery_fk FOREIGN KEY (recovered_from_id) REFERENCES drafts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The service must store the mutation result in the same transaction as the write.
CREATE TABLE draft_mutations (
    owner_id BINARY(16) NOT NULL,
    mutation_id BINARY(16) NOT NULL,
    operation VARCHAR(32) CHARACTER SET ascii NOT NULL,
    payload_hash BINARY(32) NOT NULL,
    result_draft_id BINARY(16) NOT NULL,
    result_revision BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (owner_id, mutation_id),
    CONSTRAINT mutations_owner_fk FOREIGN KEY (owner_id) REFERENCES accounts(id),
    CONSTRAINT mutations_draft_fk FOREIGN KEY (result_draft_id) REFERENCES drafts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- +goose Down
DROP TABLE draft_mutations;
DROP TABLE drafts;
DROP TABLE accounts;
