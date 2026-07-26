import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/data/latest.dart' as tz_data;
import 'package:timezone/timezone.dart' as tz;

import 'todo_reminder_models.dart';

abstract class LocalReminderScheduler {
  Future<void> initialize(ValueChanged<String> onReminderActivated);

  Future<void> reconcile(
    List<TodoReminder> reminders, {
    required String userId,
  });

  Future<void> schedule(
    TodoReminder reminder, {
    required String userId,
  });

  Future<void> cancel(String reminderId);

  Future<void> cancelAllForUser(String userId);

  Future<void> handleNotificationActivation();
}

class PlatformLocalReminderScheduler implements LocalReminderScheduler {
  PlatformLocalReminderScheduler({
    FlutterLocalNotificationsPlugin? plugin,
  }) : _plugin = plugin ?? FlutterLocalNotificationsPlugin();

  static const _cacheKey = 'todo_reminder_local_schedule_v1';
  static const _channelId = 'todo_reminders';
  static const _channelName = '待办提醒';
  static const _windowsGuid = '7301dce8-3f54-4b3f-aaba-143528fe49e4';

  final FlutterLocalNotificationsPlugin _plugin;
  ValueChanged<String>? _onActivated;
  bool _initialized = false;
  bool _exactAlarmsAllowed = false;

  @override
  Future<void> initialize(ValueChanged<String> onReminderActivated) async {
    _onActivated = onReminderActivated;
    if (_initialized) {
      await handleNotificationActivation();
      return;
    }
    tz_data.initializeTimeZones();
    tz.setLocalLocation(tz.getLocation('Asia/Shanghai'));
    const settings = InitializationSettings(
      android: AndroidInitializationSettings('ic_launcher'),
      windows: WindowsInitializationSettings(
        appName: '品鉴酱酒中心',
        appUserModelId: 'Jiangjiu.PinjianCenter',
        guid: _windowsGuid,
      ),
    );
    await _plugin.initialize(
      settings: settings,
      onDidReceiveNotificationResponse: _handleResponse,
    );
    _initialized = true;
    if (!kIsWeb && Platform.isAndroid) {
      final android = _plugin.resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin>();
      await android?.requestNotificationsPermission();
      _exactAlarmsAllowed =
          await android?.requestExactAlarmsPermission() ?? false;
    }
    await handleNotificationActivation();
  }

  @override
  Future<void> handleNotificationActivation() async {
    if (!_initialized) return;
    final details = await _plugin.getNotificationAppLaunchDetails();
    if (details?.didNotificationLaunchApp ?? false) {
      _handlePayload(details?.notificationResponse?.payload);
    }
  }

  @override
  Future<void> reconcile(
    List<TodoReminder> reminders, {
    required String userId,
  }) async {
    final cache = await _readCache();
    final active = reminders.where((item) => item.isActive).toList();
    final desired = <String, LocalReminderScheduleEntry>{
      for (final reminder in active)
        reminder.id: LocalReminderScheduleEntry.fromReminder(reminder, userId),
    };
    final diff = buildLocalReminderScheduleDiff(
      reminders: active,
      userId: userId,
      existing: cache.values,
    );
    for (final existing in diff.cancel) {
      await _plugin.cancel(id: existing.notificationId);
      cache.remove(existing.reminderId);
    }
    for (final reminder in active) {
      final desiredItem = desired[reminder.id]!;
      if (!diff.scheduleReminderIds.contains(reminder.id)) continue;
      await _scheduleNotification(reminder, desiredItem);
      cache[reminder.id] = desiredItem;
    }
    await _writeCache(cache);
  }

  @override
  Future<void> schedule(
    TodoReminder reminder, {
    required String userId,
  }) async {
    final cache = await _readCache();
    final desired = LocalReminderScheduleEntry.fromReminder(reminder, userId);
    final current = cache[reminder.id];
    if (current == desired) return;
    if (current != null) {
      await _plugin.cancel(id: current.notificationId);
    }
    await _scheduleNotification(reminder, desired);
    cache[reminder.id] = desired;
    await _writeCache(cache);
  }

  @override
  Future<void> cancel(String reminderId) async {
    final cache = await _readCache();
    final existing = cache.remove(reminderId);
    if (existing != null) {
      await _plugin.cancel(id: existing.notificationId);
      await _writeCache(cache);
    }
  }

  @override
  Future<void> cancelAllForUser(String userId) async {
    final cache = await _readCache();
    final entries =
        cache.values.where((item) => item.userId == userId).toList();
    for (final entry in entries) {
      await _plugin.cancel(id: entry.notificationId);
      cache.remove(entry.reminderId);
    }
    await _writeCache(cache);
  }

