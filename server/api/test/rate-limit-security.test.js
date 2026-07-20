const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  MemoryRateLimitStore,
  SecurityRateLimiter,
  createLegacyRateLimitService,
  readRateLimitConfig,
} = require('../src/common/rate-limit/rate-limit');
const { getRequestIp } = require('../src/common/request-ip');
const {
  BOOTSTRAP_ADMIN_PASSWORD,
  assertErrorContract,
  login,
  requestJson,
  withNestApiServer,
} = require('./helpers/phase1-api');

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

class FakeClock {
  constructor(nowMs = Date.UTC(2026, 6, 20, 0, 0, 0)) {
    this.nowMs = nowMs;
  }

  now() {
    return this.nowMs;
  }

  advance(milliseconds) {
    this.nowMs += milliseconds;
  }
}

function rateLimitTestOptions(env = {}, prisma = {}) {
  const rateLimitClock = new FakeClock();
  return {
    rateLimitClock,
    options: {
      env: {
        RATE_LIMIT_STORE: 'memory',
        ...env,
      },
      prisma,
      rateLimitClock,
      rateLimitStore: new MemoryRateLimitStore(),
    },
  };
}

function assertRateLimited(result, code, retryAfterSeconds) {
  assertErrorContract(result, 429, code);
  assert.equal(
    result.response.headers.get('retry-after'),
    String(retryAfterSeconds),
  );
}

test('login rate limit uses source IP plus normalized account and resets with the window', async () => {
  const fixture = rateLimitTestOptions({
    LOGIN_RATE_LIMIT_MAX_REQUESTS: '2',
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: '60',
    TRUSTED_PROXY_IPS: '',
  });

  await withNestApiServer(
    async (baseUrl) => {
      const missingAccount = await requestJson(baseUrl, '/api/auth/login', {
        method: 'POST',
        headers: { 'X-Forwarded-For': '198.51.100.10' },
        body: {
          username: 'missing-rate-limit-user',
          password: 'invalid-test-password',
        },
      });
      const firstWrongPassword = await requestJson(
        baseUrl,
        '/api/auth/login',
        {
          method: 'POST',
          headers: { 'X-Forwarded-For': '198.51.100.11' },
          body: {
            username: 'admin',
            password: 'invalid-test-password',
          },
        },
      );
      assertErrorContract(missingAccount, 401, 'INVALID_CREDENTIALS');
      assertErrorContract(firstWrongPassword, 401, 'INVALID_CREDENTIALS');
      assert.deepEqual(missingAccount.body, firstWrongPassword.body);

      const secondWrongPassword = await requestJson(
        baseUrl,
        '/api/auth/login',
        {
          method: 'POST',
          headers: { 'X-Forwarded-For': '198.51.100.12' },
          body: {
            username: ' ADMIN ',
            password: 'invalid-test-password',
          },
        },
      );
      assertErrorContract(secondWrongPassword, 401, 'INVALID_CREDENTIALS');

      const rejected = await requestJson(baseUrl, '/api/auth/login', {
        method: 'POST',
        headers: { 'X-Forwarded-For': '198.51.100.13' },
        body: {
          username: 'Admin',
          password: 'invalid-test-password',
        },
      });
      assertRateLimited(rejected, 'LOGIN_RATE_LIMITED', 60);

      fixture.rateLimitClock.advance(MINUTE_MS);
      const afterReset = await requestJson(baseUrl, '/api/auth/login', {
        method: 'POST',
        body: {
          username: 'admin',
          password: 'invalid-test-password',
        },
      });
      assertErrorContract(afterReset, 401, 'INVALID_CREDENTIALS');
    },
    fixture.options,
  );
});

test('SMS reset-code limit runs before mock delivery and resets with the window', async () => {
  const targetId = 'usr-rate-limit-sms-target';
  const fixture = rateLimitTestOptions(
    {
      ALIYUN_SMS_MOCK: 'true',
      SMS_VERIFICATION_DEBUG: 'true',
      SMS_CODE_RATE_LIMIT_MAX_REQUESTS: '2',
      SMS_CODE_RATE_LIMIT_WINDOW_SECONDS: '60',
    },
    {
      users: [
        {
          id: targetId,
          username: '13800000021',
          phone: '13800000021',
          role: 'sales',
        },
      ],
    },
  );

  await withNestApiServer(
    async (baseUrl, context) => {
      const admin = await login(baseUrl);
      const pathName = `/api/users/${targetId}/reset-password-code`;
      for (let requestIndex = 0; requestIndex < 2; requestIndex += 1) {
        const accepted = await requestJson(baseUrl, pathName, {
          method: 'POST',
          token: admin.token,
        });
        assert.equal(accepted.response.status, 200);
      }

      const beforeRejected =
        await context.prisma.smsVerificationCode.findMany();
      const rejected = await requestJson(baseUrl, pathName, {
        method: 'POST',
        token: admin.token,
      });
      assertRateLimited(rejected, 'SMS_CODE_RATE_LIMITED', 60);
      const afterRejected =
        await context.prisma.smsVerificationCode.findMany();
      assert.equal(afterRejected.length, beforeRejected.length);

      fixture.rateLimitClock.advance(MINUTE_MS);
      const afterReset = await requestJson(baseUrl, pathName, {
        method: 'POST',
        token: admin.token,
      });
      assert.equal(afterReset.response.status, 200);
    },
    fixture.options,
  );
});

