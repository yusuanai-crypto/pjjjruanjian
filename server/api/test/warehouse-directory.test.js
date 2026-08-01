const assert = require('node:assert/strict');
const test = require('node:test');

const {
  InventoryQueryService,
} = require('../src/modules/inventory/inventory-query.service');
const {
  SalesOrderInventoryService,
} = require('../src/modules/inventory/sales-order-inventory.service');
const { canonicalJson } = require('../src/modules/inventory/inventory-command.policy');
const crypto = require('node:crypto');

const ADMIN = { id: 'admin-1', name: '管理员', role: 'admin' };
const SALES = { id: 'sales-1', name: '销售', role: 'sales' };
const WAREHOUSE = { id: 'warehouse-1', name: '库管', role: 'warehouse' };

test('warehouse directory: creates two levels and rejects third-level, self links and child defaults', async () => {
  const repository = new HierarchyRepository();
  const service = createService(repository);
  const root = await service.createWarehouse(ADMIN, {
    code: 'ROOT-1',
    name: '父仓一号',
  });
  const child = await service.createWarehouse(ADMIN, {
    code: 'CHILD-1',
    name: '子仓一号',
    parentWarehouseId: root.id,
  });
  assert.equal(child.parentWarehouseId, root.id);

  await assertCode(
    service.createWarehouse(ADMIN, {
      code: 'LEVEL-3',
      name: '三级仓',
      parentWarehouseId: child.id,
    }),
    'INVENTORY_WAREHOUSE_MAX_DEPTH_EXCEEDED',
  );
  await assertCode(
    service.updateWarehouse(ADMIN, child.id, {
      parentWarehouseId: child.id,
    }),
    'INVENTORY_WAREHOUSE_PARENT_SELF_REFERENCE',
  );
  await assertCode(
    service.updateWarehouse(ADMIN, child.id, { isDefault: true }),
    'INVENTORY_CHILD_WAREHOUSE_CANNOT_BE_DEFAULT',
  );

  const secondRoot = await service.createWarehouse(ADMIN, {
    code: 'ROOT-2',
    name: '父仓二号',
  });
  await assertCode(
    service.updateWarehouse(ADMIN, root.id, {
      parentWarehouseId: secondRoot.id,
    }),
    'INVENTORY_WAREHOUSE_WITH_CHILDREN_CANNOT_BECOME_CHILD',
  );
});

test('warehouse directory: parent product view aggregates every direct child without changing local stock', async () => {
  const root = warehouse('root', null);
  const repository = {
    findWarehouse: async () => root,
    listWarehouseProductConfigurations: async () => [
      {
        id: 'configuration-1',
        warehouseId: 'root',
        productId: 'product-1',
        product: {
          id: 'product-1',
          name: '测试商品',
          unit: '瓶',
          inventoryTrackingMode: 'QUANTITY',
          isActive: true,
        },
        isActive: true,
        createdAt: new Date('2026-08-01T00:00:00Z'),
        updatedAt: new Date('2026-08-01T00:00:00Z'),
      },
    ],
    root: () => ({
      warehouse: {
        findMany: async () => [{ id: 'child-a' }, { id: 'child-b' }],
      },
    }),
    aggregateWarehouseProductStocks: async () => [
      aggregate('root', 5, 2, 1, 0),
      aggregate('child-a', 4, 0, 0, 1),
      aggregate('child-b', 3, 1, 0, 0),
    ],
    latestWarehouseProductMovements: async () => [
      {
        productId: 'product-1',
        _max: { businessAt: new Date('2026-08-01T01:00:00Z') },
      },
    ],
    listAlertConfigsForPairs: async () => [],
  };
  const service = createService(repository);
  const result = await service.listWarehouseProducts(ADMIN, 'root', {
    page: 1,
    pageSize: 20,
  });
  assert.equal(result.products.length, 1);
  assert.deepEqual(result.products[0].localStock, {
    onHandQty: 5,
    reservedQty: 2,
    unavailableQty: 1,
    inTransitQty: 0,
    availableQty: 2,
    shortageQty: 0,
  });
  assert.deepEqual(result.products[0].inclusiveStock, {
    onHandQty: 12,
    reservedQty: 3,
    unavailableQty: 1,
    inTransitQty: 1,
    availableQty: 8,
    shortageQty: 0,
  });
  assert.equal(JSON.stringify(result).includes('Cost'), false);
  const warehouseResult = await service.listWarehouseProducts(
    WAREHOUSE,
    'root',
    { page: 1, pageSize: 20 },
  );
  assert.equal(JSON.stringify(warehouseResult).includes('cost'), false);
});

