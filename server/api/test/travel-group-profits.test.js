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
    const warehouse = await login(baseUrl, 'profit-warehouse', PASSWORD);
    for (const session of [admin, boss, superAdmin, warehouse]) {
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

test('contract: travel group profit recalculation enforces finance permission and is idempotent', async () => {
  await withTravelGroupProfitServer(async (baseUrl) => {
    const finance = await login(baseUrl, 'profit-finance', PASSWORD);
    const warehouse = await login(baseUrl, 'profit-warehouse', PASSWORD);
    const admin = await login(baseUrl);
    const endpoint =
      '/api/analytics/travel-group-profits/group-complete/recalculate';

    const denied = await requestJson(baseUrl, endpoint, {
      method: 'POST',
      token: warehouse.token,
      body: {},
    });
    assertErrorContract(denied, 403, 'PERMISSION_DENIED');

    const first = await requestJson(baseUrl, endpoint, {
      method: 'POST',
      token: finance.token,
      body: {},
    });
    assert.equal(first.response.status, 200, JSON.stringify(first.body));
    assert.equal(
      first.body.data.successCount,
      1,
      JSON.stringify(first.body.data),
    );
    assert.equal(first.body.data.failureCount, 0);
    assert.equal(first.body.data.changedCount, 1);
    assert.equal(first.body.data.profit.travelGroupId, 'group-complete');
    assert.ok(first.body.data.profit.components.salesCommission);

    const second = await requestJson(baseUrl, endpoint, {
      method: 'POST',
      token: finance.token,
      body: {},
    });
    assert.equal(second.response.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.data.successCount, 1);
    assert.equal(second.body.data.failureCount, 0);
    assert.equal(second.body.data.changedCount, 0);
    assert.equal(second.body.data.unchangedCount, 1);

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=analytics.travel_group_profit.recalculate',
      { token: admin.token },
    );
    assert.equal(logs.response.status, 200);
    assert.equal(logs.body.data.logs.length, 2);
  });
});

test('contract: recalculation safely repairs only missing fee snapshots and stays idempotent', async () => {
  await withTravelGroupProfitServer(async (baseUrl) => {
    const finance = await login(baseUrl, 'profit-finance', PASSWORD);
    const endpoint =
      '/api/analytics/travel-group-profits/group-incomplete/recalculate';

    const first = await requestJson(baseUrl, endpoint, {
      method: 'POST',
      token: finance.token,
      body: {},
    });
    assert.equal(first.response.status, 200, JSON.stringify(first.body));
    assert.equal(
      first.body.data.successCount,
      1,
      JSON.stringify(first.body.data),
    );
    assert.equal(first.body.data.failureCount, 0);
    assert.ok(first.body.data.changedCount > 0);
    assert.equal(first.body.data.profit.taxFeeCents, 60);
    assert.equal(first.body.data.profit.paymentServiceFeeCents, 36);

    const second = await requestJson(baseUrl, endpoint, {
      method: 'POST',
      token: finance.token,
      body: {},
    });
    assert.equal(second.response.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.data.successCount, 1);
    assert.equal(second.body.data.failureCount, 0);
    assert.equal(second.body.data.changedCount, 0);
    assert.equal(second.body.data.unchangedCount, 1);
  });
});

