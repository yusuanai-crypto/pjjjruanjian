const assert = require('node:assert/strict');
const test = require('node:test');

const {
  calculateOrderEffectiveAmount,
  calculateStage7CommissionAndPoints,
} = require('../src/modules/commissions/commission-calculation.helper');

test('unit: stage7 original-order calculation ignores independent after-sales adjustments', () => {
  const result = calculateStage7CommissionAndPoints(buildCalculationInput());

  assert.deepEqual(result.amounts, {
    grossAmountCents: 1000000,
    confirmedRefundAmountCents: 0,
    unconfirmedRefundAmountCents: 0,
    effectiveAmountCents: 1000000,
    salesDeductionAmountCents: 100000,
    employeeBaseAmountCents: 900000,
    agencyDeductionAmountCents: 120000,
    agencyBaseAmountCents: 880000,
    dailyRebateCents: 26400,
    monthlyRebateCents: 17600,
  });
  assert.equal(
    result.warnings.some(
      (warning) => warning.code === 'unconfirmed_after_sales_refund',
    ),
    false,
  );

  assertLine(result.commissionLines, 'SALES_COMMISSION', {
    targetUserId: 'user-sales',
    commissionRuleId: 'rule-sales',
    baseAmountCents: 900000,
    deductionAmountCents: 100000,
    rateSnapshot: '0.0200',
    amountCents: 18000,
  });
  assertLine(result.commissionLines, 'OUTREACH_COMMISSION', {
    targetUserId: 'user-outreach',
    commissionRuleId: 'rule-outreach',
    rateSnapshot: '0.0080',
    amountCents: 7200,
  });
  assertLine(result.commissionLines, 'LEADER_COMMISSION', {
    targetUserId: 'user-leader',
    commissionRuleId: 'rule-leader',
    rateSnapshot: '0.0024',
    amountCents: 2160,
  });
  assertLine(result.agencyRebateLines, 'AGENCY_DAILY_REBATE', {
    agencyRebateRuleId: 'rule-agency-rebate',
    agencyId: 'agency-1',
    rateSnapshot: '0.0300',
    pointsCents: 26400,
  });
  assertLine(result.agencyRebateLines, 'AGENCY_MONTHLY_REBATE', {
    agencyRebateRuleId: 'rule-agency-rebate',
    agencyId: 'agency-1',
    rateSnapshot: '0.0200',
    pointsCents: 17600,
  });

  assert.deepEqual(result.sourceSnapshot.confirmedRefunds, []);
  assert.equal(result.sourceSnapshot.unconfirmedRefundSummary.count, 0);
  assert.equal(
    result.sourceSnapshot.travelAgencyMatch.matchMode,
    'travel_agency_name_to_id',
  );
  assert.equal(result.sourceSnapshot.people.leaderUserId, 'user-leader');
  assert.equal(result.ruleSnapshot.salesDeductionRules.length, 2);
  assert.equal(result.ruleSnapshot.agencyDeductionRules.length, 2);
  assert.equal(result.ruleSnapshot.agencyRebateRule.id, 'rule-agency-rebate');
  assert.match(result.calculationNote, /effective=1000000/);
});

test('unit: historical refunded sources stay positive while standalone cancelled orders are zero', () => {
  const refunded = calculateStage7CommissionAndPoints(
    buildCalculationInput({
      salesOrder: {
        status: 'REFUNDED',
        afterSalesOrders: [
          {
            id: 'after-sales-refunded',
            refundAmountCents: 1000000,
            financeConfirmed: true,
          },
        ],
      },
    }),
  );
  assert.equal(refunded.amounts.effectiveAmountCents, 1000000);
  assert.equal(refunded.amounts.employeeBaseAmountCents, 900000);
  assert.equal(refunded.amounts.agencyBaseAmountCents, 880000);
  assert.equal(
    refunded.commissionLines.find(
      (line) => line.targetType === 'SALES_COMMISSION',
    ).amountCents,
    18000,
  );
  assert.equal(
    refunded.agencyRebateLines.find(
      (line) => line.targetType === 'AGENCY_DAILY_REBATE',
    ).pointsCents,
    26400,
  );

  const cancelled = calculateStage7CommissionAndPoints(
    buildCalculationInput({
      salesOrder: {
        status: 'CANCELLED',
        afterSalesOrders: [],
      },
    }),
  );
  assert.equal(cancelled.amounts.confirmedRefundAmountCents, 0);
  assert.equal(cancelled.amounts.effectiveAmountCents, 0);
  assert.equal(
    cancelled.commissionLines.find(
      (line) => line.targetType === 'OUTREACH_COMMISSION',
    ).amountCents,
    0,
  );

  assert.deepEqual(
    calculateOrderEffectiveAmount({
      totalAmountCents: 5000,
      status: 'PARTIAL_REFUND',
      afterSalesOrders: [
        { refundAmountCents: 4999, financeConfirmed: true },
        { refundAmountCents: 8888, financeConfirmed: false },
      ],
    }),
    {
      grossAmountCents: 5000,
      confirmedRefundAmountCents: 0,
      effectiveAmountCents: 5000,
    },
  );
});

