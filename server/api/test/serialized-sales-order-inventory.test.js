const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SalesOrderInventoryService,
} = require('../src/modules/inventory/sales-order-inventory.service');

const ACTOR = {
  id: 'sales-or-warehouse',
  name: 'Order actor',
  role: 'warehouse',
};

test('serialized sales order hook reserves demand, accepts warehouse bottle selection and outbounds only assigned bottles', async () => {
  const fixture = createFixture({ availableUnits: 1 });
  const pending = orderFixture({
    packingStatus: 'PENDING',
    deliveryType: 'SHIPPING',
    quantity: 2,
    inventoryVersion: 0,
  });
  const first = await fixture.service.synchronize(
    fixture.transaction,
    ACTOR,
    null,
    pending,
    {
      serializedAssignments: [
        {
          inventoryLineKey: 'inventory-line:serialized',
          unitIds: ['unit-0001'],
        },
      ],
    },
  );
  assert.equal(first.changed, true);
  assert.equal(fixture.accountingCalls[0].commandType, 'RESERVE');
  assert.equal(fixture.accountingCalls[0].input.quantity, 2);
  assert.deepEqual(fixture.assignmentCalls[0], {
    reservationId: 'reservation-1',
    unitIds: ['unit-0001'],
    outbound: false,
    autoAssignCount: undefined,
  });
  assert.equal(fixture.reservations[0].assignedQty, 1);
  assert.equal(fixture.reservations[0].reservedQty, 2);

  const packedBefore = orderFixture({
    packingStatus: 'PENDING',
    deliveryType: 'SHIPPING',
    quantity: 2,
    inventoryVersion: 1,
  });
  const packedAfter = orderFixture({
    packingStatus: 'PACKED',
    deliveryType: 'SHIPPING',
    quantity: 2,
    inventoryVersion: 1,
  });
  const packed = await fixture.service.synchronize(
    fixture.transaction,
    ACTOR,
    packedBefore,
    packedAfter,
    {
      serializedAssignments: [
        {
          inventoryLineKey: 'inventory-line:serialized',
          unitIds: ['unit-0001'],
        },
      ],
    },
  );
  assert.equal(packed.shortageDetected, true);
  assert.equal(fixture.assignmentCalls.at(-1).outbound, true);
  assert.equal(fixture.reservations[0].outboundQty, 1);
  assert.equal(fixture.reservations[0].reservedQty, 1);
  assert.equal(
    fixture.accountingCalls.some(
      (call) => call.commandType === 'OUTBOUND',
    ),
    false,
  );
});

test('serialized self pickup uses stable FIFO auto-assignment count and leaves insufficiency as unassigned demand without fake units', async () => {
  const fixture = createFixture({ availableUnits: 1 });
  const selfPickup = orderFixture({
    packingStatus: 'PACKED',
    deliveryType: 'SELF_PICKUP',
    quantity: 2,
    inventoryVersion: 0,
  });
  const result = await fixture.service.synchronize(
    fixture.transaction,
    { id: 'sales-1', name: 'Sales', role: 'sales' },
    null,
    selfPickup,
  );
  assert.equal(result.shortageDetected, true);
  assert.equal(fixture.assignmentCalls.length, 1);
  assert.deepEqual(fixture.assignmentCalls[0], {
    reservationId: 'reservation-1',
    unitIds: [],
    outbound: true,
    autoAssignCount: 2,
  });
  assert.equal(fixture.reservations[0].outboundQty, 1);
  assert.equal(fixture.reservations[0].reservedQty, 1);
  assert.equal(fixture.createdAssignments, 1);
});

