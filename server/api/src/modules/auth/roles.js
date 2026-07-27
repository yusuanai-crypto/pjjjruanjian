const USER_ROLES = [
  'super_admin',
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
  super_admin: {
    role: 'super_admin',
    title: '超级管理员',
    description: '维护全部账号和系统权限，可冻结或解冻管理员账号。',
  },
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
    description: '查看今天全部旅行团，录入本人当天订单并拥有一次完整修改机会。',
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
    description: '查看今天及未来旅行团，今天关联团可无限次修改，并查看接待品鉴师关系订单。',
  },
};

const MENU_ENTRIES = {
  customers: { id: 'customers', title: 'Customers', phase: 4 },
  dashboard: { id: 'dashboard', title: '首页', phase: 1 },
  todo_reminders: { id: 'todo_reminders', title: '待办提醒', phase: 1 },
  employee_accounts: { id: 'employee_accounts', title: '员工账号', phase: 1 },
  role_permissions: { id: 'role_permissions', title: '角色权限', phase: 1 },
  global_mark_query: { id: 'global_mark_query', title: '全局标记查询', phase: 1 },
  operation_logs: { id: 'operation_logs', title: '操作日志', phase: 1 },
  travel_groups: { id: 'travel_groups', title: '旅行团录入', phase: 3 },
  travel_group_query: { id: 'travel_group_query', title: '旅行团管理', phase: 3 },
  guide_management: { id: 'guide_management', title: '导游管理', phase: 3 },
  travel_agency_management: { id: 'travel_agency_management', title: '旅行社管理', phase: 7 },
  travel_group_finance_supplement: { id: 'travel_group_finance_supplement', title: '积分表', phase: 6 },
  guide_points_table: { id: 'guide_points_table', title: '导游积分表', phase: 7 },
  travel_group_order_notes: { id: 'travel_group_order_notes', title: '损耗与离店备注', phase: 4 },
  own_taster_receptions: { id: 'own_taster_receptions', title: '我的接待', phase: 3, dataScope: 'self' },
  sales_orders: { id: 'sales_orders', title: '销售订单', phase: 4 },
  order_query: { id: 'order_query', title: '订单管理', phase: 4 },
  after_sales_orders: { id: 'after_sales_orders', title: '售后处理', phase: 6 },
  finance_workspace: { id: 'finance_workspace', title: '物流单号与品鉴师提成填写', phase: 6 },
  reconciliation_table: { id: 'reconciliation_table', title: '对账表', phase: 6 },
  warehouse_workspace: { id: 'warehouse_workspace', title: '库管发货', phase: 6 },
  commissions: { id: 'commissions', title: '提成积分', phase: 7 },
  commission_rules: { id: 'commission_rules', title: '提成规则', phase: 7 },
  product_management: { id: 'product_management', title: '商品管理', phase: 10 },
  serialized_inventory: { id: 'serialized_inventory', title: '茅台', phase: 10 },
  own_commissions: { id: 'own_commissions', title: '我的提成', phase: 7, dataScope: 'self' },
  analytics: { id: 'analytics', title: '数据分析', phase: 8 },
  profit_analysis: { id: 'profit_analysis', title: '利润分析', phase: 10 },
  ai_assistant: { id: 'ai_assistant', title: 'AI 助手', phase: 9 },
  system_settings: { id: 'system_settings', title: '系统设置', phase: 1 },
};

