import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/special_orders/special_orders_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets('sales sees my orders, three tabs, and the create action',
      (tester) async {
    final client = _FakeSpecialOrdersApiClient();
    await tester.pumpWidget(_page(client, UserRole.sales));
    await tester.pumpAndSettle();

    expect(find.text('内购单'), findsOneWidget);
    expect(find.text('外销单'), findsOneWidget);
    expect(find.text('回购单'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('special-order-create-button')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('special-order-pending-filter')),
      findsNothing,
    );
    expect(find.text('搜索我的订单'), findsOneWidget);
  });

  testWidgets('reviewers see pending count and never receive a create button',
      (tester) async {
    final client = _FakeSpecialOrdersApiClient();
    await tester.pumpWidget(_page(client, UserRole.boss));
    await tester.pumpAndSettle();

    expect(find.text('待审核 3'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('special-order-create-button')),
      findsNothing,
    );
    expect(find.text('搜索全部记录'), findsOneWidget);
  });

  testWidgets('tabs open the employee, external party, and buyback forms',
      (tester) async {
    _wide(tester);
    final client = _FakeSpecialOrdersApiClient();
    await tester.pumpWidget(_page(client, UserRole.afterSales));
    await tester.pumpAndSettle();

    await tester.tap(
      find.byKey(const ValueKey('special-order-create-button')),
    );
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('special-order-employee-field')),
      findsOneWidget,
    );
    await tester.tap(find.byIcon(Icons.close));
    await tester.pumpAndSettle();

    await tester.tap(find.text('外销单'));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('special-order-create-button')),
    );
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('special-order-external-type-field')),
      findsOneWidget,
    );
    await tester.tap(find.byIcon(Icons.close));
    await tester.pumpAndSettle();

    await tester.tap(find.text('回购单'));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('special-order-create-button')),
    );
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('special-order-buyback-customer-field')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('special-order-original-purchase-switch')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('special-order-default-warehouse-field')),
      findsOneWidget,
    );
    expect(find.text('默认总仓'), findsOneWidget);
  });

  testWidgets('mobile layout renders cards without exposing reviewer actions',
      (tester) async {
    tester.view.physicalSize = const Size(430, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final client = _FakeSpecialOrdersApiClient();
    await tester.pumpWidget(_page(client, UserRole.sales));
    await tester.pumpAndSettle();

    expect(find.text('SO-INTERNAL-001'), findsOneWidget);
    expect(find.textContaining('¥100.00'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

Widget _page(ApiClient client, UserRole role) {
  return MaterialApp(
    home: Scaffold(
      body: SpecialOrdersPage(
        apiClient: client,
        token: 'test-token',
        role: role,
      ),
    ),
  );
}

void _wide(WidgetTester tester) {
  tester.view.physicalSize = const Size(1400, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

class _FakeSpecialOrdersApiClient extends ApiClient {
  _FakeSpecialOrdersApiClient() : super(baseUrl: 'http://127.0.0.1:3000');

  @override
  Future<Map<String, dynamic>> getJson(
    String path, {
    String? token,
  }) async {
    final uri = Uri.parse(path);
    if (uri.path == '/api/special-orders/reference-data') {
      final customerId = uri.queryParameters['customerId'];
      return {
        'data': {
          'referenceData': {
            'employees': [
              {
                'id': 'employee-1',
                'name': '员工甲',
                'role': 'sales',
              },
            ],
            'products': [
              {
                'id': 'product-1',
                'name': '测试商品',
                'unit': '瓶',
                'inventoryTrackingMode': 'quantity',
              },
            ],
            'warehouses': [
              {
                'id': 'warehouse-1',
                'name': '默认总仓',
                'code': 'MAIN',
                'isDefault': true,
              },
            ],
            'defaultWarehouse': {
              'id': 'warehouse-1',
              'name': '默认总仓',
              'code': 'MAIN',
              'isDefault': true,
            },
            'guides': [
              {'id': 'guide-1', 'name': '导游甲'},
            ],
            'travelAgencies': [
              {'id': 'agency-1', 'name': '旅行社甲'},
            ],
            'paymentMethods': [
              {'id': 'cash', 'name': '现金'},
            ],
            'customers': [
              {'id': 'customer-1', 'name': '客户甲'},
            ],
            'sourceSalesOrders': customerId == null
                ? []
                : [
                    {
                      'id': 'source-order-1',
                      'orderNo': 'SO-SOURCE-001',
                      'orderDate': '2026-07-01',
                      'totalAmountCents': 10000,
                    },
                  ],
          },
        },
      };
    }
    if (uri.path == '/api/special-orders') {
      final type = uri.queryParameters['orderType'] ?? 'internal';
      return {
        'data': {
          'orders': [
            {
              'id': 'order-1',
              'orderNo': 'SO-${type.toUpperCase()}-001',
              'orderType': type,
              'workflowStatus': 'draft',
              'workflowVersion': 0,
              'orderDate': '2026-07-29',
              'customerName': '交易对象',
              'totalAmountCents': 10000,
              'createdById': 'creator-1',
              'createdBy': {'name': '创建人'},
              'items': [],
              'workflowEvents': [],
              'financial': {
                'receivableTotalCents': 0,
                'payableTotalCents': 0,
                'netCashFlowCents': 0,
              },
            },
          ],
          'total': 1,
          'pendingCount': 3,
        },
      };
    }
    throw StateError('Unexpected GET $path');
  }
}
