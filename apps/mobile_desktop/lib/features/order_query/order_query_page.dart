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
      widget.role == UserRole.admin || widget.role == UserRole.sales;

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
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => _OrderBasicEditDialog(order: order),
    );
    if (result == null) {
      return;
    }

    setState(() {
      _busyOrderIds.add(order.id);
      _detailErrorMessage = null;
    });
    try {
      final updated = await _businessApi.updateSalesOrder(order.id, result);
      if (!mounted) {
        return;
      }
      _replaceOrder(updated);
      setState(() => _busyOrderIds.remove(order.id));
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${updated.orderNo} 已保存基础字段。')),
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
          title: '订单管理筛选',
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
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton.icon(
                key: const ValueKey('order-query-search-button'),
                onPressed: _loading ? null : _loadOrders,
                icon: const Icon(Icons.search_rounded),
                label: const Text('查询'),
              ),
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
          primary: _OrderList(
            orders: _orders,
            selectedId: selectedOrder?.id,
            loading: _loading,
            onSelect: _selectOrder,
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
      return const EmptyState(title: '暂无匹配订单');
    }

    return Card(
      child: ListView.separated(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: orders.length,
        separatorBuilder: (_, __) => const Divider(height: 1),
        itemBuilder: (context, index) {
          final order = orders[index];
          final selected = selectedId == order.id;
          return ListTile(
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
      ),
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

    return FormSection(
      title: '订单详情',
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
        const SizedBox(height: 14),
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
        _InfoMoneyRow(label: '货到付款', cents: order.cashOnDeliveryAmountCents),
        _InfoRow(label: '客户需开票', value: order.invoiceRequired ? '是' : '否'),
        _InfoRow(label: '财务已开票', value: order.invoiceIssued ? '是' : '否'),
        _InfoRow(label: '财务备注', value: _display(order.financeRemark)),
        const Divider(height: 24),
        const _SectionTitle('物流与库管'),
        _InfoRow(label: '配送摘要', value: _deliverySummaryLabel(order)),
        _InfoRow(
            label: '打包状态', value: _packingStatusLabel(order.packingStatus)),
        _InfoRow(label: '物流方式', value: _display(order.logisticsMethod)),
        _InfoRow(label: '物流单号', value: _display(order.logisticsNo)),
        _InfoMoneyRow(label: '物流运费', cents: order.logisticsFeeCents),
        _InfoRow(label: '打包件数', value: '${order.packageCount}'),
        _InfoRow(label: '库管备注', value: _display(order.warehouseRemark)),
        const Divider(height: 24),
        _InfoRow(label: '订单标记', value: order.financeMark ? '已标记' : '未标记'),
      ],
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
            label: Text(role == UserRole.sales ? '编辑基础字段' : '编辑订单基础'),
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

class _OrderBasicEditDialog extends StatefulWidget {
  const _OrderBasicEditDialog({required this.order});

  final SalesOrderRecord order;

  @override
  State<_OrderBasicEditDialog> createState() => _OrderBasicEditDialogState();
}

class _OrderBasicEditDialogState extends State<_OrderBasicEditDialog> {
  late DateTime _orderDate;
  late final TextEditingController _salesFormNoController;
  late final TextEditingController _codController;
  late bool _invoiceRequired;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _orderDate = DateTime.tryParse(widget.order.orderDate) ?? DateTime.now();
    _salesFormNoController =
        TextEditingController(text: widget.order.salesFormNo ?? '');
    _codController = TextEditingController(
      text: _moneyInputText(widget.order.cashOnDeliveryAmountCents),
    );
    _invoiceRequired = widget.order.invoiceRequired;
  }

  @override
  void dispose() {
    _salesFormNoController.dispose();
    _codController.dispose();
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

  void _submit() {
    final codCents = _moneyCentsOrNull(_codController.text);
    if (codCents == null) {
      setState(() => _errorMessage = '货到付款金额必须为有效的非负金额。');
      return;
    }
    Navigator.of(context).pop(<String, dynamic>{
      'salesFormNo': _salesFormNoController.text.trim(),
      'orderDate': formatDate(_orderDate),
      'cashOnDeliveryAmountCents': codCents,
      'invoiceRequired': _invoiceRequired,
    });
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('${widget.order.orderNo} 基础字段'),
      content: SizedBox(
        width: 520,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              key: const ValueKey('order-edit-sales-form-no-field'),
              controller: _salesFormNoController,
              decoration: const InputDecoration(labelText: '销售单号'),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              key: const ValueKey('order-edit-date-button'),
              onPressed: _pickDate,
              icon: const Icon(Icons.calendar_today_rounded),
              label: Text('订单日期 ${formatDate(_orderDate)}'),
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
            const SizedBox(height: 6),
            CheckboxListTile(
              key: const ValueKey('order-edit-invoice-required-checkbox'),
              value: _invoiceRequired,
              onChanged: (value) {
                setState(() => _invoiceRequired = value ?? false);
              },
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              title: const Text('客户需要开票'),
            ),
            if (_errorMessage != null)
              StatusTag(label: _errorMessage!, tone: StatusTone.danger),
          ],
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
