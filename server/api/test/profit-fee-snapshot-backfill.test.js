const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PROFIT_FEE_BACKFILL_TAX_RATE,
  backfillProfitFeeSnapshots,
  parseProfitFeeBackfillArgs,
} = require('../scripts/backfill-profit-fee-snapshots');

const BACKFILL_TIME = new Date('2026-07-30T03:04:05.000Z');

test('profit fee snapshot backfill defaults to dry-run and requires explicit apply', () => {
  assert.deepEqual(parseProfitFeeBackfillArgs([]), {
    apply: false,
    help: false,
  });
  assert.deepEqual(parseProfitFeeBackfillArgs(['--apply']), {
    apply: true,
    help: false,
  });
  assert.deepEqual(
    parseProfitFeeBackfillArgs(['--report', 'reports/dry-run.json']),
    {
      apply: false,
      help: false,
      reportPath: 'reports/dry-run.json',
    },
  );
  assert.throws(
    () => parseProfitFeeBackfillArgs(['--unknown']),
    /Unknown option/,
  );
});

test('dry-run reports eligible orders, missing rates and unknown historical refunds without writes or customer privacy', async () => {
  const fixture = createFixture();
  const prisma = createPrisma(fixture);

  const report = await backfillProfitFeeSnapshots(prisma, {
    now: BACKFILL_TIME,
  });

  assert.equal(report.mode, 'DRY_RUN');
  assert.equal(report.taxRateSnapshot, PROFIT_FEE_BACKFILL_TAX_RATE);
  assert.equal(report.scannedOrderCount, 3);
  assert.equal(report.snapshotMissingOrderCount, 2);
  assert.equal(report.backfillableOrderCount, 1);
  assert.equal(report.appliedOrderCount, 0);
  assert.deepEqual(report.missingRatePaymentMethods, [
    {
      paymentMethodId: 'pm_missing',
      paymentMethodName: '未配置费率方式',
      reason: 'MISSING',
      affectedOrderCount: 1,
    },
  ]);
  assert.equal(report.missingRateOrders.length, 1);
  assert.equal(
    report.missingRateOrders[0].salesOrderId,
    'so_missing_rate',
  );
  assert.deepEqual(
    report.historicalRefundPaymentDetailUnknownOrders,
    [
      {
        salesOrderId: 'so_eligible',
        orderNo: 'SO-ELIGIBLE',
        confirmedRefundCount: 1,
        confirmedRefundAmountCents: 3000,
      },
    ],
  );
  assert.equal(prisma.writeCount(), 0);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('敏感客户'), false);
  assert.equal(serialized.includes('13800138000'), false);
  assert.equal(serialized.includes('客户地址'), false);
});

test('apply fills only missing snapshots, accepts zero rate, preserves existing snapshots and is idempotent', async () => {
  const fixture = createFixture();
  const refundBefore = structuredClone(
    fixture.orders.find((order) => order.id === 'so_eligible')
      .afterSalesOrders,
  );
  const prisma = createPrisma(fixture);

  const first = await backfillProfitFeeSnapshots(prisma, {
    apply: true,
    now: BACKFILL_TIME,
  });

  assert.equal(first.backfillableOrderCount, 1);
  assert.equal(first.appliedOrderCount, 1);
  const eligible = fixture.orders.find(
    (order) => order.id === 'so_eligible',
  );
  assert.equal(
    eligible.taxRateSnapshot,
    PROFIT_FEE_BACKFILL_TAX_RATE,
  );
  assert.equal(
    eligible.profitFeeSnapshottedAt.toISOString(),
    BACKFILL_TIME.toISOString(),
  );
  assert.equal(eligible.profitFeeSnapshottedById, null);
  assert.equal(
    eligible.paymentDetails[0].serviceFeeRateSnapshot,
    '0.006000',
  );
  assert.equal(
    eligible.paymentDetails[0].serviceFeeBaseAmountSnapshotCents,
    70000,
  );
  assert.equal(
    eligible.paymentDetails[1].serviceFeeRateSnapshot,
    '0',
  );
  assert.equal(
    eligible.paymentDetails[1].serviceFeeBaseAmountSnapshotCents,
    30000,
  );
  assert.equal(
    eligible.paymentDetails[2].serviceFeeRateSnapshot,
    '0.004000',
    'an existing historical rate snapshot must not be overwritten by the current rate',
  );
  assert.equal(
    eligible.paymentDetails[2].serviceFeeBaseAmountSnapshotCents,
    10000,
  );
  assert.deepEqual(eligible.afterSalesOrders, refundBefore);

  const writtenState = structuredClone(eligible);
  const second = await backfillProfitFeeSnapshots(prisma, {
    apply: true,
    now: new Date('2026-07-31T03:04:05.000Z'),
  });

  assert.equal(second.backfillableOrderCount, 0);
  assert.equal(second.appliedOrderCount, 0);
  assert.deepEqual(eligible, writtenState);
  assert.equal(
    fixture.orders.find((order) => order.id === 'so_missing_rate')
      .taxRateSnapshot,
    null,
    'an order with any missing current payment-method rate must be skipped atomically',
  );
  assert.equal(
    fixture.orders.find((order) => order.id === 'so_unmarked')
      .taxRateSnapshot,
    null,
    'unmarked orders are outside the scan and write scope',
  );
});

