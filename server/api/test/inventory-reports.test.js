const assert = require('node:assert/strict');
const test = require('node:test');
const ExcelJS = require('exceljs');

const {
  InventoryReportService,
} = require('../src/modules/inventory/inventory-report.service');

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

test('inventory reports expose all ten movement-backed report contracts with Shanghai date boundaries', async () => {
  const fixture = createFixture();
  const service = fixture.service;
  const period = await service.query(
    ACTORS.warehouse,
    'period-summary',
    {
      dateFrom: '2026-07-01',
      dateTo: '2026-07-02',
      productId: 'product-q',
      pageSize: 100,
    },
  );
  const warehouseA = period.rows.find(
    (row) =>
      row.scope === 'warehouse' && row.warehouseCode === 'WH-A',
  );
  assert.equal(warehouseA.openingOnHandQty, 10);
  assert.equal(warehouseA.inboundQty, 5);
  assert.equal(warehouseA.outboundQty, 22);
  assert.equal(warehouseA.transferIntoTransitQty, 4);
  assert.equal(warehouseA.transferOutOfTransitQty, 2);
  assert.equal(warehouseA.closingOnHandQty, -7);
  assert.equal(warehouseA.closingInTransitQty, 2);
  assert.equal(warehouseA.companyTotalQty, -3);
  assert.match(warehouseA.warning, /期末账面库存为负/);

  const reportInputs = new Map([
    ['warehouse-balances', {}],
    [
      'period-summary',
      { dateFrom: '2026-07-01', dateTo: '2026-07-02' },
    ],
    ['movements', {}],
    ['sales-outbound', {}],
    ['purchase-inbound', {}],
    ['batch-balances', {}],
    ['alerts', {}],
    ['stocktake-variances', {}],
    ['transfers', {}],
    ['inventory-valuation', {}],
  ]);
  for (const [reportType, input] of reportInputs) {
    const result = await service.query(
      reportType === 'inventory-valuation'
        ? ACTORS.finance
        : ACTORS.warehouse,
      reportType,
      { ...input, pageSize: 100 },
    );
    assert.equal(result.reportType, reportType);
    assert.equal(result.factSource, 'inventory_movements');
    assert.ok(Array.isArray(result.columns));
    assert.ok(Array.isArray(result.rows));
    for (const row of result.rows) {
      assert.deepEqual(
        Object.keys(row),
        result.columns.map((column) => column.key),
      );
    }
  }
});

test('inventory report cost coverage is explicit for full, partial, zero and negative stock without ProductActualCost fallback', async () => {
  const { service } = createFixture();
  const valuation = await service.query(
    ACTORS.finance,
    'inventory-valuation',
    { pageSize: 100 },
  );
  const full = valuation.rows.find(
    (row) => row.productName === '全覆盖商品',
  );
  const partial = valuation.rows.find(
    (row) => row.productName === '逐瓶商品',
  );
  const zero = valuation.rows.find(
    (row) => row.productName === '零覆盖商品',
  );
  const negative = valuation.rows.find(
    (row) => row.productName === '负库存商品',
  );
  assert.equal(full.coverageStatus, 'full');
  assert.equal(full.coveredQty, 3);
  assert.equal(full.uncoveredQty, 0);
  assert.equal(full.inventoryAmountCents, 1500);
  assert.equal(partial.coverageStatus, 'partial');
  assert.equal(partial.coveredQty, 1);
  assert.equal(partial.uncoveredQty, 1);
  assert.equal(partial.inventoryAmountCents, 1000);
  assert.equal(zero.coverageStatus, 'none');
  assert.equal(zero.coveredQty, 0);
  assert.equal(zero.uncoveredQty, 4);
  assert.equal(zero.inventoryAmountCents, null);
  assert.match(zero.warning, /未伪造金额/);
  assert.equal(negative.coverageStatus, 'none');
  assert.equal(negative.coveredQty, 0);
  assert.equal(negative.uncoveredQty, 2);
  assert.match(negative.warning, /未使用 ProductActualCost/);

  const sales = await service.query(
    ACTORS.finance,
    'sales-outbound',
    { productId: 'product-q', pageSize: 100 },
  );
  const outbound = sales.rows.find(
    (row) => row.warehouseCode === 'WH-A',
  );
  assert.equal(outbound.quantity, 18);
  assert.equal(outbound.coverageStatus, 'partial');
  assert.equal(outbound.coveredQty, 8);
  assert.equal(outbound.uncoveredQty, 10);
  assert.equal(outbound.inventoryAmountCents, 800);
  assert.match(outbound.warning, /未伪造金额/);

  const purchases = await service.query(
    ACTORS.finance,
    'purchase-inbound',
    { productId: 'product-q', pageSize: 100 },
  );
  const purchased = purchases.rows.find(
    (row) => row.warehouseCode === 'WH-A',
  );
  assert.equal(purchased.quantity, 104);
  assert.equal(purchased.coveredQty, 5);
  assert.equal(purchased.uncoveredQty, 99);
  assert.equal(purchased.inventoryAmountCents, 500);

  const batches = await service.query(
    ACTORS.finance,
    'batch-balances',
    { productId: 'product-q', pageSize: 100 },
  );
  const leadingZeroBatch = batches.rows.find(
    (row) => row.purchaseOrderNo === '000123',
  );
  assert.equal(leadingZeroBatch.productionBatch, '000045');
});

