-- Phase 11 quantity sales-order inventory alerts (expand only).
-- No warehouse, product, order, stock, reservation, document, movement, or
-- alert rows are inserted or backfilled by this migration.
--
-- Rehearse table creation and foreign-key metadata locks against an isolated
-- database on the target MySQL version before production deployment.

CREATE TABLE `inventory_alerts` (
  `id` CHAR(36) NOT NULL,
  `alert_key` VARCHAR(191) NOT NULL,
  `type` ENUM(
    'low_stock',
    'negative_available',
    'pending_cost',
    'order_shortage',
    'transfer_overdue',
    'stocktake_approval'
  ) NOT NULL,
  `status` ENUM('active', 'resolved', 'cancelled')
    NOT NULL DEFAULT 'active',
  `warehouse_id` CHAR(36) NOT NULL,
  `product_id` CHAR(36) NOT NULL,
  `sales_order_id` CHAR(36) NULL,
  `inventory_line_key` VARCHAR(191) NULL,
  `first_detected_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `last_detected_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `resolved_at` DATETIME(0) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  CONSTRAINT `inventory_alerts_alert_key_not_blank_check`
    CHECK (CHAR_LENGTH(TRIM(`alert_key`)) > 0),
  CONSTRAINT `inventory_alerts_line_key_not_blank_check`
    CHECK (
      `inventory_line_key` IS NULL OR
      CHAR_LENGTH(TRIM(`inventory_line_key`)) > 0
    ),
  UNIQUE INDEX `inventory_alerts_alert_key` (`alert_key`),
  INDEX `inventory_alerts_warehouse_product_status_idx`
    (`warehouse_id`, `product_id`, `status`),
  INDEX `inventory_alerts_order_status_idx`
    (`sales_order_id`, `status`),
  INDEX `inventory_alerts_type_status_detected_idx`
    (`type`, `status`, `last_detected_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE `inventory_alerts`
  ADD CONSTRAINT `inventory_alerts_warehouse_id_fkey`
    FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_alerts_product_id_fkey`
    FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_alerts_sales_order_id_fkey`
    FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
