CREATE TABLE `refresh_sessions` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `family_id` CHAR(36) NOT NULL,
  `token_version` INTEGER NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `revoked_at` DATETIME(3) NULL,
  `replaced_by_session_id` CHAR(36) NULL,
  `revoke_reason` VARCHAR(64) NULL,
  `last_used_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `refresh_sessions_token_hash_key`(`token_hash`),
  INDEX `refresh_sessions_user_id_idx`(`user_id`),
  INDEX `refresh_sessions_family_id_idx`(`family_id`),
  INDEX `refresh_sessions_expires_at_idx`(`expires_at`),
  INDEX `refresh_sessions_revoked_at_idx`(`revoked_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE `refresh_sessions`
  ADD CONSTRAINT `refresh_sessions_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
