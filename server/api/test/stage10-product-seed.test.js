const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  STAGE10_INITIAL_PRODUCTS,
  STAGE10_PRODUCT_CATALOG_GO_LIVE_DATE,
  STAGE10_PRODUCT_SOURCE_ROWS,
  normalizeProductName,
  validateStage10InitialProducts,
  yuanTextToCents,
} = require('../prisma/stage10-product-seed-data');
const {
  backfillHistoricalProductIds,
  seedStage10ProductsAndBackfill,
} = require('../prisma/stage10-product-seed');

test('stage10 seed data: workbook values split into 16 exact products and integer cents', () => {
  assert.equal(validateStage10InitialProducts(), true);
  assert.equal(STAGE10_PRODUCT_SOURCE_ROWS.length, 16);
  assert.equal(STAGE10_INITIAL_PRODUCTS.length, 16);
  assert.equal(STAGE10_PRODUCT_CATALOG_GO_LIVE_DATE, '2026-07-11');

  assert.deepEqual(
    STAGE10_INITIAL_PRODUCTS.map(({ name, unit, costCents }) => [
      name,
      unit,
      costCents,
    ]),
    [
      ['茅坛锦绣', '瓶', 10800],
      ['茅乡名家名作', '瓶', 11900],
      ['茅乡珍酿', '瓶', 12500],
      ['茅乡品鉴', '瓶', 9500],
      ['茅乡酱门尊品', '瓶', 11600],
      ['茅乡金品', '瓶', 9000],
      ['茅台醇', '瓶', 6200],
      ['酒具', '盒', 2000],
      ['高尔夫', '瓶', 1100],
      ['小酱酒', '瓶', 650],
      ['画', '幅', 9000],
      ['小多彩', '瓶', 1500],
      ['茅乡贵宾A30尊品', '瓶', 8200],
      ['茅坛匠心', '瓶', 14800],
      ['贵州老窖', '瓶', 8000],
      ['不老酒', '瓶', 10800],
    ],
  );
  assert.equal(yuanTextToCents('6.5'), 650);
  assert.equal(normalizeProductName(' 茅乡贵宾Ａ３０尊品 '), '茅乡贵宾a30尊品');
});

test('stage10 seed: repeated execution creates no duplicate products or costs', async () => {
  const prisma = createPrismaMock();
  const now = new Date('2026-07-11T08:00:00.000Z');

  const first = await seedStage10ProductsAndBackfill(prisma, {
    actorUserId: 'usr_admin',
    now,
  });
  const second = await seedStage10ProductsAndBackfill(prisma, {
    actorUserId: 'usr_admin',
    now,
  });

  assert.equal(prisma.__store.products.length, 16);
  assert.equal(prisma.__store.actualCosts.length, 16);
  assert.deepEqual(first.products, {
    expected: 16,
    created: 16,
    reused: 0,
    skipped: 0,
  });
  assert.equal(first.actualCosts.created, 16);
  assert.equal(second.products.created, 0);
  assert.equal(second.products.reused, 16);
  assert.equal(second.actualCosts.created, 0);
  assert.equal(second.actualCosts.reused, 16);
  assert.equal(second.warnings.length, 0);
  assert.equal(
    prisma.__store.actualCosts.every(
      (row) =>
        row.effectiveFrom.toISOString().slice(0, 10) === '2026-07-11' &&
        row.effectiveTo === null,
    ),
    true,
  );
});

test('stage10 backfill: links normalized names, reports skips and preserves historical facts', async () => {
  const historicalOrder = {
    id: 'soi_match',
    productId: null,
    productName: ' 茅坛锦绣 ',
    unit: '历史单位',
    unitPriceCents: 299900,
    actualUnitCostCents: null,
    actualCostSubtotalCents: null,
    grossProfitCents: null,
  };
  const unmatchedOrder = {
    id: 'soi_unmatched',
    productId: null,
    productName: '历史未知商品',
    unit: null,
    unitPriceCents: 188800,
    actualUnitCostCents: null,
    actualCostSubtotalCents: null,
    grossProfitCents: null,
  };
  const prisma = createPrismaMock({
    salesOrderItems: [historicalOrder, unmatchedOrder],
    tastingItems: [
      {
        id: 'tasting_match',
        productId: null,
        productName: '小酱酒',
        unit: '瓶',
      },
    ],
    salesDeductionRules: [
      {
        id: 'sales_rule_match',
        productId: null,
        productName: '茅乡贵宾Ａ３０尊品',
        deductionCostCents: 1234,
      },
    ],
    agencyDeductionRules: [
      {
        id: 'agency_rule_match',
        productId: null,
        productName: '不老酒',
        deductionCostCents: 5678,
      },
    ],
  });

  const report = await seedStage10ProductsAndBackfill(prisma, {
    actorUserId: 'usr_admin',
    now: new Date('2026-07-11T08:00:00.000Z'),
  });

  assert.equal(report.matched, 4);
  assert.equal(report.skipped, 1);
  assert.equal(report.warnings.length, 1);
  assert.equal(report.warnings[0].code, 'HISTORICAL_PRODUCT_NOT_MATCHED');
  assert.deepEqual(report.tables.SalesOrderItem, {
    scanned: 2,
    matched: 1,
    skipped: 1,
  });

  assert.equal(historicalOrder.productId, 'prd_stage10_01');
  assert.equal(historicalOrder.productName, ' 茅坛锦绣 ');
  assert.equal(historicalOrder.unit, '历史单位');
  assert.equal(historicalOrder.unitPriceCents, 299900);
  assert.equal(historicalOrder.actualUnitCostCents, null);
  assert.equal(historicalOrder.actualCostSubtotalCents, null);
  assert.equal(historicalOrder.grossProfitCents, null);
  assert.equal(unmatchedOrder.productId, null);
  assert.equal(unmatchedOrder.actualUnitCostCents, null);
  assert.equal(unmatchedOrder.actualCostSubtotalCents, null);
  assert.equal(unmatchedOrder.grossProfitCents, null);
  assert.equal(
    prisma.__store.salesDeductionRules[0].deductionCostCents,
    1234,
  );
  assert.equal(
    prisma.__store.agencyDeductionRules[0].deductionCostCents,
    5678,
  );
});

