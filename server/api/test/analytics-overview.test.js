const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');
const {
  normalizeAnalyticsDateRange,
} = require('../src/modules/analytics/analytics-date-range.helper');

test('contract: analytics overview enforces role permissions', async () => {
  await withPhase1Server(async (baseUrl) => {
    const missingToken = await requestJson(
      baseUrl,
      '/api/analytics/overview',
    );
    assertErrorContract(missingToken, 401, 'AUTH_TOKEN_REQUIRED');

    for (const username of [
      'admin',
      'stage8-overview-boss',
      'stage8-overview-finance',
      'stage8-overview-warehouse',
      'stage8-overview-after-sales',
    ]) {
      const session =
        username === 'admin'
          ? await login(baseUrl)
          : await login(baseUrl, username, 'Password123');
      const allowed = await requestJson(
        baseUrl,
        '/api/analytics/overview?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04',
        {
          token: session.token,
        },
      );
      assert.equal(allowed.response.status, 200);
      assertOverviewContract(allowed.body.data);
    }

    for (const username of [
      'stage8-overview-sales',
      'stage8-overview-front-desk',
      'stage8-overview-taster',
    ]) {
      const session = await login(baseUrl, username, 'Password123');
      const denied = await requestJson(baseUrl, '/api/analytics/overview', {
        token: session.token,
      });
      assertErrorContract(denied, 403, 'PERMISSION_DENIED');
    }
  }, {
    prisma: buildAnalyticsOverviewPrisma(),
  });
});

test('contract: analytics overview calculates stage 8 metrics from source records', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const result = await requestJson(
      baseUrl,
      '/api/analytics/overview?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04',
      {
        token: admin.token,
      },
    );

    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body.data.range, {
      preset: 'custom',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-04',
      timezone: 'Asia/Shanghai',
    });
    assert.deepEqual(result.body.data.metrics, {
      grossSalesAmountCents: 1650000,
      refundAmountCents: 100000,
      pendingRefundAmountCents: 10000,
      netSalesAmountCents: 1550000,
      totalGroupCount: 4,
      totalGuestCount: 65,
      groupScopedNetSalesAmountCents: 1500000,
      averageSalesPerGroupCents: 375000,
      averageSalesPerGuestCents: 23076,
      noEffectiveOrderGroupCount: 2,
      conversionGroupCount: 2,
      noOrderRate: 0.5,
      conversionRate: 0.5,
    });
    assert.deepEqual(warningCodes(result.body.data), [
      'pending_refund',
      'refunded_order_without_confirmed_refund',
      'missing_taster',
    ]);

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=analytics.overview',
      {
        token: admin.token,
      },
    );
    assert.equal(logs.response.status, 200);
    assert.deepEqual(logs.body.data.logs, []);
  }, {
    prisma: buildAnalyticsOverviewPrisma(),
  });
});

test('contract: analytics overview applies date presets and group filters', async () => {
  const expectedRange = normalizeAnalyticsDateRange({
    preset: 'this_month',
  });

  await withPhase1Server(async (baseUrl) => {
    const boss = await login(baseUrl, 'stage8-overview-boss', 'Password123');

    const presetResult = await requestJson(
      baseUrl,
      '/api/analytics/overview?preset=this_month',
      {
        token: boss.token,
      },
    );
    assert.equal(presetResult.response.status, 200);
    assert.deepEqual(presetResult.body.data.range, expectedRange);

    const filtered = await requestJson(
      baseUrl,
      '/api/analytics/overview?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04&groupType=retail&tasterId=taster-a&travelAgency=Agency%20A',
      {
        token: boss.token,
      },
    );
    assert.equal(filtered.response.status, 200);
    assert.deepEqual(filtered.body.data.metrics, {
      grossSalesAmountCents: 1000000,
      refundAmountCents: 100000,
      pendingRefundAmountCents: 10000,
      netSalesAmountCents: 900000,
      totalGroupCount: 2,
      totalGuestCount: 30,
      groupScopedNetSalesAmountCents: 900000,
      averageSalesPerGroupCents: 450000,
      averageSalesPerGuestCents: 30000,
      noEffectiveOrderGroupCount: 1,
      conversionGroupCount: 1,
      noOrderRate: 0.5,
      conversionRate: 0.5,
    });
    assert.deepEqual(warningCodes(filtered.body.data), ['pending_refund']);
  }, {
    prisma: buildAnalyticsOverviewPrisma(),
  });
});

