const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildQrCodeTokenRecord,
  calculateQrCodeExpiresAt,
  generateQrCodeToken,
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

test('unit: QR code expiration is null when expiresInDays is empty', () => {
  const now = new Date('2026-07-01T10:00:00.000Z');

  assert.equal(calculateQrCodeExpiresAt(undefined, now), null);
  assert.equal(calculateQrCodeExpiresAt(null, now), null);
  assert.equal(calculateQrCodeExpiresAt('', now), null);
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
    calculateQrCodeExpiresAt(3650, now).toISOString(),
    '2036-06-28T10:00:00.000Z',
  );
});

test('unit: QR code helper returns token record with generatedAt and expiresAt', () => {
  const now = new Date('2026-07-01T10:00:00.000Z');
  const record = buildQrCodeTokenRecord(7, now);

  assert.match(record.token, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(record.generatedAt.toISOString(), '2026-07-01T10:00:00.000Z');
  assert.equal(record.expiresAt.toISOString(), '2026-07-08T10:00:00.000Z');
});

test('unit: QR code expiration rejects invalid expiresInDays with project error contract', () => {
  for (const value of [0, -1, 3651, 1.5, 'abc', {}, []]) {
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

  assert.equal(hasReusableQrCodeToken('token', null, now), true);
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

test('unit: QR code unexpired helper treats null expiration as long-lived', () => {
  const now = new Date('2026-07-01T10:00:00.000Z');

  assert.equal(isQrCodeTokenUnexpired(null, now), true);
  assert.equal(isQrCodeTokenUnexpired(undefined, now), true);
  assert.equal(isQrCodeTokenUnexpired('2026-07-02T10:00:00.000Z', now), true);
  assert.equal(isQrCodeTokenUnexpired('2026-06-30T10:00:00.000Z', now), false);
  assert.equal(isQrCodeTokenUnexpired('not-a-date', now), false);
});
