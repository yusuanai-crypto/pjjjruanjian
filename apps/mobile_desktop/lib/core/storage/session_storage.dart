import 'package:shared_preferences/shared_preferences.dart';

class SessionStorage {
  SessionStorage._(this._preferences);

  static const _tokenKey = 'jiangjiu.auth.token';
  static const _apiBaseUrlKey = 'jiangjiu.config.apiBaseUrl';

  final SharedPreferences _preferences;

  static Future<SessionStorage> create() async {
    final preferences = await SharedPreferences.getInstance();
    return SessionStorage._(preferences);
  }

  String? readToken() {
    return _preferences.getString(_tokenKey);
  }

  Future<void> saveToken(String token) {
    return _preferences.setString(_tokenKey, token);
  }

  Future<void> clearToken() {
    return _preferences.remove(_tokenKey);
  }

  String? readApiBaseUrl() {
    return _preferences.getString(_apiBaseUrlKey);
  }

  Future<void> saveApiBaseUrl(String apiBaseUrl) {
    return _preferences.setString(_apiBaseUrlKey, apiBaseUrl);
  }
}
