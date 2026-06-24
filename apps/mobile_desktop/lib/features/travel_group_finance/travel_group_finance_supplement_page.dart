import 'package:flutter/material.dart';

import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/money_text.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/status_tag.dart';

class TravelGroupFinanceSupplementPage extends StatefulWidget {
  const TravelGroupFinanceSupplementPage({super.key});

  @override
  State<TravelGroupFinanceSupplementPage> createState() =>
      _TravelGroupFinanceSupplementPageState();
}

class _TravelGroupFinanceSupplementPageState
    extends State<TravelGroupFinanceSupplementPage> {
  late final TextEditingController _agencyFilterController;
  late final TextEditingController _guideFilterController;
  late final TextEditingController _returnedAmountFilterController;
  late final List<_FinanceGroupDraft> _drafts;

  String _agencyQuery = '';
  String _guideQuery = '';
  String _returnedAmountQuery = '';
  int _rowSequence = _financeGroupRecords.length;

  @override
  void initState() {
    super.initState();
    _agencyFilterController = TextEditingController();
    _guideFilterController = TextEditingController();
    _returnedAmountFilterController = TextEditingController();
    _drafts = [
      for (final record in _financeGroupRecords)
        _FinanceGroupDraft.fromRecord(record),
    ];
  }

  @override
  void dispose() {
    _agencyFilterController.dispose();
    _guideFilterController.dispose();
    _returnedAmountFilterController.dispose();
    super.dispose();
  }

  List<_FinanceGroupDraft> get _visibleDrafts {
    final agencyQuery = _agencyQuery.trim().toLowerCase();
    final guideQuery = _guideQuery.trim().toLowerCase();
    final returnedAmountFilter =
        _optionalCentsFromText(_returnedAmountQuery.trim());

    return _drafts.where((draft) {
      if (agencyQuery.isNotEmpty &&
          !draft.travelAgencyText.toLowerCase().contains(agencyQuery)) {
        return false;
      }
      if (guideQuery.isNotEmpty &&
          !draft.guideNameText.toLowerCase().contains(guideQuery)) {
        return false;
      }
      if (returnedAmountFilter != null &&
          draft.returnedAmountCents < returnedAmountFilter) {
        return false;
      }
      return true;
    }).toList();
  }

  int get _visibleOrderAmountCents {
    return _visibleDrafts.fold<int>(
      0,
      (sum, draft) => sum + draft.orderAmountCents,
    );
  }

  int get _visibleReturnedAmountCents {
    return _visibleDrafts.fold<int>(
      0,
      (sum, draft) => sum + draft.returnedAmountCents,
    );
  }

  void _addDraftRow() {
    setState(() {
      _rowSequence += 1;
      _drafts.insert(0, _FinanceGroupDraft.blank(_rowSequence));
    });
  }

  void _clearFilters() {
    setState(() {
      _agencyFilterController.clear();
      _guideFilterController.clear();
      _returnedAmountFilterController.clear();
      _agencyQuery = '';
      _guideQuery = '';
      _returnedAmountQuery = '';
    });
  }

  @override
  Widget build(BuildContext context) {
    final visibleDrafts = _visibleDrafts;

    return ResponsivePage(
      maxWidth: 1480,
      children: [
        FormSection(
          title: '筛选条件',
          trailing: StatusTag(
            label: '${visibleDrafts.length} 行',
            tone: StatusTone.info,
          ),
          children: [
            ResponsiveFormGrid(
              children: [
                TextField(
                  controller: _agencyFilterController,
                  decoration: const InputDecoration(labelText: '旅行社'),
                  onChanged: (value) => setState(() => _agencyQuery = value),
                ),
                TextField(
                  controller: _guideFilterController,
                  decoration: const InputDecoration(labelText: '导游'),
                  onChanged: (value) => setState(() => _guideQuery = value),
                ),
                TextField(
                  controller: _returnedAmountFilterController,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(
                    labelText: '已返金额',
                    prefixText: '¥ ',
                  ),
                  onChanged: (value) =>
                      setState(() => _returnedAmountQuery = value),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: _clearFilters,
                icon: const Icon(Icons.filter_alt_off_rounded),
                label: const Text('清空筛选'),
              ),
            ),
          ],
        ),
        _FinanceSummaryStrip(
          visibleCount: visibleDrafts.length,
          totalCount: _drafts.length,
          orderAmountCents: _visibleOrderAmountCents,
          returnedAmountCents: _visibleReturnedAmountCents,
          pendingCount:
              visibleDrafts.where((draft) => draft.status == '待补充').length,
        ),
        FormSection(
          title: '积分表',
          trailing: FilledButton.icon(
            onPressed: _addDraftRow,
            icon: const Icon(Icons.add_rounded),
            label: const Text('添加行'),
          ),
          children: [
            if (visibleDrafts.isEmpty)
              const _EmptyFinanceTable()
            else
              _FinancePointTable(
                drafts: visibleDrafts,
                onChanged: () => setState(() {}),
              ),
            const SizedBox(height: 14),
            SectionActions(
              primaryLabel: '保存积分表',
              secondaryLabel: '标记待复核',
              onPrimaryPressed: () {},
              onSecondaryPressed: () {},
            ),
          ],
        ),
      ],
    );
  }
}

class _FinanceSummaryStrip extends StatelessWidget {
  const _FinanceSummaryStrip({
    required this.visibleCount,
    required this.totalCount,
    required this.orderAmountCents,
    required this.returnedAmountCents,
    required this.pendingCount,
  });

  final int visibleCount;
  final int totalCount;
  final int orderAmountCents;
  final int returnedAmountCents;
  final int pendingCount;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        StatusTag(
            label: '当前显示 $visibleCount/$totalCount 行', tone: StatusTone.info),
        StatusTag(label: '待补充 $pendingCount 行', tone: StatusTone.warning),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('上单金额 '),
            MoneyText(cents: orderAmountCents),
          ],
        ),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('已返金额 '),
            MoneyText(cents: returnedAmountCents),
          ],
        ),
      ],
    );
  }
}

