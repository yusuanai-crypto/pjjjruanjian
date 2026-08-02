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
    guidePointsSummaries: [
      { totalDailyPointsCents: 100, totalMonthlyPointsCents: 200 },
      { totalDailyPointsCents: 50, totalMonthlyPointsCents: 25 },
    ],
  });

  assert.equal(result.calculationStatus, 'complete');
  assert.equal(result.effectiveSalesAmountCents, 10000);
  assert.equal(result.actualProductCostCents, 3000);
  assert.equal(result.logisticsFeeCents, 500);
  assert.equal(result.parkingFeeCents, 500);
  assert.equal(result.cigaretteFeeCents, 200);
  assert.equal(result.salesCommissionCents, 100);
  assert.equal(result.outreachCommissionCents, 200);
  assert.equal(result.leaderCommissionCents, 300);
  assert.equal(result.employeeCommissionCents, 600);
  assert.equal(result.tasterCommissionCents, 400);
  assert.equal(result.dailyAgencyRebateCents, 500);
  assert.equal(result.monthlyAgencyRebateCents, 600);
  assert.equal(result.guideDailyPointsCents, 150);
  assert.equal(result.guideMonthlyPointsCents, 225);
  assert.equal(result.totalExpenseCents, 6675);
  assert.equal(result.estimatedProfitCents, 3325);
  assert.equal(result.estimatedProfitRate, 0.3325);
  assert.equal(
    result.employeeCommissionCents,
    result.salesCommissionCents +
      result.outreachCommissionCents +
      result.leaderCommissionCents,
  );
  assert.equal(
    result.totalExpenseCents,
    result.actualProductCostCents +
      result.logisticsFeeCents +
      result.parkingFeeCents +
      result.cigaretteFeeCents +
      result.employeeCommissionCents +
      result.tasterCommissionCents +
      result.dailyAgencyRebateCents +
      result.monthlyAgencyRebateCents +
      result.guideDailyPointsCents +
      result.guideMonthlyPointsCents,
  );
  assert.equal(
    result.estimatedProfitCents,
    10000 -
      3000 -
      500 -
      500 -
      200 -
      100 -
      200 -
      300 -
      400 -
      500 -
      600 -
      150 -
      225,
  );
});

test('unit: a stale zeroed employee commission snapshot no longer enters profit expenses', () => {
  const result = calculateTravelGroupProfit({
    travelGroup: group('group-stale'),
    salesOrders: [
      order('order-stale', {
        totalAmountCents: 10000,
        items: [item('line-stale', 10000, 3000)],
      }),
    ],
    commissionRecords: [
      {
        ...commission('order-stale', 'OUTREACH_COMMISSION', 0),
        commissionRuleId: null,
        calculationNote: 'stale auto record zeroed',
      },
    ],
    financeSummary: {
      totalDailyRebateCents: 0,
      totalMonthlyRebateCents: 0,
    },
  });

  assert.equal(result.outreachCommissionCents, 0);
  assert.equal(result.outreachCommissionCalculated, false);
  assert.equal(result.employeeCommissionCents, 0);
  assert.equal(result.totalExpenseCents, 3700);
  assert.equal(result.estimatedProfitCents, null);
});

