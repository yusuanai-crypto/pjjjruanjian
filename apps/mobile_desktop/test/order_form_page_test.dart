import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/sales_orders/order_form_page.dart';

void main() {
  testWidgets('requires a travel group for travel group orders',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpOrderForm(tester, apiClient);

    await tester.enterText(
      find.byKey(const ValueKey('order-customer-name-field')),
      '张女士',
    );
    await tester.ensureVisible(find.widgetWithText(FilledButton, '保存订单'));
    await tester.tap(find.widgetWithText(FilledButton, '保存订单'));
    await tester.pumpAndSettle();

    expect(find.text('旅行团订单必须选择旅行团。'), findsOneWidget);
    expect(apiClient.lastSalesOrderBody, isNull);
  });

  testWidgets('saves selected customer and travel group with phase 4 payload',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpOrderForm(tester, apiClient);

    await _selectExistingCustomer(tester);
    await _selectTravelGroup(tester);
    await tester.enterText(
      find.byKey(const ValueKey('order-sales-form-no-field')),
      'XS-20260630-01',
    );
    final invoiceCheckbox =
        find.byKey(const ValueKey('invoice-required-checkbox'));
    await tester.ensureVisible(invoiceCheckbox);
    await tester.tap(invoiceCheckbox);
    await tester.pumpAndSettle();

    await tester
        .ensureVisible(find.byKey(const ValueKey('order-item-notes-0')));
    await tester.enterText(
      find.byKey(const ValueKey('order-item-notes-0')),
      '礼盒装',
    );

    await tester.ensureVisible(find.widgetWithText(FilledButton, '保存订单'));
    await tester.tap(find.widgetWithText(FilledButton, '保存订单'));
    await tester.pumpAndSettle();

    final body = apiClient.lastSalesOrderBody!;
    expect(body.containsKey('orderNo'), isFalse);
    expect(body['customerId'], 'customer-1');
    expect(body.containsKey('customer'), isFalse);
    expect(body['travelGroupId'], 'group-1');
    expect(body['salesFormNo'], 'XS-20260630-01');
    expect(body['invoiceRequired'], isTrue);

    final items = body['items'] as List<dynamic>;
    expect(items.first['productName'], '酱香珍藏 53°');
    expect(items.first['quantity'], 2);
    expect(items.first['unitPriceCents'], 129900);
    expect(items.first['deliveryType'], 'shipping');
    expect(items.first['notes'], '礼盒装');
    expect(items.first['sortOrder'], 1);
    expect(find.textContaining('SO20260630001'), findsWidgets);
  });

  testWidgets('creates a customer from picker and fills the order form',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpOrderForm(tester, apiClient);

    await tester.tap(find.byKey(const ValueKey('select-customer-button')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('open-create-customer-button')));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const ValueKey('customer-name-field')),
      '新客户',
    );
    await tester.enterText(
      find.byKey(const ValueKey('customer-phone-field')),
      '13700001111',
    );
    await tester.enterText(
      find.byKey(const ValueKey('customer-address-field')),
      '测试路 9 号',
    );
    await tester.tap(find.byKey(const ValueKey('save-customer-button')));
    await tester.pumpAndSettle();

    expect(apiClient.lastCustomerBody?['name'], '新客户');
    expect(apiClient.lastCustomerBody?['phone'], '13700001111');
    expect(find.textContaining('已选择：新客户'), findsOneWidget);

    final nameField = tester.widget<TextField>(
      find.byKey(const ValueKey('order-customer-name-field')),
    );
    expect(nameField.controller?.text, '新客户');
  });

  testWidgets('adds deletes totals and saves item delivery choices',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpOrderForm(tester, apiClient);

    expect(find.text('¥6478.00'), findsOneWidget);

    final addButton = find.byKey(const ValueKey('order-item-add-button'));
    await tester.ensureVisible(addButton);
    await tester.tap(addButton);
    await tester.pumpAndSettle();

    await tester
        .ensureVisible(find.byKey(const ValueKey('order-item-product-2')));
    await tester.enterText(
      find.byKey(const ValueKey('order-item-product-2')),
      '测试小样',
    );
    await tester.enterText(
      find.byKey(const ValueKey('order-item-quantity-2')),
      '3',
    );
    await tester.enterText(
      find.byKey(const ValueKey('order-item-unit-price-2')),
      '100',
    );
    await _selectDropdownValue(
      tester,
      key: const ValueKey('order-item-delivery-2'),
      label: '自带',
    );

    expect(find.text('¥6778.00'), findsOneWidget);

    final deleteSecondItem = find.byKey(const ValueKey('order-item-delete-1'));
    await tester.ensureVisible(deleteSecondItem);
    await tester.tap(deleteSecondItem);
    await tester.pumpAndSettle();

    expect(find.text('年份礼盒'), findsNothing);
    expect(find.text('¥2898.00'), findsOneWidget);

    await _selectExistingCustomer(tester);
    await _selectTravelGroup(tester);
    await tester.ensureVisible(find.widgetWithText(FilledButton, '保存订单'));
    await tester.tap(find.widgetWithText(FilledButton, '保存订单'));
    await tester.pumpAndSettle();

    final items = apiClient.lastSalesOrderBody!['items'] as List<dynamic>;
    expect(items, hasLength(2));
    expect(items.first['productName'], '酱香珍藏 53°');
    expect(items.first['deliveryType'], 'shipping');
    expect(items.first['sortOrder'], 1);
    expect(items.last['productName'], '测试小样');
    expect(items.last['quantity'], 3);
    expect(items.last['unitPriceCents'], 10000);
    expect(items.last['deliveryType'], 'self_pickup');
    expect(items.last['sortOrder'], 2);
  });

  testWidgets('validates editable order item fields before saving',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpOrderForm(tester, apiClient);

    await _selectExistingCustomer(tester);
    await _selectTravelGroup(tester);
    await tester
        .ensureVisible(find.byKey(const ValueKey('order-item-product-0')));
    await tester.enterText(
      find.byKey(const ValueKey('order-item-product-0')),
      '',
    );
    await tester.ensureVisible(find.widgetWithText(FilledButton, '保存订单'));
    await tester.tap(find.widgetWithText(FilledButton, '保存订单'));
    await tester.pumpAndSettle();

    expect(find.text('第 1 条明细请填写酒品名称。'), findsOneWidget);
    expect(apiClient.lastSalesOrderBody, isNull);
  });
}