function createFixture() {
  return {
    orders: [
      {
        id: 'so_eligible',
        orderNo: 'SO-ELIGIBLE',
        financeMark: true,
        taxRateSnapshot: null,
        profitFeeSnapshottedAt: null,
        profitFeeSnapshottedById: null,
        customerName: '敏感客户',
        customerPhone: '13800138000',
        address: '客户地址',
        paymentDetails: [
          {
            id: 'pd_006',
            salesOrderId: 'so_eligible',
            paymentMethodId: 'pm_006',
            paymentMethodNameSnapshot: 'POS',
            amountCents: 70000,
            serviceFeeRateSnapshot: null,
            serviceFeeBaseAmountSnapshotCents: null,
            paymentMethod: {
              id: 'pm_006',
              name: 'POS',
              serviceFeeRate: '0.006000',
            },
          },
          {
            id: 'pd_zero',
            salesOrderId: 'so_eligible',
            paymentMethodId: 'pm_zero',
            paymentMethodNameSnapshot: '现金',
            amountCents: 30000,
            serviceFeeRateSnapshot: null,
            serviceFeeBaseAmountSnapshotCents: null,
            paymentMethod: {
              id: 'pm_zero',
              name: '现金',
              serviceFeeRate: '0',
            },
          },
          {
            id: 'pd_existing_rate',
            salesOrderId: 'so_eligible',
            paymentMethodId: 'pm_changed',
            paymentMethodNameSnapshot: '历史方式',
            amountCents: 10000,
            serviceFeeRateSnapshot: '0.004000',
            serviceFeeBaseAmountSnapshotCents: null,
            paymentMethod: {
              id: 'pm_changed',
              name: '历史方式',
              serviceFeeRate: '0.007000',
            },
          },
        ],
        afterSalesOrders: [
          {
            id: 'as_unknown',
            financeConfirmed: true,
            refundAmountCents: 3000,
            refundPaymentDetailId: null,
            deductsPaymentServiceFee: true,
          },
        ],
      },
      {
        id: 'so_missing_rate',
        orderNo: 'SO-MISSING-RATE',
        financeMark: true,
        taxRateSnapshot: null,
        profitFeeSnapshottedAt: null,
        profitFeeSnapshottedById: null,
        paymentDetails: [
          {
            id: 'pd_missing',
            salesOrderId: 'so_missing_rate',
            paymentMethodId: 'pm_missing',
            paymentMethodNameSnapshot: '未配置费率方式',
            amountCents: 50000,
            serviceFeeRateSnapshot: null,
            serviceFeeBaseAmountSnapshotCents: null,
            paymentMethod: {
              id: 'pm_missing',
              name: '未配置费率方式',
              serviceFeeRate: null,
            },
          },
        ],
        afterSalesOrders: [],
      },
      {
        id: 'so_complete',
        orderNo: 'SO-COMPLETE',
        financeMark: true,
        taxRateSnapshot: '0.010000',
        profitFeeSnapshottedAt: new Date('2026-07-29T00:00:00.000Z'),
        profitFeeSnapshottedById: 'usr_finance',
        paymentDetails: [
          {
            id: 'pd_complete',
            salesOrderId: 'so_complete',
            paymentMethodId: 'pm_complete',
            paymentMethodNameSnapshot: '已完成',
            amountCents: 20000,
            serviceFeeRateSnapshot: '0.005000',
            serviceFeeBaseAmountSnapshotCents: 20000,
            paymentMethod: {
              id: 'pm_complete',
              name: '已完成',
              serviceFeeRate: null,
            },
          },
        ],
        afterSalesOrders: [],
      },
      {
        id: 'so_unmarked',
        orderNo: 'SO-UNMARKED',
        financeMark: false,
        taxRateSnapshot: null,
        profitFeeSnapshottedAt: null,
        profitFeeSnapshottedById: null,
        paymentDetails: [],
        afterSalesOrders: [],
      },
    ],
  };
}

function createPrisma(fixture) {
  let writes = 0;

  const salesOrder = {
    async findMany() {
      return fixture.orders
        .filter((order) => order.financeMark)
        .sort((left, right) => left.id.localeCompare(right.id));
    },
    async findUnique({ where }) {
      return fixture.orders.find((order) => order.id === where.id) ?? null;
    },
    async updateMany({ where, data }) {
      const order = fixture.orders.find((row) => row.id === where.id);
      if (!order || !order.financeMark) return { count: 0 };
      if (
        Object.hasOwn(data, 'taxRateSnapshot') &&
        order.taxRateSnapshot !== null
      ) {
        return { count: 0 };
      }
      if (
        Object.hasOwn(data, 'profitFeeSnapshottedAt') &&
        order.profitFeeSnapshottedAt !== null
      ) {
        return { count: 0 };
      }
      Object.assign(order, data);
      writes += 1;
      return { count: 1 };
    },
  };

  const salesOrderPaymentDetail = {
    async updateMany({ where, data }) {
      const order = fixture.orders.find(
        (row) => row.id === where.salesOrderId && row.financeMark,
      );
      const detail = order?.paymentDetails.find(
        (row) => row.id === where.id,
      );
      if (!detail) return { count: 0 };
      if (
        Object.hasOwn(data, 'serviceFeeRateSnapshot') &&
        detail.serviceFeeRateSnapshot !== null
      ) {
        return { count: 0 };
      }
      if (
        Object.hasOwn(data, 'serviceFeeBaseAmountSnapshotCents') &&
        detail.serviceFeeBaseAmountSnapshotCents !== null
      ) {
        return { count: 0 };
      }
      Object.assign(detail, data);
      writes += 1;
      return { count: 1 };
    },
  };

  const transactionClient = {
    salesOrder,
    salesOrderPaymentDetail,
  };
  return {
    salesOrder,
    salesOrderPaymentDetail,
    async $transaction(callback) {
      return callback(transactionClient);
    },
    writeCount() {
      return writes;
    },
  };
}
