const assert = require('node:assert/strict');
const test = require('node:test');

const {
  classifyAllocatedUnit,
} = require('../scripts/plan-serialized-inventory-cutover');

function allocatedFixture(overrides = {}) {
  const item = {
    id: 'item-1',
    deliveryType: 'SHIPPING',
    inventoryLineKey: 'inventory-line:1',
    ...(overrides.item || {}),
  };
  const order = {
    id: 'order-1',
    status: 'VALID',
    packingStatus: 'PENDING',
    items: [item],
    ...(overrides.order || {}),
  };
  return {
    id: 'unit-1',
    warehouseId: 'warehouse-1',
    purchaseCostCents: 1,
    logisticsCode: '000001',
    factoryDate: new Date('2026-01-01T00:00:00.000Z'),
    productionBatch: '00001',
    batchSerialNo: '000001',
    salesOrder: order,
    salesOrderItem: item,
    ...overrides,
  };
}

test('allocated cutover preview classifies only complete active shipping facts as candidates', () => {
  assert.equal(
    classifyAllocatedUnit(allocatedFixture()).classification,
    'CANDIDATE_RESERVED',
  );
  assert.equal(
    classifyAllocatedUnit(
      allocatedFixture({
        order: {
          status: 'VALID',
          packingStatus: 'PACKED',
          items: [
            {
              id: 'item-1',
              deliveryType: 'SHIPPING',
              inventoryLineKey: 'inventory-line:1',
            },
          ],
        },
      }),
    ).classification,
    'CANDIDATE_OUTBOUND',
  );
});

test('allocated cutover preview never guesses self pickup, terminal, mixed, missing or incomplete facts', () => {
  const selfPickup = allocatedFixture({
    item: { deliveryType: 'SELF_PICKUP' },
  });
  selfPickup.salesOrder.items = [selfPickup.salesOrderItem];
  assert.equal(
    classifyAllocatedUnit(selfPickup).classification,
    'MANUAL_CONFIRMATION',
  );

  assert.equal(
    classifyAllocatedUnit(
      allocatedFixture({
        order: {
          status: 'CANCELLED',
          packingStatus: 'PACKED',
          items: [],
        },
      }),
    ).classification,
    'MANUAL_CONFIRMATION',
  );

  const mixed = allocatedFixture();
  mixed.salesOrder.items.push({
    id: 'item-2',
    deliveryType: 'SELF_PICKUP',
  });
  assert.equal(
    classifyAllocatedUnit(mixed).classification,
    'MANUAL_CONFIRMATION',
  );

  const missing = allocatedFixture({ salesOrder: null });
  assert.equal(
    classifyAllocatedUnit(missing).classification,
    'CONFLICT',
  );

  const incomplete = allocatedFixture({ warehouseId: null });
  const result = classifyAllocatedUnit(incomplete);
  assert.equal(result.classification, 'MANUAL_CONFIRMATION');
  assert.equal(result.suggestedClassification, 'CANDIDATE_RESERVED');
  assert.equal(result.reasons.includes('warehouse_missing'), true);
});
