const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  getRoleMenus,
  getRolePermissions,
} = require('../src/modules/auth/roles');
const {
  assertErrorContract,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

const GROUP_ID = 'group-guide-points';
const GUIDE_A_ID = 'guide-points-a';
const GUIDE_B_ID = 'guide-points-b';
const ORDER_A_ID = 'order-guide-points-a';
const ORDER_B_ID = 'order-guide-points-b';

test('smoke: migration defaults historical orders to agency and creates independent guide summary state', () => {
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'prisma',
      'migrations',
      '20260727000100_guide_personal_points',
      'migration.sql',
    ),
    'utf8',
  );
  assert.match(
    migration,
    /`points_destination` ENUM\('travel_agency', 'guide_personal'\)\s+NOT NULL DEFAULT 'travel_agency'/,
  );
  assert.match(migration, /CREATE TABLE `guide_points_summaries`/);
  assert.match(
    migration,
    /UNIQUE INDEX `guide_points_summaries_group_guide_key`\s+\(`travel_group_id`, `guide_id`\)/,
  );
  assert.match(migration, /`daily_points_paid` BOOLEAN NOT NULL DEFAULT false/);
  assert.match(migration, /`monthly_points_paid` BOOLEAN NOT NULL DEFAULT false/);
});

test('smoke: partial personal migration backfills historical whole-personal orders and adds refund bounds', () => {
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'prisma',
      'migrations',
      '20260729000400_partial_personal_points_split',
      'migration.sql',
    ),
    'utf8',
  );
  assert.match(
    migration,
    /WHEN `points_destination` = 'guide_personal'\s+THEN `total_amount_cents`/,
  );
  assert.match(migration, /sales_orders_personal_amount_bounds_chk/);
  assert.match(
    migration,
    /after_sales_orders_personal_refund_bounds_chk/,
  );
  assert.match(
    migration,
    /WHEN `source_order`\.`personal_amount_cents` > 0\s+THEN `after_sales`\.`refund_amount_cents`/,
  );
});

test('unit: guide points menu and permissions match the four-role matrix', () => {
  for (const role of ['super_admin', 'admin', 'finance', 'boss']) {
    assert.ok(
      getRoleMenus(role).some((menu) => menu.id === 'guide_points_table'),
      `${role} menu`,
    );
    assert.ok(
      getRolePermissions(role).includes('guide_points_summaries:read'),
      `${role} read`,
    );
    assert.ok(
      getRolePermissions(role).includes(
        'sales_orders:update_points_destination',
      ),
      `${role} switch`,
    );
  }
  for (const role of ['super_admin', 'admin', 'finance']) {
    assert.ok(
      getRolePermissions(role).includes('guide_points_orders:update_rates'),
      `${role} rates`,
    );
  }
  assert.equal(
    getRolePermissions('boss').includes(
      'guide_points_orders:update_rates',
    ),
    false,
  );
  for (const role of ['sales', 'front_desk', 'warehouse', 'after_sales', 'taster']) {
    assert.equal(
      getRoleMenus(role).some((menu) => menu.id === 'guide_points_table'),
      false,
      role,
    );
  }
});

