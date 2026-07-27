const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  SerializedInventoryAccountingAdapter,
} = require('../src/modules/inventory/serialized-inventory-accounting.adapter');
const {
  rebuildSerializedConsistency,
} = require('../src/modules/inventory/inventory-accounting.service');

const WAREHOUSE = {
  id: 'user-warehouse',
  name: 'Warehouse user',
  role: 'warehouse',
};
const FINANCE = {
  id: 'user-finance',
  name: 'Finance user',
  role: 'finance',
};

test('serialized rebuild check cross-validates unit, assignment, movement, reservation and stock snapshots', () => {
  const rows = {
    units: [
      consistencyUnit('unit-available', 'AVAILABLE', [], [
        consistencyMovement('movement-in-1', 'PURCHASE_IN'),
      ]),
      consistencyUnit(
        'unit-reserved',
        'RESERVED',
        [
          {
            id: 'assignment-reserved',
            reservationId: 'reservation-1',
            status: 'RESERVED',
            activeUnitKey: 'unit-reserved',
          },
        ],
        [
          consistencyMovement(
            'movement-reserve',
            'RESERVE',
            'reservation-1',
          ),
        ],
      ),
      consistencyUnit(
        'unit-outbound',
        'OUTBOUND',
        [
          {
            id: 'assignment-outbound',
            reservationId: 'reservation-1',
            status: 'OUTBOUND',
            activeUnitKey: null,
          },
        ],
        [
          consistencyMovement(
            'movement-outbound',
            'SALES_OUT',
            'reservation-1',
          ),
        ],
      ),
    ],
    reservations: [
      {
        id: 'reservation-1',
        assignedQty: 1,
        outboundQty: 1,
        assignments: [
          {
            id: 'assignment-reserved',
            serializedUnitId: 'unit-reserved',
            status: 'RESERVED',
            activeUnitKey: 'unit-reserved',
          },
          {
            id: 'assignment-outbound',
            serializedUnitId: 'unit-outbound',
            status: 'OUTBOUND',
            activeUnitKey: null,
          },
        ],
      },
    ],
  };
  const consistent = rebuildSerializedConsistency(rows, {
    onHandQty: 2,
    reservedQty: 2,
    unavailableQty: 0,
    inTransitQty: 0,
  });
  assert.equal(consistent.consistent, true);

  rows.units[1].assignments[0].activeUnitKey = null;
  const mismatch = rebuildSerializedConsistency(rows, {
    onHandQty: 2,
    reservedQty: 2,
    unavailableQty: 0,
    inTransitQty: 0,
  });
  assert.equal(mismatch.consistent, false);
  assert.equal(
    mismatch.issues.some(
      (issue) =>
        issue.code === 'SERIALIZED_ACTIVE_UNIT_KEY_MISMATCH',
    ),
    true,
  );
});

