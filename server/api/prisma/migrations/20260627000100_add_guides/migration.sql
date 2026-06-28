CREATE TABLE `guides` (
  `id` CHAR(36) NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `phone` VARCHAR(30) NOT NULL,
  `travel_agency` VARCHAR(120) NOT NULL,
  `remarks` TEXT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  UNIQUE INDEX `guides_phone_key`(`phone`),
  INDEX `guides_name_idx`(`name`),
  INDEX `guides_travel_agency_idx`(`travel_agency`),
  INDEX `guides_is_active_idx`(`is_active`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
