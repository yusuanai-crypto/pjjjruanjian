const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CommissionRecordsNestService,
} = require('../src/modules/commissions/commission-records.nest.service');
const {
  OperationLogsNestService,
} = require('../src/modules/operation-logs/operation-log.nest.service');

test('unit: buyback never generates sales commission, points, or rebates', async () => {
  const prisma = createCommissionPrisma({
    salesOrder: {
      orderType: 'BUYBACK',
      workflowStatus: 'APPROVED',
    },
  });
  const service = createService(prisma);

  const result = await service.recalculateSalesOrderRecords('order-stage7');

  assert.equal(result.records.length, 0);
  assert.equal(result.generatedRecords.length, 0);
  assert.equal(prisma.__store.commissionRecords.length, 0);
  assert.equal(
    result.warnings.some(
      (warning) => warning.code === 'sales_order_not_commission_eligible',
    ),
    true,
  );
});

test('unit: stage7 commission record service generates order-level records', async () => {
  const prisma = createCommissionPrisma();
  const service = createService(prisma);

  const result = await service.recalculateSalesOrderRecords('order-stage7', {
    actor: { id: 'user-finance' },
    ipAddress: '127.0.0.1',
  });

  assert.equal(result.generatedRecords.length, 5);
  assert.equal(result.updatedRecords.length, 0);
  assert.equal(
    result.warnings.some(
      (warning) => warning.code === 'unconfirmed_after_sales_refund',
    ),
    false,
  );
  assert.deepEqual(
    prisma.__store.commissionRecords.map((record) => record.targetType).sort(),
    [
      'AGENCY_DAILY_REBATE',
      'AGENCY_MONTHLY_REBATE',
      'LEADER_COMMISSION',
      'OUTREACH_COMMISSION',
      'SALES_COMMISSION',
    ],
  );

  assertRecord(prisma, 'SALES_COMMISSION', {
    targetUserId: 'user-sales',
    grossAmountCents: 1000000,
    confirmedRefundAmountCents: 0,
    baseAmountCents: 900000,
    deductionAmountCents: 100000,
    rateSnapshot: '0.0200',
    amountCents: 18000,
    pointsCents: 0,
    commissionRuleId: 'rule-sales',
  });
  assertRecord(prisma, 'OUTREACH_COMMISSION', {
    targetUserId: null,
    automaticScopeKey:
      'sales-order:order-stage7:OUTREACH_COMMISSION:automatic',
    amountCents: 7200,
    commissionRuleId: 'rule-outreach',
  });
  assertRecord(prisma, 'LEADER_COMMISSION', {
    targetUserId: null,
    automaticScopeKey: 'sales-order:order-stage7:LEADER_COMMISSION:automatic',
    amountCents: 2160,
    commissionRuleId: 'rule-leader',
  });
  assertRecord(prisma, 'AGENCY_DAILY_REBATE', {
    agencyId: 'agency-1',
    agencyName: 'stage7 test agency',
    baseAmountCents: 780000,
    deductionAmountCents: 120000,
    rateSnapshot: '0.0300',
    amountCents: 0,
    pointsCents: 23400,
    agencyRebateRuleId: 'rule-agency-rebate',
  });
  assertRecord(prisma, 'AGENCY_MONTHLY_REBATE', {
    agencyId: 'agency-1',
    agencyName: 'stage7 test agency',
    rateSnapshot: '0.0200',
    pointsCents: 15600,
    agencyRebateRuleId: 'rule-agency-rebate',
  });

  const salesRecord = findRecord(prisma, 'SALES_COMMISSION');
  assert.equal(
    salesRecord.ruleSnapshot.commissionRules.SALES_COMMISSION.id,
    'rule-sales',
  );
  assert.equal(salesRecord.ruleSnapshot.salesDeductionRules.length, 2);
  assert.equal(salesRecord.sourceSnapshot.confirmedRefunds.length, 0);
  assert.equal(salesRecord.sourceSnapshot.unconfirmedRefundSummary.count, 0);
  assert.equal(
    salesRecord.sourceSnapshot.travelAgencyMatch.matchedTravelAgencyId,
    'agency-1',
  );

  assert.equal(prisma.__store.operationLogs.length, 5);
  assert.equal(
    prisma.__store.operationLogs.every(
      (log) => log.action === 'commission_records.generate',
    ),
    true,
  );
  for (const log of prisma.__store.operationLogs) {
    assertStage7ServiceLog(log, {
      action: 'commission_records.generate',
      entityType: 'commission_record',
      userId: 'user-finance',
      ipAddress: '127.0.0.1',
    });
    assert.equal(log.beforeData, null);
    assert.equal(log.afterData.salesOrderId, 'order-stage7');
    assert.equal('sourceSnapshot' in log.afterData, false);
    assert.equal('ruleSnapshot' in log.afterData, false);
  }
});

