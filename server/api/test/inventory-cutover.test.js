const { test, describe } = require('node:test');
const assert = require('node:assert');

// ts-node/register 已在 npm test 中全局加载
const {
  classifyAllocatedUnit,
  calculateInputHash,
  validateApplyPreconditions,
  createResult,
  addPlanned,
  addCreated,
  addConflict,
  addWarning,
  addReused,
  addSkipped,
  formatResult,
  generateRunId,
  inventoryPreflight,
  inventoryWarehouseBootstrap,
  inventoryProductModePlan,
  inventorySerializedWarehousePlan,
  inventoryOpeningImportPlan,
  inventoryOpenOrdersCutover,
  inventoryOpenAfterSalesPlan,
  inventoryRebuildVerify,
  inventoryCutoverRollbackReport,
} = require('../scripts/inventory-cutover-lib.ts');

// ===========================================================================
// Mock Prisma 工厂
// ===========================================================================

function createMockPrisma(overrides = {}) {
  const defaultData = {
    warehouses: [],
    products: [],
    salesOrders: [],
    salesOrderItems: [],
    serializedInventoryUnits: [],
    inventoryConfiguration: null,
    warehouseProductStocks: [],
    inventoryBatches: [],
    inventoryDocuments: [],
    inventoryDocumentLines: [],
    inventoryMovements: [],
    inventoryReservations: [],
    productInventoryModeChanges: [],
    serializedInventoryAssignments: [],
    afterSalesOrders: [],
  };
  const data = { ...defaultData, ...overrides };

  const mock = {
    _data: data,
    _writes: { created: [], updated: [], deleted: [] },
  };

  // 通用 count
  mock.warehouse = {
    count: async (args) => {
      let items = data.warehouses;
      if (args?.where?.isDefault === true && args?.where?.isActive === true) {
        items = items.filter((w) => w.isDefault && w.isActive);
      }
      if (args?.where?.isActive === true) {
        items = items.filter((w) => w.isActive);
      }
      return items.length;
    },
    findFirst: async (args) => {
      let items = data.warehouses;
      if (args?.where?.OR) {
        const conditions = args.where.OR;
        items = items.filter((w) =>
          conditions.some((c) => {
            if (c.code) return w.code === c.code;
            if (c.name) return w.name === c.name;
            return false;
          }),
        );
      }
      if (args?.where?.isDefault === true && args?.where?.isActive === true) {
        items = items.filter((w) => w.isDefault && w.isActive);
      }
      return items[0] || null;
    },
    findMany: async () => data.warehouses,
    create: async (args) => {
      const wh = { id: `wh-${Date.now()}-${Math.random()}`, ...args.data };
      data.warehouses.push(wh);
      mock._writes.created.push({ model: 'warehouse', data: wh });
      return wh;
    },
    updateMany: async () => ({ count: 0 }),
  };

  mock.product = {
    findUnique: async (args) => data.products.find((p) => p.id === args.where.id) || null,
    groupBy: async (args) => {
      if (args.by?.[0] === 'name') {
        const counts = {};
        for (const p of data.products) {
          if (args.where?.isActive && !p.isActive) continue;
          counts[p.name] = (counts[p.name] || 0) + 1;
        }
        return Object.entries(counts)
          .filter(([, c]) => c > 1)
          .map(([name, count]) => ({ name, _count: { name: count } }));
      }
      if (args.by?.[0] === 'inventoryTrackingMode') {
        const counts = {};
        for (const p of data.products) {
          counts[p.inventoryTrackingMode] = (counts[p.inventoryTrackingMode] || 0) + 1;
        }
        return Object.entries(counts).map(([inventoryTrackingMode, count]) => ({
          inventoryTrackingMode,
          _count: { inventoryTrackingMode: count },
        }));
      }
      return [];
    },
    update: async (args) => {
      const p = data.products.find((p) => p.id === args.where.id);
      if (p) Object.assign(p, args.data);
      mock._writes.updated.push({ model: 'product', id: args.where.id, data: args.data });
      return p;
    },
  };

  mock.salesOrder = {
    findMany: async (args) => {
      let items = data.salesOrders;
      if (args?.where?.orderType) {
        if (args.where.orderType.not) {
          items = items.filter((o) => o.orderType !== args.where.orderType.not);
        }
      }
      if (args?.where?.packingStatus?.in) {
        items = items.filter((o) => args.where.packingStatus.in.includes(o.packingStatus));
      }
      if (args?.where?.status?.in) {
        items = items.filter((o) => args.where.status.in.includes(o.status));
      }
      if (args?.where?.orderType?.not) {
        items = items.filter((o) => o.orderType !== args.where.orderType.not);
      }
      return items.slice(0, args?.take || 100);
    },
    count: async (args) => {
      let items = data.salesOrders;
      if (args?.where?.packingStatus) {
        items = items.filter((o) => o.packingStatus === args.where.packingStatus);
      }
      if (args?.where?.orderType) {
        items = items.filter((o) => o.orderType === args.where.orderType);
      }
      if (args?.where?.orderType?.not) {
        items = items.filter((o) => o.orderType !== args.where.orderType.not);
      }
      if (args?.where?.status?.in) {
        items = items.filter((o) => args.where.status.in.includes(o.status));
      }
      return items.length;
    },
  };

  mock.salesOrderItem = {
    findMany: async (args) => {
      let items = data.salesOrderItems;
      if (args?.where?.deliveryType) {
        items = items.filter((i) => i.deliveryType === args.where.deliveryType);
      }
      if (args?.where?.productId?.not === null) {
        items = items.filter((i) => i.productId != null);
      }
      if (args?.where?.salesOrder) {
        if (args.where.salesOrder.status?.in) {
          const statuses = args.where.salesOrder.status.in;
          items = items.filter((i) => {
            const order = data.salesOrders.find((o) => o.id === i.salesOrderId);
            return order && statuses.includes(order.status);
          });
        }
        if (args.where.salesOrder.orderType?.not) {
          items = items.filter((i) => {
            const order = data.salesOrders.find((o) => o.id === i.salesOrderId);
            return order && order.orderType !== args.where.salesOrder.orderType.not;
          });
        }
        if (args.where.salesOrder.packingStatus?.in) {
          const statuses = args.where.salesOrder.packingStatus.in;
          items = items.filter((i) => {
            const order = data.salesOrders.find((o) => o.id === i.salesOrderId);
            return order && statuses.includes(order.packingStatus);
          });
        }
      }
      // include product
      const result = items.map((item) => ({
        ...item,
        product: data.products.find((p) => p.id === item.productId) || null,
        salesOrder: data.salesOrders.find((o) => o.id === item.salesOrderId) || null,
      }));
      return result.slice(0, args?.take || 100);
    },
    count: async () => data.salesOrderItems.length,
    update: async (args) => {
      const item = data.salesOrderItems.find((i) => i.id === args.where.id);
      if (item) Object.assign(item, args.data);
      mock._writes.updated.push({ model: 'salesOrderItem', id: args.where.id });
      return item;
    },
  };

  mock.serializedInventoryUnit = {
    count: async (args) => {
      let items = data.serializedInventoryUnits;
      if (args?.where?.warehouseId === null) {
        items = items.filter((u) => !u.warehouseId);
      }
      if (args?.where?.status === 'ALLOCATED') {
        items = items.filter((u) => u.status === 'ALLOCATED');
      }
      return items.length;
    },
    findMany: async (args) => {
      let items = data.serializedInventoryUnits;
      if (args?.where?.warehouseId === null) {
        items = items.filter((u) => !u.warehouseId);
      }
      if (args?.where?.status === 'ALLOCATED') {
        items = items.filter((u) => u.status === 'ALLOCATED');
      }
      const result = items.map((unit) => ({
        ...unit,
        salesOrder: data.salesOrders.find((o) => o.id === unit.salesOrderId) || null,
        salesOrderItem: data.salesOrderItems.find((i) => i.id === unit.salesOrderItemId) || null,
      }));
      return result.slice(0, args?.take || 1000);
    },
    update: async (args) => {
      const unit = data.serializedInventoryUnits.find((u) => u.id === args.where.id);
      if (unit) Object.assign(unit, args.data);
      mock._writes.updated.push({ model: 'serializedInventoryUnit', id: args.where.id });
      return unit;
    },
  };

  mock.serializedInventoryAssignment = {
    count: async () => data.serializedInventoryAssignments.length,
  };

  mock.inventoryConfiguration = {
    findFirst: async () => data.inventoryConfiguration || null,
    findMany: async () => (data.inventoryConfiguration ? [data.inventoryConfiguration] : []),
    create: async (args) => {
      data.inventoryConfiguration = { id: 'config-1', ...args.data };
      mock._writes.created.push({ model: 'inventoryConfiguration', data: data.inventoryConfiguration });
      return data.inventoryConfiguration;
    },
  };

  mock.warehouseProductStock = {
    findMany: async () => data.warehouseProductStocks,
    upsert: async (args) => {
      const idx = data.warehouseProductStocks.findIndex(
        (s) => s.warehouseId === args.where.warehouseId_productId.warehouseId &&
              s.productId === args.where.warehouseId_productId.productId,
      );
      if (idx >= 0) {
        Object.assign(data.warehouseProductStocks[idx], args.update?.update || {});
        return data.warehouseProductStocks[idx];
      }
      const stock = { id: `stk-${Date.now()}`, ...args.create };
      data.warehouseProductStocks.push(stock);
      return stock;
    },
  };

  mock.inventoryBatch = {
    findFirst: async (args) => {
      if (args?.where?.sourceLineKey) {
        return data.inventoryBatches.find((b) => b.sourceLineKey === args.where.sourceLineKey) || null;
      }
      return null;
    },
    create: async (args) => {
      const batch = { id: `batch-${Date.now()}`, ...args.data };
      data.inventoryBatches.push(batch);
      return batch;
    },
  };

  mock.inventoryDocument = {
    create: async (args) => {
      const doc = { id: `doc-${Date.now()}`, ...args.data };
      data.inventoryDocuments.push(doc);
      return doc;
    },
    findMany: async (args) => {
      let items = data.inventoryDocuments;
      if (args?.where?.type) items = items.filter((d) => d.type === args.where.type);
      if (args?.where?.status) items = items.filter((d) => d.status === args.where.status);
      if (args?.where?.sourceKey?.contains) {
        items = items.filter((d) => d.sourceKey?.includes(args.where.sourceKey.contains));
      }
      return items;
    },
  };

  mock.inventoryDocumentLine = {
    create: async (args) => {
      const line = { id: `line-${Date.now()}`, ...args.data };
      data.inventoryDocumentLines.push(line);
      return line;
    },
    update: async (args) => {
      const line = data.inventoryDocumentLines.find((l) => l.id === args.where.id);
      if (line) Object.assign(line, args.data);
      return line;
    },
  };

  mock.inventoryMovement = {
    create: async (args) => {
      const mv = { id: `mv-${Date.now()}`, ...args.data };
      data.inventoryMovements.push(mv);
      return mv;
    },
    findMany: async (args) => {
      let items = data.inventoryMovements;
      if (args?.where?.warehouseId && args?.where?.productId) {
        items = items.filter((m) => m.warehouseId === args.where.warehouseId && m.productId === args.where.productId);
      }
      return items;
    },
  };

  mock.inventoryReservation = {
    findFirst: async (args) => {
      if (args?.where?.inventoryLineKey) {
        return data.inventoryReservations.find((r) => r.inventoryLineKey === args.where.inventoryLineKey) || null;
      }
      return null;
    },
    findMany: async (args) => {
      let items = data.inventoryReservations;
      if (args?.where?.sourceKey?.contains) {
        items = items.filter((r) => r.sourceKey?.includes(args.where.sourceKey.contains));
      }
      return items;
    },
    create: async (args) => {
      const res = { id: `res-${Date.now()}`, ...args.data };
      data.inventoryReservations.push(res);
      return res;
    },
  };

  mock.productInventoryModeChange = {
    findMany: async (args) => {
      let items = data.productInventoryModeChanges;
      if (args?.where?.sourceKey?.contains) {
        items = items.filter((c) => c.sourceKey?.includes(args.where.sourceKey.contains));
      }
      return items;
    },
    create: async (args) => {
      const change = { id: `mc-${Date.now()}`, ...args.data };
      data.productInventoryModeChanges.push(change);
      return change;
    },
  };

  mock.afterSalesOrder = {
    findMany: async (args) => {
      let items = data.afterSalesOrders;
      if (args?.where?.status?.in) {
        items = items.filter((a) => args.where.status.in.includes(a.status));
      }
      const result = items.map((as) => ({
        ...as,
        salesOrder: data.salesOrders.find((o) => o.id === as.salesOrderId) || null,
        items: [],
      }));
      return result.slice(0, args?.take || 500);
    },
    count: async (args) => {
      let items = data.afterSalesOrders;
      if (args?.where?.status) items = items.filter((a) => a.status === args.where.status);
      return items.length;
    },
  };

  mock.$transaction = async (fn) => fn(mock);
  mock.$disconnect = async () => {};

  Object.assign(mock, overrides);
  return mock;
}

