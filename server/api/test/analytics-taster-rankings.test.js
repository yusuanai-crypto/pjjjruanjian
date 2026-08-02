const assert = require('node:assert/strict');
const test = require('node:test');

const ExcelJS = require('exceljs');

const {
  assertErrorContract,
  assertOperationLogContract,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

const UNASSIGNED_TASTER_NAME = '\u672a\u5206\u914d\u54c1\u9274\u5e08';
const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

test('contract: analytics taster rankings enforces role permissions', async () => {
  await withPhase1Server(async (baseUrl) => {
    const missingToken = await requestJson(
      baseUrl,
      '/api/analytics/taster-rankings',
    );
    assertErrorContract(missingToken, 401, 'AUTH_TOKEN_REQUIRED');

    for (const username of [
      'admin',
      'stage8-ranking-boss',
      'stage8-ranking-finance',
      'stage8-ranking-warehouse',
      'stage8-ranking-after-sales',
    ]) {
      const session =
        username === 'admin'
          ? await login(baseUrl)
          : await login(baseUrl, username, 'Password123');
      const allowed = await requestJson(
        baseUrl,
        '/api/analytics/taster-rankings?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04',
        {
          token: session.token,
        },
      );
      assert.equal(allowed.response.status, 200);
      assertRankingsContract(allowed.body.data);
    }

    for (const username of [
      'stage8-ranking-sales',
      'stage8-ranking-front-desk',
      'stage8-ranking-taster',
    ]) {
      const session = await login(baseUrl, username, 'Password123');
      const denied = await requestJson(
        baseUrl,
        '/api/analytics/taster-rankings',
        {
          token: session.token,
        },
      );
      assertErrorContract(denied, 403, 'PERMISSION_DENIED');
    }
  }, {
    prisma: buildAnalyticsTasterRankingPrisma(),
  });
});

test('contract: analytics taster rankings calculates and sorts by net sales by default', async () => {
  await withPhase1Server(async (baseUrl) => {
    const boss = await login(baseUrl, 'stage8-ranking-boss', 'Password123');
    const result = await requestJson(
      baseUrl,
      '/api/analytics/taster-rankings?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04',
      {
        token: boss.token,
      },
    );

    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body.data.range, {
      preset: 'custom',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-04',
      timezone: 'Asia/Shanghai',
    });
    assertRankingsContract(result.body.data);
    assert.deepEqual(
      result.body.data.rankings.map((row) => row.tasterId),
      ['taster-a', 'taster-b', null, 'taster-c'],
    );

    const [tasterA, tasterB, unassigned, tasterC] =
      result.body.data.rankings;
    assert.deepEqual(pickRankingMetrics(tasterA), {
      rank: 1,
      totalGroupCount: 2,
      totalGuestCount: 30,
      grossSalesAmountCents: 100000,
      refundAmountCents: 10000,
      netSalesAmountCents: 90000,
      averageSalesPerGroupCents: 45000,
      averageSalesPerGuestCents: 3000,
      noEffectiveOrderGroupCount: 1,
      conversionGroupCount: 1,
      noOrderRate: 0.5,
      conversionRate: 0.5,
    });
    assert.deepEqual(warningCodes(tasterA), ['pending_refund']);

    assert.deepEqual(pickRankingMetrics(tasterB), {
      rank: 2,
      totalGroupCount: 1,
      totalGuestCount: 30,
      grossSalesAmountCents: 60000,
      refundAmountCents: 0,
      netSalesAmountCents: 60000,
      averageSalesPerGroupCents: 60000,
      averageSalesPerGuestCents: 2000,
      noEffectiveOrderGroupCount: 0,
      conversionGroupCount: 1,
      noOrderRate: 0,
      conversionRate: 1,
    });
    assert.deepEqual(tasterB.warnings, []);

    assert.equal(unassigned.tasterName, UNASSIGNED_TASTER_NAME);
    assert.deepEqual(pickRankingMetrics(unassigned), {
      rank: 3,
      totalGroupCount: 1,
      totalGuestCount: 5,
      grossSalesAmountCents: 20000,
      refundAmountCents: 0,
      netSalesAmountCents: 20000,
      averageSalesPerGroupCents: 20000,
      averageSalesPerGuestCents: 4000,
      noEffectiveOrderGroupCount: 0,
      conversionGroupCount: 1,
      noOrderRate: 0,
      conversionRate: 1,
    });
    assert.deepEqual(warningCodes(unassigned), ['missing_taster']);

    assert.deepEqual(pickRankingMetrics(tasterC), {
      rank: 4,
      totalGroupCount: 1,
      totalGuestCount: 10,
      grossSalesAmountCents: 0,
      refundAmountCents: 0,
      netSalesAmountCents: 0,
      averageSalesPerGroupCents: 0,
      averageSalesPerGuestCents: 0,
      noEffectiveOrderGroupCount: 1,
      conversionGroupCount: 0,
      noOrderRate: 1,
      conversionRate: 0,
    });
    assert.deepEqual(tasterC.warnings, []);

    const filtered = await requestJson(
      baseUrl,
      '/api/analytics/taster-rankings?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04&groupType=retail&travelAgency=Ranking%20Agency%20A&sortBy=totalGroupCount&limit=1',
      {
        token: boss.token,
      },
    );
    assert.equal(filtered.response.status, 200);
    assert.equal(filtered.body.data.rankings.length, 1);
    assert.equal(filtered.body.data.rankings[0].tasterId, 'taster-a');
    assert.equal(filtered.body.data.rankings[0].totalGroupCount, 2);
    assert.equal(filtered.body.data.rankings[0].netSalesAmountCents, 90000);
  }, {
    prisma: buildAnalyticsTasterRankingPrisma(),
  });
});

test('contract: analytics taster rankings supports ranking sort fields', async () => {
  await withPhase1Server(async (baseUrl) => {
    const boss = await login(baseUrl, 'stage8-ranking-boss', 'Password123');
    const cases = [
      {
        query: 'sortBy=netSalesAmountCents&sortDirection=desc',
        expectedFirstTasterId: 'taster-a',
      },
      {
        query: 'sortBy=totalGroupCount&sortDirection=desc',
        expectedFirstTasterId: 'taster-a',
      },
      {
        query: 'sortBy=totalGuestCount&sortDirection=desc',
        expectedFirstTasterId: 'taster-a',
      },
      {
        query: 'sortBy=averageSalesPerGroupCents&sortDirection=desc',
        expectedFirstTasterId: 'taster-b',
      },
      {
        query: 'sortBy=averageSalesPerGuestCents&sortDirection=desc',
        expectedFirstTasterId: null,
      },
      {
        query: 'sortBy=noOrderRate&sortDirection=desc',
        expectedFirstTasterId: 'taster-c',
        expectedSecondTasterId: 'taster-a',
      },
    ];

    for (const item of cases) {
      const result = await requestJson(
        baseUrl,
        `/api/analytics/taster-rankings?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04&${item.query}`,
        {
          token: boss.token,
        },
      );
      assert.equal(result.response.status, 200);
      assert.equal(
        result.body.data.rankings[0].tasterId,
        item.expectedFirstTasterId,
      );
      assert.equal(result.body.data.rankings[0].rank, 1);
      if (item.expectedSecondTasterId !== undefined) {
        assert.equal(
          result.body.data.rankings[1].tasterId,
          item.expectedSecondTasterId,
        );
        assert.equal(result.body.data.rankings[1].rank, 2);
      }
    }
  }, {
    prisma: buildAnalyticsTasterRankingPrisma(),
  });
});

