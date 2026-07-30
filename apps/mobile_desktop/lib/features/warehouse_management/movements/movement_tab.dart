part of '../inventory_workspace_tabs.dart';

class MovementTab extends StatefulWidget {
  const MovementTab({
    super.key,
    required this.api,
    required this.businessApi,
    required this.role,
    this.requestedSelection,
    this.filterRequestRevision = 0,
  });

  final InventoryApi api;
  final BusinessApi businessApi;
  final UserRole role;
  final InventorySelectionContext? requestedSelection;
  final int filterRequestRevision;

  @override
  State<MovementTab> createState() => _MovementTabState();
}

class _MovementTabState extends State<MovementTab> {
  static const _movementTypes = <String>[
    'OPENING_IN',
    'PURCHASE_IN',
    'CUSTOMER_RETURN',
    'RESERVE',
    'RELEASE',
    'SALES_OUT',
    'TRANSFER_OUT',
    'TRANSFER_IN',
    'TRANSFER_DIFFERENCE',
    'STOCK_GAIN',
    'STOCK_LOSS',
    'OTHER_IN',
    'OTHER_OUT',
    'UNAVAILABLE_IN',
    'UNAVAILABLE_OUT',
    'REVERSAL',
  ];

  MovementPage? _result;
  List<WarehouseRecord> _warehouses = const [];
  List<ProductOptionRecord> _products = const [];
  bool _loading = true;
  bool _optionsLoading = true;
  String? _error;
  String? _optionsError;
  int _page = 1;
  int _generation = 0;
  String? _warehouseId;
  String? _productId;
  String? _movementType;
  DateTime? _dateFrom;
  DateTime? _dateTo;

  bool get _canReadCost => canReadInventoryCost(widget.role);

  @override
  void initState() {
    super.initState();
    _applyRequestedSelection();
    _loadOptions();
    _load();
  }

