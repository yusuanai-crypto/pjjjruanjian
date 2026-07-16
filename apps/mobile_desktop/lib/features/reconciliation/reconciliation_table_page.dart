import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/money_text.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/status_tag.dart';

class ReconciliationTablePage extends StatefulWidget {
  const ReconciliationTablePage({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;

  @override
  State<ReconciliationTablePage> createState() =>
      _ReconciliationTablePageState();
}

class _ReconciliationTablePageState extends State<ReconciliationTablePage> {
  late BusinessApi _businessApi;
  late DateTime _start;
  late DateTime _end;
  late DateTime _selectedDate;
  late final TextEditingController _searchController;
  late final TextEditingController _backOfficeSalesController;
  late final TextEditingController _notesController;

  List<ReconciliationRecord> _records = const [];
  ReconciliationRecord? _dailyReconciliation;
  List<_PaymentMethodInput> _paymentMethods = <_PaymentMethodInput>[];
  String _statusFilter = '全部';
  String _searchQuery = '';
  bool _loadingRange = true;
  bool _loadingDaily = false;
  bool _savingDaily = false;
  bool _reviewingDaily = false;
  String? _rangeError;
  String? _dailyError;
  String? _successMessage;
  int _rangeRequestId = 0;
  int _dailyRequestId = 0;

  bool get _canEditManual => widget.role == UserRole.finance;
  bool get _canReview =>
      widget.role == UserRole.superAdmin || widget.role == UserRole.admin;

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    final now = DateTime.now();
    _start = DateTime(now.year, now.month, 1);
    _end = DateTime(now.year, now.month, now.day);
    _selectedDate = _end;
    _searchController = TextEditingController();
    _backOfficeSalesController = TextEditingController(text: '0.00');
    _notesController = TextEditingController();
    _replacePaymentMethods(const []);
    _loadRange();
  }

  @override
  void didUpdateWidget(covariant ReconciliationTablePage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token ||
        oldWidget.role != widget.role) {
      _businessApi =
          BusinessApi(apiClient: widget.apiClient, token: widget.token);
      _loadRange();
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    _backOfficeSalesController.dispose();
    _notesController.dispose();
    for (final method in _paymentMethods) {
      method.dispose();
    }
    super.dispose();
  }

  Future<void> _loadRange() async {
    final requestId = ++_rangeRequestId;
    ++_dailyRequestId;
    _setDailyInputs(null);
    setState(() {
      _loadingRange = true;
      _loadingDaily = false;
      _records = const [];
      _dailyReconciliation = null;
      _rangeError = null;
      _dailyError = null;
      _successMessage = null;
    });

    try {
      final records = await _businessApi.listReconciliations(
        dateFrom: _start,
        dateTo: _end,
      );
      if (!mounted || requestId != _rangeRequestId) return;
      records.sort(
          (left, right) => right.businessDate.compareTo(left.businessDate));
      final selected = _recordForDate(records, _selectedDate) ??
          _recordForDate(records, _end) ??
          (records.isEmpty ? null : records.first);
      if (selected != null) {
        _selectedDate = DateTime.parse(selected.businessDate);
      }
      _setDailyInputs(selected);
      setState(() {
        _records = records;
        _dailyReconciliation = selected;
        _loadingRange = false;
      });
    } catch (error) {
      if (!mounted || requestId != _rangeRequestId) return;
      _setDailyInputs(null);
      setState(() {
        _records = const [];
        _dailyReconciliation = null;
        _loadingRange = false;
        _rangeError = _messageForError(error);
      });
    }
  }

  Future<void> _selectBusinessDate(ReconciliationRecord record) async {
    final selectedDate = DateTime.parse(record.businessDate);
    _selectedDate = selectedDate;
    await _loadDaily(selectedDate);
  }

  Future<void> _loadDaily(DateTime businessDate) async {
    final requestId = ++_dailyRequestId;
    _selectedDate = businessDate;
    _setDailyInputs(null);
    setState(() {
      _loadingDaily = true;
      _dailyReconciliation = null;
      _dailyError = null;
      _successMessage = null;
    });

    try {
      final reconciliation = await _businessApi.getReconciliation(businessDate);
      if (!mounted ||
          requestId != _dailyRequestId ||
          formatDate(_selectedDate) != reconciliation.businessDate) {
        return;
      }
      _setDailyInputs(reconciliation);
      setState(() {
        _dailyReconciliation = reconciliation;
        _loadingDaily = false;
        _replaceRecord(reconciliation);
      });
    } catch (error) {
      if (!mounted || requestId != _dailyRequestId) return;
      _setDailyInputs(null);
      setState(() {
        _dailyReconciliation = null;
        _loadingDaily = false;
        _dailyError = _messageForError(error);
      });
    }
  }

  Future<void> _saveDailyReconciliation() async {
    if (!_canEditManual) return;
    setState(() {
      _savingDaily = true;
      _dailyError = null;
      _successMessage = null;
    });

    try {
      final saved = await _businessApi.saveReconciliation(_selectedDate, {
        'backOfficeSalesCents': _nonNegativeCentsFromText(
          _backOfficeSalesController.text,
          '后场销售额',
        ),
        'notes': _notesController.text.trim(),
        'paymentMethods': [
          for (var index = 0; index < _paymentMethods.length; index++)
            {
              'name': _requiredPaymentMethodName(
                _paymentMethods[index].nameController.text,
              ),
              'amountCents': _nonNegativeCentsFromText(
                _paymentMethods[index].amountController.text,
                '实收金额',
              ),
              'sortOrder': index + 1,
            },
        ],
      });
      if (!mounted) return;
      _setDailyInputs(saved);
      setState(() {
        _dailyReconciliation = saved;
        _replaceRecord(saved);
        _savingDaily = false;
        _successMessage = '人工对账数据已保存，复核状态已更新为待复核。';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _savingDaily = false;
        _dailyError = _messageForError(error);
      });
    }
  }

  Future<void> _reviewDailyReconciliation() async {
    if (!_canReview) return;
    setState(() {
      _reviewingDaily = true;
      _dailyError = null;
      _successMessage = null;
    });

    try {
      final reviewed = await _businessApi.reviewReconciliation(_selectedDate);
      if (!mounted) return;
      _setDailyInputs(reviewed);
      setState(() {
        _dailyReconciliation = reviewed;
        _replaceRecord(reviewed);
        _reviewingDaily = false;
        _successMessage =
            reviewed.differenceCents == 0 ? '复核完成，该日已平账。' : '复核完成，该日仍有差异。';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _reviewingDaily = false;
        _dailyError = _messageForError(error);
      });
    }
  }

  void _replaceRecord(ReconciliationRecord record) {
    final updated = [..._records];
    final index = updated.indexWhere(
      (item) => item.businessDate == record.businessDate,
    );
    if (index >= 0) {
      updated[index] = record;
    } else {
      updated.add(record);
      updated.sort(
        (left, right) => right.businessDate.compareTo(left.businessDate),
      );
    }
    _records = updated;
  }

  void _setDailyInputs(ReconciliationRecord? record) {
    _backOfficeSalesController.text =
        _yuanInputText(record?.backOfficeSalesCents ?? 0);
    _notesController.text = record?.notes ?? '';
    _replacePaymentMethods(record?.paymentMethods ?? const []);
  }

  void _replacePaymentMethods(List<PaymentMethodRecord> methods) {
    for (final method in _paymentMethods) {
      method.dispose();
    }
    _paymentMethods = methods.isEmpty
        ? [
            _PaymentMethodInput(name: '现金', amountText: '0.00'),
            _PaymentMethodInput(name: '微信', amountText: '0.00'),
          ]
        : [
            for (final method in methods)
              _PaymentMethodInput(
                name: method.name,
                amountText: _yuanInputText(method.amountCents),
              ),
          ];
  }

  void _addPaymentMethod() {
    if (!_canEditManual) return;
    setState(() {
      _paymentMethods.add(
        _PaymentMethodInput(name: '', amountText: '0.00'),
      );
    });
  }

  void _removePaymentMethod(int index) {
    if (!_canEditManual) return;
    setState(() {
      final removed = _paymentMethods.removeAt(index);
      removed.dispose();
    });
  }

  int get _receivableTotalCents {
    final record = _dailyReconciliation;
    if (record == null) return 0;
    return record.travelGroupSalesCents +
        _centsFromText(_backOfficeSalesController.text) +
        record.buybackCents +
        record.externalSalesCents +
        record.internalPurchaseCents +
        record.afterSalesCents -
        record.refundsCents;
  }

  int get _actualTotalCents {
    return _paymentMethods.fold<int>(
      0,
      (sum, method) => sum + _centsFromText(method.amountController.text),
    );
  }

  int get _differenceCents => _actualTotalCents - _receivableTotalCents;

  List<ReconciliationRecord> get _filteredRecords {
    final query = _searchQuery.trim().toLowerCase();
    return _records.where((record) {
      if (_statusFilter != '全部' &&
          _statusLabel(record.status) != _statusFilter) {
        return false;
      }
      if (query.isEmpty) return true;
      return record.businessDate.toLowerCase().contains(query) ||
          (record.notes ?? '').toLowerCase().contains(query) ||
          (record.reviewedByName ?? '').toLowerCase().contains(query);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final records = _filteredRecords;
    return ResponsivePage(
      children: [
        if (_rangeError != null)
          _RetryNotice(message: _rangeError!, onRetry: _loadRange),
        if (_dailyError != null)
          _RetryNotice(
            message: _dailyError!,
            onRetry: () => _loadDaily(_selectedDate),
          ),
        if (_successMessage != null)
          _InlineNotice(
            message: _successMessage!,
            tone: StatusTone.success,
          ),
        FormSection(
          title: '对账范围',
          trailing: StatusTag(
            label: _loadingRange ? '加载中' : '${records.length} 天记录',
            tone: _loadingRange ? StatusTone.warning : StatusTone.info,
          ),
          children: [
            ResponsiveFormGrid(
              children: [
                AppDateRangeButton(
                  start: _start,
                  end: _end,
                  onChanged: (range) {
                    _start = range.start;
                    _end = range.end;
                    if (_selectedDate.isBefore(_start) ||
                        _selectedDate.isAfter(_end)) {
                      _selectedDate = _end;
                    }
                    _loadRange();
                  },
                ),
                AppSearchField(
                  controller: _searchController,
                  hintText: '搜索日期、备注、复核人',
                  onChanged: (value) => setState(() => _searchQuery = value),
                ),
              ],
            ),
          ],
        ),
        MetricGrid(
          metrics: [
            MetricData(
              label: '应收合计',
              value: formatMoneyCents(records.fold<int>(
                0,
                (sum, item) => sum + item.receivableTotalCents,
              )),
              icon: Icons.account_balance_wallet_rounded,
            ),
            MetricData(
              label: '实收合计',
              value: formatMoneyCents(records.fold<int>(
                0,
                (sum, item) => sum + item.actualTotalCents,
              )),
              icon: Icons.payments_rounded,
            ),
            MetricData(
              label: '差异金额',
              value: formatMoneyCents(records.fold<int>(
                0,
                (sum, item) => sum + item.differenceCents,
              )),
              icon: Icons.balance_rounded,
            ),
            MetricData(
              label: '待复核',
              value:
                  '${records.where((item) => item.status == 'pending_review').length}',
              icon: Icons.rule_rounded,
            ),
          ],
        ),
        ResponsiveTwoColumn(
          primary: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AppFilterBar(
                filters: const ['全部', '已平账', '待复核', '有差异'],
                selected: _statusFilter,
                onSelected: (value) => setState(() => _statusFilter = value),
              ),
              const SizedBox(height: 12),
              Card(
                child: _loadingRange
                    ? const Padding(
                        padding: EdgeInsets.all(32),
                        child: Center(child: CircularProgressIndicator()),
                      )
                    : SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: DataTable(
                          columns: const [
                            DataColumn(label: Text('日期')),
                            DataColumn(label: Text('旅行团销售')),
                            DataColumn(label: Text('后场销售')),
                            DataColumn(label: Text('退款扣减')),
                            DataColumn(label: Text('实收')),
                            DataColumn(label: Text('差异')),
                            DataColumn(label: Text('状态')),
                          ],
                          rows: [
                            for (final record in records)
                              DataRow(
                                selected: record.businessDate ==
                                    formatDate(_selectedDate),
                                onSelectChanged: (_) =>
                                    _selectBusinessDate(record),
                                cells: [
                                  DataCell(Text(record.businessDate)),
                                  DataCell(MoneyText(
                                    cents: record.travelGroupSalesCents,
                                  )),
                                  DataCell(MoneyText(
                                    cents: record.backOfficeSalesCents,
                                  )),
                                  DataCell(MoneyText(
                                    cents: record.refundsCents,
                                  )),
                                  DataCell(MoneyText(
                                    cents: record.actualTotalCents,
                                  )),
                                  DataCell(MoneyText(
                                    cents: record.differenceCents,
                                  )),
                                  DataCell(StatusTag(
                                    label: _statusLabel(record.status),
                                    tone: _statusTone(record.status),
                                  )),
                                ],
                              ),
                          ],
                        ),
                      ),
              ),
            ],
          ),
          secondary: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _buildDailyStatistics(),
              const SizedBox(height: 16),
              _buildDailySummary(),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildDailyStatistics() {
    final record = _dailyReconciliation;
    final busy = _loadingDaily || _savingDaily || _reviewingDaily;
    return FormSection(
      title: '每日对账统计',
      trailing: StatusTag(
        label: _loadingDaily ? '加载中' : formatDate(_selectedDate),
        tone: _loadingDaily ? StatusTone.warning : StatusTone.info,
      ),
      children: [
        if (_loadingDaily)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 28),
            child: Center(child: CircularProgressIndicator()),
          )
        else ...[
          ResponsiveFormGrid(
            children: [
              _ReadOnlyMoneyField(
                label: '旅行团销售额',
                cents: record?.travelGroupSalesCents ?? 0,
              ),
              _MoneyField(
                key: const ValueKey('reconciliation-back-office-input'),
                label: '后场销售额（财务录入）',
                controller: _backOfficeSalesController,
                enabled: _canEditManual && !busy,
                onChanged: () => setState(() {}),
              ),
              _ReadOnlyMoneyField(
                label: '回购',
                cents: record?.buybackCents ?? 0,
              ),
              _ReadOnlyMoneyField(
                label: '外销',
                cents: record?.externalSalesCents ?? 0,
              ),
              _ReadOnlyMoneyField(
                label: '内购',
                cents: record?.internalPurchaseCents ?? 0,
              ),
              _ReadOnlyMoneyField(
                label: '售后',
                cents: record?.afterSalesCents ?? 0,
              ),
              _ReadOnlyMoneyField(
                label: '退款金额（正数扣减）',
                cents: record?.refundsCents ?? 0,
                helperText: '按退款单创建日统计，仅包含财务已确认退款',
              ),
            ],
          ),
          const Divider(height: 24),
          Row(
            children: [
              Expanded(
                child: Text(
                  '实收收款方式（财务录入）',
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
              if (_canEditManual)
                IconButton(
                  tooltip: '新增收款方式',
                  onPressed: busy ? null : _addPaymentMethod,
                  icon: const Icon(Icons.add_rounded),
                ),
            ],
          ),
          const SizedBox(height: 8),
          for (var index = 0; index < _paymentMethods.length; index++)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _paymentMethods[index].nameController,
                      enabled: _canEditManual && !busy,
                      decoration: const InputDecoration(labelText: '收款方式'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  SizedBox(
                    width: 140,
                    child: TextField(
                      key: ValueKey('reconciliation-payment-amount-$index'),
                      controller: _paymentMethods[index].amountController,
                      enabled: _canEditManual && !busy,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      inputFormatters: [_MoneyInputFormatter()],
                      decoration: const InputDecoration(
                        labelText: '实收金额',
                        prefixText: '¥ ',
                      ),
                      onChanged: (_) => setState(() {}),
                    ),
                  ),
                  if (_canEditManual)
                    IconButton(
                      tooltip: '删除',
                      onPressed: busy || _paymentMethods.length <= 1
                          ? null
                          : () => _removePaymentMethod(index),
                      icon: const Icon(Icons.delete_outline_rounded),
                    ),
                ],
              ),
            ),
          TextField(
            controller: _notesController,
            enabled: _canEditManual && !busy,
            maxLines: 2,
            decoration: const InputDecoration(labelText: '备注'),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              StatusTag(
                label: '应收 ${formatMoneyCents(_receivableTotalCents)}',
                tone: StatusTone.info,
              ),
              StatusTag(
                label: '实收 ${formatMoneyCents(_actualTotalCents)}',
                tone: StatusTone.success,
              ),
              StatusTag(
                label: '差额 ${formatMoneyCents(_differenceCents)}',
                tone: _differenceCents == 0
                    ? StatusTone.success
                    : StatusTone.warning,
              ),
            ],
          ),
          const SizedBox(height: 14),
          Wrap(
            alignment: WrapAlignment.end,
            spacing: 10,
            runSpacing: 10,
            children: [
              OutlinedButton.icon(
                onPressed: busy ? null : () => _loadDaily(_selectedDate),
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('重新加载'),
              ),
              if (_canEditManual)
                FilledButton.icon(
                  key: const ValueKey('reconciliation-save-manual'),
                  onPressed: busy ? null : _saveDailyReconciliation,
                  icon: const Icon(Icons.save_rounded),
                  label: Text(_savingDaily ? '保存中...' : '保存人工数据'),
                ),
              if (_canReview)
                FilledButton.icon(
                  key: const ValueKey('reconciliation-review'),
                  onPressed: busy || record?.id == null
                      ? null
                      : _reviewDailyReconciliation,
                  icon: const Icon(Icons.verified_rounded),
                  label: Text(_reviewingDaily ? '复核中...' : '确认复核'),
                ),
            ],
          ),
        ],
      ],
    );
  }

  Widget _buildDailySummary() {
    final record = _dailyReconciliation;
    return FormSection(
      title: '当日对账摘要',
      trailing: StatusTag(
        label: _statusLabel(record?.status ?? 'pending_review'),
        tone: _statusTone(record?.status ?? 'pending_review'),
      ),
      children: [
        _AmountLine(
          label: '应收合计',
          cents: record?.receivableTotalCents ?? 0,
          prominent: true,
        ),
        _AmountLine(
          label: '实收合计',
          cents: record?.actualTotalCents ?? 0,
        ),
        _AmountLine(
          label: '差异金额',
          cents: record?.differenceCents ?? 0,
        ),
        const Divider(height: 24),
        _InfoRow(
          label: '支付拆分',
          value: _paymentSummary(record?.paymentMethods ?? const []),
        ),
        _InfoRow(
          label: '复核人',
          value: record?.reviewedByName ?? '尚未复核',
        ),
        _InfoRow(
          label: '复核时间',
          value: record?.reviewedAt ?? '—',
        ),
        if (record?.reviewIsStale ?? false)
          const _InfoRow(
            label: '状态提示',
            value: '复核后统计来源发生变化，需重新复核',
          ),
        _InfoRow(label: '备注', value: record?.notes ?? '—'),
      ],
    );
  }
}

class _ReadOnlyMoneyField extends StatelessWidget {
  const _ReadOnlyMoneyField({
    required this.label,
    required this.cents,
    this.helperText,
  });

