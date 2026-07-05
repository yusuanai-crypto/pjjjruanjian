const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

const CHAT_PATH = '/api/ai/chat';
const HISTORY_PATH = '/api/ai/chat/history';

test('contract: AI backend enforces the full first-version role matrix', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const allowedScenarios = [
        ['stage9-full-admin', 'sales amount 2026-07-01 2026-07-04', 'analytics_overview'],
        ['stage9-full-boss', 'sales amount 2026-07-01 2026-07-04', 'analytics_overview'],
        ['stage9-full-finance', 'refund this month', 'refund_query'],
        ['stage9-full-after-sales', 'customer order 13800000001', 'customer_order_lookup'],
      ];

      for (const [username, question, expectedIntent] of allowedScenarios) {
        const session = await login(baseUrl, username, 'Password123');
        const result = await sendChat(baseUrl, session.token, question, username);
        assert.equal(result.response.status, 201, username);
        assert.equal(result.body.data.intent, expectedIntent, username);
        assert.equal(result.body.data.sourceSummary.length > 0, true, username);
      }

      const disallowedRoles = [
        'stage9-full-warehouse',
        'stage9-full-sales',
        'stage9-full-taster',
        'stage9-full-front-desk',
      ];
      for (const username of disallowedRoles) {
        const session = await login(baseUrl, username, 'Password123');
        const denied = await sendChat(
          baseUrl,
          session.token,
          'sales amount 2026-07-01 2026-07-04',
          username,
        );
        assertErrorContract(denied, 403, 'AI_ROLE_NOT_ALLOWED');
      }

      const finance = await login(baseUrl, 'stage9-full-finance', 'Password123');
      const financeOverreach = await sendChat(
        baseUrl,
        finance.token,
        'business risk management suggestion',
        'finance-overreach',
      );
      assert.equal(financeOverreach.response.status, 201);
      assert.equal(financeOverreach.body.data.intent, 'permission_denied');
      assert.deepEqual(financeOverreach.body.data.sourceSummary, []);

      const afterSales = await login(
        baseUrl,
        'stage9-full-after-sales',
        'Password123',
      );
      const afterSalesOverreach = await sendChat(
        baseUrl,
        afterSales.token,
        'commission this month',
        'after-sales-overreach',
      );
      assert.equal(afterSalesOverreach.response.status, 201);
      assert.equal(afterSalesOverreach.body.data.intent, 'permission_denied');
      assert.deepEqual(afterSalesOverreach.body.data.sourceSummary, []);
    },
    {
      env: enabledMockAiEnv(),
      prisma: buildFullCoveragePrisma(),
    },
  );
});

test('contract: AI backend obeys global marked-record filtering when off and on', async () => {
  await withPhase1Server(
    async (baseUrl, context) => {
      const boss = await login(baseUrl, 'stage9-full-boss', 'Password123');

      setGlobalMarkedFilter(context, false);
      const off = await sendChat(
        baseUrl,
        boss.token,
        'sales amount 2026-07-01 2026-07-04',
        'marked-off',
      );
      assert.equal(off.response.status, 201);
      assertSourceSummary(off.body.data, 'analytics.overview', {
        rowCount: 3,
        globalMarkedFilterEnabled: false,
      });
      const offRecord = latestRecord(context, 'marked-off');
      assert.equal(offRecord.toolCalls[0].globalMarkedFilterEnabled, false);
      assert.equal(offRecord.sourceSummary[0].rowCount, 3);

      setGlobalMarkedFilter(context, true);
      const on = await sendChat(
        baseUrl,
        boss.token,
        'sales amount 2026-07-01 2026-07-04',
        'marked-on',
      );
      assert.equal(on.response.status, 201);
      assertSourceSummary(on.body.data, 'analytics.overview', {
        rowCount: 2,
        globalMarkedFilterEnabled: true,
      });
      const onRecord = latestRecord(context, 'marked-on');
      assert.equal(onRecord.toolCalls[0].globalMarkedFilterEnabled, true);
      assert.equal(onRecord.sourceSummary[0].rowCount, 2);
      assert.equal(JSON.stringify(on.body.data).includes('200000'), false);
    },
    {
      env: enabledMockAiEnv(),
      prisma: buildFullCoveragePrisma(),
    },
  );
});

