import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_group_order_notes/travel_group_order_notes_page.dart';

void main() {
  testWidgets('uses a read-only time picker field for departure time',
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

    final saveButton = find.widgetWithText(FilledButton, '保存明细与备注');
    await tester.ensureVisible(saveButton);
    await tester.tap(saveButton);
    await tester.pumpAndSettle();

    expect(apiClient.lastPatchPath, '/api/travel-groups/group-1');
    expect(apiClient.lastPatchBody?['departureTime'], '');
  });
}

class _FakeApiClient extends ApiClient {
  _FakeApiClient() : super(baseUrl: 'http://127.0.0.1:3000');

  String? lastPatchPath;
  Map<String, dynamic>? lastPatchBody;

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    if (path.startsWith('/api/travel-groups')) {
      return {
        'data': {
          'travelGroups': [_travelGroupJson()],
        },
      };
    }
    if (path.startsWith('/api/sales-orders')) {
      return {
        'data': {
          'salesOrders': [_salesOrderJson()],
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
    lastPatchPath = path;
    lastPatchBody = Map<String, dynamic>.from(body ?? const {});
    if (path.startsWith('/api/travel-groups/')) {
      return {
        'data': {
          'travelGroup': {
            ..._travelGroupJson(),
            ...lastPatchBody!,
          },
        },
      };
    }
    if (path.startsWith('/api/sales-orders/')) {
      return {
        'data': {
          'salesOrder': {
            ..._salesOrderJson(),
            ...lastPatchBody!,
          },
        },
      };
    }
    throw StateError('Unexpected PATCH $path');
  }
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

Map<String, dynamic> _salesOrderJson() {
  return {
    'id': 'order-1',
    'orderNo': 'SO20260630001',
    'orderType': 'travel_group',
    'orderDate': '2026-06-30',
    'customerId': 'customer-1',
    'customer': {
      'id': 'customer-1',
      'name': '张女士',
      'phone': '13800001111',
      'financeMark': false,
    },
    'customerName': '张女士',
    'customerPhone': '13800001111',
    'province': '贵州省',
    'city': '贵阳市',
    'district': '观山湖区',
    'address': '测试路 1 号',
    'travelGroupId': 'group-1',
    'travelGroup': _travelGroupJson(),
    'salesFormNo': 'XS-001',
    'totalAmountCents': 79800,
    'entryAmountCents': 76000,
    'tasterCommissionCents': 8800,
    'cashOnDeliveryAmountCents': 0,
    'status': 'valid',
    'deliverySummary': 'shipping',
    'packingStatus': 'pending',
    'packageCount': 1,
    'logisticsFeeCents': 0,
    'invoiceRequired': false,
    'invoiceIssued': false,
    'financeMark': false,
    'salesUserId': 'sales-1',
    'items': const [],
    'createdAt': null,
    'updatedAt': null,
  };
}
