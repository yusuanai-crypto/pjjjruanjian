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
    expect(find.text('全部旅行团'), findsOneWidget);
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

  testWidgets('unrelated taster can view all fields but cannot edit',
      (tester) async {
    final apiClient = _FakeApiClient(
      tasterId: 'other-taster',
      liaisonTasterId: 'other-liaison',
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

  testWidgets('future taster group explains read-only state', (tester) async {
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
      find.byKey(
        const ValueKey('travel-group-taster-read-only-reason'),
      ),
      findsOneWidget,
    );
    expect(find.textContaining('未来旅行团仅可查看'), findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, '编辑'), findsNothing);
    expect(find.text('上传'), findsNothing);
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
    this.tasterEditCount = 0,
    this.includeAttachment = false,
  }) : super(baseUrl: 'http://127.0.0.1:3000');

  final String? tasterId;
  final String? liaisonTasterId;
  final String? visitDate;
  final int tasterEditCount;
  final bool includeAttachment;
  final List<String> travelGroupGetPaths = [];

  String? lastPatchPath;
  Map<String, dynamic>? lastPatchBody;

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
    return {
      'data': {
        'travelGroup': {
          ..._travelGroupJson(
            tasterId: tasterId,
            liaisonTasterId: liaisonTasterId,
            visitDate: visitDate,
            tasterEditCount: tasterEditCount,
            includeAttachment: includeAttachment,
          ),
          ...?body,
        },
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
  int tasterEditCount = 0,
  bool includeAttachment = false,
}) {
  final resolvedVisitDate = visitDate ?? _todayDate();
  final associated = tasterId == 'actor-1' || liaisonTasterId == 'actor-1';
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
    'canEditByCurrentUser': associated && resolvedVisitDate == _todayDate(),
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
    'arrivalTime': '9:25',
    'groupType': 'KB团',
    'wineDetails': '',
    'departureTime': '',
    'remarks': '',
    'status': 'unmarked',
    'parkingFeeCents': 500,
    'cigaretteFeeCents': 1000,
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
