const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  canonicalJson,
} = require('../src/modules/inventory/inventory-command.policy');
const {
  InventoryStocktakeService,
} = require('../src/modules/inventory/inventory-stocktake.service');
const {
  SerializedInventoryAccountingAdapter,
} = require('../src/modules/inventory/serialized-inventory-accounting.adapter');

const ADMIN = { id: 'admin-1', name: 'Admin', role: 'admin' };
const BOSS = { id: 'boss-1', name: 'Boss', role: 'boss' };
const WAREHOUSE = {
  id: 'warehouse-user-1',
  name: 'Warehouse',
  role: 'warehouse',
};
const FINANCE = {
  id: 'finance-1',
  name: 'Finance',
  role: 'finance',
};
const SALES = { id: 'sales-1', name: 'Sales', role: 'sales' };

test('stocktake: one active warehouse-product draft is database guarded and create is idempotent', async () => {
  const fixture = createFixture();
  const body = stocktakeCommand('STOCKTAKE_CREATE', {
    warehouseId: 'wh-a',
    productId: 'product-quantity',
  });
  const created = await fixture.service.create(WAREHOUSE, body);
  const replay = await fixture.service.create(WAREHOUSE, body);
  assert.equal(replay.replayed, true);
  assert.equal(replay.stocktake.id, created.stocktake.id);
  await assertCode(
    fixture.service.create(
      ADMIN,
      stocktakeCommand('STOCKTAKE_CREATE', {
        warehouseId: 'wh-a',
        productId: 'product-quantity',
        sourceKey: 'stocktake:create:second',
        idempotencyKey: 'stocktake:create:second:idem',
      }),
    ),
    'INVENTORY_STOCKTAKE_ACTIVE_EXISTS',
  );
  assert.equal(fixture.repository.state.stocktakes.length, 1);

  const concurrent = createFixture();
  const attempts = await Promise.allSettled([
    concurrent.service.create(
      WAREHOUSE,
      stocktakeCommand('STOCKTAKE_CREATE', {
        warehouseId: 'wh-a',
        productId: 'product-quantity',
        sourceKey: 'stocktake:concurrent:one',
        idempotencyKey: 'stocktake:concurrent:one:idem',
      }),
    ),
    concurrent.service.create(
      ADMIN,
      stocktakeCommand('STOCKTAKE_CREATE', {
        warehouseId: 'wh-a',
        productId: 'product-quantity',
        sourceKey: 'stocktake:concurrent:two',
        idempotencyKey: 'stocktake:concurrent:two:idem',
      }),
    ),
  ]);
  assert.equal(
    attempts.filter((attempt) => attempt.status === 'fulfilled').length,
    1,
  );
  assert.equal(concurrent.repository.state.stocktakes.length, 1);
});

test('stocktake: submission freezes the book snapshot and approval posts quantity loss and unavailable restoration', async () => {
  const fixture = createFixture({
    stocks: [
      stockRow('wh-a', 'product-quantity', {
        onHandQty: 10,
        unavailableQty: 2,
        version: 4,
        lastMovementId: 'movement-before-count',
      }),
    ],
  });
  const id = await createDraft(fixture, 'product-quantity');
  assert.deepEqual(fixture.todoCalls, []);
  await assertCode(
    fixture.service.submit(
      WAREHOUSE,
      id,
      stocktakeCommand('STOCKTAKE_SUBMIT', {
        stocktakeId: id,
        reason: '',
        countedOnHandQty: 7,
        countedUnavailableQty: 1,
      }),
    ),
    'INVENTORY_STOCKTAKE_VALIDATION_FAILED',
  );
  const submitted = await fixture.service.submit(
    WAREHOUSE,
    id,
    stocktakeCommand('STOCKTAKE_SUBMIT', {
      stocktakeId: id,
      reason: 'Cycle count variance',
      countedOnHandQty: 7,
      countedUnavailableQty: 1,
    }),
  );
  assert.equal(submitted.stocktake.status, 'SUBMITTED');
  assert.deepEqual(fixture.todoCalls, [['STOCKTAKE', id]]);
  assert.deepEqual(submitted.stocktake.line, {
    snapshotStockVersion: 4,
    snapshotLastMovementId: 'movement-before-count',
    snapshotOnHandQty: 10,
    snapshotUnavailableQty: 2,
    countedOnHandQty: 7,
    countedUnavailableQty: 1,
    onHandDifferenceQty: -3,
    unavailableDifferenceQty: -1,
  });
  assert.equal(currentStock(fixture).onHandQty, 10);
  assert.equal(currentStock(fixture).unavailableQty, 2);
  assert.deepEqual(
    fixture.logs.rows
      .filter((row) => row.action.startsWith('inventory.stocktake.'))
      .map((row) => row.action),
    [
      'inventory.stocktake.created',
      'inventory.stocktake.submitted',
    ],
  );

  await assertCode(
    fixture.service.approve(WAREHOUSE, id, approveBody(id)),
    'PERMISSION_DENIED',
  );
  await assertCode(
    fixture.service.approve(FINANCE, id, approveBody(id)),
    'PERMISSION_DENIED',
  );
  const approved = await fixture.service.approve(
    BOSS,
    id,
    approveBody(id),
  );
  assert.equal(approved.stocktake.status, 'POSTED');
  assert.deepEqual(fixture.todoCalls, [
    ['STOCKTAKE', id],
    ['STOCKTAKE', id],
  ]);
  assert.equal(currentStock(fixture).onHandQty, 7);
  assert.equal(currentStock(fixture).unavailableQty, 1);
  assert.deepEqual(
    fixture.repository.state.movements.map((row) => [
      row.movementType,
      row.onHandDelta,
      row.unavailableDelta,
    ]),
    [
      ['UNAVAILABLE_OUT', 0, -1],
      ['STOCK_LOSS', -3, 0],
    ],
  );
  assert.deepEqual(
    fixture.logs.rows
      .filter((row) => row.action.startsWith('inventory.stocktake.'))
      .map((row) => row.action),
    [
      'inventory.stocktake.created',
      'inventory.stocktake.submitted',
      'inventory.stocktake.approved',
      'inventory.stocktake.posted',
    ],
  );
});