test('contract: analytics overview obeys global mark filtering', async () => {
  await withPhase1Server(async (baseUrl) => {
    const boss = await login(baseUrl, 'stage8-overview-boss', 'Password123');

    const open = await requestJson(
      baseUrl,
      '/api/analytics/overview?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04',
      {
        token: boss.token,
      },
    );
    assert.equal(open.response.status, 200);
    assert.equal(open.body.data.metrics.grossSalesAmountCents, 60000);
    assert.equal(open.body.data.metrics.totalGroupCount, 2);
    assert.equal(open.body.data.metrics.groupScopedNetSalesAmountCents, 60000);

    const enabled = await requestJson(
      baseUrl,
      '/api/settings/global-mark-query/enable',
      {
        method: 'POST',
        token: boss.token,
      },
    );
    assert.equal(enabled.response.status, 200);

    const markedOnly = await requestJson(
      baseUrl,
      '/api/analytics/overview?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04',
      {
        token: boss.token,
      },
    );
    assert.equal(markedOnly.response.status, 200);
    assert.equal(markedOnly.body.data.metrics.grossSalesAmountCents, 40000);
    assert.equal(markedOnly.body.data.metrics.totalGroupCount, 1);
    assert.equal(
      markedOnly.body.data.metrics.groupScopedNetSalesAmountCents,
      10000,
    );
    assert.equal(markedOnly.body.data.metrics.noEffectiveOrderGroupCount, 0);
    assert.deepEqual(markedOnly.body.data.warnings, []);
  }, {
    prisma: buildAnalyticsOverviewMarkPrisma(),
  });
});

