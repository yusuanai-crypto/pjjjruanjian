const assert = require('node:assert/strict');
const test = require('node:test');
const ExcelJS = require('exceljs');

const {
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

test('operation log APIs enforce admin access and support complete online/archive filtering', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const superAdmin = await login(baseUrl, 'admin');
      const admin = await login(baseUrl, 'audit-admin', 'Password123');
      for (const username of [
        'audit-boss',
        'audit-finance',
        'audit-warehouse',
        'audit-sales',
        'audit-after-sales',
        'audit-taster',
        'audit-front-desk',
      ]) {
        const session = await login(baseUrl, username, 'Password123');
        const forbidden = await requestJson(
          baseUrl,
          '/api/operation-logs',
          { token: session.token },
        );
        assert.equal(forbidden.response.status, 403);
      }

      for (const token of [superAdmin.token, admin.token]) {
        const response = await requestJson(
          baseUrl,
          '/api/operation-logs?module=audit_fixture&pageSize=100',
          { token },
        );
        assert.equal(response.response.status, 200);
        assert.equal(response.body.data.total, 3);
        assert.deepEqual(
          response.body.data.logs.map((log) => log.id),
          ['audit-log-3', 'audit-log-2', 'audit-log-1'],
        );
      }

      const combined = await requestJson(
        baseUrl,
        '/api/operation-logs?' +
          new URLSearchParams({
            userId: 'usr-audit-sales',
            startTime: '2026-07-20T00:00:00.000Z',
            endTime: '2026-07-21T23:59:59.999Z',
            module: 'audit_fixture',
            operationType: 'UPDATE',
            action: 'audit_fixture.update',
            entityType: 'customer',
            entityId: 'customer-audit-2',
            result: 'FAILURE',
            ipAddress: '10.0.0.2',
            page: '1',
            pageSize: '10',
          }),
        { token: admin.token },
      );
      assert.equal(combined.response.status, 200);
      assert.equal(combined.body.data.total, 1);
      assert.equal(combined.body.data.logs[0].id, 'audit-log-2');
      assert.equal(
        combined.body.data.logs[0].actorUsernameSnapshot,
        'audit-sales',
      );

      const detail = await requestJson(
        baseUrl,
        '/api/operation-logs/audit-log-2',
        { token: admin.token },
      );
      assert.equal(detail.response.status, 200);
      assert.deepEqual(detail.body.data.beforeData, { status: 'old' });
      assert.deepEqual(detail.body.data.afterData, { status: 'new' });
      assert.equal(detail.body.data.errorCode, 'TEST_FAILURE');
      const detailText = JSON.stringify(detail.body.data);
      for (const forbidden of [
        'purchaseUnitCostCents',
        'inventoryAmountCents',
        'onHandQty',
        'availableQty',
        'bottleCode',
        '987654321',
        '876543210',
        '765432109',
        'inventory-bottle-secret',
      ]) {
        assert.equal(detailText.includes(forbidden), false);
      }

      const history = await requestJson(
        baseUrl,
        '/api/operation-logs?archived=true&module=history_fixture',
        { token: admin.token },
      );
      assert.equal(history.response.status, 200);
      assert.equal(history.body.data.total, 1);
      assert.equal(history.body.data.logs[0].archived, true);

      const options = await requestJson(
        baseUrl,
        '/api/operation-logs/filter-options',
        { token: admin.token },
      );
      assert.equal(options.response.status, 200);
      assert.equal(
        options.body.data.users.some(
          (user) => user.username === 'historical-only-user',
        ),
        true,
      );
      assert.equal(options.body.data.modules.includes('history_fixture'), true);
    },
    {
      prisma: auditFixture(),
    },
  );
});

