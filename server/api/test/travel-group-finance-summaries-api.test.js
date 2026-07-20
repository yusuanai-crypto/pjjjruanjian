const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  assertOperationLogContract,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

test('contract: stage7 travel group finance summaries list and detail expose safe summary fields', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);

    const list = await requestJson(
      baseUrl,
      '/api/travel-group-finance-summaries?query=TG-STAGE7-SUMMARY-MARKED&dateFrom=2026-07-20&dateTo=2026-07-20&limit=10',
      {
        token: admin.token,
      },
    );
    assert.equal(list.response.status, 200);
    assert.deepEqual(summaryIds(list.body.data.travelGroupFinanceSummaries), [
      'summary-stage7-marked',
    ]);
    const listed = list.body.data.travelGroupFinanceSummaries[0];
    assert.equal(listed.travelGroup.groupNo, 'TG-STAGE7-SUMMARY-MARKED');
    assert.equal(listed.travelGroup.licensePlate, '贵A-STAGE7');
    assert.equal(listed.travelGroup.guestCount, 20);
    assert.equal(listed.totalSalesAmountCents, 100000);
    assert.equal(listed.totalCashOnDeliveryCents, 20000);
    assert.equal(listed.totalPaidDepositCents, 80000);
    assert.equal(listed.confirmedRefundAmountCents, 20000);
    assert.equal(listed.effectiveSalesAmountCents, 80000);
    assert.equal(listed.totalAgencyDeductionCents, 10000);
    assert.equal(listed.totalAgencyNetAmountCents, 90000);
    assert.equal(listed.paidDailyRebateCents, 0);
    assert.equal(listed.unpaidDailyRebateCents, 3000);
    assert.equal(listed.paidMonthlyRebateCents, 0);
    assert.equal(listed.unpaidMonthlyRebateCents, 2000);

    const detail = await requestJson(
      baseUrl,
      '/api/travel-group-finance-summaries/tg-stage7-summary-marked',
      {
        token: admin.token,
      },
    );
    assert.equal(detail.response.status, 200);
    const summary = detail.body.data.travelGroupFinanceSummary;
    assert.equal(summary.id, 'summary-stage7-marked');
    assert.equal(summary.paidDailyRebateCents, 0);
    assert.equal(summary.unpaidDailyRebateCents, 3000);
    assert.equal(summary.paidMonthlyRebateCents, 0);
    assert.equal(summary.unpaidMonthlyRebateCents, 2000);
    assert.equal(summary.sourceSnapshot.amounts.totalSalesAmountCents, 100000);
    assert.equal(summary.sourceSnapshot.orders[0].orderNo, 'SO-STAGE7-SUMMARY-MARKED');
    assert.equal(summary.sourceSnapshot.orders[0].itemCount, 1);
    assert.equal(summary.sourceSnapshot.travelGroup.guidePhone, undefined);
    assert.equal(summary.sourceSnapshot.unsafeToken, undefined);
    assert.equal(summary.sourceSnapshot.password, undefined);
    assert.equal(JSON.stringify(summary.sourceSnapshot).includes('secret-token'), false);
    assert.equal(JSON.stringify(summary.sourceSnapshot).includes('Password123'), false);
  }, {
    prisma: buildTravelGroupFinanceSummaryApiPrisma(),
  });
});

