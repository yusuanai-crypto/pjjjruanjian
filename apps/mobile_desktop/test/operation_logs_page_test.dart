import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/app/destinations.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/auth/auth_models.dart';
import 'package:jiangjiu_mobile_desktop/features/operation_logs/operation_logs_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  test('operation_logs destination is visible only to admin roles', () {
    const menu = AuthMenu(id: 'operation_logs', title: '操作日志', phase: 1);
    for (final role in [UserRole.superAdmin, UserRole.admin]) {
      expect(
        destinationsForBackendMenus(const [menu], role)
            .map((item) => item.id),
        contains('operation_logs'),
      );
    }
    for (final role in [
      UserRole.boss,
      UserRole.finance,
      UserRole.sales,
      UserRole.frontDesk,
      UserRole.warehouse,
      UserRole.afterSales,
      UserRole.taster,
    ]) {
      expect(
        destinationsForBackendMenus(const [menu], role)
            .map((item) => item.id),
        isNot(contains('operation_logs')),
      );
    }
  });

  test('operation log query emits the documented filter parameters', () {
    final query = OperationLogQuery(
      page: 2,
      pageSize: 50,
      userId: 'user-1',
      startTime: DateTime.utc(2026, 7, 1),
      endTime: DateTime.utc(2026, 7, 2, 23, 59),
      module: 'customers',
      operationType: 'UPDATE',
      action: 'customers.update',
      entityType: 'customer',
      entityId: 'customer-1',
      result: 'FAILURE',
      ipAddress: '10.0.0.1',
      keyword: 'audit',
      archived: true,
    );

    expect(query.toQueryParameters(), {
      'page': '2',
      'pageSize': '50',
      'userId': 'user-1',
      'startTime': '2026-07-01T00:00:00.000Z',
      'endTime': '2026-07-02T23:59:00.000Z',
      'module': 'customers',
      'operationType': 'UPDATE',
      'action': 'customers.update',
      'entityType': 'customer',
      'entityId': 'customer-1',
      'result': 'FAILURE',
      'ipAddress': '10.0.0.1',
      'keyword': 'audit',
      'archived': 'true',
    });
  });

  testWidgets(
      'renders desktop logs, status badges, details, filters and pagination',
      (tester) async {
    final api = FakeOperationLogsApi(page: _page(totalPages: 2));
    await _pumpPage(tester, api, const Size(1280, 900));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('operation-log-desktop-table')),
        findsOneWidget);
    expect(find.text('customers.update'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('operation-log-success-badge')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('operation-log-failure-badge')),
      findsOneWidget,
    );

    await tester.enterText(
      find.byKey(const ValueKey('operation-log-keyword-filter')),
      'customer-audit',
    );
    await tester.tap(
      find.byKey(const ValueKey('operation-log-search-button')),
    );
    await tester.pumpAndSettle();
    expect(api.queries.last.keyword, 'customer-audit');

    await tester.tap(
      find.byKey(const ValueKey('operation-log-next-page')),
    );
    await tester.pumpAndSettle();
    expect(api.queries.last.page, 2);

    await tester.tap(find.text('customers.update'));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('operation-log-detail-dialog')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('operation-log-before-data')),
        findsOneWidget);
    expect(find.byKey(const ValueKey('operation-log-after-data')),
        findsOneWidget);
    expect(find.textContaining('"status": "old"'), findsOneWidget);
    expect(find.textContaining('"status": "new"'), findsOneWidget);
  });

  testWidgets('shows loading, empty and error states with retry',
      (tester) async {
    final pending = Completer<OperationLogPageResult>();
    final loadingApi = FakeOperationLogsApi(listCompleter: pending);
    await _pumpPage(tester, loadingApi, const Size(900, 700));
    await tester.pump();
    expect(
      find.byKey(const ValueKey('operation-log-loading')),
      findsOneWidget,
    );

    pending.complete(_emptyPage());
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('operation-log-empty')),
      findsOneWidget,
    );

    final errorApi = FakeOperationLogsApi(
      error: const ApiException(
        statusCode: 500,
        code: 'TEST',
        message: '日志加载失败',
      ),
    );
    await _pumpPage(tester, errorApi, const Size(900, 700));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('operation-log-error')),
      findsOneWidget,
    );
    expect(find.text('日志加载失败'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('operation-log-retry-button')),
      findsOneWidget,
    );
  });

  testWidgets('uses cards on narrow screens without overflow',
      (tester) async {
    final api = FakeOperationLogsApi(page: _page());
    await _pumpPage(tester, api, const Size(390, 780));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('operation-log-mobile-list')),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('exports through the injected saver and reports failures',
      (tester) async {
    final api = FakeOperationLogsApi(page: _page());
    String? savedName;
    await _pumpPage(
      tester,
      api,
      const Size(1000, 800),
      fileSaver: (name, bytes) async {
        savedName = name;
        expect(bytes, Uint8List.fromList([1, 2, 3]));
        return 'saved.xlsx';
      },
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('operation-log-export-button')),
    );
    await tester.pumpAndSettle();
    expect(savedName, '操作日志.xlsx');
    expect(find.text('操作日志已导出。'), findsOneWidget);

    final errorApi = FakeOperationLogsApi(page: _page())
      ..exportError = const ApiException(
        statusCode: 400,
        code: 'EXPORT_LIMIT',
        message: '请缩小筛选范围',
      );
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    await _pumpPage(tester, errorApi, const Size(1000, 800));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('operation-log-export-button')),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('请缩小筛选范围'), findsOneWidget);
  });
}

