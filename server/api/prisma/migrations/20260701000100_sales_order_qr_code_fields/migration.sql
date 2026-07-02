ALTER TABLE `sales_orders`
  ADD COLUMN `qr_code_token` VARCHAR(80) NULL,
  ADD COLUMN `qr_code_generated_at` DATETIME(0) NULL,
  ADD COLUMN `qr_code_expires_at` DATETIME(0) NULL;

CREATE UNIQUE INDEX `sales_orders_qr_code_token_key` ON `sales_orders`(`qr_code_token`);
CREATE INDEX `sales_orders_qr_code_expires_at_idx` ON `sales_orders`(`qr_code_expires_at`);
