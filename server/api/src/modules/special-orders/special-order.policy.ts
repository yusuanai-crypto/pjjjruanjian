import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';

export const SPECIAL_ORDER_TYPES = new Set([
  'INTERNAL',
  'EXTERNAL',
  'BUYBACK',
]);
export const SPECIAL_ORDER_READ_ROLES = new Set([
  'sales',
  'after_sales',
  'boss',
  'admin',
  'super_admin',
]);
export const SPECIAL_ORDER_CREATOR_ROLES = new Set([
  'sales',
  'after_sales',
  'boss',
  'admin',
  'super_admin',
]);
export const SPECIAL_ORDER_REVIEW_ROLES = new Set([
  'boss',
  'admin',
  'super_admin',
]);
export const SPECIAL_ORDER_SELF_SCOPED_ROLES = new Set([
  'sales',
  'after_sales',
]);
export const SPECIAL_ORDER_EFFECTIVE_STATUSES = new Set([
  'APPROVED',
  'COMPLETED',
]);
export const SPECIAL_ORDER_TRANSITIONS: Record<string, Set<string>> = {
  DRAFT: new Set(['PENDING', 'CANCELLED']),
  PENDING: new Set(['DRAFT', 'APPROVED', 'REJECTED']),
  REJECTED: new Set(['PENDING', 'CANCELLED']),
  APPROVED: new Set(['COMPLETED', 'PENDING']),
  COMPLETED: new Set(['PENDING']),
  CANCELLED: new Set(),
};

export function canSpecialOrderTransition(from: unknown, to: unknown) {
  return Boolean(
    SPECIAL_ORDER_TRANSITIONS[normalizeEnum(from)]?.has(
      normalizeEnum(to),
    ),
  );
}

export async function claimSpecialOrderTransition(
  salesOrderDelegate: any,
  input: {
    id: string;
    fromStatus: string;
    toStatus: string;
    expectedVersion: number;
    data?: Record<string, any>;
  },
) {
  if (!canSpecialOrderTransition(input.fromStatus, input.toStatus)) {
    invalidTransition(input.fromStatus, `transition to ${input.toStatus}`);
  }
  const nextVersion = input.expectedVersion + 1;
  const result = await salesOrderDelegate.updateMany({
    where: {
      id: input.id,
      workflowStatus: normalizeEnum(input.fromStatus),
      workflowVersion: input.expectedVersion,
    },
    data: {
      ...input.data,
      workflowStatus: normalizeEnum(input.toStatus),
      workflowVersion: nextVersion,
    },
  });
  if (Number(result?.count || 0) !== 1) {
    versionConflict();
  }
  return nextVersion;
}

export function requireSpecialOrderRead(actor: any) {
  if (!SPECIAL_ORDER_READ_ROLES.has(normalizeRole(actor?.role))) {
    forbidden();
  }
}

export function requireSpecialOrderCreator(actor: any) {
  if (!SPECIAL_ORDER_CREATOR_ROLES.has(normalizeRole(actor?.role))) {
    forbidden();
  }
}

export function requireSpecialOrderReviewer(actor: any) {
  if (!SPECIAL_ORDER_REVIEW_ROLES.has(normalizeRole(actor?.role))) {
    forbidden();
  }
}

export function isSpecialOrderReviewer(actor: any) {
  return SPECIAL_ORDER_REVIEW_ROLES.has(normalizeRole(actor?.role));
}

export function isSelfScopedSpecialOrderActor(actor: any) {
  return SPECIAL_ORDER_SELF_SCOPED_ROLES.has(normalizeRole(actor?.role));
}

export function normalizeSpecialOrderType(value: unknown) {
  const type = normalizeEnum(value);
  if (!SPECIAL_ORDER_TYPES.has(type)) {
    validation('orderType must be internal, external, or buyback.');
  }
  return type;
}

export function normalizeWorkflowStatus(value: unknown) {
  const status = normalizeEnum(value);
  const allowed = new Set([
    'DRAFT',
    'PENDING',
    'APPROVED',
    'COMPLETED',
    'REJECTED',
    'CANCELLED',
  ]);
  if (!allowed.has(status)) {
    validation('workflowStatus is invalid.');
  }
  return status;
}

export function requiredIdempotencyKey(value: unknown) {
  const key = requiredText(value, 'idempotencyKey', 191).toLocaleLowerCase(
    'en-US',
  );
  if (!/^[a-z0-9][a-z0-9:._/-]*$/.test(key)) {
    validation(
      'idempotencyKey may contain lowercase letters, numbers, colon, dot, slash, underscore, and hyphen.',
    );
  }
  return key;
}

export function requiredWorkflowVersion(value: unknown) {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 0) {
    validation('workflowVersion must be a non-negative integer.');
  }
  return version;
}

export function requiredReason(value: unknown, field = 'reason') {
  return requiredText(value, field, 500);
}

export function optionalReason(value: unknown, field = 'reason') {
  return optionalText(value, field, 500);
}

export function requiredText(
  value: unknown,
  field: string,
  maxLength: number,
) {
  const text = normalizedText(value);
  if (!text) {
    validation(`${field} is required.`);
  }
  if (text.length > maxLength) {
    validation(`${field} must not exceed ${maxLength} characters.`);
  }
  return text;
}

