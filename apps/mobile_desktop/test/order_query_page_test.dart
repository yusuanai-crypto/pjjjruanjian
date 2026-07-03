import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/order_query/order_query_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets('passes search and filters to sales orders API', (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpOrderQuery(tester, apiClient, role: UserRole.finance);

    await tester.enterText(
      find.byKey(const ValueKey('order-query-search-field')),
      'SO20260630',
    );
    await _selectDropdownValue(
      tester,
      key: const ValueKey('order-status-filter'),
      label: '有效',
    );
    await _selectDropdownValue(
      tester,
      key: const ValueKey('order-delivery-filter'),
      label: '邮寄',
    );
    await _selectDropdownValue(
      tester,
      key: const ValueKey('order-packing-filter'),
      label: '待打包',
    );
    await tester.tap(find.byKey(const ValueKey('order-query-search-button')));
    await tester.pumpAndSettle();

    final uri = Uri.parse(apiClient.salesOrderListPaths.last);
    expect(uri.path, '/api/sales-orders');
    expect(uri.queryParameters['query'], 'SO20260630');
    expect(uri.queryParameters['status'], 'valid');
    expect(uri.queryParameters['deliveryType'], 'shipping');
    expect(uri.queryParameters['packingStatus'], 'pending');
    expect(uri.queryParameters['limit'], '100');
    expect(uri.queryParameters.containsKey('dateFrom'), isTrue);
    expect(uri.queryParameters.containsKey('dateTo'), isTrue);
  });

  testWidgets(
      'shows order list detail and lets finance mark customer and order',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpOrderQuery(tester, apiClient, role: UserRole.finance);

    expect(find.text('SO20260630001'), findsWidgets);
    expect(find.textContaining('张女士'), findsWidgets);
    expect(find.textContaining('13800001111'), findsWidgets);
    expect(find.textContaining('TG20260630001'), findsWidgets);
    expect(find.text('客户未标记'), findsWidgets);
    expect(find.text('订单未标记'), findsWidgets);
    expect(find.text('物流单号'), findsOneWidget);
    expect(find.text('SF123456789'), findsOneWidget);
    expect(find.text('物流运费'), findsOneWidget);
    expect(find.text('¥18.00'), findsOneWidget);
    expect(find.text('顺丰'), findsOneWidget);
    expect(find.text('明细备注'), findsNothing);
    expect(find.text('订单明细'), findsOneWidget);
    expect(find.text('酱香珍藏'), findsOneWidget);
    expect(find.text('单价 ¥399.00'), findsOneWidget);
    expect(find.text('小计 ¥798.00'), findsOneWidget);
    expect(find.textContaining('礼盒装'), findsOneWidget);

    final customerMarkButton = find.widgetWithText(OutlinedButton, '客户标记 未标记');
    await tester.ensureVisible(customerMarkButton);
    await tester.pumpAndSettle();
    await tester.tap(customerMarkButton);
    await tester.pumpAndSettle();
    expect(apiClient.lastCustomerMarkBody?['financeMark'], isTrue);
    expect(find.widgetWithText(FilledButton, '客户标记 已标记'), findsOneWidget);

    final orderMarkButton = find.widgetWithText(OutlinedButton, '订单标记 未标记');
    await tester.ensureVisible(orderMarkButton);
    await tester.pumpAndSettle();
    await tester.tap(orderMarkButton);
    await tester.pumpAndSettle();
    expect(apiClient.lastOrderMarkBody?['financeMark'], isTrue);
    expect(find.widgetWithText(FilledButton, '订单标记 已标记'), findsOneWidget);
  });

  testWidgets('shows sales edit entry but hides finance mark buttons',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpOrderQuery(tester, apiClient, role: UserRole.sales);

    expect(
        find.byKey(const ValueKey('order-basic-edit-button')), findsOneWidget);
    expect(find.byKey(const ValueKey('order-qr-sales-sheet-button')),
        findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, '客户标记 未标记'), findsNothing);
    expect(find.widgetWithText(OutlinedButton, '订单标记 未标记'), findsNothing);
  });

  testWidgets('boss sees read-only details without edit or mark actions',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpOrderQuery(tester, apiClient, role: UserRole.boss);

    expect(find.text('老板只读'), findsOneWidget);
    expect(find.byKey(const ValueKey('order-qr-sales-sheet-button')),
        findsOneWidget);
    expect(find.byKey(const ValueKey('order-basic-edit-button')), findsNothing);
    expect(find.widgetWithText(OutlinedButton, '客户标记 未标记'), findsNothing);
    expect(find.widgetWithText(OutlinedButton, '订单标记 未标记'), findsNothing);
  });

  testWidgets('after sales can use the page as an order locator',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpOrderQuery(tester, apiClient, role: UserRole.afterSales);

    expect(find.text('售后查询定位'), findsOneWidget);
    expect(find.byKey(const ValueKey('order-qr-sales-sheet-button')),
        findsOneWidget);
    expect(find.byKey(const ValueKey('order-basic-edit-button')), findsNothing);
    expect(find.widgetWithText(OutlinedButton, '客户标记 未标记'), findsNothing);

    await tester.enterText(
      find.byKey(const ValueKey('order-query-search-field')),
      '13800001111',
    );
    await tester.tap(find.byKey(const ValueKey('order-query-search-button')));
    await tester.pumpAndSettle();

    final uri = Uri.parse(apiClient.salesOrderListPaths.last);
    expect(uri.queryParameters['query'], '13800001111');
  });

  testWidgets('shows sales order export for admin and finance only',
      (tester) async {
    final adminClient = _FakeApiClient();
    await _pumpOrderQuery(tester, adminClient, role: UserRole.admin);
    expect(find.byKey(const ValueKey('order-export-sales-orders-button')),
        findsOneWidget);

    final financeClient = _FakeApiClient();
    await _pumpOrderQuery(tester, financeClient, role: UserRole.finance);
    expect(find.byKey(const ValueKey('order-export-sales-orders-button')),
        findsOneWidget);

    final salesClient = _FakeApiClient();
    await _pumpOrderQuery(tester, salesClient, role: UserRole.sales);
    expect(find.byKey(const ValueKey('order-export-sales-orders-button')),
        findsNothing);
  });

  testWidgets('exports sales orders with current filters and saves file',
      (tester) async {
    final tempDirectory = Directory(
      'build/order-export-test-${DateTime.now().microsecondsSinceEpoch}',
    )..createSync(recursive: true);
    addTearDown(() => _deleteDirectoryWithRetry(tempDirectory));

    final apiClient = _FakeApiClient();
    apiClient.downloadGate = Completer<void>();
    await _pumpOrderQuery(
      tester,
      apiClient,
      role: UserRole.finance,
      documentsDirectory: tempDirectory,
    );

    await tester.enterText(
      find.byKey(const ValueKey('order-query-search-field')),
      'SO20260630',
    );
    await _selectDropdownValue(
      tester,
      key: const ValueKey('order-status-filter'),
      label: '有效',
    );
    await _selectDropdownValue(
      tester,
      key: const ValueKey('order-delivery-filter'),
      label: '邮寄',
    );
    await _selectDropdownValue(
      tester,
      key: const ValueKey('order-packing-filter'),
      label: '待打包',
    );

    final exportButton =
        find.byKey(const ValueKey('order-export-sales-orders-button'));
    await tester.tap(exportButton);
    await tester.pump();

    expect(find.text('导出中'), findsOneWidget);
    expect(tester.widget<OutlinedButton>(exportButton).onPressed, isNull);

    final exportDirectory = Directory(
      '${tempDirectory.path}${Platform.pathSeparator}exports',
    );
    final exportedFile = File(
      '${exportDirectory.path}${Platform.pathSeparator}backend-sales-orders.xlsx',
    );

    apiClient.downloadGate!.complete();
    for (var index = 0; index < 20 && !exportedFile.existsSync(); index += 1) {
      await tester.pump(const Duration(milliseconds: 50));
      await tester.runAsync(() async {
        await Future<void>.delayed(const Duration(milliseconds: 20));
      });
    }
    await tester.pump(const Duration(milliseconds: 200));

    expect(apiClient.salesOrderDownloadPaths, hasLength(1));
    final uri = Uri.parse(apiClient.salesOrderDownloadPaths.single);
    expect(uri.path, '/api/sales-orders/export.xlsx');
    expect(uri.queryParameters['query'], 'SO20260630');
    expect(uri.queryParameters['status'], 'valid');
    expect(uri.queryParameters['deliveryType'], 'shipping');
    expect(uri.queryParameters['packingStatus'], 'pending');
    expect(uri.queryParameters.containsKey('dateFrom'), isTrue);
    expect(uri.queryParameters.containsKey('dateTo'), isTrue);
    expect(apiClient.lastDownloadDefaultFileName, 'sales-orders.xlsx');

    expect(
      exportedFile.existsSync(),
      isTrue,
      reason: exportDirectory.existsSync()
          ? exportDirectory.listSync().map((file) => file.path).join(', ')
          : 'export directory does not exist',
    );
    expect(exportedFile.readAsBytesSync(), [0x50, 0x4B, 0x03, 0x04]);
    for (var index = 0;
        index < 20 && find.textContaining(exportedFile.path).evaluate().isEmpty;
        index += 1) {
      await tester.pump(const Duration(milliseconds: 50));
      await tester.runAsync(() async {
        await Future<void>.delayed(const Duration(milliseconds: 20));
      });
    }
    expect(find.textContaining(exportedFile.path), findsOneWidget);
  });

  testWidgets('shows friendly export error from ApiException', (tester) async {
    final tempDirectory = Directory(
      'build/order-export-fail-${DateTime.now().microsecondsSinceEpoch}',
    )..createSync(recursive: true);
    addTearDown(() => _deleteDirectoryWithRetry(tempDirectory));

    final apiClient = _FakeApiClient(failDownload: true);
    await _pumpOrderQuery(
      tester,
      apiClient,
      role: UserRole.finance,
      documentsDirectory: tempDirectory,
    );

    await tester.tap(
      find.byKey(const ValueKey('order-export-sales-orders-button')),
    );
    await tester.pumpAndSettle();

    expect(find.text('测试错误：导出失败。'), findsWidgets);
  });

  testWidgets('QR sales sheet dialog allows admin to generate QR code',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final apiClient = _FakeApiClient();
    await _pumpOrderQuery(tester, apiClient, role: UserRole.admin);

    final qrButton = find.byKey(const ValueKey('order-qr-sales-sheet-button'));
    await tester.ensureVisible(qrButton);
    await tester.pumpAndSettle();
    await tester.tap(qrButton);
    await tester.pumpAndSettle();

    expect(
        apiClient.salesSheetPaths, ['/api/sales-orders/order-1/sales-sheet']);
    expect(find.text('SO20260630001 二维码销售单'), findsOneWidget);
    expect(find.text('尚未生成二维码'), findsWidgets);
    expect(
        find.byKey(const ValueKey('order-qr-generate-button')), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('order-qr-generate-button')));
    await tester.pumpAndSettle();

    expect(apiClient.qrCodePaths, ['/api/sales-orders/order-1/qr-code']);
    expect(apiClient.lastQrCodeBody?['regenerate'], isFalse);
    expect(
      find.text('https://example.test/api/public/sales-sheets/token-1'),
      findsWidgets,
    );
    expect(
        find.byKey(const ValueKey('order-qr-generate-button')), findsNothing);
  });

  testWidgets('read-only roles can view existing QR without generate action',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final apiClient = _FakeApiClient(
      salesSheetQrUrl: 'https://example.test/api/public/sales-sheets/existing',
    );
    await _pumpOrderQuery(tester, apiClient, role: UserRole.finance);

    final qrButton = find.byKey(const ValueKey('order-qr-sales-sheet-button'));
    await tester.ensureVisible(qrButton);
    await tester.pumpAndSettle();
    await tester.tap(qrButton);
    await tester.pumpAndSettle();

    expect(
        apiClient.salesSheetPaths, ['/api/sales-orders/order-1/sales-sheet']);
    expect(
      find.text('https://example.test/api/public/sales-sheets/existing'),
      findsWidgets,
    );
    expect(
        find.byKey(const ValueKey('order-qr-generate-button')), findsNothing);
  });
}