test('stage10 backfill: duplicate normalized candidates are skipped with warning', async () => {
  const prisma = createPrismaMock({
    products: [
      { id: 'duplicate_1', name: '茅台醇', normalizedName: '茅台醇' },
      { id: 'duplicate_2', name: ' 茅台醇 ', normalizedName: '茅台醇' },
    ],
    salesOrderItems: [
      { id: 'ambiguous', productId: null, productName: '茅台醇' },
    ],
  });

  const report = await backfillHistoricalProductIds(prisma);

  assert.equal(report.matched, 0);
  assert.equal(report.skipped, 1);
  assert.equal(report.warnings[0].code, 'HISTORICAL_PRODUCT_AMBIGUOUS');
  assert.equal(prisma.__store.salesOrderItems[0].productId, null);
});

test('stage10 seed: runtime code does not read the source workbook', () => {
  const seedSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'prisma', 'stage10-product-seed.js'),
    'utf8',
  );
  const scriptSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'scripts', 'seed-stage10-products.js'),
    'utf8',
  );
  const startupSources = [
    'src/main.ts',
    'src/main.js',
    'src/app.module.ts',
    'src/app.js',
  ]
    .map((relativePath) =>
      fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8'),
    )
    .join('\n');

  assert.doesNotMatch(seedSource, /exceljs|readFileSync|\.xlsx['"]\s*\)/i);
  assert.doesNotMatch(scriptSource, /exceljs|readFileSync|\.xlsx['"]\s*\)/i);
  assert.doesNotMatch(startupSources, /stage10-product-seed|商品实际成本\.xlsx/);
});

function createPrismaMock(initial = {}) {
  const store = {
    products: initial.products || [],
    actualCosts: initial.actualCosts || [],
    salesOrderItems: initial.salesOrderItems || [],
    tastingItems: initial.tastingItems || [],
    salesDeductionRules: initial.salesDeductionRules || [],
    agencyDeductionRules: initial.agencyDeductionRules || [],
  };
  const prisma = {
    __store: store,
    $transaction: async (callback) => callback(prisma),
    product: {
      findUnique: async ({ where, select }) =>
        project(
          store.products.find(
            (row) => row.normalizedName === where.normalizedName,
          ) || null,
          select,
        ),
      create: async ({ data, select }) => {
        if (
          store.products.some(
            (row) =>
              row.id === data.id ||
              row.name === data.name ||
              row.normalizedName === data.normalizedName,
          )
        ) {
          throw new Error('unique product conflict');
        }
        const row = { ...data };
        store.products.push(row);
        return project(row, select);
      },
      findMany: async ({ select } = {}) =>
        store.products.map((row) => project(row, select)),
    },
    productActualCost: {
      findUnique: async ({ where, select }) =>
        project(
          store.actualCosts.find((row) => row.id === where.id) || null,
          select,
        ),
      findMany: async ({ where, select }) =>
        store.actualCosts
          .filter((row) => matchesActualCostWhere(row, where))
          .map((row) => project(row, select)),
      create: async ({ data }) => {
        if (store.actualCosts.some((row) => row.id === data.id)) {
          throw new Error('unique actual cost conflict');
        }
        const row = { ...data };
        store.actualCosts.push(row);
        return row;
      },
    },
  };
  prisma.salesOrderItem = targetDelegate(store.salesOrderItems);
  prisma.travelGroupTastingItem = targetDelegate(store.tastingItems);
  prisma.salesDeductionRule = targetDelegate(store.salesDeductionRules);
  prisma.agencyDeductionRule = targetDelegate(store.agencyDeductionRules);
  return prisma;
}

function targetDelegate(rows) {
  return {
    findMany: async ({ where, select }) =>
      rows
        .filter((row) => row.productId === where.productId)
        .map((row) => project(row, select)),
    updateMany: async ({ where, data }) => {
      const row = rows.find(
        (candidate) =>
          candidate.id === where.id && candidate.productId === where.productId,
      );
      if (!row) {
        return { count: 0 };
      }
      Object.assign(row, data);
      return { count: 1 };
    },
  };
}

function matchesActualCostWhere(row, where) {
  if (row.productId !== where.productId || row.isActive !== where.isActive) {
    return false;
  }
  const goLiveDate = where.OR?.[1]?.effectiveTo?.gte;
  return row.effectiveTo === null ||
    (goLiveDate && new Date(row.effectiveTo).getTime() >= goLiveDate.getTime());
}

function project(row, select) {
  if (!row || !select) {
    return row;
  }
  return Object.fromEntries(
    Object.keys(select)
      .filter((key) => select[key])
      .map((key) => [key, row[key]]),
  );
}
