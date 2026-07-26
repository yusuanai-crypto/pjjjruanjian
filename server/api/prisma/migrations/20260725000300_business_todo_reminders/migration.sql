CREATE TABLE `business_todos` (
  `id` CHAR(36) NOT NULL,
  `rule_code` VARCHAR(80) NOT NULL,
  `source_type` ENUM('travel_group', 'sales_order', 'after_sales_order') NOT NULL,
  `source_id` CHAR(36) NOT NULL,
  `target_role` ENUM(
    'super_admin',
    'admin',
    'boss',
    'front_desk',
    'sales',
    'finance',
    'warehouse',
    'after_sales',
    'taster'
  ) NOT NULL,
  `title` VARCHAR(160) NOT NULL,
  `content` VARCHAR(500) NOT NULL,
  `priority` ENUM('normal', 'important', 'urgent') NOT NULL DEFAULT 'normal',
  `status` ENUM('active', 'resolved', 'cancelled') NOT NULL DEFAULT 'active',
  `due_at` DATETIME(0) NOT NULL,
  `source_snapshot` JSON NULL,
  `first_detected_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `last_detected_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `resolved_at` DATETIME(0) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  UNIQUE INDEX `business_todos_rule_source_key` (`rule_code`, `source_type`, `source_id`),
  INDEX `business_todos_status_due_at_idx` (`status`, `due_at`),
  INDEX `business_todos_source_idx` (`source_type`, `source_id`),
  INDEX `business_todos_target_role_status_idx` (`target_role`, `status`),
  INDEX `business_todos_status_detected_idx` (`status`, `last_detected_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `todo_recipients` (
  `id` CHAR(36) NOT NULL,
  `todo_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `recipient_reason` ENUM('business', 'escalation') NOT NULL DEFAULT 'business',
  `read_at` DATETIME(0) NULL,
  `personal_note` TEXT NULL,
  `personal_remind_at` DATETIME(0) NULL,
  `snoozed_until` DATETIME(0) NULL,
  `archived_at` DATETIME(0) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  UNIQUE INDEX `todo_recipients_todo_user_key` (`todo_id`, `user_id`),
  INDEX `todo_recipients_user_archive_created_idx` (`user_id`, `archived_at`, `created_at`),
  INDEX `todo_recipients_todo_reason_idx` (`todo_id`, `recipient_reason`),
  INDEX `todo_recipients_user_read_idx` (`user_id`, `read_at`),
  INDEX `todo_recipients_remind_at_idx` (`personal_remind_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `todo_recipients`
  ADD CONSTRAINT `todo_recipients_todo_id_fkey`
    FOREIGN KEY (`todo_id`) REFERENCES `business_todos` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `todo_recipients_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
