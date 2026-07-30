import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_group_order_notes/travel_group_order_notes_page.dart';

void main() {
  testWidgets('searches the queue by taster or exact tasting room',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpPage(tester, apiClient);

    expect(find.text('今日'), findsNothing);
    expect(find.text('品鉴师：测试品鉴师'), findsOneWidget);
    expect(find.text('品鉴馆号：5'), findsOneWidget);
    await tester.tap(
      find.byKey(const ValueKey('travel-group-notes-search-scope')),
    );
    await tester.pumpAndSettle();
    expect(find.text('品鉴师'), findsWidgets);
    expect(find.text('品鉴馆号'), findsOneWidget);
    expect(find.text('关键词'), findsNothing);
    expect(find.text('团号'), findsNothing);
    expect(find.text('旅行社'), findsNothing);
    expect(find.text('导游'), findsNothing);
    await tester.tap(find.text('品鉴师').last);
    await tester.pumpAndSettle();

    await tester.tap(
      find.byKey(const ValueKey('travel-group-notes-taster-field')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('测试品鉴师').last);
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('travel-group-notes-search-button')),
    );
    await tester.pumpAndSettle();

    var uri = Uri.parse(
      apiClient.getPaths
          .where((path) => path.startsWith('/api/travel-groups'))
          .last,
    );
    expect(uri.queryParameters['tasterId'], 'taster-1');
    expect(uri.queryParameters.containsKey('tastingRoomNo'), isFalse);
    expect(uri.queryParameters.containsKey('keyword'), isFalse);
    expect(uri.queryParameters.containsKey('dateFrom'), isFalse);
    expect(uri.queryParameters.containsKey('dateTo'), isFalse);

    await tester.tap(
      find.byKey(const ValueKey('travel-group-notes-search-scope')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('品鉴馆号').last);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(
        const ValueKey('travel-group-notes-tasting-room-no-field'),
      ),
      ' 5 ',
    );
    await tester.pump();
    await tester.tap(
      find.byKey(const ValueKey('travel-group-notes-search-button')),
    );
    await tester.pumpAndSettle();

    uri = Uri.parse(
      apiClient.getPaths
          .where((path) => path.startsWith('/api/travel-groups'))
          .last,
    );
    expect(uri.queryParameters['tastingRoomNo'], '5');
    expect(uri.queryParameters.containsKey('tasterId'), isFalse);
    expect(uri.queryParameters.containsKey('keyword'), isFalse);
    expect(uri.queryParameters.containsKey('dateFrom'), isFalse);
    expect(uri.queryParameters.containsKey('dateTo'), isFalse);

    await _openEditor(tester);
  });

  testWidgets('opens an editor dialog instead of a persistent form',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpPage(tester, apiClient);

    expect(
        find.byKey(const ValueKey('travel-group-notes-editor')), findsNothing);
    expect(find.byKey(const ValueKey('departure-time-field')), findsNothing);
    expect(
      find.widgetWithText(FilledButton, '保存损耗与备注'),
      findsNothing,
    );
    expect(find.text('绑定订单'), findsNothing);
    expect(find.text('暂无可绑定订单'), findsNothing);
    expect(find.byType(CheckboxListTile), findsNothing);
    expect(
      apiClient.getPaths.where(
        (path) => path.startsWith('/api/sales-orders'),
      ),
      isEmpty,
    );

    await _openEditor(tester);

    expect(find.byType(Dialog), findsOneWidget);
    expect(find.text('损耗与离店备注'), findsOneWidget);
    expect(find.byKey(const ValueKey('departure-time-field')), findsOneWidget);
    expect(
      find.widgetWithText(FilledButton, '保存损耗与备注'),
      findsOneWidget,
    );
  });

  testWidgets('clears departure time and only patches the travel group',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpPage(tester, apiClient);
    await _openEditor(tester);

    final fieldFinder = find.byKey(const ValueKey('departure-time-field'));
    expect(fieldFinder, findsOneWidget);
    expect(find.byIcon(Icons.access_time_rounded), findsOneWidget);
    final textFieldFinder = find.descendant(
      of: fieldFinder,
      matching: find.byType(TextFormField),
    );
    final field = tester.widget<TextFormField>(textFieldFinder);
    final editableText = tester.widget<EditableText>(
      find.descendant(of: fieldFinder, matching: find.byType(EditableText)),
    );
    expect(editableText.readOnly, isTrue);
    expect(field.controller?.text, '18:05');

    await tester.ensureVisible(fieldFinder);
    await tester.pumpAndSettle();
    await tester.tap(
      find.descendant(
        of: fieldFinder,
        matching: find.byIcon(Icons.close_rounded),
      ),
    );
    await tester.pumpAndSettle();
    expect(field.controller?.text, isEmpty);

    final saveButton = find.widgetWithText(FilledButton, '保存损耗与备注');
    await tester.ensureVisible(saveButton);
    await tester.tap(saveButton);
    await tester.pumpAndSettle();

    expect(apiClient.patchCalls, hasLength(1));
    expect(apiClient.patchCalls.single.path, '/api/travel-groups/group-1');
    expect(
      apiClient.patchCalls.where(
        (call) => call.path.startsWith('/api/sales-orders/'),
      ),
      isEmpty,
    );
    expect(
      apiClient.patchCalls.single.body.containsKey('tastingItems'),
      isFalse,
    );
    expect(apiClient.patchCalls.single.body, containsPair('departureTime', ''));
    expect(apiClient.patchCalls.single.body, containsPair('remarks', ''));
    expect(
        find.byKey(const ValueKey('travel-group-notes-editor')), findsNothing);
    expect(find.textContaining('保存成功'), findsWidgets);
  });

  testWidgets('save closes the editor and refreshes the list loss status',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpPage(tester, apiClient);

    await tester.tap(find.text('全部'));
    await tester.pumpAndSettle();
    await _openEditor(tester);

    final addCannedWine = find.byKey(
      const ValueKey('tasting_items_add_canned_wine'),
    );
    await tester.ensureVisible(addCannedWine);
    await tester.tap(addCannedWine);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('tasting_quantity_0')), findsOneWidget);

    final saveButton = find.widgetWithText(FilledButton, '保存损耗与备注');
    await tester.ensureVisible(saveButton);
    await tester.tap(saveButton);
    await tester.pumpAndSettle();

    final items =
        apiClient.patchCalls.single.body['tastingItems'] as List<dynamic>;
    expect(items, hasLength(1));
    expect(items.single, containsPair('productId', null));
    expect(items.single, containsPair('productName', '罐装酒'));
    expect(items.single, containsPair('quantity', 1));
    expect(items.single, containsPair('unit', '瓶'));
    expect(
        find.byKey(const ValueKey('travel-group-notes-editor')), findsNothing);
    expect(find.text('已记录损耗'), findsOneWidget);
    expect(find.text('保存成功：TG20260630001'), findsWidgets);
  });

  testWidgets('confirms no loss explicitly instead of saving an empty list',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpPage(tester, apiClient);
    await _openEditor(tester);

    final confirmButton = find.byKey(const ValueKey('confirm-no-loss'));
    await tester.ensureVisible(confirmButton);
    await tester.tap(confirmButton);
    await tester.pumpAndSettle();

    expect(apiClient.patchCalls, hasLength(1));
    expect(
      apiClient.patchCalls.single.body,
      containsPair('lossStatus', 'NO_LOSS'),
    );
    expect(
      apiClient.patchCalls.single.body.containsKey('tastingItems'),
      isFalse,
    );
    expect(
        find.byKey(const ValueKey('travel-group-notes-editor')), findsNothing);
    expect(find.textContaining('保存成功'), findsWidgets);
  });

  testWidgets('asks before closing an editor with unsaved changes',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpPage(tester, apiClient);
    await _openEditor(tester);

    final remarksField = find.byWidgetPredicate(
      (widget) => widget is TextField && widget.decoration?.labelText == '离店备注',
    );
    await tester.ensureVisible(remarksField);
    await tester.enterText(remarksField, '尚未保存的备注');
    await tester.pump();

    await tester.tap(
      find.byKey(const ValueKey('travel-group-notes-editor-close')),
    );
    await tester.pumpAndSettle();

    expect(find.text('放弃未保存修改？'), findsOneWidget);
    expect(find.byKey(const ValueKey('travel-group-notes-editor')),
        findsOneWidget);

    await tester.tap(find.text('继续编辑'));
    await tester.pumpAndSettle();
    expect(find.text('尚未保存的备注'), findsOneWidget);

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('放弃未保存修改？'), findsOneWidget);

    await tester.tap(find.text('继续编辑'));
    await tester.pumpAndSettle();
    await tester.tapAt(const Offset(4, 4));
    await tester.pumpAndSettle();
    expect(find.text('放弃未保存修改？'), findsOneWidget);

    await tester.tap(find.text('放弃修改'));
    await tester.pumpAndSettle();

    expect(
        find.byKey(const ValueKey('travel-group-notes-editor')), findsNothing);
  });

  testWidgets('keeps input and shows the backend reason when save fails',
      (tester) async {
    final apiClient = _FakeApiClient(
      patchError: const ApiException(
        statusCode: 400,
        code: 'SAVE_FAILED',
        message: '后端返回的具体错误原因',
      ),
    );
    await _pumpPage(tester, apiClient);
    await _openEditor(tester);

    final remarksField = find.byWidgetPredicate(
      (widget) => widget is TextField && widget.decoration?.labelText == '离店备注',
    );
    await tester.ensureVisible(remarksField);
    await tester.enterText(remarksField, '失败后也要保留');
    await tester.pump();

    final saveButton = find.widgetWithText(FilledButton, '保存损耗与备注');
    await tester.ensureVisible(saveButton);
    await tester.tap(saveButton);
    await tester.pumpAndSettle();

    expect(find.text('保存失败'), findsOneWidget);
    expect(find.text('后端返回的具体错误原因'), findsOneWidget);
    expect(find.byKey(const ValueKey('travel-group-notes-editor')),
        findsOneWidget);

    await tester.tap(find.text('知道了'));
    await tester.pumpAndSettle();
    expect(find.text('失败后也要保留'), findsOneWidget);
  });

  testWidgets('uses a scrollable bottom sheet on a narrow screen',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpPage(
      tester,
      apiClient,
      size: const Size(390, 844),
    );

    await _openEditor(tester);

    expect(find.byType(BottomSheet), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('travel-group-notes-editor')),
        matching: find.byType(SingleChildScrollView),
      ),
      findsOneWidget,
    );
  });
}

