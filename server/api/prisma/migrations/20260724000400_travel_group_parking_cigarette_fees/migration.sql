ALTER TABLE `travel_groups`
  ADD COLUMN `parking_fee_cents` INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN `cigarette_fee_cents` INTEGER NULL;
