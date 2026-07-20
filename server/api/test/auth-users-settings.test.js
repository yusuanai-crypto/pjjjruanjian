const assert = require('node:assert/strict');
const test = require('node:test');

const {
  UsersNestService,
} = require('../src/modules/users/users.nest.service');
const {
  canAssignRole,
  canManageTargetRole,
  isOrdinaryEmployeeRole,
  isSuperAdminRole,
} = require('../src/modules/users/user-role.mapper');
const {
  BOOTSTRAP_ADMIN_PASSWORD,
  assertCurrentUserContract,
  assertErrorContract,
  assertOperationLogContract,
  assertPublicUserContract,
  assertSessionContract,
  assertSettingsContract,
  createUser,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

const EXPECTED_ROLE_PERMISSIONS = {
  super_admin: [
    'auth:me',
    'auth:change_password',
    'roles:read',
    'users:list',
    'users:read',
    'users:create',
    'users:update',
    'users:disable',
    'users:enable',
    'users:reset_password',
    'settings:global_mark:read',
    'settings:global_mark:enable',
    'settings:global_mark:restore',
    'operation_logs:list',
    'travel_groups:list',
    'travel_groups:read',
    'travel_groups:create',
    'travel_groups:update',
    'guide_carried_groups:list',
    'guide_carried_groups:read',
    'guide_carried_groups:create',
    'guide_carried_groups:update',
    'pending_travel_groups:list',
    'pending_travel_groups:read',
    'pending_travel_groups:create',
    'pending_travel_groups:update',
    'travel_groups:finance_mark',
    'guide_carried_groups:finance_mark',
    'pending_travel_groups:finance_mark',
    'customers:list',
    'customers:read',
    'customers:create',
    'customers:update',
    'customers:finance_mark',
    'sales_orders:list',
    'sales_orders:read',
    'sales_orders:create',
    'sales_orders:finance_mark',
    'finance:overview',
    'reconciliations:read',
    'reconciliations:review',
    'strike_bonus_awards:list',
    'strike_bonus_awards:create',
  ],
  admin: [
    'auth:me',
    'auth:change_password',
    'roles:read',
    'users:list',
    'users:read',
    'users:create',
    'users:update',
    'users:disable',
    'users:enable',
    'users:reset_password',
    'settings:global_mark:read',
    'settings:global_mark:enable',
    'settings:global_mark:restore',
    'operation_logs:list',
    'travel_groups:list',
    'travel_groups:read',
    'travel_groups:create',
    'travel_groups:update',
    'guide_carried_groups:list',
    'guide_carried_groups:read',
    'guide_carried_groups:create',
    'guide_carried_groups:update',
    'pending_travel_groups:list',
    'pending_travel_groups:read',
    'pending_travel_groups:create',
    'pending_travel_groups:update',
    'travel_groups:finance_mark',
    'guide_carried_groups:finance_mark',
    'pending_travel_groups:finance_mark',
    'customers:list',
    'customers:read',
    'customers:create',
    'customers:update',
    'customers:finance_mark',
    'sales_orders:list',
    'sales_orders:read',
    'sales_orders:create',
    'sales_orders:finance_mark',
    'finance:overview',
    'reconciliations:read',
    'reconciliations:review',
    'strike_bonus_awards:list',
    'strike_bonus_awards:create',
  ],
  boss: [
    'auth:me',
    'auth:change_password',
    'roles:read',
    'settings:global_mark:read',
    'settings:global_mark:enable',
    'travel_groups:list',
    'travel_groups:read',
    'travel_groups:create',
    'travel_groups:update',
    'guide_carried_groups:list',
    'guide_carried_groups:read',
    'guide_carried_groups:create',
    'guide_carried_groups:update',
    'pending_travel_groups:list',
    'pending_travel_groups:read',
    'pending_travel_groups:create',
    'pending_travel_groups:update',
    'customers:list',
    'customers:read',
    'sales_orders:list',
    'sales_orders:read',
    'sales_orders:create',
  ],
  front_desk: [
    'auth:me',
    'auth:change_password',
    'roles:read',
    'settings:global_mark:read',
    'settings:global_mark:enable',
    'travel_groups:list',
    'travel_groups:read',
    'travel_groups:create',
    'travel_groups:update',
    'guide_carried_groups:list',
    'guide_carried_groups:read',
    'guide_carried_groups:create',
    'guide_carried_groups:update',
    'pending_travel_groups:list',
    'pending_travel_groups:read',
    'pending_travel_groups:create',
    'pending_travel_groups:update',
    'sales_orders:list',
    'sales_orders:read',
  ],
  sales: [
    'auth:me',
    'auth:change_password',
    'roles:read',
    'settings:global_mark:read',
    'travel_groups:list',
    'travel_groups:read',
    'travel_groups:create',
    'travel_groups:update',
    'guide_carried_groups:list',
    'guide_carried_groups:read',
    'guide_carried_groups:create',
    'guide_carried_groups:update',
    'pending_travel_groups:list',
    'pending_travel_groups:read',
    'pending_travel_groups:create',
    'pending_travel_groups:update',
    'customers:list',
    'customers:read',
    'customers:create',
    'customers:update',
    'sales_orders:list',
    'sales_orders:read',
    'sales_orders:create',
  ],
  finance: [
    'auth:me',
    'auth:change_password',
    'roles:read',
    'settings:global_mark:read',
    'travel_groups:list',
    'travel_groups:read',
    'travel_groups:create',
    'travel_groups:update',
    'guide_carried_groups:list',
    'guide_carried_groups:read',
    'guide_carried_groups:create',
    'guide_carried_groups:update',
    'pending_travel_groups:list',
    'pending_travel_groups:read',
    'pending_travel_groups:create',
    'pending_travel_groups:update',
    'travel_groups:finance_mark',
    'guide_carried_groups:finance_mark',
    'pending_travel_groups:finance_mark',
    'customers:list',
    'customers:read',
    'customers:update',
    'customers:finance_mark',
    'sales_orders:list',
    'sales_orders:read',
    'sales_orders:create',
    'sales_orders:finance_mark',
    'finance:overview',
    'reconciliations:read',
    'reconciliations:upsert',
    'strike_bonus_awards:list',
    'strike_bonus_awards:create',
  ],
  warehouse: [
    'auth:me',
    'auth:change_password',
    'roles:read',
    'settings:global_mark:read',
    'travel_groups:list',
    'travel_groups:read',
    'sales_orders:list',
    'sales_orders:read',
  ],
  after_sales: [
    'auth:me',
    'auth:change_password',
    'roles:read',
    'settings:global_mark:read',
    'settings:global_mark:enable',
    'travel_groups:list',
    'travel_groups:read',
    'customers:list',
    'customers:read',
    'customers:create',
    'customers:update',
    'sales_orders:list',
    'sales_orders:read',
    'sales_orders:create',
  ],
  taster: [
    'auth:me',
    'auth:change_password',
    'roles:read',
    'settings:global_mark:read',
    'travel_groups:list',
    'travel_groups:read',
    'guide_carried_groups:list',
    'guide_carried_groups:read',
    'pending_travel_groups:list',
    'pending_travel_groups:read',
    'sales_orders:list',
    'sales_orders:read',
  ],
};

function rolePermissionsSnapshot(roles) {
  return Object.fromEntries(roles.map((role) => [role.role, role.permissions]));
}

test('contract: POST /api/auth/login returns session shape and stable login errors', async () => {
  await withPhase1Server(async (baseUrl) => {
    const loginResult = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: {
        username: 'admin',
        password: BOOTSTRAP_ADMIN_PASSWORD,
      },
    });
    assert.equal(loginResult.response.status, 200);
    assert.deepEqual(Object.keys(loginResult.body).sort(), ['data']);
    assertSessionContract(loginResult.body.data);
    assert.equal(loginResult.body.data.user.username, 'admin');
    assert.equal(loginResult.body.data.user.role, 'super_admin');
    assert.equal(loginResult.body.data.permissions.includes('users:create'), true);
    assert.equal(loginResult.body.data.menus.some((menu) => menu.id === 'employee_accounts'), true);
    assert.equal(loginResult.body.data.menus.some((menu) => menu.id === 'pending_travel_groups'), false);
    assert.equal(
      loginResult.body.data.menus.find((menu) => menu.id === 'travel_groups')?.title,
      '旅行团录入',
    );
    assert.equal(
      loginResult.body.data.menus.find((menu) => menu.id === 'travel_group_query')?.title,
      '旅行团管理',
    );
    assert.equal(loginResult.body.data.menus.some((menu) => menu.id === 'commission_rules'), true);
    assert.equal(loginResult.body.data.menus.some((menu) => menu.id === 'travel_agency_management'), true);
    assert.equal(loginResult.body.data.menus.some((menu) => menu.id === 'product_management'), true);
    assert.deepEqual(loginResult.body.data.dataScope, { default: 'all' });

    const missingFields = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: {
        username: 'admin',
      },
    });
    assertErrorContract(missingFields, 400, 'LOGIN_FIELDS_REQUIRED');

    const invalidPassword = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: {
        username: 'admin',
        password: 'wrong-password',
      },
    });
    assertErrorContract(invalidPassword, 401, 'INVALID_CREDENTIALS');
  });
});