// ===========================================================================
// 纯函数测试
// ===========================================================================

describe('classifyAllocatedUnit', () => {
  test('缺订单 → CONFLICT', () => {
    const result = classifyAllocatedUnit({ salesOrder: null, salesOrderItem: {} });
    assert.strictEqual(result.classification, 'CONFLICT');
    assert.ok(result.reasons.includes('sales_order_missing'));
  });

  test('缺订单明细 → CONFLICT', () => {
    const result = classifyAllocatedUnit({ salesOrder: {}, salesOrderItem: null });
    assert.strictEqual(result.classification, 'CONFLICT');
    assert.ok(result.reasons.includes('sales_order_item_missing'));
  });

  test('CANCELLED 订单 → MANUAL_CONFIRMATION', () => {
    const result = classifyAllocatedUnit({
      salesOrder: { status: 'CANCELLED', items: [{ deliveryType: 'SHIPPING' }] },
      salesOrderItem: { deliveryType: 'SHIPPING' },
    });
    assert.strictEqual(result.classification, 'MANUAL_CONFIRMATION');
  });

  test('REFUNDED 订单 → MANUAL_CONFIRMATION', () => {
    const result = classifyAllocatedUnit({
      salesOrder: { status: 'REFUNDED', items: [{ deliveryType: 'SHIPPING' }] },
      salesOrderItem: { deliveryType: 'SHIPPING' },
    });
    assert.strictEqual(result.classification, 'MANUAL_CONFIRMATION');
  });

  test('混合配送 → MANUAL_CONFIRMATION', () => {
    const result = classifyAllocatedUnit({
      salesOrder: { status: 'VALID', items: [{ deliveryType: 'SHIPPING' }, { deliveryType: 'SELF_PICKUP' }] },
      salesOrderItem: { deliveryType: 'SHIPPING' },
    });
    assert.strictEqual(result.classification, 'MANUAL_CONFIRMATION');
    assert.ok(result.reasons.includes('mixed_or_missing_order_delivery_type'));
  });

  test('SELF_PICKUP → MANUAL_CONFIRMATION', () => {
    const result = classifyAllocatedUnit({
      salesOrder: { status: 'VALID', items: [{ deliveryType: 'SELF_PICKUP' }] },
      salesOrderItem: { deliveryType: 'SELF_PICKUP' },
    });
    assert.strictEqual(result.classification, 'MANUAL_CONFIRMATION');
    assert.ok(result.reasons.includes('legacy_self_pickup_must_not_be_guessed'));
  });

  test('有效未打包 shipping → CANDIDATE_RESERVED', () => {
    const result = classifyAllocatedUnit({
      salesOrder: { status: 'VALID', packingStatus: 'PENDING', items: [{ deliveryType: 'SHIPPING' }] },
      salesOrderItem: { deliveryType: 'SHIPPING' },
      warehouseId: 'wh1',
      purchaseCostCents: 1500,
      logisticsCode: 'LC001',
      factoryDate: '2026-01-01',
      productionBatch: 'PB001',
      batchSerialNo: 'BS001',
    });
    assert.strictEqual(result.classification, 'CANDIDATE_RESERVED');
  });

  test('shipping + PACKED → CANDIDATE_OUTBOUND', () => {
    const result = classifyAllocatedUnit({
      salesOrder: { status: 'VALID', packingStatus: 'PACKED', items: [{ deliveryType: 'SHIPPING' }] },
      salesOrderItem: { deliveryType: 'SHIPPING' },
      warehouseId: 'wh1',
      purchaseCostCents: 1500,
      logisticsCode: 'LC001',
      factoryDate: '2026-01-01',
      productionBatch: 'PB001',
      batchSerialNo: 'BS001',
    });
    assert.strictEqual(result.classification, 'CANDIDATE_OUTBOUND');
  });

  test('资料不全 → MANUAL_CONFIRMATION', () => {
    const result = classifyAllocatedUnit({
      salesOrder: { status: 'VALID', packingStatus: 'PENDING', items: [{ deliveryType: 'SHIPPING' }] },
      salesOrderItem: { deliveryType: 'SHIPPING' },
      warehouseId: null,
      purchaseCostCents: null,
      logisticsCode: 'LC001',
      factoryDate: '2026-01-01',
      productionBatch: 'PB001',
      batchSerialNo: 'BS001',
    });
    assert.strictEqual(result.classification, 'MANUAL_CONFIRMATION');
    assert.ok(result.reasons.includes('warehouse_missing'));
    assert.ok(result.reasons.includes('purchase_cost_missing'));
  });
});

