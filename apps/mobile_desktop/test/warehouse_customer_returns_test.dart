import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/business/business_api.dart';
import 'package:jiangjiu_mobile_desktop/core/business/inventory_api.dart';
import 'package:jiangjiu_mobile_desktop/features/warehouse_management/returns/customer_returns_tab.dart';

void main() {
  group('after-sales receipt API contract', () {
    test('preserves serialized codes and hashes URL identifiers', () async {
      final client = _ReturnsFakeApiClient(
        orders: [_physicalReturnJson(serialized: true)],
      );
      final api = InventoryApi(
        apiClient: client,
        token: 'warehouse-token',
        role: UserRole.warehouse,
      );

      await api.createAfterSalesReceipt(
        afterSalesOrderId: 'as-return',
        warehouseId: 'wh-1',
        notes: ' 原瓶核验 ',
        sourceKey: ' Source-Key ',
        idempotencyKey: ' Idem-Key ',
        lines: [
          {
            'afterSalesOrderItemId': 'asi-serialized',
            'lineNo': 1,
            'receivedQty': 1,
            'condition': 'saleable',
            'serializedUnits': [
              {
                'originalSerializedUnitId': 'serial-1',
                'scannedLogisticsCode': '0000123',
              },
            ],
          },
        ],
      );

      final body = client.createBodies.single;
      expect(body['afterSalesOrderId'], isNull);
      expect(body['sourceKey'], 'source-key');
      expect(body['idempotencyKey'], 'idem-key');
      final line = (body['lines'] as List).single as Map<String, dynamic>;
      final serialized =
          (line['serializedUnits'] as List).single as Map<String, dynamic>;
      expect(serialized['scannedLogisticsCode'], '0000123');
      expect(serialized['normalizedScannedLogisticsCode'], isNull);
      expect(
        body['requestHash'],
        calculateAfterSalesReceiptRequestHash(
          'CREATE',
          {
            'afterSalesOrderId': 'as-return',
            'warehouseId': 'wh-1',
            'notes': '原瓶核验',
            'lines': [
              {
                'afterSalesOrderItemId': 'asi-serialized',
                'lineNo': 1,
                'receivedQty': 1,
                'condition': 'SALEABLE',
                'serializedUnits': [
                  {
                    'originalSerializedUnitId': 'serial-1',
                    'scannedLogisticsCode': '0000123',
                    'normalizedScannedLogisticsCode': '0000123',
                  },
                ],
              },
            ],
            'sourceKey': 'source-key',
            'idempotencyKey': 'idem-key',
          },
        ),
      );
    });

    test('sales is rejected locally without any receipt request', () async {
      final client = _ReturnsFakeApiClient(orders: const []);
      final api = InventoryApi(
        apiClient: client,
        token: 'sales-token',
        role: UserRole.sales,
      );

      await expectLater(
        api.listAfterSalesReceipts('as-return'),
        throwsA(
          isA<ApiException>().having(
            (error) => error.statusCode,
            'statusCode',
            403,
          ),
        ),
      );
      await expectLater(
        api.postAfterSalesReceipt(receiptId: 'receipt-1'),
        throwsA(
          isA<ApiException>().having(
            (error) => error.statusCode,
            'statusCode',
            403,
          ),
        ),
      );
      expect(client.requestedPaths, isEmpty);
      expect(client.postedPaths, isEmpty);
    });
  });

  group('customer returns workbench', () {
    testWidgets('wide list excludes refund-only and shows partial progress',
        (tester) async {
      final client = _ReturnsFakeApiClient(
        orders: [
          _physicalReturnJson(postedReceivedQty: 1),
          _refundOnlyJson(),
        ],
      );
      await _pumpReturns(
        tester,
        client,
        role: UserRole.warehouse,
        size: const Size(1500, 900),
      );

      expect(
        find.byKey(const ValueKey('customer-returns-wide-workbench')),
        findsOneWidget,
      );
      expect(find.byType(DataTable), findsOneWidget);
      expect(find.text('AS-RETURN-001'), findsWidgets);
      expect(find.text('AS-REFUND-ONLY'), findsNothing);
      expect(find.text('部分收货'), findsWidgets);
      expect(find.textContaining('累计实收 1 瓶'), findsOneWidget);
      expect(
        client.requestedPaths
            .where((path) => path.contains('/receipts'))
            .length,
        1,
      );
    });

    testWidgets('mobile uses cards and opens a bottom detail sheet',
        (tester) async {
      final client = _ReturnsFakeApiClient(
        orders: [_physicalReturnJson()],
      );
      await _pumpReturns(
        tester,
        client,
        role: UserRole.warehouse,
        size: const Size(390, 820),
      );

      expect(
        find.byKey(const ValueKey('customer-returns-mobile-list')),
        findsOneWidget,
      );
      expect(find.byType(DataTable), findsNothing);
      await tester.tap(
        find.byKey(const ValueKey('customer-return-card-as-return')),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('customer-returns-mobile-detail')),
        findsOneWidget,
      );
      expect(find.text('原订单'), findsOneWidget);
    });

    testWidgets('finance is read-only and never requests stock or cost',
        (tester) async {
      final client = _ReturnsFakeApiClient(
        orders: [_physicalReturnJson()],
      );
      await _pumpReturns(
        tester,
        client,
        role: UserRole.finance,
        size: const Size(1500, 900),
      );

      expect(
        find.byKey(const ValueKey('customer-return-create-receipt')),
        findsNothing,
      );
      expect(find.text('确认收货'), findsNothing);
      expect(find.textContaining('成本'), findsNothing);
      expect(
        client.requestedPaths.any(
          (path) => path.startsWith('/api/inventory/stocks/'),
        ),
        isFalse,
      );
      expect(client.postedPaths, isEmpty);
    });

    testWidgets('boss shows backend blocker without issuing list requests',
        (tester) async {
      final client = _ReturnsFakeApiClient(
        orders: [_physicalReturnJson()],
      );
      await _pumpReturns(
        tester,
        client,
        role: UserRole.boss,
        size: const Size(1500, 900),
      );

      expect(find.text('顾客退货'), findsOneWidget);
      expect(find.textContaining('售后单列表接口尚未向 boss 开放'), findsOneWidget);
      expect(client.requestedPaths, isEmpty);
      expect(client.postedPaths, isEmpty);
    });

    testWidgets('quantity receipt saves unavailable DRAFT without posting',
        (tester) async {
      final client = _ReturnsFakeApiClient(
        orders: [_physicalReturnJson()],
      );
      await _pumpReturns(
        tester,
        client,
        role: UserRole.warehouse,
        size: const Size(1500, 900),
      );

      await tester.tap(
        find.byKey(const ValueKey('customer-return-create-receipt')),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('customer-return-qty-asi-quantity')),
        '1',
      );
      await tester.tap(
        find.byKey(
          const ValueKey('customer-return-condition-asi-quantity'),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('不可售').last);
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey('customer-return-save-draft')),
      );
      await tester.pumpAndSettle();

      expect(client.createBodies, hasLength(1));
      expect(client.postReceiptCount, 0);
      final line = (client.createBodies.single['lines'] as List).single as Map;
      expect(line['receivedQty'], 1);
      expect(line['condition'], 'UNAVAILABLE');
      expect(
        client.createBodies.single.keys,
        isNot(contains('purchaseUnitCostCents')),
      );
    });

    testWidgets('unknown serialized code is forced to exception and preserved',
        (tester) async {
      final client = _ReturnsFakeApiClient(
        orders: [_physicalReturnJson(serialized: true)],
      );
      await _pumpReturns(
        tester,
        client,
        role: UserRole.warehouse,
        size: const Size(1500, 900),
      );

      await tester.tap(
        find.byKey(const ValueKey('customer-return-create-receipt')),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(
          const ValueKey('customer-return-codes-asi-serialized'),
        ),
        '0000999',
      );
      await tester.enterText(
        find.byKey(
          const ValueKey('customer-return-exception-asi-serialized'),
        ),
        '非原订单瓶码',
      );
      await tester.tap(
        find.byKey(const ValueKey('customer-return-save-draft')),
      );
      await tester.pumpAndSettle();

      final line = (client.createBodies.single['lines'] as List).single as Map;
      expect(line['condition'], 'EXCEPTION');
      final unit = (line['serializedUnits'] as List).single as Map;
      expect(unit['scannedLogisticsCode'], '0000999');
      expect(unit['originalSerializedUnitId'], isNull);
    });

    testWidgets('original serialized bottle keeps its source unit id',
        (tester) async {
      final client = _ReturnsFakeApiClient(
        orders: [
          _physicalReturnJson(
            serialized: true,
            includeOriginalBottle: true,
          ),
        ],
      );
      await _pumpReturns(
        tester,
        client,
        role: UserRole.warehouse,
        size: const Size(1500, 900),
      );

      await tester.tap(
        find.byKey(const ValueKey('customer-return-create-receipt')),
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(
          const ValueKey('customer-return-original-code-0000123'),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey('customer-return-save-draft')),
      );
      await tester.pumpAndSettle();

      final line = (client.createBodies.single['lines'] as List).single as Map;
      expect(line['condition'], 'SALEABLE');
      final unit = (line['serializedUnits'] as List).single as Map;
      expect(unit['scannedLogisticsCode'], '0000123');
      expect(unit['originalSerializedUnitId'], 'serial-1');
    });

    testWidgets('draft receipt requires confirmation and posts only once',
        (tester) async {
      final client = _ReturnsFakeApiClient(
        orders: [_physicalReturnJson()],
        receipts: {
          'as-return': [
            _receiptJson(id: 'receipt-draft', status: 'DRAFT'),
          ],
        },
      );
      var inventoryRefreshes = 0;
      await _pumpReturns(
        tester,
        client,
        role: UserRole.warehouse,
        size: const Size(1500, 900),
        onInventoryFactsChanged: () => inventoryRefreshes++,
      );

      await tester.tap(
        find.byKey(const ValueKey('customer-return-post-receipt-draft')),
      );
      await tester.pumpAndSettle();
      expect(find.text('确认实际收货？'), findsOneWidget);
      expect(client.postReceiptCount, 0);
      await tester.tap(
        find.widgetWithText(FilledButton, '确认收货').last,
      );
      await tester.pumpAndSettle();

      expect(client.postReceiptCount, 1);
      expect(inventoryRefreshes, 1);
      expect(client.lastPostBody?['receiptId'], isNull);
      expect(client.lastPostBody?['requestHash'], isNotEmpty);
      expect(
        find.byKey(const ValueKey('customer-return-post-receipt-draft')),
        findsNothing,
      );
      expect(find.text('删除'), findsNothing);
    });
  });
}