test('serialized accounting: inbound, cost completion, assignment, release and partial outbound keep four facts consistent', async () => {
  const fixture = createFixture();
  const inboundCommand = {
    warehouseId: 'warehouse-a',
    productId: 'product-serialized',
    sourceKey: 'serialized-test:inbound',
    idempotencyKey: 'serialized-test:inbound:idem',
    units: [
      unitInput('000001', null),
      unitInput('000002', 200),
    ],
  };
  const inbound = await fixture.adapter.createUnits(
    WAREHOUSE,
    inboundCommand,
  );
  assert.equal(inbound.replayed, false);
  assert.equal(inbound.unitIds.length, 2);
  const replay = await fixture.adapter.createUnits(
    WAREHOUSE,
    inboundCommand,
  );
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.unitIds, inbound.unitIds);
  assert.equal(fixture.state.units.length, 2);
  await assert.rejects(
    () =>
      fixture.adapter.createUnits(WAREHOUSE, {
        ...inboundCommand,
        units: [unitInput('000003', 300)],
      }),
    (error) =>
      error.code === 'INVENTORY_IDEMPOTENCY_KEY_CONFLICT',
  );
  assert.equal(fixture.state.units.length, 2);
  assert.deepEqual(stockSnapshot(fixture.state), {
    onHandQty: 2,
    reservedQty: 0,
    unavailableQty: 1,
    inTransitQty: 0,
    version: 1,
  });
  assert.deepEqual(
    fixture.state.units.map((unit) => unit.status).sort(),
    ['AVAILABLE', 'PENDING_COST'],
  );
  assert.equal(
    fixture.state.movements.every(
      (movement) => movement.serializedUnitId,
    ),
    true,
  );

  const pending = fixture.state.units.find(
    (unit) => unit.status === 'PENDING_COST',
  );
  await fixture.adapter.completeUnitCost(
    FINANCE,
    pending.id,
    100,
    'Cost verified.',
    {
      sourceKey: 'serialized-test:cost',
      idempotencyKey: 'serialized-test:cost:idem',
    },
  );
  assert.equal(pending.status, 'AVAILABLE');
  assert.equal(pending.purchaseCostCents, 100);
  assert.equal(stockSnapshot(fixture.state).unavailableQty, 0);
  assert.equal(
    fixture.state.movements.at(-1).movementType,
    'UNAVAILABLE_OUT',
  );
  assert.deepEqual(
    fixture.state.logs.at(-1).beforeData,
    {
      unitId: pending.id,
      status: 'pending_cost',
      purchaseCostCents: null,
    },
  );
  assert.equal(
    fixture.state.logs.at(-1).afterData.purchaseCostCents,
    100,
  );

  const itemId = 'sales-item-serialized';
  fixture.state.items.push({
    id: itemId,
    quantity: 3,
    subtotalCents: 900,
    actualUnitCostCents: null,
    actualCostSubtotalCents: null,
    grossProfitCents: null,
  });
  fixture.state.reservations.push({
    id: 'reservation-serialized',
    sourceKey: 'serialized-test:reservation',
    salesOrderId: 'sales-order-serialized',
    salesOrderItemId: itemId,
    inventoryLineKey: 'inventory-line:serialized',
    warehouseId: 'warehouse-a',
    productId: 'product-serialized',
    requestedQty: 3,
    reservedQty: 3,
    assignedQty: 0,
    outboundQty: 0,
    status: 'RESERVED',
    version: 0,
  });
  fixture.state.stocks[0].reservedQty = 3;

  const assigned =
    await fixture.adapter.assignReservationUnitsInTransaction(
      fixture.transaction,
      WAREHOUSE,
      {
        reservationId: 'reservation-serialized',
        unitIds: [pending.id],
        outbound: false,
        sourceKey: 'serialized-test:assign',
      },
    );
  assert.equal(assigned.assignedQty, 1);
  assert.equal(pending.status, 'RESERVED');
  assert.equal(
    fixture.state.assignments[0].activeUnitKey,
    pending.id,
  );
  const reserveMarker = fixture.state.movements.at(-1);
  assert.equal(reserveMarker.movementType, 'RESERVE');
  assert.equal(reserveMarker.serializedUnitId, pending.id);
  assert.equal(sumMovementDelta(reserveMarker), 0);

  await fixture.adapter.releaseReservationAssignmentsInTransaction(
    fixture.transaction,
    WAREHOUSE,
    {
      reservationId: 'reservation-serialized',
      keepQty: 0,
      sourceKey: 'serialized-test:release',
      reason: 'Packing selection changed.',
    },
  );
  assert.equal(pending.status, 'AVAILABLE');
  assert.equal(fixture.state.assignments[0].status, 'RELEASED');
  assert.equal(fixture.state.assignments[0].activeUnitKey, null);
  assert.equal(
    fixture.state.movements.at(-1).movementType,
    'RELEASE',
  );

  const outbound =
    await fixture.adapter.assignReservationUnitsInTransaction(
      fixture.transaction,
      WAREHOUSE,
      {
        reservationId: 'reservation-serialized',
        unitIds: [],
        autoAssignCount: 3,
        outbound: true,
        sourceKey: 'serialized-test:self-pickup-outbound',
      },
    );
  assert.equal(outbound.outboundQty, 2);
  const reservation = fixture.state.reservations[0];
  assert.equal(reservation.outboundQty, 2);
  assert.equal(reservation.reservedQty, 1);
  assert.equal(reservation.assignedQty, 0);
  assert.equal(reservation.status, 'PARTIAL');
  assert.deepEqual(stockSnapshot(fixture.state), {
    onHandQty: 0,
    reservedQty: 1,
    unavailableQty: 0,
    inTransitQty: 0,
    version: 3,
  });
  assert.equal(
    fixture.state.units.filter((unit) => unit.status === 'OUTBOUND')
      .length,
    2,
  );
  assert.equal(
    fixture.state.assignments.filter(
      (assignment) => assignment.status === 'OUTBOUND',
    ).length,
    2,
  );
  assert.equal(
    fixture.state.assignments.filter(
      (assignment) => assignment.status !== 'RELEASED',
    ).length,
    2,
  );
  assert.equal(
    fixture.state.movements.filter(
      (movement) =>
        movement.movementType === 'SALES_OUT' &&
        movement.serializedUnitId,
    ).length,
    2,
  );
  assert.equal(
    fixture.state.items[0].actualCostSubtotalCents,
    300,
  );
  assert.equal(fixture.state.items[0].grossProfitCents, null);

  const retry =
    await fixture.adapter.assignReservationUnitsInTransaction(
      fixture.transaction,
      WAREHOUSE,
      {
        reservationId: 'reservation-serialized',
        unitIds: [],
        autoAssignCount: 1,
        outbound: true,
        sourceKey: 'serialized-test:self-pickup-retry',
      },
    );
  assert.equal(retry.changed, false);
  assert.equal(
    fixture.state.assignments.filter(
      (assignment) => assignment.status === 'OUTBOUND',
    ).length,
    2,
  );
});

