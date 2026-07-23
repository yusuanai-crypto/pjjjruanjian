const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

const HISTORY_PATH = '/api/ai/chat/history';
const CAPABILITIES_PATH = '/api/ai/capabilities';

test('contract: AI chat history returns only the current user records and sanitizes tool calls', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const missingToken = await requestJson(baseUrl, HISTORY_PATH);
      assertErrorContract(missingToken, 401, 'AUTH_TOKEN_REQUIRED');

      const boss = await login(baseUrl, 'stage9-history-boss', 'Password123');
      const all = await requestJson(baseUrl, HISTORY_PATH, {
        token: boss.token,
      });

      assert.equal(all.response.status, 200);
      assertHistoryResponseContract(all.body.data);
      assert.equal(all.body.data.total, 2);
      assert.equal(all.body.data.page, 1);
      assert.equal(all.body.data.pageSize, 20);
      assert.equal(all.body.data.totalPages, 1);
      assert.deepEqual(
        all.body.data.items.map((item) => item.userId),
        [undefined, undefined],
      );
      assert.equal(
        all.body.data.items.some((item) =>
          item.question.includes('other user private question'),
        ),
        false,
      );

      const serialized = JSON.stringify(all.body.data);
      assert.equal(serialized.includes('select * from customers'), false);
      assert.equal(serialized.includes('13900000000'), false);
      assert.equal(serialized.includes('secret-raw-data'), false);
      assert.deepEqual(Object.keys(all.body.data.items[0].toolCalls[0]).sort(), [
        'globalMarkedFilterEnabled',
        'rowCount',
        'toolName',
        'warnings',
      ]);

      const filtered = await requestJson(
        baseUrl,
        `${HISTORY_PATH}?conversationId=conv-stage9-own-a&intent=finance_summary&dateFrom=2026-07-02&dateTo=2026-07-02`,
        {
          token: boss.token,
        },
      );
      assert.equal(filtered.response.status, 200);
      assert.equal(filtered.body.data.total, 1);
      assert.equal(filtered.body.data.items[0].conversationId, 'conv-stage9-own-a');
      assert.equal(filtered.body.data.items[0].intent, 'finance_summary');

      const otherConversation = await requestJson(
        baseUrl,
        `${HISTORY_PATH}?conversationId=conv-stage9-other`,
        {
          token: boss.token,
        },
      );
      assert.equal(otherConversation.response.status, 200);
      assert.equal(otherConversation.body.data.total, 0);

      const ignoredUserId = await requestJson(
        baseUrl,
        `${HISTORY_PATH}?userId=usr-stage9-history-other`,
        {
          token: boss.token,
        },
      );
      assert.equal(ignoredUserId.response.status, 200);
      assert.equal(ignoredUserId.body.data.total, 2);
    },
    {
      env: enabledMockAiEnv(),
      prisma: {
        users: historyUsers(),
        aiChatMessages: [
          chatMessage({
            id: 'msg-stage9-own-a',
            conversationId: 'conv-stage9-own-a',
            userId: 'usr-stage9-history-boss',
            userRole: 'boss',
            question: 'own finance summary question',
            intent: 'finance_summary',
            createdAt: '2026-07-02T04:00:00.000Z',
          }),
          chatMessage({
            id: 'msg-stage9-own-b',
            conversationId: 'conv-stage9-own-b',
            userId: 'usr-stage9-history-boss',
            userRole: 'boss',
            question: 'own analytics question',
            intent: 'analytics_overview',
            createdAt: '2026-07-03T04:00:00.000Z',
            toolCalls: [
              {
                toolName: 'analytics.overview',
                rowCount: 3,
                globalMarkedFilterEnabled: true,
                warnings: ['limited'],
                rawSql: 'select * from customers',
                data: {
                  phone: '13900000000',
                  raw: 'secret-raw-data',
                },
              },
            ],
          }),
          chatMessage({
            id: 'msg-stage9-other',
            conversationId: 'conv-stage9-other',
            userId: 'usr-stage9-history-other',
            userRole: 'boss',
            question: 'other user private question',
            intent: 'analytics_overview',
            createdAt: '2026-07-03T05:00:00.000Z',
          }),
        ],
      },
    },
  );
});

test('contract: AI chat history paginates current user records', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const boss = await login(baseUrl, 'stage9-history-boss', 'Password123');
      const result = await requestJson(baseUrl, `${HISTORY_PATH}?page=2&pageSize=2`, {
        token: boss.token,
      });

      assert.equal(result.response.status, 200);
      assertHistoryResponseContract(result.body.data);
      assert.equal(result.body.data.total, 5);
      assert.equal(result.body.data.page, 2);
      assert.equal(result.body.data.pageSize, 2);
      assert.equal(result.body.data.totalPages, 3);
      assert.deepEqual(
        result.body.data.items.map((item) => item.question),
        ['history question 3', 'history question 2'],
      );
    },
    {
      env: enabledMockAiEnv(),
      prisma: {
        users: historyUsers(),
        aiChatMessages: Array.from({ length: 5 }, (_, index) =>
          chatMessage({
            id: `msg-stage9-page-${index + 1}`,
            conversationId: 'conv-stage9-page',
            userId: 'usr-stage9-history-boss',
            userRole: 'boss',
            question: `history question ${index + 1}`,
            intent: 'analytics_overview',
            createdAt: `2026-07-0${index + 1}T04:00:00.000Z`,
          }),
        ),
      },
    },
  );
});

