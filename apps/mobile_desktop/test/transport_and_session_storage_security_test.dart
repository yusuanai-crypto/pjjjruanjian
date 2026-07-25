import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/auth/auth_controller.dart';
import 'package:jiangjiu_mobile_desktop/core/config/app_config.dart';
import 'package:jiangjiu_mobile_desktop/core/storage/session_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fake_secure_token_storage.dart';

void main() {
  group('API transport policy', () {
    test('accepts HTTPS and adds HTTPS when the scheme is missing', () {
      expect(
        AppConfig.normalizeApiBaseUrlForPolicy(
          'https://api.example.com/v1/',
          debugOrTest: false,
        ),
        'https://api.example.com/v1',
      );
      expect(
        AppConfig.normalizeApiBaseUrlForPolicy(
          'api.example.com:8443/v1',
          debugOrTest: false,
        ),
        'https://api.example.com:8443/v1',
      );
    });

    test('release policy rejects every HTTP remote address', () {
      for (final value in <String>[
        'http://api.example.com',
        'http://192.168.1.20:3000',
        'http://10.0.2.2:3000',
        'http://127.0.0.1:3000',
      ]) {
        expect(
          () => AppConfig.normalizeApiBaseUrlForPolicy(
            value,
            debugOrTest: false,
          ),
          throwsFormatException,
          reason: value,
        );
      }
    });

    test('debug and test policy permits HTTP loopback only', () {
      expect(
        AppConfig.normalizeApiBaseUrlForPolicy(
          'http://localhost:3000/',
          debugOrTest: true,
        ),
        'http://localhost:3000',
      );
      expect(
        AppConfig.normalizeApiBaseUrlForPolicy(
          'http://127.0.0.2:3000',
          debugOrTest: true,
        ),
        'http://127.0.0.2:3000',
      );
      expect(
        AppConfig.normalizeApiBaseUrlForPolicy(
          'http://[::1]:3000',
          debugOrTest: true,
        ),
        'http://[::1]:3000',
      );

      for (final value in <String>[
        'http://api.example.com',
        'http://192.168.1.20:3000',
        'http://10.0.2.2:3000',
        'http://0.0.0.0:3000',
      ]) {
        expect(
          () => AppConfig.normalizeApiBaseUrlForPolicy(
            value,
            debugOrTest: true,
          ),
          throwsFormatException,
          reason: value,
        );
      }
    });

    test('rejects unsafe or ambiguous URI forms', () {
      for (final value in <String>[
        'ftp://api.example.com',
        'https://user:pass@api.example.com',
        'https:///api',
        'https://api.example.com:',
        'https://api.example.com:not-a-port',
        'https://api.example.com:65536',
        'https://api.example.com/path?token=value',
        'https://api.example.com/path#fragment',
        r'https://api.example.com\path',
      ]) {
        expect(
          () => AppConfig.normalizeApiBaseUrlForPolicy(
            value,
            debugOrTest: true,
          ),
          throwsFormatException,
          reason: value,
        );
      }
    });
  });

  group('platform credential policy', () {
    test('Android backup remains disabled', () async {
      final manifest = await File(
        'android/app/src/main/AndroidManifest.xml',
      ).readAsString();
      expect(manifest.contains('android:allowBackup="false"'), isTrue);
    });

    test('iOS Keychain items stay on this device and never synchronize',
        () async {
      final source = await File(
        'lib/core/storage/session_storage.dart',
      ).readAsString();
      expect(
        source.contains('KeychainAccessibility.first_unlock_this_device'),
        isTrue,
      );
      expect(source.contains('synchronizable: false'), isTrue);
    });
  });

  group('session token migration', () {
    test('moves a legacy token to secure storage before removing it', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{
        SessionStorage.tokenKey: 'legacy-test-token',
        'jiangjiu.config.apiBaseUrl': 'https://api.example.com',
      });
      final preferences = await SharedPreferences.getInstance();
      final secureStorage = FakeSecureTokenStorage();

      final storage = await SessionStorage.create(
        preferences: preferences,
        secureStorage: secureStorage,
      );

      expect(await storage.readToken(), 'legacy-test-token');
      expect(preferences.containsKey(SessionStorage.tokenKey), isFalse);
      expect(preferences.containsKey('jiangjiu.config.apiBaseUrl'), isFalse);
    });

    test('keeps the legacy token and rolls back a failed secure write',
        () async {
      SharedPreferences.setMockInitialValues(<String, Object>{
        SessionStorage.tokenKey: 'legacy-test-token',
      });
      final preferences = await SharedPreferences.getInstance();
      final secureStorage = FakeSecureTokenStorage(
        failWriteAfterMutation: true,
      );

      await expectLater(
        SessionStorage.create(
          preferences: preferences,
          secureStorage: secureStorage,
        ),
        throwsStateError,
      );

      expect(
        preferences.getString(SessionStorage.tokenKey),
        'legacy-test-token',
      );
      expect(secureStorage.values, isEmpty);
    });
  });

  group('last successful username', () {
    test(
        'successful login keeps password out of preferences and in secure storage',
        () async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final preferences = await SharedPreferences.getInstance();
      final secureStorage = FakeSecureTokenStorage();
      final storage = await SessionStorage.create(
        preferences: preferences,
        secureStorage: secureStorage,
      );
      final apiClient = _FakeAuthApiClient(loginUsername: 'confirmed.user');
      final controller = AuthController(
        storage: storage,
        apiClient: apiClient,
      );

      await controller.login(
        username: ' entered.user ',
        password: 'never-save-this-password',
        rememberPassword: true,
      );

      expect(storage.readLastUsername(), 'confirmed.user');
      expect(controller.lastUsername, 'confirmed.user');
      expect(
        preferences.getKeys().map(preferences.get).whereType<String>(),
        isNot(contains('never-save-this-password')),
      );
      expect(
        (await storage.readRememberedPassword('confirmed.user')) ==
            'never-save-this-password',
        isTrue,
      );
      expect(
        secureStorage.values.containsKey(
          SessionStorage.rememberedPasswordsKey,
        ),
        isTrue,
      );
      apiClient.close(force: true);
    });

    test('failed login does not overwrite the previous username', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{
        SessionStorage.lastUsernameKey: 'previous.user',
      });
      final preferences = await SharedPreferences.getInstance();
      final storage = await SessionStorage.create(
        preferences: preferences,
        secureStorage: FakeSecureTokenStorage(),
      );
      await storage.saveRememberedPassword(
        'previous.user',
        'previous-password',
      );
      final apiClient = _FakeAuthApiClient(failLogin: true);
      final controller = AuthController(
        storage: storage,
        apiClient: apiClient,
      );
      await controller.restore();

      await expectLater(
        controller.login(
          username: 'wrong.user',
          password: 'wrong-password',
          rememberPassword: true,
        ),
        throwsA(isA<AuthFailure>()),
      );

      expect(storage.readLastUsername(), 'previous.user');
      expect(controller.lastUsername, 'previous.user');
      expect(
        (await storage.readRememberedPassword('previous.user')) ==
            'previous-password',
        isTrue,
      );
      expect(await storage.readRememberedPassword('wrong.user'), isNull);
      apiClient.close(force: true);
    });

    test('logout does not clear the previous username', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{
        SessionStorage.lastUsernameKey: 'remembered.user',
      });
      final preferences = await SharedPreferences.getInstance();
      final storage = await SessionStorage.create(
        preferences: preferences,
        secureStorage: FakeSecureTokenStorage(),
      );
      final apiClient = _FakeAuthApiClient();
      final controller = AuthController(
        storage: storage,
        apiClient: apiClient,
      );
      await controller.restore();

      await controller.logout();

      expect(storage.readLastUsername(), 'remembered.user');
      expect(controller.lastUsername, 'remembered.user');
      apiClient.close(force: true);
    });

    test(
        'logout preserves remembered passwords and forget removes only one account',
        () async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final preferences = await SharedPreferences.getInstance();
      final storage = await SessionStorage.create(
        preferences: preferences,
        secureStorage: FakeSecureTokenStorage(),
      );
      await storage.saveRememberedPassword('first.user', 'first-password');
      await storage.saveRememberedPassword('second.user', 'second-password');
      final apiClient = _FakeAuthApiClient(loginUsername: 'first.user');
      final controller = AuthController(
        storage: storage,
        apiClient: apiClient,
      );

      await controller.login(
        username: 'first.user',
        password: 'first-password',
        rememberPassword: true,
      );
      await controller.logout();
      expect(
        (await storage.readRememberedPassword('first.user')) ==
            'first-password',
        isTrue,
      );

      await controller.forgetAccount('first.user');
      expect(await storage.readRememberedPassword('first.user'), isNull);
      expect(
        (await storage.readRememberedPassword('second.user')) ==
            'second-password',
        isTrue,
      );
      expect(storage.readRememberedUsernames(), <String>['second.user']);
      apiClient.close(force: true);
    });

    test('restoring a valid token saves its current username', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{
        SessionStorage.lastUsernameKey: 'old.user',
      });
      final preferences = await SharedPreferences.getInstance();
      final storage = await SessionStorage.create(
        preferences: preferences,
        secureStorage: FakeSecureTokenStorage(
          initialValues: <String, String>{
            SessionStorage.tokenKey: 'existing-token',
          },
        ),
      );
      final apiClient = _FakeAuthApiClient(
        restoredUsername: 'current.user',
      );
      final controller = AuthController(
        storage: storage,
        apiClient: apiClient,
      );

      await controller.restore();

      expect(controller.session?.user.username, 'current.user');
      expect(controller.lastUsername, 'current.user');
      expect(storage.readLastUsername(), 'current.user');
      apiClient.close(force: true);
    });
  });
}

