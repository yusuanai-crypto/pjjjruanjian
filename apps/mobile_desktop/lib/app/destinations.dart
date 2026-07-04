import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../core/auth/auth_models.dart';

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
      id: 'role_menu',
      label: '角色菜单',
      icon: Icons.account_tree_rounded,
      phase: 2),
  AppDestination(
      id: 'travel_group_form',
      label: '旅行团录入',
      icon: Icons.directions_bus_rounded,
      phase: 3),
  AppDestination(
      id: 'travel_group_query',
      label: '旅行团查询',
      icon: Icons.manage_search_rounded,
      phase: 3),
  AppDestination(
      id: 'pending_travel_groups',
      label: '待处理旅行团',
      icon: Icons.pending_actions_rounded,
      phase: 3),
  AppDestination(
      id: 'travel_group_finance_supplement',
      label: '积分表',
      icon: Icons.account_balance_wallet_rounded,
      phase: 6),
  AppDestination(
      id: 'travel_group_order_notes',
      label: '订单绑定与离店备注',
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
      id: 'qr_sales_sheet',
      label: '二维码销售单',
      icon: Icons.qr_code_2_rounded,
      phase: 5),
  AppDestination(
      id: 'taster_summary',
      label: '品鉴师总结',
      icon: Icons.rate_review_rounded,
      phase: 3),
  AppDestination(
      id: 'taster_commissions',
      label: '我的提成',
      icon: Icons.payments_rounded,
      phase: 7),
  AppDestination(
      id: 'finance_query',
      label: '财务查询',
      icon: Icons.account_balance_wallet_rounded,
      phase: 6),
  AppDestination(
      id: 'commission_rules',
      label: '提成规则',
      icon: Icons.rule_folder_rounded,
      phase: 7),
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
      id: 'after_sales_form',
      label: '售后处理',
      icon: Icons.support_agent_rounded,
      phase: 6),
  AppDestination(
      id: 'analytics', label: '数据分析', icon: Icons.bar_chart_rounded, phase: 8),
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
  switch (role) {
    case UserRole.sales:
      ids
        ..remove('travel_group_form')
        ..remove('travel_group_finance_supplement')
        ..add('travel_group_order_notes');
      _removeStage7Destinations(ids);
      break;
    case UserRole.finance:
      ids
        ..remove('travel_group_form')
        ..remove('order_form')
        ..remove('taster_commissions');
      break;
    case UserRole.warehouse:
      ids.remove('order_form');
      _removeStage7Destinations(ids);
      break;
    case UserRole.admin:
      ids.remove('taster_commissions');
      break;
    case UserRole.boss:
      if (requestedStage7Workbench) {
        ids.add('finance_query');
      }
      ids
        ..remove('commission_rules')
        ..remove('taster_commissions');
      break;
    case UserRole.frontDesk:
    case UserRole.afterSales:
      _removeStage7Destinations(ids);
      break;
    case UserRole.taster:
      ids
        ..remove('finance_query')
        ..remove('commission_rules');
      break;
  }
}

void _removeStage7Destinations(Set<String> ids) {
  ids
    ..remove('finance_query')
    ..remove('commission_rules')
    ..remove('taster_commissions');
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
    case 'role_permissions':
    case 'global_mark_query':
    case 'operation_logs':
    case 'system_settings':
      return 'role_menu';
    case 'travel_groups':
      return 'travel_group_form';
    case 'pending_travel_groups':
      return 'pending_travel_groups';
    case 'sales_orders':
      return 'order_form';
    case 'after_sales_orders':
      return 'after_sales_form';
    case 'finance_workspace':
    case 'commissions':
      return 'finance_query';
    case 'commission_rules':
    case 'sales_deduction_rules':
    case 'agency_deduction_rules':
    case 'agency_rebate_rules':
      return 'commission_rules';
    case 'warehouse_workspace':
      return 'warehouse_packing';
    case 'own_taster_receptions':
      return 'taster_summary';
    case 'own_commissions':
      return 'taster_commissions';
    default:
      return menuId;
  }
}
