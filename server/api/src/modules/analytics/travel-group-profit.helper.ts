import { calculateProductProfitSummary } from '../products/product-profit.helper';
import { calculateOrderProfitFees } from './profit-tax-service-fee.helper';

const EFFECTIVE_ORDER_STATUSES = new Set(['VALID', 'PARTIAL_REFUND']);
const EMPLOYEE_COMMISSION_TARGETS = new Set([
  'SALES_COMMISSION',
  'OUTREACH_COMMISSION',
  'LEADER_COMMISSION',
]);
const AGENCY_DAILY_REBATE = 'AGENCY_DAILY_REBATE';
const AGENCY_MONTHLY_REBATE = 'AGENCY_MONTHLY_REBATE';

export type TravelGroupProfitCalculationStatus =
  | 'complete'
  | 'estimated'
  | 'incomplete'
  | 'no_sales';

export interface TravelGroupProfitWarning {
  code: string;
  message: string;
  context?: Record<string, number | string | boolean | null>;
}

export interface CalculateTravelGroupProfitInput {
  travelGroup?: any;
  salesOrders?: any[];
  commissionRecords?: any[];
  financeSummary?: any | null;
  guidePointsSummaries?: any[];
}

export function calculateTravelGroupProfit(
  input: CalculateTravelGroupProfitInput = {},
) {
  const travelGroup = input.travelGroup || {};
  const salesOrders = Array.isArray(input.salesOrders)
    ? input.salesOrders
    : [];
  const productProfit = calculateProductProfitSummary(salesOrders);
  const effectiveOrderIds = new Set(
    productProfit.orders
      .map((order: any) => optionalString(order?.orderId))
      .filter(Boolean) as string[],
  );
  const effectiveOrders = salesOrders.filter((order: any) =>
    effectiveOrderIds.has(optionalString(order?.id) || ''),
  );
  const feeEligibleOrders = salesOrders.filter((order: any) =>
    EFFECTIVE_ORDER_STATUSES.has(normalizeEnum(order?.status)),
  );
  const relevantRefundOrders = salesOrders.filter(
    (order: any) =>
      EFFECTIVE_ORDER_STATUSES.has(normalizeEnum(order?.status)) ||
      readAfterSalesOrders(order).length > 0,
  );
  const confirmedRefundAmountCents = sumBy(
    relevantRefundOrders.flatMap(readAfterSalesOrders),
    (afterSales: any) =>
      afterSales?.financeConfirmed
        ? nonNegativeInteger(afterSales?.refundAmountCents)
        : 0,
  );
  const pendingRefundAmountCents = sumBy(
    relevantRefundOrders.flatMap(readAfterSalesOrders),
    (afterSales: any) =>
      !afterSales?.financeConfirmed
        ? nonNegativeInteger(afterSales?.refundAmountCents)
        : 0,
  );
  const logisticsFeeCents = sumBy(
    effectiveOrders,
    (order: any) => nonNegativeInteger(order?.logisticsFeeCents),
  );
  const commissionRecords = filterRelevantCommissionRecords(
    input.commissionRecords,
    effectiveOrderIds,
    optionalString(travelGroup?.id),
  );
  const salesCommissionCents = sumCommissionAmount(
    commissionRecords,
    'SALES_COMMISSION',
  );
  const outreachCommissionCents = sumCommissionAmount(
    commissionRecords,
    'OUTREACH_COMMISSION',
  );
  const leaderCommissionCents = sumCommissionAmount(
    commissionRecords,
    'LEADER_COMMISSION',
  );
  const tasterCommissionCents = sumCommissionAmount(
    commissionRecords,
    'TASTER_COMMISSION',
  );
  const manualOrderCommissionCents = sumCommissionAmount(
    commissionRecords,
    'ORDER_MANUAL_COMMISSION',
  );
  const employeeCommissionCents =
    salesCommissionCents +
    outreachCommissionCents +
    leaderCommissionCents;
  const financeSummary = input.financeSummary || null;
  const dailyAgencyRebateCents = financeSummary
    ? nonNegativeInteger(financeSummary.totalDailyRebateCents) +
      sumAfterSalesCommissionPoints(
        commissionRecords,
        AGENCY_DAILY_REBATE,
      )
    : sumCommissionPoints(commissionRecords, AGENCY_DAILY_REBATE);
  const monthlyAgencyRebateCents = financeSummary
    ? nonNegativeInteger(financeSummary.totalMonthlyRebateCents) +
      sumAfterSalesCommissionPoints(
        commissionRecords,
        AGENCY_MONTHLY_REBATE,
      )
    : sumCommissionPoints(commissionRecords, AGENCY_MONTHLY_REBATE);
  const guidePointsDiagnostics = diagnoseGuidePoints(
    effectiveOrders,
    input.guidePointsSummaries,
  );
  const guideDailyPointsCents = guidePointsDiagnostics.daily.amountCents || 0;
  const guideMonthlyPointsCents =
    guidePointsDiagnostics.monthly.amountCents || 0;
  const effectiveSalesAmountCents = nonNegativeInteger(
    productProfit.effectiveSalesAmountCents,
  );
  const actualProductCostCents = nonNegativeInteger(
    productProfit.actualProductCostCents,
  );
  const parkingFeeCents =
    travelGroup?.parkingFeeCents === undefined ||
    travelGroup?.parkingFeeCents === null
      ? 500
      : nonNegativeInteger(travelGroup.parkingFeeCents);
  const cigaretteFeeCents =
    travelGroup?.cigaretteFeeCents === undefined ||
    travelGroup?.cigaretteFeeCents === null
      ? null
      : nonNegativeInteger(travelGroup.cigaretteFeeCents);
  const orderTaxAndServiceFees = feeEligibleOrders.map((order: any) => {
    const calculated = calculateOrderProfitFees(order);
    return {
      orderId: optionalString(order?.id) || '',
      orderNo: optionalString(order?.orderNo) || '',
      orderDate: dateOnly(order?.orderDate),
      financeMarked: calculated.financeMarked,
      effectiveAmountCents: calculated.effectiveAmountCents,
      taxRateSnapshot: calculated.taxRateSnapshot,
      taxFeeCents: calculated.taxCents,
      paymentServiceFeeCents: calculated.paymentServiceFeeCents,
      snapshotComplete: !calculated.missingSnapshots.hasMissingSnapshots,
      missingSnapshotCodes: calculated.missingSnapshots.issues.map(
        (issue) => issue.code,
      ),
      issues: calculated.issues.map((issue) => ({
        ...issue,
        orderId: optionalString(order?.id) || '',
        orderNo: optionalString(order?.orderNo) || '',
      })),
      components: calculated.components,
      paymentDetails: calculated.paymentDetails,
    };
  });
  const taxFeeBlocked = orderTaxAndServiceFees.some(
    (order: any) => order.components?.tax?.status === 'blocked',
  );
  const paymentServiceFeeBlocked = orderTaxAndServiceFees.some(
    (order: any) =>
      order.components?.paymentServiceFee?.status === 'blocked',
  );
  const profitFeeBlocked = taxFeeBlocked || paymentServiceFeeBlocked;
  const knownTaxFeeCents = sumBy(
    orderTaxAndServiceFees,
    (order: any) =>
      order.taxFeeCents === null ? 0 : Number(order.taxFeeCents),
  );
  const knownPaymentServiceFeeCents = sumBy(
    orderTaxAndServiceFees,
    (order: any) =>
      order.paymentServiceFeeCents === null
        ? 0
        : Number(order.paymentServiceFeeCents),
  );
  const taxFeeCents = taxFeeBlocked ? null : knownTaxFeeCents;
  const paymentServiceFeeCents = paymentServiceFeeBlocked
    ? null
    : knownPaymentServiceFeeCents;
  const paymentMethodFeeBreakdown = buildTravelGroupPaymentMethodFeeBreakdown(
    orderTaxAndServiceFees,
  );
  const totalExpenseCents =
    actualProductCostCents +
    logisticsFeeCents +
    parkingFeeCents +
    (cigaretteFeeCents ?? 0) +
    employeeCommissionCents +
    tasterCommissionCents +
    manualOrderCommissionCents +
    dailyAgencyRebateCents +
    monthlyAgencyRebateCents +
    guideDailyPointsCents +
    guideMonthlyPointsCents +
    knownTaxFeeCents +
    knownPaymentServiceFeeCents;
  const warnings = normalizeWarnings(productProfit.warnings);
  const employeeCommissionDiagnostics = diagnoseOrderCommissionComponents(
    effectiveOrders,
    commissionRecords,
  );
  for (const warning of employeeCommissionDiagnostics.warnings) {
    addWarning(warnings, warning);
  }
  for (const orderFee of orderTaxAndServiceFees) {
    for (const issue of orderFee.issues || []) {
      addWarning(warnings, {
        code: issue.code,
        message: issue.message,
        context: {
          orderId: issue.orderId,
          orderNo: issue.orderNo,
          actionHint: issue.actionHint,
        },
      });
    }
  }
  for (const issue of [
    ...guidePointsDiagnostics.daily.issues,
    ...guidePointsDiagnostics.monthly.issues,
  ]) {
    addWarning(warnings, {
      code: issue.code,
      message: issue.message,
      context: {
        orderId: issue.orderId,
        orderNo: issue.orderNo,
        actionHint: issue.actionHint,
      },
    });
  }

  if (cigaretteFeeCents === null) {
    addWarning(warnings, {
      code: 'CIGARETTE_FEE_MISSING',
      message: '香烟费用未填写，请前台补录后再核算利润。',
    });
  }
  if (pendingRefundAmountCents > 0) {
    addWarning(warnings, {
      code: 'PENDING_REFUND_CONFIRMATION',
      message: '存在待财务确认退款，当前有效销售额尚未扣除该金额。',
      context: { pendingRefundAmountCents },
    });
  }
  if (!financeSummary && effectiveSalesAmountCents > 0) {
    addWarning(warnings, {
      code: 'FINANCE_SUMMARY_MISSING',
      message: '旅行团财务汇总缺失，日返和月返使用提成记录积分兼容回退。',
    });
  }
  if (paymentServiceFeeBlocked) {
    addWarning(warnings, {
      code: 'PAYMENT_SERVICE_FEE_SNAPSHOT_MISSING',
      message: '存在订单缺少付款明细、付款方式或手续费率，付款手续费无法计算。',
      context: {
        paymentServiceFeeBlocked,
      },
    });
  }

  const calculationStatus = resolveCalculationStatus({
    effectiveSalesAmountCents,
    costCoverageStatus: productProfit.costCoverageStatus,
    warnings,
    cigaretteFeeMissing: cigaretteFeeCents === null,
    profitFeeBlocked,
    employeeCommissionIncomplete:
      !employeeCommissionDiagnostics.salesCommissionCalculated ||
      !employeeCommissionDiagnostics.outreachCommissionCalculated ||
      !employeeCommissionDiagnostics.leaderCommissionCalculated ||
      guidePointsDiagnostics.incomplete,
  });
  const estimatedProfitCents =
    calculationStatus === 'incomplete'
      ? null
      : calculationStatus === 'no_sales'
        ? -totalExpenseCents
        : effectiveSalesAmountCents - totalExpenseCents;
  const estimatedProfitRate =
    estimatedProfitCents === null || effectiveSalesAmountCents === 0
      ? null
      : estimatedProfitCents / effectiveSalesAmountCents;

  return {
    travelGroupId: optionalString(travelGroup?.id) || '',
    groupNo: optionalString(travelGroup?.groupNo) || '',
    visitDate: dateOnly(travelGroup?.visitDate),
    travelAgency: optionalString(travelGroup?.travelAgency) || '',
    guideName: optionalString(travelGroup?.guideName) || '',
    tasterName: optionalString(travelGroup?.tasterName) || '',
    guestCount: nonNegativeInteger(travelGroup?.guestCount),
    orderCount: nonNegativeInteger(productProfit.orderCount),
    effectiveSalesAmountCents,
    confirmedRefundAmountCents,
    pendingRefundAmountCents,
    actualProductCostCents,
    logisticsFeeCents,
    parkingFeeCents,
    cigaretteFeeCents,
    salesCommissionCents,
    outreachCommissionCents,
    leaderCommissionCents,
    salesCommissionCalculated:
      employeeCommissionDiagnostics.salesCommissionCalculated,
    outreachCommissionCalculated:
      employeeCommissionDiagnostics.outreachCommissionCalculated,
    leaderCommissionCalculated:
      employeeCommissionDiagnostics.leaderCommissionCalculated,
    employeeCommissionCents,
    tasterCommissionCents,
    manualOrderCommissionCents,
    dailyAgencyRebateCents,
    monthlyAgencyRebateCents,
    guideDailyPointsCents,
    guideMonthlyPointsCents,
    taxFeeCents,
    paymentServiceFeeCents,
    paymentMethodFeeBreakdown,
    totalExpenseCents,
    estimatedProfitCents,
    estimatedProfitRate,
    calculationStatus,
    components: {
      salesCommission: employeeCommissionDiagnostics.components.sales,
      outreachCommission:
        employeeCommissionDiagnostics.components.outreach,
      leaderCommission: employeeCommissionDiagnostics.components.leader,
      tax: aggregateOrderComponents(orderTaxAndServiceFees, 'tax'),
      paymentServiceFee: aggregateOrderComponents(
        orderTaxAndServiceFees,
        'paymentServiceFee',
      ),
      guideDailyPoints: guidePointsDiagnostics.daily,
      guideMonthlyPoints: guidePointsDiagnostics.monthly,
    },
    warnings,
    orderTaxAndServiceFees,
  };
}