test('contract: AI backend answers boss sales, ranking, no-order-rate, and management suggestion questions', async () => {
  await withPhase1Server(
    async (baseUrl, context) => {
      const boss = await login(baseUrl, 'stage9-full-boss', 'Password123');

      const sales = await sendChat(
        baseUrl,
        boss.token,
        'sales amount 2026-07-01 2026-07-04',
        'boss-sales',
      );
      assert.equal(sales.response.status, 201);
      assert.equal(sales.body.data.intent, 'analytics_overview');
      assertSourceSummary(sales.body.data, 'analytics.overview', {
        rowCount: 3,
        globalMarkedFilterEnabled: false,
      });
      assertRecordTools(context, 'boss-sales', ['analytics.overview']);

      const ranking = await sendChat(
        baseUrl,
        boss.token,
        'taster ranking top 2026-07-01 2026-07-04',
        'boss-ranking',
      );
      assert.equal(ranking.response.status, 201);
      assert.equal(ranking.body.data.intent, 'taster_ranking');
      assertSourceSummary(ranking.body.data, 'analytics.tasterRankings', {
        rowCount: 2,
        globalMarkedFilterEnabled: false,
      });
      assertRecordTools(context, 'boss-ranking', ['analytics.tasterRankings']);

      const noOrderRate = await sendChat(
        baseUrl,
        boss.token,
        'sales overview no order rate 2026-07-01 2026-07-04',
        'boss-no-order-rate',
      );
      assert.equal(noOrderRate.response.status, 201);
      assert.equal(noOrderRate.body.data.intent, 'analytics_overview');
      assert.equal(noOrderRate.body.data.answer.includes('33.33%'), true);
      assertRecordTools(context, 'boss-no-order-rate', ['analytics.overview']);

      const suggestion = await sendChat(
        baseUrl,
        boss.token,
        'business risk management suggestion 2026-07-01 2026-07-04',
        'boss-suggestion',
      );
      assert.equal(suggestion.response.status, 201);
      assert.equal(suggestion.body.data.intent, 'management_suggestion');
      assertRecordTools(context, 'boss-suggestion', [
        'analytics.overview',
        'analytics.trends',
        'analytics.tasterRankings',
        'refund.query',
      ]);
    },
    {
      env: enabledMockAiEnv(),
      prisma: buildFullCoveragePrisma(),
    },
  );
});

test('contract: AI backend answers finance refund and commission questions with read-only tools', async () => {
  await withPhase1Server(
    async (baseUrl, context) => {
      const finance = await login(baseUrl, 'stage9-full-finance', 'Password123');

      const refund = await sendChat(
        baseUrl,
        finance.token,
        'refund this month',
        'finance-refund',
      );
      assert.equal(refund.response.status, 201);
      assert.equal(refund.body.data.intent, 'refund_query');
      assertSourceSummary(refund.body.data, 'refund.query', {
        rowCount: 2,
        globalMarkedFilterEnabled: false,
      });
      assertRecordTools(context, 'finance-refund', ['refund.query']);

      const commission = await sendChat(
        baseUrl,
        finance.token,
        'commission this month',
        'finance-commission',
      );
      assert.equal(commission.response.status, 201);
      assert.equal(commission.body.data.intent, 'commission_query');
      assertSourceSummary(commission.body.data, 'commission.query', {
        rowCount: 2,
        globalMarkedFilterEnabled: false,
      });
      assertRecordTools(context, 'finance-commission', ['commission.query']);
    },
    {
      env: enabledMockAiEnv(),
      prisma: buildFullCoveragePrisma(),
    },
  );
});

