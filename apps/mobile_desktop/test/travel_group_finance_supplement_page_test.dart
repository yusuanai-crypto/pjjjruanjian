import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/business/business_api.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_group_finance/travel_group_finance_supplement_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

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

  test('mobile saver delegates to the employee-selected system location',
      () async {
    final suggestedNames = <String>[];
    final saver = FinanceImageSaveService(
      isWindows: false,
      systemFileSaver: (
        bytes, {
        required suggestedName,
      }) async {
        expect(bytes, isNotEmpty);
        suggestedNames.add(suggestedName);
        return '/employee-selected/手机积分表.png';
      },
    );

    final result = await saver.save(
      Uint8List.fromList([9, 8, 7]),
      album: financeImageAlbumName,
      name: '手机积分表',
    );

    expect(result.target, FinanceImageSaveTarget.userSelectedLocation);
    expect(result.successMessage, '已保存到员工选择的位置');
    expect(result.filePath, '/employee-selected/手机积分表.png');
    expect(suggestedNames.single, '手机积分表');
  });

  test('cancelling the system file saver does not write a public file',
      () async {
    final saver = FinanceImageSaveService(
      isWindows: false,
      systemFileSaver: (
        bytes, {
        required suggestedName,
      }) async =>
          null,
    );

    await expectLater(
      saver.save(
        Uint8List.fromList([9, 8, 7]),
        album: financeImageAlbumName,
        name: '手机积分表',
      ),
      throwsA(
        isA<FinanceImageSaveException>().having(
          (error) => error.message,
          'message',
          contains('已取消'),
        ),
      ),
    );
  });

  test('points-table money scaling uses integer half-up rounding', () {
    expect(scalePointsTableAmountCents(699400), 6994);
    expect(formatPointsTableMoneyCents(699400), '¥69.94');
    expect(formatPointsTableMoneyCents(1295600), '¥129.56');
    expect(scalePointsTableAmountCents(149), 1);
    expect(scalePointsTableAmountCents(150), 2);
    expect(scalePointsTableAmountCents(-150), -2);
    expect(pointsTableDisplayCentsToSourceCents(123), 12300);
  });

  test('summary model parses stable after-sales impact fields', () {
    final record = TravelGroupFinanceSummaryRecord.fromJson({
      ..._summaryJson(),
      'afterSalesCount': 3,
      'activeAfterSalesCount': 2,
      'pendingAfterSalesRefundCount': 2,
      'pendingAfterSalesRefundAmountCents': 4567,
      'latestAfterSalesNo': 'AS-20260723-001',
      'latestAfterSalesStatus': 'waiting_refund',
      'afterSalesImpactStatus': 'refund_pending_confirmation',
    });

    expect(record.afterSalesCount, 3);
    expect(record.activeAfterSalesCount, 2);
    expect(record.pendingAfterSalesRefundCount, 2);
    expect(record.pendingAfterSalesRefundAmountCents, 4567);
    expect(record.latestAfterSalesNo, 'AS-20260723-001');
    expect(record.latestAfterSalesStatus, 'waiting_refund');
    expect(record.afterSalesImpactStatus, 'refund_pending_confirmation');
    expect(record.travelGroup?.agencyId, 'agency-default');
    expect(record.travelGroup?.guideId, 'guide-default');
    expect(record.travelGroup?.guidePhone, '18800000000');
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
      startsWith('/api/travel-group-finance-summaries/finance-rows'),
    );
    expect(find.text('TG-HIDDEN-001'), findsNothing);
    expect(find.text('团号'), findsNothing);
    expect(find.byKey(const ValueKey('finance-select-all')), findsOneWidget);
    expect(find.byKey(const ValueKey('group-1:select')), findsOneWidget);
    expect(find.byType(Checkbox), findsNWidgets(2));
    expect(find.text('月返积分'), findsOneWidget);
    expect(find.text('积分/日返积分'), findsOneWidget);
    expect(find.text('货到付款'), findsOneWidget);
    expect(find.text('已付定金'), findsOneWidget);
    expect(find.text('已确认退款'), findsOneWidget);
    expect(find.text('有效销售额'), findsOneWidget);
    expect(find.text('扣酒成本'), findsWidgets);
    expect(find.text('售后影响'), findsOneWidget);
    expect(find.text('已返月返积分'), findsOneWidget);
    expect(find.text('未返月返积分'), findsOneWidget);
    expect(find.byKey(const ValueKey('group-1:guideImage')), findsOneWidget);
    expect(find.text('旅行社积分导游联络图'), findsWidgets);
    expect(
      find.byKey(const ValueKey('group-1:travelAgencyImage')),
      findsOneWidget,
    );
    expect(find.text('旅行社图片'), findsWidgets);
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
    await tester.tap(find.byKey(const ValueKey('group-1:select')));
    await tester.pump();
    expect(
      tester
          .widget<Checkbox>(find.byKey(const ValueKey('group-1:select')))
          .value,
      isFalse,
    );
  });

  testWidgets(
      'no-order row keeps recalculation enabled and disables summary mutations',
      (tester) async {
    final apiClient = _FakeFinanceApiClient(
      summaries: [
        _summaryJson(summaryExists: false),
      ],
    );
    await _pumpPage(tester, apiClient: apiClient);

    expect(find.text('未生成汇总'), findsWidgets);
    expect(find.text('¥0.00'), findsWidgets);
    final deductionInput = tester.widget<TextField>(
      find.byKey(const ValueKey('group-1:agencyDeductionInput')),
    );
    final deductionSave = tester.widget<FilledButton>(
      find.byKey(const ValueKey('group-1:agencyDeductionSave')),
    );
    expect(deductionInput.enabled, isFalse);
    expect(deductionSave.onPressed, isNull);
    expect(
      tester
          .widget<Switch>(
            find.byKey(const ValueKey('group-1:guideInfoSent')),
          )
          .onChanged,
      isNull,
    );
    expect(
      tester
          .widget<Switch>(
            find.byKey(const ValueKey('group-1:travelAgencyInfoSent')),
          )
          .onChanged,
      isNull,
    );
    for (final key in const [
      ValueKey('group-1:dailyRebatePaid'),
      ValueKey('group-1:monthlyRebatePaid'),
    ]) {
      final action = find.descendant(
        of: find.byKey(key),
        matching: find.byType(OutlinedButton),
      );
      expect(tester.widget<OutlinedButton>(action).onPressed, isNull);
    }

    await tester.tap(find.byKey(const ValueKey('group-1:select')));
    await tester.pump();
    final recalculate = tester.widget<FilledButton>(
      find.byKey(const ValueKey('finance-recalculate-button')),
    );
    expect(recalculate.onPressed, isNotNull);
    await tester.tap(find.byKey(const ValueKey('finance-recalculate-button')));
    await _pumpUntil(tester, () => apiClient.postPaths.isNotEmpty);
    expect(apiClient.patchPaths, isEmpty);
    expect(apiClient.postPaths.single, '/api/commission-records/recalculate');
  });

  testWidgets(
      'all-personal group keeps an existing ordinary summary row with zero order amounts',
      (tester) async {
    final summary = _summaryJson();
    for (final field in [
      'totalSalesAmountCents',
      'totalCashOnDeliveryCents',
      'totalPaidDepositCents',
      'confirmedRefundAmountCents',
      'effectiveSalesAmountCents',
      'totalAgencyDeductionCents',
      'totalAgencyNetAmountCents',
      'totalDailyRebateCents',
      'totalMonthlyRebateCents',
      'paidRebateCents',
      'unpaidRebateCents',
      'paidDailyRebateCents',
      'unpaidDailyRebateCents',
      'paidMonthlyRebateCents',
      'unpaidMonthlyRebateCents',
    ]) {
      summary[field] = 0;
    }
    summary['sourceSnapshot'] = {
      'orders': const [],
      'pointsDestinationFilter': 'TRAVEL_AGENCY',
    };
    final apiClient = _FakeFinanceApiClient(summaries: [summary]);
    await _pumpPage(tester, apiClient: apiClient);

    expect(
      find.byKey(const ValueKey('group-1:rowTapTarget')),
      findsOneWidget,
    );
    expect(find.text('未生成汇总'), findsNothing);
    expect(find.text('¥0.00'), findsAtLeastNWidgets(10));
  });

  testWidgets('clicking a data row toggles its manual checkbox',
      (tester) async {
    await _pumpPage(tester, apiClient: _FakeFinanceApiClient());

    await tester.tap(
      find.byKey(const ValueKey('group-1:rowTapTarget')),
    );
    await tester.pump();
    expect(
      tester
          .widget<Checkbox>(find.byKey(const ValueKey('group-1:select')))
          .value,
      isTrue,
    );

    await tester.tap(
      find.byKey(const ValueKey('group-1:rowTapTarget')),
    );
    await tester.pump();
    expect(
      tester
          .widget<Checkbox>(find.byKey(const ValueKey('group-1:select')))
          .value,
      isFalse,
    );
  });

  testWidgets('selected Excel export button follows visible selection',
      (tester) async {
    await _pumpPage(tester, apiClient: _FakeFinanceApiClient());

    final button = find.byKey(
      const ValueKey('finance-export-selected-excel-button'),
    );
    expect(tester.widget<OutlinedButton>(button).onPressed, isNull);

    await tester.tap(find.byKey(const ValueKey('group-1:select')));
    await tester.pump();
    expect(tester.widget<OutlinedButton>(button).onPressed, isNotNull);
  });

  testWidgets(
      'selected Excel export writes visible selected rows without overwriting',
      (tester) async {
    final documentsDirectory = (await tester.runAsync(
      () => Directory.systemTemp.createTemp(
        'jiangjiu-points-table-excel-test-',
      ),
    ))!;
    addTearDown(() {
      if (documentsDirectory.existsSync()) {
        documentsDirectory.deleteSync(recursive: true);
      }
    });
    final apiClient = _FakeFinanceApiClient(
      summaries: [
        _summaryJson(index: 1, agencyName: '甲旅行社'),
        _summaryJson(index: 2, agencyName: '乙旅行社'),
      ],
      excelDownloadFileName: 'points:table-selected.xlsx',
    );
    await _pumpPage(
      tester,
      apiClient: apiClient,
      documentsDirectoryProvider: () async => documentsDirectory,
    );

    await tester.tap(find.byKey(const ValueKey('finance-select-all')));
    await tester.pump();
    await tester.enterText(
      find.byKey(const ValueKey('finance-filter-agency')),
      '甲',
    );
    await tester.pump();

    final exportButton = find.byKey(
      const ValueKey('finance-export-selected-excel-button'),
    );
    await tester.tap(exportButton);
    await _pumpUntil(
      tester,
      () =>
          apiClient.postBytesPaths.length == 1 &&
          find.textContaining('已导出 1 行积分信息：').evaluate().isNotEmpty,
    );

    expect(apiClient.postBytesPaths.single,
        '/api/travel-group-finance-summaries/finance-rows/export');
    expect(apiClient.postBytesBodies.single, {
      'financeRowIds': ['group-1'],
    });
    expect(
      apiClient.postBytesDefaultFileNames.single,
      'finance-rows-selected.xlsx',
    );
    final exportDirectory = Directory(
      '${documentsDirectory.path}${Platform.pathSeparator}exports',
    );
    var files = exportDirectory.listSync().whereType<File>().toList();
    expect(files, hasLength(1));
    expect(files.single.path, endsWith('points_table-selected.xlsx'));
    expect(files.single.readAsBytesSync(), [1, 2, 3, 4]);
    expect(find.textContaining(files.single.absolute.path), findsOneWidget);

    await tester.tap(exportButton);
    await _pumpUntil(
      tester,
      () =>
          apiClient.postBytesPaths.length == 2 &&
          find.textContaining(' (1).xlsx').evaluate().isNotEmpty,
    );
    files = exportDirectory.listSync().whereType<File>().toList();
    expect(files, hasLength(2));
    expect(
      files.map((file) => file.path),
      contains(endsWith('points_table-selected (1).xlsx')),
    );

    await tester.enterText(
      find.byKey(const ValueKey('finance-filter-agency')),
      '',
    );
    await tester.pump();
    expect(
      tester
          .widget<Checkbox>(find.byKey(const ValueKey('group-1:select')))
          .value,
      isTrue,
    );
    expect(
      tester
          .widget<Checkbox>(find.byKey(const ValueKey('group-2:select')))
          .value,
      isTrue,
    );
    expect(
      tester
          .widget<Switch>(
            find.byKey(const ValueKey('group-1:guideInfoSent')),
          )
          .onChanged,
      isNull,
    );
  });

  testWidgets('selected Excel export failure restores the button',
      (tester) async {
    final apiClient = _FakeFinanceApiClient(failExcelExport: true);
    await _pumpPage(tester, apiClient: apiClient);
    await tester.tap(find.byKey(const ValueKey('group-1:select')));
    await tester.pump();

    final button = find.byKey(
      const ValueKey('finance-export-selected-excel-button'),
    );
    await tester.tap(button);
    await _pumpUntil(
      tester,
      () => find.textContaining('Excel 导出暂时失败').evaluate().isNotEmpty,
    );

    expect(tester.widget<OutlinedButton>(button).onPressed, isNotNull);
    expect(find.text('导出所选 Excel'), findsOneWidget);
    expect(find.text('Excel 导出中'), findsNothing);
  });

  testWidgets('select-all and filtered select-all affect visible rows only',
      (tester) async {
    final summaries = [
      _summaryJson(index: 1, agencyId: 'agency-a', agencyName: '甲旅行社'),
      _summaryJson(index: 2, agencyId: 'agency-b', agencyName: '乙旅行社'),
    ];
    await _pumpPage(
      tester,
      apiClient: _FakeFinanceApiClient(summaries: summaries),
    );

    await tester.tap(find.byKey(const ValueKey('finance-select-all')));
    await tester.pump();
    expect(
      tester
          .widget<Checkbox>(find.byKey(const ValueKey('group-1:select')))
          .value,
      isTrue,
    );
    expect(
      tester
          .widget<Checkbox>(find.byKey(const ValueKey('group-2:select')))
          .value,
      isTrue,
    );
    await tester.tap(find.byKey(const ValueKey('finance-select-all')));
    await tester.pump();

    final agencyFilter = find.byKey(const ValueKey('finance-filter-agency'));
    await tester.enterText(agencyFilter, '甲');
    await tester.pump();
    expect(find.byKey(const ValueKey('group-2:select')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('finance-select-all')));
    await tester.pump();

    await tester.enterText(agencyFilter, '');
    await tester.pump();
    expect(
      tester
          .widget<Checkbox>(find.byKey(const ValueKey('group-1:select')))
          .value,
      isTrue,
    );
    expect(
      tester
          .widget<Checkbox>(find.byKey(const ValueKey('group-2:select')))
          .value,
      isFalse,
    );
  });

  testWidgets('points table displays dedicated scaled amounts', (tester) async {
    final summary = _summaryJson(
      totalSalesAmountCents: 699400,
      totalAgencyNetAmountCents: 1295600,
    );
    await _pumpPage(
      tester,
      apiClient: _FakeFinanceApiClient(summaries: [summary]),
    );

    expect(find.text('¥69.94'), findsWidgets);
    expect(find.text('¥129.56'), findsWidgets);
    expect(find.text('¥6994.00'), findsNothing);
    expect(find.text('¥12956.00'), findsNothing);
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
    expect(saver.saved.single.name, contains('旅行社积分导游联络表'));
    expect(find.textContaining('系统文件保存器选择的位置'), findsWidgets);
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

    expect(saver.saved.single.name, contains('积分表'));
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

  testWidgets('single agency image only shows the requested export fields',
      (tester) async {
    await _pumpPage(
      tester,
      apiClient: _FakeFinanceApiClient(),
    );

    tester
        .widget<OutlinedButton>(
          find.descendant(
            of: find.byKey(const ValueKey('group-1:travelAgencyImage')),
            matching: find.byType(OutlinedButton),
          ),
        )
        .onPressed!();
    await tester.pump();

    final image = find.byKey(
      const ValueKey('finance-export-single-image-travelAgency'),
    );
    expect(image, findsOneWidget);
    for (final label in [
      '日期',
      '旅行社',
      '导游',
      '车牌',
      '人数',
      '品鉴师',
      '销售额',
      '上单金额',
    ]) {
      expect(find.descendant(of: image, matching: find.text(label)),
          findsOneWidget);
    }
    for (final label in [
      '旅行社图片',
      '已付定金',
      '货到付款',
      '已确认退款',
      '有效销售额',
      '扣酒成本',
      '日返积分',
      '月返积分',
      '售后影响',
    ]) {
      expect(
          find.descendant(of: image, matching: find.text(label)), findsNothing);
    }
  });

  testWidgets('single guide image hides title and after-sales impact',
      (tester) async {
    await _pumpPage(
      tester,
      apiClient: _FakeFinanceApiClient(),
    );

    tester
        .widget<OutlinedButton>(
          find.descendant(
            of: find.byKey(const ValueKey('group-1:guideImage')),
            matching: find.byType(OutlinedButton),
          ),
        )
        .onPressed!();
    await tester.pump();

    final image =
        find.byKey(const ValueKey('finance-export-single-image-guide'));
    expect(image, findsOneWidget);
    for (final label in [
      '日期',
      '旅行社',
      '导游',
      '车牌',
      '人数',
      '品鉴师',
      '上单金额',
    ]) {
      expect(find.descendant(of: image, matching: find.text(label)),
          findsOneWidget);
    }
    for (final label in ['旅行社积分导游联络图', '售后影响']) {
      expect(
          find.descendant(of: image, matching: find.text(label)), findsNothing);
    }
  });

  testWidgets('single image file names omit image labels and stay distinct',
      (tester) async {
    final saver = _FakeImageSaver();
    await _pumpPage(
      tester,
      apiClient: _FakeFinanceApiClient(),
      imageSaver: saver.call,
    );

    for (final key in ['travelAgencyImage', 'guideImage']) {
      tester
          .widget<OutlinedButton>(
            find.descendant(
              of: find.byKey(ValueKey('group-1:$key')),
              matching: find.byType(OutlinedButton),
            ),
          )
          .onPressed!();
      await _pumpUntil(
        tester,
        () => saver.saved.length == (key == 'travelAgencyImage' ? 1 : 2),
      );
    }

    final names = saver.saved.map((image) => image.name).toList();
    expect(names[0], endsWith('-积分表'));
    expect(names[1], endsWith('-旅行社积分导游联络表'));
    expect(names.toSet(), hasLength(2));
    expect(names.every((name) => !name.contains('旅行社图片')), isTrue);
    expect(names.every((name) => !name.contains('导游图片')), isTrue);
  });

  testWidgets(
      'same agency exports one two-row table with shared money formatting',
      (tester) async {
    final renderer = _FakeTableImageRenderer();
    final saver = _FakeImageSaver();
    final summaries = [
      _summaryJson(
        index: 1,
        agencyId: 'agency-shared',
        agencyName: '黔程旅行社',
        totalSalesAmountCents: 699400,
      ),
      _summaryJson(
        index: 2,
        agencyId: 'agency-shared',
        agencyName: '黔程旅行社',
        totalSalesAmountCents: 1295600,
      ),
    ];
    await _pumpPage(
      tester,
      apiClient: _FakeFinanceApiClient(summaries: summaries),
      imageSaver: saver.call,
      tableImageRenderer: renderer.call,
    );

    await tester.tap(find.byKey(const ValueKey('finance-select-all')));
    await tester.pump();
    await tester.tap(
      find.byKey(const ValueKey('finance-export-agency-images-button')),
    );
    await _pumpUntil(tester, () => saver.attempts == 1);

    expect(renderer.pages, hasLength(1));
    expect(renderer.pages.single.rows, hasLength(2));
    expect(renderer.pages.single.rows[0].cells[3], '¥69.94');
    expect(renderer.pages.single.rows[1].cells[3], '¥129.56');
    expect(saver.saved.single.name, contains('黔程旅行社-积分表-'));
    expect(saver.saved.single.name, contains('第1页'));
  });

  testWidgets('different agencies export separate tables without mixing rows',
      (tester) async {
    final renderer = _FakeTableImageRenderer();
    final saver = _FakeImageSaver();
    await _pumpPage(
      tester,
      apiClient: _FakeFinanceApiClient(
        summaries: [
          _summaryJson(
            index: 1,
            agencyId: 'agency-a',
            agencyName: '甲旅行社',
          ),
          _summaryJson(
            index: 2,
            agencyId: 'agency-b',
            agencyName: '乙旅行社',
          ),
        ],
      ),
      imageSaver: saver.call,
      tableImageRenderer: renderer.call,
    );

    await tester.tap(find.byKey(const ValueKey('finance-select-all')));
    await tester.pump();
    await tester.tap(
      find.byKey(const ValueKey('finance-export-agency-images-button')),
    );
    await _pumpUntil(tester, () => saver.attempts == 2);

    expect(renderer.pages, hasLength(2));
    expect(
      renderer.pages.map((page) => page.receiverName).toSet(),
      {'甲旅行社', '乙旅行社'},
    );
    expect(
      renderer.pages.every((page) => page.rows.length == 1),
      isTrue,
    );
    expect(
      renderer.pages
          .expand((page) => page.rows)
          .map((row) => row.travelGroupId)
          .toSet(),
      {'group-1', 'group-2'},
    );
  });

  testWidgets('same guide and agency merge into one guide table',
      (tester) async {
    final renderer = _FakeTableImageRenderer();
    final saver = _FakeImageSaver();
    await _pumpPage(
      tester,
      apiClient: _FakeFinanceApiClient(
        summaries: [
          _summaryJson(index: 1),
          _summaryJson(index: 2),
        ],
      ),
      imageSaver: saver.call,
      tableImageRenderer: renderer.call,
    );

    await tester.tap(find.byKey(const ValueKey('finance-select-all')));
    await tester.pump();
    await tester.tap(
      find.byKey(const ValueKey('finance-export-guide-images-button')),
    );
    await _pumpUntil(tester, () => saver.attempts == 1);

    expect(renderer.pages, hasLength(1));
    expect(renderer.pages.single.type, FinanceImageType.guide);
    expect(renderer.pages.single.rows, hasLength(2));
  });

  testWidgets('different guides never mix in one guide table', (tester) async {
    final renderer = _FakeTableImageRenderer();
    final saver = _FakeImageSaver();
    await _pumpPage(
      tester,
      apiClient: _FakeFinanceApiClient(
        summaries: [
          _summaryJson(
            index: 1,
            guideId: 'guide-a',
            guideName: '甲导游',
          ),
          _summaryJson(
            index: 2,
            guideId: 'guide-b',
            guideName: '乙导游',
          ),
        ],
      ),
      imageSaver: saver.call,
      tableImageRenderer: renderer.call,
    );

    await tester.tap(find.byKey(const ValueKey('finance-select-all')));
    await tester.pump();
    await tester.tap(
      find.byKey(const ValueKey('finance-export-guide-images-button')),
    );
    await _pumpUntil(tester, () => saver.attempts == 2);

    expect(renderer.pages, hasLength(2));
    expect(
      renderer.pages.map((page) => page.receiverName).toSet(),
      {'甲导游', '乙导游'},
    );
  });

  testWidgets('agency export table has aligned requested columns only',
      (tester) async {
    final renderer = _FakeTableImageRenderer();
    final saver = _FakeImageSaver();
    await _pumpPage(
      tester,
      apiClient: _FakeFinanceApiClient(
        afterSalesImpactStatus: 'refund_pending_confirmation',
        pendingAfterSalesRefundAmountCents: 2500,
      ),
      imageSaver: saver.call,
      tableImageRenderer: renderer.call,
    );

    await tester.tap(find.byKey(const ValueKey('group-1:select')));
    await tester.pump();
    await tester.tap(
      find.byKey(const ValueKey('finance-export-agency-images-button')),
    );
    await _pumpUntil(tester, () => saver.attempts == 1);

    final page = renderer.pages.single;
    expect(page.headers, ['日期', '旅行社', '导游', '销售额', '上单金额']);
    expect(page.columnWidths, hasLength(page.headers.length));
    expect(
      page.rows.every((row) => row.cells.length == page.headers.length),
      isTrue,
    );
  });

  testWidgets('guide export table omits after-sales impact and stays aligned',
      (tester) async {
    final renderer = _FakeTableImageRenderer();
    final saver = _FakeImageSaver();
    await _pumpPage(
      tester,
      apiClient: _FakeFinanceApiClient(
        afterSalesImpactStatus: 'refund_pending_confirmation',
        pendingAfterSalesRefundAmountCents: 2500,
      ),
      imageSaver: saver.call,
      tableImageRenderer: renderer.call,
    );

    await tester.tap(find.byKey(const ValueKey('group-1:select')));
    await tester.pump();
    await tester.tap(
      find.byKey(const ValueKey('finance-export-guide-images-button')),
    );
    await _pumpUntil(tester, () => saver.attempts == 1);

    final page = renderer.pages.single;
    expect(page.headers, [
      '日期',
      '旅行社',
      '导游',
      '车牌',
      '人数',
      '品鉴师',
      '上单金额',
    ]);
    expect(page.headers, isNot(contains('售后影响')));
    expect(page.columnWidths, hasLength(page.headers.length));
    expect(
      page.rows.every((row) => row.cells.length == page.headers.length),
      isTrue,
    );
  });

  testWidgets('export table component repeats headers and has no controls',
      (tester) async {
    const page = FinanceExportTablePage(
      type: FinanceImageType.guide,
      receiverKey: 'guide-id:guide-default',
      receiverName: '赵导',
      headers: ['日期', '旅行社'],
      columnWidths: [140, 200],
      rows: [
        FinanceExportTableRow(
          travelGroupId: 'group-1',
          cells: ['2026-07-01', '黔程旅行社'],
        ),
      ],
      dateRangeLabel: '2026-07-01至2026-07-01',
      pageNumber: 1,
      totalPages: 2,
      exportDate: '2026-07-24',
    );
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: FinanceExportTableImage(page: page),
        ),
      ),
    );

    expect(
      find.byKey(const ValueKey('finance-export-table')),
      findsOneWidget,
    );
    expect(find.text('日期'), findsOneWidget);
    expect(find.text('旅行社'), findsOneWidget);
    expect(find.byType(Checkbox), findsNothing);
    expect(find.byType(TextField), findsNothing);
    expect(
      find.byWidgetPredicate(
        (widget) => widget is ButtonStyleButton || widget is IconButton,
      ),
      findsNothing,
    );
    expect(find.byType(Switch), findsNothing);
  });

  testWidgets('saves manual agency deduction in cents and replaces row data',
      (tester) async {
    final apiClient = _FakeFinanceApiClient();
    await _pumpPage(tester, apiClient: apiClient);

    final input = find.byKey(
      const ValueKey('group-1:agencyDeductionInput'),
    );
    final save = find.byKey(
      const ValueKey('group-1:agencyDeductionSave'),
    );
    await tester.enterText(input, '1.23');
    tester.widget<FilledButton>(save).onPressed!.call();
    await _pumpUntil(
      tester,
      () => apiClient.patchPaths.any(
        (path) => path.endsWith('/group-1/agency-deduction'),
      ),
    );

    expect(apiClient.patchBodies.last, {
      'totalAgencyDeductionCents': 12300,
    });
    expect(
      tester.widget<TextField>(input).controller?.text,
      '1.23',
    );
    expect(find.text('扣酒成本已保存。'), findsOneWidget);
    expect(find.text('¥8.77'), findsWidgets);
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
    tester.widget<FilledButton>(save).onPressed!.call();
    await tester.pump();
    expect(find.text('扣酒成本不能小于 0。'), findsOneWidget);

    await tester.enterText(input, '1.234');
    tester.widget<FilledButton>(save).onPressed!.call();
    await tester.pump();
    expect(find.text('请输入最多两位小数的有效金额。'), findsOneWidget);

    await tester.enterText(input, '10.01');
    tester.widget<FilledButton>(save).onPressed!.call();
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
    final save = find.byKey(
      const ValueKey('group-1:agencyDeductionSave'),
    );
    await tester.enterText(input, '0.88');
    await tester.ensureVisible(save);
    await tester.tap(save);
    await _pumpUntil(
      tester,
      () => find.textContaining('扣酒成本保存失败').evaluate().isNotEmpty,
    );

    expect(tester.widget<TextField>(input).controller?.text, '0.88');
    expect(find.textContaining('服务器暂时无法保存'), findsOneWidget);
  });

  testWidgets('pressing Enter saves agency deduction without per-key calls',
      (tester) async {
    final apiClient = _FakeFinanceApiClient();
    await _pumpPage(tester, apiClient: apiClient);

    final input = find.byKey(
      const ValueKey('group-1:agencyDeductionInput'),
    );
    await tester.enterText(input, '0.50');
    await tester.pump();
    expect(apiClient.patchPaths, isEmpty);

    await tester.testTextInput.receiveAction(TextInputAction.done);
    await _pumpUntil(tester, () => apiClient.patchPaths.isNotEmpty);
    expect(apiClient.patchBodies.single['totalAgencyDeductionCents'], 5000);
  });

  testWidgets('system file saver rejection does not mark the guide image ready',
      (tester) async {
    final apiClient = _FakeFinanceApiClient();
    final saver = _FakeImageSaver(
      failureForCall: (_) => const FinanceImageSaveException(
        '系统文件保存器拒绝写入，图片未保存。',
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

    expect(find.textContaining('系统文件保存器拒绝写入'), findsOneWidget);
    expect(
      tester
          .widget<Switch>(
            find.byKey(const ValueKey('group-1:guideInfoSent')),
          )
          .onChanged,
      isNull,
    );
  });

  testWidgets('partial page failure reports table counts and marks only rows',
      (tester) async {
    final apiClient = _FakeFinanceApiClient(summaryCount: 21);
    final saver = _FakeImageSaver(
      failureForCall: (call) => call == 2
          ? const FinanceImageSaveException('设备存储空间不足，无法保存到相册。')
          : null,
    );
    final renderer = _FakeTableImageRenderer();
    await _pumpPage(
      tester,
      apiClient: apiClient,
      imageSaver: saver.call,
      tableImageRenderer: renderer.call,
    );

    await tester.tap(find.byKey(const ValueKey('finance-select-all')));
    await tester.pump();
    await tester.tap(
      find.byKey(const ValueKey('finance-export-guide-images-button')),
    );
    await _pumpUntil(tester, () => saver.attempts == 2);
    await tester.pump();

    expect(renderer.pages, hasLength(2));
    expect(renderer.pages.first.rows, hasLength(20));
    expect(renderer.pages.last.rows, hasLength(1));
    expect(renderer.pages.first.headers, renderer.pages.last.headers);
    expect(renderer.pages.first.pageNumber, 1);
    expect(renderer.pages.last.pageNumber, 2);
    expect(renderer.pages.first.fileName, contains('第1页.png'));
    expect(renderer.pages.last.fileName, contains('第2页.png'));
    expect(find.textContaining('成功 1 张表格，失败 1 张'), findsWidgets);
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
            find.byKey(const ValueKey('group-21:guideInfoSent')),
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
        filePath: r'C:\Users\Test\Pictures\贵州酱酒馆积分表\积分表.png',
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
      'allowLatestAgencyRebateRuleFallback': true,
    });
    expect(apiClient.getPaths.length, 2);
    expect(find.text('¥0.70'), findsWidgets);
    expect(find.text('¥0.02'), findsWidgets);
    expect(find.text('¥0.01'), findsWidgets);
    expect(find.textContaining('订单 1 笔'), findsOneWidget);
  });

  testWidgets('recalculate reloads and shows fallback feedback',
      (tester) async {
    final apiClient = _FakeFinanceApiClient(
      recalculationWarnings: const [
        {
          'code': 'agency_rebate_rule_fallback_applied',
          'message': '该历史订单已使用当前启用的旅行社返点规则补算。',
          'context': {'salesOrderId': 'order-1'},
        },
      ],
    );
    await _pumpPage(tester, apiClient: apiClient);
    await tester.tap(find.byKey(const ValueKey('group-1:select')));
    await tester.pump();
    await tester.tap(
      find.byKey(const ValueKey('finance-recalculate-button')),
    );
    await _pumpUntil(tester, () => apiClient.getPaths.length == 2);
    expect(find.textContaining('部分历史订单使用当前启用的返点规则补算'), findsOneWidget);
  });

  testWidgets('recalculate shows explicit all-orders missing-rule feedback',
      (tester) async {
    final apiClient = _FakeFinanceApiClient(
      recalculationWarnings: const [
        {
          'code': 'missing_agency_daily_rebate_rule',
          'message': '未找到日返规则。',
          'context': {'salesOrderId': 'order-1'},
        },
        {
          'code': 'missing_agency_monthly_rebate_rule',
          'message': '未找到月返规则。',
          'context': {'salesOrderId': 'order-1'},
        },
      ],
    );
    await _pumpPage(tester, apiClient: apiClient);
    await tester.tap(find.byKey(const ValueKey('group-1:select')));
    await tester.pump();
    await tester.tap(
      find.byKey(const ValueKey('finance-recalculate-button')),
    );
    await _pumpUntil(tester, () => apiClient.getPaths.length == 2);
    expect(
      find.text('未找到适用的旅行社返点规则，日返和月返未更新'),
      findsOneWidget,
    );
  });

  testWidgets('after-sales pending impact overrides ordinary row status',
      (tester) async {
    final apiClient = _FakeFinanceApiClient(
      afterSalesImpactStatus: 'refund_pending_confirmation',
      pendingAfterSalesRefundAmountCents: 2500,
    );
    await _pumpPage(tester, apiClient: apiClient);

    expect(find.text('退款待确认 ¥0.25'), findsOneWidget);
    expect(find.text('退款待确认'), findsWidgets);
    expect(
      find.byKey(const ValueKey('group-1:afterSalesImpact')),
      findsOneWidget,
    );
  });
}

