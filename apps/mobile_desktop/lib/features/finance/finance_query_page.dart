import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/app_record_list.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/money_text.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/status_tag.dart';

class FinanceQueryPage extends StatefulWidget {
  const FinanceQueryPage({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;

  @override
  State<FinanceQueryPage> createState() => _FinanceQueryPageState();
}

class _FinanceQueryPageState extends State<FinanceQueryPage> {
  late BusinessApi _businessApi;
  final TextEditingController _queryController = TextEditingController();

  DateTime _start = DateTime(DateTime.now().year, DateTime.now().month, 1);
  DateTime _end = DateTime.now();
  String _filter = '订单金额';
  bool _loading = true;
  String? _errorMessage;
  FinanceWorkbenchRecord? _workbench;
  String? _confirmingAfterSalesId;

  bool get _canConfirmAfterSalesRefund =>
      widget.role == UserRole.admin || widget.role == UserRole.finance;

  bool get _canEditFinanceOrders =>
      widget.role == UserRole.admin || widget.role == UserRole.finance;

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _loadData();
  }

  @override
  void didUpdateWidget(covariant FinanceQueryPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token) {
      _businessApi =
          BusinessApi(apiClient: widget.apiClient, token: widget.token);
      _loadData();
    }
  }

  @override
  void dispose() {
    _queryController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      final workbench = await _businessApi.getFinanceWorkbench(
        start: _start,
        end: _end,
        query: _queryController.text.trim(),
        limit: 50,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _workbench = workbench;
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

  @override
  Widget build(BuildContext context) {
    final workbench = _workbench;
    final metrics = workbench?.metrics;
    final recentOrders = workbench?.recentOrders ?? const <SalesOrderRecord>[];
    final pendingAfterSales =
        workbench?.pendingAfterSales ?? const <AfterSalesOrderRecord>[];

    return ResponsivePage(
      children: [
        if (_errorMessage != null)
          _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
        FormSection(
          title: '财务工作台筛选',
          trailing: StatusTag(
            label: _loading ? '加载中' : '${recentOrders.length} 笔订单',
            tone: _loading ? StatusTone.warning : StatusTone.info,
          ),
          children: [
            AppDateRangeButton(
              start: _start,
              end: _end,
              onChanged: (range) {
                setState(() {
                  _start = range.start;
                  _end = range.end;
                });
                _loadData();
              },
            ),
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: AppSearchField(
                    key: const ValueKey('finance-workbench-query-field'),
                    controller: _queryController,
                    hintText: '搜索订单号、客户、旅行团、售后单号',
                    onChanged: (_) => setState(() {}),
                  ),
                ),
                const SizedBox(width: 12),
                FilledButton.icon(
                  key: const ValueKey('finance-workbench-query-button'),
                  onPressed: _loading ? null : _loadData,
                  icon: const Icon(Icons.search_rounded),
                  label: const Text('查询'),
                ),
              ],
            ),
            const SizedBox(height: 12),
            AppFilterBar(
              filters: _financeFilters,
              selected: _filter,
              onSelected: (value) => setState(() => _filter = value),
            ),
          ],
        ),
        if (_loading && workbench == null)
          const FormSection(
            title: '财务工作台',
            children: [
              _SectionState(message: '正在加载财务工作台', loading: true),
            ],
          )
        else ...[
          MetricGrid(
            metrics: [
              MetricData(
                label: '出单销售额',
                value: formatMoneyCents(
                  metrics?.grossSalesAmountCents ??
                      metrics?.salesAmountCents ??
                      0,
                ),
                icon: Icons.trending_up_rounded,
              ),
              MetricData(
                label: '退款金额',
                value: formatMoneyCents(metrics?.refundAmountCents ?? 0),
                icon: Icons.assignment_return_rounded,
              ),
              MetricData(
                label: '净销售额',
                value: formatMoneyCents(metrics?.netSalesAmountCents ?? 0),
                icon: Icons.account_balance_wallet_rounded,
              ),
              MetricData(
                label: '物流费用',
                value: formatMoneyCents(metrics?.logisticsFeeCents ?? 0),
                icon: Icons.local_shipping_rounded,
              ),
              MetricData(
                label: '待开票',
                value: '${metrics?.pendingInvoiceCount ?? 0}',
                icon: Icons.request_quote_rounded,
              ),
              MetricData(
                label: '待标记',
                value:
                    '${(metrics?.pendingCustomerMarkCount ?? 0) + (metrics?.pendingTravelGroupMarkCount ?? 0)}',
                icon: Icons.flag_rounded,
              ),
              MetricData(
                label: '待确认售后',
                value: '${metrics?.pendingAfterSalesConfirmCount ?? 0}',
                icon: Icons.support_agent_rounded,
              ),
            ],
          ),
          ResponsiveTwoColumn(
            primaryFlex: 2,
            secondaryFlex: 1,
            primary: FormSection(
              title: _financeFilterTitle(_filter),
              trailing: TextButton.icon(
                onPressed: _loading ? null : _loadData,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('刷新'),
              ),
              children: [
                _buildSelectedWorkbenchContent(workbench),
              ],
            ),
            secondary: FormSection(
              title: '待确认售后',
              trailing: StatusTag(
                label: '${pendingAfterSales.length} 笔',
                tone: pendingAfterSales.isEmpty
                    ? StatusTone.info
                    : StatusTone.warning,
              ),
              children: [
                _buildPendingAfterSalesList(
                  pendingAfterSales,
                  keyPrefix: 'finance-pending-after-sales-secondary',
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildSelectedWorkbenchContent(FinanceWorkbenchRecord? workbench) {
    if (_loading && workbench == null) {
      return const _SectionState(message: '正在加载财务工作台', loading: true);
    }
    if (workbench == null) {
      return const _SectionState(message: '暂无财务工作台数据');
    }

    switch (_filter) {
      case '退款退单':
        return _buildRefundAndReturnList(workbench);
      case '物流费用':
        return _buildPendingLogisticsList(
          workbench.pendingLogistics.where(_hasLogisticsReason).toList(),
          emptyMessage: '当前范围暂无物流费用待办',
        );
      case '标记信息':
        return _buildPendingMarksList(workbench.pendingMarks);
      case '开票待办':
        return _buildPendingLogisticsList(
          workbench.pendingLogistics.where(_hasInvoiceReason).toList(),
          emptyMessage: '当前范围暂无开票待办',
        );
      case '售后确认':
        return _buildPendingAfterSalesList(
          workbench.pendingAfterSales,
          keyPrefix: 'finance-pending-after-sales-selected',
        );
      case '订单金额':
      default:
        return _buildOrderList(
          workbench.recentOrders,
          emptyMessage: '当前范围暂无订单财务记录',
        );
    }
  }

  Widget _buildOrderList(
    List<SalesOrderRecord> orders, {
    required String emptyMessage,
  }) {
    if (_loading && orders.isEmpty) {
      return const _SectionState(message: '正在加载订单财务记录', loading: true);
    }
    if (orders.isEmpty) {
      return _SectionState(message: emptyMessage);
    }

    return AppRecordList(
      items: [
        for (final order in orders)
          AppRecordItem(
            onTap:
                _canEditFinanceOrders ? () => _openFinanceEditor(order) : null,
            title: order.orderNo,
            subtitle:
                '${order.customerName} · ${order.travelGroup?.groupNo ?? _orderTypeLabel(order.orderType)}',
            meta: [
              _orderTypeLabel(order.orderType),
              _orderStatusLabel(order.status),
              _customerMarkLabel(order),
              '物流单号 ${_fieldValue(order.logisticsNo)}',
              '运费 ${formatMoneyCents(order.logisticsFeeCents)}',
              _invoiceLabel(order),
            ],
            icon: Icons.receipt_long_rounded,
            trailing: MoneyText(cents: order.totalAmountCents),
          ),
      ],
    );
  }

  Widget _buildPendingAfterSalesList(
    List<AfterSalesOrderRecord> records, {
    required String keyPrefix,
  }) {
    if (_loading && records.isEmpty) {
      return const _SectionState(message: '正在加载待确认售后', loading: true);
    }
    if (records.isEmpty) {
      return const _SectionState(message: '当前范围暂无待确认售后');
    }

    return AppRecordList(
      compact: true,
      items: [
        for (final record in records)
          AppRecordItem(
            title: record.afterSalesNo,
            subtitle:
                '订单 ${record.salesOrder?.orderNo ?? record.salesOrderId} · 客户 ${record.customer?.name ?? record.salesOrder?.customerName ?? '未关联客户'}',
            meta: [
              '状态 ${_afterSalesStatusLabel(record.status)}',
              _issueTypeLabel(record.issueType),
              _actionTypeLabel(record.actionType),
              '退款 ${formatMoneyCents(record.refundAmountCents)}',
              if (record.createdAt != null) _dateTimeLabel(record.createdAt),
            ],
            icon: Icons.support_agent_rounded,
            trailing: _buildAfterSalesTrailing(
              record,
              keyPrefix: keyPrefix,
            ),
          ),
      ],
    );
  }

  Widget _buildAfterSalesTrailing(
    AfterSalesOrderRecord record, {
    required String keyPrefix,
  }) {
    final isConfirming = _confirmingAfterSalesId == record.id;
    if (_canConfirmAfterSalesRefund && !record.financeConfirmed) {
      return FilledButton.icon(
        key: ValueKey('$keyPrefix-confirm-${record.id}'),
        onPressed: isConfirming ? null : () => _confirmAfterSalesRefund(record),
        icon: isConfirming
            ? const SizedBox.square(
                dimension: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Icon(Icons.verified_rounded),
        label: const Text('确认退款'),
      );
    }

    return StatusTag(
      label: record.financeConfirmed ? '已确认' : '待确认',
      tone: record.financeConfirmed ? StatusTone.success : StatusTone.warning,
    );
  }

  Widget _buildRefundAndReturnList(FinanceWorkbenchRecord workbench) {
    final refundOrders =
        workbench.recentOrders.where(_isRefundOrCancelledOrder).toList();
    final pendingAfterSales = workbench.pendingAfterSales;
    if (refundOrders.isEmpty && pendingAfterSales.isEmpty) {
      return const _SectionState(message: '当前范围暂无退款退单记录');
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (pendingAfterSales.isNotEmpty) ...[
          Text(
            '售后待确认',
            style: Theme.of(context)
                .textTheme
                .titleSmall
                ?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
          _buildPendingAfterSalesList(
            pendingAfterSales,
            keyPrefix: 'finance-pending-after-sales-refund',
          ),
          if (refundOrders.isNotEmpty) const SizedBox(height: 16),
        ],
        if (refundOrders.isNotEmpty) ...[
          Text(
            '退款退单订单',
            style: Theme.of(context)
                .textTheme
                .titleSmall
                ?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
          _buildOrderList(
            refundOrders,
            emptyMessage: '当前范围暂无退款退单订单',
          ),
        ],
      ],
    );
  }

  Widget _buildPendingMarksList(List<FinancePendingMarkRecord> records) {
    if (_loading && records.isEmpty) {
      return const _SectionState(message: '正在加载标记待办', loading: true);
    }
    if (records.isEmpty) {
      return const _SectionState(message: '当前范围暂无标记待办');
    }

    return AppRecordList(
      compact: true,
      items: [
        for (final record in records)
          AppRecordItem(
            title: _pendingMarkTitle(record),
            subtitle: record.latestOrder == null
                ? _pendingMarkTypeLabel(record.type)
                : '${record.latestOrder!.orderNo} · ${record.latestOrder!.customerName}',
            meta: [
              _pendingMarkReasonLabel(record.reason),
              '${record.orderCount} 笔订单',
              if (record.travelGroup?.visitDate.isNotEmpty == true)
                record.travelGroup!.visitDate,
            ],
            icon: Icons.flag_rounded,
            trailing: StatusTag(
              label: _pendingMarkTypeLabel(record.type),
              tone: StatusTone.warning,
            ),
          ),
      ],
    );
  }

  Widget _buildPendingLogisticsList(
    List<FinancePendingLogisticsRecord> records, {
    required String emptyMessage,
  }) {
    if (_loading && records.isEmpty) {
      return const _SectionState(message: '正在加载物流待办', loading: true);
    }
    if (records.isEmpty) {
      return _SectionState(message: emptyMessage);
    }

    return AppRecordList(
      compact: true,
      items: [
        for (final record in records)
          if (record.order != null)
            AppRecordItem(
              onTap: _canEditFinanceOrders
                  ? () => _openFinanceEditor(record.order!)
                  : null,
              title: record.order!.orderNo,
              subtitle:
                  '${record.order!.customerName} · ${record.order!.travelGroup?.groupNo ?? _orderTypeLabel(record.order!.orderType)}',
              meta: [
                for (final reason in record.reasons)
                  _pendingLogisticsReasonLabel(reason),
                '物流单号 ${_fieldValue(record.order!.logisticsNo)}',
                '运费 ${formatMoneyCents(record.order!.logisticsFeeCents)}',
                _invoiceLabel(record.order!),
              ],
              icon: Icons.local_shipping_rounded,
              trailing: const StatusTag(label: '待补', tone: StatusTone.warning),
            ),
      ],
    );
  }

  Future<void> _openFinanceEditor(SalesOrderRecord order) async {
    final updated = await showDialog<SalesOrderRecord>(
      context: context,
      builder: (context) => _FinanceOrderDialog(
        businessApi: _businessApi,
        order: order,
      ),
    );
    if (updated == null || !mounted) {
      return;
    }
    _replaceRecentOrder(updated);
    await _loadData();
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('订单财务信息已保存')),
    );
  }

  Future<void> _confirmAfterSalesRefund(
    AfterSalesOrderRecord record,
  ) async {
    setState(() {
      _confirmingAfterSalesId = record.id;
      _errorMessage = null;
    });

    try {
      await _businessApi.confirmAfterSalesFinance(record.id, true);
      if (!mounted) {
        return;
      }
      await _loadData();
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('售后退款已确认')),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _errorMessage = _messageForError(error);
      });
    } finally {
      if (mounted) {
        setState(() {
          _confirmingAfterSalesId = null;
        });
      }
    }
  }

  void _replaceRecentOrder(SalesOrderRecord updated) {
    final workbench = _workbench;
    if (workbench == null) {
      return;
    }
    final updatedOrders = [
      for (final order in workbench.recentOrders)
        if (order.id == updated.id) updated else order,
    ];
    final updatedLogistics = [
      for (final record in workbench.pendingLogistics)
        if (record.order?.id == updated.id)
          FinancePendingLogisticsRecord(
            order: updated,
            reasons: record.reasons,
          )
        else
          record,
    ];
    setState(() {
      _workbench = FinanceWorkbenchRecord(
        metrics: workbench.metrics.copyWith(recentOrders: updatedOrders),
        recentOrders: updatedOrders,
        pendingAfterSales: workbench.pendingAfterSales,
        pendingMarks: workbench.pendingMarks,
        pendingLogistics: updatedLogistics,
      );
    });
  }
}

class _FinanceOrderDialog extends StatefulWidget {
  const _FinanceOrderDialog({
    required this.businessApi,
    required this.order,
  });

  final BusinessApi businessApi;
  final SalesOrderRecord order;

  @override
  State<_FinanceOrderDialog> createState() => _FinanceOrderDialogState();
}

class _FinanceOrderDialogState extends State<_FinanceOrderDialog> {
  late final TextEditingController _logisticsNoController;
  late final TextEditingController _logisticsFeeController;
  late final TextEditingController _financeRemarkController;
  late bool _invoiceIssued;
  bool _saving = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _logisticsNoController =
        TextEditingController(text: widget.order.logisticsNo ?? '');
    _logisticsFeeController = TextEditingController(
      text: _moneyInputText(widget.order.logisticsFeeCents),
    );
    _financeRemarkController =
        TextEditingController(text: widget.order.financeRemark ?? '');
    _invoiceIssued = widget.order.invoiceIssued;
  }

  @override
  void dispose() {
    _logisticsNoController.dispose();
    _logisticsFeeController.dispose();
    _financeRemarkController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final feeCents = _moneyCentsOrNull(_logisticsFeeController.text);
    if (feeCents == null || feeCents < 0) {
      setState(() => _errorMessage = '运费金额格式不正确');
      return;
    }

    setState(() {
      _saving = true;
      _errorMessage = null;
    });

    try {
      final updated = await widget.businessApi.updateSalesOrderFinance(
        widget.order.id,
        {
          'logisticsNo': _logisticsNoController.text.trim(),
          'logisticsFeeCents': feeCents,
          'invoiceIssued': _invoiceIssued,
          'financeRemark': _financeRemarkController.text.trim(),
        },
      );
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(updated);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _saving = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('维护 ${widget.order.orderNo}'),
      content: SingleChildScrollView(
        child: SizedBox(
          width: 420,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_errorMessage != null) ...[
                _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
                const SizedBox(height: 12),
              ],
              Text(
                '${widget.order.customerName} · ${_customerMarkLabel(widget.order)}',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              const SizedBox(height: 12),
              TextField(
                key: const ValueKey('finance-logistics-no-field'),
                controller: _logisticsNoController,
                decoration: const InputDecoration(labelText: '物流单号'),
              ),
              const SizedBox(height: 12),
              TextField(
                key: const ValueKey('finance-logistics-fee-field'),
                controller: _logisticsFeeController,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: '运费（元）'),
              ),
              const SizedBox(height: 8),
              CheckboxListTile(
                key: const ValueKey('finance-invoice-issued-checkbox'),
                contentPadding: EdgeInsets.zero,
                value: _invoiceIssued,
                onChanged: (value) {
                  if (value != null) {
                    setState(() => _invoiceIssued = value);
                  }
                },
                title: const Text('已开票'),
                controlAffinity: ListTileControlAffinity.leading,
              ),
              TextField(
                key: const ValueKey('finance-remark-field'),
                controller: _financeRemarkController,
                maxLines: 3,
                decoration: const InputDecoration(labelText: '财务备注'),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          key: const ValueKey('finance-save-button'),
          onPressed: _saving ? null : _save,
          icon: _saving
              ? const SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.save_rounded),
          label: const Text('保存财务信息'),
        ),
      ],
    );
  }
}

class _InlineNotice extends StatelessWidget {
  const _InlineNotice({
    required this.message,
    required this.tone,
  });

  final String message;
  final StatusTone tone;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: StatusTag(label: message, tone: tone),
    );
  }
}

