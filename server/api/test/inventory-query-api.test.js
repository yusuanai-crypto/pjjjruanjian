const assert = require('node:assert/strict');
const test = require('node:test');
const { Readable } = require('node:stream');
const { Test } = require('@nestjs/testing');

const {
  AuthNestService,
} = require('../src/modules/auth/auth.nest.service');
const {
  InventoryAccountingService,
} = require('../src/modules/inventory/inventory-accounting.service');
const {
  InventoryNestController,
} = require('../src/modules/inventory/inventory.nest.controller');
const {
  InventoryQueryService,
} = require('../src/modules/inventory/inventory-query.service');
const {
  InventoryQueryPrismaRepository,
} = require('../src/modules/inventory/inventory-query.prisma.repository');
const {
  InventoryReportService,
} = require('../src/modules/inventory/inventory-report.service');
const {
  InventoryStocktakeService,
} = require('../src/modules/inventory/inventory-stocktake.service');
const {
  getRolePermissions,
} = require('../src/modules/auth/roles');

const ACTORS = {
  super_admin: actor('super_admin'),
  admin: actor('admin'),
  warehouse: actor('warehouse'),
  finance: actor('finance'),
  boss: actor('boss'),
  sales: actor('sales'),
  after_sales: actor('after_sales'),
  taster: actor('taster'),
  front_desk: actor('front_desk'),
};

test('inventory query API: Nest routes expose the documented warehouse, stock, movement and alert contracts', async () => {
  const fixture = createFixture();
  const accounting = {
    rebuildCheck: async () => ({ consistent: true }),
    businessInbound: async () => ({ documentId: 'inbound-http' }),
    updateBatchCost: async () => ({ documentId: 'cost-http' }),
    reverseInbound: async () => ({ documentId: 'reverse-http' }),
    createTransfer: async () => ({ transferId: 'transfer-1' }),
    confirmTransferOutbound: async () => ({
      transferId: 'transfer-1',
    }),
    reverseTransferOutbound: async () => ({
      transferId: 'transfer-1',
    }),
    receiveTransfer: async () => ({
      transferId: 'transfer-1',
      receiptId: 'receipt-1',
    }),
    reverseTransferReceipt: async () => ({
      receiptId: 'receipt-2',
    }),
    businessMarkUnavailable: async () => ({
      documentId: 'unavailable-http',
    }),
    businessRestoreAvailable: async () => ({
      documentId: 'available-http',
    }),
  };
  const stocktakes = {
    list: async () => ({ data: [], pagination: { total: 0 } }),
    get: async (_actor, id) => ({ id, status: 'DRAFT' }),
    create: async () => ({ stocktake: { id: 'stocktake-1' } }),
    submit: async () => ({
      stocktake: { id: 'stocktake-1', status: 'SUBMITTED' },
    }),
    approve: async () => ({
      stocktake: { id: 'stocktake-1', status: 'POSTED' },
    }),
    reject: async () => ({
      stocktake: { id: 'stocktake-1', status: 'REJECTED' },
    }),
    reverse: async () => ({
      stocktake: { id: 'stocktake-1', status: 'REVERSED' },
    }),
  };
  const moduleFixture = await Test.createTestingModule({
    controllers: [InventoryNestController],
    providers: [
      {
        provide: AuthNestService,
        useValue: {
          authenticateRequest: async (request) =>
            ACTORS[request.headers['x-test-role'] || 'admin'],
        },
      },
      {
        provide: InventoryAccountingService,
        useValue: accounting,
      },
      {
        provide: InventoryQueryService,
        useValue: fixture.service,
      },
      {
        provide: InventoryReportService,
        useValue: {
          query: async () => ({
            reportType: 'warehouse-balances',
            columns: [],
            rows: [],
            pagination: { page: 1, pageSize: 20, total: 0 },
          }),
          exportXlsx: async () => ({
            fileName: 'inventory-warehouse-balances-test.xlsx',
            stream: Readable.from(Buffer.from('fake-xlsx')),
            completion: Promise.resolve(),
          }),
        },
      },
      {
        provide: InventoryStocktakeService,
        useValue: stocktakes,
      },
    ],
  }).compile();
  const app = moduleFixture.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0);
  const port = app.getHttpServer().address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const contracts = [
      ['GET', '/api/inventory/configuration', undefined, 200],
      [
        'PATCH',
        '/api/inventory/configuration',
        { maintenanceMode: true },
        200,
      ],
      ['GET', '/api/inventory/warehouses', undefined, 200],
      [
        'POST',
        '/api/inventory/warehouses',
        {
          code: 'WH-HTTP',
          name: 'Warehouse HTTP',
        },
        201,
      ],
      [
        'PATCH',
        '/api/inventory/warehouses',
        {
          id: 'wh-b',
          address: 'HTTP address',
        },
        200,
      ],
      ['GET', '/api/inventory/stocks', undefined, 200],
      [
        'GET',
        '/api/inventory/reports/warehouse-balances',
        undefined,
        200,
      ],
      [
        'GET',
        '/api/inventory/reports/warehouse-balances/export.xlsx',
        undefined,
        200,
      ],
      [
        'GET',
        '/api/inventory/stocks/wh-a/product-quantity-b',
        undefined,
        200,
      ],
      ['GET', '/api/inventory/movements', undefined, 200],
      ['GET', '/api/inventory/stocktakes', undefined, 200],
      [
        'GET',
        '/api/inventory/stocktakes/stocktake-1',
        undefined,
        200,
      ],
      ['POST', '/api/inventory/stocktakes', {}, 201],
      [
        'POST',
        '/api/inventory/stocktakes/stocktake-1/submit',
        {},
        201,
      ],
      [
        'POST',
        '/api/inventory/stocktakes/stocktake-1/approve',
        {},
        201,
      ],
      [
        'POST',
        '/api/inventory/stocktakes/stocktake-1/reject',
        {},
        201,
      ],
      [
        'POST',
        '/api/inventory/stocktakes/stocktake-1/reverse',
        {},
        201,
      ],
      ['GET', '/api/inventory/inbounds', undefined, 200],
      [
        'GET',
        '/api/inventory/inbounds/inbound-1',
        undefined,
        200,
      ],
      [
        'POST',
        '/api/inventory/inbounds',
        { kind: 'OTHER_IN' },
        201,
      ],
      [
        'PATCH',
        '/api/inventory/batches/batch-b/cost',
        { purchaseUnitCostCents: 100 },
        200,
      ],
      [
        'POST',
        '/api/inventory/inbounds/inbound-1/reverse',
        { reason: 'Correction' },
        201,
      ],
      ['GET', '/api/inventory/transfers', undefined, 200],
      [
        'GET',
        '/api/inventory/transfers/transfer-1',
        undefined,
        200,
      ],
      [
        'POST',
        '/api/inventory/transfers',
        { sourceKey: 'transfer:http:create' },
        201,
      ],
      [
        'POST',
        '/api/inventory/transfers/transfer-1/outbound',
        { sourceKey: 'transfer:http:outbound' },
        201,
      ],
      [
        'POST',
        '/api/inventory/transfers/transfer-1/outbound/reverse',
        { reason: 'Correction' },
        201,
      ],
      [
        'POST',
        '/api/inventory/transfers/transfer-1/receipts',
        { sourceKey: 'transfer:http:receipt' },
        201,
      ],
      [
        'POST',
        '/api/inventory/transfers/receipts/receipt-1/reverse',
        { reason: 'Correction' },
        201,
      ],
      [
        'POST',
        '/api/inventory/unavailable/mark',
        { reason: 'Damage' },
        201,
      ],
      [
        'POST',
        '/api/inventory/unavailable/restore',
        { reason: 'Inspection passed' },
        201,
      ],
      ['GET', '/api/inventory/alert-configs', undefined, 200],
      [
        'PATCH',
        '/api/inventory/alert-configs',
        {
          warehouseId: 'wh-a',
          productId: 'product-quantity-b',
          minimumAvailableQty: 8,
        },
        200,
      ],
      [
        'GET',
        '/api/inventory/rebuild-check?warehouseId=wh-a&productId=product-quantity-b',
        undefined,
        200,
      ],
    ];
    for (const [method, path, body, expectedStatus] of contracts) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-test-role': 'admin',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      assert.equal(
        response.status,
        expectedStatus,
        `${method} ${path}: ${await response.text()}`,
      );
    }
  } finally {
    await app.close();
  }
});

