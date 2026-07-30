-- Expand-only migration for workflow-backed internal, external and buyback orders.
-- Historical INTERNAL / EXTERNAL / BUYBACK rows deliberately remain NULL in
-- workflow_status. Run the read-only preflight before a separately reviewed
-- backfill; this migration never guesses a historical workflow state.

ALTER TABLE `sales_orders`
  ADD COLUMN `workflow_status` ENUM('draft', 'pending', 'approved', 'completed', 'rejected', 'cancelled') NULL,
  ADD COLUMN `workflow_version` INTEGER NULL,
  ADD COLUMN `special_order_create_key` VARCHAR(191) NULL,
  ADD COLUMN `special_order_create_hash` CHAR(64) NULL,
  ADD COLUMN `has_original_purchase` BOOLEAN NULL,
  ADD COLUMN `source_remark` TEXT NULL,
  ADD COLUMN `internal_employee_id` CHAR(36) NULL,
  ADD COLUMN `external_party_type` ENUM('guide', 'travel_agency', 'other') NULL,
  ADD COLUMN `external_party_id` CHAR(36) NULL,
  ADD COLUMN `external_party_name_snapshot` VARCHAR(160) NULL,
  ADD COLUMN `approved_by_id` CHAR(36) NULL,
  ADD COLUMN `approved_at` DATETIME(0) NULL,
  ADD COLUMN `last_submitted_at` DATETIME(0) NULL,
  ADD COLUMN `rejection_reason` VARCHAR(500) NULL,
  ADD COLUMN `unapproval_reason` VARCHAR(500) NULL;

ALTER TABLE `sales_order_items`
  ADD COLUMN `warehouse_id` CHAR(36) NULL,
  ADD COLUMN `list_unit_price_cents` INTEGER NULL,
  ADD COLUMN `discount_amount_cents` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `is_gift` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `price_override_reason` VARCHAR(500) NULL,
  ADD COLUMN `adjustment_reason` VARCHAR(500) NULL,
  ADD COLUMN `inventory_condition` ENUM('saleable', 'unavailable') NOT NULL DEFAULT 'saleable';

