import { createHttpError } from '../../common/errors';

export const UNASSIGNED_SALES_USER_PARAM = 'unassigned';
export const UNASSIGNED_SALES_USER_NAME = '未分配销售';

export const SALES_PERFORMANCE_SORT_FIELDS = [
  'netSalesAmountCents',
  'grossSalesAmountCents',
  'refundAmountCents',
  'orderCount',
  'averageSalesPerOrderCents',
  'salesUserName',
] as const;

export type SalesPerformanceSortBy =
  (typeof SALES_PERFORMANCE_SORT_FIELDS)[number];
export type SalesPerformanceSortDirection = 'asc' | 'desc';

export interface SalesPerformanceRecord {
  salesUserId: string | null;
  salesUserName: string;
  isActive: boolean;
  isUnassigned: boolean;
  orderCount: number;
  grossSalesAmountCents: number;
  refundAmountCents: number;
  netSalesAmountCents: number;
  averageSalesPerOrderCents: number | null;
}

export interface SalesPerformanceOrder {
  id: string;
  orderNo: string;
  orderDate: string | null;
  customerName: string;
  status: string;
  salesUserId: string | null;
  grossSalesAmountCents: number;
  refundAmountCents: number;
  netSalesAmountCents: number;
  contributesToOrderCount: boolean;
  afterSalesOrderIds: string[];
}

export interface BuildSalesPerformanceInput {
  salesUsers?: any[];
  salesOrders?: any[];
  afterSalesOrders?: any[];
  sortBy?: unknown;
  sortDirection?: unknown;
}

export interface SalesPerformanceDataset {
  records: SalesPerformanceRecord[];
  orders: SalesPerformanceOrder[];
}

type MutableSalesPerformanceRecord = SalesPerformanceRecord;
type MutableSalesPerformanceOrder = SalesPerformanceOrder;

const GROSS_SALES_STATUSES = new Set([
  'VALID',
  'PARTIAL_REFUND',
  'REFUNDED',
]);

export function buildSalesPerformanceDataset(
  input: BuildSalesPerformanceInput = {},
): SalesPerformanceDataset {
  const sortBy = normalizeSalesPerformanceSortBy(input.sortBy);
  const sortDirection = normalizeSalesPerformanceSortDirection(
    input.sortDirection,
  );
  const recordsByKey = new Map<string, MutableSalesPerformanceRecord>();
  const ordersById = new Map<string, MutableSalesPerformanceOrder>();

  for (const user of Array.isArray(input.salesUsers) ? input.salesUsers : []) {
    if (normalizeRole(user?.role) !== 'SALES') {
      continue;
    }
    const salesUserId = normalizeOptionalString(user?.id);
    if (!salesUserId) {
      continue;
    }
    recordsByKey.set(
      salesUserKey(salesUserId),
      emptySalesPerformanceRecord({
        salesUserId,
        salesUserName: normalizeOptionalString(user?.name) || '未命名销售',
        isActive: Boolean(user?.isActive),
      }),
    );
  }

  for (const rawOrder of Array.isArray(input.salesOrders)
    ? input.salesOrders
    : []) {
    const orderId = normalizeOptionalString(rawOrder?.id);
    if (
      !orderId ||
      !GROSS_SALES_STATUSES.has(normalizeStatus(rawOrder?.status)) ||
      !isSalesRevenueOrder(rawOrder)
    ) {
      continue;
    }
    const order = ensureOrder(ordersById, rawOrder);
    if (!order.contributesToOrderCount) {
      order.contributesToOrderCount = true;
      order.grossSalesAmountCents = toInteger(rawOrder?.totalAmountCents);
      order.netSalesAmountCents =
        order.grossSalesAmountCents - order.refundAmountCents;
    }
    ensureRecordForOrder(recordsByKey, rawOrder);
  }

  for (const rawAfterSalesOrder of Array.isArray(input.afterSalesOrders)
    ? input.afterSalesOrders
    : []) {
    const refundAmountCents = toInteger(rawAfterSalesOrder?.refundAmountCents);
    if (!rawAfterSalesOrder?.financeConfirmed || refundAmountCents <= 0) {
      continue;
    }
    const rawOrder = rawAfterSalesOrder?.salesOrder;
    const orderId =
      normalizeOptionalString(rawAfterSalesOrder?.salesOrderId) ||
      normalizeOptionalString(rawOrder?.id);
    if (!orderId || !rawOrder || !isSalesRevenueOrder(rawOrder)) {
      continue;
    }
    const order = ensureOrder(ordersById, {
      ...rawOrder,
      id: orderId,
    });
    order.refundAmountCents += refundAmountCents;
    order.netSalesAmountCents =
      order.grossSalesAmountCents - order.refundAmountCents;
    const afterSalesOrderId = normalizeOptionalString(rawAfterSalesOrder?.id);
    if (
      afterSalesOrderId &&
      !order.afterSalesOrderIds.includes(afterSalesOrderId)
    ) {
      order.afterSalesOrderIds.push(afterSalesOrderId);
    }
    ensureRecordForOrder(recordsByKey, rawOrder);
  }

  for (const order of ordersById.values()) {
    const record = ensureRecord(recordsByKey, {
      salesUserId: order.salesUserId,
    });
    if (order.contributesToOrderCount) {
      record.orderCount += 1;
      record.grossSalesAmountCents += order.grossSalesAmountCents;
    }
    record.refundAmountCents += order.refundAmountCents;
  }

  const records = [...recordsByKey.values()]
    .map(finalizeRecord)
    .filter(
      (record) =>
        record.isActive ||
        record.orderCount > 0 ||
        record.grossSalesAmountCents !== 0 ||
        record.refundAmountCents !== 0,
    );
  records.sort((left, right) =>
    compareSalesPerformanceRecords(
      left,
      right,
      sortBy,
      sortDirection,
    ),
  );

  const orders = [...ordersById.values()]
    .filter(
      (order) =>
        order.contributesToOrderCount ||
        order.grossSalesAmountCents !== 0 ||
        order.refundAmountCents !== 0,
    )
    .map((order) => ({
      ...order,
      afterSalesOrderIds: [...order.afterSalesOrderIds].sort(compareText),
    }));
  orders.sort(compareSalesPerformanceOrders);

  return {
    records,
    orders,
  };
}

