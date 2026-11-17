-- +goose Up
CREATE TABLE short_post_reports (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 reporter_id BINARY(16) NOT NULL,
 post_id BINARY(16) NOT NULL,
 version BIGINT UNSIGNED NOT NULL,
 reason TEXT NOT NULL,
 state VARCHAR(16) NOT NULL DEFAULT 'pending',
 revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 outcome VARCHAR(16) NOT NULL DEFAULT '',
 response TEXT NOT NULL,
 case_revision BIGINT UNSIGNED NULL,
 operator_id BINARY(16) NULL,
 created_at DATETIME(6) NOT NULL,
 decided_at DATETIME(6) NULL,
 UNIQUE KEY short_report_once(reporter_id,post_id,version),
 KEY short_report_inbox(state,id),
 KEY short_report_owner(reporter_id,id),
 CONSTRAINT short_report_account FOREIGN KEY(reporter_id) REFERENCES accounts(id),
 CONSTRAINT short_report_operator FOREIGN KEY(operator_id) REFERENCES accounts(id),
 CONSTRAINT short_report_version FOREIGN KEY(post_id,version) REFERENCES short_post_versions(post_id,version),
 CONSTRAINT short_report_case FOREIGN KEY(post_id,case_revision) REFERENCES short_post_actions(post_id,state_revision)
);

-- +goose Down
-- Preserve real reports: rollback is allowed only while the new table is empty.
CREATE TEMPORARY TABLE short_report_rollback_guard(n BIGINT NOT NULL CHECK(n=0));
INSERT INTO short_report_rollback_guard SELECT COUNT(*) FROM short_post_reports;
DROP TEMPORARY TABLE short_report_rollback_guard;
DROP TABLE short_post_reports;
