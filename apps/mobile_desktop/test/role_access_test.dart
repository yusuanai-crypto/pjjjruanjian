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

  test('profit analysis is limited to super admin admin and boss', () {
    expect(canViewProfitAnalysis(UserRole.superAdmin), isTrue);
    expect(canViewProfitAnalysis(UserRole.admin), isTrue);
    expect(canViewProfitAnalysis(UserRole.boss), isTrue);

    expect(canViewProfitAnalysis(UserRole.finance), isFalse);
    expect(canViewProfitAnalysis(UserRole.frontDesk), isFalse);
    expect(canViewProfitAnalysis(UserRole.sales), isFalse);
    expect(canViewProfitAnalysis(UserRole.warehouse), isFalse);
    expect(canViewProfitAnalysis(UserRole.afterSales), isFalse);
    expect(canViewProfitAnalysis(UserRole.taster), isFalse);
  });
}
