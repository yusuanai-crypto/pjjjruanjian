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

class _FakeInventoryApiClient extends ApiClient {
  _FakeInventoryApiClient({this.status = 'available'})
      : super(baseUrl: 'http://127.0.0.1:3000');

  final String status;
  int exportCalls = 0;
  int getCalls = 0;
  List<String> exportedUnitIds = const [];
  Completer<ApiDownloadedFile>? pendingExport;
  ApiException? exportError;

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
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
