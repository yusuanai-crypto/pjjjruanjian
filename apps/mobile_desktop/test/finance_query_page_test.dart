import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/finance/finance_query_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets('shows finance workbench metrics filters and pending after sales',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpFinanceQuery(tester, apiClient);

    final uri = Uri.parse(apiClient.financeWorkbenchPaths.last);
    expect(uri.path, '/api/finance/workbench');
    expect(uri.queryParameters['limit'], '50');

    expect(find.text('出单销售额'), findsOneWidget);
    expect(find.text('退款金额'), findsOneWidget);
    expect(find.text('净销售额'), findsOneWidget);
    expect(find.text('物流费用'), findsWidgets);
    expect(find.text('待开票'), findsWidgets);
    expect(find.text('待标记'), findsOneWidget);
    expect(find.text('待确认售后'), findsWidgets);
    expect(find.text('¥798.00'), findsWidgets);
    expect(find.text('¥0.00'), findsWidgets);
    expect(find.text('¥18.00'), findsWidgets);
    expect(find.textContaining('退款 ¥12.00'), findsWidgets);

    expect(find.text('AS20260702001'), findsWidgets);
    expect(find.textContaining('状态 待退款'), findsWidgets);
    expect(find.text('质量问题'), findsWidgets);

    await tester.tap(find.widgetWithText(FilterChip, '标记信息'));
    await tester.pumpAndSettle();
    expect(find.text('客户未标记'), findsWidgets);

    await tester.tap(find.widgetWithText(FilterChip, '开票待办'));
    await tester.pumpAndSettle();
    expect(find.text('待补物流单号'), findsWidgets);
    expect(find.text('待补运费'), findsWidgets);
  });

  testWidgets('shows phase 4 finance fields and saves finance updates',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpFinanceQuery(tester, apiClient);

    expect(find.text('SO20260630001'), findsWidgets);
    expect(find.text('客户已标记'), findsWidgets);
    expect(find.text('物流单号 SF123456789'), findsOneWidget);
    expect(find.text('运费 ¥18.00'), findsOneWidget);
    expect(find.text('待开票'), findsWidgets);

    await tester.ensureVisible(find.text('SO20260630001').first);
    await tester.tap(find.text('SO20260630001').first);
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const ValueKey('finance-logistics-no-field')),
      'YT999000111',
    );
    await tester.enterText(
      find.byKey(const ValueKey('finance-logistics-fee-field')),
      '25.50',
    );
    await tester.tap(
      find.byKey(const ValueKey('finance-invoice-issued-checkbox')),
    );
    await tester.enterText(
      find.byKey(const ValueKey('finance-remark-field')),
      '运费已复核',
    );
    await tester.tap(find.byKey(const ValueKey('finance-save-button')));
    await tester.pumpAndSettle();

    expect(apiClient.financePatchPaths,
        contains('/api/sales-orders/order-1/finance'));
    expect(apiClient.lastFinanceBody?['logisticsNo'], 'YT999000111');
    expect(apiClient.lastFinanceBody?['logisticsFeeCents'], 2550);
    expect(apiClient.lastFinanceBody?['invoiceIssued'], isTrue);
    expect(apiClient.lastFinanceBody?['financeRemark'], '运费已复核');
    expect(find.text('物流单号 YT999000111'), findsOneWidget);
    expect(find.text('运费 ¥25.50'), findsOneWidget);
    expect(find.text('已开票'), findsWidgets);
  });

  testWidgets('shows API error when finance save fails', (tester) async {
    final apiClient = _FakeApiClient(failFinancePatch: true);
    await _pumpFinanceQuery(tester, apiClient);

    await tester.ensureVisible(find.text('SO20260630001').first);
    await tester.tap(find.text('SO20260630001').first);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('finance-save-button')));
    await tester.pumpAndSettle();

    expect(find.text('运费不能小于 0'), findsOneWidget);
  });

  testWidgets('finance can confirm after sales refund and refresh workbench',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpFinanceQuery(tester, apiClient);

    const confirmKey = ValueKey(
      'finance-pending-after-sales-secondary-confirm-after-sales-1',
    );
    expect(find.byKey(confirmKey), findsOneWidget);
    expect(find.text('AS20260702001'), findsWidgets);
    expect(apiClient.financeWorkbenchPaths, hasLength(1));

    await tester.ensureVisible(find.byKey(confirmKey));
    await tester.tap(find.byKey(confirmKey));
    await tester.pumpAndSettle();

    expect(apiClient.afterSalesConfirmPaths,
        contains('/api/after-sales-orders/after-sales-1/finance-confirm'));
    expect(apiClient.lastAfterSalesConfirmBody?['financeConfirmed'], isTrue);
    expect(apiClient.financeWorkbenchPaths, hasLength(2));
    expect(find.byKey(confirmKey), findsNothing);
    expect(find.text('当前范围暂无待确认售后'), findsWidgets);
    expect(find.text('¥786.00'), findsWidgets);
  });

  testWidgets(
      'finance can filter commission records inspect details and confirm taster commission',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpFinanceQuery(tester, apiClient);

    await _tapFilterChip(tester, '提成明细');

    final listUri = Uri.parse(apiClient.commissionRecordPaths.last);
    expect(listUri.path, '/api/commission-records');
    expect(listUri.queryParameters['limit'], '100');
    expect(find.text('SO-COMMISSION-001'), findsOneWidget);
    expect(find.text('TG-COMMISSION-001'), findsOneWidget);
    expect(find.text('Smoke Customer'), findsOneWidget);
    expect(find.text('Smoke Taster'), findsOneWidget);
    expect(find.text('品鉴师提成'), findsWidgets);
    expect(find.text('缺外联'), findsOneWidget);
    expect(find.text('有未确认退款'), findsOneWidget);

    await tester.enterText(
      find.byKey(const ValueKey('finance-commission-target-user-field')),
      'taster-1',
    );
    await _selectDropdownValue(
      tester,
      key: const ValueKey('finance-commission-target-type-field'),
      label: '品鉴师提成',
    );
    await _selectDropdownValue(
      tester,
      key: const ValueKey('finance-commission-confirm-filter'),
      label: '待确认',
    );
    _pressFilledButton(
      tester,
      const ValueKey('finance-commission-query-button'),
    );
    await tester.pumpAndSettle();

    final filteredUri = Uri.parse(apiClient.commissionRecordPaths.last);
    expect(filteredUri.path, '/api/commission-records');
    expect(filteredUri.queryParameters['targetUserId'], 'taster-1');
    expect(filteredUri.queryParameters['targetType'], 'taster_commission');
    expect(filteredUri.queryParameters['isConfirmed'], 'false');

    _pressTextButton(
      tester,
      const ValueKey('finance-commission-detail-commission-taster-1'),
    );
    await tester.pumpAndSettle();
    expect(apiClient.commissionDetailPaths,
        contains('/api/commission-records/commission-taster-1'));
    expect(find.textContaining('test calculation note'), findsOneWidget);
    expect(find.text('规则和来源快照摘要'), findsOneWidget);
    await tester.tap(find.text('关闭'));
    await tester.pumpAndSettle();

    _pressIconButton(
      tester,
      const ValueKey('finance-commission-manual-amount-commission-taster-1'),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('finance-taster-commission-amount-field')),
      '88.50',
    );
    await tester.tap(
      find.byKey(const ValueKey('finance-taster-commission-save-button')),
    );
    await tester.pumpAndSettle();

    expect(
      apiClient.commissionPatchPaths,
      contains('/api/commission-records/commission-taster-1/manual-amount'),
    );
    expect(apiClient.lastCommissionPatchBody?['amountCents'], 8850);
    expect(find.text('¥88.50'), findsWidgets);

    _pressIconButton(
      tester,
      const ValueKey('finance-commission-confirm-commission-taster-1'),
    );
    await tester.pumpAndSettle();
    expect(
      apiClient.commissionPatchPaths,
      contains('/api/commission-records/commission-taster-1/confirm'),
    );
    expect(apiClient.lastCommissionPatchBody?['isConfirmed'], isTrue);
    expect(find.text('已确认'), findsWidgets);

    _pressIconButton(
      tester,
      const ValueKey('finance-commission-unconfirm-commission-taster-1'),
    );
    await tester.pumpAndSettle();
    expect(apiClient.lastCommissionPatchBody?['isConfirmed'], isFalse);
    expect(find.text('待确认'), findsWidgets);
  });

  testWidgets('finance manages travel group rebate summaries', (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpFinanceQuery(tester, apiClient);

    await _tapFilterChip(tester, '返积分汇总');

    var listUri = Uri.parse(apiClient.summaryListPaths.last);
    expect(listUri.path, '/api/travel-group-finance-summaries');
    expect(listUri.queryParameters['limit'], '100');
    expect(find.text('TG-SUMMARY-001'), findsOneWidget);
    expect(find.text('Smoke Agency'), findsWidgets);
    expect(find.text('¥1000.00'), findsWidgets);
    expect(find.text('¥60.00'), findsWidgets);
    expect(find.text('待确认'), findsWidgets);

    await tester.enterText(
      find.byKey(const ValueKey('finance-summary-agency-field')),
      'Smoke Agency',
    );
    await tester.enterText(
      find.byKey(const ValueKey('finance-summary-guide-field')),
      'Smoke Guide',
    );
    _pressFilledButton(
      tester,
      const ValueKey('finance-summary-query-button'),
    );
    await tester.pumpAndSettle();

    listUri = Uri.parse(apiClient.summaryListPaths.last);
    expect(listUri.queryParameters['agencyName'], 'Smoke Agency');
    expect(listUri.queryParameters['guideName'], 'Smoke Guide');

    _pressTextButton(
      tester,
      const ValueKey('finance-summary-detail-group-summary-1'),
    );
    await tester.pumpAndSettle();
    expect(
      apiClient.summaryDetailPaths,
      contains('/api/travel-group-finance-summaries/group-summary-1'),
    );
    expect(find.text('订单摘要'), findsOneWidget);
    expect(find.text('提成积分明细摘要'), findsOneWidget);
    expect(find.text('SO-SUMMARY-001'), findsOneWidget);
    expect(find.text('agency_daily_rebate'), findsOneWidget);
    await tester.tap(find.text('关闭'));
    await tester.pumpAndSettle();

    _pressIconButton(
      tester,
      const ValueKey('finance-summary-edit-group-summary-1'),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('finance-summary-notes-field')),
      'test summary updated',
    );
    await tester.tap(
      find.byKey(const ValueKey('finance-summary-guide-info-sent-checkbox')),
    );
    await tester.tap(
      find.byKey(
        const ValueKey('finance-summary-agency-info-sent-checkbox'),
      ),
    );
    await tester.tap(find.byKey(const ValueKey('finance-summary-save-button')));
    await tester.pumpAndSettle();

    expect(
      apiClient.summaryPatchPaths,
      contains('/api/travel-group-finance-summaries/group-summary-1'),
    );
    expect(
      apiClient.lastSummaryPatchBody?.containsKey('paidRebateCents'),
      isFalse,
    );
    expect(apiClient.lastSummaryPatchBody?['notes'], 'test summary updated');
    expect(apiClient.lastSummaryPatchBody?['guideInfoSent'], isTrue);
    expect(apiClient.lastSummaryPatchBody?['travelAgencyInfoSent'], isTrue);

    final dailyRebatePaidButton = find.byKey(
      const ValueKey('finance-summary-daily-rebate-paid-group-summary-1'),
    );
    await tester.ensureVisible(dailyRebatePaidButton);
    await tester.tap(dailyRebatePaidButton);
    await tester.pumpAndSettle();
    expect(
      apiClient.summaryPatchPaths,
      contains(
        '/api/travel-group-finance-summaries/group-summary-1/'
        'daily-rebate-paid',
      ),
    );
    expect(apiClient.lastSummaryPatchBody?['isPaid'], isTrue);
    expect(find.text('¥0.00'), findsWidgets);

    final monthlyRebatePaidButton = find.byKey(
      const ValueKey('finance-summary-monthly-rebate-paid-group-summary-1'),
    );
    await tester.ensureVisible(monthlyRebatePaidButton);
    await tester.tap(monthlyRebatePaidButton);
    await tester.pumpAndSettle();
    expect(
      apiClient.summaryPatchPaths,
      contains(
        '/api/travel-group-finance-summaries/group-summary-1/'
        'monthly-rebate-paid',
      ),
    );
    expect(apiClient.lastSummaryPatchBody?['isPaid'], isTrue);

    await tester.ensureVisible(dailyRebatePaidButton);
    await tester.tap(dailyRebatePaidButton);
    await tester.pumpAndSettle();
    expect(apiClient.lastSummaryPatchBody?['isPaid'], isFalse);

    _pressIconButton(
      tester,
      const ValueKey('finance-summary-confirm-group-summary-1'),
    );
    await tester.pumpAndSettle();
    expect(
      apiClient.summaryPatchPaths,
      contains(
        '/api/travel-group-finance-summaries/group-summary-1/'
        'agency-deduction-confirm',
      ),
    );
    expect(apiClient.lastSummaryPatchBody?['isConfirmed'], isTrue);
    expect(find.text('已确认'), findsWidgets);

    _pressIconButton(
      tester,
      const ValueKey('finance-summary-unconfirm-group-summary-1'),
    );
    await tester.pumpAndSettle();
    expect(apiClient.lastSummaryPatchBody?['isConfirmed'], isFalse);

    _pressIconButton(
      tester,
      const ValueKey('finance-summary-refresh-group-summary-1'),
    );
    await tester.pumpAndSettle();
    expect(
      apiClient.summaryRefreshPaths,
      contains('/api/travel-group-finance-summaries/group-summary-1/refresh'),
    );
  });

  testWidgets('finance can export commission records and rebate summaries',
      (tester) async {
    final apiClient = _FakeApiClient();
    final documentsDirectory = Directory(
      'build/finance-export-test-${DateTime.now().microsecondsSinceEpoch}',
    )..createSync(recursive: true);
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      await _deleteDirectoryWithRetry(documentsDirectory);
    });

    await _pumpFinanceQuery(
      tester,
      apiClient,
      documentsDirectory: documentsDirectory,
    );

    await _tapFilterChip(tester, '提成明细');
    expect(find.byKey(const ValueKey('finance-commission-export-button')),
        findsOneWidget);

    final commissionExportedFile = File(
      '${documentsDirectory.path}${Platform.pathSeparator}exports'
      '${Platform.pathSeparator}backend-commission-records.xlsx',
    );
    final commissionExportButton =
        find.byKey(const ValueKey('finance-commission-export-button'));
    apiClient.downloadGate = Completer<void>();
    await tester.ensureVisible(commissionExportButton);
    await tester.pump();
    await tester.tap(commissionExportButton);
    await tester.pump();
    expect(find.text('导出中'), findsOneWidget);
    apiClient.downloadGate!.complete();
    apiClient.downloadGate = null;
    for (var index = 0;
        index < 20 && !commissionExportedFile.existsSync();
        index += 1) {
      await tester.pump(const Duration(milliseconds: 50));
      await tester.runAsync(() async {
        await Future<void>.delayed(const Duration(milliseconds: 20));
      });
    }
    await tester.pump(const Duration(milliseconds: 200));

    var uri = Uri.parse(apiClient.downloadPaths.last);
    expect(uri.path, '/api/commission-records/export');
    expect(uri.queryParameters['limit'], '1000');
    expect(apiClient.lastDownloadDefaultFileName, 'commission-records.xlsx');
    expect(commissionExportedFile.existsSync(), isTrue);
    expect(commissionExportedFile.readAsBytesSync(), [0x50, 0x4B, 0x03, 0x04]);

    final summaryFilter = find.widgetWithText(FilterChip, '返积分汇总');
    await tester.ensureVisible(summaryFilter);
    await tester.pump();
    await tester.tap(summaryFilter);
    for (var index = 0;
        index < 20 &&
            find
                .byKey(const ValueKey('finance-summary-export-button'))
                .evaluate()
                .isEmpty;
        index += 1) {
      await tester.pump(const Duration(milliseconds: 50));
      await tester.runAsync(() async {
        await Future<void>.delayed(const Duration(milliseconds: 20));
      });
    }
    expect(find.byKey(const ValueKey('finance-summary-export-button')),
        findsOneWidget);
    await tester.enterText(
      find.byKey(const ValueKey('finance-summary-agency-field')),
      'Smoke Agency',
    );
    await tester.enterText(
      find.byKey(const ValueKey('finance-summary-guide-field')),
      'Smoke Guide',
    );

    final summaryExportedFile = File(
      '${documentsDirectory.path}${Platform.pathSeparator}exports'
      '${Platform.pathSeparator}backend-travel-group-finance-summaries.xlsx',
    );
    final summaryExportButton =
        find.byKey(const ValueKey('finance-summary-export-button'));
    apiClient.downloadGate = Completer<void>();
    await tester.ensureVisible(summaryExportButton);
    await tester.pump();
    await tester.tap(summaryExportButton);
    await tester.pump();
    expect(find.text('导出中'), findsOneWidget);
    apiClient.downloadGate!.complete();
    apiClient.downloadGate = null;
    for (var index = 0;
        index < 20 && !summaryExportedFile.existsSync();
        index += 1) {
      await tester.pump(const Duration(milliseconds: 50));
      await tester.runAsync(() async {
        await Future<void>.delayed(const Duration(milliseconds: 20));
      });
    }
    await tester.pump(const Duration(milliseconds: 200));

    uri = Uri.parse(apiClient.downloadPaths.last);
    expect(uri.path, '/api/travel-group-finance-summaries/export');
    expect(uri.queryParameters['agencyName'], 'Smoke Agency');
    expect(uri.queryParameters['guideName'], 'Smoke Guide');
    expect(
      apiClient.lastDownloadDefaultFileName,
      'travel-group-finance-summaries.xlsx',
    );
    expect(summaryExportedFile.existsSync(), isTrue);
    expect(summaryExportedFile.readAsBytesSync(), [0x50, 0x4B, 0x03, 0x04]);
  });

  testWidgets('stage 7 export buttons are hidden from non permitted roles',
      (tester) async {
    for (final role in [
      UserRole.sales,
      UserRole.warehouse,
      UserRole.afterSales,
      UserRole.frontDesk,
      UserRole.taster,
    ]) {
      final apiClient = _FakeApiClient();
      await _pumpFinanceQuery(tester, apiClient, role: role);

      await tester.tap(find.widgetWithText(FilterChip, '提成明细'));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('finance-commission-export-button')),
          findsNothing);

      await tester.tap(find.widgetWithText(FilterChip, '返积分汇总'));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('finance-summary-export-button')),
          findsNothing);

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    }
  });

  testWidgets('stage 7 pages show 403 errors explicitly', (tester) async {
    final apiClient = _FakeApiClient(
      commissionListError: const ApiException(
        statusCode: 403,
        code: 'FORBIDDEN',
        message: '无权查看提成积分',
      ),
      downloadError: const ApiException(
        statusCode: 403,
        code: 'FORBIDDEN',
        message: '无权导出提成积分',
      ),
    );
    await _pumpFinanceQuery(tester, apiClient);

    await tester.tap(find.widgetWithText(FilterChip, '提成明细'));
    await tester.pumpAndSettle();
    expect(find.text('无权查看提成积分'), findsOneWidget);

    apiClient.commissionListError = null;
    final exportButton =
        find.byKey(const ValueKey('finance-commission-export-button'));
    await tester.ensureVisible(exportButton);
    await tester.pump();
    await tester.tap(exportButton);
    for (var index = 0;
        index < 20 && find.text('无权导出提成积分').evaluate().isEmpty;
        index += 1) {
      await tester.pump(const Duration(milliseconds: 50));
      await tester.runAsync(() async {
        await Future<void>.delayed(const Duration(milliseconds: 20));
      });
    }
    expect(find.text('无权导出提成积分'), findsWidgets);
  });

  testWidgets('read-only finance workbench roles do not see confirm button',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpFinanceQuery(tester, apiClient, role: UserRole.boss);

    expect(
      find.byKey(
        const ValueKey(
          'finance-pending-after-sales-secondary-confirm-after-sales-1',
        ),
      ),
      findsNothing,
    );
    expect(find.text('待确认'), findsWidgets);

    await tester.ensureVisible(find.text('SO20260630001').first);
    await tester.tap(find.text('SO20260630001').first);
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('finance-save-button')), findsNothing);
    expect(
        find.byKey(const ValueKey('finance-logistics-no-field')), findsNothing);
    expect(apiClient.financePatchPaths, isEmpty);

    await _tapFilterChip(tester, '提成明细');
    expect(find.byKey(const ValueKey('finance-commission-export-button')),
        findsOneWidget);
    expect(
      find.byKey(
        const ValueKey('finance-commission-manual-amount-commission-taster-1'),
      ),
      findsNothing,
    );
    expect(
      find.byKey(
        const ValueKey('finance-commission-confirm-commission-taster-1'),
      ),
      findsNothing,
    );

    await _tapFilterChip(tester, '返积分汇总');
    expect(find.byKey(const ValueKey('finance-summary-export-button')),
        findsOneWidget);
    expect(
      find.byKey(const ValueKey('finance-summary-edit-group-summary-1')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('finance-summary-confirm-group-summary-1')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('finance-summary-refresh-group-summary-1')),
      findsNothing,
    );
  });
}

