ALTER TABLE `travel_groups`
  ADD COLUMN `source_region` VARCHAR(120) NULL,
  ADD COLUMN `age_info` VARCHAR(120) NULL,
  ADD COLUMN `mentioned_feitian` BOOLEAN NULL,
  ADD COLUMN `previous_stop_order_status` VARCHAR(255) NULL,
  ADD COLUMN `key_customer_info` TEXT NULL,
  ADD COLUMN `key_customer_photos` JSON NULL,
  ADD COLUMN `guest_info_attachments` JSON NULL,
  ADD COLUMN `liaison_taster_id` CHAR(36) NULL,
  ADD COLUMN `liaison_taster_name` VARCHAR(80) NULL,
  ADD COLUMN `expected_arrival_time` VARCHAR(30) NULL;

CREATE INDEX `travel_groups_liaison_taster_id_idx`
  ON `travel_groups`(`liaison_taster_id`);

ALTER TABLE `travel_groups`
  ADD CONSTRAINT `travel_groups_liaison_taster_id_fkey`
  FOREIGN KEY (`liaison_taster_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
