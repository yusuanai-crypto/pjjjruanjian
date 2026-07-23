import 'package:jiangjiu_shared/jiangjiu_shared.dart';

class AuthUser {
  const AuthUser({
    required this.id,
    required this.name,
    required this.username,
    required this.role,
    required this.isActive,
    required this.mustChangePassword,
    required this.createdAt,
    required this.updatedAt,
    this.phone,
    this.leaderId,
    this.statusReason,
    this.statusChangedAt,
    this.statusChangedBy,
  });

  final String id;
  final String name;
  final String username;
  final UserRole role;
  final bool isActive;
  final bool mustChangePassword;
  final String createdAt;
  final String updatedAt;
  final String? phone;
  final String? leaderId;
  final String? statusReason;
  final String? statusChangedAt;
  final String? statusChangedBy;

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      id: '${json['id'] ?? ''}',
      name: '${json['name'] ?? ''}',
      username: '${json['username'] ?? ''}',
      role: userRoleFromValue('${json['role'] ?? ''}'),
      isActive: json['isActive'] == true,
      mustChangePassword: json['mustChangePassword'] == true,
      phone: _nullableString(json['phone']),
      leaderId: _nullableString(json['leaderId']),
      statusReason: _nullableString(json['statusReason']),
      statusChangedAt: _nullableString(json['statusChangedAt']),
      statusChangedBy: _nullableString(json['statusChangedBy']),
      createdAt: '${json['createdAt'] ?? ''}',
      updatedAt: '${json['updatedAt'] ?? ''}',
    );
  }
}

class AuthMenu {
  const AuthMenu({
    required this.id,
    required this.title,
    required this.phase,
    this.dataScope,
  });

  final String id;
  final String title;
  final int phase;
  final String? dataScope;

  factory AuthMenu.fromJson(Map<String, dynamic> json) {
    return AuthMenu(
      id: '${json['id'] ?? ''}',
      title: '${json['title'] ?? json['label'] ?? ''}',
      phase: json['phase'] is int
          ? json['phase'] as int
          : int.tryParse('${json['phase'] ?? 1}') ?? 1,
      dataScope: _nullableString(json['dataScope']),
    );
  }
}

class AuthSession {
  const AuthSession({
    required this.user,
    required this.permissions,
    required this.menus,
    required this.dataScope,
    this.token,
    this.expiresAt,
  });

  final AuthUser user;
  final List<String> permissions;
  final List<AuthMenu> menus;
  final Map<String, dynamic> dataScope;
  final String? token;
  final String? expiresAt;

  factory AuthSession.fromJson(Map<String, dynamic> json) {
    final user = _asMap(json['user']);
    final menus = json['menus'];
    final permissions = json['permissions'];

    return AuthSession(
      token: _nullableString(json['token']),
      expiresAt: _nullableString(json['expiresAt']),
      user: AuthUser.fromJson(user),
      permissions: permissions is List
          ? permissions.map((item) => '$item').toList()
          : const <String>[],
      menus: menus is List
          ? menus
              .whereType<Map>()
              .map(_stringKeyMap)
              .map(AuthMenu.fromJson)
              .where((menu) => menu.id.isNotEmpty)
              .toList()
          : const <AuthMenu>[],
      dataScope: _asMap(json['dataScope']),
    );
  }

  AuthSession withToken(String token) {
    return AuthSession(
      token: token,
      expiresAt: expiresAt,
      user: user,
      permissions: permissions,
      menus: menus,
      dataScope: dataScope,
    );
  }
}

UserRole userRoleFromValue(String value) {
  final normalizedValue = value.trim().toLowerCase();
  for (final role in UserRole.values) {
    if (role.value == normalizedValue) {
      return role;
    }
  }
  throw UnsupportedUserRoleException(value);
}

class UnsupportedUserRoleException implements Exception {
  const UnsupportedUserRoleException(this.value);

  final String value;

  String get displayValue {
    final sanitized = value
        .replaceAll(RegExp(r'[\u0000-\u001f\u007f]'), ' ')
        .trim();
    if (sanitized.isEmpty) {
      return '空值';
    }
    return sanitized.length <= 32
        ? sanitized
        : '${sanitized.substring(0, 32)}…';
  }

  @override
  String toString() => 'Unsupported user role: $displayValue';
}

Map<String, dynamic> _asMap(Object? value) {
  return value is Map ? _stringKeyMap(value) : <String, dynamic>{};
}

Map<String, dynamic> _stringKeyMap(Map value) {
  return value.map((key, mapValue) => MapEntry('$key', mapValue));
}

String? _nullableString(Object? value) {
  if (value == null) {
    return null;
  }
  final text = '$value'.trim();
  return text.isEmpty ? null : text;
}
