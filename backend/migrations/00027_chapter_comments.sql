-- +goose Up
ALTER TABLE novel_chapters ADD UNIQUE KEY chapter_discussion_identity(id,novel_id);
CREATE TABLE chapter_comments (
 sequence BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 id BINARY(16) NOT NULL UNIQUE,
 chapter_id BINARY(16) NOT NULL,
 novel_id BINARY(16) NOT NULL,
 author_id BINARY(16) NOT NULL,
 root_id BINARY(16) NULL,
 reply_to BINARY(16) NULL,
 content TEXT NULL,
 deleted BOOLEAN NOT NULL DEFAULT FALSE,
 blocked BOOLEAN NOT NULL DEFAULT FALSE,
 revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 created_at DATETIME(6) NOT NULL,
 KEY comments_thread(chapter_id,root_id,sequence),
 KEY chapter_comments_book(novel_id,sequence),
 KEY chapter_comments_mine(author_id,sequence),
 KEY comments_author_rate(author_id,created_at),
 UNIQUE KEY chapter_comment_scope(id,chapter_id),
 FOREIGN KEY(chapter_id,novel_id) REFERENCES novel_chapters(id,novel_id),
 FOREIGN KEY(author_id) REFERENCES accounts(id),
 FOREIGN KEY(root_id,chapter_id) REFERENCES chapter_comments(id,chapter_id),
 FOREIGN KEY(reply_to,chapter_id) REFERENCES chapter_comments(id,chapter_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE chapter_comment_mutations (
 actor_id BINARY(16) NOT NULL,
 mutation_id BINARY(16) NOT NULL,
 payload_hash BINARY(32) NOT NULL,
 result JSON NOT NULL,
 PRIMARY KEY(actor_id,mutation_id),
 FOREIGN KEY(actor_id) REFERENCES accounts(id)
) ENGINE=InnoDB;
CREATE TABLE chapter_comment_actions (
 sequence BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 comment_id BINARY(16) NOT NULL,
 actor_id BINARY(16) NOT NULL,
 kind VARCHAR(16) CHARACTER SET ascii NOT NULL,
 reason VARCHAR(500) NOT NULL,
 created_at DATETIME(6) NOT NULL,
 KEY comment_action_target(comment_id,sequence),
 FOREIGN KEY(comment_id) REFERENCES chapter_comments(id),
 FOREIGN KEY(actor_id) REFERENCES accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- +goose Down
CREATE TEMPORARY TABLE tako_chapter_comment_rollback_guard(n BIGINT NOT NULL CHECK(n=0));
INSERT INTO tako_chapter_comment_rollback_guard SELECT (SELECT COUNT(*) FROM chapter_comments)+(SELECT COUNT(*) FROM chapter_comment_mutations)+(SELECT COUNT(*) FROM chapter_comment_actions);
DROP TEMPORARY TABLE tako_chapter_comment_rollback_guard;
DROP TABLE chapter_comment_actions;
DROP TABLE chapter_comment_mutations;
DROP TABLE chapter_comments;
ALTER TABLE novel_chapters DROP INDEX chapter_discussion_identity;
