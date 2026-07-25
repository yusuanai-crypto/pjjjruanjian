import '../api/api_client.dart';
import 'auth_models.dart';

class AuthService {
  AuthService({required ApiClient apiClient}) : _apiClient = apiClient;

  final ApiClient _apiClient;

  Future<AuthSession> login({
    required String username,
    required String password,
  }) async {
    final payload = await _apiClient.postJson(
      '/api/auth/login',
      body: {
        'username': username,
        'password': password,
      },
    );
    return AuthSession.fromJson(_data(payload));
  }

  Future<AuthSession> currentUser(String token) async {
    final payload = await _apiClient.getJson('/api/auth/me', token: token);
    return AuthSession.fromJson(_data(payload)).withToken(token);
  }

  Future<AuthSession> refresh(String refreshToken) async {
    final payload = await _apiClient.postJson(
      '/api/auth/refresh',
      body: <String, dynamic>{'refreshToken': refreshToken},
    );
    return AuthSession.fromJson(_data(payload));
  }

  Future<void> logout(String refreshToken) async {
    await _apiClient.postJson(
      '/api/auth/logout',
      body: <String, dynamic>{'refreshToken': refreshToken},
    );
  }

  Future<void> changePassword({
    required String token,
    required String currentPassword,
    required String newPassword,
  }) async {
    await _apiClient.postJson(
      '/api/auth/change-password',
      token: token,
      body: {
        'currentPassword': currentPassword,
        'newPassword': newPassword,
      },
    );
  }

  Map<String, dynamic> _data(Map<String, dynamic> payload) {
    final data = payload['data'];
    if (data is Map) {
      return data.map((key, value) => MapEntry('$key', value));
    }
    throw const ApiException(
      statusCode: 0,
      code: 'INVALID_RESPONSE',
      message: '服务器返回格式异常。',
    );
  }
}