test('unit: stage7 calculation returns warnings for missing rules and people', () => {
  const result = calculateStage7CommissionAndPoints(
    buildCalculationInput({
      salesOrder: {
        outreachUserId: null,
        outreachUser: null,
        salesUser: {
          id: 'user-sales',
          name: 'stage7 test sales',
          leaderId: null,
          leader: null,
        },
        items: [
          {
            id: 'item-missing-rule',
            productName: 'stage7 test missing product',
            quantity: 1,
            unitPriceCents: 10000,
            subtotalCents: 10000,
          },
        ],
      },
      salesDeductionRules: [],
      agencyDeductionRules: [],
      agencyRebateRules: [],
    }),
  );

  assertWarningCodes(result, [
    'missing_sales_deduction_rule',
    'missing_agency_deduction_rule',
    'missing_agency_rebate_rule',
    'missing_outreach_user',
    'missing_leader',
  ]);
  assert.equal(result.amounts.salesDeductionAmountCents, 0);
  assert.equal(result.amounts.agencyDeductionAmountCents, 0);
  assert.equal(
    result.commissionLines.some(
      (line) => line.targetType === 'OUTREACH_COMMISSION',
    ),
    false,
  );
  assert.equal(
    result.commissionLines.some(
      (line) => line.targetType === 'LEADER_COMMISSION',
    ),
    false,
  );
});

test('unit: stage7 agency rules prefer explicit agencyId and current name-to-id matching', () => {
  const explicitId = calculateStage7CommissionAndPoints(
    buildCalculationInput({
      salesOrder: {
        travelGroup: {
          ...buildOrder().travelGroup,
          agencyId: 'agency-explicit',
          travelAgency: 'stage7 test legacy agency name',
        },
      },
      travelAgencies: [
        { id: 'agency-explicit', name: 'stage7 test canonical agency' },
      ],
      agencyDeductionRules: [
        agencyDeductionRule({
          id: 'agency-id-rule',
          agencyId: 'agency-explicit',
          agencyName: null,
          deductionCostCents: 111,
        }),
        agencyDeductionRule({
          id: 'agency-name-rule',
          agencyId: null,
          agencyName: 'stage7 test legacy agency name',
          deductionCostCents: 999,
        }),
      ],
      agencyRebateRules: [
        agencyRebateRule({
          id: 'rebate-id-rule',
          agencyId: 'agency-explicit',
          agencyName: null,
          dailyRebateRate: '0.0100',
          monthlyRebateRate: '0.0000',
        }),
        agencyRebateRule({
          id: 'rebate-name-rule',
          agencyId: null,
          agencyName: 'stage7 test legacy agency name',
          dailyRebateRate: '0.9900',
          monthlyRebateRate: '0.0000',
        }),
      ],
    }),
  );

  assert.equal(
    explicitId.sourceSnapshot.travelAgencyMatch.matchMode,
    'agency_id',
  );
  assert.equal(explicitId.agencyDeduction.items[0].ruleId, 'agency-id-rule');
  assert.equal(
    explicitId.ruleSnapshot.agencyRebateRule.id,
    'rebate-id-rule',
  );

  const nameToId = calculateStage7CommissionAndPoints(buildCalculationInput());
  assert.equal(
    nameToId.sourceSnapshot.travelAgencyMatch.matchedTravelAgencyId,
    'agency-1',
  );
  assert.equal(
    nameToId.agencyDeduction.items.every(
      (item) => item.matchMode === 'agency_id',
    ),
    true,
  );
});

