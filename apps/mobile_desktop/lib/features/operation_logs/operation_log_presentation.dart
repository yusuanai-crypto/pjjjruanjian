enum OperationLogDetailKind {
  read,
  create,
  update,
  delete,
  login,
  export,
  review,
  other,
}

class OperationLogEntry {
  const OperationLogEntry({
    required this.id,
    required this.action,
    required this.entityType,
    required this.result,
    required this.createdAt,
    this.userId,
    this.actorNameSnapshot,
    this.actorUsernameSnapshot,
    this.actorRoleSnapshot,
    this.module,
    this.operationType,
    this.entityId,
    this.beforeData,
    this.afterData,
    this.requestSummary,
    this.httpMethod,
    this.requestPath,
    this.requestId,
    this.statusCode,
    this.errorCode,
    this.errorMessage,
    this.durationMs,
    this.ipAddress,
    this.archived = false,
  });

  final String id;
  final String? userId;
  final String? actorNameSnapshot;
  final String? actorUsernameSnapshot;
  final String? actorRoleSnapshot;
  final String? module;
  final String? operationType;
  final String action;
  final String entityType;
  final String? entityId;
  final String result;
  final dynamic beforeData;
  final dynamic afterData;
  final dynamic requestSummary;
  final String? httpMethod;
  final String? requestPath;
  final String? requestId;
  final int? statusCode;
  final String? errorCode;
  final String? errorMessage;
  final int? durationMs;
  final String? ipAddress;
  final bool archived;
  final DateTime createdAt;

  factory OperationLogEntry.fromJson(Map<String, dynamic> json) {
    return OperationLogEntry(
      id: '${json['id'] ?? ''}',
      userId: _string(json['userId']),
      actorNameSnapshot: _string(json['actorNameSnapshot']),
      actorUsernameSnapshot: _string(json['actorUsernameSnapshot']),
      actorRoleSnapshot: _string(json['actorRoleSnapshot']),
      module: _string(json['module']),
      operationType: _string(json['operationType']),
      action: '${json['action'] ?? ''}',
      entityType: '${json['entityType'] ?? ''}',
      entityId: _string(json['entityId']),
      result: '${json['result'] ?? 'SUCCESS'}'.toUpperCase(),
      beforeData: json['beforeData'],
      afterData: json['afterData'],
      requestSummary: json['requestSummary'],
      httpMethod: _string(json['httpMethod']),
      requestPath: _string(json['requestPath']),
      requestId: _string(json['requestId']),
      statusCode: _nullableInt(json['statusCode']),
      errorCode: _string(json['errorCode']),
      errorMessage: _string(json['errorMessage']),
      durationMs: _nullableInt(json['durationMs']),
      ipAddress: _string(json['ipAddress']),
      archived: json['archived'] == true,
      createdAt: DateTime.tryParse('${json['createdAt'] ?? ''}') ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
    );
  }
}

class OperationLogDisplay {
  const OperationLogDisplay({
    required this.actor,
    required this.module,
    required this.operation,
    required this.object,
    required this.summary,
    required this.result,
    required this.detailKind,
    required this.sections,
    required this.comparisons,
    required this.isRead,
    required this.isImportant,
    this.failureReason,
  });

  final String actor;
  final String module;
  final String operation;
  final String object;
  final String summary;
  final String result;
  final OperationLogDetailKind detailKind;
  final List<OperationLogDetailSection> sections;
  final List<OperationLogComparison> comparisons;
  final bool isRead;
  final bool isImportant;
  final String? failureReason;
}

class OperationLogDetailSection {
  const OperationLogDetailSection({
    required this.title,
    required this.rows,
  });

  final String title;
  final List<OperationLogFieldValue> rows;
}

class OperationLogFieldValue {
  const OperationLogFieldValue({
    required this.label,
    required this.value,
  });

  final String label;
  final String value;
}

class OperationLogComparison {
  const OperationLogComparison({
    required this.label,
    required this.before,
    required this.after,
    required this.changed,
  });

  final String label;
  final String before;
  final String after;
  final bool changed;
}

class OperationLogPresentation {
  const OperationLogPresentation._();

