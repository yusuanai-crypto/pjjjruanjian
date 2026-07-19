ALTER TABLE `after_sales_orders`
  ADD COLUMN `warehouse_confirmed_by_id` CHAR(36) NULL,
  ADD COLUMN `warehouse_confirmed_at` DATETIME(0) NULL,
  ADD COLUMN `warehouse_confirm_note` TEXT NULL,
  ADD COLUMN `refund_proof_attachments` JSON NULL;

CREATE INDEX `after_sales_orders_warehouse_confirmed_by_id_idx`
  ON `after_sales_orders`(`warehouse_confirmed_by_id`);

CREATE INDEX `after_sales_orders_warehouse_confirmed_at_idx`
  ON `after_sales_orders`(`warehouse_confirmed_at`);

CREATE INDEX `after_sales_orders_status_warehouse_confirmed_at_idx`
  ON `after_sales_orders`(`status`, `warehouse_confirmed_at`);

ALTER TABLE `after_sales_orders`
  ADD CONSTRAINT `after_sales_orders_warehouse_confirmed_by_id_fkey`
  FOREIGN KEY (`warehouse_confirmed_by_id`) REFERENCES `users`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