test('unit: stage7 commission record service generates order-level outreach without attribution', async () => {
  const prisma = createCommissionPrisma({
    salesOrder: {
      outreachUserId: null,
      outreachUser: null,
    },
  });
  const service = createService(prisma);

  const result = await service.recalculateSalesOrderRecords('order-stage7');

  assert.equal(result.generatedRecords.length, 5);
  assert.equal(
    prisma.__store.commissionRecords.some(
      (record) => record.targetType === 'OUTREACH_COMMISSION',
    ),
    true,
  );
  assert.equal(findRecord(prisma, 'OUTREACH_COMMISSION').targetUserId, null);
  assert.equal(
    result.warnings.some((warning) => warning.code === 'missing_outreach_user'),
    false,
  );
});

test('unit: stage7 commission record service generates order-level leader without leader config', async () => {
  const prisma = createCommissionPrisma({
    salesOrder: {
      salesUser: {
        id: 'user-sales',
        name: 'stage7 test sales',
        leaderId: null,
        leader: null,
      },
    },
  });
  const service = createService(prisma);

  const result = await service.recalculateSalesOrderRecords('order-stage7');

  assert.equal(result.generatedRecords.length, 5);
  assert.equal(
    prisma.__store.commissionRecords.some(
      (record) => record.targetType === 'LEADER_COMMISSION',
    ),
    true,
  );
  assert.equal(findRecord(prisma, 'LEADER_COMMISSION').targetUserId, null);
  assert.equal(
    result.warnings.some((warning) => warning.code === 'missing_leader'),
    false,
  );
});

test('unit: commission rule outside the order date does not generate the targeted employee commission', async () => {
  const prisma = createCommissionPrisma({
    commissionRules: [
      commissionRule({
        id: 'rule-outreach-future',
        targetType: 'outreach_commission',
        rate: '0.0080',
        effectiveFrom: '2026-08-01',
      }),
    ],
  });
  const service = createService(prisma);

  const result = await service.recalculateSalesOrderRecords('order-stage7', {
    targetTypes: ['OUTREACH_COMMISSION'],
  });

  assert.equal(result.generatedRecords.length, 0);
  assert.equal(result.updatedRecords.length, 0);
  assert.equal(prisma.__store.commissionRecords.length, 0);
  assert.equal(
    result.warnings.some(
      (warning) =>
        warning.code === 'missing_commission_rule' &&
        warning.context.targetType === 'OUTREACH_COMMISSION',
    ),
    true,
  );
});

test('unit: disabling an employee rule deactivates its stale snapshot without rewriting history', async () => {
  const prisma = createCommissionPrisma();
  const service = createService(prisma);

  await service.recalculateSalesOrderRecords('order-stage7');
  const manualUpdatedAt = new Date('2026-07-20T00:00:00.000Z');
  prisma.__store.commissionRecords.push({
    id: 'manual-taster-record',
    salesOrderId: 'order-stage7',
    travelGroupId: 'travel-group-stage7',
    targetType: 'TASTER_COMMISSION',
    targetUserId: 'user-taster',
    amountCents: 9999,
    pointsCents: 0,
    manualInput: true,
    updatedAt: manualUpdatedAt,
  });
  const outreachRule = prisma.__store.commissionRules.find(
    (rule) => rule.targetType === 'outreach_commission',
  );
  outreachRule.isActive = false;

  const result = await service.recalculateSalesOrderRecords('order-stage7', {
    targetTypes: ['OUTREACH_COMMISSION'],
  });

  assert.equal(result.generatedRecords.length, 0);
  assert.equal(result.updatedRecords.length, 1);
  assertRecord(prisma, 'OUTREACH_COMMISSION', {
    amountCents: 7200,
    commissionRuleId: 'rule-outreach',
    manualInput: false,
    isActive: false,
  });
  const manualTaster = prisma.__store.commissionRecords.find(
    (record) => record.id === 'manual-taster-record',
  );
  assert.equal(manualTaster.amountCents, 9999);
  assert.equal(manualTaster.updatedAt, manualUpdatedAt);
  assertWarningCodes(result, ['missing_commission_rule']);
});

