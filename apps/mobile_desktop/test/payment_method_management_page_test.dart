import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/payment_methods/payment_method_management_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets('only finance and administrators can open the page',
      (tester) async {
    for (final role in [
      UserRole.sales,
      UserRole.boss,
      UserRole.frontDesk,
      UserRole.warehouse,
      UserRole.afterSales,
      UserRole.taster,
    ]) {
      final client = _FakePaymentMethodApiClient();
      await tester.pumpWidget(_page(client, role));
      await tester.pumpAndSettle();
      expect(
        find.byKey(
          const ValueKey('payment-method-management-access-denied'),
        ),
        findsOneWidget,
        reason: role.value,
      );
      expect(client.getCount, 0, reason: role.value);
    }

    for (final role in [
      UserRole.superAdmin,
      UserRole.admin,
      UserRole.finance,
    ]) {
      final client = _FakePaymentMethodApiClient();
      await tester.pumpWidget(_page(client, role));
      await tester.pumpAndSettle();
      expect(find.text('收款方式管理'), findsOneWidget, reason: role.value);
      expect(client.getCount, 1, reason: role.value);
    }
  });

  testWidgets('shows default, categories, status and no delete action',
      (tester) async {
    _useLargeViewport(tester);
    final client = _FakePaymentMethodApiClient();
    await tester.pumpWidget(_page(client, UserRole.finance));
    await tester.pumpAndSettle();

    expect(find.text('当前默认'), findsOneWidget);
    expect(find.textContaining('即时收款'), findsWidgets);
    expect(find.textContaining('代收营业款'), findsOneWidget);
    expect(find.text('已停用'), findsOneWidget);
    expect(find.text('手续费率 0.6%'), findsOneWidget);
    expect(find.text('手续费率 0%'), findsOneWidget);
    expect(find.text('手续费率未设置'), findsOneWidget);
    expect(
      find.textContaining('费率变更只影响之后重新标记的订单'),
      findsOneWidget,
    );
    expect(find.text('删除'), findsNothing);
    expect(find.byIcon(Icons.delete_outline_rounded), findsNothing);
  });

  testWidgets('adds and edits canonical payment method categories',
      (tester) async {
    _useLargeViewport(tester);
    final client = _FakePaymentMethodApiClient();
    await tester.pumpWidget(_page(client, UserRole.admin));
    await tester.pumpAndSettle();

    await tester.tap(
      find.byKey(const ValueKey('payment-method-add-button')),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('payment-method-name-field')),
      '旅行社代收',
    );
    await _selectCategory(tester, '代收营业款');
    await tester.enterText(
      find.byKey(
        const ValueKey('payment-method-service-fee-rate-field'),
      ),
      '0.6',
    );
    await tester.tap(
      find.byKey(const ValueKey('payment-method-save-button')),
    );
    await tester.pumpAndSettle();

    expect(client.lastPostPath, '/api/payment-methods');
    expect(client.lastPostBody, {
      'name': '旅行社代收',
      'category': 'collect_on_delivery',
      'serviceFeeRate': '0.006000',
    });
    expect(find.text('旅行社代收'), findsOneWidget);
    expect(client.getCount, 2);

    await tester.tap(
      find.byKey(const ValueKey('payment-method-edit-cash')),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('payment-method-name-field')),
      '现金收款',
    );
    await _selectCategory(tester, '代收营业款');
    await tester.enterText(
      find.byKey(
        const ValueKey('payment-method-service-fee-rate-field'),
      ),
      '12.3456',
    );
    await tester.tap(
      find.byKey(const ValueKey('payment-method-save-button')),
    );
    await tester.pumpAndSettle();

    expect(client.lastPatchPath, '/api/payment-methods/cash');
    expect(client.lastPatchBody, {
      'name': '现金收款',
      'category': 'collect_on_delivery',
      'serviceFeeRate': '0.123456',
    });
    expect(find.text('现金收款'), findsOneWidget);
    expect(client.getCount, 3);
  });

  testWidgets(
      'validates percentage range and precision while distinguishing null from zero',
      (tester) async {
    _useLargeViewport(tester);
    final client = _FakePaymentMethodApiClient();
    await tester.pumpWidget(_page(client, UserRole.admin));
    await tester.pumpAndSettle();

    await tester.tap(
      find.byKey(const ValueKey('payment-method-add-button')),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('payment-method-name-field')),
      '未配置费率',
    );
    await tester.tap(
      find.byKey(const ValueKey('payment-method-save-button')),
    );
    await tester.pumpAndSettle();
    expect(client.lastPostBody?['serviceFeeRate'], isNull);

    await tester.tap(
      find.byKey(const ValueKey('payment-method-add-button')),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('payment-method-name-field')),
      '零费率',
    );
    await tester.enterText(
      find.byKey(
        const ValueKey('payment-method-service-fee-rate-field'),
      ),
      '0',
    );
    await tester.tap(
      find.byKey(const ValueKey('payment-method-save-button')),
    );
    await tester.pumpAndSettle();
    expect(client.lastPostBody?['serviceFeeRate'], '0.000000');

    await tester.tap(
      find.byKey(const ValueKey('payment-method-add-button')),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('payment-method-name-field')),
      '非法费率',
    );
    final rateField = find.byKey(
      const ValueKey('payment-method-service-fee-rate-field'),
    );
    await tester.enterText(rateField, '-0.1');
    await tester.tap(
      find.byKey(const ValueKey('payment-method-save-button')),
    );
    await tester.pump();
    expect(find.text('手续费率必须在 0% 到 100% 之间。'), findsOneWidget);

    await tester.enterText(rateField, '0.12345');
    await tester.tap(
      find.byKey(const ValueKey('payment-method-save-button')),
    );
    await tester.pump();
    expect(find.text('手续费率最多支持四位小数。'), findsOneWidget);

    await tester.enterText(rateField, '100.0001');
    await tester.tap(
      find.byKey(const ValueKey('payment-method-save-button')),
    );
    await tester.pump();
    expect(find.text('手续费率必须在 0% 到 100% 之间。'), findsOneWidget);
  });

  testWidgets('blocks default disable and supports status and default changes',
      (tester) async {
    _useLargeViewport(tester);
    final client = _FakePaymentMethodApiClient();
    await tester.pumpWidget(_page(client, UserRole.superAdmin));
    await tester.pumpAndSettle();

    await tester.tap(
      find.byKey(const ValueKey('payment-method-status-shouqianba')),
    );
    await tester.pump();
    expect(find.textContaining('请先设置新的默认收款方式'), findsOneWidget);
    expect(client.patchPaths, isEmpty);

    await tester.tap(
      find.byKey(const ValueKey('payment-method-default-cash')),
    );
    await tester.pumpAndSettle();
    expect(
      client.patchPaths,
      contains('/api/payment-methods/cash/default'),
    );
    final cashCard = find.byKey(
      const ValueKey('payment-method-card-cash'),
    );
    expect(
      find.descendant(of: cashCard, matching: find.text('当前默认')),
      findsOneWidget,
    );

    await tester.tap(
      find.byKey(const ValueKey('payment-method-status-shouqianba')),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('payment-method-status-confirm-button')),
    );
    await tester.pumpAndSettle();
    expect(
      client.patchPaths,
      contains('/api/payment-methods/shouqianba/disable'),
    );

    await tester.tap(
      find.byKey(const ValueKey('payment-method-status-cod')),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('payment-method-status-confirm-button')),
    );
    await tester.pumpAndSettle();
    expect(
      client.patchPaths,
      contains('/api/payment-methods/cod/enable'),
    );
  });

  testWidgets('moves methods with the sort endpoint and refreshes',
      (tester) async {
    _useLargeViewport(tester);
    final client = _FakePaymentMethodApiClient();
    await tester.pumpWidget(_page(client, UserRole.finance));
    await tester.pumpAndSettle();

    await tester.tap(
      find.byKey(const ValueKey('payment-method-down-shouqianba')),
    );
    await tester.pumpAndSettle();

    expect(client.lastPatchPath, '/api/payment-methods/sort-order');
    final items = client.lastPatchBody!['items'] as List<dynamic>;
    expect(items, [
      {'id': 'cash', 'sortOrder': 10},
      {'id': 'shouqianba', 'sortOrder': 20},
      {'id': 'cod', 'sortOrder': 30},
    ]);
    expect(client.getCount, 2);
  });

  testWidgets('shows backend business errors without closing the editor',
      (tester) async {
    _useLargeViewport(tester);
    final client = _FakePaymentMethodApiClient()
      ..nextMutationError = const ApiException(
        statusCode: 409,
        code: 'PAYMENT_METHOD_NAME_EXISTS',
        message: '收款方式名称已存在。',
      );
    await tester.pumpWidget(_page(client, UserRole.admin));
    await tester.pumpAndSettle();

    await tester.tap(
      find.byKey(const ValueKey('payment-method-edit-cash')),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('payment-method-name-field')),
      '收钱吧',
    );
    await tester.tap(
      find.byKey(const ValueKey('payment-method-save-button')),
    );
    await tester.pumpAndSettle();

    expect(find.text('收款方式名称已存在。'), findsOneWidget);
    expect(find.text('编辑收款方式'), findsOneWidget);
    expect(client.getCount, 1);
  });
}

