const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

const PASSWORD = 'Password123';
const ENDPOINT =
  '/api/analytics/travel-group-profits?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-31';

test('contract: travel group profits enforce endpoint and menu role matrices', async () => {
  await withTravelGroupProfitServer(async (baseUrl) => {
    const anonymous = await requestJson(baseUrl, ENDPOINT);
    assertErrorContract(anonymous, 401, 'AUTH_TOKEN_REQUIRED');

    const admin = await login(baseUrl);
    const boss = await login(baseUrl, 'profit-boss', PASSWORD);
    const superAdmin = await login(
      baseUrl,
      'profit-super-admin',
      PASSWORD,
    );
    for (const session of [admin, boss, superAdmin]) {
      const result = await requestJson(baseUrl, ENDPOINT, {
        token: session.token,
      });
      assert.equal(result.response.status, 200);
      assert.equal(
        session.menus.some((menu) => menu.id === 'profit_analysis'),
        true,
      );
    }

    for (const role of [
      'finance',
      'sales',
      'front-desk',
      'warehouse',
      'after-sales',
      'taster',
    ]) {
      const session = await login(baseUrl, `profit-${role}`, PASSWORD);
      const denied = await requestJson(baseUrl, ENDPOINT, {
        token: session.token,
      });
      assertErrorContract(denied, 403, 'PERMISSION_DENIED');
      assert.equal(
        session.menus.some((menu) => menu.id === 'profit_analysis'),
        false,
      );
    }

    const finance = await login(baseUrl, 'profit-finance', PASSWORD);
    const existingProfit = await requestJson(
      baseUrl,
      '/api/analytics/profit-overview?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-31',
      { token: finance.token },
    );
    assert.equal(existingProfit.response.status, 200);
  });
});

test('contract: travel group profits aggregate, filter, sort, paginate, and return a whitelist DTO', async () => {
  await withTravelGroupProfitServer(async (baseUrl) => {
    const admin = await login(baseUrl);
    const result = await requestJson(baseUrl, ENDPOINT, {
      token: admin.token,
    });

    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body.data.range, {
      preset: 'custom',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });
    assert.equal(result.body.data.pagination.total, 6);
    assert.equal(result.body.data.items[0].groupNo, 'TG-UNMARKED');
    const complete = result.body.data.items.find(
      (item) => item.groupNo === 'TG-COMPLETE',
    );
    assert.equal(complete.orderCount, 1);
    assert.equal(complete.effectiveSalesAmountCents, 10000);
    assert.equal(complete.actualProductCostCents, 3000);
    assert.equal(complete.logisticsFeeCents, 500);
    assert.equal(complete.employeeCommissionCents, 600);
    assert.equal(complete.tasterCommissionCents, 400);
    assert.equal(complete.dailyAgencyRebateCents, 500);
    assert.equal(complete.monthlyAgencyRebateCents, 600);
    assert.equal(complete.totalExpenseCents, 5600);
    assert.equal(complete.estimatedProfitCents, 4400);
    assert.equal(complete.estimatedProfitRate, 0.44);
    assert.equal(complete.calculationStatus, 'complete');

    const incomplete = result.body.data.items.find(
      (item) => item.groupNo === 'TG-INCOMPLETE',
    );
    assert.equal(incomplete.calculationStatus, 'incomplete');
    assert.equal(incomplete.estimatedProfitCents, null);
    assert.equal(result.body.data.summary.incompleteGroupCount, 1);
    assert.equal(result.body.data.summary.estimatedProfitCents, null);
    assert.equal(result.body.data.summary.knownEstimatedProfitCents, 8600);

    const encoded = JSON.stringify(result.body.data);
    for (const forbiddenField of [
      'actualUnitCostCents',
      'actualCostSubtotalCents',
      'ruleSnapshot',
      'sourceSnapshot',
      'customerName',
      'customerPhone',
      'address',
      'targetUserId',
      'targetUser',
      'deductionAmountCents',
    ]) {
      assert.equal(encoded.includes(forbiddenField), false, forbiddenField);
    }

    const searched = await requestJson(
      baseUrl,
      `${ENDPOINT}&query=Agency%20Incomplete`,
      { token: admin.token },
    );
    assert.equal(searched.response.status, 200);
    assert.deepEqual(
      searched.body.data.items.map((item) => item.groupNo),
      ['TG-INCOMPLETE'],
    );

    const statusFiltered = await requestJson(
      baseUrl,
      `${ENDPOINT}&status=estimated`,
      { token: admin.token },
    );
    assert.deepEqual(
      statusFiltered.body.data.items.map((item) => item.groupNo),
      ['TG-ESTIMATED'],
    );

    const sortedAndPaged = await requestJson(
      baseUrl,
      `${ENDPOINT}&sortBy=effectiveSalesAmountCents&sortDirection=asc&page=2&pageSize=1`,
      { token: admin.token },
    );
    assert.equal(sortedAndPaged.body.data.pagination.page, 2);
    assert.equal(sortedAndPaged.body.data.pagination.pageSize, 1);
    assert.equal(sortedAndPaged.body.data.items.length, 1);
    assert.equal(
      sortedAndPaged.body.data.items[0].effectiveSalesAmountCents,
      1000,
    );
  });
});