class _SectionState extends StatelessWidget {
  const _SectionState({
    required this.message,
    this.loading = false,
  });

  final String message;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Center(
        child: loading
            ? Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const SizedBox.square(
                    dimension: 24,
                    child: CircularProgressIndicator(strokeWidth: 2.4),
                  ),
                  const SizedBox(height: 12),
                  Text(message),
                ],
              )
            : Text(
                message,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
      ),
    );
  }
}

const _financeFilters = [
  '订单金额',
  '退款退单',
  '物流费用',
  '标记信息',
  '开票待办',
  '售后确认',
];

String _messageForError(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  return '操作失败，请稍后重试。';
}

String _financeFilterTitle(String filter) {
  switch (filter) {
    case '退款退单':
      return '退款退单';
    case '物流费用':
      return '物流费用待补';
    case '标记信息':
      return '标记信息待办';
    case '开票待办':
      return '开票待办';
    case '售后确认':
      return '待确认售后';
    case '订单金额':
    default:
      return '订单财务明细';
  }
}

String _orderTypeLabel(String type) {
  switch (type) {
    case 'buyback':
      return '回购订单';
    case 'external':
      return '外销订单';
    case 'internal':
      return '内购订单';
    case 'after_sales':
      return '售后订单';
    case 'travel_group':
    default:
      return '旅行团订单';
  }
}

