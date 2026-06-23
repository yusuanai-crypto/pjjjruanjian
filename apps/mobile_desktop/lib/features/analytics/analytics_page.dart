import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../shared/widgets/app_record_list.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/status_tag.dart';

class AnalyticsPage extends StatefulWidget {
  const AnalyticsPage({super.key});

  @override
  State<AnalyticsPage> createState() => _AnalyticsPageState();
}

class _AnalyticsPageState extends State<AnalyticsPage> {
  String _preset = '本月';
  DateTime _start = DateTime(2026, 6, 1);
  DateTime _end = DateTime(2026, 6, 22);

  @override
  Widget build(BuildContext context) {
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
              }),
            ),
            AppFilterBar(
              filters: datePresetLabels,
              selected: _preset,
              onSelected: (value) => setState(() => _preset = value),
            ),
          ],
        ),
        MetricGrid(
          metrics: [
            MetricData(label: '出单销售额', value: formatMoneyCents(38265000), icon: Icons.trending_up_rounded),
            MetricData(label: '退单销售额', value: formatMoneyCents(2180000), icon: Icons.assignment_return_rounded),
            const MetricData(label: '总接待团数', value: '286', icon: Icons.directions_bus_rounded),
            const MetricData(label: '打蛋率', value: '18.6%', icon: Icons.pie_chart_rounded),
            const MetricData(label: '总接待人数', value: '8,920', icon: Icons.groups_rounded),
            MetricData(label: '团均销售额', value: formatMoneyCents(133794), icon: Icons.stacked_line_chart_rounded),
            MetricData(label: '人均销售额', value: formatMoneyCents(4289), icon: Icons.person_rounded),
            const MetricData(label: '有效订单数', value: '418', icon: Icons.receipt_long_rounded),
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
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 16),
                  const _RankingBar(name: '许品鉴师', value: 0.92, sales: '¥86,500.00', rank: 1),
                  const _RankingBar(name: '陈品鉴师', value: 0.78, sales: '¥73,260.00', rank: 2),
                  const _RankingBar(name: '周品鉴师', value: 0.64, sales: '¥59,880.00', rank: 3),
                  const _RankingBar(name: '赵品鉴师', value: 0.48, sales: '¥44,210.00', rank: 4),
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
}

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
              backgroundColor: rank <= 3 ? scheme.secondary.withValues(alpha: 0.18) : scheme.surfaceContainerHighest,
              child: Text('$rank', style: const TextStyle(fontWeight: FontWeight.w800)),
            ),
          ),
          const SizedBox(width: 10),
          SizedBox(width: 88, child: Text(name, overflow: TextOverflow.ellipsis)),
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
