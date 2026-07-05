const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AiPromptBuilder,
  AI_SYSTEM_PROMPT,
} = require('../src/modules/ai/ai-prompt.builder');
const {
  AiResponseFormatter,
} = require('../src/modules/ai/ai-response.formatter');
const { readAiConfig } = require('../src/modules/ai/ai-config');
const { AiModelClient } = require('../src/modules/ai/ai-model.client');

test('unit: AI prompt builder only exposes whitelisted fields and strips sensitive data', () => {
  const builder = new AiPromptBuilder();
  const input = {
    userRole: 'boss',
    intent: 'analytics_overview',
    question: '本月销售额是多少？',
    dateRange: {
      preset: 'this_month',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-04',
      timezone: 'Asia/Shanghai',
      databaseUrl: 'mysql://should-not-appear',
    },
    policy: {
      globalMarkedFilterEnabled: true,
      scopeDescription: '老板可见经营统计',
      token: 'policy-token-should-not-leak',
    },
    toolResults: [
      {
        toolName: 'analytics.overview',
        data: {
          grossSalesAmountCents: 100000,
          netSalesAmountCents: 95000,
          apiKey: 'secret-key-should-not-leak',
          password: 'Password123',
          token: 'customer-token',
          customerPhone: '13800138000',
          phoneMasked: '138****8000',
          fullAddress: '北京市朝阳区完整地址',
          avatarUrl: 'https://model.example/private.png',
          orders: Array.from({ length: 30 }, (_, index) => ({
            orderNo: `SO-${index + 1}`,
            phone: `13800138${String(index).padStart(3, '0')}`,
          })),
        },
        sourceSummary: {
          rowCount: 30,
          dateFrom: '2026-07-01',
          dateTo: '2026-07-04',
          globalMarkedFilterEnabled: true,
          scopeDescription: '老板可见经营统计',
          databaseConnection: 'mysql://source-summary',
        },
        warnings: ['样例提示'],
      },
    ],
    warnings: ['顶层提示'],
    AI_API_KEY: 'top-level-key-should-not-leak',
    DATABASE_URL: 'mysql://top-level-db',
  };

  const result = builder.buildMessages(input);
  const userPayload = JSON.parse(result.messages[1].content);

  assert.deepEqual(Object.keys(userPayload), [
    'userRole',
    'intent',
    'question',
    'dateRange',
    'policy',
    'toolResults',
    'warnings',
  ]);
  assert.deepEqual(Object.keys(userPayload.policy), [
    'globalMarkedFilterEnabled',
    'scopeDescription',
  ]);

  const promptText = JSON.stringify(result);
  assert.equal(promptText.includes('secret-key-should-not-leak'), false);
  assert.equal(promptText.includes('Password123'), false);
  assert.equal(promptText.includes('customer-token'), false);
  assert.equal(promptText.includes('13800138000'), false);
  assert.equal(promptText.includes('北京市朝阳区完整地址'), false);
  assert.equal(promptText.includes('https://model.example/private.png'), false);
  assert.equal(promptText.includes('mysql://'), false);
  assert.equal(promptText.includes('138****8000'), true);
  assert.equal(userPayload.toolResults[0].data.orders.length, 20);

  assert.match(AI_SYSTEM_PROMPT, /只能基于后端提供的数据回答/);
  assert.match(AI_SYSTEM_PROMPT, /不能编造数字/);
  assert.match(AI_SYSTEM_PROMPT, /不能生成或执行 SQL/);
  assert.match(AI_SYSTEM_PROMPT, /不能修改、删除或新增任何业务数据/);
  assert.match(AI_SYSTEM_PROMPT, /回答必须使用简体中文/);
});

test('unit: AI provider payload reuses sanitized prompt without leaking API key', async () => {
  const client = new AiModelClient({
    getConfig: () =>
      readAiConfig({
        AI_ENABLED: 'true',
        AI_MOCK_MODE: 'false',
        AI_PROVIDER: 'openai_compatible',
        AI_API_KEY: 'secret-key-should-not-leak',
        AI_BASE_URL: 'https://model.example/v1',
        AI_MODEL: 'test-model',
      }),
  });
  let capturedBody = '';

  await client.generateAnswer(
    {
      question: '写 SQL 查一下本月销售额',
      userRole: 'boss',
      intent: 'analytics_overview',
      toolResults: [
        {
          toolName: 'analytics.overview',
          data: {
            netSalesAmountCents: 10000,
            token: 'tool-token-should-not-leak',
          },
        },
      ],
      warnings: ['提示'],
      apiKey: 'extra-top-level-key',
    },
    {
      fetchImpl: async (_url, init) => {
        capturedBody = String(init.body);
        return {
          ok: true,
          json: async () => ({
            answer: '已按后端数据回答。',
            usage: {
              prompt_tokens: 10,
              completion_tokens: 6,
            },
          }),
        };
      },
      now: () => 1000,
    },
  );

  assert.equal(capturedBody.includes('secret-key-should-not-leak'), false);
  assert.equal(capturedBody.includes('tool-token-should-not-leak'), false);
  assert.equal(capturedBody.includes('extra-top-level-key'), false);

  const payload = JSON.parse(capturedBody);
  const modelInput = JSON.parse(payload.messages[1].content);
  assert.deepEqual(Object.keys(modelInput), [
    'userRole',
    'intent',
    'question',
    'dateRange',
    'policy',
    'toolResults',
    'warnings',
  ]);
});