  static const moduleLabels = <String, String>{
    'user': '用户管理',
    'users': '用户管理',
    'auth': '用户管理',
    'employee_accounts': '用户管理',
    'order': '订单管理',
    'orders': '订单管理',
    'sales_order': '订单管理',
    'sales_orders': '订单管理',
    'product': '商品管理',
    'products': '商品管理',
    'goods': '商品管理',
    'todo_reminders': '待办提醒',
    'setting': '系统设置',
    'settings': '系统设置',
    'analytics': '数据统计',
    'customers': '客户管理',
    'customer': '客户管理',
    'travel_groups': '旅行团管理',
    'travel_group': '旅行团管理',
    'travel_agencies': '旅行社管理',
    'travel_agency': '旅行社管理',
    'guides': '导游管理',
    'guide': '导游管理',
    'after_sales': '售后管理',
    'after_sales_orders': '售后订单',
    'commission_records': '提成记录',
    'commission_rules': '提成规则',
    'travel_group_finance_summaries': '旅游团财务',
    'reconciliations': '每日对账',
    'serialized_inventory': '序列化库存',
    'warehouse': '仓库管理',
    'strike_bonus_awards': '奖励管理',
    'operation_logs': '操作日志',
    'security': '安全管理',
    'send_sms': '短信服务',
    'sendsms': '短信服务',
    'ai': '智能助手',
    'business_data': '业务数据',
    'dashboard': '首页',
    'seed': '系统初始化',
  };

  static const fieldLabels = <String, String>{
    'username': '登录账号',
    'role': '管理员身份',
    'productId': '商品编号',
    'productName': '商品名称',
    'name': '名称',
    'id': '业务编号',
    'code': '业务编码',
    'no': '业务编号',
    'orderId': '订单编号',
    'salesOrderId': '订单编号',
    'orderNo': '订单编号',
    'afterSalesNo': '售后单号',
    'status': '状态',
    'price': '销售价格',
    'salePrice': '销售价格',
    'salesPrice': '销售价格',
    'stock': '库存数量',
    'quantity': '数量',
    'count': '数量',
    'page': '查看页码',
    'pageSize': '每页数量',
    'returnedCount': '本次找到',
    'exportedCount': '导出数量',
    'createdAt': '创建时间',
    'updatedAt': '修改时间',
    'loginTime': '登录时间',
    'loginIdentifier': '登录账号',
    'loginResult': '登录结果',
    'isActive': '启用状态',
    'enabled': '启用状态',
    'active': '启用状态',
    'groupNo': '团号',
    'travelGroupNo': '团号',
    'customerName': '客户名称',
    'phone': '手机号码',
    'mobile': '手机号码',
    'idCard': '身份证号',
    'idCardNumber': '身份证号',
    'amount': '金额',
    'totalAmount': '总金额',
    'totalAmountCents': '总金额',
    'unitPrice': '单价',
    'unitPriceCents': '单价',
    'remark': '备注',
    'remarks': '备注',
    'archived': '历史归档',
    'type': '类型',
    'category': '分类',
    'title': '标题',
    'result': '结果',
    'targetId': '业务对象编号',
    'financeMark': '财务标记',
    'paymentStatus': '付款状态',
    'deliveryStatus': '发货状态',
    'reviewStatus': '审核状态',
    'shippingDate': '发货日期',
    'shippingDateMode': '发货方式',
    'reason': '修改原因',
  };

  static const _entityLabels = <String, String>{
    'user': '用户',
    'product': '商品',
    'customer': '客户',
    'sales_order': '订单',
    'order': '订单',
    'after_sales_order': '售后订单',
    'travel_group': '旅行团',
    'travel_agency': '旅行社',
    'guide': '导游',
    'todo_recipient': '待办事项',
    'operation_log': '操作日志',
    'system_setting': '系统设置',
    'daily_reconciliation': '对账记录',
    'commission_record': '提成记录',
    'commission_rule': '提成规则',
    'agency_rebate_rule': '旅行社返点规则',
    'agency_deduction_rule': '旅行社扣单规则',
    'sales_deduction_rule': '销售扣单规则',
    'travel_group_finance_summary': '旅游团财务记录',
    'serialized_inventory_batch': '库存批次',
    'serialized_inventory_unit': '库存商品',
    'serialized_inventory_export': '库存导出文件',
    'strike_bonus_award': '奖励记录',
    'analytics_overview': '经营数据',
    'analytics_sales_performance': '销售业绩',
    'analytics_taster_ranking': '品鉴师排行',
    'request': '系统请求',
    'system': '系统数据',
  };

  static const _operationTypeLabels = <String, String>{
    'CREATE': '新增',
    'READ': '查看',
    'UPDATE': '修改',
    'DELETE': '删除',
    'LOGIN': '登录',
    'LOGOUT': '退出登录',
    'IMPORT': '导入',
    'EXPORT': '导出',
    'UPLOAD': '上传',
    'DOWNLOAD': '下载',
    'REVIEW': '审核',
    'STATUS_CHANGE': '状态变更',
    'OTHER': '其他操作',
  };

