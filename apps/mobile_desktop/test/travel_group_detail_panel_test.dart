import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/business/business_api.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_group_detail/travel_group_detail_panel.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets('shows travel group detail sections and main values',
      (tester) async {
    await _pumpPanel(
      tester,
      role: UserRole.admin,
      group: _sampleGroup(financeMark: true),
      onEdit: () {},
      onFinanceMark: () {},
      onSummary: () {},
      onPreviewAttachment: (_) {},
      onDownloadAttachment: (_) {},
      onDeleteAttachment: (_) {},
    );

    expect(find.text('旅行团详情'), findsOneWidget);
    expect(find.text('基础信息'), findsOneWidget);
    expect(find.text('导游快照'), findsOneWidget);
    expect(find.text('品鉴师'), findsNWidgets(2));
    expect(find.text('客户补充信息'), findsOneWidget);
    expect(find.text('重点客户照片'), findsOneWidget);
    expect(find.text('客人信息附件'), findsOneWidget);
    expect(find.text('品酒明细'), findsOneWidget);
    expect(find.text('待处理'), findsOneWidget);
    expect(find.text('订单概要'), findsOneWidget);
    expect(find.text('财务标记'), findsOneWidget);

    expect(find.text('TG20260627001'), findsOneWidget);
    expect(find.text('测试旅行社'), findsAtLeastNWidgets(1));
    expect(find.text('李导'), findsOneWidget);
    expect(find.text('周品鉴师'), findsOneWidget);
    expect(find.text('吴对接'), findsOneWidget);
    expect(find.text('导游ID'), findsNothing);
    expect(find.text('品鉴师ID'), findsNothing);
    expect(find.text('对接品鉴师ID'), findsNothing);
    expect(find.text('guide-1'), findsNothing);
    expect(find.text('taster-1'), findsNothing);
    expect(find.text('taster-2'), findsNothing);
    expect(find.text('贵阳'), findsOneWidget);
    expect(find.text('35-50 岁'), findsOneWidget);
    expect(find.text('均单'), findsOneWidget);
    expect(find.text('重点关注王女士'), findsOneWidget);
    expect(find.text('09:00'), findsOneWidget);
    expect(find.text('09:30'), findsOneWidget);
    expect(find.text('王女士.jpg'), findsOneWidget);
    expect(find.text('客人名单.pdf'), findsOneWidget);
    expect(find.text('image/jpeg · 2.0 KB'), findsOneWidget);
    expect(find.widgetWithText(TextButton, '预览'), findsOneWidget);
    expect(find.widgetWithText(TextButton, '下载'), findsNWidgets(2));
    expect(find.widgetWithText(TextButton, '删除'), findsNWidgets(2));
    expect(find.text('酱香珍藏'), findsOneWidget);
    expect(find.text('SO-TEST-001 · 王女士'), findsOneWidget);
    expect(find.text('待财务'), findsOneWidget);
    expect(find.text('超过当日未标记'), findsOneWidget);
    expect(find.text('已标记'), findsAtLeastNWidgets(1));

    expect(find.widgetWithText(OutlinedButton, '编辑'), findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, '总结'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, '取消标记'), findsOneWidget);
  });

  testWidgets('shows readonly role tag when no actions are available',
      (tester) async {
    await _pumpPanel(
      tester,
      role: UserRole.boss,
      group: _sampleGroup(financeMark: false),
    );

    expect(find.text('老板只读'), findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, '编辑'), findsNothing);
    expect(find.widgetWithText(OutlinedButton, '总结'), findsNothing);
    expect(find.widgetWithText(TextButton, '删除'), findsNothing);
    expect(find.text('财务标记'), findsNothing);
    expect(find.text('未标记'), findsNothing);
    expect(find.text('超过当日未标记'), findsNothing);
    expect(find.text('超过当日待处理'), findsOneWidget);
  });

  testWidgets('read-only taster keeps attachment preview and download only',
      (tester) async {
    await _pumpPanel(
      tester,
      role: UserRole.taster,
      group: _sampleGroup(financeMark: false),
      onPreviewAttachment: (_) {},
      onDownloadAttachment: (_) {},
    );

    expect(find.text('品鉴师只读'), findsOneWidget);
    expect(find.widgetWithText(TextButton, '预览'), findsOneWidget);
    expect(find.widgetWithText(TextButton, '下载'), findsNWidgets(2));
    expect(find.widgetWithText(TextButton, '上传'), findsNothing);
    expect(find.widgetWithText(TextButton, '删除'), findsNothing);
  });

  testWidgets('editable taster receives edit summary and attachment management',
      (tester) async {
    await _pumpPanel(
      tester,
      role: UserRole.taster,
      group: _sampleGroup(financeMark: false),
      onEdit: () {},
      onSummary: () {},
      onPreviewAttachment: (_) {},
      onDownloadAttachment: (_) {},
      onDeleteAttachment: (_) {},
      onUploadKeyCustomerPhotos: () {},
      onUploadGuestInfoAttachments: () {},
    );

    expect(find.widgetWithText(OutlinedButton, '编辑'), findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, '总结'), findsOneWidget);
    expect(find.widgetWithText(TextButton, '上传'), findsNWidgets(2));
    expect(find.widgetWithText(TextButton, '删除'), findsNWidgets(2));
  });

  testWidgets('pending entry exposes confirm action and loading guard',
      (tester) async {
    var confirmCalls = 0;
    await _pumpPanel(
      tester,
      role: UserRole.admin,
      group: _sampleGroup(
        financeMark: false,
        arrivalTime: null,
        entryStatus: 'pending_entry',
      ),
      updatingNotEntered: true,
      onConfirmNotEntered: () => confirmCalls += 1,
    );

    expect(find.text('待进店'), findsOneWidget);
    final buttonFinder = find.byKey(
      const ValueKey('confirm-travel-group-not-entered-button'),
    );
    expect(buttonFinder, findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(tester.widget<OutlinedButton>(buttonFinder).onPressed, isNull);
    await tester.tap(buttonFinder);
    expect(confirmCalls, 0);
  });

  testWidgets('not entered exposes revoke action and confirmation metadata',
      (tester) async {
    await _pumpPanel(
      tester,
      role: UserRole.frontDesk,
      group: _sampleGroup(
        financeMark: false,
        arrivalTime: null,
        entryStatus: 'not_entered',
        notEnteredConfirmedAt: '2026-07-29T02:30:00.000Z',
        notEnteredConfirmedBy: const {
          'id': 'front-1',
          'name': '前台甲',
          'username': 'front.one',
        },
      ),
      onRevokeNotEntered: () {},
    );

    expect(find.text('未进店'), findsOneWidget);
    expect(find.text('前台甲'), findsOneWidget);
    expect(find.text('2026-07-29T02:30:00.000Z'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('revoke-travel-group-not-entered-button')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('confirm-travel-group-not-entered-button')),
      findsNothing,
    );
  });

  testWidgets('entered group never exposes confirm action', (tester) async {
    await _pumpPanel(
      tester,
      role: UserRole.admin,
      group: _sampleGroup(
        financeMark: false,
        arrivalTime: '09:30',
        entryStatus: 'entered',
      ),
      onConfirmNotEntered: () {},
    );

    expect(find.text('已进店'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('confirm-travel-group-not-entered-button')),
      findsNothing,
    );
  });

  testWidgets('shows tasting item empty state', (tester) async {
    await _pumpPanel(
      tester,
      role: UserRole.taster,
      group: _emptyTastingGroup(),
    );

    expect(find.text('暂无品酒明细'), findsOneWidget);
  });
}

