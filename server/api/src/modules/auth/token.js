const crypto = require('node:crypto');
const { createHttpError } = require('../../common/errors');
const { getAuthTokenSecret } = require('./auth-token-secret');

const DEFAULT_TOKEN_EXPIRES_IN_SECONDS = 8 * 60 * 60;

function createToken(payload, options = {}) {
  const secret = getTokenSecret(options);
  const now = Math.floor(Date.now() / 1000);
  const expiresInSeconds = options.expiresInSeconds || DEFAULT_TOKEN_EXPIRES_IN_SECONDS;
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };
  const tokenPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };
  const encodedHeader = encodeJson(header);
  const encodedPayload = encodeJson(tokenPayload);
  const signature = sign(`${encodedHeader}.${encodedPayload}`, secret);

  return {
    token: `${encodedHeader}.${encodedPayload}.${signature}`,
    expiresAt: new Date(tokenPayload.exp * 1000).toISOString(),
  };
}

function verifyToken(token, options = {}) {
  const secret = getTokenSecret(options);
  if (typeof token !== 'string') {
    throw createTokenError('AUTH_TOKEN_REQUIRED', 'Authorization token is required.');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw createTokenError('INVALID_AUTH_TOKEN', 'Authorization token is invalid.');
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSignature = sign(`${encodedHeader}.${encodedPayload}`, secret);
  if (!timingSafeStringEqual(signature, expectedSignature)) {
    throw createTokenError('INVALID_AUTH_TOKEN', 'Authorization token is invalid.');
  }

  const header = decodeJson(encodedHeader);
  if (header.alg !== 'HS256' || header.typ !== 'JWT') {
    throw createTokenError('INVALID_AUTH_TOKEN', 'Authorization token is invalid.');
  }

  const payload = decodeJson(encodedPayload);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(payload.exp) || payload.exp <= now) {
    throw createTokenError('AUTH_TOKEN_EXPIRED', 'Authorization token has expired.');
  }

  return payload;
}

function getTokenSecret(options) {
  return getAuthTokenSecret({
    secret: options.secret,
  });
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeJson(value) {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch (error) {
    throw createTokenError('INVALID_AUTH_TOKEN', 'Authorization token is invalid.');
  }
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function timingSafeStringEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createTokenError(code, message) {
  return createHttpError(401, code, message);
}

module.exports = {
  createToken,
  verifyToken,
};
