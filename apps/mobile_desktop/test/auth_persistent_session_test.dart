import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/auth/auth_controller.dart';
import 'package:jiangjiu_mobile_desktop/core/storage/session_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fake_secure_token_storage.dart';

void main() {
  test(
      'temporary network failure restores the cached session without clearing it',
      () async {
    final fixture = await _createFixture();
    await fixture.controller.login(
      username: 'offline.user',
      password: 'test-password',
    );

    final offlineApi = _PersistentAuthApiClient()
      ..currentUserError = const ApiException(
        statusCode: 0,
        code: 'NETWORK_ERROR',
        message: 'network unavailable',
      );
    final restored = AuthController(
      storage: fixture.storage,
      apiClient: offlineApi,
    );
    await restored.restore();

    expect(restored.session, isNotNull);
    expect(await fixture.storage.readSession(), isNotNull);
    expect(restored.restoreMessage, contains('本地登录状态'));

    offlineApi.currentUserError = null;
    await restored.refreshSession();
    expect(restored.session?.user.username, 'offline.user');
    fixture.close();
    offlineApi.close(force: true);
  });

  test('startup refreshes an expired access token with the refresh token',
      () async {
    final fixture = await _createFixture(
      loginAccessTokenExpiresAt: '2000-01-01T00:00:00.000Z',
    );
    await fixture.controller.login(
      username: 'refresh.user',
      password: 'test-password',
    );

    final refreshApi = _PersistentAuthApiClient();
    final restored = AuthController(
      storage: fixture.storage,
      apiClient: refreshApi,
    );
    await restored.restore();

    expect(refreshApi.refreshCalls, 1);
    expect(restored.session, isNotNull);
    expect(
      restored.session?.accessTokenExpiresAt == '2099-01-01T00:00:00.000Z',
      isTrue,
    );
    fixture.close();
    refreshApi.close(force: true);
  });

  test('concurrent refresh requests share one in-flight rotation', () async {
    final fixture = await _createFixture();
    await fixture.controller.login(
      username: 'single.flight',
      password: 'test-password',
    );
    final gate = Completer<void>();
    fixture.api.refreshGate = gate;

    final first = fixture.controller.refreshAccessToken();
    final second = fixture.controller.refreshAccessToken();
    await Future<void>.delayed(Duration.zero);
    expect(fixture.api.refreshCalls, 1);

    gate.complete();
    await Future.wait(<Future<String?>>[first, second]);
    expect(fixture.api.refreshCalls, 1);
    fixture.close();
  });

  test('temporary refresh failure keeps credentials for the next retry',
      () async {
    final fixture = await _createFixture(
      loginAccessTokenExpiresAt: '2000-01-01T00:00:00.000Z',
    );
    await fixture.controller.login(
      username: 'retry.user',
      password: 'test-password',
    );
    final temporaryApi = _PersistentAuthApiClient()
      ..refreshError = const ApiException(
        statusCode: 503,
        code: 'HTTP_ERROR',
        message: 'temporarily unavailable',
      );
    final restored = AuthController(
      storage: fixture.storage,
      apiClient: temporaryApi,
    );

    await restored.restore();

    expect(restored.session, isNotNull);
    expect(await fixture.storage.readSession(), isNotNull);
    fixture.close();
    temporaryApi.close(force: true);
  });

  test('terminal refresh failure clears the persistent session', () async {
    final fixture = await _createFixture(
      loginAccessTokenExpiresAt: '2000-01-01T00:00:00.000Z',
    );
    await fixture.controller.login(
      username: 'expired.user',
      password: 'test-password',
    );
    final terminalApi = _PersistentAuthApiClient()
      ..refreshError = const ApiException(
        statusCode: 401,
        code: 'REFRESH_TOKEN_EXPIRED',
        message: 'expired',
      );
    final restored = AuthController(
      storage: fixture.storage,
      apiClient: terminalApi,
    );

    await restored.restore();

    expect(restored.session, isNull);
    expect(await fixture.storage.readSession(), isNull);
    fixture.close();
    terminalApi.close(force: true);
  });
}

Future<_Fixture> _createFixture({
  String loginAccessTokenExpiresAt = '2099-01-01T00:00:00.000Z',
}) async {
  SharedPreferences.setMockInitialValues(<String, Object>{});
  final preferences = await SharedPreferences.getInstance();
  final storage = await SessionStorage.create(
    preferences: preferences,
    secureStorage: FakeSecureTokenStorage(),
  );
  final api = _PersistentAuthApiClient(
    loginAccessTokenExpiresAt: loginAccessTokenExpiresAt,
  );
  return _Fixture(
    storage: storage,
    api: api,
    controller: AuthController(storage: storage, apiClient: api),
  );
}

class _Fixture {
  const _Fixture({
    required this.storage,
    required this.api,
    required this.controller,
  });

  final SessionStorage storage;
  final _PersistentAuthApiClient api;
  final AuthController controller;

  void close() => api.close(force: true);
}

class _PersistentAuthApiClient extends ApiClient {
  _PersistentAuthApiClient({
    this.loginAccessTokenExpiresAt = '2099-01-01T00:00:00.000Z',
  }) : super(baseUrl: 'https://api.example.invalid');

  final String loginAccessTokenExpiresAt;
  ApiException? currentUserError;
  ApiException? refreshError;
  Completer<void>? refreshGate;
  int refreshCalls = 0;

  @override
  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    if (path == '/api/auth/login') {
      return <String, dynamic>{
        'data': _sessionPayload(
          '${body?['username'] ?? 'test.user'}',
          accessToken: 'login-access',
          accessTokenExpiresAt: loginAccessTokenExpiresAt,
          refreshToken: 'login-refresh',
        ),
      };
    }
    if (path == '/api/auth/refresh') {
      refreshCalls += 1;
      final error = refreshError;
      if (error != null) {
        throw error;
      }
      await refreshGate?.future;
      return <String, dynamic>{
        'data': _sessionPayload(
          'refresh.user',
          accessToken: 'refreshed-access',
          accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
          refreshToken: 'rotated-refresh',
        ),
      };
    }
    if (path == '/api/auth/logout') {
      return <String, dynamic>{
        'data': <String, dynamic>{'loggedOut': true},
      };
    }
    if (path == '/api/auth/change-password') {
      return <String, dynamic>{
        'data': <String, dynamic>{'passwordChanged': true},
      };
    }
    throw StateError('Unexpected POST path.');
  }

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    if (path != '/api/auth/me') {
      throw StateError('Unexpected GET path.');
    }
    final error = currentUserError;
    if (error != null) {
      throw error;
    }
    return <String, dynamic>{
      'data': _sessionPayload('offline.user'),
    };
  }
}

Map<String, dynamic> _sessionPayload(
  String username, {
  String? accessToken,
  String? accessTokenExpiresAt,
  String? refreshToken,
}) {
  return <String, dynamic>{
    if (accessToken != null) 'accessToken': accessToken,
    if (accessTokenExpiresAt != null)
      'accessTokenExpiresAt': accessTokenExpiresAt,
    if (refreshToken != null) 'refreshToken': refreshToken,
    if (refreshToken != null)
      'refreshTokenExpiresAt': '2099-02-01T00:00:00.000Z',
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
