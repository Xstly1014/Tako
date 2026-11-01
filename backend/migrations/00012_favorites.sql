-- +goose Up
CREATE TABLE work_favorites (
 account_id BINARY(16) NOT NULL,
 work_id BINARY(16) NOT NULL,
 active BOOLEAN NOT NULL,
 revision BIGINT UNSIGNED NOT NULL,
 saved_at DATETIME(6) NOT NULL,
 PRIMARY KEY(account_id,work_id),
 KEY favorites_page(account_id,active,saved_at,work_id),
 FOREIGN KEY(account_id) REFERENCES accounts(id),
 FOREIGN KEY(work_id) REFERENCES works(id)
) ENGINE=InnoDB;
CREATE TABLE favorite_mutations (
 account_id BINARY(16) NOT NULL,
 mutation_id BINARY(16) NOT NULL,
 payload_hash BINARY(32) NOT NULL,
 result JSON NOT NULL,
 PRIMARY KEY(account_id,mutation_id),
 FOREIGN KEY(account_id) REFERENCES accounts(id)
) ENGINE=InnoDB;
-- +goose Down
DROP TABLE favorite_mutations;
DROP TABLE work_favorites;
