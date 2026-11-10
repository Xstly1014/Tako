-- +goose Up
ALTER TABLE novel_shelves ADD COLUMN notice_checked_at DATETIME(6) NULL,
 ADD KEY novel_shelf_notice_scan(following,notice_checked_at,account_id,novel_id);
ALTER TABLE chapter_release_events ADD UNIQUE KEY chapter_release_notice_identity(chapter_id,novel_id);
CREATE TABLE novel_notices (
 id BINARY(16) PRIMARY KEY,
 account_id BINARY(16) NOT NULL,
 novel_id BINARY(16) NOT NULL,
 generation BIGINT UNSIGNED NOT NULL CHECK(generation>0),
 created_at DATETIME(6) NOT NULL,
 read_at DATETIME(6) NULL,
 UNIQUE KEY novel_notice_scope(id,account_id,novel_id,generation),
 KEY novel_notice_inbox(account_id,created_at,id),
 CONSTRAINT novel_notice_account_fk FOREIGN KEY(account_id) REFERENCES accounts(id),
 CONSTRAINT novel_notice_book_fk FOREIGN KEY(novel_id) REFERENCES novels(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE novel_notice_deliveries (
 account_id BINARY(16) NOT NULL,
 novel_id BINARY(16) NOT NULL,
 generation BIGINT UNSIGNED NOT NULL,
 chapter_id BINARY(16) NOT NULL,
 notice_id BINARY(16) NOT NULL,
 PRIMARY KEY(account_id,generation,chapter_id),
 KEY novel_notice_chapters(notice_id,chapter_id),
 CONSTRAINT novel_delivery_notice_fk FOREIGN KEY(notice_id,account_id,novel_id,generation) REFERENCES novel_notices(id,account_id,novel_id,generation),
 CONSTRAINT novel_delivery_release_fk FOREIGN KEY(chapter_id,novel_id) REFERENCES chapter_release_events(chapter_id,novel_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- +goose Down
DROP TEMPORARY TABLE IF EXISTS tako_novel_notice_rollback_guard;
CREATE TEMPORARY TABLE tako_novel_notice_rollback_guard(n BIGINT NOT NULL CHECK(n=0));
INSERT INTO tako_novel_notice_rollback_guard SELECT (SELECT COUNT(*) FROM novel_notices)+(SELECT COUNT(*) FROM novel_notice_deliveries);
DROP TEMPORARY TABLE tako_novel_notice_rollback_guard;
DROP TABLE novel_notice_deliveries;
DROP TABLE novel_notices;
ALTER TABLE chapter_release_events DROP INDEX chapter_release_notice_identity;
ALTER TABLE novel_shelves DROP INDEX novel_shelf_notice_scan,DROP COLUMN notice_checked_at;
