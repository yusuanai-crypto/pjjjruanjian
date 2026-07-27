-- Phase 11 step 08 expand migration.
-- ALLOCATED remains in serialized_inventory_status; historical rows are not rewritten here.

CREATE TABLE `serialized_inventory_assignments` (
  `id` CHAR(36) NOT NULL,
  `reservation_id` CHAR(36) NOT NULL,
  `serialized_unit_id` CHAR(36) NOT NULL,
  `status` ENUM('reserved', 'outbound', 'released') NOT NULL DEFAULT 'reserved',
  `source_key` VARCHAR(191) NOT NULL,
  `active_unit_key` CHAR(36) NULL,
  `purchase_cost_snapshot_cents` INTEGER NULL,
  `reserved_by_id` CHAR(36) NULL,
  `reserved_by_name_snapshot` VARCHAR(100) NULL,
  `reserved_by_role_snapshot` VARCHAR(32) NULL,
  `reserved_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `outbound_by_id` CHAR(36) NULL,
  `outbound_by_name_snapshot` VARCHAR(100) NULL,
  `outbound_by_role_snapshot` VARCHAR(32) NULL,
  `outbound_at` DATETIME(0) NULL,
  `released_by_id` CHAR(36) NULL,
  `released_by_name_snapshot` VARCHAR(100) NULL,
  `released_by_role_snapshot` VARCHAR(32) NULL,
  `released_at` DATETIME(0) NULL,
  `release_reason` VARCHAR(500) NULL,
  `version` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),

  CONSTRAINT `serialized_inventory_assignments_pkey` PRIMARY KEY (`id`),
  CONSTRAINT `serialized_inventory_assignments_source_key` UNIQUE (`source_key`),
  CONSTRAINT `serialized_inventory_assignments_active_unit_key` UNIQUE (`active_unit_key`),
  CONSTRAINT `serialized_inventory_assignments_cost_nonnegative`
    CHECK (`purchase_cost_snapshot_cents` IS NULL OR `purchase_cost_snapshot_cents` >= 0),
  CONSTRAINT `serialized_inventory_assignments_version_nonnegative`
    CHECK (`version` >= 0),
  CONSTRAINT `serialized_inventory_assignments_active_key_consistent`
    CHECK (
      (`status` = 'reserved' AND `active_unit_key` = `serialized_unit_id`)
      OR (`status` IN ('outbound', 'released') AND `active_unit_key` IS NULL)
    ),
  INDEX `serialized_inventory_assignments_reservation_status_idx`
    (`reservation_id`, `status`, `reserved_at`),
  INDEX `serialized_inventory_assignments_unit_status_idx`
    (`serialized_unit_id`, `status`, `reserved_at`),
  INDEX `serialized_inventory_assignments_reserved_by_id_idx` (`reserved_by_id`),
  INDEX `serialized_inventory_assignments_outbound_by_id_idx` (`outbound_by_id`),
  INDEX `serialized_inventory_assignments_released_by_id_idx` (`released_by_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `serialized_inventory_assignments`
  ADD CONSTRAINT `serialized_inventory_assignments_reservation_id_fkey`
    FOREIGN KEY (`reservation_id`) REFERENCES `inventory_reservations`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `serialized_inventory_assignments_serialized_unit_id_fkey`
    FOREIGN KEY (`serialized_unit_id`) REFERENCES `serialized_inventory_units`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `serialized_inventory_assignments_reserved_by_id_fkey`
    FOREIGN KEY (`reserved_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `serialized_inventory_assignments_outbound_by_id_fkey`
    FOREIGN KEY (`outbound_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `serialized_inventory_assignments_released_by_id_fkey`
    FOREIGN KEY (`released_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `inventory_transfer_receipt_lines`
  ADD COLUMN `serialized_unit_ids` JSON NULL AFTER `difference_qty`;

-- A per-unit RESERVED/RELEASED state transition does not change the aggregate
-- reservation twice: the quantity reservation movement already owns that delta.
ALTER TABLE `inventory_movements`
  DROP CHECK `inventory_movements_nonzero_delta_check`,
  ADD CONSTRAINT `inventory_movements_nonzero_delta_check`
    CHECK (
      `on_hand_delta` <> 0
      OR `reserved_delta` <> 0
      OR `unavailable_delta` <> 0
      OR `in_transit_delta` <> 0
      OR (
        `serialized_unit_id` IS NOT NULL
        AND `reservation_id` IS NOT NULL
        AND `movement_type` IN ('reserve', 'release')
      )
    );
