const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAfterSalesCommissionAdjustmentRecords,
  calculateProportionalAfterSalesDeductionCents,
} = require('../src/modules/business-data/business-data.nest.service');
const {
  backfillAfterSalesIndependentOrders,
} = require('../scripts/backfill-after-sales-independent-orders');

test('unit: after-sales adjustment records are independent negative entries', () => {
  const records = buildAfterSalesCommissionAdjustmentRecords(
    createAdjustmentFixture(),
  );

  assert.equal(records.length, 3);
  assert.equal(records.every((record) => record.salesOrderId === 'so_as_1'), true);
  assert.equal(
    records.every((record) => record.afterSalesOrderId === 'as_1'),
    true,
  );
  assert.equal(records.every((record) => record.grossAmountCents < 0), true);
  assert.equal(records.every((record) => record.amountCents <= 0), true);
  assert.equal(records.every((record) => record.pointsCents <= 0), true);
  assert.equal(records.every((record) => record.isConfirmed), true);
  assert.equal(
    records.find((record) => record.targetType === 'TASTER_COMMISSION')
      .amountCents,
    -50,
  );
  assert.equal(
    records.find((record) => record.targetType === 'AGENCY_DAILY_REBATE')
      .pointsCents,
    -38,
  );
});

test('unit: proportional after-sales deduction uses deterministic cents rounding and remaining cap', () => {
  assert.equal(
    calculateProportionalAfterSalesDeductionCents({
      sourceAgencyDeductionCents: 300000,
      refundAmountCents: 200000,
      sourceOrderAmountCents: 1000000,
    }),
    60000,
  );
  assert.equal(
    calculateProportionalAfterSalesDeductionCents({
      sourceAgencyDeductionCents: 100,
      refundAmountCents: 1,
      sourceOrderAmountCents: 3,
    }),
    1,
  );
  assert.equal(
    calculateProportionalAfterSalesDeductionCents({
      sourceAgencyDeductionCents: 100,
      refundAmountCents: 50,
      sourceOrderAmountCents: 100,
      existingDeductionCents: 90,
    }),
    10,
  );
});

test('unit: after-sales finance formula matches the proportional example', () => {
  const fixture = createAdjustmentFixture();
  fixture.sourceSalesOrder.totalAmountCents = 1000000;
  fixture.afterSalesOrder.refundAmountCents = 200000;
  fixture.afterSalesOrder.sourceAgencyDeductionCents = 300000;
  fixture.afterSalesOrder.agencyDeductionAdjustmentCents = 60000;
  fixture.afterSalesOrder.dailyRebateRate = 0.1;
  fixture.afterSalesOrder.monthlyRebateRate = 0;

  const records = buildAfterSalesCommissionAdjustmentRecords(fixture);
  const daily = records.find(
    (record) => record.targetType === 'AGENCY_DAILY_REBATE',
  );
  assert.equal(daily.grossAmountCents, -200000);
  assert.equal(daily.deductionAmountCents, -60000);
  assert.equal(daily.baseAmountCents, -140000);
  assert.equal(daily.pointsCents, -14000);
});

test('unit: historical after-sales backfill is idempotent and never duplicates adjustments', async () => {
  const fixture = createAdjustmentFixture();
  const sourceBefore = structuredClone(fixture.sourceSalesOrder);
  const adjustmentRows = [];
  const prisma = createBackfillPrisma(fixture, adjustmentRows);

  const first = await backfillAfterSalesIndependentOrders(prisma);
  assert.equal(first.processedAfterSalesOrders, 1);
  assert.equal(first.createdAdjustmentRecords, 3);
  assert.equal(adjustmentRows.length, 3);

  const second = await backfillAfterSalesIndependentOrders(prisma);
  assert.equal(second.processedAfterSalesOrders, 1);
  assert.equal(second.createdAdjustmentRecords, 0);
  assert.equal(second.updatedAdjustmentRecords, 3);
  assert.equal(adjustmentRows.length, 3);
  assert.deepEqual(fixture.sourceSalesOrder, sourceBefore);
  assert.equal(
    adjustmentRows.every(
      (record) =>
        record.amountCents <= 0 &&
        record.pointsCents <= 0 &&
        record.deductionAmountCents <= 0,
    ),
    true,
  );
});