test('inventory query API: backend role matrix rejects every non-inventory role', async () => {
  const fixture = createFixture();
  for (const role of [
    'super_admin',
    'admin',
    'warehouse',
    'finance',
    'boss',
  ]) {
    const result = await fixture.service.listStocks(ACTORS[role]);
    assert.ok(Array.isArray(result.stocks), role);
    const warehouses = await fixture.service.listWarehouses(
      ACTORS[role],
    );
    assert.ok(Array.isArray(warehouses.warehouses), role);
    const movements = await fixture.service.listMovements(
      ACTORS[role],
    );
    assert.ok(Array.isArray(movements.movements), role);
    const alerts = await fixture.service.listAlertConfigs(
      ACTORS[role],
    );
    assert.ok(Array.isArray(alerts.alertConfigs), role);
    const inbounds = await fixture.service.listInboundDocuments(
      ACTORS[role],
    );
    assert.ok(Array.isArray(inbounds.inbounds), role);
    const transfers = await fixture.service.listTransfers(ACTORS[role]);
    assert.ok(Array.isArray(transfers.transfers), role);
    const configuration =
      await fixture.service.getConfiguration(ACTORS[role]);
    assert.equal(configuration.configured, true, role);
  }

  for (const role of [
    'sales',
    'after_sales',
    'taster',
    'front_desk',
  ]) {
    await assertCode(
      fixture.service.listWarehouses(ACTORS[role]),
      'PERMISSION_DENIED',
    );
    await assertCode(
      fixture.service.listStocks(ACTORS[role]),
      'PERMISSION_DENIED',
    );
    await assertCode(
      fixture.service.listMovements(ACTORS[role]),
      'PERMISSION_DENIED',
    );
    await assertCode(
      fixture.service.listAlertConfigs(ACTORS[role]),
      'PERMISSION_DENIED',
    );
    await assertCode(
      fixture.service.listInboundDocuments(ACTORS[role]),
      'PERMISSION_DENIED',
    );
    await assertCode(
      fixture.service.listTransfers(ACTORS[role]),
      'PERMISSION_DENIED',
    );
    await assertCode(
      fixture.service.getConfiguration(ACTORS[role]),
      'PERMISSION_DENIED',
    );
  }

  await assertCode(
    fixture.service.createWarehouse(ACTORS.finance, {
      code: 'WH-X',
      name: 'Finance must not create',
    }),
    'PERMISSION_DENIED',
  );
  await assertCode(
    fixture.service.updateAlertConfig(ACTORS.boss, {
      warehouseId: 'wh-a',
      productId: 'product-quantity-a',
      minimumAvailableQty: 3,
    }),
    'PERMISSION_DENIED',
  );
});

test('inventory query API: warehouse projections never read or return inventory costs', async () => {
  const fixture = createFixture();
  const list = await fixture.service.listStocks(ACTORS.warehouse);
  const detail = await fixture.service.getStock(
    ACTORS.warehouse,
    'wh-a',
    'product-quantity-b',
  );
  const movements = await fixture.service.listMovements(
    ACTORS.warehouse,
  );
  const inbounds = await fixture.service.listInboundDocuments(
    ACTORS.warehouse,
  );
  const inbound = await fixture.service.getInboundDocument(
    ACTORS.warehouse,
    'inbound-1',
  );
  const transfers = await fixture.service.listTransfers(
    ACTORS.warehouse,
  );
  const serialized = JSON.stringify({
    list,
    detail,
    movements,
    inbounds,
    inbound,
    transfers,
  });
  assertNoInventoryCost(serialized);
  assert.equal(
    fixture.repository.calls.some(
      (call) =>
        call.method === 'listBatchesForPairs' &&
        call.includeCosts === true,
    ),
    false,
  );
  assert.equal(
    fixture.repository.calls.some(
      (call) =>
        call.method === 'listInboundDocuments' &&
        call.includeCosts === true,
    ),
    false,
  );
  assert.equal(
    fixture.repository.calls.some(
      (call) =>
        call.method === 'listSerializedUnitsForPairs' &&
        call.includeCosts === true,
    ),
    false,
  );
  assert.equal(
    fixture.repository.calls.some(
      (call) =>
        call.method === 'listMovements' &&
        call.includeCosts === true,
    ),
    false,
  );
  assert.equal(
    fixture.repository.calls.some(
      (call) =>
        call.method === 'listTransfers' &&
        call.includeCosts === true,
    ),
    false,
  );
});

