const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TravelGroupFinanceSummaryNestService,
} = require('../src/modules/commissions/travel-group-finance-summary.nest.service');
const {
  OperationLogsNestService,
} = require('../src/modules/operation-logs/operation-log.nest.service');

test('unit: stage7 travel group finance summary service creates summary', async () => {
  const prisma = createSummaryPrisma();
  const service = createService(prisma);

  const result = await service.refreshTravelGroupFinanceSummary('group-stage7', {
    actor: { id: 'user-finance' },
    ipAddress: '127.0.0.1',
  });

  assert.equal(result.amountChanged, true);
  assert.equal(prisma.__store.summaries.length, 1);
  assertSummaryAmounts(prisma.__store.summaries[0], {
    totalSalesAmountCents: 1500000,
    confirmedRefundAmountCents: 100000,
    effectiveSalesAmountCents: 1400000,
    totalAgencyDeductionCents: 170000,
    totalAgencyNetAmountCents: 1230000,
    totalDailyRebateCents: 36900,
    totalMonthlyRebateCents: 24600,
    paidRebateCents: 0,
    unpaidRebateCents: 61500,
  });
  assert.equal(
    prisma.__store.summaries[0].calculationVersion,
    'stage7_v1',
  );
  assert.equal(prisma.__store.operationLogs.length, 1);
  assert.equal(
    prisma.__store.operationLogs[0].action,
    'travel_group_finance_summaries.refresh',
  );
  assertStage7SummaryServiceLog(prisma.__store.operationLogs[0], {
    action: 'travel_group_finance_summaries.refresh',
    entityType: 'travel_group_finance_summary',
    userId: 'user-finance',
    ipAddress: '127.0.0.1',
  });
  assert.equal(prisma.__store.operationLogs[0].beforeData, null);
  assert.equal(
    'sourceSnapshot' in prisma.__store.operationLogs[0].afterData,
    false,
  );
});

test('unit: stage7 travel group finance summary refreshes existing row and preserves paid rebate', async () => {
  const prisma = createSummaryPrisma({
    summary: {
      id: 'summary-existing',
      travelGroupId: 'group-stage7',
      paidRebateCents: 10000,
      notes: 'stage7 test existing paid rebate note',
      guideInfoSent: true,
      travelAgencyInfoSent: true,
    },
  });
  const service = createService(prisma);

  await service.refreshTravelGroupFinanceSummary('group-stage7');

  assert.equal(prisma.__store.summaries.length, 1);
  assert.equal(prisma.__store.summaries[0].id, 'summary-existing');
  assert.equal(prisma.__store.summaries[0].paidRebateCents, 10000);
  assert.equal(prisma.__store.summaries[0].unpaidRebateCents, 51500);
  assert.equal(
    prisma.__store.summaries[0].notes,
    'stage7 test existing paid rebate note',
  );
  assert.equal(prisma.__store.summaries[0].guideInfoSent, true);
  assert.equal(prisma.__store.summaries[0].travelAgencyInfoSent, true);
});

test('unit: stage7 travel group finance summary calculates effective sales amount', async () => {
  const prisma = createSummaryPrisma({
    salesOrders: [
      salesOrder({
        id: 'order-refunded',
        orderNo: 'SO-STAGE7-SUMMARY-REFUNDED',
        status: 'REFUNDED',
        totalAmountCents: 500000,
        confirmedRefundAmountCents: 100000,
      }),
      salesOrder({
        id: 'order-cancelled',
        orderNo: 'SO-STAGE7-SUMMARY-CANCELLED',
        status: 'CANCELLED',
        totalAmountCents: 300000,
      }),
      salesOrder({
        id: 'order-partial',
        orderNo: 'SO-STAGE7-SUMMARY-PARTIAL',
        status: 'PARTIAL_REFUND',
        totalAmountCents: 200000,
        confirmedRefundAmountCents: 50000,
      }),
    ],
    commissionRecords: [],
  });
  const service = createService(prisma);

  await service.refreshTravelGroupFinanceSummary('group-stage7');

  assertSummaryAmounts(prisma.__store.summaries[0], {
    totalSalesAmountCents: 1000000,
    confirmedRefundAmountCents: 150000,
    effectiveSalesAmountCents: 150000,
  });
});

