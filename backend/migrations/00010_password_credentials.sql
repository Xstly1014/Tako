-- +goose Up
CREATE TABLE account_passwords (
    account_id BINARY(16) PRIMARY KEY,
    password_hash VARBINARY(100) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT password_account_fk FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- +goose Down
DROP TABLE account_passwords;