test('stocktake: zero difference posts no inventory movement and repeated approval is a replay', async () => {
  const fixture = createFixture({
    stocks: [
      stockRow('wh-a', 'product-quantity', {
        onHandQty: 3,
        unavailableQty: 1,
      }),
    ],
  });
  const id = await createDraft(fixture, 'product-quantity');
  await fixture.service.submit(
    ADMIN,
    id,
    stocktakeCommand('STOCKTAKE_SUBMIT', {
      stocktakeId: id,
      reason: 'Routine count',
      countedOnHandQty: 3,
      countedUnavailableQty: 1,
    }),
  );
  const body = approveBody(id);
  await fixture.service.approve(ADMIN, id, body);
  const replay = await fixture.service.approve(ADMIN, id, body);
  assert.equal(replay.replayed, true);
  await assertCode(
    fixture.service.approve(
      ADMIN,
      id,
      stocktakeCommand('STOCKTAKE_APPROVE', {
        stocktakeId: id,
        sourceKey: 'stocktake:approve:conflicting-source',
        idempotencyKey: body.idempotencyKey,
      }),
    ),
    'INVENTORY_IDEMPOTENCY_KEY_CONFLICT',
  );
  assert.equal(fixture.repository.state.movements.length, 0);
  assert.equal(fixture.repository.state.documents.length, 0);
});

test('stocktake: changed stock version or last movement blocks approval without partial facts', async () => {
  const fixture = createFixture({
    stocks: [stockRow('wh-a', 'product-quantity', { onHandQty: 5 })],
  });
  const id = await createDraft(fixture, 'product-quantity');
  await fixture.service.submit(
    WAREHOUSE,
    id,
    stocktakeCommand('STOCKTAKE_SUBMIT', {
      stocktakeId: id,
      reason: 'Counted shelf',
      countedOnHandQty: 4,
      countedUnavailableQty: 0,
    }),
  );
  currentStock(fixture).version += 1;
  currentStock(fixture).lastMovementId = 'movement-after-count';
  await assertCode(
    fixture.service.approve(BOSS, id, approveBody(id)),
    'INVENTORY_STOCKTAKE_SNAPSHOT_STALE',
  );
  assert.equal(
    fixture.repository.state.stocktakes[0].status,
    'SUBMITTED',
  );
  assert.equal(fixture.repository.state.movements.length, 0);
});

test('stocktake: approval failure rolls back receipt, movement, balance, status and audit', async () => {
  const fixture = createFixture({
    stocks: [stockRow('wh-a', 'product-quantity', { onHandQty: 2 })],
  });
  const id = await createDraft(fixture, 'product-quantity');
  await fixture.service.submit(
    WAREHOUSE,
    id,
    stocktakeCommand('STOCKTAKE_SUBMIT', {
      stocktakeId: id,
      reason: 'Counted shelf',
      countedOnHandQty: 1,
      countedUnavailableQty: 0,
    }),
  );
  const beforeReceipts = fixture.repository.state.receipts.length;
  fixture.accounting.failNext = true;
  await assert.rejects(
    fixture.service.approve(ADMIN, id, approveBody(id)),
  );
  assert.equal(currentStock(fixture).onHandQty, 2);
  assert.equal(fixture.repository.state.movements.length, 0);
  assert.equal(fixture.repository.state.documents.length, 0);
  assert.equal(
    fixture.repository.state.stocktakes[0].status,
    'SUBMITTED',
  );
  assert.equal(
    fixture.repository.state.receipts.length,
    beforeReceipts,
  );
});

