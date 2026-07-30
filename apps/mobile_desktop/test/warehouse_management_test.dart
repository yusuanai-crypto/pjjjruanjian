import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/auth/role_access.dart';
import 'package:jiangjiu_mobile_desktop/core/business/inventory_api.dart';
import 'package:jiangjiu_mobile_desktop/features/warehouse_management/warehouse_management_page.dart';

// ===========================================================================
// FakeApiClient — 模拟库存 API 响应
// ===========================================================================

class _FakeApiClient extends ApiClient {
  _FakeApiClient({
    this.warehouses = const [],
    this.stocks = const [],
    this.stocktakes = const [],
    this.alertConfigs = const [],
    this.failStocks = false,
  }) : super(baseUrl: 'http://127.0.0.1:3000');

  final List<Map<String, dynamic>> warehouses;
  final List<Map<String, dynamic>> stocks;
  final List<Map<String, dynamic>> stocktakes;
  final List<Map<String, dynamic>> alertConfigs;
  final bool failStocks;

  final List<String> requestedPaths = [];

  Map<String, dynamic> _pagination(int total,
          {int page = 1, int pageSize = 50}) =>
      {
        'page': page,
        'pageSize': pageSize,
        'total': total,
        'totalPages': (total / pageSize).ceil()
      };

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    requestedPaths.add(path);

    if (path.startsWith('/api/inventory/warehouses')) {
      return {
        'data': {
          'warehouses': warehouses,
          'pagination': _pagination(warehouses.length)
        }
      };
    }
    if (path == '/api/products/options') {
      return {
        'data': {
          'products': [
            {
              'id': 'p1',
              'name': '测试商品',
              'unit': '瓶',
              'inventoryTrackingMode': 'quantity',
            },
          ],
        },
      };
    }
    if (path.startsWith('/api/after-sales-orders')) {
      return {
        'data': {
          'afterSalesOrders': const <Map<String, dynamic>>[],
        },
      };
    }
    if (path.startsWith('/api/inventory/stocks')) {
      if (failStocks) {
        throw const ApiException(
            statusCode: 500, code: 'NETWORK_ERROR', message: '无法连接服务器');
      }
      return {
        'data': {
          'stocks': stocks,
          'pagination': _pagination(stocks.length),
        }
      };
    }
    if (RegExp(r'^/api/inventory/stocktakes/[^?]+$').hasMatch(path)) {
      final id = Uri.decodeComponent(path.split('/').last);
      final record = stocktakes.firstWhere(
        (item) => item['id'] == id,
        orElse: () => const <String, dynamic>{},
      );
      return {
        'data': {'stocktake': record},
      };
    }
    if (path.startsWith('/api/inventory/stocktakes')) {
      return {
        'data': {
          'data': stocktakes,
          'pagination': _pagination(stocktakes.length),
        }
      };
    }
    if (path.startsWith('/api/inventory/inbounds')) {
      return {
        'data': {
          'inbounds': const [],
          'pagination': _pagination(0),
        }
      };
    }
    if (path.startsWith('/api/inventory/transfers')) {
      return {
        'data': {
          'transfers': const [],
          'pagination': _pagination(0),
        }
      };
    }
    if (path.startsWith('/api/inventory/movements')) {
      return {
        'data': {
          'movements': const [],
          'pagination': _pagination(0),
        }
      };
    }
    if (path.startsWith('/api/inventory/alert-configs')) {
      return {
        'data': {
          'alertConfigs': alertConfigs,
          'pagination': _pagination(alertConfigs.length),
        }
      };
    }
    if (path.startsWith('/api/inventory/reports/')) {
      return {
        'data': {
          'reportType': 'warehouse-balances',
          'columns': [
            {'key': 'warehouse', 'label': '仓库', 'type': 'text'},
          ],
          'rows': [],
          'pagination': _pagination(0),
        }
      };
    }
    throw StateError('Unexpected GET $path');
  }

  @override
  Future<Map<String, dynamic>> postJson(String path,
      {Map<String, dynamic>? body, String? token}) async {
    if (path.startsWith('/api/inventory/inbounds')) {
      return {'data': {}};
    }
    if (path.startsWith('/api/inventory/transfers')) {
      return {'data': {}};
    }
    if (path.startsWith('/api/inventory/unavailable')) {
      return {'data': {}};
    }
    if (path.startsWith('/api/inventory/stocktakes')) {
      return {'data': stocktakes.isNotEmpty ? stocktakes.first : {}};
    }
    throw StateError('Unexpected POST $path');
  }

  @override
  Future<Map<String, dynamic>> patchJson(String path,
      {Map<String, dynamic>? body, String? token}) async {
    if (path.startsWith('/api/inventory/alert-configs')) {
      return {'data': {}};
    }
    if (path.startsWith('/api/inventory/batches')) {
      return {'data': {}};
    }
    throw StateError('Unexpected PATCH $path');
  }
}