test('unit: profit diagnostics distinguish calculated zero from missing employee commission records', () => {
  const calculatedZero = calculateTravelGroupProfit({
    travelGroup: group('group-zero'),
    salesOrders: [
      order('order-zero', {
        salesUserId: 'sales-1',
        outreachUserId: 'outreach-1',
        salesUser: { leaderId: 'leader-1' },
      }),
    ],
    commissionRecords: [
      commission('order-zero', 'SALES_COMMISSION', 0),
      commission('order-zero', 'OUTREACH_COMMISSION', 0),
      commission('order-zero', 'LEADER_COMMISSION', 0),
    ],
    financeSummary: {
      totalDailyRebateCents: 0,
      totalMonthlyRebateCents: 0,
    },
  });
  assert.equal(calculatedZero.salesCommissionCalculated, true);
  assert.equal(calculatedZero.outreachCommissionCalculated, true);
  assert.equal(calculatedZero.leaderCommissionCalculated, true);
  assert.equal(calculatedZero.salesCommissionCents, 0);

  const missing = calculateTravelGroupProfit({
    travelGroup: group('group-missing-commission'),
    salesOrders: [order('order-missing-commission', { salesUserId: null })],
    commissionRecords: [],
    financeSummary: {
      totalDailyRebateCents: 0,
      totalMonthlyRebateCents: 0,
    },
  });
  assert.equal(missing.calculationStatus, 'incomplete');
  assert.equal(missing.estimatedProfitCents, null);
  assert.equal(missing.salesCommissionCalculated, false);
  assert.equal(missing.outreachCommissionCalculated, false);
  assert.equal(missing.leaderCommissionCalculated, false);
  assert.equal(
    missing.warnings.some(
      (warning) =>
        warning.code ===
        'SALES_USER_MISSING',
    ),
    true,
  );
});

test('unit: missing guide points summary blocks both daily and monthly profit components', () => {
  const result = calculateTravelGroupProfit({
    travelGroup: group('group-guide-summary-missing'),
    salesOrders: [
      order('order-guide-summary-missing', {
        personalAmountCents: 1000,
        personalPointsGuideId: 'guide-missing',
      }),
    ],
    commissionRecords: employeeZeroCommissions(
      'order-guide-summary-missing',
    ),
    financeSummary: {
      totalDailyRebateCents: 0,
      totalMonthlyRebateCents: 0,
    },
    guidePointsSummaries: [],
  });

  assert.equal(result.calculationStatus, 'incomplete');
  assert.equal(result.estimatedProfitCents, null);
  assert.equal(result.components.guideDailyPoints.status, 'blocked');
  assert.equal(result.components.guideMonthlyPoints.status, 'blocked');
  assert.deepEqual(
    result.components.guideDailyPoints.issues.map((issue) => issue.code),
    ['GUIDE_POINTS_SUMMARY_MISSING'],
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

test('unit: no effective sales still subtracts parking and cigarette expenses', () => {
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
  assert.equal(result.totalExpenseCents, 700);
  assert.equal(result.estimatedProfitCents, -700);
  assert.equal(result.estimatedProfitRate, null);
});

test('unit: missing cigarette fee takes precedence over no-sales and leaves profit incomplete', () => {
  const result = calculateTravelGroupProfit({
    travelGroup: group('group-missing-cigarette', {
      cigaretteFeeCents: null,
    }),
    salesOrders: [],
  });

  assert.equal(result.parkingFeeCents, 500);
  assert.equal(result.cigaretteFeeCents, null);
  assert.equal(result.calculationStatus, 'incomplete');
  assert.equal(result.estimatedProfitCents, null);
  assert.ok(
    result.warnings.some(
      (warning) => warning.code === 'CIGARETTE_FEE_MISSING',
    ),
  );
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
      ...employeeZeroCommissions('order-refund'),
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
  assert.equal(result.estimatedProfitCents, 5000);
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
      commission('order-loss', 'OUTREACH_COMMISSION', 0),
      commission('order-loss', 'LEADER_COMMISSION', 0),
    ],
    financeSummary: {
      totalDailyRebateCents: 200,
      totalMonthlyRebateCents: 100,
    },
  });

  assert.equal(result.calculationStatus, 'complete');
  assert.equal(result.totalExpenseCents, 2700);
  assert.equal(result.estimatedProfitCents, -1700);
  assert.equal(result.estimatedProfitRate, -1.7);
});