test('stocktake: rejection releases the active key and cannot be performed by warehouse or finance', async () => {
  const fixture = createFixture();
  const id = await createDraft(fixture, 'product-quantity');
  await fixture.service.submit(
    WAREHOUSE,
    id,
    stocktakeCommand('STOCKTAKE_SUBMIT', {
      stocktakeId: id,
      reason: 'Counted shelf',
      countedOnHandQty: 0,
      countedUnavailableQty: 0,
    }),
  );
  const reject = stocktakeCommand('STOCKTAKE_REJECT', {
    stocktakeId: id,
    reason: 'Count sheet is incomplete',
  });
  await assertCode(
    fixture.service.reject(WAREHOUSE, id, reject),
    'PERMISSION_DENIED',
  );
  await assertCode(
    fixture.service.reject(FINANCE, id, reject),
    'PERMISSION_DENIED',
  );
  const rejected = await fixture.service.reject(BOSS, id, reject);
  assert.equal(rejected.stocktake.status, 'REJECTED');
  assert.equal(fixture.repository.state.stocktakes[0].activeKey, null);
  const next = await fixture.service.create(
    WAREHOUSE,
    stocktakeCommand('STOCKTAKE_CREATE', {
      warehouseId: 'wh-a',
      productId: 'product-quantity',
      sourceKey: 'stocktake:create:after-reject',
      idempotencyKey: 'stocktake:create:after-reject:idem',
    }),
  );
  assert.equal(next.stocktake.status, 'DRAFT');
});

test('stocktake: reversal is reasoned, idempotent and restores the posted quantity fact', async () => {
  const fixture = createFixture({
    stocks: [stockRow('wh-a', 'product-quantity', { onHandQty: 4 })],
  });
  const id = await createDraft(fixture, 'product-quantity');
  await fixture.service.submit(
    WAREHOUSE,
    id,
    stocktakeCommand('STOCKTAKE_SUBMIT', {
      stocktakeId: id,
      reason: 'Counted shelf',
      countedOnHandQty: 6,
      countedUnavailableQty: 0,
    }),
  );
  await fixture.service.approve(ADMIN, id, approveBody(id));
  assert.equal(currentStock(fixture).onHandQty, 6);
  const body = stocktakeCommand('STOCKTAKE_REVERSE', {
    stocktakeId: id,
    reason: 'Wrong count sheet selected',
  });
  const reversed = await fixture.service.reverse(ADMIN, id, body);
  const replay = await fixture.service.reverse(ADMIN, id, body);
  assert.equal(reversed.stocktake.status, 'REVERSED');
  assert.equal(replay.replayed, true);
  assert.equal(currentStock(fixture).onHandQty, 4);
  assert.equal(
    fixture.repository.state.movements.filter(
      (row) => row.movementType === 'REVERSAL',
    ).length,
    1,
  );
});

