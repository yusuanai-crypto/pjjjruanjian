import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/business/inventory_api.dart';
import 'package:jiangjiu_mobile_desktop/features/warehouse_management/overview/inventory_overview_page.dart';
import 'package:jiangjiu_mobile_desktop/features/warehouse_management/warehouse_management_page.dart';
import 'package:jiangjiu_mobile_desktop/features/warehouse_management/warehouse_settings_page.dart';

class _OverviewSettingsApiClient extends ApiClient {
  _OverviewSettingsApiClient({
    this.failLowStock = false,
    this.disableConflict = false,
    this.emptyMetrics = false,
  }) : super(baseUrl: 'http://127.0.0.1:3000');

  final bool failLowStock;
  final bool disableConflict;
  final bool emptyMetrics;
  final List<String> requestedPaths = [];
  final List<Map<String, dynamic>> patchBodies = [];
  final List<Map<String, dynamic>> warehouses = [
    {
      'id': 'wh-default',
      'code': 'W001',
      'name': '主仓库',
      'address': '上海市',
      'managerUserId': 'user-001',
      'manager': {'id': 'user-001', 'name': '张三'},
      'isActive': true,
      'isDefault': true,
      'createdAt': '2026-07-01T08:00:00.000Z',
      'updatedAt': '2026-07-28T08:00:00.000Z',
    },
    {
      'id': 'wh-second',
      'code': 'W002',
      'name': '二号仓',
      'address': '杭州市',
      'managerUserId': null,
      'manager': null,
      'isActive': true,
      'isDefault': false,
      'createdAt': '2026-07-02T08:00:00.000Z',
      'updatedAt': '2026-07-29T08:00:00.000Z',
    },
  ];

