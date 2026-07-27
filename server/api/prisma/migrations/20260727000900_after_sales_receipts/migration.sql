-- Phase 11 step 09 expand migration: after-sales physical receipts.
-- Historical after-sales rows remain return_required=false/expected_return_qty=0.
-- No refund amount, item quantity, status, finance confirmation, or legacy
-- warehouse confirmation is converted into a physical receipt fact.
--
-- Rehearse the new indexes and foreign keys on an isolated MySQL copy before
-- production deployment. This migration is additive and performs no business
-- data INSERT/UPDATE other than MySQL applying the explicit column defaults.

ALTER TABLE `after_sales_order_items`
  ADD COLUMN `return_required` BOOLEAN NOT NULL DEFAULT false
    AFTER `subtotal_cents`,
  ADD COLUMN `expected_return_qty` INTEGER NOT NULL DEFAULT 0
    AFTER `return_required`,
  ADD COLUMN `posted_received_qty` INTEGER NOT NULL DEFAULT 0
    AFTER `expected_return_qty`,
  ADD COLUMN `return_version` INTEGER NOT NULL DEFAULT 0
    AFTER `posted_received_qty`,
  ADD CONSTRAINT `after_sales_order_items_return_quantity_check`
    CHECK (
      (
        `return_required` = false
        AND `expected_return_qty` = 0
        AND `posted_received_qty` = 0
      )
      OR
      (
        `return_required` = true
        AND `expected_return_qty` > 0
        AND `posted_received_qty` >= 0
        AND `posted_received_qty` <= `expected_return_qty`
      )
    ),
  ADD CONSTRAINT `after_sales_order_items_return_version_check`
    CHECK (`return_version` >= 0);