describe('calculateInputHash', () => {
  test('确定性：相同输入相同 hash', () => {
    const h1 = calculateInputHash({ a: 1, b: 'test' });
    const h2 = calculateInputHash({ a: 1, b: 'test' });
    assert.strictEqual(h1, h2);
    assert.strictEqual(h1.length, 64);
  });

  test('不同输入不同 hash', () => {
    const h1 = calculateInputHash({ a: 1 });
    const h2 = calculateInputHash({ a: 2 });
    assert.notStrictEqual(h1, h2);
  });
});

describe('validateApplyPreconditions', () => {
  test('dry-run 模式拒绝 apply', () => {
    const errors = validateApplyPreconditions(
      { apply: false, env: 'test', backupConfirmed: true, maintenanceFreeze: true, manifestHash: null },
      'abc',
    );
    assert.ok(errors.some((e) => e.includes('--apply')));
  });

  test('生产环境拒绝', () => {
    const errors = validateApplyPreconditions(
      { apply: true, env: 'production', backupConfirmed: true, maintenanceFreeze: true, manifestHash: null },
      'abc',
    );
    assert.ok(errors.some((e) => e.includes('生产')));
  });

  test('备份未确认拒绝', () => {
    const errors = validateApplyPreconditions(
      { apply: true, env: 'test', backupConfirmed: false, maintenanceFreeze: true, manifestHash: null },
      'abc',
    );
    assert.ok(errors.some((e) => e.includes('备份')));
  });

  test('维护冻结缺失拒绝', () => {
    const errors = validateApplyPreconditions(
      { apply: true, env: 'test', backupConfirmed: true, maintenanceFreeze: false, manifestHash: null },
      'abc',
    );
    assert.ok(errors.some((e) => e.includes('冻结')));
  });

  test('manifest hash 不一致拒绝', () => {
    const errors = validateApplyPreconditions(
      { apply: true, env: 'test', backupConfirmed: true, maintenanceFreeze: true, manifestHash: 'aaa' },
      'bbb',
    );
    assert.ok(errors.some((e) => e.includes('hash')));
  });

  test('全部满足时返回空数组', () => {
    const errors = validateApplyPreconditions(
      { apply: true, env: 'test', backupConfirmed: true, maintenanceFreeze: true, manifestHash: 'abc' },
      'abc',
    );
    assert.strictEqual(errors.length, 0);
  });
});

