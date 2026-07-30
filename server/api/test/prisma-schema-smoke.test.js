const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const prismaDir = path.resolve(__dirname, '..', 'prisma');
const migrationsDir = path.join(prismaDir, 'migrations');

function readPrismaFile(relativePath) {
  return fs.readFileSync(path.join(prismaDir, relativePath), 'utf8');
}

function readMigration(name) {
  return fs.readFileSync(
    path.join(migrationsDir, name, 'migration.sql'),
    'utf8',
  );
}

function readAllMigrationSql() {
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readMigration(entry.name))
    .join('\n');
}

function extractPrismaBlock(source, header) {
  const start = source.indexOf(header);
  assert.notEqual(start, -1, `${header} should exist in Prisma schema`);
  const end = source.indexOf('\n}', start);
  assert.notEqual(end, -1, `${header} should have a closing brace`);
  return source.slice(start, end + 2);
}

function assertBlockHasFields(block, fields) {
  for (const field of fields) {
    assert.match(block, new RegExp(`\\b${field}\\b`));
  }
}

test('smoke: phase 11 inventory foundation is expand-only and database-enforced', () => {
  const schema = readPrismaFile('schema.prisma');
  const migration = readMigration(
    '20260727000300_inventory_expand_foundation',
  );

  for (const model of [
    'Warehouse',
    'InventoryConfiguration',
    'WarehouseProductStock',
    'InventoryBatch',
    'InventoryDocument',
    'InventoryDocumentLine',
    'InventoryMovement',
    'InventoryCommandReceipt',
    'InventoryReservation',
    'InventoryTransfer',
    'InventoryTransferLine',
    'InventoryTransferReceipt',
    'InventoryTransferReceiptLine',
    'StockAlertConfig',
    'ProductInventoryModeChange',
  ]) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
  }

  const trackingMode = extractPrismaBlock(
    schema,
    'enum InventoryTrackingMode {',
  );
  for (const value of ['NONE', 'QUANTITY', 'SERIALIZED']) {
    assert.match(trackingMode, new RegExp(`\\b${value}\\b`));
  }

  const serializedStatus = extractPrismaBlock(
    schema,
    'enum SerializedInventoryStatus {',
  );
  for (const value of [
    'PENDING_COST',
    'AVAILABLE',
    'ALLOCATED',
    'RESERVED',
    'OUTBOUND',
    'UNAVAILABLE',
    'VOID',
  ]) {
    assert.match(serializedStatus, new RegExp(`\\b${value}\\b`));
  }

  const warehouse = extractPrismaBlock(schema, 'model Warehouse {');
  assertBlockHasFields(warehouse, [
    'normalizedCode',
    'normalizedName',
    'managerUserId',
    'isActive',
    'isDefault',
    'activeDefaultKey',
  ]);
  assert.match(
    warehouse,
    /activeDefaultKey\s+String\?\s+@unique\(map: "warehouses_active_default_key_key"\)/,
  );

  const stock = extractPrismaBlock(
    schema,
    'model WarehouseProductStock {',
  );
  assertBlockHasFields(stock, [
    'onHandQty',
    'reservedQty',
    'unavailableQty',
    'inTransitQty',
    'version',
    'lastMovementId',
  ]);

  const batch = extractPrismaBlock(schema, 'model InventoryBatch {');
  assertBlockHasFields(batch, [
    'sourceDocumentLineId',
    'sourceLineKey',
    'purchaseOrderNo',
    'productionBatch',
    'purchaseUnitCostCents',
    'costStatus',
    'fifoAt',
    'version',
  ]);

  const movement = extractPrismaBlock(schema, 'model InventoryMovement {');
  assert.match(
    movement,
    /sourceKey\s+String\s+@unique\(map: "inventory_movements_source_key"\)/,
  );
  assertBlockHasFields(movement, [
    'onHandDelta',
    'reservedDelta',
    'unavailableDelta',
    'inTransitDelta',
    'reversalOfMovementId',
    'operatorNameSnapshot',
    'operatorRoleSnapshot',
  ]);

  const receipt = extractPrismaBlock(
    schema,
    'model InventoryCommandReceipt {',
  );
  assertBlockHasFields(receipt, [
    'sourceKey',
    'idempotencyKey',
    'requestHash',
    'commandType',
    'resultDocumentId',
    'actorNameSnapshot',
  ]);

  const salesOrder = extractPrismaBlock(schema, 'model SalesOrder {');
  assertBlockHasFields(salesOrder, [
    'fulfillmentWarehouseId',
    'inventoryAppliedAt',
    'inventoryPolicyVersion',
    'inventoryVersion',
    'inventoryReservations',
  ]);
  const salesOrderItem = extractPrismaBlock(
    schema,
    'model SalesOrderItem {',
  );
  assert.match(
    salesOrderItem,
    /inventoryLineKey\s+String\?\s+@unique\(map: "sales_order_items_inventory_line_key"\)/,
  );

  const serializedUnit = extractPrismaBlock(
    schema,
    'model SerializedInventoryUnit {',
  );
  assertBlockHasFields(serializedUnit, [
    'warehouseId',
    'inventoryBatchId',
    'version',
    'inventoryMovements',
  ]);

  for (const table of [
    'warehouses',
    'inventory_configurations',
    'warehouse_product_stocks',
    'inventory_batches',
    'inventory_documents',
    'inventory_document_lines',
    'inventory_movements',
    'inventory_command_receipts',
    'inventory_reservations',
    'inventory_transfers',
    'inventory_transfer_lines',
    'inventory_transfer_receipts',
    'inventory_transfer_receipt_lines',
    'stock_alert_configs',
    'product_inventory_mode_changes',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE \`${table}\``));
  }

  assert.match(
    migration,
    /ENUM\('none', 'serialized', 'quantity'\)[\s\S]*NOT NULL DEFAULT 'none'/,
  );
  for (const databaseValue of [
    "'pending_cost'",
    "'available'",
    "'allocated'",
    "'void'",
    "'reserved'",
    "'outbound'",
    "'unavailable'",
  ]) {
    assert.match(migration, new RegExp(databaseValue));
  }
  assert.match(
    migration,
    /'pending_cost',\s*'available',\s*'allocated',\s*'void',\s*'reserved',\s*'outbound',\s*'unavailable'/,
  );
  for (const check of [
    'warehouses_active_default_key_check',
    'warehouse_product_stocks_quantity_check',
    'inventory_batches_quantity_check',
    'inventory_movements_source_key_not_blank_check',
    'inventory_movements_nonzero_delta_check',
    'inventory_command_receipts_idempotency_key_not_blank_check',
    'inventory_reservations_line_key_not_blank_check',
    'inventory_transfers_distinct_warehouses_check',
  ]) {
    assert.match(migration, new RegExp(`CONSTRAINT \`${check}\`\\s+CHECK`));
  }
  assert.match(
    migration,
    /UNIQUE INDEX `warehouses_active_default_key_key` \(`active_default_key`\)/,
  );
  for (const uniqueIndex of [
    'warehouse_product_stocks_warehouse_product_key',
    'inventory_batches_source_line_key',
    'inventory_documents_source_key',
    'inventory_movements_source_key',
    'inventory_command_receipts_source_key',
    'inventory_command_receipts_idempotency_key',
    'inventory_reservations_source_key',
    'inventory_reservations_order_line_key',
    'inventory_transfers_source_key',
    'inventory_transfer_receipts_source_key',
    'inventory_transfer_receipts_idempotency_key',
    'stock_alert_configs_warehouse_product_key',
    'sales_order_items_inventory_line_key',
  ]) {
    assert.match(migration, new RegExp(`UNIQUE INDEX \`${uniqueIndex}\``));
  }
  assert.match(
    migration,
    /`source_key` VARCHAR\(191\) NOT NULL[\s\S]*UNIQUE INDEX `inventory_movements_source_key` \(`source_key`\)/,
  );
  assert.match(
    migration,
    /inventory_movements_no_update[\s\S]*INVENTORY_MOVEMENT_IMMUTABLE/,
  );
  assert.match(
    migration,
    /inventory_movements_no_delete[\s\S]*INVENTORY_MOVEMENT_IMMUTABLE/,
  );
  assert.match(
    migration,
    /sales_orders_fulfillment_warehouse_id_fkey[\s\S]*ON DELETE RESTRICT/,
  );
  assert.match(
    migration,
    /inventory_movements_operator_user_id_fkey[\s\S]*ON DELETE SET NULL/,
  );
  for (const foreignKey of [
    'warehouse_product_stocks_warehouse_id_fkey',
    'warehouse_product_stocks_product_id_fkey',
    'inventory_batches_source_document_line_id_fkey',
    'inventory_document_lines_document_id_fkey',
    'inventory_movements_document_line_id_fkey',
    'inventory_movements_serialized_unit_id_fkey',
    'inventory_reservations_sales_order_id_fkey',
    'inventory_reservations_sales_order_item_id_fkey',
    'inventory_transfers_from_warehouse_id_fkey',
    'inventory_transfer_receipts_transfer_id_fkey',
    'inventory_transfer_receipt_lines_transfer_line_id_fkey',
    'serialized_inventory_units_warehouse_id_fkey',
    'serialized_inventory_units_inventory_batch_id_fkey',
  ]) {
    assert.match(migration, new RegExp(`CONSTRAINT \`${foreignKey}\``));
  }
  assert.doesNotMatch(migration, /ON DELETE CASCADE/);
  assert.match(
    migration,
    /ADD COLUMN `fulfillment_warehouse_id` CHAR\(36\) NULL/,
  );
  assert.match(
    migration,
    /ADD COLUMN `inventory_line_key` VARCHAR\(191\) NULL/,
  );
  assert.match(
    migration,
    /ADD COLUMN `warehouse_id` CHAR\(36\) NULL[\s\S]*ADD COLUMN `inventory_batch_id` CHAR\(36\) NULL/,
  );
  assert.match(migration, /metadata locks/i);
  assert.doesNotMatch(
    migration,
    /\bINSERT\s+INTO\b|\bUPDATE\s+`?(products|sales_orders|sales_order_items|serialized_inventory_units)`?\b/i,
  );
});

