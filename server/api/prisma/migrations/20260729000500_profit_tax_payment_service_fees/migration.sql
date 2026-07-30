-- Keep all historical rates nullable. This migration intentionally performs no
-- fee-rate or snapshot backfill because no reliable historical values exist.
ALTER TABLE `payment_methods`
    ADD COLUMN `service_fee_rate` DECIMAL(10, 6) NULL;

ALTER TABLE `sales_orders`
    ADD COLUMN `tax_rate_snapshot` DECIMAL(10, 6) NULL,
    ADD COLUMN `profit_fee_snapshotted_at` DATETIME(0) NULL,
    ADD COLUMN `profit_fee_snapshotted_by_id` CHAR(36) NULL;

ALTER TABLE `sales_order_payment_details`
    ADD COLUMN `service_fee_rate_snapshot` DECIMAL(10, 6) NULL,
    ADD COLUMN `service_fee_base_amount_snapshot_cents` INTEGER NULL;

ALTER TABLE `after_sales_orders`
    ADD COLUMN `refund_payment_detail_id` CHAR(36) NULL,
    ADD COLUMN `refund_payment_method_name_snapshot` VARCHAR(80) NULL,
    ADD COLUMN `refund_occurred_at` DATETIME(0) NULL,
    ADD COLUMN `deducts_payment_service_fee` BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX `sales_orders_profit_fee_snapshotted_by_id_idx`
    ON `sales_orders`(`profit_fee_snapshotted_by_id`);

CREATE INDEX `after_sales_orders_refund_payment_detail_id_idx`
    ON `after_sales_orders`(`refund_payment_detail_id`);

CREATE INDEX `after_sales_orders_refund_fee_effect_idx`
    ON `after_sales_orders`(`sales_order_id`, `finance_confirmed`, `refund_occurred_at`);

ALTER TABLE `sales_orders`
    ADD CONSTRAINT `sales_orders_profit_fee_snapshotted_by_id_fkey`
    FOREIGN KEY (`profit_fee_snapshotted_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `after_sales_orders`
    ADD CONSTRAINT `after_sales_orders_refund_payment_detail_id_fkey`
    FOREIGN KEY (`refund_payment_detail_id`) REFERENCES `sales_order_payment_details`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
