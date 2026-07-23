ALTER TABLE `sales_orders`
  ADD COLUMN `logistics_provider_code` VARCHAR(40) NULL AFTER `logistics_method`,
  ADD COLUMN `tracking_state` VARCHAR(40) NULL AFTER `logistics_no`,
  ADD COLUMN `tracking_state_label` VARCHAR(80) NULL AFTER `tracking_state`,
  ADD COLUMN `tracking_latest_location` VARCHAR(255) NULL AFTER `tracking_state_label`,
  ADD COLUMN `tracking_latest_description` TEXT NULL AFTER `tracking_latest_location`,
  ADD COLUMN `tracking_event_at` DATETIME(0) NULL AFTER `tracking_latest_description`,
  ADD COLUMN `tracking_checked_at` DATETIME(0) NULL AFTER `tracking_event_at`;

UPDATE `sales_orders`
SET `logistics_provider_code` = CASE
  WHEN TRIM(`logistics_method`) IN ('顺丰', '顺丰速运')
    OR UPPER(TRIM(`logistics_method`)) = 'SF' THEN 'shunfeng'
  WHEN TRIM(`logistics_method`) IN ('安能', '安能物流', '安能快运')
    THEN 'annengwuliu'
  WHEN TRIM(`logistics_method`) IN ('韵达', '韵达快递')
    THEN 'yunda'
  WHEN TRIM(`logistics_method`) IN ('自带', '自提')
    THEN 'self_carry'
  WHEN `logistics_method` IS NOT NULL AND TRIM(`logistics_method`) <> ''
    THEN 'other'
  ELSE NULL
END
WHERE `logistics_provider_code` IS NULL;

CREATE INDEX `sales_orders_logistics_provider_code_idx`
  ON `sales_orders`(`logistics_provider_code`);