test('inventory query API: finance, boss and admins receive only inventory purchase cost fields', async () => {
  for (const role of [
    'super_admin',
    'admin',
    'finance',
    'boss',
  ]) {
    const fixture = createFixture();
    const list = await fixture.service.listStocks(ACTORS[role]);
    const stocked = list.stocks.find(
      (row) => row.productId === 'product-quantity-b',
    );
    assert.deepEqual(stocked.inventoryCost, {
      basis: 'batch',
      inventoryAmountCents: 1000,
      coveredQty: 10,
      uncoveredQty: 0,
      factQty: 10,
      coverageStatus: 'full',
    });
    const detail = await fixture.service.getStock(
      ACTORS[role],
      'wh-a',
      'product-quantity-b',
    );
    assert.equal(detail.batches[0].purchaseUnitCostCents, 100);
    assert.equal(detail.batches[0].inventoryAmountCents, 1000);
    const movement = (
      await fixture.service.listMovements(ACTORS[role])
    ).movements[0];
    assert.equal(movement.purchaseUnitCostCents, 100);
    assert.equal(movement.inventoryAmountCents, 200);
    const inbound = await fixture.service.getInboundDocument(
      ACTORS[role],
      'inbound-1',
    );
    assert.equal(
      inbound.lines[0].batch.purchaseUnitCostCents,
      100,
    );
    assert.equal(inbound.lines[0].inventoryAmountCents, 1000);
  }

  const bossPermissions = getRolePermissions('boss');
  assert.ok(bossPermissions.includes('inventory:purchase_costs:read'));
  assert.equal(
    bossPermissions.some((permission) =>
      /product.*actual.*cost|commission_rules|agency_deduction/.test(
        permission,
      ),
    ),
    false,
  );
});

test('inventory transfer query: server computes shortage/company totals and projects costs and serialized IDs by role', async () => {
  const warehouseFixture = createFixture();
  const filtered = await warehouseFixture.service.listTransfers(
    ACTORS.warehouse,
    {
      fromWarehouseId: 'wh-a',
      toWarehouseId: 'wh-b',
      productId: 'product-quantity-a',
      status: 'partially_received',
      page: 1,
      pageSize: 1,
    },
  );
  assert.equal(filtered.pagination.total, 1);
  assert.equal(filtered.transfers[0].id, 'transfer-1');
  const warehouseResult =
    await warehouseFixture.service.getTransfer(
      ACTORS.warehouse,
      'transfer-1',
    );
  const quantityLine = warehouseResult.lines.find(
    (line) => line.id === 'transfer-line-quantity',
  );
  const serializedLine = warehouseResult.lines.find(
    (line) => line.id === 'transfer-line-serialized',
  );
  assert.equal(quantityLine.remainingInTransitQty, 3);
  assert.equal(quantityLine.shortageWarning, true);
  assert.equal(quantityLine.sourceStock.shortageQty, 3);
  assert.equal(quantityLine.companyQuantity, -3);
  assert.deepEqual(serializedLine.serializedUnitIds, [
    'serialized-unit-secret',
  ]);
  assert.equal(serializedLine.serializedUnitCount, 1);
  assertNoInventoryCost(JSON.stringify(warehouseResult));

  for (const role of ['finance', 'boss']) {
    const fixture = createFixture();
    const transfer = await fixture.service.getTransfer(
      ACTORS[role],
      'transfer-1',
    );
    const roleSerialized = transfer.lines.find(
      (line) => line.id === 'transfer-line-serialized',
    );
    assert.equal(
      Object.hasOwn(roleSerialized, 'serializedUnitIds'),
      false,
      role,
    );
    assert.equal(roleSerialized.serializedUnitCount, 1, role);
    assert.equal(
      transfer.outboundDocument.lines[0].purchaseUnitCostCents,
      321,
      role,
    );
    assert.equal(
      transfer.receipts[0].resultDocument.lines[0]
        .purchaseUnitCostCents,
      321,
      role,
    );
  }

  const admin = await createFixture().service.getTransfer(
    ACTORS.admin,
    'transfer-1',
  );
  assert.deepEqual(
    admin.lines.find(
      (line) => line.id === 'transfer-line-serialized',
    ).serializedUnitIds,
    ['serialized-unit-secret'],
  );
});

test('inventory query API: trusted derived quantities, low-stock boundary, filters and pagination are stable', async () => {
  const fixture = createFixture();
  const shortage = await fixture.service.listStocks(
    ACTORS.warehouse,
    {
      hasShortage: true,
      page: 1,
      pageSize: 1,
    },
  );
  assert.equal(shortage.pagination.total, 1);
  assert.equal(shortage.stocks[0].onHandQty, -3);
  assert.equal(shortage.stocks[0].availableQty, -3);
  assert.equal(shortage.stocks[0].shortageQty, 3);

  const low = await fixture.service.listStocks(ACTORS.warehouse, {
    isLowStock: true,
    pageSize: 10,
  });
  assert.deepEqual(
    low.stocks.map((row) => row.productId).sort(),
    ['product-quantity-a', 'product-quantity-b'],
  );
  const boundary = low.stocks.find(
    (row) => row.productId === 'product-quantity-b',
  );
  assert.equal(boundary.availableQty, 6);
  assert.equal(boundary.lowStock.minimumAvailableQty, 6);
  assert.equal(boundary.lowStock.isLowStock, true);

  const unavailable = await fixture.service.listStocks(
    ACTORS.warehouse,
    {
      hasUnavailable: true,
      inventoryTrackingMode: 'quantity',
      warehouseId: 'wh-a',
      pageSize: 10,
    },
  );
  assert.deepEqual(
    unavailable.stocks.map((row) => row.productId),
    ['product-quantity-b'],
  );

  const page = await fixture.service.listStocks(ACTORS.warehouse, {
    page: 2,
    pageSize: 1,
  });
  assert.equal(page.pagination.total, 3);
  assert.equal(page.pagination.totalPages, 3);
  assert.equal(page.stocks.length, 1);
});

test('inventory query API: default changes are transactional and concurrent calls leave one active default', async () => {
  const fixture = createFixture();
  await Promise.all([
    fixture.service.updateWarehouse(
      ACTORS.admin,
      'wh-b',
      { isDefault: true },
    ),
    fixture.service.updateWarehouse(
      ACTORS.super_admin,
      'wh-c',
      { isDefault: true },
    ),
  ]);
  const activeDefaults = fixture.repository.state.warehouses.filter(
    (row) =>
      row.isActive &&
      row.isDefault &&
      row.activeDefaultKey === 'ACTIVE_DEFAULT',
  );
  assert.equal(activeDefaults.length, 1);
  assert.equal(fixture.logs.length, 2);
  assertNoInventoryCost(JSON.stringify(fixture.logs));
});

