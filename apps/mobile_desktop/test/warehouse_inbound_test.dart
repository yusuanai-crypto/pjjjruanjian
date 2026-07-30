import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/business/business_api.dart';
import 'package:jiangjiu_mobile_desktop/core/business/inventory_api.dart';
import 'package:jiangjiu_mobile_desktop/features/warehouse_management/inventory_workspace_tabs.dart';
import 'package:jiangjiu_mobile_desktop/features/warehouse_management/shared/inventory_workspace_shared.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  group('inbound API contract', () {
    test('parses real nested DTO and strips cost for warehouse', () async {
      final client = _InboundFakeApiClient();
      final warehouseApi = InventoryApi(
        apiClient: client,
        token: 'warehouse-token',
        role: UserRole.warehouse,
      );
      final page = await warehouseApi.listInbounds();
      final document = page.inbounds.single;

      expect(document.documentNo, 'IN-0001');
      expect(document.type, 'PURCHASE_RECEIPT');
      expect(document.status, 'POSTED');
      expect(document.totalQuantity, 12);
      expect(document.lines.single.productName, '测试商品');
      expect(document.lines.single.batch!.purchaseOrderNo, '000123');
      expect(document.lines.single.batch!.productionBatch, '000456');
      expect(document.lines.single.batch!.purchaseUnitCostCents, isNull);
      expect(document.lines.single.inventoryAmountCents, isNull);

      final financeApi = InventoryApi(
        apiClient: client,
        token: 'finance-token',
        role: UserRole.finance,
      );
      final detail = await financeApi.getInbound('in-1');
      expect(detail.lines.single.batch!.purchaseUnitCostCents, 1234);
      expect(detail.lines.single.inventoryAmountCents, 14808);
    });

    test('uses real filters and real single-line create payload', () async {
      final client = _InboundFakeApiClient();
      final api = InventoryApi(
        apiClient: client,
        token: 'admin-token',
        role: UserRole.admin,
      );

      await api.listInbounds(
        warehouseId: 'wh-1',
        productId: 'product-1',
        type: 'OPENING',
        status: 'POSTED',
        batch: '000123',
        dateFrom: DateTime(2026, 7, 1),
        dateTo: DateTime(2026, 7, 31, 23, 59, 59),
      );
      final query = Uri.parse('http://local${client.inboundListPaths.last}')
          .queryParameters;
      expect(query['warehouseId'], 'wh-1');
      expect(query['productId'], 'product-1');
      expect(query['type'], 'OPENING');
      expect(query['status'], 'POSTED');
      expect(query['batch'], '000123');
      expect(query['dateFrom'], isNotNull);
      expect(query['dateTo'], isNotNull);

      await api.createInbound(
        kind: 'PURCHASE_RECEIPT',
        warehouseId: 'wh-1',
        productId: 'product-1',
        quantity: 12,
        sourceLineKey: 'line-0001',
        businessAt: DateTime(2026, 7, 5),
        supplierName: '测试供应商',
        purchaseOrderNo: '000123',
        productionBatch: '000456',
        productionDate: DateTime(2026, 6, 1),
        notes: '整单备注',
        purchaseUnitCostCents: 1234,
      );
      final body = client.createBodies.single;
      expect(body['productId'], 'product-1');
      expect(body['quantity'], 12);
      expect(body.containsKey('lines'), isFalse);
      expect(body['batch']['sourceLineKey'], 'line-0001');
      expect(body['batch']['purchaseOrderNo'], '000123');
      expect(body['batch']['productionBatch'], '000456');
      expect(body['batch']['productionDate'], '2026-06-01');
      expect(body['batch']['purchaseUnitCostCents'], 1234);
      expect(body['requestHash'], isNotEmpty);
    });

    test('warehouse never constructs a cost field', () async {
      final client = _InboundFakeApiClient();
      final api = InventoryApi(
        apiClient: client,
        token: 'warehouse-token',
        role: UserRole.warehouse,
      );
      await api.createInbound(
        kind: 'OTHER_IN',
        warehouseId: 'wh-1',
        productId: 'product-1',
        quantity: 1,
        sourceLineKey: 'line-0002',
        purchaseUnitCostCents: 999999,
      );
      expect(
        (client.createBodies.single['batch'] as Map)
            .containsKey('purchaseUnitCostCents'),
        isFalse,
      );
    });

    test('yuan parser rejects negative and more than two decimals', () {
      expect(parseNonNegativeYuanCents('0'), 0);
      expect(parseNonNegativeYuanCents('12.3'), 1230);
      expect(parseNonNegativeYuanCents('12.34'), 1234);
      expect(parseNonNegativeYuanCents('-1'), isNull);
      expect(parseNonNegativeYuanCents('12.345'), isNull);
    });
  });

  group('inbound responsive and roles', () {
    testWidgets('Windows uses table with cost only for finance',
        (tester) async {
      final financeClient = _InboundFakeApiClient();
      await _pumpInbound(
        tester,
        financeClient,
        role: UserRole.finance,
        size: const Size(1400, 900),
      );
      expect(
        find.byKey(const ValueKey('warehouse-inbound-desktop-table')),
        findsOneWidget,
      );
      expect(find.text('成本'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('warehouse-inbound-create-button')),
        findsNothing,
      );

      final warehouseClient = _InboundFakeApiClient();
      await _pumpInbound(
        tester,
        warehouseClient,
        role: UserRole.warehouse,
        size: const Size(1400, 900),
      );
      expect(find.text('成本'), findsNothing);
      expect(
        find.byKey(const ValueKey('warehouse-inbound-create-button')),
        findsOneWidget,
      );
    });

    testWidgets('phone uses document cards instead of wide table',
        (tester) async {
      await _pumpInbound(
        tester,
        _InboundFakeApiClient(),
        role: UserRole.warehouse,
        size: const Size(390, 844),
      );
      expect(
        find.byKey(const ValueKey('warehouse-inbound-mobile-list')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('warehouse-inbound-desktop-table')),
        findsNothing,
      );
      expect(find.textContaining('12 瓶'), findsOneWidget);
    });

    testWidgets('supplier filter is explicit backend blocker', (tester) async {
      final client = _InboundFakeApiClient();
      await _pumpInbound(tester, client, role: UserRole.warehouse);
      await tester.enterText(
        find.byKey(const ValueKey('warehouse-inbound-supplier-filter')),
        '供应商甲',
      );
      await tester.pump();
      expect(
        find.byKey(const ValueKey('warehouse-inbound-supplier-blocked')),
        findsOneWidget,
      );
      await tester.tap(
        find.byKey(const ValueKey('warehouse-inbound-apply-filters')),
      );
      await tester.pumpAndSettle();
      final query = Uri.parse('http://local${client.inboundListPaths.last}')
          .queryParameters;
      expect(query.containsKey('supplierName'), isFalse);
    });
  });

  group('inbound create workflow', () {
    testWidgets('shows single-line backend limit and serialized redirect',
        (tester) async {
      var openedSerialized = false;
      await _pumpInbound(
        tester,
        _InboundFakeApiClient(),
        role: UserRole.warehouse,
        onOpenSerialized: () => openedSerialized = true,
      );
      await tester.tap(
        find.byKey(const ValueKey('warehouse-inbound-create-button')),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('warehouse-inbound-single-line-limit')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('warehouse-inbound-cost-field')),
        findsNothing,
      );
      final serializedButton =
          find.byKey(const ValueKey('warehouse-inbound-open-serialized'));
      await tester.ensureVisible(serializedButton);
      await tester.tap(serializedButton);
      await tester.pumpAndSettle();
      expect(openedSerialized, isTrue);
    });

    testWidgets('failure retains values and leading zeros', (tester) async {
      final client = _InboundFakeApiClient(failCreate: true);
      await _pumpInbound(tester, client, role: UserRole.warehouse);
      await _openCreateAndFill(
        tester,
        quantity: '2',
        purchaseOrderNo: '000123',
        productionBatch: '000456',
      );
      await _submitCreate(tester);

      expect(
        find.byKey(const ValueKey('warehouse-inbound-submit-error')),
        findsOneWidget,
      );
      expect(
        tester
            .widget<TextFormField>(
              find.byKey(const ValueKey('warehouse-inbound-po-field')),
            )
            .controller!
            .text,
        '000123',
      );
      expect(client.createBodies.single['batch']['purchaseOrderNo'], '000123');
      expect(client.createBodies.single['batch']['productionBatch'], '000456');
    });

    testWidgets('double tap still creates only one posted document',
        (tester) async {
      final client = _InboundFakeApiClient();
      var invalidations = 0;
      await _pumpInbound(
        tester,
        client,
        role: UserRole.warehouse,
        onFactsChanged: () => invalidations++,
      );
      await _openCreateAndFill(tester, quantity: '3');
      final save = find.byKey(const ValueKey('warehouse-inbound-save-button'));
      await tester.ensureVisible(save);
      await tester.tap(save);
      await tester.tap(save, warnIfMissed: false);
      await tester.pumpAndSettle();
      expect(find.text('确认入库生效？'), findsOneWidget);
      await tester.tap(
        find.descendant(
          of: find.byType(AlertDialog),
          matching: find.text('确认入库并生效'),
        ),
      );
      await tester.pumpAndSettle();

      expect(client.createBodies, hasLength(1));
      expect(invalidations, 1);
      expect(find.textContaining('入库已生效'), findsOneWidget);
    });

    testWidgets('admin sees cost field and all three inbound kinds',
        (tester) async {
      await _pumpInbound(
        tester,
        _InboundFakeApiClient(),
        role: UserRole.admin,
      );
      await tester.tap(
        find.byKey(const ValueKey('warehouse-inbound-create-button')),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('warehouse-inbound-cost-field')),
        findsOneWidget,
      );
      await tester.tap(
        find.byKey(const ValueKey('warehouse-inbound-kind-field')),
      );
      await tester.pumpAndSettle();
      expect(find.text('期初库存').last, findsOneWidget);
      expect(find.text('采购入库').last, findsOneWidget);
      expect(find.text('其他入库').last, findsOneWidget);
    });
  });

  group('inbound detail actions', () {
    testWidgets('reversal requires reason and second confirmation',
        (tester) async {
      final client = _InboundFakeApiClient();
      await _pumpInbound(tester, client, role: UserRole.warehouse);
      await tester.tap(
        find.byKey(const ValueKey('warehouse-inbound-select-in-1')),
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey('warehouse-inbound-reverse-in-1')),
      );
      await tester.pumpAndSettle();

      await tester.tap(
        find.byKey(const ValueKey('warehouse-inbound-reverse-next')),
      );
      await tester.pump();
      expect(find.text('填写冲销原因'), findsOneWidget);

      await tester.enterText(
        find.byKey(const ValueKey('warehouse-inbound-reverse-reason')),
        '盘点发现录入错误',
      );
      await tester.tap(
        find.byKey(const ValueKey('warehouse-inbound-reverse-next')),
      );
      await tester.pumpAndSettle();
      expect(find.text('确认冲销入库单？'), findsOneWidget);
      await tester.tap(find.text('确认冲销'));
      await tester.pumpAndSettle();

      expect(client.reverseBodies, hasLength(1));
      expect(client.reverseBodies.single['reason'], '盘点发现录入错误');
    });

    testWidgets('finance updates batch cost as exact integer cents',
        (tester) async {
      final client = _InboundFakeApiClient();
      await _pumpInbound(tester, client, role: UserRole.finance);
      await tester.tap(
        find.byKey(const ValueKey('warehouse-inbound-select-in-1')),
      );
      await tester.pumpAndSettle();
      final costButton = find.byKey(
        const ValueKey('warehouse-inbound-maintain-cost-batch-1'),
      );
      await tester.ensureVisible(costButton);
      await tester.tap(costButton);
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('warehouse-inbound-cost-input')),
        '12.34',
      );
      await tester.tap(
        find.byKey(const ValueKey('warehouse-inbound-cost-save')),
      );
      await tester.pumpAndSettle();

      expect(client.costBodies, hasLength(1));
      expect(client.costBodies.single['purchaseUnitCostCents'], 1234);
      expect(
        find.textContaining('相关库存与报表缓存已失效'),
        findsOneWidget,
      );
    });
  });
}

