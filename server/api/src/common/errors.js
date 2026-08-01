const EXPECTED_HTTP_ERROR = Symbol.for('jiangjiu.expectedHttpError');
const GENERIC_SERVER_ERROR_MESSAGE = 'Unexpected server error.';

const PRISMA_ERROR_MAPPINGS = Object.freeze({
  P2002: {
    statusCode: 409,
    code: 'UNIQUE_CONSTRAINT_CONFLICT',
    message: 'A record with the same unique value already exists.',
  },
  P2003: {
    statusCode: 409,
    code: 'FOREIGN_KEY_CONFLICT',
    message: 'The requested operation conflicts with a related record.',
  },
  P2022: {
    statusCode: 503,
    code: 'DATABASE_SCHEMA_MISMATCH',
    message: '数据库结构暂不可用，请联系管理员处理。',
  },
  P2025: {
    statusCode: 404,
    code: 'RECORD_NOT_FOUND',
    message: 'The requested record does not exist.',
  },
  P2034: {
    statusCode: 409,
    code: 'TRANSACTION_CONFLICT',
    message: 'The request conflicted with another update. Please retry.',
  },
});

const FILE_ERROR_MAPPINGS = Object.freeze({
  ENOENT: {
    statusCode: 404,
    code: 'FILE_NOT_FOUND',
    message: 'The requested file does not exist.',
  },
  EACCES: {
    statusCode: 500,
    code: 'FILE_OPERATION_FAILED',
  },
  EPERM: {
    statusCode: 500,
    code: 'FILE_OPERATION_FAILED',
  },
  EIO: {
    statusCode: 500,
    code: 'FILE_OPERATION_FAILED',
  },
  ENOSPC: {
    statusCode: 503,
    code: 'FILE_STORAGE_UNAVAILABLE',
  },
});

function createHttpError(statusCode, code, message, options = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  Object.defineProperty(error, EXPECTED_HTTP_ERROR, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  if (Number.isInteger(options.retryAfterSeconds) && options.retryAfterSeconds > 0) {
    error.retryAfterSeconds = options.retryAfterSeconds;
  }
  if (options.cause !== undefined) {
    error.cause = options.cause;
  }
  if (Array.isArray(options.missingFields)) {
    error.missingFields = options.missingFields.filter(
      (field) => typeof field === 'string' && field.length > 0,
    );
  }
  return error;
}

function isExpectedHttpError(error) {
  return Boolean(error && typeof error === 'object' && error[EXPECTED_HTTP_ERROR] === true);
}

function mapErrorToPublicResponse(error) {
  const infrastructureError = mapInfrastructureError(error);
  if (infrastructureError) {
    return {
      ...infrastructureError,
      retryAfterSeconds: null,
      includeRequestId: infrastructureError.statusCode >= 500,
      shouldLog: true,
    };
  }

  if (!isExpectedHttpError(error)) {
    return internalErrorResponse();
  }

  const statusCode = normalizeHttpErrorStatus(error.statusCode);
  if (statusCode === null) {
    return internalErrorResponse();
  }

  const code = normalizeErrorCode(
    error.code,
    statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED',
  );
  if (statusCode >= 500) {
    return {
      statusCode,
      code,
      message: GENERIC_SERVER_ERROR_MESSAGE,
      retryAfterSeconds: null,
      includeRequestId: true,
      shouldLog: true,
    };
  }

  return {
    statusCode,
    code,
    message:
      typeof error.message === 'string' && error.message
        ? error.message
        : defaultClientMessage(statusCode),
    retryAfterSeconds:
      statusCode === 429 ? normalizeRetryAfter(error.retryAfterSeconds) : null,
    includeRequestId: false,
    shouldLog: false,
    missingFields: Array.isArray(error.missingFields)
      ? error.missingFields.slice(0, 50)
      : null,
  };
}

function mapInfrastructureError(error) {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const prismaMapping = PRISMA_ERROR_MAPPINGS[error.code];
  if (prismaMapping) {
    return { ...prismaMapping };
  }

  const fileMapping = FILE_ERROR_MAPPINGS[error.code];
  if (fileMapping) {
    return {
      ...fileMapping,
      message: fileMapping.message || GENERIC_SERVER_ERROR_MESSAGE,
    };
  }

  return null;
}

function sanitizeErrorForLogging(error) {
  if (!error || typeof error !== 'object' || error.code !== 'P2022') {
    return error;
  }

  // Prisma P2022 messages and metadata can contain table names, column names,
  // SQL fragments, and connection details. The correlation ID and stable
  // Prisma/public error codes are sufficient to diagnose a schema mismatch
  // without copying those details into application or PM2 logs.
  return {
    name: 'PrismaClientKnownRequestError',
    code: 'P2022',
  };
}

function internalErrorResponse() {
  return {
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    message: GENERIC_SERVER_ERROR_MESSAGE,
    retryAfterSeconds: null,
    includeRequestId: true,
    shouldLog: true,
  };
}

function normalizeHttpErrorStatus(value) {
  return Number.isInteger(value) && value >= 400 && value <= 599 ? value : null;
}

function normalizeErrorCode(value, fallback) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(value)
    ? value
    : fallback;
}

function normalizeRetryAfter(value) {
  return Number.isInteger(value) && value > 0
    ? Math.min(value, 86400)
    : null;
}

function defaultClientMessage(statusCode) {
  if (statusCode === 400) {
    return 'The request is invalid.';
  }
  if (statusCode === 401) {
    return 'Authentication is required.';
  }
  if (statusCode === 403) {
    return 'Permission is denied.';
  }
  if (statusCode === 404) {
    return 'The requested resource does not exist.';
  }
  if (statusCode === 409) {
    return 'The request conflicts with the current resource state.';
  }
  if (statusCode === 413) {
    return 'The request is too large.';
  }
  if (statusCode === 429) {
    return 'Too many requests.';
  }
  return 'The request could not be processed.';
}

module.exports = {
  EXPECTED_HTTP_ERROR,
  GENERIC_SERVER_ERROR_MESSAGE,
  createHttpError,
  isExpectedHttpError,
  mapErrorToPublicResponse,
  sanitizeErrorForLogging,
};
