import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_group_query/travel_group_query_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets('opens edit dialog and saves query page changes', (tester) async {
    final apiClient = _FakeApiClient();

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TravelGroupQueryPage(
            apiClient: apiClient,
            token: 'test-token',
            role: UserRole.sales,
            currentUserId: 'sales-1',
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();
    await tester.ensureVisible(find.widgetWithText(OutlinedButton, '编辑'));
    await _openEditDialog(tester);

    expect(find.text('TG20260629001 编辑'), findsOneWidget);
    expect(find.textContaining('预留编辑入口'), findsNothing);

    await tester.enterText(find.widgetWithText(TextFormField, '人数'), '30');
    await tester.tap(find.widgetWithText(FilledButton, '保存修改'));
    await tester.pumpAndSettle();

    expect(apiClient.lastPatchPath, '/api/travel-groups/group-1');
    expect(apiClient.lastPatchBody?['guestCount'], 30);
    expect(find.text('30 人'), findsOneWidget);
  });

  testWidgets('uses management title and ID based taster quick filters',
      (tester) async {
    final apiClient = _FakeApiClient(
      tasterId: 'actor-1',
      liaisonTasterId: 'liaison-1',
    );

    await _pumpQueryPage(
      tester,
      apiClient: apiClient,
      role: UserRole.taster,
      currentUserId: 'actor-1',
    );

    expect(find.text('旅行团管理'), findsOneWidget);
    expect(find.text('旅行团查询'), findsNothing);
    expect(find.text('全部旅行团'), findsOneWidget);
    expect(find.text('我对接的'), findsOneWidget);
    expect(find.text('我接的团'), findsOneWidget);
    expect(find.text('我参与的'), findsNothing);
    expect(find.text('我负责品鉴的'), findsNothing);
    expect(find.text('对接：赵对接'), findsOneWidget);
    expect(find.text('品鉴：王莉'), findsOneWidget);
    expect(find.text('预计：09:10'), findsOneWidget);
    expect(find.text('实际：9:25'), findsOneWidget);
    expect(find.byKey(const ValueKey('旅行社-__all__-2')), findsOneWidget);
    expect(find.byKey(const ValueKey('财务标记-__all__-3')), findsNothing);
    expect(find.byKey(const ValueKey('待处理状态-__all__-5')), findsNothing);

    var query = _travelGroupQuery(apiClient.travelGroupGetPaths.first);
    expect(query.containsKey('tasterId'), isFalse);
    expect(query.containsKey('liaisonTasterId'), isFalse);
    expect(query.containsKey('financeMark'), isFalse);
    expect(query.containsKey('pendingStatus'), isFalse);

    await tester.tap(find.byKey(const ValueKey('旅行社-__all__-2')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('876').last);
    await tester.pumpAndSettle();
    query = _travelGroupQuery(apiClient.travelGroupGetPaths.last);
    expect(query['travelAgency'], '876');
    expect(query.containsKey('financeMark'), isFalse);
    expect(query.containsKey('pendingStatus'), isFalse);

    await tester.tap(find.text('我对接的'));
    await tester.pumpAndSettle();
    query = _travelGroupQuery(apiClient.travelGroupGetPaths.last);
    expect(query['liaisonTasterId'], 'actor-1');
    expect(query.containsKey('tasterId'), isFalse);

    await tester.tap(find.text('我接的团'));
    await tester.pumpAndSettle();
    query = _travelGroupQuery(apiClient.travelGroupGetPaths.last);
    expect(query['tasterId'], 'actor-1');
    expect(query.containsKey('liaisonTasterId'), isFalse);
  });

  testWidgets('unrelated taster can view all fields but cannot edit',
      (tester) async {
    final apiClient = _FakeApiClient(
      tasterId: 'other-taster',
      liaisonTasterId: 'other-liaison',
    );

    await _pumpQueryPage(
      tester,
      apiClient: apiClient,
      role: UserRole.taster,
      currentUserId: 'actor-1',
    );

    expect(find.text('品鉴师只读'), findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, '编辑'), findsNothing);
    expect(find.text('对接品鉴师'), findsOneWidget);
    expect(find.text('重点客户信息'), findsOneWidget);
    expect(find.text('预计进店时间'), findsOneWidget);
    expect(find.text('实际进店时间'), findsOneWidget);
  });

  testWidgets('assigned taster edits only common customer fields',
      (tester) async {
    final apiClient = _FakeApiClient(
      tasterId: 'actor-1',
      liaisonTasterId: 'other-liaison',
    );

    await _pumpQueryPage(
      tester,
      apiClient: apiClient,
      role: UserRole.taster,
      currentUserId: 'actor-1',
    );
    await _openEditDialog(tester);

    final dialog = find.byType(AlertDialog);
    expect(_dialogText(dialog, '车牌号'), findsOneWidget);
    expect(_dialogText(dialog, '人数'), findsOneWidget);
    expect(_dialogText(dialog, '客源地'), findsOneWidget);
    expect(_dialogText(dialog, '年龄描述'), findsOneWidget);
    expect(_dialogText(dialog, '是否提及飞天'), findsOneWidget);
    expect(_dialogText(dialog, '前站出单情况'), findsOneWidget);
    expect(_dialogText(dialog, '重点客户信息'), findsOneWidget);
    expect(_dialogText(dialog, '进店日期'), findsNothing);
    expect(_dialogText(dialog, '导游'), findsNothing);
    expect(_dialogText(dialog, '预计进店时间'), findsNothing);
    expect(_dialogText(dialog, '品鉴馆号'), findsNothing);
    expect(_dialogText(dialog, '实际进店时间'), findsNothing);
    expect(_dialogText(dialog, '团型'), findsNothing);
  });

  testWidgets('liaison taster gets date guide and expected time union',
      (tester) async {
    final apiClient = _FakeApiClient(
      tasterId: 'actor-1',
      liaisonTasterId: 'actor-1',
    );

    await _pumpQueryPage(
      tester,
      apiClient: apiClient,
      role: UserRole.taster,
      currentUserId: 'actor-1',
    );
    await _openEditDialog(tester);

    final dialog = find.byType(AlertDialog);
    expect(_dialogText(dialog, '进店日期'), findsOneWidget);
    expect(_dialogText(dialog, '导游'), findsOneWidget);
    expect(_dialogText(dialog, '预计进店时间'), findsOneWidget);
    expect(_dialogText(dialog, '客源地'), findsOneWidget);
    expect(_dialogText(dialog, '旅行社'), findsNothing);
    expect(_dialogText(dialog, '品鉴馆号'), findsNothing);
    expect(_dialogText(dialog, '实际进店时间'), findsNothing);
    expect(_dialogText(dialog, '团型'), findsNothing);

    await tester.enterText(
      find.descendant(
        of: dialog,
        matching: find.widgetWithText(TextFormField, '预计进店时间'),
      ),
      '10:15',
    );
    await tester.tap(find.widgetWithText(FilledButton, '保存修改'));
    await tester.pumpAndSettle();

    expect(apiClient.lastPatchBody?['expectedArrivalTime'], '10:15');
    expect(apiClient.lastPatchBody?.containsKey('travelAgency'), isFalse);
    expect(apiClient.lastPatchBody?.containsKey('groupNo'), isFalse);
    expect(apiClient.lastPatchBody?.containsKey('tastingRoomNo'), isFalse);
    expect(apiClient.lastPatchBody?.containsKey('arrivalTime'), isFalse);
    expect(apiClient.lastPatchBody?.containsKey('groupType'), isFalse);
  });

  testWidgets('front desk can maintain both taster assignments',
      (tester) async {
    final apiClient = _FakeApiClient();

    await _pumpQueryPage(
      tester,
      apiClient: apiClient,
      role: UserRole.frontDesk,
      currentUserId: 'front-1',
    );
    await _openEditDialog(tester);

    final dialog = find.byType(AlertDialog);
    expect(_dialogText(dialog, '品鉴师'), findsOneWidget);
    expect(_dialogText(dialog, '对接品鉴师'), findsOneWidget);
    expect(_dialogText(dialog, '预计进店时间'), findsNothing);
  });
}

