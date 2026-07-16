import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import { getRoleMenus, getRolePermissions, isValidRole } from '../auth/roles';
import { TEMPORARY_PASSWORD, hashPassword, hashTemporaryPassword } from '../auth/password';
import { AliyunSmsNestService } from '../sms/aliyun-sms.nest.service';
import { normalizeUsername } from './users.repository';
import { toAppRole, toPrismaRole } from './user-role.mapper';

const ORDINARY_EMPLOYEE_ROLES = [
  'boss',
  'front_desk',
  'sales',
  'finance',
  'warehouse',
  'after_sales',
  'taster',
];
const SMS_RESET_PURPOSE = 'RESET_PASSWORD';
const SMS_CODE_TTL_SECONDS = Number(process.env.SMS_CODE_TTL_SECONDS || 300);
const SMS_CODE_MAX_ATTEMPTS = 5;

@Injectable()
export class UsersNestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsNestService,
    private readonly smsService: AliyunSmsNestService,
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
    requireAnyRole(actor, ['admin', 'front_desk', 'sales', 'finance']);
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

    const rawPassword = typeof payload?.password === 'string' && payload.password
      ? payload.password
      : TEMPORARY_PASSWORD;
    const isTemporaryPassword = rawPassword === TEMPORARY_PASSWORD;

    const user = await this.prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        name: validateName(payload?.name),
        username,
        passwordHash: isTemporaryPassword ? hashTemporaryPassword() : hashPassword(rawPassword),
        role: toPrismaRole(validateEmployeeRole(payload?.role)),
        phone: identity.phone,
        leaderId: normalizeOptionalString(payload?.leaderId),
        isActive: payload?.isActive === undefined ? true : Boolean(payload.isActive),
        mustChangePassword:
          payload?.mustChangePassword === undefined
            ? isTemporaryPassword
            : Boolean(payload.mustChangePassword),
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
    const current = await this.findUserOrThrow(id);
    const data: any = {
      updatedAt: new Date(),
    };

    if (patch.name !== undefined) {
      data.name = validateName(patch.name);
    }
    if (patch.role !== undefined) {
      data.role = toPrismaRole(validateEmployeeRole(patch.role));
    }
    if (patch.phone !== undefined) {
      const phone = normalizeOptionalPhone(patch.phone);
      if (phone && phone !== current.phone) {
        await assertPhoneAvailable(this.prisma, phone, id);
      }
      data.phone = phone;
    }
    if (patch.leaderId !== undefined) {
      data.leaderId = normalizeOptionalString(patch.leaderId);
    }
    if (patch.isActive !== undefined) {
      if (Boolean(patch.isActive) !== Boolean(current.isActive)) {
        throw createHttpError(400, 'USE_ACCOUNT_STATUS_ENDPOINT', 'Use freeze or unfreeze endpoint to change account status.');
      }
      data.isActive = Boolean(patch.isActive);
    }

    const nextUser = await this.prisma.user.update({
      where: {
        id,
      },
      data,
    });

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
    const reason = validateReason(metadata.reason);
    const now = new Date();
    if (actor.id === id && !isActive) {
      throw createHttpError(400, 'CANNOT_DISABLE_SELF', 'Administrators cannot disable their own account.');
    }

    const current = await this.findUserOrThrow(id);
    assertCanManageTargetAccount(actor, current, isActive ? 'enable' : 'disable');
    const nextUser = await this.prisma.user.update({
      where: {
        id,
      },
      data: {
        isActive,
        statusReason: reason,
        statusChangedAt: now,
        statusChangedBy: actor.id,
        updatedAt: now,
      },
    });

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

    const code = generateSmsCode();
    const now = new Date();
    const sent = await this.smsService.sendVerificationCode(phone, code);
    const record = await this.prisma.smsVerificationCode.create({
      data: {
        id: crypto.randomUUID(),
        phone,
        userId: target.id,
        purpose: SMS_RESET_PURPOSE,
        codeHash: hashSmsCode(phone, SMS_RESET_PURPOSE, code),
        expiresAt: new Date(now.getTime() + SMS_CODE_TTL_SECONDS * 1000),
        consumedAt: null,
        attemptCount: 0,
        createdById: actor.id,
        provider: sent.provider,
        providerRef: sent.providerRef,
        createdAt: now,
        updatedAt: now,
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
    await this.consumeResetPasswordCode(target, patch?.verificationCode);
    const nextUser = await this.prisma.user.update({
      where: {
        id: target.id,
      },
      data: {
        passwordHash: hashTemporaryPassword(),
        mustChangePassword: true,
        updatedAt: new Date(),
      },
    });

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'users.reset_password',
      entityType: 'user',
      entityId: nextUser.id,
      beforeData: { passwordReset: false },
      afterData: {
        passwordReset: true,
        mustChangePassword: true,
        reason: normalizeOptionalString(patch?.reason),
      },
      ipAddress: metadata.ipAddress || null,
    });

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
        updatedAt: new Date(),
      },
    });
    return toAppUser(user);
  }

  private async consumeResetPasswordCode(target: any, code: unknown) {
    const normalizedCode = String(code || '').trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
      throw createHttpError(400, 'INVALID_SMS_CODE', 'SMS verification code is invalid.');
    }
    const phone = normalizeOptionalPhone(target.phone || target.username);
    const now = new Date();
    const rows = await this.prisma.smsVerificationCode.findMany({
      where: {
        phone,
        userId: target.id,
        purpose: SMS_RESET_PURPOSE,
        consumedAt: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    const record = rows[0];
    if (!record) {
      throw createHttpError(400, 'SMS_CODE_NOT_FOUND', 'SMS verification code was not found.');
    }
    if (record.expiresAt && new Date(record.expiresAt).getTime() < now.getTime()) {
      throw createHttpError(400, 'SMS_CODE_EXPIRED', 'SMS verification code has expired.');
    }
    if (Number(record.attemptCount || 0) >= SMS_CODE_MAX_ATTEMPTS) {
      throw createHttpError(400, 'SMS_CODE_LOCKED', 'SMS verification code has too many failed attempts.');
    }
    if (record.codeHash !== hashSmsCode(phone, SMS_RESET_PURPOSE, normalizedCode)) {
      await this.prisma.smsVerificationCode.update({
        where: {
          id: record.id,
        },
        data: {
          attemptCount: Number(record.attemptCount || 0) + 1,
          updatedAt: now,
        },
      });
      throw createHttpError(400, 'SMS_CODE_INCORRECT', 'SMS verification code is incorrect.');
    }
    await this.prisma.smsVerificationCode.update({
      where: {
        id: record.id,
      },
      data: {
        consumedAt: now,
        updatedAt: now,
      },
    });
  }

  private async findUserOrThrow(id: string) {
    const user = await this.prisma.user.findUnique({
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
  return role === 'super_admin' || role === 'admin';
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
  if (!ORDINARY_EMPLOYEE_ROLES.includes(normalized)) {
    throw createHttpError(400, 'ADMIN_ROLE_CREATE_FORBIDDEN', 'Administrators can only create ordinary employee roles.');
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
  const role = toAppRole(target.role);
  if (role === 'super_admin') {
    throw createHttpError(403, 'SUPER_ADMIN_ACCOUNT_PROTECTED', 'Super administrator accounts cannot be managed here.');
  }
  if (role === 'admin' && actor.role !== 'super_admin') {
    throw createHttpError(403, 'SUPER_ADMIN_REQUIRED', 'Super administrator permission is required.');
  }
  if (action === 'disable' && actor.id === target.id) {
    throw createHttpError(400, 'CANNOT_DISABLE_SELF', 'Administrators cannot disable their own account.');
  }
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

function hashSmsCode(phone: string, purpose: string, code: string) {
  const secret = process.env.AUTH_TOKEN_SECRET || 'jiangjiu-dev-token-secret-change-me';
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
