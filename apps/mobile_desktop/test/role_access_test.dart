import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/auth/role_access.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
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
}