test('unit: stage7 commission record recalculation is idempotent and does not duplicate logs', async () => {
  const prisma = createCommissionPrisma();
  const service = createService(prisma);

  await service.recalculateSalesOrderRecords('order-stage7');
  const confirmedSales = findRecord(prisma, 'SALES_COMMISSION');
  confirmedSales.isConfirmed = true;
  confirmedSales.confirmedById = 'user-finance';
  confirmedSales.confirmedAt = new Date('2026-07-20T08:00:00.000Z');
  const second = await service.recalculateSalesOrderRecords('order-stage7');

  assert.equal(prisma.__store.commissionRecords.length, 5);
  assert.equal(second.generatedRecords.length, 0);
  assert.equal(second.updatedRecords.length, 0);
  assert.equal(second.unchangedRecords.length, 5);
  assert.equal(prisma.__store.operationLogs.length, 5);
  assert.equal(findRecord(prisma, 'SALES_COMMISSION').isConfirmed, true);
  assert.equal(
    findRecord(prisma, 'SALES_COMMISSION').confirmedById,
    'user-finance',
  );
});

test('unit: changing employee attribution recalculates idempotently without duplicate records', async () => {
  const prisma = createCommissionPrisma();
  const service = createService(prisma);
  await service.recalculateSalesOrderRecords('order-stage7');

  prisma.__store.salesOrder.salesUserId = 'user-sales-next';
  prisma.__store.salesOrder.salesUser = {
    ...prisma.__store.salesOrder.salesUser,
    id: 'user-sales-next',
  };
  prisma.__store.salesOrder.outreachUserId = 'user-outreach-next';
  prisma.__store.salesOrder.outreachUser = {
    id: 'user-outreach-next',
    name: 'next outreach',
  };
  const changed = await service.recalculateSalesOrderRecords('order-stage7', {
    targetTypes: [
      'SALES_COMMISSION',
      'OUTREACH_COMMISSION',
      'LEADER_COMMISSION',
    ],
  });
  const repeated = await service.recalculateSalesOrderRecords('order-stage7', {
    targetTypes: [
      'SALES_COMMISSION',
      'OUTREACH_COMMISSION',
      'LEADER_COMMISSION',
    ],
  });

  assert.equal(changed.generatedRecords.length, 0);
  assert.equal(changed.updatedRecords.length, 3);
  assert.equal(prisma.__store.commissionRecords.length, 5);
  assert.equal(findRecord(prisma, 'SALES_COMMISSION').targetUserId, 'user-sales-next');
  assert.equal(
    findRecord(prisma, 'OUTREACH_COMMISSION').targetUserId,
    null,
  );
  assert.equal(repeated.generatedRecords.length, 0);
  assert.equal(repeated.updatedRecords.length, 0);
});

