import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/business/business_api.dart';
import 'package:jiangjiu_mobile_desktop/features/moutai_inventory/moutai_inventory_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets(
      'page title, role cost visibility and batch selection are correct',
      (tester) async {
    tester.view.physicalSize = const Size(1500, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final adminClient = _FakeInventoryApiClient();
    await tester.pumpWidget(_page(adminClient, UserRole.admin));
    await tester.pumpAndSettle();
    expect(find.text('茅台'), findsOneWidget);
    expect(find.text('进货价'), findsOneWidget);
    expect(find.text(formatMoneyCents(123456)), findsWidgets);
    expect(
      find.byKey(const ValueKey('moutai-inbound-button')),
      findsOneWidget,
    );

    await tester.tap(find.byKey(const Key('moutai-select-all')));
    await tester.pump();
    expect(find.text('已选择 2 瓶'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('moutai-select-unit-1')));
    await tester.pump();
    expect(find.text('已选择 1 瓶'), findsOneWidget);

    final warehouseClient = _FakeInventoryApiClient();
    await tester.pumpWidget(_page(warehouseClient, UserRole.warehouse));
    await tester.pumpAndSettle();
    expect(find.text('茅台'), findsOneWidget);
    expect(find.text('进货价'), findsNothing);
    expect(find.text(formatMoneyCents(123456)), findsNothing);
    expect(
      find.byKey(const ValueKey('moutai-inbound-button')),
      findsOneWidget,
    );
  });

  testWidgets('finance can maintain cost but cannot create inventory units',
      (tester) async {
    tester.view.physicalSize = const Size(1500, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      _page(_FakeInventoryApiClient(), UserRole.finance),
    );
    await tester.pumpAndSettle();

    expect(find.text('进货价'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('moutai-inbound-button')),
      findsNothing,
    );
  });

  testWidgets('serialized product options appear in the inbound product picker',
      (tester) async {
    tester.view.physicalSize = const Size(1500, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final client = _FakeInventoryApiClient();
    await tester.pumpWidget(_page(client, UserRole.admin));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('moutai-inbound-button')),
    );
    await tester.pumpAndSettle();

    expect(find.text('茅台逐瓶入库'), findsOneWidget);
    expect(find.text('测试逐瓶商品 · 瓶'), findsOneWidget);
    expect(client.productOptionCalls, 1);
  });

  testWidgets('inbound picker selects the active default warehouse',
      (tester) async {
    _setDesktopView(tester);
    final client = _FakeInventoryApiClient();

    await _openInboundDialog(tester, client);

    expect(
      _dropdownValue(tester, const ValueKey('moutai-inbound-warehouse')),
      'warehouse-default',
    );
    expect(find.text('默认仓 · WH-001'), findsOneWidget);
    expect(find.text('备用仓 · WH-002'), findsNothing);
    expect(client.lastWarehousePath, contains('isActive=true'));
  });

  testWidgets('inbound request includes the selected default warehouse id',
      (tester) async {
    _setDesktopView(tester);
    final client = _FakeInventoryApiClient();
    await _openInboundDialog(tester, client);

    await tester.enterText(
      find.byKey(const Key('moutai-inbound-rows')),
      'LOG-001,0001',
    );
    await tester.tap(find.widgetWithText(FilledButton, '确认入库'));
    await tester.pumpAndSettle();

    expect(client.serializedBatchPostCalls, 1);
    expect(client.lastSerializedBatchBody?['warehouseId'], 'warehouse-default');
    expect(client.lastSerializedBatchBody?['productId'], 'product-serialized');
  });

  testWidgets('inbound request uses the warehouse selected by the user',
      (tester) async {
    _setDesktopView(tester);
    final client = _FakeInventoryApiClient();
    await _openInboundDialog(tester, client);

    await tester.tap(
      find.byKey(const ValueKey('moutai-inbound-warehouse')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('备用仓 · WH-002').last);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('moutai-inbound-rows')),
      'LOG-002,0002',
    );
    await tester.tap(find.widgetWithText(FilledButton, '确认入库'));
    await tester.pumpAndSettle();

    expect(client.serializedBatchPostCalls, 1);
    expect(client.lastSerializedBatchBody?['warehouseId'], 'warehouse-other');
  });

  testWidgets('warehouse must be explicitly selected when none is default',
      (tester) async {
    _setDesktopView(tester);
    final client = _FakeInventoryApiClient(
      warehouses: [
        _warehouse('warehouse-a', 'WH-A', '甲仓'),
        _warehouse('warehouse-b', 'WH-B', '乙仓'),
      ],
    );
    await _openInboundDialog(tester, client);

    expect(
      _dropdownValue(tester, const ValueKey('moutai-inbound-warehouse')),
      isNull,
    );
    await tester.enterText(
      find.byKey(const Key('moutai-inbound-rows')),
      'LOG-003,0003',
    );
    await tester.tap(find.widgetWithText(FilledButton, '确认入库'));
    await tester.pump();

    expect(client.serializedBatchPostCalls, 0);
    expect(find.text('请选择入库仓库'), findsOneWidget);
  });

  testWidgets('inbound is disabled when there are no active warehouses',
      (tester) async {
    _setDesktopView(tester);
    final client = _FakeInventoryApiClient(
      warehouses: [
        _warehouse(
          'warehouse-inactive',
          'WH-OFF',
          '停用仓',
          isActive: false,
        ),
      ],
    );
    await _openInboundDialog(tester, client);

    expect(
      find.text('没有可用的入库仓库，请先在仓库设置中启用仓库'),
      findsOneWidget,
    );
    expect(find.textContaining('停用仓'), findsNothing);
    final submit = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, '确认入库'),
    );
    expect(submit.onPressed, isNull);
    expect(client.serializedBatchPostCalls, 0);
  });

  testWidgets('warehouse load failure is understandable and can be retried',
      (tester) async {
    _setDesktopView(tester);
    final client = _FakeInventoryApiClient(warehouseFailures: 1);
    await _openInboundDialog(tester, client);

    expect(find.textContaining('入库仓库加载失败'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('moutai-inbound-warehouse-retry')),
      findsOneWidget,
    );
    await tester.tap(
      find.byKey(const ValueKey('moutai-inbound-warehouse-retry')),
    );
    await tester.pumpAndSettle();

    expect(client.warehouseCalls, 2);
    expect(
      _dropdownValue(tester, const ValueKey('moutai-inbound-warehouse')),
      'warehouse-default',
    );
  });

  testWidgets('expanded serialized statuses use stable Chinese labels',
      (tester) async {
    tester.view.physicalSize = const Size(1500, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      _page(
        _FakeInventoryApiClient(status: 'outbound'),
        UserRole.warehouse,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('已出库'), findsWidgets);
  });

  testWidgets('role switch clears selected units and reloads cost projection',
      (tester) async {
    tester.view.physicalSize = const Size(1500, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final client = _FakeInventoryApiClient();

    await tester.pumpWidget(_page(client, UserRole.finance));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('moutai-select-unit-1')));
    await tester.pump();
    expect(find.text('已选择 1 瓶'), findsOneWidget);
    expect(find.text('进货价'), findsOneWidget);

    await tester.pumpWidget(_page(client, UserRole.warehouse));
    await tester.pumpAndSettle();
    expect(client.getCalls, 2);
    expect(find.text('已选择 0 瓶'), findsOneWidget);
    expect(find.text('进货价'), findsNothing);
    expect(find.text(formatMoneyCents(123456)), findsNothing);
  });

  testWidgets(
      'no selection prompts and successful export uses injected save path',
      (tester) async {
    tester.view.physicalSize = const Size(1500, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    const target = r'C:\Temp\物流单.docx';
    String? savedPath;
    List<int>? savedBytes;
    final client = _FakeInventoryApiClient();

    await tester.pumpWidget(
      _page(
        client,
        UserRole.finance,
        savePathPicker: (_) async => target,
        fileWriter: (path, bytes) async {
          savedPath = path;
          savedBytes = List<int>.from(bytes);
        },
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('moutai-export-button')));
    await tester.pump();
    expect(find.text('请先勾选需要导出的茅台。'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('moutai-select-unit-2')));
    await tester.tap(find.byKey(const Key('moutai-export-button')));
    await tester.pumpAndSettle();

    expect(client.exportCalls, 1);
    expect(client.exportedUnitIds, ['unit-2']);
    expect(savedPath, target);
    expect(savedBytes, [1, 2, 3, 4]);
    expect(find.text('已保存到：$target'), findsOneWidget);
  });

  testWidgets('export prevents duplicate clicks and exposes Chinese API errors',
      (tester) async {
    tester.view.physicalSize = const Size(1500, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final completer = Completer<ApiDownloadedFile>();
    final client = _FakeInventoryApiClient()..pendingExport = completer;
    await tester.pumpWidget(
      _page(
        client,
        UserRole.admin,
        savePathPicker: (_) async => null,
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('moutai-select-unit-1')));
    await tester.tap(find.byKey(const Key('moutai-export-button')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('moutai-export-button')));
    await tester.pump();
    expect(client.exportCalls, 1);
    expect(find.text('正在生成…'), findsOneWidget);

    completer.complete(
      ApiDownloadedFile(
        bytes: Uint8List.fromList([9]),
        contentType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileName: '茅台物流单.docx',
      ),
    );
    await tester.pumpAndSettle();

    client
      ..pendingExport = null
      ..exportError = const ApiException(
        statusCode: 400,
        code: 'SERIALIZED_INVENTORY_DATA_INCOMPLETE',
        message: 'raw detail',
      );
    await tester.tap(find.byKey(const Key('moutai-export-button')));
    await tester.pumpAndSettle();
    expect(find.text('所选库存资料不完整，无法导出。'), findsOneWidget);
  });

  testWidgets('mobile uses cards and keeps logistics codes readable',
      (tester) async {
    tester.view.physicalSize = const Size(360, 740);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      _page(_FakeInventoryApiClient(), UserRole.warehouse),
    );
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('moutai-mobile-card-list')),
      findsOneWidget,
    );
    expect(find.byType(DataTable), findsNothing);
    expect(find.textContaining('物流码 000001'), findsOneWidget);
    expect(find.text('进货价'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('unauthorized role makes zero serialized inventory requests',
      (tester) async {
    final client = _FakeInventoryApiClient();
    await tester.pumpWidget(_page(client, UserRole.sales));
    await tester.pumpAndSettle();

    expect(find.textContaining('不能进入全量逐瓶库存页面'), findsOneWidget);
    expect(client.getCalls, 0);
  });

  test('warehouse DTO projection drops cost returned by the server', () async {
    final client = _FakeInventoryApiClient();
    final page = await BusinessApi(apiClient: client, token: 'token')
        .listSerializedInventory(includeCost: false);

    expect(page.units, isNotEmpty);
    expect(page.units.every((unit) => unit.purchaseCostCents == null), isTrue);
  });

  testWidgets('stale serialized response cannot overwrite newer filters',
      (tester) async {
    final client = _DelayedInventoryApiClient();
    await tester.pumpWidget(_page(client, UserRole.warehouse));
    await tester.pump();
    expect(client.requests, hasLength(1));

    await tester.tap(find.widgetWithText(FilledButton, '查询'));
    await tester.pump();
    expect(client.requests, hasLength(2));

    client.requests[1].complete(_serializedPayload('最新结果', '000009'));
    await tester.pump();
    expect(find.text('最新结果'), findsOneWidget);

    client.requests[0].complete(_serializedPayload('过期结果', '000001'));
    await tester.pump();
    expect(find.text('最新结果'), findsOneWidget);
    expect(find.text('过期结果'), findsNothing);
  });
}

Widget _page(
  ApiClient client,
  UserRole role, {
  MoutaiSavePathPicker? savePathPicker,
  MoutaiFileWriter? fileWriter,
}) {
  return MaterialApp(
    home: MoutaiInventoryPage(
      apiClient: client,
      token: 'token',
      role: role,
      savePathPicker: savePathPicker,
      fileWriter: fileWriter,
    ),
  );
}

void _setDesktopView(WidgetTester tester) {
  tester.view.physicalSize = const Size(1500, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _openInboundDialog(
  WidgetTester tester,
  _FakeInventoryApiClient client,
) async {
  await tester.pumpWidget(_page(client, UserRole.admin));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const ValueKey('moutai-inbound-button')));
  await tester.pumpAndSettle();
  expect(find.text('茅台逐瓶入库'), findsOneWidget);
}

String? _dropdownValue(WidgetTester tester, Key key) {
  return tester.state<FormFieldState<String>>(find.byKey(key)).value;
}

class _FakeInventoryApiClient extends ApiClient {
  _FakeInventoryApiClient({
    this.status = 'available',
    List<Map<String, dynamic>>? warehouses,
    int warehouseFailures = 0,
  })  : warehouses = warehouses ??
            [
              _warehouse(
                'warehouse-default',
                'WH-001',
                '默认仓',
                isDefault: true,
              ),
              _warehouse('warehouse-other', 'WH-002', '备用仓'),
            ],
        warehouseFailuresRemaining = warehouseFailures,
        super(baseUrl: 'http://127.0.0.1:3000');

  final String status;
  final List<Map<String, dynamic>> warehouses;
  int exportCalls = 0;
  int getCalls = 0;
  int productOptionCalls = 0;
  int warehouseCalls = 0;
  int warehouseFailuresRemaining;
  int serializedBatchPostCalls = 0;
  String? lastWarehousePath;
  Map<String, dynamic>? lastSerializedBatchBody;
  List<String> exportedUnitIds = const [];
  Completer<ApiDownloadedFile>? pendingExport;
  ApiException? exportError;

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    if (path.startsWith('/api/inventory/warehouses?')) {
      warehouseCalls += 1;
      lastWarehousePath = path;
      if (warehouseFailuresRemaining > 0) {
        warehouseFailuresRemaining -= 1;
        throw StateError('warehouse request failed');
      }
      return {
        'data': {
          'warehouses': warehouses,
          'pagination': {
            'page': 1,
            'pageSize': 100,
            'total': warehouses.length,
            'totalPages': 1,
          },
        },
      };
    }
    if (path == '/api/products/options') {
      productOptionCalls += 1;
      return {
        'data': {
          'products': [
            {
              'id': 'product-serialized',
              'name': '测试逐瓶商品',
              'unit': '瓶',
              'inventoryTrackingMode': 'serialized',
            },
          ],
        },
      };
    }
    if (path.startsWith('/api/serialized-inventory')) {
      getCalls += 1;
      return {
        'data': {
          'units': [
            _unit('unit-1', '000001', status: status),
            _unit('unit-2', '000002', status: status),
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
    throw StateError('Unexpected GET $path');
  }

  @override
  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    if (path == '/api/serialized-inventory/batch') {
      serializedBatchPostCalls += 1;
      lastSerializedBatchBody = Map<String, dynamic>.from(body ?? const {});
      return {
        'data': {'units': <Map<String, dynamic>>[]},
      };
    }
    throw StateError('Unexpected POST $path');
  }

  @override
  Future<ApiDownloadedFile> postBytes(
    String path, {
    required Map<String, dynamic> body,
    required String defaultFileName,
    String? token,
  }) async {
    exportCalls += 1;
    exportedUnitIds =
        (body['unitIds'] as List<dynamic>).map((id) => '$id').toList();
    if (exportError != null) throw exportError!;
    if (pendingExport != null) return pendingExport!.future;
    return ApiDownloadedFile(
      bytes: Uint8List.fromList([1, 2, 3, 4]),
      contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: '茅台物流单_20260723_共1瓶.docx',
    );
  }
}

Map<String, dynamic> _warehouse(
  String id,
  String code,
  String name, {
  bool isActive = true,
  bool isDefault = false,
}) {
  return {
    'id': id,
    'code': code,
    'name': name,
    'address': '',
    'manager': null,
    'isActive': isActive,
    'isDefault': isDefault,
    'parentWarehouse': null,
  };
}

class _DelayedInventoryApiClient extends ApiClient {
  _DelayedInventoryApiClient() : super(baseUrl: 'http://127.0.0.1:3000');

  final List<Completer<Map<String, dynamic>>> requests = [];

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) {
    if (!path.startsWith('/api/serialized-inventory')) {
      throw StateError('Unexpected GET $path');
    }
    final completer = Completer<Map<String, dynamic>>();
    requests.add(completer);
    return completer.future;
  }
}

Map<String, dynamic> _serializedPayload(
  String productName,
  String logisticsCode,
) {
  final unit = _unit('delayed-unit', logisticsCode);
  unit['moutaiName'] = productName;
  return {
    'data': {
      'units': [unit],
      'pagination': {
        'page': 1,
        'pageSize': 100,
        'total': 1,
        'totalPages': 1,
      },
    },
  };
}

Map<String, dynamic> _unit(
  String id,
  String logisticsCode, {
  String status = 'available',
}) {
  return {
    'id': id,
    'productId': 'product-moutai',
    'productName': '茅台',
    'moutaiName': id == 'unit-1' ? '飞天茅台' : '2024龙年生肖茅台',
    'factoryDate': '2024-01-02',
    'productionBatch': '00001',
    'batchSerialNo': '00002',
    'logisticsCode': logisticsCode,
    'purchaseCostCents': 123456,
    'status': status,
    'dataComplete': true,
    'salesOrder': null,
    'createdAt': '2026-07-23T00:00:00.000Z',
    'updatedAt': '2026-07-23T00:00:00.000Z',
  };
}
