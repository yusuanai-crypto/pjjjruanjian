import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/business/business_api.dart';
import 'package:jiangjiu_mobile_desktop/core/business/inventory_api.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_group_attachments/downloaded_file_service.dart';
import 'package:jiangjiu_mobile_desktop/features/warehouse_management/inventory_workspace_tabs.dart';

class _QueryAnalysisApiClient extends ApiClient {
  _QueryAnalysisApiClient({
    this.failExport = false,
    this.reportRows = const [],
    this.reportColumns = const [],
    this.movements = const [],
  }) : super(baseUrl: 'http://127.0.0.1:3000');

  final bool failExport;
  final List<Map<String, dynamic>> reportRows;
  final List<Map<String, dynamic>> reportColumns;
  final List<Map<String, dynamic>> movements;
  final List<String> requestedPaths = [];

  Map<String, dynamic> _pagination(int total) => {
        'page': 1,
        'pageSize': 30,
        'total': total,
        'totalPages': total == 0 ? 0 : 1,
      };

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    requestedPaths.add(path);
    if (path.startsWith('/api/inventory/warehouses')) {
      return {
        'data': {
          'warehouses': [
            {
              'id': 'wh-01',
              'code': '001',
              'name': '一号仓',
              'isActive': true,
              'isDefault': true,
            },
          ],
          'pagination': _pagination(1),
        },
      };
    }
    if (path == '/api/products/options') {
      return {
        'data': {
          'products': [
            {
              'id': 'product-01',
              'name': '测试商品',
              'unit': '瓶',
              'inventoryTrackingMode': 'quantity',
              'isActive': true,
            },
          ],
        },
      };
    }
    if (path.startsWith('/api/inventory/alert-configs')) {
      return {
        'data': {
          'alertConfigs': const <Map<String, dynamic>>[],
          'pagination': _pagination(0),
        },
      };
    }
    if (path.startsWith('/api/inventory/movements')) {
      return {
        'data': {
          'movements': movements,
          'pagination': _pagination(movements.length),
        },
      };
    }
    if (path.startsWith('/api/inventory/reports/')) {
      final reportType =
          Uri.parse(path).pathSegments[3].replaceAll('.xlsx', '');
      return {
        'data': {
          'reportType': reportType,
          'columns': reportColumns,
          'rows': reportRows,
          'pagination': _pagination(reportRows.length),
        },
      };
    }
    throw StateError('Unexpected GET $path');
  }

  @override
  Future<ApiDownloadedFile> getBytes(
    String path, {
    required String defaultFileName,
    String? token,
  }) async {
    requestedPaths.add(path);
    if (failExport) {
      throw const ApiException(
        statusCode: 409,
        code: 'INVENTORY_REPORT_EXPORT_DATA_CHANGED',
        message: 'data changed',
      );
    }
    return ApiDownloadedFile(
      bytes: Uint8List.fromList([1, 2, 3]),
      fileName: '服务端库存报表-001.xlsx',
      contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }
}

class _RecordingDesktopSaver implements DesktopDownloadSaver {
  _RecordingDesktopSaver({this.gate});

  final Completer<void>? gate;
  String? fileName;
  Uint8List? bytes;

  @override
  Future<String?> save({
    required String fileName,
    required Uint8List bytes,
  }) async {
    this.fileName = fileName;
    this.bytes = bytes;
    await gate?.future;
    return 'D:\\下载\\$fileName';
  }
}

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Size size = const Size(1440, 900),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  await tester.pumpWidget(
    MaterialApp(
        home: Scaffold(
            body: Padding(padding: const EdgeInsets.all(8), child: child))),
  );
  await tester.pumpAndSettle();
}

InventoryApi _inventoryApi(
  _QueryAnalysisApiClient client,
  UserRole role,
) {
  return InventoryApi(
    apiClient: client,
    token: 'token',
    role: role,
  );
}

BusinessApi _businessApi(_QueryAnalysisApiClient client) {
  return BusinessApi(apiClient: client, token: 'token');
}

