import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/money_text.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/status_tag.dart';

class OrderFormPage extends StatefulWidget {
  const OrderFormPage({super.key});

  @override
  State<OrderFormPage> createState() => _OrderFormPageState();
}

class _OrderFormPageState extends State<OrderFormPage> {
  DeliveryType _deliveryType = DeliveryType.shipping;
  bool _cashOnDelivery = false;
  bool _invoiceRequired = false;

  @override
  Widget build(BuildContext context) {
    return ResponsivePage(
      children: [
        ResponsiveTwoColumn(
          primary: Column(
            children: [
              const FormSection(
                title: '客户信息',
                children: [
                  ResponsiveFormGrid(
                    children: [
                      TextField(decoration: InputDecoration(labelText: '客户姓名')),
                      TextField(
                        keyboardType: TextInputType.phone,
                        decoration: InputDecoration(labelText: '电话'),
                      ),
                      TextField(decoration: InputDecoration(labelText: '地址')),
                      TextField(decoration: InputDecoration(labelText: '关联旅行团')),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 16),
              FormSection(
                title: '订单信息',
                children: [
                  const ResponsiveFormGrid(
                    children: [
                      TextField(decoration: InputDecoration(labelText: '订单日期')),
                      TextField(decoration: InputDecoration(labelText: '销售人员')),
                      TextField(decoration: InputDecoration(labelText: '销售单号')),
                      TextField(decoration: InputDecoration(labelText: '订单状态')),
                    ],
                  ),
                  const SizedBox(height: 12),
                  const _OrderItemsEditor(),
                  const SizedBox(height: 12),
                  ResponsiveFormGrid(
                    children: [
                      DropdownButtonFormField<DeliveryType>(
                        initialValue: _deliveryType,
                        decoration: const InputDecoration(labelText: '配送选择'),
                        items: [
                          for (final type in DeliveryType.values)
                            DropdownMenuItem(value: type, child: Text(type.label)),
                        ],
                        onChanged: (value) {
                          if (value != null) {
                            setState(() => _deliveryType = value);
                          }
                        },
                      ),
                      SwitchListTile(
                        value: _cashOnDelivery,
                        onChanged: (value) => setState(() => _cashOnDelivery = value),
                        title: const Text('货到付款'),
                        contentPadding: EdgeInsets.zero,
                      ),
                      SwitchListTile(
                        value: _invoiceRequired,
                        onChanged: (value) => setState(() => _invoiceRequired = value),
                        title: const Text('需要开票'),
                        contentPadding: EdgeInsets.zero,
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  SectionActions(
                    primaryLabel: '保存订单',
                    secondaryLabel: '暂存',
                    onPrimaryPressed: () {},
                    onSecondaryPressed: () {},
                  ),
                ],
              ),
            ],
          ),
          secondary: const _OrderSummary(),
        ),
      ],
    );
  }
}

class _OrderItemsEditor extends StatelessWidget {
  const _OrderItemsEditor();

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '酒品明细',
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800),
                  ),
                ),
                TextButton.icon(
                  onPressed: () {},
                  icon: const Icon(Icons.add_rounded),
                  label: const Text('添加'),
                ),
              ],
            ),
            const Divider(),
            const _ItemRow(name: '酱香珍藏 53°', quantity: 2, unitPriceCents: 129900),
            const _ItemRow(name: '年份礼盒', quantity: 1, unitPriceCents: 388000),
          ],
        ),
      ),
    );
  }
}

class _ItemRow extends StatelessWidget {
  const _ItemRow({
    required this.name,
    required this.quantity,
    required this.unitPriceCents,
  });

  final String name;
  final int quantity;
  final int unitPriceCents;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Expanded(child: Text(name, style: const TextStyle(fontWeight: FontWeight.w700))),
          Text('x$quantity'),
          const SizedBox(width: 16),
          MoneyText(cents: unitPriceCents * quantity),
        ],
      ),
    );
  }
}

class _OrderSummary extends StatelessWidget {
  const _OrderSummary();

  @override
  Widget build(BuildContext context) {
    return const FormSection(
      title: '订单核对',
      children: [
        Row(
          children: [
            Expanded(child: Text('系统单号')),
            Text('SO-20260622-031'),
          ],
        ),
        SizedBox(height: 10),
        Row(
          children: [
            Expanded(child: Text('客户')),
            Text('王女士 138****6621'),
          ],
        ),
        SizedBox(height: 10),
        Row(
          children: [
            Expanded(child: Text('旅行团')),
            Text('GZ-0622-018'),
          ],
        ),
        Divider(height: 24),
        Row(
          children: [
            Expanded(child: Text('订单合计')),
            MoneyText(cents: 647800, prominent: true),
          ],
        ),
        SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            StatusTag(label: '邮寄', tone: StatusTone.info),
            StatusTag(label: '待打包', tone: StatusTone.warning),
            StatusTag(label: '未标记', tone: StatusTone.neutral),
          ],
        ),
      ],
    );
  }
}