test('inventory query API: warehouse deactivation blocks active business without leaking quantities or costs', async () => {
  const fixture = createFixture();
  fixture.repository.state.blockers.set('wh-b', {
    hasStock: true,
    hasReservation: false,
    hasDraftDocument: false,
    hasUnfinishedTransfer: false,
  });
  const error = await captureError(
    fixture.service.updateWarehouse(
      ACTORS.admin,
      'wh-b',
      { isActive: false },
    ),
  );
  assert.equal(error.code, 'INVENTORY_WAREHOUSE_HAS_ACTIVE_BUSINESS');
  assert.equal(error.statusCode, 409);
  assertNoInventoryCost(JSON.stringify(error));
  assert.equal(JSON.stringify(error).includes('100'), false);

  await assertCode(
    fixture.service.updateWarehouse(
      ACTORS.admin,
      'wh-a',
      { isActive: false },
    ),
    'INVENTORY_DEFAULT_WAREHOUSE_CANNOT_DISABLE',
  );
  assert.equal(
    fixture.repository.state.warehouses.find(
      (row) => row.id === 'wh-b',
    ).isActive,
    true,
  );
});

test('inventory query API: alert configuration is admin-only, validated and logged with a safe whitelist', async () => {
  const fixture = createFixture();
  const updated = await fixture.service.updateAlertConfig(
    ACTORS.admin,
    {
      warehouseId: 'wh-a',
      productId: 'product-quantity-b',
      minimumAvailableQty: 7,
      enabled: false,
    },
  );
  assert.equal(updated.minimumAvailableQty, 7);
  assert.equal(updated.enabled, false);
  assert.equal(fixture.logs.length, 1);
  assert.deepEqual(fixture.todoCalls.pairs, [
    ['wh-a', 'product-quantity-b'],
  ]);
  assertNoInventoryCost(JSON.stringify(fixture.logs));

  await assertCode(
    fixture.service.updateAlertConfig(ACTORS.admin, {
      warehouseId: 'wh-a',
      productId: 'product-none',
      minimumAvailableQty: 1,
    }),
    'INVENTORY_TRACKING_DISABLED',
  );
  await assertCode(
    fixture.service.updateAlertConfig(ACTORS.admin, {
      warehouseId: 'wh-a',
      productId: 'product-quantity-b',
      minimumAvailableQty: -1,
    }),
    'INVENTORY_VALIDATION_FAILED',
  );
});

test('inventory query API: inventory activation configuration is admin-managed and role-safe', async () => {
  const fixture = createFixture();
  const current = await fixture.service.getConfiguration(
    ACTORS.warehouse,
  );
  assert.equal(current.configured, true);
  assert.equal(current.maintenanceMode, false);
  await assertCode(
    fixture.service.updateConfiguration(ACTORS.warehouse, {
      maintenanceMode: true,
    }),
    'PERMISSION_DENIED',
  );
  const updated = await fixture.service.updateConfiguration(
    ACTORS.admin,
    {
      goLiveAt: '2026-08-01T08:00:00.000Z',
      policyVersion: 2,
      maintenanceMode: true,
      transferOverdueHours: 36,
    },
  );
  assert.equal(updated.policyVersion, 2);
  assert.equal(updated.maintenanceMode, true);
  assert.equal(updated.transferOverdueHours, 36);
  assert.equal(fixture.todoCalls.all, 1);
  assert.equal(fixture.logs.at(-1).action, 'inventory.configuration.update');
  assertNoInventoryCost(JSON.stringify(fixture.logs.at(-1)));
});

test('inventory query API: rebuild-check is administrator-only', async () => {
  const accounting = new InventoryAccountingService(
    {},
    {},
    {},
    {},
  );
  for (const role of [
    'warehouse',
    'finance',
    'boss',
    'sales',
    'after_sales',
  ]) {
    await assertCode(
      accounting.rebuildCheck(ACTORS[role], {
        warehouseId: 'wh-a',
        productId: 'product-quantity-a',
      }),
      'PERMISSION_DENIED',
    );
  }
});

test('inventory query API: Prisma selects omit cost columns before warehouse rows are read', async () => {
  const captured = [];
  const prisma = {
    inventoryBatch: {
      findMany: async (args) => {
        captured.push({ model: 'batch', args });
        return [];
      },
    },
    serializedInventoryUnit: {
      findMany: async (args) => {
        captured.push({ model: 'unit', args });
        return [];
      },
    },
    inventoryMovement: {
      findMany: async (args) => {
        captured.push({ model: 'movement', args });
        return [];
      },
      count: async () => 0,
    },
    inventoryDocument: {
      findMany: async (args) => {
        captured.push({ model: 'document', args });
        return [];
      },
      findFirst: async (args) => {
        captured.push({ model: 'document-detail', args });
        return null;
      },
      count: async () => 0,
    },
    inventoryTransfer: {
      findMany: async (args) => {
        captured.push({ model: 'transfer', args });
        return [];
      },
      findUnique: async (args) => {
        captured.push({ model: 'transfer-detail', args });
        return null;
      },
      count: async () => 0,
    },
  };
  const repository = new InventoryQueryPrismaRepository(prisma);
  const pairs = [
    { warehouseId: 'wh-a', productId: 'product-quantity-b' },
  ];
  await repository.listBatchesForPairs(pairs, false);
  await repository.listSerializedUnitsForPairs(pairs, false);
  await repository.listMovements(
    {
      page: 1,
      pageSize: 20,
    },
    false,
  );
  await repository.listInboundDocuments(
    { page: 1, pageSize: 20 },
    false,
  );
  await repository.findInboundDocument('inbound-1', false);
  await repository.listTransfers(
    { page: 1, pageSize: 20 },
    false,
    false,
  );
  await repository.findTransfer('transfer-1', false, false);
  const serialized = JSON.stringify(captured);
  assert.equal(serialized.includes('purchaseUnitCostCents'), false);
  assert.equal(serialized.includes('purchaseCostCents'), false);
  assert.equal(serialized.includes('serializedUnitIds'), false);

  captured.length = 0;
  await repository.listBatchesForPairs(pairs, true);
  await repository.listSerializedUnitsForPairs(pairs, true);
  await repository.listMovements(
    {
      page: 1,
      pageSize: 20,
    },
    true,
  );
  await repository.listInboundDocuments(
    { page: 1, pageSize: 20 },
    true,
  );
  await repository.findInboundDocument('inbound-1', true);
  await repository.listTransfers(
    { page: 1, pageSize: 20 },
    true,
    true,
  );
  await repository.findTransfer('transfer-1', true, true);
  const costSerialized = JSON.stringify(captured);
  assert.equal(costSerialized.includes('purchaseUnitCostCents'), true);
  assert.equal(costSerialized.includes('purchaseCostCents'), true);
  assert.equal(costSerialized.includes('serializedUnitIds'), true);
});

