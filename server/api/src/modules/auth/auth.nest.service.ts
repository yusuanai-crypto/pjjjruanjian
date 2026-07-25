import { Injectable } from '@nestjs/common';

import { createHttpError } from '../../common/errors';
import { getBearerToken } from '../../common/http';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import { AuditContextService } from '../operation-logs/audit-context.service';
import { UsersNestService, toPublicUser } from '../users/users.nest.service';
import { getAuthTokenSecret } from './auth-token-secret';
import { createToken, verifyToken } from './token';
import { getRoleCatalog, getRoleDataScope, getRoleMenus, getRolePermissions } from './roles';
import { hashPassword, verifyPassword } from './password';
import { normalizeUsername } from '../users/users.repository';
import { RefreshSessionNestService } from './refresh-session.nest.service';

@Injectable()
export class AuthNestService {
  constructor(
    private readonly usersService: UsersNestService,
    private readonly operationLogsService: OperationLogsNestService,
    private readonly rateLimitService: RateLimitService,
    private readonly refreshSessionsService: RefreshSessionNestService,
    private readonly auditContext?: AuditContextService,
  ) {
    getAuthTokenSecret();
  }

  async login(credentials: any, metadata: any = {}) {
    const username = normalizeUsername(credentials?.username);
    const password = credentials?.password;
    if (!username || typeof password !== 'string') {
      throw createHttpError(400, 'LOGIN_FIELDS_REQUIRED', 'username and password are required.');
    }

    await this.rateLimitService.enforceLogin({
      ipAddress: metadata.ipAddress || null,
      username,
    });

    const user = await this.usersService.findUserByUsername(username);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw createHttpError(401, 'INVALID_CREDENTIALS', 'Username or password is incorrect.');
    }
    if (!user.isActive) {
      throw createHttpError(403, 'ACCOUNT_DISABLED', 'This account has been disabled.');
    }

    const sessionResult = await this.issueSession(user);
    this.auditContext?.setActor(user);

    await this.operationLogsService.appendLog({
      userId: user.id,
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      afterData: { username: user.username, role: user.role },
      ipAddress: metadata.ipAddress || null,
    });

    return {
      ...sessionResult,
      ...this.buildSessionPayload(user),
    };
  }

  async refresh(refreshToken: unknown, metadata: any = {}) {
    const rotated = await this.refreshSessionsService.rotate(refreshToken);
    this.auditContext?.setActor(rotated.user);
    const accessToken = this.issueAccessToken(
      rotated.user,
      rotated.sessionId,
    );
    await this.operationLogsService.appendLog({
      userId: rotated.user.id,
      action: 'auth.refresh',
      entityType: 'user',
      entityId: rotated.user.id,
      afterData: {
        sessionRefreshed: true,
      },
      ipAddress: metadata.ipAddress || null,
    });
    return {
      accessToken: accessToken.token,
      accessTokenExpiresAt: accessToken.expiresAt,
      refreshToken: rotated.refreshToken,
      refreshTokenExpiresAt: rotated.refreshTokenExpiresAt,
      token: accessToken.token,
      expiresAt: accessToken.expiresAt,
      ...this.buildSessionPayload(rotated.user),
    };
  }

  async logout(refreshToken: unknown, metadata: any = {}) {
    const result = await this.refreshSessionsService.logout(refreshToken);
    if (result?.userId) {
      await this.operationLogsService.appendLog({
        userId: result.userId,
        action: 'auth.logout',
        entityType: 'user',
        entityId: result.userId,
        afterData: {
          sessionLoggedOut: true,
        },
        ipAddress: metadata.ipAddress || null,
      });
    }
  }

  async authenticateRequest(request: any) {
    const token = getBearerToken(request);
    if (!token) {
      throw createHttpError(401, 'AUTH_TOKEN_REQUIRED', 'Authorization token is required.');
    }

    const payload = verifyToken(token);
    const user = await this.usersService.findUserById(payload.sub);
    if (!user) {
      throw createHttpError(401, 'AUTH_USER_NOT_FOUND', 'Authorization user no longer exists.');
    }
    if (
      !Number.isInteger(payload.tokenVersion) ||
      payload.tokenVersion !== user.tokenVersion
    ) {
      throw createHttpError(
        401,
        'SESSION_REVOKED',
        'The session has been revoked. Sign in again.',
      );
    }
    if (payload.sessionId !== undefined) {
      await this.refreshSessionsService.assertAccessSessionActive(
        payload.sessionId,
        user.id,
        user.tokenVersion,
      );
    }
    if (!user.isActive) {
      throw createHttpError(403, 'ACCOUNT_DISABLED', 'This account has been disabled.');
    }
    if (user.mustChangePassword && !isPasswordChangeAllowedPath(request)) {
      throw createHttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Password change is required before continuing.');
    }
    request.currentUser = user;
    this.auditContext?.setActor(user);
    return user;
  }

  getSession(user: any) {
    return this.buildSessionPayload(user);
  }

  async changePassword(user: any, patch: any, metadata: any = {}) {
    if (!verifyPassword(patch?.currentPassword, user.passwordHash)) {
      throw createHttpError(400, 'CURRENT_PASSWORD_INCORRECT', 'Current password is incorrect.');
    }

    await this.usersService.updatePassword(user.id, hashPassword(patch.newPassword), {
      mustChangePassword: false,
    });

    await this.operationLogsService.appendLog({
      userId: user.id,
      action: 'auth.change_password',
      entityType: 'user',
      entityId: user.id,
      beforeData: { passwordChanged: false },
      afterData: { passwordChanged: true },
      ipAddress: metadata.ipAddress || null,
    });

    return {
      passwordChanged: true,
    };
  }

  getRoleCatalog() {
    return getRoleCatalog();
  }

  requireAdmin(user: any) {
    if (!isAdminRole(user?.role)) {
      throw createHttpError(403, 'ADMIN_REQUIRED', 'Administrator permission is required.');
    }
  }

  private buildSessionPayload(user: any) {
    return {
      user: toPublicUser(user),
      permissions: getRolePermissions(user.role),
      menus: getRoleMenus(user.role),
      dataScope: getRoleDataScope(user.role),
    };
  }

  private async issueSession(user: any) {
    const refreshSession = await this.refreshSessionsService.create(user);
    const accessToken = this.issueAccessToken(
      user,
      refreshSession.sessionId,
    );
    return {
      accessToken: accessToken.token,
      accessTokenExpiresAt: accessToken.expiresAt,
      refreshToken: refreshSession.refreshToken,
      refreshTokenExpiresAt: refreshSession.refreshTokenExpiresAt,
      token: accessToken.token,
      expiresAt: accessToken.expiresAt,
    };
  }

  private issueAccessToken(user: any, sessionId: string) {
    return createToken(
      {
        sub: user.id,
        username: user.username,
        role: user.role,
        tokenVersion: user.tokenVersion,
        sessionId,
      },
      {
        expiresInSeconds: process.env.AUTH_TOKEN_EXPIRES_IN_SECONDS
          ? Number(process.env.AUTH_TOKEN_EXPIRES_IN_SECONDS)
          : undefined,
      },
    );
  }
}

function isAdminRole(role: string) {
  return role === 'super_admin' || role === 'admin';
}

function isPasswordChangeAllowedPath(request: any) {
  const path = String(request?.path || request?.url || '');
  return path.includes('/auth/me') || path.includes('/auth/change-password');
}