Future<void> _pumpReturns(
  WidgetTester tester,
  _ReturnsFakeApiClient client, {
  required UserRole role,
  required Size size,
  VoidCallback? onInventoryFactsChanged,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: CustomerReturnsTab(
          api: InventoryApi(
            apiClient: client,
            token: 'token',
            role: role,
          ),
          businessApi: BusinessApi(apiClient: client, token: 'token'),
          role: role,
          onInventoryFactsChanged: onInventoryFactsChanged ?? () {},
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

class _ReturnsFakeApiClient extends ApiClient {
  _ReturnsFakeApiClient({
    required this.orders,
    Map<String, List<Map<String, dynamic>>> receipts = const {},
  })  : receipts = {
          for (final entry in receipts.entries)
            entry.key: List<Map<String, dynamic>>.from(entry.value),
        },
        super(baseUrl: 'http://127.0.0.1:3000');

  final List<Map<String, dynamic>> orders;
  final Map<String, List<Map<String, dynamic>>> receipts;
  final List<String> requestedPaths = [];
  final List<String> postedPaths = [];
  final List<Map<String, dynamic>> createBodies = [];
  Map<String, dynamic>? lastPostBody;
  int postReceiptCount = 0;

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    requestedPaths.add(path);
    final uri = Uri.parse(path);
    if (uri.path == '/api/inventory/warehouses') {
      return {
        'data': {
          'warehouses': [_warehouseJson()],
          'pagination': _pagination(1),
        },
      };
    }
    if (uri.path == '/api/products/options') {
      return {
        'data': {
          'products': [
            _productJson(id: 'product-quantity', mode: 'quantity'),
            _productJson(id: 'product-serialized', mode: 'serialized'),
          ],
        },
      };
    }
    if (uri.path == '/api/after-sales-orders') {
      return {
        'data': {'afterSalesOrders': orders},
      };
    }
    if (uri.path.startsWith('/api/after-sales-orders/') &&
        uri.path.endsWith('/receipts')) {
      final orderId = uri.pathSegments[2];
      return {
        'data': {
          'afterSalesReceipts': receipts[orderId] ?? const [],
        },
      };
    }
    if (uri.path.startsWith('/api/inventory/stocks/')) {
      return {
        'data': {
          'stock': {
            'warehouse': _warehouseJson(),
            'product': _productJson(
              id: 'product-quantity',
              mode: 'quantity',
            ),
            'batches': const <Map<String, dynamic>>[],
          },
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
    postedPaths.add(path);
    final uri = Uri.parse(path);
    if (uri.path.startsWith('/api/after-sales-orders/receipts/') &&
        uri.path.endsWith('/post')) {
      postReceiptCount++;
      lastPostBody = Map<String, dynamic>.from(body ?? {});
      final receiptId = uri.pathSegments[3];
      for (final entry in receipts.entries) {
        final index =
            entry.value.indexWhere((receipt) => receipt['id'] == receiptId);
        if (index >= 0) {
          final posted = {
            ...entry.value[index],
            'status': 'POSTED',
            'confirmedAt': '2026-07-29T09:30:00.000Z',
          };
          entry.value[index] = posted;
          return {
            'data': {
              'afterSalesReceipt': posted,
              'replayed': false,
            },
          };
        }
      }
    }
    if (uri.path.startsWith('/api/after-sales-orders/') &&
        uri.path.endsWith('/receipts')) {
      final payload = Map<String, dynamic>.from(body ?? {});
      createBodies.add(payload);
      final orderId = uri.pathSegments[2];
      final created = _receiptJson(
        id: 'receipt-created-${createBodies.length}',
        status: 'DRAFT',
        afterSalesOrderId: orderId,
        condition:
            (((payload['lines'] as List?)?.first as Map?)?['condition'] ??
                    'SALEABLE')
                .toString(),
      );
      receipts.putIfAbsent(orderId, () => []).add(created);
      return {
        'data': {
          'afterSalesReceipt': created,
          'replayed': false,
        },
      };
    }
    throw StateError('Unexpected POST $path');
  }
}

Map<String, dynamic> _physicalReturnJson({
  int postedReceivedQty = 0,
  bool serialized = false,
  bool includeOriginalBottle = false,
}) {
  final productId = serialized ? 'product-serialized' : 'product-quantity';
  final itemId = serialized ? 'asi-serialized' : 'asi-quantity';
  final sourceItemId =
      serialized ? 'source-item-serialized' : 'source-item-quantity';
  final sourceOrder = {
    'id': 'sales-order-1',
    'orderNo': 'SO-0001',
    'customerName': '王女士',
    'createdAt': '2026-07-20T08:00:00.000Z',
    'items': [
      {
        'id': sourceItemId,
        'salesOrderId': 'sales-order-1',
        'productId': productId,
        'productName': serialized ? '序列化商品' : '普通商品',
        'quantity': 2,
        'unit': '瓶',
        'serializedUnits': includeOriginalBottle
            ? [
                {
                  'id': 'serial-1',
                  'logisticsCode': '0000123',
                  'productionBatch': '0008',
                  'batchSerialNo': '0001',
                },
              ]
            : const <Map<String, dynamic>>[],
      },
    ],
  };
  return {
    'id': 'as-return',
    'afterSalesNo': 'AS-RETURN-001',
    'salesOrderId': 'sales-order-1',
    'salesOrder': sourceOrder,
    'sourceSalesOrderId': 'sales-order-1',
    'sourceSalesOrder': sourceOrder,
    'customer': {'id': 'customer-1', 'name': '王女士'},
    'issueType': 'quality',
    'actionType': 'return_refund',
    'description': '顾客退货',
    'status': 'waiting_receive',
    'createdAt': '2026-07-21T08:00:00.000Z',
    'updatedAt': '2026-07-21T08:00:00.000Z',
    'items': [
      {
        'id': itemId,
        'afterSalesOrderId': 'as-return',
        'sourceSalesOrderItemId': sourceItemId,
        'productId': productId,
        'productName': serialized ? '序列化商品' : '普通商品',
        'unit': '瓶',
        'quantity': 2,
        'returnRequired': true,
        'expectedReturnQty': 2,
        'postedReceivedQty': postedReceivedQty,
        'remainingReturnQty': 2 - postedReceivedQty,
        'returnProgressStatus':
            postedReceivedQty == 0 ? 'waiting_receive' : 'partially_received',
      },
    ],
  };
}

Map<String, dynamic> _refundOnlyJson() => {
      'id': 'as-refund',
      'afterSalesNo': 'AS-REFUND-ONLY',
      'salesOrderId': 'sales-order-2',
      'salesOrder': {
        'id': 'sales-order-2',
        'orderNo': 'SO-0002',
        'customerName': '李女士',
      },
      'issueType': 'price',
      'actionType': 'refund',
      'description': '只退款',
      'status': 'waiting_refund',
      'createdAt': '2026-07-22T08:00:00.000Z',
      'items': [
        {
          'id': 'asi-refund',
          'afterSalesOrderId': 'as-refund',
          'productId': 'product-quantity',
          'productName': '普通商品',
          'quantity': 1,
          'returnRequired': false,
          'expectedReturnQty': 0,
          'postedReceivedQty': 0,
          'remainingReturnQty': 0,
          'returnProgressStatus': 'not_required',
        },
      ],
    };

Map<String, dynamic> _receiptJson({
  required String id,
  required String status,
  String afterSalesOrderId = 'as-return',
  String condition = 'SALEABLE',
}) =>
    {
      'id': id,
      'afterSalesOrderId': afterSalesOrderId,
      'afterSalesNo': 'AS-RETURN-001',
      'warehouse': _warehouseJson(),
      'status': status,
      'notes': '真实收货',
      'createdAt': '2026-07-29T08:00:00.000Z',
      'lines': [
        {
          'id': '$id-line-1',
          'lineNo': 1,
          'afterSalesOrderItemId': 'asi-quantity',
          'productId': 'product-quantity',
          'productName': '普通商品',
          'receivedQty': 1,
          'condition': condition,
          'serializedSummary': {
            'total': 0,
            'matched': 0,
            'unknown': 0,
            'conflict': 0,
          },
          'serializedUnits': const <Map<String, dynamic>>[],
        },
      ],
    };

Map<String, dynamic> _warehouseJson() => {
      'id': 'wh-1',
      'code': 'WH-01',
      'name': '主仓库',
      'isActive': true,
      'isDefault': true,
    };

Map<String, dynamic> _productJson({
  required String id,
  required String mode,
}) =>
    {
      'id': id,
      'name': mode == 'serialized' ? '序列化商品' : '普通商品',
      'unit': '瓶',
      'inventoryTrackingMode': mode,
    };

Map<String, dynamic> _pagination(int total) => {
      'page': 1,
      'pageSize': 50,
      'total': total,
      'totalPages': total == 0 ? 0 : 1,
    };