function resolveCalculationStatus(input: {
  effectiveSalesAmountCents: number;
  costCoverageStatus: string;
  warnings: TravelGroupProfitWarning[];
  cigaretteFeeMissing: boolean;
  profitFeeBlocked: boolean;
  employeeCommissionIncomplete: boolean;
}): TravelGroupProfitCalculationStatus {
  if (
    input.cigaretteFeeMissing ||
    input.profitFeeBlocked ||
    input.employeeCommissionIncomplete
  ) {
    return 'incomplete';
  }
  if (input.effectiveSalesAmountCents <= 0) {
    return 'no_sales';
  }
  if (input.costCoverageStatus !== 'complete') {
    return 'incomplete';
  }
  if (
    input.warnings.some((warning) =>
      [
        'REFUND_COST_REVERSAL_UNAVAILABLE',
        'PENDING_REFUND_CONFIRMATION',
        'FINANCE_SUMMARY_MISSING',
      ].includes(warning.code),
    )
  ) {
    return 'estimated';
  }
  return 'complete';
}

function diagnoseOrderCommissionComponents(
  effectiveOrders: any[],
  commissionRecords: any[],
) {
  const diagnostics = [
    {
      key: 'sales',
      targetType: 'SALES_COMMISSION',
      calculatedKey: 'salesCommissionCalculated',
      missingRuleCode: 'SALES_COMMISSION_RULE_MISSING',
      missingRuleMessage: '订单日期没有适用的销售提成规则。',
      requiresSalesUser: true,
    },
    {
      key: 'outreach',
      targetType: 'OUTREACH_COMMISSION',
      calculatedKey: 'outreachCommissionCalculated',
      missingRuleCode: 'OUTREACH_COMMISSION_RULE_MISSING',
      missingRuleMessage: '订单日期没有适用的外联提成规则。',
      requiresSalesUser: false,
    },
    {
      key: 'leader',
      targetType: 'LEADER_COMMISSION',
      calculatedKey: 'leaderCommissionCalculated',
      missingRuleCode: 'LEADER_COMMISSION_RULE_MISSING',
      missingRuleMessage: '订单日期没有适用的组长提成规则。',
      requiresSalesUser: false,
    },
  ];
  const result: any = {
    warnings: [] as TravelGroupProfitWarning[],
    components: {},
  };
  for (const diagnostic of diagnostics) {
    const issues: any[] = [];
    let amountCents = 0;
    for (const order of effectiveOrders) {
      const orderId = optionalString(order?.id);
      if (!orderId) continue;
      const records = commissionRecords.filter(
        (record: any) =>
          optionalString(record?.salesOrderId) === orderId &&
          !optionalString(record?.afterSalesOrderId) &&
          record?.isActive !== false &&
          normalizeEnum(record?.targetType) === diagnostic.targetType &&
          (Boolean(record?.manualInput) ||
            Boolean(optionalString(record?.commissionRuleId))),
      );
      if (records.length > 0) {
        amountCents += sumBy(records, (record: any) =>
          nonNegativeInteger(record?.amountCents),
        );
        continue;
      }
      const salesUserMissing =
        diagnostic.requiresSalesUser &&
        !optionalString(order?.salesUserId);
      const componentIssue = {
        code: salesUserMissing
          ? 'SALES_USER_MISSING'
          : diagnostic.missingRuleCode,
        message: salesUserMissing
          ? '订单缺少销售人员，销售提成无法计算。'
          : diagnostic.missingRuleMessage,
        orderId,
        orderNo: optionalString(order?.orderNo) || '',
        actionHint: salesUserMissing
          ? '请为订单选择有效的销售人员后重新计算。'
          : '请配置覆盖订单日期的有效提成规则后重新计算。',
      };
      issues.push(componentIssue);
      result.warnings.push({
        code: componentIssue.code,
        message: componentIssue.message,
        context: componentIssue,
      });
    }
    const status =
      effectiveOrders.length === 0
        ? 'not_applicable'
        : issues.length === 0
          ? 'calculated'
          : 'blocked';
    result[diagnostic.calculatedKey] = status !== 'blocked';
    result.components[diagnostic.key] = {
      status,
      amountCents,
      issues,
    };
  }
  return result;
}

