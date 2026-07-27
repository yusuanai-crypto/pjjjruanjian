const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  InventoryAccountingService,
} = require('../src/modules/inventory/inventory-accounting.service');
const {
  calculateInventoryRequestHash,
} = require('../src/modules/inventory/inventory-command.policy');
const {
  InventoryPostCommitService,
} = require('../src/modules/inventory/inventory-post-commit.service');
const {
  SerializedInventoryAccountingAdapter,
} = require('../src/modules/inventory/serialized-inventory-accounting.adapter');

const ADMIN = {
  id: null,
  name: 'Inventory Admin',
  role: 'admin',
};
const WAREHOUSE = {
  id: null,
  name: 'Warehouse Operator',
  role: 'warehouse',
};
const SALES = {
  id: null,
  name: 'Sales',
  role: 'sales',
};
const FINANCE = {
  id: null,
  name: 'Inventory Finance',
  role: 'finance',
};

test('inventory core: inbound, reserve, release, outbound, unavailable and reversal stay rebuildable', async () => {
  const fixture = createFixture();
  const inbound = await fixture.service.inbound(
    ADMIN,
    command('INBOUND', {
      sourceKey: 'stock:opening:1',
      idempotencyKey: 'idem:opening:1',
      warehouseId: 'wh-a',
      productId: 'product-quantity',
      quantity: 10,
      kind: 'PURCHASE_RECEIPT',
      batch: {
        sourceLineKey: 'batch:purchase:0001',
        purchaseOrderNo: '0000123',
        productionBatch: '0000456',
        purchaseUnitCostCents: 12_345,
      },
    }),
  );
  const batchId = inbound.batchChanges[0].batchId;
  const reserved = await fixture.service.reserve(
    WAREHOUSE,
    command('RESERVE', {
      sourceKey: 'order:1:line:stable:reserve:1',
      idempotencyKey: 'idem:reserve:1',
      warehouseId: 'wh-a',
      productId: 'product-quantity',
      salesOrderId: 'order-1',
      inventoryLineKey: 'line-stable-1',
      quantity: 4,
    }),
  );
  const reservationId = reserved.reservation.id;
  await fixture.service.release(
    WAREHOUSE,
    command('RELEASE', {
      sourceKey: 'order:1:line:stable:release:1',
      idempotencyKey: 'idem:release:1',
      reservationId,
      quantity: 1,
    }),
  );
  await fixture.service.outbound(
    WAREHOUSE,
    command('OUTBOUND', {
      sourceKey: 'order:1:line:stable:outbound:1',
      idempotencyKey: 'idem:outbound:1',
      warehouseId: 'wh-a',
      productId: 'product-quantity',
      reservationId,
      batchId,
      quantity: 2,
      kind: 'SALES_OUTBOUND',
    }),
  );
  const unavailable = await fixture.service.markUnavailable(
    WAREHOUSE,
    command('MARK_UNAVAILABLE', {
      sourceKey: 'stock:unavailable:1',
      idempotencyKey: 'idem:unavailable:1',
      warehouseId: 'wh-a',
      productId: 'product-quantity',
      batchId,
      quantity: 2,
      reason: 'Damaged label',
    }),
  );
  await fixture.service.reverse(
    ADMIN,
    command('REVERSE', {
      sourceKey: 'stock:unavailable:1:reverse',
      idempotencyKey: 'idem:unavailable:1:reverse',
      documentId: unavailable.documentId,
      reason: 'Inspection confirmed saleable',
    }),
  );

  const check = await fixture.service.rebuildCheck(ADMIN, {
    warehouseId: 'wh-a',
    productId: 'product-quantity',
  });
  assert.equal(check.consistent, true);
  assert.deepEqual(
    pick(check.stock.actual, [
      'onHandQty',
      'reservedQty',
      'unavailableQty',
      'availableQty',
      'shortageQty',
    ]),
    {
      onHandQty: 8,
      reservedQty: 1,
      unavailableQty: 0,
      availableQty: 7,
      shortageQty: 0,
    },
  );
  assert.deepEqual(check.batches[0].actual, {
    receivedQty: 10,
    remainingQty: 8,
    unavailableQty: 0,
  });
  assert.equal(fixture.repository.state.logs.length, 6);
  assert.equal(
    JSON.stringify(fixture.repository.state.logs).includes(
      'purchaseUnitCostCents',
    ),
    false,
  );
});

test('inventory core: quantity stock may be negative and exposes shortage without reading financeMark', async () => {
  const fixture = createFixture();
  const result = await fixture.service.outbound(
    WAREHOUSE,
    command('OUTBOUND', {
      sourceKey: 'negative:outbound:1',
      idempotencyKey: 'negative:idem:1',
      warehouseId: 'wh-a',
      productId: 'product-quantity',
      quantity: 5,
    }),
  );
  assert.equal(result.stockChanges[0].after.onHandQty, -5);
  assert.equal(result.stockChanges[0].after.availableQty, -5);
  assert.equal(result.stockChanges[0].after.shortageQty, 5);
  assert.equal(
    fixture.repository.queries.some((query) =>
      String(query).includes('financeMark'),
    ),
    false,
  );
});

test('inventory core: reserved, unavailable and in-transit snapshots cannot become negative', async () => {
  const fixture = createFixture();
  await assertCode(
    fixture.service.restoreAvailable(
      WAREHOUSE,
      command('RESTORE_AVAILABLE', {
        sourceKey: 'restore:invalid:1',
        idempotencyKey: 'restore:invalid:idem:1',
        warehouseId: 'wh-a',
        productId: 'product-quantity',
        quantity: 1,
      }),
    ),
    'INVENTORY_UNAVAILABLE_QTY_NEGATIVE',
  );
  await assertCode(
    fixture.service.transferIn(
      WAREHOUSE,
      command('TRANSFER_IN', {
        sourceKey: 'transfer:invalid:1',
        idempotencyKey: 'transfer:invalid:idem:1',
        fromWarehouseId: 'wh-a',
        toWarehouseId: 'wh-b',
        productId: 'product-quantity',
        quantity: 1,
      }),
    ),
    'INVENTORY_IN_TRANSIT_QTY_NEGATIVE',
  );
  assert.equal(fixture.repository.state.movements.length, 0);
  assert.equal(fixture.repository.state.documents.length, 0);
});

test('inventory core: transfer out enters transit and transfer receipt moves it to the target warehouse', async () => {
  const fixture = createFixture();
  await fixture.service.inbound(
    WAREHOUSE,
    command('INBOUND', {
      sourceKey: 'transfer:opening:1',
      idempotencyKey: 'transfer:opening:idem:1',
      warehouseId: 'wh-a',
      productId: 'product-quantity',
      quantity: 5,
    }),
  );
  await fixture.service.transferOut(
    WAREHOUSE,
    command('TRANSFER_OUT', {
      sourceKey: 'transfer:out:1',
      idempotencyKey: 'transfer:out:idem:1',
      fromWarehouseId: 'wh-a',
      toWarehouseId: 'wh-b',
      productId: 'product-quantity',
      quantity: 3,
    }),
  );
  assert.equal(stock(fixture, 'wh-a').onHandQty, 2);
  assert.equal(stock(fixture, 'wh-a').inTransitQty, 3);

  const received = await fixture.service.transferIn(
    WAREHOUSE,
    command('TRANSFER_IN', {
      sourceKey: 'transfer:in:1',
      idempotencyKey: 'transfer:in:idem:1',
      fromWarehouseId: 'wh-a',
      toWarehouseId: 'wh-b',
      productId: 'product-quantity',
      quantity: 2,
    }),
  );
  assert.equal(received.movementIds.length, 2);
  assert.equal(stock(fixture, 'wh-a').inTransitQty, 1);
  assert.equal(stock(fixture, 'wh-b').onHandQty, 2);
  assert.equal(
    (
      await fixture.service.rebuildCheck(ADMIN, {
        warehouseId: 'wh-a',
        productId: 'product-quantity',
      })
    ).consistent,
    true,
  );
  assert.equal(
    (
      await fixture.service.rebuildCheck(ADMIN, {
        warehouseId: 'wh-b',
        productId: 'product-quantity',
      })
    ).consistent,
    true,
  );
});

