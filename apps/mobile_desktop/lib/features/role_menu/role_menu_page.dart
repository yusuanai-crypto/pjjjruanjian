import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../app/destinations.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/status_tag.dart';

class RoleMenuPage extends StatelessWidget {
  const RoleMenuPage({
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
    return ResponsivePage(
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '当前角色：${role.label}',
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final destination in allowedDestinations)
                      ActionChip(
                        avatar: Icon(destination.icon,
                            size: 18, color: Colors.black87),
                        labelStyle: const TextStyle(color: Colors.black87),
                        label: Text(destination.label),
                        onPressed: () => onOpenDestination(destination.id),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ),
        LayoutBuilder(
          builder: (context, constraints) {
            final columns = constraints.maxWidth >= 1050 ? 2 : 1;
            const spacing = 12.0;
            final width =
                (constraints.maxWidth - spacing * (columns - 1)) / columns;
            return Wrap(
              spacing: spacing,
              runSpacing: spacing,
              children: [
                for (final definition in roleDefinitions)
                  SizedBox(
                    width: width,
                    child: _RoleCard(definition: definition),
                  ),
              ],
            );
          },
        ),
      ],
    );
  }
}

class _RoleCard extends StatelessWidget {
  const _RoleCard({required this.definition});

  final RoleDefinition definition;

  @override
  Widget build(BuildContext context) {
    final destinations = destinationsForRole(definition.role);
    const smallTextStyle = TextStyle(color: Colors.black87);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    definition.role.label,
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                ),
                StatusTag(
                    label: '${destinations.length} 个入口', tone: StatusTone.info),
              ],
            ),
            const SizedBox(height: 6),
            Text(definition.description, style: smallTextStyle),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final destination in destinations)
                  Chip(
                    avatar: Icon(destination.icon, size: 17),
                    label: Text(destination.label, style: smallTextStyle),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
