import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';
import 'package:path_provider/path_provider.dart';

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
    this.documentsDirectoryProvider,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;
  final Future<Directory> Function()? documentsDirectoryProvider;

  @override
  State<FinanceQueryPage> createState() => _FinanceQueryPageState();
}

class _FinanceQueryPageState extends State<FinanceQueryPage> {
  late BusinessApi _businessApi;
  final TextEditingController _queryController = TextEditingController();
  final TextEditingController _commissionTargetUserController =
      TextEditingController();
  final TextEditingController _summaryAgencyController =
      TextEditingController();
  final TextEditingController _summaryGuideController = TextEditingController();

  DateTime _start = DateTime(DateTime.now().year, DateTime.now().month, 1);
  DateTime _end = DateTime.now();
  String _filter = '订单金额';
  bool _loading = true;
  bool _commissionLoading = false;
  bool _commissionLoaded = false;
  bool _summaryLoading = false;
  bool _summaryLoaded = false;
  bool _exportingCommissionRecords = false;
  bool _exportingTravelGroupSummaries = false;
  String? _errorMessage;
  String? _commissionErrorMessage;
  String? _summaryErrorMessage;
  FinanceWorkbenchRecord? _workbench;
  List<CommissionRecord> _commissionRecords = const <CommissionRecord>[];
  List<TravelGroupFinanceSummaryRecord> _travelGroupSummaries =
      const <TravelGroupFinanceSummaryRecord>[];
  String? _confirmingAfterSalesId;
  String? _updatingCommissionId;
  String? _updatingSummaryTravelGroupId;
  String _commissionTargetType = _commissionTargetTypeAll;
  String _commissionConfirmFilter = _commissionConfirmAll;
  String _summaryConfirmFilter = _summaryConfirmAll;

  bool get _canConfirmAfterSalesRefund =>
      widget.role == UserRole.superAdmin ||
      widget.role == UserRole.admin ||
      widget.role == UserRole.finance;

  bool get _canEditFinanceOrders =>
      widget.role == UserRole.superAdmin ||
      widget.role == UserRole.admin ||
      widget.role == UserRole.finance;

  bool get _canManagePaymentMethods => _canEditFinanceOrders;

  bool get _canManageTasterCommission =>
      widget.role == UserRole.superAdmin ||
      widget.role == UserRole.admin ||
      widget.role == UserRole.finance;

  bool get _canManageTravelGroupFinanceSummary =>
      widget.role == UserRole.superAdmin ||
      widget.role == UserRole.admin ||
      widget.role == UserRole.finance;

  bool get _canExportStage7 =>
      widget.role == UserRole.superAdmin ||
      widget.role == UserRole.admin ||
      widget.role == UserRole.finance ||
      widget.role == UserRole.boss;

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
    _commissionTargetUserController.dispose();
    _summaryAgencyController.dispose();
    _summaryGuideController.dispose();
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

  Future<void> _refreshData() async {
    await _loadData();
    if (_filter == _commissionFilter) {
      await _loadCommissionRecords();
    }
    if (_filter == _summaryFilter) {
      await _loadTravelGroupFinanceSummaries();
    }
  }

