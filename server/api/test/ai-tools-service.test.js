const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AI_TOOL_NAMES,
  AiToolsService,
} = require('../src/modules/ai/ai-tools.service');
const {
  AiPolicyService,
} = require('../src/modules/ai/ai-policy.service');

test('unit: AI tools registry exposes only the stage 9 read-only whitelist', () => {
  const service = createService();

  assert.deepEqual(service.listToolNames(), [
    'analytics.overview',
    'analytics.tasterRankings',
    'analytics.tasterDetail',
    'analytics.trends',
    'finance.summary',
    'commission.query',
    'travelGroup.financeSummary',
    'refund.query',
    'customer.lookup',
    'customer.orderLookup',
    'afterSales.lookup',
    'logistics.lookup',
    'commission.ruleExplain',
  ]);
  assert.deepEqual(service.listToolNames(), [...AI_TOOL_NAMES]);

  for (const definition of service.listToolDefinitions()) {
    assert.deepEqual(Object.keys(definition).sort(), [
      'description',
      'intent',
      'readOnly',
      'toolName',
    ]);
    assert.equal(definition.readOnly, true);
    assert.equal(typeof definition.intent, 'string');
    assert.equal(typeof definition.description, 'string');
    assert.equal(definition.description.length > 0, true);
  }
});

test('unit: AI tools registry runs mock read-only tools with unified output', async () => {
  const service = createService();

  const result = await service.executeTool('analytics.overview', {
    actor: { userId: 'u-admin', role: 'admin' },
    range: {
      preset: 'custom',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-04',
    },
    filters: { groupType: 'retail' },
    limit: 20,
  });

  assert.equal(result.toolName, 'analytics.overview');
  assert.equal(result.data, null);
  assert.deepEqual(Object.keys(result.sourceSummary).sort(), [
    'dateFrom',
    'dateTo',
    'globalMarkedFilterEnabled',
    'rowCount',
    'scopeDescription',
  ]);
  assert.equal(result.sourceSummary.rowCount, 0);
  assert.equal(result.sourceSummary.dateFrom, '2026-07-01');
  assert.equal(result.sourceSummary.dateTo, '2026-07-04');
  assert.equal(result.sourceSummary.globalMarkedFilterEnabled, false);
  assert.equal(typeof result.sourceSummary.scopeDescription, 'string');
  assert.equal(result.sourceSummary.scopeDescription.length > 0, true);
  assert.equal(Array.isArray(result.warnings), true);
  assert.equal(result.warnings.length, 1);
});

test('unit: AI tools registry rejects dangerous or non-read-only tool registration', () => {
  const service = createService();

  for (const toolName of [
    'rawSql',
    'databaseQuery',
    'writeOrder',
    'updateCustomer',
    'analytics.overview.export',
    'commission.recalculate',
    'afterSales.confirmRefund',
    'salesOrder.transitionStatus',
    'customer.updateFinanceMark',
    'order.updateWarehouseFields',
  ]) {
    assertToolRegistrationError(
      service,
      { ...mockDefinition(), toolName },
      'AI_TOOL_FORBIDDEN',
    );
  }

  assertToolRegistrationError(
    service,
    {
      ...mockDefinition(),
      toolName: 'unknown.lookup',
    },
    'AI_TOOL_NOT_WHITELISTED',
  );

  assertToolRegistrationError(
    service,
    {
      ...mockDefinition(),
      readOnly: false,
    },
    'AI_TOOL_MUST_BE_READ_ONLY',
  );
});

test('unit: AI tools registry checks AI policy before execution', async () => {
  const service = createService();

  await assertToolExecutionError(
    service,
    'analytics.overview',
    { actor: { userId: 'u-sales', role: 'sales' } },
    'AI_ROLE_NOT_ALLOWED',
    403,
  );

  await assertToolExecutionError(
    service,
    'customer.orderLookup',
    { actor: { userId: 'u-finance', role: 'finance' } },
    'AI_PERMISSION_DENIED',
    403,
  );

  await assertToolExecutionError(
    service,
    'commission.query',
    { actor: { userId: 'u-after-sales', role: 'after_sales' } },
    'AI_PERMISSION_DENIED',
    403,
  );

  await assertToolExecutionError(
    service,
    'rawSql',
    { actor: { userId: 'u-admin', role: 'admin' } },
    'AI_TOOL_NOT_REGISTERED',
    400,
  );
});

test('unit: AI analytics overview tool delegates to stage 8 analytics service', async () => {
  const calls = [];
  const service = createServiceWithAnalytics({
    calls,
    globalMarkedFilterEnabled: true,
    overviewResult: {
      range: {
        preset: 'custom',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-04',
        timezone: 'Asia/Shanghai',
      },
      metrics: {
        grossSalesAmountCents: 100000,
        refundAmountCents: 10000,
        pendingRefundAmountCents: 3000,
        netSalesAmountCents: 90000,
        totalGroupCount: 5,
        totalGuestCount: 20,
        groupScopedNetSalesAmountCents: 90000,
        averageSalesPerGroupCents: 18000,
        averageSalesPerGuestCents: 4500,
        noEffectiveOrderGroupCount: 1,
        conversionGroupCount: 4,
        noOrderRate: 0.2,
        conversionRate: 0.8,
      },
      warnings: [
        {
          code: 'pending_refund',
          message: 'Pending refunds are excluded from net sales.',
        },
      ],
    },
  });

  const result = await service.executeTool('analytics.overview', {
    actor: { userId: 'u-boss', role: 'boss' },
    range: {
      preset: 'custom',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-04',
    },
    filters: {
      groupType: 'retail',
      travelAgency: 'agency-a',
      rawSql: 'select * from sales_orders',
    },
    limit: 1000,
  });

  assert.deepEqual(calls, [
    {
      method: 'getOverview',
      actor: { userId: 'u-boss', role: 'boss' },
      query: {
        groupType: 'retail',
        travelAgency: 'agency-a',
        preset: 'custom',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-04',
      },
    },
  ]);
  assert.equal(result.toolName, 'analytics.overview');
  assert.equal(result.data.grossSalesAmountCents, 100000);
  assert.equal(result.data.refundAmountCents, 10000);
  assert.equal(result.data.netSalesAmountCents, 90000);
  assert.equal(result.data.totalGroupCount, 5);
  assert.equal(result.data.totalGuestCount, 20);
  assert.deepEqual(result.data.averageSales, {
    perGroupCents: 18000,
    perGuestCents: 4500,
  });
  assert.equal(result.data.noOrderRate, 0.2);
  assert.deepEqual(result.sourceSummary, {
    rowCount: 5,
    dateFrom: '2026-07-01',
    dateTo: '2026-07-04',
    globalMarkedFilterEnabled: true,
    scopeDescription: result.sourceSummary.scopeDescription,
  });
  assert.equal(result.sourceSummary.scopeDescription.length > 0, true);
  assert.deepEqual(result.warnings, [
    'pending_refund: Pending refunds are excluded from net sales.',
  ]);
});