test('unit: stage7 travel group finance summary resets deduction confirmation when amounts change', async () => {
  const prisma = createSummaryPrisma({
    summary: {
      id: 'summary-confirmed',
      travelGroupId: 'group-stage7',
      totalAgencyDeductionCents: 160000,
      agencyDeductionConfirmed: true,
      agencyDeductionConfirmedById: 'user-finance-confirmed',
      agencyDeductionConfirmedAt: new Date('2026-07-18T10:00:00.000Z'),
    },
  });
  const service = createService(prisma);

  const result = await service.refreshTravelGroupFinanceSummary('group-stage7');

  assert.equal(result.agencyDeductionConfirmationReset, true);
  assert.equal(prisma.__store.summaries[0].agencyDeductionConfirmed, false);
  assert.equal(prisma.__store.summaries[0].agencyDeductionConfirmedById, null);
  assert.equal(prisma.__store.summaries[0].agencyDeductionConfirmedAt, null);
});

test('unit: stage7 travel group finance summary source snapshot keeps traceability data', async () => {
  const prisma = createSummaryPrisma();
  const service = createService(prisma);

  await service.refreshTravelGroupFinanceSummary('group-stage7');

  const snapshot = prisma.__store.summaries[0].sourceSnapshot;
  assert.equal(snapshot.travelGroup.id, 'group-stage7');
  assert.equal(snapshot.orders.length, 2);
  assert.equal(snapshot.orders[0].items.length, 2);
  assert.equal(snapshot.confirmedRefunds.length, 1);
  assert.equal(snapshot.unconfirmedRefundSummary.count, 1);
  assert.equal(snapshot.agencyRebateRecords.daily.length, 2);
  assert.equal(snapshot.agencyRebateRecords.monthly.length, 2);
  assert.equal(snapshot.ruleSummary.agencyDeductionRules.length, 2);
  assert.equal(
    snapshot.ruleSummary.agencyRebateRules.some(
      (rule) => rule.id === 'rule-agency-rebate',
    ),
    true,
  );
});

test('unit: stage7 travel group finance summary syncs compatibility fields', async () => {
  const prisma = createSummaryPrisma({
    summary: {
      id: 'summary-paid',
      travelGroupId: 'group-stage7',
      paidRebateCents: 10000,
    },
  });
  const service = createService(prisma);

  await service.refreshTravelGroupFinanceSummary('group-stage7');

  assert.equal(prisma.__store.travelGroup.points, 61500);
  assert.equal(prisma.__store.travelGroup.returnedPoints, 10000);
  assert.equal(prisma.__store.travelGroup.unreturnedPoints, 51500);
  assert.equal(prisma.__store.travelGroup.salesAmountCents, 1500000);
  assert.equal(prisma.__store.travelGroup.liquorCostDeductionCents, 170000);
  assert.equal(prisma.__store.travelGroup.orderAmountCents, 1230000);
});

function createService(prisma) {
  return new TravelGroupFinanceSummaryNestService(
    prisma,
    new OperationLogsNestService(prisma),
  );
}

function assertStage7SummaryServiceLog(log, expected) {
  assert.equal(typeof log.id, 'string');
  assert.equal(log.action, expected.action);
  assert.equal(log.entityType, expected.entityType);
  assert.equal(typeof log.entityId, 'string');
  assert.equal(log.userId, expected.userId);
  assert.equal(log.ipAddress, expected.ipAddress);
  assert.ok(log.afterData);
  const serialized = JSON.stringify(log);
  assert.equal(/Password123|secret-token|DATABASE_URL/i.test(serialized), false);
}

