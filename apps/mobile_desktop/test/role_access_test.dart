import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/auth/role_access.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  test('travel group not-entered permissions match the role and liaison matrix',
      () {
    for (final role in [
      UserRole.superAdmin,
      UserRole.admin,
      UserRole.boss,
      UserRole.frontDesk,
    ]) {
      expect(
        canConfirmTravelGroupNotEntered(role),
        isTrue,
        reason: role.value,
      );
    }
    for (final role in [
      UserRole.sales,
      UserRole.finance,
      UserRole.warehouse,
      UserRole.afterSales,
    ]) {
      expect(
        canConfirmTravelGroupNotEntered(role),
        isFalse,
        reason: role.value,
      );
    }
    expect(
      canConfirmTravelGroupNotEntered(
        UserRole.taster,
        liaisonTasterId: 'taster-1',
        currentUserId: 'taster-1',
      ),
      isTrue,
    );
    expect(
      canConfirmTravelGroupNotEntered(
        UserRole.taster,
        liaisonTasterId: 'other-taster',
        currentUserId: 'taster-1',
      ),
      isFalse,
    );
    for (final role in UserRole.values) {
      expect(
        canRevokeTravelGroupNotEntered(role),
        role == UserRole.frontDesk,
        reason: role.value,
      );
    }
  });

  test('payment methods are manageable only by finance and administrators', () {
    expect(canManagePaymentMethods(UserRole.superAdmin), isTrue);
    expect(canManagePaymentMethods(UserRole.admin), isTrue);
    expect(canManagePaymentMethods(UserRole.finance), isTrue);
    for (final role in [
      UserRole.boss,
      UserRole.frontDesk,
      UserRole.sales,
      UserRole.warehouse,
      UserRole.afterSales,
      UserRole.taster,
    ]) {
      expect(canManagePaymentMethods(role), isFalse, reason: role.value);
    }
  });

  test('finance mark visibility is limited to admin super admin and finance',
      () {
    expect(canViewFinanceMark(UserRole.superAdmin), isTrue);
    expect(canViewFinanceMark(UserRole.admin), isTrue);
    expect(canViewFinanceMark(UserRole.finance), isTrue);

    expect(canViewFinanceMark(UserRole.boss), isFalse);
    expect(canViewFinanceMark(UserRole.frontDesk), isFalse);
    expect(canViewFinanceMark(UserRole.sales), isFalse);
    expect(canViewFinanceMark(UserRole.warehouse), isFalse);
    expect(canViewFinanceMark(UserRole.afterSales), isFalse);
    expect(canViewFinanceMark(UserRole.taster), isFalse);
  });

  test('profit analysis is available to management and warehouse roles', () {
    expect(canViewProfitAnalysis(UserRole.superAdmin), isTrue);
    expect(canViewProfitAnalysis(UserRole.admin), isTrue);
    expect(canViewProfitAnalysis(UserRole.boss), isTrue);
    expect(canViewProfitAnalysis(UserRole.warehouse), isTrue);

    expect(canViewProfitAnalysis(UserRole.finance), isFalse);
    expect(canViewProfitAnalysis(UserRole.frontDesk), isFalse);
    expect(canViewProfitAnalysis(UserRole.sales), isFalse);
    expect(canViewProfitAnalysis(UserRole.afterSales), isFalse);
    expect(canViewProfitAnalysis(UserRole.taster), isFalse);
  });

  test('inventory capabilities match the complete nine-role matrix', () {
    const inventoryReaders = {
      UserRole.superAdmin,
      UserRole.admin,
      UserRole.finance,
      UserRole.boss,
      UserRole.warehouse,
    };
    const inventoryCostReaders = {
      UserRole.superAdmin,
      UserRole.admin,
      UserRole.finance,
      UserRole.boss,
    };
    const serializedCostReaders = {
      UserRole.superAdmin,
      UserRole.admin,
      UserRole.finance,
    };
    const quantityWriters = {
      UserRole.superAdmin,
      UserRole.admin,
      UserRole.warehouse,
    };
    const approvers = {
      UserRole.superAdmin,
      UserRole.admin,
      UserRole.boss,
    };

    for (final role in UserRole.values) {
      expect(
        canAccessInventory(role),
        inventoryReaders.contains(role),
        reason: '${role.value} inventory access',
      );
      expect(
        canReadInventoryCost(role),
        inventoryCostReaders.contains(role),
        reason: '${role.value} inventory cost',
      );
      expect(
        canReadSerializedCost(role),
        serializedCostReaders.contains(role),
        reason: '${role.value} serialized cost',
      );
      expect(
        canInboundWrite(role),
        quantityWriters.contains(role),
        reason: '${role.value} inbound write',
      );
      expect(
        canStocktakeWrite(role),
        quantityWriters.contains(role),
        reason: '${role.value} stocktake write',
      );
      expect(
        canStocktakeApprove(role),
        approvers.contains(role),
        reason: '${role.value} stocktake approval',
      );
      expect(
        canManageWarehouse(role),
        role == UserRole.superAdmin || role == UserRole.admin,
        reason: '${role.value} warehouse settings',
      );
    }
  });
}
