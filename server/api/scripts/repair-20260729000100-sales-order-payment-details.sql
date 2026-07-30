-- Completes the production migration that stopped after creating and
-- backfilling payment tables but before adding foreign keys.
--
-- Preconditions:
--   1. Back up the database.
--   2. Confirm all orphan-count preflight queries return zero.
--   3. Confirm none of the constraints below already exists.
--
-- After this script succeeds, mark
-- 20260729000100_sales_order_payment_details as applied with
-- `npx prisma migrate resolve --applied`.

ALTER TABLE `payment_methods`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE `sales_order_payment_details`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE `sales_order_payment_details`
  ADD CONSTRAINT `sales_order_payment_details_sales_order_id_fkey`
    FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `sales_order_payment_details_payment_method_id_fkey`
    FOREIGN KEY (`payment_method_id`) REFERENCES `payment_methods`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `sales_order_payment_details_collection_confirmed_by_id_fkey`
    FOREIGN KEY (`collection_confirmed_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `payment_methods`
  ADD CONSTRAINT `payment_methods_created_by_id_fkey`
    FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `payment_methods_updated_by_id_fkey`
    FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `sales_orders`
  ADD CONSTRAINT `sales_orders_completed_by_id_fkey`
    FOREIGN KEY (`completed_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `sales_orders_payment_details_locked_by_id_fkey`
    FOREIGN KEY (`payment_details_locked_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `sales_orders_payment_details_unlocked_by_id_fkey`
    FOREIGN KEY (`payment_details_unlocked_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
