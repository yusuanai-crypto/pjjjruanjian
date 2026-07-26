import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/sales_orders/order_form_entry_page.dart';
import 'package:jiangjiu_mobile_desktop/features/sales_orders/order_form_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets('keeps removed metadata and travel group controls hidden',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpOrderForm(tester, apiClient);

    expect(find.byKey(const ValueKey('order-date-field')), findsOneWidget);
    expect(find.byKey(const ValueKey('order-type-field')), findsNothing);
    expect(
      find.byKey(const ValueKey('order-sales-form-no-field')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('invoice-required-checkbox')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('select-travel-group-button')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('clear-selected-travel-group-button')),
      findsNothing,
    );
    expect(find.text('订单类型'), findsNothing);
    expect(find.text('销售单号（可选）'), findsNothing);
    expect(find.text('客户需要开票'), findsNothing);
  });

  testWidgets('defaults to travel group order and saves travelGroupId',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpOrderForm(tester, apiClient);

    await _selectExistingCustomer(tester);
    await _selectProductForItem(tester, 0, 'product-1');
    await tester.enterText(
      find.byKey(const ValueKey('order-item-quantity-0')),
      '2',
    );
    await tester.enterText(
      find.byKey(const ValueKey('order-item-subtotal-0')),
      '2598',
    );
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
    expect(body['orderType'], 'travel_group');
    expect(body['travelGroupId'], 'group-1');
    expect(body.containsKey('salesFormNo'), isFalse);
    expect(body.containsKey('invoiceRequired'), isFalse);

    final items = body['items'] as List<dynamic>;
    expect(items.first['productId'], 'product-1');
    expect(items.first.containsKey('productName'), isFalse);
    expect(items.first.containsKey('unit'), isFalse);
    expect(items.first['quantity'], 2);
    expect(items.first['unitPriceCents'], 129900);
    expect(items.first['subtotalCents'], 259800);
    expect(items.first['deliveryType'], 'shipping');
    expect(items.first['notes'], '礼盒装');
    expect(items.first['sortOrder'], 1);
    expect(find.text('录入成功'), findsOneWidget);
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

    expect(find.text('¥0.00'), findsWidgets);

    await _selectProductForItem(tester, 0, 'product-1');
    await tester.enterText(
      find.byKey(const ValueKey('order-item-quantity-0')),
      '2',
    );
    await tester.enterText(
      find.byKey(const ValueKey('order-item-subtotal-0')),
      '2598',
    );

    final addButton = find.byKey(const ValueKey('order-item-add-button'));
    await tester.ensureVisible(addButton);
    await tester.tap(addButton);
    await tester.pumpAndSettle();

    await tester
        .ensureVisible(find.byKey(const ValueKey('order-item-product-1')));
    await _selectProductForItem(tester, 1, 'product-2');
    await tester.enterText(
      find.byKey(const ValueKey('order-item-quantity-1')),
      '3',
    );
    await tester.enterText(
      find.byKey(const ValueKey('order-item-subtotal-1')),
      '300',
    );
    await _selectDropdownValue(
      tester,
      key: const ValueKey('order-item-delivery-1'),
      label: '自带',
    );

    expect(find.text('¥2898.00'), findsOneWidget);

    await _selectExistingCustomer(tester);
    await tester.ensureVisible(find.widgetWithText(FilledButton, '保存订单'));
    await tester.tap(find.widgetWithText(FilledButton, '保存订单'));
    await tester.pumpAndSettle();

    final items = apiClient.lastSalesOrderBody!['items'] as List<dynamic>;
    expect(items, hasLength(2));
    expect(items.first['productId'], 'product-1');
    expect(items.first['deliveryType'], 'shipping');
    expect(items.first['sortOrder'], 1);
    expect(items.last['productId'], 'product-2');
    expect(items.last['quantity'], 3);
    expect(items.last['unitPriceCents'], 10000);
    expect(items.last['subtotalCents'], 30000);
    expect(items.last['deliveryType'], 'self_pickup');
    expect(items.last['sortOrder'], 2);
  });

  testWidgets(
      'serialized product picker shows production fields without cost and locks quantity',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpOrderForm(tester, apiClient);
    await _selectExistingCustomer(tester);
    await _selectProductForItem(tester, 0, 'product-moutai');

    expect(
      find.byKey(const ValueKey('order-select-serialized-units')),
      findsOneWidget,
    );
    await tester.tap(
      find.byKey(const ValueKey('order-select-serialized-units')),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('出厂日期 2024-01-02'), findsOneWidget);
    expect(find.textContaining('生产批次 00001'), findsOneWidget);
    expect(find.textContaining('批次序号 00002'), findsOneWidget);
    expect(find.textContaining('00000003'), findsOneWidget);
    expect(find.textContaining('进货价'), findsNothing);
    await tester.tap(
      find.byKey(const ValueKey('serialized-unit-unit-moutai-1')),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('serialized-inventory-confirm')),
    );
    await tester.pumpAndSettle();

    final quantity = tester.widget<TextField>(
      find.byKey(const ValueKey('order-item-quantity-0')),
    );
    expect(quantity.readOnly, true);
    expect(quantity.controller?.text, '1');
    await tester.enterText(
      find.byKey(const ValueKey('order-item-subtotal-0')),
      '3000',
    );
    await tester.ensureVisible(find.widgetWithText(FilledButton, '保存订单'));
    await tester.tap(find.widgetWithText(FilledButton, '保存订单'));
    await tester.pumpAndSettle();

    final item =
        (apiClient.lastSalesOrderBody!['items'] as List<dynamic>).first;
    expect(item['quantity'], 1);
    expect(item['serializedUnitIds'], ['unit-moutai-1']);
    expect(item.containsKey('purchaseCostCents'), false);
  });

  testWidgets('validates editable order item fields before saving',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpOrderForm(tester, apiClient);

    await _selectExistingCustomer(tester);
    await tester.ensureVisible(find.widgetWithText(FilledButton, '保存订单'));
    await tester.tap(find.widgetWithText(FilledButton, '保存订单'));
    await tester.pumpAndSettle();

    expect(find.text('录入失败'), findsOneWidget);
    expect(find.text('第 1 条明细请选择启用商品。'), findsWidgets);
    expect(apiClient.lastSalesOrderBody, isNull);
  });

  testWidgets('handles a missing upstream travel group safely', (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpOrderForm(tester, apiClient, travelGroupId: null);

    expect(
      find.byKey(const ValueKey('order-form-missing-travel-group')),
      findsOneWidget,
    );
    expect(find.textContaining('请从旅行团管理页选择旅行团'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, '保存订单'), findsNothing);
    expect(
      find.byKey(const ValueKey('select-travel-group-button')),
      findsNothing,
    );
    expect(apiClient.lastSalesOrderBody, isNull);
  });

  testWidgets('standalone entry chooses a travel group before opening form',
      (tester) async {
    final apiClient = _FakeApiClient();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: OrderFormEntryPage(
            apiClient: apiClient,
            token: 'test-token',
            role: UserRole.sales,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('choose-travel-group-for-order-button')),
      findsOneWidget,
    );
    expect(find.widgetWithText(FilledButton, '保存订单'), findsNothing);

    await tester.tap(
      find.byKey(const ValueKey('choose-travel-group-for-order-button')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('TG20260630001').last);
    await tester.pumpAndSettle();

    expect(find.byType(OrderFormPage), findsOneWidget);
    expect(find.widgetWithText(FilledButton, '保存订单'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('select-travel-group-button')),
      findsNothing,
    );
  });

  testWidgets('API failure shows its specific reason in a dialog',
      (tester) async {
    final apiClient = _FakeApiClient()..failSalesOrder = true;
    await _pumpOrderForm(tester, apiClient);

    await _selectExistingCustomer(tester);
    await _selectProductForItem(tester, 0, 'product-1');
    final saveButton = find.widgetWithText(FilledButton, '保存订单');
    await tester.ensureVisible(saveButton);
    await tester.tap(saveButton);
    await tester.pumpAndSettle();

    expect(find.text('录入失败'), findsOneWidget);
    expect(find.text('库存不足，请调整商品明细。'), findsWidgets);
  });

  testWidgets('incomplete travel group error lists the front-desk fields',
      (tester) async {
    final apiClient = _FakeApiClient()..failIncompleteTravelGroup = true;
    await _pumpOrderForm(tester, apiClient);

    await _selectExistingCustomer(tester);
    await _selectProductForItem(tester, 0, 'product-1');
    final saveButton = find.widgetWithText(FilledButton, '保存订单');
    await tester.ensureVisible(saveButton);
    await tester.tap(saveButton);
    await tester.pumpAndSettle();

    expect(find.text('录入失败'), findsOneWidget);
    expect(
      find.text('该旅行团前台信息尚未补齐：车牌号、人数、品鉴师，请先联系前台处理。'),
      findsWidgets,
    );
  });
}

