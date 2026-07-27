import { createHttpError } from '../../common/errors';

export const SALES_ORDER_SHIPPING_TIMEZONE = 'Asia/Shanghai';
export const SAME_DAY_SHIPPING_WARNING =
  '该订单计划当天发货，请确认仓库可及时处理。';

export type SalesOrderShippingDateSource =
  | 'SYSTEM_DEFAULT'
  | 'USER_SPECIFIED'
  | 'MIGRATION';

export interface ResolvedSubmissionShippingDate {
  shippingDate: Date;
  source: SalesOrderShippingDateSource;
  manuallySpecified: boolean;
}

export function resolveSubmissionShippingDate(
  payload: any,
  submittedAt = new Date(),
): ResolvedSubmissionShippingDate {
  const hasShippingDate = hasOwn(payload, 'shippingDate');
  const manualFlag = hasOwn(payload, 'shippingDateManuallySpecified')
    ? normalizeManualFlag(payload.shippingDateManuallySpecified)
    : hasShippingDate;
  const submissionDate = formatShanghaiDate(submittedAt);

  if (!manualFlag) {
    return {
      shippingDate: parseDateOnly(addDateOnlyDays(submissionDate, 1)),
      source: 'SYSTEM_DEFAULT',
      manuallySpecified: false,
    };
  }

  const shippingDate = parseRequiredShippingDate(payload?.shippingDate);
  assertShippingDateNotBeforeSubmission(shippingDate, submittedAt);
  return {
    shippingDate,
    source: 'USER_SPECIFIED',
    manuallySpecified: true,
  };
}

export function parseRequiredShippingDate(value: unknown): Date {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!isValidDateOnly(text)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      '发货日期必须是有效的 YYYY-MM-DD 日期。',
    );
  }
  return parseDateOnly(text);
}

export function assertShippingDateNotBeforeSubmission(
  shippingDate: Date,
  submittedAt: Date,
) {
  const shippingDateText = formatDateOnly(shippingDate);
  const submissionDateText = formatShanghaiDate(submittedAt);
  if (shippingDateText < submissionDateText) {
    throw createHttpError(
      400,
      'SHIPPING_DATE_BEFORE_SUBMISSION',
      '发货日期不能早于订单提交日期。',
    );
  }
}

export function formatShanghaiDate(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError('value must be a valid Date.');
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SALES_ORDER_SHIPPING_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatDateOnly(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError('value must be a valid Date.');
  }
  return value.toISOString().slice(0, 10);
}

export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function addDateOnlyDays(value: string, days: number): string {
  if (!isValidDateOnly(value) || !Number.isInteger(days)) {
    throw new TypeError('A valid date-only value and integer day count are required.');
  }
  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateOnly(date);
}

export function defaultBackfillShippingDate(
  submittedAtOrCreatedAt: Date,
): Date {
  return parseDateOnly(
    addDateOnlyDays(formatShanghaiDate(submittedAtOrCreatedAt), 1),
  );
}

export function isSameShanghaiNaturalDay(
  shippingDate: Date | null | undefined,
  submittedAt: Date | null | undefined,
): boolean {
  return Boolean(
    shippingDate &&
      submittedAt &&
      formatDateOnly(shippingDate) === formatShanghaiDate(submittedAt),
  );
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = parseDateOnly(value);
  return !Number.isNaN(date.getTime()) && formatDateOnly(date) === value;
}

function normalizeManualFlag(value: unknown): boolean {
  if (value === true || value === false) {
    return value;
  }
  throw createHttpError(
    400,
    'VALIDATION_FAILED',
    'shippingDateManuallySpecified must be a boolean.',
  );
}

function hasOwn(value: unknown, key: string): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      Object.prototype.hasOwnProperty.call(value, key),
  );
}
