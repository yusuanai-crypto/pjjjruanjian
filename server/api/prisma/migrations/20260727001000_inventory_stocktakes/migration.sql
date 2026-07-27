-- Phase 11 step 10 expand migration: one warehouse + one product stocktakes.
-- This migration creates no stocktake facts and changes no inventory balance.
-- Rehearse DDL locks, CHECK enforcement, index build time, and rollback on an
-- isolated MySQL copy before production deployment.

CREATE TABLE `stocktakes` (
  `id` CHAR(36) NOT NULL,
  `stocktake_no` VARCHAR(80) NOT NULL,
  `warehouse_id` CHAR(36) NOT NULL,
  `product_id` CHAR(36) NOT NULL,
  `tracking_mode_snapshot`
    ENUM('none', 'quantity', 'serialized') NOT NULL,
  `status`
    ENUM('draft', 'submitted', 'approved', 'rejected', 'posted', 'reversed')
    NOT NULL DEFAULT 'draft',
  `active_key` VARCHAR(80) NULL,
  `source_key` VARCHAR(191) NOT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `submit_source_key` VARCHAR(191) NULL,
  `submit_idempotency_key` VARCHAR(191) NULL,
  `submit_request_hash` CHAR(64) NULL,
  `approve_source_key` VARCHAR(191) NULL,
  `approve_idempotency_key` VARCHAR(191) NULL,
  `approve_request_hash` CHAR(64) NULL,
  `reject_source_key` VARCHAR(191) NULL,
  `reject_idempotency_key` VARCHAR(191) NULL,
  `reject_request_hash` CHAR(64) NULL,
  `reverse_source_key` VARCHAR(191) NULL,
  `reverse_idempotency_key` VARCHAR(191) NULL,
  `reverse_request_hash` CHAR(64) NULL,
  `reason` VARCHAR(500) NULL,
  `rejection_reason` VARCHAR(500) NULL,
  `reversal_reason` VARCHAR(500) NULL,
  `quantity_document_id` CHAR(36) NULL,
  `unavailable_document_id` CHAR(36) NULL,
  `submitted_by_id` CHAR(36) NULL,
  `submitted_by_name_snapshot` VARCHAR(100) NULL,
  `submitted_by_role_snapshot` VARCHAR(32) NULL,
  `submitted_at` DATETIME(0) NULL,
  `approved_by_id` CHAR(36) NULL,
  `approved_by_name_snapshot` VARCHAR(100) NULL,
  `approved_by_role_snapshot` VARCHAR(32) NULL,
  `approved_at` DATETIME(0) NULL,
  `rejected_by_id` CHAR(36) NULL,
  `rejected_by_name_snapshot` VARCHAR(100) NULL,
  `rejected_by_role_snapshot` VARCHAR(32) NULL,
  `rejected_at` DATETIME(0) NULL,
  `posted_by_id` CHAR(36) NULL,
  `posted_by_name_snapshot` VARCHAR(100) NULL,
  `posted_by_role_snapshot` VARCHAR(32) NULL,
  `posted_at` DATETIME(0) NULL,
  `reversed_by_id` CHAR(36) NULL,
  `reversed_by_name_snapshot` VARCHAR(100) NULL,
  `reversed_by_role_snapshot` VARCHAR(32) NULL,
  `reversed_at` DATETIME(0) NULL,
  `created_by_id` CHAR(36) NULL,
  `updated_by_id` CHAR(36) NULL,
  `version` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0)
    ON UPDATE CURRENT_TIMESTAMP(0),

  CONSTRAINT `stocktakes_pkey` PRIMARY KEY (`id`),
  CONSTRAINT `stocktakes_stocktake_no_key` UNIQUE (`stocktake_no`),
  CONSTRAINT `stocktakes_active_key_key` UNIQUE (`active_key`),
  CONSTRAINT `stocktakes_source_key_key` UNIQUE (`source_key`),
  CONSTRAINT `stocktakes_idempotency_key_key` UNIQUE (`idempotency_key`),
  CONSTRAINT `stocktakes_submit_source_key_key` UNIQUE (`submit_source_key`),
  CONSTRAINT `stocktakes_submit_idempotency_key_key`
    UNIQUE (`submit_idempotency_key`),
  CONSTRAINT `stocktakes_approve_source_key_key` UNIQUE (`approve_source_key`),
  CONSTRAINT `stocktakes_approve_idempotency_key_key`
    UNIQUE (`approve_idempotency_key`),
  CONSTRAINT `stocktakes_reject_source_key_key` UNIQUE (`reject_source_key`),
  CONSTRAINT `stocktakes_reject_idempotency_key_key`
    UNIQUE (`reject_idempotency_key`),
  CONSTRAINT `stocktakes_reverse_source_key_key` UNIQUE (`reverse_source_key`),
  CONSTRAINT `stocktakes_reverse_idempotency_key_key`
    UNIQUE (`reverse_idempotency_key`),
  CONSTRAINT `stocktakes_quantity_document_key`
    UNIQUE (`quantity_document_id`),
  CONSTRAINT `stocktakes_unavailable_document_key`
    UNIQUE (`unavailable_document_id`),
  CONSTRAINT `stocktakes_create_envelope_check`
    CHECK (
      CHAR_LENGTH(TRIM(`source_key`)) > 0
      AND CHAR_LENGTH(TRIM(`idempotency_key`)) > 0
      AND `request_hash` REGEXP '^[0-9a-f]{64}$'
    ),
  CONSTRAINT `stocktakes_submit_envelope_check`
    CHECK (
      (
        `submit_source_key` IS NULL
        AND `submit_idempotency_key` IS NULL
        AND `submit_request_hash` IS NULL
        AND `submitted_at` IS NULL
      )
      OR
      (
        `submit_source_key` IS NOT NULL
        AND `submit_idempotency_key` IS NOT NULL
        AND `submit_request_hash` IS NOT NULL
        AND `reason` IS NOT NULL
        AND CHAR_LENGTH(TRIM(`submit_source_key`)) > 0
        AND CHAR_LENGTH(TRIM(`submit_idempotency_key`)) > 0
        AND `submit_request_hash` REGEXP '^[0-9a-f]{64}$'
        AND `submitted_at` IS NOT NULL
        AND CHAR_LENGTH(TRIM(`reason`)) > 0
      )
    ),
  CONSTRAINT `stocktakes_approve_envelope_check`
    CHECK (
      (
        `approve_source_key` IS NULL
        AND `approve_idempotency_key` IS NULL
        AND `approve_request_hash` IS NULL
        AND `approved_at` IS NULL
      )
      OR
      (
        `approve_source_key` IS NOT NULL
        AND `approve_idempotency_key` IS NOT NULL
        AND `approve_request_hash` IS NOT NULL
        AND CHAR_LENGTH(TRIM(`approve_source_key`)) > 0
        AND CHAR_LENGTH(TRIM(`approve_idempotency_key`)) > 0
        AND `approve_request_hash` REGEXP '^[0-9a-f]{64}$'
        AND `approved_at` IS NOT NULL
      )
    ),
  CONSTRAINT `stocktakes_reject_envelope_check`
    CHECK (
      (
        `reject_source_key` IS NULL
        AND `reject_idempotency_key` IS NULL
        AND `reject_request_hash` IS NULL
        AND `rejected_at` IS NULL
        AND `rejection_reason` IS NULL
      )
      OR
      (
        `reject_source_key` IS NOT NULL
        AND `reject_idempotency_key` IS NOT NULL
        AND `reject_request_hash` IS NOT NULL
        AND `rejection_reason` IS NOT NULL
        AND CHAR_LENGTH(TRIM(`reject_source_key`)) > 0
        AND CHAR_LENGTH(TRIM(`reject_idempotency_key`)) > 0
        AND `reject_request_hash` REGEXP '^[0-9a-f]{64}$'
        AND `rejected_at` IS NOT NULL
        AND CHAR_LENGTH(TRIM(`rejection_reason`)) > 0
      )
    ),
  CONSTRAINT `stocktakes_reverse_envelope_check`
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
        `reverse_source_key` IS NOT NULL
        AND `reverse_idempotency_key` IS NOT NULL
        AND `reverse_request_hash` IS NOT NULL
        AND `reversal_reason` IS NOT NULL
        AND CHAR_LENGTH(TRIM(`reverse_source_key`)) > 0
        AND CHAR_LENGTH(TRIM(`reverse_idempotency_key`)) > 0
        AND `reverse_request_hash` REGEXP '^[0-9a-f]{64}$'
        AND `reversed_at` IS NOT NULL
        AND CHAR_LENGTH(TRIM(`reversal_reason`)) > 0
      )
    ),
  CONSTRAINT `stocktakes_active_key_check`
    CHECK (
      (
        `status` IN ('draft', 'submitted', 'approved')
        AND `active_key` IS NOT NULL
        AND `active_key` =
          CONCAT(`warehouse_id`, ':', `product_id`)
      )
      OR
      (
        `status` IN ('rejected', 'posted', 'reversed')
        AND `active_key` IS NULL
      )
    ),
  CONSTRAINT `stocktakes_status_audit_check`
    CHECK (
      (
        `status` = 'draft'
        AND `submitted_at` IS NULL
        AND `approved_at` IS NULL
        AND `rejected_at` IS NULL
        AND `posted_at` IS NULL
        AND `reversed_at` IS NULL
      )
      OR
      (
        `status` = 'submitted'
        AND `submitted_at` IS NOT NULL
        AND `approved_at` IS NULL
        AND `rejected_at` IS NULL
        AND `posted_at` IS NULL
        AND `reversed_at` IS NULL
      )
      OR
      (
        `status` = 'approved'
        AND `submitted_at` IS NOT NULL
        AND `approved_at` IS NOT NULL
        AND `rejected_at` IS NULL
        AND `posted_at` IS NULL
        AND `reversed_at` IS NULL
      )
      OR
      (
        `status` = 'rejected'
        AND `submitted_at` IS NOT NULL
        AND `approved_at` IS NULL
        AND `rejected_at` IS NOT NULL
        AND `posted_at` IS NULL
        AND `reversed_at` IS NULL
      )
      OR
      (
        `status` = 'posted'
        AND `submitted_at` IS NOT NULL
        AND `approved_at` IS NOT NULL
        AND `rejected_at` IS NULL
        AND `posted_at` IS NOT NULL
        AND `reversed_at` IS NULL
      )
      OR
      (
        `status` = 'reversed'
        AND `submitted_at` IS NOT NULL
        AND `approved_at` IS NOT NULL
        AND `rejected_at` IS NULL
        AND `posted_at` IS NOT NULL
        AND `reversed_at` IS NOT NULL
      )
    ),
  CONSTRAINT `stocktakes_version_check` CHECK (`version` >= 0),
  INDEX `stocktakes_warehouse_status_created_idx`
    (`warehouse_id`, `status`, `created_at`),
  INDEX `stocktakes_product_status_created_idx`
    (`product_id`, `status`, `created_at`),
  INDEX `stocktakes_status_submitted_idx` (`status`, `submitted_at`),
  INDEX `stocktakes_submitted_by_id_idx` (`submitted_by_id`),
  INDEX `stocktakes_approved_by_id_idx` (`approved_by_id`),
  INDEX `stocktakes_rejected_by_id_idx` (`rejected_by_id`),
  INDEX `stocktakes_posted_by_id_idx` (`posted_by_id`),
  INDEX `stocktakes_reversed_by_id_idx` (`reversed_by_id`),
  INDEX `stocktakes_created_by_id_idx` (`created_by_id`),
  INDEX `stocktakes_updated_by_id_idx` (`updated_by_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `stocktake_lines` (
  `id` CHAR(36) NOT NULL,
  `stocktake_id` CHAR(36) NOT NULL,
  `line_no` INTEGER NOT NULL DEFAULT 1,
  `snapshot_stock_version` INTEGER NULL,
  `snapshot_last_movement_id` CHAR(36) NULL,
  `snapshot_on_hand_qty` INTEGER NULL,
  `snapshot_unavailable_qty` INTEGER NULL,
  `snapshot_serialized_fingerprint` CHAR(64) NULL,
  `counted_on_hand_qty` INTEGER NULL,
  `counted_unavailable_qty` INTEGER NULL,
  `on_hand_difference_qty` INTEGER NULL,
  `unavailable_difference_qty` INTEGER NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0)
    ON UPDATE CURRENT_TIMESTAMP(0),

  CONSTRAINT `stocktake_lines_pkey` PRIMARY KEY (`id`),
  CONSTRAINT `stocktake_lines_stocktake_key` UNIQUE (`stocktake_id`),
  CONSTRAINT `stocktake_lines_stocktake_line_key`
    UNIQUE (`stocktake_id`, `line_no`),
  CONSTRAINT `stocktake_lines_values_check`
    CHECK (
      `line_no` = 1
      AND (`snapshot_stock_version` IS NULL OR `snapshot_stock_version` >= 0)
      AND (
        `snapshot_unavailable_qty` IS NULL
        OR `snapshot_unavailable_qty` >= 0
      )
      AND (`counted_on_hand_qty` IS NULL OR `counted_on_hand_qty` >= 0)
      AND (
        `counted_unavailable_qty` IS NULL
        OR `counted_unavailable_qty` >= 0
      )
      AND (
        `counted_on_hand_qty` IS NULL
        OR `counted_unavailable_qty` IS NULL
        OR `counted_unavailable_qty` <= `counted_on_hand_qty`
      )
    ),
  INDEX `stocktake_lines_snapshot_last_movement_id_idx`
    (`snapshot_last_movement_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `stocktake_serialized_scans` (
  `id` CHAR(36) NOT NULL,
  `stocktake_id` CHAR(36) NOT NULL,
  `line_no` INTEGER NOT NULL,
  `source_key` VARCHAR(191) NOT NULL,
  `serialized_unit_id` CHAR(36) NULL,
  `scanned_logistics_code_snapshot` VARCHAR(160) NOT NULL,
  `normalized_logistics_code_snapshot` VARCHAR(160) NOT NULL,
  `match_status` ENUM('matched', 'missing', 'unknown', 'conflict') NOT NULL,
  `expected_warehouse_id` CHAR(36) NULL,
  `expected_unit_status`
    ENUM(
      'pending_cost',
      'available',
      'allocated',
      'reserved',
      'outbound',
      'unavailable',
      'void'
    ) NULL,
  `expected_unit_version` INTEGER NULL,
  `counted_condition` ENUM('saleable', 'unavailable') NULL,
  `action_movement_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

  CONSTRAINT `stocktake_serialized_scans_pkey` PRIMARY KEY (`id`),
  CONSTRAINT `stocktake_serialized_scans_source_key` UNIQUE (`source_key`),
  CONSTRAINT `stocktake_serialized_scans_action_movement_key`
    UNIQUE (`action_movement_id`),
  CONSTRAINT `stocktake_serialized_scans_stocktake_line_key`
    UNIQUE (`stocktake_id`, `line_no`),
  CONSTRAINT `stocktake_serialized_scans_stocktake_code_key`
    UNIQUE (`stocktake_id`, `normalized_logistics_code_snapshot`),
  CONSTRAINT `stocktake_serialized_scans_values_check`
    CHECK (
      `line_no` > 0
      AND CHAR_LENGTH(TRIM(`source_key`)) > 0
      AND CHAR_LENGTH(TRIM(`scanned_logistics_code_snapshot`)) > 0
      AND CHAR_LENGTH(TRIM(`normalized_logistics_code_snapshot`)) > 0
      AND (`expected_unit_version` IS NULL OR `expected_unit_version` >= 0)
      AND (
        (`match_status` = 'unknown' AND `serialized_unit_id` IS NULL)
        OR
        (
          `match_status` IN ('matched', 'missing', 'conflict')
          AND `serialized_unit_id` IS NOT NULL
          AND `expected_unit_status` IS NOT NULL
          AND `expected_unit_version` IS NOT NULL
        )
      )
      AND (
        (`match_status` = 'matched' AND `counted_condition` IS NOT NULL)
        OR (`match_status` <> 'matched' AND `counted_condition` IS NULL)
      )
    ),
  INDEX `stocktake_serialized_scans_unit_match_idx`
    (`serialized_unit_id`, `match_status`),
  INDEX `stocktake_serialized_scans_match_status_idx` (`match_status`),
  INDEX `stocktake_serialized_scans_expected_warehouse_id_idx`
    (`expected_warehouse_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE `stocktakes`
  ADD CONSTRAINT `stocktakes_warehouse_id_fkey`
    FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `stocktakes_product_id_fkey`
    FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `stocktakes_quantity_document_id_fkey`
    FOREIGN KEY (`quantity_document_id`) REFERENCES `inventory_documents`(`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `stocktakes_unavailable_document_id_fkey`
    FOREIGN KEY (`unavailable_document_id`) REFERENCES `inventory_documents`(`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `stocktakes_submitted_by_id_fkey`
    FOREIGN KEY (`submitted_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE RESTRICT,
  ADD CONSTRAINT `stocktakes_approved_by_id_fkey`
    FOREIGN KEY (`approved_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE RESTRICT,
  ADD CONSTRAINT `stocktakes_rejected_by_id_fkey`
    FOREIGN KEY (`rejected_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE RESTRICT,
  ADD CONSTRAINT `stocktakes_posted_by_id_fkey`
    FOREIGN KEY (`posted_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE RESTRICT,
  ADD CONSTRAINT `stocktakes_reversed_by_id_fkey`
    FOREIGN KEY (`reversed_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE RESTRICT,
  ADD CONSTRAINT `stocktakes_created_by_id_fkey`
    FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE RESTRICT,
  ADD CONSTRAINT `stocktakes_updated_by_id_fkey`
    FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE RESTRICT;

ALTER TABLE `stocktake_lines`
  ADD CONSTRAINT `stocktake_lines_stocktake_id_fkey`
    FOREIGN KEY (`stocktake_id`) REFERENCES `stocktakes`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `stocktake_lines_snapshot_last_movement_id_fkey`
    FOREIGN KEY (`snapshot_last_movement_id`) REFERENCES `inventory_movements`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `stocktake_serialized_scans`
  ADD CONSTRAINT `stocktake_serialized_scans_stocktake_id_fkey`
    FOREIGN KEY (`stocktake_id`) REFERENCES `stocktakes`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `stocktake_serialized_scans_unit_id_fkey`
    FOREIGN KEY (`serialized_unit_id`) REFERENCES `serialized_inventory_units`(`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `stocktake_serialized_scans_expected_warehouse_id_fkey`
    FOREIGN KEY (`expected_warehouse_id`) REFERENCES `warehouses`(`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `stocktake_serialized_scans_action_movement_id_fkey`
    FOREIGN KEY (`action_movement_id`) REFERENCES `inventory_movements`(`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT;
