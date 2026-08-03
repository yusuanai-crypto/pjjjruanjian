export const PROFIT_TAX_RATE = '0.01';
export const PROFIT_FEE_TIME_ZONE = 'Asia/Shanghai';

const EFFECTIVE_ORDER_STATUSES = new Set(['VALID', 'PARTIAL_REFUND']);
const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: PROFIT_FEE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export type DecimalRateInput =
  | string
  | number
  | bigint
  | { toString(): string }
  | null
  | undefined;

export interface ProfitFeeSnapshotIssue {
  code:
    | 'TAX_RATE_SNAPSHOT_MISSING'
    | 'PAYMENT_FEE_RATE_SNAPSHOT_MISSING'
    | 'PAYMENT_FEE_BASE_SNAPSHOT_MISSING';
  paymentDetailId?: string | null;
}

export type ProfitComponentStatus =
  | 'calculated'
  | 'not_applicable'
  | 'blocked'
  | 'failed';

export interface ProfitCalculationIssue {
  code: string;
  message: string;
  actionHint: string;
  paymentDetailId?: string | null;
}

export interface ProfitComponentCalculation {
  status: ProfitComponentStatus;
  amountCents: number | null;
  issues: ProfitCalculationIssue[];
}

export interface ProfitFeeSnapshotInspection {
  hasMissingSnapshots: boolean;
  taxRateSnapshotMissing: boolean;
  paymentDetails: Array<{
    paymentDetailId: string | null;
    missingFields: Array<
      'serviceFeeRateSnapshot' | 'serviceFeeBaseAmountSnapshotCents'
    >;
  }>;
  issues: ProfitFeeSnapshotIssue[];
}

export interface PaymentDetailServiceFeeResult {
  paymentDetailId: string | null;
  paymentMethodId: string | null;
  paymentMethodName: string;
  serviceFeeRateSnapshot: string | null;
  serviceFeeBaseAmountSnapshotCents: number | null;
  sameDayRefundAmountCents: number;
  serviceFeeChargeableBaseAmountCents: number | null;
  serviceFeeCents: number | null;
}

export interface PaymentMethodServiceFeeBreakdown {
  paymentMethodId: string | null;
  paymentMethodName: string;
  serviceFeeRateSnapshot: string | null;
  paymentDetailIds: string[];
  serviceFeeBaseAmountSnapshotCents: number | null;
  sameDayRefundAmountCents: number;
  serviceFeeChargeableBaseAmountCents: number | null;
  serviceFeeCents: number | null;
}

export interface OrderProfitFeeCalculation {
  financeMarked: boolean;
  effectiveAmountCents: number;
  taxRateSnapshot: string | null;
  taxCents: number | null;
  paymentServiceFeeCents: number | null;
  totalTaxAndServiceFeeCents: number | null;
  paymentDetails: PaymentDetailServiceFeeResult[];
  paymentMethods: PaymentMethodServiceFeeBreakdown[];
  missingSnapshots: ProfitFeeSnapshotInspection;
  issues: ProfitCalculationIssue[];
  components: {
    tax: ProfitComponentCalculation;
    paymentServiceFee: ProfitComponentCalculation;
  };
}

/**
 * Integer division rounded to the nearest integer, with an exact half rounded
 * away from zero ("round half up" for the non-negative money values here).
 */
export function roundHalfUpDivision(
  dividend: bigint,
  divisor: bigint,
): bigint {
  if (divisor <= 0n) {
    throw new RangeError('divisor must be greater than zero.');
  }
  const negative = dividend < 0n;
  const absoluteDividend = negative ? -dividend : dividend;
  const rounded = (absoluteDividend + divisor / 2n) / divisor;
  return negative ? -rounded : rounded;
}

export const roundHalfUp = roundHalfUpDivision;

/**
 * Calculates the amount still effective after every financially confirmed
 * refund. Finance marking does not affect whether sales remain effective.
 */
