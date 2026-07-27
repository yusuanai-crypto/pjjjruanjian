ALTER TABLE `sales_orders`
  ADD COLUMN `has_packing_mark` BOOLEAN NOT NULL DEFAULT false
    AFTER `warehouse_remark`;
