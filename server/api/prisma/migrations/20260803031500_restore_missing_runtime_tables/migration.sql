-- Restore runtime tables whose original migrations were removed while their
-- Prisma models and scheduled jobs remained in the application.

CREATE TABLE `inventory_post_commit_tasks` (
  `id` CHAR(36) NOT NULL,
  `source_key` VARCHAR(191) NOT NULL,
  `command_receipt_id` CHAR(36) NOT NULL,
  `task_type` VARCHAR(80) NOT NULL,
  `payload` JSON NOT NULL,
  `status` ENUM('pending', 'processing', 'succeeded', 'failed')
    NOT NULL DEFAULT 'pending',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `next_attempt_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `locked_at` DATETIME(0) NULL,
  `last_error_code` VARCHAR(100) NULL,
  `completed_at` DATETIME(0) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  CONSTRAINT `inventory_post_commit_tasks_source_key_not_blank_check`
    CHECK (CHAR_LENGTH(TRIM(`source_key`)) > 0),
  CONSTRAINT `inventory_post_commit_tasks_attempts_check`
    CHECK (`attempts` >= 0),
  UNIQUE INDEX `inventory_post_commit_tasks_source_key` (`source_key`),
  INDEX `inventory_post_commit_tasks_due_idx`
    (`status`, `next_attempt_at`, `created_at`),
  INDEX `inventory_post_commit_tasks_receipt_status_idx`
    (`command_receipt_id`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `inventory_post_commit_tasks`
  ADD CONSTRAINT `inventory_post_commit_tasks_command_receipt_id_fkey`
    FOREIGN KEY (`command_receipt_id`)
    REFERENCES `inventory_command_receipts`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `todo_reconcile_cursors` (
  `id` CHAR(36) NOT NULL,
  `scan_type` VARCHAR(80) NOT NULL,
  `cursor_id` CHAR(36) NULL,
  `wrapped_at` DATETIME(0) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0)
    ON UPDATE CURRENT_TIMESTAMP(0),

  CONSTRAINT `todo_reconcile_cursors_pkey` PRIMARY KEY (`id`),
  CONSTRAINT `todo_reconcile_cursors_scan_type_key`
    UNIQUE (`scan_type`),
  INDEX `todo_reconcile_cursors_updated_at_idx` (`updated_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