function diagnoseGuidePoints(
  effectiveOrders: any[],
  summaries: any[] | undefined,
) {
  const personalOrders = effectiveOrders.filter(
    (order: any) => nonNegativeInteger(order?.personalAmountCents) > 0,
  );
  const guideSummaries = Array.isArray(summaries) ? summaries : [];
  const issues: any[] = [];
  const summaryGuideIds = new Set(
    guideSummaries
      .map((summary: any) => optionalString(summary?.guideId))
      .filter(Boolean) as string[],
  );
  for (const order of personalOrders) {
    const orderId = optionalString(order?.id) || '';
    const orderNo = optionalString(order?.orderNo) || '';
    const guideId = optionalString(order?.personalPointsGuideId);
    if (!guideId) {
      issues.push({
        code: 'GUIDE_PERSONAL_ASSIGNMENT_MISSING',
        message: '订单存在走个人的积分金额，但未指定导游。',
        orderId,
        orderNo,
        actionHint: '请为订单选择承接个人积分的导游后重新计算。',
      });
    } else if (!summaryGuideIds.has(guideId)) {
      issues.push({
        code: 'GUIDE_POINTS_SUMMARY_MISSING',
        message: '订单存在走个人的积分金额，但找不到对应导游积分汇总。',
        orderId,
        orderNo,
        actionHint: '请刷新导游积分汇总后重新计算利润。',
      });
    }
  }
  const status =
    issues.length > 0
      ? 'blocked'
      : personalOrders.length > 0 || guideSummaries.length > 0
        ? 'calculated'
        : 'not_applicable';
  const dailyAmountCents = sumBy(guideSummaries, (summary: any) =>
    nonNegativeInteger(summary?.totalDailyPointsCents),
  );
  const monthlyAmountCents = sumBy(guideSummaries, (summary: any) =>
    nonNegativeInteger(summary?.totalMonthlyPointsCents),
  );
  return {
    daily: { status, amountCents: dailyAmountCents, issues },
    monthly: { status, amountCents: monthlyAmountCents, issues },
    incomplete: status === 'blocked',
  };
}

