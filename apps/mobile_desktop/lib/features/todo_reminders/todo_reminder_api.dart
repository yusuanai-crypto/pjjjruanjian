import '../../core/api/api_client.dart';
import 'todo_reminder_models.dart';

class TodoReminderApi {
  const TodoReminderApi({
    required ApiClient apiClient,
    required String token,
  })  : _apiClient = apiClient,
        _token = token;

  final ApiClient _apiClient;
  final String _token;

  Future<TodoReminderSummary> summary() async {
    final payload = await _apiClient.getJson(
      '/api/todo-reminders/summary',
      token: _token,
    );
    return TodoReminderSummary.fromJson(todoPayloadData(payload));
  }

  Future<TodoReminderPageData> list({
    String status = 'ACTIVE',
    bool overdue = false,
    bool dueToday = false,
    String? priority,
    String? sourceType,
    String? keyword,
    int page = 1,
    int pageSize = 50,
  }) async {
    final query = <String, String>{
      'status': status,
      'page': '$page',
      'pageSize': '$pageSize',
      if (overdue) 'overdue': 'true',
      if (dueToday) 'dueToday': 'true',
      if (priority != null && priority.isNotEmpty) 'priority': priority,
      if (sourceType != null && sourceType.isNotEmpty) 'sourceType': sourceType,
      if (keyword != null && keyword.trim().isNotEmpty)
        'keyword': keyword.trim(),
    };
    final uri = Uri(path: '/api/todo-reminders', queryParameters: query);
    final payload = await _apiClient.getJson(uri.toString(), token: _token);
    return TodoReminderPageData.fromJson(todoPayloadData(payload));
  }

  Future<TodoReminder> markRead(String id) =>
      _mutation('/api/todo-reminders/$id/read');

  Future<TodoReminder> updatePreferences(
    String id, {
    String? personalNote,
    DateTime? personalRemindAt,
  }) async {
    final payload = await _apiClient.patchJson(
      '/api/todo-reminders/$id/preferences',
      token: _token,
      body: {
        'personalNote': personalNote,
        'personalRemindAt': personalRemindAt?.toUtc().toIso8601String(),
      },
    );
    return TodoReminder.fromJson(todoPayloadData(payload));
  }

  Future<TodoReminder> snooze(String id, DateTime until) => _mutation(
        '/api/todo-reminders/$id/snooze',
        body: {'until': until.toUtc().toIso8601String()},
      );

  Future<TodoReminder> verifyCompletion(String id) =>
      _mutation('/api/todo-reminders/$id/verify-completion');

  Future<TodoReminder> archive(String id) =>
      _mutation('/api/todo-reminders/$id/archive');

  Future<TodoReminder> _mutation(
    String path, {
    Map<String, dynamic>? body,
  }) async {
    final payload = await _apiClient.postJson(
      path,
      token: _token,
      body: body,
    );
    return TodoReminder.fromJson(todoPayloadData(payload));
  }
}