test('warehouse API and Excel use the same quantity-only field set and reject valuation; finance keeps inventory-only costs', async () => {
  const fixture = createFixture();
  const warehouse = await fixture.service.query(
    ACTORS.warehouse,
    'batch-balances',
    { pageSize: 100 },
  );
  const warehouseKeys = warehouse.columns.map((column) => column.key);
  for (const forbidden of [
    'purchaseUnitCostCents',
    'inventoryAmountCents',
    'coverageStatus',
    'coveredQty',
    'uncoveredQty',
  ]) {
    assert.equal(warehouseKeys.includes(forbidden), false);
  }
  await assert.rejects(
    fixture.service.query(
      ACTORS.warehouse,
      'inventory-valuation',
      {},
    ),
    (error) =>
      error?.statusCode === 403 &&
      error?.code === 'INVENTORY_COST_REPORT_FORBIDDEN',
  );

  const finance = await fixture.service.query(
    ACTORS.finance,
    'batch-balances',
    { pageSize: 100 },
  );
  assert.ok(
    finance.columns.some(
      (column) => column.key === 'purchaseUnitCostCents',
    ),
  );
  assert.ok(
    finance.columns.some(
      (column) => column.key === 'inventoryAmountCents',
    ),
  );
  for (const role of ['super_admin', 'admin', 'finance', 'boss']) {
    const costReport = await fixture.service.query(
      ACTORS[role],
      'inventory-valuation',
      {},
    );
    assert.ok(
      costReport.columns.some(
        (column) => column.key === 'inventoryAmountCents',
      ),
      role,
    );
  }
  for (const role of [
    'sales',
    'after_sales',
    'taster',
    'front_desk',
  ]) {
    await assert.rejects(
      fixture.service.query(
        ACTORS[role],
        'warehouse-balances',
        {},
      ),
      (error) =>
        error?.statusCode === 403 &&
        error?.code === 'PERMISSION_DENIED',
      role,
    );
  }
  await assert.rejects(
    fixture.service.query(ACTORS.warehouse, 'warehouse-balances', {
      purchaseUnitCostCents: 'BOTTLE-SECRET',
    }),
    (error) =>
      error?.statusCode === 400 &&
      error?.code === 'VALIDATION_ERROR' &&
      !error.message.includes('BOTTLE-SECRET'),
  );

  const exported = await fixture.service.exportXlsx(
    ACTORS.warehouse,
    'batch-balances',
    {},
    { requestId: 'report-request' },
  );
  const bytes = await consumeStream(exported.stream);
  await exported.completion;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheet = workbook.getWorksheet('库存报表');
  const headers = sheet.getRow(1).values.slice(1);
  assert.deepEqual(
    headers,
    warehouse.columns.map((column) => column.label),
  );
  const warehouseCells = worksheetValues(sheet);
  assert.doesNotMatch(
    JSON.stringify(warehouseCells),
    /BOTTLE-SECRET|99999999/,
  );
  assert.equal(fixture.logs.length, 1);
  assert.deepEqual(fixture.logs[0].afterData.columnKeys, warehouseKeys);
  assert.equal(
    JSON.stringify(fixture.logs[0]).includes('BOTTLE-SECRET'),
    false,
  );
  assert.equal(
    JSON.stringify(fixture.logs[0]).includes('99999999'),
    false,
  );

  const financeExport = await fixture.service.exportXlsx(
    ACTORS.finance,
    'batch-balances',
    {},
  );
  const financeBytes = await consumeStream(financeExport.stream);
  await financeExport.completion;
  const financeWorkbook = new ExcelJS.Workbook();
  await financeWorkbook.xlsx.load(financeBytes);
  const financeSheet = financeWorkbook.getWorksheet('库存报表');
  assert.deepEqual(
    financeSheet.getRow(1).values.slice(1),
    finance.columns.map((column) => column.label),
  );
  assert.doesNotMatch(
    JSON.stringify(worksheetValues(financeSheet)),
    /BOTTLE-SECRET|99999999/,
  );
});

