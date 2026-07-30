import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';

const jiangjiuAppVersion = String.fromEnvironment(
  'APP_VERSION',
  defaultValue: '0.2.0+2',
);

class CrashBreadcrumb {
  CrashBreadcrumb({
    required this.event,
    this.data = const <String, Object?>{},
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now().toUtc();

  final String event;
  final Map<String, Object?> data;
  final DateTime timestamp;

  Map<String, Object?> toJson() => {
        'event': sanitizeCrashText(event),
        'timestamp': timestamp.toIso8601String(),
        'data': sanitizeCrashData(data),
      };
}

abstract interface class CrashReporter {
  Future<void> initialize({required String appVersion});

  void setContext({
    required String currentPage,
    required String userAction,
  });

  void addBreadcrumb(CrashBreadcrumb breadcrumb);

  Future<void> recordError(
    Object error,
    StackTrace stackTrace, {
    required bool fatal,
    required String source,
    Map<String, Object?> context = const <String, Object?>{},
  });
}

class SanitizedCrashError implements Exception {
  const SanitizedCrashError({
    required this.exceptionType,
    required this.message,
  });

  final String exceptionType;
  final String message;

  @override
  String toString() => message;
}

class DeveloperCrashReporter implements CrashReporter {
  String _appVersion = jiangjiuAppVersion;
  String _currentPage = 'startup';
  String _userAction = 'app_start';
  final List<CrashBreadcrumb> _breadcrumbs = <CrashBreadcrumb>[];

  @override
  Future<void> initialize({required String appVersion}) async {
    _appVersion = appVersion;
  }

  @override
  void setContext({
    required String currentPage,
    required String userAction,
  }) {
    _currentPage = sanitizeCrashText(currentPage);
    _userAction = sanitizeCrashText(userAction);
  }

  @override
  void addBreadcrumb(CrashBreadcrumb breadcrumb) {
    _breadcrumbs.add(breadcrumb);
    if (_breadcrumbs.length > 50) {
      _breadcrumbs.removeRange(0, _breadcrumbs.length - 50);
    }
    developer.log(
      jsonEncode({
        'kind': 'breadcrumb',
        'appVersion': _appVersion,
        'currentPage': _currentPage,
        'userAction': _userAction,
        ...breadcrumb.toJson(),
      }),
      name: 'jiangjiu.crash',
    );
  }

  @override
  Future<void> recordError(
    Object error,
    StackTrace stackTrace, {
    required bool fatal,
    required String source,
    Map<String, Object?> context = const <String, Object?>{},
  }) async {
    final sanitizedError = sanitizeCrashText(error.toString());
    final sanitizedStack = sanitizeCrashText(stackTrace.toString());
    final payload = <String, Object?>{
      'kind': 'error',
      'fatal': fatal,
      'source': sanitizeCrashText(source),
      'exceptionType': error is SanitizedCrashError
          ? error.exceptionType
          : error.runtimeType.toString(),
      'error': sanitizedError,
      'stackTrace': sanitizedStack,
      'currentPage': _currentPage,
      'userAction': _userAction,
      'appVersion': _appVersion,
      'context': sanitizeCrashData(context),
      'breadcrumbs': _breadcrumbs.map((item) => item.toJson()).toList(),
    };
    developer.log(
      jsonEncode(payload),
      name: 'jiangjiu.crash',
      level: fatal ? 1200 : 1000,
      error: sanitizedError,
      stackTrace: StackTrace.fromString(sanitizedStack),
    );
  }
}

class CrashReporting {
  CrashReporting._();

  static final DeveloperCrashReporter _fallbackReporter =
      DeveloperCrashReporter();
  static CrashReporter _reporter = _fallbackReporter;
  static String _appVersion = jiangjiuAppVersion;
  static String _currentPage = 'startup';
  static String _userAction = 'app_start';

  static Future<void> initialize({
    CrashReporter? reporter,
    String appVersion = jiangjiuAppVersion,
  }) async {
    _appVersion = appVersion;
    _reporter = reporter ?? _fallbackReporter;
    try {
      await _reporter.initialize(appVersion: appVersion);
      _reporter.setContext(
        currentPage: _currentPage,
        userAction: _userAction,
      );
    } catch (error, stackTrace) {
      _reporter = _fallbackReporter;
      await _fallbackReporter.initialize(appVersion: appVersion);
      _fallbackReporter.setContext(
        currentPage: _currentPage,
        userAction: _userAction,
      );
      await _fallbackReporter.recordError(
        error,
        stackTrace,
        fatal: false,
        source: 'crash_reporter.initialize',
      );
    }
  }

  static void setCurrentPage(String page) {
    _currentPage = sanitizeCrashText(page);
    _setReporterContext();
  }

  static void setUserAction(String action) {
    _userAction = sanitizeCrashText(action);
    _setReporterContext();
  }

  static void breadcrumb(
    String event, {
    Map<String, Object?> data = const <String, Object?>{},
  }) {
    final sanitizedData = sanitizeCrashData(data);
    final breadcrumb = CrashBreadcrumb(
      event: sanitizeCrashText(event),
      data: sanitizedData is Map<String, Object?>
          ? sanitizedData
          : const <String, Object?>{},
    );
    try {
      _reporter.addBreadcrumb(breadcrumb);
    } catch (error, stackTrace) {
      if (!identical(_reporter, _fallbackReporter)) {
        _fallbackReporter
          ..setContext(
            currentPage: _currentPage,
            userAction: _userAction,
          )
          ..addBreadcrumb(breadcrumb);
        unawaited(
          _fallbackReporter.recordError(
            error,
            stackTrace,
            fatal: false,
            source: 'crash_reporter.breadcrumb',
          ),
        );
      }
    }
  }

  static Future<void> recordError(
    Object error,
    StackTrace stackTrace, {
    bool fatal = false,
    String source = 'application',
    Map<String, Object?> context = const <String, Object?>{},
  }) async {
    final sanitizedContext = sanitizeCrashData(context);
    final sanitizedError = SanitizedCrashError(
      exceptionType: sanitizeCrashText(error.runtimeType.toString()),
      message: sanitizeCrashText(error.toString()),
    );
    final sanitizedStackTrace = StackTrace.fromString(
      sanitizeCrashText(stackTrace.toString()),
    );
    try {
      await _reporter.recordError(
        sanitizedError,
        sanitizedStackTrace,
        fatal: fatal,
        source: sanitizeCrashText(source),
        context: sanitizedContext is Map<String, Object?>
            ? sanitizedContext
            : const <String, Object?>{},
      );
    } catch (reportingError, reportingStackTrace) {
      if (!identical(_reporter, _fallbackReporter)) {
        await _fallbackReporter.initialize(appVersion: _appVersion);
        _fallbackReporter.setContext(
          currentPage: _currentPage,
          userAction: _userAction,
        );
        await _fallbackReporter.recordError(
          reportingError,
          reportingStackTrace,
          fatal: false,
          source: 'crash_reporter.record',
        );
        await _fallbackReporter.recordError(
          sanitizedError,
          sanitizedStackTrace,
          fatal: fatal,
          source: sanitizeCrashText(source),
          context: sanitizedContext is Map<String, Object?>
              ? sanitizedContext
              : const <String, Object?>{},
        );
      }
    }
  }

  static Future<void> recordFlutterError(FlutterErrorDetails details) {
    return recordError(
      details.exception,
      details.stack ?? StackTrace.current,
      fatal: false,
      source: 'flutter.framework',
      context: {
        if (details.library != null) 'library': details.library,
        if (details.context != null)
          'diagnosticsContext': details.context.toString(),
      },
    );
  }

  @visibleForTesting
  static Future<void> resetForTesting() async {
    _reporter = _fallbackReporter;
    _appVersion = jiangjiuAppVersion;
    _currentPage = 'startup';
    _userAction = 'app_start';
    await _fallbackReporter.initialize(appVersion: _appVersion);
    _setReporterContext();
  }

  static void _setReporterContext() {
    try {
      _reporter.setContext(
        currentPage: _currentPage,
        userAction: _userAction,
      );
    } catch (_) {
      // Crash reporting must never introduce an application failure.
    }
  }
}

Object? sanitizeCrashData(Object? value, {String? key, int depth = 0}) {
  if (key != null && _sensitiveKeyPattern.hasMatch(key)) {
    return '[REDACTED]';
  }
  if (depth > 6) {
    return '[TRUNCATED]';
  }
  if (value == null || value is num || value is bool) {
    return value;
  }
  if (value is String) {
    return sanitizeCrashText(value);
  }
  if (value is DateTime) {
    return value.toUtc().toIso8601String();
  }
  if (value is Map) {
    return <String, Object?>{
      for (final entry in value.entries)
        '${entry.key}': sanitizeCrashData(
          entry.value,
          key: '${entry.key}',
          depth: depth + 1,
        ),
    };
  }
  if (value is Iterable) {
    return value
        .take(100)
        .map((item) => sanitizeCrashData(item, depth: depth + 1))
        .toList();
  }
  return sanitizeCrashText(value.toString());
}

String sanitizeCrashText(String value) {
  var sanitized = value;
  sanitized = sanitized.replaceAll(
    RegExp(r'\b1[3-9]\d{9}\b'),
    '[REDACTED_PHONE]',
  );
  sanitized = sanitized.replaceAll(
    RegExp(r'Bearer\s+[A-Za-z0-9._~+/=-]+', caseSensitive: false),
    'Bearer [REDACTED]',
  );
  sanitized = sanitized.replaceAll(
    RegExp(
      r'\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b',
    ),
    '[REDACTED_JWT]',
  );
  sanitized = sanitized.replaceAll(
    RegExp(
      r'((?:password|passwd|token|authorization|secret|cookie)\s*[:=]\s*)'
      r'[^,\s;&]+',
      caseSensitive: false,
    ),
    r'$1[REDACTED]',
  );
  return sanitized.length <= 16000
      ? sanitized
      : '${sanitized.substring(0, 16000)}[TRUNCATED]';
}

final _sensitiveKeyPattern = RegExp(
  r'password|passwd|token|authorization|cookie|secret|credential|phone|mobile',
  caseSensitive: false,
);
