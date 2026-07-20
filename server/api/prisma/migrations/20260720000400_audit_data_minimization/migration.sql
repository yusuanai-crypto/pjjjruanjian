ALTER TABLE `operation_logs`
  ADD COLUMN `sanitization_summary` JSON NULL AFTER `after_data`;
