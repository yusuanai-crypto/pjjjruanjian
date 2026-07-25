-- Read-only preflight for 20260724000300_order_taster_commission_uniqueness.
-- Run against a production backup or read replica before deploying the
-- migration. This script never updates or deletes data.

-- 1. Blocking duplicate order-level manual taster commissions.
SELECT
  `sales_order_id`,
  `target_type`,
  `target_user_id`,
  `manual_input`,
  COUNT(*) AS `duplicate_count`,
  GROUP_CONCAT(`id` ORDER BY `created_at`) AS `record_ids`
FROM `commission_records`
WHERE `sales_order_id` IS NOT NULL
  AND `target_type` = 'taster_commission'
  AND `manual_input` = TRUE
GROUP BY
  `sales_order_id`,
  `target_type`,
  `target_user_id`,
  `manual_input`
HAVING COUNT(*) > 1;

-- 2. Legacy records eligible for automatic single-order backfill.
SELECT
  `candidate`.`commission_record_id`,
  `candidate`.`travel_group_id`,
  `candidate`.`taster_id`,
  `candidate`.`sales_order_id`
FROM (
  SELECT
    `legacy`.`id` AS `commission_record_id`,
    `legacy`.`travel_group_id`,
    `legacy`.`target_user_id` AS `taster_id`,
    MIN(`sales_order`.`id`) AS `sales_order_id`
  FROM `commission_records` AS `legacy`
  INNER JOIN `travel_groups` AS `travel_group`
    ON `travel_group`.`id` = `legacy`.`travel_group_id`
    AND `travel_group`.`taster_id` = `legacy`.`target_user_id`
  INNER JOIN `sales_orders` AS `sales_order`
    ON `sales_order`.`travel_group_id` = `legacy`.`travel_group_id`
    AND `sales_order`.`status` IN ('valid', 'partial_refund')
  WHERE `legacy`.`sales_order_id` IS NULL
    AND `legacy`.`target_type` = 'taster_commission'
    AND `legacy`.`manual_input` = TRUE
  GROUP BY
    `legacy`.`id`,
    `legacy`.`travel_group_id`,
    `legacy`.`target_user_id`
  HAVING COUNT(DISTINCT `sales_order`.`id`) = 1
) AS `candidate`
WHERE NOT EXISTS (
  SELECT 1
  FROM `commission_records` AS `other_legacy`
  WHERE `other_legacy`.`travel_group_id` = `candidate`.`travel_group_id`
    AND `other_legacy`.`target_user_id` = `candidate`.`taster_id`
    AND `other_legacy`.`target_type` = 'taster_commission'
    AND `other_legacy`.`manual_input` = TRUE
    AND `other_legacy`.`sales_order_id` IS NULL
    AND `other_legacy`.`id` <> `candidate`.`commission_record_id`
)
AND NOT EXISTS (
  SELECT 1
  FROM `commission_records` AS `existing_order_record`
  WHERE `existing_order_record`.`sales_order_id` = `candidate`.`sales_order_id`
    AND `existing_order_record`.`target_type` = 'taster_commission'
    AND `existing_order_record`.`target_user_id` = `candidate`.`taster_id`
    AND `existing_order_record`.`manual_input` = TRUE
);

-- 3. Multi-order legacy records requiring manual allocation.
SELECT
  `legacy`.`id` AS `commission_record_id`,
  `legacy`.`travel_group_id`,
  `legacy`.`target_user_id` AS `taster_id`,
  `legacy`.`amount_cents`,
  COUNT(DISTINCT `sales_order`.`id`) AS `effective_order_count`,
  GROUP_CONCAT(
    DISTINCT `sales_order`.`id`
    ORDER BY `sales_order`.`id`
  ) AS `candidate_sales_order_ids`
FROM `commission_records` AS `legacy`
INNER JOIN `sales_orders` AS `sales_order`
  ON `sales_order`.`travel_group_id` = `legacy`.`travel_group_id`
  AND `sales_order`.`status` IN ('valid', 'partial_refund')
WHERE `legacy`.`sales_order_id` IS NULL
  AND `legacy`.`target_type` = 'taster_commission'
  AND `legacy`.`manual_input` = TRUE
GROUP BY
  `legacy`.`id`,
  `legacy`.`travel_group_id`,
  `legacy`.`target_user_id`,
  `legacy`.`amount_cents`
HAVING COUNT(DISTINCT `sales_order`.`id`) > 1;

-- 4. Duplicate legacy group-level records retained for manual review.
SELECT
  `travel_group_id`,
  `target_user_id` AS `taster_id`,
  COUNT(*) AS `legacy_record_count`,
  GROUP_CONCAT(`id` ORDER BY `created_at`) AS `record_ids`
FROM `commission_records`
WHERE `sales_order_id` IS NULL
  AND `target_type` = 'taster_commission'
  AND `manual_input` = TRUE
GROUP BY
  `travel_group_id`,
  `target_user_id`
HAVING COUNT(*) > 1;

-- 5. Unresolved legacy records: no effective order or taster mismatch.
SELECT
  `legacy`.`id` AS `commission_record_id`,
  `legacy`.`travel_group_id`,
  `legacy`.`target_user_id` AS `taster_id`,
  `legacy`.`amount_cents`
FROM `commission_records` AS `legacy`
LEFT JOIN `travel_groups` AS `travel_group`
  ON `travel_group`.`id` = `legacy`.`travel_group_id`
LEFT JOIN `sales_orders` AS `sales_order`
  ON `sales_order`.`travel_group_id` = `legacy`.`travel_group_id`
  AND `sales_order`.`status` IN ('valid', 'partial_refund')
WHERE `legacy`.`sales_order_id` IS NULL
  AND `legacy`.`target_type` = 'taster_commission'
  AND `legacy`.`manual_input` = TRUE
GROUP BY
  `legacy`.`id`,
  `legacy`.`travel_group_id`,
  `legacy`.`target_user_id`,
  `legacy`.`amount_cents`,
  `travel_group`.`taster_id`
HAVING COUNT(`sales_order`.`id`) = 0
  OR `travel_group`.`taster_id` IS NULL
  OR `travel_group`.`taster_id` <> `legacy`.`target_user_id`;
