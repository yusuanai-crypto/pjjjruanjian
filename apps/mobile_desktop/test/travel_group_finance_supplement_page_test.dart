import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_group_finance/travel_group_finance_supplement_page.dart';

void main() {
  setUp(() {
    TestWidgetsFlutterBinding.ensureInitialized();
  });

  testWidgets('applies every finance table filter to the visible rows',
      (tester) async {
    await _pumpPage(tester);

    expect(_returnedAmountFilterFields(), findsNothing);
    expect(find.byKey(const ValueKey('finance-filter-date')), findsOneWidget);
    expect(find.byKey(const ValueKey('finance-filter-taster')), findsOneWidget);
    expect(
      find.byKey(const ValueKey('finance-filter-unreturned-points')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('finance-filter-guide-info-sent')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('finance-filter-agency-info-sent')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('finance-filter-status')), findsOneWidget);

    await tester.enterText(
      find.byKey(const ValueKey('finance-filter-agency')),
      '山水',
    );
    await tester.pump();
    _expectRows(visible: ['GZ-0622-016']);

    await _clearFilters(tester);
    await tester.enterText(
      find.byKey(const ValueKey('finance-filter-guide')),
      '赵',
    );
    await tester.pump();
    _expectRows(visible: ['GZ-0622-011']);

    await _clearFilters(tester);
    await _selectDropdown(tester, 'finance-filter-taster', '陈品鉴');
    _expectRows(visible: ['GZ-0622-018']);

    await _clearFilters(tester);
    await tester.ensureVisible(
      find.byKey(const ValueKey('finance-filter-date')),
    );
    await tester.tap(find.byKey(const ValueKey('finance-filter-date')));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, '确定'));
    await tester.pumpAndSettle();
    _expectRows(visible: ['GZ-0622-018', 'GZ-0622-016']);
  });

  testWidgets('filters zero, send flags and existing statuses correctly',
      (tester) async {
    await _pumpPage(tester);

    final unreturnedPoints =
        find.byKey(const ValueKey('finance-filter-unreturned-points'));
    await tester.enterText(unreturnedPoints, '-1');
    await tester.pump();
    expect(tester.widget<TextField>(unreturnedPoints).controller!.text, '');
    _expectRows(
      visible: ['GZ-0622-018', 'GZ-0622-016', 'GZ-0622-011'],
    );

    await tester.enterText(unreturnedPoints, '0');
    await tester.pump();
    _expectRows(visible: ['GZ-0622-011']);
    expect(find.text('当前显示 1/3 行'), findsOneWidget);
    expect(find.text('待补充 0 行'), findsOneWidget);
    expect(find.text('¥0.00'), findsNWidgets(2));

    await _clearFilters(tester);
    await _selectDropdown(
      tester,
      'finance-filter-guide-info-sent',
      '未发送',
    );
    _expectRows(visible: ['GZ-0622-016']);

    await _clearFilters(tester);
    await _selectDropdown(
      tester,
      'finance-filter-agency-info-sent',
      '未发送',
    );
    _expectRows(visible: ['GZ-0622-018', 'GZ-0622-016']);

    await _clearFilters(tester);
    await _selectDropdown(tester, 'finance-filter-status', '待复核');
    _expectRows(visible: ['GZ-0622-016']);
  });

  testWidgets('combines filters with AND and clear restores rows and totals',
      (tester) async {
    await _pumpPage(tester);

    await tester.enterText(
      find.byKey(const ValueKey('finance-filter-agency')),
      '黔',
    );
    await tester.enterText(
      find.byKey(const ValueKey('finance-filter-guide')),
      '李',
    );
    await tester.enterText(
      find.byKey(const ValueKey('finance-filter-unreturned-points')),
      '340',
    );
    await _selectDropdown(tester, 'finance-filter-taster', '陈品鉴');
    await _selectDropdown(tester, 'finance-filter-guide-info-sent', '已发送');
    await _selectDropdown(
      tester,
      'finance-filter-agency-info-sent',
      '未发送',
    );
    await _selectDropdown(tester, 'finance-filter-status', '待补充');

    _expectRows(visible: ['GZ-0622-018']);
    expect(find.text('当前显示 1/3 行'), findsOneWidget);
    expect(find.text('待补充 1 行'), findsOneWidget);
    expect(find.text('¥6478.00'), findsOneWidget);
    expect(find.text('¥300.00'), findsOneWidget);

    await _clearFilters(tester);
    _expectRows(
      visible: ['GZ-0622-018', 'GZ-0622-016', 'GZ-0622-011'],
    );
    expect(find.text('当前显示 3/3 行'), findsOneWidget);
    expect(find.text('待补充 1 行'), findsOneWidget);
    expect(find.text('¥10358.00'), findsOneWidget);
    expect(find.text('¥300.00'), findsOneWidget);
  });

  testWidgets('uses one controller for smooth horizontal desktop scrolling',
      (tester) async {
    await _pumpPage(tester);

    final scrollbar = tester.widget<Scrollbar>(
      find.byKey(const ValueKey('finance-table-scrollbar')),
    );
    final scrollView = tester.widget<SingleChildScrollView>(
      find.byKey(const ValueKey('finance-table-horizontal-scroll-view')),
    );
    expect(scrollbar.controller, same(scrollView.controller));
    expect(scrollbar.thumbVisibility, isTrue);
    final controller = scrollView.controller!;
    expect(controller.position.maxScrollExtent, greaterThan(0));
    final wideViewportExtent = controller.position.maxScrollExtent;

    final tablePosition = tester.getCenter(
      find.byKey(const ValueKey('finance-table-horizontal-scroll-view')),
    );
    GestureBinding.instance.handlePointerEvent(
      PointerScrollEvent(
        position: tablePosition,
        kind: PointerDeviceKind.trackpad,
        scrollDelta: const Offset(180, 0),
      ),
    );
    await tester.pump();
    expect(controller.offset, greaterThan(0));

    controller.jumpTo(0);
    await tester.pump();
    await simulateKeyDownEvent(LogicalKeyboardKey.shiftLeft);
    GestureBinding.instance.handlePointerEvent(
      PointerScrollEvent(
        position: tablePosition,
        kind: PointerDeviceKind.mouse,
        scrollDelta: const Offset(0, 180),
      ),
    );
    await tester.pump();
    await simulateKeyUpEvent(LogicalKeyboardKey.shiftLeft);
    expect(controller.offset, greaterThan(0));

    controller.jumpTo(0);
    await tester.pump();
    final scrollbarFinder =
        find.byKey(const ValueKey('finance-table-scrollbar'));
    final dragStart =
        tester.getBottomLeft(scrollbarFinder) + const Offset(30, -5);
    await tester.dragFrom(dragStart, const Offset(260, 0));
    await tester.pumpAndSettle();
    expect(controller.offset, greaterThan(0));
    await tester.dragFrom(
      dragStart + const Offset(260, 0),
      const Offset(-180, 0),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    tester.view.physicalSize = const Size(1100, 900);
    await tester.pumpAndSettle();
    expect(
      controller.position.maxScrollExtent,
      greaterThan(wideViewportExtent),
    );
  });

  testWidgets('keeps row editors switches statuses and actions usable',
      (tester) async {
    await _pumpPage(tester);

    final orderAmount = find.byKey(const ValueKey('GZ-0622-018:orderAmount'));
    await tester.ensureVisible(orderAmount);
    await tester.enterText(orderAmount, '7000');
    await tester.pump();
    expect(find.text('¥10880.00'), findsOneWidget);

    final guideSent = find.byKey(const ValueKey('GZ-0622-018:guideInfoSent'));
    await tester.ensureVisible(guideSent);
    await tester.tap(guideSent);
    await tester.pump();
    expect(tester.widget<Switch>(guideSent).value, isFalse);

    await _selectDropdown(tester, 'GZ-0622-018:status', '已完成');
    expect(
      tester
          .widget<DropdownButton<String>>(
            find.byKey(const ValueKey('GZ-0622-018:status')),
          )
          .value,
      '已完成',
    );
    expect(find.widgetWithText(FilledButton, '保存积分表'), findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, '标记待复核'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

Finder _returnedAmountFilterFields() {
  return find.byWidgetPredicate(
    (widget) => widget is TextField && widget.decoration?.labelText == '已返金额',
  );
}

Finder _row(String groupNo) => find.byKey(ValueKey('$groupNo:groupNo'));

void _expectRows({required List<String> visible}) {
  const allRows = ['GZ-0622-018', 'GZ-0622-016', 'GZ-0622-011'];
  for (final groupNo in allRows) {
    expect(
      _row(groupNo),
      visible.contains(groupNo) ? findsOneWidget : findsNothing,
    );
  }
}

Future<void> _clearFilters(WidgetTester tester) async {
  final clear = find.byKey(const ValueKey('finance-filter-clear'));
  await tester.ensureVisible(clear);
  await tester.tap(clear);
  await tester.pumpAndSettle();
}

Future<void> _selectDropdown(
  WidgetTester tester,
  String key,
  String label,
) async {
  final dropdown = find.byKey(ValueKey(key));
  await tester.ensureVisible(dropdown);
  await tester.tap(dropdown);
  await tester.pumpAndSettle();
  await tester.tap(find.text(label).last);
  await tester.pumpAndSettle();
}

Future<void> _pumpPage(WidgetTester tester) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(1600, 1100);
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    const MaterialApp(
      locale: Locale('zh', 'CN'),
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      supportedLocales: [Locale('zh', 'CN')],
      home: Scaffold(body: TravelGroupFinanceSupplementPage()),
    ),
  );
  await tester.pumpAndSettle();
}
