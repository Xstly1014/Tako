-- +goose Up
ALTER TABLE short_posts
 ADD COLUMN state_revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 ADD COLUMN review_status ENUM('pending','reviewed','rejected') NOT NULL DEFAULT 'pending',
 ADD COLUMN author_hidden BOOLEAN NOT NULL DEFAULT FALSE,
 ADD COLUMN platform_limited BOOLEAN NOT NULL DEFAULT FALSE,
 ADD KEY short_post_review_order(review_status,submitted_at,id);
CREATE TABLE short_post_actions (
 actor_id BINARY(16) NOT NULL,
 mutation_id BINARY(16) NOT NULL,
 post_id BINARY(16) NOT NULL,
 state_revision BIGINT UNSIGNED NOT NULL,
 action VARCHAR(16) CHARACTER SET ascii NOT NULL,
 reason VARCHAR(500) NOT NULL,
 payload_hash BINARY(32) NOT NULL,
 receipt JSON NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(actor_id,mutation_id),
 UNIQUE KEY short_post_action_order(post_id,state_revision),
 FOREIGN KEY(post_id) REFERENCES short_posts(id),
 FOREIGN KEY(actor_id) REFERENCES accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- +goose Down
CREATE TEMPORARY TABLE tako_short_post_action_rollback(n BIGINT NOT NULL CHECK(n=0));
INSERT INTO tako_short_post_action_rollback SELECT COUNT(*) FROM short_post_actions;
DROP TEMPORARY TABLE tako_short_post_action_rollback;
DROP TABLE short_post_actions;
ALTER TABLE short_posts
 DROP INDEX short_post_review_order,
 DROP COLUMN state_revision,
 DROP COLUMN review_status,
 DROP COLUMN author_hidden,
 DROP COLUMN platform_limited;