test('unit: AI analytics trends tool returns compact trend points', async () => {
  const calls = [];
  const service = createServiceWithAnalytics({
    calls,
    trendsResult: {
      range: {
        preset: 'custom',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-02',
        timezone: 'Asia/Shanghai',
      },
      granularity: 'day',
      metric: 'net_sales',
      trends: [
        {
          periodStart: '2026-07-01',
          periodEnd: '2026-07-01',
          metricValue: 90000,
          grossSalesAmountCents: 100000,
          refundAmountCents: 10000,
          pendingRefundAmountCents: 0,
          netSalesAmountCents: 90000,
          totalGroupCount: 1,
          totalGuestCount: 8,
          groupScopedNetSalesAmountCents: 90000,
          noEffectiveOrderGroupCount: 0,
          conversionGroupCount: 1,
          noOrderRate: 0,
          conversionRate: 1,
          orderDetails: [{ id: 'should-not-leak' }],
        },
      ],
    },
  });

  const result = await service.executeTool('analytics.trends', {
    actor: { userId: 'u-finance', role: 'finance' },
    range: {
      preset: 'custom',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-02',
    },
    filters: {
      metric: 'net_sales',
      granularity: 'day',
      tasterId: 'taster-1',
    },
  });

  assert.deepEqual(calls, [
    {
      method: 'listTrends',
      actor: { userId: 'u-finance', role: 'finance' },
      query: {
        metric: 'net_sales',
        granularity: 'day',
        tasterId: 'taster-1',
        preset: 'custom',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-02',
      },
    },
  ]);
  assert.equal(result.toolName, 'analytics.trends');
  assert.equal(result.data.metric, 'net_sales');
  assert.equal(result.data.granularity, 'day');
  assert.equal(result.data.trends.length, 1);
  assert.equal(result.data.trends[0].grossSalesAmountCents, 100000);
  assert.equal(result.data.trends[0].netSalesAmountCents, 90000);
  assert.equal(result.data.trends[0].totalGroupCount, 1);
  assert.equal(result.data.trends[0].noOrderRate, 0);
  assert.equal(Object.hasOwn(result.data.trends[0], 'orderDetails'), false);
  assert.deepEqual(result.sourceSummary, {
    rowCount: 1,
    dateFrom: '2026-07-01',
    dateTo: '2026-07-02',
    globalMarkedFilterEnabled: false,
    scopeDescription: result.sourceSummary.scopeDescription,
  });
});

test('unit: AI taster rankings tool delegates sort and default top 10 query', async () => {
  const calls = [];
  const service = createServiceWithAnalytics({
    calls,
    globalMarkedFilterEnabled: true,
    tasterRankingsResult: {
      range: {
        preset: 'custom',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-04',
        timezone: 'Asia/Shanghai',
      },
      rankings: [
        {
          rank: 1,
          tasterId: 'taster-c',
          tasterName: 'Taster C',
          totalGroupCount: 3,
          totalGuestCount: 30,
          grossSalesAmountCents: 0,
          refundAmountCents: 0,
          netSalesAmountCents: 0,
          averageSalesPerGroupCents: 0,
          averageSalesPerGuestCents: 0,
          noEffectiveOrderGroupCount: 3,
          conversionGroupCount: 0,
          noOrderRate: 1,
          conversionRate: 0,
          warnings: [],
          customerPhone: 'should-not-leak',
        },
        {
          rank: 2,
          tasterId: 'taster-a',
          tasterName: 'Taster A',
          totalGroupCount: 2,
          totalGuestCount: 20,
          grossSalesAmountCents: 100000,
          refundAmountCents: 10000,
          netSalesAmountCents: 90000,
          averageSalesPerGroupCents: 45000,
          averageSalesPerGuestCents: 4500,
          noEffectiveOrderGroupCount: 1,
          conversionGroupCount: 1,
          noOrderRate: 0.5,
          conversionRate: 0.5,
          warnings: [
            {
              code: 'pending_refund',
              message: 'Pending refunds are excluded from net sales.',
            },
          ],
        },
      ],
    },
  });

  const result = await service.executeTool('analytics.tasterRankings', {
    actor: { userId: 'u-boss', role: 'boss' },
    range: {
      preset: 'custom',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-04',
    },
    filters: {
      sortBy: 'noOrderRate',
      sortDirection: 'desc',
      groupType: 'retail',
      travelAgency: 'Ranking Agency',
      customerPhone: 'should-not-pass',
    },
  });

  assert.deepEqual(calls, [
    {
      method: 'listTasterRankings',
      actor: { userId: 'u-boss', role: 'boss' },
      query: {
        groupType: 'retail',
        travelAgency: 'Ranking Agency',
        preset: 'custom',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-04',
        sortBy: 'noOrderRate',
        sortDirection: 'desc',
        limit: 10,
      },
    },
  ]);
  assert.equal(result.toolName, 'analytics.tasterRankings');
  assert.equal(result.data.rankings.length, 2);
  assert.equal(result.data.rankings[0].tasterId, 'taster-c');
  assert.equal(result.data.rankings[0].noOrderRate, 1);
  assert.equal(result.data.rankings[1].netSalesAmountCents, 90000);
  assert.equal(Object.hasOwn(result.data.rankings[0], 'customerPhone'), false);
  assert.equal(result.sourceSummary.rowCount, 2);
  assert.equal(result.sourceSummary.globalMarkedFilterEnabled, true);
  assert.deepEqual(result.warnings, [
    'pending_refund: Pending refunds are excluded from net sales.',
  ]);
});

test('unit: AI taster rankings supports explicit limit and rejects unsupported sort fields', async () => {
  const calls = [];
  const service = createServiceWithAnalytics({ calls });

  await service.executeTool('analytics.tasterRankings', {
    actor: { userId: 'u-finance', role: 'finance' },
    filters: {
      sortBy: 'netSalesAmountCents',
      sortDirection: 'desc',
    },
    limit: 3,
  });
  assert.equal(calls[0].query.limit, 3);
  assert.equal(calls[0].query.sortBy, 'netSalesAmountCents');

  await assertToolExecutionError(
    service,
    'analytics.tasterRankings',
    {
      actor: { userId: 'u-finance', role: 'finance' },
      filters: { sortBy: 'conversionRate' },
    },
    'AI_INVALID_TASTER_RANKING_SORT_BY',
    400,
  );
});