test('contract: stage7 travel group finance summary updates notes and rebate payment status', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const finance = await login(
      baseUrl,
      'stage7-summary-finance',
      'Password123',
    );

    const invalid = await requestJson(
      baseUrl,
      '/api/travel-group-finance-summaries/tg-stage7-summary-marked',
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          paidRebateCents: -1,
        },
      },
    );
    assertErrorContract(invalid, 400, 'VALIDATION_FAILED');

    const invalidSplit = await requestJson(
      baseUrl,
      '/api/travel-group-finance-summaries/tg-stage7-summary-marked',
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          paidDailyRebateCents: 3000,
          unpaidMonthlyRebateCents: 0,
        },
      },
    );
    assertErrorContract(invalidSplit, 400, 'VALIDATION_FAILED');

    const updated = await requestJson(
      baseUrl,
      '/api/travel-group-finance-summaries/tg-stage7-summary-marked',
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          notes: 'stage7 summary api update test',
          guideInfoSent: true,
          travelAgencyInfoSent: true,
        },
      },
    );
    assert.equal(updated.response.status, 200);
    const summary = updated.body.data.travelGroupFinanceSummary;
    assert.equal(summary.paidRebateCents, 0);
    assert.equal(summary.unpaidRebateCents, 5000);
    assert.equal(summary.paidDailyRebateCents, 0);
    assert.equal(summary.unpaidDailyRebateCents, 3000);
    assert.equal(summary.paidMonthlyRebateCents, 0);
    assert.equal(summary.unpaidMonthlyRebateCents, 2000);
    assert.equal(summary.notes, 'stage7 summary api update test');
    assert.equal(summary.guideInfoSent, true);
    assert.equal(summary.travelAgencyInfoSent, true);

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=travel_group_finance_summaries.update',
      {
        token: admin.token,
      },
    );
    assert.equal(logs.response.status, 200);
    const log = logs.body.data.logs.find(
      (item) => item.entityId === 'summary-stage7-marked',
    );
    assert.ok(log);
    assertStage7ApiLog(log, {
      action: 'travel_group_finance_summaries.update',
      entityType: 'travel_group_finance_summary',
      userId: finance.user.id,
    });
    assert.equal(log.beforeData.notes, 'stage7 summary api smoke note');
    assert.equal(log.afterData.notes, 'stage7 summary api update test');
    assert.equal('sourceSnapshot' in log.afterData, false);

    const dailyPaid = await requestJson(
      baseUrl,
      '/api/travel-group-finance-summaries/tg-stage7-summary-marked/daily-rebate-paid',
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          isPaid: true,
        },
      },
    );
    assert.equal(dailyPaid.response.status, 200);
    const dailySummary = dailyPaid.body.data.travelGroupFinanceSummary;
    assert.equal(dailySummary.dailyRebatePaid, true);
    assert.equal(dailySummary.dailyRebatePaidById, finance.user.id);
    assert.equal(typeof dailySummary.dailyRebatePaidAt, 'string');
    assert.equal(dailySummary.paidRebateCents, 3000);
    assert.equal(dailySummary.unpaidRebateCents, 2000);
    assert.equal(dailySummary.paidDailyRebateCents, 3000);
    assert.equal(dailySummary.unpaidDailyRebateCents, 0);
    assert.equal(dailySummary.paidMonthlyRebateCents, 0);
    assert.equal(dailySummary.unpaidMonthlyRebateCents, 2000);

    const monthlyPaid = await requestJson(
      baseUrl,
      '/api/travel-group-finance-summaries/tg-stage7-summary-marked/monthly-rebate-paid',
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          isPaid: true,
        },
      },
    );
    assert.equal(monthlyPaid.response.status, 200);
    assert.equal(
      monthlyPaid.body.data.travelGroupFinanceSummary.monthlyRebatePaid,
      true,
    );
    assert.equal(
      monthlyPaid.body.data.travelGroupFinanceSummary.paidRebateCents,
      5000,
    );
    assert.equal(
      monthlyPaid.body.data.travelGroupFinanceSummary.unpaidRebateCents,
      0,
    );
    assert.equal(
      monthlyPaid.body.data.travelGroupFinanceSummary.paidDailyRebateCents,
      3000,
    );
    assert.equal(
      monthlyPaid.body.data.travelGroupFinanceSummary.unpaidDailyRebateCents,
      0,
    );
    assert.equal(
      monthlyPaid.body.data.travelGroupFinanceSummary.paidMonthlyRebateCents,
      2000,
    );
    assert.equal(
      monthlyPaid.body.data.travelGroupFinanceSummary.unpaidMonthlyRebateCents,
      0,
    );

    const cancelled = await requestJson(
      baseUrl,
      '/api/travel-group-finance-summaries/tg-stage7-summary-marked/daily-rebate-paid',
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          isPaid: false,
        },
      },
    );
    assert.equal(cancelled.response.status, 200);
    assert.equal(
      cancelled.body.data.travelGroupFinanceSummary.dailyRebatePaid,
      false,
    );
    assert.equal(
      cancelled.body.data.travelGroupFinanceSummary.dailyRebatePaidById,
      null,
    );
    assert.equal(
      cancelled.body.data.travelGroupFinanceSummary.paidRebateCents,
      2000,
    );
    assert.equal(
      cancelled.body.data.travelGroupFinanceSummary.unpaidRebateCents,
      3000,
    );
    assert.equal(
      cancelled.body.data.travelGroupFinanceSummary.paidDailyRebateCents,
      0,
    );
    assert.equal(
      cancelled.body.data.travelGroupFinanceSummary.unpaidDailyRebateCents,
      3000,
    );
    assert.equal(
      cancelled.body.data.travelGroupFinanceSummary.paidMonthlyRebateCents,
      2000,
    );
    assert.equal(
      cancelled.body.data.travelGroupFinanceSummary.unpaidMonthlyRebateCents,
      0,
    );

    const paymentLogs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=travel_group_finance_summaries.daily_rebate_payment.enable',
      {
        token: admin.token,
      },
    );
    assert.equal(paymentLogs.response.status, 200);
    const paymentLog = paymentLogs.body.data.logs.find(
      (item) => item.entityId === 'summary-stage7-marked',
    );
    assert.ok(paymentLog);
    assertStage7ApiLog(paymentLog, {
      action: 'travel_group_finance_summaries.daily_rebate_payment.enable',
      entityType: 'travel_group_finance_summary',
      userId: finance.user.id,
    });
    assert.equal(paymentLog.beforeData.dailyRebatePaid, false);
    assert.equal(paymentLog.afterData.dailyRebatePaid, true);
  }, {
    prisma: buildTravelGroupFinanceSummaryApiPrisma(),
  });
});

