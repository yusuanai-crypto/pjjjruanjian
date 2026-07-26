ALTER TABLE `travel_groups`
  ADD COLUMN `adult_count` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `child_count` INTEGER NOT NULL DEFAULT 0;

UPDATE `travel_groups`
SET
  `adult_count` = `guest_count`,
  `child_count` = 0;