  final String label;
  final int cents;
  final String? helperText;

  @override
  Widget build(BuildContext context) {
    return InputDecorator(
      decoration: InputDecoration(
        labelText: label,
        helperText: helperText,
        filled: true,
        fillColor: Theme.of(context).colorScheme.surfaceContainerLowest,
      ),
      child: Text(
        formatMoneyCents(cents),
        key: ValueKey('readonly-money-$label'),
        style: const TextStyle(fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _MoneyField extends StatelessWidget {
  const _MoneyField({
    super.key,
    required this.label,
    required this.controller,
    required this.enabled,
    required this.onChanged,
  });

  final String label;
  final TextEditingController controller;
  final bool enabled;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      enabled: enabled,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      inputFormatters: [_MoneyInputFormatter()],
      decoration: InputDecoration(labelText: label, prefixText: '¥ '),
      onChanged: (_) => onChanged(),
    );
  }
}

class _MoneyInputFormatter extends TextInputFormatter {
  final RegExp _pattern = RegExp(r'^\d{0,10}(?:\.\d{0,2})?$');

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    return _pattern.hasMatch(newValue.text) ? newValue : oldValue;
  }
}

class _RetryNotice extends StatelessWidget {
  const _RetryNotice({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: Theme.of(context).colorScheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Row(
          children: [
            Expanded(child: Text(message)),
            TextButton(onPressed: onRetry, child: const Text('重新加载')),
          ],
        ),
      ),
    );
  }
}

class _InlineNotice extends StatelessWidget {
  const _InlineNotice({required this.message, required this.tone});

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

class _PaymentMethodInput {
  _PaymentMethodInput({required String name, required String amountText})
      : nameController = TextEditingController(text: name),
        amountController = TextEditingController(text: amountText);

