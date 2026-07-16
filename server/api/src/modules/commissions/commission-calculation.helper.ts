const CALCULATION_VERSION = 'stage7_v1';

const SALES_COMMISSION = 'SALES_COMMISSION';
const OUTREACH_COMMISSION = 'OUTREACH_COMMISSION';
const LEADER_COMMISSION = 'LEADER_COMMISSION';
const AGENCY_DAILY_REBATE = 'AGENCY_DAILY_REBATE';
const AGENCY_MONTHLY_REBATE = 'AGENCY_MONTHLY_REBATE';

const TARGET_TYPE_TO_PRISMA: any = {
  sales_commission: SALES_COMMISSION,
  outreach_commission: OUTREACH_COMMISSION,
  leader_commission: LEADER_COMMISSION,
  SALES_COMMISSION,
  OUTREACH_COMMISSION,
  LEADER_COMMISSION,
};

const CLOSED_ORDER_STATUSES = new Set(['REFUNDED', 'CANCELLED']);

export interface Stage7CalculationWarning {
  code: string;
  message: string;
  context?: Record<string, any>;
}

export interface CalculateStage7CommissionInput {
  salesOrder: any;
  salesDeductionRules?: any[];
  agencyDeductionRules?: any[];
  agencyRebateRules?: any[];
  commissionRules?: any[];
  travelAgencies?: any[];
  calculationVersion?: string;
}

