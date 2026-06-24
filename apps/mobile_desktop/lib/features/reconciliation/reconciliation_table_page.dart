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
  });

  final ApiClient apiClient;
  final String token;

  @override
  State<ReconciliationTablePage> createState() =>
      _ReconciliationTablePageState();
}

class _ReconciliationTablePageState extends State<ReconciliationTablePage> {
  late BusinessApi _businessApi;
  late final TextEditingController _travelGroupSalesController;
  late final TextEditingController _backOfficeSalesController;
  late final TextEditingController _buybackController;
  late final TextEditingController _externalSalesController;
  late final TextEditingController _internalPurchaseController;
  late final TextEditingController _afterSalesController;
  late final TextEditingController _refundsController;
  late final TextEditingController _otherReceivableController;
  late final TextEditingController _notesController;

  DateTime _start = DateTime(2026, 6, 1);
  DateTime _end = DateTime(2026, 6, 23);
  String _statusFilter = '全部';
  _ReconciliationRecord _selected = _reconciliationRecords.first;
  bool _loadingDaily = true;
  bool _savingDaily = false;
  String? _errorMessage;
  String? _successMessage;
  ReconciliationRecord? _dailyReconciliation;
  List<_PaymentMethodInput> _paymentMethods = <_PaymentMethodInput>[];

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _travelGroupSalesController = TextEditingController();
    _backOfficeSalesController = TextEditingController();
    _buybackController = TextEditingController();
    _externalSalesController = TextEditingController();
    _internalPurchaseController = TextEditingController();
    _afterSalesController = TextEditingController();
    _refundsController = TextEditingController();
    _otherReceivableController = TextEditingController();
    _notesController = TextEditingController();
    _loadDailyReconciliation();
  }

  @override
  void didUpdateWidget(covariant ReconciliationTablePage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token) {
      _businessApi =
          BusinessApi(apiClient: widget.apiClient, token: widget.token);
      _loadDailyReconciliation();
    }
  }

  @override
  void dispose() {
    _travelGroupSalesController.dispose();
    _backOfficeSalesController.dispose();
    _buybackController.dispose();
    _externalSalesController.dispose();
    _internalPurchaseController.dispose();
    _afterSalesController.dispose();
    _refundsController.dispose();
    _otherReceivableController.dispose();
    _notesController.dispose();
    for (final method in _paymentMethods) {
      method.dispose();
    }
    super.dispose();
  }

  Future<void> _loadDailyReconciliation() async {
    setState(() {
      _loadingDaily = true;
      _errorMessage = null;
      _successMessage = null;
    });

    try {
      final reconciliation = await _businessApi.getReconciliation(_end);
      if (!mounted) {
        return;
      }
      _fillDailyReconciliation(reconciliation);
      setState(() {
        _dailyReconciliation = reconciliation;
        _loadingDaily = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _loadingDaily = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _saveDailyReconciliation() async {
    setState(() {
      _savingDaily = true;
      _errorMessage = null;
      _successMessage = null;
    });

    try {
      final saved = await _businessApi.saveReconciliation(_end, {
        'travelGroupSalesCents':
            _centsFromText(_travelGroupSalesController.text),
        'backOfficeSalesCents': _centsFromText(_backOfficeSalesController.text),
        'buybackCents': _centsFromText(_buybackController.text),
        'externalSalesCents': _centsFromText(_externalSalesController.text),
        'internalPurchaseCents':
            _centsFromText(_internalPurchaseController.text),
        'afterSalesCents': _centsFromText(_afterSalesController.text),
        'refundsCents':
            _nonNegativeCentsFromText(_refundsController.text, '退款金额'),
        'otherReceivableCents': _centsFromText(_otherReceivableController.text),
        'notes': _notesController.text.trim(),
        'paymentMethods': [
          for (var index = 0; index < _paymentMethods.length; index++)
            {
              'name': _paymentMethods[index].nameController.text.trim(),
              'amountCents':
                  _centsFromText(_paymentMethods[index].amountController.text),
              'sortOrder': index + 1,
            },
        ],
      });

      if (!mounted) {
        return;
      }
      _fillDailyReconciliation(saved);
      setState(() {
        _dailyReconciliation = saved;
        _savingDaily = false;
        _successMessage = '对账记录已保存到数据库。';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _savingDaily = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  void _fillDailyReconciliation(ReconciliationRecord record) {
    _travelGroupSalesController.text = _yuanText(record.travelGroupSalesCents);
    _backOfficeSalesController.text = _yuanText(record.backOfficeSalesCents);
    _buybackController.text = _yuanText(record.buybackCents);
    _externalSalesController.text = _yuanText(record.externalSalesCents);
    _internalPurchaseController.text = _yuanText(record.internalPurchaseCents);
    _afterSalesController.text = _yuanText(record.afterSalesCents);
    _refundsController.text = _yuanText(record.refundsCents);
    _otherReceivableController.text = _yuanText(record.otherReceivableCents);
    _notesController.text = record.notes ?? '';

    for (final method in _paymentMethods) {
      method.dispose();
    }
    _paymentMethods = record.paymentMethods.isEmpty
        ? [
            _PaymentMethodInput(name: '现金'),
            _PaymentMethodInput(name: '微信'),
          ]
        : [
            for (final method in record.paymentMethods)
              _PaymentMethodInput(
                name: method.name,
                amountText: _yuanText(method.amountCents),
              ),
          ];
  }

  void _addPaymentMethod() {
    setState(() {
      _paymentMethods.add(_PaymentMethodInput(name: ''));
    });
  }

  void _removePaymentMethod(int index) {
    setState(() {
      final removed = _paymentMethods.removeAt(index);
      removed.dispose();
    });
  }

  void _refreshDailyTotals() {
    setState(() {});
  }

  int get _receivableTotalCents {
    return _centsFromText(_travelGroupSalesController.text) +
        _centsFromText(_backOfficeSalesController.text) +
        _centsFromText(_buybackController.text) +
        _centsFromText(_externalSalesController.text) +
        _centsFromText(_internalPurchaseController.text) +
        _centsFromText(_afterSalesController.text) -
        _nonNegativeCentsFromText(_refundsController.text, '退款金额') +
        _centsFromText(_otherReceivableController.text);
  }

  int get _actualTotalCents {
    return _paymentMethods.fold<int>(
      0,
      (sum, method) => sum + _centsFromText(method.amountController.text),
    );
  }

  @override
  Widget build(BuildContext context) {
    final records = _reconciliationRecords.where((record) {
      return _statusFilter == '全部' || record.status == _statusFilter;
    }).toList();
    final differenceCents = _actualTotalCents - _receivableTotalCents;

    return ResponsivePage(
      children: [
        if (_errorMessage != null)
          _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
        if (_successMessage != null)
          _InlineNotice(message: _successMessage!, tone: StatusTone.success),
        FormSection(
          title: '对账范围',
          trailing:
              StatusTag(label: '${records.length} 天记录', tone: StatusTone.info),
          children: [
            ResponsiveFormGrid(
              children: [
                AppDateRangeButton(
                  start: _start,
                  end: _end,
                  onChanged: (range) {
                    setState(() {
                      _start = range.start;
                      _end = range.end;
                    });
                    _loadDailyReconciliation();
                  },
                ),
                const AppSearchField(hintText: '搜索日期、备注、经办人'),
              ],
            ),
          ],
        ),
        MetricGrid(
          metrics: [
            MetricData(
                label: '应收合计',
                value: formatMoneyCents(records.fold<int>(
                    0, (sum, item) => sum + item.receivableCents)),
                icon: Icons.account_balance_wallet_rounded),
            MetricData(
                label: '实收合计',
                value: formatMoneyCents(records.fold<int>(
                    0, (sum, item) => sum + item.receivedCents)),
                icon: Icons.payments_rounded),
            MetricData(
                label: '差异金额',
                value: formatMoneyCents(records.fold<int>(
                    0, (sum, item) => sum + item.differenceCents)),
                icon: Icons.balance_rounded),
            MetricData(
                label: '待复核',
                value:
                    '${records.where((item) => item.status == '待复核').length}',
                icon: Icons.rule_rounded),
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
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: DataTable(
                    columns: const [
                      DataColumn(label: Text('日期')),
                      DataColumn(label: Text('旅行团销售')),
                      DataColumn(label: Text('后台销售')),
                      DataColumn(label: Text('退款扣减')),
                      DataColumn(label: Text('实收')),
                      DataColumn(label: Text('差异')),
                      DataColumn(label: Text('状态')),
                    ],
                    rows: [
                      for (final record in records)
                        DataRow(
                          selected: record.date == _selected.date,
                          onSelectChanged: (_) =>
                              setState(() => _selected = record),
                          cells: [
                            DataCell(Text(record.date)),
                            DataCell(
                                MoneyText(cents: record.travelGroupSalesCents)),
                            DataCell(
                                MoneyText(cents: record.backOfficeSalesCents)),
                            DataCell(MoneyText(cents: record.refundCents)),
                            DataCell(MoneyText(cents: record.receivedCents)),
                            DataCell(MoneyText(cents: record.differenceCents)),
                            DataCell(StatusTag(
                                label: record.status, tone: record.tone)),
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
              _buildDailyReconciliationForm(differenceCents),
              const SizedBox(height: 16),
              _ReconciliationDetail(record: _selected),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildDailyReconciliationForm(int differenceCents) {
    return FormSection(
      title: '每日对账录入',
      trailing: StatusTag(
        label: _loadingDaily
            ? '加载中'
            : _dailyReconciliation?.businessDate ?? formatDate(_end),
        tone: _loadingDaily ? StatusTone.warning : StatusTone.info,
      ),
      children: [
        ResponsiveFormGrid(
          children: [
            _MoneyField(
              label: '旅行团销售额',
              controller: _travelGroupSalesController,
              onChanged: _refreshDailyTotals,
            ),
            _MoneyField(
              label: '后场销售额',
              controller: _backOfficeSalesController,
              onChanged: _refreshDailyTotals,
            ),
            _MoneyField(
              label: '回购',
              controller: _buybackController,
              onChanged: _refreshDailyTotals,
            ),
            _MoneyField(
              label: '外销',
              controller: _externalSalesController,
              onChanged: _refreshDailyTotals,
            ),
            _MoneyField(
              label: '内购',
              controller: _internalPurchaseController,
              onChanged: _refreshDailyTotals,
            ),
            _MoneyField(
              label: '售后',
              controller: _afterSalesController,
              onChanged: _refreshDailyTotals,
            ),
            _MoneyField(
              label: '退款金额（正数扣减）',
              controller: _refundsController,
              helperText: '输入正数，系统从应收合计中扣减',
              onChanged: _refreshDailyTotals,
            ),
            _MoneyField(
              label: '其他',
              controller: _otherReceivableController,
              onChanged: _refreshDailyTotals,
            ),
          ],
        ),
        const Divider(height: 24),
        Row(
          children: [
            Expanded(
              child: Text(
                '实收收款方式',
                style: Theme.of(context)
                    .textTheme
                    .titleSmall
                    ?.copyWith(fontWeight: FontWeight.w800),
              ),
            ),
            IconButton(
              tooltip: '新增收款方式',
              onPressed: _addPaymentMethod,
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
                    decoration: const InputDecoration(labelText: '收款方式'),
                    onChanged: (_) => setState(() {}),
                  ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  width: 132,
                  child: TextField(
                    controller: _paymentMethods[index].amountController,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(
                      labelText: '实收金额',
                      prefixText: '¥ ',
                    ),
                    onChanged: (_) => setState(() {}),
                  ),
                ),
                IconButton(
                  tooltip: '删除',
                  onPressed: _paymentMethods.length <= 1
                      ? null
                      : () => _removePaymentMethod(index),
                  icon: const Icon(Icons.delete_outline_rounded),
                ),
              ],
            ),
          ),
        TextField(
          controller: _notesController,
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
              label: '差额 ${formatMoneyCents(differenceCents)}',
              tone: differenceCents == 0
                  ? StatusTone.success
                  : StatusTone.warning,
            ),
          ],
        ),
        const SizedBox(height: 14),
        SectionActions(
          primaryLabel: _savingDaily ? '保存中...' : '保存对账',
          secondaryLabel: '刷新',
          onPrimaryPressed:
              _savingDaily || _loadingDaily ? null : _saveDailyReconciliation,
          onSecondaryPressed: _loadDailyReconciliation,
        ),
      ],
    );
  }
}

class _ReconciliationDetail extends StatelessWidget {
  const _ReconciliationDetail({required this.record});

  final _ReconciliationRecord record;

  @override
  Widget build(BuildContext context) {
    return FormSection(
      title: '当日对账摘要',
      trailing: StatusTag(label: record.status, tone: record.tone),
      children: [
        _AmountLine(
            label: '应收合计', cents: record.receivableCents, prominent: true),
        _AmountLine(label: '实收合计', cents: record.receivedCents),
        _AmountLine(label: '差异金额', cents: record.differenceCents),
        const Divider(height: 24),
        _InfoRow(label: '支付拆分', value: record.paymentSummary),
        _InfoRow(label: '经办人', value: record.operator),
        _InfoRow(label: '备注', value: record.note),
      ],
    );
  }
}

class _MoneyField extends StatelessWidget {
  const _MoneyField({
    required this.label,
    required this.controller,
    required this.onChanged,
    this.helperText,
  });

  final String label;
  final TextEditingController controller;
  final VoidCallback onChanged;
  final String? helperText;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      inputFormatters: [
        FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
      ],
      decoration: InputDecoration(
        labelText: label,
        helperText: helperText,
        prefixText: '¥ ',
      ),
      onChanged: (_) => onChanged(),
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

class _PaymentMethodInput {
  _PaymentMethodInput({
    required String name,
    String amountText = '',
  })  : nameController = TextEditingController(text: name),
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
              child: Text(label, style: Theme.of(context).textTheme.bodySmall)),
          Expanded(
              child: Text(value,
                  style: const TextStyle(fontWeight: FontWeight.w700))),
        ],
      ),
    );
  }
}

class _ReconciliationRecord {
  const _ReconciliationRecord({
    required this.date,
    required this.travelGroupSalesCents,
    required this.backOfficeSalesCents,
    required this.refundCents,
    required this.receivedCents,
    required this.differenceCents,
    required this.status,
    required this.tone,
    required this.paymentSummary,
    required this.operator,
    required this.note,
  });

  final String date;
  final int travelGroupSalesCents;
  final int backOfficeSalesCents;
  final int refundCents;
  final int receivedCents;
  final int differenceCents;
  final String status;
  final StatusTone tone;
  final String paymentSummary;
  final String operator;
  final String note;

  int get receivableCents =>
      travelGroupSalesCents + backOfficeSalesCents - refundCents;
}

const _reconciliationRecords = <_ReconciliationRecord>[
  _ReconciliationRecord(
    date: '2026-06-22',
    travelGroupSalesCents: 647800,
    backOfficeSalesCents: 120000,
    refundCents: 68000,
    receivedCents: 699800,
    differenceCents: 0,
    status: '已平账',
    tone: StatusTone.success,
    paymentSummary: '现金 ¥2,000.00；微信 ¥4,998.00',
    operator: '财务测试账号',
    note: '旅行团与后台销售已核对',
  ),
  _ReconciliationRecord(
    date: '2026-06-21',
    travelGroupSalesCents: 1299000,
    backOfficeSalesCents: 0,
    refundCents: 0,
    receivedCents: 1249000,
    differenceCents: 50000,
    status: '有差异',
    tone: StatusTone.danger,
    paymentSummary: '微信 ¥12,490.00',
    operator: '财务测试账号',
    note: '导游返点待确认',
  ),
  _ReconciliationRecord(
    date: '2026-06-20',
    travelGroupSalesCents: 388000,
    backOfficeSalesCents: 88000,
    refundCents: 0,
    receivedCents: 476000,
    differenceCents: 0,
    status: '待复核',
    tone: StatusTone.warning,
    paymentSummary: '现金 ¥880.00；微信 ¥3,880.00',
    operator: '财务测试账号',
    note: '待主管复核',
  ),
];

int _centsFromText(String value) {
  final normalized = value.replaceAll(',', '').replaceAll('¥', '').trim();
  if (normalized.isEmpty) {
    return 0;
  }
  final amount = double.tryParse(normalized) ?? 0;
  return (amount * 100).round();
}

int _nonNegativeCentsFromText(String value, String fieldName) {
  final cents = _centsFromText(value);
  if (cents < 0) {
    throw FormatException('$fieldName不能为负数');
  }
  return cents;
}

String _yuanText(int cents) {
  if (cents == 0) {
    return '';
  }
  return (cents / 100).toStringAsFixed(2);
}

String _messageForError(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  if (error is FormatException) {
    return error.message;
  }
  return '操作失败，请稍后重试。';
}
