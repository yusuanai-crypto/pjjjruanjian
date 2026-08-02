const assert = require('node:assert/strict');
const test = require('node:test');
const ExcelJS = require('exceljs');

const {
  assertErrorContract,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

const PASSWORD = 'Password123';
const RANGE =
  'preset=custom&dateFrom=2026-07-01&dateTo=2026-07-31';
const ENDPOINT = `/api/analytics/daily-loss-profits?${RANGE}`;

test('contract: daily loss profits reuse profit permissions, date scope, aggregation, pricing, pagination, and global marks', async () => {
  await withDailyLossServer(async (baseUrl, context) => {
    await prepareDailyLossFixtures(context.prisma);

    const anonymous = await requestJson(baseUrl, ENDPOINT);
    assertErrorContract(anonymous, 401, 'AUTH_TOKEN_REQUIRED');

    const admin = await login(baseUrl);
    const boss = await login(baseUrl, 'loss-boss', PASSWORD);
    const superAdmin = await login(
      baseUrl,
      'loss-super-admin',
      PASSWORD,
    );
    const warehouse = await login(baseUrl, 'loss-warehouse', PASSWORD);
    for (const session of [admin, boss, superAdmin, warehouse]) {
      const allowed = await requestJson(baseUrl, ENDPOINT, {
        token: session.token,
      });
      assert.equal(allowed.response.status, 200);
    }
    for (const role of [
      'finance',
      'sales',
      'front-desk',
      'after-sales',
      'taster',
    ]) {
      const session = await login(baseUrl, `loss-${role}`, PASSWORD);
      const denied = await requestJson(baseUrl, ENDPOINT, {
        token: session.token,
      });
      assertErrorContract(denied, 403, 'PERMISSION_DENIED');
    }

    const defaultRange = await requestJson(
      baseUrl,
      '/api/analytics/daily-loss-profits',
      { token: admin.token },
    );
    assert.equal(defaultRange.response.status, 200);
    assert.equal(defaultRange.body.data.range.preset, 'today');
    assert.equal(
      defaultRange.body.data.range.dateFrom,
      defaultRange.body.data.range.dateTo,
    );

    const paged = await requestJson(
      baseUrl,
      `${ENDPOINT}&page=1&pageSize=2`,
      { token: admin.token },
    );
    assert.equal(paged.response.status, 200);
    assert.deepEqual(paged.body.data.range, {
      preset: 'custom',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });
    assert.deepEqual(paged.body.data.pagination, {
      page: 1,
      pageSize: 2,
      total: 4,
      totalPages: 2,
    });
    assert.equal(paged.body.data.items.length, 2);
    assert.deepEqual(paged.body.data.summary, {
      rowCount: 4,
      totalLossQuantity: 21,
      calculableLossQuantity: 12,
      unpricedLossQuantity: 9,
      estimatedProfitLossCents: null,
      knownEstimatedProfitLossCents: 2400,
      incompleteRowCount: 2,
      costCoverageStatus: 'incomplete',
    });

    const all = await requestJson(baseUrl, ENDPOINT, {
      token: admin.token,
    });
    assert.deepEqual(
      all.body.data.items.map((row) => row.date),
      ['2026-07-13', '2026-07-12', '2026-07-11', '2026-07-10'],
    );
    const merged = all.body.data.items.find(
      (row) => row.date === '2026-07-10',
    );
    assert.equal(merged.lossQuantity, 5);
    assert.equal(merged.estimatedProfitLossCents, 1000);
    assert.equal(merged.operatorName, '操作员甲');
    assert.equal(merged.costCoverageStatus, 'available');

    const canned = all.body.data.items.find(
      (row) => row.productId === null,
    );
    assert.equal(canned.productName, '罐装酒');
    assert.equal(canned.tastingRoomNo, '未填写');
    assert.equal(canned.operatorName, '未知操作员');
    assert.equal(canned.estimatedProfitLossCents, null);
    assert.equal(canned.costCoverageStatus, 'unavailable');
    assert.ok(
      canned.warnings.some(
        (warning) =>
          warning.code === 'PRODUCT_ACTUAL_COST_UNAVAILABLE',
      ),
    );
    const noEffectiveCost = all.body.data.items.find(
      (row) => row.productId === 'product-b',
    );
    assert.equal(noEffectiveCost.estimatedProfitLossCents, null);

    const enabled = await requestJson(
      baseUrl,
      '/api/settings/global-mark-query/enable',
      {
        method: 'POST',
        token: boss.token,
      },
    );
    assert.equal(enabled.response.status, 200);
    const markedOnly = await requestJson(baseUrl, ENDPOINT, {
      token: boss.token,
    });
    assert.equal(markedOnly.body.data.pagination.total, 3);
    assert.equal(
      markedOnly.body.data.items.some(
        (row) => row.date === '2026-07-13',
      ),
      false,
    );
  });
});

test('contract: daily loss export returns all aggregated rows with workbook styling and an audit log', async () => {
  await withDailyLossServer(async (baseUrl, context) => {
    await prepareDailyLossFixtures(context.prisma);
    const admin = await login(baseUrl);
    const finance = await login(baseUrl, 'loss-finance', PASSWORD);
    const warehouse = await login(baseUrl, 'loss-warehouse', PASSWORD);

    const anonymous = await fetch(
      `${baseUrl}/api/analytics/daily-loss-profits/export?${RANGE}`,
    );
    assert.equal(anonymous.status, 401);
    const denied = await fetch(
      `${baseUrl}/api/analytics/daily-loss-profits/export?${RANGE}`,
      {
        headers: {
          authorization: `Bearer ${finance.token}`,
        },
      },
    );
    assert.equal(denied.status, 403);

    const response = await fetch(
      `${baseUrl}/api/analytics/daily-loss-profits/export?${RANGE}&page=1&pageSize=1`,
      {
        headers: {
          authorization: `Bearer ${warehouse.token}`,
        },
      },
    );
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get('content-type') || '',
      /spreadsheetml\.sheet/,
    );
    assert.match(
      response.headers.get('content-disposition') || '',
      /daily-loss-profit-\d{8}-\d{6}\.xlsx/,
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    assert.deepEqual(
      workbook.worksheets.map((sheet) => sheet.name),
      ['损耗汇总', '每日损耗汇总'],
    );
    const summary = workbook.getWorksheet('损耗汇总');
    const details = workbook.getWorksheet('每日损耗汇总');
    assert.deepEqual(readHeaders(details), [
      '日期',
      '商品',
      '品鉴馆号',
      '操作员',
      '损耗数量',
      '单位',
      '预计利润损失',
      '核算状态',
    ]);
    assert.equal(details.actualRowCount, 5);
    assert.equal(details.views[0].state, 'frozen');
    assert.equal(details.views[0].ySplit, 1);
    assert.ok(details.autoFilter);
    assert.equal(details.getCell(1, 1).font.bold, true);
    assert.equal(details.getColumn(7).numFmt, '¥#,##0.00');
    assert.equal(summary.getCell(6, 2).numFmt, '¥#,##0.00');

    const detailRows = readDataRows(details);
    const canned = detailRows.find((row) => row['商品'] === '罐装酒');
    assert.equal(canned['预计利润损失'], '');
    assert.equal(canned['核算状态'], '成本未配置');
    assert.equal(
      detailRows.some((row) => row['日期'] === '2026-07-10'),
      true,
      'export must ignore page/pageSize and include rows outside page one',
    );

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=analytics.daily_loss_profit.export',
      { token: admin.token },
    );
    assert.equal(logs.response.status, 200);
    assert.equal(logs.body.data.logs.length, 1);
    const log = logs.body.data.logs[0];
    assert.equal(log.action, 'analytics.daily_loss_profit.export');
    assert.equal(log.afterData.rowCount, 4);
    assert.deepEqual(log.afterData.filters, {
      preset: 'custom',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });
  });
});

