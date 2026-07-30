import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../../core/business/business_api.dart';
import '../../../core/business/inventory_api.dart';
import '../../../shared/widgets/form_section.dart';
import '../../../shared/widgets/responsive.dart';
import '../../../shared/widgets/state_views.dart';
import '../../../shared/widgets/status_tag.dart';
import '../shared/inventory_workspace_shared.dart';

class CustomerReturnsTab extends StatefulWidget {
  const CustomerReturnsTab({
    super.key,
    required this.api,
    required this.businessApi,
    required this.role,
    required this.onInventoryFactsChanged,
  });

  final InventoryApi api;
  final BusinessApi businessApi;
  final UserRole role;
  final VoidCallback onInventoryFactsChanged;

  @override
  State<CustomerReturnsTab> createState() => _CustomerReturnsTabState();
}

class _CustomerReturnsTabState extends State<CustomerReturnsTab> {
  static const _pageSize = 20;

  final _afterSalesNoController = TextEditingController();
  final _orderNoController = TextEditingController();
  final _customerController = TextEditingController();
  List<WarehouseRecord> _warehouses = const [];
  List<ProductOptionRecord> _products = const [];
  List<_CustomerReturnRecord> _records = const [];
  String? _warehouseId;
  String? _productId;
  String? _receiptStatus;
  DateTime? _dateFrom;
  DateTime? _dateTo;
  String? _selectedId;
  int _page = 1;
  int _requestGeneration = 0;
  bool _loading = false;
  bool _refreshing = false;
  String? _error;
  String? _referenceError;
  final Set<String> _postingReceiptIds = {};
  final Map<String, ({String sourceKey, String idempotencyKey})>
      _postCommandKeys = {};

  bool get _canWrite => const {
        UserRole.superAdmin,
        UserRole.admin,
        UserRole.warehouse,
      }.contains(widget.role);

  bool get _canListOrders => const {
        UserRole.superAdmin,
        UserRole.admin,
        UserRole.warehouse,
        UserRole.finance,
      }.contains(widget.role);

