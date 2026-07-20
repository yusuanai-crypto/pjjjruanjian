const crypto = require('node:crypto');
const { createHttpError } = require('../errors');

const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

class MemoryRateLimitStore {
  constructor() {
    this.counters = new Map();
  }

  async consume(input) {
    const counterKey = `${input.scope}:${input.keyFingerprint}`;
    const current = this.counters.get(counterKey);
    const requestCount =
      current && current.windowStartMs === input.windowStartMs
        ? current.requestCount + 1
        : 1;
    this.counters.set(counterKey, {
      windowStartMs: input.windowStartMs,
      windowEndMs: input.windowEndMs,
      requestCount,
    });
    return {
      allowed: requestCount <= input.limit,
      requestCount,
    };
  }
}

class PrismaRateLimitStore {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async consume(input) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        INSERT INTO rate_limit_counters (
          key_fingerprint,
          scope,
          window_start_at,
          window_end_at,
          request_count,
          updated_at
        )
        VALUES (
          ${input.keyFingerprint},
          ${input.scope},
          ${new Date(input.windowStartMs)},
          ${new Date(input.windowEndMs)},
          1,
          CURRENT_TIMESTAMP(3)
        )
        ON DUPLICATE KEY UPDATE
          scope = VALUES(scope),
          request_count = IF(
            window_start_at = VALUES(window_start_at),
            request_count + 1,
            1
          ),
          window_start_at = VALUES(window_start_at),
          window_end_at = VALUES(window_end_at),
          updated_at = CURRENT_TIMESTAMP(3)
      `;
      const rows = await transaction.$queryRaw`
        SELECT request_count AS requestCount
        FROM rate_limit_counters
        WHERE key_fingerprint = ${input.keyFingerprint}
        FOR UPDATE
      `;
      const requestCount = Number(rows?.[0]?.requestCount || 0);
      return {
        allowed: requestCount <= input.limit,
        requestCount,
      };
    });
  }
}

class SecurityRateLimiter {
  constructor(options) {
    this.store = options.store;
    this.clock = options.clock || { now: () => Date.now() };
    this.config = options.config;
    this.fingerprintSecret = options.fingerprintSecret || null;
    this.logger = options.logger || defaultRateLimitLogger;
  }

  enforceLogin({ ipAddress, username }) {
    return this.enforce({
      scope: 'auth.login',
      key: `${ipAddress || 'unknown'}\u0000${username}`,
      limit: this.config.login.maxRequests,
      windowMs: this.config.login.windowMs,
      errorCode: 'LOGIN_RATE_LIMITED',
      message: 'Too many login attempts. Try again later.',
    });
  }

  enforceSmsCode({ actorId, targetUserId, phone }) {
    return this.enforce({
      scope: 'users.reset_password_code',
      key: `${actorId}\u0000${targetUserId}\u0000${phone}`,
      limit: this.config.smsCode.maxRequests,
      windowMs: this.config.smsCode.windowMs,
      errorCode: 'SMS_CODE_RATE_LIMITED',
      message: 'Too many verification code requests. Try again later.',
    });
  }

  enforcePasswordReset({ actorId, targetUserId }) {
    return this.enforce({
      scope: 'users.reset_password',
      key: `${actorId}\u0000${targetUserId}`,
      limit: this.config.passwordReset.maxRequests,
      windowMs: this.config.passwordReset.windowMs,
      errorCode: 'PASSWORD_RESET_RATE_LIMITED',
      message: 'Too many password reset attempts. Try again later.',
    });
  }

  async enforceAi({ userId, dailyLimit }) {
    await this.enforce({
      scope: 'ai.chat.short',
      key: userId,
      limit: this.config.aiShort.maxRequests,
      windowMs: this.config.aiShort.windowMs,
      errorCode: 'AI_RATE_LIMITED',
      message: 'Too many AI requests. Try again later.',
    });

    const nowMs = this.nowMs();
    const dailyWindowStartMs =
      Math.floor((nowMs + SHANGHAI_UTC_OFFSET_MS) / DAY_MS) * DAY_MS -
      SHANGHAI_UTC_OFFSET_MS;
    await this.enforce({
      scope: 'ai.chat.daily',
      key: userId,
      limit: dailyLimit,
      windowMs: DAY_MS,
      windowStartMs: dailyWindowStartMs,
      errorCode: 'AI_DAILY_LIMIT_EXCEEDED',
      message: 'The daily AI request limit has been reached.',
    });
  }

  async enforce(options) {
    const nowMs = this.nowMs();
    const windowStartMs =
      options.windowStartMs ??
      Math.floor(nowMs / options.windowMs) * options.windowMs;
    const windowEndMs = windowStartMs + options.windowMs;
    const keyFingerprint = fingerprintKey(
      options.scope,
      options.key,
      this.fingerprintSecret,
    );
    const result = await this.store.consume({
      scope: options.scope,
      keyFingerprint,
      windowStartMs,
      windowEndMs,
      limit: options.limit,
    });
    if (result.allowed) {
      return {
        remaining: Math.max(0, options.limit - result.requestCount),
        resetAt: new Date(windowEndMs),
      };
    }

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((windowEndMs - nowMs) / 1000),
    );
    this.logger({
      event: 'rate_limit_exceeded',
      scope: options.scope,
      keyFingerprint: keyFingerprint.slice(0, 16),
      retryAfterSeconds,
    });
    throw createRateLimitError(
      options.errorCode,
      options.message,
      retryAfterSeconds,
    );
  }

  nowMs() {
    const value = this.clock.now();
    return value instanceof Date ? value.getTime() : Number(value);
  }
}

function readRateLimitConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const storeMode = normalizeOptionalString(env.RATE_LIMIT_STORE) ||
    (production ? 'database' : 'memory');
  if (!['database', 'memory'].includes(storeMode)) {
    throw createRateLimitConfigurationError(
      'RATE_LIMIT_STORE must be "database" or "memory".',
    );
  }
  if (production && storeMode !== 'database') {
    throw createRateLimitConfigurationError(
      'Production rate limiting requires the shared database store.',
    );
  }

  const fingerprintSecret = normalizeOptionalString(
    env.RATE_LIMIT_KEY_SECRET,
  );
  if (
    storeMode === 'database' &&
    (!fingerprintSecret ||
      /^<[^>]+>$/.test(fingerprintSecret) ||
      Buffer.byteLength(fingerprintSecret, 'utf8') < 32)
  ) {
    throw createRateLimitConfigurationError(
      'RATE_LIMIT_KEY_SECRET must be a non-placeholder value of at least 32 bytes.',
    );
  }

  return {
    storeMode,
    fingerprintSecret,
    login: readRule(
      env,
      'LOGIN_RATE_LIMIT_MAX_REQUESTS',
      5,
      'LOGIN_RATE_LIMIT_WINDOW_SECONDS',
      15 * 60,
    ),
    smsCode: readRule(
      env,
      'SMS_CODE_RATE_LIMIT_MAX_REQUESTS',
      3,
      'SMS_CODE_RATE_LIMIT_WINDOW_SECONDS',
      60 * 60,
    ),
    passwordReset: readRule(
      env,
      'PASSWORD_RESET_RATE_LIMIT_MAX_REQUESTS',
      5,
      'PASSWORD_RESET_RATE_LIMIT_WINDOW_SECONDS',
      15 * 60,
    ),
    aiShort: readRule(
      env,
      'AI_RATE_LIMIT_MAX_REQUESTS',
      10,
      'AI_RATE_LIMIT_WINDOW_SECONDS',
      60,
    ),
  };
}

function createLegacyRateLimitService(options = {}) {
  const config = readRateLimitConfig(options.env || process.env);
  if (config.storeMode !== 'memory') {
    throw createRateLimitConfigurationError(
      'start:legacy is disabled when a shared production rate-limit store is required.',
    );
  }
  return new SecurityRateLimiter({
    store: new MemoryRateLimitStore(),
    clock: options.clock,
    config,
    fingerprintSecret: config.fingerprintSecret,
    logger: options.logger,
  });
}

function fingerprintKey(scope, key, secret) {
  const value = `${scope}\u0000${key}`;
  return secret
    ? crypto.createHmac('sha256', secret).update(value).digest('hex')
    : crypto.createHash('sha256').update(value).digest('hex');
}

function createRateLimitError(code, message, retryAfterSeconds) {
  return createHttpError(429, code, message, { retryAfterSeconds });
}

function createRateLimitConfigurationError(message) {
  const error = new Error(message);
  error.code = 'RATE_LIMIT_CONFIG_INVALID';
  return error;
}

function readRule(
  env,
  maxRequestsName,
  defaultMaxRequests,
  windowSecondsName,
  defaultWindowSeconds,
) {
  return {
    maxRequests: readPositiveInteger(
      env[maxRequestsName],
      defaultMaxRequests,
      maxRequestsName,
    ),
    windowMs:
      readPositiveInteger(
        env[windowSecondsName],
        defaultWindowSeconds,
        windowSecondsName,
      ) * 1000,
  };
}

function readPositiveInteger(value, fallback, name) {
  const normalized = normalizeOptionalString(value);
  if (normalized === null) {
    return fallback;
  }
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw createRateLimitConfigurationError(
      `${name} must be a positive integer.`,
    );
  }
  return parsed;
}

function normalizeOptionalString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function defaultRateLimitLogger(entry) {
  console.warn(JSON.stringify(entry));
}

module.exports = {
  MemoryRateLimitStore,
  PrismaRateLimitStore,
  SecurityRateLimiter,
  createLegacyRateLimitService,
  fingerprintKey,
  readRateLimitConfig,
};
