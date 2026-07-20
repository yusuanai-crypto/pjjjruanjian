const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  sanitizeOperationLogData,
} = require('./audit-data-sanitizer');
const {
  parseOperationLogPagination,
} = require('./operation-log-policy');

const DEFAULT_STORE_PATH = path.resolve(__dirname, '../../../data/operation-logs.json');

function createOperationLogRepository(storePath = process.env.PHASE1_OPERATION_LOG_STORE || DEFAULT_STORE_PATH) {
  return {
    appendLog(log) {
      const state = readState(storePath);
      const sanitized = sanitizeOperationLogData(log);
      const nextLog = normalizeLog({
        ...log,
        beforeData: sanitized.beforeData,
        afterData: sanitized.afterData,
        sanitizationSummary: sanitized.sanitizationSummary,
        id: log.id || crypto.randomUUID(),
        createdAt: log.createdAt || new Date().toISOString(),
      });
      state.logs.push(nextLog);
      writeState(storePath, state);
      return nextLog;
    },

    listLogs(filters = {}) {
      const { page, pageSize } = parseOperationLogPagination(filters);
      const logs = readState(storePath).logs.filter((log) => {
        if (filters.action && log.action !== filters.action) {
          return false;
        }
        if (filters.entityType && log.entityType !== filters.entityType) {
          return false;
        }
        if (filters.userId && log.userId !== filters.userId) {
          return false;
        }
        return true;
      });
      logs.sort(
        (left, right) =>
          new Date(left.createdAt).getTime() -
          new Date(right.createdAt).getTime(),
      );
      const total = logs.length;
      const start = (page - 1) * pageSize;
      return {
        logs: logs.slice(start, start + pageSize).map(toPublicLog),
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      };
    },
  };
}

function readState(storePath) {
  ensureStore(storePath);
  const raw = fs.readFileSync(storePath, 'utf8');
  return normalizeState(JSON.parse(raw));
}

function writeState(storePath, state) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(normalizeState(state), null, 2)}\n`, 'utf8');
}

function ensureStore(storePath) {
  if (fs.existsSync(storePath)) {
    return;
  }
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify({ logs: [] }, null, 2)}\n`, 'utf8');
}

function normalizeState(state) {
  return {
    logs: Array.isArray(state?.logs) ? state.logs.map(normalizeLog) : [],
  };
}

function normalizeLog(log) {
  return {
    id: String(log.id),
    userId: log.userId || log.user_id || null,
    action: String(log.action || '').trim(),
    entityType: String(log.entityType || log.entity_type || '').trim(),
    entityId: log.entityId || log.entity_id || null,
    beforeData: log.beforeData ?? log.before_data ?? null,
    afterData: log.afterData ?? log.after_data ?? null,
    sanitizationSummary:
      log.sanitizationSummary ?? log.sanitization_summary ?? null,
    ipAddress: log.ipAddress || log.ip_address || null,
    createdAt: log.createdAt || log.created_at || new Date().toISOString(),
  };
}

function toPublicLog(log) {
  const { sanitizationSummary, ...publicLog } = log;
  return publicLog;
}

module.exports = {
  createOperationLogRepository,
};
