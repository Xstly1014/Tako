-- +goose Up
CREATE TABLE work_comments (
 sequence BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 id BINARY(16) NOT NULL UNIQUE,
 work_id BINARY(16) NOT NULL,
 author_id BINARY(16) NOT NULL,
 root_id BINARY(16) NULL,
 reply_to BINARY(16) NULL,
 content TEXT NULL,
 deleted BOOLEAN NOT NULL DEFAULT FALSE,
 blocked BOOLEAN NOT NULL DEFAULT FALSE,
 revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 created_at DATETIME(6) NOT NULL,
 KEY comments_thread(work_id,root_id,sequence),
 KEY comments_author_rate(author_id,created_at),
 FOREIGN KEY(work_id) REFERENCES works(id),
 FOREIGN KEY(author_id) REFERENCES accounts(id),
 FOREIGN KEY(root_id) REFERENCES work_comments(id),
 FOREIGN KEY(reply_to) REFERENCES work_comments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE comment_mutations (
 actor_id BINARY(16) NOT NULL,
 mutation_id BINARY(16) NOT NULL,
 payload_hash BINARY(32) NOT NULL,
 result JSON NOT NULL,
 PRIMARY KEY(actor_id,mutation_id),
 FOREIGN KEY(actor_id) REFERENCES accounts(id)
) ENGINE=InnoDB;
CREATE TABLE comment_actions (
 sequence BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 comment_id BINARY(16) NOT NULL,
 actor_id BINARY(16) NOT NULL,
 kind VARCHAR(16) CHARACTER SET ascii NOT NULL,
 reason VARCHAR(500) NOT NULL,
 created_at DATETIME(6) NOT NULL,
 KEY comment_action_target(comment_id,sequence),
 FOREIGN KEY(comment_id) REFERENCES work_comments(id),
 FOREIGN KEY(actor_id) REFERENCES accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- +goose Down
DROP TABLE comment_actions;
DROP TABLE comment_mutations;
DROP TABLE work_comments;