test('contract: analytics taster rankings obeys global mark filtering', async () => {
  await withPhase1Server(async (baseUrl) => {
    const boss = await login(baseUrl, 'stage8-ranking-boss', 'Password123');

    const open = await requestJson(
      baseUrl,
      '/api/analytics/taster-rankings?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04',
      {
        token: boss.token,
      },
    );
    assert.equal(open.response.status, 200);
    assert.equal(open.body.data.rankings.length, 2);
    assert.equal(rowByTasterId(open.body.data.rankings, 'taster-a').netSalesAmountCents, 30000);
    assert.equal(rowByTasterId(open.body.data.rankings, 'taster-b').netSalesAmountCents, 30000);

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
      '/api/analytics/taster-rankings?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04',
      {
        token: boss.token,
      },
    );
    assert.equal(markedOnly.response.status, 200);
    assert.equal(markedOnly.body.data.rankings.length, 1);
    assert.equal(markedOnly.body.data.rankings[0].tasterId, 'taster-a');
    assert.equal(markedOnly.body.data.rankings[0].totalGroupCount, 1);
    assert.equal(markedOnly.body.data.rankings[0].netSalesAmountCents, 10000);
    assert.equal(markedOnly.body.data.rankings[0].noOrderRate, 0);
  }, {
    prisma: buildAnalyticsTasterRankingMarkPrisma(),
  });
});

test('contract: analytics taster ranking detail traces source records', async () => {
  await withPhase1Server(async (baseUrl) => {
    const boss = await login(baseUrl, 'stage8-ranking-boss', 'Password123');
    const detail = await requestJson(
      baseUrl,
      '/api/analytics/taster-rankings/taster-a?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04',
      {
        token: boss.token,
      },
    );

    assert.equal(detail.response.status, 200);
    assert.deepEqual(Object.keys(detail.body.data).sort(), [
      'afterSalesOrders',
      'orders',
      'range',
      'summary',
      'taster',
      'travelGroups',
      'warnings',
    ]);
    assert.deepEqual(detail.body.data.taster, {
      id: 'taster-a',
      name: 'Taster A',
    });
    assert.equal(detail.body.data.summary.rank, 1);
    assert.equal(detail.body.data.summary.netSalesAmountCents, 90000);
    assert.equal(detail.body.data.summary.totalGroupCount, 2);
    assert.deepEqual(
      detail.body.data.travelGroups.map((group) => group.id),
      ['group-a1', 'group-a2'],
    );
    assert.deepEqual(
      detail.body.data.orders.map((order) => order.id),
      ['order-a1'],
    );
    assert.deepEqual(
      detail.body.data.afterSalesOrders.map((order) => order.id),
      ['after-sales-confirmed-a1', 'after-sales-pending-a1'],
    );
    assert.deepEqual(warningCodes(detail.body.data), ['pending_refund']);

    const unassigned = await requestJson(
      baseUrl,
      '/api/analytics/taster-rankings/unassigned?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04',
      {
        token: boss.token,
      },
    );
    assert.equal(unassigned.response.status, 200);
    assert.deepEqual(unassigned.body.data.taster, {
      id: null,
      name: UNASSIGNED_TASTER_NAME,
    });
    assert.deepEqual(
      unassigned.body.data.travelGroups.map((group) => group.id),
      ['group-unassigned'],
    );
    assert.deepEqual(warningCodes(unassigned.body.data), ['missing_taster']);
  }, {
    prisma: buildAnalyticsTasterRankingPrisma(),
  });
});

test('contract: analytics source APIs return scoped source details', async () => {
  await withPhase1Server(async (baseUrl) => {
    const boss = await login(baseUrl, 'stage8-ranking-boss', 'Password123');

    const salesOrders = await requestJson(
      baseUrl,
      '/api/analytics/source/orders?source=sales&preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04',
      {
        token: boss.token,
      },
    );
    assert.equal(salesOrders.response.status, 200);
    assert.equal(salesOrders.body.data.source, 'sales');
    assert.deepEqual(
      salesOrders.body.data.orders.map((order) => order.id),
      ['order-a1', 'order-b1', 'order-unassigned'],
    );
    assert.equal(salesOrders.body.data.orders[0].grossSalesAmountCents, 100000);
    assert.equal(salesOrders.body.data.orders[0].refundAmountCents, 10000);
    assert.equal(salesOrders.body.data.orders[0].pendingRefundAmountCents, 5000);

    const refundOrders = await requestJson(
      baseUrl,
      '/api/analytics/source/orders?source=refund&preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04',
      {
        token: boss.token,
      },
    );
    assert.equal(refundOrders.response.status, 200);
    assert.deepEqual(
      refundOrders.body.data.orders.map((order) => order.id),
      ['order-a1'],
    );
    assert.deepEqual(refundOrders.body.data.orders[0].afterSalesOrderIds, [
      'after-sales-confirmed-a1',
      'after-sales-pending-a1',
    ]);

    const tasterOrders = await requestJson(
      baseUrl,
      '/api/analytics/source/orders?source=taster&tasterId=taster-a&preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04',
      {
        token: boss.token,
      },
    );
    assert.equal(tasterOrders.response.status, 200);
    assert.deepEqual(
      tasterOrders.body.data.orders.map((order) => order.id),
      ['order-a1'],
    );

    const noEffectiveGroups = await requestJson(
      baseUrl,
      '/api/analytics/source/travel-groups?noEffectiveOrder=true&preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04',
      {
        token: boss.token,
      },
    );
    assert.equal(noEffectiveGroups.response.status, 200);
    assert.deepEqual(
      noEffectiveGroups.body.data.travelGroups.map((group) => group.id),
      ['group-a2', 'group-c1'],
    );
    assert.equal(
      noEffectiveGroups.body.data.travelGroups.every(
        (group) => group.noEffectiveOrder === true,
      ),
      true,
    );

    const afterSales = await requestJson(
      baseUrl,
      '/api/analytics/source/after-sales?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04',
      {
        token: boss.token,
      },
    );
    assert.equal(afterSales.response.status, 200);
    assert.deepEqual(
      afterSales.body.data.afterSalesOrders.map((order) => order.id),
      ['after-sales-confirmed-a1', 'after-sales-pending-a1'],
    );
    assert.deepEqual(
      afterSales.body.data.afterSalesOrders.map((order) => order.financeConfirmed),
      [true, false],
    );
  }, {
    prisma: buildAnalyticsTasterRankingPrisma(),
  });
});

test('contract: analytics detail and source APIs enforce permissions', async () => {
  await withPhase1Server(async (baseUrl) => {
    const missingToken = await requestJson(
      baseUrl,
      '/api/analytics/taster-rankings/taster-a',
    );
    assertErrorContract(missingToken, 401, 'AUTH_TOKEN_REQUIRED');

    const sales = await login(baseUrl, 'stage8-ranking-sales', 'Password123');
    for (const pathName of [
      '/api/analytics/taster-rankings/taster-a',
      '/api/analytics/source/orders',
      '/api/analytics/source/travel-groups',
      '/api/analytics/source/after-sales',
    ]) {
      const denied = await requestJson(baseUrl, pathName, {
        token: sales.token,
      });
      assertErrorContract(denied, 403, 'PERMISSION_DENIED');
    }
  }, {
    prisma: buildAnalyticsTasterRankingPrisma(),
  });
});

test('contract: analytics company API role matrix covers every endpoint', async () => {
  await withPhase1Server(async (baseUrl) => {
    const allowedUsers = [
      'admin',
      'stage8-ranking-boss',
      'stage8-ranking-finance',
      'stage8-ranking-warehouse',
      'stage8-ranking-after-sales',
    ];
    for (const username of allowedUsers) {
      const session =
        username === 'admin'
          ? await login(baseUrl)
          : await login(baseUrl, username, 'Password123');
      for (const endpoint of analyticsCompanyApiEndpoints()) {
        const result = await requestAnalyticsEndpoint(
          baseUrl,
          endpoint,
          session.token,
        );
        assert.equal(
          result.response.status,
          200,
          `${username} should access ${endpoint.path}`,
        );
      }
    }

    const deniedUsers = [
      'stage8-ranking-taster',
      'stage8-ranking-sales',
      'stage8-ranking-front-desk',
    ];
    for (const username of deniedUsers) {
      const session = await login(baseUrl, username, 'Password123');
      for (const endpoint of analyticsCompanyApiEndpoints()) {
        const denied = await requestJson(baseUrl, endpoint.path, {
          token: session.token,
        });
        assertErrorContract(
          denied,
          403,
          'PERMISSION_DENIED',
          `${username} should not access ${endpoint.path}`,
        );
      }
    }
  }, {
    prisma: buildAnalyticsTasterRankingPrisma(),
  });
});

