part of '../inventory_workspace_tabs.dart';

class ReportTab extends StatefulWidget {
  const ReportTab({
    super.key,
    required this.api,
    required this.businessApi,
    required this.role,
    this.downloadedFileService,
  });

  final InventoryApi api;
  final BusinessApi businessApi;
  final UserRole role;
  final DownloadedFileService? downloadedFileService;

  @override
  State<ReportTab> createState() => _ReportTabState();
}

class _ReportTabState extends State<ReportTab> {
  String _selectedReport = 'warehouse-balances';
  ReportResult? _result;
  List<WarehouseRecord> _warehouses = const [];
  List<ProductOptionRecord> _products = const [];
  bool _loading = false;
  bool _exporting = false;
  bool _optionsLoading = true;
  String? _error;
  String? _optionsError;
  String? _warehouseId;
  String? _productId;
  DateTime? _dateFrom;
  DateTime? _dateTo;
  int _page = 1;
  int _generation = 0;

  bool get _canReadCost => canReadInventoryCost(widget.role);

  List<String> get _availableReports {
    return InventoryApi.reportTypes.where((type) {
      if (!_canReadCost && type == 'inventory-valuation') return false;
      if ((widget.role == UserRole.warehouse ||
              widget.role == UserRole.finance) &&
          type == 'alerts') {
        // 这两个角色在“库存预警”页按最小类型请求，避免报表入口放大范围。
        return false;
      }
      return true;
    }).toList(growable: false);
  }

  Map<String, String> get _filters {
    final result = <String, String>{};
    _putReportFilter(result, 'warehouseId', _warehouseId);
    _putReportFilter(result, 'productId', _productId);
    _putReportFilter(result, 'dateFrom', inventoryDateText(_dateFrom));
    _putReportFilter(result, 'dateTo', inventoryDateText(_dateTo));
    return result;
  }