test('contract: AI capabilities expose role-scoped abilities without sensitive config', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const missingToken = await requestJson(baseUrl, CAPABILITIES_PATH);
      assertErrorContract(missingToken, 401, 'AUTH_TOKEN_REQUIRED');

      const superAdmin = await capabilityFor(
        baseUrl,
        'stage9-cap-super-admin',
      );
      assertCapabilitiesContract(superAdmin);
      assert.equal(superAdmin.role, 'super_admin');
      assert.equal(superAdmin.enabled, true);
      assert.equal(superAdmin.roleAllowed, true);
      assert.equal(superAdmin.canUseAi, true);
      assert.equal(
        superAdmin.allowedIntents.includes('management_suggestion'),
        true,
      );
      assert.equal(
        toolNames(superAdmin).includes('analytics.overview'),
        true,
      );

      const boss = await capabilityFor(baseUrl, 'stage9-cap-boss');
      assertCapabilitiesContract(boss);
      assert.equal(boss.enabled, true);
      assert.equal(boss.roleAllowed, true);
      assert.equal(boss.canUseAi, true);
      assert.equal(boss.allowedIntents.includes('management_suggestion'), true);
      assert.equal(toolNames(boss).includes('analytics.overview'), true);
      assert.equal(boss.limits.maxQuestionLength, 222);
      assert.equal(boss.limits.dailyLimitPerUser, 33);
      assert.equal(boss.limits.historyRetentionDays, 44);
      assert.equal(boss.limits.timeoutMs, 1234);
      assert.equal(boss.model.mockMode, true);
      assert.equal(boss.model.provider, 'mock-provider');
      assert.equal(boss.model.modelName, 'mock-model');
      assert.equal(boss.model.hasApiKey, true);

      const finance = await capabilityFor(baseUrl, 'stage9-cap-finance');
      assertCapabilitiesContract(finance);
      assert.equal(finance.roleAllowed, true);
      assert.equal(finance.allowedIntents.includes('finance_summary'), true);
      assert.equal(finance.allowedIntents.includes('management_suggestion'), false);
      assert.equal(
        finance.tools.some((tool) => tool.intent === 'management_suggestion'),
        false,
      );

      const afterSales = await capabilityFor(baseUrl, 'stage9-cap-after-sales');
      assertCapabilitiesContract(afterSales);
      assert.equal(afterSales.roleAllowed, true);
      assert.equal(afterSales.allowedIntents.includes('customer_order_lookup'), true);
      assert.equal(afterSales.allowedIntents.includes('finance_summary'), false);
      assert.equal(toolNames(afterSales).includes('customer.orderLookup'), true);

      const sales = await capabilityFor(baseUrl, 'stage9-cap-sales');
      assertCapabilitiesContract(sales);
      assert.equal(sales.roleAllowed, false);
      assert.equal(sales.canUseAi, false);
      assert.deepEqual(sales.allowedIntents, []);
      assert.deepEqual(sales.tools, []);

      const serialized = JSON.stringify(boss);
      assert.equal(serialized.includes('sk-stage9-secret'), false);
      assert.equal(serialized.includes('https://model.example/v1'), false);
    },
    {
      env: {
        AI_ENABLED: 'true',
        AI_MOCK_MODE: 'true',
        AI_PROVIDER: 'mock-provider',
        AI_API_KEY: 'sk-stage9-secret',
        AI_BASE_URL: 'https://model.example/v1',
        AI_MODEL: 'mock-model',
        AI_TIMEOUT_MS: '1234',
        AI_MAX_QUESTION_LENGTH: '222',
        AI_DAILY_LIMIT_PER_USER: '33',
        AI_HISTORY_RETENTION_DAYS: '44',
      },
      prisma: {
        users: capabilityUsers(),
      },
    },
  );
});

test('contract: AI capabilities report disabled AI without granting runtime access', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const boss = await capabilityFor(baseUrl, 'stage9-cap-boss');
      assert.equal(boss.enabled, false);
      assert.equal(boss.roleAllowed, true);
      assert.equal(boss.canUseAi, false);
      assert.equal(boss.allowedIntents.includes('analytics_overview'), true);
    },
    {
      env: {
        AI_ENABLED: 'false',
        AI_MOCK_MODE: 'true',
      },
      prisma: {
        users: capabilityUsers(),
      },
    },
  );
});

async function capabilityFor(baseUrl, username) {
  const session = await login(baseUrl, username, 'Password123');
  const result = await requestJson(baseUrl, CAPABILITIES_PATH, {
    token: session.token,
  });
  assert.equal(result.response.status, 200, username);
  return result.body.data;
}