Future<void> _pumpInbound(
  WidgetTester tester,
  _InboundFakeApiClient client, {
  required UserRole role,
  Size size = const Size(1400, 900),
  VoidCallback? onOpenSerialized,
  VoidCallback? onFactsChanged,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  final inventoryApi = InventoryApi(
    apiClient: client,
    token: '${role.name}-token',
    role: role,
  );
  final businessApi = BusinessApi(
    apiClient: client,
    token: '${role.name}-token',
  );
  await tester.pumpWidget(
    MaterialApp(
      theme: ThemeData.light(),
      home: Scaffold(
        body: Padding(
          padding: const EdgeInsets.all(12),
          child: InboundTab(
            api: inventoryApi,
            businessApi: businessApi,
            role: role,
            onOpenSerialized: onOpenSerialized ?? () {},
            onInventoryFactsChanged: onFactsChanged ?? () {},
            requestedSelection: const InventorySelectionContext(
              warehouseId: 'wh-1',
              productId: 'product-1',
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _openCreateAndFill(
  WidgetTester tester, {
  required String quantity,
  String? purchaseOrderNo,
  String? productionBatch,
}) async {
  await tester.tap(
    find.byKey(const ValueKey('warehouse-inbound-create-button')),
  );
  await tester.pumpAndSettle();
  await tester.enterText(
    find.byKey(const ValueKey('warehouse-inbound-quantity-field')),
    quantity,
  );
  if (purchaseOrderNo != null) {
    await tester.enterText(
      find.byKey(const ValueKey('warehouse-inbound-po-field')),
      purchaseOrderNo,
    );
  }
  if (productionBatch != null) {
    await tester.enterText(
      find.byKey(const ValueKey('warehouse-inbound-batch-field')),
      productionBatch,
    );
  }
}

Future<void> _submitCreate(WidgetTester tester) async {
  final save = find.byKey(const ValueKey('warehouse-inbound-save-button'));
  await tester.ensureVisible(save);
  await tester.tap(save);
  await tester.pumpAndSettle();
  await tester.tap(
    find.descendant(
      of: find.byType(AlertDialog),
      matching: find.text('确认入库并生效'),
    ),
  );
  await tester.pumpAndSettle();
}

class _InboundFakeApiClient extends ApiClient {
  _InboundFakeApiClient({this.failCreate = false})
      : super(baseUrl: 'http://127.0.0.1:3000');

  final bool failCreate;
  final List<String> inboundListPaths = [];
  final List<Map<String, dynamic>> createBodies = [];
  final List<Map<String, dynamic>> reverseBodies = [];
  final List<Map<String, dynamic>> costBodies = [];
  var _document = _inboundJson();

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    if (path == '/api/products/options') {
      return {
        'data': {
          'products': [
            {
              'id': 'product-1',
              'name': '测试商品',
              'unit': '瓶',
              'inventoryTrackingMode': 'quantity',
            },
            {
              'id': 'product-serialized',
              'name': '逐瓶商品',
              'unit': '瓶',
              'inventoryTrackingMode': 'serialized',
            },
          ],
        },
      };
    }
    if (path.startsWith('/api/inventory/warehouses')) {
      return {
        'data': {
          'warehouses': [
            {
              'id': 'wh-1',
              'code': 'W001',
              'name': '主仓库',
              'address': '测试地址',
              'isActive': true,
              'isDefault': true,
            },
          ],
          'pagination': _pagination(1),
        },
      };
    }
    if (path == '/api/inventory/inbounds/in-1' ||
        path == '/api/inventory/inbounds/in-2') {
      return {
        'data': {'inbound': _document}
      };
    }
    if (path.startsWith('/api/inventory/inbounds')) {
      inboundListPaths.add(path);
      return {
        'data': {
          'inbounds': [_document],
          'pagination': _pagination(1),
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
    if (path.endsWith('/reverse')) {
      reverseBodies.add(Map<String, dynamic>.from(body!));
      _document = {..._document, 'status': 'reversed'};
      return {
        'data': {
          'documentId': 'reverse-1',
          'documentNo': 'REV-0001',
          'replayed': false,
        },
      };
    }
    if (path == '/api/inventory/inbounds') {
      createBodies.add(Map<String, dynamic>.from(body!));
      if (failCreate) {
        throw const ApiException(
          statusCode: 422,
          code: 'INVENTORY_VALIDATION_FAILED',
          message: '后端校验失败',
        );
      }
      _document = {
        ..._document,
        'id': 'in-2',
        'documentNo': 'IN-0002',
        'type': '${body['kind']}'.toLowerCase(),
        'status': 'posted',
        'lines': [
          {
            ...(_document['lines'] as List).single as Map<String, dynamic>,
            'quantity': body['quantity'],
            'batch': {
              ...((_document['lines'] as List).single['batch']
                  as Map<String, dynamic>),
              ...body['batch'] as Map<String, dynamic>,
            },
          },
        ],
      };
      return {
        'data': {
          'documentId': 'in-2',
          'documentNo': 'IN-0002',
          'replayed': false,
        },
      };
    }
    throw StateError('Unexpected POST $path');
  }

  @override
  Future<Map<String, dynamic>> patchJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    if (path == '/api/inventory/batches/batch-1/cost') {
      costBodies.add(Map<String, dynamic>.from(body!));
      final line =
          Map<String, dynamic>.from((_document['lines'] as List).single);
      final batch = Map<String, dynamic>.from(line['batch'] as Map);
      batch['purchaseUnitCostCents'] = body['purchaseUnitCostCents'];
      batch['costStatus'] = 'complete';
      line['batch'] = batch;
      line['inventoryAmountCents'] =
          (body['purchaseUnitCostCents'] as int) * (line['quantity'] as int);
      _document = {
        ..._document,
        'lines': [line],
      };
      return {
        'data': {
          'documentId': 'cost-1',
          'documentNo': 'COST-0001',
          'replayed': false,
        },
      };
    }
    throw StateError('Unexpected PATCH $path');
  }
}

Map<String, dynamic> _pagination(int total) => {
      'page': 1,
      'pageSize': 20,
      'total': total,
      'totalPages': total == 0 ? 0 : 1,
    };

Map<String, dynamic> _inboundJson() => {
      'id': 'in-1',
      'documentNo': 'IN-0001',
      'type': 'purchase_receipt',
      'status': 'posted',
      'warehouseId': 'wh-1',
      'warehouse': {'id': 'wh-1', 'code': 'W001', 'name': '主仓库'},
      'sourceType': 'inbound',
      'sourceId': null,
      'sourceKey': 'purchase:000123:line:0001',
      'businessAt': '2026-07-01T08:00:00.000Z',
      'postedBy': {
        'userId': 'warehouse-1',
        'name': '库管甲',
        'role': 'warehouse',
      },
      'postedAt': '2026-07-01T08:00:00.000Z',
      'reversedAt': null,
      'reversalOfDocumentId': null,
      'reason': '采购到货',
      'attachmentMetadata': const [],
      'lines': [
        {
          'id': 'line-1',
          'lineNo': 1,
          'productId': 'product-1',
          'batchId': 'batch-1',
          'quantity': 12,
          'condition': 'unavailable',
          'productNameSnapshot': '测试商品',
          'unitSnapshot': '瓶',
          'notes': '批次备注',
          'purchaseUnitCostCents': 1234,
          'inventoryAmountCents': 14808,
          'batch': {
            'id': 'batch-1',
            'supplierName': '供应商甲',
            'purchaseOrderNo': '000123',
            'productionBatch': '000456',
            'productionDate': '2026-06-01',
            'receivedQty': 12,
            'remainingQty': 12,
            'unavailableQty': 12,
            'purchaseUnitCostCents': 1234,
            'costStatus': 'pending',
            'costCompletedAt': null,
            'fifoAt': '2026-07-01T08:00:00.000Z',
            'createdAt': '2026-07-01T08:00:00.000Z',
            'updatedAt': '2026-07-01T08:00:00.000Z',
          },
          'createdAt': '2026-07-01T08:00:00.000Z',
        },
      ],
      'createdAt': '2026-07-01T08:00:00.000Z',
      'updatedAt': '2026-07-01T08:00:00.000Z',
    };
