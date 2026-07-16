ALTER TABLE `users`
  MODIFY `role` ENUM('super_admin', 'admin', 'boss', 'front_desk', 'sales', 'finance', 'warehouse', 'after_sales', 'taster') NOT NULL,
  ADD COLUMN `must_change_password` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `status_reason` VARCHAR(255) NULL,
  ADD COLUMN `status_changed_at` DATETIME(0) NULL,
  ADD COLUMN `status_changed_by` CHAR(36) NULL;

UPDATE `users`
SET `role` = 'super_admin'
WHERE `username` = 'admin' AND `role` = 'admin';

UPDATE `users`
SET `phone` = NULL
WHERE `phone` = '';

CREATE UNIQUE INDEX `users_phone_key` ON `users`(`phone`);
CREATE INDEX `users_status_changed_by_idx` ON `users`(`status_changed_by`);

CREATE TABLE `sms_verification_codes` (
  `id` CHAR(36) NOT NULL,
  `phone` VARCHAR(30) NOT NULL,
  `user_id` CHAR(36) NULL,
  `purpose` ENUM('reset_password') NOT NULL,
  `code_hash` VARCHAR(255) NOT NULL,
  `expires_at` DATETIME(0) NOT NULL,
  `consumed_at` DATETIME(0) NULL,
  `attempt_count` INT NOT NULL DEFAULT 0,
  `created_by_id` CHAR(36) NULL,
  `provider` VARCHAR(32) NULL,
  `provider_ref` VARCHAR(128) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `sms_verification_codes_phone_purpose_created_at_idx`
  ON `sms_verification_codes`(`phone`, `purpose`, `created_at`);
CREATE INDEX `sms_verification_codes_user_id_idx`
  ON `sms_verification_codes`(`user_id`);
CREATE INDEX `sms_verification_codes_expires_at_idx`
  ON `sms_verification_codes`(`expires_at`);
