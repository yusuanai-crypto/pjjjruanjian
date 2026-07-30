import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/auth/role_access.dart';
import 'package:jiangjiu_mobile_desktop/core/business/business_api.dart';
import 'package:jiangjiu_mobile_desktop/core/business/inventory_api.dart';
import 'package:jiangjiu_mobile_desktop/features/warehouse_management/inventory_workspace_tabs.dart';

void main() {
  group('stocktake API contract', () {
    test('uses the backend flat canonical hash for create', () {
      expect(
        calculateStocktakeRequestHash(
          'STOCKTAKE_CREATE',
          sourceKey: 'STOCKTAKE:CREATE:P1',
          idempotencyKey: 'IDEM:STOCKTAKE:CREATE:P1',
          payload: const {
            'warehouseId': 'wh1',
            'productId': 'p1',
          },
        ),
        'ff30b05c55ca8f7e6ffe5cc09ea3dffe7b2bf9420d61622265a9c777b8a62ece',
      );
    });

    test('uses the backend flat canonical hash for quantity submit', () {
      expect(
        calculateStocktakeRequestHash(
          'STOCKTAKE_SUBMIT',
          sourceKey: 'stocktake:submit:st1',
          idempotencyKey: 'idem:stocktake:submit:st1',
          payload: const {
            'stocktakeId': 'st1',
            'reason': '例行盘点',
            'countedOnHandQty': 10,
            'countedUnavailableQty': 2,
            'scans': <Map<String, dynamic>>[],
          },
        ),
        'acf697436452439f40f015c2f72bf24a6ed515c6f11b6f2d24eb4b4fbaa8257c',
      );
    });

    test('StocktakeRecord reads the real nested line projection', () {
      final record = StocktakeRecord.fromJson(
        _stocktakeJson(
          status: 'SUBMITTED',
          snapshotOnHand: 10,
          snapshotUnavailable: 2,
          countedOnHand: 8,
          countedUnavailable: 1,
        ),
      );

      expect(record.stocktakeNo, 'ST202607290001');
      expect(record.line?.snapshotOnHandQty, 10);
      expect(record.line?.snapshotUnavailableQty, 2);
      expect(record.line?.countedOnHandQty, 8);
      expect(record.line?.onHandDifferenceQty, -2);
      expect(record.line?.unavailableDifferenceQty, -1);
      expect(record.systemOnHandQty, 10);
      expect(record.varianceQty, -2);
    });

    test('front-end reversal permission excludes boss and finance', () {
      expect(canStocktakeReverse(UserRole.superAdmin), isTrue);
      expect(canStocktakeReverse(UserRole.admin), isTrue);
      expect(canStocktakeReverse(UserRole.boss), isFalse);
      expect(canStocktakeReverse(UserRole.finance), isFalse);
    });

    test('API submit sends both counts, reason and canonical envelope',
        () async {
      final client = _StocktakeApiClient();
      final api = InventoryApi(
        apiClient: client,
        token: 'token',
        role: UserRole.warehouse,
      );

      await api.submitStocktake(
        id: 'st1',
        reason: '例行盘点',
        countedOnHandQty: 0,
        countedUnavailableQty: 0,
      );

      final body = client.postBodies.single;
      expect(body['countedOnHandQty'], 0);
      expect(body['countedUnavailableQty'], 0);
      expect(body['reason'], '例行盘点');
      expect(body.containsKey('stocktakeId'), isFalse);
      expect(
        body['requestHash'],
        calculateStocktakeRequestHash(
          'STOCKTAKE_SUBMIT',
          sourceKey: body['sourceKey'] as String,
          idempotencyKey: body['idempotencyKey'] as String,
          payload: const {
            'stocktakeId': 'st1',
            'reason': '例行盘点',
            'countedOnHandQty': 0,
            'countedUnavailableQty': 0,
            'scans': <Map<String, dynamic>>[],
          },
        ),
      );
    });
  });

  group('product stocktake UI', () {
    testWidgets('wide layout previews zero difference and requires reason',
        (tester) async {
      final client = _StocktakeApiClient(
        stocktakes: [_stocktakeJson(status: 'DRAFT', withSnapshot: false)],
      );
      await _pumpStocktake(
        tester,
        client,
        role: UserRole.warehouse,
        size: const Size(1400, 900),
      );

      expect(
        find.byKey(const ValueKey('warehouse-stocktake-wide-layout')),
        findsOneWidget,
      );
      await tester.tap(
        find.byKey(const ValueKey('warehouse-stocktake-submit-st1')).first,
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('warehouse-stocktake-submit-qty')),
        '10',
      );
      await tester.enterText(
        find.byKey(
          const ValueKey('warehouse-stocktake-submit-unavailable'),
        ),
        '2',
      );
      expect(find.text('0 瓶'), findsWidgets);

      await tester.tap(
        find.byKey(const ValueKey('warehouse-stocktake-submit-confirm')),
      );
      await tester.pump();
      expect(find.text('请填写盘点或差异原因'), findsOneWidget);
      expect(client.postBodies, isEmpty);
    });

    testWidgets('shows gain and loss previews from real current stock',
        (tester) async {
      final client = _StocktakeApiClient(
        stocktakes: [_stocktakeJson(status: 'DRAFT', withSnapshot: false)],
      );
      await _pumpStocktake(tester, client, role: UserRole.warehouse);
      await tester.tap(
        find.byKey(const ValueKey('warehouse-stocktake-submit-st1')).first,
      );
      await tester.pumpAndSettle();

      await tester.enterText(
        find.byKey(const ValueKey('warehouse-stocktake-submit-qty')),
        '12',
      );
      await tester.enterText(
        find.byKey(
          const ValueKey('warehouse-stocktake-submit-unavailable'),
        ),
        '3',
      );
      await tester.pump();
      expect(find.text('+2 瓶'), findsOneWidget);
      expect(find.text('+1 瓶'), findsOneWidget);

      await tester.enterText(
        find.byKey(const ValueKey('warehouse-stocktake-submit-qty')),
        '8',
      );
      await tester.enterText(
        find.byKey(
          const ValueKey('warehouse-stocktake-submit-unavailable'),
        ),
        '1',
      );
      await tester.pump();
      expect(find.text('-2 瓶'), findsOneWidget);
      expect(find.text('-1 瓶'), findsOneWidget);
    });

    testWidgets('submits zero counts only after no-inventory-change confirm',
        (tester) async {
      final client = _StocktakeApiClient(
        stocktakes: [_stocktakeJson(status: 'DRAFT', withSnapshot: false)],
      );
      await _pumpStocktake(tester, client, role: UserRole.warehouse);
      await tester.tap(
        find.byKey(const ValueKey('warehouse-stocktake-submit-st1')).first,
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('warehouse-stocktake-submit-qty')),
        '0',
      );
      await tester.enterText(
        find.byKey(
          const ValueKey('warehouse-stocktake-submit-unavailable'),
        ),
        '0',
      );
      await tester.enterText(
        find.byKey(const ValueKey('warehouse-stocktake-submit-reason')),
        '货架清空核对',
      );
      await tester.tap(
        find.byKey(const ValueKey('warehouse-stocktake-submit-confirm')),
      );
      await tester.pumpAndSettle();

      expect(
        find.textContaining('提交不会立即改变库存'),
        findsOneWidget,
      );
      expect(client.postBodies, isEmpty);
      await tester.tap(find.text('确认提交'));
      await tester.pumpAndSettle();

      expect(client.postBodies.single['countedOnHandQty'], 0);
      expect(client.postBodies.single['countedUnavailableQty'], 0);
      expect(client.inventoryMutationCount, 0);
      expect(find.textContaining('本次提交没有改变库存'), findsOneWidget);
    });

    testWidgets('serialized draft blocks summary submission and keeps codes',
        (tester) async {
      final client = _StocktakeApiClient(
        stocktakes: [
          _stocktakeJson(
            status: 'DRAFT',
            withSnapshot: false,
            trackingMode: 'SERIALIZED',
          ),
        ],
      );
      await _pumpStocktake(tester, client, role: UserRole.warehouse);

      await tester.tap(
        find.byKey(const ValueKey('warehouse-stocktake-submit-st1')).first,
      );
      await tester.pumpAndSettle();

      expect(
        find.byKey(
          const ValueKey('warehouse-stocktake-serialized-blocked'),
        ),
        findsOneWidget,
      );
      expect(find.textContaining('不能退化为汇总数量盘点'), findsOneWidget);
      expect(client.postBodies, isEmpty);
    });

    testWidgets('finance sees read-only stocktake records', (tester) async {
      final client = _StocktakeApiClient(
        stocktakes: [_stocktakeJson(status: 'DRAFT', withSnapshot: false)],
      );
      await _pumpStocktake(tester, client, role: UserRole.finance);

      expect(
        find.byKey(const ValueKey('warehouse-stocktake-create-button')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('warehouse-stocktake-submit-st1')),
        findsNothing,
      );
      expect(client.postBodies, isEmpty);
    });

    testWidgets('mobile uses cards and bottom detail instead of wide pane',
        (tester) async {
      final client = _StocktakeApiClient(
        stocktakes: [_stocktakeJson(status: 'SUBMITTED')],
      );
      await _pumpStocktake(
        tester,
        client,
        role: UserRole.warehouse,
        size: const Size(390, 820),
      );

      expect(
        find.byKey(const ValueKey('warehouse-stocktake-mobile-layout')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('warehouse-stocktake-wide-layout')),
        findsNothing,
      );
      await tester.tap(
        find.byKey(const ValueKey('warehouse-stocktake-tile-st1')),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('warehouse-stocktake-detail-st1')),
        findsOneWidget,
      );
    });
  });

  group('stocktake approval UI', () {
    testWidgets('boss sees snapshot, unavailable variance and approve/reject',
        (tester) async {
      final client = _StocktakeApiClient(
        stocktakes: [
          _stocktakeJson(
            status: 'SUBMITTED',
            snapshotOnHand: 10,
            snapshotUnavailable: 2,
            countedOnHand: 8,
            countedUnavailable: 1,
          ),
        ],
      );
      await _pumpApproval(tester, client, role: UserRole.boss);

      expect(
        find.byKey(const ValueKey('warehouse-approval-wide-layout')),
        findsOneWidget,
      );
      await tester.drag(
        find.byKey(const ValueKey('warehouse-stocktake-detail-st1')),
        const Offset(0, -360),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('账面现存'), findsWidgets);
      expect(find.text('不可售差异'), findsOneWidget);
      expect(find.text('张库管'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('warehouse-approval-approve-st1')),
        findsWidgets,
      );
      expect(
        find.byKey(const ValueKey('warehouse-approval-reject-st1')),
        findsWidgets,
      );
    });

    testWidgets('warehouse and finance build no approval request or action',
        (tester) async {
      for (final role in [UserRole.warehouse, UserRole.finance]) {
        final client = _StocktakeApiClient(
          stocktakes: [_stocktakeJson(status: 'SUBMITTED')],
        );
        await _pumpApproval(tester, client, role: role);
        expect(
          find.byKey(
            const ValueKey('warehouse-stocktake-approval-denied-card'),
          ),
          findsOneWidget,
        );
        expect(client.requestedPaths, isEmpty);
        expect(client.postBodies, isEmpty);
      }
    });

    testWidgets('snapshot conflict explains re-count and offers no force',
        (tester) async {
      final client = _StocktakeApiClient(
        stocktakes: [_stocktakeJson(status: 'SUBMITTED')],
        approveError: const ApiException(
          statusCode: 409,
          code: 'INVENTORY_STOCKTAKE_SNAPSHOT_STALE',
          message: 'Inventory changed after submission.',
        ),
      );
      await _pumpApproval(tester, client, role: UserRole.boss);
      await tester.tap(
        find
            .byKey(
              const ValueKey('warehouse-approval-approve-st1'),
            )
            .first,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('确认批准并过账'));
      await tester.pumpAndSettle();

      expect(find.textContaining('快照已过期'), findsOneWidget);
      expect(find.textContaining('不能强制覆盖'), findsOneWidget);
      expect(find.textContaining('强制批准'), findsNothing);
      expect(client.inventoryMutationCount, 0);
    });

    testWidgets('repeated approval click sends only one command',
        (tester) async {
      final gate = Completer<void>();
      final client = _StocktakeApiClient(
        stocktakes: [_stocktakeJson(status: 'SUBMITTED')],
        approveGate: gate,
      );
      await _pumpApproval(tester, client, role: UserRole.boss);
      await tester.tap(
        find
            .byKey(
              const ValueKey('warehouse-approval-approve-st1'),
            )
            .first,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('确认批准并过账'));
      await tester.pump();

      expect(client.approveCalls, 1);
      final button = tester.widget<FilledButton>(
        find
            .byKey(
              const ValueKey('warehouse-approval-approve-st1'),
            )
            .first,
      );
      expect(button.onPressed, isNull);
      gate.complete();
      await tester.pumpAndSettle();
      expect(client.approveCalls, 1);
    });

    testWidgets('reject requires reason and preserves it on server failure',
        (tester) async {
      final client = _StocktakeApiClient(
        stocktakes: [_stocktakeJson(status: 'SUBMITTED')],
        rejectError: const ApiException(
          statusCode: 409,
          code: 'INVENTORY_STOCKTAKE_STATE_CONFLICT',
          message: 'Already processed.',
        ),
      );
      await _pumpApproval(tester, client, role: UserRole.boss);
      await tester.tap(
        find
            .byKey(
              const ValueKey('warehouse-approval-reject-st1'),
            )
            .first,
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey('warehouse-approval-reject-confirm')),
      );
      await tester.pump();
      expect(find.text('必须填写原因'), findsOneWidget);

      await tester.enterText(
        find.byKey(const ValueKey('warehouse-approval-reject-reason')),
        '盘点表不完整',
      );
      await tester.tap(
        find.byKey(const ValueKey('warehouse-approval-reject-confirm')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('确认驳回').last);
      await tester.pumpAndSettle();

      expect(find.text('盘点表不完整'), findsOneWidget);
      expect(find.textContaining('状态已变化'), findsWidgets);
      expect(client.inventoryMutationCount, 0);
    });

    testWidgets('only admin can reverse a posted record with reason',
        (tester) async {
      final bossClient = _StocktakeApiClient(
        stocktakes: [_stocktakeJson(status: 'POSTED')],
      );
      await _pumpApproval(tester, bossClient, role: UserRole.boss);
      expect(
        find.byKey(const ValueKey('warehouse-approval-reverse-st1')),
        findsNothing,
      );

      final adminClient = _StocktakeApiClient(
        stocktakes: [_stocktakeJson(status: 'POSTED')],
      );
      await _pumpApproval(tester, adminClient, role: UserRole.admin);
      await tester.tap(
        find.byKey(const ValueKey('warehouse-approval-filter-status')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('已生效').last);
      await tester.pumpAndSettle();
      await tester.ensureVisible(
        find.byKey(const ValueKey('warehouse-approval-filter-apply')),
      );
      await tester.tap(
        find.byKey(const ValueKey('warehouse-approval-filter-apply')),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('warehouse-approval-reverse-st1')),
        findsWidgets,
      );
    });

    testWidgets('submitter/date filters are explicitly backend-blocked',
        (tester) async {
      final client = _StocktakeApiClient(
        stocktakes: [_stocktakeJson(status: 'SUBMITTED')],
      );
      await _pumpApproval(tester, client, role: UserRole.boss);

      expect(
        find.byKey(const ValueKey('warehouse-approval-filter-blocked')),
        findsOneWidget,
      );
      expect(find.text('提交人（等待接口）'), findsOneWidget);
      expect(find.text('日期范围（等待接口）'), findsOneWidget);
      expect(
        client.requestedPaths
            .where((path) => path.contains('/stocktakes?'))
            .first,
        contains('status=SUBMITTED'),
      );
    });

    testWidgets('mobile approval uses card list and bottom detail',
        (tester) async {
      final client = _StocktakeApiClient(
        stocktakes: [_stocktakeJson(status: 'SUBMITTED')],
      );
      await _pumpApproval(
        tester,
        client,
        role: UserRole.boss,
        size: const Size(390, 820),
      );
      expect(
        find.byKey(const ValueKey('warehouse-approval-mobile-layout')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('warehouse-approval-wide-layout')),
        findsNothing,
      );
      await tester.tap(
        find.byKey(const ValueKey('warehouse-approval-tile-st1')),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('warehouse-stocktake-detail-st1')),
        findsOneWidget,
      );
    });
  });
}

