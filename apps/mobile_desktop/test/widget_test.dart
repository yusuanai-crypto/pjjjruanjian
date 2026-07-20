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
  });
}