test('smoke: serialized inventory unification is additive, keeps ALLOCATED and enforces one active assignment per bottle', () => {
  const schema = readPrismaFile('schema.prisma');
  const migration = readMigration(
    '20260727000800_serialized_inventory_unification',
  );
  const statuses = extractPrismaBlock(
    schema,
    'enum SerializedInventoryStatus {',
  );
  const assignmentStatuses = extractPrismaBlock(
    schema,
    'enum SerializedInventoryAssignmentStatus {',
  );
  const assignment = extractPrismaBlock(
    schema,
    'model SerializedInventoryAssignment {',
  );
  const receiptLine = extractPrismaBlock(
    schema,
    'model InventoryTransferReceiptLine {',
  );

  assert.match(statuses, /\bALLOCATED\b/);
  for (const value of ['RESERVED', 'OUTBOUND', 'RELEASED']) {
    assert.match(assignmentStatuses, new RegExp(`\\b${value}\\b`));
  }
  assertBlockHasFields(assignment, [
    'reservationId',
    'serializedUnitId',
    'sourceKey',
    'activeUnitKey',
    'purchaseCostSnapshotCents',
    'reservedAt',
    'outboundAt',
    'releasedAt',
    'version',
  ]);
  assert.match(
    assignment,
    /activeUnitKey\s+String\?\s+@unique\(map: "serialized_inventory_assignments_active_unit_key"\)/,
  );
  assertBlockHasFields(receiptLine, ['serializedUnitIds']);
  assert.match(
    migration,
    /CREATE TABLE `serialized_inventory_assignments`/,
  );
  assert.match(
    migration,
    /CONSTRAINT `serialized_inventory_assignments_active_key_consistent`\s+CHECK/,
  );
  assert.match(
    migration,
    /UNIQUE \(`active_unit_key`\)/,
  );
  assert.match(
    migration,
    /ADD COLUMN `serialized_unit_ids` JSON NULL/,
  );
  assert.match(
    migration,
    /DROP CHECK `inventory_movements_nonzero_delta_check`/,
  );
  assert.doesNotMatch(
    migration,
    /UPDATE\s+`?serialized_inventory_units`?/i,
  );
  assert.doesNotMatch(
    migration,
    /DROP\s+(COLUMN|TABLE).*allocated/i,
  );
});

test('smoke: after-sales physical receipts are expand-only, concurrency-safe and never inferred from historical finance fields', () => {
  const schema = readPrismaFile('schema.prisma');
  const migration = readMigration(
    '20260727000900_after_sales_receipts',
  );
  const status = extractPrismaBlock(
    schema,
    'enum AfterSalesReceiptStatus {',
  );
  const condition = extractPrismaBlock(
    schema,
    'enum AfterSalesReceiptCondition {',
  );
  const matchStatus = extractPrismaBlock(
    schema,
    'enum AfterSalesReceiptSerializedMatchStatus {',
  );
  const item = extractPrismaBlock(
    schema,
    'model AfterSalesOrderItem {',
  );
  const receipt = extractPrismaBlock(
    schema,
    'model AfterSalesReceipt {',
  );
  const line = extractPrismaBlock(
    schema,
    'model AfterSalesReceiptLine {',
  );
  const serializedFact = extractPrismaBlock(
    schema,
    'model AfterSalesReceiptSerializedUnit {',
  );

  for (const value of ['DRAFT', 'POSTED', 'REVERSED']) {
    assert.match(status, new RegExp(`\\b${value}\\b`));
  }
  for (const value of ['SALEABLE', 'UNAVAILABLE', 'EXCEPTION']) {
    assert.match(condition, new RegExp(`\\b${value}\\b`));
  }
  for (const value of ['MATCHED', 'UNKNOWN', 'CONFLICT']) {
    assert.match(matchStatus, new RegExp(`\\b${value}\\b`));
  }
  assertBlockHasFields(item, [
    'returnRequired',
    'expectedReturnQty',
    'postedReceivedQty',
    'returnVersion',
    'receiptLines',
  ]);
  assertBlockHasFields(receipt, [
    'afterSalesOrderId',
    'warehouseId',
    'sourceKey',
    'idempotencyKey',
    'requestHash',
    'postSourceKey',
    'postIdempotencyKey',
    'postRequestHash',
    'reverseSourceKey',
    'reverseIdempotencyKey',
    'reverseRequestHash',
    'confirmedByNameSnapshot',
    'reversedByNameSnapshot',
    'version',
  ]);
  assertBlockHasFields(line, [
    'afterSalesOrderItemId',
    'lineNo',
    'receivedQty',
    'condition',
    'inventoryBatchId',
    'exceptionReason',
  ]);
  assert.match(
    line,
    /@@unique\(\[receiptId, lineNo\], map: "after_sales_receipt_lines_receipt_line_key"\)/,
  );
  assertBlockHasFields(serializedFact, [
    'originalSerializedUnitId',
    'scannedLogisticsCodeSnapshot',
    'normalizedScannedLogisticsCode',
    'matchStatus',
    'activeOriginalUnitKey',
    'previousWarehouseId',
    'previousStatus',
    'inventoryMovementId',
  ]);
  assert.match(
    serializedFact,
    /activeOriginalUnitKey\s+String\?\s+@unique\(map: "after_sales_receipt_serialized_active_unit_key"\)/,
  );

  assert.match(
    migration,
    /ADD COLUMN `return_required` BOOLEAN NOT NULL DEFAULT false/,
  );
  assert.match(
    migration,
    /ADD COLUMN `expected_return_qty` INTEGER NOT NULL DEFAULT 0/,
  );
  assert.match(
    migration,
    /ADD COLUMN `posted_received_qty` INTEGER NOT NULL DEFAULT 0/,
  );
  for (const table of [
    'after_sales_receipts',
    'after_sales_receipt_lines',
    'after_sales_receipt_serialized_units',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE \`${table}\``));
  }
  for (const constraint of [
    'after_sales_order_items_return_quantity_check',
    'after_sales_order_items_return_version_check',
    'after_sales_receipts_source_key_not_blank',
    'after_sales_receipts_idempotency_key_not_blank',
    'after_sales_receipts_request_hash_check',
    'after_sales_receipts_post_envelope_check',
    'after_sales_receipts_reverse_envelope_check',
    'after_sales_receipts_status_audit_check',
    'after_sales_receipt_lines_quantity_check',
    'after_sales_receipt_lines_exception_check',
    'after_sales_receipt_serialized_scan_not_blank',
    'after_sales_receipt_serialized_match_check',
    'after_sales_receipt_serialized_active_key_check',
  ]) {
    assert.match(
      migration,
      new RegExp(`CONSTRAINT \`${constraint}\`\\s+CHECK`),
    );
  }
  assert.match(
    migration,
    /CONSTRAINT `after_sales_receipt_lines_receipt_line_key`[\s\S]*UNIQUE \(`receipt_id`, `line_no`\)/,
  );
  assert.match(
    migration,
    /CONSTRAINT `after_sales_receipt_serialized_active_unit_key`[\s\S]*UNIQUE \(`active_original_unit_key`\)/,
  );
  assert.match(
    migration,
    /after_sales_receipts_after_sales_order_id_fkey[\s\S]*ON DELETE RESTRICT/,
  );
  assert.match(
    migration,
    /after_sales_receipts_confirmed_by_id_fkey[\s\S]*ON DELETE SET NULL/,
  );
  assert.doesNotMatch(migration, /ON DELETE CASCADE/);
  assert.doesNotMatch(
    migration,
    /\bINSERT\s+INTO\b|\bUPDATE\s+`?(after_sales_orders|after_sales_order_items|inventory_movements|warehouse_product_stocks|serialized_inventory_units)`?\b/i,
  );
});

test('smoke: stocktakes enforce one active warehouse-product count and immutable adjustment envelopes', () => {
  const schema = readPrismaFile('schema.prisma');
  const migration = readMigration(
    '20260727001000_inventory_stocktakes',
  );
  const status = extractPrismaBlock(
    schema,
    'enum StocktakeStatus {',
  );
  const matchStatus = extractPrismaBlock(
    schema,
    'enum StocktakeSerializedMatchStatus {',
  );
  const stocktake = extractPrismaBlock(schema, 'model Stocktake {');
  const line = extractPrismaBlock(schema, 'model StocktakeLine {');
  const scan = extractPrismaBlock(
    schema,
    'model StocktakeSerializedScan {',
  );

  for (const value of [
    'DRAFT',
    'SUBMITTED',
    'APPROVED',
    'REJECTED',
    'POSTED',
    'REVERSED',
  ]) {
    assert.match(status, new RegExp(`\\b${value}\\b`));
  }
  for (const value of ['MATCHED', 'MISSING', 'UNKNOWN', 'CONFLICT']) {
    assert.match(matchStatus, new RegExp(`\\b${value}\\b`));
  }
  assertBlockHasFields(stocktake, [
    'warehouseId',
    'productId',
    'trackingModeSnapshot',
    'activeKey',
    'sourceKey',
    'idempotencyKey',
    'requestHash',
    'submitIdempotencyKey',
    'approveIdempotencyKey',
    'rejectIdempotencyKey',
    'reverseIdempotencyKey',
    'quantityDocumentId',
    'unavailableDocumentId',
    'submittedAt',
    'approvedAt',
    'postedAt',
    'reversedAt',
    'version',
  ]);
  assert.match(
    stocktake,
    /activeKey\s+String\?\s+@unique\(map: "stocktakes_active_key_key"\)/,
  );
  assertBlockHasFields(line, [
    'snapshotStockVersion',
    'snapshotLastMovementId',
    'snapshotOnHandQty',
    'snapshotUnavailableQty',
    'countedOnHandQty',
    'countedUnavailableQty',
    'onHandDifferenceQty',
    'unavailableDifferenceQty',
  ]);
  assertBlockHasFields(scan, [
    'serializedUnitId',
    'scannedLogisticsCodeSnapshot',
    'normalizedLogisticsCodeSnapshot',
    'matchStatus',
    'expectedUnitStatus',
    'expectedUnitVersion',
    'countedCondition',
    'actionMovementId',
  ]);
  assert.match(
    scan,
    /@@unique\(\[stocktakeId, normalizedLogisticsCodeSnapshot\], map: "stocktake_serialized_scans_stocktake_code_key"\)/,
  );

  for (const table of [
    'stocktakes',
    'stocktake_lines',
    'stocktake_serialized_scans',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE \`${table}\``));
  }
  for (const constraint of [
    'stocktakes_create_envelope_check',
    'stocktakes_submit_envelope_check',
    'stocktakes_approve_envelope_check',
    'stocktakes_reject_envelope_check',
    'stocktakes_reverse_envelope_check',
    'stocktakes_active_key_check',
    'stocktakes_status_audit_check',
    'stocktake_lines_values_check',
    'stocktake_serialized_scans_values_check',
  ]) {
    assert.match(
      migration,
      new RegExp(`CONSTRAINT \`${constraint}\`\\s+CHECK`),
    );
  }
  assert.match(
    migration,
    /CONSTRAINT `stocktakes_active_key_key` UNIQUE \(`active_key`\)/,
  );
  assert.match(
    migration,
    /stocktakes_warehouse_id_fkey[\s\S]*ON DELETE RESTRICT/,
  );
  assert.match(
    migration,
    /stocktakes_submitted_by_id_fkey[\s\S]*ON DELETE SET NULL/,
  );
  assert.doesNotMatch(migration, /ON DELETE CASCADE/);
  assert.doesNotMatch(
    migration,
    /\bINSERT\s+INTO\b|\bUPDATE\s+`?(stocktakes|inventory_movements|warehouse_product_stocks|serialized_inventory_units)`?\b/i,
  );
});