export function normalizeSalesPerformanceSortBy(
  value: unknown,
): SalesPerformanceSortBy {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return 'netSalesAmountCents';
  }
  if (
    SALES_PERFORMANCE_SORT_FIELDS.includes(
      normalized as SalesPerformanceSortBy,
    )
  ) {
    return normalized as SalesPerformanceSortBy;
  }
  throw createHttpError(
    400,
    'VALIDATION_FAILED',
    `sortBy must be one of: ${SALES_PERFORMANCE_SORT_FIELDS.join(', ')}.`,
  );
}

export function normalizeSalesPerformanceSortDirection(
  value: unknown,
): SalesPerformanceSortDirection {
  const normalized = normalizeOptionalString(value)?.toLowerCase();
  if (!normalized) {
    return 'desc';
  }
  if (normalized === 'asc' || normalized === 'desc') {
    return normalized;
  }
  throw createHttpError(
    400,
    'VALIDATION_FAILED',
    'sortDirection must be asc or desc.',
  );
}

export function isUnassignedSalesUserParam(value: unknown) {
  return (
    normalizeOptionalString(value)?.toLowerCase() ===
    UNASSIGNED_SALES_USER_PARAM
  );
}

function emptySalesPerformanceRecord(input: {
  salesUserId: string;
  salesUserName: string;
  isActive: boolean;
}): MutableSalesPerformanceRecord {
  return {
    salesUserId: input.salesUserId,
    salesUserName: input.salesUserName,
    isActive: input.isActive,
    isUnassigned: false,
    orderCount: 0,
    grossSalesAmountCents: 0,
    refundAmountCents: 0,
    netSalesAmountCents: 0,
    averageSalesPerOrderCents: null,
  };
}

function ensureRecordForOrder(
  recordsByKey: Map<string, MutableSalesPerformanceRecord>,
  order: any,
) {
  return ensureRecord(recordsByKey, {
    salesUserId: normalizeOptionalString(order?.salesUserId),
    salesUser: order?.salesUser,
  });
}

function ensureRecord(
  recordsByKey: Map<string, MutableSalesPerformanceRecord>,
  input: {
    salesUserId?: string | null;
    salesUser?: any;
  },
) {
  const salesUserId = normalizeOptionalString(input.salesUserId);
  const key = salesUserKey(salesUserId);
  const existing = recordsByKey.get(key);
  if (existing) {
    if (
      salesUserId &&
      existing.salesUserName === '未命名销售' &&
      normalizeOptionalString(input.salesUser?.name)
    ) {
      existing.salesUserName = normalizeOptionalString(
        input.salesUser?.name,
      )!;
    }
    return existing;
  }

  const record: MutableSalesPerformanceRecord = salesUserId
    ? emptySalesPerformanceRecord({
        salesUserId,
        salesUserName:
          normalizeOptionalString(input.salesUser?.name) || '未命名销售',
        isActive: Boolean(input.salesUser?.isActive),
      })
    : {
        salesUserId: null,
        salesUserName: UNASSIGNED_SALES_USER_NAME,
        isActive: false,
        isUnassigned: true,
        orderCount: 0,
        grossSalesAmountCents: 0,
        refundAmountCents: 0,
        netSalesAmountCents: 0,
        averageSalesPerOrderCents: null,
      };
  recordsByKey.set(key, record);
  return record;
}