  @override
  void didUpdateWidget(covariant MovementTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.filterRequestRevision != widget.filterRequestRevision) {
      setState(() {
        _applyRequestedSelection();
        _page = 1;
      });
      _load();
    }
  }

  void _applyRequestedSelection() {
    final selection = widget.requestedSelection;
    if (selection == null) return;
    _warehouseId = selection.warehouseId;
    _productId = selection.productId;
  }

  Future<void> _loadOptions() async {
    setState(() {
      _optionsLoading = true;
      _optionsError = null;
    });
    try {
      final values = await Future.wait<dynamic>([
        widget.api.listWarehouses(isActive: true),
        widget.businessApi.listProductOptions(),
      ]);
      if (!mounted) return;
      setState(() {
        _warehouses = values[0] as List<WarehouseRecord>;
        _products = values[1] as List<ProductOptionRecord>;
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

  Future<void> _load() async {
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await widget.api.listMovements(
        page: _page,
        pageSize: 30,
        warehouseId: _warehouseId,
        productId: _productId,
        movementType: _movementType,
        dateFrom: inventoryDateText(_dateFrom),
        dateTo: inventoryDateText(_dateTo),
      );
      if (!mounted || generation != _generation) return;
      setState(() {
        _result = page;
        _loading = false;
      });
    } catch (error) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _error = inventoryErrorMessage(error);
        _loading = false;
      });
    }
  }

  void _applyFilters() {
    if (_dateFrom != null && _dateTo != null && _dateFrom!.isAfter(_dateTo!)) {
      _showSnack('开始日期不能晚于结束日期。');
      return;
    }
    setState(() => _page = 1);
    _load();
  }

  void _resetFilters() {
    setState(() {
      _warehouseId = widget.requestedSelection?.warehouseId;
      _productId = widget.requestedSelection?.productId;
      _movementType = null;
      _dateFrom = null;
      _dateTo = null;
      _page = 1;
    });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        if (widget.requestedSelection != null) ...[
          const InventoryInlineNotice(
            key: ValueKey('warehouse-movement-selection-filter'),
            message: '已带入来源库存项的仓库和商品筛选。',
            tone: StatusTone.info,
          ),
          const SizedBox(height: 8),
        ],
        InventoryFilterBar(
          // Filter controls are intentionally listed before the action row.
          // ignore: sort_child_properties_last
          children: [
            _movementWarehouseFilter(),
            _movementProductFilter(),
            SizedBox(
              key: const ValueKey('warehouse-movement-type-filter'),
              width: 180,
              child: DropdownButtonFormField<String?>(
                key: ValueKey('movement-type-${_movementType ?? 'all'}'),
                initialValue: _movementType,
                decoration: const InputDecoration(
                  labelText: '业务类型',
                  isDense: true,
                ),
                items: [
                  const DropdownMenuItem(value: null, child: Text('全部类型')),
                  ..._movementTypes.map(
                    (type) => DropdownMenuItem(
                      value: type,
                      child: Text(_movementTypeLabel(type)),
                    ),
                  ),
                ],
                onChanged: (value) => setState(() => _movementType = value),
              ),
            ),
            _MovementDateButton(
              key: const ValueKey('warehouse-movement-date-from'),
              label: '开始日期',
              value: _dateFrom,
              onChanged: (value) => setState(() => _dateFrom = value),
            ),
            _MovementDateButton(
              key: const ValueKey('warehouse-movement-date-to'),
              label: '结束日期',
              value: _dateTo,
              onChanged: (value) => setState(() => _dateTo = value),
            ),
            const SizedBox(
              width: 170,
              child: InputDecorator(
                decoration: InputDecoration(
                  labelText: '来源单号',
                  helperText: '等待接口',
                  isDense: true,
                ),
                child: Text('暂未提供筛选'),
              ),
            ),
            const SizedBox(
              width: 170,
              child: InputDecorator(
                decoration: InputDecoration(
                  labelText: '操作者',
                  helperText: '等待接口',
                  isDense: true,
                ),
                child: Text('暂未提供筛选'),
              ),
            ),
          ],
          actions: [
            FilledButton.tonalIcon(
              key: const ValueKey('warehouse-movement-apply-filter'),
              onPressed: _loading ? null : _applyFilters,
              icon: const Icon(Icons.filter_alt_rounded, size: 18),
              label: const Text('筛选'),
            ),
            OutlinedButton.icon(
              onPressed: _resetFilters,
              icon: const Icon(Icons.restart_alt_rounded, size: 18),
              label: const Text('重置'),
            ),
            OutlinedButton.icon(
              onPressed: _load,
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
          key: ValueKey('warehouse-movement-query-blockers'),
          message:
              '当前流水接口未提供来源单号、操作者筛选、业务后结余或可安全跳转的来源实体 ID；页面不会在当前分页上假过滤或自行计算结余。',
          tone: StatusTone.info,
        ),
        const SizedBox(height: 8),
        Expanded(child: _buildBody()),
      ],
    );
  }

  Widget _movementWarehouseFilter() {
    return SizedBox(
      key: const ValueKey('warehouse-movement-warehouse-filter'),
      width: 180,
      child: DropdownButtonFormField<String?>(
        key: ValueKey('movement-warehouse-${_warehouseId ?? 'all'}'),
        initialValue: _warehouseId,
        decoration: const InputDecoration(labelText: '仓库', isDense: true),
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
    );
  }

  Widget _movementProductFilter() {
    return SizedBox(
      key: const ValueKey('warehouse-movement-product-filter'),
      width: 210,
      child: DropdownButtonFormField<String?>(
        key: ValueKey('movement-product-${_productId ?? 'all'}'),
        initialValue: _productId,
        decoration: const InputDecoration(labelText: '商品', isDense: true),
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
    );
  }

  Widget _buildBody() {
    if (_loading && _result == null) {
      return const LoadingState(title: '正在加载出入库流水');
    }
    if (_error != null && _result == null) {
      return ErrorState(title: _error!, onRetry: _load);
    }
    final page = _result;
    if (page == null || page.movements.isEmpty) {
      return const EmptyState(title: '当前筛选下暂无流水记录');
    }
    return LayoutBuilder(
      builder: (context, constraints) => Column(
        children: [
          Expanded(
            child: isDesktopWidth(constraints.maxWidth)
                ? _buildDesktopTable(page.movements)
                : _buildMobileGroups(page.movements),
          ),
          InventoryPagination(
            page: page.page,
            totalPages: page.totalPages,
            onPrevious: page.page > 1
                ? () {
                    setState(() => _page--);
                    _load();
                  }
                : null,
            onNext: page.page < page.totalPages
                ? () {
                    setState(() => _page++);
                    _load();
                  }
                : null,
          ),
        ],
      ),
    );
  }

  Widget _buildDesktopTable(List<MovementRecord> movements) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: SingleChildScrollView(
        child: DataTable(
          key: const ValueKey('warehouse-movement-desktop-table'),
          columns: const [
            DataColumn(label: Text('业务时间')),
            DataColumn(label: Text('仓库')),
            DataColumn(label: Text('商品')),
            DataColumn(label: Text('入/出方向')),
            DataColumn(label: Text('数量')),
            DataColumn(label: Text('结余')),
            DataColumn(label: Text('来源')),
            DataColumn(label: Text('操作者')),
            DataColumn(label: Text('状态')),
          ],
          rows: movements
              .map(
                (movement) => DataRow(
                  onSelectChanged: (_) => _showDetail(movement),
                  cells: [
                    DataCell(
                      Text(formatInventoryDateTime(movement.businessAt)),
                    ),
                    DataCell(Text(movement.warehouseName)),
                    DataCell(Text(movement.productName)),
                    DataCell(_movementDirectionTag(movement)),
                    DataCell(_movementQuantityText(movement.quantity)),
                    const DataCell(Text('暂未提供')),
                    DataCell(
                      Text(
                        movement.sourceKey.isEmpty
                            ? '暂未提供'
                            : movement.sourceKey,
                      ),
                    ),
                    DataCell(Text(movement.operatorName ?? '暂未提供')),
                    DataCell(
                      InventoryStatusTag(
                        label: movement.movementTypeLabel,
                        tone: _movementTone(movement),
                      ),
                    ),
                  ],
                ),
              )
              .toList(),
        ),
      ),
    );
  }

  Widget _buildMobileGroups(List<MovementRecord> movements) {
    final groups = <String, List<MovementRecord>>{};
    for (final movement in movements) {
      final date = _movementDateGroup(movement.businessAt);
      groups.putIfAbsent(date, () => []).add(movement);
    }
    return ListView(
      key: const ValueKey('warehouse-movement-mobile-groups'),
      children: groups.entries
          .map(
            (entry) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(4, 4, 4, 6),
                    child: Text(
                      entry.key,
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                    ),
                  ),
                  ...entry.value.map(
                    (movement) => Card(
                      child: ListTile(
                        onTap: () => _showDetail(movement),
                        title: Row(
                          children: [
                            _movementDirectionTag(movement),
                            const SizedBox(width: 8),
                            Expanded(child: Text(movement.productName)),
                            _movementQuantityText(movement.quantity),
                          ],
                        ),
                        subtitle: Text(
                          '${movement.warehouseName} · '
                          '${movement.movementTypeLabel}\n'
                          '操作者：${movement.operatorName ?? '暂未提供'}',
                        ),
                        isThreeLine: true,
                        trailing: const Icon(Icons.chevron_right_rounded),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          )
          .toList(),
    );
  }

  Future<void> _showDetail(MovementRecord movement) {
    final details = <Widget>[
      _movementDetailRow('业务时间', formatInventoryDateTime(movement.businessAt)),
      _movementDetailRow(
        '仓库',
        '${movement.warehouseCode} ${movement.warehouseName}'.trim(),
      ),
      _movementDetailRow('商品', movement.productName),
      _movementDetailRow('业务类型', movement.movementTypeLabel),
      _movementDetailRow('账面现存变化', _signedBottle(movement.onHandDelta)),
      _movementDetailRow('占用变化', _signedBottle(movement.reservedDelta)),
      _movementDetailRow('不可售变化', _signedBottle(movement.unavailableDelta)),
      _movementDetailRow('在途变化', _signedBottle(movement.inTransitDelta)),
      _movementDetailRow('业务后结余', '暂未提供'),
      _movementDetailRow(
        '来源键',
        movement.sourceKey.isEmpty ? '暂未提供' : movement.sourceKey,
      ),
      _movementDetailRow('操作者', movement.operatorName ?? '暂未提供'),
      _movementDetailRow('采购单号', movement.purchaseOrderNo ?? '—'),
      _movementDetailRow('生产批次', movement.productionBatch ?? '—'),
      _movementDetailRow('原因', movement.reason ?? '—'),
      if (_canReadCost && movement.purchaseUnitCostCents != null)
        _movementDetailRow(
          '采购单价',
          formatMoneyCents(movement.purchaseUnitCostCents!),
        ),
      if (_canReadCost && movement.inventoryAmountCents != null)
        _movementDetailRow(
          '库存金额',
          formatMoneyCents(movement.inventoryAmountCents!),
        ),
      const SizedBox(height: 8),
      const InventoryInlineNotice(
        message: '流水只读。服务端未返回可安全深链的来源实体类型与 ID，因此当前不提供来源单据链接。',
        tone: StatusTone.info,
      ),
    ];
    final availableWidth =
        context.size?.width ?? MediaQuery.sizeOf(context).width;
    if (isDesktopWidth(availableWidth)) {
      return showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('库存流水详情'),
          content: SizedBox(
            width: 560,
            child: SingleChildScrollView(
              child: Column(children: details),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('关闭'),
            ),
          ],
        ),
      );
    }
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '库存流水详情',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 12),
                ...details,
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _showSnack(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }
}

