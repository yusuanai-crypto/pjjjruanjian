import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/app/theme.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/warehouse/warehouse_packing_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets('loads shipping orders with packing filters', (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpWarehousePacking(tester, apiClient);

    var uri = Uri.parse(apiClient.warehouseOrderListPaths.last);
    expect(uri.path, '/api/warehouse/orders');
    expect(uri.queryParameters['packingStatus'], 'pending');
    expect(uri.queryParameters['limit'], '100');

    final expectedForegroundColor = buildJiangjiuTheme().colorScheme.onSurface;
    const filterStates = <Set<WidgetState>>[
      <WidgetState>{},
      <WidgetState>{WidgetState.selected},
      <WidgetState>{WidgetState.hovered},
      <WidgetState>{WidgetState.focused},
      <WidgetState>{WidgetState.disabled},
      <WidgetState>{WidgetState.selected, WidgetState.disabled},
    ];
    for (final status in PackingStatus.values) {
      final chip = tester.widget<FilterChip>(
        find.byKey(ValueKey('warehouse-packing-filter-${status.value}')),
      );
      final labelColor = chip.labelStyle?.color;
      expect(labelColor, isA<WidgetStateColor>());
      for (final states in filterStates) {
        expect(
          (labelColor! as WidgetStateColor).resolve(states),
          expectedForegroundColor,
        );
      }
      expect(chip.checkmarkColor, expectedForegroundColor);
    }

    await tester.enterText(
      find.byKey(const ValueKey('warehouse-packing-search-field')),
      'SO20260630001',
    );
    await tester.tap(
      find.byKey(const ValueKey('warehouse-packing-search-button')),
    );
    await tester.pumpAndSettle();

    uri = Uri.parse(apiClient.warehouseOrderListPaths.last);
    expect(uri.queryParameters['query'], 'SO20260630001');

    await tester.tap(
      find.byKey(const ValueKey('warehouse-logistics-method-filter')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('顺丰').last);
    await tester.pumpAndSettle();

    uri = Uri.parse(apiClient.warehouseOrderListPaths.last);
    expect(uri.queryParameters['logisticsMethod'], '顺丰');

    for (final status in [
      PackingStatus.packing,
      PackingStatus.packed,
      PackingStatus.abnormal,
    ]) {
      await tester.tap(
        find.byKey(ValueKey('warehouse-packing-filter-${status.value}')),
      );
      await tester.pumpAndSettle();
      uri = Uri.parse(apiClient.warehouseOrderListPaths.last);
      expect(uri.queryParameters['packingStatus'], status.value);
    }
  });

  testWidgets('opens packing editor and saves packing fields', (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpWarehousePacking(tester, apiClient);

    expect(find.text('SO20260630001'), findsWidgets);
    expect(find.textContaining('张女士'), findsWidgets);
    expect(find.textContaining('贵州省贵阳市观山湖区测试路 1 号'), findsWidgets);
    expect(find.textContaining('酱香珍藏 x2'), findsWidgets);
    expect(find.text('物流单号已补'), findsWidgets);
    expect(find.text('待打包'), findsWidgets);
    expect(
        find.byKey(const ValueKey('warehouse-packing-editor')), findsNothing);
    expect(find.byKey(const ValueKey('warehouse-package-count-field')),
        findsNothing);

    await _openPackingEditor(tester);

    expect(find.text('订单核对/打包处理'), findsOneWidget);
    expect(find.text('订单号'), findsOneWidget);
    expect(find.text('电话'), findsWidgets);
    expect(
      find.byKey(const ValueKey('warehouse-packing-status-field')),
      findsNothing,
    );
    expect(
      find.widgetWithText(OutlinedButton, '标记异常'),
      findsNothing,
    );

    await tester.ensureVisible(
      find.byKey(const ValueKey('warehouse-package-count-field')),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('warehouse-package-count-field')),
      '3',
    );
    await tester.ensureVisible(
      find.byKey(const ValueKey('warehouse-remark-field')),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('warehouse-remark-field')),
      '外箱加固',
    );

    final saveButton = find.widgetWithText(FilledButton, '保存打包');
    await tester.ensureVisible(saveButton);
    await tester.pumpAndSettle();
    await tester.tap(saveButton);
    await tester.pumpAndSettle();

    expect(apiClient.packingPatchPaths,
        contains('/api/warehouse/orders/order-1/packing'));
    expect(apiClient.lastPackingBody?['logisticsMethod'], '顺丰');
    expect(apiClient.lastPackingBody?['packingStatus'], 'packed');
    expect(apiClient.lastPackingBody?['packageCount'], 3);
    expect(apiClient.lastPackingBody?['warehouseRemark'], '外箱加固');
    expect(
        find.byKey(const ValueKey('warehouse-packing-editor')), findsNothing);
    expect(apiClient.warehouseOrderListPaths.length, greaterThan(1));
  });

  testWidgets('highlights abnormal orders in the queue', (tester) async {
    final apiClient = _FakeApiClient()..packingStatus = 'abnormal';
    await _pumpWarehousePacking(tester, apiClient);

    await tester.tap(
      find.byKey(const ValueKey('warehouse-packing-filter-abnormal')),
    );
    await tester.pumpAndSettle();

    expect(
        find.byKey(const ValueKey('warehouse-order-order-1')), findsOneWidget);
    expect(find.text('异常'), findsWidgets);
    expect(find.byIcon(Icons.report_problem_rounded), findsWidgets);
  });

  testWidgets('shows API error when packing save fails', (tester) async {
    final apiClient = _FakeApiClient(failPackingPatch: true);
    await _pumpWarehousePacking(tester, apiClient);
    await _openPackingEditor(tester);

    final saveButton = find.widgetWithText(FilledButton, '保存打包');
    await tester.ensureVisible(saveButton);
    await tester.pumpAndSettle();
    await tester.tap(saveButton);
    await tester.pumpAndSettle();

    expect(find.text('打包状态非法'), findsOneWidget);
    expect(
        find.byKey(const ValueKey('warehouse-packing-editor')), findsOneWidget);
  });

  testWidgets('boss can inspect warehouse orders without packing buttons',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpWarehousePacking(tester, apiClient, role: UserRole.boss);

    expect(find.text('SO20260630001'), findsWidgets);
    expect(find.text('只读'), findsWidgets);
    expect(find.widgetWithText(FilledButton, '保存打包'), findsNothing);
    expect(find.widgetWithText(OutlinedButton, '标记异常'), findsNothing);
    expect(find.byKey(const ValueKey('warehouse-package-count-field')),
        findsNothing);

    await _openPackingEditor(tester);

    expect(find.widgetWithText(FilledButton, '保存打包'), findsNothing);
    expect(find.widgetWithText(OutlinedButton, '标记异常'), findsNothing);

    final packageField = tester.widget<TextField>(
      find.byKey(const ValueKey('warehouse-package-count-field')),
    );
    final remarkField = tester.widget<TextField>(
      find.byKey(const ValueKey('warehouse-remark-field')),
    );
    expect(packageField.readOnly, isTrue);
    expect(remarkField.readOnly, isTrue);
    expect(
      find.byKey(const ValueKey('warehouse-packing-status-field')),
      findsNothing,
    );
    final logisticsDropdown = tester.widget<DropdownButton<String>>(
      find.descendant(
        of: find.byKey(const ValueKey('warehouse-logistics-method-field')),
        matching: find.byWidgetPredicate(
          (widget) => widget is DropdownButton<String>,
        ),
      ),
    );
    expect(logisticsDropdown.onChanged, isNull);

    expect(apiClient.packingPatchPaths, isEmpty);
  });
}