test('contract: stage7 travel group finance summary confirms and cancels agency deduction', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const finance = await login(
      baseUrl,
      'stage7-summary-finance',
      'Password123',
    );

    const confirmed = await requestJson(
      baseUrl,
      '/api/travel-group-finance-summaries/tg-stage7-summary-marked/agency-deduction-confirm',
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          isConfirmed: true,
        },
      },
    );
    assert.equal(confirmed.response.status, 200);
    assert.equal(
      confirmed.body.data.travelGroupFinanceSummary.agencyDeductionConfirmed,
      true,
    );
    assert.equal(
      confirmed.body.data.travelGroupFinanceSummary.agencyDeductionConfirmedById,
      finance.user.id,
    );
    assert.equal(
      typeof confirmed.body.data.travelGroupFinanceSummary.agencyDeductionConfirmedAt,
      'string',
    );

    const cancelled = await requestJson(
      baseUrl,
      '/api/travel-group-finance-summaries/tg-stage7-summary-marked/agency-deduction-confirm',
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          isConfirmed: false,
        },
      },
    );
    assert.equal(cancelled.response.status, 200);
    assert.equal(
      cancelled.body.data.travelGroupFinanceSummary.agencyDeductionConfirmed,
      false,
    );
    assert.equal(
      cancelled.body.data.travelGroupFinanceSummary.agencyDeductionConfirmedById,
      null,
    );
    assert.equal(
      cancelled.body.data.travelGroupFinanceSummary.agencyDeductionConfirmedAt,
      null,
    );

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=travel_group_finance_summaries.agency_deduction_confirm.enable',
      {
        token: admin.token,
      },
    );
    assert.equal(logs.response.status, 200);
    const enableLog = logs.body.data.logs.find(
      (log) => log.entityId === 'summary-stage7-marked',
    );
    assert.ok(enableLog);
    assertStage7ApiLog(enableLog, {
      action: 'travel_group_finance_summaries.agency_deduction_confirm.enable',
      entityType: 'travel_group_finance_summary',
      userId: finance.user.id,
    });
    assert.equal(enableLog.beforeData.agencyDeductionConfirmed, false);
    assert.equal(enableLog.afterData.agencyDeductionConfirmed, true);

    const disableLogs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=travel_group_finance_summaries.agency_deduction_confirm.disable',
      {
        token: admin.token,
      },
    );
    assert.equal(disableLogs.response.status, 200);
    const disableLog = disableLogs.body.data.logs.find(
      (log) => log.entityId === 'summary-stage7-marked',
    );
    assert.ok(disableLog);
    assertStage7ApiLog(disableLog, {
      action: 'travel_group_finance_summaries.agency_deduction_confirm.disable',
      entityType: 'travel_group_finance_summary',
      userId: finance.user.id,
    });
    assert.equal(disableLog.beforeData.agencyDeductionConfirmed, true);
    assert.equal(disableLog.afterData.agencyDeductionConfirmed, false);
  }, {
    prisma: buildTravelGroupFinanceSummaryApiPrisma(),
  });
});

