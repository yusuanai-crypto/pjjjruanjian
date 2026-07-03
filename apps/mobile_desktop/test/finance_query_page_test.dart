import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/finance/finance_query_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets('shows finance workbench metrics filters and pending after sales',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpFinanceQuery(tester, apiClient);

    final uri = Uri.parse(apiClient.financeWorkbenchPaths.last);
    expect(uri.path, '/api/finance/workbench');
    expect(uri.queryParameters['limit'], '50');

    expect(find.text('出单销售额'), findsOneWidget);
    expect(find.text('退款金额'), findsOneWidget);
    expect(find.text('净销售额'), findsOneWidget);
    expect(find.text('物流费用'), findsWidgets);
    expect(find.text('待开票'), findsWidgets);
    expect(find.text('待标记'), findsOneWidget);
    expect(find.text('待确认售后'), findsWidgets);
    expect(find.text('¥798.00'), findsWidgets);
    expect(find.text('¥0.00'), findsWidgets);
    expect(find.text('¥18.00'), findsWidgets);
    expect(find.textContaining('退款 ¥12.00'), findsWidgets);

    expect(find.text('AS20260702001'), findsWidgets);
    expect(find.textContaining('状态 待退款'), findsWidgets);
    expect(find.text('质量问题'), findsWidgets);

    await tester.tap(find.widgetWithText(FilterChip, '标记信息'));
    await tester.pumpAndSettle();
    expect(find.text('客户未标记'), findsWidgets);

    await tester.tap(find.widgetWithText(FilterChip, '开票待办'));
    await tester.pumpAndSettle();
    expect(find.text('待补物流单号'), findsWidgets);
    expect(find.text('待补运费'), findsWidgets);
  });

  testWidgets('shows phase 4 finance fields and saves finance updates',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpFinanceQuery(tester, apiClient);

    expect(find.text('SO20260630001'), findsWidgets);
    expect(find.text('客户已标记'), findsWidgets);
    expect(find.text('物流单号 SF123456789'), findsOneWidget);
    expect(find.text('运费 ¥18.00'), findsOneWidget);
    expect(find.text('待开票'), findsWidgets);

    await tester.ensureVisible(find.text('SO20260630001').first);
    await tester.tap(find.text('SO20260630001').first);
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const ValueKey('finance-logistics-no-field')),
      'YT999000111',
    );
    await tester.enterText(
      find.byKey(const ValueKey('finance-logistics-fee-field')),
      '25.50',
    );
    await tester.tap(
      find.byKey(const ValueKey('finance-invoice-issued-checkbox')),
    );
    await tester.enterText(
      find.byKey(const ValueKey('finance-remark-field')),
      '运费已复核',
    );
    await tester.tap(find.byKey(const ValueKey('finance-save-button')));
    await tester.pumpAndSettle();

    expect(apiClient.financePatchPaths,
        contains('/api/sales-orders/order-1/finance'));
    expect(apiClient.lastFinanceBody?['logisticsNo'], 'YT999000111');
    expect(apiClient.lastFinanceBody?['logisticsFeeCents'], 2550);
    expect(apiClient.lastFinanceBody?['invoiceIssued'], isTrue);
    expect(apiClient.lastFinanceBody?['financeRemark'], '运费已复核');
    expect(find.text('物流单号 YT999000111'), findsOneWidget);
    expect(find.text('运费 ¥25.50'), findsOneWidget);
    expect(find.text('已开票'), findsWidgets);
  });

  testWidgets('shows API error when finance save fails', (tester) async {
    final apiClient = _FakeApiClient(failFinancePatch: true);
    await _pumpFinanceQuery(tester, apiClient);

    await tester.ensureVisible(find.text('SO20260630001').first);
    await tester.tap(find.text('SO20260630001').first);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('finance-save-button')));
    await tester.pumpAndSettle();

    expect(find.text('运费不能小于 0'), findsOneWidget);
  });

  testWidgets('finance can confirm after sales refund and refresh workbench',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpFinanceQuery(tester, apiClient);

    const confirmKey = ValueKey(
      'finance-pending-after-sales-secondary-confirm-after-sales-1',
    );
    expect(find.byKey(confirmKey), findsOneWidget);
    expect(find.text('AS20260702001'), findsWidgets);
    expect(apiClient.financeWorkbenchPaths, hasLength(1));

    await tester.ensureVisible(find.byKey(confirmKey));
    await tester.tap(find.byKey(confirmKey));
    await tester.pumpAndSettle();

    expect(apiClient.afterSalesConfirmPaths,
        contains('/api/after-sales-orders/after-sales-1/finance-confirm'));
    expect(apiClient.lastAfterSalesConfirmBody?['financeConfirmed'], isTrue);
    expect(apiClient.financeWorkbenchPaths, hasLength(2));
    expect(find.byKey(confirmKey), findsNothing);
    expect(find.text('当前范围暂无待确认售后'), findsWidgets);
    expect(find.text('¥786.00'), findsWidgets);
  });

  testWidgets('read-only finance workbench roles do not see confirm button',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpFinanceQuery(tester, apiClient, role: UserRole.boss);

    expect(
      find.byKey(
        const ValueKey(
          'finance-pending-after-sales-secondary-confirm-after-sales-1',
        ),
      ),
      findsNothing,
    );
    expect(find.text('待确认'), findsWidgets);

    await tester.ensureVisible(find.text('SO20260630001').first);
    await tester.tap(find.text('SO20260630001').first);
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('finance-save-button')), findsNothing);
    expect(
        find.byKey(const ValueKey('finance-logistics-no-field')), findsNothing);
    expect(apiClient.financePatchPaths, isEmpty);
  });
}

