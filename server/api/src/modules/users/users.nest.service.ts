import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import { getRoleMenus, getRolePermissions, isValidRole } from '../auth/roles';
import { hashPassword } from '../auth/password';
import { getAuthTokenSecret } from '../auth/auth-token-secret';
import { AliyunSmsNestService } from '../sms/aliyun-sms.nest.service';
import { normalizeUsername } from './users.repository';
import {
  ORDINARY_EMPLOYEE_ROLES,
  canAssignRole,
  canManageTargetRole,
  isAdminRole as isMappedAdminRole,
  isSuperAdminRole,
  toAppRole,
  toPrismaRole,
} from './user-role.mapper';
const SMS_RESET_PURPOSE = 'RESET_PASSWORD';
const SMS_CODE_TTL_SECONDS = Number(process.env.SMS_CODE_TTL_SECONDS || 300);
const SMS_CODE_MAX_ATTEMPTS = 5;
const DEFAULT_EMPLOYEE_PASSWORD = 'A12345678';

@Injectable()
export class UsersNestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsNestService,
    private readonly smsService: AliyunSmsNestService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  async listUsers(actor: any, filters: any = {}) {
    requireAdmin(actor);
    const users = await this.prisma.user.findMany({
      orderBy: {
        createdAt: 'asc',
      },
    });
    return users.map(toPublicUser).filter((user) => matchesUserFilters(user, filters));
  }

  async listAssignableUsers(actor: any, role?: string) {
    requireAdmin(actor);
    const where: any = {
      isActive: true,
    };
    const normalizedRole = normalizeOptionalString(role);
    if (normalizedRole) {
      where.role = toPrismaRole(validateEmployeeRole(normalizedRole));
    }
    const users = await this.prisma.user.findMany({
      where,
      orderBy: {
        username: 'asc',
      },
    });
    return users.map(toPublicUser);
  }

  async getUser(actor: any, id: string) {
    requireAdmin(actor);
    return toPublicUser(await this.findUserOrThrow(id));
  }

  async listTasters(actor: any) {
    requireAnyRole(actor, [
      'admin',
      'boss',
      'front_desk',
      'sales',
      'finance',
      'taster',
      'warehouse',
      'after_sales',
    ]);
    const tasters = await this.prisma.user.findMany({
      where: {
        role: toPrismaRole('taster'),
        isActive: true,
      },
      orderBy: {
        username: 'asc',
      },
    });
    return tasters.map(toTasterOption);
  }

  async createUser(actor: any, payload: any, metadata: any = {}) {
    requireAdmin(actor);
    const now = new Date();
    const identity = buildCreateIdentity(payload);
    const username = identity.username;
    const existing = await this.prisma.user.findUnique({
      where: {
        username,
      },
    });
    if (existing) {
      throw createHttpError(409, 'USERNAME_EXISTS', 'Username already exists.');
    }
    if (identity.phone) {
      await assertPhoneAvailable(this.prisma, identity.phone);
    }

    const initialPassword =
      payload?.password === undefined
        ? DEFAULT_EMPLOYEE_PASSWORD
        : payload.password;
    const passwordHash = hashPassword(initialPassword);

    const user = await this.prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        name: validateName(payload?.name),
        username,
        passwordHash,
        role: toPrismaRole(validateAssignableRole(actor, payload?.role)),
        phone: identity.phone,
        leaderId: normalizeOptionalString(payload?.leaderId),
        isActive: payload?.isActive === undefined ? true : Boolean(payload.isActive),
        mustChangePassword: true,
        tokenVersion: 0,
        createdAt: now,
        updatedAt: now,
      },
    });

    const publicUser = toPublicUser(user);
    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'users.create',
      entityType: 'user',
      entityId: user.id,
      afterData: publicUser,
      ipAddress: metadata.ipAddress || null,
    });

    return {
      user: publicUser,
      permissions: getRolePermissions(publicUser.role),
      menus: getRoleMenus(publicUser.role),
    };
  }

  async updateUser(actor: any, id: string, patch: any, metadata: any = {}) {
    requireAdmin(actor);
    const result = await this.runSerializableAccountMutation(
      async (transaction: any) => {
        const current = await this.findUserOrThrow(id, transaction);
        assertCanManageTargetAccount(actor, current, 'update');

        const data: any = {
          updatedAt: new Date(),
        };

        if (patch.name !== undefined) {
          data.name = validateName(patch.name);
        }
        if (patch.role !== undefined) {
          const nextRole = validateAssignableRole(actor, patch.role);
          await assertActiveSuperAdminRemains(
            transaction,
            current,
            nextRole,
            Boolean(current.isActive),
          );
          data.role = toPrismaRole(nextRole);
          if (nextRole !== toAppRole(current.role)) {
            data.tokenVersion = {
              increment: 1,
            };
          }
        }
        if (patch.phone !== undefined) {
          const phone = normalizeOptionalPhone(patch.phone);
          if (phone && phone !== current.phone) {
            await assertPhoneAvailable(transaction, phone, id);
          }
          data.phone = phone;
        }
        if (patch.leaderId !== undefined) {
          data.leaderId = normalizeOptionalString(patch.leaderId);
        }
        if (patch.isActive !== undefined) {
          if (Boolean(patch.isActive) !== Boolean(current.isActive)) {
            throw createHttpError(
              400,
              'USE_ACCOUNT_STATUS_ENDPOINT',
              'Use freeze or unfreeze endpoint to change account status.',
            );
          }
          data.isActive = Boolean(patch.isActive);
        }

        const nextUser = await transaction.user.update({
          where: {
            id,
          },
          data,
        });
        return {
          current,
          nextUser,
        };
      },
    );
    const { current, nextUser } = result;

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'users.update',
      entityType: 'user',
      entityId: nextUser.id,
      beforeData: toPublicUser(current),
      afterData: toPublicUser(nextUser),
      ipAddress: metadata.ipAddress || null,
    });

    return toPublicUser(nextUser);
  }

  async setUserActive(actor: any, id: string, isActive: boolean, metadata: any = {}) {
    requireAdmin(actor);
    const now = new Date();
    const result = await this.runSerializableAccountMutation(
      async (transaction: any) => {
        const current = await this.findUserOrThrow(id, transaction);
        if (
          actor.id === id &&
          !isActive &&
          !isSuperAdminRole(current.role)
        ) {
          throw createHttpError(
            400,
            'CANNOT_DISABLE_SELF',
            'Administrators cannot disable their own account.',
          );
        }
        assertCanManageTargetAccount(
          actor,
          current,
          isActive ? 'enable' : 'disable',
        );
        await assertActiveSuperAdminRemains(
          transaction,
          current,
          toAppRole(current.role),
          isActive,
        );
        if (actor.id === id && !isActive) {
          throw createHttpError(
            400,
            'CANNOT_DISABLE_SELF',
            'Administrators cannot disable their own account.',
          );
        }
        const reason = validateReason(metadata.reason);

        const nextUser = await transaction.user.update({
          where: {
            id,
          },
          data: {
            isActive,
            statusReason: reason,
            statusChangedAt: now,
            statusChangedBy: actor.id,
            ...(!isActive
              ? { tokenVersion: { increment: 1 } }
              : {}),
            updatedAt: now,
          },
        });
        return {
          current,
          nextUser,
          reason,
        };
      },
    );
    const { current, nextUser, reason } = result;

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: isActive ? 'users.enable' : 'users.disable',
      entityType: 'user',
      entityId: nextUser.id,
      beforeData: { isActive: current.isActive, reason: current.statusReason || null },
      afterData: { isActive: nextUser.isActive, reason },
      ipAddress: metadata.ipAddress || null,
    });

    return toPublicUser(nextUser);
  }

  async sendResetPasswordCode(actor: any, id: string, metadata: any = {}) {
    requireAdmin(actor);
    const target = await this.findUserOrThrow(id);
    assertCanManageTargetAccount(actor, target, 'reset_password');
    const phone = normalizeOptionalPhone(target.phone || target.username);
    if (!phone) {
      throw createHttpError(400, 'PHONE_REQUIRED', 'User phone is required for password reset.');
    }

    await this.rateLimitService.enforceSmsCode({
      actorId: actor.id,
      targetUserId: target.id,
      phone,
    });

    const now = new Date();
    const code = generateSmsCode();
    const activeKey = buildSmsActiveKey(target.id, SMS_RESET_PURPOSE);
    const record = await this.replaceActiveResetCode({
      activeKey,
      actorId: actor.id,
      codeHash: hashSmsCode(phone, SMS_RESET_PURPOSE, code),
      now,
      phone,
      targetUserId: target.id,
    });
    let sent: any;
    try {
      sent = await this.smsService.sendVerificationCode(phone, code);
    } catch (error) {
      await this.prisma.smsVerificationCode.updateMany({
        where: {
          id: record.id,
          activeKey,
          consumedAt: null,
        },
        data: {
          activeKey: null,
          consumedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      throw error;
    }
    await this.prisma.smsVerificationCode.update({
      where: {
        id: record.id,
      },
      data: {
        provider: sent.provider,
        providerRef: sent.providerRef,
        updatedAt: new Date(),
      },
    });

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'users.reset_password_code.send',
      entityType: 'user',
      entityId: target.id,
      afterData: { phoneMasked: maskPhone(phone), provider: sent.provider },
      ipAddress: metadata.ipAddress || null,
    });

    return {
      expiresAt: toIsoString(record.expiresAt),
      phoneMasked: maskPhone(phone),
      ...(process.env.SMS_VERIFICATION_DEBUG === 'true' ? { debugCode: code } : {}),
    };
  }

  async resetPassword(actor: any, id: string, patch: any, metadata: any = {}) {
    requireAdmin(actor);
    const target = await this.findUserOrThrow(id);
    assertCanManageTargetAccount(actor, target, 'reset_password');
    await this.rateLimitService.enforcePasswordReset({
      actorId: actor.id,
      targetUserId: target.id,
    });
    if (typeof patch?.newPassword !== 'string' || !patch.newPassword) {
      throw createHttpError(
        400,
        'NEW_PASSWORD_REQUIRED',
        'newPassword is required.',
      );
    }
    const passwordHash = hashPassword(patch.newPassword);
    const nextUser = await this.consumeResetPasswordCode(
      actor,
      target.id,
      patch?.verificationCode,
      passwordHash,
    );

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'users.reset_password',
      entityType: 'user',
      entityId: nextUser.id,
      beforeData: { passwordReset: false },
      afterData: {
        passwordReset: true,
        mustChangePassword: false,
        reason: normalizeOptionalString(patch?.reason),
      },
      ipAddress: metadata.ipAddress || null,
    });

    return toPublicUser(nextUser);
  }

  async resetPasswordToDefault(
    actor: any,
    id: string,
    patch: any,
    metadata: any = {},
  ) {
    requireAdmin(actor);
    const reason = validatePasswordResetReason(patch?.reason);
    const target = await this.findUserOrThrow(id);
    assertCannotResetOwnPassword(actor, target);
    assertCanManageTargetAccount(actor, target, 'reset_password_to_default');
    await this.rateLimitService.enforcePasswordReset({
      actorId: actor.id,
      targetUserId: target.id,
    });

    const passwordHash = hashPassword(DEFAULT_EMPLOYEE_PASSWORD);
    const nextUser = await this.runSerializableAccountMutation(
      async (transaction: any) => {
        const current = await this.findUserOrThrow(id, transaction);
        assertCannotResetOwnPassword(actor, current);
        assertCanManageTargetAccount(
          actor,
          current,
          'reset_password_to_default',
        );

        const updated = await transaction.user.update({
          where: {
            id: current.id,
          },
          data: {
            passwordHash,
            mustChangePassword: true,
            tokenVersion: {
              increment: 1,
            },
            updatedAt: new Date(),
          },
        });

        await this.operationLogsService.appendLog(
          {
            userId: actor.id,
            action: 'users.reset_password_to_default',
            entityType: 'user',
            entityId: updated.id,
            afterData: {
              passwordReset: true,
              mustChangePassword: true,
              reason,
            },
            ipAddress: metadata.ipAddress || null,
          },
          transaction,
        );
        return updated;
      },
    );

    return toPublicUser(nextUser);
  }

  async findUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id,
      },
    });
    return user ? toAppUser(user) : null;
  }

  async findUserByUsername(username: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        username: normalizeUsername(username),
      },
    });
    return user ? toAppUser(user) : null;
  }

  async updatePassword(userId: string, passwordHash: string, options: any = {}) {
    const user = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        passwordHash,
        ...(options.mustChangePassword !== undefined
          ? { mustChangePassword: Boolean(options.mustChangePassword) }
          : {}),
        tokenVersion: {
          increment: 1,
        },
        updatedAt: new Date(),
      },
    });
    return toAppUser(user);
  }

  private async runSerializableAccountMutation<T>(
    operation: (transaction: any) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: 'Serializable',
        });
      } catch (error) {
        if (!isPrismaTransactionConflict(error)) {
          throw error;
        }
        if (attempt === 2) {
          throw createHttpError(
            409,
            'ACCOUNT_MANAGEMENT_CONFLICT',
            'The account changed concurrently. Try again.',
          );
        }
      }
    }
    throw createHttpError(
      409,
      'ACCOUNT_MANAGEMENT_CONFLICT',
      'The account changed concurrently. Try again.',
    );
  }

  private async replaceActiveResetCode(input: {
    activeKey: string;
    actorId: string;
    codeHash: string;
    now: Date;
    phone: string;
    targetUserId: string;
  }) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (transaction: any) => {
          await transaction.smsVerificationCode.updateMany({
            where: {
              activeKey: input.activeKey,
              consumedAt: null,
            },
            data: {
              activeKey: null,
              consumedAt: input.now,
              updatedAt: input.now,
            },
          });
          return transaction.smsVerificationCode.create({
            data: {
              id: crypto.randomUUID(),
              phone: input.phone,
              userId: input.targetUserId,
              purpose: SMS_RESET_PURPOSE,
              codeHash: input.codeHash,
              activeKey: input.activeKey,
              expiresAt: new Date(
                input.now.getTime() + SMS_CODE_TTL_SECONDS * 1000,
              ),
              consumedAt: null,
              attemptCount: 0,
              createdById: input.actorId,
              provider: null,
              providerRef: null,
              createdAt: input.now,
              updatedAt: input.now,
            },
          });
        });
      } catch (error) {
        if (!isPrismaUniqueConstraintError(error) || attempt === 2) {
          throw error;
        }
      }
    }
    throw createHttpError(
      503,
      'SMS_CODE_REPLACEMENT_FAILED',
      'Unable to issue a new verification code.',
    );
  }

  private async consumeResetPasswordCode(
    actor: any,
    targetUserId: string,
    code: unknown,
    passwordHash: string,
  ) {
    const normalizedCode = String(code || '').trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
      throw createHttpError(400, 'INVALID_SMS_CODE', 'SMS verification code is invalid.');
    }
    const now = new Date();
    const outcome = await this.runSerializableAccountMutation(
      async (transaction: any) => {
        const target = await this.findUserOrThrow(
          targetUserId,
          transaction,
        );
        assertCanManageTargetAccount(actor, target, 'reset_password');
        const phone = normalizeOptionalPhone(
          target.phone || target.username,
        );
        const activeKey = buildSmsActiveKey(
          target.id,
          SMS_RESET_PURPOSE,
        );
        const submittedHash = hashSmsCode(
          phone,
          SMS_RESET_PURPOSE,
          normalizedCode,
        );
        const record = await transaction.smsVerificationCode.findFirst({
          where: {
            activeKey,
            userId: target.id,
            purpose: SMS_RESET_PURPOSE,
            consumedAt: null,
          },
        });
        if (!record) {
          const previous = await transaction.smsVerificationCode.findFirst({
            where: {
              userId: target.id,
              purpose: SMS_RESET_PURPOSE,
              codeHash: submittedHash,
              activeKey: null,
            },
          });
          return {
            kind: previous ? 'not_current' : 'not_found',
          };
        }
        if (
          record.expiresAt &&
          new Date(record.expiresAt).getTime() < now.getTime()
        ) {
          await invalidateVerificationCode(
            transaction,
            record.id,
            activeKey,
            now,
          );
          return { kind: 'expired' };
        }
        if (Number(record.attemptCount || 0) >= SMS_CODE_MAX_ATTEMPTS) {
          await invalidateVerificationCode(
            transaction,
            record.id,
            activeKey,
            now,
          );
          return { kind: 'locked' };
        }
        if (record.codeHash !== submittedHash) {
          const previous =
            await transaction.smsVerificationCode.findFirst({
              where: {
                userId: target.id,
                purpose: SMS_RESET_PURPOSE,
                codeHash: submittedHash,
                activeKey: null,
              },
            });
          if (previous) {
            return { kind: 'not_current' };
          }
          const incremented =
            await transaction.smsVerificationCode.updateMany({
              where: {
                id: record.id,
                activeKey,
                consumedAt: null,
                attemptCount: {
                  lt: SMS_CODE_MAX_ATTEMPTS,
                },
              },
              data: {
                attemptCount: {
                  increment: 1,
                },
                updatedAt: now,
              },
            });
          return {
            kind: incremented.count === 1 ? 'incorrect' : 'locked',
          };
        }

        const consumed = await transaction.smsVerificationCode.updateMany({
          where: {
            id: record.id,
            activeKey,
            codeHash: submittedHash,
            consumedAt: null,
            expiresAt: {
              gt: now,
            },
            attemptCount: {
              lt: SMS_CODE_MAX_ATTEMPTS,
            },
          },
          data: {
            activeKey: null,
            consumedAt: now,
            updatedAt: now,
          },
        });
        if (consumed.count !== 1) {
          return { kind: 'not_current' };
        }
        const user = await transaction.user.update({
          where: {
            id: target.id,
          },
          data: {
            passwordHash,
            mustChangePassword: false,
            tokenVersion: {
              increment: 1,
            },
            updatedAt: now,
          },
        });
        return {
          kind: 'success',
          user,
        };
      },
    );

    if (outcome.kind === 'success') {
      return outcome.user;
    }
    if (outcome.kind === 'expired') {
      throw createHttpError(400, 'SMS_CODE_EXPIRED', 'SMS verification code has expired.');
    }
    if (outcome.kind === 'locked') {
      throw createHttpError(400, 'SMS_CODE_LOCKED', 'SMS verification code has too many failed attempts.');
    }
    if (outcome.kind === 'incorrect') {
      throw createHttpError(400, 'SMS_CODE_INCORRECT', 'SMS verification code is incorrect.');
    }
    if (outcome.kind === 'not_current') {
      throw createHttpError(
        400,
        'SMS_CODE_NOT_CURRENT',
        'SMS verification code is no longer current.',
      );
    }
    throw createHttpError(400, 'SMS_CODE_NOT_FOUND', 'SMS verification code was not found.');
  }

  private async findUserOrThrow(id: string, client: any = this.prisma) {
    const user = await client.user.findUnique({
      where: {
        id,
      },
    });
    if (!user) {
      throw createHttpError(404, 'USER_NOT_FOUND', 'User does not exist.');
    }
    return user;
  }
}

