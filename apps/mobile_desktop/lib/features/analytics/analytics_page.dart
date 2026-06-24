import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../shared/widgets/app_record_list.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/status_tag.dart';

enum _RankingSort {
  totalSales('总销售额从高到低'),
  groupAverage('团均销售额从高到低'),
  perCapita('人均销售额从高到低');

  const _RankingSort(this.label);

  final String label;
}

class AnalyticsPage extends StatefulWidget {
  const AnalyticsPage({super.key});

  @override
  State<AnalyticsPage> createState() => _AnalyticsPageState();
}

class _AnalyticsPageState extends State<AnalyticsPage> {
  String _preset = '本月';
  String _rankingPreset = '本月';
  late DateTime _start;
  late DateTime _end;
  late DateTime _rankingStart;
  late DateTime _rankingEnd;
  _RankingSort _rankingSort = _RankingSort.totalSales;

  @override
  void initState() {
    super.initState();
    final initialRange = _rangeForPreset(_preset, DateTime.now());
    _start = initialRange.start;
    _end = initialRange.end;
    _rankingStart = initialRange.start;
    _rankingEnd = initialRange.end;
  }

  @override
  Widget build(BuildContext context) {
    final rankingRecords = _sortedRankingRecords();
    final maxRankingValue = rankingRecords
        .map(_rankingMetric)
        .fold<int>(0, (previous, value) => value > previous ? value : previous);

    return ResponsivePage(
      children: [
        Wrap(
          spacing: 10,
          runSpacing: 10,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            AppDateRangeButton(
              start: _start,
              end: _end,
              onChanged: (range) => setState(() {
                _start = range.start;
                _end = range.end;
                _preset = '自定义';
              }),
            ),
            AppFilterBar(
              filters: datePresetLabels,
              selected: _preset,
              onSelected: _applyPreset,
            ),
          ],
        ),
        MetricGrid(
          metrics: [
            MetricData(
                label: '出单销售额',
                value: formatMoneyCents(38265000),
                icon: Icons.trending_up_rounded),
            MetricData(
                label: '退单销售额',
                value: formatMoneyCents(2180000),
                icon: Icons.assignment_return_rounded),
            const MetricData(
                label: '总接待团数',
                value: '286',
                icon: Icons.directions_bus_rounded),
            const MetricData(
                label: '打蛋率', value: '18.6%', icon: Icons.pie_chart_rounded),
            const MetricData(
                label: '总接待人数', value: '8,920', icon: Icons.groups_rounded),
            MetricData(
                label: '团均销售额',
                value: formatMoneyCents(133794),
                icon: Icons.stacked_line_chart_rounded),
            MetricData(
                label: '人均销售额',
                value: formatMoneyCents(4289),
                icon: Icons.person_rounded),
            const MetricData(
                label: '有效订单数', value: '418', icon: Icons.receipt_long_rounded),
          ],
        ),
        ResponsiveTwoColumn(
          primary: Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    '品鉴师排名',
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      AppDateRangeButton(
                        start: _rankingStart,
                        end: _rankingEnd,
                        onChanged: (range) => setState(() {
                          _rankingStart = range.start;
                          _rankingEnd = range.end;
                          _rankingPreset = '自定义';
                        }),
                      ),
                      AppFilterBar(
                        filters: datePresetLabels,
                        selected: _rankingPreset,
                        onSelected: _applyRankingPreset,
                      ),
                      SizedBox(
                        width: 220,
                        child: DropdownButtonFormField<_RankingSort>(
                          initialValue: _rankingSort,
                          isExpanded: true,
                          decoration: const InputDecoration(labelText: '种类筛选'),
                          items: [
                            for (final sort in _RankingSort.values)
                              DropdownMenuItem(
                                  value: sort, child: Text(sort.label)),
                          ],
                          onChanged: (value) {
                            if (value != null) {
                              setState(() => _rankingSort = value);
                            }
                          },
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  for (var index = 0; index < rankingRecords.length; index++)
                    _RankingBar(
                      name: rankingRecords[index].name,
                      value: maxRankingValue == 0
                          ? 0
                          : _rankingMetric(rankingRecords[index]) /
                              maxRankingValue,
                      sales: formatMoneyCents(
                          _rankingMetric(rankingRecords[index])),
                      rank: index + 1,
                    ),
                ],
              ),
            ),
          ),
          secondary: const AppRecordList(
            compact: true,
            items: [
              AppRecordItem(
                title: '本月打蛋率偏高',
                subtitle: '未出单 53 团 / 接待 286 团',
                icon: Icons.warning_amber_rounded,
                trailing: StatusTag(label: '关注', tone: StatusTone.warning),
              ),
              AppRecordItem(
                title: '昨日退单金额',
                subtitle: '2 笔售后已完成退款',
                icon: Icons.assignment_return_rounded,
                trailing: StatusTag(label: '已入统计', tone: StatusTone.info),
              ),
              AppRecordItem(
                title: '物流费用待补充',
                subtitle: '12 笔订单未填写运费',
                icon: Icons.local_shipping_rounded,
                trailing: StatusTag(label: '待处理', tone: StatusTone.neutral),
              ),
            ],
          ),
        ),
      ],
    );
  }

  void _applyPreset(String preset) {
    final range = _rangeForPreset(preset, DateTime.now());
    setState(() {
      _preset = preset;
      _start = range.start;
      _end = range.end;
    });
  }

  void _applyRankingPreset(String preset) {
    final range = _rangeForPreset(preset, DateTime.now());
    setState(() {
      _rankingPreset = preset;
      _rankingStart = range.start;
      _rankingEnd = range.end;
    });
  }

  List<_TasterRankingRecord> _sortedRankingRecords() {
    final records = List<_TasterRankingRecord>.of(_tasterRankingRecords);
    records.sort(
        (left, right) => _rankingMetric(right).compareTo(_rankingMetric(left)));
    return records;
  }

  int _rankingMetric(_TasterRankingRecord record) {
    switch (_rankingSort) {
      case _RankingSort.totalSales:
        return record.totalSalesCents;
      case _RankingSort.groupAverage:
        return record.groupAverageCents;
      case _RankingSort.perCapita:
        return record.perCapitaCents;
    }
  }
}

