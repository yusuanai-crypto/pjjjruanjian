import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/product_management/product_management_page.dart';
import 'package:jiangjiu_mobile_desktop/core/business/product_inventory_mode_command.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  test('product inventory activation hash matches the backend contract', () {
    expect(
      calculateProductInventoryTrackingActivationHash(
        productId: 'product-1',
        body: const {
          'expectedCurrentMode': 'NONE',
          'targetMode': 'QUANTITY',
          'effectiveAt': '2026-08-03T01:02:03.000Z',
          'sourceKey': 'source:key',
          'idempotencyKey': 'idem:source:key',
        },
      ),
      '0ce33e1cfd539334db90bc0d13d969071378569a83a5d6f47bb534d9edaa54a8',
    );
    expect(
      calculateProductInventoryTrackingActivationHash(
        productId: 'product-1',
        body: const {
          'expectedCurrentMode': 'NONE',
          'targetMode': 'SERIALIZED',
          'effectiveAt': '2026-08-03T01:02:03.000Z',
          'sourceKey': 'source:key',
          'idempotencyKey': 'idem:source:key',
        },
      ),
      'a7fd64e483b53a1e856495cd3913b65e247e830b837bf42a699295fc4310e98e',
    );
  });

  test('product inventory activation builder accepts only supported targets', () {
    expect(
      () => buildProductInventoryTrackingActivationRequest(
        productId: 'product-1',
        targetMode: 'NONE',
        effectiveAt: DateTime.utc(2026, 8, 3),
        sourceKey: 'source:key',
        idempotencyKey: 'idem:source:key',
      ),
      throwsArgumentError,
    );
  });

  testWidgets('admin sees product costs and all three management sections',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final client = _FakeProductApiClient();
    await tester.pumpWidget(_page(client, UserRole.admin));
    await tester.pumpAndSettle();

    expect(find.text('商品列表'), findsOneWidget);
    expect(find.text('基础信息'), findsOneWidget);
    expect(find.text('实际成本历史'), findsOneWidget);
    expect(find.text('扣减成本规则'), findsOneWidget);
    expect(find.text('测试酱酒'), findsWidgets);
    expect(find.text(formatMoneyCents(12345)), findsWidgets);

    final salesUri = client.getUris.singleWhere(
      (uri) => uri.path == '/api/sales-deduction-rules',
    );
    final agencyUri = client.getUris.singleWhere(
      (uri) => uri.path == '/api/agency-deduction-rules',
    );
    expect(salesUri.queryParameters['productId'], 'product-1');
    expect(agencyUri.queryParameters['productId'], 'product-1');
  });

  testWidgets('finance submits yuan as exact integer cents', (tester) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final client = _FakeProductApiClient();
    await tester.pumpWidget(_page(client, UserRole.finance));
    await tester.pumpAndSettle();

    await tester.tap(
      find.byKey(const ValueKey('product-actual-cost-add-button')),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('product-actual-cost-yuan-field')),
      '123.45',
    );
    await tester.enterText(
      find.byKey(const ValueKey('product-actual-cost-from-field')),
      '2027-01-01',
    );
    await tester.tap(
      find.byKey(const ValueKey('product-actual-cost-save-button')),
    );
    await tester.pumpAndSettle();

    expect(client.lastPostPath, '/api/products/product-1/actual-costs');
    expect(client.lastPostBody?['costCents'], 12345);
    expect(client.lastPostBody?['costCents'], isA<int>());
    expect(client.lastPostBody?['effectiveFrom'], '2027-01-01');
  });

  testWidgets('actual-cost overlap receives a clear business prompt',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final client = _FakeProductApiClient()..failCostPostWithOverlap = true;
    await tester.pumpWidget(_page(client, UserRole.admin));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('product-actual-cost-add-button')),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('product-actual-cost-yuan-field')),
      '100',
    );
    await tester.enterText(
      find.byKey(const ValueKey('product-actual-cost-from-field')),
      '2026-01-01',
    );
    await tester.tap(
      find.byKey(const ValueKey('product-actual-cost-save-button')),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('生效区间不能重叠'), findsOneWidget);
  });

  testWidgets('admin edits and disables a product through controlled actions',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final client = _FakeProductApiClient();
    await tester.pumpWidget(_page(client, UserRole.admin));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('product-edit-button')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('product-name-field')),
      '测试酱酒典藏',
    );
    await tester.enterText(
      find.byKey(const ValueKey('product-unit-field')),
      '盒',
    );
    await tester.tap(find.byKey(const ValueKey('product-save-button')));
    await tester.pumpAndSettle();

    expect(client.patchPaths, contains('/api/products/product-1'));
    expect(client.lastPatchBody?['name'], '测试酱酒典藏');
    expect(client.lastPatchBody?['unit'], '盒');
    expect(find.text('测试酱酒典藏'), findsWidgets);

    await tester.tap(find.byKey(const ValueKey('product-status-button')));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('product-status-confirm-button')),
    );
    await tester.pumpAndSettle();

    expect(client.patchPaths, contains('/api/products/product-1/status'));
    expect(client.lastPatchBody?['isActive'], isFalse);
    expect(find.text('已停用'), findsOneWidget);
  });

  testWidgets('actual cost rejects an incomplete decimal amount',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final client = _FakeProductApiClient();
    await tester.pumpWidget(_page(client, UserRole.finance));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('product-actual-cost-add-button')),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('product-actual-cost-yuan-field')),
      '12.',
    );
    await tester.tap(
      find.byKey(const ValueKey('product-actual-cost-save-button')),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('最多两位小数'), findsWidgets);
    expect(client.lastPostPath, isNull);
  });

  testWidgets('non finance roles are blocked before any cost request',
      (tester) async {
    final client = _FakeProductApiClient();
    await tester.pumpWidget(_page(client, UserRole.boss));
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('product-management-access-denied')),
      findsOneWidget,
    );
    expect(find.textContaining('不可访问商品管理'), findsOneWidget);
    expect(client.getUris, isEmpty);
    expect(find.text('实际成本历史'), findsNothing);
  });

  testWidgets(
      'admin confirms dedicated quantity activation once and refreshes mode and options',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final client = _FakeProductApiClient();
    await tester.pumpWidget(_page(client, UserRole.admin));
    await tester.pumpAndSettle();

    expect(find.text('库存模式：未启用库存'), findsOneWidget);
    final activate = find.byKey(
      const ValueKey('product-activate-quantity-inventory-button'),
    );
    expect(activate, findsOneWidget);
    await tester.tap(activate);
    await tester.pumpAndSettle();

    expect(find.textContaining('入库、出库、调拨、盘点和库存占用'), findsOneWidget);
    expect(find.textContaining('不能在线切换'), findsOneWidget);
    expect(find.textContaining('记录审计信息'), findsOneWidget);
    expect(find.text('逐瓶库存'), findsNothing);

    final confirm = find.byKey(
      const ValueKey('product-activate-quantity-inventory-confirm'),
    );
    await tester.tap(confirm);
    await tester.pumpAndSettle();

    expect(client.activationBodies, hasLength(1));
    final body = client.activationBodies.single;
    expect(body['expectedCurrentMode'], 'NONE');
    expect(body['targetMode'], 'QUANTITY');
    expect(body['sourceKey'], isNotEmpty);
    expect(body['idempotencyKey'], startsWith('idem:'));
    expect(
      body['requestHash'],
      calculateProductInventoryTrackingActivationHash(
        productId: 'product-1',
        body: body,
      ),
    );
    expect(
      client.getUris.where((uri) => uri.path == '/api/products/options'),
      isNotEmpty,
    );
    expect(find.text('库存模式：普通数量库存'), findsOneWidget);
    expect(activate, findsNothing);
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
  });

  testWidgets(
      'super_admin must choose quantity mode and sends target-aware keys and hash',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final client = _FakeProductApiClient();
    await tester.pumpWidget(_page(client, UserRole.superAdmin));
    await tester.pumpAndSettle();

    final activate = find.byKey(
      const ValueKey('product-inventory-mode-activation-button'),
    );
    expect(activate, findsOneWidget);
    expect(find.text('设置库存模式'), findsOneWidget);
    await tester.tap(activate);
    await tester.pumpAndSettle();

    expect(find.text('普通数量库存'), findsOneWidget);
    expect(find.text('逐瓶库存'), findsOneWidget);
    expect(find.textContaining('真实物流码逐瓶入库和追踪'), findsOneWidget);
    expect(
      find.text('库存模式启用后不能在线切换，请确认商品库存管理方式无误。'),
      findsOneWidget,
    );
    final confirm = find.byKey(
      const ValueKey('product-inventory-mode-activation-confirm'),
    );
    expect(tester.widget<FilledButton>(confirm).onPressed, isNull);

    await tester.tap(find.byKey(
      const ValueKey('product-inventory-mode-quantity-option'),
    ));
    await tester.pump();
    expect(tester.widget<FilledButton>(confirm).onPressed, isNotNull);
    await tester.tap(confirm);
    await tester.pumpAndSettle();

    expect(client.activationBodies, hasLength(1));
    final body = client.activationBodies.single;
    expect(body['targetMode'], 'QUANTITY');
    expect(body['sourceKey'], contains('product-1:quantity:'));
    expect(body['idempotencyKey'], startsWith('idem:'));
    expect(
      body['requestHash'],
      calculateProductInventoryTrackingActivationHash(
        productId: 'product-1',
        body: body,
      ),
    );
    expect(find.text('库存模式：普通数量库存'), findsOneWidget);
    expect(activate, findsNothing);
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
  });

  testWidgets(
      'super_admin serialized activation refreshes detail and product options',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final client = _FakeProductApiClient();
    await tester.pumpWidget(_page(client, UserRole.superAdmin));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(
      const ValueKey('product-inventory-mode-activation-button'),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(
      const ValueKey('product-inventory-mode-serialized-option'),
    ));
    await tester.pump();
    await tester.tap(find.byKey(
      const ValueKey('product-inventory-mode-activation-confirm'),
    ));
    await tester.pumpAndSettle();

    final body = client.activationBodies.single;
    expect(body['targetMode'], 'SERIALIZED');
    expect(body['sourceKey'], contains('product-1:serialized:'));
    expect(
      body['requestHash'],
      calculateProductInventoryTrackingActivationHash(
        productId: 'product-1',
        body: body,
      ),
    );
    expect(
      client.getUris.where((uri) => uri.path == '/api/products/options'),
      isNotEmpty,
    );
    expect(find.text('库存模式：逐瓶库存'), findsOneWidget);
    expect(
      find.byKey(
        const ValueKey('product-inventory-mode-activation-button'),
      ),
      findsNothing,
    );
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
  });

  testWidgets('activation in flight disables mode, cancel, and duplicate submit',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final pending = Completer<void>();
    final client = _FakeProductApiClient()..pendingActivation = pending;
    await tester.pumpWidget(_page(client, UserRole.superAdmin));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(
      const ValueKey('product-inventory-mode-activation-button'),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(
      const ValueKey('product-inventory-mode-serialized-option'),
    ));
    await tester.pump();
    final confirm = find.byKey(
      const ValueKey('product-inventory-mode-activation-confirm'),
    );
    await tester.tap(confirm);
    await tester.pump();
    await tester.tap(confirm, warnIfMissed: false);
    await tester.pump();

    expect(client.activationBodies, hasLength(1));
    expect(tester.widget<FilledButton>(confirm).onPressed, isNull);
    expect(
      tester
          .widget<RadioListTile<String>>(find.byKey(const ValueKey(
            'product-inventory-mode-serialized-option',
          )))
          .enabled,
      isFalse,
    );
    expect(
      tester.widget<TextButton>(find.widgetWithText(TextButton, '取消')).onPressed,
      isNull,
    );

    pending.complete();
    await tester.pumpAndSettle();
    expect(find.text('库存模式：逐瓶库存'), findsOneWidget);
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
  });

  testWidgets('activation failure stays visible and retries the same command',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final client = _FakeProductApiClient()..failActivation = true;
    await tester.pumpWidget(_page(client, UserRole.admin));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(
      const ValueKey('product-activate-quantity-inventory-button'),
    ));
    await tester.pumpAndSettle();
    final confirm = find.byKey(
      const ValueKey('product-activate-quantity-inventory-confirm'),
    );
    await tester.tap(confirm);
    await tester.pumpAndSettle();

    expect(
      find.byKey(
        const ValueKey('product-activate-quantity-inventory-error'),
      ),
      findsOneWidget,
    );
    expect(find.byType(AlertDialog), findsOneWidget);
    final firstBody = Map<String, dynamic>.from(client.activationBodies.single);

    await tester.tap(confirm);
    await tester.pumpAndSettle();
    expect(client.activationBodies, hasLength(2));
    expect(client.activationBodies.last, firstBody);
  });

  testWidgets('finance can manage products but cannot activate inventory mode',
      (tester) async {
    final client = _FakeProductApiClient();
    await tester.pumpWidget(_page(client, UserRole.finance));
    await tester.pumpAndSettle();

    expect(find.text('商品列表'), findsOneWidget);
    expect(
      find.byKey(
        const ValueKey('product-activate-quantity-inventory-button'),
      ),
      findsNothing,
    );
  });

  testWidgets('already configured products never show an activation button',
      (tester) async {
    for (final mode in ['quantity', 'serialized']) {
      final client = _FakeProductApiClient(initialMode: mode);
      await tester.pumpWidget(_page(client, UserRole.superAdmin));
      await tester.pumpAndSettle();
      expect(
        find.byKey(
          const ValueKey('product-inventory-mode-activation-button'),
        ),
        findsNothing,
      );
    }
  });
}

