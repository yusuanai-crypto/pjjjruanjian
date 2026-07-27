ALTER TABLE `sales_orders`
  ADD COLUMN `source_sales_order_id` CHAR(36) NULL AFTER `order_type`;

CREATE INDEX `sales_orders_source_sales_order_id_idx`
  ON `sales_orders` (`source_sales_order_id`);

ALTER TABLE `after_sales_orders`
  ADD COLUMN `after_sales_sales_order_id` CHAR(36) NULL AFTER `sales_order_id`,
  ADD COLUMN `deduction_calculation_mode` VARCHAR(40) NOT NULL
    DEFAULT 'manual_product_reference' AFTER `refund_amount_cents`,
  ADD COLUMN `source_agency_deduction_cents` INTEGER NOT NULL
    DEFAULT 0 AFTER `deduction_calculation_mode`,
  ADD COLUMN `agency_deduction_rate` DECIMAL(10, 4) NULL
    AFTER `source_agency_deduction_cents`,
  ADD COLUMN `daily_rebate_rate` DECIMAL(10, 4) NOT NULL
    DEFAULT 0 AFTER `agency_deduction_rate`,
  ADD COLUMN `monthly_rebate_rate` DECIMAL(10, 4) NOT NULL
    DEFAULT 0 AFTER `daily_rebate_rate`,
  ADD COLUMN `agency_deduction_rule_id` CHAR(36) NULL
    AFTER `monthly_rebate_rate`,
  ADD COLUMN `agency_rebate_rule_id` CHAR(36) NULL
    AFTER `agency_deduction_rule_id`,
  ADD COLUMN `calculation_date` DATE NULL AFTER `agency_rebate_rule_id`,
  ADD COLUMN `agency_deduction_adjustment_cents` INTEGER NULL
    AFTER `calculation_date`,
  ADD COLUMN `financial_effect_status`
    ENUM(
      'pending_confirmation',
      'confirmed',
      'pending_recovery',
      'no_financial_effect'
    )
    NOT NULL DEFAULT 'pending_confirmation'
    AFTER `agency_deduction_adjustment_cents`;

CREATE UNIQUE INDEX `after_sales_orders_after_sales_sales_order_id_key`
  ON `after_sales_orders` (`after_sales_sales_order_id`);
CREATE INDEX `after_sales_orders_after_sales_sales_order_id_idx`
  ON `after_sales_orders` (`after_sales_sales_order_id`);

-- Historical records get a stable AFTER_SALES SalesOrder. Re-running the
-- backfill statements is safe because both order_no and the relation are
-- checked before insertion.
INSERT INTO `sales_orders` (
  `id`,
  `order_no`,
  `order_type`,
  `source_sales_order_id`,
  `travel_group_id`,
  `customer_id`,
  `customer_name`,
  `customer_phone`,
  `province`,
  `city`,
  `district`,
  `address`,
  `order_date`,
  `sales_form_no`,
  `total_amount_cents`,
  `cash_on_delivery_amount_cents`,
  `packing_status`,
  `package_count`,
  `has_packing_mark`,
  `logistics_fee_cents`,
  `invoice_required`,
  `invoice_issued`,
  `status`,
  `finance_mark`,
  `sales_user_id`,
  `outreach_user_id`,
  `points_destination`,
  `personal_points_guide_id`,
  `personal_guide_name_snapshot`,
  `personal_daily_rebate_rate`,
  `personal_monthly_rebate_rate`,
  `created_by_id`,
  `updated_by_id`,
  `created_at`,
  `updated_at`
)
SELECT
  UUID(),
  aso.`after_sales_no`,
  'after_sales',
  source_order.`id`,
  source_order.`travel_group_id`,
  source_order.`customer_id`,
  source_order.`customer_name`,
  source_order.`customer_phone`,
  source_order.`province`,
  source_order.`city`,
  source_order.`district`,
  source_order.`address`,
  DATE(CONVERT_TZ(aso.`created_at`, '+00:00', '+08:00')),
  aso.`after_sales_no`,
  GREATEST(0, aso.`refund_amount_cents`),
  0,
  'packed',
  0,
  false,
  0,
  false,
  false,
  'valid',
  source_order.`finance_mark`,
  source_order.`sales_user_id`,
  source_order.`outreach_user_id`,
  source_order.`points_destination`,
  source_order.`personal_points_guide_id`,
  source_order.`personal_guide_name_snapshot`,
  source_order.`personal_daily_rebate_rate`,
  source_order.`personal_monthly_rebate_rate`,
  aso.`created_by_id`,
  aso.`updated_by_id`,
  aso.`created_at`,
  aso.`updated_at`
FROM `after_sales_orders` aso
INNER JOIN `sales_orders` source_order
  ON source_order.`id` = aso.`sales_order_id`