export function calculateEffectiveOrderAmountCents(order: any): number {
  const status = normalizeEnum(order?.status);
  if (status && !EFFECTIVE_ORDER_STATUSES.has(status)) {
    return 0;
  }
  const totalAmountCents = nonNegativeCents(order?.totalAmountCents);
  const confirmedRefundCents = readAfterSalesOrders(order).reduce(
    (total, refund) =>
      refund?.financeConfirmed === true
        ? total + nonNegativeCents(refund?.refundAmountCents)
        : total,
    0n,
  );
  return toSafeCentsNumber(maxBigInt(0n, totalAmountCents - confirmedRefundCents));
}

export const calculateEffectiveAmountCents =
  calculateEffectiveOrderAmountCents;

/**
 * Tax is calculated once per order. Unmarked orders always return zero; the
 * order-level calculator supplies the system's fixed 1% rate for marked orders.
 */
export function calculateOrderTaxCents(
  input:
    | {
        financeMark?: boolean;
        effectiveAmountCents: number | bigint | string;
        taxRateSnapshot: DecimalRateInput;
      }
    | number
    | bigint,
  taxRateSnapshot?: DecimalRateInput,
): number | null {
  if (typeof input === 'object' && input !== null) {
    if (input.financeMark !== true) {
      return 0;
    }
    return calculateCentsAtRate(
      nonNegativeCents(input.effectiveAmountCents),
      input.taxRateSnapshot,
    );
  }
  return calculateCentsAtRate(nonNegativeCents(input), taxRateSnapshot);
}

export const calculateTaxCents = calculateOrderTaxCents;

/**
 * Service fee for one payment detail. The fee base is the captured payment
 * amount less confirmed same-day refunds assigned to this exact detail.
 */
export function calculatePaymentDetailServiceFeeCents(
  input:
    | {
        serviceFeeRateSnapshot: DecimalRateInput;
        serviceFeeBaseAmountSnapshotCents:
          | number
          | bigint
          | string
          | null
          | undefined;
        sameDayRefundAmountCents?: number | bigint | string | null;
      }
    | number
    | bigint,
  serviceFeeRateSnapshot?: DecimalRateInput,
  sameDayRefundAmountCents: number | bigint | string = 0,
): number | null {
  if (typeof input === 'object' && input !== null) {
    if (
      input.serviceFeeBaseAmountSnapshotCents === null ||
      input.serviceFeeBaseAmountSnapshotCents === undefined
    ) {
      return null;
    }
    const chargeableBaseCents = maxBigInt(
      0n,
      nonNegativeCents(input.serviceFeeBaseAmountSnapshotCents) -
        nonNegativeCents(input.sameDayRefundAmountCents),
    );
    return calculateCentsAtRate(
      chargeableBaseCents,
      input.serviceFeeRateSnapshot,
    );
  }
  const chargeableBaseCents = maxBigInt(
    0n,
    nonNegativeCents(input) - nonNegativeCents(sameDayRefundAmountCents),
  );
  return calculateCentsAtRate(
    chargeableBaseCents,
    serviceFeeRateSnapshot,
  );
}

export const calculateServiceFeeCents =
  calculatePaymentDetailServiceFeeCents;

