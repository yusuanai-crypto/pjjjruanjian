import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/business/business_api.dart';

void main() {
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
      'groupNo': 'GZ-TEST-001',
      'visitDate': '2026-06-24',
      'travelAgency': '测试旅行社',
      'guestCount': '18',
      'status': 'ordered',
      'salesAmountCents': '647800',
      'financeMark': 'true',
      'markedById': 'usr_finance',
      'markedAt': '2026-06-24T08:00:00.000Z',
    });

    expect(group.groupNo, 'GZ-TEST-001');
    expect(group.guestCount, 18);
    expect(group.salesAmountCents, 647800);
    expect(group.financeMark, isTrue);
    expect(group.markedById, 'usr_finance');

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
