import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_group_finance/travel_group_finance_supplement_page.dart';

void main() {
  setUp(() {
    TestWidgetsFlutterBinding.ensureInitialized();
  });

  testWidgets('loads real summaries without showing group number column',
      (tester) async {
    final apiClient = _FakeFinanceApiClient();
    final tempDirectory = _createTestDirectory();
    addTearDown(() => _deleteTestDirectory(tempDirectory));

    await _pumpPage(
      tester,
      apiClient: apiClient,
      documentsDirectory: tempDirectory,
    );

    expect(
      apiClient.getPaths.single,
      startsWith('/api/travel-group-finance-summaries'),
    );
    expect(find.text('TG-HIDDEN-001'), findsNothing);
    expect(find.text('团号'), findsNothing);
    expect(find.byKey(const ValueKey('finance-select-all')), findsOneWidget);
    expect(find.byKey(const ValueKey('group-1:select')), findsOneWidget);
    expect(find.text('月返积分'), findsOneWidget);
    expect(find.text('已返月返积分'), findsOneWidget);
    expect(find.text('未返月返积分'), findsOneWidget);
    expect(find.byKey(const ValueKey('group-1:guideImage')), findsOneWidget);
    expect(
      find.byKey(const ValueKey('group-1:travelAgencyImage')),
      findsOneWidget,
    );

    final checkbox = tester.widget<Checkbox>(
      find.byKey(const ValueKey('group-1:select')),
    );
    expect(checkbox.value, isFalse);
    await tester.tap(find.byKey(const ValueKey('group-1:select')));
    await tester.pump();
    expect(
      tester
          .widget<Checkbox>(find.byKey(const ValueKey('group-1:select')))
          .value,
      isTrue,
    );
  });

  testWidgets('enables and saves guide send state after guide image export',
      (tester) async {
    final apiClient = _FakeFinanceApiClient();
    final tempDirectory = _createTestDirectory();
    addTearDown(() => _deleteTestDirectory(tempDirectory));

    await _pumpPage(
      tester,
      apiClient: apiClient,
      documentsDirectory: tempDirectory,
    );

    final guideSwitchFinder =
        find.byKey(const ValueKey('group-1:guideInfoSent'));
    expect(tester.widget<Switch>(guideSwitchFinder).onChanged, isNull);

    await tester.tap(find.byKey(const ValueKey('group-1:select')));
    await tester.pump();
    expect(
      tester
          .widget<OutlinedButton>(
            find.byKey(const ValueKey('finance-export-guide-images-button')),
          )
          .onPressed,
      isNotNull,
    );
    await tester.tap(
      find.byKey(const ValueKey('finance-export-guide-images-button')),
    );
    await _pumpUntil(
      tester,
      () =>
          _exportedPngs(tempDirectory).isNotEmpty &&
          tester.widget<Switch>(guideSwitchFinder).onChanged != null,
    );

    expect(_exportedPngs(tempDirectory).single.path, contains('导游图片'));
    expect(tester.widget<Switch>(guideSwitchFinder).onChanged, isNotNull);
    expect(
      tester
          .widget<Switch>(
            find.byKey(const ValueKey('group-1:travelAgencyInfoSent')),
          )
          .onChanged,
      isNull,
    );

    tester.widget<Switch>(guideSwitchFinder).onChanged!(true);
    await _pumpUntil(
      tester,
      () => apiClient.patchBodies.isNotEmpty,
    );

    expect(
      apiClient.patchPaths.last,
      '/api/travel-group-finance-summaries/group-1',
    );
    expect(apiClient.patchBodies.last, {'guideInfoSent': true});
    expect(
      tester
          .widget<Switch>(find.byKey(const ValueKey('group-1:guideInfoSent')))
          .value,
      isTrue,
    );
  });

  testWidgets('exports selected agency images and enables only agency send',
      (tester) async {
    final apiClient = _FakeFinanceApiClient();
    final tempDirectory = _createTestDirectory();
    addTearDown(() => _deleteTestDirectory(tempDirectory));

    await _pumpPage(
      tester,
      apiClient: apiClient,
      documentsDirectory: tempDirectory,
    );

    await tester.tap(find.byKey(const ValueKey('group-1:select')));
    await tester.pump();
    await tester.ensureVisible(
      find.byKey(const ValueKey('finance-export-agency-images-button')),
    );
    expect(
      tester
          .widget<OutlinedButton>(
            find.byKey(const ValueKey('finance-export-agency-images-button')),
          )
          .onPressed,
      isNotNull,
    );
    await tester.tap(
      find.byKey(const ValueKey('finance-export-agency-images-button')),
    );
    await _pumpUntil(
      tester,
      () =>
          _exportedPngs(tempDirectory).isNotEmpty &&
          tester
                  .widget<Switch>(
                    find.byKey(
                      const ValueKey('group-1:travelAgencyInfoSent'),
                    ),
                  )
                  .onChanged !=
              null,
    );

    expect(_exportedPngs(tempDirectory).single.path, contains('旅行社图片'));
    expect(
      tester
          .widget<Switch>(
            find.byKey(const ValueKey('group-1:travelAgencyInfoSent')),
          )
          .onChanged,
      isNotNull,
    );
    expect(
      tester
          .widget<Switch>(find.byKey(const ValueKey('group-1:guideInfoSent')))
          .onChanged,
      isNull,
    );
  });
}

