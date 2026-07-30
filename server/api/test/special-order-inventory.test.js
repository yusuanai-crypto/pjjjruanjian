const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SpecialOrderInventoryService,
} = require('../src/modules/special-orders/special-order-inventory.service');

const actor = {
  id: 'reviewer-1',
  name: 'Reviewer',
  role: 'admin',
};

test('internal/external approval reserves each line in its own warehouse', async () => {
  const calls = [];
  const service = createService({
    accounting: {
      async executeAutomaticInTransaction(commandType, _actor, input) {
        calls.push({ commandType, input });
        return {
          commandReceiptId: `receipt-${calls.length}`,
          documentId: null,
          reservation:
            commandType === 'RESERVE'
              ? {
                  id: `reservation-${calls.length}`,
                  warehouseId: input.warehouseId,
                }
              : null,
        };
      },
    },
  });
  const tx = baseTransaction();
  await service.postApprovalInTransaction(
    tx,
    actor,
    order('INTERNAL', [
      quantityLine('line-a', 'warehouse-a', 2),
      quantityLine('line-b', 'warehouse-b', 3),
    ]),
    2,
  );
  assert.deepEqual(
    calls.map((call) => [
      call.commandType,
      call.input.warehouseId,
      call.input.quantity,
    ]),
    [
      ['RESERVE', 'warehouse-a', 2],
      ['RESERVE', 'warehouse-b', 3],
    ],
  );
});

test('self-pickup leaves approval with an immediate outbound while shipping waits for completion', async () => {
  const calls = [];
  const service = createService({
    accounting: {
      async executeAutomaticInTransaction(commandType, _actor, input) {
        calls.push({ commandType, input });
        return {
          commandReceiptId: `receipt-${calls.length}`,
          documentId:
            commandType === 'OUTBOUND' ? `document-${calls.length}` : null,
          reservation:
            commandType === 'RESERVE'
              ? {
                  id: `reservation-${calls.length}`,
                  warehouseId: input.warehouseId,
                }
              : null,
        };
      },
    },
  });
  const pickup = {
    ...quantityLine('line-pickup', 'warehouse-a', 2),
    deliveryType: 'SELF_PICKUP',
  };
  const shipping = quantityLine('line-shipping', 'warehouse-b', 3);

  await service.postApprovalInTransaction(
    baseTransaction(),
    actor,
    order('EXTERNAL', [pickup, shipping]),
    1,
  );

  assert.deepEqual(
    calls.map((call) => call.commandType),
    ['RESERVE', 'OUTBOUND', 'RESERVE'],
  );
  assert.equal(calls[1].input.reservationId, 'reservation-1');
  assert.equal(calls[1].input.quantity, 2);
});

test('shipping completion consumes the outstanding reservation from its line warehouse', async () => {
  const calls = [];
  const service = createService({
    accounting: {
      async executeAutomaticInTransaction(commandType, _actor, input) {
        calls.push({ commandType, input });
        return {
          commandReceiptId: 'receipt-shipping-out',
          documentId: 'document-shipping-out',
        };
      },
    },
  });
  const line = quantityLine('line-shipping', 'warehouse-b', 3);
  const tx = baseTransaction();
  tx.inventoryReservation = {
    async findMany() {
      return [
        {
          id: 'reservation-shipping',
          salesOrderId: 'order-external',
          inventoryLineKey: line.inventoryLineKey,
          warehouseId: 'warehouse-b',
          reservedQty: 3,
        },
      ];
    },
  };

  await service.postCompletionInTransaction(
    tx,
    actor,
    order('EXTERNAL', [line]),
    2,
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].commandType, 'OUTBOUND');
  assert.equal(calls[0].input.warehouseId, 'warehouse-b');
  assert.equal(calls[0].input.reservationId, 'reservation-shipping');
  assert.equal(calls[0].input.quantity, 3);
});

test('buyback approval ignores form warehouses and creates purchase inbound in the unique default warehouse', async () => {
  const calls = [];
  const service = createService({
    accounting: {
      async executeAutomaticInTransaction(commandType, _actor, input) {
        calls.push({ commandType, input });
        return {
          commandReceiptId: 'receipt-buyback',
          documentId: 'document-buyback',
        };
      },
    },
  });
  const tx = baseTransaction({
    defaultWarehouses: [
      {
        id: 'warehouse-default',
        name: '默认总仓',
        isActive: true,
        isDefault: true,
      },
    ],
  });
  await service.postApprovalInTransaction(
    tx,
    actor,
    order('BUYBACK', [
      {
        ...quantityLine('line-buyback', 'warehouse-from-form', 4),
        unitPriceCents: 18800,
      },
    ]),
    1,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].commandType, 'INBOUND');
  assert.equal(calls[0].input.warehouseId, 'warehouse-default');
  assert.equal(calls[0].input.kind, 'PURCHASE_RECEIPT');
  assert.equal(calls[0].input.batch.purchaseUnitCostCents, 18800);
});

test('negative sales adjustment posts an opposite inbound and keeps the reason', async () => {
  const calls = [];
  const service = createService({
    accounting: {
      async executeAutomaticInTransaction(commandType, _actor, input) {
        calls.push({ commandType, input });
        return {
          commandReceiptId: 'receipt-adjustment',
          documentId: 'document-adjustment',
        };
      },
    },
  });
  await service.postApprovalInTransaction(
    baseTransaction(),
    actor,
    order('EXTERNAL', [
      {
        ...quantityLine('line-negative', 'warehouse-a', -2),
        adjustmentReason: '更正重复销售行',
      },
    ]),
    3,
  );
  assert.equal(calls[0].commandType, 'INBOUND');
  assert.equal(calls[0].input.quantity, 2);
  assert.equal(calls[0].input.kind, 'OTHER_IN');
  assert.equal(calls[0].input.reason, '更正重复销售行');
});

