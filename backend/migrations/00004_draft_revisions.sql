-- +goose NO TRANSACTION
-- +goose Up
ALTER TABLE draft_mutations ADD COLUMN result_saved_at DATETIME(6) NULL;
UPDATE draft_mutations SET result_saved_at=created_at WHERE result_saved_at IS NULL;
ALTER TABLE draft_mutations MODIFY result_saved_at DATETIME(6) NOT NULL;

CREATE TABLE draft_revisions (
    draft_id BINARY(16) NOT NULL,
    revision BIGINT UNSIGNED NOT NULL,
    title VARCHAR(200) NOT NULL,
    content MEDIUMTEXT NOT NULL,
    saved_at DATETIME(6) NOT NULL,
    PRIMARY KEY (draft_id, revision),
    KEY revisions_retention (saved_at, draft_id),
    KEY revisions_daily (draft_id, saved_at, revision),
    CONSTRAINT revisions_draft_fk FOREIGN KEY (draft_id) REFERENCES drafts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Existing drafts have only their current snapshot; do not invent old revisions.
INSERT INTO draft_revisions (draft_id,revision,title,content,saved_at)
SELECT id,revision,title,content,updated_at FROM drafts;

-- +goose Down
DROP TABLE draft_revisions;
ALTER TABLE draft_mutations DROP COLUMN result_saved_at;