export function calculateStage7CommissionAndPoints(
  input: CalculateStage7CommissionInput,
) {
  const salesOrder = input?.salesOrder || {};
  const calculationVersion = input?.calculationVersion || CALCULATION_VERSION;
  const warnings: Stage7CalculationWarning[] = [];
  const calculationDate = normalizeCalculationDate(salesOrder);
  const items = normalizeOrderItems(salesOrder.items);
  const orderStatus = normalizeOrderStatus(salesOrder.status);
  const grossAmountCents = toCents(salesOrder.totalAmountCents);
  const afterSalesOrders = normalizeAfterSalesOrders(
    salesOrder.afterSalesOrders,
  );
  const confirmedRefunds = afterSalesOrders.filter(
    (order: any) => order.financeConfirmed,
  );
  const unconfirmedRefunds = afterSalesOrders.filter(
    (order: any) => !order.financeConfirmed && order.refundAmountCents > 0,
  );
  const confirmedRefundAmountCents = sumBy(
    confirmedRefunds,
    (order: any) => order.refundAmountCents,
  );
  const unconfirmedRefundAmountCents = sumBy(
    unconfirmedRefunds,
    (order: any) => order.refundAmountCents,
  );
  if (unconfirmedRefundAmountCents > 0) {
    addWarning(
      warnings,
      'unconfirmed_after_sales_refund',
      'Unconfirmed after-sales refund is pending finance adjustment.',
      {
        count: unconfirmedRefunds.length,
        totalAmountCents: unconfirmedRefundAmountCents,
        afterSalesOrderIds: unconfirmedRefunds
          .map((order: any) => normalizeOptionalString(order.id))
          .filter(Boolean),
      },
    );
  }
  const effectiveAmountCents = CLOSED_ORDER_STATUSES.has(orderStatus)
    ? 0
    : Math.max(0, grossAmountCents - confirmedRefundAmountCents);

  const agencyMatch = resolveTravelAgencyMatch(
    salesOrder,
    input?.travelAgencies || [],
    warnings,
  );
  const salesDeduction = calculateSalesDeduction(
    items,
    input?.salesDeductionRules || [],
    calculationDate,
    warnings,
  );
  const agencyDeduction = calculateAgencyDeduction(
    items,
    input?.agencyDeductionRules || [],
    agencyMatch,
    calculationDate,
    warnings,
  );
  const employeeBaseAmountCents = Math.max(
    0,
    effectiveAmountCents - salesDeduction.totalAmountCents,
  );
  const agencyBaseAmountCents = Math.max(
    0,
    effectiveAmountCents - agencyDeduction.totalAmountCents,
  );

  const commissionRuleMatches = resolveCommissionRules(
    input?.commissionRules || [],
    calculationDate,
    warnings,
  );
  const commissionLines = buildCommissionLines({
    salesOrder,
    employeeBaseAmountCents,
    salesDeductionAmountCents: salesDeduction.totalAmountCents,
    grossAmountCents,
    confirmedRefundAmountCents,
    rules: commissionRuleMatches,
    calculationVersion,
    warnings,
  });

  const agencyRebateRule = matchAgencyRule(
    input?.agencyRebateRules || [],
    agencyMatch,
    null,
    calculationDate,
  );
  if (!agencyRebateRule.rule) {
    addWarning(warnings, 'missing_agency_rebate_rule', 'Missing agency rebate rule.', {
      agencyId: agencyMatch.agencyId,
      agencyName: agencyMatch.agencyName,
      date: toDateOnly(calculationDate),
    });
  }
  const dailyRebateRate = agencyRebateRule.rule
    ? normalizeRate(agencyRebateRule.rule.dailyRebateRate)
    : '0.0000';
  const monthlyRebateRate = agencyRebateRule.rule
    ? normalizeRate(agencyRebateRule.rule.monthlyRebateRate)
    : '0.0000';
  const dailyRebateCents = multiplyCentsByRate(
    agencyBaseAmountCents,
    dailyRebateRate,
  );
  const monthlyRebateCents = multiplyCentsByRate(
    agencyBaseAmountCents,
    monthlyRebateRate,
  );
  const agencyRebateLines = buildAgencyRebateLines({
    salesOrder,
    agencyMatch,
    agencyBaseAmountCents,
    agencyDeductionAmountCents: agencyDeduction.totalAmountCents,
    grossAmountCents,
    confirmedRefundAmountCents,
    agencyRebateRule: agencyRebateRule.rule,
    dailyRebateRate,
    monthlyRebateRate,
    dailyRebateCents,
    monthlyRebateCents,
    calculationVersion,
  });

  const ruleSnapshot = {
    salesDeductionRules: salesDeduction.ruleSnapshots,
    agencyDeductionRules: agencyDeduction.ruleSnapshots,
    commissionRules: buildCommissionRuleSnapshot(commissionRuleMatches),
    agencyRebateRule: agencyRebateRule.rule
      ? snapshotAgencyRebateRule(agencyRebateRule.rule, agencyRebateRule.matchMode)
      : null,
  };
  const sourceSnapshot = {
    salesOrder: snapshotSalesOrder(salesOrder, orderStatus, calculationDate),
    items,
    confirmedRefunds: confirmedRefunds.map(snapshotAfterSalesOrder),
    unconfirmedRefundSummary: {
      count: unconfirmedRefunds.length,
      totalAmountCents: unconfirmedRefundAmountCents,
      afterSalesOrderIds: unconfirmedRefunds
        .map((order: any) => normalizeOptionalString(order.id))
        .filter(Boolean),
    },
    travelGroup: snapshotTravelGroup(salesOrder.travelGroup),
    travelAgencyMatch: agencyMatch,
    people: snapshotPeople(salesOrder),
  };
  const calculationNoteData = {
    calculationVersion,
    orderStatus: orderStatus.toLowerCase(),
    grossAmountCents,
    confirmedRefundAmountCents,
    effectiveAmountCents,
    salesDeductionAmountCents: salesDeduction.totalAmountCents,
    employeeBaseAmountCents,
    agencyDeductionAmountCents: agencyDeduction.totalAmountCents,
    agencyBaseAmountCents,
    dailyRebateCents,
    monthlyRebateCents,
    warningCodes: warnings.map((warning) => warning.code),
  };

  return {
    calculationVersion,
    warnings,
    amounts: {
      grossAmountCents,
      confirmedRefundAmountCents,
      unconfirmedRefundAmountCents,
      effectiveAmountCents,
      salesDeductionAmountCents: salesDeduction.totalAmountCents,
      employeeBaseAmountCents,
      agencyDeductionAmountCents: agencyDeduction.totalAmountCents,
      agencyBaseAmountCents,
      dailyRebateCents,
      monthlyRebateCents,
    },
    salesDeduction,
    agencyDeduction,
    commissionLines,
    agencyRebateLines,
    ruleSnapshot,
    sourceSnapshot,
    calculationNoteData,
    calculationNote: buildCalculationNote(calculationNoteData),
  };
}

