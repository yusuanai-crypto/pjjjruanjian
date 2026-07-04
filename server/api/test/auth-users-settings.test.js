const assert = require('node:assert/strict');
const test = require('node:test');

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
    'reconciliations:upsert',
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
    'finance:overview',
    'reconciliations:read',
    'reconciliations:upsert',
    'strike_bonus_awards:list',
    'strike_bonus_awards:create',
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
    'sales_orders:list',
    'sales_orders:read',
  ],
  after_sales: [
    'auth:me',
    'auth:change_password',
    'roles:read',
    'settings:global_mark:read',
    'settings:global_mark:enable',
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
    assert.equal(loginResult.body.data.user.role, 'admin');
    assert.equal(loginResult.body.data.permissions.includes('users:create'), true);
    assert.equal(loginResult.body.data.menus.some((menu) => menu.id === 'employee_accounts'), true);
    assert.equal(loginResult.body.data.menus.some((menu) => menu.id === 'pending_travel_groups'), true);
    assert.equal(loginResult.body.data.menus.some((menu) => menu.id === 'commission_rules'), true);
    assert.equal(loginResult.body.data.menus.some((menu) => menu.id === 'travel_agency_management'), true);
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
    assert.equal(roles.body.data.roles.length, 8);
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
    assert.equal(roleMenus.after_sales.includes('after_sales_orders'), true);
    assert.equal(roleMenus.after_sales.includes('order_query'), true);
    assert.equal(roleMenus.finance.includes('order_query'), true);
    assert.equal(roleMenus.finance.includes('finance_workspace'), true);
    assert.equal(roleMenus.finance.includes('commissions'), true);
    assert.equal(roleMenus.finance.includes('commission_rules'), true);
    assert.equal(roleMenus.finance.includes('travel_agency_management'), true);
    assert.equal(roleMenus.warehouse.includes('warehouse_workspace'), true);
    assert.equal(roleMenus.boss.includes('after_sales_orders'), true);
    assert.equal(roleMenus.boss.includes('finance_workspace'), true);
    assert.equal(roleMenus.boss.includes('warehouse_workspace'), true);
    assert.equal(roleMenus.boss.includes('commission_rules'), false);
    assert.equal(roleMenus.boss.includes('travel_agency_management'), false);
    assert.equal(roleMenus.sales.includes('after_sales_orders'), true);
    for (const role of ['sales', 'warehouse', 'after_sales', 'front_desk', 'taster']) {
      assert.equal(roleMenus[role].includes('commission_rules'), false);
      assert.equal(roleMenus[role].includes('travel_agency_management'), false);
    }
    for (const role of ['front_desk', 'taster']) {
      assert.equal(roleMenus[role].includes('after_sales_orders'), false);
      assert.equal(roleMenus[role].includes('finance_workspace'), false);
      assert.equal(roleMenus[role].includes('warehouse_workspace'), false);
    }

    const tasterRole = roles.body.data.roles.find((role) => role.role === 'taster');
    assert.equal(tasterRole.title, '品鉴师');
    assert.equal(Array.isArray(tasterRole.permissions), true);
    assert.deepEqual(
      tasterRole.menus.map((menu) => menu.id),
      ['dashboard', 'own_taster_receptions', 'own_commissions'],
    );
    assert.deepEqual(tasterRole.dataScope, {
      travelGroups: 'own_taster_id',
      commissions: 'own_user_id',
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
    assertCurrentUserContract(changed.body.data);
    assert.equal(changed.body.data.user.username, 'admin');
    assert.equal(changed.body.data.permissions.includes('users:create'), true);

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
      username: 'sales01',
      password: 'Password123',
      role: 'sales',
      phone: '13800000000',
      leaderId: null,
      isActive: true,
    });
    assert.equal(createdUser.username, 'sales01');
    assert.equal(createdUser.role, 'sales');
    assert.equal(createdUser.isActive, true);

    const duplicateUsername = await requestJson(baseUrl, '/api/users', {
      method: 'POST',
      token: admin.token,
      body: {
        name: '重复账号',
        username: 'sales01',
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
    assert.equal(list.body.data.users.some((user) => user.username === 'sales01'), true);
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
        isActive: true,
      },
    });
    assert.equal(updated.response.status, 200);
    assertPublicUserContract(updated.body.data.user);
    assert.equal(updated.body.data.user.name, '测试财务');
    assert.equal(updated.body.data.user.role, 'finance');

    const disabled = await requestJson(baseUrl, `/api/users/${createdUser.id}/disable`, {
      method: 'POST',
      token: admin.token,
    });
    assert.equal(disabled.response.status, 200);
    assert.equal(disabled.body.data.user.isActive, false);

    const disabledLogin = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: {
        username: 'sales01',
        password: 'Password123',
      },
    });
    assertErrorContract(disabledLogin, 403, 'ACCOUNT_DISABLED');

    const enabled = await requestJson(baseUrl, `/api/users/${createdUser.id}/enable`, {
      method: 'POST',
      token: admin.token,
    });
    assert.equal(enabled.response.status, 200);
    assert.equal(enabled.body.data.user.isActive, true);

    const reset = await requestJson(baseUrl, `/api/users/${createdUser.id}/reset-password`, {
      method: 'POST',
      token: admin.token,
      body: {
        newPassword: 'ResetPass123',
      },
    });
    assert.equal(reset.response.status, 200);
    assert.equal(reset.body.data.user.username, 'sales01');

    const resetLogin = await login(baseUrl, 'sales01', 'ResetPass123');
    assert.equal(resetLogin.user.role, 'finance');
  });
});

test('contract: non-admin users cannot manage users and taster menu is scoped to own work', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    await createUser(baseUrl, admin.token, {
      name: '测试品鉴师',
      username: 'taster01',
      password: 'Password123',
      role: 'taster',
    });

    const taster = await login(baseUrl, 'taster01', 'Password123');
    assert.deepEqual(
      taster.menus.map((menu) => menu.id),
      ['dashboard', 'own_taster_receptions', 'own_commissions'],
    );
    assert.equal(taster.menus.some((menu) => menu.id === 'employee_accounts'), false);
    assert.deepEqual(taster.dataScope, {
      travelGroups: 'own_taster_id',
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
      phone: '13800001234',
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
      await login(baseUrl, 'picker-front-desk', 'Password123'),
      await login(baseUrl, 'picker-sales', 'Password123'),
      await login(baseUrl, 'picker-finance', 'Password123'),
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

    const blockedSessions = [
      await login(baseUrl, 'picker-warehouse', 'Password123'),
      await login(baseUrl, 'picker-after-sales', 'Password123'),
      await login(baseUrl, 'active-taster', 'Password123'),
    ];

    for (const session of blockedSessions) {
      const blocked = await requestJson(baseUrl, '/api/users/tasters', {
        token: session.token,
      });
      assertErrorContract(blocked, 403, 'PERMISSION_DENIED');
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
    assert.deepEqual(Object.keys(allLogs.body.data).sort(), ['logs']);
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
  });
});
