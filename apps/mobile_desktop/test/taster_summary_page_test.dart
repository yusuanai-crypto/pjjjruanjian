import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/taster_summary/taster_summary_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets('loads real travel groups instead of static samples',
      (tester) async {
    final apiClient = _FakeApiClient();

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TasterSummaryPage(
            apiClient: apiClient,
            token: 'test-token',
            role: UserRole.taster,
            currentUserId: 'current-taster-1',
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(apiClient.travelGroupGetPaths, isNotEmpty);
    final query = Uri.parse(
      'http://localhost${apiClient.travelGroupGetPaths.first}',
    ).queryParameters;
    expect(query['tasterId'], 'current-taster-1');
    expect(query.containsKey('liaisonTasterId'), isFalse);
    expect(find.text('TG-REAL-001'), findsWidgets);
    expect(find.text('GZ-0622-018'), findsNothing);
  });
}

class _FakeApiClient extends ApiClient {
  _FakeApiClient() : super(baseUrl: 'http://127.0.0.1:3000');

  final List<String> travelGroupGetPaths = [];

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    if (path.startsWith('/api/travel-groups')) {
      travelGroupGetPaths.add(path);
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
}

Map<String, dynamic> _guideJson() {
  return {
    'id': 'guide-1',
    'name': 'Guide Wang',
    'phone': '13900001111',
    'travelAgency': 'Real Agency',
    'isActive': true,
  };
}

Map<String, dynamic> _tasterJson() {
  return {
    'id': 'current-taster-1',
    'name': 'Current Taster',
    'username': 'current.taster',
  };
}

Map<String, dynamic> _travelGroupJson() {
  return {
    'id': 'group-real-1',
    'kind': 'travel',
    'groupNo': 'TG-REAL-001',
    'visitDate': '2026-07-01',
    'travelAgency': 'Real Agency',
    'licensePlate': 'A12345',
    'guideId': 'guide-1',
    'guideName': 'Guide Wang',
    'guidePhone': '13900001111',
    'guestCount': 16,
    'tastingRoomNo': '101',
    'tasterId': 'current-taster-1',
    'tasterName': 'Current Taster',
    'liaisonTasterId': 'liaison-taster-1',
    'liaisonTasterName': 'Liaison Taster',
    'sourceRegion': 'Region A',
    'ageInfo': '30-45',
    'mentionedFeitian': false,
    'previousStopOrderStatus': 'None',
    'keyCustomerInfo': 'VIP customer',
    'keyCustomerPhotos': const [],
    'guestInfoAttachments': const [],
    'expectedArrivalTime': '09:30',
    'arrivalTime': '09:40',
    'groupType': 'regular',
    'wineDetails': '',
    'departureTime': '',
    'remarks': '',
    'status': 'unmarked',
    'financeMark': false,
    'pendingStatus': 'pending_taster',
    'pendingReasons': const ['no_order_and_missing_taster_summary'],
    'tastingItems': const [],
    'salesOrders': const [],
    'orderSummary': const {
      'orderCount': 0,
      'totalAmountCents': 0,
      'cashOnDeliveryAmountCents': 0,
    },
  };
}
