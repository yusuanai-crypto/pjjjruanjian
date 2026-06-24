import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../shared/widgets/app_record_list.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/money_text.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/status_tag.dart';

class AfterSalesFormPage extends StatefulWidget {
  const AfterSalesFormPage({super.key});

  @override
  State<AfterSalesFormPage> createState() => _AfterSalesFormPageState();
}

class _AfterSalesFormPageState extends State<AfterSalesFormPage> {
  AfterSalesStatus _status = AfterSalesStatus.negotiating;
  String _filter = '处理中';
  bool _showHideMarkInfoAction = true;

  @override
  Widget build(BuildContext context) {
    return ResponsivePage(
      children: [
        ResponsiveTwoColumn(
          primary: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const AppSearchField(hintText: '按姓名、电话、单号查询订单'),
              const SizedBox(height: 12),
              AppFilterBar(
                filters: const ['处理中', '待收货', '待退款', '已完成'],
                selected: _filter,
                onSelected: (value) => setState(() => _filter = value),
              ),
              const SizedBox(height: 12),
              const AppRecordList(
                items: [
                  AppRecordItem(
                    title: 'SO-20260622-031',
                    subtitle: '王女士 · 138****6621',
                    meta: ['订单金额 ¥6,478.00', '邮寄'],
                    icon: Icons.receipt_long_rounded,
                    trailing: StatusTag(label: '可开售后', tone: StatusTone.info),
                  ),
                  AppRecordItem(
                    title: 'AS-20260621-008',
                    subtitle: '李女士 · 退款',
                    meta: ['关联 SO-20260620-018'],
                    icon: Icons.support_agent_rounded,
                    trailing: StatusTag(label: '待退款', tone: StatusTone.warning),
                  ),
                  AppRecordItem(
                    title: 'AS-20260620-004',
                    subtitle: '张先生 · 补发',
                    meta: ['已完成'],
                    icon: Icons.support_agent_rounded,
                    trailing: StatusTag(label: '已完成', tone: StatusTone.success),
                  ),
                ],
              ),
            ],
          ),
          secondary: FormSection(
            title: '售后开单',
            trailing: _showHideMarkInfoAction
                ? OutlinedButton.icon(
                    onPressed: () =>
                        setState(() => _showHideMarkInfoAction = false),
                    icon: const Icon(Icons.visibility_off_rounded),
                    label: const Text('隐藏标记信息'),
                  )
                : null,
            children: [
              const TextField(
                readOnly: true,
                decoration: InputDecoration(
                    labelText: '关联订单', hintText: 'SO-20260622-031'),
              ),
              const SizedBox(height: 12),
              ResponsiveFormGrid(
                children: [
                  const TextField(
                      decoration: InputDecoration(labelText: '问题类型')),
                  DropdownButtonFormField<AfterSalesStatus>(
                    initialValue: _status,
                    decoration: const InputDecoration(labelText: '售后状态'),
                    items: [
                      for (final status in AfterSalesStatus.values)
                        DropdownMenuItem(
                            value: status, child: Text(status.label)),
                    ],
                    onChanged: (value) {
                      if (value != null) {
                        setState(() => _status = value);
                      }
                    },
                  ),
                  const TextField(
                    keyboardType: TextInputType.number,
                    decoration: InputDecoration(labelText: '退款金额（分）'),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              const TextField(
                  maxLines: 5,
                  decoration: InputDecoration(labelText: '问题描述和处理内容')),
              const SizedBox(height: 12),
              const Row(
                children: [
                  Expanded(child: Text('原订单金额')),
                  MoneyText(cents: 647800),
                ],
              ),
              const SizedBox(height: 14),
              SectionActions(
                primaryLabel: '创建售后单',
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