test('serialized accounting: transfer state updates are warehouse/version conditional and preserve leading-zero codes', async () => {
  const fixture = createFixture();
  fixture.state.units.push(
    storedUnit({
      id: 'transfer-unit-1',
      logisticsCode: '0000000001',
      normalizedLogisticsCode: '0000000001',
      purchaseCostCents: 100,
      status: 'AVAILABLE',
    }),
  );
  const [unit] =
    await fixture.adapter.transitionTransferOutboundInTransaction(
      fixture.transaction,
      WAREHOUSE,
      {
        unitIds: ['transfer-unit-1'],
        productId: 'product-serialized',
        fromWarehouseId: 'warehouse-a',
      },
    );
  assert.equal(unit.logisticsCode, '0000000001');
  assert.equal(fixture.state.units[0].status, 'OUTBOUND');
  assert.equal(fixture.state.units[0].version, 1);

  await fixture.adapter.transitionTransferReceiptInTransaction(
    fixture.transaction,
    WAREHOUSE,
    {
      receivedUnitIds: ['transfer-unit-1'],
      unavailableUnitIds: ['transfer-unit-1'],
      differenceUnitIds: [],
      productId: 'product-serialized',
      fromWarehouseId: 'warehouse-a',
      toWarehouseId: 'warehouse-b',
      transferUnitIds: ['transfer-unit-1'],
    },
  );
  assert.equal(fixture.state.units[0].warehouseId, 'warehouse-b');
  assert.equal(fixture.state.units[0].status, 'UNAVAILABLE');
  assert.equal(fixture.state.units[0].version, 2);

  await assert.rejects(
    () =>
      fixture.adapter.transitionTransferOutboundInTransaction(
        fixture.transaction,
        WAREHOUSE,
        {
          unitIds: ['transfer-unit-1'],
          productId: 'product-serialized',
          fromWarehouseId: 'warehouse-a',
        },
      ),
    (error) =>
      error.code ===
      'INVENTORY_SERIALIZED_TRANSFER_UNIT_UNAVAILABLE',
  );
});

function createFixture() {
  const state = {
    products: [
      {
        id: 'product-serialized',
        name: 'Serialized product',
        unit: 'bottle',
        isActive: true,
        inventoryTrackingMode: 'SERIALIZED',
      },
    ],
    warehouses: [
      {
        id: 'warehouse-a',
        code: 'A',
        name: 'Warehouse A',
        isActive: true,
      },
      {
        id: 'warehouse-b',
        code: 'B',
        name: 'Warehouse B',
        isActive: true,
      },
    ],
    stocks: [],
    units: [],
    reservations: [],
    assignments: [],
    items: [],
    receipts: [],
    documents: [],
    lines: [],
    movements: [],
    tasks: [],
    logs: [],
  };
  const transaction = createTransaction(state);
  const repository = new MemoryRepository(state, transaction);
  const logs = {
    appendLog: async (entry) => {
      state.logs.push(clone(entry));
    },
  };
  const postCommit = {
    dispatchForReceipt: async () => undefined,
  };
  const adapter = new SerializedInventoryAccountingAdapter(
    repository,
    logs,
    postCommit,
  );
  return { state, transaction, repository, adapter };
}

class MemoryRepository {
  constructor(state, transaction) {
    this.state = state;
    this.transaction = transaction;
  }

  async runInTransaction(work) {
    const snapshot = clone(this.state);
    try {
      return await work(this.transaction);
    } catch (error) {
      for (const key of Object.keys(this.state)) {
        this.state[key].splice(
          0,
          this.state[key].length,
          ...snapshot[key],
        );
      }
      throw error;
    }
  }

  async findCommandReceipt(idempotencyKey) {
    return (
      this.state.receipts.find(
        (receipt) => receipt.idempotencyKey === idempotencyKey,
      ) || null
    );
  }

  async createCommandReceipt(_transaction, data) {
    const row = {
      id: crypto.randomUUID(),
      resultSnapshot: null,
      ...clone(data),
    };
    this.state.receipts.push(row);
    return row;
  }

