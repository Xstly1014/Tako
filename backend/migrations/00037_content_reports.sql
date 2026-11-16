-- +goose Up
CREATE TABLE content_reports (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 reporter_id BINARY(16) NOT NULL,
 work_id BINARY(16) NOT NULL,
 version BIGINT UNSIGNED NOT NULL,
 reason TEXT NOT NULL,
 state VARCHAR(16) NOT NULL DEFAULT 'pending',
 revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 outcome VARCHAR(16) NOT NULL DEFAULT '',
 response TEXT NOT NULL,
 case_id BIGINT UNSIGNED NULL,
 operator_id BINARY(16) NULL,
 created_at DATETIME(6) NOT NULL,
 decided_at DATETIME(6) NULL,
 UNIQUE KEY content_report_once(reporter_id,work_id,version),
 KEY content_report_inbox(state,id),
 KEY content_report_owner(reporter_id,id),
 CONSTRAINT content_report_account FOREIGN KEY(reporter_id) REFERENCES accounts(id),
 CONSTRAINT content_report_operator FOREIGN KEY(operator_id) REFERENCES accounts(id),
 CONSTRAINT content_report_version FOREIGN KEY(work_id,version) REFERENCES work_versions(work_id,version),
 CONSTRAINT content_report_case FOREIGN KEY(case_id) REFERENCES moderation_cases(id)
);

-- +goose Down
-- Preserve real reports: rollback is allowed only while the new table is empty.
CREATE TEMPORARY TABLE content_report_rollback_guard(n BIGINT NOT NULL CHECK(n=0));
INSERT INTO content_report_rollback_guard SELECT COUNT(*) FROM content_reports;
DROP TEMPORARY TABLE content_report_rollback_guard;
DROP TABLE content_reports;
