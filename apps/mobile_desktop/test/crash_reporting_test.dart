import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/crash_reporting/crash_reporter.dart';

void main() {
  tearDown(() async {
    await CrashReporting.resetForTesting();
  });

  test('crash reporting sanitizes sensitive data before adapter receives it',
      () async {
    final reporter = _RecordingCrashReporter();
    await CrashReporting.initialize(
      reporter: reporter,
      appVersion: '9.8.7+6',
    );

    CrashReporting.setCurrentPage('profile/13800138000');
    CrashReporting.setUserAction('save token=super-secret');
    CrashReporting.breadcrumb(
      'request Bearer abc.def.ghi',
      data: {
        'password': 'plain-password',
        'token': 'plain-token',
        'mobile': '13800138000',
        'safeCount': 5,
      },
    );
    await CrashReporting.recordError(
      StateError(
        'password=hunter2 token=abcdefgh phone=13800138000',
      ),
      StackTrace.fromString('Bearer abcdefghijklmnop'),
      source: 'test.token=source-secret',
      context: {
        'authorization': 'Bearer should-not-leak',
        'nested': {'credential': 'private-value'},
        'attachmentSizeBytes': 1234,
      },
    );

    expect(reporter.initializedVersion, '9.8.7+6');
    expect(reporter.currentPage, isNot(contains('13800138000')));
    expect(reporter.userAction, isNot(contains('super-secret')));
    expect(reporter.breadcrumbs, hasLength(1));
    expect(
      reporter.breadcrumbs.single.event,
      isNot(contains('abc.def.ghi')),
    );
    final breadcrumbJson = reporter.breadcrumbs.single.toJson().toString();
    expect(breadcrumbJson, isNot(contains('plain-password')));
    expect(breadcrumbJson, isNot(contains('plain-token')));
    expect(breadcrumbJson, isNot(contains('13800138000')));
    expect(breadcrumbJson, contains('[REDACTED]'));

    final recorded = reporter.errors.single;
    expect(recorded.error, isA<SanitizedCrashError>());
    expect(
      (recorded.error as SanitizedCrashError).exceptionType,
      'StateError',
    );
    final serialized = [
      recorded.error,
      recorded.stackTrace,
      recorded.source,
      recorded.context,
    ].join(' ');
    expect(serialized, isNot(contains('hunter2')));
    expect(serialized, isNot(contains('abcdefgh')));
    expect(serialized, isNot(contains('13800138000')));
    expect(serialized, isNot(contains('should-not-leak')));
    expect(serialized, isNot(contains('private-value')));
    expect(recorded.context['attachmentSizeBytes'], 1234);
  });

  test('sanitizer preserves diagnostic dimensions and app-safe values', () {
    final sanitized = sanitizeCrashData({
      'imageWidth': 8000,
      'imageHeight': 6000,
      'attachmentSizeBytes': 10 * 1024 * 1024,
      'password': 'secret',
      'metadata': {
        'phoneNumber': '13800138000',
        'page': 'guide_points',
      },
    }) as Map<String, Object?>;

    expect(sanitized['imageWidth'], 8000);
    expect(sanitized['imageHeight'], 6000);
    expect(sanitized['attachmentSizeBytes'], 10 * 1024 * 1024);
    expect(sanitized['password'], '[REDACTED]');
    expect(
      sanitized['metadata'],
      {
        'phoneNumber': '[REDACTED]',
        'page': 'guide_points',
      },
    );
  });
}

class _RecordedCrashError {
  const _RecordedCrashError({
    required this.error,
    required this.stackTrace,
    required this.fatal,
    required this.source,
    required this.context,
  });

  final Object error;
  final StackTrace stackTrace;
  final bool fatal;
  final String source;
  final Map<String, Object?> context;
}

class _RecordingCrashReporter implements CrashReporter {
  String? initializedVersion;
  String currentPage = '';
  String userAction = '';
  final List<CrashBreadcrumb> breadcrumbs = [];
  final List<_RecordedCrashError> errors = [];

  @override
  Future<void> initialize({required String appVersion}) async {
    initializedVersion = appVersion;
  }

  @override
  void setContext({
    required String currentPage,
    required String userAction,
  }) {
    this.currentPage = currentPage;
    this.userAction = userAction;
  }

  @override
  void addBreadcrumb(CrashBreadcrumb breadcrumb) {
    breadcrumbs.add(breadcrumb);
  }

  @override
  Future<void> recordError(
    Object error,
    StackTrace stackTrace, {
    required bool fatal,
    required String source,
    Map<String, Object?> context = const <String, Object?>{},
  }) async {
    errors.add(
      _RecordedCrashError(
        error: error,
        stackTrace: stackTrace,
        fatal: fatal,
        source: source,
        context: context,
      ),
    );
  }
}
