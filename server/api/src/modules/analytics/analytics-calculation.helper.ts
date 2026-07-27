const GROSS_SALES_STATUSES = new Set([
  'VALID',
  'PARTIAL_REFUND',
  'REFUNDED',
]);
const EFFECTIVE_ORDER_STATUSES = new Set(['VALID', 'PARTIAL_REFUND']);

export interface AnalyticsCalculationWarning {
  code: string;
  message: string;
  context?: Record<string, any>;
}

export interface CalculateAnalyticsMetricsInput {
  salesOrders?: any[];
  afterSalesOrders?: any[];
  travelGroups?: any[];
  groupSalesOrders?: any[];
  groupAfterSalesOrders?: any[];
}

export interface AnalyticsMetrics {
  grossSalesAmountCents: number;
  refundAmountCents: number;
  pendingRefundAmountCents: number;
  netSalesAmountCents: number;
  totalGroupCount: number;
  totalGuestCount: number;
  groupScopedNetSalesAmountCents: number;
  averageSalesPerGroupCents: number;
  averageSalesPerGuestCents: number;
  noEffectiveOrderGroupCount: number;
  conversionGroupCount: number;
  noOrderRate: number;
  conversionRate: number;
}

export interface CalculateAnalyticsMetricsResult {
  metrics: AnalyticsMetrics;
  warnings: AnalyticsCalculationWarning[];
}

type NormalizedSalesOrder = {
  id: string | null;
  orderNo: string | null;
  travelGroupId: string | null;
  status: string;
  totalAmountCents: number;
  afterSalesOrders: NormalizedAfterSalesOrder[];
};

type NormalizedAfterSalesOrder = {
  id: string | null;
  afterSalesNo: string | null;
  salesOrderId: string | null;
  refundAmountCents: number;
  financeConfirmed: boolean;
};

type NormalizedTravelGroup = {
  id: string | null;
  groupNo: string | null;
  guestCount: number;
  tasterId: string | null;
  tasterName: string | null;
  salesOrders: NormalizedSalesOrder[];
};

