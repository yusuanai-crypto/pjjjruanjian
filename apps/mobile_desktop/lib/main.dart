import 'dart:async';
import 'dart:ui';

import 'package:flutter/material.dart';

import 'app/app.dart';
import 'core/crash_reporting/crash_reporter.dart';
import 'core/file_security_policy.dart';

void main() {
  runZonedGuarded<void>(
    () {
      WidgetsFlutterBinding.ensureInitialized();
      unawaited(CrashReporting.initialize());
      unawaited(FileSecurityPolicy.cleanupOrphanedTemporaryFiles());
      FlutterError.onError = (details) {
        FlutterError.presentError(details);
        unawaited(CrashReporting.recordFlutterError(details));
      };
      PlatformDispatcher.instance.onError = (error, stackTrace) {
        unawaited(
          CrashReporting.recordError(
            error,
            stackTrace,
            fatal: true,
            source: 'platform_dispatcher',
          ),
        );
        return true;
      };
      CrashReporting.breadcrumb('app.start');
      runApp(const JiangjiuApp());
    },
    (error, stackTrace) {
      unawaited(
        CrashReporting.recordError(
          error,
          stackTrace,
          fatal: true,
          source: 'zone',
        ),
      );
    },
  );
}