  static const _actionLabels = <String, String>{
    'list': '查看',
    'get': '查看',
    'detail': '查看',
    'read': '查看',
    'create': '新增',
    'add': '新增',
    'update': '修改',
    'edit': '修改',
    'sales_edit': '修改',
    'shipping_date.update': '修改发货信息',
    'upsert': '修改',
    'delete': '删除',
    'remove': '删除',
    'login': '登录',
    'login_failed': '登录',
    'logout': '退出登录',
    'enable': '启用',
    'disable': '停用',
    'export': '导出',
    'export_selected': '导出',
    'import': '导入',
    'approve': '审核通过',
    'reject': '审核不通过',
    'review': '审核',
    'upload': '上传',
    'download': '下载',
    'archive': '归档',
    'restore': '恢复',
    'refresh': '刷新',
    'not_entered.confirm': '确认未进店',
    'not_entered.revoke': '撤销未进店',
    'revoke': '撤销',
    'confirm': '确认',
    'send': '发送',
    'send_sms': '发送',
    'remind': '提醒',
    'recalculate': '重新计算',
    'recalculate_failed': '重新计算',
    'reset_password': '重置密码',
    'reset_password_to_default': '重置密码',
    'change_password': '修改密码',
    'authentication_failed': '登录失败',
    'authorization_failed': '权限校验失败',
    'generate': '生成',
    'regenerate': '重新生成',
    'trigger': '触发',
  };

  static const _valueLabels = <String, String>{
    'scheduled': '选择发货日期',
    'pending_customer_notice': '待客人通知',
    'SUCCESS': '成功',
    'FAILURE': '失败',
    'ACTIVE': '正常使用',
    'INACTIVE': '已停用',
    'ENABLED': '已启用',
    'DISABLED': '已停用',
    'PENDING': '待处理',
    'PROCESSING': '处理中',
    'COMPLETED': '已完成',
    'APPROVED': '已通过',
    'REJECTED': '未通过',
    'CANCELLED': '已取消',
    'VALID': '有效',
    'INVALID': '无效',
    'OLD': '原状态',
    'NEW': '新状态',
    'partial_refund': '部分退款',
    'refunded': '已退单',
    'cancelled': '已取消',
    'self_pickup': '自带',
    'shipping': '邮寄',
    'super_admin': '超级管理员',
    'admin': '管理员',
    'boss': '老板',
    'front_desk': '前台',
    'sales': '销售',
    'finance': '财务',
    'warehouse': '库管',
    'after_sales': '售后',
    'taster': '品鉴师',
  };

  static String moduleLabel(String? moduleOrAction) {
    final raw = (moduleOrAction ?? '').trim();
    final module = raw.contains('.') ? raw.split('.').first : raw;
    final normalized = _normalizeCode(module);
    return moduleLabels[normalized] ?? _readableCode(normalized, suffix: '业务');
  }

  static String operationLabel(String? operationType, String action) {
    final normalizedAction = _normalizeCode(action);
    final segments = normalizedAction.split('.');
    final candidates = <String>[
      if (segments.length >= 2)
        '${segments[segments.length - 2]}.${segments.last}',
      if (segments.isNotEmpty) segments.last,
    ];
    if (normalizedAction.endsWith('.summary.list')) return '查看';
    for (final candidate in candidates) {
      final label = _actionLabels[candidate];
      if (label != null) return label;
    }
    for (final entry in _actionLabels.entries) {
      if (normalizedAction.endsWith('.${entry.key}') ||
          normalizedAction.endsWith('_${entry.key}')) {
        return entry.value;
      }
    }
    for (final segment in segments.reversed) {
      final label = _actionLabels[segment];
      if (label != null) return label;
    }
    return _operationTypeLabels[(operationType ?? '').toUpperCase()] ?? '其他操作';
  }

  static OperationLogDisplay present(OperationLogEntry log) {
    final actor = _actor(log);
    final module = moduleLabel(log.module ?? log.action);
    final operation = operationLabel(log.operationType, log.action);
    final object = _objectLabel(log, module);
    final comparisons = _comparisonRows(log);
    final isRead = operation == '查看';
    final isImportant = _isImportant(log, operation, comparisons);
    final result = log.result == 'SUCCESS' ? '成功' : '失败';
    final summary = _summary(
      log,
      actor: actor,
      operation: operation,
      object: object,
      comparisons: comparisons,
    );
    return OperationLogDisplay(
      actor: actor,
      module: module,
      operation: operation,
      object: object,
      summary: summary,
      result: result,
      detailKind: _detailKind(operation),
      sections: _detailSections(log, operation),
      comparisons: comparisons,
      isRead: isRead,
      isImportant: isImportant,
      failureReason: log.result == 'SUCCESS' ? null : _failureReason(log),
    );
  }

  static String formatDateTime(DateTime value) {
    final local = value.toLocal();
    final minute = local.minute.toString().padLeft(2, '0');
    final second = local.second.toString().padLeft(2, '0');
    return '${local.year}年${local.month}月${local.day}日 '
        '${local.hour.toString().padLeft(2, '0')}:$minute:$second';
  }

  static String fieldLabel(String key) {
    final segments = key.split('.');
    return segments
        .map((segment) =>
            fieldLabels[segment] ?? _readableCode(segment, suffix: '内容'))
        .join(' / ');
  }

