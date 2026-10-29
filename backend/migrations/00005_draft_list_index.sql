-- +goose NO TRANSACTION
-- +goose Up
CREATE INDEX drafts_owner_created ON drafts (owner_id, created_at, id);

-- +goose Down
DROP INDEX drafts_owner_created ON drafts;
