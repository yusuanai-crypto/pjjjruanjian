ALTER TABLE `sales_orders`
  ADD COLUMN `sales_edit_count` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `sales_edited_at` DATETIME(0) NULL;

CREATE INDEX `sales_orders_sales_user_id_created_at_idx`
  ON `sales_orders`(`sales_user_id`, `created_at`);

ALTER TABLE `travel_groups`
  ADD COLUMN `taster_edit_count` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `taster_last_edited_at` DATETIME(0) NULL;

CREATE INDEX `travel_groups_visit_date_liaison_taster_id_idx`
  ON `travel_groups`(`visit_date`, `liaison_taster_id`);
