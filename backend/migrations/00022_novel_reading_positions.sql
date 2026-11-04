-- +goose Up
CREATE TABLE novel_reading_positions (
 account_id BINARY(16) NOT NULL,
 novel_id BINARY(16) NOT NULL,
 chapter_id BINARY(16) NOT NULL,
 version BIGINT UNSIGNED NOT NULL,
 algorithm TINYINT UNSIGNED NOT NULL,
 paragraph_index BIGINT UNSIGNED NOT NULL,
 codepoint_offset BIGINT UNSIGNED NOT NULL,
 revision BIGINT UNSIGNED NOT NULL,
 saved_at DATETIME(6) NOT NULL,
 PRIMARY KEY(account_id,novel_id),
 CHECK(algorithm=1 AND version>0 AND revision>0),
 CONSTRAINT novel_reading_account_fk FOREIGN KEY(account_id) REFERENCES accounts(id),
 CONSTRAINT novel_reading_version_fk FOREIGN KEY(chapter_id,novel_id,version) REFERENCES chapter_versions(chapter_id,novel_id,version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE novel_reading_requests (
 account_id BINARY(16) NOT NULL,
 mutation_id BINARY(16) NOT NULL,
 novel_id BINARY(16) NOT NULL,
 payload_hash BINARY(32) NOT NULL,
 result JSON NOT NULL,
 PRIMARY KEY(account_id,mutation_id),
 CONSTRAINT novel_reading_request_account_fk FOREIGN KEY(account_id) REFERENCES accounts(id),
 CONSTRAINT novel_reading_request_book_fk FOREIGN KEY(novel_id) REFERENCES novels(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- +goose Down
DROP TEMPORARY TABLE IF EXISTS tako_reading_guard;
CREATE TEMPORARY TABLE tako_reading_guard(n BIGINT NOT NULL CHECK(n=0));
INSERT INTO tako_reading_guard SELECT (SELECT COUNT(*) FROM novel_reading_positions)+(SELECT COUNT(*) FROM novel_reading_requests);
DROP TEMPORARY TABLE tako_reading_guard;
DROP TABLE novel_reading_requests;
DROP TABLE novel_reading_positions;
