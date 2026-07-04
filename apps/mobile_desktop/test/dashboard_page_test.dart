import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/app/destinations.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/dashboard/dashboard_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets('loads today analytics overview for admin boss and finance',
      (tester) async {
    for (final role in [UserRole.admin, UserRole.boss, UserRole.finance]) {
      final apiClient = _FakeDashboardApiClient(
        overview: _overviewJson(
          totalGroupCount: 13,
          netSalesAmountCents: 1234500,
          noOrderRate: 0.25,
          pendingRefundAmountCents: 4500,
        ),
      );
      var openedDestination = '';

      await _pumpDashboard(
        tester,
        apiClient: apiClient,
        role: role,
        onOpenDestination: (id) => openedDestination = id,
      );
      await tester.pumpAndSettle();

      expect(apiClient.paths, hasLength(1));
      final uri = Uri.parse(apiClient.paths.single);
      expect(uri.path, '/api/analytics/overview');
      expect(uri.queryParameters['preset'], 'today');
      expect(find.text('今日经营摘要'), findsOneWidget);
      expect(find.text('今日接待团数'), findsOneWidget);
      expect(find.text('13'), findsOneWidget);
      expect(find.text(formatMoneyCents(1234500)), findsOneWidget);
      expect(find.text('25.0%'), findsOneWidget);
      expect(find.text('待确认退款'), findsWidgets);
      expect(find.text(formatMoneyCents(4500)), findsWidgets);

      await tester.tap(find.widgetWithText(TextButton, '数据分析'));
      expect(openedDestination, 'analytics');
    }
  });

  testWidgets('keeps dashboard usable when analytics overview fails',
      (tester) async {
    final apiClient = _FakeDashboardApiClient(
      error: const ApiException(
        statusCode: 500,
        code: 'TEST_ERROR',
        message: '测试统计失败',
      ),
    );

    await _pumpDashboard(tester, apiClient: apiClient, role: UserRole.admin);
    await tester.pumpAndSettle();

    expect(apiClient.paths, hasLength(1));
    expect(find.text('今日经营摘要'), findsOneWidget);
    expect(find.text('今日接待团数'), findsOneWidget);
    expect(find.textContaining('统计摘要加载失败'), findsOneWidget);
    expect(find.textContaining('测试统计失败'), findsOneWidget);
    expect(find.textContaining('工作入口'), findsOneWidget);
  });

  testWidgets('does not call company analytics for disallowed roles',
      (tester) async {
    final apiClient = _FakeDashboardApiClient();

    await _pumpDashboard(tester, apiClient: apiClient, role: UserRole.sales);
    await tester.pumpAndSettle();

    expect(apiClient.paths, isEmpty);
    expect(find.text('今日经营摘要'), findsNothing);
    expect(find.textContaining('工作入口'), findsOneWidget);
  });
}

Future<void> _pumpDashboard(
  WidgetTester tester, {
  required _FakeDashboardApiClient apiClient,
  required UserRole role,
  ValueChanged<String>? onOpenDestination,
}) {
  return tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: DashboardPage(
          apiClient: apiClient,
          token: 'test-token',
          role: role,
          allowedDestinations: destinationsForRole(role),
          onOpenDestination: onOpenDestination ?? (_) {},
        ),
      ),
    ),
  );
}

class _FakeDashboardApiClient extends ApiClient {
  _FakeDashboardApiClient({
    Map<String, dynamic>? overview,
    this.error,
  })  : overview = overview ?? _overviewJson(),
        super(baseUrl: 'http://127.0.0.1:3000');

  final Map<String, dynamic> overview;
  final ApiException? error;
  final paths = <String>[];

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    paths.add(path);
    if (error != null) {
      throw error!;
    }
    return {'data': overview};
  }
}

Map<String, dynamic> _overviewJson({
  int totalGroupCount = 0,
  int totalGuestCount = 0,
  int grossSalesAmountCents = 0,
  int refundAmountCents = 0,
  int pendingRefundAmountCents = 0,
  int netSalesAmountCents = 0,
  int groupScopedNetSalesAmountCents = 0,
  int averageSalesPerGroupCents = 0,
  int averageSalesPerGuestCents = 0,
  int noEffectiveOrderGroupCount = 0,
  int conversionGroupCount = 0,
  double noOrderRate = 0,
  double conversionRate = 0,
  List<Map<String, dynamic>> warnings = const [],
}) {
  return {
    'range': {
      'preset': 'today',
      'dateFrom': '2026-07-04',
      'dateTo': '2026-07-04',
      'timezone': 'Asia/Shanghai',
    },
    'metrics': {
      'grossSalesAmountCents': grossSalesAmountCents,
      'refundAmountCents': refundAmountCents,
      'pendingRefundAmountCents': pendingRefundAmountCents,
      'netSalesAmountCents': netSalesAmountCents,
      'totalGroupCount': totalGroupCount,
      'totalGuestCount': totalGuestCount,
      'groupScopedNetSalesAmountCents': groupScopedNetSalesAmountCents,
      'averageSalesPerGroupCents': averageSalesPerGroupCents,
      'averageSalesPerGuestCents': averageSalesPerGuestCents,
      'noEffectiveOrderGroupCount': noEffectiveOrderGroupCount,
      'conversionGroupCount': conversionGroupCount,
      'noOrderRate': noOrderRate,
      'conversionRate': conversionRate,
    },
    'warnings': warnings,
  };
}