  Future<void> _loadCommissionRecords() async {
    setState(() {
      _commissionLoading = true;
      _commissionErrorMessage = null;
    });

    try {
      final records = await _businessApi.listCommissionRecords(
        start: _start,
        end: _end,
        targetType: _commissionTargetType == _commissionTargetTypeAll
            ? null
            : _commissionTargetType,
        targetUserId: _nullableText(_commissionTargetUserController.text),
        isConfirmed: _commissionConfirmFilter == _commissionConfirmAll
            ? null
            : _commissionConfirmFilter == _commissionConfirmConfirmed,
        query: _nullableText(_queryController.text),
        limit: 100,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _commissionRecords = records;
        _commissionLoaded = true;
        _commissionLoading = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _commissionLoading = false;
        _commissionErrorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _loadTravelGroupFinanceSummaries() async {
    setState(() {
      _summaryLoading = true;
      _summaryErrorMessage = null;
    });

    try {
      final summaries = await _businessApi.listTravelGroupFinanceSummaries(
        start: _start,
        end: _end,
        agencyName: _nullableText(_summaryAgencyController.text),
        guideName: _nullableText(_summaryGuideController.text),
        agencyDeductionConfirmed: _summaryConfirmFilter == _summaryConfirmAll
            ? null
            : _summaryConfirmFilter == _summaryConfirmConfirmed,
        query: _nullableText(_queryController.text),
        limit: 100,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _travelGroupSummaries = summaries;
        _summaryLoaded = true;
        _summaryLoading = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _summaryLoading = false;
        _summaryErrorMessage = _messageForError(error);
      });
    }
  }

  void _selectFilter(String value) {
    setState(() => _filter = value);
    if (value == _commissionFilter && !_commissionLoaded) {
      _loadCommissionRecords();
    }
    if (value == _summaryFilter && !_summaryLoaded) {
      _loadTravelGroupFinanceSummaries();
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
          title: '物流单号与品鉴师提成填写',
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
                _refreshData();
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
                  onPressed: _loading ? null : _refreshData,
                  icon: const Icon(Icons.search_rounded),
                  label: const Text('查询'),
                ),
                if (_canManagePaymentMethods) ...[
                  const SizedBox(width: 12),
                  OutlinedButton.icon(
                    key: const ValueKey('finance-payment-methods-button'),
                    onPressed: _openPaymentMethodManagement,
                    icon: const Icon(Icons.account_balance_wallet_rounded),
                    label: const Text('收款方式管理'),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 12),
            AppFilterBar(
              filters: _financeFilters,
              selected: _filter,
              onSelected: _selectFilter,
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
              trailing: _buildFinanceFilterActions(),
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

  Widget _buildFinanceFilterActions() {
    final refreshing = _loading || _commissionLoading || _summaryLoading;
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        if (_canExportStage7 && _filter == _commissionFilter)
          OutlinedButton.icon(
            key: const ValueKey('finance-commission-export-button'),
            onPressed: _commissionLoading || _exportingCommissionRecords
                ? null
                : _exportCommissionRecords,
            icon: _exportingCommissionRecords
                ? const SizedBox.square(
                    dimension: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.download_rounded),
            label: Text(_exportingCommissionRecords ? '导出中' : '导出提成'),
          ),
        if (_canExportStage7 && _filter == _summaryFilter)
          OutlinedButton.icon(
            key: const ValueKey('finance-summary-export-button'),
            onPressed: _summaryLoading || _exportingTravelGroupSummaries
                ? null
                : _exportTravelGroupFinanceSummaries,
            icon: _exportingTravelGroupSummaries
                ? const SizedBox.square(
                    dimension: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.download_rounded),
            label: Text(_exportingTravelGroupSummaries ? '导出中' : '导出汇总'),
          ),
        TextButton.icon(
          onPressed: refreshing ? null : _refreshData,
          icon: const Icon(Icons.refresh_rounded),
          label: const Text('刷新'),
        ),
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
      case _commissionFilter:
        return _buildCommissionRecordWorkbench();
      case _summaryFilter:
        return _buildTravelGroupFinanceSummaryWorkbench();
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

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var index = 0; index < orders.length; index++) ...[
          _FinanceOrderInlineEditor(
            key: ValueKey('finance-order-inline-${orders[index].id}'),
            businessApi: _businessApi,
            order: orders[index],
            canEdit: _canEditFinanceOrders,
            onOpenMore: _canEditFinanceOrders
                ? () => _openFinanceEditor(orders[index])
                : null,
            onSaved: _replaceRecentOrder,
          ),
          if (index < orders.length - 1) const SizedBox(height: 12),
        ],
      ],
    );
  }

  Widget _buildCommissionRecordWorkbench() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          spacing: 12,
          runSpacing: 12,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            SizedBox(
              width: 220,
              child: TextField(
                key: const ValueKey('finance-commission-target-user-field'),
                controller: _commissionTargetUserController,
                decoration: const InputDecoration(
                  labelText: '人员 ID',
                  prefixIcon: Icon(Icons.person_search_rounded),
                ),
              ),
            ),
            SizedBox(
              width: 220,
              child: DropdownButtonFormField<String>(
                key: const ValueKey('finance-commission-target-type-field'),
                initialValue: _commissionTargetType,
                decoration: const InputDecoration(labelText: '提成类型'),
                items: const [
                  DropdownMenuItem(
                    value: _commissionTargetTypeAll,
                    child: Text('全部类型'),
                  ),
                  DropdownMenuItem(
                    value: 'sales_commission',
                    child: Text('销售提成'),
                  ),
                  DropdownMenuItem(
                    value: 'outreach_commission',
                    child: Text('外联提成'),
                  ),
                  DropdownMenuItem(
                    value: 'leader_commission',
                    child: Text('组长提成'),
                  ),
                  DropdownMenuItem(
                    value: 'taster_commission',
                    child: Text('品鉴师提成'),
                  ),
                  DropdownMenuItem(
                    value: 'agency_daily_rebate',
                    child: Text('旅行社日返'),
                  ),
                  DropdownMenuItem(
                    value: 'agency_monthly_rebate',
                    child: Text('旅行社月返'),
                  ),
                ],
                onChanged: _commissionLoading
                    ? null
                    : (value) => setState(() {
                          _commissionTargetType =
                              value ?? _commissionTargetTypeAll;
                        }),
              ),
            ),
            SizedBox(
              width: 180,
              child: DropdownButtonFormField<String>(
                key: const ValueKey('finance-commission-confirm-filter'),
                initialValue: _commissionConfirmFilter,
                decoration: const InputDecoration(labelText: '确认状态'),
                items: const [
                  DropdownMenuItem(
                    value: _commissionConfirmAll,
                    child: Text('全部状态'),
                  ),
                  DropdownMenuItem(
                    value: _commissionConfirmConfirmed,
                    child: Text('已确认'),
                  ),
                  DropdownMenuItem(
                    value: _commissionConfirmPending,
                    child: Text('待确认'),
                  ),
                ],
                onChanged: _commissionLoading
                    ? null
                    : (value) => setState(() {
                          _commissionConfirmFilter =
                              value ?? _commissionConfirmAll;
                        }),
              ),
            ),
            FilledButton.icon(
              key: const ValueKey('finance-commission-query-button'),
              onPressed: _commissionLoading ? null : _loadCommissionRecords,
              icon: const Icon(Icons.search_rounded),
              label: const Text('查询提成'),
            ),
          ],
        ),
        if (_commissionErrorMessage != null) ...[
          const SizedBox(height: 12),
          _InlineNotice(
            message: _commissionErrorMessage!,
            tone: StatusTone.danger,
          ),
        ],
        const SizedBox(height: 12),
        if (_commissionLoading && _commissionRecords.isEmpty)
          const _SectionState(message: '正在加载提成明细', loading: true)
        else if (_commissionRecords.isEmpty)
          const _SectionState(message: '当前范围暂无提成积分记录')
        else
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: DataTable(
              columns: const [
                DataColumn(label: Text('订单号')),
                DataColumn(label: Text('旅行团')),
                DataColumn(label: Text('客户')),
                DataColumn(label: Text('人员')),
                DataColumn(label: Text('类型')),
                DataColumn(label: Text('基础金额')),
                DataColumn(label: Text('提成金额')),
                DataColumn(label: Text('积分金额')),
                DataColumn(label: Text('确认状态')),
                DataColumn(label: Text('提醒')),
                DataColumn(label: Text('操作')),
              ],
              rows: [
                for (final record in _commissionRecords)
                  DataRow(
                    cells: [
                      DataCell(
                        TextButton(
                          key: ValueKey(
                              'finance-commission-detail-${record.id}'),
                          onPressed: () => _openCommissionDetail(record),
                          child: Text(_commissionOrderNo(record)),
                        ),
                      ),
                      DataCell(Text(_commissionTravelGroupNo(record))),
                      DataCell(Text(_commissionCustomerName(record))),
                      DataCell(Text(_commissionTargetName(record))),
                      DataCell(
                          Text(_commissionTargetTypeLabel(record.targetType))),
                      DataCell(Text(formatMoneyCents(record.baseAmountCents))),
                      DataCell(Text(formatMoneyCents(record.amountCents))),
                      DataCell(Text(formatMoneyCents(record.pointsCents))),
                      DataCell(_commissionConfirmTag(record)),
                      DataCell(_commissionWarningsCell(record)),
                      DataCell(_commissionActions(record)),
                    ],
                  ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _commissionConfirmTag(CommissionRecord record) {
    return StatusTag(
      label: record.isConfirmed ? '已确认' : '待确认',
      tone: record.isConfirmed ? StatusTone.success : StatusTone.warning,
    );
  }

  Widget _commissionWarningsCell(CommissionRecord record) {
    final warnings = _commissionWarnings(record);
    if (warnings.isEmpty) {
      return const Text('-');
    }
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 220),
      child: Wrap(
        spacing: 6,
        runSpacing: 4,
        children: [
          for (final warning in warnings.take(3))
            StatusTag(
              label: _commissionWarningLabel(warning),
              tone: StatusTone.warning,
            ),
        ],
      ),
    );
  }

  Widget _commissionActions(CommissionRecord record) {
    if (record.targetType != 'taster_commission' ||
        !_canManageTasterCommission) {
      return const Text('-');
    }
    if (!record.manualInput || record.salesOrderId == null) {
      return const StatusTag(
        label: '历史团级记录',
        tone: StatusTone.info,
      );
    }
    final updating = _updatingCommissionId == record.id;
    return Wrap(
      spacing: 6,
      children: [
        IconButton(
          key: ValueKey('finance-commission-manual-amount-${record.id}'),
          tooltip: '录入/修改金额',
          onPressed: updating ? null : () => _openTasterAmountEditor(record),
          icon: const Icon(Icons.edit_note_rounded),
        ),
        IconButton(
          key: ValueKey(
            record.isConfirmed
                ? 'finance-commission-unconfirm-${record.id}'
                : 'finance-commission-confirm-${record.id}',
          ),
          tooltip: record.isConfirmed ? '取消确认' : '确认',
          onPressed: updating
              ? null
              : () => _setTasterCommissionConfirmed(
                    record,
                    !record.isConfirmed,
                  ),
          icon: Icon(
            record.isConfirmed
                ? Icons.remove_done_rounded
                : Icons.verified_rounded,
          ),
        ),
      ],
    );
  }

  Widget _buildTravelGroupFinanceSummaryWorkbench() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          spacing: 12,
          runSpacing: 12,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            SizedBox(
              width: 220,
              child: TextField(
                key: const ValueKey('finance-summary-agency-field'),
                controller: _summaryAgencyController,
                decoration: const InputDecoration(
                  labelText: '旅行社',
                  prefixIcon: Icon(Icons.business_rounded),
                ),
              ),
            ),
            SizedBox(
              width: 180,
              child: TextField(
                key: const ValueKey('finance-summary-guide-field'),
                controller: _summaryGuideController,
                decoration: const InputDecoration(
                  labelText: '导游',
                  prefixIcon: Icon(Icons.badge_rounded),
                ),
              ),
            ),
            SizedBox(
              width: 180,
              child: DropdownButtonFormField<String>(
                key: const ValueKey('finance-summary-confirm-filter'),
                initialValue: _summaryConfirmFilter,
                decoration: const InputDecoration(labelText: '扣酒确认'),
                items: const [
                  DropdownMenuItem(
                    value: _summaryConfirmAll,
                    child: Text('全部状态'),
                  ),
                  DropdownMenuItem(
                    value: _summaryConfirmConfirmed,
                    child: Text('已确认'),
                  ),
                  DropdownMenuItem(
                    value: _summaryConfirmPending,
                    child: Text('待确认'),
                  ),
                ],
                onChanged: _summaryLoading
                    ? null
                    : (value) => setState(() {
                          _summaryConfirmFilter = value ?? _summaryConfirmAll;
                        }),
              ),
            ),
            FilledButton.icon(
              key: const ValueKey('finance-summary-query-button'),
              onPressed:
                  _summaryLoading ? null : _loadTravelGroupFinanceSummaries,
              icon: const Icon(Icons.search_rounded),
              label: const Text('查询汇总'),
            ),
          ],
        ),
        if (_summaryErrorMessage != null) ...[
          const SizedBox(height: 12),
          _InlineNotice(
            message: _summaryErrorMessage!,
            tone: StatusTone.danger,
          ),
        ],
        const SizedBox(height: 12),
        if (_summaryLoading && _travelGroupSummaries.isEmpty)
          const _SectionState(message: '正在加载返积分汇总', loading: true)
        else if (_travelGroupSummaries.isEmpty)
          const _SectionState(message: '当前范围暂无旅行团返积分汇总')
        else
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: DataTable(
              columns: const [
                DataColumn(label: Text('旅行团')),
                DataColumn(label: Text('日期')),
                DataColumn(label: Text('旅行社')),
                DataColumn(label: Text('导游')),
                DataColumn(label: Text('车牌')),
                DataColumn(label: Text('人数')),
                DataColumn(label: Text('品鉴师')),
                DataColumn(label: Text('销售额')),
                DataColumn(label: Text('货到付款')),
                DataColumn(label: Text('已付定金')),
                DataColumn(label: Text('扣酒成本')),
                DataColumn(label: Text('上单金额')),
                DataColumn(label: Text('积分/日返积分')),
                DataColumn(label: Text('已返积分')),
                DataColumn(label: Text('未返积分')),
                DataColumn(label: Text('月返积分')),
                DataColumn(label: Text('已返月返积分')),
                DataColumn(label: Text('未返月返积分')),
                DataColumn(label: Text('确认状态')),
                DataColumn(label: Text('操作')),
              ],
              rows: [
                for (final summary in _travelGroupSummaries)
                  DataRow(
                    cells: [
                      DataCell(
                        TextButton(
                          key: ValueKey(
                            'finance-summary-detail-${summary.travelGroupId}',
                          ),
                          onPressed: () => _openSummaryDetail(summary),
                          child: Text(_summaryTravelGroupNo(summary)),
                        ),
                      ),
                      DataCell(
                        Text(_fieldValue(summary.travelGroup?.visitDate)),
                      ),
                      DataCell(Text(_summaryAgencyName(summary))),
                      DataCell(Text(_summaryGuideName(summary))),
                      DataCell(
                        Text(_fieldValue(summary.travelGroup?.licensePlate)),
                      ),
                      DataCell(Text('${summary.travelGroup?.guestCount ?? 0}')),
                      DataCell(
                        Text(_fieldValue(summary.travelGroup?.tasterName)),
                      ),
                      DataCell(
                        Text(formatMoneyCents(summary.totalSalesAmountCents)),
                      ),
                      DataCell(
                        Text(
                          formatMoneyCents(
                            summary.totalCashOnDeliveryCents,
                          ),
                        ),
                      ),
                      DataCell(
                        Text(
                          formatMoneyCents(
                            summary.totalPaidDepositCents,
                          ),
                        ),
                      ),
                      DataCell(
                        Text(
                          formatMoneyCents(
                            summary.totalAgencyDeductionCents,
                          ),
                        ),
                      ),
                      DataCell(
                        Text(
                          formatMoneyCents(
                            summary.totalAgencyNetAmountCents,
                          ),
                        ),
                      ),
                      DataCell(
                        Text(
                          formatMoneyCents(summary.totalDailyRebateCents),
                        ),
                      ),
                      DataCell(
                        _rebatePaymentButton(
                          summary,
                          rebateType: 'daily',
                          isPaid: summary.dailyRebatePaid,
                        ),
                      ),
                      DataCell(
                        Text(
                          formatMoneyCents(_dailyUnpaidRebateCents(summary)),
                        ),
                      ),
                      DataCell(
                        Text(
                          formatMoneyCents(summary.totalMonthlyRebateCents),
                        ),
                      ),
                      DataCell(
                        _rebatePaymentButton(
                          summary,
                          rebateType: 'monthly',
                          isPaid: summary.monthlyRebatePaid,
                        ),
                      ),
                      DataCell(
                        Text(
                          formatMoneyCents(_monthlyUnpaidRebateCents(summary)),
                        ),
                      ),
                      DataCell(_summaryConfirmTag(summary)),
                      DataCell(_summaryActions(summary)),
                    ],
                  ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _rebatePaymentButton(
    TravelGroupFinanceSummaryRecord summary, {
    required String rebateType,
    required bool isPaid,
  }) {
    final updating = _updatingSummaryTravelGroupId == summary.travelGroupId;
    if (!summary.summaryExists) {
      return const StatusTag(
        label: '未生成汇总',
        tone: StatusTone.neutral,
      );
    }
    if (!_canManageTravelGroupFinanceSummary) {
      return StatusTag(
        label: isPaid ? '已返' : '未返',
        tone: isPaid ? StatusTone.success : StatusTone.warning,
      );
    }
    final isDaily = rebateType == 'daily';
    final keyPrefix = isDaily ? 'daily' : 'monthly';
    final tooltip = isPaid
        ? (isDaily ? '取消日返已返' : '取消月返已返')
        : (isDaily ? '标记日返已返' : '标记月返已返');
    final icon = isPaid ? Icons.undo_rounded : Icons.payments_rounded;
    final label = isPaid ? '已返' : '标记已返';
    return Tooltip(
      message: tooltip,
      child: SizedBox(
        width: 124,
        child: isPaid
            ? FilledButton.icon(
                key: ValueKey(
                  'finance-summary-$keyPrefix-rebate-paid-'
                  '${summary.travelGroupId}',
                ),
                onPressed: updating
                    ? null
                    : () => _setRebatePaymentStatus(
                          summary,
                          rebateType: rebateType,
                          isPaid: false,
                        ),
                icon: Icon(icon, size: 16),
                label: Text(label),
              )
            : OutlinedButton.icon(
                key: ValueKey(
                  'finance-summary-$keyPrefix-rebate-paid-'
                  '${summary.travelGroupId}',
                ),
                onPressed: updating
                    ? null
                    : () => _setRebatePaymentStatus(
                          summary,
                          rebateType: rebateType,
                          isPaid: true,
                        ),
                icon: Icon(icon, size: 16),
                label: Text(label),
              ),
      ),
    );
  }

  Widget _summaryConfirmTag(TravelGroupFinanceSummaryRecord summary) {
    if (!summary.summaryExists) {
      return const StatusTag(
        label: '暂无出单',
        tone: StatusTone.neutral,
      );
    }
    return StatusTag(
      label: summary.agencyDeductionConfirmed ? '已确认' : '待确认',
      tone: summary.agencyDeductionConfirmed
          ? StatusTone.success
          : StatusTone.warning,
    );
  }

  Widget _summaryActions(TravelGroupFinanceSummaryRecord summary) {
    if (!_canManageTravelGroupFinanceSummary) {
      return const Text('-');
    }
    final updating = _updatingSummaryTravelGroupId == summary.travelGroupId;
    final summaryActionEnabled = summary.summaryExists && !updating;
    return Wrap(
      spacing: 6,
      children: [
        IconButton(
          key: ValueKey('finance-summary-edit-${summary.travelGroupId}'),
          tooltip: summary.summaryExists ? '编辑备注和发送状态' : '未生成汇总，重新计算后可编辑',
          onPressed:
              summaryActionEnabled ? () => _openSummaryEditor(summary) : null,
          icon: const Icon(Icons.edit_note_rounded),
        ),
        IconButton(
          key: ValueKey(
            summary.agencyDeductionConfirmed
                ? 'finance-summary-unconfirm-${summary.travelGroupId}'
                : 'finance-summary-confirm-${summary.travelGroupId}',
          ),
          tooltip: summary.agencyDeductionConfirmed ? '取消扣酒确认' : '确认扣酒成本',
          onPressed: !summaryActionEnabled
              ? null
              : () => _setAgencyDeductionConfirmed(
                    summary,
                    !summary.agencyDeductionConfirmed,
                  ),
          icon: Icon(
            summary.agencyDeductionConfirmed
                ? Icons.remove_done_rounded
                : Icons.verified_rounded,
          ),
        ),
        IconButton(
          key: ValueKey('finance-summary-refresh-${summary.travelGroupId}'),
          tooltip: summary.summaryExists ? '重新计算单团汇总' : '重新计算并生成汇总',
          onPressed:
              updating ? null : () => _refreshTravelGroupSummary(summary),
          icon: const Icon(Icons.sync_rounded),
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
                '发货日期 ${_fieldValue(record.order!.shippingDate)}',
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

  Future<void> _openPaymentMethodManagement() async {
    await showDialog<void>(
      context: context,
      builder: (context) => _PaymentMethodManagementDialog(
        businessApi: _businessApi,
      ),
    );
  }

  Future<void> _exportCommissionRecords() async {
    if (!_canExportStage7 || _exportingCommissionRecords) {
      return;
    }

    setState(() {
      _exportingCommissionRecords = true;
      _commissionErrorMessage = null;
    });

    try {
      final downloadedFile = await _businessApi.downloadCommissionRecordsExcel(
        start: _start,
        end: _end,
        targetType: _commissionTargetType == _commissionTargetTypeAll
            ? null
            : _commissionTargetType,
        targetUserId: _nullableText(_commissionTargetUserController.text),
        isConfirmed: _commissionConfirmFilter == _commissionConfirmAll
            ? null
            : _commissionConfirmFilter == _commissionConfirmConfirmed,
        query: _nullableText(_queryController.text),
        limit: 1000,
      );
      final targetFile = await _writeExportFile(
        downloadedFile,
        'commission-records',
      );
      if (!mounted) {
        return;
      }
      setState(() => _exportingCommissionRecords = false);
      ScaffoldMessenger.of(context).hideCurrentSnackBar();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('提成积分明细已导出：${targetFile.path}')),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      final message = _messageForError(error);
      setState(() {
        _exportingCommissionRecords = false;
        _commissionErrorMessage = message;
      });
      ScaffoldMessenger.of(context).hideCurrentSnackBar();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    }
  }

  Future<void> _exportTravelGroupFinanceSummaries() async {
    if (!_canExportStage7 || _exportingTravelGroupSummaries) {
      return;
    }

    setState(() {
      _exportingTravelGroupSummaries = true;
      _summaryErrorMessage = null;
    });

    try {
      final downloadedFile =
          await _businessApi.downloadTravelGroupFinanceSummariesExcel(
        start: _start,
        end: _end,
        agencyName: _nullableText(_summaryAgencyController.text),
        guideName: _nullableText(_summaryGuideController.text),
        agencyDeductionConfirmed: _summaryConfirmFilter == _summaryConfirmAll
            ? null
            : _summaryConfirmFilter == _summaryConfirmConfirmed,
        query: _nullableText(_queryController.text),
        limit: 1000,
      );
      final targetFile = await _writeExportFile(
        downloadedFile,
        'travel-group-finance-summaries',
      );
      if (!mounted) {
        return;
      }
      setState(() => _exportingTravelGroupSummaries = false);
      ScaffoldMessenger.of(context).hideCurrentSnackBar();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('旅行团返积分汇总已导出：${targetFile.path}')),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      final message = _messageForError(error);
      setState(() {
        _exportingTravelGroupSummaries = false;
        _summaryErrorMessage = message;
      });
      ScaffoldMessenger.of(context).hideCurrentSnackBar();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    }
  }

  Future<File> _writeExportFile(
    DownloadedFile downloadedFile,
    String fallbackPrefix,
  ) async {
    final directory = await (widget.documentsDirectoryProvider?.call() ??
        getApplicationDocumentsDirectory());
    final exportDirectory = Directory(
      '${directory.path}${Platform.pathSeparator}exports',
    );
    await exportDirectory.create(recursive: true);
    final targetFile = await _nextExportFile(
      exportDirectory,
      _safeExportFileName(downloadedFile.fileName, fallbackPrefix),
    );
    await targetFile.writeAsBytes(downloadedFile.bytes, flush: true);
    return targetFile;
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

  Future<void> _openCommissionDetail(CommissionRecord record) async {
    setState(() => _commissionErrorMessage = null);
    try {
      final detail = await _businessApi.getCommissionRecord(record.id);
      if (!mounted) {
        return;
      }
      await showDialog<void>(
        context: context,
        builder: (context) => _CommissionRecordDetailDialog(record: detail),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() => _commissionErrorMessage = _messageForError(error));
    }
  }

  Future<void> _openTasterAmountEditor(CommissionRecord record) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => _TasterCommissionAmountDialog(
        businessApi: _businessApi,
        record: record,
      ),
    );
    if (saved == true) {
      await _loadCommissionRecords();
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('品鉴师提成金额已保存')),
      );
    }
  }

  Future<void> _setTasterCommissionConfirmed(
    CommissionRecord record,
    bool isConfirmed,
  ) async {
    setState(() {
      _updatingCommissionId = record.id;
      _commissionErrorMessage = null;
    });

    try {
      await _businessApi.confirmTasterCommission(record.id, isConfirmed);
      if (!mounted) {
        return;
      }
      await _loadCommissionRecords();
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(isConfirmed ? '品鉴师提成已确认' : '品鉴师提成已取消确认')),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() => _commissionErrorMessage = _messageForError(error));
    } finally {
      if (mounted) {
        setState(() => _updatingCommissionId = null);
      }
    }
  }

  Future<void> _openSummaryDetail(
    TravelGroupFinanceSummaryRecord summary,
  ) async {
    setState(() => _summaryErrorMessage = null);
    try {
      final detail = await _businessApi
          .getTravelGroupFinanceSummary(summary.travelGroupId);
      if (!mounted) {
        return;
      }
      await showDialog<void>(
        context: context,
        builder: (context) =>
            _TravelGroupFinanceSummaryDetailDialog(summary: detail),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() => _summaryErrorMessage = _messageForError(error));
    }
  }

  Future<void> _openSummaryEditor(
    TravelGroupFinanceSummaryRecord summary,
  ) async {
    if (!summary.summaryExists) {
      return;
    }
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => _TravelGroupFinanceSummaryEditorDialog(
        businessApi: _businessApi,
        summary: summary,
      ),
    );
    if (saved == true) {
      await _loadTravelGroupFinanceSummaries();
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('返积分汇总已保存')),
      );
    }
  }

  Future<void> _setAgencyDeductionConfirmed(
    TravelGroupFinanceSummaryRecord summary,
    bool isConfirmed,
  ) async {
    if (!summary.summaryExists) {
      return;
    }
    setState(() {
      _updatingSummaryTravelGroupId = summary.travelGroupId;
      _summaryErrorMessage = null;
    });

    try {
      await _businessApi.confirmAgencyDeduction(
        summary.travelGroupId,
        isConfirmed,
      );
      if (!mounted) {
        return;
      }
      await _loadTravelGroupFinanceSummaries();
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(isConfirmed ? '扣酒成本已确认' : '扣酒成本已取消确认')),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() => _summaryErrorMessage = _messageForError(error));
    } finally {
      if (mounted) {
        setState(() => _updatingSummaryTravelGroupId = null);
      }
    }
  }

  Future<void> _setRebatePaymentStatus(
    TravelGroupFinanceSummaryRecord summary, {
    required String rebateType,
    required bool isPaid,
  }) async {
    if (!summary.summaryExists) {
      return;
    }
    setState(() {
      _updatingSummaryTravelGroupId = summary.travelGroupId;
      _summaryErrorMessage = null;
    });

    try {
      if (rebateType == 'daily') {
        await _businessApi.setDailyRebatePaid(summary.travelGroupId, isPaid);
      } else {
        await _businessApi.setMonthlyRebatePaid(summary.travelGroupId, isPaid);
      }
      if (!mounted) {
        return;
      }
      await _loadTravelGroupFinanceSummaries();
      if (!mounted) {
        return;
      }
      final label = rebateType == 'daily' ? '日返积分' : '月返积分';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(isPaid ? '$label已标记已返' : '$label已取消已返')),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() => _summaryErrorMessage = _messageForError(error));
    } finally {
      if (mounted) {
        setState(() => _updatingSummaryTravelGroupId = null);
      }
    }
  }

  Future<void> _refreshTravelGroupSummary(
    TravelGroupFinanceSummaryRecord summary,
  ) async {
    setState(() {
      _updatingSummaryTravelGroupId = summary.travelGroupId;
      _summaryErrorMessage = null;
    });

    try {
      await _businessApi.refreshTravelGroupFinanceSummary(
        summary.travelGroupId,
      );
      if (!mounted) {
        return;
      }
      await _loadTravelGroupFinanceSummaries();
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('单团返积分汇总已刷新')),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() => _summaryErrorMessage = _messageForError(error));
    } finally {
      if (mounted) {
        setState(() => _updatingSummaryTravelGroupId = null);
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

class _PaymentMethodManagementDialog extends StatefulWidget {
  const _PaymentMethodManagementDialog({required this.businessApi});

  final BusinessApi businessApi;

  @override
  State<_PaymentMethodManagementDialog> createState() =>
      _PaymentMethodManagementDialogState();
}

class _PaymentMethodManagementDialogState
    extends State<_PaymentMethodManagementDialog> {
  List<SalesPaymentMethodRecord> _methods = const [];
  bool _loading = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    try {
      final methods = await widget.businessApi.listPaymentMethods(
        includeInactive: true,
      );
      if (!mounted) return;
      setState(() {
        _methods = methods;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _edit([SalesPaymentMethodRecord? method]) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => _PaymentMethodEditDialog(
        businessApi: widget.businessApi,
        method: method,
      ),
    );
    if (saved == true && mounted) {
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('收款方式管理'),
      content: SizedBox(
        width: 680,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('支持新增、改名、分类、启停、排序及设置默认；历史订单保留原快照。'),
              if (_loading) ...[
                const SizedBox(height: 16),
                const LinearProgressIndicator(),
              ],
              if (_errorMessage != null) ...[
                const SizedBox(height: 12),
                _InlineNotice(
                  message: _errorMessage!,
                  tone: StatusTone.danger,
                ),
              ],
              if (!_loading)
                for (final method in _methods)
                  ListTile(
                    key: ValueKey('payment-method-${method.id}'),
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                      method.name,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    subtitle: Text(
                      '${method.isAgencyCollection ? '代收营业款' : '直接收款'}'
                      ' · 排序 ${method.sortOrder}'
                      '${method.isActive ? '' : ' · 已停用'}',
                    ),
                    trailing: Wrap(
                      spacing: 8,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        if (method.isDefault)
                          const StatusTag(
                            label: '默认',
                            tone: StatusTone.success,
                          ),
                        IconButton(
                          tooltip: '编辑',
                          onPressed: () => _edit(method),
                          icon: const Icon(Icons.edit_rounded),
                        ),
                      ],
                    ),
                  ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('关闭'),
        ),
        FilledButton.icon(
          key: const ValueKey('payment-method-add-button'),
          onPressed: _loading ? null : () => _edit(),
          icon: const Icon(Icons.add_rounded),
          label: const Text('新增收款方式'),
        ),
      ],
    );
  }
}

class _PaymentMethodEditDialog extends StatefulWidget {
  const _PaymentMethodEditDialog({
    required this.businessApi,
    this.method,
  });

  final BusinessApi businessApi;
  final SalesPaymentMethodRecord? method;

  @override
  State<_PaymentMethodEditDialog> createState() =>
      _PaymentMethodEditDialogState();
}

class _PaymentMethodEditDialogState extends State<_PaymentMethodEditDialog> {
  late final TextEditingController _nameController;
  late final TextEditingController _sortController;
  late String _category;
  late bool _isActive;
  late bool _isDefault;
  bool _saving = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    final method = widget.method;
    _nameController = TextEditingController(text: method?.name ?? '');
    _sortController = TextEditingController(text: '${method?.sortOrder ?? 0}');
    _category = method?.category ?? 'direct_receipt';
    _isActive = method?.isActive ?? true;
    _isDefault = method?.isDefault ?? false;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _sortController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _nameController.text.trim();
    final sortOrder = int.tryParse(_sortController.text.trim());
    if (name.isEmpty || sortOrder == null || sortOrder < 0) {
      setState(() => _errorMessage = '请填写名称，排序须为非负整数');
      return;
    }
    setState(() {
      _saving = true;
      _errorMessage = null;
    });
    final body = <String, dynamic>{
      'name': name,
      'category': _category,
      'isActive': _isDefault ? true : _isActive,
      'sortOrder': sortOrder,
      'isDefault': _isDefault,
    };
    try {
      final method = widget.method;
      if (method == null) {
        await widget.businessApi.createPaymentMethod(body);
      } else {
        await widget.businessApi.updatePaymentMethod(method.id, body);
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.method == null ? '新增收款方式' : '编辑收款方式'),
      content: SizedBox(
        width: 440,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              key: const ValueKey('payment-method-name-field'),
              controller: _nameController,
              decoration: const InputDecoration(labelText: '名称'),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              key: const ValueKey('payment-method-category-field'),
              initialValue: _category,
              decoration: const InputDecoration(labelText: '分类'),
              items: const [
                DropdownMenuItem(
                  value: 'direct_receipt',
                  child: Text('直接收款'),
                ),
                DropdownMenuItem(
                  value: 'agency_collection',
                  child: Text('代收营业款'),
                ),
              ],
              onChanged: _saving
                  ? null
                  : (value) => setState(
                        () => _category = value ?? 'direct_receipt',
                      ),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('payment-method-sort-field'),
              controller: _sortController,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(labelText: '排序'),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('启用'),
              value: _isDefault ? true : _isActive,
              onChanged: _saving || _isDefault
                  ? null
                  : (value) => setState(() => _isActive = value),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('设为默认'),
              subtitle: const Text('默认方式会自动启用'),
              value: _isDefault,
              onChanged: _saving
                  ? null
                  : (value) => setState(() {
                        _isDefault = value;
                        if (value) _isActive = true;
                      }),
            ),
            if (_errorMessage != null)
              _InlineNotice(
                message: _errorMessage!,
                tone: StatusTone.danger,
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(false),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          key: const ValueKey('payment-method-save-button'),
          onPressed: _saving ? null : _save,
          icon: _saving
              ? const SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.save_rounded),
          label: const Text('保存'),
        ),
      ],
    );
  }
}