test('contract: guide personal points split ordinary and guide summaries by group plus receiving guide', async () => {
  await withGuidePointsServer(async (baseUrl) => {
    const admin = await login(baseUrl);

    const initialOrder = await getOrder(baseUrl, admin.token, ORDER_A_ID);
    assert.equal(initialOrder.pointsDestination, 'TRAVEL_AGENCY');
    assert.equal(initialOrder.personalAmountCents, 0);
    assert.equal(initialOrder.normalAmountCents, 10000);
    assert.equal(initialOrder.personalPointsGuideId, null);

    const firstSwitch = await switchDestination(
      baseUrl,
      admin.token,
      ORDER_A_ID,
      {
        personalAmountCents: 3000,
        guideId: GUIDE_A_ID,
      },
    );
    assert.equal(firstSwitch.response.status, 200, bodyText(firstSwitch));
    assert.equal(
      firstSwitch.body.data.salesOrder.pointsDestination,
      'GUIDE_PERSONAL',
    );
    assert.equal(
      firstSwitch.body.data.salesOrder.personalAmountCents,
      3000,
    );
    assert.equal(
      firstSwitch.body.data.salesOrder.normalAmountCents,
      7000,
    );
    assert.equal(
      firstSwitch.body.data.salesOrder.personalDailyRebateRate,
      '0.5000',
    );
    assert.equal(
      firstSwitch.body.data.salesOrder.personalMonthlyRebateRate,
      '0.0000',
    );

    let ordinary = await getOrdinarySummary(baseUrl, admin.token);
    assert.equal(ordinary.totalSalesAmountCents, 27000);
    assert.equal(ordinary.confirmedRefundAmountCents, 2000);
    assert.equal(ordinary.effectiveSalesAmountCents, 25000);

    let guideSummaries = await listGuideSummaries(baseUrl, admin.token);
    assert.equal(guideSummaries.length, 1);
    assertGuideAmounts(guideSummaries[0], {
      guideId: GUIDE_A_ID,
      orderCount: 1,
      sales: 3000,
      refund: 0,
      effective: 3000,
      net: 3000,
      daily: 1500,
      monthly: 0,
    });

    const secondSwitch = await switchDestination(
      baseUrl,
      admin.token,
      ORDER_B_ID,
      {
        personalAmountCents: 15000,
        guideId: GUIDE_B_ID,
        dailyRebateRate: '0.2500',
        monthlyRebateRate: '0.1000',
      },
    );
    assert.equal(secondSwitch.response.status, 200, bodyText(secondSwitch));

    ordinary = await getOrdinarySummary(baseUrl, admin.token);
    assert.equal(ordinary.travelGroupId, GROUP_ID);
    assert.equal(ordinary.totalSalesAmountCents, 12000);
    assert.equal(ordinary.confirmedRefundAmountCents, 2000);
    assert.equal(ordinary.effectiveSalesAmountCents, 10000);

    guideSummaries = await listGuideSummaries(baseUrl, admin.token);
    assert.equal(guideSummaries.length, 2);
    const guideB = guideSummaries.find(
      (summary) => summary.guideId === GUIDE_B_ID,
    );
    assertGuideAmounts(guideB, {
      guideId: GUIDE_B_ID,
      orderCount: 1,
      sales: 15000,
      refund: 0,
      effective: 15000,
      net: 15000,
      daily: 3750,
      monthly: 1500,
    });

    const guideBDetail = await getGuideSummary(
      baseUrl,
      admin.token,
      guideB.id,
    );
    assert.equal(guideBDetail.orders.length, 1);
    assert.deepEqual(
      pick(guideBDetail.orders[0], [
        'id',
        'orderNo',
        'customerName',
        'grossAmountCents',
        'confirmedRefundAmountCents',
        'effectiveAmountCents',
        'liquorCostDeductionCents',
        'netAmountCents',
        'guideId',
        'dailyRebateRate',
        'dailyPointsCents',
        'monthlyRebateRate',
        'monthlyPointsCents',
      ]),
      {
        id: ORDER_B_ID,
        orderNo: 'SO-GUIDE-POINTS-B',
        customerName: '个人积分客户乙',
        grossAmountCents: 15000,
        confirmedRefundAmountCents: 0,
        effectiveAmountCents: 15000,
        liquorCostDeductionCents: 0,
        netAmountCents: 15000,
        guideId: GUIDE_B_ID,
        dailyRebateRate: '0.2500',
        dailyPointsCents: 3750,
        monthlyRebateRate: '0.1000',
        monthlyPointsCents: 1500,
      },
    );

    const rateChange = await requestJson(
      baseUrl,
      `/api/guide-points-summaries/orders/${ORDER_B_ID}/rates`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          dailyRebateRate: '0.3333',
          monthlyRebateRate: '0.0000',
        },
      },
    );
    assert.equal(rateChange.response.status, 200, bodyText(rateChange));
    assert.equal(
      rateChange.body.data.guidePointsSummary.totalDailyPointsCents,
      5000,
    );
    assert.equal(
      rateChange.body.data.guidePointsSummary.totalMonthlyPointsCents,
      0,
    );

    const back = await switchDestination(
      baseUrl,
      admin.token,
      ORDER_B_ID,
      { personalAmountCents: 0 },
    );
    assert.equal(back.response.status, 200, bodyText(back));
    ordinary = await getOrdinarySummary(baseUrl, admin.token);
    assert.equal(ordinary.totalSalesAmountCents, 27000);
    assert.equal(ordinary.effectiveSalesAmountCents, 25000);

    const switchedOrder = await getOrder(
      baseUrl,
      admin.token,
      ORDER_B_ID,
    );
    assert.equal(switchedOrder.pointsDestination, 'TRAVEL_AGENCY');
    assert.equal(switchedOrder.personalAmountCents, 0);
    assert.equal(switchedOrder.normalAmountCents, 20000);
    assert.equal(switchedOrder.personalPointsGuideId, null);
    assert.equal(switchedOrder.personalDailyRebateRate, null);

    const logs = await listLogs(baseUrl, admin.token);
    const switchLog = logs.find(
      (log) =>
        log.entityId === ORDER_A_ID &&
        log.action ===
          'sales_orders.points_destination.guide_personal',
    );
    assert.ok(switchLog);
    assert.equal(
      switchLog.beforeData.pointsDestination,
      'TRAVEL_AGENCY',
    );
    assert.equal(
      switchLog.afterData.pointsDestination,
      'GUIDE_PERSONAL',
    );
    assert.equal(switchLog.afterData.personalPointsGuideId, GUIDE_A_ID);
    assert.equal(switchLog.beforeData.personalAmountCents, 0);
    assert.equal(switchLog.afterData.personalAmountCents, 3000);
    assert.equal(switchLog.afterData.normalAmountCents, 7000);
    assert.equal(
      switchLog.afterData.pointsDestinationChangedById,
      switchLog.userId,
    );
    assert.ok(switchLog.afterData.pointsDestinationChangedAt);
    assert.equal(
      switchLog.afterData.personalDailyRebateRate,
      '0.5000',
    );
  });
});