test('transfer report rebuilds partial receipt facts and preserves company onHand plus transit total', async () => {
  const { service } = createFixture();
  const report = await service.query(
    ACTORS.warehouse,
    'transfers',
    { pageSize: 100 },
  );
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].outboundQty, 4);
  assert.equal(report.rows[0].receivedQty, 2);
  assert.equal(report.rows[0].remainingInTransitQty, 2);
  assert.equal(report.rows[0].companyTotalQty, 96);
  assert.match(report.rows[0].warning, /仍有 2 瓶调拨在途/);
});

test('movement aggregation and Excel export process large inputs in bounded pages', async () => {
  const fixture = createFixture({ extraMovementCount: 1205 });
  const balances = await fixture.service.query(
    ACTORS.warehouse,
    'warehouse-balances',
    { productId: 'bulk-product', pageSize: 100 },
  );
  assert.ok(balances.rows.length > 0);
  assert.ok(fixture.factPageSizes.every((size) => size <= 500));
  assert.ok(fixture.factCursors.length >= 3);

  fixture.movementPageSizes.length = 0;
  const exported = await fixture.service.exportXlsx(
    ACTORS.warehouse,
    'movements',
    { productId: 'bulk-product' },
  );
  const bytes = await consumeStream(exported.stream);
  await exported.completion;
  assert.ok(bytes.length > 1000);
  assert.deepEqual(fixture.movementPageSizes, [500, 500, 500]);
});