  @override
  void initState() {
    super.initState();
    if (_canListOrders) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _load());
    }
  }

  @override
  void didUpdateWidget(covariant CustomerReturnsTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.api != widget.api ||
        oldWidget.businessApi != widget.businessApi ||
        oldWidget.role != widget.role) {
      _requestGeneration++;
      _records = const [];
      _warehouses = const [];
      _products = const [];
      _selectedId = null;
      _postingReceiptIds.clear();
      _postCommandKeys.clear();
      if (_canListOrders) {
        WidgetsBinding.instance.addPostFrameCallback((_) => _load());
      }
    }
  }

  @override
  void dispose() {
    _requestGeneration++;
    _afterSalesNoController.dispose();
    _orderNoController.dispose();
    _customerController.dispose();
    super.dispose();
  }

  Future<void> _load({bool refresh = false}) async {
    final generation = ++_requestGeneration;
    setState(() {
      if (refresh && _records.isNotEmpty) {
        _refreshing = true;
      } else {
        _loading = true;
      }
      _error = null;
      _referenceError = null;
    });

    final referenceErrors = <String>[];
    List<WarehouseRecord> warehouses = _warehouses;
    List<ProductOptionRecord> products = _products;
    try {
      final results = await Future.wait<Object>([
        widget.api.listWarehouses(isActive: true),
        widget.businessApi.listProductOptions(),
      ]);
      warehouses = results[0] as List<WarehouseRecord>;
      products = results[1] as List<ProductOptionRecord>;
    } catch (error) {
      referenceErrors.add(inventoryErrorMessage(error));
    }

    try {
      final orders = await widget.businessApi.listAfterSalesOrders(
        limit: 100,
        start: _dateFrom,
        end: _dateTo,
        query: _firstServerKeyword(),
      );
      final relevant = orders.where(_requiresPhysicalReturn).toList();
      final loaded = await Future.wait(
        relevant.map((order) async {
          try {
            final receipts = await widget.api.listAfterSalesReceipts(order.id);
            return _CustomerReturnRecord(order: order, receipts: receipts);
          } catch (error) {
            return _CustomerReturnRecord(
              order: order,
              receipts: const [],
              receiptError: inventoryErrorMessage(error),
            );
          }
        }),
      );
      if (!mounted || generation != _requestGeneration) return;
      final stillSelected =
          loaded.any((record) => record.order.id == _selectedId);
      setState(() {
        _warehouses = warehouses;
        _products = products;
        _records = loaded;
        _selectedId = stillSelected
            ? _selectedId
            : (loaded.isEmpty ? null : loaded.first.order.id);
        _page = 1;
        _loading = false;
        _refreshing = false;
        _referenceError =
            referenceErrors.isEmpty ? null : referenceErrors.join('；');
      });
    } catch (error) {
      if (!mounted || generation != _requestGeneration) return;
      setState(() {
        _loading = false;
        _refreshing = false;
        _error = inventoryErrorMessage(error);
        _referenceError =
            referenceErrors.isEmpty ? null : referenceErrors.join('；');
      });
    }
  }

  String? _firstServerKeyword() {
    for (final value in [
      _afterSalesNoController.text,
      _orderNoController.text,
      _customerController.text,
    ]) {
      final normalized = value.trim();
      if (normalized.isNotEmpty) return normalized;
    }
    return null;
  }

  bool _requiresPhysicalReturn(AfterSalesOrderRecord order) {
    return order.items.any((item) => item.returnRequired);
  }

  List<_CustomerReturnRecord> get _filteredRecords {
    final afterSalesNo = _afterSalesNoController.text.trim().toLowerCase();
    final orderNo = _orderNoController.text.trim().toLowerCase();
    final customer = _customerController.text.trim().toLowerCase();
    return _records.where((record) {
      final order = record.order;
      if (afterSalesNo.isNotEmpty &&
          !order.afterSalesNo.toLowerCase().contains(afterSalesNo)) {
        return false;
      }
      if (orderNo.isNotEmpty &&
          !_sourceOrderNo(order).toLowerCase().contains(orderNo)) {
        return false;
      }
      if (customer.isNotEmpty &&
          !_customerName(order).toLowerCase().contains(customer)) {
        return false;
      }
      if (_warehouseId != null &&
          !record.receipts
              .any((receipt) => receipt.warehouseId == _warehouseId)) {
        return false;
      }
      if (_productId != null &&
          !order.items.any(
            (item) => item.returnRequired && item.productId == _productId,
          )) {
        return false;
      }
      if (_receiptStatus != null && record.status != _receiptStatus) {
        return false;
      }
      return true;
    }).toList();
  }

  _CustomerReturnRecord? get _selectedRecord {
    for (final record in _records) {
      if (record.order.id == _selectedId) return record;
    }
    return null;
  }

  void _resetFilters() {
    _afterSalesNoController.clear();
    _orderNoController.clear();
    _customerController.clear();
    setState(() {
      _warehouseId = null;
      _productId = null;
      _receiptStatus = null;
      _dateFrom = null;
      _dateTo = null;
      _page = 1;
    });
    _load(refresh: true);
  }

  Future<void> _pickDate({required bool start}) async {
    final selected = await showDatePicker(
      context: context,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
      initialDate: (start ? _dateFrom : _dateTo) ?? DateTime.now(),
    );
    if (selected == null || !mounted) return;
    setState(() {
      if (start) {
        _dateFrom = selected;
      } else {
        _dateTo = selected;
      }
    });
    _load(refresh: true);
  }

  Future<void> _refreshOrder(String orderId) async {
    await _load(refresh: true);
    if (!mounted) return;
    setState(() => _selectedId = orderId);
  }

  Future<void> _openCreateReceipt(_CustomerReturnRecord record) async {
    final created = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => InventoryKeyboardSafeSheet(
        heightFactor: 0.94,
        child: CustomerReturnReceiptEditor(
          api: widget.api,
          order: record.order,
          warehouses: _warehouses,
          products: _products,
        ),
      ),
    );
    if (created == true) await _refreshOrder(record.order.id);
  }

  Future<void> _postReceipt(
    _CustomerReturnRecord record,
    InventoryAfterSalesReceiptRecord receipt,
  ) async {
    if (_postingReceiptIds.contains(receipt.id)) return;
    final confirmed = await confirmInventoryAction(
      context,
      title: '确认实际收货？',
      content: '确认后将由后端生成顾客退货库存事实。财务退款状态不会因此自动改变，已确认记录也不能在此直接修改或删除。',
      confirmLabel: '确认收货',
    );
    if (!confirmed || !mounted) return;
    final keys = _postCommandKeys.putIfAbsent(
      receipt.id,
      () {
        final nonce = DateTime.now().microsecondsSinceEpoch;
        return (
          sourceKey: 'flutter-after-sales-receipt-post:$nonce',
          idempotencyKey: 'flutter-after-sales-receipt-post-idem:$nonce',
        );
      },
    );
    setState(() => _postingReceiptIds.add(receipt.id));
    try {
      final result = await widget.api.postAfterSalesReceipt(
        receiptId: receipt.id,
        sourceKey: keys.sourceKey,
        idempotencyKey: keys.idempotencyKey,
      );
      if (!mounted) return;
      _postCommandKeys.remove(receipt.id);
      widget.api.clearCache();
      widget.onInventoryFactsChanged();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            result.replayed ? '该收货已经处理，已刷新真实结果。' : '实际收货已确认，库存已生效。',
          ),
        ),
      );
      await _refreshOrder(record.order.id);
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(inventoryErrorMessage(error))),
      );
      await _refreshOrder(record.order.id);
    } finally {
      if (mounted) {
        setState(() => _postingReceiptIds.remove(receipt.id));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_canListOrders) {
      return const InventoryUnavailableCard(
        keyPrefix: 'customer-returns-boss-blocked',
        title: '顾客退货',
        message:
            '当前后端允许 boss 读取单笔收货进度，但售后单列表接口尚未向 boss 开放，无法安全构建工作台列表。等待后端提供只读列表投影。',
      );
    }
    if (_loading && _records.isEmpty) {
      return const LoadingState(title: '正在加载顾客退货');
    }
    if (_error != null && _records.isEmpty) {
      return ErrorState(title: _error!, onRetry: _load);
    }

    final filtered = _filteredRecords;
    final totalPages =
        filtered.isEmpty ? 0 : (filtered.length / _pageSize).ceil();
    final effectivePage = totalPages == 0 ? 1 : _page.clamp(1, totalPages);
    final start = filtered.isEmpty ? 0 : (effectivePage - 1) * _pageSize;
    final visible =
        filtered.skip(start).take(_pageSize).toList(growable: false);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _buildFilters(),
        const InventoryInlineNotice(
          message: '此处只处理库管实际收货：保存草稿不会返库存，确认收货后才由后端生成退货库存事实。财务退款确认仍留在财务页面。',
          tone: StatusTone.info,
        ),
        const SizedBox(height: 8),
        const InventoryInlineNotice(
          message:
              '当前售后列表接口最多返回最近 100 笔，且仓库、商品和收货状态没有服务端筛选参数；以下筛选只作用于这批真实结果，不会伪装为全量数据。',
          tone: StatusTone.warning,
        ),
        if (_referenceError != null) ...[
          const SizedBox(height: 8),
          InventoryInlineNotice(
            message: '仓库/商品选项加载失败：$_referenceError',
            tone: StatusTone.warning,
          ),
        ],
        if (_error != null) ...[
          const SizedBox(height: 8),
          InventoryInlineNotice(message: _error!, tone: StatusTone.danger),
        ],
        const SizedBox(height: 12),
        Expanded(
          child: LayoutBuilder(
            builder: (context, constraints) {
              if (isDesktopWidth(constraints.maxWidth)) {
                return _buildWideWorkbench(
                  visible,
                  filtered.length,
                  effectivePage,
                  totalPages,
                );
              }
              return _buildMobileList(
                visible,
                filtered.length,
                effectivePage,
                totalPages,
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _buildFilters() {
    return InventoryFilterBar(
      actions: [
        TextButton.icon(
          key: const ValueKey('customer-returns-reset'),
          onPressed: _loading ? null : _resetFilters,
          icon: const Icon(Icons.restart_alt_rounded),
          label: const Text('重置'),
        ),
        FilledButton.icon(
          key: const ValueKey('customer-returns-refresh'),
          onPressed:
              _loading || _refreshing ? null : () => _load(refresh: true),
          icon: _refreshing
              ? const SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.refresh_rounded),
          label: const Text('刷新'),
        ),
      ],
      children: [
        _filterTextField(
          key: const ValueKey('customer-returns-after-sales-no-filter'),
          controller: _afterSalesNoController,
          label: '售后单号',
          width: 170,
        ),
        _filterTextField(
          key: const ValueKey('customer-returns-order-no-filter'),
          controller: _orderNoController,
          label: '原订单号',
          width: 170,
        ),
        _filterTextField(
          key: const ValueKey('customer-returns-customer-filter'),
          controller: _customerController,
          label: '客户',
          width: 150,
        ),
        SizedBox(
          width: 160,
          child: DropdownButtonFormField<String?>(
            key: const ValueKey('customer-returns-warehouse-filter'),
            initialValue: _warehouseId,
            isExpanded: true,
            decoration: const InputDecoration(labelText: '收货仓库', isDense: true),
            items: [
              const DropdownMenuItem(value: null, child: Text('全部仓库')),
              for (final warehouse in _warehouses)
                DropdownMenuItem(
                  value: warehouse.id,
                  child: Text(warehouse.name),
                ),
            ],
            onChanged: (value) => setState(() {
              _warehouseId = value;
              _page = 1;
            }),
          ),
        ),
        SizedBox(
          width: 180,
          child: DropdownButtonFormField<String?>(
            key: const ValueKey('customer-returns-product-filter'),
            initialValue: _productId,
            isExpanded: true,
            decoration: const InputDecoration(labelText: '商品', isDense: true),
            items: [
              const DropdownMenuItem(value: null, child: Text('全部商品')),
              for (final product in _products)
                DropdownMenuItem(
                  value: product.id,
                  child: Text(product.name),
                ),
            ],
            onChanged: (value) => setState(() {
              _productId = value;
              _page = 1;
            }),
          ),
        ),
        SizedBox(
          width: 150,
          child: DropdownButtonFormField<String?>(
            key: const ValueKey('customer-returns-status-filter'),
            initialValue: _receiptStatus,
            isExpanded: true,
            decoration: const InputDecoration(labelText: '收货状态', isDense: true),
            items: const [
              DropdownMenuItem(value: null, child: Text('全部状态')),
              DropdownMenuItem(value: 'waiting', child: Text('待收货')),
              DropdownMenuItem(value: 'partial', child: Text('部分收货')),
              DropdownMenuItem(value: 'received', child: Text('已收货')),
              DropdownMenuItem(value: 'abnormal', child: Text('异常瓶码')),
              DropdownMenuItem(value: 'completed', child: Text('已完成')),
            ],
            onChanged: (value) => setState(() {
              _receiptStatus = value;
              _page = 1;
            }),
          ),
        ),
        OutlinedButton.icon(
          key: const ValueKey('customer-returns-date-from'),
          onPressed: () => _pickDate(start: true),
          icon: const Icon(Icons.date_range_rounded),
          label: Text(
            _dateFrom == null
                ? '开始日期'
                : _dateLabel(_dateFrom!.toIso8601String()),
          ),
        ),
        OutlinedButton.icon(
          key: const ValueKey('customer-returns-date-to'),
          onPressed: () => _pickDate(start: false),
          icon: const Icon(Icons.event_rounded),
          label: Text(
            _dateTo == null ? '结束日期' : _dateLabel(_dateTo!.toIso8601String()),
          ),
        ),
      ],
    );
  }

  Widget _filterTextField({
    required Key key,
    required TextEditingController controller,
    required String label,
    required double width,
  }) {
    return SizedBox(
      width: width,
      child: TextField(
        key: key,
        controller: controller,
        decoration: InputDecoration(labelText: label, isDense: true),
        onSubmitted: (_) => _load(refresh: true),
      ),
    );
  }

  Widget _buildWideWorkbench(
    List<_CustomerReturnRecord> visible,
    int total,
    int page,
    int totalPages,
  ) {
    return Row(
      key: const ValueKey('customer-returns-wide-workbench'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          flex: 3,
          child: Card(
            margin: EdgeInsets.zero,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                  child: Text(
                    '顾客退货列表 · $total 笔',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                const Divider(),
                Expanded(
                  child: visible.isEmpty
                      ? EmptyState(
                          title: _records.isEmpty ? '暂无需要库管收货的售后单' : '筛选无结果',
                        )
                      : SingleChildScrollView(
                          child: SingleChildScrollView(
                            scrollDirection: Axis.horizontal,
                            child: DataTable(
                              key: const ValueKey(
                                'customer-returns-desktop-table',
                              ),
                              showCheckboxColumn: false,
                              columns: const [
                                DataColumn(label: Text('售后单号')),
                                DataColumn(label: Text('原订单')),
                                DataColumn(label: Text('客户')),
                                DataColumn(label: Text('处理')),
                                DataColumn(label: Text('应退'), numeric: true),
                                DataColumn(label: Text('已收'), numeric: true),
                                DataColumn(label: Text('待收'), numeric: true),
                                DataColumn(label: Text('收货仓')),
                                DataColumn(label: Text('状态')),
                                DataColumn(label: Text('日期')),
                              ],
                              rows: [
                                for (final record in visible)
                                  _buildDataRow(record),
                              ],
                            ),
                          ),
                        ),
                ),
                if (totalPages > 0)
                  InventoryPagination(
                    page: page,
                    totalPages: totalPages,
                    onPrevious: page > 1
                        ? () => setState(() => _page = page - 1)
                        : null,
                    onNext: page < totalPages
                        ? () => setState(() => _page = page + 1)
                        : null,
                  ),
              ],
            ),
          ),
        ),
        const SizedBox(width: 12),
        SizedBox(
          width: 430,
          child: Card(
            margin: EdgeInsets.zero,
            child: _selectedRecord == null
                ? const EmptyState(title: '请选择一笔售后单')
                : _CustomerReturnDetail(
                    key: ValueKey(
                      'customer-return-detail-${_selectedRecord!.order.id}',
                    ),
                    record: _selectedRecord!,
                    canWrite: _canWrite,
                    products: _products,
                    postingReceiptIds: _postingReceiptIds,
                    onCreateReceipt: () => _openCreateReceipt(_selectedRecord!),
                    onPostReceipt: (receipt) =>
                        _postReceipt(_selectedRecord!, receipt),
                    onRetry: () => _refreshOrder(_selectedRecord!.order.id),
                  ),
          ),
        ),
      ],
    );
  }

  DataRow _buildDataRow(_CustomerReturnRecord record) {
    final order = record.order;
    return DataRow(
      selected: order.id == _selectedId,
      onSelectChanged: (_) => setState(() => _selectedId = order.id),
      cells: [
        DataCell(Text(order.afterSalesNo)),
        DataCell(Text(_sourceOrderNo(order))),
        DataCell(Text(_customerName(order))),
        DataCell(Text(_actionLabel(order.actionType))),
        DataCell(Text('${record.expectedQty} 瓶')),
        DataCell(Text('${record.receivedQty} 瓶')),
        DataCell(Text('${record.remainingQty} 瓶')),
        DataCell(Text(record.warehouseSummary)),
        DataCell(_returnStatusTag(record.status)),
        DataCell(Text(_dateLabel(order.createdAt))),
      ],
    );
  }

  Widget _buildMobileList(
    List<_CustomerReturnRecord> visible,
    int total,
    int page,
    int totalPages,
  ) {
    if (visible.isEmpty) {
      return EmptyState(
        title: _records.isEmpty ? '暂无需要库管收货的售后单' : '筛选无结果',
      );
    }
    return ListView(
      key: const ValueKey('customer-returns-mobile-list'),
      children: [
        for (final record in visible)
          Card(
            key: ValueKey('customer-return-card-${record.order.id}'),
            child: InkWell(
              onTap: () => _openMobileDetail(record),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            record.order.afterSalesNo,
                            style: Theme.of(context)
                                .textTheme
                                .titleMedium
                                ?.copyWith(fontWeight: FontWeight.w700),
                          ),
                        ),
                        _returnStatusTag(record.status),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text('${_sourceOrderNo(record.order)} · '
                        '${_customerName(record.order)}'),
                    const SizedBox(height: 6),
                    Text('应退 ${record.expectedQty} 瓶 · '
                        '已收 ${record.receivedQty} 瓶 · '
                        '待收 ${record.remainingQty} 瓶'),
                    const SizedBox(height: 4),
                    Text('收货仓：${record.warehouseSummary}'),
                  ],
                ),
              ),
            ),
          ),
        if (totalPages > 0)
          InventoryPagination(
            page: page,
            totalPages: totalPages,
            onPrevious:
                page > 1 ? () => setState(() => _page = page - 1) : null,
            onNext: page < totalPages
                ? () => setState(() => _page = page + 1)
                : null,
          ),
        Padding(
          padding: const EdgeInsets.all(8),
          child: Text('当前筛选 $total 笔', textAlign: TextAlign.center),
        ),
      ],
    );
  }

  Future<void> _openMobileDetail(_CustomerReturnRecord record) async {
    setState(() => _selectedId = record.order.id);
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => FractionallySizedBox(
        heightFactor: 0.9,
        child: Material(
          key: const ValueKey('customer-returns-mobile-detail'),
          child: _CustomerReturnDetail(
            record: record,
            canWrite: _canWrite,
            products: _products,
            postingReceiptIds: _postingReceiptIds,
            onCreateReceipt: () {
              Navigator.pop(context);
              _openCreateReceipt(record);
            },
            onPostReceipt: (receipt) {
              Navigator.pop(context);
              _postReceipt(record, receipt);
            },
            onRetry: () {
              Navigator.pop(context);
              _refreshOrder(record.order.id);
            },
          ),
        ),
      ),
    );
  }
}