test('inventory transfer: draft, outbound and partial multi-receipt posting are idempotent and conserve company quantity', async () => {
  const fixture = createFixture();
  await fixture.service.inbound(
    WAREHOUSE,
    command('INBOUND', {
      sourceKey: 'transfer-flow:opening',
      idempotencyKey: 'transfer-flow:opening:idem',
      warehouseId: 'wh-a',
      productId: 'product-quantity',
      quantity: 5,
    }),
  );
  const created = await fixture.service.createTransfer(
    WAREHOUSE,
    command('TRANSFER_CREATE', {
      sourceKey: 'transfer-flow:create',
      idempotencyKey: 'transfer-flow:create:idem',
      fromWarehouseId: 'wh-a',
      toWarehouseId: 'wh-b',
      lines: [
        {
          sourceLineKey: 'transfer-flow:line:1',
          productId: 'product-quantity',
          plannedQty: 5,
        },
      ],
    }),
  );
  const transferId = created.transferId;
  const transferLineId = created.transfer.lines[0].id;
  assert.equal(created.transfer.status, 'draft');
  assert.equal(fixture.repository.state.movements.length, 1);

  const outboundCommand = command('TRANSFER_CONFIRM_OUTBOUND', {
    sourceKey: 'transfer-flow:outbound',
    idempotencyKey: 'transfer-flow:outbound:idem',
    transferId,
  });
  const outbound = await fixture.service.confirmTransferOutbound(
    WAREHOUSE,
    outboundCommand,
  );
  const outboundReplay =
    await fixture.service.confirmTransferOutbound(
      WAREHOUSE,
      outboundCommand,
    );
  assert.equal(outboundReplay.replayed, true);
  assert.equal(outboundReplay.documentIds[0], outbound.documentIds[0]);
  await assertCode(
    fixture.service.confirmTransferOutbound(
      WAREHOUSE,
      command('TRANSFER_CONFIRM_OUTBOUND', {
        sourceKey: 'transfer-flow:outbound',
        idempotencyKey: 'transfer-flow:outbound:idem',
        transferId,
        businessAt: '2026-07-27T12:00:00.000Z',
      }),
    ),
    'INVENTORY_IDEMPOTENCY_KEY_CONFLICT',
  );
  assert.equal(stock(fixture, 'wh-a').onHandQty, 0);
  assert.equal(stock(fixture, 'wh-a').inTransitQty, 5);
  assert.equal(companyQuantity(fixture), 5);

  const firstReceipt = await fixture.service.receiveTransfer(
    WAREHOUSE,
    command('TRANSFER_RECEIVE', {
      sourceKey: 'transfer-flow:receipt:1',
      idempotencyKey: 'transfer-flow:receipt:idem:1',
      transferId,
      lines: [
        {
          transferLineId,
          receivedQty: 2,
        },
      ],
    }),
  );
  assert.equal(firstReceipt.transfer.status, 'partially_received');
  assert.equal(stock(fixture, 'wh-a').inTransitQty, 3);
  assert.equal(stock(fixture, 'wh-b').onHandQty, 2);
  assert.equal(companyQuantity(fixture), 5);

  const secondReceipt = await fixture.service.receiveTransfer(
    ADMIN,
    command('TRANSFER_RECEIVE', {
      sourceKey: 'transfer-flow:receipt:2',
      idempotencyKey: 'transfer-flow:receipt:idem:2',
      transferId,
      lines: [
        {
          transferLineId,
          receivedQty: 3,
        },
      ],
    }),
  );
  assert.equal(secondReceipt.transfer.status, 'received');
  assert.equal(stock(fixture, 'wh-a').inTransitQty, 0);
  assert.equal(stock(fixture, 'wh-b').onHandQty, 5);
  assert.equal(companyQuantity(fixture), 5);
  assert.equal(
    fixture.repository.state.transferReceipts.filter(
      (receipt) => receipt.status === 'POSTED',
    ).length,
    2,
  );
  assert.equal(
    fixture.repository.state.transferReceiptLines.reduce(
      (sum, line) => sum + line.receivedQty,
      0,
    ),
    5,
  );
});

test('inventory transfer: concurrent over-receipt has one winner and rolls the losing transaction back', async () => {
  const fixture = createFixture();
  const created = await fixture.service.createTransfer(
    WAREHOUSE,
    command('TRANSFER_CREATE', {
      sourceKey: 'transfer-race:create',
      idempotencyKey: 'transfer-race:create:idem',
      fromWarehouseId: 'wh-a',
      toWarehouseId: 'wh-b',
      lines: [
        {
          sourceLineKey: 'transfer-race:line:1',
          productId: 'product-quantity',
          plannedQty: 10,
        },
      ],
    }),
  );
  await fixture.service.confirmTransferOutbound(
    WAREHOUSE,
    command('TRANSFER_CONFIRM_OUTBOUND', {
      sourceKey: 'transfer-race:outbound',
      idempotencyKey: 'transfer-race:outbound:idem',
      transferId: created.transferId,
    }),
  );
  const receive = (suffix) =>
    fixture.service.receiveTransfer(
      WAREHOUSE,
      command('TRANSFER_RECEIVE', {
        sourceKey: `transfer-race:receipt:${suffix}`,
        idempotencyKey: `transfer-race:receipt:idem:${suffix}`,
        transferId: created.transferId,
        lines: [
          {
            transferLineId: created.transfer.lines[0].id,
            receivedQty: 7,
          },
        ],
      }),
    );
  const results = await Promise.allSettled([receive('a'), receive('b')]);
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  const rejected = results.find(
    (result) => result.status === 'rejected',
  );
  assert.equal(
    rejected.reason.code,
    'INVENTORY_TRANSFER_RECEIPT_EXCEEDS_OUTBOUND',
  );
  assert.equal(stock(fixture, 'wh-a').inTransitQty, 3);
  assert.equal(stock(fixture, 'wh-b').onHandQty, 7);
  assert.equal(
    fixture.repository.state.transferReceipts.length,
    1,
  );
  assert.equal(companyQuantity(fixture), 0);
});

test('inventory transfer: damage/difference facts are explicit and receipt reversal restores transit without mutating history', async () => {
  const fixture = createFixture();
  await fixture.service.inbound(
    WAREHOUSE,
    command('INBOUND', {
      sourceKey: 'transfer-diff:opening',
      idempotencyKey: 'transfer-diff:opening:idem',
      warehouseId: 'wh-a',
      productId: 'product-quantity',
      quantity: 4,
    }),
  );
  const created = await fixture.service.createTransfer(
    WAREHOUSE,
    command('TRANSFER_CREATE', {
      sourceKey: 'transfer-diff:create',
      idempotencyKey: 'transfer-diff:create:idem',
      fromWarehouseId: 'wh-a',
      toWarehouseId: 'wh-b',
      lines: [
        {
          sourceLineKey: 'transfer-diff:line:1',
          productId: 'product-quantity',
          plannedQty: 4,
        },
      ],
    }),
  );
  await fixture.service.confirmTransferOutbound(
    WAREHOUSE,
    command('TRANSFER_CONFIRM_OUTBOUND', {
      sourceKey: 'transfer-diff:outbound',
      idempotencyKey: 'transfer-diff:outbound:idem',
      transferId: created.transferId,
    }),
  );
  const received = await fixture.service.receiveTransfer(
    WAREHOUSE,
    command('TRANSFER_RECEIVE', {
      sourceKey: 'transfer-diff:receipt',
      idempotencyKey: 'transfer-diff:receipt:idem',
      transferId: created.transferId,
      reason: 'Two bottles were lost in transit',
      lines: [
        {
          transferLineId: created.transfer.lines[0].id,
          receivedQty: 2,
          unavailableQty: 1,
          differenceQty: 2,
          notes: 'One received bottle damaged; two bottles missing',
        },
      ],
    }),
  );
  assert.equal(stock(fixture, 'wh-a').inTransitQty, 0);
  assert.equal(stock(fixture, 'wh-b').onHandQty, 2);
  assert.equal(stock(fixture, 'wh-b').unavailableQty, 1);
  assert.equal(companyQuantity(fixture), 2);
  assert.equal(
    fixture.repository.state.movements.some(
      (movement) =>
        movement.movementType === 'TRANSFER_DIFFERENCE',
    ),
    true,
  );

  const beforeMovements = fixture.repository.state.movements.length;
  const reversalCommand = command('TRANSFER_RECEIPT_REVERSE', {
    sourceKey: 'transfer-diff:receipt:reverse',
    idempotencyKey: 'transfer-diff:receipt:reverse:idem',
    receiptId: received.receiptId,
    reason: 'Carrier reconciliation corrected the receipt',
  });
  await fixture.service.reverseTransferReceipt(
    ADMIN,
    reversalCommand,
  );
  const replay = await fixture.service.reverseTransferReceipt(
    ADMIN,
    reversalCommand,
  );
  assert.equal(replay.replayed, true);
  assert.equal(stock(fixture, 'wh-a').inTransitQty, 4);
  assert.equal(stock(fixture, 'wh-b').onHandQty, 0);
  assert.equal(stock(fixture, 'wh-b').unavailableQty, 0);
  assert.equal(companyQuantity(fixture), 4);
  assert.ok(
    fixture.repository.state.movements.length > beforeMovements,
  );
  assert.equal(
    fixture.repository.state.transferReceipts.find(
      (receipt) => receipt.id === received.receiptId,
    ).status,
    'REVERSED',
  );
  const cancelled =
    await fixture.service.reverseTransferOutbound(
      ADMIN,
      command('TRANSFER_OUTBOUND_REVERSE', {
        sourceKey: 'transfer-diff:outbound:reverse',
        idempotencyKey: 'transfer-diff:outbound:reverse:idem',
        transferId: created.transferId,
        reason: 'Cancel after reversing the damaged receipt',
      }),
    );
  assert.equal(cancelled.transfer.status, 'reversed');
  assert.equal(stock(fixture, 'wh-a').onHandQty, 4);
  assert.equal(stock(fixture, 'wh-a').inTransitQty, 0);
  assert.equal(companyQuantity(fixture), 4);
});