String _orderStatusLabel(String status) {
  switch (status) {
    case 'valid':
      return '有效';
    case 'partial_refund':
      return '部分退款';
    case 'refunded':
      return '已退款';
    case 'cancelled':
      return '已取消';
    default:
      return status;
  }
}

String _customerMarkLabel(SalesOrderRecord order) {
  return (order.customer?.financeMark ?? false) ? '客户已标记' : '客户未标记';
}

String _fieldValue(String? value) {
  final normalized = value?.trim();
  if (normalized == null || normalized.isEmpty) {
    return '未填写';
  }
  return normalized;
}

String _dateTimeLabel(String? value) {
  final text = value?.trim();
  if (text == null || text.isEmpty) {
    return '未填写';
  }
  return text.replaceFirst('T', ' ').replaceFirst(RegExp(r'\.\d{3}Z$'), '');
}

String _invoiceLabel(SalesOrderRecord order) {
  if (order.invoiceIssued) {
    return '已开票';
  }
  if (order.invoiceRequired) {
    return '待开票';
  }
  return '无需开票';
}

bool _isRefundOrCancelledOrder(SalesOrderRecord order) {
  return order.status == 'partial_refund' ||
      order.status == 'refunded' ||
      order.status == 'cancelled';
}

bool _hasLogisticsReason(FinancePendingLogisticsRecord record) {
  return record.reasons.any(
    (reason) =>
        reason == 'missing_logistics_no' || reason == 'missing_logistics_fee',
  );
}

