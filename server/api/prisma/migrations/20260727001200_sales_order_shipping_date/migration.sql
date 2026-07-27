ALTER TABLE `sales_orders`
  ADD COLUMN `shipping_date` DATE NULL,
  ADD COLUMN `shipping_date_source` ENUM(
    'system_default',
    'user_specified',
    'migration'
  ) NULL,
  ADD COLUMN `shipping_date_backfill_batch_id` VARCHAR(64) NULL;

CREATE INDEX `sales_orders_shipping_date_idx`
  ON `sales_orders`(`shipping_date`);