test('contract: stage7 travel group finance summary refresh creates calculated summary', async () => {
  await withPhase1Server(async (baseUrl) => {
    const finance = await login(
      baseUrl,
      'stage7-summary-finance',
      'Password123',
    );

    const refreshed = await requestJson(
      baseUrl,
      '/api/travel-group-finance-summaries/tg-stage7-summary-refresh/refresh',
      {
        method: 'POST',
        token: finance.token,
      },
    );

    assert.equal(refreshed.response.status, 201);
    assert.equal(refreshed.body.data.amountChanged, true);
    const summary = refreshed.body.data.travelGroupFinanceSummary;
    assert.equal(summary.travelGroupId, 'tg-stage7-summary-refresh');
    assert.equal(summary.totalSalesAmountCents, 100000);
    assert.equal(summary.totalCashOnDeliveryCents, 0);
    assert.equal(summary.totalPaidDepositCents, 100000);
    assert.equal(summary.confirmedRefundAmountCents, 20000);
    assert.equal(summary.effectiveSalesAmountCents, 80000);
    assert.equal(summary.totalAgencyDeductionCents, 10000);
    assert.equal(summary.totalAgencyNetAmountCents, 90000);
    assert.equal(summary.totalDailyRebateCents, 3000);
    assert.equal(summary.totalMonthlyRebateCents, 3000);
    assert.equal(summary.unpaidRebateCents, 6000);
    assert.equal(summary.paidDailyRebateCents, 0);
    assert.equal(summary.unpaidDailyRebateCents, 3000);
    assert.equal(summary.paidMonthlyRebateCents, 0);
    assert.equal(summary.unpaidMonthlyRebateCents, 3000);
  }, {
    prisma: buildTravelGroupFinanceSummaryApiPrisma(),
  });
});