class _FinanceOrderInlineEditor extends StatefulWidget {
  const _FinanceOrderInlineEditor({
    super.key,
    required this.businessApi,
    required this.order,
    required this.canEdit,
    required this.onSaved,
    this.onOpenMore,
  });

  final BusinessApi businessApi;
  final SalesOrderRecord order;
  final bool canEdit;
  final ValueChanged<SalesOrderRecord> onSaved;
  final VoidCallback? onOpenMore;

  @override
  State<_FinanceOrderInlineEditor> createState() =>
      _FinanceOrderInlineEditorState();
}

class _FinanceOrderInlineEditorState extends State<_FinanceOrderInlineEditor> {
  late final TextEditingController _logisticsNoController;
  late final TextEditingController _commissionController;
  bool _logisticsDirty = false;
  bool _commissionDirty = false;
  bool _saving = false;
  bool _confirming = false;
  final Set<String> _confirmingPaymentDetailIds = <String>{};
  String? _errorMessage;

  bool get _hasTaster =>
      widget.order.travelGroupId?.isNotEmpty == true &&
      widget.order.tasterId?.isNotEmpty == true;

  @override
  void initState() {
    super.initState();
    _logisticsNoController = TextEditingController(
      text: widget.order.logisticsNo ?? '',
    );
    _commissionController = TextEditingController(
      text: widget.order.tasterCommission == null
          ? ''
          : _moneyInputText(widget.order.tasterCommission!.amountCents),
    );
  }

