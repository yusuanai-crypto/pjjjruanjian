const MODULE_LABELS: Record<string, string> = {
  user: '用户管理',
  users: '用户管理',
  auth: '用户管理',
  employee_accounts: '用户管理',
  order: '订单管理',
  orders: '订单管理',
  sales_order: '订单管理',
  sales_orders: '订单管理',
  product: '商品管理',
  products: '商品管理',
  goods: '商品管理',
  todo_reminders: '待办提醒',
  setting: '系统设置',
  settings: '系统设置',
  analytics: '数据统计',
  customers: '客户管理',
  customer: '客户管理',
  travel_groups: '旅行团管理',
  travel_group: '旅行团管理',
  travel_agencies: '旅行社管理',
  travel_agency: '旅行社管理',
  guides: '导游管理',
  guide: '导游管理',
  after_sales: '售后管理',
  after_sales_orders: '售后订单',
  commission_records: '提成记录',
  commission_rules: '提成规则',
  travel_group_finance_summaries: '旅游团财务',
  reconciliations: '每日对账',
  serialized_inventory: '序列化库存',
  inventory: '库存管理',
  warehouse: '仓库管理',
  strike_bonus_awards: '奖励管理',
  operation_logs: '操作日志',
  security: '安全管理',
  send_sms: '短信服务',
  sendsms: '短信服务',
  ai: '智能助手',
  business_data: '业务数据',
  dashboard: '首页',
  seed: '系统初始化',
};

const ENTITY_LABELS: Record<string, string> = {
  user: '用户',
  product: '商品',
  customer: '客户',
  sales_order: '订单',
  order: '订单',
  after_sales_order: '售后订单',
  travel_group: '旅行团',
  travel_agency: '旅行社',
  guide: '导游',
  todo_recipient: '待办事项',
  operation_log: '操作日志',
  system_setting: '系统设置',
  daily_reconciliation: '对账记录',
  commission_record: '提成记录',
  commission_rule: '提成规则',
  agency_rebate_rule: '旅行社返点规则',
  agency_deduction_rule: '旅行社扣单规则',
  sales_deduction_rule: '销售扣单规则',
  travel_group_finance_summary: '旅游团财务记录',
  serialized_inventory_batch: '库存批次',
  serialized_inventory_unit: '库存商品',
  serialized_inventory_export: '库存导出文件',
  warehouse: '仓库',
  stock_alert_config: '库存预警配置',
  inventory_document: '库存单据',
  strike_bonus_award: '奖励记录',
  analytics_overview: '经营数据',
  analytics_sales_performance: '销售业绩',
  analytics_taster_ranking: '品鉴师排行',
  request: '系统请求',
  system: '系统数据',
};

const OPERATION_TYPE_LABELS: Record<string, string> = {
  CREATE: '新增',
  READ: '查看',
  UPDATE: '修改',
  DELETE: '删除',
  LOGIN: '登录',
  LOGOUT: '退出登录',
  IMPORT: '导入',
  EXPORT: '导出',
  UPLOAD: '上传',
  DOWNLOAD: '下载',
  REVIEW: '审核',
  STATUS_CHANGE: '状态变更',
  OTHER: '其他操作',
};

const ACTION_LABELS: Record<string, string> = {
  list: '查看',
  get: '查看',
  detail: '查看',
  read: '查看',
  create: '新增',
  add: '新增',
  update: '修改',
  edit: '修改',
  sales_edit: '修改',
  'shipping_date.update': '修改发货日期',
  upsert: '修改',
  delete: '删除',
  remove: '删除',
  login: '登录',
  login_failed: '登录',
  logout: '退出登录',
  enable: '启用',
  disable: '停用',
  export: '导出',
  export_selected: '导出',
  import: '导入',
  approve: '审核通过',
  reject: '审核不通过',
  review: '审核',
  upload: '上传',
  download: '下载',
  archive: '归档',
  restore: '恢复',
  refresh: '刷新',
  'not_entered.confirm': '确认未进店',
  'not_entered.revoke': '撤销未进店',
  revoke: '撤销',
  confirm: '确认',
  send: '发送',
  send_sms: '发送',
  remind: '提醒',
  recalculate: '重新计算',
  recalculate_failed: '重新计算',
  reset_password: '重置密码',
  reset_password_to_default: '重置密码',
  change_password: '修改密码',
  authentication_failed: '登录失败',
  authorization_failed: '权限校验失败',
  generate: '生成',
  regenerate: '重新生成',
  trigger: '触发',
  'points_destination.guide_personal': '调整走个人金额',
  'points_destination.travel_agency': '取消走个人',
};

