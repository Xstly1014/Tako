-- +goose Up
CREATE TABLE author_follows (
    id BINARY(16) PRIMARY KEY,
    reader_id BINARY(16) NOT NULL,
    author_id BINARY(16) NOT NULL,
    active BOOLEAN NOT NULL,
    revision BIGINT UNSIGNED NOT NULL,
    followed_at DATETIME(6) NOT NULL,
    UNIQUE KEY reader_author(reader_id,author_id),
    KEY following_page(reader_id,active,followed_at,id),
    KEY followers_page(author_id,active,followed_at,id),
    FOREIGN KEY(reader_id) REFERENCES accounts(id),
    FOREIGN KEY(author_id) REFERENCES accounts(id),
    CHECK(reader_id <> author_id)
) ENGINE=InnoDB;

-- +goose Down
CREATE TEMPORARY TABLE tako_follow_rollback_guard (n INT CHECK(n=0));
INSERT INTO tako_follow_rollback_guard SELECT COUNT(*) FROM author_follows;
DROP TEMPORARY TABLE tako_follow_rollback_guard;
DROP TABLE author_follows;