function createSummaryPrisma(overrides = {}) {
  const store = {
    travelGroup: {
      id: 'group-stage7',
      groupNo: 'TG-STAGE7-SUMMARY',
      visitDate: new Date('2026-07-15T00:00:00.000Z'),
      travelAgency: ' stage7 test agency ',
      guideName: 'stage7 test guide',
      guidePhone: '18800000000',
      guideId: 'guide-stage7',
      tasterId: 'user-taster',
      tasterName: 'stage7 test taster',
      financeMark: true,
      guideInfoSent: false,
      travelAgencyInfoSent: false,
      salesAmountCents: 0,
      points: 0,
      returnedPoints: 0,
      unreturnedPoints: 0,
      liquorCostDeductionCents: 0,
      orderAmountCents: 0,
      ...(overrides.travelGroup || {}),
    },
    salesOrders: overrides.salesOrders || buildSalesOrders(),
    commissionRecords:
      overrides.commissionRecords || buildAgencyRebateRecords(),
    summaries: overrides.summary
      ? [summaryRecord(overrides.summary)]
      : [],
    operationLogs: [],
  };

  return {
    __store: store,
    travelGroup: {
      findUnique: async ({ where }) =>
        where.id === store.travelGroup.id ? copyDeep(store.travelGroup) : null,
      update: async ({ where, data }) => {
        assert.equal(where.id, store.travelGroup.id);
        store.travelGroup = {
          ...store.travelGroup,
          ...copyDeep(data),
        };
        return copyDeep(store.travelGroup);
      },
    },
    salesOrder: {
      findMany: async ({ where }) =>
        copyDeep(
          store.salesOrders.filter((order) => matchesWhere(order, where)),
        ),
    },
    commissionRecord: {
      findMany: async ({ where }) =>
        copyDeep(
          store.commissionRecords.filter((record) =>
            matchesWhere(record, where),
          ),
        ),
    },
    travelGroupFinanceSummary: {
      findUnique: async ({ where }) => {
        const row = store.summaries.find((summary) =>
          matchesWhere(summary, where),
        );
        return row ? copyDeep(row) : null;
      },
      create: async ({ data }) => {
        const row = copyDeep(data);
        store.summaries.push(row);
        return copyDeep(row);
      },
      update: async ({ where, data }) => {
        const index = store.summaries.findIndex(
          (summary) => summary.id === where.id,
        );
        assert.notEqual(index, -1, 'summary should exist');
        store.summaries[index] = {
          ...store.summaries[index],
          ...copyDeep(data),
        };
        return copyDeep(store.summaries[index]);
      },
    },
    operationLog: {
      create: async ({ data }) => {
        const row = {
          ...copyDeep(data),
          createdAt: data.createdAt || new Date(),
        };
        store.operationLogs.push(row);
        return copyDeep(row);
      },
      findMany: async () => copyDeep(store.operationLogs),
    },
  };
}

function buildSalesOrders() {
  return [
    salesOrder({
      id: 'order-stage7-a',
      orderNo: 'SO-STAGE7-SUMMARY-A',
      totalAmountCents: 1000000,
      status: 'PARTIAL_REFUND',
      confirmedRefundAmountCents: 100000,
      unconfirmedRefundAmountCents: 50000,
      items: [
        orderItem({
          id: 'item-a',
          productName: 'stage7 test sauce A',
          quantity: 2,
          unitPriceCents: 400000,
          subtotalCents: 800000,
          sortOrder: 1,
        }),
        orderItem({
          id: 'item-b',
          productName: 'stage7 test sauce B',
          quantity: 1,
          unitPriceCents: 200000,
          subtotalCents: 200000,
          sortOrder: 2,
        }),
      ],
    }),
    salesOrder({
      id: 'order-stage7-b',
      orderNo: 'SO-STAGE7-SUMMARY-B',
      totalAmountCents: 500000,
      status: 'VALID',
      items: [
        orderItem({
          id: 'item-c',
          productName: 'stage7 test sauce C',
          quantity: 1,
          unitPriceCents: 500000,
          subtotalCents: 500000,
        }),
      ],
    }),
  ];
}

