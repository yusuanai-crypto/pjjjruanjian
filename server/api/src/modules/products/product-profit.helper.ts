const EFFECTIVE_ORDER_STATUSES = new Set([
  'VALID',
  'PARTIAL_REFUND',
]);
const EMPLOYEE_DEDUCTION_TARGETS = new Set([
  'SALES_COMMISSION',
  'OUTREACH_COMMISSION',
  'LEADER_COMMISSION',
]);
const AGENCY_DEDUCTION_TARGETS = new Set([
  'AGENCY_DAILY_REBATE',
  'AGENCY_MONTHLY_REBATE',
]);

export type CostCoverageStatus =
  | 'complete'
  | 'partial'
  | 'unavailable';

export function calculateOrderProductProfit(order: any) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const lineResults = items.map(toProfitLine);
  const coveredLineCount = lineResults.filter(
    (line: any) => line.costCoverageStatus === 'complete',
  ).length;
  const uncoveredLineCount = lineResults.length - coveredLineCount;
  const costCoverageStatus = resolveCoverageStatus(
    lineResults.length,
    coveredLineCount,
  );
  const recordedActualCostCents = sumBy(
    lineResults,
    (line: any) => line.actualCostSubtotalCents || 0,
  );
  const uncoveredSalesAmountCents = sumBy(
    lineResults.filter(
      (line: any) => line.costCoverageStatus !== 'complete',
    ),
    (line: any) => line.subtotalCents,
  );
  const grossSalesAmountCents = nonNegativeInteger(
    order?.totalAmountCents ??
      sumBy(lineResults, (line: any) => line.subtotalCents),
  );
  const confirmedRefundAmountCents = sumBy(
    (Array.isArray(order?.afterSalesOrders) ? order.afterSalesOrders : []).filter(
      (afterSales: any) => afterSales?.financeConfirmed,
    ),
    (afterSales: any) => nonNegativeInteger(afterSales?.refundAmountCents),
  );
  const effectiveSalesAmountCents = Math.max(
    0,
    grossSalesAmountCents - confirmedRefundAmountCents,
  );
  const manualCommissionCostCents = sumBy(
    (Array.isArray(order?.commissionRecords)
      ? order.commissionRecords
      : []
    ).filter(
      (record: any) =>
        String(record?.targetType || '').toUpperCase() ===
          'ORDER_MANUAL_COMMISSION' && record?.isActive !== false,
    ),
    (record: any) => nonNegativeInteger(record?.amountCents),
  );
  const hasRefundEstimateRisk = confirmedRefundAmountCents > 0;
  const canCalculateCompleteProfit = costCoverageStatus === 'complete';
  const calculatedProfitCents = canCalculateCompleteProfit
    ? effectiveSalesAmountCents -
      recordedActualCostCents -
      manualCommissionCostCents
    : null;
  const grossProfitCents =
    calculatedProfitCents !== null && !hasRefundEstimateRisk
      ? calculatedProfitCents
      : null;
  const estimatedGrossProfitCents =
    calculatedProfitCents !== null && hasRefundEstimateRisk
      ? calculatedProfitCents
      : null;
  const warnings = buildProfitWarnings({
    costCoverageStatus,
    uncoveredLineCount,
    uncoveredSalesAmountCents,
    confirmedRefundAmountCents,
  });
  const deductionCosts = readDeductionCostSnapshots(order?.commissionRecords);

  return {
    orderId: optionalString(order?.id),
    orderNo: optionalString(order?.orderNo),
    orderDate: dateOnly(order?.orderDate),
    orderStatus: String(order?.status || '').toLowerCase() || null,
    includedInProfitSummary: isEffectiveOrder(order, effectiveSalesAmountCents),
    grossSalesAmountCents,
    confirmedRefundAmountCents,
    effectiveSalesAmountCents,
    actualProductCostCents: recordedActualCostCents,
    manualCommissionCostCents,
    salesDeductionCostCents: deductionCosts.salesDeductionCostCents,
    agencyDeductionCostCents: deductionCosts.agencyDeductionCostCents,
    grossProfitCents,
    grossMarginCents: grossProfitCents,
    estimatedGrossProfitCents,
    estimatedGrossMarginCents: estimatedGrossProfitCents,
    grossProfitIsEstimated: estimatedGrossProfitCents !== null,
    costCoverageStatus,
    costCoverageRate:
      lineResults.length > 0 ? coveredLineCount / lineResults.length : 0,
    coveredLineCount,
    uncoveredLineCount,
    costGapAmountCents: uncoveredSalesAmountCents,
    uncoveredSalesAmountCents,
    costCoverageWarning: coverageWarning(costCoverageStatus),
    refundCostReversalApplied: false,
    warnings,
    costBreakdown: {
      actualProductCostCents: recordedActualCostCents,
      manualCommissionCostCents,
      salesDeductionCostCents: deductionCosts.salesDeductionCostCents,
      agencyDeductionCostCents: deductionCosts.agencyDeductionCostCents,
      mixedForGrossProfit: false,
      note:
        '商品实际成本、手工订单提成、销售扣单成本和旅行社扣酒成本分别展示；毛利使用商品实际成本及有效手工提成。',
    },
    items: lineResults,
  };
}