test('smoke: phase 11 accounting core adds reservation traceability and a durable post-commit queue', () => {
  const schema = readPrismaFile('schema.prisma');
  const migration = readMigration(
    '20260727000400_inventory_accounting_core',
  );
  const documentType = extractPrismaBlock(
    schema,
    'enum InventoryDocumentType {',
  );
  const movement = extractPrismaBlock(
    schema,
    'model InventoryMovement {',
  );
  const postCommitTask = extractPrismaBlock(
    schema,
    'model InventoryPostCommitTask {',
  );

  assert.match(documentType, /\bRESERVATION_ADJUSTMENT\b/);
  assertBlockHasFields(movement, [
    'reservationId',
    'reservation',
  ]);
  assertBlockHasFields(postCommitTask, [
    'sourceKey',
    'commandReceiptId',
    'taskType',
    'payload',
    'status',
    'attempts',
    'nextAttemptAt',
    'lastErrorCode',
  ]);
  assert.match(
    migration,
    /CREATE TABLE `inventory_post_commit_tasks`/,
  );
  assert.match(
    migration,
    /CONSTRAINT `inventory_post_commit_tasks_source_key_not_blank_check`\s+CHECK/,
  );
  assert.match(
    migration,
    /UNIQUE INDEX `inventory_post_commit_tasks_source_key`/,
  );
  assert.match(
    migration,
    /CONSTRAINT `inventory_movements_reservation_id_fkey`[\s\S]*ON DELETE RESTRICT/,
  );
  assert.match(
    migration,
    /CONSTRAINT `inventory_post_commit_tasks_command_receipt_id_fkey`[\s\S]*ON DELETE RESTRICT/,
  );
  assert.match(migration, /metadata lock/i);
  assert.doesNotMatch(
    migration,
    /\bINSERT\s+INTO\b|\bUPDATE\s+`?(products|sales_orders|sales_order_items|serialized_inventory_units|inventory_movements|warehouse_product_stocks)`?\b/i,
  );
  assert.doesNotMatch(migration, /ON DELETE CASCADE/);
});

test('smoke: phase 11 inbound-cost flow is additive and has a database opening guard', () => {
  const schema = readPrismaFile('schema.prisma');
  const migration = readMigration(
    '20260727000500_inventory_inbound_cost_flow',
  );
  const batch = extractPrismaBlock(schema, 'model InventoryBatch {');
  const document = extractPrismaBlock(
    schema,
    'model InventoryDocument {',
  );

  assert.match(
    batch,
    /openingEntryKey\s+String\?\s+@unique\(map: "inventory_batches_opening_entry_key"\)/,
  );
  assert.match(
    document,
    /attachmentMetadata\s+Json\?\s+@map\("attachment_metadata"\)/,
  );
  assert.match(
    migration,
    /ADD COLUMN `attachment_metadata` JSON NULL/,
  );
  assert.match(
    migration,
    /ADD COLUMN `opening_entry_key` VARCHAR\(191\) NULL/,
  );
  assert.match(
    migration,
    /CONSTRAINT `inventory_batches_opening_entry_key_not_blank_check`\s+CHECK/,
  );
  assert.match(
    migration,
    /UNIQUE INDEX `inventory_batches_opening_entry_key`/,
  );
  assert.match(migration, /metadata lock/i);
  assert.doesNotMatch(
    migration,
    /\bINSERT\s+INTO\b|\bUPDATE\b|\bDELETE\s+FROM\b/i,
  );
  assert.doesNotMatch(
    migration,
    /UNIQUE INDEX[^\n]*(purchase_order_no|production_batch)/i,
  );
});

test('smoke: phase 11 transfer flow adds immutable receipt envelopes and explicit difference facts without backfill', () => {
  const schema = readPrismaFile('schema.prisma');
  const migration = readMigration(
    '20260727000600_inventory_transfer_unavailable_flow',
  );
  const documentType = extractPrismaBlock(
    schema,
    'enum InventoryDocumentType {',
  );
  const movementType = extractPrismaBlock(
    schema,
    'enum InventoryMovementType {',
  );
  const transfer = extractPrismaBlock(
    schema,
    'model InventoryTransfer {',
  );
  const transferLine = extractPrismaBlock(
    schema,
    'model InventoryTransferLine {',
  );
  const transferReceipt = extractPrismaBlock(
    schema,
    'model InventoryTransferReceipt {',
  );

  assert.match(documentType, /\bTRANSFER_DIFFERENCE\b/);
  assert.match(movementType, /\bTRANSFER_DIFFERENCE\b/);
  assertBlockHasFields(transfer, [
    'outboundSourceKey',
    'outboundIdempotencyKey',
    'outboundRequestHash',
    'version',
  ]);
  assertBlockHasFields(transferLine, [
    'sourceLineKey',
    'trackingModeSnapshot',
    'unavailableQty',
    'serializedUnitIds',
    'version',
  ]);
  assertBlockHasFields(transferReceipt, [
    'sourceKey',
    'idempotencyKey',
    'requestHash',
    'confirmedByNameSnapshot',
    'confirmedAt',
    'reversalOfReceiptId',
    'version',
  ]);
  for (const constraint of [
    'inventory_transfers_outbound_envelope_check',
    'inventory_transfers_version_check',
    'inventory_transfer_lines_source_line_key_check',
    'inventory_transfer_lines_flow_quantity_check',
    'inventory_transfer_receipts_version_check',
    'inventory_transfer_receipt_lines_difference_check',
  ]) {
    assert.match(
      migration,
      new RegExp(`CONSTRAINT \`${constraint}\`\\s+CHECK`),
    );
  }
  for (const uniqueIndex of [
    'inventory_transfers_outbound_source_key',
    'inventory_transfers_outbound_idempotency_key',
    'inventory_transfer_lines_source_line_key',
  ]) {
    assert.match(
      migration,
      new RegExp(`UNIQUE INDEX \`${uniqueIndex}\``),
    );
  }
  assert.match(
    migration,
    /`outbound_request_hash` REGEXP '\^\[0-9a-f\]\{64\}\$'/,
  );
  assert.match(
    migration,
    /`unavailable_qty` <= `received_qty`[\s\S]*`received_qty` \+ `difference_qty` <= `outbound_qty`/,
  );
  assert.match(migration, /metadata locks/i);
  assert.doesNotMatch(
    migration,
    /\bINSERT\s+INTO\b|\bUPDATE\b|\bDELETE\s+FROM\b|\bTRUNCATE\b/i,
  );
});

test('smoke: sales order packing mark migration is non-null and defaults historical rows to false', () => {
  const migration = readMigration(
    '20260726000200_sales_order_packing_mark',
  );
  assert.match(
    migration,
    /ADD COLUMN `has_packing_mark` BOOLEAN NOT NULL DEFAULT false/,
  );
});

