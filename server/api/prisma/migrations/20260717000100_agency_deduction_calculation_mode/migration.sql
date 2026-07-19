ALTER TABLE `agency_deduction_rules`
  ADD COLUMN `calculation_mode` VARCHAR(40) NOT NULL DEFAULT 'manual_product_reference',
  ADD COLUMN `deduction_rate` DECIMAL(10, 4) NOT NULL DEFAULT 0.3000;

UPDATE `agency_deduction_rules`
SET `calculation_mode` = 'manual_product_reference'
WHERE `calculation_mode` IS NULL OR `calculation_mode` = '';

ALTER TABLE `agency_deduction_rules`
  ALTER COLUMN `product_name` SET DEFAULT '';

CREATE INDEX `agency_deduction_rules_calculation_mode_idx`
  ON `agency_deduction_rules`(`calculation_mode`);

CREATE INDEX `agency_deduction_rules_agency_mode_active_from_idx`
  ON `agency_deduction_rules`(`agency_id`, `calculation_mode`, `is_active`, `effective_from`);

CREATE INDEX `agency_deduction_rules_name_mode_active_from_idx`
  ON `agency_deduction_rules`(`agency_name`, `calculation_mode`, `is_active`, `effective_from`);