test('contract: protected auth endpoints require bearer token and return current user or role catalog', async () => {
  await withPhase1Server(async (baseUrl) => {
    const missingToken = await requestJson(baseUrl, '/api/auth/me');
    assertErrorContract(missingToken, 401, 'AUTH_TOKEN_REQUIRED');

    const invalidToken = await requestJson(baseUrl, '/api/auth/me', {
      token: 'not-a-valid-token',
    });
    assertErrorContract(invalidToken, 401, 'INVALID_AUTH_TOKEN');

    const admin = await login(baseUrl);
    const me = await requestJson(baseUrl, '/api/auth/me', {
      token: admin.token,
    });
    assert.equal(me.response.status, 200);
    assert.deepEqual(Object.keys(me.body).sort(), ['data']);
    assertCurrentUserContract(me.body.data);
    assert.equal('token' in me.body.data, false);
    assert.equal(me.body.data.user.username, 'admin');

    const roles = await requestJson(baseUrl, '/api/auth/roles', {
      token: admin.token,
    });
    assert.equal(roles.response.status, 200);
    assert.deepEqual(Object.keys(roles.body).sort(), ['data']);
    assert.deepEqual(Object.keys(roles.body.data).sort(), ['roles']);
    assert.equal(roles.body.data.roles.length, 9);
    assert.deepEqual(rolePermissionsSnapshot(roles.body.data.roles), EXPECTED_ROLE_PERMISSIONS);
    const roleMenus = Object.fromEntries(
      roles.body.data.roles.map((role) => [
        role.role,
        role.menus.map((menu) => menu.id),
      ]),
    );
    assert.equal(roleMenus.admin.includes('order_query'), true);
    assert.equal(roleMenus.admin.includes('finance_workspace'), true);
    assert.equal(roleMenus.admin.includes('commission_rules'), true);
    assert.equal(roleMenus.admin.includes('travel_agency_management'), true);
    assert.equal(roleMenus.admin.includes('product_management'), true);
    assert.equal(roleMenus.after_sales.includes('after_sales_orders'), true);
    assert.equal(roleMenus.after_sales.includes('travel_group_query'), true);
    assert.equal(roleMenus.after_sales.includes('analytics'), true);
    assert.equal(roleMenus.after_sales.includes('order_query'), true);
    assert.equal(roleMenus.finance.includes('order_query'), true);
    assert.equal(roleMenus.finance.includes('after_sales_orders'), true);
    assert.equal(roleMenus.finance.includes('finance_workspace'), true);
    assert.equal(roleMenus.finance.includes('commissions'), true);
    assert.equal(roleMenus.finance.includes('commission_rules'), true);
    assert.equal(roleMenus.finance.includes('travel_agency_management'), true);
    assert.equal(roleMenus.finance.includes('product_management'), true);
    assert.equal(roleMenus.finance.includes('ai_assistant'), true);
    assert.equal(roleMenus.warehouse.includes('warehouse_workspace'), true);
    assert.equal(roleMenus.warehouse.includes('travel_group_query'), true);
    assert.equal(roleMenus.warehouse.includes('after_sales_orders'), true);
    assert.equal(roleMenus.boss.includes('after_sales_orders'), false);
    assert.equal(roleMenus.boss.includes('finance_workspace'), false);
    assert.equal(roleMenus.boss.includes('reconciliation_table'), false);
    assert.equal(roleMenus.boss.includes('warehouse_workspace'), false);
    assert.equal(roleMenus.after_sales.includes('ai_assistant'), true);
    assert.equal(roleMenus.boss.includes('commission_rules'), false);
    assert.equal(roleMenus.boss.includes('travel_agency_management'), false);
    assert.equal(roleMenus.boss.includes('product_management'), false);
    assert.equal(roleMenus.sales.includes('after_sales_orders'), false);
    for (const role of Object.keys(roleMenus)) {
      assert.equal(roleMenus[role].includes('pending_travel_groups'), false);
    }
    for (const role of ['sales', 'warehouse', 'after_sales', 'front_desk', 'taster']) {
      assert.equal(roleMenus[role].includes('commission_rules'), false);
      assert.equal(roleMenus[role].includes('travel_agency_management'), false);
      assert.equal(roleMenus[role].includes('product_management'), false);
    }
    for (const role of ['sales', 'warehouse', 'front_desk', 'taster']) {
      assert.equal(roleMenus[role].includes('ai_assistant'), false);
    }
    for (const role of ['sales', 'front_desk', 'taster']) {
      assert.equal(roleMenus[role].includes('after_sales_orders'), false);
      assert.equal(roleMenus[role].includes('finance_workspace'), false);
      assert.equal(roleMenus[role].includes('warehouse_workspace'), false);
    }

    const tasterRole = roles.body.data.roles.find((role) => role.role === 'taster');
    assert.equal(tasterRole.title, '品鉴师');
    assert.equal(
      tasterRole.description,
      '查看全部旅行团，按本人接团或对接关系维护信息，并查看自己的接待和提成。',
    );
    assert.equal(Array.isArray(tasterRole.permissions), true);
    assert.deepEqual(
      tasterRole.menus.map((menu) => menu.id),
      ['dashboard', 'travel_group_query', 'order_query', 'own_taster_receptions', 'own_commissions'],
    );
    assert.deepEqual(tasterRole.dataScope, {
      travelGroups: 'all',
      travelGroupUpdates: 'assigned_taster_or_liaison',
      orders: 'own_taster_travel_groups',
      receptions: 'own_user_id',
      commissions: 'own_user_id',
    });

    const salesRole = roles.body.data.roles.find((role) => role.role === 'sales');
    assert.deepEqual(salesRole.dataScope, {
      customers: 'own_sales_user_id',
      orders: 'own_sales_user_id',
      travelGroups: 'all_travel_groups_read',
    });
  });
});