CREATE TABLE `after_sales_receipts` (
  `id` CHAR(36) NOT NULL,
  `after_sales_order_id` CHAR(36) NOT NULL,
  `warehouse_id` CHAR(36) NOT NULL,
  `status` ENUM('draft', 'posted', 'reversed') NOT NULL DEFAULT 'draft',
  `source_key` VARCHAR(191) NOT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `post_source_key` VARCHAR(191) NULL,
  `post_idempotency_key` VARCHAR(191) NULL,
  `post_request_hash` CHAR(64) NULL,
  `reverse_source_key` VARCHAR(191) NULL,
  `reverse_idempotency_key` VARCHAR(191) NULL,
  `reverse_request_hash` CHAR(64) NULL,
  `notes` TEXT NULL,
  `reversal_reason` VARCHAR(500) NULL,
  `confirmed_by_id` CHAR(36) NULL,
  `confirmed_by_name_snapshot` VARCHAR(100) NULL,
  `confirmed_by_role_snapshot` VARCHAR(32) NULL,
  `confirmed_at` DATETIME(0) NULL,
  `reversed_by_id` CHAR(36) NULL,
  `reversed_by_name_snapshot` VARCHAR(100) NULL,
  `reversed_by_role_snapshot` VARCHAR(32) NULL,
  `reversed_at` DATETIME(0) NULL,
  `version` INTEGER NOT NULL DEFAULT 0,
  `created_by_id` CHAR(36) NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0)
    ON UPDATE CURRENT_TIMESTAMP(0),

  CONSTRAINT `after_sales_receipts_pkey` PRIMARY KEY (`id`),
  CONSTRAINT `after_sales_receipts_source_key` UNIQUE (`source_key`),
  CONSTRAINT `after_sales_receipts_idempotency_key` UNIQUE (`idempotency_key`),
  CONSTRAINT `after_sales_receipts_post_source_key` UNIQUE (`post_source_key`),
  CONSTRAINT `after_sales_receipts_post_idempotency_key`
    UNIQUE (`post_idempotency_key`),
  CONSTRAINT `after_sales_receipts_reverse_source_key`
    UNIQUE (`reverse_source_key`),
  CONSTRAINT `after_sales_receipts_reverse_idempotency_key`
    UNIQUE (`reverse_idempotency_key`),
  CONSTRAINT `after_sales_receipts_source_key_not_blank`
    CHECK (CHAR_LENGTH(TRIM(`source_key`)) > 0),
  CONSTRAINT `after_sales_receipts_idempotency_key_not_blank`
    CHECK (CHAR_LENGTH(TRIM(`idempotency_key`)) > 0),
  CONSTRAINT `after_sales_receipts_request_hash_check`
    CHECK (`request_hash` REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT `after_sales_receipts_post_envelope_check`
    CHECK (
      (
        `post_source_key` IS NULL
        AND `post_idempotency_key` IS NULL
        AND `post_request_hash` IS NULL
        AND `confirmed_at` IS NULL
      )
      OR
      (
        CHAR_LENGTH(TRIM(`post_source_key`)) > 0
        AND CHAR_LENGTH(TRIM(`post_idempotency_key`)) > 0
        AND `post_request_hash` REGEXP '^[0-9a-f]{64}$'
        AND `confirmed_at` IS NOT NULL
      )
    ),
  CONSTRAINT `after_sales_receipts_reverse_envelope_check`
    CHECK (
      (
        `reverse_source_key` IS NULL
        AND `reverse_idempotency_key` IS NULL
        AND `reverse_request_hash` IS NULL
        AND `reversed_at` IS NULL
        AND `reversal_reason` IS NULL
      )
      OR
      (
        CHAR_LENGTH(TRIM(`reverse_source_key`)) > 0
        AND CHAR_LENGTH(TRIM(`reverse_idempotency_key`)) > 0
        AND `reverse_request_hash` REGEXP '^[0-9a-f]{64}$'
        AND `reversed_at` IS NOT NULL
        AND CHAR_LENGTH(TRIM(`reversal_reason`)) > 0
      )
    ),
  CONSTRAINT `after_sales_receipts_status_audit_check`
    CHECK (
      (`status` = 'draft' AND `confirmed_at` IS NULL AND `reversed_at` IS NULL)
      OR (`status` = 'posted' AND `confirmed_at` IS NOT NULL AND `reversed_at` IS NULL)
      OR (`status` = 'reversed' AND `confirmed_at` IS NOT NULL AND `reversed_at` IS NOT NULL)
    ),
  CONSTRAINT `after_sales_receipts_version_check`
    CHECK (`version` >= 0),
  INDEX `after_sales_receipts_order_status_idx`
    (`after_sales_order_id`, `status`, `created_at`),
  INDEX `after_sales_receipts_warehouse_status_idx`
    (`warehouse_id`, `status`, `created_at`),
  INDEX `after_sales_receipts_confirmed_by_id_idx` (`confirmed_by_id`),
  INDEX `after_sales_receipts_reversed_by_id_idx` (`reversed_by_id`),
  INDEX `after_sales_receipts_created_by_id_idx` (`created_by_id`),
  INDEX `after_sales_receipts_updated_by_id_idx` (`updated_by_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `after_sales_receipt_lines` (
  `id` CHAR(36) NOT NULL,
  `receipt_id` CHAR(36) NOT NULL,
  `after_sales_order_item_id` CHAR(36) NOT NULL,
  `line_no` INTEGER NOT NULL,
  `received_qty` INTEGER NOT NULL,
  `condition` ENUM('saleable', 'unavailable', 'exception') NOT NULL,
  `inventory_batch_id` CHAR(36) NULL,
  `exception_reason` VARCHAR(500) NULL,
  `notes` TEXT NULL,
  `version` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0)
    ON UPDATE CURRENT_TIMESTAMP(0),

  CONSTRAINT `after_sales_receipt_lines_pkey` PRIMARY KEY (`id`),
  CONSTRAINT `after_sales_receipt_lines_receipt_line_key`
    UNIQUE (`receipt_id`, `line_no`),
  CONSTRAINT `after_sales_receipt_lines_quantity_check`
    CHECK (`line_no` > 0 AND `received_qty` > 0 AND `version` >= 0),
  CONSTRAINT `after_sales_receipt_lines_exception_check`
    CHECK (
      (`condition` = 'exception' AND CHAR_LENGTH(TRIM(`exception_reason`)) > 0)
      OR (`condition` IN ('saleable', 'unavailable'))
    ),
  INDEX `after_sales_receipt_lines_after_sales_item_idx`
    (`after_sales_order_item_id`),
  INDEX `after_sales_receipt_lines_inventory_batch_id_idx`
    (`inventory_batch_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `after_sales_receipt_serialized_units` (
  `id` CHAR(36) NOT NULL,
  `receipt_line_id` CHAR(36) NOT NULL,
  `original_serialized_unit_id` CHAR(36) NULL,
  `scanned_logistics_code_snapshot` VARCHAR(160) NOT NULL,
  `normalized_scanned_logistics_code` VARCHAR(160) NOT NULL,
  `match_status` ENUM('matched', 'unknown', 'conflict') NOT NULL,
  `active_original_unit_key` CHAR(36) NULL,
  `previous_warehouse_id` CHAR(36) NULL,
  `previous_status`
    ENUM(
      'pending_cost',
      'available',
      'allocated',
      'reserved',
      'outbound',
      'unavailable',
      'void'
    ) NULL,
  `inventory_movement_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0)
    ON UPDATE CURRENT_TIMESTAMP(0),

  CONSTRAINT `after_sales_receipt_serialized_units_pkey` PRIMARY KEY (`id`),
  CONSTRAINT `after_sales_receipt_serialized_active_unit_key`
    UNIQUE (`active_original_unit_key`),
  CONSTRAINT `after_sales_receipt_serialized_movement_key`
    UNIQUE (`inventory_movement_id`),
  CONSTRAINT `after_sales_receipt_serialized_scan_not_blank`
    CHECK (
      CHAR_LENGTH(TRIM(`scanned_logistics_code_snapshot`)) > 0
      AND CHAR_LENGTH(TRIM(`normalized_scanned_logistics_code`)) > 0
    ),
  CONSTRAINT `after_sales_receipt_serialized_match_check`
    CHECK (
      (`match_status` = 'matched' AND `original_serialized_unit_id` IS NOT NULL)
      OR (`match_status` IN ('unknown', 'conflict'))
    ),
  CONSTRAINT `after_sales_receipt_serialized_active_key_check`
    CHECK (
      `active_original_unit_key` IS NULL
      OR (
        `match_status` = 'matched'
        AND `active_original_unit_key` = `original_serialized_unit_id`
      )
    ),
  INDEX `after_sales_receipt_serialized_line_status_idx`
    (`receipt_line_id`, `match_status`),
  INDEX `after_sales_receipt_serialized_unit_status_idx`
    (`original_serialized_unit_id`, `match_status`),
  INDEX `after_sales_receipt_serialized_scanned_code_idx`
    (`normalized_scanned_logistics_code`),
  INDEX `after_sales_receipt_serialized_previous_warehouse_id_idx`
    (`previous_warehouse_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `after_sales_receipts`
  ADD CONSTRAINT `after_sales_receipts_after_sales_order_id_fkey`
    FOREIGN KEY (`after_sales_order_id`) REFERENCES `after_sales_orders`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `after_sales_receipts_warehouse_id_fkey`
    FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `after_sales_receipts_confirmed_by_id_fkey`
    FOREIGN KEY (`confirmed_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `after_sales_receipts_reversed_by_id_fkey`
    FOREIGN KEY (`reversed_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `after_sales_receipts_created_by_id_fkey`
    FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `after_sales_receipts_updated_by_id_fkey`
    FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `after_sales_receipt_lines`
  ADD CONSTRAINT `after_sales_receipt_lines_receipt_id_fkey`
    FOREIGN KEY (`receipt_id`) REFERENCES `after_sales_receipts`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `after_sales_receipt_lines_after_sales_item_id_fkey`
    FOREIGN KEY (`after_sales_order_item_id`) REFERENCES `after_sales_order_items`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `after_sales_receipt_lines_inventory_batch_id_fkey`
    FOREIGN KEY (`inventory_batch_id`) REFERENCES `inventory_batches`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `after_sales_receipt_serialized_units`
  ADD CONSTRAINT `after_sales_receipt_serialized_units_line_id_fkey`
    FOREIGN KEY (`receipt_line_id`) REFERENCES `after_sales_receipt_lines`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `after_sales_receipt_serialized_units_original_unit_id_fkey`
    FOREIGN KEY (`original_serialized_unit_id`) REFERENCES `serialized_inventory_units`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `after_sales_receipt_serialized_units_previous_warehouse_id_fkey`
    FOREIGN KEY (`previous_warehouse_id`) REFERENCES `warehouses`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `after_sales_receipt_serialized_units_movement_id_fkey`
    FOREIGN KEY (`inventory_movement_id`) REFERENCES `inventory_movements`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
