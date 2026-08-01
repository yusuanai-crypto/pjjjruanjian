ALTER TABLE `warehouses`
  ADD COLUMN `parent_warehouse_id` CHAR(36) NULL AFTER `manager_user_id`,
  ADD INDEX `warehouses_parent_active_idx` (`parent_warehouse_id`, `is_active`),
  ADD CONSTRAINT `warehouses_parent_not_self_chk`
    CHECK (`parent_warehouse_id` IS NULL OR `parent_warehouse_id` <> `id`),
  ADD CONSTRAINT `warehouses_default_must_be_root_chk`
    CHECK (`is_default` = 0 OR `parent_warehouse_id` IS NULL),
  ADD CONSTRAINT `warehouses_parent_warehouse_id_fkey`
    FOREIGN KEY (`parent_warehouse_id`) REFERENCES `warehouses`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `warehouse_product_configurations` (
  `id` CHAR(36) NOT NULL,
  `warehouse_id` CHAR(36) NOT NULL,
  `product_id` CHAR(36) NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_by_id` CHAR(36) NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE INDEX `warehouse_product_configurations_warehouse_product_key` (`warehouse_id`, `product_id`),
  INDEX `warehouse_product_configurations_warehouse_active_idx` (`warehouse_id`, `is_active`, `updated_at`),
  INDEX `warehouse_product_configurations_product_active_idx` (`product_id`, `is_active`),
  INDEX `warehouse_product_configurations_created_by_id_idx` (`created_by_id`),
  INDEX `warehouse_product_configurations_updated_by_id_idx` (`updated_by_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `warehouse_product_configurations_warehouse_id_fkey`
    FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `warehouse_product_configurations_product_id_fkey`
    FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `warehouse_product_configurations_created_by_id_fkey`
    FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `warehouse_product_configurations_updated_by_id_fkey`
    FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TRIGGER `warehouses_two_levels_insert`
BEFORE INSERT ON `warehouses`
FOR EACH ROW
BEGIN
  IF NEW.`parent_warehouse_id` IS NOT NULL AND EXISTS (
    SELECT 1
    FROM `warehouses` AS parent
    WHERE parent.`id` = NEW.`parent_warehouse_id`
      AND parent.`parent_warehouse_id` IS NOT NULL
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'A child warehouse cannot own another child warehouse.';
  END IF;
END;

CREATE TRIGGER `warehouses_two_levels_update`
BEFORE UPDATE ON `warehouses`
FOR EACH ROW
BEGIN
  IF NEW.`parent_warehouse_id` IS NOT NULL AND EXISTS (
    SELECT 1
    FROM `warehouses` AS parent
    WHERE parent.`id` = NEW.`parent_warehouse_id`
      AND parent.`parent_warehouse_id` IS NOT NULL
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'A child warehouse cannot own another child warehouse.';
  END IF;

  IF NEW.`parent_warehouse_id` IS NOT NULL AND EXISTS (
    SELECT 1
    FROM `warehouses` AS child
    WHERE child.`parent_warehouse_id` = NEW.`id`
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'A warehouse with children cannot become a child warehouse.';
  END IF;
END;
