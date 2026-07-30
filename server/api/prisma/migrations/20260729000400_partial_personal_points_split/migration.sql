-- This migration must be deployed after all existing migrations through
-- 20260729000300_travel_group_not_entered_confirmation. In particular,
-- 20260727000100_guide_personal_points must already have created
-- sales_orders.points_destination.

ALTER TABLE `sales_orders`
  ADD COLUMN `personal_amount_cents` INTEGER NOT NULL DEFAULT 0
    AFTER `points_destination`;

ALTER TABLE `after_sales_orders`
  ADD COLUMN `personal_points_refund_amount_cents` INTEGER NOT NULL DEFAULT 0
    AFTER `refund_amount_cents`;

-- Historical whole-order personal records remain whole-order personal.
-- Every other historical order starts with a zero personal allocation.
UPDATE `sales_orders`
SET `personal_amount_cents` =
  CASE
    WHEN `points_destination` = 'guide_personal'
      THEN `total_amount_cents`
    ELSE 0
  END;

-- Preserve the old whole-personal points result: refunds already attached
-- to historical whole-personal orders belong to that personal portion.
UPDATE `after_sales_orders` AS `after_sales`
INNER JOIN `sales_orders` AS `source_order`
  ON `source_order`.`id` = `after_sales`.`sales_order_id`
SET `after_sales`.`personal_points_refund_amount_cents` =
  CASE
    WHEN `source_order`.`personal_amount_cents` > 0
      THEN `after_sales`.`refund_amount_cents`
    ELSE 0
  END;

CREATE INDEX `sales_orders_personal_amount_cents_idx`
  ON `sales_orders` (`personal_amount_cents`);

CREATE INDEX `sales_orders_travel_group_personal_amount_idx`
  ON `sales_orders` (`travel_group_id`, `personal_amount_cents`);

CREATE INDEX `after_sales_orders_personal_refund_idx`
  ON `after_sales_orders`
    (`sales_order_id`, `finance_confirmed`, `personal_points_refund_amount_cents`);

ALTER TABLE `sales_orders`
  ADD CONSTRAINT `sales_orders_personal_amount_bounds_chk`
    CHECK (
      `personal_amount_cents` >= 0
      AND `personal_amount_cents` <= `total_amount_cents`
    ),
  ADD CONSTRAINT `sales_orders_points_destination_amount_chk`
    CHECK (
      (`personal_amount_cents` = 0
        AND `points_destination` = 'travel_agency')
      OR
      (`personal_amount_cents` > 0
        AND `points_destination` = 'guide_personal')
    );

ALTER TABLE `after_sales_orders`
  ADD CONSTRAINT `after_sales_orders_personal_refund_bounds_chk`
    CHECK (
      `personal_points_refund_amount_cents` >= 0
      AND `personal_points_refund_amount_cents` <= `refund_amount_cents`
    );
