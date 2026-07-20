const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { AliyunSmsNestService } = require(
  '../src/modules/sms/aliyun-sms.nest.service',
);
const {
  assertErrorContract,
  login,
  requestJson,
  withNestApiServer,
} = require('./helpers/phase1-api');

const TARGET_PASSWORD = 'TargetPassword123';
const RESET_PASSWORD = 'ResetPassword456';

function lifecycleOptions(users) {
  return {
    env: {
      ALIYUN_SMS_MOCK: 'true',
      SMS_VERIFICATION_DEBUG: 'true',
      SMS_CODE_RATE_LIMIT_MAX_REQUESTS: '10',
      PASSWORD_RESET_RATE_LIMIT_MAX_REQUESTS: '10',
    },
    prisma: {
      users,
    },
  };
}

function targetUser(id, username) {
  return {
    id,
    name: `Lifecycle ${id}`,
    username,
    phone: username,
    password: TARGET_PASSWORD,
    role: 'sales',
  };
}

async function sendResetCode(baseUrl, token, userId) {
  const result = await requestJson(
    baseUrl,
    `/api/users/${userId}/reset-password-code`,
    {
      method: 'POST',
      token,
    },
  );
  assert.equal(result.response.status, 200);
  const code = result.body.data.verification.debugCode;
  assert.match(code, /^\d{6}$/);
  return code;
}

test('password change revokes the old JWT and returns a replacement session', async () => {
  await withNestApiServer(async (baseUrl) => {
    const session = await login(baseUrl);
    const changed = await requestJson(
      baseUrl,
      '/api/auth/change-password',
      {
        method: 'POST',
        token: session.token,
        body: {
          currentPassword:
            require('./helpers/phase1-api').BOOTSTRAP_ADMIN_PASSWORD,
          newPassword: 'ChangedPassword456',
        },
      },
    );
    assert.equal(changed.response.status, 200);
    assert.equal(typeof changed.body.data.token, 'string');

    const oldSession = await requestJson(baseUrl, '/api/auth/me', {
      token: session.token,
    });
    assertErrorContract(oldSession, 401, 'SESSION_REVOKED');

    const replacementSession = await requestJson(
      baseUrl,
      '/api/auth/me',
      {
        token: changed.body.data.token,
      },
    );
    assert.equal(replacementSession.response.status, 200);
  });
});

test('freeze, unfreeze, and reset never reactivate an older JWT', async () => {
  const userId = 'usr-session-lifecycle-target';
  const username = '13800000131';
  await withNestApiServer(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const target = await login(
        baseUrl,
        username,
        TARGET_PASSWORD,
      );

      const frozen = await requestJson(
        baseUrl,
        `/api/users/${userId}/disable`,
        {
          method: 'POST',
          token: admin.token,
          body: { reason: 'session lifecycle test' },
        },
      );
      assert.equal(frozen.response.status, 200);
      assertErrorContract(
        await requestJson(baseUrl, '/api/auth/me', {
          token: target.token,
        }),
        401,
        'SESSION_REVOKED',
      );

      const enabled = await requestJson(
        baseUrl,
        `/api/users/${userId}/enable`,
        {
          method: 'POST',
          token: admin.token,
          body: { reason: 'session lifecycle test' },
        },
      );
      assert.equal(enabled.response.status, 200);
      assertErrorContract(
        await requestJson(baseUrl, '/api/auth/me', {
          token: target.token,
        }),
        401,
        'SESSION_REVOKED',
      );

      const beforeReset = await login(
        baseUrl,
        username,
        TARGET_PASSWORD,
      );
      const code = await sendResetCode(
        baseUrl,
        admin.token,
        userId,
      );
      const reset = await requestJson(
        baseUrl,
        `/api/users/${userId}/reset-password`,
        {
          method: 'POST',
          token: admin.token,
          body: {
            verificationCode: code,
            newPassword: RESET_PASSWORD,
          },
        },
      );
      assert.equal(reset.response.status, 200);
      assert.equal(reset.body.data.user.mustChangePassword, false);
      assertErrorContract(
        await requestJson(baseUrl, '/api/auth/me', {
          token: beforeReset.token,
        }),
        401,
        'SESSION_REVOKED',
      );
      const afterReset = await login(
        baseUrl,
        username,
        RESET_PASSWORD,
      );
      assert.equal(afterReset.user.id, userId);
    },
    lifecycleOptions([targetUser(userId, username)]),
  );
});