test('inventory transfer: receipt transaction failures fully roll back and an untouched outbound can be reversed', async () => {
  const fixture = createFixture();
  const created = await fixture.service.createTransfer(
    ADMIN,
    command('TRANSFER_CREATE', {
      sourceKey: 'transfer-rollback:create',
      idempotencyKey: 'transfer-rollback:create:idem',
      fromWarehouseId: 'wh-a',
      toWarehouseId: 'wh-b',
      lines: [
        {
          sourceLineKey: 'transfer-rollback:line:1',
          productId: 'product-quantity',
          plannedQty: 3,
        },
      ],
    }),
  );
  await fixture.service.confirmTransferOutbound(
    ADMIN,
    command('TRANSFER_CONFIRM_OUTBOUND', {
      sourceKey: 'transfer-rollback:outbound',
      idempotencyKey: 'transfer-rollback:outbound:idem',
      transferId: created.transferId,
    }),
  );
  const beforeFailure = structuredClone(fixture.repository.state);
  fixture.operationLogs.failNext = true;
  await assert.rejects(
    fixture.service.receiveTransfer(
      WAREHOUSE,
      command('TRANSFER_RECEIVE', {
        sourceKey: 'transfer-rollback:receipt',
        idempotencyKey: 'transfer-rollback:receipt:idem',
        transferId: created.transferId,
        lines: [
          {
            transferLineId: created.transfer.lines[0].id,
            receivedQty: 1,
          },
        ],
      }),
    ),
    /TEST_AUDIT_FAILURE/,
  );
  assert.deepEqual(fixture.repository.state, beforeFailure);

  const reversed = await fixture.service.reverseTransferOutbound(
    ADMIN,
    command('TRANSFER_OUTBOUND_REVERSE', {
      sourceKey: 'transfer-rollback:outbound:reverse',
      idempotencyKey: 'transfer-rollback:outbound:reverse:idem',
      transferId: created.transferId,
      reason: 'Transfer cancelled before carrier pickup',
    }),
  );
  assert.equal(reversed.transfer.status, 'reversed');
  assert.equal(stock(fixture, 'wh-a').onHandQty, 0);
  assert.equal(stock(fixture, 'wh-a').inTransitQty, 0);
  assert.equal(
    fixture.repository.state.transfers.find(
      (row) => row.id === created.transferId,
    ).status,
    'REVERSED',
  );
});

test('inventory transfer: unavailable conversion requires reason, preserves on-hand, enforces roles and defers serialized posting', async () => {
  const fixture = createFixture();
  await fixture.service.inbound(
    WAREHOUSE,
    command('INBOUND', {
      sourceKey: 'unavailable-flow:opening',
      idempotencyKey: 'unavailable-flow:opening:idem',
      warehouseId: 'wh-a',
      productId: 'product-quantity',
      quantity: 3,
    }),
  );
  await assertCode(
    Promise.resolve().then(() =>
      fixture.service.businessMarkUnavailable(
        WAREHOUSE,
        command('MARK_UNAVAILABLE', {
          sourceKey: 'unavailable-flow:missing-reason',
          idempotencyKey: 'unavailable-flow:missing-reason:idem',
          warehouseId: 'wh-a',
          productId: 'product-quantity',
          quantity: 1,
        }),
      ),
    ),
    'INVENTORY_VALIDATION_FAILED',
  );
  await fixture.service.businessMarkUnavailable(
    WAREHOUSE,
    command('MARK_UNAVAILABLE', {
      sourceKey: 'unavailable-flow:mark',
      idempotencyKey: 'unavailable-flow:mark:idem',
      warehouseId: 'wh-a',
      productId: 'product-quantity',
      quantity: 2,
      reason: 'Outer cartons damaged',
    }),
  );
  assert.equal(stock(fixture, 'wh-a').onHandQty, 3);
  assert.equal(stock(fixture, 'wh-a').unavailableQty, 2);
  await fixture.service.businessRestoreAvailable(
    ADMIN,
    command('RESTORE_AVAILABLE', {
      sourceKey: 'unavailable-flow:restore',
      idempotencyKey: 'unavailable-flow:restore:idem',
      warehouseId: 'wh-a',
      productId: 'product-quantity',
      quantity: 1,
      reason: 'Inspection passed',
    }),
  );
  assert.equal(stock(fixture, 'wh-a').onHandQty, 3);
  assert.equal(stock(fixture, 'wh-a').unavailableQty, 1);

  await assertCode(
    Promise.resolve().then(() =>
      fixture.service.createTransfer(
        FINANCE,
        command('TRANSFER_CREATE', {
          sourceKey: 'transfer-role:finance',
          idempotencyKey: 'transfer-role:finance:idem',
          fromWarehouseId: 'wh-a',
          toWarehouseId: 'wh-b',
          lines: [
            {
              sourceLineKey: 'transfer-role:finance:line',
              productId: 'product-quantity',
              plannedQty: 1,
            },
          ],
        }),
      ),
    ),
    'PERMISSION_DENIED',
  );
  await assertCode(
    Promise.resolve().then(() =>
      fixture.service.createTransfer(
        SALES,
        command('TRANSFER_CREATE', {
          sourceKey: 'transfer-role:sales',
          idempotencyKey: 'transfer-role:sales:idem',
          fromWarehouseId: 'wh-a',
          toWarehouseId: 'wh-b',
          lines: [
            {
              sourceLineKey: 'transfer-role:sales:line',
              productId: 'product-quantity',
              plannedQty: 1,
            },
          ],
        }),
      ),
    ),
    'PERMISSION_DENIED',
  );

  const serialized = await fixture.service.createTransfer(
    WAREHOUSE,
    command('TRANSFER_CREATE', {
      sourceKey: 'transfer-serialized:create',
      idempotencyKey: 'transfer-serialized:create:idem',
      fromWarehouseId: 'wh-a',
      toWarehouseId: 'wh-b',
      lines: [
        {
          sourceLineKey: 'transfer-serialized:line:1',
          productId: 'product-serialized',
          plannedQty: 2,
          unitIds: ['unit-001', 'unit-002'],
        },
      ],
    }),
  );
  const serializedDraft = fixture.repository.state.transfers.find(
    (row) => row.id === serialized.transferId,
  );
  assert.equal(serializedDraft.status, 'DRAFT');
  const serializedLine = fixture.repository.state.transferLines.find(
    (row) => row.transferId === serialized.transferId,
  );
  assert.deepEqual(serializedLine.serializedUnitIds, [
    'unit-001',
    'unit-002',
  ]);
});

test('inventory core: idempotency, request hash, source key and concurrent updates are stable', async () => {
  const fixture = createFixture();
  const firstBody = command('INBOUND', {
    sourceKey: 'idem:source:1',
    idempotencyKey: 'idem:key:1',
    warehouseId: 'wh-a',
    productId: 'product-quantity',
    quantity: 1,
  });
  const first = await fixture.service.inbound(WAREHOUSE, firstBody);
  const replay = await fixture.service.inbound(WAREHOUSE, firstBody);
  assert.equal(replay.replayed, true);
  assert.equal(replay.documentId, first.documentId);
  assert.equal(fixture.repository.state.movements.length, 1);
  await assertCode(
    fixture.service.inbound(WAREHOUSE, {
      ...firstBody,
      idempotencyKey: 'idem:key:bad-hash',
      requestHash: '0'.repeat(64),
    }),
    'INVENTORY_REQUEST_HASH_MISMATCH',
  );

  await assertCode(
    fixture.service.inbound(
      WAREHOUSE,
      command('INBOUND', {
        sourceKey: 'idem:source:different',
        idempotencyKey: 'idem:key:1',
        warehouseId: 'wh-a',
        productId: 'product-quantity',
        quantity: 2,
      }),
    ),
    'INVENTORY_IDEMPOTENCY_KEY_CONFLICT',
  );
  await assertCode(
    fixture.service.inbound(
      WAREHOUSE,
      command('INBOUND', {
        sourceKey: '  IDEM:SOURCE:1  ',
        idempotencyKey: 'idem:key:source-conflict',
        warehouseId: 'wh-a',
        productId: 'product-quantity',
        quantity: 1,
      }),
    ),
    'INVENTORY_SOURCE_KEY_CONFLICT',
  );

  await Promise.all([
    fixture.service.inbound(
      WAREHOUSE,
      command('INBOUND', {
        sourceKey: 'concurrent:source:1',
        idempotencyKey: 'concurrent:idem:1',
        warehouseId: 'wh-a',
        productId: 'product-quantity',
        quantity: 1,
      }),
    ),
    fixture.service.inbound(
      WAREHOUSE,
      command('INBOUND', {
        sourceKey: 'concurrent:source:2',
        idempotencyKey: 'concurrent:idem:2',
        warehouseId: 'wh-a',
        productId: 'product-quantity',
        quantity: 1,
      }),
    ),
  ]);
  assert.equal(stock(fixture, 'wh-a').onHandQty, 3);
  assert.equal(stock(fixture, 'wh-a').version, 3);
});