  @override
  void didUpdateWidget(covariant _FinanceOrderInlineEditor oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.order.id != widget.order.id) {
      _logisticsNoController.text = widget.order.logisticsNo ?? '';
      _commissionController.text = widget.order.tasterCommission == null
          ? ''
          : _moneyInputText(widget.order.tasterCommission!.amountCents);
      _logisticsDirty = false;
      _commissionDirty = false;
      _errorMessage = null;
      return;
    }
    if (!_logisticsDirty &&
        oldWidget.order.logisticsNo != widget.order.logisticsNo) {
      _logisticsNoController.text = widget.order.logisticsNo ?? '';
    }
    if (!_commissionDirty &&
        (oldWidget.order.tasterCommission?.recordId !=
                widget.order.tasterCommission?.recordId ||
            oldWidget.order.tasterCommission?.amountCents !=
                widget.order.tasterCommission?.amountCents)) {
      _commissionController.text = widget.order.tasterCommission == null
          ? ''
          : _moneyInputText(widget.order.tasterCommission!.amountCents);
    }
  }

  @override
  void dispose() {
    _logisticsNoController.dispose();
    _commissionController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final commissionText = _commissionController.text.trim();
    int? amountCents;
    if (_hasTaster && _commissionDirty && commissionText.isNotEmpty) {
      amountCents = _moneyCentsOrNull(commissionText);
      if (amountCents == null || amountCents < 0) {
        setState(() {
          _errorMessage = '品鉴师提成须为非负金额，且最多保留两位小数';
        });
        return;
      }
    }

    setState(() {
      _saving = true;
      _errorMessage = null;
    });
    try {
      if (amountCents != null) {
        await widget.businessApi.saveSalesOrderTasterCommission(
          salesOrderId: widget.order.id,
          recordId: widget.order.tasterCommission?.recordId,
          amountCents: amountCents,
        );
      }
      await widget.businessApi.updateSalesOrderFinance(
        widget.order.id,
        {
          'logisticsNo': _logisticsNoController.text.trim(),
        },
      );
      final updated = await widget.businessApi.getSalesOrder(widget.order.id);
      if (!mounted) {
        return;
      }
      _logisticsNoController.text = updated.logisticsNo ?? '';
      _commissionController.text = updated.tasterCommission == null
          ? ''
          : _moneyInputText(updated.tasterCommission!.amountCents);
      setState(() {
        _saving = false;
        _logisticsDirty = false;
        _commissionDirty = false;
      });
      widget.onSaved(updated);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${updated.orderNo} 已保存')),
      );
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

  Future<void> _setConfirmed(bool isConfirmed) async {
    final recordId = widget.order.tasterCommission?.recordId;
    if (recordId == null || recordId.isEmpty || _commissionDirty) {
      return;
    }
    setState(() {
      _confirming = true;
      _errorMessage = null;
    });
    try {
      await widget.businessApi.confirmTasterCommission(recordId, isConfirmed);
      final updated = await widget.businessApi.getSalesOrder(widget.order.id);
      if (!mounted) {
        return;
      }
      setState(() => _confirming = false);
      widget.onSaved(updated);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _confirming = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _setAgencyCollectionConfirmed(
    SalesOrderPaymentDetailRecord detail,
  ) async {
    setState(() {
      _confirmingPaymentDetailIds.add(detail.id);
      _errorMessage = null;
    });
    try {
      final updated = await widget.businessApi.confirmAgencyCollectionPayment(
        widget.order.id,
        detail.id,
        !detail.agencyCollectionConfirmed,
      );
      if (!mounted) return;
      setState(() => _confirmingPaymentDetailIds.remove(detail.id));
      widget.onSaved(updated);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _confirmingPaymentDetailIds.remove(detail.id);
        _errorMessage = _messageForError(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final commission = widget.order.tasterCommission;
    final isConfirmed = !_commissionDirty && commission?.isConfirmed == true;
    final disabled = !widget.canEdit || _saving || _confirming;

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              spacing: 12,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                TextButton.icon(
                  key: ValueKey('finance-order-more-${widget.order.id}'),
                  onPressed: widget.onOpenMore,
                  icon: const Icon(Icons.receipt_long_rounded),
                  label: Text(widget.order.orderNo),
                ),
                Text(widget.order.customerName),
                Text('发货 ${_fieldValue(widget.order.shippingDate)}'),
                Text(
                  widget.order.travelGroup?.groupNo ??
                      _orderTypeLabel(widget.order.orderType),
                ),
                Text(_orderStatusLabel(widget.order.status)),
                Text(_customerMarkLabel(widget.order)),
                Text(
                  _hasTaster
                      ? '品鉴师 ${widget.order.tasterName ?? widget.order.tasterId}'
                      : '无关联品鉴师',
                ),
                StatusTag(
                  label: commission == null
                      ? '尚未填写'
                      : isConfirmed
                          ? '已确认'
                          : '待确认',
                  tone: isConfirmed ? StatusTone.success : StatusTone.warning,
                ),
                MoneyText(cents: widget.order.totalAmountCents),
              ],
            ),
            if (widget.order.paymentDetails.isNotEmpty) ...[
              const SizedBox(height: 10),
              Wrap(
                spacing: 10,
                runSpacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  for (final detail in widget.order.paymentDetails) ...[
                    Text(
                      '${detail.paymentMethodNameSnapshot} '
                      '${formatMoneyCents(detail.amountCents)}',
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    if (detail.isAgencyCollection)
                      OutlinedButton.icon(
                        key: ValueKey(
                          'finance-agency-confirm-${widget.order.id}-${detail.id}',
                        ),
                        onPressed: !widget.canEdit ||
                                _confirmingPaymentDetailIds.contains(detail.id)
                            ? null
                            : () => _setAgencyCollectionConfirmed(detail),
                        icon: _confirmingPaymentDetailIds.contains(detail.id)
                            ? const SizedBox.square(
                                dimension: 14,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2),
                              )
                            : Icon(
                                detail.agencyCollectionConfirmed
                                    ? Icons.undo_rounded
                                    : Icons.verified_rounded,
                              ),
                        label: Text(
                          detail.agencyCollectionConfirmed
                              ? '撤销代收到账'
                              : '确认代收到账',
                        ),
                      ),
                  ],
                ],
              ),
            ] else if (widget.order.paymentDetailsSummary.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(
                widget.order.paymentDetailsSummary,
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            ],
            const SizedBox(height: 12),
            LayoutBuilder(
              builder: (context, constraints) {
                final fieldWidth =
                    constraints.maxWidth >= 720 ? 260.0 : constraints.maxWidth;
                return Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  crossAxisAlignment: WrapCrossAlignment.start,
                  children: [
                    SizedBox(
                      width: fieldWidth,
                      child: TextField(
                        key: ValueKey(
                          'finance-order-logistics-no-${widget.order.id}',
                        ),
                        controller: _logisticsNoController,
                        enabled: !disabled,
                        onChanged: (_) => setState(() {
                          _logisticsDirty = true;
                          _errorMessage = null;
                        }),
                        decoration: const InputDecoration(
                          labelText: '物流单号',
                          prefixIcon: Icon(Icons.local_shipping_rounded),
                        ),
                      ),
                    ),
                    SizedBox(
                      width: fieldWidth,
                      child: TextField(
                        key: ValueKey(
                          'finance-order-taster-commission-${widget.order.id}',
                        ),
                        controller: _commissionController,
                        enabled: !disabled && _hasTaster,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        inputFormatters: const [_MoneyTextInputFormatter()],
                        onChanged: (_) => setState(() {
                          _commissionDirty = true;
                          _errorMessage = null;
                        }),
                        decoration: InputDecoration(
                          labelText: '品鉴师提成（元）',
                          helperText: _hasTaster
                              ? '空白表示尚未填写；0 表示明确填写为零'
                              : '无关联品鉴师，不能填写提成',
                          prefixIcon: const Icon(Icons.payments_rounded),
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
            if (_errorMessage != null) ...[
              const SizedBox(height: 12),
              _InlineNotice(
                message: _errorMessage!,
                tone: StatusTone.danger,
              ),
            ],
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton.icon(
                  key: ValueKey('finance-order-save-${widget.order.id}'),
                  onPressed: disabled ? null : _save,
                  icon: _saving
                      ? const SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.save_rounded),
                  label: const Text('保存当前订单'),
                ),
                OutlinedButton.icon(
                  key: ValueKey(
                    isConfirmed
                        ? 'finance-order-unconfirm-${widget.order.id}'
                        : 'finance-order-confirm-${widget.order.id}',
                  ),
                  onPressed: disabled || commission == null || _commissionDirty
                      ? null
                      : () => _setConfirmed(!isConfirmed),
                  icon: Icon(
                    isConfirmed
                        ? Icons.remove_done_rounded
                        : Icons.verified_rounded,
                  ),
                  label: Text(isConfirmed ? '取消确认' : '确认提成'),
                ),
                Text('物流单号 ${_fieldValue(widget.order.logisticsNo)}'),
                Text('运费 ${formatMoneyCents(widget.order.logisticsFeeCents)}'),
                Text(_invoiceLabel(widget.order)),
              ],
            ),
          ],
        ),
      ),
    );
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

class _TasterCommissionAmountDialog extends StatefulWidget {
  const _TasterCommissionAmountDialog({
    required this.businessApi,
    required this.record,
  });

  final BusinessApi businessApi;
  final CommissionRecord record;

  @override
  State<_TasterCommissionAmountDialog> createState() =>
      _TasterCommissionAmountDialogState();
}

class _TasterCommissionAmountDialogState
    extends State<_TasterCommissionAmountDialog> {
  late final TextEditingController _amountController;
  bool _saving = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _amountController =
        TextEditingController(text: _moneyInputText(widget.record.amountCents));
  }

  @override
  void dispose() {
    _amountController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final amountCents = _moneyCentsOrNull(_amountController.text);
    if (amountCents == null || amountCents < 0) {
      setState(() => _errorMessage = '提成金额不能小于 0，且必须是有效金额');
      return;
    }

    setState(() {
      _saving = true;
      _errorMessage = null;
    });

    try {
      await widget.businessApi.updateTasterCommissionManualAmount(
        widget.record.id,
        {'amountCents': amountCents},
      );
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(true);
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
      title: const Text('录入品鉴师提成'),
      content: SizedBox(
        width: 420,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '${_commissionTravelGroupNo(widget.record)} · ${_commissionTargetName(widget.record)}',
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            const SizedBox(height: 12),
            if (_errorMessage != null) ...[
              _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
              const SizedBox(height: 12),
            ],
            TextField(
              key: const ValueKey('finance-taster-commission-amount-field'),
              controller: _amountController,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: '提成金额（元）',
                prefixIcon: Icon(Icons.payments_rounded),
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(false),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          key: const ValueKey('finance-taster-commission-save-button'),
          onPressed: _saving ? null : _save,
          icon: _saving
              ? const SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.save_rounded),
          label: const Text('保存金额'),
        ),
      ],
    );
  }
}

class _CommissionRecordDetailDialog extends StatelessWidget {
  const _CommissionRecordDetailDialog({required this.record});

  final CommissionRecord record;

  @override
  Widget build(BuildContext context) {
    final warnings = _commissionWarnings(record);
    return AlertDialog(
      title: Text('提成明细 · ${_commissionTargetTypeLabel(record.targetType)}'),
      content: SingleChildScrollView(
        child: SizedBox(
          width: 620,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _DetailLine(label: '订单号', value: _commissionOrderNo(record)),
              _DetailLine(
                  label: '旅行团', value: _commissionTravelGroupNo(record)),
              _DetailLine(label: '客户', value: _commissionCustomerName(record)),
              _DetailLine(label: '人员', value: _commissionTargetName(record)),
              _DetailLine(label: '旅行社', value: _commissionAgencyName(record)),
              const Divider(height: 24),
              _DetailLine(
                label: '原始金额',
                value: formatMoneyCents(record.grossAmountCents),
              ),
              _DetailLine(
                label: '已确认退款',
                value: formatMoneyCents(record.confirmedRefundAmountCents),
              ),
              _DetailLine(
                label: '基础金额',
                value: formatMoneyCents(record.baseAmountCents),
              ),
              _DetailLine(
                label: '扣减成本',
                value: formatMoneyCents(record.deductionAmountCents),
              ),
              _DetailLine(
                label: '比例快照',
                value: record.rateSnapshot ?? '-',
              ),
              _DetailLine(
                label: '提成金额',
                value: formatMoneyCents(record.amountCents),
              ),
              _DetailLine(
                label: '积分金额',
                value: formatMoneyCents(record.pointsCents),
              ),
              _DetailLine(
                label: '确认状态',
                value: record.isConfirmed ? '已确认' : '待确认',
              ),
              if (record.confirmedBy != null || record.confirmedAt != null)
                _DetailLine(
                  label: '确认信息',
                  value:
                      '${_userName(record.confirmedBy)} · ${_fieldValue(record.confirmedAt)}',
                ),
              if (warnings.isNotEmpty) ...[
                const Divider(height: 24),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final warning in warnings)
                      StatusTag(
                        label: _commissionWarningLabel(warning),
                        tone: StatusTone.warning,
                      ),
                  ],
                ),
              ],
              const Divider(height: 24),
              Text(
                '计算说明',
                style: Theme.of(context)
                    .textTheme
                    .titleSmall
                    ?.copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              SelectableText(
                _fieldValue(
                  record.calculationNote ?? record.calculationNoteSummary,
                ),
              ),
              if (record.ruleSnapshot != null ||
                  record.sourceSnapshot != null) ...[
                const SizedBox(height: 12),
                ExpansionTile(
                  tilePadding: EdgeInsets.zero,
                  title: const Text('规则和来源快照摘要'),
                  children: [
                    SelectableText(
                      _snapshotText({
                        if (record.ruleSnapshot != null)
                          'ruleSnapshot': record.ruleSnapshot,
                        if (record.sourceSnapshot != null)
                          'sourceSnapshot': record.sourceSnapshot,
                      }),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('关闭'),
        ),
      ],
    );
  }
}

class _TravelGroupFinanceSummaryEditorDialog extends StatefulWidget {
  const _TravelGroupFinanceSummaryEditorDialog({
    required this.businessApi,
    required this.summary,
  });

  final BusinessApi businessApi;
  final TravelGroupFinanceSummaryRecord summary;

  @override
  State<_TravelGroupFinanceSummaryEditorDialog> createState() =>
      _TravelGroupFinanceSummaryEditorDialogState();
}

class _TravelGroupFinanceSummaryEditorDialogState
    extends State<_TravelGroupFinanceSummaryEditorDialog> {
  late final TextEditingController _notesController;
  late bool _guideInfoSent;
  late bool _travelAgencyInfoSent;
  bool _saving = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _notesController = TextEditingController(text: widget.summary.notes ?? '');
    _guideInfoSent = widget.summary.guideInfoSent;
    _travelAgencyInfoSent = widget.summary.travelAgencyInfoSent;
  }

  @override
  void dispose() {
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _errorMessage = null;
    });

    try {
      await widget.businessApi.updateTravelGroupFinanceSummary(
        widget.summary.travelGroupId,
        {
          'notes': _notesController.text.trim(),
          'guideInfoSent': _guideInfoSent,
          'travelAgencyInfoSent': _travelAgencyInfoSent,
        },
      );
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(true);
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
      title: Text('维护返积分备注 · ${_summaryTravelGroupNo(widget.summary)}'),
      content: SingleChildScrollView(
        child: SizedBox(
          width: 460,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                '${_summaryAgencyName(widget.summary)} · ${_summaryGuideName(widget.summary)}',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              const SizedBox(height: 12),
              if (_errorMessage != null) ...[
                _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
                const SizedBox(height: 12),
              ],
              CheckboxListTile(
                key: const ValueKey('finance-summary-guide-info-sent-checkbox'),
                contentPadding: EdgeInsets.zero,
                value: _guideInfoSent,
                onChanged: _saving
                    ? null
                    : (value) {
                        if (value != null) {
                          setState(() => _guideInfoSent = value);
                        }
                      },
                title: const Text('导游信息已发送'),
                controlAffinity: ListTileControlAffinity.leading,
              ),
              CheckboxListTile(
                key: const ValueKey(
                  'finance-summary-agency-info-sent-checkbox',
                ),
                contentPadding: EdgeInsets.zero,
                value: _travelAgencyInfoSent,
                onChanged: _saving
                    ? null
                    : (value) {
                        if (value != null) {
                          setState(() => _travelAgencyInfoSent = value);
                        }
                      },
                title: const Text('旅行社信息已发送'),
                controlAffinity: ListTileControlAffinity.leading,
              ),
              TextField(
                key: const ValueKey('finance-summary-notes-field'),
                controller: _notesController,
                maxLines: 3,
                decoration: const InputDecoration(labelText: '备注'),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(false),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          key: const ValueKey('finance-summary-save-button'),
          onPressed: _saving ? null : _save,
          icon: _saving
              ? const SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.save_rounded),
          label: const Text('保存汇总'),
        ),
      ],
    );
  }
}

