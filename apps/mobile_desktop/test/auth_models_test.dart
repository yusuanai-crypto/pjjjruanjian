import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/auth/auth_models.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  group('userRoleFromValue', () {
    test('parses the super administrator role returned by the API', () {
      expect(userRoleFromValue('super_admin'), UserRole.superAdmin);
    });

    test('normalizes Prisma-style role casing and surrounding whitespace', () {
      expect(userRoleFromValue(' SUPER_ADMIN '), UserRole.superAdmin);
    });

    test('continues to reject unsupported roles', () {
      expect(
        () => userRoleFromValue('unknown_role'),
        throwsA(
          isA<UnsupportedUserRoleException>().having(
            (error) => error.displayValue,
            'displayValue',
            'unknown_role',
          ),
        ),
      );
    });

    test('describes a missing role without exposing unbounded response text',
        () {
      expect(
        const UnsupportedUserRoleException('  ').displayValue,
        '空值',
      );
      expect(
        UnsupportedUserRoleException('x' * 100).displayValue.length,
        lessThan(40),
      );
    });
  });
}