function buildAnalyticsOverviewPrisma() {
  return {
    users: analyticsUsers(),
    customers: [
      customer('customer-marked', true),
      customer('customer-unmarked', false),
    ],
    travelGroups: [
      travelGroup('group-a', {
        groupNo: 'TG-STAGE8-A',
        visitDate: '2026-07-01',
        guestCount: 10,
        tasterId: 'taster-a',
        tasterName: 'Taster A',
        groupType: 'retail',
        travelAgency: 'Stage8 Agency A',
        financeMark: true,
      }),
      travelGroup('group-b', {
        groupNo: 'TG-STAGE8-B',
        visitDate: '2026-07-02',
        guestCount: 20,
        tasterId: 'taster-a',
        tasterName: 'Taster A',
        groupType: 'retail',
        travelAgency: 'Stage8 Agency A',
        financeMark: true,
      }),
      travelGroup('group-c', {
        groupNo: 'TG-STAGE8-C',
        visitDate: '2026-07-03',
        guestCount: 30,
        tasterId: 'taster-b',
        tasterName: 'Taster B',
        groupType: 'vip',
        travelAgency: 'Stage8 Agency B',
        financeMark: true,
      }),
      travelGroup('group-missing-taster', {
        groupNo: 'TG-STAGE8-MISSING-TASTER',
        visitDate: '2026-07-04',
        guestCount: 5,
        tasterId: null,
        tasterName: null,
        groupType: 'retail',
        travelAgency: 'Stage8 Agency C',
        financeMark: true,
      }),
      travelGroup('group-outside-range', {
        groupNo: 'TG-STAGE8-OUTSIDE',
        visitDate: '2026-06-30',
        guestCount: 99,
        tasterId: 'taster-a',
        groupType: 'retail',
        travelAgency: 'Stage8 Agency A',
        financeMark: true,
      }),
    ],
    salesOrders: [
      salesOrder('order-a', {
        orderNo: 'SO-STAGE8-A',
        orderDate: '2026-07-01',
        travelGroupId: 'group-a',
        customerId: 'customer-marked',
        totalAmountCents: 1000000,
        status: 'PARTIAL_REFUND',
      }),
      salesOrder('order-c', {
        orderNo: 'SO-STAGE8-C',
        orderDate: '2026-07-03',
        travelGroupId: 'group-c',
        customerId: 'customer-marked',
        totalAmountCents: 600000,
        status: 'VALID',
      }),
      salesOrder('order-refunded-no-fact', {
        orderNo: 'SO-STAGE8-REFUNDED-NO-FACT',
        orderDate: '2026-07-04',
        travelGroupId: null,
        customerId: 'customer-marked',
        totalAmountCents: 50000,
        status: 'REFUNDED',
      }),
      salesOrder('order-cancelled', {
        orderNo: 'SO-STAGE8-CANCELLED',
        orderDate: '2026-07-04',
        travelGroupId: 'group-c',
        customerId: 'customer-marked',
        totalAmountCents: 999999,
        status: 'CANCELLED',
      }),
      salesOrder('order-outside-range', {
        orderNo: 'SO-STAGE8-OUTSIDE',
        orderDate: '2026-06-30',
        travelGroupId: 'group-outside-range',
        customerId: 'customer-marked',
        totalAmountCents: 123456,
        status: 'VALID',
      }),
    ],
    afterSalesOrders: [
      afterSalesOrder('after-sales-confirmed-a', {
        afterSalesNo: 'AS-STAGE8-CONFIRMED-A',
        salesOrderId: 'order-a',
        customerId: 'customer-marked',
        refundAmountCents: 100000,
        financeConfirmed: true,
        createdAt: '2026-07-02T03:00:00.000Z',
      }),
      afterSalesOrder('after-sales-pending-a', {
        afterSalesNo: 'AS-STAGE8-PENDING-A',
        salesOrderId: 'order-a',
        customerId: 'customer-marked',
        refundAmountCents: 10000,
        financeConfirmed: false,
        createdAt: '2026-07-02T04:00:00.000Z',
      }),
      afterSalesOrder('after-sales-outside-range', {
        afterSalesNo: 'AS-STAGE8-OUTSIDE',
        salesOrderId: 'order-outside-range',
        customerId: 'customer-marked',
        refundAmountCents: 90000,
        financeConfirmed: true,
        createdAt: '2026-06-30T04:00:00.000Z',
      }),
    ],
  };
}

function buildAnalyticsOverviewMarkPrisma() {
  return {
    users: analyticsUsers(),
    customers: [
      customer('customer-marked', true),
      customer('customer-unmarked', false),
    ],
    travelGroups: [
      travelGroup('group-marked', {
        groupNo: 'TG-STAGE8-MARKED',
        visitDate: '2026-07-02',
        guestCount: 10,
        tasterId: 'taster-a',
        financeMark: true,
      }),
      travelGroup('group-unmarked', {
        groupNo: 'TG-STAGE8-UNMARKED',
        visitDate: '2026-07-02',
        guestCount: 10,
        tasterId: 'taster-b',
        financeMark: false,
      }),
    ],
    salesOrders: [
      salesOrder('order-marked', {
        orderDate: '2026-07-02',
        travelGroupId: 'group-marked',
        customerId: 'customer-marked',
        totalAmountCents: 10000,
      }),
      salesOrder('order-unmarked-customer', {
        orderDate: '2026-07-02',
        travelGroupId: 'group-marked',
        customerId: 'customer-unmarked',
        totalAmountCents: 20000,
        financeMark: false,
      }),
      salesOrder('order-unmarked-group', {
        orderDate: '2026-07-02',
        travelGroupId: 'group-unmarked',
        customerId: 'customer-marked',
        totalAmountCents: 30000,
      }),
    ],
  };
}

