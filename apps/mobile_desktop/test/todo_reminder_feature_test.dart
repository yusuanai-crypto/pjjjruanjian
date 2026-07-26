import 'package:flutter/material.dart';
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