export function calculateOrderEffectiveAmount(salesOrder: any) {
  const orderStatus = normalizeOrderStatus(salesOrder?.status);
  const grossAmountCents = toCents(salesOrder?.totalAmountCents);
  const confirmedRefundAmountCents = sumBy(
    normalizeAfterSalesOrders(salesOrder?.afterSalesOrders).filter(
      (order: any) => order.financeConfirmed,
    ),
    (order: any) => order.refundAmountCents,
  );
  return {
    grossAmountCents,
    confirmedRefundAmountCents,
    effectiveAmountCents: CLOSED_ORDER_STATUSES.has(orderStatus)
      ? 0
      : Math.max(0, grossAmountCents - confirmedRefundAmountCents),
  };
}

function calculateSalesDeduction(
  items: any[],
  rules: any[],
  calculationDate: Date,
  warnings: Stage7CalculationWarning[],
) {
  const itemResults = items.map((item: any) => {
    const rule = matchSalesDeductionRule(
      rules,
      item,
      calculationDate,
    );
    if (!rule) {
      addWarning(
        warnings,
        'missing_sales_deduction_rule',
        'Missing sales deduction rule.',
        {
          productName: item.productName,
          productId: item.productId,
          date: toDateOnly(calculationDate),
        },
      );
    }
    const deductionCostCents = rule ? toCents(rule.deductionCostCents) : 0;
    return {
      itemId: item.id,
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      ruleId: rule?.id || null,
      deductionCostCents,
      deductionAmountCents: deductionCostCents * item.quantity,
      matched: Boolean(rule),
    };
  });
  return {
    totalAmountCents: sumBy(
      itemResults,
      (item: any) => item.deductionAmountCents,
    ),
    items: itemResults,
    ruleSnapshots: itemResults
      .filter((item: any) => item.matched)
      .map((item: any) => ({
        ruleId: item.ruleId,
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        deductionCostCents: item.deductionCostCents,
        deductionAmountCents: item.deductionAmountCents,
      })),
  };
}

function calculateAgencyDeduction(
  items: any[],
  rules: any[],
  agencyMatch: any,
  calculationDate: Date,
  warnings: Stage7CalculationWarning[],
) {
  const itemResults = items.map((item: any) => {
    const matched = matchAgencyRule(
      rules,
      agencyMatch,
      item,
      calculationDate,
    );
    if (!matched.rule) {
      addWarning(
        warnings,
        'missing_agency_deduction_rule',
        'Missing agency deduction rule.',
        {
          agencyId: agencyMatch.agencyId,
          agencyName: agencyMatch.agencyName,
          productName: item.productName,
          productId: item.productId,
          date: toDateOnly(calculationDate),
        },
      );
    }
    const deductionCostCents = matched.rule
      ? toCents(matched.rule.deductionCostCents)
      : 0;
    return {
      itemId: item.id,
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      ruleId: matched.rule?.id || null,
      matchMode: matched.matchMode,
      deductionCostCents,
      deductionAmountCents: deductionCostCents * item.quantity,
      matched: Boolean(matched.rule),
    };
  });
  return {
    totalAmountCents: sumBy(
      itemResults,
      (item: any) => item.deductionAmountCents,
    ),
    items: itemResults,
    ruleSnapshots: itemResults
      .filter((item: any) => item.matched)
      .map((item: any) => ({
        ruleId: item.ruleId,
        matchMode: item.matchMode,
        agencyId: agencyMatch.agencyId,
        agencyName: agencyMatch.agencyName,
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        deductionCostCents: item.deductionCostCents,
        deductionAmountCents: item.deductionAmountCents,
      })),
  };
}

