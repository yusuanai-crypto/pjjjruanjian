import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/business/business_api.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_groups/tasting_items_editor.dart';

void main() {
  testWidgets('ordinary business form selects an active product without costs',
      (tester) async {
    final client = _FakeProductOptionsApiClient();
    var emitted = const <Map<String, dynamic>>[];

    await _pumpEditor(
      tester,
      TastingItemsEditor(
        businessApi: BusinessApi(apiClient: client, token: 'sales-token'),
        onChanged: (items) => emitted = items,
      ),
    );
    await tester.pumpAndSettle();

    expect(client.paths, ['/api/products/options']);
    expect(find.textContaining('成本'), findsNothing);
    await tester.tap(find.byKey(const ValueKey('tasting_items_add')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('tasting_product_0')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('product-option-search-field')),
      '珍藏',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('product-option-product-1')));
    await tester.pumpAndSettle();
    expect(find.text('酱香珍藏 · 瓶'), findsOneWidget);
    await tester.enterText(
      find.byKey(const ValueKey('tasting_quantity_0')),
      '3',
    );
    await tester.enterText(
      find.byKey(const ValueKey('tasting_note_0')),
      '醒酒后品鉴',
    );
    await tester.pumpAndSettle();

    expect(emitted.single, {
      'productId': 'product-1',
      'quantity': 3,
      'note': '醒酒后品鉴',
      'sortOrder': 1,
    });
    expect(emitted.single.containsKey('productName'), isFalse);
    expect(emitted.single.containsKey('unit'), isFalse);
    expect(emitted.single.keys.any((key) => key.toLowerCase().contains('cost')),
        isFalse);
  });

  testWidgets('inactive and unlinked historical snapshots have clear states',
      (tester) async {
    final client = _FakeProductOptionsApiClient();
    await _pumpEditor(
      tester,
      TastingItemsEditor(
        businessApi: BusinessApi(apiClient: client, token: 'front-token'),
        initialItems: const [
          TastingItemDraft(
            productId: 'inactive-product',
            productName: '历史停用酒',
            quantity: 1,
            unit: '瓶',
          ),
          TastingItemDraft(
            productName: '旧系统酒品',
            quantity: 2,
            unit: '杯',
          ),
        ],
        onChanged: (_) {},
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('历史停用酒 · 瓶'), findsOneWidget);
    expect(find.textContaining('原商品已停用'), findsOneWidget);
    expect(find.text('旧系统酒品 · 杯'), findsOneWidget);
    expect(find.textContaining('历史记录缺少 productId'), findsOneWidget);
  });

  testWidgets('options loading error and empty list are explicit',
      (tester) async {
    final errorClient = _FakeProductOptionsApiClient(fail: true);
    await _pumpEditor(
      tester,
      TastingItemsEditor(
        businessApi: BusinessApi(apiClient: errorClient, token: 'token'),
        initialItems: const [TastingItemDraft()],
        onChanged: (_) {},
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('商品选项加载失败'), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    final emptyClient = _FakeProductOptionsApiClient(empty: true);
    await _pumpEditor(
      tester,
      TastingItemsEditor(
        businessApi: BusinessApi(apiClient: emptyClient, token: 'token'),
        initialItems: const [TastingItemDraft()],
        onChanged: (_) {},
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('暂无启用商品'), findsOneWidget);
  });
}

Future<void> _pumpEditor(WidgetTester tester, Widget child) {
  return tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: child,
        ),
      ),
    ),
  );
}

class _FakeProductOptionsApiClient extends ApiClient {
  _FakeProductOptionsApiClient({this.fail = false, this.empty = false})
      : super(baseUrl: 'http://127.0.0.1:3000');

  final bool fail;
  final bool empty;
  final paths = <String>[];

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    paths.add(path);
    if (path != '/api/products/options') {
      throw StateError('Unexpected GET $path');
    }
    if (fail) {
      throw const ApiException(
        statusCode: 503,
        code: 'PRODUCT_OPTIONS_UNAVAILABLE',
        message: '商品服务暂不可用',
      );
    }
    return {
      'data': {
        'products': empty
            ? const []
            : const [
                {
                  'id': 'product-1',
                  'name': '酱香珍藏',
                  'unit': '瓶',
                  'actualUnitCostCents': 99999,
                  'actualCosts': [99999],
                },
                {'id': 'product-2', 'name': '旅行试饮', 'unit': '杯'},
              ],
      },
    };
  }
}