Future<void> _openPackingEditor(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('warehouse-order-order-1')));
  await tester.pumpAndSettle();

  expect(
      find.byKey(const ValueKey('warehouse-packing-editor')), findsOneWidget);
}

Future<void> _pumpWarehousePacking(
  WidgetTester tester,
  _FakeApiClient apiClient, {
  UserRole role = UserRole.warehouse,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: buildJiangjiuTheme(),
      home: Scaffold(
        body: WarehousePackingPage(
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
  _FakeApiClient({this.failPackingPatch = false})
      : super(baseUrl: 'http://127.0.0.1:3000');

  final bool failPackingPatch;
  final List<String> warehouseOrderListPaths = <String>[];
  final List<String> packingPatchPaths = <String>[];
  Map<String, dynamic>? lastPackingBody;

  String packingStatus = 'pending';
  int packageCount = 1;
  String warehouseRemark = '注意防震';
  String logisticsMethod = '顺丰';

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    if (path.startsWith('/api/warehouse/orders')) {
      warehouseOrderListPaths.add(path);
      final uri = Uri.parse(path);
      final requestedStatus =
          uri.queryParameters['packingStatus'] ?? packingStatus;
      final requestedLogisticsMethod = uri.queryParameters['logisticsMethod'];
      final statusMatched = requestedStatus == packingStatus;
      final logisticsMethodMatched = requestedLogisticsMethod == null ||
          requestedLogisticsMethod == logisticsMethod;
      return {
        'data': {
          'warehouseOrders': statusMatched && logisticsMethodMatched
              ? [
                  _orderJson(
                    packingStatus: packingStatus,
                    packageCount: packageCount,
                    warehouseRemark: warehouseRemark,
                    logisticsMethod: logisticsMethod,
                  ),
                ]
              : const [],
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
    if (path == '/api/warehouse/orders/order-1/packing') {
      packingPatchPaths.add(path);
      lastPackingBody = Map<String, dynamic>.from(body ?? {});
      if (failPackingPatch) {
        throw const ApiException(
          statusCode: 400,
          code: 'INVALID_PACKING_STATUS',
          message: '打包状态非法',
        );
      }
      packingStatus = '${body?['packingStatus'] ?? packingStatus}';
      packageCount = body?['packageCount'] is int
          ? body!['packageCount'] as int
          : packageCount;
      warehouseRemark = '${body?['warehouseRemark'] ?? warehouseRemark}';
      logisticsMethod = '${body?['logisticsMethod'] ?? logisticsMethod}';
      return {
        'data': {
          'warehouseOrder': _orderJson(
            packingStatus: packingStatus,
            packageCount: packageCount,
            warehouseRemark: warehouseRemark,
            logisticsMethod: logisticsMethod,
          ),
        },
      };
    }

    throw StateError('Unexpected PATCH $path');
  }
}

Map<String, dynamic> _orderJson({
  required String packingStatus,
  required int packageCount,
  required String warehouseRemark,
  required String logisticsMethod,
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
    'packingStatus': packingStatus,
    'logisticsMethod': logisticsMethod,
    'packageCount': packageCount,
    'warehouseRemark': warehouseRemark,
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
