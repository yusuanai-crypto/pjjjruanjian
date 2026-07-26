import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/api/api_client.dart';
import 'local_reminder_scheduler.dart';
import 'todo_reminder_api.dart';
import 'todo_reminder_models.dart';

class TodoReminderController extends ChangeNotifier {
  TodoReminderController({
    required ApiClient apiClient,
    required String token,
    required this.userId,
    LocalReminderScheduler? scheduler,
  })  : _api = TodoReminderApi(apiClient: apiClient, token: token),
        _scheduler = scheduler ?? PlatformLocalReminderScheduler();

  final TodoReminderApi _api;
  final LocalReminderScheduler _scheduler;
  final String userId;

  TodoReminderSummary summary = const TodoReminderSummary.empty();
  List<TodoReminder> reminders = const [];
  List<TodoReminder> activeReminders = const [];
  String category = 'active';
  String? priority;
  String? sourceType;
  String keyword = '';
  bool loading = false;
  String? error;
  String? activatedReminderId;
  Timer? _timer;
  bool _initialized = false;

  Future<void> initialize(ValueChanged<String> onActivation) async {
    if (!_initialized) {
      await _scheduler.initialize((id) {
        activatedReminderId = id;
        onActivation(id);
      });
      _initialized = true;
      _timer = Timer.periodic(
        const Duration(minutes: 2),
        (_) => sync(silent: true),
      );
    }
    await sync();
  }

  Future<void> sync({bool silent = false}) async {
    if (loading && silent) return;
    if (!silent) {
      loading = true;
      error = null;
      notifyListeners();
    }
    try {
      final values = await Future.wait([
        _api.summary(),
        _api.list(
          status: category == 'resolved' ? 'RESOLVED' : 'ACTIVE',
          overdue: category == 'overdue',
          dueToday: category == 'today',
          priority: priority,
          sourceType: sourceType,
          keyword: keyword,
        ),
      ]);
      summary = values[0] as TodoReminderSummary;
      reminders = (values[1] as TodoReminderPageData).reminders;
      error = null;
      final active = await _api.list(status: 'ACTIVE', pageSize: 100);
      activeReminders = active.reminders;
      await _scheduler.reconcile(active.reminders, userId: userId);
    } catch (caught) {
      error = _message(caught);
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> setCategory(String value) async {
    category = value;
    await sync();
  }

  Future<void> setFilters({
    String? priorityValue,
    String? sourceTypeValue,
    String? keywordValue,
  }) async {
    priority = priorityValue;
    sourceType = sourceTypeValue;
    keyword = keywordValue ?? keyword;
    await sync();
  }

  Future<TodoReminder> markRead(TodoReminder reminder) async {
    final updated =
        reminder.isUnread ? await _api.markRead(reminder.id) : reminder;
    await sync(silent: true);
    return updated;
  }

  Future<void> updatePreferences(
    TodoReminder reminder, {
    String? personalNote,
    DateTime? personalRemindAt,
  }) async {
    await _api.updatePreferences(
      reminder.id,
      personalNote: personalNote,
      personalRemindAt: personalRemindAt,
    );
    await sync();
  }

  Future<void> snooze(TodoReminder reminder, DateTime until) async {
    await _api.snooze(reminder.id, until);
    await sync();
  }

  Future<void> verifyCompletion(TodoReminder reminder) async {
    await _api.verifyCompletion(reminder.id);
    await sync();
  }

  Future<void> archive(TodoReminder reminder) async {
    await _api.archive(reminder.id);
    await _scheduler.cancel(reminder.id);
    await sync();
  }

  Future<void> onResumed() => sync(silent: true);

  Future<void> cancelAllForUser() => _scheduler.cancelAllForUser(userId);

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}

String _message(Object error) {
  if (error is ApiException) return error.message;
  return '待办提醒同步失败，请稍后重试。';
}
