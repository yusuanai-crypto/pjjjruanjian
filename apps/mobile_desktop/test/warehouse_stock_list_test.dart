import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/business/inventory_api.dart';
import 'package:jiangjiu_mobile_desktop/features/warehouse_management/inventory_workspace_tabs.dart';

class _StockApiClient extends ApiClient {
  _StockApiClient({
    required this.stockPages,
    this.detail,
    this.stockListHandler,
  }) : super(baseUrl: 'http://127.0.0.1:3000');

  final Map<int, List<Map<String, dynamic>>> stockPages;
  final Map<String, dynamic>? detail;
  final Future<Map<String, dynamic>> Function(String path)? stockListHandler;
  final List<String> paths = [];

  @override
  Future<Map<String, dynamic>> getJson(
    String path, {
    String? token,
  }) async {
    paths.add(path);
    final uri = Uri.parse('http://local$path');
    if (uri.path == '/api/inventory/warehouses') {
      return {
        'data': {
          'warehouses': [
            {
              'id': 'wh1',
              'code': 'W01',
              'name': '主仓库',
              'address': '',
              'isActive': true,
              'isDefault': true,
            },
            {
              'id': 'wh2',
              'code': 'W02',
              'name': '分仓库',
              'address': '',
              'isActive': true,
              'isDefault': false,
            },
          ],
          'pagination': _pagination(2, pageSize: 100),
        },
      };
    }
    if (uri.path == '/api/inventory/stocks/wh1/p1') {
      return {
        'data': {'stock': detail ?? _detailJson()}
      };
    }
    if (uri.path == '/api/inventory/stocks') {
      if (stockListHandler != null) return stockListHandler!(path);
      final page = int.tryParse(uri.queryParameters['page'] ?? '') ?? 1;
      final items = stockPages[page] ?? const [];
      final total = stockPages.values.fold<int>(
        0,
        (sum, records) => sum + records.length,
      );
      return {
        'data': {
          'stocks': items,
          'pagination': _pagination(
            total,
            page: page,
            pageSize: 20,
          ),
        },
      };
    }
    if (uri.path == '/api/inventory/movements') {
      return {
        'data': {
          'movements': [
            {
              'id': 'move1',
              'sourceKey': 'movement:0001',
              'warehouseId': 'wh1',
              'productId': 'p1',
              'movementType': 'purchase_in',
              'onHandDelta': 8,
              'reservedDelta': 0,
              'unavailableDelta': 0,
              'inTransitDelta': 0,
              'businessAt': '2026-07-29T01:02:03.000Z',
              'warehouse': {'name': '主仓库'},
              'product': {'name': '商品 A'},
            },
          ],
          'pagination': _pagination(1, pageSize: 5),
        },
      };
    }
    if (uri.path == '/api/inventory/alert-configs') {
      return {
        'data': {
          'alertConfigs': [
            {
              'id': 'alert1',
              'warehouseId': 'wh1',
              'productId': 'p1',
              'minimumAvailableQty': 10,
              'enabled': true,
              'warehouse': {'name': '主仓库'},
              'product': {'name': '商品 A'},
              'updatedAt': '2026-07-29T01:02:03.000Z',
            },
          ],
          'pagination': _pagination(1, pageSize: 5),
        },
      };
    }
    throw StateError('Unexpected GET $path');
  }

  Map<String, dynamic> _pagination(
    int total, {
    int page = 1,
    int pageSize = 20,
  }) {
    return {
      'page': page,
      'pageSize': pageSize,
      'total': total,
      'totalPages': total == 0 ? 0 : (total / pageSize).ceil(),
    };
  }
}