function buildAgencyRebateRecords() {
  return [
    agencyRebateRecord({
      id: 'record-daily-a',
      salesOrderId: 'order-stage7-a',
      targetType: 'AGENCY_DAILY_REBATE',
      grossAmountCents: 1000000,
      confirmedRefundAmountCents: 100000,
      baseAmountCents: 780000,
      deductionAmountCents: 120000,
      rateSnapshot: '0.0300',
      pointsCents: 23400,
    }),
    agencyRebateRecord({
      id: 'record-monthly-a',
      salesOrderId: 'order-stage7-a',
      targetType: 'AGENCY_MONTHLY_REBATE',
      grossAmountCents: 1000000,
      confirmedRefundAmountCents: 100000,
      baseAmountCents: 780000,
      deductionAmountCents: 120000,
      rateSnapshot: '0.0200',
      pointsCents: 15600,
    }),
    agencyRebateRecord({
      id: 'record-daily-b',
      salesOrderId: 'order-stage7-b',
      targetType: 'AGENCY_DAILY_REBATE',
      grossAmountCents: 500000,
      baseAmountCents: 450000,
      deductionAmountCents: 50000,
      rateSnapshot: '0.0300',
      pointsCents: 13500,
    }),
    agencyRebateRecord({
      id: 'record-monthly-b',
      salesOrderId: 'order-stage7-b',
      targetType: 'AGENCY_MONTHLY_REBATE',
      grossAmountCents: 500000,
      baseAmountCents: 450000,
      deductionAmountCents: 50000,
      rateSnapshot: '0.0200',
      pointsCents: 9000,
    }),
  ];
}

function salesOrder(overrides = {}) {
  const confirmedRefundAmountCents =
    overrides.confirmedRefundAmountCents || 0;
  const unconfirmedRefundAmountCents =
    overrides.unconfirmedRefundAmountCents || 0;
  const afterSalesOrders = [];
  if (confirmedRefundAmountCents > 0) {
    afterSalesOrders.push({
      id: `${overrides.id || 'order'}-confirmed-refund`,
      afterSalesNo: `${overrides.orderNo || 'SO'}-AS-CONFIRMED`,
      actionType: 'REFUND',
      status: 'COMPLETED',
      refundAmountCents: confirmedRefundAmountCents,
      financeConfirmed: true,
      financeConfirmedAt: new Date('2026-07-16T10:00:00.000Z'),
      createdAt: new Date('2026-07-16T09:00:00.000Z'),
    });
  }
  if (unconfirmedRefundAmountCents > 0) {
    afterSalesOrders.push({
      id: `${overrides.id || 'order'}-unconfirmed-refund`,
      afterSalesNo: `${overrides.orderNo || 'SO'}-AS-UNCONFIRMED`,
      actionType: 'REFUND',
      status: 'WAITING_REFUND',
      refundAmountCents: unconfirmedRefundAmountCents,
      financeConfirmed: false,
      createdAt: new Date('2026-07-17T09:00:00.000Z'),
    });
  }

  return {
    id: overrides.id || 'order-stage7',
    orderNo: overrides.orderNo || 'SO-STAGE7-SUMMARY',
    orderDate: new Date('2026-07-15T00:00:00.000Z'),
    status: overrides.status || 'VALID',
    totalAmountCents: overrides.totalAmountCents || 0,
    travelGroupId: 'group-stage7',
    items: overrides.items || [
      orderItem({
        subtotalCents: overrides.totalAmountCents || 0,
      }),
    ],
    afterSalesOrders,
  };
}

function orderItem(overrides = {}) {
  return {
    id: overrides.id || 'item-stage7',
    productName: overrides.productName || 'stage7 test sauce',
    quantity: overrides.quantity || 1,
    unitPriceCents: overrides.unitPriceCents || overrides.subtotalCents || 0,
    subtotalCents: overrides.subtotalCents || 0,
    sortOrder: overrides.sortOrder || 1,
  };
}