  async completeCommandReceipt(
    _transaction,
    id,
    resultDocumentId,
    resultSnapshot,
  ) {
    const row = this.state.receipts.find((receipt) => receipt.id === id);
    Object.assign(row, {
      status: 'SUCCEEDED',
      resultDocumentId,
      resultSnapshot: clone(resultSnapshot),
      completedAt: new Date(),
    });
    return row;
  }

  async findProduct(_transaction, id) {
    return clone(
      this.state.products.find((product) => product.id === id) || null,
    );
  }

  async findWarehouse(_transaction, id) {
    return clone(
      this.state.warehouses.find(
        (warehouse) => warehouse.id === id,
      ) || null,
    );
  }

  async createDocument(_transaction, data) {
    const row = { id: crypto.randomUUID(), ...clone(data) };
    this.state.documents.push(row);
    return row;
  }

  async createDocumentLine(_transaction, data) {
    const row = { id: crypto.randomUUID(), ...clone(data) };
    this.state.lines.push(row);
    return row;
  }

  async createMovement(_transaction, data) {
    const row = { id: crypto.randomUUID(), ...clone(data) };
    this.state.movements.push(row);
    return row;
  }

  async getOrCreateStock(_transaction, warehouseId, productId) {
    let stock = this.state.stocks.find(
      (row) =>
        row.warehouseId === warehouseId &&
        row.productId === productId,
    );
    if (!stock) {
      stock = {
        id: crypto.randomUUID(),
        warehouseId,
        productId,
        onHandQty: 0,
        reservedQty: 0,
        unavailableQty: 0,
        inTransitQty: 0,
        version: 0,
        lastMovementId: null,
      };
      this.state.stocks.push(stock);
    }
    return clone(stock);
  }

  async updateStockWithVersion(
    _transaction,
    stock,
    delta,
    lastMovementId,
  ) {
    const current = this.state.stocks.find(
      (row) => row.id === stock.id && row.version === stock.version,
    );
    if (!current) {
      return { count: 0 };
    }
    current.onHandQty += delta.onHandDelta;
    current.reservedQty += delta.reservedDelta;
    current.unavailableQty += delta.unavailableDelta;
    current.inTransitQty += delta.inTransitDelta;
    current.version += 1;
    current.lastMovementId = lastMovementId;
    return { count: 1 };
  }

  async createPostCommitTask(_transaction, data) {
    const row = { id: crypto.randomUUID(), ...clone(data) };
    this.state.tasks.push(row);
    return row;
  }
}

function createTransaction(state) {
  return {
    serializedInventoryUnit: {
      create: async ({ data }) => {
        if (
          state.units.some(
            (unit) =>
              unit.normalizedLogisticsCode ===
              data.normalizedLogisticsCode,
          )
        ) {
          const error = new Error('duplicate logistics code');
          error.code = 'P2002';
          throw error;
        }
        const row = storedUnit(data);
        state.units.push(row);
        return clone(row);
      },
      findUnique: async ({ where }) =>
        clone(
          state.units.find((unit) => unit.id === where.id) || null,
        ),
      findMany: async ({ where = {}, take } = {}) => {
        let rows = state.units.filter((unit) =>
          matchesUnit(unit, where),
        );
        rows = rows.sort((left, right) =>
          [
            'factoryDate',
            'productionBatch',
            'batchSerialNo',
            'normalizedLogisticsCode',
            'id',
          ]
            .map((key) =>
              String(left[key] || '').localeCompare(
                String(right[key] || ''),
              ),
            )
            .find((value) => value !== 0) || 0,
        );
        return clone(
          Number.isInteger(take) ? rows.slice(0, take) : rows,
        );
      },
      updateMany: async ({ where, data }) =>
        updateMany(state.units, where, data),
    },
    serializedInventoryAssignment: {
      create: async ({ data }) => {
        if (
          data.activeUnitKey &&
          state.assignments.some(
            (assignment) =>
              assignment.activeUnitKey === data.activeUnitKey,
          )
        ) {
          const error = new Error('duplicate active unit');
          error.code = 'P2002';
          throw error;
        }
        const row = { ...clone(data) };
        state.assignments.push(row);
        return clone(row);
      },
      findMany: async ({ where = {}, include } = {}) => {
        const rows = state.assignments.filter((assignment) =>
          matchesAssignment(assignment, where),
        );
        return clone(
          rows.map((assignment) => ({
            ...assignment,
            ...(include?.serializedUnit
              ? {
                  serializedUnit: state.units.find(
                    (unit) =>
                      unit.id === assignment.serializedUnitId,
                  ),
                }
              : {}),
          })),
        );
      },
      updateMany: async ({ where, data }) =>
        updateMany(state.assignments, where, data),
    },
    inventoryReservation: {
      findUnique: async ({ where }) =>
        clone(
          state.reservations.find(
            (reservation) => reservation.id === where.id,
          ) || null,
        ),
      updateMany: async ({ where, data }) =>
        updateMany(state.reservations, where, data),
    },
    salesOrderItem: {
      findUnique: async ({ where }) =>
        clone(state.items.find((item) => item.id === where.id) || null),
      update: async ({ where, data }) => {
        const item = state.items.find((row) => row.id === where.id);
        Object.assign(item, applyData(item, data));
        return clone(item);
      },
    },
  };
}