test('stocktake: serialized scans post per bottle, keep unknown codes unresolved and hide scans from finance', async () => {
  const fixture = createFixture({
    products: [
      productRow('product-serialized', 'SERIALIZED'),
    ],
    stocks: [
      stockRow('wh-a', 'product-serialized', {
        onHandQty: 2,
        unavailableQty: 1,
      }),
    ],
    units: [
      unitRow('unit-a', '000001', 'AVAILABLE'),
      unitRow('unit-b', '000002', 'UNAVAILABLE'),
    ],
  });
  const id = await createDraft(fixture, 'product-serialized');
  await fixture.service.submit(
    WAREHOUSE,
    id,
    stocktakeCommand('STOCKTAKE_SUBMIT', {
      stocktakeId: id,
      reason: 'Bottle scan count',
      scans: [{ logisticsCode: '000001', condition: 'SALEABLE' }],
    }),
  );
  const financeView = await fixture.service.get(FINANCE, id);
  assert.equal('serializedScans' in financeView, false);
  const warehouseView = await fixture.service.get(WAREHOUSE, id);
  assert.equal(warehouseView.serializedScans.length, 2);
  await fixture.service.approve(BOSS, id, approveBody(id));
  assert.equal(
    currentStock(fixture, 'product-serialized').onHandQty,
    1,
  );
  assert.equal(
    currentStock(fixture, 'product-serialized').unavailableQty,
    0,
  );
  assert.equal(unit(fixture, 'unit-b').status, 'VOID');
  assert.equal(
    fixture.repository.state.movements[0].serializedUnitId,
    'unit-b',
  );
  assert.equal(
    JSON.stringify(await fixture.service.get(WAREHOUSE, id)).includes(
      'purchaseCostCents',
    ),
    false,
  );
  await fixture.service.reverse(
    ADMIN,
    id,
    stocktakeCommand('STOCKTAKE_REVERSE', {
      stocktakeId: id,
      reason: 'Scanner omitted a bottle',
    }),
  );
  assert.equal(
    currentStock(fixture, 'product-serialized').onHandQty,
    2,
  );
  assert.equal(
    currentStock(fixture, 'product-serialized').unavailableQty,
    1,
  );
  assert.equal(unit(fixture, 'unit-b').status, 'UNAVAILABLE');

  const conflictFixture = createFixture({
    products: [productRow('product-serialized', 'SERIALIZED')],
    stocks: [
      stockRow('wh-a', 'product-serialized', {
        onHandQty: 1,
        unavailableQty: 0,
      }),
    ],
    units: [unitRow('unit-a', '000001', 'AVAILABLE')],
  });
  const conflictId = await createDraft(
    conflictFixture,
    'product-serialized',
  );
  await conflictFixture.service.submit(
    WAREHOUSE,
    conflictId,
    stocktakeCommand('STOCKTAKE_SUBMIT', {
      stocktakeId: conflictId,
      reason: 'Bottle scan count',
      scans: [{ logisticsCode: '999999', condition: 'SALEABLE' }],
    }),
  );
  await assertCode(
    conflictFixture.service.approve(
      ADMIN,
      conflictId,
      approveBody(conflictId),
    ),
    'INVENTORY_STOCKTAKE_SERIALIZED_UNRESOLVED',
  );
});

test('stocktake: unauthorized sales cannot read or write stocktakes', async () => {
  const fixture = createFixture();
  await assertCode(
    fixture.service.list(SALES),
    'PERMISSION_DENIED',
  );
  await assertCode(
    fixture.service.create(
      SALES,
      stocktakeCommand('STOCKTAKE_CREATE', {
        warehouseId: 'wh-a',
        productId: 'product-quantity',
      }),
    ),
    'PERMISSION_DENIED',
  );
});

function createFixture(overrides = {}) {
  const repository = new MemoryRepository(overrides);
  const logs = new MemoryLogs(repository);
  const accounting = new MemoryAccounting(repository);
  const serializedAdapter = new SerializedInventoryAccountingAdapter(
    repository,
    logs,
    undefined,
  );
  const todoCalls = [];
  const service = new InventoryStocktakeService(
    repository,
    accounting,
    serializedAdapter,
    logs,
    {
      safeReconcileSource: async (...args) => {
        todoCalls.push(args);
      },
    },
  );
  return {
    repository,
    logs,
    accounting,
    serializedAdapter,
    service,
    todoCalls,
  };
}

class MemoryRepository {
  constructor(overrides) {
    this.sequence = 0;
    this.transactionTail = Promise.resolve();
    this.state = {
      warehouses: [
        { id: 'wh-a', code: 'WH-A', name: 'Warehouse A', isActive: true },
      ],
      products:
        overrides.products || [productRow('product-quantity', 'QUANTITY')],
      stocks: overrides.stocks || [],
      units: overrides.units || [],
      stocktakes: [],
      stocktakeLines: [],
      scans: [],
      receipts: [],
      documents: [],
      lines: [],
      movements: [],
      tasks: [],
      logs: [],
    };
  }