class _TravelGroupFinanceSummaryDetailDialog extends StatelessWidget {
  const _TravelGroupFinanceSummaryDetailDialog({required this.summary});

  final TravelGroupFinanceSummaryRecord summary;

  @override
  Widget build(BuildContext context) {
    final orders = _summarySnapshotList(
      summary.sourceSnapshot,
      const ['orders', 'salesOrders', 'orderSummaries'],
    );
    final commissionRecords = _summarySnapshotList(
      summary.sourceSnapshot,
      const ['commissionRecords', 'records', 'rebates', 'rebateRecords'],
    );

    return AlertDialog(
      title: Text('返积分汇总 · ${_summaryTravelGroupNo(summary)}'),
      content: SingleChildScrollView(
        child: SizedBox(
          width: 720,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (!summary.summaryExists) ...[
                const _InlineNotice(
                  message: '该旅行团暂无出单，尚未生成返积分汇总；可返回列表执行重新计算。',
                  tone: StatusTone.neutral,
                ),
                const SizedBox(height: 12),
              ],
              _DetailLine(label: '旅行团', value: _summaryTravelGroupNo(summary)),
              _DetailLine(
                label: '日期',
                value: _fieldValue(summary.travelGroup?.visitDate),
              ),
              _DetailLine(label: '旅行社', value: _summaryAgencyName(summary)),
              _DetailLine(label: '导游', value: _summaryGuideName(summary)),
              _DetailLine(
                label: '车牌',
                value: _fieldValue(summary.travelGroup?.licensePlate),
              ),
              _DetailLine(
                label: '人数',
                value: '${summary.travelGroup?.guestCount ?? 0}',
              ),
              _DetailLine(
                label: '品鉴师',
                value: _fieldValue(summary.travelGroup?.tasterName),
              ),
              const Divider(height: 24),
              Wrap(
                spacing: 18,
                runSpacing: 8,
                children: [
                  _SummaryAmountText(
                    label: '销售额',
                    cents: summary.totalSalesAmountCents,
                  ),
                  _SummaryAmountText(
                    label: '货到付款',
                    cents: summary.totalCashOnDeliveryCents,
                  ),
                  _SummaryAmountText(
                    label: '已付定金',
                    cents: summary.totalPaidDepositCents,
                  ),
                  _SummaryAmountText(
                    label: '扣酒成本',
                    cents: summary.totalAgencyDeductionCents,
                  ),
                  _SummaryAmountText(
                    label: '上单金额',
                    cents: summary.totalAgencyNetAmountCents,
                  ),
                  _SummaryAmountText(
                    label: '积分/日返积分',
                    cents: summary.totalDailyRebateCents,
                  ),
                  _SummaryAmountText(
                    label: '未返积分',
                    cents: _dailyUnpaidRebateCents(summary),
                  ),
                  _SummaryAmountText(
                    label: '月返积分',
                    cents: summary.totalMonthlyRebateCents,
                  ),
                  _SummaryAmountText(
                    label: '未返月返积分',
                    cents: _monthlyUnpaidRebateCents(summary),
                  ),
                ],
              ),
              const Divider(height: 24),
              _DetailLine(
                label: '已返积分',
                value: _rebatePaymentDetail(
                  paid: summary.dailyRebatePaid,
                  paidBy: summary.dailyRebatePaidBy,
                  paidAt: summary.dailyRebatePaidAt,
                ),
              ),
              _DetailLine(
                label: '已返月返积分',
                value: _rebatePaymentDetail(
                  paid: summary.monthlyRebatePaid,
                  paidBy: summary.monthlyRebatePaidBy,
                  paidAt: summary.monthlyRebatePaidAt,
                ),
              ),
              _DetailLine(
                label: '扣酒确认',
                value: summary.agencyDeductionConfirmed ? '已确认' : '待确认',
              ),
              if (summary.agencyDeductionConfirmedBy != null ||
                  summary.agencyDeductionConfirmedAt != null)
                _DetailLine(
                  label: '确认信息',
                  value:
                      '${_userName(summary.agencyDeductionConfirmedBy)} · ${_fieldValue(summary.agencyDeductionConfirmedAt)}',
                ),
              _DetailLine(
                  label: '导游发送', value: summary.guideInfoSent ? '已发送' : '未发送'),
              _DetailLine(
                label: '旅行社发送',
                value: summary.travelAgencyInfoSent ? '已发送' : '未发送',
              ),
              _DetailLine(label: '备注', value: _fieldValue(summary.notes)),
              const Divider(height: 24),
              _SnapshotListSection(
                title: '订单摘要',
                emptyMessage: '快照中暂无订单摘要',
                records: orders,
                icon: Icons.receipt_long_rounded,
              ),
              const SizedBox(height: 12),
              _SnapshotListSection(
                title: '提成积分明细摘要',
                emptyMessage: '快照中暂无提成积分明细摘要',
                records: commissionRecords,
                icon: Icons.account_balance_wallet_rounded,
              ),
              if (summary.sourceSnapshot != null) ...[
                const SizedBox(height: 12),
                ExpansionTile(
                  tilePadding: EdgeInsets.zero,
                  title: const Text('来源快照摘要'),
                  children: [
                    SelectableText(
                      _snapshotText({'sourceSnapshot': summary.sourceSnapshot}),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('关闭'),
        ),
      ],
    );
  }
}

class _SummaryAmountText extends StatelessWidget {
  const _SummaryAmountText({
    required this.label,
    required this.cents,
  });

  final String label;
  final int cents;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 128,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 2),
          Text(
            formatMoneyCents(cents),
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

class _SnapshotListSection extends StatelessWidget {
  const _SnapshotListSection({
    required this.title,
    required this.emptyMessage,
    required this.records,
    required this.icon,
  });

  final String title;
  final String emptyMessage;
  final List<Map<String, dynamic>> records;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          title,
          style: Theme.of(context)
              .textTheme
              .titleSmall
              ?.copyWith(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 6),
        if (records.isEmpty)
          Text(emptyMessage)
        else
          for (final record in records.take(8))
            ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              leading: Icon(icon),
              title: Text(_summarySnapshotTitle(record)),
              subtitle: Text(_summarySnapshotSubtitle(record)),
            ),
      ],
    );
  }
}

class _DetailLine extends StatelessWidget {
  const _DetailLine({
    required this.label,
    required this.value,
  });

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 96,
            child: Text(
              label,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
          ),
          Expanded(child: SelectableText(value)),
        ],
      ),
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

