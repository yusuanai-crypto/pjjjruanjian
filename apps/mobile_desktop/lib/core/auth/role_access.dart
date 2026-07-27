import 'package:jiangjiu_shared/jiangjiu_shared.dart';

bool canViewFinanceMark(UserRole role) {
  return role == UserRole.superAdmin ||
      role == UserRole.admin ||
      role == UserRole.finance;
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
  return canViewGuidePointsTable(role);
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

bool canManageWarehouse(UserRole role) {
  return role == UserRole.superAdmin || role == UserRole.admin;
}
