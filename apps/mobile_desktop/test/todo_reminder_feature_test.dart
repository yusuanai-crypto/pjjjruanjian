import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/app/destinations.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/todo_reminders/local_reminder_scheduler.dart';
import 'package:jiangjiu_mobile_desktop/features/todo_reminders/todo_reminder_controller.dart';
import 'package:jiangjiu_mobile_desktop/features/todo_reminders/todo_reminder_models.dart';
import 'package:jiangjiu_mobile_desktop/features/todo_reminders/todo_reminders_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  test('all nine roles expose the todo reminder destination', () {
    expect(UserRole.values, hasLength(9));
    for (final role in UserRole.values) {
      expect(
        destinationsForRole(role).map((item) => item.id),
        contains('todo_reminders'),
        reason: role.value,
      );
    }
  });

  test('todo API models parse safe reminder data and summary counts', () {
    final reminder = TodoReminder.fromJson(_reminderJson());
    expect(reminder.sourceNumber, 'TG-001');
    expect(reminder.sourceType, 'TRAVEL_GROUP');
    expect(reminder.isUnread, isTrue);
    expect(reminder.personalNote, '仅本人可见');

    final summary = TodoReminderSummary.fromJson({
      'unfinished': 4,
      'unread': 3,
      'todayDue': 2,
      'overdue': 1,
      'urgent': 1,
    });
    expect(summary.unfinished, 4);
    expect(summary.overdue, 1);
  });

  testWidgets(
      'todo page renders summary, filters and reminder on wide and narrow layouts',
      (tester) async {
    final scheduler = _FakeScheduler();
    final controller = TodoReminderController(
      apiClient: _FakeApiClient(),
      token: 'token',
      userId: 'user-1',
      scheduler: scheduler,
    );

    await tester.binding.setSurfaceSize(const Size(1200, 800));
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TodoRemindersPage(
            controller: controller,
            onOpenDestination: (_) {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('未完成'), findsOneWidget);
    expect(find.text('待处理'), findsOneWidget);
    expect(find.text('旅行团资料待补充'), findsOneWidget);
    expect(scheduler.reconciledIds, contains('recipient-1'));

    await tester.binding.setSurfaceSize(const Size(390, 760));
    await tester.pump();
    expect(find.text('旅行团资料待补充'), findsOneWidget);
    addTearDown(() => tester.binding.setSurfaceSize(null));
    controller.dispose();
  });

  test('controller refreshes badge data, operations and logout cancellation',
      () async {
    final api = _FakeApiClient();
    final scheduler = _FakeScheduler();
    final controller = TodoReminderController(
      apiClient: api,
      token: 'token',
      userId: 'user-1',
      scheduler: scheduler,
    );
    await controller.initialize((_) {});
    expect(controller.summary.unfinished, 1);
    final reminder = controller.activeReminders.single;
    await controller.markRead(reminder);
    await controller.updatePreferences(
      reminder,
      personalNote: '跟进',
      personalRemindAt: DateTime.now().add(const Duration(hours: 1)),
    );
    await controller.snooze(
      reminder,
      DateTime.now().add(const Duration(hours: 2)),
    );
    await controller.archive(reminder);
    expect(api.paths, contains('/api/todo-reminders/recipient-1/read'));
    expect(api.paths, contains('/api/todo-reminders/recipient-1/preferences'));
    expect(api.paths, contains('/api/todo-reminders/recipient-1/snooze'));
    expect(api.paths, contains('/api/todo-reminders/recipient-1/archive'));
    expect(scheduler.cancelledReminderId, 'recipient-1');

    await controller.cancelAllForUser();
    expect(scheduler.cancelledUserId, 'user-1');
    controller.dispose();
  });

  test('disposing during API requests completes without notifier errors',
      () async {
    final api = _ControlledTodoApiClient();
    final controller = TodoReminderController(
      apiClient: api,
      token: 'token',
      userId: 'user-1',
      scheduler: _FakeScheduler(),
    );
    var notifications = 0;
    controller.addListener(() => notifications += 1);

    final syncing = controller.sync();
    expect(api.requests, hasLength(2));
    expect(notifications, 1);

    controller.dispose();
    controller.dispose();
    api.complete(0, _summaryPayload(unfinished: 1));
    api.complete(1, _pagePayload('old-reminder'));

    await expectLater(syncing, completes);
    expect(notifications, 1);
    expect(api.requests, hasLength(2));
  });

  test('disposing while scheduler initializes never creates periodic timer',
      () async {
    final api = _FakeApiClient();
    final scheduler = _BlockingInitializeScheduler();
    var timerCreations = 0;
    final controller = TodoReminderController(
      apiClient: api,
      token: 'token',
      userId: 'user-1',
      scheduler: scheduler,
      timerFactory: (duration, callback) {
        timerCreations += 1;
        return Timer(duration, () {});
      },
    );

    final initializing = controller.initialize((_) {});
    expect(scheduler.initializeCalls, 1);
    controller.dispose();
    scheduler.completeInitialization();

    await expectLater(initializing, completes);
    expect(timerCreations, 0);
    expect(api.paths, isEmpty);
  });

  test('newer sync result wins when an older request finishes last', () async {
    final api = _ControlledTodoApiClient();
    final controller = TodoReminderController(
      apiClient: api,
      token: 'token',
      userId: 'user-1',
      scheduler: _FakeScheduler(),
    );

    final olderSync = controller.sync();
    final newerSync = controller.sync();
    expect(api.requests, hasLength(4));

    api.complete(2, _summaryPayload(unfinished: 2));
    api.complete(3, _pagePayload('new-reminder'));
    await _waitForRequestCount(api, 5);
    api.complete(4, _pagePayload('new-active-reminder'));
    await newerSync;

    expect(controller.summary.unfinished, 2);
    expect(controller.reminders.single.id, 'new-reminder');
    expect(controller.activeReminders.single.id, 'new-active-reminder');

    api.complete(0, _summaryPayload(unfinished: 1));
    api.complete(1, _pagePayload('old-reminder'));
    await olderSync;

    expect(controller.summary.unfinished, 2);
    expect(controller.reminders.single.id, 'new-reminder');
    expect(controller.activeReminders.single.id, 'new-active-reminder');
    controller.dispose();
  });

  test('local notification diff cancels removed or changed schedules only', () {
    final reminder = TodoReminder.fromJson(_reminderJson());
    final current = LocalReminderScheduleEntry.fromReminder(reminder, 'user-1');
    final unchanged = buildLocalReminderScheduleDiff(
      reminders: [reminder],
      userId: 'user-1',
      existing: [current],
    );
    expect(unchanged.cancel, isEmpty);
    expect(unchanged.scheduleReminderIds, isEmpty);

    final changed = TodoReminder.fromJson({
      ..._reminderJson(),
      'personalRemindAt': DateTime.now()
          .add(const Duration(hours: 6))
          .toUtc()
          .toIso8601String(),
    });
    const removed = LocalReminderScheduleEntry(
      reminderId: 'removed',
      userId: 'user-1',
      notificationId: 22,
      scheduledAt: '2026-07-26T02:00:00.000Z',
    );
    const anotherUser = LocalReminderScheduleEntry(
      reminderId: 'other-user-reminder',
      userId: 'user-2',
      notificationId: 23,
      scheduledAt: '2026-07-26T02:00:00.000Z',
    );
    final diff = buildLocalReminderScheduleDiff(
      reminders: [changed],
      userId: 'user-1',
      existing: [current, removed, anotherUser],
    );
    expect(
      diff.cancel.map((item) => item.reminderId),
      unorderedEquals(['recipient-1', 'removed']),
    );
    expect(diff.scheduleReminderIds, {'recipient-1'});
  });

  test('ordinary reminders use inexact scheduling and survive reconciliation',
      () {
    expect(
      todoReminderAndroidScheduleMode,
      AndroidScheduleMode.inexactAllowWhileIdle,
    );
    final reminder = TodoReminder.fromJson(_reminderJson());
    final entry = LocalReminderScheduleEntry.fromReminder(reminder, 'user-1');

    final created = buildLocalReminderScheduleDiff(
      reminders: [reminder],
      userId: 'user-1',
      existing: const [],
    );
    expect(created.scheduleReminderIds, {reminder.id});
    expect(created.cancel, isEmpty);

    final restoredAfterRestart = buildLocalReminderScheduleDiff(
      reminders: [reminder],
      userId: 'user-1',
      existing: [entry],
    );
    expect(restoredAfterRestart.scheduleReminderIds, isEmpty);
    expect(restoredAfterRestart.cancel, isEmpty);

    final cancelled = buildLocalReminderScheduleDiff(
      reminders: const [],
      userId: 'user-1',
      existing: [entry],
    );
    expect(
      cancelled.cancel.map((item) => item.reminderId),
      [reminder.id],
    );
  });

  testWidgets('todo page exposes an empty state', (tester) async {
    final controller = TodoReminderController(
      apiClient: _EmptyApiClient(),
      token: 'token',
      userId: 'user-1',
      scheduler: _FakeScheduler(),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TodoRemindersPage(
            controller: controller,
            onOpenDestination: (_) {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('当前分类没有待办。'), findsOneWidget);
    controller.dispose();
  });

  testWidgets('todo page exposes an error state and retry action',
      (tester) async {
    final controller = TodoReminderController(
      apiClient: _FailingApiClient(),
      token: 'token',
      userId: 'user-1',
      scheduler: _FakeScheduler(),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TodoRemindersPage(
            controller: controller,
            onOpenDestination: (_) {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('网络不可用'), findsOneWidget);
    expect(find.text('重试'), findsOneWidget);
    controller.dispose();
  });
}

Future<void> _waitForRequestCount(
  _ControlledTodoApiClient api,
  int count,
) async {
  for (var attempt = 0; attempt < 20; attempt += 1) {
    if (api.requests.length >= count) {
      return;
    }
    await Future<void>.delayed(Duration.zero);
  }
  fail('Timed out waiting for $count API requests.');
}

Map<String, dynamic> _summaryPayload({required int unfinished}) => {
      'data': {
        'unfinished': unfinished,
        'unread': unfinished,
        'todayDue': 0,
        'overdue': 0,
        'urgent': 0,
      },
    };

Map<String, dynamic> _pagePayload(String reminderId) => {
      'data': {
        'reminders': [
          {
            ..._reminderJson(),
            'id': reminderId,
            'todoId': 'todo-$reminderId',
            'title': reminderId,
          },
        ],
        'page': 1,
        'pageSize': 50,
        'total': 1,
        'totalPages': 1,
      },
    };

Map<String, dynamic> _reminderJson() => {
      'id': 'recipient-1',
      'todoId': 'todo-1',
      'ruleCode': 'TRAVEL_GROUP_FRONT_DESK_DETAILS',
      'sourceType': 'TRAVEL_GROUP',
      'sourceId': 'group-1',
      'sourceNumber': 'TG-001',
      'title': '旅行团资料待补充',
      'content': '旅行团 TG-001 尚有资料需要补充。',
      'priority': 'NORMAL',
      'status': 'ACTIVE',
      'recipientReason': 'BUSINESS',
      'dueAt': DateTime.now()
          .add(const Duration(hours: 4))
          .toUtc()
          .toIso8601String(),
      'readAt': null,
      'personalNote': '仅本人可见',
      'personalRemindAt': null,
      'snoozedUntil': null,
      'archivedAt': null,
    };

class _FakeApiClient extends ApiClient {
  _FakeApiClient() : super(baseUrl: 'https://example.test');

  final List<String> paths = [];

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    paths.add(Uri.parse(path).path);
    if (path.contains('/summary')) {
      return {
        'data': {
          'unfinished': 1,
          'unread': 1,
          'todayDue': 0,
          'overdue': 0,
          'urgent': 0,
        },
      };
    }
    final status = Uri.parse(path).queryParameters['status'];
    return {
      'data': {
        'reminders': status == 'RESOLVED' ? [] : [_reminderJson()],
        'page': 1,
        'pageSize': 50,
        'total': status == 'RESOLVED' ? 0 : 1,
        'totalPages': status == 'RESOLVED' ? 0 : 1,
      },
    };
  }

  @override
  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    paths.add(path);
    return {'data': _reminderJson()};
  }

  @override
  Future<Map<String, dynamic>> patchJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    paths.add(path);
    return {
      'data': {
        ..._reminderJson(),
        'personalNote': body?['personalNote'],
        'personalRemindAt': body?['personalRemindAt'],
      },
    };
  }
}

class _FailingApiClient extends ApiClient {
  _FailingApiClient() : super(baseUrl: 'https://example.test');

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) {
    throw const ApiException(
      statusCode: 0,
      code: 'NETWORK_ERROR',
      message: '网络不可用',
    );
  }
}

