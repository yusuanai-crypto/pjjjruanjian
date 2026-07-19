ALTER TABLE `travel_group_finance_summaries`
  ADD COLUMN `total_cash_on_delivery_cents` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `total_paid_deposit_cents` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `daily_rebate_paid` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `daily_rebate_paid_by_id` CHAR(36) NULL,
  ADD COLUMN `daily_rebate_paid_at` DATETIME(0) NULL,
  ADD COLUMN `monthly_rebate_paid` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `monthly_rebate_paid_by_id` CHAR(36) NULL,
  ADD COLUMN `monthly_rebate_paid_at` DATETIME(0) NULL;

UPDATE `travel_group_finance_summaries`
SET
  `daily_rebate_paid` =
    CASE
      WHEN `total_daily_rebate_cents` > 0
       AND `paid_rebate_cents` >= `total_daily_rebate_cents`
      THEN true
      ELSE false
    END,
  `monthly_rebate_paid` =
    CASE
      WHEN `total_monthly_rebate_cents` > 0
       AND `paid_rebate_cents` >= (`total_daily_rebate_cents` + `total_monthly_rebate_cents`)
      THEN true
      ELSE false
    END;

UPDATE `travel_group_finance_summaries`
SET
  `paid_rebate_cents` =
    CASE WHEN `daily_rebate_paid` THEN `total_daily_rebate_cents` ELSE 0 END +
    CASE WHEN `monthly_rebate_paid` THEN `total_monthly_rebate_cents` ELSE 0 END,
  `unpaid_rebate_cents` =
    CASE WHEN `daily_rebate_paid` THEN 0 ELSE `total_daily_rebate_cents` END +
    CASE WHEN `monthly_rebate_paid` THEN 0 ELSE `total_monthly_rebate_cents` END;

CREATE INDEX `travel_group_finance_summaries_daily_rebate_paid_idx`
  ON `travel_group_finance_summaries`(`daily_rebate_paid`);

CREATE INDEX `tg_fin_summaries_daily_paid_by_id_idx`
  ON `travel_group_finance_summaries`(`daily_rebate_paid_by_id`);

CREATE INDEX `travel_group_finance_summaries_monthly_rebate_paid_idx`
  ON `travel_group_finance_summaries`(`monthly_rebate_paid`);

CREATE INDEX `tg_fin_summaries_monthly_paid_by_id_idx`
  ON `travel_group_finance_summaries`(`monthly_rebate_paid_by_id`);

ALTER TABLE `travel_group_finance_summaries`
  ADD CONSTRAINT `tg_fin_summaries_daily_paid_by_id_fkey`
  FOREIGN KEY (`daily_rebate_paid_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `tg_fin_summaries_monthly_paid_by_id_fkey`
  FOREIGN KEY (`monthly_rebate_paid_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
