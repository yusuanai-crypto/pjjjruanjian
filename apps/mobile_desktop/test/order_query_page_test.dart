import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/order_query/order_query_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets('passes search and filters to sales orders API', (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpOrderQuery(tester, apiClient, role: UserRole.finance);

    await tester.enterText(
      find.byKey(const ValueKey('order-query-search-field')),
      'SO20260630',
    );
    await _selectDropdownValue(
      tester,
      key: const ValueKey('order-status-filter'),
      label: '有效',
    );
    await _selectDropdownValue(
      tester,
      key: const ValueKey('order-delivery-filter'),
      label: '邮寄',
    );
    await _selectDropdownValue(
      tester,
      key: const ValueKey('order-packing-filter'),
      label: '待打包',
    );
    await tester.tap(find.byKey(const ValueKey('order-query-search-button')));
    await tester.pumpAndSettle();

    final uri = Uri.parse(apiClient.salesOrderListPaths.last);
    expect(uri.path, '/api/sales-orders');
    expect(uri.queryParameters['query'], 'SO20260630');
    expect(uri.queryParameters['status'], 'valid');
    expect(uri.queryParameters['deliveryType'], 'shipping');
    expect(uri.queryParameters['packingStatus'], 'pending');
    expect(uri.queryParameters['limit'], '100');
    expect(uri.queryParameters.containsKey('dateFrom'), isTrue);
    expect(uri.queryParameters.containsKey('dateTo'), isTrue);
  });

  testWidgets(
      'shows order list detail and lets finance mark customer and order',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpOrderQuery(tester, apiClient, role: UserRole.finance);

    expect(find.text('SO20260630001'), findsWidgets);
    expect(find.textContaining('张女士'), findsWidgets);
    expect(find.textContaining('13800001111'), findsWidgets);
    expect(find.textContaining('TG20260630001'), findsWidgets);
    expect(find.text('客户未标记'), findsWidgets);
    expect(find.text('订单未标记'), findsWidgets);
    expect(find.text('物流单号'), findsOneWidget);
    expect(find.text('SF123456789'), findsOneWidget);
    expect(find.text('物流运费'), findsOneWidget);
    expect(find.text('¥18.00'), findsOneWidget);
    expect(find.text('顺丰'), findsOneWidget);
    expect(find.text('明细备注'), findsNothing);
    expect(find.text('订单明细'), findsOneWidget);
    expect(find.text('酱香珍藏'), findsOneWidget);
    expect(find.text('单价 ¥399.00'), findsOneWidget);
    expect(find.text('小计 ¥798.00'), findsOneWidget);
    expect(find.textContaining('礼盒装'), findsOneWidget);

    final customerMarkButton = find.widgetWithText(OutlinedButton, '客户标记 未标记');
    await tester.ensureVisible(customerMarkButton);
    await tester.pumpAndSettle();
    await tester.tap(customerMarkButton);
    await tester.pumpAndSettle();
    expect(apiClient.lastCustomerMarkBody?['financeMark'], isTrue);
    expect(find.widgetWithText(FilledButton, '客户标记 已标记'), findsOneWidget);

    final orderMarkButton = find.widgetWithText(OutlinedButton, '订单标记 未标记');
    await tester.ensureVisible(orderMarkButton);
    await tester.pumpAndSettle();
    await tester.tap(orderMarkButton);
    await tester.pumpAndSettle();
    expect(apiClient.lastOrderMarkBody?['financeMark'], isTrue);
    expect(find.widgetWithText(FilledButton, '订单标记 已标记'), findsOneWidget);
  });

  testWidgets('shows sales edit entry but hides finance mark buttons',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpOrderQuery(tester, apiClient, role: UserRole.sales);

    expect(
        find.byKey(const ValueKey('order-basic-edit-button')), findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, '客户标记 未标记'), findsNothing);
    expect(find.widgetWithText(OutlinedButton, '订单标记 未标记'), findsNothing);
  });

  testWidgets('boss sees read-only details without edit or mark actions',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpOrderQuery(tester, apiClient, role: UserRole.boss);

    expect(find.text('老板只读'), findsOneWidget);
    expect(find.byKey(const ValueKey('order-basic-edit-button')), findsNothing);
    expect(find.widgetWithText(OutlinedButton, '客户标记 未标记'), findsNothing);
    expect(find.widgetWithText(OutlinedButton, '订单标记 未标记'), findsNothing);
  });

  testWidgets('after sales can use the page as an order locator',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpOrderQuery(tester, apiClient, role: UserRole.afterSales);

    expect(find.text('售后查询定位'), findsOneWidget);
    expect(find.byKey(const ValueKey('order-basic-edit-button')), findsNothing);
    expect(find.widgetWithText(OutlinedButton, '客户标记 未标记'), findsNothing);

    await tester.enterText(
      find.byKey(const ValueKey('order-query-search-field')),
      '13800001111',
    );
    await tester.tap(find.byKey(const ValueKey('order-query-search-button')));
    await tester.pumpAndSettle();

    final uri = Uri.parse(apiClient.salesOrderListPaths.last);
    expect(uri.queryParameters['query'], '13800001111');
  });
}