class _MovementDateButton extends StatelessWidget {
  const _MovementDateButton({
    super.key,
    required this.label,
    required this.value,
    required this.onChanged,
  });

  final String label;
  final DateTime? value;
  final ValueChanged<DateTime?> onChanged;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 155,
      child: OutlinedButton.icon(
        onPressed: () async {
          final selected = await showDatePicker(
            context: context,
            initialDate: value ?? DateTime.now(),
            firstDate: DateTime(2020),
            lastDate: DateTime.now().add(const Duration(days: 365)),
          );
          if (selected != null) onChanged(selected);
        },
        icon: const Icon(Icons.calendar_today_outlined, size: 16),
        label: Text(
          value == null ? label : inventoryDateText(value),
          overflow: TextOverflow.ellipsis,
        ),
      ),
    );
  }
}

Widget _movementDirectionTag(MovementRecord movement) {
  final direction = switch (movement.movementType) {
    'RESERVE' || 'UNAVAILABLE_IN' => '状态增加',
    'RELEASE' || 'UNAVAILABLE_OUT' => '状态减少',
    _ when movement.quantity > 0 => '入',
    _ when movement.quantity < 0 => '出',
    _ => '不变',
  };
  final tone = switch (direction) {
    '入' || '状态增加' => StatusTone.success,
    '出' || '状态减少' => StatusTone.warning,
    _ => StatusTone.neutral,
  };
  return InventoryStatusTag(label: direction, tone: tone);
}

