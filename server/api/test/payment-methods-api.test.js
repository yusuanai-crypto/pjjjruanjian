const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  createUser,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

const SHOUQIANBA_ID = '00000000-0000-4000-8000-000000000001';
const CASH_ID = '00000000-0000-4000-8000-000000000004';

test('order-reading roles can list active methods while only finance and administrators maintain them', async () => {
  await withPhase1Server(async (baseUrl) => {
    const superAdmin = await login(baseUrl);
    const roleSessions = new Map();
    for (const role of [
      'admin',
      'boss',
      'front_desk',
      'sales',
      'finance',
      'warehouse',
      'after_sales',
      'taster',
    ]) {
      const user = await createUser(baseUrl, superAdmin.token, {
        name: `Payment ${role}`,
        username: `payment-method-${role}`,
        password: 'Password123',
        role,
      });
      roleSessions.set(
        role,
        await login(baseUrl, user.username, 'Password123'),
      );
    }

    for (const [role, session] of roleSessions) {
      const listed = await requestJson(baseUrl, '/api/payment-methods', {
        token: session.token,
      });
      assert.equal(listed.response.status, 200, `${role} should read`);
      assert.equal(listed.body.data.paymentMethods.length, 6);
    }

    for (const role of [
      'boss',
      'front_desk',
      'sales',
      'warehouse',
      'after_sales',
      'taster',
    ]) {
      const deniedRateUpdate = await requestJson(
        baseUrl,
        `/api/payment-methods/${CASH_ID}`,
        {
          method: 'PATCH',
          token: roleSessions.get(role).token,
          body: {
            serviceFeeRate: '0.010000',
          },
        },
      );
      assertErrorContract(
        deniedRateUpdate,
        403,
        'PERMISSION_DENIED',
      );
    }

    for (const role of ['super_admin', 'admin', 'finance']) {
      const session =
        role === 'super_admin' ? superAdmin : roleSessions.get(role);
      const suffix = role.replace('_', '');
      const created = await requestJson(
        baseUrl,
        '/api/payment-methods',
        {
          method: 'POST',
          token: session.token,
          body: {
            code: `maintainer_${suffix}`,
            name: `维护角色 ${role}`,
            category: 'direct_receipt',
            sortOrder: 100,
          },
        },
      );
      assert.equal(created.response.status, 201, `${role} should maintain`);
      assert.equal(created.body.data.paymentMethod.serviceFeeRate, null);
    }
  });
});