test('smoke: independent after-sales order schema and idempotent historical backfill are present', () => {
  const schema = readPrismaFile('schema.prisma');
  const migration = readMigration(
    '20260727000200_after_sales_independent_orders',
  );
  const salesOrder = extractPrismaBlock(schema, 'model SalesOrder {');
  const afterSalesOrder = extractPrismaBlock(schema, 'model AfterSalesOrder {');
  const afterSalesItem = extractPrismaBlock(
    schema,
    'model AfterSalesOrderItem {',
  );

  assertBlockHasFields(salesOrder, [
    'sourceSalesOrderId',
    'sourceSalesOrder',
    'afterSalesSalesOrders',
  ]);
  assertBlockHasFields(afterSalesOrder, [
    'afterSalesSalesOrderId',
    'deductionCalculationMode',
    'sourceAgencyDeductionCents',
    'agencyDeductionAdjustmentCents',
    'financialEffectStatus',
    'items',
  ]);
  assertBlockHasFields(afterSalesItem, [
    'sourceSalesOrderItemId',
    'productName',
    'quantity',
    'originalUnitPriceCents',
    'subtotalCents',
    'isHistoricalPlaceholder',
  ]);
  assert.match(schema, /enum AfterSalesFinancialEffectStatus \{/);
  assert.match(
    migration,
    /WHERE aso\.`after_sales_sales_order_id` IS NULL[\s\S]*generated_order\.`id` IS NULL/,
  );
  assert.match(
    migration,
    /WHERE NOT EXISTS \([\s\S]*`after_sales_order_items`/,
  );
  assert.match(migration, /'历史售后调整'/);
  assert.match(migration, /'after_sales'/);
});

test('smoke: Prisma schema exposes phase 2 business models and scope fields', () => {
  const schema = readPrismaFile('schema.prisma');

  for (const model of [
    'TravelAgency',
    'Guide',
    'TravelGroup',
    'TravelGroupTastingItem',
    'GuideCarriedGroup',
    'PendingTravelGroup',
    'Customer',
    'SalesOrder',
    'SalesOrderItem',
    'AfterSalesOrder',
    'DailyReconciliation',
    'ReconciliationPaymentMethod',
    'StrikeBonusAward',
  ]) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
  }

  for (const field of [
    'tasterId',
    'salesUserId',
    'financeMark',
    'markedById',
    'markedAt',
    'refundsCents',
    'guideId',
    'tasterSummary',
    'tasterSummaryAt',
    'postMarkEditedAt',
    'postMarkEditedById',
    'customerId',
    'salesFormNo',
    'logisticsMethod',
    'packingStatus',
    'packageCount',
    'warehouseRemark',
    'logisticsNo',
    'logisticsFeeCents',
    'invoiceRequired',
    'invoiceIssued',
    'financeRemark',
    'subtotalCents',
    'notes',
    'sortOrder',
    'qrCodeTokenHash',
    'qrCodeGeneratedAt',
    'qrCodeExpiresAt',
    'qrCodeRevokedAt',
    'afterSalesNo',
    'issueType',
    'actionType',
    'refundAmountCents',
    'financeConfirmed',
    'financeConfirmedById',
    'financeConfirmedAt',
    'handledById',
    'handledAt',
    'completedAt',
  ]) {
    assert.match(schema, new RegExp(`\\b${field}\\b`));
  }

  assert.match(
    schema,
    /qrCodeTokenHash\s+String\?\s+@unique\s+@map\("qr_code_token_hash"\)\s+@db\.Char\(64\)/,
  );
  assert.match(
    schema,
    /qrCodeGeneratedAt\s+DateTime\?\s+@map\("qr_code_generated_at"\)\s+@db\.DateTime\(0\)/,
  );
  assert.match(
    schema,
    /qrCodeExpiresAt\s+DateTime\?\s+@map\("qr_code_expires_at"\)\s+@db\.DateTime\(0\)/,
  );
  assert.match(
    schema,
    /qrCodeRevokedAt\s+DateTime\?\s+@map\("qr_code_revoked_at"\)\s+@db\.DateTime\(0\)/,
  );
  assert.match(schema, /@@index\(\[qrCodeExpiresAt\]\)/);

  assert.match(schema, /enum SalesOrderPackingStatus \{/);
  assert.match(schema, /enum AfterSalesIssueType \{/);
  assert.match(schema, /enum AfterSalesActionType \{/);
  assert.match(schema, /enum AfterSalesStatus \{/);
  assert.match(
    schema,
    /afterSalesNo\s+String\s+@unique\s+@map\("after_sales_no"\)\s+@db\.VarChar\(80\)/,
  );
  assert.match(
    schema,
    /salesOrder\s+SalesOrder\s+@relation\("AfterSalesSourceOrder", fields: \[salesOrderId\], references: \[id\], onDelete: Restrict\)/,
  );
  for (const index of [
    'salesOrderId',
    'customerId',
    'status',
    'issueType',
    'actionType',
    'financeConfirmed',
    'createdAt',
    'handledById',
  ]) {
    assert.match(schema, new RegExp(`@@index\\(\\[${index}\\]\\)`));
  }
  assert.match(schema, /@@index\(\[status, createdAt\]\)/);
  assert.match(schema, /@@index\(\[financeConfirmed, createdAt\]\)/);
  assert.doesNotMatch(
    schema,
    /\b(shippedAt|shippedById|shipped_at|shipped_by_id)\b/,
  );
});

test('smoke: sales order payment details are snapshot-based, signed, and independently locked', () => {
  const schema = readPrismaFile('schema.prisma');
  const migration = readMigration(
    '20260729000100_sales_order_payment_details',
  );

  assert.match(
    schema,
    /enum PaymentMethodCategory[\s\S]*DIRECT_RECEIPT[\s\S]*COLLECT_ON_DELIVERY/,
  );
  assert.match(schema, /model PaymentMethod[\s\S]*code\s+String[\s\S]*isActive\s+Boolean[\s\S]*isDefault\s+Boolean/);
  assert.match(schema, /model SalesOrderPaymentDetail[\s\S]*paymentMethodNameSnapshot\s+String[\s\S]*paymentMethodCategorySnapshot\s+PaymentMethodCategory[\s\S]*amountCents\s+Int/);
  assert.match(schema, /completedAt\s+DateTime\?/);
  assert.match(schema, /paymentDetailsLocked\s+Boolean\s+@default\(false\)/);
  assert.match(schema, /paymentDetailsLockedAt\s+DateTime\?/);
  assert.match(schema, /paymentDetailsUnlockedAt\s+DateTime\?/);
  assert.doesNotMatch(
    schema.match(/enum SalesOrderStatus \{[\s\S]*?\n\}/)?.[0] || '',
    /COMPLETED/,
  );

  for (const name of [
    '收钱吧',
    '中行POS机',
    '光大POS机',
    '现金',
    '货到付款',
    '转账',
  ]) {
    assert.match(migration, new RegExp(name));
  }
  assert.match(migration, /'收钱吧', 'direct_receipt', true, 10, true/);
  assert.match(migration, /'货到付款', 'collect_on_delivery'/);
  assert.match(migration, /`total_amount_cents` - `cash_on_delivery_amount_cents`/);
  assert.match(migration, /`collection_confirmed` BOOLEAN NOT NULL DEFAULT false/);
  assert.match(migration, /ON DELETE RESTRICT/);
  assert.doesNotMatch(migration, /UNSIGNED/i);
});

test('smoke: phase 2 Prisma migrations create and evolve business tables', () => {
  assert.equal(
    fs.existsSync(
      path.join(
        migrationsDir,
        '20260623000100_business_data_mysql',
        'migration.sql',
      ),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(migrationsDir, '20260629000300_add_customers', 'migration.sql'),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        migrationsDir,
        '20260629000400_sales_order_phase4_schema',
        'migration.sql',
      ),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        migrationsDir,
        '20260701000100_sales_order_qr_code_fields',
        'migration.sql',
      ),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        migrationsDir,
        '20260702000100_after_sales_orders',
        'migration.sql',
      ),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        migrationsDir,
        '20260717000200_after_sales_warehouse_refund_proofs',
        'migration.sql',
      ),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        migrationsDir,
        '20260624000100_business_data_role_scopes',
        'migration.sql',
      ),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        migrationsDir,
        '20260624000200_business_data_finance_marks',
        'migration.sql',
      ),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(migrationsDir, '20260627000100_add_guides', 'migration.sql'),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        migrationsDir,
        '20260627000200_travel_group_phase3_schema',
        'migration.sql',
      ),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        migrationsDir,
        '20260629000100_add_travel_agencies',
        'migration.sql',
      ),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        migrationsDir,
        '20260629000200_make_guide_travel_agency_optional',
        'migration.sql',
      ),
    ),
    true,
  );

  const businessDataMigration = readMigration(
    '20260623000100_business_data_mysql',
  );
  for (const table of [
    'travel_groups',
    'guide_carried_groups',
    'pending_travel_groups',
    'sales_orders',
    'sales_order_items',
    'daily_reconciliations',
    'reconciliation_payment_methods',
    'strike_bonus_awards',
  ]) {
    assert.match(
      businessDataMigration,
      new RegExp(`CREATE TABLE \`${table}\``),
    );
  }

  const roleScopesMigration = readMigration(
    '20260624000100_business_data_role_scopes',
  );
  assert.match(roleScopesMigration, /ADD COLUMN `taster_id`/);
  assert.match(roleScopesMigration, /ADD COLUMN `sales_user_id`/);
  assert.match(roleScopesMigration, /sales_orders_sales_user_id_fkey/);

  const financeMarksMigration = readMigration(
    '20260624000200_business_data_finance_marks',
  );
  assert.match(financeMarksMigration, /ADD COLUMN `finance_mark`/);
  assert.match(financeMarksMigration, /ADD COLUMN `marked_by`/);
  assert.match(financeMarksMigration, /ADD COLUMN `marked_at`/);
  assert.match(financeMarksMigration, /sales_orders_marked_by_fkey/);

  const guidesMigration = readMigration('20260627000100_add_guides');
  assert.match(guidesMigration, /CREATE TABLE `guides`/);
  assert.match(guidesMigration, /UNIQUE INDEX `guides_phone_key`/);
  assert.match(guidesMigration, /INDEX `guides_name_idx`/);
  assert.match(guidesMigration, /INDEX `guides_travel_agency_idx`/);
  assert.match(guidesMigration, /INDEX `guides_is_active_idx`/);

  const phase3SchemaMigration = readMigration(
    '20260627000200_travel_group_phase3_schema',
  );
  assert.match(phase3SchemaMigration, /ADD COLUMN `guide_id`/);
  assert.match(phase3SchemaMigration, /ADD COLUMN `taster_summary`/);
  assert.match(phase3SchemaMigration, /ADD COLUMN `taster_summary_at`/);
  assert.match(phase3SchemaMigration, /ADD COLUMN `post_mark_edited_at`/);
  assert.match(phase3SchemaMigration, /ADD COLUMN `post_mark_edited_by_id`/);
  assert.match(
    phase3SchemaMigration,
    /CREATE TABLE `travel_group_tasting_items`/,
  );
  assert.match(phase3SchemaMigration, /travel_groups_guide_id_fkey/);
  assert.match(
    phase3SchemaMigration,
    /travel_group_tasting_items_travel_group_id_fkey/,
  );

  const travelAgenciesMigration = readMigration(
    '20260629000100_add_travel_agencies',
  );
  assert.match(travelAgenciesMigration, /CREATE TABLE `travel_agencies`/);
  assert.match(travelAgenciesMigration, /`contact_name` VARCHAR\(80\) NULL/);
  assert.match(travelAgenciesMigration, /`contact_phone` VARCHAR\(30\) NULL/);
  assert.match(
    travelAgenciesMigration,
    /UNIQUE INDEX `travel_agencies_name_key`/,
  );
  assert.match(
    travelAgenciesMigration,
    /INDEX `travel_agencies_contact_phone_idx`/,
  );

  const guideAgencyOptionalMigration = readMigration(
    '20260629000200_make_guide_travel_agency_optional',
  );
  assert.match(
    guideAgencyOptionalMigration,
    /MODIFY `travel_agency` VARCHAR\(120\) NULL/,
  );

  const guideAgencyRemovalMigration = readMigration(
    '20260725000400_drop_guide_travel_agency',
  );
  assert.match(
    guideAgencyRemovalMigration,
    /DROP INDEX `guides_travel_agency_idx` ON `guides`/,
  );
  assert.match(
    guideAgencyRemovalMigration,
    /ALTER TABLE `guides`\s+DROP COLUMN `travel_agency`/,
  );
  assert.doesNotMatch(
    guideAgencyRemovalMigration,
    /travel_groups|guide_carried_groups|pending_travel_groups/,
  );

  const customersMigration = readMigration('20260629000300_add_customers');
  assert.match(customersMigration, /CREATE TABLE `customers`/);
  assert.match(customersMigration, /`phone` VARCHAR\(30\) NULL/);
  assert.match(customersMigration, /INDEX `customers_name_idx`/);
  assert.match(customersMigration, /INDEX `customers_phone_idx`/);
  assert.match(customersMigration, /INDEX `customers_finance_mark_idx`/);
  assert.match(customersMigration, /INDEX `customers_created_by_id_idx`/);
  assert.match(customersMigration, /INDEX `customers_updated_at_idx`/);
  assert.doesNotMatch(customersMigration, /UNIQUE INDEX `customers_phone/);
  assert.match(customersMigration, /customers_marked_by_fkey/);

  const salesOrderPhase4Migration = readMigration(
    '20260629000400_sales_order_phase4_schema',
  );
  assert.match(salesOrderPhase4Migration, /ADD COLUMN `customer_id`/);
  assert.match(salesOrderPhase4Migration, /ADD COLUMN `sales_form_no`/);
  assert.match(salesOrderPhase4Migration, /ADD COLUMN `packing_status`/);
  assert.match(salesOrderPhase4Migration, /DEFAULT 'packed'/);
  assert.match(salesOrderPhase4Migration, /ADD COLUMN `logistics_no`/);
  assert.match(salesOrderPhase4Migration, /ADD COLUMN `invoice_required`/);
  assert.match(salesOrderPhase4Migration, /ADD COLUMN `finance_remark`/);
  assert.match(salesOrderPhase4Migration, /ADD COLUMN `subtotal_cents`/);
  assert.match(salesOrderPhase4Migration, /ADD COLUMN `notes`/);
  assert.match(salesOrderPhase4Migration, /ADD COLUMN `sort_order`/);
  assert.match(
    salesOrderPhase4Migration,
    /`subtotal_cents` = `quantity` \* `unit_price_cents`/,
  );
  assert.match(salesOrderPhase4Migration, /`packing_status` = 'pending'/);
  assert.match(salesOrderPhase4Migration, /sales_orders_customer_id_idx/);
  assert.match(salesOrderPhase4Migration, /sales_orders_packing_status_idx/);
  assert.match(salesOrderPhase4Migration, /sales_orders_logistics_no_idx/);
  assert.match(
    salesOrderPhase4Migration,
    /sales_order_items_sales_order_id_sort_order_idx/,
  );
  assert.match(salesOrderPhase4Migration, /sales_orders_customer_id_fkey/);

  const salesOrderQrCodeMigration = readMigration(
    '20260701000100_sales_order_qr_code_fields',
  );
  assert.match(
    salesOrderQrCodeMigration,
    /ADD COLUMN `qr_code_token` VARCHAR\(80\) NULL/,
  );
  assert.match(
    salesOrderQrCodeMigration,
    /ADD COLUMN `qr_code_generated_at` DATETIME\(0\) NULL/,
  );
  assert.match(
    salesOrderQrCodeMigration,
    /ADD COLUMN `qr_code_expires_at` DATETIME\(0\) NULL/,
  );
  assert.doesNotMatch(
    salesOrderQrCodeMigration,
    /`qr_code_token` VARCHAR\(80\) NOT NULL/,
  );
  assert.match(
    salesOrderQrCodeMigration,
    /UNIQUE INDEX `sales_orders_qr_code_token_key`/,
  );
  assert.match(
    salesOrderQrCodeMigration,
    /INDEX `sales_orders_qr_code_expires_at_idx`/,
  );

  const securePublicSalesSheetMigration = readMigration(
    '20260720000300_public_sales_sheet_capabilities',
  );
  assert.match(
    securePublicSalesSheetMigration,
    /ADD COLUMN `qr_code_token_hash` CHAR\(64\) NULL/,
  );
  assert.match(
    securePublicSalesSheetMigration,
    /ADD COLUMN `qr_code_revoked_at` DATETIME\(0\) NULL/,
  );
  assert.match(securePublicSalesSheetMigration, /SHA2\(`qr_code_token`, 256\)/);
  assert.match(
    securePublicSalesSheetMigration,
    /DROP COLUMN `qr_code_token`/,
  );
  assert.match(
    securePublicSalesSheetMigration,
    /sales_orders_qr_code_token_hash_key/,
  );

  const afterSalesOrdersMigration = readMigration(
    '20260702000100_after_sales_orders',
  );
  assert.match(
    afterSalesOrdersMigration,
    /CREATE TABLE `after_sales_orders`/,
  );
  assert.match(
    afterSalesOrdersMigration,
    /UNIQUE INDEX `after_sales_orders_after_sales_no_key`/,
  );
  for (const indexName of [
    'after_sales_orders_sales_order_id_idx',
    'after_sales_orders_customer_id_idx',
    'after_sales_orders_status_idx',
    'after_sales_orders_issue_type_idx',
    'after_sales_orders_action_type_idx',
    'after_sales_orders_finance_confirmed_idx',
    'after_sales_orders_created_at_idx',
    'after_sales_orders_handled_by_id_idx',
    'after_sales_orders_status_created_at_idx',
    'after_sales_orders_finance_confirmed_created_at_idx',
  ]) {
    assert.match(afterSalesOrdersMigration, new RegExp(indexName));
  }
  assert.match(
    afterSalesOrdersMigration,
    /after_sales_orders_sales_order_id_fkey/,
  );
  assert.match(
    afterSalesOrdersMigration,
    /FOREIGN KEY \(`sales_order_id`\) REFERENCES `sales_orders`\(`id`\) ON DELETE RESTRICT ON UPDATE CASCADE/,
  );
  assert.match(
    afterSalesOrdersMigration,
    /after_sales_orders_customer_id_fkey/,
  );
  assert.match(
    afterSalesOrdersMigration,
    /after_sales_orders_finance_confirmed_by_id_fkey/,
  );
  assert.match(
    afterSalesOrdersMigration,
    /after_sales_orders_handled_by_id_fkey/,
  );
  assert.match(
    afterSalesOrdersMigration,
    /after_sales_orders_created_by_id_fkey/,
  );
  assert.match(
    afterSalesOrdersMigration,
    /after_sales_orders_updated_by_id_fkey/,
  );
  const afterSalesProofMigration = readMigration(
    '20260717000200_after_sales_warehouse_refund_proofs',
  );
  for (const columnName of [
    'warehouse_confirmed_by_id',
    'warehouse_confirmed_at',
    'warehouse_confirm_note',
    'refund_proof_attachments',
  ]) {
    assert.match(afterSalesProofMigration, new RegExp(columnName));
  }
  for (const indexName of [
    'after_sales_orders_warehouse_confirmed_by_id_idx',
    'after_sales_orders_warehouse_confirmed_at_idx',
    'after_sales_orders_status_warehouse_confirmed_at_idx',
  ]) {
    assert.match(afterSalesProofMigration, new RegExp(indexName));
  }
  assert.match(
    afterSalesProofMigration,
    /after_sales_orders_warehouse_confirmed_by_id_fkey/,
  );
  assert.doesNotMatch(readAllMigrationSql(), /shipped_at|shipped_by_id/i);
});

test('smoke: Prisma schema exposes stage 7 commission models, enums, and relations', () => {
  const schema = readPrismaFile('schema.prisma');

  for (const model of [
    'AgencyDeductionRule',
    'AgencyRebateRule',
    'SalesDeductionRule',
    'CommissionRule',
    'CommissionRecord',
    'TravelGroupFinanceSummary',
  ]) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
  }

  const commissionRuleTargetType = extractPrismaBlock(
    schema,
    'enum CommissionRuleTargetType {',
  );
  for (const enumValue of [
    'SALES_COMMISSION    @map("sales_commission")',
    'OUTREACH_COMMISSION @map("outreach_commission")',
    'LEADER_COMMISSION   @map("leader_commission")',
    '@@map("commission_rule_target_type")',
  ]) {
    assert.match(commissionRuleTargetType, new RegExp(escapeRegExp(enumValue)));
  }

  const commissionTargetType = extractPrismaBlock(
    schema,
    'enum CommissionTargetType {',
  );
  for (const enumValue of [
    'SALES_COMMISSION      @map("sales_commission")',
    'OUTREACH_COMMISSION   @map("outreach_commission")',
    'LEADER_COMMISSION     @map("leader_commission")',
    'TASTER_COMMISSION     @map("taster_commission")',
    'AGENCY_DAILY_REBATE   @map("agency_daily_rebate")',
    'AGENCY_MONTHLY_REBATE @map("agency_monthly_rebate")',
    '@@map("commission_target_type")',
  ]) {
    assert.match(commissionTargetType, new RegExp(escapeRegExp(enumValue)));
  }

  const user = extractPrismaBlock(schema, 'model User {');
  assertBlockHasFields(user, [
    'leaderId',
    'leader',
    'members',
    'outreachSalesOrders',
    'createdAgencyDeductionRules',
    'updatedAgencyDeductionRules',
    'createdAgencyRebateRules',
    'updatedAgencyRebateRules',
    'createdSalesDeductionRules',
    'updatedSalesDeductionRules',
    'createdCommissionRules',
    'updatedCommissionRules',
    'targetCommissionRecords',
    'confirmedCommissionRecords',
    'createdCommissionRecords',
    'updatedCommissionRecords',
    'confirmedTravelGroupSummaries',
    'updatedTravelGroupSummaries',
  ]);
  assert.match(
    user,
    /leader\s+User\?\s+@relation\("UserLeader", fields: \[leaderId\], references: \[id\], onDelete: SetNull\)/,
  );
  assert.match(user, /@@index\(\[leaderId\]\)/);

  const travelAgency = extractPrismaBlock(schema, 'model TravelAgency {');
  assertBlockHasFields(travelAgency, [
    'agencyDeductionRules',
    'agencyRebateRules',
    'commissionRecords',
  ]);

  const guide = extractPrismaBlock(schema, 'model Guide {');
  assertBlockHasFields(guide, [
    'id',
    'name',
    'phone',
    'remarks',
    'isActive',
    'createdAt',
    'updatedAt',
  ]);
  assert.doesNotMatch(guide, /travelAgency|travel_agency/);

  const travelGroup = extractPrismaBlock(schema, 'model TravelGroup {');
  assertBlockHasFields(travelGroup, [
    'tasterId',
    'travelAgency',
    'financeMark',
    'points',
    'returnedPoints',
    'unreturnedPoints',
    'liquorCostDeductionCents',
    'orderAmountCents',
    'commissionRecords',
    'financeSummary',
  ]);

  const salesOrder = extractPrismaBlock(schema, 'model SalesOrder {');
  assertBlockHasFields(salesOrder, [
    'salesUserId',
    'outreachUserId',
    'travelGroupId',
    'totalAmountCents',
    'status',
    'hasPackingMark',
    'items',
    'afterSalesOrders',
    'commissionRecords',
  ]);
  assert.match(
    salesOrder,
    /outreachUserId\s+String\?\s+@map\("outreach_user_id"\) @db\.Char\(36\)/,
  );
  assert.match(
    salesOrder,
    /hasPackingMark\s+Boolean\s+@default\(false\)\s+@map\("has_packing_mark"\)/,
  );
  assert.match(
    salesOrder,
    /outreachUser\s+User\?\s+@relation\("SalesOrderOutreachUser", fields: \[outreachUserId\], references: \[id\], onDelete: SetNull\)/,
  );
  assert.match(salesOrder, /@@index\(\[outreachUserId\]\)/);

  const afterSalesOrder = extractPrismaBlock(schema, 'model AfterSalesOrder {');
  assertBlockHasFields(afterSalesOrder, [
    'refundAmountCents',
    'financeConfirmed',
    'financeConfirmedById',
    'financeConfirmedAt',
    'commissionRecords',
  ]);

  const agencyDeductionRule = extractPrismaBlock(
    schema,
    'model AgencyDeductionRule {',
  );
  assertBlockHasFields(agencyDeductionRule, [
    'agencyId',
    'agencyName',
    'calculationMode',
    'deductionRate',
    'productName',
    'deductionCostCents',
    'effectiveFrom',
    'effectiveTo',
    'isActive',
    'createdById',
    'updatedById',
  ]);
  assert.match(
    agencyDeductionRule,
    /agency\s+TravelAgency\?\s+@relation\(fields: \[agencyId\], references: \[id\], onDelete: SetNull\)/,
  );
  assert.match(
    agencyDeductionRule,
    /@@index\(\[agencyId, productName, isActive, effectiveFrom\]/,
  );
  assert.match(
    agencyDeductionRule,
    /@@index\(\[agencyName, productName, isActive, effectiveFrom\]/,
  );
  assert.match(
    agencyDeductionRule,
    /@@index\(\[agencyId, calculationMode, isActive, effectiveFrom\]/,
  );
  assert.match(
    agencyDeductionRule,
    /@@index\(\[agencyName, calculationMode, isActive, effectiveFrom\]/,
  );
  assert.match(agencyDeductionRule, /@@map\("agency_deduction_rules"\)/);

  const agencyRebateRule = extractPrismaBlock(
    schema,
    'model AgencyRebateRule {',
  );
  assertBlockHasFields(agencyRebateRule, [
    'agencyId',
    'agencyName',
    'dailyRebateRate',
    'monthlyRebateRate',
    'totalRebateRate',
    'effectiveFrom',
    'effectiveTo',
    'isActive',
    'createdById',
    'updatedById',
    'commissionRecords',
  ]);
  assert.match(
    agencyRebateRule,
    /dailyRebateRate\s+Decimal\s+@default\(0\) @map\("daily_rebate_rate"\) @db\.Decimal\(10, 4\)/,
  );
  assert.match(
    agencyRebateRule,
    /monthlyRebateRate\s+Decimal\s+@default\(0\) @map\("monthly_rebate_rate"\) @db\.Decimal\(10, 4\)/,
  );
  assert.match(agencyRebateRule, /@@index\(\[agencyId, isActive, effectiveFrom\]\)/);
  assert.match(agencyRebateRule, /@@index\(\[agencyName, isActive, effectiveFrom\]\)/);
  assert.match(agencyRebateRule, /@@map\("agency_rebate_rules"\)/);

  const salesDeductionRule = extractPrismaBlock(
    schema,
    'model SalesDeductionRule {',
  );
  assertBlockHasFields(salesDeductionRule, [
    'productName',
    'deductionCostCents',
    'effectiveFrom',
    'effectiveTo',
    'isActive',
    'createdById',
    'updatedById',
  ]);
  assert.match(salesDeductionRule, /@@index\(\[productName, isActive, effectiveFrom\]\)/);
  assert.match(salesDeductionRule, /@@map\("sales_deduction_rules"\)/);

  const commissionRule = extractPrismaBlock(schema, 'model CommissionRule {');
  assertBlockHasFields(commissionRule, [
    'ruleName',
    'targetType',
    'rate',
    'effectiveFrom',
    'effectiveTo',
    'isActive',
    'createdById',
    'updatedById',
    'commissionRecords',
  ]);
  assert.match(
    commissionRule,
    /targetType\s+CommissionRuleTargetType\s+@map\("target_type"\)/,
  );
  assert.match(commissionRule, /@@index\(\[targetType, isActive, effectiveFrom\]\)/);
  assert.match(commissionRule, /@@map\("commission_rules"\)/);

  const commissionRecord = extractPrismaBlock(schema, 'model CommissionRecord {');
  assertBlockHasFields(commissionRecord, [
    'salesOrderId',
    'travelGroupId',
    'afterSalesOrderId',
    'commissionRuleId',
    'agencyRebateRuleId',
    'targetType',
    'targetUserId',
    'agencyId',
    'agencyName',
    'grossAmountCents',
    'confirmedRefundAmountCents',
    'baseAmountCents',
    'deductionAmountCents',
    'rateSnapshot',
    'amountCents',
    'pointsCents',
    'manualInput',
    'isConfirmed',
    'confirmedById',
    'confirmedAt',
    'calculationVersion',
    'calculationNote',
    'ruleSnapshot',
    'sourceSnapshot',
  ]);
  for (const relation of [
    'salesOrder',
    'travelGroup',
    'afterSalesOrder',
    'commissionRule',
    'agencyRebateRule',
    'targetUser',
    'agency',
    'confirmedBy',
  ]) {
    assert.match(
      commissionRecord,
      new RegExp(`${relation}\\s+\\w+\\??\\s+@relation`),
    );
  }
  assert.match(
    commissionRecord,
    /targetType\s+CommissionTargetType\s+@map\("target_type"\)/,
  );
  assert.match(
    commissionRecord,
    /rateSnapshot\s+Decimal\?\s+@map\("rate_snapshot"\) @db\.Decimal\(10, 4\)/,
  );
  assert.match(commissionRecord, /ruleSnapshot\s+Json\?\s+@map\("rule_snapshot"\)/);
  assert.match(commissionRecord, /sourceSnapshot\s+Json\?\s+@map\("source_snapshot"\)/);
  assert.match(commissionRecord, /@@index\(\[targetType, targetUserId, createdAt\]\)/);
  assert.match(commissionRecord, /@@index\(\[travelGroupId, targetType\]\)/);
  assert.match(commissionRecord, /@@map\("commission_records"\)/);

  const summary = extractPrismaBlock(
    schema,
    'model TravelGroupFinanceSummary {',
  );
  assertBlockHasFields(summary, [
    'travelGroupId',
    'totalSalesAmountCents',
    'totalCashOnDeliveryCents',
    'totalPaidDepositCents',
    'confirmedRefundAmountCents',
    'effectiveSalesAmountCents',
    'totalAgencyDeductionCents',
    'agencyDeductionConfirmed',
    'agencyDeductionConfirmedById',
    'agencyDeductionConfirmedAt',
    'totalAgencyNetAmountCents',
    'totalDailyRebateCents',
    'totalMonthlyRebateCents',
    'paidRebateCents',
    'unpaidRebateCents',
    'dailyRebatePaid',
    'dailyRebatePaidById',
    'dailyRebatePaidAt',
    'monthlyRebatePaid',
    'monthlyRebatePaidById',
    'monthlyRebatePaidAt',
    'guideInfoSent',
    'travelAgencyInfoSent',
    'calculationVersion',
    'sourceSnapshot',
    'updatedById',
  ]);
  assert.match(
    summary,
    /travelGroup\s+TravelGroup\s+@relation\(fields: \[travelGroupId\], references: \[id\], onDelete: Cascade\)/,
  );
  assert.match(summary, /travelGroupId\s+String\s+@unique/);
  assert.match(summary, /sourceSnapshot\s+Json\?\s+@map\("source_snapshot"\)/);
  assert.match(summary, /dailyRebatePaidBy\s+User\?\s+@relation/);
  assert.match(summary, /monthlyRebatePaidBy\s+User\?\s+@relation/);
  assert.match(summary, /@@index\(\[agencyDeductionConfirmed\]\)/);
  assert.match(summary, /@@index\(\[dailyRebatePaid\]\)/);
  assert.match(summary, /@@index\(\[monthlyRebatePaid\]\)/);
  assert.match(summary, /@@map\("travel_group_finance_summaries"\)/);
});

test('smoke: phase 7 Prisma migration creates commission tables and traceability columns', () => {
  assert.equal(
    fs.existsSync(
      path.join(
        migrationsDir,
        '20260703000100_stage7_commission_points_schema',
        'migration.sql',
      ),
    ),
    true,
  );

  const migration = readMigration(
    '20260703000100_stage7_commission_points_schema',
  );

  assert.match(
    migration,
    /ADD COLUMN `outreach_user_id` CHAR\(36\) NULL/,
  );
  assert.match(migration, /sales_orders_outreach_user_id_idx/);
  assert.match(migration, /sales_orders_outreach_user_id_fkey/);
  assert.match(
    migration,
    /FOREIGN KEY \(`outreach_user_id`\) REFERENCES `users`\(`id`\) ON DELETE SET NULL ON UPDATE CASCADE/,
  );
  assert.doesNotMatch(
    migration,
    /ADD COLUMN `outreach_user_id` CHAR\(36\) NOT NULL/,
  );

  for (const table of [
    'agency_deduction_rules',
    'agency_rebate_rules',
    'sales_deduction_rules',
    'commission_rules',
    'commission_records',
    'travel_group_finance_summaries',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE \`${table}\``));
  }

  assert.match(
    migration,
    /`target_type` ENUM\('sales_commission', 'outreach_commission', 'leader_commission'\) NOT NULL/,
  );
  assert.match(
    migration,
    /`target_type` ENUM\('sales_commission', 'outreach_commission', 'leader_commission', 'taster_commission', 'agency_daily_rebate', 'agency_monthly_rebate'\) NOT NULL/,
  );

  for (const column of [
    'sales_order_id',
    'travel_group_id',
    'after_sales_order_id',
    'commission_rule_id',
    'agency_rebate_rule_id',
    'target_user_id',
    'agency_id',
    'agency_name',
    'gross_amount_cents',
    'confirmed_refund_amount_cents',
    'base_amount_cents',
    'deduction_amount_cents',
    'rate_snapshot',
    'amount_cents',
    'points_cents',
    'manual_input',
    'is_confirmed',
    'confirmed_by_id',
    'confirmed_at',
    'calculation_version',
    'calculation_note',
    'rule_snapshot',
    'source_snapshot',
  ]) {
    assert.match(migration, new RegExp(`\`${column}\``));
  }

  assert.match(migration, /`rule_snapshot` JSON NULL/);
  assert.match(migration, /`source_snapshot` JSON NULL/);
  assert.match(
    migration,
    /`rate_snapshot` DECIMAL\(10, 4\) NULL/,
  );

  for (const indexName of [
    'agency_deduction_rules_agency_product_active_from_idx',
    'agency_deduction_rules_name_product_active_from_idx',
    'agency_rebate_rules_agency_id_is_active_effective_from_idx',
    'agency_rebate_rules_agency_name_is_active_effective_from_idx',
    'sales_deduction_rules_product_name_is_active_effective_from_idx',
    'commission_rules_target_type_is_active_effective_from_idx',
    'commission_records_target_type_target_user_id_created_at_idx',
    'commission_records_travel_group_id_target_type_idx',
    'travel_group_finance_summaries_travel_group_id_key',
    'travel_group_finance_summaries_agency_deduction_confirmed_idx',
  ]) {
    assert.match(migration, new RegExp(indexName));
  }

  for (const foreignKey of [
    'agency_deduction_rules_agency_id_fkey',
    'agency_rebate_rules_agency_id_fkey',
    'commission_records_sales_order_id_fkey',
    'commission_records_travel_group_id_fkey',
    'commission_records_after_sales_order_id_fkey',
    'commission_records_commission_rule_id_fkey',
    'commission_records_agency_rebate_rule_id_fkey',
    'commission_records_target_user_id_fkey',
    'commission_records_agency_id_fkey',
    'commission_records_confirmed_by_id_fkey',
    'travel_group_finance_summaries_travel_group_id_fkey',
    'tg_fin_summaries_confirmed_by_id_fkey',
  ]) {
    assert.match(migration, new RegExp(foreignKey));
  }

  assert.match(
    migration,
    /FOREIGN KEY \(`travel_group_id`\) REFERENCES `travel_groups`\(`id`\) ON DELETE CASCADE ON UPDATE CASCADE/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \(`sales_order_id`\) REFERENCES `sales_orders`\(`id`\) ON DELETE SET NULL ON UPDATE CASCADE/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \(`after_sales_order_id`\) REFERENCES `after_sales_orders`\(`id`\) ON DELETE SET NULL ON UPDATE CASCADE/,
  );
});

