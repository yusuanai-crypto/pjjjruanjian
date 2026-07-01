import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/after_sales/after_sales_form_page.dart';

void main() {
  testWidgets('searches real sales orders and fills selected order',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpAfterSalesForm(tester, apiClient);

    expect(find.text('SO-20260622-031'), findsNothing);
    expect(find.text('AS-20260621-008'), findsNothing);
    expect(find.text('输入客户姓名、电话或订单号搜索'), findsOneWidget);

    await tester.enterText(
      find.byKey(const ValueKey('after-sales-order-search-field')),
      '13800001111',
    );
    await tester.tap(
      find.byKey(const ValueKey('after-sales-order-search-button')),
    );
    await tester.pumpAndSettle();

    final uri = Uri.parse(apiClient.salesOrderListPaths.last);
    expect(uri.path, '/api/sales-orders');
    expect(uri.queryParameters['query'], '13800001111');
    expect(uri.queryParameters['limit'], '50');

    expect(find.text('SO20260630001'), findsWidgets);
    expect(find.textContaining('张女士'), findsWidgets);
    expect(find.textContaining('订单金额 ¥798.00'), findsOneWidget);
    expect(find.text('邮寄'), findsWidgets);
    expect(find.text('客户未标记'), findsOneWidget);

    await tester.tap(find.text('SO20260630001').first);
    await tester.pumpAndSettle();

    expect(find.text('关联订单'), findsOneWidget);
    expect(find.text('贵州省贵阳市观山湖区测试路 1 号'), findsOneWidget);
    expect(find.text('TG20260630001'), findsWidgets);
    expect(find.text('酱香珍藏 x2 · ¥798.00 · 邮寄'), findsOneWidget);
  });

  testWidgets('shows empty state when no orders match', (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpAfterSalesForm(tester, apiClient);

    await tester.enterText(
      find.byKey(const ValueKey('after-sales-order-search-field')),
      'missing',
    );
    await tester.tap(
      find.byKey(const ValueKey('after-sales-order-search-button')),
    );
    await tester.pumpAndSettle();

    expect(find.text('未找到匹配订单'), findsOneWidget);
  });
}

Future<void> _pumpAfterSalesForm(
  WidgetTester tester,
  _FakeApiClient apiClient,
) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: AfterSalesFormPage(
          apiClient: apiClient,
          token: 'test-token',
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

class _FakeApiClient extends ApiClient {
  _FakeApiClient() : super(baseUrl: 'http://127.0.0.1:3000');

  final List<String> salesOrderListPaths = <String>[];

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    if (path.startsWith('/api/sales-orders')) {
      salesOrderListPaths.add(path);
      final uri = Uri.parse(path);
      final query = uri.queryParameters['query'];
      return {
        'data': {
          'salesOrders': query == 'missing' ? const [] : [_orderJson()],
        },
      };
    }

    throw StateError('Unexpected GET $path');
  }
}

Map<String, dynamic> _orderJson() {
  return {
    'id': 'order-1',
    'orderNo': 'SO20260630001',
    'orderType': 'travel_group',
    'orderDate': '2026-06-30',
    'customerId': 'customer-1',
    'customer': _customerJson(),
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
    'financeMark': false,
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

Map<String, dynamic> _customerJson() {
  return {
    'id': 'customer-1',
    'name': '张女士',
    'phone': '13800001111',
    'province': '贵州省',
    'city': '贵阳市',
    'district': '观山湖区',
    'address': '测试路 1 号',
    'financeMark': false,
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