test('contract: stage7 travel group finance summaries enforce permissions', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const finance = await login(
      baseUrl,
      'stage7-summary-finance',
      'Password123',
    );
    const boss = await login(baseUrl, 'stage7-summary-boss', 'Password123');

    for (const session of [admin, finance, boss]) {
      for (const pathName of [
        '/api/travel-group-finance-summaries',
        '/api/travel-group-finance-summaries/tg-stage7-summary-marked',
      ]) {
        const allowed = await requestJson(baseUrl, pathName, {
          token: session.token,
        });
        assert.equal(allowed.response.status, 200);
      }
      const exportStatus = await requestStatus(
        baseUrl,
        '/api/travel-group-finance-summaries/export?limit=20',
        {
          token: session.token,
        },
      );
      assert.equal(exportStatus, 200);
    }

    const writePaths = [
      {
        pathName: '/api/travel-group-finance-summaries/tg-stage7-summary-marked',
        method: 'PATCH',
        body: {
          notes: 'boss should not edit',
        },
      },
      {
        pathName:
          '/api/travel-group-finance-summaries/tg-stage7-summary-marked/daily-rebate-paid',
        method: 'PATCH',
        body: {
          isPaid: true,
        },
      },
      {
        pathName:
          '/api/travel-group-finance-summaries/tg-stage7-summary-marked/monthly-rebate-paid',
        method: 'PATCH',
        body: {
          isPaid: true,
        },
      },
      {
        pathName:
          '/api/travel-group-finance-summaries/tg-stage7-summary-marked/agency-deduction-confirm',
        method: 'PATCH',
        body: {
          isConfirmed: true,
        },
      },
      {
        pathName:
          '/api/travel-group-finance-summaries/tg-stage7-summary-refresh/refresh',
        method: 'POST',
        body: {},
      },
    ];
    for (const writeCase of writePaths) {
      const bossWrite = await requestJson(baseUrl, writeCase.pathName, {
        method: writeCase.method,
        token: boss.token,
        body: writeCase.body,
      });
      assertErrorContract(bossWrite, 403, 'PERMISSION_DENIED');
    }

    for (const username of [
      'stage7-summary-sales',
      'stage7-summary-warehouse',
      'stage7-summary-after-sales',
      'stage7-summary-front-desk',
      'stage7-summary-taster',
    ]) {
      const session = await login(baseUrl, username, 'Password123');
      for (const pathName of [
        '/api/travel-group-finance-summaries',
        '/api/travel-group-finance-summaries/tg-stage7-summary-marked',
        '/api/travel-group-finance-summaries/export',
      ]) {
        const denied = await requestJson(baseUrl, pathName, {
          token: session.token,
        });
        assertErrorContract(denied, 403, 'PERMISSION_DENIED');
      }
      for (const writeCase of writePaths) {
        const denied = await requestJson(baseUrl, writeCase.pathName, {
          method: writeCase.method,
          token: session.token,
          body: writeCase.body,
        });
        assertErrorContract(denied, 403, 'PERMISSION_DENIED');
      }
    }
  }, {
    prisma: buildTravelGroupFinanceSummaryApiPrisma(),
  });
});

test('contract: stage7 travel group finance summaries obey global mark filtering', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const boss = await login(baseUrl, 'stage7-summary-boss', 'Password123');

    const openList = await requestJson(
      baseUrl,
      '/api/travel-group-finance-summaries?limit=20',
      {
        token: boss.token,
      },
    );
    assert.equal(openList.response.status, 200);
    assert.deepEqual(summaryIds(openList.body.data.travelGroupFinanceSummaries), [
      'summary-stage7-marked',
      'summary-stage7-unmarked',
    ]);

    const openHiddenDetail = await requestJson(
      baseUrl,
      '/api/travel-group-finance-summaries/tg-stage7-summary-unmarked',
      {
        token: boss.token,
      },
    );
    assert.equal(openHiddenDetail.response.status, 200);

    const enabled = await requestJson(
      baseUrl,
      '/api/settings/global-mark-query/enable',
      {
        method: 'POST',
        token: admin.token,
      },
    );
    assert.equal(enabled.response.status, 200);

    const list = await requestJson(
      baseUrl,
      '/api/travel-group-finance-summaries?limit=20',
      {
        token: boss.token,
      },
    );
    assert.equal(list.response.status, 200);
    assert.deepEqual(summaryIds(list.body.data.travelGroupFinanceSummaries), [
      'summary-stage7-marked',
    ]);

    const hidden = await requestJson(
      baseUrl,
      '/api/travel-group-finance-summaries/tg-stage7-summary-unmarked',
      {
        token: boss.token,
      },
    );
    assertErrorContract(
      hidden,
      404,
      'TRAVEL_GROUP_FINANCE_SUMMARY_NOT_FOUND',
    );
  }, {
    prisma: buildTravelGroupFinanceSummaryApiPrisma(),
  });
});

function assertStage7ApiLog(log, expected) {
  assertOperationLogContract(log);
  assert.equal(log.action, expected.action);
  assert.equal(log.entityType, expected.entityType);
  assert.equal(log.userId, expected.userId);
  assert.equal(typeof log.entityId, 'string');
  assert.equal(typeof log.ipAddress, 'string');
  assert.ok(log.ipAddress.length > 0);
  const serialized = JSON.stringify(log);
  assert.equal(/Password123|secret-token|DATABASE_URL/i.test(serialized), false);
}

function summaryIds(summaries) {
  return summaries.map((summary) => summary.id).sort();
}