Future<void> _pumpFinanceQuery(
  WidgetTester tester,
  _FakeApiClient apiClient, {
  UserRole role = UserRole.finance,
  Directory? documentsDirectory,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: FinanceQueryPage(
          apiClient: apiClient,
          token: 'test-token',
          role: role,
          documentsDirectoryProvider: documentsDirectory == null
              ? null
              : () async => documentsDirectory,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _tapFilterChip(WidgetTester tester, String label) async {
  final chip = find.widgetWithText(FilterChip, label);
  await tester.ensureVisible(chip);
  await tester.pump();
  await tester.tap(chip);
  await tester.pumpAndSettle();
}

Future<void> _selectDropdownValue(
  WidgetTester tester, {
  required Key key,
  required String label,
}) async {
  final dropdown = find.byKey(key);
  await tester.ensureVisible(dropdown);
  await tester.tap(dropdown);
  await tester.pumpAndSettle();
  await tester.tap(find.text(label).last);
  await tester.pumpAndSettle();
}

Future<void> _deleteDirectoryWithRetry(Directory directory) async {
  for (var index = 0; index < 5; index += 1) {
    try {
      if (await directory.exists()) {
        await directory.delete(recursive: true);
      }
      return;
    } on FileSystemException {
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
  }
  if (await directory.exists()) {
    try {
      await directory.delete(recursive: true);
    } on FileSystemException {
      // Best-effort cleanup for Windows tests where file handles may linger.
    }
  }
}

void _pressIconButton(WidgetTester tester, Key key) {
  final button = tester.widget<IconButton>(find.byKey(key));
  button.onPressed?.call();
}

void _pressTextButton(WidgetTester tester, Key key) {
  final button = tester.widget<TextButton>(find.byKey(key));
  button.onPressed?.call();
}

void _pressFilledButton(WidgetTester tester, Key key) {
  final button = tester.widget<FilledButton>(find.byKey(key));
  button.onPressed?.call();
}

class _FakeApiClient extends ApiClient {
  _FakeApiClient({
    this.failFinancePatch = false,
    this.commissionListError,
    this.downloadError,
  }) : super(baseUrl: 'http://127.0.0.1:3000');

  final bool failFinancePatch;
  ApiException? commissionListError;
  ApiException? downloadError;
  final List<String> financeWorkbenchPaths = <String>[];
  final List<String> financePatchPaths = <String>[];
  final List<String> afterSalesConfirmPaths = <String>[];
  final List<String> commissionRecordPaths = <String>[];
  final List<String> commissionDetailPaths = <String>[];
  final List<String> commissionPatchPaths = <String>[];
  final List<String> summaryListPaths = <String>[];
  final List<String> summaryDetailPaths = <String>[];
  final List<String> summaryPatchPaths = <String>[];
  final List<String> summaryRefreshPaths = <String>[];
  final List<String> downloadPaths = <String>[];
  Map<String, dynamic>? lastFinanceBody;
  Map<String, dynamic>? lastAfterSalesConfirmBody;
  Map<String, dynamic>? lastCommissionPatchBody;
  Map<String, dynamic>? lastSummaryPatchBody;
  String? lastDownloadDefaultFileName;
  Completer<void>? downloadGate;

  String logisticsNo = 'SF123456789';
  int logisticsFeeCents = 1800;
  bool invoiceIssued = false;
  String financeRemark = '待核对运费';
  bool afterSalesConfirmed = false;
  int tasterCommissionAmountCents = 5000;
  bool tasterCommissionConfirmed = false;
  bool summaryDailyRebatePaid = false;
  bool summaryMonthlyRebatePaid = false;
  bool summaryAgencyDeductionConfirmed = false;
  bool summaryGuideInfoSent = false;
  bool summaryTravelAgencyInfoSent = false;
  String summaryNotes = 'test summary note';

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    if (path.startsWith('/api/finance/workbench')) {
      financeWorkbenchPaths.add(path);
      return {
        'data': {
          'workbench': {
            'metrics': {
              'travelGroupCount': 1,
              'orderCount': 1,
              'grossSalesAmountCents': 79800,
              'salesAmountCents': 79800,
              'refundAmountCents': afterSalesConfirmed ? 1200 : 0,
              'pendingAfterSalesRefundAmountCents':
                  afterSalesConfirmed ? 0 : 1200,
              'legacyRefundOrderAmountCents': 0,
              'netSalesAmountCents': afterSalesConfirmed ? 78600 : 79800,
              'logisticsFeeCents': logisticsFeeCents,
              'pendingInvoiceCount': invoiceIssued ? 0 : 1,
              'pendingCustomerMarkCount': 1,
              'pendingTravelGroupMarkCount': 0,
              'pendingAfterSalesConfirmCount': afterSalesConfirmed ? 0 : 1,
              'cashOnDeliveryAmountCents': 10000,
            },
            'recentOrders': [
              _orderJson(
                logisticsNo: logisticsNo,
                logisticsFeeCents: logisticsFeeCents,
                invoiceIssued: invoiceIssued,
                financeRemark: financeRemark,
              ),
            ],
            'pendingAfterSales':
                afterSalesConfirmed ? const [] : [_afterSalesJson()],
            'pendingMarks': [
              {
                'type': 'customer',
                'reason': 'customer_unmarked',
                'customer': {
                  'id': 'customer-1',
                  'name': '张女士',
                  'phone': '13800001111',
                  'financeMark': false,
                },
                'travelGroup': null,
                'orderCount': 1,
                'latestOrder': _orderJson(
                  logisticsNo: logisticsNo,
                  logisticsFeeCents: logisticsFeeCents,
                  invoiceIssued: invoiceIssued,
                  financeRemark: financeRemark,
                ),
              },
            ],
            'pendingLogistics': [
              {
                'order': _orderJson(
                  logisticsNo: logisticsNo,
                  logisticsFeeCents: logisticsFeeCents,
                  invoiceIssued: invoiceIssued,
                  financeRemark: financeRemark,
                ),
                'reasons': invoiceIssued
                    ? ['missing_logistics_no', 'missing_logistics_fee']
                    : [
                        'missing_logistics_no',
                        'missing_logistics_fee',
                        'pending_invoice',
                      ],
              },
            ],
          },
        },
      };
    }

    if (path == '/api/commission-records/commission-taster-1') {
      commissionDetailPaths.add(path);
      return {
        'data': {
          'commissionRecord': _commissionRecordJson(
            amountCents: tasterCommissionAmountCents,
            isConfirmed: tasterCommissionConfirmed,
          ),
        },
      };
    }

    if (path.startsWith('/api/commission-records')) {
      commissionRecordPaths.add(path);
      if (commissionListError != null) {
        throw commissionListError!;
      }
      return {
        'data': {
          'commissionRecords': [
            _commissionRecordJson(
              amountCents: tasterCommissionAmountCents,
              isConfirmed: tasterCommissionConfirmed,
            ),
          ],
        },
      };
    }

    if (path == '/api/travel-group-finance-summaries/group-summary-1') {
      summaryDetailPaths.add(path);
      return {
        'data': {
          'travelGroupFinanceSummary': _summaryJson(
            dailyRebatePaid: summaryDailyRebatePaid,
            monthlyRebatePaid: summaryMonthlyRebatePaid,
            agencyDeductionConfirmed: summaryAgencyDeductionConfirmed,
            guideInfoSent: summaryGuideInfoSent,
            travelAgencyInfoSent: summaryTravelAgencyInfoSent,
            notes: summaryNotes,
          ),
        },
      };
    }

    if (path.startsWith('/api/travel-group-finance-summaries')) {
      summaryListPaths.add(path);
      return {
        'data': {
          'travelGroupFinanceSummaries': [
            _summaryJson(
              dailyRebatePaid: summaryDailyRebatePaid,
              monthlyRebatePaid: summaryMonthlyRebatePaid,
              agencyDeductionConfirmed: summaryAgencyDeductionConfirmed,
              guideInfoSent: summaryGuideInfoSent,
              travelAgencyInfoSent: summaryTravelAgencyInfoSent,
              notes: summaryNotes,
            ),
          ],
        },
      };
    }

    throw StateError('Unexpected GET $path');
  }

  @override
  Future<ApiDownloadedFile> getBytes(
    String path, {
    required String defaultFileName,
    String? token,
  }) async {
    downloadPaths.add(path);
    lastDownloadDefaultFileName = defaultFileName;
    if (downloadGate != null) {
      await downloadGate!.future;
    }
    if (downloadError != null) {
      throw downloadError!;
    }
    return ApiDownloadedFile(
      bytes: Uint8List.fromList(<int>[0x50, 0x4B, 0x03, 0x04]),
      fileName: 'backend-$defaultFileName',
      contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }

  @override
  Future<Map<String, dynamic>> patchJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    if (path == '/api/sales-orders/order-1/finance') {
      financePatchPaths.add(path);
      lastFinanceBody = Map<String, dynamic>.from(body ?? {});
      if (failFinancePatch) {
        throw const ApiException(
          statusCode: 400,
          code: 'INVALID_LOGISTICS_FEE',
          message: '运费不能小于 0',
        );
      }
      logisticsNo = '${body?['logisticsNo'] ?? ''}';
      logisticsFeeCents = body?['logisticsFeeCents'] is int
          ? body!['logisticsFeeCents'] as int
          : logisticsFeeCents;
      invoiceIssued = body?['invoiceIssued'] == true;
      financeRemark = '${body?['financeRemark'] ?? ''}';
      return {
        'data': {
          'salesOrder': _orderJson(
            logisticsNo: logisticsNo,
            logisticsFeeCents: logisticsFeeCents,
            invoiceIssued: invoiceIssued,
            financeRemark: financeRemark,
          ),
        },
      };
    }

    if (path == '/api/after-sales-orders/after-sales-1/finance-confirm') {
      afterSalesConfirmPaths.add(path);
      lastAfterSalesConfirmBody = Map<String, dynamic>.from(body ?? {});
      afterSalesConfirmed = body?['financeConfirmed'] == true;
      return {
        'data': {
          'afterSalesOrder': _afterSalesJson(
            financeConfirmed: afterSalesConfirmed,
          ),
        },
      };
    }

    if (path == '/api/commission-records/commission-taster-1/manual-amount') {
      commissionPatchPaths.add(path);
      lastCommissionPatchBody = Map<String, dynamic>.from(body ?? {});
      tasterCommissionAmountCents =
          body?['amountCents'] is int ? body!['amountCents'] as int : 0;
      tasterCommissionConfirmed = false;
      return {
        'data': {
          'commissionRecord': _commissionRecordJson(
            amountCents: tasterCommissionAmountCents,
            isConfirmed: tasterCommissionConfirmed,
          ),
        },
      };
    }

    if (path == '/api/commission-records/commission-taster-1/confirm') {
      commissionPatchPaths.add(path);
      lastCommissionPatchBody = Map<String, dynamic>.from(body ?? {});
      tasterCommissionConfirmed = body?['isConfirmed'] == true;
      return {
        'data': {
          'commissionRecord': _commissionRecordJson(
            amountCents: tasterCommissionAmountCents,
            isConfirmed: tasterCommissionConfirmed,
          ),
        },
      };
    }

    if (path == '/api/travel-group-finance-summaries/group-summary-1') {
      summaryPatchPaths.add(path);
      lastSummaryPatchBody = Map<String, dynamic>.from(body ?? {});
      summaryGuideInfoSent = body?['guideInfoSent'] == true;
      summaryTravelAgencyInfoSent = body?['travelAgencyInfoSent'] == true;
      summaryNotes = '${body?['notes'] ?? ''}';
      return {
        'data': {
          'travelGroupFinanceSummary': _summaryJson(
            dailyRebatePaid: summaryDailyRebatePaid,
            monthlyRebatePaid: summaryMonthlyRebatePaid,
            agencyDeductionConfirmed: summaryAgencyDeductionConfirmed,
            guideInfoSent: summaryGuideInfoSent,
            travelAgencyInfoSent: summaryTravelAgencyInfoSent,
            notes: summaryNotes,
          ),
        },
      };
    }

    if (path ==
        '/api/travel-group-finance-summaries/group-summary-1/'
            'daily-rebate-paid') {
      summaryPatchPaths.add(path);
      lastSummaryPatchBody = Map<String, dynamic>.from(body ?? {});
      summaryDailyRebatePaid = body?['isPaid'] == true;
      return {
        'data': {
          'travelGroupFinanceSummary': _summaryJson(
            dailyRebatePaid: summaryDailyRebatePaid,
            monthlyRebatePaid: summaryMonthlyRebatePaid,
            agencyDeductionConfirmed: summaryAgencyDeductionConfirmed,
            guideInfoSent: summaryGuideInfoSent,
            travelAgencyInfoSent: summaryTravelAgencyInfoSent,
            notes: summaryNotes,
          ),
        },
      };
    }

    if (path ==
        '/api/travel-group-finance-summaries/group-summary-1/'
            'monthly-rebate-paid') {
      summaryPatchPaths.add(path);
      lastSummaryPatchBody = Map<String, dynamic>.from(body ?? {});
      summaryMonthlyRebatePaid = body?['isPaid'] == true;
      return {
        'data': {
          'travelGroupFinanceSummary': _summaryJson(
            dailyRebatePaid: summaryDailyRebatePaid,
            monthlyRebatePaid: summaryMonthlyRebatePaid,
            agencyDeductionConfirmed: summaryAgencyDeductionConfirmed,
            guideInfoSent: summaryGuideInfoSent,
            travelAgencyInfoSent: summaryTravelAgencyInfoSent,
            notes: summaryNotes,
          ),
        },
      };
    }

    if (path ==
        '/api/travel-group-finance-summaries/group-summary-1/'
            'agency-deduction-confirm') {
      summaryPatchPaths.add(path);
      lastSummaryPatchBody = Map<String, dynamic>.from(body ?? {});
      summaryAgencyDeductionConfirmed = body?['isConfirmed'] == true;
      return {
        'data': {
          'travelGroupFinanceSummary': _summaryJson(
            dailyRebatePaid: summaryDailyRebatePaid,
            monthlyRebatePaid: summaryMonthlyRebatePaid,
            agencyDeductionConfirmed: summaryAgencyDeductionConfirmed,
            guideInfoSent: summaryGuideInfoSent,
            travelAgencyInfoSent: summaryTravelAgencyInfoSent,
            notes: summaryNotes,
          ),
        },
      };
    }

    throw StateError('Unexpected PATCH $path');
  }

  @override
  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    if (path == '/api/travel-group-finance-summaries/group-summary-1/refresh') {
      summaryRefreshPaths.add(path);
      return {
        'data': {
          'travelGroupFinanceSummary': _summaryJson(
            dailyRebatePaid: summaryDailyRebatePaid,
            monthlyRebatePaid: summaryMonthlyRebatePaid,
            agencyDeductionConfirmed: summaryAgencyDeductionConfirmed,
            guideInfoSent: summaryGuideInfoSent,
            travelAgencyInfoSent: summaryTravelAgencyInfoSent,
            notes: summaryNotes,
          ),
          'amountChanged': true,
          'agencyDeductionConfirmationReset': false,
        },
      };
    }

    throw StateError('Unexpected POST $path');
  }
}

Map<String, dynamic> _commissionRecordJson({
  required int amountCents,
  required bool isConfirmed,
}) {
  return {
    'id': 'commission-taster-1',
    'salesOrderId': 'order-commission-1',
    'travelGroupId': 'group-commission-1',
    'targetType': 'taster_commission',
    'targetUserId': 'taster-1',
    'salesOrderNo': 'SO-COMMISSION-001',
    'salesOrder': {
      'id': 'order-commission-1',
      'orderNo': 'SO-COMMISSION-001',
      'orderDate': '2026-07-03',
      'status': 'valid',
      'customerName': 'Smoke Customer',
    },
    'travelGroup': {
      'id': 'group-commission-1',
      'groupNo': 'TG-COMMISSION-001',
      'visitDate': '2026-07-03',
      'travelAgency': 'Smoke Agency',
      'guideName': 'Smoke Guide',
      'tasterId': 'taster-1',
      'tasterName': 'Smoke Taster',
      'financeMark': true,
    },
    'customer': {'id': 'customer-commission-1', 'name': 'Smoke Customer'},
    'targetUser': {
      'id': 'taster-1',
      'name': 'Smoke Taster',
      'username': 'smoke_taster',
      'role': 'taster',
    },
    'agencyName': 'Smoke Agency',
    'grossAmountCents': 100000,
    'confirmedRefundAmountCents': 10000,
    'baseAmountCents': 90000,
    'deductionAmountCents': 0,
    'rateSnapshot': null,
    'amountCents': amountCents,
    'pointsCents': 0,
    'manualInput': true,
    'isConfirmed': isConfirmed,
    'confirmedBy': isConfirmed
        ? {
            'id': 'finance-1',
            'name': 'Smoke Finance',
            'username': 'finance',
            'role': 'finance',
          }
        : null,
    'confirmedAt': isConfirmed ? '2026-07-03T10:00:00.000Z' : null,
    'calculationVersion': 'stage7-v1',
    'calculationNote': 'test calculation note with taster manual amount',
    'calculationNoteSummary': 'test calculation note',
    'ruleSnapshot': {
      'manualInput': true,
    },
    'sourceSnapshot': {
      'warnings': ['missing_outreach_user', 'unconfirmed_refund'],
      'unconfirmedRefundSummary': {'count': 1, 'amountCents': 1200},
      'salesOrder': {'id': 'order-commission-1'},
    },
  };
}

Map<String, dynamic> _summaryJson({
  required bool dailyRebatePaid,
  required bool monthlyRebatePaid,
  required bool agencyDeductionConfirmed,
  required bool guideInfoSent,
  required bool travelAgencyInfoSent,
  required String notes,
}) {
  final paidRebateCents =
      (dailyRebatePaid ? 6000 : 0) + (monthlyRebatePaid ? 4000 : 0);
  return {
    'id': 'summary-1',
    'travelGroupId': 'group-summary-1',
    'travelGroup': {
      'id': 'group-summary-1',
      'groupNo': 'TG-SUMMARY-001',
      'visitDate': '2026-07-03',
      'travelAgency': 'Smoke Agency',
      'guideName': 'Smoke Guide',
      'licensePlate': '贵A·12345',
      'guestCount': 18,
      'tasterId': 'taster-1',
      'tasterName': 'Smoke Taster',
      'financeMark': true,
    },
    'totalSalesAmountCents': 100000,
    'totalCashOnDeliveryCents': 20000,
    'totalPaidDepositCents': 80000,
    'confirmedRefundAmountCents': 10000,
    'effectiveSalesAmountCents': 90000,
    'totalAgencyDeductionCents': 12000,
    'agencyDeductionConfirmed': agencyDeductionConfirmed,
    'agencyDeductionConfirmedBy': agencyDeductionConfirmed
        ? {
            'id': 'finance-1',
            'name': 'Smoke Finance',
            'username': 'finance',
            'role': 'finance',
          }
        : null,
    'agencyDeductionConfirmedAt':
        agencyDeductionConfirmed ? '2026-07-03T10:00:00.000Z' : null,
    'totalAgencyNetAmountCents': 78000,
    'totalDailyRebateCents': 6000,
    'totalMonthlyRebateCents': 4000,
    'paidRebateCents': paidRebateCents,
    'unpaidRebateCents': 10000 - paidRebateCents,
    'dailyRebatePaid': dailyRebatePaid,
    'dailyRebatePaidBy': dailyRebatePaid
        ? {
            'id': 'finance-1',
            'name': 'Smoke Finance',
            'username': 'finance',
            'role': 'finance',
          }
        : null,
    'dailyRebatePaidAt': dailyRebatePaid ? '2026-07-03T11:00:00.000Z' : null,
    'monthlyRebatePaid': monthlyRebatePaid,
    'monthlyRebatePaidBy': monthlyRebatePaid
        ? {
            'id': 'finance-1',
            'name': 'Smoke Finance',
            'username': 'finance',
            'role': 'finance',
          }
        : null,
    'monthlyRebatePaidAt':
        monthlyRebatePaid ? '2026-07-03T12:00:00.000Z' : null,
    'notes': notes,
    'guideInfoSent': guideInfoSent,
    'travelAgencyInfoSent': travelAgencyInfoSent,
    'calculationVersion': 'stage7-v1',
    'sourceSnapshot': {
      'orders': [
        {
          'salesOrderId': 'order-summary-1',
          'orderNo': 'SO-SUMMARY-001',
          'customerName': 'Smoke Customer',
          'totalAmountCents': 100000,
          'confirmedRefundAmountCents': 10000,
          'effectiveSalesAmountCents': 90000,
        },
      ],
      'commissionRecords': [
        {
          'id': 'daily-rebate-1',
          'targetType': 'agency_daily_rebate',
          'pointsCents': 6000,
          'calculationNoteSummary': 'test daily rebate',
        },
        {
          'id': 'monthly-rebate-1',
          'targetType': 'agency_monthly_rebate',
          'pointsCents': 4000,
          'calculationNoteSummary': 'test monthly rebate',
        },
      ],
    },
    'updatedBy': {
      'id': 'finance-1',
      'name': 'Smoke Finance',
      'username': 'finance',
      'role': 'finance',
    },
  };
}

Map<String, dynamic> _orderJson({
  required String logisticsNo,
  required int logisticsFeeCents,
  required bool invoiceIssued,
  required String financeRemark,
}) {
  return {
    'id': 'order-1',
    'orderNo': 'SO20260630001',
    'orderType': 'travel_group',
    'orderDate': '2026-06-30',
    'customerId': 'customer-1',
    'customer': _customerJson(),
    'customerName': '张女士',
    'customerPhone': '13800001111',
    'province': '贵州省',
    'city': '贵阳市',
    'district': '观山湖区',
    'address': '测试路 1 号',
    'travelGroupId': 'group-1',
    'travelGroup': _travelGroupJson(),
    'salesFormNo': 'XS-001',
    'totalAmountCents': 79800,
    'cashOnDeliveryAmountCents': 10000,
    'status': 'valid',
    'deliverySummary': 'shipping',
    'packingStatus': 'pending',
    'logisticsMethod': '顺丰',
    'packageCount': 2,
    'warehouseRemark': '注意防震',
    'logisticsNo': logisticsNo,
    'logisticsFeeCents': logisticsFeeCents,
    'invoiceRequired': true,
    'invoiceIssued': invoiceIssued,
    'financeRemark': financeRemark,
    'financeMark': false,
    'salesUserId': 'sales-1',
    'items': [
      {
        'id': 'item-1',
        'salesOrderId': 'order-1',
        'productName': '酱香珍藏',
        'quantity': 2,
        'unitPriceCents': 39900,
        'subtotalCents': 79800,
        'deliveryType': 'shipping',
        'notes': '礼盒装',
        'sortOrder': 1,
      },
    ],
  };
}

Map<String, dynamic> _customerJson() {
  return {
    'id': 'customer-1',
    'name': '张女士',
    'phone': '13800001111',
    'province': '贵州省',
    'city': '贵阳市',
    'district': '观山湖区',
    'address': '测试路 1 号',
    'financeMark': true,
    'markedById': null,
    'markedAt': null,
    'notes': null,
    'createdById': null,
    'updatedById': null,
    'createdAt': null,
    'updatedAt': null,
  };
}

Map<String, dynamic> _travelGroupJson() {
  return {
    'id': 'group-1',
    'kind': 'travel',
    'groupNo': 'TG20260630001',
    'visitDate': '2026-06-30',
    'travelAgency': '测试旅行社',
    'guideName': '李导',
    'guestCount': 20,
    'status': 'unmarked',
    'financeMark': true,
    'tastingItems': const [],
    'salesOrders': const [],
    'orderSummary': const {
      'orderCount': 0,
      'totalAmountCents': 0,
      'cashOnDeliveryAmountCents': 0,
    },
  };
}

Map<String, dynamic> _afterSalesJson({bool financeConfirmed = false}) {
  return {
    'id': 'after-sales-1',
    'afterSalesNo': 'AS20260702001',
    'salesOrderId': 'order-1',
    'salesOrder': _orderJson(
      logisticsNo: 'SF123456789',
      logisticsFeeCents: 1800,
      invoiceIssued: false,
      financeRemark: '待核对运费',
    ),
    'customerId': 'customer-1',
    'customer': _customerJson(),
    'issueType': 'quality_issue',
    'actionType': 'refund',
    'description': 'smoke 待确认退款',
    'resolution': 'smoke 退款 12 元',
    'refundAmountCents': 1200,
    'status': 'waiting_refund',
    'financeConfirmed': financeConfirmed,
    'createdAt': '2026-07-02T08:00:00.000Z',
    'updatedAt': '2026-07-02T08:00:00.000Z',
  };
}