export function calculateAnalyticsMetrics(
  input: CalculateAnalyticsMetricsInput = {},
): CalculateAnalyticsMetricsResult {
  const salesOrders = mergeSalesOrders(normalizeSalesOrders(input.salesOrders));
  const afterSalesOrders = mergeAfterSalesOrders(
    normalizeAfterSalesOrders(input.afterSalesOrders),
  );
  const travelGroups = normalizeTravelGroups(input.travelGroups);
  const travelGroupIds = new Set(
    travelGroups.map((group) => group.id).filter(Boolean) as string[],
  );
  const groupSalesOrders = mergeSalesOrders([
    ...normalizeSalesOrders(input.groupSalesOrders),
    ...travelGroups.flatMap((group) => group.salesOrders),
    ...salesOrders.filter(
      (order) => order.travelGroupId && travelGroupIds.has(order.travelGroupId),
    ),
  ]);
  const groupSalesOrderIds = new Set(
    groupSalesOrders.map((order) => order.id).filter(Boolean) as string[],
  );
  const groupAfterSalesOrders = mergeAfterSalesOrders([
    ...normalizeAfterSalesOrders(input.groupAfterSalesOrders),
    ...groupSalesOrders.flatMap((order) => order.afterSalesOrders),
    ...afterSalesOrders.filter(
      (order) => order.salesOrderId && groupSalesOrderIds.has(order.salesOrderId),
    ),
  ]);
  const allAfterSalesOrderFacts = mergeAfterSalesOrders([
    ...afterSalesOrders,
    ...groupAfterSalesOrders,
    ...salesOrders.flatMap((order) => order.afterSalesOrders),
    ...groupSalesOrders.flatMap((order) => order.afterSalesOrders),
  ]);
  const confirmedRefundBySalesOrderId =
    buildConfirmedRefundBySalesOrderId(allAfterSalesOrderFacts);
  const groupConfirmedRefundBySalesOrderId =
    buildConfirmedRefundBySalesOrderId(groupAfterSalesOrders);
  const grossSalesAmountCents = calculateGrossSalesAmount(salesOrders);
  const refundAmountCents =
    calculateConfirmedRefundAmount(afterSalesOrders);
  const pendingRefundAmountCents =
    calculatePendingRefundAmount(afterSalesOrders);
  const netSalesAmountCents = Math.max(
    0,
    grossSalesAmountCents - refundAmountCents,
  );
  const totalGroupCount = travelGroups.length;
  const totalGuestCount = sumBy(
    travelGroups,
    (group) => group.guestCount,
  );
  const groupScopedGrossSalesAmountCents =
    calculateGrossSalesAmount(groupSalesOrders);
  const groupScopedRefundAmountCents = calculateConfirmedRefundAmount(
    groupAfterSalesOrders,
  );
  const groupScopedNetSalesAmountCents = Math.max(
    0,
    groupScopedGrossSalesAmountCents - groupScopedRefundAmountCents,
  );
  const ordersByTravelGroupId = buildOrdersByTravelGroupId(groupSalesOrders);
  const noEffectiveOrderGroupCount = travelGroups.filter((group) => {
    const groupOrders = group.id
      ? ordersByTravelGroupId.get(group.id) || []
      : group.salesOrders;
    return !groupOrders.some((order) =>
      isEffectiveSalesOrder(order, groupConfirmedRefundBySalesOrderId),
    );
  }).length;
  const conversionGroupCount = totalGroupCount - noEffectiveOrderGroupCount;
  const metrics = {
    grossSalesAmountCents,
    refundAmountCents,
    pendingRefundAmountCents,
    netSalesAmountCents,
    totalGroupCount,
    totalGuestCount,
    groupScopedNetSalesAmountCents,
    averageSalesPerGroupCents: divideCents(
      groupScopedNetSalesAmountCents,
      totalGroupCount,
    ),
    averageSalesPerGuestCents: divideCents(
      groupScopedNetSalesAmountCents,
      totalGuestCount,
    ),
    noEffectiveOrderGroupCount,
    conversionGroupCount,
    noOrderRate: divideRate(noEffectiveOrderGroupCount, totalGroupCount),
    conversionRate: divideRate(conversionGroupCount, totalGroupCount),
  };
  const warnings = buildWarnings({
    pendingRefundAmountCents,
    afterSalesOrders,
    salesOrders: mergeSalesOrders([...salesOrders, ...groupSalesOrders]),
    travelGroups,
    confirmedRefundBySalesOrderId,
  });

  return {
    metrics,
    warnings,
  };
}

export function isEffectiveAnalyticsSalesOrder(order: any) {
  const normalizedOrder = normalizeSalesOrders([order])[0];
  if (!normalizedOrder) {
    return false;
  }
  const confirmedRefundBySalesOrderId = buildConfirmedRefundBySalesOrderId(
    normalizedOrder.afterSalesOrders,
  );
  return isEffectiveSalesOrder(
    normalizedOrder,
    confirmedRefundBySalesOrderId,
  );
}

function calculateGrossSalesAmount(orders: NormalizedSalesOrder[]) {
  return sumBy(orders, (order) =>
    GROSS_SALES_STATUSES.has(order.status) ||
    order.afterSalesOrders.length > 0
      ? order.totalAmountCents
      : 0,
  );
}

function calculateConfirmedRefundAmount(
  afterSalesOrders: NormalizedAfterSalesOrder[],
) {
  return sumBy(afterSalesOrders, (order) =>
    order.financeConfirmed ? order.refundAmountCents : 0,
  );
}

function calculatePendingRefundAmount(
  afterSalesOrders: NormalizedAfterSalesOrder[],
) {
  return sumBy(afterSalesOrders, (order) =>
    !order.financeConfirmed ? order.refundAmountCents : 0,
  );
}

function isEffectiveSalesOrder(
  order: NormalizedSalesOrder,
  confirmedRefundBySalesOrderId: Map<string, number>,
) {
  if (
    !EFFECTIVE_ORDER_STATUSES.has(order.status) &&
    order.afterSalesOrders.length === 0
  ) {
    return false;
  }
  const confirmedRefundAmountCents =
    getConfirmedRefundAmountForOrder(order, confirmedRefundBySalesOrderId);
  return Math.max(0, order.totalAmountCents - confirmedRefundAmountCents) > 0;
}

