import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/order_qrcodes/qr_sales_sheet_page.dart';

void main() {
  testWidgets('searches order previews sales sheet and generates QR code',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final apiClient = _FakeApiClient();
    await _pumpPage(tester, apiClient);

    await tester.enterText(
      find.byKey(const ValueKey('qr-sales-search-field')),
      'SO20260701001',
    );
    await tester.tap(find.byKey(const ValueKey('qr-sales-search-button')));
    await tester.pumpAndSettle();

    expect(apiClient.salesOrderListPaths, hasLength(1));
    final listUri = Uri.parse(apiClient.salesOrderListPaths.single);
    expect(listUri.path, '/api/sales-orders');
    expect(listUri.queryParameters['query'], 'SO20260701001');
    expect(find.text('测试客户 · 13800000000'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('qr-sales-result-order-1')));
    await tester.pumpAndSettle();

    expect(
        apiClient.salesSheetPaths, ['/api/sales-orders/order-1/sales-sheet']);
    expect(find.text('贵州酱酒馆销售单'), findsOneWidget);
    expect(find.text('生成二维码后显示'), findsWidgets);
    expect(find.text('酱香珍藏'), findsOneWidget);
    expect(find.textContaining('测试旅行社'), findsWidgets);

    await tester.tap(find.byKey(const ValueKey('qr-sales-generate-button')));
    await tester.pumpAndSettle();

    expect(apiClient.qrCodePaths, ['/api/sales-orders/order-1/qr-code']);
    expect(apiClient.lastQrCodeBody?['regenerate'], isFalse);
    expect(find.text('https://example.test/api/public/sales-sheets/token-1'),
        findsWidgets);
    expect(find.text('请客户拍照保存销售单和二维码。'), findsOneWidget);

    await tester.ensureVisible(
      find.byKey(const ValueKey('qr-sales-copy-link-button')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('qr-sales-copy-link-button')));
    await tester.pumpAndSettle();

    expect(find.text('公开链接已复制。'), findsOneWidget);
  });

  testWidgets('shows clear search error', (tester) async {
    tester.view.physicalSize = const Size(1200, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final apiClient = _FakeApiClient(failSearch: true);
    await _pumpPage(tester, apiClient);

    await tester.enterText(
      find.byKey(const ValueKey('qr-sales-search-field')),
      'SO-NOT-FOUND',
    );
    await tester.tap(find.byKey(const ValueKey('qr-sales-search-button')));
    await tester.pumpAndSettle();

    expect(find.text('测试错误：无法查询订单。'), findsOneWidget);
    expect(find.text('暂无匹配订单'), findsOneWidget);
  });
}

Future<void> _pumpPage(WidgetTester tester, ApiClient apiClient) {
  return tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: QrSalesSheetPage(
          apiClient: apiClient,
          token: 'token-1',
        ),
      ),
    ),
  );
}

class _FakeApiClient extends ApiClient {
  _FakeApiClient({this.failSearch = false})
      : super(baseUrl: 'http://127.0.0.1:3000');

  final bool failSearch;
  final List<String> salesOrderListPaths = <String>[];
  final List<String> salesSheetPaths = <String>[];
  final List<String> qrCodePaths = <String>[];
  Map<String, dynamic>? lastQrCodeBody;

  @override
  Future<Map<String, dynamic>> getJson(
    String path, {
    String? token,
  }) async {
    if (path == '/api/sales-orders/order-1/sales-sheet') {
      salesSheetPaths.add(path);
      return {
        'data': {
          'salesSheet': _salesSheetJson(qrCodeUrl: null),
        },
      };
    }

    if (path.startsWith('/api/sales-orders')) {
      salesOrderListPaths.add(path);
      if (failSearch) {
        throw const ApiException(
          statusCode: 500,
          code: 'TEST_ERROR',
          message: '测试错误：无法查询订单。',
        );
      }
      return {
        'data': {
          'salesOrders': [_salesOrderJson()],
        },
      };
    }

    return <String, dynamic>{'data': <String, dynamic>{}};
  }

