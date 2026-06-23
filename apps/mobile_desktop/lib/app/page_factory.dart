import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../features/after_sales/after_sales_form_page.dart';
import '../features/ai_assistant/ai_assistant_page.dart';
import '../features/analytics/analytics_page.dart';
import '../features/dashboard/dashboard_page.dart';
import '../features/finance/finance_query_page.dart';
import '../features/order_qrcodes/qr_sales_sheet_page.dart';
import '../features/role_menu/role_menu_page.dart';
import '../features/sales_orders/order_form_page.dart';
import '../features/taster_summary/taster_summary_page.dart';
import '../features/travel_groups/travel_group_form_page.dart';
import '../features/warehouse/warehouse_packing_page.dart';
import 'destinations.dart';

Widget buildPageForDestination({
  required String destinationId,
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
      return const TravelGroupFormPage();
    case 'order_form':
      return const OrderFormPage();
    case 'qr_sales_sheet':
      return const QrSalesSheetPage();
    case 'taster_summary':
      return const TasterSummaryPage();
    case 'finance_query':
      return const FinanceQueryPage();
    case 'warehouse_packing':
      return const WarehousePackingPage();
    case 'after_sales_form':
      return const AfterSalesFormPage();
    case 'analytics':
      return const AnalyticsPage();
    case 'ai_assistant':
      return const AiAssistantPage();
    case 'dashboard':
    default:
      return DashboardPage(
        role: role,
        allowedDestinations: allowedDestinations,
        onOpenDestination: onOpenDestination,
      );
  }
}