test('unit: commission record manual fallback creates rebates once with audited match mode', async () => {
  const prisma = createCommissionPrisma({
    agencyRebateRules: [
      agencyRebateRule({
        id: 'rule-later-rebate',
        effectiveFrom: '2026-08-01',
      }),
    ],
  });
  const service = createService(prisma);

  const strict = await service.recalculateSalesOrderRecords('order-stage7', {
    targetTypes: ['AGENCY_DAILY_REBATE', 'AGENCY_MONTHLY_REBATE'],
  });
  assertWarningCodes(strict, ['missing_agency_rebate_rule']);
  assert.equal(prisma.__store.commissionRecords.length, 0);

  const fallback = await service.recalculateSalesOrderRecords('order-stage7', {
    targetTypes: ['AGENCY_DAILY_REBATE', 'AGENCY_MONTHLY_REBATE'],
    allowLatestAgencyRebateRuleFallback: true,
  });
  assertRecord(prisma, 'AGENCY_DAILY_REBATE', { pointsCents: 23400 });
  assertRecord(prisma, 'AGENCY_MONTHLY_REBATE', { pointsCents: 15600 });
  assertWarningCodes(fallback, ['agency_rebate_rule_fallback_applied']);
  assert.equal(
    findRecord(prisma, 'AGENCY_DAILY_REBATE').ruleSnapshot.agencyRebateRule
      .matchMode,
    'latest_active_manual_fallback',
  );

  const repeated = await service.recalculateSalesOrderRecords('order-stage7', {
    targetTypes: ['AGENCY_DAILY_REBATE', 'AGENCY_MONTHLY_REBATE'],
    allowLatestAgencyRebateRuleFallback: true,
  });
  assert.equal(repeated.generatedRecords.length, 0);
  assert.equal(repeated.updatedRecords.length, 0);
  assert.equal(prisma.__store.commissionRecords.length, 2);
});

test('unit: stage7 recalculation keeps independent refund out of employee commission and refreshes agency rebate', async () => {
  const prisma = createCommissionPrisma();
  const service = createService(prisma);
  const actor = { id: 'user-finance' };

  await service.recalculateSalesOrderRecords('order-stage7', {
    actor,
    ipAddress: '127.0.0.1',
  });
  prisma.__store.salesOrder.afterSalesOrders[0].refundAmountCents = 200000;
  const result = await service.recalculateSalesOrderRecords('order-stage7', {
    actor,
    ipAddress: '127.0.0.1',
  });

  assert.equal(result.generatedRecords.length, 0);
  assert.equal(result.updatedRecords.length, 5);
  assert.equal(prisma.__store.commissionRecords.length, 5);
  assertRecord(prisma, 'SALES_COMMISSION', {
    confirmedRefundAmountCents: 0,
    baseAmountCents: 900000,
    amountCents: 18000,
  });
  assertRecord(prisma, 'AGENCY_DAILY_REBATE', {
    baseAmountCents: 680000,
    pointsCents: 20400,
  });

  const recalcLogs = prisma.__store.operationLogs.filter(
    (log) => log.action === 'commission_records.recalculate',
  );
  assert.equal(recalcLogs.length, 5);
  assert.equal(recalcLogs[0].beforeData.confirmedRefundAmountCents, 0);
  assert.equal(recalcLogs[0].afterData.confirmedRefundAmountCents, 0);
  for (const log of recalcLogs) {
    assertStage7ServiceLog(log, {
      action: 'commission_records.recalculate',
      entityType: 'commission_record',
      userId: 'user-finance',
      ipAddress: '127.0.0.1',
    });
    assert.equal('sourceSnapshot' in log.beforeData, false);
    assert.equal('sourceSnapshot' in log.afterData, false);
    assert.equal('ruleSnapshot' in log.beforeData, false);
    assert.equal('ruleSnapshot' in log.afterData, false);
  }
});

test('unit: stage7 commission record service keeps agencyName idempotency when agencyId is empty', async () => {
  const prisma = createCommissionPrisma({
    travelAgencies: [],
    salesOrder: {
      travelGroup: {
        ...buildSalesOrder().travelGroup,
        travelAgency: 'stage7 test historical agency',
      },
    },
    agencyDeductionRules: [
      agencyDeductionRule({
        id: 'rule-agency-text-deduction-a',
        agencyId: null,
        agencyName: 'stage7 test historical agency',
        productName: 'stage7 test sauce A',
        deductionCostCents: 40000,
      }),
      agencyDeductionRule({
        id: 'rule-agency-text-deduction-b',
        agencyId: null,
        agencyName: 'stage7 test historical agency',
        productName: 'stage7 test sauce B',
        deductionCostCents: 40000,
      }),
    ],
    agencyRebateRules: [
      agencyRebateRule({
        id: 'rule-agency-text-rebate',
        agencyId: null,
        agencyName: 'stage7 test historical agency',
      }),
    ],
  });
  const service = createService(prisma);

  const first = await service.recalculateSalesOrderRecords('order-stage7');
  const second = await service.recalculateSalesOrderRecords('order-stage7');

  assertWarningCodes(first, ['travel_agency_id_not_matched']);
  assert.equal(second.generatedRecords.length, 0);
  assert.equal(prisma.__store.commissionRecords.length, 5);
  assertRecord(prisma, 'AGENCY_DAILY_REBATE', {
    agencyId: null,
    agencyName: 'stage7 test historical agency',
    agencyRebateRuleId: 'rule-agency-text-rebate',
  });
});