Future<void> _pumpPanel(
  WidgetTester tester, {
  required UserRole role,
  required TravelGroupRecord group,
  VoidCallback? onEdit,
  VoidCallback? onFinanceMark,
  VoidCallback? onSummary,
  TravelGroupAttachmentAction? onPreviewAttachment,
  TravelGroupAttachmentAction? onDownloadAttachment,
  TravelGroupAttachmentAction? onDeleteAttachment,
  VoidCallback? onUploadKeyCustomerPhotos,
  VoidCallback? onUploadGuestInfoAttachments,
  bool updatingNotEntered = false,
  VoidCallback? onConfirmNotEntered,
  VoidCallback? onRevokeNotEntered,
}) {
  return tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: TravelGroupDetailPanel(
            group: group,
            role: role,
            onEdit: onEdit,
            onFinanceMark: onFinanceMark,
            onSummary: onSummary,
            onPreviewAttachment: onPreviewAttachment,
            onDownloadAttachment: onDownloadAttachment,
            onDeleteAttachment: onDeleteAttachment,
            onUploadKeyCustomerPhotos: onUploadKeyCustomerPhotos,
            onUploadGuestInfoAttachments: onUploadGuestInfoAttachments,
            updatingNotEntered: updatingNotEntered,
            onConfirmNotEntered: onConfirmNotEntered,
            onRevokeNotEntered: onRevokeNotEntered,
          ),
        ),
      ),
    ),
  );
}

