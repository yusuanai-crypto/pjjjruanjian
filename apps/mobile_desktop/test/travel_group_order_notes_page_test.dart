import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_group_order_notes/travel_group_order_notes_page.dart';

void main() {
  testWidgets('shows loss notes UI without order binding requests or controls',
      (tester) async {
    final apiClient = _FakeApiClient();
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

    expect(find.text('损耗与离店备注'), findsOneWidget);
    expect(find.text('绑定订单'), findsNothing);
    expect(find.text('暂无可绑定订单'), findsNothing);
    expect(find.byType(CheckboxListTile), findsNothing);
    expect(
      apiClient.getPaths.where(
        (path) => path.startsWith('/api/sales-orders'),
      ),
      isEmpty,
    );
  });

  testWidgets('clears departure time and only patches the travel group',
      (tester) async {
    final apiClient = _FakeApiClient();
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
    expect(find.text('已暂存，未完成项目继续保留为待销售。'), findsOneWidget);
  });

  testWidgets('adds canned wine without a product id and records the loss',
      (tester) async {
    final apiClient = _FakeApiClient();
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
  });

  testWidgets('confirms no loss explicitly instead of saving an empty list',
      (tester) async {
    final apiClient = _FakeApiClient();
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
    expect(find.text('离店时间与无损耗确认均已完成。'), findsOneWidget);
  });
}

class _FakeApiClient extends ApiClient {
  _FakeApiClient() : super(baseUrl: 'http://127.0.0.1:3000');

  final List<String> getPaths = [];
  final List<_PatchCall> patchCalls = [];

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    getPaths.add(path);
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
    if (path.startsWith('/api/travel-groups/')) {
      return {
        'data': {
          'travelGroup': {
            ..._travelGroupJson(),
            ...patchBody,
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
