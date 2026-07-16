import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_agency_management/travel_agency_management_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets('agency deduction rule selects agency product and sends ids only',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final client = _FakeAgencyRuleApiClient();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TravelAgencyManagementPage(
            apiClient: client,
            token: 'finance-token',
            role: UserRole.finance,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(
      find.byKey(const ValueKey('travel-agency-deduction-add-button')),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('travel-agency-deduction-product-field')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('product-option-product-1')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('travel-agency-deduction-cost-field')),
      '8.88',
    );
    await tester.enterText(
      find.byKey(const ValueKey('travel-agency-deduction-from-field')),
      '2026-07-01',
    );
    await tester.tap(
      find.byKey(const ValueKey('travel-agency-deduction-save-button')),
    );
    await tester.pumpAndSettle();

    expect(client.lastBody?['agencyId'], 'agency-1');
    expect(client.lastBody?['productId'], 'product-1');
    expect(client.lastBody?['deductionCostCents'], 888);
    expect(client.lastBody?.containsKey('agencyName'), isFalse);
    expect(client.lastBody?.containsKey('productName'), isFalse);
    expect(client.lastBody?.containsKey('unit'), isFalse);
  });
}

class _FakeAgencyRuleApiClient extends ApiClient {
  _FakeAgencyRuleApiClient() : super(baseUrl: 'http://127.0.0.1:3000');

  Map<String, dynamic>? lastBody;

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    final uri = Uri.parse(path);
    switch (uri.path) {
      case '/api/travel-agencies':
        return {
          'data': {
            'travelAgencies': const [
              {'id': 'agency-1', 'name': '测试旅行社'},
            ],
          },
        };
      case '/api/agency-rebate-rules':
        return {
          'data': {'agencyRebateRules': const []},
        };
      case '/api/agency-deduction-rules':
        return {
          'data': {'agencyDeductionRules': const []},
        };
      case '/api/products/options':
        return {
          'data': {
            'products': const [
              {'id': 'product-1', 'name': '测试酱酒', 'unit': '瓶'},
            ],
          },
        };
      default:
        throw StateError('Unexpected GET $path');
    }
  }

  @override
  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    if (path != '/api/agency-deduction-rules') {
      throw StateError('Unexpected POST $path');
    }
    lastBody = Map<String, dynamic>.from(body ?? const {});
    return {
      'data': {
        'agencyDeductionRule': {
          'id': 'rule-1',
          'agencyId': 'agency-1',
          'agencyName': '测试旅行社',
          'productId': 'product-1',
          'productName': '测试酱酒',
          ...?body,
        },
      },
    };
  }
}