  static String formatValue(
    String field,
    dynamic value, {
    String? module,
  }) {
    if (value == null || (value is String && value.trim().isEmpty)) {
      return '未填写';
    }
    final normalizedField = _normalizeKey(field);
    if (value is bool) {
      if (normalizedField.contains('active') ||
          normalizedField.contains('enabled')) {
        return value ? '已启用' : '已停用';
      }
      return value ? '是' : '否';
    }
    if (value is num) {
      if (normalizedField == 'page') return '第 ${_plainNumber(value)} 页';
      if (normalizedField == 'pagesize') {
        return '${_plainNumber(value)} 条';
      }
      if (normalizedField == 'returnedcount') {
        return '${_plainNumber(value)} 条记录';
      }
      if (normalizedField == 'exportedcount') {
        return '${_plainNumber(value)} 条记录';
      }
      if (_isMoneyField(normalizedField)) {
        final amount = normalizedField.endsWith('cents') ? value / 100 : value;
        return '${_numberWithCommas(amount)} 元';
      }
      if (normalizedField.contains('stock') ||
          normalizedField.contains('quantity')) {
        return '${_plainNumber(value)} 件';
      }
      if (normalizedField.endsWith('count')) {
        return '${_plainNumber(value)} 条';
      }
      return _plainNumber(value);
    }
    if (value is DateTime) return formatDateTime(value);
    if (value is List) {
      if (value.isEmpty) return '未填写';
      final visible = value
          .take(20)
          .map((item) => formatValue(field, item, module: module))
          .join('、');
      return value.length > 20 ? '$visible 等 ${value.length} 项' : visible;
    }
    if (value is Map) {
      final rows = _fieldRows(value, module: module);
      return rows.isEmpty
          ? '未填写'
          : rows.map((row) => '${row.label}：${row.value}').join('；');
    }

    final text = '$value'.trim();
    if (_looksLikePhone(text) ||
        normalizedField.contains('phone') ||
        normalizedField.contains('mobile')) {
      return _maskPhone(text);
    }
    if (normalizedField.contains('idcard') ||
        normalizedField.contains('identity')) {
      return _maskIdentity(text);
    }
    if (_isDateField(normalizedField) || _looksLikeIsoDate(text)) {
      final parsed = DateTime.tryParse(text);
      if (parsed != null) return formatDateTime(parsed);
    }
    final semanticEnum = normalizedField.contains('role') ||
        normalizedField.contains('status') ||
        normalizedField.endsWith('type') ||
        normalizedField.endsWith('category') ||
        normalizedField.endsWith('mode') ||
        normalizedField.endsWith('result') ||
        normalizedField.endsWith('source');
    final direct = semanticEnum
        ? _valueLabels[text] ?? _valueLabels[text.toUpperCase()]
        : _valueLabels[text.toUpperCase()];
    if (direct != null) {
      if (text.toUpperCase() == 'ACTIVE' &&
          _normalizeCode(module ?? '').contains('todo_reminders')) {
        return '处理中';
      }
      return direct;
    }
    if (semanticEnum && RegExp(r'^[A-Za-z][A-Za-z0-9_-]*$').hasMatch(text)) {
      return _readableCode(text, suffix: '其他');
    }
    if (RegExp(r'^[A-Z][A-Z0-9_]*$').hasMatch(text)) {
      return _readableCode(text, suffix: '状态');
    }
    return text;
  }

  static bool isSensitiveField(String key) {
    final normalized = _normalizeKey(key);
    return normalized == 'password' ||
        normalized.endsWith('password') ||
        normalized.contains('passwordhash') ||
        normalized == 'token' ||
        normalized.endsWith('token') ||
        normalized.contains('refreshtoken') ||
        normalized.contains('accesstoken') ||
        normalized == 'cookie' ||
        normalized.endsWith('cookie') ||
        normalized == 'secret' ||
        normalized.endsWith('secret') ||
        normalized.contains('authorization') ||
        normalized.contains('privatekey') ||
        normalized == 'key' ||
        normalized.endsWith('secretkey') ||
        normalized.endsWith('signingkey') ||
        normalized.endsWith('encryptionkey') ||
        normalized.contains('apikey') ||
        normalized.contains('verificationcode') ||
        normalized.contains('smscode') ||
        normalized.contains('resetcode') ||
        normalized.contains('captcha') ||
        normalized.contains('credential');
  }

  static String _actor(OperationLogEntry log) {
    final name = log.actorNameSnapshot?.trim();
    if (name != null && name.isNotEmpty) return name;
    final username = log.actorUsernameSnapshot?.trim();
    return username == null || username.isEmpty ? '未知操作人' : username;
  }

