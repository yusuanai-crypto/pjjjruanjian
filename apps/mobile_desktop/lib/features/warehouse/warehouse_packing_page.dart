import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../shared/widgets/app_record_list.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/status_tag.dart';

class WarehousePackingPage extends StatefulWidget {
  const WarehousePackingPage({super.key});

  @override
  State<WarehousePackingPage> createState() => _WarehousePackingPageState();
}

class _WarehousePackingPageState extends State<WarehousePackingPage> {
  String _filter = '待打包';
  String _logisticsMethod = logisticsMethods.first;
  PackingStatus _packingStatus = PackingStatus.pending;

  @override
  Widget build(BuildContext context) {
    return ResponsivePage(
      children: [
        ResponsiveTwoColumn(
          primary: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const AppSearchField(hintText: '搜索订单号、客户、电话、物流单号'),
              const SizedBox(height: 12),
              AppFilterBar(
                filters: const ['待打包', '打包中', '已打包', '异常'],
                selected: _filter,
                onSelected: (value) => setState(() => _filter = value),
              ),
              const SizedBox(height: 12),
              const AppRecordList(
                items: [
                  AppRecordItem(
                    title: 'SO-20260622-031',
                    subtitle: '王女士 · 贵阳市观山湖区',
                    meta: ['酱香珍藏 x2', '年份礼盒 x1'],
                    icon: Icons.inventory_2_rounded,
                    trailing: StatusTag(label: '待打包', tone: StatusTone.warning),
                  ),
                  AppRecordItem(
                    title: 'SO-20260622-027',
                    subtitle: '刘先生 · 成都市锦江区',
                    meta: ['酱酒礼盒 x3'],
                    icon: Icons.inventory_2_rounded,
                    trailing: StatusTag(label: '打包中', tone: StatusTone.info),
                  ),
                  AppRecordItem(
                    title: 'SO-20260621-044',
                    subtitle: '周女士 · 重庆市渝中区',
                    meta: ['物流单号待财务填写'],
                    icon: Icons.inventory_2_rounded,
                    trailing: StatusTag(label: '异常', tone: StatusTone.danger),
                  ),
                ],
              ),
            ],
          ),
          secondary: FormSection(
            title: '打包处理',
            children: [
              const TextField(
                readOnly: true,
                decoration: InputDecoration(labelText: '当前订单', hintText: 'SO-20260622-031'),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _logisticsMethod,
                decoration: const InputDecoration(labelText: '物流方式'),
                items: [
                  for (final method in logisticsMethods)
                    DropdownMenuItem(value: method, child: Text(method)),
                ],
                onChanged: (value) {
                  if (value != null) {
                    setState(() => _logisticsMethod = value);
                  }
                },
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<PackingStatus>(
                initialValue: _packingStatus,
                decoration: const InputDecoration(labelText: '打包状态'),
                items: [
                  for (final status in PackingStatus.values)
                    DropdownMenuItem(value: status, child: Text(status.label)),
                ],
                onChanged: (value) {
                  if (value != null) {
                    setState(() => _packingStatus = value);
                  }
                },
              ),
              const SizedBox(height: 12),
              const TextField(
                keyboardType: TextInputType.number,
                decoration: InputDecoration(labelText: '打包件数'),
              ),
              const SizedBox(height: 12),
              const TextField(maxLines: 3, decoration: InputDecoration(labelText: '打包备注')),
              const SizedBox(height: 14),
              SectionActions(
                primaryLabel: '保存打包',
                secondaryLabel: '标记异常',
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