Future<void> _pumpPage(
  WidgetTester tester, {
  required _FakeFinanceApiClient apiClient,
  FinanceImageSaver? imageSaver,
  FinanceFolderOpener? folderOpener,
  FinanceTableImageRenderer? tableImageRenderer,
  Future<Directory> Function()? documentsDirectoryProvider,
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
          tableImageRenderer: tableImageRenderer,
          documentsDirectoryProvider: documentsDirectoryProvider,
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
          target: FinanceImageSaveTarget.userSelectedLocation,
          album: album,
          filePath: null,
          directoryPath: null,
        );
  }
}

class _FakeTableImageRenderer {
  final List<FinanceExportTablePage> pages = <FinanceExportTablePage>[];

  Future<Uint8List> call(FinanceExportTablePage page) async {
    pages.add(page);
    return Uint8List.fromList([137, 80, 78, 71]);
  }
}

class _FakeFinanceApiClient extends ApiClient {
  _FakeFinanceApiClient({
    int summaryCount = 1,
    List<Map<String, dynamic>>? summaries,
    this.failAgencyDeduction = false,
    String afterSalesImpactStatus = 'none',
    int pendingAfterSalesRefundAmountCents = 0,
    this.recalculationWarnings = const [],
    this.failExcelExport = false,
    this.excelDownloadFileName = 'points-table-selected.xlsx',
  }) : super(baseUrl: 'http://127.0.0.1:3000') {
    final source = summaries ??
        [
          for (var index = 1; index <= summaryCount; index += 1)
            _summaryJson(index: index),
        ];
    _summaries = [
      for (final summary in source)
        {
          ...summary,
          if (summaries == null || afterSalesImpactStatus != 'none')
            'afterSalesImpactStatus': afterSalesImpactStatus,
          if (summaries == null || pendingAfterSalesRefundAmountCents != 0)
            'pendingAfterSalesRefundAmountCents':
                pendingAfterSalesRefundAmountCents,
        },
    ];
  }

