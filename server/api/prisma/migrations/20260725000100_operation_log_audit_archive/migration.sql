-- Extend the existing online audit table in place. Every new column is
-- nullable so historical rows remain readable without a destructive rebuild.
ALTER TABLE `operation_logs`
  MODIFY COLUMN `entity_id` VARCHAR(100) NULL,
  ADD COLUMN `actor_name_snapshot` VARCHAR(100) NULL,
  ADD COLUMN `actor_username_snapshot` VARCHAR(100) NULL,
  ADD COLUMN `actor_role_snapshot` VARCHAR(32) NULL,
  ADD COLUMN `module` VARCHAR(100) NULL,
  ADD COLUMN `operation_type` ENUM(
    'CREATE', 'READ', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT',
    'IMPORT', 'EXPORT', 'UPLOAD', 'DOWNLOAD', 'REVIEW',
    'STATUS_CHANGE', 'OTHER'
  ) NULL,
  ADD COLUMN `result` ENUM('SUCCESS', 'FAILURE') NULL,
  ADD COLUMN `request_summary` JSON NULL,
  ADD COLUMN `http_method` VARCHAR(10) NULL,
  ADD COLUMN `request_path` VARCHAR(255) NULL,
  ADD COLUMN `request_id` VARCHAR(64) NULL,
  ADD COLUMN `status_code` INTEGER NULL,
  ADD COLUMN `error_code` VARCHAR(100) NULL,
  ADD COLUMN `error_message` VARCHAR(512) NULL,
  ADD COLUMN `user_agent` VARCHAR(512) NULL,
  ADD COLUMN `duration_ms` INTEGER NULL,
  ADD COLUMN `archived_at` DATETIME(3) NULL;

-- Safe, repeatable inference is intentionally limited to values that can be
-- derived from the stable action prefix. Unknown historical actions stay NULL.
UPDATE `operation_logs`
SET `module` = LEFT(SUBSTRING_INDEX(`action`, '.', 1), 100)
WHERE `module` IS NULL AND `action` LIKE '%.%';

UPDATE `operation_logs`
SET `result` = 'SUCCESS'
WHERE `result` IS NULL;

CREATE INDEX `operation_logs_user_created_idx`
  ON `operation_logs`(`user_id`, `created_at`);
CREATE INDEX `operation_logs_module_created_idx`
  ON `operation_logs`(`module`, `created_at`);
CREATE INDEX `operation_logs_type_created_idx`
  ON `operation_logs`(`operation_type`, `created_at`);
CREATE INDEX `operation_logs_result_created_idx`
  ON `operation_logs`(`result`, `created_at`);
CREATE INDEX `operation_logs_request_id_idx`
  ON `operation_logs`(`request_id`);

CREATE TABLE `operation_log_archives` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NULL,
  `actor_name_snapshot` VARCHAR(100) NULL,
  `actor_username_snapshot` VARCHAR(100) NULL,
  `actor_role_snapshot` VARCHAR(32) NULL,
  `module` VARCHAR(100) NULL,
  `operation_type` ENUM(
    'CREATE', 'READ', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT',
    'IMPORT', 'EXPORT', 'UPLOAD', 'DOWNLOAD', 'REVIEW',
    'STATUS_CHANGE', 'OTHER'
  ) NULL,
  `action` VARCHAR(100) NOT NULL,
  `entity_type` VARCHAR(100) NOT NULL,
  `entity_id` VARCHAR(100) NULL,
  `result` ENUM('SUCCESS', 'FAILURE') NULL,
  `before_data` JSON NULL,
  `after_data` JSON NULL,
  `request_summary` JSON NULL,
  `sanitization_summary` JSON NULL,
  `http_method` VARCHAR(10) NULL,
  `request_path` VARCHAR(255) NULL,
  `request_id` VARCHAR(64) NULL,
  `status_code` INTEGER NULL,
  `error_code` VARCHAR(100) NULL,
  `error_message` VARCHAR(512) NULL,
  `user_agent` VARCHAR(512) NULL,
  `duration_ms` INTEGER NULL,
  `ip_address` VARCHAR(45) NULL,
  `archived_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(0) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `operation_log_archives_user_created_idx` (`user_id`, `created_at`),
  INDEX `operation_log_archives_module_created_idx` (`module`, `created_at`),
  INDEX `operation_log_archives_type_created_idx` (`operation_type`, `created_at`),
  INDEX `operation_log_archives_result_created_idx` (`result`, `created_at`),
  INDEX `operation_log_archives_entity_idx` (`entity_type`, `entity_id`),
  INDEX `operation_log_archives_request_id_idx` (`request_id`),
  INDEX `operation_log_archives_created_idx` (`created_at`),
  INDEX `operation_log_archives_archived_idx` (`archived_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