test('contract: final personal amount validates integer bounds and supports repeat changes, cancel, and legacy clients', async () => {
  await withGuidePointsServer(async (baseUrl) => {
    const admin = await login(baseUrl);
    for (const [personalAmountCents, code] of [
      [-1, 'PERSONAL_AMOUNT_OUT_OF_RANGE'],
      [10001, 'PERSONAL_AMOUNT_OUT_OF_RANGE'],
      [1.5, 'PERSONAL_AMOUNT_INVALID'],
      ['100', 'PERSONAL_AMOUNT_INVALID'],
    ]) {
      const invalid = await switchDestination(
        baseUrl,
        admin.token,
        ORDER_A_ID,
        { personalAmountCents, guideId: GUIDE_A_ID },
      );
      assertErrorContract(invalid, 400, code);
    }

    for (const personalAmountCents of [2500, 2500, 4000, 1000, 0]) {
      const result = await switchDestination(
        baseUrl,
        admin.token,
        ORDER_A_ID,
        {
          personalAmountCents,
          ...(personalAmountCents > 0 ? { guideId: GUIDE_A_ID } : {}),
        },
      );
      assert.equal(result.response.status, 200, bodyText(result));
      assert.equal(
        result.body.data.salesOrder.personalAmountCents,
        personalAmountCents,
      );
      assert.equal(
        result.body.data.salesOrder.normalAmountCents,
        10000 - personalAmountCents,
      );
    }

    const legacyPersonal = await switchDestination(
      baseUrl,
      admin.token,
      ORDER_A_ID,
      {
        pointsDestination: 'GUIDE_PERSONAL',
        guideId: GUIDE_A_ID,
      },
    );
    assert.equal(
      legacyPersonal.body.data.salesOrder.personalAmountCents,
      10000,
    );
    const legacyAgency = await switchDestination(
      baseUrl,
      admin.token,
      ORDER_A_ID,
      { pointsDestination: 'TRAVEL_AGENCY' },
    );
    assert.equal(
      legacyAgency.body.data.salesOrder.personalAmountCents,
      0,
    );

    const logs = (await listLogs(baseUrl, admin.token)).filter(
      (log) =>
        log.entityId === ORDER_A_ID &&
        String(log.action).startsWith(
          'sales_orders.points_destination.',
        ) &&
        log.beforeData &&
        log.afterData,
    );
    assert.ok(logs.length >= 6);
    for (const log of logs) {
      assert.equal(typeof log.beforeData.personalAmountCents, 'number');
      assert.equal(typeof log.beforeData.normalAmountCents, 'number');
      assert.equal(typeof log.afterData.personalAmountCents, 'number');
      assert.equal(typeof log.afterData.normalAmountCents, 'number');
    }
  });
});

