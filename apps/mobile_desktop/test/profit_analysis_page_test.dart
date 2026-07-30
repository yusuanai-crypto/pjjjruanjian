import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/app/destinations.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/auth/auth_models.dart';
import 'package:jiangjiu_mobile_desktop/core/business/business_api.dart';
import 'package:jiangjiu_mobile_desktop/features/profit_analysis/profit_analysis_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  test('profit analysis menu role matrix has a client-side whitelist', () {
    const allowed = {
      UserRole.superAdmin,
      UserRole.admin,
      UserRole.boss,
    };
    for (final role in UserRole.values) {
      expect(
        destinationsForRole(role).any((item) => item.id == 'profit_analysis'),
        allowed.contains(role),
        reason: role.value,
      );
      expect(
        destinationsForBackendMenus(
          const [
            AuthMenu(
              id: 'profit_analysis',
              title: '利润分析',
              phase: 10,
            ),
          ],
          role,
        ).any((item) => item.id == 'profit_analysis'),
        allowed.contains(role),
        reason: 'backend menu whitelist: ${role.value}',
      );
    }
  });

  testWidgets('unauthorized roles show lock state and never call profit API',
      (tester) async {
    for (final role in [
      UserRole.finance,
      UserRole.sales,
      UserRole.frontDesk,
      UserRole.warehouse,
      UserRole.afterSales,
      UserRole.taster,
    ]) {
      final client = _FakeProfitApiClient();
      await tester.pumpWidget(_page(client, role: role));
      await tester.pump();
      expect(
        find.byKey(const ValueKey('profit-analysis-locked')),
        findsOneWidget,
        reason: role.value,
      );
      expect(client.paths, isEmpty, reason: role.value);
    }
  });

  testWidgets('renders loading, error, retry, and empty states',
      (tester) async {
    final pending = Completer<Map<String, dynamic>>();
    final loadingClient = _FakeProfitApiClient(pending: pending);
    await tester.pumpWidget(_page(loadingClient));
    await tester.pump();
    expect(
      find.byKey(const ValueKey('profit-analysis-loading')),
      findsOneWidget,
    );
    pending.complete({'data': _responseJson(items: const [])});
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('profit-analysis-empty')),
      findsOneWidget,
    );

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
    final errorClient = _FakeProfitApiClient(failuresRemaining: 1);
    await tester.pumpWidget(_page(errorClient));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('profit-analysis-error')),
      findsOneWidget,
    );
    expect(find.text('测试利润接口失败'), findsOneWidget);
    final retry = find.text('重试');
    await tester.ensureVisible(retry);
    await tester.pump();
    await tester.tap(retry);
    await tester.pumpAndSettle();
    expect(errorClient.paths, hasLength(2));
    expect(
      find.byKey(const ValueKey('profit-analysis-metrics')),
      findsOneWidget,
    );
  });

  testWidgets('renders metrics, all statuses, negative profit, and details',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final client = _FakeProfitApiClient();
    await tester.pumpWidget(_page(client));
    await tester.pumpAndSettle();

    expect(find.text('旅行团数'), findsOneWidget);
    expect(find.text('有效销售额'), findsWidgets);
    expect(find.text('税费合计'), findsOneWidget);
    expect(find.text('手续费合计'), findsOneWidget);
    expect(find.text('可核算团数'), findsOneWidget);
    expect(find.text('预估利润率'), findsWidgets);
    expect(find.text('成本不完整团数'), findsOneWidget);
    expect(find.text(formatMoneyCents(260)), findsOneWidget);
    expect(find.text(formatMoneyCents(180)), findsOneWidget);
    expect(find.text('税费'), findsOneWidget);
    expect(find.text('手续费'), findsOneWidget);
    expect(find.text(formatMoneyCents(26000)), findsWidgets);
    expect(find.text('完整'), findsNWidgets(2));
    expect(find.text('估算'), findsOneWidget);
    expect(find.text('成本不完整/无法估算'), findsOneWidget);
    expect(find.text('无有效销售'), findsOneWidget);
    expect(find.text('亏损 ${formatMoneyCents(-1000)}'), findsOneWidget);
    expect(find.text('退款成本未冲回'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('profit-analysis-incomplete-summary')),
      findsOneWidget,
    );

    final completeRow = find.text('TG-COMPLETE');
    await tester.ensureVisible(completeRow);
    await tester.pump();
    await tester.tap(completeRow);
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('profit-analysis-detail-complete')),
      findsOneWidget,
    );
    expect(find.text('商品实际成本（汇总）'), findsOneWidget);
    expect(find.text('停车费'), findsOneWidget);
    expect(find.text('香烟费用'), findsOneWidget);
    expect(find.text('销售提成'), findsOneWidget);
    expect(find.text('组长提成'), findsOneWidget);
    expect(find.text('外联提成'), findsOneWidget);
    expect(find.text('员工提成（汇总）'), findsNothing);
    expect(find.text('品鉴师提成（汇总）'), findsOneWidget);
    expect(find.text('付款手续费'), findsOneWidget);
    expect(
      find.byKey(
        const ValueKey('profit-analysis-payment-fee-breakdown'),
      ),
      findsOneWidget,
    );
    await tester.tap(find.text('付款方式手续费明细'));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('profit-analysis-payment-fee-row-0')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('profit-analysis-payment-fee-row-1')),
      findsOneWidget,
    );
    expect(find.text('收钱吧'), findsNWidgets(2));
    expect(find.text('0.6%'), findsOneWidget);
    expect(find.text('1%'), findsOneWidget);
    expect(find.text('原付款金额'), findsNWidgets(2));
    expect(find.text('当天退款扣减'), findsNWidgets(2));
    expect(find.text('手续费基数'), findsNWidgets(2));
    expect(find.text('商品单位成本'), findsNothing);
    expect(find.text('个人提成明细'), findsNothing);

    await tester.tap(find.text('关闭'));
    await tester.pumpAndSettle();
    final incompleteRow = find.text('TG-INCOMPLETE');
    await tester.ensureVisible(incompleteRow);
    await tester.tap(incompleteRow);
    await tester.pumpAndSettle();
    expect(find.text('未填写'), findsOneWidget);
    expect(
      find.byKey(
        const ValueKey('profit-analysis-warning-CIGARETTE_FEE_MISSING'),
      ),
      findsOneWidget,
    );
    expect(
      find.byKey(
        const ValueKey(
          'profit-analysis-warning-PAYMENT_SERVICE_FEE_SNAPSHOT_MISSING',
        ),
      ),
      findsOneWidget,
    );
    expect(
      find.textContaining('手续费快照缺失，请财务补齐费率并重新标记订单'),
      findsOneWidget,
    );
  });

  testWidgets('sends preset, search, status, sort, direction, and page filters',
      (tester) async {
    final client = _FakeProfitApiClient();
    DownloadedFile? savedFile;
    await tester.pumpWidget(
      _page(
        client,
        fileSaver: (file) async {
          savedFile = file;
          return 'D:/exports/travel-group-profits.xlsx';
        },
      ),
    );
    await tester.pumpAndSettle();

    var uri = Uri.parse(client.paths.last);
    expect(uri.queryParameters['preset'], 'this_month');
    expect(uri.queryParameters['sortBy'], 'visitDate');
    expect(uri.queryParameters['sortDirection'], 'desc');
    expect(uri.queryParameters['page'], '1');
    expect(uri.queryParameters['pageSize'], '50');

    await tester.tap(find.text('今日'));
    await tester.pumpAndSettle();
    uri = Uri.parse(client.paths.last);
    expect(uri.queryParameters['preset'], 'today');

    await tester.enterText(
      find.byKey(const ValueKey('profit-analysis-search')),
      'Agency A',
    );
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    uri = Uri.parse(client.paths.last);
    expect(uri.queryParameters['query'], 'Agency A');

    await tester.tap(
      find.byKey(const ValueKey('profit-analysis-status-filter')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('估算').last);
    await tester.pumpAndSettle();
    uri = Uri.parse(client.paths.last);
    expect(uri.queryParameters['status'], 'estimated');

    await tester.tap(
      find.byKey(const ValueKey('profit-analysis-sort-filter')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('预估利润').last);
    await tester.pumpAndSettle();
    uri = Uri.parse(client.paths.last);
    expect(uri.queryParameters['sortBy'], 'estimatedProfitCents');

    await tester.tap(
      find.byKey(const ValueKey('profit-analysis-sort-direction')),
    );
    await tester.pumpAndSettle();
    uri = Uri.parse(client.paths.last);
    expect(uri.queryParameters['sortDirection'], 'asc');

    final nextPage = find.byKey(const ValueKey('profit-analysis-next-page'));
    await tester.ensureVisible(nextPage);
    await tester.pump();
    await tester.tap(nextPage);
    await tester.pumpAndSettle();
    uri = Uri.parse(client.paths.last);
    expect(uri.queryParameters['page'], '2');

    final exportButton =
        find.byKey(const ValueKey('profit-analysis-export-button'));
    await tester.ensureVisible(exportButton);
    await tester.tap(exportButton);
    await tester.pumpAndSettle();
    uri = Uri.parse(client.downloadPaths.single);
    expect(uri.path, '/api/analytics/travel-group-profits/export');
    expect(uri.queryParameters['preset'], 'today');
    expect(uri.queryParameters['query'], 'Agency A');
    expect(uri.queryParameters['status'], 'estimated');
    expect(uri.queryParameters['sortBy'], 'estimatedProfitCents');
    expect(uri.queryParameters['sortDirection'], 'asc');
    expect(uri.queryParameters.containsKey('page'), isFalse);
    expect(uri.queryParameters.containsKey('pageSize'), isFalse);
    expect(savedFile?.fileName, 'travel-group-profits-test.xlsx');
  });

  testWidgets('narrow layout uses cards without overflow', (tester) async {
    tester.view.physicalSize = const Size(390, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final client = _FakeProfitApiClient();
    await tester.pumpWidget(_page(client));
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('profit-analysis-card-list')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('profit-analysis-table')),
      findsNothing,
    );
    expect(find.text('税费'), findsWidgets);
    expect(find.text('手续费'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('export disables duplicate clicks and reports saved path',
      (tester) async {
    final pending = Completer<ApiDownloadedFile>();
    final client = _FakeProfitApiClient(downloadPending: pending);
    var saverCalls = 0;
    await tester.pumpWidget(
      _page(
        client,
        fileSaver: (file) async {
          saverCalls += 1;
          return 'D:/exports/${file.fileName}';
        },
      ),
    );
    await tester.pumpAndSettle();

    final exportButton =
        find.byKey(const ValueKey('profit-analysis-export-button'));
    await tester.tap(exportButton);
    await tester.pump();
    expect(find.text('导出中'), findsOneWidget);
    expect(
      tester.widget<FilledButton>(exportButton).onPressed,
      isNull,
    );
    expect(client.downloadPaths, hasLength(1));

    pending.complete(
      ApiDownloadedFile(
        bytes: Uint8List.fromList([1, 2, 3]),
        fileName: 'travel-group-profits-pending.xlsx',
        contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    );
    await tester.pumpAndSettle();
    expect(saverCalls, 1);
    expect(find.text('导出 Excel'), findsOneWidget);
    expect(
      find.text(
        '旅行团利润已导出：'
        'D:/exports/travel-group-profits-pending.xlsx',
      ),
      findsOneWidget,
    );
  });

  testWidgets('export errors restore the button and show a clear message',
      (tester) async {
    final client = _FakeProfitApiClient(downloadFailuresRemaining: 1);
    await tester.pumpWidget(
      _page(
        client,
        fileSaver: (_) async => 'unused',
      ),
    );
    await tester.pumpAndSettle();

    final exportButton =
        find.byKey(const ValueKey('profit-analysis-export-button'));
    await tester.tap(exportButton);
    await tester.pumpAndSettle();

    expect(find.text('测试利润导出失败'), findsWidgets);
    expect(
      tester.widget<FilledButton>(exportButton).onPressed,
      isNotNull,
    );
  });

  test('profit DTO tolerates missing optional fields', () {
    final response = ProfitAnalysisResponse.fromJson({
      'range': {
        'preset': 'this_month',
        'dateFrom': '2026-07-01',
        'dateTo': '2026-07-23',
      },
      'summary': {
        'groupCount': 1,
      },
      'items': [
        {
          'travelGroupId': 'minimal',
          'groupNo': 'TG-MINIMAL',
          'visitDate': '2026-07-01',
          'calculationStatus': 'incomplete',
        },
      ],
      'pagination': {
        'page': 1,
        'pageSize': 50,
        'total': 1,
        'totalPages': 1,
      },
    });

    expect(response.summary.estimatedProfitCents, isNull);
    expect(response.summary.estimatedProfitRate, isNull);
    expect(response.summary.taxFeeCents, 0);
    expect(response.summary.paymentServiceFeeCents, 0);
    expect(response.items.single.estimatedProfitCents, isNull);
    expect(response.items.single.estimatedProfitRate, isNull);
    expect(response.items.single.warnings, isEmpty);
    expect(response.items.single.totalExpenseCents, 0);
    expect(response.items.single.parkingFeeCents, 0);
    expect(response.items.single.cigaretteFeeCents, isNull);
    expect(response.items.single.salesCommissionCents, 0);
    expect(response.items.single.leaderCommissionCents, 0);
    expect(response.items.single.outreachCommissionCents, 0);
    expect(response.items.single.taxFeeCents, 0);
    expect(response.items.single.paymentServiceFeeCents, 0);
    expect(response.items.single.paymentMethodFeeBreakdown, isEmpty);
  });
}

Widget _page(
  ApiClient client, {
  UserRole role = UserRole.admin,
  TravelGroupProfitFileSaver? fileSaver,
}) {
  return MaterialApp(
    locale: const Locale('zh', 'CN'),
    home: Scaffold(
      body: ProfitAnalysisPage(
        apiClient: client,
        token: 'test-token',
        role: role,
        travelGroupProfitFileSaver: fileSaver,
      ),
    ),
  );
}

class _FakeProfitApiClient extends ApiClient {
  _FakeProfitApiClient({
    this.pending,
    this.downloadPending,
    this.failuresRemaining = 0,
    this.downloadFailuresRemaining = 0,
  }) : super(baseUrl: 'http://127.0.0.1:3000');

  final Completer<Map<String, dynamic>>? pending;
  final Completer<ApiDownloadedFile>? downloadPending;
  int failuresRemaining;
  int downloadFailuresRemaining;
  final List<String> paths = [];
  final List<String> downloadPaths = [];

  @override
  Future<Map<String, dynamic>> getJson(
    String path, {
    String? token,
  }) async {
    paths.add(path);
    expect(token, 'test-token');
    expect(Uri.parse(path).path, '/api/analytics/travel-group-profits');
    if (pending != null && paths.length == 1) {
      return pending!.future;
    }
    if (failuresRemaining > 0) {
      failuresRemaining -= 1;
      throw const ApiException(
        statusCode: 500,
        code: 'TEST_FAILURE',
        message: '测试利润接口失败',
      );
    }
    return {'data': _responseJson()};
  }

  @override
  Future<ApiDownloadedFile> getBytes(
    String path, {
    required String defaultFileName,
    String? token,
  }) async {
    downloadPaths.add(path);
    expect(token, 'test-token');
    expect(defaultFileName, 'travel-group-profits.xlsx');
    expect(
      Uri.parse(path).path,
      '/api/analytics/travel-group-profits/export',
    );
    if (downloadFailuresRemaining > 0) {
      downloadFailuresRemaining -= 1;
      throw const ApiException(
        statusCode: 500,
        code: 'TEST_EXPORT_FAILURE',
        message: '测试利润导出失败',
      );
    }
    if (downloadPending != null && downloadPaths.length == 1) {
      return downloadPending!.future;
    }
    return ApiDownloadedFile(
      bytes: Uint8List.fromList([1, 2, 3]),
      fileName: 'travel-group-profits-test.xlsx',
      contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }
}

Map<String, dynamic> _responseJson({
  List<Map<String, dynamic>>? items,
}) {
  final responseItems = items ?? _itemsJson();
  return {
    'range': {
      'preset': 'this_month',
      'dateFrom': '2026-07-01',
      'dateTo': '2026-07-23',
    },
    'summary': {
      'groupCount': responseItems.length,
      'completeGroupCount': 1,
      'estimatedGroupCount': 1,
      'incompleteGroupCount': responseItems.isEmpty ? 0 : 1,
      'noSalesGroupCount': 1,
      'effectiveSalesAmountCents': 26000,
      'actualProductCostCents': 9000,
      'taxFeeCents': 260,
      'paymentServiceFeeCents': 180,
      'totalExpenseCents': 17000,
      'estimatedProfitCents': null,
      'knownEstimatedProfitCents': 6000,
      'estimatedProfitRate': null,
    },
    'items': responseItems,
    'pagination': {
      'page': 1,
      'pageSize': 50,
      'total': responseItems.isEmpty ? 0 : 100,
      'totalPages': responseItems.isEmpty ? 0 : 2,
    },
  };
}

List<Map<String, dynamic>> _itemsJson() {
  return [
    _item(
      id: 'complete',
      groupNo: 'TG-COMPLETE',
      status: 'complete',
      sales: 10000,
      expenses: 6000,
      profit: 4000,
      rate: 0.4,
    ),
    _item(
      id: 'estimated',
      groupNo: 'TG-ESTIMATED',
      status: 'estimated',
      sales: 8000,
      expenses: 5000,
      profit: 3000,
      rate: 0.375,
      warnings: const [
        {
          'code': 'REFUND_COST_REVERSAL_UNAVAILABLE',
          'message': 'Refund cost reversal is unavailable.',
        },
      ],
    ),
    _item(
      id: 'incomplete',
      groupNo: 'TG-INCOMPLETE',
      status: 'incomplete',
      sales: 7000,
      expenses: 4000,
      profit: null,
      rate: null,
      warnings: const [
        {
          'code': 'ACTUAL_COST_COVERAGE_PARTIAL',
          'message': 'Cost snapshots are incomplete.',
        },
        {
          'code': 'CIGARETTE_FEE_MISSING',
          'message': '香烟费用未填写，请前台补录后再核算利润。',
        },
        {
          'code': 'PAYMENT_SERVICE_FEE_SNAPSHOT_MISSING',
          'message': 'Snapshot is missing.',
        },
      ],
    ),
    _item(
      id: 'no-sales',
      groupNo: 'TG-NO-SALES',
      status: 'no_sales',
      sales: 0,
      expenses: 0,
      profit: 0,
      rate: null,
    ),
    _item(
      id: 'loss',
      groupNo: 'TG-LOSS',
      status: 'complete',
      sales: 1000,
      expenses: 2000,
      profit: -1000,
      rate: -1,
    ),
  ];
}

Map<String, dynamic> _item({
  required String id,
  required String groupNo,
  required String status,
  required int sales,
  required int expenses,
  required int? profit,
  required double? rate,
  List<Map<String, dynamic>> warnings = const [],
}) {
  return {
    'travelGroupId': id,
    'groupNo': groupNo,
    'visitDate': '2026-07-10',
    'travelAgency': '测试旅行社',
    'guideName': '测试导游',
    'tasterName': '测试品鉴师',
    'guestCount': 20,
    'orderCount': sales > 0 ? 1 : 0,
    'effectiveSalesAmountCents': sales,
    'confirmedRefundAmountCents': id == 'estimated' ? 1000 : 0,
    'pendingRefundAmountCents': id == 'estimated' ? 200 : 0,
    'actualProductCostCents': expenses ~/ 2,
    'logisticsFeeCents': expenses ~/ 10,
    'parkingFeeCents': 500,
    'cigaretteFeeCents': id == 'incomplete' ? null : 200,
    'salesCommissionCents': expenses ~/ 30,
    'leaderCommissionCents': expenses ~/ 30,
    'outreachCommissionCents': expenses ~/ 30,
    'employeeCommissionCents': expenses ~/ 10,
    'tasterCommissionCents': expenses ~/ 10,
    'dailyAgencyRebateCents': expenses ~/ 10,
    'monthlyAgencyRebateCents': expenses ~/ 10,
    'taxFeeCents': id == 'incomplete' ? null : sales ~/ 100,
    'paymentServiceFeeCents': id == 'incomplete' ? null : expenses ~/ 50,
    'paymentMethodFeeBreakdown': id == 'complete'
        ? [
            {
              'paymentMethodId': 'wallet',
              'paymentMethodNameSnapshot': '收钱吧',
              'serviceFeeRateSnapshot': '0.006000',
              'originalPaymentAmountCents': 6000,
              'sameDayRefundAmountCents': 1000,
              'serviceFeeBaseAmountCents': 5000,
              'serviceFeeCents': 30,
              'orderCount': 1,
            },
            {
              'paymentMethodId': 'wallet',
              'paymentMethodNameSnapshot': '收钱吧',
              'serviceFeeRateSnapshot': '0.010000',
              'originalPaymentAmountCents': 4000,
              'sameDayRefundAmountCents': 0,
              'serviceFeeBaseAmountCents': 4000,
              'serviceFeeCents': 40,
              'orderCount': 1,
            },
          ]
        : const [],
    'totalExpenseCents': expenses,
    'estimatedProfitCents': profit,
    'estimatedProfitRate': rate,
    'calculationStatus': status,
    'warnings': warnings,
  };
}