  next(prefix) {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  root() {
    return memoryDatabase(this);
  }

  async runInTransaction(work) {
    const previous = this.transactionTail;
    let release;
    this.transactionTail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    const snapshot = structuredClone(this.state);
    const sequence = this.sequence;
    try {
      return await work(memoryDatabase(this));
    } catch (error) {
      this.state = snapshot;
      this.sequence = sequence;
      throw error;
    } finally {
      release();
    }
  }

  async findCommandReceipt(idempotencyKey, db = this.root()) {
    return await db.inventoryCommandReceipt.findUnique({
      where: { idempotencyKey },
    });
  }

  async findCommandReceiptBySourceKey(sourceKey) {
    return (
      this.state.receipts.find((row) => row.sourceKey === sourceKey) ||
      null
    );
  }

  async createCommandReceipt(transaction, data) {
    return await transaction.inventoryCommandReceipt.create({ data });
  }

  async completeCommandReceipt(
    transaction,
    id,
    resultDocumentId,
    resultSnapshot,
  ) {
    return await transaction.inventoryCommandReceipt.update({
      where: { id },
      data: {
        status: 'SUCCEEDED',
        resultDocumentId,
        resultSnapshot,
        completedAt: new Date(),
      },
    });
  }

  async findWarehouse(_transaction, id) {
    return this.state.warehouses.find((row) => row.id === id) || null;
  }

  async findProduct(_transaction, id) {
    return this.state.products.find((row) => row.id === id) || null;
  }

  async findStock(_transaction, warehouseId, productId) {
    return (
      this.state.stocks.find(
        (row) =>
          row.warehouseId === warehouseId && row.productId === productId,
      ) || null
    );
  }

  async getOrCreateStock(transaction, warehouseId, productId) {
    const found = await this.findStock(transaction, warehouseId, productId);
    if (found) return found;
    const created = stockRow(warehouseId, productId);
    this.state.stocks.push(created);
    return created;
  }

  async updateStockWithVersion(
    _transaction,
    stock,
    delta,
    lastMovementId,
  ) {
    const current = this.state.stocks.find((row) => row.id === stock.id);
    if (!current || current.version !== stock.version) return { count: 0 };
    current.onHandQty += delta.onHandDelta;
    current.reservedQty += delta.reservedDelta;
    current.unavailableQty += delta.unavailableDelta;
    current.inTransitQty += delta.inTransitDelta;
    current.version += 1;
    current.lastMovementId = lastMovementId;
    return { count: 1 };
  }

  async createDocument(transaction, data) {
    return await transaction.inventoryDocument.create({ data });
  }

  async createDocumentLine(transaction, data) {
    return await transaction.inventoryDocumentLine.create({ data });
  }

  async createMovement(transaction, data) {
    return await transaction.inventoryMovement.create({ data });
  }

  async createPostCommitTask(_transaction, data) {
    const row = {
      id: this.next('task'),
      ...data,
      createdAt: new Date(),
    };
    this.state.tasks.push(row);
    return row;
  }

  async findDocumentForReversal(_transaction, id) {
    const document = this.state.documents.find((row) => row.id === id);
    if (!document) return null;
    const reversedByDocument =
      this.state.documents.find(
        (row) => row.reversalOfDocumentId === document.id,
      ) || null;
    return {
      ...document,
      reversedByDocument,
      lines: this.state.lines
        .filter((line) => line.documentId === id)
        .map((line) => ({
          ...line,
          movements: this.state.movements.filter(
            (movement) => movement.documentLineId === line.id,
          ),
        })),
    };
  }

  async markDocumentReversed(_transaction, documentId, actor, reversedAt) {
    const document = this.state.documents.find(
      (row) => row.id === documentId,
    );
    document.status = 'REVERSED';
    document.reversedById = actor.id;
    document.reversedAt = reversedAt;
    return document;
  }
}

class MemoryLogs {
  constructor(repository) {
    this.repository = repository;
  }

  get rows() {
    return this.repository.state.logs;
  }

  async appendLog(data) {
    this.repository.state.logs.push({
      id: this.repository.next('log'),
      ...structuredClone(data),
    });
  }
}

class MemoryAccounting {
  constructor(repository) {
    this.repository = repository;
    this.failNext = false;
  }

