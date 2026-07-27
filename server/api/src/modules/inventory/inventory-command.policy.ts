import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';

export const INVENTORY_COMMAND_TYPES = [
  'INBOUND',
  'RESERVE',
  'RELEASE',
  'OUTBOUND',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'TRANSFER_CREATE',
  'TRANSFER_CONFIRM_OUTBOUND',
  'TRANSFER_RECEIVE',
  'TRANSFER_RECEIPT_REVERSE',
  'TRANSFER_OUTBOUND_REVERSE',
  'MARK_UNAVAILABLE',
  'RESTORE_AVAILABLE',
  'UPDATE_BATCH_COST',
  'REVERSE',
] as const;

export type InventoryCommandType =
  (typeof INVENTORY_COMMAND_TYPES)[number];

export interface NormalizedInventoryCommandEnvelope {
  sourceKey: string;
  idempotencyKey: string;
  requestHash: string;
  requestPayload: Record<string, unknown>;
}

export function normalizeInventoryCommandEnvelope(
  commandType: InventoryCommandType,
  input: any,
): NormalizedInventoryCommandEnvelope {
  assertPlainObject(input);
  const sourceKey = normalizedBusinessKey(input.sourceKey, 'sourceKey');
  const idempotencyKey = normalizedBusinessKey(
    input.idempotencyKey,
    'idempotencyKey',
  );
  const requestHash = requiredRequestHash(input.requestHash);
  const requestPayload = normalizedHashPayload(commandType, {
    ...input,
    sourceKey,
    idempotencyKey,
  });
  const calculatedHash = hashCanonicalValue(requestPayload);
  if (calculatedHash !== requestHash) {
    throw createHttpError(
      400,
      'INVENTORY_REQUEST_HASH_MISMATCH',
      'requestHash does not match the normalized inventory command.',
    );
  }
  return {
    sourceKey,
    idempotencyKey,
    requestHash,
    requestPayload,
  };
}

export function calculateInventoryRequestHash(
  commandType: InventoryCommandType,
  input: any,
) {
  assertPlainObject(input);
  return hashCanonicalValue(
    normalizedHashPayload(commandType, {
      ...input,
      sourceKey: normalizedBusinessKey(input.sourceKey, 'sourceKey'),
      idempotencyKey: normalizedBusinessKey(
        input.idempotencyKey,
        'idempotencyKey',
      ),
    }),
  );
}

export function normalizedBusinessKey(value: unknown, field: string) {
  const normalized = normalizedString(value)?.toLocaleLowerCase('en-US');
  if (!normalized) {
    throw validationError(`${field} must be a non-empty business key.`);
  }
  if (normalized.length > 150) {
    throw validationError(`${field} must not exceed 150 characters.`);
  }
  return normalized;
}

export function requiredId(value: unknown, field: string) {
  const normalized = normalizedString(value);
  if (!normalized) {
    throw validationError(`${field} is required.`);
  }
  if (normalized.length > 191) {
    throw validationError(`${field} is too long.`);
  }
  return normalized;
}

export function optionalId(value: unknown, field: string) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return requiredId(value, field);
}

export function positiveQuantity(value: unknown, field = 'quantity') {
  const quantity =
    typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw validationError(`${field} must be a positive integer bottle count.`);
  }
  return quantity;
}

export function optionalNonNegativeInteger(
  value: unknown,
  field: string,
) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed =
    typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw validationError(`${field} must be a non-negative integer.`);
  }
  return parsed;
}

export function optionalBoundedString(
  value: unknown,
  field: string,
  maxLength: number,
) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const normalized = normalizedString(value);
  if (!normalized || normalized.length > maxLength) {
    throw validationError(
      `${field} must be a non-empty string no longer than ${maxLength} characters.`,
    );
  }
  return normalized;
}

export function optionalBusinessDate(value: unknown, field: string) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw validationError(`${field} must be a valid date.`);
  }
  return date;
}

export function calculateStockMetrics(stock: {
  onHandQty: number;
  reservedQty: number;
  unavailableQty: number;
  inTransitQty: number;
}) {
  const availableQty =
    stock.onHandQty - stock.reservedQty - stock.unavailableQty;
  return {
    ...stock,
    availableQty,
    shortageQty: Math.max(0, -availableQty),
  };
}

export function assertRestrictedBalancesNonNegative(stock: {
  reservedQty: number;
  unavailableQty: number;
  inTransitQty: number;
}) {
  if (stock.reservedQty < 0) {
    throw createHttpError(
      409,
      'INVENTORY_RESERVED_QTY_NEGATIVE',
      'The command would make reserved inventory negative.',
    );
  }
  if (stock.unavailableQty < 0) {
    throw createHttpError(
      409,
      'INVENTORY_UNAVAILABLE_QTY_NEGATIVE',
      'The command would make unavailable inventory negative.',
    );
  }
  if (stock.inTransitQty < 0) {
    throw createHttpError(
      409,
      'INVENTORY_IN_TRANSIT_QTY_NEGATIVE',
      'The command would make in-transit inventory negative.',
    );
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function normalizedHashPayload(
  commandType: InventoryCommandType,
  input: Record<string, unknown>,
) {
  const normalized = normalizeHashValue(input) as Record<string, unknown>;
  delete normalized.requestHash;
  delete normalized.requestId;
  delete normalized.documentScope;
  return {
    commandType,
    payload: normalized,
  };
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
    for (const [key, nested] of Object.entries(value)) {
      if (nested !== undefined) {
        result[key] = normalizeHashValue(nested);
      }
    }
    return result;
  }
  return value;
}

function hashCanonicalValue(value: unknown) {
  return crypto
    .createHash('sha256')
    .update(canonicalJson(value))
    .digest('hex');
}

function requiredRequestHash(value: unknown) {
  const normalized = normalizedString(value)?.toLocaleLowerCase('en-US');
  if (!normalized || !/^[0-9a-f]{64}$/.test(normalized)) {
    throw validationError(
      'requestHash must be a lowercase SHA-256 hexadecimal string.',
    );
  }
  return normalized;
}

function normalizedString(value: unknown) {
  return typeof value === 'string' ? value.normalize('NFKC').trim() : '';
}

function assertPlainObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError('The inventory command body must be an object.');
  }
}

function validationError(message: string) {
  return createHttpError(400, 'INVENTORY_VALIDATION_FAILED', message);
}