test('operation log validation rejects illegal and unbounded filters', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl, 'audit-admin', 'Password123');
      for (const [query, expectedCode] of [
        ['operationType=INVALID', 'OPERATION_LOG_FILTER_INVALID'],
        ['result=MAYBE', 'OPERATION_LOG_FILTER_INVALID'],
        ['startTime=not-a-date', 'OPERATION_LOG_FILTER_INVALID'],
        ['startTime=2026-02-31', 'OPERATION_LOG_FILTER_INVALID'],
        ['archived=perhaps', 'OPERATION_LOG_FILTER_INVALID'],
        ['ipAddress=not-an-ip', 'OPERATION_LOG_FILTER_INVALID'],
        ['keyword=fixture', 'OPERATION_LOG_KEYWORD_SCOPE_REQUIRED'],
      ]) {
        const response = await requestJson(
          baseUrl,
          `/api/operation-logs?${query}`,
          { token: admin.token },
        );
        assert.equal(response.response.status, 400);
        assert.equal(response.body.error.code, expectedCode);
      }

      const boundedKeyword = await requestJson(
        baseUrl,
        '/api/operation-logs?' +
          new URLSearchParams({
            keyword: 'audit',
            startTime: '2026-07-01T00:00:00.000Z',
            endTime: '2026-07-31T23:59:59.999Z',
          }),
        { token: admin.token },
      );
      assert.equal(boundedKeyword.response.status, 200);
    },
    { prisma: auditFixture() },
  );
});

test('global request auditing records read and failure requests without persisting request secrets', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const sales = await login(baseUrl, 'audit-sales', 'Password123');
      const admin = await login(baseUrl, 'audit-admin', 'Password123');
      const boss = await login(baseUrl, 'audit-boss', 'Password123');

      const refreshed = await requestJson(baseUrl, '/api/auth/refresh', {
        method: 'POST',
        body: { refreshToken: sales.refreshToken },
      });
      assert.equal(refreshed.response.status, 200);
      const passwordChanged = await requestJson(
        baseUrl,
        '/api/auth/change-password',
        {
          method: 'POST',
          token: boss.token,
          body: {
            currentPassword: 'Password123',
            newPassword: 'ChangedPassword123',
          },
        },
      );
      assert.equal(passwordChanged.response.status, 200);

      const list = await requestJson(baseUrl, '/api/customers', {
        token: refreshed.body.data.token,
      });
      assert.equal(list.response.status, 200);
      const missing = await requestJson(
        baseUrl,
        '/api/customers/missing-customer',
        { token: refreshed.body.data.token },
      );
      assert.equal(missing.response.status, 404);
      const loggedOut = await requestJson(baseUrl, '/api/auth/logout', {
        method: 'POST',
        body: { refreshToken: refreshed.body.data.refreshToken },
      });
      assert.equal(loggedOut.response.status, 200);
      const failedLogin = await requestJson(baseUrl, '/api/auth/login', {
        method: 'POST',
        body: {
          username: 'audit-sales',
          password: 'NeverPersistThisPassword!',
        },
      });
      assert.equal(failedLogin.response.status, 401);

      const reads = await requestJson(
        baseUrl,
        '/api/operation-logs?module=customers&pageSize=100',
        { token: admin.token },
      );
      const success = reads.body.data.logs.find(
        (log) =>
          log.action === 'customers.list' && log.result === 'SUCCESS',
      );
      const failure = reads.body.data.logs.find(
        (log) =>
          log.action === 'customers.read' && log.result === 'FAILURE',
      );
      assert.ok(success);
      assert.ok(failure);
      assert.equal(failure.statusCode, 404);
      assert.equal(typeof failure.requestId, 'string');
      assert.equal(failure.requestPath, '/api/customers/:id');

      const loginFailures = await requestJson(
        baseUrl,
        '/api/operation-logs?action=auth.login_failed',
        { token: admin.token },
      );
      assert.equal(loginFailures.body.data.total, 1);
      const serialized = JSON.stringify(loginFailures.body.data.logs[0]);
      assert.equal(serialized.includes('NeverPersistThisPassword!'), false);
      assert.equal(serialized.includes('password'), false);

      const authLogs = await requestJson(
        baseUrl,
        '/api/operation-logs?module=auth&pageSize=100',
        { token: admin.token },
      );
      for (const action of [
        'auth.login',
        'auth.login_failed',
        'auth.refresh',
        'auth.logout',
        'auth.change_password',
      ]) {
        assert.equal(
          authLogs.body.data.logs.some((log) => log.action === action),
          true,
          `${action} should be audited`,
        );
      }
      const authSerialized = JSON.stringify(authLogs.body.data.logs);
      assert.equal(authSerialized.includes(sales.refreshToken), false);
      assert.equal(
        authSerialized.includes(refreshed.body.data.refreshToken),
        false,
      );
      assert.equal(authSerialized.includes('ChangedPassword123'), false);
    },
    { prisma: auditFixture() },
  );
});