test('password-reset attempt limit runs before password hashing and resets with the window', async () => {
  const targetId = 'usr-rate-limit-password-target';
  const fixture = rateLimitTestOptions(
    {
      ALIYUN_SMS_MOCK: 'true',
      SMS_VERIFICATION_DEBUG: 'true',
      SMS_CODE_RATE_LIMIT_MAX_REQUESTS: '10',
      PASSWORD_RESET_RATE_LIMIT_MAX_REQUESTS: '2',
      PASSWORD_RESET_RATE_LIMIT_WINDOW_SECONDS: '60',
    },
    {
      users: [
        {
          id: targetId,
          username: '13800000022',
          phone: '13800000022',
          role: 'sales',
        },
      ],
    },
  );

  await withNestApiServer(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const codeResult = await requestJson(
        baseUrl,
        `/api/users/${targetId}/reset-password-code`,
        {
          method: 'POST',
          token: admin.token,
        },
      );
      assert.equal(codeResult.response.status, 200);
      const verificationCode =
        codeResult.body.data.verification.debugCode;
      const wrongCode =
        verificationCode === '000000' ? '000001' : '000000';
      const resetPath = `/api/users/${targetId}/reset-password`;

      for (let requestIndex = 0; requestIndex < 2; requestIndex += 1) {
        const invalid = await requestJson(baseUrl, resetPath, {
          method: 'POST',
          token: admin.token,
          body: {
            verificationCode: wrongCode,
            newPassword: 'ResetPassword123',
          },
        });
        assertErrorContract(invalid, 400, 'SMS_CODE_INCORRECT');
      }

      const rejected = await requestJson(baseUrl, resetPath, {
        method: 'POST',
        token: admin.token,
        body: {
          verificationCode,
          newPassword: 'ResetPassword123',
        },
      });
      assertRateLimited(rejected, 'PASSWORD_RESET_RATE_LIMITED', 60);

      fixture.rateLimitClock.advance(MINUTE_MS);
      const afterReset = await requestJson(baseUrl, resetPath, {
        method: 'POST',
        token: admin.token,
        body: {
          verificationCode,
          newPassword: 'ResetPassword123',
        },
      });
      assert.equal(afterReset.response.status, 200);
      assert.equal(afterReset.body.data.user.mustChangePassword, false);
    },
    fixture.options,
  );
});

test('AI enforces both the short window and the configured daily quota', async () => {
  const fixture = rateLimitTestOptions({
    AI_ENABLED: 'true',
    AI_MOCK_MODE: 'true',
    AI_RATE_LIMIT_MAX_REQUESTS: '2',
    AI_RATE_LIMIT_WINDOW_SECONDS: '60',
    AI_DAILY_LIMIT_PER_USER: '3',
  });

  await withNestApiServer(
    async (baseUrl) => {
      const admin = await login(
        baseUrl,
        'admin',
        BOOTSTRAP_ADMIN_PASSWORD,
      );
      const chat = () =>
        requestJson(baseUrl, '/api/ai/chat', {
          method: 'POST',
          token: admin.token,
          body: {
            question: 'sales amount 2026-07-01 2026-07-04',
          },
        });

      assert.equal((await chat()).response.status, 201);
      assert.equal((await chat()).response.status, 201);
      assertRateLimited(await chat(), 'AI_RATE_LIMITED', 60);

      fixture.rateLimitClock.advance(MINUTE_MS);
      assert.equal((await chat()).response.status, 201);
      const dailyRejected = await chat();
      assertErrorContract(
        dailyRejected,
        429,
        'AI_DAILY_LIMIT_EXCEEDED',
      );
      assert.equal(
        Number(dailyRejected.response.headers.get('retry-after')) > 0,
        true,
      );

      fixture.rateLimitClock.advance(DAY_MS);
      assert.equal((await chat()).response.status, 201);
    },
    fixture.options,
  );
});