test('inventory core: NONE, QUANTITY and SERIALIZED modes are isolated and sales cannot write', async () => {
  const fixture = createFixture();
  await assertCode(
    fixture.service.inbound(
      WAREHOUSE,
      command('INBOUND', {
        sourceKey: 'mode:none:1',
        idempotencyKey: 'mode:none:idem:1',
        warehouseId: 'wh-a',
        productId: 'product-none',
        quantity: 1,
      }),
    ),
    'INVENTORY_TRACKING_DISABLED',
  );
  await assertCode(
    fixture.service.inbound(
      WAREHOUSE,
      command('INBOUND', {
        sourceKey: 'mode:serialized:1',
        idempotencyKey: 'mode:serialized:idem:1',
        warehouseId: 'wh-a',
        productId: 'product-serialized',
        quantity: 1,
      }),
    ),
    'INVENTORY_SERIALIZED_ADAPTER_REQUIRED',
  );
  await assertCode(
    fixture.service.inbound(
      SALES,
      command('INBOUND', {
        sourceKey: 'mode:sales:1',
        idempotencyKey: 'mode:sales:idem:1',
        warehouseId: 'wh-a',
        productId: 'product-quantity',
        quantity: 1,
      }),
    ),
    'PERMISSION_DENIED',
  );
  await assertCode(
    fixture.service.inbound(
      WAREHOUSE,
      command('INBOUND', {
        sourceKey: 'mode:cost:1',
        idempotencyKey: 'mode:cost:idem:1',
        warehouseId: 'wh-a',
        productId: 'product-quantity',
        quantity: 1,
        batch: {
          purchaseUnitCostCents: 100,
        },
      }),
    ),
    'INVENTORY_COST_FIELD_FORBIDDEN',
  );
});

test('inventory core: rebuild and admin repair preview are read-only', async () => {
  const fixture = createFixture();
  await fixture.service.inbound(
    WAREHOUSE,
    command('INBOUND', {
      sourceKey: 'preview:source:1',
      idempotencyKey: 'preview:idem:1',
      warehouseId: 'wh-a',
      productId: 'product-quantity',
      quantity: 3,
      batch: {
        sourceLineKey: 'preview:batch:1',
      },
    }),
  );
  stock(fixture, 'wh-a').onHandQty = 99;
  const before = structuredClone(fixture.repository.state);
  const preview = await fixture.service.repairPreview(ADMIN, {
    warehouseId: 'wh-a',
    productId: 'product-quantity',
  });
  assert.equal(preview.consistent, false);
  assert.equal(preview.writeApplied, false);
  assert.equal(preview.repairPreview.stockPatch.onHandQty, 3);
  assert.match(preview.checksum, /^[0-9a-f]{64}$/);
  assert.deepEqual(fixture.repository.state, before);
  await assertCode(
    fixture.service.repairPreview(WAREHOUSE, {
      warehouseId: 'wh-a',
      productId: 'product-quantity',
    }),
    'PERMISSION_DENIED',
  );
});

test('inventory core: a transaction-stage failure rolls back receipt, document, movement, stock and log', async () => {
  const fixture = createFixture();
  fixture.operationLogs.failNext = true;
  const body = command('INBOUND', {
    sourceKey: 'rollback:source:1',
    idempotencyKey: 'rollback:idem:1',
    warehouseId: 'wh-a',
    productId: 'product-quantity',
    quantity: 2,
  });
  await assert.rejects(fixture.service.inbound(WAREHOUSE, body));
  assert.equal(fixture.repository.state.receipts.length, 0);
  assert.equal(fixture.repository.state.documents.length, 0);
  assert.equal(fixture.repository.state.movements.length, 0);
  assert.equal(fixture.repository.state.stocks.length, 0);
  assert.equal(fixture.repository.state.logs.length, 0);
  assert.equal(fixture.repository.state.tasks.length, 0);

  const retry = await fixture.service.inbound(WAREHOUSE, body);
  assert.equal(retry.replayed, false);
  assert.equal(stock(fixture, 'wh-a').onHandQty, 2);
});

test('inventory core: post-commit refresh failure is compensated without replaying inventory facts', async () => {
  const fixture = createFixture();
  fixture.projector.failuresRemaining = 1;
  const body = command('INBOUND', {
    sourceKey: 'outbox:source:1',
    idempotencyKey: 'outbox:idem:1',
    warehouseId: 'wh-a',
    productId: 'product-quantity',
    quantity: 2,
  });
  const first = await fixture.service.inbound(WAREHOUSE, body);
  assert.equal(fixture.repository.state.movements.length, 1);
  assert.equal(taskFor(fixture, first.commandReceiptId).status, 'FAILED');

  const replay = await fixture.service.inbound(WAREHOUSE, body);
  assert.equal(replay.replayed, true);
  assert.equal(fixture.repository.state.movements.length, 1);
  taskFor(fixture, first.commandReceiptId).nextAttemptAt = new Date(0);
  await fixture.postCommit.compensatePendingTasks();
  assert.equal(taskFor(fixture, first.commandReceiptId).status, 'SUCCEEDED');
  assert.equal(fixture.repository.state.movements.length, 1);
});

test('inventory core: a posted fact can be reversed only once', async () => {
  const fixture = createFixture();
  const posted = await fixture.service.inbound(
    WAREHOUSE,
    command('INBOUND', {
      sourceKey: 'reverse-once:source:1',
      idempotencyKey: 'reverse-once:idem:1',
      warehouseId: 'wh-a',
      productId: 'product-quantity',
      quantity: 1,
    }),
  );
  await fixture.service.reverse(
    ADMIN,
    command('REVERSE', {
      sourceKey: 'reverse-once:source:2',
      idempotencyKey: 'reverse-once:idem:2',
      documentId: posted.documentId,
      reason: 'Correct test posting',
    }),
  );
  await assertCode(
    fixture.service.reverse(
      ADMIN,
      command('REVERSE', {
        sourceKey: 'reverse-once:source:3',
        idempotencyKey: 'reverse-once:idem:3',
        documentId: posted.documentId,
        reason: 'Duplicate correction attempt',
      }),
    ),
    'INVENTORY_DOCUMENT_ALREADY_REVERSED',
  );
  assert.equal(fixture.repository.state.movements.length, 2);
});

test('inventory core: generic reversal cannot bypass serialized unit state and assignment commands', async () => {
  const fixture = createFixture();
  fixture.repository.state.documents.push({
    id: 'serialized-document',
    documentNo: 'SERIALIZED-DOCUMENT',
    type: 'SALES_OUTBOUND',
    status: 'POSTED',
    warehouseId: 'wh-a',
    fromWarehouseId: null,
    toWarehouseId: null,
    sourceKey: 'serialized-document:source',
  });
  fixture.repository.state.lines.push({
    id: 'serialized-line',
    documentId: 'serialized-document',
    lineNo: 1,
    productId: 'product-serialized',
    batchId: null,
    quantity: 1,
    condition: 'SALEABLE',
    productNameSnapshot: 'Serialized product',
    unitSnapshot: 'bottle',
    purchaseUnitCostCents: null,
  });
  fixture.repository.state.movements.push({
    id: 'serialized-movement',
    sourceKey: 'serialized-movement:source',
    documentLineId: 'serialized-line',
    warehouseId: 'wh-a',
    productId: 'product-serialized',
    batchId: null,
    serializedUnitId: 'serialized-unit',
    reservationId: 'serialized-reservation',
    movementType: 'SALES_OUT',
    onHandDelta: -1,
    reservedDelta: -1,
    unavailableDelta: 0,
    inTransitDelta: 0,
  });

  await assertCode(
    fixture.service.reverse(
      ADMIN,
      command('REVERSE', {
        sourceKey: 'serialized-document:reverse',
        idempotencyKey: 'serialized-document:reverse:idem',
        documentId: 'serialized-document',
        reason: 'Must use the serialized correction workflow.',
      }),
    ),
    'INVENTORY_SERIALIZED_REVERSAL_COMMAND_REQUIRED',
  );
  assert.equal(
    fixture.repository.state.documents.some(
      (document) =>
        document.reversalOfDocumentId === 'serialized-document',
    ),
    false,
  );
});