test('unit: AI taster detail tool returns compact safe detail summary', async () => {
  const calls = [];
  const service = createServiceWithAnalytics({
    calls,
    tasterDetailResult: {
      range: {
        preset: 'custom',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-04',
        timezone: 'Asia/Shanghai',
      },
      taster: {
        id: 'taster-a',
        name: 'Taster A',
      },
      summary: {
        rank: 1,
        tasterId: 'taster-a',
        tasterName: 'Taster A',
        totalGroupCount: 2,
        totalGuestCount: 20,
        grossSalesAmountCents: 100000,
        refundAmountCents: 10000,
        netSalesAmountCents: 90000,
        averageSalesPerGroupCents: 45000,
        averageSalesPerGuestCents: 4500,
        noEffectiveOrderGroupCount: 1,
        conversionGroupCount: 1,
        noOrderRate: 0.5,
        conversionRate: 0.5,
        warnings: [
          {
            code: 'pending_refund',
            message: 'Pending refunds are excluded from net sales.',
          },
        ],
      },
      travelGroups: [
        {
          id: 'group-a1',
          travelAgency: 'should-not-leak',
        },
        { id: 'group-a2' },
      ],
      orders: [
        {
          id: 'order-a1',
          customerPhone: 'should-not-leak',
          items: [{ productName: 'should-not-leak' }],
        },
      ],
      afterSalesOrders: [{ id: 'after-sales-a1' }],
      warnings: [
        {
          code: 'pending_refund',
          message: 'Pending refunds are excluded from net sales.',
        },
      ],
    },
  });

  const result = await service.executeTool('analytics.tasterDetail', {
    actor: { userId: 'u-admin', role: 'admin' },
    range: {
      preset: 'custom',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-04',
    },
    filters: {
      tasterId: 'taster-a',
      sortBy: 'netSalesAmountCents',
      sortDirection: 'desc',
    },
  });

  assert.deepEqual(calls, [
    {
      method: 'getTasterRankingDetail',
      actor: { userId: 'u-admin', role: 'admin' },
      tasterId: 'taster-a',
      query: {
        tasterId: 'taster-a',
        preset: 'custom',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-04',
        sortBy: 'netSalesAmountCents',
        sortDirection: 'desc',
        limit: 200,
      },
    },
  ]);
  assert.equal(result.toolName, 'analytics.tasterDetail');
  assert.deepEqual(result.data.taster, {
    id: 'taster-a',
    name: 'Taster A',
  });
  assert.equal(result.data.summary.netSalesAmountCents, 90000);
  assert.deepEqual(result.data.sourceCounts, {
    travelGroupCount: 2,
    orderCount: 1,
    afterSalesOrderCount: 1,
  });
  assert.deepEqual(result.data.sourceIds, {
    travelGroupIds: ['group-a1', 'group-a2'],
    orderIds: ['order-a1'],
    afterSalesOrderIds: ['after-sales-a1'],
  });
  assert.equal(Object.hasOwn(result.data, 'orders'), false);
  assert.equal(Object.hasOwn(result.data, 'travelGroups'), false);
  assert.equal(Object.hasOwn(result.data, 'afterSalesOrders'), false);
  assert.equal(result.sourceSummary.rowCount, 2);
  assert.deepEqual(result.warnings, [
    'pending_refund: Pending refunds are excluded from net sales.',
  ]);
});

test('unit: AI taster tools enforce company-level ranking permissions', async () => {
  const service = createServiceWithAnalytics();

  await service.executeTool('analytics.tasterRankings', {
    actor: { userId: 'u-finance', role: 'finance' },
  });
  await assertToolExecutionError(
    service,
    'analytics.tasterRankings',
    { actor: { userId: 'u-after-sales', role: 'after_sales' } },
    'AI_PERMISSION_DENIED',
    403,
  );
  for (const role of ['warehouse', 'sales', 'taster', 'front_desk']) {
    await assertToolExecutionError(
      service,
      'analytics.tasterDetail',
      { actor: { userId: `u-${role}`, role }, filters: { tasterId: 't1' } },
      'AI_ROLE_NOT_ALLOWED',
      403,
    );
  }
});

test('unit: AI taster detail requires a tasterId filter', async () => {
  const service = createServiceWithAnalytics();

  await assertToolExecutionError(
    service,
    'analytics.tasterDetail',
    { actor: { userId: 'u-admin', role: 'admin' } },
    'AI_TASTER_ID_REQUIRED',
    400,
  );
});

test('unit: AI analytics tools reject roles outside the policy matrix', async () => {
  const service = createServiceWithAnalytics();

  await service.executeTool('analytics.overview', {
    actor: { userId: 'u-finance', role: 'finance' },
  });
  await service.executeTool('analytics.trends', {
    actor: { userId: 'u-finance', role: 'finance' },
  });
  await assertToolExecutionError(
    service,
    'analytics.overview',
    { actor: { userId: 'u-after-sales', role: 'after_sales' } },
    'AI_PERMISSION_DENIED',
    403,
  );
});

test('unit: AI analytics tools handle empty overview and trend data', async () => {
  const service = createServiceWithAnalytics({
    overviewResult: {
      range: {
        preset: 'custom',
        dateFrom: '2026-08-01',
        dateTo: '2026-08-01',
        timezone: 'Asia/Shanghai',
      },
      metrics: {},
      warnings: [],
    },
    trendsResult: {
      range: {
        preset: 'custom',
        dateFrom: '2026-08-01',
        dateTo: '2026-08-01',
        timezone: 'Asia/Shanghai',
      },
      granularity: 'day',
      metric: 'net_sales',
      trends: [],
    },
  });

  const overview = await service.executeTool('analytics.overview', {
    actor: { userId: 'u-admin', role: 'admin' },
  });
  assert.equal(overview.data.grossSalesAmountCents, 0);
  assert.equal(overview.data.totalGroupCount, 0);
  assert.equal(overview.data.averageSales.perGroupCents, 0);
  assert.equal(overview.sourceSummary.rowCount, 0);

  const trends = await service.executeTool('analytics.trends', {
    actor: { userId: 'u-admin', role: 'admin' },
  });
  assert.deepEqual(trends.data.trends, []);
  assert.equal(trends.sourceSummary.rowCount, 0);
});

