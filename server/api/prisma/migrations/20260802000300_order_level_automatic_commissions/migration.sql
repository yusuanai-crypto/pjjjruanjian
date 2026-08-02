-- Add a stable non-null business key for automatic commission records.
-- Historical nullable attribution columns are intentionally preserved.
ALTER TABLE `commission_records`
  ADD COLUMN `automatic_scope_key` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `commission_records_automatic_scope_key`
  ON `commission_records`(`automatic_scope_key`);
