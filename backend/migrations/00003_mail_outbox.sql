-- +goose Up
CREATE TABLE login_mail_outbox (
    delivery_id BINARY(16) PRIMARY KEY,
    email VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    encrypted_code VARBINARY(128) NULL,
    state VARCHAR(16) CHARACTER SET ascii NOT NULL,
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    next_attempt_at DATETIME(6) NOT NULL,
    lease_until DATETIME(6) NULL,
    lease_token BINARY(16) NULL,
    expires_at DATETIME(6) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    failure_code VARCHAR(32) CHARACTER SET ascii NULL,
    KEY mail_queue (state, next_attempt_at, created_at),
    KEY mail_lease (state, lease_until),
    KEY mail_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- +goose Down
DROP TABLE login_mail_outbox;