StatusTone _movementTone(MovementRecord movement) {
  if (movement.movementType == 'REVERSAL') return StatusTone.warning;
  if (movement.quantity < 0) return StatusTone.warning;
  if (movement.quantity > 0) return StatusTone.success;
  return StatusTone.info;
}

Widget _movementQuantityText(int quantity) {
  return Text(
    _signedBottle(quantity),
    style: const TextStyle(
      fontWeight: FontWeight.w700,
      fontFeatures: [FontFeature.tabularFigures()],
    ),
  );
}

Widget _movementDetailRow(String label, String value) {
  return Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 120,
          child: Text(label, style: const TextStyle(color: Colors.grey)),
        ),
        Expanded(child: SelectableText(value)),
      ],
    ),
  );
}

String _signedBottle(int value) => '${value > 0 ? '+' : ''}$value 瓶';

String _movementDateGroup(String? raw) {
  final parsed = raw == null ? null : DateTime.tryParse(raw);
  if (parsed == null) return '日期暂未提供';
  return inventoryDateText(parsed.toLocal());
}

String _movementTypeLabel(String type) {
  return switch (type) {
    'OPENING_IN' => '期初入库',
    'PURCHASE_IN' => '采购入库',
    'CUSTOMER_RETURN' => '顾客退货',
    'RESERVE' => '占用',
    'RELEASE' => '释放占用',
    'SALES_OUT' => '销售出库',
    'TRANSFER_OUT' => '调拨出',
    'TRANSFER_IN' => '调拨入',
    'TRANSFER_DIFFERENCE' => '调拨差异',
    'STOCK_GAIN' => '盘盈',
    'STOCK_LOSS' => '盘亏',
    'OTHER_IN' => '其他入库',
    'OTHER_OUT' => '其他出库',
    'UNAVAILABLE_IN' => '转入不可售',
    'UNAVAILABLE_OUT' => '恢复可售',
    'REVERSAL' => '冲销',
    _ => '未知类型（$type）',
  };
}
