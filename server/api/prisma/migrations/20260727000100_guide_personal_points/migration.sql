ALTER TABLE `sales_orders`
  ADD COLUMN `points_destination` ENUM('travel_agency', 'guide_personal')
    NOT NULL DEFAULT 'travel_agency',
  ADD COLUMN `personal_points_guide_id` CHAR(36) NULL,
  ADD COLUMN `personal_guide_name_snapshot` VARCHAR(80) NULL,
  ADD COLUMN `personal_daily_rebate_rate` DECIMAL(5, 4) NULL,
  ADD COLUMN `personal_monthly_rebate_rate` DECIMAL(5, 4) NULL,
  ADD COLUMN `points_destination_changed_by_id` CHAR(36) NULL,
  ADD COLUMN `points_destination_changed_at` DATETIME(0) NULL,
  ADD COLUMN `personal_rates_updated_by_id` CHAR(36) NULL,
  ADD COLUMN `personal_rates_updated_at` DATETIME(0) NULL;

CREATE INDEX `sales_orders_points_destination_idx`
  ON `sales_orders` (`points_destination`);
CREATE INDEX `sales_orders_points_destination_travel_group_id_idx`
  ON `sales_orders` (`points_destination`, `travel_group_id`);
CREATE INDEX `sales_orders_personal_points_guide_id_idx`
  ON `sales_orders` (`personal_points_guide_id`);
CREATE INDEX `sales_orders_travel_group_id_personal_points_guide_id_idx`
  ON `sales_orders` (`travel_group_id`, `personal_points_guide_id`);
CREATE INDEX `sales_orders_points_destination_changed_by_id_idx`
  ON `sales_orders` (`points_destination_changed_by_id`);
CREATE INDEX `sales_orders_personal_rates_updated_by_id_idx`
  ON `sales_orders` (`personal_rates_updated_by_id`);

ALTER TABLE `sales_orders`
  ADD CONSTRAINT `sales_orders_personal_points_guide_id_fkey`
    FOREIGN KEY (`personal_points_guide_id`) REFERENCES `guides` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `sales_orders_points_destination_changed_by_id_fkey`
    FOREIGN KEY (`points_destination_changed_by_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `sales_orders_personal_rates_updated_by_id_fkey`
    FOREIGN KEY (`personal_rates_updated_by_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `guide_points_summaries` (
  `id` CHAR(36) NOT NULL,
  `travel_group_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `guide_id` CHAR(36) NOT NULL,
  `guide_name_snapshot` VARCHAR(80) NOT NULL,
  `order_count` INTEGER NOT NULL DEFAULT 0,
  `total_sales_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `total_cash_on_delivery_cents` INTEGER NOT NULL DEFAULT 0,
  `total_paid_deposit_cents` INTEGER NOT NULL DEFAULT 0,
  `confirmed_refund_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `effective_sales_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `total_liquor_cost_deduction_cents` INTEGER NOT NULL DEFAULT 0,
  `total_net_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `total_daily_points_cents` INTEGER NOT NULL DEFAULT 0,
  `total_monthly_points_cents` INTEGER NOT NULL DEFAULT 0,
  `paid_points_cents` INTEGER NOT NULL DEFAULT 0,
  `unpaid_points_cents` INTEGER NOT NULL DEFAULT 0,
  `daily_points_paid` BOOLEAN NOT NULL DEFAULT false,
  `daily_points_paid_by_id` CHAR(36) NULL,
  `daily_points_paid_at` DATETIME(0) NULL,
  `monthly_points_paid` BOOLEAN NOT NULL DEFAULT false,
  `monthly_points_paid_by_id` CHAR(36) NULL,
  `monthly_points_paid_at` DATETIME(0) NULL,
  `notes` TEXT NULL,
  `calculation_version` VARCHAR(40) NOT NULL DEFAULT 'guide_points_v1',
  `source_snapshot` JSON NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  UNIQUE INDEX `guide_points_summaries_group_guide_key`
    (`travel_group_id`, `guide_id`),
  INDEX `guide_points_summaries_travel_group_id_idx` (`travel_group_id`),
  INDEX `guide_points_summaries_guide_id_idx` (`guide_id`),
  INDEX `guide_points_summaries_order_count_idx` (`order_count`),
  INDEX `guide_points_summaries_daily_points_paid_idx` (`daily_points_paid`),
  INDEX `guide_points_summaries_monthly_points_paid_idx` (`monthly_points_paid`),
  INDEX `guide_points_summaries_daily_points_paid_by_id_idx`
    (`daily_points_paid_by_id`),
  INDEX `guide_points_summaries_monthly_points_paid_by_id_idx`
    (`monthly_points_paid_by_id`),
  INDEX `guide_points_summaries_updated_by_id_idx` (`updated_by_id`),
  INDEX `guide_points_summaries_updated_at_idx` (`updated_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `guide_points_summaries`
  ADD CONSTRAINT `guide_points_summaries_travel_group_id_fkey`
    FOREIGN KEY (`travel_group_id`) REFERENCES `travel_groups` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `guide_points_summaries_guide_id_fkey`
    FOREIGN KEY (`guide_id`) REFERENCES `guides` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `guide_points_summaries_daily_points_paid_by_id_fkey`
    FOREIGN KEY (`daily_points_paid_by_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `guide_points_summaries_monthly_points_paid_by_id_fkey`
    FOREIGN KEY (`monthly_points_paid_by_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `guide_points_summaries_updated_by_id_fkey`
    FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