test('smoke: agency deduction calculation mode migration preserves old product rules', () => {
  const migrationName = '20260717000100_agency_deduction_calculation_mode';
  assert.equal(
    fs.existsSync(path.join(migrationsDir, migrationName, 'migration.sql')),
    true,
  );
  const migration = readMigration(migrationName);

  assert.match(
    migration,
    /ADD COLUMN `calculation_mode` VARCHAR\(40\) NOT NULL DEFAULT 'manual_product_reference'/,
  );
  assert.match(
    migration,
    /ADD COLUMN `deduction_rate` DECIMAL\(10, 4\) NOT NULL DEFAULT 0\.3000/,
  );
  assert.match(
    migration,
    /SET `calculation_mode` = 'manual_product_reference'/,
  );
  assert.match(migration, /agency_deduction_rules_agency_mode_active_from_idx/);
  assert.match(migration, /agency_deduction_rules_name_mode_active_from_idx/);
});

test('smoke: TravelGroup exposes optional intake fields and liaison taster relation', () => {
  const schema = readPrismaFile('schema.prisma');
  const user = extractPrismaBlock(schema, 'model User {');
  const travelGroup = extractPrismaBlock(schema, 'model TravelGroup {');

  for (const field of [
    ['sourceRegion', 'String\\?', 'source_region', '@db\\.VarChar\\(120\\)'],
    ['ageInfo', 'String\\?', 'age_info', '@db\\.VarChar\\(120\\)'],
    ['mentionedFeitian', 'Boolean\\?', 'mentioned_feitian', ''],
    [
      'previousStopOrderStatus',
      'String\\?',
      'previous_stop_order_status',
      '@db\\.VarChar\\(255\\)',
    ],
    ['keyCustomerInfo', 'String\\?', 'key_customer_info', '@db\\.Text'],
    ['keyCustomerPhotos', 'Json\\?', 'key_customer_photos', ''],
    ['guestInfoAttachments', 'Json\\?', 'guest_info_attachments', ''],
    ['liaisonTasterId', 'String\\?', 'liaison_taster_id', '@db\\.Char\\(36\\)'],
    [
      'liaisonTasterName',
      'String\\?',
      'liaison_taster_name',
      '@db\\.VarChar\\(80\\)',
    ],
    [
      'expectedArrivalTime',
      'String\\?',
      'expected_arrival_time',
      '@db\\.VarChar\\(30\\)',
    ],
  ]) {
    assert.match(
      travelGroup,
      new RegExp(
        `${field[0]}\\s+${field[1]}\\s+@map\\("${field[2]}"\\)${
          field[3] ? `\\s+${field[3]}` : ''
        }`,
      ),
    );
  }

  assert.match(
    travelGroup,
    /liaisonTaster\s+User\?\s+@relation\("TravelGroupLiaisonTaster", fields: \[liaisonTasterId\], references: \[id\], onDelete: SetNull\)/,
  );
  assert.match(travelGroup, /@@index\(\[liaisonTasterId\]\)/);
  assert.match(
    user,
    /liaisonTasterTravelGroups\s+TravelGroup\[\]\s+@relation\("TravelGroupLiaisonTaster"\)/,
  );
});

