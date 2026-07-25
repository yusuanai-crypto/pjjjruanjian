import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../auth/auth_models.dart';

abstract interface class SecureTokenStorage {
  Future<String?> read(String key);

  Future<void> write(String key, String value);

  Future<void> delete(String key);
}

class PlatformSecureTokenStorage implements SecureTokenStorage {
  const PlatformSecureTokenStorage({
    FlutterSecureStorage storage = const FlutterSecureStorage(
      aOptions: AndroidOptions(migrateWithBackup: false),
      iOptions: IOSOptions(
        accessibility: KeychainAccessibility.first_unlock_this_device,
        synchronizable: false,
      ),
    ),
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
  static const sessionKey = 'jiangjiu.auth.session.v2';
  static const rememberedPasswordsKey = 'jiangjiu.auth.passwords.v1';
  static const lastUsernameKey = 'jiangjiu.auth.lastUsername';
  static const rememberedUsernamesKey = 'jiangjiu.auth.rememberedUsernames';
  static const rememberPasswordEnabledKey =
      'jiangjiu.auth.rememberPasswordEnabled';
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

  Future<AuthSession?> readSession() async {
    final encoded = await _secureStorage.read(sessionKey);
    if (encoded == null || encoded.isEmpty) {
      return null;
    }
    try {
      final decoded = jsonDecode(encoded);
      if (decoded is! Map) {
        throw const FormatException();
      }
      return AuthSession.fromJson(
        decoded.map((key, value) => MapEntry('$key', value)),
      );
    } on FormatException {
      throw StateError('The secure session data is invalid.');
    }
  }

  Future<void> saveSession(AuthSession session) async {
    if (!_hasCompleteCredentials(session)) {
      throw StateError('The secure session credentials are incomplete.');
    }
    final encoded = jsonEncode(session.toJson());
    try {
      await _secureStorage.write(sessionKey, encoded);
      if (await _secureStorage.read(sessionKey) != encoded) {
        throw StateError('The secure session write could not be verified.');
      }
      await _secureStorage.delete(tokenKey);
      await _preferences.remove(tokenKey);
    } catch (_) {
      await _rollbackSecureKey(sessionKey);
      rethrow;
    }
  }

  Future<void> clearSession() async {
    await _secureStorage.delete(sessionKey);
    await _secureStorage.delete(tokenKey);
    await _preferences.remove(tokenKey);
  }

  Future<String?> readToken() async {
    final session = await readSession();
    return session?.token ?? _secureStorage.read(tokenKey);
  }

  Future<void> saveToken(String token) async {
    await _secureStorage.write(tokenKey, token);
    final confirmed = await _secureStorage.read(tokenKey);
    if (confirmed != token) {
      await _rollbackSecureKey(tokenKey);
      throw StateError('The secure session write could not be verified.');
    }
  }

  Future<void> clearToken() => clearSession();

  String? readLastUsername() {
    final username = _preferences.getString(lastUsernameKey)?.trim();
    return username == null || username.isEmpty ? null : username;
  }

  Future<void> saveLastUsername(String username) async {
    final normalizedUsername = _normalizeUsername(username);
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

  List<String> readRememberedUsernames() {
    final usernames =
        _preferences.getStringList(rememberedUsernamesKey) ?? const <String>[];
    return _normalizedUniqueUsernames(usernames);
  }

  bool readRememberPasswordEnabled() {
    return _preferences.getBool(rememberPasswordEnabledKey) ?? false;
  }

  Future<String?> readRememberedPassword(String username) async {
    final normalizedUsername = _normalizeUsername(username);
    if (normalizedUsername.isEmpty) {
      return null;
    }
    return (await _readPasswordMap())[normalizedUsername];
  }

  Future<void> saveRememberedPassword(
    String username,
    String password,
  ) async {
    final normalizedUsername = _normalizeUsername(username);
    if (normalizedUsername.isEmpty || password.isEmpty) {
      throw StateError('The remembered credential is incomplete.');
    }
    final previousPasswords = await _readPasswordMap();
    final nextPasswords = <String, String>{
      ...previousPasswords,
      normalizedUsername: password,
    };
    await _writePasswordMap(nextPasswords);
    try {
      final usernames = _normalizedUniqueUsernames(<String>[
        ...readRememberedUsernames(),
        normalizedUsername,
      ]);
      if (!await _preferences.setStringList(
        rememberedUsernamesKey,
        usernames,
      )) {
        throw StateError('The remembered account list could not be saved.');
      }
    } catch (_) {
      await _writePasswordMap(previousPasswords);
      rethrow;
    }
  }

  Future<void> saveRememberPasswordEnabled(bool enabled) async {
    if (!await _preferences.setBool(rememberPasswordEnabledKey, enabled)) {
      throw StateError('The remember-password preference could not be saved.');
    }
  }

  Future<void> forgetAccount(String username) async {
    final normalizedUsername = _normalizeUsername(username);
    if (normalizedUsername.isEmpty) {
      return;
    }
    final passwords = await _readPasswordMap();
    passwords.remove(normalizedUsername);
    await _writePasswordMap(passwords);

    final usernames = readRememberedUsernames()
        .where((item) => item != normalizedUsername)
        .toList();
    if (!await _preferences.setStringList(
      rememberedUsernamesKey,
      usernames,
    )) {
      throw StateError('The remembered account list could not be updated.');
    }
    if (readLastUsername() == normalizedUsername) {
      if (usernames.isEmpty) {
        await _preferences.remove(lastUsernameKey);
      } else {
        await saveLastUsername(usernames.first);
      }
    }
  }

  Future<Map<String, String>> _readPasswordMap() async {
    final encoded = await _secureStorage.read(rememberedPasswordsKey);
    if (encoded == null || encoded.isEmpty) {
      return <String, String>{};
    }
    try {
      final decoded = jsonDecode(encoded);
      if (decoded is! Map) {
        throw const FormatException();
      }
      return decoded.map(
        (key, value) => MapEntry(_normalizeUsername('$key'), '$value'),
      )..removeWhere((key, value) => key.isEmpty || value.isEmpty);
    } on FormatException {
      throw StateError('The secure remembered-account data is invalid.');
    }
  }

  Future<void> _writePasswordMap(Map<String, String> passwords) async {
    if (passwords.isEmpty) {
      await _secureStorage.delete(rememberedPasswordsKey);
      if (await _secureStorage.read(rememberedPasswordsKey) != null) {
        throw StateError('The secure remembered account could not be removed.');
      }
      return;
    }
    final encoded = jsonEncode(passwords);
    await _secureStorage.write(rememberedPasswordsKey, encoded);
    if (await _secureStorage.read(rememberedPasswordsKey) != encoded) {
      throw StateError('The secure remembered account could not be saved.');
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
      await _rollbackSecureKey(tokenKey);
      rethrow;
    }
  }

  Future<void> _rollbackSecureKey(String key) async {
    try {
      await _secureStorage.delete(key);
    } catch (_) {
      // Preserve the original failure without exposing credential data.
    }
  }
}

bool _hasCompleteCredentials(AuthSession session) {
  return session.token?.isNotEmpty == true &&
      session.expiresAt?.isNotEmpty == true &&
      session.refreshToken?.isNotEmpty == true &&
      session.refreshTokenExpiresAt?.isNotEmpty == true;
}

String _normalizeUsername(String username) {
  return username.trim().toLowerCase();
}

List<String> _normalizedUniqueUsernames(Iterable<String> usernames) {
  final result = <String>[];
  final seen = <String>{};
  for (final username in usernames) {
    final normalized = _normalizeUsername(username);
    if (normalized.isNotEmpty && seen.add(normalized)) {
      result.add(normalized);
    }
  }
  return result;
}
