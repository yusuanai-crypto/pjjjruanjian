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
  const orderTaxAndServiceFees = salesOrders.map((order: any) => {
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
      paymentDetails: calculated.paymentDetails,
    };
  });
  const financeMarkedOrderFees = orderTaxAndServiceFees.filter(
    (order: any) => order.financeMarked,
  );
  const taxFeeSnapshotMissing = financeMarkedOrderFees.some(
    (order: any) => order.taxFeeCents === null,
  );
  const paymentServiceFeeSnapshotMissing = financeMarkedOrderFees.some(
    (order: any) => order.paymentServiceFeeCents === null,
  );
  const profitFeeSnapshotMissing =
    taxFeeSnapshotMissing || paymentServiceFeeSnapshotMissing;
  const knownTaxFeeCents = sumBy(
    financeMarkedOrderFees,
    (order: any) =>
      order.taxFeeCents === null ? 0 : Number(order.taxFeeCents),
  );
  const knownPaymentServiceFeeCents = sumBy(
    financeMarkedOrderFees,
    (order: any) =>
      order.paymentServiceFeeCents === null
        ? 0
        : Number(order.paymentServiceFeeCents),
  );
  const taxFeeCents = taxFeeSnapshotMissing ? null : knownTaxFeeCents;
  const paymentServiceFeeCents = paymentServiceFeeSnapshotMissing
    ? null
    : knownPaymentServiceFeeCents;
  const paymentMethodFeeBreakdown = buildTravelGroupPaymentMethodFeeBreakdown(
    financeMarkedOrderFees,
  );
  const totalExpenseCents =
    actualProductCostCents +
    logisticsFeeCents +
    parkingFeeCents +
    (cigaretteFeeCents ?? 0) +
    employeeCommissionCents +
    tasterCommissionCents +
    dailyAgencyRebateCents +
    monthlyAgencyRebateCents +
    knownTaxFeeCents +
    knownPaymentServiceFeeCents;
  const warnings = normalizeWarnings(productProfit.warnings);

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
  if (profitFeeSnapshotMissing) {
    addWarning(warnings, {
      code: 'PAYMENT_SERVICE_FEE_SNAPSHOT_MISSING',
      message: '存在已财务标记订单缺少税率或付款手续费快照，不能按 0 估算利润。',
      context: {
        taxSnapshotMissing: taxFeeSnapshotMissing,
        paymentServiceFeeSnapshotMissing,
      },
    });
  }

  const calculationStatus = resolveCalculationStatus({
    effectiveSalesAmountCents,
    costCoverageStatus: productProfit.costCoverageStatus,
    warnings,
    cigaretteFeeMissing: cigaretteFeeCents === null,
    profitFeeSnapshotMissing,
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
    employeeCommissionCents,
    tasterCommissionCents,
    dailyAgencyRebateCents,
    monthlyAgencyRebateCents,
    taxFeeCents,
    paymentServiceFeeCents,
    paymentMethodFeeBreakdown,
    totalExpenseCents,
    estimatedProfitCents,
    estimatedProfitRate,
    calculationStatus,
    warnings,
    orderTaxAndServiceFees,
  };
}

function resolveCalculationStatus(input: {
  effectiveSalesAmountCents: number;
  costCoverageStatus: string;
  warnings: TravelGroupProfitWarning[];
  cigaretteFeeMissing: boolean;
  profitFeeSnapshotMissing: boolean;
}): TravelGroupProfitCalculationStatus {
  if (
    input.cigaretteFeeMissing ||
    input.profitFeeSnapshotMissing
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