function buildCommissionLines(options: any) {
  const lines: any[] = [];
  const salesUserId =
    normalizeOptionalString(options.salesOrder.salesUserId) ||
    normalizeOptionalString(options.salesOrder.salesUser?.id);
  if (!salesUserId) {
    addWarning(
      options.warnings,
      'missing_sales_user',
      'Missing sales user.',
      {},
    );
  } else {
    lines.push(
      buildCommissionLine(options, SALES_COMMISSION, salesUserId),
    );
  }

  const outreachUserId =
    normalizeOptionalString(options.salesOrder.outreachUserId) ||
    normalizeOptionalString(options.salesOrder.outreachUser?.id);
  if (!outreachUserId) {
    addWarning(
      options.warnings,
      'missing_outreach_user',
      'Missing outreach user.',
      {
        salesOrderId: normalizeOptionalString(options.salesOrder.id),
      },
    );
  } else {
    lines.push(
      buildCommissionLine(options, OUTREACH_COMMISSION, outreachUserId),
    );
  }

  const leaderUserId =
    normalizeOptionalString(options.salesOrder.salesUser?.leaderId) ||
    normalizeOptionalString(options.salesOrder.salesUser?.leader?.id);
  if (!leaderUserId) {
    addWarning(options.warnings, 'missing_leader', 'Missing sales leader.', {
      salesUserId,
    });
  } else {
    lines.push(buildCommissionLine(options, LEADER_COMMISSION, leaderUserId));
  }
  return lines.filter(Boolean);
}

function buildCommissionLine(options: any, targetType: string, targetUserId: string) {
  const rule = options.rules[targetType];
  if (!rule) {
    return null;
  }
  const rateSnapshot = normalizeRate(rule.rate);
  return {
    salesOrderId: normalizeOptionalString(options.salesOrder.id),
    travelGroupId: normalizeOptionalString(options.salesOrder.travelGroupId),
    targetType,
    targetUserId,
    commissionRuleId: normalizeOptionalString(rule.id),
    agencyRebateRuleId: null,
    agencyId: null,
    agencyName: null,
    grossAmountCents: options.grossAmountCents,
    confirmedRefundAmountCents: options.confirmedRefundAmountCents,
    baseAmountCents: options.employeeBaseAmountCents,
    deductionAmountCents: options.salesDeductionAmountCents,
    rateSnapshot,
    amountCents: multiplyCentsByRate(
      options.employeeBaseAmountCents,
      rateSnapshot,
    ),
    pointsCents: 0,
    manualInput: false,
    calculationVersion: options.calculationVersion,
  };
}

function buildAgencyRebateLines(options: any) {
  if (!options.agencyRebateRule) {
    return [];
  }
  const common = {
    salesOrderId: normalizeOptionalString(options.salesOrder.id),
    travelGroupId: normalizeOptionalString(options.salesOrder.travelGroupId),
    targetUserId: null,
    commissionRuleId: null,
    agencyRebateRuleId: normalizeOptionalString(options.agencyRebateRule.id),
    agencyId: options.agencyMatch.agencyId,
    agencyName: options.agencyMatch.agencyName,
    grossAmountCents: options.grossAmountCents,
    confirmedRefundAmountCents: options.confirmedRefundAmountCents,
    baseAmountCents: options.agencyBaseAmountCents,
    deductionAmountCents: options.agencyDeductionAmountCents,
    amountCents: 0,
    manualInput: false,
    calculationVersion: options.calculationVersion,
  };
  return [
    {
      ...common,
      targetType: AGENCY_DAILY_REBATE,
      rateSnapshot: options.dailyRebateRate,
      pointsCents: options.dailyRebateCents,
    },
    {
      ...common,
      targetType: AGENCY_MONTHLY_REBATE,
      rateSnapshot: options.monthlyRebateRate,
      pointsCents: options.monthlyRebateCents,
    },
  ];
}