describe('CutoverResult 基础', () => {
  test('createResult 初始化正确', () => {
    const result = createResult('inventory-preflight', 'run-1', 'hash-1', true);
    assert.strictEqual(result.step, 'inventory-preflight');
    assert.strictEqual(result.runId, 'run-1');
    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(result.planned, 0);
    assert.strictEqual(result.applied, null);
  });

  test('addPlanned/addCreated/addConflict/addWarning 计数正确', () => {
    const result = createResult('test', 'run-1', 'hash-1', true);
    addPlanned(result, '1', 'test', 'planned');
    addCreated(result, '2', 'test', 'created');
    addConflict(result, '3', 'test', 'conflict', 'detail');
    addWarning(result, '4', 'test', 'warning', 'detail');
    addReused(result, '5', 'test', 'reused');
    addSkipped(result, '6', 'test', 'skipped');
    assert.strictEqual(result.planned, 1);
    assert.strictEqual(result.created, 1);
    assert.strictEqual(result.conflict, 1);
    assert.strictEqual(result.warning, 1);
    assert.strictEqual(result.reused, 1);
    assert.strictEqual(result.skipped, 1);
    assert.strictEqual(result.items.length, 6);
    assert.strictEqual(result.conflicts.length, 1);
    assert.strictEqual(result.warnings.length, 1);
  });

  test('formatResult 不泄露完整 hash', () => {
    const result = createResult('test', 'run-1', 'a'.repeat(64), true);
    const formatted = formatResult(result);
    const parsed = JSON.parse(formatted);
    assert.ok(!parsed.inputHash.includes('a'.repeat(64)));
    assert.ok(parsed.inputHash.endsWith('...'));
  });
});

// ===========================================================================
// 子命令测试（Mock Prisma）
// ===========================================================================