test('unit: stage7 agency matching falls back to agencyName text rules with warning', () => {
  const result = calculateStage7CommissionAndPoints(
    buildCalculationInput({
      salesOrder: {
        travelGroup: {
          ...buildOrder().travelGroup,
          travelAgency: 'stage7 test historical text agency',
        },
      },
      travelAgencies: [{ id: 'agency-other', name: 'stage7 test other agency' }],
      agencyDeductionRules: [
        agencyDeductionRule({
          id: 'agency-text-rule',
          agencyId: null,
          agencyName: 'stage7 test historical text agency',
          deductionCostCents: 123,
        }),
      ],
      agencyRebateRules: [
        agencyRebateRule({
          id: 'rebate-text-rule',
          agencyId: null,
          agencyName: 'stage7 test historical text agency',
          dailyRebateRate: '0.0100',
          monthlyRebateRate: '0.0200',
        }),
      ],
    }),
  );

  assertWarningCodes(result, ['travel_agency_id_not_matched']);
  assert.equal(
    result.sourceSnapshot.travelAgencyMatch.matchMode,
    'agency_name_text_fallback',
  );
  assert.equal(result.agencyDeduction.items[0].ruleId, 'agency-text-rule');
  assert.equal(result.ruleSnapshot.agencyRebateRule.id, 'rebate-text-rule');
});

test('unit: agency deduction effective_sales_rate uses 30 percent of effective sales', () => {
  const result = calculateStage7CommissionAndPoints(
    buildCalculationInput({
      salesOrder: {
        travelGroup: {
          ...buildOrder().travelGroup,
          liquorCostDeductionCents: 999999,
        },
      },
      agencyDeductionRules: [
        agencyDeductionRule({
          id: 'agency-effective-rate-rule',
          calculationMode: 'effective_sales_rate',
          productId: null,
          productName: '',
          deductionCostCents: 999999,
          deductionRate: '0.3000',
        }),
      ],
    }),
  );

  assert.equal(result.agencyDeduction.calculationMode, 'effective_sales_rate');
  assert.equal(result.amounts.effectiveAmountCents, 1000000);
  assert.equal(result.amounts.agencyDeductionAmountCents, 300000);
  assert.equal(result.amounts.agencyBaseAmountCents, 700000);
  assert.equal(result.ruleSnapshot.agencyDeductionRules[0].deductionRate, '0.3000');
  assert.equal(result.ruleSnapshot.agencyDeductionRules[0].deductionAmountCents, 300000);
});

test('unit: agency deduction manual_product_reference reads manual liquor cost instead of summing products', () => {
  const result = calculateStage7CommissionAndPoints(
    buildCalculationInput({
      salesOrder: {
        travelGroup: {
          ...buildOrder().travelGroup,
          liquorCostDeductionCents: 12345,
        },
        items: [
          {
            id: 'item-manual-reference',
            productName: 'stage7 test sauce A',
            quantity: 10,
            unitPriceCents: 100000,
            subtotalCents: 1000000,
          },
        ],
      },
      agencyDeductionRules: [
        agencyDeductionRule({
          id: 'agency-manual-reference-rule',
          productName: 'stage7 test sauce A',
          deductionCostCents: 77777,
        }),
      ],
    }),
  );

  assert.equal(result.agencyDeduction.calculationMode, 'manual_product_reference');
  assert.equal(result.agencyDeduction.items[0].referenceAmountCents, 777770);
  assert.equal(result.agencyDeduction.items[0].deductionAmountCents, 0);
  assert.equal(result.amounts.agencyDeductionAmountCents, 12345);
  assert.equal(result.amounts.agencyBaseAmountCents, 987655);
  assert.equal(
    result.ruleSnapshot.agencyDeductionRules[0].manualInputDeductionCents,
    12345,
  );
});