test('contract: travel group profit scope uses visit date and global marks', async () => {
  await withTravelGroupProfitServer(async (baseUrl) => {
    const boss = await login(baseUrl, 'profit-boss', PASSWORD);
    const open = await requestJson(baseUrl, ENDPOINT, { token: boss.token });
    assert.equal(open.response.status, 200);
    assert.equal(open.body.data.pagination.total, 6);
    assert.ok(
      open.body.data.items.some((item) => item.groupNo === 'TG-COMPLETE'),
      'order outside the travel-group date range must still be included',
    );

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
    assert.equal(markedOnly.response.status, 200);
    assert.equal(markedOnly.body.data.pagination.total, 5);
    assert.equal(
      markedOnly.body.data.items.some(
        (item) => item.groupNo === 'TG-UNMARKED',
      ),
      false,
    );
  });
});

function withTravelGroupProfitServer(run) {
  return withPhase1Server(run, {
    prisma: {
      users: [
        user('profit-super-admin', 'super_admin'),
        user('profit-boss', 'boss'),
        user('profit-finance', 'finance'),
        user('profit-sales', 'sales'),
        user('profit-front-desk', 'front_desk'),
        user('profit-warehouse', 'warehouse'),
        user('profit-after-sales', 'after_sales'),
        user('profit-taster', 'taster'),
      ],
      customers: [
        {
          id: 'profit-customer-marked',
          name: 'Sensitive Customer',
          phone: '13900000000',
          address: 'Sensitive Address',
          financeMark: true,
        },
      ],
      travelGroups: [
        group('complete', 'TG-COMPLETE', '2026-07-10', true, 'Agency Complete'),
        group(
          'estimated',
          'TG-ESTIMATED',
          '2026-07-11',
          true,
          'Agency Estimated',
        ),
        group(
          'incomplete',
          'TG-INCOMPLETE',
          '2026-07-12',
          true,
          'Agency Incomplete',
        ),
        group('loss', 'TG-LOSS', '2026-07-13', true, 'Agency Loss'),
        group(
          'no-sales',
          'TG-NO-SALES',
          '2026-07-14',
          true,
          'Agency Empty',
        ),
        group(
          'unmarked',
          'TG-UNMARKED',
          '2026-07-15',
          false,
          'Agency Hidden',
        ),
        group(
          'outside',
          'TG-OUTSIDE',
          '2026-08-01',
          true,
          'Agency Outside',
        ),
      ],
      salesOrders: [
        order('complete', '2026-06-01', 10000, 500, [
          line('complete', 10000, 3000),
        ]),
        order('estimated', '2026-08-01', 8000, 0, [
          line('estimated', 8000, 3000),
        ]),
        order('incomplete', '2026-07-12', 6000, 0, [
          line('incomplete-covered', 3000, 1000),
          line('incomplete-missing', 3000, null),
        ]),
        order('loss', '2026-07-13', 1000, 500, [
          line('loss', 1000, 900),
        ]),
        {
          ...order('no-sales', '2026-07-14', 5000, 0, [
            line('no-sales', 5000, 1000),
          ]),
          status: 'CANCELLED',
        },
        order('unmarked', '2026-07-15', 2000, 0, [
          line('unmarked', 2000, 500),
        ]),
        order('outside', '2026-08-01', 9999, 0, [
          line('outside', 9999, 1),
        ]),
      ],
      afterSalesOrders: [
        {
          id: 'refund-estimated-confirmed',
          afterSalesNo: 'AS-ESTIMATED-CONFIRMED',
          salesOrderId: 'order-estimated',
          customerId: 'profit-customer-marked',
          issueType: 'OTHER',
          actionType: 'REFUND',
          description: 'confirmed refund without item return quantities',
          refundAmountCents: 1000,
          status: 'COMPLETED',
          financeConfirmed: true,
          createdAt: '2026-07-11T08:00:00.000Z',
        },
        {
          id: 'refund-estimated-pending',
          afterSalesNo: 'AS-ESTIMATED-PENDING',
          salesOrderId: 'order-estimated',
          customerId: 'profit-customer-marked',
          issueType: 'OTHER',
          actionType: 'REFUND',
          description: 'pending refund',
          refundAmountCents: 200,
          status: 'WAITING_REFUND',
          financeConfirmed: false,
          createdAt: '2026-07-11T09:00:00.000Z',
        },
      ],
      commissionRecords: [
        commission('complete', 'SALES_COMMISSION', 100),
        commission('complete', 'OUTREACH_COMMISSION', 200),
        commission('complete', 'LEADER_COMMISSION', 300),
        commission('complete', 'TASTER_COMMISSION', 400),
        {
          ...commission('estimated', 'AGENCY_DAILY_REBATE', 0),
          pointsCents: 100,
        },
        {
          ...commission('estimated', 'AGENCY_MONTHLY_REBATE', 0),
          pointsCents: 200,
        },
        commission('loss', 'SALES_COMMISSION', 300),
      ],
      travelGroupFinanceSummaries: [
        financeSummary('complete', 500, 600),
        financeSummary('incomplete', 0, 0),
        financeSummary('loss', 200, 100),
        financeSummary('unmarked', 0, 0),
      ],
    },
  });
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

function group(id, groupNo, visitDate, financeMark, travelAgency) {
  return {
    id: `group-${id}`,
    groupNo,
    visitDate,
    travelAgency,
    guideName: `Guide ${id}`,
    tasterName: `Taster ${id}`,
    guestCount: 10,
    financeMark,
  };
}

function order(id, orderDate, totalAmountCents, logisticsFeeCents, items) {
  return {
    id: `order-${id}`,
    orderNo: `SO-${id}`,
    orderDate,
    travelGroupId: `group-${id}`,
    customerId: 'profit-customer-marked',
    customerName: 'Sensitive Customer',
    customerPhone: '13900000000',
    status: id === 'estimated' ? 'PARTIAL_REFUND' : 'VALID',
    totalAmountCents,
    logisticsFeeCents,
    items,
  };
}

function line(id, subtotalCents, actualCostSubtotalCents) {
  return {
    id: `line-${id}`,
    productId: `product-${id}`,
    productName: `Product ${id}`,
    quantity: 1,
    unitPriceCents: subtotalCents,
    subtotalCents,
    actualUnitCostCents: actualCostSubtotalCents,
    actualCostSubtotalCents,
    grossProfitCents:
      actualCostSubtotalCents == null
        ? null
        : subtotalCents - actualCostSubtotalCents,
    deliveryType: 'SHIPPING',
  };
}

function commission(id, targetType, amountCents) {
  return {
    id: `commission-${id}-${targetType}`,
    salesOrderId: `order-${id}`,
    travelGroupId: `group-${id}`,
    targetType,
    targetUserId: 'sensitive-user-id',
    amountCents,
    pointsCents: 0,
    deductionAmountCents: 9999,
    ruleSnapshot: { sensitive: true },
    sourceSnapshot: { sensitive: true },
  };
}

function financeSummary(id, totalDailyRebateCents, totalMonthlyRebateCents) {
  return {
    id: `finance-summary-${id}`,
    travelGroupId: `group-${id}`,
    totalDailyRebateCents,
    totalMonthlyRebateCents,
    sourceSnapshot: { sensitive: true },
  };
}
