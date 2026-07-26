ALTER TABLE `travel_groups`
  ADD COLUMN `loss_status` ENUM('pending', 'recorded', 'no_loss')
    NOT NULL DEFAULT 'pending',
  ADD COLUMN `loss_confirmed_at` DATETIME(0) NULL,
  ADD COLUMN `loss_confirmed_by_id` CHAR(36) NULL;

CREATE INDEX `travel_groups_loss_status_idx`
  ON `travel_groups` (`loss_status`);

CREATE INDEX `travel_groups_loss_confirmed_by_id_idx`
  ON `travel_groups` (`loss_confirmed_by_id`);

ALTER TABLE `travel_groups`
  ADD CONSTRAINT `travel_groups_loss_confirmed_by_id_fkey`
    FOREIGN KEY (`loss_confirmed_by_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
