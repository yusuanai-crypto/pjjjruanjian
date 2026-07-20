const MIN_AUTH_TOKEN_SECRET_BYTES = 32;

function getAuthTokenSecret(options = {}) {
  const configuredSecret =
    options.secret === undefined
      ? process.env.AUTH_TOKEN_SECRET
      : options.secret;

  return validateAuthTokenSecret(configuredSecret);
}

function validateAuthTokenSecret(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw createSecretConfigurationError(
      'AUTH_TOKEN_SECRET_REQUIRED',
      'AUTH_TOKEN_SECRET must be configured.',
    );
  }

  const normalizedValue = value.trim();
  if (isPlaceholderSecret(normalizedValue)) {
    throw createSecretConfigurationError(
      'AUTH_TOKEN_SECRET_PLACEHOLDER',
      'AUTH_TOKEN_SECRET must not use a sample or placeholder value.',
    );
  }

  if (Buffer.byteLength(value, 'utf8') < MIN_AUTH_TOKEN_SECRET_BYTES) {
    throw createSecretConfigurationError(
      'AUTH_TOKEN_SECRET_TOO_SHORT',
      `AUTH_TOKEN_SECRET must be at least ${MIN_AUTH_TOKEN_SECRET_BYTES} bytes.`,
    );
  }

  return value;
}

function isPlaceholderSecret(value) {
  return (
    /^<[^>]+>$/.test(value) ||
    /^(?:change|replace|example|sample|placeholder|your)(?:[-_\s]|$)/i.test(value) ||
    /(?:^|[-_\s])change[-_\s]me$/i.test(value)
  );
}

function createSecretConfigurationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = {
  MIN_AUTH_TOKEN_SECRET_BYTES,
  getAuthTokenSecret,
  validateAuthTokenSecret,
};
