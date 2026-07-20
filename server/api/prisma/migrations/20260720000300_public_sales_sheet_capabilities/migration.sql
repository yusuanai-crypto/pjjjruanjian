ALTER TABLE `sales_orders`
  ADD COLUMN `qr_code_token_hash` CHAR(64) NULL,
  ADD COLUMN `qr_code_revoked_at` DATETIME(0) NULL;

-- Raw bearer values are replaced by SHA-256 lookup hashes. Legacy tokens that
-- had no expiry are revoked during migration instead of becoming permanent.
UPDATE `sales_orders`
SET
  `qr_code_token_hash` = LOWER(SHA2(`qr_code_token`, 256)),
  `qr_code_revoked_at` = CASE
    WHEN `qr_code_token` IS NOT NULL AND `qr_code_expires_at` IS NULL
      THEN CURRENT_TIMESTAMP
    ELSE NULL
  END,
  `qr_code_expires_at` = CASE
    WHEN `qr_code_token` IS NOT NULL AND `qr_code_expires_at` IS NULL
      THEN CURRENT_TIMESTAMP
    ELSE `qr_code_expires_at`
  END
WHERE `qr_code_token` IS NOT NULL;

DROP INDEX `sales_orders_qr_code_token_key` ON `sales_orders`;

ALTER TABLE `sales_orders`
  DROP COLUMN `qr_code_token`;

CREATE UNIQUE INDEX `sales_orders_qr_code_token_hash_key`
  ON `sales_orders`(`qr_code_token_hash`);
