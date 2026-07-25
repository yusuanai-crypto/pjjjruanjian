import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { toAppRole } from '../users/user-role.mapper';

const DEFAULT_REFRESH_TOKEN_EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60;
const REFRESH_TOKEN_BYTES = 48;

@Injectable()
export class RefreshSessionNestService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: any) {
    const now = new Date();
    const sessionId = crypto.randomUUID();
    const refreshToken = createRefreshToken();
    const expiresAt = new Date(
      now.getTime() + refreshTokenExpiresInSeconds() * 1000,
    );
    await this.prisma.refreshSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        tokenHash: hashRefreshToken(refreshToken),
        familyId: sessionId,
        tokenVersion: Number(user.tokenVersion || 0),
        expiresAt,
        createdAt: now,
        updatedAt: now,
      },
    });
    return {
      sessionId,
      refreshToken,
      refreshTokenExpiresAt: expiresAt.toISOString(),
    };
  }

  async rotate(rawRefreshToken: unknown) {
    const refreshToken = requireRefreshToken(rawRefreshToken);
    const tokenHash = hashRefreshToken(refreshToken);
    const replacementToken = createRefreshToken();
    const replacementId = crypto.randomUUID();
    const now = new Date();

    const outcome = await this.prisma.$transaction(async (transaction: any) => {
      const current = await transaction.refreshSession.findUnique({
        where: { tokenHash },
      });
      if (!current) {
        return { kind: 'invalid' };
      }

      if (current.revokedAt || current.replacedBySessionId) {
        await revokeFamily(
          transaction,
          current.familyId,
          now,
          'reuse_detected',
        );
        return { kind: 'reused' };
      }
      if (new Date(current.expiresAt).getTime() <= now.getTime()) {
        await transaction.refreshSession.updateMany({
          where: { id: current.id, revokedAt: null },
          data: {
            revokedAt: now,
            revokeReason: 'expired',
            lastUsedAt: now,
            updatedAt: now,
          },
        });
        return { kind: 'expired' };
      }

      const user = await transaction.user.findUnique({
        where: { id: current.userId },
      });
      if (!user) {
        return { kind: 'invalid' };
      }
      if (!user.isActive) {
        await revokeFamily(
          transaction,
          current.familyId,
          now,
          'account_disabled',
        );
        return { kind: 'disabled' };
      }
      if (
        Number(current.tokenVersion) !== Number(user.tokenVersion || 0)
      ) {
        await revokeFamily(
          transaction,
          current.familyId,
          now,
          'session_version_changed',
        );
        return { kind: 'revoked' };
      }

      const claimed = await transaction.refreshSession.updateMany({
        where: {
          id: current.id,
          revokedAt: null,
          replacedBySessionId: null,
          expiresAt: { gt: now },
        },
        data: {
          revokedAt: now,
          revokeReason: 'rotated',
          replacedBySessionId: replacementId,
          lastUsedAt: now,
          updatedAt: now,
        },
      });
      if (claimed.count !== 1) {
        await revokeFamily(
          transaction,
          current.familyId,
          now,
          'reuse_detected',
        );
        return { kind: 'reused' };
      }

      const expiresAt = new Date(
        now.getTime() + refreshTokenExpiresInSeconds() * 1000,
      );
      await transaction.refreshSession.create({
        data: {
          id: replacementId,
          userId: current.userId,
          tokenHash: hashRefreshToken(replacementToken),
          familyId: current.familyId,
          tokenVersion: Number(user.tokenVersion || 0),
          expiresAt,
          createdAt: now,
          updatedAt: now,
        },
      });
      return {
        kind: 'success',
        user: toAuthUser(user),
        sessionId: replacementId,
        refreshToken: replacementToken,
        refreshTokenExpiresAt: expiresAt.toISOString(),
      };
    });

    switch (outcome.kind) {
      case 'success':
        return outcome;
      case 'expired':
        throw createHttpError(
          401,
          'REFRESH_TOKEN_EXPIRED',
          'The refresh session has expired. Sign in again.',
        );
      case 'reused':
        throw createHttpError(
          401,
          'REFRESH_TOKEN_REUSED',
          'The refresh session is no longer valid. Sign in again.',
        );
      case 'revoked':
        throw createHttpError(
          401,
          'SESSION_REVOKED',
          'The session has been revoked. Sign in again.',
        );
      case 'disabled':
        throw createHttpError(
          403,
          'ACCOUNT_DISABLED',
          'This account has been disabled.',
        );
      default:
        throw createHttpError(
          401,
          'REFRESH_TOKEN_INVALID',
          'The refresh session is invalid. Sign in again.',
        );
    }
  }

  async logout(rawRefreshToken: unknown) {
    if (typeof rawRefreshToken !== 'string' || !rawRefreshToken) {
      return null;
    }
    const current = await this.prisma.refreshSession.findUnique({
      where: { tokenHash: hashRefreshToken(rawRefreshToken) },
    });
    if (!current) {
      return null;
    }
    await revokeFamily(
      this.prisma,
      current.familyId,
      new Date(),
      'logout',
    );
    return {
      userId: current.userId,
    };
  }

  async assertAccessSessionActive(
    sessionId: unknown,
    userId: string,
    tokenVersion: number,
  ) {
    if (typeof sessionId !== 'string' || !sessionId) {
      throw sessionRevokedError();
    }
    const session = await this.prisma.refreshSession.findUnique({
      where: { id: sessionId },
    });
    if (
      !session ||
      session.userId !== userId ||
      session.revokedAt ||
      new Date(session.expiresAt).getTime() <= Date.now() ||
      Number(session.tokenVersion) !== Number(tokenVersion)
    ) {
      throw sessionRevokedError();
    }
  }
}

async function revokeFamily(
  prisma: any,
  familyId: string,
  now: Date,
  reason: string,
) {
  await prisma.refreshSession.updateMany({
    where: {
      familyId,
      revokedAt: null,
    },
    data: {
      revokedAt: now,
      revokeReason: reason,
      updatedAt: now,
    },
  });
}

function requireRefreshToken(value: unknown) {
  if (typeof value !== 'string' || !value) {
    throw createHttpError(
      400,
      'REFRESH_TOKEN_REQUIRED',
      'refreshToken is required.',
    );
  }
  return value;
}

function createRefreshToken() {
  return crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

function hashRefreshToken(refreshToken: string) {
  return crypto
    .createHash('sha256')
    .update(refreshToken, 'utf8')
    .digest('hex');
}

function refreshTokenExpiresInSeconds() {
  const configured = Number(process.env.AUTH_REFRESH_TOKEN_EXPIRES_IN_SECONDS);
  return Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_REFRESH_TOKEN_EXPIRES_IN_SECONDS;
}

function sessionRevokedError() {
  return createHttpError(
    401,
    'SESSION_REVOKED',
    'The session has been revoked. Sign in again.',
  );
}

function toAuthUser(user: any) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    passwordHash: user.passwordHash,
    role: toAppRole(user.role),
    phone: user.phone,
    leaderId: user.leaderId,
    isActive: Boolean(user.isActive),
    mustChangePassword: Boolean(user.mustChangePassword),
    tokenVersion: Number(user.tokenVersion || 0),
    statusReason: user.statusReason || null,
    statusChangedAt: toIsoString(user.statusChangedAt),
    statusChangedBy: user.statusChangedBy || null,
    createdAt: toIsoString(user.createdAt),
    updatedAt: toIsoString(user.updatedAt),
  };
}

function toIsoString(value: unknown) {
  return value instanceof Date ? value.toISOString() : String(value || '');
}
