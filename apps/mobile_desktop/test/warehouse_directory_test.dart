import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/warehouse_directory/warehouse_directory_page.dart';
import 'package:jiangjiu_mobile_desktop/features/warehouse_management/navigation/inventory_navigation_handoff.dart';

class _DirectoryApiClient extends ApiClient {
  _DirectoryApiClient() : super(baseUrl: 'http://127.0.0.1:3000');

  final List<String> requests = [];
  final List<Map<String, dynamic>> postBodies = [];
  final List<Map<String, dynamic>> patchBodies = [];
  int failProductAdds = 0;
  Completer<void>? productDeleteGate;
  final List<Map<String, dynamic>> warehouses = [
    _warehouse('root', 'R001', '主仓', null, childCount: 1),
    _warehouse('child', 'C001', '子仓', 'root'),
  ];

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    requests.add('GET $path');
    if (path == '/api/products/options') {
      return {
        'data': {
          'products': const [
            {
              'id': 'quantity-product',
              'name': '普通测试酒',
              'unit': '瓶',
              'inventoryTrackingMode': 'quantity',
            },
            {
              'id': 'serialized-product',
              'name': '逐瓶测试酒',
              'unit': '瓶',
              'inventoryTrackingMode': 'serialized',
            },
          ],
        },
      };
    }
    if (path.startsWith('/api/inventory/warehouses/root/products')) {
      return {
        'data': {
          'warehouse': _warehouse('root', 'R001', '主仓', null, childCount: 1),
          'products': [
            {
              'id': 'config-1',
              'warehouseId': 'root',
              'productId': 'product-1',
              'product': {
                'id': 'product-1',
                'name': '酱香测试酒',
                'unit': '瓶',
                'inventoryTrackingMode': 'QUANTITY',
                'isActive': true,
              },
              'isActive': true,
              'localStock': _stock(5, 1, 1, 0),
              'inclusiveStock': _stock(8, 1, 1, 0),
              'includesChildWarehouses': true,
              'isLowStock': false,
              'lastMovementAt': '2026-08-01T08:00:00.000Z',
            },
          ],
          'pagination': _page(1),
        },
      };
    }
    if (path.startsWith('/api/inventory/warehouses/child/products')) {
      return {
        'data': {
          'warehouse': _warehouse('child', 'C001', '子仓', 'root'),
          'products': const [],
          'pagination': _page(0),
        },
      };
    }
    if (path.contains('/products')) {
      final id = path.split('/')[4];
      final current = warehouses.firstWhere((item) => item['id'] == id);
      return {
        'data': {
          'warehouse': current,
          'products': const [],
          'pagination': _page(0),
        },
      };
    }
    if (path.startsWith('/api/inventory/warehouses')) {
      return {
        'data': {
          'warehouses': warehouses,
          'pagination': _page(warehouses.length),
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
    requests.add('POST $path');
    postBodies.add(Map<String, dynamic>.from(body ?? const {}));
    if (path == '/api/inventory/warehouses') {
      final created = <String, dynamic>{
        'id': 'warehouse-new-${warehouses.length}',
        'address': null,
        'manager': null,
        'childWarehouseCount': 0,
        'isDefault': false,
        'canDelete': true,
        'createdAt': '2026-08-01T00:00:00.000Z',
        'updatedAt': '2026-08-01T00:00:00.000Z',
        ...?body,
      };
      warehouses.add(created);
      return {'data': created};
    }
    if (path.endsWith('/products')) {
      if (failProductAdds > 0) {
        failProductAdds--;
        throw const ApiException(
          statusCode: 409,
          code: 'INVENTORY_TEST_FAILURE',
          message: '模拟添加失败，请重试。',
        );
      }
      final warehouseId = path.split('/')[4];
      final productId = '${body?['productId'] ?? ''}';
      final serialized = productId == 'serialized-product';
      return {
        'data': {
          'product': {
            'id': 'configuration-$productId',
            'warehouseId': warehouseId,
            'productId': productId,
            'product': {
              'id': productId,
              'name': serialized ? '逐瓶测试酒' : '普通测试酒',
              'unit': '瓶',
              'inventoryTrackingMode': serialized ? 'SERIALIZED' : 'QUANTITY',
              'isActive': true,
            },
            'isActive': true,
          },
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
    requests.add('PATCH $path');
    patchBodies.add(Map<String, dynamic>.from(body ?? const {}));
    final id = path.split('/').last;
    final warehouse = warehouses.firstWhere((item) => item['id'] == id);
    warehouse.addAll(body ?? const {});
    if (body?['isDefault'] == true) {
      for (final item in warehouses) {
        item['isDefault'] = item['id'] == id;
      }
    }
    return {'data': warehouse};
  }

  @override
  Future<Map<String, dynamic>> deleteJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    requests.add('DELETE $path');
    if (path.contains('/products/')) {
      await productDeleteGate?.future;
      return {
        'data': const {'deactivated': true}
      };
    }
    final id = path.split('/').last;
    warehouses.removeWhere((item) => item['id'] == id);
    return {
      'data': const {'deleted': true}
    };
  }
}

Map<String, dynamic> _warehouse(
  String id,
  String code,
  String name,
  String? parentId, {
  int childCount = 0,
}) =>
    {
      'id': id,
      'code': code,
      'name': name,
      'address': null,
      'managerUserId': 'manager-1',
      'manager': {'id': 'manager-1', 'name': '张库管'},
      'parentWarehouseId': parentId,
      'parentWarehouse': parentId == null
          ? null
          : {'id': 'root', 'code': 'R001', 'name': '主仓'},
      'childWarehouseCount': childCount,
      'isActive': true,
      'isDefault': false,
      'canDelete': false,
      'createdAt': '2026-08-01T00:00:00.000Z',
      'updatedAt': '2026-08-01T00:00:00.000Z',
    };

Map<String, dynamic> _stock(
  int onHand,
  int reserved,
  int unavailable,
  int inTransit,
) =>
    {
      'onHandQty': onHand,
      'reservedQty': reserved,
      'unavailableQty': unavailable,
      'inTransitQty': inTransit,
      'availableQty': onHand - reserved - unavailable,
      'shortageQty': 0,
    };

Map<String, dynamic> _page(int total) => {
      'page': 1,
      'pageSize': 100,
      'total': total,
      'totalPages': total == 0 ? 0 : 1,
    };

Future<void> _pump(
  WidgetTester tester,
  _DirectoryApiClient client, {
  UserRole role = UserRole.admin,
  Size size = const Size(1300, 900),
  ValueChanged<String>? onOpen,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(MaterialApp(
    home: Scaffold(
      body: WarehouseDirectoryPage(
        apiClient: client,
        token: 'token',
        role: role,
        onOpenDestination: onOpen ?? (_) {},
      ),
    ),
  ));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
      'desktop renders a two-level tree and separates local/inclusive stock',
      (tester) async {
    final client = _DirectoryApiClient();
    await _pump(tester, client);

    expect(find.byKey(const ValueKey('warehouse-directory-wide-layout')),
        findsOneWidget);
    expect(find.text('主仓'), findsWidgets);
    expect(find.text('子仓'), findsWidgets);
    expect(find.text('本仓现存'), findsOneWidget);
    expect(find.text('含子仓汇总'), findsOneWidget);
    expect(find.text('5 瓶'), findsOneWidget);
    expect(find.textContaining('8 / 可售 6 瓶'), findsOneWidget);
    expect(find.byKey(const ValueKey('warehouse-directory-create-root')),
        findsOneWidget);
    expect(find.byKey(const ValueKey('warehouse-directory-create-child')),
        findsOneWidget);
  });

  testWidgets('mobile starts with cards and opens warehouse detail on tap',
      (tester) async {
    final client = _DirectoryApiClient();
    await _pump(tester, client, size: const Size(600, 900));

    expect(find.byKey(const ValueKey('warehouse-directory-mobile-list')),
        findsOneWidget);
    await tester
        .tap(find.byKey(const ValueKey('warehouse-directory-warehouse-root')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('warehouse-directory-mobile-detail')),
        findsOneWidget);
    expect(find.byKey(const ValueKey('warehouse-directory-product-product-1')),
        findsOneWidget);
    expect(find.byKey(const ValueKey('warehouse-directory-product-table')),
        findsNothing);
  });

  testWidgets(
      'stocktake action hands off warehouse and product to existing flow',
      (tester) async {
    final client = _DirectoryApiClient();
    String? destination;
    await _pump(
      tester,
      client,
      size: const Size(600, 900),
      onOpen: (value) => destination = value,
    );

    await tester
        .tap(find.byKey(const ValueKey('warehouse-directory-warehouse-root')));
    await tester.pumpAndSettle();

    await tester.tap(
        find.byKey(const ValueKey('warehouse-directory-stocktake-product-1')));
    await tester.pump();
    expect(destination, 'warehouse_management');
    final request = InventoryNavigationHandoff.take();
    expect(request?.moduleId, 'stocktake');
    expect(request?.warehouseId, 'root');
    expect(request?.productId, 'product-1');
    expect(request?.action, 'create');
  });

  testWidgets('sales sees denial and creates no inventory request',
      (tester) async {
    final client = _DirectoryApiClient();
    await _pump(tester, client, role: UserRole.sales);
    expect(find.byKey(const ValueKey('warehouse-directory-access-denied')),
        findsOneWidget);
    expect(client.requests, isEmpty);
  });

  testWidgets('admin creates a child and edits it with the selected parent',
      (tester) async {
    final client = _DirectoryApiClient();
    await _pump(tester, client);

    await tester
        .tap(find.byKey(const ValueKey('warehouse-directory-create-child')));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.byKey(const ValueKey('warehouse-editor-code')), 'C002');
    await tester.enterText(
        find.byKey(const ValueKey('warehouse-editor-name')), '新子仓');
    await tester.tap(find.byKey(const ValueKey('warehouse-editor-submit')));
    await tester.pumpAndSettle();
    expect(client.postBodies.last['parentWarehouseId'], 'root');
    expect(client.postBodies.last['isDefault'], false);

    await tester.tap(find.text('编辑'));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.byKey(const ValueKey('warehouse-editor-name')), '新子仓（已编辑）');
    await tester.tap(find.byKey(const ValueKey('warehouse-editor-submit')));
    await tester.pumpAndSettle();
    expect(client.patchBodies.last['name'], '新子仓（已编辑）');
    expect(client.patchBodies.last['parentWarehouseId'], 'root');
  });

  testWidgets('default is parent-only and finance has no write actions',
      (tester) async {
    final client = _DirectoryApiClient();
    await _pump(tester, client);
    expect(find.text('设为默认'), findsOneWidget);
    await tester
        .tap(find.byKey(const ValueKey('warehouse-directory-warehouse-child')));
    await tester.pumpAndSettle();
    expect(find.text('设为默认'), findsNothing);

    final financeClient = _DirectoryApiClient();
    await _pump(tester, financeClient, role: UserRole.finance);
    expect(find.byKey(const ValueKey('warehouse-directory-create-root')),
        findsNothing);
    expect(
        find.byKey(const ValueKey('warehouse-directory-stocktake-product-1')),
        findsNothing);
    expect(find.byKey(const ValueKey('warehouse-directory-movement-product-1')),
        findsOneWidget);
  });

  testWidgets('quantity add preserves input and idempotency after failure',
      (tester) async {
    final client = _DirectoryApiClient()..failProductAdds = 1;
    await _pump(tester, client);

    await tester.tap(find.text('添加商品'));
    await tester.pumpAndSettle();
    await tester
        .tap(find.byKey(const ValueKey('warehouse-product-editor-product')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('普通测试酒 · 瓶').last);
    await tester.pumpAndSettle();
    await tester.enterText(
        find.byKey(const ValueKey('warehouse-product-editor-quantity')), '7');
    await tester
        .tap(find.byKey(const ValueKey('warehouse-product-editor-submit')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('确认添加').last);
    await tester.pumpAndSettle();

    expect(find.textContaining('数据已被其他人更新'), findsOneWidget);
    final quantityField = tester.widget<TextField>(
        find.byKey(const ValueKey('warehouse-product-editor-quantity')));
    expect(quantityField.controller?.text, '7');

    await tester
        .tap(find.byKey(const ValueKey('warehouse-product-editor-submit')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('确认添加').last);
    await tester.pumpAndSettle();
    final productPosts = client.postBodies
        .where((body) => body['productId'] == 'quantity-product')
        .toList();
    expect(productPosts, hasLength(2));
    expect(productPosts[0]['initialQuantity'], 7);
    expect(
        productPosts[0]['idempotencyKey'], productPosts[1]['idempotencyKey']);
    expect('${productPosts[0]['requestHash']}',
        matches(RegExp(r'^[0-9a-f]{64}$')));
  });

  testWidgets('serialized add stays zero and opens the existing bottle page',
      (tester) async {
    final client = _DirectoryApiClient();
    String? destination;
    await _pump(tester, client, onOpen: (value) => destination = value);
    await tester.tap(find.text('添加商品'));
    await tester.pumpAndSettle();
    await tester
        .tap(find.byKey(const ValueKey('warehouse-product-editor-product')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('逐瓶测试酒 · 瓶').last);
    await tester.pumpAndSettle();
    await tester
        .tap(find.byKey(const ValueKey('warehouse-product-editor-submit')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('确认添加').last);
    await tester.pumpAndSettle();
    final body = client.postBodies
        .lastWhere((item) => item['productId'] == 'serialized-product');
    expect(body['initialQuantity'], 0);
    expect(destination, 'moutai_inventory');
  });

  testWidgets('product removal locks repeated submission until completion',
      (tester) async {
    final client = _DirectoryApiClient();
    final gate = Completer<void>();
    client.productDeleteGate = gate;
    await _pump(tester, client, size: const Size(600, 900));
    await tester
        .tap(find.byKey(const ValueKey('warehouse-directory-warehouse-root')));
    await tester.pumpAndSettle();
    final removeFinder =
        find.byKey(const ValueKey('warehouse-directory-remove-product-1'));
    await tester.ensureVisible(removeFinder);
    await tester.tap(removeFinder);
    await tester.pumpAndSettle();
    await tester.tap(find.text('确认移除').last);
    await tester.pump();
    expect(tester.widget<TextButton>(removeFinder).onPressed, isNull);
    expect(client.requests.where((item) => item.startsWith('DELETE ')),
        hasLength(1));
    gate.complete();
    await tester.pumpAndSettle();
    expect(client.requests.where((item) => item.startsWith('DELETE ')),
        hasLength(1));
  });
}