test('warehouse directory: serialized quantities come from real bottle records and keep projected transit', async () => {
  const root = warehouse('root', null);
  const repository = {
    findWarehouse: async () => root,
    listWarehouseProductConfigurations: async () => [
      {
        id: 'serialized-configuration',
        warehouseId: 'root',
        productId: 'serialized-product',
        product: {
          id: 'serialized-product',
          name: '逐瓶测试酒',
          unit: '瓶',
          inventoryTrackingMode: 'SERIALIZED',
          isActive: true,
        },
        isActive: true,
        createdAt: new Date('2026-08-01T00:00:00Z'),
        updatedAt: new Date('2026-08-01T00:00:00Z'),
      },
    ],
    root: () => ({
      warehouse: { findMany: async () => [{ id: 'child-a' }] },
    }),
    aggregateWarehouseProductStocks: async () => [
      serializedAggregate('root', 99, 0, 0, 1),
      serializedAggregate('child-a', 99, 0, 0, 0),
    ],
    aggregateSerializedWarehouseProductUnits: async () => [
      unitAggregate('root', 'AVAILABLE', 2),
      unitAggregate('root', 'RESERVED', 1),
      unitAggregate('root', 'PENDING_COST', 1),
      unitAggregate('root', 'OUTBOUND', 1),
      unitAggregate('child-a', 'AVAILABLE', 3),
      unitAggregate('child-a', 'UNAVAILABLE', 1),
    ],
    latestWarehouseProductMovements: async () => [],
    listAlertConfigsForPairs: async () => [],
  };
  const result = await createService(repository).listWarehouseProducts(
    WAREHOUSE,
    'root',
  );
  assert.deepEqual(result.products[0].localStock, {
    onHandQty: 4,
    reservedQty: 1,
    unavailableQty: 1,
    inTransitQty: 1,
    availableQty: 2,
    shortageQty: 0,
  });
  assert.deepEqual(result.products[0].inclusiveStock, {
    onHandQty: 8,
    reservedQty: 1,
    unavailableQty: 2,
    inTransitQty: 1,
    availableQty: 5,
    shortageQty: 0,
  });
});

test('warehouse directory: completed child transfer preserves the parent inclusive total', async () => {
  const root = warehouse('root', null);
  let stockRows = [aggregate('root', 10, 0, 0, 0)];
  const repository = {
    findWarehouse: async () => root,
    listWarehouseProductConfigurations: async () => [quantityConfiguration()],
    root: () => ({
      warehouse: { findMany: async () => [{ id: 'child-a' }] },
    }),
    aggregateWarehouseProductStocks: async () => stockRows,
    latestWarehouseProductMovements: async () => [],
    listAlertConfigsForPairs: async () => [],
  };
  const service = createService(repository);
  const before = await service.listWarehouseProducts(ADMIN, 'root');
  stockRows = [
    aggregate('root', 8, 0, 0, 0),
    aggregate('child-a', 2, 0, 0, 0),
  ];
  const after = await service.listWarehouseProducts(ADMIN, 'root');
  assert.equal(before.products[0].inclusiveStock.onHandQty, 10);
  assert.equal(after.products[0].localStock.onHandQty, 8);
  assert.equal(after.products[0].inclusiveStock.onHandQty, 10);
});

