-- +goose Up
CREATE TABLE runtime_health (
    role VARCHAR(32) CHARACTER SET ascii PRIMARY KEY,
    last_seen DATETIME(6) NOT NULL,
    last_success DATETIME(6) NULL,
    failure_count BIGINT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB;

-- +goose Down
DROP TABLE runtime_health;