  late List<Map<String, dynamic>> _summaries;
  final bool failAgencyDeduction;
  final List<Map<String, dynamic>> recalculationWarnings;
  final bool failExcelExport;
  final String excelDownloadFileName;
  final getPaths = <String>[];
  final patchPaths = <String>[];
  final patchBodies = <Map<String, dynamic>>[];
  final postPaths = <String>[];
  final postBodies = <Map<String, dynamic>>[];
  final postBytesPaths = <String>[];
  final postBytesBodies = <Map<String, dynamic>>[];
  final postBytesDefaultFileNames = <String>[];

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    getPaths.add(path);
    return {
      'data': {'financeRows': _summaries},
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
      ..['id'] = 'summary-recalculated'
      ..['summaryExists'] = true
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
        'warnings': recalculationWarnings,
        'travelGroupFinanceSummaries': [updated],
      },
    };
  }

  @override
  Future<ApiDownloadedFile> postBytes(
    String path, {
    required Map<String, dynamic> body,
    required String defaultFileName,
    String? token,
  }) async {
    postBytesPaths.add(path);
    postBytesBodies.add(Map<String, dynamic>.from(body));
    postBytesDefaultFileNames.add(defaultFileName);
    if (failExcelExport) {
      throw const ApiException(
        statusCode: 503,
        code: 'EXCEL_EXPORT_FAILED',
        message: 'Excel 导出暂时失败，请稍后重试。',
      );
    }
    return ApiDownloadedFile(
      bytes: Uint8List.fromList([1, 2, 3, 4]),
      fileName: excelDownloadFileName,
      contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }
}

