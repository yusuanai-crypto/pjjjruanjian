import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/business/business_api.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_groups/travel_group_picker_dialog.dart';

void main() {
  testWidgets('searches travel groups by agency scope', (tester) async {
    final queries = <TravelGroupPickerQuery>[];
    await _openPicker(
      tester,
      loadTravelGroups: (query) async {
        queries.add(query);
        return _filterGroups(_groups, query);
      },
    );

    expect(find.text('TG20260629001'), findsOneWidget);
    expect(find.text('TG20260630002'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('travel-group-search-scope')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('旅行社').last);
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const ValueKey('travel-group-search-field')),
      '甲社',
    );
    await tester.tap(find.byKey(const ValueKey('travel-group-search-button')));
    await tester.pumpAndSettle();

    expect(queries.last.scope, TravelGroupSearchScope.travelAgency);
    expect(queries.last.text, '甲社');
    expect(find.text('TG20260629001'), findsOneWidget);
    expect(find.text('TG20260630002'), findsNothing);
  });

  testWidgets('passes initial date range to travel group loader',
      (tester) async {
    final queries = <TravelGroupPickerQuery>[];
    await _openPicker(
      tester,
      initialStart: DateTime(2026, 6, 30),
      initialEnd: DateTime(2026, 6, 30),
      loadTravelGroups: (query) async {
        queries.add(query);
        return _filterGroups(_groups, query);
      },
    );

    expect(queries.single.start, DateTime(2026, 6, 30));
    expect(queries.single.end, DateTime(2026, 6, 30));
    expect(find.text('2026-06-30 至 2026-06-30'), findsOneWidget);
    expect(find.text('TG20260629001'), findsNothing);
    expect(find.text('TG20260630002'), findsOneWidget);
  });

  testWidgets('selects a travel group and returns the record', (tester) async {
    TravelGroupRecord? selected;
    await _openPicker(
      tester,
      loadTravelGroups: (_) async => _groups,
      onSelected: (group) => selected = group,
    );

    await tester.tap(find.text('TG20260629001'));
    await tester.pumpAndSettle();

    expect(selected?.id, 'group-1');
    expect(selected?.travelAgency, '甲社');
  });

  testWidgets('hides travel group finance mark by default', (tester) async {
    await _openPicker(
      tester,
      loadTravelGroups: (_) async => _groups,
    );

    expect(find.text('已标记'), findsNothing);
    expect(find.text('未标记'), findsNothing);
  });

  testWidgets('shows travel group finance mark when enabled', (tester) async {
    await _openPicker(
      tester,
      loadTravelGroups: (_) async => _groups,
      showFinanceMark: true,
    );

    expect(find.text('已标记'), findsOneWidget);
    expect(find.text('未标记'), findsOneWidget);
  });

  testWidgets('shows empty state when no travel groups match', (tester) async {
    await _openPicker(
      tester,
      loadTravelGroups: (_) async => const <TravelGroupRecord>[],
    );

    expect(
      find.byKey(const ValueKey('travel-group-empty-state')),
      findsOneWidget,
    );
    expect(find.text('暂无匹配旅行团'), findsOneWidget);
  });

  testWidgets('shows error state and retry action', (tester) async {
    var attempts = 0;
    await _openPicker(
      tester,
      loadTravelGroups: (_) async {
        attempts += 1;
        if (attempts == 1) {
          throw Exception('旅行团加载失败');
        }
        return _groups;
      },
    );

    expect(find.text('旅行团加载失败'), findsOneWidget);

    await tester.tap(find.widgetWithText(OutlinedButton, '重试'));
    await tester.pumpAndSettle();

    expect(attempts, 2);
    expect(find.text('TG20260629001'), findsOneWidget);
  });

  testWidgets('shows loading state while travel groups are loading',
      (tester) async {
    final completer = Completer<List<TravelGroupRecord>>();
    await _openPicker(
      tester,
      settle: false,
      loadTravelGroups: (_) => completer.future,
    );

    expect(find.text('正在加载旅行团'), findsOneWidget);

    completer.complete(_groups);
    await tester.pumpAndSettle();

    expect(find.text('TG20260629001'), findsOneWidget);
  });
}

Future<void> _openPicker(
  WidgetTester tester, {
  required TravelGroupListLoader loadTravelGroups,
  DateTime? initialStart,
  DateTime? initialEnd,
  ValueChanged<TravelGroupRecord?>? onSelected,
  bool settle = true,
  bool showFinanceMark = false,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (context) {
          return Scaffold(
            body: Center(
              child: FilledButton(
                onPressed: () async {
                  final selected = await showDialog<TravelGroupRecord>(
                    context: context,
                    builder: (context) => TravelGroupPickerDialog(
                      loadTravelGroups: loadTravelGroups,
                      initialStart: initialStart,
                      initialEnd: initialEnd,
                      showFinanceMark: showFinanceMark,
                    ),
                  );
                  onSelected?.call(selected);
                },
                child: const Text('打开旅行团选择'),
              ),
            ),
          );
        },
      ),
    ),
  );

  await tester.tap(find.text('打开旅行团选择'));
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump(const Duration(milliseconds: 250));
  }
}

List<TravelGroupRecord> _filterGroups(
  List<TravelGroupRecord> groups,
  TravelGroupPickerQuery query,
) {
  final text = query.text.trim();
  return groups.where((group) {
    final visitDate = DateTime.tryParse(group.visitDate);
    if (query.start != null &&
        visitDate != null &&
        visitDate.isBefore(query.start!)) {
      return false;
    }
    if (query.end != null &&
        visitDate != null &&
        visitDate.isAfter(query.end!)) {
      return false;
    }
    if (text.isEmpty) {
      return true;
    }
    switch (query.scope) {
      case TravelGroupSearchScope.keyword:
        return [
          group.groupNo,
          group.travelAgency,
          group.guideName,
          group.visitDate,
        ].whereType<String>().join(' ').contains(text);
      case TravelGroupSearchScope.groupNo:
        return group.groupNo.contains(text);
      case TravelGroupSearchScope.travelAgency:
        return (group.travelAgency ?? '').contains(text);
      case TravelGroupSearchScope.guide:
        return (group.guideName ?? '').contains(text);
    }
  }).toList();
}

final _groups = <TravelGroupRecord>[
  _group(
    id: 'group-1',
    groupNo: 'TG20260629001',
    visitDate: '2026-06-29',
    travelAgency: '甲社',
    guideName: '王导',
    financeMark: true,
  ),
  _group(
    id: 'group-2',
    groupNo: 'TG20260630002',
    visitDate: '2026-06-30',
    travelAgency: '乙社',
    guideName: '李导',
  ),
];

TravelGroupRecord _group({
  required String id,
  required String groupNo,
  required String visitDate,
  required String travelAgency,
  required String guideName,
  bool financeMark = false,
}) {
  return TravelGroupRecord.fromJson({
    'id': id,
    'kind': 'travel',
    'groupNo': groupNo,
    'visitDate': visitDate,
    'travelAgency': travelAgency,
    'guideName': guideName,
    'guestCount': 24,
    'status': 'unmarked',
    'financeMark': financeMark,
    'tastingItems': const [],
    'salesOrders': const [],
    'orderSummary': const {
      'orderCount': 0,
      'totalAmountCents': 0,
      'cashOnDeliveryAmountCents': 0,
    },
  });
}
