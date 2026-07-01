ALTER TABLE `sales_orders`
  ADD COLUMN `customer_id` CHAR(36) NULL,
  ADD COLUMN `sales_form_no` VARCHAR(80) NULL,
  ADD COLUMN `logistics_method` VARCHAR(80) NULL,
  ADD COLUMN `packing_status` ENUM('pending', 'packing', 'packed', 'abnormal') NOT NULL DEFAULT 'packed',
  ADD COLUMN `package_count` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `warehouse_remark` TEXT NULL,
  ADD COLUMN `logistics_no` VARCHAR(120) NULL,
  ADD COLUMN `logistics_fee_cents` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `invoice_required` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `invoice_issued` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `finance_remark` TEXT NULL;

ALTER TABLE `sales_order_items`
  ADD COLUMN `subtotal_cents` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `notes` TEXT NULL,
  ADD COLUMN `sort_order` INTEGER NOT NULL DEFAULT 0;

UPDATE `sales_order_items`
SET `subtotal_cents` = `quantity` * `unit_price_cents`;

UPDATE `sales_order_items` AS item
JOIN (
  SELECT
    `id`,
    ROW_NUMBER() OVER (
      PARTITION BY `sales_order_id`
      ORDER BY `created_at`, `id`
    ) - 1 AS `row_sort_order`
  FROM `sales_order_items`
) AS ranked ON ranked.`id` = item.`id`
SET item.`sort_order` = ranked.`row_sort_order`;

UPDATE `sales_orders` AS sales_order
SET sales_order.`packing_status` = 'pending'
WHERE EXISTS (
  SELECT 1
  FROM `sales_order_items` AS item
  WHERE item.`sales_order_id` = sales_order.`id`
    AND item.`delivery_type` = 'shipping'
);

CREATE INDEX `sales_orders_customer_id_idx` ON `sales_orders`(`customer_id`);
CREATE INDEX `sales_orders_sales_form_no_idx` ON `sales_orders`(`sales_form_no`);
CREATE INDEX `sales_orders_packing_status_idx` ON `sales_orders`(`packing_status`);
CREATE INDEX `sales_orders_logistics_no_idx` ON `sales_orders`(`logistics_no`);
CREATE INDEX `sales_order_items_sales_order_id_sort_order_idx` ON `sales_order_items`(`sales_order_id`, `sort_order`);

ALTER TABLE `sales_orders`
  ADD CONSTRAINT `sales_orders_customer_id_fkey`
  FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
