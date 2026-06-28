ALTER TABLE `travel_groups`
  ADD COLUMN `guide_id` CHAR(36) NULL,
  ADD COLUMN `taster_summary` TEXT NULL,
  ADD COLUMN `taster_summary_at` DATETIME(0) NULL,
  ADD COLUMN `post_mark_edited_at` DATETIME(0) NULL,
  ADD COLUMN `post_mark_edited_by_id` CHAR(36) NULL;

CREATE TABLE `travel_group_tasting_items` (
  `id` CHAR(36) NOT NULL,
  `travel_group_id` CHAR(36) NOT NULL,
  `product_name` VARCHAR(160) NOT NULL,
  `quantity` INTEGER NOT NULL,
  `unit` VARCHAR(20) NOT NULL DEFAULT '瓶',
  `note` TEXT NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  INDEX `travel_group_tasting_items_travel_group_id_idx`(`travel_group_id`),
  INDEX `travel_group_tasting_items_travel_group_id_sort_order_idx`(`travel_group_id`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE INDEX `travel_groups_guide_id_idx` ON `travel_groups`(`guide_id`);
CREATE INDEX `travel_groups_group_type_idx` ON `travel_groups`(`group_type`);

ALTER TABLE `travel_groups`
  ADD CONSTRAINT `travel_groups_guide_id_fkey`
  FOREIGN KEY (`guide_id`) REFERENCES `guides`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `travel_group_tasting_items`
  ADD CONSTRAINT `travel_group_tasting_items_travel_group_id_fkey`
  FOREIGN KEY (`travel_group_id`) REFERENCES `travel_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
