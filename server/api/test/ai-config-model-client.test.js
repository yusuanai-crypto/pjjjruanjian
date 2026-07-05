const assert = require('node:assert/strict');
const test = require('node:test');

const {
  readAiConfig,
  toSafeAiConfig,
} = require('../src/modules/ai/ai-config');
const { AiModelClient } = require('../src/modules/ai/ai-model.client');

test('unit: AI config reads defaults for local disabled mock mode', () => {
  const config = readAiConfig({});

  assert.equal(config.enabled, false);
  assert.equal(config.mockMode, true);
  assert.equal(config.provider, null);
  assert.equal(config.apiKey, null);
  assert.equal(config.baseUrl, null);
  assert.equal(config.model, null);
  assert.equal(config.timeoutMs, 20000);
  assert.equal(config.maxQuestionLength, 500);
  assert.equal(config.dailyLimitPerUser, 100);
  assert.equal(config.historyRetentionDays, 180);
});

test('unit: AI config reads explicit env values and redacts API key', () => {
  const config = readAiConfig({
    AI_ENABLED: 'true',
    AI_MOCK_MODE: 'false',
    AI_PROVIDER: 'openai_compatible',
    AI_API_KEY: 'secret-key-should-not-leak',
    AI_BASE_URL: 'https://model.example/v1',
    AI_MODEL: 'test-model',
    AI_TIMEOUT_MS: '3500',
    AI_MAX_QUESTION_LENGTH: '800',
    AI_DAILY_LIMIT_PER_USER: '12',
    AI_HISTORY_RETENTION_DAYS: '30',
  });

  assert.equal(config.enabled, true);
  assert.equal(config.mockMode, false);
  assert.equal(config.provider, 'openai_compatible');
  assert.equal(config.apiKey, 'secret-key-should-not-leak');
  assert.equal(config.baseUrl, 'https://model.example/v1');
  assert.equal(config.model, 'test-model');
  assert.equal(config.timeoutMs, 3500);
  assert.equal(config.maxQuestionLength, 800);
  assert.equal(config.dailyLimitPerUser, 12);
  assert.equal(config.historyRetentionDays, 30);

  assert.deepEqual(toSafeAiConfig(config), {
    enabled: true,
    mockMode: false,
    provider: 'openai_compatible',
    hasApiKey: true,
    baseUrl: 'https://model.example/v1',
    model: 'test-model',
    timeoutMs: 3500,
    maxQuestionLength: 800,
    dailyLimitPerUser: 12,
    historyRetentionDays: 30,
  });
});

test('unit: AI model client rejects calls when AI is disabled', async () => {
  const client = createClient(readAiConfig({ AI_ENABLED: 'false' }));

  await assertRejectsCode(
    () =>
      client.generateAnswer({
        question: '今天销售额是多少？',
        intent: 'analytics_overview',
      }),
    {
      statusCode: 503,
      code: 'AI_DISABLED',
    },
  );
});

test('unit: AI mock mode returns predictable Chinese answer without network', async () => {
  const client = createClient(
    readAiConfig({ AI_ENABLED: 'true', AI_MOCK_MODE: 'true' }),
  );
  let networkCalled = false;

  const result = await client.generateAnswer(
    {
      question: '今天销售额是多少？',
      userRole: 'boss',
      intent: 'analytics_overview',
      dateRange: {
        dateFrom: '2026-07-04',
        dateTo: '2026-07-04',
        timezone: 'Asia/Shanghai',
      },
      policy: {
        globalMarkedFilterEnabled: true,
        scopeDescription: '老板可见经营统计',
      },
      toolResults: [
        {
          toolName: 'analytics.overview',
          data: {
            netSalesAmountCents: 95000,
            grossSalesAmountCents: 100000,
            refundAmountCents: 5000,
          },
          sourceSummary: {
            rowCount: 3,
            dateFrom: '2026-07-04',
            dateTo: '2026-07-04',
          },
          warnings: ['样例提示'],
        },
      ],
    },
    {
      fetchImpl: async () => {
        networkCalled = true;
        throw new Error('network should not be called in mock mode');
      },
      now: () => 1000,
    },
  );

  assert.equal(networkCalled, false);
  assert.equal(result.modelProvider, 'mock');
  assert.equal(result.modelName, 'jiangjiu-ai-mock');
  assert.equal(result.latencyMs, 0);
  assert.deepEqual(result.warnings, ['样例提示']);
  assert.match(result.answer, /查询范围：2026-07-04 至 2026-07-04/);
  assert.match(result.answer, /老板可见经营统计/);
  assert.match(result.answer, /只查询已标记信息/);
  assert.match(result.answer, /analytics\.overview/);
  assert.match(result.answer, /净销售额 950\.00 元/);
  assert.match(result.answer, /返回 3 行/);
});

test('unit: AI real-provider mode rejects missing API key before network', async () => {
  const client = createClient(
    readAiConfig({
      AI_ENABLED: 'true',
      AI_MOCK_MODE: 'false',
      AI_PROVIDER: 'openai_compatible',
      AI_BASE_URL: 'https://model.example/v1',
      AI_MODEL: 'test-model',
    }),
  );
  let networkCalled = false;

  await assertRejectsCode(
    () =>
      client.generateAnswer(
        {
          question: '今天销售额是多少？',
          intent: 'analytics_overview',
        },
        {
          fetchImpl: async () => {
            networkCalled = true;
            throw new Error('network should not be called without API key');
          },
        },
      ),
    {
      statusCode: 503,
      code: 'AI_PROVIDER_API_KEY_REQUIRED',
      messageDoesNotInclude: 'secret',
    },
  );
  assert.equal(networkCalled, false);
});

test('unit: AI real-provider mode applies timeout configuration', async () => {
  const client = createClient(
    readAiConfig({
      AI_ENABLED: 'true',
      AI_MOCK_MODE: 'false',
      AI_PROVIDER: 'openai_compatible',
      AI_API_KEY: 'secret-key-should-not-leak',
      AI_BASE_URL: 'https://model.example/v1',
      AI_MODEL: 'test-model',
      AI_TIMEOUT_MS: '5',
    }),
  );

  await assertRejectsCode(
    () =>
      client.generateAnswer(
        {
          question: '今天销售额是多少？',
          intent: 'analytics_overview',
        },
        {
          fetchImpl: (_url, init) =>
            new Promise((_resolve, reject) => {
              init.signal.addEventListener('abort', () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
              });
            }),
        },
      ),
    {
      statusCode: 504,
      code: 'AI_MODEL_TIMEOUT',
      messageDoesNotInclude: 'secret-key-should-not-leak',
    },
  );
});

function createClient(config) {
  return new AiModelClient({
    getConfig: () => config,
  });
}

async function assertRejectsCode(fn, expectation) {
  await assert.rejects(fn, (error) => {
    assert.equal(error.statusCode, expectation.statusCode);
    assert.equal(error.code, expectation.code);
    if (expectation.messageDoesNotInclude) {
      assert.equal(
        String(error.message).includes(expectation.messageDoesNotInclude),
        false,
      );
    }
    return true;
  });
}
