const assert = require('node:assert/strict');
const test = require('node:test');

const {
  calculateAnalyticsMetrics,
} = require('../src/modules/analytics/analytics-calculation.helper');

test('unit: analytics calculation matches the manual stage 8 example', () => {
  const result = calculateAnalyticsMetrics({
    salesOrders: [
      salesOrder('order-a', {
        travelGroupId: 'group-a',
        totalAmountCents: yuan(10000),
        status: 'valid',
      }),
      salesOrder('order-c', {
        travelGroupId: 'group-c',
        totalAmountCents: yuan(6000),
        status: 'VALID',
      }),
    ],
    afterSalesOrders: [
      afterSalesOrder('refund-a', {
        salesOrderId: 'order-a',
        refundAmountCents: yuan(1000),
        financeConfirmed: true,
      }),
    ],
    travelGroups: [
      travelGroup('group-a', {
        guestCount: 10,
        tasterId: 'taster-jia',
        tasterName: '品鉴师甲',
        salesOrders: [
          salesOrder('order-a', {
            totalAmountCents: yuan(10000),
            status: 'partial_refund',
            afterSalesOrders: [
              afterSalesOrder('refund-a', {
                refundAmountCents: yuan(1000),
                financeConfirmed: true,
              }),
            ],
          }),
        ],
      }),
      travelGroup('group-b', {
        guestCount: 20,
        tasterId: 'taster-jia',
        tasterName: '品鉴师甲',
      }),
      travelGroup('group-c', {
        guestCount: 30,
        tasterId: 'taster-yi',
        tasterName: '品鉴师乙',
        salesOrders: [
          salesOrder('order-c', {
            totalAmountCents: yuan(6000),
            status: 'valid',
          }),
        ],
      }),
    ],
  });

  assert.deepEqual(result.metrics, {
    grossSalesAmountCents: yuan(16000),
    refundAmountCents: yuan(1000),
    pendingRefundAmountCents: 0,
    netSalesAmountCents: yuan(15000),
    totalGroupCount: 3,
    totalGuestCount: 60,
    groupScopedNetSalesAmountCents: yuan(15000),
    averageSalesPerGroupCents: yuan(5000),
    averageSalesPerGuestCents: yuan(250),
    noEffectiveOrderGroupCount: 1,
    conversionGroupCount: 2,
    noOrderRate: 1 / 3,
    conversionRate: 2 / 3,
  });
  assert.deepEqual(result.warnings, []);
});

test('unit: analytics calculation returns zero sales for groups without orders', () => {
  const result = calculateAnalyticsMetrics({
    travelGroups: [
      travelGroup('group-no-order', {
        guestCount: 8,
        tasterId: 'taster-a',
      }),
    ],
  });

  assert.deepEqual(result.metrics, {
    grossSalesAmountCents: 0,
    refundAmountCents: 0,
    pendingRefundAmountCents: 0,
    netSalesAmountCents: 0,
    totalGroupCount: 1,
    totalGuestCount: 8,
    groupScopedNetSalesAmountCents: 0,
    averageSalesPerGroupCents: 0,
    averageSalesPerGuestCents: 0,
    noEffectiveOrderGroupCount: 1,
    conversionGroupCount: 0,
    noOrderRate: 1,
    conversionRate: 0,
  });
  assert.deepEqual(result.warnings, []);
});

test('unit: analytics calculation handles order metrics when there are no travel groups', () => {
  const result = calculateAnalyticsMetrics({
    salesOrders: [
      salesOrder('order-only', {
        totalAmountCents: 12000,
        status: 'VALID',
      }),
    ],
    afterSalesOrders: [
      afterSalesOrder('refund-only', {
        salesOrderId: 'order-only',
        refundAmountCents: 2000,
        financeConfirmed: true,
      }),
    ],
  });

  assert.equal(result.metrics.grossSalesAmountCents, 12000);
  assert.equal(result.metrics.refundAmountCents, 2000);
  assert.equal(result.metrics.netSalesAmountCents, 10000);
  assert.equal(result.metrics.totalGroupCount, 0);
  assert.equal(result.metrics.totalGuestCount, 0);
  assert.equal(result.metrics.groupScopedNetSalesAmountCents, 0);
  assert.equal(result.metrics.averageSalesPerGroupCents, 0);
  assert.equal(result.metrics.averageSalesPerGuestCents, 0);
  assert.equal(result.metrics.noEffectiveOrderGroupCount, 0);
  assert.equal(result.metrics.conversionGroupCount, 0);
  assert.equal(result.metrics.noOrderRate, 0);
  assert.equal(result.metrics.conversionRate, 0);
  assert.deepEqual(result.warnings, []);
});