test('unit: AI finance summary tool delegates to stage 6 and 7 read-only services', async () => {
  const calls = [];
  const service = createServiceWithFinanceTools({
    calls,
    globalMarkedFilterEnabled: true,
    financeWorkbenchResult: {
      metrics: {
        travelGroupCount: 2,
        orderCount: 3,
        grossSalesAmountCents: 300000,
        salesAmountCents: 300000,
        refundAmountCents: 40000,
        pendingAfterSalesRefundAmountCents: 12000,
        netSalesAmountCents: 260000,
        logisticsFeeCents: 9000,
        pendingInvoiceCount: 1,
        pendingCustomerMarkCount: 0,
        pendingTravelGroupMarkCount: 0,
        pendingAfterSalesConfirmCount: 1,
        cashOnDeliveryAmountCents: 50000,
      },
      pendingAfterSales: [
        {
          id: 'as-pending',
          afterSalesNo: 'AS20260704001',
          salesOrderId: 'order-1',
          refundAmountCents: 12000,
          financeConfirmed: false,
          description: 'should-not-leak',
          salesOrder: {
            id: 'order-1',
            orderNo: 'SO001',
            customerPhone: 'should-not-leak',
            travelGroupId: 'group-1',
            travelGroup: { groupNo: 'TG001' },
          },
          createdAt: '2026-07-04T01:00:00.000Z',
        },
      ],
      pendingLogistics: [
        {
          id: 'order-2',
          orderNo: 'SO002',
          logisticsNo: null,
          logisticsFeeCents: 0,
          reasons: ['missing_logistics_no', 'missing_logistics_fee'],
        },
      ],
    },
    commissionRecords: [
      {
        id: 'commission-1',
        targetType: 'sales_commission',
        salesOrderId: 'order-1',
        salesOrderNo: 'SO001',
        travelGroupId: 'group-1',
        travelGroup: { groupNo: 'TG001' },
        targetUser: {
          id: 'sales-1',
          name: 'Sales A',
          role: 'sales',
          username: 'should-not-leak',
        },
        amountCents: 18000,
        pointsCents: 0,
        isConfirmed: true,
        sourceSnapshot: { password: 'should-not-leak' },
      },
      {
        id: 'commission-2',
        targetType: 'agency_daily_rebate',
        salesOrderId: 'order-2',
        salesOrderNo: 'SO002',
        travelGroupId: 'group-1',
        amountCents: 0,
        pointsCents: 6000,
        isConfirmed: false,
      },
    ],
    travelGroupFinanceSummaries: [
      {
        id: 'summary-1',
        travelGroupId: 'group-1',
        travelGroup: {
          id: 'group-1',
          groupNo: 'TG001',
          visitDate: '2026-07-04',
          financeMark: true,
        },
        totalSalesAmountCents: 300000,
        confirmedRefundAmountCents: 40000,
        effectiveSalesAmountCents: 260000,
        totalAgencyDeductionCents: 20000,
        totalAgencyNetAmountCents: 240000,
        totalDailyRebateCents: 6000,
        totalMonthlyRebateCents: 4000,
        paidRebateCents: 3000,
        unpaidRebateCents: 7000,
      },
    ],
  });

  const result = await service.executeTool('finance.summary', {
    actor: { userId: 'u-finance', role: 'finance' },
    range: {
      preset: 'custom',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-04',
    },
    filters: {
      query: 'TG001',
      travelGroupId: 'group-1',
      rawSql: 'select * from commission_records',
    },
    limit: 5,
  });

  assert.deepEqual(calls, [
    {
      method: 'getFinanceWorkbench',
      actor: { userId: 'u-finance', role: 'finance' },
      query: {
        query: 'TG001',
        travelGroupId: 'group-1',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-04',
        limit: 5,
      },
    },
    {
      method: 'listCommissionRecords',
      actor: { userId: 'u-finance', role: 'finance' },
      query: {
        query: 'TG001',
        travelGroupId: 'group-1',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-04',
        limit: 200,
      },
    },
    {
      method: 'listTravelGroupFinanceSummaries',
      actor: { userId: 'u-finance', role: 'finance' },
      query: {
        query: 'TG001',
        travelGroupId: 'group-1',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-04',
        limit: 200,
      },
    },
  ]);
  assert.equal(result.toolName, 'finance.summary');
  assert.equal(result.data.refunds.confirmedRefundAmountCents, 40000);
  assert.equal(result.data.refunds.pendingRefundAmountCents, 12000);
  assert.equal(result.data.logistics.logisticsFeeCents, 9000);
  assert.equal(result.data.commission.totalAmountCents, 18000);
  assert.equal(result.data.commission.totalPointsCents, 6000);
  assert.equal(result.data.points.unpaidRebateCents, 7000);
  assert.equal(
    Object.hasOwn(result.data.refunds.pendingItems[0], 'description'),
    false,
  );
  assert.equal(result.data.commission.byTargetType.length, 2);
  assert.equal(result.sourceSummary.globalMarkedFilterEnabled, true);
  assert.equal(result.sourceSummary.rowCount, 6);
});

test('unit: AI refund query returns confirmed and pending refund summaries safely', async () => {
  const calls = [];
  const service = createServiceWithFinanceTools({
    calls,
    globalMarkedFilterEnabled: true,
    afterSalesOrders: [
      {
        id: 'as-confirmed',
        afterSalesNo: 'AS001',
        salesOrderId: 'order-1',
        issueType: 'quality_issue',
        actionType: 'refund',
        status: 'completed',
        refundAmountCents: 30000,
        financeConfirmed: true,
        financeConfirmedAt: '2026-07-02T00:00:00.000Z',
        description: 'should-not-leak',
        notes: 'should-not-leak',
        salesOrder: {
          id: 'order-1',
          orderNo: 'SO001',
          customerPhone: 'should-not-leak',
          address: 'should-not-leak',
          travelGroupId: 'group-1',
          travelGroup: { groupNo: 'TG001' },
        },
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 'as-pending',
        afterSalesNo: 'AS002',
        salesOrderId: 'order-2',
        issueType: 'logistics_damage',
        actionType: 'return_refund',
        status: 'waiting_refund',
        refundAmountCents: 12000,
        financeConfirmed: false,
        salesOrder: {
          id: 'order-2',
          orderNo: 'SO002',
          travelGroupId: 'group-2',
          travelGroup: { groupNo: 'TG002' },
        },
        createdAt: '2026-07-03T00:00:00.000Z',
      },
      {
        id: 'as-no-refund',
        afterSalesNo: 'AS003',
        refundAmountCents: 0,
        financeConfirmed: false,
      },
    ],
  });

  const result = await service.executeTool('refund.query', {
    actor: { userId: 'u-admin', role: 'admin' },
    range: {
      preset: 'custom',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-04',
    },
    filters: {
      actionType: 'refund',
      customerId: 'customer-1',
      rawSql: 'select phone from customers',
    },
    limit: 2,
  });

  assert.deepEqual(calls, [
    {
      method: 'listAfterSalesOrders',
      actor: { userId: 'u-admin', role: 'admin' },
      query: {
        customerId: 'customer-1',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-04',
        actionType: 'refund',
        limit: 2,
      },
    },
  ]);
  assert.deepEqual(result.data.summary, {
    refundCount: 2,
    confirmedRefundCount: 1,
    pendingRefundCount: 1,
    confirmedRefundAmountCents: 30000,
    pendingRefundAmountCents: 12000,
  });
  assert.equal(result.data.refunds.length, 2);
  assert.equal(result.data.refunds[0].salesOrderNo, 'SO001');
  assert.equal(Object.hasOwn(result.data.refunds[0], 'customerPhone'), false);
  assert.equal(Object.hasOwn(result.data.refunds[0], 'address'), false);
  assert.equal(Object.hasOwn(result.data.refunds[0], 'notes'), false);
  assert.equal(result.sourceSummary.globalMarkedFilterEnabled, true);
});