test('unit: stage7 calculation uses rules effective on the order date', () => {
  const result = calculateStage7CommissionAndPoints(
    buildCalculationInput({
      salesOrder: {
        orderDate: new Date('2026-08-15T00:00:00.000Z'),
      },
      salesDeductionRules: [
        salesDeductionRule({
          id: 'old-sales-deduction',
          productName: 'stage7 test sauce A',
          deductionCostCents: 100,
          effectiveFrom: '2026-07-01',
          effectiveTo: '2026-07-31',
        }),
        salesDeductionRule({
          id: 'new-sales-deduction',
          productName: 'stage7 test sauce A',
          deductionCostCents: 25000,
          effectiveFrom: '2026-08-01',
        }),
        salesDeductionRule({
          id: 'inactive-sales-deduction',
          productName: 'stage7 test sauce B',
          deductionCostCents: 1,
          effectiveFrom: '2026-08-01',
          isActive: false,
        }),
        salesDeductionRule({
          id: 'active-sales-deduction-b',
          productName: 'stage7 test sauce B',
          deductionCostCents: 50000,
          effectiveFrom: '2026-08-01',
        }),
      ],
      commissionRules: [
        commissionRule({
          id: 'rule-sales-old',
          targetType: 'sales_commission',
          rate: '0.9000',
          effectiveFrom: '2026-07-01',
          effectiveTo: '2026-07-31',
        }),
        commissionRule({
          id: 'rule-sales-new',
          targetType: 'sales_commission',
          rate: '0.0200',
          effectiveFrom: '2026-08-01',
        }),
        commissionRule({
          id: 'rule-outreach-new',
          targetType: 'outreach_commission',
          rate: '0.0080',
          effectiveFrom: '2026-08-01',
        }),
        commissionRule({
          id: 'rule-leader-new',
          targetType: 'leader_commission',
          rate: '0.0024',
          effectiveFrom: '2026-08-01',
        }),
      ],
    }),
  );

  assert.equal(result.salesDeduction.items[0].ruleId, 'new-sales-deduction');
  assert.equal(result.salesDeduction.items[1].ruleId, 'active-sales-deduction-b');
  assertLine(result.commissionLines, 'SALES_COMMISSION', {
    commissionRuleId: 'rule-sales-new',
    amountCents: 18000,
  });
});

test('unit: stage7 percentage calculations round half up to cents', () => {
  const result = calculateStage7CommissionAndPoints(
    buildCalculationInput({
      salesOrder: {
        totalAmountCents: 333,
        travelGroup: {
          ...buildOrder().travelGroup,
          liquorCostDeductionCents: 0,
        },
        items: [
          {
            id: 'item-rounding',
            productName: 'stage7 test rounding product',
            quantity: 1,
            unitPriceCents: 333,
            subtotalCents: 333,
          },
        ],
        afterSalesOrders: [],
      },
      salesDeductionRules: [
        salesDeductionRule({
          id: 'rounding-sales-deduction',
          productName: 'stage7 test rounding product',
          deductionCostCents: 0,
        }),
      ],
      agencyDeductionRules: [
        agencyDeductionRule({
          id: 'rounding-agency-deduction',
          productName: 'stage7 test rounding product',
          deductionCostCents: 0,
        }),
      ],
      commissionRules: [
        commissionRule({
          id: 'rounding-sales-rule',
          targetType: 'sales_commission',
          rate: '0.0150',
        }),
        commissionRule({
          id: 'rounding-outreach-rule',
          targetType: 'outreach_commission',
          rate: '0.0150',
        }),
        commissionRule({
          id: 'rounding-leader-rule',
          targetType: 'leader_commission',
          rate: '0.0150',
        }),
      ],
      agencyRebateRules: [
        agencyRebateRule({
          id: 'rounding-rebate-rule',
          dailyRebateRate: '0.0150',
          monthlyRebateRate: '0.0150',
        }),
      ],
    }),
  );

  assertLine(result.commissionLines, 'SALES_COMMISSION', {
    amountCents: 5,
  });
  assertLine(result.agencyRebateLines, 'AGENCY_DAILY_REBATE', {
    pointsCents: 5,
  });
  assert.deepEqual(result.warnings, []);
});

