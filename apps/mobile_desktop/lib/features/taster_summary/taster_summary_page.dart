import 'package:flutter/material.dart';

import '../../shared/widgets/app_record_list.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/status_tag.dart';

class TasterSummaryPage extends StatefulWidget {
  const TasterSummaryPage({super.key});

  @override
  State<TasterSummaryPage> createState() => _TasterSummaryPageState();
}

class _TasterSummaryPageState extends State<TasterSummaryPage> {
  String _filter = '待总结';

  @override
  Widget build(BuildContext context) {
    return ResponsivePage(
      children: [
        ResponsiveTwoColumn(
          primary: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const AppSearchField(hintText: '搜索团号、旅行社、导游'),
              const SizedBox(height: 12),
              AppFilterBar(
                filters: const ['待总结', '已出单', '已提交', '全部'],
                selected: _filter,
                onSelected: (value) => setState(() => _filter = value),
              ),
              const SizedBox(height: 12),
              const AppRecordList(
                items: [
                  AppRecordItem(
                    title: 'GZ-0622-018',
                    subtitle: '黔程旅行社 · 32 人 · 未出单',
                    meta: ['进店 09:30', '离店 11:05'],
                    icon: Icons.directions_bus_rounded,
                    trailing: StatusTag(label: '待总结', tone: StatusTone.warning),
                  ),
                  AppRecordItem(
                    title: 'GZ-0622-016',
                    subtitle: '山水国旅 · 28 人 · 已出单',
                    meta: ['销售额 ¥6,478.00'],
                    icon: Icons.directions_bus_rounded,
                    trailing: StatusTag(label: '可补充', tone: StatusTone.info),
                  ),
                  AppRecordItem(
                    title: 'GZ-0621-028',
                    subtitle: '黔北旅行社 · 24 人 · 未出单',
                    meta: ['已提交总结'],
                    icon: Icons.directions_bus_rounded,
                    trailing: StatusTag(label: '已提交', tone: StatusTone.success),
                  ),
                ],
              ),
            ],
          ),
          secondary: FormSection(
            title: '接待总结',
            children: [
              const TextField(
                readOnly: true,
                decoration: InputDecoration(labelText: '当前旅行团', hintText: 'GZ-0622-018 · 黔程旅行社'),
              ),
              const SizedBox(height: 12),
              const TextField(
                maxLines: 8,
                decoration: InputDecoration(labelText: '总结内容'),
              ),
              const SizedBox(height: 12),
              const Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  StatusTag(label: '未出单必填', tone: StatusTone.warning),
                  StatusTag(label: '本人接待', tone: StatusTone.info),
                ],
              ),
              const SizedBox(height: 14),
              SectionActions(
                primaryLabel: '提交总结',
                secondaryLabel: '保存草稿',
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
