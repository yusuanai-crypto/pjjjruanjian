const assert = require('node:assert/strict');
const test = require('node:test');

const ExcelJS = require('exceljs');

const {
  assertErrorContract,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');
const {
  normalizeAnalyticsDateRange,
} = require('../src/modules/analytics/analytics-date-range.helper');

const RANGE_QUERY =
  'preset=custom&dateFrom=2026-07-01&dateTo=2026-07-02';

test('contract: sales performance endpoints allow only admin and boss', async () => {
  await withPhase1Server(async (baseUrl) => {
    const missingToken = await requestJson(
      baseUrl,
      `/api/analytics/sales-performance?${RANGE_QUERY}`,
    );
    assertErrorContract(missingToken, 401, 'AUTH_TOKEN_REQUIRED');

    for (const username of ['admin', 'sales-performance-boss']) {
      const session =
        username === 'admin'
          ? await login(baseUrl)
          : await login(baseUrl, username, 'Password123');
      const list = await requestJson(
        baseUrl,
        `/api/analytics/sales-performance?${RANGE_QUERY}`,
        { token: session.token },
      );
      assert.equal(list.response.status, 200);
      assert.ok(Array.isArray(list.body.data.salesPerformance));

      const detail = await requestJson(
        baseUrl,
        `/api/analytics/sales-performance/sales-a?${RANGE_QUERY}`,
        { token: session.token },
      );
      assert.equal(detail.response.status, 200);
      assert.equal(detail.body.data.salesUser.id, 'sales-a');

      const exported = await fetch(
        `${baseUrl}/api/analytics/sales-performance/export?${RANGE_QUERY}`,
        {
          headers: {
            authorization: `Bearer ${session.token}`,
          },
        },
      );
      assert.equal(exported.status, 200);
      assert.match(
        exported.headers.get('content-type') || '',
        /spreadsheetml\.sheet/,
      );
    }

    for (const username of [
      'sales-performance-finance',
      'sales-performance-after-sales',
      'sales-performance-sales',
      'sales-performance-taster',
      'sales-performance-warehouse',
      'sales-performance-front-desk',
    ]) {
      const session = await login(baseUrl, username, 'Password123');
      for (const path of [
        `/api/analytics/sales-performance?${RANGE_QUERY}`,
        `/api/analytics/sales-performance/sales-a?${RANGE_QUERY}`,
        `/api/analytics/sales-performance/export?${RANGE_QUERY}`,
      ]) {
        const denied = await requestJson(baseUrl, path, {
          token: session.token,
        });
        assertErrorContract(denied, 403, 'PERMISSION_DENIED');
      }
    }
  }, {
    prisma: buildSalesPerformancePrisma(),
  });
});

test('contract: sales performance uses orderDate for gross and createdAt for confirmed refunds', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);

    const dayOne = await getSalesPerformance(
      baseUrl,
      admin.token,
      '2026-07-01',
      '2026-07-01',
    );
    assert.deepEqual(pickMetrics(rowById(dayOne, 'sales-a')), {
      grossSalesAmountCents: 1000000,
      refundAmountCents: 0,
      netSalesAmountCents: 1000000,
      orderCount: 1,
      averageSalesPerOrderCents: 1000000,
    });
    assert.equal(rowById(dayOne, 'sales-timezone').refundAmountCents, 0);

    const dayTwo = await getSalesPerformance(
      baseUrl,
      admin.token,
      '2026-07-02',
      '2026-07-02',
    );
    assert.deepEqual(pickMetrics(rowById(dayTwo, 'sales-a')), {
      grossSalesAmountCents: 0,
      refundAmountCents: 500000,
      netSalesAmountCents: -500000,
      orderCount: 0,
      averageSalesPerOrderCents: null,
    });
    assert.equal(
      rowById(dayTwo, 'sales-timezone').refundAmountCents,
      7000,
    );

    const bothDays = await getSalesPerformance(
      baseUrl,
      admin.token,
      '2026-07-01',
      '2026-07-02',
    );
    assert.deepEqual(pickMetrics(rowById(bothDays, 'sales-a')), {
      grossSalesAmountCents: 1000000,
      refundAmountCents: 500000,
      netSalesAmountCents: 500000,
      orderCount: 1,
      averageSalesPerOrderCents: 500000,
    });

    const activeZero = rowById(bothDays, 'sales-zero');
    assert.equal(activeZero.isActive, true);
    assert.deepEqual(pickMetrics(activeZero), {
      grossSalesAmountCents: 0,
      refundAmountCents: 0,
      netSalesAmountCents: 0,
      orderCount: 0,
      averageSalesPerOrderCents: null,
    });

    const inactive = rowById(bothDays, 'sales-inactive');
    assert.equal(inactive.isActive, false);
    assert.equal(inactive.orderCount, 1);
    assert.equal(inactive.grossSalesAmountCents, 60000);

    const unassigned = rowById(bothDays, null);
    assert.equal(unassigned.salesUserName, '未分配销售');
    assert.equal(unassigned.isUnassigned, true);
    assert.equal(unassigned.orderCount, 1);
    assert.equal(unassigned.grossSalesAmountCents, 40000);

    const statusSales = rowById(bothDays, 'sales-status');
    assert.equal(statusSales.orderCount, 2);
    assert.equal(statusSales.grossSalesAmountCents, 50000);
    assert.equal(statusSales.refundAmountCents, 15000);
  }, {
    prisma: buildSalesPerformancePrisma(),
  });
});

