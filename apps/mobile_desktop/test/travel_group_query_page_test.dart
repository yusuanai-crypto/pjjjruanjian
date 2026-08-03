import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_group_attachments/downloaded_file_service.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_group_query/travel_group_query_page.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_groups/tasting_items_editor.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets('sales travel group query is read-only', (tester) async {
    final apiClient = _FakeApiClient();

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TravelGroupQueryPage(
            apiClient: apiClient,
            token: 'test-token',
            role: UserRole.sales,
            currentUserId: 'sales-1',
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();
    await _openDetailDialog(tester);

    expect(find.widgetWithText(OutlinedButton, '编辑'), findsNothing);
    expect(apiClient.lastPatchPath, isNull);
  });

  testWidgets('uses management title and ID based taster quick filters',
      (tester) async {
    final apiClient = _FakeApiClient(
      tasterId: 'actor-1',
      liaisonTasterId: 'liaison-1',
    );

    await _pumpQueryPage(
      tester,
      apiClient: apiClient,
      role: UserRole.taster,
      currentUserId: 'actor-1',
    );

    expect(find.text('旅行团管理'), findsOneWidget);
    expect(find.text('旅行团查询'), findsNothing);
    expect(find.text('可查看旅行团'), findsOneWidget);
    expect(find.text('我对接的'), findsOneWidget);
    expect(find.text('我接的团'), findsOneWidget);
    expect(find.text('我参与的'), findsNothing);
    expect(find.text('我负责品鉴的'), findsNothing);
    expect(find.text('对接：赵对接'), findsOneWidget);
    expect(find.text('品鉴：王莉'), findsOneWidget);
    expect(find.text('预计：09:10'), findsOneWidget);
    expect(find.text('实际：9:25'), findsOneWidget);
    expect(find.byKey(const ValueKey('旅行社-__all__-2')), findsOneWidget);
    expect(find.byKey(const ValueKey('财务标记-__all__-3')), findsNothing);
    expect(find.byKey(const ValueKey('待处理状态-__all__-5')), findsNothing);

    var query = _travelGroupQuery(apiClient.travelGroupGetPaths.first);
    expect(query.containsKey('tasterId'), isFalse);
    expect(query.containsKey('liaisonTasterId'), isFalse);
    expect(query.containsKey('financeMark'), isFalse);
    expect(query.containsKey('pendingStatus'), isFalse);
    expect(query.containsKey('dateFrom'), isFalse);
    expect(query.containsKey('dateTo'), isFalse);

    await tester.tap(find.byKey(const ValueKey('旅行社-__all__-2')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('876').last);
    await tester.pumpAndSettle();
    query = _travelGroupQuery(apiClient.travelGroupGetPaths.last);
    expect(query['travelAgency'], '876');
    expect(query.containsKey('financeMark'), isFalse);
    expect(query.containsKey('pendingStatus'), isFalse);

    await tester.tap(find.text('我对接的'));
    await tester.pumpAndSettle();
    query = _travelGroupQuery(apiClient.travelGroupGetPaths.last);
    expect(query['liaisonTasterId'], 'actor-1');
    expect(query.containsKey('tasterId'), isFalse);
    expect(query['dateFrom'], _todayDate());

    await tester.tap(find.text('我接的团'));
    await tester.pumpAndSettle();
    query = _travelGroupQuery(apiClient.travelGroupGetPaths.last);
    expect(query['tasterId'], 'actor-1');
    expect(query.containsKey('liaisonTasterId'), isFalse);
  });

  testWidgets('can switch travel group query to all dates', (tester) async {
    final apiClient = _FakeApiClient();

    await _pumpQueryPage(
      tester,
      apiClient: apiClient,
      role: UserRole.sales,
      currentUserId: 'sales-1',
    );

    var query = _travelGroupQuery(apiClient.travelGroupGetPaths.last);
    expect(query.containsKey('dateFrom'), isTrue);
    expect(query.containsKey('dateTo'), isTrue);

    await tester.tap(find.text('全部日期').last);
    await tester.pumpAndSettle();

    query = _travelGroupQuery(apiClient.travelGroupGetPaths.last);
    expect(query.containsKey('dateFrom'), isFalse);
    expect(query.containsKey('dateTo'), isFalse);
    expect(find.text('全部日期'), findsWidgets);
  });

  testWidgets('license plate search hint and request reuse keyword parameter',
      (tester) async {
    final apiClient = _FakeApiClient();

    await _pumpQueryPage(
      tester,
      apiClient: apiClient,
      role: UserRole.sales,
      currentUserId: 'sales-1',
    );

    final searchField = find.byWidgetPredicate(
      (widget) =>
          widget is TextField &&
          widget.decoration?.hintText?.contains('车牌号') == true,
    );
    expect(searchField, findsOneWidget);

    await tester.enterText(searchField, '  贵A12345  ');
    final searchButton = find.widgetWithText(FilledButton, '查询');
    await tester.ensureVisible(searchButton);
    await tester.tap(searchButton);
    await tester.pumpAndSettle();

    final query = _travelGroupQuery(apiClient.travelGroupGetPaths.last);
    expect(query['keyword'], '贵A12345');
    expect(query.containsKey('licensePlate'), isFalse);
  });

  testWidgets('unrelated taster can view today unarrived group but cannot edit',
      (tester) async {
    final apiClient = _FakeApiClient(
      tasterId: 'other-taster',
      liaisonTasterId: 'other-liaison',
      arrivalTime: null,
    );

    await _pumpQueryPage(
      tester,
      apiClient: apiClient,
      role: UserRole.taster,
      currentUserId: 'actor-1',
    );
    await _openDetailDialog(tester);

    expect(find.text('品鉴师只读'), findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, '编辑'), findsNothing);
    expect(
      find.text('只有该团的接待品鉴师或对接品鉴师可以修改。'),
      findsOneWidget,
    );
    expect(find.text('对接品鉴师'), findsOneWidget);
    expect(find.text('重点客户信息'), findsOneWidget);
    expect(find.text('预计进店时间'), findsOneWidget);
    expect(find.text('实际进店时间'), findsOneWidget);
  });

  testWidgets('assigned taster edits only common customer fields',
      (tester) async {
    final apiClient = _FakeApiClient(
      tasterId: 'actor-1',
      liaisonTasterId: 'other-liaison',
    );

    await _pumpQueryPage(
      tester,
      apiClient: apiClient,
      role: UserRole.taster,
      currentUserId: 'actor-1',
    );
    await _openEditDialog(tester);

    final dialog = find.byType(AlertDialog);
    expect(_dialogText(dialog, '车牌号'), findsOneWidget);
    expect(_dialogText(dialog, '大人人数'), findsOneWidget);
    expect(_dialogText(dialog, '小孩人数'), findsOneWidget);
    expect(_dialogText(dialog, '人数'), findsNothing);
    expect(_dialogText(dialog, '客源地'), findsOneWidget);
    expect(_dialogText(dialog, '年龄描述'), findsOneWidget);
    expect(_dialogText(dialog, '是否提及飞天'), findsOneWidget);
    expect(_dialogText(dialog, '前站出单情况'), findsOneWidget);
    expect(_dialogText(dialog, '重点客户信息'), findsOneWidget);
    expect(_dialogText(dialog, '进店日期'), findsNothing);
    expect(_dialogText(dialog, '导游'), findsNothing);
    expect(_dialogText(dialog, '预计进店时间'), findsOneWidget);
    expect(_dialogText(dialog, '品鉴馆号'), findsNothing);
    expect(_dialogText(dialog, '实际进店时间'), findsNothing);
    expect(_dialogText(dialog, '团型'), findsNothing);
    expect(_dialogText(dialog, '香烟费用（元）'), findsNothing);
  });

  testWidgets('reception taster sees tasting item detail without editor',
      (tester) async {
    final apiClient = _FakeApiClient(
      tasterId: 'actor-1',
      liaisonTasterId: 'other-liaison',
    );

    await _pumpQueryPage(
      tester,
      apiClient: apiClient,
      role: UserRole.taster,
      currentUserId: 'actor-1',
    );
    await _openDetailDialog(tester);

    expect(find.textContaining('2 '), findsOneWidget);
    expect(find.byType(TastingItemsEditor), findsNothing);
  });

  testWidgets('liaison taster sees tasting item detail', (tester) async {
    final apiClient = _FakeApiClient(
      tasterId: 'other-taster',
      liaisonTasterId: 'actor-1',
    );

    await _pumpQueryPage(
      tester,
      apiClient: apiClient,
      role: UserRole.taster,
      currentUserId: 'actor-1',
    );
    await _openDetailDialog(tester);

    expect(find.textContaining('2 '), findsOneWidget);
    expect(find.byType(TastingItemsEditor), findsNothing);
  });

  testWidgets('liaison taster cannot edit date or guide', (tester) async {
    final apiClient = _FakeApiClient(
      tasterId: 'actor-1',
      liaisonTasterId: 'actor-1',
    );

    await _pumpQueryPage(
      tester,
      apiClient: apiClient,
      role: UserRole.taster,
      currentUserId: 'actor-1',
    );
    await _openEditDialog(tester);

    final dialog = find.byType(AlertDialog);
    expect(_dialogText(dialog, '进店日期'), findsNothing);
    expect(_dialogText(dialog, '导游'), findsNothing);
    expect(_dialogText(dialog, '预计进店时间'), findsOneWidget);
    expect(_dialogText(dialog, '客源地'), findsOneWidget);
    expect(_dialogText(dialog, '旅行社'), findsNothing);
    expect(_dialogText(dialog, '品鉴馆号'), findsNothing);
    expect(_dialogText(dialog, '实际进店时间'), findsNothing);
    expect(_dialogText(dialog, '团型'), findsNothing);

    expect(
      find.descendant(
        of: dialog,
        matching: find.byIcon(Icons.access_time_rounded),
      ),
      findsWidgets,
    );
    await tester.tap(find.widgetWithText(FilledButton, '保存修改'));
    await tester.pumpAndSettle();

    expect(apiClient.lastPatchBody?['expectedArrivalTime'], '09:10');
    expect(apiClient.lastPatchBody?['adultCount'], 20);
    expect(apiClient.lastPatchBody?['childCount'], 4);
    expect(apiClient.lastPatchBody?.containsKey('guestCount'), isFalse);
    expect(apiClient.lastPatchBody?.containsKey('travelAgency'), isFalse);
    expect(apiClient.lastPatchBody?.containsKey('groupNo'), isFalse);
    expect(apiClient.lastPatchBody?.containsKey('tastingRoomNo'), isFalse);
    expect(apiClient.lastPatchBody?.containsKey('arrivalTime'), isFalse);
    expect(apiClient.lastPatchBody?.containsKey('groupType'), isFalse);
  });

  testWidgets('front desk can maintain both taster assignments',
      (tester) async {
    final apiClient = _FakeApiClient();

    await _pumpQueryPage(
      tester,
      apiClient: apiClient,
      role: UserRole.frontDesk,
      currentUserId: 'front-1',
    );
    await _openEditDialog(tester);

    final dialog = find.byType(AlertDialog);
    expect(_dialogText(dialog, '品鉴师'), findsOneWidget);
    expect(_dialogText(dialog, '对接品鉴师'), findsOneWidget);
    expect(_dialogText(dialog, '预计进店时间'), findsNothing);
    expect(_dialogText(dialog, '香烟费用（元）'), findsOneWidget);

    final cigaretteField =
        find.byKey(const ValueKey('travel-group-edit-cigarette-fee'));
    await tester.ensureVisible(cigaretteField);
    await tester.enterText(cigaretteField, '20.50');
    await tester.tap(find.widgetWithText(FilledButton, '保存修改'));
    await tester.pumpAndSettle();

    expect(apiClient.lastPatchBody?['cigaretteFeeCents'], 2050);
    expect(apiClient.lastPatchBody?.containsKey('parkingFeeCents'), isFalse);
  });

  testWidgets('finance cannot see or submit cigarette fee', (tester) async {
    final apiClient = _FakeApiClient();

    await _pumpQueryPage(
      tester,
      apiClient: apiClient,
      role: UserRole.finance,
      currentUserId: 'finance-1',
    );
    await _openEditDialog(tester);

    final dialog = find.byType(AlertDialog);
    expect(_dialogText(dialog, '香烟费用（元）'), findsNothing);
    await tester.tap(find.widgetWithText(FilledButton, '保存修改'));
    await tester.pumpAndSettle();
    expect(apiClient.lastPatchBody?.containsKey('cigaretteFeeCents'), isFalse);
    expect(apiClient.lastPatchBody?.containsKey('parkingFeeCents'), isFalse);
  });

  testWidgets('future reception taster uses backend edit capability',
      (tester) async {
    final apiClient = _FakeApiClient(
      tasterId: 'actor-1',
      visitDate: _tomorrowDate(),
    );
    await _pumpQueryPage(
      tester,
      apiClient: apiClient,
      role: UserRole.taster,
      currentUserId: 'actor-1',
    );
    await _openDetailDialog(tester);

    expect(
      find.byKey(const ValueKey('travel-group-taster-read-only-reason')),
      findsNothing,
    );
    expect(find.widgetWithText(OutlinedButton, '编辑'), findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, '总结'), findsOneWidget);
    expect(find.widgetWithText(TextButton, '上传'), findsNWidgets(2));
  });

  testWidgets(
      'future liaison uses backend edit capability for all write entries',
      (tester) async {
    final apiClient = _FakeApiClient(
      tasterId: 'other-taster',
      liaisonTasterId: 'actor-1',
      visitDate: _tomorrowDate(),
      canEditByCurrentUser: true,
    );
    await _pumpQueryPage(
      tester,
      apiClient: apiClient,
      role: UserRole.taster,
      currentUserId: 'actor-1',
    );
    await _openDetailDialog(tester);

    expect(
      find.byKey(const ValueKey('travel-group-taster-read-only-reason')),
      findsNothing,
    );
    expect(find.widgetWithText(OutlinedButton, '编辑'), findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, '总结'), findsOneWidget);
    expect(find.widgetWithText(TextButton, '上传'), findsNWidgets(2));
  });

  testWidgets(
      'completed sales supplement makes every taster write entry read-only',
      (tester) async {
    final apiClient = _FakeApiClient(
      tasterId: 'other-taster',
      liaisonTasterId: 'actor-1',
      visitDate: _tomorrowDate(),
      departureTime: '16:30',
      lossStatus: 'RECORDED',
      canEditByCurrentUser: false,
      includeAttachment: true,
    );
    await _pumpQueryPage(
      tester,
      apiClient: apiClient,
      role: UserRole.taster,
      currentUserId: 'actor-1',
    );
    await _openDetailDialog(tester);

    expect(find.widgetWithText(OutlinedButton, '编辑'), findsNothing);
    expect(find.widgetWithText(OutlinedButton, '总结'), findsNothing);
    expect(find.widgetWithText(TextButton, '上传'), findsNothing);
    expect(find.widgetWithText(TextButton, '删除'), findsNothing);
    expect(
      find.text('销售已完成损耗与离店补录，品鉴师仅可查看。'),
      findsOneWidget,
    );
  });

  testWidgets(
      'unrelated taster gets relationship read-only reason regardless of date',
      (tester) async {
    final apiClient = _FakeApiClient(
      tasterId: 'other-taster',
      liaisonTasterId: 'other-liaison',
      visitDate: _yesterdayDate(),
      canEditByCurrentUser: false,
    );
    await _pumpQueryPage(
      tester,
      apiClient: apiClient,
      role: UserRole.taster,
      currentUserId: 'actor-1',
    );
    await _openDetailDialog(tester);

    expect(
      find.text('只有该团的接待品鉴师或对接品鉴师可以修改。'),
      findsOneWidget,
    );
    expect(find.textContaining('历史旅行团'), findsNothing);
    expect(find.textContaining('未来旅行团'), findsNothing);
    expect(find.widgetWithText(OutlinedButton, '编辑'), findsNothing);
  });

  testWidgets('assigned taster keeps writes after the historical edit count',
      (tester) async {
    final apiClient = _FakeApiClient(
      tasterId: 'actor-1',
      tasterEditCount: 7,
    );
    await _pumpQueryPage(
      tester,
      apiClient: apiClient,
      role: UserRole.taster,
      currentUserId: 'actor-1',
    );
    await _openDetailDialog(tester);

    expect(find.textContaining('共享剩余修改次数'), findsNothing);
    expect(find.textContaining('共享修改机会已用完'), findsNothing);
    expect(
      find.byKey(const ValueKey('travel-group-taster-edit-remaining')),
      findsNothing,
    );
    expect(find.widgetWithText(OutlinedButton, '编辑'), findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, '总结'), findsOneWidget);
    expect(find.widgetWithText(TextButton, '上传'), findsNWidgets(2));
  });

  testWidgets('liaison taster can confirm but unrelated taster cannot',
      (tester) async {
    final liaisonClient = _FakeApiClient(
      tasterId: 'other-taster',
      liaisonTasterId: 'actor-1',
      arrivalTime: null,
      entryStatus: 'pending_entry',
    );
    await _pumpQueryPage(
      tester,
      apiClient: liaisonClient,
      role: UserRole.taster,
      currentUserId: 'actor-1',
    );
    await _openDetailDialog(tester);
    expect(
      find.byKey(const ValueKey('confirm-travel-group-not-entered-button')),
      findsOneWidget,
    );

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();

    final unrelatedClient = _FakeApiClient(
      tasterId: 'other-taster',
      liaisonTasterId: 'other-liaison',
      arrivalTime: null,
      entryStatus: 'pending_entry',
    );
    await _pumpQueryPage(
      tester,
      apiClient: unrelatedClient,
      role: UserRole.taster,
      currentUserId: 'actor-1',
    );
    await _openDetailDialog(tester);
    expect(
      find.byKey(const ValueKey('confirm-travel-group-not-entered-button')),
      findsNothing,
    );
  });

  testWidgets('confirm uses second confirmation and keeps detail open',
      (tester) async {
    final apiClient = _FakeApiClient(
      arrivalTime: null,
      entryStatus: 'pending_entry',
    );
    await _pumpQueryPage(
      tester,
      apiClient: apiClient,
      role: UserRole.admin,
      currentUserId: 'admin-1',
    );
    await _openDetailDialog(tester);

    final confirmButton = find.byKey(
      const ValueKey('confirm-travel-group-not-entered-button'),
    );
    await tester.ensureVisible(confirmButton);
    await tester.tap(confirmButton);
    await tester.pumpAndSettle();

    expect(find.widgetWithText(AlertDialog, '确认未进店'), findsWidgets);
    expect(find.textContaining('TG20260629001'), findsWidgets);
    expect(find.textContaining('操作者'), findsOneWidget);
    expect(find.textContaining('确认时间'), findsWidgets);

    await tester.tap(
      find.byKey(
        const ValueKey(
          'confirm-travel-group-not-entered-dialog-submit',
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(apiClient.notEnteredPatchCalls, 1);
    expect(
      apiClient.lastPatchPath,
      '/api/travel-groups/group-1/not-entered',
    );
    expect(apiClient.lastPatchBody, {'confirmed': true});
    expect(find.byType(Dialog), findsOneWidget);
    expect(find.text('未进店'), findsOneWidget);
    expect(find.text('测试前台'), findsOneWidget);
    expect(confirmButton, findsNothing);
  });

  testWidgets('confirm request disables action and prevents duplicate calls',
      (tester) async {
    final apiClient = _FakeApiClient(
      arrivalTime: null,
      entryStatus: 'pending_entry',
    );
    apiClient.notEnteredCompleter = Completer<Map<String, dynamic>>();
    await _pumpQueryPage(
      tester,
      apiClient: apiClient,
      role: UserRole.admin,
      currentUserId: 'admin-1',
    );
    await _openDetailDialog(tester);

    final confirmButton = find.byKey(
      const ValueKey('confirm-travel-group-not-entered-button'),
    );
    await tester.tap(confirmButton);
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(
        const ValueKey(
          'confirm-travel-group-not-entered-dialog-submit',
        ),
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(apiClient.notEnteredPatchCalls, 1);
    expect(
      tester.widget<OutlinedButton>(confirmButton).onPressed,
      isNull,
    );
    expect(find.byType(CircularProgressIndicator), findsWidgets);
    await tester.tap(confirmButton, warnIfMissed: false);
    await tester.pump();
    expect(apiClient.notEnteredPatchCalls, 1);

    apiClient.notEnteredCompleter!.complete(
      apiClient._notEnteredResponse(true),
    );
    await tester.pumpAndSettle();
    expect(find.text('未进店'), findsOneWidget);
  });

  testWidgets('front desk can revoke and restore pending entry in open detail',
      (tester) async {
    final apiClient = _FakeApiClient(
      arrivalTime: null,
      entryStatus: 'not_entered',
      notEnteredConfirmedAt: '2026-07-29T02:30:00.000Z',
      notEnteredConfirmedById: 'front-1',
    );
    await _pumpQueryPage(
      tester,
      apiClient: apiClient,
      role: UserRole.frontDesk,
      currentUserId: 'front-1',
    );
    await _openDetailDialog(tester);

    final revokeButton = find.byKey(
      const ValueKey('revoke-travel-group-not-entered-button'),
    );
    await tester.tap(revokeButton);
    await tester.pumpAndSettle();
    expect(find.widgetWithText(AlertDialog, '撤销未进店'), findsWidgets);
    expect(find.textContaining('TG20260629001'), findsWidgets);
    await tester.tap(
      find.byKey(
        const ValueKey(
          'revoke-travel-group-not-entered-dialog-submit',
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(apiClient.lastPatchBody, {'confirmed': false});
    expect(find.byType(Dialog), findsOneWidget);
    expect(find.text('待进店'), findsOneWidget);
    expect(revokeButton, findsNothing);
    expect(
      find.byKey(const ValueKey('confirm-travel-group-not-entered-button')),
      findsOneWidget,
    );
  });

  testWidgets('entered state hides confirm and API failure preserves pending',
      (tester) async {
    final enteredClient = _FakeApiClient(
      arrivalTime: '09:25',
      entryStatus: 'entered',
    );
    await _pumpQueryPage(
      tester,
      apiClient: enteredClient,
      role: UserRole.admin,
      currentUserId: 'admin-1',
    );
    await _openDetailDialog(tester);
    expect(
      find.byKey(const ValueKey('confirm-travel-group-not-entered-button')),
      findsNothing,
    );

    final failingClient = _FakeApiClient(
      arrivalTime: null,
      entryStatus: 'pending_entry',
    )..failNotEntered = true;
    await _pumpQueryPage(
      tester,
      apiClient: failingClient,
      role: UserRole.admin,
      currentUserId: 'admin-1',
    );
    await _openDetailDialog(tester);
    final confirmButton = find.byKey(
      const ValueKey('confirm-travel-group-not-entered-button'),
    );
    await tester.tap(confirmButton);
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(
        const ValueKey(
          'confirm-travel-group-not-entered-dialog-submit',
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(Dialog), findsOneWidget);
    expect(find.text('待进店'), findsOneWidget);
    expect(confirmButton, findsOneWidget);
    expect(find.text('该旅行团已进店，不能确认未进店。'), findsWidgets);
  });

  testWidgets(
      'mobile download shows open-with action and reports external open failure',
      (tester) async {
    final downloadService = _QueryFakeDownloadedFileService();
    final apiClient = _FakeApiClient(includeAttachment: true);
    await _pumpQueryPage(
      tester,
      apiClient: apiClient,
      role: UserRole.admin,
      currentUserId: 'admin-1',
      downloadedFileService: downloadService,
    );
    await _openDetailDialog(tester);

    final downloadButton = find.widgetWithText(TextButton, '下载');
    await tester.ensureVisible(downloadButton);
    await tester.tap(downloadButton);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.text('附件已下载'), findsOneWidget);
    expect(find.text('用其他应用打开'), findsOneWidget);

    await tester.tap(find.text('用其他应用打开'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    expect(downloadService.openCalls, 1);
    expect(find.text('打开附件失败，请稍后重试。'), findsOneWidget);
  });
}

Future<void> _pumpQueryPage(
  WidgetTester tester, {
  required ApiClient apiClient,
  required UserRole role,
  required String currentUserId,
  DownloadedFileService? downloadedFileService,
}) async {
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pumpAndSettle();
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: TravelGroupQueryPage(
          apiClient: apiClient,
          token: 'test-token',
          role: role,
          currentUserId: currentUserId,
          downloadedFileService: downloadedFileService,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Finder _dialogText(Finder dialog, String text) {
  return find.descendant(of: dialog, matching: find.text(text));
}

Future<void> _openEditDialog(WidgetTester tester) async {
  if (find.widgetWithText(OutlinedButton, '编辑').evaluate().isEmpty) {
    await _openDetailDialog(tester);
  }
  final editButton = find.widgetWithText(OutlinedButton, '编辑');
  await tester.ensureVisible(editButton);
  await tester.pumpAndSettle();
  await tester.tap(editButton);
  await tester.pumpAndSettle();
}

Future<void> _openDetailDialog(WidgetTester tester) async {
  final groupTile = find.text('TG20260629001').first;
  await tester.ensureVisible(groupTile);
  await tester.pumpAndSettle();
  await tester.tap(groupTile);
  await tester.pumpAndSettle();
}

Map<String, String> _travelGroupQuery(String path) {
  return Uri.parse('http://localhost$path').queryParameters;
}

class _FakeApiClient extends ApiClient {
  _FakeApiClient({
    this.tasterId = 'taster-1',
    this.liaisonTasterId = 'liaison-1',
    this.visitDate,
    this.arrivalTime = '9:25',
    this.departureTime = '',
    this.lossStatus = 'PENDING',
    String? entryStatus,
    String? notEnteredConfirmedAt,
    String? notEnteredConfirmedById,
    this.canEditByCurrentUser,
    this.tasterEditCount = 0,
    this.includeAttachment = false,
  })  : _entryStatus = entryStatus,
        _notEnteredConfirmedAt = notEnteredConfirmedAt,
        _notEnteredConfirmedById = notEnteredConfirmedById,
        super(baseUrl: 'http://127.0.0.1:3000');

  final String? tasterId;
  final String? liaisonTasterId;
  final String? visitDate;
  final String? arrivalTime;
  final String? departureTime;
  final String lossStatus;
  final bool? canEditByCurrentUser;
  final int tasterEditCount;
  final bool includeAttachment;
  final List<String> travelGroupGetPaths = [];

  String? _entryStatus;
  String? _notEnteredConfirmedAt;
  String? _notEnteredConfirmedById;
  String? lastPatchPath;
  Map<String, dynamic>? lastPatchBody;
  int notEnteredPatchCalls = 0;
  bool failNotEntered = false;
  Completer<Map<String, dynamic>>? notEnteredCompleter;

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    if (path == '/api/products/options') {
      return {
        'data': {
          'products': const [
            {'id': 'product-1', 'name': '酱香珍藏', 'unit': '瓶'},
          ],
        },
      };
    }
    if (path.startsWith('/api/travel-groups')) {
      travelGroupGetPaths.add(path);
      return {
        'data': {
          'travelGroups': [
            _travelGroupJson(
              tasterId: tasterId,
              liaisonTasterId: liaisonTasterId,
              visitDate: visitDate,
              arrivalTime: arrivalTime,
              departureTime: departureTime,
              lossStatus: lossStatus,
              entryStatus: _entryStatus,
              notEnteredConfirmedAt: _notEnteredConfirmedAt,
              notEnteredConfirmedById: _notEnteredConfirmedById,
              canEditByCurrentUser: canEditByCurrentUser,
              tasterEditCount: tasterEditCount,
              includeAttachment: includeAttachment,
            ),
          ],
        },
      };
    }
    if (path.startsWith('/api/guides')) {
      return {
        'data': {
          'guides': [_guideJson()],
        },
      };
    }
    if (path.startsWith('/api/users/tasters')) {
      return {
        'data': {
          'tasters': [_tasterJson()],
        },
      };
    }
    throw StateError('Unexpected GET $path');
  }

  @override
  Future<Map<String, dynamic>> patchJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    lastPatchPath = path;
    lastPatchBody = body;
    if (path.endsWith('/not-entered')) {
      notEnteredPatchCalls += 1;
      if (failNotEntered) {
        throw const ApiException(
          statusCode: 409,
          code: 'TRAVEL_GROUP_ALREADY_ENTERED',
          message: '该旅行团已进店，不能确认未进店。',
        );
      }
      final pendingResponse = notEnteredCompleter;
      if (pendingResponse != null) {
        return pendingResponse.future;
      }
      final confirmed = body?['confirmed'] == true;
      _entryStatus = confirmed ? 'not_entered' : 'pending_entry';
      _notEnteredConfirmedAt = confirmed ? '2026-07-29T02:30:00.000Z' : null;
      _notEnteredConfirmedById = confirmed ? 'actor-1' : null;
      return _notEnteredResponse(confirmed);
    }
    return {
      'data': {
        'travelGroup': {
          ..._travelGroupJson(
            tasterId: tasterId,
            liaisonTasterId: liaisonTasterId,
            visitDate: visitDate,
            arrivalTime: arrivalTime,
            departureTime: departureTime,
            lossStatus: lossStatus,
            entryStatus: _entryStatus,
            notEnteredConfirmedAt: _notEnteredConfirmedAt,
            notEnteredConfirmedById: _notEnteredConfirmedById,
            canEditByCurrentUser: canEditByCurrentUser,
            tasterEditCount: tasterEditCount,
            includeAttachment: includeAttachment,
          ),
          ...?body,
        },
      },
    };
  }

  Map<String, dynamic> _notEnteredResponse(bool confirmed) {
    return {
      'data': {
        'travelGroup': _travelGroupJson(
          tasterId: tasterId,
          liaisonTasterId: liaisonTasterId,
          visitDate: visitDate,
          arrivalTime: arrivalTime,
          departureTime: departureTime,
          lossStatus: lossStatus,
          entryStatus: confirmed ? 'not_entered' : 'pending_entry',
          notEnteredConfirmedAt: confirmed ? '2026-07-29T02:30:00.000Z' : null,
          notEnteredConfirmedById: confirmed ? 'actor-1' : null,
          canEditByCurrentUser: canEditByCurrentUser,
          tasterEditCount: tasterEditCount,
          includeAttachment: includeAttachment,
        ),
      },
    };
  }

  @override
  Future<ApiDownloadedFile> getBytes(
    String path, {
    required String defaultFileName,
    String? token,
  }) async {
    return ApiDownloadedFile(
      bytes: Uint8List.fromList('%PDF-1.7'.codeUnits),
      fileName: defaultFileName,
      contentType: 'application/pdf',
    );
  }
}

Map<String, dynamic> _guideJson() {
  return {
    'id': 'guide-1',
    'name': '李导',
    'phone': '13900001111',
    'isActive': true,
  };
}

Map<String, dynamic> _tasterJson() {
  return {
    'id': 'taster-1',
    'name': '王莉',
    'username': 'taster_wang',
  };
}

Map<String, dynamic> _travelGroupJson({
  String? tasterId = 'taster-1',
  String? liaisonTasterId = 'liaison-1',
  String? visitDate,
  String? arrivalTime = '9:25',
  String? departureTime = '',
  String lossStatus = 'PENDING',
  String? entryStatus,
  String? notEnteredConfirmedAt,
  String? notEnteredConfirmedById,
  bool? canEditByCurrentUser,
  int tasterEditCount = 0,
  bool includeAttachment = false,
}) {
  final resolvedVisitDate = visitDate ?? _todayDate();
  final associated = tasterId == 'actor-1' || liaisonTasterId == 'actor-1';
  final resolvedCanEdit = canEditByCurrentUser ?? associated;
  return {
    'id': 'group-1',
    'kind': 'travel',
    'groupNo': 'TG20260629001',
    'visitDate': resolvedVisitDate,
    'travelAgency': '876',
    'licensePlate': '743',
    'guideId': 'guide-1',
    'guideName': '王莉',
    'guidePhone': '13900001111',
    'adultCount': 20,
    'childCount': 4,
    'guestCount': 24,
    'tastingRoomNo': '5',
    'tasterId': tasterId,
    'tasterName': '王莉',
    'liaisonTasterId': liaisonTasterId,
    'tasterEditCount': tasterEditCount,
    'tasterEditLimit': null,
    'tasterEditRemaining': null,
    'tasterEditUnlimited': true,
    'canEditByCurrentUser': resolvedCanEdit,
    'liaisonTasterName': '赵对接',
    'sourceRegion': '遵义',
    'ageInfo': '40-55 岁',
    'mentionedFeitian': true,
    'previousStopOrderStatus': '熊猫',
    'keyCustomerInfo': '重点客户两位',
    'keyCustomerPhotos': const [],
    'guestInfoAttachments': includeAttachment
        ? const [
            {
              'id': 'attachment-1',
              'category': 'guest_info',
              'originalName': '客人名单.pdf',
              'contentType': 'application/pdf',
              'size': 1024,
            },
          ]
        : const [],
    'expectedArrivalTime': '09:10',
    'arrivalTime': arrivalTime,
    if (entryStatus != null) 'entryStatus': entryStatus,
    'notEnteredConfirmedAt': notEnteredConfirmedAt,
    'notEnteredConfirmedById': notEnteredConfirmedById,
    'notEnteredConfirmedBy': notEnteredConfirmedById == null
        ? null
        : {
            'id': notEnteredConfirmedById,
            'name': '测试前台',
            'username': 'front.test',
          },
    'groupType': 'KB团',
    'wineDetails': '',
    'departureTime': departureTime,
    'remarks': '',
    'status': 'unmarked',
    'parkingFeeCents': 500,
    'cigaretteFeeCents': 1000,
    'lossStatus': lossStatus,
    'financeMark': false,
    'pendingStatus': 'pending_taster',
    'pendingReasons': ['no_order_and_missing_taster_summary'],
    'tastingItems': [
      {
        'id': 'item-1',
        'productId': 'product-1',
        'productName': '酱香珍藏',
        'quantity': 2,
        'unit': '瓶',
        'note': '开瓶',
        'sortOrder': 1,
      },
    ],
    'salesOrders': const [],
    'orderSummary': const {
      'orderCount': 0,
      'totalAmountCents': 0,
      'cashOnDeliveryAmountCents': 0,
    },
  };
}

String _todayDate() {
  final now = DateTime.now().toUtc().add(const Duration(hours: 8));
  return '${now.year.toString().padLeft(4, '0')}-'
      '${now.month.toString().padLeft(2, '0')}-'
      '${now.day.toString().padLeft(2, '0')}';
}

String _tomorrowDate() {
  final now = DateTime.now().toUtc().add(const Duration(hours: 8, days: 1));
  return '${now.year.toString().padLeft(4, '0')}-'
      '${now.month.toString().padLeft(2, '0')}-'
      '${now.day.toString().padLeft(2, '0')}';
}

String _yesterdayDate() {
  final now = DateTime.now().toUtc().add(const Duration(hours: 8, days: -1));
  return '${now.year.toString().padLeft(4, '0')}-'
      '${now.month.toString().padLeft(2, '0')}-'
      '${now.day.toString().padLeft(2, '0')}';
}

class _QueryFakeDownloadedFileService extends DownloadedFileService {
  int openCalls = 0;

  @override
  bool get isMobile => true;

  @override
  Future<DownloadedFileSaveResult> save({
    required String originalFileName,
    required Uint8List bytes,
  }) async {
    return const DownloadedFileSaveResult(
      path: 'D:\\fake-download\\客人名单.pdf',
      cancelled: false,
    );
  }

  @override
  Future<ExternalOpenResult> open({
    required String filePath,
    required String mimeType,
  }) async {
    openCalls += 1;
    return const ExternalOpenResult(
      ExternalOpenStatus.failed,
      message: '打开附件失败，请稍后重试。',
    );
  }
}
