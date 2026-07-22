import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/auth/auth_controller.dart';
import 'package:jiangjiu_mobile_desktop/core/storage/session_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fake_secure_token_storage.dart';

void main() {
  test('SESSION_REVOKED clears local session and requests the login view',
      () async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final preferences = await SharedPreferences.getInstance();
    final storage = await SessionStorage.create(
      preferences: preferences,
      secureStorage: FakeSecureTokenStorage(),
    );
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final subscription = server.listen((request) async {
      request.response.headers.contentType = ContentType.json;
      if (request.uri.path == '/api/auth/login') {
        request.response.statusCode = HttpStatus.ok;
        request.response.write(jsonEncode(<String, Object>{
          'data': _sessionPayload(),
        }));
      } else {
        request.response.statusCode = HttpStatus.unauthorized;
        request.response.write(jsonEncode(<String, Object>{
          'error': <String, String>{
            'code': 'SESSION_REVOKED',
            'message': 'The session has been revoked.',
          },
        }));
      }
      await request.response.close();
    });
    final client = ApiClient(
      baseUrl: 'http://${server.address.address}:${server.port}',
    );
    var loginViewRequested = false;
    final controller = AuthController(
      storage: storage,
      apiClient: client,
      onSessionRevoked: () {
        loginViewRequested = true;
      },
    );

    try {
      await controller.login(
        username: 'test-user',
        password: 'test-password',
      );
      expect(controller.session, isNotNull);
      expect(await storage.readToken(), isNotNull);

      await expectLater(
        client.getJson('/api/protected', token: controller.token),
        throwsA(
          isA<ApiException>().having(
            (error) => error.code,
            'code',
            'SESSION_REVOKED',
          ),
        ),
      );

      expect(controller.session, isNull);
      expect(await storage.readToken(), isNull);
      expect(controller.restoreMessage, '会话已失效，请重新登录。');
      expect(loginViewRequested, isTrue);
    } finally {
      client.close(force: true);
      await subscription.cancel();
      await server.close(force: true);
    }
  });

  test('ACCOUNT_DISABLED clears secure storage and requests the login view',
      () async {
    await _expectTerminalSessionErrorClears('ACCOUNT_DISABLED');
  });

  test('logout clears the secure token and any leftover legacy value',
      () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      SessionStorage.tokenKey: 'legacy-test-token',
    });
    final preferences = await SharedPreferences.getInstance();
    final secureStorage = FakeSecureTokenStorage();
    final storage = await SessionStorage.create(
      preferences: preferences,
      secureStorage: secureStorage,
    );
    final client = ApiClient(baseUrl: 'https://api.example.invalid');
    final controller = AuthController(storage: storage, apiClient: client);

    try {
      await controller.logout();
      expect(await storage.readToken(), isNull);
      expect(preferences.containsKey(SessionStorage.tokenKey), isFalse);
      expect(secureStorage.values, isEmpty);
    } finally {
      client.close(force: true);
    }
  });
}

Future<void> _expectTerminalSessionErrorClears(String errorCode) async {
  SharedPreferences.setMockInitialValues(<String, Object>{});
  final preferences = await SharedPreferences.getInstance();
  final storage = await SessionStorage.create(
    preferences: preferences,
    secureStorage: FakeSecureTokenStorage(),
  );
  final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  final subscription = server.listen((request) async {
    request.response.headers.contentType = ContentType.json;
    if (request.uri.path == '/api/auth/login') {
      request.response.statusCode = HttpStatus.ok;
      request.response.write(jsonEncode(<String, Object>{
        'data': _sessionPayload(),
      }));
    } else {
      request.response.statusCode = HttpStatus.forbidden;
      request.response.write(jsonEncode(<String, Object>{
        'error': <String, String>{
          'code': errorCode,
          'message': 'The account is disabled.',
        },
      }));
    }
    await request.response.close();
  });
  final client = ApiClient(
    baseUrl: 'http://${server.address.address}:${server.port}',
  );
  var loginViewRequested = false;
  final controller = AuthController(
    storage: storage,
    apiClient: client,
    onSessionRevoked: () {
      loginViewRequested = true;
    },
  );

  try {
    await controller.login(
      username: 'test-user',
      password: 'test-password',
    );
    expect(await storage.readToken(), isNotNull);

    await expectLater(
      client.getJson('/api/protected', token: controller.token),
      throwsA(
        isA<ApiException>().having(
          (error) => error.code,
          'code',
          errorCode,
        ),
      ),
    );

    expect(controller.session, isNull);
    expect(await storage.readToken(), isNull);
    expect(loginViewRequested, isTrue);
  } finally {
    client.close(force: true);
    await subscription.cancel();
    await server.close(force: true);
  }
}

Map<String, Object> _sessionPayload() {
  return <String, Object>{
    'token': 'test-session-token',
    'expiresAt': '2030-01-01T00:00:00.000Z',
    'user': <String, Object>{
      'id': 'usr-test-session',
      'name': 'Test User',
      'username': 'test-user',
      'role': 'admin',
      'isActive': true,
      'mustChangePassword': false,
      'createdAt': '2026-01-01T00:00:00.000Z',
      'updatedAt': '2026-01-01T00:00:00.000Z',
    },
    'permissions': <String>[],
    'menus': <Object>[],
    'dataScope': <String, Object>{},
  };
}
