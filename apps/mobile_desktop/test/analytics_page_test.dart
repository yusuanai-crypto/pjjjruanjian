import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/analytics/analytics_page.dart';
import 'package:jiangjiu_mobile_desktop/shared/widgets/search_filter_bar.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets('loads overview metrics and warnings from analytics API',
      (tester) async {
    final apiClient = _FakeAnalyticsApiClient();

    await tester.pumpWidget(_page(apiClient));
    await tester.pumpAndSettle();

    expect(apiClient.tokens, everyElement('test-token'));
    final uri = _latestUri(apiClient, '/api/analytics/overview');
    expect(uri.path, '/api/analytics/overview');
    expect(uri.queryParameters['preset'], 'this_month');
    expect(uri.queryParameters['dateFrom'], isNotNull);
    expect(uri.queryParameters['dateTo'], isNotNull);

    final rankingUri = _latestUri(apiClient, '/api/analytics/taster-rankings');
    expect(rankingUri.queryParameters['sortBy'], 'netSalesAmountCents');
    expect(rankingUri.queryParameters['sortDirection'], 'desc');
    expect(rankingUri.queryParameters['limit'], '50');
    final trendUris = _uris(apiClient, '/api/analytics/trends');
    expect(
        trendUris.map((uri) => uri.queryParameters['metric']),
        containsAll([
          'net_sales',
          'groups',
          'no_order_rate',
        ]));

    final overviewMetrics = _overviewMetricsSection();
    expect(_within(overviewMetrics, find.text('出单销售额')), findsOneWidget);
    expect(
      _within(overviewMetrics, find.text(formatMoneyCents(200000))),
      findsOneWidget,
    );
    expect(_within(overviewMetrics, find.text('退单销售额')), findsOneWidget);
    expect(
      _within(overviewMetrics, find.text(formatMoneyCents(20000))),
      findsOneWidget,
    );
    expect(_within(overviewMetrics, find.text('总销售额')), findsOneWidget);
    expect(
      _within(overviewMetrics, find.text(formatMoneyCents(180000))),
      findsOneWidget,
    );
    expect(_within(overviewMetrics, find.text('接待团数')), findsOneWidget);
    expect(_within(overviewMetrics, find.text('4')), findsOneWidget);
    expect(_within(overviewMetrics, find.text('接待人数')), findsOneWidget);
    expect(_within(overviewMetrics, find.text('60')), findsOneWidget);
    expect(_within(overviewMetrics, find.text('团均销售额')), findsOneWidget);
    expect(
      _within(overviewMetrics, find.text(formatMoneyCents(45000))),
      findsOneWidget,
    );
    expect(_within(overviewMetrics, find.text('人均销售额')), findsOneWidget);
    expect(
      _within(overviewMetrics, find.text(formatMoneyCents(3000))),
      findsOneWidget,
    );
    expect(_within(overviewMetrics, find.text('打蛋率')), findsOneWidget);
    expect(_within(overviewMetrics, find.text('25.0%')), findsOneWidget);
    expect(find.text('未确认退款'), findsOneWidget);
    expect(find.text('退款状态不一致'), findsOneWidget);
    expect(find.byKey(const ValueKey('analytics-overview-warning-list')),
        findsOneWidget);
  });

  testWidgets('loads taster rankings and marks unassigned taster',
      (tester) async {
    final apiClient = _FakeAnalyticsApiClient();

    await tester.pumpWidget(_page(apiClient));
    await tester.pumpAndSettle();

    final section = _tasterRankingsSection();
    expect(_within(section, find.text('品鉴师排名')), findsOneWidget);
    final table = tester.widget<DataTable>(
      find.descendant(of: section, matching: find.byType(DataTable)),
    );
    expect(
      table.columns.map((column) => (column.label as Text).data).toList(),
      const [
        '排名',
        '品鉴师',
        '出单销售额',
        '退单销售额',
        '净销售额',
        '团均销售额',
        '人均销售额',
        '接待团数',
        '接待人数',
        '打蛋率',
      ],
    );
    expect(_within(section, find.text('#1')), findsOneWidget);
    expect(_within(section, find.text('测试品鉴师A')), findsOneWidget);
    expect(
      _within(section, find.text(formatMoneyCents(150000))),
      findsOneWidget,
    );
    expect(
      _within(section, find.text(formatMoneyCents(30000))),
      findsOneWidget,
    );
    expect(
      _within(section, find.text(formatMoneyCents(120000))),
      findsOneWidget,
    );
    expect(
      _within(section, find.text(formatMoneyCents(41000))),
      findsOneWidget,
    );
    expect(
      _within(section, find.text(formatMoneyCents(2700))),
      findsOneWidget,
    );
    expect(
      _within(section, find.text(formatMoneyCents(0))),
      findsNWidgets(5),
    );
    expect(_within(section, find.text('#2')), findsOneWidget);
    expect(_within(section, find.text('未分配品鉴师')), findsOneWidget);
    expect(_within(section, find.text('未分配')), findsOneWidget);
  });

  testWidgets('sends ranking sort options to rankings API', (tester) async {
    final apiClient = _FakeAnalyticsApiClient();

    await tester.pumpWidget(_page(apiClient));
    await tester.pumpAndSettle();

    expect(
      _latestUri(apiClient, '/api/analytics/taster-rankings')
          .queryParameters['sortBy'],
      'netSalesAmountCents',
    );
    final section = _tasterRankingsSection();
    expect(_within(section, find.text('净销售额')), findsWidgets);
    expect(_within(section, find.text('销售额')), findsNothing);

    const sortKeys = [
      'totalGroupCount',
      'totalGuestCount',
      'averageSalesPerGroupCents',
      'averageSalesPerGuestCents',
      'noOrderRate',
      'netSalesAmountCents',
    ];
    for (final sortBy in sortKeys) {
      await _selectRankingSort(tester, sortBy);
      final uri = _latestUri(apiClient, '/api/analytics/taster-rankings');
      expect(uri.queryParameters['sortBy'], sortBy);
      expect(uri.queryParameters['sortDirection'], 'desc');
    }
  });

  testWidgets('opens taster ranking detail with trace summaries',
      (tester) async {
    final apiClient = _FakeAnalyticsApiClient();

    await tester.pumpWidget(_page(apiClient));
    await tester.pumpAndSettle();

    final detailButton =
        find.byKey(const ValueKey('analytics-ranking-detail-taster-1'));
    await tester.ensureVisible(detailButton);
    await tester.tap(detailButton);
    await tester.pumpAndSettle();

    final detailUri =
        _latestUri(apiClient, '/api/analytics/taster-rankings/taster-1');
    expect(detailUri.queryParameters['preset'], 'this_month');
    expect(detailUri.queryParameters['sortBy'], 'netSalesAmountCents');

    expect(find.text('测试品鉴师A 详情'), findsOneWidget);
    final detailDialog = find.byType(AlertDialog);
    expect(
      _within(detailDialog, find.text('出单销售额')),
      findsOneWidget,
    );
    expect(
      _within(detailDialog, find.text(formatMoneyCents(150000))),
      findsOneWidget,
    );
    expect(
      _within(detailDialog, find.text('退单销售额')),
      findsOneWidget,
    );
    expect(
      _within(detailDialog, find.text(formatMoneyCents(30000))),
      findsOneWidget,
    );
    expect(
      _within(detailDialog, find.text('净销售额')),
      findsOneWidget,
    );
    expect(
      _within(detailDialog, find.text(formatMoneyCents(120000))),
      findsOneWidget,
    );
    expect(
      _within(detailDialog, find.text('团均销售额')),
      findsOneWidget,
    );
    expect(
      _within(detailDialog, find.text(formatMoneyCents(41000))),
      findsOneWidget,
    );
    expect(
      _within(detailDialog, find.text('人均销售额')),
      findsOneWidget,
    );
    expect(
      _within(detailDialog, find.text(formatMoneyCents(2700))),
      findsOneWidget,
    );
    expect(_within(detailDialog, find.text('接待团数')), findsOneWidget);
    expect(_within(detailDialog, find.text('接待人数')), findsOneWidget);
    expect(_within(detailDialog, find.text('打蛋率')), findsOneWidget);
    expect(find.text('旅行团明细摘要'), findsOneWidget);
    expect(find.text('TG-DETAIL-001'), findsOneWidget);
    expect(find.text('订单明细摘要'), findsOneWidget);
    expect(find.text('SO-DETAIL-001'), findsOneWidget);
    expect(find.text('售后退款明细摘要'), findsOneWidget);
    expect(find.text('AS-DETAIL-001'), findsOneWidget);
    expect(find.text('无有效订单'), findsOneWidget);
    expect(find.text('已确认'), findsOneWidget);
  });

  testWidgets('keeps taster rankings horizontally scrollable on narrow screens',
      (tester) async {
    tester.view.physicalSize = const Size(520, 820);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final apiClient = _FakeAnalyticsApiClient();
    await tester.pumpWidget(_page(apiClient));
    await tester.pumpAndSettle();

    final section = _tasterRankingsSection();
    final horizontalScroll = find.descendant(
      of: section,
      matching: find.byWidgetPredicate(
        (widget) =>
            widget is SingleChildScrollView &&
            widget.scrollDirection == Axis.horizontal,
      ),
    );
    expect(horizontalScroll, findsOneWidget);
    expect(
      tester
          .widget<DataTable>(
            find.descendant(of: section, matching: find.byType(DataTable)),
          )
          .columns,
      hasLength(10),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('loads trend points from analytics trends API', (tester) async {
    final apiClient = _FakeAnalyticsApiClient();

    await tester.pumpWidget(_page(apiClient));
    await tester.pumpAndSettle();

    expect(find.text('经营趋势'), findsOneWidget);
    expect(find.text('销售额趋势'), findsOneWidget);
    expect(find.text('接待团数趋势'), findsOneWidget);
    expect(find.text('打蛋率趋势'), findsOneWidget);
    expect(find.text('07-01'), findsWidgets);
    expect(find.text(formatMoneyCents(120000)), findsWidgets);
    expect(find.text('3'), findsWidgets);
    expect(find.text('33.0%'), findsWidgets);
  });

  testWidgets('shows empty trend panels when trends API returns no points',
      (tester) async {
    final apiClient = _FakeAnalyticsApiClient(emptyTrends: true);

    await tester.pumpWidget(_page(apiClient));
    await tester.pumpAndSettle();

    expect(find.text('经营趋势'), findsOneWidget);
    expect(find.text('销售额趋势'), findsOneWidget);
    expect(find.text('接待团数趋势'), findsOneWidget);
    expect(find.text('打蛋率趋势'), findsOneWidget);
    expect(find.text('暂无趋势点'), findsNWidgets(3));
    expect(_uris(apiClient, '/api/analytics/trends'), hasLength(3));
  });

  testWidgets('opens source details from overview metric cards',
      (tester) async {
    final apiClient = _FakeAnalyticsApiClient();

    await tester.pumpWidget(_page(apiClient));
    await tester.pumpAndSettle();

    final overviewMetrics = _overviewMetricsSection();
    await tester.tap(
      _within(overviewMetrics, find.text('出单销售额')),
    );
    await tester.pumpAndSettle();
    var uri = _latestUri(apiClient, '/api/analytics/source/orders');
    expect(uri.queryParameters['source'], 'sales');
    expect(find.text('出单销售额订单明细'), findsOneWidget);
    expect(find.text('SO-SOURCE-001'), findsOneWidget);

    await tester.tap(find.text('关闭').last);
    await tester.pumpAndSettle();

    await tester.tap(
      _within(overviewMetrics, find.text('退单销售额')),
    );
    await tester.pumpAndSettle();
    uri = _latestUri(apiClient, '/api/analytics/source/after-sales');
    expect(uri.queryParameters['source'], 'refund');
    expect(find.text('退单售后退款明细'), findsOneWidget);
    expect(find.text('AS-SOURCE-001'), findsOneWidget);

    await tester.tap(find.text('关闭').last);
    await tester.pumpAndSettle();

    await tester.tap(
      _within(overviewMetrics, find.text('接待团数')),
    );
    await tester.pumpAndSettle();
    uri = _latestUri(apiClient, '/api/analytics/source/travel-groups');
    expect(uri.queryParameters['noEffectiveOrder'], isNull);
    expect(find.text('接待旅行团明细'), findsOneWidget);
    expect(find.text('TG-SOURCE-001'), findsOneWidget);

    await tester.tap(find.text('关闭').last);
    await tester.pumpAndSettle();

    final noOrderRateCard = _within(overviewMetrics, find.text('打蛋率'));
    await tester.ensureVisible(noOrderRateCard);
    await tester.tap(noOrderRateCard);
    await tester.pumpAndSettle();
    uri = _latestUri(apiClient, '/api/analytics/source/travel-groups');
    expect(uri.queryParameters['noEffectiveOrder'], 'true');
    expect(find.text('无有效订单旅行团明细'), findsOneWidget);
  });

  testWidgets('exports overview with loading and success feedback',
      (tester) async {
    final completer = Completer<ApiDownloadedFile>();
    final apiClient =
        _FakeAnalyticsApiClient(pendingOverviewExportResponse: completer);
    final documentsDirectory =
        Directory.systemTemp.createTempSync('analytics-export-test-');
    addTearDown(() {
      if (documentsDirectory.existsSync()) {
        documentsDirectory.deleteSync(recursive: true);
      }
    });

    await tester.pumpWidget(
      _page(apiClient, documentsDirectory: documentsDirectory),
    );
    await tester.pumpAndSettle();

    await tester.tap(
      find.byKey(const ValueKey('analytics-overview-export-button')),
    );
    await tester.pump();
    expect(find.text('导出中'), findsOneWidget);

    completer.complete(
      ApiDownloadedFile(
        bytes: Uint8List.fromList([0x50, 0x4B, 0x03, 0x04]),
        fileName: 'analytics-overview-test.xlsx',
      ),
    );
    await tester.pump();

    final exportUri =
        _latestDownloadUri(apiClient, '/api/analytics/overview/export');
    expect(exportUri.queryParameters['preset'], 'this_month');
    final exportedFile = File(
      '${documentsDirectory.path}${Platform.pathSeparator}exports'
      '${Platform.pathSeparator}analytics-overview-test.xlsx',
    );
    for (var index = 0; index < 20 && !exportedFile.existsSync(); index += 1) {
      await tester.pump(const Duration(milliseconds: 50));
      await tester.runAsync(() async {
        await Future<void>.delayed(const Duration(milliseconds: 20));
      });
    }
    expect(
      exportedFile.existsSync(),
      isTrue,
      reason: Directory(
                  '${documentsDirectory.path}${Platform.pathSeparator}exports')
              .existsSync()
          ? Directory(
                  '${documentsDirectory.path}${Platform.pathSeparator}exports')
              .listSync()
              .map((file) => file.path)
              .join(', ')
          : 'export directory does not exist',
    );
    for (var index = 0;
        index < 20 && find.textContaining('经营看板已导出：').evaluate().isEmpty;
        index += 1) {
      await tester.pump(const Duration(milliseconds: 50));
      await tester.runAsync(() async {
        await Future<void>.delayed(const Duration(milliseconds: 20));
      });
    }
    expect(find.textContaining('经营看板已导出：'), findsOneWidget);
  });

  testWidgets('shows ranking export error feedback', (tester) async {
    final apiClient = _FakeAnalyticsApiClient(
      rankingsExportError: const ApiException(
        statusCode: 500,
        code: 'TEST_EXPORT_ERROR',
        message: '测试错误：导出品鉴师排名失败。',
      ),
    );
    final documentsDirectory =
        Directory.systemTemp.createTempSync('analytics-export-fail-');
    addTearDown(() {
      if (documentsDirectory.existsSync()) {
        documentsDirectory.deleteSync(recursive: true);
      }
    });

    await tester.pumpWidget(
      _page(apiClient, documentsDirectory: documentsDirectory),
    );
    await tester.pumpAndSettle();

    await tester.tap(
      find.byKey(const ValueKey('analytics-rankings-export-button')),
    );
    await tester.pumpAndSettle();

    final exportUri =
        _latestDownloadUri(apiClient, '/api/analytics/taster-rankings/export');
    expect(exportUri.queryParameters['sortBy'], 'netSalesAmountCents');
    expect(find.text('测试错误：导出品鉴师排名失败。'), findsWidgets);
  });

  testWidgets('sends six preset filters and custom date range', (tester) async {
    final apiClient = _FakeAnalyticsApiClient();

    await tester.pumpWidget(_page(apiClient));
    await tester.pumpAndSettle();

    await _tapPreset(tester, '本年');
    expect(
        _latestUri(apiClient, '/api/analytics/overview')
            .queryParameters['preset'],
        'this_year');

    await _tapPreset(tester, '本月');
    expect(
        _latestUri(apiClient, '/api/analytics/overview')
            .queryParameters['preset'],
        'this_month');

    await _tapPreset(tester, '上个月');
    expect(
        _latestUri(apiClient, '/api/analytics/overview')
            .queryParameters['preset'],
        'last_month');

    await _tapPreset(tester, '近 10 天');
    expect(
        _latestUri(apiClient, '/api/analytics/overview')
            .queryParameters['preset'],
        'last_10_days');

    await _tapPreset(tester, '昨日');
    expect(
        _latestUri(apiClient, '/api/analytics/overview')
            .queryParameters['preset'],
        'yesterday');

    await _tapPreset(tester, '今日');
    expect(
        _latestUri(apiClient, '/api/analytics/overview')
            .queryParameters['preset'],
        'today');

    final rangeButton = tester.widget<AppDateRangeButton>(
      find.byKey(const ValueKey('analytics-overview-date-range-button')),
    );
    rangeButton.onChanged(
      DateTimeRange(
        start: DateTime(2026, 6, 1),
        end: DateTime(2026, 6, 30),
      ),
    );
    await tester.pumpAndSettle();

    final customUri = _latestUri(apiClient, '/api/analytics/overview');
    expect(customUri.queryParameters['preset'], 'custom');
    expect(customUri.queryParameters['dateFrom'], '2026-06-01');
    expect(customUri.queryParameters['dateTo'], '2026-06-30');
  });

  testWidgets('shows loading error and empty states', (tester) async {
    final completer = Completer<Map<String, dynamic>>();
    final loadingClient =
        _FakeAnalyticsApiClient(pendingOverviewResponse: completer);

    await tester.pumpWidget(_page(loadingClient));
    await tester.pump();
    expect(find.byKey(const ValueKey('analytics-overview-loading')),
        findsOneWidget);

    completer.complete({'data': _overviewJson(metrics: _zeroMetricsJson())});
    await tester.pumpAndSettle();
    expect(
        find.byKey(const ValueKey('analytics-overview-empty')), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();

    final errorClient = _FakeAnalyticsApiClient(
      overviewError: const ApiException(
        statusCode: 500,
        code: 'TEST_ERROR',
        message: '测试错误：无法读取统计概览。',
      ),
    );
    await tester.pumpWidget(_page(errorClient));
    await tester.pumpAndSettle();

    expect(
        find.byKey(const ValueKey('analytics-overview-error')), findsOneWidget);
    expect(find.text('测试错误：无法读取统计概览。'), findsOneWidget);
  });

  testWidgets(
      'allows admin boss finance and after sales to use analytics and export',
      (tester) async {
    for (final role in [
      UserRole.admin,
      UserRole.boss,
      UserRole.finance,
      UserRole.afterSales,
    ]) {
      final apiClient = _FakeAnalyticsApiClient();

      await tester.pumpWidget(_page(apiClient, role: role));
      await tester.pumpAndSettle();

      expect(_uris(apiClient, '/api/analytics/overview'), isNotEmpty);
      expect(_uris(apiClient, '/api/analytics/taster-rankings'), isNotEmpty);
      expect(_uris(apiClient, '/api/analytics/trends'), isNotEmpty);
      expect(find.text('数据分析概览'), findsOneWidget);
      expect(find.text('经营趋势'), findsOneWidget);
      expect(find.text('品鉴师排名'), findsOneWidget);
      expect(find.byKey(const ValueKey('analytics-overview-export-button')),
          findsOneWidget);
      expect(find.byKey(const ValueKey('analytics-rankings-export-button')),
          findsOneWidget);

      final detailButton =
          find.byKey(const ValueKey('analytics-ranking-detail-taster-1'));
      await tester.ensureVisible(detailButton);
      await tester.tap(detailButton);
      await tester.pumpAndSettle();

      expect(
        _uris(apiClient, '/api/analytics/taster-rankings/taster-1'),
        isNotEmpty,
      );
      expect(find.text('测试品鉴师A 详情'), findsOneWidget);

      await tester.tap(find.text('关闭').last);
      await tester.pumpAndSettle();
    }
  });

  testWidgets('shows explicit permission error when backend returns 403',
      (tester) async {
    final apiClient = _FakeAnalyticsApiClient(
      overviewError: const ApiException(
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Forbidden',
      ),
    );

    await tester.pumpWidget(_page(apiClient, role: UserRole.finance));
    await tester.pumpAndSettle();

    expect(
        find.byKey(const ValueKey('analytics-overview-error')), findsOneWidget);
    expect(find.text('无权限访问数据分析，请联系管理员确认角色权限。'), findsOneWidget);
  });

  testWidgets('blocks roles that cannot access company analytics',
      (tester) async {
    for (final role in [
      UserRole.taster,
      UserRole.sales,
      UserRole.warehouse,
      UserRole.frontDesk,
    ]) {
      final apiClient = _FakeAnalyticsApiClient();

      await tester.pumpWidget(_page(apiClient, role: role));
      await tester.pumpAndSettle();

      expect(apiClient.paths, isEmpty);
      expect(find.text('无权限查看数据分析'), findsOneWidget);
      expect(find.byKey(const ValueKey('analytics-overview-export-button')),
          findsNothing);
      expect(find.byKey(const ValueKey('analytics-rankings-export-button')),
          findsNothing);
    }
  });
}

Finder _tasterRankingsSection() {
  return find.byKey(const ValueKey('analytics-taster-rankings-section'));
}

Finder _overviewMetricsSection() {
  return find.byKey(const ValueKey('analytics-overview-metrics-section'));
}

Finder _within(Finder parent, Finder matching) {
  return find.descendant(of: parent, matching: matching);
}

Future<void> _tapPreset(WidgetTester tester, String label) async {
  await tester.tap(find.text(label));
  await tester.pumpAndSettle();
}

Future<void> _selectRankingSort(WidgetTester tester, String sortBy) async {
  final field = find.byKey(const ValueKey('analytics-ranking-sort-field'));
  await tester.ensureVisible(field);
  await tester.tap(field);
  await tester.pumpAndSettle();

  await tester.tap(
    find.byKey(ValueKey('analytics-ranking-sort-$sortBy')).last,
  );
  await tester.pumpAndSettle();
}

Uri _latestUri(_FakeAnalyticsApiClient apiClient, String path) {
  return Uri.parse(
    apiClient.paths.lastWhere((value) => Uri.parse(value).path == path),
  );
}

List<Uri> _uris(_FakeAnalyticsApiClient apiClient, String path) {
  return apiClient.paths
      .map(Uri.parse)
      .where((uri) => uri.path == path)
      .toList();
}

Uri _latestDownloadUri(_FakeAnalyticsApiClient apiClient, String path) {
  return Uri.parse(
    apiClient.downloadPaths.lastWhere(
      (value) => Uri.parse(value).path == path,
    ),
  );
}

Widget _page(
  _FakeAnalyticsApiClient apiClient, {
  UserRole role = UserRole.finance,
  Directory? documentsDirectory,
}) {
  return MaterialApp(
    home: Scaffold(
      body: AnalyticsPage(
        apiClient: apiClient,
        token: 'test-token',
        role: role,
        documentsDirectoryProvider:
            documentsDirectory == null ? null : () async => documentsDirectory,
      ),
    ),
  );
}

Map<String, dynamic> _overviewJson({
  Map<String, dynamic>? metrics,
  List<Map<String, dynamic>>? warnings,
}) {
  return {
    'range': {
      'preset': 'this_month',
      'dateFrom': '2026-07-01',
      'dateTo': '2026-07-04',
      'timezone': 'Asia/Shanghai',
    },
    'metrics': metrics ?? _metricsJson(),
    'warnings': warnings ??
        [
          {
            'code': 'pending_refund',
            'message':
                'Unconfirmed refund amount is pending finance confirmation.',
          },
          {
            'code': 'refunded_order_without_confirmed_refund',
            'message': 'Refunded order has no confirmed refund record.',
          },
        ],
  };
}

Map<String, dynamic> _metricsJson() {
  return {
    'grossSalesAmountCents': 200000,
    'refundAmountCents': 20000,
    'pendingRefundAmountCents': 2000,
    'netSalesAmountCents': 180000,
    'totalGroupCount': 4,
    'totalGuestCount': 60,
    'groupScopedNetSalesAmountCents': 180000,
    'averageSalesPerGroupCents': 45000,
    'averageSalesPerGuestCents': 3000,
    'noEffectiveOrderGroupCount': 1,
    'conversionGroupCount': 3,
    'noOrderRate': 0.25,
    'conversionRate': 0.75,
  };
}

Map<String, dynamic> _zeroMetricsJson() {
  return {
    'grossSalesAmountCents': 0,
    'refundAmountCents': 0,
    'pendingRefundAmountCents': 0,
    'netSalesAmountCents': 0,
    'totalGroupCount': 0,
    'totalGuestCount': 0,
    'groupScopedNetSalesAmountCents': 0,
    'averageSalesPerGroupCents': 0,
    'averageSalesPerGuestCents': 0,
    'noEffectiveOrderGroupCount': 0,
    'conversionGroupCount': 0,
    'noOrderRate': 0,
    'conversionRate': 0,
  };
}

List<Map<String, dynamic>> _rankingsJson() {
  return [
    _rankingJson(
      tasterId: 'taster-1',
      tasterName: '测试品鉴师A',
      rank: 1,
      totalGroupCount: 3,
      totalGuestCount: 45,
      grossSalesAmountCents: 150000,
      refundAmountCents: 30000,
      netSalesAmountCents: 120000,
      averageSalesPerGroupCents: 41000,
      averageSalesPerGuestCents: 2700,
      noEffectiveOrderGroupCount: 0,
      conversionGroupCount: 3,
      noOrderRate: 0,
      conversionRate: 1,
    ),
    _rankingJson(
      tasterName: '',
      rank: 2,
      totalGroupCount: 1,
      totalGuestCount: 15,
      grossSalesAmountCents: 0,
      refundAmountCents: 0,
      netSalesAmountCents: 0,
      noEffectiveOrderGroupCount: 1,
      conversionGroupCount: 0,
      noOrderRate: 1,
      conversionRate: 0,
      warnings: const [
        {'code': 'missing_taster', 'message': 'Missing taster for test group.'},
      ],
    ),
  ];
}

Map<String, dynamic> _rankingJson({
  String? tasterId,
  required String tasterName,
  required int rank,
  required int totalGroupCount,
  required int totalGuestCount,
  required int grossSalesAmountCents,
  required int refundAmountCents,
  required int netSalesAmountCents,
  int? averageSalesPerGroupCents,
  int? averageSalesPerGuestCents,
  required int noEffectiveOrderGroupCount,
  required int conversionGroupCount,
  required double noOrderRate,
  required double conversionRate,
  List<Map<String, dynamic>> warnings = const [],
}) {
  return {
    'tasterId': tasterId,
    'tasterName': tasterName,
    'rank': rank,
    'totalGroupCount': totalGroupCount,
    'totalGuestCount': totalGuestCount,
    'grossSalesAmountCents': grossSalesAmountCents,
    'refundAmountCents': refundAmountCents,
    'netSalesAmountCents': netSalesAmountCents,
    'averageSalesPerGroupCents': averageSalesPerGroupCents ??
        (totalGroupCount == 0 ? 0 : netSalesAmountCents ~/ totalGroupCount),
    'averageSalesPerGuestCents': averageSalesPerGuestCents ??
        (totalGuestCount == 0 ? 0 : netSalesAmountCents ~/ totalGuestCount),
    'noEffectiveOrderGroupCount': noEffectiveOrderGroupCount,
    'conversionGroupCount': conversionGroupCount,
    'noOrderRate': noOrderRate,
    'conversionRate': conversionRate,
    'warnings': warnings,
  };
}

Map<String, dynamic> _tasterDetailJson() {
  return {
    'range': {
      'preset': 'this_month',
      'dateFrom': '2026-07-01',
      'dateTo': '2026-07-04',
      'timezone': 'Asia/Shanghai',
    },
    'taster': {'id': 'taster-1', 'name': '测试品鉴师A'},
    'summary': _rankingJson(
      tasterId: 'taster-1',
      tasterName: '测试品鉴师A',
      rank: 1,
      totalGroupCount: 3,
      totalGuestCount: 45,
      grossSalesAmountCents: 150000,
      refundAmountCents: 30000,
      netSalesAmountCents: 120000,
      averageSalesPerGroupCents: 41000,
      averageSalesPerGuestCents: 2700,
      noEffectiveOrderGroupCount: 1,
      conversionGroupCount: 2,
      noOrderRate: 0.3333333333,
      conversionRate: 0.6666666667,
    ),
    'travelGroups': [
      {
        'id': 'group-detail-1',
        'groupNo': 'TG-DETAIL-001',
        'visitDate': '2026-07-02',
        'guestCount': 20,
        'tasterId': 'taster-1',
        'tasterName': '测试品鉴师A',
        'groupType': 'test',
        'travelAgency': 'test agency',
        'financeMark': true,
        'noEffectiveOrder': true,
        'grossSalesAmountCents': 0,
        'refundAmountCents': 0,
        'netSalesAmountCents': 0,
        'salesOrderIds': const [],
        'warnings': const [
          {'code': 'missing_taster', 'message': 'Detail test warning.'},
        ],
      },
    ],
    'orders': [
      {
        'id': 'order-detail-1',
        'orderNo': 'SO-DETAIL-001',
        'orderDate': '2026-07-02',
        'status': 'paid',
        'customerId': 'customer-detail-1',
        'customerName': '测试客户',
        'customerPhone': null,
        'customerFinanceMark': true,
        'travelGroupId': 'group-detail-1',
        'travelGroupNo': 'TG-DETAIL-001',
        'travelGroupVisitDate': '2026-07-02',
        'travelGroupFinanceMark': true,
        'tasterId': 'taster-1',
        'tasterName': '测试品鉴师A',
        'groupType': 'test',
        'travelAgency': 'test agency',
        'totalAmountCents': 90000,
        'grossSalesAmountCents': 90000,
        'refundAmountCents': 10000,
        'pendingRefundAmountCents': 0,
        'netSalesAmountCents': 80000,
        'effectiveAmountCents': 80000,
        'contributesToGrossSales': true,
        'contributesToEffectiveOrder': true,
        'items': const [],
        'afterSalesOrderIds': const ['after-detail-1'],
      },
    ],
    'afterSalesOrders': [
      {
        'id': 'after-detail-1',
        'afterSalesNo': 'AS-DETAIL-001',
        'salesOrderId': 'order-detail-1',
        'salesOrderNo': 'SO-DETAIL-001',
        'createdAt': '2026-07-03T08:00:00.000Z',
        'refundAmountCents': 10000,
        'financeConfirmed': true,
        'financeConfirmedAt': '2026-07-03T09:00:00.000Z',
        'status': 'completed',
        'issueType': 'test',
        'actionType': 'refund',
        'description': 'test refund detail',
        'customerId': 'customer-detail-1',
        'customerName': '测试客户',
        'travelGroupId': 'group-detail-1',
        'travelGroupNo': 'TG-DETAIL-001',
        'tasterId': 'taster-1',
        'tasterName': '测试品鉴师A',
      },
    ],
    'warnings': const [],
  };
}

List<Map<String, dynamic>> _trendsJson(String metric) {
  switch (metric) {
    case 'groups':
      return [
        _trendJson(
          periodStart: '2026-07-01',
          periodEnd: '2026-07-01',
          metricValue: 2,
          totalGroupCount: 2,
          totalGuestCount: 30,
        ),
        _trendJson(
          periodStart: '2026-07-02',
          periodEnd: '2026-07-02',
          metricValue: 3,
          totalGroupCount: 3,
          totalGuestCount: 45,
        ),
      ];
    case 'no_order_rate':
      return [
        _trendJson(
          periodStart: '2026-07-01',
          periodEnd: '2026-07-01',
          metricValue: 0.25,
          noOrderRate: 0.25,
          conversionRate: 0.75,
        ),
        _trendJson(
          periodStart: '2026-07-02',
          periodEnd: '2026-07-02',
          metricValue: 0.33,
          noOrderRate: 0.33,
          conversionRate: 0.67,
        ),
      ];
    case 'net_sales':
    default:
      return [
        _trendJson(
          periodStart: '2026-07-01',
          periodEnd: '2026-07-01',
          metricValue: 80000,
          grossSalesAmountCents: 100000,
          refundAmountCents: 20000,
          netSalesAmountCents: 80000,
        ),
        _trendJson(
          periodStart: '2026-07-02',
          periodEnd: '2026-07-02',
          metricValue: 120000,
          grossSalesAmountCents: 150000,
          refundAmountCents: 30000,
          netSalesAmountCents: 120000,
        ),
      ];
  }
}

Map<String, dynamic> _trendJson({
  required String periodStart,
  required String periodEnd,
  required double metricValue,
  int grossSalesAmountCents = 0,
  int refundAmountCents = 0,
  int pendingRefundAmountCents = 0,
  int netSalesAmountCents = 0,
  int totalGroupCount = 0,
  int totalGuestCount = 0,
  int groupScopedNetSalesAmountCents = 0,
  int noEffectiveOrderGroupCount = 0,
  int conversionGroupCount = 0,
  double noOrderRate = 0,
  double conversionRate = 0,
}) {
  return {
    'periodStart': periodStart,
    'periodEnd': periodEnd,
    'metricValue': metricValue,
    'grossSalesAmountCents': grossSalesAmountCents,
    'refundAmountCents': refundAmountCents,
    'pendingRefundAmountCents': pendingRefundAmountCents,
    'netSalesAmountCents': netSalesAmountCents,
    'totalGroupCount': totalGroupCount,
    'totalGuestCount': totalGuestCount,
    'groupScopedNetSalesAmountCents': groupScopedNetSalesAmountCents,
    'noEffectiveOrderGroupCount': noEffectiveOrderGroupCount,
    'conversionGroupCount': conversionGroupCount,
    'noOrderRate': noOrderRate,
    'conversionRate': conversionRate,
  };
}

List<Map<String, dynamic>> _sourceOrdersJson() {
  return [
    {
      'id': 'source-order-1',
      'orderNo': 'SO-SOURCE-001',
      'orderDate': '2026-07-01',
      'status': 'paid',
      'customerId': 'source-customer-1',
      'customerName': '测试客户A',
      'customerPhone': null,
      'customerFinanceMark': true,
      'travelGroupId': 'source-group-1',
      'travelGroupNo': 'TG-SOURCE-001',
      'travelGroupVisitDate': '2026-07-01',
      'travelGroupFinanceMark': true,
      'tasterId': 'taster-1',
      'tasterName': '测试品鉴师A',
      'groupType': 'test',
      'travelAgency': 'test agency',
      'totalAmountCents': 120000,
      'grossSalesAmountCents': 120000,
      'refundAmountCents': 20000,
      'pendingRefundAmountCents': 0,
      'netSalesAmountCents': 100000,
      'effectiveAmountCents': 100000,
      'contributesToGrossSales': true,
      'contributesToEffectiveOrder': true,
      'items': const [],
      'afterSalesOrderIds': const ['source-after-1'],
    },
  ];
}

List<Map<String, dynamic>> _sourceTravelGroupsJson() {
  return [
    {
      'id': 'source-group-1',
      'groupNo': 'TG-SOURCE-001',
      'visitDate': '2026-07-01',
      'guestCount': 18,
      'tasterId': 'taster-1',
      'tasterName': '测试品鉴师A',
      'groupType': 'test',
      'travelAgency': 'test agency',
      'financeMark': true,
      'noEffectiveOrder': true,
      'grossSalesAmountCents': 120000,
      'refundAmountCents': 20000,
      'netSalesAmountCents': 100000,
      'salesOrderIds': const ['source-order-1'],
      'warnings': const [],
    },
  ];
}

List<Map<String, dynamic>> _sourceAfterSalesJson() {
  return [
    {
      'id': 'source-after-1',
      'afterSalesNo': 'AS-SOURCE-001',
      'salesOrderId': 'source-order-1',
      'salesOrderNo': 'SO-SOURCE-001',
      'createdAt': '2026-07-02T08:00:00.000Z',
      'refundAmountCents': 20000,
      'financeConfirmed': true,
      'financeConfirmedAt': '2026-07-02T09:00:00.000Z',
      'status': 'completed',
      'issueType': 'test',
      'actionType': 'refund',
      'description': 'test source refund',
      'customerId': 'source-customer-1',
      'customerName': '测试客户A',
      'travelGroupId': 'source-group-1',
      'travelGroupNo': 'TG-SOURCE-001',
      'tasterId': 'taster-1',
      'tasterName': '测试品鉴师A',
    },
  ];
}

class _FakeAnalyticsApiClient extends ApiClient {
  _FakeAnalyticsApiClient({
    this.overviewError,
    this.rankingsExportError,
    this.pendingOverviewResponse,
    this.pendingOverviewExportResponse,
    this.emptyTrends = false,
    List<Map<String, dynamic>>? rankings,
    Map<String, dynamic>? detail,
  })  : rankings = rankings ?? _rankingsJson(),
        detail = detail ?? _tasterDetailJson(),
        super(baseUrl: 'http://127.0.0.1:3000');

  final ApiException? overviewError;
  final ApiException? rankingsExportError;
  final Completer<Map<String, dynamic>>? pendingOverviewResponse;
  final Completer<ApiDownloadedFile>? pendingOverviewExportResponse;
  final bool emptyTrends;
  final List<Map<String, dynamic>> rankings;
  final Map<String, dynamic> detail;
  final paths = <String>[];
  final tokens = <String?>[];
  final downloadPaths = <String>[];
  final downloadTokens = <String?>[];
  final downloadDefaultFileNames = <String>[];

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    paths.add(path);
    tokens.add(token);
    final uri = Uri.parse(path);
    switch (uri.path) {
      case '/api/analytics/overview':
        if (pendingOverviewResponse != null) {
          return pendingOverviewResponse!.future;
        }
        if (overviewError != null) {
          throw overviewError!;
        }
        return {'data': _overviewJson()};
      case '/api/analytics/taster-rankings':
        return {
          'data': {'rankings': rankings},
        };
      case '/api/analytics/taster-rankings/taster-1':
        return {'data': detail};
      case '/api/analytics/trends':
        return {
          'data': {
            'trends': emptyTrends
                ? const <Map<String, dynamic>>[]
                : _trendsJson(uri.queryParameters['metric'] ?? 'net_sales'),
          },
        };
      case '/api/analytics/source/orders':
        return {
          'data': {'orders': _sourceOrdersJson()},
        };
      case '/api/analytics/source/travel-groups':
        return {
          'data': {'travelGroups': _sourceTravelGroupsJson()},
        };
      case '/api/analytics/source/after-sales':
        return {
          'data': {'afterSalesOrders': _sourceAfterSalesJson()},
        };
      default:
        throw StateError('Unexpected GET $path');
    }
  }

  @override
  Future<ApiDownloadedFile> getBytes(
    String path, {
    required String defaultFileName,
    String? token,
  }) async {
    downloadPaths.add(path);
    downloadTokens.add(token);
    downloadDefaultFileNames.add(defaultFileName);
    final uri = Uri.parse(path);
    switch (uri.path) {
      case '/api/analytics/overview/export':
        if (pendingOverviewExportResponse != null) {
          return pendingOverviewExportResponse!.future;
        }
        return ApiDownloadedFile(
          bytes: Uint8List.fromList([0x50, 0x4B, 0x03, 0x04]),
          fileName: 'analytics-overview-test.xlsx',
        );
      case '/api/analytics/taster-rankings/export':
        if (rankingsExportError != null) {
          throw rankingsExportError!;
        }
        return ApiDownloadedFile(
          bytes: Uint8List.fromList([0x50, 0x4B, 0x03, 0x04]),
          fileName: 'analytics-taster-rankings-test.xlsx',
        );
      default:
        throw StateError('Unexpected BYTES $path');
    }
  }
}
