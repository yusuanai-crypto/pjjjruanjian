import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/business/business_api.dart';
import 'package:jiangjiu_mobile_desktop/shared/widgets/payment_details_editor.dart';

void main() {
  test('payment detail money parser keeps exact signed integer cents', () {
    expect(moneyCentsOrNull('500'), 50000);
    expect(moneyCentsOrNull('0'), 0);
    expect(moneyCentsOrNull('-12.34'), -1234);
    expect(moneyCentsOrNull('1.2'), 120);
    expect(moneyCentsOrNull('1.234'), isNull);
    expect(moneyCentsOrNull('not-money'), isNull);
    expect(moneyCentsOrNull('21474836.48'), isNull);
    expect(moneyCentsOrNull(''), isNull);
  });

  test('payment detail money formatter preserves signed cents', () {
    expect(moneyInputText(50000), '500');
    expect(moneyInputText(0), '0');
    expect(moneyInputText(-1234), '-12.34');
  });

  testWidgets('compact editor shows method amount and ordering actions',
      (tester) async {
    tester.view.physicalSize = const Size(420, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final details = [
      PaymentDetailDraft(
        paymentMethodId: 'method-1',
        amountCents: 12000,
      ),
      PaymentDetailDraft(
        paymentMethodId: 'method-1',
        amountCents: -2000,
      ),
    ];
    addTearDown(() {
      for (final detail in details) {
        detail.dispose();
      }
    });
    int? movedFrom;
    int? movedTo;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PaymentDetailsEditor(
            methods: const [
              PaymentMethodRecord(
                id: 'method-1',
                code: 'shouqianba',
                name: '收钱吧',
                isDefault: true,
              ),
            ],
            details: details,
            totalAmountCents: 10000,
            onAdd: () {},
            onRemove: (_) {},
            onMove: (fromIndex, toIndex) {
              movedFrom = fromIndex;
              movedTo = toIndex;
            },
            onChanged: () {},
          ),
        ),
      ),
    );

    expect(find.text('收款 1'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('payment-detail-method-0')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('payment-detail-amount-0')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('payment-detail-remove-0')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('payment-detail-up-0')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('payment-detail-down-0')),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);

    await tester.tap(
      find.byKey(const ValueKey('payment-detail-down-0')),
    );
    expect(movedFrom, 0);
    expect(movedTo, 1);
  });
}
