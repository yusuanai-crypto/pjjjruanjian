import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/business/business_api.dart';
import 'package:jiangjiu_mobile_desktop/features/profit_analysis/profit_analysis_page.dart';
import 'package:jiangjiu_mobile_desktop/shared/widgets/search_filter_bar.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets(
      'profit analysis switches modules and daily loss defaults to today',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final client = _FakeDailyLossApiClient();
    await tester.pumpWidget(_page(client, role: UserRole.warehouse));
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('profit-analysis-table')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('daily-loss-profit-panel')),
      findsNothing,
    );

    await tester.tap(
      find.byKey(
        const ValueKey('profit-analysis-daily-loss-module'),
      ),
    );
    await tester.pumpAndSettle();

    final dailyUri = client.latest(
      '/api/analytics/daily-loss-profits',
    );
    expect(dailyUri.queryParameters['preset'], 'today');
    expect(dailyUri.queryParameters['page'], '1');
    expect(dailyUri.queryParameters['pageSize'], '50');
    expect(
      find.byKey(const ValueKey('daily-loss-profit-metrics')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('daily-loss-profit-table')),
      findsOneWidget,
    );
    expect(find.text('损耗总数量'), findsOneWidget);
    expect(find.text('预计利润损失'), findsWidgets);
    expect(
      find.text('${formatMoneyCents(1234)}（已知）'),
      findsOneWidget,
    );
    expect(find.text('飞天'), findsOneWidget);
    expect(find.text('A1'), findsOneWidget);
    expect(find.text('操作员甲'), findsOneWidget);
    expect(find.text('已核算'), findsOneWidget);
    expect(find.text('成本未配置'), findsOneWidget);
    expect(
      find.byKey(
        const ValueKey('daily-loss-profit-incomplete-warning'),
      ),
      findsOneWidget,
    );
    expect(
      find.textContaining('有 1 条汇总缺少成本，共 3 件/瓶未核算'),
      findsOneWidget,
    );

    await tester.tap(
      find.byKey(
        const ValueKey('profit-analysis-travel-module'),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('profit-analysis-table')),
      findsOneWidget,
    );
  });

  testWidgets('daily loss date range change reloads with custom dates',
      (tester) async {
    final client = _FakeDailyLossApiClient();
    await tester.pumpWidget(_page(client));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(
        const ValueKey('profit-analysis-daily-loss-module'),
      ),
    );
    await tester.pumpAndSettle();

    final rangeButton = tester.widget<AppDateRangeButton>(
      find.byKey(const ValueKey('daily-loss-profit-date-range')),
    );
    rangeButton.onChanged(
      DateTimeRange(
        start: DateTime(2026, 7, 1),
        end: DateTime(2026, 7, 20),
      ),
    );
    await tester.pumpAndSettle();

    final uri = client.latest('/api/analytics/daily-loss-profits');
    expect(uri.queryParameters['preset'], 'custom');
    expect(uri.queryParameters['dateFrom'], '2026-07-01');
    expect(uri.queryParameters['dateTo'], '2026-07-20');
  });

  testWidgets('daily loss narrow layout uses cards without overflow',
      (tester) async {
    tester.view.physicalSize = const Size(390, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final client = _FakeDailyLossApiClient();
    await tester.pumpWidget(_page(client));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(
        const ValueKey('profit-analysis-daily-loss-module'),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('daily-loss-profit-card-list')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('daily-loss-profit-table')),
      findsNothing,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('daily loss export calls the export endpoint and saves file',
      (tester) async {
    final client = _FakeDailyLossApiClient();
    DownloadedFile? savedFile;
    await tester.pumpWidget(
      _page(
        client,
        role: UserRole.warehouse,
        saver: (downloadedFile) async {
          savedFile = downloadedFile;
          return r'D:\exports\daily-loss-profit-test.xlsx';
        },
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(
        const ValueKey('profit-analysis-daily-loss-module'),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('daily-loss-profit-export-button')),
    );
    await tester.pumpAndSettle();

    final uri = client.latest(
      '/api/analytics/daily-loss-profits/export',
    );
    expect(uri.queryParameters['preset'], 'today');
    expect(savedFile?.fileName, 'daily-loss-profit-test.xlsx');
    expect(
      find.textContaining(
        r'D:\exports\daily-loss-profit-test.xlsx',
      ),
      findsOneWidget,
    );
  });

  test('daily loss DTO tolerates missing optional fields', () {
    final response = DailyLossProfitResponse.fromJson({
      'range': {
        'preset': 'today',
        'dateFrom': '2026-07-29',
        'dateTo': '2026-07-29',
      },
      'summary': {
        'rowCount': 1,
        'incompleteRowCount': 1,
      },
      'items': [
        {
          'date': '2026-07-29',
          'productName': '罐装酒',
          'lossQuantity': 2,
        },
      ],
      'pagination': {
        'page': 1,
        'pageSize': 50,
        'total': 1,
        'totalPages': 1,
      },
    });

    expect(response.summary.estimatedProfitLossCents, isNull);
    expect(response.summary.knownEstimatedProfitLossCents, 0);
    expect(response.summary.costCoverageStatus, 'incomplete');
    final item = response.items.single;
    expect(item.productId, isNull);
    expect(item.operatorId, isNull);
    expect(item.operatorName, '未知操作员');
    expect(item.tastingRoomNo, '未填写');
    expect(item.estimatedProfitLossCents, isNull);
    expect(item.costCoverageStatus, 'unavailable');
    expect(item.warnings, isEmpty);
  });

  testWidgets('unauthorized role cannot initialize daily loss requests',
      (tester) async {
    final client = _FakeDailyLossApiClient();
    await tester.pumpWidget(
      _page(client, role: UserRole.finance),
    );
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('profit-analysis-locked')),
      findsOneWidget,
    );
    expect(client.paths, isEmpty);
    expect(
      find.byKey(
        const ValueKey('profit-analysis-daily-loss-module'),
      ),
      findsNothing,
    );
  });
}

Widget _page(
  ApiClient client, {
  UserRole role = UserRole.admin,
  Future<String> Function(DownloadedFile)? saver,
}) {
  return MaterialApp(
    locale: const Locale('zh', 'CN'),
    home: Scaffold(
      body: ProfitAnalysisPage(
        apiClient: client,
        token: 'test-token',
        role: role,
        dailyLossProfitFileSaver: saver,
      ),
    ),
  );
}

class _FakeDailyLossApiClient extends ApiClient {
  _FakeDailyLossApiClient() : super(baseUrl: 'http://127.0.0.1:3000');

  final List<String> paths = [];

  Uri latest(String endpoint) {
    return Uri.parse(
      paths.lastWhere((path) => Uri.parse(path).path == endpoint),
    );
  }

  @override
  Future<Map<String, dynamic>> getJson(
    String path, {
    String? token,
  }) async {
    paths.add(path);
    expect(token, 'test-token');
    switch (Uri.parse(path).path) {
      case '/api/analytics/travel-group-profits':
        return {'data': _travelProfitResponse()};
      case '/api/analytics/daily-loss-profits':
        return {'data': _dailyLossResponse()};
      default:
        fail('unexpected GET path: $path');
    }
  }

  @override
  Future<ApiDownloadedFile> getBytes(
    String path, {
    required String defaultFileName,
    String? token,
  }) async {
    paths.add(path);
    expect(token, 'test-token');
    expect(
      Uri.parse(path).path,
      '/api/analytics/daily-loss-profits/export',
    );
    return ApiDownloadedFile(
      bytes: Uint8List.fromList([1, 2, 3]),
      fileName: 'daily-loss-profit-test.xlsx',
      contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }
}

Map<String, dynamic> _travelProfitResponse() {
  return {
    'range': {
      'preset': 'this_month',
      'dateFrom': '2026-07-01',
      'dateTo': '2026-07-29',
    },
    'summary': {
      'groupCount': 1,
      'completeGroupCount': 1,
      'estimatedGroupCount': 0,
      'incompleteGroupCount': 0,
      'noSalesGroupCount': 0,
      'effectiveSalesAmountCents': 10000,
      'actualProductCostCents': 5000,
      'totalExpenseCents': 5000,
      'estimatedProfitCents': 5000,
      'knownEstimatedProfitCents': 5000,
      'estimatedProfitRate': 0.5,
    },
    'items': [
      {
        'travelGroupId': 'group-1',
        'groupNo': 'TG-001',
        'visitDate': '2026-07-29',
        'calculationStatus': 'complete',
        'effectiveSalesAmountCents': 10000,
        'totalExpenseCents': 5000,
        'estimatedProfitCents': 5000,
        'estimatedProfitRate': 0.5,
      },
    ],
    'pagination': {
      'page': 1,
      'pageSize': 50,
      'total': 1,
      'totalPages': 1,
    },
  };
}

Map<String, dynamic> _dailyLossResponse() {
  return {
    'range': {
      'preset': 'today',
      'dateFrom': '2026-07-29',
      'dateTo': '2026-07-29',
    },
    'summary': {
      'rowCount': 2,
      'totalLossQuantity': 5,
      'calculableLossQuantity': 2,
      'unpricedLossQuantity': 3,
      'estimatedProfitLossCents': null,
      'knownEstimatedProfitLossCents': 1234,
      'incompleteRowCount': 1,
      'costCoverageStatus': 'incomplete',
    },
    'items': [
      {
        'date': '2026-07-29',
        'productId': 'product-1',
        'productName': '飞天',
        'tastingRoomNo': 'A1',
        'operatorId': 'operator-1',
        'operatorName': '操作员甲',
        'lossQuantity': 2,
        'unit': '瓶',
        'estimatedProfitLossCents': 1234,
        'costCoverageStatus': 'available',
        'warnings': [],
      },
      {
        'date': '2026-07-29',
        'productId': null,
        'productName': '罐装酒',
        'tastingRoomNo': '未填写',
        'operatorId': null,
        'operatorName': '未知操作员',
        'lossQuantity': 3,
        'unit': '瓶',
        'estimatedProfitLossCents': null,
        'costCoverageStatus': 'unavailable',
        'warnings': [
          {
            'code': 'PRODUCT_ACTUAL_COST_UNAVAILABLE',
            'message': '未关联商品',
          },
        ],
      },
    ],
    'pagination': {
      'page': 1,
      'pageSize': 50,
      'total': 2,
      'totalPages': 1,
    },
  };
}
