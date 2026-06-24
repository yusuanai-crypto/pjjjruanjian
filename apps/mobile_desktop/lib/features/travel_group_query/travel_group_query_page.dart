import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../shared/widgets/app_record_list.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/status_tag.dart';

class TravelGroupQueryPage extends StatefulWidget {
  const TravelGroupQueryPage({super.key});

  @override
  State<TravelGroupQueryPage> createState() => _TravelGroupQueryPageState();
}

class _TravelGroupQueryPageState extends State<TravelGroupQueryPage> {
  DateTime _start = DateTime(2026, 6, 1);
  DateTime _end = DateTime(2026, 6, 23);
  String _statusFilter = '全部';
  String _groupTypeFilter = '全部';
  _TravelGroupRecord _selected = _travelGroupRecords.first;
  late final TextEditingController _wineDetailsController;

  @override
  void initState() {
    super.initState();
    _wineDetailsController = TextEditingController(text: _selected.wineDetails);
  }

  @override
  void dispose() {
    _wineDetailsController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final records = _travelGroupRecords.where((record) {
      final statusMatched =
          _statusFilter == '全部' || record.status == _statusFilter;
      final typeMatched =
          _groupTypeFilter == '全部' || record.groupType == _groupTypeFilter;
      return statusMatched && typeMatched;
    }).toList();

    return ResponsivePage(
      children: [
        FormSection(
          title: '查询条件',
          trailing:
              StatusTag(label: '${records.length} 个旅行团', tone: StatusTone.info),
          children: [
            ResponsiveFormGrid(
              children: [
                const AppSearchField(hintText: '搜索团号、旅行社、导游、品鉴师'),
                AppDateRangeButton(
                  start: _start,
                  end: _end,
                  onChanged: (range) => setState(() {
                    _start = range.start;
                    _end = range.end;
                  }),
                ),
                DropdownButtonFormField<String>(
                  initialValue: _groupTypeFilter,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: '团型'),
                  items: [
                    const DropdownMenuItem(value: '全部', child: Text('全部')),
                    for (final type in groupTypes)
                      DropdownMenuItem(value: type, child: Text(type)),
                  ],
                  onChanged: (value) {
                    if (value != null) {
                      setState(() => _groupTypeFilter = value);
                    }
                  },
                ),
              ],
            ),
          ],
        ),
        MetricGrid(
          metrics: [
            MetricData(
                label: '旅行团总数',
                value: '${records.length}',
                icon: Icons.directions_bus_rounded),
            MetricData(
                label: '已出单团数',
                value:
                    '${records.where((item) => item.status == '已出单').length}',
                icon: Icons.receipt_long_rounded),
            MetricData(
                label: '接待人数',
                value:
                    '${records.fold<int>(0, (sum, item) => sum + item.guestCount)}',
                icon: Icons.groups_rounded),
          ],
        ),
        ResponsiveTwoColumn(
          primary: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AppFilterBar(
                filters: const ['全部', '待总结', '已出单', '未出单'],
                selected: _statusFilter,
                onSelected: (value) => setState(() => _statusFilter = value),
              ),
              const SizedBox(height: 12),
              AppRecordList(
                items: [
                  for (final record in records)
                    AppRecordItem(
                      title: record.groupNo,
                      subtitle:
                          '${record.travelAgency} · ${record.guideName} · ${record.guestCount} 人',
                      meta: [
                        record.groupType,
                        record.tasterName,
                        '${record.orderCount} 笔订单'
                      ],
                      icon: Icons.directions_bus_rounded,
                      trailing:
                          StatusTag(label: record.status, tone: record.tone),
                      onTap: () {
                        setState(() {
                          _selected = record;
                          _wineDetailsController.text = record.wineDetails;
                        });
                      },
                    ),
                ],
              ),
            ],
          ),
          secondary: _TravelGroupDetail(
            record: _selected,
            wineDetailsController: _wineDetailsController,
            onSaveWineDetails: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('品酒信息已暂存。')),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _TravelGroupDetail extends StatelessWidget {
  const _TravelGroupDetail({
    required this.record,
    required this.wineDetailsController,
    required this.onSaveWineDetails,
  });

  final _TravelGroupRecord record;
  final TextEditingController wineDetailsController;
  final VoidCallback onSaveWineDetails;

  @override
  Widget build(BuildContext context) {
    return FormSection(
      title: '旅行团详情',
      trailing: StatusTag(label: record.status, tone: record.tone),
      children: [
        _InfoRow(label: '团号', value: record.groupNo),
        _InfoRow(label: '旅行社', value: record.travelAgency),
        _InfoRow(
            label: '导游', value: '${record.guideName} · ${record.guidePhone}'),
        _InfoRow(label: '品鉴师', value: record.tasterName),
        _InfoRow(
            label: '接待信息',
            value:
                '${record.groupType} · ${record.guestCount} 人 · ${record.arrivalTime} 进店'),
        const Divider(height: 24),
        TextField(
          controller: wineDetailsController,
          maxLines: 3,
          decoration: const InputDecoration(labelText: '品酒种类和瓶数'),
        ),
        const SizedBox(height: 12),
        Align(
          alignment: Alignment.centerRight,
          child: FilledButton.icon(
            onPressed: onSaveWineDetails,
            icon: const Icon(Icons.save_rounded),
            label: const Text('保存品酒信息'),
          ),
        ),
        const Divider(height: 24),
        Text('关联订单',
            style: Theme.of(context)
                .textTheme
                .titleSmall
                ?.copyWith(fontWeight: FontWeight.w800)),
        const SizedBox(height: 8),
        for (final order in record.orders)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                Expanded(child: Text(order)),
                const Icon(Icons.chevron_right_rounded, size: 20),
              ],
            ),
          ),
      ],
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

class _TravelGroupRecord {
  const _TravelGroupRecord({
    required this.groupNo,
    required this.travelAgency,
    required this.guideName,
    required this.guidePhone,
    required this.groupType,
    required this.tasterName,
    required this.guestCount,
    required this.arrivalTime,
    required this.status,
    required this.tone,
    required this.wineDetails,
    required this.orderCount,
    required this.orders,
  });

  final String groupNo;
  final String travelAgency;
  final String guideName;
  final String guidePhone;
  final String groupType;
  final String tasterName;
  final int guestCount;
  final String arrivalTime;
  final String status;
  final StatusTone tone;
  final String wineDetails;
  final int orderCount;
  final List<String> orders;
}

const _travelGroupRecords = <_TravelGroupRecord>[
  _TravelGroupRecord(
    groupNo: 'GZ-0622-018',
    travelAgency: '黔程旅行社',
    guideName: '李导',
    guidePhone: '13800006666',
    groupType: 'KB团',
    tasterName: '周品鉴师',
    guestCount: 32,
    arrivalTime: '09:30',
    status: '已出单',
    tone: StatusTone.success,
    wineDetails: '酱香珍藏 53° 2瓶；年份礼盒 1盒',
    orderCount: 2,
    orders: ['SO-20260622-031 · 王女士', 'SO-20260622-032 · 李先生'],
  ),
  _TravelGroupRecord(
    groupNo: 'GZ-0622-016',
    travelAgency: '山水国旅',
    guideName: '周导',
    guidePhone: '13600008888',
    groupType: 'AB团',
    tasterName: '陈品鉴师',
    guestCount: 28,
    arrivalTime: '10:10',
    status: '待总结',
    tone: StatusTone.warning,
    wineDetails: '年份礼盒 1盒',
    orderCount: 1,
    orders: ['SO-20260622-024 · 陈先生'],
  ),
  _TravelGroupRecord(
    groupNo: 'GZ-0622-011',
    travelAgency: '黔北旅行社',
    guideName: '赵导',
    guidePhone: '13700009999',
    groupType: '保险团',
    tasterName: '许品鉴师',
    guestCount: 19,
    arrivalTime: '14:00',
    status: '未出单',
    tone: StatusTone.neutral,
    wineDetails: '',
    orderCount: 0,
    orders: [],
  ),
];
