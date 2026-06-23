const crypto = require('node:crypto');

const PASSWORD_HASH_VERSION = 'pbkdf2_sha256';
const PASSWORD_ITERATIONS = 120000;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = 'sha256';
const MIN_PASSWORD_LENGTH = 8;

function hashPassword(password) {
  assertPasswordPolicy(password);
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto
    .pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST)
    .toString('base64url');
  return `${PASSWORD_HASH_VERSION}$${PASSWORD_ITERATIONS}$${salt}$${hash}`;
}

function verifyPassword(password, passwordHash) {
  if (typeof password !== 'string' || typeof passwordHash !== 'string') {
    return false;
  }

  const [version, iterationsText, salt, expectedHash] = passwordHash.split('$');
  if (version !== PASSWORD_HASH_VERSION || !salt || !expectedHash) {
    return false;
  }

  const iterations = Number(iterationsText);
  if (!Number.isInteger(iterations) || iterations <= 0) {
    return false;
  }

  const actualHash = crypto
    .pbkdf2Sync(password, salt, iterations, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST)
    .toString('base64url');

  const expectedBuffer = Buffer.from(expectedHash);
  const actualBuffer = Buffer.from(actualHash);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function assertPasswordPolicy(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw createPasswordPolicyError();
  }
}

function createPasswordPolicyError() {
  const error = new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  error.statusCode = 400;
  error.code = 'WEAK_PASSWORD';
  return error;
}

module.exports = {
  assertPasswordPolicy,
  hashPassword,
  verifyPassword,
};