const ROLE_MENU_IDS = {
  super_admin: [
    'dashboard',
    'todo_reminders',
    'employee_accounts',
    'role_permissions',
    'global_mark_query',
    'operation_logs',
    'travel_groups',
    'travel_group_query',
    'guide_management',
    'travel_agency_management',
    'travel_group_finance_supplement',
    'guide_points_table',
    'travel_group_order_notes',
    'customers',
    'sales_orders',
    'order_query',
    'after_sales_orders',
    'finance_workspace',
    'reconciliation_table',
    'warehouse_workspace',
    'commissions',
    'commission_rules',
    'product_management',
    'serialized_inventory',
    'analytics',
    'profit_analysis',
    'ai_assistant',
    'system_settings',
  ],
  admin: [
    'dashboard',
    'todo_reminders',
    'employee_accounts',
    'role_permissions',
    'global_mark_query',
    'operation_logs',
    'travel_groups',
    'travel_group_query',
    'guide_management',
    'travel_agency_management',
    'travel_group_finance_supplement',
    'guide_points_table',
    'travel_group_order_notes',
    'customers',
    'sales_orders',
    'order_query',
    'after_sales_orders',
    'finance_workspace',
    'reconciliation_table',
    'warehouse_workspace',
    'commissions',
    'commission_rules',
    'product_management',
    'serialized_inventory',
    'analytics',
    'profit_analysis',
    'ai_assistant',
    'system_settings',
  ],
  boss: [
    'dashboard',
    'todo_reminders',
    'global_mark_query',
    'travel_group_query',
    'customers',
    'order_query',
    'guide_points_table',
    'analytics',
    'profit_analysis',
    'ai_assistant',
  ],
  front_desk: [
    'dashboard',
    'todo_reminders',
    'global_mark_query',
    'travel_groups',
    'travel_group_query',
    'guide_management',
  ],
  sales: [
    'dashboard',
    'todo_reminders',
    'travel_group_query',
    'travel_group_order_notes',
    'customers',
    'sales_orders',
    'order_query',
  ],
  finance: [
    'dashboard',
    'todo_reminders',
    'travel_group_query',
    'travel_agency_management',
    'travel_group_finance_supplement',
    'guide_points_table',
    'customers',
    'order_query',
    'after_sales_orders',
    'finance_workspace',
    'reconciliation_table',
    'commissions',
    'commission_rules',
    'product_management',
    'serialized_inventory',
    'ai_assistant',
  ],
  warehouse: [
    'dashboard',
    'todo_reminders',
    'travel_group_query',
    'order_query',
    'warehouse_workspace',
    'serialized_inventory',
    'after_sales_orders',
  ],
  after_sales: [
    'dashboard',
    'todo_reminders',
    'travel_group_query',
    'customers',
    'order_query',
    'after_sales_orders',
    'analytics',
    'ai_assistant',
  ],
  taster: [
    'dashboard',
    'todo_reminders',
    'travel_group_query',
    'order_query',
    'own_taster_receptions',
    'own_commissions',
  ],
};

const TODO_REMINDER_PERMISSIONS = [
  'todo_reminders:list',
  'todo_reminders:read',
  'todo_reminders:update',
  'todo_reminders:verify',
  'todo_reminders:archive',
];
const AUTHENTICATED_PERMISSIONS = [
  'auth:me',
  'auth:change_password',
  'roles:read',
  ...TODO_REMINDER_PERMISSIONS,
];
const USER_ADMIN_PERMISSIONS = [
  'users:list',
  'users:read',
  'users:create',
  'users:update',
  'users:disable',
  'users:enable',
  'users:reset_password',
];
const GLOBAL_MARK_READ_PERMISSION = ['settings:global_mark:read'];
const GLOBAL_MARK_ENABLE_PERMISSION = ['settings:global_mark:enable'];
const GLOBAL_MARK_RESTORE_PERMISSION = ['settings:global_mark:restore'];
const OPERATION_LOG_PERMISSIONS = ['operation_logs:list'];
const INVENTORY_READ_PERMISSIONS = [
  'inventory:configuration:read',
  'inventory:warehouses:read',
  'inventory:stocks:read',
  'inventory:movements:read',
  'inventory:inbounds:read',
  'inventory:transfers:read',
  'inventory:alert_configs:read',
];
const INVENTORY_COST_READ_PERMISSIONS = [
  'inventory:purchase_costs:read',
];
const INVENTORY_MANAGE_PERMISSIONS = [
  'inventory:configuration:manage',
  'inventory:warehouses:manage',
  'inventory:alert_configs:manage',
  'inventory:rebuild_check',
];
const INVENTORY_INBOUND_WRITE_PERMISSIONS = [
  'inventory:inbounds:create',
  'inventory:inbounds:reverse',
];
const INVENTORY_COST_WRITE_PERMISSIONS = [
  'inventory:batch_costs:write',
];
const INVENTORY_QUANTITY_WRITE_PERMISSIONS = [
  'inventory:transfers:create',
  'inventory:transfers:confirm_outbound',
  'inventory:transfers:receive',
  'inventory:transfers:reverse',
  'inventory:unavailable:write',
];

const TRAVEL_GROUP_READ_PERMISSIONS = ['travel_groups:list', 'travel_groups:read'];
const TRAVEL_GROUP_WRITE_PERMISSIONS = [
  ...TRAVEL_GROUP_READ_PERMISSIONS,
  'travel_groups:create',
  'travel_groups:update',
];
const TRAVEL_GROUP_FINANCE_MARK_PERMISSIONS = ['travel_groups:finance_mark'];
const TRAVEL_GROUP_TASTER_WRITE_PERMISSIONS = [
  'travel_groups:taster_update',
  'travel_groups:taster_summary',
  'travel_groups:taster_attachments',
];