class AfterSalesReceiptProgressPanel extends StatefulWidget {
  const AfterSalesReceiptProgressPanel({
    super.key,
    required this.api,
    required this.afterSalesOrder,
  });

  final InventoryApi api;
  final AfterSalesOrderRecord afterSalesOrder;

  @override
  State<AfterSalesReceiptProgressPanel> createState() =>
      _AfterSalesReceiptProgressPanelState();
}

class _AfterSalesReceiptProgressPanelState
    extends State<AfterSalesReceiptProgressPanel> {
  List<InventoryAfterSalesReceiptRecord> _receipts = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant AfterSalesReceiptProgressPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.api != widget.api ||
        oldWidget.afterSalesOrder.id != widget.afterSalesOrder.id) {
      _load();
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _receipts = const [];
    });
    try {
      final receipts =
          await widget.api.listAfterSalesReceipts(widget.afterSalesOrder.id);
      if (!mounted) return;
      setState(() {
        _receipts = receipts;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = inventoryErrorMessage(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final record = _CustomerReturnRecord(
      order: widget.afterSalesOrder,
      receipts: _receipts,
      receiptError: _error,
    );
    return FormSection(
      key: const ValueKey('after-sales-receipt-progress-panel'),
      title: '库管实际收货进度',
      trailing: _returnStatusTag(record.status),
      children: [
        const InventoryInlineNotice(
          message: '此处仅展示库管实际收货进度。财务退款确认不会增加库存，也不在这里提供收货按钮。',
          tone: StatusTone.info,
        ),
        const SizedBox(height: 12),
        if (_loading)
          const LoadingState(title: '正在加载实际收货进度')
        else if (_error != null)
          ErrorState(title: _error!, onRetry: _load)
        else ...[
          for (final item in widget.afterSalesOrder.items
              .where((item) => item.returnRequired))
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text(
                '${item.productName}：应退 ${item.expectedReturnQty} 瓶，'
                '累计实收 ${item.postedReceivedQty} 瓶，'
                '剩余 ${item.remainingReturnQty} 瓶',
              ),
            ),
          if (!widget.afterSalesOrder.items.any((item) => item.returnRequired))
            const Text('该售后单没有服务端明确标记的应退商品，不会从退款数量推断返库存。'),
          if (_receipts.isNotEmpty) ...[
            const Divider(),
            for (final receipt in _receipts)
              _ReceiptReadOnlyCard(receipt: receipt),
          ],
        ],
      ],
    );
  }
}

class _CustomerReturnDetail extends StatelessWidget {
  const _CustomerReturnDetail({
    super.key,
    required this.record,
    required this.canWrite,
    required this.products,
    required this.postingReceiptIds,
    required this.onCreateReceipt,
    required this.onPostReceipt,
    required this.onRetry,
  });

  final _CustomerReturnRecord record;
  final bool canWrite;
  final List<ProductOptionRecord> products;
  final Set<String> postingReceiptIds;
  final VoidCallback onCreateReceipt;
  final ValueChanged<InventoryAfterSalesReceiptRecord> onPostReceipt;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final order = record.order;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  order.afterSalesNo,
                  style: Theme.of(context)
                      .textTheme
                      .titleLarge
                      ?.copyWith(fontWeight: FontWeight.w700),
                ),
              ),
              _returnStatusTag(record.status),
            ],
          ),
          const SizedBox(height: 12),
          _DetailLine(label: '原订单', value: _sourceOrderNo(order)),
          _DetailLine(label: '客户', value: _customerName(order)),
          _DetailLine(label: '处理方式', value: _actionLabel(order.actionType)),
          _DetailLine(label: '收货仓库', value: record.warehouseSummary),
          _DetailLine(label: '创建时间', value: _dateLabel(order.createdAt)),
          const Divider(height: 24),
          Text(
            '应退与累计实收',
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
          for (final item in order.items.where((item) => item.returnRequired))
            Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: Padding(
                padding: const EdgeInsets.all(10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      item.productName,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 4),
                    Text('应退 ${item.expectedReturnQty} 瓶 · '
                        '累计实收 ${item.postedReceivedQty} 瓶 · '
                        '剩余 ${item.remainingReturnQty} 瓶'),
                    Text('进度：${_itemProgressLabel(item.returnProgressStatus)}'),
                  ],
                ),
              ),
            ),
          if (record.receiptError != null)
            ErrorState(title: record.receiptError!, onRetry: onRetry)
          else ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: Text(
                    '实际收货记录',
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                Text('${record.receipts.length} 笔'),
              ],
            ),
            const SizedBox(height: 8),
            if (record.receipts.isEmpty)
              const EmptyState(title: '暂无实际收货记录')
            else
              for (final receipt in record.receipts)
                _ReceiptReadOnlyCard(
                  receipt: receipt,
                  trailing: receipt.isDraft && canWrite
                      ? FilledButton.icon(
                          key: ValueKey(
                            'customer-return-post-${receipt.id}',
                          ),
                          onPressed: postingReceiptIds.contains(receipt.id)
                              ? null
                              : () => onPostReceipt(receipt),
                          icon: postingReceiptIds.contains(receipt.id)
                              ? const SizedBox.square(
                                  dimension: 16,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.inventory_rounded),
                          label: const Text('确认收货'),
                        )
                      : null,
                ),
          ],
          const SizedBox(height: 12),
          const InventoryInlineNotice(
            message: '已确认收货记录只读，不提供直接修改或删除；需要纠错时应走独立、带原因的冲销流程。',
            tone: StatusTone.neutral,
          ),
          if (canWrite && record.remainingQty > 0) ...[
            const SizedBox(height: 12),
            FilledButton.icon(
              key: const ValueKey('customer-return-create-receipt'),
              onPressed: products.isEmpty ? null : onCreateReceipt,
              icon: const Icon(Icons.add_rounded),
              label: const Text('登记本次实际收货'),
            ),
            if (products.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text('商品库存模式尚未加载，不能安全创建收货草稿。'),
              ),
          ],
        ],
      ),
    );
  }
}