test('contract: after-sales may view split fields but sales is desensitized and cannot modify', async () => {
  await withGuidePointsServer(async (baseUrl) => {
    const admin = await login(baseUrl);
    const afterSales = await login(
      baseUrl,
      'guide-points-after-sales',
      'Password123',
    );
    const hiddenActors = await Promise.all(
      [
        'guide-points-sales',
        'guide-points-front-desk',
        'guide-points-warehouse',
        'guide-points-taster',
      ].map((username) =>
        login(baseUrl, username, 'Password123'),
      ),
    );
    const changed = await switchDestination(
      baseUrl,
      admin.token,
      ORDER_A_ID,
      {
        personalAmountCents: 3000,
        guideId: GUIDE_A_ID,
      },
    );
    assert.equal(changed.response.status, 200, bodyText(changed));

    const afterSalesOrder = await getOrder(
      baseUrl,
      afterSales.token,
      ORDER_A_ID,
    );
    assert.equal(afterSalesOrder.personalAmountCents, 3000);
    assert.equal(afterSalesOrder.normalAmountCents, 7000);
    assert.equal(afterSalesOrder.pointsDestination, 'GUIDE_PERSONAL');

    for (const hiddenActor of hiddenActors) {
      const hiddenResult = await requestJson(
        baseUrl,
        `/api/sales-orders/${ORDER_A_ID}`,
        { token: hiddenActor.token },
      );
      if ([403, 404].includes(hiddenResult.response.status)) {
        continue;
      }
      assert.equal(
        hiddenResult.response.status,
        200,
        bodyText(hiddenResult),
      );
      const hiddenOrder = hiddenResult.body.data.salesOrder;
      for (const field of [
        'pointsDestination',
        'personalAmountCents',
        'normalAmountCents',
        'personalPointsGuideId',
        'personalGuideNameSnapshot',
        'personalDailyRebateRate',
        'personalMonthlyRebateRate',
        'pointsDestinationChangedById',
        'pointsDestinationChangedAt',
      ]) {
        assert.equal(
          Object.prototype.hasOwnProperty.call(hiddenOrder, field),
          false,
          field,
        );
      }
    }

    const denied = await switchDestination(
      baseUrl,
      afterSales.token,
      ORDER_A_ID,
      { personalAmountCents: 0 },
    );
    assertErrorContract(denied, 403, 'PERMISSION_DENIED');
  });
});

test('contract: paid states protect only the affected guide rate and boss remains read-only in guide table', async () => {
  await withGuidePointsServer(async (baseUrl) => {
    const admin = await login(baseUrl);
    const finance = await login(
      baseUrl,
      'guide-points-finance',
      'Password123',
    );
    const boss = await login(
      baseUrl,
      'guide-points-boss',
      'Password123',
    );
    const sales = await login(
      baseUrl,
      'guide-points-sales',
      'Password123',
    );

    const switched = await switchDestination(
      baseUrl,
      boss.token,
      ORDER_A_ID,
      {
        personalAmountCents: 10000,
        guideId: GUIDE_A_ID,
      },
    );
    assert.equal(switched.response.status, 200, bodyText(switched));

    const bossList = await listGuideSummaries(baseUrl, boss.token);
    assert.equal(bossList.length, 1);
    const summaryId = bossList[0].id;

    const bossRateDenied = await requestJson(
      baseUrl,
      `/api/guide-points-summaries/orders/${ORDER_A_ID}/rates`,
      {
        method: 'PATCH',
        token: boss.token,
        body: { dailyRebateRate: '0.4000' },
      },
    );
    assertErrorContract(bossRateDenied, 403, 'PERMISSION_DENIED');

    const salesSwitchDenied = await switchDestination(
      baseUrl,
      sales.token,
      ORDER_B_ID,
      {
        personalAmountCents: 20000,
        guideId: GUIDE_A_ID,
      },
    );
    assertErrorContract(salesSwitchDenied, 403, 'PERMISSION_DENIED');

    const paid = await setPaid(
      baseUrl,
      finance.token,
      summaryId,
      'daily',
      true,
    );
    assert.equal(paid.response.status, 200, bodyText(paid));

    const dailyDenied = await updateRates(
      baseUrl,
      finance.token,
      ORDER_A_ID,
      { dailyRebateRate: '0.4500' },
    );
    assertErrorContract(
      dailyDenied,
      409,
      'GUIDE_DAILY_POINTS_ALREADY_PAID',
    );

    const monthlyAllowed = await updateRates(
      baseUrl,
      finance.token,
      ORDER_A_ID,
      { monthlyRebateRate: '0.1000' },
    );
    assert.equal(monthlyAllowed.response.status, 200, bodyText(monthlyAllowed));

    const backDenied = await switchDestination(
      baseUrl,
      boss.token,
      ORDER_A_ID,
      { personalAmountCents: 0 },
    );
    assertErrorContract(
      backDenied,
      409,
      'GUIDE_POINTS_ALREADY_PAID',
    );

    const unpaid = await setPaid(
      baseUrl,
      finance.token,
      summaryId,
      'daily',
      false,
    );
    assert.equal(unpaid.response.status, 200, bodyText(unpaid));
    const backAllowed = await switchDestination(
      baseUrl,
      boss.token,
      ORDER_A_ID,
      { personalAmountCents: 0 },
    );
    assert.equal(backAllowed.response.status, 200, bodyText(backAllowed));
  });
});