Future<void> _pumpOrderForm(
  WidgetTester tester,
  _FakeApiClient apiClient,
) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: OrderFormPage(
          apiClient: apiClient,
          token: 'test-token',
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _selectExistingCustomer(WidgetTester tester) async {
  final button = find.byKey(const ValueKey('select-customer-button'));
  await tester.ensureVisible(button);
  await tester.pumpAndSettle();
  await tester.tap(button);
  await tester.pumpAndSettle();
  await tester.tap(find.text('张女士').last);
  await tester.pumpAndSettle();
}

Future<void> _selectTravelGroup(WidgetTester tester) async {
  final button = find.byKey(const ValueKey('select-travel-group-button'));
  await tester.ensureVisible(button);
  await tester.pumpAndSettle();
  await tester.tap(button);
  await tester.pumpAndSettle();
  await tester.tap(find.text('TG20260630001').last);
  await tester.pumpAndSettle();
}

Future<void> _selectDropdownValue(
  WidgetTester tester, {
  required Key key,
  required String label,
}) async {
  final field = find.byKey(key);
  await tester.ensureVisible(field);
  await tester.pumpAndSettle();
  await tester.tap(field);
  await tester.pumpAndSettle();
  await tester.tap(find.text(label).last);
  await tester.pumpAndSettle();
}

class _FakeApiClient extends ApiClient {
  _FakeApiClient() : super(baseUrl: 'http://127.0.0.1:3000');

  Map<String, dynamic>? lastCustomerBody;
  Map<String, dynamic>? lastSalesOrderBody;

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    if (path.startsWith('/api/customers')) {
      return {
        'data': {
          'customers': [_customerJson()],
        },
      };
    }
    if (path.startsWith('/api/travel-groups')) {
      return {
        'data': {
          'travelGroups': [_travelGroupJson()],
        },
      };
    }
    throw StateError('Unexpected GET $path');
  }

  @override
  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    if (path == '/api/customers') {
      lastCustomerBody = Map<String, dynamic>.from(body ?? {});
      return {
        'data': {
          'customer': _customerJson(
            id: 'customer-created',
            name: '${body?['name'] ?? ''}',
            phone: '${body?['phone'] ?? ''}',
            address: '${body?['address'] ?? ''}',
          ),
        },
      };
    }
    if (path == '/api/sales-orders') {
      lastSalesOrderBody = Map<String, dynamic>.from(body ?? {});
      return {
        'data': {
          'salesOrder': _salesOrderJson(body ?? const <String, dynamic>{}),
        },
      };
    }
    throw StateError('Unexpected POST $path');
  }
}

