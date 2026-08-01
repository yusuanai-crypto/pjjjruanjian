import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/app/destinations.dart';
import 'package:jiangjiu_mobile_desktop/app/page_factory.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/auth/auth_models.dart';
import 'package:jiangjiu_mobile_desktop/core/config/app_config.dart';
import 'package:jiangjiu_mobile_desktop/features/after_sales/after_sales_form_page.dart';
import 'package:jiangjiu_mobile_desktop/features/ai_assistant/ai_assistant_page.dart';
import 'package:jiangjiu_mobile_desktop/features/analytics/analytics_page.dart';
import 'package:jiangjiu_mobile_desktop/features/commission_rules/commission_rule_config_page.dart';
import 'package:jiangjiu_mobile_desktop/features/dashboard/dashboard_page.dart';
import 'package:jiangjiu_mobile_desktop/features/finance/finance_query_page.dart';
import 'package:jiangjiu_mobile_desktop/features/guide_management/guide_management_page.dart';
import 'package:jiangjiu_mobile_desktop/features/moutai_inventory/moutai_inventory_page.dart';
import 'package:jiangjiu_mobile_desktop/features/order_query/order_query_page.dart';
import 'package:jiangjiu_mobile_desktop/features/operation_logs/operation_logs_page.dart';
import 'package:jiangjiu_mobile_desktop/features/payment_methods/payment_method_management_page.dart';
import 'package:jiangjiu_mobile_desktop/features/product_management/product_management_page.dart';
import 'package:jiangjiu_mobile_desktop/features/profit_analysis/profit_analysis_page.dart';
import 'package:jiangjiu_mobile_desktop/features/reconciliation/reconciliation_table_page.dart';
import 'package:jiangjiu_mobile_desktop/features/role_menu/role_menu_page.dart';
import 'package:jiangjiu_mobile_desktop/features/sales_orders/order_form_entry_page.dart';
import 'package:jiangjiu_mobile_desktop/features/taster_commissions/taster_commission_page.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_agency_management/travel_agency_management_page.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_group_order_notes/travel_group_order_notes_page.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_group_query/travel_group_query_page.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_groups/travel_group_form_page.dart';
import 'package:jiangjiu_mobile_desktop/features/warehouse/warehouse_packing_page.dart';
import 'package:jiangjiu_mobile_desktop/features/warehouse_management/warehouse_management_page.dart';
import 'package:jiangjiu_mobile_desktop/features/warehouse_directory/warehouse_directory_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  test('uses unified travel group, loss notes, and taster menu labels', () {
    final managementDestination = appDestinations.singleWhere(
      (item) => item.id == 'travel_group_query',
    );
    final intakeDestination = appDestinations.singleWhere(
      (item) => item.id == 'travel_group_form',
    );
    final receptionDestination = appDestinations.singleWhere(
      (item) => item.id == 'taster_summary',
    );
    final commissionDestination = appDestinations.singleWhere(
      (item) => item.id == 'taster_commissions',
    );
    final orderNotesDestination = appDestinations.singleWhere(
      (item) => item.id == 'travel_group_order_notes',
    );
    final sharedOrderNotesEntry = sharedMenuEntries.singleWhere(
      (item) => item.id == 'travel_group_order_notes',
    );
    final financeDestination = appDestinations.singleWhere(
      (item) => item.id == 'finance_query',
    );
    final sharedFinanceEntry = sharedMenuEntries.singleWhere(
      (item) => item.id == 'finance_query',
    );

    expect(managementDestination.label, '旅行团管理');
    expect(intakeDestination.label, '旅行团录入');
    expect(receptionDestination.label, '我的接待');
    expect(commissionDestination.label, '我的提成');
    expect(orderNotesDestination.label, '损耗与离店备注');
    expect(sharedOrderNotesEntry.label, '损耗与离店备注');
    expect(financeDestination.label, '物流单号与品鉴师提成填写');
    expect(sharedFinanceEntry.label, '物流单号与品鉴师提成填写');
    expect(financeDestination.id, 'finance_query');
    expect(
      appDestinations.any(
        (item) => item.label == '旅行团查询' || item.label == '待处理旅行团',
      ),
      isFalse,
    );
    expect(
      sharedMenuEntries.any(
        (item) => item.label == '旅行团查询' || item.label == '待处理旅行团',
      ),
      isFalse,
    );
  });

  test('normalizes the compile-time API base URL configuration', () {
    expect(
      AppConfig.defaultApiBaseUrl,
      'https://api.gzjiangjiuguan.com',
    );
    expect(AppConfig.normalizeApiBaseUrl(''), AppConfig.defaultApiBaseUrl);
    expect(AppConfig.normalizeApiBaseUrl(' 127.0.0.1:3000/ '),
        'https://127.0.0.1:3000');
    expect(AppConfig.normalizeApiBaseUrl('https://api.example.com/v1/'),
        'https://api.example.com/v1');
  });

  test('maps backend menu ids to Flutter destinations', () {
    final adminIds = _destinationIds(
      [
        'employee_accounts',
        'travel_groups',
        'travel_group_query',
        'pending_travel_groups',
        'travel_agency_management',
        'sales_orders',
        'order_query',
        'finance_workspace',
        'commissions',
        'commission_rules',
        'product_management',
        'reconciliation_table',
        'warehouse_workspace',
        'after_sales_orders',
        'own_taster_receptions',
        'own_commissions',
      ],
      UserRole.admin,
    );

    expect(
      adminIds,
      containsAll([
        'employee_accounts',
        'travel_group_form',
        'travel_group_query',
        'travel_agency_management',
        'order_form',
        'order_query',
        'finance_query',
        'commission_rules',
        'product_management',
        'reconciliation_table',
        'warehouse_packing',
        'after_sales_form',
        'taster_summary',
        'analytics',
      ]),
    );
    expect(adminIds, isNot(contains('taster_commissions')));
    expect(adminIds, isNot(contains('pending_travel_groups')));

    final financeIds = _destinationIds(
      [
        'order_query',
        'finance_workspace',
        'commissions',
        'commission_rules',
        'after_sales_orders',
        'travel_agency_management',
        'product_management',
      ],
      UserRole.finance,
    );
    expect(
      financeIds,
      containsAll([
        'order_query',
        'finance_query',
        'commission_rules',
        'after_sales_form',
        'travel_agency_management',
        'product_management',
        'analytics',
      ]),
    );

    final salesIds = _destinationIds(
      [
        'travel_groups',
        'travel_group_query',
        'pending_travel_groups',
        'sales_orders',
        'order_query',
        'after_sales_orders',
      ],
      UserRole.sales,
    );
    expect(salesIds, isNot(contains('travel_group_form')));
    expect(
      salesIds,
      containsAll([
        'travel_group_query',
        'travel_group_order_notes',
        'order_form',
        'order_query',
      ]),
    );
    expect(salesIds, isNot(contains('pending_travel_groups')));
    expect(salesIds, isNot(contains('after_sales_form')));

    final bossIds = _destinationIds(
      [
        'order_query',
        'after_sales_orders',
        'finance_workspace',
        'commission_rules',
        'own_commissions',
        'warehouse_workspace',
      ],
      UserRole.boss,
    );
    expect(
      bossIds,
      containsAll([
        'order_query',
        'analytics',
      ]),
    );
    expect(bossIds, isNot(contains('after_sales_form')));
    expect(bossIds, isNot(contains('finance_query')));
    expect(bossIds, isNot(contains('reconciliation_table')));
    expect(bossIds, isNot(contains('warehouse_packing')));
    expect(bossIds, isNot(contains('commission_rules')));
    expect(bossIds, isNot(contains('taster_commissions')));

    final warehouseIds = _destinationIds(
      [
        'travel_group_query',
        'order_query',
        'warehouse_workspace',
        'after_sales_orders',
      ],
      UserRole.warehouse,
    );
    expect(
      warehouseIds,
      containsAll([
        'travel_group_query',
        'order_query',
        'warehouse_packing',
        'after_sales_form',
      ]),
    );

    final afterSalesIds = _destinationIds(
      ['travel_group_query', 'order_query', 'after_sales_orders', 'analytics'],
      UserRole.afterSales,
    );
    expect(
      afterSalesIds,
      containsAll([
        'travel_group_query',
        'order_query',
        'after_sales_form',
        'analytics',
      ]),
    );
    expect(afterSalesIds, isNot(contains('order_form')));

    final tasterIds = _destinationIds(
      ['travel_group_query', 'order_query', 'own_taster_receptions'],
      UserRole.taster,
    );
    expect(tasterIds, containsAll(['travel_group_query', 'order_query']));

    final financeRuleIds = _destinationIds(
      ['commission_rules'],
      UserRole.finance,
    );
    expect(financeRuleIds, contains('commission_rules'));

    final financeAgencyIds = _destinationIds(
      [
        'travel_agency_management',
        'agency_rebate_rules',
        'agency_deduction_rules'
      ],
      UserRole.finance,
    );
    expect(financeAgencyIds, contains('travel_agency_management'));
    expect(financeAgencyIds, isNot(contains('commission_rules')));

    final tasterStage7Ids = _destinationIds(
      [
        'commissions',
        'commission_rules',
        'own_commissions',
        'travel_agency_management',
      ],
      UserRole.taster,
    );
    expect(tasterStage7Ids, contains('taster_commissions'));
    expect(tasterStage7Ids, isNot(contains('finance_query')));
    expect(tasterStage7Ids, isNot(contains('commission_rules')));
    expect(tasterStage7Ids, isNot(contains('travel_agency_management')));

    for (final role in [
      UserRole.sales,
      UserRole.warehouse,
      UserRole.frontDesk,
    ]) {
      final ids = _destinationIds(
        ['commissions', 'commission_rules', 'own_commissions'],
        role,
      );
      expect(ids, isNot(contains('finance_query')));
      expect(ids, isNot(contains('commission_rules')));
      expect(ids, isNot(contains('taster_commissions')));
      expect(ids, isNot(contains('analytics')));
    }
  });

  test('phase 6 and 7 role menus expose only allowed business entries', () {
    expect(_roleIds(UserRole.afterSales), contains('after_sales_form'));
    expect(_roleIds(UserRole.afterSales), contains('travel_group_query'));
    expect(_roleIds(UserRole.afterSales), contains('analytics'));
    expect(_roleIds(UserRole.afterSales), contains('order_query'));
    expect(_roleIds(UserRole.afterSales), isNot(contains('order_form')));
    expect(_roleIds(UserRole.finance), contains('finance_query'));
    expect(_roleIds(UserRole.finance), contains('after_sales_form'));
    expect(_roleIds(UserRole.finance), contains('commission_rules'));
    expect(_roleIds(UserRole.finance), contains('travel_agency_management'));
    expect(_roleIds(UserRole.finance), contains('product_management'));
    expect(_roleIds(UserRole.admin), contains('finance_query'));
    expect(_roleIds(UserRole.admin), contains('commission_rules'));
    expect(_roleIds(UserRole.admin), contains('travel_agency_management'));
    expect(_roleIds(UserRole.admin), contains('product_management'));
    expect(_roleIds(UserRole.admin), contains('analytics'));
    expect(_roleIds(UserRole.boss), contains('analytics'));
    expect(_roleIds(UserRole.boss), isNot(contains('after_sales_form')));
    expect(_roleIds(UserRole.boss), isNot(contains('finance_query')));
    expect(_roleIds(UserRole.boss), isNot(contains('reconciliation_table')));
    expect(_roleIds(UserRole.boss), isNot(contains('warehouse_packing')));
    expect(_roleIds(UserRole.boss), isNot(contains('commission_rules')));
    expect(
        _roleIds(UserRole.boss), isNot(contains('travel_agency_management')));
    expect(_roleIds(UserRole.boss), isNot(contains('taster_commissions')));
    expect(_roleIds(UserRole.taster), contains('taster_commissions'));
    expect(_roleIds(UserRole.taster), contains('travel_group_query'));
    expect(_roleIds(UserRole.taster), contains('order_query'));
    expect(_roleIds(UserRole.taster), contains('taster_summary'));
    expect(_roleIds(UserRole.finance), contains('analytics'));
    expect(_roleIds(UserRole.warehouse), contains('warehouse_packing'));
    expect(_roleIds(UserRole.warehouse), contains('travel_group_query'));
    expect(_roleIds(UserRole.warehouse), contains('after_sales_form'));
    expect(_roleIds(UserRole.sales), isNot(contains('after_sales_form')));

    for (final role in [UserRole.frontDesk, UserRole.taster]) {
      expect(_roleIds(role), isNot(contains('after_sales_form')));
      expect(_roleIds(role), isNot(contains('finance_query')));
      expect(_roleIds(role), isNot(contains('commission_rules')));
      expect(_roleIds(role), isNot(contains('travel_agency_management')));
      expect(_roleIds(role), isNot(contains('product_management')));
      expect(_roleIds(role), isNot(contains('warehouse_packing')));
      expect(_roleIds(role), isNot(contains('analytics')));
    }
    for (final role in [
      UserRole.sales,
      UserRole.warehouse,
      UserRole.afterSales,
      UserRole.frontDesk,
      UserRole.taster,
      UserRole.boss,
    ]) {
      expect(_roleIds(role), isNot(contains('commission_rules')));
      expect(_roleIds(role), isNot(contains('travel_agency_management')));
    }
    for (final role in [
      UserRole.sales,
      UserRole.warehouse,
      UserRole.frontDesk,
    ]) {
      expect(_roleIds(role), isNot(contains('finance_query')));
      expect(_roleIds(role), isNot(contains('taster_commissions')));
      expect(_roleIds(role), isNot(contains('analytics')));
    }
    expect(_roleIds(UserRole.afterSales), isNot(contains('finance_query')));
    expect(
        _roleIds(UserRole.afterSales), isNot(contains('taster_commissions')));
  });

  test('pending travel groups has no destination or role menu entry', () {
    expect(
      appDestinations.any((item) => item.id == 'pending_travel_groups'),
      isFalse,
    );
    for (final role in UserRole.values) {
      expect(_roleIds(role), isNot(contains('pending_travel_groups')));
      expect(
        _destinationIds(['pending_travel_groups'], role),
        isNot(contains('pending_travel_groups')),
      );
    }
  });

  test('taster fallback keeps receptions and commissions with management', () {
    expect(
      _roleIds(UserRole.taster),
      containsAll([
        'travel_group_query',
        'order_query',
        'taster_summary',
        'taster_commissions',
      ]),
    );
  });

  testWidgets(
      'analytics menu is visible only to admin boss finance and after sales',
      (_) async {
    for (final role in [
      UserRole.admin,
      UserRole.boss,
      UserRole.finance,
      UserRole.afterSales,
    ]) {
      expect(_roleIds(role), contains('analytics'));
      expect(_destinationIds(['analytics'], role), contains('analytics'));
    }

    for (final role in [
      UserRole.sales,
      UserRole.warehouse,
      UserRole.frontDesk,
      UserRole.taster,
    ]) {
      expect(_roleIds(role), isNot(contains('analytics')));
      expect(
        _destinationIds(['analytics'], role),
        isNot(contains('analytics')),
      );
    }
  });

  test('profit analysis menu is visible only to admin super admin and boss',
      () {
    for (final role in [
      UserRole.superAdmin,
      UserRole.admin,
      UserRole.boss,
    ]) {
      expect(_roleIds(role), contains('profit_analysis'));
      expect(
        _destinationIds(['profit_analysis'], role),
        contains('profit_analysis'),
      );
    }
    for (final role in [
      UserRole.finance,
      UserRole.sales,
      UserRole.frontDesk,
      UserRole.warehouse,
      UserRole.afterSales,
      UserRole.taster,
    ]) {
      expect(_roleIds(role), isNot(contains('profit_analysis')));
      expect(
        _destinationIds(['profit_analysis'], role),
        isNot(contains('profit_analysis')),
      );
    }
  });

  testWidgets('ai assistant menu is visible only to stage 9 allowed roles',
      (_) async {
    for (final role in [
      UserRole.admin,
      UserRole.boss,
      UserRole.finance,
      UserRole.afterSales,
    ]) {
      expect(_roleIds(role), contains('ai_assistant'));
      expect(
        _destinationIds(['ai_assistant'], role),
        contains('ai_assistant'),
      );
    }

    for (final role in [
      UserRole.sales,
      UserRole.warehouse,
      UserRole.frontDesk,
      UserRole.taster,
    ]) {
      expect(_roleIds(role), isNot(contains('ai_assistant')));
      expect(
        _destinationIds(['ai_assistant'], role),
        isNot(contains('ai_assistant')),
      );
    }
  });

  testWidgets(
      'travel agency management menu is visible only to admin and finance',
      (_) async {
    for (final role in [UserRole.admin, UserRole.finance]) {
      expect(_roleIds(role), contains('travel_agency_management'));
      expect(
        _destinationIds(['travel_agency_management'], role),
        contains('travel_agency_management'),
      );
    }

    for (final role in [
      UserRole.sales,
      UserRole.warehouse,
      UserRole.afterSales,
      UserRole.frontDesk,
      UserRole.taster,
    ]) {
      expect(_roleIds(role), isNot(contains('travel_agency_management')));
      expect(
        _destinationIds(['travel_agency_management'], role),
        isNot(contains('travel_agency_management')),
      );
    }
  });

  testWidgets(
      'guide management menu is visible only to super admin admin and front desk',
      (_) async {
    for (final role in [
      UserRole.superAdmin,
      UserRole.admin,
      UserRole.frontDesk,
    ]) {
      expect(_roleIds(role), contains('guide_management'));
      expect(
        _destinationIds(['guide_management'], role),
        contains('guide_management'),
      );
    }

    for (final role in [
      UserRole.boss,
      UserRole.sales,
      UserRole.finance,
      UserRole.warehouse,
      UserRole.afterSales,
      UserRole.taster,
    ]) {
      expect(_roleIds(role), isNot(contains('guide_management')));
      expect(
        _destinationIds(['guide_management'], role),
        isNot(contains('guide_management')),
      );
    }
  });

  testWidgets('product management menu is visible only to admin and finance',
      (_) async {
    for (final role in [UserRole.admin, UserRole.finance]) {
      expect(_roleIds(role), contains('product_management'));
      expect(
        _destinationIds(['product_management'], role),
        contains('product_management'),
      );
    }
    for (final role in [
      UserRole.boss,
      UserRole.sales,
      UserRole.warehouse,
      UserRole.afterSales,
      UserRole.frontDesk,
      UserRole.taster,
    ]) {
      expect(_roleIds(role), isNot(contains('product_management')));
      expect(
        _destinationIds(['product_management'], role),
        isNot(contains('product_management')),
      );
    }
  });

  testWidgets(
      'payment method management is visible only to finance and administrators',
      (_) async {
    for (final role in [
      UserRole.superAdmin,
      UserRole.admin,
      UserRole.finance,
    ]) {
      expect(_roleIds(role), contains('payment_method_management'));
      expect(
        _destinationIds(['payment_method_management'], role),
        contains('payment_method_management'),
      );
    }
    for (final role in [
      UserRole.boss,
      UserRole.sales,
      UserRole.warehouse,
      UserRole.afterSales,
      UserRole.frontDesk,
      UserRole.taster,
    ]) {
      expect(_roleIds(role), isNot(contains('payment_method_management')));
      expect(
        _destinationIds(['payment_method_management'], role),
        isNot(contains('payment_method_management')),
      );
    }
  });

  test('falls back to role destinations when backend menus are unknown', () {
    final fallback = destinationsForBackendMenus(
      [_menu('unknown_backend_menu')],
      UserRole.finance,
    );

    expect(
      fallback.map((destination) => destination.id),
      destinationsForRole(UserRole.finance)
          .map((destination) => destination.id),
    );
  });

  test('inventory and compatibility destinations obey every role', () {
    const inventoryRoles = {
      UserRole.superAdmin,
      UserRole.admin,
      UserRole.finance,
      UserRole.boss,
      UserRole.warehouse,
    };
    const serializedRoles = {
      UserRole.superAdmin,
      UserRole.admin,
      UserRole.finance,
      UserRole.warehouse,
    };
    const packingRoles = {
      UserRole.superAdmin,
      UserRole.admin,
      UserRole.warehouse,
    };

    for (final role in UserRole.values) {
      final ids = _destinationIds(
        [
          'warehouse_management',
          'warehouse_directory',
          'warehouse_workspace',
          'serialized_inventory',
        ],
        role,
      );
      expect(
        ids.contains('warehouse_management'),
        inventoryRoles.contains(role),
        reason: '${role.value} warehouse_management',
      );
      expect(
        ids.contains('warehouse_directory'),
        inventoryRoles.contains(role),
        reason: '${role.value} warehouse_directory',
      );
      expect(
        ids.contains('moutai_inventory'),
        serializedRoles.contains(role),
        reason: '${role.value} moutai_inventory',
      );
      expect(
        ids.contains('warehouse_packing'),
        packingRoles.contains(role),
        reason: '${role.value} warehouse_packing',
      );
    }
  });

  test('builds core pages for routed destination ids', () {
    expect(_page('dashboard'), isA<DashboardPage>());
    expect(_page('role_menu'), isA<RoleMenuPage>());
    expect(_page('operation_logs'), isA<OperationLogsPage>());
    expect(_page('travel_group_form'), isA<TravelGroupFormPage>());
    expect(_page('travel_group_query'), isA<TravelGroupQueryPage>());
    expect(_page('guide_management'), isA<GuideManagementPage>());
    expect(_page('travel_group_order_notes'), isA<TravelGroupOrderNotesPage>());
    expect(_page('order_form'), isA<OrderFormEntryPage>());
    expect(_page('order_query'), isA<OrderQueryPage>());
    expect(_page('finance_query'), isA<FinanceQueryPage>());
    expect(_page('commission_rules'), isA<CommissionRuleConfigPage>());
    expect(
      _page('payment_method_management'),
      isA<PaymentMethodManagementPage>(),
    );
    expect(
        _page('travel_agency_management'), isA<TravelAgencyManagementPage>());
    expect(_page('product_management'), isA<ProductManagementPage>());
    expect(_page('taster_commissions'), isA<TasterCommissionPage>());
    expect(_page('reconciliation_table'), isA<ReconciliationTablePage>());
    expect(_page('warehouse_packing'), isA<WarehousePackingPage>());
    expect(_page('warehouse_management'), isA<WarehouseManagementPage>());
    expect(_page('warehouse_directory'), isA<WarehouseDirectoryPage>());
    expect(_page('moutai_inventory'), isA<MoutaiInventoryPage>());
    expect(_page('after_sales_form'), isA<AfterSalesFormPage>());
    expect(_page('analytics'), isA<AnalyticsPage>());
    expect(_page('profit_analysis'), isA<ProfitAnalysisPage>());
    expect(_page('ai_assistant'), isA<AiAssistantPage>());
  });
}

List<String> _destinationIds(List<String> menuIds, UserRole role) {
  return destinationsForBackendMenus(
    menuIds.map(_menu).toList(),
    role,
  ).map((destination) => destination.id).toList();
}

AuthMenu _menu(String id) => AuthMenu(id: id, title: id, phase: 1);

List<String> _roleIds(UserRole role) {
  return destinationsForRole(role)
      .map((destination) => destination.id)
      .toList();
}

Widget _page(String destinationId) {
  return buildPageForDestination(
    destinationId: destinationId,
    apiClient: ApiClient(baseUrl: 'http://127.0.0.1:3000'),
    token: 'test-token',
    role: UserRole.admin,
    allowedDestinations: destinationsForRole(UserRole.admin),
    onOpenDestination: (_) {},
  );
}