test('unit: agency-only recalculation uses confirmed refunds and never rewrites employee commissions', async () => {
  const prisma = createCommissionPrisma();
  const service = createService(prisma);

  await service.recalculateSalesOrderRecords('order-stage7');
  prisma.__store.agencyDeductionRules.splice(
    0,
    prisma.__store.agencyDeductionRules.length,
    agencyDeductionRule({
      id: 'rule-agency-effective-rate',
      calculationMode: 'effective_sales_rate',
      productName: '',
      deductionCostCents: 0,
      deductionRate: '0.3000',
    }),
  );
  const employeeBefore = prisma.__store.commissionRecords
    .filter((record) =>
      [
        'SALES_COMMISSION',
        'OUTREACH_COMMISSION',
        'LEADER_COMMISSION',
      ].includes(record.targetType),
    )
    .map((record) => ({ ...record, isConfirmed: true }));
  for (const before of employeeBefore) {
    const stored = prisma.__store.commissionRecords.find(
      (record) => record.id === before.id,
    );
    stored.isConfirmed = true;
  }

  const result = await service.recalculateSalesOrderRecords('order-stage7', {
    targetTypes: ['AGENCY_DAILY_REBATE', 'AGENCY_MONTHLY_REBATE'],
  });

  assert.equal(result.generatedRecords.length, 0);
  assert.equal(result.updatedRecords.length, 2);
  assertRecord(prisma, 'AGENCY_DAILY_REBATE', {
    grossAmountCents: 1000000,
    confirmedRefundAmountCents: 100000,
    deductionAmountCents: 300000,
    baseAmountCents: 600000,
    pointsCents: 18000,
  });
  assertRecord(prisma, 'AGENCY_MONTHLY_REBATE', {
    deductionAmountCents: 300000,
    baseAmountCents: 600000,
    pointsCents: 12000,
  });
  for (const before of employeeBefore) {
    const after = prisma.__store.commissionRecords.find(
      (record) => record.id === before.id,
    );
    assert.equal(after.amountCents, before.amountCents);
    assert.equal(after.isConfirmed, true);
    assert.equal(after.updatedAt, before.updatedAt);
  }
  assert.equal(prisma.__store.commissionRecords.length, 5);
});

function createService(prisma) {
  return new CommissionRecordsNestService(
    prisma,
    new OperationLogsNestService(prisma),
  );
}