Map<String, dynamic> _stockJson({
  String id = 'stock1',
  String productId = 'p1',
  String productName = '商品 A',
  String trackingMode = 'quantity',
  int onHand = 12,
  int reserved = 3,
  int unavailable = 1,
  int? available,
  int? shortage,
  bool lowStock = false,
  String coverageStatus = 'full',
  int? costCents = 8800,
  int coveredQty = 8,
  int uncoveredQty = 0,
}) {
  final effectiveAvailable = available ?? onHand - reserved - unavailable;
  final effectiveShortage =
      shortage ?? (effectiveAvailable < 0 ? -effectiveAvailable : 0);
  return {
    'id': id,
    'warehouseId': 'wh1',
    'productId': productId,
    'warehouse': {
      'id': 'wh1',
      'code': 'W01',
      'name': '主仓库',
      'isActive': true,
      'isDefault': true,
    },
    'product': {
      'id': productId,
      'name': productName,
      'unit': '瓶',
      'isActive': true,
      'inventoryTrackingMode': trackingMode,
    },
    'onHandQty': onHand,
    'reservedQty': reserved,
    'unavailableQty': unavailable,
    'inTransitQty': 0,
    'availableQty': effectiveAvailable,
    'shortageQty': effectiveShortage,
    'lowStock': {
      'enabled': true,
      'minimumAvailableQty': 10,
      'isLowStock': lowStock,
    },
    'version': 3,
    'lastMovementId': 'move1',
    'updatedAt': '2026-07-29T01:02:03.000Z',
    if (costCents != null)
      'inventoryCost': {
        'basis': trackingMode == 'serialized' ? 'serialized_unit' : 'batch',
        'inventoryAmountCents': costCents,
        'coveredQty': coveredQty,
        'uncoveredQty': uncoveredQty,
        'factQty': coveredQty,
        'coverageStatus': coverageStatus,
        if (coverageStatus != 'full') 'warning': '仍有 $uncoveredQty 瓶等待补录采购成本',
      },
  };
}

Map<String, dynamic> _detailJson({
  String trackingMode = 'quantity',
  String coverageStatus = 'partial',
}) {
  return {
    ..._stockJson(
      trackingMode: trackingMode,
      coverageStatus: coverageStatus,
      coveredQty: 5,
      uncoveredQty: 3,
    ),
    'batches': [
      {
        'id': 'batch1',
        'warehouseId': 'wh1',
        'productId': 'p1',
        'supplierName': '供应商甲',
        'purchaseOrderNo': '0000123',
        'productionBatch': '0000456',
        'productionDate': '2026-07-01',
        'receivedQty': 12,
        'remainingQty': 8,
        'unavailableQty': 1,
        'fifoAt': '2026-07-01T00:00:00.000Z',
        'purchaseUnitCostCents': 1100,
        'inventoryAmountCents': 8800,
        'costStatus': 'complete',
      },
    ],
    'serializedStatusSummary': trackingMode == 'serialized'
        ? {'available': 6, 'reserved': 2, 'unavailable': 1}
        : {},
  };
}

