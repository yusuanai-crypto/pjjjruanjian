const { createHttpError } = require('../../common/errors');
const net = require('node:net');

const DEFAULT_OPERATION_LOG_PAGE = 1;
const DEFAULT_OPERATION_LOG_PAGE_SIZE = 50;
const MAX_OPERATION_LOG_PAGE_SIZE = 100;
const MAX_OPERATION_LOG_PAGE = 1_000_000;
const OPERATION_LOG_TYPES = Object.freeze([
  'CREATE',
  'READ',
  'UPDATE',
  'DELETE',
  'LOGIN',
  'LOGOUT',
  'IMPORT',
  'EXPORT',
  'UPLOAD',
  'DOWNLOAD',
  'REVIEW',
  'STATUS_CHANGE',
  'OTHER',
]);
const OPERATION_LOG_RESULTS = Object.freeze(['SUCCESS', 'FAILURE']);
const MAX_KEYWORD_LENGTH = 64;
const MAX_UNSCOPED_KEYWORD_RANGE_DAYS = 366;

function parseOperationLogPagination(input = {}) {
  return {
    page: parsePage(input.page),
    pageSize: parsePageSize(input.pageSize),
  };
}

function parsePage(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return DEFAULT_OPERATION_LOG_PAGE;
  }
  const parsed = Number(String(value).trim());
  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_OPERATION_LOG_PAGE
  ) {
    throw createHttpError(
      400,
      'OPERATION_LOG_PAGINATION_INVALID',
      `page must be an integer between 1 and ${MAX_OPERATION_LOG_PAGE}.`,
    );
  }
  return parsed;
}

function parsePageSize(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return DEFAULT_OPERATION_LOG_PAGE_SIZE;
  }
  const parsed = Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw createHttpError(
      400,
      'OPERATION_LOG_PAGINATION_INVALID',
      'pageSize must be a positive integer.',
    );
  }
  return Math.min(parsed, MAX_OPERATION_LOG_PAGE_SIZE);
}

function parseOperationLogFilters(input = {}) {
  const pagination = parseOperationLogPagination(input);
  const startTime = parseDate(input.startTime, 'startTime');
  const endTime = parseDate(input.endTime, 'endTime');
  if (startTime && endTime && startTime.getTime() > endTime.getTime()) {
    throw invalidFilter('startTime must be earlier than or equal to endTime.');
  }

  const operationType = parseEnum(
    input.operationType,
    OPERATION_LOG_TYPES,
    'operationType',
  );
  const result = parseEnum(
    input.result,
    OPERATION_LOG_RESULTS,
    'result',
  );
  const ipAddress = parseIpAddress(input.ipAddress);
  const archived = parseArchived(input.archived);
  const filters = {
    ...pagination,
    userId: parseBoundedString(input.userId, 'userId', 36),
    startTime,
    endTime,
    module: parseBoundedString(input.module, 'module', 100),
    operationType,
    action: parseBoundedString(input.action, 'action', 100),
    entityType: parseBoundedString(input.entityType, 'entityType', 100),
    entityId: parseBoundedString(input.entityId, 'entityId', 100),
    result,
    ipAddress,
    requestId: parseBoundedString(input.requestId, 'requestId', 64),
    keyword: parseKeyword(input.keyword),
    archived,
  };
  assertKeywordIsBounded(filters);
  return filters;
}

function parseOperationLogId(value) {
  const id = parseBoundedString(value, 'id', 36);
  if (!id) {
    throw invalidFilter('id is required.');
  }
  return id;
}

function parseDate(value, fieldName) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }
  const normalized = String(value).trim();
  if (
    normalized.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(
      normalized,
    )
  ) {
    throw invalidFilter(`${fieldName} must be a valid ISO-8601 date.`);
  }
  const date = new Date(normalized);
  if (
    Number.isNaN(date.getTime()) ||
    (!normalized.includes('T') &&
      date.toISOString().slice(0, 10) !== normalized)
  ) {
    throw invalidFilter(`${fieldName} must be a valid ISO-8601 date.`);
  }
  return date;
}

function parseEnum(value, allowedValues, fieldName) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }
  const normalized = String(value).trim().toUpperCase();
  if (!allowedValues.includes(normalized)) {
    throw invalidFilter(
      `${fieldName} must be one of: ${allowedValues.join(', ')}.`,
    );
  }
  return normalized;
}

function parseIpAddress(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }
  const normalized = String(value).trim();
  if (net.isIP(normalized) === 0) {
    throw invalidFilter('ipAddress must be a valid IPv4 or IPv6 address.');
  }
  return normalized.toLowerCase();
}

function parseArchived(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return false;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === 'history' || normalized === 'archived') {
    return true;
  }
  if (normalized === 'false' || normalized === 'online') {
    return false;
  }
  throw invalidFilter('archived must be true or false.');
}

function parseKeyword(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }
  const normalized = String(value).trim();
  if (normalized.length < 2 || normalized.length > MAX_KEYWORD_LENGTH) {
    throw invalidFilter(
      `keyword must contain between 2 and ${MAX_KEYWORD_LENGTH} characters.`,
    );
  }
  return normalized;
}

function parseBoundedString(value, fieldName, maximumLength) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }
  const normalized = String(value).trim();
  if (
    normalized.length > maximumLength ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw invalidFilter(
      `${fieldName} must contain at most ${maximumLength} safe characters.`,
    );
  }
  return normalized;
}

function assertKeywordIsBounded(filters) {
  if (!filters.keyword) {
    return;
  }
  if (
    filters.userId ||
    filters.module ||
    filters.operationType ||
    filters.action ||
    filters.entityType ||
    filters.entityId ||
    filters.result ||
    filters.ipAddress ||
    filters.requestId
  ) {
    return;
  }
  if (!filters.startTime || !filters.endTime) {
    throw createHttpError(
      400,
      'OPERATION_LOG_KEYWORD_SCOPE_REQUIRED',
      'keyword requires a time range or another indexed filter.',
    );
  }
  const rangeMs = filters.endTime.getTime() - filters.startTime.getTime();
  if (rangeMs > MAX_UNSCOPED_KEYWORD_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    throw createHttpError(
      400,
      'OPERATION_LOG_KEYWORD_SCOPE_REQUIRED',
      `An unscoped keyword time range cannot exceed ${MAX_UNSCOPED_KEYWORD_RANGE_DAYS} days.`,
    );
  }
}

function invalidFilter(message) {
  return createHttpError(
    400,
    'OPERATION_LOG_FILTER_INVALID',
    message,
  );
}

module.exports = {
  DEFAULT_OPERATION_LOG_PAGE,
  DEFAULT_OPERATION_LOG_PAGE_SIZE,
  MAX_OPERATION_LOG_PAGE,
  MAX_OPERATION_LOG_PAGE_SIZE,
  MAX_KEYWORD_LENGTH,
  OPERATION_LOG_RESULTS,
  OPERATION_LOG_TYPES,
  parseOperationLogFilters,
  parseOperationLogId,
  parseOperationLogPagination,
};