test('contract: recalculation preserves partial success and reports an all-failed group per order', async () => {
  await withRecalculationOutcomeServer(async (baseUrl) => {
    const finance = await login(baseUrl, 'profit-finance', PASSWORD);

    const partial = await requestJson(
      baseUrl,
      '/api/analytics/travel-group-profits/group-mixed/recalculate',
      { method: 'POST', token: finance.token, body: {} },
    );
    assert.equal(partial.response.status, 200, JSON.stringify(partial.body));
    assert.equal(partial.body.data.successCount, 1);
    assert.equal(partial.body.data.failureCount, 1);
    assert.equal(partial.body.data.results.length, 2);
    assert.ok(
      partial.body.data.issues.some(
        (issue) =>
          issue.orderNo === 'SO-mixed-failure' &&
          issue.code === 'ORDER_NOT_FINANCE_MARKED',
      ),
    );

    const failed = await requestJson(
      baseUrl,
      '/api/analytics/travel-group-profits/group-failed/recalculate',
      { method: 'POST', token: finance.token, body: {} },
    );
    assert.equal(failed.response.status, 200, JSON.stringify(failed.body));
    assert.equal(failed.body.data.successCount, 0);
    assert.equal(failed.body.data.failureCount, 1);
    assert.equal(failed.body.data.results[0].success, false);
    assert.deepEqual(
      failed.body.data.results[0].issues.map((issue) => issue.code),
      ['ORDER_NOT_FINANCE_MARKED'],
    );
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
    assert.equal(result.body.data.pagination.total, 7);
    assert.equal(result.body.data.items[0].groupNo, 'TG-CROSS-DAY');
    const complete = result.body.data.items.find(
      (item) => item.groupNo === 'TG-COMPLETE',
    );
    assert.equal(complete.orderCount, 1);
    assert.equal(complete.effectiveSalesAmountCents, 10000);
    assert.equal(complete.actualProductCostCents, 3000);
    assert.equal(complete.logisticsFeeCents, 500);
    assert.equal(complete.parkingFeeCents, 500);
    assert.equal(complete.cigaretteFeeCents, 200);
    assert.equal(complete.salesCommissionCents, 100);
    assert.equal(complete.outreachCommissionCents, 200);
    assert.equal(complete.leaderCommissionCents, 300);
    assert.equal(complete.employeeCommissionCents, 600);
    assert.equal(complete.tasterCommissionCents, 400);
    assert.equal(complete.dailyAgencyRebateCents, 500);
    assert.equal(complete.monthlyAgencyRebateCents, 600);
    assert.equal(complete.taxFeeCents, 100);
    assert.equal(complete.paymentServiceFeeCents, 76);
    assert.equal(complete.totalExpenseCents, 6476);
    assert.equal(complete.estimatedProfitCents, 3524);
    assert.equal(complete.estimatedProfitRate, 0.3524);
    assert.equal(complete.calculationStatus, 'complete');
    assert.deepEqual(complete.paymentMethodFeeBreakdown, [
      {
        paymentMethodId: 'payment-method-wallet',
        paymentMethodNameSnapshot: '收钱吧',
        serviceFeeRateSnapshot: '0.006000',
        originalPaymentAmountCents: 6000,
        sameDayRefundAmountCents: 0,
        serviceFeeBaseAmountCents: 6000,
        serviceFeeCents: 36,
        orderCount: 1,
      },
      {
        paymentMethodId: 'payment-method-card',
        paymentMethodNameSnapshot: '银行卡',
        serviceFeeRateSnapshot: '0.010000',
        originalPaymentAmountCents: 4000,
        sameDayRefundAmountCents: 0,
        serviceFeeBaseAmountCents: 4000,
        serviceFeeCents: 40,
        orderCount: 1,
      },
    ]);

    const estimated = result.body.data.items.find(
      (item) => item.groupNo === 'TG-ESTIMATED',
    );
    assert.equal(estimated.taxFeeCents, 70);
    assert.equal(estimated.paymentServiceFeeCents, 42);
    assert.equal(
      estimated.paymentMethodFeeBreakdown[0].sameDayRefundAmountCents,
      1000,
    );
    assert.equal(
      estimated.paymentMethodFeeBreakdown[0].serviceFeeBaseAmountCents,
      7000,
    );

    const crossDay = result.body.data.items.find(
      (item) => item.groupNo === 'TG-CROSS-DAY',
    );
    assert.equal(crossDay.effectiveSalesAmountCents, 0);
    assert.equal(crossDay.taxFeeCents, 0);
    assert.equal(crossDay.paymentServiceFeeCents, 60);
    assert.equal(
      crossDay.paymentMethodFeeBreakdown[0].sameDayRefundAmountCents,
      0,
    );
    assert.equal(
      crossDay.paymentMethodFeeBreakdown[0].serviceFeeBaseAmountCents,
      10000,
    );

    const incomplete = result.body.data.items.find(
      (item) => item.groupNo === 'TG-INCOMPLETE',
    );
    assert.equal(incomplete.calculationStatus, 'incomplete');
    assert.equal(incomplete.cigaretteFeeCents, null);
    assert.equal(incomplete.estimatedProfitCents, null);
    assert.ok(
      incomplete.warnings.some(
        (warning) => warning.code === 'CIGARETTE_FEE_MISSING',
      ),
    );
    assert.equal(incomplete.taxFeeCents, null);
    assert.equal(incomplete.paymentServiceFeeCents, null);
    assert.ok(
      incomplete.warnings.some(
        (warning) =>
          warning.code === 'PAYMENT_SERVICE_FEE_SNAPSHOT_MISSING',
      ),
    );
    assert.equal(result.body.data.summary.incompleteGroupCount, 3);
    assert.equal(result.body.data.summary.estimatedProfitCents, null);
    assert.equal(result.body.data.summary.knownEstimatedProfitCents, 4952);
    assert.equal(result.body.data.summary.taxFeeCents, null);
    assert.equal(
      result.body.data.summary.paymentServiceFeeCents,
      null,
    );

    const unmarked = result.body.data.items.find(
      (item) => item.groupNo === 'TG-UNMARKED',
    );
    assert.equal(unmarked.effectiveSalesAmountCents, 2000);
    assert.equal(unmarked.taxFeeCents, null);
    assert.equal(unmarked.paymentServiceFeeCents, null);
    assert.ok(
      unmarked.warnings.some(
        (warning) => warning.code === 'ORDER_NOT_FINANCE_MARKED',
      ),
    );

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
      'orderTaxAndServiceFees',
      'paymentDetailIds',
      'refundPaymentDetailId',
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
      `${ENDPOINT}&sortBy=effectiveSalesAmountCents&sortDirection=asc&page=3&pageSize=1`,
      { token: admin.token },
    );
    assert.equal(sortedAndPaged.body.data.pagination.page, 3);
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
    assert.equal(open.body.data.pagination.total, 7);
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
    assert.equal(markedOnly.body.data.pagination.total, 6);
    assert.equal(
      markedOnly.body.data.items.some(
        (item) => item.groupNo === 'TG-UNMARKED',
      ),
      false,
    );
  });
});