function createFixture(options = {}) {
  const warehouses = {
    a: { id: 'wh-a', code: 'WH-A', name: '一号仓' },
    b: { id: 'wh-b', code: 'WH-B', name: '二号仓' },
  };
  const products = {
    q: {
      id: 'product-q',
      name: '普通商品',
      unit: '瓶',
      inventoryTrackingMode: 'QUANTITY',
    },
    s: {
      id: 'product-s',
      name: '逐瓶商品',
      unit: '瓶',
      inventoryTrackingMode: 'SERIALIZED',
    },
    full: {
      id: 'product-full',
      name: '全覆盖商品',
      unit: '瓶',
      inventoryTrackingMode: 'QUANTITY',
    },
    bulk: {
      id: 'bulk-product',
      name: '批量商品',
      unit: '瓶',
      inventoryTrackingMode: 'QUANTITY',
    },
    zero: {
      id: 'zero-product',
      name: '零覆盖商品',
      unit: '瓶',
      inventoryTrackingMode: 'QUANTITY',
    },
    negative: {
      id: 'negative-product',
      name: '负库存商品',
      unit: '瓶',
      inventoryTrackingMode: 'QUANTITY',
    },
  };
  const batches = [
    batch('batch-q-1', warehouses.a, products.q, 5, 100, 'COMPLETE'),
    batch('batch-q-2', warehouses.a, products.q, 99, null, 'PENDING'),
    batch(
      'batch-full',
      warehouses.a,
      products.full,
      3,
      500,
      'COMPLETE',
    ),
  ];
  batches[0].purchaseOrderNo = '000123';
  batches[0].productionBatch = '000045';
  batches[0].logisticsCode = 'BOTTLE-SECRET';
  batches[0].hiddenCost = 99999999;

  const movements = [
    movement('m001', warehouses.a, products.q, {
      businessAt: '2026-06-30T15:59:59.000Z',
      type: 'OPENING_IN',
      onHand: 10,
    }),
    movement('m002', warehouses.a, products.q, {
      businessAt: '2026-06-30T16:00:00.000Z',
      type: 'PURCHASE_IN',
      onHand: 5,
      batch: batches[0],
      cost: 100,
    }),
    movement('m003', warehouses.a, products.q, {
      businessAt: '2026-07-01T05:00:00.000Z',
      type: 'SALES_OUT',
      onHand: -8,
      batch: batches[0],
      cost: 100,
    }),
    movement('m004', warehouses.a, products.q, {
      businessAt: '2026-07-01T06:00:00.000Z',
      type: 'TRANSFER_OUT',
      onHand: -4,
      transit: 4,
      batch: batches[0],
      cost: 100,
    }),
    movement('m005', warehouses.a, products.q, {
      businessAt: '2026-07-01T07:00:00.000Z',
      type: 'SALES_OUT',
      onHand: -10,
    }),
    movement('m006', warehouses.a, products.q, {
      businessAt: '2026-07-02T15:59:59.000Z',
      type: 'TRANSFER_IN',
      transit: -2,
      batch: batches[0],
      cost: 100,
    }),
    movement('m007', warehouses.b, products.q, {
      businessAt: '2026-07-02T15:59:59.000Z',
      type: 'TRANSFER_IN',
      onHand: 2,
      batch: batches[0],
      cost: 100,
    }),
    movement('m008', warehouses.a, products.q, {
      businessAt: '2026-07-02T16:00:00.000Z',
      type: 'PURCHASE_IN',
      onHand: 99,
      batch: batches[1],
    }),
    movement('m009', warehouses.a, products.q, {
      businessAt: '2026-07-03T00:00:00.000Z',
      type: 'PURCHASE_IN',
      onHand: 2,
      batch: batches[0],
      cost: 100,
    }),
    movement('m010', warehouses.a, products.q, {
      businessAt: '2026-07-03T01:00:00.000Z',
      type: 'REVERSAL',
      onHand: -2,
      batch: batches[0],
      cost: 100,
      reversalOfType: 'PURCHASE_IN',
    }),
    movement('m011', warehouses.a, products.s, {
      businessAt: '2026-07-01T00:00:00.000Z',
      type: 'OPENING_IN',
      onHand: 1,
      unitId: 'unit-costed',
      unitCost: 1000,
    }),
    movement('m012', warehouses.a, products.s, {
      businessAt: '2026-07-01T00:01:00.000Z',
      type: 'OPENING_IN',
      onHand: 1,
      unitId: 'unit-pending',
      unitCost: null,
    }),
    movement('m013', warehouses.a, products.full, {
      businessAt: '2026-07-01T00:02:00.000Z',
      type: 'OPENING_IN',
      onHand: 3,
      batch: batches[2],
      cost: 500,
    }),
    movement('m014', warehouses.a, products.zero, {
      businessAt: '2026-07-01T00:03:00.000Z',
      type: 'OPENING_IN',
      onHand: 4,
    }),
    movement('m015', warehouses.a, products.negative, {
      businessAt: '2026-07-01T00:04:00.000Z',
      type: 'SALES_OUT',
      onHand: -2,
    }),
  ];
  for (let index = 0; index < (options.extraMovementCount || 0); index += 1) {
    movements.push(
      movement(
        `z${String(index).padStart(5, '0')}`,
        warehouses.a,
        products.bulk,
        {
          businessAt: new Date(
            Date.UTC(2026, 6, 1, 0, 0, index % 60),
          ).toISOString(),
          type: 'OTHER_IN',
          onHand: 1,
        },
      ),
    );
  }
  const stocks = [
    stock(warehouses.a, products.q, 91, 0, 0, 2),
    stock(warehouses.b, products.q, 2, 0, 0, 0),
    stock(warehouses.a, products.s, 2, 0, 0, 0),
    stock(warehouses.a, products.full, 3, 0, 0, 0),
    stock(warehouses.a, products.zero, 4, 0, 0, 0),
    stock(warehouses.a, products.negative, -2, 0, 0, 0),
    ...(options.extraMovementCount
      ? [
          stock(
            warehouses.a,
            products.bulk,
            options.extraMovementCount,
            0,
            0,
            0,
          ),
        ]
      : []),
  ];
  const alerts = [
    {
      id: 'alert-1',
      type: 'NEGATIVE_AVAILABLE',
      status: 'ACTIVE',
      warehouseId: warehouses.a.id,
      productId: products.q.id,
      firstDetectedAt: new Date('2026-07-01T05:00:00Z'),
      lastDetectedAt: new Date('2026-07-02T05:00:00Z'),
      resolvedAt: null,
      warehouse: warehouses.a,
      product: products.q,
    },
  ];
  const alertConfigs = [
    {
      warehouseId: warehouses.a.id,
      productId: products.q.id,
      minimumAvailableQty: 5,
      enabled: true,
    },
  ];
  const stocktakes = [
    {
      id: 'stocktake-1',
      stocktakeNo: 'ST-0001',
      warehouseId: warehouses.a.id,
      productId: products.q.id,
      trackingModeSnapshot: 'QUANTITY',
      status: 'POSTED',
      reason: '实盘差异',
      createdAt: new Date('2026-07-02T00:00:00Z'),
      submittedAt: new Date('2026-07-02T01:00:00Z'),
      approvedAt: new Date('2026-07-02T02:00:00Z'),
      postedAt: new Date('2026-07-02T02:00:00Z'),
      warehouse: warehouses.a,
      product: products.q,
      line: {
        snapshotOnHandQty: 5,
        countedOnHandQty: 4,
        onHandDifferenceQty: -1,
        snapshotUnavailableQty: 0,
        countedUnavailableQty: 1,
        unavailableDifferenceQty: 1,
      },
    },
  ];
  const transfers = [
    {
      id: 'transfer-1',
      transferNo: 'TR-0001',
      status: 'PARTIALLY_RECEIVED',
      fromWarehouseId: warehouses.a.id,
      toWarehouseId: warehouses.b.id,
      outboundAt: new Date('2026-07-01T06:00:00Z'),
      createdAt: new Date('2026-07-01T05:30:00Z'),
      fromWarehouse: warehouses.a,
      toWarehouse: warehouses.b,
      lines: [
        {
          id: 'transfer-line-1',
          lineNo: 1,
          productId: products.q.id,
          plannedQty: 4,
          outboundQty: 4,
          receivedQty: 2,
          unavailableQty: 0,
          differenceQty: 0,
          product: products.q,
          serializedUnitIds: ['BOTTLE-SECRET'],
        },
      ],
      receipts: [
        {
          id: 'receipt-1',
          status: 'POSTED',
          reversalOfReceiptId: null,
          lines: [
            {
              transferLineId: 'transfer-line-1',
              receivedQty: 2,
              unavailableQty: 0,
              differenceQty: 0,
            },
          ],
        },
      ],
    },
  ];
  const logs = [];
  const factPageSizes = [];
  const factCursors = [];
  const movementPageSizes = [];
  const repository = {
    async listReportMovementFacts(filters, cursorId, take) {
      factPageSizes.push(take);
      factCursors.push(cursorId);
      const rows = filterMovements(movements, filters)
        .sort((left, right) => left.id.localeCompare(right.id))
        .filter((row) => !cursorId || row.id > cursorId)
        .slice(0, take);
      return clone(rows);
    },
    async listReportMovementPage(filters, page, pageSize) {
      movementPageSizes.push(pageSize);
      const rows = filterMovements(movements, filters).sort(
        (left, right) =>
          new Date(right.businessAt) - new Date(left.businessAt) ||
          right.id.localeCompare(left.id),
      );
      return {
        rows: clone(rows.slice((page - 1) * pageSize, page * pageSize)),
        total: rows.length,
      };
    },
    async listReportStocks(filters) {
      return clone(
        stocks.filter((row) => matchesPair(row, filters)),
      );
    },
    async listReportBatches(filters, cursorId, take) {
      return clone(
        batches
          .filter((row) => matchesPair(row, filters))
          .sort((left, right) => left.id.localeCompare(right.id))
          .filter((row) => !cursorId || row.id > cursorId)
          .slice(0, take),
      );
    },
    async listReportAlertFacts(filters, page, pageSize) {
      const rows = alerts.filter((row) => matchesPair(row, filters));
      return {
        rows: clone(rows.slice((page - 1) * pageSize, page * pageSize)),
        total: rows.length,
      };
    },
    async listReportAlertConfigs(filters) {
      return clone(
        alertConfigs.filter((row) => matchesPair(row, filters)),
      );
    },
    async listReportStocktakes(filters, page, pageSize) {
      const rows = stocktakes.filter((row) => matchesPair(row, filters));
      return {
        rows: clone(rows.slice((page - 1) * pageSize, page * pageSize)),
        total: rows.length,
      };
    },
    async listReportTransfers(filters, cursorId, take) {
      return clone(
        transfers
          .filter(
            (row) =>
              (!filters.warehouseId ||
                row.fromWarehouseId === filters.warehouseId ||
                row.toWarehouseId === filters.warehouseId) &&
              (!filters.productId ||
                row.lines.some(
                  (line) => line.productId === filters.productId,
                )),
          )
          .filter((row) => !cursorId || row.id > cursorId)
          .slice(0, take),
      );
    },
  };
  const service = new InventoryReportService(repository, {
    appendLog: async (log) => {
      logs.push(clone(log));
      return log;
    },
  });
  return {
    service,
    logs,
    factPageSizes,
    factCursors,
    movementPageSizes,
  };
}