test('a newly issued verification code immediately supersedes older codes', async () => {
  const userId = 'usr-sms-latest-target';
  const username = '13800000132';
  await withNestApiServer(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const firstCode = await sendResetCode(
        baseUrl,
        admin.token,
        userId,
      );
      let latestCode = await sendResetCode(
        baseUrl,
        admin.token,
        userId,
      );
      if (latestCode === firstCode) {
        latestCode = await sendResetCode(
          baseUrl,
          admin.token,
          userId,
        );
      }

      const superseded = await requestJson(
        baseUrl,
        `/api/users/${userId}/reset-password`,
        {
          method: 'POST',
          token: admin.token,
          body: {
            verificationCode: firstCode,
            newPassword: RESET_PASSWORD,
          },
        },
      );
      assertErrorContract(
        superseded,
        400,
        'SMS_CODE_NOT_CURRENT',
      );

      const latest = await requestJson(
        baseUrl,
        `/api/users/${userId}/reset-password`,
        {
          method: 'POST',
          token: admin.token,
          body: {
            verificationCode: latestCode,
            newPassword: RESET_PASSWORD,
          },
        },
      );
      assert.equal(latest.response.status, 200);
    },
    lifecycleOptions([targetUser(userId, username)]),
  );
});

test('concurrent consumption of one verification code succeeds at most once', async () => {
  const userId = 'usr-sms-single-use-target';
  const username = '13800000133';
  await withNestApiServer(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const code = await sendResetCode(
        baseUrl,
        admin.token,
        userId,
      );
      const reset = (newPassword) =>
        requestJson(
          baseUrl,
          `/api/users/${userId}/reset-password`,
          {
            method: 'POST',
            token: admin.token,
            body: {
              verificationCode: code,
              newPassword,
            },
          },
        );
      const results = await Promise.all([
        reset('ConcurrentPassword123'),
        reset('ConcurrentPassword456'),
      ]);
      assert.deepEqual(
        results.map((result) => result.response.status).sort(),
        [200, 400],
      );
      assertErrorContract(
        results.find((result) => result.response.status === 400),
        400,
        'SMS_CODE_NOT_CURRENT',
      );
    },
    lifecycleOptions([targetUser(userId, username)]),
  );
});

test('concurrent failed attempts increment without a lost update', async () => {
  const userId = 'usr-sms-attempt-target';
  const username = '13800000134';
  await withNestApiServer(
    async (baseUrl, context) => {
      const admin = await login(baseUrl);
      const code = await sendResetCode(
        baseUrl,
        admin.token,
        userId,
      );
      const wrongCodes = ['000000', '000001', '000002']
        .filter((candidate) => candidate !== code)
        .slice(0, 2);
      const results = await Promise.all(
        wrongCodes.map((verificationCode) =>
          requestJson(
            baseUrl,
            `/api/users/${userId}/reset-password`,
            {
              method: 'POST',
              token: admin.token,
              body: {
                verificationCode,
                newPassword: RESET_PASSWORD,
              },
            },
          ),
        ),
      );
      for (const result of results) {
        assertErrorContract(result, 400, 'SMS_CODE_INCORRECT');
      }
      const activeRecord =
        context.prisma.__store.smsVerificationCodes.find(
          (record) => record.activeKey,
        );
      assert.equal(activeRecord.attemptCount, 2);
    },
    lifecycleOptions([targetUser(userId, username)]),
  );
});

test('SMS debug responses are rejected outside the test environment', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDebug = process.env.SMS_VERIFICATION_DEBUG;
  process.env.NODE_ENV = 'production';
  process.env.SMS_VERIFICATION_DEBUG = 'true';
  try {
    assert.throws(
      () => new AliyunSmsNestService(),
      (error) => error?.code === 'SMS_DEBUG_CONFIG_INVALID',
    );
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousDebug === undefined) {
      delete process.env.SMS_VERIFICATION_DEBUG;
    } else {
      process.env.SMS_VERIFICATION_DEBUG = previousDebug;
    }
  }
});

test('schema migration adds session versioning and a unique active SMS key', () => {
  const schema = fs.readFileSync(
    path.join(__dirname, '../prisma/schema.prisma'),
    'utf8',
  );
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      '../prisma/migrations/20260720000200_session_version_sms_lifecycle/migration.sql',
    ),
    'utf8',
  );
  assert.match(schema, /tokenVersion\s+Int\s+@default\(0\)/);
  assert.match(schema, /activeKey\s+String\?\s+@unique/);
  assert.match(migration, /ADD COLUMN `token_version`/);
  assert.match(
    migration,
    /sms_verification_codes_active_key_key/,
  );
});
