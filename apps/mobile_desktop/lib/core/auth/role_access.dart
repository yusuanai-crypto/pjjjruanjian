import 'package:jiangjiu_shared/jiangjiu_shared.dart';

bool canViewFinanceMark(UserRole role) {
  return role == UserRole.superAdmin ||
      role == UserRole.admin ||
      role == UserRole.finance;
}

bool canConfirmTravelGroupNotEntered(
  UserRole role, {
  String? liaisonTasterId,
  String? currentUserId,
}) {
  if (role == UserRole.taster) {
    final actorId = currentUserId?.trim() ?? '';
    return actorId.isNotEmpty && liaisonTasterId == actorId;
  }
  return role == UserRole.superAdmin ||
      role == UserRole.admin ||
      role == UserRole.boss ||
      role == UserRole.frontDesk;
}

bool canRevokeTravelGroupNotEntered(UserRole role) {
  return role == UserRole.frontDesk;
}

bool canManagePaymentMethods(UserRole role) {
  return role == UserRole.superAdmin ||
      role == UserRole.admin ||
      role == UserRole.finance;
}

bool canAccessSpecialOrders(UserRole role) {
  return canCreateSpecialOrders(role) || canReviewSpecialOrders(role);
}

bool canCreateSpecialOrders(UserRole role) {
  return role == UserRole.sales || role == UserRole.afterSales;
}

bool canReviewSpecialOrders(UserRole role) {
  return role == UserRole.superAdmin ||
      role == UserRole.admin ||
      role == UserRole.boss;
}

bool canViewProfitAnalysis(UserRole role) {
  return role == UserRole.superAdmin ||
      role == UserRole.admin ||
      role == UserRole.boss;
}

bool canViewGuidePointsTable(UserRole role) {
  return role == UserRole.superAdmin ||
      role == UserRole.admin ||
      role == UserRole.finance ||
      role == UserRole.boss;
}

bool canMaintainGuidePointsTable(UserRole role) {
  return role == UserRole.superAdmin ||
      role == UserRole.admin ||
      role == UserRole.finance;
}

bool canChangeOrderPointsDestination(UserRole role) {
  return canManageOrderPersonalSplit(role);
}

bool canViewOrderPersonalSplit(UserRole role) {
  return role == UserRole.superAdmin ||
      role == UserRole.admin ||
      role == UserRole.finance ||
      role == UserRole.boss ||
      role == UserRole.afterSales;
}

bool canManageOrderPersonalSplit(UserRole role) {
  return role == UserRole.superAdmin ||
      role == UserRole.admin ||
      role == UserRole.finance ||
      role == UserRole.boss;
}

// --- 库存权限（与后端 inventory-access.policy.ts 对齐）---

bool canAccessInventory(UserRole role) {
  switch (role) {
    case UserRole.superAdmin:
    case UserRole.admin:
    case UserRole.warehouse:
    case UserRole.finance:
    case UserRole.boss:
      return true;
    default:
      return false;
  }
}

bool canReadInventoryCost(UserRole role) {
  return role == UserRole.superAdmin ||
      role == UserRole.admin ||
      role == UserRole.finance ||
      role == UserRole.boss;
}

bool canReadSerializedCost(UserRole role) {
  // 逐瓶成本不含 boss（后端 COST_ROLES = super_admin/admin/finance）
  return role == UserRole.superAdmin ||
      role == UserRole.admin ||
      role == UserRole.finance;
}

bool canInboundWrite(UserRole role) {
  return role == UserRole.superAdmin ||
      role == UserRole.admin ||
      role == UserRole.warehouse;
}

bool canCostWrite(UserRole role) {
  return role == UserRole.superAdmin ||
      role == UserRole.admin ||
      role == UserRole.finance;
}

bool canStocktakeWrite(UserRole role) {
  return role == UserRole.superAdmin ||
      role == UserRole.admin ||
      role == UserRole.warehouse;
}

bool canStocktakeApprove(UserRole role) {
  return role == UserRole.superAdmin ||
      role == UserRole.admin ||
      role == UserRole.boss;
}

bool canStocktakeReverse(UserRole role) {
  return role == UserRole.superAdmin || role == UserRole.admin;
}

bool canManageWarehouse(UserRole role) {
  return role == UserRole.superAdmin || role == UserRole.admin;
}
