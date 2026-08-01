import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../core/auth/auth_models.dart';
import '../core/auth/role_access.dart';

class AppDestination {
  const AppDestination({
    required this.id,
    required this.label,
    required this.icon,
    required this.phase,
  });

  final String id;
  final String label;
  final IconData icon;
  final int phase;
}

const appDestinations = <AppDestination>[
  AppDestination(
      id: 'dashboard', label: '首页', icon: Icons.dashboard_rounded, phase: 1),
  AppDestination(
    id: 'todo_reminders',
    label: '待办提醒',
    icon: Icons.notifications_active_rounded,
    phase: 1,
  ),
  AppDestination(
      id: 'role_menu',
      label: '角色菜单',
      icon: Icons.account_tree_rounded,
      phase: 2),
  AppDestination(
      id: 'operation_logs',
      label: '操作日志',
      icon: Icons.manage_history_rounded,
      phase: 1),
  AppDestination(
      id: 'employee_accounts',
      label: '员工账号',
      icon: Icons.manage_accounts_rounded,
      phase: 1),
  AppDestination(
      id: 'travel_group_form',
      label: '旅行团录入',
      icon: Icons.directions_bus_rounded,
      phase: 3),
  AppDestination(
      id: 'travel_group_query',
      label: '旅行团管理',
      icon: Icons.manage_search_rounded,
      phase: 3),
  AppDestination(
      id: 'guide_management',
      label: '导游管理',
      icon: Icons.badge_rounded,
      phase: 3),
  AppDestination(
      id: 'travel_agency_management',
      label: '旅行社管理',
      icon: Icons.apartment_rounded,
      phase: 7),
  AppDestination(
      id: 'travel_group_finance_supplement',
      label: '积分表',
      icon: Icons.account_balance_wallet_rounded,
      phase: 6),
  AppDestination(
      id: 'guide_points_table',
      label: '导游积分表',
      icon: Icons.badge_rounded,
      phase: 7),
  AppDestination(
      id: 'travel_group_order_notes',
      label: '损耗与离店备注',
      icon: Icons.assignment_turned_in_rounded,
      phase: 4),
  AppDestination(
      id: 'order_form',
      label: '订单录入',
      icon: Icons.receipt_long_rounded,
      phase: 4),
  AppDestination(
      id: 'order_query',
      label: '订单管理',
      icon: Icons.fact_check_rounded,
      phase: 4),
  AppDestination(
      id: 'special_orders',
      label: '内购/外销/回购',
      icon: Icons.swap_horiz_rounded,
      phase: 12),
  AppDestination(
      id: 'qr_sales_sheet',
      label: '二维码销售单',
      icon: Icons.qr_code_2_rounded,
      phase: 5),
  AppDestination(
      id: 'taster_summary',
      label: '我的接待',
      icon: Icons.rate_review_rounded,
      phase: 3),
  AppDestination(
      id: 'taster_commissions',
      label: '我的提成',
      icon: Icons.payments_rounded,
      phase: 7),
  AppDestination(
      id: 'finance_query',
      label: '物流单号与品鉴师提成填写',
      icon: Icons.account_balance_wallet_rounded,
      phase: 6),
  AppDestination(
      id: 'commission_rules',
      label: '提成规则',
      icon: Icons.rule_folder_rounded,
      phase: 7),
  AppDestination(
    id: 'payment_method_management',
    label: '收款方式管理',
    icon: Icons.payments_rounded,
    phase: 6,
  ),
  AppDestination(
      id: 'product_management',
      label: '商品管理',
      icon: Icons.inventory_2_rounded,
      phase: 10),
  AppDestination(
      id: 'moutai_inventory',
      label: '茅台',
      icon: Icons.qr_code_scanner_rounded,
      phase: 10),
  AppDestination(
      id: 'reconciliation_table',
      label: '对账表',
      icon: Icons.table_chart_rounded,
      phase: 6),
  AppDestination(
      id: 'warehouse_packing',
      label: '库管打包',
      icon: Icons.inventory_2_rounded,
      phase: 6),
  AppDestination(
      id: 'warehouse_management',
      label: '库存管理',
      icon: Icons.warehouse_rounded,
      phase: 11),
  AppDestination(
      id: 'warehouse_directory',
      label: '仓库管理',
      icon: Icons.account_tree_rounded,
      phase: 11),
  AppDestination(
      id: 'after_sales_form',
      label: '售后处理',
      icon: Icons.support_agent_rounded,
      phase: 6),
  AppDestination(
      id: 'analytics', label: '数据分析', icon: Icons.bar_chart_rounded, phase: 8),
  AppDestination(
      id: 'profit_analysis',
      label: '利润分析',
      icon: Icons.trending_up_rounded,
      phase: 10),
  AppDestination(
      id: 'ai_assistant',
      label: 'AI 助手',
      icon: Icons.auto_awesome_rounded,
      phase: 9),
];

List<AppDestination> destinationsForRole(UserRole role) {
  final allowedIds = roleMenuIds[role] ?? const <String>['dashboard'];
  return appDestinations
      .where((destination) => allowedIds.contains(destination.id))
      .toList();
}

List<AppDestination> destinationsForBackendMenus(
    List<AuthMenu> menus, UserRole role) {
  final ids = <String>{};
  for (final menu in menus) {
    ids.add(_destinationIdForBackendMenu(menu.id));
  }

  _applyRoleMenuRules(ids, role);

  final destinations = appDestinations
      .where((destination) => ids.contains(destination.id))
      .toList();
  if (destinations.isNotEmpty) {
    return destinations;
  }

  return destinationsForRole(role);
}