const _commissionFilter = '提成明细';
const _summaryFilter = '返积分汇总';
const _commissionTargetTypeAll = 'all';
const _commissionConfirmAll = 'all';
const _commissionConfirmConfirmed = 'confirmed';
const _commissionConfirmPending = 'pending';
const _summaryConfirmAll = 'all';
const _summaryConfirmConfirmed = 'confirmed';
const _summaryConfirmPending = 'pending';

const _financeFilters = [
  '订单金额',
  '退款退单',
  '物流费用',
  '标记信息',
  '开票待办',
  '售后确认',
  _commissionFilter,
  _summaryFilter,
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
    case _commissionFilter:
      return '提成积分明细';
    case _summaryFilter:
      return '旅行团返积分汇总';
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

String? _nullableText(String value) {
  final text = value.trim();
  return text.isEmpty ? null : text;
}

String _safeExportFileName(String? value, String fallbackPrefix) {
  final fallback = '$fallbackPrefix-${_exportTimestamp(DateTime.now())}.xlsx';
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
    '${directory.path}$separator$stem-'
    '${DateTime.now().microsecondsSinceEpoch}$extension',
  );
}

String _commissionOrderNo(CommissionRecord record) {
  return _fieldValue(record.salesOrderNo ?? record.salesOrder?.orderNo);
}