test('inventory query API: batch filters resolve exact warehouse-product pairs before stock pagination', async () => {
  const captured = {};
  const prisma = {
    inventoryBatch: {
      findMany: async (args) => {
        captured.batch = args;
        return [
          {
            warehouseId: 'wh-a',
            productId: 'product-quantity-b',
          },
        ];
      },
    },
    warehouseProductStock: {
      findMany: async (args) => {
        captured.stock = args;
        return [];
      },
    },
  };
  const repository = new InventoryQueryPrismaRepository(prisma);
  await repository.listStockRows({
    warehouseId: null,
    productId: null,
    warehouseQuery: null,
    productQuery: null,
    inventoryTrackingMode: 'QUANTITY',
    batchId: null,
    batch: '000456',
  });
  assert.deepEqual(captured.batch.where.OR, [
    { productionBatch: { contains: '000456' } },
    { purchaseOrderNo: { contains: '000456' } },
  ]);
  assert.deepEqual(captured.stock.where.AND, [
    {
      OR: [
        {
          warehouseId: 'wh-a',
          productId: 'product-quantity-b',
        },
      ],
    },
  ]);
  assert.equal(
    captured.stock.where.product.inventoryTrackingMode,
    'QUANTITY',
  );
});

function createFixture() {
  const state = createState();
  const repository = new FakeInventoryQueryRepository(state);
  const logs = [];
  const todoCalls = { pairs: [], all: 0 };
  const service = new InventoryQueryService(
    repository,
    {
      appendLog: async (log) => {
        logs.push(structuredClone(log));
        return log;
      },
    },
    {
      safeReconcileInventoryPair: async (...args) => {
        todoCalls.pairs.push(args);
      },
      safeReconcileAllInventoryPairs: async () => {
        todoCalls.all += 1;
      },
    },
  );
  return { service, repository, logs, todoCalls };
}

class FakeInventoryQueryRepository {
  constructor(state) {
    this.state = state;
    this.calls = [];
    this.transactionTail = Promise.resolve();
  }

  async runInTransaction(work) {
    const previous = this.transactionTail;
    let release;
    this.transactionTail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work(this);
    } finally {
      release();
    }
  }

  async findInventoryConfiguration() {
    return structuredClone(this.state.configuration);
  }

  async upsertInventoryConfiguration(_transaction, create, update) {
    this.state.configuration = this.state.configuration
      ? { ...this.state.configuration, ...structuredClone(update) }
      : structuredClone(create);
    return structuredClone(this.state.configuration);
  }

  async listWarehouses(filters) {
    let rows = this.state.warehouses;
    if (filters.isActive !== null) {
      rows = rows.filter((row) => row.isActive === filters.isActive);
    }
    if (filters.isDefault !== null) {
      rows = rows.filter((row) => row.isDefault === filters.isDefault);
    }
    const total = rows.length;
    const start = (filters.page - 1) * filters.pageSize;
    return {
      rows: structuredClone(rows.slice(start, start + filters.pageSize)),
      total,
    };
  }

  async findWarehouseForMutation(_transaction, id) {
    return structuredClone(
      this.state.warehouses.find((row) => row.id === id) || null,
    );
  }

  async findWarehouseByNormalizedCode(_transaction, value) {
    const row = this.state.warehouses.find(
      (warehouse) => warehouse.normalizedCode === value,
    );
    return row ? { id: row.id } : null;
  }

  async findWarehouseByNormalizedName(_transaction, value) {
    const row = this.state.warehouses.find(
      (warehouse) => warehouse.normalizedName === value,
    );
    return row ? { id: row.id } : null;
  }

  async findManager() {
    return { id: 'manager-1', name: 'Manager', isActive: true };
  }

  async clearOtherDefaults(_transaction, warehouseId) {
    for (const row of this.state.warehouses) {
      if (row.id !== warehouseId) {
        row.isDefault = false;
        row.activeDefaultKey = null;
      }
    }
  }

  async createWarehouse(_transaction, data) {
    const row = warehouseRow(data);
    this.state.warehouses.push(row);
    return structuredClone(row);
  }

  async updateWarehouse(_transaction, id, data) {
    const row = this.state.warehouses.find(
      (warehouse) => warehouse.id === id,
    );
    Object.assign(row, data);
    row.manager = row.managerUserId
      ? { id: row.managerUserId, name: 'Manager' }
      : null;
    return structuredClone(row);
  }

  async warehouseBlockers(_transaction, id) {
    return (
      this.state.blockers.get(id) || {
        hasStock: false,
        hasReservation: false,
        hasDraftDocument: false,
        hasUnfinishedTransfer: false,
      }
    );
  }

  async listStockRows(filters) {
    return structuredClone(
      this.state.stocks.filter((row) => {
        if (
          filters.warehouseId &&
          row.warehouseId !== filters.warehouseId
        ) {
          return false;
        }
        if (
          filters.productId &&
          row.productId !== filters.productId
        ) {
          return false;
        }
        if (
          filters.inventoryTrackingMode &&
          row.product.inventoryTrackingMode !==
            filters.inventoryTrackingMode
        ) {
          return false;
        }
        return true;
      }),
    );
  }

  async listAlertConfigsForPairs(pairs) {
    const keys = new Set(
      pairs.map((row) => `${row.warehouseId}:${row.productId}`),
    );
    return structuredClone(
      this.state.alertConfigs.filter((row) =>
        keys.has(`${row.warehouseId}:${row.productId}`),
      ),
    );
  }

  async listBatchesForPairs(pairs, includeCosts) {
    this.calls.push({ method: 'listBatchesForPairs', includeCosts });
    const keys = new Set(
      pairs.map((row) => `${row.warehouseId}:${row.productId}`),
    );
    return this.state.batches
      .filter((row) =>
        keys.has(`${row.warehouseId}:${row.productId}`),
      )
      .map((row) =>
        includeCosts
          ? structuredClone(row)
          : omit(row, [
              'purchaseUnitCostCents',
              'costStatus',
              'costCompletedAt',
              'injectedProductActualCost',
            ]),
      );
  }

  async listSerializedUnitsForPairs(pairs, includeCosts) {
    this.calls.push({
      method: 'listSerializedUnitsForPairs',
      includeCosts,
    });
    const keys = new Set(
      pairs.map((row) => `${row.warehouseId}:${row.productId}`),
    );
    return this.state.serializedUnits
      .filter((row) =>
        keys.has(`${row.warehouseId}:${row.productId}`),
      )
      .map((row) =>
        includeCosts
          ? structuredClone(row)
          : omit(row, ['purchaseCostCents']),
      );
  }

  async findStockRow(warehouseId, productId) {
    return structuredClone(
      this.state.stocks.find(
        (row) =>
          row.warehouseId === warehouseId &&
          row.productId === productId,
      ) || null,
    );
  }

  async listMovements(_filters, includeCosts) {
    this.calls.push({ method: 'listMovements', includeCosts });
    return {
      rows: this.state.movements.map((row) =>
        includeCosts
          ? structuredClone(row)
          : omit(row, [
              'purchaseUnitCostCents',
              'injectedInventoryAmountCents',
            ]),
      ),
      total: this.state.movements.length,
    };
  }

  async listInboundDocuments(_filters, includeCosts) {
    this.calls.push({
      method: 'listInboundDocuments',
      includeCosts,
    });
    const rows = this.state.inbounds.map((row) =>
      includeCosts
        ? structuredClone(row)
        : projectInboundWithoutCosts(row),
    );
    return { rows, total: rows.length };
  }

  async findInboundDocument(id, includeCosts) {
    this.calls.push({
      method: 'findInboundDocument',
      includeCosts,
    });
    const row = this.state.inbounds.find((item) => item.id === id);
    if (!row) return null;
    return includeCosts
      ? structuredClone(row)
      : projectInboundWithoutCosts(row);
  }

  async listTransfers(filters, includeCosts, includeUnitIds) {
    this.calls.push({
      method: 'listTransfers',
      includeCosts,
      includeUnitIds,
    });
    let rows = this.state.transfers;
    if (filters.fromWarehouseId) {
      rows = rows.filter(
        (row) => row.fromWarehouseId === filters.fromWarehouseId,
      );
    }
    if (filters.toWarehouseId) {
      rows = rows.filter(
        (row) => row.toWarehouseId === filters.toWarehouseId,
      );
    }
    if (filters.productId) {
      rows = rows.filter((row) =>
        row.lines.some(
          (line) => line.productId === filters.productId,
        ),
      );
    }
    if (filters.status) {
      rows = rows.filter((row) => row.status === filters.status);
    }
    const total = rows.length;
    const start = (filters.page - 1) * filters.pageSize;
    return {
      rows: rows
        .slice(start, start + filters.pageSize)
        .map((row) =>
          projectTransfer(row, includeCosts, includeUnitIds),
        ),
      total,
    };
  }

  async findTransfer(id, includeCosts, includeUnitIds) {
    this.calls.push({
      method: 'findTransfer',
      includeCosts,
      includeUnitIds,
    });
    const row = this.state.transfers.find((item) => item.id === id);
    return row
      ? projectTransfer(row, includeCosts, includeUnitIds)
      : null;
  }

  async listStocksForTransferRows(rows) {
    const keys = new Set(
      rows.flatMap((transfer) =>
        transfer.lines.flatMap((line) => [
          `${transfer.fromWarehouseId}:${line.productId}`,
          `${transfer.toWarehouseId}:${line.productId}`,
        ]),
      ),
    );
    return structuredClone(
      this.state.stocks.filter((row) =>
        keys.has(`${row.warehouseId}:${row.productId}`),
      ),
    );
  }

  async companyStockTotals(productIds) {
    return productIds.map((productId) => {
      const rows = this.state.stocks.filter(
        (row) => row.productId === productId,
      );
      return {
        productId,
        _sum: {
          onHandQty: rows.reduce(
            (sum, row) => sum + row.onHandQty,
            0,
          ),
          inTransitQty: rows.reduce(
            (sum, row) => sum + row.inTransitQty,
            0,
          ),
        },
      };
    });
  }

  async listAlertConfigs(filters) {
    let rows = this.state.alertConfigs;
    if (filters.warehouseId) {
      rows = rows.filter(
        (row) => row.warehouseId === filters.warehouseId,
      );
    }
    if (filters.productId) {
      rows = rows.filter(
        (row) => row.productId === filters.productId,
      );
    }
    return {
      rows: structuredClone(rows),
      total: rows.length,
    };
  }

  async findProductForAlert(_transaction, id) {
    return structuredClone(this.state.products.get(id) || null);
  }

  async findAlertConfig(_transaction, warehouseId, productId) {
    return structuredClone(
      this.state.alertConfigs.find(
        (row) =>
          row.warehouseId === warehouseId &&
          row.productId === productId,
      ) || null,
    );
  }

  async upsertAlertConfig(
    _transaction,
    warehouseId,
    productId,
    create,
    update,
  ) {
    let row = this.state.alertConfigs.find(
      (item) =>
        item.warehouseId === warehouseId &&
        item.productId === productId,
    );
    if (row) {
      Object.assign(row, update);
    } else {
      row = {
        ...create,
        warehouse: warehousePublic(
          this.state.warehouses.find(
            (item) => item.id === warehouseId,
          ),
        ),
        product: productPublic(this.state.products.get(productId)),
      };
      this.state.alertConfigs.push(row);
    }
    return structuredClone(row);
  }
}