function assertHistoryResponseContract(data) {
  assert.deepEqual(Object.keys(data).sort(), [
    'items',
    'page',
    'pageSize',
    'total',
    'totalPages',
  ]);
  assert.equal(Array.isArray(data.items), true);
  assert.equal(Number.isInteger(data.page), true);
  assert.equal(Number.isInteger(data.pageSize), true);
  assert.equal(Number.isInteger(data.total), true);
  assert.equal(Number.isInteger(data.totalPages), true);

  for (const item of data.items) {
    assert.deepEqual(Object.keys(item).sort(), [
      'answer',
      'completionTokens',
      'conversationId',
      'createdAt',
      'dataScope',
      'errorCode',
      'id',
      'intent',
      'latencyMs',
      'modelName',
      'modelProvider',
      'promptTokens',
      'question',
      'sourceSummary',
      'toolCalls',
      'warnings',
    ]);
    assert.equal(typeof item.id, 'string');
    assert.equal(typeof item.conversationId, 'string');
    assert.equal(typeof item.question, 'string');
    assert.equal(typeof item.answer, 'string');
    assert.equal(typeof item.intent, 'string');
    assert.equal(Array.isArray(item.toolCalls), true);
    assert.equal(Array.isArray(item.sourceSummary), true);
    assert.equal(Array.isArray(item.warnings), true);
    assert.doesNotThrow(() => new Date(item.createdAt).toISOString());
  }
}

function assertCapabilitiesContract(data) {
  assert.deepEqual(Object.keys(data).sort(), [
    'allowedIntents',
    'canUseAi',
    'constraints',
    'enabled',
    'limits',
    'model',
    'role',
    'roleAllowed',
    'scopeDescription',
    'tools',
  ]);
  assert.equal(typeof data.enabled, 'boolean');
  assert.equal(typeof data.role, 'string');
  assert.equal(typeof data.roleAllowed, 'boolean');
  assert.equal(typeof data.canUseAi, 'boolean');
  assert.equal(typeof data.scopeDescription, 'string');
  assert.equal(Array.isArray(data.allowedIntents), true);
  assert.equal(Array.isArray(data.tools), true);
  assert.deepEqual(Object.keys(data.limits).sort(), [
    'dailyLimitPerUser',
    'historyPageSizeDefault',
    'historyPageSizeMax',
    'historyRetentionDays',
    'maxQuestionLength',
    'timeoutMs',
  ]);
  assert.deepEqual(Object.keys(data.model).sort(), [
    'hasApiKey',
    'mockMode',
    'modelName',
    'provider',
  ]);
  assert.deepEqual(data.constraints, {
    readOnly: true,
    historyScope: 'self',
    canGenerateSql: false,
    canExecuteSql: false,
    canWriteBusinessData: false,
  });
  for (const tool of data.tools) {
    assert.deepEqual(Object.keys(tool).sort(), [
      'description',
      'intent',
      'readOnly',
      'toolName',
    ]);
    assert.equal(tool.readOnly, true);
  }
}

function enabledMockAiEnv() {
  return {
    AI_ENABLED: 'true',
    AI_MOCK_MODE: 'true',
  };
}

function historyUsers() {
  return [
    user('usr-stage9-history-boss', 'stage9-history-boss', 'boss'),
    user('usr-stage9-history-other', 'stage9-history-other', 'boss'),
  ];
}

function capabilityUsers() {
  return [
    user(
      'usr-stage9-cap-super-admin',
      'stage9-cap-super-admin',
      'super_admin',
    ),
    user('usr-stage9-cap-boss', 'stage9-cap-boss', 'boss'),
    user('usr-stage9-cap-finance', 'stage9-cap-finance', 'finance'),
    user('usr-stage9-cap-after-sales', 'stage9-cap-after-sales', 'after_sales'),
    user('usr-stage9-cap-sales', 'stage9-cap-sales', 'sales'),
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

function chatMessage(overrides = {}) {
  return {
    id: 'msg-stage9-default',
    conversationId: 'conv-stage9-default',
    userId: 'usr-stage9-history-boss',
    userRole: 'boss',
    question: 'history question',
    answer: 'history answer',
    intent: 'analytics_overview',
    dataScope: {
      range: {
        preset: 'custom',
        dateFrom: '2026-07-02',
        dateTo: '2026-07-02',
        timezone: 'Asia/Shanghai',
      },
      policy: {
        code: 'AI_ALLOWED',
        scopeDescription: 'test scope',
      },
    },
    toolCalls: [
      {
        toolName: 'analytics.overview',
        rowCount: 1,
        globalMarkedFilterEnabled: false,
        warnings: [],
      },
    ],
    sourceSummary: [
      {
        toolName: 'analytics.overview',
        rowCount: 1,
        dateFrom: '2026-07-02',
        dateTo: '2026-07-02',
        globalMarkedFilterEnabled: false,
        scopeDescription: 'test scope',
      },
    ],
    warnings: [],
    modelProvider: 'mock',
    modelName: 'jiangjiu-ai-mock',
    promptTokens: 10,
    completionTokens: 20,
    latencyMs: 5,
    errorCode: null,
    createdAt: '2026-07-02T04:00:00.000Z',
    ...overrides,
  };
}

function toolNames(capabilities) {
  return capabilities.tools.map((tool) => tool.toolName);
}
