-- +goose Up
ALTER TABLE publication_policies ADD COLUMN revision BIGINT UNSIGNED NOT NULL DEFAULT 0, ADD COLUMN reason VARCHAR(2000) NOT NULL DEFAULT '';
CREATE TABLE novel_author_policy_events (
 owner_id BINARY(16) NOT NULL,
 revision BIGINT UNSIGNED NOT NULL,
 actor_id BINARY(16) NOT NULL,
 mutation_id BINARY(16) NOT NULL,
 novel_id BINARY(16) NOT NULL,
 action ENUM('start','extend','revoke') NOT NULL,
 reason VARCHAR(2000) NOT NULL,
 previous_until DATETIME(6) NULL,
 observation_until DATETIME(6) NULL,
 created_at DATETIME(6) NOT NULL,
 payload_hash BINARY(32) NOT NULL,
 PRIMARY KEY(owner_id,revision),
 UNIQUE KEY author_policy_mutation(actor_id,mutation_id),
 CONSTRAINT author_policy_owner_fk FOREIGN KEY(owner_id) REFERENCES accounts(id),
 CONSTRAINT author_policy_actor_fk FOREIGN KEY(actor_id) REFERENCES accounts(id),
 CONSTRAINT author_policy_book_fk FOREIGN KEY(novel_id) REFERENCES novels(id)
) ENGINE=InnoDB;
-- +goose Down
DROP TEMPORARY TABLE IF EXISTS tako_policy_rollback_guard;
CREATE TEMPORARY TABLE tako_policy_rollback_guard(n BIGINT NOT NULL CHECK(n=0));
INSERT INTO tako_policy_rollback_guard SELECT (SELECT COUNT(*) FROM novel_author_policy_events)+(SELECT COUNT(*) FROM publication_policies WHERE revision>0);
DROP TEMPORARY TABLE tako_policy_rollback_guard;
DROP TABLE novel_author_policy_events;
ALTER TABLE publication_policies DROP COLUMN revision, DROP COLUMN reason;
