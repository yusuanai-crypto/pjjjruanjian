import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/commission_rules/commission_rule_config_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets('finance can create edit disable and import stage 7 rules',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final apiClient = _FakeRuleApiClient();
    await tester.pumpWidget(_page(apiClient, UserRole.finance));
    await tester.pumpAndSettle();

    expect(
        apiClient.getPaths.map((path) => Uri.parse(path).path),
        containsAll([
          '/api/commission-rules',
          '/api/sales-deduction-rules',
          '/api/agency-deduction-rules',
          '/api/agency-rebate-rules',
        ]));
    expect(find.text('test sales commission'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('stage7-rule-add-button')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('stage7-rule-name-field')),
      'test new sales commission',
    );
    await tester.enterText(
      find.byKey(const ValueKey('stage7-rule-rate-field')),
      '0.0250',
    );
    await tester.enterText(
      find.byKey(const ValueKey('stage7-rule-effective-from-field')),
      '2026-07-01',
    );
    await tester.tap(find.byKey(const ValueKey('stage7-rule-save-button')));
    await tester.pumpAndSettle();

    expect(apiClient.postPaths.last, '/api/commission-rules');
    expect(apiClient.lastPostBody?['ruleName'], 'test new sales commission');
    expect(apiClient.lastPostBody?['rate'], '0.0250');

    _pressTextButton(
      tester,
      const ValueKey('stage7-rule-edit-commission-rule-commission-1'),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('stage7-rule-rate-field')),
      '0.0300',
    );
    await tester.tap(find.byKey(const ValueKey('stage7-rule-save-button')));
    await tester.pumpAndSettle();

    expect(
        apiClient.patchPaths.last, '/api/commission-rules/rule-commission-1');
    expect(apiClient.lastPatchBody?['rate'], '0.0300');

    _pressTextButton(
      tester,
      const ValueKey('stage7-rule-disable-commission-rule-commission-1'),
    );
    await tester.pumpAndSettle();

    expect(
        apiClient.patchPaths.last, '/api/commission-rules/rule-commission-1');
    expect(apiClient.lastPatchBody?['isActive'], isFalse);

    await tester
        .tap(find.byKey(const ValueKey('stage7-rule-tab-salesDeduction')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('stage7-rule-import-button')));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('stage7-rule-import-submit-button')),
    );
    await tester.pumpAndSettle();

    expect(apiClient.postPaths.last, '/api/sales-deduction-rules/batch-import');
    expect((apiClient.lastPostBody?['rules'] as List), isNotEmpty);
    expect(find.textContaining('RULE_EFFECTIVE_RANGE_OVERLAP'), findsOneWidget);
  });

  testWidgets('shows loading empty and error states for rule config',
      (tester) async {
    final loadGate = Completer<void>();
    final loadingClient = _FakeRuleApiClient(
      emptyResponses: true,
      loadGate: loadGate,
    );
    await tester.pumpWidget(_page(loadingClient, UserRole.finance));
    await tester.pump();

    expect(find.text('正在加载规则...'), findsOneWidget);

    loadGate.complete();
    await tester.pumpAndSettle();
    expect(find.textContaining('暂无员工提成规则'), findsOneWidget);

    await _tapRuleTab(tester, 'salesDeduction');
    expect(find.textContaining('暂无销售扣单规则'), findsOneWidget);

    await _tapRuleTab(tester, 'agencyDeduction');
    expect(find.textContaining('暂无旅行社扣酒规则'), findsOneWidget);

    await _tapRuleTab(tester, 'agencyRebate');
    expect(find.textContaining('暂无旅行社返点规则'), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();

    final errorClient = _FakeRuleApiClient(
      getError: const ApiException(
        statusCode: 403,
        code: 'FORBIDDEN',
        message: '无权查看第 7 阶段规则',
      ),
    );
    await tester.pumpWidget(_page(errorClient, UserRole.finance));
    await tester.pumpAndSettle();

    expect(find.textContaining('无权查看第 7 阶段规则'), findsOneWidget);
  });

  testWidgets('saves payloads for every stage 7 rule type', (tester) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final apiClient = _FakeRuleApiClient(emptyResponses: true);
    await tester.pumpWidget(_page(apiClient, UserRole.admin));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('stage7-rule-add-button')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('stage7-rule-name-field')),
      'test payload sales commission',
    );
    await tester.enterText(
      find.byKey(const ValueKey('stage7-rule-rate-field')),
      '0.0260',
    );
    await tester.enterText(
      find.byKey(const ValueKey('stage7-rule-effective-from-field')),
      '2026-07-01',
    );
    await tester.enterText(
      find.byKey(const ValueKey('stage7-rule-effective-to-field')),
      '2026-12-31',
    );
    await tester.enterText(
      find.byKey(const ValueKey('stage7-rule-notes-field')),
      'test commission payload note',
    );
    await tester.tap(find.byKey(const ValueKey('stage7-rule-save-button')));
    await tester.pumpAndSettle();

    expect(apiClient.postPaths.last, '/api/commission-rules');
    expect(
        apiClient.lastPostBody?['ruleName'], 'test payload sales commission');
    expect(apiClient.lastPostBody?['targetType'], 'sales_commission');
    expect(apiClient.lastPostBody?['rate'], '0.0260');
    expect(apiClient.lastPostBody?['effectiveFrom'], '2026-07-01');
    expect(apiClient.lastPostBody?['effectiveTo'], '2026-12-31');
    expect(apiClient.lastPostBody?['isActive'], isTrue);
    expect(apiClient.lastPostBody?['notes'], 'test commission payload note');

    await _tapRuleTab(tester, 'salesDeduction');
    await tester.tap(find.byKey(const ValueKey('stage7-rule-add-button')));
    await tester.pumpAndSettle();
    await _selectProduct(tester, 'product-1');
    await tester.enterText(
      find.byKey(const ValueKey('stage7-rule-cost-field')),
      '12.34',
    );
    await tester.enterText(
      find.byKey(const ValueKey('stage7-rule-effective-from-field')),
      '2026-07-02',
    );
    await tester.enterText(
      find.byKey(const ValueKey('stage7-rule-notes-field')),
      'test sales deduction payload note',
    );
    await tester.tap(find.byKey(const ValueKey('stage7-rule-save-button')));
    await tester.pumpAndSettle();

    expect(apiClient.postPaths.last, '/api/sales-deduction-rules');
    expect(apiClient.lastPostBody?['productId'], 'product-1');
    expect(apiClient.lastPostBody?.containsKey('productName'), isFalse);
    expect(apiClient.lastPostBody?['deductionCostCents'], 1234);
    expect(apiClient.lastPostBody?['effectiveFrom'], '2026-07-02');
    expect(
        apiClient.lastPostBody?['notes'], 'test sales deduction payload note');

    await _tapRuleTab(tester, 'agencyDeduction');
    await tester.tap(find.byKey(const ValueKey('stage7-rule-add-button')));
    await tester.pumpAndSettle();
    await _selectDropdownValue(
      tester,
      const ValueKey('stage7-rule-agency-field'),
      'test payload agency',
    );
    await _selectProduct(tester, 'product-2');
    await tester.enterText(
      find.byKey(const ValueKey('stage7-rule-cost-field')),
      '8.88',
    );
    await tester.enterText(
      find.byKey(const ValueKey('stage7-rule-effective-from-field')),
      '2026-07-03',
    );
    await tester.tap(find.byKey(const ValueKey('stage7-rule-save-button')));
    await tester.pumpAndSettle();

    expect(apiClient.postPaths.last, '/api/agency-deduction-rules');
    expect(apiClient.lastPostBody?['agencyId'], 'agency-payload-1');
    expect(apiClient.lastPostBody?.containsKey('agencyName'), isFalse);
    expect(apiClient.lastPostBody?['productId'], 'product-2');
    expect(apiClient.lastPostBody?.containsKey('productName'), isFalse);
    expect(apiClient.lastPostBody?['deductionCostCents'], 888);

    await _tapRuleTab(tester, 'agencyRebate');
    await tester.tap(find.byKey(const ValueKey('stage7-rule-add-button')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('stage7-rule-agency-id-field')),
      'agency-payload-2',
    );
    await tester.enterText(
      find.byKey(const ValueKey('stage7-rule-agency-name-field')),
      'test rebate agency',
    );
    await tester.enterText(
      find.byKey(const ValueKey('stage7-rule-daily-rate-field')),
      '0.0300',
    );
    await tester.enterText(
      find.byKey(const ValueKey('stage7-rule-monthly-rate-field')),
      '0.0200',
    );
    await tester.enterText(
      find.byKey(const ValueKey('stage7-rule-total-rate-field')),
      '0.0500',
    );
    await tester.enterText(
      find.byKey(const ValueKey('stage7-rule-effective-from-field')),
      '2026-07-04',
    );
    await tester.tap(find.byKey(const ValueKey('stage7-rule-save-button')));
    await tester.pumpAndSettle();

    expect(apiClient.postPaths.last, '/api/agency-rebate-rules');
    expect(apiClient.lastPostBody?['agencyId'], 'agency-payload-2');
    expect(apiClient.lastPostBody?['agencyName'], 'test rebate agency');
    expect(apiClient.lastPostBody?['dailyRebateRate'], '0.0300');
    expect(apiClient.lastPostBody?['monthlyRebateRate'], '0.0200');
    expect(apiClient.lastPostBody?['totalRebateRate'], '0.0500');
    expect(apiClient.lastPostBody?['effectiveFrom'], '2026-07-04');
  });

  testWidgets('boss can view rule config as read only', (tester) async {
    final apiClient = _FakeRuleApiClient();
    await tester.pumpWidget(_page(apiClient, UserRole.boss));
    await tester.pumpAndSettle();

    expect(find.text('test sales commission'), findsOneWidget);
    expect(find.byKey(const ValueKey('stage7-rule-add-button')), findsNothing);
    expect(
        find.byKey(const ValueKey('stage7-rule-import-button')), findsNothing);
    expect(
      find.byKey(
          const ValueKey('stage7-rule-edit-commission-rule-commission-1')),
      findsNothing,
    );
  });

  testWidgets('sales cannot access rule config', (tester) async {
    final apiClient = _FakeRuleApiClient();
    await tester.pumpWidget(_page(apiClient, UserRole.sales));
    await tester.pumpAndSettle();

    expect(apiClient.getPaths, isEmpty);
    expect(find.byKey(const ValueKey('stage7-rule-add-button')), findsNothing);
    expect(find.text('test sales commission'), findsNothing);
  });

  testWidgets('shows backend validation errors when editing a rule fails',
      (tester) async {
    final apiClient = _FakeRuleApiClient()..failPatch = true;
    await tester.pumpWidget(_page(apiClient, UserRole.finance));
    await tester.pumpAndSettle();

    _pressTextButton(
      tester,
      const ValueKey('stage7-rule-edit-commission-rule-commission-1'),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('stage7-rule-save-button')));
    await tester.pumpAndSettle();

    expect(find.textContaining('RULE_EFFECTIVE_RANGE_OVERLAP'), findsOneWidget);
  });
}

