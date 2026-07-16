import * as crypto from 'node:crypto';

export const RECONCILIATION_TIMEZONE = 'Asia/Shanghai';

export const RECONCILIATION_INCLUDED_ORDER_STATUSES = [
  'VALID',
  'PARTIAL_REFUND',
  'REFUNDED',
] as const;

export const RECONCILIATION_ORDER_TYPE_FIELDS: Record<string, string> = {
  TRAVEL_GROUP: 'travelGroupSalesCents',
  BUYBACK: 'buybackCents',
  EXTERNAL: 'externalSalesCents',
  INTERNAL: 'internalPurchaseCents',
  AFTER_SALES: 'afterSalesCents',
};

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReconciliationDateTimeRange {
  start: Date;
  end: Date;
}

export interface ReconciliationCalculationInput {
  businessDate: string;
  orders?: any[];
  refunds?: any[];
  manual?: any;
}

export interface ReconciliationCalculationResult {
  businessDate: string;
  travelGroupSalesCents: number;
  backOfficeSalesCents: number;
  buybackCents: number;
  externalSalesCents: number;
  internalPurchaseCents: number;
  afterSalesCents: number;
  refundsCents: number;
  receivableTotalCents: number;
  actualTotalCents: number;
  differenceCents: number;
  sourceHash: string;
}

export function normalizeReconciliationBusinessDate(value: unknown) {
  const text = String(value || '').trim();
  const match = text.match(DATE_ONLY_PATTERN);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return text;
}

export function buildShanghaiNaturalDayRange(
  businessDateValue: unknown,
): ReconciliationDateTimeRange | null {
  const businessDate = normalizeReconciliationBusinessDate(businessDateValue);
  if (!businessDate) {
    return null;
  }
  const [year, month, day] = businessDate.split('-').map(Number);
  const shanghaiMidnightAsUtc = Date.UTC(year, month - 1, day);
  const startMs = shanghaiMidnightAsUtc - SHANGHAI_OFFSET_MS;
  return {
    start: new Date(startMs),
    end: new Date(startMs + DAY_MS - 1),
  };
}

export function listReconciliationBusinessDates(
  dateFromValue: unknown,
  dateToValue: unknown,
) {
  const dateFrom = normalizeReconciliationBusinessDate(dateFromValue);
  const dateTo = normalizeReconciliationBusinessDate(dateToValue);
  if (!dateFrom || !dateTo) {
    return null;
  }
  const startMs = Date.parse(`${dateFrom}T00:00:00.000Z`);
  const endMs = Date.parse(`${dateTo}T00:00:00.000Z`);
  if (startMs > endMs) {
    return [];
  }
  const dates: string[] = [];
  for (let time = startMs; time <= endMs; time += DAY_MS) {
    dates.push(new Date(time).toISOString().slice(0, 10));
  }
  return dates;
}