class _FinancePointTable extends StatelessWidget {
  const _FinancePointTable({
    required this.drafts,
    required this.onChanged,
  });

  final List<_FinanceGroupDraft> drafts;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    return _TableScroller(
      child: DataTable(
        columnSpacing: 18,
        horizontalMargin: 12,
        headingRowHeight: 44,
        dataRowMinHeight: 68,
        dataRowMaxHeight: 76,
        columns: const [
          DataColumn(label: Text('日期')),
          DataColumn(label: Text('团号')),
          DataColumn(label: Text('旅行社')),
          DataColumn(label: Text('导游')),
          DataColumn(label: Text('车牌号')),
          DataColumn(label: Text('人数')),
          DataColumn(label: Text('品鉴师')),
          DataColumn(label: Text('销售额')),
          DataColumn(label: Text('已付定金')),
          DataColumn(label: Text('货到付款')),
          DataColumn(label: Text('扣酒成本')),
          DataColumn(label: Text('上单金额')),
          DataColumn(label: Text('已返金额')),
          DataColumn(label: Text('积分')),
          DataColumn(label: Text('已返积分')),
          DataColumn(label: Text('未返积分')),
          DataColumn(label: Text('导游信息发送')),
          DataColumn(label: Text('旅行团信息发送')),
          DataColumn(label: Text('状态')),
        ],
        rows: [
          for (final draft in drafts)
            DataRow(
              cells: [
                DataCell(_TableInputCell(
                  cellKey: '${draft.rowKey}:date',
                  value: draft.dateText,
                  keyboardType: TextInputType.datetime,
                  onChanged: (value) {
                    draft.dateText = value;
                    onChanged();
                  },
                  width: 116,
                )),
                DataCell(_TableInputCell(
                  cellKey: '${draft.rowKey}:groupNo',
                  value: draft.groupNoText,
                  keyboardType: TextInputType.text,
                  onChanged: (value) {
                    draft.groupNoText = value;
                    onChanged();
                  },
                  width: 128,
                )),
                DataCell(_TableInputCell(
                  cellKey: '${draft.rowKey}:agency',
                  value: draft.travelAgencyText,
                  keyboardType: TextInputType.text,
                  onChanged: (value) {
                    draft.travelAgencyText = value;
                    onChanged();
                  },
                  width: 132,
                )),
                DataCell(_TableInputCell(
                  cellKey: '${draft.rowKey}:guide',
                  value: draft.guideNameText,
                  keyboardType: TextInputType.text,
                  onChanged: (value) {
                    draft.guideNameText = value;
                    onChanged();
                  },
                  width: 96,
                )),
                DataCell(_TableInputCell(
                  cellKey: '${draft.rowKey}:licensePlate',
                  value: draft.licensePlateText,
                  keyboardType: TextInputType.text,
                  onChanged: (value) {
                    draft.licensePlateText = value;
                    onChanged();
                  },
                  width: 104,
                )),
                DataCell(_TableInputCell(
                  cellKey: '${draft.rowKey}:guestCount',
                  value: draft.guestCountText,
                  keyboardType: TextInputType.number,
                  onChanged: (value) {
                    draft.guestCountText = value;
                    onChanged();
                  },
                  width: 72,
                )),
                DataCell(_TableInputCell(
                  cellKey: '${draft.rowKey}:taster',
                  value: draft.tasterNameText,
                  keyboardType: TextInputType.text,
                  onChanged: (value) {
                    draft.tasterNameText = value;
                    onChanged();
                  },
                  width: 104,
                )),
                DataCell(_MoneyInputCell(
                  cellKey: '${draft.rowKey}:salesAmount',
                  value: draft.salesAmountText,
                  onChanged: (value) {
                    draft.salesAmountText = value;
                    onChanged();
                  },
                )),
                DataCell(_MoneyInputCell(
                  cellKey: '${draft.rowKey}:paidDeposit',
                  value: draft.paidDepositText,
                  onChanged: (value) {
                    draft.paidDepositText = value;
                    onChanged();
                  },
                )),
                DataCell(_MoneyInputCell(
                  cellKey: '${draft.rowKey}:cashOnDelivery',
                  value: draft.cashOnDeliveryText,
                  onChanged: (value) {
                    draft.cashOnDeliveryText = value;
                    onChanged();
                  },
                )),
                DataCell(_MoneyInputCell(
                  cellKey: '${draft.rowKey}:liquorCostDeduction',
                  value: draft.liquorCostDeductionText,
                  onChanged: (value) {
                    draft.liquorCostDeductionText = value;
                    onChanged();
                  },
                )),
                DataCell(_MoneyInputCell(
                  cellKey: '${draft.rowKey}:orderAmount',
                  value: draft.orderAmountText,
                  onChanged: (value) {
                    draft.orderAmountText = value;
                    onChanged();
                  },
                )),
                DataCell(_MoneyInputCell(
                  cellKey: '${draft.rowKey}:returnedAmount',
                  value: draft.returnedAmountText,
                  onChanged: (value) {
                    draft.returnedAmountText = value;
                    onChanged();
                  },
                )),
                DataCell(_TableInputCell(
                  cellKey: '${draft.rowKey}:points',
                  value: draft.pointsText,
                  keyboardType: TextInputType.number,
                  onChanged: (value) {
                    draft.pointsText = value;
                    onChanged();
                  },
                  width: 88,
                )),
                DataCell(_TableInputCell(
                  cellKey: '${draft.rowKey}:returnedPoints',
                  value: draft.returnedPointsText,
                  keyboardType: TextInputType.number,
                  onChanged: (value) {
                    draft.returnedPointsText = value;
                    onChanged();
                  },
                  width: 88,
                )),
                DataCell(_TableInputCell(
                  cellKey: '${draft.rowKey}:unreturnedPoints',
                  value: draft.unreturnedPointsText,
                  keyboardType: TextInputType.number,
                  onChanged: (value) {
                    draft.unreturnedPointsText = value;
                    onChanged();
                  },
                  width: 88,
                )),
                DataCell(Switch(
                  value: draft.guideInfoSent,
                  onChanged: (value) {
                    draft.guideInfoSent = value;
                    onChanged();
                  },
                )),
                DataCell(Switch(
                  value: draft.travelAgencyInfoSent,
                  onChanged: (value) {
                    draft.travelAgencyInfoSent = value;
                    onChanged();
                  },
                )),
                DataCell(_StatusDropdownCell(
                  draft: draft,
                  onChanged: onChanged,
                )),
              ],
            ),
        ],
      ),
    );
  }
}

