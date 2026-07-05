CREATE TABLE `ai_chat_messages` (
  `id` CHAR(36) NOT NULL,
  `conversation_id` VARCHAR(64) NULL,
  `user_id` CHAR(36) NOT NULL,
  `user_role` VARCHAR(32) NOT NULL,
  `question` TEXT NOT NULL,
  `answer` TEXT NOT NULL,
  `intent` VARCHAR(64) NULL,
  `data_scope` JSON NULL,
  `tool_calls` JSON NULL,
  `source_summary` JSON NULL,
  `warnings` JSON NULL,
  `model_provider` VARCHAR(64) NULL,
  `model_name` VARCHAR(128) NULL,
  `prompt_tokens` INTEGER NULL,
  `completion_tokens` INTEGER NULL,
  `latency_ms` INTEGER NULL,
  `error_code` VARCHAR(64) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

  PRIMARY KEY (`id`)
);

CREATE INDEX `ai_chat_messages_user_id_created_at_idx` ON `ai_chat_messages`(`user_id`, `created_at`);
CREATE INDEX `ai_chat_messages_conversation_id_created_at_idx` ON `ai_chat_messages`(`conversation_id`, `created_at`);
CREATE INDEX `ai_chat_messages_intent_created_at_idx` ON `ai_chat_messages`(`intent`, `created_at`);

ALTER TABLE `ai_chat_messages`
  ADD CONSTRAINT `ai_chat_messages_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
