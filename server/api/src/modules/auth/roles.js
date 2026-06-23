const USER_ROLES = [
  'admin',
  'boss',
  'front_desk',
  'sales',
  'finance',
  'warehouse',
  'after_sales',
  'taster',
];

const ROLE_DEFINITIONS = {
  admin: {
    role: 'admin',
    title: '管理员',
    description: '维护员工账号、权限、系统设置，并恢复全局标记查询开关。',
  },
  boss: {
    role: 'boss',
    title: '老板',
    description: '查看全局数据、数据分析和 AI 助手，可开启全局标记查询开关。',
  },
  front_desk: {
    role: 'front_desk',
    title: '前台',
    description: '录入和查询旅行团，可开启全局标记查询开关。',
  },
  sales: {
    role: 'sales',
    title: '销售',
    description: '维护自己负责的客户、订单和旅行团离店补充信息。',
  },
  finance: {
    role: 'finance',
    title: '财务',
    description: '核对订单、售后、提成、积分、物流费用和信息标记。',
  },
  warehouse: {
    role: 'warehouse',
    title: '库管',
    description: '围绕订单处理物流方式、打包状态和打包件数。',
  },
  after_sales: {
    role: 'after_sales',
    title: '售后',
    description: '查询客户订单并记录售后处理过程。',
  },
  taster: {
    role: 'taster',
    title: '品鉴师',
    description: '只查看自己的接待和自己的提成入口。',
  },
};

const MENU_ENTRIES = {
  dashboard: { id: 'dashboard', title: '首页', phase: 1 },
  employee_accounts: { id: 'employee_accounts', title: '员工账号', phase: 1 },
  role_permissions: { id: 'role_permissions', title: '角色权限', phase: 1 },
  global_mark_query: { id: 'global_mark_query', title: '全局标记查询', phase: 1 },
  operation_logs: { id: 'operation_logs', title: '操作日志', phase: 1 },
  travel_groups: { id: 'travel_groups', title: '旅行团管理', phase: 3 },
  own_taster_receptions: { id: 'own_taster_receptions', title: '我的接待', phase: 3, dataScope: 'self' },
  sales_orders: { id: 'sales_orders', title: '销售订单', phase: 4 },
  after_sales_orders: { id: 'after_sales_orders', title: '售后处理', phase: 6 },
  finance_workspace: { id: 'finance_workspace', title: '财务查询', phase: 6 },
  warehouse_workspace: { id: 'warehouse_workspace', title: '库管发货', phase: 6 },
  commissions: { id: 'commissions', title: '提成积分', phase: 7 },
  own_commissions: { id: 'own_commissions', title: '我的提成', phase: 7, dataScope: 'self' },
  analytics: { id: 'analytics', title: '数据分析', phase: 8 },
  ai_assistant: { id: 'ai_assistant', title: 'AI 助手', phase: 9 },
  system_settings: { id: 'system_settings', title: '系统设置', phase: 1 },
};

const ROLE_MENU_IDS = {
  admin: [
    'dashboard',
    'employee_accounts',
    'role_permissions',
    'global_mark_query',
    'operation_logs',
    'travel_groups',
    'sales_orders',
    'after_sales_orders',
    'finance_workspace',
    'warehouse_workspace',
    'commissions',
    'analytics',
    'ai_assistant',
    'system_settings',
  ],
  boss: ['dashboard', 'global_mark_query', 'travel_groups', 'sales_orders', 'finance_workspace', 'analytics', 'ai_assistant'],
  front_desk: ['dashboard', 'global_mark_query', 'travel_groups'],
  sales: ['dashboard', 'travel_groups', 'sales_orders'],
  finance: ['dashboard', 'travel_groups', 'sales_orders', 'after_sales_orders', 'finance_workspace', 'commissions'],
  warehouse: ['dashboard', 'sales_orders', 'warehouse_workspace'],
  after_sales: ['dashboard', 'sales_orders', 'after_sales_orders'],
  taster: ['dashboard', 'own_taster_receptions', 'own_commissions'],
};

const ROLE_PERMISSIONS = {
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
  ],
  boss: [
    'auth:me',
    'auth:change_password',
    'roles:read',
    'settings:global_mark:read',
    'settings:global_mark:enable',
  ],
  front_desk: [
    'auth:me',
    'auth:change_password',
    'roles:read',
    'settings:global_mark:read',
    'settings:global_mark:enable',
  ],
  sales: ['auth:me', 'auth:change_password', 'roles:read', 'settings:global_mark:read'],
  finance: ['auth:me', 'auth:change_password', 'roles:read', 'settings:global_mark:read'],
  warehouse: ['auth:me', 'auth:change_password', 'roles:read', 'settings:global_mark:read'],
  after_sales: ['auth:me', 'auth:change_password', 'roles:read', 'settings:global_mark:read'],
  taster: ['auth:me', 'auth:change_password', 'roles:read', 'settings:global_mark:read'],
};

const ROLE_DATA_SCOPES = {
  admin: { default: 'all' },
  boss: { default: 'all' },
  front_desk: { travelGroups: 'front_desk_scope' },
  sales: { customers: 'own_sales_user_id', orders: 'own_sales_user_id' },
  finance: { default: 'finance_allowed' },
  warehouse: { orders: 'delivery_related' },
  after_sales: { orders: 'after_sales_related' },
  taster: { travelGroups: 'own_taster_id', commissions: 'own_user_id' },
};

function getRoleCatalog() {
  return USER_ROLES.map((role) => ({
    ...ROLE_DEFINITIONS[role],
    permissions: getRolePermissions(role),
    menus: getRoleMenus(role),
    dataScope: getRoleDataScope(role),
  }));
}

function getRolePermissions(role) {
  return [...(ROLE_PERMISSIONS[role] || [])];
}

function getRoleMenus(role) {
  return (ROLE_MENU_IDS[role] || []).map((menuId) => MENU_ENTRIES[menuId]);
}

function getRoleDataScope(role) {
  return { ...(ROLE_DATA_SCOPES[role] || {}) };
}

function isValidRole(role) {
  return USER_ROLES.includes(role);
}

module.exports = {
  USER_ROLES,
  getRoleCatalog,
  getRoleDataScope,
  getRoleMenus,
  getRolePermissions,
  isValidRole,
};