class _EmptyApiClient extends _FakeApiClient {
  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    if (path.contains('/summary')) {
      return {
        'data': {
          'unfinished': 0,
          'unread': 0,
          'todayDue': 0,
          'overdue': 0,
          'urgent': 0,
        },
      };
    }
    return {
      'data': {
        'reminders': <Map<String, dynamic>>[],
        'page': 1,
        'pageSize': 50,
        'total': 0,
        'totalPages': 0,
      },
    };
  }
}

class _ControlledTodoApiClient extends ApiClient {
  _ControlledTodoApiClient() : super(baseUrl: 'https://example.test');

  final List<Completer<Map<String, dynamic>>> requests = [];

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) {
    final request = Completer<Map<String, dynamic>>();
    requests.add(request);
    return request.future;
  }

  void complete(int index, Map<String, dynamic> payload) {
    requests[index].complete(payload);
  }
}

class _FakeScheduler implements LocalReminderScheduler {
  final List<String> reconciledIds = [];
  String? cancelledUserId;
  String? cancelledReminderId;

  @override
  Future<void> initialize(ValueChanged<String> onReminderActivated) async {}

  @override
  Future<void> reconcile(
    List<TodoReminder> reminders, {
    required String userId,
  }) async {
    reconciledIds
      ..clear()
      ..addAll(reminders.map((item) => item.id));
  }

  @override
  Future<void> schedule(
    TodoReminder reminder, {
    required String userId,
  }) async {}

  @override
  Future<void> cancel(String reminderId) async {
    cancelledReminderId = reminderId;
  }

  @override
  Future<void> cancelAllForUser(String userId) async {
    cancelledUserId = userId;
  }

  @override
  Future<void> handleNotificationActivation() async {}
}

class _BlockingInitializeScheduler extends _FakeScheduler {
  final Completer<void> _initialization = Completer<void>();
  int initializeCalls = 0;

  @override
  Future<void> initialize(ValueChanged<String> onReminderActivated) {
    initializeCalls += 1;
    return _initialization.future;
  }

  void completeInitialization() {
    _initialization.complete();
  }
}
