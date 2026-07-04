ALTER TABLE `sales_orders`
  ADD COLUMN `outreach_user_id` CHAR(36) NULL;

CREATE INDEX `sales_orders_outreach_user_id_idx` ON `sales_orders`(`outreach_user_id`);

CREATE TABLE `agency_deduction_rules` (
  `id` CHAR(36) NOT NULL,
  `agency_id` CHAR(36) NULL,
  `agency_name` VARCHAR(120) NULL,
  `product_name` VARCHAR(160) NOT NULL,
  `deduction_cost_cents` INTEGER NOT NULL DEFAULT 0,
  `effective_from` DATE NOT NULL,
  `effective_to` DATE NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `notes` TEXT NULL,
  `created_by_id` CHAR(36) NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  INDEX `agency_deduction_rules_agency_id_idx`(`agency_id`),
  INDEX `agency_deduction_rules_agency_name_idx`(`agency_name`),
  INDEX `agency_deduction_rules_product_name_idx`(`product_name`),
  INDEX `agency_deduction_rules_is_active_idx`(`is_active`),
  INDEX `agency_deduction_rules_effective_from_idx`(`effective_from`),
  INDEX `agency_deduction_rules_effective_to_idx`(`effective_to`),
  INDEX `agency_deduction_rules_created_by_id_idx`(`created_by_id`),
  INDEX `agency_deduction_rules_updated_by_id_idx`(`updated_by_id`),
  INDEX `agency_deduction_rules_agency_product_active_from_idx`(`agency_id`, `product_name`, `is_active`, `effective_from`),
  INDEX `agency_deduction_rules_name_product_active_from_idx`(`agency_name`, `product_name`, `is_active`, `effective_from`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `agency_rebate_rules` (
  `id` CHAR(36) NOT NULL,
  `agency_id` CHAR(36) NULL,
  `agency_name` VARCHAR(120) NULL,
  `daily_rebate_rate` DECIMAL(10, 4) NOT NULL DEFAULT 0,
  `monthly_rebate_rate` DECIMAL(10, 4) NOT NULL DEFAULT 0,
  `total_rebate_rate` DECIMAL(10, 4) NULL,
  `effective_from` DATE NOT NULL,
  `effective_to` DATE NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `notes` TEXT NULL,
  `created_by_id` CHAR(36) NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  INDEX `agency_rebate_rules_agency_id_idx`(`agency_id`),
  INDEX `agency_rebate_rules_agency_name_idx`(`agency_name`),
  INDEX `agency_rebate_rules_is_active_idx`(`is_active`),
  INDEX `agency_rebate_rules_effective_from_idx`(`effective_from`),
  INDEX `agency_rebate_rules_effective_to_idx`(`effective_to`),
  INDEX `agency_rebate_rules_created_by_id_idx`(`created_by_id`),
  INDEX `agency_rebate_rules_updated_by_id_idx`(`updated_by_id`),
  INDEX `agency_rebate_rules_agency_id_is_active_effective_from_idx`(`agency_id`, `is_active`, `effective_from`),
  INDEX `agency_rebate_rules_agency_name_is_active_effective_from_idx`(`agency_name`, `is_active`, `effective_from`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `sales_deduction_rules` (
  `id` CHAR(36) NOT NULL,
  `product_name` VARCHAR(160) NOT NULL,
  `deduction_cost_cents` INTEGER NOT NULL DEFAULT 0,
  `effective_from` DATE NOT NULL,
  `effective_to` DATE NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `notes` TEXT NULL,
  `created_by_id` CHAR(36) NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  INDEX `sales_deduction_rules_product_name_idx`(`product_name`),
  INDEX `sales_deduction_rules_is_active_idx`(`is_active`),
  INDEX `sales_deduction_rules_effective_from_idx`(`effective_from`),
  INDEX `sales_deduction_rules_effective_to_idx`(`effective_to`),
  INDEX `sales_deduction_rules_created_by_id_idx`(`created_by_id`),
  INDEX `sales_deduction_rules_updated_by_id_idx`(`updated_by_id`),
  INDEX `sales_deduction_rules_product_name_is_active_effective_from_idx`(`product_name`, `is_active`, `effective_from`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `commission_rules` (
  `id` CHAR(36) NOT NULL,
  `rule_name` VARCHAR(120) NOT NULL,
  `target_type` ENUM('sales_commission', 'outreach_commission', 'leader_commission') NOT NULL,
  `rate` DECIMAL(10, 4) NOT NULL DEFAULT 0,
  `effective_from` DATE NOT NULL,
  `effective_to` DATE NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `notes` TEXT NULL,
  `created_by_id` CHAR(36) NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  INDEX `commission_rules_target_type_idx`(`target_type`),
  INDEX `commission_rules_is_active_idx`(`is_active`),
  INDEX `commission_rules_effective_from_idx`(`effective_from`),
  INDEX `commission_rules_effective_to_idx`(`effective_to`),
  INDEX `commission_rules_created_by_id_idx`(`created_by_id`),
  INDEX `commission_rules_updated_by_id_idx`(`updated_by_id`),
  INDEX `commission_rules_target_type_is_active_effective_from_idx`(`target_type`, `is_active`, `effective_from`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `commission_records` (
  `id` CHAR(36) NOT NULL,
  `sales_order_id` CHAR(36) NULL,
  `travel_group_id` CHAR(36) NULL,
  `after_sales_order_id` CHAR(36) NULL,
  `commission_rule_id` CHAR(36) NULL,
  `agency_rebate_rule_id` CHAR(36) NULL,
  `target_type` ENUM('sales_commission', 'outreach_commission', 'leader_commission', 'taster_commission', 'agency_daily_rebate', 'agency_monthly_rebate') NOT NULL,
  `target_user_id` CHAR(36) NULL,
  `agency_id` CHAR(36) NULL,
  `agency_name` VARCHAR(120) NULL,
  `gross_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `confirmed_refund_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `base_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `deduction_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `rate_snapshot` DECIMAL(10, 4) NULL,
  `amount_cents` INTEGER NOT NULL DEFAULT 0,
  `points_cents` INTEGER NOT NULL DEFAULT 0,
  `manual_input` BOOLEAN NOT NULL DEFAULT false,
  `is_confirmed` BOOLEAN NOT NULL DEFAULT false,
  `confirmed_by_id` CHAR(36) NULL,
  `confirmed_at` DATETIME(0) NULL,
  `calculation_version` VARCHAR(40) NOT NULL DEFAULT 'stage7_v1',
  `calculation_note` TEXT NULL,
  `rule_snapshot` JSON NULL,
  `source_snapshot` JSON NULL,
  `created_by_id` CHAR(36) NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  INDEX `commission_records_sales_order_id_idx`(`sales_order_id`),
  INDEX `commission_records_travel_group_id_idx`(`travel_group_id`),
  INDEX `commission_records_after_sales_order_id_idx`(`after_sales_order_id`),
  INDEX `commission_records_commission_rule_id_idx`(`commission_rule_id`),
  INDEX `commission_records_agency_rebate_rule_id_idx`(`agency_rebate_rule_id`),
  INDEX `commission_records_target_type_idx`(`target_type`),
  INDEX `commission_records_target_user_id_idx`(`target_user_id`),
  INDEX `commission_records_agency_id_idx`(`agency_id`),
  INDEX `commission_records_agency_name_idx`(`agency_name`),
  INDEX `commission_records_manual_input_idx`(`manual_input`),
  INDEX `commission_records_is_confirmed_idx`(`is_confirmed`),
  INDEX `commission_records_confirmed_by_id_idx`(`confirmed_by_id`),
  INDEX `commission_records_created_by_id_idx`(`created_by_id`),
  INDEX `commission_records_updated_by_id_idx`(`updated_by_id`),
  INDEX `commission_records_created_at_idx`(`created_at`),
  INDEX `commission_records_target_type_target_user_id_created_at_idx`(`target_type`, `target_user_id`, `created_at`),
  INDEX `commission_records_travel_group_id_target_type_idx`(`travel_group_id`, `target_type`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `travel_group_finance_summaries` (
  `id` CHAR(36) NOT NULL,
  `travel_group_id` CHAR(36) NOT NULL,
  `total_sales_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `confirmed_refund_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `effective_sales_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `total_agency_deduction_cents` INTEGER NOT NULL DEFAULT 0,
  `agency_deduction_confirmed` BOOLEAN NOT NULL DEFAULT false,
  `agency_deduction_confirmed_by_id` CHAR(36) NULL,
  `agency_deduction_confirmed_at` DATETIME(0) NULL,
  `total_agency_net_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `total_daily_rebate_cents` INTEGER NOT NULL DEFAULT 0,
  `total_monthly_rebate_cents` INTEGER NOT NULL DEFAULT 0,
  `paid_rebate_cents` INTEGER NOT NULL DEFAULT 0,
  `unpaid_rebate_cents` INTEGER NOT NULL DEFAULT 0,
  `notes` TEXT NULL,
  `guide_info_sent` BOOLEAN NOT NULL DEFAULT false,
  `travel_agency_info_sent` BOOLEAN NOT NULL DEFAULT false,
  `calculation_version` VARCHAR(40) NOT NULL DEFAULT 'stage7_v1',
  `source_snapshot` JSON NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  UNIQUE INDEX `travel_group_finance_summaries_travel_group_id_key`(`travel_group_id`),
  INDEX `travel_group_finance_summaries_agency_deduction_confirmed_idx`(`agency_deduction_confirmed`),
  INDEX `tg_fin_summaries_confirmed_by_id_idx`(`agency_deduction_confirmed_by_id`),
  INDEX `travel_group_finance_summaries_updated_by_id_idx`(`updated_by_id`),
  INDEX `travel_group_finance_summaries_updated_at_idx`(`updated_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE `sales_orders`
  ADD CONSTRAINT `sales_orders_outreach_user_id_fkey`
  FOREIGN KEY (`outreach_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `agency_deduction_rules`
  ADD CONSTRAINT `agency_deduction_rules_agency_id_fkey`
  FOREIGN KEY (`agency_id`) REFERENCES `travel_agencies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `agency_deduction_rules_created_by_id_fkey`
  FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `agency_deduction_rules_updated_by_id_fkey`
  FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `agency_rebate_rules`
  ADD CONSTRAINT `agency_rebate_rules_agency_id_fkey`
  FOREIGN KEY (`agency_id`) REFERENCES `travel_agencies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `agency_rebate_rules_created_by_id_fkey`
  FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `agency_rebate_rules_updated_by_id_fkey`
  FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `sales_deduction_rules`
  ADD CONSTRAINT `sales_deduction_rules_created_by_id_fkey`
  FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `sales_deduction_rules_updated_by_id_fkey`
  FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `commission_rules`
  ADD CONSTRAINT `commission_rules_created_by_id_fkey`
  FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `commission_rules_updated_by_id_fkey`
  FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `commission_records`
  ADD CONSTRAINT `commission_records_sales_order_id_fkey`
  FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `commission_records_travel_group_id_fkey`
  FOREIGN KEY (`travel_group_id`) REFERENCES `travel_groups`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `commission_records_after_sales_order_id_fkey`
  FOREIGN KEY (`after_sales_order_id`) REFERENCES `after_sales_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `commission_records_commission_rule_id_fkey`
  FOREIGN KEY (`commission_rule_id`) REFERENCES `commission_rules`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `commission_records_agency_rebate_rule_id_fkey`
  FOREIGN KEY (`agency_rebate_rule_id`) REFERENCES `agency_rebate_rules`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `commission_records_target_user_id_fkey`
  FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `commission_records_agency_id_fkey`
  FOREIGN KEY (`agency_id`) REFERENCES `travel_agencies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `commission_records_confirmed_by_id_fkey`
  FOREIGN KEY (`confirmed_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `commission_records_created_by_id_fkey`
  FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `commission_records_updated_by_id_fkey`
  FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `travel_group_finance_summaries`
  ADD CONSTRAINT `travel_group_finance_summaries_travel_group_id_fkey`
  FOREIGN KEY (`travel_group_id`) REFERENCES `travel_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `tg_fin_summaries_confirmed_by_id_fkey`
  FOREIGN KEY (`agency_deduction_confirmed_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `travel_group_finance_summaries_updated_by_id_fkey`
  FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