test('contract: analytics detail and source APIs obey global mark filtering', async () => {
  await withPhase1Server(async (baseUrl) => {
    const boss = await login(baseUrl, 'stage8-ranking-boss', 'Password123');

    const openAfterSales = await requestJson(
      baseUrl,
      '/api/analytics/source/after-sales?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04',
      {
        token: boss.token,
      },
    );
    assert.equal(openAfterSales.response.status, 200);
    assert.deepEqual(
      openAfterSales.body.data.afterSalesOrders.map((order) => order.id),
      [
        'after-sales-marked',
        'after-sales-unmarked-customer',
        'after-sales-unmarked-group',
      ],
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

    const detail = await requestJson(
      baseUrl,
      '/api/analytics/taster-rankings/taster-a?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04',
      {
        token: boss.token,
      },
    );
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.data.summary.netSalesAmountCents, 9000);
    assert.deepEqual(
      detail.body.data.orders.map((order) => order.id),
      ['order-marked'],
    );

    const markedOrders = await requestJson(
      baseUrl,
      '/api/analytics/source/orders?source=group_scoped&preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04',
      {
        token: boss.token,
      },
    );
    assert.equal(markedOrders.response.status, 200);
    assert.deepEqual(
      markedOrders.body.data.orders.map((order) => order.id),
      ['order-marked'],
    );

    const markedGroups = await requestJson(
      baseUrl,
      '/api/analytics/source/travel-groups?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04',
      {
        token: boss.token,
      },
    );
    assert.equal(markedGroups.response.status, 200);
    assert.deepEqual(
      markedGroups.body.data.travelGroups.map((group) => group.id),
      ['group-marked'],
    );

    const markedAfterSales = await requestJson(
      baseUrl,
      '/api/analytics/source/after-sales?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04',
      {
        token: boss.token,
      },
    );
    assert.equal(markedAfterSales.response.status, 200);
    assert.deepEqual(
      markedAfterSales.body.data.afterSalesOrders.map((order) => order.id),
      ['after-sales-marked'],
    );
  }, {
    prisma: buildAnalyticsSourceMarkPrisma(),
  });
});

test('contract: analytics trends returns daily sales and no-order-rate points', async () => {
  await withPhase1Server(async (baseUrl) => {
    const boss = await login(baseUrl, 'stage8-ranking-boss', 'Password123');
    const sales = await requestJson(
      baseUrl,
      '/api/analytics/trends?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04&granularity=day&metric=gross_sales',
      {
        token: boss.token,
      },
    );

    assert.equal(sales.response.status, 200);
    assertTrendsContract(sales.body.data);
    assert.deepEqual(sales.body.data.range, {
      preset: 'custom',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-04',
      timezone: 'Asia/Shanghai',
    });
    assert.equal(sales.body.data.granularity, 'day');
    assert.equal(sales.body.data.metric, 'gross_sales');
    assert.deepEqual(
      sales.body.data.trends.map((point) => [
        point.periodStart,
        point.periodEnd,
        point.metricValue,
        point.grossSalesAmountCents,
      ]),
      [
        ['2026-07-01', '2026-07-01', 100000, 100000],
        ['2026-07-02', '2026-07-02', 0, 0],
        ['2026-07-03', '2026-07-03', 60000, 60000],
        ['2026-07-04', '2026-07-04', 20000, 20000],
      ],
    );

    const netSales = await requestJson(
      baseUrl,
      '/api/analytics/trends?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04&granularity=day&metric=net_sales',
      {
        token: boss.token,
      },
    );
    assert.equal(netSales.response.status, 200);
    assert.deepEqual(
      netSales.body.data.trends.map((point) => point.metricValue),
      [90000, 0, 60000, 20000],
    );
    assert.equal(netSales.body.data.trends[0].pendingRefundAmountCents, 5000);

    const noOrderRate = await requestJson(
      baseUrl,
      '/api/analytics/trends?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04&granularity=day&metric=no_order_rate',
      {
        token: boss.token,
      },
    );
    assert.equal(noOrderRate.response.status, 200);
    assert.deepEqual(
      noOrderRate.body.data.trends.map((point) => [
        point.totalGroupCount,
        point.noEffectiveOrderGroupCount,
        point.metricValue,
      ]),
      [
        [1, 0, 0],
        [1, 1, 1],
        [2, 1, 0.5],
        [1, 0, 0],
      ],
    );
  }, {
    prisma: buildAnalyticsTasterRankingPrisma(),
  });
});

test('contract: analytics trends returns monthly group points', async () => {
  await withPhase1Server(async (baseUrl) => {
    const boss = await login(baseUrl, 'stage8-ranking-boss', 'Password123');
    const result = await requestJson(
      baseUrl,
      '/api/analytics/trends?preset=custom&dateFrom=2026-06-01&dateTo=2026-07-31&granularity=month&metric=groups',
      {
        token: boss.token,
      },
    );

    assert.equal(result.response.status, 200);
    assertTrendsContract(result.body.data);
    assert.equal(result.body.data.granularity, 'month');
    assert.equal(result.body.data.metric, 'groups');
    assert.deepEqual(
      result.body.data.trends.map((point) => [
        point.periodStart,
        point.periodEnd,
        point.metricValue,
        point.totalGuestCount,
      ]),
      [
        ['2026-06-01', '2026-06-30', 1, 99],
        ['2026-07-01', '2026-07-31', 5, 75],
      ],
    );
  }, {
    prisma: buildAnalyticsTasterRankingPrisma(),
  });
});

test('contract: analytics trends returns stable zero points when no data exists', async () => {
  await withPhase1Server(async (baseUrl) => {
    const boss = await login(baseUrl, 'stage8-ranking-boss', 'Password123');
    const result = await requestJson(
      baseUrl,
      '/api/analytics/trends?preset=custom&dateFrom=2026-08-01&dateTo=2026-08-03&granularity=day&metric=guests',
      {
        token: boss.token,
      },
    );

    assert.equal(result.response.status, 200);
    assertTrendsContract(result.body.data);
    assert.deepEqual(
      result.body.data.trends.map((point) => [
        point.periodStart,
        point.periodEnd,
        point.metricValue,
        point.totalGroupCount,
        point.totalGuestCount,
      ]),
      [
        ['2026-08-01', '2026-08-01', 0, 0, 0],
        ['2026-08-02', '2026-08-02', 0, 0, 0],
        ['2026-08-03', '2026-08-03', 0, 0, 0],
      ],
    );
  }, {
    prisma: buildAnalyticsTasterRankingPrisma(),
  });
});

test('contract: analytics trends obeys global mark filtering', async () => {
  await withPhase1Server(async (baseUrl) => {
    const boss = await login(baseUrl, 'stage8-ranking-boss', 'Password123');
    const open = await requestJson(
      baseUrl,
      '/api/analytics/trends?preset=custom&dateFrom=2026-07-02&dateTo=2026-07-02&granularity=day&metric=net_sales',
      {
        token: boss.token,
      },
    );
    assert.equal(open.response.status, 200);
    assert.equal(open.body.data.trends[0].metricValue, 54000);

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
      '/api/analytics/trends?preset=custom&dateFrom=2026-07-02&dateTo=2026-07-02&granularity=day&metric=net_sales',
      {
        token: boss.token,
      },
    );
    assert.equal(markedOnly.response.status, 200);
    assert.equal(markedOnly.body.data.trends[0].metricValue, 9000);

    const markedGroups = await requestJson(
      baseUrl,
      '/api/analytics/trends?preset=custom&dateFrom=2026-07-02&dateTo=2026-07-02&granularity=day&metric=groups',
      {
        token: boss.token,
      },
    );
    assert.equal(markedGroups.response.status, 200);
    assert.equal(markedGroups.body.data.trends[0].metricValue, 1);
  }, {
    prisma: buildAnalyticsSourceMarkPrisma(),
  });
});

