import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/after_sales/after_sales_form_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets('searches real sales orders and fills selected order',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpAfterSalesForm(tester, apiClient);

    expect(find.text('SO-20260622-031'), findsNothing);
    expect(find.text('AS-20260621-008'), findsNothing);
    expect(find.text('输入客户姓名、电话或订单号搜索'), findsOneWidget);

    await tester.enterText(
      find.byKey(const ValueKey('after-sales-order-search-field')),
      '13800001111',
    );
    await tester.tap(
      find.byKey(const ValueKey('after-sales-order-search-button')),
    );
    await tester.pumpAndSettle();

    final uri = Uri.parse(apiClient.salesOrderListPaths.last);
    expect(uri.path, '/api/sales-orders');
    expect(uri.queryParameters['query'], '13800001111');
    expect(uri.queryParameters['limit'], '50');

    expect(find.text('SO20260630001'), findsWidgets);
    expect(find.textContaining('张女士'), findsWidgets);
    expect(find.textContaining('订单金额 ¥798.00'), findsOneWidget);
    expect(find.text('邮寄'), findsWidgets);
    expect(find.text('客户未标记'), findsNothing);

    await tester.tap(find.text('SO20260630001').first);
    await tester.pumpAndSettle();

    expect(find.text('关联订单'), findsOneWidget);
    expect(find.text('贵州省贵阳市观山湖区测试路 1 号'), findsOneWidget);
    expect(find.text('TG20260630001'), findsWidgets);
    expect(find.text('酱香珍藏 x2 · ¥798.00 · 邮寄'), findsOneWidget);
    expect(find.text('售后历史'), findsOneWidget);
    expect(find.text('AS20260630001'), findsOneWidget);
  });

  testWidgets('admin can see customer finance mark in order search results',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpAfterSalesForm(tester, apiClient, role: UserRole.admin);

    await tester.enterText(
      find.byKey(const ValueKey('after-sales-order-search-field')),
      '13800001111',
    );
    await tester.tap(
      find.byKey(const ValueKey('after-sales-order-search-button')),
    );
    await tester.pumpAndSettle();

    expect(find.text('客户未标记'), findsOneWidget);
  });

  testWidgets('shows empty state when no orders match', (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpAfterSalesForm(tester, apiClient);

    await tester.enterText(
      find.byKey(const ValueKey('after-sales-order-search-field')),
      'missing',
    );
    await tester.tap(
      find.byKey(const ValueKey('after-sales-order-search-button')),
    );
    await tester.pumpAndSettle();

    expect(find.text('未找到匹配订单'), findsOneWidget);
  });

  testWidgets('creates after-sales order and refreshes history',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpAfterSalesForm(tester, apiClient);

    await tester.enterText(
      find.byKey(const ValueKey('after-sales-order-search-field')),
      '13800001111',
    );
    await tester.tap(
      find.byKey(const ValueKey('after-sales-order-search-button')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('SO20260630001').first);
    await tester.pumpAndSettle();

    final saveButton = find.widgetWithText(FilledButton, '创建售后单');
    await tester.ensureVisible(saveButton);
    await tester.tap(saveButton);
    await tester.pumpAndSettle();
    expect(find.text('必填'), findsOneWidget);

    final issueTypeField =
        find.byKey(const ValueKey('after-sales-issue-type-field'));
    await tester.ensureVisible(issueTypeField);
    await tester.pumpAndSettle();
    await tester.tap(issueTypeField);
    await tester.pumpAndSettle();
    await tester.tap(find.text('物流破损').last);
    await tester.pumpAndSettle();

    final actionTypeField =
        find.byKey(const ValueKey('after-sales-action-type-field'));
    await tester.ensureVisible(actionTypeField);
    await tester.pumpAndSettle();
    await tester.tap(actionTypeField);
    await tester.pumpAndSettle();
    await tester.tap(find.text('部分退款').last);
    await tester.pumpAndSettle();

    final statusField = find.byKey(const ValueKey('after-sales-status-field'));
    await tester.ensureVisible(statusField);
    await tester.pumpAndSettle();
    await tester.tap(statusField);
    await tester.pumpAndSettle();
    await tester.tap(find.text('待退款').last);
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const ValueKey('after-sales-description-field')),
      'smoke 售后退款测试',
    );
    await tester.enterText(
      find.byKey(const ValueKey('after-sales-resolution-field')),
      'smoke 先登记后退款',
    );
    await tester.enterText(
      find.byKey(const ValueKey('after-sales-refund-amount-field')),
      '1200',
    );
    await tester.ensureVisible(saveButton);
    await tester.tap(saveButton);
    await tester.pumpAndSettle();

    expect(
        apiClient.afterSalesCreatePaths, contains('/api/after-sales-orders'));
    expect(apiClient.lastAfterSalesBody?['salesOrderId'], 'order-1');
    expect(apiClient.lastAfterSalesBody?['issueType'], 'logistics_damage');
    expect(apiClient.lastAfterSalesBody?['actionType'], 'refund');
    expect(apiClient.lastAfterSalesBody?['status'], 'waiting_refund');
    expect(apiClient.lastAfterSalesBody?['description'], 'smoke 售后退款测试');
    expect(apiClient.lastAfterSalesBody?['resolution'], 'smoke 先登记后退款');
    expect(apiClient.lastAfterSalesBody?['refundAmountCents'], 1200);
    expect(find.text('AS20260702001'), findsWidgets);
  });

  testWidgets('opens after-sales detail and updates status', (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpAfterSalesForm(tester, apiClient);

    await tester.enterText(
      find.byKey(const ValueKey('after-sales-order-search-field')),
      '13800001111',
    );
    await tester.tap(
      find.byKey(const ValueKey('after-sales-order-search-button')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('SO20260630001').first);
    await tester.pumpAndSettle();

    final historyUri = Uri.parse(apiClient.afterSalesListPaths.last);
    expect(historyUri.path, '/api/after-sales-orders');
    expect(historyUri.queryParameters['salesOrderId'], 'order-1');

    final historyItem = find.text('AS20260630001').first;
    await tester.ensureVisible(historyItem);
    await tester.pumpAndSettle();
    await tester.tap(historyItem);
    await tester.pumpAndSettle();

    expect(find.text('售后详情'), findsOneWidget);
    expect(find.text('smoke 已有售后记录'), findsWidgets);
    expect(find.text('退款金额'), findsOneWidget);
    expect(find.text('¥5.00'), findsWidgets);
    expect(find.text('2026-07-02 08:00:00'), findsWidgets);

    final waitingRefundButton =
        find.byKey(const ValueKey('after-sales-status-button-waiting_refund'));
    await tester.ensureVisible(waitingRefundButton);
    await tester.tap(waitingRefundButton);
    await tester.pumpAndSettle();

    expect(
      apiClient.statusPatchPaths,
      contains('/api/after-sales-orders/after-sales-1/status'),
    );
    expect(apiClient.lastStatusBody?['status'], 'waiting_refund');
    expect(apiClient.afterSalesListPaths.length, greaterThanOrEqualTo(2));
    expect(
        apiClient.salesOrderDetailPaths, contains('/api/sales-orders/order-1'));
    expect(find.text('待退款'), findsWidgets);
    expect(find.text('部分退款'), findsWidgets);
  });

  testWidgets('sales can view own after-sales history without handling buttons',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpAfterSalesForm(tester, apiClient, role: UserRole.sales);

    await tester.enterText(
      find.byKey(const ValueKey('after-sales-order-search-field')),
      '13800001111',
    );
    await tester.tap(
      find.byKey(const ValueKey('after-sales-order-search-button')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('SO20260630001').first);
    await tester.pumpAndSettle();

    expect(find.text('创建售后单'), findsNothing);
    expect(find.widgetWithText(FilledButton, '创建售后单'), findsNothing);
    expect(find.text('售后历史'), findsOneWidget);
    expect(find.text('AS20260630001'), findsOneWidget);

    final historyItem = find.text('AS20260630001').first;
    await tester.ensureVisible(historyItem);
    await tester.pumpAndSettle();
    await tester.tap(historyItem);
    await tester.pumpAndSettle();

    expect(find.text('售后详情'), findsOneWidget);
    expect(find.text('状态流转'), findsNothing);
    expect(
      find.byKey(const ValueKey('after-sales-status-button-waiting_refund')),
      findsNothing,
    );
    expect(apiClient.statusPatchPaths, isEmpty);
    expect(apiClient.afterSalesCreatePaths, isEmpty);
  });

  testWidgets('finance role sees refund todo and uploads proof',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpAfterSalesForm(
      tester,
      apiClient,
      role: UserRole.finance,
      filePicker: () async => [
        ApiMultipartFile.fromBytes(
          fileName: 'refund-proof.png',
          bytes: Uint8List.fromList([1, 2, 3]),
          contentType: 'image/png',
        ),
      ],
    );

    expect(find.text('财务退款待办'), findsOneWidget);
    expect(find.text('AS20260630001'), findsOneWidget);
    final confirmButton = find.byKey(
        const ValueKey('after-sales-finance-refund-confirm-after-sales-1'));
    expect(confirmButton, findsOneWidget);
    expect(find.widgetWithText(FilledButton, '已退款'), findsOneWidget);

    await tester.tap(confirmButton);
    await tester.pumpAndSettle();

    expect(
      apiClient.financeRefundConfirmPaths,
      contains('/api/after-sales-orders/after-sales-1/finance-refund-confirm'),
    );
    expect(apiClient.lastMultipartFiles?.single.fileName, 'refund-proof.png');
    expect(apiClient.lastMaxFileSizeBytes, 20 * 1024 * 1024);
  });

  testWidgets('warehouse role sees after-sales warehouse confirm buttons',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpAfterSalesForm(tester, apiClient, role: UserRole.warehouse);

    expect(find.text('仓库售后待办'), findsOneWidget);
    expect(find.text('AS20260630002'), findsOneWidget);
    final confirmButton = find.byKey(
        const ValueKey('after-sales-warehouse-confirm-after-sales-warehouse'));
    expect(confirmButton, findsOneWidget);
    expect(find.widgetWithText(FilledButton, '已补发'), findsOneWidget);

    await tester.tap(confirmButton);
    await tester.pumpAndSettle();

    expect(
      apiClient.warehouseConfirmPaths,
      contains(
          '/api/after-sales-orders/after-sales-warehouse/warehouse-confirm'),
    );
  });

  testWidgets('after-sales can complete after finance refund confirmation',
      (tester) async {
    final apiClient = _FakeApiClient();
    apiClient._afterSalesOrders[0] = _afterSalesJson(
      id: 'after-sales-1',
      afterSalesNo: 'AS20260630001',
      description: 'smoke 已退款售后记录',
      refundAmountCents: 500,
      resolution: 'smoke 已完成退款',
      status: 'waiting_refund',
      actionType: 'refund',
      financeConfirmed: true,
      refundProofAttachments: [_refundProofJson()],
    );
    await _pumpAfterSalesForm(tester, apiClient);

    await tester.enterText(
      find.byKey(const ValueKey('after-sales-order-search-field')),
      '13800001111',
    );
    await tester.tap(
      find.byKey(const ValueKey('after-sales-order-search-button')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('SO20260630001').first);
    await tester.pumpAndSettle();
    final historyItem = find.text('AS20260630001').first;
    await tester.ensureVisible(historyItem);
    await tester.pumpAndSettle();
    await tester.tap(historyItem);
    await tester.pumpAndSettle();

    final completedButton =
        find.byKey(const ValueKey('after-sales-status-button-completed'));
    await tester.ensureVisible(completedButton);
    expect(find.widgetWithText(OutlinedButton, '确认完成'), findsOneWidget);
    await tester.tap(completedButton);
    await tester.pumpAndSettle();

    expect(
      apiClient.statusPatchPaths,
      contains('/api/after-sales-orders/after-sales-1/status'),
    );
    expect(apiClient.lastStatusBody?['status'], 'completed');
  });
}