export function toAppUser(user: any) {
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

export function toPublicUser(user: any) {
  const appUser = user.role === toAppRole(user.role) && typeof user.createdAt === 'string' ? user : toAppUser(user);
  return {
    id: appUser.id,
    name: appUser.name,
    username: appUser.username,
    role: appUser.role,
    phone: appUser.phone,
    leaderId: appUser.leaderId,
    isActive: appUser.isActive,
    mustChangePassword: Boolean(appUser.mustChangePassword),
    statusReason: appUser.statusReason || null,
    statusChangedAt: appUser.statusChangedAt || null,
    statusChangedBy: appUser.statusChangedBy || null,
    createdAt: appUser.createdAt,
    updatedAt: appUser.updatedAt,
  };
}

function toTasterOption(user: any) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
  };
}

function requireAdmin(actor: any) {
  if (!actor || !isAdminRole(actor.role)) {
    throw createHttpError(403, 'ADMIN_REQUIRED', 'Administrator permission is required.');
  }
}

function requireAnyRole(actor: any, roles: string[]) {
  if (!actor || !isRoleAllowed(actor.role, roles)) {
    throw createHttpError(403, 'PERMISSION_DENIED', 'You do not have permission to perform this action.');
  }
}

function isAdminRole(role: string) {
  return isSuperAdminRole(role) || isMappedAdminRole(role);
}