CREATE TABLE `special_order_item_serialized_units` (
  `id` CHAR(36) NOT NULL,
  `sales_order_item_id` CHAR(36) NOT NULL,
  `logistics_code_snapshot` VARCHAR(160) NOT NULL,
  `normalized_logistics_code` VARCHAR(160) NOT NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

  CONSTRAINT `special_order_item_serials_code_not_blank`
    CHECK (
      CHAR_LENGTH(TRIM(`logistics_code_snapshot`)) > 0
      AND CHAR_LENGTH(TRIM(`normalized_logistics_code`)) > 0
    ),
  CONSTRAINT `special_order_item_serials_item_code_key`
    UNIQUE (`sales_order_item_id`, `normalized_logistics_code`),
  INDEX `special_order_item_serials_code_idx` (`normalized_logistics_code`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `special_order_workflow_events` (
  `id` CHAR(36) NOT NULL,
  `sales_order_id` CHAR(36) NOT NULL,
  `event_type` ENUM('created', 'updated', 'submitted', 'withdrawn', 'approved', 'auto_approve', 'rejected', 'resubmitted', 'unapproved', 'completed', 'cancelled', 'payment_recorded') NOT NULL,
  `from_status` ENUM('draft', 'pending', 'approved', 'completed', 'rejected', 'cancelled') NULL,
  `to_status` ENUM('draft', 'pending', 'approved', 'completed', 'rejected', 'cancelled') NOT NULL,
  `workflow_version` INTEGER NOT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `reason` VARCHAR(500) NULL,
  `payload_snapshot` JSON NULL,
  `actor_user_id` CHAR(36) NULL,
  `actor_name_snapshot` VARCHAR(100) NULL,
  `actor_role_snapshot` VARCHAR(32) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

  CONSTRAINT `special_order_events_version_check`
    CHECK (`workflow_version` >= 0),
  CONSTRAINT `special_order_events_idempotency_not_blank`
    CHECK (CHAR_LENGTH(TRIM(`idempotency_key`)) > 0),
  CONSTRAINT `special_order_events_request_hash_check`
    CHECK (`request_hash` REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT `special_order_events_idempotency_key`
    UNIQUE (`idempotency_key`),
  CONSTRAINT `special_order_events_order_version_key`
    UNIQUE (`sales_order_id`, `workflow_version`),
  INDEX `special_order_events_order_created_idx` (`sales_order_id`, `created_at`),
  INDEX `special_order_events_type_created_idx` (`event_type`, `created_at`),
  INDEX `special_order_workflow_events_actor_user_id_idx` (`actor_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `special_order_attachments` (
  `id` CHAR(36) NOT NULL,
  `sales_order_id` CHAR(36) NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `storage_key` VARCHAR(191) NOT NULL,
  `content_type` VARCHAR(120) NULL,
  `size_bytes` INTEGER NOT NULL DEFAULT 0,
  `checksum_sha256` CHAR(64) NULL,
  `uploaded_by_id` CHAR(36) NULL,
  `uploaded_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

  CONSTRAINT `special_order_attachments_values_check`
    CHECK (
      CHAR_LENGTH(TRIM(`original_name`)) > 0
      AND CHAR_LENGTH(TRIM(`storage_key`)) > 0
      AND `size_bytes` >= 0
      AND (`checksum_sha256` IS NULL OR `checksum_sha256` REGEXP '^[0-9a-f]{64}$')
    ),
  CONSTRAINT `special_order_attachments_order_storage_key`
    UNIQUE (`sales_order_id`, `storage_key`),
  INDEX `special_order_attachments_order_uploaded_idx` (`sales_order_id`, `uploaded_at`),
  INDEX `special_order_attachments_uploaded_by_id_idx` (`uploaded_by_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `special_order_settlements` (
  `id` CHAR(36) NOT NULL,
  `sales_order_id` CHAR(36) NOT NULL,
  `active_order_key` CHAR(36) NULL,
  `direction` ENUM('receivable', 'payable') NOT NULL,
  `total_amount_cents` INTEGER NOT NULL,
  `settled_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `payment_status` ENUM('unpaid', 'partial', 'paid') NOT NULL DEFAULT 'unpaid',
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `reversed_at` DATETIME(0) NULL,
  `reversed_by_id` CHAR(36) NULL,
  `reversal_reason` VARCHAR(500) NULL,
  `version` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  CONSTRAINT `special_order_settlements_amount_check`
    CHECK (
      `total_amount_cents` >= 0
      AND `settled_amount_cents` >= 0
      AND `settled_amount_cents` <= `total_amount_cents`
      AND `version` >= 0
      AND (
        (`is_active` = true AND `active_order_key` = `sales_order_id` AND `reversed_at` IS NULL AND `reversed_by_id` IS NULL)
        OR (`is_active` = false AND `active_order_key` IS NULL AND `reversed_at` IS NOT NULL)
      )
    ),
  CONSTRAINT `special_order_settlements_status_check`
    CHECK (
      (`payment_status` = 'unpaid' AND `settled_amount_cents` = 0)
      OR (`payment_status` = 'partial' AND `settled_amount_cents` > 0 AND `settled_amount_cents` < `total_amount_cents`)
      OR (`payment_status` = 'paid' AND `settled_amount_cents` = `total_amount_cents`)
    ),
  CONSTRAINT `special_order_settlements_active_order_key`
    UNIQUE (`active_order_key`),
  INDEX `special_order_settlements_order_created_idx` (`sales_order_id`, `created_at`),
  INDEX `special_order_settlements_direction_status_idx` (`direction`, `payment_status`),
  INDEX `special_order_settlements_reversed_by_id_idx` (`reversed_by_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `special_order_payments` (
  `id` CHAR(36) NOT NULL,
  `sales_order_id` CHAR(36) NOT NULL,
  `settlement_id` CHAR(36) NOT NULL,
  `direction` ENUM('receivable', 'payable') NOT NULL,
  `amount_cents` INTEGER NOT NULL,
  `payment_method_id` CHAR(36) NULL,
  `payment_method_name_snapshot` VARCHAR(80) NOT NULL,
  `paid_at` DATETIME(0) NOT NULL,
  `reference_no` VARCHAR(120) NULL,
  `remark` VARCHAR(500) NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `recorded_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

  CONSTRAINT `special_order_payments_values_check`
    CHECK (
      `amount_cents` > 0
      AND CHAR_LENGTH(TRIM(`payment_method_name_snapshot`)) > 0
      AND CHAR_LENGTH(TRIM(`idempotency_key`)) > 0
      AND `request_hash` REGEXP '^[0-9a-f]{64}$'
    ),
  CONSTRAINT `special_order_payments_idempotency_key`
    UNIQUE (`idempotency_key`),
  INDEX `special_order_payments_order_paid_idx` (`sales_order_id`, `paid_at`),
  INDEX `special_order_payments_settlement_paid_idx` (`settlement_id`, `paid_at`),
  INDEX `special_order_payments_payment_method_id_idx` (`payment_method_id`),
  INDEX `special_order_payments_recorded_by_id_idx` (`recorded_by_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `sales_orders_special_create_key`
  ON `sales_orders`(`special_order_create_key`);
CREATE INDEX `sales_orders_special_creator_type_status_idx`
  ON `sales_orders`(`created_by_id`, `order_type`, `workflow_status`, `created_at`);
CREATE INDEX `sales_orders_special_type_status_date_idx`
  ON `sales_orders`(`order_type`, `workflow_status`, `order_date`);
CREATE INDEX `sales_orders_special_pending_idx`
  ON `sales_orders`(`workflow_status`, `last_submitted_at`);
CREATE INDEX `sales_orders_internal_employee_id_idx`
  ON `sales_orders`(`internal_employee_id`);
CREATE INDEX `sales_orders_special_external_party_idx`
  ON `sales_orders`(`external_party_type`, `external_party_id`);
CREATE INDEX `sales_orders_approved_by_id_idx`
  ON `sales_orders`(`approved_by_id`);
CREATE INDEX `sales_order_items_warehouse_product_idx`
  ON `sales_order_items`(`warehouse_id`, `product_id`);

ALTER TABLE `sales_orders`
  ADD CONSTRAINT `sales_orders_special_workflow_identity_check`
    CHECK (
      (`workflow_status` IS NULL AND `workflow_version` IS NULL)
      OR (
        `workflow_status` IS NOT NULL
        AND `workflow_version` IS NOT NULL
        AND `workflow_version` >= 0
        AND `order_type` IN ('buyback', 'external', 'internal')
        AND `total_amount_cents` >= 0
      )
    ),
  ADD CONSTRAINT `sales_orders_special_original_purchase_check`
    CHECK (
      `workflow_status` IS NULL
      OR `order_type` <> 'buyback'
      OR (
        `customer_id` IS NOT NULL
        AND (
          (`has_original_purchase` = true AND `source_sales_order_id` IS NOT NULL)
          OR (
            `has_original_purchase` = false
            AND `source_sales_order_id` IS NULL
            AND CHAR_LENGTH(TRIM(COALESCE(`source_remark`, ''))) > 0
          )
        )
      )
    ),
  ADD CONSTRAINT `sales_orders_special_party_check`
    CHECK (
      `workflow_status` IS NULL
      OR (`order_type` = 'internal' AND `internal_employee_id` IS NOT NULL AND `external_party_type` IS NULL)
      OR (`order_type` = 'external' AND `internal_employee_id` IS NULL AND `external_party_type` IS NOT NULL AND CHAR_LENGTH(TRIM(COALESCE(`external_party_name_snapshot`, ''))) > 0)
      OR (`order_type` = 'buyback' AND `internal_employee_id` IS NULL AND `external_party_type` IS NULL)
    ),
  ADD CONSTRAINT `sales_orders_special_create_envelope_check`
    CHECK (
      (`workflow_status` IS NULL AND `special_order_create_key` IS NULL AND `special_order_create_hash` IS NULL)
      OR (
        `workflow_status` IS NOT NULL
        AND CHAR_LENGTH(TRIM(COALESCE(`special_order_create_key`, ''))) > 0
        AND `special_order_create_hash` REGEXP '^[0-9a-f]{64}$'
      )
    );

ALTER TABLE `sales_order_items`
  ADD CONSTRAINT `sales_order_items_special_values_check`
    CHECK (
      `discount_amount_cents` >= 0
      AND (`quantity` >= 0 OR CHAR_LENGTH(TRIM(COALESCE(`adjustment_reason`, ''))) > 0)
      AND (`list_unit_price_cents` IS NULL OR `list_unit_price_cents` >= 0)
    );

ALTER TABLE `sales_orders`
  ADD CONSTRAINT `sales_orders_internal_employee_id_fkey`
    FOREIGN KEY (`internal_employee_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `sales_orders_approved_by_id_fkey`
    FOREIGN KEY (`approved_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `sales_orders_created_by_id_fkey`
    FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `sales_orders_updated_by_id_fkey`
    FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `sales_order_items`
  ADD CONSTRAINT `sales_order_items_warehouse_id_fkey`
    FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `special_order_item_serialized_units`
  ADD CONSTRAINT `special_order_item_serials_item_id_fkey`
    FOREIGN KEY (`sales_order_item_id`) REFERENCES `sales_order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `special_order_workflow_events`
  ADD CONSTRAINT `special_order_events_sales_order_id_fkey`
    FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `special_order_events_actor_user_id_fkey`
    FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `special_order_attachments`
  ADD CONSTRAINT `special_order_attachments_order_id_fkey`
    FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `special_order_attachments_uploaded_by_id_fkey`
    FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `special_order_settlements`
  ADD CONSTRAINT `special_order_settlements_order_id_fkey`
    FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `special_order_settlements_reversed_by_id_fkey`
    FOREIGN KEY (`reversed_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `special_order_payments`
  ADD CONSTRAINT `special_order_payments_order_id_fkey`
    FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `special_order_payments_settlement_id_fkey`
    FOREIGN KEY (`settlement_id`) REFERENCES `special_order_settlements`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `special_order_payments_method_id_fkey`
    FOREIGN KEY (`payment_method_id`) REFERENCES `payment_methods`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `special_order_payments_recorded_by_id_fkey`
    FOREIGN KEY (`recorded_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TRIGGER `special_order_workflow_events_no_update`
BEFORE UPDATE ON `special_order_workflow_events`
FOR EACH ROW
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'SPECIAL_ORDER_WORKFLOW_EVENT_IMMUTABLE';

CREATE TRIGGER `special_order_workflow_events_no_delete`
BEFORE DELETE ON `special_order_workflow_events`
FOR EACH ROW
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'SPECIAL_ORDER_WORKFLOW_EVENT_IMMUTABLE';
