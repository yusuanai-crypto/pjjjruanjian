const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AI_DEFAULT_LOOKUP_LIMIT,
  AI_TIMEZONE,
  AiIntentService,
} = require('../src/modules/ai/ai-intent.service');

const FIXED_NOW = new Date('2026-07-04T08:00:00.000Z');

test('unit: AI intent parser resolves all supported time presets in Asia/Shanghai', () => {
  const cases = [
    {
      question: '今天销售额是多少？',
      preset: 'today',
      dateFrom: '2026-07-04',
      dateTo: '2026-07-04',
    },
    {
      question: '昨天销售额是多少？',
      preset: 'yesterday',
      dateFrom: '2026-07-03',
      dateTo: '2026-07-03',
    },
    {
      question: '近 10 天打蛋率趋势怎么样？',
      preset: 'last_10_days',
      dateFrom: '2026-06-25',
      dateTo: '2026-07-04',
    },
    {
      question: '本月销售额是多少？',
      preset: 'this_month',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-04',
    },
    {
      question: '上个月销售额是多少？',
      preset: 'last_month',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
    },
    {
      question: '本年销售额是多少？',
      preset: 'this_year',
      dateFrom: '2026-01-01',
      dateTo: '2026-07-04',
    },
    {
      question: '2026-06-01 到 2026-06-15 销售额是多少？',
      preset: 'custom',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-15',
    },
  ];

  for (const item of cases) {
    const result = parse(item.question);
    assert.equal(result.dateRange?.timezone, AI_TIMEZONE, item.question);
    assert.equal(result.dateRange?.preset, item.preset, item.question);
    assert.equal(result.dateRange?.dateFrom, item.dateFrom, item.question);
    assert.equal(result.dateRange?.dateTo, item.dateTo, item.question);
  }
});

test('unit: AI intent parser accepts English time preset tokens', () => {
  const cases = [
    ['today 销售额是多少？', 'today'],
    ['yesterday 销售额是多少？', 'yesterday'],
    ['last_10_days 销售额趋势怎么样？', 'last_10_days'],
    ['this_month 销售额是多少？', 'this_month'],
    ['last_month 销售额是多少？', 'last_month'],
    ['this_year 销售额是多少？', 'this_year'],
  ];

  for (const [question, preset] of cases) {
    assert.equal(parse(question).dateRange?.preset, preset, question);
  }
});

test('unit: AI intent parser applies default time and lookup row limit rules', () => {
  const analytics = parse('销售额是多少？');
  assert.equal(analytics.intent, 'analytics_overview');
  assert.equal(analytics.dateRange?.preset, 'this_month');
  assert.equal(analytics.dateRange?.dateFrom, '2026-07-01');
  assert.equal(analytics.dateRange?.dateTo, '2026-07-04');
  assert.equal(analytics.limit, null);

  const customerLookup = parse('客户张三买过什么酒？');
  assert.equal(customerLookup.intent, 'customer_order_lookup');
  assert.equal(customerLookup.dateRange, null);
  assert.equal(customerLookup.limit, AI_DEFAULT_LOOKUP_LIMIT);
  assert.match(customerLookup.warnings.join('\n'), /限制返回行数/);
});

test('unit: AI intent parser recognizes typical stage 9 questions', () => {
  const cases = [
    ['今天销售额是多少？', 'analytics_overview'],
    ['近 10 天打蛋率趋势怎么样？', 'analytics_trend'],
    ['本月哪个品鉴师排名第一？', 'taster_ranking'],
    ['某个品鉴师本月为什么排名下降？', 'taster_detail'],
    ['本月财务核对情况怎么样？', 'finance_summary'],
    ['本月销售提成总额是多少？', 'commission_query'],
    ['本月已确认退款金额是多少？', 'refund_query'],
    ['某订单有没有售后记录？', 'after_sales_lookup'],
    ['某物流单号对应哪一个订单？', 'logistics_lookup'],
    ['最近经营情况有什么风险？', 'management_suggestion'],
  ];

  for (const [question, intent] of cases) {
    assert.equal(parse(question).intent, intent, question);
  }
});

test('unit: AI intent parser recognizes unsafe write, SQL, permission, and out-of-scope questions', () => {
  assert.equal(parse('帮我把这个订单改成已退款').intent, 'unsafe_write_request');
  assert.equal(parse('删除某客户').intent, 'unsafe_write_request');
  assert.equal(parse('写 SQL 查一下 sales_orders 表').intent, 'out_of_scope');
  assert.equal(parse('给我看所有员工密码').intent, 'permission_denied');
  assert.equal(parse('帮我训练一个复杂知识库').intent, 'out_of_scope');
});

function parse(question, options = {}) {
  return new AiIntentService().parseQuestion(question, {
    now: FIXED_NOW,
    ...options,
  });
}