function isRoleAllowed(role: string, roles: string[]) {
  return roles.includes(role) || (role === 'super_admin' && roles.includes('admin'));
}

function validateUsername(username: string) {
  const normalized = normalizeUsername(username);
  if (!/^[a-z0-9._-]{3,50}$/.test(normalized)) {
    throw createHttpError(400, 'INVALID_USERNAME', 'username must be 3-50 characters and use letters, numbers, dot, underscore, or dash.');
  }
  return normalized;
}

function buildCreateIdentity(payload: any) {
  const phone = normalizeOptionalPhone(payload?.phone);
  if (phone) {
    const providedUsername = payload?.username === undefined ? phone : normalizeUsername(payload.username);
    if (providedUsername !== phone) {
      throw createHttpError(400, 'USERNAME_MUST_MATCH_PHONE', 'username must match phone.');
    }
    return {
      username: phone,
      phone,
    };
  }
  return {
    username: validateUsername(payload?.username),
    phone: null,
  };
}

function validateName(name: string) {
  const normalized = String(name || '').trim();
  if (!normalized) {
    throw createHttpError(400, 'NAME_REQUIRED', 'name is required.');
  }
  if (normalized.length > 100) {
    throw createHttpError(400, 'NAME_TOO_LONG', 'name must be 100 characters or fewer.');
  }
  return normalized;
}

