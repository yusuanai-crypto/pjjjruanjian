const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AgencyRuleRecalculationNestService,
} = require('../src/modules/commissions/agency-rule-recalculation.nest.service');
const {
  CommissionRecordsNestController,
} = require('../src/modules/commissions/commission-records.nest.controller');
const {
  OperationLogsNestService,
} = require('../src/modules/operation-logs/operation-log.nest.service');

test('unit: agency rule changes recalculate only matching agency orders in old or new effective ranges', async () => {
  const fixture = createFixture();
  const service = createService(fixture);

  const result = await service.recalculateForAgencyRuleChange(
    { id: 'finance-1', role: 'finance' },
    {
      source: 'agency_rebate_rules.update',
      ruleKind: 'agencyRebate',
      ruleIds: ['rebate-1'],
      rules: [
        rule({ effectiveFrom: '2026-07-01', effectiveTo: '2026-07-31' }),
        rule({ effectiveFrom: '2026-08-01', effectiveTo: '2026-08-31' }),
      ],
    },
    { ipAddress: '127.0.0.1' },
  );

  assert.deepEqual(
    fixture.commissionCalls.map((call) => call.orderId),
    ['order-agency-a-july', 'order-agency-a-august'],
  );
  assert.equal(
    fixture.commissionCalls.every((call) =>
      call.options.targetTypes.every((targetType) =>
        targetType.startsWith('AGENCY_'),
      ),
    ),
    true,
  );
  assert.equal(result.orderCount, 2);
  assert.equal(result.travelGroupCount, 2);
  assert.equal(result.successCount, 2);
  assert.equal(
    result.warnings.some(
      (warning) => warning.code === 'agency_rule_effective_date_not_matched',
    ),
    true,
  );
  assert.deepEqual(fixture.refreshedGroups.sort(), ['group-august', 'group-july']);
  const log = fixture.operationLogs.at(-1);
  assert.equal(log.action, 'commission_records.agency_scope.recalculate');
  assert.equal(log.afterData.triggerSource, 'agency_rebate_rules.update');
  assert.deepEqual(log.afterData.ruleIds, ['rebate-1']);
  assert.equal(log.afterData.orderCount, 2);
  assert.equal(log.afterData.travelGroupCount, 2);
  assert.equal(log.afterData.successCount, 2);
});

test('unit: confirmed, paid, and manual override agency data are skipped with Chinese warnings', async () => {
  const fixture = createFixture({
    summaries: {
      'group-july': {
        agencyDeductionConfirmed: true,
      },
      'group-august': {
        sourceSnapshot: {
          agencyDeduction: { mode: 'manual' },
        },
      },
      'group-september': {
        dailyRebatePaid: true,
      },
    },
  });
  const service = createService(fixture);

  const result = await service.recalculateExplicit(
    { id: 'finance-1', role: 'finance' },
    {
      travelGroupIds: ['group-july', 'group-august', 'group-september'],
      agencyOnly: true,
    },
  );

  assert.deepEqual(
    fixture.commissionCalls.map((call) => call.orderId),
    ['order-agency-a-september'],
  );
  assert.deepEqual(fixture.commissionCalls[0].options.skipTargetTypes, [
    'AGENCY_DAILY_REBATE',
  ]);
  assert.equal(result.skippedConfirmedCount, 2);
  assert.equal(result.skippedManualOverrideCount, 1);
  assert.equal(
    result.warnings.some(
      (warning) =>
        warning.code === 'agency_deduction_confirmed' &&
        warning.message.includes('已确认'),
    ),
    true,
  );
  assert.equal(
    result.warnings.some(
      (warning) =>
        warning.code === 'manual_override' &&
        warning.message.includes('人工维护'),
    ),
    true,
  );
  assert.equal(
    result.warnings.some(
      (warning) =>
        warning.code === 'daily_rebate_paid' &&
        warning.message.includes('已返款'),
    ),
    true,
  );
});

test('unit: missing rules return structured Chinese warnings and repeated recalculation stays delegated idempotently', async () => {
  const fixture = createFixture({
    calculationWarnings: [
      { code: 'missing_agency_deduction_rule', context: {} },
      { code: 'missing_agency_rebate_rule', context: {} },
      {
        code: 'agency_name_legacy_fallback',
        context: { ruleId: 'legacy-name-rule' },
      },
    ],
  });
  const service = createService(fixture);
  const actor = { id: 'finance-1', role: 'finance' };
  const payload = {
    travelGroupId: 'group-july',
    agencyOnly: true,
  };

  const first = await service.recalculateExplicit(actor, payload);
  const second = await service.recalculateExplicit(actor, payload);

  assert.equal(fixture.commissionCalls.length, 2);
  assert.equal(first.generatedCount, 0);
  assert.equal(second.generatedCount, 0);
  assert.equal(
    first.warnings.some(
      (warning) =>
        warning.code === 'missing_agency_deduction_rule' &&
        warning.message.includes('订单日期'),
    ),
    true,
  );
  assert.equal(
    first.warnings.some(
      (warning) => warning.code === 'missing_agency_daily_rebate_rule',
    ),
    true,
  );
  assert.equal(
    first.warnings.some(
      (warning) => warning.code === 'missing_agency_monthly_rebate_rule',
    ),
    true,
  );
  assert.equal(
    first.warnings.some(
      (warning) =>
        warning.code === 'agency_name_legacy_fallback' &&
        warning.message.includes('未绑定 ID'),
    ),
    true,
  );
});