const FIELD_LABELS: Record<string, string> = {
  username: '登录账号',
  role: '管理员身份',
  productId: '商品编号',
  productName: '商品名称',
  name: '名称',
  id: '业务编号',
  code: '业务编码',
  no: '业务编号',
  orderId: '订单编号',
  salesOrderId: '订单编号',
  orderNo: '订单编号',
  afterSalesNo: '售后单号',
  status: '状态',
  price: '销售价格',
  salePrice: '销售价格',
  salesPrice: '销售价格',
  stock: '库存数量',
  quantity: '数量',
  count: '数量',
  page: '查看页码',
  pageSize: '每页数量',
  returnedCount: '本次找到',
  exportedCount: '导出数量',
  createdAt: '创建时间',
  updatedAt: '修改时间',
  loginTime: '登录时间',
  loginIdentifier: '登录账号',
  loginResult: '登录结果',
  isActive: '启用状态',
  enabled: '启用状态',
  active: '启用状态',
  groupNo: '团号',
  travelGroupNo: '团号',
  customerName: '客户名称',
  phone: '手机号码',
  mobile: '手机号码',
  idCard: '身份证号',
  idCardNumber: '身份证号',
  amount: '金额',
  totalAmount: '总金额',
  totalAmountCents: '总金额',
  personalAmountCents: '走个人金额',
  normalAmountCents: '正常金额',
  personalPointsRefundAmountCents: '个人退款金额',
  normalPointsRefundAmountCents: '正常退款金额',
  pointsDestination: '积分归属',
  pointsDestinationChangedById: '走个人修改人',
  pointsDestinationChangedAt: '走个人修改时间',
  unitPrice: '单价',
  unitPriceCents: '单价',
  remark: '备注',
  remarks: '备注',
  archived: '历史归档',
  type: '类型',
  category: '分类',
  title: '标题',
  result: '结果',
  targetId: '业务对象编号',
  financeMark: '财务标记',
  paymentStatus: '付款状态',
  deliveryStatus: '发货状态',
  reviewStatus: '审核状态',
  shippingDate: '发货日期',
  reason: '修改原因',
};

const VALUE_LABELS: Record<string, string> = {
  SUCCESS: '成功',
  FAILURE: '失败',
  ACTIVE: '正常使用',
  INACTIVE: '已停用',
  ENABLED: '已启用',
  DISABLED: '已停用',
  PENDING: '待处理',
  PROCESSING: '处理中',
  COMPLETED: '已完成',
  APPROVED: '已通过',
  REJECTED: '未通过',
  CANCELLED: '已取消',
  VALID: '有效',
  INVALID: '无效',
  OLD: '原状态',
  NEW: '新状态',
  partial_refund: '部分退款',
  refunded: '已退单',
  cancelled: '已取消',
  self_pickup: '自带',
  shipping: '邮寄',
  super_admin: '超级管理员',
  admin: '管理员',
  boss: '老板',
  front_desk: '前台',
  sales: '销售',
  finance: '财务',
  warehouse: '库管',
  after_sales: '售后',
  taster: '品鉴师',
};

export type OperationLogBusinessPresentation = {
  actor: string;
  module: string;
  operation: string;
  object: string;
  summary: string;
  result: string;
  details: string;
};

export function operationLogModuleLabel(value: unknown): string {
  const raw = String(value || '');
  const module = raw.includes('.') ? raw.split('.')[0] : raw;
  const normalized = normalizeCode(module);
  return MODULE_LABELS[normalized] || readableCode(normalized, '其他业务');
}

export function operationLogActionLabel(
  operationType: unknown,
  action: unknown,
): string {
  const normalized = normalizeCode(action);
  if (normalized.endsWith('.summary.list')) {
    return '查看';
  }
  const segments = normalized.split('.').filter(Boolean);
  const candidates = [
    segments.slice(-2).join('.'),
    segments[segments.length - 1],
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (ACTION_LABELS[candidate]) {
      return ACTION_LABELS[candidate];
    }
  }
  for (const [suffix, label] of Object.entries(ACTION_LABELS)) {
    if (
      normalized.endsWith(`.${suffix}`) ||
      normalized.endsWith(`_${suffix}`)
    ) {
      return label;
    }
  }
  for (const segment of [...segments].reverse()) {
    if (ACTION_LABELS[segment]) return ACTION_LABELS[segment];
  }
  return (
    OPERATION_TYPE_LABELS[String(operationType || '').toUpperCase()] ||
    '其他操作'
  );
}