function aggregateOrderComponents(
  orderFees: any[],
  key: 'tax' | 'paymentServiceFee',
) {
  if (orderFees.length === 0) {
    return { status: 'not_applicable', amountCents: 0, issues: [] };
  }
  const components = orderFees.map((orderFee: any) => ({
    ...(orderFee.components?.[key] || {}),
    orderId: orderFee.orderId,
    orderNo: orderFee.orderNo,
  }));
  const issues = orderFees.flatMap((orderFee: any) =>
    (orderFee.components?.[key]?.issues || []).map((issue: any) => ({
      ...issue,
      orderId: orderFee.orderId,
      orderNo: orderFee.orderNo,
    })),
  );
  const failed = components.some(
    (component: any) => component.status === 'failed',
  );
  const blocked = components.some(
    (component: any) => component.status === 'blocked',
  );
  return {
    status: failed ? 'failed' : blocked ? 'blocked' : 'calculated',
    amountCents:
      failed || blocked
        ? null
        : sumBy(components, (component: any) =>
            nonNegativeInteger(component.amountCents),
          ),
    issues,
  };
}

function buildTravelGroupPaymentMethodFeeBreakdown(
  orderFees: any[],
) {
  const groups = new Map<string, any>();
  for (const orderFee of orderFees) {
    for (const detail of Array.isArray(orderFee?.paymentDetails)
      ? orderFee.paymentDetails
      : []) {
      const paymentMethodId = optionalString(detail?.paymentMethodId);
      const paymentMethodNameSnapshot =
        optionalString(detail?.paymentMethodName) || '';
      const serviceFeeRateSnapshot =
        optionalString(detail?.serviceFeeRateSnapshot);
      const key = JSON.stringify([
        paymentMethodId,
        paymentMethodNameSnapshot,
        serviceFeeRateSnapshot,
      ]);
      const group = groups.get(key) || {
        paymentMethodId,
        paymentMethodNameSnapshot,
        serviceFeeRateSnapshot,
        originalPaymentAmountCents: 0,
        sameDayRefundAmountCents: 0,
        serviceFeeBaseAmountCents: 0,
        serviceFeeCents: 0,
        originalAmountMissing: false,
        serviceFeeBaseMissing: false,
        serviceFeeMissing: false,
        orderIds: new Set<string>(),
      };
      group.orderIds.add(orderFee.orderId);
      group.sameDayRefundAmountCents += nonNegativeInteger(
        detail?.sameDayRefundAmountCents,
      );
      if (detail?.serviceFeeBaseAmountSnapshotCents === null) {
        group.originalAmountMissing = true;
      } else {
        group.originalPaymentAmountCents += nonNegativeInteger(
          detail?.serviceFeeBaseAmountSnapshotCents,
        );
      }
      if (detail?.serviceFeeChargeableBaseAmountCents === null) {
        group.serviceFeeBaseMissing = true;
      } else {
        group.serviceFeeBaseAmountCents += nonNegativeInteger(
          detail?.serviceFeeChargeableBaseAmountCents,
        );
      }
      if (detail?.serviceFeeCents === null) {
        group.serviceFeeMissing = true;
      } else {
        group.serviceFeeCents += nonNegativeInteger(
          detail?.serviceFeeCents,
        );
      }
      groups.set(key, group);
    }
  }
  return [...groups.values()].map((group) => ({
    paymentMethodId: group.paymentMethodId,
    paymentMethodNameSnapshot: group.paymentMethodNameSnapshot,
    serviceFeeRateSnapshot: group.serviceFeeRateSnapshot,
    originalPaymentAmountCents: group.originalAmountMissing
      ? null
      : group.originalPaymentAmountCents,
    sameDayRefundAmountCents: group.sameDayRefundAmountCents,
    serviceFeeBaseAmountCents: group.serviceFeeBaseMissing
      ? null
      : group.serviceFeeBaseAmountCents,
    serviceFeeCents: group.serviceFeeMissing
      ? null
      : group.serviceFeeCents,
    orderCount: group.orderIds.size,
  }));
}