String _commissionTravelGroupNo(CommissionRecord record) {
  return _fieldValue(record.travelGroup?.groupNo ?? record.travelGroupId);
}

String _commissionCustomerName(CommissionRecord record) {
  return _fieldValue(record.customer?.name ?? record.salesOrder?.customerName);
}

String _commissionTargetName(CommissionRecord record) {
  return _fieldValue(
    record.targetUser?.name ??
        record.targetUser?.username ??
        record.travelGroup?.tasterName ??
        record.targetUserId,
  );
}

String _commissionAgencyName(CommissionRecord record) {
  return _fieldValue(
    record.agency?.name ??
        record.agencyName ??
        record.travelGroup?.travelAgency,
  );
}

String _summaryTravelGroupNo(TravelGroupFinanceSummaryRecord summary) {
  return _fieldValue(summary.travelGroup?.groupNo ?? summary.travelGroupId);
}

String _summaryAgencyName(TravelGroupFinanceSummaryRecord summary) {
  return _fieldValue(summary.travelGroup?.travelAgency);
}

String _summaryGuideName(TravelGroupFinanceSummaryRecord summary) {
  return _fieldValue(summary.travelGroup?.guideName);
}

int _dailyUnpaidRebateCents(TravelGroupFinanceSummaryRecord summary) {
  return summary.dailyRebatePaid ? 0 : summary.totalDailyRebateCents;
}

int _monthlyUnpaidRebateCents(TravelGroupFinanceSummaryRecord summary) {
  return summary.monthlyRebatePaid ? 0 : summary.totalMonthlyRebateCents;
}

String _rebatePaymentDetail({
  required bool paid,
  required Stage7UserSummaryRecord? paidBy,
  required String? paidAt,
}) {
  if (!paid) {
    return '未返';
  }
  final operator = _userName(paidBy);
  final time = _fieldValue(paidAt);
  if (operator == '-' && time == '-') {
    return '已返';
  }
  return '已返 · $operator · $time';
}

