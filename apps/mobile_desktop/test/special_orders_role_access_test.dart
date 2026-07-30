import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/app/destinations.dart';
import 'package:jiangjiu_mobile_desktop/core/auth/role_access.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  test('special-order menu and button permissions match the role matrix', () {
    for (final role in [
      UserRole.sales,
      UserRole.afterSales,
      UserRole.boss,
      UserRole.admin,
      UserRole.superAdmin,
    ]) {
      expect(canAccessSpecialOrders(role), isTrue, reason: role.value);
      expect(
        destinationsForRole(role).map((row) => row.id),
        contains('special_orders'),
        reason: role.value,
      );
    }
    for (final role in [
      UserRole.frontDesk,
      UserRole.finance,
      UserRole.warehouse,
      UserRole.taster,
    ]) {
      expect(canAccessSpecialOrders(role), isFalse, reason: role.value);
      expect(
        destinationsForRole(role).map((row) => row.id),
        isNot(contains('special_orders')),
        reason: role.value,
      );
    }
    expect(canCreateSpecialOrders(UserRole.sales), isTrue);
    expect(canCreateSpecialOrders(UserRole.afterSales), isTrue);
    expect(canCreateSpecialOrders(UserRole.boss), isFalse);
    expect(canReviewSpecialOrders(UserRole.boss), isTrue);
    expect(canReviewSpecialOrders(UserRole.admin), isTrue);
    expect(canReviewSpecialOrders(UserRole.superAdmin), isTrue);
  });
}
