import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../shared/widgets/app_record_list.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/status_tag.dart';

class TravelGroupFormPage extends StatefulWidget {
  const TravelGroupFormPage({super.key});

  @override
  State<TravelGroupFormPage> createState() => _TravelGroupFormPageState();
}

class _TravelGroupFormPageState extends State<TravelGroupFormPage> {
  DateTime _visitDate = DateTime(2026, 6, 22);
  String _groupType = groupTypes.first;
  String _selectedFilter = '今日';

  @override
  Widget build(BuildContext context) {
    return ResponsivePage(
      children: [
        ResponsiveTwoColumn(
          primary: Column(
            children: [
              FormSection(
                title: '旅行团基础信息',
                children: [
                  ResponsiveFormGrid(
                    children: [
                      const TextField(decoration: InputDecoration(labelText: '团号')),
                      _DateField(
                        label: '日期',
                        value: _visitDate,
                        onTap: () async {
                          final result = await showDatePicker(
                            context: context,
                            initialDate: _visitDate,
                            firstDate: DateTime(2024),
                            lastDate: DateTime(2030),
                          );
                          if (result != null) {
                            setState(() => _visitDate = result);
                          }
                        },
                      ),
                      const TextField(decoration: InputDecoration(labelText: '旅行社')),
                      const TextField(decoration: InputDecoration(labelText: '车牌号')),
                      const TextField(decoration: InputDecoration(labelText: '导游')),
                      const TextField(decoration: InputDecoration(labelText: '导游电话')),
                      const TextField(
                        keyboardType: TextInputType.number,
                        decoration: InputDecoration(labelText: '人数'),
                      ),
                      const TextField(decoration: InputDecoration(labelText: '品鉴馆馆号')),
                      const TextField(decoration: InputDecoration(labelText: '品鉴师')),
                      const TextField(decoration: InputDecoration(labelText: '进店时间')),
                      DropdownButtonFormField<String>(
                        initialValue: _groupType,
                        decoration: const InputDecoration(labelText: '团型'),
                        items: [
                          for (final type in groupTypes)
                            DropdownMenuItem(value: type, child: Text(type)),
                        ],
                        onChanged: (value) {
                          if (value != null) {
                            setState(() => _groupType = value);
                          }
                        },
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 16),
              FormSection(
                title: '接待补充信息',
                children: [
                  const TextField(
                    maxLines: 3,
                    decoration: InputDecoration(labelText: '品酒种类和瓶数'),
                  ),
                  const SizedBox(height: 12),
                  const ResponsiveFormGrid(
                    children: [
                      TextField(decoration: InputDecoration(labelText: '离店时间')),
                      TextField(decoration: InputDecoration(labelText: '备注')),
                    ],
                  ),
                  const SizedBox(height: 14),
                  SectionActions(
                    primaryLabel: '保存旅行团',
                    secondaryLabel: '清空',
                    onPrimaryPressed: () {},
                    onSecondaryPressed: () {},
                  ),
                ],
              ),
            ],
          ),
          secondary: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const AppSearchField(hintText: '搜索团号、旅行社、导游'),
              const SizedBox(height: 12),
              AppFilterBar(
                filters: const ['今日', '未标记', '待总结', '已出单'],
                selected: _selectedFilter,
                onSelected: (value) => setState(() => _selectedFilter = value),
              ),
              const SizedBox(height: 12),
              const AppRecordList(
                items: [
                  AppRecordItem(
                    title: 'GZ-0622-018',
                    subtitle: '黔程旅行社 · 李导 · 32 人',
                    meta: ['KB团', '09:30 进店'],
                    icon: Icons.directions_bus_rounded,
                    trailing: StatusTag(label: '待总结', tone: StatusTone.warning),
                  ),
                  AppRecordItem(
                    title: 'GZ-0622-016',
                    subtitle: '山水国旅 · 周导 · 28 人',
                    meta: ['渠道团', '已标记'],
                    icon: Icons.directions_bus_rounded,
                    trailing: StatusTag(label: '已出单', tone: StatusTone.success),
                  ),
                  AppRecordItem(
                    title: 'GZ-0622-011',
                    subtitle: '黔北旅行社 · 赵导 · 19 人',
                    meta: ['保险团'],
                    icon: Icons.directions_bus_rounded,
                    trailing: StatusTag(label: '未标记', tone: StatusTone.neutral),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _DateField extends StatelessWidget {
  const _DateField({
    required this.label,
    required this.value,
    required this.onTap,
  });

  final String label;
  final DateTime value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      readOnly: true,
      onTap: onTap,
      initialValue: formatDate(value),
      decoration: InputDecoration(
        labelText: label,
        suffixIcon: const Icon(Icons.calendar_month_rounded),
      ),
    );
  }
}