Future<void> _pumpQueryPage(
  WidgetTester tester, {
  required ApiClient apiClient,
  required UserRole role,
  required String currentUserId,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: TravelGroupQueryPage(
          apiClient: apiClient,
          token: 'test-token',
          role: role,
          currentUserId: currentUserId,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Finder _dialogText(Finder dialog, String text) {
  return find.descendant(of: dialog, matching: find.text(text));
}

Future<void> _openEditDialog(WidgetTester tester) async {
  final editButton = find.widgetWithText(OutlinedButton, '编辑');
  await tester.ensureVisible(editButton);
  await tester.pumpAndSettle();
  await tester.tap(editButton);
  await tester.pumpAndSettle();
}

Map<String, String> _travelGroupQuery(String path) {
  return Uri.parse('http://localhost$path').queryParameters;
}

class _FakeApiClient extends ApiClient {
  _FakeApiClient({
    this.tasterId = 'taster-1',
    this.liaisonTasterId = 'liaison-1',
  }) : super(baseUrl: 'http://127.0.0.1:3000');

  final String? tasterId;
  final String? liaisonTasterId;
  final List<String> travelGroupGetPaths = [];

  String? lastPatchPath;
  Map<String, dynamic>? lastPatchBody;

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    if (path == '/api/products/options') {
      return {
        'data': {
          'products': const [
            {'id': 'product-1', 'name': '酱香珍藏', 'unit': '瓶'},
          ],
        },
      };
    }
    if (path.startsWith('/api/travel-groups')) {
      travelGroupGetPaths.add(path);
      return {
        'data': {
          'travelGroups': [
            _travelGroupJson(
              tasterId: tasterId,
              liaisonTasterId: liaisonTasterId,
            ),
          ],
        },
      };
    }
    if (path.startsWith('/api/guides')) {
      return {
        'data': {
          'guides': [_guideJson()],
        },
      };
    }
    if (path.startsWith('/api/users/tasters')) {
      return {
        'data': {
          'tasters': [_tasterJson()],
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
    lastPatchPath = path;
    lastPatchBody = body;
    return {
      'data': {
        'travelGroup': {
          ..._travelGroupJson(
            tasterId: tasterId,
            liaisonTasterId: liaisonTasterId,
          ),
          ...?body,
        },
      },
    };
  }
}

Map<String, dynamic> _guideJson() {
  return {
    'id': 'guide-1',
    'name': '李导',
    'phone': '13900001111',
    'travelAgency': '876',
    'isActive': true,
  };
}

Map<String, dynamic> _tasterJson() {
  return {
    'id': 'taster-1',
    'name': '王莉',
    'username': 'taster_wang',
  };
}

Map<String, dynamic> _travelGroupJson({
  String? tasterId = 'taster-1',
  String? liaisonTasterId = 'liaison-1',
}) {
  return {
    'id': 'group-1',
    'kind': 'travel',
    'groupNo': 'TG20260629001',
    'visitDate': '2026-06-29',
    'travelAgency': '876',
    'licensePlate': '743',
    'guideId': 'guide-1',
    'guideName': '王莉',
    'guidePhone': '13900001111',
    'guestCount': 24,
    'tastingRoomNo': '5',
    'tasterId': tasterId,
    'tasterName': '王莉',
    'liaisonTasterId': liaisonTasterId,
    'liaisonTasterName': '赵对接',
    'sourceRegion': '遵义',
    'ageInfo': '40-55 岁',
    'mentionedFeitian': true,
    'previousStopOrderStatus': '熊猫',
    'keyCustomerInfo': '重点客户两位',
    'keyCustomerPhotos': const [],
    'guestInfoAttachments': const [],
    'expectedArrivalTime': '09:10',
    'arrivalTime': '9:25',
    'groupType': 'KB团',
    'wineDetails': '',
    'departureTime': '',
    'remarks': '',
    'status': 'unmarked',
    'financeMark': false,
    'pendingStatus': 'pending_taster',
    'pendingReasons': ['no_order_and_missing_taster_summary'],
    'tastingItems': [
      {
        'id': 'item-1',
        'productId': 'product-1',
        'productName': '酱香珍藏',
        'quantity': 2,
        'unit': '瓶',
        'note': '开瓶',
        'sortOrder': 1,
      },
    ],
    'salesOrders': const [],
    'orderSummary': const {
      'orderCount': 0,
      'totalAmountCents': 0,
      'cashOnDeliveryAmountCents': 0,
    },
  };
}
