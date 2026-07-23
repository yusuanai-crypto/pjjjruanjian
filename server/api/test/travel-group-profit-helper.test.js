const assert = require('node:assert/strict');
const test = require('node:test');

const {
  calculateTravelGroupProfit,
} = require('../src/modules/analytics/travel-group-profit.helper');

test('unit: travel group profit subtracts snapshot cost and each expense exactly once', () => {
  const result = calculateTravelGroupProfit({
    travelGroup: group('group-complete'),
    salesOrders: [
      order('order-complete', {
        totalAmountCents: 10000,
        logisticsFeeCents: 500,
        items: [item('line-complete', 10000, 3000)],
        commissionRecords: [
          {
            targetType: 'SALES_COMMISSION',
            deductionAmountCents: 9999,
          },
          {
            targetType: 'AGENCY_DAILY_REBATE',
            deductionAmountCents: 8888,
          },
        ],
      }),
    ],
    commissionRecords: [
      commission('order-complete', 'SALES_COMMISSION', 100),
      commission('order-complete', 'OUTREACH_COMMISSION', 200),
      commission('order-complete', 'LEADER_COMMISSION', 300),
      commission('order-complete', 'TASTER_COMMISSION', 400),
      {
        ...commission('order-complete', 'AGENCY_DAILY_REBATE', 0),
        pointsCents: 9999,
      },
      {
        ...commission('order-complete', 'AGENCY_MONTHLY_REBATE', 0),
        pointsCents: 9999,
      },
    ],
    financeSummary: {
      totalDailyRebateCents: 500,
      totalMonthlyRebateCents: 600,
    },
  });

  assert.equal(result.calculationStatus, 'complete');
  assert.equal(result.effectiveSalesAmountCents, 10000);
  assert.equal(result.actualProductCostCents, 3000);
  assert.equal(result.logisticsFeeCents, 500);
  assert.equal(result.salesCommissionCents, 100);
  assert.equal(result.outreachCommissionCents, 200);
  assert.equal(result.leaderCommissionCents, 300);
  assert.equal(result.employeeCommissionCents, 600);
  assert.equal(result.tasterCommissionCents, 400);
  assert.equal(result.dailyAgencyRebateCents, 500);
  assert.equal(result.monthlyAgencyRebateCents, 600);
  assert.equal(result.totalExpenseCents, 5600);
  assert.equal(result.estimatedProfitCents, 4400);
  assert.equal(result.estimatedProfitRate, 0.44);
  assert.equal(
    result.estimatedProfitCents,
    10000 - 3000 - 500 - 100 - 200 - 300 - 400 - 500 - 600,
  );
});

test('unit: missing cost snapshots make profit incomplete instead of treating cost as zero', () => {
  const partial = calculateTravelGroupProfit({
    travelGroup: group('group-partial'),
    salesOrders: [
      order('order-partial', {
        items: [
          item('covered', 5000, 2000),
          item('missing', 5000, null),
        ],
      }),
    ],
    financeSummary: {
      totalDailyRebateCents: 0,
      totalMonthlyRebateCents: 0,
    },
  });
  const unavailable = calculateTravelGroupProfit({
    travelGroup: group('group-unavailable'),
    salesOrders: [
      order('order-unavailable', {
        items: [item('missing-all', 10000, null)],
      }),
    ],
    financeSummary: {
      totalDailyRebateCents: 0,
      totalMonthlyRebateCents: 0,
    },
  });

  assert.equal(partial.calculationStatus, 'incomplete');
  assert.equal(partial.actualProductCostCents, 2000);
  assert.equal(partial.estimatedProfitCents, null);
  assert.ok(
    partial.warnings.some(
      (warning) => warning.code === 'ACTUAL_COST_COVERAGE_PARTIAL',
    ),
  );
  assert.equal(unavailable.calculationStatus, 'incomplete');
  assert.equal(unavailable.actualProductCostCents, 0);
  assert.equal(unavailable.estimatedProfitCents, null);
  assert.ok(
    unavailable.warnings.some(
      (warning) => warning.code === 'ACTUAL_COST_COVERAGE_UNAVAILABLE',
    ),
  );
});