class _StatusDropdownCell extends StatelessWidget {
  const _StatusDropdownCell({
    required this.draft,
    required this.onChanged,
  });

  final _FinanceGroupDraft draft;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 108,
      child: DropdownButton<String>(
        value: draft.status,
        isExpanded: true,
        underline: const SizedBox.shrink(),
        items: [
          for (final status in _financeStatuses)
            DropdownMenuItem(value: status, child: Text(status)),
        ],
        onChanged: (value) {
          if (value == null) {
            return;
          }
          draft.status = value;
          onChanged();
        },
      ),
    );
  }
}

class _TableScroller extends StatelessWidget {
  const _TableScroller({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Scrollbar(
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: child,
      ),
    );
  }
}

class _MoneyInputCell extends StatelessWidget {
  const _MoneyInputCell({
    required this.cellKey,
    required this.value,
    required this.onChanged,
  });

  final String cellKey;
  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return _TableInputCell(
      cellKey: cellKey,
      value: value,
      prefixText: '¥ ',
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      onChanged: onChanged,
    );
  }
}

class _TableInputCell extends StatelessWidget {
  const _TableInputCell({
    required this.cellKey,
    required this.value,
    required this.keyboardType,
    required this.onChanged,
    this.prefixText,
    this.width = 118,
  });

