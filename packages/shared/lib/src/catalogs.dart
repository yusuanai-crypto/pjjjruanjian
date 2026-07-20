enum UserRole {
  superAdmin('super_admin', '超级管理员'),
  admin('admin', '管理员'),
  boss('boss', '老板'),
  frontDesk('front_desk', '前台'),
  sales('sales', '销售'),
  finance('finance', '财务'),
  warehouse('warehouse', '库管'),
  afterSales('after_sales', '售后'),
  taster('taster', '品鉴师');

  const UserRole(this.value, this.label);

  final String value;
  final String label;
}

class RoleDefinition {
  const RoleDefinition({required this.role, required this.description});

  final UserRole role;
  final String description;
}

const roleDefinitions = <RoleDefinition>[
  RoleDefinition(role: UserRole.superAdmin, description: '维护全部账号、权限、系统设置和操作日志'),
  RoleDefinition(role: UserRole.admin, description: '维护账号、权限、系统设置和操作日志'),
  RoleDefinition(role: UserRole.boss, description: '查看经营数据、全局标记查询和 AI 助手'),
  RoleDefinition(role: UserRole.frontDesk, description: '录入旅行团并管理前台查询入口'),
  RoleDefinition(
    role: UserRole.sales,
    description: '录入客户订单、补充旅行团离店信息、生成二维码销售单',
  ),
  RoleDefinition(role: UserRole.finance, description: '核对金额、标记信息、物流和提成'),
  RoleDefinition(role: UserRole.warehouse, description: '处理待发货订单、物流方式和打包状态'),
  RoleDefinition(role: UserRole.afterSales, description: '查询订单并创建售后处理记录'),
  RoleDefinition(
    role: UserRole.taster,
    description: '全量查看旅行团，按接团或对接关系编辑，并查看本人接待和提成',
  ),
];

class SharedMenuEntry {
  const SharedMenuEntry({
    required this.id,
    required this.label,
    required this.phase,
  });

  final String id;
  final String label;
  final int phase;
}

const sharedMenuEntries = <SharedMenuEntry>[
  SharedMenuEntry(id: 'dashboard', label: '首页', phase: 1),
  SharedMenuEntry(id: 'role_menu', label: '角色菜单', phase: 2),
  SharedMenuEntry(id: 'employee_accounts', label: '员工账号', phase: 1),
  SharedMenuEntry(id: 'travel_group_form', label: '旅行团录入', phase: 3),
  SharedMenuEntry(id: 'travel_group_query', label: '旅行团管理', phase: 3),
  SharedMenuEntry(id: 'travel_agency_management', label: '旅行社管理', phase: 7),
  SharedMenuEntry(
    id: 'travel_group_finance_supplement',
    label: '积分表',
    phase: 6,
  ),
  SharedMenuEntry(id: 'travel_group_order_notes', label: '订单绑定与离店备注', phase: 4),
  SharedMenuEntry(id: 'order_form', label: '订单录入', phase: 4),
  SharedMenuEntry(id: 'order_query', label: '订单管理', phase: 4),
  SharedMenuEntry(id: 'qr_sales_sheet', label: '二维码销售单', phase: 5),
  SharedMenuEntry(id: 'taster_summary', label: '我的接待', phase: 3),
  SharedMenuEntry(id: 'taster_commissions', label: '我的提成', phase: 7),
  SharedMenuEntry(id: 'finance_query', label: '财务查询', phase: 6),
  SharedMenuEntry(id: 'commission_rules', label: '提成规则', phase: 7),
  SharedMenuEntry(id: 'product_management', label: '商品管理', phase: 10),
  SharedMenuEntry(id: 'reconciliation_table', label: '对账表', phase: 6),
  SharedMenuEntry(id: 'warehouse_packing', label: '库管打包', phase: 6),
  SharedMenuEntry(id: 'after_sales_form', label: '售后处理', phase: 6),
  SharedMenuEntry(id: 'analytics', label: '数据分析', phase: 8),
  SharedMenuEntry(id: 'ai_assistant', label: 'AI 助手', phase: 9),
];

