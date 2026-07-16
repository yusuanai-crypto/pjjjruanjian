CREATE TABLE `products` (
  `id` CHAR(36) NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `normalized_name` VARCHAR(160) NOT NULL,
  `unit` VARCHAR(20) NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `notes` TEXT NULL,
  `created_by_id` CHAR(36) NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  INDEX `products_is_active_idx`(`is_active`),
  INDEX `products_unit_idx`(`unit`),
  INDEX `products_created_by_id_idx`(`created_by_id`),
  INDEX `products_updated_by_id_idx`(`updated_by_id`),
  UNIQUE INDEX `products_name_key`(`name`),
  UNIQUE INDEX `products_normalized_name_key`(`normalized_name`),
  PRIMARY KEY (`id`),
  CONSTRAINT `products_name_not_blank_chk` CHECK (CHAR_LENGTH(`name`) > 0),
  CONSTRAINT `products_name_trim_chk` CHECK (`name` = TRIM(`name`)),
  CONSTRAINT `products_normalized_name_not_blank_chk` CHECK (CHAR_LENGTH(`normalized_name`) > 0),
  CONSTRAINT `products_unit_not_blank_chk` CHECK (CHAR_LENGTH(`unit`) > 0),
  CONSTRAINT `products_unit_trim_chk` CHECK (`unit` = TRIM(`unit`))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `product_actual_costs` (
  `id` CHAR(36) NOT NULL,
  `product_id` CHAR(36) NOT NULL,
  `cost_cents` INTEGER NOT NULL,
  `effective_from` DATE NOT NULL,
  `effective_to` DATE NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `notes` TEXT NULL,
  `created_by_id` CHAR(36) NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  INDEX `product_actual_costs_product_id_is_active_effective_from_idx`(`product_id`, `is_active`, `effective_from`),
  INDEX `product_actual_costs_product_id_is_active_effective_to_idx`(`product_id`, `is_active`, `effective_to`),
  INDEX `product_actual_costs_created_by_id_idx`(`created_by_id`),
  INDEX `product_actual_costs_updated_by_id_idx`(`updated_by_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `product_actual_costs_cost_non_negative_chk` CHECK (`cost_cents` >= 0),
  CONSTRAINT `product_actual_costs_date_range_chk` CHECK (`effective_to` IS NULL OR `effective_to` >= `effective_from`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE `sales_order_items`
  ADD COLUMN `product_id` CHAR(36) NULL,
  ADD COLUMN `unit` VARCHAR(20) NULL,
  ADD COLUMN `actual_unit_cost_cents` INTEGER NULL,
  ADD COLUMN `actual_cost_subtotal_cents` INTEGER NULL,
  ADD COLUMN `gross_profit_cents` INTEGER NULL;

ALTER TABLE `travel_group_tasting_items`
  ADD COLUMN `product_id` CHAR(36) NULL;

ALTER TABLE `sales_deduction_rules`
  ADD COLUMN `product_id` CHAR(36) NULL;

ALTER TABLE `agency_deduction_rules`
  ADD COLUMN `product_id` CHAR(36) NULL;

CREATE INDEX `sales_order_items_product_id_idx` ON `sales_order_items`(`product_id`);
CREATE INDEX `travel_group_tasting_items_product_id_idx` ON `travel_group_tasting_items`(`product_id`);
CREATE INDEX `sales_deduction_rules_product_id_idx` ON `sales_deduction_rules`(`product_id`);
CREATE INDEX `sales_deduction_rules_product_id_is_active_effective_from_idx`
  ON `sales_deduction_rules`(`product_id`, `is_active`, `effective_from`);
CREATE INDEX `agency_deduction_rules_product_id_idx` ON `agency_deduction_rules`(`product_id`);
CREATE INDEX `agency_deduction_rules_agency_id_product_id_is_active_effective_from_idx`
  ON `agency_deduction_rules`(`agency_id`, `product_id`, `is_active`, `effective_from`);

ALTER TABLE `products`
  ADD CONSTRAINT `products_created_by_id_fkey`
  FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `products_updated_by_id_fkey`
  FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `product_actual_costs`
  ADD CONSTRAINT `product_actual_costs_product_id_fkey`
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `product_actual_costs_created_by_id_fkey`
  FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `product_actual_costs_updated_by_id_fkey`
  FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `sales_order_items`
  ADD CONSTRAINT `sales_order_items_product_id_fkey`
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `travel_group_tasting_items`
  ADD CONSTRAINT `travel_group_tasting_items_product_id_fkey`
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `sales_deduction_rules`
  ADD CONSTRAINT `sales_deduction_rules_product_id_fkey`
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `agency_deduction_rules`
  ADD CONSTRAINT `agency_deduction_rules_product_id_fkey`
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TRIGGER `product_actual_costs_no_active_overlap_insert`
BEFORE INSERT ON `product_actual_costs`
FOR EACH ROW
BEGIN
  IF NEW.`is_active` = 1 AND EXISTS (
    SELECT 1
    FROM `product_actual_costs` AS existing
    WHERE existing.`product_id` = NEW.`product_id`
      AND existing.`is_active` = 1
      AND NEW.`effective_from` <= COALESCE(existing.`effective_to`, '9999-12-31')
      AND existing.`effective_from` <= COALESCE(NEW.`effective_to`, '9999-12-31')
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Active product actual cost effective ranges must not overlap.';
  END IF;
END;

CREATE TRIGGER `product_actual_costs_no_active_overlap_update`
BEFORE UPDATE ON `product_actual_costs`
FOR EACH ROW
BEGIN
  IF NEW.`is_active` = 1 AND EXISTS (
    SELECT 1
    FROM `product_actual_costs` AS existing
    WHERE existing.`id` <> NEW.`id`
      AND existing.`product_id` = NEW.`product_id`
      AND existing.`is_active` = 1
      AND NEW.`effective_from` <= COALESCE(existing.`effective_to`, '9999-12-31')
      AND existing.`effective_from` <= COALESCE(NEW.`effective_to`, '9999-12-31')
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Active product actual cost effective ranges must not overlap.';
  END IF;
END;
