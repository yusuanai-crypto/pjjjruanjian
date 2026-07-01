CREATE TABLE `customers` (
  `id` CHAR(36) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `phone` VARCHAR(30) NULL,
  `province` VARCHAR(60) NULL,
  `city` VARCHAR(60) NULL,
  `district` VARCHAR(60) NULL,
  `address` VARCHAR(255) NULL,
  `finance_mark` BOOLEAN NOT NULL DEFAULT false,
  `marked_by` CHAR(36) NULL,
  `marked_at` DATETIME(0) NULL,
  `notes` TEXT NULL,
  `created_by_id` CHAR(36) NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  INDEX `customers_name_idx`(`name`),
  INDEX `customers_phone_idx`(`phone`),
  INDEX `customers_finance_mark_idx`(`finance_mark`),
  INDEX `customers_marked_by_idx`(`marked_by`),
  INDEX `customers_created_by_id_idx`(`created_by_id`),
  INDEX `customers_updated_at_idx`(`updated_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE `customers`
  ADD CONSTRAINT `customers_marked_by_fkey`
  FOREIGN KEY (`marked_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