Future<void> _pumpPage(
  WidgetTester tester,
  FakeOperationLogsApi api,
  Size size, {
  OperationLogFileSaver? fileSaver,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      home: OperationLogsPage(
        key: ValueKey(api),
        apiClient: ApiClient(baseUrl: 'http://127.0.0.1:1'),
        token: 'test-token',
        operationLogsApi: api,
        fileSaver: fileSaver,
      ),
    ),
  );
}

class FakeOperationLogsApi implements OperationLogsApi {
  FakeOperationLogsApi({
    this.page,
    this.listCompleter,
    this.error,
  });

  final OperationLogPageResult? page;
  final Completer<OperationLogPageResult>? listCompleter;
  final Object? error;
  final List<OperationLogQuery> queries = [];
  Object? exportError;

  @override
  Future<OperationLogEntry> detail(String id,
      {required bool archived}) async {
    return _entries().firstWhere((entry) => entry.id == id);
  }

  @override
  Future<ApiDownloadedFile> export(OperationLogQuery query) async {
    final failure = exportError;
    if (failure != null) throw failure;
    return ApiDownloadedFile(
      bytes: Uint8List.fromList([1, 2, 3]),
      fileName: '操作日志.xlsx',
      contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }

  @override
  Future<OperationLogFilterOptions> filterOptions() async {
    if (error != null) throw error!;
    return const OperationLogFilterOptions(
      users: [
        OperationLogUserOption(
          id: 'user-1',
          name: '测试管理员',
          username: 'admin',
          role: 'admin',
          isActive: true,
          historicalOnly: false,
        ),
      ],
      modules: ['customers'],
      operationTypes: [
        OperationLogValueOption(value: 'UPDATE', label: '修改'),
      ],
      results: [
        OperationLogValueOption(value: 'SUCCESS', label: '成功'),
        OperationLogValueOption(value: 'FAILURE', label: '失败'),
      ],
    );
  }

  @override
  Future<OperationLogPageResult> list(OperationLogQuery query) async {
    queries.add(query);
    if (error != null) throw error!;
    if (listCompleter != null) {
      return listCompleter!.future;
    }
    final source = page ?? _page();
    return OperationLogPageResult(
      logs: source.logs,
      page: query.page,
      pageSize: source.pageSize,
      total: source.total,
      totalPages: source.totalPages,
    );
  }
}

OperationLogPageResult _page({int totalPages = 1}) {
  return OperationLogPageResult(
    logs: _entries(),
    page: 1,
    pageSize: 20,
    total: 2,
    totalPages: totalPages,
  );
}

OperationLogPageResult _emptyPage() {
  return const OperationLogPageResult(
    logs: [],
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  );
}

List<OperationLogEntry> _entries() {
  return [
    OperationLogEntry(
      id: 'log-1',
      action: 'customers.update',
      entityType: 'customer',
      entityId: 'customer-1',
      result: 'SUCCESS',
      actorNameSnapshot: '测试管理员',
      actorUsernameSnapshot: 'admin',
      actorRoleSnapshot: 'admin',
      module: 'customers',
      beforeData: const {'status': 'old'},
      afterData: const {'status': 'new'},
      ipAddress: '10.0.0.1',
      createdAt: DateTime.utc(2026, 7, 25, 1),
    ),
    OperationLogEntry(
      id: 'log-2',
      action: 'customers.read',
      entityType: 'customer',
      result: 'FAILURE',
      actorNameSnapshot: '测试管理员',
      actorUsernameSnapshot: 'admin',
      actorRoleSnapshot: 'admin',
      module: 'customers',
      errorCode: 'NOT_FOUND',
      ipAddress: '10.0.0.1',
      createdAt: DateTime.utc(2026, 7, 25),
    ),
  ];
}
