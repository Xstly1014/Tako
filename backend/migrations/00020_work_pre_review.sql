-- +goose Up
CREATE TABLE work_submissions (
 id BINARY(16) PRIMARY KEY,
 work_id BINARY(16) NOT NULL,
 owner_id BINARY(16) NOT NULL,
 preview_id BINARY(16) NOT NULL,
 candidate_version BIGINT UNSIGNED NOT NULL,
 state ENUM('pending','published','rejected','withdrawn','superseded') NOT NULL DEFAULT 'pending',
 current_slot TINYINT UNSIGNED NULL DEFAULT 1,
 reason VARCHAR(2000) NOT NULL DEFAULT '',
 accepted_at DATETIME(6) NOT NULL,
 first_waiting_at DATETIME(6) NOT NULL,
 decided_at DATETIME(6) NULL,
 UNIQUE KEY work_submission_current(work_id,current_slot),
 UNIQUE KEY work_submission_preview(preview_id),
 KEY work_submission_owner(owner_id,accepted_at,id),
 KEY work_submission_queue(state,first_waiting_at,id),
 CHECK((state='pending' AND current_slot IS NOT NULL AND current_slot=1) OR (state!='pending' AND current_slot IS NULL)),
 CONSTRAINT work_submission_work_fk FOREIGN KEY(work_id) REFERENCES works(id),
 CONSTRAINT work_submission_owner_fk FOREIGN KEY(owner_id) REFERENCES accounts(id),
 CONSTRAINT work_submission_preview_fk FOREIGN KEY(preview_id) REFERENCES publication_previews(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE work_submission_requests (
 actor_id BINARY(16) NOT NULL,
 mutation_id BINARY(16) NOT NULL,
 payload_hash BINARY(32) NOT NULL,
 result JSON NOT NULL,
 PRIMARY KEY(actor_id,mutation_id),
 CONSTRAINT work_submission_request_actor_fk FOREIGN KEY(actor_id) REFERENCES accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- +goose Down
DROP TEMPORARY TABLE IF EXISTS tako_work_submission_guard;
CREATE TEMPORARY TABLE tako_work_submission_guard(n BIGINT NOT NULL CHECK(n=0));
INSERT INTO tako_work_submission_guard SELECT (SELECT COUNT(*) FROM work_submissions)+(SELECT COUNT(*) FROM work_submission_requests);
DROP TEMPORARY TABLE tako_work_submission_guard;
DROP TABLE work_submission_requests;
DROP TABLE work_submissions;