  final String cellKey;
  final String value;
  final TextInputType keyboardType;
  final ValueChanged<String> onChanged;
  final String? prefixText;
  final double width;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      child: TextFormField(
        key: ValueKey(cellKey),
        initialValue: value,
        keyboardType: keyboardType,
        decoration: InputDecoration(
          isDense: true,
          prefixText: prefixText,
        ),
        onChanged: onChanged,
      ),
    );
  }
}

class _EmptyFinanceTable extends StatelessWidget {
  const _EmptyFinanceTable();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.table_rows_rounded, size: 34, color: scheme.primary),
          const SizedBox(height: 10),
          Text(
            '没有符合条件的积分记录',
            style: Theme.of(context)
                .textTheme
                .titleSmall
                ?.copyWith(fontWeight: FontWeight.w800),
          ),
        ],
      ),
    );
  }
}

class _FinanceGroupDraft {
  _FinanceGroupDraft({
    required this.rowKey,
    required this.dateText,
    required this.groupNoText,
    required this.travelAgencyText,
    required this.guideNameText,
    required this.licensePlateText,
    required this.guestCountText,
    required this.tasterNameText,
    required this.status,
    required this.salesAmountText,
    required this.paidDepositText,
    required this.cashOnDeliveryText,
    required this.liquorCostDeductionText,
    required this.orderAmountText,
    required this.returnedAmountText,
    required this.pointsText,
    required this.returnedPointsText,
    required this.unreturnedPointsText,
    required this.guideInfoSent,
    required this.travelAgencyInfoSent,
  });

  factory _FinanceGroupDraft.fromRecord(_FinanceGroupRecord record) {
    return _FinanceGroupDraft(
      rowKey: record.groupNo,
      dateText: record.date,
      groupNoText: record.groupNo,
      travelAgencyText: record.travelAgency,
      guideNameText: record.guideName,
      licensePlateText: record.licensePlate,
      guestCountText: '${record.guestCount}',
      tasterNameText: record.tasterName,
      status: record.status,
      salesAmountText: _yuanText(record.salesAmountCents),
      paidDepositText: _yuanText(record.paidDepositCents),
      cashOnDeliveryText: _yuanText(record.cashOnDeliveryCents),
      liquorCostDeductionText: _yuanText(record.liquorCostDeductionCents),
      orderAmountText: _yuanText(record.orderAmountCents),
      returnedAmountText: _yuanText(record.returnedAmountCents),
      pointsText: '${record.points}',
      returnedPointsText: '${record.returnedPoints}',
      unreturnedPointsText: '${record.unreturnedPoints}',
      guideInfoSent: record.guideInfoSent,
      travelAgencyInfoSent: record.travelAgencyInfoSent,
    );
  }

  factory _FinanceGroupDraft.blank(int index) {
    return _FinanceGroupDraft(
      rowKey: 'new-$index',
      dateText: '',
      groupNoText: '',
      travelAgencyText: '',
      guideNameText: '',
      licensePlateText: '',
      guestCountText: '',
      tasterNameText: '',
      status: '待补充',
      salesAmountText: '',
      paidDepositText: '',
      cashOnDeliveryText: '',
      liquorCostDeductionText: '',
      orderAmountText: '',
      returnedAmountText: '',
      pointsText: '',
      returnedPointsText: '',
      unreturnedPointsText: '',
      guideInfoSent: false,
      travelAgencyInfoSent: false,
    );
  }