function movement(id, warehouse, product, input) {
  const batch = input.batch || null;
  return {
    id,
    sourceKey: `movement:${id}`,
    warehouseId: warehouse.id,
    productId: product.id,
    batchId: batch?.id || null,
    serializedUnitId: input.unitId || null,
    movementType: input.type,
    onHandDelta: input.onHand || 0,
    reservedDelta: input.reserved || 0,
    unavailableDelta: input.unavailable || 0,
    inTransitDelta: input.transit || 0,
    businessAt: new Date(input.businessAt),
    purchaseUnitCostCents: input.cost ?? null,
    operatorNameSnapshot: '测试库管',
    reason: input.reason || null,
    reversalOf: input.reversalOfType
      ? { movementType: input.reversalOfType }
      : null,
    warehouse,
    product,
    productNameSnapshot: product.name,
    unitSnapshot: product.unit,
    batch,
    serializedUnit: input.unitId
      ? {
          id: input.unitId,
          purchaseCostCents: input.unitCost,
          logisticsCode: 'BOTTLE-SECRET',
        }
      : null,
    documentLine: {
      lineNo: 1,
      document: {
        documentNo: `DOC-${id}`,
        type: input.type,
        status: 'POSTED',
      },
    },
    injectedPurchaseCostCents: 99999999,
  };
}