function createState() {
  const warehouses = [
    warehouseRow({
      id: 'wh-a',
      code: 'WH-A',
      normalizedCode: 'wh-a',
      name: 'Warehouse A',
      normalizedName: 'warehouse a',
      isActive: true,
      isDefault: true,
      activeDefaultKey: 'ACTIVE_DEFAULT',
    }),
    warehouseRow({
      id: 'wh-b',
      code: 'WH-B',
      normalizedCode: 'wh-b',
      name: 'Warehouse B',
      normalizedName: 'warehouse b',
      isActive: true,
      isDefault: false,
      activeDefaultKey: null,
    }),
    warehouseRow({
      id: 'wh-c',
      code: 'WH-C',
      normalizedCode: 'wh-c',
      name: 'Warehouse C',
      normalizedName: 'warehouse c',
      isActive: true,
      isDefault: false,
      activeDefaultKey: null,
    }),
  ];
  const products = new Map([
    [
      'product-quantity-a',
      productRow('product-quantity-a', 'Quantity A', 'QUANTITY'),
    ],
    [
      'product-quantity-b',
      productRow('product-quantity-b', 'Quantity B', 'QUANTITY'),
    ],
    [
      'product-serialized',
      productRow('product-serialized', 'Serialized', 'SERIALIZED'),
    ],
    [
      'product-none',
      productRow('product-none', 'None', 'NONE'),
    ],
  ]);
  const stocks = [
    stockRow(
      warehouses[0],
      products.get('product-quantity-a'),
      {
        id: 'stock-a',
        onHandQty: -3,
      },
    ),
    stockRow(
      warehouses[0],
      products.get('product-quantity-b'),
      {
        id: 'stock-b',
        onHandQty: 10,
        reservedQty: 2,
        unavailableQty: 2,
      },
    ),
    stockRow(
      warehouses[1],
      products.get('product-serialized'),
      {
        id: 'stock-c',
        onHandQty: 1,
      },
    ),
  ];
  const alertConfigs = [
    alertRow(
      warehouses[0],
      products.get('product-quantity-a'),
      0,
    ),
    alertRow(
      warehouses[0],
      products.get('product-quantity-b'),
      6,
    ),
  ];
  return {
    configuration: {
      id: 'inventory-config',
      singletonKey: 'INVENTORY',
      goLiveAt: new Date('2026-08-01T00:00:00Z'),
      policyVersion: 1,
      maintenanceMode: false,
      createdAt: new Date('2026-07-01T00:00:00Z'),
      updatedAt: new Date('2026-07-01T00:00:00Z'),
    },
    warehouses,
    products,
    stocks,
    alertConfigs,
    batches: [
      {
        id: 'batch-b',
        warehouseId: 'wh-a',
        productId: 'product-quantity-b',
        supplierName: 'Supplier',
        purchaseOrderNo: '000123',
        productionBatch: '000456',
        productionDate: new Date('2026-07-01T00:00:00Z'),
        receivedQty: 10,
        remainingQty: 10,
        unavailableQty: 2,
        purchaseUnitCostCents: 100,
        costStatus: 'COMPLETE',
        costCompletedAt: new Date('2026-07-02T00:00:00Z'),
        fifoAt: new Date('2026-07-01T00:00:00Z'),
        createdAt: new Date('2026-07-01T00:00:00Z'),
        updatedAt: new Date('2026-07-02T00:00:00Z'),
        injectedProductActualCost: 999999,
      },
    ],
    serializedUnits: [
      {
        warehouseId: 'wh-b',
        productId: 'product-serialized',
        status: 'AVAILABLE',
        purchaseCostCents: 80000,
      },
    ],
    movements: [
      {
        id: 'movement-1',
        sourceKey: 'movement:1',
        warehouseId: 'wh-a',
        productId: 'product-quantity-b',
        batchId: 'batch-b',
        serializedUnitId: null,
        reservationId: null,
        movementType: 'SALES_OUT',
        onHandDelta: -2,
        reservedDelta: 0,
        unavailableDelta: 0,
        inTransitDelta: 0,
        businessAt: new Date('2026-07-03T00:00:00Z'),
        operatorUserId: 'admin-1',
        operatorNameSnapshot: 'Admin',
        operatorRoleSnapshot: 'admin',
        productNameSnapshot: 'Quantity B',
        unitSnapshot: '瓶',
        reason: null,
        reversalOfMovementId: null,
        purchaseUnitCostCents: 100,
        injectedInventoryAmountCents: 999999,
        warehouse: warehousePublic(warehouses[0]),
        product: productPublic(
          products.get('product-quantity-b'),
        ),
        batch: {
          id: 'batch-b',
          purchaseOrderNo: '000123',
          productionBatch: '000456',
          productionDate: new Date('2026-07-01T00:00:00Z'),
        },
        createdAt: new Date('2026-07-03T00:00:00Z'),
      },
    ],
    inbounds: [
      {
        id: 'inbound-1',
        documentNo: 'INV-0001',
        type: 'PURCHASE_RECEIPT',
        status: 'POSTED',
        warehouseId: 'wh-a',
        sourceType: 'inbound',
        sourceId: null,
        sourceKey: 'purchase:000123:line:0001',
        businessAt: new Date('2026-07-01T00:00:00Z'),
        postedById: 'warehouse-1',
        postedByNameSnapshot: 'Warehouse',
        postedByRoleSnapshot: 'warehouse',
        postedAt: new Date('2026-07-01T00:00:00Z'),
        reversedAt: null,
        reversalOfDocumentId: null,
        reason: null,
        attachmentMetadata: [
          {
            fileName: 'receipt.pdf',
            contentType: 'application/pdf',
            sizeBytes: 123,
            checksumSha256: 'a'.repeat(64),
            injectedDownloadToken: 'must-not-leak',
          },
        ],
        warehouse: warehousePublic(warehouses[0]),
        lines: [
          {
            id: 'inbound-line-1',
            lineNo: 1,
            productId: 'product-quantity-b',
            batchId: 'batch-b',
            quantity: 10,
            condition: 'SALEABLE',
            productNameSnapshot: 'Quantity B',
            unitSnapshot: 'bottle',
            notes: 'Purchase receipt',
            purchaseUnitCostCents: 100,
            createdAt: new Date('2026-07-01T00:00:00Z'),
            batch: {
              id: 'batch-b',
              supplierName: 'Supplier',
              purchaseOrderNo: '000123',
              productionBatch: '000456',
              productionDate: new Date('2026-07-01T00:00:00Z'),
              receivedQty: 10,
              remainingQty: 10,
              unavailableQty: 0,
              purchaseUnitCostCents: 100,
              costStatus: 'COMPLETE',
              costCompletedAt: new Date(
                '2026-07-02T00:00:00Z',
              ),
              fifoAt: new Date('2026-07-01T00:00:00Z'),
              createdAt: new Date('2026-07-01T00:00:00Z'),
              updatedAt: new Date('2026-07-02T00:00:00Z'),
              injectedProductActualCost: 999999,
            },
          },
        ],
        createdAt: new Date('2026-07-01T00:00:00Z'),
        updatedAt: new Date('2026-07-01T00:00:00Z'),
      },
    ],
    transfers: [
      {
        id: 'transfer-1',
        transferNo: 'TRF-0001',
        sourceKey: 'transfer:0001',
        fromWarehouseId: 'wh-a',
        toWarehouseId: 'wh-b',
        status: 'PARTIALLY_RECEIVED',
        outboundDocumentId: 'transfer-out-document-1',
        outboundAt: new Date('2026-07-04T00:00:00Z'),
        outboundById: 'warehouse-1',
        outboundByName: 'Warehouse',
        outboundByRole: 'warehouse',
        notes: 'Read model transfer',
        version: 2,
        fromWarehouse: warehousePublic(warehouses[0]),
        toWarehouse: warehousePublic(warehouses[1]),
        lines: [
          {
            id: 'transfer-line-quantity',
            lineNo: 1,
            sourceLineKey: 'transfer:0001:line:1',
            productId: 'product-quantity-a',
            trackingModeSnapshot: 'QUANTITY',
            plannedQty: 5,
            outboundQty: 5,
            receivedQty: 2,
            unavailableQty: 1,
            differenceQty: 0,
            serializedUnitIds: null,
            notes: null,
            version: 2,
            product: productPublic(
              products.get('product-quantity-a'),
            ),
          },
          {
            id: 'transfer-line-serialized',
            lineNo: 2,
            sourceLineKey: 'transfer:0001:line:2',
            productId: 'product-serialized',
            trackingModeSnapshot: 'SERIALIZED',
            plannedQty: 1,
            outboundQty: 0,
            receivedQty: 0,
            unavailableQty: 0,
            differenceQty: 0,
            serializedUnitIds: ['serialized-unit-secret'],
            notes: null,
            version: 0,
            product: productPublic(
              products.get('product-serialized'),
            ),
          },
        ],
        outboundDocument: transferDocument(
          'transfer-out-document-1',
          'TRANSFER_OUT',
          321,
        ),
        receipts: [
          {
            id: 'transfer-receipt-1',
            receiptNo: 'TRR-0001',
            sourceKey: 'transfer:0001:receipt:1',
            status: 'POSTED',
            resultDocumentId: 'transfer-in-document-1',
            confirmedById: 'warehouse-1',
            confirmedByNameSnapshot: 'Warehouse',
            confirmedByRoleSnapshot: 'warehouse',
            confirmedAt: new Date('2026-07-05T00:00:00Z'),
            reversalOfReceiptId: null,
            notes: 'Partial receipt',
            version: 0,
            createdAt: new Date('2026-07-05T00:00:00Z'),
            lines: [
              {
                id: 'transfer-receipt-line-1',
                transferLineId: 'transfer-line-quantity',
                lineNo: 1,
                receivedQty: 2,
                unavailableQty: 1,
                differenceQty: 0,
                notes: 'One damaged bottle',
              },
            ],
            resultDocument: transferDocument(
              'transfer-in-document-1',
              'TRANSFER_IN',
              321,
            ),
          },
        ],
        createdAt: new Date('2026-07-04T00:00:00Z'),
        updatedAt: new Date('2026-07-05T00:00:00Z'),
      },
    ],
    blockers: new Map(),
  };
}