test('smoke: travel group intake migration is additive and nullable', () => {
  const migrationName = '20260714000100_add_travel_group_intake_fields';
  assert.equal(
    fs.existsSync(path.join(migrationsDir, migrationName, 'migration.sql')),
    true,
  );

  const migration = readMigration(migrationName);
  for (const column of [
    ['source_region', 'VARCHAR\\(120\\)'],
    ['age_info', 'VARCHAR\\(120\\)'],
    ['mentioned_feitian', 'BOOLEAN'],
    ['previous_stop_order_status', 'VARCHAR\\(255\\)'],
    ['key_customer_info', 'TEXT'],
    ['key_customer_photos', 'JSON'],
    ['guest_info_attachments', 'JSON'],
    ['liaison_taster_id', 'CHAR\\(36\\)'],
    ['liaison_taster_name', 'VARCHAR\\(80\\)'],
    ['expected_arrival_time', 'VARCHAR\\(30\\)'],
  ]) {
    assert.match(
      migration,
      new RegExp('ADD COLUMN `' + column[0] + '` ' + column[1] + ' NULL'),
    );
  }

  assert.equal((migration.match(/ADD COLUMN/g) || []).length, 10);
  assert.match(migration, /travel_groups_liaison_taster_id_idx/);
  assert.match(migration, /travel_groups_liaison_taster_id_fkey/);
  assert.match(
    migration,
    /FOREIGN KEY \(`liaison_taster_id`\) REFERENCES `users`\(`id`\) ON DELETE SET NULL ON UPDATE CASCADE/,
  );
  assert.doesNotMatch(
    migration,
    /\bDROP\b|\bTRUNCATE\b|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+`|CREATE\s+TABLE/i,
  );
});

test('smoke: order-level taster commissions have a duplicate-safe unique migration', () => {
  const schema = readPrismaFile('schema.prisma');
  const commissionRecord = extractPrismaBlock(
    schema,
    'model CommissionRecord {',
  );
  assert.match(
    commissionRecord,
    /@@unique\(\[salesOrderId, targetType, targetUserId, manualInput\], map: "commission_records_order_target_user_manual_key"\)/,
  );

  const migrationName =
    '20260724000300_order_taster_commission_uniqueness';
  assert.equal(
    fs.existsSync(path.join(migrationsDir, migrationName, 'migration.sql')),
    true,
  );
  const migration = readMigration(migrationName);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX `commission_records_order_target_user_manual_key`/,
  );
  assert.match(migration, /`legacy`\.`sales_order_id` IS NULL/);
  assert.match(migration, /`other_order`\.`id` IS NULL/);
  assert.match(migration, /`other_legacy`\.`id` IS NULL/);
  assert.doesNotMatch(migration, /\b(DELETE|DROP TABLE|TRUNCATE)\b/i);

  const preflight = fs.readFileSync(
    path.resolve(
      __dirname,
      '..',
      'scripts',
      'preflight-order-taster-commission-migration.sql',
    ),
    'utf8',
  );
  assert.match(preflight, /HAVING COUNT\(\*\) > 1/);
  assert.match(preflight, /effective_order_count/);
  assert.match(preflight, /candidate_sales_order_ids/);
  assert.doesNotMatch(preflight, /\b(UPDATE|DELETE|INSERT|ALTER)\b/i);
});

test('smoke: travel groups persist parking snapshots and nullable cigarette fees', () => {
  const schema = readPrismaFile('schema.prisma');
  const travelGroup = extractPrismaBlock(schema, 'model TravelGroup {');
  assert.match(
    travelGroup,
    /parkingFeeCents\s+Int\s+@default\(500\)\s+@map\("parking_fee_cents"\)/,
  );
  assert.match(
    travelGroup,
    /cigaretteFeeCents\s+Int\?\s+@map\("cigarette_fee_cents"\)/,
  );
  assert.doesNotMatch(
    travelGroup,
    /@@index\(\[(?:parkingFeeCents|cigaretteFeeCents)\]\)/,
  );

  const migrationName =
    '20260724000400_travel_group_parking_cigarette_fees';
  assert.equal(
    fs.existsSync(path.join(migrationsDir, migrationName, 'migration.sql')),
    true,
  );
  const migration = readMigration(migrationName);
  assert.match(
    migration,
    /`parking_fee_cents` INTEGER NOT NULL DEFAULT 500/,
  );
  assert.match(migration, /`cigarette_fee_cents` INTEGER NULL/);
  assert.doesNotMatch(migration, /cigarette_fee_cents[^;]*DEFAULT 0/i);
  assert.doesNotMatch(migration, /CREATE (?:UNIQUE )?INDEX/i);
});

test('smoke: travel group guest breakdown migration backfills existing totals safely', () => {
  const schema = readPrismaFile('schema.prisma');
  const travelGroup = extractPrismaBlock(schema, 'model TravelGroup {');
  assert.match(
    travelGroup,
    /adultCount\s+Int\s+@default\(0\)\s+@map\("adult_count"\)/,
  );
  assert.match(
    travelGroup,
    /childCount\s+Int\s+@default\(0\)\s+@map\("child_count"\)/,
  );
  assert.match(
    travelGroup,
    /guestCount\s+Int\s+@default\(0\)\s+@map\("guest_count"\)/,
  );

  const migrationName = '20260725000200_travel_group_guest_breakdown';
  assert.equal(
    fs.existsSync(path.join(migrationsDir, migrationName, 'migration.sql')),
    true,
  );
  const migration = readMigration(migrationName);
  assert.match(
    migration,
    /ADD COLUMN `adult_count` INTEGER NOT NULL DEFAULT 0/,
  );
  assert.match(
    migration,
    /ADD COLUMN `child_count` INTEGER NOT NULL DEFAULT 0/,
  );
  assert.match(
    migration,
    /UPDATE `travel_groups`\s+SET\s+`adult_count` = `guest_count`,\s+`child_count` = 0;/s,
  );
  assert.doesNotMatch(migration, /SET[^;]*`guest_count`\s*=/i);
  assert.doesNotMatch(migration, /\b(DELETE|DROP|TRUNCATE)\b/i);
});

test('smoke: travel group loss confirmation migration is additive and traceable', () => {
  const schema = readPrismaFile('schema.prisma');
  const user = extractPrismaBlock(schema, 'model User {');
  const travelGroup = extractPrismaBlock(schema, 'model TravelGroup {');
  const lossStatus = extractPrismaBlock(
    schema,
    'enum TravelGroupLossStatus {',
  );
  assert.match(lossStatus, /PENDING\s+@map\("pending"\)/);
  assert.match(lossStatus, /RECORDED\s+@map\("recorded"\)/);
  assert.match(lossStatus, /NO_LOSS\s+@map\("no_loss"\)/);
  assert.match(
    travelGroup,
    /lossStatus\s+TravelGroupLossStatus\s+@default\(PENDING\)\s+@map\("loss_status"\)/,
  );
  assert.match(
    travelGroup,
    /lossConfirmedAt\s+DateTime\?\s+@map\("loss_confirmed_at"\)\s+@db\.DateTime\(0\)/,
  );
  assert.match(
    travelGroup,
    /lossConfirmedById\s+String\?\s+@map\("loss_confirmed_by_id"\)\s+@db\.Char\(36\)/,
  );
  assert.match(
    travelGroup,
    /lossConfirmedBy\s+User\?\s+@relation\("TravelGroupLossConfirmedBy", fields: \[lossConfirmedById\], references: \[id\], onDelete: SetNull\)/,
  );
  assert.match(
    user,
    /lossConfirmedTravelGroups\s+TravelGroup\[\]\s+@relation\("TravelGroupLossConfirmedBy"\)/,
  );

  const migrationName =
    '20260726000100_travel_group_loss_confirmation';
  const migration = readMigration(migrationName);
  assert.match(
    migration,
    /ADD COLUMN `loss_status` ENUM\('pending', 'recorded', 'no_loss'\)\s+NOT NULL DEFAULT 'pending'/,
  );
  assert.match(
    migration,
    /ADD COLUMN `loss_confirmed_at` DATETIME\(0\) NULL/,
  );
  assert.match(
    migration,
    /ADD COLUMN `loss_confirmed_by_id` CHAR\(36\) NULL/,
  );
  assert.match(migration, /travel_groups_loss_status_idx/);
  assert.match(migration, /travel_groups_loss_confirmed_by_id_idx/);
  assert.match(migration, /travel_groups_loss_confirmed_by_id_fkey/);
  assert.match(
    migration,
    /FOREIGN KEY \(`loss_confirmed_by_id`\) REFERENCES `users` \(`id`\)\s+ON DELETE SET NULL ON UPDATE CASCADE/,
  );
  assert.doesNotMatch(
    migration,
    /DELETE\s+FROM|DROP\s+(?:TABLE|COLUMN)|TRUNCATE|^\s*UPDATE\s+`|INSERT\s+INTO/im,
  );
});

