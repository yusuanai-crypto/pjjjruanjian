import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';

const DEFAULT_TOKEN_BYTE_LENGTH = 24;
const MIN_EXPIRES_IN_DAYS = 1;
const MAX_EXPIRES_IN_DAYS = 3650;
const DAY_MS = 24 * 60 * 60 * 1000;

export function generateQrCodeToken(byteLength = DEFAULT_TOKEN_BYTE_LENGTH) {
  return crypto.randomBytes(byteLength).toString('base64url');
}

export function buildQrCodeTokenRecord(
  expiresInDays: unknown,
  now: Date = new Date(),
) {
  const generatedAt = new Date(now.getTime());
  return {
    token: generateQrCodeToken(),
    generatedAt,
    expiresAt: calculateQrCodeExpiresAt(expiresInDays, generatedAt),
  };
}

export function calculateQrCodeExpiresAt(
  expiresInDays: unknown,
  now: Date = new Date(),
) {
  if (
    expiresInDays === undefined ||
    expiresInDays === null ||
    expiresInDays === ''
  ) {
    return null;
  }

  const days = normalizeExpiresInDays(expiresInDays);
  return new Date(now.getTime() + days * DAY_MS);
}

export function hasReusableQrCodeToken(
  token: unknown,
  expiresAt: unknown,
  now: Date = new Date(),
) {
  return hasText(token) && isQrCodeTokenUnexpired(expiresAt, now);
}

export function isQrCodeTokenUnexpired(
  expiresAt: unknown,
  now: Date = new Date(),
) {
  if (expiresAt === undefined || expiresAt === null || expiresAt === '') {
    return true;
  }
  const expiresAtDate =
    expiresAt instanceof Date ? expiresAt : new Date(String(expiresAt));
  if (Number.isNaN(expiresAtDate.getTime())) {
    return false;
  }
  return expiresAtDate.getTime() > now.getTime();
}

function normalizeExpiresInDays(value: unknown) {
  const numberValue =
    typeof value === 'number' ? value : Number(String(value).trim());
  if (
    !Number.isInteger(numberValue) ||
    numberValue < MIN_EXPIRES_IN_DAYS ||
    numberValue > MAX_EXPIRES_IN_DAYS
  ) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `expiresInDays must be an integer between ${MIN_EXPIRES_IN_DAYS} and ${MAX_EXPIRES_IN_DAYS}.`,
    );
  }
  return numberValue;
}

function hasText(value: unknown) {
  return typeof value === 'string'
    ? value.trim().length > 0
    : value !== undefined && value !== null && value !== '';
}