export function presentOperationLog(
  log: any,
): OperationLogBusinessPresentation {
  const actor =
    normalizedString(log.actorNameSnapshot) ||
    normalizedString(log.actorUsernameSnapshot) ||
    '未知操作人';
  const module = operationLogModuleLabel(log.module || log.action);
  const operation = operationLogActionLabel(log.operationType, log.action);
  const object = objectLabel(log, module);
  const comparisons = comparisonRows(log);
  const result = String(log.result || '').toUpperCase() === 'SUCCESS'
    ? '成功'
    : '失败';
  return {
    actor,
    module,
    operation,
    object,
    summary: summaryText(log, actor, operation, object, comparisons),
    result,
    details: detailsText(log, operation, comparisons),
  };
}

function objectLabel(log: any, module: string): string {
  const action = normalizeCode(log.action);
  if (action === 'todo_reminders.list') return '待办事项列表';
  if (action === 'todo_reminders.summary.list') return '待办事项汇总';
  if (action.startsWith('auth.login')) return '管理后台';
  if (action === 'operation_logs.list') return '操作日志列表';
  if (action === 'operation_logs.filter_options') {
    return '操作日志筛选项';
  }
  const data = combinedData(log);
  const entityType = normalizeCode(log.entityType);
  const productName = findValue(data, [
    'productName',
    'product_name',
    'name',
  ]);
  if (entityType === 'product' && productName !== null) {
    return `商品“${formatValue('productName', productName, log.module)}”`;
  }
  const orderNo = findValue(data, [
    'orderNo',
    'salesOrderNo',
    'afterSalesNo',
  ]);
  if (entityType.includes('order') && orderNo !== null) {
    return `${entityLabel(entityType)}“${orderNo}”`;
  }
  const groupNo = findValue(data, ['groupNo', 'travelGroupNo']);
  if (entityType.includes('travel_group') && groupNo !== null) {
    return `旅行团“${groupNo}”`;
  }
  const customerName = findValue(data, ['customerName', 'name']);
  if (entityType === 'customer' && customerName !== null) {
    return `客户“${customerName}”`;
  }
  const entity = entityLabel(entityType);
  const entityId = normalizedString(log.entityId);
  if (entityId) return `${entity}（编号：${entityId}）`;
  if (action.endsWith('.list')) return `${module}列表`;
  if (action.includes('export')) return `${module}数据`;
  return entity === '业务内容' ? `${module}内容` : entity;
}

function summaryText(
  log: any,
  actor: string,
  operation: string,
  object: string,
  comparisons: Array<{ label: string; before: string; after: string; changed: boolean }>,
): string {
  const action = normalizeCode(log.action);
  if (action === 'todo_reminders.list') {
    return withResult(log, `${actor}查看了待办事项列表`);
  }
  if (action === 'todo_reminders.summary.list') {
    return withResult(log, `${actor}查看了待办事项汇总`);
  }
  if (action.startsWith('auth.login')) {
    const username =
      findValue(combinedData(log), ['username', 'loginIdentifier']) ||
      log.actorUsernameSnapshot ||
      '该';
    const outcome = isSuccess(log) ? '登录成功' : '登录失败';
    return `${actor}使用 ${username} 账号登录了管理后台，${outcome}。`;
  }
  if (operation === '修改' || operation === '状态变更') {
    if (!isSuccess(log)) {
      return `${actor}尝试修改${object}，但操作失败。`;
    }
    const changed = comparisons.filter((row) => row.changed);
    if (changed.length === 0) return `${actor}修改了${object}。`;
    if (changed.length === 1) {
      const row = changed[0];
      return `${actor}将${object}的${row.label}从 ${row.before} 修改为 ${row.after}。`;
    }
    return `${actor}修改了${object}，共修改了 ${changed.length} 项内容。`;
  }
  if (operation === '导出') {
    const count = findValue(combinedData(log), [
      'exportedCount',
      'returnedCount',
      'count',
    ]);
    const countText =
      count === null
        ? ''
        : `，共 ${formatValue('exportedCount', count, log.module)}`;
    return withResult(log, `${actor}导出了${object}${countText}`);
  }
  const verbs: Record<string, string> = {
    新增: '新增了',
    删除: '删除了',
    查看: '查看了',
    退出登录: '退出了',
    启用: '启用了',
    停用: '停用了',
    导入: '导入了',
    上传: '上传了',
    下载: '下载了',
    审核通过: '审核通过了',
    审核不通过: '审核未通过',
    审核: '审核了',
    归档: '归档了',
    恢复: '恢复了',
    重置密码: '重置了',
  };
  return withResult(log, `${actor}${verbs[operation] || '处理了'}${object}`);
}