test('inventory inbound: warehouse creates pending-cost batches without cost exposure and preserves business strings', async () => {
  const fixture = createFixture();
  const result = await fixture.service.businessInbound(
    WAREHOUSE,
    command('INBOUND', {
      sourceKey: 'purchase:0000123:line:0001',
      idempotencyKey: 'purchase:0000123:line:0001:post',
      warehouseId: 'wh-a',
      productId: 'product-quantity',
      quantity: 6,
      kind: 'PURCHASE_RECEIPT',
      notes: 'First purchase receipt',
      attachmentMetadata: [
        {
          fileName: 'receipt.pdf',
          contentType: 'application/pdf',
          sizeBytes: 123,
          checksumSha256: 'a'.repeat(64),
        },
      ],
      batch: {
        sourceLineKey: 'purchase:0000123:line:0001',
        supplierName: 'Supplier A',
        purchaseOrderNo: '0000123',
        productionBatch: '0000456',
        productionDate: '2026-07-01',
      },
    }),
  );
  const batch = fixture.repository.state.batches.find(
    (row) => row.id === result.batchChanges[0].batchId,
  );
  assert.equal(batch.purchaseOrderNo, '0000123');
  assert.equal(batch.productionBatch, '0000456');
  assert.equal(batch.purchaseUnitCostCents, null);
  assert.equal(batch.costStatus, 'PENDING');
  assert.equal(batch.remainingQty, 6);
  assert.equal(batch.unavailableQty, 6);
  assert.equal(stock(fixture, 'wh-a').onHandQty, 6);
  assert.equal(stock(fixture, 'wh-a').unavailableQty, 6);
  assert.equal(
    fixture.repository.state.documents[0].attachmentMetadata[0]
      .fileName,
    'receipt.pdf',
  );
  assert.equal(fixture.repository.state.lines[0].notes, 'First purchase receipt');
  assert.equal(
    JSON.stringify(result).includes('purchaseUnitCostCents'),
    false,
  );
  await assertCode(
    fixture.service.outbound(
      WAREHOUSE,
      command('OUTBOUND', {
        sourceKey: 'purchase:pending:outbound',
        idempotencyKey: 'purchase:pending:outbound:idem',
        warehouseId: 'wh-a',
        productId: 'product-quantity',
        batchId: batch.id,
        quantity: 1,
      }),
    ),
    'INVENTORY_BATCH_SALEABLE_INSUFFICIENT',
  );
  await assertCode(
    fixture.service.restoreAvailable(
      WAREHOUSE,
      command('RESTORE_AVAILABLE', {
        sourceKey: 'purchase:pending:restore',
        idempotencyKey: 'purchase:pending:restore:idem',
        warehouseId: 'wh-a',
        productId: 'product-quantity',
        batchId: batch.id,
        quantity: 1,
      }),
    ),
    'INVENTORY_PENDING_COST_RESTORE_FORBIDDEN',
  );
  await assertCode(
    fixture.service.updateBatchCost(
      WAREHOUSE,
      command('UPDATE_BATCH_COST', {
        sourceKey: 'purchase:pending:cost-forbidden',
        idempotencyKey: 'purchase:pending:cost-forbidden:idem',
        batchId: batch.id,
        purchaseUnitCostCents: 100,
        reason: 'Forbidden warehouse cost write',
      }),
    ),
    'PERMISSION_DENIED',
  );
  await assertCode(
    Promise.resolve().then(() =>
      fixture.service.businessInbound(
        WAREHOUSE,
        command('INBOUND', {
          sourceKey: 'purchase:cost-forbidden',
          idempotencyKey: 'purchase:cost-forbidden:post',
          warehouseId: 'wh-a',
          productId: 'product-quantity',
          quantity: 1,
          kind: 'PURCHASE_RECEIPT',
          batch: {
            sourceLineKey: 'purchase:cost-forbidden:line',
            purchaseUnitCostCents: 100,
          },
        }),
      ),
    ),
    'INVENTORY_COST_FIELD_FORBIDDEN',
  );
  await assertCode(
    Promise.resolve().then(() =>
      fixture.service.businessInbound(
        FINANCE,
        command('INBOUND', {
          sourceKey: 'purchase:finance-forbidden',
          idempotencyKey: 'purchase:finance-forbidden:post',
          warehouseId: 'wh-a',
          productId: 'product-quantity',
          quantity: 1,
          kind: 'OTHER_IN',
          batch: {
            sourceLineKey: 'purchase:finance-forbidden:line',
          },
        }),
      ),
    ),
    'PERMISSION_DENIED',
  );
});

test('inventory cost: finance completes and maintains batch cost without touching ProductActualCost or quantities', async () => {
  const fixture = createFixture();
  const inbound = await fixture.service.businessInbound(
    WAREHOUSE,
    command('INBOUND', {
      sourceKey: 'cost:inbound:1',
      idempotencyKey: 'cost:inbound:idem:1',
      warehouseId: 'wh-a',
      productId: 'product-quantity',
      quantity: 4,
      kind: 'OTHER_IN',
      batch: {
        sourceLineKey: 'cost:source-line:1',
      },
    }),
  );
  const batchId = inbound.batchChanges[0].batchId;
  fixture.repository.state.products.find(
    (row) => row.id === 'product-quantity',
  ).isActive = false;
  const originalActualCosts = structuredClone(
    fixture.repository.state.productActualCosts,
  );
  const costBody = command('UPDATE_BATCH_COST', {
    sourceKey: 'cost:complete:1',
    idempotencyKey: 'cost:complete:idem:1',
    batchId,
    purchaseUnitCostCents: 12_345,
    reason: 'Invoice received',
  });
  const completed = await fixture.service.updateBatchCost(
    FINANCE,
    costBody,
  );
  assert.equal(completed.batchCostChange.releasedUnavailableQty, 4);
  assert.equal(stock(fixture, 'wh-a').onHandQty, 4);
  assert.equal(stock(fixture, 'wh-a').unavailableQty, 0);
  let batch = fixture.repository.state.batches.find(
    (row) => row.id === batchId,
  );
  assert.equal(batch.remainingQty, 4);
  assert.equal(batch.unavailableQty, 0);
  assert.equal(batch.purchaseUnitCostCents, 12_345);
  assert.equal(batch.costStatus, 'COMPLETE');
  assert.deepEqual(
    fixture.repository.state.productActualCosts,
    originalActualCosts,
  );
  assert.equal(
    fixture.repository.state.movements.at(-1).movementType,
    'UNAVAILABLE_OUT',
  );
  const replay = await fixture.service.updateBatchCost(
    FINANCE,
    costBody,
  );
  assert.equal(replay.replayed, true);
  assert.equal(
    fixture.repository.state.movements.filter(
      (row) => row.movementType === 'UNAVAILABLE_OUT',
    ).length,
    1,
  );
  await assertCode(
    fixture.service.updateBatchCost(
      FINANCE,
      command('UPDATE_BATCH_COST', {
      ...Object.fromEntries(
        Object.entries(costBody).filter(
          ([key]) => key !== 'requestHash',
        ),
      ),
      purchaseUnitCostCents: 12_346,
      }),
    ),
    'INVENTORY_IDEMPOTENCY_KEY_CONFLICT',
  );

  const maintained = await fixture.service.updateBatchCost(
    ADMIN,
    command('UPDATE_BATCH_COST', {
      sourceKey: 'cost:maintain:1',
      idempotencyKey: 'cost:maintain:idem:1',
      batchId,
      purchaseUnitCostCents: 13_000,
      reason: 'Corrected supplier invoice',
    }),
  );
  assert.equal(maintained.batchCostChange.releasedUnavailableQty, 0);
  batch = fixture.repository.state.batches.find(
    (row) => row.id === batchId,
  );
  assert.equal(batch.purchaseUnitCostCents, 13_000);
  assert.equal(batch.remainingQty, 4);
  assert.equal(stock(fixture, 'wh-a').onHandQty, 4);
  assert.equal(
    fixture.repository.state.logs.at(-1).beforeData
      .purchaseUnitPriceCents,
    12_345,
  );
  assert.equal(
    fixture.repository.state.logs.at(-1).afterData
      .purchaseUnitPriceCents,
    13_000,
  );
  await assertCode(
    fixture.service.reverseInbound(
      ADMIN,
      command('REVERSE', {
        sourceKey: 'cost:inbound:reverse:blocked',
        idempotencyKey: 'cost:inbound:reverse:blocked:idem',
        documentId: inbound.documentId,
        reason: 'Correction after cost completion',
      }),
    ),
    'INVENTORY_INBOUND_COST_DEPENDENCY_EXISTS',
  );
});