  static String _objectLabel(OperationLogEntry log, String module) {
    final action = _normalizeCode(log.action);
    if (action == 'todo_reminders.list') return '待办事项列表';
    if (action == 'todo_reminders.summary.list') return '待办事项汇总';
    if (action.startsWith('auth.login')) return '管理后台';
    if (action == 'operation_logs.list') return '操作日志列表';
    if (action == 'operation_logs.filter_options') return '操作日志筛选项';

    final data = _combinedData(log);
    final productName = _findValue(data, const [
      'productName',
      'product_name',
      'name',
    ]);
    if (_normalizeCode(log.entityType) == 'product' && productName != null) {
      return '商品“${formatValue('productName', productName)}”';
    }
    final orderNo = _findValue(data, const [
      'orderNo',
      'salesOrderNo',
      'afterSalesNo',
    ]);
    if (orderNo != null && _normalizeCode(log.entityType).contains('order')) {
      return '${_entityLabel(log.entityType)}“$orderNo”';
    }
    final groupNo = _findValue(data, const ['groupNo', 'travelGroupNo']);
    if (groupNo != null &&
        _normalizeCode(log.entityType).contains('travel_group')) {
      return '旅行团“$groupNo”';
    }
    final customerName = _findValue(data, const ['customerName', 'name']);
    if (customerName != null && _normalizeCode(log.entityType) == 'customer') {
      return '客户“$customerName”';
    }
    final entity = _entityLabel(log.entityType);
    final entityId = log.entityId?.trim();
    if (entityId != null && entityId.isNotEmpty) {
      return '$entity（编号：$entityId）';
    }
    if (action.endsWith('.list')) return '$module列表';
    if (action.contains('export')) return '$module数据';
    return entity == '业务内容' ? '$module内容' : entity;
  }

  static String _summary(
    OperationLogEntry log, {
    required String actor,
    required String operation,
    required String object,
    required List<OperationLogComparison> comparisons,
  }) {
    final action = _normalizeCode(log.action);
    if (action == 'todo_reminders.list') {
      return _withResult(log, '$actor查看了待办事项列表');
    }
    if (action == 'todo_reminders.summary.list') {
      return _withResult(log, '$actor查看了待办事项汇总');
    }
    if (action.startsWith('auth.login')) {
      final username = _findValue(_combinedData(log), const [
            'username',
            'loginIdentifier',
          ]) ??
          log.actorUsernameSnapshot ??
          '该';
      final outcome = log.result == 'SUCCESS' ? '登录成功' : '登录失败';
      return '$actor使用 $username 账号登录了管理后台，$outcome。';
    }
    if (operation == '修改' || operation == '状态变更') {
      if (log.result != 'SUCCESS') {
        return '$actor尝试修改$object，但操作失败。';
      }
      final changed = comparisons.where((row) => row.changed).toList();
      if (changed.isEmpty) return '$actor修改了$object。';
      if (changed.length == 1) {
        final row = changed.single;
        return '$actor将$object的${row.label}从 ${row.before} 修改为 ${row.after}。';
      }
      return '$actor修改了$object，共修改了 ${changed.length} 项内容。';
    }
    if (operation == '导出') {
      final count = _findValue(_combinedData(log), const [
        'exportedCount',
        'returnedCount',
        'count',
      ]);
      final countText = count == null
          ? ''
          : '，共 ${formatValue('exportedCount', count, module: log.module)}';
      return _withResult(log, '$actor导出了$object$countText');
    }
    final verb = switch (operation) {
      '新增' => '新增了',
      '删除' => '删除了',
      '查看' => '查看了',
      '退出登录' => '退出了',
      '启用' => '启用了',
      '停用' => '停用了',
      '导入' => '导入了',
      '上传' => '上传了',
      '下载' => '下载了',
      '审核通过' => '审核通过了',
      '审核不通过' => '审核未通过',
      '审核' => '审核了',
      '归档' => '归档了',
      '恢复' => '恢复了',
      '重置密码' => '重置了',
      _ => '处理了',
    };
    return _withResult(log, '$actor$verb$object');
  }

  static String _withResult(OperationLogEntry log, String successText) {
    if (log.result == 'SUCCESS') return '$successText。';
    final operation = operationLabel(log.operationType, log.action);
    final attempted = successText.replaceFirst('了', '');
    if (operation == '查看') return '$attempted，但查看失败。';
    return '$attempted，但操作失败。';
  }

  static List<OperationLogComparison> _comparisonRows(
    OperationLogEntry log,
  ) {
    final before = _flatten(log.beforeData);
    final after = _flatten(log.afterData);
    final keys = <String>{}
      ..addAll(before.keys)
      ..addAll(after.keys);
    return keys.where((key) => !isSensitiveField(key)).map((key) {
      final beforeText = formatValue(
        key,
        before[key],
        module: log.module ?? log.action,
      );
      final afterText = formatValue(
        key,
        after[key],
        module: log.module ?? log.action,
      );
      return OperationLogComparison(
        label: _contextualFieldLabel(
          key,
          log.module ?? log.action,
        ),
        before: beforeText,
        after: afterText,
        changed: !_valuesEqual(before[key], after[key]),
      );
    }).toList(growable: false);
  }