test('operation log Excel export uses filters, enforces its row limit, and sanitizes legacy data', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl, 'audit-admin', 'Password123');
      const response = await fetch(
        `${baseUrl}/api/operation-logs/export.xlsx?module=single_export`,
        {
          headers: {
            Authorization: `Bearer ${admin.token}`,
          },
        },
      );
      assert.equal(response.status, 200);
      assert.match(
        response.headers.get('content-type') || '',
        /spreadsheetml/,
      );
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(bytes.subarray(0, 2).toString('utf8'), 'PK');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes);
      const worksheet = workbook.worksheets[0];
      assert.deepEqual(
        worksheet.getRow(1).values.slice(1),
        [
          '操作时间',
          '操作人',
          '所属模块',
          '操作类型',
          '操作对象',
          '操作内容',
          '结果',
          '业务明细',
        ],
      );
      const values = [];
      worksheet.eachRow((row) => {
        values.push(row.values);
      });
      const serialized = JSON.stringify(values);
      for (const technicalHeading of [
        'HTTP 方法',
        '请求路径',
        '请求编号',
        '状态码',
        '错误码',
        '耗时（毫秒）',
        '修改前',
        '修改后',
        '请求摘要',
      ]) {
        assert.equal(serialized.includes(technicalHeading), false);
      }
      assert.equal(serialized.includes('single_export'), false);
      assert.equal(serialized.includes('UPDATE'), false);
      assert.equal(serialized.includes('SUCCESS'), false);
      assert.equal(serialized.includes('LegacyPlaintextPassword!'), false);
      assert.equal(serialized.includes('13800138000'), false);
      for (const forbidden of [
        'purchaseUnitCostCents',
        'inventoryAmountCents',
        'coverageStatus',
        'onHandQty',
        'availableQty',
        'bottleCode',
        '987654321',
        '876543210',
        'full-cost-coverage',
        '765432109',
        'inventory-bottle-secret',
      ]) {
        assert.equal(serialized.includes(forbidden), false);
      }
      assert.equal(
        serialized.includes('138****8000') ||
          serialized.includes('[MASKED_PHONE]'),
        true,
      );

      const tooLarge = await requestJson(
        baseUrl,
        '/api/operation-logs/export.xlsx?module=audit_fixture',
        { token: admin.token },
      );
      assert.equal(tooLarge.response.status, 400);
      assert.equal(
        tooLarge.body.error.code,
        'OPERATION_LOG_EXPORT_LIMIT_EXCEEDED',
      );

      const exportLogs = await requestJson(
        baseUrl,
        '/api/operation-logs?action=operation_logs.export',
        { token: admin.token },
      );
      assert.equal(exportLogs.body.data.total, 2);
      assert.equal(
        exportLogs.body.data.logs.every(
          (log) => log.operationType === 'EXPORT',
        ),
        true,
      );
      assert.deepEqual(
        new Set(exportLogs.body.data.logs.map((log) => log.result)),
        new Set(['SUCCESS', 'FAILURE']),
      );
    },
    {
      env: {
        OPERATION_LOG_EXPORT_MAX_ROWS: '1',
      },
      prisma: auditFixture(),
    },
  );
});

