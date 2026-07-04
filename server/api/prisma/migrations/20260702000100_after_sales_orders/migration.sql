CREATE TABLE `after_sales_orders` (
  `id` CHAR(36) NOT NULL,
  `after_sales_no` VARCHAR(80) NOT NULL,
  `sales_order_id` CHAR(36) NOT NULL,
  `customer_id` CHAR(36) NULL,
  `issue_type` ENUM('quality_issue', 'logistics_damage', 'wrong_item', 'missing_item', 'customer_return', 'invoice_issue', 'other') NOT NULL,
  `action_type` ENUM('record_only', 'refund', 'return_refund', 'resend', 'exchange', 'cancel_order') NOT NULL,
  `description` TEXT NOT NULL,
  `resolution` TEXT NULL,
  `refund_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `status` ENUM('negotiating', 'waiting_receive', 'waiting_resend', 'waiting_refund', 'completed') NOT NULL DEFAULT 'negotiating',
  `finance_confirmed` BOOLEAN NOT NULL DEFAULT false,
  `finance_confirmed_by_id` CHAR(36) NULL,
  `finance_confirmed_at` DATETIME(0) NULL,
  `handled_by_id` CHAR(36) NULL,
  `handled_at` DATETIME(0) NULL,
  `completed_at` DATETIME(0) NULL,
  `notes` TEXT NULL,
  `created_by_id` CHAR(36) NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  UNIQUE INDEX `after_sales_orders_after_sales_no_key`(`after_sales_no`),
  INDEX `after_sales_orders_sales_order_id_idx`(`sales_order_id`),
  INDEX `after_sales_orders_customer_id_idx`(`customer_id`),
  INDEX `after_sales_orders_status_idx`(`status`),
  INDEX `after_sales_orders_issue_type_idx`(`issue_type`),
  INDEX `after_sales_orders_action_type_idx`(`action_type`),
  INDEX `after_sales_orders_finance_confirmed_idx`(`finance_confirmed`),
  INDEX `after_sales_orders_created_at_idx`(`created_at`),
  INDEX `after_sales_orders_handled_by_id_idx`(`handled_by_id`),
  INDEX `after_sales_orders_status_created_at_idx`(`status`, `created_at`),
  INDEX `after_sales_orders_finance_confirmed_created_at_idx`(`finance_confirmed`, `created_at`),
  INDEX `after_sales_orders_finance_confirmed_by_id_idx`(`finance_confirmed_by_id`),
  INDEX `after_sales_orders_created_by_id_idx`(`created_by_id`),
  INDEX `after_sales_orders_updated_by_id_idx`(`updated_by_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE `after_sales_orders`
  ADD CONSTRAINT `after_sales_orders_sales_order_id_fkey`
  FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `after_sales_orders_customer_id_fkey`
  FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `after_sales_orders_finance_confirmed_by_id_fkey`
  FOREIGN KEY (`finance_confirmed_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `after_sales_orders_handled_by_id_fkey`
  FOREIGN KEY (`handled_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `after_sales_orders_created_by_id_fkey`
  FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `after_sales_orders_updated_by_id_fkey`
  FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