test('unit: AI commission query returns generated records without sensitive fields', async () => {
  const calls = [];
  const service = createServiceWithFinanceTools({
    calls,
    commissionRecords: [
      {
        id: 'commission-1',
        targetType: 'sales_commission',
        salesOrderId: 'order-1',
        salesOrderNo: 'SO001',
        travelGroupId: 'group-1',
        travelGroup: { groupNo: 'TG001' },
        targetUser: {
          id: 'sales-1',
          name: 'Sales A',
          username: 'should-not-leak',
          role: 'sales',
          salary: 'should-not-leak',
        },
        agency: { id: 'agency-1', name: 'Agency A' },
        grossAmountCents: 100000,
        confirmedRefundAmountCents: 10000,
        baseAmountCents: 90000,
        deductionAmountCents: 5000,
        amountCents: 18000,
        pointsCents: 0,
        manualInput: false,
        isConfirmed: true,
        sourceSnapshot: { token: 'should-not-leak' },
        ruleSnapshot: { password: 'should-not-leak' },
      },
      {
        id: 'commission-2',
        targetType: 'agency_daily_rebate',
        salesOrderId: 'order-2',
        salesOrderNo: 'SO002',
        travelGroupId: 'group-1',
        amountCents: 0,
        pointsCents: 6000,
        manualInput: false,
        isConfirmed: false,
      },
    ],
  });

  const result = await service.executeTool('commission.query', {
    actor: { userId: 'u-boss', role: 'boss' },
    range: {
      preset: 'custom',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-04',
    },
    filters: {
      targetType: 'sales_commission',
      isConfirmed: true,
      query: 'SO001',
      password: 'should-not-pass',
    },
    limit: 10,
  });

  assert.deepEqual(calls, [
    {
      method: 'listCommissionRecords',
      actor: { userId: 'u-boss', role: 'boss' },
      query: {
        query: 'SO001',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-04',
        targetType: 'sales_commission',
        isConfirmed: true,
        limit: 10,
      },
    },
  ]);
  assert.equal(result.data.summary.recordCount, 2);
  assert.equal(result.data.summary.totalAmountCents, 18000);
  assert.equal(result.data.summary.totalPointsCents, 6000);
  assert.equal(result.data.records[0].targetUser.name, 'Sales A');
  assert.equal(
    Object.hasOwn(result.data.records[0].targetUser, 'username'),
    false,
  );
  assert.equal(Object.hasOwn(result.data.records[0], 'sourceSnapshot'), false);
  assert.equal(Object.hasOwn(result.data.records[0], 'ruleSnapshot'), false);
});

test('unit: AI travel group finance summary supports list and detail read-only calls', async () => {
  const detailCalls = [];
  const detailService = createServiceWithFinanceTools({
    calls: detailCalls,
    travelGroupFinanceSummary: {
      id: 'summary-1',
      travelGroupId: 'group-1',
      travelGroup: {
        id: 'group-1',
        groupNo: 'TG001',
        visitDate: '2026-07-04',
        travelAgency: 'Agency A',
        financeMark: true,
      },
      totalSalesAmountCents: 100000,
      confirmedRefundAmountCents: 10000,
      effectiveSalesAmountCents: 90000,
      totalAgencyDeductionCents: 5000,
      totalAgencyNetAmountCents: 85000,
      totalDailyRebateCents: 3000,
      totalMonthlyRebateCents: 2000,
      paidRebateCents: 1000,
      unpaidRebateCents: 4000,
      sourceSnapshot: {
        orderCount: 2,
        agencyRebateRecords: {
          dailyCount: 1,
          monthlyCount: 1,
        },
        phone: 'should-not-leak',
      },
    },
  });

  const detail = await detailService.executeTool('travelGroup.financeSummary', {
    actor: { userId: 'u-finance', role: 'finance' },
    filters: {
      travelGroupId: 'group-1',
    },
  });

  assert.deepEqual(detailCalls, [
    {
      method: 'getTravelGroupFinanceSummary',
      actor: { userId: 'u-finance', role: 'finance' },
      travelGroupId: 'group-1',
    },
  ]);
  assert.equal(detail.data.summary.travelGroup.groupNo, 'TG001');
  assert.deepEqual(detail.data.sourceCounts, {
    orderCount: 2,
    dailyRebateRecordCount: 1,
    monthlyRebateRecordCount: 1,
  });
  assert.equal(Object.hasOwn(detail.data.summary, 'sourceSnapshot'), false);

  const listCalls = [];
  const listService = createServiceWithFinanceTools({
    calls: listCalls,
    travelGroupFinanceSummaries: [
      defaultTravelGroupFinanceSummary(),
      {
        ...defaultTravelGroupFinanceSummary(),
        id: 'summary-2',
        travelGroupId: 'group-2',
        paidRebateCents: 2000,
        unpaidRebateCents: 3000,
      },
    ],
  });
  const list = await listService.executeTool('travelGroup.financeSummary', {
    actor: { userId: 'u-admin', role: 'admin' },
    range: {
      preset: 'custom',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-04',
    },
    filters: { agencyDeductionConfirmed: false },
  });

  assert.deepEqual(listCalls, [
    {
      method: 'listTravelGroupFinanceSummaries',
      actor: { userId: 'u-admin', role: 'admin' },
      query: {
        dateFrom: '2026-07-01',
        dateTo: '2026-07-04',
        agencyDeductionConfirmed: false,
        limit: 20,
      },
    },
  ]);
  assert.equal(list.data.summaries.length, 2);
  assert.equal(list.data.totals.recordCount, 2);
  assert.equal(list.data.totals.paidRebateCents, 3000);
  assert.equal(list.data.totals.unpaidRebateCents, 7000);
});

test('unit: AI finance tools enforce role matrix for admin boss finance and after-sales', async () => {
  const service = createServiceWithFinanceTools();

  for (const role of ['admin', 'boss', 'finance']) {
    await service.executeTool('finance.summary', {
      actor: { userId: `u-${role}`, role },
    });
    await service.executeTool('commission.query', {
      actor: { userId: `u-${role}`, role },
    });
  }

  for (const toolName of [
    'finance.summary',
    'refund.query',
    'commission.query',
    'travelGroup.financeSummary',
  ]) {
    await assertToolExecutionError(
      service,
      toolName,
      { actor: { userId: 'u-after-sales', role: 'after_sales' } },
      'AI_PERMISSION_DENIED',
      403,
    );
  }
});

test('unit: AI customer lookup supports phone fragments and masks customer privacy', async () => {
  const calls = [];
  const service = createServiceWithCustomerTools({
    calls,
    globalMarkedFilterEnabled: true,
    customers: [
      {
        id: 'customer-1',
        name: '张三',
        phone: '13800008000',
        province: '贵州省',
        city: '遵义市',
        district: '红花岗区',
        address: 'should-not-leak',
        notes: 'should-not-leak',
        financeMark: true,
      },
    ],
    salesOrders: [
      sampleSalesOrder({
        id: 'order-phone',
        orderNo: 'SO-PHONE',
        customerId: 'customer-1',
        customerName: '张三',
        customerPhone: '13800008000',
      }),
    ],
  });

  const result = await service.executeTool('customer.lookup', {
    actor: { userId: 'u-after-sales', role: 'after_sales' },
    filters: {
      phone: '138',
      rawSql: 'select * from customers',
    },
    limit: 5,
  });

  assert.deepEqual(calls, [
    {
      method: 'listCustomers',
      actor: { userId: 'u-after-sales', role: 'after_sales' },
      query: {
        query: '138',
        phone: '138',
        limit: 5,
      },
    },
    {
      method: 'listSalesOrders',
      actor: { userId: 'u-after-sales', role: 'after_sales' },
      query: {
        query: '138',
        customerPhone: '138',
        limit: 5,
      },
    },
  ]);
  assert.equal(result.data.customers[0].phoneMasked, '138****8000');
  assert.equal(Object.hasOwn(result.data.customers[0], 'phone'), false);
  assert.equal(Object.hasOwn(result.data.customers[0], 'address'), false);
  assert.equal(Object.hasOwn(result.data.customers[0], 'notes'), false);
  assert.equal(result.data.matchedOrders[0].customer.phoneMasked, '138****8000');
  assert.equal(result.sourceSummary.globalMarkedFilterEnabled, true);
});

