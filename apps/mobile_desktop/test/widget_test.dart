import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/storage/session_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:jiangjiu_mobile_desktop/app/app.dart';

import 'fake_secure_token_storage.dart';

void main() {
  testWidgets('shows login page after bootstrap when no token is saved',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    final preferences = await SharedPreferences.getInstance();
    final storage = await SessionStorage.create(
      preferences: preferences,
      secureStorage: FakeSecureTokenStorage(),
    );

    await tester.pumpWidget(
      JiangjiuApp(
        sessionStorageFactory: () async => storage,
      ),
    );
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    await tester.pumpAndSettle();
    expect(find.text('员工登录'), findsOneWidget);
    expect(find.text('服务器地址'), findsNothing);
    expect(find.byType(TextField), findsNWidgets(2));
    expect(_textFieldValue(tester, '账号'), 'admin');
    expect(_textFieldValue(tester, '密码'), isEmpty);
  });

  testWidgets('fills the last successful username without filling a password',
      (tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      SessionStorage.lastUsernameKey: 'remembered.user',
    });
    final preferences = await SharedPreferences.getInstance();
    final storage = await SessionStorage.create(
      preferences: preferences,
      secureStorage: FakeSecureTokenStorage(),
    );

    await tester.pumpWidget(
      JiangjiuApp(
        sessionStorageFactory: () async => storage,
      ),
    );
    await tester.pumpAndSettle();

    expect(_textFieldValue(tester, '账号'), 'remembered.user');
    expect(_textFieldValue(tester, '密码'), isEmpty);
  });

  testWidgets('discards a legacy saved API address during bootstrap',
      (tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'jiangjiu.config.apiBaseUrl': 'http://47.120.24.23',
    });
    final preferences = await SharedPreferences.getInstance();
    final storage = await SessionStorage.create(
      preferences: preferences,
      secureStorage: FakeSecureTokenStorage(),
    );

    await tester.pumpWidget(
      JiangjiuApp(
        sessionStorageFactory: () async => storage,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('员工登录'), findsOneWidget);
    expect(preferences.containsKey('jiangjiu.config.apiBaseUrl'), isFalse);
    expect(find.text('服务器地址'), findsNothing);
    expect(find.byType(TextField), findsNWidgets(2));
    expect(_textFieldValue(tester, '账号'), 'admin');
  });

  testWidgets('shows a bootstrap error page and retries successfully',
      (tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final preferences = await SharedPreferences.getInstance();
    final storage = await SessionStorage.create(
      preferences: preferences,
      secureStorage: FakeSecureTokenStorage(),
    );
    var attempts = 0;

    await tester.pumpWidget(
      JiangjiuApp(
        sessionStorageFactory: () async {
          attempts += 1;
          if (attempts == 1) {
            throw StateError('Simulated bootstrap failure.');
          }
          return storage;
        },
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('bootstrap-error-page')), findsOneWidget);
    expect(find.text('启动失败'), findsOneWidget);
    expect(find.textContaining('客户端启动失败'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('bootstrap-retry-button')));
    await tester.pumpAndSettle();

    expect(attempts, 2);
    expect(find.text('员工登录'), findsOneWidget);
  });

  testWidgets('replaces an endless bootstrap spinner with a timeout error',
      (tester) async {
    final pendingStorage = Completer<SessionStorage>();

    await tester.pumpWidget(
      JiangjiuApp(
        sessionStorageFactory: () => pendingStorage.future,
        bootstrapTimeout: const Duration(seconds: 1),
      ),
    );
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    await tester.pump(const Duration(seconds: 1));
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.byKey(const ValueKey('bootstrap-error-page')), findsOneWidget);
    expect(find.textContaining('启动超时'), findsOneWidget);
  });
}

String _textFieldValue(WidgetTester tester, String label) {
  final finder = find.byWidgetPredicate(
    (widget) => widget is TextField && widget.decoration?.labelText == label,
  );
  return tester.widget<TextField>(finder).controller?.text ?? '';
}