test('contract: POST /api/auth/change-password returns current session shape and stable errors', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);

    const wrongCurrentPassword = await requestJson(baseUrl, '/api/auth/change-password', {
      method: 'POST',
      token: admin.token,
      body: {
        currentPassword: 'wrong-password',
        newPassword: 'NewPassword123',
      },
    });
    assertErrorContract(wrongCurrentPassword, 400, 'CURRENT_PASSWORD_INCORRECT');

    const weakPassword = await requestJson(baseUrl, '/api/auth/change-password', {
      method: 'POST',
      token: admin.token,
      body: {
        currentPassword: BOOTSTRAP_ADMIN_PASSWORD,
        newPassword: 'short',
      },
    });
    assertErrorContract(weakPassword, 400, 'WEAK_PASSWORD');

    const changed = await requestJson(baseUrl, '/api/auth/change-password', {
      method: 'POST',
      token: admin.token,
      body: {
        currentPassword: BOOTSTRAP_ADMIN_PASSWORD,
        newPassword: 'NewPassword123',
      },
    });
    assert.equal(changed.response.status, 200);
    assert.deepEqual(Object.keys(changed.body).sort(), ['data']);
    assertSessionContract(changed.body.data);
    assert.equal(changed.body.data.user.username, 'admin');
    assert.equal(changed.body.data.permissions.includes('users:create'), true);

    const revokedSession = await requestJson(baseUrl, '/api/auth/me', {
      token: admin.token,
    });
    assertErrorContract(revokedSession, 401, 'SESSION_REVOKED');

    const replacementSession = await requestJson(baseUrl, '/api/auth/me', {
      token: changed.body.data.token,
    });
    assert.equal(replacementSession.response.status, 200);

    const oldPasswordLogin = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: {
        username: 'admin',
        password: BOOTSTRAP_ADMIN_PASSWORD,
      },
    });
    assertErrorContract(oldPasswordLogin, 401, 'INVALID_CREDENTIALS');

    const newPasswordSession = await login(baseUrl, 'admin', 'NewPassword123');
    assert.equal(newPasswordSession.user.username, 'admin');
  });
});