export function isSameShanghaiNaturalDay(
  left: unknown,
  right: unknown,
): boolean {
  const leftKey = toShanghaiDateKey(left);
  const rightKey = toShanghaiDateKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

export const isSameShanghaiDay = isSameShanghaiNaturalDay;

/**
 * Returns confirmed same-day refund cents grouped by the selected source
 * payment-detail id. Cross-day, unconfirmed, unassigned, or explicitly
 * non-deducting refunds are ignored.
 */
export function aggregateSameDayRefundsByPaymentDetail(
  orderDate: unknown,
  afterSalesOrders: any[] | null | undefined,
): Record<string, number> {
  const totals = new Map<string, bigint>();
  for (const refund of Array.isArray(afterSalesOrders)
    ? afterSalesOrders
    : []) {
    const paymentDetailId = optionalString(refund?.refundPaymentDetailId);
    if (
      refund?.financeConfirmed !== true ||
      !paymentDetailId ||
      refund?.deductsPaymentServiceFee === false ||
      !refund?.refundOccurredAt ||
      !isSameShanghaiNaturalDay(orderDate, refund.refundOccurredAt)
    ) {
      continue;
    }
    const refundAmountCents = nonNegativeCents(refund?.refundAmountCents);
    totals.set(
      paymentDetailId,
      (totals.get(paymentDetailId) || 0n) + refundAmountCents,
    );
  }
  return Object.fromEntries(
    [...totals.entries()].map(([paymentDetailId, amountCents]) => [
      paymentDetailId,
      toSafeCentsNumber(amountCents),
    ]),
  );
}

export const sumSameDayRefundsByPaymentDetail =
  aggregateSameDayRefundsByPaymentDetail;

export function findMissingProfitFeeSnapshots(
  order: any,
): ProfitFeeSnapshotInspection {
  if (order?.financeMark !== true) {
    return {
      hasMissingSnapshots: false,
      taxRateSnapshotMissing: false,
      paymentDetails: [],
      issues: [],
    };
  }

  const taxRateSnapshotMissing = isMissing(order?.taxRateSnapshot);
  const issues: ProfitFeeSnapshotIssue[] = taxRateSnapshotMissing
    ? [{ code: 'TAX_RATE_SNAPSHOT_MISSING' }]
    : [];
  const paymentDetails = readPaymentDetails(order)
    .map((detail) => {
      const missingFields: Array<
        'serviceFeeRateSnapshot' | 'serviceFeeBaseAmountSnapshotCents'
      > = [];
      const paymentDetailId = optionalString(detail?.id);
      if (isMissing(detail?.serviceFeeRateSnapshot)) {
        missingFields.push('serviceFeeRateSnapshot');
        issues.push({
          code: 'PAYMENT_FEE_RATE_SNAPSHOT_MISSING',
          paymentDetailId,
        });
      }
      if (isMissing(detail?.serviceFeeBaseAmountSnapshotCents)) {
        missingFields.push('serviceFeeBaseAmountSnapshotCents');
        issues.push({
          code: 'PAYMENT_FEE_BASE_SNAPSHOT_MISSING',
          paymentDetailId,
        });
      }
      return {
        paymentDetailId,
        missingFields,
      };
    })
    .filter((detail) => detail.missingFields.length > 0);

  return {
    hasMissingSnapshots:
      taxRateSnapshotMissing || paymentDetails.length > 0,
    taxRateSnapshotMissing,
    paymentDetails,
    issues,
  };
}

export const detectMissingProfitFeeSnapshots =
  findMissingProfitFeeSnapshots;

/**
 * Calculates one order's tax, each payment-detail fee, and the presentation
 * breakdown grouped by payment method. Rounding happens before grouping.
 */
export function calculateOrderProfitFees(
  order: any,
): OrderProfitFeeCalculation {
  const financeMarked = order?.financeMark === true;
  const missingSnapshots = findMissingProfitFeeSnapshots(order);
  const effectiveAmountCents = calculateEffectiveOrderAmountCents(order);
  const calculationIssues = inspectOrderPaymentServiceFeeInputs(order);
  const normalizedTaxRate = normalizeDecimalRate(order?.taxRateSnapshot);
  const calculatedTaxCents = calculateOrderTaxCents({
    financeMark: financeMarked,
    effectiveAmountCents,
    taxRateSnapshot: financeMarked ? PROFIT_TAX_RATE : null,
  });
  const sameDayRefunds = aggregateSameDayRefundsByPaymentDetail(
    order?.orderDate,
    readAfterSalesOrders(order),
  );
  const paymentDetails = readPaymentDetails(order).map(
    (detail): PaymentDetailServiceFeeResult => {
      const paymentDetailId = optionalString(detail?.id);
      const effectiveRate =
        normalizeDecimalRate(detail?.serviceFeeRateSnapshot) ??
        normalizeDecimalRate(detail?.paymentMethod?.serviceFeeRate);
      const effectiveBaseAmountCents =
        detail?.serviceFeeBaseAmountSnapshotCents ?? detail?.amountCents;
      const baseMissing = isMissing(effectiveBaseAmountCents);
      const baseCents = baseMissing
        ? null
        : toSafeCentsNumber(
            nonNegativeCents(
              effectiveBaseAmountCents,
            ),
          );
      const refundCents = paymentDetailId
        ? sameDayRefunds[paymentDetailId] || 0
        : 0;
      const chargeableBaseCents =
        baseCents === null
          ? null
          : toSafeCentsNumber(
              maxBigInt(
                0n,
                BigInt(baseCents) - BigInt(refundCents),
              ),
            );
      return {
        paymentDetailId,
        paymentMethodId: optionalString(detail?.paymentMethodId),
        paymentMethodName:
          optionalString(detail?.paymentMethodNameSnapshot) ||
          optionalString(detail?.paymentMethod?.name) ||
          '',
        // Keep the existing DTO field and expose the rate actually used. For
        // unmarked orders this can be the current payment-method rate.
        serviceFeeRateSnapshot: effectiveRate,
        serviceFeeBaseAmountSnapshotCents: baseCents,
        sameDayRefundAmountCents: refundCents,
        serviceFeeChargeableBaseAmountCents: chargeableBaseCents,
        serviceFeeCents:
          calculatePaymentDetailServiceFeeCents({
            serviceFeeRateSnapshot: effectiveRate,
            serviceFeeBaseAmountSnapshotCents:
              effectiveBaseAmountCents,
            sameDayRefundAmountCents: refundCents,
          }),
      };
    },
  );
  const paymentMethods = buildPaymentMethodBreakdown(paymentDetails);
  const calculatedPaymentServiceFeeCents = sumNullableCents(
    paymentDetails.map((detail) => detail.serviceFeeCents),
  );
  const taxIssues: ProfitCalculationIssue[] = [];
  const paymentIssues = calculationIssues;
  const taxCents = calculatedTaxCents ?? 0;
  const paymentServiceFeeCents =
    paymentIssues.length === 0
      ? calculatedPaymentServiceFeeCents
      : null;
  const totalTaxAndServiceFeeCents =
    taxCents === null || paymentServiceFeeCents === null
      ? null
      : toSafeCentsNumber(BigInt(taxCents) + BigInt(paymentServiceFeeCents));

  return {
    financeMarked,
    effectiveAmountCents,
    taxRateSnapshot: normalizedTaxRate,
    taxCents,
    paymentServiceFeeCents,
    totalTaxAndServiceFeeCents,
    paymentDetails,
    paymentMethods,
    missingSnapshots,
    issues: calculationIssues,
    components: {
      tax: {
        status: taxIssues.length === 0 ? 'calculated' : 'blocked',
        amountCents: taxCents,
        issues: taxIssues,
      },
      paymentServiceFee: {
        status: paymentIssues.length === 0 ? 'calculated' : 'blocked',
        amountCents: paymentServiceFeeCents,
        issues: paymentIssues,
      },
    },
  };
}

export const calculateOrderTaxAndServiceFees =
  calculateOrderProfitFees;

function inspectOrderPaymentServiceFeeInputs(
  order: any,
): ProfitCalculationIssue[] {
  const issues: ProfitCalculationIssue[] = [];
  const paymentDetails = readPaymentDetails(order);
  if (paymentDetails.length === 0) {
    issues.push(
      calculationIssue(
        'PAYMENT_DETAILS_MISSING',
        '订单缺少付款明细，付款手续费无法计算。',
        '请补齐付款明细或配置付款方式手续费率。',
      ),
    );
    return issues;
  }
  const paymentTotalCents = paymentDetails.reduce(
    (sum, detail) => sum + Number(detail?.amountCents || 0),
    0,
  );
  if (
    !Number.isSafeInteger(paymentTotalCents) ||
    paymentTotalCents !== nonNegativeNumber(order?.totalAmountCents)
  ) {
    issues.push(
      calculationIssue(
        'PAYMENT_TOTAL_MISMATCH',
        '收款明细合计与订单总额不一致，付款手续费无法可靠计算。',
        '请补齐付款明细并核对每条付款金额。',
      ),
    );
  }
  for (const detail of paymentDetails) {
    const paymentDetailId = optionalString(detail?.id);
    if (!optionalString(detail?.paymentMethodId)) {
      issues.push({
        ...calculationIssue(
          'PAYMENT_METHOD_MISSING',
          '收款明细缺少付款方式，付款手续费无法计算。',
          '请补齐付款明细或配置付款方式手续费率。',
        ),
        paymentDetailId,
      });
    }
    if (
      isMissing(detail?.serviceFeeRateSnapshot) &&
      isMissing(detail?.paymentMethod?.serviceFeeRate)
    ) {
      issues.push({
        ...calculationIssue(
          'PAYMENT_METHOD_SERVICE_FEE_RATE_REQUIRED',
          '付款明细的手续费率快照和付款方式当前手续费率均缺失。',
          '请补齐付款明细或配置付款方式手续费率。',
        ),
        paymentDetailId,
      });
    }
    if (
      isMissing(detail?.serviceFeeBaseAmountSnapshotCents) &&
      isMissing(detail?.amountCents)
    ) {
      issues.push({
        ...calculationIssue(
          'PAYMENT_FEE_BASE_AMOUNT_MISSING',
          '付款明细金额缺失，付款手续费计费基数无法确定。',
          '请补齐付款明细或配置付款方式手续费率。',
        ),
        paymentDetailId,
      });
    }
  }
  return issues;
}

function calculationIssue(
  code: string,
  message: string,
  actionHint: string,
): ProfitCalculationIssue {
  return { code, message, actionHint };
}

function buildPaymentMethodBreakdown(
  details: PaymentDetailServiceFeeResult[],
): PaymentMethodServiceFeeBreakdown[] {
  const groups = new Map<
    string,
    PaymentMethodServiceFeeBreakdown & {
      baseMissing: boolean;
      chargeableBaseMissing: boolean;
      feeMissing: boolean;
    }
  >();
  for (const detail of details) {
    const key = JSON.stringify([
      detail.paymentMethodId,
      detail.paymentMethodName,
      detail.serviceFeeRateSnapshot,
    ]);
    const group = groups.get(key) || {
      paymentMethodId: detail.paymentMethodId,
      paymentMethodName: detail.paymentMethodName,
      serviceFeeRateSnapshot: detail.serviceFeeRateSnapshot,
      paymentDetailIds: [],
      serviceFeeBaseAmountSnapshotCents: 0,
      sameDayRefundAmountCents: 0,
      serviceFeeChargeableBaseAmountCents: 0,
      serviceFeeCents: 0,
      baseMissing: false,
      chargeableBaseMissing: false,
      feeMissing: false,
    };
    if (detail.paymentDetailId) {
      group.paymentDetailIds.push(detail.paymentDetailId);
    }
    group.sameDayRefundAmountCents = addSafeCents(
      group.sameDayRefundAmountCents,
      detail.sameDayRefundAmountCents,
    );
    if (detail.serviceFeeBaseAmountSnapshotCents === null) {
      group.baseMissing = true;
    } else {
      group.serviceFeeBaseAmountSnapshotCents = addSafeCents(
        group.serviceFeeBaseAmountSnapshotCents || 0,
        detail.serviceFeeBaseAmountSnapshotCents,
      );
    }
    if (detail.serviceFeeChargeableBaseAmountCents === null) {
      group.chargeableBaseMissing = true;
    } else {
      group.serviceFeeChargeableBaseAmountCents = addSafeCents(
        group.serviceFeeChargeableBaseAmountCents || 0,
        detail.serviceFeeChargeableBaseAmountCents,
      );
    }
    if (detail.serviceFeeCents === null) {
      group.feeMissing = true;
    } else {
      group.serviceFeeCents = addSafeCents(
        group.serviceFeeCents || 0,
        detail.serviceFeeCents,
      );
    }
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    paymentMethodId: group.paymentMethodId,
    paymentMethodName: group.paymentMethodName,
    serviceFeeRateSnapshot: group.serviceFeeRateSnapshot,
    paymentDetailIds: group.paymentDetailIds,
    serviceFeeBaseAmountSnapshotCents: group.baseMissing
      ? null
      : group.serviceFeeBaseAmountSnapshotCents,
    sameDayRefundAmountCents: group.sameDayRefundAmountCents,
    serviceFeeChargeableBaseAmountCents: group.chargeableBaseMissing
      ? null
      : group.serviceFeeChargeableBaseAmountCents,
    serviceFeeCents: group.feeMissing ? null : group.serviceFeeCents,
  }));
}

