import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/business/business_api.dart';

void main() {
  test('special-order API parser preserves workflow, line, and finance fields',
      () {
    final order = SpecialOrderRecord.fromJson({
      'id': 'order-1',
      'orderNo': 'SO-BUYBACK-001',
      'orderType': 'buyback',
      'workflowStatus': 'approved',
      'workflowVersion': 7,
      'orderDate': '2026-07-29',
      'customerId': 'customer-1',
      'customerName': '客户甲',
      'hasOriginalPurchase': false,
      'sourceRemark': '线下旧物',
      'totalAmountCents': 18800,
      'createdById': 'sales-1',
      'createdBy': {'name': '销售甲'},
      'items': [
        {
          'id': 'item-1',
          'productId': 'product-1',
          'productName': '逐瓶商品',
          'unit': '瓶',
          'inventoryTrackingMode': 'serialized',
          'warehouseId': 'warehouse-main',
          'warehouse': {'name': '默认总仓'},
          'quantity': 2,
          'listUnitPriceCents': 10000,
          'unitPriceCents': 9400,
          'discountAmountCents': 1200,
          'subtotalCents': 18800,
          'isGift': false,
          'priceOverrideReason': '议价回购',
          'inventoryCondition': 'saleable',
          'deliveryType': 'self_pickup',
          'logisticsCodes': ['REAL-001', 'REAL-002'],
        },
      ],
      'workflowEvents': [
        {
          'eventType': 'approved',
          'toStatus': 'approved',
          'workflowVersion': 7,
          'actor': {'name': '老板甲'},
          'createdAt': '2026-07-29T08:00:00.000Z',
        },
      ],
      'settlement': {
        'direction': 'payable',
        'totalAmountCents': 18800,
        'settledAmountCents': 9400,
        'paymentStatus': 'partial',
        'payments': [],
      },
      'financial': {
        'receivableTotalCents': 0,
        'payableTotalCents': 18800,
        'netCashFlowCents': -18800,
      },
    });

    expect(order.orderType, 'buyback');
    expect(order.workflowStatus, 'approved');
    expect(order.workflowVersion, 7);
    expect(order.hasOriginalPurchase, isFalse);
    expect(order.items.single.logisticsCodes, ['REAL-001', 'REAL-002']);
    expect(order.items.single.warehouseName, '默认总仓');
    expect(order.workflowEvents.single.actorName, '老板甲');
    expect(order.settlement?.direction, 'payable');
    expect(order.settlement?.paymentStatus, 'partial');
    expect(order.receivableTotalCents, 0);
    expect(order.payableTotalCents, 18800);
    expect(order.netCashFlowCents, -18800);
  });
}
