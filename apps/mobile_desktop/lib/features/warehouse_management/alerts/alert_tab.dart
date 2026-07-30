part of '../inventory_workspace_tabs.dart';

class WarehouseAlertNavigationRequest {
  const WarehouseAlertNavigationRequest(this.moduleId);
  final String moduleId;
}

class AlertTab extends StatefulWidget {
  const AlertTab({
    super.key,
    required this.api,
    required this.businessApi,
    required this.role,
    required this.onNavigate,
  });

  final InventoryApi api;
  final BusinessApi businessApi;
  final UserRole role;
  final ValueChanged<WarehouseAlertNavigationRequest> onNavigate;

  @override
  State<AlertTab> createState() => _AlertTabState();
}

class _AlertTabState extends State<AlertTab> {
  static const _quantityAlertTypes = <String>[
    'LOW_STOCK',
    'NEGATIVE_AVAILABLE',
    'ORDER_SHORTAGE',
    'TRANSFER_OVERDUE',
  ];
  static const _allAlertTypes = <String>[
    'LOW_STOCK',
    'NEGATIVE_AVAILABLE',
    'ORDER_SHORTAGE',
    'PENDING_COST',
    'TRANSFER_OVERDUE',
    'STOCKTAKE_APPROVAL',
  ];

  List<WarehouseRecord> _warehouses = const [];
  List<ProductOptionRecord> _products = const [];
  ReportResult? _activityResult;
  AlertConfigPage? _configPage;
  bool _activityLoading = true;
  bool _configLoading = true;
  bool _optionsLoading = true;
  String? _activityError;
  String? _configError;
  String? _optionsError;
  String? _warehouseId;
  String? _productId;
  String? _alertType;
  String? _status = 'ACTIVE';
  int _activityPage = 1;
  int _configListPage = 1;
  int _activityGeneration = 0;
  int _configGeneration = 0;
  String? _updatingConfigId;

  bool get _canManageRules => canManageWarehouse(widget.role);
  bool get _showRules => widget.role != UserRole.finance;

  List<String> get _allowedAlertTypes {
    return switch (widget.role) {
      UserRole.finance => const ['PENDING_COST'],
      UserRole.warehouse => _quantityAlertTypes,
      _ => _allAlertTypes,
    };
  }

  bool get _canSelectAllTypes =>
      widget.role == UserRole.superAdmin ||
      widget.role == UserRole.admin ||
      widget.role == UserRole.boss;

  @override
  void initState() {
    super.initState();
    if (!_canSelectAllTypes) _alertType = _allowedAlertTypes.first;
    _loadOptions();
    _loadActivity();
    if (_showRules) _loadConfigs();
  }

  Future<void> _loadOptions() async {
    setState(() {
      _optionsLoading = true;
      _optionsError = null;
    });
    try {
      final results = await Future.wait<dynamic>([
        widget.api.listWarehouses(isActive: true),
        widget.businessApi.listProductOptions(),
      ]);
      if (!mounted) return;
      setState(() {
        _warehouses = results[0] as List<WarehouseRecord>;
        _products = results[1] as List<ProductOptionRecord>;
        _optionsLoading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _optionsError = inventoryErrorMessage(error);
        _optionsLoading = false;
      });
    }
  }

  Future<void> _loadActivity() async {
    final generation = ++_activityGeneration;
    setState(() {
      _activityLoading = true;
      _activityError = null;
    });
    try {
      final filters = <String, String>{};
      _putAlertFilter(filters, 'warehouseId', _warehouseId);
      _putAlertFilter(filters, 'productId', _productId);
      _putAlertFilter(filters, 'alertType', _alertType);
      _putAlertFilter(filters, 'status', _status);
      final result = await widget.api.fetchReport(
        reportType: 'alerts',
        page: _activityPage,
        pageSize: 30,
        filters: filters,
      );
      if (!mounted || generation != _activityGeneration) return;
      setState(() {
        _activityResult = result;
        _activityLoading = false;
      });
    } catch (error) {
      if (!mounted || generation != _activityGeneration) return;
      setState(() {
        _activityError = inventoryErrorMessage(error);
        _activityLoading = false;
      });
    }
  }