test('contract: analytics reads stay unlogged and exports write audit logs', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const safeQuery =
      'preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04';
    const sensitiveQuery =
      `${safeQuery}&password=Password123&token=secret-token&DATABASE_URL=mysql%3A%2F%2Fuser%3Apass%40prod%2Fdb`;

    for (const pathName of [
      `/api/analytics/overview?${sensitiveQuery}`,
      `/api/analytics/taster-rankings?${sensitiveQuery}`,
      `/api/analytics/trends?${sensitiveQuery}&granularity=day&metric=net_sales`,
    ]) {
      const result = await requestJson(baseUrl, pathName, {
        token: admin.token,
      });
      assert.equal(result.response.status, 200);
    }

    for (const action of [
      'analytics.overview.export',
      'analytics.taster_rankings.export',
    ]) {
      const logs = await requestJson(
        baseUrl,
        `/api/operation-logs?action=${action}`,
        {
          token: admin.token,
        },
      );
      assert.equal(logs.response.status, 200);
      assert.deepEqual(logs.body.data.logs, []);
    }

    const overviewDownload = await requestBinary(
      baseUrl,
      `/api/analytics/overview/export?${sensitiveQuery}`,
      {
        token: admin.token,
      },
    );
    assert.equal(overviewDownload.response.status, 200);

    const rankingDownload = await requestBinary(
      baseUrl,
      `/api/analytics/taster-rankings/export?${sensitiveQuery}`,
      {
        token: admin.token,
      },
    );
    assert.equal(rankingDownload.response.status, 200);

    const overviewLogs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=analytics.overview.export',
      {
        token: admin.token,
      },
    );
    assert.equal(overviewLogs.response.status, 200);
    assert.equal(overviewLogs.body.data.logs.length, 1);
    const overviewLog = overviewLogs.body.data.logs[0];
    assertAnalyticsExportLog(overviewLog, {
      action: 'analytics.overview.export',
      entityType: 'analytics_overview',
      entityId: 'analytics.overview.export',
      userId: admin.user.id,
    });
    assert.equal(overviewLog.beforeData, null);
    assert.equal(overviewLog.afterData.filters.preset, 'custom');
    assert.equal(overviewLog.afterData.filters.dateFrom, '2026-07-01');
    assert.equal(overviewLog.afterData.filters.dateTo, '2026-07-04');
    assert.equal(typeof overviewLog.afterData.rowCount, 'number');
    assert.deepEqual(Object.keys(overviewLog.afterData.rowCounts).sort(), [
      'afterSalesOrders',
      'metrics',
      'orders',
      'travelGroups',
    ]);

    const rankingLogs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=analytics.taster_rankings.export',
      {
        token: admin.token,
      },
    );
    assert.equal(rankingLogs.response.status, 200);
    assert.equal(rankingLogs.body.data.logs.length, 1);
    const rankingLog = rankingLogs.body.data.logs[0];
    assertAnalyticsExportLog(rankingLog, {
      action: 'analytics.taster_rankings.export',
      entityType: 'analytics_taster_ranking',
      entityId: 'analytics.taster_rankings.export',
      userId: admin.user.id,
    });
    assert.equal(rankingLog.beforeData, null);
    assert.equal(rankingLog.afterData.filters.preset, 'custom');
    assert.equal(rankingLog.afterData.filters.dateFrom, '2026-07-01');
    assert.equal(rankingLog.afterData.filters.dateTo, '2026-07-04');
    assert.equal(typeof rankingLog.afterData.rowCount, 'number');
    assert.deepEqual(Object.keys(rankingLog.afterData.rowCounts).sort(), [
      'details',
      'rankings',
    ]);
  }, {
    prisma: buildAnalyticsTasterRankingPrisma(),
  });
});

test('contract: analytics overview export returns traceable workbook and logs safely', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const query =
      'preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04&token=secret-token&password=Password123';
    const overview = await requestJson(baseUrl, `/api/analytics/overview?${query}`, {
      token: admin.token,
    });
    assert.equal(overview.response.status, 200);

    const download = await requestBinary(
      baseUrl,
      `/api/analytics/overview/export?${query}`,
      {
        token: admin.token,
      },
    );
    assert.equal(download.response.status, 200);
    assertXlsxResponse(download, /^attachment; filename="analytics-overview-\d{8}-\d{6}\.xlsx"$/);

    const workbook = await loadWorkbook(download.buffer);
    assert.deepEqual(
      workbook.worksheets.map((worksheet) => worksheet.name),
      ['指标摘要', '订单明细', '旅行团明细', '售后退款明细'],
    );

    const metrics = readDataRows(workbook.getWorksheet('指标摘要'));
    const metricByField = Object.fromEntries(
      metrics.map((row) => [row['字段'], row['值']]),
    );
    assert.equal(
      metricByField.grossSalesAmountCents,
      overview.body.data.metrics.grossSalesAmountCents,
    );
    assert.equal(
      metricByField.netSalesAmountCents,
      overview.body.data.metrics.netSalesAmountCents,
    );
    assert.equal(metricByField.warnings, 'pending_refund,missing_taster');

    const orderRows = readDataRows(workbook.getWorksheet('订单明细'));
    assert.deepEqual(
      orderRows.map((row) => row['订单号']),
      ['SO-STAGE8-RANKING-A1', 'SO-STAGE8-RANKING-B1', 'SO-STAGE8-RANKING-UNASSIGNED'],
    );
    assert.equal(orderRows[0]['原始出单金额(分)'], 100000);
    assert.equal(orderRows[0]['已确认退款(分)'], 10000);
    assert.equal(orderRows[0]['待确认退款(分)'], 5000);
    assert.equal(JSON.stringify(orderRows).includes('138'), false);

    const groupRows = readDataRows(workbook.getWorksheet('旅行团明细'));
    assert.equal(groupRows.length, 5);
    assert.equal(
      groupRows.find((row) => row['旅行团号'] === 'TG-STAGE8-RANKING-A2')[
        '无有效订单'
      ],
      '是',
    );

    const afterSalesRows = readDataRows(workbook.getWorksheet('售后退款明细'));
    assert.deepEqual(
      afterSalesRows.map((row) => row['售后单号']),
      ['AS-STAGE8-RANKING-CONFIRMED-A1', 'AS-STAGE8-RANKING-PENDING-A1'],
    );
    assert.deepEqual(
      afterSalesRows.map((row) => row['财务已确认']),
      ['是', '否'],
    );

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=analytics.overview.export',
      {
        token: admin.token,
      },
    );
    assert.equal(logs.response.status, 200);
    const log = logs.body.data.logs.find(
      (item) => item.action === 'analytics.overview.export',
    );
    assertAnalyticsExportLog(log, {
      action: 'analytics.overview.export',
      entityType: 'analytics_overview',
      entityId: 'analytics.overview.export',
      userId: admin.user.id,
    });
    assert.equal(log.afterData.rowCount, 24);
    assert.deepEqual(log.afterData.rowCounts, {
      metrics: 14,
      orders: 3,
      travelGroups: 5,
      afterSalesOrders: 2,
    });
    assert.equal(log.afterData.filters.preset, 'custom');
    assert.equal(JSON.stringify(log.afterData).includes('secret-token'), false);
    assert.equal(JSON.stringify(log.afterData).includes('Password123'), false);
  }, {
    prisma: buildAnalyticsTasterRankingPrisma(),
  });
});

