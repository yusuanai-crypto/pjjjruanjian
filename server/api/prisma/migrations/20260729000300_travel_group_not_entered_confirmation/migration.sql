-- Additive-only confirmation fields. Existing travel groups remain unconfirmed;
-- entry status continues to be derived from arrival_time and these nullable fields.
ALTER TABLE `travel_groups`
  ADD COLUMN `not_entered_confirmed_at` DATETIME(0) NULL,
  ADD COLUMN `not_entered_confirmed_by_id` CHAR(36) NULL;

CREATE INDEX `travel_groups_not_entered_confirmed_at_idx`
  ON `travel_groups` (`not_entered_confirmed_at`);

CREATE INDEX `travel_groups_not_entered_confirmed_by_id_idx`
  ON `travel_groups` (`not_entered_confirmed_by_id`);

ALTER TABLE `travel_groups`
  ADD CONSTRAINT `travel_groups_not_entered_confirmed_by_id_fkey`
    FOREIGN KEY (`not_entered_confirmed_by_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
