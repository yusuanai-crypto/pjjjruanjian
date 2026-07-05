import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/business/business_api.dart';

void main() {
  test('parses stage 9 AI JSON models', () {
    expect(
      const AiChatRequest(question: 'sales?', conversationId: '  ').toJson(),
      {'question': 'sales?'},
    );

    final chat = AiChatResponse.fromJson({
      'answer': 'mock answer',
      'intent': 'analytics_overview',
      'range': {
        'preset': 'this_month',
        'dateFrom': '2026-07-01',
        'dateTo': '2026-07-31',
        'timezone': 'Asia/Shanghai',
      },
      'sourceSummary': [
        {
          'toolName': 'analytics.overview',
          'rowCount': 8,
          'dateFrom': '2026-07-01',
          'dateTo': '2026-07-31',
          'globalMarkedFilterEnabled': true,
          'scopeDescription': 'admin full scope',
        },
      ],
      'warnings': [
        'marked records only',
        {'code': 'MODEL_FALLBACK', 'message': 'fallback answer'},
      ],
    });

    expect(chat.answer, 'mock answer');
    expect(chat.intent, 'analytics_overview');
    expect(chat.range?.preset, 'this_month');
    expect(chat.sourceSummary.single.toolName, 'analytics.overview');
    expect(chat.sourceSummary.single.globalMarkedFilterEnabled, isTrue);
    expect(chat.warnings.map((item) => item.message), [
      'marked records only',
      'fallback answer',
    ]);

    final template = AiChatTemplate.fromJson({
      'id': 'management_sales_amount',
      'title': 'Sales amount',
      'question': 'How much did we sell today?',
      'intent': 'analytics_overview',
      'roleScopes': ['admin', 'boss'],
    });
    expect(template.roleScopes, ['admin', 'boss']);

    final history = AiChatHistoryPage.fromJson({
      'items': [
        {
          'id': 'msg-1',
          'conversationId': 'conv-1',
          'question': 'sales?',
          'answer': 'mock answer',
          'intent': 'analytics_overview',
          'dataScope': {
            'range': {'preset': 'this_month'},
          },
          'toolCalls': [
            {
              'toolName': 'analytics.overview',
              'rowCount': 8,
              'globalMarkedFilterEnabled': true,
              'warnings': ['limited'],
            },
          ],
          'sourceSummary': [
            {
              'toolName': 'analytics.overview',
              'rowCount': 8,
              'globalMarkedFilterEnabled': true,
              'scopeDescription': 'admin full scope',
            },
          ],
          'warnings': ['marked records only'],
          'modelProvider': 'mock',
          'modelName': 'mock-model',
          'promptTokens': 12,
          'completionTokens': 20,
          'latencyMs': 30,
          'errorCode': null,
          'createdAt': '2026-07-05T08:00:00.000Z',
        },
      ],
      'page': 1,
      'pageSize': 20,
      'total': 1,
      'totalPages': 1,
    });

    expect(history.items.single.conversationId, 'conv-1');
    expect(history.items.single.toolCalls.single.warnings.single.message,
        'limited');
    expect(history.items.single.modelProvider, 'mock');
    expect(history.totalPages, 1);

    final capabilities = AiCapabilities.fromJson({
      'enabled': true,
      'role': 'finance',
      'roleAllowed': true,
      'canUseAi': true,
      'scopeDescription': 'finance scope',
      'allowedIntents': ['finance_summary', 'refund_query'],
      'tools': [
        {
          'toolName': 'finance.summary',
          'intent': 'finance_summary',
          'readOnly': true,
          'description': 'finance summary',
        },
      ],
      'limits': {
        'maxQuestionLength': 500,
        'dailyLimitPerUser': 50,
        'historyRetentionDays': 90,
        'timeoutMs': 15000,
        'historyPageSizeDefault': 20,
        'historyPageSizeMax': 100,
      },
      'model': {
        'mockMode': true,
        'provider': 'mock',
        'modelName': 'mock-model',
        'hasApiKey': false,
      },
      'constraints': {
        'readOnly': true,
        'historyScope': 'self',
        'canGenerateSql': false,
        'canExecuteSql': false,
        'canWriteBusinessData': false,
      },
    });

    expect(capabilities.canUseAi, isTrue);
    expect(capabilities.tools.single.readOnly, isTrue);
    expect(capabilities.limits.maxQuestionLength, 500);
    expect(capabilities.model.hasApiKey, isFalse);
    expect(capabilities.constraints.canExecuteSql, isFalse);
  });

  test('BusinessApi calls stage 9 AI endpoints', () async {
    final client = _RecordingApiClient();
    final api = BusinessApi(apiClient: client, token: 'token-1');

    client.nextJson = {
      'data': {
        'answer': 'mock answer',
        'intent': 'analytics_overview',
        'range': {'preset': 'today'},
        'sourceSummary': <Map<String, Object?>>[],
        'warnings': <String>[],
      },
    };
    final chat = await api.sendAiChatMessage(
      const AiChatRequest(question: 'sales?', conversationId: 'conv-1'),
    );

    expect(chat.answer, 'mock answer');
    expect(client.lastMethod, 'POST');
    expect(client.lastPath, '/api/ai/chat');
    expect(client.lastToken, 'token-1');
    expect(client.lastBody, {
      'question': 'sales?',
      'conversationId': 'conv-1',
    });

    client.nextJson = {
      'data': [
        {
          'id': 'management_sales_amount',
          'title': 'Sales amount',
          'question': 'How much did we sell today?',
          'intent': 'analytics_overview',
          'roleScopes': ['admin', 'boss'],
        },
      ],
    };
    final templates = await api.getAiChatTemplates();
    expect(templates.single.intent, 'analytics_overview');
    expect(client.lastMethod, 'GET');
    expect(client.lastPath, '/api/ai/chat/templates');

    client.nextJson = {
      'data': {
        'items': <Map<String, Object?>>[],
        'page': 2,
        'pageSize': 5,
        'total': 0,
        'totalPages': 0,
      },
    };
    final history = await api.getAiChatHistory(
      page: 2,
      pageSize: 5,
      conversationId: 'conv-1',
      intent: 'analytics_overview',
      dateFrom: DateTime(2026, 7, 1),
      dateTo: DateTime(2026, 7, 5),
    );

    final historyUri = Uri.parse(client.lastPath!);
    expect(history.page, 2);
    expect(client.lastMethod, 'GET');
    expect(historyUri.path, '/api/ai/chat/history');
    expect(historyUri.queryParameters['page'], '2');
    expect(historyUri.queryParameters['pageSize'], '5');
    expect(historyUri.queryParameters['conversationId'], 'conv-1');
    expect(historyUri.queryParameters['intent'], 'analytics_overview');
    expect(historyUri.queryParameters['dateFrom'], '2026-07-01');
    expect(historyUri.queryParameters['dateTo'], '2026-07-05');

    client.nextJson = {
      'data': {
        'enabled': true,
        'role': 'boss',
        'roleAllowed': true,
        'canUseAi': true,
        'scopeDescription': 'boss scope',
        'allowedIntents': ['analytics_overview'],
        'tools': <Map<String, Object?>>[],
        'limits': <String, Object?>{},
        'model': {'mockMode': true, 'hasApiKey': false},
        'constraints': {
          'readOnly': true,
          'historyScope': 'self',
          'canGenerateSql': false,
          'canExecuteSql': false,
          'canWriteBusinessData': false,
        },
      },
    };
    final capabilities = await api.getAiCapabilities();
    expect(capabilities.role, 'boss');
    expect(client.lastMethod, 'GET');
    expect(client.lastPath, '/api/ai/capabilities');
  });
}

class _RecordingApiClient extends ApiClient {
  _RecordingApiClient() : super(baseUrl: 'http://localhost');

  Map<String, dynamic> nextJson = <String, dynamic>{};
  String? lastMethod;
  String? lastPath;
  String? lastToken;
  Map<String, dynamic>? lastBody;

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    lastMethod = 'GET';
    lastPath = path;
    lastToken = token;
    lastBody = null;
    return nextJson;
  }

  @override
  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    lastMethod = 'POST';
    lastPath = path;
    lastToken = token;
    lastBody = body;
    return nextJson;
  }
}