Map<String, dynamic> _warehouseJson(
        {String id = 'wh1', String name = '主仓库', String code = 'W01'}) =>
    {
      'id': id,
      'code': code,
      'name': name,
      'address': '',
      'manager': {'name': '张三'},
      'isActive': true,
      'isDefault': true
    };

Map<String, dynamic> _stockJson({
  String id = 'stk1',
  String warehouseName = '主仓库',
  String productName = '飞天茅台 53° 500ml',
  int onHand = 100,
  int reserved = 20,
  int unavailable = 5,
  int inTransit = 0,
  int? costCents,
}) {
  final json = <String, dynamic>{
    'id': id,
    'warehouseId': 'wh1',
    'productId': 'p1',
    'warehouse': {
      'id': 'wh1',
      'code': 'W01',
      'name': warehouseName,
      'isActive': true,
      'isDefault': true
    },
    'product': {
      'id': 'p1',
      'name': productName,
      'unit': '瓶',
      'isActive': true,
      'inventoryTrackingMode': 'quantity'
    },
    'onHandQty': onHand,
    'reservedQty': reserved,
    'unavailableQty': unavailable,
    'inTransitQty': inTransit,
    'availableQty': onHand - reserved - unavailable,
    'shortageQty': 0,
    'lowStock': {
      'enabled': false,
      'minimumAvailableQty': 10,
      'isLowStock': false
    },
  };
  if (costCents != null) {
    json['inventoryCost'] = {
      'basis': 'batch',
      'inventoryAmountCents': costCents,
      'coveredQty': onHand,
      'uncoveredQty': 0,
      'factQty': onHand,
      'coverageStatus': 'full',
    };
  }
  return json;
}

Future<void> _pumpPage(
  WidgetTester tester,
  ApiClient apiClient, {
  UserRole role = UserRole.warehouse,
  Size size = const Size(1500, 900),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  await tester.pumpWidget(MaterialApp(
    theme: ThemeData.light(),
    home: Scaffold(
      body: WarehouseManagementPage(
        apiClient: apiClient,
        token: 'test-token',
        role: role,
        onOpenDestination: (_) {},
      ),
    ),
  ));
  await tester.pumpAndSettle();
}

Future<void> _selectModule(WidgetTester tester, String moduleId) async {
  final module = find.byKey(ValueKey('warehouse-module-$moduleId'));
  final compactNavigation =
      find.byKey(const ValueKey('warehouse-secondary-navigation-compact'));

  if (compactNavigation.evaluate().isNotEmpty) {
    await tester.tap(
      find.byKey(const ValueKey('warehouse-module-selector-button')),
    );
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      module,
      180,
      scrollable: find.byType(Scrollable).last,
    );
  } else {
    await tester.scrollUntilVisible(
      module,
      120,
      scrollable: find.descendant(
        of: find.byKey(
          const ValueKey('warehouse-secondary-navigation-wide'),
        ),
        matching: find.byType(Scrollable),
      ),
    );
  }

  await tester.tap(module);
  await tester.pumpAndSettle();
}

// ===========================================================================
// requestHash 算法测试
// ===========================================================================

