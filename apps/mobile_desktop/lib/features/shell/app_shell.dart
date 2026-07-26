import 'dart:async';

import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../app/destinations.dart';
import '../../app/page_factory.dart';
import '../../core/api/api_client.dart';
import '../../core/auth/auth_models.dart';
import '../travel_group_attachments/attachment_picker_service.dart';
import '../travel_group_attachments/incoming_attachment_service.dart';
import '../todo_reminders/todo_reminder_controller.dart';
import '../../shared/widgets/brand_logo.dart';
import '../../shared/widgets/responsive.dart';

class AppShell extends StatefulWidget {
  const AppShell({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
    required this.user,
    required this.allowedDestinations,
    required this.selectedDestinationId,
    required this.onDestinationChanged,
    required this.onLogout,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;
  final AuthUser user;
  final List<AppDestination> allowedDestinations;
  final String selectedDestinationId;
  final ValueChanged<String> onDestinationChanged;
  final VoidCallback onLogout;

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> with WidgetsBindingObserver {
  late final TodoReminderController _todoReminderController;
  late final AttachmentPickerService _attachmentPickerService;
  late final IncomingAttachmentService _incomingAttachmentService;

  ApiClient get apiClient => widget.apiClient;
  String get token => widget.token;
  UserRole get role => widget.role;
  AuthUser get user => widget.user;
  List<AppDestination> get allowedDestinations => widget.allowedDestinations;
  String get selectedDestinationId => widget.selectedDestinationId;
  ValueChanged<String> get onDestinationChanged => widget.onDestinationChanged;
  VoidCallback get onLogout => _logout;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _todoReminderController = TodoReminderController(
      apiClient: widget.apiClient,
      token: widget.token,
      userId: widget.user.id,
    );
    _attachmentPickerService = AttachmentPickerService();
    _incomingAttachmentService = IncomingAttachmentService.instance;
    _incomingAttachmentService.addListener(_onIncomingAttachmentsChanged);
    unawaited(_initializeTodoReminders());
    unawaited(_initializeIncomingAttachments());
  }

  Future<void> _initializeIncomingAttachments() async {
    await _incomingAttachmentService.initialize();
    try {
      final recovered =
          await _attachmentPickerService.retrieveLostPhotoSelection();
      if (recovered.files.isNotEmpty) {
        _incomingAttachmentService.addRecoveredPhotos(
          recovered.files,
          coldStart: true,
        );
      }
    } catch (_) {
      // A later gallery selection can retry; startup must remain usable.
    }
  }

  void _onIncomingAttachmentsChanged() {
    if (mounted) {
      setState(() {});
    }
  }

  Future<void> _initializeTodoReminders() async {
    try {
      await _todoReminderController.initialize((_) {
        widget.onDestinationChanged('todo_reminders');
        unawaited(_todoReminderController.sync(silent: true));
      });
    } catch (_) {
      await _todoReminderController.sync(silent: true);
    }
  }

  Future<void> _logout() async {
    await _todoReminderController.cancelAllForUser();
    widget.onLogout();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_todoReminderController.onResumed());
      unawaited(_incomingAttachmentService.refresh());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _incomingAttachmentService.removeListener(_onIncomingAttachmentsChanged);
    _todoReminderController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final destinations = allowedDestinations.isEmpty
        ? destinationsForRole(role)
        : allowedDestinations;
    final selectedIndex =
        destinations.indexWhere((item) => item.id == selectedDestinationId);
    final safeSelectedIndex = selectedIndex < 0 ? 0 : selectedIndex;
    final selectedDestination = destinations[safeSelectedIndex];

    return LayoutBuilder(
      builder: (context, constraints) {
        final desktop = isDesktopWidth(constraints.maxWidth);
        final page = buildPageForDestination(
          destinationId: selectedDestination.id,
          apiClient: apiClient,
          token: token,
          role: role,
          currentUserId: user.id,
          allowedDestinations: destinations,
          onOpenDestination: onDestinationChanged,
          todoReminderController: _todoReminderController,
          attachmentPickerService: _attachmentPickerService,
          incomingAttachmentService: _incomingAttachmentService,
        );
        final attachmentAwarePage = _withIncomingAttachmentBanner(
          page,
          destinations,
        );

        if (desktop) {
          return Scaffold(
            body: Row(
              children: [
                _DesktopSideNav(
                  apiClient: apiClient,
                  token: token,
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
                        todoReminderController: _todoReminderController,
                        onOpenTodoReminders: () =>
                            onDestinationChanged('todo_reminders'),
                      ),
                      Expanded(child: attachmentAwarePage),
                    ],
                  ),
                ),
              ],
            ),
          );
        }

        return Scaffold(
          appBar: AppBar(
            titleSpacing: 12,
            title: Row(
              children: [
                const BrandLogo(size: 32),
                const SizedBox(width: 8),
                Flexible(child: Text(selectedDestination.label)),
              ],
            ),
            actions: [
              _TodoBadgeButton(
                controller: _todoReminderController,
                onPressed: () => onDestinationChanged('todo_reminders'),
              ),
              IconButton(
                tooltip: '退出登录',
                onPressed: onLogout,
                icon: const Icon(Icons.logout_rounded),
              ),
            ],
          ),
          drawer: _MobileDrawer(
            apiClient: apiClient,
            token: token,
            role: role,
            user: user,
            destinations: destinations,
            selectedId: selectedDestination.id,
            onSelect: onDestinationChanged,
          ),
          body: attachmentAwarePage,
        );
      },
    );
  }

  Widget _withIncomingAttachmentBanner(
    Widget page,
    List<AppDestination> destinations,
  ) {
    if (_incomingAttachmentService.pendingCount == 0) {
      return page;
    }
    final canOpenTravelGroups =
        destinations.any((item) => item.id == 'travel_group_query');
    return Column(
      children: [
        MaterialBanner(
          key: const ValueKey('pending-incoming-attachment-banner'),
          content: Text(
            '有 ${_incomingAttachmentService.pendingCount} 个待导入附件，'
            '尚未关联旅行团。',
          ),
          leading: const Icon(Icons.attach_file_rounded),
          actions: [
            if (canOpenTravelGroups)
              TextButton(
                onPressed: () => onDestinationChanged('travel_group_query'),
                child: const Text('选择旅行团'),
              ),
          ],
        ),
        Expanded(child: page),
      ],
    );
  }
}

