-- +goose Up
CREATE TABLE login_challenges (
    email VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PRIMARY KEY,
    challenge_id BINARY(16) NOT NULL,
    code_hash BINARY(32) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    consumed BOOLEAN NOT NULL DEFAULT FALSE,
    sent_at DATETIME(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE auth_rate_limits (
    bucket_hash BINARY(32) PRIMARY KEY,
    window_started DATETIME(6) NOT NULL,
    hits INT UNSIGNED NOT NULL
) ENGINE=InnoDB;

CREATE TABLE sessions (
    token_hash BINARY(32) PRIMARY KEY,
    account_id BINARY(16) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    KEY sessions_account (account_id),
    KEY sessions_expiry (expires_at),
    CONSTRAINT sessions_account_fk FOREIGN KEY (account_id) REFERENCES accounts(id)
) ENGINE=InnoDB;

-- +goose Down
DROP TABLE sessions;
DROP TABLE auth_rate_limits;
DROP TABLE login_challenges;
