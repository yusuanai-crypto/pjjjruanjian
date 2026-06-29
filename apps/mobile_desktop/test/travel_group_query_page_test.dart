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
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();
    await tester.ensureVisible(find.widgetWithText(OutlinedButton, '编辑'));
    await tester.tap(find.widgetWithText(OutlinedButton, '编辑'));
    await tester.pumpAndSettle();

    expect(find.text('TG20260629001 编辑'), findsOneWidget);
    expect(find.textContaining('预留编辑入口'), findsNothing);

    await tester.enterText(find.widgetWithText(TextFormField, '人数'), '30');
    await tester.tap(find.widgetWithText(FilledButton, '保存修改'));
    await tester.pumpAndSettle();

    expect(apiClient.lastPatchPath, '/api/travel-groups/group-1');
    expect(apiClient.lastPatchBody?['guestCount'], 30);
    expect(find.text('30 人'), findsOneWidget);
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
          ..._travelGroupJson(),
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

Map<String, dynamic> _travelGroupJson() {
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
    'tasterId': 'taster-1',
    'tasterName': '王莉',
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
