import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/ai_assistant/ai_assistant_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets('loads capabilities and templates for stage 9 roles',
      (tester) async {
    final roleTemplates = <UserRole, String>{
      UserRole.superAdmin: 'super_admin template',
      UserRole.admin: 'admin template',
      UserRole.boss: 'boss template',
      UserRole.finance: 'finance template',
      UserRole.afterSales: 'after_sales template',
    };

    for (final entry in roleTemplates.entries) {
      final role = entry.key;
      final client = _FakeAiApiClient(
        capabilities: _capabilities(role: role.value),
        templates: [
          _template(
            id: '${role.value}_template',
            title: entry.value,
            question: '${role.value} question?',
          ),
        ],
      );

      await tester.pumpWidget(_page(client, role: role));
      await tester.pumpAndSettle();

      expect(find.text('AI 能力'), findsOneWidget);
      expect(find.text('${role.value} scope'), findsOneWidget);
      expect(find.text(entry.value), findsOneWidget);
      for (final otherTemplate in roleTemplates.values.where(
        (template) => template != entry.value,
      )) {
        expect(find.text(otherTemplate), findsNothing);
      }
      expect(client.getPaths.map((path) => Uri.parse(path).path), [
        '/api/ai/capabilities',
        '/api/ai/chat/templates',
        '/api/ai/chat/history',
      ]);

      await tester.pumpWidget(const SizedBox.shrink());
    }
  });

  testWidgets('shows loading state while capabilities are pending',
      (tester) async {
    final capabilitiesCompleter = Completer<Map<String, dynamic>>();
    final client = _FakeAiApiClient(
      capabilitiesCompleter: capabilitiesCompleter,
      templates: [
        _template(
          id: 'boss_sales',
          title: '老板销售额',
          question: '今天销售额是多少？',
        ),
      ],
    );

    await tester.pumpWidget(_page(client, role: UserRole.boss));
    await tester.pump();

    expect(find.byKey(const ValueKey('ai-initial-loading')), findsOneWidget);
    expect(find.text('加载中'), findsOneWidget);
    final input = tester.widget<TextField>(
      find.byKey(const ValueKey('ai-question-input')),
    );
    expect(input.enabled, isFalse);

    capabilitiesCompleter.complete(_capabilities(role: 'boss'));
    await tester.pumpAndSettle();

    expect(find.text('老板销售额'), findsOneWidget);
    expect(find.text('已启用'), findsOneWidget);
  });

  testWidgets('sends template question and renders answer metadata',
      (tester) async {
    final completer = Completer<Map<String, dynamic>>();
    final client = _FakeAiApiClient(
      capabilities: _capabilities(role: 'boss'),
      templates: [
        _template(
          id: 'management_sales_amount',
          title: '销售额',
          question: '今天销售额是多少？',
        ),
      ],
      chatCompleter: completer,
    );

    await tester.pumpWidget(_page(client, role: UserRole.boss));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey(
      'ai-template-management_sales_amount',
    )));
    await tester.pump();

    expect(find.text('今天销售额是多少？'), findsWidgets);
    expect(find.byKey(const ValueKey('ai-response-loading')), findsOneWidget);
    expect(client.lastPostBody?['question'], '今天销售额是多少？');
    expect(client.lastPostBody?['conversationId'], isNotEmpty);

    completer.complete(_chatResponse());
    await tester.pumpAndSettle();

    expect(find.text('按今天数据看，净销售额为 1000 元。'), findsOneWidget);
    expect(find.textContaining('查询范围：2026-07-05 至 2026-07-05'), findsOneWidget);
    expect(find.text('来源摘要'), findsOneWidget);
    expect(find.textContaining('analytics.overview'), findsOneWidget);
    expect(find.text('风险提示'), findsOneWidget);
    expect(find.text('当前仅基于已标记数据。'), findsOneWidget);
  });

  testWidgets('shows recent history and restores selected answer',
      (tester) async {
    final client = _FakeAiApiClient(
      capabilities: _capabilities(role: 'after_sales'),
      templates: [
        _template(
          id: 'after_sales_order',
          title: '售后订单',
          question: '查一下客户订单',
        ),
      ],
      historyItems: [
        _historyItem(
          id: 'history-1',
          question: '历史客户订单问题',
          answer: '历史回答：该客户有 1 笔订单。',
          intent: 'customer_order_lookup',
        ),
      ],
    );

    await tester.pumpWidget(_page(client, role: UserRole.afterSales));
    await tester.pumpAndSettle();

    expect(find.text('最近问答'), findsOneWidget);
    expect(find.text('历史客户订单问题'), findsOneWidget);

    final historyFinder = find.byKey(const ValueKey('ai-history-history-1'));
    await tester.ensureVisible(historyFinder);
    await tester.pumpAndSettle();
    await tester.tap(historyFinder);
    await tester.pumpAndSettle();

    expect(find.text('历史详情'), findsOneWidget);
    expect(find.text('历史回答：该客户有 1 笔订单。'), findsOneWidget);
    expect(find.textContaining('全局标记过滤：已开启'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('ai-history-restore')));
    await tester.pumpAndSettle();

    expect(find.text('历史详情'), findsNothing);
    expect(find.text('历史客户订单问题'), findsWidgets);
    expect(find.text('历史回答：该客户有 1 笔订单。'), findsOneWidget);
    expect(find.text('历史记录仅展示当前登录用户。'), findsOneWidget);
  });

  testWidgets('shows chat error and retries last question', (tester) async {
    final client = _FakeAiApiClient(
      capabilities: _capabilities(role: 'finance'),
      templates: [
        _template(
          id: 'finance_refund',
          title: '退款',
          question: '本月退款是多少？',
        ),
      ],
      chatError: const ApiException(
        statusCode: 500,
        code: 'HTTP_ERROR',
        message: 'server error',
      ),
      chatErrorOnce: true,
    );

    await tester.pumpWidget(_page(client, role: UserRole.finance));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const ValueKey('ai-question-input')),
      '本月退款是多少？',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('ai-send-button')));
    await tester.pumpAndSettle();

    expect(find.text('AI 服务暂时不可用，请稍后重试。'), findsOneWidget);
    expect(client.postPaths, hasLength(1));

    await tester.tap(find.byKey(const ValueKey('ai-retry-send')));
    await tester.pumpAndSettle();

    expect(client.postPaths, hasLength(2));
    expect(find.text('按今天数据看，净销售额为 1000 元。'), findsOneWidget);
  });

  testWidgets('maps common AI API status errors', (tester) async {
    final cases = <ApiException, String>{
      const ApiException(
        statusCode: 401,
        code: 'UNAUTHORIZED',
        message: 'unauthorized',
      ): '登录已失效，请重新登录后再使用 AI 助手。',
      const ApiException(
        statusCode: 403,
        code: 'AI_ROLE_NOT_ALLOWED',
        message: 'forbidden',
      ): '当前角色没有使用 AI 助手的权限。',
      const ApiException(
        statusCode: 403,
        code: 'AI_PERMISSION_DENIED',
        message: 'forbidden',
      ): '当前问题超出该角色可访问的 AI 数据范围。',
      const ApiException(
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'forbidden',
      ): 'AI 请求被拒绝，请确认当前账号权限或联系管理员。',
      const ApiException(
        statusCode: 429,
        code: 'AI_DAILY_LIMIT_EXCEEDED',
        message: 'too many requests',
      ): 'AI 请求过于频繁，请稍后再试。',
      const ApiException(
        statusCode: 500,
        code: 'AI_MODEL_TIMEOUT',
        message: 'timeout',
      ): 'AI 模型暂时不可用，系统没有暴露任何业务数据，请稍后重试或联系管理员。',
    };

    for (final entry in cases.entries) {
      final client = _FakeAiApiClient(
        capabilities: _capabilities(role: 'boss'),
        templates: [
          _template(id: 'q', title: '问题', question: '问题？'),
        ],
        chatError: entry.key,
      );

      await tester.pumpWidget(_page(client, role: UserRole.boss));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('ai-question-input')),
        '问题？',
      );
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('ai-send-button')));
      await tester.pumpAndSettle();

      expect(find.text(entry.value), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    }
  });

  testWidgets('shows disabled and model unavailable states', (tester) async {
    final disabledClient = _FakeAiApiClient(
      capabilities: _capabilities(role: 'boss', enabled: false),
    );

    await tester.pumpWidget(_page(disabledClient, role: UserRole.boss));
    await tester.pumpAndSettle();
    expect(find.textContaining('AI 助手未启用'), findsWidgets);

    final modelUnavailableClient = _FakeAiApiClient(
      capabilities: _capabilities(
        role: 'boss',
        mockMode: false,
        hasApiKey: false,
      ),
      templates: [
        _template(id: 'q', title: '问题', question: '问题？'),
      ],
    );

    await tester.pumpWidget(
      _page(modelUnavailableClient, role: UserRole.boss),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('AI 模型未配置或暂不可用'), findsWidgets);
  });

  testWidgets('shows 403 no permission state from capabilities loading',
      (tester) async {
    final client = _FakeAiApiClient(
      capabilitiesError: const ApiException(
        statusCode: 403,
        code: 'AI_ROLE_NOT_ALLOWED',
        message: 'forbidden',
      ),
      templates: [
        _template(id: 'hidden', title: '隐藏模板', question: '不可见问题'),
      ],
      historyItems: [
        _historyItem(
          id: 'hidden-history',
          question: '不可见历史',
          answer: '不可见回答',
          intent: 'analytics_overview',
        ),
      ],
    );

    await tester.pumpWidget(_page(client, role: UserRole.sales));
    await tester.pumpAndSettle();

    expect(find.textContaining('当前角色没有使用 AI 助手的权限'), findsWidgets);
    expect(find.text('隐藏模板'), findsNothing);
    expect(find.text('不可见历史'), findsNothing);
    expect(client.getPaths.map((path) => Uri.parse(path).path), [
      '/api/ai/capabilities',
    ]);
    final input = tester.widget<TextField>(
      find.byKey(const ValueKey('ai-question-input')),
    );
    expect(input.enabled, isFalse);
  });

  testWidgets('shows no permission state without templates or history',
      (tester) async {
    final client = _FakeAiApiClient(
      capabilities: _capabilities(
        role: 'sales',
        roleAllowed: false,
        canUseAi: false,
      ),
      templates: [
        _template(id: 'hidden', title: '隐藏模板', question: '不可见问题'),
      ],
      historyItems: [
        _historyItem(
          id: 'hidden-history',
          question: '不可见历史',
          answer: '不可见回答',
          intent: 'analytics_overview',
        ),
      ],
    );

    await tester.pumpWidget(_page(client, role: UserRole.sales));
    await tester.pumpAndSettle();

    expect(find.textContaining('当前角色暂无 AI 助手权限'), findsWidgets);
    expect(find.text('隐藏模板'), findsNothing);
    expect(find.text('不可见历史'), findsNothing);
    expect(client.getPaths.map((path) => Uri.parse(path).path), [
      '/api/ai/capabilities',
    ]);
    final input = tester.widget<TextField>(
      find.byKey(const ValueKey('ai-question-input')),
    );
    expect(input.enabled, isFalse);
  });

  testWidgets(
      'template 403 or 500 stays isolated and manual questions remain usable',
      (tester) async {
    for (final error in [
      const ApiException(
        statusCode: 403,
        code: 'AI_PERMISSION_DENIED',
        message: 'forbidden',
      ),
      const ApiException(
        statusCode: 500,
        code: 'AI_TEMPLATES_FAILED',
        message: 'server error',
      ),
    ]) {
      final client = _FakeAiApiClient(
        capabilities: _capabilities(role: 'super_admin'),
        templatesError: error,
      );

      await tester.pumpWidget(
        _page(client, role: UserRole.superAdmin),
      );
      await tester.pumpAndSettle();

      expect(find.text('已启用'), findsOneWidget);
      final input = tester.widget<TextField>(
        find.byKey(const ValueKey('ai-question-input')),
      );
      expect(input.enabled, isTrue);
      expect(
        find.byKey(const ValueKey('ai-retry-templates')),
        findsOneWidget,
      );
      expect(
        find.text(
          error.statusCode == 403
              ? '当前问题超出该角色可访问的 AI 数据范围。'
              : 'AI 服务暂时不可用，请稍后重试。',
        ),
        findsOneWidget,
      );

      await tester.enterText(
        find.byKey(const ValueKey('ai-question-input')),
        '请查询今天销售额',
      );
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('ai-send-button')));
      await tester.pumpAndSettle();

      expect(client.postPaths, hasLength(1));
      expect(client.lastPostBody?['question'], '请查询今天销售额');
      expect(find.text('按今天数据看，净销售额为 1000 元。'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    }
  });

  testWidgets('template retry reloads common questions without disabling chat',
      (tester) async {
    final client = _FakeAiApiClient(
      capabilities: _capabilities(role: 'super_admin'),
      templates: [
        _template(
          id: 'super_admin_sales',
          title: '超级管理员销售额',
          question: '今天销售额是多少？',
        ),
      ],
      templatesError: const ApiException(
        statusCode: 500,
        code: 'AI_TEMPLATES_FAILED',
        message: 'server error',
      ),
      templatesErrorOnce: true,
    );

    await tester.pumpWidget(
      _page(client, role: UserRole.superAdmin),
    );
    await tester.pumpAndSettle();
    expect(find.text('超级管理员销售额'), findsNothing);

    final retryTemplates = find.byKey(const ValueKey('ai-retry-templates'));
    await tester.ensureVisible(retryTemplates);
    await tester.pumpAndSettle();
    await tester.tap(retryTemplates);
    await tester.pumpAndSettle();

    expect(find.text('超级管理员销售额'), findsOneWidget);
    expect(find.text('已启用'), findsOneWidget);
  });

  testWidgets('history failure does not disable or block manual questions',
      (tester) async {
    final client = _FakeAiApiClient(
      capabilities: _capabilities(role: 'super_admin'),
      templates: [
        _template(id: 'sales', title: '销售额', question: '今天销售额是多少？'),
      ],
      historyError: const ApiException(
        statusCode: 500,
        code: 'AI_HISTORY_FAILED',
        message: 'server error',
      ),
    );

    await tester.pumpWidget(
      _page(client, role: UserRole.superAdmin),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('ai-retry-history')), findsOneWidget);
    final input = tester.widget<TextField>(
      find.byKey(const ValueKey('ai-question-input')),
    );
    expect(input.enabled, isTrue);

    await tester.enterText(
      find.byKey(const ValueKey('ai-question-input')),
      '查询今天销售额',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('ai-send-button')));
    await tester.pumpAndSettle();

    expect(client.postPaths, hasLength(1));
    expect(find.text('按今天数据看，净销售额为 1000 元。'), findsOneWidget);
    expect(find.byKey(const ValueKey('ai-retry-history')), findsOneWidget);
  });
}

