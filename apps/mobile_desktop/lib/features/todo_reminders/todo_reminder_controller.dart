import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/api/api_client.dart';
import 'local_reminder_scheduler.dart';
import 'todo_reminder_api.dart';
import 'todo_reminder_models.dart';

typedef TodoReminderTimerFactory = Timer Function(
  Duration duration,
  void Function(Timer timer) callback,
);

class TodoReminderController extends ChangeNotifier {
  TodoReminderController({
    required ApiClient apiClient,
    required String token,
    required this.userId,
    LocalReminderScheduler? scheduler,
    Duration syncInterval = const Duration(minutes: 2),
    TodoReminderTimerFactory? timerFactory,
  })  : _api = TodoReminderApi(apiClient: apiClient, token: token),
        _scheduler = scheduler ?? PlatformLocalReminderScheduler(),
        _syncInterval = syncInterval,
        _timerFactory = timerFactory ?? Timer.periodic;

  final TodoReminderApi _api;
  final LocalReminderScheduler _scheduler;
  final Duration _syncInterval;
  final TodoReminderTimerFactory _timerFactory;
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
  bool _disposed = false;
  int _syncGeneration = 0;
  Future<void> _schedulerReconcileTail = Future<void>.value();

  Future<void> initialize(ValueChanged<String> onActivation) async {
    if (_disposed) {
      return;
    }
    if (!_initialized) {
      await _scheduler.initialize((id) {
        if (_disposed) {
          return;
        }
        activatedReminderId = id;
        onActivation(id);
      });
      if (_disposed) {
        return;
      }
      _initialized = true;
      _timer = _timerFactory(
        _syncInterval,
        (timer) {
          if (_disposed) {
            timer.cancel();
            return;
          }
          unawaited(sync(silent: true));
        },
      );
    }
    if (_disposed) {
      return;
    }
    await sync();
    if (_disposed) {
      return;
    }
  }

  Future<void> sync({bool silent = false}) async {
    if (_disposed || (loading && silent)) {
      return;
    }
    final generation = ++_syncGeneration;
    final requestedCategory = category;
    final requestedPriority = priority;
    final requestedSourceType = sourceType;
    final requestedKeyword = keyword;
    if (!silent) {
      loading = true;
      error = null;
      _notify();
    }
    try {
      final values = await Future.wait([
        _api.summary(),
        _api.list(
          status: requestedCategory == 'resolved' ? 'RESOLVED' : 'ACTIVE',
          overdue: requestedCategory == 'overdue',
          dueToday: requestedCategory == 'today',
          priority: requestedPriority,
          sourceType: requestedSourceType,
          keyword: requestedKeyword,
        ),
      ]);
      if (!_isCurrentSync(generation)) {
        return;
      }
      final nextSummary = values[0] as TodoReminderSummary;
      final nextReminders = (values[1] as TodoReminderPageData).reminders;
      final active = await _api.list(status: 'ACTIVE', pageSize: 100);
      if (!_isCurrentSync(generation)) {
        return;
      }
      await _reconcileActiveReminders(active.reminders, generation);
      if (!_isCurrentSync(generation)) {
        return;
      }
      summary = nextSummary;
      reminders = nextReminders;
      activeReminders = active.reminders;
      error = null;
    } catch (caught) {
      if (_isCurrentSync(generation)) {
        error = _message(caught);
      }
    } finally {
      if (_isCurrentSync(generation)) {
        loading = false;
        _notify();
      }
    }
  }

  Future<void> setCategory(String value) async {
    if (_disposed) {
      return;
    }
    category = value;
    await sync();
    if (_disposed) {
      return;
    }
  }

  Future<void> setFilters({
    String? priorityValue,
    String? sourceTypeValue,
    String? keywordValue,
  }) async {
    if (_disposed) {
      return;
    }
    priority = priorityValue;
    sourceType = sourceTypeValue;
    keyword = keywordValue ?? keyword;
    await sync();
    if (_disposed) {
      return;
    }
  }

  Future<TodoReminder> markRead(TodoReminder reminder) async {
    if (_disposed) {
      return reminder;
    }
    var updated = reminder;
    if (reminder.isUnread) {
      updated = await _api.markRead(reminder.id);
      if (_disposed) {
        return updated;
      }
    }
    await sync(silent: true);
    if (_disposed) {
      return updated;
    }
    return updated;
  }

  Future<void> updatePreferences(
    TodoReminder reminder, {
    String? personalNote,
    DateTime? personalRemindAt,
  }) async {
    if (_disposed) {
      return;
    }
    await _api.updatePreferences(
      reminder.id,
      personalNote: personalNote,
      personalRemindAt: personalRemindAt,
    );
    if (_disposed) {
      return;
    }
    await sync();
    if (_disposed) {
      return;
    }
  }

  Future<void> snooze(TodoReminder reminder, DateTime until) async {
    if (_disposed) {
      return;
    }
    await _api.snooze(reminder.id, until);
    if (_disposed) {
      return;
    }
    await sync();
    if (_disposed) {
      return;
    }
  }

  Future<void> verifyCompletion(TodoReminder reminder) async {
    if (_disposed) {
      return;
    }
    await _api.verifyCompletion(reminder.id);
    if (_disposed) {
      return;
    }
    await sync();
    if (_disposed) {
      return;
    }
  }

  Future<void> archive(TodoReminder reminder) async {
    if (_disposed) {
      return;
    }
    await _api.archive(reminder.id);
    if (_disposed) {
      return;
    }
    await _scheduler.cancel(reminder.id);
    if (_disposed) {
      return;
    }
    await sync();
    if (_disposed) {
      return;
    }
  }

  Future<void> onResumed() => sync(silent: true);

  Future<void> cancelAllForUser() async {
    if (_disposed) {
      return;
    }
    await _scheduler.cancelAllForUser(userId);
    if (_disposed) {
      return;
    }
  }

  Future<void> _reconcileActiveReminders(
    List<TodoReminder> values,
    int generation,
  ) async {
    final previous = _schedulerReconcileTail;
    final release = Completer<void>();
    _schedulerReconcileTail = release.future;
    try {
      await previous;
      if (!_isCurrentSync(generation)) {
        return;
      }
      await _scheduler.reconcile(values, userId: userId);
      if (!_isCurrentSync(generation)) {
        return;
      }
    } finally {
      if (!release.isCompleted) {
        release.complete();
      }
    }
  }

  bool _isCurrentSync(int generation) {
    return !_disposed && generation == _syncGeneration;
  }

  void _notify() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  @override
  void dispose() {
    if (_disposed) {
      return;
    }
    _disposed = true;
    _syncGeneration += 1;
    _timer?.cancel();
    _timer = null;
    super.dispose();
  }
}

String _message(Object error) {
  if (error is ApiException) return error.message;
  return '待办提醒同步失败，请稍后重试。';
}