function calculateCentsAtRate(
  amountCents: bigint,
  rate: DecimalRateInput,
): number | null {
  const parsed = parseDecimalRate(rate);
  if (!parsed) {
    return null;
  }
  return toSafeCentsNumber(
    roundHalfUpDivision(
      amountCents * parsed.numerator,
      parsed.denominator,
    ),
  );
}

function parseDecimalRate(rate: DecimalRateInput) {
  const normalized = normalizeDecimalRate(rate);
  if (normalized === null) {
    return null;
  }
  const match = /^(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) {
    throw new TypeError('rate must be a non-negative decimal proportion.');
  }
  const fraction = match[2] || '';
  return {
    numerator: BigInt(`${match[1]}${fraction}`),
    denominator: 10n ** BigInt(fraction.length),
  };
}

function normalizeDecimalRate(rate: DecimalRateInput): string | null {
  if (isMissing(rate)) {
    return null;
  }
  const text = String(rate).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) {
    throw new TypeError('rate must be a non-negative decimal proportion.');
  }
  return text;
}

function toShanghaiDateKey(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
  }
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const parts = SHANGHAI_DATE_FORMATTER.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function nonNegativeCents(value: unknown): bigint {
  const cents = integerCents(value ?? 0);
  return maxBigInt(0n, cents);
}