Future<void> _pumpStocktake(
  WidgetTester tester,
  _StocktakeApiClient client, {
  required UserRole role,
  Size size = const Size(1400, 900),
}) async {
  await _setView(tester, size);
  final api = InventoryApi(apiClient: client, token: 'token', role: role);
  final businessApi = BusinessApi(apiClient: client, token: 'token');
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: StocktakeTab(
          api: api,
          businessApi: businessApi,
          role: role,
          onOpenSerialized: () {},
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _pumpApproval(
  WidgetTester tester,
  _StocktakeApiClient client, {
  required UserRole role,
  Size size = const Size(1400, 900),
}) async {
  await _setView(tester, size);
  final api = InventoryApi(apiClient: client, token: 'token', role: role);
  final businessApi = BusinessApi(apiClient: client, token: 'token');
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: StocktakeApprovalTab(
          api: api,
          businessApi: businessApi,
          role: role,
          onInventoryFactsChanged: () {},
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _setView(WidgetTester tester, Size size) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

class _StocktakeApiClient extends ApiClient {
  _StocktakeApiClient({
    List<Map<String, dynamic>>? stocktakes,
    this.approveError,
    this.rejectError,
    this.approveGate,
  })  : stocktakes = stocktakes ??
            [
              _stocktakeJson(
                status: 'DRAFT',
                withSnapshot: false,
              ),
            ],
        super(baseUrl: 'http://127.0.0.1:3000');

  List<Map<String, dynamic>> stocktakes;
  final ApiException? approveError;
  final ApiException? rejectError;
  final Completer<void>? approveGate;

  final requestedPaths = <String>[];
  final postPaths = <String>[];
  final postBodies = <Map<String, dynamic>>[];
  int inventoryMutationCount = 0;
  int approveCalls = 0;

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    requestedPaths.add(path);
    if (path == '/api/products/options') {
      return {
        'data': {
          'products': [
            {
              'id': 'p1',
              'name': '商品A',
              'unit': '瓶',
              'inventoryTrackingMode': 'quantity',
            },
            {
              'id': 'p-serialized',
              'name': '逐瓶商品',
              'unit': '瓶',
              'inventoryTrackingMode': 'serialized',
            },
          ],
        },
      };
    }
    if (path.startsWith('/api/inventory/warehouses')) {
      return {
        'data': {
          'warehouses': [_warehouseJson()],
          'pagination': _pagination(1),
        },
      };
    }
    if (RegExp(r'^/api/inventory/stocktakes/[^?]+$').hasMatch(path)) {
      final id = Uri.decodeComponent(path.split('/').last);
      final record = stocktakes.firstWhere((item) => item['id'] == id);
      return {
        'data': {'stocktake': record},
      };
    }
    if (path.startsWith('/api/inventory/stocktakes?')) {
      final uri = Uri.parse('http://local$path');
      final status = uri.queryParameters['status'];
      final warehouseId = uri.queryParameters['warehouseId'];
      final productId = uri.queryParameters['productId'];
      final filtered = stocktakes.where((record) {
        if (status != null && record['status'] != status) return false;
        if (warehouseId != null &&
            (record['warehouse'] as Map)['id'] != warehouseId) {
          return false;
        }
        if (productId != null &&
            (record['product'] as Map)['id'] != productId) {
          return false;
        }
        return true;
      }).toList();
      return {
        'data': {
          'data': filtered,
          'pagination': _pagination(filtered.length),
        },
      };
    }
    if (RegExp(r'^/api/inventory/stocks/[^/]+/[^/?]+$').hasMatch(path)) {
      return {
        'data': {
          'stock': _stockJson(),
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
    postPaths.add(path);
    postBodies.add(Map<String, dynamic>.from(body ?? const {}));
    final id = path.contains('/stocktakes/')
        ? Uri.decodeComponent(path.split('/')[4])
        : 'st1';
    final currentIndex = stocktakes.indexWhere((record) => record['id'] == id);
    var record = currentIndex < 0
        ? _stocktakeJson(status: 'DRAFT', withSnapshot: false)
        : stocktakes[currentIndex];

    if (path.endsWith('/submit')) {
      record = _copyStocktake(
        record,
        status: 'SUBMITTED',
        countedOnHand: body?['countedOnHandQty'] as int?,
        countedUnavailable: body?['countedUnavailableQty'] as int?,
        reason: body?['reason'] as String?,
      );
    } else if (path.endsWith('/approve')) {
      approveCalls++;
      if (approveError != null) throw approveError!;
      if (approveGate != null) await approveGate!.future;
      record = _copyStocktake(record, status: 'POSTED');
      inventoryMutationCount++;
    } else if (path.endsWith('/reject')) {
      if (rejectError != null) throw rejectError!;
      record = _copyStocktake(
        record,
        status: 'REJECTED',
        rejectionReason: body?['reason'] as String?,
      );
    } else if (path.endsWith('/reverse')) {
      record = _copyStocktake(
        record,
        status: 'REVERSED',
        reversalReason: body?['reason'] as String?,
      );
      inventoryMutationCount++;
    }
    if (currentIndex >= 0) stocktakes[currentIndex] = record;
    return {
      'data': {
        'stocktake': record,
        'replayed': false,
      },
    };
  }
}

Map<String, dynamic> _pagination(int total) => {
      'page': 1,
      'pageSize': 20,
      'total': total,
      'totalPages': total == 0 ? 0 : 1,
    };

Map<String, dynamic> _warehouseJson() => {
      'id': 'wh1',
      'code': 'W01',
      'name': '主仓库',
      'address': '测试地址',
      'isActive': true,
      'isDefault': true,
    };

Map<String, dynamic> _stockJson() => {
      'id': 'stock1',
      'warehouseId': 'wh1',
      'productId': 'p1',
      'warehouse': _warehouseJson(),
      'product': {
        'id': 'p1',
        'name': '商品A',
        'unit': '瓶',
        'inventoryTrackingMode': 'quantity',
      },
      'onHandQty': 10,
      'reservedQty': 0,
      'unavailableQty': 2,
      'inTransitQty': 0,
      'availableQty': 8,
      'shortageQty': 0,
      'version': 3,
      'lastMovementId': 'mv-1',
      'updatedAt': '2026-07-29T03:00:00.000Z',
      'lowStock': {
        'enabled': false,
        'minimumAvailableQty': null,
        'isLowStock': false,
      },
      'batches': <Map<String, dynamic>>[],
      'serializedStatusSummary': <String, int>{},
    };

Map<String, dynamic> _stocktakeJson({
  String status = 'SUBMITTED',
  bool withSnapshot = true,
  String trackingMode = 'QUANTITY',
  int snapshotOnHand = 10,
  int snapshotUnavailable = 2,
  int countedOnHand = 8,
  int countedUnavailable = 1,
}) {
  final hasSnapshot = withSnapshot && status != 'DRAFT';
  return {
    'id': 'st1',
    'stocktakeNo': 'ST202607290001',
    'status': status,
    'warehouse': _warehouseJson(),
    'product': {
      'id': trackingMode == 'SERIALIZED' ? 'p-serialized' : 'p1',
      'name': trackingMode == 'SERIALIZED' ? '逐瓶商品' : '商品A',
      'unit': '瓶',
      'inventoryTrackingMode': trackingMode,
    },
    'trackingMode': trackingMode,
    'active': status == 'DRAFT' || status == 'SUBMITTED',
    'reason': hasSnapshot ? '例行盘点' : null,
    'rejectionReason': null,
    'reversalReason': null,
    'line': {
      'snapshotStockVersion': hasSnapshot ? 3 : null,
      'snapshotLastMovementId': hasSnapshot ? 'mv-1' : null,
      'snapshotOnHandQty': hasSnapshot ? snapshotOnHand : null,
      'snapshotUnavailableQty': hasSnapshot ? snapshotUnavailable : null,
      'countedOnHandQty': hasSnapshot ? countedOnHand : null,
      'countedUnavailableQty': hasSnapshot ? countedUnavailable : null,
      'onHandDifferenceQty':
          hasSnapshot ? countedOnHand - snapshotOnHand : null,
      'unavailableDifferenceQty':
          hasSnapshot ? countedUnavailable - snapshotUnavailable : null,
    },
    'submittedByName': hasSnapshot ? '张库管' : null,
    'submittedByRole': hasSnapshot ? 'warehouse' : null,
    'submittedAt': hasSnapshot ? '2026-07-29T03:05:00.000Z' : null,
    'approvedByName': status == 'POSTED' ? '王老板' : null,
    'approvedAt': status == 'POSTED' ? '2026-07-29T03:10:00.000Z' : null,
    'rejectedByName': null,
    'rejectedAt': null,
    'postedByName': status == 'POSTED' ? '王老板' : null,
    'postedAt': status == 'POSTED' ? '2026-07-29T03:10:00.000Z' : null,
    'reversedByName': null,
    'reversedAt': null,
    'createdAt': '2026-07-29T03:00:00.000Z',
    'updatedAt': '2026-07-29T03:05:00.000Z',
    'serializedScans': <Map<String, dynamic>>[],
  };
}

Map<String, dynamic> _copyStocktake(
  Map<String, dynamic> source, {
  required String status,
  int? countedOnHand,
  int? countedUnavailable,
  String? reason,
  String? rejectionReason,
  String? reversalReason,
}) {
  final copy = Map<String, dynamic>.from(source);
  final oldLine = Map<String, dynamic>.from(source['line'] as Map);
  final snapshotOnHand = oldLine['snapshotOnHandQty'] as int? ?? 10;
  final snapshotUnavailable = oldLine['snapshotUnavailableQty'] as int? ?? 2;
  final nextOnHand = countedOnHand ?? oldLine['countedOnHandQty'] as int? ?? 8;
  final nextUnavailable =
      countedUnavailable ?? oldLine['countedUnavailableQty'] as int? ?? 1;
  copy
    ..['status'] = status
    ..['reason'] = reason ?? source['reason']
    ..['rejectionReason'] = rejectionReason
    ..['reversalReason'] = reversalReason
    ..['line'] = {
      ...oldLine,
      'snapshotStockVersion': oldLine['snapshotStockVersion'] ?? 3,
      'snapshotLastMovementId': oldLine['snapshotLastMovementId'] ?? 'mv-1',
      'snapshotOnHandQty': snapshotOnHand,
      'snapshotUnavailableQty': snapshotUnavailable,
      'countedOnHandQty': nextOnHand,
      'countedUnavailableQty': nextUnavailable,
      'onHandDifferenceQty': nextOnHand - snapshotOnHand,
      'unavailableDifferenceQty': nextUnavailable - snapshotUnavailable,
    }
    ..['submittedByName'] = '张库管'
    ..['submittedByRole'] = 'warehouse'
    ..['submittedAt'] = '2026-07-29T03:05:00.000Z';
  if (status == 'POSTED') {
    copy
      ..['postedByName'] = '王老板'
      ..['postedAt'] = '2026-07-29T03:10:00.000Z';
  }
  return copy;
}
