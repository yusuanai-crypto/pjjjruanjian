-- Phase 11 inventory foundation (expand only).
-- This migration creates no warehouse/configuration/business rows and performs
-- no historical order, product-mode, batch, stock, or serialized-unit backfill.
--
-- MySQL enum changes acquire metadata locks. Rehearse this migration against an
-- isolated database with production-like table sizes and schedule a maintenance
-- window before production deployment.

ALTER TABLE `products`
  MODIFY COLUMN `inventory_tracking_mode`
    ENUM('none', 'serialized', 'quantity')
    NOT NULL DEFAULT 'none';

ALTER TABLE `serialized_inventory_units`
  MODIFY COLUMN `status`
    ENUM(
      'pending_cost',
      'available',
      'allocated',
      'void',
      'reserved',
      'outbound',
      'unavailable'
    )
    NOT NULL DEFAULT 'pending_cost',
  ADD COLUMN `warehouse_id` CHAR(36) NULL AFTER `product_id`,
  ADD COLUMN `inventory_batch_id` CHAR(36) NULL AFTER `warehouse_id`,
  ADD COLUMN `version` INTEGER NOT NULL DEFAULT 0 AFTER `status`;

ALTER TABLE `sales_orders`
  ADD COLUMN `fulfillment_warehouse_id` CHAR(36) NULL
    AFTER `personal_rates_updated_at`,
  ADD COLUMN `inventory_applied_at` DATETIME(0) NULL
    AFTER `fulfillment_warehouse_id`,
  ADD COLUMN `inventory_policy_version` INTEGER NULL
    AFTER `inventory_applied_at`,
  ADD COLUMN `inventory_version` INTEGER NOT NULL DEFAULT 0
    AFTER `inventory_policy_version`;

ALTER TABLE `sales_order_items`
  ADD COLUMN `inventory_line_key` VARCHAR(191) NULL
    AFTER `sales_order_id`;

