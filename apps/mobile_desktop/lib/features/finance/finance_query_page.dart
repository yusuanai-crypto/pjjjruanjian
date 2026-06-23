import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../shared/widgets/app_record_list.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/money_text.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/status_tag.dart';

class FinanceQueryPage extends StatefulWidget {
  const FinanceQueryPage({super.key});

  @override
  State<FinanceQueryPage> createState() => _FinanceQueryPageState();
}

class _FinanceQueryPageState extends State<FinanceQueryPage> {
  DateTime _start = DateTime(2026, 6, 1);
  DateTime _end = DateTime(2026, 6, 22);
  String _filter = '订单金额';
  bool _invoiceIssued = false;

  @override
  Widget build(BuildContext context) {
    return ResponsivePage(
      children: [
        Row(
          children: [
            Expanded(
              child: AppDateRangeButton(
                start: _start,
                end: _end,
                onChanged: (range) => setState(() {
                  _start = range.start;
                  _end = range.end;
                }),
              ),
            ),
          ],
        ),
        MetricGrid(
          metrics: [
            MetricData(label: '出单销售额', value: formatMoneyCents(38265000), icon: Icons.trending_up_rounded),
            MetricData(label: '退单金额', value: formatMoneyCents(2180000), icon: Icons.assignment_return_rounded),
            MetricData(label: '物流费用', value: formatMoneyCents(965300), icon: Icons.local_shipping_rounded),
            const MetricData(label: '待标记客户', value: '36', icon: Icons.verified_user_rounded),
          ],
        ),
        ResponsiveTwoColumn(
          primary: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const AppSearchField(hintText: '搜索订单号、客户、旅行团'),
              const SizedBox(height: 12),
              AppFilterBar(
                filters: const ['订单金额', '退款退单', '物流费用', '标记信息', '提成核对'],
                selected: _filter,
                onSelected: (value) => setState(() => _filter = value),
              ),
              const SizedBox(height: 12),
              const AppRecordList(
                items: [
                  AppRecordItem(
                    title: 'SO-20260622-031',
                    subtitle: '王女士 · GZ-0622-018',
                    meta: ['邮寄', '运费待填'],
                    icon: Icons.receipt_long_rounded,
                    trailing: MoneyText(cents: 647800),
                  ),
                  AppRecordItem(
                    title: 'SO-20260622-024',
                    subtitle: '陈先生 · GZ-0622-016',
                    meta: ['已开票', '已标记'],
                    icon: Icons.receipt_long_rounded,
                    trailing: MoneyText(cents: 1299000),
                  ),
                  AppRecordItem(
                    title: 'AS-20260621-008',
                    subtitle: '退款 · 李女士',
                    meta: ['已完成'],
                    icon: Icons.assignment_return_rounded,
                    trailing: MoneyText(cents: -68000),
                  ),
                ],
              ),
            ],
          ),
          secondary: FormSection(
            title: '财务维护',
            children: [
              const TextField(
                readOnly: true,
                decoration: InputDecoration(labelText: '当前单号', hintText: 'SO-20260622-031'),
              ),
              const SizedBox(height: 12),
              const TextField(decoration: InputDecoration(labelText: '物流单号')),
              const SizedBox(height: 12),
              const TextField(
                keyboardType: TextInputType.number,
                decoration: InputDecoration(labelText: '运费（分）'),
              ),
              const SizedBox(height: 12),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: _invoiceIssued,
                onChanged: (value) => setState(() => _invoiceIssued = value),
                title: const Text('是否已开票'),
              ),
              const SizedBox(height: 8),
              const Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  StatusTag(label: '客户未标记', tone: StatusTone.warning),
                  StatusTag(label: '旅行团已标记', tone: StatusTone.success),
                ],
              ),
              const SizedBox(height: 14),
              SectionActions(
                primaryLabel: '保存维护',
                secondaryLabel: '查看日志',
                onPrimaryPressed: () {},
                onSecondaryPressed: () {},
              ),
            ],
          ),
        ),
      ],
    );
  }
}