Widget _page(ApiClient client, UserRole role) {
  return MaterialApp(
    theme: ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF7A1631)),
    ),
    home: Scaffold(
      body: ProductManagementPage(
        apiClient: client,
        token: 'test-token',
        role: role,
        onOpenDestination: (_) {},
      ),
    ),
  );
}

class _FakeProductApiClient extends ApiClient {
  _FakeProductApiClient({String initialMode = 'none'})
      : _currentProduct = {
          ..._product,
          'inventoryTrackingMode': initialMode,
        },
        super(baseUrl: 'http://127.0.0.1:3000');

  final getUris = <Uri>[];
  final patchPaths = <String>[];
  final Map<String, dynamic> _currentProduct;
  bool failCostPostWithOverlap = false;
  bool failActivation = false;
  Completer<void>? pendingActivation;
  String? lastPostPath;
  Map<String, dynamic>? lastPostBody;
  Map<String, dynamic>? lastPatchBody;
  final List<Map<String, dynamic>> activationBodies = [];

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    final uri = Uri.parse(path);
    getUris.add(uri);
    if (uri.path == '/api/products') {
      return {
        'data': {
          'products': [_currentProduct],
          'pagination': {
            'page': 1,
            'pageSize': 100,
            'total': 1,
            'totalPages': 1,
          },
        },
      };
    }
    if (uri.path == '/api/products/options') {
      return {
        'data': {
          'products': [
            {
              'id': _currentProduct['id'],
              'name': _currentProduct['name'],
              'unit': _currentProduct['unit'],
              'inventoryTrackingMode':
                  _currentProduct['inventoryTrackingMode'] ?? 'none',
            },
          ],
        },
      };
    }
    if (uri.path == '/api/products/product-1/actual-costs') {
      return {
        'data': {
          'actualCosts': [_actualCost],
        },
      };
    }
    if (uri.path == '/api/sales-deduction-rules') {
      return {
        'data': {
          'salesDeductionRules': [_salesDeduction],
        },
      };
    }
    if (uri.path == '/api/agency-deduction-rules') {
      return {
        'data': {
          'agencyDeductionRules': [_agencyDeduction],
        },
      };
    }
    return {'data': <String, dynamic>{}};
  }

  @override
  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    lastPostPath = Uri.parse(path).path;
    lastPostBody = Map<String, dynamic>.from(body ?? const {});
    if (lastPostPath == '/api/products/product-1/inventory-tracking/activate') {
      activationBodies.add(Map<String, dynamic>.from(lastPostBody!));
      if (pendingActivation != null) await pendingActivation!.future;
      if (failActivation) {
        throw const ApiException(
          statusCode: 409,
          code: 'PRODUCT_INVENTORY_MODE_EXPECTATION_MISMATCH',
          message: 'stale mode',
        );
      }
      final targetMode = '${body?['targetMode'] ?? 'QUANTITY'}'.toLowerCase();
      _currentProduct['inventoryTrackingMode'] = targetMode;
      return {
        'data': {
          'product': _currentProduct,
          'inventoryModeChange': {
            'id': 'mode-change-1',
            'productId': 'product-1',
            'expectedCurrentMode': 'none',
            'targetMode': targetMode,
            'effectiveAt': body?['effectiveAt'],
            'sourceKey': body?['sourceKey'],
            'idempotencyKey': body?['idempotencyKey'],
            'requestHash': body?['requestHash'],
            'status': 'applied',
            'appliedAt': body?['effectiveAt'],
          },
        },
      };
    }
    if (failCostPostWithOverlap) {
      throw const ApiException(
        statusCode: 409,
        code: 'PRODUCT_ACTUAL_COST_RANGE_OVERLAP',
        message: 'overlap',
      );
    }
    return {
      'data': {
        'actualCost': {
          ..._actualCost,
          ...?body,
          'id': 'actual-cost-new',
        },
      },
    };
  }

  @override
  Future<Map<String, dynamic>> patchJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    final target = Uri.parse(path).path;
    patchPaths.add(target);
    lastPatchBody = Map<String, dynamic>.from(body ?? const {});
    if (target == '/api/products/product-1') {
      _currentProduct.addAll(lastPatchBody!);
      return {
        'data': {'product': _currentProduct},
      };
    }
    if (target == '/api/products/product-1/status') {
      _currentProduct['isActive'] = body?['isActive'];
      return {
        'data': {'product': _currentProduct},
      };
    }
    throw StateError('Unexpected PATCH $path');
  }
}