Widget _page(_FakeRuleApiClient apiClient, UserRole role) {
  return MaterialApp(
    home: Scaffold(
      body: CommissionRuleConfigPage(
        apiClient: apiClient,
        token: 'test-token',
        role: role,
      ),
    ),
  );
}

void _pressTextButton(WidgetTester tester, Key key) {
  final button = tester.widget<TextButton>(find.byKey(key));
  button.onPressed?.call();
}

Future<void> _tapRuleTab(WidgetTester tester, String kindName) async {
  final tab = find.byKey(ValueKey('stage7-rule-tab-$kindName'));
  await tester.ensureVisible(tab);
  await tester.tap(tab);
  await tester.pumpAndSettle();
}

Future<void> _selectProduct(WidgetTester tester, String productId) async {
  final field = find.byKey(const ValueKey('stage7-rule-product-field'));
  await tester.ensureVisible(field);
  await tester.tap(field);
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(ValueKey('product-option-$productId')));
  await tester.pumpAndSettle();
}

Future<void> _selectDropdownValue(
  WidgetTester tester,
  Key key,
  String label,
) async {
  final field = find.byKey(key);
  await tester.ensureVisible(field);
  await tester.tap(field);
  await tester.pumpAndSettle();
  await tester.tap(find.text(label).last);
  await tester.pumpAndSettle();
}

