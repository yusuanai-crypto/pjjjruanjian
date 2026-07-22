import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

abstract interface class SecureTokenStorage {
  Future<String?> read(String key);

  Future<void> write(String key, String value);

  Future<void> delete(String key);
}

class PlatformSecureTokenStorage implements SecureTokenStorage {
  const PlatformSecureTokenStorage({
    FlutterSecureStorage storage = const FlutterSecureStorage(),
  }) : _storage = storage;

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

class SessionStorage {
  SessionStorage._(this._preferences, this._secureStorage);

  static const tokenKey = 'jiangjiu.auth.token';
  static const lastUsernameKey = 'jiangjiu.auth.lastUsername';
  static const _apiBaseUrlKey = 'jiangjiu.config.apiBaseUrl';

  final SharedPreferences _preferences;
  final SecureTokenStorage _secureStorage;

  static Future<SessionStorage> create({
    SharedPreferences? preferences,
    SecureTokenStorage secureStorage = const PlatformSecureTokenStorage(),
  }) async {
    final storage = SessionStorage._(
      preferences ?? await SharedPreferences.getInstance(),
      secureStorage,
    );
    await storage._clearLegacyApiBaseUrl();
    await storage._migrateLegacyToken();
    return storage;
  }

  Future<String?> readToken() {
    return _secureStorage.read(tokenKey);
  }

  Future<void> saveToken(String token) async {
    await _secureStorage.write(tokenKey, token);
    final confirmed = await _secureStorage.read(tokenKey);
    if (confirmed != token) {
      await _rollbackSecureToken();
      throw StateError('The secure session write could not be verified.');
    }
  }

  Future<void> clearToken() async {
    await _secureStorage.delete(tokenKey);
    await _preferences.remove(tokenKey);
  }

  String? readLastUsername() {
    final username = _preferences.getString(lastUsernameKey)?.trim();
    return username == null || username.isEmpty ? null : username;
  }

  Future<void> saveLastUsername(String username) async {
    final normalizedUsername = username.trim();
    if (normalizedUsername.isEmpty) {
      return;
    }
    final saved = await _preferences.setString(
      lastUsernameKey,
      normalizedUsername,
    );
    if (!saved) {
      throw StateError('The last username could not be saved.');
    }
  }

  Future<void> _clearLegacyApiBaseUrl() async {
    final removed = await _preferences.remove(_apiBaseUrlKey);
    if (!removed && _preferences.containsKey(_apiBaseUrlKey)) {
      throw StateError('The saved API address could not be removed.');
    }
  }

  Future<void> _migrateLegacyToken() async {
    final legacyToken = _preferences.getString(tokenKey);
    if (legacyToken == null || legacyToken.isEmpty) {
      return;
    }

    final existingSecureToken = await _secureStorage.read(tokenKey);
    if (existingSecureToken != null && existingSecureToken.isNotEmpty) {
      final removed = await _preferences.remove(tokenKey);
      if (!removed && _preferences.containsKey(tokenKey)) {
        throw StateError('The legacy session could not be removed.');
      }
      return;
    }

    try {
      await _secureStorage.write(tokenKey, legacyToken);
      final confirmed = await _secureStorage.read(tokenKey);
      if (confirmed != legacyToken) {
        throw StateError('The secure session migration could not be verified.');
      }
      final removed = await _preferences.remove(tokenKey);
      if (!removed && _preferences.containsKey(tokenKey)) {
        throw StateError('The legacy session could not be removed.');
      }
    } catch (_) {
      await _rollbackSecureToken();
      rethrow;
    }
  }

  Future<void> _rollbackSecureToken() async {
    try {
      await _secureStorage.delete(tokenKey);
    } catch (_) {
      // Preserve the original failure without exposing session data.
    }
  }
}