Map<String, dynamic> _salesOrderJson(Map<String, dynamic> body) {
  final customerBody = body['customer'] is Map
      ? Map<String, dynamic>.from(body['customer'] as Map)
      : const <String, dynamic>{};
  final customer = body['customerId'] == null
      ? _customerJson(
          id: 'customer-created',
          name: '${customerBody['name'] ?? '新客户'}',
          phone: '${customerBody['phone'] ?? ''}',
          address: '${customerBody['address'] ?? ''}',
        )
      : _customerJson();
  final items = (body['items'] as List<dynamic>? ?? const <dynamic>[])
      .whereType<Map>()
      .map((item) => Map<String, dynamic>.from(item))
      .toList();
  final totalAmountCents = items.fold<int>(
    0,
    (sum, item) =>
        sum +
        ((item['quantity'] as int? ?? 0) *
            (item['unitPriceCents'] as int? ?? 0)),
  );

  return {
    'id': 'order-1',
    'orderNo': 'SO20260630001',
    'orderType': body['orderType'] ?? 'travel_group',
    'orderDate': body['orderDate'] ?? '2026-06-30',
    'customerId': body['customerId'] ?? customer['id'],
    'customer': customer,
    'customerName': customer['name'],
    'customerPhone': customer['phone'],
    'province': customer['province'],
    'city': customer['city'],
    'district': customer['district'],
    'address': customer['address'],
    'travelGroupId': body['travelGroupId'],
    'travelGroup': body['travelGroupId'] == null ? null : _travelGroupJson(),
    'salesFormNo': body['salesFormNo'],
    'totalAmountCents': totalAmountCents,
    'cashOnDeliveryAmountCents': body['cashOnDeliveryAmountCents'] ?? 0,
    'status': 'valid',
    'deliverySummary': 'mixed',
    'packingStatus': 'pending',
    'packageCount': 0,
    'logisticsFeeCents': 0,
    'invoiceRequired': body['invoiceRequired'] ?? false,
    'invoiceIssued': false,
    'financeMark': false,
    'items': [
      for (var index = 0; index < items.length; index += 1)
        {
          'id': 'item-$index',
          'salesOrderId': 'order-1',
          ...items[index],
        },
    ],
  };
}

Map<String, dynamic> _customerJson({
  String id = 'customer-1',
  String name = '张女士',
  String phone = '13800001111',
  String address = '测试路 1 号',
}) {
  return {
    'id': id,
    'name': name,
    'phone': phone,
    'province': '贵州省',
    'city': '贵阳市',
    'district': '观山湖区',
    'address': address,
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
