const assert = require('node:assert/strict');
const test = require('node:test');

const {
  EmployeeCommissionRuleRecalculationNestService,
} = require('../src/modules/commissions/employee-commission-rule-recalculation.nest.service');
const {
  CommissionRulesNestService,
} = require('../src/modules/commission-rules/commission-rules.nest.service');

test('unit: employee commission rule update recalculates the union of old and new date ranges', async () => {
  const fixture = createFixture();
  const service = createService(fixture);

  const result = await service.recalculateForCommissionRuleChange(
    { id: 'finance-1', role: 'finance' },
    {
      source: 'commission_rules.update',
      ruleIds: ['commission-rule-1'],
      rules: [
        rule({
          targetType: 'outreach_commission',
          effectiveFrom: '2026-07-01',
          effectiveTo: '2026-07-31',
        }),
        rule({
          targetType: 'leader_commission',
          effectiveFrom: '2026-08-01',
          effectiveTo: '2026-08-31',
        }),
      ],
    },
    { ipAddress: '127.0.0.1' },
  );

  assert.deepEqual(
    fixture.commissionCalls.map((call) => call.orderId),
    ['order-july', 'order-august'],
  );
  assert.equal(
    fixture.commissionCalls.every((call) =>
      call.options.targetTypes.every((targetType) =>
        ['OUTREACH_COMMISSION', 'LEADER_COMMISSION'].includes(targetType),
      ),
    ),
    true,
  );
  assert.equal(result.orderCount, 2);
  assert.equal(result.successCount, 2);
  assert.equal(result.failureCount, 0);
  assert.equal(result.generatedCount, 2);
  assert.equal(result.updatedCount, 2);
  assert.equal(result.unchangedCount, 2);
  assert.deepEqual(result.ruleIds, ['commission-rule-1']);
  assert.deepEqual(result.targetTypes, [
    'OUTREACH_COMMISSION',
    'LEADER_COMMISSION',
  ]);
  assert.equal(result.orderRange.matchedDateFrom, '2026-07-15');
  assert.equal(result.orderRange.matchedDateTo, '2026-08-15');

  const log = fixture.logs.at(-1);
  assert.equal(log.action, 'commission_records.employee_scope.recalculate');
  assert.equal(log.afterData.triggerSource, 'commission_rules.update');
  assert.deepEqual(log.afterData.ruleIds, ['commission-rule-1']);
  assert.deepEqual(log.afterData.targetTypes, [
    'OUTREACH_COMMISSION',
    'LEADER_COMMISSION',
  ]);
  assert.equal(log.afterData.orderCount, 2);
  assert.equal(log.afterData.successCount, 2);
  assert.equal(log.afterData.failureCount, 0);
  assert.equal(log.afterData.generatedCount, 2);
});

test('unit: employee recalculation translates only affected missing-person and missing-rule warnings', async () => {
  const fixture = createFixture({
    orders: [order('order-july', '2026-07-15')],
    calculationWarnings: [
      { code: 'missing_outreach_user', context: {} },
      { code: 'missing_leader', context: { salesUserId: 'sales-1' } },
      {
        code: 'missing_commission_rule',
        context: {
          targetType: 'OUTREACH_COMMISSION',
          date: '2026-07-15',
        },
      },
      {
        code: 'missing_commission_rule',
        context: {
          targetType: 'LEADER_COMMISSION',
          date: '2026-07-15',
        },
      },
    ],
  });
  const service = createService(fixture);

  const result = await service.recalculateForCommissionRuleChange(
    { id: 'finance-1', role: 'finance' },
    {
      source: 'commission_rules.create',
      ruleIds: ['outreach-rule-1'],
      rules: [rule({ targetType: 'outreach_commission' })],
    },
  );

  assert.equal(result.successCount, 1);
  assert.equal(result.skippedCount, 1);
  assert.deepEqual(
    result.warnings.map((warning) => warning.code),
    ['missing_outreach_user', 'missing_commission_rule'],
  );
  assert.equal(
    result.warnings.find(
      (warning) => warning.code === 'missing_outreach_user',
    ).message.includes('不会自动猜测外联人员'),
    true,
  );
  assert.equal(
    result.warnings.find(
      (warning) => warning.code === 'missing_commission_rule',
    ).message.includes('订单日期没有生效规则'),
    true,
  );
});