function createFixture({ availableUnits }) {
  const reservations = [];
  const accountingCalls = [];
  const assignmentCalls = [];
  let createdAssignments = 0;
  let orderVersion = 0;
  const transaction = {
    inventoryConfiguration: {},
    warehouse: {
      findUnique: async () => ({ id: 'warehouse-a', isActive: true }),
    },
    product: {
      findMany: async () => [
        {
          id: 'product-serialized',
          inventoryTrackingMode: 'SERIALIZED',
        },
      ],
    },
    inventoryReservation: {
      findMany: async () => reservations.map(clone),
      findUnique: async ({ where }) =>
        clone(
          reservations.find(
            (reservation) =>
              reservation.salesOrderId ===
                where.salesOrderId_inventoryLineKey.salesOrderId &&
              reservation.inventoryLineKey ===
                where.salesOrderId_inventoryLineKey.inventoryLineKey,
          ) || null,
        ),
      updateMany: async ({ where, data }) => {
        const reservation = reservations.find(
          (row) =>
            row.id === where.id && row.version === where.version,
        );
        if (!reservation) return { count: 0 };
        applyData(reservation, data);
        return { count: 1 };
      },
    },
    inventoryCommandReceipt: {},
    salesOrder: {
      updateMany: async ({ where, data }) => {
        if (where.inventoryVersion !== orderVersion) {
          return { count: 0 };
        }
        orderVersion += data.inventoryVersion.increment;
        return { count: 1 };
      },
    },
  };
  const accounting = {
    executeAutomaticInTransaction: async (
      commandType,
      _actor,
      input,
    ) => {
      accountingCalls.push({ commandType, input: clone(input) });
      if (commandType === 'OUTBOUND') {
        throw new Error(
          'Serialized lines must not use quantity outbound.',
        );
      }
      let reservation = reservations.find(
        (row) =>
          row.salesOrderId === input.salesOrderId &&
          row.inventoryLineKey === input.inventoryLineKey,
      );
      if (commandType === 'RESERVE') {
        if (!reservation) {
          reservation = {
            id: 'reservation-1',
            sourceKey: `${input.sourceKey}:reservation`,
            salesOrderId: input.salesOrderId,
            salesOrderItemId: input.salesOrderItemId,
            inventoryLineKey: input.inventoryLineKey,
            warehouseId: input.warehouseId,
            productId: input.productId,
            requestedQty: 0,
            reservedQty: 0,
            assignedQty: 0,
            outboundQty: 0,
            status: 'OPEN',
            version: 0,
          };
          reservations.push(reservation);
        }
        reservation.requestedQty += input.quantity;
        reservation.reservedQty += input.quantity;
        reservation.status = 'RESERVED';
        reservation.version += 1;
      } else if (commandType === 'RELEASE') {
        reservation = reservations.find(
          (row) => row.id === input.reservationId,
        );
        reservation.requestedQty -= input.quantity;
        reservation.reservedQty -= input.quantity;
        reservation.version += 1;
      }
      return {
        commandReceiptId: `receipt-${accountingCalls.length}`,
        reservation: clone(reservation),
        stockChanges: [
          {
            after: {
              shortageQty: Math.max(
                0,
                reservation.reservedQty - availableUnits,
              ),
            },
          },
        ],
      };
    },
    dispatchCommittedReceipts: async () => undefined,
  };
  const serialized = {
    releaseReservationAssignmentsInTransaction: async () => ({
      changed: false,
      commandReceiptIds: [],
    }),
    assignReservationUnitsInTransaction: async (
      _transaction,
      _actor,
      input,
    ) => {
      const reservation = reservations.find(
        (row) => row.id === input.reservationId,
      );
      assignmentCalls.push({
        reservationId: input.reservationId,
        unitIds: input.unitIds,
        outbound: input.outbound,
        autoAssignCount: input.autoAssignCount,
      });
      if (!input.outbound) {
        const count = input.unitIds.length;
        reservation.assignedQty += count;
        createdAssignments += count;
      } else {
        const actual = Math.min(
          availableUnits,
          reservation.reservedQty,
        );
        reservation.outboundQty += actual;
        reservation.reservedQty -= actual;
        reservation.assignedQty = 0;
        createdAssignments += Math.max(
          0,
          actual - createdAssignments,
        );
      }
      reservation.version += 1;
      return {
        changed: true,
        commandReceiptIds: ['serialized-receipt'],
        assignedQty: reservation.assignedQty,
        outboundQty: reservation.outboundQty,
      };
    },
  };
  const service = new SalesOrderInventoryService(
    accounting,
    serialized,
  );
  return {
    service,
    transaction,
    reservations,
    accountingCalls,
    assignmentCalls,
    get createdAssignments() {
      return createdAssignments;
    },
  };
}

function orderFixture({
  packingStatus,
  deliveryType,
  quantity,
  inventoryVersion,
}) {
  return {
    id: 'sales-order-serialized',
    orderType: 'DIRECT',
    status: 'VALID',
    packingStatus,
    fulfillmentWarehouseId: 'warehouse-a',
    inventoryAppliedAt: new Date('2026-07-27T00:00:00.000Z'),
    inventoryPolicyVersion: 1,
    inventoryVersion,
    items: [
      {
        id: 'sales-item-serialized',
        inventoryLineKey: 'inventory-line:serialized',
        productId: 'product-serialized',
        quantity,
        deliveryType,
      },
    ],
  };
}

function applyData(row, data) {
  for (const [key, value] of Object.entries(data)) {
    row[key] =
      value &&
      typeof value === 'object' &&
      Number.isInteger(value.increment)
        ? Number(row[key] || 0) + value.increment
        : value;
  }
}

function clone(value) {
  return value === null || value === undefined
    ? value
    : structuredClone(value);
}