  async executeAutomaticInTransaction(
    commandType,
    actor,
    input,
    transaction,
  ) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('injected accounting failure');
    }
    const existing = await this.repository.findCommandReceipt(
      input.idempotencyKey,
      transaction,
    );
    if (existing) {
      return {
        ...existing.resultSnapshot,
        commandReceiptId: existing.id,
        replayed: true,
      };
    }
    const receipt = await this.repository.createCommandReceipt(transaction, {
      sourceKey: input.sourceKey,
      idempotencyKey: input.idempotencyKey,
      commandType,
      requestHash: input.requestHash,
      status: 'PROCESSING',
    });
    let document;
    let movement;
    if (commandType === 'REVERSE') {
      const original = await this.repository.findDocumentForReversal(
        transaction,
        input.documentId,
      );
      if (!original || original.reversedByDocument) {
        throw Object.assign(new Error('already reversed'), {
          code: 'INVENTORY_DOCUMENT_ALREADY_REVERSED',
        });
      }
      document = await this.repository.createDocument(transaction, {
        documentNo: `DOC-${receipt.id}`,
        type: 'REVERSAL',
        status: 'POSTED',
        warehouseId: original.warehouseId,
        sourceType: 'stocktake_reverse',
        sourceId: input.sourceId,
        sourceKey: input.sourceKey,
        requestHash: input.requestHash,
        reversalOfDocumentId: original.id,
      });
      const originalMovements = original.lines.flatMap(
        (line) => line.movements,
      );
      const line = await this.repository.createDocumentLine(transaction, {
        documentId: document.id,
        lineNo: 1,
        productId: originalMovements[0].productId,
        quantity: 1,
      });
      for (const originalMovement of originalMovements) {
        movement = await this.repository.createMovement(transaction, {
          sourceKey: `${input.sourceKey}:${originalMovement.id}`,
          documentLineId: line.id,
          warehouseId: originalMovement.warehouseId,
          productId: originalMovement.productId,
          movementType: 'REVERSAL',
          onHandDelta: -originalMovement.onHandDelta,
          reservedDelta: -originalMovement.reservedDelta,
          unavailableDelta: -originalMovement.unavailableDelta,
          inTransitDelta: -originalMovement.inTransitDelta,
          reversalOfMovementId: originalMovement.id,
        });
        applyMemoryStock(
          this.repository,
          movement.warehouseId,
          movement.productId,
          movement,
        );
      }
      await this.repository.markDocumentReversed(
        transaction,
        original.id,
        actor,
        new Date(),
      );
    } else {
      const quantity = Number(input.quantity);
      const delta =
        commandType === 'INBOUND'
          ? { onHandDelta: quantity, unavailableDelta: 0 }
          : commandType === 'OUTBOUND'
            ? { onHandDelta: -quantity, unavailableDelta: 0 }
            : commandType === 'MARK_UNAVAILABLE'
              ? { onHandDelta: 0, unavailableDelta: quantity }
              : { onHandDelta: 0, unavailableDelta: -quantity };
      const movementType =
        commandType === 'INBOUND'
          ? 'STOCK_GAIN'
          : commandType === 'OUTBOUND'
            ? 'STOCK_LOSS'
            : commandType === 'MARK_UNAVAILABLE'
              ? 'UNAVAILABLE_IN'
              : 'UNAVAILABLE_OUT';
      document = await this.repository.createDocument(transaction, {
        documentNo: `DOC-${receipt.id}`,
        type:
          commandType === 'INBOUND'
            ? 'STOCK_GAIN'
            : commandType === 'OUTBOUND'
              ? 'STOCK_LOSS'
              : 'UNAVAILABLE_ADJUSTMENT',
        status: 'POSTED',
        warehouseId: input.warehouseId,
        sourceType: 'stocktake',
        sourceId: input.sourceId,
        sourceKey: input.sourceKey,
        requestHash: input.requestHash,
      });
      const line = await this.repository.createDocumentLine(transaction, {
        documentId: document.id,
        lineNo: 1,
        productId: input.productId,
        quantity,
      });
      movement = await this.repository.createMovement(transaction, {
        sourceKey: `${input.sourceKey}:movement`,
        documentLineId: line.id,
        warehouseId: input.warehouseId,
        productId: input.productId,
        movementType,
        onHandDelta: delta.onHandDelta,
        reservedDelta: 0,
        unavailableDelta: delta.unavailableDelta,
        inTransitDelta: 0,
      });
      applyMemoryStock(
        this.repository,
        input.warehouseId,
        input.productId,
        movement,
      );
    }
    const snapshot = {
      documentId: document.id,
      movementIds: movement ? [movement.id] : [],
    };
    await this.repository.completeCommandReceipt(
      transaction,
      receipt.id,
      document.id,
      snapshot,
    );
    return {
      ...snapshot,
      commandReceiptId: receipt.id,
      replayed: false,
    };
  }

  async dispatchCommittedReceipts() {}
}

