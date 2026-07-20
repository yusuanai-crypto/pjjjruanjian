ALTER TABLE `users`
  ADD COLUMN `token_version` INTEGER NOT NULL DEFAULT 0
  AFTER `must_change_password`;

ALTER TABLE `sms_verification_codes`
  ADD COLUMN `active_key` VARCHAR(191) NULL
  AFTER `code_hash`;

-- Codes created before this lifecycle migration are deliberately revoked.
UPDATE `sms_verification_codes`
SET
  `consumed_at` = COALESCE(`consumed_at`, CURRENT_TIMESTAMP),
  `active_key` = NULL
WHERE `consumed_at` IS NULL;

CREATE UNIQUE INDEX `sms_verification_codes_active_key_key`
  ON `sms_verification_codes`(`active_key`);
