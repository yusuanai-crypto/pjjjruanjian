-- Phase 11 transfer, in-transit and unavailable flow (expand only).
--
-- Rehearse the enum ALTER statements on an isolated MySQL copy at the target
-- version. MySQL enum metadata changes and additive indexes can wait for or
-- hold metadata locks. This migration performs no data backfill and does not
-- create warehouses, transfer facts, default configuration or stock values.

ALTER TABLE `inventory_documents`
  MODIFY `type` ENUM(
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
    'transfer_difference',
    'unavailable_adjustment',
    'reversal'
  ) NOT NULL;

ALTER TABLE `inventory_movements`
  MODIFY `movement_type` ENUM(
    'opening_in',
    'purchase_in',
    'customer_return',
    'reserve',
    'release',
    'sales_out',
    'transfer_out',
    'transfer_in',
    'transfer_difference',
    'stock_gain',
    'stock_loss',
    'other_in',
    'other_out',
    'unavailable_in',
    'unavailable_out',
    'reversal'
  ) NOT NULL;

ALTER TABLE `inventory_transfers`
  ADD COLUMN `outbound_source_key` VARCHAR(191) NULL
    AFTER `outbound_document_id`,
  ADD COLUMN `outbound_idempotency_key` VARCHAR(191) NULL
    AFTER `outbound_source_key`,
  ADD COLUMN `outbound_request_hash` CHAR(64) NULL
    AFTER `outbound_idempotency_key`,
  ADD COLUMN `version` INTEGER NOT NULL DEFAULT 0
    AFTER `notes`,
  ADD CONSTRAINT `inventory_transfers_outbound_envelope_check`
    CHECK (
      (
        `outbound_source_key` IS NULL
        AND `outbound_idempotency_key` IS NULL
        AND `outbound_request_hash` IS NULL
      )
      OR (
        CHAR_LENGTH(TRIM(`outbound_source_key`)) > 0
        AND CHAR_LENGTH(TRIM(`outbound_idempotency_key`)) > 0
        AND `outbound_request_hash` REGEXP '^[0-9a-f]{64}$'
      )
    ),
  ADD CONSTRAINT `inventory_transfers_version_check`
    CHECK (`version` >= 0),
  ADD UNIQUE INDEX `inventory_transfers_outbound_source_key`
    (`outbound_source_key`),
  ADD UNIQUE INDEX `inventory_transfers_outbound_idempotency_key`
    (`outbound_idempotency_key`);

ALTER TABLE `inventory_transfer_lines`
  ADD COLUMN `source_line_key` VARCHAR(191) NULL
    AFTER `line_no`,
  ADD COLUMN `tracking_mode_snapshot`
    ENUM('none', 'quantity', 'serialized') NULL
    AFTER `product_id`,
  ADD COLUMN `unavailable_qty` INTEGER NOT NULL DEFAULT 0
    AFTER `received_qty`,
  ADD COLUMN `serialized_unit_ids` JSON NULL
    AFTER `difference_qty`,
  ADD COLUMN `version` INTEGER NOT NULL DEFAULT 0
    AFTER `notes`,
  ADD CONSTRAINT `inventory_transfer_lines_source_line_key_check`
    CHECK (
      `source_line_key` IS NULL
      OR CHAR_LENGTH(TRIM(`source_line_key`)) > 0
    ),
  ADD CONSTRAINT `inventory_transfer_lines_flow_quantity_check`
    CHECK (
      `planned_qty` > 0
      AND `outbound_qty` >= 0
      AND `received_qty` >= 0
      AND `unavailable_qty` >= 0
      AND `difference_qty` >= 0
      AND `unavailable_qty` <= `received_qty`
      AND `received_qty` + `difference_qty` <= `outbound_qty`
      AND `version` >= 0
    ),
  ADD UNIQUE INDEX `inventory_transfer_lines_source_line_key`
    (`source_line_key`);

ALTER TABLE `inventory_transfer_receipts`
  ADD COLUMN `version` INTEGER NOT NULL DEFAULT 0
    AFTER `notes`,
  ADD CONSTRAINT `inventory_transfer_receipts_version_check`
    CHECK (`version` >= 0);

ALTER TABLE `inventory_transfer_receipt_lines`
  ADD CONSTRAINT `inventory_transfer_receipt_lines_difference_check`
    CHECK (
      `received_qty` + `difference_qty` > 0
      AND (
        `difference_qty` = 0
        OR CHAR_LENGTH(TRIM(`notes`)) > 0
      )
    );
