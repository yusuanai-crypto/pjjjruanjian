import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import { getRoleMenus, getRolePermissions, isValidRole } from '../auth/roles';
import { hashPassword } from '../auth/password';
import { normalizeUsername } from './users.repository';
import { toAppRole, toPrismaRole } from './user-role.mapper';

@Injectable()
export class UsersNestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsNestService,
  ) {}

  async listUsers(actor: any) {
    requireAdmin(actor);
    const users = await this.prisma.user.findMany({
      orderBy: {
        createdAt: 'asc',
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
    const username = validateUsername(payload?.username);
    const existing = await this.prisma.user.findUnique({
      where: {
        username,
      },
    });
    if (existing) {
      throw createHttpError(409, 'USERNAME_EXISTS', 'Username already exists.');
    }

    const user = await this.prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        name: validateName(payload?.name),
        username,
        passwordHash: hashPassword(payload?.password),
        role: toPrismaRole(validateRole(payload?.role)),
        phone: normalizeOptionalString(payload?.phone),
        leaderId: normalizeOptionalString(payload?.leaderId),
        isActive: payload?.isActive === undefined ? true : Boolean(payload.isActive),
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
      data.role = toPrismaRole(validateRole(patch.role));
    }
    if (patch.phone !== undefined) {
      data.phone = normalizeOptionalString(patch.phone);
    }
    if (patch.leaderId !== undefined) {
      data.leaderId = normalizeOptionalString(patch.leaderId);
    }
    if (patch.isActive !== undefined) {
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
    if (actor.id === id && !isActive) {
      throw createHttpError(400, 'CANNOT_DISABLE_SELF', 'Administrators cannot disable their own account.');
    }

    const current = await this.findUserOrThrow(id);
    const nextUser = await this.prisma.user.update({
      where: {
        id,
      },
      data: {
        isActive,
        updatedAt: new Date(),
      },
    });

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: isActive ? 'users.enable' : 'users.disable',
      entityType: 'user',
      entityId: nextUser.id,
      beforeData: { isActive: current.isActive },
      afterData: { isActive: nextUser.isActive },
      ipAddress: metadata.ipAddress || null,
    });

    return toPublicUser(nextUser);
  }

  async resetPassword(actor: any, id: string, patch: any, metadata: any = {}) {
    requireAdmin(actor);
    const nextUser = await this.prisma.user.update({
      where: {
        id: (await this.findUserOrThrow(id)).id,
      },
      data: {
        passwordHash: hashPassword(patch?.newPassword),
        updatedAt: new Date(),
      },
    });

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'users.reset_password',
      entityType: 'user',
      entityId: nextUser.id,
      beforeData: { passwordReset: false },
      afterData: { passwordReset: true },
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

  async updatePassword(userId: string, passwordHash: string) {
    const user = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        passwordHash,
        updatedAt: new Date(),
      },
    });
    return toAppUser(user);
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
  if (!actor || actor.role !== 'admin') {
    throw createHttpError(403, 'ADMIN_REQUIRED', 'Administrator permission is required.');
  }
}

function requireAnyRole(actor: any, roles: string[]) {
  if (!actor || !roles.includes(actor.role)) {
    throw createHttpError(403, 'PERMISSION_DENIED', 'You do not have permission to perform this action.');
  }
}

function validateUsername(username: string) {
  const normalized = normalizeUsername(username);
  if (!/^[a-z0-9._-]{3,50}$/.test(normalized)) {
    throw createHttpError(400, 'INVALID_USERNAME', 'username must be 3-50 characters and use letters, numbers, dot, underscore, or dash.');
  }
  return normalized;
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
