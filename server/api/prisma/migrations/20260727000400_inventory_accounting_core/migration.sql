-- Phase 11 inventory accounting core (expand only).
-- No warehouse, product, order, batch, serialized-unit, stock, document, or
-- movement rows are inserted or backfilled by this migration.
--
-- The inventory_documents enum alteration can acquire a MySQL metadata lock.
-- Rehearse it against an isolated database with production-like table sizes
-- before any production deployment.

ALTER TABLE `inventory_documents`
  MODIFY COLUMN `type` ENUM(
    'opening',
    'purchase_receipt',
    'customer_return',
    'reservation_adjustment',
    'stock_gain',
    'other_in',
    'sales_outbound',
    'stock_loss',
    'other_out',
    'transfer_out',
    'transfer_in',
    'unavailable_adjustment',
    'reversal'
  ) NOT NULL;

ALTER TABLE `inventory_movements`
  ADD COLUMN `reservation_id` CHAR(36) NULL AFTER `serialized_unit_id`,
  ADD INDEX `inventory_movements_reservation_business_idx`
    (`reservation_id`, `business_at`),
  ADD CONSTRAINT `inventory_movements_reservation_id_fkey`
    FOREIGN KEY (`reservation_id`) REFERENCES `inventory_reservations`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `inventory_post_commit_tasks` (
  `id` CHAR(36) NOT NULL,
  `source_key` VARCHAR(191) NOT NULL,
  `command_receipt_id` CHAR(36) NOT NULL,
  `task_type` VARCHAR(80) NOT NULL,
  `payload` JSON NOT NULL,
  `status` ENUM('pending', 'processing', 'succeeded', 'failed')
    NOT NULL DEFAULT 'pending',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `next_attempt_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `locked_at` DATETIME(0) NULL,
  `last_error_code` VARCHAR(100) NULL,
  `completed_at` DATETIME(0) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  CONSTRAINT `inventory_post_commit_tasks_source_key_not_blank_check`
    CHECK (CHAR_LENGTH(TRIM(`source_key`)) > 0),
  CONSTRAINT `inventory_post_commit_tasks_attempts_check`
    CHECK (`attempts` >= 0),
  UNIQUE INDEX `inventory_post_commit_tasks_source_key` (`source_key`),
  INDEX `inventory_post_commit_tasks_due_idx`
    (`status`, `next_attempt_at`, `created_at`),
  INDEX `inventory_post_commit_tasks_receipt_status_idx`
    (`command_receipt_id`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE `inventory_post_commit_tasks`
  ADD CONSTRAINT `inventory_post_commit_tasks_command_receipt_id_fkey`
    FOREIGN KEY (`command_receipt_id`)
    REFERENCES `inventory_command_receipts`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