test('serialized buyback uses every supplied logistics code and never invents one', async () => {
  let serializedInput;
  const service = createService({
    serialized: {
      async createUnitsInTransaction(_tx, _actor, input) {
        serializedInput = input;
        return {
          commandReceiptIds: ['receipt-serialized'],
          documentIds: ['document-serialized'],
          unitIds: ['unit-1', 'unit-2'],
        };
      },
    },
  });
  const tx = baseTransaction({
    defaultWarehouses: [{ id: 'warehouse-default', isActive: true }],
  });
  tx.inventoryBatch.findUnique = async () => null;
  tx.inventoryBatch.create = async ({ data }) => ({ ...data });
  tx.serializedInventoryUnit = {
    updateMany: async () => ({ count: 2 }),
  };
  const line = {
    ...quantityLine('line-serialized', 'ignored', 2),
    product: {
      id: 'product-serialized',
      name: '逐瓶商品',
      unit: '瓶',
      inventoryTrackingMode: 'SERIALIZED',
    },
    specialSerializedUnits: [
      {
        logisticsCodeSnapshot: 'REAL-001',
        normalizedLogisticsCode: 'REAL-001',
      },
      {
        logisticsCodeSnapshot: 'REAL-002',
        normalizedLogisticsCode: 'REAL-002',
      },
    ],
  };
  await service.postApprovalInTransaction(
    tx,
    actor,
    order('BUYBACK', [line]),
    1,
  );
  assert.deepEqual(
    serializedInput.units.map((unit) => unit.logisticsCode),
    ['REAL-001', 'REAL-002'],
  );
  assert.equal(serializedInput.warehouseId, 'warehouse-default');
  assert.equal(serializedInput.sourceType, 'SPECIAL_ORDER_BUYBACK');
});

test('serialized negative adjustment is rejected instead of fabricating a bottle correction', async () => {
  const service = createService();
  const line = {
    ...quantityLine('line-serialized-negative', 'warehouse-a', -1),
    adjustmentReason: '瓶码更正',
    product: {
      id: 'product-serialized',
      name: '逐瓶商品',
      unit: '瓶',
      inventoryTrackingMode: 'SERIALIZED',
    },
  };
  await assert.rejects(
    service.postApprovalInTransaction(
      baseTransaction(),
      actor,
      order('INTERNAL', [line]),
      1,
    ),
    (error) =>
      error.statusCode === 409 &&
      error.code === 'SERIALIZED_NEGATIVE_ADJUSTMENT_UNSUPPORTED',
  );
});

test('unapproval reverses posted quantity documents instead of deleting inventory facts', async () => {
  const calls = [];
  const service = createService({
    accounting: {
      async executeAutomaticInTransaction(commandType, _actor, input) {
        calls.push({ commandType, input });
        return {
          commandReceiptId: 'receipt-reversal',
          documentId: 'document-reversal',
        };
      },
    },
  });
  const tx = baseTransaction();
  tx.inventoryReservation = {
    async findMany() {
      return [];
    },
  };
  tx.serializedInventoryUnit = {
    async findMany() {
      return [];
    },
  };
  tx.inventoryDocument = {
    async findMany() {
      return [
        {
          id: 'posted-sales-out',
          status: 'POSTED',
          type: 'SALES_OUTBOUND',
          lines: [{ movements: [{ id: 'movement-out' }] }],
        },
      ];
    },
  };

  await service.reverseInTransaction(
    tx,
    actor,
    order('INTERNAL', [quantityLine('line-a', 'warehouse-a', 1)]),
    3,
    '审核方向错误',
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].commandType, 'REVERSE');
  assert.equal(calls[0].input.documentId, 'posted-sales-out');
  assert.equal(calls[0].input.reason, '审核方向错误');
});

function createService(overrides = {}) {
  const accounting = overrides.accounting || {
    async executeAutomaticInTransaction() {
      throw new Error('Unexpected quantity accounting command.');
    },
    async dispatchCommittedReceipts() {},
  };
  const serialized = overrides.serialized || {
    async createUnitsInTransaction() {
      throw new Error('Unexpected serialized create command.');
    },
  };
  return new SpecialOrderInventoryService(accounting, serialized);
}

function baseTransaction(options = {}) {
  const defaultWarehouses = options.defaultWarehouses || [];
  return {
    warehouse: {
      async findMany() {
        return defaultWarehouses;
      },
      async findUnique({ where }) {
        return (
          defaultWarehouses.find((warehouse) => warehouse.id === where.id) || {
            id: where.id,
            isActive: true,
          }
        );
      },
    },
    inventoryBatch: {
      async findMany() {
        return [];
      },
    },
  };
}

function order(orderType, items) {
  return {
    id: `order-${orderType.toLowerCase()}`,
    orderNo: `SO-${orderType}`,
    orderType,
    orderDate: new Date('2026-07-29T00:00:00.000Z'),
    customerName: '交易对象',
    items,
  };
}

function quantityLine(id, warehouseId, quantity) {
  return {
    id,
    inventoryLineKey: `inventory-${id}`,
    warehouseId,
    quantity,
    unitPriceCents: 1000,
    inventoryCondition: 'SALEABLE',
    deliveryType: 'SHIPPING',
    adjustmentReason: null,
    notes: null,
    specialSerializedUnits: [],
    product: {
      id: `product-${id}`,
      name: `商品-${id}`,
      unit: '瓶',
      inventoryTrackingMode: 'QUANTITY',
    },
  };
}
