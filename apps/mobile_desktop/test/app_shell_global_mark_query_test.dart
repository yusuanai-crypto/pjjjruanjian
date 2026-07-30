import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/app/destinations.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/auth/auth_models.dart';
import 'package:jiangjiu_mobile_desktop/features/shell/app_shell.dart';
import 'package:jiangjiu_mobile_desktop/features/todo_reminders/local_reminder_scheduler.dart';
import 'package:jiangjiu_mobile_desktop/features/todo_reminders/todo_reminder_controller.dart';
import 'package:jiangjiu_mobile_desktop/features/todo_reminders/todo_reminder_models.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets(
      'global mark event reloads the order page and clears an open order detail',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final apiClient = _ShellApiClient();

    await tester.pumpWidget(
      MaterialApp(
        home: AppShell(
          apiClient: apiClient,
          token: 'test-token',
          role: UserRole.admin,
          user: _user,
          allowedDestinations: [
            appDestinations.firstWhere(
              (destination) => destination.id == 'order_query',
            ),
          ],
          selectedDestinationId: 'order_query',
          onDestinationChanged: (_) {},
          onLogout: () {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    final initialListCalls = apiClient.salesOrderListCalls;
    expect(initialListCalls, greaterThanOrEqualTo(1));
    expect(find.text('SO-SSE-001'), findsOneWidget);

    await tester.tap(find.text('SO-SSE-001'));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('order-basic-edit-button')),
      findsOneWidget,
    );

    apiClient.filtered = true;
    apiClient.restricted = true;
    apiClient.events.add(
      ApiSseEvent(
        event: 'global-mark-query.changed',
        id: '1',
        data: jsonEncode({
          'event': 'global-mark-query.changed',
          'onlyShowMarkedRecords': true,
          'restoreRequired': true,
          'revision': 1,
          'updatedAt': '2026-07-27T00:00:01.000Z',
        }),
      ),
    );
    await tester.pump();
    await tester.pumpAndSettle();

    expect(apiClient.salesOrderListCalls, initialListCalls + 1);
    expect(find.text('SO-SSE-001'), findsNothing);
    expect(
      find.byKey(const ValueKey('order-basic-edit-button')),
      findsNothing,
    );

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    await apiClient.events.close();
    apiClient.close(force: true);
  });

  testWidgets(
      'fast login then logout does not start fallback sync on disposed shell',
      (tester) async {
    final apiClient = _ShellApiClient();
    final scheduler = _PendingInitializationScheduler();
    var timerCreations = 0;
    final todoController = TodoReminderController(
      apiClient: apiClient,
      token: 'test-token',
      userId: _user.id,
      scheduler: scheduler,
      timerFactory: (duration, callback) {
        timerCreations += 1;
        return Timer(duration, () {});
      },
    );

    await tester.pumpWidget(
      MaterialApp(
        home: AppShell(
          apiClient: apiClient,
          token: 'test-token',
          role: UserRole.admin,
          user: _user,
          allowedDestinations: [
            appDestinations.firstWhere(
              (destination) => destination.id == 'role_menu',
            ),
          ],
          selectedDestinationId: 'role_menu',
          onDestinationChanged: (_) {},
          onLogout: () {},
          todoReminderController: todoController,
        ),
      ),
    );
    await tester.pump();
    expect(scheduler.initializeCalls, 1);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    scheduler.failInitialization();
    await tester.pump();
    await tester.pump();

    expect(tester.takeException(), isNull);
    expect(timerCreations, 0);
    expect(apiClient.todoGetCalls, 0);

    await apiClient.events.close();
    apiClient.close(force: true);
  });
}

const _user = AuthUser(
  id: 'admin-1',
  name: 'Admin',
  username: 'admin',
  role: UserRole.admin,
  isActive: true,
  mustChangePassword: false,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
);

class _ShellApiClient extends ApiClient {
  _ShellApiClient() : super(baseUrl: 'http://127.0.0.1:3000');

  final events = StreamController<ApiSseEvent>.broadcast(sync: true);
  bool filtered = false;
  bool restricted = false;
  int salesOrderListCalls = 0;
  int todoGetCalls = 0;

  @override
  Stream<ApiSseEvent> openSse(String path, {String? token}) {
    expect(path, '/api/settings/global-mark-query/events');
    expect(token, 'test-token');
    return events.stream;
  }

  @override
  Future<Map<String, dynamic>> getJson(
    String path, {
    String? token,
  }) async {
    if (path == '/api/settings/global-mark-query') {
      return {
        'data': {
          'settings': {
            'onlyShowMarkedRecords': restricted,
            'restoreRequired': restricted,
            'revision': restricted ? 1 : 0,
            'updatedAt': restricted
                ? '2026-07-27T00:00:01.000Z'
                : '2026-07-27T00:00:00.000Z',
          },
        },
      };
    }
    if (path == '/api/todo-reminders/summary' ||
        path.startsWith('/api/todo-reminders?')) {
      todoGetCalls += 1;
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
    if (path == '/api/sales-orders/order-sse-1') {
      return {
        'data': {
          'salesOrder': _order,
        },
      };
    }
    if (path.startsWith('/api/sales-orders?')) {
      salesOrderListCalls += 1;
      return {
        'data': {
          'salesOrders': filtered ? const [] : [_order],
        },
      };
    }
    throw StateError('Unexpected GET $path');
  }
}

class _PendingInitializationScheduler implements LocalReminderScheduler {
  final Completer<void> _initialization = Completer<void>();
  int initializeCalls = 0;

  @override
  Future<void> initialize(ValueChanged<String> onReminderActivated) {
    initializeCalls += 1;
    return _initialization.future;
  }

  void failInitialization() {
    _initialization.completeError(StateError('initialization failed'));
  }

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

  @override
  Future<void> cancel(String reminderId) async {}

  @override
  Future<void> cancelAllForUser(String userId) async {}

  @override
  Future<void> handleNotificationActivation() async {}
}

const _order = <String, dynamic>{
  'id': 'order-sse-1',
  'orderNo': 'SO-SSE-001',
  'orderType': 'external',
  'orderDate': '2026-07-27',
  'customerId': 'customer-sse-1',
  'customer': {
    'id': 'customer-sse-1',
    'name': 'SSE Customer',
    'phone': '13900000001',
    'financeMark': false,
  },
  'customerName': 'SSE Customer',
  'customerPhone': '13900000001',
  'totalAmountCents': 10000,
  'cashOnDeliveryAmountCents': 0,
  'status': 'valid',
  'packingStatus': 'pending',
  'packageCount': 0,
  'logisticsFeeCents': 0,
  'invoiceRequired': false,
  'invoiceIssued': false,
  'financeMark': true,
  'salesEditCount': 0,
  'salesEditLimit': 1,
  'salesEditRemaining': 1,
  'canEditByCurrentUser': true,
  'items': <Map<String, dynamic>>[
    {
      'id': 'item-sse-1',
      'productName': 'SSE Product',
      'unit': '瓶',
      'quantity': 1,
      'unitPriceCents': 10000,
      'subtotalCents': 10000,
      'deliveryType': 'self_pickup',
      'sortOrder': 1,
    },
  ],
};