test('contract: analytics taster rankings export matches ranking API口径', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const query =
      'preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04&sortBy=noOrderRate&sortDirection=desc&limit=2&password=Password123';
    const api = await requestJson(
      baseUrl,
      `/api/analytics/taster-rankings?${query}`,
      {
        token: admin.token,
      },
    );
    assert.equal(api.response.status, 200);

    const download = await requestBinary(
      baseUrl,
      `/api/analytics/taster-rankings/export?${query}`,
      {
        token: admin.token,
      },
    );
    assert.equal(download.response.status, 200);
    assertXlsxResponse(
      download,
      /^attachment; filename="analytics-taster-rankings-\d{8}-\d{6}\.xlsx"$/,
    );

    const workbook = await loadWorkbook(download.buffer);
    assert.deepEqual(
      workbook.worksheets.map((worksheet) => worksheet.name),
      ['排名摘要', '品鉴师明细'],
    );
    const rankingRows = readDataRows(workbook.getWorksheet('排名摘要'));
    assert.deepEqual(
      rankingRows.map((row) => row['品鉴师ID']),
      api.body.data.rankings.map((row) => row.tasterId || ''),
    );
    assert.deepEqual(
      rankingRows.map((row) => row['打蛋率']),
      api.body.data.rankings.map((row) => row.noOrderRate),
    );
    assert.deepEqual(
      rankingRows.map((row) => row['净销售额(分)']),
      api.body.data.rankings.map((row) => row.netSalesAmountCents),
    );

    const detailRows = readDataRows(workbook.getWorksheet('品鉴师明细'));
    assert.deepEqual(
      detailRows.map((row) => [row['品鉴师ID'], row['旅行团号'], row['订单号']]),
      [
        ['taster-c', 'TG-STAGE8-RANKING-C1', 'SO-STAGE8-RANKING-CANCELLED'],
        ['taster-a', 'TG-STAGE8-RANKING-A1', 'SO-STAGE8-RANKING-A1'],
        ['taster-a', 'TG-STAGE8-RANKING-A2', ''],
      ],
    );

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=analytics.taster_rankings.export',
      {
        token: admin.token,
      },
    );
    assert.equal(logs.response.status, 200);
    const log = logs.body.data.logs.find(
      (item) => item.action === 'analytics.taster_rankings.export',
    );
    assertAnalyticsExportLog(log, {
      action: 'analytics.taster_rankings.export',
      entityType: 'analytics_taster_ranking',
      entityId: 'analytics.taster_rankings.export',
      userId: admin.user.id,
    });
    assert.equal(log.afterData.rowCount, 5);
    assert.deepEqual(log.afterData.rowCounts, {
      rankings: 2,
      details: 3,
    });
    assert.equal(log.afterData.filters.sortBy, 'noOrderRate');
    assert.equal(JSON.stringify(log.afterData).includes('Password123'), false);
  }, {
    prisma: buildAnalyticsTasterRankingPrisma(),
  });
});

test('contract: analytics export endpoints enforce read roles', async () => {
  await withPhase1Server(async (baseUrl) => {
    const finance = await login(baseUrl, 'stage8-ranking-finance', 'Password123');
    const boss = await login(baseUrl, 'stage8-ranking-boss', 'Password123');
    const afterSales = await login(
      baseUrl,
      'stage8-ranking-after-sales',
      'Password123',
    );
    const sales = await login(baseUrl, 'stage8-ranking-sales', 'Password123');

    const financeDownload = await requestBinary(
      baseUrl,
      '/api/analytics/overview/export?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04',
      {
        token: finance.token,
      },
    );
    assert.equal(financeDownload.response.status, 200);

    const bossDownload = await requestBinary(
      baseUrl,
      '/api/analytics/taster-rankings/export?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04',
      {
        token: boss.token,
      },
    );
    assert.equal(bossDownload.response.status, 200);

    const afterSalesDownload = await requestBinary(
      baseUrl,
      '/api/analytics/overview/export?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04',
      {
        token: afterSales.token,
      },
    );
    assert.equal(afterSalesDownload.response.status, 200);

    for (const pathName of [
      '/api/analytics/overview/export',
      '/api/analytics/taster-rankings/export',
    ]) {
      const denied = await requestJson(baseUrl, pathName, {
        token: sales.token,
      });
      assertErrorContract(denied, 403, 'PERMISSION_DENIED');
    }
  }, {
    prisma: buildAnalyticsTasterRankingPrisma(),
  });
});

test('contract: analytics exports obey global mark filtering', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const boss = await login(baseUrl, 'stage8-ranking-boss', 'Password123');

    const openOverview = await requestBinary(
      baseUrl,
      '/api/analytics/overview/export?preset=custom&dateFrom=2026-07-02&dateTo=2026-07-02',
      {
        token: boss.token,
      },
    );
    assert.equal(openOverview.response.status, 200);
    assert.deepEqual(
      readDataRows((await loadWorkbook(openOverview.buffer)).getWorksheet('订单明细'))
        .map((row) => row['订单号'])
        .sort(),
      [
        'SO-STAGE8-SOURCE-MARKED',
        'SO-STAGE8-SOURCE-UNMARKED-CUSTOMER',
        'SO-STAGE8-SOURCE-UNMARKED-GROUP',
      ],
    );

    const enabled = await requestJson(
      baseUrl,
      '/api/settings/global-mark-query/enable',
      {
        method: 'POST',
        token: admin.token,
      },
    );
    assert.equal(enabled.response.status, 200);

    const markedOverview = await requestBinary(
      baseUrl,
      '/api/analytics/overview/export?preset=custom&dateFrom=2026-07-02&dateTo=2026-07-02',
      {
        token: boss.token,
      },
    );
    assert.equal(markedOverview.response.status, 200);
    const overviewWorkbook = await loadWorkbook(markedOverview.buffer);
    assert.deepEqual(
      readDataRows(overviewWorkbook.getWorksheet('订单明细')).map(
        (row) => row['订单号'],
      ),
      ['SO-STAGE8-SOURCE-MARKED'],
    );
    assert.deepEqual(
      readDataRows(overviewWorkbook.getWorksheet('售后退款明细')).map(
        (row) => row['售后单号'],
      ),
      ['AS-STAGE8-SOURCE-MARKED'],
    );

    const rankingDownload = await requestBinary(
      baseUrl,
      '/api/analytics/taster-rankings/export?preset=custom&dateFrom=2026-07-02&dateTo=2026-07-02',
      {
        token: boss.token,
      },
    );
    assert.equal(rankingDownload.response.status, 200);
    const rankingRows = readDataRows(
      (await loadWorkbook(rankingDownload.buffer)).getWorksheet('排名摘要'),
    );
    assert.deepEqual(
      rankingRows.map((row) => [row['品鉴师ID'], row['净销售额(分)']]),
      [['taster-a', 9000]],
    );
  }, {
    prisma: buildAnalyticsSourceMarkPrisma(),
  });
});