test('unit: marked mixed payments add per-order tax and same-day adjusted service fees', () => {
  const result = calculateTravelGroupProfit({
    travelGroup: group('group-fees'),
    salesOrders: [
      order('order-fees', {
        financeMark: true,
        taxRateSnapshot: '0.010000',
        status: 'PARTIAL_REFUND',
        totalAmountCents: 10000,
        items: [item('fee-line', 10000, 3000)],
        paymentDetails: [
          paymentDetail('wallet-detail', 'wallet', '收钱吧', 6000, '0.006000'),
          paymentDetail('card-detail', 'card', '银行卡', 4000, '0.010000'),
        ],
        afterSalesOrders: [
          {
            id: 'same-day-refund',
            refundAmountCents: 1000,
            financeConfirmed: true,
            refundPaymentDetailId: 'wallet-detail',
            refundOccurredAt: '2026-06-01T15:59:59.000Z',
            deductsPaymentServiceFee: true,
          },
        ],
      }),
    ],
    commissionRecords: employeeZeroCommissions('order-fees'),
    financeSummary: {
      totalDailyRebateCents: 0,
      totalMonthlyRebateCents: 0,
    },
  });

  assert.equal(result.effectiveSalesAmountCents, 9000);
  assert.equal(result.taxFeeCents, 90);
  assert.equal(result.paymentServiceFeeCents, 70);
  assert.equal(result.totalExpenseCents, 3860);
  assert.equal(result.estimatedProfitCents, 5140);
  assert.deepEqual(result.paymentMethodFeeBreakdown, [
    {
      paymentMethodId: 'wallet',
      paymentMethodNameSnapshot: '收钱吧',
      serviceFeeRateSnapshot: '0.006000',
      originalPaymentAmountCents: 6000,
      sameDayRefundAmountCents: 1000,
      serviceFeeBaseAmountCents: 5000,
      serviceFeeCents: 30,
      orderCount: 1,
    },
    {
      paymentMethodId: 'card',
      paymentMethodNameSnapshot: '银行卡',
      serviceFeeRateSnapshot: '0.010000',
      originalPaymentAmountCents: 4000,
      sameDayRefundAmountCents: 0,
      serviceFeeBaseAmountCents: 4000,
      serviceFeeCents: 40,
      orderCount: 1,
    },
  ]);
});

test('unit: a full cross-day refund keeps the captured payment service fee', () => {
  const result = calculateTravelGroupProfit({
    travelGroup: group('group-cross-day'),
    salesOrders: [
      order('order-cross-day', {
        financeMark: true,
        taxRateSnapshot: '0.01',
        status: 'PARTIAL_REFUND',
        totalAmountCents: 10000,
        items: [item('cross-day-line', 10000, 3000)],
        paymentDetails: [
          paymentDetail(
            'cross-day-detail',
            'wallet',
            '收钱吧',
            10000,
            '0.006',
          ),
        ],
        afterSalesOrders: [
          {
            id: 'cross-day-refund',
            refundAmountCents: 10000,
            financeConfirmed: true,
            refundPaymentDetailId: null,
            refundOccurredAt: '2026-06-01T16:00:00.000Z',
            deductsPaymentServiceFee: false,
          },
        ],
      }),
    ],
    financeSummary: {
      totalDailyRebateCents: 0,
      totalMonthlyRebateCents: 0,
    },
  });

  assert.equal(result.effectiveSalesAmountCents, 0);
  assert.equal(result.taxFeeCents, 0);
  assert.equal(result.paymentServiceFeeCents, 60);
  assert.equal(
    result.paymentMethodFeeBreakdown[0].sameDayRefundAmountCents,
    0,
  );
  assert.equal(
    result.paymentMethodFeeBreakdown[0].serviceFeeBaseAmountCents,
    10000,
  );
});

test('unit: missing marked-order fee snapshots stay null and make profit incomplete', () => {
  const result = calculateTravelGroupProfit({
    travelGroup: group('group-missing-fee'),
    salesOrders: [
      order('order-missing-fee', {
        financeMark: true,
        taxRateSnapshot: null,
        paymentDetails: [
          paymentDetail(
            'missing-fee-detail',
            'wallet',
            '收钱吧',
            10000,
            null,
          ),
        ],
      }),
    ],
    financeSummary: {
      totalDailyRebateCents: 0,
      totalMonthlyRebateCents: 0,
    },
  });

  assert.equal(result.taxFeeCents, null);
  assert.equal(result.paymentServiceFeeCents, null);
  assert.equal(result.calculationStatus, 'incomplete');
  assert.equal(result.estimatedProfitCents, null);
  assert.ok(
    result.warnings.some(
      (warning) =>
        warning.code === 'PAYMENT_SERVICE_FEE_SNAPSHOT_MISSING',
    ),
  );
  assert.equal(
    result.paymentMethodFeeBreakdown[0].serviceFeeCents,
    null,
  );
});

