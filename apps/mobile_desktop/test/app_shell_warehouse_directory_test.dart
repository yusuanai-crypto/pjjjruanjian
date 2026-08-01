import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/app/destinations.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/auth/auth_models.dart';
import 'package:jiangjiu_mobile_desktop/features/shell/app_shell.dart';
import 'package:jiangjiu_mobile_desktop/features/todo_reminders/local_reminder_scheduler.dart';
import 'package:jiangjiu_mobile_desktop/features/todo_reminders/todo_reminder_controller.dart';
import 'package:jiangjiu_mobile_desktop/features/todo_reminders/todo_reminder_models.dart';
import 'package:jiangjiu_mobile_desktop/features/warehouse_directory/warehouse_directory_page.dart';
import 'package:jiangjiu_mobile_desktop/features/warehouse_management/warehouse_management_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets(
      'backend warehouse directory menu renders, selects, and opens its page',
      (tester) async {
    await _setDesktopSize(tester);
    final apiClient = _ShellWarehouseApiClient();

    await tester.pumpWidget(
      MaterialApp(
        home: _ShellHarness(
          apiClient: apiClient,
          role: UserRole.superAdmin,
          menus: const [
            AuthMenu(id: 'dashboard', title: '首页', phase: 1),
            AuthMenu(
              id: 'warehouse_management',
              title: '库存管理',
              phase: 11,
            ),
            AuthMenu(
              id: 'warehouse_directory',
              title: '仓库管理',
              phase: 11,
            ),
            AuthMenu(
              id: 'warehouse_workspace',
              title: '库管打包',
              phase: 6,
            ),
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.widgetWithText(ListTile, '库存管理'), findsOneWidget);
    expect(find.widgetWithText(ListTile, '仓库管理'), findsOneWidget);
    expect(find.widgetWithText(ListTile, '库管打包'), findsOneWidget);
    expect(find.byType(WarehouseDirectoryPage), findsNothing);

    await tester.tap(find.widgetWithText(ListTile, '仓库管理'));
    await tester.pumpAndSettle();

    expect(find.byType(WarehouseDirectoryPage), findsOneWidget);
    expect(find.byType(WarehouseManagementPage), findsNothing);
    final selectedTile = tester.widget<ListTile>(
      find.widgetWithText(ListTile, '仓库管理'),
    );
    expect(selectedTile.selected, isTrue);
    expect(apiClient.warehouseListCalls, 1);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    await apiClient.closeStreams();
  });

  testWidgets('role rules hide warehouse directory and reject a manual id',
      (tester) async {
    await _setDesktopSize(tester);
    final apiClient = _ShellWarehouseApiClient();

    await tester.pumpWidget(
      MaterialApp(
        home: _ShellHarness(
          apiClient: apiClient,
          role: UserRole.sales,
          initialDestinationId: 'warehouse_directory',
          menus: const [
            AuthMenu(id: 'dashboard', title: '首页', phase: 1),
            AuthMenu(
              id: 'warehouse_directory',
              title: '仓库管理',
              phase: 11,
            ),
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.widgetWithText(ListTile, '仓库管理'), findsNothing);
    expect(find.byType(WarehouseDirectoryPage), findsNothing);
    expect(apiClient.warehouseListCalls, 0);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    await apiClient.closeStreams();
  });
}

Future<void> _setDesktopSize(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1400, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

class _ShellHarness extends StatefulWidget {
  const _ShellHarness({
    required this.apiClient,
    required this.role,
    required this.menus,
    this.initialDestinationId = 'dashboard',
  });

  final _ShellWarehouseApiClient apiClient;
  final UserRole role;
  final List<AuthMenu> menus;
  final String initialDestinationId;

  @override
  State<_ShellHarness> createState() => _ShellHarnessState();
}

class _ShellHarnessState extends State<_ShellHarness> {
  late String _selectedDestinationId = widget.initialDestinationId;
  late final TodoReminderController _todoController = TodoReminderController(
    apiClient: widget.apiClient,
    token: 'test-token',
    userId: 'test-user',
    scheduler: _NoopReminderScheduler(),
    timerFactory: (duration, callback) => Timer(duration, () {}),
  );

  @override
  Widget build(BuildContext context) {
    return AppShell(
      apiClient: widget.apiClient,
      token: 'test-token',
      role: widget.role,
      user: AuthUser(
        id: 'test-user',
        name: 'Test User',
        username: 'test.user',
        role: widget.role,
        isActive: true,
        mustChangePassword: false,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      ),
      allowedDestinations:
          destinationsForBackendMenus(widget.menus, widget.role),
      selectedDestinationId: _selectedDestinationId,
      onDestinationChanged: (destinationId) {
        setState(() => _selectedDestinationId = destinationId);
      },
      onLogout: () {},
      todoReminderController: _todoController,
    );
  }
}

class _ShellWarehouseApiClient extends ApiClient {
  _ShellWarehouseApiClient() : super(baseUrl: 'http://127.0.0.1:3000');

  final _events = StreamController<ApiSseEvent>.broadcast(sync: true);
  int warehouseListCalls = 0;

  @override
  Stream<ApiSseEvent> openSse(String path, {String? token}) => _events.stream;

  @override
  Future<Map<String, dynamic>> getJson(
    String path, {
    String? token,
  }) async {
    if (path == '/api/settings/global-mark-query') {
      return {
        'data': {
          'settings': {
            'onlyShowMarkedRecords': false,
            'restoreRequired': false,
            'revision': 0,
            'updatedAt': '2026-08-01T00:00:00.000Z',
          },
        },
      };
    }
    if (path == '/api/todo-reminders/summary' ||
        path.startsWith('/api/todo-reminders?')) {
      return {
        'data': {
          'reminders': const [],
          'unfinished': 0,
          'unread': 0,
          'todayDue': 0,
          'overdue': 0,
          'urgent': 0,
          'page': 1,
          'pageSize': 20,
          'total': 0,
          'totalPages': 0,
        },
      };
    }
    if (path.startsWith('/api/inventory/warehouses?')) {
      warehouseListCalls += 1;
      return {
        'data': {
          'warehouses': const [],
          'pagination': {
            'page': 1,
            'pageSize': 100,
            'total': 0,
            'totalPages': 0,
          },
        },
      };
    }
    throw StateError('Unexpected GET $path');
  }

  Future<void> closeStreams() async {
    await _events.close();
    close(force: true);
  }
}

class _NoopReminderScheduler implements LocalReminderScheduler {
  @override
  Future<void> cancel(String reminderId) async {}

  @override
  Future<void> cancelAllForUser(String userId) async {}

  @override
  Future<void> handleNotificationActivation() async {}

  @override
  Future<void> initialize(ValueChanged<String> onReminderActivated) async {}

  @override
  Future<void> reconcile(
    List<TodoReminder> reminders, {
    required String userId,
  }) async {}

  @override
  Future<void> schedule(
    TodoReminder reminder, {
    required String userId,
  }) async {}
}