function warehouseRow(overrides) {
  const now = new Date('2026-07-01T00:00:00Z');
  return {
    id: overrides.id,
    code: overrides.code,
    normalizedCode: overrides.normalizedCode,
    name: overrides.name,
    normalizedName: overrides.normalizedName,
    address: overrides.address || null,
    managerUserId: overrides.managerUserId || null,
    manager: null,
    isActive: overrides.isActive ?? true,
    isDefault: overrides.isDefault ?? false,
    activeDefaultKey: overrides.activeDefaultKey ?? null,
    createdById: null,
    updatedById: null,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
  };
}

function productRow(id, name, inventoryTrackingMode) {
  return {
    id,
    name,
    unit: '瓶',
    isActive: true,
    inventoryTrackingMode,
  };
}

function stockRow(warehouse, product, overrides) {
  return {
    id: overrides.id,
    warehouseId: warehouse.id,
    productId: product.id,
    onHandQty: overrides.onHandQty || 0,
    reservedQty: overrides.reservedQty || 0,
    unavailableQty: overrides.unavailableQty || 0,
    inTransitQty: overrides.inTransitQty || 0,
    version: 1,
    lastMovementId: null,
    rebuiltAt: null,
    updatedAt: new Date('2026-07-03T00:00:00Z'),
    warehouse: warehousePublic(warehouse),
    product: productPublic(product),
    purchaseUnitCostCents: 999999,
    inventoryAmountCents: 999999,
    ProductActualCost: { costCents: 999999 },
  };
}