function detailsText(
  log: any,
  operation: string,
  comparisons: Array<{ label: string; before: string; after: string; changed: boolean }>,
): string {
  if (operation === '修改' || operation === '状态变更') {
    return comparisons
      .map(
        (row) =>
          `${row.label}：${row.before} → ${row.after}${
            row.changed ? '（已修改）' : ''
          }`,
      )
      .join('\n');
  }
  if (operation === '登录') {
    const data = combinedData(log);
    const username =
      findValue(data, ['username', 'loginIdentifier']) ||
      log.actorUsernameSnapshot;
    const role = findValue(data, ['role']) || log.actorRoleSnapshot;
    return [
      username ? `登录账号：${formatValue('username', username)}` : '',
      role ? `管理员身份：${formatValue('role', role)}` : '',
      `登录结果：${isSuccess(log) ? '成功' : '失败'}`,
      `登录时间：${formatDate(log.createdAt)}`,
    ]
      .filter(Boolean)
      .join('\n');
  }
  const rows: string[] = [];
  const requestSummary = asMap(log.requestSummary);
  const filters = asMap(requestSummary.filters);
  const conditions = Object.keys(filters).length > 0 ? filters : requestSummary;
  for (const [key, value] of Object.entries(flatten(conditions))) {
    if (
      ['filterKeys', 'bodyKeys', 'returnedCount', 'loginIdentifier'].includes(
        key,
      ) ||
      isSensitiveField(key)
    ) {
      continue;
    }
    rows.push(
      `${fieldLabel(key, log.module)}：${formatValue(
        key,
        value,
        log.module,
      )}`,
    );
  }
  if (requestSummary.returnedCount !== undefined) {
    rows.push(
      `本次找到：${formatValue(
        'returnedCount',
        requestSummary.returnedCount,
        log.module,
      )}`,
    );
  }
  const content =
    operation === '删除'
      ? Object.keys(asMap(log.beforeData)).length > 0
        ? log.beforeData
        : log.afterData
      : log.afterData;
  for (const [key, value] of Object.entries(flatten(content))) {
    if (!isSensitiveField(key)) {
      rows.push(
        `${fieldLabel(key, log.module)}：${formatValue(
          key,
          value,
          log.module,
        )}`,
      );
    }
  }
  return Array.from(new Set(rows)).join('\n');
}

function comparisonRows(log: any) {
  const before = flatten(log.beforeData);
  const after = flatten(log.afterData);
  const keys = Array.from(
    new Set([...Object.keys(before), ...Object.keys(after)]),
  );
  return keys
    .filter((key) => !isSensitiveField(key))
    .map((key) => ({
      label: fieldLabel(key, log.module || log.action),
      before: formatValue(key, before[key], log.module || log.action),
      after: formatValue(key, after[key], log.module || log.action),
      changed: !valuesEqual(before[key], after[key]),
    }));
}

function fieldLabel(key: string, module?: unknown): string {
  if (
    normalizeKey(key.split('.').pop()) === 'status' &&
    normalizeCode(module).includes('todo_reminders')
  ) {
    return '待办状态';
  }
  return key
    .split('.')
    .map((segment) => FIELD_LABELS[segment] || readableCode(segment, '内容'))
    .join(' / ');
}