class _FakeRuleApiClient extends ApiClient {
  _FakeRuleApiClient({
    this.emptyResponses = false,
    this.getError,
    this.loadGate,
  }) : super(baseUrl: 'http://127.0.0.1:3000');

  final bool emptyResponses;
  final ApiException? getError;
  final Completer<void>? loadGate;
  bool failPatch = false;
  final getPaths = <String>[];
  final postPaths = <String>[];
  final patchPaths = <String>[];
  Map<String, dynamic>? lastPostBody;
  Map<String, dynamic>? lastPatchBody;

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    getPaths.add(path);
    if (loadGate != null) {
      await loadGate!.future;
    }
    if (getError != null) {
      throw getError!;
    }
    switch (Uri.parse(path).path) {
      case '/api/commission-rules':
        return {
          'data': {
            'commissionRules': emptyResponses ? const [] : [_commissionRule],
          },
        };
      case '/api/sales-deduction-rules':
        return {
          'data': {
            'salesDeductionRules':
                emptyResponses ? const [] : [_salesDeductionRule],
          },
        };
      case '/api/agency-deduction-rules':
        return {
          'data': {
            'agencyDeductionRules':
                emptyResponses ? const [] : [_agencyDeductionRule],
          },
        };
      case '/api/agency-rebate-rules':
        return {
          'data': {
            'agencyRebateRules':
                emptyResponses ? const [] : [_agencyRebateRule],
          },
        };
      case '/api/products/options':
        return {
          'data': {
            'products': const [
              {
                'id': 'product-1',
                'name': 'test payload liquor',
                'unit': 'bottle'
              },
              {
                'id': 'product-2',
                'name': 'test agency payload liquor',
                'unit': 'box'
              },
            ],
          },
        };
      case '/api/travel-agencies':
        return {
          'data': {
            'travelAgencies': const [
              {
                'id': 'agency-payload-1',
                'name': 'test payload agency',
              },
            ],
          },
        };
      default:
        return {'data': <String, dynamic>{}};
    }
  }

  @override
  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    postPaths.add(path);
    lastPostBody = Map<String, dynamic>.from(body ?? <String, dynamic>{});
    switch (Uri.parse(path).path) {
      case '/api/commission-rules':
        return {
          'data': {
            'commissionRule': {
              ..._commissionRule,
              ...?body,
              'id': 'rule-commission-new',
            },
          },
        };
      case '/api/sales-deduction-rules':
        return {
          'data': {
            'salesDeductionRule': {
              ..._salesDeductionRule,
              ...?body,
              'id': 'rule-sales-deduction-new',
            },
          },
        };
      case '/api/agency-deduction-rules':
        return {
          'data': {
            'agencyDeductionRule': {
              ..._agencyDeductionRule,
              ...?body,
              'id': 'rule-agency-deduction-new',
            },
          },
        };
      case '/api/agency-rebate-rules':
        return {
          'data': {
            'agencyRebateRule': {
              ..._agencyRebateRule,
              ...?body,
              'id': 'rule-agency-rebate-new',
            },
          },
        };
      case '/api/sales-deduction-rules/batch-import':
        return {
          'data': {
            'importResult': _importResult,
          },
        };
      default:
        return {'data': <String, dynamic>{}};
    }
  }

  @override
  Future<Map<String, dynamic>> patchJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    patchPaths.add(path);
    lastPatchBody = Map<String, dynamic>.from(body ?? <String, dynamic>{});
    if (failPatch) {
      throw const ApiException(
        statusCode: 400,
        code: 'RULE_EFFECTIVE_RANGE_OVERLAP',
        message: 'test overlap rule',
      );
    }
    final targetPath = Uri.parse(path).path;
    if (targetPath.startsWith('/api/commission-rules/')) {
      return {
        'data': {
          'commissionRule': {..._commissionRule, ...?body},
        },
      };
    }
    return {'data': <String, dynamic>{}};
  }
}