async function requestStatus(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  await response.arrayBuffer();
  return response.status;
}

function buildTravelGroupFinanceSummaryApiPrisma() {
  return {
    users: [
      user('usr-stage7-summary-finance', 'stage7-summary-finance', 'finance'),
      user('usr-stage7-summary-boss', 'stage7-summary-boss', 'boss'),
      user('usr-stage7-summary-sales', 'stage7-summary-sales', 'sales'),
      user('usr-stage7-summary-warehouse', 'stage7-summary-warehouse', 'warehouse'),
      user(
        'usr-stage7-summary-after-sales',
        'stage7-summary-after-sales',
        'after_sales',
      ),
      user(
        'usr-stage7-summary-front-desk',
        'stage7-summary-front-desk',
        'front_desk',
      ),
      user('usr-stage7-summary-taster', 'stage7-summary-taster', 'taster'),
    ],
    travelGroups: [
      travelGroup({
        id: 'tg-stage7-summary-marked',
        groupNo: 'TG-STAGE7-SUMMARY-MARKED',
        visitDate: '2026-07-20',
        financeMark: true,
      }),
      travelGroup({
        id: 'tg-stage7-summary-unmarked',
        groupNo: 'TG-STAGE7-SUMMARY-UNMARKED',
        visitDate: '2026-07-21',
        financeMark: false,
      }),
      travelGroup({
        id: 'tg-stage7-summary-refresh',
        groupNo: 'TG-STAGE7-SUMMARY-REFRESH',
        visitDate: '2026-07-22',
        financeMark: true,
      }),
    ],
    salesOrders: [
      {
        id: 'so-stage7-summary-refresh',
        orderNo: 'SO-STAGE7-SUMMARY-REFRESH',
        travelGroupId: 'tg-stage7-summary-refresh',
        customerName: 'Stage7 Summary Refresh Customer',
        orderDate: '2026-07-22',
        totalAmountCents: 100000,
        status: 'VALID',
        items: [
          {
            id: 'item-stage7-summary-refresh',
            productName: 'stage7 summary api sauce',
            quantity: 1,
            unitPriceCents: 100000,
            subtotalCents: 100000,
            sortOrder: 1,
          },
        ],
      },
    ],
    afterSalesOrders: [
      {
        id: 'as-stage7-summary-refresh',
        afterSalesNo: 'AS-STAGE7-SUMMARY-REFRESH',
        salesOrderId: 'so-stage7-summary-refresh',
        actionType: 'REFUND',
        refundAmountCents: 20000,
        financeConfirmed: true,
        financeConfirmedById: 'usr-stage7-summary-finance',
        financeConfirmedAt: '2026-07-23T10:00:00.000Z',
      },
    ],
    commissionRecords: [
      agencyRebateRecord({
        id: 'rec-stage7-summary-refresh-daily',
        salesOrderId: 'so-stage7-summary-refresh',
        travelGroupId: 'tg-stage7-summary-refresh',
        targetType: 'AGENCY_DAILY_REBATE',
        baseAmountCents: 70000,
        deductionAmountCents: 10000,
        pointsCents: 2100,
      }),
      agencyRebateRecord({
        id: 'rec-stage7-summary-refresh-monthly',
        salesOrderId: 'so-stage7-summary-refresh',
        travelGroupId: 'tg-stage7-summary-refresh',
        targetType: 'AGENCY_MONTHLY_REBATE',
        baseAmountCents: 70000,
        deductionAmountCents: 10000,
        pointsCents: 1400,
      }),
    ],
    travelGroupFinanceSummaries: [
      summaryRecord({
        id: 'summary-stage7-marked',
        travelGroupId: 'tg-stage7-summary-marked',
      }),
      summaryRecord({
        id: 'summary-stage7-unmarked',
        travelGroupId: 'tg-stage7-summary-unmarked',
        totalSalesAmountCents: 50000,
        sourceSnapshot: {
          calculationVersion: 'stage7_v1',
          travelGroup: {
            id: 'tg-stage7-summary-unmarked',
            groupNo: 'TG-STAGE7-SUMMARY-UNMARKED',
          },
          amounts: {
            totalSalesAmountCents: 50000,
          },
        },
      }),
    ],
  };
}