test('warehouse directory: sales cannot read or mutate warehouse data', async () => {
  const repository = {
    findWarehouse: async () => {
      throw new Error('repository must not be called');
    },
  };
  const service = createService(repository);
  await assertCode(
    service.listWarehouseProducts(SALES, 'root'),
    'PERMISSION_DENIED',
  );
  await assertCode(
    service.deleteWarehouse(SALES, 'root'),
    'PERMISSION_DENIED',
  );
});

test('warehouse directory: child warehouses cannot be defaults or fulfillment warehouses', async () => {
  const service = new SalesOrderInventoryService(
    { dispatchCommittedReceipts: async () => {} },
    {},
  );
  const transaction = {
    inventoryConfiguration: {
      findUnique: async () => ({
        goLiveAt: new Date('2026-07-01T00:00:00Z'),
        policyVersion: 1,
        maintenanceMode: false,
      }),
    },
    warehouse: {
      findMany: async () => [
        { id: 'child', parentWarehouseId: 'root' },
      ],
      findUnique: async () => ({
        id: 'child',
        isActive: true,
        parentWarehouseId: 'root',
      }),
    },
    inventoryReservation: {
      findMany: async () => [],
    },
    inventoryCommandReceipt: {},
  };
  await assertCode(
    service.prepareNewOrder(
      transaction,
      'normal',
      new Date('2026-08-01T00:00:00Z'),
    ),
    'INVENTORY_DEFAULT_WAREHOUSE_NOT_UNIQUE',
  );
  await assertCode(
    service.synchronize(
      transaction,
      ADMIN,
      null,
      {
        id: 'order-1',
        orderType: 'normal',
        status: 'valid',
        fulfillmentWarehouseId: 'child',
        inventoryAppliedAt: new Date('2026-08-01T00:00:00Z'),
        items: [],
      },
    ),
    'INVENTORY_FULFILLMENT_WAREHOUSE_MUST_BE_PARENT',
  );
});

test('warehouse directory: product association and opening ledger share one idempotent transaction', async () => {
  const repository = new AddProductRepository();
  const accountingCalls = [];
  const accounting = {
    executeAutomaticInTransaction: async (
      commandType,
      actor,
      payload,
      transaction,
    ) => {
      accountingCalls.push({ commandType, actor, payload, transaction });
      return {
        commandReceiptId: 'opening-receipt-1',
        documentId: 'opening-document-1',
        documentNo: 'OPENING-1',
        movementIds: ['movement-1'],
        stockChanges: [],
        batchChanges: [],
      };
    },
    dispatchCommittedReceipts: async () => {},
  };
  const service = new InventoryQueryService(
    repository,
    { appendLog: async () => ({}) },
    {
      safeReconcileInventoryPair: async () => {},
      safeReconcileAllInventoryPairs: async () => {},
    },
    accounting,
  );
  const request = warehouseProductRequest('root', 'product-1', 6, 'idem-1');
  const first = await service.addWarehouseProduct(
    ADMIN,
    'root',
    request,
  );
  const replay = await service.addWarehouseProduct(
    ADMIN,
    'root',
    request,
  );
  assert.equal(first.product.isActive, true);
  assert.equal(first.opening.documentId, 'opening-document-1');
  assert.equal(replay.replayed, true);
  assert.equal(accountingCalls.length, 1);
  assert.equal(accountingCalls[0].commandType, 'INBOUND');
  assert.equal(accountingCalls[0].payload.kind, 'OPENING');
  assert.equal(accountingCalls[0].payload.quantity, 6);
  assert.equal(accountingCalls[0].transaction, repository.transaction);
});