  static List<OperationLogDetailSection> _detailSections(
    OperationLogEntry log,
    String operation,
  ) {
    final sections = <OperationLogDetailSection>[];
    void add(String title, List<OperationLogFieldValue> rows) {
      if (rows.isNotEmpty) {
        sections.add(OperationLogDetailSection(title: title, rows: rows));
      }
    }

    if (operation == '登录') {
      final data = _combinedData(log);
      final username = _findValue(data, const [
            'username',
            'loginIdentifier',
          ]) ??
          log.actorUsernameSnapshot;
      final role = _findValue(data, const ['role']) ?? log.actorRoleSnapshot;
      add('登录信息', [
        if (username != null)
          OperationLogFieldValue(
            label: '登录账号',
            value: formatValue('username', username),
          ),
        if (role != null)
          OperationLogFieldValue(
            label: '管理员身份',
            value: formatValue('role', role),
          ),
        OperationLogFieldValue(
          label: '登录结果',
          value: log.result == 'SUCCESS' ? '成功' : '失败',
        ),
        OperationLogFieldValue(
          label: '登录时间',
          value: formatDateTime(log.createdAt),
        ),
      ]);
      return sections;
    }

    final conditions = _requestConditionRows(log);
    final resultRows = _requestResultRows(log);
    if (operation == '查看') {
      add('查看条件', conditions);
      add('查看结果', resultRows);
      return sections;
    }
    if (operation == '新增') {
      add('新增内容', _fieldRows(log.afterData, module: log.module));
      return sections;
    }
    if (operation == '删除') {
      final deleted =
          _hasVisibleData(log.beforeData) ? log.beforeData : log.afterData;
      add('删除内容', _fieldRows(deleted, module: log.module));
      return sections;
    }
    if (operation == '导出') {
      add('导出条件', conditions);
      add(
        '导出结果',
        _mergeRows(
          resultRows,
          _fieldRows(log.afterData, module: log.module),
        ),
      );
      return sections;
    }
    if (operation.startsWith('审核')) {
      add('审核前', _fieldRows(log.beforeData, module: log.module));
      add('审核后', _fieldRows(log.afterData, module: log.module));
      return sections;
    }
    if (operation != '修改' && operation != '状态变更') {
      add('操作内容', _fieldRows(log.afterData, module: log.module));
    }
    return sections;
  }

  static List<OperationLogFieldValue> _requestConditionRows(
    OperationLogEntry log,
  ) {
    final summary = _map(log.requestSummary);
    final filters = summary['filters'];
    if (filters is Map) {
      return _fieldRows(filters, module: log.module);
    }
    final direct = Map<String, dynamic>.from(summary)
      ..remove('filterKeys')
      ..remove('bodyKeys')
      ..remove('returnedCount')
      ..remove('loginIdentifier');
    return _fieldRows(direct, module: log.module);
  }

  static List<OperationLogFieldValue> _requestResultRows(
    OperationLogEntry log,
  ) {
    final summary = _map(log.requestSummary);
    if (summary.containsKey('returnedCount')) {
      return [
        OperationLogFieldValue(
          label: '本次找到',
          value: formatValue(
            'returnedCount',
            summary['returnedCount'],
            module: log.module,
          ),
        ),
      ];
    }
    return const [];
  }

  static List<OperationLogFieldValue> _fieldRows(
    dynamic value, {
    String? module,
  }) {
    final flattened = _flatten(value);
    return flattened.entries
        .where((entry) => !isSensitiveField(entry.key))
        .map(
          (entry) => OperationLogFieldValue(
            label: _contextualFieldLabel(entry.key, module),
            value: formatValue(entry.key, entry.value, module: module),
          ),
        )
        .toList(growable: false);
  }

  static Map<String, dynamic> _flatten(
    dynamic value, {
    String prefix = '',
  }) {
    if (value is! Map) return const {};
    final flattened = <String, dynamic>{};
    for (final entry in value.entries) {
      final key = '$prefix${entry.key}';
      if (isSensitiveField(key)) continue;
      final child = entry.value;
      if (child is Map && child.isNotEmpty) {
        flattened.addAll(_flatten(child, prefix: '$key.'));
      } else {
        flattened[key] = child;
      }
    }
    return flattened;
  }

  static dynamic _combinedData(OperationLogEntry log) {
    return {
      ..._map(log.requestSummary),
      ..._map(log.beforeData),
      ..._map(log.afterData),
    };
  }