  Future<void> _scheduleNotification(
    TodoReminder reminder,
    LocalReminderScheduleEntry scheduled,
  ) async {
    var scheduledAt = DateTime.parse(scheduled.scheduledAt).toLocal();
    if (!scheduledAt.isAfter(DateTime.now())) {
      scheduledAt = DateTime.now().add(const Duration(minutes: 1));
    }
    const details = NotificationDetails(
      android: AndroidNotificationDetails(
        _channelId,
        _channelName,
        channelDescription: '已同步到本机的业务待办计划提醒',
        importance: Importance.high,
        priority: Priority.high,
        category: AndroidNotificationCategory.reminder,
      ),
      windows: WindowsNotificationDetails(),
    );
    final scheduleMode = _exactAlarmsAllowed
        ? AndroidScheduleMode.exactAllowWhileIdle
        : AndroidScheduleMode.inexactAllowWhileIdle;
    try {
      await _plugin.zonedSchedule(
        id: scheduled.notificationId,
        title: '你有一项待办需要处理',
        body: '请打开品鉴酱酒中心查看待办详情。',
        scheduledDate: tz.TZDateTime.from(scheduledAt, tz.local),
        notificationDetails: details,
        androidScheduleMode: scheduleMode,
        payload: 'todo:${reminder.id}',
      );
    } catch (_) {
      if (scheduleMode == AndroidScheduleMode.inexactAllowWhileIdle) rethrow;
      _exactAlarmsAllowed = false;
      await _plugin.zonedSchedule(
        id: scheduled.notificationId,
        title: '你有一项待办需要处理',
        body: '请打开品鉴酱酒中心查看待办详情。',
        scheduledDate: tz.TZDateTime.from(scheduledAt, tz.local),
        notificationDetails: details,
        androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
        payload: 'todo:${reminder.id}',
      );
    }
  }

  void _handleResponse(NotificationResponse response) {
    _handlePayload(response.payload);
  }

  void _handlePayload(String? payload) {
    if (payload?.startsWith('todo:') ?? false) {
      final id = payload!.substring(5);
      if (id.isNotEmpty) _onActivated?.call(id);
    }
  }

  Future<Map<String, LocalReminderScheduleEntry>> _readCache() async {
    final preferences = await SharedPreferences.getInstance();
    final raw = preferences.getString(_cacheKey);
    if (raw == null || raw.isEmpty) return {};
    try {
      final values = jsonDecode(raw);
      if (values is! List) return {};
      final result = <String, LocalReminderScheduleEntry>{};
      for (final value in values.whereType<Map>()) {
        final item = LocalReminderScheduleEntry.fromJson(value);
        if (item.reminderId.isNotEmpty && item.notificationId != 0) {
          result[item.reminderId] = item;
        }
      }
      return result;
    } catch (_) {
      return {};
    }
  }

  Future<void> _writeCache(
    Map<String, LocalReminderScheduleEntry> cache,
  ) async {
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString(
      _cacheKey,
      jsonEncode(cache.values.map((item) => item.toJson()).toList()),
    );
  }
}

@visibleForTesting
class LocalReminderScheduleEntry {
  const LocalReminderScheduleEntry({
    required this.reminderId,
    required this.userId,
    required this.notificationId,
    required this.scheduledAt,
  });

  final String reminderId;
  final String userId;
  final int notificationId;
  final String scheduledAt;

  factory LocalReminderScheduleEntry.fromReminder(
    TodoReminder reminder,
    String userId,
  ) {
    return LocalReminderScheduleEntry(
      reminderId: reminder.id,
      userId: userId,
      notificationId: _stableNotificationId('$userId:${reminder.id}'),
      scheduledAt: reminder.effectiveRemindAt.toUtc().toIso8601String(),
    );
  }

  factory LocalReminderScheduleEntry.fromJson(Map<dynamic, dynamic> json) {
    return LocalReminderScheduleEntry(
      reminderId: '${json['reminderId'] ?? ''}',
      userId: '${json['userId'] ?? ''}',
      notificationId: int.tryParse('${json['notificationId']}') ?? 0,
      scheduledAt: '${json['scheduledAt'] ?? ''}',
    );
  }

  Map<String, dynamic> toJson() => {
        'reminderId': reminderId,
        'userId': userId,
        'notificationId': notificationId,
        'scheduledAt': scheduledAt,
      };

  @override
  bool operator ==(Object other) =>
      other is LocalReminderScheduleEntry &&
      other.reminderId == reminderId &&
      other.userId == userId &&
      other.notificationId == notificationId &&
      other.scheduledAt == scheduledAt;

  @override
  int get hashCode =>
      Object.hash(reminderId, userId, notificationId, scheduledAt);
}

@visibleForTesting
class LocalReminderScheduleDiff {
  const LocalReminderScheduleDiff({
    required this.cancel,
    required this.scheduleReminderIds,
  });

  final List<LocalReminderScheduleEntry> cancel;
  final Set<String> scheduleReminderIds;
}

@visibleForTesting
LocalReminderScheduleDiff buildLocalReminderScheduleDiff({
  required List<TodoReminder> reminders,
  required String userId,
  required Iterable<LocalReminderScheduleEntry> existing,
}) {
  final desired = <String, LocalReminderScheduleEntry>{
    for (final reminder in reminders.where((item) => item.isActive))
      reminder.id: LocalReminderScheduleEntry.fromReminder(reminder, userId),
  };
  final currentForUser = {
    for (final entry in existing.where((item) => item.userId == userId))
      entry.reminderId: entry,
  };
  final cancel = currentForUser.values
      .where((entry) => desired[entry.reminderId] != entry)
      .toList();
  final schedule = desired.entries
      .where((entry) => currentForUser[entry.key] != entry.value)
      .map((entry) => entry.key)
      .toSet();
  return LocalReminderScheduleDiff(
    cancel: cancel,
    scheduleReminderIds: schedule,
  );
}

int _stableNotificationId(String value) {
  var hash = 0x811c9dc5;
  for (final unit in value.codeUnits) {
    hash ^= unit;
    hash = (hash * 0x01000193) & 0x7fffffff;
  }
  return hash == 0 ? 1 : hash;
}
