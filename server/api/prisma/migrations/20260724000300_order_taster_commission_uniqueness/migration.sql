-- Backfill only an unambiguous legacy manual taster commission:
--   * the travel group has exactly one effective order;
--   * the legacy record's target user is still the group's taster;
--   * there is only one legacy record for that group and taster; and
--   * no order-level manual taster commission already exists.
-- Multi-order, duplicate, and unresolved legacy records remain unchanged for
-- manual review and continue to be visible in commission detail queries.
UPDATE `commission_records` AS `legacy`
INNER JOIN `travel_groups` AS `travel_group`
  ON `travel_group`.`id` = `legacy`.`travel_group_id`
  AND `travel_group`.`taster_id` = `legacy`.`target_user_id`
INNER JOIN `sales_orders` AS `single_order`
  ON `single_order`.`travel_group_id` = `legacy`.`travel_group_id`
  AND `single_order`.`status` IN ('valid', 'partial_refund')
LEFT JOIN `sales_orders` AS `other_order`
  ON `other_order`.`travel_group_id` = `legacy`.`travel_group_id`
  AND `other_order`.`status` IN ('valid', 'partial_refund')
  AND `other_order`.`id` <> `single_order`.`id`
LEFT JOIN `commission_records` AS `other_legacy`
  ON `other_legacy`.`travel_group_id` = `legacy`.`travel_group_id`
  AND `other_legacy`.`target_user_id` = `legacy`.`target_user_id`
  AND `other_legacy`.`target_type` = 'taster_commission'
  AND `other_legacy`.`manual_input` = TRUE
  AND `other_legacy`.`sales_order_id` IS NULL
  AND `other_legacy`.`id` <> `legacy`.`id`
LEFT JOIN `commission_records` AS `existing_order_record`
  ON `existing_order_record`.`sales_order_id` = `single_order`.`id`
  AND `existing_order_record`.`target_type` = 'taster_commission'
  AND `existing_order_record`.`target_user_id` = `legacy`.`target_user_id`
  AND `existing_order_record`.`manual_input` = TRUE
SET `legacy`.`sales_order_id` = `single_order`.`id`
WHERE `legacy`.`sales_order_id` IS NULL
  AND `legacy`.`target_type` = 'taster_commission'
  AND `legacy`.`manual_input` = TRUE
  AND `other_order`.`id` IS NULL
  AND `other_legacy`.`id` IS NULL
  AND `existing_order_record`.`id` IS NULL;

-- This fails safely when the read-only preflight report finds duplicates.
-- No historical commission row is deleted, merged, or amount-adjusted.
CREATE UNIQUE INDEX `commission_records_order_target_user_manual_key`
  ON `commission_records`(
    `sales_order_id`,
    `target_type`,
    `target_user_id`,
    `manual_input`
  );