export function calculateProductProfitSummary(orders: any[]) {
  const allOrderResults = (Array.isArray(orders) ? orders : []).map(
    calculateOrderProductProfit,
  );
  const orderResults = allOrderResults.filter(
    (order: any) => order.includedInProfitSummary,
  );
  const totalLineCount = sumBy(
    orderResults,
    (order: any) => order.coveredLineCount + order.uncoveredLineCount,
  );
  const coveredLineCount = sumBy(
    orderResults,
    (order: any) => order.coveredLineCount,
  );
  const uncoveredLineCount = sumBy(
    orderResults,
    (order: any) => order.uncoveredLineCount,
  );
  const coveredOrderCount = orderResults.filter(
    (order: any) => order.costCoverageStatus === 'complete',
  ).length;
  const uncoveredOrderCount = orderResults.length - coveredOrderCount;
  const costCoverageStatus = resolveCoverageStatus(
    totalLineCount,
    coveredLineCount,
  );
  const effectiveSalesAmountCents = sumBy(
    orderResults,
    (order: any) => order.effectiveSalesAmountCents,
  );
  const actualProductCostCents = sumBy(
    orderResults,
    (order: any) => order.actualProductCostCents,
  );
  const manualCommissionCostCents = sumBy(
    orderResults,
    (order: any) => nonNegativeInteger(order.manualCommissionCostCents),
  );
  const confirmedRefundAmountCents = sumBy(
    orderResults,
    (order: any) => order.confirmedRefundAmountCents,
  );
  const hasRefundEstimateRisk = confirmedRefundAmountCents > 0;
  const calculatedProfitCents =
    costCoverageStatus === 'complete'
      ? effectiveSalesAmountCents -
        actualProductCostCents -
        manualCommissionCostCents
      : null;
  const grossProfitCents =
    calculatedProfitCents !== null && !hasRefundEstimateRisk
      ? calculatedProfitCents
      : null;
  const estimatedGrossProfitCents =
    calculatedProfitCents !== null && hasRefundEstimateRisk
      ? calculatedProfitCents
      : null;
  const uncoveredSalesAmountCents = sumBy(
    orderResults,
    (order: any) => order.uncoveredSalesAmountCents,
  );
  const salesDeductionCosts = aggregateOptionalCost(
    orderResults.map((order: any) => order.salesDeductionCostCents),
  );
  const agencyDeductionCosts = aggregateOptionalCost(
    orderResults.map((order: any) => order.agencyDeductionCostCents),
  );
  const warnings = buildProfitWarnings({
    costCoverageStatus,
    uncoveredLineCount,
    uncoveredSalesAmountCents,
    confirmedRefundAmountCents,
  });

  return {
    orderCount: orderResults.length,
    effectiveSalesAmountCents,
    confirmedRefundAmountCents,
    actualProductCostCents,
    manualCommissionCostCents,
    salesDeductionCostCents: salesDeductionCosts.amountCents,
    salesDeductionCoveredOrderCount: salesDeductionCosts.coveredCount,
    agencyDeductionCostCents: agencyDeductionCosts.amountCents,
    agencyDeductionCoveredOrderCount: agencyDeductionCosts.coveredCount,
    grossProfitCents,
    grossMarginCents: grossProfitCents,
    estimatedGrossProfitCents,
    estimatedGrossMarginCents: estimatedGrossProfitCents,
    grossProfitIsEstimated: estimatedGrossProfitCents !== null,
    costCoverageStatus,
    costCoverageRate:
      totalLineCount > 0 ? coveredLineCount / totalLineCount : 0,
    coveredLineCount,
    uncoveredLineCount,
    coveredOrderCount,
    uncoveredOrderCount,
    costGapAmountCents: uncoveredSalesAmountCents,
    uncoveredSalesAmountCents,
    costCoverageWarning: coverageWarning(costCoverageStatus),
    refundCostReversalApplied: false,
    warnings,
    costBreakdown: {
      actualProductCostCents,
      manualCommissionCostCents,
      salesDeductionCostCents: salesDeductionCosts.amountCents,
      agencyDeductionCostCents: agencyDeductionCosts.amountCents,
      mixedForGrossProfit: false,
      note:
        '商品实际成本、手工订单提成、销售扣单成本和旅行社扣酒成本分别展示；毛利使用商品实际成本及有效手工提成。',
    },
    orders: orderResults,
  };
}

