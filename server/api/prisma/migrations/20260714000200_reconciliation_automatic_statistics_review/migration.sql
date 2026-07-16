ALTER TABLE `daily_reconciliations`
  ADD COLUMN `review_status` ENUM('pending_review', 'reviewed') NOT NULL DEFAULT 'pending_review',
  ADD COLUMN `reviewed_by_id` CHAR(36) NULL,
  ADD COLUMN `reviewed_at` DATETIME(0) NULL,
  ADD COLUMN `review_source_hash` VARCHAR(64) NULL;

CREATE INDEX `daily_reconciliations_review_status_business_date_idx`
  ON `daily_reconciliations`(`review_status`, `business_date`);

CREATE INDEX `daily_reconciliations_reviewed_by_id_idx`
  ON `daily_reconciliations`(`reviewed_by_id`);

ALTER TABLE `daily_reconciliations`
  ADD CONSTRAINT `daily_reconciliations_reviewed_by_id_fkey`
  FOREIGN KEY (`reviewed_by_id`) REFERENCES `users`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