test('warehouse directory: opening cannot overwrite history and serialized opening cannot invent bottles', async () => {
  const repository = new AddProductRepository();
  repository.hasHistory = true;
  const service = createProductService(repository);
  await assertCode(
    service.addWarehouseProduct(ADMIN, 'root', {
      productId: 'product-1',
      initialQuantity: '1.5',
      idempotencyKey: 'decimal-idem',
      requestHash: '0'.repeat(64),
    }),
    'INVENTORY_VALIDATION_FAILED',
  );
  await assertCode(
    service.addWarehouseProduct(
      ADMIN,
      'root',
      warehouseProductRequest('root', 'product-1', 2, 'history-idem'),
    ),
    'INVENTORY_WAREHOUSE_PRODUCT_HAS_HISTORY',
  );
  repository.hasHistory = false;
  repository.trackingMode = 'SERIALIZED';
  await assertCode(
    service.addWarehouseProduct(
      ADMIN,
      'root',
      warehouseProductRequest('root', 'product-1', 2, 'serialized-idem'),
    ),
    'INVENTORY_SERIALIZED_OPENING_REQUIRES_UNITS',
  );
  assert.equal(repository.receipts.length, 0);
});

test('warehouse directory: zero-stock product is safely disabled and restored without a duplicate row', async () => {
  const repository = new AddProductRepository();
  const service = createProductService(repository);
  const first = await service.addWarehouseProduct(
    ADMIN,
    'root',
    warehouseProductRequest('root', 'product-1', 0, 'add-zero'),
  );
  const disabled = await service.deactivateWarehouseProduct(
    ADMIN,
    'root',
    'product-1',
  );
  assert.equal(disabled.product.isActive, false);
  const restored = await service.addWarehouseProduct(
    ADMIN,
    'root',
    warehouseProductRequest('root', 'product-1', 0, 'restore-zero'),
  );
  assert.equal(restored.product.id, first.product.id);
  assert.equal(repository.createdConfigurationCount, 1);

  repository.stock = { onHandQty: 1, reservedQty: 0, unavailableQty: 0, inTransitQty: 0 };
  await assertCode(
    service.deactivateWarehouseProduct(ADMIN, 'root', 'product-1'),
    'INVENTORY_WAREHOUSE_PRODUCT_HAS_ACTIVE_STOCK',
  );
});

test('warehouse directory: physical delete is limited to a non-default empty leaf', async () => {
  const repository = new DeleteWarehouseRepository();
  const service = createService(repository);
  const deleted = await service.deleteWarehouse(ADMIN, 'empty');
  assert.deepEqual(deleted, { id: 'empty', deleted: true });
  assert.equal(repository.deletedId, 'empty');

  repository.current = warehouse('default', null);
  repository.current.isDefault = true;
  await assertCode(
    service.deleteWarehouse(ADMIN, 'default'),
    'INVENTORY_DEFAULT_WAREHOUSE_CANNOT_DELETE',
  );
  repository.current = warehouse('parent', null);
  repository.blockers = emptyDeleteBlockers({ childWarehouses: 1 });
  await assertCode(
    service.deleteWarehouse(ADMIN, 'parent'),
    'INVENTORY_WAREHOUSE_HAS_CHILDREN',
  );
  repository.current = warehouse('historical', null);
  repository.blockers = emptyDeleteBlockers({ movements: 1 });
  await assert.rejects(
    service.deleteWarehouse(ADMIN, 'historical'),
    (error) =>
      error.code === 'INVENTORY_WAREHOUSE_DELETE_BLOCKED' &&
      String(error.message).includes('库存流水') &&
      String(error.message).includes('停用'),
  );
});

test('warehouse directory migration is additive and backfill stays preview-only by default', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'prisma',
      'migrations',
      '20260801000200_warehouse_directory',
      'migration.sql',
    ),
    'utf8',
  );
  const backfill = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'scripts',
      'backfill-warehouse-product-configurations.ts',
    ),
    'utf8',
  );
  assert.match(migration, /ADD COLUMN `parent_warehouse_id`/);
  assert.match(migration, /CREATE TABLE `warehouse_product_configurations`/);
  assert.match(migration, /CREATE TRIGGER `warehouses_two_levels_insert`/);
  assert.doesNotMatch(
    migration,
    /INSERT\s+INTO\s+`?warehouse_product_configurations`?/i,
  );
  assert.match(backfill, /process\.argv\.includes\('--apply'\)/);
  assert.match(backfill, /Preview only/);
  assert.match(backfill, /skipDuplicates:\s*true/);
});