  Future<void> _loadConfigs() async {
    final generation = ++_configGeneration;
    setState(() {
      _configLoading = true;
      _configError = null;
    });
    try {
      final result = await widget.api.listAlertConfigs(
        page: _configListPage,
        pageSize: 30,
        warehouseId: _warehouseId,
        productId: _productId,
      );
      if (!mounted || generation != _configGeneration) return;
      setState(() {
        _configPage = result;
        _configLoading = false;
      });
    } catch (error) {
      if (!mounted || generation != _configGeneration) return;
      setState(() {
        _configError = inventoryErrorMessage(error);
        _configLoading = false;
      });
    }
  }

  void _applyFilters() {
    setState(() {
      _activityPage = 1;
      _configListPage = 1;
    });
    _loadActivity();
    if (_showRules) _loadConfigs();
  }

  void _resetFilters() {
    setState(() {
      _warehouseId = null;
      _productId = null;
      _alertType = _canSelectAllTypes ? null : _allowedAlertTypes.first;
      _status = 'ACTIVE';
      _activityPage = 1;
      _configListPage = 1;
    });
    _loadActivity();
    if (_showRules) _loadConfigs();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        InventoryFilterBar(
          // Filter controls are intentionally listed before the action row.
          // ignore: sort_child_properties_last
          children: [
            SizedBox(
              key: const ValueKey('warehouse-alert-warehouse-filter'),
              width: 190,
              child: DropdownButtonFormField<String?>(
                key: ValueKey('alert-warehouse-${_warehouseId ?? 'all'}'),
                initialValue: _warehouseId,
                decoration: const InputDecoration(
                  labelText: '仓库',
                  isDense: true,
                ),
                items: [
                  const DropdownMenuItem(value: null, child: Text('全部仓库')),
                  ..._warehouses.map(
                    (item) => DropdownMenuItem(
                      value: item.id,
                      child: Text(item.name, overflow: TextOverflow.ellipsis),
                    ),
                  ),
                ],
                onChanged: _optionsLoading
                    ? null
                    : (value) => setState(() => _warehouseId = value),
              ),
            ),
            SizedBox(
              key: const ValueKey('warehouse-alert-product-filter'),
              width: 210,
              child: DropdownButtonFormField<String?>(
                key: ValueKey('alert-product-${_productId ?? 'all'}'),
                initialValue: _productId,
                decoration: const InputDecoration(
                  labelText: '商品',
                  isDense: true,
                ),
                items: [
                  const DropdownMenuItem(value: null, child: Text('全部商品')),
                  ..._products.map(
                    (item) => DropdownMenuItem(
                      value: item.id,
                      child: Text(item.name, overflow: TextOverflow.ellipsis),
                    ),
                  ),
                ],
                onChanged: _optionsLoading
                    ? null
                    : (value) => setState(() => _productId = value),
              ),
            ),
            SizedBox(
              key: const ValueKey('warehouse-alert-type-filter'),
              width: 180,
              child: DropdownButtonFormField<String?>(
                key: ValueKey('alert-type-${_alertType ?? 'all'}'),
                initialValue: _alertType,
                decoration: const InputDecoration(
                  labelText: '预警类型',
                  isDense: true,
                ),
                items: [
                  if (_canSelectAllTypes)
                    const DropdownMenuItem(
                      value: null,
                      child: Text('全部有权类型'),
                    ),
                  ..._allowedAlertTypes.map(
                    (type) => DropdownMenuItem(
                      value: type,
                      child: Text(_alertTypeLabel(type)),
                    ),
                  ),
                ],
                onChanged: widget.role == UserRole.finance
                    ? null
                    : (value) => setState(() => _alertType = value),
              ),
            ),
            SizedBox(
              key: const ValueKey('warehouse-alert-status-filter'),
              width: 150,
              child: DropdownButtonFormField<String?>(
                key: ValueKey('alert-status-${_status ?? 'all'}'),
                initialValue: _status,
                decoration: const InputDecoration(
                  labelText: '处理状态',
                  isDense: true,
                ),
                items: const [
                  DropdownMenuItem(value: null, child: Text('全部状态')),
                  DropdownMenuItem(value: 'ACTIVE', child: Text('处理中')),
                  DropdownMenuItem(value: 'RESOLVED', child: Text('已恢复')),
                  DropdownMenuItem(value: 'CANCELLED', child: Text('已取消')),
                ],
                onChanged: (value) => setState(() => _status = value),
              ),
            ),
            const SizedBox(
              width: 170,
              child: InputDecorator(
                decoration: InputDecoration(
                  labelText: '严重程度',
                  helperText: '等待服务端字段',
                  isDense: true,
                ),
                child: Text('暂未提供'),
              ),
            ),
          ],
          actions: [
            FilledButton.tonalIcon(
              key: const ValueKey('warehouse-alert-apply-filter'),
              onPressed: _activityLoading ? null : _applyFilters,
              icon: const Icon(Icons.filter_alt_rounded, size: 18),
              label: const Text('筛选'),
            ),
            OutlinedButton.icon(
              onPressed: _resetFilters,
              icon: const Icon(Icons.restart_alt_rounded, size: 18),
              label: const Text('重置'),
            ),
            OutlinedButton.icon(
              onPressed: () {
                _loadOptions();
                _loadActivity();
                if (_showRules) _loadConfigs();
              },
              icon: const Icon(Icons.refresh_rounded, size: 18),
              label: const Text('刷新'),
            ),
          ],
        ),
        if (_optionsError != null) ...[
          InventoryInlineNotice(
            message: '筛选选项加载失败：$_optionsError',
            tone: StatusTone.warning,
          ),
          const SizedBox(height: 8),
        ],
        const InventoryInlineNotice(
          key: ValueKey('warehouse-alert-severity-blocker'),
          message: '活动预警来自真实 alerts 报表。后端尚未返回“严重程度”，因此该条件不会在当前分页上做本地推断。',
          tone: StatusTone.info,
        ),
        const SizedBox(height: 8),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () async {
              await _loadActivity();
              if (_showRules) await _loadConfigs();
            },
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                _alertSectionHeader(
                  context,
                  title: '活动预警',
                  subtitle: '触发时间、真实状态、阈值与建议处理入口',
                ),
                SizedBox(height: 280, child: _buildActivityBody()),
                if (_showRules) ...[
                  const SizedBox(height: 16),
                  _alertSectionHeader(
                    context,
                    title: '最低库存规则',
                    subtitle: _canManageRules ? '管理员可维护阈值和启用状态' : '当前角色只读',
                    action: _canManageRules
                        ? FilledButton.tonalIcon(
                            key: const ValueKey(
                              'warehouse-alert-create-config',
                            ),
                            onPressed:
                                _warehouseId != null && _productId != null
                                    ? () => _editConfig()
                                    : null,
                            icon: const Icon(Icons.add_rounded, size: 18),
                            label: const Text('设置当前仓库商品'),
                          )
                        : null,
                  ),
                  SizedBox(height: 260, child: _buildConfigBody()),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildActivityBody() {
    if (_activityLoading && _activityResult == null) {
      return const LoadingState(title: '正在加载真实活动预警');
    }
    if (_activityError != null && _activityResult == null) {
      return ErrorState(title: _activityError!, onRetry: _loadActivity);
    }
    final result = _activityResult;
    if (result == null || result.rows.isEmpty) {
      return const EmptyState(title: '当前筛选下没有活动预警');
    }
    final records =
        result.rows.map(AlertRecord.fromReportRow).toList(growable: false);
    return LayoutBuilder(
      builder: (context, constraints) => Column(
        children: [
          Expanded(
            child: isDesktopWidth(constraints.maxWidth)
                ? _buildActivityTable(records)
                : _buildActivityCards(records),
          ),
          InventoryPagination(
            page: result.page,
            totalPages: result.totalPages,
            onPrevious: result.page > 1
                ? () {
                    setState(() => _activityPage--);
                    _loadActivity();
                  }
                : null,
            onNext: result.page < result.totalPages
                ? () {
                    setState(() => _activityPage++);
                    _loadActivity();
                  }
                : null,
          ),
        ],
      ),
    );
  }

  Widget _buildActivityTable(List<AlertRecord> records) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: SingleChildScrollView(
        child: DataTable(
          key: const ValueKey('warehouse-alert-activity-table'),
          columns: const [
            DataColumn(label: Text('预警类型')),
            DataColumn(label: Text('仓库')),
            DataColumn(label: Text('商品')),
            DataColumn(label: Text('当前状态')),
            DataColumn(label: Text('实际可售')),
            DataColumn(label: Text('短缺')),
            DataColumn(label: Text('阈值')),
            DataColumn(label: Text('触发时间')),
            DataColumn(label: Text('建议动作')),
          ],
          rows: records
              .map(
                (record) => DataRow(
                  cells: [
                    DataCell(_alertTypeTag(record.type)),
                    DataCell(Text(record.warehouseName)),
                    DataCell(Text(record.productName)),
                    DataCell(_alertStatusTag(record.status)),
                    DataCell(_nullableBottleText(record.availableQty)),
                    DataCell(_nullableBottleText(record.shortageQty)),
                    DataCell(_nullableBottleText(record.minimumAvailableQty)),
                    DataCell(
                      Text(formatInventoryDateTime(record.firstDetectedAt)),
                    ),
                    DataCell(_alertAction(record)),
                  ],
                ),
              )
              .toList(),
        ),
      ),
    );
  }