LEFT JOIN `sales_orders` generated_order
  ON generated_order.`order_no` = aso.`after_sales_no`
WHERE aso.`after_sales_sales_order_id` IS NULL
  AND generated_order.`id` IS NULL;

UPDATE `after_sales_orders` aso
INNER JOIN `sales_orders` generated_order
  ON generated_order.`order_no` = aso.`after_sales_no`
  AND generated_order.`order_type` = 'after_sales'
SET aso.`after_sales_sales_order_id` = generated_order.`id`
WHERE aso.`after_sales_sales_order_id` IS NULL;

UPDATE `after_sales_orders`
SET `calculation_date` =
  DATE(CONVERT_TZ(`created_at`, '+00:00', '+08:00'))
WHERE `calculation_date` IS NULL;

UPDATE `after_sales_orders` aso
SET aso.`source_agency_deduction_cents` = COALESCE(
      (
        SELECT MAX(ABS(cr.`deduction_amount_cents`))
        FROM `commission_records` cr
        WHERE cr.`sales_order_id` = aso.`sales_order_id`
          AND cr.`after_sales_order_id` IS NULL
          AND cr.`target_type` IN (
            'agency_daily_rebate',
            'agency_monthly_rebate'
          )
      ),
      0
    ),
    aso.`daily_rebate_rate` = COALESCE(
      (
        SELECT MAX(cr.`rate_snapshot`)
        FROM `commission_records` cr
        WHERE cr.`sales_order_id` = aso.`sales_order_id`
          AND cr.`after_sales_order_id` IS NULL
          AND cr.`target_type` = 'agency_daily_rebate'
      ),
      0
    ),
    aso.`monthly_rebate_rate` = COALESCE(
      (
        SELECT MAX(cr.`rate_snapshot`)
        FROM `commission_records` cr
        WHERE cr.`sales_order_id` = aso.`sales_order_id`
          AND cr.`after_sales_order_id` IS NULL
          AND cr.`target_type` = 'agency_monthly_rebate'
      ),
      0
    ),
    aso.`agency_rebate_rule_id` = (
      SELECT MAX(cr.`agency_rebate_rule_id`)
      FROM `commission_records` cr
      WHERE cr.`sales_order_id` = aso.`sales_order_id`
        AND cr.`after_sales_order_id` IS NULL
        AND cr.`target_type` IN (
          'agency_daily_rebate',
          'agency_monthly_rebate'
        )
    );

UPDATE `after_sales_orders` aso
INNER JOIN `sales_orders` source_order
  ON source_order.`id` = aso.`sales_order_id`
SET aso.`deduction_calculation_mode` = CASE
      WHEN EXISTS (
        SELECT 1
        FROM `commission_records` cr
        WHERE cr.`sales_order_id` = aso.`sales_order_id`
          AND cr.`after_sales_order_id` IS NULL
          AND cr.`target_type` IN (
            'agency_daily_rebate',
            'agency_monthly_rebate'
          )
          AND CONCAT(
            COALESCE(cr.`calculation_note`, ''),
            COALESCE(CAST(cr.`rule_snapshot` AS CHAR), ''),
            COALESCE(CAST(cr.`source_snapshot` AS CHAR), '')
          ) LIKE _utf8mb4'%effective_sales_rate%' COLLATE utf8mb4_bin
      ) THEN 'effective_sales_rate'
      ELSE 'manual_product_reference'
    END,
    aso.`agency_deduction_rate` = CASE
      WHEN source_order.`total_amount_cents` > 0
        THEN ROUND(
          aso.`source_agency_deduction_cents`
            / source_order.`total_amount_cents`,
          4
        )
      ELSE NULL
    END,
    aso.`agency_deduction_adjustment_cents` = CASE
      WHEN EXISTS (
        SELECT 1
        FROM `commission_records` cr
        WHERE cr.`sales_order_id` = aso.`sales_order_id`
          AND cr.`after_sales_order_id` IS NULL
          AND cr.`target_type` IN (
            'agency_daily_rebate',
            'agency_monthly_rebate'
          )
          AND CONCAT(
            COALESCE(cr.`calculation_note`, ''),
            COALESCE(CAST(cr.`rule_snapshot` AS CHAR), ''),
            COALESCE(CAST(cr.`source_snapshot` AS CHAR), '')
          ) LIKE _utf8mb4'%effective_sales_rate%' COLLATE utf8mb4_bin
      ) AND source_order.`total_amount_cents` > 0
        THEN LEAST(
          aso.`refund_amount_cents`,
          ROUND(
            aso.`source_agency_deduction_cents`
              * aso.`refund_amount_cents`
              / source_order.`total_amount_cents`
          )
        )
      ELSE NULL
    END;