test('contract: sales performance supports all presets, custom dates, stable sorting, and detail de-duplication', async () => {
  await withPhase1Server(async (baseUrl) => {
    const boss = await login(
      baseUrl,
      'sales-performance-boss',
      'Password123',
    );
    for (const preset of [
      'this_year',
      'this_month',
      'last_month',
      'last_10_days',
      'yesterday',
      'today',
    ]) {
      const result = await requestJson(
        baseUrl,
        `/api/analytics/sales-performance?preset=${preset}`,
        { token: boss.token },
      );
      assert.equal(result.response.status, 200);
      assert.deepEqual(
        result.body.data.range,
        normalizeAnalyticsDateRange({ preset }),
      );
    }

    const sorted = await requestJson(
      baseUrl,
      `/api/analytics/sales-performance?${RANGE_QUERY}&sortBy=orderCount&sortDirection=desc`,
      { token: boss.token },
    );
    assert.equal(sorted.response.status, 200);
    const zeroRows = sorted.body.data.salesPerformance.filter(
      (row) => row.orderCount === 0,
    );
    assert.deepEqual(
      zeroRows.map((row) => row.salesUserName),
      [...zeroRows.map((row) => row.salesUserName)].sort((left, right) =>
        left.localeCompare(right, 'zh-CN'),
      ),
    );
    for (const sortBy of [
      'netSalesAmountCents',
      'grossSalesAmountCents',
      'refundAmountCents',
      'orderCount',
      'averageSalesPerOrderCents',
      'salesUserName',
    ]) {
      const result = await requestJson(
        baseUrl,
        `/api/analytics/sales-performance?${RANGE_QUERY}&sortBy=${sortBy}&sortDirection=asc`,
        { token: boss.token },
      );
      assert.equal(result.response.status, 200);
      if (sortBy === 'averageSalesPerOrderCents') {
        const values = result.body.data.salesPerformance.map(
          (row) => row.averageSalesPerOrderCents,
        );
        const firstNullIndex = values.indexOf(null);
        assert.ok(firstNullIndex > 0);
        assert.ok(values.slice(firstNullIndex).every((value) => value === null));
      }
    }

    const detail = await requestJson(
      baseUrl,
      `/api/analytics/sales-performance/sales-status?${RANGE_QUERY}`,
      { token: boss.token },
    );
    assert.equal(detail.response.status, 200);
    assert.deepEqual(
      detail.body.data.orders.map((order) => order.id).sort(),
      ['order-partial', 'order-refunded'].sort(),
    );
    const refundedOrder = detail.body.data.orders.find(
      (order) => order.id === 'order-refunded',
    );
    assert.equal(refundedOrder.contributesToOrderCount, true);
    assert.deepEqual(refundedOrder.afterSalesOrderIds.sort(), [
      'refund-status-a',
      'refund-status-b',
    ]);

    const unassigned = await requestJson(
      baseUrl,
      `/api/analytics/sales-performance/unassigned?${RANGE_QUERY}`,
      { token: boss.token },
    );
    assert.equal(unassigned.response.status, 200);
    assert.equal(unassigned.body.data.salesUser.id, null);
    assert.equal(unassigned.body.data.salesUser.isUnassigned, true);
  }, {
    prisma: buildSalesPerformancePrisma(),
  });
});

test('contract: sales performance obeys the shared global mark scope', async () => {
  await withPhase1Server(async (baseUrl) => {
    const boss = await login(
      baseUrl,
      'sales-performance-boss',
      'Password123',
    );
    const open = await getSalesPerformance(
      baseUrl,
      boss.token,
      '2026-07-01',
      '2026-07-02',
    );
    assert.equal(rowById(open, 'sales-mark').grossSalesAmountCents, 30000);
    assert.equal(rowById(open, 'sales-mark').refundAmountCents, 3000);

    const enabled = await requestJson(
      baseUrl,
      '/api/settings/global-mark-query/enable',
      {
        method: 'POST',
        token: boss.token,
      },
    );
    assert.equal(enabled.response.status, 200);

    const markedOnly = await getSalesPerformance(
      baseUrl,
      boss.token,
      '2026-07-01',
      '2026-07-02',
    );
    assert.equal(
      rowById(markedOnly, 'sales-mark').grossSalesAmountCents,
      10000,
    );
    assert.equal(rowById(markedOnly, 'sales-mark').refundAmountCents, 1000);
  }, {
    prisma: buildSalesPerformanceMarkPrisma(),
  });
});

