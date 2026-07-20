const OMIT_VALUE = Symbol('omit-audit-value');

const DEFAULT_SANITIZE_AUDIT_OPTIONS = Object.freeze({
  maxStringLength: 2048,
  maxArrayLength: 100,
  maxObjectKeys: 100,
  maxDepth: 10,
  maxSerializedBytes: 64 * 1024,
});

const MASKED_ADDRESS = '[MASKED_ADDRESS]';
const MASKED_PHONE = '[MASKED_PHONE]';
const REDACTED = '[REDACTED]';

function sanitizeAuditData(value, options = {}) {
  return sanitizeAuditDataWithReport(value, options).data;
}

function sanitizeAuditDataWithReport(value, options = {}) {
  const config = normalizeOptions(options);
  const reportState = {
    redactedCategories: new Set(),
    limitations: new Set(),
  };
  const sanitized = sanitizeValue(
    value,
    '',
    0,
    new WeakSet(),
    config,
    reportState,
  );
  let data = sanitized === OMIT_VALUE || sanitized === undefined
    ? null
    : sanitized;

  if (serializedBytes(data) > config.maxSerializedBytes) {
    reportState.limitations.add('total_size');
    data = createSizeLimitedPreview(data, config.maxSerializedBytes);
  }

  return {
    data,
    report: {
      version: 1,
      redactedCategories: Array.from(reportState.redactedCategories).sort(),
      limitations: Array.from(reportState.limitations).sort(),
      truncated: reportState.limitations.size > 0,
    },
  };
}

function sanitizeOperationLogData(log, options = {}) {
  const before = sanitizeAuditDataWithReport(log?.beforeData ?? null, options);
  const after = sanitizeAuditDataWithReport(log?.afterData ?? null, options);
  return {
    beforeData: before.data,
    afterData: after.data,
    sanitizationSummary: {
      version: 1,
      redactedCategories: Array.from(
        new Set([
          ...before.report.redactedCategories,
          ...after.report.redactedCategories,
        ]),
      ).sort(),
      limitations: Array.from(
        new Set([
          ...before.report.limitations,
          ...after.report.limitations,
        ]),
      ).sort(),
      truncated: before.report.truncated || after.report.truncated,
    },
  };
}

function sanitizeAiText(value, options = {}) {
  const reportState = {
    redactedCategories: new Set(),
    limitations: new Set(),
  };
  const maxLength = normalizePositiveInteger(
    options.maxLength,
    DEFAULT_SANITIZE_AUDIT_OPTIONS.maxStringLength,
    32,
    16000,
  );
  return sanitizeText(
    String(value ?? ''),
    {
      ...DEFAULT_SANITIZE_AUDIT_OPTIONS,
      maxStringLength: maxLength,
    },
    reportState,
    true,
  );
}