DateTimeRange _rangeForPreset(String preset, DateTime now) {
  final today = _dateOnly(now);
  switch (preset) {
    case '今日':
      return DateTimeRange(start: today, end: today);
    case '昨日':
      final yesterday = today.subtract(const Duration(days: 1));
      return DateTimeRange(start: yesterday, end: yesterday);
    case '最近十天':
    case '最近 10 天':
    case '近 10 天':
      return DateTimeRange(
          start: today.subtract(const Duration(days: 9)), end: today);
    case '最近一个月':
      return DateTimeRange(
          start: today.subtract(const Duration(days: 29)), end: today);
    case '上个月':
      final start = DateTime(today.year, today.month - 1);
      final end = DateTime(today.year, today.month, 0);
      return DateTimeRange(start: start, end: end);
    case '今年':
    case '本年':
      return DateTimeRange(start: DateTime(today.year), end: today);
    case '本月':
    default:
      return DateTimeRange(
          start: DateTime(today.year, today.month), end: today);
  }
}

DateTime _dateOnly(DateTime value) =>
    DateTime(value.year, value.month, value.day);

class _TasterRankingRecord {
  const _TasterRankingRecord({
    required this.name,
    required this.totalSalesCents,
    required this.groupAverageCents,
    required this.perCapitaCents,
  });

  final String name;
  final int totalSalesCents;
  final int groupAverageCents;
  final int perCapitaCents;
}

const _tasterRankingRecords = <_TasterRankingRecord>[
  _TasterRankingRecord(
    name: '许品鉴师',
    totalSalesCents: 8650000,
    groupAverageCents: 288333,
    perCapitaCents: 86500,
  ),
  _TasterRankingRecord(
    name: '陈品鉴师',
    totalSalesCents: 7326000,
    groupAverageCents: 305250,
    perCapitaCents: 69800,
  ),
  _TasterRankingRecord(
    name: '周品鉴师',
    totalSalesCents: 5988000,
    groupAverageCents: 230308,
    perCapitaCents: 74850,
  ),
  _TasterRankingRecord(
    name: '赵品鉴师',
    totalSalesCents: 4421000,
    groupAverageCents: 315786,
    perCapitaCents: 63157,
  ),
];

class _RankingBar extends StatelessWidget {
  const _RankingBar({
    required this.name,
    required this.value,
    required this.sales,
    required this.rank,
  });

  final String name;
  final double value;
  final String sales;
  final int rank;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          SizedBox(
            width: 34,
            child: CircleAvatar(
              radius: 14,
              backgroundColor: rank <= 3
                  ? scheme.secondary.withValues(alpha: 0.18)
                  : scheme.surfaceContainerHighest,
              child: Text('$rank',
                  style: const TextStyle(fontWeight: FontWeight.w800)),
            ),
          ),
          const SizedBox(width: 10),
          SizedBox(
              width: 88, child: Text(name, overflow: TextOverflow.ellipsis)),
          Expanded(
            child: ClipRRect(
              borderRadius: const BorderRadius.all(Radius.circular(999)),
              child: LinearProgressIndicator(
                value: value,
                minHeight: 10,
                backgroundColor: scheme.surfaceContainerHighest,
              ),
            ),
          ),
          const SizedBox(width: 10),
          SizedBox(
            width: 104,
            child: Text(
              sales,
              textAlign: TextAlign.right,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ),
        ],
      ),
    );
  }
}
