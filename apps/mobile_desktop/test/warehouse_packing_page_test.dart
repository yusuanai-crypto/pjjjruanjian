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
    expect(find.text('待配货'), findsWidgets);
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
    final packingMarkField = find.byKey(
      const ValueKey('warehouse-has-packing-mark-field'),
    );
    expect(tester.widget<SwitchListTile>(packingMarkField).value, isFalse);
    expect(find.text('否'), findsOneWidget);
    await tester.ensureVisible(packingMarkField);
    await tester.tap(packingMarkField);
    await tester.pumpAndSettle();
    expect(tester.widget<SwitchListTile>(packingMarkField).value, isTrue);
    expect(find.text('是'), findsOneWidget);

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
    await _confirmPacked(tester);

    expect(apiClient.packingPatchPaths,
        contains('/api/warehouse/orders/order-1/packing'));
    expect(apiClient.lastPackingBody?['logisticsMethod'], '顺丰');
    expect(apiClient.lastPackingBody?['packingStatus'], 'packed');
    expect(apiClient.lastPackingBody?['packageCount'], 3);
    expect(apiClient.lastPackingBody?['warehouseRemark'], '外箱加固');
    expect(apiClient.lastPackingBody?['hasPackingMark'], isTrue);
    expect(
        find.byKey(const ValueKey('warehouse-packing-editor')), findsNothing);
    expect(apiClient.warehouseOrderListPaths.length, greaterThan(1));
  });

  testWidgets('saves packing and refreshes when tracking number is empty',
      (tester) async {
    final apiClient = _FakeApiClient(logisticsNo: null);
    await _pumpWarehousePacking(tester, apiClient);

    expect(find.text('物流单号待补'), findsWidgets);
    await _openPackingEditor(tester);

    final saveButton = find.widgetWithText(FilledButton, '保存打包');
    await tester.ensureVisible(saveButton);
    await tester.tap(saveButton);
    await tester.pumpAndSettle();
    await _confirmPacked(tester);

    expect(apiClient.lastPackingBody?['packingStatus'], 'packed');
    expect(apiClient.lastPackingBody?.containsKey('logisticsNo'), isFalse);
    expect(
      find.byKey(const ValueKey('warehouse-packing-editor')),
      findsNothing,
    );
    expect(apiClient.warehouseOrderListPaths.length, greaterThan(1));
  });

  testWidgets('reopens a marked order and can save it as unmarked',
      (tester) async {
    final apiClient = _FakeApiClient(hasPackingMark: true);
    await _pumpWarehousePacking(tester, apiClient);
    await _openPackingEditor(tester);

    final packingMarkField = find.byKey(
      const ValueKey('warehouse-has-packing-mark-field'),
    );
    expect(tester.widget<SwitchListTile>(packingMarkField).value, isTrue);
    expect(find.text('是'), findsOneWidget);

    await tester.ensureVisible(packingMarkField);
    await tester.tap(packingMarkField);
    await tester.pumpAndSettle();
    expect(tester.widget<SwitchListTile>(packingMarkField).value, isFalse);
    expect(find.text('否'), findsOneWidget);

    final saveButton = find.widgetWithText(FilledButton, '保存打包');
    await tester.ensureVisible(saveButton);
    await tester.tap(saveButton);
    await tester.pumpAndSettle();
    await _confirmPacked(tester);

    expect(apiClient.lastPackingBody?['hasPackingMark'], isFalse);
    expect(apiClient.hasPackingMark, isFalse);
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

    final packingMarkField = find.byKey(
      const ValueKey('warehouse-has-packing-mark-field'),
    );
    await tester.ensureVisible(packingMarkField);
    await tester.tap(packingMarkField);
    await tester.pumpAndSettle();
    expect(tester.widget<SwitchListTile>(packingMarkField).value, isTrue);

    final saveButton = find.widgetWithText(FilledButton, '保存打包');
    await tester.ensureVisible(saveButton);
    await tester.pumpAndSettle();
    await tester.tap(saveButton);
    await tester.pumpAndSettle();
    await _confirmPacked(tester);

    expect(find.text('打包状态非法'), findsOneWidget);
    expect(
        find.byKey(const ValueKey('warehouse-packing-editor')), findsOneWidget);
    // 失败后重新拉取服务端真值，不能保留一个未生效的本地成功状态。
    expect(tester.widget<SwitchListTile>(packingMarkField).value, isFalse);
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
    final packingMarkField = find.byKey(
      const ValueKey('warehouse-has-packing-mark-field'),
    );
    final packingMarkTile = tester.widget<SwitchListTile>(packingMarkField);
    expect(packingMarkTile.value, isFalse);
    expect(packingMarkTile.onChanged, isNull);
    await tester.ensureVisible(packingMarkField);
    await tester.tap(packingMarkField);
    await tester.pumpAndSettle();
    expect(
      tester.widget<SwitchListTile>(packingMarkField).value,
      isFalse,
    );

    expect(apiClient.packingPatchPaths, isEmpty);
  });

  testWidgets('role switch reloads packing data with the new permissions',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpWarehousePacking(tester, apiClient);
    expect(apiClient.warehouseOrderListPaths, hasLength(1));

    await _pumpWarehousePacking(
      tester,
      apiClient,
      role: UserRole.boss,
    );
    expect(apiClient.warehouseOrderListPaths, hasLength(2));
    expect(find.text('只读'), findsWidgets);
    expect(find.widgetWithText(FilledButton, '保存打包'), findsNothing);
  });

  testWidgets('embedded wide workbench shows list and detail together',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    final apiClient = _FakeApiClient();

    await _pumpWarehousePacking(tester, apiClient, embedded: true);

    expect(
      find.byKey(const ValueKey('warehouse-order-order-1')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('warehouse-packing-editor')),
      findsOneWidget,
    );
    expect(find.text('商品需求与配货'), findsOneWidget);
    expect(find.text('普通商品自动出库'), findsOneWidget);
  });

  testWidgets('sales cannot enter workbench and makes zero API requests',
      (tester) async {
    final apiClient = _FakeApiClient();

    await _pumpWarehousePacking(
      tester,
      apiClient,
      role: UserRole.sales,
    );

    expect(find.textContaining('不能进入全量销售出库与配货工作台'), findsOneWidget);
    expect(apiClient.getCallCount, 0);
    expect(apiClient.warehouseOrderListPaths, isEmpty);
  });

  testWidgets(
      'serialized shipping selects only current warehouse bottles and submits assignments',
      (tester) async {
    final apiClient = _SerializedPackingApiClient();
    await _pumpWarehousePacking(tester, apiClient);
    await _openPackingEditor(tester, orderId: 'order-serialized');

    final picker = find.byKey(
      const ValueKey('warehouse-packing-pick-units-line-serialized-001'),
    );
    await tester.ensureVisible(picker);
    await tester.tap(picker);
    await tester.pumpAndSettle();

    final availableUri = Uri.parse(apiClient.availablePaths.single);
    expect(availableUri.queryParameters['warehouseId'], 'wh-001');
    expect(availableUri.queryParameters['productId'], 'product-serialized');
    expect(find.textContaining('¥'), findsNothing);
    expect(find.textContaining('987654'), findsNothing);

    tester
        .widget<CheckboxListTile>(
          find.byKey(const ValueKey('serialized-unit-unit-0001')),
        )
        .onChanged!(true);
    await tester.pump();
    tester
        .widget<CheckboxListTile>(
          find.byKey(const ValueKey('serialized-unit-unit-0002')),
        )
        .onChanged!(true);
    await tester.pump();
    final pickerConfirm = find.byKey(
      const ValueKey('serialized-inventory-confirm'),
    );
    tester.widget<FilledButton>(pickerConfirm).onPressed!.call();
    await tester.pumpAndSettle();

    final saveButton = find.widgetWithText(FilledButton, '保存打包');
    tester.widget<FilledButton>(saveButton).onPressed!.call();
    await tester.pumpAndSettle();
    await _confirmPacked(tester);

    final assignments =
        apiClient.lastPackingBody?['serializedAssignments'] as List;
    expect(assignments, hasLength(1));
    final assignment = assignments.single as Map;
    expect(assignment['inventoryLineKey'], 'line-serialized-001');
    expect(assignment['unitIds'], ['unit-0001', 'unit-0002']);
  });

  testWidgets('changing fulfillment warehouse confirms and uses packing API',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpWarehousePacking(tester, apiClient);
    await _openPackingEditor(tester);

    final changeButton = find.byKey(
      const ValueKey('warehouse-packing-change-warehouse'),
    );
    await tester.ensureVisible(changeButton);
    await tester.tap(changeButton);
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(
        const ValueKey(
          'warehouse-packing-change-warehouse-option-wh-002',
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('warehouse-packing-confirm-warehouse')),
    );
    await tester.pumpAndSettle();

    expect(
      apiClient.packingPatchPaths,
      contains('/api/warehouse/orders/order-1/packing'),
    );
    expect(apiClient.lastPackingBody, {'fulfillmentWarehouseId': 'wh-002'});
    expect(apiClient.warehouseOrderListPaths.length, greaterThan(1));
  });
}