function batch(id, warehouse, product, remainingQty, cost, costStatus) {
  return {
    id,
    warehouseId: warehouse.id,
    productId: product.id,
    supplierName: '供应商',
    purchaseOrderNo: null,
    productionBatch: null,
    productionDate: new Date('2026-06-01T00:00:00Z'),
    receivedQty: remainingQty,
    remainingQty,
    unavailableQty: costStatus === 'PENDING' ? remainingQty : 0,
    fifoAt: new Date('2026-06-01T00:00:00Z'),
    purchaseUnitCostCents: cost,
    costStatus,
    warehouse,
    product,
  };
}

function stock(
  warehouse,
  product,
  onHandQty,
  reservedQty,
  unavailableQty,
  inTransitQty,
) {
  return {
    id: `stock-${warehouse.id}-${product.id}`,
    warehouseId: warehouse.id,
    productId: product.id,
    onHandQty,
    reservedQty,
    unavailableQty,
    inTransitQty,
    version: 1,
    lastMovementId: null,
    warehouse,
    product,
  };
}

function matchesPair(row, filters) {
  return (
    (!filters.warehouseId ||
      row.warehouseId === filters.warehouseId) &&
    (!filters.productId || row.productId === filters.productId) &&
    (!filters.inventoryTrackingMode ||
      row.product?.inventoryTrackingMode ===
        filters.inventoryTrackingMode)
  );
}

function filterMovements(rows, filters) {
  return rows.filter(
    (row) =>
      matchesPair(row, filters) &&
      (!filters.movementType ||
        row.movementType === filters.movementType) &&
      (!filters.dateFrom ||
        new Date(row.businessAt) >= filters.dateFrom) &&
      (!(filters.asOf || filters.dateTo) ||
        new Date(row.businessAt) <=
          (filters.asOf || filters.dateTo)),
  );
}

async function consumeStream(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function worksheetValues(sheet) {
  const values = [];
  sheet.eachRow((row) => {
    values.push(row.values.slice(1));
  });
  return values;
}

function actor(role) {
  return {
    id: `${role}-id`,
    name: role,
    username: role,
    role,
    isActive: true,
  };
}

function clone(value) {
  return structuredClone(value);
}