function formatValue(field: string, value: any, module?: unknown): string {
  if (value === null || value === undefined || String(value).trim() === '') {
    return '未填写';
  }
  const normalizedField = normalizeKey(field);
  if (typeof value === 'boolean') {
    if (
      normalizedField.includes('active') ||
      normalizedField.includes('enabled')
    ) {
      return value ? '已启用' : '已停用';
    }
    return value ? '是' : '否';
  }
  if (typeof value === 'number') {
    if (normalizedField === 'page') return `第 ${plainNumber(value)} 页`;
    if (normalizedField === 'pagesize') return `${plainNumber(value)} 条`;
    if (normalizedField === 'returnedcount') {
      return `${plainNumber(value)} 条记录`;
    }
    if (normalizedField === 'exportedcount') {
      return `${plainNumber(value)} 条记录`;
    }
    if (isMoneyField(normalizedField)) {
      const amount = normalizedField.endsWith('cents') ? value / 100 : value;
      return `${new Intl.NumberFormat('zh-CN', {
        maximumFractionDigits: 2,
      }).format(amount)} 元`;
    }
    if (
      normalizedField.includes('stock') ||
      normalizedField.includes('quantity')
    ) {
      return `${plainNumber(value)} 件`;
    }
    if (normalizedField.endsWith('count')) {
      return `${plainNumber(value)} 条`;
    }
    return plainNumber(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '未填写';
    const visible = value
      .slice(0, 20)
      .map((item) => formatValue(field, item, module))
      .join('、');
    return value.length > 20 ? `${visible} 等 ${value.length} 项` : visible;
  }
  if (typeof value === 'object') {
    const rows = Object.entries(flatten(value));
    return rows.length === 0
      ? '未填写'
      : rows
          .map(
            ([key, child]) =>
              `${fieldLabel(key)}：${formatValue(key, child, module)}`,
          )
          .join('；');
  }
  const text = String(value).trim();
  if (
    looksLikePhone(text) ||
    normalizedField.includes('phone') ||
    normalizedField.includes('mobile')
  ) {
    return maskPhone(text);
  }
  if (
    normalizedField.includes('idcard') ||
    normalizedField.includes('identity')
  ) {
    return maskIdentity(text);
  }
  if (isDateField(normalizedField) || /^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return formatDate(parsed);
  }
  const semanticEnum =
    normalizedField.includes('role') ||
    normalizedField.includes('status') ||
    normalizedField.endsWith('type') ||
    normalizedField.endsWith('category') ||
    normalizedField.endsWith('mode') ||
    normalizedField.endsWith('result') ||
    normalizedField.endsWith('source');
  const direct = semanticEnum
    ? VALUE_LABELS[text] || VALUE_LABELS[text.toUpperCase()]
    : VALUE_LABELS[text.toUpperCase()];
  if (direct) {
    if (
      text.toUpperCase() === 'ACTIVE' &&
      normalizeCode(module).includes('todo_reminders')
    ) {
      return '处理中';
    }
    return direct;
  }
  if (semanticEnum && /^[A-Za-z][A-Za-z0-9_-]*$/.test(text)) {
    return readableCode(text, '其他');
  }
  if (/^[A-Z][A-Z0-9_]*$/.test(text)) {
    return readableCode(text, '其他状态');
  }
  return text;
}

function isSensitiveField(key: string): boolean {
  const normalized = normalizeKey(key);
  return (
    normalized === 'password' ||
    normalized.endsWith('password') ||
    normalized.includes('passwordhash') ||
    normalized === 'token' ||
    normalized.endsWith('token') ||
    normalized.includes('refreshtoken') ||
    normalized.includes('accesstoken') ||
    normalized === 'cookie' ||
    normalized.endsWith('cookie') ||
    normalized === 'secret' ||
    normalized.endsWith('secret') ||
    normalized.includes('authorization') ||
    normalized.includes('privatekey') ||
    normalized === 'key' ||
    normalized.endsWith('secretkey') ||
    normalized.endsWith('signingkey') ||
    normalized.endsWith('encryptionkey') ||
    normalized.includes('apikey') ||
    normalized.includes('verificationcode') ||
    normalized.includes('smscode') ||
    normalized.includes('resetcode') ||
    normalized.includes('captcha') ||
    normalized.includes('credential')
  );
}

function flatten(value: any, prefix = ''): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output: Record<string, any> = {};
  for (const [rawKey, child] of Object.entries(value)) {
    const key = `${prefix}${rawKey}`;
    if (isSensitiveField(key)) continue;
    if (
      child &&
      typeof child === 'object' &&
      !Array.isArray(child) &&
      Object.keys(child).length > 0
    ) {
      Object.assign(output, flatten(child, `${key}.`));
    } else {
      output[key] = child;
    }
  }
  return output;
}

function combinedData(log: any): Record<string, any> {
  return {
    ...asMap(log.requestSummary),
    ...asMap(log.beforeData),
    ...asMap(log.afterData),
  };
}