Future<void> _openPackingEditor(
  WidgetTester tester, {
  String orderId = 'order-1',
}) async {
  final order = find.byKey(ValueKey('warehouse-order-$orderId'));
  await tester.ensureVisible(order);
  await tester.tap(order);
  await tester.pumpAndSettle();

  expect(
      find.byKey(const ValueKey('warehouse-packing-editor')), findsOneWidget);
}

Future<void> _confirmPacked(WidgetTester tester) async {
  final confirm =
      find.byKey(const ValueKey('warehouse-packing-confirm-packed'));
  expect(confirm, findsOneWidget);
  await tester.tap(confirm);
  await tester.pumpAndSettle();
}

Future<void> _pumpWarehousePacking(
  WidgetTester tester,
  ApiClient apiClient, {
  UserRole role = UserRole.warehouse,
  bool embedded = false,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: buildJiangjiuTheme(),
      home: Scaffold(
        body: WarehousePackingPage(
          apiClient: apiClient,
          token: 'test-token',
          role: role,
          embedded: embedded,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

class _FakeApiClient extends ApiClient {
  _FakeApiClient({
    this.failPackingPatch = false,
    this.hasPackingMark = false,
    this.logisticsNo = 'SF123456789',
  }) : super(baseUrl: 'http://127.0.0.1:3000');

  final bool failPackingPatch;
  final List<String> warehouseOrderListPaths = <String>[];
  final List<String> packingPatchPaths = <String>[];
  Map<String, dynamic>? lastPackingBody;
  int getCallCount = 0;

  String packingStatus = 'pending';
  int packageCount = 1;
  String warehouseRemark = '注意防震';
  String logisticsMethod = '顺丰';
  bool hasPackingMark;
  final String? logisticsNo;

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    getCallCount++;
    if (path.startsWith('/api/inventory/warehouses')) {
      return {
        'data': {
          'warehouses': [
            {
              'id': 'wh-001',
              'code': '001',
              'name': '一号仓',
              'address': '地址一',
              'isActive': true,
              'isDefault': true,
            },
            {
              'id': 'wh-002',
              'code': '002',
              'name': '二号仓',
              'address': '地址二',
              'isActive': true,
              'isDefault': false,
            },
          ],
          'pagination': {
            'page': 1,
            'pageSize': 100,
            'total': 2,
            'totalPages': 1,
          },
        },
      };
    }
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
                    hasPackingMark: hasPackingMark,
                    logisticsNo: logisticsNo,
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
      if (body?['hasPackingMark'] is bool) {
        hasPackingMark = body!['hasPackingMark'] as bool;
      }
      final responseOrder = _orderJson(
        packingStatus: packingStatus,
        packageCount: packageCount,
        warehouseRemark: warehouseRemark,
        logisticsMethod: logisticsMethod,
        hasPackingMark: hasPackingMark,
        logisticsNo: logisticsNo,
      );
      if (body?.containsKey('fulfillmentWarehouseId') == true) {
        responseOrder['fulfillmentWarehouseId'] =
            body!['fulfillmentWarehouseId'];
        responseOrder['fulfillmentWarehouseName'] = '二号仓';
      }
      return {
        'data': {
          'warehouseOrder': responseOrder,
        },
      };
    }

    throw StateError('Unexpected PATCH $path');
  }
}

class _SerializedPackingApiClient extends ApiClient {
  _SerializedPackingApiClient() : super(baseUrl: 'http://127.0.0.1:3000');

  final List<String> availablePaths = [];
  Map<String, dynamic>? lastPackingBody;
  String packingStatus = 'pending';

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    if (path == '/api/products/options') {
      return {
        'data': {
          'products': [
            {
              'id': 'product-serialized',
              'name': '测试茅台',
              'unit': '瓶',
              'inventoryTrackingMode': 'serialized',
            },
          ],
        },
      };
    }
    if (path.startsWith('/api/serialized-inventory/available')) {
      availablePaths.add(path);
      return {
        'data': {
          'units': [
            _availableUnit('unit-0001', '000000000001', '0001'),
            _availableUnit('unit-0002', '000000000002', '0002'),
          ],
        },
      };
    }
    if (path.startsWith('/api/warehouse/orders')) {
      final requested = Uri.parse(path).queryParameters['packingStatus'];
      final matched = requested == null || requested == packingStatus;
      return {
        'data': {
          'warehouseOrders':
              matched ? [_serializedOrder(packingStatus)] : const [],
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
    if (path == '/api/warehouse/orders/order-serialized/packing') {
      lastPackingBody = Map<String, dynamic>.from(body ?? const {});
      packingStatus = '${body?['packingStatus'] ?? packingStatus}';
      return {
        'data': {
          'warehouseOrder': _serializedOrder(
            packingStatus,
            assigned: true,
          ),
        },
      };
    }
    throw StateError('Unexpected PATCH $path');
  }
}

Map<String, dynamic> _availableUnit(
  String id,
  String logisticsCode,
  String serial,
) {
  return {
    'id': id,
    'productId': 'product-serialized',
    'productName': '测试茅台',
    'moutaiName': '测试茅台',
    'factoryDate': '2026-01-02',
    'productionBatch': '000123',
    'batchSerialNo': serial,
    'logisticsCode': logisticsCode,
    'purchaseCostCents': 987654,
    'status': 'available',
    'dataComplete': true,
  };
}

Map<String, dynamic> _serializedOrder(
  String packingStatus, {
  bool assigned = false,
}) {
  final order = _orderJson(
    packingStatus: packingStatus,
    packageCount: 1,
    warehouseRemark: '',
    logisticsMethod: '顺丰',
    hasPackingMark: false,
    logisticsNo: 'SF00000001',
  );
  order['id'] = 'order-serialized';
  order['orderNo'] = 'SO0000000001';
  order['fulfillmentWarehouseId'] = 'wh-001';
  order['fulfillmentWarehouseName'] = '一号仓';
  order['items'] = [
    {
      'id': 'item-serialized',
      'salesOrderId': 'order-serialized',
      'productId': 'product-serialized',
      'productName': '测试茅台',
      'unit': '瓶',
      'quantity': 2,
      'unitPriceCents': 39900,
      'subtotalCents': 79800,
      'deliveryType': 'shipping',
      'sortOrder': 1,
      'inventoryLineKey': 'line-serialized-001',
      'serializedFulfillment': {
        'status': assigned ? 'outbound' : 'reserved',
        'requestedQty': 2,
        'assignedQty': assigned ? 0 : 0,
        'outboundQty': assigned ? 2 : 0,
        'unassignedQty': assigned ? 0 : 2,
        'units': assigned
            ? [
                {
                  ..._availableUnit('unit-0001', '000000000001', '0001'),
                  'assignmentStatus': 'outbound',
                },
                {
                  ..._availableUnit('unit-0002', '000000000002', '0002'),
                  'assignmentStatus': 'outbound',
                },
              ]
            : const [],
      },
    },
  ];
  return order;
}

Map<String, dynamic> _orderJson({
  required String packingStatus,
  required int packageCount,
  required String warehouseRemark,
  required String logisticsMethod,
  required bool hasPackingMark,
  required String? logisticsNo,
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
    'hasPackingMark': hasPackingMark,
    'logisticsNo': logisticsNo,
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