function validateRole(role: string) {
  const normalized = String(role || '').trim();
  if (!isValidRole(normalized)) {
    throw createHttpError(400, 'INVALID_ROLE', 'role is invalid.');
  }
  return normalized;
}

function validateEmployeeRole(role: string) {
  const normalized = validateRole(role);
  if (
    !ORDINARY_EMPLOYEE_ROLES.includes(
      normalized as (typeof ORDINARY_EMPLOYEE_ROLES)[number],
    )
  ) {
    throw createHttpError(400, 'ADMIN_ROLE_CREATE_FORBIDDEN', 'Administrators can only create ordinary employee roles.');
  }
  return normalized;
}

function validateAssignableRole(actor: any, role: string) {
  const normalized = validateRole(role);
  if (!canAssignRole(actor?.role, normalized)) {
    throw createHttpError(
      403,
      'ROLE_ASSIGNMENT_FORBIDDEN',
      'The requested role cannot be assigned by this account.',
    );
  }
  return normalized;
}

function validateReason(reason: unknown) {
  const normalized = String(reason || '').trim();
  if (!normalized) {
    throw createHttpError(400, 'REASON_REQUIRED', 'reason is required.');
  }
  if (normalized.length > 255) {
    throw createHttpError(400, 'REASON_TOO_LONG', 'reason must be 255 characters or fewer.');
  }
  return normalized;
}

