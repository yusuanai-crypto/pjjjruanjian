const assert = require('node:assert/strict');
const test = require('node:test');

const {
  aggregateSameDayRefundsByPaymentDetail,
  calculateOrderProfitFees,
  isSameShanghaiNaturalDay,
  roundHalfUpDivision,
} = require('../src/modules/analytics/profit-tax-service-fee.helper');

test('unit: an unmarked order contributes no tax or payment service fee', () => {
  const result = calculateOrderProfitFees(
    order({
      financeMark: false,
      taxRateSnapshot: null,
      paymentDetails: [
        payment('payment-1', 'cash', 10000, null),
      ],
    }),
  );

  assert.equal(result.effectiveAmountCents, 0);
  assert.equal(result.taxCents, 0);
  assert.equal(result.paymentServiceFeeCents, 0);
  assert.equal(result.totalTaxAndServiceFeeCents, 0);
  assert.equal(result.missingSnapshots.hasMissingSnapshots, false);
});

test('unit: a marked order calculates 1% tax from its effective amount', () => {
  const result = calculateOrderProfitFees(
    order({
      totalAmountCents: 10000,
      paymentDetails: [
        payment('payment-1', 'cash', 10000, '0'),
      ],
    }),
  );

  assert.equal(result.effectiveAmountCents, 10000);
  assert.equal(result.taxRateSnapshot, '0.01');
  assert.equal(result.taxCents, 100);
});

test('unit: mixed payments calculate and group each detail independently', () => {
  const result = calculateOrderProfitFees(
    order({
      paymentDetails: [
        payment('wechat-detail', 'wechat', 7000, '0.006'),
        payment('card-detail', 'bank_card', 3000, '0.01'),
      ],
    }),
  );

  assert.deepEqual(
    result.paymentDetails.map((detail) => detail.serviceFeeCents),
    [42, 30],
  );
  assert.equal(result.paymentServiceFeeCents, 72);
  assert.deepEqual(
    result.paymentMethods.map((method) => ({
      name: method.paymentMethodName,
      fee: method.serviceFeeCents,
    })),
    [
      { name: 'wechat', fee: 42 },
      { name: 'bank_card', fee: 30 },
    ],
  );
});

test('unit: an explicit 0% fee snapshot is complete and calculates zero', () => {
  const result = calculateOrderProfitFees(
    order({
      paymentDetails: [
        payment('cash-detail', 'cash', 10000, '0'),
      ],
    }),
  );

  assert.equal(result.paymentServiceFeeCents, 0);
  assert.equal(result.missingSnapshots.hasMissingSnapshots, false);
});

test('unit: exact half rounds up and rounding occurs per payment detail', () => {
  assert.equal(roundHalfUpDivision(49n, 100n), 0n);
  assert.equal(roundHalfUpDivision(50n, 100n), 1n);

  const result = calculateOrderProfitFees(
    order({
      totalAmountCents: 100,
      paymentDetails: [
        payment('half-1', 'same_method', 50, '0.01'),
        payment('half-2', 'same_method', 50, '0.01'),
      ],
    }),
  );

  assert.deepEqual(
    result.paymentDetails.map((detail) => detail.serviceFeeCents),
    [1, 1],
  );
  assert.equal(result.paymentServiceFeeCents, 2);
  assert.equal(result.paymentMethods[0].serviceFeeCents, 2);
});

test('unit: same-day refund reduces only its selected payment detail', () => {
  const result = calculateOrderProfitFees(
    order({
      paymentDetails: [
        payment('wechat-detail', 'wechat', 6000, '0.01'),
        payment('card-detail', 'bank_card', 4000, '0.01'),
      ],
      afterSalesOrders: [
        refund({
          refundPaymentDetailId: 'wechat-detail',
          refundAmountCents: 2000,
          refundOccurredAt: '2026-07-30T08:00:00.000Z',
          deductsPaymentServiceFee: true,
        }),
      ],
    }),
  );

  assert.deepEqual(
    result.paymentDetails.map((detail) => ({
      id: detail.paymentDetailId,
      base: detail.serviceFeeChargeableBaseAmountCents,
      fee: detail.serviceFeeCents,
    })),
    [
      { id: 'wechat-detail', base: 4000, fee: 40 },
      { id: 'card-detail', base: 4000, fee: 40 },
    ],
  );
  assert.equal(result.paymentServiceFeeCents, 80);
});

test('unit: cross-day refund does not reduce payment service fee', () => {
  const result = calculateOrderProfitFees(
    order({
      afterSalesOrders: [
        refund({
          refundAmountCents: 2000,
          refundOccurredAt: '2026-07-30T16:00:00.000Z',
          deductsPaymentServiceFee: false,
        }),
      ],
    }),
  );

  assert.equal(result.effectiveAmountCents, 8000);
  assert.equal(result.taxCents, 80);
  assert.equal(result.paymentServiceFeeCents, 100);
});