Widget _page(ApiClient client, UserRole role) {
  return MaterialApp(
    theme: ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xFF7A1631),
      ),
    ),
    home: Scaffold(
      body: PaymentMethodManagementPage(
        apiClient: client,
        token: 'test-token',
        role: role,
      ),
    ),
  );
}

void _useLargeViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(1400, 1200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _selectCategory(WidgetTester tester, String label) async {
  await tester.tap(
    find.byKey(const ValueKey('payment-method-category-field')),
  );
  await tester.pumpAndSettle();
  await tester.tap(find.text(label).last);
  await tester.pumpAndSettle();
}

class _FakePaymentMethodApiClient extends ApiClient {
  _FakePaymentMethodApiClient()
      : _methods = [
          Map<String, dynamic>.from(_shouqianba),
          Map<String, dynamic>.from(_cash),
          Map<String, dynamic>.from(_cod),
        ],
        super(baseUrl: 'http://127.0.0.1:3000');

  final List<Map<String, dynamic>> _methods;
  final List<String> patchPaths = [];
  int getCount = 0;
  String? lastPostPath;
  Map<String, dynamic>? lastPostBody;
  String? lastPatchPath;
  Map<String, dynamic>? lastPatchBody;
  ApiException? nextMutationError;

  @override
  Future<Map<String, dynamic>> getJson(
    String path, {
    String? token,
  }) async {
    final uri = Uri.parse(path);
    if (uri.path != '/api/payment-methods') {
      throw StateError('Unexpected GET $path');
    }
    getCount += 1;
    return {
      'data': {
        'paymentMethods': _sortedMethods(),
      },
    };
  }

  @override
  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    _throwMutationError();
    lastPostPath = Uri.parse(path).path;
    lastPostBody = Map<String, dynamic>.from(body ?? const {});
    final created = <String, dynamic>{
      'id': 'created-${_methods.length + 1}',
      'code': 'custom_${_methods.length + 1}',
      'name': body?['name'],
      'category': body?['category'] ?? 'direct_receipt',
      'serviceFeeRate': body?['serviceFeeRate'],
      'isActive': true,
      'isDefault': false,
      'sortOrder': (_methods.length + 1) * 10,
    };
    _methods.add(created);
    return {
      'data': {'paymentMethod': Map<String, dynamic>.from(created)},
    };
  }

  @override
  Future<Map<String, dynamic>> patchJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    _throwMutationError();
    final target = Uri.parse(path).path;
    patchPaths.add(target);
    lastPatchPath = target;
    lastPatchBody = Map<String, dynamic>.from(body ?? const {});

    if (target == '/api/payment-methods/sort-order') {
      final items = body?['items'] as List<dynamic>? ?? const [];
      for (final raw in items.whereType<Map>()) {
        final method = _byId('${raw['id']}');
        method['sortOrder'] = raw['sortOrder'];
      }
      return {
        'data': {'paymentMethods': _sortedMethods()},
      };
    }

    final segments = Uri.parse(target).pathSegments;
    final id = segments.length >= 3 ? segments[2] : '';
    final method = _byId(id);
    if (segments.length == 3) {
      method.addAll(body ?? const {});
    } else {
      switch (segments[3]) {
        case 'enable':
          method['isActive'] = true;
          break;
        case 'disable':
          method['isActive'] = false;
          break;
        case 'default':
          for (final item in _methods) {
            item['isDefault'] = item['id'] == id;
          }
          method['isActive'] = true;
          break;
        default:
          throw StateError('Unexpected PATCH $path');
      }
    }
    return {
      'data': {'paymentMethod': Map<String, dynamic>.from(method)},
    };
  }

  void _throwMutationError() {
    final error = nextMutationError;
    nextMutationError = null;
    if (error != null) {
      throw error;
    }
  }

  Map<String, dynamic> _byId(String id) {
    return _methods.firstWhere((method) => method['id'] == id);
  }

  List<Map<String, dynamic>> _sortedMethods() {
    final methods = [
      for (final method in _methods) Map<String, dynamic>.from(method),
    ]..sort(
        (left, right) =>
            (left['sortOrder'] as int).compareTo(right['sortOrder'] as int),
      );
    return methods;
  }
}

const _shouqianba = {
  'id': 'shouqianba',
  'code': 'shouqianba',
  'name': '收钱吧',
  'category': 'direct_receipt',
  'serviceFeeRate': '0.006000',
  'isActive': true,
  'isDefault': true,
  'sortOrder': 10,
};

const _cash = {
  'id': 'cash',
  'code': 'cash',
  'name': '现金',
  'category': 'direct_receipt',
  'serviceFeeRate': '0.000000',
  'isActive': true,
  'isDefault': false,
  'sortOrder': 20,
};

const _cod = {
  'id': 'cod',
  'code': 'cash_on_delivery',
  'name': '货到付款',
  'category': 'collect_on_delivery',
  'serviceFeeRate': null,
  'isActive': false,
  'isDefault': false,
  'sortOrder': 30,
};
