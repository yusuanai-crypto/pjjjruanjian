import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_group_finance/travel_group_finance_supplement_page.dart';

void main() {
  setUp(() {
    TestWidgetsFlutterBinding.ensureInitialized();
  });

  test('Windows saver writes under injected Pictures and avoids overwrites',
      () async {
    final profile = await Directory.systemTemp.createTemp(
      'jiangjiu-finance-image-test-',
    );
    addTearDown(() => profile.delete(recursive: true));
    final saver = FinanceImageSaveService(
      isWindows: true,
      windowsUserProfile: profile.path,
    );
    final bytes = Uint8List.fromList([1, 2, 3, 4]);

    final first = await saver.save(
      bytes,
      album: financeImageAlbumName,
      name: '2026-07-01-测试:积分表',
    );
    final second = await saver.save(
      bytes,
      album: financeImageAlbumName,
      name: '2026-07-01-测试:积分表',
    );

    expect(first.target, FinanceImageSaveTarget.windowsFolder);
    expect(first.filePath, isNotNull);
    expect(first.filePath, contains('Pictures'));
    expect(first.filePath, contains(financeImageAlbumName));
    expect(first.filePath, isNot(contains(':积分表')));
    expect(await File(first.filePath!).readAsBytes(), bytes);
    expect(second.filePath, isNot(first.filePath));
    expect(second.filePath, endsWith(' (1).png'));
    expect(await File(second.filePath!).readAsBytes(), bytes);
  });

  test('mobile saver delegates to Gal-compatible gallery writer', () async {
    final calls = <({String album, String name})>[];
    final saver = FinanceImageSaveService(
      isWindows: false,
      galleryWriter: (
        bytes, {
        required album,
        required name,
      }) async {
        expect(bytes, isNotEmpty);
        calls.add((album: album, name: name));
      },
    );

    final result = await saver.save(
      Uint8List.fromList([9, 8, 7]),
      album: financeImageAlbumName,
      name: '手机积分表',
    );

    expect(result.target, FinanceImageSaveTarget.systemGallery);
    expect(result.successMessage, '已保存到系统相册：贵州酱酒馆积分表');
    expect(calls.single.album, financeImageAlbumName);
    expect(calls.single.name, '手机积分表');
  });

  testWidgets('loads real summaries without showing group number column',
      (tester) async {
    final apiClient = _FakeFinanceApiClient();

    await _pumpPage(
      tester,
      apiClient: apiClient,
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
    expect(
      find.byKey(const ValueKey('group-1:agencyDeductionInput')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('group-1:agencyDeductionSave')),
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
    final saver = _FakeImageSaver();

    await _pumpPage(
      tester,
      apiClient: apiClient,
      imageSaver: saver.call,
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
          saver.saved.isNotEmpty &&
          tester.widget<Switch>(guideSwitchFinder).onChanged != null,
    );

    expect(saver.saved.single.album, financeImageAlbumName);
    expect(saver.saved.single.name, contains('导游图片'));
    expect(find.textContaining('系统相册：贵州酱酒馆积分表'), findsWidgets);
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
    final saver = _FakeImageSaver();

    await _pumpPage(
      tester,
      apiClient: apiClient,
      imageSaver: saver.call,
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
          saver.saved.isNotEmpty &&
          tester
                  .widget<Switch>(
                    find.byKey(
                      const ValueKey('group-1:travelAgencyInfoSent'),
                    ),
                  )
                  .onChanged !=
              null,
    );

    expect(saver.saved.single.name, contains('旅行社图片'));
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

  testWidgets('saves manual agency deduction in cents and replaces row data',
      (tester) async {
    final apiClient = _FakeFinanceApiClient();
    await _pumpPage(tester, apiClient: apiClient);

    final input = find.byKey(
      const ValueKey('group-1:agencyDeductionInput'),
    );
    await tester.enterText(input, '123.45');
    await tester.tap(
      find.byKey(const ValueKey('group-1:agencyDeductionSave')),
    );
    await _pumpUntil(
      tester,
      () => apiClient.patchPaths.any(
        (path) => path.endsWith('/group-1/agency-deduction'),
      ),
    );

    expect(apiClient.patchBodies.last, {
      'totalAgencyDeductionCents': 12345,
    });
    expect(
      tester.widget<TextField>(input).controller?.text,
      '123.45',
    );
    expect(find.text('扣酒成本已保存。'), findsOneWidget);
    expect(find.text('¥876.55'), findsWidgets);
  });

  testWidgets('rejects negative invalid precision and over-sales deductions',
      (tester) async {
    final apiClient = _FakeFinanceApiClient();
    await _pumpPage(tester, apiClient: apiClient);

    final input = find.byKey(
      const ValueKey('group-1:agencyDeductionInput'),
    );
    final save = find.byKey(
      const ValueKey('group-1:agencyDeductionSave'),
    );

    await tester.enterText(input, '-1');
    await tester.tap(save);
    await tester.pump();
    expect(find.text('扣酒成本不能小于 0。'), findsOneWidget);

    await tester.enterText(input, '1.234');
    await tester.tap(save);
    await tester.pump();
    expect(find.text('请输入最多两位小数的有效金额。'), findsOneWidget);

    await tester.enterText(input, '1000.01');
    await tester.tap(save);
    await tester.pump();
    expect(find.text('扣酒成本不能大于该旅行团销售额。'), findsOneWidget);
    expect(apiClient.patchPaths, isEmpty);
  });

  testWidgets('keeps manual input and shows a Chinese error when save fails',
      (tester) async {
    final apiClient = _FakeFinanceApiClient(failAgencyDeduction: true);
    await _pumpPage(tester, apiClient: apiClient);

    final input = find.byKey(
      const ValueKey('group-1:agencyDeductionInput'),
    );
    await tester.enterText(input, '88.88');
    await tester.tap(
      find.byKey(const ValueKey('group-1:agencyDeductionSave')),
    );
    await _pumpUntil(
      tester,
      () => find.textContaining('扣酒成本保存失败').evaluate().isNotEmpty,
    );

    expect(tester.widget<TextField>(input).controller?.text, '88.88');
    expect(find.textContaining('服务器暂时无法保存'), findsOneWidget);
  });

  testWidgets('pressing Enter saves agency deduction without per-key calls',
      (tester) async {
    final apiClient = _FakeFinanceApiClient();
    await _pumpPage(tester, apiClient: apiClient);

    final input = find.byKey(
      const ValueKey('group-1:agencyDeductionInput'),
    );
    await tester.enterText(input, '50');
    await tester.pump();
    expect(apiClient.patchPaths, isEmpty);

    await tester.testTextInput.receiveAction(TextInputAction.done);
    await _pumpUntil(tester, () => apiClient.patchPaths.isNotEmpty);
    expect(apiClient.patchBodies.single['totalAgencyDeductionCents'], 5000);
  });

  testWidgets('permission denial does not mark the guide image ready',
      (tester) async {
    final apiClient = _FakeFinanceApiClient();
    final saver = _FakeImageSaver(
      failureForCall: (_) => const FinanceImageSaveException(
        '相册权限被拒绝，请在系统设置中允许照片写入权限。',
      ),
    );
    await _pumpPage(
      tester,
      apiClient: apiClient,
      imageSaver: saver.call,
    );

    tester
        .widget<OutlinedButton>(
          find.descendant(
            of: find.byKey(const ValueKey('group-1:guideImage')),
            matching: find.byType(OutlinedButton),
          ),
        )
        .onPressed!();
    await _pumpUntil(tester, () => saver.attempts == 1);
    await tester.pump();

    expect(find.textContaining('相册权限被拒绝'), findsOneWidget);
    expect(
      tester
          .widget<Switch>(
            find.byKey(const ValueKey('group-1:guideInfoSent')),
          )
          .onChanged,
      isNull,
    );
  });

  testWidgets('batch image save reports actual partial success counts',
      (tester) async {
    final apiClient = _FakeFinanceApiClient(summaryCount: 2);
    final saver = _FakeImageSaver(
      failureForCall: (call) => call == 2
          ? const FinanceImageSaveException('设备存储空间不足，无法保存到相册。')
          : null,
    );
    await _pumpPage(
      tester,
      apiClient: apiClient,
      imageSaver: saver.call,
    );

    await tester.tap(find.byKey(const ValueKey('finance-select-all')));
    await tester.pump();
    await tester.tap(
      find.byKey(const ValueKey('finance-export-guide-images-button')),
    );
    await _pumpUntil(tester, () => saver.attempts == 2);
    await tester.pump();

    expect(find.textContaining('成功 1 张，失败 1 张'), findsWidgets);
    expect(
      tester
          .widget<Switch>(
            find.byKey(const ValueKey('group-1:guideInfoSent')),
          )
          .onChanged,
      isNotNull,
    );
    expect(
      tester
          .widget<Switch>(
            find.byKey(const ValueKey('group-2:guideInfoSent')),
          )
          .onChanged,
      isNull,
    );
  });

  testWidgets('Windows save message shows full path and open-folder action',
      (tester) async {
    final apiClient = _FakeFinanceApiClient();
    final saver = _FakeImageSaver(
      resultForCall: (_) => const FinanceImageSaveResult(
        target: FinanceImageSaveTarget.windowsFolder,
        album: financeImageAlbumName,
        filePath:
            r'C:\Users\Test\Pictures\贵州酱酒馆积分表\积分表.png',
        directoryPath: r'C:\Users\Test\Pictures\贵州酱酒馆积分表',
      ),
    );
    final opened = <String>[];
    await _pumpPage(
      tester,
      apiClient: apiClient,
      imageSaver: saver.call,
      folderOpener: (path) async => opened.add(path),
    );

    await tester.tap(find.byKey(const ValueKey('group-1:select')));
    await tester.pump();
    await tester.tap(
      find.byKey(const ValueKey('finance-export-guide-images-button')),
    );
    await _pumpUntil(tester, () => saver.saved.isNotEmpty);

    expect(
      find.textContaining(
        r'C:\Users\Test\Pictures\贵州酱酒馆积分表',
      ),
      findsWidgets,
    );
    expect(
      find.byKey(const ValueKey('finance-open-save-folder-button')),
      findsOneWidget,
    );
    await tester.tap(
      find.byKey(const ValueKey('finance-open-save-folder-button')),
    );
    await tester.pump();
    expect(opened.single, r'C:\Users\Test\Pictures\贵州酱酒馆积分表');
  });

  testWidgets('recalculate selected groups replaces current table row',
      (tester) async {
    final apiClient = _FakeFinanceApiClient();
    await _pumpPage(tester, apiClient: apiClient);

    await tester.tap(find.byKey(const ValueKey('group-1:select')));
    await tester.pump();
    await tester.tap(
      find.byKey(const ValueKey('finance-recalculate-button')),
    );
    await _pumpUntil(tester, () => apiClient.postPaths.isNotEmpty);

    expect(apiClient.postPaths.single, '/api/commission-records/recalculate');
    expect(apiClient.postBodies.single, {
      'travelGroupIds': ['group-1'],
      'agencyOnly': true,
    });
    expect(find.text('¥70.00'), findsWidgets);
    expect(find.text('¥2.10'), findsWidgets);
    expect(find.text('¥1.40'), findsWidgets);
    expect(find.textContaining('订单 1 笔'), findsOneWidget);
  });
}

Future<void> _pumpPage(
  WidgetTester tester, {
  required _FakeFinanceApiClient apiClient,
  FinanceImageSaver? imageSaver,
  FinanceFolderOpener? folderOpener,
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
          imageSaver: imageSaver ?? _FakeImageSaver().call,
          folderOpener: folderOpener ?? (_) async {},
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

class _SavedImage {
  const _SavedImage({required this.album, required this.name});

  final String album;
  final String name;
}

class _FakeImageSaver {
  _FakeImageSaver({this.failureForCall, this.resultForCall});

  final Object? Function(int call)? failureForCall;
  final FinanceImageSaveResult Function(int call)? resultForCall;
  final List<_SavedImage> saved = <_SavedImage>[];
  int attempts = 0;

  Future<FinanceImageSaveResult> call(
    Uint8List bytes, {
    required String album,
    required String name,
  }) async {
    attempts += 1;
    final failure = failureForCall?.call(attempts);
    if (failure != null) {
      throw failure;
    }
    expect(bytes, isNotEmpty);
    saved.add(_SavedImage(album: album, name: name));
    return resultForCall?.call(attempts) ??
        FinanceImageSaveResult(
          target: FinanceImageSaveTarget.systemGallery,
          album: album,
          filePath: null,
          directoryPath: null,
        );
  }
}

class _FakeFinanceApiClient extends ApiClient {
  _FakeFinanceApiClient({int summaryCount = 1, this.failAgencyDeduction = false})
      : super(baseUrl: 'http://127.0.0.1:3000') {
    _summaries = [
      for (var index = 1; index <= summaryCount; index += 1)
        _summaryJson(index: index),
    ];
  }

  late List<Map<String, dynamic>> _summaries;
  final bool failAgencyDeduction;
  final getPaths = <String>[];
  final patchPaths = <String>[];
  final patchBodies = <Map<String, dynamic>>[];
  final postPaths = <String>[];
  final postBodies = <Map<String, dynamic>>[];

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
    if (path.endsWith('/agency-deduction') && failAgencyDeduction) {
      throw const ApiException(
        statusCode: 503,
        code: 'AGENCY_DEDUCTION_SAVE_FAILED',
        message: '服务器暂时无法保存，请稍后重试。',
      );
    }
    final id = path.split('/')[3];
    final updated = Map<String, dynamic>.from(
      _summaries.singleWhere((summary) => summary['travelGroupId'] == id),
    );
    updated.addAll(body ?? <String, dynamic>{});
    if (path.endsWith('/agency-deduction')) {
      final deduction = body?['totalAgencyDeductionCents'] as int? ?? 0;
      final sales = updated['totalSalesAmountCents'] as int? ?? 0;
      final net = sales - deduction;
      final daily = (net * 0.03).round();
      final monthly = (net * 0.01).round();
      updated['totalAgencyDeductionCents'] = deduction;
      updated['totalAgencyNetAmountCents'] = net;
      updated['totalDailyRebateCents'] = daily;
      updated['totalMonthlyRebateCents'] = monthly;
      updated['paidRebateCents'] = 0;
      updated['unpaidRebateCents'] = daily + monthly;
      updated['unpaidDailyRebateCents'] = daily;
      updated['unpaidMonthlyRebateCents'] = monthly;
      updated['agencyDeductionConfirmed'] = false;
      updated['agencyDeductionConfirmedById'] = null;
      updated['agencyDeductionConfirmedBy'] = null;
      updated['agencyDeductionConfirmedAt'] = null;
    }
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

  @override
  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    postPaths.add(path);
    postBodies.add(Map<String, dynamic>.from(body ?? const {}));
    if (path != '/api/commission-records/recalculate') {
      throw StateError('Unexpected POST $path');
    }
    final updated = Map<String, dynamic>.from(_summaries.first)
      ..['totalAgencyDeductionCents'] = 3000
      ..['totalAgencyNetAmountCents'] = 7000
      ..['totalDailyRebateCents'] = 210
      ..['totalMonthlyRebateCents'] = 140
      ..['unpaidRebateCents'] = 350
      ..['unpaidDailyRebateCents'] = 210
      ..['unpaidMonthlyRebateCents'] = 140;
    _summaries = [updated, ..._summaries.skip(1)];
    return {
      'data': {
        'source': 'commission_records.recalculate.api',
        'orderCount': 1,
        'travelGroupCount': 1,
        'successCount': 1,
        'failureCount': 0,
        'skippedCount': 0,
        'skippedConfirmedCount': 0,
        'skippedManualOverrideCount': 0,
        'generatedRecords': const [],
        'updatedRecords': const [],
        'unchangedRecords': const [],
        'warnings': const [],
        'travelGroupFinanceSummaries': [updated],
      },
    };
  }
}

Map<String, dynamic> _summaryJson({int index = 1}) {
  return {
    'id': 'summary-$index',
    'travelGroupId': 'group-$index',
    'travelGroup': {
      'id': 'group-$index',
      'groupNo': 'TG-HIDDEN-00$index',
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