Widget _page(_FakeAiApiClient client, {required UserRole role}) {
  return MaterialApp(
    home: Scaffold(
      body: AiAssistantPage(
        apiClient: client,
        token: 'test-token',
        role: role,
      ),
    ),
  );
}

Map<String, dynamic> _capabilities({
  required String role,
  bool enabled = true,
  bool roleAllowed = true,
  bool canUseAi = true,
  bool mockMode = true,
  bool hasApiKey = false,
}) {
  return {
    'data': {
      'enabled': enabled,
      'role': role,
      'roleAllowed': roleAllowed,
      'canUseAi': canUseAi,
      'scopeDescription': '$role scope',
      'allowedIntents': ['analytics_overview'],
      'tools': [
        {
          'toolName': 'analytics.overview',
          'intent': 'analytics_overview',
          'readOnly': true,
          'description': '经营看板',
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
        'mockMode': mockMode,
        'provider': mockMode ? 'mock' : 'openai-compatible',
        'modelName': mockMode ? 'mock-model' : 'prod-model',
        'hasApiKey': hasApiKey,
      },
      'constraints': {
        'readOnly': true,
        'historyScope': 'self',
        'canGenerateSql': false,
        'canExecuteSql': false,
        'canWriteBusinessData': false,
      },
    },
  };
}

Map<String, dynamic> _template({
  required String id,
  required String title,
  required String question,
}) {
  return {
    'id': id,
    'title': title,
    'question': question,
    'intent': 'analytics_overview',
    'roleScopes': ['boss'],
  };
}

Map<String, dynamic> _chatResponse() {
  return {
    'data': {
      'answer': '按今天数据看，净销售额为 1000 元。',
      'intent': 'analytics_overview',
      'range': {
        'preset': 'today',
        'dateFrom': '2026-07-05',
        'dateTo': '2026-07-05',
        'timezone': 'Asia/Shanghai',
      },
      'sourceSummary': [
        {
          'toolName': 'analytics.overview',
          'rowCount': 3,
          'dateFrom': '2026-07-05',
          'dateTo': '2026-07-05',
          'globalMarkedFilterEnabled': true,
          'scopeDescription': 'boss scope',
        },
      ],
      'warnings': ['当前仅基于已标记数据。'],
    },
  };
}

Map<String, dynamic> _historyItem({
  required String id,
  required String question,
  required String answer,
  required String intent,
}) {
  return {
    'id': id,
    'conversationId': 'conv-$id',
    'question': question,
    'answer': answer,
    'intent': intent,
    'dataScope': {
      'range': {
        'preset': 'today',
        'dateFrom': '2026-07-05',
        'dateTo': '2026-07-05',
        'timezone': 'Asia/Shanghai',
      },
    },
    'toolCalls': [
      {
        'toolName': 'customer.orderLookup',
        'rowCount': 1,
        'globalMarkedFilterEnabled': true,
        'warnings': ['历史记录仅展示当前登录用户。'],
      },
    ],
    'sourceSummary': [
      {
        'toolName': 'customer.orderLookup',
        'rowCount': 1,
        'dateFrom': '2026-07-05',
        'dateTo': '2026-07-05',
        'globalMarkedFilterEnabled': true,
        'scopeDescription': 'after_sales scope',
      },
    ],
    'warnings': ['历史记录仅展示当前登录用户。'],
    'modelProvider': 'mock',
    'modelName': 'mock-model',
    'promptTokens': 10,
    'completionTokens': 20,
    'latencyMs': 30,
    'errorCode': null,
    'createdAt': '2026-07-05T08:00:00.000Z',
  };
}

class _FakeAiApiClient extends ApiClient {
  _FakeAiApiClient({
    Map<String, dynamic>? capabilities,
    List<Map<String, dynamic>>? templates,
    List<Map<String, dynamic>>? historyItems,
    Map<String, dynamic>? chatResponse,
    this.capabilitiesCompleter,
    this.capabilitiesError,
    this.templatesError,
    this.templatesErrorOnce = false,
    this.historyError,
    this.chatCompleter,
    this.chatError,
    this.chatErrorOnce = false,
  })  : capabilities = capabilities ?? _capabilities(role: 'boss'),
        templates = templates ?? const <Map<String, dynamic>>[],
        historyItems = historyItems ?? const <Map<String, dynamic>>[],
        chatResponse = chatResponse ?? _chatResponse(),
        super(baseUrl: 'http://localhost');

  final Map<String, dynamic> capabilities;
  final List<Map<String, dynamic>> templates;
  final List<Map<String, dynamic>> historyItems;
  final Map<String, dynamic> chatResponse;
  final Completer<Map<String, dynamic>>? capabilitiesCompleter;
  final ApiException? capabilitiesError;
  ApiException? templatesError;
  final bool templatesErrorOnce;
  ApiException? historyError;
  final Completer<Map<String, dynamic>>? chatCompleter;
  ApiException? chatError;
  final bool chatErrorOnce;

  final getPaths = <String>[];
  final postPaths = <String>[];
  final tokens = <String?>[];
  Map<String, dynamic>? lastPostBody;

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    getPaths.add(path);
    tokens.add(token);
    final uriPath = Uri.parse(path).path;
    if (uriPath == '/api/ai/capabilities') {
      final error = capabilitiesError;
      if (error != null) {
        throw error;
      }
      final completer = capabilitiesCompleter;
      if (completer != null) {
        return completer.future;
      }
      return capabilities;
    }
    if (uriPath == '/api/ai/chat/templates') {
      final error = templatesError;
      if (error != null) {
        if (templatesErrorOnce) {
          templatesError = null;
        }
        throw error;
      }
      return {'data': templates};
    }
    if (uriPath == '/api/ai/chat/history') {
      final error = historyError;
      if (error != null) {
        throw error;
      }
      return {
        'data': {
          'items': historyItems,
          'page': 1,
          'pageSize': 5,
          'total': historyItems.length,
          'totalPages': historyItems.isEmpty ? 0 : 1,
        },
      };
    }
    return <String, dynamic>{'data': <String, dynamic>{}};
  }

  @override
  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    postPaths.add(path);
    tokens.add(token);
    lastPostBody = body;
    final error = chatError;
    if (error != null) {
      if (chatErrorOnce) {
        chatError = null;
      }
      throw error;
    }
    final completer = chatCompleter;
    if (completer != null) {
      return completer.future;
    }
    return chatResponse;
  }
}
