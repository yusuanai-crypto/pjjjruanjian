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