  static dynamic _findValue(dynamic value, List<String> keys) {
    if (value is Map) {
      for (final entry in value.entries) {
        if (keys.any(
          (key) => _normalizeKey(key) == _normalizeKey('${entry.key}'),
        )) {
          final candidate = entry.value;
          if (candidate != null && '$candidate'.trim().isNotEmpty) {
            return candidate;
          }
        }
      }
      for (final child in value.values) {
        final found = _findValue(child, keys);
        if (found != null) return found;
      }
    } else if (value is List) {
      for (final child in value) {
        final found = _findValue(child, keys);
        if (found != null) return found;
      }
    }
    return null;
  }

  static OperationLogDetailKind _detailKind(String operation) {
    if (operation == '查看') return OperationLogDetailKind.read;
    if (operation == '新增') return OperationLogDetailKind.create;
    if (operation == '修改' || operation == '状态变更') {
      return OperationLogDetailKind.update;
    }
    if (operation == '删除') return OperationLogDetailKind.delete;
    if (operation == '登录') return OperationLogDetailKind.login;
    if (operation == '导出') return OperationLogDetailKind.export;
    if (operation.startsWith('审核')) return OperationLogDetailKind.review;
    return OperationLogDetailKind.other;
  }

  static bool _isImportant(
    OperationLogEntry log,
    String operation,
    List<OperationLogComparison> comparisons,
  ) {
    if (operation == '删除' ||
        operation.startsWith('审核') ||
        operation.contains('密码')) {
      return true;
    }
    final action = _normalizeKey(log.action);
    if (action.contains('permission') ||
        action.contains('role') ||
        action.contains('finance') ||
        action.contains('amount') ||
        action.contains('price') ||
        action.contains('revoke')) {
      return true;
    }
    return comparisons.any((row) {
      final label = row.label;
      return row.changed &&
          (label.contains('金额') ||
              label.contains('价格') ||
              label.contains('权限') ||
              label.contains('身份'));
    });
  }

  static String _failureReason(OperationLogEntry log) {
    final code = (log.errorCode ?? '').toUpperCase();
    const labels = <String, String>{
      'NOT_FOUND': '未找到要操作的内容',
      'UNAUTHORIZED': '登录状态已失效',
      'FORBIDDEN': '当前账号没有操作权限',
      'INVALID_CREDENTIALS': '登录账号或密码不正确',
      'ACCOUNT_DISABLED': '该账号已停用',
      'VALIDATION_FAILED': '填写的内容不符合要求',
      'CONFLICT': '数据已发生变化，请刷新后重试',
    };
    for (final entry in labels.entries) {
      if (code.contains(entry.key)) return entry.value;
    }
    final message = log.errorMessage?.trim();
    if (message != null &&
        message.isNotEmpty &&
        RegExp(r'[\u4e00-\u9fff]').hasMatch(message) &&
        !message.contains(RegExp(r'[/{}[\]<>]')) &&
        !RegExp(r'\b(GET|POST|PUT|PATCH|DELETE|HTTP)\b').hasMatch(message)) {
      return message;
    }
    return '操作未完成，请核对业务内容或联系系统管理员';
  }

  static String _entityLabel(String raw) {
    final normalized = _normalizeCode(raw);
    return _entityLabels[normalized] ??
        _readableCode(normalized, suffix: '业务内容');
  }

  static String _contextualFieldLabel(String key, String? module) {
    if (_normalizeKey(key.split('.').last) == 'status' &&
        _normalizeCode(module ?? '').contains('todo_reminders')) {
      return '待办状态';
    }
    return fieldLabel(key);
  }