Future<void> _pumpPage(
  WidgetTester tester, {
  required _FakeFinanceApiClient apiClient,
  required Directory documentsDirectory,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(2200, 1200);
  addTearDown(() => apiClient.close(force: true));
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    MaterialApp(
      locale: const Locale('zh', 'CN'),
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      supportedLocales: const [Locale('zh', 'CN')],
      home: Scaffold(
        body: TravelGroupFinanceSupplementPage(
          apiClient: apiClient,
          token: 'test-token',
          documentsDirectoryProvider: () async => documentsDirectory,
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
  await tester.pump();
}

Future<void> _pumpUntil(
  WidgetTester tester,
  bool Function() predicate,
) async {
  for (var attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) {
      await tester.pump();
      return;
    }
    await tester.pump(const Duration(milliseconds: 100));
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 10)),
    );
  }
  final texts = tester
      .widgetList<Text>(find.byType(Text))
      .map((widget) => widget.data)
      .whereType<String>()
      .where((text) => text.trim().isNotEmpty)
      .take(90)
      .join(' | ');
  fail('Timed out waiting for condition. Visible text: $texts');
}

List<File> _exportedPngs(Directory root) {
  final directory = Directory(
    '${root.path}${Platform.pathSeparator}exports'
    '${Platform.pathSeparator}finance-images',
  );
  if (!directory.existsSync()) {
    return const <File>[];
  }
  return directory
      .listSync()
      .whereType<File>()
      .where((file) => file.path.endsWith('.png'))
      .toList();
}

Directory _createTestDirectory() {
  final directory = Directory(
    'C:\\tmp\\finance_supplement_test_${DateTime.now().microsecondsSinceEpoch}',
  );
  directory.createSync(recursive: true);
  return directory;
}