void _applyRoleMenuRules(Set<String> ids, UserRole role) {
  final requestedStage7Workbench =
      ids.contains('finance_query') || ids.contains('commission_rules');
  final requestedAnalytics =
      ids.contains('analytics') || ids.contains('finance_query');
  if (!canViewProfitAnalysis(role)) {
    ids.remove('profit_analysis');
  }
  if (!canViewGuidePointsTable(role)) {
    ids.remove('guide_points_table');
  }
  if (role != UserRole.superAdmin && role != UserRole.admin) {
    ids.remove('operation_logs');
  }
  if (role != UserRole.superAdmin &&
      role != UserRole.admin &&
      role != UserRole.finance) {
    ids.remove('product_management');
  }
  if (!canManagePaymentMethods(role)) {
    ids.remove('payment_method_management');
  }
  if (!canAccessSpecialOrders(role)) {
    ids.remove('special_orders');
  }
  if (role != UserRole.superAdmin &&
      role != UserRole.admin &&
      role != UserRole.finance &&
      role != UserRole.warehouse) {
    ids.remove('moutai_inventory');
  }
  if (role != UserRole.superAdmin &&
      role != UserRole.admin &&
      role != UserRole.warehouse) {
    ids.remove('warehouse_packing');
  }
  if (!canAccessInventory(role)) {
    ids.remove('warehouse_management');
    ids.remove('warehouse_directory');
  }
  if (role != UserRole.superAdmin &&
      role != UserRole.admin &&
      role != UserRole.frontDesk) {
    ids.remove('guide_management');
  }
  switch (role) {
    case UserRole.sales:
      ids
        ..remove('travel_group_form')
        ..remove('travel_group_finance_supplement')
        ..remove('travel_agency_management')
        ..remove('after_sales_form')
        ..remove('analytics')
        ..add('travel_group_order_notes');
      _removeStage7Destinations(ids);
      break;
    case UserRole.finance:
      ids
        ..remove('travel_group_form')
        ..remove('order_form')
        ..remove('taster_commissions');
      if (requestedAnalytics) {
        ids.add('analytics');
      }
      break;
    case UserRole.boss:
      if (requestedStage7Workbench) {
        ids.add('finance_query');
      }
      ids
        ..remove('finance_query')
        ..remove('reconciliation_table')
        ..remove('warehouse_packing')
        ..remove('commission_rules')
        ..remove('taster_commissions')
        ..remove('travel_agency_management');
      if (requestedAnalytics) {
        ids.add('analytics');
      }
      break;
    case UserRole.warehouse:
      ids
        ..remove('order_form')
        ..remove('travel_agency_management')
        ..remove('analytics');
      _removeStage7Destinations(ids);
      break;
    case UserRole.superAdmin:
      ids.remove('taster_commissions');
      if (requestedAnalytics) {
        ids.add('analytics');
      }
      break;
    case UserRole.admin:
      ids.remove('taster_commissions');
      if (requestedAnalytics) {
        ids.add('analytics');
      }
      break;
    case UserRole.frontDesk:
      ids
        ..remove('travel_agency_management')
        ..remove('travel_group_order_notes')
        ..remove('analytics');
      _removeStage7Destinations(ids);
      break;
    case UserRole.afterSales:
      ids
        ..remove('travel_group_form')
        ..remove('order_form')
        ..remove('travel_agency_management');
      _removeStage7Destinations(ids);
      if (requestedAnalytics) {
        ids.add('analytics');
      }
      break;
    case UserRole.taster:
      ids
        ..remove('travel_agency_management')
        ..remove('finance_query')
        ..remove('commission_rules')
        ..remove('analytics');
      break;
  }

  if (!_canUseAiAssistant(role)) {
    ids.remove('ai_assistant');
  }
}

void _removeStage7Destinations(Set<String> ids) {
  ids
    ..remove('finance_query')
    ..remove('commission_rules')
    ..remove('taster_commissions');
}

bool _canUseAiAssistant(UserRole role) {
  return role == UserRole.admin ||
      role == UserRole.superAdmin ||
      role == UserRole.boss ||
      role == UserRole.finance ||
      role == UserRole.afterSales;
}

AppDestination destinationById(String id) {
  return appDestinations.firstWhere(
    (destination) => destination.id == id,
    orElse: () => appDestinations.first,
  );
}

String _destinationIdForBackendMenu(String menuId) {
  switch (menuId) {
    case 'employee_accounts':
      return 'employee_accounts';
    case 'role_permissions':
    case 'global_mark_query':
    case 'system_settings':
      return 'role_menu';
    case 'operation_logs':
      return 'operation_logs';
    case 'travel_groups':
      return 'travel_group_form';
    case 'travel_agency_management':
    case 'travel_agencies':
    case 'agency_deduction_rules':
    case 'agency_rebate_rules':
      return 'travel_agency_management';
    case 'sales_orders':
      return 'order_form';
    case 'after_sales_orders':
      return 'after_sales_form';
    case 'finance_workspace':
    case 'commissions':
      return 'finance_query';
    case 'commission_rules':
    case 'sales_deduction_rules':
      return 'commission_rules';
    case 'warehouse_workspace':
      return 'warehouse_packing';
    case 'serialized_inventory':
      return 'moutai_inventory';
    case 'warehouse_management':
      return 'warehouse_management';
    case 'warehouse_directory':
      return 'warehouse_directory';
    case 'own_taster_receptions':
      return 'taster_summary';
    case 'own_commissions':
      return 'taster_commissions';
    default:
      return menuId;
  }
}
