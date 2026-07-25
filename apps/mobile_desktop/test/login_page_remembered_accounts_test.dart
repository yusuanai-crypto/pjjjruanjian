import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/features/login/login_page.dart';

void main() {
  testWidgets('saved account matching fills its password and remember choice',
      (tester) async {
    String? submittedUsername;
    String? submittedPassword;
    bool? submittedRememberPassword;

    await tester.pumpWidget(
      MaterialApp(
        home: LoginPage(
          initialUsername: 'first.user',
          rememberedUsernames: const <String>[
            'first.user',
            'second.user',
          ],
          onPasswordLookup: (username) async => <String, String>{
            'first.user': 'first-password',
            'second.user': 'second-password',
          }[username],
          onForgetAccount: (_) async {},
          onLogin: ({
            required username,
            required password,
            required rememberPassword,
          }) async {
            submittedUsername = username;
            submittedPassword = password;
            submittedRememberPassword = rememberPassword;
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(_fieldValue(tester, '密码') == 'first-password', isTrue);

    await tester.enterText(
      find.byKey(const ValueKey('login-username-field')),
      'second.user',
    );
    await tester.pumpAndSettle();
    expect(_fieldValue(tester, '密码') == 'second-password', isTrue);

    await tester.ensureVisible(find.text('进入系统'));
    await tester.tap(find.text('进入系统'));
    await tester.pumpAndSettle();
    expect(submittedUsername, 'second.user');
    expect(submittedPassword == 'second-password', isTrue);
    expect(submittedRememberPassword, isTrue);
  });

  testWidgets('forget account clears only the selected password from the form',
      (tester) async {
    final forgotten = <String>[];
    await tester.pumpWidget(
      MaterialApp(
        home: LoginPage(
          initialUsername: 'first.user',
          rememberedUsernames: const <String>[
            'first.user',
            'second.user',
          ],
          onPasswordLookup: (username) async => <String, String>{
            'first.user': 'first-password',
            'second.user': 'second-password',
          }[username],
          onForgetAccount: (username) async => forgotten.add(username),
          onLogin: ({
            required username,
            required password,
            required rememberPassword,
          }) async {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.ensureVisible(
      find.byKey(const ValueKey('forget-account-button')),
    );
    await tester.tap(find.byKey(const ValueKey('forget-account-button')));
    await tester.pumpAndSettle();

    expect(forgotten, <String>['first.user']);
    expect(_fieldValue(tester, '密码'), isEmpty);
    expect(find.byKey(const ValueKey('forget-account-button')), findsNothing);

    await tester.enterText(
      find.byKey(const ValueKey('login-username-field')),
      'second.user',
    );
    await tester.pumpAndSettle();
    expect(_fieldValue(tester, '密码') == 'second-password', isTrue);
  });
}

String _fieldValue(WidgetTester tester, String label) {
  final finder = find.byWidgetPredicate(
    (widget) => widget is TextField && widget.decoration?.labelText == label,
  );
  return tester.widget<TextField>(finder).controller?.text ?? '';
}