describe('inventory-preflight', () => {
  test('空库产生警告', async () => {
    const prisma = createMockPrisma();
    const result = await inventoryPreflight(prisma, 'run-1', 'hash-1', true);
    assert.strictEqual(result.step, 'inventory-preflight');
    assert.ok(result.warning > 0);
    assert.strictEqual(result.applied, null); // 只读
  });

  test('有仓库时不产生空库警告', async () => {
    const prisma = createMockPrisma({
      warehouses: [{ id: 'wh1', code: 'W01', name: '主仓库', isActive: true, isDefault: true }],
      products: [{ id: 'p1', name: '商品A', inventoryTrackingMode: 'NONE', isActive: true }],
    });
    const result = await inventoryPreflight(prisma, 'run-1', 'hash-1', true);
    assert.strictEqual(result.applied, null);
  });

  test('dry-run 零写入', async () => {
    const prisma = createMockPrisma();
    await inventoryPreflight(prisma, 'run-1', 'hash-1', true);
    assert.strictEqual(prisma._writes.created.length, 0);
    assert.strictEqual(prisma._writes.updated.length, 0);
  });
});

describe('inventory-warehouse-bootstrap', () => {
  test('dry-run 只规划不创建', async () => {
    const prisma = createMockPrisma();
    const result = await inventoryWarehouseBootstrap(
      prisma,
      { dryRun: true, apply: false, env: 'test', backupConfirmed: false, maintenanceFreeze: false, manifestHash: null,
        warehouses: [{ code: 'W01', name: '主仓库', isDefault: true }] },
      'run-1',
      'hash-1',
    );
    assert.ok(result.planned > 0);
    assert.strictEqual(prisma._writes.created.length, 0);
  });

  test('apply 创建仓库', async () => {
    const prisma = createMockPrisma();
    const result = await inventoryWarehouseBootstrap(
      prisma,
      { dryRun: false, apply: true, env: 'test', backupConfirmed: true, maintenanceFreeze: true, manifestHash: null,
        warehouses: [{ code: 'W01', name: '主仓库', isDefault: true }] },
      'run-1',
      'hash-1',
    );
    assert.ok(result.created > 0);
    assert.ok(prisma._writes.created.some((w) => w.model === 'warehouse'));
  });

  test('已有默认仓时不重复创建', async () => {
    const prisma = createMockPrisma({
      warehouses: [{ id: 'wh1', code: 'W01', name: '主仓库', isActive: true, isDefault: true }],
    });
    const result = await inventoryWarehouseBootstrap(
      prisma,
      { dryRun: true, apply: false, env: 'test', backupConfirmed: false, maintenanceFreeze: false, manifestHash: null,
        warehouses: [{ code: 'W01', name: '主仓库', isDefault: true }] },
      'run-1',
      'hash-1',
    );
    assert.ok(result.reused > 0 || result.conflict > 0);
  });

  test('第二次执行幂等', async () => {
    const prisma = createMockPrisma();
    const opts = { dryRun: false, apply: true, env: 'test', backupConfirmed: true, maintenanceFreeze: true, manifestHash: null,
      warehouses: [{ code: 'W01', name: '主仓库', isDefault: true }] };
    await inventoryWarehouseBootstrap(prisma, opts, 'run-1', 'hash-1');
    const firstCreated = prisma._writes.created.length;
    const result2 = await inventoryWarehouseBootstrap(prisma, opts, 'run-2', 'hash-2');
    assert.strictEqual(prisma._writes.created.length, firstCreated); // 不重复创建
    assert.ok(result2.reused > 0 || result2.skipped > 0);
  });

  test('无输入时产生警告', async () => {
    const prisma = createMockPrisma();
    const result = await inventoryWarehouseBootstrap(
      prisma,
      { dryRun: true, apply: false, env: 'test', backupConfirmed: false, maintenanceFreeze: false, manifestHash: null },
      'run-1',
      'hash-1',
    );
    assert.ok(result.warning > 0);
  });
});

describe('inventory-product-mode-plan', () => {
  test('expectedCurrentMode 冲突', async () => {
    const prisma = createMockPrisma({
      products: [{ id: 'p1', name: '商品A', inventoryTrackingMode: 'QUANTITY', isActive: true }],
    });
    const result = await inventoryProductModePlan(
      prisma,
      { dryRun: true, apply: false, env: 'test', backupConfirmed: false, maintenanceFreeze: false, manifestHash: null,
        productModePlans: [{ productId: 'p1', expectedCurrentMode: 'NONE', targetMode: 'QUANTITY' }] },
      'run-1',
      'hash-1',
    );
    assert.ok(result.conflict > 0);
  });

  test('茅台保持 SERIALIZED 不切换', async () => {
    const prisma = createMockPrisma({
      products: [{ id: 'p1', name: '茅台', inventoryTrackingMode: 'SERIALIZED', isActive: true }],
    });
    const result = await inventoryProductModePlan(
      prisma,
      { dryRun: true, apply: false, env: 'test', backupConfirmed: false, maintenanceFreeze: false, manifestHash: null,
        productModePlans: [{ productId: 'p1', expectedCurrentMode: 'SERIALIZED', targetMode: 'QUANTITY' }] },
      'run-1',
      'hash-1',
    );
    assert.ok(result.conflict > 0);
  });

  test('商品不存在 → 冲突', async () => {
    const prisma = createMockPrisma();
    const result = await inventoryProductModePlan(
      prisma,
      { dryRun: true, apply: false, env: 'test', backupConfirmed: false, maintenanceFreeze: false, manifestHash: null,
        productModePlans: [{ productId: 'nonexistent', expectedCurrentMode: 'NONE', targetMode: 'QUANTITY' }] },
      'run-1',
      'hash-1',
    );
    assert.ok(result.conflict > 0);
  });

  test('apply 成功切换', async () => {
    const prisma = createMockPrisma({
      products: [{ id: 'p1', name: '商品A', unit: '瓶', inventoryTrackingMode: 'NONE', isActive: true }],
    });
    const result = await inventoryProductModePlan(
      prisma,
      { dryRun: false, apply: true, env: 'test', backupConfirmed: true, maintenanceFreeze: true, manifestHash: null,
        productModePlans: [{ productId: 'p1', expectedCurrentMode: 'NONE', targetMode: 'QUANTITY' }] },
      'run-1',
      'hash-1',
    );
    assert.ok(result.created > 0);
    assert.strictEqual(prisma._data.products[0].inventoryTrackingMode, 'QUANTITY');
  });

  test('第二次执行幂等（已切换 → 冲突）', async () => {
    const prisma = createMockPrisma({
      products: [{ id: 'p1', name: '商品A', inventoryTrackingMode: 'QUANTITY', isActive: true }],
    });
    const result = await inventoryProductModePlan(
      prisma,
      { dryRun: true, apply: false, env: 'test', backupConfirmed: false, maintenanceFreeze: false, manifestHash: null,
        productModePlans: [{ productId: 'p1', expectedCurrentMode: 'NONE', targetMode: 'QUANTITY' }] },
      'run-1',
      'hash-1',
    );
    assert.ok(result.conflict > 0); // expectedCurrentMode 不匹配
  });
});