  @override
  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    if (path == '/api/sales-orders/order-1/qr-code') {
      qrCodePaths.add(path);
      lastQrCodeBody = Map<String, dynamic>.from(body ?? <String, dynamic>{});
      return {
        'data': {
          'salesSheet': _salesSheetJson(
            qrCodeUrl: 'https://example.test/api/public/sales-sheets/token-1',
          ),
          'qrCode': {
            'token': 'token-1',
            'url': 'https://example.test/api/public/sales-sheets/token-1',
            'generatedAt': '2026-07-01T08:00:00.000Z',
            'expiresAt': null,
          },
        },
      };
    }

    return <String, dynamic>{'data': <String, dynamic>{}};
  }
}

Map<String, dynamic> _salesOrderJson() {
  return {
    'id': 'order-1',
    'orderNo': 'SO20260701001',
    'salesFormNo': 'FORM-001',
    'orderType': 'travel_group',
    'customerName': '测试客户',
    'customerPhone': '13800000000',
    'orderDate': '2026-07-01',
    'totalAmountCents': 79600,
    'cashOnDeliveryAmountCents': 1000,
    'status': 'valid',
    'deliverySummary': 'shipping',
    'packingStatus': 'pending',
    'travelGroup': {
      'id': 'group-1',
      'groupNo': 'TG-001',
      'visitDate': '2026-07-01',
      'travelAgency': '测试旅行社',
    },
  };
}

Map<String, dynamic> _salesSheetJson({required String? qrCodeUrl}) {
  return {
    'visibility': 'internal',
    'companyName': '贵州酱酒馆',
    'order': {
      'id': 'order-1',
      'orderNo': 'SO20260701001',
      'orderType': 'travel_group',
      'orderTypeLabel': '旅行团订单',
      'salesFormNo': 'FORM-001',
      'orderDate': '2026-07-01',
    },
    'customer': {
      'id': 'customer-1',
      'name': '测试客户',
      'phone': '13800000000',
      'phoneMasked': '138****0000',
      'fullAddress': '贵州省贵阳市南明区测试地址',
    },
    'travelGroup': {
      'id': 'group-1',
      'groupNo': 'TG-001',
      'visitDate': '2026-07-01',
      'travelAgency': '测试旅行社',
      'guideName': '测试导游',
      'tasterName': '测试品鉴师',
    },
    'salesUser': {
      'id': 'usr_sales',
      'name': '销售一号',
      'username': 'sales',
    },
    'items': [
      {
        'id': 'item-1',
        'productName': '酱香珍藏',
        'quantity': 2,
        'unitPriceCents': 39800,
        'unitPriceYuan': '398.00',
        'subtotalCents': 79600,
        'subtotalYuan': '796.00',
        'deliveryType': 'shipping',
        'deliveryTypeLabel': '邮寄',
        'sortOrder': 1,
      },
    ],
    'amounts': {
      'totalAmountCents': 79600,
      'totalAmountYuan': '796.00',
      'cashOnDeliveryAmountCents': 1000,
      'cashOnDeliveryAmountYuan': '10.00',
      'logisticsFeeCents': 0,
      'logisticsFeeYuan': '0.00',
    },
    'status': {'value': 'valid', 'label': '有效'},
    'delivery': {'summary': 'shipping', 'summaryLabel': '邮寄'},
    'logistics': {
      'method': '顺丰',
      'logisticsNo': 'SF123456',
      'packingStatus': 'pending',
      'packingStatusLabel': '待打包',
      'packageCount': 1,
    },
    'invoice': {
      'required': true,
      'requiredLabel': '需要开票',
      'issued': false,
      'issuedLabel': '未开票',
    },
    'qrCode': qrCodeUrl == null
        ? null
        : {
            'token': 'token-1',
            'url': qrCodeUrl,
            'generatedAt': '2026-07-01T08:00:00.000Z',
            'expiresAt': null,
          },
  };
}