test('contract: admin user management paths preserve request and response structures', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);

    const createdUser = await createUser(baseUrl, admin.token, {
      name: '测试销售',
      username: '13800000000',
      password: 'Password123',
      role: 'sales',
      phone: '13800000000',
      leaderId: null,
      isActive: true,
    });
    assert.equal(createdUser.username, '13800000000');
    assert.equal(createdUser.role, 'sales');
    assert.equal(createdUser.isActive, true);

    const duplicateUsername = await requestJson(baseUrl, '/api/users', {
      method: 'POST',
      token: admin.token,
      body: {
        name: '重复账号',
        username: '13800000000',
        password: 'Password123',
        role: 'sales',
      },
    });
    assertErrorContract(duplicateUsername, 409, 'USERNAME_EXISTS');

    const invalidRole = await requestJson(baseUrl, '/api/users', {
      method: 'POST',
      token: admin.token,
      body: {
        name: '错误角色',
        username: 'badrole01',
        password: 'Password123',
        role: 'unknown_role',
      },
    });
    assertErrorContract(invalidRole, 400, 'INVALID_ROLE');

    const list = await requestJson(baseUrl, '/api/users', {
      token: admin.token,
    });
    assert.equal(list.response.status, 200);
    assert.deepEqual(Object.keys(list.body).sort(), ['data']);
    assert.deepEqual(Object.keys(list.body.data).sort(), ['users']);
    assert.equal(
      list.body.data.users.some((user) => user.username === '13800000000'),
      true,
    );
    for (const user of list.body.data.users) {
      assertPublicUserContract(user);
    }

    const detail = await requestJson(baseUrl, `/api/users/${createdUser.id}`, {
      token: admin.token,
    });
    assert.equal(detail.response.status, 200);
    assertPublicUserContract(detail.body.data.user);
    assert.equal(detail.body.data.user.id, createdUser.id);

    const updated = await requestJson(baseUrl, `/api/users/${createdUser.id}`, {
      method: 'PATCH',
      token: admin.token,
      body: {
        name: '测试财务',
        role: 'finance',
        phone: '13900000000',
        leaderId: null,
      },
    });
    assert.equal(updated.response.status, 200);
    assertPublicUserContract(updated.body.data.user);
    assert.equal(updated.body.data.user.name, '测试财务');
    assert.equal(updated.body.data.user.role, 'finance');

    const disabled = await requestJson(baseUrl, `/api/users/${createdUser.id}/disable`, {
      method: 'POST',
      token: admin.token,
      body: {
        reason: 'Temporary test freeze',
      },
    });
    assert.equal(disabled.response.status, 200);
    assert.equal(disabled.body.data.user.isActive, false);

    const disabledLogin = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: {
        username: '13800000000',
        password: 'Password123',
      },
    });
    assertErrorContract(disabledLogin, 403, 'ACCOUNT_DISABLED');

    const enabled = await requestJson(baseUrl, `/api/users/${createdUser.id}/enable`, {
      method: 'POST',
      token: admin.token,
      body: {
        reason: 'Temporary test restore',
      },
    });
    assert.equal(enabled.response.status, 200);
    assert.equal(enabled.body.data.user.isActive, true);

    const resetCode = await requestJson(
      baseUrl,
      `/api/users/${createdUser.id}/reset-password-code`,
      {
        method: 'POST',
        token: admin.token,
      },
    );
    assert.equal(resetCode.response.status, 200);
    const verificationCode = resetCode.body.data.verification.debugCode;
    assert.match(verificationCode, /^\d{6}$/);

    const reset = await requestJson(
      baseUrl,
      `/api/users/${createdUser.id}/reset-password`,
      {
        method: 'POST',
        token: admin.token,
        body: {
          verificationCode,
          newPassword: 'ResetPassword123',
          reason: 'Reset test password',
        },
      },
    );
    assert.equal(reset.response.status, 200);
    assert.equal(reset.body.data.user.username, '13800000000');

    const resetLogin = await login(
      baseUrl,
      '13800000000',
      'ResetPassword123',
    );
    assert.equal(resetLogin.user.role, 'finance');
  },
  {
    env: {
      ALIYUN_SMS_MOCK: 'true',
      SMS_VERIFICATION_DEBUG: 'true',
    },
  });
});

