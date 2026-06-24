ALTER TABLE `travel_groups`
  ADD COLUMN `finance_mark` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `marked_by` CHAR(36) NULL,
  ADD COLUMN `marked_at` DATETIME(0) NULL;

ALTER TABLE `guide_carried_groups`
  ADD COLUMN `finance_mark` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `marked_by` CHAR(36) NULL,
  ADD COLUMN `marked_at` DATETIME(0) NULL;

ALTER TABLE `pending_travel_groups`
  ADD COLUMN `finance_mark` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `marked_by` CHAR(36) NULL,
  ADD COLUMN `marked_at` DATETIME(0) NULL;

ALTER TABLE `sales_orders`
  ADD COLUMN `finance_mark` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `marked_by` CHAR(36) NULL,
  ADD COLUMN `marked_at` DATETIME(0) NULL;

CREATE INDEX `travel_groups_finance_mark_idx` ON `travel_groups`(`finance_mark`);
CREATE INDEX `travel_groups_marked_by_idx` ON `travel_groups`(`marked_by`);
CREATE INDEX `guide_carried_groups_finance_mark_idx` ON `guide_carried_groups`(`finance_mark`);
CREATE INDEX `guide_carried_groups_marked_by_idx` ON `guide_carried_groups`(`marked_by`);
CREATE INDEX `pending_travel_groups_finance_mark_idx` ON `pending_travel_groups`(`finance_mark`);
CREATE INDEX `pending_travel_groups_marked_by_idx` ON `pending_travel_groups`(`marked_by`);
CREATE INDEX `sales_orders_finance_mark_idx` ON `sales_orders`(`finance_mark`);
CREATE INDEX `sales_orders_marked_by_idx` ON `sales_orders`(`marked_by`);

ALTER TABLE `travel_groups`
  ADD CONSTRAINT `travel_groups_marked_by_fkey`
  FOREIGN KEY (`marked_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `guide_carried_groups`
  ADD CONSTRAINT `guide_carried_groups_marked_by_fkey`
  FOREIGN KEY (`marked_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `pending_travel_groups`
  ADD CONSTRAINT `pending_travel_groups_marked_by_fkey`
  FOREIGN KEY (`marked_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `sales_orders`
  ADD CONSTRAINT `sales_orders_marked_by_fkey`
  FOREIGN KEY (`marked_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
