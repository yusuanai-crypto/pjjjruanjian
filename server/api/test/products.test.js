const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  createUser,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

const PASSWORD = 'Password123';

test('contract: product management requires admin or finance and supports paging and status', async () => {
  await withPhase1Server(async (baseUrl) => {
    const anonymous = await requestJson(baseUrl, '/api/products');
    assertErrorContract(anonymous, 401, 'AUTH_TOKEN_REQUIRED');

    const admin = await login(baseUrl);
    const sessions = await createRoleSessions(baseUrl, admin.token, [
      'finance',
      'boss',
      'front_desk',
      'sales',
      'warehouse',
      'after_sales',
      'taster',
    ]);

    for (const role of ['boss', 'front_desk', 'sales', 'warehouse', 'after_sales', 'taster']) {
      const denied = await requestJson(baseUrl, '/api/products', {
        token: sessions[role].token,
      });
      assertErrorContract(denied, 403, 'PERMISSION_DENIED');
    }

    const created = await requestJson(baseUrl, '/api/products', {
      method: 'POST',
      token: admin.token,
      headers: { 'x-forwarded-for': '203.0.113.10' },
      body: {
        name: '  Stage 10 Wine  ',
        unit: ' bottle ',
        notes: ' first product ',
      },
    });
    assert.equal(created.response.status, 201);
    const product = created.body.data.product;
    assertProductContract(product);
    assert.equal(product.name, 'Stage 10 Wine');
    assert.equal(product.unit, 'bottle');
    assert.equal(product.notes, 'first product');
    assert.equal(product.isActive, true);

    for (const body of [
      { name: '   ', unit: 'bottle' },
      { name: 'Invalid Empty Unit', unit: '   ' },
      { name: 'N'.repeat(161), unit: 'bottle' },
      { name: 'Invalid Long Unit', unit: 'U'.repeat(21) },
    ]) {
      const invalid = await requestJson(baseUrl, '/api/products', {
        method: 'POST',
        token: admin.token,
        body,
      });
      assertErrorContract(invalid, 400, 'VALIDATION_FAILED');
    }

    const duplicate = await requestJson(baseUrl, '/api/products', {
      method: 'POST',
      token: sessions.finance.token,
      body: {
        name: 'Stage  10 Wine',
        unit: 'box',
      },
    });
    assertErrorContract(duplicate, 409, 'PRODUCT_NAME_EXISTS');

    const second = await requestJson(baseUrl, '/api/products', {
      method: 'POST',
      token: sessions.finance.token,
      body: {
        name: 'Second Product',
        unit: 'case',
        isActive: false,
      },
    });
    assert.equal(second.response.status, 201);

    const list = await requestJson(
      baseUrl,
      '/api/products?page=1&pageSize=1&isActive=true&keyword=Stage',
      { token: sessions.finance.token },
    );
    assert.equal(list.response.status, 200);
    assert.equal(list.body.data.products.length, 1);
    assert.equal(list.body.data.products[0].id, product.id);
    assert.deepEqual(list.body.data.pagination, {
      page: 1,
      pageSize: 1,
      total: 1,
      totalPages: 1,
    });

    const updated = await requestJson(baseUrl, `/api/products/${product.id}`, {
      method: 'PATCH',
      token: sessions.finance.token,
      body: {
        name: 'Stage 10 Reserve',
        unit: 'case',
        notes: null,
        inventoryTrackingMode: 'serialized',
      },
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.data.product.name, 'Stage 10 Reserve');
    assert.equal(updated.body.data.product.unit, 'case');
    assert.equal(updated.body.data.product.notes, null);
    assert.equal(
      updated.body.data.product.inventoryTrackingMode,
      'serialized',
    );

    const disabled = await requestJson(
      baseUrl,
      `/api/products/${product.id}/status`,
      {
        method: 'PATCH',
        token: admin.token,
        body: { isActive: false },
      },
    );
    assert.equal(disabled.response.status, 200);
    assert.equal(disabled.body.data.product.isActive, false);

    const enabled = await requestJson(
      baseUrl,
      `/api/products/${product.id}/status`,
      {
        method: 'PATCH',
        token: sessions.finance.token,
        body: { isActive: true },
      },
    );
    assert.equal(enabled.response.status, 200);
    assert.equal(enabled.body.data.product.isActive, true);

    for (const role of ['boss', 'front_desk', 'sales', 'warehouse', 'after_sales', 'taster']) {
      const deniedCosts = await requestJson(
        baseUrl,
        `/api/products/${product.id}/actual-costs`,
        { token: sessions[role].token },
      );
      assertErrorContract(deniedCosts, 403, 'PERMISSION_DENIED');
    }

    const deleteAttempt = await requestJson(baseUrl, `/api/products/${product.id}`, {
      method: 'DELETE',
      token: admin.token,
    });
    assert.equal(deleteAttempt.response.status, 404);

    const fetched = await requestJson(baseUrl, `/api/products/${product.id}`, {
      token: admin.token,
    });
    assert.equal(fetched.response.status, 200);
    assert.equal(fetched.body.data.product.name, 'Stage 10 Reserve');
    assert.equal(fetched.body.data.product.isActive, true);

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?entityType=product',
      { token: admin.token },
    );
    assert.equal(logs.response.status, 200);
    const createLog = logs.body.data.logs.find(
      (log) => log.action === 'products.create' && log.entityId === product.id,
    );
    const updateLog = logs.body.data.logs.find(
      (log) => log.action === 'products.update' && log.entityId === product.id,
    );
    const statusLog = logs.body.data.logs.find(
      (log) => log.action === 'products.disable' && log.entityId === product.id,
    );
    const enableLog = logs.body.data.logs.find(
      (log) => log.action === 'products.enable' && log.entityId === product.id,
    );
    assert.ok(createLog);
    assert.ok(updateLog);
    assert.ok(statusLog);
    assert.ok(enableLog);
    assert.equal(createLog.ipAddress, '203.0.113.10');
    assert.equal(createLog.userId, admin.user.id);
    assert.equal(createLog.beforeData, null);
    assert.equal(createLog.afterData.name, 'Stage 10 Wine');
    assert.equal(updateLog.beforeData.name, 'Stage 10 Wine');
    assert.equal(updateLog.afterData.name, 'Stage 10 Reserve');
    assert.equal(statusLog.beforeData.isActive, true);
    assert.equal(statusLog.afterData.isActive, false);
  });
});