test('smoke: travel group not-entered confirmation is nullable, related, and additive', () => {
  const schema = readPrismaFile('schema.prisma');
  const user = extractPrismaBlock(schema, 'model User {');
  const travelGroup = extractPrismaBlock(schema, 'model TravelGroup {');

  assert.match(
    travelGroup,
    /notEnteredConfirmedAt\s+DateTime\?\s+@map\("not_entered_confirmed_at"\)\s+@db\.DateTime\(0\)/,
  );
  assert.match(
    travelGroup,
    /notEnteredConfirmedById\s+String\?\s+@map\("not_entered_confirmed_by_id"\)\s+@db\.Char\(36\)/,
  );
  assert.match(
    travelGroup,
    /notEnteredConfirmedBy\s+User\?\s+@relation\("TravelGroupNotEnteredConfirmedBy", fields: \[notEnteredConfirmedById\], references: \[id\], onDelete: SetNull\)/,
  );
  assert.match(travelGroup, /@@index\(\[notEnteredConfirmedAt\]\)/);
  assert.match(travelGroup, /@@index\(\[notEnteredConfirmedById\]\)/);
  assert.match(
    user,
    /notEnteredConfirmedTravelGroups\s+TravelGroup\[\]\s+@relation\("TravelGroupNotEnteredConfirmedBy"\)/,
  );

  const migrationName =
    '20260729000300_travel_group_not_entered_confirmation';
  const migration = readMigration(migrationName);
  assert.match(
    migration,
    /ADD COLUMN `not_entered_confirmed_at` DATETIME\(0\) NULL/,
  );
  assert.match(
    migration,
    /ADD COLUMN `not_entered_confirmed_by_id` CHAR\(36\) NULL/,
  );
  assert.match(
    migration,
    /travel_groups_not_entered_confirmed_at_idx/,
  );
  assert.match(
    migration,
    /travel_groups_not_entered_confirmed_by_id_idx/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \(`not_entered_confirmed_by_id`\) REFERENCES `users` \(`id`\)\s+ON DELETE SET NULL ON UPDATE CASCADE/,
  );
  assert.doesNotMatch(
    migration,
    /^\s*(UPDATE|DELETE|DROP|TRUNCATE)\b/im,
  );
});

