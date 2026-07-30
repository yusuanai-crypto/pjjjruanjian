import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/guide_points/guide_points_table_page.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_group_finance/travel_group_finance_supplement_page.dart';
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

  testWidgets('large guide points export saves fixed-size pages',
      (tester) async {
    final client = _GuidePointsApiClient(summaryCount: 100);
    final renderedPages = <GuidePointsImageExportPage>[];
    final savedNames = <String>[];
    await _pumpGuidePage(
      tester,
      client,
      UserRole.finance,
      imagePageRenderer: (page) async {
        renderedPages.add(page);
        return Uint8List.fromList([137, 80, 78, 71]);
      },
      imageSaver: (
        bytes, {
        required album,
        required name,
      }) async {
        expect(bytes, isNotEmpty);
        expect(album, guidePointsImageAlbumName);
        savedNames.add(name);
        return FinanceImageSaveResult(
          target: FinanceImageSaveTarget.userSelectedLocation,
          album: album,
          filePath: null,
          directoryPath: null,
        );
      },
    );

    await tester.tap(
      find.byKey(const ValueKey('guide-points-export-image')),
    );
    await tester.pumpAndSettle();

    expect(renderedPages, hasLength(13));
    expect(
      renderedPages.map((page) => page.records.length),
      [...List.filled(12, 8), 4],
    );
    expect(
      renderedPages.map((page) => page.pageNumber),
      List.generate(13, (index) => index + 1),
    );
    expect(renderedPages.every((page) => page.totalPages == 13), isTrue);
    expect(savedNames, hasLength(13));
    expect(savedNames[0], contains('第1页.png'));
    expect(savedNames[12], contains('第13页.png'));
    expect(find.textContaining('共 13 页'), findsOneWidget);
  });

  testWidgets('one failed guide page reports its number and continues',
      (tester) async {
    final client = _GuidePointsApiClient(summaryCount: 17);
    final savedNames = <String>[];
    await _pumpGuidePage(
      tester,
      client,
      UserRole.finance,
      imagePageRenderer: (page) async {
        if (page.pageNumber == 2) {
          throw const FinanceImageSaveException('设备内存不足，无法生成图片。');
        }
        return Uint8List.fromList([137, 80, 78, 71]);
      },
      imageSaver: (
        bytes, {
        required album,
        required name,
      }) async {
        savedNames.add(name);
        return FinanceImageSaveResult(
          target: FinanceImageSaveTarget.userSelectedLocation,
          album: album,
          filePath: null,
          directoryPath: null,
        );
      },
    );

    await tester.tap(
      find.byKey(const ValueKey('guide-points-export-image')),
    );
    await tester.pumpAndSettle();

    expect(savedNames, hasLength(2));
    expect(savedNames.first, contains('第1页.png'));
    expect(savedNames.last, contains('第3页.png'));
    expect(find.textContaining('成功 2 页，失败 1 页'), findsOneWidget);
    expect(find.textContaining('第2页：设备内存不足'), findsOneWidget);
  });
}

Future<void> _pumpGuidePage(
  WidgetTester tester,
  ApiClient client,
  UserRole role, {
  FinanceImageSaver? imageSaver,
  GuidePointsImagePageRenderer? imagePageRenderer,
}) async {
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
          imageSaver: imageSaver ?? saveFinanceImage,
          imagePageRenderer: imagePageRenderer,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

class _GuidePointsApiClient extends ApiClient {
  _GuidePointsApiClient({
    this.dailyPaid = false,
    this.summaryCount = 2,
  }) : super(baseUrl: 'http://127.0.0.1:3000');

  final bool dailyPaid;
  final int summaryCount;
  final List<Map<String, dynamic>> rateBodies = [];

  @override
  Future<Map<String, dynamic>> getJson(
    String path, {
    String? token,
  }) async {
    if (path.startsWith('/api/guide-points-summaries?')) {
      return {
        'data': {
          'guidePointsSummaries': summaryCount == 2
              ? [
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
                ]
              : [
                  for (var index = 1; index <= summaryCount; index += 1)
                    _generatedSummaryJson(index),
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

Map<String, dynamic> _generatedSummaryJson(int index) {
  final summary = _summaryJson(
    id: 'summary-$index',
    guideId: 'guide-$index',
    guideName: '收款导游$index',
    includeOrders: false,
  );
  summary['travelGroupId'] = 'group-$index';
  final travelGroup = Map<String, dynamic>.from(
    summary['travelGroup'] as Map<String, dynamic>,
  )
    ..['id'] = 'group-$index'
    ..['groupNo'] = 'TG-GUIDE-${index.toString().padLeft(3, '0')}';
  summary['travelGroup'] = travelGroup;
  return summary;
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
