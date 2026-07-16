import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/reconciliation/reconciliation_table_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets('finance can only edit manual reconciliation amounts',
      (tester) async {
    tester.view.physicalSize = const Size(1600, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final apiClient = _FakeReconciliationApiClient();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ReconciliationTablePage(
            apiClient: apiClient,
            token: 'finance-token',
            role: UserRole.finance,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('每日对账统计'), findsOneWidget);
    expect(find.text('旅行团销售额'), findsOneWidget);
    expect(find.text('其他'), findsNothing);
    expect(find.text('¥100.00'), findsWidgets);
    expect(
      find.byKey(const ValueKey('reconciliation-back-office-input')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('reconciliation-save-manual')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('reconciliation-review')),
      findsNothing,
    );

    await tester.enterText(
      find.byKey(const ValueKey('reconciliation-back-office-input')),
      '61.00',
    );
    final saveButton = find.byKey(const ValueKey('reconciliation-save-manual'));
    await tester.ensureVisible(saveButton);
    await tester.pumpAndSettle();
    await tester.tap(saveButton);
    await tester.pumpAndSettle();

    expect(apiClient.lastPutPath, startsWith('/api/reconciliations/'));
    expect(apiClient.lastPutBody?['backOfficeSalesCents'], 6100);
    expect(apiClient.lastPutBody, isNot(contains('travelGroupSalesCents')));
    expect(apiClient.lastPutBody, isNot(contains('refundsCents')));
    expect(apiClient.lastPutBody, isNot(contains('otherReceivableCents')));
  });

  testWidgets('admin sees real review action with manual fields disabled',
      (tester) async {
    tester.view.physicalSize = const Size(1600, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final apiClient = _FakeReconciliationApiClient();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ReconciliationTablePage(
            apiClient: apiClient,
            token: 'admin-token',
            role: UserRole.admin,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final backOfficeField = find.descendant(
      of: find.byKey(const ValueKey('reconciliation-back-office-input')),
      matching: find.byType(TextField),
    );
    expect(backOfficeField, findsOneWidget);
    expect(tester.widget<TextField>(backOfficeField).enabled, isFalse);
    expect(
      find.byKey(const ValueKey('reconciliation-save-manual')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('reconciliation-review')),
      findsOneWidget,
    );

    final reviewButton = find.byKey(const ValueKey('reconciliation-review'));
    await tester.ensureVisible(reviewButton);
    await tester.pumpAndSettle();
    await tester.tap(reviewButton);
    await tester.pumpAndSettle();

    expect(apiClient.lastPostPath, endsWith('/review'));
    expect(find.text('测试管理员'), findsOneWidget);
  });

  testWidgets('range load failure shows retry without stale daily amounts',
      (tester) async {
    tester.view.physicalSize = const Size(1600, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final apiClient = _FakeReconciliationApiClient(failRange: true);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ReconciliationTablePage(
            apiClient: apiClient,
            token: 'finance-token',
            role: UserRole.finance,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('失败'), findsWidgets);
    expect(find.text('重新加载'), findsWidgets);
    expect(find.text('¥100.00'), findsNothing);
  });
}

class _FakeReconciliationApiClient extends ApiClient {
  _FakeReconciliationApiClient({this.failRange = false})
      : super(baseUrl: 'http://127.0.0.1:3000');

  final bool failRange;
  String? lastPutPath;
  Map<String, dynamic>? lastPutBody;
  String? lastPostPath;

  @override
  Future<Map<String, dynamic>> getJson(
    String path, {
    String? token,
  }) async {
    if (path.startsWith('/api/reconciliations?')) {
      if (failRange) throw StateError('range unavailable');
      return {
        'data': {
          'reconciliations': [_recordJson()],
        },
      };
    }
    return {
      'data': {'reconciliation': _recordJson()},
    };
  }

  @override
  Future<Map<String, dynamic>> putJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    lastPutPath = path;
    lastPutBody = Map<String, dynamic>.from(body ?? const {});
    return {
      'data': {
        'reconciliation': _recordJson(
          backOfficeSalesCents: body?['backOfficeSalesCents'] as int? ?? 5000,
        ),
      },
    };
  }

  @override
  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    lastPostPath = path;
    return {
      'data': {
        'reconciliation': _recordJson(
          reviewStatus: 'reviewed',
          status: 'difference',
          reviewedByName: '测试管理员',
        ),
      },
    };
  }
}

Map<String, dynamic> _recordJson({
  int backOfficeSalesCents = 5000,
  String reviewStatus = 'pending_review',
  String status = 'pending_review',
  String? reviewedByName,
}) {
  final now = DateTime.now();
  final businessDate = '${now.year.toString().padLeft(4, '0')}-'
      '${now.month.toString().padLeft(2, '0')}-'
      '${now.day.toString().padLeft(2, '0')}';
  return {
    'id': 'daily-reconciliation-1',
    'businessDate': businessDate,
    'timezone': 'Asia/Shanghai',
    'travelGroupSalesCents': 10000,
    'backOfficeSalesCents': backOfficeSalesCents,
    'buybackCents': 2000,
    'externalSalesCents': 3000,
    'internalPurchaseCents': 4000,
    'afterSalesCents': 5000,
    'refundsCents': 1000,
    'receivableTotalCents': 23000 + backOfficeSalesCents,
    'actualTotalCents': 23000,
    'differenceCents': -backOfficeSalesCents,
    'reviewStatus': reviewStatus,
    'status': status,
    'reviewIsStale': false,
    'reviewedById': reviewedByName == null ? null : 'admin-1',
    'reviewedByName': reviewedByName,
    'reviewedAt': reviewedByName == null ? null : '2026-07-14T12:00:00.000Z',
    'notes': '测试备注',
    'paymentMethods': [
      {'name': '现金', 'amountCents': 23000, 'sortOrder': 0},
    ],
  };
}
