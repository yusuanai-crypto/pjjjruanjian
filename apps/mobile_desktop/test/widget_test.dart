import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:jiangjiu_mobile_desktop/app/app.dart';

void main() {
  testWidgets('shows login page after bootstrap when no token is saved', (tester) async {
    SharedPreferences.setMockInitialValues({});

    await tester.pumpWidget(const JiangjiuApp());
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    await tester.pumpAndSettle();
    expect(find.text('员工登录'), findsOneWidget);
  });
}