  Widget _buildActivityCards(List<AlertRecord> records) {
    return ListView.separated(
      key: const ValueKey('warehouse-alert-activity-cards'),
      itemCount: records.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (context, index) {
        final record = records[index];
        return Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    _alertTypeTag(record.type),
                    const Spacer(),
                    _alertStatusTag(record.status),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  '${record.productName} · ${record.warehouseName}',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 6),
                Text(
                  '实际可售 ${_nullableBottleLabel(record.availableQty)}'
                  ' · 短缺 ${_nullableBottleLabel(record.shortageQty)}',
                ),
                Text(
                  '阈值 ${_nullableBottleLabel(record.minimumAvailableQty)}'
                  ' · 触发 ${formatInventoryDateTime(record.firstDetectedAt)}',
                ),
                Align(
                  alignment: Alignment.centerRight,
                  child: _alertAction(record),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildConfigBody() {
    if (_configLoading && _configPage == null) {
      return const LoadingState(title: '正在加载最低库存规则');
    }
    if (_configError != null && _configPage == null) {
      return ErrorState(title: _configError!, onRetry: _loadConfigs);
    }
    final page = _configPage;
    if (page == null || page.configs.isEmpty) {
      return const EmptyState(title: '当前筛选下暂无最低库存规则');
    }
    return Column(
      children: [
        Expanded(
          child: ListView.separated(
            itemCount: page.configs.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, index) {
              final config = page.configs[index];
              final busy = _updatingConfigId == config.id;
              return ListTile(
                key: ValueKey('warehouse-alert-tile-${config.id}'),
                title: Text(
                  '${config.warehouseName} · ${config.productName}',
                ),
                subtitle: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('最低可售：${config.minimumAvailableQty} 瓶'),
                    Text(
                      '最近修改：${formatInventoryDateTime(config.updatedAt)}',
                    ),
                  ],
                ),
                isThreeLine: true,
                trailing: _canManageRules
                    ? Wrap(
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          IconButton(
                            tooltip: '编辑最低库存',
                            onPressed:
                                busy ? null : () => _editConfig(config: config),
                            icon: const Icon(Icons.edit_outlined),
                          ),
                          Switch(
                            key: ValueKey(
                              'warehouse-alert-toggle-${config.id}',
                            ),
                            value: config.enabled,
                            onChanged:
                                busy ? null : (value) => _toggle(config, value),
                          ),
                        ],
                      )
                    : InventoryStatusTag(
                        label: config.enabled ? '已启用' : '已停用',
                        tone: config.enabled
                            ? StatusTone.success
                            : StatusTone.neutral,
                      ),
              );
            },
          ),
        ),
        InventoryPagination(
          page: page.page,
          totalPages: page.totalPages,
          onPrevious: page.page > 1
              ? () {
                  setState(() => _configListPage--);
                  _loadConfigs();
                }
              : null,
          onNext: page.page < page.totalPages
              ? () {
                  setState(() => _configListPage++);
                  _loadConfigs();
                }
              : null,
        ),
      ],
    );
  }

  Widget _alertAction(AlertRecord record) {
    final moduleId = switch (record.type) {
      'LOW_STOCK' || 'NEGATIVE_AVAILABLE' => 'stock',
      'PENDING_COST' => 'inbound',
      'ORDER_SHORTAGE' => 'fulfillment',
      'TRANSFER_OVERDUE' => 'transfer',
      'STOCKTAKE_APPROVAL' => 'approval',
      _ => null,
    };
    if (moduleId == null) return const Text('—');
    return TextButton.icon(
      key: ValueKey('warehouse-alert-action-${record.id}'),
      onPressed: () =>
          widget.onNavigate(WarehouseAlertNavigationRequest(moduleId)),
      icon: const Icon(Icons.arrow_forward_rounded, size: 16),
      label: Text(_alertActionLabel(record.type)),
    );
  }

  Future<void> _toggle(AlertConfigRecord config, bool enabled) async {
    final confirmed = await confirmInventoryAction(
      context,
      title: enabled ? '启用最低库存预警？' : '停用最低库存预警？',
      content: enabled ? '启用后将按服务端阈值产生真实预警。' : '停用后该仓库商品不再按最低库存阈值触发预警。',
      confirmLabel: enabled ? '确认启用' : '确认停用',
      danger: !enabled,
    );
    if (!confirmed || !mounted) return;
    setState(() => _updatingConfigId = config.id);
    try {
      await widget.api.updateAlertConfig(
        warehouseId: config.warehouseId,
        productId: config.productId,
        enabled: enabled,
      );
      await Future.wait([_loadConfigs(), _loadActivity()]);
    } catch (error) {
      if (mounted) _showSnack(inventoryErrorMessage(error));
    } finally {
      if (mounted) setState(() => _updatingConfigId = null);
    }
  }

  Future<void> _editConfig({AlertConfigRecord? config}) async {
    final warehouseId = config?.warehouseId ?? _warehouseId;
    final productId = config?.productId ?? _productId;
    if (warehouseId == null || productId == null) {
      _showSnack('请先选择单个仓库和商品。');
      return;
    }
    final controller = TextEditingController(
      text: config?.minimumAvailableQty.toString() ?? '',
    );
    String? fieldError;
    var submitting = false;
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(config == null ? '设置最低库存' : '编辑最低库存'),
          content: TextField(
            key: const ValueKey('warehouse-alert-minimum-field'),
            controller: controller,
            autofocus: true,
            enabled: !submitting,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: InputDecoration(
              labelText: '最低可售（瓶）',
              errorText: fieldError,
              helperText: '允许 0，只接受整数。',
            ),
          ),
          actions: [
            TextButton(
              onPressed:
                  submitting ? null : () => Navigator.pop(dialogContext, false),
              child: const Text('取消'),
            ),
            FilledButton(
              key: const ValueKey('warehouse-alert-minimum-submit'),
              onPressed: submitting
                  ? null
                  : () async {
                      final minimum = parseNonNegativeInt(controller.text);
                      if (minimum == null) {
                        setDialogState(() => fieldError = '请输入 0 或正整数');
                        return;
                      }
                      setDialogState(() {
                        fieldError = null;
                        submitting = true;
                      });
                      try {
                        await widget.api.updateAlertConfig(
                          warehouseId: warehouseId,
                          productId: productId,
                          minimumAvailableQty: minimum,
                          enabled: config?.enabled ?? true,
                        );
                        if (dialogContext.mounted) {
                          Navigator.pop(dialogContext, true);
                        }
                      } catch (error) {
                        setDialogState(() {
                          fieldError = inventoryErrorMessage(error);
                          submitting = false;
                        });
                      }
                    },
              child: Text(submitting ? '保存中…' : '保存'),
            ),
          ],
        ),
      ),
    );
    controller.dispose();
    if (saved == true && mounted) {
      await Future.wait([_loadConfigs(), _loadActivity()]);
      if (mounted) _showSnack('最低库存规则已保存。');
    }
  }

  void _showSnack(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }
}

