-- +goose Up
-- Sequence orders actual first releases, not chapter ordinals; gaps are valid.
-- Subscription and publication share the book lock, so a same-book boundary is committed.
ALTER TABLE chapter_release_events
 ADD COLUMN release_sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 ADD UNIQUE KEY chapter_release_sequence(release_sequence),
 ADD KEY chapter_release_book_sequence(novel_id,release_sequence);
CREATE TABLE novel_shelves (
 account_id BINARY(16) NOT NULL,
 novel_id BINARY(16) NOT NULL,
 in_shelf BOOLEAN NOT NULL,
 following BOOLEAN NOT NULL,
 revision BIGINT UNSIGNED NOT NULL,
 generation BIGINT UNSIGNED NOT NULL,
 start_sequence BIGINT UNSIGNED NOT NULL,
 added_at DATETIME(6) NOT NULL,
 updated_at DATETIME(6) NOT NULL,
 PRIMARY KEY(account_id,novel_id),
 KEY novel_shelf_list(account_id,in_shelf,added_at,novel_id),
 KEY novel_shelf_followers(novel_id,following,account_id),
 CONSTRAINT novel_shelf_account_fk FOREIGN KEY(account_id) REFERENCES accounts(id),
 CONSTRAINT novel_shelf_book_fk FOREIGN KEY(novel_id) REFERENCES novels(id),
 CONSTRAINT novel_shelf_follow_membership CHECK(following=FALSE OR in_shelf=TRUE)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE novel_shelf_requests (
 account_id BINARY(16) NOT NULL,
 mutation_id BINARY(16) NOT NULL,
 novel_id BINARY(16) NOT NULL,
 payload_hash BINARY(32) NOT NULL,
 result JSON NOT NULL,
 created_at DATETIME(6) NOT NULL,
 PRIMARY KEY(account_id,mutation_id),
 CONSTRAINT novel_shelf_request_account_fk FOREIGN KEY(account_id) REFERENCES accounts(id),
 CONSTRAINT novel_shelf_request_book_fk FOREIGN KEY(novel_id) REFERENCES novels(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- +goose Down
DROP TEMPORARY TABLE IF EXISTS tako_novel_shelf_rollback_guard;
CREATE TEMPORARY TABLE tako_novel_shelf_rollback_guard(n BIGINT NOT NULL CHECK(n=0));
INSERT INTO tako_novel_shelf_rollback_guard SELECT (SELECT COUNT(*) FROM novel_shelves)+(SELECT COUNT(*) FROM novel_shelf_requests);
DROP TEMPORARY TABLE tako_novel_shelf_rollback_guard;
DROP TABLE novel_shelf_requests;
DROP TABLE novel_shelves;
ALTER TABLE chapter_release_events DROP INDEX chapter_release_book_sequence, DROP INDEX chapter_release_sequence, DROP COLUMN release_sequence;