test('unit: analytics calculation treats fully refunded orders as no effective order', () => {
  const result = calculateAnalyticsMetrics({
    salesOrders: [
      salesOrder('order-full-refund', {
        travelGroupId: 'group-full-refund',
        totalAmountCents: 50000,
        status: 'refunded',
      }),
    ],
    afterSalesOrders: [
      afterSalesOrder('refund-full', {
        salesOrderId: 'order-full-refund',
        refundAmountCents: 50000,
        financeConfirmed: true,
      }),
    ],
    travelGroups: [
      travelGroup('group-full-refund', {
        guestCount: 5,
        tasterId: 'taster-a',
        salesOrders: [
          salesOrder('order-full-refund', {
            totalAmountCents: 50000,
            status: 'REFUNDED',
            afterSalesOrders: [
              afterSalesOrder('refund-full', {
                refundAmountCents: 50000,
                financeConfirmed: true,
              }),
            ],
          }),
        ],
      }),
    ],
  });

  assert.equal(result.metrics.grossSalesAmountCents, 50000);
  assert.equal(result.metrics.refundAmountCents, 50000);
  assert.equal(result.metrics.netSalesAmountCents, 0);
  assert.equal(result.metrics.groupScopedNetSalesAmountCents, 0);
  assert.equal(result.metrics.noEffectiveOrderGroupCount, 1);
  assert.equal(result.metrics.conversionGroupCount, 0);
  assert.equal(result.metrics.noOrderRate, 1);
  assert.deepEqual(result.warnings, []);
});

test('unit: analytics calculation deducts partial refunds and reports pending refunds', () => {
  const result = calculateAnalyticsMetrics({
    salesOrders: [
      salesOrder('order-partial', {
        travelGroupId: 'group-partial',
        totalAmountCents: 100000,
        status: 'partial_refund',
      }),
    ],
    afterSalesOrders: [
      afterSalesOrder('refund-confirmed', {
        salesOrderId: 'order-partial',
        refundAmountCents: 20000,
        financeConfirmed: true,
      }),
      afterSalesOrder('refund-pending', {
        salesOrderId: 'order-partial',
        refundAmountCents: 5000,
        financeConfirmed: false,
      }),
    ],
    travelGroups: [
      travelGroup('group-partial', {
        guestCount: 10,
        tasterId: 'taster-a',
        salesOrders: [
          salesOrder('order-partial', {
            totalAmountCents: 100000,
            status: 'PARTIAL_REFUND',
            afterSalesOrders: [
              afterSalesOrder('refund-confirmed', {
                refundAmountCents: 20000,
                financeConfirmed: true,
              }),
              afterSalesOrder('refund-pending', {
                refundAmountCents: 5000,
                financeConfirmed: false,
              }),
            ],
          }),
        ],
      }),
    ],
  });

  assert.equal(result.metrics.grossSalesAmountCents, 100000);
  assert.equal(result.metrics.refundAmountCents, 20000);
  assert.equal(result.metrics.pendingRefundAmountCents, 5000);
  assert.equal(result.metrics.netSalesAmountCents, 80000);
  assert.equal(result.metrics.groupScopedNetSalesAmountCents, 80000);
  assert.equal(result.metrics.noEffectiveOrderGroupCount, 0);
  assert.equal(result.metrics.conversionGroupCount, 1);
  assert.equal(result.metrics.noOrderRate, 0);
  assert.equal(result.metrics.conversionRate, 1);
  assert.deepEqual(warningCodes(result), ['pending_refund']);
});

test('unit: analytics calculation warns for refunded orders without confirmed refund fact', () => {
  const result = calculateAnalyticsMetrics({
    salesOrders: [
      salesOrder('order-refunded-without-fact', {
        totalAmountCents: 70000,
        status: 'refunded',
      }),
    ],
    afterSalesOrders: [
      afterSalesOrder('refund-unconfirmed', {
        salesOrderId: 'order-refunded-without-fact',
        refundAmountCents: 70000,
        financeConfirmed: false,
      }),
    ],
  });

  assert.equal(result.metrics.grossSalesAmountCents, 70000);
  assert.equal(result.metrics.refundAmountCents, 0);
  assert.equal(result.metrics.pendingRefundAmountCents, 70000);
  assert.equal(result.metrics.netSalesAmountCents, 70000);
  assert.deepEqual(warningCodes(result), [
    'pending_refund',
    'refunded_order_without_confirmed_refund',
  ]);
  assert.deepEqual(result.warnings[1].context.salesOrderIds, [
    'order-refunded-without-fact',
  ]);
});

test('unit: analytics calculation warns for travel groups without tasters', () => {
  const result = calculateAnalyticsMetrics({
    travelGroups: [
      travelGroup('group-missing-taster', {
        groupNo: 'TG-SMOKE-MISSING-TASTER',
        guestCount: 6,
        tasterId: null,
      }),
    ],
  });

  assert.deepEqual(warningCodes(result), ['missing_taster']);
  assert.deepEqual(result.warnings[0].context.travelGroupIds, [
    'group-missing-taster',
  ]);
  assert.deepEqual(result.warnings[0].context.groupNos, [
    'TG-SMOKE-MISSING-TASTER',
  ]);
});

function salesOrder(id, overrides = {}) {
  return {
    id,
    orderNo: `SO-${id}`,
    status: 'valid',
    totalAmountCents: 0,
    travelGroupId: null,
    afterSalesOrders: [],
    ...overrides,
  };
}

function afterSalesOrder(id, overrides = {}) {
  return {
    id,
    afterSalesNo: `AS-${id}`,
    salesOrderId: null,
    refundAmountCents: 0,
    financeConfirmed: false,
    ...overrides,
  };
}

function travelGroup(id, overrides = {}) {
  return {
    id,
    groupNo: `TG-${id}`,
    guestCount: 0,
    tasterId: 'taster-default',
    tasterName: 'Test Taster',
    salesOrders: [],
    ...overrides,
  };
}

function warningCodes(result) {
  return result.warnings.map((warning) => warning.code);
}

function yuan(value) {
  return value * 100;
}
