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
    );

    expect(find.text('旅行团详情'), findsOneWidget);
    expect(find.text('基础信息'), findsOneWidget);
    expect(find.text('导游快照'), findsOneWidget);
    expect(find.text('品鉴师'), findsOneWidget);
    expect(find.text('品酒明细'), findsOneWidget);
    expect(find.text('待处理'), findsOneWidget);
    expect(find.text('订单概要'), findsOneWidget);
    expect(find.text('财务标记'), findsOneWidget);

    expect(find.text('TG20260627001'), findsOneWidget);
    expect(find.text('测试旅行社'), findsAtLeastNWidgets(1));
    expect(find.text('李导'), findsOneWidget);
    expect(find.text('周品鉴师'), findsOneWidget);
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
    expect(find.text('财务标记'), findsOneWidget);
    expect(find.text('未标记'), findsAtLeastNWidgets(1));
  });
}

Future<void> _pumpPanel(
  WidgetTester tester, {
  required UserRole role,
  required TravelGroupRecord group,
  VoidCallback? onEdit,
  VoidCallback? onFinanceMark,
  VoidCallback? onSummary,
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
          ),
        ),
      ),
    ),
  );
}

TravelGroupRecord _sampleGroup({required bool financeMark}) {
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
    'arrivalTime': '09:30',
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