void main() {
  group('report column safety', () {
    test('warehouse drops unknown and cost columns', () {
      final columns = safeInventoryReportColumns(
        'warehouse-balances',
        const [
          ReportColumn(key: 'warehouseName', label: '篡改标签', type: 'text'),
          ReportColumn(
            key: 'inventoryAmountCents',
            label: '隐藏金额',
            type: 'money',
          ),
          ReportColumn(
            key: 'mysteryPurchaseCost',
            label: '未知成本',
            type: 'money',
          ),
        ],
        canReadCost: false,
      );

      expect(columns.map((item) => item.key), ['warehouseName']);
      expect(columns.single.label, '仓库');
    });

    test('formats negative quantities, money, statuses and coverage', () {
      expect(
        formatInventoryReportValue(
          'warehouse-balances',
          const ReportColumn(key: 'onHandQty', label: '账面现存', type: 'integer'),
          -8,
        ),
        '-8 瓶',
      );
      expect(
        formatInventoryReportValue(
          'inventory-valuation',
          const ReportColumn(
            key: 'inventoryAmountCents',
            label: '库存金额',
            type: 'money',
          ),
          12345,
        ),
        '¥123.45',
      );
      expect(
        formatInventoryReportValue(
          'alerts',
          const ReportColumn(key: 'status', label: '状态', type: 'string'),
          'active',
        ),
        '处理中',
      );
      expect(
        formatInventoryReportValue(
          'inventory-valuation',
          const ReportColumn(
            key: 'coverageStatus',
            label: '成本覆盖',
            type: 'string',
          ),
          'partial',
        ),
        '部分覆盖',
      );
    });

    test('warehouse API rejects valuation before issuing a request', () async {
      final client = _QueryAnalysisApiClient();
      final api = _inventoryApi(client, UserRole.warehouse);

      await expectLater(
        api.fetchReport(reportType: 'inventory-valuation'),
        throwsA(
          isA<ApiException>().having(
            (error) => error.code,
            'code',
            'INVENTORY_COST_REPORT_FORBIDDEN',
          ),
        ),
      );
      expect(client.requestedPaths, isEmpty);
    });

    test('alert report filters are role-scoped before the request', () async {
      final financeClient = _QueryAnalysisApiClient();
      await _inventoryApi(financeClient, UserRole.finance)
          .fetchReport(reportType: 'alerts');
      expect(
        financeClient.requestedPaths.single,
        contains('alertType=PENDING_COST'),
      );

      final warehouseClient = _QueryAnalysisApiClient();
      await expectLater(
        _inventoryApi(warehouseClient, UserRole.warehouse)
            .fetchReport(reportType: 'alerts'),
        throwsA(isA<ApiException>()),
      );
      expect(warehouseClient.requestedPaths, isEmpty);
    });
  });

  group('real alert report', () {
    testWidgets('finance requests only pending-cost alerts', (tester) async {
      final client = _QueryAnalysisApiClient(
        reportColumns: const [
          {'key': 'alertType', 'label': '预警类型', 'type': 'string'},
        ],
      );
      await _pump(
        tester,
        AlertTab(
          api: _inventoryApi(client, UserRole.finance),
          businessApi: _businessApi(client),
          role: UserRole.finance,
          onNavigate: (_) {},
        ),
      );

      expect(
        client.requestedPaths.any(
          (path) => path.contains('alertType=PENDING_COST'),
        ),
        isTrue,
      );
      expect(
        client.requestedPaths.any(
          (path) => path.startsWith('/api/inventory/alert-configs'),
        ),
        isFalse,
      );
      expect(find.text('严重程度'), findsOneWidget);
      expect(find.textContaining('等待服务端字段'), findsOneWidget);
    });

    testWidgets('activity alert uses real fields and desktop table',
        (tester) async {
      final client = _QueryAnalysisApiClient(
        reportColumns: const [
          {'key': 'alertType', 'label': '预警类型', 'type': 'string'},
          {'key': 'status', 'label': '状态', 'type': 'string'},
          {'key': 'warehouseName', 'label': '仓库', 'type': 'string'},
          {'key': 'productName', 'label': '商品', 'type': 'string'},
          {'key': 'availableQty', 'label': '实际可售', 'type': 'integer'},
          {'key': 'shortageQty', 'label': '短缺', 'type': 'integer'},
          {
            'key': 'minimumAvailableQty',
            'label': '最低库存',
            'type': 'integer',
          },
          {'key': 'firstDetectedAt', 'label': '首次发现', 'type': 'datetime'},
        ],
        reportRows: const [
          {
            'alertType': 'negative_available',
            'status': 'active',
            'warehouseCode': '001',
            'warehouseName': '一号仓',
            'productName': '测试商品',
            'trackingMode': 'quantity',
            'availableQty': -3,
            'shortageQty': 3,
            'minimumAvailableQty': 5,
            'firstDetectedAt': '2026-07-29T01:02:00.000Z',
          },
        ],
      );
      await _pump(
        tester,
        AlertTab(
          api: _inventoryApi(client, UserRole.boss),
          businessApi: _businessApi(client),
          role: UserRole.boss,
          onNavigate: (_) {},
        ),
      );

      expect(
        find.byKey(const ValueKey('warehouse-alert-activity-table')),
        findsOneWidget,
      );
      expect(find.text('负库存'), findsOneWidget);
      expect(find.text('-3 瓶'), findsOneWidget);
      expect(find.text('查看商品库存'), findsOneWidget);
    });
  });

  group('movement page', () {
    Map<String, dynamic> movement() => {
          'id': 'movement-01',
          'sourceKey': 'sales-order:0000123:line:0001',
          'warehouseId': 'wh-01',
          'productId': 'product-01',
          'movementType': 'sales_out',
          'onHandDelta': -2,
          'reservedDelta': 0,
          'unavailableDelta': 0,
          'inTransitDelta': 0,
          'businessAt': '2026-07-29T01:02:00.000Z',
          'operator': {'name': '库管甲', 'role': 'warehouse'},
          'warehouse': {'code': '001', 'name': '一号仓'},
          'product': {
            'name': '测试商品',
            'inventoryTrackingMode': 'quantity',
          },
        };

    testWidgets('desktop uses horizontal table and preserves negative quantity',
        (tester) async {
      final client = _QueryAnalysisApiClient(movements: [movement()]);
      await _pump(
        tester,
        MovementTab(
          api: _inventoryApi(client, UserRole.warehouse),
          businessApi: _businessApi(client),
          role: UserRole.warehouse,
        ),
      );

      expect(
        find.byKey(const ValueKey('warehouse-movement-desktop-table')),
        findsOneWidget,
      );
      expect(find.text('-2 瓶'), findsOneWidget);
      expect(find.text('库管甲'), findsOneWidget);
      expect(find.text('暂未提供筛选'), findsNWidgets(2));
      expect(
        client.requestedPaths
            .where((path) => path.startsWith('/api/inventory/movements'))
            .every((path) => !path.toLowerCase().contains('cost')),
        isTrue,
      );
    });

    testWidgets('mobile groups real movements by date', (tester) async {
      final client = _QueryAnalysisApiClient(movements: [movement()]);
      await _pump(
        tester,
        MovementTab(
          api: _inventoryApi(client, UserRole.warehouse),
          businessApi: _businessApi(client),
          role: UserRole.warehouse,
        ),
        size: const Size(520, 900),
      );

      expect(
        find.byKey(const ValueKey('warehouse-movement-mobile-groups')),
        findsOneWidget,
      );
      expect(find.text('2026-07-29'), findsOneWidget);
    });

    test('date boundaries and identifiers remain query strings', () async {
      final client = _QueryAnalysisApiClient();
      final api = _inventoryApi(client, UserRole.warehouse);
      await api.listMovements(
        warehouseId: 'wh-001',
        productId: 'product-0001',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-31',
      );
      final path = client.requestedPaths.single;
      expect(path, contains('warehouseId=wh-001'));
      expect(path, contains('productId=product-0001'));
      expect(path, contains('dateFrom=2026-07-01'));
      expect(path, contains('dateTo=2026-07-31'));
    });
  });

  group('report export and responsive layout', () {
    testWidgets('uses server filename and disables export while saving',
        (tester) async {
      final client = _QueryAnalysisApiClient(
        reportColumns: const [
          {'key': 'warehouseName', 'label': '仓库', 'type': 'string'},
          {'key': 'onHandQty', 'label': '账面现存', 'type': 'integer'},
        ],
        reportRows: const [
          {'warehouseName': '一号仓', 'onHandQty': -1},
        ],
      );
      final gate = Completer<void>();
      final saver = _RecordingDesktopSaver(gate: gate);
      final fileService = DownloadedFileService(
        platform: TargetPlatform.windows,
        desktopSaver: saver,
      );
      await _pump(
        tester,
        ReportTab(
          api: _inventoryApi(client, UserRole.finance),
          businessApi: _businessApi(client),
          role: UserRole.finance,
          downloadedFileService: fileService,
        ),
      );

      expect(
        find.byKey(
          const ValueKey('warehouse-report-table-warehouse-balances'),
        ),
        findsOneWidget,
      );
      expect(find.text('-1 瓶'), findsOneWidget);
      await tester.tap(
        find.byKey(const ValueKey('warehouse-report-export-button')),
      );
      await tester.pump();
      final exportingButton = tester.widget<FilledButton>(
        find.byKey(const ValueKey('warehouse-report-export-button')),
      );
      expect(exportingButton.onPressed, isNull);
      expect(find.text('导出中…'), findsOneWidget);
      gate.complete();
      await tester.pumpAndSettle();

      expect(saver.fileName, '服务端库存报表-001.xlsx');
      expect(saver.bytes, Uint8List.fromList([1, 2, 3]));
      expect(find.textContaining('报表已保存'), findsOneWidget);
    });

    testWidgets('export failure shows mapped Chinese reason', (tester) async {
      final client = _QueryAnalysisApiClient(failExport: true);
      await _pump(
        tester,
        ReportTab(
          api: _inventoryApi(client, UserRole.warehouse),
          businessApi: _businessApi(client),
          role: UserRole.warehouse,
        ),
      );

      await tester.tap(
        find.byKey(const ValueKey('warehouse-report-export-button')),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('导出期间数据发生变化'), findsOneWidget);
    });

    testWidgets('mobile uses report cards instead of a wide table',
        (tester) async {
      final client = _QueryAnalysisApiClient(
        reportColumns: const [
          {'key': 'warehouseName', 'label': '仓库', 'type': 'string'},
        ],
        reportRows: const [
          {'warehouseName': '一号仓'},
        ],
      );
      await _pump(
        tester,
        ReportTab(
          api: _inventoryApi(client, UserRole.warehouse),
          businessApi: _businessApi(client),
          role: UserRole.warehouse,
        ),
        size: const Size(520, 900),
      );

      expect(
        find.byKey(const ValueKey('warehouse-report-mobile-cards')),
        findsOneWidget,
      );
      expect(find.byType(DataTable), findsNothing);
    });
  });
}
