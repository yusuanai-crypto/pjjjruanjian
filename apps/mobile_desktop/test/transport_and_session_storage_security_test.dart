import 'package:flutter_test/flutter_test.dart';
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
      expect(
        preferences.getString('jiangjiu.config.apiBaseUrl'),
        'https://api.example.com',
      );
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
}