Future<void> _pumpPage(
  WidgetTester tester,
  _FakeApiClient apiClient, {
  Size size = const Size(1200, 900),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: TravelGroupOrderNotesPage(
          apiClient: apiClient,
          token: 'test-token',
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _openEditor(WidgetTester tester) async {
  await tester.tap(find.text('TG20260630001').first);
  await tester.pumpAndSettle();
  expect(
    find.byKey(const ValueKey('travel-group-notes-editor')),
    findsOneWidget,
  );
}

class _FakeApiClient extends ApiClient {
  _FakeApiClient({this.patchError}) : super(baseUrl: 'http://127.0.0.1:3000');

  final List<String> getPaths = [];
  final List<_PatchCall> patchCalls = [];
  final Object? patchError;

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    getPaths.add(path);
    if (path == '/api/users/tasters') {
      return {
        'data': {
          'tasters': const [
            {
              'id': 'taster-1',
              'name': '测试品鉴师',
              'username': 'test-taster',
            },
          ],
        },
      };
    }
    if (path.startsWith('/api/travel-groups')) {
      return {
        'data': {
          'travelGroups': [_travelGroupJson()],
        },
      };
    }
    if (path == '/api/products/options') {
      return {
        'data': {
          'products': const [
            {'id': 'product-1', 'name': '酱香珍藏', 'unit': '瓶'},
          ],
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
    final patchBody = Map<String, dynamic>.from(body ?? const {});
    patchCalls.add(_PatchCall(path, patchBody));
    if (patchError != null) {
      throw patchError!;
    }
    if (path.startsWith('/api/travel-groups/')) {
      final tastingItems = patchBody['tastingItems'];
      return {
        'data': {
          'travelGroup': {
            ..._travelGroupJson(),
            ...patchBody,
            if (tastingItems is List && tastingItems.isNotEmpty)
              'lossStatus': 'RECORDED',
          },
        },
      };
    }
    throw StateError('Unexpected PATCH $path');
  }
}

class _PatchCall {
  const _PatchCall(this.path, this.body);

  final String path;
  final Map<String, dynamic> body;
}

Map<String, dynamic> _travelGroupJson() {
  return {
    'id': 'group-1',
    'kind': 'travel',
    'groupNo': 'TG20260630001',
    'visitDate': '2026-06-30',
    'travelAgency': '测试旅行社',
    'licensePlate': '贵A12345',
    'guideId': 'guide-1',
    'guideName': '李导',
    'guidePhone': '13900001111',
    'guestCount': 20,
    'tastingRoomNo': '5',
    'tasterId': 'taster-1',
    'tasterName': '测试品鉴师',
    'sourceRegion': '遵义',
    'ageInfo': '40-55',
    'mentionedFeitian': true,
    'previousStopOrderStatus': '已下单',
    'keyCustomerInfo': '重点客户',
    'keyCustomerPhotos': const [],
    'guestInfoAttachments': const [],
    'liaisonTasterId': 'liaison-1',
    'liaisonTasterName': '对接品鉴师',
    'expectedArrivalTime': '09:10',
    'arrivalTime': '09:25',
    'groupType': 'KB团',
    'wineDetails': '',
    'departureTime': '18:05',
    'remarks': '',
    'lossStatus': 'PENDING',
    'lossConfirmedAt': null,
    'lossConfirmedById': null,
    'status': 'ordered',
    'salesAmountCents': 79800,
    'paidDepositCents': 0,
    'cashOnDeliveryCents': 0,
    'liquorCostDeductionCents': 0,
    'orderAmountCents': 79800,
    'points': 0,
    'returnedPoints': 0,
    'unreturnedPoints': 0,
    'guideInfoSent': false,
    'travelAgencyInfoSent': false,
    'financeMark': false,
    'markedById': null,
    'markedAt': null,
    'tasterSummary': null,
    'tasterSummaryAt': null,
    'tastingItems': const [],
    'salesOrders': const [],
    'orderSummary': const {
      'orderCount': 1,
      'totalAmountCents': 79800,
      'cashOnDeliveryAmountCents': 0,
    },
    'pendingStatus': null,
    'pendingReasons': const [],
    'createdAt': null,
    'updatedAt': null,
  };
}
