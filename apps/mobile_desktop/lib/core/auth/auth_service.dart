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

  Future<AuthSession> changePassword({
    required String token,
    required String currentPassword,
    required String newPassword,
  }) async {
    final payload = await _apiClient.postJson(
      '/api/auth/change-password',
      token: token,
      body: {
        'currentPassword': currentPassword,
        'newPassword': newPassword,
      },
    );
    return AuthSession.fromJson(_data(payload));
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