test('unit: one failed order does not stop employee commission scope recalculation', async () => {
  const fixture = createFixture({
    failOrderIds: ['order-july'],
  });
  const service = createService(fixture);

  const result = await service.recalculateForCommissionRuleChange(
    { id: 'finance-1', role: 'finance' },
    {
      source: 'commission_rules.update',
      ruleIds: ['leader-rule-1'],
      rules: [
        rule({
          targetType: 'leader_commission',
          effectiveFrom: '2026-07-01',
          effectiveTo: '2026-08-31',
        }),
      ],
    },
  );

  assert.deepEqual(
    fixture.commissionCalls.map((call) => call.orderId),
    ['order-july', 'order-august'],
  );
  assert.equal(result.orderCount, 2);
  assert.equal(result.successCount, 1);
  assert.equal(result.failureCount, 1);
  assert.equal(
    result.warnings.some(
      (warning) =>
        warning.code === 'order_recalculation_failed' &&
        warning.context.salesOrderId === 'order-july' &&
        warning.message.includes('其他订单已继续处理'),
    ),
    true,
  );
  assert.equal(fixture.logs.at(-1).afterData.failureCount, 1);
});

test('unit: a saved rule returns an explicit Chinese warning when scope recalculation cannot start', async () => {
  const logs = [];
  const service = new CommissionRulesNestService(
    {},
    {
      appendLog: async (log) => {
        logs.push(log);
      },
    },
    {},
    {
      recalculateForCommissionRuleChange: async () => {
        throw new Error('fixture scope failure');
      },
    },
  );

  const result = await service.triggerEmployeeCommissionRecalculation(
    { id: 'finance-1', role: 'finance' },
    {
      source: 'commission_rules.create',
      ruleIds: ['outreach-rule-1'],
      rules: [rule({ targetType: 'OUTREACH_COMMISSION' })],
    },
    { ipAddress: '127.0.0.1' },
  );

  assert.equal(result.failureCount, 1);
  assert.equal(result.successCount, 0);
  assert.equal(result.warnings.length, 1);
  assert.equal(
    result.warnings[0].message.includes('提成规则已保存'),
    true,
  );
  assert.equal(
    logs[0].action,
    'commission_records.employee_scope.recalculate_failed',
  );
  assert.deepEqual(logs[0].afterData.targetTypes, ['OUTREACH_COMMISSION']);
});

function createService(fixture) {
  return new EmployeeCommissionRuleRecalculationNestService(
    fixture.prisma,
    {
      recalculateSalesOrderRecords: async (orderId, options) => {
        fixture.commissionCalls.push({ orderId, options });
        if (fixture.failOrderIds.has(orderId)) {
          const error = new Error('fixture order failure');
          error.code = 'FIXTURE_ORDER_FAILURE';
          throw error;
        }
        return {
          generatedRecords: [{ id: `generated-${orderId}` }],
          updatedRecords: [{ id: `updated-${orderId}` }],
          unchangedRecords: [{ id: `unchanged-${orderId}` }],
          warnings: fixture.calculationWarnings,
        };
      },
    },
    {
      appendLog: async (log) => {
        fixture.logs.push(log);
      },
    },
  );
}

function createFixture(overrides = {}) {
  const orders = overrides.orders || [
    order('order-july', '2026-07-15'),
    order('order-august', '2026-08-15'),
    order('order-september', '2026-09-15'),
  ];
  const fixture = {
    orders,
    commissionCalls: [],
    logs: [],
    failOrderIds: new Set(overrides.failOrderIds || []),
    calculationWarnings: overrides.calculationWarnings || [],
  };
  fixture.prisma = {
    salesOrder: {
      findMany: async ({ where, take }) =>
        orders
          .filter((candidate) =>
            where.OR.some(({ orderDate }) => {
              const timestamp = candidate.orderDate.getTime();
              return (
                timestamp >= orderDate.gte.getTime() &&
                (!orderDate.lte || timestamp <= orderDate.lte.getTime())
              );
            }),
          )
          .slice(0, take),
    },
  };
  return fixture;
}

function order(id, date) {
  return {
    id,
    orderDate: new Date(`${date}T00:00:00.000Z`),
    travelGroupId: `group-${id}`,
  };
}

function rule(overrides = {}) {
  return {
    id: overrides.id || 'commission-rule-1',
    targetType: overrides.targetType || 'sales_commission',
    effectiveFrom: new Date(
      `${overrides.effectiveFrom || '2026-07-01'}T00:00:00.000Z`,
    ),
    effectiveTo: overrides.effectiveTo
      ? new Date(`${overrides.effectiveTo}T00:00:00.000Z`)
      : null,
  };
}
