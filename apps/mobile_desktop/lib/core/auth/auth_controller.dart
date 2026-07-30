import 'dart:async';

import '../api/api_client.dart';
import '../config/app_config.dart';
import '../storage/session_storage.dart';
import 'auth_models.dart';
import 'auth_service.dart';

class AuthController {
  AuthController({
    required SessionStorage storage,
    ApiClient? apiClient,
    AuthService? authService,
    void Function()? onSessionRevoked,
  })  : _storage = storage,
        _apiClient =
            apiClient ?? ApiClient(baseUrl: AppConfig.defaultApiBaseUrl),
        _onSessionRevoked = onSessionRevoked {
    _authService = authService ?? AuthService(apiClient: _apiClient);
    _apiClient.onSessionRevoked = _handleSessionRevoked;
    _apiClient.onAccessTokenExpired = refreshAccessToken;
    _apiClient.accessTokenProvider = () => token;
  }

  final SessionStorage _storage;
  final ApiClient _apiClient;
  final void Function()? _onSessionRevoked;
  late final AuthService _authService;
  Future<String?>? _refreshInFlight;

  String lastUsername = '';
  AuthSession? session;
  String? restoreMessage;

  ApiClient get apiClient => _apiClient;

  String get token => session?.token ?? '';

  List<String> get rememberedUsernames => _storage.readRememberedUsernames();

  bool get rememberPasswordEnabled => _storage.readRememberPasswordEnabled();

  Future<String?> readRememberedPassword(String username) {
    return _storage.readRememberedPassword(username);
  }

  Future<void> requireLoginOnLaunch() async {
    await _storage.clearSession();
    lastUsername = '';
    session = null;
    restoreMessage = null;
  }

  Future<void> restore() async {
    lastUsername = _storage.readLastUsername() ?? '';
    final storedSession = await _storage.readSession();
    if (storedSession == null) {
      await _restoreLegacyAccessToken();
      return;
    }

    session = storedSession;
    final refreshExpiry = storedSession.refreshTokenExpiresAt;
    if (_isExpired(refreshExpiry)) {
      await _clearTerminalSession(
        const ApiException(
          statusCode: 401,
          code: 'REFRESH_TOKEN_EXPIRED',
          message: 'Refresh session expired.',
        ),
      );
      return;
    }

    try {
      if (_isExpiredOrNear(storedSession.expiresAt)) {
        await refreshAccessToken();
      } else {
        final current = await _authService.currentUser(storedSession.token!);
        final restored = current.withTokensFrom(storedSession);
        await _acceptSession(restored);
      }
      restoreMessage = null;
    } on ApiException catch (error) {
      if (_isTerminalSessionError(error)) {
        if (session != null) {
          await _clearTerminalSession(error);
        }
        return;
      }
      if (_isTemporarySessionError(error)) {
        session = storedSession;
        restoreMessage = '网络暂时不可用，已恢复本地登录状态。';
        return;
      }
      session = storedSession;
      restoreMessage = messageForAuthError(error);
    } catch (_) {
      session = storedSession;
      restoreMessage = '网络暂时不可用，已恢复本地登录状态。';
    }
  }

  Future<void> login({
    required String username,
    required String password,
    bool rememberPassword = false,
  }) async {
    AuthSession? issuedSession;
    try {
      final nextSession =
          await _authService.login(username: username, password: password);
      issuedSession = nextSession;
      _requireCompleteCredentials(nextSession);

      await _storage.saveSession(nextSession);
      final confirmedUsername = nextSession.user.username.trim().isNotEmpty
          ? nextSession.user.username.trim()
          : username.trim();
      await _storage.saveLastUsername(confirmedUsername);
      await _storage.saveRememberPasswordEnabled(rememberPassword);
      if (rememberPassword) {
        await _storage.saveRememberedPassword(
          confirmedUsername,
          password,
        );
      }
      lastUsername = confirmedUsername;
      session = nextSession;
      restoreMessage = null;
    } on AuthFailure {
      rethrow;
    } catch (error) {
      if (issuedSession != null) {
        await _discardIssuedSession(issuedSession);
      }
      throw AuthFailure(messageForAuthError(error));
    }
  }