  final String rowKey;
  String dateText;
  String groupNoText;
  String travelAgencyText;
  String guideNameText;
  String licensePlateText;
  String guestCountText;
  String tasterNameText;
  String status;
  String salesAmountText;
  String paidDepositText;
  String cashOnDeliveryText;
  String liquorCostDeductionText;
  String orderAmountText;
  String returnedAmountText;
  String pointsText;
  String returnedPointsText;
  String unreturnedPointsText;
  bool guideInfoSent;
  bool travelAgencyInfoSent;

  int get orderAmountCents => _centsFromText(orderAmountText);
  int get returnedAmountCents => _centsFromText(returnedAmountText);
}

class _FinanceGroupRecord {
  const _FinanceGroupRecord({
    required this.date,
    required this.groupNo,
    required this.travelAgency,
    required this.guideName,
    required this.licensePlate,
    required this.guestCount,
    required this.tasterName,
    required this.salesAmountCents,
    required this.paidDepositCents,
    required this.cashOnDeliveryCents,
    required this.liquorCostDeductionCents,
    required this.orderAmountCents,
    required this.returnedAmountCents,
    required this.points,
    required this.returnedPoints,
    required this.unreturnedPoints,
    required this.status,
    required this.guideInfoSent,
    required this.travelAgencyInfoSent,
  });

  final String date;
  final String groupNo;
  final String travelAgency;
  final String guideName;
  final String licensePlate;
  final int guestCount;
  final String tasterName;
  final int salesAmountCents;
  final int paidDepositCents;
  final int cashOnDeliveryCents;
  final int liquorCostDeductionCents;
  final int orderAmountCents;
  final int returnedAmountCents;
  final int points;
  final int returnedPoints;
  final int unreturnedPoints;
  final String status;
  final bool guideInfoSent;
  final bool travelAgencyInfoSent;
}

const _financeStatuses = ['待补充', '待复核', '已完成'];

const _financeGroupRecords = <_FinanceGroupRecord>[
  _FinanceGroupRecord(
    date: '2026-06-22',
    groupNo: 'GZ-0622-018',
    travelAgency: '黔程旅行社',
    guideName: '李导',
    licensePlate: '贵A·8T26',
    guestCount: 22,
    tasterName: '陈品鉴',
    salesAmountCents: 647800,
    paidDepositCents: 120000,
    cashOnDeliveryCents: 180000,
    liquorCostDeductionCents: 42000,
    orderAmountCents: 647800,
    returnedAmountCents: 30000,
    points: 640,
    returnedPoints: 300,
    unreturnedPoints: 340,
    status: '待补充',
    guideInfoSent: true,
    travelAgencyInfoSent: false,
  ),
  _FinanceGroupRecord(
    date: '2026-06-22',
    groupNo: 'GZ-0622-016',
    travelAgency: '山水国旅',
    guideName: '周导',
    licensePlate: '贵B·2K61',
    guestCount: 16,
    tasterName: '王品鉴',
    salesAmountCents: 388000,
    paidDepositCents: 80000,
    cashOnDeliveryCents: 0,
    liquorCostDeductionCents: 26000,
    orderAmountCents: 388000,
    returnedAmountCents: 0,
    points: 380,
    returnedPoints: 0,
    unreturnedPoints: 380,
    status: '待复核',
    guideInfoSent: false,
    travelAgencyInfoSent: false,
  ),
  _FinanceGroupRecord(
    date: '2026-06-21',
    groupNo: 'GZ-0622-011',
    travelAgency: '黔北旅行社',
    guideName: '赵导',
    licensePlate: '贵C·5M09',
    guestCount: 12,
    tasterName: '李品鉴',
    salesAmountCents: 0,
    paidDepositCents: 0,
    cashOnDeliveryCents: 0,
    liquorCostDeductionCents: 0,
    orderAmountCents: 0,
    returnedAmountCents: 0,
    points: 0,
    returnedPoints: 0,
    unreturnedPoints: 0,
    status: '已完成',
    guideInfoSent: true,
    travelAgencyInfoSent: true,
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

int? _optionalCentsFromText(String value) {
  final normalized = value.replaceAll(',', '').replaceAll('¥', '').trim();
  if (normalized.isEmpty) {
    return null;
  }
  final amount = double.tryParse(normalized);
  return amount == null ? null : (amount * 100).round();
}

String _yuanText(int cents) {
  if (cents == 0) {
    return '';
  }
  return (cents / 100).toStringAsFixed(2);
}