const _product = {
  'id': 'product-1',
  'name': '测试酱酒',
  'unit': '瓶',
  'inventoryTrackingMode': 'none',
  'isActive': true,
  'notes': '测试备注',
  'createdAt': '2026-07-01T08:00:00.000Z',
  'updatedAt': '2026-07-11T08:30:00.000Z',
};

const _actualCost = {
  'id': 'actual-cost-1',
  'productId': 'product-1',
  'costCents': 12345,
  'effectiveFrom': '2020-01-01',
  'effectiveTo': null,
  'isActive': true,
  'notes': '初始成本',
  'createdAt': '2026-07-01T08:00:00.000Z',
  'updatedAt': '2026-07-01T08:00:00.000Z',
};

const _salesDeduction = {
  'id': 'sales-deduction-1',
  'productId': 'product-1',
  'productName': '测试酱酒',
  'deductionCostCents': 1200,
  'effectiveFrom': '2026-01-01',
  'effectiveTo': null,
  'isActive': true,
};

const _agencyDeduction = {
  'id': 'agency-deduction-1',
  'agencyId': 'agency-1',
  'agencyName': '测试旅行社',
  'productId': 'product-1',
  'productName': '测试酱酒',
  'deductionCostCents': 800,
  'effectiveFrom': '2026-01-01',
  'effectiveTo': null,
  'isActive': true,
};