test('inventory inbound: posted quantities are corrected only by a reasoned reversal document', async () => {
  const fixture = createFixture();
  const inbound = await fixture.service.businessInbound(
    ADMIN,
    command('INBOUND', {
      sourceKey: 'reverse-inbound:source:1',
      idempotencyKey: 'reverse-inbound:idem:1',
      warehouseId: 'wh-a',
      productId: 'product-quantity',
      quantity: 2,
      kind: 'PURCHASE_RECEIPT',
      batch: {
        sourceLineKey: 'reverse-inbound:line:1',
        purchaseUnitCostCents: 500,
      },
    }),
  );
  await assertCode(
    fixture.service.reverseInbound(
      ADMIN,
      command('REVERSE', {
        sourceKey: 'reverse-inbound:source:missing-reason',
        idempotencyKey: 'reverse-inbound:idem:missing-reason',
        documentId: inbound.documentId,
      }),
    ),
    'INVENTORY_VALIDATION_FAILED',
  );
  const reversed = await fixture.service.reverseInbound(
    ADMIN,
    command('REVERSE', {
      sourceKey: 'reverse-inbound:source:2',
      idempotencyKey: 'reverse-inbound:idem:2',
      documentId: inbound.documentId,
      reason: 'Wrong quantity entered',
    }),
  );
  assert.equal(reversed.reversalOfDocumentId, inbound.documentId);
  assert.equal(stock(fixture, 'wh-a').onHandQty, 0);
  const batch = fixture.repository.state.batches[0];
  assert.equal(batch.receivedQty, 0);
  assert.equal(batch.remainingQty, 0);
  assert.equal(
    fixture.repository.state.documents.find(
      (row) => row.id === inbound.documentId,
    ).status,
    'REVERSED',
  );
});

test('inventory opening: configured maintenance window permits one opening per warehouse-product only', async () => {
  const fixture = createFixture();
  const openingPayload = {
    warehouseId: 'wh-a',
    productId: 'product-quantity',
    quantity: 3,
    kind: 'OPENING',
    businessAt: '2026-07-27T08:00:00.000Z',
    batch: {
      sourceLineKey: 'opening:wh-a:product-quantity:line:1',
    },
  };
  await fixture.service.businessInbound(
    WAREHOUSE,
    command('INBOUND', {
      ...openingPayload,
      sourceKey: 'opening:wh-a:product-quantity:1',
      idempotencyKey: 'opening:wh-a:product-quantity:idem:1',
    }),
  );
  await assertCode(
    fixture.service.businessInbound(
      WAREHOUSE,
      command('INBOUND', {
        ...openingPayload,
        batch: {
          sourceLineKey: 'opening:wh-a:product-quantity:line:2',
        },
        sourceKey: 'opening:wh-a:product-quantity:2',
        idempotencyKey: 'opening:wh-a:product-quantity:idem:2',
      }),
    ),
    'INVENTORY_OPENING_ALREADY_EXISTS',
  );
  assert.equal(
    fixture.repository.state.batches.filter(
      (row) => row.openingEntryKey,
    ).length,
    1,
  );

  const disabled = createFixture();
  disabled.repository.state.configurations[0].maintenanceMode = false;
  await assertCode(
    disabled.service.businessInbound(
      WAREHOUSE,
      command('INBOUND', {
        ...openingPayload,
        sourceKey: 'opening:disabled:1',
        idempotencyKey: 'opening:disabled:idem:1',
      }),
    ),
    'INVENTORY_OPENING_WORKFLOW_NOT_ACTIVE',
  );
});

