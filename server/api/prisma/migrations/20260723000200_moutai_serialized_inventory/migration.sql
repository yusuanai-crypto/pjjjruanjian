-- Product keeps the generic tracking strategy. Existing products remain NONE.
ALTER TABLE `products`
  ADD COLUMN `inventory_tracking_mode` ENUM('none', 'serialized')
  NOT NULL DEFAULT 'none' AFTER `unit`;

CREATE INDEX `products_inventory_tracking_mode_idx`
  ON `products`(`inventory_tracking_mode`);

-- Create the unified Moutai master product when it is not already present.
-- Runtime code only reads inventory_tracking_mode and never branches on this name.
INSERT INTO `products` (
  `id`,
  `name`,
  `normalized_name`,
  `unit`,
  `inventory_tracking_mode`,
  `is_active`,
  `notes`,
  `created_at`,
  `updated_at`
)
SELECT
  UUID(),
  '茅台',
  '茅台',
  '瓶',
  'serialized',
  1,
  '逐瓶库存统一主数据',
  CURRENT_TIMESTAMP(0),
  CURRENT_TIMESTAMP(0)
WHERE NOT EXISTS (
  SELECT 1 FROM `products` WHERE `normalized_name` = '茅台'
);

UPDATE `products`
SET `inventory_tracking_mode` = 'serialized'
WHERE `normalized_name` = '茅台';

-- Business fields are nullable at the database layer for migration/backfill safety.
-- The create/edit APIs require complete production data for every new unit.
CREATE TABLE `serialized_inventory_units` (
  `id` CHAR(36) NOT NULL,
  `product_id` CHAR(36) NOT NULL,
  `sales_order_id` CHAR(36) NULL,
  `sales_order_item_id` CHAR(36) NULL,
  `moutai_name` VARCHAR(160) NULL,
  `normalized_moutai_name` VARCHAR(160) NULL,
  `factory_date` DATE NULL,
  `production_batch` VARCHAR(80) NULL,
  `batch_serial_no` VARCHAR(80) NULL,
  `logistics_code` VARCHAR(160) NULL,
  `normalized_logistics_code` VARCHAR(160) NULL,
  `purchase_cost_cents` INTEGER NULL,
  `order_cost_snapshot_cents` INTEGER NULL,
  `status` ENUM('pending_cost', 'available', 'allocated', 'void')
    NOT NULL DEFAULT 'pending_cost',
  `correction_reason` VARCHAR(500) NULL,
  `corrected_by_id` CHAR(36) NULL,
  `corrected_at` DATETIME(0) NULL,
  `created_by_id` CHAR(36) NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  UNIQUE INDEX `serialized_inventory_units_normalized_code_key`
    (`normalized_logistics_code`),
  INDEX `serialized_inventory_units_product_status_idx` (`product_id`, `status`),
  INDEX `serialized_inventory_units_moutai_name_idx` (`moutai_name`),
  INDEX `serialized_inventory_units_normalized_name_idx` (`normalized_moutai_name`),
  INDEX `serialized_inventory_units_factory_date_idx` (`factory_date`),
  INDEX `serialized_inventory_units_production_batch_idx` (`production_batch`),
  INDEX `serialized_inventory_units_batch_serial_no_idx` (`batch_serial_no`),
  INDEX `serialized_inventory_units_logistics_code_idx` (`logistics_code`),
  INDEX `serialized_inventory_units_status_idx` (`status`),
  INDEX `serialized_inventory_units_sales_order_id_idx` (`sales_order_id`),
  INDEX `serialized_inventory_units_sales_order_item_id_idx` (`sales_order_item_id`),
  INDEX `serialized_inventory_units_created_by_id_idx` (`created_by_id`),
  INDEX `serialized_inventory_units_updated_by_id_idx` (`updated_by_id`),
  INDEX `serialized_inventory_units_corrected_by_id_idx` (`corrected_by_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `serialized_inventory_units`
  ADD CONSTRAINT `serialized_inventory_units_product_id_fkey`
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `serialized_inventory_units`
  ADD CONSTRAINT `serialized_inventory_units_sales_order_id_fkey`
  FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `serialized_inventory_units`
  ADD CONSTRAINT `serialized_inventory_units_sales_order_item_id_fkey`
  FOREIGN KEY (`sales_order_item_id`) REFERENCES `sales_order_items`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `serialized_inventory_units`
  ADD CONSTRAINT `serialized_inventory_units_created_by_id_fkey`
  FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `serialized_inventory_units`
  ADD CONSTRAINT `serialized_inventory_units_updated_by_id_fkey`
  FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `serialized_inventory_units`
  ADD CONSTRAINT `serialized_inventory_units_corrected_by_id_fkey`
  FOREIGN KEY (`corrected_by_id`) REFERENCES `users`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