String _userName(Stage7UserSummaryRecord? user) {
  return _fieldValue(user?.name ?? user?.username ?? user?.id);
}

String _commissionTargetTypeLabel(String targetType) {
  switch (targetType) {
    case 'sales_commission':
      return '销售提成';
    case 'outreach_commission':
      return '外联提成';
    case 'leader_commission':
      return '组长提成';
    case 'taster_commission':
      return '品鉴师提成';
    case 'agency_daily_rebate':
      return '旅行社日返';
    case 'agency_monthly_rebate':
      return '旅行社月返';
    default:
      return targetType;
  }
}

List<String> _commissionWarnings(CommissionRecord record) {
  final warnings = <String>{};
  final snapshot = record.sourceSnapshot;

  void addValue(Object? value) {
    if (value == null) {
      return;
    }
    if (value is String) {
      final normalized = value.trim();
      if (normalized.isNotEmpty) {
        warnings.add(normalized);
      }
      return;
    }
    if (value is Iterable) {
      for (final item in value) {
        addValue(item);
      }
      return;
    }
    if (value is Map) {
      addValue(value['code']);
      addValue(value['warning']);
      addValue(value['type']);
    }
  }

  if (snapshot != null) {
    addValue(snapshot['warnings']);
    addValue(snapshot['warningCodes']);
    addValue(snapshot['warningSummary']);

    final unconfirmedRefunds =
        snapshot['unconfirmedRefundSummary'] ?? snapshot['unconfirmedRefunds'];
    if (unconfirmedRefunds is Iterable && unconfirmedRefunds.isNotEmpty) {
      warnings.add('unconfirmed_refund');
    }
    if (unconfirmedRefunds is Map) {
      final count = _numberValue(unconfirmedRefunds['count']);
      final amount = _numberValue(unconfirmedRefunds['amountCents']);
      if (count > 0 || amount > 0) {
        warnings.add('unconfirmed_refund');
      }
    }
  }

  return warnings.toList();
}

num _numberValue(Object? value) {
  if (value is num) {
    return value;
  }
  return num.tryParse('${value ?? ''}') ?? 0;
}

String _commissionWarningLabel(String warning) {
  switch (warning) {
    case 'missing_sales_deduction_rule':
      return '缺销售扣单规则';
    case 'missing_agency_deduction_rule':
      return '缺旅行社扣酒规则';
    case 'missing_agency_rebate_rule':
      return '缺旅行社返点规则';
    case 'missing_outreach':
    case 'missing_outreach_user':
      return '缺外联';
    case 'missing_leader':
    case 'missing_leader_user':
      return '缺组长';
    case 'unconfirmed_refund':
    case 'pending_unconfirmed_refund':
    case 'has_unconfirmed_refund':
      return '有未确认退款';
    case 'taster_manual_adjustment_pending':
      return '品鉴师待调整';
    default:
      return warning;
  }
}

List<Map<String, dynamic>> _summarySnapshotList(
  Map<String, dynamic>? snapshot,
  List<String> candidateKeys,
) {
  if (snapshot == null) {
    return const <Map<String, dynamic>>[];
  }

  for (final key in candidateKeys) {
    final records = <Map<String, dynamic>>[];
    _collectSummarySnapshotRecords(snapshot[key], records);
    if (records.isNotEmpty) {
      return records;
    }
  }

  for (final nestedKey in const ['summary', 'source', 'sourceSnapshot']) {
    final nested = snapshot[nestedKey];
    if (nested is Map) {
      for (final key in candidateKeys) {
        final records = <Map<String, dynamic>>[];
        _collectSummarySnapshotRecords(nested[key], records);
        if (records.isNotEmpty) {
          return records;
        }
      }
    }
  }

  return const <Map<String, dynamic>>[];
}

void _collectSummarySnapshotRecords(
  Object? value,
  List<Map<String, dynamic>> records,
) {
  if (value == null) {
    return;
  }
  if (value is Iterable) {
    for (final item in value) {
      _collectSummarySnapshotRecords(item, records);
    }
    return;
  }
  if (value is Map) {
    final normalized = Map<String, dynamic>.fromEntries(
      value.entries.map((entry) => MapEntry('${entry.key}', entry.value)),
    );
    final looksLikeRecord = normalized.keys.any(
      (key) =>
          key.endsWith('Id') ||
          key.endsWith('No') ||
          key == 'id' ||
          key == 'targetType' ||
          key == 'amountCents' ||
          key == 'pointsCents',
    );
    if (looksLikeRecord || normalized.isEmpty) {
      records.add(normalized);
      return;
    }
    for (final child in normalized.values) {
      _collectSummarySnapshotRecords(child, records);
    }
  }
}

String _summarySnapshotTitle(Map<String, dynamic> record) {
  return _fieldValue(
    _firstSnapshotText(record, const [
      'orderNo',
      'salesOrderNo',
      'afterSalesNo',
      'recordNo',
      'groupNo',
      'travelGroupNo',
      'targetType',
      'type',
      'id',
    ]),
  );
}

String _summarySnapshotSubtitle(Map<String, dynamic> record) {
  final parts = <String>[];

  void addText(String label, List<String> keys) {
    final value = _firstSnapshotText(record, keys);
    if (value != null && value.trim().isNotEmpty) {
      parts.add('$label $value');
    }
  }

  void addMoney(String label, List<String> keys) {
    final value = _firstSnapshotValue(record, keys);
    if (value != null) {
      parts.add('$label ${formatMoneyCents(_numberValue(value).round())}');
    }
  }

  addText('客户', const ['customerName', 'customer']);
  addText(
      '人员', const ['targetUserName', 'targetName', 'userName', 'personName']);
  addText('旅行社', const ['agencyName', 'travelAgency']);
  addText('类型', const ['targetType', 'recordType', 'type']);
  addMoney('原始', const ['totalAmountCents', 'grossAmountCents']);
  addMoney('有效', const ['effectiveSalesAmountCents', 'baseAmountCents']);
  addMoney('提成', const ['amountCents']);
  addMoney('积分', const ['pointsCents']);
  addText('说明', const ['calculationNoteSummary', 'calculationNote', 'note']);

  if (parts.isNotEmpty) {
    return parts.join(' · ');
  }
  return _snapshotText(record);
}

String? _firstSnapshotText(
  Map<String, dynamic> record,
  List<String> keys,
) {
  final value = _firstSnapshotValue(record, keys);
  if (value == null) {
    return null;
  }
  if (value is Map) {
    return _firstSnapshotText(
      Map<String, dynamic>.fromEntries(
        value.entries.map((entry) => MapEntry('${entry.key}', entry.value)),
      ),
      const ['name', 'username', 'orderNo', 'groupNo', 'id'],
    );
  }
  return '$value';
}

Object? _firstSnapshotValue(
  Map<String, dynamic> record,
  List<String> keys,
) {
  for (final key in keys) {
    if (record.containsKey(key) && record[key] != null) {
      return record[key];
    }
  }
  return null;
}

String _snapshotText(Map<String, dynamic> snapshot) {
  return const JsonEncoder.withIndent('  ')
      .convert(_sanitizeSnapshot(snapshot));
}

Object? _sanitizeSnapshot(Object? value) {
  if (value is Map) {
    return value.map((key, child) {
      final keyText = '$key';
      if (_isSensitiveSnapshotKey(keyText)) {
        return MapEntry(keyText, '<redacted>');
      }
      return MapEntry(keyText, _sanitizeSnapshot(child));
    });
  }
  if (value is Iterable) {
    return value.map(_sanitizeSnapshot).toList();
  }
  return value;
}

bool _isSensitiveSnapshotKey(String key) {
  final normalized = key.toLowerCase();
  return normalized.contains('password') ||
      normalized.contains('token') ||
      normalized.contains('authorization') ||
      normalized.contains('databaseurl') ||
      normalized.contains('database_url') ||
      normalized.contains('connectionstring') ||
      normalized.contains('connection_string');
}

String _moneyInputText(int cents) {
  if (cents == 0) {
    return '0';
  }
  final negative = cents < 0;
  final absoluteCents = cents.abs();
  final yuan = absoluteCents ~/ 100;
  final fen = cents.abs() % 100;
  if (fen == 0) {
    return '${negative ? '-' : ''}$yuan';
  }
  final fraction =
      fen % 10 == 0 ? '${fen ~/ 10}' : fen.toString().padLeft(2, '0');
  return '${negative ? '-' : ''}$yuan.$fraction';
}

int? _moneyCentsOrNull(String value) {
  final normalized = value.trim();
  if (normalized.isEmpty) {
    return 0;
  }
  if (!RegExp(r'^\d+(?:\.\d{1,2})?$').hasMatch(normalized)) {
    return null;
  }
  final parts = normalized.split('.');
  final yuan = int.tryParse(parts[0]);
  if (yuan == null) {
    return null;
  }
  final fractionText = parts.length == 1 ? '00' : parts[1].padRight(2, '0');
  final fen = int.tryParse(fractionText);
  if (fen == null || yuan > 21474836) {
    return null;
  }
  final cents = yuan * 100 + fen;
  return cents <= 2147483647 ? cents : null;
}

class _MoneyTextInputFormatter extends TextInputFormatter {
  const _MoneyTextInputFormatter();

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final text = newValue.text;
    if (text.isEmpty || RegExp(r'^\d*(?:\.\d{0,2})?$').hasMatch(text)) {
      return newValue;
    }
    return oldValue;
  }
}