Map<String, dynamic> _summaryJson({
  int index = 1,
  bool summaryExists = true,
  String agencyId = 'agency-default',
  String agencyName = '山水旅行社',
  String guideId = 'guide-default',
  String guideName = '赵导',
  String guidePhone = '18800000000',
  String visitDate = '2026-07-03',
  int totalSalesAmountCents = 100000,
  int totalAgencyNetAmountCents = 92000,
}) {
  return {
    'id': summaryExists ? 'summary-$index' : null,
    'summaryExists': summaryExists,
    'travelGroupId': 'group-$index',
    'travelGroup': {
      'id': 'group-$index',
      'groupNo': 'TG-HIDDEN-00$index',
      'visitDate': visitDate,
      'agencyId': agencyId,
      'travelAgency': agencyName,
      'guideId': guideId,
      'guideName': guideName,
      'guidePhone': guidePhone,
      'licensePlate': '贵A12345',
      'guestCount': 18,
      'tasterName': '陈品鉴',
      'financeMark': false,
    },
    'totalSalesAmountCents': summaryExists ? totalSalesAmountCents : 0,
    'totalCashOnDeliveryCents': summaryExists ? 20000 : 0,
    'totalPaidDepositCents': summaryExists ? 80000 : 0,
    'confirmedRefundAmountCents': 0,
    'effectiveSalesAmountCents': summaryExists ? totalSalesAmountCents : 0,
    'afterSalesCount': 0,
    'activeAfterSalesCount': 0,
    'pendingAfterSalesRefundCount': 0,
    'pendingAfterSalesRefundAmountCents': 0,
    'latestAfterSalesNo': null,
    'latestAfterSalesStatus': null,
    'afterSalesImpactStatus': 'none',
    'totalAgencyDeductionCents': summaryExists ? 8000 : 0,
    'agencyDeductionConfirmed': summaryExists,
    'agencyDeductionConfirmedById': summaryExists ? 'usr_finance' : null,
    'agencyDeductionConfirmedBy': summaryExists
        ? {
            'id': 'usr_finance',
            'name': '财务',
            'username': 'finance',
            'role': 'finance',
          }
        : null,
    'agencyDeductionConfirmedAt':
        summaryExists ? '2026-07-03T09:10:00.000Z' : null,
    'totalAgencyNetAmountCents': summaryExists ? totalAgencyNetAmountCents : 0,
    'totalDailyRebateCents': summaryExists ? 3000 : 0,
    'totalMonthlyRebateCents': summaryExists ? 1000 : 0,
    'paidRebateCents': 0,
    'unpaidRebateCents': summaryExists ? 4000 : 0,
    'paidDailyRebateCents': 0,
    'unpaidDailyRebateCents': summaryExists ? 3000 : 0,
    'paidMonthlyRebateCents': 0,
    'unpaidMonthlyRebateCents': summaryExists ? 1000 : 0,
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
    'calculationVersion': summaryExists ? 'stage7-v1' : null,
    'sourceSnapshot': summaryExists ? {'orders': []} : null,
    'updatedById': summaryExists ? 'usr_finance' : null,
    'updatedBy': summaryExists
        ? {
            'id': 'usr_finance',
            'name': '财务',
            'username': 'finance',
            'role': 'finance',
          }
        : null,
    'createdAt': summaryExists ? '2026-07-03T09:00:00.000Z' : null,
    'updatedAt': summaryExists ? '2026-07-03T09:00:00.000Z' : null,
  };
}