CREATE TABLE `warehouses` (
  `id` CHAR(36) NOT NULL,
  `code` VARCHAR(80) NOT NULL,
  `normalized_code` VARCHAR(80) NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `normalized_name` VARCHAR(160) NOT NULL,
  `address` VARCHAR(255) NULL,
  `manager_user_id` CHAR(36) NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `is_default` BOOLEAN NOT NULL DEFAULT false,
  `active_default_key` VARCHAR(64) NULL,
  `created_by_id` CHAR(36) NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  CONSTRAINT `warehouses_active_default_key_check`
    CHECK (
      (
        `is_active` = true
        AND `is_default` = true
        AND `active_default_key` = 'ACTIVE_DEFAULT'
      )
      OR
      (
        (`is_active` = false OR `is_default` = false)
        AND `active_default_key` IS NULL
      )
    ),
  CONSTRAINT `warehouses_normalized_code_not_blank_check`
    CHECK (CHAR_LENGTH(TRIM(`normalized_code`)) > 0),
  CONSTRAINT `warehouses_normalized_name_not_blank_check`
    CHECK (CHAR_LENGTH(TRIM(`normalized_name`)) > 0),
  UNIQUE INDEX `warehouses_normalized_code_key` (`normalized_code`),
  UNIQUE INDEX `warehouses_normalized_name_key` (`normalized_name`),
  UNIQUE INDEX `warehouses_active_default_key_key` (`active_default_key`),
  INDEX `warehouses_is_active_idx` (`is_active`),
  INDEX `warehouses_manager_user_id_idx` (`manager_user_id`),
  INDEX `warehouses_created_by_id_idx` (`created_by_id`),
  INDEX `warehouses_updated_by_id_idx` (`updated_by_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `inventory_configurations` (
  `id` CHAR(36) NOT NULL,
  `singleton_key` VARCHAR(32) NOT NULL DEFAULT 'INVENTORY',
  `go_live_at` DATETIME(0) NULL,
  `policy_version` INTEGER NOT NULL DEFAULT 1,
  `maintenance_mode` BOOLEAN NOT NULL DEFAULT false,
  `created_by_id` CHAR(36) NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  CONSTRAINT `inventory_configurations_singleton_value_check`
    CHECK (`singleton_key` = 'INVENTORY'),
  CONSTRAINT `inventory_configurations_policy_version_check`
    CHECK (`policy_version` > 0),
  UNIQUE INDEX `inventory_configurations_singleton_key` (`singleton_key`),
  INDEX `inventory_configurations_go_live_at_idx` (`go_live_at`),
  INDEX `inventory_configurations_created_by_id_idx` (`created_by_id`),
  INDEX `inventory_configurations_updated_by_id_idx` (`updated_by_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `warehouse_product_stocks` (
  `id` CHAR(36) NOT NULL,
  `warehouse_id` CHAR(36) NOT NULL,
  `product_id` CHAR(36) NOT NULL,
  `on_hand_qty` INTEGER NOT NULL DEFAULT 0,
  `reserved_qty` INTEGER NOT NULL DEFAULT 0,
  `unavailable_qty` INTEGER NOT NULL DEFAULT 0,
  `in_transit_qty` INTEGER NOT NULL DEFAULT 0,
  `version` INTEGER NOT NULL DEFAULT 0,
  `last_movement_id` CHAR(36) NULL,
  `rebuilt_at` DATETIME(0) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  CONSTRAINT `warehouse_product_stocks_quantity_check`
    CHECK (
      `reserved_qty` >= 0
      AND `unavailable_qty` >= 0
      AND `in_transit_qty` >= 0
      AND `version` >= 0
    ),
  UNIQUE INDEX `warehouse_product_stocks_last_movement_id_key`
    (`last_movement_id`),
  UNIQUE INDEX `warehouse_product_stocks_warehouse_product_key`
    (`warehouse_id`, `product_id`),
  INDEX `warehouse_product_stocks_product_warehouse_idx`
    (`product_id`, `warehouse_id`),
  INDEX `warehouse_product_stocks_warehouse_updated_idx`
    (`warehouse_id`, `updated_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `inventory_documents` (
  `id` CHAR(36) NOT NULL,
  `document_no` VARCHAR(80) NOT NULL,
  `type` ENUM(
    'opening',
    'purchase_receipt',
    'customer_return',
    'stock_gain',
    'other_in',
    'sales_outbound',
    'stock_loss',
    'other_out',
    'transfer_out',
    'transfer_in',
    'unavailable_adjustment',
    'reversal'
  ) NOT NULL,
  `status` ENUM('draft', 'posted', 'reversed') NOT NULL DEFAULT 'draft',
  `warehouse_id` CHAR(36) NULL,
  `from_warehouse_id` CHAR(36) NULL,
  `to_warehouse_id` CHAR(36) NULL,
  `source_type` VARCHAR(80) NOT NULL,
  `source_id` VARCHAR(100) NULL,
  `source_key` VARCHAR(191) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `business_at` DATETIME(0) NOT NULL,
  `posted_by_id` CHAR(36) NULL,
  `posted_by_name_snapshot` VARCHAR(100) NULL,
  `posted_by_role_snapshot` VARCHAR(32) NULL,
  `posted_at` DATETIME(0) NULL,
  `reversed_by_id` CHAR(36) NULL,
  `reversed_by_name_snapshot` VARCHAR(100) NULL,
  `reversed_by_role_snapshot` VARCHAR(32) NULL,
  `reversed_at` DATETIME(0) NULL,
  `reversal_of_document_id` CHAR(36) NULL,
  `reason` VARCHAR(500) NULL,
  `created_by_id` CHAR(36) NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  CONSTRAINT `inventory_documents_source_key_not_blank_check`
    CHECK (CHAR_LENGTH(TRIM(`source_key`)) > 0),
  CONSTRAINT `inventory_documents_request_hash_check`
    CHECK (`request_hash` REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT `inventory_documents_distinct_warehouses_check`
    CHECK (
      `from_warehouse_id` IS NULL
      OR `to_warehouse_id` IS NULL
      OR `from_warehouse_id` <> `to_warehouse_id`
    ),
  UNIQUE INDEX `inventory_documents_document_no_key` (`document_no`),
  UNIQUE INDEX `inventory_documents_source_key` (`source_key`),
  UNIQUE INDEX `inventory_documents_reversal_of_key`
    (`reversal_of_document_id`),
  INDEX `inventory_documents_warehouse_status_business_idx`
    (`warehouse_id`, `status`, `business_at`),
  INDEX `inventory_documents_from_warehouse_id_idx` (`from_warehouse_id`),
  INDEX `inventory_documents_to_warehouse_id_idx` (`to_warehouse_id`),
  INDEX `inventory_documents_type_status_business_idx`
    (`type`, `status`, `business_at`),
  INDEX `inventory_documents_source_type_source_id_idx`
    (`source_type`, `source_id`),
  INDEX `inventory_documents_posted_by_id_idx` (`posted_by_id`),
  INDEX `inventory_documents_reversed_by_id_idx` (`reversed_by_id`),
  INDEX `inventory_documents_created_by_id_idx` (`created_by_id`),
  INDEX `inventory_documents_updated_by_id_idx` (`updated_by_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `inventory_document_lines` (
  `id` CHAR(36) NOT NULL,
  `document_id` CHAR(36) NOT NULL,
  `line_no` INTEGER NOT NULL,
  `product_id` CHAR(36) NOT NULL,
  `batch_id` CHAR(36) NULL,
  `quantity` INTEGER NOT NULL,
  `condition` ENUM('saleable', 'unavailable') NOT NULL DEFAULT 'saleable',
  `product_name_snapshot` VARCHAR(160) NOT NULL,
  `unit_snapshot` VARCHAR(20) NOT NULL,
  `purchase_unit_cost_cents` INTEGER NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

  CONSTRAINT `inventory_document_lines_quantity_check`
    CHECK (`line_no` > 0 AND `quantity` > 0),
  CONSTRAINT `inventory_document_lines_cost_check`
    CHECK (
      `purchase_unit_cost_cents` IS NULL
      OR `purchase_unit_cost_cents` >= 0
    ),
  UNIQUE INDEX `inventory_document_lines_document_line_key`
    (`document_id`, `line_no`),
  INDEX `inventory_document_lines_product_id_idx` (`product_id`),
  INDEX `inventory_document_lines_batch_id_idx` (`batch_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `inventory_batches` (
  `id` CHAR(36) NOT NULL,
  `warehouse_id` CHAR(36) NOT NULL,
  `product_id` CHAR(36) NOT NULL,
  `source_document_line_id` CHAR(36) NULL,
  `source_line_key` VARCHAR(191) NOT NULL,
  `supplier_name` VARCHAR(160) NULL,
  `purchase_order_no` VARCHAR(80) NULL,
  `production_batch` VARCHAR(80) NULL,
  `production_date` DATE NULL,
  `received_qty` INTEGER NOT NULL DEFAULT 0,
  `remaining_qty` INTEGER NOT NULL DEFAULT 0,
  `unavailable_qty` INTEGER NOT NULL DEFAULT 0,
  `purchase_unit_cost_cents` INTEGER NULL,
  `cost_status` ENUM('pending', 'complete') NOT NULL DEFAULT 'pending',
  `cost_completed_by_id` CHAR(36) NULL,
  `cost_completed_by_name` VARCHAR(100) NULL,
  `cost_completed_by_role` VARCHAR(32) NULL,
  `cost_completed_at` DATETIME(0) NULL,
  `fifo_at` DATETIME(0) NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 0,
  `created_by_id` CHAR(36) NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  CONSTRAINT `inventory_batches_source_line_key_not_blank_check`
    CHECK (CHAR_LENGTH(TRIM(`source_line_key`)) > 0),
  CONSTRAINT `inventory_batches_quantity_check`
    CHECK (
      `received_qty` >= 0
      AND `remaining_qty` >= 0
      AND `unavailable_qty` >= 0
      AND `remaining_qty` <= `received_qty`
      AND `unavailable_qty` <= `remaining_qty`
      AND `version` >= 0
    ),
  CONSTRAINT `inventory_batches_cost_check`
    CHECK (
      `purchase_unit_cost_cents` IS NULL
      OR `purchase_unit_cost_cents` >= 0
    ),
  UNIQUE INDEX `inventory_batches_source_line_key` (`source_line_key`),
  INDEX `inventory_batches_fifo_idx`
    (`warehouse_id`, `product_id`, `cost_status`, `fifo_at`, `id`),
  INDEX `inventory_batches_source_document_line_id_idx`
    (`source_document_line_id`),
  INDEX `inventory_batches_purchase_order_no_idx` (`purchase_order_no`),
  INDEX `inventory_batches_production_batch_idx` (`production_batch`),
  INDEX `inventory_batches_production_date_idx` (`production_date`),
  INDEX `inventory_batches_cost_completed_by_id_idx` (`cost_completed_by_id`),
  INDEX `inventory_batches_created_by_id_idx` (`created_by_id`),
  INDEX `inventory_batches_updated_by_id_idx` (`updated_by_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `inventory_movements` (
  `id` CHAR(36) NOT NULL,
  `source_key` VARCHAR(191) NOT NULL,
  `document_line_id` CHAR(36) NOT NULL,
  `warehouse_id` CHAR(36) NOT NULL,
  `product_id` CHAR(36) NOT NULL,
  `batch_id` CHAR(36) NULL,
  `serialized_unit_id` CHAR(36) NULL,
  `movement_type` ENUM(
    'opening_in',
    'purchase_in',
    'customer_return',
    'reserve',
    'release',
    'sales_out',
    'transfer_out',
    'transfer_in',
    'stock_gain',
    'stock_loss',
    'other_in',
    'other_out',
    'unavailable_in',
    'unavailable_out',
    'reversal'
  ) NOT NULL,
  `on_hand_delta` INTEGER NOT NULL DEFAULT 0,
  `reserved_delta` INTEGER NOT NULL DEFAULT 0,
  `unavailable_delta` INTEGER NOT NULL DEFAULT 0,
  `in_transit_delta` INTEGER NOT NULL DEFAULT 0,
  `business_at` DATETIME(0) NOT NULL,
  `operator_user_id` CHAR(36) NULL,
  `operator_name_snapshot` VARCHAR(100) NULL,
  `operator_role_snapshot` VARCHAR(32) NULL,
  `product_name_snapshot` VARCHAR(160) NOT NULL,
  `unit_snapshot` VARCHAR(20) NOT NULL,
  `purchase_unit_cost_cents` INTEGER NULL,
  `reason` VARCHAR(500) NULL,
  `reversal_of_movement_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

  CONSTRAINT `inventory_movements_source_key_not_blank_check`
    CHECK (CHAR_LENGTH(TRIM(`source_key`)) > 0),
  CONSTRAINT `inventory_movements_nonzero_delta_check`
    CHECK (
      `on_hand_delta` <> 0
      OR `reserved_delta` <> 0
      OR `unavailable_delta` <> 0
      OR `in_transit_delta` <> 0
    ),
  CONSTRAINT `inventory_movements_cost_check`
    CHECK (
      `purchase_unit_cost_cents` IS NULL
      OR `purchase_unit_cost_cents` >= 0
    ),
  UNIQUE INDEX `inventory_movements_source_key` (`source_key`),
  UNIQUE INDEX `inventory_movements_reversal_of_key`
    (`reversal_of_movement_id`),
  INDEX `inventory_movements_warehouse_product_business_idx`
    (`warehouse_id`, `product_id`, `business_at`, `id`),
  INDEX `inventory_movements_product_business_idx`
    (`product_id`, `business_at`),
  INDEX `inventory_movements_document_line_id_idx` (`document_line_id`),
  INDEX `inventory_movements_batch_id_idx` (`batch_id`),
  INDEX `inventory_movements_unit_business_idx`
    (`serialized_unit_id`, `business_at`),
  INDEX `inventory_movements_operator_user_id_idx` (`operator_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `inventory_command_receipts` (
  `id` CHAR(36) NOT NULL,
  `source_key` VARCHAR(191) NOT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `command_type` VARCHAR(80) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `status` ENUM('processing', 'succeeded', 'failed')
    NOT NULL DEFAULT 'processing',
  `result_document_id` CHAR(36) NULL,
  `actor_user_id` CHAR(36) NULL,
  `actor_name_snapshot` VARCHAR(100) NULL,
  `actor_role_snapshot` VARCHAR(32) NULL,
  `request_id` VARCHAR(64) NULL,
  `result_snapshot` JSON NULL,
  `error_code` VARCHAR(100) NULL,
  `completed_at` DATETIME(0) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  CONSTRAINT `inventory_command_receipts_source_key_not_blank_check`
    CHECK (CHAR_LENGTH(TRIM(`source_key`)) > 0),
  CONSTRAINT `inventory_command_receipts_idempotency_key_not_blank_check`
    CHECK (CHAR_LENGTH(TRIM(`idempotency_key`)) > 0),
  CONSTRAINT `inventory_command_receipts_request_hash_check`
    CHECK (`request_hash` REGEXP '^[0-9a-f]{64}$'),
  UNIQUE INDEX `inventory_command_receipts_source_key` (`source_key`),
  UNIQUE INDEX `inventory_command_receipts_idempotency_key`
    (`idempotency_key`),
  INDEX `inventory_command_receipts_command_status_idx`
    (`command_type`, `status`, `created_at`),
  INDEX `inventory_command_receipts_result_document_id_idx`
    (`result_document_id`),
  INDEX `inventory_command_receipts_actor_user_id_idx` (`actor_user_id`),
  INDEX `inventory_command_receipts_request_id_idx` (`request_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `inventory_reservations` (
  `id` CHAR(36) NOT NULL,
  `source_key` VARCHAR(191) NOT NULL,
  `sales_order_id` CHAR(36) NOT NULL,
  `sales_order_item_id` CHAR(36) NULL,
  `inventory_line_key` VARCHAR(191) NOT NULL,
  `warehouse_id` CHAR(36) NOT NULL,
  `product_id` CHAR(36) NOT NULL,
  `requested_qty` INTEGER NOT NULL DEFAULT 0,
  `reserved_qty` INTEGER NOT NULL DEFAULT 0,
  `assigned_qty` INTEGER NOT NULL DEFAULT 0,
  `outbound_qty` INTEGER NOT NULL DEFAULT 0,
  `status` ENUM(
    'open',
    'partial',
    'reserved',
    'consumed',
    'released',
    'cancelled'
  ) NOT NULL DEFAULT 'open',
  `version` INTEGER NOT NULL DEFAULT 0,
  `released_at` DATETIME(0) NULL,
  `consumed_at` DATETIME(0) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  CONSTRAINT `inventory_reservations_source_key_not_blank_check`
    CHECK (CHAR_LENGTH(TRIM(`source_key`)) > 0),
  CONSTRAINT `inventory_reservations_line_key_not_blank_check`
    CHECK (CHAR_LENGTH(TRIM(`inventory_line_key`)) > 0),
  CONSTRAINT `inventory_reservations_quantity_check`
    CHECK (
      `requested_qty` >= 0
      AND `reserved_qty` >= 0
      AND `assigned_qty` >= 0
      AND `outbound_qty` >= 0
      AND `version` >= 0
    ),
  UNIQUE INDEX `inventory_reservations_source_key` (`source_key`),
  UNIQUE INDEX `inventory_reservations_order_line_key`
    (`sales_order_id`, `inventory_line_key`),
  INDEX `inventory_reservations_warehouse_product_status_idx`
    (`warehouse_id`, `product_id`, `status`),
  INDEX `inventory_reservations_order_status_idx`
    (`sales_order_id`, `status`),
  INDEX `inventory_reservations_sales_order_item_id_idx`
    (`sales_order_item_id`),
  INDEX `inventory_reservations_product_id_idx` (`product_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `inventory_transfers` (
  `id` CHAR(36) NOT NULL,
  `transfer_no` VARCHAR(80) NOT NULL,
  `source_key` VARCHAR(191) NOT NULL,
  `from_warehouse_id` CHAR(36) NOT NULL,
  `to_warehouse_id` CHAR(36) NOT NULL,
  `status` ENUM(
    'draft',
    'outbound',
    'partially_received',
    'received',
    'cancelled',
    'reversed'
  ) NOT NULL DEFAULT 'draft',
  `outbound_document_id` CHAR(36) NULL,
  `outbound_by_id` CHAR(36) NULL,
  `outbound_by_name` VARCHAR(100) NULL,
  `outbound_by_role` VARCHAR(32) NULL,
  `outbound_at` DATETIME(0) NULL,
  `notes` TEXT NULL,
  `created_by_id` CHAR(36) NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  CONSTRAINT `inventory_transfers_source_key_not_blank_check`
    CHECK (CHAR_LENGTH(TRIM(`source_key`)) > 0),
  CONSTRAINT `inventory_transfers_distinct_warehouses_check`
    CHECK (`from_warehouse_id` <> `to_warehouse_id`),
  UNIQUE INDEX `inventory_transfers_transfer_no_key` (`transfer_no`),
  UNIQUE INDEX `inventory_transfers_source_key` (`source_key`),
  UNIQUE INDEX `inventory_transfers_outbound_document_key`
    (`outbound_document_id`),
  INDEX `inventory_transfers_from_status_created_idx`
    (`from_warehouse_id`, `status`, `created_at`),
  INDEX `inventory_transfers_to_status_created_idx`
    (`to_warehouse_id`, `status`, `created_at`),
  INDEX `inventory_transfers_outbound_by_id_idx` (`outbound_by_id`),
  INDEX `inventory_transfers_created_by_id_idx` (`created_by_id`),
  INDEX `inventory_transfers_updated_by_id_idx` (`updated_by_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `inventory_transfer_lines` (
  `id` CHAR(36) NOT NULL,
  `transfer_id` CHAR(36) NOT NULL,
  `line_no` INTEGER NOT NULL,
  `product_id` CHAR(36) NOT NULL,
  `planned_qty` INTEGER NOT NULL DEFAULT 0,
  `outbound_qty` INTEGER NOT NULL DEFAULT 0,
  `received_qty` INTEGER NOT NULL DEFAULT 0,
  `difference_qty` INTEGER NOT NULL DEFAULT 0,
  `notes` TEXT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  CONSTRAINT `inventory_transfer_lines_quantity_check`
    CHECK (
      `line_no` > 0
      AND `planned_qty` >= 0
      AND `outbound_qty` >= 0
      AND `received_qty` >= 0
    ),
  UNIQUE INDEX `inventory_transfer_lines_transfer_line_key`
    (`transfer_id`, `line_no`),
  INDEX `inventory_transfer_lines_product_id_idx` (`product_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `inventory_transfer_receipts` (
  `id` CHAR(36) NOT NULL,
  `receipt_no` VARCHAR(80) NOT NULL,
  `transfer_id` CHAR(36) NOT NULL,
  `warehouse_id` CHAR(36) NOT NULL,
  `source_key` VARCHAR(191) NOT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `status` ENUM('draft', 'posted', 'reversed') NOT NULL DEFAULT 'draft',
  `result_document_id` CHAR(36) NULL,
  `confirmed_by_id` CHAR(36) NULL,
  `confirmed_by_name_snapshot` VARCHAR(100) NULL,
  `confirmed_by_role_snapshot` VARCHAR(32) NULL,
  `confirmed_at` DATETIME(0) NULL,
  `reversal_of_receipt_id` CHAR(36) NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  CONSTRAINT `inventory_transfer_receipts_source_key_not_blank_check`
    CHECK (CHAR_LENGTH(TRIM(`source_key`)) > 0),
  CONSTRAINT `inventory_transfer_receipts_idempotency_key_not_blank_check`
    CHECK (CHAR_LENGTH(TRIM(`idempotency_key`)) > 0),
  CONSTRAINT `inventory_transfer_receipts_request_hash_check`
    CHECK (`request_hash` REGEXP '^[0-9a-f]{64}$'),
  UNIQUE INDEX `inventory_transfer_receipts_receipt_no_key` (`receipt_no`),
  UNIQUE INDEX `inventory_transfer_receipts_source_key` (`source_key`),
  UNIQUE INDEX `inventory_transfer_receipts_idempotency_key`
    (`idempotency_key`),
  UNIQUE INDEX `inventory_transfer_receipts_document_key`
    (`result_document_id`),
  UNIQUE INDEX `inventory_transfer_receipts_reversal_of_key`
    (`reversal_of_receipt_id`),
  INDEX `inventory_transfer_receipts_transfer_status_idx`
    (`transfer_id`, `status`, `created_at`),
  INDEX `inventory_transfer_receipts_warehouse_status_idx`
    (`warehouse_id`, `status`, `created_at`),
  INDEX `inventory_transfer_receipts_confirmed_by_id_idx`
    (`confirmed_by_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `inventory_transfer_receipt_lines` (
  `id` CHAR(36) NOT NULL,
  `receipt_id` CHAR(36) NOT NULL,
  `transfer_line_id` CHAR(36) NOT NULL,
  `line_no` INTEGER NOT NULL,
  `received_qty` INTEGER NOT NULL DEFAULT 0,
  `unavailable_qty` INTEGER NOT NULL DEFAULT 0,
  `difference_qty` INTEGER NOT NULL DEFAULT 0,
  `notes` TEXT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

  CONSTRAINT `inventory_transfer_receipt_lines_quantity_check`
    CHECK (
      `line_no` > 0
      AND `received_qty` >= 0
      AND `unavailable_qty` >= 0
      AND `unavailable_qty` <= `received_qty`
    ),
  UNIQUE INDEX `inventory_transfer_receipt_lines_receipt_line_key`
    (`receipt_id`, `line_no`),
  UNIQUE INDEX `inventory_transfer_receipt_lines_receipt_transfer_key`
    (`receipt_id`, `transfer_line_id`),
  INDEX `inventory_transfer_receipt_lines_transfer_line_id_idx`
    (`transfer_line_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `stock_alert_configs` (
  `id` CHAR(36) NOT NULL,
  `warehouse_id` CHAR(36) NOT NULL,
  `product_id` CHAR(36) NOT NULL,
  `minimum_available_qty` INTEGER NOT NULL DEFAULT 0,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `created_by_id` CHAR(36) NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  CONSTRAINT `stock_alert_configs_minimum_qty_check`
    CHECK (`minimum_available_qty` >= 0),
  UNIQUE INDEX `stock_alert_configs_warehouse_product_key`
    (`warehouse_id`, `product_id`),
  INDEX `stock_alert_configs_product_id_idx` (`product_id`),
  INDEX `stock_alert_configs_enabled_idx` (`enabled`),
  INDEX `stock_alert_configs_created_by_id_idx` (`created_by_id`),
  INDEX `stock_alert_configs_updated_by_id_idx` (`updated_by_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `product_inventory_mode_changes` (
  `id` CHAR(36) NOT NULL,
  `product_id` CHAR(36) NOT NULL,
  `expected_current_mode` ENUM('none', 'quantity', 'serialized') NOT NULL,
  `target_mode` ENUM('none', 'quantity', 'serialized') NOT NULL,
  `effective_at` DATETIME(0) NOT NULL,
  `source_key` VARCHAR(191) NOT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `status` ENUM('pending', 'applied', 'rejected', 'cancelled')
    NOT NULL DEFAULT 'pending',
  `requested_by_id` CHAR(36) NULL,
  `requested_by_name_snapshot` VARCHAR(100) NULL,
  `requested_by_role_snapshot` VARCHAR(32) NULL,
  `requested_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `applied_by_id` CHAR(36) NULL,
  `applied_by_name_snapshot` VARCHAR(100) NULL,
  `applied_by_role_snapshot` VARCHAR(32) NULL,
  `applied_at` DATETIME(0) NULL,
  `reason` VARCHAR(500) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  CONSTRAINT `product_inventory_mode_changes_source_key_not_blank_check`
    CHECK (CHAR_LENGTH(TRIM(`source_key`)) > 0),
  CONSTRAINT `product_inventory_mode_changes_idempotency_not_blank_check`
    CHECK (CHAR_LENGTH(TRIM(`idempotency_key`)) > 0),
  CONSTRAINT `product_inventory_mode_changes_request_hash_check`
    CHECK (`request_hash` REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT `product_inventory_mode_changes_distinct_mode_check`
    CHECK (`expected_current_mode` <> `target_mode`),
  UNIQUE INDEX `product_inventory_mode_changes_source_key` (`source_key`),
  UNIQUE INDEX `product_inventory_mode_changes_idempotency_key`
    (`idempotency_key`),
  INDEX `product_inventory_mode_changes_product_status_idx`
    (`product_id`, `status`, `effective_at`),
  INDEX `product_inventory_mode_changes_requested_by_id_idx`
    (`requested_by_id`),
  INDEX `product_inventory_mode_changes_applied_by_id_idx`
    (`applied_by_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE UNIQUE INDEX `sales_order_items_inventory_line_key`
  ON `sales_order_items` (`inventory_line_key`);
CREATE INDEX `sales_order_items_order_inventory_line_idx`
  ON `sales_order_items` (`sales_order_id`, `inventory_line_key`);
CREATE INDEX `sales_orders_fulfillment_warehouse_status_idx`
  ON `sales_orders` (`fulfillment_warehouse_id`, `status`);
CREATE INDEX `sales_orders_inventory_applied_at_idx`
  ON `sales_orders` (`inventory_applied_at`);
CREATE INDEX `serialized_inventory_units_warehouse_product_status_idx`
  ON `serialized_inventory_units` (`warehouse_id`, `product_id`, `status`);
CREATE INDEX `serialized_inventory_units_inventory_batch_id_idx`
  ON `serialized_inventory_units` (`inventory_batch_id`);

ALTER TABLE `sales_orders`
  ADD CONSTRAINT `sales_orders_inventory_version_check`
    CHECK (`inventory_version` >= 0);

ALTER TABLE `serialized_inventory_units`
  ADD CONSTRAINT `serialized_inventory_units_version_check`
    CHECK (`version` >= 0);

ALTER TABLE `warehouses`
  ADD CONSTRAINT `warehouses_manager_user_id_fkey`
    FOREIGN KEY (`manager_user_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `warehouses_created_by_id_fkey`
    FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `warehouses_updated_by_id_fkey`
    FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `inventory_configurations`
  ADD CONSTRAINT `inventory_configurations_created_by_id_fkey`
    FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_configurations_updated_by_id_fkey`
    FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `inventory_documents`
  ADD CONSTRAINT `inventory_documents_warehouse_id_fkey`
    FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_documents_from_warehouse_id_fkey`
    FOREIGN KEY (`from_warehouse_id`) REFERENCES `warehouses`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_documents_to_warehouse_id_fkey`
    FOREIGN KEY (`to_warehouse_id`) REFERENCES `warehouses`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_documents_posted_by_id_fkey`
    FOREIGN KEY (`posted_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_documents_reversed_by_id_fkey`
    FOREIGN KEY (`reversed_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_documents_created_by_id_fkey`
    FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_documents_updated_by_id_fkey`
    FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_documents_reversal_of_document_id_fkey`
    FOREIGN KEY (`reversal_of_document_id`) REFERENCES `inventory_documents`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `inventory_document_lines`
  ADD CONSTRAINT `inventory_document_lines_document_id_fkey`
    FOREIGN KEY (`document_id`) REFERENCES `inventory_documents`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_document_lines_product_id_fkey`
    FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `inventory_batches`
  ADD CONSTRAINT `inventory_batches_warehouse_id_fkey`
    FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_batches_product_id_fkey`
    FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_batches_source_document_line_id_fkey`
    FOREIGN KEY (`source_document_line_id`) REFERENCES `inventory_document_lines`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_batches_cost_completed_by_id_fkey`
    FOREIGN KEY (`cost_completed_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_batches_created_by_id_fkey`
    FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_batches_updated_by_id_fkey`
    FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `inventory_document_lines`
  ADD CONSTRAINT `inventory_document_lines_batch_id_fkey`
    FOREIGN KEY (`batch_id`) REFERENCES `inventory_batches`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `inventory_movements`
  ADD CONSTRAINT `inventory_movements_document_line_id_fkey`
    FOREIGN KEY (`document_line_id`) REFERENCES `inventory_document_lines`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_movements_warehouse_id_fkey`
    FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_movements_product_id_fkey`
    FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_movements_batch_id_fkey`
    FOREIGN KEY (`batch_id`) REFERENCES `inventory_batches`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_movements_serialized_unit_id_fkey`
    FOREIGN KEY (`serialized_unit_id`) REFERENCES `serialized_inventory_units`(`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `inventory_movements_operator_user_id_fkey`
    FOREIGN KEY (`operator_user_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE RESTRICT,
  ADD CONSTRAINT `inventory_movements_reversal_of_movement_id_fkey`
    FOREIGN KEY (`reversal_of_movement_id`) REFERENCES `inventory_movements`(`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `warehouse_product_stocks`
  ADD CONSTRAINT `warehouse_product_stocks_warehouse_id_fkey`
    FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `warehouse_product_stocks_product_id_fkey`
    FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `warehouse_product_stocks_last_movement_id_fkey`
    FOREIGN KEY (`last_movement_id`) REFERENCES `inventory_movements`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `inventory_command_receipts`
  ADD CONSTRAINT `inventory_command_receipts_result_document_id_fkey`
    FOREIGN KEY (`result_document_id`) REFERENCES `inventory_documents`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_command_receipts_actor_user_id_fkey`
    FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `inventory_reservations`
  ADD CONSTRAINT `inventory_reservations_sales_order_id_fkey`
    FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_reservations_sales_order_item_id_fkey`
    FOREIGN KEY (`sales_order_item_id`) REFERENCES `sales_order_items`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_reservations_warehouse_id_fkey`
    FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_reservations_product_id_fkey`
    FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `inventory_transfers`
  ADD CONSTRAINT `inventory_transfers_from_warehouse_id_fkey`
    FOREIGN KEY (`from_warehouse_id`) REFERENCES `warehouses`(`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `inventory_transfers_to_warehouse_id_fkey`
    FOREIGN KEY (`to_warehouse_id`) REFERENCES `warehouses`(`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `inventory_transfers_outbound_document_id_fkey`
    FOREIGN KEY (`outbound_document_id`) REFERENCES `inventory_documents`(`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `inventory_transfers_outbound_by_id_fkey`
    FOREIGN KEY (`outbound_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE RESTRICT,
  ADD CONSTRAINT `inventory_transfers_created_by_id_fkey`
    FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE RESTRICT,
  ADD CONSTRAINT `inventory_transfers_updated_by_id_fkey`
    FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE RESTRICT;

ALTER TABLE `inventory_transfer_lines`
  ADD CONSTRAINT `inventory_transfer_lines_transfer_id_fkey`
    FOREIGN KEY (`transfer_id`) REFERENCES `inventory_transfers`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_transfer_lines_product_id_fkey`
    FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `inventory_transfer_receipts`
  ADD CONSTRAINT `inventory_transfer_receipts_transfer_id_fkey`
    FOREIGN KEY (`transfer_id`) REFERENCES `inventory_transfers`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_transfer_receipts_warehouse_id_fkey`
    FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_transfer_receipts_result_document_id_fkey`
    FOREIGN KEY (`result_document_id`) REFERENCES `inventory_documents`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_transfer_receipts_confirmed_by_id_fkey`
    FOREIGN KEY (`confirmed_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_transfer_receipts_reversal_of_receipt_id_fkey`
    FOREIGN KEY (`reversal_of_receipt_id`) REFERENCES `inventory_transfer_receipts`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `inventory_transfer_receipt_lines`
  ADD CONSTRAINT `inventory_transfer_receipt_lines_receipt_id_fkey`
    FOREIGN KEY (`receipt_id`) REFERENCES `inventory_transfer_receipts`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_transfer_receipt_lines_transfer_line_id_fkey`
    FOREIGN KEY (`transfer_line_id`) REFERENCES `inventory_transfer_lines`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `stock_alert_configs`
  ADD CONSTRAINT `stock_alert_configs_warehouse_id_fkey`
    FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `stock_alert_configs_product_id_fkey`
    FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `stock_alert_configs_created_by_id_fkey`
    FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `stock_alert_configs_updated_by_id_fkey`
    FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `product_inventory_mode_changes`
  ADD CONSTRAINT `product_inventory_mode_changes_product_id_fkey`
    FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `product_inventory_mode_changes_requested_by_id_fkey`
    FOREIGN KEY (`requested_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `product_inventory_mode_changes_applied_by_id_fkey`
    FOREIGN KEY (`applied_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `sales_orders`
  ADD CONSTRAINT `sales_orders_fulfillment_warehouse_id_fkey`
    FOREIGN KEY (`fulfillment_warehouse_id`) REFERENCES `warehouses`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `serialized_inventory_units`
  ADD CONSTRAINT `serialized_inventory_units_warehouse_id_fkey`
    FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `serialized_inventory_units_inventory_batch_id_fkey`
    FOREIGN KEY (`inventory_batch_id`) REFERENCES `inventory_batches`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER `inventory_movements_no_update`
  BEFORE UPDATE ON `inventory_movements`
  FOR EACH ROW
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'INVENTORY_MOVEMENT_IMMUTABLE';

CREATE TRIGGER `inventory_movements_no_delete`
  BEFORE DELETE ON `inventory_movements`
  FOR EACH ROW
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'INVENTORY_MOVEMENT_IMMUTABLE';