function createService(repository) {
  return new InventoryQueryService(
    repository,
    { appendLog: async () => ({}) },
    {
      safeReconcileInventoryPair: async () => {},
      safeReconcileAllInventoryPairs: async () => {},
    },
  );
}

class HierarchyRepository {
  constructor() {
    this.rows = [];
  }

  async runInTransaction(work) {
    return work(this);
  }

  async findWarehouseForMutation(_transaction, id) {
    const row = this.rows.find((item) => item.id === id);
    return row ? this.project(row) : null;
  }

  async findWarehouseByNormalizedCode(_transaction, value) {
    const row = this.rows.find((item) => item.normalizedCode === value);
    return row ? { id: row.id } : null;
  }

  async findWarehouseByNormalizedName(_transaction, value) {
    const row = this.rows.find((item) => item.normalizedName === value);
    return row ? { id: row.id } : null;
  }

  async findManager() {
    return null;
  }

  async clearOtherDefaults(_transaction, id) {
    for (const row of this.rows) {
      if (row.id !== id) {
        row.isDefault = false;
        row.activeDefaultKey = null;
      }
    }
  }

  async createWarehouse(_transaction, data) {
    const row = {
      ...data,
      manager: null,
      parentWarehouse: null,
    };
    this.rows.push(row);
    return this.project(row);
  }

  async updateWarehouse(_transaction, id, data) {
    const row = this.rows.find((item) => item.id === id);
    Object.assign(row, data);
    return this.project(row);
  }

  async warehouseHasHistory() {
    return false;
  }

  async warehouseBlockers() {
    return {};
  }

  project(row) {
    const parent = this.rows.find((item) => item.id === row.parentWarehouseId);
    return {
      ...structuredClone(row),
      parentWarehouse: parent
        ? {
            id: parent.id,
            code: parent.code,
            name: parent.name,
            isActive: parent.isActive,
          }
        : null,
      _count: {
        childWarehouses: this.rows.filter(
          (item) => item.parentWarehouseId === row.id,
        ).length,
      },
    };
  }
}

class AddProductRepository {
  constructor() {
    this.receipts = [];
    this.configuration = null;
    this.createdConfigurationCount = 0;
    this.hasHistory = false;
    this.trackingMode = 'QUANTITY';
    this.stock = null;
    this.transaction = {
      product: {
        findUnique: async () => ({
          id: 'product-1',
          name: '测试商品',
          unit: '瓶',
          inventoryTrackingMode: this.trackingMode,
          isActive: true,
        }),
      },
      inventoryConfiguration: {
        findUnique: async () => ({
          goLiveAt: new Date('2026-08-01T00:00:00Z'),
        }),
      },
      inventoryCommandReceipt: {
        findUnique: async ({ where }) =>
          structuredClone(
            this.receipts.find(
              (receipt) => receipt.idempotencyKey === where.idempotencyKey,
            ) || null,
          ),
        create: async ({ data }) => {
          const receipt = {
            ...structuredClone(data),
            resultSnapshot: null,
          };
          this.receipts.push(receipt);
          return structuredClone(receipt);
        },
        update: async ({ where, data }) => {
          const receipt = this.receipts.find((item) => item.id === where.id);
          Object.assign(receipt, structuredClone(data));
          return structuredClone(receipt);
        },
      },
    };
  }

  async runInTransaction(work) {
    return work(this.transaction);
  }

  async findWarehouseForMutation() {
    return warehouse('root', null);
  }

  async warehouseProductHasHistory() {
    return this.hasHistory;
  }

  async findWarehouseProductConfiguration() {
    return this.configuration ? structuredClone(this.configuration) : null;
  }