function withDailyLossServer(run) {
  return withPhase1Server(run, {
    prisma: {
      users: [
        user('loss-super-admin', 'super_admin'),
        user('loss-boss', 'boss'),
        user('loss-finance', 'finance'),
        user('loss-sales', 'sales'),
        user('loss-front-desk', 'front_desk'),
        user('loss-warehouse', 'warehouse'),
        user('loss-after-sales', 'after_sales'),
        user('loss-taster', 'taster'),
        {
          id: 'operator-1',
          username: 'loss-operator',
          name: '操作员甲',
          role: 'sales',
          password: PASSWORD,
        },
      ],
      travelGroups: [
        group('merge-1', '2026-07-10', true, 'RECORDED', 'A1', 'operator-1'),
        group('merge-2', '2026-07-10', true, 'RECORDED', 'A1', 'operator-1'),
        group('canned', '2026-07-11', true, 'RECORDED', null, null),
        group('missing-cost', '2026-07-12', true, 'RECORDED', 'B2', 'operator-1'),
        group('unmarked', '2026-07-13', false, 'RECORDED', 'C3', 'operator-1'),
        group('pending', '2026-07-14', true, 'PENDING', 'D4', 'operator-1'),
        group('no-loss', '2026-07-15', true, 'NO_LOSS', 'E5', 'operator-1'),
        group('outside', '2026-08-01', true, 'RECORDED', 'F6', 'operator-1'),
      ],
    },
  });
}

