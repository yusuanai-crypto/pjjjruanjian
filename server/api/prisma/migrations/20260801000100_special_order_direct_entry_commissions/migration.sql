-- Direct-entry special orders reuse sales_orders, inventory accounting and the
-- existing commission_records aggregation table.  All additions are nullable
-- or have safe defaults so historical rows remain readable.

ALTER TABLE `special_order_payments`
  ADD COLUMN `reversed_at` DATETIME(0) NULL,
  ADD COLUMN `reversed_by_id` CHAR(36) NULL,
  ADD COLUMN `reversal_reason` VARCHAR(500) NULL,
  ADD INDEX `special_order_payments_order_reversed_idx` (`sales_order_id`, `reversed_at`);

ALTER TABLE `after_sales_orders`
  ADD COLUMN `refund_special_payment_id` CHAR(36) NULL,
  ADD INDEX `after_sales_orders_refund_special_payment_idx` (`refund_special_payment_id`),
  ADD CONSTRAINT `after_sales_orders_refund_special_payment_fkey`
    FOREIGN KEY (`refund_special_payment_id`) REFERENCES `special_order_payments` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `commission_records`
  MODIFY COLUMN `target_type` ENUM(
    'sales_commission',
    'outreach_commission',
    'leader_commission',
    'taster_commission',
    'order_manual_commission',
    'agency_daily_rebate',
    'agency_monthly_rebate'
  ) NOT NULL,
  ADD COLUMN `recipient_type` VARCHAR(20) NULL,
  ADD COLUMN `recipient_name_snapshot` VARCHAR(100) NULL,
  ADD COLUMN `attribution_date` DATE NULL,
  ADD COLUMN `source_type` VARCHAR(40) NULL,
  ADD COLUMN `original_amount_cents` INTEGER NULL,
  ADD COLUMN `adjustment_amount_cents` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN `deactivated_at` DATETIME(0) NULL,
  ADD COLUMN `manual_version` INTEGER NOT NULL DEFAULT 0,
  ADD INDEX `commission_records_source_active_date_idx` (`source_type`, `is_active`, `attribution_date`),
  ADD INDEX `commission_records_recipient_idx` (`recipient_type`, `recipient_name_snapshot`);

CREATE TABLE `commission_adjustments` (
  `id` CHAR(36) NOT NULL,
  `commission_record_id` CHAR(36) NOT NULL,
  `sales_order_id` CHAR(36) NOT NULL,
  `after_sales_order_id` CHAR(36) NULL,
  `operation_key` VARCHAR(191) NOT NULL,
  `adjustment_type` VARCHAR(40) NOT NULL,
  `original_base_amount_cents` INTEGER NOT NULL,
  `previous_effective_base_amount_cents` INTEGER NOT NULL,
  `effective_base_amount_cents` INTEGER NOT NULL,
  `original_amount_cents` INTEGER NOT NULL,
  `previous_effective_amount_cents` INTEGER NOT NULL,
  `adjustment_amount_cents` INTEGER NOT NULL,
  `effective_amount_cents` INTEGER NOT NULL,
  `refund_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `actor_user_id` CHAR(36) NULL,
  `actor_name_snapshot` VARCHAR(100) NULL,
  `actor_role_snapshot` VARCHAR(32) NULL,
  `reason` VARCHAR(500) NULL,
  `source_snapshot` JSON NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

  UNIQUE INDEX `commission_adjustments_operation_key` (`operation_key`),
  INDEX `commission_adjustments_record_created_idx` (`commission_record_id`, `created_at`),
  INDEX `commission_adjustments_order_created_idx` (`sales_order_id`, `created_at`),
  INDEX `commission_adjustments_after_sales_idx` (`after_sales_order_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `commission_adjustments_record_fkey`
    FOREIGN KEY (`commission_record_id`) REFERENCES `commission_records` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `commission_adjustments_order_fkey`
    FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `commission_adjustments_after_sales_fkey`
    FOREIGN KEY (`after_sales_order_id`) REFERENCES `after_sales_orders` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