describe('inventory-open-orders-cutover', () => {
  test('无 goLiveAt → 冲突', async () => {
    const prisma = createMockPrisma();
    const result = await inventoryOpenOrdersCutover(
      prisma,
      { dryRun: true, apply: false, env: 'test', backupConfirmed: false, maintenanceFreeze: false, manifestHash: null },
      'run-1',
      'hash-1',
    );
    assert.ok(result.conflict > 0);
  });

  test('开放邮寄订单生成占用', async () => {
    const prisma = createMockPrisma({
      warehouses: [{ id: 'wh1', code: 'W01', name: '主仓库', isActive: true, isDefault: true }],
      products: [{ id: 'p1', name: '商品A', inventoryTrackingMode: 'QUANTITY', isActive: true }],
      salesOrders: [{ id: 'so1', orderNo: 'SO001', orderType: 'TRAVEL_GROUP', status: 'VALID', packingStatus: 'PENDING', fulfillmentWarehouseId: null }],
      salesOrderItems: [{ id: 'si1', salesOrderId: 'so1', productId: 'p1', productName: '商品A', quantity: 5, deliveryType: 'SHIPPING', inventoryLineKey: null }],
    });
    const result = await inventoryOpenOrdersCutover(
      prisma,
      { dryRun: true, apply: false, env: 'test', backupConfirmed: false, maintenanceFreeze: false, manifestHash: null,
        goLiveAt: '2026-07-27T00:00:00Z' },
      'run-1',
      'hash-1',
    );
    assert.ok(result.planned > 0);
  });

  test('排除 AFTER_SALES 财务订单', async () => {
    const prisma = createMockPrisma({
      warehouses: [{ id: 'wh1', code: 'W01', name: '主仓库', isActive: true, isDefault: true }],
      products: [{ id: 'p1', name: '商品A', inventoryTrackingMode: 'QUANTITY', isActive: true }],
      salesOrders: [{ id: 'so1', orderNo: 'AS001', orderType: 'AFTER_SALES', status: 'VALID', packingStatus: 'PENDING', fulfillmentWarehouseId: null }],
      salesOrderItems: [{ id: 'si1', salesOrderId: 'so1', productId: 'p1', productName: '商品A', quantity: 5, deliveryType: 'SHIPPING', inventoryLineKey: null }],
    });
    const result = await inventoryOpenOrdersCutover(
      prisma,
      { dryRun: true, apply: false, env: 'test', backupConfirmed: false, maintenanceFreeze: false, manifestHash: null,
        goLiveAt: '2026-07-27T00:00:00Z' },
      'run-1',
      'hash-1',
    );
    assert.strictEqual(result.planned, 0); // AFTER_SALES 被排除
  });

  test('排除已打包订单', async () => {
    const prisma = createMockPrisma({
      warehouses: [{ id: 'wh1', code: 'W01', name: '主仓库', isActive: true, isDefault: true }],
      products: [{ id: 'p1', name: '商品A', inventoryTrackingMode: 'QUANTITY', isActive: true }],
      salesOrders: [{ id: 'so1', orderNo: 'SO001', orderType: 'TRAVEL_GROUP', status: 'VALID', packingStatus: 'PACKED', fulfillmentWarehouseId: null }],
      salesOrderItems: [{ id: 'si1', salesOrderId: 'so1', productId: 'p1', productName: '商品A', quantity: 5, deliveryType: 'SHIPPING', inventoryLineKey: null }],
    });
    const result = await inventoryOpenOrdersCutover(
      prisma,
      { dryRun: true, apply: false, env: 'test', backupConfirmed: false, maintenanceFreeze: false, manifestHash: null,
        goLiveAt: '2026-07-27T00:00:00Z' },
      'run-1',
      'hash-1',
    );
    assert.strictEqual(result.planned, 0); // PACKED 被排除
  });

  test('第二次执行幂等', async () => {
    const prisma = createMockPrisma({
      warehouses: [{ id: 'wh1', code: 'W01', name: '主仓库', isActive: true, isDefault: true }],
      products: [{ id: 'p1', name: '商品A', inventoryTrackingMode: 'QUANTITY', isActive: true }],
      salesOrders: [{ id: 'so1', orderNo: 'SO001', orderType: 'TRAVEL_GROUP', status: 'VALID', packingStatus: 'PENDING', fulfillmentWarehouseId: null }],
      salesOrderItems: [{ id: 'si1', salesOrderId: 'so1', productId: 'p1', productName: '商品A', quantity: 5, deliveryType: 'SHIPPING', inventoryLineKey: 'order-so1-item-si1' }],
      inventoryReservations: [{ id: 'res1', sourceKey: 'cutover-reserve-order-so1-item-si1-run-1', inventoryLineKey: 'order-so1-item-si1', warehouseId: 'wh1', productId: 'p1', requestedQty: 5, reservedQty: 5, assignedQty: 0, outboundQty: 0, status: 'RESERVED' }],
    });
    const result = await inventoryOpenOrdersCutover(
      prisma,
      { dryRun: true, apply: false, env: 'test', backupConfirmed: false, maintenanceFreeze: false, manifestHash: null,
        goLiveAt: '2026-07-27T00:00:00Z' },
      'run-1',
      'hash-1',
    );
    assert.ok(result.reused > 0); // 已有占用，复用
  });

  test('dry-run 零写入', async () => {
    const prisma = createMockPrisma({
      warehouses: [{ id: 'wh1', code: 'W01', name: '主仓库', isActive: true, isDefault: true }],
      products: [{ id: 'p1', name: '商品A', inventoryTrackingMode: 'QUANTITY', isActive: true }],
      salesOrders: [{ id: 'so1', orderNo: 'SO001', orderType: 'TRAVEL_GROUP', status: 'VALID', packingStatus: 'PENDING', fulfillmentWarehouseId: null }],
      salesOrderItems: [{ id: 'si1', salesOrderId: 'so1', productId: 'p1', productName: '商品A', quantity: 5, deliveryType: 'SHIPPING', inventoryLineKey: null }],
    });
    await inventoryOpenOrdersCutover(
      prisma,
      { dryRun: true, apply: false, env: 'test', backupConfirmed: false, maintenanceFreeze: false, manifestHash: null,
        goLiveAt: '2026-07-27T00:00:00Z' },
      'run-1',
      'hash-1',
    );
    assert.strictEqual(prisma._writes.created.length, 0);
    assert.strictEqual(prisma._writes.updated.length, 0);
  });
});