bool _hasInvoiceReason(FinancePendingLogisticsRecord record) {
  return record.reasons.contains('pending_invoice');
}

String _pendingLogisticsReasonLabel(String reason) {
  switch (reason) {
    case 'missing_logistics_no':
      return '待补物流单号';
    case 'missing_logistics_fee':
      return '待补运费';
    case 'pending_invoice':
      return '待开票';
    default:
      return reason;
  }
}

String _pendingMarkTitle(FinancePendingMarkRecord record) {
  if (record.customer != null) {
    return record.customer!.name;
  }
  if (record.travelGroup != null) {
    return record.travelGroup!.groupNo;
  }
  return '待标记记录';
}

String _pendingMarkTypeLabel(String type) {
  switch (type) {
    case 'customer':
      return '客户待标记';
    case 'travel_group':
      return '旅行团待标记';
    default:
      return type;
  }
}

String _pendingMarkReasonLabel(String? reason) {
  switch (reason) {
    case 'customer_unmarked':
      return '客户未标记';
    case 'travel_group_unmarked':
      return '旅行团未标记';
    default:
      return _fieldValue(reason);
  }
}

String _afterSalesStatusLabel(String status) {
  switch (status) {
    case 'negotiating':
      return '协商中';
    case 'waiting_receive':
      return '待收货';
    case 'waiting_resend':
      return '待补发';
    case 'waiting_refund':
      return '待退款';
    case 'completed':
      return '已完成';
    default:
      return status;
  }
}

