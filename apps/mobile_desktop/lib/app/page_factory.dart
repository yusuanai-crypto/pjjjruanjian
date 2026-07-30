import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../core/api/api_client.dart';
import '../features/after_sales/after_sales_form_page.dart';
import '../features/ai_assistant/ai_assistant_page.dart';
import '../features/analytics/analytics_page.dart';
import '../features/commission_rules/commission_rule_config_page.dart';
import '../features/dashboard/dashboard_page.dart';
import '../features/employee_accounts/employee_accounts_page.dart';
import '../features/finance/finance_query_page.dart';
import '../features/guide_management/guide_management_page.dart';
import '../features/guide_points/guide_points_table_page.dart';
import '../features/order_qrcodes/qr_sales_sheet_page.dart';
import '../features/order_query/order_query_page.dart';
import '../features/operation_logs/operation_logs_page.dart';
import '../features/payment_methods/payment_method_management_page.dart';
import '../features/moutai_inventory/moutai_inventory_page.dart';
import '../features/product_management/product_management_page.dart';
import '../features/profit_analysis/profit_analysis_page.dart';
import '../features/reconciliation/reconciliation_table_page.dart';
import '../features/role_menu/role_menu_page.dart';
import '../features/sales_orders/order_form_entry_page.dart';
import '../features/special_orders/special_orders_page.dart';
import '../features/taster_commissions/taster_commission_page.dart';
import '../features/taster_summary/taster_summary_page.dart';
import '../features/todo_reminders/todo_reminder_controller.dart';
import '../features/todo_reminders/todo_reminders_page.dart';
import '../features/travel_agency_management/travel_agency_management_page.dart';
import '../features/travel_group_attachments/attachment_picker_service.dart';
import '../features/travel_group_attachments/incoming_attachment_service.dart';
import '../features/travel_group_finance/travel_group_finance_supplement_page.dart';
import '../features/travel_group_order_notes/travel_group_order_notes_page.dart';
import '../features/travel_group_query/travel_group_query_page.dart';
import '../features/travel_groups/travel_group_form_page.dart';
import '../features/warehouse/warehouse_packing_page.dart';
import '../features/warehouse_management/warehouse_management_page.dart';
import 'destinations.dart';

Widget buildPageForDestination({
  required String destinationId,
  required ApiClient apiClient,
  required String token,
  required UserRole role,
  String currentUserId = '',
  required List<AppDestination> allowedDestinations,
  required ValueChanged<String> onOpenDestination,
  TodoReminderController? todoReminderController,
  AttachmentPickerService? attachmentPickerService,
  IncomingAttachmentService? incomingAttachmentService,
}) {
  switch (destinationId) {
    case 'todo_reminders':
      if (todoReminderController == null) {
        return const Center(child: Text('待办提醒正在初始化。'));
      }
      return TodoRemindersPage(
        controller: todoReminderController,
        onOpenDestination: onOpenDestination,
      );
    case 'employee_accounts':
      return EmployeeAccountsPage(
        apiClient: apiClient,
        token: token,
        role: role,
        currentUserId: currentUserId,
      );
    case 'role_menu':
      return RoleMenuPage(
        role: role,
        allowedDestinations: allowedDestinations,
        onOpenDestination: onOpenDestination,
      );
    case 'operation_logs':
      return OperationLogsPage(
        apiClient: apiClient,
        token: token,
      );
    case 'travel_group_form':
      return TravelGroupFormPage(
        apiClient: apiClient,
        token: token,
        role: role,
        attachmentPickerService: attachmentPickerService,
        incomingAttachmentService: incomingAttachmentService,
      );
    case 'travel_group_query':
      return TravelGroupQueryPage(
        apiClient: apiClient,
        token: token,
        role: role,
        currentUserId: currentUserId,
        attachmentPickerService: attachmentPickerService,
        incomingAttachmentService: incomingAttachmentService,
      );
    case 'guide_management':
      return GuideManagementPage(
        apiClient: apiClient,
        token: token,
        role: role,
      );
    case 'travel_group_finance_supplement':
      return TravelGroupFinanceSupplementPage(
        apiClient: apiClient,
        token: token,
      );
    case 'guide_points_table':
      return GuidePointsTablePage(
        apiClient: apiClient,
        token: token,
        role: role,
      );
    case 'travel_group_order_notes':
      return TravelGroupOrderNotesPage(
        apiClient: apiClient,
        token: token,
        role: role,
      );
    case 'order_form':
      return OrderFormEntryPage(apiClient: apiClient, token: token, role: role);
    case 'order_query':
      return OrderQueryPage(apiClient: apiClient, token: token, role: role);
    case 'special_orders':
      return SpecialOrdersPage(
        apiClient: apiClient,
        token: token,
        role: role,
      );
    case 'qr_sales_sheet':
      return QrSalesSheetPage(apiClient: apiClient, token: token);
    case 'taster_summary':
      return TasterSummaryPage(
        apiClient: apiClient,
        token: token,
        role: role,
        currentUserId: currentUserId,
      );
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
    case 'payment_method_management':
      return PaymentMethodManagementPage(
        apiClient: apiClient,
        token: token,
        role: role,
      );
    case 'product_management':
      return ProductManagementPage(
        apiClient: apiClient,
        token: token,
        role: role,
        onOpenDestination: onOpenDestination,
      );
    case 'travel_agency_management':
      return TravelAgencyManagementPage(
        apiClient: apiClient,
        token: token,
        role: role,
      );
    case 'moutai_inventory':
      return MoutaiInventoryPage(
        apiClient: apiClient,
        token: token,
        role: role,
      );
    case 'reconciliation_table':
      return ReconciliationTablePage(
        apiClient: apiClient,
        token: token,
        role: role,
      );
    case 'warehouse_packing':
      return WarehousePackingPage(
        apiClient: apiClient,
        token: token,
        role: role,
      );
    case 'warehouse_management':
      return WarehouseManagementPage(
        apiClient: apiClient,
        token: token,
        role: role,
        onOpenDestination: onOpenDestination,
      );
    case 'after_sales_form':
      return AfterSalesFormPage(
        apiClient: apiClient,
        token: token,
        role: role,
      );
    case 'analytics':
      return AnalyticsPage(apiClient: apiClient, token: token, role: role);
    case 'profit_analysis':
      return ProfitAnalysisPage(
        apiClient: apiClient,
        token: token,
        role: role,
      );
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
        todoReminderController: todoReminderController,
      );
  }
}