function findValue(value: any, keys: string[]): any {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (
        keys.some((candidate) => normalizeKey(candidate) === normalizeKey(key)) &&
        child !== null &&
        child !== undefined &&
        String(child).trim() !== ''
      ) {
        return child;
      }
    }
    for (const child of Object.values(value)) {
      const found = findValue(child, keys);
      if (found !== null) return found;
    }
  } else if (Array.isArray(value)) {
    for (const child of value) {
      const found = findValue(child, keys);
      if (found !== null) return found;
    }
  }
  return null;
}

function entityLabel(value: unknown): string {
  const normalized = normalizeCode(value);
  return ENTITY_LABELS[normalized] || readableCode(normalized, '业务内容');
}

function readableCode(value: unknown, fallback: string): string {
  const normalized = normalizeCode(value);
  const tokenLabels: Record<string, string> = {
    after: '售后',
    sales: '销售',
    order: '订单',
    orders: '订单',
    travel: '旅游',
    group: '团',
    groups: '团',
    finance: '财务',
    summary: '汇总',
    summaries: '汇总',
    customer: '客户',
    customers: '客户',
    product: '商品',
    products: '商品',
    goods: '商品',
    user: '用户',
    users: '用户',
    setting: '设置',
    settings: '设置',
    todo: '待办',
    reminders: '提醒',
    analytics: '数据统计',
    commission: '提成',
    records: '记录',
    rules: '规则',
    inventory: '库存',
    warehouse: '仓库',
    guide: '导游',
    guides: '导游',
    agency: '旅行社',
    agencies: '旅行社',
    reconciliation: '对账',
    reconciliations: '对账',
    operation: '操作',
    logs: '日志',
    security: '安全',
    system: '系统',
    daily: '每日',
    status: '状态',
    payment: '付款',
    delivery: '配送',
    review: '审核',
    active: '启用',
    type: '类型',
    category: '分类',
    mark: '标记',
    bonus: '奖励',
    awards: '记录',
    serialized: '序列化',
    data: '数据',
    business: '业务',
    id: '编号',
    no: '编号',
    code: '编码',
    actual: '实际',
    cost: '成本',
    cents: '',
    total: '合计',
    amount: '金额',
    unit: '单位',
    price: '价格',
    name: '名称',
    created: '创建',
    updated: '修改',
    at: '时间',
    date: '日期',
    time: '时间',
    is: '',
    number: '数量',
    quantity: '数量',
    stock: '库存',
    phone: '手机',
    mobile: '手机',
    address: '地址',
    contact: '联系人',
    remark: '备注',
    remarks: '备注',
    marked: '标记',
    by: '操作人',
    tracking: '物流',
    attachment: '附件',
    attachments: '附件',
    file: '文件',
    source: '来源',
    target: '对象',
    enabled: '启用',
    overview: '概览',
    performance: '业绩',
    ranking: '排行',
    taster: '品鉴师',
  };
  const translated = normalized
    .split(/[_\s]+/)
    .map((token) => tokenLabels[token])
    .filter(Boolean)
    .join('');
  return translated || fallback;
}

function withResult(log: any, successText: string): string {
  if (isSuccess(log)) return `${successText}。`;
  const attempted = successText.replace('了', '');
  return `${attempted}，但操作失败。`;
}

function isSuccess(log: any): boolean {
  return String(log.result || '').toUpperCase() === 'SUCCESS';
}

function valuesEqual(left: any, right: any): boolean {
  if (typeof left === 'number' && typeof right === 'number') {
    return left === right;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function asMap(value: any): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function normalizedString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeCode(value: unknown): string {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .trim()
    .toLowerCase();
}

function normalizeKey(value: unknown): string {
  return normalizeCode(value).replace(/[^a-z0-9]/g, '');
}

function isMoneyField(field: string): boolean {
  return (
    field.includes('price') ||
    field.includes('amount') ||
    field.includes('cost') ||
    field.endsWith('fee') ||
    field.endsWith('feecents')
  );
}

function isDateField(field: string): boolean {
  return (
    field.endsWith('at') ||
    field.endsWith('time') ||
    field.endsWith('date')
  );
}

function looksLikePhone(value: string): boolean {
  return /^1\d{10}$/.test(value.replace(/\D/g, ''));
}

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7) return '已脱敏';
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

function maskIdentity(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 8) return '已脱敏';
  return `${normalized.slice(0, 3)}***********${normalized.slice(-4)}`;
}

function plainNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function formatDate(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '未填写';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}