test('contract: analytics global mark scope is shared by APIs and exports', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const boss = await login(baseUrl, 'stage8-ranking-boss', 'Password123');
    const range = 'preset=custom&dateFrom=2026-07-02&dateTo=2026-07-02';

    const openOverview = await requestJson(
      baseUrl,
      `/api/analytics/overview?${range}`,
      {
        token: boss.token,
      },
    );
    assert.equal(openOverview.response.status, 200);
    assert.equal(openOverview.body.data.metrics.netSalesAmountCents, 54000);

    const openOrders = await requestJson(
      baseUrl,
      `/api/analytics/source/orders?source=sales&${range}`,
      {
        token: boss.token,
      },
    );
    assert.equal(openOrders.response.status, 200);
    assert.deepEqual(
      openOrders.body.data.orders.map((order) => order.id).sort(),
      [
        'order-marked',
        'order-unmarked-customer',
        'order-unmarked-group',
      ],
    );

    const enabled = await requestJson(
      baseUrl,
      '/api/settings/global-mark-query/enable',
      {
        method: 'POST',
        token: admin.token,
      },
    );
    assert.equal(enabled.response.status, 200);

    const markedOverview = await requestJson(
      baseUrl,
      `/api/analytics/overview?${range}`,
      {
        token: boss.token,
      },
    );
    assert.equal(markedOverview.response.status, 200);
    assert.equal(markedOverview.body.data.metrics.grossSalesAmountCents, 10000);
    assert.equal(markedOverview.body.data.metrics.refundAmountCents, 1000);
    assert.equal(markedOverview.body.data.metrics.netSalesAmountCents, 9000);
    assert.equal(markedOverview.body.data.metrics.totalGroupCount, 1);

    const markedRankings = await requestJson(
      baseUrl,
      `/api/analytics/taster-rankings?${range}`,
      {
        token: boss.token,
      },
    );
    assert.equal(markedRankings.response.status, 200);
    assert.deepEqual(
      markedRankings.body.data.rankings.map((row) => [
        row.tasterId,
        row.netSalesAmountCents,
      ]),
      [['taster-a', 9000]],
    );

    const markedDetail = await requestJson(
      baseUrl,
      `/api/analytics/taster-rankings/taster-a?${range}`,
      {
        token: boss.token,
      },
    );
    assert.equal(markedDetail.response.status, 200);
    assert.deepEqual(
      markedDetail.body.data.travelGroups.map((group) => group.id),
      ['group-marked'],
    );
    assert.deepEqual(
      markedDetail.body.data.orders.map((order) => order.id),
      ['order-marked'],
    );
    assert.deepEqual(
      markedDetail.body.data.afterSalesOrders.map((order) => order.id),
      ['after-sales-marked'],
    );

    const markedOrders = await requestJson(
      baseUrl,
      `/api/analytics/source/orders?source=sales&${range}`,
      {
        token: boss.token,
      },
    );
    assert.equal(markedOrders.response.status, 200);
    assert.deepEqual(
      markedOrders.body.data.orders.map((order) => order.id),
      ['order-marked'],
    );

    const markedGroups = await requestJson(
      baseUrl,
      `/api/analytics/source/travel-groups?${range}`,
      {
        token: boss.token,
      },
    );
    assert.equal(markedGroups.response.status, 200);
    assert.deepEqual(
      markedGroups.body.data.travelGroups.map((group) => group.id),
      ['group-marked'],
    );

    const markedAfterSales = await requestJson(
      baseUrl,
      `/api/analytics/source/after-sales?${range}`,
      {
        token: boss.token,
      },
    );
    assert.equal(markedAfterSales.response.status, 200);
    assert.deepEqual(
      markedAfterSales.body.data.afterSalesOrders.map((order) => order.id),
      ['after-sales-marked'],
    );

    const markedNetTrend = await requestJson(
      baseUrl,
      `/api/analytics/trends?${range}&granularity=day&metric=net_sales`,
      {
        token: boss.token,
      },
    );
    assert.equal(markedNetTrend.response.status, 200);
    assert.equal(markedNetTrend.body.data.trends[0].metricValue, 9000);

    const markedGroupTrend = await requestJson(
      baseUrl,
      `/api/analytics/trends?${range}&granularity=day&metric=groups`,
      {
        token: boss.token,
      },
    );
    assert.equal(markedGroupTrend.response.status, 200);
    assert.equal(markedGroupTrend.body.data.trends[0].metricValue, 1);

    const overviewExport = await requestBinary(
      baseUrl,
      `/api/analytics/overview/export?${range}`,
      {
        token: boss.token,
      },
    );
    assert.equal(overviewExport.response.status, 200);
    const overviewWorkbook = await loadWorkbook(overviewExport.buffer);
    assertSerializedRowsIncludeOnly(
      overviewWorkbook.worksheets[1],
      ['SO-STAGE8-SOURCE-MARKED'],
      [
        'SO-STAGE8-SOURCE-UNMARKED-CUSTOMER',
        'SO-STAGE8-SOURCE-UNMARKED-GROUP',
      ],
    );
    assertSerializedRowsIncludeOnly(
      overviewWorkbook.worksheets[2],
      ['TG-STAGE8-SOURCE-MARKED'],
      ['TG-STAGE8-SOURCE-UNMARKED'],
    );
    assertSerializedRowsIncludeOnly(
      overviewWorkbook.worksheets[3],
      ['AS-STAGE8-SOURCE-MARKED'],
      [
        'AS-STAGE8-SOURCE-UNMARKED-CUSTOMER',
        'AS-STAGE8-SOURCE-UNMARKED-GROUP',
      ],
    );

    const rankingExport = await requestBinary(
      baseUrl,
      `/api/analytics/taster-rankings/export?${range}`,
      {
        token: boss.token,
      },
    );
    assert.equal(rankingExport.response.status, 200);
    const rankingWorkbook = await loadWorkbook(rankingExport.buffer);
    assertSerializedRowsIncludeOnly(
      rankingWorkbook.worksheets[0],
      ['taster-a', '9000'],
      ['taster-b'],
    );
  }, {
    prisma: buildAnalyticsSourceMarkPrisma(),
  });
});

function buildAnalyticsTasterRankingPrisma() {
  return {
    users: analyticsUsers(),
    customers: [
      customer('customer-marked', true),
      customer('customer-unmarked', false),
    ],
    travelGroups: [
      travelGroup('group-a1', {
        groupNo: 'TG-STAGE8-RANKING-A1',
        visitDate: '2026-07-01',
        guestCount: 10,
        tasterId: 'taster-a',
        tasterName: 'Taster A',
        groupType: 'retail',
        travelAgency: 'Stage8 Ranking Agency A',
      }),
      travelGroup('group-a2', {
        groupNo: 'TG-STAGE8-RANKING-A2',
        visitDate: '2026-07-02',
        guestCount: 20,
        tasterId: 'taster-a',
        tasterName: 'Taster A',
        groupType: 'retail',
        travelAgency: 'Stage8 Ranking Agency A',
      }),
      travelGroup('group-b1', {
        groupNo: 'TG-STAGE8-RANKING-B1',
        visitDate: '2026-07-03',
        guestCount: 30,
        tasterId: 'taster-b',
        tasterName: 'Taster B',
        groupType: 'vip',
        travelAgency: 'Stage8 Ranking Agency B',
      }),
      travelGroup('group-c1', {
        groupNo: 'TG-STAGE8-RANKING-C1',
        visitDate: '2026-07-03',
        guestCount: 10,
        tasterId: 'taster-c',
        tasterName: 'Taster C',
        groupType: 'retail',
        travelAgency: 'Stage8 Ranking Agency C',
      }),
      travelGroup('group-unassigned', {
        groupNo: 'TG-STAGE8-RANKING-UNASSIGNED',
        visitDate: '2026-07-04',
        guestCount: 5,
        tasterId: null,
        tasterName: null,
        groupType: 'retail',
        travelAgency: 'Stage8 Ranking Agency C',
      }),
      travelGroup('group-outside-range', {
        groupNo: 'TG-STAGE8-RANKING-OUTSIDE',
        visitDate: '2026-06-30',
        guestCount: 99,
        tasterId: 'taster-a',
        tasterName: 'Taster A',
        groupType: 'retail',
        travelAgency: 'Stage8 Ranking Agency A',
      }),
    ],
    salesOrders: [
      salesOrder('order-a1', {
        orderNo: 'SO-STAGE8-RANKING-A1',
        orderDate: '2026-07-01',
        travelGroupId: 'group-a1',
        customerId: 'customer-marked',
        totalAmountCents: 100000,
        status: 'PARTIAL_REFUND',
      }),
      salesOrder('order-b1', {
        orderNo: 'SO-STAGE8-RANKING-B1',
        orderDate: '2026-07-03',
        travelGroupId: 'group-b1',
        customerId: 'customer-marked',
        totalAmountCents: 60000,
      }),
      salesOrder('order-unassigned', {
        orderNo: 'SO-STAGE8-RANKING-UNASSIGNED',
        orderDate: '2026-07-04',
        travelGroupId: 'group-unassigned',
        customerId: 'customer-marked',
        totalAmountCents: 20000,
      }),
      salesOrder('order-cancelled', {
        orderNo: 'SO-STAGE8-RANKING-CANCELLED',
        orderDate: '2026-07-03',
        travelGroupId: 'group-c1',
        customerId: 'customer-marked',
        totalAmountCents: 999999,
        status: 'CANCELLED',
      }),
      salesOrder('order-outside-range', {
        orderNo: 'SO-STAGE8-RANKING-OUTSIDE',
        orderDate: '2026-06-30',
        travelGroupId: 'group-outside-range',
        customerId: 'customer-marked',
        totalAmountCents: 999999,
      }),
    ],
    afterSalesOrders: [
      afterSalesOrder('after-sales-confirmed-a1', {
        afterSalesNo: 'AS-STAGE8-RANKING-CONFIRMED-A1',
        salesOrderId: 'order-a1',
        customerId: 'customer-marked',
        refundAmountCents: 10000,
        financeConfirmed: true,
      }),
      afterSalesOrder('after-sales-pending-a1', {
        afterSalesNo: 'AS-STAGE8-RANKING-PENDING-A1',
        salesOrderId: 'order-a1',
        customerId: 'customer-marked',
        refundAmountCents: 5000,
        financeConfirmed: false,
      }),
    ],
  };
}

