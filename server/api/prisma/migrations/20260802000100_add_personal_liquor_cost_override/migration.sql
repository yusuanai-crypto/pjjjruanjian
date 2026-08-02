ALTER TABLE `sales_orders`
  ADD COLUMN `personal_liquor_cost_deduction_override_cents` INTEGER NULL;

ALTER TABLE `sales_orders`
  ADD CONSTRAINT `sales_orders_personal_liquor_override_nonnegative_chk`
  CHECK (
    `personal_liquor_cost_deduction_override_cents` IS NULL
    OR `personal_liquor_cost_deduction_override_cents` >= 0
  );
