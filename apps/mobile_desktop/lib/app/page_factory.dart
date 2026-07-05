import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../core/api/api_client.dart';
import '../features/after_sales/after_sales_form_page.dart';
import '../features/ai_assistant/ai_assistant_page.dart';
import '../features/analytics/analytics_page.dart';
import '../features/commission_rules/commission_rule_config_page.dart';
import '../features/dashboard/dashboard_page.dart';
import '../features/finance/finance_query_page.dart';
import '../features/order_qrcodes/qr_sales_sheet_page.dart';
import '../features/order_query/order_query_page.dart';
import '../features/pending_travel_groups/pending_travel_group_table_page.dart';
import '../features/reconciliation/reconciliation_table_page.dart';
import '../features/role_menu/role_menu_page.dart';
import '../features/sales_orders/order_form_page.dart';
import '../features/taster_commissions/taster_commission_page.dart';
import '../features/taster_summary/taster_summary_page.dart';
import '../features/travel_agency_management/travel_agency_management_page.dart';
import '../features/travel_group_finance/travel_group_finance_supplement_page.dart';
import '../features/travel_group_order_notes/travel_group_order_notes_page.dart';
import '../features/travel_group_query/travel_group_query_page.dart';
import '../features/travel_groups/travel_group_form_page.dart';
import '../features/warehouse/warehouse_packing_page.dart';
import 'destinations.dart';

Widget buildPageForDestination({
  required String destinationId,
  required ApiClient apiClient,
  required String token,
  required UserRole role,
  required List<AppDestination> allowedDestinations,
  required ValueChanged<String> onOpenDestination,
}) {
  switch (destinationId) {
    case 'role_menu':
      return RoleMenuPage(
        role: role,
        allowedDestinations: allowedDestinations,
        onOpenDestination: onOpenDestination,
      );
    case 'travel_group_form':
      return TravelGroupFormPage(apiClient: apiClient, token: token);
    case 'travel_group_query':
      return TravelGroupQueryPage(
        apiClient: apiClient,
        token: token,
        role: role,
      );
    case 'pending_travel_groups':
      return PendingTravelGroupTablePage(
        apiClient: apiClient,
        token: token,
        role: role,
        onOpenDestination: onOpenDestination,
      );
    case 'travel_group_finance_supplement':
      return const TravelGroupFinanceSupplementPage();
    case 'travel_group_order_notes':
      return TravelGroupOrderNotesPage(apiClient: apiClient, token: token);
    case 'order_form':
      return OrderFormPage(apiClient: apiClient, token: token);
    case 'order_query':
      return OrderQueryPage(apiClient: apiClient, token: token, role: role);
    case 'qr_sales_sheet':
      return QrSalesSheetPage(apiClient: apiClient, token: token);
    case 'taster_summary':
      return const TasterSummaryPage();
    case 'taster_commissions':
      return TasterCommissionPage(apiClient: apiClient, token: token);
    case 'finance_query':
      return FinanceQueryPage(apiClient: apiClient, token: token, role: role);
    case 'commission_rules':
      return CommissionRuleConfigPage(
        apiClient: apiClient,
        token: token,
        role: role,
      );
    case 'travel_agency_management':
      return TravelAgencyManagementPage(
        apiClient: apiClient,
        token: token,
        role: role,
      );
    case 'reconciliation_table':
      return ReconciliationTablePage(apiClient: apiClient, token: token);
    case 'warehouse_packing':
      return WarehousePackingPage(
        apiClient: apiClient,
        token: token,
        role: role,
      );
    case 'after_sales_form':
      return AfterSalesFormPage(
        apiClient: apiClient,
        token: token,
        role: role,
      );
    case 'analytics':
      return AnalyticsPage(apiClient: apiClient, token: token, role: role);
    case 'ai_assistant':
      return AiAssistantPage(apiClient: apiClient, token: token, role: role);
    case 'dashboard':
    default:
      return DashboardPage(
        apiClient: apiClient,
        token: token,
        role: role,
        allowedDestinations: allowedDestinations,
        onOpenDestination: onOpenDestination,
      );
  }
}