test('contract: AI backend answers after-sales customer order and logistics questions safely', async () => {
  await withPhase1Server(
    async (baseUrl, context) => {
      const afterSales = await login(
        baseUrl,
        'stage9-full-after-sales',
        'Password123',
      );

      const orderLookup = await sendChat(
        baseUrl,
        afterSales.token,
        'customer order 13800000001',
        'after-sales-order',
      );
      assert.equal(orderLookup.response.status, 201);
      assert.equal(orderLookup.body.data.intent, 'customer_order_lookup');
      assertSourceSummary(orderLookup.body.data, 'customer.orderLookup', {
        rowCount: 3,
        globalMarkedFilterEnabled: false,
      });
      assertRecordTools(context, 'after-sales-order', ['customer.orderLookup']);

      const logistics = await sendChat(
        baseUrl,
        afterSales.token,
        'logistics SF-STAGE9-001',
        'after-sales-logistics',
      );
      assert.equal(logistics.response.status, 201);
      assert.equal(logistics.body.data.intent, 'logistics_lookup');
      assertSourceSummary(logistics.body.data, 'logistics.lookup', {
        rowCount: 1,
        globalMarkedFilterEnabled: false,
      });
      assertRecordTools(context, 'after-sales-logistics', ['logistics.lookup']);

      const serialized = JSON.stringify(logistics.body.data);
      assert.equal(serialized.includes('Stage9 Full Address'), false);
      assert.equal(serialized.includes('13800000001'), false);
    },
    {
      env: enabledMockAiEnv(),
      prisma: buildFullCoveragePrisma(),
    },
  );
});

test('contract: AI backend rejects write and SQL requests without tools or model calls', async () => {
  await withPhase1Server(
    async (baseUrl, context) => {
      const boss = await login(baseUrl, 'stage9-full-boss', 'Password123');

      const writeRequest = await sendChat(
        baseUrl,
        boss.token,
        'please update this order status to refunded',
        'reject-write',
      );
      assert.equal(writeRequest.response.status, 201);
      assert.equal(writeRequest.body.data.intent, 'unsafe_write_request');
      assert.deepEqual(writeRequest.body.data.sourceSummary, []);
      const writeRecord = latestRecord(context, 'reject-write');
      assert.equal(writeRecord.modelProvider, 'policy');
      assert.equal(writeRecord.errorCode, 'AI_UNSAFE_WRITE_REQUEST');
      assert.deepEqual(writeRecord.toolCalls, []);

      const sqlRequest = await sendChat(
        baseUrl,
        boss.token,
        'select * from users where password is not null',
        'reject-sql',
      );
      assert.equal(sqlRequest.response.status, 201);
      assert.equal(sqlRequest.body.data.intent, 'out_of_scope');
      assert.deepEqual(sqlRequest.body.data.sourceSummary, []);
      const sqlRecord = latestRecord(context, 'reject-sql');
      assert.equal(sqlRecord.modelProvider, 'policy');
      assert.equal(sqlRecord.errorCode, 'AI_SQL_REQUEST_DENIED');
      assert.deepEqual(sqlRecord.toolCalls, []);
    },
    {
      env: enabledMockAiEnv(),
      prisma: buildFullCoveragePrisma(),
    },
  );
});

test('contract: AI backend uses mock mode and stores chat records visible through own history', async () => {
  await withPhase1Server(
    async (baseUrl, context) => {
      const boss = await login(baseUrl, 'stage9-full-boss', 'Password123');

      const first = await sendChat(
        baseUrl,
        boss.token,
        'sales amount 2026-07-01 2026-07-04',
        'history-full',
      );
      const second = await sendChat(
        baseUrl,
        boss.token,
        'taster ranking top 2026-07-01 2026-07-04',
        'history-full',
      );
      assert.equal(first.response.status, 201);
      assert.equal(second.response.status, 201);

      const records = context.prisma.__store.aiChatMessages.filter(
        (record) =>
          record.userId === 'usr-stage9-full-boss' &&
          record.conversationId === 'history-full',
      );
      assert.equal(records.length, 2);
      assert.equal(records.every((record) => record.modelProvider === 'mock'), true);
      assert.equal(records.every((record) => record.errorCode === null), true);
      assert.equal(records.every((record) => record.toolCalls.length > 0), true);

      const history = await requestJson(
        baseUrl,
        `${HISTORY_PATH}?conversationId=history-full&page=1&pageSize=10`,
        {
          token: boss.token,
        },
      );
      assert.equal(history.response.status, 200);
      assert.equal(history.body.data.total, 2);
      assert.equal(history.body.data.items.length, 2);
      assert.deepEqual(
        history.body.data.items.map((item) => item.conversationId),
        ['history-full', 'history-full'],
      );
      assert.equal(
        history.body.data.items.every((item) => item.modelProvider === 'mock'),
        true,
      );
      assert.equal(
        history.body.data.items.every((item) => item.toolCalls.length > 0),
        true,
      );
    },
    {
      env: enabledMockAiEnv(),
      prisma: buildFullCoveragePrisma(),
    },
  );
});