  Future<String?> refreshAccessToken() {
    final currentRefresh = _refreshInFlight;
    if (currentRefresh != null) {
      return currentRefresh;
    }

    final completer = Completer<String?>();
    _refreshInFlight = completer.future;
    () async {
      try {
        completer.complete(await _performRefresh());
      } catch (error, stackTrace) {
        completer.completeError(error, stackTrace);
      } finally {
        _refreshInFlight = null;
      }
    }();
    return completer.future;
  }

  Future<void> refreshSession() async {
    final current = session;
    if (current == null) {
      return;
    }
    try {
      if (_isExpiredOrNear(current.expiresAt)) {
        await refreshAccessToken();
      } else {
        final refreshed = await _authService.currentUser(current.token!);
        await _acceptSession(refreshed.withTokensFrom(current));
      }
      restoreMessage = null;
    } on ApiException catch (error) {
      if (_isTerminalSessionError(error) && session != null) {
        await _clearTerminalSession(error);
      }
      rethrow;
    }
  }

  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    final currentToken = token;
    if (currentToken.isEmpty) {
      throw const AuthFailure('登录已过期，请重新登录。');
    }
    try {
      await _authService.changePassword(
        token: currentToken,
        currentPassword: currentPassword,
        newPassword: newPassword,
      );
      await _storage.clearSession();
      session = null;
      restoreMessage = '密码已修改，请使用新密码重新登录。';
      _onSessionRevoked?.call();
    } on AuthFailure {
      rethrow;
    } catch (error) {
      throw AuthFailure(messageForAuthError(error));
    }
  }

  Future<void> logout() async {
    final refreshToken = session?.refreshToken;
    try {
      if (refreshToken != null && refreshToken.isNotEmpty) {
        await _authService.logout(refreshToken);
      }
    } catch (_) {
      // Local logout must succeed even when the server is temporarily offline.
    } finally {
      await _storage.clearSession();
      session = null;
    }
  }

  Future<void> forgetAccount(String username) async {
    await _storage.forgetAccount(username);
    lastUsername = _storage.readLastUsername() ?? '';
  }

  Future<String?> _performRefresh() async {
    final current = session ?? await _storage.readSession();
    final refreshToken = current?.refreshToken;
    if (refreshToken == null || refreshToken.isEmpty) {
      const error = ApiException(
        statusCode: 401,
        code: 'REFRESH_TOKEN_INVALID',
        message: 'Refresh session is unavailable.',
      );
      await _clearTerminalSession(error);
      throw error;
    }
    if (_isExpired(current!.refreshTokenExpiresAt)) {
      const error = ApiException(
        statusCode: 401,
        code: 'REFRESH_TOKEN_EXPIRED',
        message: 'Refresh session expired.',
      );
      await _clearTerminalSession(error);
      throw error;
    }

    try {
      final refreshed = await _authService.refresh(refreshToken);
      _requireCompleteCredentials(refreshed);
      await _acceptSession(refreshed);
      return refreshed.token;
    } on ApiException catch (error) {
      if (_isTerminalSessionError(error) && session != null) {
        await _clearTerminalSession(error);
      }
      rethrow;
    }
  }

  Future<void> _acceptSession(AuthSession nextSession) async {
    _requireCompleteCredentials(nextSession);
    await _storage.saveSession(nextSession);
    session = nextSession;
    final username = nextSession.user.username.trim();
    if (username.isNotEmpty) {
      await _storage.saveLastUsername(username);
      lastUsername = username;
    }
  }

  Future<void> _restoreLegacyAccessToken() async {
    final legacyToken = await _storage.readToken();
    if (legacyToken == null || legacyToken.isEmpty) {
      return;
    }
    try {
      session = await _authService.currentUser(legacyToken);
      final restoredUsername = session!.user.username.trim();
      if (restoredUsername.isNotEmpty) {
        await _storage.saveLastUsername(restoredUsername);
        lastUsername = restoredUsername;
      }
    } on ApiException catch (error) {
      if (_isTerminalSessionError(error)) {
        await _storage.clearSession();
        session = null;
        restoreMessage = messageForAuthError(error);
      } else {
        restoreMessage = messageForAuthError(error);
      }
    } catch (_) {
      restoreMessage = '网络暂时不可用，保留了本地登录凭据。';
    }
  }

  Future<void> _discardIssuedSession(AuthSession issuedSession) async {
    try {
      final refreshToken = issuedSession.refreshToken;
      if (refreshToken != null && refreshToken.isNotEmpty) {
        await _authService.logout(refreshToken);
      }
    } catch (_) {
      // Preserve the original local storage failure.
    }
    await _storage.clearSession();
    session = null;
  }

  Future<void> _handleSessionRevoked(ApiException error) {
    return _clearTerminalSession(error);
  }

  Future<void> _clearTerminalSession(ApiException error) async {
    await _storage.clearSession();
    session = null;
    restoreMessage = messageForAuthError(error);
    _onSessionRevoked?.call();
  }
}

