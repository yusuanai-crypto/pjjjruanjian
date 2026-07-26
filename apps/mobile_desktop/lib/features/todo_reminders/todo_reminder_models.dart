class TodoReminderSummary {
  const TodoReminderSummary({
    required this.unfinished,
    required this.unread,
    required this.todayDue,
    required this.overdue,
    required this.urgent,
  });

  const TodoReminderSummary.empty()
      : unfinished = 0,
        unread = 0,
        todayDue = 0,
        overdue = 0,
        urgent = 0;

  final int unfinished;
  final int unread;
  final int todayDue;
  final int overdue;
  final int urgent;

  factory TodoReminderSummary.fromJson(Map<String, dynamic> json) {
    return TodoReminderSummary(
      unfinished: _int(json['unfinished']),
      unread: _int(json['unread']),
      todayDue: _int(json['todayDue']),
      overdue: _int(json['overdue']),
      urgent: _int(json['urgent']),
    );
  }
}

class TodoReminder {
  const TodoReminder({
    required this.id,
    required this.todoId,
    required this.ruleCode,
    required this.sourceType,
    required this.sourceId,
    required this.sourceNumber,
    required this.title,
    required this.content,
    required this.priority,
    required this.status,
    required this.recipientReason,
    required this.dueAt,
    required this.readAt,
    required this.personalNote,
    required this.personalRemindAt,
    required this.snoozedUntil,
    required this.archivedAt,
  });

  final String id;
  final String todoId;
  final String ruleCode;
  final String sourceType;
  final String sourceId;
  final String sourceNumber;
  final String title;
  final String content;
  final String priority;
  final String status;
  final String recipientReason;
  final DateTime dueAt;
  final DateTime? readAt;
  final String? personalNote;
  final DateTime? personalRemindAt;
  final DateTime? snoozedUntil;
  final DateTime? archivedAt;

  bool get isActive => status == 'ACTIVE';
  bool get isUnread => readAt == null;
  bool get isOverdue => isActive && dueAt.isBefore(DateTime.now());
  DateTime get effectiveRemindAt => snoozedUntil ?? personalRemindAt ?? dueAt;

  factory TodoReminder.fromJson(Map<String, dynamic> json) {
    return TodoReminder(
      id: _string(json['id']),
      todoId: _string(json['todoId']),
      ruleCode: _string(json['ruleCode']),
      sourceType: _string(json['sourceType']).toUpperCase(),
      sourceId: _string(json['sourceId']),
      sourceNumber: _string(json['sourceNumber']),
      title: _string(json['title']),
      content: _string(json['content']),
      priority: _string(json['priority']).toUpperCase(),
      status: _string(json['status']).toUpperCase(),
      recipientReason: _string(json['recipientReason']).toUpperCase(),
      dueAt: _date(json['dueAt']) ?? DateTime.now(),
      readAt: _date(json['readAt']),
      personalNote: _nullableString(json['personalNote']),
      personalRemindAt: _date(json['personalRemindAt']),
      snoozedUntil: _date(json['snoozedUntil']),
      archivedAt: _date(json['archivedAt']),
    );
  }
}

class TodoReminderPageData {
  const TodoReminderPageData({
    required this.reminders,
    required this.page,
    required this.pageSize,
    required this.total,
    required this.totalPages,
  });

  final List<TodoReminder> reminders;
  final int page;
  final int pageSize;
  final int total;
  final int totalPages;

  factory TodoReminderPageData.fromJson(Map<String, dynamic> json) {
    final values = json['reminders'];
    return TodoReminderPageData(
      reminders: values is List
          ? values
              .whereType<Map>()
              .map((item) => TodoReminder.fromJson(
                    item.map(
                      (key, value) => MapEntry(key.toString(), value),
                    ),
                  ))
              .toList()
          : const <TodoReminder>[],
      page: _int(json['page'], 1),
      pageSize: _int(json['pageSize'], 20),
      total: _int(json['total']),
      totalPages: _int(json['totalPages']),
    );
  }
}

Map<String, dynamic> todoPayloadData(Map<String, dynamic> payload) {
  final data = payload['data'];
  if (data is Map<String, dynamic>) {
    return data;
  }
  if (data is Map) {
    return data.map((key, value) => MapEntry(key.toString(), value));
  }
  return payload;
}

int _int(Object? value, [int fallback = 0]) {
  if (value is int) return value;
  return int.tryParse('$value') ?? fallback;
}

String _string(Object? value) => value?.toString() ?? '';

String? _nullableString(Object? value) {
  final text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}

DateTime? _date(Object? value) {
  final text = value?.toString() ?? '';
  return text.isEmpty ? null : DateTime.tryParse(text)?.toLocal();
}