Future<void> _pumpOrderQuery(
  WidgetTester tester,
  _FakeApiClient apiClient, {
  required UserRole role,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: OrderQueryPage(
          apiClient: apiClient,
          token: 'test-token',
          role: role,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _selectDropdownValue(
  WidgetTester tester, {
  required Key key,
  required String label,
}) async {
  await tester.tap(find.byKey(key));
  await tester.pumpAndSettle();
  await tester.tap(find.text(label).last);
  await tester.pumpAndSettle();
}

class _FakeApiClient extends ApiClient {
  _FakeApiClient() : super(baseUrl: 'http://127.0.0.1:3000');

  final List<String> salesOrderListPaths = <String>[];
  Map<String, dynamic>? lastCustomerMarkBody;
  Map<String, dynamic>? lastOrderMarkBody;
  Map<String, dynamic>? lastOrderUpdateBody;
  bool customerMark = false;
  bool orderMark = false;

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    if (path == '/api/sales-orders/order-1') {
      return {
        'data': {
          'salesOrder': _orderJson(
            customerMark: customerMark,
            orderMark: orderMark,
          ),
        },
      };
    }
    if (path.startsWith('/api/sales-orders')) {
      salesOrderListPaths.add(path);
      return {
        'data': {
          'salesOrders': [
            _orderJson(customerMark: customerMark, orderMark: orderMark),
          ],
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
    if (path == '/api/customers/customer-1/finance-mark') {
      lastCustomerMarkBody = Map<String, dynamic>.from(body ?? {});
      customerMark = body?['financeMark'] == true;
      return {
        'data': {
          'customer': _customerJson(financeMark: customerMark),
        },
      };
    }
    if (path == '/api/sales-orders/order-1/finance-mark') {
      lastOrderMarkBody = Map<String, dynamic>.from(body ?? {});
      orderMark = body?['financeMark'] == true;
      return {
        'data': {
          'salesOrder': _orderJson(
            customerMark: customerMark,
            orderMark: orderMark,
          ),
        },
      };
    }
    if (path == '/api/sales-orders/order-1') {
      lastOrderUpdateBody = Map<String, dynamic>.from(body ?? {});
      return {
        'data': {
          'salesOrder': {
            ..._orderJson(customerMark: customerMark, orderMark: orderMark),
            ...?body,
          },
        },
      };
    }
    throw StateError('Unexpected PATCH $path');
  }
}

Map<String, dynamic> _orderJson({
  required bool customerMark,
  required bool orderMark,
}) {
  return {
    'id': 'order-1',
    'orderNo': 'SO20260630001',
    'orderType': 'travel_group',
    'orderDate': '2026-06-30',
    'customerId': 'customer-1',
    'customer': _customerJson(financeMark: customerMark),
    'customerName': '张女士',
    'customerPhone': '13800001111',
    'province': '贵州省',
    'city': '贵阳市',
    'district': '观山湖区',
    'address': '测试路 1 号',
    'travelGroupId': 'group-1',
    'travelGroup': _travelGroupJson(),
    'salesFormNo': 'XS-001',
    'totalAmountCents': 79800,
    'cashOnDeliveryAmountCents': 10000,
    'status': 'valid',
    'deliverySummary': 'shipping',
    'packingStatus': 'pending',
    'logisticsMethod': '顺丰',
    'packageCount': 2,
    'warehouseRemark': '注意防震',
    'logisticsNo': 'SF123456789',
    'logisticsFeeCents': 1800,
    'invoiceRequired': true,
    'invoiceIssued': false,
    'financeRemark': '待核对运费',
    'financeMark': orderMark,
    'salesUserId': 'sales-1',
    'items': [
      {
        'id': 'item-1',
        'salesOrderId': 'order-1',
        'productName': '酱香珍藏',
        'quantity': 2,
        'unitPriceCents': 39900,
        'subtotalCents': 79800,
        'deliveryType': 'shipping',
        'notes': '礼盒装',
        'sortOrder': 1,
      },
    ],
  };
}

Map<String, dynamic> _customerJson({required bool financeMark}) {
  return {
    'id': 'customer-1',
    'name': '张女士',
    'phone': '13800001111',
    'province': '贵州省',
    'city': '贵阳市',
    'district': '观山湖区',
    'address': '测试路 1 号',
    'financeMark': financeMark,
    'markedById': null,
    'markedAt': null,
    'notes': null,
    'createdById': null,
    'updatedById': null,
    'createdAt': null,
    'updatedAt': null,
  };
}

Map<String, dynamic> _travelGroupJson() {
  return {
    'id': 'group-1',
    'kind': 'travel',
    'groupNo': 'TG20260630001',
    'visitDate': '2026-06-30',
    'travelAgency': '测试旅行社',
    'guideName': '李导',
    'guestCount': 20,
    'status': 'unmarked',
    'financeMark': true,
    'tastingItems': const [],
    'salesOrders': const [],
    'orderSummary': const {
      'orderCount': 0,
      'totalAmountCents': 0,
      'cashOnDeliveryAmountCents': 0,
    },
  };
}