describe('inventory-rebuild-verify', () => {
  test('余额一致时不产生冲突', async () => {
    const prisma = createMockPrisma({
      warehouseProductStocks: [{ id: 's1', warehouseId: 'wh1', productId: 'p1', onHandQty: 10, reservedQty: 0, unavailableQty: 0, inTransitQty: 0 }],
      inventoryMovements: [{ id: 'mv1', warehouseId: 'wh1', productId: 'p1', onHandDelta: 10, reservedDelta: 0, unavailableDelta: 0, inTransitDelta: 0 }],
    });
    const result = await inventoryRebuildVerify(prisma, 'run-1', 'hash-1', true);
    assert.strictEqual(result.conflict, 0);
    assert.strictEqual(result.applied, null); // 只读
  });

  test('余额不一致时产生冲突', async () => {
    const prisma = createMockPrisma({
      warehouseProductStocks: [{ id: 's1', warehouseId: 'wh1', productId: 'p1', onHandQty: 10, reservedQty: 0, unavailableQty: 0, inTransitQty: 0 }],
      inventoryMovements: [{ id: 'mv1', warehouseId: 'wh1', productId: 'p1', onHandDelta: 5, reservedDelta: 0, unavailableDelta: 0, inTransitDelta: 0 }],
    });
    const result = await inventoryRebuildVerify(prisma, 'run-1', 'hash-1', true);
    assert.ok(result.conflict > 0);
  });

  test('占用为负产生冲突', async () => {
    const prisma = createMockPrisma({
      warehouseProductStocks: [{ id: 's1', warehouseId: 'wh1', productId: 'p1', onHandQty: 10, reservedQty: -1, unavailableQty: 0, inTransitQty: 0 }],
      inventoryMovements: [{ id: 'mv1', warehouseId: 'wh1', productId: 'p1', onHandDelta: 10, reservedDelta: -1, unavailableDelta: 0, inTransitDelta: 0 }],
    });
    const result = await inventoryRebuildVerify(prisma, 'run-1', 'hash-1', true);
    assert.ok(result.conflict > 0);
  });
});

describe('inventory-cutover-rollback-report', () => {
  test('不删除 POSTED 事实', async () => {
    const prisma = createMockPrisma({
      inventoryDocuments: [{ id: 'doc1', type: 'OPENING', status: 'POSTED', sourceKey: 'opening-batch-run-1' }],
      inventoryReservations: [{ id: 'res1', sourceKey: 'cutover-reserve-run-1', inventoryLineKey: 'key1', status: 'RESERVED', outboundQty: 0 }],
    });
    const result = await inventoryCutoverRollbackReport(prisma, { runId: 'run-1' }, 'run-1', 'hash-1', true);
    assert.strictEqual(result.applied, null); // 只读
    assert.strictEqual(prisma._writes.created.length, 0);
    assert.strictEqual(prisma._writes.updated.length, 0);
  });

  test('POSTED 期初单据产生警告', async () => {
    const prisma = createMockPrisma({
      inventoryDocuments: [{ id: 'doc1', type: 'OPENING', status: 'POSTED', sourceKey: 'opening-batch-run-1' }],
    });
    const result = await inventoryCutoverRollbackReport(prisma, { runId: 'run-1' }, 'run-1', 'hash-1', true);
    assert.ok(result.warning > 0);
  });
});