function alertRow(warehouse, product, minimumAvailableQty) {
  return {
    id: `alert:${warehouse.id}:${product.id}`,
    warehouseId: warehouse.id,
    productId: product.id,
    minimumAvailableQty,
    enabled: true,
    warehouse: warehousePublic(warehouse),
    product: productPublic(product),
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
  };
}

function warehousePublic(warehouse) {
  return {
    id: warehouse.id,
    code: warehouse.code,
    name: warehouse.name,
    isActive: warehouse.isActive,
    isDefault: warehouse.isDefault,
  };
}

function productPublic(product) {
  return {
    id: product.id,
    name: product.name,
    unit: product.unit,
    isActive: product.isActive,
    inventoryTrackingMode: product.inventoryTrackingMode,
  };
}

function transferDocument(id, type, purchaseUnitCostCents) {
  return {
    id,
    documentNo: `INV-${id}`,
    type,
    status: 'POSTED',
    businessAt: new Date('2026-07-04T00:00:00Z'),
    lines: [
      {
        id: `${id}:line:1`,
        lineNo: 1,
        productId: 'product-quantity-a',
        quantity: 2,
        purchaseUnitCostCents,
        movements: [
          {
            id: `${id}:movement:1`,
            movementType: type,
            onHandDelta: type === 'TRANSFER_OUT' ? -2 : 2,
            unavailableDelta: type === 'TRANSFER_IN' ? 1 : 0,
            inTransitDelta: type === 'TRANSFER_OUT' ? 2 : -2,
            purchaseUnitCostCents,
          },
        ],
      },
    ],
  };
}

function actor(role) {
  return {
    id: `${role}-1`,
    name: role,
    username: role,
    role,
  };
}

function omit(value, fields) {
  const clone = structuredClone(value);
  for (const field of fields) {
    delete clone[field];
  }
  return clone;
}

function projectInboundWithoutCosts(value) {
  const clone = structuredClone(value);
  for (const line of clone.lines || []) {
    delete line.purchaseUnitCostCents;
    if (line.batch) {
      delete line.batch.purchaseUnitCostCents;
      delete line.batch.costStatus;
      delete line.batch.costCompletedAt;
      delete line.batch.injectedProductActualCost;
    }
  }
  return clone;
}

function projectTransfer(value, includeCosts, includeUnitIds) {
  const clone = structuredClone(value);
  if (!includeUnitIds) {
    for (const line of clone.lines || []) {
      delete line.serializedUnitIds;
    }
  }
  if (!includeCosts) {
    for (const document of [
      clone.outboundDocument,
      ...(clone.receipts || []).map(
        (receipt) => receipt.resultDocument,
      ),
    ]) {
      for (const line of document?.lines || []) {
        delete line.purchaseUnitCostCents;
        for (const movement of line.movements || []) {
          delete movement.purchaseUnitCostCents;
        }
      }
    }
  }
  return clone;
}

function assertNoInventoryCost(serialized) {
  for (const token of [
    'purchaseUnitCost',
    'purchaseCost',
    'inventoryAmount',
    'costStatus',
    'costCompleted',
    'coveredQty',
    'uncoveredQty',
    'coverageStatus',
    'ProductActualCost',
    '999999',
  ]) {
    assert.equal(
      serialized.includes(token),
      false,
      `warehouse projection leaked ${token}`,
    );
  }
}

async function assertCode(promise, code) {
  const error = await captureError(promise);
  assert.equal(error.code, code);
}

async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('Expected the promise to reject.');
}