test('unit: AI customer lookup supports customer name search', async () => {
  const calls = [];
  const service = createServiceWithCustomerTools({
    calls,
    customers: [
      {
        id: 'customer-name',
        name: '李四',
        phone: '13900009000',
        financeMark: true,
      },
    ],
    salesOrders: [],
  });

  const result = await service.executeTool('customer.lookup', {
    actor: { userId: 'u-admin', role: 'admin' },
    filters: {
      name: '李四',
    },
  });

  assert.equal(calls[0].method, 'listCustomers');
  assert.equal(calls[0].query.query, '李四');
  assert.equal(calls[1].method, 'listSalesOrders');
  assert.equal(calls[1].query.query, '李四');
  assert.equal(result.data.customers[0].name, '李四');
  assert.equal(result.data.customers[0].phoneMasked, '139****9000');
});

test('unit: AI customer order lookup supports order number and returns compact order summaries', async () => {
  const calls = [];
  const service = createServiceWithCustomerTools({
    calls,
    salesOrders: [
      sampleSalesOrder({
        id: 'order-1',
        orderNo: 'SO20260704001',
        customerName: '王五',
        customerPhone: '13700007000',
        address: 'should-not-leak',
        items: [
          {
            id: 'item-1',
            productName: '酱香酒',
            quantity: 2,
            subtotalCents: 20000,
            deliveryType: 'shipping',
            notes: 'should-not-leak',
          },
        ],
      }),
    ],
    afterSalesOrders: [
      sampleAfterSalesOrder({
        id: 'as-1',
        afterSalesNo: 'AS20260704001',
        salesOrderId: 'order-1',
        refundAmountCents: 5000,
        financeConfirmed: false,
        salesOrder: sampleSalesOrder({
          id: 'order-1',
          orderNo: 'SO20260704001',
          customerName: '王五',
          customerPhone: '13700007000',
        }),
      }),
    ],
  });

  const result = await service.executeTool('customer.orderLookup', {
    actor: { userId: 'u-boss', role: 'boss' },
    filters: {
      orderNo: 'SO20260704001',
      password: 'should-not-pass',
    },
    limit: 3,
  });

  assert.deepEqual(calls, [
    {
      method: 'listSalesOrders',
      actor: { userId: 'u-boss', role: 'boss' },
      query: {
        query: 'SO20260704001',
        limit: 3,
      },
    },
    {
      method: 'listAfterSalesOrders',
      actor: { userId: 'u-boss', role: 'boss' },
      query: {
        query: 'SO20260704001',
        limit: 3,
      },
    },
  ]);
  assert.equal(result.data.orders[0].orderNo, 'SO20260704001');
  assert.equal(result.data.orders[0].customer.phoneMasked, '137****7000');
  assert.equal(result.data.orders[0].products.itemCount, 1);
  assert.equal(result.data.orders[0].products.items[0].productName, '酱香酒');
  assert.equal(result.data.orders[0].afterSalesSummary.afterSalesCount, 1);
  assert.equal(Object.hasOwn(result.data.orders[0], 'address'), false);
  assert.equal(Object.hasOwn(result.data.orders[0].customer, 'phone'), false);
  assert.equal(Object.hasOwn(result.data.orders[0].products.items[0], 'notes'), false);
});

test('unit: AI after-sales lookup supports phone query and after-sales role', async () => {
  const calls = [];
  const service = createServiceWithCustomerTools({
    calls,
    globalMarkedFilterEnabled: true,
    afterSalesOrders: [
      sampleAfterSalesOrder({
        id: 'as-phone',
        afterSalesNo: 'AS-PHONE',
        salesOrderId: 'order-phone',
        status: 'waiting_refund',
        refundAmountCents: 8000,
        financeConfirmed: false,
        salesOrder: sampleSalesOrder({
          id: 'order-phone',
          orderNo: 'SO-PHONE',
          customerName: '赵六',
          customerPhone: '13600006000',
        }),
      }),
    ],
  });

  const result = await service.executeTool('afterSales.lookup', {
    actor: { userId: 'u-after-sales', role: 'after_sales' },
    filters: {
      customerPhone: '136',
      status: 'waiting_refund',
    },
  });

  assert.deepEqual(calls, [
    {
      method: 'listAfterSalesOrders',
      actor: { userId: 'u-after-sales', role: 'after_sales' },
      query: {
        query: '136',
        status: 'waiting_refund',
        limit: 10,
      },
    },
  ]);
  assert.equal(result.data.summary.afterSalesCount, 1);
  assert.equal(result.data.summary.pendingRefundAmountCents, 8000);
  assert.equal(result.data.afterSales[0].customer.phoneMasked, '136****6000');
  assert.equal(result.sourceSummary.globalMarkedFilterEnabled, true);
});

test('unit: AI logistics lookup supports logistics number and finance read scope', async () => {
  const calls = [];
  const service = createServiceWithCustomerTools({
    calls,
    salesOrders: [
      sampleSalesOrder({
        id: 'order-logistics',
        orderNo: 'SO-LOGISTICS',
        customerName: '钱七',
        customerPhone: '13500005000',
        logisticsMethod: '顺丰',
        logisticsNo: 'SF123456789',
        logisticsFeeCents: 3200,
        invoiceRequired: true,
        invoiceIssued: false,
      }),
    ],
  });

  const result = await service.executeTool('logistics.lookup', {
    actor: { userId: 'u-finance', role: 'finance' },
    filters: {
      logisticsNo: 'SF123456789',
    },
  });

  assert.deepEqual(calls, [
    {
      method: 'listSalesOrders',
      actor: { userId: 'u-finance', role: 'finance' },
      query: {
        query: 'SF123456789',
        deliveryType: 'shipping',
        limit: 10,
      },
    },
  ]);
  assert.equal(result.data.summary.logisticsFeeCents, 3200);
  assert.equal(result.data.summary.pendingInvoiceCount, 1);
  assert.equal(result.data.logistics[0].logisticsNo, 'SF123456789');
  assert.equal(result.data.logistics[0].customer.phoneMasked, '135****5000');
});

test('unit: AI customer and after-sales tools enforce role matrix', async () => {
  const service = createServiceWithCustomerTools();

  for (const toolName of [
    'customer.lookup',
    'customer.orderLookup',
    'afterSales.lookup',
    'logistics.lookup',
  ]) {
    await service.executeTool(toolName, {
      actor: { userId: 'u-after-sales', role: 'after_sales' },
    });
  }
  await service.executeTool('logistics.lookup', {
    actor: { userId: 'u-finance', role: 'finance' },
  });

  await assertToolExecutionError(
    service,
    'customer.orderLookup',
    { actor: { userId: 'u-finance', role: 'finance' } },
    'AI_PERMISSION_DENIED',
    403,
  );
  await assertToolExecutionError(
    service,
    'customer.lookup',
    { actor: { userId: 'u-sales', role: 'sales' } },
    'AI_ROLE_NOT_ALLOWED',
    403,
  );
});