test('contract: ordinary paid summary blocks transfer and injected summary failure rolls the transaction back', async () => {
  await withGuidePointsServer(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const blocked = await switchDestination(
        baseUrl,
        admin.token,
        ORDER_A_ID,
        {
          personalAmountCents: 10000,
          guideId: GUIDE_A_ID,
        },
      );
      assertErrorContract(
        blocked,
        409,
        'ORDINARY_POINTS_ALREADY_PAID',
      );
    },
    {
      travelGroupFinanceSummaries: [
        baseOrdinarySummary({ dailyRebatePaid: true }),
      ],
    },
  );

  await withGuidePointsServer(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const failed = await switchDestination(
        baseUrl,
        admin.token,
        ORDER_A_ID,
        {
          personalAmountCents: 10000,
          guideId: GUIDE_A_ID,
        },
      );
      assert.equal(failed.response.status, 500);

      const order = await getOrder(baseUrl, admin.token, ORDER_A_ID);
      assert.equal(order.pointsDestination, 'TRAVEL_AGENCY');
      assert.equal(order.personalPointsGuideId, null);
      const summaries = await listGuideSummaries(baseUrl, admin.token);
      assert.deepEqual(summaries, []);
    },
    { failGuidePointsSummaryCreateOnce: true },
  );
});

async function withGuidePointsServer(run, overrides = {}) {
  const prisma = {
    users: [
      user('usr-guide-finance', 'guide-points-finance', 'finance'),
      user('usr-guide-boss', 'guide-points-boss', 'boss'),
      user('usr-guide-sales', 'guide-points-sales', 'sales'),
      user(
        'usr-guide-after-sales',
        'guide-points-after-sales',
        'after_sales',
      ),
      user(
        'usr-guide-front-desk',
        'guide-points-front-desk',
        'front_desk',
      ),
      user(
        'usr-guide-warehouse',
        'guide-points-warehouse',
        'warehouse',
      ),
      user(
        'usr-guide-taster',
        'guide-points-taster',
        'taster',
      ),
    ],
    guides: [
      guide(GUIDE_A_ID, '收款导游甲', '13900000001'),
      guide(GUIDE_B_ID, '收款导游乙', '13900000002'),
    ],
    travelAgencies: [
      {
        id: 'agency-guide-points',
        name: '个人积分测试旅行社',
        isActive: true,
      },
    ],
    travelGroups: [
      {
        id: GROUP_ID,
        groupNo: 'TG-GUIDE-POINTS',
        visitDate: '2026-07-20',
        travelAgency: '个人积分测试旅行社',
        guideId: GUIDE_A_ID,
        guideName: '收款导游甲',
        guidePhone: '13900000001',
        tasterId: 'usr-guide-taster',
        tasterName: 'guide-points-taster',
        financeMark: true,
      },
    ],
    salesOrders: [
      order(ORDER_A_ID, 'SO-GUIDE-POINTS-A', 10000, '个人积分客户甲'),
      order(ORDER_B_ID, 'SO-GUIDE-POINTS-B', 20000, '个人积分客户乙'),
    ],
    afterSalesOrders: [
      {
        id: 'after-guide-points-b',
        afterSalesNo: 'AS-GUIDE-POINTS-B',
        salesOrderId: ORDER_B_ID,
        actionType: 'REFUND',
        status: 'REFUNDED',
        refundAmountCents: 2000,
        financeConfirmed: true,
        financeConfirmedAt: '2026-07-21T10:00:00.000Z',
        createdAt: '2026-07-21T09:00:00.000Z',
      },
    ],
    travelGroupFinanceSummaries: [baseOrdinarySummary()],
    ...overrides,
  };
  await withPhase1Server(run, { prisma });
}