function validatePasswordResetReason(reason: unknown) {
  const normalized = String(reason || '').trim();
  if (!normalized) {
    throw createHttpError(
      400,
      'RESET_PASSWORD_REASON_REQUIRED',
      'reason is required when resetting a password to the default.',
    );
  }
  if (normalized.length > 255) {
    throw createHttpError(
      400,
      'RESET_PASSWORD_REASON_TOO_LONG',
      'reason must be 255 characters or fewer.',
    );
  }
  return normalized;
}

function normalizeOptionalPhone(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).replace(/\s+/g, '').trim();
  if (!normalized) {
    return null;
  }
  if (!/^1[3-9]\d{9}$/.test(normalized)) {
    throw createHttpError(400, 'INVALID_PHONE', 'phone must be a valid mainland China mobile number.');
  }
  return normalized;
}

async function assertPhoneAvailable(prisma: any, phone: string, exceptUserId?: string) {
  const existing = await prisma.user.findMany({
    where: {
      phone,
    },
  });
  const duplicate = existing.find((user: any) => user.id !== exceptUserId);
  if (duplicate) {
    throw createHttpError(409, 'PHONE_EXISTS', 'Phone already exists.');
  }
}

function assertCanManageTargetAccount(actor: any, target: any, action: string) {
  const actorRole = toAppRole(actor?.role);
  const targetRole = toAppRole(target.role);
  if (canManageTargetRole(actorRole, targetRole)) {
    return;
  }
  if (targetRole === 'super_admin') {
    throw createHttpError(
      403,
      'SUPER_ADMIN_ACCOUNT_PROTECTED',
      'Only a super administrator can manage a super administrator account.',
    );
  }
  if (targetRole === 'admin') {
    throw createHttpError(
      403,
      'SUPER_ADMIN_REQUIRED',
      'Super administrator permission is required.',
    );
  }
  throw createHttpError(
    403,
    'ACCOUNT_MANAGEMENT_FORBIDDEN',
    'This account cannot manage the target account.',
  );
}