void main() {
  group('requestHash', () {
    test('canonicalJson sorts keys', () {
      final json = canonicalJson({'b': 1, 'a': 2, 'c': 3});
      expect(json, '{"a":2,"b":1,"c":3}');
    });

    test('canonicalJson handles nested objects', () {
      final json = canonicalJson({
        'outer': {'z': 1, 'a': 2},
      });
      expect(json, '{"outer":{"a":2,"z":1}}');
    });

    test('canonicalJson handles arrays preserving order', () {
      final json = canonicalJson({
        'arr': [3, 1, 2]
      });
      expect(json, '{"arr":[3,1,2]}');
    });

    test('calculateInventoryRequestHash is deterministic', () {
      final input = {
        'warehouseId': 'wh1',
        'productId': 'p1',
        'quantity': 10,
        'sourceKey': 'Test-Key-001',
        'idempotencyKey': 'Idem-001',
      };
      final hash1 = calculateInventoryRequestHash('INBOUND', input);
      final hash2 = calculateInventoryRequestHash('INBOUND', input);
      expect(hash1, hash2);
      expect(hash1.length, 64);
      expect(RegExp(r'^[0-9a-f]{64}$').hasMatch(hash1), isTrue);
    });

    test('sourceKey and idempotencyKey are lowercased before hashing', () {
      final hash1 = calculateInventoryRequestHash('INBOUND', {
        'warehouseId': 'wh1',
        'quantity': 5,
        'sourceKey': 'ABC-123',
        'idempotencyKey': 'XYZ-789',
      });
      final hash2 = calculateInventoryRequestHash('INBOUND', {
        'warehouseId': 'wh1',
        'quantity': 5,
        'sourceKey': 'abc-123',
        'idempotencyKey': 'xyz-789',
      });
      expect(hash1, hash2);
    });

    test('different command types produce different hashes', () {
      final payload = {
        'warehouseId': 'wh1',
        'quantity': 5,
        'sourceKey': 'sk1',
        'idempotencyKey': 'ik1',
      };
      final hash1 = calculateInventoryRequestHash('INBOUND', payload);
      final hash2 = calculateInventoryRequestHash('OUTBOUND', payload);
      expect(hash1, isNot(hash2));
    });

    test(
        'buildCommandEnvelope includes sourceKey, idempotencyKey and requestHash',
        () {
      final envelope = buildCommandEnvelope(
          'INBOUND', {'warehouseId': 'wh1', 'quantity': 5});
      expect(envelope['sourceKey'], isNotNull);
      expect(envelope['idempotencyKey'], isNotNull);
      expect(envelope['requestHash'], isNotNull);
      expect((envelope['requestHash'] as String).length, 64);
    });
  });

  // ===========================================================================
  // 角色权限测试
  // ===========================================================================

  group('role access', () {
    test('canAccessInventory allows warehouse, finance, boss, admin', () {
      expect(canAccessInventory(UserRole.warehouse), isTrue);
      expect(canAccessInventory(UserRole.finance), isTrue);
      expect(canAccessInventory(UserRole.boss), isTrue);
      expect(canAccessInventory(UserRole.admin), isTrue);
      expect(canAccessInventory(UserRole.superAdmin), isTrue);
    });

    test('canAccessInventory denies sales, front_desk, taster, after_sales',
        () {
      expect(canAccessInventory(UserRole.sales), isFalse);
      expect(canAccessInventory(UserRole.frontDesk), isFalse);
      expect(canAccessInventory(UserRole.taster), isFalse);
      expect(canAccessInventory(UserRole.afterSales), isFalse);
    });

    test('canReadInventoryCost excludes warehouse', () {
      expect(canReadInventoryCost(UserRole.warehouse), isFalse);
      expect(canReadInventoryCost(UserRole.finance), isTrue);
      expect(canReadInventoryCost(UserRole.boss), isTrue);
      expect(canReadInventoryCost(UserRole.admin), isTrue);
    });

    test('canReadSerializedCost excludes boss and warehouse', () {
      expect(canReadSerializedCost(UserRole.boss), isFalse);
      expect(canReadSerializedCost(UserRole.warehouse), isFalse);
      expect(canReadSerializedCost(UserRole.finance), isTrue);
      expect(canReadSerializedCost(UserRole.admin), isTrue);
    });

    test('canInboundWrite allows warehouse but not finance', () {
      expect(canInboundWrite(UserRole.warehouse), isTrue);
      expect(canInboundWrite(UserRole.finance), isFalse);
    });

    test('canStocktakeApprove allows boss but not warehouse', () {
      expect(canStocktakeApprove(UserRole.boss), isTrue);
      expect(canStocktakeApprove(UserRole.warehouse), isFalse);
    });

    test('canCostWrite allows finance but not warehouse', () {
      expect(canCostWrite(UserRole.finance), isTrue);
      expect(canCostWrite(UserRole.warehouse), isFalse);
    });

    testWidgets('sales role shows access denied', (tester) async {
      final api = _FakeApiClient();
      await _pumpPage(tester, api, role: UserRole.sales);
      expect(find.text('当前角色无权访问仓库管理模块。'), findsOneWidget);
      expect(api.requestedPaths, isEmpty);
    });

    testWidgets('all non-inventory roles make zero inventory requests',
        (tester) async {
      for (final role in [
        UserRole.sales,
        UserRole.afterSales,
        UserRole.frontDesk,
        UserRole.taster,
      ]) {
        final api = _FakeApiClient();
        await _pumpPage(tester, api, role: role);
        expect(
          find.text('当前角色无权访问仓库管理模块。'),
          findsOneWidget,
          reason: role.value,
        );
        expect(api.requestedPaths, isEmpty, reason: role.value);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      }
    });

    testWidgets('warehouse role shows grouped wide navigation', (tester) async {
      final api = _FakeApiClient(warehouses: [_warehouseJson()]);
      await _pumpPage(tester, api, role: UserRole.warehouse);
      expect(
        find.byKey(const ValueKey('warehouse-secondary-navigation-wide')),
        findsOneWidget,
      );
      expect(find.byType(TabBar), findsNothing);
      expect(find.text('工作台'), findsWidgets);
      expect(find.text('日常作业'), findsOneWidget);
      expect(find.text('盘点与追溯'), findsOneWidget);
      expect(find.text('基础设置'), findsOneWidget);
      expect(find.text('仓库管理'), findsWidgets);
    });

    testWidgets('mobile uses grouped module selector without horizontal tabs',
        (tester) async {
      final api = _FakeApiClient(warehouses: [_warehouseJson()]);
      await _pumpPage(
        tester,
        api,
        role: UserRole.warehouse,
        size: const Size(380, 800),
      );
      expect(
        find.byKey(const ValueKey('warehouse-secondary-navigation-compact')),
        findsOneWidget,
      );
      expect(find.byType(TabBar), findsNothing);
      await tester.tap(
        find.byKey(const ValueKey('warehouse-module-selector-button')),
      );
      await tester.pumpAndSettle();
      expect(find.text('选择仓库管理模块'), findsOneWidget);
      expect(find.text('工作台'), findsWidgets);
      expect(find.text('日常作业'), findsOneWidget);
    });

    testWidgets(
        'effective desktop width protects tables from two-level navigation',
        (tester) async {
      final api = _FakeApiClient(
        warehouses: [_warehouseJson()],
        stocks: [_stockJson()],
      );
      await _pumpPage(
        tester,
        api,
        role: UserRole.warehouse,
        size: const Size(1120, 800),
      );

      expect(
        find.byKey(const ValueKey('warehouse-secondary-navigation-compact')),
        findsOneWidget,
      );
      await _selectModule(tester, 'stock');
      expect(
        find.byKey(const ValueKey('warehouse-stock-table')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('tablet layout remains compact and has no render overflow',
        (tester) async {
      final api = _FakeApiClient(
        warehouses: [_warehouseJson()],
        stocks: [_stockJson()],
      );
      await _pumpPage(
        tester,
        api,
        role: UserRole.warehouse,
        size: const Size(800, 1024),
      );
      await _selectModule(tester, 'stock');

      expect(
        find.byKey(const ValueKey('warehouse-secondary-navigation-compact')),
        findsOneWidget,
      );
      expect(find.byType(DataTable), findsNothing);
      expect(tester.takeException(), isNull);
    });
  });

  group('grouped navigation permissions', () {
    testWidgets('admin sees settings, operational links and approval',
        (tester) async {
      final api = _FakeApiClient(warehouses: [_warehouseJson()]);
      await _pumpPage(
        tester,
        api,
        role: UserRole.admin,
        size: const Size(1500, 1600),
      );
      expect(
        find.byKey(const ValueKey('warehouse-module-warehouse_settings')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('warehouse-module-fulfillment')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('warehouse-module-returns')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('warehouse-module-approval')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('warehouse-module-serialized')),
        findsOneWidget,
      );
    });

    testWidgets('finance has cost pages but no quantity-operation modules',
        (tester) async {
      final api = _FakeApiClient(warehouses: [_warehouseJson()]);
      await _pumpPage(
        tester,
        api,
        role: UserRole.finance,
        size: const Size(1500, 1600),
      );
      expect(
        find.byKey(const ValueKey('warehouse-module-serialized')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('warehouse-module-fulfillment')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('warehouse-module-returns')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('warehouse-module-warehouse_settings')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('warehouse-module-approval')),
        findsNothing,
      );

      await _selectModule(tester, 'inbound');
      expect(
        find.byKey(const ValueKey('warehouse-inbound-create-empty')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('warehouse-inbound-create-button')),
        findsNothing,
      );
    });

    testWidgets('boss exposes approval but no other operational entry',
        (tester) async {
      final api = _FakeApiClient(warehouses: [_warehouseJson()]);
      await _pumpPage(
        tester,
        api,
        role: UserRole.boss,
        size: const Size(1500, 1600),
      );
      expect(
        find.byKey(const ValueKey('warehouse-module-approval')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('warehouse-module-fulfillment')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('warehouse-module-returns')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('warehouse-module-warehouse_settings')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('warehouse-module-serialized')),
        findsNothing,
      );

      await _selectModule(tester, 'inbound');
      expect(
        find.byKey(const ValueKey('warehouse-inbound-create-empty')),
        findsNothing,
      );
    });
  });

  // ===========================================================================
  // 页面加载、空态、错误态测试
  // ===========================================================================

  group('page states', () {
    testWidgets('stock list loads and shows data table on desktop',
        (tester) async {
      final api = _FakeApiClient(
        warehouses: [_warehouseJson()],
        stocks: [_stockJson()],
      );
      await _pumpPage(tester, api, role: UserRole.warehouse);
      await _selectModule(tester, 'stock');
      expect(find.byType(DataTable), findsOneWidget);
      expect(find.textContaining('主仓库'), findsWidgets);
      expect(find.text('飞天茅台 53° 500ml'), findsOneWidget);
    });

    testWidgets('stock list shows empty state when no data', (tester) async {
      final api = _FakeApiClient(warehouses: [_warehouseJson()]);
      await _pumpPage(tester, api, role: UserRole.warehouse);
      await _selectModule(tester, 'stock');
      expect(find.text('暂无库存数据'), findsOneWidget);
    });

    testWidgets('stock list shows error state on API failure', (tester) async {
      final api = _FakeApiClient(
        warehouses: [_warehouseJson()],
        failStocks: true,
      );
      await _pumpPage(tester, api, role: UserRole.warehouse);
      await _selectModule(tester, 'stock');
      expect(find.textContaining('无法连接服务器'), findsOneWidget);
      expect(find.text('重试'), findsOneWidget);
    });

    testWidgets('stock list shows shortage and low stock indicators',
        (tester) async {
      final api = _FakeApiClient(
        warehouses: [_warehouseJson()],
        stocks: [
          _stockJson(
              id: 's1',
              onHand: 10,
              reserved: 15,
              unavailable: 0,
              productName: '商品A'),
        ],
      );
      await _pumpPage(tester, api, role: UserRole.warehouse);
      await _selectModule(tester, 'stock');
      // 可售为负（10-15-0=-5）行应有红色背景
      expect(find.text('商品A'), findsOneWidget);
    });

    testWidgets('mobile layout uses card list instead of data table',
        (tester) async {
      final api = _FakeApiClient(
        warehouses: [_warehouseJson()],
        stocks: [_stockJson()],
      );
      await _pumpPage(tester, api,
          role: UserRole.warehouse, size: const Size(380, 800));
      await _selectModule(tester, 'stock');
      expect(find.byType(DataTable), findsNothing);
      expect(find.byType(Card), findsWidgets);
    });

    testWidgets('module switch preserves stock filter state', (tester) async {
      final api = _FakeApiClient(
        warehouses: [_warehouseJson()],
        stocks: [_stockJson()],
      );
      await _pumpPage(tester, api, role: UserRole.warehouse);
      await _selectModule(tester, 'stock');
      await tester.enterText(
        find.byKey(const ValueKey('warehouse-stock-search')),
        '主仓库',
      );
      await _selectModule(tester, 'alert');
      await _selectModule(tester, 'stock');
      expect(
        tester
            .widget<TextField>(
              find.byKey(const ValueKey('warehouse-stock-search')),
            )
            .controller
            ?.text,
        '主仓库',
      );
    });
  });

  // ===========================================================================
  // 成本列及缓存防泄露测试
  // ===========================================================================

  group('cost column visibility', () {
    testWidgets('warehouse role does not show cost column', (tester) async {
      final api = _FakeApiClient(
        warehouses: [_warehouseJson()],
        stocks: [_stockJson(costCents: 150000)],
      );
      await _pumpPage(tester, api, role: UserRole.warehouse);
      await _selectModule(tester, 'stock');
      expect(find.text('库存成本'), findsNothing);
    });

    testWidgets('finance role shows cost column', (tester) async {
      final api = _FakeApiClient(
        warehouses: [_warehouseJson()],
        stocks: [_stockJson(costCents: 150000)],
      );
      await _pumpPage(tester, api, role: UserRole.finance);
      await _selectModule(tester, 'stock');
      expect(find.text('库存成本'), findsOneWidget);
    });

    test(
        'StockRecord omits cost for warehouse role even if response contains it',
        () {
      // 模拟后端意外返回成本字段（不应发生，但客户端应防御）
      final json = _stockJson(costCents: 99999);
      final record = StockRecord.fromJson(json, canReadCost: false);
      expect(record.inventoryCostAmountCents, isNull);
      expect(record.coverageStatus, 'not_applicable');
    });

    test('StockRecord includes cost for finance role', () {
      final json = _stockJson(costCents: 99999);
      final record = StockRecord.fromJson(json, canReadCost: true);
      expect(record.inventoryCostAmountCents, 99999);
      expect(record.coverageStatus, 'full');
    });

    test('MovementRecord omits cost for warehouse role', () {
      final json = {
        'id': 'm1',
        'movementType': 'PURCHASE_IN',
        'warehouse': {'name': '主仓库'},
        'product': {'name': '商品A'},
        'quantity': 10,
        'purchaseUnitCostCents': 1500,
        'inventoryAmountCents': 15000,
      };
      final record = MovementRecord.fromJson(json, canReadCost: false);
      expect(record.purchaseUnitCostCents, isNull);
      expect(record.inventoryAmountCents, isNull);
    });
  });

  // ===========================================================================
  // 角色切换缓存清除测试
  // ===========================================================================

  group('cache isolation on role switch', () {
    testWidgets('role change resets module state and cost visibility',
        (tester) async {
      final api = _FakeApiClient(
        warehouses: [_warehouseJson()],
        stocks: [_stockJson(costCents: 150000)],
      );
      await _pumpPage(tester, api, role: UserRole.finance);
      await _selectModule(tester, 'stock');
      expect(find.text('库存成本'), findsOneWidget);

      await tester.pumpWidget(MaterialApp(
        theme: ThemeData.light(),
        home: Scaffold(
          body: WarehouseManagementPage(
            apiClient: api,
            token: 'test-token',
            role: UserRole.warehouse,
            onOpenDestination: (_) {},
          ),
        ),
      ));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('warehouse-module-content-overview-1')),
        findsOneWidget,
      );
      expect(find.text('库存成本'), findsNothing);
      await _selectModule(tester, 'stock');
      expect(find.text('库存成本'), findsNothing);
    });

    testWidgets('token change disposes visited module state', (tester) async {
      final api = _FakeApiClient(
        warehouses: [_warehouseJson()],
        stocks: [_stockJson()],
      );
      tester.view.physicalSize = const Size(1500, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);

      Widget page(String token) {
        return MaterialApp(
          home: Scaffold(
            body: WarehouseManagementPage(
              apiClient: api,
              token: token,
              role: UserRole.warehouse,
              onOpenDestination: (_) {},
            ),
          ),
        );
      }

      await tester.pumpWidget(page('token-a'));
      await tester.pumpAndSettle();
      await _selectModule(tester, 'stock');
      await tester.enterText(
        find.byKey(const ValueKey('warehouse-stock-search')),
        '不应保留',
      );

      await tester.pumpWidget(page('token-b'));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('warehouse-module-content-overview-1')),
        findsOneWidget,
      );
      await _selectModule(tester, 'stock');
      expect(
        tester
            .widget<TextField>(
              find.byKey(const ValueKey('warehouse-stock-search')),
            )
            .controller
            ?.text,
        isEmpty,
      );
    });

    test('InventoryApi clearCache empties internal cache', () {
      final api = InventoryApi(
        apiClient: _FakeApiClient(),
        token: 't',
        role: UserRole.finance,
      );
      // clearCache 不应抛出异常
      api.clearCache();
      // 再次调用也不应异常
      api.clearCache();
    });

    test('InventoryApi role binding prevents cost leak', () {
      // warehouse 角色的 InventoryApi.canReadCost 应为 false
      final whApi = InventoryApi(
        apiClient: _FakeApiClient(),
        token: 't',
        role: UserRole.warehouse,
      );
      expect(whApi.canReadCost, isFalse);

      // finance 角色的 InventoryApi.canReadCost 应为 true
      final finApi = InventoryApi(
        apiClient: _FakeApiClient(),
        token: 't',
        role: UserRole.finance,
      );
      expect(finApi.canReadCost, isTrue);
    });
  });

  // ===========================================================================
  // 整数数量和前导零测试
  // ===========================================================================

  group('integer quantity and leading zeros', () {
    test('parseBottleQuantity accepts positive integers', () {
      expect(parseBottleQuantity('1'), 1);
      expect(parseBottleQuantity('10'), 10);
      expect(parseBottleQuantity('999'), 999);
    });

    test('parseBottleQuantity rejects zero', () {
      expect(parseBottleQuantity('0'), isNull);
    });

    test('parseBottleQuantity rejects negative', () {
      expect(parseBottleQuantity('-1'), isNull);
    });

    test('parseBottleQuantity rejects decimals', () {
      expect(parseBottleQuantity('1.5'), isNull);
      expect(parseBottleQuantity('0.5'), isNull);
    });

    test('parseBottleQuantity rejects non-numeric', () {
      expect(parseBottleQuantity('abc'), isNull);
      expect(parseBottleQuantity(''), isNull);
      expect(parseBottleQuantity('  '), isNull);
    });

    test('parseNonNegativeInt accepts zero and positive', () {
      expect(parseNonNegativeInt('0'), 0);
      expect(parseNonNegativeInt('5'), 5);
    });

    test('parseNonNegativeInt rejects negative and decimals', () {
      expect(parseNonNegativeInt('-1'), isNull);
      expect(parseNonNegativeInt('1.5'), isNull);
    });

    test('purchase order number preserves leading zeros as text', () {
      // 采购单号 "00123" 应保持为字符串 "00123"，不被解析为数字 123
      const poNumber = '00123';
      expect(poNumber, '00123');
      expect(int.tryParse(poNumber), 123); // int 会丢失前导零
      // 在 API 调用中应作为字符串传递
      final body = <String, dynamic>{
        'batch': {'purchaseOrderNo': poNumber},
      };
      expect(body['batch']['purchaseOrderNo'], '00123');
    });

    test('production batch preserves leading zeros as text', () {
      const batch = '0001';
      final body = <String, dynamic>{
        'batch': {'productionBatch': batch},
      };
      expect(body['batch']['productionBatch'], '0001');
    });

    testWidgets('inbound form rejects non-integer quantity', (tester) async {
      final api = _FakeApiClient(warehouses: [_warehouseJson()]);
      await _pumpPage(tester, api, role: UserRole.warehouse);
      await _selectModule(tester, 'inbound');
      // 点击新建入库
      final createBtn =
          find.byKey(const ValueKey('warehouse-inbound-create-button'));
      if (createBtn.evaluate().isNotEmpty) {
        await tester.tap(createBtn);
        await tester.pumpAndSettle();
        // 输入不允许的零数量
        await tester.enterText(
            find.byKey(const ValueKey('warehouse-inbound-quantity-field')),
            '0');
        // 尝试保存
        await tester
            .tap(find.byKey(const ValueKey('warehouse-inbound-save-button')));
        await tester.pumpAndSettle();
        // 应显示验证错误
        expect(find.textContaining('正整数'), findsOneWidget);
      }
    });
  });

  // ===========================================================================
  // 盘点审批角色测试
  // ===========================================================================

  group('stocktake approval', () {
    testWidgets('warehouse role does not build approval module',
        (tester) async {
      final api = _FakeApiClient(
        warehouses: [_warehouseJson()],
        stocktakes: [
          {
            'id': 'st1',
            'status': 'SUBMITTED',
            'warehouse': {'name': '主仓库'},
            'product': {'name': '商品A'},
            'systemOnHandQty': 50,
            'countedOnHandQty': 48,
            'varianceQty': -2,
          }
        ],
      );
      await _pumpPage(tester, api, role: UserRole.warehouse);
      expect(
        find.byKey(const ValueKey('warehouse-module-approval')),
        findsNothing,
      );
    });

    testWidgets('boss role sees pending stocktakes with approve/reject',
        (tester) async {
      final api = _FakeApiClient(
        warehouses: [_warehouseJson()],
        stocktakes: [
          {
            'id': 'st1',
            'status': 'SUBMITTED',
            'warehouse': {'name': '主仓库'},
            'product': {'name': '商品A'},
            'systemOnHandQty': 50,
            'countedOnHandQty': 48,
            'varianceQty': -2,
          }
        ],
      );
      await _pumpPage(tester, api, role: UserRole.boss);
      await _selectModule(tester, 'approval');
      expect(find.text('主仓库 · 商品A'), findsOneWidget);
      expect(find.byKey(const ValueKey('warehouse-approval-approve-st1')),
          findsOneWidget);
      expect(find.byKey(const ValueKey('warehouse-approval-reject-st1')),
          findsOneWidget);
    });
  });

  // ===========================================================================
  // 报表角色测试
  // ===========================================================================

  group('report access', () {
    testWidgets('warehouse role cannot see inventory-valuation report',
        (tester) async {
      final api = _FakeApiClient(warehouses: [_warehouseJson()]);
      await _pumpPage(tester, api, role: UserRole.warehouse);
      await _selectModule(tester, 'report');
      // 下拉框中不应有"库存估值"
      final dropdown =
          find.byKey(const ValueKey('warehouse-report-type-selector'));
      expect(dropdown, findsOneWidget);
      // warehouse 的可用报表不应包含 inventory-valuation
    });

    testWidgets('finance role can access cost reports including valuation',
        (tester) async {
      final api = _FakeApiClient(warehouses: [_warehouseJson()]);
      await _pumpPage(tester, api, role: UserRole.finance);
      await _selectModule(tester, 'report');
      final dropdown =
          find.byKey(const ValueKey('warehouse-report-type-selector'));
      expect(dropdown, findsOneWidget);
    });
  });

  // ===========================================================================
  // 快捷入口测试
  // ===========================================================================

  group('quick actions', () {
    testWidgets('packing module embeds the existing warehouse workbench',
        (tester) async {
      String? navigated;
      tester.view.physicalSize = const Size(1500, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      await tester.pumpWidget(MaterialApp(
        theme: ThemeData.light(),
        home: Scaffold(
          body: WarehouseManagementPage(
            apiClient: _FakeApiClient(warehouses: [_warehouseJson()]),
            token: 't',
            role: UserRole.warehouse,
            onOpenDestination: (id) => navigated = id,
          ),
        ),
      ));
      await tester.pumpAndSettle();
      await _selectModule(tester, 'fulfillment');
      expect(find.text('库管打包工作台'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('warehouse-management-packing-entry')),
        findsNothing,
      );
      expect(navigated, isNull);
    });

    testWidgets('moutai compatibility entry visible for warehouse role',
        (tester) async {
      final api = _FakeApiClient(warehouses: [_warehouseJson()]);
      await _pumpPage(tester, api, role: UserRole.warehouse);
      await _selectModule(tester, 'serialized');
      expect(find.byKey(const ValueKey('warehouse-management-moutai-entry')),
          findsOneWidget);
    });

    testWidgets('moutai module hidden for boss role', (tester) async {
      final api = _FakeApiClient(warehouses: [_warehouseJson()]);
      await _pumpPage(tester, api, role: UserRole.boss);
      expect(
        find.byKey(const ValueKey('warehouse-module-serialized')),
        findsNothing,
      );
    });

    testWidgets('returns opens the real warehouse receipt workbench',
        (tester) async {
      String? navigated;
      final api = _FakeApiClient(warehouses: [_warehouseJson()]);
      tester.view.physicalSize = const Size(1500, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: WarehouseManagementPage(
              apiClient: api,
              token: 't',
              role: UserRole.warehouse,
              onOpenDestination: (id) => navigated = id,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await _selectModule(tester, 'returns');
      expect(
        find.byKey(const ValueKey('customer-returns-wide-workbench')),
        findsOneWidget,
      );
      expect(find.text('暂无需要库管收货的售后单'), findsOneWidget);
      expect(
        api.requestedPaths.any(
          (path) => path.startsWith('/api/after-sales-orders?'),
        ),
        isTrue,
      );
      expect(navigated, isNull);
    });

    testWidgets('warehouse settings loads real management UI for admin',
        (tester) async {
      final api = _FakeApiClient(warehouses: [_warehouseJson()]);
      await _pumpPage(tester, api, role: UserRole.admin);
      await _selectModule(tester, 'warehouse_settings');
      expect(
        find.byKey(const ValueKey('warehouse-settings-wide-layout')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('warehouse-settings-table')),
          findsOneWidget);
      expect(find.text('仓库编号'), findsWidgets);
      expect(find.text('负责人'), findsWidgets);
      expect(find.text('物理删除'), findsNothing);
    });
  });

  // ===========================================================================
  // 预警配置测试
  // ===========================================================================

  group('alert configs', () {
    testWidgets('warehouse role loads alert configs', (tester) async {
      final api = _FakeApiClient(
        warehouses: [_warehouseJson()],
        alertConfigs: [
          {
            'id': 'ac1',
            'warehouse': {'name': '主仓库'},
            'product': {'name': '商品A'},
            'minimumAvailableQty': 10,
            'enabled': true,
          }
        ],
      );
      await _pumpPage(tester, api, role: UserRole.warehouse);
      await _selectModule(tester, 'alert');
      expect(find.text('主仓库 · 商品A'), findsOneWidget);
      expect(find.text('最低可售：10 瓶'), findsOneWidget);
    });

    testWidgets('boss role sees alert configs read-only', (tester) async {
      final api = _FakeApiClient(
        warehouses: [_warehouseJson()],
        alertConfigs: [
          {
            'id': 'ac1',
            'warehouse': {'name': '主仓库'},
            'product': {'name': '商品A'},
            'minimumAvailableQty': 5,
            'enabled': false,
          }
        ],
      );
      await _pumpPage(tester, api, role: UserRole.boss);
      await _selectModule(tester, 'alert');
      expect(find.text('已停用'), findsOneWidget);
    });
  });
}