  static String _readableCode(String raw, {required String suffix}) {
    final normalized = _normalizeCode(raw);
    if (normalized.isEmpty) return suffix;
    const tokens = <String, String>{
      'after': '售后',
      'sales': '销售',
      'order': '订单',
      'orders': '订单',
      'travel': '旅游',
      'group': '团',
      'groups': '团',
      'finance': '财务',
      'summary': '汇总',
      'summaries': '汇总',
      'customer': '客户',
      'customers': '客户',
      'product': '商品',
      'products': '商品',
      'goods': '商品',
      'user': '用户',
      'users': '用户',
      'setting': '设置',
      'settings': '设置',
      'todo': '待办',
      'reminders': '提醒',
      'analytics': '数据统计',
      'commission': '提成',
      'records': '记录',
      'rules': '规则',
      'inventory': '库存',
      'warehouse': '仓库',
      'guide': '导游',
      'guides': '导游',
      'agency': '旅行社',
      'agencies': '旅行社',
      'reconciliation': '对账',
      'reconciliations': '对账',
      'operation': '操作',
      'logs': '日志',
      'security': '安全',
      'system': '系统',
      'daily': '每日',
      'status': '状态',
      'payment': '付款',
      'delivery': '配送',
      'review': '审核',
      'active': '启用',
      'type': '类型',
      'category': '分类',
      'mark': '标记',
      'bonus': '奖励',
      'awards': '记录',
      'serialized': '序列化',
      'data': '数据',
      'business': '业务',
      'id': '编号',
      'no': '编号',
      'code': '编码',
      'actual': '实际',
      'cost': '成本',
      'cents': '',
      'total': '合计',
      'amount': '金额',
      'unit': '单位',
      'price': '价格',
      'name': '名称',
      'created': '创建',
      'updated': '修改',
      'at': '时间',
      'date': '日期',
      'time': '时间',
      'is': '',
      'number': '数量',
      'quantity': '数量',
      'stock': '库存',
      'phone': '手机',
      'mobile': '手机',
      'address': '地址',
      'contact': '联系人',
      'remark': '备注',
      'remarks': '备注',
      'marked': '标记',
      'by': '操作人',
      'tracking': '物流',
      'attachment': '附件',
      'attachments': '附件',
      'file': '文件',
      'source': '来源',
      'target': '对象',
      'enabled': '启用',
      'overview': '概览',
      'performance': '业绩',
      'ranking': '排行',
      'taster': '品鉴师',
    };
    final translated = normalized
        .split(RegExp(r'[_\s]+'))
        .map((token) => tokens[token])
        .whereType<String>()
        .join();
    return translated.isEmpty ? suffix : translated;
  }

  static Map<String, dynamic> _map(dynamic value) {
    if (value is! Map) return const {};
    return value.map((key, child) => MapEntry('$key', child));
  }

  static bool _hasVisibleData(dynamic value) => _flatten(value).isNotEmpty;

  static List<OperationLogFieldValue> _mergeRows(
    List<OperationLogFieldValue> first,
    List<OperationLogFieldValue> second,
  ) {
    final rows = <String, OperationLogFieldValue>{};
    for (final row in [...first, ...second]) {
      rows[row.label] = row;
    }
    return rows.values.toList(growable: false);
  }

  static bool _valuesEqual(dynamic left, dynamic right) {
    if (left is num && right is num) return left == right;
    if (left is DateTime || right is DateTime) {
      return DateTime.tryParse('$left') == DateTime.tryParse('$right');
    }
    return '$left' == '$right';
  }

  static String _normalizeCode(String value) {
    return value
        .replaceAllMapped(
          RegExp(r'([a-z0-9])([A-Z])'),
          (match) => '${match.group(1)}_${match.group(2)}',
        )
        .replaceAll('-', '_')
        .trim()
        .toLowerCase();
  }

  static String _normalizeKey(String value) =>
      _normalizeCode(value).replaceAll(RegExp(r'[^a-z0-9]'), '');

  static bool _isMoneyField(String field) {
    return field.contains('price') ||
        field.contains('amount') ||
        field.contains('cost') ||
        field.endsWith('fee') ||
        field.endsWith('feecents');
  }

  static bool _isDateField(String field) {
    return field.endsWith('at') ||
        field.endsWith('time') ||
        field.endsWith('date');
  }

  static bool _looksLikeIsoDate(String value) {
    return RegExp(r'^\d{4}-\d{2}-\d{2}(?:T|\s)').hasMatch(value);
  }

  static bool _looksLikePhone(String value) =>
      RegExp(r'^1\d{10}$').hasMatch(value.replaceAll(RegExp(r'\D'), ''));

  static String _maskPhone(String value) {
    final digits = value.replaceAll(RegExp(r'\D'), '');
    if (digits.length < 7) return '已脱敏';
    return '${digits.substring(0, 3)}****${digits.substring(digits.length - 4)}';
  }

  static String _maskIdentity(String value) {
    final normalized = value.trim();
    if (normalized.length < 8) return '已脱敏';
    return '${normalized.substring(0, 3)}***********'
        '${normalized.substring(normalized.length - 4)}';
  }

  static String _plainNumber(num value) {
    return value % 1 == 0 ? value.toInt().toString() : value.toString();
  }

  static String _numberWithCommas(num value) {
    final fixed =
        value % 1 == 0 ? value.toInt().toString() : value.toStringAsFixed(2);
    final parts = fixed.split('.');
    final chars = parts.first.split('').reversed.toList();
    final grouped = <String>[];
    for (var index = 0; index < chars.length; index += 1) {
      if (index > 0 && index % 3 == 0) grouped.add(',');
      grouped.add(chars[index]);
    }
    final integer = grouped.reversed.join();
    return parts.length == 1 ? integer : '$integer.${parts.last}';
  }
}

String? _string(dynamic value) {
  if (value == null) return null;
  final normalized = '$value'.trim();
  return normalized.isEmpty ? null : normalized;
}

int? _nullableInt(dynamic value) =>
    value == null ? null : int.tryParse('$value');
