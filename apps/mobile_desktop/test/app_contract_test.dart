import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/app/destinations.dart';
import 'package:jiangjiu_mobile_desktop/app/page_factory.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/auth/auth_models.dart';
import 'package:jiangjiu_mobile_desktop/core/config/app_config.dart';
import 'package:jiangjiu_mobile_desktop/features/dashboard/dashboard_page.dart';
import 'package:jiangjiu_mobile_desktop/features/finance/finance_query_page.dart';
import 'package:jiangjiu_mobile_desktop/features/order_query/order_query_page.dart';
import 'package:jiangjiu_mobile_desktop/features/pending_travel_groups/pending_travel_group_table_page.dart';
import 'package:jiangjiu_mobile_desktop/features/reconciliation/reconciliation_table_page.dart';
import 'package:jiangjiu_mobile_desktop/features/role_menu/role_menu_page.dart';
import 'package:jiangjiu_mobile_desktop/features/sales_orders/order_form_page.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_group_order_notes/travel_group_order_notes_page.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_groups/travel_group_form_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  test('normalizes API base URLs before they are stored on the client', () {
    expect(AppConfig.normalizeApiBaseUrl(''), AppConfig.defaultApiBaseUrl);
    expect(AppConfig.normalizeApiBaseUrl(' 127.0.0.1:3000/ '),
        'http://127.0.0.1:3000');
    expect(AppConfig.normalizeApiBaseUrl('https://api.example.com/v1/'),
        'https://api.example.com/v1');
  });

  test('maps backend menu ids to Flutter destinations', () {
    final adminIds = _destinationIds(
      [
        'employee_accounts',
        'travel_groups',
        'pending_travel_groups',
        'sales_orders',
        'order_query',
        'finance_workspace',
        'reconciliation_table',
        'warehouse_workspace',
        'after_sales_orders',
        'own_taster_receptions',
      ],
      UserRole.admin,
    );

    expect(
      adminIds,
      containsAll([
        'role_menu',
        'travel_group_form',
        'pending_travel_groups',
        'order_form',
        'order_query',
        'finance_query',
        'reconciliation_table',
        'warehouse_packing',
        'after_sales_form',
        'taster_summary',
      ]),
    );

    final salesIds = _destinationIds(
      ['travel_groups', 'pending_travel_groups', 'sales_orders', 'order_query'],
      UserRole.sales,
    );
    expect(salesIds, isNot(contains('travel_group_form')));
    expect(
      salesIds,
      containsAll([
        'pending_travel_groups',
        'travel_group_order_notes',
        'order_form',
        'order_query',
      ]),
    );
  });

  test('falls back to role destinations when backend menus are unknown', () {
    final fallback = destinationsForBackendMenus(
      [_menu('unknown_backend_menu')],
      UserRole.finance,
    );

    expect(
      fallback.map((destination) => destination.id),
      destinationsForRole(UserRole.finance).map((destination) => destination.id),
    );
  });

  test('builds core pages for routed destination ids', () {
    expect(_page('dashboard'), isA<DashboardPage>());
    expect(_page('role_menu'), isA<RoleMenuPage>());
    expect(_page('travel_group_form'), isA<TravelGroupFormPage>());
    expect(
        _page('pending_travel_groups'), isA<PendingTravelGroupTablePage>());
    expect(_page('travel_group_order_notes'), isA<TravelGroupOrderNotesPage>());
    expect(_page('order_form'), isA<OrderFormPage>());
    expect(_page('order_query'), isA<OrderQueryPage>());
    expect(_page('finance_query'), isA<FinanceQueryPage>());
    expect(_page('reconciliation_table'), isA<ReconciliationTablePage>());
  });
}

List<String> _destinationIds(List<String> menuIds, UserRole role) {
  return destinationsForBackendMenus(
    menuIds.map(_menu).toList(),
    role,
  ).map((destination) => destination.id).toList();
}

AuthMenu _menu(String id) => AuthMenu(id: id, title: id, phase: 1);

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
