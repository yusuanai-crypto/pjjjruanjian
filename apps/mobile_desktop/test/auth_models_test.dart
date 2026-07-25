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

  test('auth session prefers explicit access-token fields and keeps aliases',
      () {
    final session = AuthSession.fromJson(<String, dynamic>{
      'accessToken': 'access-value',
      'accessTokenExpiresAt': '2099-01-01T00:00:00.000Z',
      'refreshToken': 'refresh-value',
      'refreshTokenExpiresAt': '2099-02-01T00:00:00.000Z',
      'token': 'legacy-value',
      'expiresAt': '2000-01-01T00:00:00.000Z',
      'user': <String, dynamic>{
        'id': 'user-1',
        'name': 'Test',
        'username': 'test.user',
        'role': 'admin',
        'isActive': true,
        'mustChangePassword': false,
        'createdAt': '2026-01-01T00:00:00.000Z',
        'updatedAt': '2026-01-01T00:00:00.000Z',
      },
      'permissions': <String>[],
      'menus': <Map<String, dynamic>>[],
      'dataScope': <String, dynamic>{},
    });

    expect(session.accessToken == 'access-value', isTrue);
    expect(
      session.accessTokenExpiresAt == '2099-01-01T00:00:00.000Z',
      isTrue,
    );
    expect(session.refreshToken?.isNotEmpty, isTrue);
  });
}
