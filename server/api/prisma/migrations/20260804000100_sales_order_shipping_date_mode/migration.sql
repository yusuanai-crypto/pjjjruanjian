-- Add an explicit shipping-date mode without overwriting any existing date
-- or source metadata. The information_schema guards keep this migration safe
-- when a partially deployed environment is retried.

SET @shipping_date_mode_column_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sales_orders'
    AND COLUMN_NAME = 'shipping_date_mode'
);

SET @shipping_date_mode_column_sql = IF(
  @shipping_date_mode_column_exists = 0,
  'ALTER TABLE `sales_orders` ADD COLUMN `shipping_date_mode` ENUM(''scheduled'', ''pending_customer_notice'') NOT NULL DEFAULT ''scheduled'' AFTER `order_date`',
  'SELECT 1'
);

PREPARE shipping_date_mode_column_statement
  FROM @shipping_date_mode_column_sql;
EXECUTE shipping_date_mode_column_statement;
DEALLOCATE PREPARE shipping_date_mode_column_statement;

-- Historical rows predate the explicit pending state, so every one of them is
-- scheduled. Fill only missing dates; existing dates, sources, and batch ids
-- remain untouched.
UPDATE `sales_orders`
SET `shipping_date_mode` = 'scheduled'
WHERE `shipping_date_mode` IS NULL;

UPDATE `sales_orders`
SET
  `shipping_date` = DATE_ADD(DATE(DATE_ADD(`created_at`, INTERVAL 8 HOUR)), INTERVAL 1 DAY),
  `shipping_date_source` = COALESCE(`shipping_date_source`, 'migration'),
  `shipping_date_backfill_batch_id` = COALESCE(
    `shipping_date_backfill_batch_id`,
    'shipping-date-mode-20260804'
  )
WHERE `shipping_date_mode` = 'scheduled'
  AND `shipping_date` IS NULL;

SET @shipping_date_mode_index_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sales_orders'
    AND INDEX_NAME = 'sales_orders_shipping_date_mode_idx'
);

SET @shipping_date_mode_index_sql = IF(
  @shipping_date_mode_index_exists = 0,
  'CREATE INDEX `sales_orders_shipping_date_mode_idx` ON `sales_orders`(`shipping_date_mode`)',
  'SELECT 1'
);

PREPARE shipping_date_mode_index_statement
  FROM @shipping_date_mode_index_sql;
EXECUTE shipping_date_mode_index_statement;
DEALLOCATE PREPARE shipping_date_mode_index_statement;

SET @shipping_date_mode_check_exists = (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sales_orders'
    AND CONSTRAINT_NAME = 'sales_orders_shipping_date_mode_date_chk'
    AND CONSTRAINT_TYPE = 'CHECK'
);

SET @shipping_date_mode_check_sql = IF(
  @shipping_date_mode_check_exists = 0,
  'ALTER TABLE `sales_orders` ADD CONSTRAINT `sales_orders_shipping_date_mode_date_chk` CHECK ((`shipping_date_mode` = ''scheduled'' AND `shipping_date` IS NOT NULL) OR (`shipping_date_mode` = ''pending_customer_notice'' AND `shipping_date` IS NULL))',
  'SELECT 1'
);

PREPARE shipping_date_mode_check_statement
  FROM @shipping_date_mode_check_sql;
EXECUTE shipping_date_mode_check_statement;
DEALLOCATE PREPARE shipping_date_mode_check_statement;