class _ReceiptReadOnlyCard extends StatelessWidget {
  const _ReceiptReadOnlyCard({
    required this.receipt,
    this.trailing,
  });

  final InventoryAfterSalesReceiptRecord receipt;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Card(
      key: ValueKey('customer-return-receipt-${receipt.id}'),
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '收货记录 ${receipt.id}',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
                _receiptStatusTag(receipt.status),
              ],
            ),
            const SizedBox(height: 4),
            Text('${receipt.warehouseName ?? '未提供仓库名称'} · '
                '${receipt.receivedQty} 瓶'),
            Text('登记 ${_dateLabel(receipt.createdAt)}'
                '${receipt.confirmedAt == null ? '' : ' · 确认 ${_dateLabel(receipt.confirmedAt)}'}'),
            if (receipt.notes?.isNotEmpty == true) Text('备注：${receipt.notes}'),
            for (final line in receipt.lines) ...[
              const Divider(),
              Text('${line.productName} · ${line.receivedQty} 瓶 · '
                  '${_conditionLabel(line.condition)}'),
              if (line.productionBatch?.isNotEmpty == true)
                Text('生产批次：${line.productionBatch}'),
              if (line.exceptionReason?.isNotEmpty == true)
                Text('异常原因：${line.exceptionReason}'),
              if (line.serializedSummary.total > 0)
                Text(
                  '瓶码匹配：原瓶 ${line.serializedSummary.matched}，'
                  '未知 ${line.serializedSummary.unknown}，'
                  '冲突 ${line.serializedSummary.conflict}',
                ),
              for (final unit in line.serializedUnits)
                Text(
                  '物流码 ${unit.scannedLogisticsCode} · '
                  '${_matchStatusLabel(unit.matchStatus)}',
                ),
            ],
            if (trailing != null) ...[
              const SizedBox(height: 8),
              Align(alignment: Alignment.centerRight, child: trailing),
            ],
          ],
        ),
      ),
    );
  }
}