test('contract: AI backend falls back safely when a real provider times out', async () => {
  await withPhase1Server(
    async (baseUrl, context) => {
      const boss = await login(baseUrl, 'stage9-full-boss', 'Password123');
      const originalFetch = global.fetch.bind(global);
      global.fetch = async (url, options) => {
        if (String(url).startsWith(baseUrl)) {
          return originalFetch(url, options);
        }
        const error = new Error('test provider aborted');
        error.name = 'AbortError';
        throw error;
      };

      try {
        const result = await sendChat(
          baseUrl,
          boss.token,
          'sales amount 2026-07-01 2026-07-04',
          'provider-timeout',
        );

        assert.equal(result.response.status, 201);
        assert.equal(result.body.data.intent, 'analytics_overview');
        assert.equal(JSON.stringify(result.body).includes('test provider aborted'), false);

        const record = latestRecord(context, 'provider-timeout');
        assert.equal(record.modelProvider, 'fallback');
        assert.equal(record.errorCode, 'AI_MODEL_TIMEOUT');
        assert.equal(record.toolCalls[0].toolName, 'analytics.overview');
      } finally {
        global.fetch = originalFetch;
      }
    },
    {
      env: {
        AI_ENABLED: 'true',
        AI_MOCK_MODE: 'false',
        AI_PROVIDER: 'openai_compatible',
        AI_API_KEY: 'sk-test-stage9-full',
        AI_BASE_URL: 'https://model.example/v1',
        AI_MODEL: 'stage9-timeout-model',
        AI_TIMEOUT_MS: '1',
      },
      prisma: buildFullCoveragePrisma(),
    },
  );
});

async function sendChat(baseUrl, token, question, conversationId) {
  return requestJson(baseUrl, CHAT_PATH, {
    method: 'POST',
    token,
    body: {
      question,
      conversationId,
    },
  });
}

function assertSourceSummary(data, toolName, expected) {
  const summary = data.sourceSummary.find((item) => item.toolName === toolName);
  assert.equal(Boolean(summary), true, toolName);
  if (expected.rowCount !== undefined) {
    assert.equal(summary.rowCount, expected.rowCount, toolName);
  }
  if (expected.globalMarkedFilterEnabled !== undefined) {
    assert.equal(
      summary.globalMarkedFilterEnabled,
      expected.globalMarkedFilterEnabled,
      toolName,
    );
  }
}

function assertRecordTools(context, conversationId, expectedToolNames) {
  const record = latestRecord(context, conversationId);
  assert.deepEqual(
    record.toolCalls.map((toolCall) => toolCall.toolName),
    expectedToolNames,
  );
  assert.equal(record.modelProvider, 'mock');
  assert.equal(record.errorCode, null);
}

function latestRecord(context, conversationId) {
  const rows = context.prisma.__store.aiChatMessages.filter(
    (record) => record.conversationId === conversationId,
  );
  assert.equal(rows.length > 0, true, conversationId);
  return rows[rows.length - 1];
}

function setGlobalMarkedFilter(context, enabled) {
  const setting = context.prisma.__store.systemSettings.find(
    (item) => item.settingKey === 'only_show_marked_records',
  );
  assert.equal(Boolean(setting), true);
  setting.settingValue = enabled ? 'true' : 'false';
  setting.updatedAt = new Date();
}

function enabledMockAiEnv() {
  return {
    AI_ENABLED: 'true',
    AI_MOCK_MODE: 'true',
  };
}

