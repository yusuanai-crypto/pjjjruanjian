import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/product_management/product_management_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
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
  _FakeProductApiClient()
      : _currentProduct = Map<String, dynamic>.from(_product),
        super(baseUrl: 'http://127.0.0.1:3000');

  final getUris = <Uri>[];
  final patchPaths = <String>[];
  final Map<String, dynamic> _currentProduct;
  bool failCostPostWithOverlap = false;
  String? lastPostPath;
  Map<String, dynamic>? lastPostBody;
  Map<String, dynamic>? lastPatchBody;

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
