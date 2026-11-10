-- +goose Up
ALTER TABLE short_post_versions ADD COLUMN platform_limited BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE short_post_actions
 MODIFY COLUMN action VARCHAR(24) CHARACTER SET ascii NOT NULL,
 ADD COLUMN target_version BIGINT UNSIGNED NULL,
 ADD KEY short_post_version_actions(post_id,target_version,state_revision);
ALTER TABLE short_post_revision_submissions
 ADD COLUMN post_review_pending BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE short_post_revision_submissions SET post_review_pending=TRUE
 WHERE status='published' AND initial_pre_review=FALSE;

-- +goose Down
CREATE TEMPORARY TABLE tako_short_version_review_rollback(n BIGINT NOT NULL CHECK(n=0));
INSERT INTO tako_short_version_review_rollback SELECT
 (SELECT COUNT(*) FROM short_post_actions WHERE target_version IS NOT NULL)+
 (SELECT COUNT(*) FROM short_post_revision_submissions
  WHERE status='published' AND initial_pre_review=FALSE AND post_review_pending=FALSE);
DROP TEMPORARY TABLE tako_short_version_review_rollback;
ALTER TABLE short_post_revision_submissions DROP COLUMN post_review_pending;
ALTER TABLE short_post_actions DROP INDEX short_post_version_actions, DROP COLUMN target_version,
 MODIFY COLUMN action VARCHAR(16) CHARACTER SET ascii NOT NULL;
ALTER TABLE short_post_versions DROP COLUMN platform_limited;
