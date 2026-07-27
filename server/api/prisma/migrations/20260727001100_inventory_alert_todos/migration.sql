-- Phase 11 step 11 expand migration: inventory alerts in TodoReminder.
-- This migration does not create alert/todo facts, does not backfill thresholds,
-- and does not guess a production transfer-overdue policy.
-- Rehearse the enum metadata lock and table/index build on an isolated copy of
-- the target MySQL version before production deployment.

ALTER TABLE `business_todos`
  MODIFY `source_type`
    ENUM(
      'travel_group',
      'sales_order',
      'after_sales_order',
      'inventory_alert',
      'stocktake'
    ) NOT NULL;

ALTER TABLE `inventory_configurations`
  ADD COLUMN `transfer_overdue_hours` INTEGER NULL;

ALTER TABLE `inventory_configurations`
  ADD CONSTRAINT `inventory_configurations_transfer_overdue_hours_check`
    CHECK (
      `transfer_overdue_hours` IS NULL
      OR `transfer_overdue_hours` > 0
    );

ALTER TABLE `inventory_alerts`
  ADD COLUMN `active_key` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `inventory_alerts_active_key_key` (`active_key`);

CREATE TABLE `todo_reconcile_cursors` (
  `id` CHAR(36) NOT NULL,
  `scan_type` VARCHAR(80) NOT NULL,
  `cursor_id` CHAR(36) NULL,
  `wrapped_at` DATETIME(0) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0)
    ON UPDATE CURRENT_TIMESTAMP(0),

  CONSTRAINT `todo_reconcile_cursors_pkey` PRIMARY KEY (`id`),
  CONSTRAINT `todo_reconcile_cursors_scan_type_key`
    UNIQUE (`scan_type`),
  INDEX `todo_reconcile_cursors_updated_at_idx` (`updated_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