test('DTO is stable, names are unique, code is immutable, and inactive methods are hidden from ordinary readers', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const salesUser = await createUser(baseUrl, admin.token, {
      name: 'Payment Reader',
      username: 'payment-method-reader',
      password: 'Password123',
      role: 'sales',
    });
    const sales = await login(
      baseUrl,
      salesUser.username,
      'Password123',
    );

    const created = await requestJson(baseUrl, '/api/payment-methods', {
      method: 'POST',
      token: admin.token,
      body: {
        code: 'delivery_partner',
        name: '配送代收',
        category: 'collect_on_delivery',
        serviceFeeRate: '0.006',
        sortOrder: 70,
      },
    });
    assert.equal(created.response.status, 201);
    const method = created.body.data.paymentMethod;
    assert.deepEqual(Object.keys(method).sort(), [
      'category',
      'code',
      'createdAt',
      'createdById',
      'id',
      'isActive',
      'isDefault',
      'name',
      'serviceFeeRate',
      'sortOrder',
      'updatedAt',
      'updatedById',
    ]);
    assert.equal(method.category, 'collect_on_delivery');
    assert.equal(method.serviceFeeRate, '0.006000');
    assert.equal(method.createdById, 'usr_admin');
    assert.equal(method.updatedById, 'usr_admin');

    const edited = await requestJson(
      baseUrl,
      `/api/payment-methods/${method.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          name: '配送代收（更新）',
          category: 'direct_receipt',
          serviceFeeRate: '0',
        },
      },
    );
    assert.equal(edited.response.status, 200);
    assert.equal(edited.body.data.paymentMethod.code, method.code);
    assert.equal(edited.body.data.paymentMethod.name, '配送代收（更新）');
    assert.equal(
      edited.body.data.paymentMethod.serviceFeeRate,
      '0.000000',
    );
    assert.equal(
      edited.body.data.paymentMethod.category,
      'direct_receipt',
    );

    const duplicateName = await requestJson(
      baseUrl,
      '/api/payment-methods',
      {
        method: 'POST',
        token: admin.token,
        body: {
          code: 'delivery_partner_2',
          name: ' 配送代收（更新） ',
          category: 'direct_receipt',
        },
      },
    );
    assertErrorContract(
      duplicateName,
      409,
      'PAYMENT_METHOD_NAME_EXISTS',
    );

    const emptyName = await requestJson(
      baseUrl,
      `/api/payment-methods/${method.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: { name: '   ' },
      },
    );
    assertErrorContract(emptyName, 400, 'VALIDATION_FAILED');

    const immutableCode = await requestJson(
      baseUrl,
      `/api/payment-methods/${method.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: { code: 'renamed_code' },
      },
    );
    assertErrorContract(
      immutableCode,
      409,
      'PAYMENT_METHOD_CODE_IMMUTABLE',
    );

    const disabled = await requestJson(
      baseUrl,
      `/api/payment-methods/${method.id}/disable`,
      {
        method: 'PATCH',
        token: admin.token,
      },
    );
    assert.equal(disabled.response.status, 200);
    assert.equal(disabled.body.data.paymentMethod.isActive, false);
    assert.equal(
      disabled.body.data.paymentMethod.serviceFeeRate,
      '0.000000',
    );

    const readerList = await requestJson(
      baseUrl,
      '/api/payment-methods?includeInactive=true',
      { token: sales.token },
    );
    assert.equal(
      readerList.body.data.paymentMethods.some(
        (item) => item.id === method.id,
      ),
      false,
    );

    const managerList = await requestJson(
      baseUrl,
      '/api/payment-methods?includeInactive=true',
      { token: admin.token },
    );
    assert.equal(
      managerList.body.data.paymentMethods.find(
        (item) => item.id === method.id,
      ).isActive,
      false,
    );

    const enabled = await requestJson(
      baseUrl,
      `/api/payment-methods/${method.id}/enable`,
      {
        method: 'PATCH',
        token: admin.token,
      },
    );
    assert.equal(enabled.response.status, 200);
    assert.equal(enabled.body.data.paymentMethod.isActive, true);
    assert.equal(
      enabled.body.data.paymentMethod.serviceFeeRate,
      '0.000000',
    );

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?entityType=payment_method',
      { token: admin.token },
    );
    assert.equal(logs.response.status, 200);
    for (const action of [
      'payment_methods.create',
      'payment_methods.update',
      'payment_methods.disable',
      'payment_methods.enable',
    ]) {
      const log = logs.body.data.logs.find(
        (item) =>
          item.action === action &&
          item.entityId === method.id &&
          item.afterData !== null,
      );
      assert.ok(log, `${action} should be audited`);
      if (action !== 'payment_methods.create') {
        assert.notEqual(log.beforeData, null);
      }
    }
    const createLog = logs.body.data.logs.find(
      (item) =>
        item.action === 'payment_methods.create' &&
        item.entityId === method.id,
    );
    assert.equal(createLog.afterData.serviceFeeRate, '0.006000');
    const rateUpdateLog = logs.body.data.logs.find(
      (item) =>
        item.action === 'payment_methods.update' &&
        item.entityId === method.id &&
        item.afterData?.serviceFeeRate === '0.000000',
    );
    assert.ok(rateUpdateLog);
    assert.equal(rateUpdateLog.beforeData.serviceFeeRate, '0.006000');

    const deleteAttempt = await requestJson(
      baseUrl,
      `/api/payment-methods/${method.id}`,
      {
        method: 'DELETE',
        token: admin.token,
      },
    );
    assert.equal(deleteAttempt.response.status, 404);
  });
});

test('service fee rates use exact six-decimal strings, preserve null, and never rewrite historical snapshots', async () => {
  await withPhase1Server(async (baseUrl, { prisma }) => {
    const admin = await login(baseUrl);
    const created = await requestJson(baseUrl, '/api/payment-methods', {
      method: 'POST',
      token: admin.token,
      body: {
        code: 'snapshot_rate_method',
        name: '历史快照费率方式',
        category: 'direct_receipt',
        serviceFeeRate: '0.006',
      },
    });
    assert.equal(created.response.status, 201);
    const method = created.body.data.paymentMethod;
    assert.equal(method.serviceFeeRate, '0.006000');

    const historicalDetail =
      await prisma.salesOrderPaymentDetail.create({
        data: {
          id: 'historical-rate-payment-detail',
          salesOrderId: 'historical-rate-order',
          paymentMethodId: method.id,
          paymentMethodNameSnapshot: method.name,
          paymentMethodCategorySnapshot: 'DIRECT_RECEIPT',
          amountCents: 10000,
          serviceFeeRateSnapshot: '0.006000',
          serviceFeeBaseAmountSnapshotCents: 10000,
          collectionConfirmed: false,
          collectionConfirmedAt: null,
          collectionConfirmedById: null,
          sortOrder: 0,
          createdAt: new Date('2026-07-29T00:00:00.000Z'),
          updatedAt: new Date('2026-07-29T00:00:00.000Z'),
        },
      });

    const updated = await requestJson(
      baseUrl,
      `/api/payment-methods/${method.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: { serviceFeeRate: '0.123456' },
      },
    );
    assert.equal(updated.response.status, 200);
    assert.equal(
      updated.body.data.paymentMethod.serviceFeeRate,
      '0.123456',
    );
    assert.equal(
      (
        await prisma.salesOrderPaymentDetail.findUnique({
          where: { id: historicalDetail.id },
        })
      ).serviceFeeRateSnapshot,
      '0.006000',
    );

    const cleared = await requestJson(
      baseUrl,
      `/api/payment-methods/${method.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: { serviceFeeRate: null },
      },
    );
    assert.equal(cleared.response.status, 200);
    assert.equal(cleared.body.data.paymentMethod.serviceFeeRate, null);
    assert.equal(
      (
        await prisma.salesOrderPaymentDetail.findUnique({
          where: { id: historicalDetail.id },
        })
      ).serviceFeeRateSnapshot,
      '0.006000',
    );

    for (const invalidRate of [
      '-0.1',
      '1.000001',
      '0.1234567',
      '',
      0.006,
    ]) {
      assertErrorContract(
        await requestJson(
          baseUrl,
          `/api/payment-methods/${method.id}`,
          {
            method: 'PATCH',
            token: admin.token,
            body: { serviceFeeRate: invalidRate },
          },
        ),
        400,
        'VALIDATION_FAILED',
      );
    }
  });
});

test('setting a default is atomic, leaves exactly one active default, and the current default cannot be disabled', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const created = await requestJson(baseUrl, '/api/payment-methods', {
      method: 'POST',
      token: admin.token,
      body: {
        code: 'next_default',
        name: '新的默认方式',
        category: 'direct_receipt',
      },
    });
    const nextDefault = created.body.data.paymentMethod;

    const disableCurrent = await requestJson(
      baseUrl,
      `/api/payment-methods/${SHOUQIANBA_ID}/disable`,
      {
        method: 'PATCH',
        token: admin.token,
      },
    );
    assertErrorContract(
      disableCurrent,
      409,
      'DEFAULT_PAYMENT_METHOD_REQUIRED',
    );

    const switched = await requestJson(
      baseUrl,
      `/api/payment-methods/${nextDefault.id}/default`,
      {
        method: 'PATCH',
        token: admin.token,
      },
    );
    assert.equal(switched.response.status, 200);
    assert.equal(switched.body.data.paymentMethod.isActive, true);
    assert.equal(switched.body.data.paymentMethod.isDefault, true);

    const listed = await requestJson(
      baseUrl,
      '/api/payment-methods?includeInactive=true',
      { token: admin.token },
    );
    const defaults = listed.body.data.paymentMethods.filter(
      (method) => method.isDefault,
    );
    assert.equal(defaults.length, 1);
    assert.equal(defaults[0].id, nextDefault.id);
    assert.equal(defaults[0].isActive, true);
    assert.equal(
      listed.body.data.paymentMethods.find(
        (method) => method.id === SHOUQIANBA_ID,
      ).isDefault,
      false,
    );

    const disableNewDefault = await requestJson(
      baseUrl,
      `/api/payment-methods/${nextDefault.id}/disable`,
      {
        method: 'PATCH',
        token: admin.token,
      },
    );
    assertErrorContract(
      disableNewDefault,
      409,
      'DEFAULT_PAYMENT_METHOD_REQUIRED',
    );

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=payment_methods.set_default',
      { token: admin.token },
    );
    assert.equal(logs.response.status, 200);
    const changedLogs = logs.body.data.logs.filter(
      (log) =>
        log.entityId === SHOUQIANBA_ID ||
        log.entityId === nextDefault.id,
    );
    assert.equal(changedLogs.length >= 2, true);
    assert.equal(
      changedLogs.every(
        (log) => log.beforeData !== null && log.afterData !== null,
      ),
      true,
    );
  });
});

test('sorting is transactional, permission-protected, stable, and audited per changed method', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const salesUser = await createUser(baseUrl, admin.token, {
      name: 'Payment Sort Reader',
      username: 'payment-sort-reader',
      password: 'Password123',
      role: 'sales',
    });
    const sales = await login(
      baseUrl,
      salesUser.username,
      'Password123',
    );
    const body = {
      items: [
        { id: CASH_ID, sortOrder: 1 },
        { id: SHOUQIANBA_ID, sortOrder: 99 },
      ],
    };

    const denied = await requestJson(
      baseUrl,
      '/api/payment-methods/sort-order',
      {
        method: 'PATCH',
        token: sales.token,
        body,
      },
    );
    assertErrorContract(denied, 403, 'PERMISSION_DENIED');

    const sorted = await requestJson(
      baseUrl,
      '/api/payment-methods/sort-order',
      {
        method: 'PATCH',
        token: admin.token,
        body,
      },
    );
    assert.equal(sorted.response.status, 200);
    assert.equal(sorted.body.data.paymentMethods[0].id, CASH_ID);
    assert.equal(
      sorted.body.data.paymentMethods.filter(
        (method) => method.isDefault && method.isActive,
      ).length,
      1,
    );

    const duplicated = await requestJson(
      baseUrl,
      '/api/payment-methods/sort-order',
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          items: [
            { id: CASH_ID, sortOrder: 2 },
            { id: CASH_ID, sortOrder: 3 },
          ],
        },
      },
    );
    assertErrorContract(duplicated, 400, 'VALIDATION_FAILED');

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=payment_methods.sort',
      { token: admin.token },
    );
    assert.equal(logs.response.status, 200);
    const sortLogs = logs.body.data.logs.filter((log) =>
      [CASH_ID, SHOUQIANBA_ID].includes(log.entityId),
    );
    assert.equal(sortLogs.length, 2);
    assert.equal(
      sortLogs.every(
        (log) =>
          log.beforeData.sortOrder !== log.afterData.sortOrder,
      ),
      true,
    );
  });
});