function ensureOrder(
  ordersById: Map<string, MutableSalesPerformanceOrder>,
  rawOrder: any,
) {
  const orderId = normalizeOptionalString(rawOrder?.id)!;
  const existing = ordersById.get(orderId);
  if (existing) {
    return existing;
  }
  const order: MutableSalesPerformanceOrder = {
    id: orderId,
    orderNo: normalizeOptionalString(rawOrder?.orderNo) || '',
    orderDate: toDateOnly(rawOrder?.orderDate),
    customerName: normalizeOptionalString(rawOrder?.customerName) || '',
    status: normalizeStatus(rawOrder?.status),
    salesUserId: normalizeOptionalString(rawOrder?.salesUserId),
    grossSalesAmountCents: 0,
    refundAmountCents: 0,
    netSalesAmountCents: 0,
    contributesToOrderCount: false,
    afterSalesOrderIds: [],
  };
  ordersById.set(orderId, order);
  return order;
}

function finalizeRecord(
  record: MutableSalesPerformanceRecord,
): SalesPerformanceRecord {
  const netSalesAmountCents =
    record.grossSalesAmountCents - record.refundAmountCents;
  return {
    ...record,
    netSalesAmountCents,
    averageSalesPerOrderCents:
      record.orderCount === 0
        ? null
        : Math.trunc(netSalesAmountCents / record.orderCount),
  };
}

function compareSalesPerformanceRecords(
  left: SalesPerformanceRecord,
  right: SalesPerformanceRecord,
  sortBy: SalesPerformanceSortBy,
  sortDirection: SalesPerformanceSortDirection,
) {
  const direction = sortDirection === 'asc' ? 1 : -1;
  if (sortBy === 'averageSalesPerOrderCents') {
    const leftValue = left.averageSalesPerOrderCents;
    const rightValue = right.averageSalesPerOrderCents;
    if (leftValue === null && rightValue !== null) {
      return 1;
    }
    if (leftValue !== null && rightValue === null) {
      return -1;
    }
    if (leftValue !== null && rightValue !== null && leftValue !== rightValue) {
      return (leftValue - rightValue) * direction;
    }
  } else if (sortBy === 'salesUserName') {
    const nameComparison = compareText(
      left.salesUserName,
      right.salesUserName,
    );
    if (nameComparison !== 0) {
      return nameComparison * direction;
    }
  } else {
    const leftValue = Number(left[sortBy]);
    const rightValue = Number(right[sortBy]);
    if (leftValue !== rightValue) {
      return (leftValue - rightValue) * direction;
    }
  }

  const nameComparison = compareText(
    left.salesUserName,
    right.salesUserName,
  );
  if (nameComparison !== 0) {
    return nameComparison;
  }
  return compareText(left.salesUserId || '', right.salesUserId || '');
}

function compareSalesPerformanceOrders(
  left: SalesPerformanceOrder,
  right: SalesPerformanceOrder,
) {
  const dateComparison = compareText(
    right.orderDate || '',
    left.orderDate || '',
  );
  if (dateComparison !== 0) {
    return dateComparison;
  }
  const orderNoComparison = compareText(left.orderNo, right.orderNo);
  if (orderNoComparison !== 0) {
    return orderNoComparison;
  }
  return compareText(left.id, right.id);
}

function salesUserKey(value: string | null) {
  return value || '__unassigned_sales_user__';
}

function normalizeRole(value: unknown) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function normalizeStatus(value: unknown) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function isSalesRevenueOrder(order: any) {
  if (normalizeStatus(order?.orderType) === 'BUYBACK') {
    return false;
  }
  return (
    !order?.workflowStatus ||
    ['APPROVED', 'COMPLETED'].includes(
      normalizeStatus(order.workflowStatus),
    )
  );
}

function normalizeOptionalString(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function toInteger(value: unknown) {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : 0;
}

function toDateOnly(value: unknown) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  return text ? text.slice(0, 10) : null;
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, 'zh-CN');
}