test('two concurrent AI requests cannot pass the final daily quota slot', async () => {
  const fixture = rateLimitTestOptions({
    AI_ENABLED: 'true',
    AI_MOCK_MODE: 'true',
    AI_RATE_LIMIT_MAX_REQUESTS: '10',
    AI_RATE_LIMIT_WINDOW_SECONDS: '60',
    AI_DAILY_LIMIT_PER_USER: '1',
  });

  await withNestApiServer(
    async (baseUrl, context) => {
      const admin = await login(baseUrl);
      const send = () =>
        requestJson(baseUrl, '/api/ai/chat', {
          method: 'POST',
          token: admin.token,
          body: {
            question: 'sales amount 2026-07-01 2026-07-04',
          },
        });
      const results = await Promise.all([send(), send()]);
      assert.deepEqual(
        results.map((result) => result.response.status).sort(),
        [201, 429],
      );
      const rejected = results.find(
        (result) => result.response.status === 429,
      );
      assertErrorContract(rejected, 429, 'AI_DAILY_LIMIT_EXCEEDED');
      assert.equal(context.prisma.__store.aiChatMessages.length, 1);
    },
    fixture.options,
  );
});

test('forwarded client IP is used only through an explicitly trusted immediate proxy', () => {
  const forwardedHeaders = {
    'x-forwarded-for': '192.0.2.20, 198.51.100.20',
  };
  assert.equal(
    getRequestIp(
      {
        socket: { remoteAddress: '203.0.113.20' },
        headers: forwardedHeaders,
      },
      { TRUSTED_PROXY_IPS: '127.0.0.1' },
    ),
    '203.0.113.20',
  );
  assert.equal(
    getRequestIp(
      {
        socket: { remoteAddress: '203.0.113.20' },
        headers: forwardedHeaders,
      },
      { TRUSTED_PROXY_IPS: '203.0.113.20' },
    ),
    '198.51.100.20',
  );
});

test('production rejects a process-local store and a missing fingerprint secret', () => {
  assert.throws(
    () =>
      readRateLimitConfig({
        NODE_ENV: 'production',
        RATE_LIMIT_STORE: 'memory',
      }),
    (error) => error?.code === 'RATE_LIMIT_CONFIG_INVALID',
  );
  assert.throws(
    () =>
      readRateLimitConfig({
        NODE_ENV: 'production',
        RATE_LIMIT_STORE: 'database',
    }),
    (error) => error?.code === 'RATE_LIMIT_CONFIG_INVALID',
  );
  assert.throws(
    () =>
      createLegacyRateLimitService({
        env: {
          NODE_ENV: 'production',
          RATE_LIMIT_STORE: 'database',
          RATE_LIMIT_KEY_SECRET:
            'test-only-rate-limit-fingerprint-key-32-bytes',
        },
      }),
    (error) => error?.code === 'RATE_LIMIT_CONFIG_INVALID',
  );
});

test('rate-limit logs contain only a truncated keyed fingerprint', async () => {
  const entries = [];
  const limiter = new SecurityRateLimiter({
    store: new MemoryRateLimitStore(),
    clock: new FakeClock(),
    config: {
      login: { maxRequests: 1, windowMs: MINUTE_MS },
      smsCode: { maxRequests: 1, windowMs: MINUTE_MS },
      passwordReset: { maxRequests: 1, windowMs: MINUTE_MS },
      aiShort: { maxRequests: 1, windowMs: MINUTE_MS },
    },
    fingerprintSecret:
      'test-only-rate-limit-fingerprint-key-32-bytes',
    logger: (entry) => entries.push(entry),
  });

  const input = {
    actorId: 'usr-log-actor',
    targetUserId: 'usr-log-target',
    phone: '13800000023',
  };
  await limiter.enforceSmsCode(input);
  await assert.rejects(
    limiter.enforceSmsCode(input),
    (error) =>
      error?.statusCode === 429 &&
      error?.code === 'SMS_CODE_RATE_LIMITED',
  );

  assert.equal(entries.length, 1);
  assert.deepEqual(Object.keys(entries[0]).sort(), [
    'event',
    'keyFingerprint',
    'retryAfterSeconds',
    'scope',
  ]);
  assert.match(entries[0].keyFingerprint, /^[a-f0-9]{16}$/);
  const serialized = JSON.stringify(entries[0]);
  assert.equal(serialized.includes(input.actorId), false);
  assert.equal(serialized.includes(input.targetUserId), false);
  assert.equal(serialized.includes(input.phone), false);
});

test('Prisma schema and migration define the shared rate-limit counter table', () => {
  const schema = fs.readFileSync(
    path.join(__dirname, '../prisma/schema.prisma'),
    'utf8',
  );
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      '../prisma/migrations/20260720000100_security_rate_limit_counters/migration.sql',
    ),
    'utf8',
  );
  assert.match(schema, /model RateLimitCounter\s*\{/);
  assert.match(schema, /@@map\("rate_limit_counters"\)/);
  assert.match(migration, /CREATE TABLE `rate_limit_counters`/);
});
