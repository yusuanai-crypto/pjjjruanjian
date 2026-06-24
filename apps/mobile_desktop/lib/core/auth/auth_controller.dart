import '../api/api_client.dart';
import '../config/app_config.dart';
import '../storage/session_storage.dart';
import 'auth_models.dart';
import 'auth_service.dart';

class AuthController {
  AuthController({
    required SessionStorage storage,
  })  : _storage = storage,
        _apiClient = ApiClient(baseUrl: AppConfig.defaultApiBaseUrl) {
    _authService = AuthService(apiClient: _apiClient);
  }

  final SessionStorage _storage;
  final ApiClient _apiClient;
  late final AuthService _authService;

  String apiBaseUrl = AppConfig.defaultApiBaseUrl;
  AuthSession? session;
  String? restoreMessage;

  ApiClient get apiClient => _apiClient;

  String get token => session?.token ?? '';

  Future<void> restore() async {
    apiBaseUrl = AppConfig.normalizeApiBaseUrl(_storage.readApiBaseUrl() ?? AppConfig.defaultApiBaseUrl);
    _apiClient.baseUrl = apiBaseUrl;

    final token = _storage.readToken();
    if (token == null || token.isEmpty) {
      return;
    }

    try {
      session = await _authService.currentUser(token);
    } catch (_) {
      await _storage.clearToken();
      restoreMessage = '登录已过期，请重新登录。';
    }
  }

  Future<void> login({
    required String nextApiBaseUrl,
    required String username,
    required String password,
  }) async {
    apiBaseUrl = AppConfig.normalizeApiBaseUrl(nextApiBaseUrl);
    _apiClient.baseUrl = apiBaseUrl;

    try {
      final nextSession = await _authService.login(username: username, password: password);
      final token = nextSession.token;
      if (token == null || token.isEmpty) {
        throw const AuthFailure('服务器未返回登录令牌。');
      }

      await _storage.saveApiBaseUrl(apiBaseUrl);
      await _storage.saveToken(token);
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