  async createWarehouseProductConfiguration(_transaction, data) {
    this.createdConfigurationCount += 1;
    this.configuration = {
      ...structuredClone(data),
      product: {
        id: 'product-1',
        name: '测试商品',
        unit: '瓶',
        inventoryTrackingMode: this.trackingMode,
        isActive: true,
      },
    };
    return structuredClone(this.configuration);
  }

  async updateWarehouseProductConfiguration(_transaction, id, data) {
    Object.assign(this.configuration, structuredClone(data));
    this.configuration.id = id;
    return structuredClone(this.configuration);
  }

  async findWarehouseProductStock() {
    return this.stock ? structuredClone(this.stock) : null;
  }

  async countActiveSerializedUnits() {
    return 0;
  }
}

class DeleteWarehouseRepository {
  constructor() {
    this.current = warehouse('empty', null);
    this.blockers = emptyDeleteBlockers();
    this.deletedId = null;
  }

  async runInTransaction(work) {
    return work(this);
  }

  async findWarehouseForMutation() {
    return structuredClone(this.current);
  }

  async warehouseDeleteBlockers() {
    return structuredClone(this.blockers);
  }

  async deleteWarehouse(_transaction, id) {
    this.deletedId = id;
  }
}

function warehouse(id, parentWarehouseId) {
  return {
    id,
    code: id.toUpperCase(),
    name: id,
    address: null,
    managerUserId: null,
    manager: null,
    parentWarehouseId,
    parentWarehouse: null,
    isActive: true,
    isDefault: false,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    _count: { childWarehouses: parentWarehouseId ? 0 : 2 },
  };
}

function aggregate(warehouseId, onHandQty, reservedQty, unavailableQty, inTransitQty) {
  return {
    warehouseId,
    productId: 'product-1',
    _sum: { onHandQty, reservedQty, unavailableQty, inTransitQty },
  };
}

function serializedAggregate(warehouseId, onHandQty, reservedQty, unavailableQty, inTransitQty) {
  return {
    warehouseId,
    productId: 'serialized-product',
    _sum: { onHandQty, reservedQty, unavailableQty, inTransitQty },
  };
}

function unitAggregate(warehouseId, status, count) {
  return {
    warehouseId,
    productId: 'serialized-product',
    status,
    _count: { _all: count },
  };
}

function quantityConfiguration() {
  return {
    id: 'configuration-1',
    warehouseId: 'root',
    productId: 'product-1',
    product: {
      id: 'product-1',
      name: '测试商品',
      unit: '瓶',
      inventoryTrackingMode: 'QUANTITY',
      isActive: true,
    },
    isActive: true,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
  };
}

function createProductService(repository) {
  return new InventoryQueryService(
    repository,
    { appendLog: async () => ({}) },
    {
      safeReconcileInventoryPair: async () => {},
      safeReconcileAllInventoryPairs: async () => {},
    },
    {
      executeAutomaticInTransaction: async () => ({
        commandReceiptId: 'opening-receipt',
        documentId: 'opening-document',
      }),
      dispatchCommittedReceipts: async () => {},
    },
  );
}

function emptyDeleteBlockers(overrides = {}) {
  return {
    childWarehouses: 0,
    stocks: 0,
    productConfigurations: 0,
    batches: 0,
    documents: 0,
    movements: 0,
    reservations: 0,
    transfers: 0,
    transferReceipts: 0,
    afterSalesReceipts: 0,
    previousAfterSalesUnits: 0,
    stockAlertConfigs: 0,
    inventoryAlerts: 0,
    stocktakes: 0,
    stocktakeExpectedScans: 0,
    fulfillmentOrders: 0,
    serializedUnits: 0,
    specialOrderItems: 0,
    ...overrides,
  };
}

function warehouseProductRequest(
  warehouseId,
  productId,
  initialQuantity,
  idempotencyKey,
) {
  const payload = { warehouseId, productId, initialQuantity };
  return {
    productId,
    initialQuantity,
    idempotencyKey,
    requestHash: crypto
      .createHash('sha256')
      .update(canonicalJson(payload), 'utf8')
      .digest('hex'),
  };
}

async function assertCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}