Future<void> _pumpFinanceQuery(
  WidgetTester tester,
  _FakeApiClient apiClient, {
  UserRole role = UserRole.finance,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: FinanceQueryPage(
          apiClient: apiClient,
          token: 'test-token',
          role: role,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

class _FakeApiClient extends ApiClient {
  _FakeApiClient({this.failFinancePatch = false})
      : super(baseUrl: 'http://127.0.0.1:3000');

  final bool failFinancePatch;
  final List<String> financeWorkbenchPaths = <String>[];
  final List<String> financePatchPaths = <String>[];
  final List<String> afterSalesConfirmPaths = <String>[];
  Map<String, dynamic>? lastFinanceBody;
  Map<String, dynamic>? lastAfterSalesConfirmBody;

  String logisticsNo = 'SF123456789';
  int logisticsFeeCents = 1800;
  bool invoiceIssued = false;
  String financeRemark = '待核对运费';
  bool afterSalesConfirmed = false;

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    if (path.startsWith('/api/finance/workbench')) {
      financeWorkbenchPaths.add(path);
      return {
        'data': {
          'workbench': {
            'metrics': {
              'travelGroupCount': 1,
              'orderCount': 1,
              'grossSalesAmountCents': 79800,
              'salesAmountCents': 79800,
              'refundAmountCents': afterSalesConfirmed ? 1200 : 0,
              'pendingAfterSalesRefundAmountCents':
                  afterSalesConfirmed ? 0 : 1200,
              'legacyRefundOrderAmountCents': 0,
              'netSalesAmountCents': afterSalesConfirmed ? 78600 : 79800,
              'logisticsFeeCents': logisticsFeeCents,
              'pendingInvoiceCount': invoiceIssued ? 0 : 1,
              'pendingCustomerMarkCount': 1,
              'pendingTravelGroupMarkCount': 0,
              'pendingAfterSalesConfirmCount': afterSalesConfirmed ? 0 : 1,
              'cashOnDeliveryAmountCents': 10000,
            },
            'recentOrders': [
              _orderJson(
                logisticsNo: logisticsNo,
                logisticsFeeCents: logisticsFeeCents,
                invoiceIssued: invoiceIssued,
                financeRemark: financeRemark,
              ),
            ],
            'pendingAfterSales':
                afterSalesConfirmed ? const [] : [_afterSalesJson()],
            'pendingMarks': [
              {
                'type': 'customer',
                'reason': 'customer_unmarked',
                'customer': {
                  'id': 'customer-1',
                  'name': '张女士',
                  'phone': '13800001111',
                  'financeMark': false,
                },
                'travelGroup': null,
                'orderCount': 1,
                'latestOrder': _orderJson(
                  logisticsNo: logisticsNo,
                  logisticsFeeCents: logisticsFeeCents,
                  invoiceIssued: invoiceIssued,
                  financeRemark: financeRemark,
                ),
              },
            ],
            'pendingLogistics': [
              {
                'order': _orderJson(
                  logisticsNo: logisticsNo,
                  logisticsFeeCents: logisticsFeeCents,
                  invoiceIssued: invoiceIssued,
                  financeRemark: financeRemark,
                ),
                'reasons': invoiceIssued
                    ? ['missing_logistics_no', 'missing_logistics_fee']
                    : [
                        'missing_logistics_no',
                        'missing_logistics_fee',
                        'pending_invoice',
                      ],
              },
            ],
          },
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
    if (path == '/api/sales-orders/order-1/finance') {
      financePatchPaths.add(path);
      lastFinanceBody = Map<String, dynamic>.from(body ?? {});
      if (failFinancePatch) {
        throw const ApiException(
          statusCode: 400,
          code: 'INVALID_LOGISTICS_FEE',
          message: '运费不能小于 0',
        );
      }
      logisticsNo = '${body?['logisticsNo'] ?? ''}';
      logisticsFeeCents = body?['logisticsFeeCents'] is int
          ? body!['logisticsFeeCents'] as int
          : logisticsFeeCents;
      invoiceIssued = body?['invoiceIssued'] == true;
      financeRemark = '${body?['financeRemark'] ?? ''}';
      return {
        'data': {
          'salesOrder': _orderJson(
            logisticsNo: logisticsNo,
            logisticsFeeCents: logisticsFeeCents,
            invoiceIssued: invoiceIssued,
            financeRemark: financeRemark,
          ),
        },
      };
    }

    if (path == '/api/after-sales-orders/after-sales-1/finance-confirm') {
      afterSalesConfirmPaths.add(path);
      lastAfterSalesConfirmBody = Map<String, dynamic>.from(body ?? {});
      afterSalesConfirmed = body?['financeConfirmed'] == true;
      return {
        'data': {
          'afterSalesOrder': _afterSalesJson(
            financeConfirmed: afterSalesConfirmed,
          ),
        },
      };
    }

    throw StateError('Unexpected PATCH $path');
  }
}

Map<String, dynamic> _orderJson({
  required String logisticsNo,
  required int logisticsFeeCents,
  required bool invoiceIssued,
  required String financeRemark,
}) {
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
    'status': 'valid',
    'deliverySummary': 'shipping',
    'packingStatus': 'pending',
    'logisticsMethod': '顺丰',
    'packageCount': 2,
    'warehouseRemark': '注意防震',
    'logisticsNo': logisticsNo,
    'logisticsFeeCents': logisticsFeeCents,
    'invoiceRequired': true,
    'invoiceIssued': invoiceIssued,
    'financeRemark': financeRemark,
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
    'financeMark': true,
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

Map<String, dynamic> _afterSalesJson({bool financeConfirmed = false}) {
  return {
    'id': 'after-sales-1',
    'afterSalesNo': 'AS20260702001',
    'salesOrderId': 'order-1',
    'salesOrder': _orderJson(
      logisticsNo: 'SF123456789',
      logisticsFeeCents: 1800,
      invoiceIssued: false,
      financeRemark: '待核对运费',
    ),
    'customerId': 'customer-1',
    'customer': _customerJson(),
    'issueType': 'quality_issue',
    'actionType': 'refund',
    'description': 'smoke 待确认退款',
    'resolution': 'smoke 退款 12 元',
    'refundAmountCents': 1200,
    'status': 'waiting_refund',
    'financeConfirmed': financeConfirmed,
    'createdAt': '2026-07-02T08:00:00.000Z',
    'updatedAt': '2026-07-02T08:00:00.000Z',
  };
}