class CustomerReturnReceiptEditor extends StatefulWidget {
  const CustomerReturnReceiptEditor({
    super.key,
    required this.api,
    required this.order,
    required this.warehouses,
    required this.products,
  });

  final InventoryApi api;
  final AfterSalesOrderRecord order;
  final List<WarehouseRecord> warehouses;
  final List<ProductOptionRecord> products;

  @override
  State<CustomerReturnReceiptEditor> createState() =>
      _CustomerReturnReceiptEditorState();
}

class _CustomerReturnReceiptEditorState
    extends State<CustomerReturnReceiptEditor> {
  final _formKey = GlobalKey<FormState>();
  final _notesController = TextEditingController();
  late final List<_ReceiptLineDraft> _drafts;
  String? _warehouseId;
  bool _loadingBatches = false;
  bool _submitting = false;
  bool _dirty = false;
  bool _allowPop = false;
  String? _error;
  String? _batchError;
  String? _sourceKey;
  String? _idempotencyKey;
  final Map<String, List<InventoryBatchRecord>> _batchesByProduct = {};

  @override
  void initState() {
    super.initState();
    for (final warehouse in widget.warehouses) {
      if (warehouse.isDefault) {
        _warehouseId = warehouse.id;
        break;
      }
    }
    _warehouseId ??=
        widget.warehouses.isEmpty ? null : widget.warehouses.first.id;
    final modes = {
      for (final product in widget.products)
        product.id: product.inventoryTrackingMode,
    };
    _drafts = widget.order.items
        .where((item) => item.returnRequired && item.remainingReturnQty > 0)
        .map(
          (item) => _ReceiptLineDraft(
            item: item,
            trackingMode: modes[item.productId] ?? 'none',
            originalUnits: _originalUnitsFor(widget.order, item),
            onChanged: _markDirty,
          ),
        )
        .toList();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadBatches());
  }

  @override
  void dispose() {
    _notesController.dispose();
    for (final draft in _drafts) {
      draft.dispose();
    }
    super.dispose();
  }

  void _markDirty() {
    if (!mounted) return;
    setState(() {
      _dirty = true;
      _sourceKey = null;
      _idempotencyKey = null;
    });
  }

  Future<void> _loadBatches() async {
    final warehouseId = _warehouseId;
    if (warehouseId == null) return;
    setState(() {
      _loadingBatches = true;
      _batchError = null;
      _batchesByProduct.clear();
    });
    final errors = <String>[];
    await Future.wait(
      _drafts
          .where(
        (draft) =>
            draft.trackingMode == 'quantity' && draft.item.productId != null,
      )
          .map((draft) async {
        try {
          final detail = await widget.api.getStock(
            warehouseId: warehouseId,
            productId: draft.item.productId!,
          );
          _batchesByProduct[draft.item.productId!] = detail.batches;
        } catch (error) {
          errors
              .add('${draft.item.productName}：${inventoryErrorMessage(error)}');
        }
      }),
    );
    if (!mounted) return;
    setState(() {
      _loadingBatches = false;
      _batchError = errors.isEmpty ? null : errors.join('；');
    });
  }

  Future<void> _requestClose() async {
    if (_submitting) return;
    if (!_dirty) {
      setState(() => _allowPop = true);
      Navigator.pop(context);
      return;
    }
    final discard = await confirmInventoryAction(
      context,
      title: '放弃未保存的收货草稿？',
      content: '已填写的数量、批次、物流码和备注将丢失。',
      confirmLabel: '放弃',
      danger: true,
    );
    if (!discard || !mounted) return;
    setState(() => _allowPop = true);
    Navigator.pop(context);
  }

  Future<void> _submit() async {
    if (_submitting) return;
    final warehouseId = _warehouseId;
    if (warehouseId == null || warehouseId.isEmpty) {
      setState(() => _error = '请选择收货仓库。');
      return;
    }
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final lines = <Map<String, dynamic>>[];
    final seenCodes = <String>{};
    for (final draft in _drafts) {
      final result = draft.toRequestLine(
        lineNo: lines.length + 1,
        seenCodes: seenCodes,
      );
      if (result.error != null) {
        setState(() => _error = result.error);
        return;
      }
      if (result.line != null) lines.add(result.line!);
    }
    if (lines.isEmpty) {
      setState(() => _error = '请至少登记一条正整数数量或一个物流码。');
      return;
    }
    final nonce = DateTime.now().microsecondsSinceEpoch;
    _sourceKey ??= 'flutter-after-sales-receipt-create:$nonce';
    _idempotencyKey ??= 'flutter-after-sales-receipt-create-idem:$nonce';
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await widget.api.createAfterSalesReceipt(
        afterSalesOrderId: widget.order.id,
        warehouseId: warehouseId,
        lines: lines,
        notes: _notesController.text.trim(),
        sourceKey: _sourceKey,
        idempotencyKey: _idempotencyKey,
      );
      if (!mounted) return;
      setState(() {
        _allowPop = true;
        _dirty = false;
      });
      Navigator.pop(context, true);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = inventoryErrorMessage(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope<bool>(
      canPop: _allowPop,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _requestClose();
      },
      child: InventoryKeyboardScope(
        onEscape: _submitting
            ? null
            : () {
                _requestClose();
              },
        child: Material(
          key: const ValueKey('customer-return-receipt-editor'),
          color: Theme.of(context).colorScheme.surface,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 8, 12),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        '登记本次实际收货',
                        style: Theme.of(context)
                            .textTheme
                            .titleLarge
                            ?.copyWith(fontWeight: FontWeight.w700),
                      ),
                    ),
                    IconButton(
                      key: const ValueKey('customer-return-editor-close'),
                      tooltip: '关闭',
                      onPressed: _submitting ? null : _requestClose,
                      icon: const Icon(Icons.close_rounded),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: Form(
                  key: _formKey,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      const InventoryInlineNotice(
                        message: '本步骤只保存 DRAFT 草稿，不增加库存。保存后还需在详情中二次确认“确认收货”。',
                        tone: StatusTone.info,
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        key:
                            const ValueKey('customer-return-receipt-warehouse'),
                        initialValue: _warehouseId,
                        decoration: const InputDecoration(labelText: '收货仓库'),
                        items: [
                          for (final warehouse in widget.warehouses)
                            DropdownMenuItem(
                              value: warehouse.id,
                              child:
                                  Text('${warehouse.code} · ${warehouse.name}'),
                            ),
                        ],
                        onChanged: _submitting
                            ? null
                            : (value) {
                                setState(() {
                                  _warehouseId = value;
                                  _dirty = true;
                                  _sourceKey = null;
                                  _idempotencyKey = null;
                                });
                                _loadBatches();
                              },
                        validator: (value) =>
                            value == null || value.isEmpty ? '请选择收货仓库' : null,
                      ),
                      if (_loadingBatches)
                        const Padding(
                          padding: EdgeInsets.only(top: 8),
                          child: LinearProgressIndicator(),
                        ),
                      if (_batchError != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: InventoryInlineNotice(
                            message: '已有批次加载失败：$_batchError。仍可不关联批次保存真实草稿。',
                            tone: StatusTone.warning,
                          ),
                        ),
                      const SizedBox(height: 16),
                      for (final draft in _drafts)
                        _ReceiptLineEditor(
                          draft: draft,
                          batches: draft.item.productId == null
                              ? const []
                              : _batchesByProduct[draft.item.productId] ??
                                  const [],
                          enabled: !_submitting,
                        ),
                      TextField(
                        key: const ValueKey('customer-return-receipt-notes'),
                        controller: _notesController,
                        enabled: !_submitting,
                        minLines: 2,
                        maxLines: 4,
                        decoration: const InputDecoration(labelText: '整单收货备注'),
                        onChanged: (_) => _markDirty(),
                      ),
                      if (_error != null) ...[
                        const SizedBox(height: 12),
                        InventoryInlineNotice(
                          message: _error!,
                          tone: StatusTone.danger,
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              const Divider(height: 1),
              SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      TextButton(
                        onPressed: _submitting ? null : _requestClose,
                        child: const Text('取消'),
                      ),
                      const SizedBox(width: 8),
                      FilledButton.icon(
                        key: const ValueKey('customer-return-save-draft'),
                        onPressed: _submitting ? null : _submit,
                        icon: _submitting
                            ? const SizedBox.square(
                                dimension: 16,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.save_outlined),
                        label: Text(_submitting ? '保存中...' : '保存收货草稿'),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ReceiptLineEditor extends StatelessWidget {
  const _ReceiptLineEditor({
    required this.draft,
    required this.batches,
    required this.enabled,
  });

  final _ReceiptLineDraft draft;
  final List<InventoryBatchRecord> batches;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final serialized = draft.trackingMode == 'serialized';
    return Card(
      key: ValueKey('customer-return-line-${draft.item.id}'),
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              draft.item.productName,
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
            Text('剩余待收 ${draft.item.remainingReturnQty} 瓶 · '
                '库存模式 ${draft.trackingMode.toUpperCase()}'),
            const SizedBox(height: 10),
            if (draft.trackingMode == 'none')
              const InventoryInlineNotice(
                message: '无法从真实 Product options 确认该商品的库存模式，本行暂不可登记。',
                tone: StatusTone.warning,
              )
            else if (serialized) ...[
              if (draft.originalUnits.isNotEmpty) ...[
                const Text('原订单已出库瓶码（点击可加入扫描框）'),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final unit in draft.originalUnits)
                      ActionChip(
                        key: ValueKey(
                          'customer-return-original-code-${unit.logisticsCode}',
                        ),
                        label: Text(
                          '${unit.logisticsCode ?? '无物流码'}'
                          '${unit.productionBatch == null ? '' : ' · ${unit.productionBatch}'}'
                          '${unit.batchSerialNo == null ? '' : ' · ${unit.batchSerialNo}'}',
                        ),
                        onPressed: !enabled || unit.logisticsCode == null
                            ? null
                            : () => draft.appendOriginalCode(unit),
                      ),
                  ],
                ),
                const SizedBox(height: 10),
              ] else
                const InventoryInlineNotice(
                  message: '当前角色投影未提供原订单瓶码。扫描结果只能按“异常待处理”保存，不能强制恢复为可售。',
                  tone: StatusTone.warning,
                ),
              TextFormField(
                key: ValueKey('customer-return-codes-${draft.item.id}'),
                controller: draft.codesController,
                enabled: enabled,
                minLines: 3,
                maxLines: 6,
                decoration: const InputDecoration(
                  labelText: '扫描/输入物流码',
                  helperText: '每行一个物流码；按字符串处理并保留前导零',
                ),
                onChanged: (_) => draft.changed(),
              ),
            ] else
              TextFormField(
                key: ValueKey('customer-return-qty-${draft.item.id}'),
                controller: draft.quantityController,
                enabled: enabled,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: const InputDecoration(
                  labelText: '本次实际数量（0 表示本次不收）',
                  suffixText: '瓶',
                ),
                validator: (value) {
                  final parsed = int.tryParse((value ?? '').trim());
                  if (parsed == null || parsed < 0) return '请输入非负整数';
                  if (parsed > draft.item.remainingReturnQty) {
                    return '不能超过剩余待收数量';
                  }
                  return null;
                },
                onChanged: (_) => draft.changed(),
              ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              key: ValueKey('customer-return-condition-${draft.item.id}'),
              initialValue: draft.condition,
              decoration: const InputDecoration(labelText: '收货状态'),
              items: const [
                DropdownMenuItem(value: 'SALEABLE', child: Text('可售')),
                DropdownMenuItem(value: 'UNAVAILABLE', child: Text('不可售')),
                DropdownMenuItem(
                  value: 'EXCEPTION',
                  child: Text('异常待处理（不返库存）'),
                ),
              ],
              onChanged: enabled
                  ? (value) {
                      if (value != null) {
                        draft.condition = value;
                        draft.changed();
                      }
                    }
                  : null,
            ),
            if (!serialized && batches.isNotEmpty) ...[
              const SizedBox(height: 10),
              DropdownButtonFormField<String?>(
                key: ValueKey('customer-return-batch-${draft.item.id}'),
                initialValue: draft.inventoryBatchId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: '关联已有批次（可选）'),
                items: [
                  const DropdownMenuItem(
                    value: null,
                    child: Text('不关联批次'),
                  ),
                  for (final batch in batches)
                    DropdownMenuItem(
                      value: batch.id,
                      child: Text(
                        batch.productionBatch?.isNotEmpty == true
                            ? batch.productionBatch!
                            : batch.id,
                      ),
                    ),
                ],
                onChanged: enabled
                    ? (value) {
                        draft.inventoryBatchId = value;
                        draft.changed();
                      }
                    : null,
              ),
            ],
            const SizedBox(height: 10),
            TextField(
              key: ValueKey('customer-return-exception-${draft.item.id}'),
              controller: draft.exceptionController,
              enabled: enabled,
              decoration: const InputDecoration(
                labelText: '异常原因（异常待处理时必填）',
              ),
              onChanged: (_) => draft.changed(),
            ),
            const SizedBox(height: 10),
            TextField(
              key: ValueKey('customer-return-line-note-${draft.item.id}'),
              controller: draft.noteController,
              enabled: enabled,
              decoration: const InputDecoration(labelText: '行备注'),
              onChanged: (_) => draft.changed(),
            ),
          ],
        ),
      ),
    );
  }
}