  @override
  void initState() {
    super.initState();
    _loadOptions();
    _load();
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
    if (!_validateDates()) return;
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await widget.api.fetchReport(
        reportType: _selectedReport,
        page: _page,
        pageSize: 30,
        filters: _filters,
      );
      if (!mounted || generation != _generation) return;
      setState(() {
        _result = result;
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

  bool _validateDates() {
    if (_selectedReport == 'period-summary' &&
        (_dateFrom == null || _dateTo == null)) {
      _showSnack('期间收发存报表必须选择开始日期和结束日期。');
      return false;
    }
    if (_dateFrom != null && _dateTo != null && _dateFrom!.isAfter(_dateTo!)) {
      _showSnack('开始日期不能晚于结束日期。');
      return false;
    }
    return true;
  }

  void _selectReport(String reportType) {
    setState(() {
      _selectedReport = reportType;
      _page = 1;
      if (reportType == 'period-summary' &&
          (_dateFrom == null || _dateTo == null)) {
        final now = DateTime.now();
        _dateFrom = DateTime(now.year, now.month);
        _dateTo = DateTime(now.year, now.month, now.day);
      }
    });
    _load();
  }

  void _resetFilters() {
    setState(() {
      _warehouseId = null;
      _productId = null;
      _dateFrom = null;
      _dateTo = null;
      if (_selectedReport == 'period-summary') {
        final now = DateTime.now();
        _dateFrom = DateTime(now.year, now.month);
        _dateTo = DateTime(now.year, now.month, now.day);
      }
      _page = 1;
    });
    _load();
  }

  Future<void> _export() async {
    if (!_validateDates() || _exporting) return;
    setState(() => _exporting = true);
    try {
      final file = await widget.api.exportReport(
        reportType: _selectedReport,
        filters: _filters,
      );
      final service = widget.downloadedFileService ?? DownloadedFileService();
      final saved = await service.save(
        originalFileName: file.fileName,
        bytes: file.bytes,
      );
      if (!mounted || saved.cancelled) return;
      _showSnack('报表已保存：${saved.path ?? file.fileName}');
    } catch (error) {
      if (mounted) _showSnack(inventoryErrorMessage(error));
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
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
              key: const ValueKey('warehouse-report-type-selector'),
              width: 190,
              child: DropdownButtonFormField<String>(
                key: ValueKey('report-type-$_selectedReport'),
                initialValue: _selectedReport,
                decoration: const InputDecoration(
                  labelText: '报表类型',
                  isDense: true,
                ),
                items: _availableReports
                    .map(
                      (type) => DropdownMenuItem(
                        value: type,
                        child: Text(InventoryApi.reportLabel(type)),
                      ),
                    )
                    .toList(),
                onChanged: (value) {
                  if (value != null) _selectReport(value);
                },
              ),
            ),
            _reportWarehouseFilter(),
            _reportProductFilter(),
            _ReportDateButton(
              key: const ValueKey('warehouse-report-date-from'),
              label: '开始日期',
              value: _dateFrom,
              onChanged: (value) => setState(() => _dateFrom = value),
            ),
            _ReportDateButton(
              key: const ValueKey('warehouse-report-date-to'),
              label: '结束日期',
              value: _dateTo,
              onChanged: (value) => setState(() => _dateTo = value),
            ),
          ],
          actions: [
            FilledButton.tonalIcon(
              key: const ValueKey('warehouse-report-apply-filter'),
              onPressed: _loading
                  ? null
                  : () {
                      setState(() => _page = 1);
                      _load();
                    },
              icon: const Icon(Icons.filter_alt_rounded, size: 18),
              label: const Text('查询'),
            ),
            OutlinedButton.icon(
              onPressed: _resetFilters,
              icon: const Icon(Icons.restart_alt_rounded, size: 18),
              label: const Text('重置'),
            ),
            OutlinedButton.icon(
              onPressed: _loading ? null : _load,
              icon: const Icon(Icons.refresh_rounded, size: 18),
              label: const Text('刷新'),
            ),
            FilledButton.icon(
              key: const ValueKey('warehouse-report-export-button'),
              onPressed: _loading || _exporting ? null : _export,
              icon: _exporting
                  ? const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.download_rounded, size: 18),
              label: Text(_exporting ? '导出中…' : '导出 Excel'),
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
        if (!_canReadCost)
          const Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: InventoryInlineNotice(
              key: ValueKey('warehouse-report-no-cost-notice'),
              message: '当前角色只请求数量报表；库存估值、采购单价、金额和成本覆盖字段不会进入请求或页面。',
              tone: StatusTone.info,
            ),
          ),
        Expanded(child: _buildBody()),
      ],
    );
  }

