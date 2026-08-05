import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/app/destinations.dart';
import 'package:jiangjiu_mobile_desktop/app/page_factory.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/auth/auth_models.dart';
import 'package:jiangjiu_mobile_desktop/features/today_travel_groups/today_travel_groups_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  test('today travel groups destination follows the allowed role matrix', () {
    const allowedRoles = {
      UserRole.superAdmin,
      UserRole.admin,
      UserRole.boss,
      UserRole.frontDesk,
      UserRole.sales,
      UserRole.taster,
    };

    for (final role in UserRole.values) {
      expect(
        destinationsForRole(role).map((destination) => destination.id),
        allowedRoles.contains(role)
            ? contains('today_travel_groups')
            : isNot(contains('today_travel_groups')),
        reason: role.value,
      );
      expect(
        destinationsForBackendMenus(
          const [
            AuthMenu(
              id: 'today_travel_groups',
              title: '今日旅行团',
              phase: 3,
            ),
          ],
          role,
        ).map((destination) => destination.id),
        allowedRoles.contains(role)
            ? contains('today_travel_groups')
            : isNot(contains('today_travel_groups')),
        reason: '${role.value} injected backend menu',
      );

      final page = buildPageForDestination(
        destinationId: 'today_travel_groups',
        apiClient: _TodayApiClient((_) async => _payload(const [])),
        token: '${role.value}-token',
        role: role,
        allowedDestinations: const [],
        onOpenDestination: (_) {},
      );
      expect(
        page,
        allowedRoles.contains(role)
            ? isA<TodayTravelGroupsPage>()
            : isNot(isA<TodayTravelGroupsPage>()),
        reason: '${role.value} direct route',
      );
    }
  });

  testWidgets('direct page construction still blocks disallowed roles',
      (tester) async {
    final apiClient = _TodayApiClient((_) async => _payload(const []));
    final page = buildPageForDestination(
      destinationId: 'today_travel_groups',
      apiClient: apiClient,
      token: 'finance-token',
      role: UserRole.finance,
      allowedDestinations: const [],
      onOpenDestination: (_) {},
    );

    await tester.pumpWidget(MaterialApp(home: Scaffold(body: page)));

    expect(find.text('当前账号没有访问今日旅行团的权限。'), findsOneWidget);
    expect(apiClient.callCount, 0);
  });

  testWidgets('shows loading then the exact seven-column read-only table',
      (tester) async {
    final response = Completer<Map<String, dynamic>>();
    final apiClient = _TodayApiClient((_) => response.future);

    await _pumpPage(tester, apiClient);
    expect(find.text('正在加载今日旅行团'), findsOneWidget);
    expect(apiClient.paths, ['/api/travel-groups/today']);

    response.complete(
      _payload([
        {
          'arrivalTime': '09:05',
          'licensePlate': '贵A12345',
          'tasterName': '王品鉴师',
          'tastingRoomNo': 'A01',
          'cigaretteFeeCents': 2050,
          'groupNo': 'TG-001',
          'expectedArrivalTime': '09:00',
        },
        {
          'arrivalTime': null,
          'licensePlate': null,
          'tasterName': null,
          'tastingRoomNo': null,
          'cigaretteFeeCents': null,
          'groupNo': null,
          'expectedArrivalTime': null,
        },
      ]),
    );
    await tester.pump();
    await tester.pump();

    final table = tester.widget<DataTable>(
      find.byKey(const ValueKey('today-travel-groups-table')),
    );
    expect(table.columns, hasLength(7));
    expect(
      table.columns.map((column) => (column.label as Text).data),
      [
        '进店时间',
        '车牌号',
        '接待品鉴师',
        '品鉴馆号',
        '香烟费用',
        '团号',
        '预计进店时间',
      ],
    );
    expect(find.text('进店时间'), findsOneWidget);
    expect(find.text('车牌号'), findsOneWidget);
    expect(find.text('接待品鉴师'), findsOneWidget);
    expect(find.text('品鉴馆号'), findsOneWidget);
    expect(find.text('香烟费用'), findsOneWidget);
    expect(find.text('团号'), findsOneWidget);
    expect(find.text('预计进店时间'), findsOneWidget);
    expect(find.text('09:05'), findsOneWidget);
    expect(find.text('未进店'), findsOneWidget);
    expect(find.text('¥20.50'), findsOneWidget);
    expect(find.text('TG-001'), findsOneWidget);
    expect(find.text('—'), findsNWidgets(6));
    for (final forbiddenText in [
      '团名',
      '人数',
      '旅行社',
      '联系人',
      '日期',
      '编辑',
      '删除',
      '新增'
    ]) {
      expect(find.text(forbiddenText), findsNothing);
    }
    expect(find.text('刷新'), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('defensively keeps entered-first expected-time stable sorting',
      (tester) async {
    final apiClient = _TodayApiClient((_) async => _payload([
          _group('pending-none'),
          _group('entered-0900-b', arrivalTime: '09:00'),
          _group('pending-0800-b', expectedArrivalTime: '08:00'),
          _group('entered-0900-a', arrivalTime: '09:00'),
          _group('entered-0700', arrivalTime: '07:00'),
          _group('pending-0800-a', expectedArrivalTime: '08:00'),
        ]));

    await _pumpPage(tester, apiClient);
    await tester.pump();

    final table = tester.widget<DataTable>(
      find.byKey(const ValueKey('today-travel-groups-table')),
    );
    expect(
      table.rows.map(
        (row) => ((row.cells[5].child as Text).data),
      ),
      [
        'entered-0700',
        'entered-0900-a',
        'entered-0900-b',
        'pending-0800-a',
        'pending-0800-b',
        'pending-none',
      ],
    );

    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('manual refresh replaces table data without reloading the page',
      (tester) async {
    final apiClient = _TodayApiClient(
      (call) async => _payload([_group('manual-$call')]),
    );

    await _pumpPage(tester, apiClient);
    await tester.pump();
    expect(find.text('manual-1'), findsOneWidget);

    await tester.tap(find.text('刷新'));
    await tester.pump();
    await tester.pump();
    expect(apiClient.callCount, 2);
    expect(find.text('manual-1'), findsNothing);
    expect(find.text('manual-2'), findsOneWidget);
    expect(find.byType(TodayTravelGroupsPage), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('shows initial error and retries into the empty state',
      (tester) async {
    final apiClient = _TodayApiClient((call) async {
      if (call == 1) {
        throw const ApiException(
          statusCode: 500,
          code: 'TEST_ERROR',
          message: '测试接口失败',
        );
      }
      return _payload(const []);
    });

    await _pumpPage(tester, apiClient);
    await tester.pump();
    expect(find.textContaining('今日旅行团加载失败'), findsOneWidget);
    expect(find.text('重试'), findsOneWidget);

    await tester.tap(find.text('重试'));
    await tester.pump();
    await tester.pump();
    expect(apiClient.callCount, 2);
    expect(find.text('暂无今日旅行团'), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets(
      'refreshes every 30 seconds and on resume without blanking data or stacking timers',
      (tester) async {
    final apiClient = _TodayApiClient((call) async {
      if (call == 2) {
        throw const ApiException(
          statusCode: 503,
          code: 'TEMPORARY_FAILURE',
          message: '暂时不可用',
        );
      }
      return _payload([
        {
          'licensePlate': '贵A0000$call',
          'tasterName': '品鉴师$call',
          'tastingRoomNo': 'A$call',
          'cigaretteFeeCents': call * 100,
        },
      ]);
    });

    await _pumpPage(tester, apiClient, token: 'token-1');
    await tester.pump();
    expect(find.text('贵A00001'), findsOneWidget);

    await tester.pump(const Duration(seconds: 30));
    await tester.pump();
    expect(apiClient.callCount, 2);
    expect(find.text('贵A00001'), findsOneWidget);
    expect(find.text('重新加载'), findsOneWidget);

    await tester.tap(find.text('重新加载'));
    await tester.pump();
    await tester.pump();
    expect(apiClient.callCount, 3);
    expect(find.text('贵A00003'), findsOneWidget);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    await tester.pump();
    expect(apiClient.callCount, 4);
    expect(find.text('贵A00004'), findsOneWidget);

    await _pumpPage(tester, apiClient, token: 'token-2');
    await tester.pump();
    expect(apiClient.callCount, 5);

    await tester.pump(const Duration(seconds: 30));
    await tester.pump();
    expect(apiClient.callCount, 6);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 60));
    expect(apiClient.callCount, 6);
  });

  testWidgets('does not overlap periodic or resume refresh requests',
      (tester) async {
    final pendingRefresh = Completer<Map<String, dynamic>>();
    final apiClient = _TodayApiClient((call) {
      if (call == 1) {
        return Future.value(_payload([_group('initial')]));
      }
      return pendingRefresh.future;
    });

    await _pumpPage(tester, apiClient);
    await tester.pump();

    await tester.pump(const Duration(seconds: 30));
    expect(apiClient.callCount, 2);
    expect(find.text('initial'), findsOneWidget);

    await tester.pump(const Duration(seconds: 60));
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(apiClient.callCount, 2);
    expect(find.text('initial'), findsOneWidget);

    pendingRefresh.complete(_payload([_group('refreshed')]));
    await tester.pump();
    expect(find.text('refreshed'), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
  });
}

Future<void> _pumpPage(
  WidgetTester tester,
  _TodayApiClient apiClient, {
  String token = 'front-token',
}) {
  return tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: TodayTravelGroupsPage(
          apiClient: apiClient,
          token: token,
        ),
      ),
    ),
  );
}

Map<String, dynamic> _payload(List<Map<String, dynamic>> groups) {
  return {
    'data': {
      'travelGroups': groups,
    },
  };
}

Map<String, dynamic> _group(
  String groupNo, {
  String? arrivalTime,
  String? expectedArrivalTime,
}) {
  return {
    'arrivalTime': arrivalTime,
    'licensePlate': '贵A-$groupNo',
    'tasterName': '品鉴师',
    'tastingRoomNo': 'A01',
    'cigaretteFeeCents': 100,
    'groupNo': groupNo,
    'expectedArrivalTime': expectedArrivalTime,
  };
}

class _TodayApiClient extends ApiClient {
  _TodayApiClient(this.responder) : super(baseUrl: 'http://127.0.0.1:3000');

  final Future<Map<String, dynamic>> Function(int call) responder;
  final List<String> paths = [];
  int callCount = 0;

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) {
    paths.add(path);
    callCount += 1;
    return responder(callCount);
  }
}
