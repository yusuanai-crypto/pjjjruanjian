import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';

const DEFAULT_TOKEN_BYTE_LENGTH = 24;
const MIN_EXPIRES_IN_DAYS = 1;
export const PUBLIC_SALES_SHEET_DEFAULT_TTL_DAYS = 30;
export const PUBLIC_SALES_SHEET_MAX_TTL_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

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
    expiresInDays = readConfiguredDefaultTtlDays();
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
    return false;
  }
  const expiresAtDate =
    expiresAt instanceof Date ? expiresAt : new Date(String(expiresAt));
  if (Number.isNaN(expiresAtDate.getTime())) {
    return false;
  }
  return expiresAtDate.getTime() > now.getTime();
}

export function hashQrCodeToken(token: unknown) {
  const tokenText = normalizePublicQrCodeToken(token);
  if (!tokenText) {
    return null;
  }
  return crypto.createHash('sha256').update(tokenText).digest('hex');
}

export function buildQrCodeTokenFingerprint(tokenHash: unknown) {
  const hashText =
    typeof tokenHash === 'string' ? tokenHash.trim().toLowerCase() : '';
  return /^[a-f0-9]{64}$/.test(hashText) ? hashText.slice(0, 16) : null;
}

export function normalizePublicQrCodeToken(token: unknown) {
  if (typeof token !== 'string') {
    return null;
  }
  const tokenText = token.trim();
  return PUBLIC_TOKEN_PATTERN.test(tokenText) ? tokenText : null;
}

export function getConfiguredPublicSalesSheetBaseUrl(
  options: { required?: boolean } = {},
) {
  const configured = normalizeText(process.env.PUBLIC_SALES_SHEET_BASE_URL);
  if (!configured) {
    if (options.required) {
      throw unsafePublicBaseUrlError();
    }
    return null;
  }

  const parsed = safeUrl(configured);
  if (
    !parsed ||
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname ||
    !parsed.hostname.includes('.') ||
    isIpLiteral(parsed.hostname) ||
    isLocalOrPrivateHost(parsed.hostname)
  ) {
    throw unsafePublicBaseUrlError();
  }
  return parsed.toString().replace(/\/+$/, '');
}

function normalizeExpiresInDays(value: unknown) {
  const numberValue =
    typeof value === 'number' ? value : Number(String(value).trim());
  if (
    !Number.isInteger(numberValue) ||
    numberValue < MIN_EXPIRES_IN_DAYS ||
    numberValue > PUBLIC_SALES_SHEET_MAX_TTL_DAYS
  ) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `expiresInDays must be an integer between ${MIN_EXPIRES_IN_DAYS} and ${PUBLIC_SALES_SHEET_MAX_TTL_DAYS}.`,
    );
  }
  return numberValue;
}

function readConfiguredDefaultTtlDays() {
  const configured = normalizeText(
    process.env.PUBLIC_SALES_SHEET_DEFAULT_TTL_DAYS,
  );
  if (!configured) {
    return PUBLIC_SALES_SHEET_DEFAULT_TTL_DAYS;
  }
  try {
    return normalizeExpiresInDays(configured);
  } catch {
    throw createHttpError(
      500,
      'PUBLIC_SALES_SHEET_TTL_CONFIG_INVALID',
      `PUBLIC_SALES_SHEET_DEFAULT_TTL_DAYS must be an integer between ${MIN_EXPIRES_IN_DAYS} and ${PUBLIC_SALES_SHEET_MAX_TTL_DAYS}.`,
    );
  }
}

function unsafePublicBaseUrlError() {
  return createHttpError(
    400,
    'PUBLIC_SALES_SHEET_BASE_URL_UNSAFE',
    'PUBLIC_SALES_SHEET_BASE_URL must be explicitly configured as a public HTTPS URL.',
  );
}

function safeUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLocalOrPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  ) {
    return true;
  }
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
    return true;
  }
  const octets = host.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isIpLiteral(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host.includes(':')) {
    return true;
  }
  const octets = host.split('.');
  return (
    octets.length === 4 &&
    octets.every((part) => /^\d{1,3}$/.test(part))
  );
}

function normalizeText(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function hasText(value: unknown) {
  return typeof value === 'string'
    ? value.trim().length > 0
    : value !== undefined && value !== null && value !== '';
}