function getConfirmedRefundAmountForOrder(
  order: NormalizedSalesOrder,
  confirmedRefundBySalesOrderId: Map<string, number>,
) {
  const mappedAmount =
    order.id ? confirmedRefundBySalesOrderId.get(order.id) || 0 : 0;
  if (mappedAmount > 0) {
    return mappedAmount;
  }
  return calculateConfirmedRefundAmount(order.afterSalesOrders);
}

function buildWarnings(input: {
  pendingRefundAmountCents: number;
  afterSalesOrders: NormalizedAfterSalesOrder[];
  salesOrders: NormalizedSalesOrder[];
  travelGroups: NormalizedTravelGroup[];
  confirmedRefundBySalesOrderId: Map<string, number>;
}) {
  const warnings: AnalyticsCalculationWarning[] = [];
  const pendingRefunds = input.afterSalesOrders.filter(
    (order) => !order.financeConfirmed && order.refundAmountCents > 0,
  );
  if (input.pendingRefundAmountCents > 0) {
    addWarning(
      warnings,
      'pending_refund',
      'Unconfirmed refund amount is pending finance confirmation.',
      {
        count: pendingRefunds.length,
        totalAmountCents: input.pendingRefundAmountCents,
        afterSalesOrderIds: pendingRefunds
          .map((order) => order.id)
          .filter(Boolean),
      },
    );
  }

  const refundedOrdersWithoutConfirmedRefund = input.salesOrders.filter(
    (order) =>
      order.status === 'REFUNDED' &&
      getConfirmedRefundAmountForOrder(
        order,
        input.confirmedRefundBySalesOrderId,
      ) <= 0,
  );
  if (refundedOrdersWithoutConfirmedRefund.length > 0) {
    addWarning(
      warnings,
      'refunded_order_without_confirmed_refund',
      'Refunded order has no confirmed refund fact.',
      {
        count: refundedOrdersWithoutConfirmedRefund.length,
        salesOrderIds: refundedOrdersWithoutConfirmedRefund
          .map((order) => order.id)
          .filter(Boolean),
        orderNos: refundedOrdersWithoutConfirmedRefund
          .map((order) => order.orderNo)
          .filter(Boolean),
      },
    );
  }

  const groupsMissingTaster = input.travelGroups.filter(
    (group) => !group.tasterId,
  );
  if (groupsMissingTaster.length > 0) {
    addWarning(warnings, 'missing_taster', 'Travel group is missing taster.', {
      count: groupsMissingTaster.length,
      travelGroupIds: groupsMissingTaster
        .map((group) => group.id)
        .filter(Boolean),
      groupNos: groupsMissingTaster
        .map((group) => group.groupNo)
        .filter(Boolean),
    });
  }

  return warnings;
}

function normalizeTravelGroups(groups: any[]): NormalizedTravelGroup[] {
  return (Array.isArray(groups) ? groups : []).map((group: any) => {
    const id = normalizeOptionalString(group?.id);
    return {
      id,
      groupNo: normalizeOptionalString(group?.groupNo),
      guestCount: toNonNegativeInteger(group?.guestCount),
      tasterId: normalizeOptionalString(group?.tasterId),
      tasterName: normalizeOptionalString(group?.tasterName),
      salesOrders: normalizeSalesOrders(group?.salesOrders, id),
    };
  });
}

function normalizeSalesOrders(
  orders: any[],
  defaultTravelGroupId: string | null = null,
): NormalizedSalesOrder[] {
  return (Array.isArray(orders) ? orders : []).map((order: any) => {
    const id = normalizeOptionalString(order?.id);
    return {
      id,
      orderNo: normalizeOptionalString(order?.orderNo),
      travelGroupId:
        normalizeOptionalString(order?.travelGroupId) || defaultTravelGroupId,
      status: normalizeOrderStatus(order?.status),
      totalAmountCents: toNonNegativeInteger(order?.totalAmountCents),
      afterSalesOrders: normalizeAfterSalesOrders(order?.afterSalesOrders, id),
    };
  });
}