function createService() {
  return new AiToolsService(new AiPolicyService());
}

function createServiceWithAnalytics(options = {}) {
  const calls = options.calls || [];
  const analytics = {
    getOverview: async (actor, query) => {
      calls.push({ method: 'getOverview', actor, query });
      return options.overviewResult || defaultOverviewResult();
    },
    listTrends: async (actor, query) => {
      calls.push({ method: 'listTrends', actor, query });
      return options.trendsResult || defaultTrendsResult();
    },
    listTasterRankings: async (actor, query) => {
      calls.push({ method: 'listTasterRankings', actor, query });
      return options.tasterRankingsResult || defaultTasterRankingsResult();
    },
    getTasterRankingDetail: async (actor, tasterId, query) => {
      calls.push({
        method: 'getTasterRankingDetail',
        actor,
        tasterId,
        query,
      });
      return options.tasterDetailResult || defaultTasterDetailResult();
    },
  };
  const settings = {
    getGlobalMarkQuery: async () => ({
      onlyShowMarkedRecords: Boolean(options.globalMarkedFilterEnabled),
    }),
  };
  return new AiToolsService(new AiPolicyService(), analytics, settings);
}

function createServiceWithFinanceTools(options = {}) {
  const calls = options.calls || [];
  const businessData = {
    getFinanceWorkbench: async (actor, query) => {
      calls.push({ method: 'getFinanceWorkbench', actor, query });
      return options.financeWorkbenchResult || defaultFinanceWorkbenchResult();
    },
    listAfterSalesOrders: async (actor, query) => {
      calls.push({ method: 'listAfterSalesOrders', actor, query });
      return options.afterSalesOrders || defaultAfterSalesOrders();
    },
  };
  const commissionRecords = {
    listCommissionRecords: async (actor, query) => {
      calls.push({ method: 'listCommissionRecords', actor, query });
      return options.commissionRecords || defaultCommissionRecords();
    },
    recalculateSalesOrderRecords: () => {
      calls.push({ method: 'FORBIDDEN_recalculateSalesOrderRecords' });
      throw new Error('AI tools must not recalculate commission records.');
    },
    exportCommissionRecordsXlsx: () => {
      calls.push({ method: 'FORBIDDEN_exportCommissionRecordsXlsx' });
      throw new Error('AI tools must not export commission records.');
    },
  };
  const travelGroupFinanceSummary = {
    listTravelGroupFinanceSummaries: async (actor, query) => {
      calls.push({
        method: 'listTravelGroupFinanceSummaries',
        actor,
        query,
      });
      return (
        options.travelGroupFinanceSummaries || [
          defaultTravelGroupFinanceSummary(),
        ]
      );
    },
    getTravelGroupFinanceSummary: async (actor, travelGroupId) => {
      calls.push({
        method: 'getTravelGroupFinanceSummary',
        actor,
        travelGroupId,
      });
      return (
        options.travelGroupFinanceSummary ||
        defaultTravelGroupFinanceSummary()
      );
    },
    refreshTravelGroupFinanceSummaryForApi: () => {
      calls.push({
        method: 'FORBIDDEN_refreshTravelGroupFinanceSummaryForApi',
      });
      throw new Error('AI tools must not refresh finance summaries.');
    },
    refreshTravelGroupFinanceSummary: () => {
      calls.push({ method: 'FORBIDDEN_refreshTravelGroupFinanceSummary' });
      throw new Error('AI tools must not refresh finance summaries.');
    },
    updateTravelGroupFinanceSummary: () => {
      calls.push({ method: 'FORBIDDEN_updateTravelGroupFinanceSummary' });
      throw new Error('AI tools must not update finance summaries.');
    },
    confirmAgencyDeduction: () => {
      calls.push({ method: 'FORBIDDEN_confirmAgencyDeduction' });
      throw new Error('AI tools must not confirm agency deductions.');
    },
    exportTravelGroupFinanceSummariesXlsx: () => {
      calls.push({
        method: 'FORBIDDEN_exportTravelGroupFinanceSummariesXlsx',
      });
      throw new Error('AI tools must not export finance summaries.');
    },
  };
  const settings = {
    getGlobalMarkQuery: async () => ({
      onlyShowMarkedRecords: Boolean(options.globalMarkedFilterEnabled),
    }),
  };
  return new AiToolsService(
    new AiPolicyService(),
    undefined,
    settings,
    businessData,
    commissionRecords,
    travelGroupFinanceSummary,
  );
}

function createServiceWithCustomerTools(options = {}) {
  const calls = options.calls || [];
  const businessData = {
    listSalesOrders: async (actor, query) => {
      calls.push({ method: 'listSalesOrders', actor, query });
      return options.salesOrders || [sampleSalesOrder()];
    },
    listAfterSalesOrders: async (actor, query) => {
      calls.push({ method: 'listAfterSalesOrders', actor, query });
      return options.afterSalesOrders || [sampleAfterSalesOrder()];
    },
    createAfterSalesOrder: () => {
      calls.push({ method: 'FORBIDDEN_createAfterSalesOrder' });
      throw new Error('AI tools must not create after-sales orders.');
    },
    updateAfterSalesOrderStatus: () => {
      calls.push({ method: 'FORBIDDEN_updateAfterSalesOrderStatus' });
      throw new Error('AI tools must not update after-sales status.');
    },
    updateSalesOrderStatus: () => {
      calls.push({ method: 'FORBIDDEN_updateSalesOrderStatus' });
      throw new Error('AI tools must not update sales order status.');
    },
  };
  const customers = {
    listCustomers: async (actor, query) => {
      calls.push({ method: 'listCustomers', actor, query });
      return options.customers || [sampleCustomer()];
    },
    getCustomer: async (actor, id) => {
      calls.push({ method: 'getCustomer', actor, id });
      return options.customer || { ...sampleCustomer(), id };
    },
    createCustomer: () => {
      calls.push({ method: 'FORBIDDEN_createCustomer' });
      throw new Error('AI tools must not create customers.');
    },
    updateCustomer: () => {
      calls.push({ method: 'FORBIDDEN_updateCustomer' });
      throw new Error('AI tools must not update customers.');
    },
    setCustomerFinanceMark: () => {
      calls.push({ method: 'FORBIDDEN_setCustomerFinanceMark' });
      throw new Error('AI tools must not update customer marks.');
    },
  };
  const settings = {
    getGlobalMarkQuery: async () => ({
      onlyShowMarkedRecords: Boolean(options.globalMarkedFilterEnabled),
    }),
  };
  return new AiToolsService(
    new AiPolicyService(),
    undefined,
    settings,
    businessData,
    undefined,
    undefined,
    customers,
  );
}