String _issueTypeLabel(String issueType) {
  switch (issueType) {
    case 'quality_issue':
      return '质量问题';
    case 'logistics_damage':
      return '物流破损';
    case 'wrong_item':
      return '错发商品';
    case 'missing_item':
      return '少发漏发';
    case 'customer_return':
      return '客户退货';
    case 'invoice_issue':
      return '发票问题';
    case 'other':
      return '其他';
    default:
      return issueType;
  }
}

String _actionTypeLabel(String actionType) {
  switch (actionType) {
    case 'record_only':
      return '仅记录';
    case 'refund':
      return '部分退款';
    case 'return_refund':
      return '退货退款';
    case 'resend':
      return '补发';
    case 'exchange':
      return '换货';
    case 'cancel_order':
      return '取消订单';
    default:
      return actionType;
  }
}

String _moneyInputText(int cents) {
  if (cents == 0) {
    return '0';
  }
  final yuan = cents ~/ 100;
  final fen = cents.abs() % 100;
  if (fen == 0) {
    return '$yuan';
  }
  return '${cents / 100}';
}

int? _moneyCentsOrNull(String value) {
  final normalized = value.trim();
  if (normalized.isEmpty) {
    return 0;
  }
  final parsed = double.tryParse(normalized);
  if (parsed == null) {
    return null;
  }
  return (parsed * 100).round();
}