void _requireCompleteCredentials(AuthSession session) {
  if (session.token?.isEmpty != false ||
      session.expiresAt?.isEmpty != false ||
      session.refreshToken?.isEmpty != false ||
      session.refreshTokenExpiresAt?.isEmpty != false) {
    throw const AuthFailure('服务器未返回完整的登录凭据。');
  }
}

bool _isExpired(String? value) {
  final expiresAt = DateTime.tryParse(value ?? '');
  return expiresAt == null || !expiresAt.isAfter(DateTime.now().toUtc());
}

bool _isExpiredOrNear(String? value) {
  final expiresAt = DateTime.tryParse(value ?? '');
  return expiresAt == null ||
      !expiresAt.isAfter(
        DateTime.now().toUtc().add(const Duration(seconds: 30)),
      );
}

bool _isTerminalSessionError(ApiException error) {
  return error.code == 'SESSION_REVOKED' ||
      error.code == 'ACCOUNT_DISABLED' ||
      error.code == 'ACCOUNT_FROZEN' ||
      error.code == 'USER_DISABLED' ||
      error.code == 'AUTH_USER_NOT_FOUND' ||
      error.code == 'INVALID_AUTH_TOKEN' ||
      error.code == 'REFRESH_TOKEN_EXPIRED' ||
      error.code == 'REFRESH_TOKEN_INVALID' ||
      error.code == 'REFRESH_TOKEN_REUSED';
}

bool _isTemporarySessionError(ApiException error) {
  return error.statusCode == 0 ||
      error.statusCode >= 500 ||
      error.code == 'NETWORK_ERROR' ||
      error.code == 'INVALID_RESPONSE';
}

class AuthFailure implements Exception {
  const AuthFailure(this.message);

  final String message;

  @override
  String toString() => message;
}

String messageForAuthError(Object error) {
  if (error is AuthFailure) {
    return error.message;
  }

  if (error is ApiException) {
    if (error.statusCode == 502 ||
        error.statusCode == 503 ||
        error.statusCode == 504) {
      return '服务器暂时不可用（HTTP ${error.statusCode}），请稍后重试。';
    }
    switch (error.code) {
      case 'LOGIN_FIELDS_REQUIRED':
        return '请输入账号和密码。';
      case 'INVALID_CREDENTIALS':
        return '账号或密码不正确。';
      case 'ACCOUNT_DISABLED':
      case 'ACCOUNT_FROZEN':
      case 'USER_DISABLED':
        return '账号已停用，请联系管理员。';
      case 'PASSWORD_CHANGE_REQUIRED':
        return '请先修改初始密码。';
      case 'SESSION_REVOKED':
      case 'AUTH_USER_NOT_FOUND':
      case 'INVALID_AUTH_TOKEN':
        return '会话已失效，请重新登录。';
      case 'REFRESH_TOKEN_EXPIRED':
        return '免登录期限已到，请重新登录。';
      case 'REFRESH_TOKEN_INVALID':
      case 'REFRESH_TOKEN_REUSED':
        return '登录凭据已失效，请重新登录。';
      case 'CURRENT_PASSWORD_INCORRECT':
        return '当前密码不正确。';
      case 'WEAK_PASSWORD':
        return '新密码至少需要 8 位。';
      case 'NETWORK_ERROR':
      case 'INVALID_SERVER_URL':
      case 'INVALID_RESPONSE':
        return error.message;
      default:
        return error.message.isEmpty ? '登录失败，请稍后重试。' : error.message;
    }
  }

  if (error is UnsupportedUserRoleException) {
    return '服务器返回了无法识别的用户角色：${error.displayValue}。请联系管理员检查后端版本。';
  }

  if (error is FormatException) {
    return '服务器返回的数据格式异常。';
  }

  return '登录失败，请稍后重试。';
}