const roleMenuIds = <UserRole, List<String>>{
  UserRole.superAdmin: [
    'dashboard',
    'role_menu',
    'employee_accounts',
    'travel_group_form',
    'travel_group_query',
    'travel_agency_management',
    'travel_group_finance_supplement',
    'travel_group_order_notes',
    'order_form',
    'order_query',
    'qr_sales_sheet',
    'taster_summary',
    'finance_query',
    'commission_rules',
    'product_management',
    'reconciliation_table',
    'warehouse_packing',
    'after_sales_form',
    'analytics',
    'ai_assistant',
  ],
  UserRole.admin: [
    'dashboard',
    'role_menu',
    'employee_accounts',
    'travel_group_form',
    'travel_group_query',
    'travel_agency_management',
    'travel_group_finance_supplement',
    'travel_group_order_notes',
    'order_form',
    'order_query',
    'qr_sales_sheet',
    'taster_summary',
    'finance_query',
    'commission_rules',
    'product_management',
    'reconciliation_table',
    'warehouse_packing',
    'after_sales_form',
    'analytics',
    'ai_assistant',
  ],
  UserRole.boss: [
    'dashboard',
    'role_menu',
    'travel_group_query',
    'order_query',
    'analytics',
    'ai_assistant',
  ],
  UserRole.frontDesk: [
    'dashboard',
    'role_menu',
    'travel_group_form',
    'travel_group_query',
  ],
  UserRole.sales: [
    'dashboard',
    'role_menu',
    'travel_group_query',
    'travel_group_order_notes',
    'order_form',
    'order_query',
    'qr_sales_sheet',
  ],
  UserRole.finance: [
    'dashboard',
    'role_menu',
    'travel_group_query',
    'travel_agency_management',
    'order_query',
    'after_sales_form',
    'finance_query',
    'commission_rules',
    'product_management',
    'reconciliation_table',
    'analytics',
    'ai_assistant',
  ],
  UserRole.warehouse: [
    'dashboard',
    'role_menu',
    'travel_group_query',
    'order_query',
    'warehouse_packing',
    'after_sales_form',
  ],
  UserRole.afterSales: [
    'dashboard',
    'role_menu',
    'travel_group_query',
    'order_form',
    'order_query',
    'after_sales_form',
    'analytics',
    'ai_assistant',
  ],
  UserRole.taster: [
    'dashboard',
    'role_menu',
    'travel_group_query',
    'order_query',
    'taster_summary',
    'taster_commissions',
  ],
};

enum OrderStatus {
  valid('valid', '有效'),
  partialRefund('partial_refund', '部分退款'),
  refunded('refunded', '已退单'),
  cancelled('cancelled', '取消');

  const OrderStatus(this.value, this.label);

  final String value;
  final String label;
}

enum DeliveryType {
  selfPickup('self_pickup', '自带'),
  shipping('shipping', '邮寄');

  const DeliveryType(this.value, this.label);

  final String value;
  final String label;
}

enum PackingStatus {
  pending('pending', '待打包'),
  packing('packing', '打包中'),
  packed('packed', '已打包'),
  abnormal('abnormal', '异常');

  const PackingStatus(this.value, this.label);

  final String value;
  final String label;
}

enum AfterSalesStatus {
  negotiating('negotiating', '协商中'),
  waitingReceive('waiting_receive', '待收货'),
  waitingResend('waiting_resend', '待补发'),
  waitingRefund('waiting_refund', '待退款'),
  completed('completed', '已完成');

  const AfterSalesStatus(this.value, this.label);

  final String value;
  final String label;
}

const logisticsMethods = <String>['韵达', '安能', '顺丰', '客户自提', '其他'];

const groupTypes = <String>['KB团', 'AB团', '保险团', '渠道团', '散客团', '其他'];

const datePresetLabels = <String>[
  '今日',
  '昨日',
  '最近十天',
  '最近一个月',
  '上个月',
  '本月',
  '今年',
];
