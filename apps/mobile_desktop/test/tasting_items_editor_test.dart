import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_groups/tasting_items_editor.dart';

void main() {
  testWidgets('adds a tasting item and emits normalized items', (tester) async {
    var emitted = const <Map<String, dynamic>>[];

    await _pumpEditor(
      tester,
      TastingItemsEditor(
        onChanged: (items) => emitted = items,
      ),
    );

    expect(find.text('暂无品酒明细'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('tasting_items_add')));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const ValueKey('tasting_product_0')),
      '酱香珍藏',
    );
    await tester.enterText(
      find.byKey(const ValueKey('tasting_quantity_0')),
      '3',
    );
    await tester.enterText(
      find.byKey(const ValueKey('tasting_unit_0')),
      '瓶',
    );
    await tester.enterText(
      find.byKey(const ValueKey('tasting_note_0')),
      '醒酒后品鉴',
    );
    await tester.pumpAndSettle();

    expect(emitted, hasLength(1));
    expect(emitted.single, {
      'productName': '酱香珍藏',
      'quantity': 3,
      'unit': '瓶',
      'note': '醒酒后品鉴',
      'sortOrder': 1,
    });
  });

  testWidgets('deletes a tasting item and emits remaining rows',
      (tester) async {
    var emitted = const <Map<String, dynamic>>[];

    await _pumpEditor(
      tester,
      TastingItemsEditor(
        initialItems: const [
          TastingItemDraft(productName: '酒品 A', quantity: 1, unit: '瓶'),
          TastingItemDraft(productName: '酒品 B', quantity: 2, unit: '杯'),
        ],
        onChanged: (items) => emitted = items,
      ),
    );

    expect(find.text('酒品 A'), findsOneWidget);
    expect(find.text('酒品 B'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('tasting_delete_0')));
    await tester.pumpAndSettle();

    expect(find.text('酒品 A'), findsNothing);
    expect(find.text('酒品 B'), findsOneWidget);
    expect(emitted, [
      {
        'productName': '酒品 B',
        'quantity': 2,
        'unit': '杯',
        'note': null,
        'sortOrder': 1,
      },
    ]);
  });

  testWidgets('validates product name quantity and unit', (tester) async {
    final editorKey = GlobalKey<TastingItemsEditorState>();

    await _pumpEditor(
      tester,
      TastingItemsEditor(
        key: editorKey,
        onChanged: (_) {},
      ),
    );

    await tester.tap(find.byKey(const ValueKey('tasting_items_add')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('tasting_quantity_0')),
      '0',
    );
    await tester.pumpAndSettle();

    expect(editorKey.currentState!.validate(), isFalse);
    await tester.pumpAndSettle();

    expect(find.text('酒品不能为空'), findsOneWidget);
    expect(find.text('数量必须大于 0'), findsOneWidget);
    expect(find.text('单位不能为空'), findsOneWidget);

    await tester.enterText(
      find.byKey(const ValueKey('tasting_product_0')),
      '酱香珍藏',
    );
    await tester.enterText(
      find.byKey(const ValueKey('tasting_quantity_0')),
      '2',
    );
    await tester.enterText(
      find.byKey(const ValueKey('tasting_unit_0')),
      '瓶',
    );
    await tester.pumpAndSettle();

    expect(editorKey.currentState!.validate(), isTrue);
    expect(editorKey.currentState!.tastingItems.single['quantity'], 2);
  });
}

Future<void> _pumpEditor(
  WidgetTester tester,
  Widget child,
) {
  return tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Padding(
          padding: const EdgeInsets.all(16),
          child: child,
        ),
      ),
    ),
  );
}