function assertStage7ServiceLog(log, expected) {
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

function createCommissionPrisma(overrides = {}) {
  const store = {
    salesOrder: mergeSalesOrder(buildSalesOrder(), overrides.salesOrder || {}),
    travelAgencies: overrides.travelAgencies || [
      { id: 'agency-1', name: 'stage7 test agency' },
    ],
    salesDeductionRules: overrides.salesDeductionRules || [
      salesDeductionRule({
        id: 'rule-sales-deduction-a',
        productName: 'stage7 test sauce A',
        deductionCostCents: 25000,
      }),
      salesDeductionRule({
        id: 'rule-sales-deduction-b',
        productName: 'stage7 test sauce B',
        deductionCostCents: 50000,
      }),
    ],
    agencyDeductionRules: overrides.agencyDeductionRules || [
      agencyDeductionRule({
        id: 'rule-agency-deduction-a',
        productName: 'stage7 test sauce A',
        deductionCostCents: 40000,
      }),
      agencyDeductionRule({
        id: 'rule-agency-deduction-b',
        productName: 'stage7 test sauce B',
        deductionCostCents: 40000,
      }),
    ],
    agencyRebateRules: overrides.agencyRebateRules || [
      agencyRebateRule({
        id: 'rule-agency-rebate',
      }),
    ],
    commissionRules: overrides.commissionRules || [
      commissionRule({
        id: 'rule-sales',
        targetType: 'sales_commission',
        rate: '0.0200',
      }),
      commissionRule({
        id: 'rule-outreach',
        targetType: 'outreach_commission',
        rate: '0.0080',
      }),
      commissionRule({
        id: 'rule-leader',
        targetType: 'leader_commission',
        rate: '0.0024',
      }),
    ],
    commissionRecords: [],
    operationLogs: [],
  };

  return {
    __store: store,
    salesOrder: {
      findUnique: async ({ where }) =>
        where.id === store.salesOrder.id ? copyDeep(store.salesOrder) : null,
    },
    salesDeductionRule: ruleDelegate(store.salesDeductionRules),
    agencyDeductionRule: ruleDelegate(store.agencyDeductionRules),
    agencyRebateRule: ruleDelegate(store.agencyRebateRules),
    commissionRule: ruleDelegate(store.commissionRules),
    travelAgency: {
      findMany: async () => copyDeep(store.travelAgencies),
    },
    commissionRecord: {
      findFirst: async ({ where }) => {
        const record = store.commissionRecords.find((item) =>
          matchesWhere(item, where),
        );
        return record ? copyDeep(record) : null;
      },
      create: async ({ data }) => {
        const row = {
          ...copyDeep(data),
          createdAt: data.createdAt || new Date(),
          updatedAt: data.updatedAt || new Date(),
        };
        store.commissionRecords.push(row);
        return copyDeep(row);
      },
      update: async ({ where, data }) => {
        const index = store.commissionRecords.findIndex(
          (item) => item.id === where.id,
        );
        assert.notEqual(index, -1, 'commission record should exist');
        store.commissionRecords[index] = {
          ...store.commissionRecords[index],
          ...copyDeep(data),
        };
        return copyDeep(store.commissionRecords[index]);
      },
      findMany: async ({ where } = {}) =>
        copyDeep(
          store.commissionRecords.filter((record) =>
            matchesWhere(record, where || {}),
          ),
        ),
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

function ruleDelegate(rows) {
  return {
    findMany: async ({ where } = {}) =>
      copyDeep(rows.filter((row) => matchesWhere(row, where || {}))),
  };
}

function buildSalesOrder() {
  return {
    id: 'order-stage7',
    orderNo: 'SO-STAGE7-RECALC',
    orderDate: new Date('2026-07-15T00:00:00.000Z'),
    status: 'PARTIAL_REFUND',
    totalAmountCents: 1000000,
    travelGroupId: 'travel-group-stage7',
    salesUserId: 'user-sales',
    outreachUserId: 'user-outreach',
    salesUser: {
      id: 'user-sales',
      name: 'stage7 test sales',
      leaderId: 'user-leader',
      leader: {
        id: 'user-leader',
        name: 'stage7 test leader',
      },
    },
    outreachUser: {
      id: 'user-outreach',
      name: 'stage7 test outreach',
    },
    travelGroup: {
      id: 'travel-group-stage7',
      groupNo: 'TG-STAGE7-RECALC',
      visitDate: new Date('2026-07-15T00:00:00.000Z'),
      travelAgency: ' stage7 test agency ',
      tasterId: 'user-taster',
      tasterName: 'stage7 test taster',
      financeMark: true,
      liquorCostDeductionCents: 120000,
    },
    items: [
      {
        id: 'item-a',
        productName: 'stage7 test sauce A',
        quantity: 2,
        unitPriceCents: 400000,
        subtotalCents: 800000,
        sortOrder: 1,
      },
      {
        id: 'item-b',
        productName: 'stage7 test sauce B',
        quantity: 1,
        unitPriceCents: 200000,
        subtotalCents: 200000,
        sortOrder: 2,
      },
    ],
    afterSalesOrders: [
      {
        id: 'after-sales-confirmed',
        afterSalesNo: 'AS-STAGE7-REC-001',
        actionType: 'REFUND',
        status: 'COMPLETED',
        refundAmountCents: 100000,
        financeConfirmed: true,
        financeConfirmedAt: new Date('2026-07-16T10:00:00.000Z'),
        createdAt: new Date('2026-07-16T09:00:00.000Z'),
      },
      {
        id: 'after-sales-unconfirmed',
        afterSalesNo: 'AS-STAGE7-REC-002',
        actionType: 'REFUND',
        status: 'WAITING_REFUND',
        refundAmountCents: 50000,
        financeConfirmed: false,
        createdAt: new Date('2026-07-17T09:00:00.000Z'),
      },
    ],
  };
}

function salesDeductionRule(overrides = {}) {
  return {
    id: overrides.id || 'sales-deduction-rule',
    productName: overrides.productName || 'stage7 test sauce A',
    deductionCostCents: overrides.deductionCostCents ?? 0,
    effectiveFrom: new Date(`${overrides.effectiveFrom || '2026-07-01'}T00:00:00.000Z`),
    effectiveTo: overrides.effectiveTo
      ? new Date(`${overrides.effectiveTo}T00:00:00.000Z`)
      : null,
    isActive: overrides.isActive ?? true,
  };
}

function agencyDeductionRule(overrides = {}) {
  return {
    ...salesDeductionRule(overrides),
    agencyId:
      Object.prototype.hasOwnProperty.call(overrides, 'agencyId')
        ? overrides.agencyId
        : 'agency-1',
    agencyName:
      Object.prototype.hasOwnProperty.call(overrides, 'agencyName')
        ? overrides.agencyName
        : 'stage7 test agency',
    calculationMode:
      overrides.calculationMode || 'manual_product_reference',
    deductionRate: overrides.deductionRate || '0.3000',
  };
}

function agencyRebateRule(overrides = {}) {
  return {
    id: overrides.id || 'agency-rebate-rule',
    agencyId:
      Object.prototype.hasOwnProperty.call(overrides, 'agencyId')
        ? overrides.agencyId
        : 'agency-1',
    agencyName:
      Object.prototype.hasOwnProperty.call(overrides, 'agencyName')
        ? overrides.agencyName
        : 'stage7 test agency',
    dailyRebateRate: overrides.dailyRebateRate || '0.0300',
    monthlyRebateRate: overrides.monthlyRebateRate || '0.0200',
    effectiveFrom: new Date(`${overrides.effectiveFrom || '2026-07-01'}T00:00:00.000Z`),
    effectiveTo: overrides.effectiveTo
      ? new Date(`${overrides.effectiveTo}T00:00:00.000Z`)
      : null,
    isActive: overrides.isActive ?? true,
  };
}

function commissionRule(overrides = {}) {
  return {
    id: overrides.id || 'commission-rule',
    ruleName: `${overrides.targetType || 'sales_commission'} stage7 test rule`,
    targetType: overrides.targetType || 'sales_commission',
    rate: overrides.rate || '0.0000',
    effectiveFrom: new Date(`${overrides.effectiveFrom || '2026-07-01'}T00:00:00.000Z`),
    effectiveTo: overrides.effectiveTo
      ? new Date(`${overrides.effectiveTo}T00:00:00.000Z`)
      : null,
    isActive: overrides.isActive ?? true,
  };
}

function assertRecord(prisma, targetType, expected) {
  const record = findRecord(prisma, targetType);
  assert.ok(record, `expected ${targetType} record`);
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(record[key], value, `${targetType}.${key}`);
  }
}

function findRecord(prisma, targetType) {
  return prisma.__store.commissionRecords.find(
    (record) => record.targetType === targetType,
  );
}

function assertWarningCodes(result, expectedCodes) {
  const codes = result.warnings.map((warning) => warning.code);
  for (const code of expectedCodes) {
    assert.ok(codes.includes(code), `expected warning ${code}`);
  }
}

function mergeSalesOrder(base, overrides) {
  const merged = {
    ...base,
    ...overrides,
  };
  if (overrides.salesUser) {
    merged.salesUser = overrides.salesUser;
  }
  if (Object.prototype.hasOwnProperty.call(overrides, 'outreachUser')) {
    merged.outreachUser = overrides.outreachUser;
  }
  if (overrides.travelGroup) {
    merged.travelGroup = overrides.travelGroup;
  }
  if (overrides.items) {
    merged.items = overrides.items;
  }
  if (overrides.afterSalesOrders) {
    merged.afterSalesOrders = overrides.afterSalesOrders;
  }
  return merged;
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