  Map<String, dynamic> _page(int total, {int pageSize = 20}) => {
        'page': 1,
        'pageSize': pageSize,
        'total': total,
        'totalPages': total == 0 ? 0 : 1,
      };

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    requestedPaths.add(path);
    if (path.startsWith('/api/inventory/warehouses')) {
      return {
        'data': {
          'warehouses': warehouses,
          'pagination': _page(warehouses.length, pageSize: 100),
        },
      };
    }
    if (path.startsWith('/api/inventory/stocks')) {
      if (failLowStock && path.contains('isLowStock=true')) {
        throw const ApiException(
          statusCode: 500,
          code: 'NETWORK_ERROR',
          message: '低库存加载失败',
        );
      }
      final total = emptyMetrics
          ? 0
          : path.contains('hasShortage=true')
              ? 3
              : path.contains('isLowStock=true')
                  ? 4
                  : 12;
      return {
        'data': {
          'stocks': const [],
          'pagination': _page(total, pageSize: 1),
        },
      };
    }
    if (path.startsWith('/api/inventory/stocktakes')) {
      return {
        'data': {
          'data': const [],
          'pagination': _page(emptyMetrics ? 0 : 2, pageSize: 1),
        },
      };
    }
    if (path.startsWith('/api/inventory/transfers')) {
      final total = emptyMetrics
          ? 0
          : path.contains('PARTIALLY_RECEIVED')
              ? 1
              : 2;
      return {
        'data': {
          'transfers': const [],
          'pagination': _page(total, pageSize: 1),
        },
      };
    }
    if (path.startsWith('/api/inventory/movements')) {
      return {
        'data': {
          'movements': [
            {
              'id': 'movement-001',
              'movementType': 'purchase_in',
              'warehouse': {'name': '主仓库'},
              'product': {'name': '商品A'},
              'onHandDelta': 6,
              'reservedDelta': 0,
              'unavailableDelta': 0,
              'inTransitDelta': 0,
              'businessAt': '2026-07-29T09:00:00.000Z',
              'purchaseUnitCostCents': 1200,
              'inventoryAmountCents': 7200,
            },
          ],
          'pagination': _page(1, pageSize: 8),
        },
      };
    }
    if (path.startsWith('/api/inventory/inbounds')) {
      return {
        'data': {
          'inbounds': const [],
          'pagination': _page(0),
        },
      };
    }
    if (path.startsWith('/api/inventory/alert-configs')) {
      return {
        'data': {
          'alertConfigs': const [],
          'pagination': _page(0),
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
    patchBodies.add(Map<String, dynamic>.from(body ?? const {}));
    final id = path.split('/').last;
    final index = warehouses.indexWhere((item) => item['id'] == id);
    if (disableConflict && body?['isActive'] == false) {
      throw const ApiException(
        statusCode: 409,
        code: 'INVENTORY_WAREHOUSE_HAS_ACTIVE_BUSINESS',
        message: 'Warehouse has active business.',
      );
    }
    if (body?['isDefault'] == true) {
      for (final warehouse in warehouses) {
        warehouse['isDefault'] = warehouse['id'] == id;
      }
    }
    if (index >= 0) warehouses[index].addAll(body ?? const {});
    return {'data': warehouses[index]};
  }

  @override
  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    if (path == '/api/inventory/warehouses') {
      final warehouse = <String, dynamic>{
        'id': 'wh-new',
        ...?body,
        'manager': null,
        'createdAt': '2026-07-29T09:00:00.000Z',
        'updatedAt': '2026-07-29T09:00:00.000Z',
      };
      warehouses.add(warehouse);
      return {'data': warehouse};
    }
    if (path.startsWith('/api/inventory/stocktakes')) {
      return {'data': const {}};
    }
    throw StateError('Unexpected POST $path');
  }
}

Future<void> _pumpSized(
  WidgetTester tester,
  Widget child, {
  Size size = const Size(1400, 900),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  await tester.pumpWidget(
    MaterialApp(
      theme: ThemeData.light(),
      home: Scaffold(body: child),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('inventory overview', () {
    testWidgets('shows unsupported metrics and isolates a section failure',
        (tester) async {
      final client = _OverviewSettingsApiClient(failLowStock: true);
      final api = InventoryApi(
        apiClient: client,
        token: 'token',
        role: UserRole.warehouse,
      );

      await _pumpSized(
        tester,
        InventoryOverviewPage(
          api: api,
          role: UserRole.warehouse,
          onNavigate: (_) {},
        ),
      );

      expect(find.text('商品库存项'), findsOneWidget);
      expect(find.text('12'), findsOneWidget);
      expect(find.text('暂未提供'), findsWidgets);
      expect(find.text('加载失败，点击重试'), findsOneWidget);
      expect(find.text('最近库存动态'), findsOneWidget);
      expect(find.textContaining('现存 +6 瓶'), findsOneWidget);
      expect(find.textContaining('¥'), findsNothing);
    });

    testWidgets('attention navigation carries the stock filter',
        (tester) async {
      final client = _OverviewSettingsApiClient();
      final api = InventoryApi(
        apiClient: client,
        token: 'token',
        role: UserRole.warehouse,
      );
      WarehouseOverviewNavigationRequest? request;
      await _pumpSized(
        tester,
        InventoryOverviewPage(
          api: api,
          role: UserRole.warehouse,
          onNavigate: (value) => request = value,
        ),
      );

      final shortage = find.byKey(
        const ValueKey('warehouse-overview-attention-shortage'),
      );
      await tester.ensureVisible(shortage);
      await tester.tap(shortage);
      expect(request?.moduleId, 'stock');
      expect(request?.filter, 'shortage');
    });

    testWidgets('switches from all warehouses to one real warehouse',
        (tester) async {
      final client = _OverviewSettingsApiClient();
      final api = InventoryApi(
        apiClient: client,
        token: 'token',
        role: UserRole.warehouse,
      );
      await _pumpSized(
        tester,
        InventoryOverviewPage(
          api: api,
          role: UserRole.warehouse,
          onNavigate: (_) {},
        ),
      );

      await tester.tap(
        find.byKey(const ValueKey('warehouse-overview-selector')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('W002 · 二号仓').last);
      await tester.pumpAndSettle();
      expect(find.textContaining('当前展示：二号仓'), findsOneWidget);
      expect(
        client.requestedPaths.any(
          (path) =>
              path.startsWith('/api/inventory/stocks') &&
              path.contains('warehouseId=wh-second'),
        ),
        isTrue,
      );
    });

    testWidgets('renders exact zero counts as empty metrics', (tester) async {
      final api = InventoryApi(
        apiClient: _OverviewSettingsApiClient(emptyMetrics: true),
        token: 'token',
        role: UserRole.warehouse,
      );
      await _pumpSized(
        tester,
        InventoryOverviewPage(
          api: api,
          role: UserRole.warehouse,
          onNavigate: (_) {},
        ),
      );

      expect(find.text('商品库存项'), findsOneWidget);
      expect(find.text('短缺商品数'), findsOneWidget);
      expect(find.text('0'), findsWidgets);
      expect(find.text('暂未提供'), findsWidgets);
    });

    testWidgets('quick actions follow role permissions', (tester) async {
      final client = _OverviewSettingsApiClient();
      final warehouseApi = InventoryApi(
        apiClient: client,
        token: 'token',
        role: UserRole.warehouse,
      );
      await _pumpSized(
        tester,
        InventoryOverviewPage(
          api: warehouseApi,
          role: UserRole.warehouse,
          onNavigate: (_) {},
        ),
      );
      expect(
        find.byKey(const ValueKey('warehouse-overview-create-inbound')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('warehouse-overview-open-fulfillment')),
        findsOneWidget,
      );

      final financeApi = InventoryApi(
        apiClient: _OverviewSettingsApiClient(),
        token: 'token',
        role: UserRole.finance,
      );
      await _pumpSized(
        tester,
        InventoryOverviewPage(
          api: financeApi,
          role: UserRole.finance,
          onNavigate: (_) {},
        ),
      );
      expect(
        find.byKey(const ValueKey('warehouse-overview-create-inbound')),
        findsNothing,
      );
      expect(find.text('当前角色没有库存数量写操作权限。'), findsOneWidget);
    });

    testWidgets('management integration applies shortage filter',
        (tester) async {
      final client = _OverviewSettingsApiClient();
      await _pumpSized(
        tester,
        WarehouseManagementPage(
          apiClient: client,
          token: 'token',
          role: UserRole.warehouse,
          onOpenDestination: (_) {},
        ),
      );
      final shortage = find.byKey(
        const ValueKey('warehouse-overview-attention-shortage'),
      );
      await tester.ensureVisible(shortage);
      await tester.tap(shortage);
      await tester.pumpAndSettle();

      final filter = tester.widget<ChoiceChip>(
        find.byKey(
          const ValueKey('warehouse-stock-status-shortage'),
        ),
      );
      expect(filter.selected, isTrue);
    });
  });

  group('warehouse settings', () {
    testWidgets('wide layout sets default only after confirmation',
        (tester) async {
      final client = _OverviewSettingsApiClient();
      final api = InventoryApi(
        apiClient: client,
        token: 'token',
        role: UserRole.admin,
      );
      await _pumpSized(
        tester,
        WarehouseSettingsPage(api: api, role: UserRole.admin),
      );

      expect(
        find.byKey(const ValueKey('warehouse-settings-wide-layout')),
        findsOneWidget,
      );
      await tester.tap(
        find.byKey(const ValueKey('warehouse-settings-default-wh-second')),
      );
      await tester.pumpAndSettle();
      expect(find.text('设置默认仓库'), findsOneWidget);
      expect(client.patchBodies, isEmpty);
      await tester.tap(find.text('设置默认').last);
      await tester.pumpAndSettle();
      expect(client.patchBodies.last['isDefault'], isTrue);
    });

    testWidgets('disable conflict shows complete Chinese reason',
        (tester) async {
      final client = _OverviewSettingsApiClient(disableConflict: true);
      final api = InventoryApi(
        apiClient: client,
        token: 'token',
        role: UserRole.admin,
      );
      await _pumpSized(
        tester,
        WarehouseSettingsPage(api: api, role: UserRole.admin),
      );

      await tester.tap(
        find.byKey(const ValueKey('warehouse-settings-active-wh-second')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('确认停用'));
      await tester.pumpAndSettle();
      expect(
        find.text('仓库仍有现存库存、占用、在途库存、未完成单据或进行中的盘点，无法停用。'),
        findsOneWidget,
      );
    });

    testWidgets('mobile uses cards and a bottom editor', (tester) async {
      final client = _OverviewSettingsApiClient();
      final api = InventoryApi(
        apiClient: client,
        token: 'token',
        role: UserRole.superAdmin,
      );
      await _pumpSized(
        tester,
        WarehouseSettingsPage(api: api, role: UserRole.superAdmin),
        size: const Size(390, 820),
      );

      expect(
        find.byKey(const ValueKey('warehouse-settings-mobile-layout')),
        findsOneWidget,
      );
      expect(find.byType(DataTable), findsNothing);
      await tester.tap(find.text('编辑').first);
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('warehouse-settings-code')),
        findsOneWidget,
      );
      expect(find.text('编辑仓库'), findsOneWidget);
    });

    testWidgets('non-admin guard performs no warehouse request',
        (tester) async {
      final client = _OverviewSettingsApiClient();
      final api = InventoryApi(
        apiClient: client,
        token: 'token',
        role: UserRole.finance,
      );
      await _pumpSized(
        tester,
        WarehouseSettingsPage(api: api, role: UserRole.finance),
      );
      expect(find.textContaining('仅 admin / super_admin'), findsOneWidget);
      expect(client.requestedPaths, isEmpty);
      await expectLater(
        api.updateWarehouse(warehouseId: 'wh-default', isActive: false),
        throwsA(isA<ApiException>()),
      );
      expect(client.patchBodies, isEmpty);
    });
  });
}