Future<void> _pumpStock(
  WidgetTester tester,
  _StockApiClient client, {
  UserRole role = UserRole.warehouse,
  Size size = const Size(1500, 900),
  ValueChanged<WarehouseStockNavigationRequest>? onNavigate,
  VoidCallback? onOpenSerialized,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  final api = InventoryApi(
    apiClient: client,
    token: 'test-token',
    role: role,
  );
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: StockTab(
          api: api,
          role: role,
          onNavigate: onNavigate ?? (_) {},
          onOpenSerialized: onOpenSerialized ?? () {},
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _submitProductSearch(
  WidgetTester tester,
  String value,
) async {
  final field = find.byKey(const ValueKey('warehouse-stock-search'));
  await tester.enterText(field, value);
  await tester.testTextInput.receiveAction(TextInputAction.search);
  await tester.pump();
}

void main() {
  group('InventoryApi stock DTO', () {
    test('detail keeps identifiers as strings and strips warehouse costs', () {
      final detail = StockDetailRecord.fromJson(
        _detailJson(),
        canReadCost: false,
      );
      expect(detail.batches.single.purchaseOrderNo, '0000123');
      expect(detail.batches.single.productionBatch, '0000456');
      expect(detail.batches.single.purchaseUnitCostCents, isNull);
      expect(detail.stock.inventoryCostAmountCents, isNull);
      expect(detail.stock.inventoryCostWarning, isNull);
    });

    test('authorized role reads service coverage and warning', () {
      final detail = StockDetailRecord.fromJson(
        _detailJson(),
        canReadCost: true,
      );
      expect(detail.stock.coverageStatus, 'partial');
      expect(detail.stock.inventoryCostCoveredQty, 5);
      expect(detail.stock.inventoryCostUncoveredQty, 3);
      expect(
        detail.stock.inventoryCostWarning,
        contains('等待补录采购成本'),
      );
    });
  });

  group('stock filters and stale requests', () {
    testWidgets('all supported filters are sent to the real list endpoint',
        (tester) async {
      final client = _StockApiClient(
        stockPages: {
          1: [_stockJson()],
        },
      );
      await _pumpStock(tester, client);

      await tester.tap(
        find.byKey(const ValueKey('warehouse-stock-warehouse-filter')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('W02 · 分仓库').last);
      await tester.pumpAndSettle();

      await _submitProductSearch(tester, '商品 A');
      await tester.pumpAndSettle();

      await tester.tap(
        find.byKey(const ValueKey('warehouse-stock-mode-filter')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('逐瓶库存').last);
      await tester.pumpAndSettle();

      await tester.tap(
        find.byKey(
          const ValueKey('warehouse-stock-status-shortage'),
        ),
      );
      await tester.pumpAndSettle();

      final path = client.paths.lastWhere(
        (item) =>
            Uri.parse('http://local$item').path == '/api/inventory/stocks',
      );
      final query = Uri.parse('http://local$path').queryParameters;
      expect(query['warehouseId'], 'wh2');
      expect(query['product'], '商品 A');
      expect(query['inventoryTrackingMode'], 'SERIALIZED');
      expect(query['hasShortage'], 'true');

      await tester.tap(
        find.byKey(
          const ValueKey('warehouse-stock-status-lowStock'),
        ),
      );
      await tester.pumpAndSettle();
      var latest = Uri.parse(
        'http://local${client.paths.lastWhere((item) => Uri.parse('http://local$item').path == '/api/inventory/stocks')}',
      ).queryParameters;
      expect(latest['isLowStock'], 'true');
      expect(latest['hasShortage'], isNull);

      await tester.tap(
        find.byKey(
          const ValueKey('warehouse-stock-status-unavailable'),
        ),
      );
      await tester.pumpAndSettle();
      latest = Uri.parse(
        'http://local${client.paths.lastWhere((item) => Uri.parse('http://local$item').path == '/api/inventory/stocks')}',
      ).queryParameters;
      expect(latest['hasUnavailable'], 'true');
      expect(latest['isLowStock'], isNull);

      await tester.tap(
        find.byKey(const ValueKey('warehouse-stock-reset')),
      );
      await tester.pumpAndSettle();
      latest = Uri.parse(
        'http://local${client.paths.lastWhere((item) => Uri.parse('http://local$item').path == '/api/inventory/stocks')}',
      ).queryParameters;
      expect(latest['warehouseId'], isNull);
      expect(latest['product'], isNull);
      expect(latest['inventoryTrackingMode'], isNull);
      expect(latest['hasUnavailable'], isNull);
    });

    testWidgets('normal and pending cost filters show backend blocker',
        (tester) async {
      final client = _StockApiClient(
        stockPages: {
          1: [_stockJson()],
        },
      );
      await _pumpStock(tester, client);
      final before = client.paths
          .where((path) => path.startsWith('/api/inventory/stocks?'))
          .length;

      await tester.tap(
        find.byKey(const ValueKey('warehouse-stock-status-normal')),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('尚未提供“正常”服务端筛选参数'), findsOneWidget);
      expect(
        client.paths
            .where((path) => path.startsWith('/api/inventory/stocks?'))
            .length,
        before,
      );

      await tester.tap(
        find.byKey(
          const ValueKey('warehouse-stock-status-pendingCost'),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('尚未提供“待补成本”'), findsOneWidget);
      expect(
        client.paths.any((path) => path.contains('ProductActualCost')),
        isFalse,
      );
    });

    testWidgets('late response cannot overwrite the newest product filter',
        (tester) async {
      final first = Completer<Map<String, dynamic>>();
      final second = Completer<Map<String, dynamic>>();
      final client = _StockApiClient(
        stockPages: const {},
        stockListHandler: (path) {
          final product =
              Uri.parse('http://local$path').queryParameters['product'];
          if (product == 'first') return first.future;
          if (product == 'second') return second.future;
          return Future.value({
            'data': {
              'stocks': [_stockJson(productName: '初始商品')],
              'pagination': {
                'page': 1,
                'pageSize': 20,
                'total': 1,
                'totalPages': 1,
              },
            },
          });
        },
      );
      await _pumpStock(tester, client);

      await _submitProductSearch(tester, 'first');
      await _submitProductSearch(tester, 'second');
      second.complete({
        'data': {
          'stocks': [_stockJson(productName: '最新结果')],
          'pagination': {
            'page': 1,
            'pageSize': 20,
            'total': 1,
            'totalPages': 1,
          },
        },
      });
      await tester.pumpAndSettle();
      expect(find.text('最新结果'), findsOneWidget);

      first.complete({
        'data': {
          'stocks': [_stockJson(productName: '过期结果')],
          'pagination': {
            'page': 1,
            'pageSize': 20,
            'total': 1,
            'totalPages': 1,
          },
        },
      });
      await tester.pumpAndSettle();
      expect(find.text('最新结果'), findsOneWidget);
      expect(find.text('过期结果'), findsNothing);
    });
  });

  group('stock responsive UI and detail', () {
    testWidgets('wide table preserves negative quantity and status labels',
        (tester) async {
      final client = _StockApiClient(
        stockPages: {
          1: [
            _stockJson(
              onHand: 5,
              reserved: 9,
              unavailable: 1,
              available: -5,
              shortage: 5,
              lowStock: true,
            ),
          ],
        },
      );
      await _pumpStock(tester, client);
      expect(find.byType(DataTable), findsOneWidget);
      expect(find.text('-5 瓶'), findsOneWidget);
      expect(find.text('短缺'), findsWidgets);
      expect(find.text('低库存'), findsWidgets);
    });

    testWidgets('mobile uses expandable cards and load more', (tester) async {
      final client = _StockApiClient(
        stockPages: {
          1: List.generate(
            20,
            (index) => _stockJson(
              id: 'stock-$index',
              productId: 'p-$index',
              productName: '商品 $index',
            ),
          ),
          2: [_stockJson(id: 'stock-21', productName: '第二页商品')],
        },
      );
      await _pumpStock(
        tester,
        client,
        size: const Size(390, 850),
      );
      expect(find.byType(DataTable), findsNothing);
      expect(
        find.byKey(const ValueKey('warehouse-stock-card-list')),
        findsOneWidget,
      );
      await tester.tap(
        find.byKey(
          const ValueKey('warehouse-stock-card-expand-stock-0'),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('账面现存'), findsOneWidget);

      await tester.drag(
        find.byKey(const ValueKey('warehouse-stock-card-list')),
        const Offset(0, -1400),
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey('warehouse-stock-load-more')),
      );
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('第二页商品'),
        500,
        scrollable: find.descendant(
          of: find.byKey(const ValueKey('warehouse-stock-card-list')),
          matching: find.byType(Scrollable),
        ),
      );
      expect(find.text('第二页商品'), findsOneWidget);
    });

    testWidgets(
        'detail shows formula, batches, partial coverage and navigation',
        (tester) async {
      WarehouseStockNavigationRequest? navigation;
      final client = _StockApiClient(
        stockPages: {
          1: [_stockJson(coverageStatus: 'partial', uncoveredQty: 3)],
        },
      );
      await _pumpStock(
        tester,
        client,
        role: UserRole.admin,
        onNavigate: (request) => navigation = request,
      );
      await tester.tap(find.text('商品 A').first);
      await tester.pumpAndSettle();
      expect(find.text('数量公式'), findsOneWidget);
      expect(find.textContaining('生产批次 0000456'), findsOneWidget);
      expect(find.text('部分覆盖'), findsWidgets);
      expect(find.textContaining('等待补录采购成本'), findsOneWidget);
      expect(find.textContaining('采购单号：0000123'), findsOneWidget);

      await tester.tap(
        find.byKey(
          const ValueKey('warehouse-stock-detail-action-movement'),
        ),
      );
      expect(navigation?.moduleId, 'movement');
      expect(navigation?.warehouseId, 'wh1');
      expect(navigation?.productId, 'p1');
    });

    testWidgets('serialized entry depends on tracking mode, not product name',
        (tester) async {
      var opened = false;
      final client = _StockApiClient(
        stockPages: {
          1: [
            _stockJson(
              productName: '普通测试名称',
              trackingMode: 'serialized',
            ),
          ],
        },
        detail: _detailJson(trackingMode: 'serialized'),
      );
      await _pumpStock(
        tester,
        client,
        role: UserRole.warehouse,
        onOpenSerialized: () => opened = true,
      );
      await tester.tap(find.text('普通测试名称').first);
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('warehouse-stock-open-serialized')),
        findsOneWidget,
      );
      await tester.tap(
        find.byKey(const ValueKey('warehouse-stock-open-serialized')),
      );
      expect(opened, isTrue);
    });

    testWidgets('warehouse never displays or requests cost-specific data',
        (tester) async {
      final client = _StockApiClient(
        stockPages: {
          1: [_stockJson()],
        },
      );
      await _pumpStock(tester, client, role: UserRole.warehouse);
      expect(find.text('库存成本'), findsNothing);
      await tester.tap(find.text('商品 A').first);
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('warehouse-stock-detail-cost')),
        findsNothing,
      );
      expect(
        client.paths.any(
          (path) =>
              path.contains('inventory-valuation') ||
              path.contains('/batches/') ||
              path.contains('includeCost'),
        ),
        isFalse,
      );
    });

    testWidgets('finance sees cost but no quantity action buttons',
        (tester) async {
      final client = _StockApiClient(
        stockPages: {
          1: [_stockJson()],
        },
      );
      await _pumpStock(tester, client, role: UserRole.finance);
      expect(find.text('库存成本'), findsOneWidget);
      await tester.tap(find.text('商品 A').first);
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('warehouse-stock-detail-cost')),
        findsOneWidget,
      );
      expect(
        find.byKey(
          const ValueKey('warehouse-stock-detail-action-inbound'),
        ),
        findsNothing,
      );
      expect(
        find.byKey(
          const ValueKey('warehouse-stock-detail-action-movement'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('boss sees inventory cost but no quantity actions',
        (tester) async {
      final client = _StockApiClient(
        stockPages: {
          1: [_stockJson()],
        },
      );
      await _pumpStock(tester, client, role: UserRole.boss);
      expect(find.text('库存成本'), findsOneWidget);
      await tester.tap(find.text('商品 A').first);
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('warehouse-stock-detail-cost')),
        findsOneWidget,
      );
      expect(
        find.byKey(
          const ValueKey('warehouse-stock-detail-action-stocktake'),
        ),
        findsNothing,
      );
      expect(
        find.byKey(
          const ValueKey('warehouse-stock-detail-action-movement'),
        ),
        findsOneWidget,
      );
    });
  });
}