const GUIDE_CARRIED_GROUP_READ_PERMISSIONS = ['guide_carried_groups:list', 'guide_carried_groups:read'];
const GUIDE_CARRIED_GROUP_WRITE_PERMISSIONS = [
  ...GUIDE_CARRIED_GROUP_READ_PERMISSIONS,
  'guide_carried_groups:create',
  'guide_carried_groups:update',
];
const GUIDE_CARRIED_GROUP_FINANCE_MARK_PERMISSIONS = ['guide_carried_groups:finance_mark'];

const PENDING_TRAVEL_GROUP_READ_PERMISSIONS = ['pending_travel_groups:list', 'pending_travel_groups:read'];
const PENDING_TRAVEL_GROUP_WRITE_PERMISSIONS = [
  ...PENDING_TRAVEL_GROUP_READ_PERMISSIONS,
  'pending_travel_groups:create',
  'pending_travel_groups:update',
];
const PENDING_TRAVEL_GROUP_FINANCE_MARK_PERMISSIONS = ['pending_travel_groups:finance_mark'];

const GROUP_READ_PERMISSIONS = [
  ...TRAVEL_GROUP_READ_PERMISSIONS,
  ...GUIDE_CARRIED_GROUP_READ_PERMISSIONS,
  ...PENDING_TRAVEL_GROUP_READ_PERMISSIONS,
];
const GROUP_WRITE_PERMISSIONS = [
  ...TRAVEL_GROUP_WRITE_PERMISSIONS,
  ...GUIDE_CARRIED_GROUP_WRITE_PERMISSIONS,
  ...PENDING_TRAVEL_GROUP_WRITE_PERMISSIONS,
];
const GROUP_FINANCE_MARK_PERMISSIONS = [
  ...TRAVEL_GROUP_FINANCE_MARK_PERMISSIONS,
  ...GUIDE_CARRIED_GROUP_FINANCE_MARK_PERMISSIONS,
  ...PENDING_TRAVEL_GROUP_FINANCE_MARK_PERMISSIONS,
];

const SALES_ORDER_READ_PERMISSIONS = ['sales_orders:list', 'sales_orders:read'];
const SALES_ORDER_CREATE_PERMISSIONS = ['sales_orders:create'];
const SALES_ORDER_FINANCE_MARK_PERMISSIONS = ['sales_orders:finance_mark'];
const SALES_ORDER_SHIPPING_DATE_PERMISSIONS = [
  'sales_orders:update_shipping_date',
];
const GUIDE_POINTS_READ_PERMISSIONS = [
  'guide_points_summaries:list',
  'guide_points_summaries:read',
];
const GUIDE_POINTS_WRITE_PERMISSIONS = [
  ...GUIDE_POINTS_READ_PERMISSIONS,
  'guide_points_summaries:update',
  'guide_points_orders:update_rates',
  'guide_points_summaries:update_payment_status',
];
const GUIDE_POINTS_SWITCH_PERMISSIONS = [
  'sales_orders:update_points_destination',
];
const CUSTOMER_READ_PERMISSIONS = ['customers:list', 'customers:read'];
const CUSTOMER_CREATE_PERMISSIONS = ['customers:create'];
const CUSTOMER_UPDATE_PERMISSIONS = ['customers:update'];
const CUSTOMER_FINANCE_MARK_PERMISSIONS = ['customers:finance_mark'];

const FINANCE_OVERVIEW_PERMISSIONS = ['finance:overview'];
const RECONCILIATION_READ_PERMISSIONS = ['reconciliations:read'];
const RECONCILIATION_WRITE_PERMISSIONS = ['reconciliations:upsert'];
const RECONCILIATION_REVIEW_PERMISSIONS = ['reconciliations:review'];
const STRIKE_BONUS_PERMISSIONS = ['strike_bonus_awards:list', 'strike_bonus_awards:create'];