function buildAnalyticsTasterRankingMarkPrisma() {
  return {
    users: analyticsUsers(),
    customers: [
      customer('customer-marked', true),
      customer('customer-unmarked', false),
    ],
    travelGroups: [
      travelGroup('group-marked', {
        groupNo: 'TG-STAGE8-RANKING-MARKED',
        visitDate: '2026-07-02',
        guestCount: 10,
        tasterId: 'taster-a',
        tasterName: 'Taster A',
        financeMark: true,
      }),
      travelGroup('group-unmarked', {
        groupNo: 'TG-STAGE8-RANKING-UNMARKED',
        visitDate: '2026-07-02',
        guestCount: 10,
        tasterId: 'taster-b',
        tasterName: 'Taster B',
        financeMark: false,
      }),
    ],
    salesOrders: [
      salesOrder('order-marked', {
        orderNo: 'SO-STAGE8-RANKING-MARKED',
        orderDate: '2026-07-02',
        travelGroupId: 'group-marked',
        customerId: 'customer-unmarked',
        totalAmountCents: 10000,
      }),
      salesOrder('order-unmarked-customer', {
        orderNo: 'SO-STAGE8-RANKING-UNMARKED-CUSTOMER',
        orderDate: '2026-07-02',
        travelGroupId: 'group-marked',
        customerId: 'customer-marked',
        totalAmountCents: 20000,
        financeMark: false,
      }),
      salesOrder('order-unmarked-group', {
        orderNo: 'SO-STAGE8-RANKING-UNMARKED-GROUP',
        orderDate: '2026-07-02',
        travelGroupId: 'group-unmarked',
        customerId: 'customer-marked',
        totalAmountCents: 30000,
        financeMark: false,
      }),
    ],
  };
}

function buildAnalyticsSourceMarkPrisma() {
  return {
    users: analyticsUsers(),
    customers: [
      customer('customer-marked', true),
      customer('customer-unmarked', false),
    ],
    travelGroups: [
      travelGroup('group-marked', {
        groupNo: 'TG-STAGE8-SOURCE-MARKED',
        visitDate: '2026-07-02',
        guestCount: 10,
        tasterId: 'taster-a',
        tasterName: 'Taster A',
        financeMark: true,
      }),
      travelGroup('group-unmarked', {
        groupNo: 'TG-STAGE8-SOURCE-UNMARKED',
        visitDate: '2026-07-02',
        guestCount: 10,
        tasterId: 'taster-b',
        tasterName: 'Taster B',
        financeMark: false,
      }),
    ],
    salesOrders: [
      salesOrder('order-marked', {
        orderNo: 'SO-STAGE8-SOURCE-MARKED',
        orderDate: '2026-07-02',
        travelGroupId: 'group-marked',
        customerId: 'customer-unmarked',
        totalAmountCents: 10000,
      }),
      salesOrder('order-unmarked-customer', {
        orderNo: 'SO-STAGE8-SOURCE-UNMARKED-CUSTOMER',
        orderDate: '2026-07-02',
        travelGroupId: 'group-marked',
        customerId: 'customer-marked',
        totalAmountCents: 20000,
        financeMark: false,
      }),
      salesOrder('order-unmarked-group', {
        orderNo: 'SO-STAGE8-SOURCE-UNMARKED-GROUP',
        orderDate: '2026-07-02',
        travelGroupId: 'group-unmarked',
        customerId: 'customer-marked',
        totalAmountCents: 30000,
        financeMark: false,
      }),
    ],
    afterSalesOrders: [
      afterSalesOrder('after-sales-marked', {
        afterSalesNo: 'AS-STAGE8-SOURCE-MARKED',
        salesOrderId: 'order-marked',
        customerId: 'customer-marked',
        refundAmountCents: 1000,
        financeConfirmed: true,
      }),
      afterSalesOrder('after-sales-unmarked-customer', {
        afterSalesNo: 'AS-STAGE8-SOURCE-UNMARKED-CUSTOMER',
        salesOrderId: 'order-unmarked-customer',
        customerId: 'customer-unmarked',
        refundAmountCents: 2000,
        financeConfirmed: true,
      }),
      afterSalesOrder('after-sales-unmarked-group', {
        afterSalesNo: 'AS-STAGE8-SOURCE-UNMARKED-GROUP',
        salesOrderId: 'order-unmarked-group',
        customerId: 'customer-marked',
        refundAmountCents: 3000,
        financeConfirmed: true,
      }),
    ],
  };
}

function analyticsUsers() {
  return [
    user('usr-stage8-ranking-boss', 'stage8-ranking-boss', 'boss'),
    user('usr-stage8-ranking-finance', 'stage8-ranking-finance', 'finance'),
    user('usr-stage8-ranking-sales', 'stage8-ranking-sales', 'sales'),
    user(
      'usr-stage8-ranking-front-desk',
      'stage8-ranking-front-desk',
      'front_desk',
    ),
    user(
      'usr-stage8-ranking-after-sales',
      'stage8-ranking-after-sales',
      'after_sales',
    ),
    user(
      'usr-stage8-ranking-warehouse',
      'stage8-ranking-warehouse',
      'warehouse',
    ),
    user('usr-stage8-ranking-taster', 'stage8-ranking-taster', 'taster'),
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
    name: `Stage8 Ranking Test ${id}`,
    phone: `138${id.length.toString().padStart(8, '0')}`,
    financeMark,
  };
}

function travelGroup(id, overrides = {}) {
  return {
    id,
    groupNo: `TG-STAGE8-RANKING-${id}`,
    visitDate: '2026-07-02',
    guestCount: 10,
    tasterId: 'taster-default',
    tasterName: 'Taster Default',
    groupType: 'retail',
    travelAgency: 'Stage8 Ranking Agency',
    remarks: 'stage8 ranking smoke test group',
    financeMark: true,
    ...overrides,
  };
}

function salesOrder(id, overrides = {}) {
  return {
    id,
    orderNo: `SO-STAGE8-RANKING-${id}`,
    orderDate: '2026-07-02',
    customerId: 'customer-marked',
    customerName: 'Stage8 Ranking Test Customer',
    travelGroupId: null,
    totalAmountCents: 0,
    status: 'VALID',
    remark: 'stage8 ranking smoke test order',
    financeMark: true,
    ...overrides,
  };
}

function afterSalesOrder(id, overrides = {}) {
  return {
    id,
    afterSalesNo: `AS-STAGE8-RANKING-${id}`,
    salesOrderId: 'order-a1',
    customerId: 'customer-marked',
    refundAmountCents: 0,
    financeConfirmed: false,
    description: 'stage8 ranking smoke test after sales',
    createdAt: '2026-07-02T00:00:00.000Z',
    ...overrides,
  };
}