class _ReceiptLineDraft {
  _ReceiptLineDraft({
    required this.item,
    required this.trackingMode,
    required this.originalUnits,
    required this.onChanged,
  })  : quantityController = TextEditingController(text: '0'),
        codesController = TextEditingController(),
        exceptionController = TextEditingController(),
        noteController = TextEditingController();

  final AfterSalesOrderItemRecord item;
  final String trackingMode;
  final List<SalesOrderSerializedUnitRecord> originalUnits;
  final VoidCallback onChanged;
  final TextEditingController quantityController;
  final TextEditingController codesController;
  final TextEditingController exceptionController;
  final TextEditingController noteController;
  String condition = 'SALEABLE';
  String? inventoryBatchId;

  void changed() => onChanged();

  void appendOriginalCode(SalesOrderSerializedUnitRecord unit) {
    final code = unit.logisticsCode?.trim();
    if (code == null || code.isEmpty) return;
    final existing = _codes();
    if (existing.any((value) => value.toLowerCase() == code.toLowerCase())) {
      return;
    }
    codesController.text = [...existing, code].join('\n');
    changed();
  }

  ({Map<String, dynamic>? line, String? error}) toRequestLine({
    required int lineNo,
    required Set<String> seenCodes,
  }) {
    if (trackingMode == 'none') return (line: null, error: null);
    if (trackingMode == 'serialized') {
      final codes = _codes();
      if (codes.isEmpty) return (line: null, error: null);
      if (codes.length > item.remainingReturnQty) {
        return (
          line: null,
          error: '${item.productName} 的物流码数量不能超过剩余待收数量。',
        );
      }
      final originalByCode = <String, SalesOrderSerializedUnitRecord>{
        for (final unit in originalUnits)
          if (unit.logisticsCode?.trim().isNotEmpty == true)
            unit.logisticsCode!.trim().toLowerCase(): unit,
      };
      var hasUnconfirmed = originalByCode.isEmpty;
      final serializedUnits = <Map<String, dynamic>>[];
      for (final code in codes) {
        final normalized = code.toLowerCase();
        if (!seenCodes.add(normalized)) {
          return (line: null, error: '物流码 $code 重复，不能重复登记。');
        }
        final original = originalByCode[normalized];
        if (original == null) hasUnconfirmed = true;
        serializedUnits.add({
          if (original != null) 'originalSerializedUnitId': original.id,
          'scannedLogisticsCode': code,
        });
      }
      final effectiveCondition = hasUnconfirmed ? 'EXCEPTION' : condition;
      final exceptionReason = exceptionController.text.trim();
      if (effectiveCondition == 'EXCEPTION' && exceptionReason.isEmpty) {
        return (
          line: null,
          error: '${item.productName} 含非原瓶或无法确认的瓶码，请填写异常原因。',
        );
      }
      return (
        line: {
          'afterSalesOrderItemId': item.id,
          'lineNo': lineNo,
          'receivedQty': codes.length,
          'condition': effectiveCondition,
          if (exceptionReason.isNotEmpty) 'exceptionReason': exceptionReason,
          if (noteController.text.trim().isNotEmpty)
            'notes': noteController.text.trim(),
          'serializedUnits': serializedUnits,
        },
        error: null,
      );
    }
    final quantity = int.tryParse(quantityController.text.trim()) ?? 0;
    if (quantity == 0) return (line: null, error: null);
    if (quantity < 0 || quantity > item.remainingReturnQty) {
      return (line: null, error: '${item.productName} 的本次数量不合法。');
    }
    final exceptionReason = exceptionController.text.trim();
    if (condition == 'EXCEPTION' && exceptionReason.isEmpty) {
      return (
        line: null,
        error: '${item.productName} 选择异常待处理时必须填写原因。',
      );
    }
    return (
      line: {
        'afterSalesOrderItemId': item.id,
        'lineNo': lineNo,
        'receivedQty': quantity,
        'condition': condition,
        if (inventoryBatchId != null) 'inventoryBatchId': inventoryBatchId,
        if (exceptionReason.isNotEmpty) 'exceptionReason': exceptionReason,
        if (noteController.text.trim().isNotEmpty)
          'notes': noteController.text.trim(),
        'serializedUnits': const <Map<String, dynamic>>[],
      },
      error: null,
    );
  }

