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
  }

  final SessionStorage _storage;
  final ApiClient _apiClient;
  final void Function()? _onSessionRevoked;
  late final AuthService _authService;

  String lastUsername = 'admin';
  AuthSession? session;
  String? restoreMessage;

  ApiClient get apiClient => _apiClient;

  String get token => session?.token ?? '';

  Future<void> restore() async {
    lastUsername = _storage.readLastUsername() ?? 'admin';

    final token = await _storage.readToken();
    if (token == null || token.isEmpty) {
      return;
    }

    try {
      session = await _authService.currentUser(token);
      final restoredUsername = session!.user.username.trim();
      if (restoredUsername.isNotEmpty) {
        await _storage.saveLastUsername(restoredUsername);
        lastUsername = restoredUsername;
      }
    } on ApiException catch (error) {
      if (_isTerminalSessionError(error)) {
        await _storage.clearToken();
        session = null;
        restoreMessage = messageForAuthError(error);
        return;
      }
      await _storage.clearToken();
      restoreMessage = '登录已过期，请重新登录。';
    } catch (_) {
      await _storage.clearToken();
      restoreMessage = '登录已过期，请重新登录。';
    }
  }

  Future<void> login({
    required String username,
    required String password,
  }) async {
    try {
      final nextSession =
          await _authService.login(username: username, password: password);
      final token = nextSession.token;
      if (token == null || token.isEmpty) {
        throw const AuthFailure('服务器未返回登录令牌。');
      }

      await _storage.saveToken(token);
      final confirmedUsername = nextSession.user.username.trim().isNotEmpty
          ? nextSession.user.username.trim()
          : username.trim();
      await _storage.saveLastUsername(confirmedUsername);
      lastUsername = confirmedUsername;
      session = nextSession;
      restoreMessage = null;
    } on AuthFailure {
      rethrow;
    } catch (error) {
      throw AuthFailure(messageForAuthError(error));
    }
  }

  Future<void> refreshSession() async {
    final currentToken = token;
    if (currentToken.isEmpty) {
      return;
    }
    try {
      session = await _authService.currentUser(currentToken);
      restoreMessage = null;
    } catch (error) {
      await logout();
      restoreMessage = messageForAuthError(error);
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
      final nextSession = await _authService.changePassword(
        token: currentToken,
        currentPassword: currentPassword,
        newPassword: newPassword,
      );
      final replacementToken = nextSession.token;
      if (replacementToken == null || replacementToken.isEmpty) {
        throw const AuthFailure('服务器未返回新登录令牌。');
      }
      await _storage.saveToken(replacementToken);
      session = nextSession;
      restoreMessage = null;
    } on AuthFailure {
      rethrow;
    } catch (error) {
      throw AuthFailure(messageForAuthError(error));
    }
  }

  Future<void> logout() async {
    await _storage.clearToken();
    session = null;
  }

  Future<void> _handleSessionRevoked(ApiException error) async {
    await _storage.clearToken();
    session = null;
    restoreMessage = messageForAuthError(error);
    _onSessionRevoked?.call();
  }
}

bool _isTerminalSessionError(ApiException error) {
  return error.code == 'SESSION_REVOKED' ||
      error.code == 'ACCOUNT_DISABLED' ||
      error.code == 'ACCOUNT_FROZEN' ||
      error.code == 'USER_DISABLED';
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
    switch (error.code) {
      case 'LOGIN_FIELDS_REQUIRED':
        return '请输入账号和密码。';
      case 'INVALID_CREDENTIALS':
        return '账号或密码不正确。';
      case 'ACCOUNT_DISABLED':
        return '账号已停用，请联系管理员。';
      case 'PASSWORD_CHANGE_REQUIRED':
        return '请先修改初始密码。';
      case 'SESSION_REVOKED':
        return '会话已失效，请重新登录。';
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

  if (error is FormatException) {
    return '服务器返回了无法识别的用户角色。';
  }

  return '登录失败，请稍后重试。';
}