Future<void> _pumpOrderQuery(
  WidgetTester tester,
  _FakeApiClient apiClient, {
  required UserRole role,
  Directory? documentsDirectory,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: OrderQueryPage(
          apiClient: apiClient,
          token: 'test-token',
          role: role,
          documentsDirectoryProvider: documentsDirectory == null
              ? null
              : () async => documentsDirectory,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _selectDropdownValue(
  WidgetTester tester, {
  required Key key,
  required String label,
}) async {
  await tester.tap(find.byKey(key));
  await tester.pumpAndSettle();
  await tester.tap(find.text(label).last);
  await tester.pumpAndSettle();
}

Future<void> _deleteDirectoryWithRetry(Directory directory) async {
  for (var index = 0; index < 5; index += 1) {
    try {
      if (await directory.exists()) {
        await directory.delete(recursive: true);
      }
      return;
    } on FileSystemException {
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
  }
}

class _FakeApiClient extends ApiClient {
  _FakeApiClient({
    this.salesSheetQrUrl,
    this.failDownload = false,
  }) : super(baseUrl: 'http://127.0.0.1:3000');

  final List<String> salesOrderListPaths = <String>[];
  final List<String> salesOrderDownloadPaths = <String>[];
  final List<String> salesSheetPaths = <String>[];
  final List<String> qrCodePaths = <String>[];
  final String? salesSheetQrUrl;
  final bool failDownload;
  Map<String, dynamic>? lastCustomerMarkBody;
  Map<String, dynamic>? lastOrderMarkBody;
  Map<String, dynamic>? lastOrderUpdateBody;
  Map<String, dynamic>? lastQrCodeBody;
  String? lastDownloadDefaultFileName;
  Completer<void>? downloadGate;
  bool customerMark = false;
  bool orderMark = false;

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    if (path == '/api/sales-orders/order-1/sales-sheet') {
      salesSheetPaths.add(path);
      return {
        'data': {
          'salesSheet': _salesSheetJson(qrCodeUrl: salesSheetQrUrl),
        },
      };
    }
    if (path == '/api/sales-orders/order-1') {
      return {
        'data': {
          'salesOrder': _orderJson(
            customerMark: customerMark,
            orderMark: orderMark,
          ),
        },
      };
    }
    if (path.startsWith('/api/sales-orders')) {
      salesOrderListPaths.add(path);
      return {
        'data': {
          'salesOrders': [
            _orderJson(customerMark: customerMark, orderMark: orderMark),
          ],
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
    throw StateError('Unexpected POST $path');
  }

  @override
  Future<ApiDownloadedFile> getBytes(
    String path, {
    required String defaultFileName,
    String? token,
  }) async {
    salesOrderDownloadPaths.add(path);
    lastDownloadDefaultFileName = defaultFileName;
    if (downloadGate != null) {
      await downloadGate!.future;
    }
    if (failDownload) {
      throw const ApiException(
        statusCode: 500,
        code: 'TEST_EXPORT_FAILED',
        message: '测试错误：导出失败。',
      );
    }
    return ApiDownloadedFile(
      bytes: Uint8List.fromList(<int>[0x50, 0x4B, 0x03, 0x04]),
      fileName: 'backend-sales-orders.xlsx',
      contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }

  @override
  Future<Map<String, dynamic>> patchJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    if (path == '/api/customers/customer-1/finance-mark') {
      lastCustomerMarkBody = Map<String, dynamic>.from(body ?? {});
      customerMark = body?['financeMark'] == true;
      return {
        'data': {
          'customer': _customerJson(financeMark: customerMark),
        },
      };
    }
    if (path == '/api/sales-orders/order-1/finance-mark') {
      lastOrderMarkBody = Map<String, dynamic>.from(body ?? {});
      orderMark = body?['financeMark'] == true;
      return {
        'data': {
          'salesOrder': _orderJson(
            customerMark: customerMark,
            orderMark: orderMark,
          ),
        },
      };
    }
    if (path == '/api/sales-orders/order-1') {
      lastOrderUpdateBody = Map<String, dynamic>.from(body ?? {});
      return {
        'data': {
          'salesOrder': {
            ..._orderJson(customerMark: customerMark, orderMark: orderMark),
            ...?body,
          },
        },
      };
    }
    throw StateError('Unexpected PATCH $path');
  }
}

Map<String, dynamic> _orderJson({
  required bool customerMark,
  required bool orderMark,
}) {
  return {
    'id': 'order-1',
    'orderNo': 'SO20260630001',
    'orderType': 'travel_group',
    'orderDate': '2026-06-30',
    'customerId': 'customer-1',
    'customer': _customerJson(financeMark: customerMark),
    'customerName': '张女士',
    'customerPhone': '13800001111',
    'province': '贵州省',
    'city': '贵阳市',
    'district': '观山湖区',
    'address': '测试路 1 号',
    'travelGroupId': 'group-1',
    'travelGroup': _travelGroupJson(),
    'salesFormNo': 'XS-001',
    'totalAmountCents': 79800,
    'cashOnDeliveryAmountCents': 10000,
    'status': 'valid',
    'deliverySummary': 'shipping',
    'packingStatus': 'pending',
    'logisticsMethod': '顺丰',
    'packageCount': 2,
    'warehouseRemark': '注意防震',
    'logisticsNo': 'SF123456789',
    'logisticsFeeCents': 1800,
    'invoiceRequired': true,
    'invoiceIssued': false,
    'financeRemark': '待核对运费',
    'financeMark': orderMark,
    'salesUserId': 'sales-1',
    'items': [
      {
        'id': 'item-1',
        'salesOrderId': 'order-1',
        'productName': '酱香珍藏',
        'quantity': 2,
        'unitPriceCents': 39900,
        'subtotalCents': 79800,
        'deliveryType': 'shipping',
        'notes': '礼盒装',
        'sortOrder': 1,
      },
    ],
  };
}

Map<String, dynamic> _customerJson({required bool financeMark}) {
  return {
    'id': 'customer-1',
    'name': '张女士',
    'phone': '13800001111',
    'province': '贵州省',
    'city': '贵阳市',
    'district': '观山湖区',
    'address': '测试路 1 号',
    'financeMark': financeMark,
    'markedById': null,
    'markedAt': null,
    'notes': null,
    'createdById': null,
    'updatedById': null,
    'createdAt': null,
    'updatedAt': null,
  };
}

Map<String, dynamic> _travelGroupJson() {
  return {
    'id': 'group-1',
    'kind': 'travel',
    'groupNo': 'TG20260630001',
    'visitDate': '2026-06-30',
    'travelAgency': '测试旅行社',
    'guideName': '李导',
    'guestCount': 20,
    'status': 'unmarked',
    'financeMark': true,
    'tastingItems': const [],
    'salesOrders': const [],
    'orderSummary': const {
      'orderCount': 0,
      'totalAmountCents': 0,
      'cashOnDeliveryAmountCents': 0,
    },
  };
}

Map<String, dynamic> _salesSheetJson({required String? qrCodeUrl}) {
  return {
    'visibility': 'internal',
    'companyName': '贵州酱酒馆',
    'order': {
      'id': 'order-1',
      'orderNo': 'SO20260630001',
      'orderType': 'travel_group',
      'orderTypeLabel': '旅行团订单',
      'salesFormNo': 'XS-001',
      'orderDate': '2026-06-30',
    },
    'customer': {
      'id': 'customer-1',
      'name': '张女士',
      'phone': '13800001111',
      'phoneMasked': '138****1111',
      'fullAddress': '贵州省贵阳市观山湖区测试路 1 号',
    },
    'travelGroup': {
      'id': 'group-1',
      'groupNo': 'TG20260630001',
      'visitDate': '2026-06-30',
      'travelAgency': '测试旅行社',
      'guideName': '李导',
      'tasterName': '测试品鉴师',
    },
    'salesUser': {
      'id': 'sales-1',
      'name': '陈销售',
      'username': 'sales',
    },
    'items': [
      {
        'id': 'item-1',
        'productName': '酱香珍藏',
        'quantity': 2,
        'unitPriceCents': 39900,
        'unitPriceYuan': '399.00',
        'subtotalCents': 79800,
        'subtotalYuan': '798.00',
        'deliveryType': 'shipping',
        'deliveryTypeLabel': '邮寄',
        'sortOrder': 1,
      },
    ],
    'amounts': {
      'totalAmountCents': 79800,
      'totalAmountYuan': '798.00',
      'cashOnDeliveryAmountCents': 10000,
      'cashOnDeliveryAmountYuan': '100.00',
      'logisticsFeeCents': 1800,
      'logisticsFeeYuan': '18.00',
    },
    'status': {'value': 'valid', 'label': '有效'},
    'delivery': {'summary': 'shipping', 'summaryLabel': '邮寄'},
    'logistics': {
      'method': '顺丰',
      'logisticsNo': 'SF123456789',
      'packingStatus': 'pending',
      'packingStatusLabel': '待打包',
      'packageCount': 2,
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
