const { createHttpError } = require('../../common/errors');
const { getBearerToken } = require('../../common/http');
const { createToken, verifyToken } = require('./token');
const { getRoleCatalog, getRoleDataScope, getRoleMenus, getRolePermissions } = require('./roles');
const { TEMPORARY_PASSWORD, hashPassword, verifyPassword } = require('./password');
const { createUserRepository, normalizeUsername } = require('../users/users.repository');
const { createOperationLogRepository } = require('../operation-logs/operation-log.repository');

function createAuthService(options = {}) {
  const userRepository = options.userRepository || createUserRepository();
  const operationLogRepository = options.operationLogRepository || createOperationLogRepository();
  const tokenSecret = options.tokenSecret;
  const tokenExpiresInSeconds = options.tokenExpiresInSeconds;

  return {
    login(credentials, metadata = {}) {
      const username = normalizeUsername(credentials?.username);
      const password = credentials?.password;
      if (!username || typeof password !== 'string') {
        throw createHttpError(400, 'LOGIN_FIELDS_REQUIRED', 'username and password are required.');
      }

      const user = userRepository.findByUsername(username);
      if (!user || !verifyPassword(password, user.passwordHash)) {
        throw createHttpError(401, 'INVALID_CREDENTIALS', 'Username or password is incorrect.');
      }
      if (!user.isActive) {
        throw createHttpError(403, 'ACCOUNT_DISABLED', 'This account has been disabled.');
      }

      const tokenResult = createToken(
        {
          sub: user.id,
          username: user.username,
          role: user.role,
        },
        {
          secret: tokenSecret,
          expiresInSeconds: tokenExpiresInSeconds,
        },
      );

      operationLogRepository.appendLog({
        userId: user.id,
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
        afterData: { username: user.username, role: user.role },
        ipAddress: metadata.ipAddress || null,
      });

      return {
        token: tokenResult.token,
        expiresAt: tokenResult.expiresAt,
        ...buildSessionPayload(user),
      };
    },

    authenticateRequest(request) {
      const token = getBearerToken(request);
      if (!token) {
        throw createHttpError(401, 'AUTH_TOKEN_REQUIRED', 'Authorization token is required.');
      }

      const payload = verifyToken(token, { secret: tokenSecret });
      const user = userRepository.findById(payload.sub);
      if (!user) {
        throw createHttpError(401, 'AUTH_USER_NOT_FOUND', 'Authorization user no longer exists.');
      }
      if (!user.isActive) {
        throw createHttpError(403, 'ACCOUNT_DISABLED', 'This account has been disabled.');
      }
      if (user.mustChangePassword && !isPasswordChangeAllowedPath(request)) {
        throw createHttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Password change is required before continuing.');
      }
      return user;
    },

    getSession(user) {
      return buildSessionPayload(user);
    },

    changePassword(user, patch, metadata = {}) {
      if (!verifyPassword(patch?.currentPassword, user.passwordHash)) {
        throw createHttpError(400, 'CURRENT_PASSWORD_INCORRECT', 'Current password is incorrect.');
      }
      if (patch?.newPassword === TEMPORARY_PASSWORD) {
        throw createHttpError(400, 'TEMPORARY_PASSWORD_NOT_ALLOWED', 'New password cannot be the temporary password.');
      }

      const nextUser = {
        ...user,
        passwordHash: hashPassword(patch.newPassword),
        mustChangePassword: false,
        updatedAt: new Date().toISOString(),
      };
      userRepository.saveUser(nextUser);

      operationLogRepository.appendLog({
        userId: user.id,
        action: 'auth.change_password',
        entityType: 'user',
        entityId: user.id,
        beforeData: { passwordChanged: false },
        afterData: { passwordChanged: true },
        ipAddress: metadata.ipAddress || null,
      });

      return buildSessionPayload(nextUser);
    },

    getRoleCatalog() {
      return getRoleCatalog();
    },

    requireAdmin(user) {
      if (!isAdminRole(user?.role)) {
        throw createHttpError(403, 'ADMIN_REQUIRED', 'Administrator permission is required.');
      }
    },

    requireAnyRole(user, roles) {
      if (!isRoleAllowed(user?.role, roles)) {
        throw createHttpError(403, 'PERMISSION_DENIED', 'You do not have permission to perform this action.');
      }
    },
  };
}

function buildSessionPayload(user) {
  return {
    user: toPublicUser(user),
    permissions: getRolePermissions(user.role),
    menus: getRoleMenus(user.role),
    dataScope: getRoleDataScope(user.role),
  };
}

function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    phone: user.phone,
    leaderId: user.leaderId,
    isActive: user.isActive,
    mustChangePassword: Boolean(user.mustChangePassword),
    statusReason: user.statusReason || null,
    statusChangedAt: user.statusChangedAt || null,
    statusChangedBy: user.statusChangedBy || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function isAdminRole(role) {
  return role === 'super_admin' || role === 'admin';
}

function isRoleAllowed(role, roles) {
  return roles.includes(role) || (role === 'super_admin' && roles.includes('admin'));
}

function isPasswordChangeAllowedPath(request) {
  const path = String(request?.path || request?.url || '');
  return path.includes('/auth/me') || path.includes('/auth/change-password');
}

module.exports = {
  createAuthService,
  toPublicUser,
};
