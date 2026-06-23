import 'package:flutter/material.dart';

import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/money_text.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/status_tag.dart';

class QrSalesSheetPage extends StatelessWidget {
  const QrSalesSheetPage({super.key});

  @override
  Widget build(BuildContext context) {
    return ResponsivePage(
      children: [
        ResponsiveTwoColumn(
          primary: const _SalesSheetPreview(),
          secondary: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const AppSearchField(hintText: '输入订单号、客户电话、销售单号'),
              const SizedBox(height: 12),
              FormSection(
                title: '销售单设置',
                children: [
                  const TextField(decoration: InputDecoration(labelText: '订单号')),
                  const SizedBox(height: 12),
                  const TextField(decoration: InputDecoration(labelText: '二维码有效期')),
                  const SizedBox(height: 12),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    value: true,
                    onChanged: (_) {},
                    title: const Text('显示客户电话'),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    value: true,
                    onChanged: (_) {},
                    title: const Text('显示订单明细'),
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    children: [
                      FilledButton.icon(
                        onPressed: () {},
                        icon: const Icon(Icons.qr_code_2_rounded),
                        label: const Text('生成二维码'),
                      ),
                      OutlinedButton.icon(
                        onPressed: () {},
                        icon: const Icon(Icons.download_rounded),
                        label: const Text('保存图片'),
                      ),
                    ],
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

class _SalesSheetPreview extends StatelessWidget {
  const _SalesSheetPreview();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '贵州酱酒馆销售单',
                        style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w900),
                      ),
                      const SizedBox(height: 6),
                      Text('SO-20260622-031', style: Theme.of(context).textTheme.titleSmall),
                    ],
                  ),
                ),
                const StatusTag(label: '可扫码', tone: StatusTone.success),
              ],
            ),
            const SizedBox(height: 18),
            ResponsiveTwoColumn(
              breakpoint: 760,
              primary: const Column(
                children: [
                  _InfoRow(label: '客户', value: '王女士 138****6621'),
                  _InfoRow(label: '销售', value: '陈销售'),
                  _InfoRow(label: '旅行团', value: 'GZ-0622-018'),
                  _InfoRow(label: '配送', value: '邮寄 · 货到付款否'),
                  Divider(height: 24),
                  _InfoRow(label: '酱香珍藏 53°', value: '2 瓶'),
                  _InfoRow(label: '年份礼盒', value: '1 盒'),
                ],
              ),
              secondary: Column(
                children: [
                  _QrPlaceholder(color: scheme.primary),
                  const SizedBox(height: 12),
                  const MoneyText(cents: 647800, prominent: true),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.label,
    required this.value,
  });

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        children: [
          SizedBox(
            width: 108,
            child: Text(label, style: Theme.of(context).textTheme.bodyMedium),
          ),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}

class _QrPlaceholder extends StatelessWidget {
  const _QrPlaceholder({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 1,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: const BorderRadius.all(Radius.circular(8)),
          border: Border.all(color: color.withValues(alpha: 0.4)),
        ),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: GridView.builder(
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 9),
            itemCount: 81,
            itemBuilder: (context, index) {
              final active = index % 2 == 0 || index % 7 == 0 || index == 12 || index == 68;
              return Padding(
                padding: const EdgeInsets.all(1.4),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: active ? color : Colors.transparent,
                    borderRadius: const BorderRadius.all(Radius.circular(2)),
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}
