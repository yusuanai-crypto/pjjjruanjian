import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_agency_management/travel_agency_management_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets('agency deduction rule selects agency product and sends ids only',
      (tester) async {
    await _setWideSurface(tester);

    final client = _FakeAgencyRuleApiClient();
    await tester.pumpWidget(_page(client));
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

    expect(client.lastPath, '/api/agency-deduction-rules');
    expect(client.lastBody?['agencyId'], 'agency-1');
    expect(client.lastBody?['calculationMode'], 'manual_product_reference');
    expect(client.lastBody?['productId'], 'product-1');
    expect(client.lastBody?['deductionCostCents'], 888);
    expect(client.lastBody?.containsKey('agencyName'), isFalse);
    expect(client.lastBody?.containsKey('productName'), isFalse);
    expect(client.lastBody?.containsKey('unit'), isFalse);
    expect(find.textContaining('订单 2 笔'), findsOneWidget);
    expect(find.textContaining('已确认'), findsOneWidget);
  });

  testWidgets('agency deduction effective rate mode does not require product',
      (tester) async {
    await _setWideSurface(tester);

    final client = _FakeAgencyRuleApiClient();
    await tester.pumpWidget(_page(client));
    await tester.pumpAndSettle();

    await tester.tap(
      find.byKey(const ValueKey('travel-agency-deduction-add-button')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('有效销售额 × 30%'));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('travel-agency-deduction-product-field')),
      findsNothing,
    );
    await tester.enterText(
      find.byKey(const ValueKey('travel-agency-deduction-from-field')),
      '2026-07-01',
    );
    await tester.tap(
      find.byKey(const ValueKey('travel-agency-deduction-save-button')),
    );
    await tester.pumpAndSettle();

    expect(client.lastPath, '/api/agency-deduction-rules');
    expect(client.lastBody?['agencyId'], 'agency-1');
    expect(client.lastBody?['calculationMode'], 'effective_sales_rate');
    expect(client.lastBody?['deductionRate'], '0.3000');
    expect(client.lastBody?.containsKey('productId'), isFalse);
    expect(client.lastBody?.containsKey('deductionCostCents'), isFalse);
  });

  testWidgets('agency page batch add buttons import current agency rules',
      (tester) async {
    await _setWideSurface(tester);

    final client = _FakeAgencyRuleApiClient();
    await tester.pumpWidget(_page(client));
    await tester.pumpAndSettle();

    await tester.tap(
      find.byKey(const ValueKey('travel-agency-rebate-batch-add-button')),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('travel-agency-rule-import-submit-button')),
    );
    await tester.pumpAndSettle();

    expect(client.lastPath, '/api/agency-rebate-rules/batch-import');
    var rules = client.lastBody?['rules'] as List;
    expect(rules.single['agencyId'], 'agency-1');
    expect(rules.single['agencyName'], '测试旅行社');

    await tester.tap(
      find.byKey(
        const ValueKey('travel-agency-rule-import-result-close-button'),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(
      find.byKey(const ValueKey('travel-agency-deduction-batch-add-button')),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('travel-agency-rule-import-submit-button')),
    );
    await tester.pumpAndSettle();

    expect(client.lastPath, '/api/agency-deduction-rules/batch-import');
    rules = client.lastBody?['rules'] as List;
    expect(rules.first['agencyId'], 'agency-1');
    expect(rules.first['agencyName'], '测试旅行社');
    expect(rules.first['calculationMode'], 'effective_sales_rate');
    expect(rules.first.containsKey('productId'), isFalse);
    expect(rules[1]['calculationMode'], 'manual_product_reference');
    expect(rules[1]['productId'], 'replace-with-active-product-id');
  });
}

Widget _page(ApiClient client) {
  return MaterialApp(
    home: Scaffold(
      body: TravelAgencyManagementPage(
        apiClient: client,
        token: 'finance-token',
        role: UserRole.finance,
      ),
    ),
  );
}

Future<void> _setWideSurface(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1400, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

class _FakeAgencyRuleApiClient extends ApiClient {
  _FakeAgencyRuleApiClient() : super(baseUrl: 'http://127.0.0.1:3000');

  Map<String, dynamic>? lastBody;
  String? lastPath;

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
    lastPath = path;
    lastBody = Map<String, dynamic>.from(body ?? const {});
    if (path == '/api/agency-deduction-rules/batch-import' ||
        path == '/api/agency-rebate-rules/batch-import') {
      final rules = body?['rules'] as List? ?? const [];
      return {
        'data': {
          'importResult': {
            'totalCount': rules.length,
            'successCount': rules.length,
            'failureCount': 0,
            'createdIdsSample': const ['rule-imported'],
            'failureSamples': const [],
            'results': [
              for (var i = 0; i < rules.length; i++)
                {
                  'index': i,
                  'rowNumber': i + 1,
                  'success': true,
                  'rule': rules[i],
                },
            ],
          },
          'recalculation': _recalculationJson(),
        },
      };
    }
    if (path != '/api/agency-deduction-rules') {
      throw StateError('Unexpected POST $path');
    }
    return {
      'data': {
        'agencyDeductionRule': {
          'id': 'rule-1',
          'agencyId': 'agency-1',
          'agencyName': '测试旅行社',
          'calculationMode':
              body?['calculationMode'] ?? 'manual_product_reference',
          'deductionRate': body?['deductionRate'] ?? '0.3000',
          'productId': body?['productId'],
          'productName':
              body?['calculationMode'] == 'effective_sales_rate' ? '' : '测试酱酒',
          'deductionCostCents': body?['deductionCostCents'] ?? 0,
          'effectiveFrom': body?['effectiveFrom'] ?? '2026-07-01',
          'effectiveTo': body?['effectiveTo'],
          'isActive': body?['isActive'] ?? true,
          'notes': body?['notes'],
        },
        'recalculation': _recalculationJson(),
      },
    };
  }
}

Map<String, dynamic> _recalculationJson() {
  return {
    'source': 'agency_deduction_rules.create',
    'orderCount': 2,
    'travelGroupCount': 1,
    'successCount': 1,
    'failureCount': 0,
    'skippedCount': 1,
    'skippedConfirmedCount': 1,
    'skippedManualOverrideCount': 0,
    'generatedRecords': const [],
    'updatedRecords': const [],
    'unchangedRecords': const [],
    'travelGroupFinanceSummaries': const [],
    'warnings': const [
      {
        'code': 'agency_deduction_confirmed',
        'message': '该旅行团扣酒成本已确认，规则自动重算已跳过。',
      },
    ],
  };
}