function toProfitLine(item: any) {
  const actualCostSubtotalCents = nullableInteger(
    item?.actualCostSubtotalCents,
  );
  const subtotalCents = nonNegativeInteger(
    item?.subtotalCents ??
      nonNegativeInteger(item?.quantity) *
        nonNegativeInteger(item?.unitPriceCents),
  );
  return {
    itemId: optionalString(item?.id),
    productId: optionalString(item?.productId),
    productName: optionalString(item?.productName),
    unit: optionalString(item?.unit),
    quantity: nonNegativeInteger(item?.quantity),
    subtotalCents,
    actualCostSubtotalCents,
    grossProfitCents:
      actualCostSubtotalCents === null
        ? null
        : subtotalCents - actualCostSubtotalCents,
    costCoverageStatus:
      actualCostSubtotalCents === null ? 'unavailable' : 'complete',
  };
}

function readDeductionCostSnapshots(records: any[]) {
  const rows = Array.isArray(records) ? records : [];
  const salesRecord = rows.find((record: any) =>
    EMPLOYEE_DEDUCTION_TARGETS.has(normalizeTargetType(record?.targetType)),
  );
  const agencyRecord = rows.find((record: any) =>
    AGENCY_DEDUCTION_TARGETS.has(normalizeTargetType(record?.targetType)),
  );
  return {
    salesDeductionCostCents: salesRecord
      ? nonNegativeInteger(salesRecord.deductionAmountCents)
      : null,
    agencyDeductionCostCents: agencyRecord
      ? nonNegativeInteger(agencyRecord.deductionAmountCents)
      : null,
  };
}

function resolveCoverageStatus(
  totalLineCount: number,
  coveredLineCount: number,
): CostCoverageStatus {
  if (totalLineCount <= 0 || coveredLineCount <= 0) {
    return 'unavailable';
  }
  return coveredLineCount === totalLineCount ? 'complete' : 'partial';
}

function coverageWarning(status: CostCoverageStatus) {
  if (status === 'partial') {
    return '部分有效订单明细缺少实际成本快照，无法输出完整精确毛利。';
  }
  if (status === 'unavailable') {
    return '没有可用的实际成本快照，无法计算完整毛利。';
  }
  return null;
}

function buildProfitWarnings(input: any) {
  const warnings = [];
  const costWarning = coverageWarning(input.costCoverageStatus);
  if (costWarning) {
    warnings.push({
      code:
        input.costCoverageStatus === 'partial'
          ? 'ACTUAL_COST_COVERAGE_PARTIAL'
          : 'ACTUAL_COST_COVERAGE_UNAVAILABLE',
      message: costWarning,
      context: {
        uncoveredLineCount: input.uncoveredLineCount,
        costGapAmountCents: input.uncoveredSalesAmountCents,
      },
    });
  }
  if (input.confirmedRefundAmountCents > 0) {
    warnings.push({
      code: 'REFUND_COST_REVERSAL_UNAVAILABLE',
      message:
        '售后退款缺少商品级退货数量，未自动冲回商品成本；净毛利仅为估算。',
      context: {
        confirmedRefundAmountCents: input.confirmedRefundAmountCents,
      },
    });
  }
  return warnings;
}

function isEffectiveOrder(order: any, effectiveSalesAmountCents: number) {
  if (normalizeTargetType(order?.orderType) === 'BUYBACK') {
    return false;
  }
  if (
    order?.workflowStatus &&
    !['APPROVED', 'COMPLETED'].includes(
      normalizeTargetType(order.workflowStatus),
    )
  ) {
    return false;
  }
  return (
    (EFFECTIVE_ORDER_STATUSES.has(normalizeTargetType(order?.status)) ||
      (Array.isArray(order?.afterSalesOrders) &&
        order.afterSalesOrders.length > 0)) &&
    effectiveSalesAmountCents > 0
  );
}

function aggregateOptionalCost(values: Array<number | null>) {
  const covered = values.filter((value) => value !== null) as number[];
  return {
    amountCents:
      covered.length > 0 ? sumBy(covered, (value) => value) : null,
    coveredCount: covered.length,
  };
}

function normalizeTargetType(value: unknown) {
  return String(value || '').trim().toUpperCase();
}

function optionalString(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function dateOnly(value: unknown) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toISOString().slice(0, 10);
}

function nullableInteger(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : null;
}

function nonNegativeInteger(value: unknown) {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue)
    ? Math.max(0, Math.trunc(numberValue))
    : 0;
}

function sumBy<T>(items: T[], mapper: (item: T) => number) {
  return items.reduce((sum, item) => sum + mapper(item), 0);
}
