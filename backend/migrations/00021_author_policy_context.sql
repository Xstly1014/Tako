-- +goose Up
ALTER TABLE novel_author_policy_events DROP FOREIGN KEY author_policy_book_fk, CHANGE COLUMN novel_id context_id BINARY(16) NOT NULL, ADD COLUMN context_kind ENUM('novel','work') NOT NULL DEFAULT 'novel';
-- +goose Down
DROP TEMPORARY TABLE IF EXISTS tako_policy_context_guard;
CREATE TEMPORARY TABLE tako_policy_context_guard(n BIGINT NOT NULL CHECK(n=0));
INSERT INTO tako_policy_context_guard SELECT COUNT(*) FROM novel_author_policy_events WHERE context_kind!='novel';
DROP TEMPORARY TABLE tako_policy_context_guard;
ALTER TABLE novel_author_policy_events DROP COLUMN context_kind, CHANGE COLUMN context_id novel_id BINARY(16) NOT NULL, ADD CONSTRAINT author_policy_book_fk FOREIGN KEY(novel_id) REFERENCES novels(id);
