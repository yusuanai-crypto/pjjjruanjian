import { createHttpError } from '../../common/errors';

export const SALES_ORDER_SHIPPING_TIMEZONE = 'Asia/Shanghai';
export const SAME_DAY_SHIPPING_WARNING =
  '该订单计划当天发货，请确认仓库可及时处理。';

export type SalesOrderShippingDateSource =
  | 'SYSTEM_DEFAULT'
  | 'USER_SPECIFIED'
  | 'MIGRATION';

export type SalesOrderShippingDateMode =
  | 'SCHEDULED'
  | 'PENDING_CUSTOMER_NOTICE';

export type SalesOrderShippingDateModeApi =
  | 'scheduled'
  | 'pending_customer_notice';

export interface ResolvedSubmissionShippingDate {
  mode: SalesOrderShippingDateMode;
  shippingDate: Date | null;
  source: SalesOrderShippingDateSource | null;
  manuallySpecified: boolean;
}

export function resolveSubmissionShippingDate(
  payload: any,
  submittedAt = new Date(),
): ResolvedSubmissionShippingDate {
  const hasShippingDate = hasOwn(payload, 'shippingDate');
  if (hasOwn(payload, 'shippingDateMode')) {
    const mode = parseShippingDateMode(payload.shippingDateMode);
    if (mode === 'PENDING_CUSTOMER_NOTICE') {
      if (hasShippingDate && payload.shippingDate !== null) {
        throw shippingDateModeConflict();
      }
      return {
        mode,
        shippingDate: null,
        source: null,
        manuallySpecified: true,
      };
    }
    if (!hasShippingDate || payload.shippingDate === null) {
      throw shippingDateRequired();
    }
    const submittedDate = parseRequiredShippingDate(payload.shippingDate);
    const manuallySpecified = hasOwn(
      payload,
      'shippingDateManuallySpecified',
    )
      ? normalizeManualFlag(payload.shippingDateManuallySpecified)
      : true;
    if (!manuallySpecified) {
      return {
        mode,
        shippingDate: parseDateOnly(
          addDateOnlyDays(formatShanghaiDate(submittedAt), 1),
        ),
        source: 'SYSTEM_DEFAULT',
        manuallySpecified: false,
      };
    }
    return {
      mode,
      shippingDate: submittedDate,
      source: 'USER_SPECIFIED',
      manuallySpecified,
    };
  }
  const manualFlag = hasOwn(payload, 'shippingDateManuallySpecified')
    ? normalizeManualFlag(payload.shippingDateManuallySpecified)
    : hasShippingDate;
  const submissionDate = formatShanghaiDate(submittedAt);

  if (!manualFlag) {
    return {
      mode: 'SCHEDULED',
      shippingDate: parseDateOnly(addDateOnlyDays(submissionDate, 1)),
      source: 'SYSTEM_DEFAULT',
      manuallySpecified: false,
    };
  }

  const shippingDate = parseRequiredShippingDate(payload?.shippingDate);
  return {
    mode: 'SCHEDULED',
    shippingDate,
    source: 'USER_SPECIFIED',
    manuallySpecified: true,
  };
}

export function resolveShippingDateUpdate(
  payload: any,
): ResolvedSubmissionShippingDate {
  if (!hasOwn(payload, 'shippingDateMode') && !hasOwn(payload, 'shippingDate')) {
    throw shippingDateRequired();
  }
  if (!hasOwn(payload, 'shippingDateMode')) {
    return {
      mode: 'SCHEDULED',
      shippingDate: parseRequiredShippingDate(payload.shippingDate),
      source: 'USER_SPECIFIED',
      manuallySpecified: true,
    };
  }
  return resolveSubmissionShippingDate(payload);
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

export function parseShippingDateMode(
  value: unknown,
): SalesOrderShippingDateMode {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'scheduled') {
    return 'SCHEDULED';
  }
  if (normalized === 'pending_customer_notice') {
    return 'PENDING_CUSTOMER_NOTICE';
  }
  throw createHttpError(
    400,
    'SHIPPING_DATE_MODE_INVALID',
    '发货方式必须是 scheduled 或 pending_customer_notice。',
  );
}

export function toShippingDateModeApi(
  value: unknown,
): SalesOrderShippingDateModeApi {
  return String(value || '').trim().toUpperCase() ===
    'PENDING_CUSTOMER_NOTICE'
    ? 'pending_customer_notice'
    : 'scheduled';
}

export function shippingDateDisplayText(
  mode: unknown,
  shippingDate: Date | null | undefined,
) {
  return toShippingDateModeApi(mode) === 'pending_customer_notice'
    ? '待客人通知'
    : shippingDate
      ? formatDateOnly(shippingDate)
      : '';
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

function shippingDateRequired() {
  return createHttpError(
    400,
    'SHIPPING_DATE_REQUIRED',
    '选择发货日期时必须填写有效的发货日期。',
  );
}

function shippingDateModeConflict() {
  return createHttpError(
    400,
    'SHIPPING_DATE_MODE_CONFLICT',
    '待客人通知时发货日期必须为 null 或不传。',
  );
}

function hasOwn(value: unknown, key: string): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      Object.prototype.hasOwnProperty.call(value, key),
  );
}
