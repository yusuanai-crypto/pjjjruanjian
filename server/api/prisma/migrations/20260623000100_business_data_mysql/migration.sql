CREATE TABLE `travel_groups` (
  `id` CHAR(36) NOT NULL,
  `group_no` VARCHAR(80) NOT NULL,
  `visit_date` DATE NOT NULL,
  `travel_agency` VARCHAR(120) NULL,
  `license_plate` VARCHAR(40) NULL,
  `guide_name` VARCHAR(80) NULL,
  `guide_phone` VARCHAR(30) NULL,
  `guest_count` INTEGER NOT NULL DEFAULT 0,
  `tasting_room_no` VARCHAR(40) NULL,
  `taster_name` VARCHAR(80) NULL,
  `arrival_time` VARCHAR(30) NULL,
  `group_type` VARCHAR(60) NULL,
  `wine_details` TEXT NULL,
  `departure_time` VARCHAR(30) NULL,
  `remarks` TEXT NULL,
  `status` ENUM('unmarked', 'pending_summary', 'ordered') NOT NULL DEFAULT 'unmarked',
  `sales_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `paid_deposit_cents` INTEGER NOT NULL DEFAULT 0,
  `cash_on_delivery_cents` INTEGER NOT NULL DEFAULT 0,
  `liquor_cost_deduction_cents` INTEGER NOT NULL DEFAULT 0,
  `order_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `points` INTEGER NOT NULL DEFAULT 0,
  `returned_points` INTEGER NOT NULL DEFAULT 0,
  `unreturned_points` INTEGER NOT NULL DEFAULT 0,
  `guide_info_sent` BOOLEAN NOT NULL DEFAULT false,
  `travel_agency_info_sent` BOOLEAN NOT NULL DEFAULT false,
  `created_by_id` CHAR(36) NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  UNIQUE INDEX `travel_groups_group_no_key`(`group_no`),
  INDEX `travel_groups_visit_date_idx`(`visit_date`),
  INDEX `travel_groups_travel_agency_idx`(`travel_agency`),
  INDEX `travel_groups_guide_name_idx`(`guide_name`),
  INDEX `travel_groups_taster_name_idx`(`taster_name`),
  INDEX `travel_groups_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `guide_carried_groups` (
  `id` CHAR(36) NOT NULL,
  `group_no` VARCHAR(80) NOT NULL,
  `visit_date` DATE NOT NULL,
  `travel_agency` VARCHAR(120) NULL,
  `license_plate` VARCHAR(40) NULL,
  `guide_name` VARCHAR(80) NULL,
  `guide_phone` VARCHAR(30) NULL,
  `guest_count` INTEGER NOT NULL DEFAULT 0,
  `tasting_room_no` VARCHAR(40) NULL,
  `taster_name` VARCHAR(80) NULL,
  `arrival_time` VARCHAR(30) NULL,
  `group_type` VARCHAR(60) NULL,
  `wine_details` TEXT NULL,
  `departure_time` VARCHAR(30) NULL,
  `remarks` TEXT NULL,
  `status` ENUM('unmarked', 'pending_summary', 'ordered') NOT NULL DEFAULT 'unmarked',
  `sales_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `paid_deposit_cents` INTEGER NOT NULL DEFAULT 0,
  `cash_on_delivery_cents` INTEGER NOT NULL DEFAULT 0,
  `liquor_cost_deduction_cents` INTEGER NOT NULL DEFAULT 0,
  `order_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `points` INTEGER NOT NULL DEFAULT 0,
  `returned_points` INTEGER NOT NULL DEFAULT 0,
  `unreturned_points` INTEGER NOT NULL DEFAULT 0,
  `guide_info_sent` BOOLEAN NOT NULL DEFAULT false,
  `travel_agency_info_sent` BOOLEAN NOT NULL DEFAULT false,
  `created_by_id` CHAR(36) NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  UNIQUE INDEX `guide_carried_groups_group_no_key`(`group_no`),
  INDEX `guide_carried_groups_visit_date_idx`(`visit_date`),
  INDEX `guide_carried_groups_travel_agency_idx`(`travel_agency`),
  INDEX `guide_carried_groups_guide_name_idx`(`guide_name`),
  INDEX `guide_carried_groups_taster_name_idx`(`taster_name`),
  INDEX `guide_carried_groups_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `pending_travel_groups` (
  `id` CHAR(36) NOT NULL,
  `group_no` VARCHAR(80) NOT NULL,
  `visit_date` DATE NOT NULL,
  `travel_agency` VARCHAR(120) NULL,
  `license_plate` VARCHAR(40) NULL,
  `guide_name` VARCHAR(80) NULL,
  `guide_phone` VARCHAR(30) NULL,
  `guest_count` INTEGER NOT NULL DEFAULT 0,
  `tasting_room_no` VARCHAR(40) NULL,
  `taster_name` VARCHAR(80) NULL,
  `arrival_time` VARCHAR(30) NULL,
  `group_type` VARCHAR(60) NULL,
  `wine_details` TEXT NULL,
  `departure_time` VARCHAR(30) NULL,
  `remarks` TEXT NULL,
  `status` ENUM('unmarked', 'pending_summary', 'ordered') NOT NULL DEFAULT 'unmarked',
  `sales_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `paid_deposit_cents` INTEGER NOT NULL DEFAULT 0,
  `cash_on_delivery_cents` INTEGER NOT NULL DEFAULT 0,
  `liquor_cost_deduction_cents` INTEGER NOT NULL DEFAULT 0,
  `order_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `points` INTEGER NOT NULL DEFAULT 0,
  `returned_points` INTEGER NOT NULL DEFAULT 0,
  `unreturned_points` INTEGER NOT NULL DEFAULT 0,
  `guide_info_sent` BOOLEAN NOT NULL DEFAULT false,
  `travel_agency_info_sent` BOOLEAN NOT NULL DEFAULT false,
  `created_by_id` CHAR(36) NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  UNIQUE INDEX `pending_travel_groups_group_no_key`(`group_no`),
  INDEX `pending_travel_groups_visit_date_idx`(`visit_date`),
  INDEX `pending_travel_groups_travel_agency_idx`(`travel_agency`),
  INDEX `pending_travel_groups_guide_name_idx`(`guide_name`),
  INDEX `pending_travel_groups_taster_name_idx`(`taster_name`),
  INDEX `pending_travel_groups_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `sales_orders` (
  `id` CHAR(36) NOT NULL,
  `order_no` VARCHAR(80) NOT NULL,
  `order_type` ENUM('travel_group', 'buyback', 'external', 'internal', 'after_sales') NOT NULL DEFAULT 'travel_group',
  `travel_group_id` CHAR(36) NULL,
  `customer_name` VARCHAR(100) NOT NULL,
  `customer_phone` VARCHAR(30) NULL,
  `province` VARCHAR(60) NULL,
  `city` VARCHAR(60) NULL,
  `district` VARCHAR(60) NULL,
  `address` VARCHAR(255) NULL,
  `order_date` DATE NOT NULL,
  `total_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `cash_on_delivery_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `remark` TEXT NULL,
  `status` ENUM('valid', 'partial_refund', 'refunded', 'cancelled') NOT NULL DEFAULT 'valid',
  `created_by_id` CHAR(36) NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  UNIQUE INDEX `sales_orders_order_no_key`(`order_no`),
  INDEX `sales_orders_travel_group_id_idx`(`travel_group_id`),
  INDEX `sales_orders_order_type_idx`(`order_type`),
  INDEX `sales_orders_order_date_idx`(`order_date`),
  INDEX `sales_orders_customer_phone_idx`(`customer_phone`),
  INDEX `sales_orders_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `sales_order_items` (
  `id` CHAR(36) NOT NULL,
  `sales_order_id` CHAR(36) NOT NULL,
  `product_name` VARCHAR(160) NOT NULL,
  `quantity` INTEGER NOT NULL DEFAULT 1,
  `unit_price_cents` INTEGER NOT NULL DEFAULT 0,
  `delivery_type` ENUM('self_pickup', 'shipping') NOT NULL DEFAULT 'shipping',
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

  INDEX `sales_order_items_sales_order_id_idx`(`sales_order_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `daily_reconciliations` (
  `id` CHAR(36) NOT NULL,
  `business_date` DATE NOT NULL,
  `travel_group_sales_cents` INTEGER NOT NULL DEFAULT 0,
  `back_office_sales_cents` INTEGER NOT NULL DEFAULT 0,
  `buyback_cents` INTEGER NOT NULL DEFAULT 0,
  `external_sales_cents` INTEGER NOT NULL DEFAULT 0,
  `internal_purchase_cents` INTEGER NOT NULL DEFAULT 0,
  `after_sales_cents` INTEGER NOT NULL DEFAULT 0,
  `refunds_cents` INTEGER NOT NULL DEFAULT 0,
  `other_receivable_cents` INTEGER NOT NULL DEFAULT 0,
  `notes` TEXT NULL,
  `created_by_id` CHAR(36) NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  UNIQUE INDEX `daily_reconciliations_business_date_key`(`business_date`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `reconciliation_payment_methods` (
  `id` CHAR(36) NOT NULL,
  `reconciliation_id` CHAR(36) NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `amount_cents` INTEGER NOT NULL DEFAULT 0,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

  INDEX `reconciliation_payment_methods_reconciliation_id_idx`(`reconciliation_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `strike_bonus_awards` (
  `id` CHAR(36) NOT NULL,
  `bonus_date` DATE NOT NULL,
  `travel_agency` VARCHAR(120) NULL,
  `guide_name` VARCHAR(80) NULL,
  `taster_name` VARCHAR(80) NULL,
  `room_no` VARCHAR(40) NULL,
  `sales_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `bonus_amount_cents` INTEGER NOT NULL DEFAULT 0,
  `taster_paid_date` DATE NULL,
  `sales_paid_date` DATE NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  INDEX `strike_bonus_awards_bonus_date_idx`(`bonus_date`),
  INDEX `strike_bonus_awards_travel_agency_idx`(`travel_agency`),
  INDEX `strike_bonus_awards_guide_name_idx`(`guide_name`),
  INDEX `strike_bonus_awards_taster_name_idx`(`taster_name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE `sales_orders`
  ADD CONSTRAINT `sales_orders_travel_group_id_fkey`
  FOREIGN KEY (`travel_group_id`) REFERENCES `travel_groups`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `sales_order_items`
  ADD CONSTRAINT `sales_order_items_sales_order_id_fkey`
  FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `reconciliation_payment_methods`
  ADD CONSTRAINT `reconciliation_payment_methods_reconciliation_id_fkey`
  FOREIGN KEY (`reconciliation_id`) REFERENCES `daily_reconciliations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
