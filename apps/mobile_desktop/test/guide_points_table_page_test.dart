import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/guide_points/guide_points_table_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets(
      'guide table shows one row per group and receiving guide with order details',
      (tester) async {
    final client = _GuidePointsApiClient();
    await _pumpGuidePage(tester, client, UserRole.finance);

    expect(find.text('TG-GUIDE-001'), findsNWidgets(2));
    expect(find.text('收款导游甲'), findsWidgets);
    expect(find.text('收款导游乙'), findsWidgets);
    expect(find.text('1 笔个人订单'), findsNWidgets(2));

    await tester.tap(
      find.byKey(
        const ValueKey('guide-points-summary-group-1-guide-a'),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('guide-points-orders-summary-a')),
      findsOneWidget,
    );
    expect(find.text('SO-GUIDE-001'), findsOneWidget);
    expect(find.text('积分客户甲'), findsOneWidget);
    expect(find.text('50% / ¥40.00'), findsOneWidget);
    expect(find.text('0% / ¥0.00'), findsOneWidget);
  });

  testWidgets(
      'finance can edit only unpaid rate and percentage validation is explicit',
      (tester) async {
    final client = _GuidePointsApiClient(dailyPaid: true);
    await _pumpGuidePage(tester, client, UserRole.finance);
    await tester.tap(
      find.byKey(
        const ValueKey('guide-points-summary-group-1-guide-a'),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(
      find.byKey(
        const ValueKey('guide-points-edit-rates-order-guide-a'),
      ),
    );
    await tester.pumpAndSettle();

    final daily = tester.widget<TextFormField>(
      find.byKey(const ValueKey('guide-order-daily-rate-percent')),
    );
    final monthly = tester.widget<TextFormField>(
      find.byKey(const ValueKey('guide-order-monthly-rate-percent')),
    );
    expect(daily.enabled, isFalse);
    expect(monthly.enabled, isTrue);
    expect(find.text('日返已返，禁止修改'), findsOneWidget);

    await tester.enterText(
      find.byKey(const ValueKey('guide-order-monthly-rate-percent')),
      '100.01',
    );
    await tester.tap(
      find.byKey(const ValueKey('guide-order-rate-save')),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('必须在 0% 至 100% 之间'), findsOneWidget);
    expect(client.rateBodies, isEmpty);

    await tester.enterText(
      find.byKey(const ValueKey('guide-order-monthly-rate-percent')),
      '10',
    );
    await tester.tap(
      find.byKey(const ValueKey('guide-order-rate-save')),
    );
    await tester.pumpAndSettle();
    expect(client.rateBodies.single, {
      'dailyRebateRate': '0.5000',
      'monthlyRebateRate': '0.1000',
    });
  });

  testWidgets('boss sees guide table and order details as read-only',
      (tester) async {
    final client = _GuidePointsApiClient();
    await _pumpGuidePage(tester, client, UserRole.boss);
    expect(find.text('只读'), findsOneWidget);

    await tester.tap(
      find.byKey(
        const ValueKey('guide-points-summary-group-1-guide-a'),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      find.byKey(
        const ValueKey('guide-points-edit-rates-order-guide-a'),
      ),
      findsNothing,
    );
    expect(find.text('只读'), findsWidgets);

    final dailyPaidButton = tester.widget<OutlinedButton>(
      find.descendant(
        of: find.byKey(const ValueKey('summary-a:daily-paid')),
        matching: find.byType(OutlinedButton),
      ),
    );
    expect(dailyPaidButton.onPressed, isNull);
  });
}

Future<void> _pumpGuidePage(
  WidgetTester tester,
  ApiClient client,
  UserRole role,
) async {
  tester.view.physicalSize = const Size(1800, 1200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: GuidePointsTablePage(
          apiClient: client,
          token: 'token',
          role: role,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

class _GuidePointsApiClient extends ApiClient {
  _GuidePointsApiClient({this.dailyPaid = false})
      : super(baseUrl: 'http://127.0.0.1:3000');

  final bool dailyPaid;
  final List<Map<String, dynamic>> rateBodies = [];

  @override
  Future<Map<String, dynamic>> getJson(
    String path, {
    String? token,
  }) async {
    if (path.startsWith('/api/guide-points-summaries?')) {
      return {
        'data': {
          'guidePointsSummaries': [
            _summaryJson(
              id: 'summary-a',
              guideId: 'guide-a',
              guideName: '收款导游甲',
              dailyPaid: dailyPaid,
              includeOrders: false,
            ),
            _summaryJson(
              id: 'summary-b',
              guideId: 'guide-b',
              guideName: '收款导游乙',
              includeOrders: false,
            ),
          ],
        },
      };
    }
    if (path == '/api/guide-points-summaries/summary-a') {
      return {
        'data': {
          'guidePointsSummary': _summaryJson(
            id: 'summary-a',
            guideId: 'guide-a',
            guideName: '收款导游甲',
            dailyPaid: dailyPaid,
            includeOrders: true,
          ),
        },
      };
    }
    if (path == '/api/guide-points-summaries/summary-b') {
      return {
        'data': {
          'guidePointsSummary': _summaryJson(
            id: 'summary-b',
            guideId: 'guide-b',
            guideName: '收款导游乙',
            includeOrders: true,
          ),
        },
      };
    }
    throw StateError('Unexpected GET $path');
  }

  @override
  Future<Map<String, dynamic>> patchJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    if (path == '/api/guide-points-summaries/orders/order-guide-a/rates') {
      rateBodies.add(Map<String, dynamic>.from(body ?? {}));
      return {
        'data': {
          'guidePointsSummary': _summaryJson(
            id: 'summary-a',
            guideId: 'guide-a',
            guideName: '收款导游甲',
            dailyPaid: dailyPaid,
            includeOrders: true,
            monthlyRate: '0.1000',
          ),
        },
      };
    }
    throw StateError('Unexpected PATCH $path');
  }
}

Map<String, dynamic> _summaryJson({
  required String id,
  required String guideId,
  required String guideName,
  bool dailyPaid = false,
  bool includeOrders = false,
  String monthlyRate = '0.0000',
}) {
  final isA = guideId == 'guide-a';
  return {
    'id': id,
    'travelGroupId': 'group-1',
    'guideId': guideId,
    'guideNameSnapshot': guideName,
    'guide': {
      'id': guideId,
      'name': guideName,
      'phone': isA ? '13900000001' : '13900000002',
      'isActive': true,
    },
    'travelGroup': {
      'id': 'group-1',
      'groupNo': 'TG-GUIDE-001',
      'visitDate': '2026-07-27T00:00:00.000Z',
      'travelAgency': '测试旅行社',
      'guideId': 'guide-a',
      'guideName': '原团导游',
      'guestCount': 10,
    },
    'orderCount': 1,
    'totalSalesAmountCents': isA ? 10000 : 20000,
    'totalCashOnDeliveryCents': 0,
    'totalPaidDepositCents': isA ? 10000 : 20000,
    'confirmedRefundAmountCents': isA ? 1000 : 0,
    'effectiveSalesAmountCents': isA ? 9000 : 20000,
    'totalLiquorCostDeductionCents': isA ? 1000 : 0,
    'totalNetAmountCents': isA ? 8000 : 20000,
    'totalDailyPointsCents': isA ? 4000 : 10000,
    'totalMonthlyPointsCents': 0,
    'paidPointsCents': dailyPaid && isA ? 4000 : 0,
    'unpaidPointsCents': dailyPaid && isA
        ? 0
        : isA
            ? 4000
            : 10000,
    'paidDailyPointsCents': dailyPaid && isA ? 4000 : 0,
    'unpaidDailyPointsCents': dailyPaid && isA
        ? 0
        : isA
            ? 4000
            : 10000,
    'paidMonthlyPointsCents': 0,
    'unpaidMonthlyPointsCents': 0,
    'dailyPointsPaid': dailyPaid && isA,
    'monthlyPointsPaid': false,
    'afterSalesImpact': const {'status': 'refund_adjusted'},
    'calculationVersion': 'guide_points_v1',
    'updatedAt': '2026-07-27T10:00:00.000Z',
    if (includeOrders)
      'orders': [
        {
          'id': isA ? 'order-guide-a' : 'order-guide-b',
          'orderNo': isA ? 'SO-GUIDE-001' : 'SO-GUIDE-002',
          'orderDate': '2026-07-27T00:00:00.000Z',
          'customerName': isA ? '积分客户甲' : '积分客户乙',
          'status': 'valid',
          'grossAmountCents': isA ? 10000 : 20000,
          'confirmedRefundAmountCents': isA ? 1000 : 0,
          'effectiveAmountCents': isA ? 9000 : 20000,
          'liquorCostDeductionCents': isA ? 1000 : 0,
          'netAmountCents': isA ? 8000 : 20000,
          'guideId': guideId,
          'guideName': guideName,
          'dailyRebateRate': '0.5000',
          'dailyPointsCents': isA ? 4000 : 10000,
          'monthlyRebateRate': monthlyRate,
          'monthlyPointsCents': isA && monthlyRate == '0.1000' ? 800 : 0,
        },
      ],
  };
}