test('contract: sales performance export contains two worksheets and records row counts', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const response = await fetch(
      `${baseUrl}/api/analytics/sales-performance/export?${RANGE_QUERY}`,
      {
        headers: {
          authorization: `Bearer ${admin.token}`,
        },
      },
    );
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get('content-type') || '',
      /spreadsheetml\.sheet/,
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    assert.deepEqual(
      workbook.worksheets.map((sheet) => sheet.name),
      ['销售汇总', '订单贡献明细'],
    );
    assert.ok(workbook.getWorksheet('销售汇总').rowCount > 1);
    assert.ok(workbook.getWorksheet('订单贡献明细').rowCount > 1);

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=analytics.sales_performance.export',
      { token: admin.token },
    );
    assert.equal(logs.response.status, 200);
    assert.equal(logs.body.data.logs.length, 1);
    const log = logs.body.data.logs[0];
    assert.equal(log.action, 'analytics.sales_performance.export');
    assert.equal(log.afterData.filters.preset, 'custom');
    assert.equal(log.afterData.filters.dateFrom, '2026-07-01');
    assert.equal(log.afterData.filters.dateTo, '2026-07-02');
    assert.ok(log.afterData.summaryRowCount > 0);
    assert.ok(log.afterData.detailRowCount > 0);
  }, {
    prisma: buildSalesPerformancePrisma(),
  });
});

async function getSalesPerformance(baseUrl, token, dateFrom, dateTo) {
  const result = await requestJson(
    baseUrl,
    `/api/analytics/sales-performance?preset=custom&dateFrom=${dateFrom}&dateTo=${dateTo}`,
    { token },
  );
  assert.equal(result.response.status, 200);
  return result.body.data.salesPerformance;
}

function rowById(rows, salesUserId) {
  const row = rows.find((item) => item.salesUserId === salesUserId);
  assert.ok(row, `missing sales performance row for ${salesUserId}`);
  return row;
}

function pickMetrics(row) {
  return {
    grossSalesAmountCents: row.grossSalesAmountCents,
    refundAmountCents: row.refundAmountCents,
    netSalesAmountCents: row.netSalesAmountCents,
    orderCount: row.orderCount,
    averageSalesPerOrderCents: row.averageSalesPerOrderCents,
  };
}

function buildSalesPerformancePrisma() {
  return {
    users: [
      ...roleUsers(),
      user('sales-a', '销售甲', 'sales', true),
      user('sales-zero', '零业绩销售', 'sales', true),
      user('sales-inactive', '停用销售', 'sales', false),
      user('sales-status', '状态销售', 'sales', true),
      user('sales-timezone', '时区销售', 'sales', true),
    ],
    customers: [
      customer('customer-marked', true),
    ],
    salesOrders: [
      order('order-example', {
        orderNo: 'SO-EXAMPLE',
        orderDate: '2026-07-01',
        salesUserId: 'sales-a',
        totalAmountCents: 1000000,
        status: 'PARTIAL_REFUND',
      }),
      order('order-inactive', {
        orderNo: 'SO-INACTIVE',
        orderDate: '2026-07-01',
        salesUserId: 'sales-inactive',
        totalAmountCents: 60000,
        status: 'VALID',
      }),
      order('order-unassigned', {
        orderNo: 'SO-UNASSIGNED',
        orderDate: '2026-07-01',
        salesUserId: null,
        totalAmountCents: 40000,
        status: 'VALID',
      }),
      order('order-partial', {
        orderNo: 'SO-PARTIAL',
        orderDate: '2026-07-01',
        salesUserId: 'sales-status',
        totalAmountCents: 30000,
        status: 'PARTIAL_REFUND',
      }),
      order('order-refunded', {
        orderNo: 'SO-REFUNDED',
        orderDate: '2026-07-01',
        salesUserId: 'sales-status',
        totalAmountCents: 20000,
        status: 'REFUNDED',
      }),
      order('order-cancelled', {
        orderNo: 'SO-CANCELLED',
        orderDate: '2026-07-01',
        salesUserId: 'sales-status',
        totalAmountCents: 999999,
        status: 'CANCELLED',
      }),
      order('order-timezone', {
        orderNo: 'SO-TIMEZONE',
        orderDate: '2026-06-30',
        salesUserId: 'sales-timezone',
        totalAmountCents: 7000,
        status: 'REFUNDED',
      }),
    ],
    afterSalesOrders: [
      refund('refund-example-confirmed', {
        salesOrderId: 'order-example',
        refundAmountCents: 500000,
        financeConfirmed: true,
        createdAt: '2026-07-02T03:00:00.000Z',
      }),
      refund('refund-example-pending', {
        salesOrderId: 'order-example',
        refundAmountCents: 800000,
        financeConfirmed: false,
        createdAt: '2026-07-02T04:00:00.000Z',
      }),
      refund('refund-status-a', {
        salesOrderId: 'order-refunded',
        refundAmountCents: 10000,
        financeConfirmed: true,
        createdAt: '2026-07-02T03:00:00.000Z',
      }),
      refund('refund-status-b', {
        salesOrderId: 'order-refunded',
        refundAmountCents: 5000,
        financeConfirmed: true,
        createdAt: '2026-07-02T04:00:00.000Z',
      }),
      refund('refund-timezone', {
        salesOrderId: 'order-timezone',
        refundAmountCents: 7000,
        financeConfirmed: true,
        createdAt: '2026-07-01T16:30:00.000Z',
      }),
    ],
  };
}