function filterRelevantCommissionRecords(
  records: any[] | undefined,
  effectiveOrderIds: Set<string>,
  travelGroupId: string | null,
) {
  return (Array.isArray(records) ? records : []).filter((record: any) => {
    if (record?.isActive === false) {
      return false;
    }
    if (optionalString(record?.afterSalesOrderId)) {
      return (
        Boolean(record?.isConfirmed) &&
        Boolean(travelGroupId) &&
        optionalString(record?.travelGroupId) === travelGroupId
      );
    }
    const salesOrderId = optionalString(record?.salesOrderId);
    if (salesOrderId) {
      return effectiveOrderIds.has(salesOrderId);
    }
    return (
      Boolean(travelGroupId) &&
      optionalString(record?.travelGroupId) === travelGroupId
    );
  });
}

function sumCommissionAmount(records: any[], targetType: string) {
  return sumBy(
    records.filter(
      (record: any) => normalizeEnum(record?.targetType) === targetType,
    ),
    (record: any) =>
      optionalString(record?.afterSalesOrderId)
        ? signedInteger(record?.amountCents)
        : nonNegativeInteger(record?.amountCents),
  );
}

function sumCommissionPoints(records: any[], targetType: string) {
  return sumBy(
    records.filter(
      (record: any) => normalizeEnum(record?.targetType) === targetType,
    ),
    (record: any) =>
      optionalString(record?.afterSalesOrderId)
        ? signedInteger(record?.pointsCents)
        : nonNegativeInteger(record?.pointsCents),
  );
}