test('unit: payment fee breakdown groups by method id, name snapshot, and rate snapshot with distinct order counts', () => {
  const makeOrder = (id, paymentMethodNameSnapshot, rate) =>
    order(id, {
      financeMark: true,
      taxRateSnapshot: '0.01',
      totalAmountCents: 1000,
      items: [item(`${id}-line`, 1000, 100)],
      paymentDetails: [
        paymentDetail(
          `${id}-payment`,
          'shared-method',
          paymentMethodNameSnapshot,
          1000,
          rate,
        ),
      ],
    });
  const result = calculateTravelGroupProfit({
    travelGroup: group('group-breakdown'),
    salesOrders: [
      makeOrder('order-a', '收钱吧', '0.006000'),
      makeOrder('order-b', '收钱吧', '0.006000'),
      makeOrder('order-c', '收钱吧（旧名称）', '0.006000'),
      makeOrder('order-d', '收钱吧', '0.010000'),
    ],
    financeSummary: {
      totalDailyRebateCents: 0,
      totalMonthlyRebateCents: 0,
    },
  });

  assert.equal(result.paymentMethodFeeBreakdown.length, 3);
  assert.deepEqual(
    result.paymentMethodFeeBreakdown.map((row) => ({
      name: row.paymentMethodNameSnapshot,
      rate: row.serviceFeeRateSnapshot,
      original: row.originalPaymentAmountCents,
      orderCount: row.orderCount,
    })),
    [
      {
        name: '收钱吧',
        rate: '0.006000',
        original: 2000,
        orderCount: 2,
      },
      {
        name: '收钱吧（旧名称）',
        rate: '0.006000',
        original: 1000,
        orderCount: 1,
      },
      {
        name: '收钱吧',
        rate: '0.010000',
        original: 1000,
        orderCount: 1,
      },
    ],
  );
});

function group(id, overrides = {}) {
  return {
    id,
    groupNo: `TG-${id}`,
    visitDate: '2026-07-10',
    travelAgency: 'Test Agency',
    guideName: 'Test Guide',
    tasterName: 'Test Taster',
    guestCount: 20,
    parkingFeeCents: 500,
    cigaretteFeeCents: 200,
    ...overrides,
  };
}

function order(id, overrides = {}) {
  const items = overrides.items || [item(`${id}-line`, 10000, 3000)];
  const totalAmountCents =
    overrides.totalAmountCents ??
    items.reduce((total, line) => total + line.subtotalCents, 0);
  return {
    id,
    orderNo: `SO-${id}`,
    orderDate: '2026-06-01',
    travelGroupId: id.replace('order', 'group'),
    status: 'VALID',
    salesUserId: 'sales-default',
    totalAmountCents,
    logisticsFeeCents: 0,
    financeMark: true,
    taxRateSnapshot: '0.000000',
    paymentDetails: [
      paymentDetail(
        `${id}-payment`,
        'zero-fee',
        '零费率',
        totalAmountCents,
        '0.000000',
      ),
    ],
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
    commissionRuleId: `rule-${targetType.toLowerCase()}`,
    amountCents,
    pointsCents: 0,
  };
}

function employeeZeroCommissions(salesOrderId) {
  return [
    commission(salesOrderId, 'SALES_COMMISSION', 0),
    commission(salesOrderId, 'OUTREACH_COMMISSION', 0),
    commission(salesOrderId, 'LEADER_COMMISSION', 0),
  ];
}

function paymentDetail(
  id,
  paymentMethodId,
  paymentMethodNameSnapshot,
  amountCents,
  serviceFeeRateSnapshot,
) {
  return {
    id,
    paymentMethodId,
    paymentMethodNameSnapshot,
    amountCents,
    serviceFeeRateSnapshot,
    serviceFeeBaseAmountSnapshotCents: amountCents,
  };
}
