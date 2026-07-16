const { createHttpError } = require('../../common/errors');
const { createOperationLogRepository } = require('../operation-logs/operation-log.repository');
const { createSystemSettingsRepository } = require('./settings.repository');

function createSettingsService(options = {}) {
  const settingsRepository = options.settingsRepository || createSystemSettingsRepository();
  const operationLogRepository = options.operationLogRepository || createOperationLogRepository();

  return {
    getGlobalMarkQuery() {
      return settingsRepository.getGlobalMarkQuery();
    },

    enableGlobalMarkQuery(actor, metadata = {}) {
      requireAnyRole(actor, ['admin', 'boss', 'front_desk', 'after_sales']);
      const current = settingsRepository.getGlobalMarkQuery();
      const now = new Date().toISOString();
      const nextSettings = {
        ...current,
        onlyShowMarkedRecords: true,
        restoreRequired: true,
        openedBy: actor.id,
        openedAt: current.openedAt || now,
        restoredBy: null,
        restoredAt: null,
        updatedAt: now,
      };

      const saved = settingsRepository.saveGlobalMarkQuery(nextSettings);
      operationLogRepository.appendLog({
        userId: actor.id,
        action: 'settings.global_mark.enable',
        entityType: 'system_setting',
        entityId: 'global_mark_query',
        beforeData: current,
        afterData: saved,
        ipAddress: metadata.ipAddress || null,
      });
      return saved;
    },

    restoreGlobalMarkQuery(actor, metadata = {}) {
      requireAdmin(actor);
      const current = settingsRepository.getGlobalMarkQuery();
      const now = new Date().toISOString();
      const nextSettings = {
        ...current,
        onlyShowMarkedRecords: false,
        restoreRequired: false,
        restoredBy: actor.id,
        restoredAt: now,
        updatedAt: now,
      };

      const saved = settingsRepository.saveGlobalMarkQuery(nextSettings);
      operationLogRepository.appendLog({
        userId: actor.id,
        action: 'settings.global_mark.restore',
        entityType: 'system_setting',
        entityId: 'global_mark_query',
        beforeData: current,
        afterData: saved,
        ipAddress: metadata.ipAddress || null,
      });
      return saved;
    },
  };
}

function requireAdmin(actor) {
  if (!actor || !isAdminRole(actor.role)) {
    throw createHttpError(403, 'ADMIN_REQUIRED', 'Administrator permission is required.');
  }
}

function requireAnyRole(actor, roles) {
  if (!actor || !isRoleAllowed(actor.role, roles)) {
    throw createHttpError(403, 'PERMISSION_DENIED', 'You do not have permission to perform this action.');
  }
}

function isAdminRole(role) {
  return role === 'super_admin' || role === 'admin';
}

function isRoleAllowed(role, roles) {
  return roles.includes(role) || (role === 'super_admin' && roles.includes('admin'));
}

module.exports = {
  createSettingsService,
};