class _DesktopSideNav extends StatelessWidget {
  const _DesktopSideNav({
    required this.apiClient,
    required this.token,
    required this.role,
    required this.destinations,
    required this.selectedId,
    required this.onSelect,
    required this.onLogout,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;
  final List<AppDestination> destinations;
  final String selectedId;
  final ValueChanged<String> onSelect;
  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
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
                    const BrandLogo(size: 44),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '品鉴酱酒中心',
                            style: Theme.of(context)
                                .textTheme
                                .titleMedium
                                ?.copyWith(fontWeight: FontWeight.w800),
                          ),
                          Text(role.label,
                              style: Theme.of(context).textTheme.bodySmall),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              _GlobalMarkQueryControl(
                apiClient: apiClient,
                token: token,
                role: role,
              ),
              Expanded(
                child: ListView(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
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
    required this.todoReminderController,
    required this.onOpenTodoReminders,
  });

  final String title;
  final UserRole role;
  final AuthUser user;
  final VoidCallback onLogout;
  final TodoReminderController todoReminderController;
  final VoidCallback onOpenTodoReminders;

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
                    style: Theme.of(context)
                        .textTheme
                        .titleLarge
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                ),
                _TodoBadgeButton(
                  controller: todoReminderController,
                  onPressed: onOpenTodoReminders,
                ),
                const SizedBox(width: 8),
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

class _TodoBadgeButton extends StatelessWidget {
  const _TodoBadgeButton({
    required this.controller,
    required this.onPressed,
  });

  final TodoReminderController controller;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) => IconButton(
        tooltip: '待办提醒',
        onPressed: onPressed,
        icon: Badge(
          isLabelVisible: controller.summary.unfinished > 0,
          label: Text(
            controller.summary.unfinished > 99
                ? '99+'
                : '${controller.summary.unfinished}',
          ),
          child: const Icon(Icons.notifications_none_rounded),
        ),
      ),
    );
  }
}

class _GlobalMarkQueryControl extends StatefulWidget {
  const _GlobalMarkQueryControl({
    required this.apiClient,
    required this.token,
    required this.role,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;

  @override
  State<_GlobalMarkQueryControl> createState() =>
      _GlobalMarkQueryControlState();
}

class _GlobalMarkQueryControlState extends State<_GlobalMarkQueryControl> {
  _GlobalMarkQuerySettings? _settings;
  bool _loading = false;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    if (_canControlGlobalMarkQuery(widget.role)) {
      _loadSettings();
    }
  }

  @override
  void didUpdateWidget(covariant _GlobalMarkQueryControl oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.token != widget.token || oldWidget.role != widget.role) {
      _settings = null;
      _error = null;
      if (_canControlGlobalMarkQuery(widget.role)) {
        _loadSettings();
      }
    }
  }