TravelGroupRecord _sampleGroup({
  required bool financeMark,
  String? arrivalTime = '09:30',
  String? entryStatus,
  String? notEnteredConfirmedAt,
  Map<String, dynamic>? notEnteredConfirmedBy,
}) {
  return TravelGroupRecord.fromJson({
    'id': 'group-1',
    'kind': 'travel',
    'groupNo': 'TG20260627001',
    'visitDate': '2026-06-27',
    'travelAgency': '测试旅行社',
    'licensePlate': '贵A12345',
    'guideId': 'guide-1',
    'guideName': '李导',
    'guidePhone': '13900001111',
    'guestCount': 18,
    'tastingRoomNo': 'A-101',
    'tasterId': 'taster-1',
    'tasterName': '周品鉴师',
    'liaisonTasterId': 'taster-2',
    'liaisonTasterName': '吴对接',
    'sourceRegion': '贵阳',
    'ageInfo': '35-50 岁',
    'mentionedFeitian': false,
    'previousStopOrderStatus': '均单',
    'keyCustomerInfo': '重点关注王女士',
    'keyCustomerPhotos': [
      {
        'id': 'photo-1',
        'category': 'key_customer_photo',
        'originalName': '王女士.jpg',
        'contentType': 'image/jpeg',
        'size': 2048,
      },
    ],
    'guestInfoAttachments': [
      {
        'id': 'guest-1',
        'category': 'guest_info',
        'originalName': '客人名单.pdf',
        'contentType': 'application/pdf',
        'size': 4096,
      },
    ],
    'expectedArrivalTime': '09:00',
    'arrivalTime': arrivalTime,
    if (entryStatus != null) 'entryStatus': entryStatus,
    'notEnteredConfirmedAt': notEnteredConfirmedAt,
    'notEnteredConfirmedById': notEnteredConfirmedBy?['id'],
    'notEnteredConfirmedBy': notEnteredConfirmedBy,
    'groupType': 'KB团',
    'wineDetails': '偏好酱香',
    'departureTime': '11:30',
    'remarks': '准时到店',
    'status': 'ordered',
    'financeMark': financeMark,
    'markedById': financeMark ? 'finance-1' : null,
    'markedAt': financeMark ? '2026-06-27T10:00:00.000Z' : null,
    'tasterSummary': '整体反馈良好',
    'tasterSummaryAt': '2026-06-27T10:30:00.000Z',
    'pendingStatus': 'pending_finance',
    'pendingReasons': ['finance_unmarked_after_day_end'],
    'tastingItems': [
      {
        'id': 'item-1',
        'productName': '酱香珍藏',
        'quantity': 2,
        'unit': '瓶',
        'note': '开瓶',
        'sortOrder': 1,
      },
    ],
    'salesOrders': [
      {
        'id': 'order-1',
        'orderNo': 'SO-TEST-001',
        'orderDate': '2026-06-27',
        'customerName': '王女士',
        'totalAmountCents': 120000,
        'cashOnDeliveryAmountCents': 20000,
        'status': 'valid',
      },
    ],
    'orderSummary': {
      'orderCount': 1,
      'totalAmountCents': 120000,
      'cashOnDeliveryAmountCents': 20000,
    },
  });
}

TravelGroupRecord _emptyTastingGroup() {
  return TravelGroupRecord.fromJson({
    'id': 'group-empty',
    'kind': 'travel',
    'groupNo': 'TG-EMPTY',
    'visitDate': '2026-06-27',
    'guestCount': 1,
    'status': 'unmarked',
    'financeMark': false,
    'pendingStatus': 'pending_taster',
    'pendingReasons': const [],
    'tastingItems': const [],
    'salesOrders': const [],
    'orderSummary': const {
      'orderCount': 0,
      'totalAmountCents': 0,
      'cashOnDeliveryAmountCents': 0,
    },
  });
}