function createAdjustmentFixture() {
  const sourceSalesOrder = {
    id: 'so_source_1',
    orderNo: 'SO-SOURCE-1',
    totalAmountCents: 10000,
    travelGroupId: 'tg_1',
    travelGroup: {
      id: 'tg_1',
      travelAgency: '测试旅行社',
    },
  };
  const afterSalesOrder = {
    id: 'as_1',
    afterSalesNo: 'AS20260727001',
    salesOrderId: sourceSalesOrder.id,
    afterSalesSalesOrderId: 'so_as_1',
    refundAmountCents: 2000,
    deductionCalculationMode: 'effective_sales_rate',
    sourceAgencyDeductionCents: 500,
    agencyDeductionRate: 0.05,
    dailyRebateRate: 0.02,
    monthlyRebateRate: 0.01,
    agencyDeductionRuleId: 'adr_1',
    agencyRebateRuleId: 'arr_1',
    calculationDate: new Date('2026-07-27T00:00:00.000Z'),
    agencyDeductionAdjustmentCents: 100,
    financialEffectStatus: 'CONFIRMED',
    financeConfirmed: true,
    financeConfirmedById: 'usr_finance',
    financeConfirmedAt: new Date('2026-07-27T01:00:00.000Z'),
    createdById: 'usr_after_sales',
    updatedById: 'usr_finance',
    salesOrder: sourceSalesOrder,
  };
  const sourceRecords = [
    {
      id: 'cr_taster',
      salesOrderId: sourceSalesOrder.id,
      afterSalesOrderId: null,
      targetType: 'TASTER_COMMISSION',
      targetUserId: 'usr_taster',
      commissionRuleId: 'rule_taster',
      grossAmountCents: 10000,
      baseAmountCents: 10000,
      deductionAmountCents: 0,
      rateSnapshot: 0.025,
      amountCents: 250,
      pointsCents: 0,
      ruleSnapshot: { rule: 'original' },
    },
    {
      id: 'cr_daily',
      salesOrderId: sourceSalesOrder.id,
      afterSalesOrderId: null,
      targetType: 'AGENCY_DAILY_REBATE',
      agencyId: 'agency_1',
      agencyName: '测试旅行社',
      agencyRebateRuleId: 'arr_1',
      deductionAmountCents: 500,
      rateSnapshot: 0.02,
      pointsCents: 190,
    },
    {
      id: 'cr_monthly',
      salesOrderId: sourceSalesOrder.id,
      afterSalesOrderId: null,
      targetType: 'AGENCY_MONTHLY_REBATE',
      agencyId: 'agency_1',
      agencyName: '测试旅行社',
      agencyRebateRuleId: 'arr_1',
      deductionAmountCents: 500,
      rateSnapshot: 0.01,
      pointsCents: 95,
    },
  ];
  return {
    afterSalesOrder,
    sourceSalesOrder,
    sourceRecords,
    actor: { id: 'usr_finance' },
  };
}

function createBackfillPrisma(fixture, adjustmentRows) {
  const commissionRecord = {
    async findMany({ where }) {
      if (where.afterSalesOrderId === null) {
        return fixture.sourceRecords.map((record) => structuredClone(record));
      }
      return adjustmentRows
        .filter((row) => row.afterSalesOrderId === where.afterSalesOrderId)
        .map((record) => structuredClone(record));
    },
    async create({ data }) {
      const row = {
        id: `adjustment_${adjustmentRows.length + 1}`,
        ...structuredClone(data),
      };
      adjustmentRows.push(row);
      return structuredClone(row);
    },
    async update({ where, data }) {
      const index = adjustmentRows.findIndex((row) => row.id === where.id);
      adjustmentRows[index] = {
        ...adjustmentRows[index],
        ...structuredClone(data),
      };
      return structuredClone(adjustmentRows[index]);
    },
  };
  const transactionClient = {
    afterSalesOrder: {
      async findUnique({ where }) {
        return where.id === fixture.afterSalesOrder.id
          ? structuredClone(fixture.afterSalesOrder)
          : null;
      },
    },
    commissionRecord,
  };
  return {
    afterSalesOrder: {
      async findMany({ cursor }) {
        if (cursor) {
          return [];
        }
        return [{ id: fixture.afterSalesOrder.id }];
      },
    },
    async $transaction(callback) {
      return callback(transactionClient);
    },
  };
}