test('unit: recalculation API rejects an unbounded full-table request', async () => {
  const fixture = createFixture();
  const service = createService(fixture);

  await assert.rejects(
    service.recalculateExplicit(
      { id: 'finance-1', role: 'finance' },
      { agencyOnly: true },
    ),
    (error) => {
      assert.equal(error.code, 'VALIDATION_FAILED');
      return true;
    },
  );
});

test('unit: explicit travel-group recalculation forwards manual rebate fallback only when requested', async () => {
  const fixture = createFixture();
  const service = createService(fixture);

  await service.recalculateExplicit(
    { id: 'finance-1', role: 'finance' },
    {
      travelGroupId: 'group-july',
      agencyOnly: true,
      allowLatestAgencyRebateRuleFallback: true,
    },
  );

  assert.equal(
    fixture.commissionCalls[0].options.allowLatestAgencyRebateRuleFallback,
    true,
  );
  await assert.rejects(
    service.recalculateExplicit(
      { id: 'finance-1', role: 'finance' },
      {
        salesOrderId: 'order-agency-a-july',
        agencyOnly: true,
        allowLatestAgencyRebateRuleFallback: true,
      },
    ),
    (error) => {
      assert.equal(error.code, 'AGENCY_REBATE_RULE_FALLBACK_SCOPE_INVALID');
      return true;
    },
  );
});

test('unit: POST commission-records/recalculate authenticates and forwards a bounded scope', async () => {
  const calls = [];
  const controller = new CommissionRecordsNestController(
    {
      authenticateRequest: async () => ({ id: 'finance-1', role: 'finance' }),
    },
    {},
    {
      recalculateExplicit: async (actor, body, metadata) => {
        calls.push({ actor, body, metadata });
        return { orderCount: 1 };
      },
    },
  );

  const result = await controller.recalculate(
    { salesOrderId: 'order-1' },
    { socket: { remoteAddress: '127.0.0.1' }, headers: {} },
  );

  assert.deepEqual(result, { orderCount: 1 });
  assert.equal(calls[0].actor.id, 'finance-1');
  assert.equal(calls[0].body.salesOrderId, 'order-1');
});

function createService(fixture) {
  return new AgencyRuleRecalculationNestService(
    fixture.prisma,
    {
      recalculateSalesOrderRecords: async (orderId, options) => {
        fixture.commissionCalls.push({ orderId, options });
        return {
          generatedRecords: [],
          updatedRecords: [],
          unchangedRecords: [],
          warnings: fixture.calculationWarnings,
        };
      },
    },
    {
      refreshTravelGroupFinanceSummary: async (groupId) => {
        fixture.refreshedGroups.push(groupId);
      },
      getRecalculatedTravelGroupFinanceSummary: async (groupId) => ({
        id: `summary-${groupId}`,
        travelGroupId: groupId,
      }),
    },
    new OperationLogsNestService(fixture.prisma),
  );
}

function createFixture(overrides = {}) {
  const orders = [
    order('order-agency-a-july', 'group-july', '旅行社甲', '2026-07-15'),
    order('order-agency-a-august', 'group-august', '旅行社甲', '2026-08-15'),
    order(
      'order-agency-a-september',
      'group-september',
      '旅行社甲',
      '2026-09-15',
    ),
    order('order-agency-b-july', 'group-other', '旅行社乙', '2026-07-15'),
  ];
  const summaries = overrides.summaries || {};
  const operationLogs = [];
  const fixture = {
    orders,
    summaries,
    operationLogs,
    commissionCalls: [],
    refreshedGroups: [],
    calculationWarnings: overrides.calculationWarnings || [],
  };
  fixture.prisma = {
    travelAgency: {
      findMany: async () => [{ id: 'agency-a', name: '旅行社甲' }],
      findUnique: async ({ where }) =>
        where.id === 'agency-a'
          ? { id: 'agency-a', name: '旅行社甲' }
          : null,
    },
    salesOrder: {
      findUnique: async ({ where }) =>
        copy(orders.find((item) => item.id === where.id) || null),
      findMany: async ({ where }) => {
        if (where.travelGroupId?.in) {
          return copy(
            orders.filter((item) =>
              where.travelGroupId.in.includes(item.travelGroupId),
            ),
          );
        }
        const names =
          where.travelGroup?.is?.OR?.map(
            (item) => item.travelAgency.contains,
          ) || [];
        return copy(
          orders.filter((item) =>
            names.some((name) => item.travelGroup.travelAgency.includes(name)),
          ),
        );
      },
    },
    travelGroupFinanceSummary: {
      findUnique: async ({ where }) =>
        copy(summaries[where.travelGroupId] || null),
    },
    operationLog: {
      create: async ({ data }) => {
        operationLogs.push(copy(data));
        return copy(data);
      },
    },
  };
  return fixture;
}

function order(id, travelGroupId, travelAgency, orderDate) {
  return {
    id,
    travelGroupId,
    orderDate: new Date(`${orderDate}T00:00:00.000Z`),
    travelGroup: {
      id: travelGroupId,
      travelAgency,
    },
  };
}

function rule(overrides = {}) {
  return {
    id: 'rebate-1',
    agencyId: 'agency-a',
    agencyName: '旅行社甲',
    effectiveFrom: new Date(
      `${overrides.effectiveFrom || '2026-07-01'}T00:00:00.000Z`,
    ),
    effectiveTo: overrides.effectiveTo
      ? new Date(`${overrides.effectiveTo}T00:00:00.000Z`)
      : null,
  };
}

function copy(value) {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}