function buildSalesPerformanceMarkPrisma() {
  return {
    users: [
      ...roleUsers(),
      user('sales-mark', '标记销售', 'sales', true),
    ],
    customers: [
      customer('customer-marked', true),
      customer('customer-unmarked', false),
    ],
    salesOrders: [
      order('order-marked', {
        orderDate: '2026-07-01',
        salesUserId: 'sales-mark',
        customerId: 'customer-unmarked',
        totalAmountCents: 10000,
      }),
      order('order-unmarked', {
        orderDate: '2026-07-01',
        salesUserId: 'sales-mark',
        customerId: 'customer-marked',
        totalAmountCents: 20000,
        financeMark: false,
      }),
    ],
    afterSalesOrders: [
      refund('refund-marked', {
        salesOrderId: 'order-marked',
        customerId: 'customer-marked',
        refundAmountCents: 1000,
        createdAt: '2026-07-02T03:00:00.000Z',
      }),
      refund('refund-unmarked', {
        salesOrderId: 'order-unmarked',
        customerId: 'customer-unmarked',
        refundAmountCents: 2000,
        createdAt: '2026-07-02T03:00:00.000Z',
      }),
    ],
  };
}

function roleUsers() {
  return [
    user('sales-performance-boss-id', 'Boss', 'boss', true, 'sales-performance-boss'),
    user('sales-performance-finance-id', 'Finance', 'finance', true, 'sales-performance-finance'),
    user('sales-performance-after-sales-id', 'After Sales', 'after_sales', true, 'sales-performance-after-sales'),
    user('sales-performance-sales-id', 'Sales', 'sales', true, 'sales-performance-sales'),
    user('sales-performance-taster-id', 'Taster', 'taster', true, 'sales-performance-taster'),
    user('sales-performance-warehouse-id', 'Warehouse', 'warehouse', true, 'sales-performance-warehouse'),
    user('sales-performance-front-desk-id', 'Front Desk', 'front_desk', true, 'sales-performance-front-desk'),
  ];
}

function user(id, name, role, isActive, username = id) {
  return {
    id,
    name,
    username,
    password: 'Password123',
    role,
    isActive,
  };
}

function customer(id, financeMark) {
  return {
    id,
    name: id,
    financeMark,
  };
}

function order(id, overrides = {}) {
  return {
    id,
    orderNo: overrides.orderNo || `SO-${id}`,
    orderDate: overrides.orderDate || '2026-07-01',
    salesUserId: overrides.salesUserId ?? null,
    customerId: overrides.customerId || 'customer-marked',
    customerName: overrides.customerName || '测试客户',
    totalAmountCents: overrides.totalAmountCents || 0,
    status: overrides.status || 'VALID',
    travelGroupId: null,
    financeMark: overrides.financeMark ?? true,
  };
}

function refund(id, overrides = {}) {
  return {
    id,
    afterSalesNo: `AS-${id}`,
    salesOrderId: overrides.salesOrderId,
    customerId: overrides.customerId || 'customer-marked',
    refundAmountCents: overrides.refundAmountCents || 0,
    financeConfirmed: overrides.financeConfirmed ?? true,
    createdAt: overrides.createdAt || '2026-07-02T03:00:00.000Z',
    status: 'COMPLETED',
    issueType: 'RETURN',
    actionType: 'REFUND',
    description: 'test refund',
  };
}
