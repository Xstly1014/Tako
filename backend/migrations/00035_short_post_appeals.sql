-- +goose Up
ALTER TABLE short_post_actions ADD COLUMN target_appeal_id BINARY(16) NULL;
CREATE TABLE short_post_appeals (
 sequence BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 id BINARY(16) NOT NULL,
 post_id BINARY(16) NOT NULL,
 owner_id BINARY(16) NOT NULL,
 case_revision BIGINT UNSIGNED NOT NULL,
 state ENUM('pending','upheld','revoked') NOT NULL,
 reason VARCHAR(500) NOT NULL,
 decision_reason VARCHAR(500) NOT NULL DEFAULT '',
 submitted_at DATETIME(6) NOT NULL,
 decided_at DATETIME(6) NULL,
 pending_case BIGINT UNSIGNED GENERATED ALWAYS AS (IF(state='pending',case_revision,NULL)) STORED,
 UNIQUE KEY short_post_appeal_identity(post_id,id),
 UNIQUE KEY short_post_appeal_pending(post_id,pending_case),
 KEY short_post_appeal_case(post_id,case_revision,state,decided_at),
 KEY short_post_appeal_queue(state,sequence),
 KEY short_post_appeal_author(post_id,sequence),
 FOREIGN KEY(post_id,owner_id) REFERENCES short_posts(id,owner_id),
 FOREIGN KEY(post_id,case_revision) REFERENCES short_post_actions(post_id,state_revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- +goose Down
CREATE TEMPORARY TABLE tako_short_post_appeal_rollback(n BIGINT NOT NULL CHECK(n=0));
INSERT INTO tako_short_post_appeal_rollback SELECT COUNT(*) FROM short_post_appeals;
DROP TEMPORARY TABLE tako_short_post_appeal_rollback;
DROP TABLE short_post_appeals;
ALTER TABLE short_post_actions DROP COLUMN target_appeal_id;