export function optionalText(
  value: unknown,
  field: string,
  maxLength: number,
) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return requiredText(value, field, maxLength);
}

export function requiredId(value: unknown, field: string) {
  return requiredText(value, field, 36);
}

export function optionalId(value: unknown, field: string) {
  return optionalText(value, field, 36);
}

export function requiredInteger(
  value: unknown,
  field: string,
  options: {
    min?: number;
    max?: number;
    nonZero?: boolean;
  } = {},
) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    validation(`${field} must be an integer.`);
  }
  if (options.nonZero && parsed === 0) {
    validation(`${field} must not be zero.`);
  }
  if (options.min !== undefined && parsed < options.min) {
    validation(`${field} must be at least ${options.min}.`);
  }
  if (options.max !== undefined && parsed > options.max) {
    validation(`${field} must be no greater than ${options.max}.`);
  }
  return parsed;
}

export function optionalInteger(
  value: unknown,
  field: string,
  fallback: number | null = null,
) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return requiredInteger(value, field);
}

export function requiredBoolean(value: unknown, field: string) {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return true;
  }
  if (
    value === false ||
    value === 'false' ||
    value === 0 ||
    value === '0'
  ) {
    return false;
  }
  validation(`${field} must be a boolean.`);
}

export function optionalBoolean(
  value: unknown,
  field: string,
  fallback: boolean,
) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return requiredBoolean(value, field);
}

export function requiredDate(value: unknown, field: string) {
  const text = requiredText(value, field, 40);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T00:00:00.000Z`)
    : new Date(text);
  if (Number.isNaN(dateOnly.getTime())) {
    validation(`${field} must be a valid date.`);
  }
  return dateOnly;
}

export function optionalDate(value: unknown, field: string) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return requiredDate(value, field);
}

export function normalizeObject(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    validation(`${label} must be an object.`);
  }
  return value as Record<string, any>;
}

export function assertAllowedFields(
  body: Record<string, any>,
  allowed: string[],
  label: string,
) {
  const allowedSet = new Set(allowed);
  const denied = Object.keys(body).filter((field) => !allowedSet.has(field));
  if (denied.length > 0) {
    throw createHttpError(
      403,
      'FIELD_PERMISSION_DENIED',
      `Fields are not allowed for ${label}: ${denied.join(', ')}.`,
    );
  }
}

export function normalizeInventoryCondition(value: unknown) {
  const condition = normalizeEnum(value || 'SALEABLE');
  if (!['SALEABLE', 'UNAVAILABLE'].includes(condition)) {
    validation('inventoryCondition must be saleable or unavailable.');
  }
  return condition;
}

export function normalizeDeliveryType(value: unknown) {
  const type = normalizeEnum(value || 'SHIPPING');
  if (!['SHIPPING', 'SELF_PICKUP'].includes(type)) {
    validation('deliveryType must be shipping or self_pickup.');
  }
  return type;
}

export function normalizeExternalPartyType(value: unknown) {
  const type = normalizeEnum(value);
  if (!['GUIDE', 'TRAVEL_AGENCY', 'OTHER'].includes(type)) {
    validation(
      'externalPartyType must be guide, travel_agency, or other.',
    );
  }
  return type;
}

export function normalizeLogisticsCode(value: unknown, field: string) {
  const snapshot = requiredText(value, field, 160);
  const normalized = snapshot
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLocaleUpperCase('en-US');
  if (!normalized) {
    validation(`${field} is required.`);
  }
  return { snapshot, normalized };
}

export function requestHash(value: unknown) {
  return crypto
    .createHash('sha256')
    .update(canonicalJson(normalizeHashValue(value)))
    .digest('hex');
}

export function normalizeRole(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeEnum(value: unknown) {
  return String(value || '').trim().toUpperCase();
}

export function validation(message: string): never {
  throw createHttpError(400, 'SPECIAL_ORDER_VALIDATION_FAILED', message);
}

export function notFound(): never {
  throw createHttpError(
    404,
    'SPECIAL_ORDER_NOT_FOUND',
    'Special order does not exist.',
  );
}

export function versionConflict(): never {
  throw createHttpError(
    409,
    'SPECIAL_ORDER_VERSION_CONFLICT',
    'The special order changed concurrently. Refresh and retry.',
  );
}

export function invalidTransition(
  from: string,
  action: string,
): never {
  throw createHttpError(
    409,
    'SPECIAL_ORDER_INVALID_TRANSITION',
    `Cannot ${action} a special order in ${from.toLowerCase()} status.`,
  );
}

function forbidden(): never {
  throw createHttpError(
    403,
    'SPECIAL_ORDER_PERMISSION_DENIED',
    'You do not have permission to perform this special-order action.',
  );
}

function normalizedText(value: unknown) {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim()
    : '';
}

function normalizeHashValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value.normalize('NFKC').trim();
  }
  if (Array.isArray(value)) {
    return value.map(normalizeHashValue);
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as any).sort()) {
      const nested = (value as any)[key];
      if (nested !== undefined) {
        result[key] = normalizeHashValue(nested);
      }
    }
    return result;
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .map(
      ([key, nested]) =>
        `${JSON.stringify(key)}:${canonicalJson(nested)}`,
    )
    .join(',')}}`;
}