function analyticsUsers() {
  return [
    user('usr-stage8-overview-boss', 'stage8-overview-boss', 'boss'),
    user('usr-stage8-overview-finance', 'stage8-overview-finance', 'finance'),
    user('usr-stage8-overview-sales', 'stage8-overview-sales', 'sales'),
    user(
      'usr-stage8-overview-front-desk',
      'stage8-overview-front-desk',
      'front_desk',
    ),
    user(
      'usr-stage8-overview-after-sales',
      'stage8-overview-after-sales',
      'after_sales',
    ),
    user(
      'usr-stage8-overview-warehouse',
      'stage8-overview-warehouse',
      'warehouse',
    ),
    user('usr-stage8-overview-taster', 'stage8-overview-taster', 'taster'),
  ];
}

function user(id, username, role) {
  return {
    id,
    username,
    name: username,
    role,
    password: 'Password123',
  };
}

function customer(id, financeMark) {
  return {
    id,
    name: id,
    phone: `139${id.length.toString().padStart(8, '0')}`,
    financeMark,
  };
}

function travelGroup(id, overrides = {}) {
  return {
    id,
    groupNo: `TG-${id}`,
    visitDate: '2026-07-02',
    guestCount: 10,
    tasterId: 'taster-default',
    tasterName: 'Taster Default',
    groupType: 'retail',
    travelAgency: 'Stage8 Agency',
    financeMark: true,
    ...overrides,
  };
}

function salesOrder(id, overrides = {}) {
  return {
    id,
    orderNo: `SO-${id}`,
    orderDate: '2026-07-02',
    customerId: 'customer-marked',
    customerName: 'Stage8 Test Customer',
    travelGroupId: null,
    totalAmountCents: 0,
    status: 'VALID',
    financeMark: true,
    ...overrides,
  };
}

function afterSalesOrder(id, overrides = {}) {
  return {
    id,
    afterSalesNo: `AS-${id}`,
    salesOrderId: 'order-a',
    customerId: 'customer-marked',
    refundAmountCents: 0,
    financeConfirmed: false,
    createdAt: '2026-07-02T00:00:00.000Z',
    ...overrides,
  };
}

function assertOverviewContract(data) {
  assert.deepEqual(Object.keys(data).sort(), ['metrics', 'range', 'warnings']);
  assert.equal(typeof data.range.dateFrom, 'string');
  assert.equal(typeof data.range.dateTo, 'string');
  assert.equal(data.range.timezone, 'Asia/Shanghai');
  assert.equal(typeof data.metrics.grossSalesAmountCents, 'number');
  assert.equal(typeof data.metrics.refundAmountCents, 'number');
  assert.equal(typeof data.metrics.pendingRefundAmountCents, 'number');
  assert.equal(typeof data.metrics.netSalesAmountCents, 'number');
  assert.equal(typeof data.metrics.totalGroupCount, 'number');
  assert.equal(typeof data.metrics.totalGuestCount, 'number');
  assert.equal(typeof data.metrics.groupScopedNetSalesAmountCents, 'number');
  assert.equal(typeof data.metrics.averageSalesPerGroupCents, 'number');
  assert.equal(typeof data.metrics.averageSalesPerGuestCents, 'number');
  assert.equal(typeof data.metrics.noEffectiveOrderGroupCount, 'number');
  assert.equal(typeof data.metrics.conversionGroupCount, 'number');
  assert.equal(typeof data.metrics.noOrderRate, 'number');
  assert.equal(typeof data.metrics.conversionRate, 'number');
  assert.equal(Array.isArray(data.warnings), true);
}

function warningCodes(data) {
  return data.warnings.map((warning) => warning.code);
}
