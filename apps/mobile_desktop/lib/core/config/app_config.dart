class AppConfig {
  const AppConfig._();

  static const defaultApiBaseUrl = String.fromEnvironment(
    'JIANGJIU_API_BASE_URL',
    defaultValue: 'http://127.0.0.1:3000',
  );

  static String normalizeApiBaseUrl(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) {
      return defaultApiBaseUrl;
    }
    final withScheme = trimmed.contains('://') ? trimmed : 'http://$trimmed';
    return withScheme.endsWith('/') ? withScheme.substring(0, withScheme.length - 1) : withScheme;
  }
}