test('contract: travel group profit export reuses filters and sort without pagination, writes three safe worksheets and logs the action', async () => {
  await withTravelGroupProfitServer(async (baseUrl) => {
    const admin = await login(baseUrl);
    const finance = await login(
      baseUrl,
      'profit-finance',
      PASSWORD,
    );
    const warehouse = await login(baseUrl, 'profit-warehouse', PASSWORD);
    const exportPath =
      '/api/analytics/travel-group-profits/export?' +
      'preset=custom&dateFrom=2026-07-01&dateTo=2026-07-31' +
      '&sortBy=visitDate&sortDirection=desc&page=1&pageSize=1';

    const anonymous = await fetch(`${baseUrl}${exportPath}`);
    assert.equal(anonymous.status, 401);
    const denied = await fetch(`${baseUrl}${exportPath}`, {
      headers: {
        authorization: `Bearer ${finance.token}`,
      },
    });
    assert.equal(denied.status, 403);

    const response = await fetch(`${baseUrl}${exportPath}`, {
      headers: {
        authorization: `Bearer ${warehouse.token}`,
      },
    });
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get('content-type') || '',
      /spreadsheetml\.sheet/,
    );
    assert.match(
      response.headers.get('content-disposition') || '',
      /travel-group-profits-2026-07-01-2026-07-31\.xlsx/,
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    assert.deepEqual(
      workbook.worksheets.map((sheet) => sheet.name),
      ['旅行团利润', '订单税费手续费', '付款方式手续费明细'],
    );
    const groupSheet = workbook.getWorksheet('旅行团利润');
    const orderSheet = workbook.getWorksheet('订单税费手续费');
    const paymentSheet = workbook.getWorksheet('付款方式手续费明细');
    assert.equal(groupSheet.actualRowCount, 8);
    assert.equal(
      groupSheet.getCell(2, 1).value,
      'TG-CROSS-DAY',
      'export must preserve page sorting while ignoring pageSize=1',
    );
    assert.equal(orderSheet.actualRowCount, 7);
    assert.equal(paymentSheet.actualRowCount, 6);

    const groupRows = readWorksheetRows(groupSheet);
    const complete = groupRows.find((row) => row['团号'] === 'TG-COMPLETE');
    assert.equal(complete['税费（元）'], 1);
    assert.equal(complete['付款手续费（元）'], 0.76);
    const paymentRows = readWorksheetRows(paymentSheet);
    const estimatedWallet = paymentRows.find(
      (row) =>
        row['团号'] === 'TG-ESTIMATED' &&
        row['付款方式名称快照'] === '收钱吧',
    );
    assert.equal(estimatedWallet['当天退款（元）'], 10);
    assert.equal(estimatedWallet['手续费基数（元）'], 70);

    const workbookText = JSON.stringify(
      workbook.worksheets.flatMap((sheet) =>
        sheet.getSheetValues(),
      ),
    );
    for (const privateValue of [
      'Sensitive Customer',
      '13900000000',
      'Sensitive Address',
      'sensitive-user-id',
      'ruleSnapshot',
      'sourceSnapshot',
    ]) {
      assert.equal(workbookText.includes(privateValue), false, privateValue);
    }

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=analytics.travel_group_profit.export',
      { token: admin.token },
    );
    assert.equal(logs.response.status, 200);
    assert.equal(logs.body.data.logs.length, 1);
    assert.equal(logs.body.data.logs[0].afterData.rowCount, 18);
    assert.deepEqual(logs.body.data.logs[0].afterData.rowCounts, {
      travelGroups: 7,
      orders: 6,
      paymentMethods: 5,
    });
    assert.equal(
      'page' in logs.body.data.logs[0].afterData.filters,
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
      commissionRules: [
        employeeRule('profit-sales-rule', 'SALES_COMMISSION', '0.010000'),
        employeeRule(
          'profit-outreach-rule',
          'OUTREACH_COMMISSION',
          '0.020000',
        ),
        employeeRule('profit-leader-rule', 'LEADER_COMMISSION', '0.030000'),
      ],
      paymentMethods: [
        {
          id: 'payment-method-wallet',
          name: '收钱吧',
          category: 'ONLINE_PAYMENT',
          serviceFeeRate: '0.006000',
          isActive: true,
        },
        {
          id: 'payment-method-card',
          name: '银行卡',
          category: 'BANK_TRANSFER',
          serviceFeeRate: '0.010000',
          isActive: true,
        },
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
          'cross-day',
          'TG-CROSS-DAY',
          '2026-07-16',
          true,
          'Agency Cross Day',
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
        order('cross-day', '2026-07-16', 10000, 0, [
          line('cross-day', 10000, 3000),
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
          refundPaymentDetailId: 'payment-estimated-wallet',
          refundPaymentMethodNameSnapshot: '收钱吧',
          refundOccurredAt: '2026-08-01T12:00:00.000Z',
          deductsPaymentServiceFee: true,
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
        {
          id: 'refund-cross-day-confirmed',
          afterSalesNo: 'AS-CROSS-DAY-CONFIRMED',
          salesOrderId: 'order-cross-day',
          customerId: 'profit-customer-marked',
          issueType: 'OTHER',
          actionType: 'REFUND',
          description: 'full cross-day refund keeps service fee',
          refundAmountCents: 10000,
          status: 'COMPLETED',
          financeConfirmed: true,
          refundPaymentDetailId: null,
          refundPaymentMethodNameSnapshot: null,
          refundOccurredAt: '2026-07-16T16:00:00.000Z',
          deductsPaymentServiceFee: false,
          createdAt: '2026-07-16T16:00:00.000Z',
        },
      ],
      commissionRecords: [
        commission('complete', 'SALES_COMMISSION', 100),
        commission('complete', 'OUTREACH_COMMISSION', 200),
        commission('complete', 'LEADER_COMMISSION', 300),
        commission('complete', 'TASTER_COMMISSION', 400),
        commission('estimated', 'SALES_COMMISSION', 0),
        commission('estimated', 'OUTREACH_COMMISSION', 0),
        commission('estimated', 'LEADER_COMMISSION', 0),
        {
          ...commission('estimated', 'AGENCY_DAILY_REBATE', 0),
          pointsCents: 100,
        },
        {
          ...commission('estimated', 'AGENCY_MONTHLY_REBATE', 0),
          pointsCents: 200,
        },
        commission('loss', 'SALES_COMMISSION', 300),
        commission('loss', 'OUTREACH_COMMISSION', 0),
        commission('loss', 'LEADER_COMMISSION', 0),
      ],
      travelGroupFinanceSummaries: [
        financeSummary('complete', 500, 600),
        financeSummary('incomplete', 0, 0),
        financeSummary('loss', 200, 100),
        financeSummary('unmarked', 0, 0),
        financeSummary('cross-day', 0, 0),
      ],
    },
  });
}

function withRecalculationOutcomeServer(run) {
  const markedOrder = {
    ...order('mixed-success', '2026-07-20', 3000, 0, [
      line('mixed-success', 3000, 1000),
    ]),
    travelGroupId: 'group-mixed',
    financeMark: true,
    taxRateSnapshot: '0.010000',
    paymentDetails: [
      payment(
        'payment-mixed-success',
        'payment-method-wallet',
        '收钱吧',
        3000,
        '0.006000',
      ),
    ],
  };
  const unmarkedOrder = (id, travelGroupId, amountCents) => ({
    ...order(id, '2026-07-20', amountCents, 0, [
      line(id, amountCents, 500),
    ]),
    travelGroupId,
    financeMark: false,
    taxRateSnapshot: null,
    paymentDetails: [],
  });
  return withPhase1Server(run, {
    prisma: {
      users: [
        user('profit-super-admin', 'super_admin'),
        user('profit-finance', 'finance'),
      ],
      commissionRules: [
        employeeRule('profit-sales-rule', 'SALES_COMMISSION', '0.010000'),
        employeeRule(
          'profit-outreach-rule',
          'OUTREACH_COMMISSION',
          '0.020000',
        ),
        employeeRule('profit-leader-rule', 'LEADER_COMMISSION', '0.030000'),
      ],
      paymentMethods: [
        {
          id: 'payment-method-wallet',
          name: '收钱吧',
          category: 'ONLINE_PAYMENT',
          serviceFeeRate: '0.006000',
          isActive: true,
        },
      ],
      customers: [
        {
          id: 'profit-customer-marked',
          name: 'Recalculation Customer',
          financeMark: true,
        },
      ],
      travelGroups: [
        group('mixed', 'TG-MIXED', '2026-07-20', true, 'Agency Mixed'),
        group('failed', 'TG-FAILED', '2026-07-20', true, 'Agency Failed'),
      ],
      salesOrders: [
        markedOrder,
        unmarkedOrder('mixed-failure', 'group-mixed', 2000),
        unmarkedOrder('failed', 'group-failed', 1000),
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

function employeeRule(id, targetType, rate) {
  return {
    id,
    ruleName: id,
    targetType,
    rate,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    isActive: true,
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
    parkingFeeCents: 500,
    cigaretteFeeCents: id === 'incomplete' ? null : 200,
  };
}

function order(id, orderDate, totalAmountCents, logisticsFeeCents, items) {
  const financeMark = [
    'complete',
    'estimated',
    'incomplete',
    'cross-day',
  ].includes(id);
  const paymentDetails =
    id === 'complete'
      ? [
          payment(
            'payment-complete-wallet',
            'payment-method-wallet',
            '收钱吧',
            6000,
            '0.006000',
          ),
          payment(
            'payment-complete-card',
            'payment-method-card',
            '银行卡',
            4000,
            '0.010000',
          ),
        ]
      : id === 'estimated'
        ? [
            payment(
              'payment-estimated-wallet',
              'payment-method-wallet',
              '收钱吧',
              8000,
              '0.006000',
            ),
          ]
        : id === 'incomplete'
          ? [
              payment(
                'payment-incomplete-wallet',
                'payment-method-wallet',
                '收钱吧',
                6000,
                null,
              ),
            ]
          : id === 'cross-day'
            ? [
                payment(
                  'payment-cross-day-wallet',
                  'payment-method-wallet',
                  '收钱吧',
                  10000,
                  '0.006000',
                ),
              ]
            : [];
  return {
    id: `order-${id}`,
    orderNo: `SO-${id}`,
    orderDate,
    travelGroupId: `group-${id}`,
    customerId: 'profit-customer-marked',
    customerName: 'Sensitive Customer',
    customerPhone: '13900000000',
    salesUserId: 'usr-profit-super-admin',
    status: id === 'estimated' ? 'PARTIAL_REFUND' : 'VALID',
    totalAmountCents,
    logisticsFeeCents,
    financeMark,
    taxRateSnapshot:
      id === 'incomplete'
        ? null
        : financeMark
          ? '0.010000'
          : null,
    paymentDetails,
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
    commissionRuleId: targetType.endsWith('_COMMISSION')
      ? `rule-${id}-${targetType}`
      : null,
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

function payment(
  id,
  paymentMethodId,
  paymentMethodNameSnapshot,
  amountCents,
  serviceFeeRateSnapshot,
) {
  return {
    id,
    paymentMethodId,
    paymentMethodNameSnapshot,
    amountCents,
    serviceFeeRateSnapshot,
    serviceFeeBaseAmountSnapshotCents: amountCents,
  };
}

function readWorksheetRows(sheet) {
  const headers = sheet.getRow(1).values.slice(1).map(String);
  const rows = [];
  for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
    const values = sheet.getRow(rowNumber).values.slice(1);
    rows.push(
      Object.fromEntries(
        headers.map((header, index) => [
          header,
          values[index] ?? '',
        ]),
      ),
    );
  }
  return rows;
}
