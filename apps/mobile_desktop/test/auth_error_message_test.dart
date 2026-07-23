import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/auth/auth_controller.dart';
import 'package:jiangjiu_mobile_desktop/core/auth/auth_models.dart';

void main() {
  test('reports gateway failures as server availability problems', () {
    const error = ApiException(
      statusCode: 502,
      code: 'HTTP_ERROR',
      message: '请求失败，HTTP 502。',
    );

    expect(messageForAuthError(error), contains('HTTP 502'));
    expect(messageForAuthError(error), isNot(contains('用户角色')));
  });

  test('reports the sanitized unsupported role value', () {
    const error = UnsupportedUserRoleException('unexpected_role');

    expect(messageForAuthError(error), contains('unexpected_role'));
    expect(messageForAuthError(error), contains('用户角色'));
  });

  test('does not mislabel a generic format failure as a role failure', () {
    final message = messageForAuthError(const FormatException('bad JSON'));

    expect(message, contains('数据格式异常'));
    expect(message, isNot(contains('用户角色')));
  });
}
