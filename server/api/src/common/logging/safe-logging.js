const crypto = require('node:crypto');

const REDACTED = '[REDACTED]';
const REDACTED_PHONE = '[REDACTED_PHONE]';
const MAX_DEPTH = 12;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_LENGTH = 12000;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

function redactSensitive(value) {
  const sensitiveValues = new Set();
  collectSensitiveValues(value, new WeakSet(), 0, '', sensitiveValues);
  return redactValue(value, new WeakSet(), 0, '', sensitiveValues);
}

function redactValue(value, seen, depth, key, sensitiveValues) {
  const keyKind = classifyKey(key);
  if (keyKind === 'secret' || keyKind === 'address') {
    return REDACTED;
  }
  if (keyKind === 'phone') {
    return value === null || value === undefined ? value : REDACTED_PHONE;
  }
  if (value === null || value === undefined || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'string') {
    return redactString(value, sensitiveValues);
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    return `[${typeof value}]`;
  }
  if (depth >= MAX_DEPTH) {
    return '[MaxDepth]';
  }
  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item) =>
          redactValue(item, seen, depth + 1, '', sensitiveValues),
        );
      if (value.length > MAX_ARRAY_ITEMS) {
        items.push(`[${value.length - MAX_ARRAY_ITEMS} more items]`);
      }
      return items;
    }

    if (value instanceof Error) {
      const result = {
        name: redactString(String(value.name || 'Error'), sensitiveValues),
        message: redactString(
          String(value.message || ''),
          sensitiveValues,
        ),
      };
      if (typeof value.stack === 'string') {
        result.stack = redactString(value.stack, sensitiveValues);
      }
      for (const ownKey of Object.getOwnPropertyNames(value)) {
        if (ownKey === 'name' || ownKey === 'message' || ownKey === 'stack') {
          continue;
        }
        result[ownKey] = redactValue(
          value[ownKey],
          seen,
          depth + 1,
          ownKey,
          sensitiveValues,
        );
      }
      return result;
    }

    const result = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      result[entryKey] = redactValue(
        entryValue,
        seen,
        depth + 1,
        entryKey,
        sensitiveValues,
      );
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function collectSensitiveValues(value, seen, depth, key, output) {
  const keyKind = classifyKey(key);
  if (
    (keyKind === 'secret' ||
      keyKind === 'phone' ||
      keyKind === 'address') &&
    (typeof value === 'string' || typeof value === 'number')
  ) {
    addSensitiveValue(output, String(value));
    return;
  }
  if (typeof value === 'string') {
    collectInlineSensitiveValues(value, output);
    return;
  }
  if (
    !value ||
    typeof value !== 'object' ||
    depth >= MAX_DEPTH ||
    seen.has(value)
  ) {
    return;
  }

  seen.add(value);
  try {
    if (value instanceof Error) {
      collectInlineSensitiveValues(String(value.message || ''), output);
      collectInlineSensitiveValues(String(value.stack || ''), output);
      for (const ownKey of Object.getOwnPropertyNames(value)) {
        if (ownKey === 'name' || ownKey === 'message' || ownKey === 'stack') {
          continue;
        }
        collectSensitiveValues(
          value[ownKey],
          seen,
          depth + 1,
          ownKey,
          output,
        );
      }
      return;
    }
    for (const [entryKey, entryValue] of Object.entries(value)) {
      collectSensitiveValues(
        entryValue,
        seen,
        depth + 1,
        entryKey,
        output,
      );
    }
  } finally {
    seen.delete(value);
  }
}

function collectInlineSensitiveValues(value, output) {
  for (const match of value.matchAll(
    /\bBearer\s+([A-Za-z0-9._~+/=-]+)/gi,
  )) {
    addSensitiveValue(output, match[1]);
  }
  for (const match of value.matchAll(
    /(?:password|passwd|authorization|cookie|secret|token|api[_-]?key|access[_-]?key|verification[_-]?code|sms[_-]?code|otp|address|full[_-]?address|street[_-]?address)\s*["']?\s*[:=]\s*["']?([^"',;\s}\]]+)/gi,
  )) {
    addSensitiveValue(output, match[1]);
  }
  for (const match of value.matchAll(/\b1[3-9]\d{9}\b/g)) {
    addSensitiveValue(output, match[0]);
  }
}

function addSensitiveValue(output, value) {
  const normalized = String(value || '').trim();
  if (
    normalized.length >= 4 &&
    normalized !== REDACTED &&
    normalized !== REDACTED_PHONE
  ) {
    output.add(normalized);
  }
}

function classifyKey(value) {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (!normalized) {
    return 'normal';
  }
  if (
    normalized.includes('password') ||
    normalized.includes('passwd') ||
    normalized.includes('authorization') ||
    normalized.includes('cookie') ||
    normalized.includes('secret') ||
    normalized.includes('token') ||
    normalized.includes('apikey') ||
    normalized.includes('accesskey') ||
    normalized.includes('verificationcode') ||
    normalized.includes('smscode') ||
    normalized === 'otp' ||
    normalized === 'otpcode'
  ) {
    return 'secret';
  }
  if (
    normalized.includes('phone') ||
    normalized.includes('mobile') ||
    normalized === 'tel' ||
    normalized.endsWith('telephone')
  ) {
    return 'phone';
  }
  if (normalized.includes('address')) {
    return 'address';
  }
  return 'normal';
}

function redactString(value, sensitiveValues = new Set()) {
  let result = String(value).slice(0, MAX_STRING_LENGTH);
  for (const sensitiveValue of sensitiveValues) {
    result = result.split(sensitiveValue).join(REDACTED);
  }
  result = result.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
  result = result.replace(
    /((?:password|passwd|authorization|cookie|secret|token|api[_-]?key|access[_-]?key|verification[_-]?code|sms[_-]?code|otp|address|full[_-]?address|street[_-]?address)\s*["']?\s*[:=]\s*["']?)([^"',;\s}\]]+)/gi,
    '$1[REDACTED]',
  );
  result = result.replace(/\b1[3-9]\d{9}\b/g, REDACTED_PHONE);
  return result;
}

function resolveCorrelationId(headers, randomId = crypto.randomUUID) {
  const candidate =
    readHeader(headers, 'x-correlation-id') ||
    readHeader(headers, 'x-request-id');
  if (candidate && CORRELATION_ID_PATTERN.test(candidate)) {
    return candidate;
  }
  return randomId();
}

function readHeader(headers, name) {
  if (!headers || typeof headers !== 'object') {
    return null;
  }
  const matchingKey = Object.keys(headers).find(
    (key) => key.toLowerCase() === name,
  );
  const direct = matchingKey ? headers[matchingKey] : undefined;
  const value = Array.isArray(direct) ? direct[0] : direct;
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function safeRequestPath(request) {
  const value = String(request?.originalUrl || request?.url || '');
  const pathOnly = value.split('?', 1)[0];
  return pathOnly.replace(
    /(\/public\/sales-sheets\/)[^/?#]+/gi,
    '$1[REDACTED]',
  );
}

function logSanitizedError(logger, entry) {
  const sink =
    logger && typeof logger.error === 'function'
      ? logger
      : console;
  sink.error(JSON.stringify(redactSensitive(entry)));
}

module.exports = {
  CORRELATION_ID_PATTERN,
  REDACTED,
  REDACTED_PHONE,
  logSanitizedError,
  redactSensitive,
  resolveCorrelationId,
  safeRequestPath,
};
