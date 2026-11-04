-- +goose Up
ALTER TABLE novel_reading_requests ADD COLUMN created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), ADD KEY reading_receipt_retention(created_at);
-- Existing receipts conservatively start their retention window at this upgrade.
-- +goose Down
ALTER TABLE novel_reading_requests DROP INDEX reading_receipt_retention, DROP COLUMN created_at;