test('contract: non-admin users cannot manage users and taster data scopes expose all travel groups', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    await createUser(baseUrl, admin.token, {
      name: '测试品鉴师',
      username: 'taster01',
      password: 'Password123',
      role: 'taster',
    });
    await createUser(baseUrl, admin.token, {
      name: 'User Management Boss',
      username: 'user-management-boss',
      password: 'Password123',
      role: 'boss',
    });
    await createUser(baseUrl, admin.token, {
      name: 'User Management Front Desk',
      username: 'user-management-front-desk',
      password: 'Password123',
      role: 'front_desk',
    });
    await createUser(baseUrl, admin.token, {
      name: 'User Management Sales',
      username: 'user-management-sales',
      password: 'Password123',
      role: 'sales',
    });
    await createUser(baseUrl, admin.token, {
      name: 'User Management Finance',
      username: 'user-management-finance',
      password: 'Password123',
      role: 'finance',
    });
    await createUser(baseUrl, admin.token, {
      name: 'User Management Warehouse',
      username: 'user-management-warehouse',
      password: 'Password123',
      role: 'warehouse',
    });
    await createUser(baseUrl, admin.token, {
      name: 'User Management After Sales',
      username: 'user-management-after-sales',
      password: 'Password123',
      role: 'after_sales',
    });

    const taster = await login(baseUrl, 'taster01', 'Password123');
    const boss = await login(baseUrl, 'user-management-boss', 'Password123');
    const frontDesk = await login(
      baseUrl,
      'user-management-front-desk',
      'Password123',
    );
    const sales = await login(
      baseUrl,
      'user-management-sales',
      'Password123',
    );
    const finance = await login(
      baseUrl,
      'user-management-finance',
      'Password123',
    );
    const warehouse = await login(
      baseUrl,
      'user-management-warehouse',
      'Password123',
    );
    const afterSales = await login(
      baseUrl,
      'user-management-after-sales',
      'Password123',
    );
    assert.deepEqual(
      taster.menus.map((menu) => menu.id),
      ['dashboard', 'travel_group_query', 'order_query', 'own_taster_receptions', 'own_commissions'],
    );
    assert.equal(taster.menus.some((menu) => menu.id === 'employee_accounts'), false);
    assert.deepEqual(taster.dataScope, {
      travelGroups: 'all',
      travelGroupUpdates: 'assigned_taster_or_liaison',
      orders: 'own_taster_travel_groups',
      receptions: 'own_user_id',
      commissions: 'own_user_id',
    });

    const listUsers = await requestJson(baseUrl, '/api/users', {
      token: taster.token,
    });
    assertErrorContract(listUsers, 403, 'ADMIN_REQUIRED');

    const createUserAttempt = await requestJson(baseUrl, '/api/users', {
      method: 'POST',
      token: taster.token,
      body: {
        name: '无权限创建',
        username: 'blocked01',
        password: 'Password123',
        role: 'sales',
      },
    });
    assertErrorContract(createUserAttempt, 403, 'ADMIN_REQUIRED');

    const nonAdminSessions = [
      { role: 'taster', session: taster },
      { role: 'boss', session: boss },
      { role: 'front_desk', session: frontDesk },
      { role: 'sales', session: sales },
      { role: 'finance', session: finance },
      { role: 'warehouse', session: warehouse },
      { role: 'after_sales', session: afterSales },
    ];

    for (const { role, session } of nonAdminSessions) {
      const assignableUsers = await requestJson(
        baseUrl,
        '/api/users/assignable',
        {
          token: session.token,
        },
      );
      assertErrorContract(assignableUsers, 403, 'ADMIN_REQUIRED');

      const userDetail = await requestJson(baseUrl, `/api/users/${taster.user.id}`, {
        token: session.token,
      });
      assertErrorContract(userDetail, 403, 'ADMIN_REQUIRED');

      const listAttempt = await requestJson(baseUrl, '/api/users', {
        token: session.token,
      });
      assertErrorContract(listAttempt, 403, 'ADMIN_REQUIRED');

      const createAttempt = await requestJson(baseUrl, '/api/users', {
        method: 'POST',
        token: session.token,
        body: {
          name: `Blocked ${role} Create`,
          username: `blocked-${role}-user`,
          password: 'Password123',
          role: 'sales',
        },
      });
      assertErrorContract(createAttempt, 403, 'ADMIN_REQUIRED');

      const updateAttempt = await requestJson(
        baseUrl,
        `/api/users/${taster.user.id}`,
        {
          method: 'PATCH',
          token: session.token,
          body: {
            name: `Blocked ${role} Update`,
          },
        },
      );
      assertErrorContract(updateAttempt, 403, 'ADMIN_REQUIRED');

      const disableAttempt = await requestJson(
        baseUrl,
        `/api/users/${taster.user.id}/disable`,
        {
          method: 'POST',
          token: session.token,
        },
      );
      assertErrorContract(disableAttempt, 403, 'ADMIN_REQUIRED');

      const enableAttempt = await requestJson(
        baseUrl,
        `/api/users/${taster.user.id}/enable`,
        {
          method: 'POST',
          token: session.token,
        },
      );
      assertErrorContract(enableAttempt, 403, 'ADMIN_REQUIRED');
    }
  });
});

test('contract: taster picker only returns active tasters to allowed roles', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const activeTaster = await createUser(baseUrl, admin.token, {
      name: '启用品鉴师',
      username: 'active-taster',
      password: 'Password123',
      role: 'taster',
    });
    await createUser(baseUrl, admin.token, {
      name: '停用品鉴师',
      username: 'disabled-taster',
      password: 'Password123',
      role: 'taster',
      isActive: false,
    });
    await createUser(baseUrl, admin.token, {
      name: '前台选择品鉴师',
      username: 'picker-front-desk',
      password: 'Password123',
      role: 'front_desk',
    });
    await createUser(baseUrl, admin.token, {
      name: '销售选择品鉴师',
      username: 'picker-sales',
      password: 'Password123',
      role: 'sales',
    });
    await createUser(baseUrl, admin.token, {
      name: '财务选择品鉴师',
      username: 'picker-finance',
      password: 'Password123',
      role: 'finance',
    });
    await createUser(baseUrl, admin.token, {
      name: 'Picker Boss',
      username: 'picker-boss',
      password: 'Password123',
      role: 'boss',
    });
    await createUser(baseUrl, admin.token, {
      name: '库管不可选',
      username: 'picker-warehouse',
      password: 'Password123',
      role: 'warehouse',
    });
    await createUser(baseUrl, admin.token, {
      name: '售后不可选',
      username: 'picker-after-sales',
      password: 'Password123',
      role: 'after_sales',
    });

    const allowedSessions = [
      admin,
      await login(baseUrl, 'picker-boss', 'Password123'),
      await login(baseUrl, 'picker-front-desk', 'Password123'),
      await login(baseUrl, 'picker-sales', 'Password123'),
      await login(baseUrl, 'picker-finance', 'Password123'),
      await login(baseUrl, 'active-taster', 'Password123'),
      await login(baseUrl, 'picker-warehouse', 'Password123'),
      await login(baseUrl, 'picker-after-sales', 'Password123'),
    ];

    for (const session of allowedSessions) {
      const result = await requestJson(baseUrl, '/api/users/tasters', {
        token: session.token,
      });
      assert.equal(result.response.status, 200);
      assert.deepEqual(Object.keys(result.body).sort(), ['data']);
      assert.deepEqual(Object.keys(result.body.data).sort(), ['tasters']);
      assert.deepEqual(result.body.data.tasters, [
        {
          id: activeTaster.id,
          name: '启用品鉴师',
          username: 'active-taster',
        },
      ]);
      assert.deepEqual(Object.keys(result.body.data.tasters[0]).sort(), ['id', 'name', 'username']);
    }

  });
});