function resolveCommissionRules(
  rules: any[],
  calculationDate: Date,
  warnings: Stage7CalculationWarning[],
) {
  const result: any = {};
  for (const targetType of [
    SALES_COMMISSION,
    OUTREACH_COMMISSION,
    LEADER_COMMISSION,
  ]) {
    const rule = matchCommissionRule(rules, targetType, calculationDate);
    if (!rule) {
      addWarning(
        warnings,
        'missing_commission_rule',
        'Missing commission rule.',
        {
          targetType,
          date: toDateOnly(calculationDate),
        },
      );
      continue;
    }
    result[targetType] = rule;
  }
  return result;
}

function resolveTravelAgencyMatch(
  salesOrder: any,
  travelAgencies: any[],
  warnings: Stage7CalculationWarning[],
) {
  const travelGroup = salesOrder?.travelGroup || {};
  const explicitAgencyId =
    normalizeOptionalString(salesOrder.agencyId) ||
    normalizeOptionalString(salesOrder.travelAgencyId) ||
    normalizeOptionalString(travelGroup.agencyId) ||
    normalizeOptionalString(travelGroup.travelAgencyId);
  const rawAgencyName =
    normalizeOptionalString(salesOrder.agencyName) ||
    normalizeOptionalString(salesOrder.travelAgency) ||
    normalizeOptionalString(travelGroup.agencyName) ||
    normalizeOptionalString(travelGroup.travelAgency);

  if (explicitAgencyId) {
    const agency = travelAgencies.find(
      (item: any) => normalizeOptionalString(item?.id) === explicitAgencyId,
    );
    return {
      agencyId: explicitAgencyId,
      agencyName: agency?.name || rawAgencyName || null,
      inputAgencyName: rawAgencyName,
      normalizedAgencyName: normalizeComparable(rawAgencyName),
      matchMode: 'agency_id',
      matchedTravelAgencyId: agency?.id || explicitAgencyId,
      matchedTravelAgencyName: agency?.name || null,
      usedTextRuleFallback: false,
    };
  }

  const normalizedName = normalizeComparable(rawAgencyName);
  const matchedAgency = normalizedName
    ? travelAgencies.find(
        (agency: any) => normalizeComparable(agency?.name) === normalizedName,
      )
    : null;
  if (matchedAgency) {
    return {
      agencyId: matchedAgency.id,
      agencyName: matchedAgency.name || rawAgencyName,
      inputAgencyName: rawAgencyName,
      normalizedAgencyName: normalizedName,
      matchMode: 'travel_agency_name_to_id',
      matchedTravelAgencyId: matchedAgency.id,
      matchedTravelAgencyName: matchedAgency.name,
      usedTextRuleFallback: false,
    };
  }

  addWarning(
    warnings,
    'travel_agency_id_not_matched',
    'Travel agency name did not match travel_agencies.name; falling back to agencyName text rules.',
    {
      agencyName: rawAgencyName,
    },
  );
  return {
    agencyId: null,
    agencyName: rawAgencyName,
    inputAgencyName: rawAgencyName,
    normalizedAgencyName: normalizedName,
    matchMode: 'agency_name_text_fallback',
    matchedTravelAgencyId: null,
    matchedTravelAgencyName: null,
    usedTextRuleFallback: true,
  };
}

function matchSalesDeductionRule(rules: any[], item: any, date: Date) {
  return matchEffectiveProductRule(rules, item, date);
}

