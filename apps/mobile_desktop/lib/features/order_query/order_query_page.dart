import 'dart:io';

import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';
import 'package:path_provider/path_provider.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/mark_info_button.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/money_text.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/state_views.dart';
import '../../shared/widgets/status_tag.dart';
import '../travel_groups/travel_group_picker_dialog.dart';

class OrderQueryPage extends StatefulWidget {
  const OrderQueryPage({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
    this.documentsDirectoryProvider,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;
  final Future<Directory> Function()? documentsDirectoryProvider;

  @override
  State<OrderQueryPage> createState() => _OrderQueryPageState();
}

class _OrderQueryPageState extends State<OrderQueryPage> {
  late BusinessApi _businessApi;
  late final TextEditingController _queryController;
  late DateTime _start;
  late DateTime _end;

  String? _statusFilter;
  String? _deliveryFilter;
  String? _packingFilter;
  List<SalesOrderRecord> _orders = const <SalesOrderRecord>[];
  SalesOrderRecord? _selectedOrder;
  bool _loading = true;
  bool _detailLoading = false;
  bool _exporting = false;
  String? _errorMessage;
  String? _detailErrorMessage;
  final Set<String> _busyOrderIds = <String>{};
  final Set<String> _busyCustomerIds = <String>{};

  bool get _canMark =>
      widget.role == UserRole.admin || widget.role == UserRole.finance;

  bool get _canEditBasics =>
      widget.role == UserRole.admin ||
      widget.role == UserRole.sales ||
      widget.role == UserRole.finance;

  bool get _canEditFullOrder =>
      widget.role == UserRole.admin || widget.role == UserRole.finance;

  bool get _canGenerateQrSalesSheet =>
      widget.role == UserRole.admin || widget.role == UserRole.sales;

  bool get _canExportSalesOrders =>
      widget.role == UserRole.admin || widget.role == UserRole.finance;

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _queryController = TextEditingController();
    final now = DateTime.now();
    _start = DateTime(now.year, now.month, 1);
    _end = DateTime(now.year, now.month, now.day);
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadOrders());
  }