function user(id, username, role) {
  return {
    id,
    username,
    name: `Stage7 Summary ${role}`,
    password: 'Password123',
    role,
  };
}

function travelGroup(overrides) {
  return {
    travelAgency: 'Stage7 Summary Agency',
    guideName: 'Stage7 Summary Guide',
    guidePhone: '10000000009',
    licensePlate: '贵A-STAGE7',
    guestCount: 20,
    tasterName: 'Stage7 Summary Taster',
    guideInfoSent: false,
    travelAgencyInfoSent: false,
    ...overrides,
  };
}

function summaryRecord(overrides = {}) {
  return {
    totalSalesAmountCents: 100000,
    totalCashOnDeliveryCents: 20000,
    totalPaidDepositCents: 80000,
    confirmedRefundAmountCents: 20000,
    effectiveSalesAmountCents: 80000,
    totalAgencyDeductionCents: 10000,
    agencyDeductionConfirmed: false,
    totalAgencyNetAmountCents: 90000,
    totalDailyRebateCents: 3000,
    totalMonthlyRebateCents: 2000,
    paidRebateCents: 0,
    unpaidRebateCents: 5000,
    dailyRebatePaid: false,
    dailyRebatePaidById: null,
    dailyRebatePaidAt: null,
    monthlyRebatePaid: false,
    monthlyRebatePaidById: null,
    monthlyRebatePaidAt: null,
    notes: 'stage7 summary api smoke note',
    guideInfoSent: false,
    travelAgencyInfoSent: false,
    calculationVersion: 'stage7_v1',
    sourceSnapshot: {
      calculationVersion: 'stage7_v1',
      travelGroup: {
        id: 'tg-stage7-summary-marked',
        groupNo: 'TG-STAGE7-SUMMARY-MARKED',
        guidePhone: '10000000009',
        travelAgency: 'Stage7 Summary Agency',
      },
      orders: [
        {
          id: 'so-stage7-summary-marked',
          orderNo: 'SO-STAGE7-SUMMARY-MARKED',
          orderDate: '2026-07-20',
          status: 'VALID',
          totalAmountCents: 100000,
          confirmedRefundAmountCents: 20000,
          effectiveAmountCents: 80000,
          items: [
            {
              id: 'item-stage7-summary-marked',
              productName: 'stage7 summary api sauce',
            },
          ],
        },
      ],
      amounts: {
        totalSalesAmountCents: 100000,
        confirmedRefundAmountCents: 20000,
      },
      confirmedRefunds: [],
      unconfirmedRefundSummary: {
        count: 0,
        refundAmountCents: 0,
      },
      agencyRebateRecords: {
        daily: [{ id: 'rec-stage7-summary-daily' }],
        monthly: [{ id: 'rec-stage7-summary-monthly' }],
        perOrderForDeductionAndNet: [],
      },
      ruleSummary: {
        agencyRebateRules: [{ id: 'rule-stage7-summary-rebate' }],
      },
      unsafeToken: 'secret-token',
      password: 'Password123',
    },
    ...overrides,
  };
}

function agencyRebateRecord(overrides) {
  return {
    targetType: 'AGENCY_DAILY_REBATE',
    agencyName: 'Stage7 Summary Agency',
    grossAmountCents: 100000,
    confirmedRefundAmountCents: 20000,
    baseAmountCents: 70000,
    deductionAmountCents: 10000,
    rateSnapshot: '0.0300',
    pointsCents: 0,
    amountCents: 0,
    calculationVersion: 'stage7_v1',
    ruleSnapshot: {
      agencyRebateRules: { id: 'rule-stage7-summary-rebate' },
      agencyDeductionRules: [
        { id: 'rule-stage7-summary-deduction', productName: 'stage7 summary api sauce' },
      ],
    },
    sourceSnapshot: {
      salesOrder: { id: overrides.salesOrderId },
    },
    ...overrides,
  };
}