test('unit: full cross-day refund makes tax zero while retaining service fee', () => {
  const result = calculateOrderProfitFees(
    order({
      afterSalesOrders: [
        refund({
          refundAmountCents: 10000,
          refundOccurredAt: '2026-07-30T16:00:00.000Z',
          deductsPaymentServiceFee: false,
        }),
      ],
    }),
  );

  assert.equal(result.effectiveAmountCents, 0);
  assert.equal(result.taxCents, 0);
  assert.equal(result.paymentServiceFeeCents, 100);
  assert.equal(result.totalTaxAndServiceFeeCents, 100);
});

test('unit: multiple confirmed same-day refunds accumulate by payment detail', () => {
  const afterSalesOrders = [
    refund({
      refundAmountCents: 1000,
      refundOccurredAt: '2026-07-30T01:00:00.000Z',
      deductsPaymentServiceFee: true,
    }),
    refund({
      refundAmountCents: 1500,
      refundOccurredAt: '2026-07-30T12:00:00.000Z',
      deductsPaymentServiceFee: true,
    }),
  ];
  assert.deepEqual(
    aggregateSameDayRefundsByPaymentDetail(
      '2026-07-30',
      afterSalesOrders,
    ),
    { 'payment-1': 2500 },
  );

  const result = calculateOrderProfitFees(order({ afterSalesOrders }));
  assert.equal(
    result.paymentDetails[0].serviceFeeChargeableBaseAmountCents,
    7500,
  );
  assert.equal(result.paymentServiceFeeCents, 75);
});

test('unit: an unconfirmed refund has no effective or fee impact', () => {
  const result = calculateOrderProfitFees(
    order({
      afterSalesOrders: [
        refund({
          financeConfirmed: false,
          refundAmountCents: 3000,
          refundOccurredAt: '2026-07-30T08:00:00.000Z',
          deductsPaymentServiceFee: true,
        }),
      ],
    }),
  );

  assert.equal(result.effectiveAmountCents, 10000);
  assert.equal(result.taxCents, 100);
  assert.equal(result.paymentServiceFeeCents, 100);
});

test('unit: Asia/Shanghai 23:59 is same day and 00:00 is next day', () => {
  assert.equal(
    isSameShanghaiNaturalDay(
      '2026-07-30',
      '2026-07-30T15:59:59.000Z',
    ),
    true,
  );
  assert.equal(
    isSameShanghaiNaturalDay(
      '2026-07-30',
      '2026-07-30T16:00:00.000Z',
    ),
    false,
  );

  const result = calculateOrderProfitFees(
    order({
      paymentDetails: [
        payment('before-midnight', 'wechat', 5000, '0.01'),
        payment('after-midnight', 'bank_card', 5000, '0.01'),
      ],
      afterSalesOrders: [
        refund({
          refundPaymentDetailId: 'before-midnight',
          refundAmountCents: 1000,
          refundOccurredAt: '2026-07-30T15:59:59.000Z',
          deductsPaymentServiceFee: true,
        }),
        refund({
          refundPaymentDetailId: 'after-midnight',
          refundAmountCents: 1000,
          refundOccurredAt: '2026-07-30T16:00:00.000Z',
          deductsPaymentServiceFee: false,
        }),
      ],
    }),
  );
  assert.deepEqual(
    result.paymentDetails.map((detail) => detail.serviceFeeCents),
    [40, 50],
  );
});

test('unit: a missing rate snapshot stays unknown instead of becoming 0%', () => {
  const result = calculateOrderProfitFees(
    order({
      paymentDetails: [
        payment('missing-rate', 'legacy_method', 10000, null),
      ],
    }),
  );

  assert.equal(result.taxCents, 100);
  assert.equal(result.paymentDetails[0].serviceFeeCents, null);
  assert.equal(result.paymentServiceFeeCents, null);
  assert.equal(result.totalTaxAndServiceFeeCents, null);
  assert.equal(result.missingSnapshots.hasMissingSnapshots, true);
  assert.deepEqual(result.missingSnapshots.issues, [
    {
      code: 'PAYMENT_SERVICE_FEE_RATE_SNAPSHOT_MISSING',
      paymentDetailId: 'missing-rate',
    },
  ]);
});

function order(overrides = {}) {
  return {
    id: 'order-1',
    financeMark: true,
    status: 'PARTIAL_REFUND',
    orderDate: '2026-07-30',
    totalAmountCents: 10000,
    taxRateSnapshot: '0.01',
    paymentDetails: [
      payment('payment-1', 'wechat', 10000, '0.01'),
    ],
    afterSalesOrders: [],
    ...overrides,
  };
}

function payment(id, methodName, amountCents, rate) {
  return {
    id,
    paymentMethodId: `method-${methodName}`,
    paymentMethodNameSnapshot: methodName,
    amountCents,
    serviceFeeRateSnapshot: rate,
    serviceFeeBaseAmountSnapshotCents: amountCents,
  };
}

function refund(overrides = {}) {
  return {
    id: `refund-${Math.random()}`,
    financeConfirmed: true,
    refundPaymentDetailId: 'payment-1',
    refundAmountCents: 1000,
    refundOccurredAt: '2026-07-30T08:00:00.000Z',
    deductsPaymentServiceFee: true,
    ...overrides,
  };
}
