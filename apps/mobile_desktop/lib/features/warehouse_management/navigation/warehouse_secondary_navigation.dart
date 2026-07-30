import 'package:flutter/material.dart';

class WarehouseNavigationItem {
  const WarehouseNavigationItem({
    required this.id,
    required this.label,
    required this.icon,
  });

  final String id;
  final String label;
  final IconData icon;
}

class WarehouseNavigationGroup {
  const WarehouseNavigationGroup({
    required this.id,
    required this.label,
    required this.items,
  });

  final String id;
  final String label;
  final List<WarehouseNavigationItem> items;
}

class WarehouseSecondaryNavigation extends StatelessWidget {
  const WarehouseSecondaryNavigation({
    super.key,
    required this.groups,
    required this.selectedId,
    required this.onSelected,
    required this.wide,
  });

  final List<WarehouseNavigationGroup> groups;
  final String selectedId;
  final ValueChanged<String> onSelected;
  final bool wide;

  @override
  Widget build(BuildContext context) {
    if (wide) {
      return _WideNavigation(
        groups: groups,
        selectedId: selectedId,
        onSelected: onSelected,
      );
    }
    return _CompactNavigation(
      groups: groups,
      selectedId: selectedId,
      onSelected: onSelected,
    );
  }
}

class _WideNavigation extends StatelessWidget {
  const _WideNavigation({
    required this.groups,
    required this.selectedId,
    required this.onSelected,
  });

  final List<WarehouseNavigationGroup> groups;
  final String selectedId;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    return Material(
      key: const ValueKey('warehouse-secondary-navigation-wide'),
      color: Theme.of(context).colorScheme.surfaceContainerLow,
      borderRadius: BorderRadius.circular(12),
      clipBehavior: Clip.antiAlias,
      child: SizedBox(
        width: 224,
        child: ListView(
          padding: const EdgeInsets.symmetric(vertical: 8),
          children: [
            for (final group in groups) ...[
              Padding(
                key: ValueKey('warehouse-nav-group-${group.id}'),
                padding: const EdgeInsets.fromLTRB(16, 14, 12, 5),
                child: Text(
                  group.label,
                  style: Theme.of(context).textTheme.labelMedium?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                        fontWeight: FontWeight.w700,
                      ),
                ),
              ),
              for (final item in group.items)
                ListTile(
                  key: ValueKey('warehouse-module-${item.id}'),
                  dense: true,
                  selected: item.id == selectedId,
                  leading: Icon(item.icon, size: 20),
                  title: Text(item.label),
                  onTap: () => onSelected(item.id),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _CompactNavigation extends StatelessWidget {
  const _CompactNavigation({
    required this.groups,
    required this.selectedId,
    required this.onSelected,
  });

  final List<WarehouseNavigationGroup> groups;
  final String selectedId;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    final item = groups
        .expand((group) => group.items)
        .firstWhere((candidate) => candidate.id == selectedId);
    return Material(
      key: const ValueKey('warehouse-secondary-navigation-compact'),
      color: Theme.of(context).colorScheme.surfaceContainerLow,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        key: const ValueKey('warehouse-module-selector-button'),
        borderRadius: BorderRadius.circular(10),
        onTap: () => _showPicker(context),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              Icon(item.icon, size: 20),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  item.label,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ),
              const Text('切换模块'),
              const SizedBox(width: 4),
              const Icon(Icons.expand_more_rounded),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _showPicker(BuildContext context) async {
    final selected = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (sheetContext) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(sheetContext).height * 0.82,
          ),
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.only(bottom: 12),
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
                child: Text(
                  '选择仓库管理模块',
                  style: Theme.of(sheetContext)
                      .textTheme
                      .titleLarge
                      ?.copyWith(fontWeight: FontWeight.w700),
                ),
              ),
              for (final group in groups) ...[
                Padding(
                  key: ValueKey('warehouse-nav-group-${group.id}'),
                  padding: const EdgeInsets.fromLTRB(20, 14, 20, 4),
                  child: Text(
                    group.label,
                    style:
                        Theme.of(sheetContext).textTheme.labelLarge?.copyWith(
                              color: Theme.of(sheetContext).colorScheme.primary,
                              fontWeight: FontWeight.w700,
                            ),
                  ),
                ),
                for (final item in group.items)
                  ListTile(
                    key: ValueKey('warehouse-module-${item.id}'),
                    selected: item.id == selectedId,
                    leading: Icon(item.icon),
                    title: Text(item.label),
                    trailing: item.id == selectedId
                        ? const Icon(Icons.check_rounded)
                        : null,
                    onTap: () => Navigator.pop(sheetContext, item.id),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
    if (selected != null) onSelected(selected);
  }
}
