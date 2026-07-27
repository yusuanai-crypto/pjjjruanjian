import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/order_query/order_query_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets('points destination action is visible only for allowed roles',
      (tester) async {
    for (final role in [
      UserRole.superAdmin,
      UserRole.admin,
      UserRole.finance,
      UserRole.boss,
    ]) {
      final client = _OrderPointsApiClient();
      await _pumpOrderPage(tester, client, role);
      await _openDetail(tester);
      expect(
        find.byKey(
          const ValueKey('order-points-destination-personal-button'),
        ),
        findsOneWidget,
        reason: role.name,
      );
      await tester.tapAt(const Offset(20, 20));
      await tester.pumpAndSettle();
    }

    final salesClient = _OrderPointsApiClient();
    await _pumpOrderPage(tester, salesClient, UserRole.sales);
    await _openDetail(tester);
    expect(
      find.byKey(
        const ValueKey('order-points-destination-personal-button'),
      ),
      findsNothing,
    );
  });

  testWidgets(
      'personal dialog defaults to group guide and 50/0, validates percent, and can choose another guide',
      (tester) async {
    final client = _OrderPointsApiClient();
    await _pumpOrderPage(tester, client, UserRole.finance);
    await _openDetail(tester);

    final action = find.byKey(
      const ValueKey('order-points-destination-personal-button'),
    );
    await tester.ensureVisible(action);
    await tester.tap(action);
    await tester.pumpAndSettle();

    expect(find.text('确认订单走个人'), findsOneWidget);
    expect(find.text('SO-PERSONAL-001'), findsWidgets);
    expect(find.text('TG-PERSONAL-001'), findsOneWidget);
    expect(find.text('测试旅行社'), findsOneWidget);
    expect(find.text('默认导游'), findsWidgets);
    expect(find.text('¥1000.00'), findsWidgets);

    final dailyField = tester.widget<TextFormField>(
      find.byKey(const ValueKey('personal-points-daily-percent')),
    );
    final monthlyField = tester.widget<TextFormField>(
      find.byKey(const ValueKey('personal-points-monthly-percent')),
    );
    expect(dailyField.controller?.text, '50');
    expect(monthlyField.controller?.text, '0');

    final dropdown = tester.widget<DropdownButtonFormField<String>>(
      find.byKey(const ValueKey('personal-points-guide-picker')),
    );
    expect(dropdown.initialValue, 'guide-a');

    await tester.enterText(
      find.byKey(const ValueKey('personal-points-daily-percent')),
      '100.01',
    );
    await tester.tap(
      find.byKey(const ValueKey('personal-points-confirm-button')),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('必须在 0% 至 100% 之间'), findsOneWidget);
    expect(client.pointsDestinationBodies, isEmpty);

    await tester.enterText(
      find.byKey(const ValueKey('personal-points-daily-percent')),
      '50',
    );
    await tester.tap(
      find.byKey(const ValueKey('personal-points-guide-picker')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('其他导游').last);
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('personal-points-confirm-button')),
    );
    await tester.pumpAndSettle();

    expect(client.pointsDestinationBodies, hasLength(1));
    expect(
      client.pointsDestinationBodies.single,
      {
        'pointsDestination': 'GUIDE_PERSONAL',
        'guideId': 'guide-b',
        'dailyRebateRate': '0.5000',
        'monthlyRebateRate': '0.0000',
      },
    );
    expect(find.text('走个人'), findsWidgets);
    expect(
      find.byKey(
        const ValueKey('order-points-destination-agency-button'),
      ),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('order-personal-points-edit-button')),
      findsOneWidget,
    );

    await tester.tap(
      find.byKey(const ValueKey('order-personal-points-edit-button')),
    );
    await tester.pumpAndSettle();
    expect(find.text('修改个人积分设置'), findsOneWidget);
    final editDailyField = tester.widget<TextFormField>(
      find.byKey(const ValueKey('personal-points-daily-percent')),
    );
    final editMonthlyField = tester.widget<TextFormField>(
      find.byKey(const ValueKey('personal-points-monthly-percent')),
    );
    expect(editDailyField.controller?.text, '50');
    expect(editMonthlyField.controller?.text, '0');
    final editDropdown = tester.widget<DropdownButtonFormField<String>>(
      find.byKey(const ValueKey('personal-points-guide-picker')),
    );
    expect(editDropdown.initialValue, 'guide-b');

    await tester.enterText(
      find.byKey(const ValueKey('personal-points-monthly-percent')),
      '10',
    );
    await tester.tap(
      find.byKey(const ValueKey('personal-points-guide-picker')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('默认导游').last);
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('personal-points-confirm-button')),
    );
    await tester.pumpAndSettle();
    expect(client.pointsDestinationBodies.last, {
      'pointsDestination': 'GUIDE_PERSONAL',
      'guideId': 'guide-a',
      'dailyRebateRate': '0.5000',
      'monthlyRebateRate': '0.1000',
    });

    await tester.tap(
      find.byKey(
        const ValueKey('order-points-destination-agency-button'),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(
        const ValueKey('order-points-destination-agency-confirm'),
      ),
    );
    await tester.pumpAndSettle();
    expect(client.pointsDestinationBodies.last, {
      'pointsDestination': 'TRAVEL_AGENCY',
    });
  });

  testWidgets(
      'boss can transfer a personal order back but cannot edit its guide',
      (tester) async {
    final client = _OrderPointsApiClient()..personal = true;
    await _pumpOrderPage(tester, client, UserRole.boss);
    await _openDetail(tester);

    expect(
      find.byKey(
        const ValueKey('order-points-destination-agency-button'),
      ),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('order-personal-points-edit-button')),
      findsNothing,
    );
  });
}