  final TextEditingController nameController;
  final TextEditingController amountController;

  void dispose() {
    nameController.dispose();
    amountController.dispose();
  }
}

class _AmountLine extends StatelessWidget {
  const _AmountLine({
    required this.label,
    required this.cents,
    this.prominent = false,
  });

  final String label;
  final int cents;
  final bool prominent;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          Expanded(child: Text(label)),
          MoneyText(cents: cents, prominent: prominent),
        ],
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
            width: 76,
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

ReconciliationRecord? _recordForDate(
  List<ReconciliationRecord> records,
  DateTime date,
) {
  final value = formatDate(date);
  for (final record in records) {
    if (record.businessDate == value) return record;
  }
  return null;
}

String _statusLabel(String status) {
  switch (status) {
    case 'balanced':
      return '已平账';
    case 'difference':
      return '有差异';
    case 'pending_review':
    default:
      return '待复核';
  }
}

StatusTone _statusTone(String status) {
  switch (status) {
    case 'balanced':
      return StatusTone.success;
    case 'difference':
      return StatusTone.danger;
    case 'pending_review':
    default:
      return StatusTone.warning;
  }
}

String _paymentSummary(List<PaymentMethodRecord> methods) {
  if (methods.isEmpty) return '暂无';
  return methods
      .map((method) => '${method.name} ${formatMoneyCents(method.amountCents)}')
      .join('；');
}

int _centsFromText(String value) {
  final normalized = value.replaceAll(',', '').replaceAll('¥', '').trim();
  if (normalized.isEmpty) return 0;
  final match = RegExp(r'^(\d+)(?:\.(\d{0,2}))?$').firstMatch(normalized);
  if (match == null) {
    throw const FormatException('金额格式不正确。');
  }
  final yuan = int.parse(match.group(1)!);
  final fraction = (match.group(2) ?? '').padRight(2, '0');
  return yuan * 100 + int.parse(fraction.isEmpty ? '0' : fraction);
}

int _nonNegativeCentsFromText(String value, String fieldName) {
  final cents = _centsFromText(value);
  if (cents < 0) throw FormatException('$fieldName不能为负数。');
  return cents;
}

String _yuanInputText(int cents) {
  final sign = cents < 0 ? '-' : '';
  final absolute = cents.abs();
  return '$sign${absolute ~/ 100}.${(absolute % 100).toString().padLeft(2, '0')}';
}

String _requiredPaymentMethodName(String value) {
  final name = value.trim();
  if (name.isEmpty) throw const FormatException('收款方式不能为空。');
  return name;
}

String _messageForError(Object error) {
  if (error is ApiException) return error.message;
  if (error is FormatException) return error.message;
  return '加载或保存失败，请稍后重试。';
}