Future<void> _deleteTestDirectory(Directory directory) async {
  for (var attempt = 0; attempt < 5; attempt += 1) {
    try {
      if (directory.existsSync()) {
        directory.deleteSync(recursive: true);
      }
      return;
    } on FileSystemException {
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
  }
}

class _FakeFinanceApiClient extends ApiClient {
  _FakeFinanceApiClient() : super(baseUrl: 'http://127.0.0.1:3000') {
    _summaries = [_summaryJson()];
  }

  late List<Map<String, dynamic>> _summaries;
  final getPaths = <String>[];
  final patchPaths = <String>[];
  final patchBodies = <Map<String, dynamic>>[];

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    getPaths.add(path);
    return {
      'data': {'travelGroupFinanceSummaries': _summaries},
    };
  }

  @override
  Future<Map<String, dynamic>> patchJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    patchPaths.add(path);
    patchBodies.add(Map<String, dynamic>.from(body ?? <String, dynamic>{}));
    final id = path.split('/')[3];
    final updated = Map<String, dynamic>.from(
      _summaries.singleWhere((summary) => summary['travelGroupId'] == id),
    );
    updated.addAll(body ?? <String, dynamic>{});
    if (path.endsWith('/daily-rebate-paid')) {
      final isPaid = body?['isPaid'] == true;
      updated['dailyRebatePaid'] = isPaid;
      updated['paidDailyRebateCents'] =
          isPaid ? updated['totalDailyRebateCents'] : 0;
      updated['unpaidDailyRebateCents'] =
          isPaid ? 0 : updated['totalDailyRebateCents'];
    }
    if (path.endsWith('/monthly-rebate-paid')) {
      final isPaid = body?['isPaid'] == true;
      updated['monthlyRebatePaid'] = isPaid;
      updated['paidMonthlyRebateCents'] =
          isPaid ? updated['totalMonthlyRebateCents'] : 0;
      updated['unpaidMonthlyRebateCents'] =
          isPaid ? 0 : updated['totalMonthlyRebateCents'];
    }
    _summaries = [
      for (final summary in _summaries)
        summary['travelGroupId'] == id ? updated : summary,
    ];
    return {
      'data': {'travelGroupFinanceSummary': updated},
    };
  }
}

Map<String, dynamic> _summaryJson() {
  return {
    'id': 'summary-1',
    'travelGroupId': 'group-1',
    'travelGroup': {
      'id': 'group-1',
      'groupNo': 'TG-HIDDEN-001',
      'visitDate': '2026-07-03',
      'travelAgency': '山水旅行社',
      'guideName': '赵导',
      'licensePlate': '贵A12345',
      'guestCount': 18,
      'tasterName': '陈品鉴',
      'financeMark': false,
    },
    'totalSalesAmountCents': 100000,
    'totalCashOnDeliveryCents': 20000,
    'totalPaidDepositCents': 80000,
    'confirmedRefundAmountCents': 0,
    'effectiveSalesAmountCents': 100000,
    'totalAgencyDeductionCents': 8000,
    'agencyDeductionConfirmed': true,
    'agencyDeductionConfirmedById': 'usr_finance',
    'agencyDeductionConfirmedBy': {
      'id': 'usr_finance',
      'name': '财务',
      'username': 'finance',
      'role': 'finance',
    },
    'agencyDeductionConfirmedAt': '2026-07-03T09:10:00.000Z',
    'totalAgencyNetAmountCents': 92000,
    'totalDailyRebateCents': 3000,
    'totalMonthlyRebateCents': 1000,
    'paidRebateCents': 0,
    'unpaidRebateCents': 4000,
    'paidDailyRebateCents': 0,
    'unpaidDailyRebateCents': 3000,
    'paidMonthlyRebateCents': 0,
    'unpaidMonthlyRebateCents': 1000,
    'dailyRebatePaid': false,
    'dailyRebatePaidById': null,
    'dailyRebatePaidBy': null,
    'dailyRebatePaidAt': null,
    'monthlyRebatePaid': false,
    'monthlyRebatePaidById': null,
    'monthlyRebatePaidBy': null,
    'monthlyRebatePaidAt': null,
    'notes': null,
    'guideInfoSent': false,
    'travelAgencyInfoSent': false,
    'calculationVersion': 'stage7-v1',
    'sourceSnapshot': {'orders': []},
    'updatedById': 'usr_finance',
    'updatedBy': {
      'id': 'usr_finance',
      'name': '财务',
      'username': 'finance',
      'role': 'finance',
    },
    'createdAt': '2026-07-03T09:00:00.000Z',
    'updatedAt': '2026-07-03T09:00:00.000Z',
  };
}