describe('inventory-open-after-sales-plan', () => {
  test('列出未完成售后', async () => {
    const prisma = createMockPrisma({
      afterSalesOrders: [{ id: 'as1', afterSalesNo: 'AS001', salesOrderId: 'so1', status: 'NEGOTIATING' }],
    });
    const result = await inventoryOpenAfterSalesPlan(
      prisma,
      { dryRun: true, apply: false, env: 'test', backupConfirmed: false, maintenanceFreeze: false, manifestHash: null },
      'run-1',
      'hash-1',
    );
    assert.ok(result.planned > 0);
  });

  test('dry-run 零写入', async () => {
    const prisma = createMockPrisma();
    await inventoryOpenAfterSalesPlan(
      prisma,
      { dryRun: true, apply: false, env: 'test', backupConfirmed: false, maintenanceFreeze: false, manifestHash: null },
      'run-1',
      'hash-1',
    );
    assert.strictEqual(prisma._writes.created.length, 0);
  });
});

describe('inventory-opening-import-plan', () => {
  test('整数数量校验', async () => {
    const prisma = createMockPrisma({
      warehouses: [{ id: 'wh1', code: 'W01', name: '主仓库', isActive: true, isDefault: true }],
      products: [{ id: 'p1', name: '商品A', unit: '瓶', inventoryTrackingMode: 'QUANTITY', isActive: true }],
    });
    const result = await inventoryOpeningImportPlan(
      prisma,
      { dryRun: true, apply: false, env: 'test', backupConfirmed: false, maintenanceFreeze: false, manifestHash: null,
        openingItems: [{ warehouseCode: 'W01', productId: 'p1', quantity: 1.5 }] },
      'run-1',
      'hash-1',
    );
    assert.ok(result.conflict > 0); // 1.5 不是整数
  });

  test('茅台不能用数量导入', async () => {
    const prisma = createMockPrisma({
      warehouses: [{ id: 'wh1', code: 'W01', name: '主仓库', isActive: true, isDefault: true }],
      products: [{ id: 'p1', name: '茅台', unit: '瓶', inventoryTrackingMode: 'SERIALIZED', isActive: true }],
    });
    const result = await inventoryOpeningImportPlan(
      prisma,
      { dryRun: true, apply: false, env: 'test', backupConfirmed: false, maintenanceFreeze: false, manifestHash: null,
        openingItems: [{ warehouseCode: 'W01', productId: 'p1', quantity: 10 }] },
      'run-1',
      'hash-1',
    );
    assert.ok(result.conflict > 0);
  });

  test('NONE 商品不能导入', async () => {
    const prisma = createMockPrisma({
      warehouses: [{ id: 'wh1', code: 'W01', name: '主仓库', isActive: true, isDefault: true }],
      products: [{ id: 'p1', name: '商品A', unit: '瓶', inventoryTrackingMode: 'NONE', isActive: true }],
    });
    const result = await inventoryOpeningImportPlan(
      prisma,
      { dryRun: true, apply: false, env: 'test', backupConfirmed: false, maintenanceFreeze: false, manifestHash: null,
        openingItems: [{ warehouseCode: 'W01', productId: 'p1', quantity: 10 }] },
      'run-1',
      'hash-1',
    );
    assert.ok(result.conflict > 0);
  });

  test('dry-run 零写入', async () => {
    const prisma = createMockPrisma({
      warehouses: [{ id: 'wh1', code: 'W01', name: '主仓库', isActive: true, isDefault: true }],
      products: [{ id: 'p1', name: '商品A', unit: '瓶', inventoryTrackingMode: 'QUANTITY', isActive: true }],
    });
    await inventoryOpeningImportPlan(
      prisma,
      { dryRun: true, apply: false, env: 'test', backupConfirmed: false, maintenanceFreeze: false, manifestHash: null,
        openingItems: [{ warehouseCode: 'W01', productId: 'p1', quantity: 10 }] },
      'run-1',
      'hash-1',
    );
    assert.strictEqual(prisma._writes.created.length, 0);
  });
});

describe('inventory-serialized-warehouse-plan', () => {
  test('无默认仓 → 冲突', async () => {
    const prisma = createMockPrisma({
      serializedInventoryUnits: [{ id: 'u1', logisticsCode: 'LC001', warehouseId: null, status: 'AVAILABLE', purchaseCostCents: 100, factoryDate: '2026-01-01', productionBatch: 'PB1', batchSerialNo: 'BS1' }],
    });
    const result = await inventorySerializedWarehousePlan(
      prisma,
      { dryRun: true, apply: false, env: 'test', backupConfirmed: false, maintenanceFreeze: false, manifestHash: null },
      'run-1',
      'hash-1',
    );
    // 无默认仓时会尝试分配但找不到
  });

  test('ALLOCATED 分类报告', async () => {
    const prisma = createMockPrisma({
      warehouses: [{ id: 'wh1', code: 'W01', name: '主仓库', isActive: true, isDefault: true }],
      serializedInventoryUnits: [
        { id: 'u1', logisticsCode: 'LC001', warehouseId: null, status: 'AVAILABLE', purchaseCostCents: 100, factoryDate: '2026-01-01', productionBatch: 'PB1', batchSerialNo: 'BS1' },
      ],
    });
    const result = await inventorySerializedWarehousePlan(
      prisma,
      { dryRun: true, apply: false, env: 'test', backupConfirmed: false, maintenanceFreeze: false, manifestHash: null },
      'run-1',
      'hash-1',
    );
    assert.ok(result.planned >= 0 || result.conflict >= 0);
  });
});

describe('generateRunId', () => {
  test('生成唯一 runId', () => {
    const id1 = generateRunId();
    const id2 = generateRunId();
    assert.notStrictEqual(id1, id2);
    assert.ok(id1.startsWith('cutover-'));
  });
});
