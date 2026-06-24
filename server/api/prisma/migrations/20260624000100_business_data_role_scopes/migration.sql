ALTER TABLE `travel_groups`
  ADD COLUMN `taster_id` CHAR(36) NULL;

ALTER TABLE `guide_carried_groups`
  ADD COLUMN `taster_id` CHAR(36) NULL;

ALTER TABLE `pending_travel_groups`
  ADD COLUMN `taster_id` CHAR(36) NULL;

ALTER TABLE `sales_orders`
  ADD COLUMN `sales_user_id` CHAR(36) NULL;

UPDATE `travel_groups` AS `group_row`
INNER JOIN (
  SELECT `name`, MIN(`id`) AS `id`
  FROM `users`
  WHERE `role` = 'taster'
  GROUP BY `name`
) AS `taster_user`
  ON `taster_user`.`name` = `group_row`.`taster_name`
SET `group_row`.`taster_id` = `taster_user`.`id`
WHERE `group_row`.`taster_id` IS NULL;

UPDATE `guide_carried_groups` AS `group_row`
INNER JOIN (
  SELECT `name`, MIN(`id`) AS `id`
  FROM `users`
  WHERE `role` = 'taster'
  GROUP BY `name`
) AS `taster_user`
  ON `taster_user`.`name` = `group_row`.`taster_name`
SET `group_row`.`taster_id` = `taster_user`.`id`
WHERE `group_row`.`taster_id` IS NULL;

UPDATE `pending_travel_groups` AS `group_row`
INNER JOIN (
  SELECT `name`, MIN(`id`) AS `id`
  FROM `users`
  WHERE `role` = 'taster'
  GROUP BY `name`
) AS `taster_user`
  ON `taster_user`.`name` = `group_row`.`taster_name`
SET `group_row`.`taster_id` = `taster_user`.`id`
WHERE `group_row`.`taster_id` IS NULL;

UPDATE `sales_orders` AS `order_row`
INNER JOIN `users` AS `sales_user`
  ON `sales_user`.`id` = `order_row`.`created_by_id`
  AND `sales_user`.`role` = 'sales'
SET `order_row`.`sales_user_id` = `order_row`.`created_by_id`
WHERE `order_row`.`sales_user_id` IS NULL;

CREATE INDEX `travel_groups_taster_id_idx` ON `travel_groups`(`taster_id`);
CREATE INDEX `guide_carried_groups_taster_id_idx` ON `guide_carried_groups`(`taster_id`);
CREATE INDEX `pending_travel_groups_taster_id_idx` ON `pending_travel_groups`(`taster_id`);
CREATE INDEX `sales_orders_sales_user_id_idx` ON `sales_orders`(`sales_user_id`);

ALTER TABLE `travel_groups`
  ADD CONSTRAINT `travel_groups_taster_id_fkey`
  FOREIGN KEY (`taster_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `guide_carried_groups`
  ADD CONSTRAINT `guide_carried_groups_taster_id_fkey`
  FOREIGN KEY (`taster_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `pending_travel_groups`
  ADD CONSTRAINT `pending_travel_groups_taster_id_fkey`
  FOREIGN KEY (`taster_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `sales_orders`
  ADD CONSTRAINT `sales_orders_sales_user_id_fkey`
  FOREIGN KEY (`sales_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