function defaultOverviewResult() {
  return {
    range: {
      preset: 'this_month',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-04',
      timezone: 'Asia/Shanghai',
    },
    metrics: {
      grossSalesAmountCents: 0,
      refundAmountCents: 0,
      pendingRefundAmountCents: 0,
      netSalesAmountCents: 0,
      totalGroupCount: 0,
      totalGuestCount: 0,
      groupScopedNetSalesAmountCents: 0,
      averageSalesPerGroupCents: 0,
      averageSalesPerGuestCents: 0,
      noEffectiveOrderGroupCount: 0,
      conversionGroupCount: 0,
      noOrderRate: 0,
      conversionRate: 0,
    },
    warnings: [],
  };
}

function defaultTrendsResult() {
  return {
    range: {
      preset: 'this_month',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-04',
      timezone: 'Asia/Shanghai',
    },
    granularity: 'day',
    metric: 'net_sales',
    trends: [],
  };
}

function defaultTasterRankingsResult() {
  return {
    range: {
      preset: 'this_month',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-04',
      timezone: 'Asia/Shanghai',
    },
    rankings: [],
  };
}

function defaultTasterDetailResult() {
  return {
    range: {
      preset: 'this_month',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-04',
      timezone: 'Asia/Shanghai',
    },
    taster: {
      id: 'taster-a',
      name: 'Taster A',
    },
    summary: {},
    travelGroups: [],
    orders: [],
    afterSalesOrders: [],
    warnings: [],
  };
}

function defaultFinanceWorkbenchResult() {
  return {
    metrics: {
      travelGroupCount: 0,
      orderCount: 0,
      grossSalesAmountCents: 0,
      salesAmountCents: 0,
      refundAmountCents: 0,
      pendingAfterSalesRefundAmountCents: 0,
      legacyRefundOrderAmountCents: 0,
      netSalesAmountCents: 0,
      logisticsFeeCents: 0,
      pendingInvoiceCount: 0,
      pendingCustomerMarkCount: 0,
      pendingTravelGroupMarkCount: 0,
      pendingAfterSalesConfirmCount: 0,
      cashOnDeliveryAmountCents: 0,
    },
    recentOrders: [],
    pendingAfterSales: [],
    pendingMarks: [],
    pendingLogistics: [],
  };
}

function defaultAfterSalesOrders() {
  return [
    {
      id: 'as-default',
      afterSalesNo: 'AS-DEFAULT',
      salesOrderId: 'order-default',
      refundAmountCents: 0,
      financeConfirmed: false,
    },
  ];
}

function defaultCommissionRecords() {
  return [
    {
      id: 'commission-default',
      targetType: 'sales_commission',
      amountCents: 0,
      pointsCents: 0,
      isConfirmed: false,
    },
  ];
}

function defaultTravelGroupFinanceSummary() {
  return {
    id: 'summary-default',
    travelGroupId: 'group-default',
    travelGroup: {
      id: 'group-default',
      groupNo: 'TG-DEFAULT',
      visitDate: '2026-07-04',
      financeMark: true,
    },
    totalSalesAmountCents: 0,
    confirmedRefundAmountCents: 0,
    effectiveSalesAmountCents: 0,
    totalAgencyDeductionCents: 0,
    totalAgencyNetAmountCents: 0,
    totalDailyRebateCents: 0,
    totalMonthlyRebateCents: 0,
    paidRebateCents: 1000,
    unpaidRebateCents: 4000,
  };
}

function sampleCustomer(overrides = {}) {
  return {
    id: 'customer-default',
    name: 'Default Customer',
    phone: '13800000000',
    province: 'Guizhou',
    city: 'Zunyi',
    district: 'Honghuagang',
    address: 'should-not-leak',
    notes: 'should-not-leak',
    financeMark: true,
    recentOrders: [],
    ...overrides,
  };
}

function sampleSalesOrder(overrides = {}) {
  const customer =
    overrides.customer ||
    sampleCustomer({
      id: overrides.customerId || 'customer-default',
      name: overrides.customerName || 'Default Customer',
      phone: overrides.customerPhone || '13800000000',
    });
  return {
    id: 'order-default',
    orderNo: 'SO-DEFAULT',
    orderType: 'travel_group',
    orderDate: '2026-07-04',
    status: 'valid',
    customerId: 'customer-default',
    customerName: 'Default Customer',
    customerPhone: '13800000000',
    customer,
    province: 'Guizhou',
    city: 'Zunyi',
    district: 'Honghuagang',
    address: 'should-not-leak',
    travelGroupId: 'group-default',
    travelGroup: {
      id: 'group-default',
      groupNo: 'TG-DEFAULT',
      visitDate: '2026-07-04',
      travelAgency: 'Default Agency',
      tasterId: 'taster-default',
      tasterName: 'Default Taster',
      financeMark: true,
    },
    totalAmountCents: 100000,
    cashOnDeliveryAmountCents: 0,
    deliverySummary: 'shipping',
    logisticsMethod: 'SF',
    logisticsNo: 'SF000000',
    logisticsFeeCents: 1000,
    packingStatus: 'packed',
    packageCount: 1,
    invoiceRequired: false,
    invoiceIssued: false,
    financeMark: true,
    items: [
      {
        id: 'item-default',
        productName: 'Default Product',
        quantity: 1,
        subtotalCents: 100000,
        deliveryType: 'shipping',
        notes: 'should-not-leak',
      },
    ],
    createdAt: '2026-07-04T00:00:00.000Z',
    ...overrides,
  };
}

function sampleAfterSalesOrder(overrides = {}) {
  const salesOrder =
    overrides.salesOrder ||
    sampleSalesOrder({
      id: overrides.salesOrderId || 'order-default',
    });
  return {
    id: 'as-default',
    afterSalesNo: 'AS-DEFAULT',
    salesOrderId: salesOrder.id,
    salesOrder,
    customerId: salesOrder.customerId,
    customer: salesOrder.customer,
    issueType: 'quality_issue',
    actionType: 'refund',
    status: 'waiting_refund',
    description: 'should-not-leak',
    resolution: 'should-not-leak',
    notes: 'should-not-leak',
    refundAmountCents: 1000,
    financeConfirmed: false,
    financeConfirmedAt: null,
    handledAt: null,
    completedAt: null,
    createdAt: '2026-07-04T01:00:00.000Z',
    ...overrides,
  };
}

function mockDefinition() {
  return {
    toolName: 'analytics.overview',
    intent: 'analytics_overview',
    readOnly: true,
    description: 'test mock tool',
    execute: () => ({
      toolName: 'analytics.overview',
      data: null,
      sourceSummary: {
        rowCount: 0,
        globalMarkedFilterEnabled: false,
        scopeDescription: '',
      },
      warnings: [],
    }),
  };
}

function assertToolRegistrationError(service, definition, code) {
  assert.throws(
    () => service.registerTool(definition),
    (error) => error?.code === code && Number.isInteger(error?.statusCode),
  );
}

async function assertToolExecutionError(
  service,
  toolName,
  input,
  code,
  statusCode,
) {
  await assert.rejects(
    () => service.executeTool(toolName, input),
    (error) => error?.code === code && error?.statusCode === statusCode,
  );
}
