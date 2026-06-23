import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../app/destinations.dart';
import '../../app/page_factory.dart';
import '../../core/auth/auth_models.dart';
import '../../shared/widgets/responsive.dart';

class AppShell extends StatelessWidget {
  const AppShell({
    super.key,
    required this.role,
    required this.user,
    required this.allowedDestinations,
    required this.selectedDestinationId,
    required this.onDestinationChanged,
    required this.onLogout,
  });

  final UserRole role;
  final AuthUser user;
  final List<AppDestination> allowedDestinations;
  final String selectedDestinationId;
  final ValueChanged<String> onDestinationChanged;
  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
    final destinations = allowedDestinations.isEmpty ? destinationsForRole(role) : allowedDestinations;
    final selectedIndex = destinations.indexWhere((item) => item.id == selectedDestinationId);
    final safeSelectedIndex = selectedIndex < 0 ? 0 : selectedIndex;
    final selectedDestination = destinations[safeSelectedIndex];

    return LayoutBuilder(
      builder: (context, constraints) {
        final desktop = isDesktopWidth(constraints.maxWidth);
        final page = buildPageForDestination(
          destinationId: selectedDestination.id,
          role: role,
          allowedDestinations: destinations,
          onOpenDestination: onDestinationChanged,
        );

        if (desktop) {
          return Scaffold(
            body: Row(
              children: [
                _DesktopSideNav(
                  role: role,
                  destinations: destinations,
                  selectedId: selectedDestination.id,
                  onSelect: onDestinationChanged,
                  onLogout: onLogout,
                ),
                const VerticalDivider(width: 1),
                Expanded(
                  child: Column(
                    children: [
                      _TopBar(
                        title: selectedDestination.label,
                        role: role,
                        user: user,
                        onLogout: onLogout,
                      ),
                      Expanded(child: page),
                    ],
                  ),
                ),
              ],
            ),
          );
        }

        return Scaffold(
          appBar: AppBar(
            title: Text(selectedDestination.label),
            actions: [
              IconButton(
                tooltip: '退出登录',
                onPressed: onLogout,
                icon: const Icon(Icons.logout_rounded),
              ),
            ],
          ),
          drawer: _MobileDrawer(
            user: user,
            destinations: destinations,
            selectedId: selectedDestination.id,
            onSelect: onDestinationChanged,
          ),
          body: page,
        );
      },
    );
  }
}

class _DesktopSideNav extends StatelessWidget {
  const _DesktopSideNav({
    required this.role,
    required this.destinations,
    required this.selectedId,
    required this.onSelect,
    required this.onLogout,
  });

  final UserRole role;
  final List<AppDestination> destinations;
  final String selectedId;
  final ValueChanged<String> onSelect;
  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return SizedBox(
      width: 244,
      child: Material(
        color: Colors.white,
        child: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 16, 18, 12),
                child: Row(
                  children: [
                    DecoratedBox(
                      decoration: BoxDecoration(
                        color: scheme.primary,
                        borderRadius: const BorderRadius.all(Radius.circular(8)),
                      ),
                      child: const Padding(
                        padding: EdgeInsets.all(8),
                        child: Icon(Icons.wine_bar_rounded, color: Colors.white),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '品鉴酱酒中心',
                            style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
                          ),
                          Text(role.label, style: Theme.of(context).textTheme.bodySmall),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  children: [
                    for (final destination in destinations)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 2),
                        child: _NavTile(
                          destination: destination,
                          selected: selectedId == destination.id,
                          onTap: () => onSelect(destination.id),
                        ),
                      ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Padding(
                padding: const EdgeInsets.all(10),
                child: OutlinedButton.icon(
                  onPressed: onLogout,
                  icon: const Icon(Icons.logout_rounded),
                  label: const Text('退出登录'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({
    required this.title,
    required this.role,
    required this.user,
    required this.onLogout,
  });

  final String title;
  final UserRole role;
  final AuthUser user;
  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      child: SafeArea(
        bottom: false,
        child: SizedBox(
          height: 64,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    title,
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
                  ),
                ),
                Chip(
                  avatar: const Icon(Icons.account_circle_rounded, size: 18),
                  label: Text('${user.username} · ${role.label}'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _MobileDrawer extends StatelessWidget {
  const _MobileDrawer({
    required this.user,
    required this.destinations,
    required this.selectedId,
    required this.onSelect,
  });

  final AuthUser user;
  final List<AppDestination> destinations;
  final String selectedId;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    return Drawer(
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                '品鉴酱酒中心 · ${user.username}',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(8),
                children: [
                  for (final destination in destinations)
                    _NavTile(
                      destination: destination,
                      selected: selectedId == destination.id,
                      onTap: () {
                        Navigator.of(context).pop();
                        onSelect(destination.id);
                      },
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NavTile extends StatelessWidget {
  const _NavTile({
    required this.destination,
    required this.selected,
    required this.onTap,
  });

  final AppDestination destination;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListTile(
      selected: selected,
      selectedTileColor: scheme.primary.withValues(alpha: 0.09),
      selectedColor: scheme.primary,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(8))),
      leading: Icon(destination.icon),
      title: Text(destination.label, maxLines: 1, overflow: TextOverflow.ellipsis),
      trailing: Text('P${destination.phase}', style: Theme.of(context).textTheme.labelSmall),
      onTap: onTap,
    );
  }
}