test('unit: no effective sales returns zero profit and no profit rate', () => {
  const result = calculateTravelGroupProfit({
    travelGroup: group('group-no-sales'),
    salesOrders: [
      order('order-cancelled', {
        status: 'CANCELLED',
        items: [item('cancelled-line', 10000, 3000)],
      }),
    ],
  });

  assert.equal(result.calculationStatus, 'no_sales');
  assert.equal(result.orderCount, 0);
  assert.equal(result.effectiveSalesAmountCents, 0);
  assert.equal(result.estimatedProfitCents, 0);
  assert.equal(result.estimatedProfitRate, null);
});

test('unit: confirmed and pending refunds produce estimates and agency fallback warnings', () => {
  const result = calculateTravelGroupProfit({
    travelGroup: group('group-refund'),
    salesOrders: [
      order('order-refund', {
        status: 'PARTIAL_REFUND',
        items: [item('refund-line', 10000, 3000)],
        afterSalesOrders: [
          {
            refundAmountCents: 1000,
            financeConfirmed: true,
          },
          {
            refundAmountCents: 500,
            financeConfirmed: false,
          },
        ],
      }),
    ],
    commissionRecords: [
      {
        ...commission('order-refund', 'AGENCY_DAILY_REBATE', 0),
        pointsCents: 100,
      },
      {
        ...commission('order-refund', 'AGENCY_MONTHLY_REBATE', 0),
        pointsCents: 200,
      },
    ],
  });

  assert.equal(result.calculationStatus, 'estimated');
  assert.equal(result.effectiveSalesAmountCents, 9000);
  assert.equal(result.confirmedRefundAmountCents, 1000);
  assert.equal(result.pendingRefundAmountCents, 500);
  assert.equal(result.dailyAgencyRebateCents, 100);
  assert.equal(result.monthlyAgencyRebateCents, 200);
  assert.equal(result.estimatedProfitCents, 5700);
  assert.deepEqual(
    result.warnings.map((warning) => warning.code).sort(),
    [
      'FINANCE_SUMMARY_MISSING',
      'PENDING_REFUND_CONFIRMATION',
      'REFUND_COST_REVERSAL_UNAVAILABLE',
    ],
  );
});

test('unit: travel group estimated profit preserves negative values', () => {
  const result = calculateTravelGroupProfit({
    travelGroup: group('group-loss'),
    salesOrders: [
      order('order-loss', {
        totalAmountCents: 1000,
        logisticsFeeCents: 500,
        items: [item('loss-line', 1000, 900)],
      }),
    ],
    commissionRecords: [
      commission('order-loss', 'SALES_COMMISSION', 300),
    ],
    financeSummary: {
      totalDailyRebateCents: 200,
      totalMonthlyRebateCents: 100,
    },
  });

  assert.equal(result.calculationStatus, 'complete');
  assert.equal(result.totalExpenseCents, 2000);
  assert.equal(result.estimatedProfitCents, -1000);
  assert.equal(result.estimatedProfitRate, -1);
});

function group(id) {
  return {
    id,
    groupNo: `TG-${id}`,
    visitDate: '2026-07-10',
    travelAgency: 'Test Agency',
    guideName: 'Test Guide',
    tasterName: 'Test Taster',
    guestCount: 20,
  };
}

function order(id, overrides = {}) {
  const items = overrides.items || [item(`${id}-line`, 10000, 3000)];
  return {
    id,
    orderNo: `SO-${id}`,
    orderDate: '2026-06-01',
    travelGroupId: id.replace('order', 'group'),
    status: 'VALID',
    totalAmountCents: items.reduce(
      (total, line) => total + line.subtotalCents,
      0,
    ),
    logisticsFeeCents: 0,
    afterSalesOrders: [],
    commissionRecords: [],
    ...overrides,
    items,
  };
}

function item(id, subtotalCents, actualCostSubtotalCents) {
  return {
    id,
    productName: id,
    quantity: 1,
    unitPriceCents: subtotalCents,
    subtotalCents,
    actualCostSubtotalCents,
  };
}

function commission(salesOrderId, targetType, amountCents) {
  return {
    salesOrderId,
    targetType,
    amountCents,
    pointsCents: 0,
  };
}