async function prepareDailyLossFixtures(prisma) {
  await prisma.product.create({
    data: {
      id: 'product-a',
      name: '飞天',
      normalizedName: '飞天',
      unit: '瓶',
      isActive: true,
    },
  });
  await prisma.product.create({
    data: {
      id: 'product-b',
      name: '珍品',
      normalizedName: '珍品',
      unit: '瓶',
      isActive: true,
    },
  });
  await prisma.productActualCost.create({
    data: {
      id: 'cost-a-old',
      productId: 'product-a',
      costCents: 100,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: new Date('2026-07-10T00:00:00.000Z'),
      isActive: true,
    },
  });
  await prisma.productActualCost.create({
    data: {
      id: 'cost-a-new',
      productId: 'product-a',
      costCents: 200,
      effectiveFrom: new Date('2026-07-10T00:00:00.000Z'),
      effectiveTo: null,
      isActive: true,
    },
  });
  await prisma.productActualCost.create({
    data: {
      id: 'cost-b-expired',
      productId: 'product-b',
      costCents: 300,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: new Date('2026-07-11T00:00:00.000Z'),
      isActive: true,
    },
  });
  await addItems(prisma, 'group-merge-1', [
    tastingItem('product-a', '飞天', 2),
  ]);
  await addItems(prisma, 'group-merge-2', [
    tastingItem('product-a', '飞天', 3),
  ]);
  await addItems(prisma, 'group-canned', [
    tastingItem(null, '罐装酒', 4),
  ]);
  await addItems(prisma, 'group-missing-cost', [
    tastingItem('product-b', '珍品', 5),
  ]);
  await addItems(prisma, 'group-unmarked', [
    tastingItem('product-a', '飞天', 7),
  ]);
  await addItems(prisma, 'group-pending', [
    tastingItem('product-a', '飞天', 90),
  ]);
  await addItems(prisma, 'group-no-loss', [
    tastingItem('product-a', '飞天', 80),
  ]);
  await addItems(prisma, 'group-outside', [
    tastingItem('product-a', '飞天', 70),
  ]);
}

function addItems(prisma, groupId, items) {
  return prisma.travelGroup.update({
    where: { id: groupId },
    data: {
      tastingItems: {
        create: items,
      },
    },
  });
}

function tastingItem(productId, productName, quantity) {
  return {
    productId,
    productName,
    quantity,
    unit: '瓶',
    sortOrder: 1,
  };
}

function user(username, role) {
  return {
    id: `usr-${username}`,
    username,
    name: username,
    role,
    password: PASSWORD,
  };
}

function group(
  id,
  visitDate,
  financeMark,
  lossStatus,
  tastingRoomNo,
  lossConfirmedById,
) {
  return {
    id: `group-${id}`,
    groupNo: `TG-${id}`,
    visitDate,
    financeMark,
    lossStatus,
    tastingRoomNo,
    lossConfirmedById,
  };
}

function readHeaders(worksheet) {
  return worksheet.getRow(1).values.slice(1);
}

function readDataRows(worksheet) {
  const headers = readHeaders(worksheet);
  const rows = [];
  for (
    let rowNumber = 2;
    rowNumber <= worksheet.actualRowCount;
    rowNumber += 1
  ) {
    const row = worksheet.getRow(rowNumber);
    rows.push(
      Object.fromEntries(
        headers.map((header, index) => [
          header,
          row.getCell(index + 1).value,
        ]),
      ),
    );
  }
  return rows;
}