UPDATE `after_sales_orders` aso
SET aso.`financial_effect_status` = CASE
  WHEN aso.`refund_amount_cents` = 0 THEN 'no_financial_effect'
  WHEN EXISTS (
    SELECT 1
    FROM `sales_orders` source_order
    INNER JOIN `travel_group_finance_summaries` summary
      ON summary.`travel_group_id` = source_order.`travel_group_id`
    WHERE source_order.`id` = aso.`sales_order_id`
      AND (
        summary.`daily_rebate_paid` = true
        OR summary.`monthly_rebate_paid` = true
      )
  ) THEN 'pending_recovery'
  WHEN aso.`finance_confirmed` = true
    AND aso.`agency_deduction_adjustment_cents` IS NOT NULL
    THEN 'confirmed'
  ELSE 'pending_confirmation'
END;

ALTER TABLE `after_sales_orders`
  MODIFY COLUMN `after_sales_sales_order_id` CHAR(36) NOT NULL,
  MODIFY COLUMN `calculation_date` DATE NOT NULL;

CREATE TABLE `after_sales_order_items` (
  `id` CHAR(36) NOT NULL,
  `after_sales_order_id` CHAR(36) NOT NULL,
  `source_sales_order_item_id` CHAR(36) NULL,
  `product_id` CHAR(36) NULL,
  `product_name` VARCHAR(160) NOT NULL,
  `unit` VARCHAR(20) NULL,
  `quantity` INTEGER NOT NULL,
  `original_unit_price_cents` INTEGER NOT NULL,
  `subtotal_cents` INTEGER NOT NULL,
  `is_historical_placeholder` BOOLEAN NOT NULL DEFAULT false,
  `notes` TEXT NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

  INDEX `after_sales_order_items_after_sales_order_id_idx`
    (`after_sales_order_id`),
  INDEX `after_sales_order_items_source_sales_order_item_id_idx`
    (`source_sales_order_item_id`),
  INDEX `after_sales_order_items_product_id_idx` (`product_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `after_sales_order_items` (
  `id`,
  `after_sales_order_id`,
  `source_sales_order_item_id`,
  `product_id`,
  `product_name`,
  `unit`,
  `quantity`,
  `original_unit_price_cents`,
  `subtotal_cents`,
  `is_historical_placeholder`,
  `notes`,
  `sort_order`,
  `created_at`
)
SELECT
  UUID(),
  aso.`id`,
  NULL,
  NULL,
  '历史售后调整',
  NULL,
  1,
  GREATEST(0, aso.`refund_amount_cents`),
  GREATEST(0, aso.`refund_amount_cents`),
  true,
  '由历史回填生成；原酒品明细无法可靠还原',
  0,
  aso.`created_at`
FROM `after_sales_orders` aso
WHERE NOT EXISTS (
  SELECT 1
  FROM `after_sales_order_items` item
  WHERE item.`after_sales_order_id` = aso.`id`
);

INSERT INTO `sales_order_items` (
  `id`,
  `sales_order_id`,
  `product_id`,
  `product_name`,
  `unit`,
  `quantity`,
  `unit_price_cents`,
  `subtotal_cents`,
  `delivery_type`,
  `notes`,
  `sort_order`,
  `created_at`
)
SELECT
  UUID(),
  aso.`after_sales_sales_order_id`,
  NULL,
  '历史售后调整',
  NULL,
  1,
  GREATEST(0, aso.`refund_amount_cents`),
  GREATEST(0, aso.`refund_amount_cents`),
  'self_pickup',
  '由历史回填生成；原酒品明细无法可靠还原',
  0,
  aso.`created_at`
FROM `after_sales_orders` aso
WHERE NOT EXISTS (
  SELECT 1
  FROM `sales_order_items` item
  WHERE item.`sales_order_id` = aso.`after_sales_sales_order_id`
);

ALTER TABLE `sales_orders`
  ADD CONSTRAINT `sales_orders_source_sales_order_id_fkey`
    FOREIGN KEY (`source_sales_order_id`) REFERENCES `sales_orders` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `after_sales_orders`
  ADD CONSTRAINT `after_sales_orders_after_sales_sales_order_id_fkey`
    FOREIGN KEY (`after_sales_sales_order_id`) REFERENCES `sales_orders` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `after_sales_order_items`
  ADD CONSTRAINT `after_sales_order_items_after_sales_order_id_fkey`
    FOREIGN KEY (`after_sales_order_id`) REFERENCES `after_sales_orders` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `after_sales_order_items_source_sales_order_item_id_fkey`
    FOREIGN KEY (`source_sales_order_item_id`) REFERENCES `sales_order_items` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `after_sales_order_items_product_id_fkey`
    FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
