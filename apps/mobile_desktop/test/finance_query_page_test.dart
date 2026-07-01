import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/finance/finance_query_page.dart';

void main() {
  testWidgets('shows phase 4 finance fields and saves finance updates',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpFinanceQuery(tester, apiClient);

    expect(find.text('SO20260630001'), findsWidgets);
    expect(find.text('客户已标记'), findsWidgets);
    expect(find.text('物流单号 SF123456789'), findsOneWidget);
    expect(find.text('运费 ¥18.00'), findsOneWidget);
    expect(find.text('待开票'), findsOneWidget);

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
}

Future<void> _pumpFinanceQuery(
  WidgetTester tester,
  _FakeApiClient apiClient,
) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: FinanceQueryPage(
          apiClient: apiClient,
          token: 'test-token',
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
  final List<String> financeOverviewPaths = <String>[];
  final List<String> financePatchPaths = <String>[];
  Map<String, dynamic>? lastFinanceBody;

  String logisticsNo = 'SF123456789';
  int logisticsFeeCents = 1800;
  bool invoiceIssued = false;
  String financeRemark = '待核对运费';

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    if (path.startsWith('/api/finance/overview')) {
      financeOverviewPaths.add(path);
      return {
        'data': {
          'overview': {
            'metrics': {
              'travelGroupCount': 1,
              'orderCount': 1,
              'salesAmountCents': 79800,
              'refundAmountCents': 0,
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
