import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/sensitive_screen_protection_service.dart';
import 'package:jiangjiu_mobile_desktop/shared/widgets/sensitive_screen_guard.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('sensitive destination policy covers required data surfaces', () {
    expect(
      sensitiveDestinationIds,
      containsAll(<String>[
        'employee_accounts',
        'role_menu',
        'finance_query',
        'travel_group_finance_supplement',
        'guide_points_table',
        'taster_commissions',
        'commission_rules',
        'product_management',
        'profit_analysis',
        'analytics',
        'reconciliation_table',
        'payment_method_management',
        'travel_agency_management',
        'moutai_inventory',
        'warehouse_management',
        'order_form',
        'order_query',
        'after_sales_form',
        'qr_sales_sheet',
        'travel_group_query',
        'special_orders',
      ]),
    );
    expect(isSensitiveDestination('dashboard'), isFalse);
  });

  test('reference counting clears protection only after the final release',
      () async {
    final platform = _FakeSensitiveScreenPlatform();
    final service = SensitiveScreenProtectionService(platform: platform);

    final first = service.acquire();
    final second = service.acquire();
    await service.whenIdle;

    expect(service.activeGuardCount, 2);
    expect(platform.enableCalls, 1);
    expect(platform.disableCalls, 0);

    first.release();
    await service.whenIdle;
    expect(service.activeGuardCount, 1);
    expect(platform.disableCalls, 0);

    second.release();
    second.release();
    await service.whenIdle;
    expect(service.activeGuardCount, 0);
    expect(platform.disableCalls, 1);
  });

  test('non-Android platform bridge is a safe no-op', () async {
    const platform = MethodChannelSensitiveScreenProtectionPlatform(
      platform: TargetPlatform.windows,
    );

    await expectLater(platform.enableSecureScreen(), completes);
    await expectLater(platform.disableSecureScreen(), completes);
  });

  testWidgets(
      'guard preserves protection across sensitive replacements and nesting',
      (tester) async {
    final platform = _FakeSensitiveScreenPlatform();
    final service = SensitiveScreenProtectionService(platform: platform);

    await tester.pumpWidget(
      MaterialApp(
        home: SensitiveScreenGuard(
          service: service,
          child: SensitiveScreenGuard(
            service: service,
            child: const Text('first sensitive page'),
          ),
        ),
      ),
    );
    await service.whenIdle;
    expect(service.activeGuardCount, 2);
    expect(platform.enableCalls, 1);

    await tester.pumpWidget(
      MaterialApp(
        home: SensitiveScreenGuard(
          service: service,
          child: const Text('second sensitive page'),
        ),
      ),
    );
    await service.whenIdle;
    expect(service.activeGuardCount, 1);
    expect(platform.enableCalls, 1);
    expect(platform.disableCalls, 0);

    await tester.pumpWidget(
      const MaterialApp(home: Text('ordinary page')),
    );
    await service.whenIdle;
    expect(service.activeGuardCount, 0);
    expect(platform.disableCalls, 1);
  });

  testWidgets('guard reasserts protection when the app resumes',
      (tester) async {
    final platform = _FakeSensitiveScreenPlatform();
    final service = SensitiveScreenProtectionService(platform: platform);

    await tester.pumpWidget(
      MaterialApp(
        home: SensitiveScreenGuard(
          service: service,
          child: const Text('sensitive page'),
        ),
      ),
    );
    await service.whenIdle;
    expect(platform.enableCalls, 1);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await service.whenIdle;
    expect(platform.disableCalls, 0);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await service.whenIdle;
    expect(platform.enableCalls, 2);

    await tester.pumpWidget(const MaterialApp(home: Text('ordinary page')));
    await service.whenIdle;
    expect(platform.disableCalls, 1);
  });

  test('native platform contracts contain no sensitive call arguments',
      () async {
    final androidSource = await File(
      'android/app/src/main/kotlin/com/gzjiangjiuguan/employee/MainActivity.kt',
    ).readAsString();
    expect(androidSource, contains('com.jiangjiu/sensitive_screen'));
    expect(androidSource, contains('"enableSecureScreen"'));
    expect(androidSource, contains('"disableSecureScreen"'));
    expect(
      androidSource,
      contains('window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)'),
    );
    expect(
      androidSource,
      contains('window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)'),
    );

    final shellSource =
        await File('lib/features/shell/app_shell.dart').readAsString();
    expect(shellSource, contains('SensitiveScreenGuard(child: page)'));

    final iosSource =
        await File('ios/Runner/SceneDelegate.swift').readAsString();
    expect(iosSource, contains('showPrivacyOverlay(in: scene)'));
    expect(iosSource, contains('removePrivacyOverlay()'));
    expect(iosSource, contains('privacy-task-snapshot-overlay'));
  });
}

class _FakeSensitiveScreenPlatform
    implements SensitiveScreenProtectionPlatform {
  int enableCalls = 0;
  int disableCalls = 0;

  @override
  Future<void> enableSecureScreen() async {
    enableCalls += 1;
  }

  @override
  Future<void> disableSecureScreen() async {
    disableCalls += 1;
  }
}