  List<String> _codes() => codesController.text
      .split(RegExp(r'[\r\n,，]+'))
      .map((value) => value.trim())
      .where((value) => value.isNotEmpty)
      .toList();

  void dispose() {
    quantityController.dispose();
    codesController.dispose();
    exceptionController.dispose();
    noteController.dispose();
  }
}

class _CustomerReturnRecord {
  const _CustomerReturnRecord({
    required this.order,
    required this.receipts,
    this.receiptError,
  });

  final AfterSalesOrderRecord order;
  final List<InventoryAfterSalesReceiptRecord> receipts;
  final String? receiptError;

  int get expectedQty => order.items
      .where((item) => item.returnRequired)
      .fold(0, (sum, item) => sum + item.expectedReturnQty);

  int get receivedQty => order.items
      .where((item) => item.returnRequired)
      .fold(0, (sum, item) => sum + item.postedReceivedQty);

  int get remainingQty => order.items
      .where((item) => item.returnRequired)
      .fold(0, (sum, item) => sum + item.remainingReturnQty);

  bool get hasAbnormal => receipts.any(
        (receipt) => !receipt.isReversed && receipt.hasException,
      );

  String get status {
    if (hasAbnormal) return 'abnormal';
    if (order.status == 'completed' &&
        expectedQty > 0 &&
        receivedQty >= expectedQty) {
      return 'completed';
    }
    if (receivedQty <= 0) return 'waiting';
    if (receivedQty < expectedQty) return 'partial';
    return 'received';
  }

