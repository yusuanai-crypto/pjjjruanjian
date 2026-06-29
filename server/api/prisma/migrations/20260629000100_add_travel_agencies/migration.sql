CREATE TABLE `travel_agencies` (
  `id` CHAR(36) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `contact_name` VARCHAR(80) NULL,
  `contact_phone` VARCHAR(30) NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  UNIQUE INDEX `travel_agencies_name_key`(`name`),
  INDEX `travel_agencies_contact_phone_idx`(`contact_phone`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