test('unit: stage10 deduction matching prefers productId and falls back only for missing ids', () => {
  const productIdResult = calculateStage7CommissionAndPoints(
    buildCalculationInput({
      salesOrder: {
        items: [
          {
            id: 'stage10-item-id-match',
            productId: 'product-a',
            productName: 'same snapshot name',
            quantity: 1,
            unitPriceCents: 100000,
            subtotalCents: 100000,
          },
        ],
      },
      salesDeductionRules: [
        salesDeductionRule({
          id: 'different-product-newer-rule',
          productId: 'product-b',
          productName: 'same snapshot name',
          deductionCostCents: 90000,
          effectiveFrom: '2026-07-10',
        }),
        salesDeductionRule({
          id: 'matching-product-id-rule',
          productId: 'product-a',
          productName: 'old snapshot name',
          deductionCostCents: 12000,
          effectiveFrom: '2026-07-01',
        }),
        salesDeductionRule({
          id: 'legacy-name-fallback-rule',
          productId: null,
          productName: 'same snapshot name',
          deductionCostCents: 80000,
          effectiveFrom: '2026-07-14',
        }),
      ],
      agencyDeductionRules: [],
    }),
  );
  assert.equal(productIdResult.salesDeduction.items[0].ruleId, 'matching-product-id-rule');
  assert.equal(productIdResult.salesDeduction.totalAmountCents, 12000);

  const legacyRuleFallback = calculateStage7CommissionAndPoints(
    buildCalculationInput({
      salesOrder: {
        items: [
          {
            id: 'stage10-item-legacy-rule',
            productId: 'product-a',
            productName: ' legacy name ',
            quantity: 2,
            unitPriceCents: 100000,
            subtotalCents: 200000,
          },
        ],
      },
      salesDeductionRules: [
        salesDeductionRule({
          id: 'legacy-rule-without-id',
          productId: null,
          productName: 'legacyname',
          deductionCostCents: 1000,
        }),
      ],
      agencyDeductionRules: [],
    }),
  );
  assert.equal(legacyRuleFallback.salesDeduction.items[0].ruleId, 'legacy-rule-without-id');
  assert.equal(legacyRuleFallback.salesDeduction.totalAmountCents, 2000);

  const legacyOrderFallback = calculateStage7CommissionAndPoints(
    buildCalculationInput({
      salesOrder: {
        items: [
          {
            id: 'stage10-legacy-order-item',
            productId: null,
            productName: 'current product snapshot',
            quantity: 1,
            unitPriceCents: 100000,
            subtotalCents: 100000,
            actualUnitCostCents: 999999,
            actualCostSubtotalCents: 999999,
            grossProfitCents: -899999,
          },
        ],
      },
      salesDeductionRules: [
        salesDeductionRule({
          id: 'new-rule-for-legacy-order',
          productId: 'product-current',
          productName: 'currentproductsnapshot',
          deductionCostCents: 3000,
        }),
      ],
      agencyDeductionRules: [],
    }),
  );
  assert.equal(legacyOrderFallback.salesDeduction.items[0].ruleId, 'new-rule-for-legacy-order');
  assert.equal(legacyOrderFallback.salesDeduction.totalAmountCents, 3000);
  assert.equal(legacyOrderFallback.amounts.employeeBaseAmountCents, 997000);
});

test('unit: stage10 product actual-cost fields do not change commission rebate or points results', () => {
  const baseItem = {
    id: 'stage10-cost-isolation-item',
    productId: 'stage10-cost-isolation-product',
    productName: 'stage10 cost isolation product',
    quantity: 2,
    unitPriceCents: 250000,
    subtotalCents: 500000,
  };
  const overrides = {
    salesDeductionRules: [
      salesDeductionRule({
        id: 'stage10-sales-cost-rule',
        productId: baseItem.productId,
        productName: baseItem.productName,
        deductionCostCents: 10000,
      }),
    ],
    agencyDeductionRules: [
      agencyDeductionRule({
        id: 'stage10-agency-wrong-product-rule',
        productId: 'another-product',
        productName: baseItem.productName,
        deductionCostCents: 90000,
        effectiveFrom: '2026-07-14',
      }),
      agencyDeductionRule({
        id: 'stage10-agency-product-id-rule',
        productId: baseItem.productId,
        productName: 'stale product snapshot',
        deductionCostCents: 15000,
      }),
    ],
  };
  const withoutActualCost = calculateStage7CommissionAndPoints(
    buildCalculationInput({
      ...overrides,
      salesOrder: { items: [baseItem] },
    }),
  );
  const withActualCost = calculateStage7CommissionAndPoints(
    buildCalculationInput({
      ...overrides,
      salesOrder: {
        items: [
          {
            ...baseItem,
            actualUnitCostCents: 888888,
            actualCostSubtotalCents: 1777776,
            grossProfitCents: -1277776,
          },
        ],
      },
    }),
  );

  assert.equal(
    withActualCost.agencyDeduction.items[0].ruleId,
    'stage10-agency-product-id-rule',
  );
  assert.deepEqual(withActualCost.amounts, withoutActualCost.amounts);
  assert.deepEqual(withActualCost.commissionLines, withoutActualCost.commissionLines);
  assert.deepEqual(withActualCost.agencyRebateLines, withoutActualCost.agencyRebateLines);
});