function agencyRebateRecord(overrides = {}) {
  return {
    id: overrides.id,
    salesOrderId: overrides.salesOrderId,
    travelGroupId: 'group-stage7',
    targetType: overrides.targetType,
    agencyRebateRuleId: 'rule-agency-rebate',
    agencyId: 'agency-1',
    agencyName: 'stage7 test agency',
    grossAmountCents: overrides.grossAmountCents || 0,
    confirmedRefundAmountCents: overrides.confirmedRefundAmountCents || 0,
    baseAmountCents: overrides.baseAmountCents || 0,
    deductionAmountCents: overrides.deductionAmountCents || 0,
    rateSnapshot: overrides.rateSnapshot || '0.0000',
    amountCents: 0,
    pointsCents: overrides.pointsCents || 0,
    calculationVersion: 'stage7_v1',
    ruleSnapshot: {
      agencyRebateRules: {
        id: 'rule-agency-rebate',
        agencyId: 'agency-1',
        agencyName: 'stage7 test agency',
      },
      agencyDeductionRules: [
        { id: 'rule-agency-deduction-a', productName: 'stage7 test sauce A' },
        { id: 'rule-agency-deduction-b', productName: 'stage7 test sauce B' },
      ],
    },
    sourceSnapshot: {
      businessKey: {
        salesOrderId: overrides.salesOrderId,
        targetType: overrides.targetType,
      },
      travelAgencyMatch: {
        matchedTravelAgencyId: 'agency-1',
        matchedTravelAgencyName: 'stage7 test agency',
      },
      confirmedRefunds: [],
      unconfirmedRefundSummary: { count: 0, refundAmountCents: 0 },
      salesOrder: { id: overrides.salesOrderId },
    },
    createdAt: new Date('2026-07-16T10:00:00.000Z'),
    updatedAt: new Date('2026-07-16T10:00:00.000Z'),
  };
}

function summaryRecord(overrides = {}) {
  return {
    id: overrides.id || 'summary-stage7',
    travelGroupId: overrides.travelGroupId || 'group-stage7',
    totalSalesAmountCents: overrides.totalSalesAmountCents || 0,
    confirmedRefundAmountCents: overrides.confirmedRefundAmountCents || 0,
    effectiveSalesAmountCents: overrides.effectiveSalesAmountCents || 0,
    totalAgencyDeductionCents: overrides.totalAgencyDeductionCents || 0,
    agencyDeductionConfirmed:
      overrides.agencyDeductionConfirmed || false,
    agencyDeductionConfirmedById:
      overrides.agencyDeductionConfirmedById || null,
    agencyDeductionConfirmedAt:
      overrides.agencyDeductionConfirmedAt || null,
    totalAgencyNetAmountCents: overrides.totalAgencyNetAmountCents || 0,
    totalDailyRebateCents: overrides.totalDailyRebateCents || 0,
    totalMonthlyRebateCents: overrides.totalMonthlyRebateCents || 0,
    paidRebateCents: overrides.paidRebateCents || 0,
    unpaidRebateCents: overrides.unpaidRebateCents || 0,
    notes: overrides.notes || null,
    guideInfoSent: overrides.guideInfoSent || false,
    travelAgencyInfoSent: overrides.travelAgencyInfoSent || false,
    calculationVersion: overrides.calculationVersion || 'stage7_v1',
    sourceSnapshot: overrides.sourceSnapshot || null,
    updatedById: overrides.updatedById || null,
    createdAt: new Date('2026-07-15T10:00:00.000Z'),
    updatedAt: new Date('2026-07-15T10:00:00.000Z'),
  };
}

function assertSummaryAmounts(summary, expected) {
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(summary[key], value, key);
  }
}

function matchesWhere(row, where = {}) {
  return Object.entries(where || {}).every(([key, value]) => {
    if (value && typeof value === 'object' && Array.isArray(value.in)) {
      return value.in.includes(row[key]);
    }
    if (value === null) {
      return row[key] === null || row[key] === undefined;
    }
    return row[key] === value;
  });
}

function copyDeep(value) {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}
