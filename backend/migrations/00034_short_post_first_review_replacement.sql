-- +goose Up
ALTER TABLE short_posts ADD COLUMN initial_review_archive ENUM('rejected','superseded') NULL;
ALTER TABLE short_post_revision_submissions
 ADD KEY short_post_revision_author_order(post_id,expected_revision);

-- +goose Down
CREATE TEMPORARY TABLE tako_short_initial_review_rollback(n BIGINT NOT NULL CHECK(n=0));
INSERT INTO tako_short_initial_review_rollback SELECT COUNT(*) FROM short_posts WHERE initial_review_archive IS NOT NULL;
DROP TEMPORARY TABLE tako_short_initial_review_rollback;
ALTER TABLE short_post_revision_submissions DROP INDEX short_post_revision_author_order;
ALTER TABLE short_posts DROP COLUMN initial_review_archive;
