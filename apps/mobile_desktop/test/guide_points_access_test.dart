import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/app/destinations.dart';
import 'package:jiangjiu_mobile_desktop/core/auth/role_access.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  test('guide points menu and maintenance permissions match role matrix', () {
    for (final role in [
      UserRole.superAdmin,
      UserRole.admin,
      UserRole.finance,
      UserRole.boss,
    ]) {
      expect(canViewGuidePointsTable(role), isTrue, reason: role.name);
      expect(
        destinationsForRole(role)
            .any((item) => item.id == 'guide_points_table'),
        isTrue,
        reason: role.name,
      );
      expect(canChangeOrderPointsDestination(role), isTrue);
      expect(canViewOrderPersonalSplit(role), isTrue);
      expect(canManageOrderPersonalSplit(role), isTrue);
    }

    for (final role in [
      UserRole.superAdmin,
      UserRole.admin,
      UserRole.finance,
    ]) {
      expect(canMaintainGuidePointsTable(role), isTrue);
    }
    expect(canMaintainGuidePointsTable(UserRole.boss), isFalse);
    expect(canViewOrderPersonalSplit(UserRole.afterSales), isTrue);
    expect(canManageOrderPersonalSplit(UserRole.afterSales), isFalse);

    for (final role in [
      UserRole.frontDesk,
      UserRole.sales,
      UserRole.warehouse,
      UserRole.taster,
    ]) {
      expect(canViewGuidePointsTable(role), isFalse, reason: role.name);
      expect(
        destinationsForRole(role)
            .any((item) => item.id == 'guide_points_table'),
        isFalse,
        reason: role.name,
      );
      expect(canChangeOrderPointsDestination(role), isFalse);
      expect(canViewOrderPersonalSplit(role), isFalse);
      expect(canManageOrderPersonalSplit(role), isFalse);
    }
    expect(
      canChangeOrderPointsDestination(UserRole.afterSales),
      isFalse,
    );
  });
}
