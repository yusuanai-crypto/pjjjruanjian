CREATE TABLE `payment_methods` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `category` ENUM('direct_receipt', 'collect_on_delivery') NOT NULL DEFAULT 'direct_receipt',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `created_by_id` CHAR(36) NULL,
    `updated_by_id` CHAR(36) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `payment_methods_code_key`(`code`),
    UNIQUE INDEX `payment_methods_name_key`(`name`),
    INDEX `payment_methods_is_active_sort_order_idx`(`is_active`, `sort_order`),
    INDEX `payment_methods_is_default_idx`(`is_default`),
    INDEX `payment_methods_created_by_id_idx`(`created_by_id`),
    INDEX `payment_methods_updated_by_id_idx`(`updated_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `payment_methods`
    (`id`, `code`, `name`, `category`, `is_active`, `sort_order`, `is_default`, `created_at`, `updated_at`)
VALUES
    ('00000000-0000-4000-8000-000000000001', 'shouqianba', '收钱吧', 'direct_receipt', true, 10, true, CURRENT_TIMESTAMP(0), CURRENT_TIMESTAMP(0)),
    ('00000000-0000-4000-8000-000000000002', 'boc_pos', '中行POS机', 'direct_receipt', true, 20, false, CURRENT_TIMESTAMP(0), CURRENT_TIMESTAMP(0)),
    ('00000000-0000-4000-8000-000000000003', 'ceb_pos', '光大POS机', 'direct_receipt', true, 30, false, CURRENT_TIMESTAMP(0), CURRENT_TIMESTAMP(0)),
    ('00000000-0000-4000-8000-000000000004', 'cash', '现金', 'direct_receipt', true, 40, false, CURRENT_TIMESTAMP(0), CURRENT_TIMESTAMP(0)),
    ('00000000-0000-4000-8000-000000000005', 'cash_on_delivery', '货到付款', 'collect_on_delivery', true, 50, false, CURRENT_TIMESTAMP(0), CURRENT_TIMESTAMP(0)),
    ('00000000-0000-4000-8000-000000000006', 'bank_transfer', '转账', 'direct_receipt', true, 60, false, CURRENT_TIMESTAMP(0), CURRENT_TIMESTAMP(0));

ALTER TABLE `sales_orders`
    ADD COLUMN `completed_at` DATETIME(0) NULL,
    ADD COLUMN `completed_by_id` CHAR(36) NULL,
    ADD COLUMN `payment_details_locked` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `payment_details_locked_at` DATETIME(0) NULL,
    ADD COLUMN `payment_details_locked_by_id` CHAR(36) NULL,
    ADD COLUMN `payment_details_unlocked_at` DATETIME(0) NULL,
    ADD COLUMN `payment_details_unlocked_by_id` CHAR(36) NULL;

CREATE INDEX `sales_orders_completed_at_idx` ON `sales_orders`(`completed_at`);
CREATE INDEX `sales_orders_completed_by_id_idx` ON `sales_orders`(`completed_by_id`);
CREATE INDEX `sales_orders_payment_details_lock_idx` ON `sales_orders`(`payment_details_locked`, `payment_details_locked_at`);
CREATE INDEX `sales_orders_payment_details_locked_by_id_idx` ON `sales_orders`(`payment_details_locked_by_id`);
CREATE INDEX `sales_orders_payment_details_unlocked_by_id_idx` ON `sales_orders`(`payment_details_unlocked_by_id`);

CREATE TABLE `sales_order_payment_details` (
    `id` CHAR(36) NOT NULL,
    `sales_order_id` CHAR(36) NOT NULL,
    `payment_method_id` CHAR(36) NOT NULL,
    `payment_method_name_snapshot` VARCHAR(80) NOT NULL,
    `payment_method_category_snapshot` ENUM('direct_receipt', 'collect_on_delivery') NOT NULL,
    `amount_cents` INTEGER NOT NULL,
    `collection_confirmed` BOOLEAN NOT NULL DEFAULT false,
    `collection_confirmed_at` DATETIME(0) NULL,
    `collection_confirmed_by_id` CHAR(36) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `sales_order_payment_details_sales_order_id_sort_order_idx`(`sales_order_id`, `sort_order`),
    INDEX `sales_order_payment_details_payment_method_id_idx`(`payment_method_id`),
    INDEX `sales_order_payment_details_collection_confirmation_idx`(`payment_method_category_snapshot`, `collection_confirmed`),
    INDEX `sales_order_payment_details_collection_confirmed_by_id_idx`(`collection_confirmed_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `sales_order_payment_details`
    (`id`, `sales_order_id`, `payment_method_id`, `payment_method_name_snapshot`, `payment_method_category_snapshot`, `amount_cents`, `sort_order`, `created_at`, `updated_at`)
SELECT
    UUID(),
    `id`,
    '00000000-0000-4000-8000-000000000001',
    '收钱吧',
    'direct_receipt',
    `total_amount_cents` - `cash_on_delivery_amount_cents`,
    10,
    `created_at`,
    `updated_at`
FROM `sales_orders`;

INSERT INTO `sales_order_payment_details`
    (`id`, `sales_order_id`, `payment_method_id`, `payment_method_name_snapshot`, `payment_method_category_snapshot`, `amount_cents`, `sort_order`, `created_at`, `updated_at`)
SELECT
    UUID(),
    `id`,
    '00000000-0000-4000-8000-000000000005',
    '货到付款',
    'collect_on_delivery',
    `cash_on_delivery_amount_cents`,
    20,
    `created_at`,
    `updated_at`
FROM `sales_orders`
WHERE `cash_on_delivery_amount_cents` <> 0;

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
