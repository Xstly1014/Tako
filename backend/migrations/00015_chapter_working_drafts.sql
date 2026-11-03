-- +goose Up
ALTER TABLE novels ADD UNIQUE KEY novels_owner_identity(id,owner_id);
CREATE TABLE novel_chapters (
 id BINARY(16) PRIMARY KEY,
 novel_id BINARY(16) NOT NULL,
 owner_id BINARY(16) NOT NULL,
 primary_draft_id BINARY(16) NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY chapter_identity(id,novel_id,owner_id),
 KEY chapters_book_created(novel_id,owner_id,created_at,id),
 CONSTRAINT chapters_book_fk FOREIGN KEY(novel_id,owner_id) REFERENCES novels(id,owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- LIKE reuses field/index definitions, but MySQL does not copy foreign keys.
CREATE TABLE chapter_drafts LIKE drafts;
ALTER TABLE chapter_drafts
 ADD COLUMN novel_id BINARY(16) NOT NULL,
 ADD COLUMN chapter_id BINARY(16) NOT NULL,
 ADD UNIQUE KEY chapter_one_working_draft(chapter_id),
 ADD KEY chapter_drafts_owner_book_created(owner_id,novel_id,created_at,id),
 ADD CONSTRAINT chapter_drafts_owner_fk FOREIGN KEY(owner_id) REFERENCES accounts(id),
 ADD CONSTRAINT chapter_drafts_recovery_fk FOREIGN KEY(recovered_from_id) REFERENCES chapter_drafts(id),
 ADD CONSTRAINT chapter_drafts_parent_fk FOREIGN KEY(chapter_id,novel_id,owner_id) REFERENCES novel_chapters(id,novel_id,owner_id);
CREATE TABLE chapter_draft_mutations LIKE draft_mutations;
ALTER TABLE chapter_draft_mutations
 ADD CONSTRAINT chapter_mutations_owner_fk FOREIGN KEY(owner_id) REFERENCES accounts(id),
 ADD CONSTRAINT chapter_mutations_draft_fk FOREIGN KEY(result_draft_id) REFERENCES chapter_drafts(id);
CREATE TABLE chapter_draft_revisions LIKE draft_revisions;
ALTER TABLE chapter_draft_revisions ADD CONSTRAINT chapter_revisions_draft_fk FOREIGN KEY(draft_id) REFERENCES chapter_drafts(id) ON DELETE CASCADE;
ALTER TABLE novel_chapters ADD CONSTRAINT chapter_primary_draft_fk FOREIGN KEY(primary_draft_id) REFERENCES chapter_drafts(id);
-- +goose Down
DROP TEMPORARY TABLE IF EXISTS tako_chapter_rollback_guard;
CREATE TEMPORARY TABLE tako_chapter_rollback_guard(n BIGINT NOT NULL CHECK(n=0));
INSERT INTO tako_chapter_rollback_guard SELECT (SELECT COUNT(*) FROM novel_chapters)+(SELECT COUNT(*) FROM chapter_drafts);
DROP TEMPORARY TABLE tako_chapter_rollback_guard;
ALTER TABLE novel_chapters DROP FOREIGN KEY chapter_primary_draft_fk;
DROP TABLE chapter_draft_mutations;
DROP TABLE chapter_draft_revisions;
DROP TABLE chapter_drafts;
DROP TABLE novel_chapters;
ALTER TABLE novels DROP INDEX novels_owner_identity;
