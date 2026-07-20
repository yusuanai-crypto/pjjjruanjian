const assert = require('node:assert/strict');
const test = require('node:test');

const { AuthNestService } = require('../src/modules/auth/auth.nest.service');
const { createToken, verifyToken } = require('../src/modules/auth/token');
const { resolveSeedConfig } = require('../prisma/seed');
const {
  TEST_AUTH_TOKEN_SECRET,
} = require('./helpers/phase1-api');

test('auth startup fails when AUTH_TOKEN_SECRET is missing', () => {
  withAuthTokenSecret(undefined, () => {
    assert.throws(
      () => new AuthNestService(null, null),
      hasErrorCode('AUTH_TOKEN_SECRET_REQUIRED'),
    );
  });
});

test('auth startup fails when AUTH_TOKEN_SECRET is weak', () => {
  withAuthTokenSecret('too-short', () => {
    assert.throws(
      () => new AuthNestService(null, null),
      hasErrorCode('AUTH_TOKEN_SECRET_TOO_SHORT'),
    );
  });
});

test('sample AUTH_TOKEN_SECRET values are rejected', () => {
  withAuthTokenSecret('<required-random-secret-at-least-32-bytes>', () => {
    assert.throws(
      () => new AuthNestService(null, null),
      hasErrorCode('AUTH_TOKEN_SECRET_PLACEHOLDER'),
    );
  });
});

test('an explicit test secret can sign and verify an auth token', () => {
  const result = createToken(
    {
      sub: 'test-user',
      role: 'sales',
      tokenVersion: 0,
    },
    {
      secret: TEST_AUTH_TOKEN_SECRET,
      expiresInSeconds: 60,
    },
  );

  const payload = verifyToken(result.token, {
    secret: TEST_AUTH_TOKEN_SECRET,
  });
  assert.equal(payload.sub, 'test-user');
  assert.equal(payload.role, 'sales');
  assert.equal(payload.tokenVersion, 0);
});

test('seed refuses to run without SEED_ADMIN_PASSWORD', () => {
  assert.throws(
    () => resolveSeedConfig({}),
    /SEED_ADMIN_PASSWORD must be configured/,
  );
});

test('seed does not create demo accounts by default', () => {
  const config = resolveSeedConfig({
    SEED_ADMIN_PASSWORD: 'test-only-seed-admin-password',
  });

  assert.equal(config.createDemoUsers, false);
  assert.equal(config.demoPassword, null);
});

test('seed requires a separate demo password when demo accounts are enabled', () => {
  assert.throws(
    () =>
      resolveSeedConfig({
        SEED_ADMIN_PASSWORD: 'test-only-seed-admin-password',
        SEED_CREATE_DEMO_USERS: 'true',
      }),
    /SEED_DEMO_PASSWORD must be configured/,
  );
});

function withAuthTokenSecret(value, run) {
  const previousValue = process.env.AUTH_TOKEN_SECRET;
  if (value === undefined) {
    delete process.env.AUTH_TOKEN_SECRET;
  } else {
    process.env.AUTH_TOKEN_SECRET = value;
  }
  try {
    run();
  } finally {
    if (previousValue === undefined) {
      delete process.env.AUTH_TOKEN_SECRET;
    } else {
      process.env.AUTH_TOKEN_SECRET = previousValue;
    }
  }
}

function hasErrorCode(code) {
  return (error) => error?.code === code;
}