test('contract: global mark query switch paths preserve permission and response contracts', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    await createUser(baseUrl, admin.token, {
      name: '老板测试',
      username: 'boss01',
      password: 'Password123',
      role: 'boss',
    });
    await createUser(baseUrl, admin.token, {
      name: '库管测试',
      username: 'warehouse01',
      password: 'Password123',
      role: 'warehouse',
    });
    await createUser(baseUrl, admin.token, {
      name: '售后测试',
      username: 'aftersales01',
      password: 'Password123',
      role: 'after_sales',
    });

    const initial = await requestJson(baseUrl, '/api/settings/global-mark-query', {
      token: admin.token,
    });
    assert.equal(initial.response.status, 200);
    assert.deepEqual(Object.keys(initial.body).sort(), ['data']);
    assert.deepEqual(Object.keys(initial.body.data).sort(), ['settings']);
    assertSettingsContract(initial.body.data.settings);
    assert.equal(initial.body.data.settings.onlyShowMarkedRecords, false);
    assert.equal(initial.body.data.settings.restoreRequired, false);

    const warehouse = await login(baseUrl, 'warehouse01', 'Password123');
    const warehouseEnable = await requestJson(baseUrl, '/api/settings/global-mark-query/enable', {
      method: 'POST',
      token: warehouse.token,
    });
    assertErrorContract(warehouseEnable, 403, 'PERMISSION_DENIED');

    const afterSales = await login(baseUrl, 'aftersales01', 'Password123');
    assert.equal(afterSales.permissions.includes('settings:global_mark:enable'), true);
    const afterSalesEnable = await requestJson(baseUrl, '/api/settings/global-mark-query/enable', {
      method: 'POST',
      token: afterSales.token,
    });
    assert.equal(afterSalesEnable.response.status, 200);
    assertSettingsContract(afterSalesEnable.body.data.settings);
    assert.equal(afterSalesEnable.body.data.settings.onlyShowMarkedRecords, true);
    assert.equal(afterSalesEnable.body.data.settings.restoreRequired, true);
    assert.equal(afterSalesEnable.body.data.settings.openedBy, afterSales.user.id);

    const afterSalesRestore = await requestJson(baseUrl, '/api/settings/global-mark-query/restore', {
      method: 'POST',
      token: afterSales.token,
    });
    assertErrorContract(afterSalesRestore, 403, 'ADMIN_REQUIRED');

    const adminRestoreAfterSales = await requestJson(baseUrl, '/api/settings/global-mark-query/restore', {
      method: 'POST',
      token: admin.token,
    });
    assert.equal(adminRestoreAfterSales.response.status, 200);
    assert.equal(adminRestoreAfterSales.body.data.settings.onlyShowMarkedRecords, false);

    const boss = await login(baseUrl, 'boss01', 'Password123');
    const enable = await requestJson(baseUrl, '/api/settings/global-mark-query/enable', {
      method: 'POST',
      token: boss.token,
    });
    assert.equal(enable.response.status, 200);
    assertSettingsContract(enable.body.data.settings);
    assert.equal(enable.body.data.settings.onlyShowMarkedRecords, true);
    assert.equal(enable.body.data.settings.restoreRequired, true);
    assert.equal(enable.body.data.settings.openedBy, boss.user.id);

    const bossRestore = await requestJson(baseUrl, '/api/settings/global-mark-query/restore', {
      method: 'POST',
      token: boss.token,
    });
    assertErrorContract(bossRestore, 403, 'ADMIN_REQUIRED');

    const adminRestore = await requestJson(baseUrl, '/api/settings/global-mark-query/restore', {
      method: 'POST',
      token: admin.token,
    });
    assert.equal(adminRestore.response.status, 200);
    assertSettingsContract(adminRestore.body.data.settings);
    assert.equal(adminRestore.body.data.settings.onlyShowMarkedRecords, false);
    assert.equal(adminRestore.body.data.settings.restoreRequired, false);
    assert.equal(adminRestore.body.data.settings.restoredBy, admin.user.id);
  });
});

