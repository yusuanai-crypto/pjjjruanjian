import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/app/theme.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/business/business_api.dart';
import 'package:jiangjiu_mobile_desktop/core/business/inventory_api.dart';
import 'package:jiangjiu_mobile_desktop/features/warehouse_management/inventory_workspace_tabs.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  test('transfer API uses the real filter and command contract', () async {
    final client = _InventoryWorkflowApiClient();
    final api = InventoryApi(
      apiClient: client,
      token: 'warehouse-token',
      role: UserRole.warehouse,
    );

    await api.listTransfers(
      fromWarehouseId: 'wh-001',
      toWarehouseId: 'wh-002',
      productId: 'product-001',
      status: 'OUTBOUND',
      dateFrom: DateTime(2026, 7, 1),
      dateTo: DateTime(2026, 7, 31),
    );
    final uri = Uri.parse(client.getPaths.last);
    expect(uri.queryParameters['fromWarehouseId'], 'wh-001');
    expect(uri.queryParameters['toWarehouseId'], 'wh-002');
    expect(uri.queryParameters['productId'], 'product-001');
    expect(uri.queryParameters['status'], 'OUTBOUND');
    expect(uri.queryParameters['dateFrom'], '2026-07-01');
    expect(uri.queryParameters['dateTo'], '2026-07-31');

    await api.confirmTransferOutbound(transferId: 'transfer-001');
    expect(
        client.lastPostPath, '/api/inventory/transfers/transfer-001/outbound');
    expect(client.lastPostBody?['transferId'], 'transfer-001');
    expect(client.lastPostBody?.containsKey('lines'), isFalse);

    await api.receiveTransfer(
      transferId: 'transfer-001',
      lines: const [
        {
          'transferLineId': 'line-0001',
          'receivedQty': 1,
          'unavailableQty': 0,
          'differenceQty': 1,
          'notes': '少收一瓶',
        },
      ],
    );
    expect(
        client.lastPostPath, '/api/inventory/transfers/transfer-001/receipts');
    expect(client.lastPostBody?.containsKey('warehouseId'), isFalse);
    final lines = client.lastPostBody?['lines'] as List;
    expect((lines.single as Map)['transferLineId'], 'line-0001');
  });

  test(
      'available serialized inventory is scoped to warehouse and preserves code',
      () async {
    final client = _InventoryWorkflowApiClient();
    final api = BusinessApi(apiClient: client, token: 'warehouse-token');

    final units = await api.listAvailableSerializedInventory(
      productId: 'product-serialized',
      warehouseId: 'wh-001',
    );

    final uri = Uri.parse(client.getPaths.last);
    expect(uri.path, '/api/serialized-inventory/available');
    expect(uri.queryParameters['productId'], 'product-serialized');
    expect(uri.queryParameters['warehouseId'], 'wh-001');
    expect(units.single.logisticsCode, '000012340001');
    expect(units.single.batchSerialNo, '0007');
    expect(units.single.purchaseCostCents, isNull);
  });

  testWidgets('serialized unavailable stock blocks summary quantity actions',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final client = _InventoryWorkflowApiClient(serializedStock: true);
    final inventoryApi = InventoryApi(
      apiClient: client,
      token: 'warehouse-token',
      role: UserRole.warehouse,
    );

    await tester.pumpWidget(
      MaterialApp(
        theme: buildJiangjiuTheme(),
        home: Scaffold(
          body: UnavailableTab(
            api: inventoryApi,
            businessApi:
                BusinessApi(apiClient: client, token: 'warehouse-token'),
            role: UserRole.warehouse,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('逐瓶不可售转换等待接口'), findsOneWidget);
    expect(find.textContaining('不能退化为修改汇总数量'), findsOneWidget);
    expect(find.text('标记不可售'), findsNothing);
    expect(find.text('恢复可售'), findsNothing);
    expect(client.postPaths, isEmpty);
  });

  testWidgets('wide transfer layout shows real timeline and difference state',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final client = _InventoryWorkflowApiClient(includeTransfer: true);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildJiangjiuTheme(),
        home: Scaffold(
          body: TransferTab(
            api: InventoryApi(
              apiClient: client,
              token: 'warehouse-token',
              role: UserRole.warehouse,
            ),
            businessApi:
                BusinessApi(apiClient: client, token: 'warehouse-token'),
            role: UserRole.warehouse,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('TR00000001'), findsWidgets);
    expect(find.text('调出'), findsOneWidget);
    expect(find.text('运输中'), findsOneWidget);
    expect(find.text('收货'), findsOneWidget);
    expect(find.text('存在差异'), findsWidgets);
    expect(find.textContaining('在途 1 瓶'), findsWidgets);
  });
}

class _InventoryWorkflowApiClient extends ApiClient {
  _InventoryWorkflowApiClient({
    this.serializedStock = false,
    this.includeTransfer = false,
  }) : super(baseUrl: 'http://127.0.0.1:3000');

  final bool serializedStock;
  final bool includeTransfer;
  final List<String> getPaths = [];
  final List<String> postPaths = [];
  String? lastPostPath;
  Map<String, dynamic>? lastPostBody;

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    getPaths.add(path);
    if (path.startsWith('/api/inventory/warehouses')) {
      return {
        'data': {
          'warehouses': [
            _warehouse('wh-001', '001', '一号仓'),
            _warehouse('wh-002', '002', '二号仓'),
          ],
          'pagination': {
            'page': 1,
            'pageSize': 100,
            'total': 2,
            'totalPages': 1,
          },
        },
      };
    }
    if (path == '/api/products/options') {
      return {
        'data': {
          'products': [
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
    if (path.startsWith('/api/serialized-inventory/available')) {
      return {
        'data': {
          'units': [
            {
              'id': 'unit-0001',
              'productId': 'product-serialized',
              'productName': '逐瓶商品',
              'moutaiName': '测试茅台',
              'factoryDate': '2026-01-02',
              'productionBatch': '000123',
              'batchSerialNo': '0007',
              'logisticsCode': '000012340001',
              'purchaseCostCents': 987654,
              'status': 'available',
              'dataComplete': true,
            },
          ],
        },
      };
    }
    if (path.startsWith('/api/inventory/stocks')) {
      return {
        'data': {
          'stocks': [
            {
              'id': 'stock-1',
              'warehouseId': 'wh-001',
              'productId': 'product-serialized',
              'warehouse': {'id': 'wh-001', 'code': '001', 'name': '一号仓'},
              'product': {
                'id': 'product-serialized',
                'name': '逐瓶商品',
                'unit': '瓶',
                'inventoryTrackingMode':
                    serializedStock ? 'serialized' : 'quantity',
              },
              'onHandQty': 2,
              'reservedQty': 0,
              'unavailableQty': 1,
              'inTransitQty': 0,
              'availableQty': 1,
              'shortageQty': 0,
              'lowStock': {'enabled': false, 'isLowStock': false},
              'version': 1,
            },
          ],
          'pagination': {
            'page': 1,
            'pageSize': 20,
            'total': 1,
            'totalPages': 1,
          },
        },
      };
    }
    if (path.startsWith('/api/inventory/transfers/transfer-1')) {
      return {
        'data': {'transfer': _transfer()}
      };
    }
    if (path.startsWith('/api/inventory/transfers')) {
      return {
        'data': {
          'transfers': includeTransfer ? [_transfer()] : const [],
          'pagination': {
            'page': 1,
            'pageSize': 20,
            'total': includeTransfer ? 1 : 0,
            'totalPages': includeTransfer ? 1 : 0,
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
    postPaths.add(path);
    lastPostPath = path;
    lastPostBody = Map<String, dynamic>.from(body ?? const {});
    return {
      'data': {
        'transferId': 'transfer-001',
        'receiptId': path.endsWith('/receipts') ? 'receipt-001' : null,
        'documentIds': const [],
        'replayed': false,
      },
    };
  }
}

Map<String, dynamic> _warehouse(String id, String code, String name) {
  return {
    'id': id,
    'code': code,
    'name': name,
    'address': '测试地址',
    'isActive': true,
    'isDefault': code == '001',
  };
}

Map<String, dynamic> _transfer() {
  return {
    'id': 'transfer-1',
    'transferNo': 'TR00000001',
    'sourceKey': 'source-0001',
    'status': 'partially_received',
    'fromWarehouse': _warehouse('wh-001', '001', '一号仓'),
    'toWarehouse': _warehouse('wh-002', '002', '二号仓'),
    'outboundAt': '2026-07-20T01:00:00.000Z',
    'outboundBy': {
      'userId': 'warehouse-user',
      'name': '库管甲',
      'role': 'warehouse',
    },
    'lines': [
      {
        'id': 'line-0001',
        'lineNo': 1,
        'sourceLineKey': '00000001',
        'product': {
          'id': 'product-serialized',
          'name': '逐瓶商品',
          'unit': '瓶',
          'inventoryTrackingMode': 'SERIALIZED',
        },
        'trackingMode': 'SERIALIZED',
        'plannedQty': 3,
        'outboundQty': 3,
        'receivedQty': 1,
        'unavailableQty': 0,
        'differenceQty': 1,
        'remainingInTransitQty': 1,
        'serializedUnitCount': 3,
        'serializedUnitIds': ['unit-0001', 'unit-0002', 'unit-0003'],
        'sourceStock': {'availableQty': 0},
        'targetStock': {'availableQty': 1},
        'shortageWarning': false,
        'companyQuantity': 2,
        'version': 1,
      },
    ],
    'receipts': const [],
    'createdAt': '2026-07-20T00:00:00.000Z',
    'updatedAt': '2026-07-20T02:00:00.000Z',
    'version': 2,
  };
}