Widget _alertSectionHeader(
  BuildContext context, {
  required String title,
  required String subtitle,
  Widget? action,
}) {
  return Padding(
    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
    child: Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
              ),
              Text(subtitle, style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
        ),
        if (action != null) action,
      ],
    ),
  );
}

Widget _alertTypeTag(String type) {
  final tone = switch (type) {
    'NEGATIVE_AVAILABLE' => StatusTone.danger,
    'LOW_STOCK' || 'PENDING_COST' || 'TRANSFER_OVERDUE' => StatusTone.warning,
    'ORDER_SHORTAGE' || 'STOCKTAKE_APPROVAL' => StatusTone.info,
    _ => StatusTone.neutral,
  };
  return InventoryStatusTag(label: _alertTypeLabel(type), tone: tone);
}

Widget _alertStatusTag(String status) {
  final (label, tone) = switch (status) {
    'ACTIVE' => ('处理中', StatusTone.warning),
    'RESOLVED' => ('已恢复', StatusTone.success),
    'CANCELLED' => ('已取消', StatusTone.neutral),
    _ => ('未知状态（$status）', StatusTone.neutral),
  };
  return InventoryStatusTag(label: label, tone: tone);
}

String _alertTypeLabel(String type) {
  return switch (type) {
    'LOW_STOCK' => '低库存',
    'NEGATIVE_AVAILABLE' => '负库存',
    'ORDER_SHORTAGE' => '待配货',
    'PENDING_COST' => '待补成本',
    'TRANSFER_OVERDUE' => '调拨超时',
    'STOCKTAKE_APPROVAL' => '盘点待审',
    _ => '未知类型（$type）',
  };
}

String _alertActionLabel(String type) {
  return switch (type) {
    'LOW_STOCK' || 'NEGATIVE_AVAILABLE' => '查看商品库存',
    'ORDER_SHORTAGE' => '打开配货',
    'PENDING_COST' => '补录批次成本',
    'TRANSFER_OVERDUE' => '查看调拨',
    'STOCKTAKE_APPROVAL' => '打开审批',
    _ => '查看',
  };
}

Widget _nullableBottleText(int? value) => Text(_nullableBottleLabel(value));

String _nullableBottleLabel(int? value) {
  return value == null ? '暂未提供' : '$value 瓶';
}

void _putAlertFilter(
  Map<String, String> filters,
  String key,
  String? value,
) {
  final clean = value?.trim();
  if (clean != null && clean.isNotEmpty) filters[key] = clean;
}
