import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/business/business_api.dart';

void main() {
  test('parses guide JSON and guide library states', () {
    final guide = GuideRecord.fromJson({
      'id': 'guide-1',
      'name': 'Guide One',
      'phone': '13900001111',
      'travelAgency': 'Agency One',
      'remarks': 'Prefers morning groups',
      'isActive': 'true',
      'createdAt': '2026-06-27T08:00:00.000Z',
      'updatedAt': '2026-06-27T09:00:00.000Z',
    });

    expect(guide.id, 'guide-1');
    expect(guide.name, 'Guide One');
    expect(guide.phone, '13900001111');
    expect(guide.travelAgency, 'Agency One');
    expect(guide.remarks, 'Prefers morning groups');
    expect(guide.isActive, isTrue);
    expect(guide.createdAt, '2026-06-27T08:00:00.000Z');
    expect(guide.updatedAt, '2026-06-27T09:00:00.000Z');

    const emptyState = GuideLibraryState.data(<GuideRecord>[]);
    expect(emptyState.isEmpty, isTrue);
    expect(emptyState.loading, isFalse);
    expect(emptyState.hasError, isFalse);

    const loadingState = GuideLibraryState.loading();
    expect(loadingState.loading, isTrue);
    expect(loadingState.isEmpty, isFalse);

    const errorState = GuideLibraryState.error('Failed to load guides');
    expect(errorState.hasError, isTrue);
    expect(errorState.isEmpty, isFalse);

    final agency = TravelAgencyRecord.fromJson({
      'id': 'agency-1',
      'name': 'Agency One',
      'contactName': 'Contact One',
      'contactPhone': '13900003333',
      'notes': 'Often handles morning groups',
      'createdAt': '2026-06-29T08:00:00.000Z',
      'updatedAt': '2026-06-29T09:00:00.000Z',
    });

    expect(agency.id, 'agency-1');
    expect(agency.name, 'Agency One');
    expect(agency.contactName, 'Contact One');
    expect(agency.contactPhone, '13900003333');
    expect(agency.notes, 'Often handles morning groups');
  });

  test('parses sales order JSON returned by business API', () {
    final order = SalesOrderRecord.fromJson({
      'id': 'order-1',
      'orderNo': 'SO-TEST-001',
      'orderType': 'travel_group',
      'customerName': '测试客户',
      'customerPhone': '13900002222',
      'orderDate': '2026-06-24',
      'totalAmountCents': 647800,
      'cashOnDeliveryAmountCents': 5000,
      'status': 'valid',
      'financeMark': true,
      'markedById': 'usr_finance',
      'markedAt': '2026-06-24T08:00:00.000Z',
      'province': '贵州省',
      'city': '贵阳市',
      'district': '观山湖区',
      'address': '测试地址',
      'items': [
        {
          'productName': '酱香珍藏 53°',
          'quantity': 2,
          'deliveryType': 'shipping',
        },
      ],
      'travelGroup': {
        'id': 'group-1',
        'groupNo': 'GZ-TEST-001',
        'visitDate': '2026-06-24',
        'guestCount': 18,
        'status': 'ordered',
      },
    });

    expect(order.id, 'order-1');
    expect(order.orderNo, 'SO-TEST-001');
    expect(order.totalAmountCents, 647800);
    expect(order.financeMark, isTrue);
    expect(order.address, '贵州省贵阳市观山湖区测试地址');
    expect(order.items, hasLength(1));
    expect(order.items.single.productName, '酱香珍藏 53°');
    expect(order.travelGroup?.groupNo, 'GZ-TEST-001');
  });

  test('parses reconciliation JSON with positive refunds deduction', () {
    final reconciliation = ReconciliationRecord.fromJson({
      'businessDate': '2026-06-23',
      'travelGroupSalesCents': 39800,
      'backOfficeSalesCents': 10000,
      'buybackCents': 0,
      'externalSalesCents': 0,
      'internalPurchaseCents': 0,
      'afterSalesCents': 0,
      'refundsCents': 800,
      'otherReceivableCents': 0,
      'receivableTotalCents': 49000,
      'actualTotalCents': 48500,
      'differenceCents': -500,
      'paymentMethods': [
        {'name': '现金', 'amountCents': 20000, 'sortOrder': 1},
        {'name': '微信', 'amountCents': 28500, 'sortOrder': 2},
      ],
    });

    expect(reconciliation.refundsCents, 800);
    expect(reconciliation.receivableTotalCents, 49000);
    expect(reconciliation.actualTotalCents, 48500);
    expect(reconciliation.differenceCents, -500);
    expect(reconciliation.paymentMethods, hasLength(2));
  });

  test('parses travel group and finance overview JSON returned by business API',
      () {
    final group = TravelGroupRecord.fromJson({
      'id': 'group-1',
      'kind': 'travel',
      'groupNo': 'GZ-TEST-001',
      'visitDate': '2026-06-24',
      'licensePlate': '贵A12345',
      'guideId': 'guide-1',
      'guideName': '测试导游',
      'guidePhone': '13900001111',
      'travelAgency': '测试旅行社',
      'guestCount': '18',
      'tastingRoomNo': 'A-101',
      'tasterId': 'taster-1',
      'tasterName': '测试品鉴师',
      'arrivalTime': '09:30',
      'groupType': 'KB团',
      'wineDetails': '偏好酱香',
      'departureTime': '11:30',
      'status': 'ordered',
      'salesAmountCents': '647800',
      'guideInfoSent': true,
      'travelAgencyInfoSent': 'true',
      'financeMark': 'true',
      'markedById': 'usr_finance',
      'markedAt': '2026-06-24T08:00:00.000Z',
      'tasterSummary': 'Guests liked the reserve.',
      'tasterSummaryAt': '2026-06-24T09:00:00.000Z',
      'tastingItems': [
        {
          'id': 'item-1',
          'travelGroupId': 'group-1',
          'productName': '酱香珍藏',
          'quantity': '2',
          'unit': '瓶',
          'note': '开瓶',
          'sortOrder': '1',
        },
      ],
      'salesOrders': [
        {
          'id': 'order-1',
          'orderNo': 'SO-TEST-001',
          'orderType': 'travel_group',
          'orderDate': '2026-06-24',
          'customerName': '测试客户',
          'totalAmountCents': '647800',
          'cashOnDeliveryAmountCents': '5000',
          'status': 'valid',
          'financeMark': false,
        },
      ],
      'orderSummary': {
        'orderCount': '1',
        'totalAmountCents': '647800',
        'cashOnDeliveryAmountCents': '5000',
      },
      'pendingStatus': 'pending_finance',
      'pendingReasons': ['finance_unmarked_after_day_end'],
    });

    expect(group.groupNo, 'GZ-TEST-001');
    expect(group.kind, 'travel');
    expect(group.guideId, 'guide-1');
    expect(group.tasterId, 'taster-1');
    expect(group.guestCount, 18);
    expect(group.salesAmountCents, 647800);
    expect(group.guideInfoSent, isTrue);
    expect(group.travelAgencyInfoSent, isTrue);
    expect(group.financeMark, isTrue);
    expect(group.markedById, 'usr_finance');
    expect(group.tasterSummary, 'Guests liked the reserve.');
    expect(group.tastingItems, hasLength(1));
    expect(group.tastingItems.single.productName, '酱香珍藏');
    expect(group.tastingItems.single.quantity, 2);
    expect(group.salesOrders.single.orderNo, 'SO-TEST-001');
    expect(group.orderSummary.orderCount, 1);
    expect(group.orderSummary.cashOnDeliveryAmountCents, 5000);
    expect(group.pendingStatus, 'pending_finance');
    expect(group.pendingReasons, ['finance_unmarked_after_day_end']);

    final overview = FinanceOverview.fromJson({
      'metrics': {
        'travelGroupCount': 2,
        'orderCount': 3,
        'salesAmountCents': 1295600,
        'refundAmountCents': 800,
        'cashOnDeliveryAmountCents': 5000,
      },
      'recentOrders': [
        {
          'id': 'order-2',
          'orderNo': 'SO-TEST-002',
          'customerName': '测试客户',
          'orderDate': '2026-06-24',
          'totalAmountCents': 10000,
        },
      ],
    });

    expect(overview.travelGroupCount, 2);
    expect(overview.refundAmountCents, 800);
    expect(overview.cashOnDeliveryAmountCents, 5000);
    expect(overview.recentOrders.single.orderNo, 'SO-TEST-002');
  });
}