  Future<void> _loadSettings() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final payload = await widget.apiClient.getJson(
        '/api/settings/global-mark-query',
        token: widget.token,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _settings = _GlobalMarkQuerySettings.fromPayload(payload);
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = error.message;
        _loading = false;
      });
    }
  }

  Future<void> _setRestricted(bool restricted) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final payload = await widget.apiClient.postJson(
        restricted
            ? '/api/settings/global-mark-query/enable'
            : '/api/settings/global-mark-query/restore',
        token: widget.token,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _settings = _GlobalMarkQuerySettings.fromPayload(payload);
        _busy = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(restricted ? '已开启：未标记信息不可查询。' : '已关闭：未标记信息可以查询。'),
        ),
      );
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = error.message;
        _busy = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_canControlGlobalMarkQuery(widget.role)) {
      return const SizedBox.shrink();
    }

    final settings = _settings;
    if (settings != null &&
        settings.onlyShowMarkedRecords &&
        widget.role != UserRole.superAdmin &&
        widget.role != UserRole.admin) {
      return const SizedBox.shrink();
    }

    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(10, 0, 10, 8),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest.withValues(alpha: 0.48),
          borderRadius: const BorderRadius.all(Radius.circular(8)),
          border: Border.all(color: scheme.outlineVariant),
        ),
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: _buildContent(context),
        ),
      ),
    );
  }

  Widget _buildContent(BuildContext context) {
    final settings = _settings;
    if (_loading && settings == null) {
      return const Row(
        children: [
          SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          SizedBox(width: 8),
          Expanded(child: Text('读取标记查询状态')),
        ],
      );
    }

    if (_error != null && settings == null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            '标记查询状态读取失败',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _loading ? null : _loadSettings,
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('重试'),
          ),
        ],
      );
    }

    final restricted = settings?.onlyShowMarkedRecords ?? false;
    final actionLabel = restricted ? '允许查询未标记' : '隐藏未标记信息';
    final statusLabel = restricted ? '仅已标记可查询' : '未标记可查询';
    final onPressed = _busy ? null : () => _setRestricted(!restricted);
    final button = restricted
        ? OutlinedButton.icon(
            onPressed: onPressed,
            icon: const Icon(Icons.lock_open_rounded),
            label: Text(actionLabel),
          )
        : FilledButton.icon(
            onPressed: onPressed,
            icon: const Icon(Icons.visibility_off_rounded),
            label: Text(actionLabel),
          );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Icon(Icons.bookmark_added_rounded, size: 18),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                statusLabel,
                style: Theme.of(context)
                    .textTheme
                    .labelMedium
                    ?.copyWith(fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
        if (_error != null) ...[
          const SizedBox(height: 6),
          Text(
            _error!,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Theme.of(context).colorScheme.error,
                ),
          ),
        ],
        const SizedBox(height: 8),
        button,
      ],
    );
  }
}

class _GlobalMarkQuerySettings {
  const _GlobalMarkQuerySettings({required this.onlyShowMarkedRecords});

  final bool onlyShowMarkedRecords;

  factory _GlobalMarkQuerySettings.fromPayload(Map<String, dynamic> payload) {
    final data = _stringKeyMap(payload['data']);
    final settings = _stringKeyMap(data['settings'] ?? payload['settings']);
    final rawOnlyShowMarkedRecords = settings['onlyShowMarkedRecords'] ??
        settings['only_show_marked_records'];
    return _GlobalMarkQuerySettings(
      onlyShowMarkedRecords: rawOnlyShowMarkedRecords == true ||
          rawOnlyShowMarkedRecords == 'true',
    );
  }
}

bool _canControlGlobalMarkQuery(UserRole role) {
  return role == UserRole.admin ||
      role == UserRole.superAdmin ||
      role == UserRole.boss ||
      role == UserRole.frontDesk ||
      role == UserRole.afterSales;
}

Map<String, dynamic> _stringKeyMap(Object? value) {
  if (value is Map<String, dynamic>) {
    return value;
  }
  if (value is Map) {
    return value.map((key, mapValue) => MapEntry('$key', mapValue));
  }
  return const <String, dynamic>{};
}

class _MobileDrawer extends StatelessWidget {
  const _MobileDrawer({
    required this.apiClient,
    required this.token,
    required this.role,
    required this.user,
    required this.destinations,
    required this.selectedId,
    required this.onSelect,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;
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
              child: Row(
                children: [
                  const BrandLogo(size: 54),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      '品鉴酱酒中心 · ${user.username}',
                      style: Theme.of(context)
                          .textTheme
                          .titleMedium
                          ?.copyWith(fontWeight: FontWeight.w800),
                    ),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            _GlobalMarkQueryControl(
              apiClient: apiClient,
              token: token,
              role: role,
            ),
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
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(8))),
      leading: Icon(destination.icon),
      title:
          Text(destination.label, maxLines: 1, overflow: TextOverflow.ellipsis),
      trailing: Text('P${destination.phase}',
          style: Theme.of(context).textTheme.labelSmall),
      onTap: onTap,
    );
  }
}