Future<void> _pumpOrderPage(
  WidgetTester tester,
  ApiClient client,
  UserRole role,
) async {
  tester.view.physicalSize = const Size(1600, 1200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: OrderQueryPage(
          apiClient: client,
          token: 'token',
          role: role,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _openDetail(WidgetTester tester) async {
  await tester.tap(find.text('SO-PERSONAL-001').first);
  await tester.pumpAndSettle();
}

class _OrderPointsApiClient extends ApiClient {
  _OrderPointsApiClient() : super(baseUrl: 'http://127.0.0.1:3000');

  bool personal = false;
  String personalGuideId = 'guide-b';
  final List<Map<String, dynamic>> pointsDestinationBodies = [];

  @override
  Future<Map<String, dynamic>> getJson(
    String path, {
    String? token,
  }) async {
    if (path.startsWith('/api/guides?')) {
      return {
        'data': {
          'guides': [
            _guideJson('guide-a', '默认导游', '13900000001'),
            _guideJson('guide-b', '其他导游', '13900000002'),
          ],
        },
      };
    }
    if (path == '/api/sales-orders/order-personal') {
      return {
        'data': {'salesOrder': _orderJson()},
      };
    }
    if (path.startsWith('/api/sales-orders')) {
      return {
        'data': {
          'salesOrders': [_orderJson()],
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
    if (path == '/api/sales-orders/order-personal/points-destination') {
      final request = Map<String, dynamic>.from(body ?? {});
      pointsDestinationBodies.add(request);
      personal = request['pointsDestination'] == 'GUIDE_PERSONAL';
      personalGuideId = '${request['guideId'] ?? personalGuideId}';
      return {
        'data': {'salesOrder': _orderJson()},
      };
    }
    throw StateError('Unexpected PATCH $path');
  }

  Map<String, dynamic> _orderJson() {
    final guide = personalGuideId == 'guide-a'
        ? _guideJson('guide-a', '默认导游', '13900000001')
        : _guideJson('guide-b', '其他导游', '13900000002');
    return {
      'id': 'order-personal',
      'orderNo': 'SO-PERSONAL-001',
      'orderType': 'TRAVEL_GROUP',
      'travelGroupId': 'group-personal',
      'customerName': '积分客户',
      'orderDate': '2026-07-27T00:00:00.000Z',
      'totalAmountCents': 100000,
      'cashOnDeliveryAmountCents': 0,
      'status': 'VALID',
      'packingStatus': 'PACKED',
      'items': const [],
      'pointsDestination': personal ? 'GUIDE_PERSONAL' : 'TRAVEL_AGENCY',
      'personalPointsGuideId': personal ? personalGuideId : null,
      'personalPointsGuide': personal ? guide : null,
      'personalGuideNameSnapshot': personal ? guide['name'] : null,
      'personalDailyRebateRate': personal ? '0.5000' : null,
      'personalMonthlyRebateRate': personal ? '0.0000' : null,
      'travelGroup': {
        'id': 'group-personal',
        'groupNo': 'TG-PERSONAL-001',
        'visitDate': '2026-07-27T00:00:00.000Z',
        'travelAgency': '测试旅行社',
        'guideId': 'guide-a',
        'guideName': '默认导游',
        'guidePhone': '13900000001',
        'guestCount': 10,
      },
    };
  }
}

Map<String, dynamic> _guideJson(
  String id,
  String name,
  String phone,
) {
  return {
    'id': id,
    'name': name,
    'phone': phone,
    'isActive': true,
  };
}
