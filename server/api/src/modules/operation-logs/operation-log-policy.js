const { createHttpError } = require('../../common/errors');

const DEFAULT_OPERATION_LOG_PAGE = 1;
const DEFAULT_OPERATION_LOG_PAGE_SIZE = 50;
const MAX_OPERATION_LOG_PAGE_SIZE = 100;
const MAX_OPERATION_LOG_PAGE = 1_000_000;

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

module.exports = {
  DEFAULT_OPERATION_LOG_PAGE,
  DEFAULT_OPERATION_LOG_PAGE_SIZE,
  MAX_OPERATION_LOG_PAGE,
  MAX_OPERATION_LOG_PAGE_SIZE,
  parseOperationLogPagination,
};