Future<void> _pumpAfterSalesForm(
  WidgetTester tester,
  _FakeApiClient apiClient, {
  UserRole role = UserRole.afterSales,
  AfterSalesRefundProofFilePicker? filePicker,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: AfterSalesFormPage(
          apiClient: apiClient,
          token: 'test-token',
          role: role,
          filePicker: filePicker,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

class _FakeApiClient extends ApiClient {
  _FakeApiClient() : super(baseUrl: 'http://127.0.0.1:3000');

  final List<String> salesOrderListPaths = <String>[];
  final List<String> salesOrderDetailPaths = <String>[];
  final List<String> afterSalesListPaths = <String>[];
  final List<String> afterSalesCreatePaths = <String>[];
  final List<String> statusPatchPaths = <String>[];
  final List<String> warehouseConfirmPaths = <String>[];
  final List<String> financeRefundConfirmPaths = <String>[];
  Map<String, dynamic>? lastAfterSalesBody;
  Map<String, dynamic>? lastStatusBody;
  List<ApiMultipartFile>? lastMultipartFiles;
  int? lastMaxFileSizeBytes;
  String _orderStatus = 'valid';
  final List<Map<String, dynamic>> _afterSalesOrders = [
    _afterSalesJson(
      id: 'after-sales-1',
      afterSalesNo: 'AS20260630001',
      description: 'smoke 已有售后记录',
      refundAmountCents: 500,
      resolution: 'smoke 已协商退款',
      status: 'waiting_refund',
      actionType: 'refund',
    ),
    _afterSalesJson(
      id: 'after-sales-warehouse',
      afterSalesNo: 'AS20260630002',
      description: 'smoke 仓库待补发记录',
      refundAmountCents: 0,
      resolution: 'smoke 补发缺失商品',
      status: 'waiting_resend',
      actionType: 'resend',
    ),
  ];

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    if (path.startsWith('/api/after-sales-orders')) {
      afterSalesListPaths.add(path);
      return {
        'data': {
          'afterSalesOrders': _afterSalesOrders,
        },
      };
    }

    if (path == '/api/sales-orders/order-1') {
      salesOrderDetailPaths.add(path);
      return {
        'data': {
          'salesOrder': _orderJson(status: _orderStatus),
        },
      };
    }

    if (path.startsWith('/api/sales-orders')) {
      salesOrderListPaths.add(path);
      final uri = Uri.parse(path);
      final query = uri.queryParameters['query'];
      return {
        'data': {
          'salesOrders': query == 'missing'
              ? const []
              : [_orderJson(status: _orderStatus)],
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
    if (path == '/api/after-sales-orders') {
      afterSalesCreatePaths.add(path);
      lastAfterSalesBody = Map<String, dynamic>.from(body ?? {});
      final created = _afterSalesJson(
        id: 'after-sales-2',
        afterSalesNo: 'AS20260702001',
        description: '${body?['description'] ?? ''}',
        refundAmountCents: body?['refundAmountCents'] is int
            ? body!['refundAmountCents'] as int
            : 0,
        resolution: '${body?['resolution'] ?? ''}',
        notes: '${body?['notes'] ?? ''}',
      );
      _afterSalesOrders.insert(0, created);
      return {
        'data': {
          'afterSalesOrder': created,
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
    if (path ==
        '/api/after-sales-orders/after-sales-warehouse/warehouse-confirm') {
      warehouseConfirmPaths.add(path);
      final index = _afterSalesOrders
          .indexWhere((item) => item['id'] == 'after-sales-warehouse');
      final updated = <String, dynamic>{
        ..._afterSalesOrders[index],
        'status': 'waiting_refund',
        'warehouseConfirmedById': 'warehouse-user',
        'warehouseConfirmedAt': '2026-07-02T09:30:00.000Z',
        'updatedAt': '2026-07-02T09:30:00.000Z',
      };
      _afterSalesOrders[index] = updated;
      return {
        'data': {
          'afterSalesOrder': updated,
        },
      };
    }

    if (path == '/api/after-sales-orders/after-sales-1/status') {
      statusPatchPaths.add(path);
      lastStatusBody = Map<String, dynamic>.from(body ?? {});
      final nextStatus = '${body?['status'] ?? 'negotiating'}';
      final index =
          _afterSalesOrders.indexWhere((item) => item['id'] == 'after-sales-1');
      final updated = <String, dynamic>{
        ..._afterSalesOrders[index],
        'status': nextStatus,
        'handledAt': '2026-07-02T09:00:00.000Z',
        'updatedAt': '2026-07-02T09:00:00.000Z',
      };
      _afterSalesOrders[index] = updated;
      if (nextStatus == 'waiting_refund' || nextStatus == 'completed') {
        _orderStatus = 'partial_refund';
      }
      return {
        'data': {
          'afterSalesOrder': updated,
        },
      };
    }

    throw StateError('Unexpected PATCH $path');
  }

  @override
  Future<Map<String, dynamic>> postMultipartFiles(
    String path, {
    required List<ApiMultipartFile> files,
    String fieldName = 'files',
    Map<String, String> fields = const <String, String>{},
    int? maxFileSizeBytes,
    String? token,
  }) async {
    if (path ==
        '/api/after-sales-orders/after-sales-1/finance-refund-confirm') {
      financeRefundConfirmPaths.add(path);
      lastMultipartFiles = files;
      lastMaxFileSizeBytes = maxFileSizeBytes;
      final index =
          _afterSalesOrders.indexWhere((item) => item['id'] == 'after-sales-1');
      final updated = <String, dynamic>{
        ..._afterSalesOrders[index],
        'financeConfirmed': true,
        'financeConfirmedById': 'finance-user',
        'financeConfirmedAt': '2026-07-02T09:20:00.000Z',
        'refundProofAttachments': [_refundProofJson()],
        'updatedAt': '2026-07-02T09:20:00.000Z',
      };
      _afterSalesOrders[index] = updated;
      return {
        'data': {
          'afterSalesOrder': updated,
        },
      };
    }

    throw StateError('Unexpected MULTIPART $path');
  }
}

Map<String, dynamic> _orderJson({String status = 'valid'}) {
  return {
    'id': 'order-1',
    'orderNo': 'SO20260630001',
    'orderType': 'travel_group',
    'orderDate': '2026-06-30',
    'customerId': 'customer-1',
    'customer': _customerJson(),
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
    'status': status,
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
    'financeMark': false,
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

Map<String, dynamic> _customerJson() {
  return {
    'id': 'customer-1',
    'name': '张女士',
    'phone': '13800001111',
    'province': '贵州省',
    'city': '贵阳市',
    'district': '观山湖区',
    'address': '测试路 1 号',
    'financeMark': false,
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

Map<String, dynamic> _afterSalesJson({
  required String id,
  required String afterSalesNo,
  required String description,
  required int refundAmountCents,
  String? resolution,
  String? notes,
  String status = 'negotiating',
  String actionType = 'record_only',
  bool financeConfirmed = false,
  List<Map<String, dynamic>> refundProofAttachments =
      const <Map<String, dynamic>>[],
}) {
  return {
    'id': id,
    'afterSalesNo': afterSalesNo,
    'salesOrderId': 'order-1',
    'salesOrder': _orderJson(),
    'customerId': 'customer-1',
    'customer': _customerJson(),
    'issueType': 'quality_issue',
    'actionType': actionType,
    'description': description,
    'resolution': resolution,
    'refundAmountCents': refundAmountCents,
    'status': status,
    'financeConfirmed': financeConfirmed,
    'financeConfirmedById': financeConfirmed ? 'finance-user' : null,
    'financeConfirmedAt': financeConfirmed ? '2026-07-02T09:00:00.000Z' : null,
    'warehouseConfirmedById': null,
    'warehouseConfirmedAt': null,
    'warehouseConfirmNote': null,
    'refundProofAttachments': refundProofAttachments,
    'handledById': 'after-sales-operator',
    'handledAt': '2026-07-02T08:00:00.000Z',
    'completedAt': null,
    'notes': notes,
    'createdById': 'after-sales-operator',
    'updatedById': 'after-sales-operator',
    'createdAt': '2026-07-02T08:00:00.000Z',
    'updatedAt': '2026-07-02T08:00:00.000Z',
  };
}

Map<String, dynamic> _refundProofJson() {
  return {
    'id': 'proof-1',
    'category': 'refund_proof',
    'originalName': 'refund-proof.png',
    'contentType': 'image/png',
    'size': 3,
    'uploadedById': 'finance-user',
    'uploadedAt': '2026-07-02T09:00:00.000Z',
  };
}