function matchCommissionRule(rules: any[], targetType: string, date: Date) {
  return findMostRecentEffectiveRule(
    rules.filter((rule: any) => normalizeTargetType(rule.targetType) === targetType),
    date,
  );
}

function matchAgencyRule(
  rules: any[],
  agencyMatch: any,
  item: any,
  date: Date,
) {
  if (agencyMatch.agencyId) {
    const agencyRules =
      rules.filter(
        (candidate: any) =>
          normalizeOptionalString(candidate.agencyId) === agencyMatch.agencyId,
      );
    const rule = matchEffectiveProductRule(
      agencyRules,
      item,
      date,
    );
    return {
      rule,
      matchMode: 'agency_id',
    };
  }

  const normalizedName = normalizeComparable(agencyMatch.agencyName);
  const agencyRules =
    rules.filter(
      (candidate: any) =>
        normalizedName &&
        normalizeComparable(candidate.agencyName) === normalizedName,
    );
  const rule = matchEffectiveProductRule(
    agencyRules,
    item,
    date,
  );
  return {
    rule,
    matchMode: 'agency_name',
  };
}

function matchEffectiveProductRule(rules: any[], item: any, date: Date) {
  if (item === null || item === undefined) {
    return findMostRecentEffectiveRule(rules, date);
  }
  const itemProductId = normalizeOptionalString(item?.productId);
  if (itemProductId) {
    const idMatch = findMostRecentEffectiveRule(
      rules.filter(
        (rule: any) =>
          normalizeOptionalString(rule?.productId) === itemProductId,
      ),
      date,
    );
    if (idMatch) {
      return idMatch;
    }
  }
  const itemProductName = normalizeProductComparable(item?.productName);
  return findMostRecentEffectiveRule(
    rules.filter(
      (rule: any) =>
        (!itemProductId || !normalizeOptionalString(rule?.productId)) &&
        itemProductName &&
        itemProductName === normalizeProductComparable(rule?.productName),
    ),
    date,
  );
}

function findMostRecentEffectiveRule(rules: any[], date: Date) {
  return rules
    .filter((rule: any) => rule?.isActive !== false && isEffectiveOn(rule, date))
    .sort((left: any, right: any) => {
      const rightTime = normalizeDateOnly(right.effectiveFrom).getTime();
      const leftTime = normalizeDateOnly(left.effectiveFrom).getTime();
      return rightTime - leftTime;
    })[0] || null;
}

function isEffectiveOn(rule: any, date: Date) {
  const effectiveFrom = normalizeDateOnly(rule.effectiveFrom);
  const effectiveTo = rule.effectiveTo ? normalizeDateOnly(rule.effectiveTo) : null;
  return (
    effectiveFrom.getTime() <= date.getTime() &&
    (!effectiveTo || date.getTime() <= effectiveTo.getTime())
  );
}

function multiplyCentsByRate(amountCents: number, rate: unknown) {
  const decimal = parseDecimalToScaledInteger(rate);
  const numerator = BigInt(amountCents) * BigInt(decimal.scaledValue);
  const denominator = BigInt(decimal.scale);
  const rounded =
    numerator >= 0
      ? (numerator + denominator / BigInt(2)) / denominator
      : (numerator - denominator / BigInt(2)) / denominator;
  return Number(rounded);
}

function parseDecimalToScaledInteger(value: unknown) {
  const text = normalizeRate(value);
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [integerPart, fractionPart = ''] = unsigned.split('.');
  const scale = 10 ** fractionPart.length;
  const scaledValue = Number(integerPart || 0) * scale + Number(fractionPart || 0);
  return {
    scaledValue: negative ? -scaledValue : scaledValue,
    scale,
  };
}

function normalizeRate(value: unknown) {
  const text =
    value && typeof value === 'object' && 'toString' in value
      ? (value as any).toString()
      : String(value ?? '0');
  const trimmed = text.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return '0.0000';
  }
  return Number(trimmed).toFixed(4);
}