function assertRankingsContract(data) {
  assert.deepEqual(Object.keys(data).sort(), ['range', 'rankings']);
  assert.equal(typeof data.range.dateFrom, 'string');
  assert.equal(typeof data.range.dateTo, 'string');
  assert.equal(data.range.timezone, 'Asia/Shanghai');
  assert.equal(Array.isArray(data.rankings), true);
  for (const row of data.rankings) {
    assert.deepEqual(Object.keys(row).sort(), [
      'averageSalesPerGroupCents',
      'averageSalesPerGuestCents',
      'conversionGroupCount',
      'conversionRate',
      'grossSalesAmountCents',
      'netSalesAmountCents',
      'noEffectiveOrderGroupCount',
      'noOrderRate',
      'rank',
      'refundAmountCents',
      'tasterId',
      'tasterName',
      'totalGroupCount',
      'totalGuestCount',
      'warnings',
    ]);
    assert.equal(typeof row.tasterName, 'string');
    assert.equal(typeof row.rank, 'number');
    assert.equal(typeof row.totalGroupCount, 'number');
    assert.equal(typeof row.totalGuestCount, 'number');
    assert.equal(typeof row.grossSalesAmountCents, 'number');
    assert.equal(typeof row.refundAmountCents, 'number');
    assert.equal(typeof row.netSalesAmountCents, 'number');
    assert.equal(typeof row.averageSalesPerGroupCents, 'number');
    assert.equal(typeof row.averageSalesPerGuestCents, 'number');
    assert.equal(typeof row.noEffectiveOrderGroupCount, 'number');
    assert.equal(typeof row.conversionGroupCount, 'number');
    assert.equal(typeof row.noOrderRate, 'number');
    assert.equal(typeof row.conversionRate, 'number');
    assert.equal(Array.isArray(row.warnings), true);
  }
}

function assertTrendsContract(data) {
  assert.deepEqual(Object.keys(data).sort(), [
    'granularity',
    'metric',
    'range',
    'trends',
  ]);
  assert.equal(typeof data.range.dateFrom, 'string');
  assert.equal(typeof data.range.dateTo, 'string');
  assert.equal(data.range.timezone, 'Asia/Shanghai');
  assert.equal(['day', 'month'].includes(data.granularity), true);
  assert.equal(typeof data.metric, 'string');
  assert.equal(Array.isArray(data.trends), true);
  for (const point of data.trends) {
    assert.deepEqual(Object.keys(point).sort(), [
      'conversionGroupCount',
      'conversionRate',
      'grossSalesAmountCents',
      'groupScopedNetSalesAmountCents',
      'metricValue',
      'netSalesAmountCents',
      'noEffectiveOrderGroupCount',
      'noOrderRate',
      'pendingRefundAmountCents',
      'periodEnd',
      'periodStart',
      'refundAmountCents',
      'totalGroupCount',
      'totalGuestCount',
    ]);
    assert.equal(typeof point.periodStart, 'string');
    assert.equal(typeof point.periodEnd, 'string');
    assert.equal(typeof point.metricValue, 'number');
    assert.equal(typeof point.grossSalesAmountCents, 'number');
    assert.equal(typeof point.refundAmountCents, 'number');
    assert.equal(typeof point.pendingRefundAmountCents, 'number');
    assert.equal(typeof point.netSalesAmountCents, 'number');
    assert.equal(typeof point.totalGroupCount, 'number');
    assert.equal(typeof point.totalGuestCount, 'number');
    assert.equal(typeof point.groupScopedNetSalesAmountCents, 'number');
    assert.equal(typeof point.noEffectiveOrderGroupCount, 'number');
    assert.equal(typeof point.conversionGroupCount, 'number');
    assert.equal(typeof point.noOrderRate, 'number');
    assert.equal(typeof point.conversionRate, 'number');
  }
}

function pickRankingMetrics(row) {
  return {
    rank: row.rank,
    totalGroupCount: row.totalGroupCount,
    totalGuestCount: row.totalGuestCount,
    grossSalesAmountCents: row.grossSalesAmountCents,
    refundAmountCents: row.refundAmountCents,
    netSalesAmountCents: row.netSalesAmountCents,
    averageSalesPerGroupCents: row.averageSalesPerGroupCents,
    averageSalesPerGuestCents: row.averageSalesPerGuestCents,
    noEffectiveOrderGroupCount: row.noEffectiveOrderGroupCount,
    conversionGroupCount: row.conversionGroupCount,
    noOrderRate: row.noOrderRate,
    conversionRate: row.conversionRate,
  };
}

function rowByTasterId(rows, tasterId) {
  const row = rows.find((item) => item.tasterId === tasterId);
  assert.ok(row, `Expected ranking row for ${tasterId}.`);
  return row;
}

function warningCodes(row) {
  return row.warnings.map((warning) => warning.code);
}

function analyticsCompanyApiEndpoints() {
  const range = 'preset=custom&dateFrom=2026-07-01&dateTo=2026-07-04';
  return [
    {
      path: `/api/analytics/overview?${range}`,
    },
    {
      path: `/api/analytics/taster-rankings?${range}`,
    },
    {
      path: `/api/analytics/taster-rankings/taster-a?${range}`,
    },
    {
      path: `/api/analytics/source/orders?source=sales&${range}`,
    },
    {
      path: `/api/analytics/source/travel-groups?${range}`,
    },
    {
      path: `/api/analytics/source/after-sales?${range}`,
    },
    {
      path: `/api/analytics/trends?${range}&granularity=day&metric=net_sales`,
    },
    {
      path: `/api/analytics/overview/export?${range}`,
      binary: true,
    },
    {
      path: `/api/analytics/taster-rankings/export?${range}`,
      binary: true,
    },
  ];
}

async function requestAnalyticsEndpoint(baseUrl, endpoint, token) {
  if (endpoint.binary) {
    return requestBinary(baseUrl, endpoint.path, { token });
  }
  return requestJson(baseUrl, endpoint.path, { token });
}

async function requestBinary(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    response,
    buffer,
  };
}

async function loadWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

function readHeaders(worksheet) {
  return worksheet.getRow(1).values.slice(1);
}

function readRowObject(worksheet, rowNumber) {
  const headers = readHeaders(worksheet);
  const row = worksheet.getRow(rowNumber);
  return Object.fromEntries(
    headers.map((header, index) => [header, row.getCell(index + 1).value]),
  );
}

function readDataRows(worksheet) {
  assert.ok(worksheet);
  const rows = [];
  for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
    rows.push(readRowObject(worksheet, rowNumber));
  }
  return rows;
}

function assertSerializedRowsIncludeOnly(
  worksheet,
  expectedValues,
  forbiddenValues,
) {
  const serialized = JSON.stringify(readDataRows(worksheet));
  for (const value of expectedValues) {
    assert.equal(
      serialized.includes(String(value)),
      true,
      `Expected worksheet rows to include ${value}.`,
    );
  }
  for (const value of forbiddenValues) {
    assert.equal(
      serialized.includes(String(value)),
      false,
      `Expected worksheet rows to exclude ${value}.`,
    );
  }
}

function assertXlsxResponse(download, fileNamePattern) {
  assert.match(
    download.response.headers.get('content-type'),
    new RegExp(XLSX_CONTENT_TYPE.replace(/\./g, '\\.')),
  );
  assert.match(
    download.response.headers.get('content-disposition'),
    fileNamePattern,
  );
  assert.equal(download.buffer[0], 0x50);
  assert.equal(download.buffer[1], 0x4b);
}

function assertAnalyticsExportLog(log, expected) {
  assert.ok(log);
  assertOperationLogContract(log);
  assert.equal(log.action, expected.action);
  assert.equal(log.entityType, expected.entityType);
  assert.equal(log.entityId, expected.entityId);
  assert.equal(log.userId, expected.userId);
  assert.equal(typeof log.ipAddress, 'string');
  assert.ok(log.ipAddress.length > 0);
  const serialized = JSON.stringify(log);
  assert.equal(/Password123|secret-token|DATABASE_URL/i.test(serialized), false);
}