function sumAfterSalesCommissionPoints(
  records: any[],
  targetType: string,
) {
  return sumBy(
    records.filter(
      (record: any) =>
        optionalString(record?.afterSalesOrderId) &&
        Boolean(record?.isConfirmed) &&
        normalizeEnum(record?.targetType) === targetType,
    ),
    (record: any) => signedInteger(record?.pointsCents),
  );
}

function normalizeWarnings(value: unknown): TravelGroupProfitWarning[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((warning: any) => ({
      code: String(warning?.code || '').trim(),
      message: String(warning?.message || warning?.code || '').trim(),
      ...(warning?.context && typeof warning.context === 'object'
        ? { context: { ...warning.context } }
        : {}),
    }))
    .filter((warning) => warning.code);
}

function addWarning(
  warnings: TravelGroupProfitWarning[],
  warning: TravelGroupProfitWarning,
) {
  if (!warnings.some((current) => current.code === warning.code)) {
    warnings.push(warning);
  }
}

function readAfterSalesOrders(order: any) {
  return Array.isArray(order?.afterSalesOrders)
    ? order.afterSalesOrders
    : [];
}

function normalizeEnum(value: unknown) {
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
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function nonNegativeInteger(value: unknown) {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue)
    ? Math.max(0, Math.trunc(numberValue))
    : 0;
}

function signedInteger(value: unknown) {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : 0;
}

function sumBy<T>(items: T[], mapper: (item: T) => number) {
  return items.reduce((sum, item) => sum + mapper(item), 0);
}