function normalizeOrderItems(items: any[]) {
  return (Array.isArray(items) ? items : []).map((item: any, index: number) => {
    const quantity = Math.max(0, Math.trunc(Number(item?.quantity || 0)));
    const unitPriceCents = toCents(item?.unitPriceCents);
    return {
      id: normalizeOptionalString(item?.id),
      productId: normalizeOptionalString(item?.productId),
      productName: normalizeOptionalString(item?.productName),
      quantity,
      unitPriceCents,
      subtotalCents: toCents(item?.subtotalCents ?? quantity * unitPriceCents),
      sortOrder: Number(item?.sortOrder || index),
    };
  });
}

function normalizeAfterSalesOrders(afterSalesOrders: any[]) {
  return (Array.isArray(afterSalesOrders) ? afterSalesOrders : []).map(
    (order: any) => ({
      id: normalizeOptionalString(order?.id),
      afterSalesNo: normalizeOptionalString(order?.afterSalesNo),
      status: normalizeOptionalString(order?.status),
      actionType: normalizeOptionalString(order?.actionType),
      refundAmountCents: Math.max(0, toCents(order?.refundAmountCents)),
      financeConfirmed: Boolean(order?.financeConfirmed),
      financeConfirmedAt: toIsoString(order?.financeConfirmedAt),
    }),
  );
}

function snapshotSalesOrder(salesOrder: any, orderStatus: string, calculationDate: Date) {
  return {
    id: normalizeOptionalString(salesOrder?.id),
    orderNo: normalizeOptionalString(salesOrder?.orderNo),
    orderDate: toDateOnly(calculationDate),
    status: orderStatus,
    totalAmountCents: toCents(salesOrder?.totalAmountCents),
    salesUserId: normalizeOptionalString(salesOrder?.salesUserId),
    outreachUserId: normalizeOptionalString(salesOrder?.outreachUserId),
    travelGroupId: normalizeOptionalString(salesOrder?.travelGroupId),
  };
}

function snapshotTravelGroup(travelGroup: any) {
  if (!travelGroup) {
    return null;
  }
  return {
    id: normalizeOptionalString(travelGroup.id),
    groupNo: normalizeOptionalString(travelGroup.groupNo),
    visitDate: travelGroup.visitDate ? toDateOnly(normalizeDateOnly(travelGroup.visitDate)) : null,
    travelAgency: normalizeOptionalString(travelGroup.travelAgency),
    tasterId: normalizeOptionalString(travelGroup.tasterId),
    tasterName: normalizeOptionalString(travelGroup.tasterName),
    financeMark:
      travelGroup.financeMark === undefined ? null : Boolean(travelGroup.financeMark),
  };
}

function snapshotAfterSalesOrder(order: any) {
  return {
    id: order.id,
    afterSalesNo: order.afterSalesNo,
    status: order.status,
    actionType: order.actionType,
    refundAmountCents: order.refundAmountCents,
    financeConfirmed: order.financeConfirmed,
    financeConfirmedAt: order.financeConfirmedAt,
  };
}

function snapshotPeople(salesOrder: any) {
  const salesUser = salesOrder?.salesUser || null;
  return {
    salesUserId:
      normalizeOptionalString(salesOrder?.salesUserId) ||
      normalizeOptionalString(salesUser?.id),
    salesUserName: normalizeOptionalString(salesUser?.name),
    outreachUserId:
      normalizeOptionalString(salesOrder?.outreachUserId) ||
      normalizeOptionalString(salesOrder?.outreachUser?.id),
    outreachUserName: normalizeOptionalString(salesOrder?.outreachUser?.name),
    leaderUserId:
      normalizeOptionalString(salesUser?.leaderId) ||
      normalizeOptionalString(salesUser?.leader?.id),
    leaderUserName: normalizeOptionalString(salesUser?.leader?.name),
    tasterId: normalizeOptionalString(salesOrder?.travelGroup?.tasterId),
    tasterName: normalizeOptionalString(salesOrder?.travelGroup?.tasterName),
  };
}