test('unit: AI response formatter covers analytics overview answer shape', () => {
  const formatter = new AiResponseFormatter();
  const answer = formatter.formatAnswer({
    userRole: 'boss',
    intent: 'analytics_overview',
    question: '本月销售额是多少？',
    dateRange: {
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
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
          grossSalesAmountCents: 100000,
          refundAmountCents: 5000,
          netSalesAmountCents: 95000,
          totalGroupCount: 4,
          totalGuestCount: 40,
          noOrderRate: 0.25,
        },
        sourceSummary: {
          rowCount: 4,
          dateFrom: '2026-07-01',
          dateTo: '2026-07-31',
          globalMarkedFilterEnabled: true,
          scopeDescription: '老板可见经营统计',
        },
      },
    ],
  });

  assert.match(answer, /查询范围：2026-07-01 至 2026-07-31/);
  assert.match(answer, /数据口径：复用第 8 阶段 analytics 只读口径/);
  assert.match(answer, /出单销售额 1000\.00 元/);
  assert.match(answer, /已确认退款金额 50\.00 元/);
  assert.match(answer, /净销售额 950\.00 元/);
  assert.match(answer, /打蛋率 25\.00%/);
  assert.match(answer, /只查询已标记信息/);
});

test('unit: AI response formatter covers finance answer shape', () => {
  const formatter = new AiResponseFormatter();
  const answer = formatter.formatAnswer({
    userRole: 'finance',
    intent: 'finance_summary',
    question: '本月退款和提成是多少？',
    dateRange: {
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      timezone: 'Asia/Shanghai',
    },
    policy: {
      scopeDescription: '财务可见退款、物流费用、提成和积分',
    },
    toolResults: [
      {
        toolName: 'finance.summary',
        data: {
          refunds: {
            confirmedRefundAmountCents: 12300,
            pendingRefundAmountCents: 4500,
            pendingRefundCount: 2,
          },
          logistics: {
            logisticsFeeCents: 8800,
          },
          commission: {
            totalCommissionAmountCents: 6600,
          },
          points: {
            totalPointsCents: 5000,
          },
        },
        sourceSummary: {
          rowCount: 8,
        },
      },
    ],
  });

  assert.match(answer, /数据口径：复用第 6、7 阶段财务、退款、提成和积分只读口径/);
  assert.match(answer, /已确认退款金额 123\.00 元/);
  assert.match(answer, /待确认退款金额 45\.00 元/);
  assert.match(answer, /物流费用 88\.00 元/);
  assert.match(answer, /提成金额 66\.00 元/);
  assert.match(answer, /积分金额 50\.00 元/);
});

test('unit: AI response formatter covers after-sales lookup answer shape', () => {
  const formatter = new AiResponseFormatter();
  const answer = formatter.formatAnswer({
    userRole: 'after_sales',
    intent: 'after_sales_lookup',
    question: '张三最近有没有售后？',
    policy: {
      scopeDescription: '售后可见客户订单、售后历史和物流',
    },
    toolResults: [
      {
        toolName: 'afterSales.lookup',
        data: {
          summary: {
            orderCount: 1,
            afterSalesCount: 1,
            confirmedRefundAmountCents: 3000,
          },
          customers: [
            {
              name: '张三',
              phoneMasked: '138****8000',
              address: '完整地址不应进入回答',
            },
          ],
        },
        sourceSummary: {
          rowCount: 1,
        },
      },
    ],
  });

  assert.match(answer, /查询范围：当前查询条件/);
  assert.match(answer, /手机号尽量脱敏，完整地址不进入 AI 回答/);
  assert.match(answer, /订单数 1/);
  assert.match(answer, /售后单数 1/);
  assert.match(answer, /已确认退款金额 30\.00 元/);
  assert.equal(answer.includes('完整地址不应进入回答'), false);
});

test('unit: AI response formatter refuses overreach and unsafe write requests', () => {
  const formatter = new AiResponseFormatter();

  const overreach = formatter.formatAnswer({
    userRole: 'after_sales',
    intent: 'permission_denied',
    question: '看一下公司经营建议',
    policy: {
      scopeDescription: '售后可见售后相关数据',
    },
    warnings: ['售后角色无权查看经营建议'],
  });
  assert.match(overreach, /你当前没有权限查看这个范围的数据/);
  assert.match(overreach, /未调用写入工具/);
  assert.match(overreach, /售后角色无权查看经营建议/);

  const unsafe = formatter.formatAnswer({
    userRole: 'boss',
    intent: 'unsafe_write_request',
    question: '帮我删除这个订单，并写 SQL 改一下状态',
    policy: {
      scopeDescription: '老板可见经营统计',
    },
  });
  assert.match(unsafe, /不能直接修改、删除或新增业务数据/);
  assert.match(unsafe, /不能生成或执行 SQL/);
  assert.match(unsafe, /未调用写入工具/);
});

test('unit: AI response formatter explains insufficient data instead of fabricating numbers', () => {
  const formatter = new AiResponseFormatter();
  const answer = formatter.formatAnswer({
    userRole: 'boss',
    intent: 'analytics_overview',
    question: '本月销售额是多少？',
    dateRange: {
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      timezone: 'Asia/Shanghai',
    },
    toolResults: [
      {
        toolName: 'analytics.overview',
        data: {},
        sourceSummary: {
          rowCount: 0,
        },
      },
    ],
  });

  assert.match(answer, /数据不足/);
  assert.match(answer, /不能编造数字/);
});