function matchesUnit(unit, where) {
  if (where.id?.in && !where.id.in.includes(unit.id)) return false;
  if (where.id?.notIn && where.id.notIn.includes(unit.id)) return false;
  for (const key of ['productId', 'warehouseId', 'status']) {
    if (
      typeof where[key] === 'string' &&
      unit[key] !== where[key]
    ) {
      return false;
    }
  }
  for (const key of [
    'purchaseCostCents',
    'moutaiName',
    'factoryDate',
    'productionBatch',
    'batchSerialNo',
    'logisticsCode',
  ]) {
    if (where[key]?.not === null && unit[key] === null) return false;
  }
  return true;
}

function matchesAssignment(assignment, where) {
  if (
    where.reservationId &&
    assignment.reservationId !== where.reservationId
  ) {
    return false;
  }
  if (
    where.serializedUnitId?.in &&
    !where.serializedUnitId.in.includes(assignment.serializedUnitId)
  ) {
    return false;
  }
  if (typeof where.status === 'string') {
    return assignment.status === where.status;
  }
  if (where.status?.in) {
    return where.status.in.includes(assignment.status);
  }
  return true;
}

function updateMany(rows, where, data) {
  const row = rows.find((candidate) =>
    Object.entries(where).every(([key, expected]) => {
      if (expected && typeof expected === 'object') {
        if (Array.isArray(expected.in)) {
          return expected.in.includes(candidate[key]);
        }
        return true;
      }
      return candidate[key] === expected;
    }),
  );
  if (!row) return { count: 0 };
  Object.assign(row, applyData(row, data));
  return { count: 1 };
}

function applyData(row, data) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      value &&
      typeof value === 'object' &&
      Number.isInteger(value.increment)
        ? Number(row[key] || 0) + value.increment
        : value,
    ]),
  );
}

function unitInput(logisticsCode, purchaseCostCents) {
  return {
    moutaiName: 'Moutai',
    normalizedMoutaiName: 'moutai',
    factoryDate: new Date('2026-01-01T00:00:00.000Z'),
    productionBatch: '00001',
    batchSerialNo: logisticsCode,
    logisticsCode,
    normalizedLogisticsCode: logisticsCode,
    purchaseCostCents,
  };
}

function consistencyUnit(id, status, assignments, inventoryMovements) {
  return {
    id,
    warehouseId: 'warehouse-a',
    productId: 'product-serialized',
    status,
    purchaseCostCents: 100,
    assignments,
    inventoryMovements,
  };
}

function consistencyMovement(id, movementType, reservationId = null) {
  return {
    id,
    warehouseId: 'warehouse-a',
    productId: 'product-serialized',
    reservationId,
    movementType,
    reversalOfMovementId: null,
    reversedByMovement: null,
  };
}

function storedUnit(overrides = {}) {
  return {
    id: overrides.id || crypto.randomUUID(),
    productId: 'product-serialized',
    warehouseId: 'warehouse-a',
    inventoryBatchId: null,
    salesOrderId: null,
    salesOrderItemId: null,
    orderCostSnapshotCents: null,
    status: 'AVAILABLE',
    version: 0,
    correctionReason: null,
    correctedById: null,
    correctedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...clone(overrides),
  };
}

function stockSnapshot(state) {
  const stock = state.stocks[0];
  return {
    onHandQty: stock.onHandQty,
    reservedQty: stock.reservedQty,
    unavailableQty: stock.unavailableQty,
    inTransitQty: stock.inTransitQty,
    version: stock.version,
  };
}

function sumMovementDelta(movement) {
  return (
    Number(movement.onHandDelta || 0) +
    Number(movement.reservedDelta || 0) +
    Number(movement.unavailableDelta || 0) +
    Number(movement.inTransitDelta || 0)
  );
}

function clone(value) {
  return structuredClone(value);
}