Future<void> _pumpOrderForm(
  WidgetTester tester,
  _FakeApiClient apiClient, {
  String? travelGroupId = 'group-1',
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: OrderFormPage(
          apiClient: apiClient,
          token: 'test-token',
          travelGroupId: travelGroupId,
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

Future<void> _selectProductForItem(
  WidgetTester tester,
  int index,
  String productId,
) async {
  final field = find.byKey(ValueKey('order-item-product-$index'));
  await tester.ensureVisible(field);
  await tester.pumpAndSettle();
  final target = find.descendant(of: field, matching: find.byType(InkWell));
  await tester.tap(target.first);
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(ValueKey('product-option-$productId')));
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
  bool failSalesOrder = false;
  bool failIncompleteTravelGroup = false;

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    if (path == '/api/products/options') {
      return {
        'data': {
          'products': const [
            {'id': 'product-1', 'name': '酱香珍藏 53°', 'unit': '瓶'},
            {'id': 'product-2', 'name': '测试小样', 'unit': '盒'},
            {
              'id': 'product-moutai',
              'name': '茅台',
              'unit': '瓶',
              'inventoryTrackingMode': 'serialized',
            },
          ],
        },
      };
    }
    if (path.startsWith('/api/serialized-inventory/available')) {
      return {
        'data': {
          'units': const [
            {
              'id': 'unit-moutai-1',
              'productId': 'product-moutai',
              'productName': '茅台',
              'moutaiName': '2024年甲辰龙年生肖茅台酒',
              'factoryDate': '2024-01-02',
              'productionBatch': '00001',
              'batchSerialNo': '00002',
              'logisticsCode': '00000003',
              'status': 'available',
              'dataComplete': true,
            },
          ],
        },
      };
    }
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
      if (failIncompleteTravelGroup) {
        throw const ApiException(
          statusCode: 409,
          code: 'TRAVEL_GROUP_FRONT_DESK_INFO_INCOMPLETE',
          message: '旅行团前台信息尚未补齐。',
          missingFields: ['licensePlate', 'guestCount', 'tasterId'],
        );
      }
      if (failSalesOrder) {
        throw const ApiException(
          statusCode: 409,
          code: 'INSUFFICIENT_STOCK',
          message: '库存不足，请调整商品明细。',
        );
      }
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
    (sum, item) {
      final subtotalCents = item['subtotalCents'];
      if (subtotalCents is int) {
        return sum + subtotalCents;
      }
      return sum +
          ((item['quantity'] as int? ?? 0) *
              (item['unitPriceCents'] as int? ?? 0));
    },
  );

  return {
    'id': 'order-1',
    'orderNo': 'SO20260630001',
    'orderType': body['orderType'] ?? 'external',
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
    'financeMark': false,
    'tastingItems': const [],
    'salesOrders': const [],
    'orderSummary': const {
      'orderCount': 0,
      'totalAmountCents': 0,
      'cashOnDeliveryAmountCents': 0,
    },
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
