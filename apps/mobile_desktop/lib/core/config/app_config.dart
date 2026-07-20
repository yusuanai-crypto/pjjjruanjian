import 'dart:io';

import 'package:flutter/foundation.dart';

class AppConfig {
  const AppConfig._();

  static const _configuredApiBaseUrl = String.fromEnvironment(
    'JIANGJIU_API_BASE_URL',
    defaultValue: 'https://127.0.0.1:3000',
  );

  static String get defaultApiBaseUrl =>
      normalizeApiBaseUrl(_configuredApiBaseUrl);

  static String normalizeApiBaseUrl(String value) {
    return _normalizeApiBaseUrl(
      value.trim().isEmpty ? _configuredApiBaseUrl : value,
      allowInsecureLoopback: kDebugMode,
    );
  }

  @visibleForTesting
  static String normalizeApiBaseUrlForPolicy(
    String value, {
    required bool debugOrTest,
  }) {
    return _normalizeApiBaseUrl(
      value.trim().isEmpty ? _configuredApiBaseUrl : value,
      allowInsecureLoopback: debugOrTest,
    );
  }

  static String _normalizeApiBaseUrl(
    String value, {
    required bool allowInsecureLoopback,
  }) {
    final trimmed = value.trim();
    if (trimmed.isEmpty ||
        trimmed.contains(RegExp(r'[\u0000-\u0020\u007f]')) ||
        trimmed.contains(r'\')) {
      throw const FormatException('The API address is invalid.');
    }

    final candidate = trimmed.contains('://') ? trimmed : 'https://$trimmed';
    final uri = Uri.tryParse(candidate);
    if (uri == null ||
        !uri.hasAuthority ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        (uri.scheme != 'http' && uri.scheme != 'https') ||
        uri.hasQuery ||
        uri.hasFragment) {
      throw const FormatException('The API address is invalid.');
    }

    _validateAuthorityAndPort(candidate, uri);
    if (uri.scheme == 'http' &&
        (!allowInsecureLoopback || !_isLoopbackHost(uri.host))) {
      throw const FormatException(
        'Plain HTTP is allowed only for loopback addresses in debug or test.',
      );
    }

    final normalizedPath =
        uri.path == '/' ? '' : uri.path.replaceFirst(RegExp(r'/+$'), '');
    return uri.replace(path: normalizedPath).toString();
  }

  static void _validateAuthorityAndPort(String candidate, Uri uri) {
    final authorityStart = candidate.indexOf('://') + 3;
    final authorityEnd = candidate.indexOf(
      RegExp(r'[/#?]'),
      authorityStart,
    );
    final authority = candidate.substring(
      authorityStart,
      authorityEnd < 0 ? candidate.length : authorityEnd,
    );
    if (authority.isEmpty || authority.contains('@')) {
      throw const FormatException('The API address is invalid.');
    }

    String portText = '';
    if (authority.startsWith('[')) {
      final closingBracket = authority.indexOf(']');
      if (closingBracket <= 1) {
        throw const FormatException('The API address is invalid.');
      }
      final remainder = authority.substring(closingBracket + 1);
      if (remainder.isNotEmpty) {
        if (!remainder.startsWith(':')) {
          throw const FormatException('The API address is invalid.');
        }
        portText = remainder.substring(1);
      }
    } else {
      final firstColon = authority.indexOf(':');
      if (firstColon >= 0) {
        if (firstColon != authority.lastIndexOf(':')) {
          throw const FormatException(
            'IPv6 API addresses must use square brackets.',
          );
        }
        portText = authority.substring(firstColon + 1);
      }
    }

    if (authority.endsWith(':') ||
        (portText.isNotEmpty && !RegExp(r'^[0-9]+$').hasMatch(portText))) {
      throw const FormatException('The API port is invalid.');
    }
    if (portText.isNotEmpty) {
      final port = int.tryParse(portText);
      if (port == null || port < 1 || port > 65535 || uri.port != port) {
        throw const FormatException('The API port is invalid.');
      }
    }
  }

  static bool _isLoopbackHost(String host) {
    if (host.toLowerCase() == 'localhost') {
      return true;
    }
    return InternetAddress.tryParse(host)?.isLoopback ?? false;
  }
}