test('contract: actual-cost history uses integer cents and rejects overlapping active ranges', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const sessions = await createRoleSessions(baseUrl, admin.token, ['finance', 'sales']);
    const product = await createProduct(baseUrl, admin.token, 'Costed Product');

    const denied = await requestJson(
      baseUrl,
      `/api/products/${product.id}/actual-costs`,
      { token: sessions.sales.token },
    );
    assertErrorContract(denied, 403, 'PERMISSION_DENIED');

    const created = await requestJson(
      baseUrl,
      `/api/products/${product.id}/actual-costs`,
      {
        method: 'POST',
        token: sessions.finance.token,
        body: {
          costCents: 12345,
          effectiveFrom: '2026-07-11',
          effectiveTo: '2026-12-31',
          notes: 'opening cost',
        },
      },
    );
    assert.equal(created.response.status, 201);
    const actualCost = created.body.data.actualCost;
    assertActualCostContract(actualCost);
    assert.equal(actualCost.costCents, 12345);
    assert.equal(actualCost.effectiveFrom, '2026-07-11');

    for (const invalidValue of [12.5, -1, '12345']) {
      const invalid = await requestJson(
        baseUrl,
        `/api/products/${product.id}/actual-costs`,
        {
          method: 'POST',
          token: admin.token,
          body: {
            costCents: invalidValue,
            effectiveFrom: '2027-01-01',
          },
        },
      );
      assertErrorContract(invalid, 400, 'VALIDATION_FAILED');
    }

    const overlap = await requestJson(
      baseUrl,
      `/api/products/${product.id}/actual-costs`,
      {
        method: 'POST',
        token: admin.token,
        body: {
          costCents: 13000,
          effectiveFrom: '2026-12-31',
          effectiveTo: '2027-06-30',
        },
      },
    );
    assertErrorContract(overlap, 409, 'PRODUCT_ACTUAL_COST_RANGE_OVERLAP');
    assert.match(overlap.body.error.message, /must not overlap/i);

    const nonOverlapping = await requestJson(
      baseUrl,
      `/api/products/${product.id}/actual-costs`,
      {
        method: 'POST',
        token: admin.token,
        body: {
          costCents: 13000,
          effectiveFrom: '2027-01-01',
        },
      },
    );
    assert.equal(nonOverlapping.response.status, 201);
    const secondCost = nonOverlapping.body.data.actualCost;

    const editOverlap = await requestJson(
      baseUrl,
      `/api/product-actual-costs/${secondCost.id}`,
      {
        method: 'PATCH',
        token: sessions.finance.token,
        body: { effectiveFrom: '2026-12-01' },
      },
    );
    assertErrorContract(editOverlap, 409, 'PRODUCT_ACTUAL_COST_RANGE_OVERLAP');

    const disabled = await requestJson(
      baseUrl,
      `/api/product-actual-costs/${actualCost.id}/status`,
      {
        method: 'PATCH',
        token: sessions.finance.token,
        body: { isActive: false },
      },
    );
    assert.equal(disabled.response.status, 200);
    assert.equal(disabled.body.data.actualCost.isActive, false);

    const edited = await requestJson(
      baseUrl,
      `/api/product-actual-costs/${secondCost.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          costCents: 13100,
          effectiveFrom: '2026-12-01',
          notes: 'revised',
        },
      },
    );
    assert.equal(edited.response.status, 200);
    assert.equal(edited.body.data.actualCost.costCents, 13100);

    const history = await requestJson(
      baseUrl,
      `/api/products/${product.id}/actual-costs`,
      { token: admin.token },
    );
    assert.equal(history.response.status, 200);
    assert.equal(history.body.data.actualCosts.length, 2);

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?entityType=product_actual_cost',
      { token: admin.token },
    );
    assert.equal(logs.response.status, 200);
    assert.ok(logs.body.data.logs.some((log) => log.action === 'product_actual_costs.create'));
    assert.ok(logs.body.data.logs.some((log) => log.action === 'product_actual_costs.update'));
    assert.ok(logs.body.data.logs.some((log) => log.action === 'product_actual_costs.disable'));
  });
});

test('contract: product options are active-only and cannot leak costs or audit fields', async () => {
  await withPhase1Server(async (baseUrl) => {
    const anonymous = await requestJson(baseUrl, '/api/products/options');
    assertErrorContract(anonymous, 401, 'AUTH_TOKEN_REQUIRED');

    const admin = await login(baseUrl);
    const sessions = await createRoleSessions(baseUrl, admin.token, [
      'finance',
      'boss',
      'front_desk',
      'sales',
      'warehouse',
      'after_sales',
      'taster',
    ]);
    const active = await createProduct(baseUrl, admin.token, 'Active Option');
    const inactive = await createProduct(baseUrl, admin.token, 'Inactive Option', false);
    await requestJson(baseUrl, `/api/products/${active.id}/actual-costs`, {
      method: 'POST',
      token: admin.token,
      body: {
        costCents: 999999,
        effectiveFrom: '2026-07-11',
        notes: 'must remain secret',
      },
    });

    for (const token of [
      admin.token,
      sessions.finance.token,
      sessions.boss.token,
      sessions.front_desk.token,
      sessions.sales.token,
      sessions.warehouse.token,
      sessions.after_sales.token,
    ]) {
      const options = await requestJson(baseUrl, '/api/products/options', { token });
      assert.equal(options.response.status, 200);
      assert.deepEqual(options.body.data.products, [
        {
          id: active.id,
          name: 'Active Option',
          unit: 'bottle',
          inventoryTrackingMode: 'none',
        },
      ]);
      const serialized = JSON.stringify(options.body.data);
      for (const forbidden of [
        'costCents',
        'actualCosts',
        'createdById',
        'updatedById',
        'createdAt',
        'updatedAt',
        'normalizedName',
        'must remain secret',
        inactive.id,
      ]) {
        assert.equal(serialized.includes(forbidden), false, `options leaked ${forbidden}`);
      }
    }

    for (const role of ['taster']) {
      const denied = await requestJson(baseUrl, '/api/products/options', {
        token: sessions[role].token,
      });
      assertErrorContract(denied, 403, 'PERMISSION_DENIED');
    }
  });
});

async function createRoleSessions(baseUrl, adminToken, roles) {
  const sessions = {};
  for (const role of roles) {
    const username = `products-${role.replace(/_/g, '-')}`;
    await createUser(baseUrl, adminToken, {
      name: `Products ${role}`,
      username,
      password: PASSWORD,
      role,
    });
    sessions[role] = await login(baseUrl, username, PASSWORD);
  }
  return sessions;
}

async function createProduct(baseUrl, token, name, isActive = true) {
  const result = await requestJson(baseUrl, '/api/products', {
    method: 'POST',
    token,
    body: {
      name,
      unit: 'bottle',
      isActive,
    },
  });
  assert.equal(result.response.status, 201);
  return result.body.data.product;
}

function assertProductContract(product) {
  assert.deepEqual(Object.keys(product).sort(), [
    'createdAt',
    'createdById',
    'id',
    'inventoryTrackingMode',
    'isActive',
    'name',
    'notes',
    'unit',
    'updatedAt',
    'updatedById',
  ]);
  assert.equal(typeof product.id, 'string');
  assert.equal(typeof product.name, 'string');
  assert.equal(typeof product.unit, 'string');
  assert.equal(product.inventoryTrackingMode, 'none');
  assert.equal(typeof product.isActive, 'boolean');
  assert.equal('normalizedName' in product, false);
}

function assertActualCostContract(cost) {
  assert.deepEqual(Object.keys(cost).sort(), [
    'costCents',
    'createdAt',
    'createdById',
    'effectiveFrom',
    'effectiveTo',
    'id',
    'isActive',
    'notes',
    'productId',
    'updatedAt',
    'updatedById',
  ]);
  assert.equal(Number.isInteger(cost.costCents), true);
  assert.equal(cost.costCents >= 0, true);
}