class _FakeAuthApiClient extends ApiClient {
  _FakeAuthApiClient({
    this.failLogin = false,
    this.loginUsername = 'login.user',
    this.restoredUsername = 'restored.user',
  }) : super(baseUrl: 'https://api.example.invalid');

  final bool failLogin;
  final String loginUsername;
  final String restoredUsername;

  @override
  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    if (path != '/api/auth/login') {
      throw StateError('Unexpected POST $path');
    }
    if (failLogin) {
      throw const ApiException(
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: '账号或密码不正确。',
      );
    }
    return <String, dynamic>{
      'data': _authSessionPayload(loginUsername, token: 'login-token'),
    };
  }

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    if (path != '/api/auth/me') {
      throw StateError('Unexpected GET $path');
    }
    return <String, dynamic>{
      'data': _authSessionPayload(restoredUsername),
    };
  }
}

Map<String, dynamic> _authSessionPayload(String username, {String? token}) {
  return <String, dynamic>{
    if (token != null) ...<String, dynamic>{
      'accessToken': token,
      'accessTokenExpiresAt': '2030-01-01T00:00:00.000Z',
      'refreshToken': 'test-refresh-token',
      'refreshTokenExpiresAt': '2030-01-30T00:00:00.000Z',
    },
    'user': <String, dynamic>{
      'id': 'user-1',
      'name': '测试用户',
      'username': username,
      'role': 'admin',
      'isActive': true,
      'mustChangePassword': false,
      'createdAt': '2026-01-01T00:00:00.000Z',
      'updatedAt': '2026-01-01T00:00:00.000Z',
    },
    'permissions': <String>[],
    'menus': <Map<String, dynamic>>[],
    'dataScope': <String, dynamic>{},
  };
}