test('contract: operation log endpoint is admin-only and supports documented filters', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    await createUser(baseUrl, admin.token, {
      name: '前台测试',
      username: 'frontdesk01',
      password: 'Password123',
      role: 'front_desk',
    });

    const frontDesk = await login(baseUrl, 'frontdesk01', 'Password123');
    const nonAdminLogs = await requestJson(baseUrl, '/api/operation-logs', {
      token: frontDesk.token,
    });
    assertErrorContract(nonAdminLogs, 403, 'ADMIN_REQUIRED');

    await requestJson(baseUrl, '/api/settings/global-mark-query/enable', {
      method: 'POST',
      token: frontDesk.token,
    });
    await requestJson(baseUrl, '/api/settings/global-mark-query/restore', {
      method: 'POST',
      token: admin.token,
    });

    const allLogs = await requestJson(baseUrl, '/api/operation-logs', {
      token: admin.token,
    });
    assert.equal(allLogs.response.status, 200);
    assert.deepEqual(Object.keys(allLogs.body).sort(), ['data']);
    assert.deepEqual(Object.keys(allLogs.body.data).sort(), [
      'logs',
      'page',
      'pageSize',
      'total',
      'totalPages',
    ]);
    assert.equal(allLogs.body.data.page, 1);
    assert.equal(allLogs.body.data.pageSize, 50);
    assert.equal(allLogs.body.data.total >= 4, true);
    assert.equal(allLogs.body.data.logs.length >= 4, true);
    for (const log of allLogs.body.data.logs) {
      assertOperationLogContract(log);
    }

    const userCreateLogs = await requestJson(baseUrl, '/api/operation-logs?action=users.create', {
      token: admin.token,
    });
    assert.equal(userCreateLogs.response.status, 200);
    assert.equal(userCreateLogs.body.data.logs.length, 1);
    assert.equal(userCreateLogs.body.data.logs[0].action, 'users.create');
    assert.equal(userCreateLogs.body.data.logs[0].entityType, 'user');

    const settingLogs = await requestJson(baseUrl, '/api/operation-logs?entityType=system_setting', {
      token: admin.token,
    });
    assert.equal(settingLogs.response.status, 200);
    assert.deepEqual(
      settingLogs.body.data.logs.map((log) => log.action).sort(),
      ['settings.global_mark.enable', 'settings.global_mark.restore'],
    );

    const frontDeskLogs = await requestJson(baseUrl, `/api/operation-logs?userId=${frontDesk.user.id}`, {
      token: admin.token,
    });
    assert.equal(frontDeskLogs.response.status, 200);
    assert.equal(frontDeskLogs.body.data.logs.every((log) => log.userId === frontDesk.user.id), true);

    const pagedLogs = await requestJson(
      baseUrl,
      '/api/operation-logs?page=2&pageSize=2',
      {
        token: admin.token,
      },
    );
    assert.equal(pagedLogs.response.status, 200);
    assert.equal(pagedLogs.body.data.page, 2);
    assert.equal(pagedLogs.body.data.pageSize, 2);
    assert.equal(pagedLogs.body.data.logs.length, 2);
    assert.equal(
      pagedLogs.body.data.totalPages,
      Math.ceil(pagedLogs.body.data.total / 2),
    );

    const cappedPage = await requestJson(
      baseUrl,
      '/api/operation-logs?pageSize=999',
      {
        token: admin.token,
      },
    );
    assert.equal(cappedPage.response.status, 200);
    assert.equal(cappedPage.body.data.pageSize, 100);

    const invalidPage = await requestJson(
      baseUrl,
      '/api/operation-logs?page=0',
      {
        token: admin.token,
      },
    );
    assertErrorContract(
      invalidPage,
      400,
      'OPERATION_LOG_PAGINATION_INVALID',
    );
  });
});

test('unit: user-role policy enforces the server-side account hierarchy', () => {
  assert.equal(isSuperAdminRole('SUPER_ADMIN'), true);
  assert.equal(isOrdinaryEmployeeRole('sales'), true);
  assert.equal(canManageTargetRole('admin', 'sales'), true);
  assert.equal(canManageTargetRole('admin', 'admin'), false);
  assert.equal(canManageTargetRole('admin', 'SUPER_ADMIN'), false);
  assert.equal(canManageTargetRole('super_admin', 'ADMIN'), true);
  assert.equal(canManageTargetRole('super_admin', 'client_defined_role'), false);
  assert.equal(canAssignRole('admin', 'finance'), true);
  assert.equal(canAssignRole('admin', 'admin'), false);
  assert.equal(canAssignRole('super_admin', 'admin'), true);
  assert.equal(canAssignRole('super_admin', 'super_admin'), true);
});

test('contract: admin cannot mutate a super administrator through any user management path', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(
        baseUrl,
        'hierarchy-admin',
        'HierarchyAdminPassword123',
      );
      const sensitivePatches = [
        { name: 'Blocked Name' },
        { phone: '13900000001' },
        { leaderId: 'blocked-leader' },
        { role: 'sales' },
        { isActive: false },
        { password: 'BlockedPassword123' },
      ];

      for (const body of sensitivePatches) {
        const result = await requestJson(baseUrl, '/api/users/usr_admin', {
          method: 'PATCH',
          token: admin.token,
          body,
        });
        assertErrorContract(
          result,
          403,
          'SUPER_ADMIN_ACCOUNT_PROTECTED',
        );
      }

      const disabled = await requestJson(
        baseUrl,
        '/api/users/usr_admin/disable',
        {
          method: 'POST',
          token: admin.token,
          body: {
            reason: 'Blocked hierarchy change',
          },
        },
      );
      assertErrorContract(
        disabled,
        403,
        'SUPER_ADMIN_ACCOUNT_PROTECTED',
      );

      const resetCode = await requestJson(
        baseUrl,
        '/api/users/usr_admin/reset-password-code',
        {
          method: 'POST',
          token: admin.token,
        },
      );
      assertErrorContract(
        resetCode,
        403,
        'SUPER_ADMIN_ACCOUNT_PROTECTED',
      );

      const reset = await requestJson(
        baseUrl,
        '/api/users/usr_admin/reset-password',
        {
          method: 'POST',
          token: admin.token,
          body: {
            verificationCode: '000000',
            newPassword: 'BlockedPassword123',
          },
        },
      );
      assertErrorContract(
        reset,
        403,
        'SUPER_ADMIN_ACCOUNT_PROTECTED',
      );
    },
    {
      prisma: {
        users: [
          {
            id: 'usr_hierarchy_admin',
            username: 'hierarchy-admin',
            password: 'HierarchyAdminPassword123',
            role: 'admin',
          },
        ],
      },
    },
  );
});