test('unit: manual fallback applies the only later active agency rebate rule', () => {
  const result = calculateStage7CommissionAndPoints(
    buildCalculationInput({
      allowLatestAgencyRebateRuleFallback: true,
      agencyRebateRules: [
        agencyRebateRule({
          id: 'later-rule',
          effectiveFrom: '2026-08-01',
          dailyRebateRate: '0.0300',
          monthlyRebateRate: '0.0200',
        }),
      ],
    }),
  );

  assert.equal(result.amounts.dailyRebateCents, 26400);
  assert.equal(result.amounts.monthlyRebateCents, 17600);
  assertWarningCodes(result, ['agency_rebate_rule_fallback_applied']);
  assert.equal(
    result.ruleSnapshot.agencyRebateRule.matchMode,
    'latest_active_manual_fallback',
  );
  const context = result.warnings.find(
    (warning) => warning.code === 'agency_rebate_rule_fallback_applied',
  ).context;
  assert.equal(context.salesOrderId, 'order-stage7-calc');
  assert.equal(context.travelGroupId, 'travel-group-stage7-calc');
  assert.equal(context.agencyId, 'agency-1');
  assert.equal(context.ruleId, 'later-rule');
  assert.equal(context.orderDate, '2026-07-15');
  assert.equal(context.effectiveFrom, '2026-08-01');
});

test('unit: default matching stays strict and historical rule wins before fallback', () => {
  const laterRule = agencyRebateRule({
    id: 'later-rule',
    effectiveFrom: '2026-08-01',
    dailyRebateRate: '0.0900',
    monthlyRebateRate: '0.0800',
  });
  const strict = calculateStage7CommissionAndPoints(
    buildCalculationInput({ agencyRebateRules: [laterRule] }),
  );
  assert.equal(strict.amounts.dailyRebateCents, 0);
  assertWarningCodes(strict, ['missing_agency_rebate_rule']);

  const historical = calculateStage7CommissionAndPoints(
    buildCalculationInput({
      allowLatestAgencyRebateRuleFallback: true,
      agencyRebateRules: [
        agencyRebateRule({
          id: 'historical-rule',
          effectiveFrom: '2026-07-01',
          effectiveTo: '2026-07-31',
          dailyRebateRate: '0.0100',
          monthlyRebateRate: '0.0200',
        }),
        laterRule,
      ],
    }),
  );
  assert.equal(historical.amounts.dailyRebateCents, 8800);
  assert.equal(historical.ruleSnapshot.agencyRebateRule.id, 'historical-rule');
  assert.equal(historical.ruleSnapshot.agencyRebateRule.matchMode, 'agency_id');
  assert.equal(
    historical.warnings.some(
      (warning) => warning.code === 'agency_rebate_rule_fallback_applied',
    ),
    false,
  );
});

test('unit: fallback respects agency id and normalized exact legacy name', () => {
  const idMatched = calculateStage7CommissionAndPoints(
    buildCalculationInput({
      allowLatestAgencyRebateRuleFallback: true,
      agencyRebateRules: [
        agencyRebateRule({
          id: 'other-agency',
          agencyId: 'agency-2',
          agencyName: 'stage7 test agency',
          effectiveFrom: '2026-08-01',
          dailyRebateRate: '0.9900',
        }),
        agencyRebateRule({
          id: 'correct-agency',
          effectiveFrom: '2026-08-01',
          dailyRebateRate: '0.0300',
        }),
      ],
    }),
  );
  assert.equal(idMatched.ruleSnapshot.agencyRebateRule.id, 'correct-agency');

  const nameMatched = calculateStage7CommissionAndPoints(
    buildCalculationInput({
      allowLatestAgencyRebateRuleFallback: true,
      travelAgencies: [],
      salesOrder: {
        travelGroup: {
          ...buildOrder().travelGroup,
          travelAgency: 'Ｓｔａｇｅ ７ Test Agency',
        },
      },
      agencyRebateRules: [
        agencyRebateRule({
          id: 'legacy-name',
          agencyId: null,
          agencyName: 'stage7testagency',
          effectiveFrom: '2026-08-01',
          dailyRebateRate: '0.0300',
        }),
      ],
    }),
  );
  assert.equal(nameMatched.ruleSnapshot.agencyRebateRule.id, 'legacy-name');
});