  Widget _reportWarehouseFilter() {
    return SizedBox(
      key: const ValueKey('warehouse-report-warehouse-filter'),
      width: 180,
      child: DropdownButtonFormField<String?>(
        key: ValueKey('report-warehouse-${_warehouseId ?? 'all'}'),
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

  Widget _reportProductFilter() {
    return SizedBox(
      key: const ValueKey('warehouse-report-product-filter'),
      width: 210,
      child: DropdownButtonFormField<String?>(
        key: ValueKey('report-product-${_productId ?? 'all'}'),
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
      return const LoadingState(title: '正在加载库存报表');
    }
    if (_error != null && _result == null) {
      return ErrorState(title: _error!, onRetry: _load);
    }
    final result = _result;
    if (result == null || result.rows.isEmpty) {
      return const EmptyState(title: '当前筛选下暂无报表数据');
    }
    final columns = safeInventoryReportColumns(
      result.reportType,
      result.columns,
      canReadCost: _canReadCost,
    );
    if (columns.isEmpty) {
      return ErrorState(
        title: '服务端返回的报表列不在客户端安全白名单中。',
        onRetry: _load,
      );
    }
    final unknownCount = result.columns.length - columns.length;
    return Column(
      children: [
        if (unknownCount > 0)
          InventoryInlineNotice(
            key: const ValueKey('warehouse-report-dropped-columns'),
            message: '已隐藏 $unknownCount 个不在安全白名单或当前角色权限内的服务端字段。',
            tone: StatusTone.warning,
          ),
        Expanded(
          child: LayoutBuilder(
            builder: (context, constraints) =>
                isDesktopWidth(constraints.maxWidth)
                    ? _buildDesktopReport(result, columns)
                    : _buildMobileReport(result, columns),
          ),
        ),
        InventoryPagination(
          page: result.page,
          totalPages: result.totalPages,
          onPrevious: result.page > 1
              ? () {
                  setState(() => _page--);
                  _load();
                }
              : null,
          onNext: result.page < result.totalPages
              ? () {
                  setState(() => _page++);
                  _load();
                }
              : null,
        ),
      ],
    );
  }

  Widget _buildDesktopReport(
    ReportResult result,
    List<ReportColumn> columns,
  ) {
    return SingleChildScrollView(
      scrollDirection: Axis.vertical,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          key: ValueKey('warehouse-report-table-${result.reportType}'),
          columns: columns
              .map((column) => DataColumn(label: Text(column.label)))
              .toList(),
          rows: result.rows
              .map(
                (row) => DataRow(
                  cells: columns
                      .map(
                        (column) => DataCell(
                          Text(
                            formatInventoryReportValue(
                              result.reportType,
                              column,
                              row[column.key],
                            ),
                          ),
                        ),
                      )
                      .toList(),
                ),
              )
              .toList(),
        ),
      ),
    );
  }

  Widget _buildMobileReport(
    ReportResult result,
    List<ReportColumn> columns,
  ) {
    return ListView.separated(
      key: const ValueKey('warehouse-report-mobile-cards'),
      itemCount: result.rows.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (context, index) {
        final row = result.rows[index];
        return Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: columns
                  .map(
                    (column) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 3),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SizedBox(
                            width: 110,
                            child: Text(
                              '${column.label}：',
                              style: TextStyle(
                                color: Theme.of(context)
                                    .colorScheme
                                    .onSurfaceVariant,
                              ),
                            ),
                          ),
                          Expanded(
                            child: Text(
                              formatInventoryReportValue(
                                result.reportType,
                                column,
                                row[column.key],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  )
                  .toList(),
            ),
          ),
        );
      },
    );
  }

  void _showSnack(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }
}

class _ReportDateButton extends StatelessWidget {
  const _ReportDateButton({
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

List<ReportColumn> safeInventoryReportColumns(
  String reportType,
  List<ReportColumn> serverColumns, {
  required bool canReadCost,
}) {
  final allowed = _reportAllowedKeys[reportType] ?? const <String>{};
  final result = <ReportColumn>[];
  final seen = <String>{};
  for (final serverColumn in serverColumns) {
    final key = serverColumn.key;
    if (!allowed.contains(key) || !seen.add(key)) continue;
    if (!canReadCost && _reportCostKeys.contains(key)) continue;
    final label = _reportColumnLabels[key];
    if (label == null) continue;
    result.add(
      ReportColumn(
        key: key,
        label: label,
        type: _reportColumnType(key),
      ),
    );
  }
  return result;
}

String formatInventoryReportValue(
  String reportType,
  ReportColumn column,
  dynamic value,
) {
  if (value == null || '$value'.trim().isEmpty) return '—';
  switch (column.type) {
    case 'integer':
      final number = value is num ? value.toInt() : int.tryParse('$value');
      return number == null ? '—' : '$number 瓶';
    case 'money':
      final cents = value is num ? value.toInt() : int.tryParse('$value');
      return cents == null ? '—' : formatMoneyCents(cents);
    case 'boolean':
      return value == true || '$value'.toLowerCase() == 'true' ? '是' : '否';
    case 'datetime':
      return formatInventoryDateTime('$value');
  }
  final raw = '$value';
  if (column.key == 'trackingMode') {
    return switch (raw.toUpperCase()) {
      'QUANTITY' => '数量库存',
      'SERIALIZED' => '逐瓶库存',
      'NONE' => '未跟踪',
      _ => '未知模式（$raw）',
    };
  }
  if (column.key == 'coverageStatus') {
    return switch (raw.toLowerCase()) {
      'full' || 'complete' => '完整覆盖',
      'partial' => '部分覆盖',
      'none' || 'uncovered' => '未覆盖',
      _ => '未知覆盖状态（$raw）',
    };
  }
  if (column.key == 'movementType' || column.key == 'effectiveMovementType') {
    return _movementTypeLabel(raw.toUpperCase());
  }
  if (column.key == 'alertType') {
    return _alertTypeLabel(raw.toUpperCase());
  }
  if (column.key == 'status') {
    return _reportStatusLabel(reportType, raw);
  }
  if (column.key == 'scope') {
    return raw.toLowerCase() == 'company' ? '全公司' : '仓库';
  }
  if (column.key == 'productionDate' ||
      column.key == 'periodFrom' ||
      column.key == 'periodTo') {
    final parsed = DateTime.tryParse(raw);
    return parsed == null ? raw : inventoryDateText(parsed.toLocal());
  }
  return raw;
}

String _reportStatusLabel(String reportType, String raw) {
  final value = raw.toUpperCase();
  if (reportType == 'alerts') {
    return switch (value) {
      'ACTIVE' => '处理中',
      'RESOLVED' => '已恢复',
      'CANCELLED' => '已取消',
      _ => '未知状态（$raw）',
    };
  }
  return switch (value) {
    'DRAFT' => '草稿',
    'SUBMITTED' => '待审批',
    'APPROVED' => '已批准',
    'REJECTED' => '已驳回',
    'POSTED' => '已生效',
    'REVERSED' => '已冲销',
    'OUTBOUND' => '在途',
    'PARTIALLY_RECEIVED' => '部分收货',
    'RECEIVED' => '已收货',
    'CANCELLED' => '已取消',
    _ => '未知状态（$raw）',
  };
}

String _reportColumnType(String key) {
  if (_reportMoneyKeys.contains(key)) return 'money';
  if (_reportDateKeys.contains(key)) return 'datetime';
  if (_reportBooleanKeys.contains(key)) return 'boolean';
  if (_reportIntegerKeys.contains(key)) return 'integer';
  return 'string';
}

void _putReportFilter(
  Map<String, String> filters,
  String key,
  String? value,
) {
  final clean = value?.trim();
  if (clean != null && clean.isNotEmpty) filters[key] = clean;
}

const _reportCostKeys = <String>{
  'purchaseUnitCostCents',
  'coverageStatus',
  'coveredQty',
  'uncoveredQty',
  'inventoryAmountCents',
};

const _reportMoneyKeys = <String>{
  'purchaseUnitCostCents',
  'inventoryAmountCents',
};

const _reportBooleanKeys = <String>{'snapshotConsistent'};

const _reportDateKeys = <String>{
  'businessAt',
  'firstDetectedAt',
  'lastDetectedAt',
  'resolvedAt',
  'submittedAt',
  'approvedAt',
  'postedAt',
  'createdAt',
  'outboundAt',
};

const _reportIntegerKeys = <String>{
  'onHandQty',
  'reservedQty',
  'unavailableQty',
  'inTransitQty',
  'availableQty',
  'shortageQty',
  'companyTotalQty',
  'openingOnHandQty',
  'inboundQty',
  'outboundQty',
  'openingInTransitQty',
  'transferIntoTransitQty',
  'transferOutOfTransitQty',
  'closingOnHandQty',
  'closingInTransitQty',
  'onHandDelta',
  'reservedDelta',
  'unavailableDelta',
  'inTransitDelta',
  'quantity',
  'receivedQty',
  'movementRemainingQty',
  'snapshotRemainingQty',
  'minimumAvailableQty',
  'snapshotOnHandQty',
  'countedOnHandQty',
  'onHandDifferenceQty',
  'snapshotUnavailableQty',
  'countedUnavailableQty',
  'unavailableDifferenceQty',
  'plannedQty',
  'unavailableReceivedQty',
  'differenceQty',
  'remainingInTransitQty',
  'companyInventoryQty',
  'coveredQty',
  'uncoveredQty',
};

const _reportAllowedKeys = <String, Set<String>>{
  'warehouse-balances': {
    'scope',
    'warehouseCode',
    'warehouseName',
    'productName',
    'trackingMode',
    'onHandQty',
    'reservedQty',
    'unavailableQty',
    'inTransitQty',
    'availableQty',
    'shortageQty',
    'companyTotalQty',
    'snapshotConsistent',
    'coverageStatus',
    'coveredQty',
    'uncoveredQty',
    'inventoryAmountCents',
    'warning',
  },
  'period-summary': {
    'scope',
    'warehouseCode',
    'warehouseName',
    'productName',
    'trackingMode',
    'periodFrom',
    'periodTo',
    'openingOnHandQty',
    'inboundQty',
    'outboundQty',
    'openingInTransitQty',
    'transferIntoTransitQty',
    'transferOutOfTransitQty',
    'closingOnHandQty',
    'closingInTransitQty',
    'companyTotalQty',
    'warning',
  },
  'movements': {
    'businessAt',
    'documentNo',
    'warehouseCode',
    'warehouseName',
    'productName',
    'trackingMode',
    'movementType',
    'effectiveMovementType',
    'onHandDelta',
    'reservedDelta',
    'unavailableDelta',
    'inTransitDelta',
    'purchaseOrderNo',
    'productionBatch',
    'operatorName',
    'reason',
    'purchaseUnitCostCents',
    'coverageStatus',
    'coveredQty',
    'uncoveredQty',
    'inventoryAmountCents',
    'warning',
  },
  'sales-outbound': {
    'warehouseCode',
    'warehouseName',
    'productName',
    'trackingMode',
    'quantity',
    'coverageStatus',
    'coveredQty',
    'uncoveredQty',
    'inventoryAmountCents',
    'warning',
  },
  'purchase-inbound': {
    'warehouseCode',
    'warehouseName',
    'productName',
    'trackingMode',
    'quantity',
    'coverageStatus',
    'coveredQty',
    'uncoveredQty',
    'inventoryAmountCents',
    'warning',
  },
  'batch-balances': {
    'warehouseCode',
    'warehouseName',
    'productName',
    'trackingMode',
    'supplierName',
    'purchaseOrderNo',
    'productionBatch',
    'productionDate',
    'receivedQty',
    'movementRemainingQty',
    'snapshotRemainingQty',
    'unavailableQty',
    'snapshotConsistent',
    'purchaseUnitCostCents',
    'coverageStatus',
    'coveredQty',
    'uncoveredQty',
    'inventoryAmountCents',
    'warning',
  },
  'alerts': {
    'alertType',
    'status',
    'warehouseCode',
    'warehouseName',
    'productName',
    'trackingMode',
    'availableQty',
    'shortageQty',
    'minimumAvailableQty',
    'firstDetectedAt',
    'lastDetectedAt',
    'resolvedAt',
  },
  'stocktake-variances': {
    'stocktakeNo',
    'status',
    'warehouseCode',
    'warehouseName',
    'productName',
    'trackingMode',
    'snapshotOnHandQty',
    'countedOnHandQty',
    'onHandDifferenceQty',
    'snapshotUnavailableQty',
    'countedUnavailableQty',
    'unavailableDifferenceQty',
    'reason',
    'submittedAt',
    'approvedAt',
    'postedAt',
    'createdAt',
  },
  'transfers': {
    'transferNo',
    'status',
    'fromWarehouseCode',
    'fromWarehouseName',
    'toWarehouseCode',
    'toWarehouseName',
    'productName',
    'trackingMode',
    'plannedQty',
    'outboundQty',
    'receivedQty',
    'unavailableReceivedQty',
    'differenceQty',
    'remainingInTransitQty',
    'companyTotalQty',
    'outboundAt',
    'createdAt',
    'warning',
  },
  'inventory-valuation': {
    'scope',
    'warehouseCode',
    'warehouseName',
    'productName',
    'trackingMode',
    'onHandQty',
    'inTransitQty',
    'companyInventoryQty',
    'coverageStatus',
    'coveredQty',
    'uncoveredQty',
    'inventoryAmountCents',
    'warning',
  },
};

const _reportColumnLabels = <String, String>{
  'scope': '范围',
  'warehouseCode': '仓库编号',
  'warehouseName': '仓库',
  'productName': '商品',
  'trackingMode': '库存模式',
  'onHandQty': '账面现存',
  'reservedQty': '已占用',
  'unavailableQty': '不可售',
  'inTransitQty': '调拨在途',
  'availableQty': '实际可售',
  'shortageQty': '短缺',
  'companyTotalQty': '公司总量',
  'snapshotConsistent': '快照一致',
  'warning': '服务端提示',
  'periodFrom': '期间开始',
  'periodTo': '期间结束',
  'openingOnHandQty': '期初现存',
  'inboundQty': '期间入库',
  'outboundQty': '期间出库',
  'openingInTransitQty': '期初在途',
  'transferIntoTransitQty': '期间进入在途',
  'transferOutOfTransitQty': '期间离开在途',
  'closingOnHandQty': '期末现存',
  'closingInTransitQty': '期末在途',
  'businessAt': '业务时间',
  'documentNo': '库存单号',
  'movementType': '流水类型',
  'effectiveMovementType': '归属业务类型',
  'onHandDelta': '现存变化',
  'reservedDelta': '占用变化',
  'unavailableDelta': '不可售变化',
  'inTransitDelta': '在途变化',
  'purchaseOrderNo': '采购单号',
  'productionBatch': '生产批次',
  'operatorName': '操作人',
  'reason': '原因',
  'quantity': '数量',
  'supplierName': '供应商',
  'productionDate': '生产日期',
  'receivedQty': '入库/实收数量',
  'movementRemainingQty': '流水重建剩余',
  'snapshotRemainingQty': '批次快照剩余',
  'alertType': '预警类型',
  'status': '状态',
  'minimumAvailableQty': '最低库存',
  'firstDetectedAt': '首次发现',
  'lastDetectedAt': '最近发现',
  'resolvedAt': '恢复时间',
  'stocktakeNo': '盘点单号',
  'snapshotOnHandQty': '账面现存',
  'countedOnHandQty': '实盘现存',
  'onHandDifferenceQty': '现存差异',
  'snapshotUnavailableQty': '账面不可售',
  'countedUnavailableQty': '实盘不可售',
  'unavailableDifferenceQty': '不可售差异',
  'submittedAt': '提交时间',
  'approvedAt': '审批时间',
  'postedAt': '生效时间',
  'createdAt': '创建时间',
  'transferNo': '调拨单号',
  'fromWarehouseCode': '调出仓编号',
  'fromWarehouseName': '调出仓',
  'toWarehouseCode': '调入仓编号',
  'toWarehouseName': '调入仓',
  'plannedQty': '计划数量',
  'unavailableReceivedQty': '实收不可售',
  'differenceQty': '差异数量',
  'remainingInTransitQty': '剩余在途',
  'outboundAt': '调出时间',
  'companyInventoryQty': '计价库存数量',
  'coverageStatus': '成本覆盖状态',
  'coveredQty': '已覆盖数量',
  'uncoveredQty': '未覆盖数量',
  'purchaseUnitCostCents': '采购单价',
  'inventoryAmountCents': '库存金额',
};