test('inventory inbound: sourceLineKey is the duplicate boundary and a failed cost transaction fully rolls back', async () => {
  const fixture = createFixture();
  const first = fixture.service.businessInbound(
    WAREHOUSE,
    command('INBOUND', {
      sourceKey: 'concurrent:inbound:1',
      idempotencyKey: 'concurrent:inbound:idem:1',
      warehouseId: 'wh-a',
      productId: 'product-quantity',
      quantity: 2,
      kind: 'PURCHASE_RECEIPT',
      batch: {
        sourceLineKey: 'concurrent:source-line:1',
        purchaseOrderNo: '0001',
        productionBatch: '0002',
      },
    }),
  );
  const second = fixture.service.businessInbound(
    WAREHOUSE,
    command('INBOUND', {
      sourceKey: 'concurrent:inbound:2',
      idempotencyKey: 'concurrent:inbound:idem:2',
      warehouseId: 'wh-a',
      productId: 'product-quantity',
      quantity: 2,
      kind: 'PURCHASE_RECEIPT',
      batch: {
        sourceLineKey: 'concurrent:source-line:1',
        purchaseOrderNo: '0001',
        productionBatch: '0002',
      },
    }),
  );
  const settled = await Promise.allSettled([first, second]);
  assert.equal(
    settled.filter((item) => item.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    settled.find((item) => item.status === 'rejected').reason.code,
    'INVENTORY_SOURCE_LINE_KEY_CONFLICT',
  );
  await fixture.service.businessInbound(
    WAREHOUSE,
    command('INBOUND', {
      sourceKey: 'concurrent:inbound:3',
      idempotencyKey: 'concurrent:inbound:idem:3',
      warehouseId: 'wh-a',
      productId: 'product-quantity',
      quantity: 1,
      kind: 'PURCHASE_RECEIPT',
      batch: {
        sourceLineKey: 'concurrent:source-line:2',
        purchaseOrderNo: '0001',
        productionBatch: '0002',
      },
    }),
  );
  assert.equal(fixture.repository.state.batches.length, 2);
  const batchId = fixture.repository.state.batches[0].id;
  const before = structuredClone(fixture.repository.state);
  fixture.operationLogs.failNext = true;
  await assert.rejects(
    fixture.service.updateBatchCost(
      FINANCE,
      command('UPDATE_BATCH_COST', {
        sourceKey: 'cost:rollback:1',
        idempotencyKey: 'cost:rollback:idem:1',
        batchId,
        purchaseUnitCostCents: 100,
        reason: 'Rollback test',
      }),
    ),
  );
  assert.deepEqual(fixture.repository.state, before);
});

function createFixture() {
  const repository = new MemoryInventoryRepository();
  const operationLogs = {
    failNext: false,
    async appendLog(log, transaction) {
      if (this.failNext) {
        this.failNext = false;
        throw new Error('TEST_AUDIT_FAILURE');
      }
      transaction.state.logs.push(structuredClone(log));
    },
  };
  const projector = {
    failuresRemaining: 0,
    calls: [],
    async refresh(task) {
      this.calls.push(structuredClone(task));
      if (this.failuresRemaining > 0) {
        this.failuresRemaining -= 1;
        const error = new Error('TEST_PROJECTOR_FAILURE');
        error.code = 'TEST_PROJECTOR_FAILURE';
        throw error;
      }
    },
  };
  const postCommit = new InventoryPostCommitService(
    repository,
    projector,
  );
  const service = new InventoryAccountingService(
    repository,
    operationLogs,
    postCommit,
    new SerializedInventoryAccountingAdapter(),
  );
  return {
    repository,
    operationLogs,
    projector,
    postCommit,
    service,
  };
}

class MemoryInventoryRepository {
  constructor() {
    this.sequence = 0;
    this.queue = Promise.resolve();
    this.queries = [];
    this.state = {
      products: [
        productRow('product-quantity', 'QUANTITY'),
        productRow('product-none', 'NONE'),
        productRow('product-serialized', 'SERIALIZED'),
      ],
      warehouses: [
        warehouseRow('wh-a'),
        warehouseRow('wh-b'),
      ],
      configurations: [
        {
          id: 'inventory-config',
          singletonKey: 'INVENTORY',
          goLiveAt: new Date('2026-07-27T12:00:00.000Z'),
          policyVersion: 1,
          maintenanceMode: true,
        },
      ],
      receipts: [],
      stocks: [],
      batches: [],
      reservations: [],
      transfers: [],
      transferLines: [],
      transferReceipts: [],
      transferReceiptLines: [],
      documents: [],
      lines: [],
      movements: [],
      tasks: [],
      logs: [],
      serializedUnits: [],
      productActualCosts: [
        {
          id: 'actual-cost-sentinel',
          productId: 'product-quantity',
          actualCostCents: 99_999,
        },
      ],
    };
  }

  async runInTransaction(work) {
    let release;
    const previous = this.queue;
    this.queue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    const working = structuredClone(this.state);
    try {
      const result = await work({ state: working });
      this.state = working;
      return result;
    } finally {
      release();
    }
  }

  root() {
    return { state: this.state };
  }

  stateOf(db) {
    return db?.state || this.state;
  }

  nextId(prefix) {
    this.sequence += 1;
    return `${prefix}-${this.sequence}-${crypto
      .randomUUID()
      .slice(0, 8)}`;
  }

  async findCommandReceipt(idempotencyKey, db) {
    return (
      this.stateOf(db).receipts.find(
        (row) => row.idempotencyKey === idempotencyKey,
      ) || null
    );
  }

  async createCommandReceipt(tx, data) {
    if (
      tx.state.receipts.some(
        (row) =>
          row.idempotencyKey === data.idempotencyKey ||
          row.sourceKey === data.sourceKey,
      )
    ) {
      throw uniqueError();
    }
    const row = rowWithId(this, 'receipt', data);
    tx.state.receipts.push(row);
    return row;
  }

  async completeCommandReceipt(tx, id, resultDocumentId, resultSnapshot) {
    const row = requiredRow(tx.state.receipts, id);
    Object.assign(row, {
      status: 'SUCCEEDED',
      resultDocumentId,
      resultSnapshot: structuredClone(resultSnapshot),
      completedAt: new Date(),
    });
    return row;
  }

  async findProduct(tx, id) {
    this.queries.push(`product:${id}`);
    return tx.state.products.find((row) => row.id === id) || null;
  }

  async findWarehouse(tx, id) {
    return tx.state.warehouses.find((row) => row.id === id) || null;
  }

  async findInventoryConfiguration(tx) {
    return (
      tx.state.configurations.find(
        (row) => row.singletonKey === 'INVENTORY',
      ) || null
    );
  }

  async findStock(tx, warehouseId, productId) {
    return (
      this.stateOf(tx).stocks.find(
        (row) =>
          row.warehouseId === warehouseId &&
          row.productId === productId,
      ) || null
    );
  }

  async getOrCreateStock(tx, warehouseId, productId) {
    const existing = await this.findStock(tx, warehouseId, productId);
    if (existing) return existing;
    const row = rowWithId(this, 'stock', {
      warehouseId,
      productId,
      onHandQty: 0,
      reservedQty: 0,
      unavailableQty: 0,
      inTransitQty: 0,
      version: 0,
      lastMovementId: null,
    });
    tx.state.stocks.push(row);
    return row;
  }

  async updateStockWithVersion(tx, stockRow, delta, lastMovementId) {
    const row = tx.state.stocks.find(
      (item) =>
        item.id === stockRow.id &&
        item.version === stockRow.version,
    );
    if (!row) return { count: 0 };
    row.onHandQty += delta.onHandDelta;
    row.reservedQty += delta.reservedDelta;
    row.unavailableQty += delta.unavailableDelta;
    row.inTransitQty += delta.inTransitDelta;
    row.version += 1;
    row.lastMovementId = lastMovementId;
    return { count: 1 };
  }

  async findBatch(tx, id) {
    const row = tx.state.batches.find((item) => item.id === id);
    return row ? structuredClone(row) : null;
  }

  async findBatchBySourceLineKey(tx, sourceLineKey) {
    return (
      tx.state.batches.find(
        (row) => row.sourceLineKey === sourceLineKey,
      ) || null
    );
  }

  async findBatchByOpeningEntryKey(tx, openingEntryKey) {
    return (
      tx.state.batches.find(
        (row) => row.openingEntryKey === openingEntryKey,
      ) || null
    );
  }

  async createBatch(tx, data) {
    if (
      tx.state.batches.some(
        (row) =>
          row.sourceLineKey === data.sourceLineKey ||
          (data.openingEntryKey &&
            row.openingEntryKey === data.openingEntryKey),
      )
    ) {
      throw uniqueError();
    }
    const row = rowWithId(this, 'batch', data);
    tx.state.batches.push(row);
    return row;
  }

  async updateBatchWithVersion(tx, batchRow, delta) {
    const row = tx.state.batches.find(
      (item) =>
        item.id === batchRow.id &&
        item.version === batchRow.version,
    );
    if (!row) return { count: 0 };
    row.receivedQty += delta.receivedDelta;
    row.remainingQty += delta.remainingDelta;
    row.unavailableQty += delta.unavailableDelta;
    row.version += 1;
    return { count: 1 };
  }

  async updateBatchCostWithVersion(tx, batchRow, data) {
    const row = tx.state.batches.find(
      (item) =>
        item.id === batchRow.id &&
        item.version === batchRow.version,
    );
    if (!row) return { count: 0 };
    row.purchaseUnitCostCents = data.purchaseUnitCostCents;
    row.costStatus = 'COMPLETE';
    row.unavailableQty += data.unavailableDelta;
    row.costCompletedById = data.actorUserId;
    row.costCompletedByName = data.actorName;
    row.costCompletedByRole = data.actorRole;
    row.costCompletedAt = data.completedAt;
    row.updatedById = data.updatedById;
    row.version += 1;
    return { count: 1 };
  }

  async findReservation(tx, id) {
    return tx.state.reservations.find((row) => row.id === id) || null;
  }

  async findReservationByOrderLine(tx, salesOrderId, inventoryLineKey) {
    return (
      tx.state.reservations.find(
        (row) =>
          row.salesOrderId === salesOrderId &&
          row.inventoryLineKey === inventoryLineKey,
      ) || null
    );
  }

  async createReservation(tx, data) {
    if (
      tx.state.reservations.some(
        (row) =>
          row.sourceKey === data.sourceKey ||
          (row.salesOrderId === data.salesOrderId &&
            row.inventoryLineKey === data.inventoryLineKey),
      )
    ) {
      throw uniqueError();
    }
    const row = rowWithId(this, 'reservation', data);
    tx.state.reservations.push(row);
    return row;
  }

  async updateReservationWithVersion(tx, reservationRow, data) {
    const row = tx.state.reservations.find(
      (item) =>
        item.id === reservationRow.id &&
        item.version === reservationRow.version,
    );
    if (!row) return { count: 0 };
    Object.assign(row, structuredClone(data));
    row.version += 1;
    return { count: 1 };
  }

  async createDocument(tx, data) {
    if (
      tx.state.documents.some(
        (row) =>
          row.sourceKey === data.sourceKey ||
          (data.reversalOfDocumentId != null &&
            row.reversalOfDocumentId === data.reversalOfDocumentId),
      )
    ) {
      throw uniqueError();
    }
    const row = rowWithId(this, 'document', data);
    tx.state.documents.push(row);
    return row;
  }

  async createDocumentLine(tx, data) {
    const row = rowWithId(this, 'line', data);
    tx.state.lines.push(row);
    return row;
  }

  async setDocumentLineBatch(tx, lineId, batchId) {
    const row = requiredRow(tx.state.lines, lineId);
    row.batchId = batchId;
    return row;
  }

  async createMovement(tx, data) {
    if (
      tx.state.movements.some(
        (row) =>
          row.sourceKey === data.sourceKey ||
          (data.reversalOfMovementId &&
            row.reversalOfMovementId ===
              data.reversalOfMovementId),
      )
    ) {
      throw uniqueError();
    }
    const row = rowWithId(this, 'movement', data);
    tx.state.movements.push(row);
    return row;
  }

  async createTransfer(tx, data) {
    if (
      tx.state.transfers.some(
        (row) =>
          row.sourceKey === data.sourceKey ||
          row.transferNo === data.transferNo,
      )
    ) {
      throw uniqueError();
    }
    const row = rowWithId(this, 'transfer', {
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    tx.state.transfers.push(row);
    return row;
  }

  async createTransferLine(tx, data) {
    if (
      tx.state.transferLines.some(
        (row) => row.sourceLineKey === data.sourceLineKey,
      )
    ) {
      throw uniqueError();
    }
    const row = rowWithId(this, 'transfer-line', data);
    tx.state.transferLines.push(row);
    return row;
  }

  async findTransfer(tx, id) {
    const state = this.stateOf(tx);
    const transfer = state.transfers.find((row) => row.id === id);
    if (!transfer) return null;
    return {
      ...structuredClone(transfer),
      fromWarehouse: structuredClone(
        requiredRow(state.warehouses, transfer.fromWarehouseId),
      ),
      toWarehouse: structuredClone(
        requiredRow(state.warehouses, transfer.toWarehouseId),
      ),
      lines: state.transferLines
        .filter((line) => line.transferId === id)
        .sort((left, right) => left.lineNo - right.lineNo)
        .map((line) => ({
          ...structuredClone(line),
          product: structuredClone(
            requiredRow(state.products, line.productId),
          ),
        })),
      receipts: state.transferReceipts
        .filter(
          (receipt) =>
            receipt.transferId === id &&
            receipt.status === 'POSTED',
        )
        .map((receipt) => ({ id: receipt.id })),
    };
  }

  async updateTransferWithVersion(tx, transfer, data) {
    const row = tx.state.transfers.find(
      (item) =>
        item.id === transfer.id &&
        item.version === transfer.version,
    );
    if (!row) return { count: 0 };
    applyPrismaPatch(row, data);
    row.version += 1;
    row.updatedAt = new Date();
    return { count: 1 };
  }

  async updateTransferLineWithVersion(tx, line, data) {
    const row = tx.state.transferLines.find(
      (item) =>
        item.id === line.id && item.version === line.version,
    );
    if (!row) return { count: 0 };
    applyPrismaPatch(row, data);
    row.version += 1;
    return { count: 1 };
  }

  async createTransferReceipt(tx, data) {
    if (
      tx.state.transferReceipts.some(
        (row) =>
          row.sourceKey === data.sourceKey ||
          row.idempotencyKey === data.idempotencyKey ||
          (data.reversalOfReceiptId &&
            row.reversalOfReceiptId === data.reversalOfReceiptId),
      )
    ) {
      throw uniqueError();
    }
    const row = rowWithId(this, 'transfer-receipt', {
      ...data,
      reversalOfReceiptId: data.reversalOfReceiptId ?? null,
      createdAt: new Date(),
    });
    tx.state.transferReceipts.push(row);
    return row;
  }

  async createTransferReceiptLine(tx, data) {
    const row = rowWithId(this, 'transfer-receipt-line', data);
    tx.state.transferReceiptLines.push(row);
    return row;
  }

  async findTransferReceipt(tx, id) {
    const state = this.stateOf(tx);
    const receipt = state.transferReceipts.find(
      (row) => row.id === id,
    );
    if (!receipt) return null;
    return {
      ...structuredClone(receipt),
      reversedByReceipt:
        state.transferReceipts.find(
          (row) => row.reversalOfReceiptId === id,
        ) || null,
      lines: state.transferReceiptLines
        .filter((line) => line.receiptId === id)
        .sort((left, right) => left.lineNo - right.lineNo)
        .map((line) => structuredClone(line)),
      transfer: await this.findTransfer(tx, receipt.transferId),
    };
  }

  async updateTransferReceiptWithVersion(tx, receipt, data) {
    const row = tx.state.transferReceipts.find(
      (item) =>
        item.id === receipt.id &&
        item.version === receipt.version,
    );
    if (!row) return { count: 0 };
    applyPrismaPatch(row, data);
    row.version += 1;
    return { count: 1 };
  }

  async findDocumentForReversal(tx, id) {
    const document = tx.state.documents.find((row) => row.id === id);
    if (!document) return null;
    return {
      ...structuredClone(document),
      reversedByDocument:
        tx.state.documents.find(
          (row) => row.reversalOfDocumentId === id,
        ) || null,
      lines: tx.state.lines
        .filter((line) => line.documentId === id)
        .sort((a, b) => a.lineNo - b.lineNo)
        .map((line) => ({
          ...structuredClone(line),
          movements: tx.state.movements
            .filter(
              (movement) => movement.documentLineId === line.id,
            )
            .map((movement) => structuredClone(movement)),
        })),
    };
  }

  async markDocumentReversed(tx, documentId, actor, reversedAt) {
    const row = requiredRow(tx.state.documents, documentId);
    row.status = 'REVERSED';
    row.reversedAt = reversedAt;
    row.reversedByNameSnapshot = actor.name;
    return row;
  }

  async createPostCommitTask(tx, data) {
    if (tx.state.tasks.some((row) => row.sourceKey === data.sourceKey)) {
      throw uniqueError();
    }
    const row = rowWithId(this, 'task', {
      ...data,
      attempts: 0,
      nextAttemptAt: new Date(),
      lockedAt: null,
      lastErrorCode: null,
      completedAt: null,
      createdAt: new Date(),
    });
    tx.state.tasks.push(row);
    return row;
  }

  async findPostCommitTaskByReceipt(commandReceiptId) {
    return (
      this.state.tasks.find(
        (row) => row.commandReceiptId === commandReceiptId,
      ) || null
    );
  }

  async claimPostCommitTask(id) {
    const row = this.state.tasks.find((item) => item.id === id);
    if (
      !row ||
      !['PENDING', 'FAILED'].includes(row.status) ||
      row.nextAttemptAt > new Date()
    ) {
      return null;
    }
    row.status = 'PROCESSING';
    row.attempts += 1;
    row.lockedAt = new Date();
    return structuredClone(row);
  }

  async completePostCommitTask(id) {
    const row = requiredRow(this.state.tasks, id);
    row.status = 'SUCCEEDED';
    row.completedAt = new Date();
    row.lockedAt = null;
    row.lastErrorCode = null;
    return row;
  }

  async failPostCommitTask(id, lastErrorCode, nextAttemptAt) {
    const row = requiredRow(this.state.tasks, id);
    row.status = 'FAILED';
    row.lastErrorCode = lastErrorCode;
    row.nextAttemptAt = nextAttemptAt;
    row.lockedAt = null;
    return row;
  }

  async listDuePostCommitTasks(limit) {
    return this.state.tasks
      .filter(
        (row) =>
          ['PENDING', 'FAILED'].includes(row.status) &&
          row.nextAttemptAt <= new Date(),
      )
      .slice(0, limit)
      .map((row) => ({ id: row.id }));
  }

  async recoverStalePostCommitTasks(staleBefore) {
    let count = 0;
    for (const row of this.state.tasks) {
      if (
        row.status === 'PROCESSING' &&
        row.lockedAt &&
        row.lockedAt <= staleBefore
      ) {
        row.status = 'FAILED';
        row.lockedAt = null;
        row.lastErrorCode = 'INVENTORY_POST_COMMIT_STALE_LOCK';
        row.nextAttemptAt = new Date();
        count += 1;
      }
    }
    return { count };
  }

  async listMovements(warehouseId, productId) {
    return this.state.movements
      .filter(
        (row) =>
          row.warehouseId === warehouseId &&
          row.productId === productId,
      )
      .map((row) => ({
        ...structuredClone(row),
        reversalOf: row.reversalOfMovementId
          ? structuredClone(
              this.state.movements.find(
                (original) =>
                  original.id === row.reversalOfMovementId,
              ),
            )
          : null,
      }));
  }

  async listBatches(warehouseId, productId) {
    return this.state.batches.filter(
      (row) =>
        row.warehouseId === warehouseId &&
        row.productId === productId,
    );
  }

  async listBatchMovements(batchId) {
    return this.state.movements
      .filter((row) => row.batchId === batchId)
      .map((row) => ({
        ...structuredClone(row),
        reversalOf: row.reversalOfMovementId
          ? structuredClone(
              this.state.movements.find(
                (original) =>
                  original.id === row.reversalOfMovementId,
              ),
            )
          : null,
      }));
  }

  async countSerializedUnits(warehouseId, productId) {
    const result = {};
    for (const row of this.state.serializedUnits.filter(
      (unit) =>
        unit.warehouseId === warehouseId &&
        unit.productId === productId,
    )) {
      result[row.status] = (result[row.status] || 0) + 1;
    }
    return result;
  }
}

function command(commandType, payload) {
  return {
    ...payload,
    requestHash: calculateInventoryRequestHash(commandType, payload),
  };
}

function productRow(id, inventoryTrackingMode) {
  return {
    id,
    name: id,
    unit: 'bottle',
    isActive: true,
    inventoryTrackingMode,
  };
}

function warehouseRow(id) {
  return {
    id,
    code: id,
    name: id,
    isActive: true,
  };
}

function rowWithId(repository, prefix, data) {
  return {
    id: repository.nextId(prefix),
    ...structuredClone(data),
  };
}

function applyPrismaPatch(row, data) {
  for (const [field, value] of Object.entries(data)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.hasOwn(value, 'increment')
    ) {
      row[field] += value.increment;
    } else {
      row[field] = structuredClone(value);
    }
  }
}

function requiredRow(rows, id) {
  const row = rows.find((item) => item.id === id);
  assert.ok(row, `row ${id} should exist`);
  return row;
}

function uniqueError() {
  const error = new Error('Unique constraint failed');
  error.code = 'P2002';
  return error;
}

function stock(fixture, warehouseId) {
  return fixture.repository.state.stocks.find(
    (row) =>
      row.warehouseId === warehouseId &&
      row.productId === 'product-quantity',
  );
}

function companyQuantity(fixture) {
  return fixture.repository.state.stocks.reduce(
    (sum, row) => sum + row.onHandQty + row.inTransitQty,
    0,
  );
}

function taskFor(fixture, commandReceiptId) {
  return fixture.repository.state.tasks.find(
    (row) => row.commandReceiptId === commandReceiptId,
  );
}

function pick(value, fields) {
  return Object.fromEntries(fields.map((field) => [field, value[field]]));
}

async function assertCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}