function nonNegativeNumber(value: unknown): number {
  return toSafeCentsNumber(nonNegativeCents(value));
}

function integerCents(value: unknown): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError('cents must be a safe integer.');
    }
    return BigInt(value);
  }
  const text = String(value).trim();
  if (!/^-?\d+$/.test(text)) {
    throw new TypeError('cents must be an integer.');
  }
  return BigInt(text);
}

function toSafeCentsNumber(value: bigint): number {
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue)) {
    throw new RangeError('calculated cents exceed the safe integer range.');
  }
  return numberValue;
}

function addSafeCents(left: number, right: number): number {
  return toSafeCentsNumber(BigInt(left) + BigInt(right));
}

function sumNullableCents(values: Array<number | null>): number | null {
  if (values.some((value) => value === null)) {
    return null;
  }
  return toSafeCentsNumber(
    values.reduce(
      (total, value) => total + BigInt(value as number),
      0n,
    ),
  );
}

function maxBigInt(left: bigint, right: bigint) {
  return left > right ? left : right;
}

function readPaymentDetails(order: any): any[] {
  return Array.isArray(order?.paymentDetails) ? order.paymentDetails : [];
}

function readAfterSalesOrders(order: any): any[] {
  return Array.isArray(order?.afterSalesOrders)
    ? order.afterSalesOrders
    : [];
}

function normalizeEnum(value: unknown) {
  return String(value || '').trim().toUpperCase();
}

function optionalString(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function isMissing(value: unknown) {
  return value === null || value === undefined || value === '';
}