export function formatShanghaiBusinessDate(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: RECONCILIATION_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatDatabaseDate(value: unknown) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

export function calculateReconciliation(
  input: ReconciliationCalculationInput,
): ReconciliationCalculationResult {
  const businessDate = normalizeReconciliationBusinessDate(input.businessDate);
  if (!businessDate) {
    throw new Error('businessDate must be a valid YYYY-MM-DD date.');
  }

  const amounts: Record<string, number> = {
    travelGroupSalesCents: 0,
    backOfficeSalesCents: toIntegerCents(input.manual?.backOfficeSalesCents),
    buybackCents: 0,
    externalSalesCents: 0,
    internalPurchaseCents: 0,
    afterSalesCents: 0,
  };
  const includedOrders = (Array.isArray(input.orders) ? input.orders : [])
    .filter((order) =>
      RECONCILIATION_INCLUDED_ORDER_STATUSES.includes(
        normalizeEnum(order?.status) as any,
      ),
    )
    .filter((order) => RECONCILIATION_ORDER_TYPE_FIELDS[normalizeEnum(order?.orderType)]);

  for (const order of includedOrders) {
    const field = RECONCILIATION_ORDER_TYPE_FIELDS[normalizeEnum(order?.orderType)];
    amounts[field] = safeAdd(
      amounts[field],
      toIntegerCents(order?.totalAmountCents),
    );
  }

  const includedRefunds = (Array.isArray(input.refunds) ? input.refunds : [])
    .filter((refund) => Boolean(refund?.financeConfirmed))
    .filter(
      (refund) => formatShanghaiBusinessDate(refund?.createdAt) === businessDate,
    );
  const refundsCents = includedRefunds.reduce(
    (sum, refund) => safeAdd(sum, toNonNegativeIntegerCents(refund?.refundAmountCents)),
    0,
  );
  const paymentMethods = normalizePaymentMethods(input.manual?.paymentMethods);
  const actualTotalCents = paymentMethods.reduce(
    (sum, method) => safeAdd(sum, method.amountCents),
    0,
  );
  const receivableTotalCents = safeAdd(
    safeAdd(
      safeAdd(
        safeAdd(
          safeAdd(
            safeAdd(
              amounts.travelGroupSalesCents,
              amounts.backOfficeSalesCents,
            ),
            amounts.buybackCents,
          ),
          amounts.externalSalesCents,
        ),
        amounts.internalPurchaseCents,
      ),
      amounts.afterSalesCents,
    ),
    -refundsCents,
  );

  const sourceHash = buildSourceHash({
    businessDate,
    includedOrders,
    includedRefunds,
    backOfficeSalesCents: amounts.backOfficeSalesCents,
    paymentMethods,
  });

  return {
    businessDate,
    travelGroupSalesCents: amounts.travelGroupSalesCents,
    backOfficeSalesCents: amounts.backOfficeSalesCents,
    buybackCents: amounts.buybackCents,
    externalSalesCents: amounts.externalSalesCents,
    internalPurchaseCents: amounts.internalPurchaseCents,
    afterSalesCents: amounts.afterSalesCents,
    refundsCents,
    receivableTotalCents,
    actualTotalCents,
    differenceCents: safeAdd(actualTotalCents, -receivableTotalCents),
    sourceHash,
  };
}

function buildSourceHash(input: {
  businessDate: string;
  includedOrders: any[];
  includedRefunds: any[];
  backOfficeSalesCents: number;
  paymentMethods: Array<{
    name: string;
    amountCents: number;
    sortOrder: number;
  }>;
}) {
  const facts = {
    businessDate: input.businessDate,
    orders: input.includedOrders
      .map((order) => ({
        id: String(order?.id || ''),
        orderType: normalizeEnum(order?.orderType),
        status: normalizeEnum(order?.status),
        totalAmountCents: toIntegerCents(order?.totalAmountCents),
      }))
      .sort(compareFactIds),
    refunds: input.includedRefunds
      .map((refund) => ({
        id: String(refund?.id || ''),
        createdAt: toIsoString(refund?.createdAt),
        refundAmountCents: toNonNegativeIntegerCents(
          refund?.refundAmountCents,
        ),
      }))
      .sort(compareFactIds),
    backOfficeSalesCents: input.backOfficeSalesCents,
    paymentMethods: input.paymentMethods,
  };
  return crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex');
}

function normalizePaymentMethods(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .map((method: any, index) => ({
      name: String(method?.name || '').trim(),
      amountCents: toIntegerCents(method?.amountCents),
      sortOrder: Number.isSafeInteger(Number(method?.sortOrder))
        ? Number(method.sortOrder)
        : index + 1,
    }))
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder;
      }
      return left.name.localeCompare(right.name);
    });
}

function normalizeEnum(value: unknown) {
  return String(value || '').trim().toUpperCase();
}

function toIntegerCents(value: unknown) {
  const amount = Number(value || 0);
  if (!Number.isSafeInteger(amount)) {
    throw new Error('Money values must be safe integer cents.');
  }
  return amount;
}

function toNonNegativeIntegerCents(value: unknown) {
  return Math.max(0, toIntegerCents(value));
}

function safeAdd(left: number, right: number) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new Error('Money total exceeds the safe integer cents range.');
  }
  return result;
}

function compareFactIds(left: any, right: any) {
  return String(left.id).localeCompare(String(right.id));
}

function toIsoString(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? String(value || '') : date.toISOString();
}