  String get warehouseSummary {
    final names = receipts
        .where((receipt) => !receipt.isReversed)
        .map((receipt) => receipt.warehouseName ?? receipt.warehouseId)
        .where((name) => name.isNotEmpty)
        .toSet()
        .toList();
    return names.isEmpty ? '待选择' : names.join('、');
  }
}

class _DetailLine extends StatelessWidget {
  const _DetailLine({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 86,
            child: Text(
              label,
              style: TextStyle(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          Expanded(child: Text(value)),
        ],
      ),
    );
  }
}

List<SalesOrderSerializedUnitRecord> _originalUnitsFor(
  AfterSalesOrderRecord order,
  AfterSalesOrderItemRecord item,
) {
  final sourceOrder = order.sourceSalesOrder ?? order.salesOrder;
  if (sourceOrder == null) return const [];
  for (final sourceItem in sourceOrder.items) {
    if (item.sourceSalesOrderItemId != null &&
        sourceItem.id == item.sourceSalesOrderItemId) {
      return sourceItem.serializedUnits;
    }
    if (item.sourceSalesOrderItemId == null &&
        item.productId != null &&
        sourceItem.productId == item.productId) {
      return sourceItem.serializedUnits;
    }
  }
  return const [];
}

String _sourceOrderNo(AfterSalesOrderRecord order) =>
    order.sourceSalesOrder?.orderNo ??
    order.salesOrder?.orderNo ??
    order.salesOrderId;

String _customerName(AfterSalesOrderRecord order) =>
    order.sourceSalesOrder?.customerName ??
    order.salesOrder?.customerName ??
    order.customer?.name ??
    '未填写';

String _actionLabel(String value) {
  return switch (value) {
    'return_refund' => '退货退款',
    'exchange' => '换货',
    'resend' => '补发',
    'refund' => '退款',
    _ => value,
  };
}

String _dateLabel(String? value) {
  final normalized = value?.trim();
  if (normalized == null || normalized.isEmpty) return '暂未提供';
  return normalized
      .replaceFirst('T', ' ')
      .replaceFirst(RegExp(r'\.\d{3}Z$'), '');
}

String _itemProgressLabel(String value) {
  return switch (value) {
    'waiting_receive' => '待收货',
    'partially_received' => '部分收货',
    'received' => '已收货',
    _ => '无需退货',
  };
}

Widget _returnStatusTag(String status) {
  return switch (status) {
    'waiting' => const InventoryStatusTag(
        label: '待收货',
        tone: StatusTone.warning,
        icon: Icons.hourglass_empty_rounded,
      ),
    'partial' => const InventoryStatusTag(
        label: '部分收货',
        tone: StatusTone.info,
        icon: Icons.timelapse_rounded,
      ),
    'received' => const InventoryStatusTag(
        label: '已收货',
        tone: StatusTone.success,
        icon: Icons.inventory_rounded,
      ),
    'abnormal' => const InventoryStatusTag(
        label: '异常瓶码',
        tone: StatusTone.danger,
        icon: Icons.qr_code_2_rounded,
      ),
    'completed' => const InventoryStatusTag(
        label: '已完成',
        tone: StatusTone.success,
        icon: Icons.task_alt_rounded,
      ),
    _ => InventoryStatusTag(
        label: status,
        tone: StatusTone.neutral,
      ),
  };
}

Widget _receiptStatusTag(String status) {
  return switch (status) {
    'draft' => const InventoryStatusTag(
        label: '收货草稿',
        tone: StatusTone.warning,
        icon: Icons.edit_note_rounded,
      ),
    'posted' => const InventoryStatusTag(
        label: '库存已生效',
        tone: StatusTone.success,
        icon: Icons.inventory_rounded,
      ),
    'reversed' => const InventoryStatusTag(
        label: '已冲销',
        tone: StatusTone.neutral,
        icon: Icons.undo_rounded,
      ),
    _ => InventoryStatusTag(
        label: status,
        tone: StatusTone.neutral,
      ),
  };
}

String _conditionLabel(String value) {
  return switch (value) {
    'saleable' => '可售',
    'unavailable' => '不可售',
    'exception' => '异常待处理',
    _ => value,
  };
}

String _matchStatusLabel(String value) {
  return switch (value) {
    'matched' => '原瓶匹配',
    'unknown' => '未知瓶码',
    'conflict' => '瓶码冲突',
    _ => value,
  };
}