const ROLE_PERMISSIONS = {
  super_admin: [
    ...AUTHENTICATED_PERMISSIONS,
    ...USER_ADMIN_PERMISSIONS,
    ...GLOBAL_MARK_READ_PERMISSION,
    ...GLOBAL_MARK_ENABLE_PERMISSION,
    ...GLOBAL_MARK_RESTORE_PERMISSION,
    ...OPERATION_LOG_PERMISSIONS,
    ...INVENTORY_READ_PERMISSIONS,
    ...INVENTORY_COST_READ_PERMISSIONS,
    ...INVENTORY_MANAGE_PERMISSIONS,
    ...INVENTORY_INBOUND_WRITE_PERMISSIONS,
    ...INVENTORY_COST_WRITE_PERMISSIONS,
    ...INVENTORY_QUANTITY_WRITE_PERMISSIONS,
    ...GROUP_WRITE_PERMISSIONS,
    ...GROUP_FINANCE_MARK_PERMISSIONS,
    ...CUSTOMER_READ_PERMISSIONS,
    ...CUSTOMER_CREATE_PERMISSIONS,
    ...CUSTOMER_UPDATE_PERMISSIONS,
    ...CUSTOMER_FINANCE_MARK_PERMISSIONS,
    ...SALES_ORDER_READ_PERMISSIONS,
    ...SALES_ORDER_CREATE_PERMISSIONS,
    ...SALES_ORDER_FINANCE_MARK_PERMISSIONS,
    ...GUIDE_POINTS_WRITE_PERMISSIONS,
    ...GUIDE_POINTS_SWITCH_PERMISSIONS,
    ...FINANCE_OVERVIEW_PERMISSIONS,
    ...RECONCILIATION_READ_PERMISSIONS,
    ...RECONCILIATION_REVIEW_PERMISSIONS,
    ...STRIKE_BONUS_PERMISSIONS,
  ],
  admin: [
    ...AUTHENTICATED_PERMISSIONS,
    ...USER_ADMIN_PERMISSIONS,
    ...GLOBAL_MARK_READ_PERMISSION,
    ...GLOBAL_MARK_ENABLE_PERMISSION,
    ...GLOBAL_MARK_RESTORE_PERMISSION,
    ...OPERATION_LOG_PERMISSIONS,
    ...INVENTORY_READ_PERMISSIONS,
    ...INVENTORY_COST_READ_PERMISSIONS,
    ...INVENTORY_MANAGE_PERMISSIONS,
    ...INVENTORY_INBOUND_WRITE_PERMISSIONS,
    ...INVENTORY_COST_WRITE_PERMISSIONS,
    ...INVENTORY_QUANTITY_WRITE_PERMISSIONS,
    ...GROUP_WRITE_PERMISSIONS,
    ...GROUP_FINANCE_MARK_PERMISSIONS,
    ...CUSTOMER_READ_PERMISSIONS,
    ...CUSTOMER_CREATE_PERMISSIONS,
    ...CUSTOMER_UPDATE_PERMISSIONS,
    ...CUSTOMER_FINANCE_MARK_PERMISSIONS,
    ...SALES_ORDER_READ_PERMISSIONS,
    ...SALES_ORDER_CREATE_PERMISSIONS,
    ...SALES_ORDER_FINANCE_MARK_PERMISSIONS,
    ...GUIDE_POINTS_WRITE_PERMISSIONS,
    ...GUIDE_POINTS_SWITCH_PERMISSIONS,
    ...FINANCE_OVERVIEW_PERMISSIONS,
    ...RECONCILIATION_READ_PERMISSIONS,
    ...RECONCILIATION_REVIEW_PERMISSIONS,
    ...STRIKE_BONUS_PERMISSIONS,
  ],
  boss: [
    ...AUTHENTICATED_PERMISSIONS,
    ...GLOBAL_MARK_READ_PERMISSION,
    ...GLOBAL_MARK_ENABLE_PERMISSION,
    ...GROUP_WRITE_PERMISSIONS,
    ...CUSTOMER_READ_PERMISSIONS,
    ...SALES_ORDER_READ_PERMISSIONS,
    ...GUIDE_POINTS_READ_PERMISSIONS,
    ...GUIDE_POINTS_SWITCH_PERMISSIONS,
    ...INVENTORY_READ_PERMISSIONS,
    ...INVENTORY_COST_READ_PERMISSIONS,
  ],
  front_desk: [
    ...AUTHENTICATED_PERMISSIONS,
    ...GLOBAL_MARK_READ_PERMISSION,
    ...GLOBAL_MARK_ENABLE_PERMISSION,
    ...GROUP_WRITE_PERMISSIONS,
    ...SALES_ORDER_READ_PERMISSIONS,
  ],
  sales: [
    ...AUTHENTICATED_PERMISSIONS,
    ...GLOBAL_MARK_READ_PERMISSION,
    ...TRAVEL_GROUP_READ_PERMISSIONS,
    ...CUSTOMER_READ_PERMISSIONS,
    ...CUSTOMER_CREATE_PERMISSIONS,
    ...CUSTOMER_UPDATE_PERMISSIONS,
    ...SALES_ORDER_READ_PERMISSIONS,
    ...SALES_ORDER_CREATE_PERMISSIONS,
    ...SALES_ORDER_SHIPPING_DATE_PERMISSIONS,
  ],
  finance: [
    ...AUTHENTICATED_PERMISSIONS,
    ...GLOBAL_MARK_READ_PERMISSION,
    ...GROUP_WRITE_PERMISSIONS,
    ...GROUP_FINANCE_MARK_PERMISSIONS,
    ...CUSTOMER_READ_PERMISSIONS,
    ...CUSTOMER_UPDATE_PERMISSIONS,
    ...CUSTOMER_FINANCE_MARK_PERMISSIONS,
    ...SALES_ORDER_READ_PERMISSIONS,
    ...SALES_ORDER_CREATE_PERMISSIONS,
    ...SALES_ORDER_FINANCE_MARK_PERMISSIONS,
    ...SALES_ORDER_SHIPPING_DATE_PERMISSIONS,
    ...GUIDE_POINTS_WRITE_PERMISSIONS,
    ...GUIDE_POINTS_SWITCH_PERMISSIONS,
    ...FINANCE_OVERVIEW_PERMISSIONS,
    ...RECONCILIATION_READ_PERMISSIONS,
    ...RECONCILIATION_WRITE_PERMISSIONS,
    ...STRIKE_BONUS_PERMISSIONS,
    ...INVENTORY_READ_PERMISSIONS,
    ...INVENTORY_COST_READ_PERMISSIONS,
    ...INVENTORY_COST_WRITE_PERMISSIONS,
  ],
  warehouse: [
    ...AUTHENTICATED_PERMISSIONS,
    ...GLOBAL_MARK_READ_PERMISSION,
    ...TRAVEL_GROUP_READ_PERMISSIONS,
    ...SALES_ORDER_READ_PERMISSIONS,
    ...SALES_ORDER_SHIPPING_DATE_PERMISSIONS,
    ...INVENTORY_READ_PERMISSIONS,
    ...INVENTORY_INBOUND_WRITE_PERMISSIONS,
    ...INVENTORY_QUANTITY_WRITE_PERMISSIONS,
  ],
  after_sales: [
    ...AUTHENTICATED_PERMISSIONS,
    ...GLOBAL_MARK_READ_PERMISSION,
    ...GLOBAL_MARK_ENABLE_PERMISSION,
    ...TRAVEL_GROUP_READ_PERMISSIONS,
    ...CUSTOMER_READ_PERMISSIONS,
    ...CUSTOMER_CREATE_PERMISSIONS,
    ...CUSTOMER_UPDATE_PERMISSIONS,
    ...SALES_ORDER_READ_PERMISSIONS,
    ...SALES_ORDER_SHIPPING_DATE_PERMISSIONS,
  ],
  taster: [
    ...AUTHENTICATED_PERMISSIONS,
    ...GLOBAL_MARK_READ_PERMISSION,
    ...GROUP_READ_PERMISSIONS,
    ...TRAVEL_GROUP_TASTER_WRITE_PERMISSIONS,
    ...SALES_ORDER_READ_PERMISSIONS,
  ],
};

const ROLE_DATA_SCOPES = {
  super_admin: { default: 'all' },
  admin: { default: 'all' },
  boss: { default: 'all' },
  front_desk: { travelGroups: 'front_desk_scope' },
  sales: {
    customers: 'own_sales_user_id',
    orders: 'own_sales_user_id_today_created_at',
    travelGroups: 'today_all_read_only',
  },
  finance: { default: 'finance_allowed' },
  warehouse: { orders: 'delivery_related' },
  after_sales: { orders: 'after_sales_related' },
  taster: {
    travelGroups: 'today_and_future',
    travelGroupUpdates: 'today_assigned_taster_or_liaison_unlimited_edits',
    orders: 'today_and_future_reception_taster_only',
    receptions: 'own_user_id',
    commissions: 'own_user_id',
  },
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
