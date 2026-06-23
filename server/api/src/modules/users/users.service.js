const crypto = require('node:crypto');

const { createHttpError } = require('../../common/errors');
const { hashPassword } = require('../auth/password');
const { getRoleMenus, getRolePermissions, isValidRole } = require('../auth/roles');
const { toPublicUser } = require('../auth/auth.service');
const { createOperationLogRepository } = require('../operation-logs/operation-log.repository');
const { createUserRepository, normalizeUsername } = require('./users.repository');

function createUsersService(options = {}) {
  const userRepository = options.userRepository || createUserRepository();
  const operationLogRepository = options.operationLogRepository || createOperationLogRepository();

  return {
    listUsers(actor) {
      requireAdmin(actor);
      return userRepository.listUsers().map(toPublicUser);
    },

    getUser(actor, id) {
      requireAdmin(actor);
      const user = findUserOrThrow(userRepository, id);
      return toPublicUser(user);
    },

    createUser(actor, payload, metadata = {}) {
      requireAdmin(actor);
      const now = new Date().toISOString();
      const username = validateUsername(payload?.username);
      if (userRepository.findByUsername(username)) {
        throw createHttpError(409, 'USERNAME_EXISTS', 'Username already exists.');
      }

      const user = {
        id: crypto.randomUUID(),
        name: validateName(payload?.name),
        username,
        passwordHash: hashPassword(payload?.password),
        role: validateRole(payload?.role),
        phone: normalizeOptionalString(payload?.phone),
        leaderId: normalizeOptionalString(payload?.leaderId),
        isActive: payload?.isActive === undefined ? true : Boolean(payload.isActive),
        createdAt: now,
        updatedAt: now,
      };

      userRepository.saveUser(user);
      operationLogRepository.appendLog({
        userId: actor.id,
        action: 'users.create',
        entityType: 'user',
        entityId: user.id,
        afterData: toPublicUser(user),
        ipAddress: metadata.ipAddress || null,
      });

      return {
        user: toPublicUser(user),
        permissions: getRolePermissions(user.role),
        menus: getRoleMenus(user.role),
      };
    },

    updateUser(actor, id, patch, metadata = {}) {
      requireAdmin(actor);
      const current = findUserOrThrow(userRepository, id);
      const nextUser = {
        ...current,
        name: patch.name === undefined ? current.name : validateName(patch.name),
        role: patch.role === undefined ? current.role : validateRole(patch.role),
        phone: patch.phone === undefined ? current.phone : normalizeOptionalString(patch.phone),
        leaderId: patch.leaderId === undefined ? current.leaderId : normalizeOptionalString(patch.leaderId),
        isActive: patch.isActive === undefined ? current.isActive : Boolean(patch.isActive),
        updatedAt: new Date().toISOString(),
      };

      userRepository.saveUser(nextUser);
      operationLogRepository.appendLog({
        userId: actor.id,
        action: 'users.update',
        entityType: 'user',
        entityId: nextUser.id,
        beforeData: toPublicUser(current),
        afterData: toPublicUser(nextUser),
        ipAddress: metadata.ipAddress || null,
      });

      return toPublicUser(nextUser);
    },

    setUserActive(actor, id, isActive, metadata = {}) {
      requireAdmin(actor);
      if (actor.id === id && !isActive) {
        throw createHttpError(400, 'CANNOT_DISABLE_SELF', 'Administrators cannot disable their own account.');
      }

      const current = findUserOrThrow(userRepository, id);
      const nextUser = {
        ...current,
        isActive,
        updatedAt: new Date().toISOString(),
      };
      userRepository.saveUser(nextUser);

      operationLogRepository.appendLog({
        userId: actor.id,
        action: isActive ? 'users.enable' : 'users.disable',
        entityType: 'user',
        entityId: nextUser.id,
        beforeData: { isActive: current.isActive },
        afterData: { isActive: nextUser.isActive },
        ipAddress: metadata.ipAddress || null,
      });

      return toPublicUser(nextUser);
    },

    resetPassword(actor, id, patch, metadata = {}) {
      requireAdmin(actor);
      const current = findUserOrThrow(userRepository, id);
      const nextUser = {
        ...current,
        passwordHash: hashPassword(patch?.newPassword),
        updatedAt: new Date().toISOString(),
      };
      userRepository.saveUser(nextUser);

      operationLogRepository.appendLog({
        userId: actor.id,
        action: 'users.reset_password',
        entityType: 'user',
        entityId: nextUser.id,
        beforeData: { passwordReset: false },
        afterData: { passwordReset: true },
        ipAddress: metadata.ipAddress || null,
      });

      return toPublicUser(nextUser);
    },
  };
}

function requireAdmin(actor) {
  if (!actor || actor.role !== 'admin') {
    throw createHttpError(403, 'ADMIN_REQUIRED', 'Administrator permission is required.');
  }
}

function findUserOrThrow(userRepository, id) {
  const user = userRepository.findById(id);
  if (!user) {
    throw createHttpError(404, 'USER_NOT_FOUND', 'User does not exist.');
  }
  return user;
}

function validateUsername(username) {
  const normalized = normalizeUsername(username);
  if (!/^[a-z0-9._-]{3,50}$/.test(normalized)) {
    throw createHttpError(400, 'INVALID_USERNAME', 'username must be 3-50 characters and use letters, numbers, dot, underscore, or dash.');
  }
  return normalized;
}

function validateName(name) {
  const normalized = String(name || '').trim();
  if (!normalized) {
    throw createHttpError(400, 'NAME_REQUIRED', 'name is required.');
  }
  if (normalized.length > 100) {
    throw createHttpError(400, 'NAME_TOO_LONG', 'name must be 100 characters or fewer.');
  }
  return normalized;
}

function validateRole(role) {
  const normalized = String(role || '').trim();
  if (!isValidRole(normalized)) {
    throw createHttpError(400, 'INVALID_ROLE', 'role is invalid.');
  }
  return normalized;
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

module.exports = {
  createUsersService,
};
