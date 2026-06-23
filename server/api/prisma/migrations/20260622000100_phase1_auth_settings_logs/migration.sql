CREATE TABLE `users` (
  `id` CHAR(36) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `username` VARCHAR(100) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` ENUM('admin', 'boss', 'front_desk', 'sales', 'finance', 'warehouse', 'after_sales', 'taster') NOT NULL,
  `phone` VARCHAR(30) NULL,
  `leader_id` CHAR(36) NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  UNIQUE INDEX `users_username_key`(`username`),
  INDEX `users_role_idx`(`role`),
  INDEX `users_leader_id_idx`(`leader_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `system_settings` (
  `id` CHAR(36) NOT NULL,
  `setting_key` VARCHAR(191) NOT NULL,
  `setting_value` TEXT NOT NULL,
  `updated_by` CHAR(36) NULL,
  `updated_at` DATETIME(0) NOT NULL,

  UNIQUE INDEX `system_settings_setting_key_key`(`setting_key`),
  INDEX `system_settings_updated_by_idx`(`updated_by`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `operation_logs` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NULL,
  `action` VARCHAR(100) NOT NULL,
  `entity_type` VARCHAR(100) NOT NULL,
  `entity_id` CHAR(36) NULL,
  `before_data` JSON NULL,
  `after_data` JSON NULL,
  `ip_address` VARCHAR(45) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

  INDEX `operation_logs_user_id_idx`(`user_id`),
  INDEX `operation_logs_entity_type_entity_id_idx`(`entity_type`, `entity_id`),
  INDEX `operation_logs_created_at_idx`(`created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE `users`
  ADD CONSTRAINT `users_leader_id_fkey`
  FOREIGN KEY (`leader_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `system_settings`
  ADD CONSTRAINT `system_settings_updated_by_fkey`
  FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `operation_logs`
  ADD CONSTRAINT `operation_logs_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