test('contract: admin manages ordinary employees while only super_admin manages admin roles', async () => {
  await withPhase1Server(
    async (baseUrl, { prisma }) => {
      const superAdmin = await login(baseUrl);
      const admin = await login(
        baseUrl,
        'hierarchy-admin',
        'HierarchyAdminPassword123',
      );

      const ordinaryUpdate = await requestJson(
        baseUrl,
        '/api/users/usr_hierarchy_employee',
        {
          method: 'PATCH',
          token: admin.token,
          body: {
            name: 'Updated Employee',
            phone: '13900000002',
            leaderId: null,
            role: 'finance',
            permissions: ['users:update'],
            menus: ['employee_accounts'],
          },
        },
      );
      assert.equal(ordinaryUpdate.response.status, 200);
      assert.equal(ordinaryUpdate.body.data.user.role, 'finance');
      assert.equal(ordinaryUpdate.body.data.user.name, 'Updated Employee');
      const storedEmployee = prisma.__store.users.find(
        (user) => user.id === 'usr_hierarchy_employee',
      );
      assert.equal('permissions' in storedEmployee, false);
      assert.equal('menus' in storedEmployee, false);

      const peerAdminUpdate = await requestJson(
        baseUrl,
        '/api/users/usr_managed_admin',
        {
          method: 'PATCH',
          token: admin.token,
          body: {
            name: 'Blocked Admin Update',
          },
        },
      );
      assertErrorContract(peerAdminUpdate, 403, 'SUPER_ADMIN_REQUIRED');

      const forbiddenPromotion = await requestJson(
        baseUrl,
        '/api/users/usr_hierarchy_employee',
        {
          method: 'PATCH',
          token: admin.token,
          body: {
            role: 'admin',
          },
        },
      );
      assertErrorContract(
        forbiddenPromotion,
        403,
        'ROLE_ASSIGNMENT_FORBIDDEN',
      );

      const managedAdminUpdate = await requestJson(
        baseUrl,
        '/api/users/usr_managed_admin',
        {
          method: 'PATCH',
          token: superAdmin.token,
          body: {
            name: 'Managed By Super Admin',
            phone: '13900000003',
            leaderId: null,
            role: 'admin',
          },
        },
      );
      assert.equal(managedAdminUpdate.response.status, 200);
      assert.equal(
        managedAdminUpdate.body.data.user.name,
        'Managed By Super Admin',
      );
      assert.equal(managedAdminUpdate.body.data.user.role, 'admin');

      const promoted = await requestJson(
        baseUrl,
        '/api/users/usr_hierarchy_employee',
        {
          method: 'PATCH',
          token: superAdmin.token,
          body: {
            role: 'admin',
          },
        },
      );
      assert.equal(promoted.response.status, 200);
      assert.equal(promoted.body.data.user.role, 'admin');
    },
    {
      prisma: {
        users: [
          {
            id: 'usr_hierarchy_admin',
            username: 'hierarchy-admin',
            password: 'HierarchyAdminPassword123',
            role: 'admin',
          },
          {
            id: 'usr_managed_admin',
            username: 'managed-admin',
            role: 'admin',
          },
          {
            id: 'usr_hierarchy_employee',
            username: 'hierarchy-employee',
            role: 'sales',
            phone: '13800000002',
          },
        ],
      },
    },
  );
});

test('contract: the last active super administrator cannot be frozen or downgraded', async () => {
  await withPhase1Server(async (baseUrl, { prisma }) => {
    const superAdmin = await login(baseUrl);

    const disabled = await requestJson(
      baseUrl,
      '/api/users/usr_admin/disable',
      {
        method: 'POST',
        token: superAdmin.token,
        body: {
          reason: 'Attempt to remove final administrator',
        },
      },
    );
    assertErrorContract(disabled, 409, 'LAST_ACTIVE_SUPER_ADMIN');

    const downgraded = await requestJson(baseUrl, '/api/users/usr_admin', {
      method: 'PATCH',
      token: superAdmin.token,
      body: {
        role: 'admin',
      },
    });
    assertErrorContract(downgraded, 409, 'LAST_ACTIVE_SUPER_ADMIN');

    const current = prisma.__store.users.find(
      (user) => user.id === 'usr_admin',
    );
    assert.equal(current.role, 'SUPER_ADMIN');
    assert.equal(current.isActive, true);
  });
});

test('service: concurrent super_admin downgrades cannot remove every active super administrator', async () => {
  await withPhase1Server(
    async (_baseUrl, { prisma }) => {
      const service = new UsersNestService(
        prisma,
        {
          appendLog: async () => undefined,
        },
        {},
        {},
      );
      const actor = {
        id: 'usr_admin',
        role: 'super_admin',
      };

      const results = await Promise.allSettled([
        service.updateUser(actor, 'usr_admin', { role: 'admin' }),
        service.updateUser(actor, 'usr_second_super_admin', {
          role: 'admin',
        }),
      ]);
      assert.equal(
        results.filter((result) => result.status === 'fulfilled').length,
        1,
      );
      const rejected = results.find(
        (result) => result.status === 'rejected',
      );
      assert.equal(rejected.reason.code, 'LAST_ACTIVE_SUPER_ADMIN');
      assert.equal(
        prisma.__store.users.filter(
          (user) => user.role === 'SUPER_ADMIN' && user.isActive,
        ).length,
        1,
      );
    },
    {
      prisma: {
        users: [
          {
            id: 'usr_second_super_admin',
            username: 'second-super-admin',
            role: 'super_admin',
          },
        ],
      },
    },
  );
});