function buildFullCoveragePrisma() {
  return {
    users: [
      user('usr-stage9-full-admin', 'stage9-full-admin', 'admin'),
      user('usr-stage9-full-boss', 'stage9-full-boss', 'boss'),
      user('usr-stage9-full-finance', 'stage9-full-finance', 'finance'),
      user('usr-stage9-full-after-sales', 'stage9-full-after-sales', 'after_sales'),
      user('usr-stage9-full-warehouse', 'stage9-full-warehouse', 'warehouse'),
      user('usr-stage9-full-sales', 'stage9-full-sales', 'sales'),
      user('usr-stage9-full-taster', 'stage9-full-taster', 'taster'),
      user('usr-stage9-full-taster-b', 'stage9-full-taster-b', 'taster'),
      user('usr-stage9-full-front-desk', 'stage9-full-front-desk', 'front_desk'),
    ],
    customers: [
      customer('customer-stage9-marked', {
        name: 'Marked Customer',
        phone: '13800000001',
        financeMark: true,
      }),
      customer('customer-stage9-unmarked', {
        name: 'Unmarked Customer',
        phone: '13800000002',
        financeMark: false,
      }),
    ],
    travelGroups: [
      travelGroup('group-stage9-marked-sale', {
        groupNo: 'TG-STAGE9-MARKED-SALE',
        visitDate: '2026-07-02',
        guestCount: 6,
        tasterId: 'usr-stage9-full-taster',
        tasterName: 'Taster Alpha',
        financeMark: true,
      }),
      travelGroup('group-stage9-unmarked-sale', {
        groupNo: 'TG-STAGE9-UNMARKED-SALE',
        visitDate: '2026-07-03',
        guestCount: 4,
        tasterId: 'usr-stage9-full-taster-b',
        tasterName: 'Taster Beta',
        financeMark: false,
      }),
      travelGroup('group-stage9-marked-empty', {
        groupNo: 'TG-STAGE9-MARKED-EMPTY',
        visitDate: '2026-07-04',
        guestCount: 5,
        tasterId: 'usr-stage9-full-taster',
        tasterName: 'Taster Alpha',
        financeMark: true,
      }),
    ],
    salesOrders: [
      salesOrder('order-stage9-marked', {
        orderNo: 'SO-STAGE9-MARKED',
        orderDate: '2026-07-02',
        travelGroupId: 'group-stage9-marked-sale',
        customerId: 'customer-stage9-marked',
        customerName: 'Marked Customer',
        customerPhone: '13800000001',
        totalAmountCents: 100000,
        logisticsNo: 'SF-STAGE9-001',
        logisticsMethod: 'SF',
        logisticsFeeCents: 1200,
        financeMark: true,
        salesUserId: 'usr-stage9-full-sales',
      }),
      salesOrder('order-stage9-unmarked', {
        orderNo: 'SO-STAGE9-UNMARKED',
        orderDate: '2026-07-03',
        travelGroupId: 'group-stage9-unmarked-sale',
        customerId: 'customer-stage9-unmarked',
        customerName: 'Unmarked Customer',
        customerPhone: '13800000002',
        totalAmountCents: 200000,
        logisticsNo: 'SF-STAGE9-002',
        logisticsMethod: 'SF',
        logisticsFeeCents: 2500,
        financeMark: false,
        salesUserId: 'usr-stage9-full-sales',
      }),
    ],
    afterSalesOrders: [
      afterSalesOrder('after-sales-stage9-confirmed', {
        afterSalesNo: 'AS-STAGE9-CONFIRMED',
        salesOrderId: 'order-stage9-marked',
        customerId: 'customer-stage9-marked',
        refundAmountCents: 10000,
        status: 'COMPLETED',
        financeConfirmed: true,
        financeConfirmedAt: '2026-07-03T08:00:00.000Z',
        createdAt: '2026-07-03T08:00:00.000Z',
      }),
      afterSalesOrder('after-sales-stage9-pending', {
        afterSalesNo: 'AS-STAGE9-PENDING',
        salesOrderId: 'order-stage9-marked',
        customerId: 'customer-stage9-marked',
        refundAmountCents: 5000,
        status: 'WAITING_REFUND',
        financeConfirmed: false,
        createdAt: '2026-07-04T08:00:00.000Z',
      }),
    ],
    commissionRecords: [
      commissionRecord('commission-stage9-sales', {
        salesOrderId: 'order-stage9-marked',
        travelGroupId: 'group-stage9-marked-sale',
        targetType: 'SALES_COMMISSION',
        targetUserId: 'usr-stage9-full-sales',
        grossAmountCents: 100000,
        baseAmountCents: 90000,
        amountCents: 2000,
        isConfirmed: true,
      }),
      commissionRecord('commission-stage9-taster', {
        salesOrderId: 'order-stage9-marked',
        travelGroupId: 'group-stage9-marked-sale',
        targetType: 'TASTER_COMMISSION',
        targetUserId: 'usr-stage9-full-taster',
        grossAmountCents: 100000,
        baseAmountCents: 90000,
        amountCents: 3000,
        manualInput: true,
        isConfirmed: false,
      }),
    ],
    travelGroupFinanceSummaries: [
      travelGroupFinanceSummary('summary-stage9-marked', {
        travelGroupId: 'group-stage9-marked-sale',
        totalSalesAmountCents: 100000,
        confirmedRefundAmountCents: 10000,
        effectiveSalesAmountCents: 90000,
        totalDailyRebateCents: 1500,
        totalMonthlyRebateCents: 2500,
        paidRebateCents: 1000,
        unpaidRebateCents: 3000,
      }),
    ],
  };
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

function customer(id, overrides = {}) {
  return {
    id,
    name: id,
    phone: '13800000000',
    province: 'Guizhou',
    city: 'Zunyi',
    district: 'Honghuagang',
    address: 'Stage9 Full Address Should Not Leak',
    financeMark: true,
    ...overrides,
  };
}

function travelGroup(id, overrides = {}) {
  return {
    id,
    groupNo: `TG-${id}`,
    visitDate: '2026-07-02',
    guestCount: 6,
    tasterId: 'usr-stage9-full-taster',
    tasterName: 'Taster Alpha',
    groupType: 'retail',
    travelAgency: 'Stage9 Agency',
    financeMark: true,
    ...overrides,
  };
}

function salesOrder(id, overrides = {}) {
  return {
    id,
    orderNo: `SO-${id}`,
    orderType: 'TRAVEL_GROUP',
    orderDate: '2026-07-02',
    customerId: 'customer-stage9-marked',
    customerName: 'Marked Customer',
    customerPhone: '13800000001',
    province: 'Guizhou',
    city: 'Zunyi',
    district: 'Honghuagang',
    address: 'Stage9 Full Address Should Not Leak',
    travelGroupId: 'group-stage9-marked-sale',
    totalAmountCents: 100000,
    cashOnDeliveryAmountCents: 0,
    status: 'VALID',
    packingStatus: 'PACKED',
    packageCount: 1,
    logisticsNo: 'SF-STAGE9-001',
    logisticsMethod: 'SF',
    logisticsFeeCents: 1200,
    invoiceRequired: true,
    invoiceIssued: false,
    financeMark: true,
    items: [
      {
        productName: 'Stage9 Product',
        quantity: 1,
        unitPriceCents: 100000,
        subtotalCents: 100000,
        deliveryType: 'SHIPPING',
      },
    ],
    ...overrides,
  };
}

function afterSalesOrder(id, overrides = {}) {
  return {
    id,
    afterSalesNo: `AS-${id}`,
    salesOrderId: 'order-stage9-marked',
    customerId: 'customer-stage9-marked',
    issueType: 'OTHER',
    actionType: 'REFUND',
    description: 'stage9 test after-sales description',
    refundAmountCents: 10000,
    status: 'COMPLETED',
    financeConfirmed: true,
    createdAt: '2026-07-03T08:00:00.000Z',
    ...overrides,
  };
}

function commissionRecord(id, overrides = {}) {
  return {
    id,
    salesOrderId: 'order-stage9-marked',
    travelGroupId: 'group-stage9-marked-sale',
    targetType: 'SALES_COMMISSION',
    targetUserId: 'usr-stage9-full-sales',
    grossAmountCents: 100000,
    confirmedRefundAmountCents: 10000,
    baseAmountCents: 90000,
    amountCents: 2000,
    pointsCents: 0,
    isConfirmed: true,
    createdAt: '2026-07-03T08:00:00.000Z',
    ...overrides,
  };
}

function travelGroupFinanceSummary(id, overrides = {}) {
  return {
    id,
    travelGroupId: 'group-stage9-marked-sale',
    totalSalesAmountCents: 100000,
    confirmedRefundAmountCents: 10000,
    effectiveSalesAmountCents: 90000,
    totalAgencyDeductionCents: 0,
    totalAgencyNetAmountCents: 90000,
    totalDailyRebateCents: 1500,
    totalMonthlyRebateCents: 2500,
    paidRebateCents: 1000,
    unpaidRebateCents: 3000,
    updatedAt: '2026-07-04T08:00:00.000Z',
    ...overrides,
  };
}