function auditFixture() {
  return {
    users: [
      user('usr-audit-admin', 'audit-admin', 'admin', true),
      user('usr-audit-boss', 'audit-boss', 'boss', true),
      user('usr-audit-finance', 'audit-finance', 'finance', true),
      user('usr-audit-warehouse', 'audit-warehouse', 'warehouse', true),
      user('usr-audit-sales', 'audit-sales', 'sales', true),
      user('usr-audit-after-sales', 'audit-after-sales', 'after_sales', true),
      user('usr-audit-taster', 'audit-taster', 'taster', true),
      user('usr-audit-front-desk', 'audit-front-desk', 'front_desk', true),
      user('usr-audit-disabled', 'audit-disabled', 'sales', false),
    ],
    operationLogs: [
      log('audit-log-1', '2026-07-20T01:00:00.000Z', {
        action: 'audit_fixture.create',
        operationType: 'CREATE',
        result: 'SUCCESS',
        entityId: 'customer-audit-1',
        ipAddress: '10.0.0.1',
      }),
      log('audit-log-2', '2026-07-21T01:00:00.000Z', {
        action: 'audit_fixture.update',
        operationType: 'UPDATE',
        result: 'FAILURE',
        entityId: 'customer-audit-2',
        ipAddress: '10.0.0.2',
        beforeData: { status: 'old' },
        afterData: {
          status: 'new',
          purchaseUnitCostCents: 987654321,
          inventoryAmountCents: 876543210,
          onHandQty: 765432109,
          availableQty: 765432108,
          bottleCode: 'inventory-bottle-secret',
        },
        errorCode: 'TEST_FAILURE',
      }),
      log('audit-log-3', '2026-07-22T01:00:00.000Z', {
        action: 'audit_fixture.read',
        operationType: 'READ',
        result: 'SUCCESS',
        entityId: 'customer-audit-3',
        ipAddress: '10.0.0.3',
      }),
      {
        ...log('single-export-log', '2026-07-23T01:00:00.000Z', {
          action: 'single_export.update',
          operationType: 'UPDATE',
          result: 'SUCCESS',
          entityId: 'customer-export-1',
          ipAddress: '10.0.0.4',
        }),
        module: 'single_export',
        beforeData: {
          password: 'LegacyPlaintextPassword!',
          phone: '13800138000',
          purchaseUnitCostCents: 987654321,
          inventoryAmountCents: 876543210,
          coverageStatus: 'full-cost-coverage',
          onHandQty: 765432109,
          availableQty: 765432108,
          bottleCode: 'inventory-bottle-secret',
        },
      },
    ],
    operationLogArchives: [
      {
        ...log('history-log-1', '2025-01-01T00:00:00.000Z', {
          action: 'history_fixture.read',
          operationType: 'READ',
          result: 'SUCCESS',
          entityId: 'history-entity',
          ipAddress: '10.0.0.5',
        }),
        module: 'history_fixture',
        userId: null,
        actorNameSnapshot: '历史用户',
        actorUsernameSnapshot: 'historical-only-user',
        actorRoleSnapshot: 'sales',
      },
    ],
  };
}

function user(id, username, role, isActive) {
  return {
    id,
    name: username,
    username,
    password: 'Password123',
    role,
    isActive,
  };
}

function log(id, createdAt, patch) {
  return {
    id,
    userId: 'usr-audit-sales',
    actorNameSnapshot: 'Audit Sales',
    actorUsernameSnapshot: 'audit-sales',
    actorRoleSnapshot: 'sales',
    module: 'audit_fixture',
    action: patch.action,
    operationType: patch.operationType,
    entityType: 'customer',
    entityId: patch.entityId,
    result: patch.result,
    beforeData: patch.beforeData || null,
    afterData: patch.afterData || null,
    ipAddress: patch.ipAddress,
    errorCode: patch.errorCode || null,
    createdAt,
  };
}