  @override
  void didUpdateWidget(covariant OrderQueryPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token ||
        oldWidget.role != widget.role) {
      _businessApi =
          BusinessApi(apiClient: widget.apiClient, token: widget.token);
      _loadOrders();
    }
  }

  @override
  void dispose() {
    _queryController.dispose();
    super.dispose();
  }

  Future<void> _loadOrders() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      final orders = await _businessApi.listSalesOrders(
        limit: 100,
        start: _start,
        end: _end,
        query: _queryController.text.trim(),
        status: _statusFilter,
        deliveryType: _deliveryFilter,
        packingStatus: _packingFilter,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _orders = orders;
        _selectedOrder = _selectedFrom(orders, _selectedOrder?.id);
        _loading = false;
        _detailErrorMessage = null;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _orders = const <SalesOrderRecord>[];
        _selectedOrder = null;
        _loading = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _selectOrder(SalesOrderRecord order) async {
    setState(() {
      _selectedOrder = order;
      _detailLoading = true;
      _detailErrorMessage = null;
    });

    try {
      final detail = await _businessApi.getSalesOrder(order.id);
      if (!mounted) {
        return;
      }
      _replaceOrder(detail);
      setState(() {
        _selectedOrder = detail;
        _detailLoading = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _detailLoading = false;
        _detailErrorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _toggleOrderMark(SalesOrderRecord order) async {
    setState(() {
      _busyOrderIds.add(order.id);
      _errorMessage = null;
      _detailErrorMessage = null;
    });
    try {
      final updated = await _businessApi.setSalesOrderFinanceMark(
        order.id,
        !order.financeMark,
      );
      if (!mounted) {
        return;
      }
      _replaceOrder(updated);
      setState(() => _busyOrderIds.remove(order.id));
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _busyOrderIds.remove(order.id);
        _detailErrorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _toggleCustomerMark(SalesOrderRecord order) async {
    final customer = order.customer;
    final customerId = order.customerId ?? customer?.id;
    if (customerId == null || customerId.isEmpty || customer == null) {
      setState(() {
        _detailErrorMessage = '旧订单未关联客户，不能在此标记客户。';
      });
      return;
    }

    setState(() {
      _busyCustomerIds.add(customerId);
      _errorMessage = null;
      _detailErrorMessage = null;
    });
    try {
      await _businessApi.setCustomerFinanceMark(
        customerId,
        !customer.financeMark,
      );
      final updated = await _businessApi.getSalesOrder(order.id);
      if (!mounted) {
        return;
      }
      _replaceOrder(updated);
      setState(() => _busyCustomerIds.remove(customerId));
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _busyCustomerIds.remove(customerId);
        _detailErrorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _openBasicEditDialog(SalesOrderRecord order) async {
    final result = await showDialog<_OrderEditResult>(
      context: context,
      builder: (context) => _OrderEditDialog(
        businessApi: _businessApi,
        order: order,
        fullEdit: _canEditFullOrder,
      ),
    );
    if (result == null) {
      return;
    }

    setState(() {
      _busyOrderIds.add(order.id);
      _detailErrorMessage = null;
    });
    try {
      var updated = await _businessApi.updateSalesOrder(
        order.id,
        result.orderPayload,
      );
      if (result.financePayload.isNotEmpty) {
        updated = await _businessApi.updateSalesOrderFinance(
          order.id,
          result.financePayload,
        );
      }
      if (result.packingPayload.isNotEmpty) {
        updated = await _businessApi.updateSalesOrderPacking(
          order.id,
          result.packingPayload,
        );
      }
      if (!mounted) {
        return;
      }
      _replaceOrder(updated);
      setState(() => _busyOrderIds.remove(order.id));
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${updated.orderNo} 已保存订单信息。')),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _busyOrderIds.remove(order.id);
        _detailErrorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _openQrSalesSheetDialog(SalesOrderRecord order) async {
    final generated = await showDialog<bool>(
      context: context,
      builder: (context) => _QrSalesSheetDialog(
        businessApi: _businessApi,
        order: order,
        canGenerate: _canGenerateQrSalesSheet,
      ),
    );
    if (generated == true && mounted) {
      await _selectOrder(order);
    }
  }

  Future<void> _exportSalesOrders() async {
    if (!_canExportSalesOrders || _exporting) {
      return;
    }

    setState(() {
      _exporting = true;
      _errorMessage = null;
    });

    try {
      final downloadedFile = await _businessApi.downloadSalesOrdersExcel(
        start: _start,
        end: _end,
        query: _queryController.text.trim(),
        status: _statusFilter,
        deliveryType: _deliveryFilter,
        packingStatus: _packingFilter,
      );
      final directory = await (widget.documentsDirectoryProvider?.call() ??
          getApplicationDocumentsDirectory());
      final exportDirectory = Directory(
        '${directory.path}${Platform.pathSeparator}exports',
      );
      await exportDirectory.create(recursive: true);
      final targetFile = await _nextExportFile(
        exportDirectory,
        _safeExportFileName(downloadedFile.fileName),
      );
      await targetFile.writeAsBytes(downloadedFile.bytes, flush: true);

      if (!mounted) {
        return;
      }
      setState(() => _exporting = false);
      ScaffoldMessenger.of(context).hideCurrentSnackBar();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('销售订单已导出：${targetFile.path}')),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      final message = _messageForError(error);
      setState(() {
        _exporting = false;
        _errorMessage = message;
      });
      ScaffoldMessenger.of(context).hideCurrentSnackBar();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    }
  }

  void _replaceOrder(SalesOrderRecord updated) {
    setState(() {
      _orders = [
        for (final order in _orders)
          if (order.id == updated.id) updated else order,
      ];
      if (_selectedOrder?.id == updated.id) {
        _selectedOrder = updated;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final selectedOrder = _selectedOrder;
    return ResponsivePage(
      children: [
        if (_errorMessage != null)
          Align(
            alignment: Alignment.centerLeft,
            child: StatusTag(label: _errorMessage!, tone: StatusTone.danger),
          ),
        if (_loading) const LinearProgressIndicator(),
        FormSection(
          title: '订单管理工作台',
          trailing: Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              StatusTag(
                label: '${_orders.length} 笔订单',
                tone: StatusTone.info,
              ),
              if (_canExportSalesOrders)
                OutlinedButton.icon(
                  key: const ValueKey('order-export-sales-orders-button'),
                  onPressed: _loading || _exporting ? null : _exportSalesOrders,
                  icon: _exporting
                      ? const SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.download_rounded),
                  label: Text(_exporting ? '导出中' : '导出 Excel'),
                ),
            ],
          ),
          children: [
            ResponsiveFormGrid(
              minItemWidth: 220,
              children: [
                TextField(
                  key: const ValueKey('order-query-search-field'),
                  controller: _queryController,
                  decoration: InputDecoration(
                    hintText: '搜索订单号、客户、电话、旅行团',
                    prefixIcon: const Icon(Icons.search_rounded),
                    suffixIcon: IconButton(
                      tooltip: '清空',
                      onPressed: () {
                        _queryController.clear();
                        _loadOrders();
                      },
                      icon: const Icon(Icons.close_rounded),
                    ),
                  ),
                  textInputAction: TextInputAction.search,
                  onSubmitted: (_) => _loadOrders(),
                ),
                AppDateRangeButton(
                  start: _start,
                  end: _end,
                  onChanged: (range) {
                    setState(() {
                      _start = range.start;
                      _end = range.end;
                    });
                    _loadOrders();
                  },
                ),
                _NullableDropdown(
                  key: const ValueKey('order-status-filter'),
                  label: '订单状态',
                  value: _statusFilter,
                  items: [
                    for (final status in OrderStatus.values)
                      MapEntry(status.value, status.label),
                  ],
                  onChanged: (value) {
                    setState(() => _statusFilter = value);
                    _loadOrders();
                  },
                ),
                _NullableDropdown(
                  key: const ValueKey('order-delivery-filter'),
                  label: '配送方式',
                  value: _deliveryFilter,
                  items: [
                    for (final type in DeliveryType.values)
                      MapEntry(type.value, type.label),
                  ],
                  onChanged: (value) {
                    setState(() => _deliveryFilter = value);
                    _loadOrders();
                  },
                ),
                _NullableDropdown(
                  key: const ValueKey('order-packing-filter'),
                  label: '打包状态',
                  value: _packingFilter,
                  items: [
                    for (final status in PackingStatus.values)
                      MapEntry(status.value, status.label),
                  ],
                  onChanged: (value) {
                    setState(() => _packingFilter = value);
                    _loadOrders();
                  },
                ),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              alignment: WrapAlignment.end,
              children: [
                TextButton.icon(
                  onPressed: _loading ? null : _loadOrders,
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text('刷新'),
                ),
                FilledButton.icon(
                  key: const ValueKey('order-query-search-button'),
                  onPressed: _loading ? null : _loadOrders,
                  icon: const Icon(Icons.search_rounded),
                  label: const Text('查询订单'),
                ),
              ],
            ),
          ],
        ),
        MetricGrid(
          metrics: [
            MetricData(
              label: '订单数',
              value: '${_orders.length}',
              icon: Icons.receipt_long_rounded,
            ),
            MetricData(
              label: '订单金额',
              value: formatMoneyCents(
                _orders.fold<int>(
                  0,
                  (sum, item) => sum + item.totalAmountCents,
                ),
              ),
              icon: Icons.payments_rounded,
            ),
            MetricData(
              label: '待打包',
              value:
                  '${_orders.where((item) => item.packingStatus == PackingStatus.pending.value).length}',
              icon: Icons.inventory_2_rounded,
            ),
            MetricData(
              label: '订单已标记',
              value: '${_orders.where((item) => item.financeMark).length}',
              icon: Icons.bookmark_added_rounded,
            ),
          ],
        ),
        ResponsiveTwoColumn(
          primaryFlex: 3,
          secondaryFlex: 2,
          primary: FormSection(
            title: '订单列表',
            trailing: StatusTag(
              label:
                  selectedOrder == null ? '未选择' : '已选 ${selectedOrder.orderNo}',
              tone:
                  selectedOrder == null ? StatusTone.neutral : StatusTone.info,
            ),
            children: [
              _OrderList(
                orders: _orders,
                selectedId: selectedOrder?.id,
                loading: _loading,
                onSelect: _selectOrder,
              ),
            ],
          ),
          secondary: _OrderDetailPanel(
            order: selectedOrder,
            role: widget.role,
            loading: _detailLoading,
            errorMessage: _detailErrorMessage,
            canMark: _canMark,
            canEditBasics: _canEditBasics,
            orderBusy: selectedOrder == null ||
                _busyOrderIds.contains(selectedOrder.id),
            customerBusy: selectedOrder == null ||
                _busyCustomerIds.contains(
                  selectedOrder.customerId ?? selectedOrder.customer?.id ?? '',
                ),
            onToggleOrderMark: selectedOrder == null
                ? null
                : () => _toggleOrderMark(selectedOrder),
            onToggleCustomerMark: selectedOrder == null
                ? null
                : () => _toggleCustomerMark(selectedOrder),
            onEditBasics: selectedOrder == null
                ? null
                : () => _openBasicEditDialog(selectedOrder),
            onOpenQrSalesSheet: selectedOrder == null
                ? null
                : () => _openQrSalesSheetDialog(selectedOrder),
          ),
        ),
      ],
    );
  }
}

class _OrderList extends StatelessWidget {
  const _OrderList({
    required this.orders,
    required this.selectedId,
    required this.loading,
    required this.onSelect,
  });

  final List<SalesOrderRecord> orders;
  final String? selectedId;
  final bool loading;
  final ValueChanged<SalesOrderRecord> onSelect;

  @override
  Widget build(BuildContext context) {
    if (!loading && orders.isEmpty) {
      return const _InlinePanelState(
        icon: Icons.inbox_rounded,
        title: '暂无匹配订单',
      );
    }
    if (loading && orders.isEmpty) {
      return const _InlinePanelState(
        icon: Icons.hourglass_top_rounded,
        title: '正在加载订单',
        loading: true,
      );
    }

    return ListView.separated(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: orders.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (context, index) {
        final order = orders[index];
        final selected = selectedId == order.id;
        return ListTile(
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
          selected: selected,
          selectedTileColor:
              Theme.of(context).colorScheme.primary.withValues(alpha: 0.07),
          leading: CircleAvatar(
            child: Icon(
              selected
                  ? Icons.radio_button_checked_rounded
                  : Icons.receipt_long_rounded,
              size: 20,
            ),
          ),
          title: Wrap(
            spacing: 8,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(
                order.orderNo,
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
              StatusTag(
                label: _statusLabel(order.status),
                tone: _statusTone(order.status),
              ),
              StatusTag(
                label: _deliverySummaryLabel(order),
                tone: StatusTone.info,
              ),
            ],
          ),
          subtitle: Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Wrap(
              spacing: 10,
              runSpacing: 5,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                    '${order.customerName} · ${order.customerPhone ?? '未填电话'}'),
                Text(_travelGroupLabel(order)),
                StatusTag(
                  label: _customerMarked(order) ? '客户已标记' : '客户未标记',
                  tone: _customerMarked(order)
                      ? StatusTone.success
                      : StatusTone.neutral,
                ),
                StatusTag(
                  label: order.financeMark ? '订单已标记' : '订单未标记',
                  tone: order.financeMark
                      ? StatusTone.success
                      : StatusTone.neutral,
                ),
              ],
            ),
          ),
          trailing: MoneyText(cents: order.totalAmountCents),
          onTap: () => onSelect(order),
        );
      },
    );
  }
}

class _OrderDetailPanel extends StatelessWidget {
  const _OrderDetailPanel({
    required this.order,
    required this.role,
    required this.loading,
    required this.errorMessage,
    required this.canMark,
    required this.canEditBasics,
    required this.orderBusy,
    required this.customerBusy,
    required this.onToggleOrderMark,
    required this.onToggleCustomerMark,
    required this.onEditBasics,
    required this.onOpenQrSalesSheet,
  });

  final SalesOrderRecord? order;
  final UserRole role;
  final bool loading;
  final String? errorMessage;
  final bool canMark;
  final bool canEditBasics;
  final bool orderBusy;
  final bool customerBusy;
  final VoidCallback? onToggleOrderMark;
  final VoidCallback? onToggleCustomerMark;
  final VoidCallback? onEditBasics;
  final VoidCallback? onOpenQrSalesSheet;

  @override
  Widget build(BuildContext context) {
    final order = this.order;
    if (order == null) {
      return const EmptyState(title: '请选择订单');
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        FormSection(
          title: '订单操作',
          trailing: StatusTag(
            label: _statusLabel(order.status),
            tone: _statusTone(order.status),
          ),
          children: [
            if (loading) const LinearProgressIndicator(),
            if (errorMessage != null) ...[
              StatusTag(label: errorMessage!, tone: StatusTone.danger),
              const SizedBox(height: 12),
            ],
            _OrderOverviewBlock(order: order),
            const SizedBox(height: 14),
            _ActionStrip(
              order: order,
              role: role,
              canMark: canMark,
              canEditBasics: canEditBasics,
              orderBusy: orderBusy,
              customerBusy: customerBusy,
              onToggleOrderMark: onToggleOrderMark,
              onToggleCustomerMark: onToggleCustomerMark,
              onEditBasics: onEditBasics,
              onOpenQrSalesSheet: onOpenQrSalesSheet,
            ),
          ],
        ),
        const SizedBox(height: 16),
        FormSection(
          title: '订单详情',
          trailing: StatusTag(
            label: order.financeMark ? '订单已标记' : '订单未标记',
            tone: order.financeMark ? StatusTone.success : StatusTone.neutral,
          ),
          children: [
            const _SectionTitle('基础信息'),
            _InfoRow(label: '系统单号', value: order.orderNo),
            _InfoRow(label: '订单日期', value: order.orderDate),
            _InfoRow(label: '订单类型', value: _orderTypeLabel(order.orderType)),
            _InfoRow(label: '销售单号', value: _display(order.salesFormNo)),
            _InfoRow(label: '旅行团', value: _travelGroupLabel(order)),
            _InfoRow(label: '销售人员', value: _display(order.salesUserId)),
            const Divider(height: 24),
            const _SectionTitle('客户快照'),
            _InfoRow(label: '客户姓名', value: _display(order.customerName)),
            _InfoRow(label: '客户电话', value: _display(order.customerPhone)),
            _InfoRow(label: '收货地址', value: _orderAddress(order)),
            _InfoRow(
              label: '客户标记',
              value: order.customer == null
                  ? '旧订单未关联客户'
                  : order.customer!.financeMark
                      ? '已标记'
                      : '未标记',
            ),
            const Divider(height: 24),
            const _SectionTitle('订单明细'),
            if (order.items.isEmpty)
              const Text('暂无明细')
            else
              for (final item in _sortedItems(order.items))
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _OrderItemLine(item: item),
                ),
            const Divider(height: 24),
            const _SectionTitle('金额与开票'),
            _InfoMoneyRow(label: '订单金额', cents: order.totalAmountCents),
            _InfoMoneyRow(
                label: '货到付款', cents: order.cashOnDeliveryAmountCents),
            _InfoRow(label: '客户需开票', value: order.invoiceRequired ? '是' : '否'),
            _InfoRow(label: '财务已开票', value: order.invoiceIssued ? '是' : '否'),
            _InfoRow(label: '财务备注', value: _display(order.financeRemark)),
            const Divider(height: 24),
            const _SectionTitle('物流与库管'),
            _InfoRow(label: '配送摘要', value: _deliverySummaryLabel(order)),
            _InfoRow(
              label: '打包状态',
              value: _packingStatusLabel(order.packingStatus),
            ),
            _InfoRow(label: '物流方式', value: _display(order.logisticsMethod)),
            _InfoRow(label: '物流单号', value: _display(order.logisticsNo)),
            _InfoMoneyRow(label: '物流运费', cents: order.logisticsFeeCents),
            _InfoRow(label: '打包件数', value: '${order.packageCount}'),
            _InfoRow(label: '库管备注', value: _display(order.warehouseRemark)),
            const Divider(height: 24),
            _InfoRow(label: '订单标记', value: order.financeMark ? '已标记' : '未标记'),
          ],
        ),
      ],
    );
  }
}

class _OrderOverviewBlock extends StatelessWidget {
  const _OrderOverviewBlock({required this.order});

  final SalesOrderRecord order;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(Radius.circular(8)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              spacing: 10,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  order.orderNo,
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
                StatusTag(
                  label: _orderTypeLabel(order.orderType),
                  tone: StatusTone.info,
                ),
                StatusTag(
                  label: _packingStatusLabel(order.packingStatus),
                  tone: StatusTone.neutral,
                ),
              ],
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 16,
              runSpacing: 8,
              children: [
                _OverviewValue(
                  label: '客户',
                  value:
                      '${_display(order.customerName)} · ${_display(order.customerPhone)}',
                ),
                _OverviewValue(
                  label: '订单金额',
                  value: formatMoneyCents(order.totalAmountCents),
                ),
                _OverviewValue(
                  label: '旅行团',
                  value: _travelGroupLabel(order),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _OverviewValue extends StatelessWidget {
  const _OverviewValue({
    required this.label,
    required this.value,
  });

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(minWidth: 130, maxWidth: 260),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}

class _InlinePanelState extends StatelessWidget {
  const _InlinePanelState({
    required this.icon,
    required this.title,
    this.loading = false,
  });

  final IconData icon;
  final String title;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (loading)
            const SizedBox.square(
              dimension: 24,
              child: CircularProgressIndicator(strokeWidth: 2.4),
            )
          else
            Icon(icon, size: 30, color: Theme.of(context).colorScheme.primary),
          const SizedBox(height: 10),
          Text(
            title,
            textAlign: TextAlign.center,
            style: Theme.of(context)
                .textTheme
                .titleSmall
                ?.copyWith(fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}

class _ActionStrip extends StatelessWidget {
  const _ActionStrip({
    required this.order,
    required this.role,
    required this.canMark,
    required this.canEditBasics,
    required this.orderBusy,
    required this.customerBusy,
    required this.onToggleOrderMark,
    required this.onToggleCustomerMark,
    required this.onEditBasics,
    required this.onOpenQrSalesSheet,
  });

  final SalesOrderRecord order;
  final UserRole role;
  final bool canMark;
  final bool canEditBasics;
  final bool orderBusy;
  final bool customerBusy;
  final VoidCallback? onToggleOrderMark;
  final VoidCallback? onToggleCustomerMark;
  final VoidCallback? onEditBasics;
  final VoidCallback? onOpenQrSalesSheet;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: [
        if (role == UserRole.boss)
          const StatusTag(label: '老板只读', tone: StatusTone.neutral),
        if (role == UserRole.finance)
          const StatusTag(label: '财务可维护订单信息', tone: StatusTone.info),
        if (canMark) ...[
          MarkInfoButton(
            marked: order.customer?.financeMark ?? false,
            label: '客户标记',
            busy: customerBusy,
            onPressed: order.customer == null || customerBusy
                ? null
                : onToggleCustomerMark,
          ),
          MarkInfoButton(
            marked: order.financeMark,
            label: '订单标记',
            busy: orderBusy,
            onPressed: orderBusy ? null : onToggleOrderMark,
          ),
        ],
        if (canEditBasics)
          OutlinedButton.icon(
            key: const ValueKey('order-basic-edit-button'),
            onPressed: orderBusy ? null : onEditBasics,
            icon: const Icon(Icons.edit_rounded),
            label: Text(role == UserRole.sales ? '编辑基础字段' : '编辑订单信息'),
          ),
        if (_canViewQrSalesSheet(role))
          OutlinedButton.icon(
            key: const ValueKey('order-qr-sales-sheet-button'),
            onPressed: onOpenQrSalesSheet,
            icon: const Icon(Icons.qr_code_2_rounded),
            label: Text(
              _canGenerateQrSalesSheetForRole(role) ? '二维码销售单' : '查看二维码',
            ),
          ),
        if (role == UserRole.afterSales)
          const StatusTag(label: '售后查询定位', tone: StatusTone.info),
      ],
    );
  }
}

class _QrSalesSheetDialog extends StatefulWidget {
  const _QrSalesSheetDialog({
    required this.businessApi,
    required this.order,
    required this.canGenerate,
  });

  final BusinessApi businessApi;
  final SalesOrderRecord order;
  final bool canGenerate;

  @override
  State<_QrSalesSheetDialog> createState() => _QrSalesSheetDialogState();
}

class _QrSalesSheetDialogState extends State<_QrSalesSheetDialog> {
  SalesSheetRecord? _salesSheet;
  bool _loading = true;
  bool _generating = false;
  bool _generated = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadSalesSheet());
  }

  Future<void> _loadSalesSheet() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      final salesSheet =
          await widget.businessApi.getSalesOrderSalesSheet(widget.order.id);
      if (!mounted) {
        return;
      }
      setState(() {
        _salesSheet = salesSheet;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _loading = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _generateQrCode() async {
    if (!widget.canGenerate || _generating) {
      return;
    }

    setState(() {
      _generating = true;
      _errorMessage = null;
    });

    try {
      final salesSheet = await widget.businessApi.generateSalesOrderQrCode(
        widget.order.id,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _salesSheet = salesSheet;
        _generating = false;
        _generated = true;
      });
      ScaffoldMessenger.of(context).hideCurrentSnackBar();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('二维码已生成。')),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _generating = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  void _close() {
    Navigator.of(context).pop(_generated);
  }

  @override
  Widget build(BuildContext context) {
    final sheet = _salesSheet;
    final qrCode = sheet?.qrCode;
    final url = qrCode?.url;
    final hasUrl = url != null && url.trim().isNotEmpty;
    return AlertDialog(
      title: Text('${widget.order.orderNo} 二维码销售单'),
      content: SizedBox(
        width: 760,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              if (_loading) ...[
                const LinearProgressIndicator(),
                const SizedBox(height: 14),
              ],
              if (_errorMessage != null) ...[
                StatusTag(label: _errorMessage!, tone: StatusTone.danger),
                const SizedBox(height: 14),
              ],
              if (sheet == null && !_loading)
                const _DialogStateLine(
                  icon: Icons.receipt_long_rounded,
                  text: '销售单预览暂不可用',
                )
              else if (sheet != null)
                ResponsiveTwoColumn(
                  breakpoint: 640,
                  primary: _SalesSheetDialogDetails(sheet: sheet),
                  secondary: _SalesSheetQrPreview(
                    qrCode: qrCode,
                  ),
                ),
              if (!hasUrl && !widget.canGenerate) ...[
                const SizedBox(height: 12),
                const StatusTag(
                  label: '当前订单暂无二维码，请联系销售或管理员生成。',
                  tone: StatusTone.warning,
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _close,
          child: const Text('关闭'),
        ),
        if (widget.canGenerate && !hasUrl)
          FilledButton.icon(
            key: const ValueKey('order-qr-generate-button'),
            onPressed: _loading || _generating ? null : _generateQrCode,
            icon: _generating
                ? const SizedBox.square(
                    dimension: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.qr_code_2_rounded),
            label: Text(_generating ? '生成中' : '生成二维码'),
          ),
      ],
    );
  }
}

class _SalesSheetDialogDetails extends StatelessWidget {
  const _SalesSheetDialogDetails({required this.sheet});

  final SalesSheetRecord sheet;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _SectionTitle('销售单预览'),
        _InfoRow(label: '系统单号', value: _display(sheet.order.orderNo)),
        _InfoRow(label: '销售单号', value: _display(sheet.order.salesFormNo)),
        _InfoRow(label: '订单日期', value: _display(sheet.order.orderDate)),
        _InfoRow(
          label: '客户',
          value:
              '${_display(sheet.customer.name)} · ${_display(sheet.customer.phoneMasked ?? sheet.customer.phone)}',
        ),
        _InfoRow(label: '旅行团', value: _salesSheetTravelGroupLabel(sheet)),
        _InfoRow(
          label: '销售',
          value: _display(sheet.salesUser?.name ?? sheet.salesUser?.username),
        ),
        _InfoRow(
          label: '状态',
          value: _display(sheet.status.label ?? sheet.status.value),
        ),
        const Divider(height: 20),
        const _SectionTitle('明细'),
        if (sheet.items.isEmpty)
          const Text('暂无明细')
        else
          for (final item in _sortedSalesSheetItems(sheet.items))
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text(
                '${_display(item.productName)} x${item.quantity} · ${formatMoneyCents(item.subtotalCents)}',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
        const Divider(height: 20),
        Row(
          children: [
            const Expanded(child: Text('订单金额')),
            MoneyText(cents: sheet.amounts.totalAmountCents, prominent: true),
          ],
        ),
        const SizedBox(height: 6),
        Row(
          children: [
            const Expanded(child: Text('货到付款')),
            MoneyText(cents: sheet.amounts.cashOnDeliveryAmountCents),
          ],
        ),
      ],
    );
  }
}

class _SalesSheetQrPreview extends StatelessWidget {
  const _SalesSheetQrPreview({
    required this.qrCode,
  });

  final SalesSheetQrCode? qrCode;

  @override
  Widget build(BuildContext context) {
    final url = qrCode?.url;
    final hasUrl = url != null && url.trim().isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        DecoratedBox(
          decoration: BoxDecoration(
            color: Colors.white,
            border: Border.all(color: Theme.of(context).dividerColor),
            borderRadius: const BorderRadius.all(Radius.circular(8)),
          ),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: AspectRatio(
              aspectRatio: 1,
              child: Center(
                child: hasUrl
                    ? QrImageView(
                        data: url,
                        version: QrVersions.auto,
                        errorCorrectionLevel: QrErrorCorrectLevel.M,
                        backgroundColor: Colors.white,
                      )
                    : Icon(
                        Icons.qr_code_2_rounded,
                        size: 82,
                        color: Theme.of(context)
                            .colorScheme
                            .primary
                            .withValues(alpha: 0.45),
                      ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 10),
        _InfoRow(label: '公开链接', value: hasUrl ? url : '尚未生成二维码'),
        _InfoRow(label: '有效期', value: _qrExpiresLabel(qrCode)),
        Text(
          hasUrl ? '请客户拍照保存销售单和二维码。' : '生成后将显示公开扫码链接。',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
        ),
      ],
    );
  }
}

class _DialogStateLine extends StatelessWidget {
  const _DialogStateLine({
    required this.icon,
    required this.text,
  });

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 34, color: Theme.of(context).colorScheme.primary),
          const SizedBox(height: 10),
          Text(
            text,
            textAlign: TextAlign.center,
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}

class _OrderItemLine extends StatelessWidget {
  const _OrderItemLine({required this.item});

  final SalesOrderItemRecord item;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        borderRadius: const BorderRadius.all(Radius.circular(8)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    item.productName,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
                StatusTag(
                  label: _deliveryTypeLabel(item.deliveryType),
                  tone: StatusTone.neutral,
                ),
              ],
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 12,
              runSpacing: 6,
              children: [
                Text('数量 x${item.quantity}'),
                Text('单价 ${formatMoneyCents(item.unitPriceCents)}'),
                Text('小计 ${formatMoneyCents(item.subtotalCents)}'),
                if (item.notes != null) Text('备注：${item.notes}'),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _OrderEditResult {
  const _OrderEditResult({
    required this.orderPayload,
    this.financePayload = const <String, dynamic>{},
    this.packingPayload = const <String, dynamic>{},
  });

  final Map<String, dynamic> orderPayload;
  final Map<String, dynamic> financePayload;
  final Map<String, dynamic> packingPayload;
}

class _OrderEditDialog extends StatefulWidget {
  const _OrderEditDialog({
    required this.businessApi,
    required this.order,
    required this.fullEdit,
  });

  final BusinessApi businessApi;
  final SalesOrderRecord order;
  final bool fullEdit;

  @override
  State<_OrderEditDialog> createState() => _OrderEditDialogState();
}

class _OrderEditDialogState extends State<_OrderEditDialog> {
  late DateTime _orderDate;
  late String _orderType;
  late String _status;
  late String _packingStatus;
  late final TextEditingController _salesFormNoController;
  late final TextEditingController _salesUserIdController;
  late final TextEditingController _codController;
  late final TextEditingController _remarkController;
  late final TextEditingController _travelGroupIdController;
  late final TextEditingController _customerNameController;
  late final TextEditingController _customerPhoneController;
  late final TextEditingController _addressController;
  late final TextEditingController _logisticsNoController;
  late final TextEditingController _logisticsFeeController;
  late final TextEditingController _financeRemarkController;
  late final TextEditingController _logisticsMethodController;
  late final TextEditingController _packageCountController;
  late final TextEditingController _warehouseRemarkController;
  late final List<String> _provinceOptions;
  late List<_EditableOrderItemDraft> _items;
  String? _province;
  String? _city;
  String? _district;
  late bool _invoiceRequired;
  late bool _invoiceIssued;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _orderDate = DateTime.tryParse(widget.order.orderDate) ?? DateTime.now();
    _orderType = _knownOrderTypeValue(widget.order.orderType);
    _status = _knownOrderStatusValue(widget.order.status);
    _packingStatus = _knownPackingStatusValue(widget.order.packingStatus);
    _salesFormNoController =
        TextEditingController(text: widget.order.salesFormNo ?? '');
    _salesUserIdController =
        TextEditingController(text: widget.order.salesUserId ?? '');
    _codController = TextEditingController(
      text: _moneyInputText(widget.order.cashOnDeliveryAmountCents),
    );
    _remarkController = TextEditingController(text: widget.order.remark ?? '');
    _travelGroupIdController =
        TextEditingController(text: widget.order.travelGroupId ?? '');
    _customerNameController = TextEditingController(
      text: widget.order.customer?.name ?? widget.order.customerName,
    );
    _customerPhoneController = TextEditingController(
      text: widget.order.customer?.phone ?? widget.order.customerPhone ?? '',
    );
    _province = widget.order.customer?.province ?? widget.order.province;
    _city = widget.order.customer?.city ?? widget.order.city;
    _district = widget.order.customer?.district ?? widget.order.district;
    _addressController = TextEditingController(
      text: widget.order.customer?.address ?? widget.order.address ?? '',
    );
    _logisticsNoController =
        TextEditingController(text: widget.order.logisticsNo ?? '');
    _logisticsFeeController = TextEditingController(
      text: _moneyInputText(widget.order.logisticsFeeCents),
    );
    _financeRemarkController =
        TextEditingController(text: widget.order.financeRemark ?? '');
    _logisticsMethodController =
        TextEditingController(text: widget.order.logisticsMethod ?? '');
    _packageCountController =
        TextEditingController(text: '${widget.order.packageCount}');
    _warehouseRemarkController =
        TextEditingController(text: widget.order.warehouseRemark ?? '');
    _provinceOptions = administrativeProvinceNames();
    _items = _sortedItems(widget.order.items)
        .map(_EditableOrderItemDraft.fromRecord)
        .toList();
    if (_items.isEmpty) {
      _items = [_EditableOrderItemDraft.empty()];
    }
    _invoiceRequired = widget.order.invoiceRequired;
    _invoiceIssued = widget.order.invoiceIssued;
  }

  @override
  void dispose() {
    _salesFormNoController.dispose();
    _salesUserIdController.dispose();
    _codController.dispose();
    _remarkController.dispose();
    _travelGroupIdController.dispose();
    _customerNameController.dispose();
    _customerPhoneController.dispose();
    _addressController.dispose();
    _logisticsNoController.dispose();
    _logisticsFeeController.dispose();
    _financeRemarkController.dispose();
    _logisticsMethodController.dispose();
    _packageCountController.dispose();
    _warehouseRemarkController.dispose();
    for (final item in _items) {
      item.dispose();
    }
    super.dispose();
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      firstDate: DateTime(2024),
      lastDate: DateTime(2030),
      initialDate: _orderDate,
      locale: const Locale('zh', 'CN'),
    );
    if (picked != null) {
      setState(() => _orderDate = picked);
    }
  }

  Future<void> _selectTravelGroup() async {
    final selected = await showDialog<TravelGroupRecord>(
      context: context,
      builder: (context) => TravelGroupPickerDialog(
        businessApi: widget.businessApi,
        initialQuery: widget.order.travelGroup?.groupNo ??
            _travelGroupIdController.text.trim(),
      ),
    );
    if (selected == null) {
      return;
    }
    setState(() {
      _travelGroupIdController.text = selected.id;
    });
  }

  void _addItem() {
    setState(() => _items.add(_EditableOrderItemDraft.empty()));
  }

  void _deleteItem(int index) {
    if (_items.length == 1) {
      setState(() => _errorMessage = '订单至少保留一条酒品明细。');
      return;
    }
    setState(() {
      final removed = _items.removeAt(index);
      removed.dispose();
      _errorMessage = null;
    });
  }

  void _updateItemDeliveryType(int index, DeliveryType deliveryType) {
    setState(() => _items[index].deliveryType = deliveryType);
  }

  void _submit() {
    final codCents = _moneyCentsOrNull(_codController.text);
    if (codCents == null) {
      setState(() => _errorMessage = '货到付款金额必须为有效的非负金额。');
      return;
    }
    final orderPayload = <String, dynamic>{
      'salesFormNo': _salesFormNoController.text.trim(),
      'orderDate': formatDate(_orderDate),
      'cashOnDeliveryAmountCents': codCents,
      'invoiceRequired': _invoiceRequired,
    };

    if (!widget.fullEdit) {
      Navigator.of(context).pop(_OrderEditResult(orderPayload: orderPayload));
      return;
    }

    final customerName = _customerNameController.text.trim();
    if (customerName.isEmpty) {
      setState(() => _errorMessage = '客户姓名不能为空。');
      return;
    }
    final itemPayloads = _buildItemPayloads();
    if (itemPayloads == null) {
      return;
    }
    final logisticsFeeCents = _moneyCentsOrNull(_logisticsFeeController.text);
    if (logisticsFeeCents == null) {
      setState(() => _errorMessage = '物流运费必须为有效的非负金额。');
      return;
    }
    final packageCount = _packageCountOrNull(_packageCountController.text);
    if (packageCount == null) {
      setState(() => _errorMessage = '打包件数必须是 0 或正整数。');
      return;
    }
    final travelGroupId = _travelGroupIdController.text.trim();
    if (_orderType == 'travel_group' && travelGroupId.isEmpty) {
      setState(() => _errorMessage = '旅行团订单必须关联旅行团。');
      return;
    }

    orderPayload.addAll({
      'orderType': _orderType,
      'salesUserId': _salesUserIdController.text.trim(),
      'travelGroupId': _orderType == 'travel_group' ? travelGroupId : null,
      'remark': _remarkController.text.trim(),
      'customer': {
        'name': customerName,
        'phone': _customerPhoneController.text.trim(),
        'province': _province?.trim() ?? '',
        'city': _city?.trim() ?? '',
        'district': _district?.trim() ?? '',
        'address': _addressController.text.trim(),
      },
      'items': itemPayloads,
    });
    final customerId = widget.order.customerId?.trim();
    if (customerId != null && customerId.isNotEmpty) {
      orderPayload['customerId'] = customerId;
    }

    Navigator.of(context).pop(
      _OrderEditResult(
        orderPayload: orderPayload,
        financePayload: {
          'logisticsNo': _logisticsNoController.text.trim(),
          'logisticsFeeCents': logisticsFeeCents,
          'invoiceIssued': _invoiceIssued,
          'financeRemark': _financeRemarkController.text.trim(),
          'status': _status,
        },
        packingPayload: {
          'logisticsMethod': _logisticsMethodController.text.trim(),
          'packingStatus': _packingStatus,
          'packageCount': packageCount,
          'warehouseRemark': _warehouseRemarkController.text.trim(),
        },
      ),
    );
  }

  List<Map<String, dynamic>>? _buildItemPayloads() {
    final payloads = <Map<String, dynamic>>[];
    for (var index = 0; index < _items.length; index += 1) {
      final item = _items[index];
      if (item.name.isEmpty) {
        setState(() => _errorMessage = '第 ${index + 1} 条明细请填写酒品名称。');
        return null;
      }
      if (item.quantity <= 0) {
        setState(() => _errorMessage = '第 ${index + 1} 条明细数量必须大于 0。');
        return null;
      }
      final unitPriceCents = item.unitPriceCentsOrNull;
      if (unitPriceCents == null) {
        setState(() => _errorMessage = '第 ${index + 1} 条明细单价格式不正确。');
        return null;
      }
      payloads.add({
        'productName': item.name,
        'quantity': item.quantity,
        'unitPriceCents': unitPriceCents,
        'deliveryType': item.deliveryType.value,
        'notes': item.notes,
        'sortOrder': index + 1,
      });
    }
    if (payloads.isEmpty) {
      setState(() => _errorMessage = '订单至少保留一条酒品明细。');
      return null;
    }
    return payloads;
  }

  @override
  Widget build(BuildContext context) {
    final cityOptions = _optionsWithCurrent(
      administrativeCitiesForProvince(_province),
      _city,
    );
    final districtOptions = _optionsWithCurrent(
      administrativeDistrictsForCity(_province, _city),
      _district,
    );
    final provinceOptions = _optionsWithCurrent(_provinceOptions, _province);
    final totalAmountCents = _items.fold<int>(
      0,
      (sum, item) => sum + item.subtotalCents,
    );

    return AlertDialog(
      title: Text(
        widget.fullEdit
            ? '${widget.order.orderNo} 编辑订单信息'
            : '${widget.order.orderNo} 基础字段',
      ),
      content: SizedBox(
        width: widget.fullEdit ? 860 : 520,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_errorMessage != null) ...[
                StatusTag(label: _errorMessage!, tone: StatusTone.danger),
                const SizedBox(height: 12),
              ],
              const _SectionTitle('基础信息'),
              if (widget.fullEdit)
                ResponsiveFormGrid(
                  minItemWidth: 220,
                  children: [
                    DropdownButtonFormField<String>(
                      key: const ValueKey('order-edit-type-field'),
                      initialValue: _orderType,
                      isExpanded: true,
                      decoration: const InputDecoration(labelText: '订单类型'),
                      items: [
                        for (final item in _orderTypeEntries)
                          DropdownMenuItem(
                            value: item.key,
                            child: Text(item.value),
                          ),
                      ],
                      onChanged: (value) {
                        if (value != null) {
                          setState(() => _orderType = value);
                        }
                      },
                    ),
                    TextField(
                      key: const ValueKey('order-edit-sales-form-no-field'),
                      controller: _salesFormNoController,
                      decoration: const InputDecoration(labelText: '销售单号'),
                    ),
                    TextField(
                      key: const ValueKey('order-edit-sales-user-id-field'),
                      controller: _salesUserIdController,
                      decoration: const InputDecoration(labelText: '销售人员 ID'),
                    ),
                    TextField(
                      key: const ValueKey('order-edit-cod-field'),
                      controller: _codController,
                      keyboardType:
                          const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(
                        labelText: '货到付款金额',
                        prefixText: '¥ ',
                      ),
                    ),
                  ],
                )
              else ...[
                TextField(
                  key: const ValueKey('order-edit-sales-form-no-field'),
                  controller: _salesFormNoController,
                  decoration: const InputDecoration(labelText: '销售单号'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const ValueKey('order-edit-cod-field'),
                  controller: _codController,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(
                    labelText: '货到付款金额',
                    prefixText: '¥ ',
                  ),
                ),
              ],
              const SizedBox(height: 10),
              Wrap(
                spacing: 10,
                runSpacing: 10,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  OutlinedButton.icon(
                    key: const ValueKey('order-edit-date-button'),
                    onPressed: _pickDate,
                    icon: const Icon(Icons.calendar_today_rounded),
                    label: Text('订单日期 ${formatDate(_orderDate)}'),
                  ),
                  ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 260),
                    child: CheckboxListTile(
                      key: const ValueKey(
                          'order-edit-invoice-required-checkbox'),
                      value: _invoiceRequired,
                      onChanged: (value) {
                        setState(() => _invoiceRequired = value ?? false);
                      },
                      contentPadding: EdgeInsets.zero,
                      controlAffinity: ListTileControlAffinity.leading,
                      title: const Text('客户需要开票'),
                    ),
                  ),
                ],
              ),
              if (widget.fullEdit) ...[
                const SizedBox(height: 12),
                TextField(
                  key: const ValueKey('order-edit-remark-field'),
                  controller: _remarkController,
                  decoration: const InputDecoration(labelText: '订单备注'),
                ),
                if (_orderType == 'travel_group') ...[
                  const Divider(height: 26),
                  const _SectionTitle('旅行团关联'),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          key: const ValueKey(
                              'order-edit-travel-group-id-field'),
                          controller: _travelGroupIdController,
                          decoration:
                              const InputDecoration(labelText: '旅行团 ID'),
                        ),
                      ),
                      const SizedBox(width: 10),
                      OutlinedButton.icon(
                        key: const ValueKey('order-edit-select-travel-group'),
                        onPressed: _selectTravelGroup,
                        icon: const Icon(Icons.directions_bus_rounded),
                        label: const Text('选择旅行团'),
                      ),
                    ],
                  ),
                ],
                const Divider(height: 26),
                const _SectionTitle('客户与收货'),
                ResponsiveFormGrid(
                  minItemWidth: 220,
                  children: [
                    TextField(
                      key: const ValueKey('order-edit-customer-name-field'),
                      controller: _customerNameController,
                      decoration: const InputDecoration(labelText: '客户姓名'),
                    ),
                    TextField(
                      key: const ValueKey('order-edit-customer-phone-field'),
                      controller: _customerPhoneController,
                      keyboardType: TextInputType.phone,
                      decoration: const InputDecoration(labelText: '电话'),
                    ),
                    DropdownButtonFormField<String>(
                      key: ValueKey('order-edit-province-${_province ?? ''}'),
                      initialValue: _province,
                      isExpanded: true,
                      decoration: const InputDecoration(labelText: '省份'),
                      items: [
                        for (final province in provinceOptions)
                          DropdownMenuItem(
                            value: province,
                            child: Text(province),
                          ),
                      ],
                      onChanged: (value) {
                        setState(() {
                          _province = value;
                          _city = null;
                          _district = null;
                        });
                      },
                    ),
                    DropdownButtonFormField<String>(
                      key: ValueKey(
                          'order-edit-city-${_province ?? ''}-${_city ?? ''}'),
                      initialValue: _city,
                      isExpanded: true,
                      decoration: const InputDecoration(labelText: '市'),
                      items: [
                        for (final city in cityOptions)
                          DropdownMenuItem(value: city, child: Text(city)),
                      ],
                      onChanged: cityOptions.isEmpty
                          ? null
                          : (value) {
                              setState(() {
                                _city = value;
                                _district = null;
                              });
                            },
                    ),
                    DropdownButtonFormField<String>(
                      key: ValueKey(
                        'order-edit-district-${_province ?? ''}-${_city ?? ''}-${_district ?? ''}',
                      ),
                      initialValue: _district,
                      isExpanded: true,
                      decoration: const InputDecoration(labelText: '区县'),
                      items: [
                        for (final district in districtOptions)
                          DropdownMenuItem(
                            value: district,
                            child: Text(district),
                          ),
                      ],
                      onChanged: districtOptions.isEmpty
                          ? null
                          : (value) {
                              setState(() => _district = value);
                            },
                    ),
                    TextField(
                      key: const ValueKey('order-edit-address-field'),
                      controller: _addressController,
                      decoration: const InputDecoration(labelText: '具体详细地址'),
                    ),
                  ],
                ),
                const Divider(height: 26),
                _OrderItemsEditSection(
                  items: _items,
                  totalAmountCents: totalAmountCents,
                  onAdd: _addItem,
                  onDelete: _deleteItem,
                  onChanged: () => setState(() {}),
                  onDeliveryTypeChanged: _updateItemDeliveryType,
                ),
                const Divider(height: 26),
                const _SectionTitle('财务与物流'),
                ResponsiveFormGrid(
                  minItemWidth: 220,
                  children: [
                    DropdownButtonFormField<String>(
                      key: const ValueKey('order-edit-status-field'),
                      initialValue: _status,
                      isExpanded: true,
                      decoration: const InputDecoration(labelText: '订单状态'),
                      items: [
                        for (final status in OrderStatus.values)
                          DropdownMenuItem(
                            value: status.value,
                            child: Text(status.label),
                          ),
                      ],
                      onChanged: (value) {
                        if (value != null) {
                          setState(() => _status = value);
                        }
                      },
                    ),
                    TextField(
                      key: const ValueKey('order-edit-logistics-no-field'),
                      controller: _logisticsNoController,
                      decoration: const InputDecoration(labelText: '物流单号'),
                    ),
                    TextField(
                      key: const ValueKey('order-edit-logistics-fee-field'),
                      controller: _logisticsFeeController,
                      keyboardType:
                          const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(
                        labelText: '物流运费',
                        prefixText: '¥ ',
                      ),
                    ),
                    CheckboxListTile(
                      key: const ValueKey('order-edit-invoice-issued-checkbox'),
                      value: _invoiceIssued,
                      onChanged: (value) {
                        setState(() => _invoiceIssued = value ?? false);
                      },
                      contentPadding: EdgeInsets.zero,
                      controlAffinity: ListTileControlAffinity.leading,
                      title: const Text('财务已开票'),
                    ),
                    TextField(
                      key: const ValueKey('order-edit-logistics-method-field'),
                      controller: _logisticsMethodController,
                      decoration: const InputDecoration(labelText: '物流方式'),
                    ),
                    DropdownButtonFormField<String>(
                      key: const ValueKey('order-edit-packing-status-field'),
                      initialValue: _packingStatus,
                      isExpanded: true,
                      decoration: const InputDecoration(labelText: '打包状态'),
                      items: [
                        for (final status in PackingStatus.values)
                          DropdownMenuItem(
                            value: status.value,
                            child: Text(status.label),
                          ),
                      ],
                      onChanged: (value) {
                        if (value != null) {
                          setState(() => _packingStatus = value);
                        }
                      },
                    ),
                    TextField(
                      key: const ValueKey('order-edit-package-count-field'),
                      controller: _packageCountController,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: '打包件数'),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const ValueKey('order-edit-finance-remark-field'),
                  controller: _financeRemarkController,
                  maxLines: 2,
                  decoration: const InputDecoration(labelText: '财务备注'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const ValueKey('order-edit-warehouse-remark-field'),
                  controller: _warehouseRemarkController,
                  maxLines: 2,
                  decoration: const InputDecoration(labelText: '库管备注'),
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          key: const ValueKey('order-edit-save-button'),
          onPressed: _submit,
          icon: const Icon(Icons.check_rounded),
          label: const Text('保存'),
        ),
      ],
    );
  }
}

class _OrderItemsEditSection extends StatelessWidget {
  const _OrderItemsEditSection({
    required this.items,
    required this.totalAmountCents,
    required this.onAdd,
    required this.onDelete,
    required this.onChanged,
    required this.onDeliveryTypeChanged,
  });

  final List<_EditableOrderItemDraft> items;
  final int totalAmountCents;
  final VoidCallback onAdd;
  final ValueChanged<int> onDelete;
  final VoidCallback onChanged;
  final void Function(int index, DeliveryType deliveryType)
      onDeliveryTypeChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Expanded(child: _SectionTitle('酒品明细')),
            MoneyText(cents: totalAmountCents, prominent: true),
            const SizedBox(width: 10),
            TextButton.icon(
              key: const ValueKey('order-edit-item-add-button'),
              onPressed: onAdd,
              icon: const Icon(Icons.add_rounded),
              label: const Text('添加明细'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        for (var index = 0; index < items.length; index += 1) ...[
          _OrderItemEditRow(
            index: index,
            item: items[index],
            onChanged: onChanged,
            onDelete: () => onDelete(index),
            onDeliveryTypeChanged: (deliveryType) =>
                onDeliveryTypeChanged(index, deliveryType),
          ),
          if (index != items.length - 1) const Divider(height: 20),
        ],
      ],
    );
  }
}

class _OrderItemEditRow extends StatelessWidget {
  const _OrderItemEditRow({
    required this.index,
    required this.item,
    required this.onChanged,
    required this.onDelete,
    required this.onDeliveryTypeChanged,
  });

  final int index;
  final _EditableOrderItemDraft item;
  final VoidCallback onChanged;
  final VoidCallback onDelete;
  final ValueChanged<DeliveryType> onDeliveryTypeChanged;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        borderRadius: const BorderRadius.all(Radius.circular(8)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '明细 ${index + 1}',
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                MoneyText(cents: item.subtotalCents),
                IconButton(
                  key: ValueKey('order-edit-item-delete-$index'),
                  tooltip: '删除明细',
                  onPressed: onDelete,
                  icon: const Icon(Icons.delete_outline_rounded),
                ),
              ],
            ),
            const SizedBox(height: 8),
            ResponsiveFormGrid(
              minItemWidth: 170,
              children: [
                TextField(
                  key: ValueKey('order-edit-item-product-$index'),
                  controller: item.nameController,
                  onChanged: (_) => onChanged(),
                  decoration: const InputDecoration(labelText: '酒品名称'),
                ),
                TextField(
                  key: ValueKey('order-edit-item-quantity-$index'),
                  controller: item.quantityController,
                  onChanged: (_) => onChanged(),
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: '数量'),
                ),
                TextField(
                  key: ValueKey('order-edit-item-unit-price-$index'),
                  controller: item.unitPriceController,
                  onChanged: (_) => onChanged(),
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(
                    labelText: '单价',
                    prefixText: '¥ ',
                  ),
                ),
                DropdownButtonFormField<DeliveryType>(
                  key: ValueKey('order-edit-item-delivery-$index'),
                  initialValue: item.deliveryType,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: '配送方式'),
                  items: [
                    for (final type in DeliveryType.values)
                      DropdownMenuItem(value: type, child: Text(type.label)),
                  ],
                  onChanged: (value) {
                    if (value != null) {
                      onDeliveryTypeChanged(value);
                    }
                  },
                ),
                TextField(
                  key: ValueKey('order-edit-item-notes-$index'),
                  controller: item.notesController,
                  onChanged: (_) => onChanged(),
                  decoration: const InputDecoration(labelText: '明细备注'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _EditableOrderItemDraft {
  _EditableOrderItemDraft({
    required String name,
    required int quantity,
    required int unitPriceCents,
    required this.deliveryType,
    String? notes,
  })  : nameController = TextEditingController(text: name),
        quantityController = TextEditingController(
          text: quantity > 0 ? '$quantity' : '',
        ),
        unitPriceController = TextEditingController(
          text: _moneyInputText(unitPriceCents),
        ),
        notesController = TextEditingController(text: notes ?? '');

  factory _EditableOrderItemDraft.fromRecord(SalesOrderItemRecord item) {
    return _EditableOrderItemDraft(
      name: item.productName,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      deliveryType: _deliveryTypeFromValue(item.deliveryType),
      notes: item.notes,
    );
  }

  factory _EditableOrderItemDraft.empty() {
    return _EditableOrderItemDraft(
      name: '',
      quantity: 1,
      unitPriceCents: 0,
      deliveryType: DeliveryType.shipping,
    );
  }

  final TextEditingController nameController;
  final TextEditingController quantityController;
  final TextEditingController unitPriceController;
  final TextEditingController notesController;
  DeliveryType deliveryType;

  String get name => nameController.text.trim();

  int get quantity => int.tryParse(quantityController.text.trim()) ?? 0;

  int? get unitPriceCentsOrNull => _moneyCentsOrNull(unitPriceController.text);

  int get subtotalCents => quantity * (unitPriceCentsOrNull ?? 0);

  String get notes => notesController.text.trim();

  void dispose() {
    nameController.dispose();
    quantityController.dispose();
    unitPriceController.dispose();
    notesController.dispose();
  }
}

String _knownOrderTypeValue(String value) {
  for (final item in _orderTypeEntries) {
    if (item.key == value) {
      return value;
    }
  }
  return _orderTypeEntries.first.key;
}

String _knownOrderStatusValue(String value) {
  for (final status in OrderStatus.values) {
    if (status.value == value) {
      return value;
    }
  }
  return OrderStatus.valid.value;
}

String _knownPackingStatusValue(String value) {
  for (final status in PackingStatus.values) {
    if (status.value == value) {
      return value;
    }
  }
  return PackingStatus.pending.value;
}

DeliveryType _deliveryTypeFromValue(String value) {
  for (final type in DeliveryType.values) {
    if (type.value == value) {
      return type;
    }
  }
  return DeliveryType.shipping;
}

List<String> _optionsWithCurrent(List<String> options, String? current) {
  final text = current?.trim() ?? '';
  if (text.isEmpty || options.contains(text)) {
    return options;
  }
  return [text, ...options];
}

int? _packageCountOrNull(String value) {
  final text = value.trim();
  if (text.isEmpty) {
    return 0;
  }
  final parsed = int.tryParse(text);
  if (parsed == null || parsed < 0) {
    return null;
  }
  return parsed;
}

const _orderTypeEntries = <MapEntry<String, String>>[
  MapEntry('travel_group', '旅行团订单'),
  MapEntry('buyback', '回购订单'),
  MapEntry('external', '外销订单'),
  MapEntry('internal', '内购订单'),
  MapEntry('after_sales', '售后订单'),
];

class _NullableDropdown extends StatelessWidget {
  const _NullableDropdown({
    super.key,
    required this.label,
    required this.value,
    required this.items,
    required this.onChanged,
  });

  final String label;
  final String? value;
  final List<MapEntry<String, String>> items;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      initialValue: value ?? _allValue,
      isExpanded: true,
      decoration: InputDecoration(labelText: label),
      items: [
        const DropdownMenuItem(value: _allValue, child: Text('全部')),
        for (final item in items)
          DropdownMenuItem(value: item.key, child: Text(item.value)),
      ],
      onChanged: (selected) {
        onChanged(selected == _allValue ? null : selected);
      },
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title);

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        title,
        style: Theme.of(context)
            .textTheme
            .titleSmall
            ?.copyWith(fontWeight: FontWeight.w800),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 86,
            child: Text(label, style: Theme.of(context).textTheme.bodySmall),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoMoneyRow extends StatelessWidget {
  const _InfoMoneyRow({required this.label, required this.cents});

  final String label;
  final int cents;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          SizedBox(
            width: 86,
            child: Text(label, style: Theme.of(context).textTheme.bodySmall),
          ),
          MoneyText(cents: cents, prominent: label == '订单金额'),
        ],
      ),
    );
  }
}

SalesOrderRecord? _selectedFrom(List<SalesOrderRecord> orders, String? id) {
  if (orders.isEmpty) {
    return null;
  }
  for (final order in orders) {
    if (order.id == id) {
      return order;
    }
  }
  return orders.first;
}

List<SalesOrderItemRecord> _sortedItems(List<SalesOrderItemRecord> items) {
  return [...items]..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
}

List<SalesSheetItemRecord> _sortedSalesSheetItems(
  List<SalesSheetItemRecord> items,
) {
  return [...items]..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
}

bool _canViewQrSalesSheet(UserRole role) {
  return role == UserRole.admin ||
      role == UserRole.sales ||
      role == UserRole.finance ||
      role == UserRole.boss ||
      role == UserRole.afterSales;
}

bool _canGenerateQrSalesSheetForRole(UserRole role) {
  return role == UserRole.admin || role == UserRole.sales;
}

String _orderAddress(SalesOrderRecord order) {
  final parts = [
    order.province,
    order.city,
    order.district,
    order.address,
  ].whereType<String>().where((item) => item.trim().isNotEmpty).toList();
  if (parts.isEmpty) {
    return '未填写';
  }
  return parts.join('');
}

String _travelGroupLabel(SalesOrderRecord order) {
  final group = order.travelGroup;
  if (group == null) {
    return order.travelGroupId == null ? '散客/无旅行团' : order.travelGroupId!;
  }
  final agency = group.travelAgency?.trim();
  if (agency == null || agency.isEmpty) {
    return group.groupNo;
  }
  return '${group.groupNo} · $agency';
}

String _salesSheetTravelGroupLabel(SalesSheetRecord sheet) {
  final group = sheet.travelGroup;
  if (group == null) {
    return '无旅行团';
  }
  final parts = [
    group.groupNo,
    group.travelAgency,
    group.guideName,
    group.tasterName,
  ].whereType<String>().where((item) => item.trim().isNotEmpty).toList();
  return parts.isEmpty ? '无旅行团' : parts.join(' · ');
}

String _qrExpiresLabel(SalesSheetQrCode? qrCode) {
  if (qrCode == null) {
    return '未生成';
  }
  final expiresAt = qrCode.expiresAt?.trim();
  if (expiresAt == null || expiresAt.isEmpty) {
    return '长期有效';
  }
  return expiresAt;
}

bool _customerMarked(SalesOrderRecord order) {
  return order.customer?.financeMark ?? false;
}

String _deliverySummaryLabel(SalesOrderRecord order) {
  final summary = order.deliverySummary;
  if (summary == 'mixed') {
    return '混合';
  }
  if (summary == DeliveryType.selfPickup.value) {
    return DeliveryType.selfPickup.label;
  }
  if (summary == DeliveryType.shipping.value) {
    return DeliveryType.shipping.label;
  }
  final values = order.items.map((item) => item.deliveryType).toSet();
  if (values.length > 1) {
    return '混合';
  }
  if (values.contains(DeliveryType.selfPickup.value)) {
    return DeliveryType.selfPickup.label;
  }
  if (values.contains(DeliveryType.shipping.value)) {
    return DeliveryType.shipping.label;
  }
  return '未填写配送';
}

String _deliveryTypeLabel(String value) {
  for (final type in DeliveryType.values) {
    if (type.value == value) {
      return type.label;
    }
  }
  return value;
}

String _statusLabel(String value) {
  for (final status in OrderStatus.values) {
    if (status.value == value) {
      return status.label;
    }
  }
  return value;
}

StatusTone _statusTone(String value) {
  switch (value) {
    case 'refunded':
    case 'cancelled':
      return StatusTone.danger;
    case 'partial_refund':
      return StatusTone.warning;
    case 'valid':
    default:
      return StatusTone.success;
  }
}

String _packingStatusLabel(String value) {
  for (final status in PackingStatus.values) {
    if (status.value == value) {
      return status.label;
    }
  }
  return value;
}

String _orderTypeLabel(String value) {
  switch (value) {
    case 'travel_group':
      return '旅行团订单';
    case 'buyback':
      return '回购订单';
    case 'external':
      return '外销订单';
    case 'internal':
      return '内购订单';
    case 'after_sales':
      return '售后订单';
    default:
      return value;
  }
}

String _display(String? value) {
  final text = value?.trim() ?? '';
  return text.isEmpty ? '未填写' : text;
}

String _safeExportFileName(String? value) {
  final fallback = 'sales-orders-${_exportTimestamp(DateTime.now())}.xlsx';
  final text = value?.trim().isEmpty ?? true ? fallback : value!.trim();
  final safe = text.replaceAll(RegExp(r'[<>:"/\\|?*\x00-\x1F]'), '_');
  return safe.toLowerCase().endsWith('.xlsx') ? safe : '$safe.xlsx';
}

String _exportTimestamp(DateTime value) {
  String two(int number) => number.toString().padLeft(2, '0');
  return '${value.year}${two(value.month)}${two(value.day)}-'
      '${two(value.hour)}${two(value.minute)}${two(value.second)}';
}

Future<File> _nextExportFile(Directory directory, String fileName) async {
  final separator = Platform.pathSeparator;
  final first = File('${directory.path}$separator$fileName');
  if (!await first.exists()) {
    return first;
  }

  final dotIndex = fileName.lastIndexOf('.');
  final stem = dotIndex <= 0 ? fileName : fileName.substring(0, dotIndex);
  final extension = dotIndex <= 0 ? '' : fileName.substring(dotIndex);
  for (var index = 1; index < 1000; index += 1) {
    final candidate = File(
      '${directory.path}$separator$stem-$index$extension',
    );
    if (!await candidate.exists()) {
      return candidate;
    }
  }
  return File(
      '${directory.path}$separator$stem-${DateTime.now().microsecondsSinceEpoch}$extension');
}

int? _moneyCentsOrNull(String value) {
  final text = value.trim();
  if (text.isEmpty) {
    return 0;
  }
  final amount = double.tryParse(text.replaceAll(',', ''));
  if (amount == null || amount < 0) {
    return null;
  }
  return (amount * 100).round();
}

String _moneyInputText(int cents) {
  if (cents <= 0) {
    return '';
  }
  if (cents % 100 == 0) {
    return '${cents ~/ 100}';
  }
  return (cents / 100).toStringAsFixed(2);
}

String _messageForError(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  return '操作失败，请稍后重试。';
}

const _allValue = '__all__';
