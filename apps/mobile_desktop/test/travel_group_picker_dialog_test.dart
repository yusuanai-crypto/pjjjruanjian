import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/business/business_api.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_groups/travel_group_picker_dialog.dart';

void main() {
  testWidgets('only offers taster and tasting room search scopes',
      (tester) async {
    await _openPicker(
      tester,
      loadTravelGroups: (query) async => _filterGroups(_groups, query),
    );

    expect(
      find.byKey(const ValueKey('travel-group-taster-field')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('travel-group-tasting-room-no-field')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('travel-group-date-button')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('travel-group-clear-date-button')),
      findsNothing,
    );

    await tester.tap(find.byKey(const ValueKey('travel-group-search-scope')));
    await tester.pumpAndSettle();

    expect(find.text('品鉴师'), findsWidgets);
    expect(find.text('品鉴馆号'), findsOneWidget);
    expect(find.text('关键词'), findsNothing);
    expect(find.text('团号'), findsNothing);
    expect(find.text('旅行社'), findsNothing);
    expect(find.text('导游'), findsNothing);
  });

  testWidgets('searches by selected taster id without room number',
      (tester) async {
    final queries = <TravelGroupPickerQuery>[];
    await _openPicker(
      tester,
      loadTravelGroups: (query) async {
        queries.add(query);
        return _filterGroups(_groups, query);
      },
    );

    final searchButton = tester.widget<FilledButton>(
      find.byKey(const ValueKey('travel-group-search-button')),
    );
    expect(searchButton.onPressed, isNull);

    await tester.tap(find.byKey(const ValueKey('travel-group-taster-field')));
    await tester.pumpAndSettle();
    expect(find.text('测试品鉴师'), findsWidgets);
    expect(find.text('另一位品鉴师'), findsOneWidget);
    expect(find.text('已停用品鉴师'), findsNothing);
    await tester.tap(find.text('测试品鉴师').last);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('travel-group-search-button')));
    await tester.pumpAndSettle();

    expect(queries.last.scope, TravelGroupSearchScope.taster);
    expect(queries.last.tasterId, 'taster-1');
    expect(queries.last.tastingRoomNo, isNull);
    expect(find.text('TG20260629001'), findsOneWidget);
    expect(find.text('TG20260630002'), findsNothing);
  });

  testWidgets('trims tasting room number and clears stale scope conditions',
      (tester) async {
    final queries = <TravelGroupPickerQuery>[];
    await _openPicker(
      tester,
      loadTravelGroups: (query) async {
        queries.add(query);
        return _filterGroups(_groups, query);
      },
    );

    await tester.tap(find.byKey(const ValueKey('travel-group-taster-field')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('测试品鉴师').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('travel-group-search-button')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('travel-group-search-scope')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('品鉴馆号').last);
    await tester.pumpAndSettle();

    expect(queries.last.tasterId, isNull);
    expect(queries.last.tastingRoomNo, isNull);
    expect(
      find.byKey(const ValueKey('travel-group-taster-field')),
      findsNothing,
    );
    await tester.enterText(
      find.byKey(const ValueKey('travel-group-tasting-room-no-field')),
      '  5  ',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('travel-group-search-button')));
    await tester.pumpAndSettle();

    expect(queries.last.scope, TravelGroupSearchScope.tastingRoomNo);
    expect(queries.last.tasterId, isNull);
    expect(queries.last.tastingRoomNo, '5');
    expect(find.text('TG20260629001'), findsOneWidget);
    expect(find.text('TG20260630002'), findsNothing);

    await tester.tap(find.byKey(const ValueKey('travel-group-search-scope')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('品鉴师').last);
    await tester.pumpAndSettle();

    expect(queries.last.tasterId, isNull);
    expect(queries.last.tastingRoomNo, isNull);
  });

  testWidgets('shows required result fields and returns the selected record',
      (tester) async {
    TravelGroupRecord? selected;
    await _openPicker(
      tester,
      loadTravelGroups: (_) async => _groups,
      onSelected: (group) => selected = group,
    );

    expect(find.text('TG20260629001'), findsOneWidget);
    expect(find.text('到店日期：2026-06-29'), findsOneWidget);
    expect(find.text('品鉴师：测试品鉴师'), findsOneWidget);
    expect(find.text('品鉴馆号：5'), findsOneWidget);
    expect(find.text('品鉴师：未分配品鉴师'), findsOneWidget);
    expect(find.text('品鉴馆号：未填写品鉴馆号'), findsOneWidget);

    await tester.tap(find.text('TG20260629001'));
    await tester.pumpAndSettle();

    expect(selected?.id, 'group-1');
  });

  testWidgets('preserves optional finance mark display', (tester) async {
    await _openPicker(
      tester,
      loadTravelGroups: (_) async => _groups,
      showFinanceMark: true,
    );

    expect(find.text('已标记'), findsOneWidget);
    expect(find.text('未标记'), findsOneWidget);
  });

  testWidgets('labels and selects a completed historical travel group',
      (tester) async {
    TravelGroupRecord? selected;
    await _openPicker(
      tester,
      loadTravelGroups: (_) async => _groups,
      onSelected: (group) => selected = group,
    );

    expect(find.text('已结束'), findsOneWidget);
    await tester.tap(find.text('TG20260629001'));
    await tester.pumpAndSettle();
    expect(selected?.id, 'group-1');
    expect(selected?.isHistoricalCompleted, true);
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

  testWidgets('shows error state and retries the same query', (tester) async {
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
  TasterListLoader? loadTasters,
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
                      loadTasters: loadTasters ?? () async => _tasters,
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
  return groups.where((group) {
    if (query.tasterId != null && group.tasterId != query.tasterId) {
      return false;
    }
    if (query.tastingRoomNo != null &&
        group.tastingRoomNo != query.tastingRoomNo) {
      return false;
    }
    return true;
  }).toList();
}

const _tasters = <TasterOption>[
  TasterOption(
    id: 'taster-1',
    name: '测试品鉴师',
    username: 'taster-one',
  ),
  TasterOption(
    id: 'taster-2',
    name: '另一位品鉴师',
    username: 'taster-two',
  ),
];

final _groups = <TravelGroupRecord>[
  _group(
    id: 'group-1',
    groupNo: 'TG20260629001',
    visitDate: '2026-06-29',
    tasterId: 'taster-1',
    tasterName: '测试品鉴师',
    tastingRoomNo: '5',
    financeMark: true,
    isHistoricalCompleted: true,
  ),
  _group(
    id: 'group-2',
    groupNo: 'TG20260630002',
    visitDate: '2026-06-30',
  ),
];

TravelGroupRecord _group({
  required String id,
  required String groupNo,
  required String visitDate,
  String? tasterId,
  String? tasterName,
  String? tastingRoomNo,
  bool financeMark = false,
  bool isHistoricalCompleted = false,
}) {
  return TravelGroupRecord.fromJson({
    'id': id,
    'kind': 'travel',
    'groupNo': groupNo,
    'visitDate': visitDate,
    'tasterId': tasterId,
    'tasterName': tasterName,
    'tastingRoomNo': tastingRoomNo,
    'guestCount': 24,
    'status': 'unmarked',
    'financeMark': financeMark,
    'isHistoricalCompleted': isHistoricalCompleted,
    'tastingItems': const [],
    'salesOrders': const [],
    'orderSummary': const {
      'orderCount': 0,
      'totalAmountCents': 0,
      'cashOnDeliveryAmountCents': 0,
    },
  });
}