function assertCannotResetOwnPassword(actor: any, target: any) {
  if (actor?.id === target?.id) {
    throw createHttpError(
      400,
      'CANNOT_RESET_OWN_PASSWORD',
      'Administrators cannot reset their own password to the default.',
    );
  }
}

async function assertActiveSuperAdminRemains(
  transaction: any,
  current: any,
  nextRole: string,
  nextIsActive: boolean,
) {
  if (
    !isSuperAdminRole(current.role) ||
    !Boolean(current.isActive) ||
    (isSuperAdminRole(nextRole) && nextIsActive)
  ) {
    return;
  }
  const activeSuperAdminCount = await transaction.user.count({
    where: {
      role: toPrismaRole('super_admin'),
      isActive: true,
    },
  });
  if (activeSuperAdminCount <= 1) {
    throw createHttpError(
      409,
      'LAST_ACTIVE_SUPER_ADMIN',
      'The last active super administrator cannot be disabled or downgraded.',
    );
  }
}

function isPrismaTransactionConflict(error: any) {
  return error?.code === 'P2034';
}

function matchesUserFilters(user: any, filters: any) {
  const role = normalizeOptionalString(filters?.role);
  if (role && user.role !== role) {
    return false;
  }
  const status = normalizeOptionalString(filters?.status);
  if (status === 'active' && !user.isActive) {
    return false;
  }
  if (status === 'frozen' && user.isActive) {
    return false;
  }
  const keyword = normalizeOptionalString(filters?.keyword || filters?.query);
  if (keyword) {
    const haystack = [user.name, user.username, user.phone, user.role]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(keyword.toLowerCase())) {
      return false;
    }
  }
  return true;
}

function generateSmsCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function buildSmsActiveKey(userId: string, purpose: string) {
  return `${userId}:${purpose}`;
}

async function invalidateVerificationCode(
  transaction: any,
  id: string,
  activeKey: string,
  now: Date,
) {
  await transaction.smsVerificationCode.updateMany({
    where: {
      id,
      activeKey,
      consumedAt: null,
    },
    data: {
      activeKey: null,
      consumedAt: now,
      updatedAt: now,
    },
  });
}

function isPrismaUniqueConstraintError(error: any) {
  return (
    error?.code === 'P2002' &&
    JSON.stringify(error?.meta?.target || '').includes('active_key')
  );
}

function hashSmsCode(phone: string, purpose: string, code: string) {
  const secret = getAuthTokenSecret();
  return crypto
    .createHmac('sha256', secret)
    .update(`${phone}:${purpose}:${code}`, 'utf8')
    .digest('hex');
}

function maskPhone(phone: string) {
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
}

function normalizeOptionalString(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function toIsoString(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value ? String(value) : null;
}