test('unit: fallback reports ambiguity for equal-priority active rules', () => {
  const result = calculateStage7CommissionAndPoints(
    buildCalculationInput({
      allowLatestAgencyRebateRuleFallback: true,
      agencyRebateRules: [
        agencyRebateRule({ id: 'ambiguous-a', effectiveFrom: '2026-08-01' }),
        agencyRebateRule({ id: 'ambiguous-b', effectiveFrom: '2026-08-01' }),
      ],
    }),
  );

  assert.equal(result.amounts.dailyRebateCents, 0);
  assertWarningCodes(result, [
    'ambiguous_agency_rebate_rule',
    'missing_agency_rebate_rule',
  ]);
  assert.equal(result.ruleSnapshot.agencyRebateRule, null);
});

function buildCalculationInput(overrides = {}) {
  const salesOrder = {
    ...buildOrder(),
    ...(overrides.salesOrder || {}),
  };
  if (overrides.salesOrder?.travelGroup) {
    salesOrder.travelGroup = overrides.salesOrder.travelGroup;
  }
  if (overrides.salesOrder?.salesUser) {
    salesOrder.salesUser = overrides.salesOrder.salesUser;
  }
  if (overrides.salesOrder?.items) {
    salesOrder.items = overrides.salesOrder.items;
  }
  if (overrides.salesOrder?.afterSalesOrders) {
    salesOrder.afterSalesOrders = overrides.salesOrder.afterSalesOrders;
  }

  return {
    allowLatestAgencyRebateRuleFallback:
      overrides.allowLatestAgencyRebateRuleFallback === true,
    salesOrder,
    salesDeductionRules:
      overrides.salesDeductionRules || [
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
    agencyDeductionRules:
      overrides.agencyDeductionRules || [
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
    agencyRebateRules:
      overrides.agencyRebateRules || [
        agencyRebateRule({
          id: 'rule-agency-rebate',
          dailyRebateRate: '0.0300',
          monthlyRebateRate: '0.0200',
        }),
      ],
    commissionRules:
      overrides.commissionRules || [
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
    travelAgencies:
      overrides.travelAgencies || [
        { id: 'agency-1', name: 'stage7 test agency' },
      ],
  };
}

function buildOrder() {
  return {
    id: 'order-stage7-calc',
    orderNo: 'SO-STAGE7-CALC',
    orderDate: new Date('2026-07-15T00:00:00.000Z'),
    status: 'PARTIAL_REFUND',
    totalAmountCents: 1000000,
    travelGroupId: 'travel-group-stage7-calc',
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
      id: 'travel-group-stage7-calc',
      groupNo: 'TG-STAGE7-CALC',
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
      },
      {
        id: 'item-b',
        productName: 'stage7 test sauce B',
        quantity: 1,
        unitPriceCents: 200000,
        subtotalCents: 200000,
      },
    ],
    afterSalesOrders: [
      {
        id: 'after-sales-confirmed',
        afterSalesNo: 'AS-STAGE7-001',
        status: 'REFUNDED',
        actionType: 'REFUND',
        refundAmountCents: 100000,
        financeConfirmed: true,
        financeConfirmedAt: new Date('2026-07-16T10:00:00.000Z'),
      },
      {
        id: 'after-sales-unconfirmed',
        afterSalesNo: 'AS-STAGE7-002',
        status: 'PENDING',
        actionType: 'REFUND',
        refundAmountCents: 50000,
        financeConfirmed: false,
      },
    ],
  };
}

function salesDeductionRule(overrides = {}) {
  return {
    id: overrides.id || 'sales-deduction-rule',
    productId: Object.prototype.hasOwnProperty.call(overrides, 'productId')
      ? overrides.productId
      : null,
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
    calculationMode: overrides.calculationMode || 'manual_product_reference',
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
    dailyRebateRate: overrides.dailyRebateRate || '0.0000',
    monthlyRebateRate: overrides.monthlyRebateRate || '0.0000',
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

function assertLine(lines, targetType, expected) {
  const line = lines.find((item) => item.targetType === targetType);
  assert.ok(line, `expected ${targetType} line`);
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(line[key], value, `${targetType}.${key}`);
  }
}

function assertWarningCodes(result, expectedCodes) {
  const codes = result.warnings.map((warning) => warning.code);
  for (const code of expectedCodes) {
    assert.ok(codes.includes(code), `expected warning ${code}`);
  }
}