function normalizeAfterSalesOrders(
  afterSalesOrders: any[],
  defaultSalesOrderId: string | null = null,
): NormalizedAfterSalesOrder[] {
  return (Array.isArray(afterSalesOrders) ? afterSalesOrders : []).map(
    (order: any) => ({
      id: normalizeOptionalString(order?.id),
      afterSalesNo: normalizeOptionalString(order?.afterSalesNo),
      salesOrderId:
        normalizeOptionalString(order?.salesOrderId) ||
        normalizeOptionalString(order?.salesOrder?.id) ||
        defaultSalesOrderId,
      refundAmountCents: toNonNegativeInteger(order?.refundAmountCents),
      financeConfirmed: Boolean(order?.financeConfirmed),
    }),
  );
}

function mergeSalesOrders(orders: NormalizedSalesOrder[]) {
  const merged = new Map<string, NormalizedSalesOrder>();
  const result: NormalizedSalesOrder[] = [];
  orders.forEach((order, index) => {
    const key = order.id || `__index_${index}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, order);
      result.push(order);
      return;
    }
    existing.afterSalesOrders = mergeAfterSalesOrders([
      ...existing.afterSalesOrders,
      ...order.afterSalesOrders,
    ]);
    if (!existing.travelGroupId && order.travelGroupId) {
      existing.travelGroupId = order.travelGroupId;
    }
  });
  return result;
}

function mergeAfterSalesOrders(orders: NormalizedAfterSalesOrder[]) {
  const merged = new Map<string, NormalizedAfterSalesOrder>();
  const result: NormalizedAfterSalesOrder[] = [];
  orders.forEach((order, index) => {
    const key = order.id || `__index_${index}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, order);
      result.push(order);
      return;
    }
    existing.salesOrderId = existing.salesOrderId || order.salesOrderId;
    existing.financeConfirmed =
      existing.financeConfirmed || order.financeConfirmed;
    existing.refundAmountCents = Math.max(
      existing.refundAmountCents,
      order.refundAmountCents,
    );
  });
  return result;
}

function buildConfirmedRefundBySalesOrderId(
  afterSalesOrders: NormalizedAfterSalesOrder[],
) {
  const amounts = new Map<string, number>();
  for (const order of afterSalesOrders) {
    if (!order.salesOrderId || !order.financeConfirmed) {
      continue;
    }
    amounts.set(
      order.salesOrderId,
      (amounts.get(order.salesOrderId) || 0) + order.refundAmountCents,
    );
  }
  return amounts;
}

function buildOrdersByTravelGroupId(orders: NormalizedSalesOrder[]) {
  const ordersByTravelGroupId = new Map<string, NormalizedSalesOrder[]>();
  for (const order of orders) {
    if (!order.travelGroupId) {
      continue;
    }
    const ordersForGroup = ordersByTravelGroupId.get(order.travelGroupId) || [];
    ordersForGroup.push(order);
    ordersByTravelGroupId.set(order.travelGroupId, ordersForGroup);
  }
  return ordersByTravelGroupId;
}

function addWarning(
  warnings: AnalyticsCalculationWarning[],
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

function normalizeOrderStatus(value: unknown) {
  return String(value || 'VALID')
    .trim()
    .toUpperCase();
}

function normalizeOptionalString(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function toNonNegativeInteger(value: unknown) {
  const numberValue = Number(value || 0);
  if (!Number.isFinite(numberValue)) {
    return 0;
  }
  return Math.max(0, Math.trunc(numberValue));
}

function sumBy<T>(items: T[], mapper: (item: T) => number) {
  return items.reduce((sum, item) => sum + mapper(item), 0);
}

function divideCents(amountCents: number, denominator: number) {
  if (denominator <= 0) {
    return 0;
  }
  return Math.trunc(amountCents / denominator);
}

function divideRate(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}
