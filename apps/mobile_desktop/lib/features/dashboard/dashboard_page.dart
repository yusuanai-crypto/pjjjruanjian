import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../app/destinations.dart';
import '../../shared/widgets/app_record_list.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/status_tag.dart';

class DashboardPage extends StatelessWidget {
  const DashboardPage({
    super.key,
    required this.role,
    required this.allowedDestinations,
    required this.onOpenDestination,
  });

  final UserRole role;
  final List<AppDestination> allowedDestinations;
  final ValueChanged<String> onOpenDestination;

  @override
  Widget build(BuildContext context) {
    final destinations = allowedDestinations.where((item) => item.id != 'dashboard').toList();
    return ResponsivePage(
      children: [
        MetricGrid(
          metrics: [
            const MetricData(label: '今日接待团数', value: '12', icon: Icons.directions_bus_rounded),
            MetricData(label: '今日销售额', value: formatMoneyCents(865000), icon: Icons.payments_rounded),
            const MetricData(label: '待打包订单', value: '18', icon: Icons.inventory_2_rounded),
            const MetricData(label: '待处理售后', value: '4', icon: Icons.support_agent_rounded),
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
                    '${role.label}工作入口',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 12),
                  LayoutBuilder(
                    builder: (context, constraints) {
                      final columns = constraints.maxWidth >= 680 ? 3 : 1;
                      const spacing = 12.0;
                      final width = (constraints.maxWidth - spacing * (columns - 1)) / columns;
                      return Wrap(
                        spacing: spacing,
                        runSpacing: spacing,
                        children: [
                          for (final destination in destinations)
                            SizedBox(
                              width: width,
                              child: _ActionTile(
                                destination: destination,
                                onTap: () => onOpenDestination(destination.id),
                              ),
                            ),
                        ],
                      );
                    },
                  ),
                ],
              ),
            ),
          ),
          secondary: const AppRecordList(
            compact: true,
            items: [
              AppRecordItem(
                title: 'GZ-0622-018',
                subtitle: '黔程旅行社 · 待总结',
                icon: Icons.rate_review_rounded,
                trailing: StatusTag(label: '待总结', tone: StatusTone.warning),
              ),
              AppRecordItem(
                title: 'SO-20260622-031',
                subtitle: '王女士 · 邮寄',
                icon: Icons.receipt_long_rounded,
                trailing: StatusTag(label: '待打包', tone: StatusTone.info),
              ),
              AppRecordItem(
                title: 'AS-20260622-004',
                subtitle: '物流破损 · 待补发',
                icon: Icons.support_agent_rounded,
                trailing: StatusTag(label: '待补发', tone: StatusTone.danger),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({
    required this.destination,
    required this.onTap,
  });

  final AppDestination destination;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: InkWell(
        borderRadius: const BorderRadius.all(Radius.circular(8)),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              DecoratedBox(
                decoration: BoxDecoration(
                  color: scheme.primary.withValues(alpha: 0.1),
                  borderRadius: const BorderRadius.all(Radius.circular(8)),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: Icon(destination.icon, color: scheme.primary),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(destination.label, style: const TextStyle(fontWeight: FontWeight.w800)),
                    Text('第 ${destination.phase} 阶段', style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded),
            ],
          ),
        ),
      ),
    );
  }
}
