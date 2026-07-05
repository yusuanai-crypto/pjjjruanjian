const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

const TEMPLATE_PATH = '/api/ai/chat/templates';

test('contract: AI chat templates enforce login and first-version AI roles', async () => {
  await withPhase1Server(async (baseUrl) => {
    const missingToken = await requestJson(baseUrl, TEMPLATE_PATH);
    assertErrorContract(missingToken, 401, 'AUTH_TOKEN_REQUIRED');

    for (const username of [
      'admin',
      'stage9-template-boss',
      'stage9-template-finance',
      'stage9-template-after-sales',
    ]) {
      const session =
        username === 'admin'
          ? await login(baseUrl)
          : await login(baseUrl, username, 'Password123');
      const result = await requestJson(baseUrl, TEMPLATE_PATH, {
        token: session.token,
      });
      assert.equal(result.response.status, 200, username);
      assertTemplateListContract(result.body.data);
      assert.equal(result.body.data.length > 0, true, username);
    }

    for (const username of [
      'stage9-template-warehouse',
      'stage9-template-sales',
      'stage9-template-taster',
      'stage9-template-front-desk',
    ]) {
      const session = await login(baseUrl, username, 'Password123');
      const denied = await requestJson(baseUrl, TEMPLATE_PATH, {
        token: session.token,
      });
      assertErrorContract(denied, 403, 'AI_ROLE_NOT_ALLOWED');
    }
  }, {
    prisma: buildTemplateUsersPrisma(),
  });
});

test('contract: AI chat templates return only admin and boss management templates', async () => {
  await withPhase1Server(async (baseUrl) => {
    for (const username of ['admin', 'stage9-template-boss']) {
      const session =
        username === 'admin'
          ? await login(baseUrl)
          : await login(baseUrl, username, 'Password123');
      const result = await requestJson(baseUrl, TEMPLATE_PATH, {
        token: session.token,
      });

      assert.equal(result.response.status, 200);
      assert.deepEqual(templateIds(result.body.data), [
        'management_sales_amount',
        'management_taster_ranking',
        'management_no_order_rate',
        'management_refund_amount',
        'management_suggestion',
      ]);
      assert.deepEqual(templateTitles(result.body.data), [
        '销售额',
        '品鉴师排名',
        '打蛋率',
        '退单金额',
        '经营建议',
      ]);
      assertRoleScopes(result.body.data, ['admin', 'boss']);
      assertNoTemplateIds(result.body.data, [
        'finance_refund_amount',
        'after_sales_customer_orders',
      ]);
    }
  }, {
    prisma: buildTemplateUsersPrisma(),
  });
});

test('contract: AI chat templates return only finance templates', async () => {
  await withPhase1Server(async (baseUrl) => {
    const session = await login(
      baseUrl,
      'stage9-template-finance',
      'Password123',
    );
    const result = await requestJson(baseUrl, TEMPLATE_PATH, {
      token: session.token,
    });

    assert.equal(result.response.status, 200);
    assert.deepEqual(templateIds(result.body.data), [
      'finance_refund_amount',
      'finance_logistics_fee',
      'finance_commission',
      'finance_points',
      'finance_reconciliation',
    ]);
    assert.deepEqual(templateTitles(result.body.data), [
      '退款金额',
      '物流费用',
      '销售提成',
      '旅行团积分',
      '财务核对',
    ]);
    assertRoleScopes(result.body.data, ['finance']);
    assertNoTemplateIds(result.body.data, [
      'management_suggestion',
      'after_sales_customer_orders',
    ]);
  }, {
    prisma: buildTemplateUsersPrisma(),
  });
});

test('contract: AI chat templates return only after-sales templates', async () => {
  await withPhase1Server(async (baseUrl) => {
    const session = await login(
      baseUrl,
      'stage9-template-after-sales',
      'Password123',
    );
    const result = await requestJson(baseUrl, TEMPLATE_PATH, {
      token: session.token,
    });

    assert.equal(result.response.status, 200);
    assert.deepEqual(templateIds(result.body.data), [
      'after_sales_customer_orders',
      'after_sales_history',
      'after_sales_logistics_no',
    ]);
    assert.deepEqual(templateTitles(result.body.data), [
      '客户订单',
      '售后历史',
      '物流单号',
    ]);
    assertRoleScopes(result.body.data, ['after_sales']);
    assertNoTemplateIds(result.body.data, [
      'management_sales_amount',
      'finance_commission',
    ]);
  }, {
    prisma: buildTemplateUsersPrisma(),
  });
});

function assertTemplateListContract(templates) {
  assert.equal(Array.isArray(templates), true);
  for (const template of templates) {
    assert.deepEqual(Object.keys(template).sort(), [
      'id',
      'intent',
      'question',
      'roleScopes',
      'title',
    ]);
    assert.equal(typeof template.id, 'string');
    assert.equal(typeof template.title, 'string');
    assert.equal(typeof template.question, 'string');
    assert.equal(typeof template.intent, 'string');
    assert.equal(Array.isArray(template.roleScopes), true);
    assert.equal(template.roleScopes.length > 0, true);
  }
}

function assertRoleScopes(templates, expected) {
  for (const template of templates) {
    assert.deepEqual(template.roleScopes, expected);
  }
}

function assertNoTemplateIds(templates, deniedIds) {
  const ids = templateIds(templates);
  for (const id of deniedIds) {
    assert.equal(ids.includes(id), false, id);
  }
}

function templateIds(templates) {
  return templates.map((template) => template.id);
}

function templateTitles(templates) {
  return templates.map((template) => template.title);
}

function buildTemplateUsersPrisma() {
  return {
    users: [
      { username: 'stage9-template-boss', role: 'boss' },
      { username: 'stage9-template-finance', role: 'finance' },
      { username: 'stage9-template-after-sales', role: 'after_sales' },
      { username: 'stage9-template-warehouse', role: 'warehouse' },
      { username: 'stage9-template-sales', role: 'sales' },
      { username: 'stage9-template-taster', role: 'taster' },
      { username: 'stage9-template-front-desk', role: 'front_desk' },
    ],
  };
}
