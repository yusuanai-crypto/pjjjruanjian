CREATE TABLE `rate_limit_counters` (
  `key_fingerprint` CHAR(64) NOT NULL,
  `scope` VARCHAR(64) NOT NULL,
  `window_start_at` DATETIME(3) NOT NULL,
  `window_end_at` DATETIME(3) NOT NULL,
  `request_count` INTEGER NOT NULL DEFAULT 0,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

  INDEX `rate_limit_counters_window_end_idx` (`window_end_at`),
  PRIMARY KEY (`key_fingerprint`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