const _commissionRule = {
  'id': 'rule-commission-1',
  'ruleName': 'test sales commission',
  'targetType': 'sales_commission',
  'rate': '0.0200',
  'effectiveFrom': '2026-07-01',
  'effectiveTo': null,
  'isActive': true,
  'notes': 'test commission note',
};

const _salesDeductionRule = {
  'id': 'rule-sales-deduction-1',
  'productId': 'product-1',
  'productName': 'test liquor',
  'deductionCostCents': 1200,
  'effectiveFrom': '2026-07-01',
  'effectiveTo': null,
  'isActive': true,
  'notes': 'test sales deduction note',
};

const _agencyDeductionRule = {
  'id': 'rule-agency-deduction-1',
  'agencyId': 'agency-1',
  'agencyName': 'test agency',
  'productId': 'product-1',
  'productName': 'test liquor',
  'deductionCostCents': 800,
  'effectiveFrom': '2026-07-01',
  'effectiveTo': null,
  'isActive': true,
  'notes': 'test agency deduction note',
};

const _agencyRebateRule = {
  'id': 'rule-agency-rebate-1',
  'agencyId': 'agency-1',
  'agencyName': 'test agency',
  'dailyRebateRate': '0.0300',
  'monthlyRebateRate': '0.0200',
  'totalRebateRate': '0.0500',
  'effectiveFrom': '2026-07-01',
  'effectiveTo': null,
  'isActive': true,
  'notes': 'test agency rebate note',
};

const _importResult = {
  'totalCount': 2,
  'successCount': 1,
  'failureCount': 1,
  'createdIdsSample': ['rule-sales-deduction-2'],
  'failureSamples': [
    {
      'index': 1,
      'rowNumber': 2,
      'code': 'RULE_EFFECTIVE_RANGE_OVERLAP',
      'message': 'test overlap rule',
    },
  ],
  'results': [
    {
      'index': 0,
      'rowNumber': 1,
      'success': true,
      'rule': _salesDeductionRule,
    },
    {
      'index': 1,
      'rowNumber': 2,
      'success': false,
      'error': {
        'code': 'RULE_EFFECTIVE_RANGE_OVERLAP',
        'message': 'test overlap rule',
      },
    },
  ],
};