function user(id, username, role) {
  return {
    id,
    name: username,
    username,
    password: 'Password123',
    role,
  };
}

function guide(id, name, phone) {
  return {
    id,
    name,
    phone,
    travelAgency: '个人积分测试旅行社',
    isActive: true,
  };
}

function order(id, orderNo, totalAmountCents, customerName) {
  return {
    id,
    orderNo,
    orderDate: '2026-07-20',
    orderType: 'TRAVEL_GROUP',
    travelGroupId: GROUP_ID,
    customerName,
    status: 'VALID',
    totalAmountCents,
    cashOnDeliveryAmountCents: 0,
    salesUserId: 'usr-guide-sales',
    pointsDestination: 'TRAVEL_AGENCY',
    personalAmountCents: 0,
    items: [
      {
        id: `${id}-item`,
        productName: '个人积分测试酒品',
        quantity: 1,
        unitPriceCents: totalAmountCents,
        subtotalCents: totalAmountCents,
      },
    ],
  };
}

function baseOrdinarySummary(overrides = {}) {
  return {
    id: 'ordinary-guide-points',
    travelGroupId: GROUP_ID,
    totalSalesAmountCents: 30000,
    confirmedRefundAmountCents: 2000,
    effectiveSalesAmountCents: 28000,
    totalAgencyNetAmountCents: 28000,
    ...overrides,
  };
}

async function switchDestination(baseUrl, token, orderId, body) {
  return requestJson(
    baseUrl,
    `/api/sales-orders/${orderId}/points-destination`,
    { method: 'PATCH', token, body },
  );
}

async function updateRates(baseUrl, token, orderId, body) {
  return requestJson(
    baseUrl,
    `/api/guide-points-summaries/orders/${orderId}/rates`,
    { method: 'PATCH', token, body },
  );
}

async function setPaid(baseUrl, token, id, type, isPaid) {
  return requestJson(
    baseUrl,
    `/api/guide-points-summaries/${id}/${type}-points-paid`,
    { method: 'PATCH', token, body: { isPaid } },
  );
}

async function getOrder(baseUrl, token, id) {
  const result = await requestJson(baseUrl, `/api/sales-orders/${id}`, {
    token,
  });
  assert.equal(result.response.status, 200, bodyText(result));
  return result.body.data.salesOrder;
}

async function getOrdinarySummary(baseUrl, token) {
  const result = await requestJson(
    baseUrl,
    `/api/travel-group-finance-summaries/${GROUP_ID}`,
    { token },
  );
  assert.equal(result.response.status, 200, bodyText(result));
  return result.body.data.travelGroupFinanceSummary;
}

async function listGuideSummaries(baseUrl, token) {
  const result = await requestJson(
    baseUrl,
    '/api/guide-points-summaries?limit=100',
    { token },
  );
  assert.equal(result.response.status, 200, bodyText(result));
  return result.body.data.guidePointsSummaries;
}

async function getGuideSummary(baseUrl, token, id) {
  const result = await requestJson(
    baseUrl,
    `/api/guide-points-summaries/${id}`,
    { token },
  );
  assert.equal(result.response.status, 200, bodyText(result));
  return result.body.data.guidePointsSummary;
}

async function listLogs(baseUrl, token) {
  const result = await requestJson(
    baseUrl,
    '/api/operation-logs?limit=200',
    { token },
  );
  assert.equal(result.response.status, 200, bodyText(result));
  return result.body.data.logs;
}

function assertGuideAmounts(summary, expected) {
  assert.ok(summary);
  assert.equal(summary.guideId, expected.guideId);
  assert.equal(summary.orderCount, expected.orderCount);
  assert.equal(summary.totalSalesAmountCents, expected.sales);
  assert.equal(summary.confirmedRefundAmountCents, expected.refund);
  assert.equal(summary.effectiveSalesAmountCents, expected.effective);
  assert.equal(summary.totalNetAmountCents, expected.net);
  assert.equal(summary.totalDailyPointsCents, expected.daily);
  assert.equal(summary.totalMonthlyPointsCents, expected.monthly);
}

function pick(value, fields) {
  return Object.fromEntries(fields.map((field) => [field, value[field]]));
}

function bodyText(result) {
  return JSON.stringify(result.body);
}