function memoryDatabase(repository) {
  const state = repository.state;
  return {
    stocktake: {
      create: async ({ data }) => {
        if (
          state.stocktakes.some(
            (row) =>
              row.activeKey === data.activeKey ||
              row.sourceKey === data.sourceKey ||
              row.idempotencyKey === data.idempotencyKey,
          )
        ) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const row = {
          id: repository.next('stocktake'),
          submitSourceKey: null,
          submitIdempotencyKey: null,
          submitRequestHash: null,
          approveSourceKey: null,
          approveIdempotencyKey: null,
          approveRequestHash: null,
          rejectSourceKey: null,
          rejectIdempotencyKey: null,
          rejectRequestHash: null,
          reverseSourceKey: null,
          reverseIdempotencyKey: null,
          reverseRequestHash: null,
          reason: null,
          rejectionReason: null,
          reversalReason: null,
          quantityDocumentId: null,
          unavailableDocumentId: null,
          version: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        state.stocktakes.push(row);
        return row;
      },
      findUnique: async ({ where, include }) => {
        const row = state.stocktakes.find((item) => item.id === where.id);
        return row ? hydrateStocktake(state, row, include) : null;
      },
      findMany: async ({ where = {}, include, skip = 0, take = 20 }) =>
        state.stocktakes
          .filter((row) => matchesWhere(row, where))
          .slice(skip, skip + take)
          .map((row) => hydrateStocktake(state, row, include)),
      count: async ({ where = {} }) =>
        state.stocktakes.filter((row) => matchesWhere(row, where)).length,
      updateMany: async ({ where, data }) => {
        const row = state.stocktakes.find((item) =>
          matchesWhere(item, where),
        );
        if (!row) return { count: 0 };
        applyData(row, data);
        row.updatedAt = new Date();
        return { count: 1 };
      },
    },
    stocktakeLine: {
      create: async ({ data }) => {
        const row = {
          id: repository.next('stocktake-line'),
          snapshotStockVersion: null,
          snapshotLastMovementId: null,
          snapshotOnHandQty: null,
          snapshotUnavailableQty: null,
          snapshotSerializedFingerprint: null,
          countedOnHandQty: null,
          countedUnavailableQty: null,
          onHandDifferenceQty: null,
          unavailableDifferenceQty: null,
          ...data,
        };
        state.stocktakeLines.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = state.stocktakeLines.find(
          (item) => item.stocktakeId === where.stocktakeId,
        );
        Object.assign(row, data);
        return row;
      },
    },
    stocktakeSerializedScan: {
      create: async ({ data }) => {
        const row = {
          id: repository.next('scan'),
          actionMovementId: null,
          ...data,
        };
        state.scans.push(row);
        return row;
      },
      findMany: async ({ where, include, orderBy }) =>
        state.scans
          .filter((row) => matchesWhere(row, where))
          .map((row) => hydrateScan(state, row, include)),
      update: async ({ where, data }) => {
        const row = state.scans.find((item) => item.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    serializedInventoryUnit: {
      findMany: async ({ where }) =>
        state.units.filter((row) => matchesWhere(row, where)),
      updateMany: async ({ where, data }) => {
        const row = state.units.find((item) => matchesWhere(item, where));
        if (!row) return { count: 0 };
        applyData(row, data);
        return { count: 1 };
      },
    },
    inventoryCommandReceipt: {
      findUnique: async ({ where }) =>
        state.receipts.find(
          (row) => row.idempotencyKey === where.idempotencyKey,
        ) || null,
      create: async ({ data }) => {
        if (
          state.receipts.some(
            (row) =>
              row.idempotencyKey === data.idempotencyKey ||
              row.sourceKey === data.sourceKey,
          )
        ) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const row = {
          id: repository.next('receipt'),
          resultSnapshot: null,
          ...data,
        };
        state.receipts.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = state.receipts.find((item) => item.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    inventoryDocument: {
      create: async ({ data }) => {
        const row = {
          id: repository.next('document'),
          reversalOfDocumentId: null,
          ...data,
        };
        state.documents.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = state.documents.find((item) => item.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    inventoryDocumentLine: {
      create: async ({ data }) => {
        const row = { id: repository.next('line'), ...data };
        state.lines.push(row);
        return row;
      },
    },
    inventoryMovement: {
      create: async ({ data }) => {
        const row = { id: repository.next('movement'), ...data };
        state.movements.push(row);
        return row;
      },
    },
  };
}

function hydrateStocktake(state, row, include = {}) {
  const result = { ...row };
  if (include.line) {
    result.line =
      state.stocktakeLines.find((line) => line.stocktakeId === row.id) ||
      null;
  }
  if (include.warehouse) {
    result.warehouse = state.warehouses.find(
      (warehouse) => warehouse.id === row.warehouseId,
    );
  }
  if (include.product) {
    result.product = state.products.find(
      (product) => product.id === row.productId,
    );
  }
  if (include.serializedScans) {
    const scanInclude = include.serializedScans.include;
    const select = include.serializedScans.select;
    result.serializedScans = state.scans
      .filter((scan) => scan.stocktakeId === row.id)
      .map((scan) => {
        const hydrated = hydrateScan(state, scan, scanInclude);
        if (!select) return hydrated;
        return Object.fromEntries(
          Object.keys(select)
            .filter((key) => select[key])
            .map((key) => [key, hydrated[key]]),
        );
      });
  }
  return result;
}

function hydrateScan(state, row, include) {
  const result = { ...row };
  if (include?.serializedUnit) {
    result.serializedUnit =
      state.units.find((unitRow) => unitRow.id === row.serializedUnitId) ||
      null;
  }
  if (include?.actionMovement) {
    result.actionMovement =
      state.movements.find(
        (movement) => movement.id === row.actionMovementId,
      ) || null;
  }
  return result;
}

function matchesWhere(row, where = {}) {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if ('in' in expected) return expected.in.includes(actual);
      if ('not' in expected) return actual !== expected.not;
    }
    return actual === expected;
  });
}

function applyData(row, data) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) {
      row[key] = Number(row[key] || 0) + value.increment;
    } else {
      row[key] = value;
    }
  }
}

function applyMemoryStock(repository, warehouseId, productId, movement) {
  let stock = repository.state.stocks.find(
    (row) =>
      row.warehouseId === warehouseId && row.productId === productId,
  );
  if (!stock) {
    stock = stockRow(warehouseId, productId);
    repository.state.stocks.push(stock);
  }
  stock.onHandQty += Number(movement.onHandDelta || 0);
  stock.reservedQty += Number(movement.reservedDelta || 0);
  stock.unavailableQty += Number(movement.unavailableDelta || 0);
  stock.inTransitQty += Number(movement.inTransitDelta || 0);
  stock.version += 1;
  stock.lastMovementId = movement.id;
}

async function createDraft(fixture, productId) {
  const result = await fixture.service.create(
    WAREHOUSE,
    stocktakeCommand('STOCKTAKE_CREATE', {
      warehouseId: 'wh-a',
      productId,
      sourceKey: `stocktake:create:${productId}`,
      idempotencyKey: `stocktake:create:${productId}:idem`,
    }),
  );
  return result.stocktake.id;
}

function approveBody(stocktakeId) {
  return stocktakeCommand('STOCKTAKE_APPROVE', { stocktakeId });
}

function stocktakeCommand(commandType, payload) {
  const sourceKey =
    payload.sourceKey ||
    `${commandType.toLowerCase()}:${payload.stocktakeId || payload.productId}`;
  const idempotencyKey =
    payload.idempotencyKey || `idem:${sourceKey}`;
  const bodyPayload = { ...payload };
  delete bodyPayload.sourceKey;
  delete bodyPayload.idempotencyKey;
  const requestPayload = { ...bodyPayload };
  let returnedPayload = { ...bodyPayload };
  if (commandType !== 'STOCKTAKE_CREATE') {
    delete returnedPayload.stocktakeId;
  }
  if (commandType === 'STOCKTAKE_SUBMIT') {
    requestPayload.countedOnHandQty =
      bodyPayload.countedOnHandQty ?? null;
    requestPayload.countedUnavailableQty =
      bodyPayload.countedUnavailableQty ?? null;
    requestPayload.scans = (bodyPayload.scans || []).map((scan) => ({
      logisticsCode: scan.logisticsCode.normalize('NFKC').trim(),
      normalizedLogisticsCode: scan.logisticsCode
        .normalize('NFKC')
        .trim()
        .toLowerCase(),
      condition: scan.condition.trim().toUpperCase(),
    }));
  }
  const hashPayload = {
    commandType,
    sourceKey: sourceKey.toLowerCase(),
    idempotencyKey: idempotencyKey.toLowerCase(),
    ...requestPayload,
  };
  return {
    ...returnedPayload,
    sourceKey,
    idempotencyKey,
    requestHash: crypto
      .createHash('sha256')
      .update(canonicalJson(hashPayload))
      .digest('hex'),
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

function stockRow(warehouseId, productId, overrides = {}) {
  return {
    id: `stock:${warehouseId}:${productId}`,
    warehouseId,
    productId,
    onHandQty: 0,
    reservedQty: 0,
    unavailableQty: 0,
    inTransitQty: 0,
    version: 0,
    lastMovementId: null,
    ...overrides,
  };
}

function unitRow(id, logisticsCode, status) {
  return {
    id,
    productId: 'product-serialized',
    warehouseId: 'wh-a',
    inventoryBatchId: null,
    logisticsCode,
    normalizedLogisticsCode: logisticsCode.toLowerCase(),
    purchaseCostCents: 12_300,
    status,
    version: 0,
  };
}

function currentStock(fixture, productId = 'product-quantity') {
  return fixture.repository.state.stocks.find(
    (row) =>
      row.warehouseId === 'wh-a' &&
      row.productId === productId,
  );
}

function unit(fixture, id) {
  return fixture.repository.state.units.find((row) => row.id === id);
}

async function assertCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}
