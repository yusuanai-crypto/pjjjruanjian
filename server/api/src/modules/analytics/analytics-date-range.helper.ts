import { createHttpError } from '../../common/errors';

export const ANALYTICS_TIMEZONE = 'Asia/Shanghai';

export const ANALYTICS_DATE_RANGE_PRESETS = [
  'today',
  'yesterday',
  'last_10_days',
  'this_month',
  'last_month',
  'this_year',
  'custom',
] as const;

export type AnalyticsDateRangePreset =
  (typeof ANALYTICS_DATE_RANGE_PRESETS)[number];

export interface NormalizeAnalyticsDateRangeInput {
  preset?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
}

export interface NormalizeAnalyticsDateRangeOptions {
  now?: Date;
}

export interface NormalizedAnalyticsDateRange {
  preset: AnalyticsDateRangePreset;
  dateFrom: string;
  dateTo: string;
  timezone: typeof ANALYTICS_TIMEZONE;
}

type DateParts = {
  year: number;
  month: number;
  day: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function normalizeAnalyticsDateRange(
  input: NormalizeAnalyticsDateRangeInput = {},
  options: NormalizeAnalyticsDateRangeOptions = {},
): NormalizedAnalyticsDateRange {
  const presetFromInput = normalizePreset(input?.preset);
  const hasDateFrom = hasInputValue(input?.dateFrom);
  const hasDateTo = hasInputValue(input?.dateTo);
  const customFrom = hasDateFrom
    ? parseDateOnly(input.dateFrom, 'dateFrom')
    : null;
  const customTo = hasDateTo ? parseDateOnly(input.dateTo, 'dateTo') : null;
  const preset =
    presetFromInput || (hasDateFrom || hasDateTo ? 'custom' : 'this_month');
  const today = getShanghaiDateParts(normalizeNow(options.now));

  let dateFrom: DateParts;
  let dateTo: DateParts;

  switch (preset) {
    case 'today':
      dateFrom = today;
      dateTo = today;
      break;
    case 'yesterday':
      dateFrom = addDays(today, -1);
      dateTo = dateFrom;
      break;
    case 'last_10_days':
      dateFrom = addDays(today, -9);
      dateTo = today;
      break;
    case 'this_month':
      dateFrom = { year: today.year, month: today.month, day: 1 };
      dateTo = today;
      break;
    case 'last_month': {
      const month =
        today.month === 1
          ? { year: today.year - 1, month: 12 }
          : { year: today.year, month: today.month - 1 };
      dateFrom = { ...month, day: 1 };
      dateTo = { ...month, day: daysInMonth(month.year, month.month) };
      break;
    }
    case 'this_year':
      dateFrom = { year: today.year, month: 1, day: 1 };
      dateTo = today;
      break;
    case 'custom':
      if (!customFrom) {
        throw createHttpError(
          400,
          'VALIDATION_FAILED',
          'dateFrom is required for custom preset.',
        );
      }
      if (!customTo) {
        throw createHttpError(
          400,
          'VALIDATION_FAILED',
          'dateTo is required for custom preset.',
        );
      }
      dateFrom = customFrom;
      dateTo = customTo;
      break;
    default:
      assertNever(preset);
  }

  assertDateOrder(dateFrom, dateTo);

  return {
    preset,
    dateFrom: formatDateParts(dateFrom),
    dateTo: formatDateParts(dateTo),
    timezone: ANALYTICS_TIMEZONE,
  };
}

function normalizePreset(value: unknown): AnalyticsDateRangePreset | null {
  if (!hasInputValue(value)) {
    return null;
  }
  const preset = String(value).trim().toLowerCase();
  if (
    ANALYTICS_DATE_RANGE_PRESETS.includes(
      preset as AnalyticsDateRangePreset,
    )
  ) {
    return preset as AnalyticsDateRangePreset;
  }
  throw createHttpError(
    400,
    'VALIDATION_FAILED',
    `preset must be one of: ${ANALYTICS_DATE_RANGE_PRESETS.join(', ')}.`,
  );
}

function normalizeNow(value: unknown) {
  const now = value === undefined ? new Date() : value;
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw createHttpError(400, 'VALIDATION_FAILED', 'now must be a valid date.');
  }
  return now;
}

function hasInputValue(value: unknown) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function parseDateOnly(value: unknown, fieldName: string): DateParts {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throwInvalidDate(fieldName);
    }
    return getShanghaiDateParts(value);
  }

  const text = String(value).trim();
  const match = text.match(DATE_ONLY_PATTERN);
  if (!match) {
    throwInvalidDate(fieldName);
  }

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  if (!isValidDateParts(parts)) {
    throwInvalidDate(fieldName);
  }
  return parts;
}

function throwInvalidDate(fieldName: string): never {
  throw createHttpError(
    400,
    'VALIDATION_FAILED',
    `${fieldName} must be a valid YYYY-MM-DD date.`,
  );
}

function assertDateOrder(dateFrom: DateParts, dateTo: DateParts) {
  if (toEpochDay(dateFrom) > toEpochDay(dateTo)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'dateFrom cannot be later than dateTo.',
    );
  }
}

function getShanghaiDateParts(date: Date): DateParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ANALYTICS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function addDays(parts: DateParts, days: number): DateParts {
  return fromEpochDay(toEpochDay(parts) + days);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isValidDateParts(parts: DateParts) {
  if (
    !Number.isInteger(parts.year) ||
    !Number.isInteger(parts.month) ||
    !Number.isInteger(parts.day) ||
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > 31
  ) {
    return false;
  }
  const normalized = fromEpochDay(toEpochDay(parts));
  return (
    normalized.year === parts.year &&
    normalized.month === parts.month &&
    normalized.day === parts.day
  );
}

function toEpochDay(parts: DateParts) {
  return Math.floor(
    Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS,
  );
}

function fromEpochDay(epochDay: number): DateParts {
  const date = new Date(epochDay * DAY_MS);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function formatDateParts(parts: DateParts) {
  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
  ].join('-');
}

function assertNever(value: never): never {
  throw new Error(`Unhandled analytics date range preset: ${value}`);
}
