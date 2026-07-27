-- Phase 11 inbound and batch-cost flow (expand only).
--
-- This migration adds only nullable metadata/guard columns. It does not
-- create warehouses, inventory configuration, opening balances, batches,
-- documents, movements, or cost values, and performs no historical backfill.
-- Existing posted inventory facts therefore remain readable by the old
-- application while the new application can enforce one opening entry per
-- warehouse/product through a server-generated non-null key.
-- Rehearse this ALTER on an isolated MySQL copy at the target version:
-- even additive ALTER TABLE statements can wait for or hold a metadata lock.

ALTER TABLE `inventory_documents`
  ADD COLUMN `attachment_metadata` JSON NULL AFTER `reason`;

ALTER TABLE `inventory_batches`
  ADD COLUMN `opening_entry_key` VARCHAR(191) NULL
    AFTER `source_line_key`,
  ADD CONSTRAINT `inventory_batches_opening_entry_key_not_blank_check`
    CHECK (
      `opening_entry_key` IS NULL
      OR CHAR_LENGTH(TRIM(`opening_entry_key`)) > 0
    ),
  ADD UNIQUE INDEX `inventory_batches_opening_entry_key`
    (`opening_entry_key`);

-- A nullable unique key is deliberate: MySQL permits many NULL values, while
-- every new opening batch writes the fixed normalized
-- "opening:<warehouseId>:<productId>" key. Purchase order and production
-- batch strings remain nullable and intentionally non-unique because one
-- business reference may be received in multiple independently idempotent
-- source lines.