function buildCommissionRuleSnapshot(rules: any) {
  const snapshot: any = {};
  for (const targetType of Object.keys(rules)) {
    const rule = rules[targetType];
    snapshot[targetType] = {
      id: normalizeOptionalString(rule.id),
      ruleName: normalizeOptionalString(rule.ruleName),
      targetType,
      rate: normalizeRate(rule.rate),
      effectiveFrom: toDateOnly(normalizeDateOnly(rule.effectiveFrom)),
      effectiveTo: rule.effectiveTo ? toDateOnly(normalizeDateOnly(rule.effectiveTo)) : null,
    };
  }
  return snapshot;
}

function snapshotAgencyRebateRule(rule: any, matchMode: string) {
  return {
    id: normalizeOptionalString(rule.id),
    agencyId: normalizeOptionalString(rule.agencyId),
    agencyName: normalizeOptionalString(rule.agencyName),
    matchMode,
    dailyRebateRate: normalizeRate(rule.dailyRebateRate),
    monthlyRebateRate: normalizeRate(rule.monthlyRebateRate),
    effectiveFrom: toDateOnly(normalizeDateOnly(rule.effectiveFrom)),
    effectiveTo: rule.effectiveTo ? toDateOnly(normalizeDateOnly(rule.effectiveTo)) : null,
  };
}

function buildCalculationNote(note: any) {
  const warnings = note.warningCodes.length
    ? ` warnings=${note.warningCodes.join(',')}`
    : ' warnings=none';
  return [
    `version=${note.calculationVersion}`,
    `status=${note.orderStatus}`,
    `gross=${note.grossAmountCents}`,
    `confirmedRefund=${note.confirmedRefundAmountCents}`,
    `effective=${note.effectiveAmountCents}`,
    `employeeBase=${note.employeeBaseAmountCents}`,
    `agencyBase=${note.agencyBaseAmountCents}`,
    warnings,
  ].join('; ');
}

function addWarning(
  warnings: Stage7CalculationWarning[],
  code: string,
  message: string,
  context: Record<string, any> = {},
) {
  warnings.push({
    code,
    message,
    context,
  });
}

function normalizeCalculationDate(salesOrder: any) {
  if (salesOrder?.orderDate) {
    return normalizeDateOnly(salesOrder.orderDate);
  }
  if (salesOrder?.travelGroup?.visitDate) {
    return normalizeDateOnly(salesOrder.travelGroup.visitDate);
  }
  return normalizeDateOnly('1970-01-01');
}

function normalizeDateOnly(value: unknown) {
  if (value instanceof Date) {
    return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
  }
  const text = String(value || '').slice(0, 10);
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return new Date('1970-01-01T00:00:00.000Z');
  }
  return date;
}

function toDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function toIsoString(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value ? String(value) : null;
}

function normalizeOrderStatus(value: unknown) {
  return String(value || 'VALID')
    .trim()
    .toUpperCase();
}

function normalizeTargetType(value: unknown) {
  const text = String(value || '').trim();
  return TARGET_TYPE_TO_PRISMA[text] || TARGET_TYPE_TO_PRISMA[text.toLowerCase()] || text.toUpperCase();
}

function normalizeOptionalString(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function normalizeComparable(value: unknown) {
  return String(normalizeOptionalString(value) || '').toLowerCase();
}

function normalizeProductComparable(value: unknown) {
  return String(normalizeOptionalString(value) || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function toCents(value: unknown) {
  const numberValue = Number(value || 0);
  if (!Number.isFinite(numberValue)) {
    return 0;
  }
  return Math.trunc(numberValue);
}

function sumBy(items: any[], mapper: (item: any) => number) {
  return items.reduce((sum, item) => sum + mapper(item), 0);
}