test('smoke: quantity order shortage alerts are additive, stable-keyed, and protect business facts', () => {
  const schema = readPrismaFile('schema.prisma');
  const alertType = extractPrismaBlock(
    schema,
    'enum InventoryAlertType {',
  );
  const alertStatus = extractPrismaBlock(
    schema,
    'enum InventoryAlertStatus {',
  );
  const alert = extractPrismaBlock(schema, 'model InventoryAlert {');
  assert.match(alertType, /ORDER_SHORTAGE\s+@map\("order_shortage"\)/);
  assert.match(alertStatus, /ACTIVE\s+@map\("active"\)/);
  assert.match(alertStatus, /RESOLVED\s+@map\("resolved"\)/);
  assert.match(
    alert,
    /alertKey\s+String\s+@unique\(map: "inventory_alerts_alert_key"\)/,
  );
  assert.match(
    alert,
    /warehouse\s+Warehouse\s+@relation\(fields: \[warehouseId\], references: \[id\], onDelete: Restrict\)/,
  );
  assert.match(
    alert,
    /product\s+Product\s+@relation\(fields: \[productId\], references: \[id\], onDelete: Restrict\)/,
  );
  assert.match(
    alert,
    /salesOrder\s+SalesOrder\?\s+@relation\(fields: \[salesOrderId\], references: \[id\], onDelete: Restrict\)/,
  );

  const migrationName =
    '20260727000700_sales_order_inventory_alerts';
  assert.equal(
    fs.existsSync(path.join(migrationsDir, migrationName, 'migration.sql')),
    true,
  );
  const migration = readMigration(migrationName);
  assert.match(migration, /CREATE TABLE `inventory_alerts`/);
  assert.match(
    migration,
    /CHECK \(CHAR_LENGTH\(TRIM\(`alert_key`\)\) > 0\)/,
  );
  assert.match(
    migration,
    /UNIQUE INDEX `inventory_alerts_alert_key` \(`alert_key`\)/,
  );
  assert.match(
    migration,
    /inventory_alerts_warehouse_product_status_idx/,
  );
  assert.match(migration, /inventory_alerts_order_status_idx/);
  assert.match(
    migration,
    /inventory_alerts_type_status_detected_idx/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \(`warehouse_id`\) REFERENCES `warehouses`\(`id`\)\s+ON DELETE RESTRICT ON UPDATE CASCADE/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \(`product_id`\) REFERENCES `products`\(`id`\)\s+ON DELETE RESTRICT ON UPDATE CASCADE/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \(`sales_order_id`\) REFERENCES `sales_orders`\(`id`\)\s+ON DELETE RESTRICT ON UPDATE CASCADE/,
  );
  assert.doesNotMatch(
    migration,
    /\b(?:INSERT\s+INTO|UPDATE\s+`|DELETE\s+FROM|DROP\s+(?:TABLE|COLUMN)|TRUNCATE)\b/i,
  );
});

test('smoke: inventory todo alerts add safe source types, active uniqueness, policy and durable cursors', () => {
  const schema = readPrismaFile('schema.prisma');
  const todoSourceType = extractPrismaBlock(
    schema,
    'enum TodoSourceType {',
  );
  const configuration = extractPrismaBlock(
    schema,
    'model InventoryConfiguration {',
  );
  const inventoryAlert = extractPrismaBlock(
    schema,
    'model InventoryAlert {',
  );
  const cursor = extractPrismaBlock(
    schema,
    'model TodoReconcileCursor {',
  );

  assert.match(
    todoSourceType,
    /INVENTORY_ALERT\s+@map\("inventory_alert"\)/,
  );
  assert.match(todoSourceType, /STOCKTAKE\s+@map\("stocktake"\)/);
  assert.match(
    configuration,
    /transferOverdueHours\s+Int\?\s+@map\("transfer_overdue_hours"\)/,
  );
  assert.match(
    inventoryAlert,
    /activeKey\s+String\?\s+@unique\(map: "inventory_alerts_active_key_key"\)\s+@map\("active_key"\)/,
  );
  assert.match(
    cursor,
    /scanType\s+String\s+@unique\(map: "todo_reconcile_cursors_scan_type_key"\)/,
  );
  assert.match(cursor, /cursorId\s+String\?\s+@map\("cursor_id"\)/);

  const migrationName = '20260727001100_inventory_alert_todos';
  const migration = readMigration(migrationName);
  assert.match(
    migration,
    /'inventory_alert',\s+'stocktake'/s,
  );
  assert.match(
    migration,
    /ADD COLUMN `transfer_overdue_hours` INTEGER NULL/,
  );
  assert.match(
    migration,
    /CHECK \(\s*`transfer_overdue_hours` IS NULL\s*OR `transfer_overdue_hours` > 0\s*\)/s,
  );
  assert.match(
    migration,
    /ADD UNIQUE INDEX `inventory_alerts_active_key_key` \(`active_key`\)/,
  );
  assert.match(migration, /CREATE TABLE `todo_reconcile_cursors`/);
  assert.match(
    migration,
    /CONSTRAINT `todo_reconcile_cursors_scan_type_key`\s+UNIQUE \(`scan_type`\)/s,
  );
  assert.doesNotMatch(
    migration,
    /\b(?:INSERT\s+INTO|UPDATE\s+`|DELETE\s+FROM|DROP\s+(?:TABLE|COLUMN)|TRUNCATE)\b/i,
  );
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