function sanitizeValue(value, key, depth, seen, config, reportState) {
  const fieldCategory = classifyField(key);
  if (fieldCategory === 'secret') {
    reportState.redactedCategories.add(classifySecretCategory(key));
    return OMIT_VALUE;
  }
  if (fieldCategory === 'phone') {
    reportState.redactedCategories.add('phone');
    return value === null || value === undefined
      ? null
      : maskPhoneValue(String(value));
  }
  if (fieldCategory === 'address') {
    reportState.redactedCategories.add('address');
    return value === null || value === undefined ? null : MASKED_ADDRESS;
  }

  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return sanitizeText(value, config, reportState, false);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    reportState.limitations.add('unsupported_type');
    return null;
  }
  if (depth >= config.maxDepth) {
    reportState.limitations.add('depth');
    return '[MAX_DEPTH_REACHED]';
  }
  if (seen.has(value)) {
    reportState.limitations.add('cycle');
    return '[CIRCULAR_REFERENCE]';
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
    reportState.limitations.add('binary');
    return '[BINARY_DATA_OMITTED]';
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > config.maxArrayLength) {
        reportState.limitations.add('array_length');
      }
      return value
        .slice(0, config.maxArrayLength)
        .map((item) =>
          sanitizeValue(
            item,
            '',
            depth + 1,
            seen,
            config,
            reportState,
          ),
        )
        .filter((item) => item !== OMIT_VALUE);
    }

    if (value instanceof Error) {
      return {
        name: sanitizeText(
          String(value.name || 'Error'),
          config,
          reportState,
          false,
        ),
        message: sanitizeText(
          String(value.message || ''),
          config,
          reportState,
          false,
        ),
      };
    }

    const entries = Object.entries(value);
    if (entries.length > config.maxObjectKeys) {
      reportState.limitations.add('object_keys');
    }
    const result = {};
    for (const [nestedKey, nestedValue] of entries.slice(
      0,
      config.maxObjectKeys,
    )) {
      if (
        nestedKey === '__proto__' ||
        nestedKey === 'prototype' ||
        nestedKey === 'constructor'
      ) {
        reportState.limitations.add('unsafe_key');
        continue;
      }
      const sanitized = sanitizeValue(
        nestedValue,
        nestedKey,
        depth + 1,
        seen,
        config,
        reportState,
      );
      if (sanitized !== OMIT_VALUE) {
        result[nestedKey] = sanitized;
      }
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function sanitizeText(value, config, reportState, maskOrderIdentifiers) {
  let result = String(value);
  result = result.replace(
    /\b(?:mysql|postgres(?:ql)?|mongodb(?:\+srv)?|redis|mssql):\/\/[^\s"'<>]+/gi,
    () => {
      reportState.redactedCategories.add('connection_string');
      return '[REDACTED_CONNECTION_STRING]';
    },
  );
  result = result.replace(
    /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
    () => {
      reportState.redactedCategories.add('token');
      return 'Bearer [REDACTED]';
    },
  );
  result = result.replace(
    /((?:password|passwd|authorization|cookie|secret|token|api[\s_-]?key|access[\s_-]?key|private[\s_-]?key|verification[\s_-]?code|sms[\s_-]?code|otp|database[\s_-]?url|connection[\s_-]?string|dsn)\s*["']?\s*[:=]\s*["']?)([^"',;\s}\]]+)/gi,
    (match, prefix) => {
      reportState.redactedCategories.add(
        classifySecretCategory(String(prefix)),
      );
      return `${prefix}${REDACTED}`;
    },
  );
  result = result.replace(
    /((?:密码|口令|令牌|凭证|密钥|连接串|连接字符串)\s*(?:[:：=]\s*|\s+))([^"',，。；;\s}\]]+)/g,
    (match, prefix) => {
      reportState.redactedCategories.add(
        classifySecretCategory(String(prefix)),
      );
      return `${prefix}${REDACTED}`;
    },
  );
  result = result.replace(
    /((?:验证码|校验码)\s*[:：=]?\s*)(\d{4,8})/g,
    (match, prefix) => {
      reportState.redactedCategories.add('verification_code');
      return `${prefix}${REDACTED}`;
    },
  );
  result = result.replace(/\b1[3-9]\d{9}\b/g, (phone) => {
    reportState.redactedCategories.add('phone');
    return maskPhoneValue(phone);
  });
  result = result.replace(
    /((?:收货|联系|家庭)?地址\s*[:：=]?\s*)([^,，。；;\n]{2,})/gi,
    (match, prefix) => {
      reportState.redactedCategories.add('address');
      return `${prefix}${MASKED_ADDRESS}`;
    },
  );
  result = result.replace(
    /(\b(?:shipping|home|street|full)?\s*address\s*[:=]\s*)([^,;\n]{2,})/gi,
    (match, prefix) => {
      reportState.redactedCategories.add('address');
      return `${prefix}${MASKED_ADDRESS}`;
    },
  );
  result = result.replace(
    /[\u4e00-\u9fff]{2,}(?:省|自治区|市)[\u4e00-\u9fff]{1,}(?:市|区|县)[\u4e00-\u9fffA-Za-z0-9-]{2,24}(?:路|街|道|巷|镇|乡|村)[\u4e00-\u9fffA-Za-z0-9-]{0,16}(?:号|栋|单元|室)?/g,
    () => {
      reportState.redactedCategories.add('address');
      return MASKED_ADDRESS;
    },
  );
  if (maskOrderIdentifiers) {
    result = maskAiIdentifiers(result, reportState);
  }
  if (result.length > config.maxStringLength) {
    reportState.limitations.add('string_length');
    result = `${result.slice(0, Math.max(0, config.maxStringLength - 3))}...`;
  }
  return result;
}

function maskAiIdentifiers(value, reportState) {
  let result = value.replace(
    /\b(?:SO|AS|TG|SF|YT|YD|ANE|JD|ZTO|STO|YTO|EMS)[A-Z0-9_-]{2,}\b/gi,
    (identifier) => {
      reportState.redactedCategories.add('business_identifier');
      const prefix = identifier.match(/^[A-Za-z]+/)?.[0] || 'ID';
      return `${prefix.toUpperCase()}-[MASKED]`;
    },
  );
  result = result.replace(
    /((?:订单号|售后单号|物流单号|团号|order\s*(?:no|number)?|tracking\s*(?:no|number)?)\s*[:：#]?\s*)([A-Za-z0-9_-]{4,})/gi,
    (match, prefix) => {
      reportState.redactedCategories.add('business_identifier');
      return `${prefix}[MASKED]`;
    },
  );
  return result;
}

function classifyField(key) {
  const rawKey = String(key || '').toLowerCase();
  const normalized = normalizeKey(key);
  if (
    /(?:手机|电话|联系电话)/.test(rawKey) ||
    normalized.includes('phone') ||
    normalized.includes('mobile') ||
    normalized === 'tel' ||
    normalized.endsWith('telephone')
  ) {
    return 'phone';
  }
  if (/(?:地址|住址)/.test(rawKey) || normalized.includes('address')) {
    return 'address';
  }
  if (
    /(?:密码|口令|令牌|凭证|验证码|校验码|密钥|连接串|连接字符串)/.test(
      rawKey,
    )
  ) {
    return 'secret';
  }
  if (!normalized) {
    return 'normal';
  }
  return isSecretKey(normalized) ? 'secret' : 'normal';
}

function isSecretKey(normalized) {
  if (normalized === 'tokenpresent' || normalized === 'tokenfingerprint') {
    return false;
  }
  return (
    normalized.includes('password') ||
    normalized.includes('passwd') ||
    normalized.includes('authorization') ||
    normalized.includes('cookie') ||
    normalized.includes('secret') ||
    normalized.includes('token') ||
    normalized.includes('credential') ||
    normalized === 'key' ||
    normalized.includes('apikey') ||
    normalized.includes('accesskey') ||
    normalized.includes('privatekey') ||
    normalized.includes('signingkey') ||
    normalized.includes('encryptionkey') ||
    normalized.includes('verificationcode') ||
    normalized.includes('smscode') ||
    normalized === 'otp' ||
    normalized === 'otpcode' ||
    normalized.includes('databaseurl') ||
    normalized.includes('connectionstring') ||
    normalized === 'dsn'
  );
}

function classifySecretCategory(key) {
  const rawKey = String(key || '').toLowerCase();
  const normalized = normalizeKey(key);
  if (
    /(?:密码|口令)/.test(rawKey) ||
    normalized.includes('password') ||
    normalized.includes('passwd')
  ) {
    return 'password';
  }
  if (
    /(?:验证码|校验码)/.test(rawKey) ||
    normalized.includes('verificationcode') ||
    normalized.includes('smscode') ||
    normalized === 'otp' ||
    normalized === 'otpcode'
  ) {
    return 'verification_code';
  }
  if (normalized.includes('cookie')) {
    return 'cookie';
  }
  if (
    /(?:连接串|连接字符串)/.test(rawKey) ||
    normalized.includes('databaseurl') ||
    normalized.includes('connectionstring') ||
    normalized === 'dsn'
  ) {
    return 'connection_string';
  }
  if (
    /(?:密钥|凭证)/.test(rawKey) ||
    normalized.includes('apikey') ||
    normalized.includes('accesskey') ||
    normalized.includes('privatekey') ||
    normalized.includes('signingkey') ||
    normalized.includes('encryptionkey') ||
    normalized.includes('secret') ||
    normalized.includes('credential')
  ) {
    return 'key_or_secret';
  }
  return 'token';
}

function normalizeKey(key) {
  return String(key || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function maskPhoneValue(value) {
  const normalized = String(value || '');
  if (/^1[3-9]\d{9}$/.test(normalized)) {
    return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
  }
  return MASKED_PHONE;
}

function createSizeLimitedPreview(value, maxBytes) {
  const serialized = JSON.stringify(value);
  const base = {
    _auditDataTruncated: true,
    preview: '',
  };
  const availableBytes = Math.max(0, Math.floor(maxBytes / 3));
  base.preview = truncateUtf8(serialized, availableBytes);
  while (serializedBytes(base) > maxBytes && base.preview.length > 0) {
    base.preview = base.preview.slice(0, Math.floor(base.preview.length * 0.8));
  }
  if (serializedBytes(base) <= maxBytes) {
    return base;
  }
  return { _auditDataTruncated: true };
}

function truncateUtf8(value, maxBytes) {
  let result = String(value || '');
  while (Buffer.byteLength(result, 'utf8') > maxBytes && result.length > 0) {
    result = result.slice(0, Math.floor(result.length * 0.9));
  }
  return result;
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function normalizeOptions(options) {
  return {
    maxStringLength: normalizePositiveInteger(
      options.maxStringLength,
      DEFAULT_SANITIZE_AUDIT_OPTIONS.maxStringLength,
      32,
      16000,
    ),
    maxArrayLength: normalizePositiveInteger(
      options.maxArrayLength,
      DEFAULT_SANITIZE_AUDIT_OPTIONS.maxArrayLength,
      1,
      1000,
    ),
    maxObjectKeys: normalizePositiveInteger(
      options.maxObjectKeys,
      DEFAULT_SANITIZE_AUDIT_OPTIONS.maxObjectKeys,
      1,
      1000,
    ),
    maxDepth: normalizePositiveInteger(
      options.maxDepth,
      DEFAULT_SANITIZE_AUDIT_OPTIONS.maxDepth,
      1,
      32,
    ),
    maxSerializedBytes: normalizePositiveInteger(
      options.maxSerializedBytes,
      DEFAULT_SANITIZE_AUDIT_OPTIONS.maxSerializedBytes,
      128,
      1024 * 1024,
    ),
  };
}

function normalizePositiveInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return fallback;
  }
  return parsed;
}

module.exports = {
  DEFAULT_SANITIZE_AUDIT_OPTIONS,
  MASKED_ADDRESS,
  MASKED_PHONE,
  REDACTED,
  sanitizeAiText,
  sanitizeAuditData,
  sanitizeAuditDataWithReport,
  sanitizeOperationLogData,
};
