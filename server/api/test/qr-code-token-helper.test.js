const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildQrCodeTokenRecord,
  buildQrCodeTokenFingerprint,
  calculateQrCodeExpiresAt,
  generateQrCodeToken,
  getConfiguredPublicSalesSheetBaseUrl,
  hashQrCodeToken,
  hasReusableQrCodeToken,
  isQrCodeTokenUnexpired,
} = require('../src/modules/business-data/qr-code-token.helper');

test('unit: QR code token uses crypto base64url-safe random strings', () => {
  const tokens = new Set();

  for (let index = 0; index < 100; index += 1) {
    const token = generateQrCodeToken();
    assert.match(token, /^[A-Za-z0-9_-]+$/);
    assert.equal(token.includes('='), false);
    assert.equal(token.length, 32);
    tokens.add(token);
  }

  assert.equal(tokens.size, 100);
});

test('unit: QR code expiration defaults to 30 days when expiresInDays is empty', () => {
  const now = new Date('2026-07-01T10:00:00.000Z');
  const previous = process.env.PUBLIC_SALES_SHEET_DEFAULT_TTL_DAYS;
  delete process.env.PUBLIC_SALES_SHEET_DEFAULT_TTL_DAYS;

  try {
    for (const value of [undefined, null, '']) {
      assert.equal(
        calculateQrCodeExpiresAt(value, now).toISOString(),
        '2026-07-31T10:00:00.000Z',
      );
    }
  } finally {
    restoreEnv('PUBLIC_SALES_SHEET_DEFAULT_TTL_DAYS', previous);
  }
});

test('unit: QR code expiration adds integer days from current time', () => {
  const now = new Date('2026-07-01T10:00:00.000Z');

  assert.equal(
    calculateQrCodeExpiresAt(1, now).toISOString(),
    '2026-07-02T10:00:00.000Z',
  );
  assert.equal(
    calculateQrCodeExpiresAt('30', now).toISOString(),
    '2026-07-31T10:00:00.000Z',
  );
  assert.equal(
    calculateQrCodeExpiresAt(90, now).toISOString(),
    '2026-09-29T10:00:00.000Z',
  );
});

test('unit: QR code default TTL configuration is bounded and validated', () => {
  const previous = process.env.PUBLIC_SALES_SHEET_DEFAULT_TTL_DAYS;
  const now = new Date('2026-07-01T10:00:00.000Z');
  try {
    process.env.PUBLIC_SALES_SHEET_DEFAULT_TTL_DAYS = '14';
    assert.equal(
      calculateQrCodeExpiresAt(undefined, now).toISOString(),
      '2026-07-15T10:00:00.000Z',
    );

    for (const invalid of ['0', '91', 'not-a-number']) {
      process.env.PUBLIC_SALES_SHEET_DEFAULT_TTL_DAYS = invalid;
      assert.throws(
        () => calculateQrCodeExpiresAt(undefined, now),
        (error) => {
          assert.equal(error.statusCode, 500);
          assert.equal(error.code, 'PUBLIC_SALES_SHEET_TTL_CONFIG_INVALID');
          return true;
        },
      );
    }
  } finally {
    restoreEnv('PUBLIC_SALES_SHEET_DEFAULT_TTL_DAYS', previous);
  }
});

test('unit: QR code helper returns token record with generatedAt and expiresAt', () => {
  const now = new Date('2026-07-01T10:00:00.000Z');
  const record = buildQrCodeTokenRecord(7, now);

  assert.match(record.token, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(record.generatedAt.toISOString(), '2026-07-01T10:00:00.000Z');
  assert.equal(record.expiresAt.toISOString(), '2026-07-08T10:00:00.000Z');
});

test('unit: QR code expiration rejects invalid expiresInDays with project error contract', () => {
  for (const value of [0, -1, 91, 1.5, 'abc', {}, []]) {
    assert.throws(
      () => calculateQrCodeExpiresAt(value, new Date('2026-07-01T00:00:00.000Z')),
      (error) => {
        assert.equal(error.statusCode, 400);
        assert.equal(error.code, 'VALIDATION_FAILED');
        assert.match(error.message, /expiresInDays/);
        return true;
      },
    );
  }
});

test('unit: QR code token reuse requires an existing unexpired token', () => {
  const now = new Date('2026-07-01T10:00:00.000Z');

  assert.equal(hasReusableQrCodeToken('token', null, now), false);
  assert.equal(
    hasReusableQrCodeToken('token', '2026-07-01T10:00:01.000Z', now),
    true,
  );
  assert.equal(
    hasReusableQrCodeToken('token', new Date('2026-07-01T10:00:00.000Z'), now),
    false,
  );
  assert.equal(
    hasReusableQrCodeToken('token', '2026-07-01T09:59:59.000Z', now),
    false,
  );
  assert.equal(hasReusableQrCodeToken('', null, now), false);
  assert.equal(hasReusableQrCodeToken(null, null, now), false);
});

test('unit: QR code unexpired helper rejects missing expiration', () => {
  const now = new Date('2026-07-01T10:00:00.000Z');

  assert.equal(isQrCodeTokenUnexpired(null, now), false);
  assert.equal(isQrCodeTokenUnexpired(undefined, now), false);
  assert.equal(isQrCodeTokenUnexpired('2026-07-02T10:00:00.000Z', now), true);
  assert.equal(isQrCodeTokenUnexpired('2026-06-30T10:00:00.000Z', now), false);
  assert.equal(isQrCodeTokenUnexpired('not-a-date', now), false);
});

test('unit: QR code tokens are stored as hashes and logs use only a short fingerprint', () => {
  const token = generateQrCodeToken();
  const hash = hashQrCodeToken(token);

  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, token);
  assert.equal(buildQrCodeTokenFingerprint(hash), hash.slice(0, 16));
  assert.equal(buildQrCodeTokenFingerprint(token), null);
});

test('unit: QR code base URL must be explicitly configured as safe HTTPS', () => {
  const previous = process.env.PUBLIC_SALES_SHEET_BASE_URL;
  try {
    delete process.env.PUBLIC_SALES_SHEET_BASE_URL;
    assert.equal(getConfiguredPublicSalesSheetBaseUrl(), null);
    assert.throws(
      () => getConfiguredPublicSalesSheetBaseUrl({ required: true }),
      (error) => error.code === 'PUBLIC_SALES_SHEET_BASE_URL_UNSAFE',
    );

    for (const unsafe of [
      'http://public.example.test',
      'https://127.0.0.1',
      'https://8.8.8.8',
      'https://single-label',
      'https://user:pass@public.example.test',
      'https://public.example.test?token=value',
      'https://public.example.test/#fragment',
    ]) {
      process.env.PUBLIC_SALES_SHEET_BASE_URL = unsafe;
      assert.throws(
        () => getConfiguredPublicSalesSheetBaseUrl({ required: true }),
        (error) => error.code === 'PUBLIC_SALES_SHEET_BASE_URL_UNSAFE',
      );
    }

    process.env.PUBLIC_SALES_SHEET_BASE_URL =
      'https://public.example.test/sheets/';
    assert.equal(
      getConfiguredPublicSalesSheetBaseUrl({ required: true }),
      'https://public.example.test/sheets',
    );
  } finally {
    restoreEnv('PUBLIC_SALES_SHEET_BASE_URL', previous);
  }
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
