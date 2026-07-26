import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';

@Injectable()
export class GuidesNestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsNestService,
  ) {}

  async listGuides(actor: any, filters: any = {}) {
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
    const where = buildGuideWhere(filters);
    const { page, pageSize } = normalizeGuidePagination(filters);
    const [guides, total] = await Promise.all([
      this.prisma.guide.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.guide.count({ where }),
    ]);
    return {
      guides: guides.map(toGuideDto),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      },
    };
  }

  async getGuide(actor: any, id: string) {
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
    return toGuideDto(await this.findGuideOrThrow(id));
  }

  async createGuide(actor: any, payload: any, metadata: any = {}) {
    requireAnyRole(actor, ['admin', 'front_desk']);
    const data = buildGuideData(payload, true);
    const existing = await this.prisma.guide.findUnique({
      where: {
        phone: data.phone,
      },
    });
    if (existing) {
      throwGuidePhoneConflict(existing);
    }

    let created;
    try {
      created = await this.prisma.guide.create({
        data,
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const duplicate = await this.prisma.guide.findUnique({
          where: { phone: data.phone },
        });
        throwGuidePhoneConflict(duplicate);
      }
      throw error;
    }
    const dto = toGuideDto(created);
    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'guides.create',
      entityType: 'guide',
      entityId: created.id,
      afterData: dto,
      ipAddress: metadata.ipAddress || null,
    });
    return dto;
  }

  async updateGuide(actor: any, id: string, payload: any, metadata: any = {}) {
    requireAnyRole(actor, ['admin', 'front_desk']);
    const current = await this.findGuideOrThrow(id);
    const data = buildGuideData(payload, false);

    if (data.phone && data.phone !== current.phone) {
      const duplicate = await this.prisma.guide.findUnique({
        where: {
          phone: data.phone,
        },
      });
      if (duplicate) {
        throwGuidePhoneConflict(duplicate);
      }
    }

    let updated;
    try {
      updated = await this.prisma.guide.update({
        where: {
          id,
        },
        data,
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const duplicate = await this.prisma.guide.findUnique({
          where: { phone: data.phone },
        });
        throwGuidePhoneConflict(duplicate);
      }
      throw error;
    }
    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'guides.update',
      entityType: 'guide',
      entityId: updated.id,
      beforeData: toGuideDto(current),
      afterData: toGuideDto(updated),
      ipAddress: metadata.ipAddress || null,
    });
    return toGuideDto(updated);
  }

  async setGuideActive(
    actor: any,
    id: string,
    isActive: boolean,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'front_desk']);
    const current = await this.findGuideOrThrow(id);
    const updated = await this.prisma.guide.update({
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
      action: isActive ? 'guides.enable' : 'guides.disable',
      entityType: 'guide',
      entityId: updated.id,
      beforeData: { isActive: Boolean(current.isActive) },
      afterData: { isActive: Boolean(updated.isActive) },
      ipAddress: metadata.ipAddress || null,
    });
    return toGuideDto(updated);
  }

  private async findGuideOrThrow(id: string) {
    const guide = await this.prisma.guide.findUnique({
      where: {
        id,
      },
    });
    if (!guide) {
      throw createHttpError(404, 'GUIDE_NOT_FOUND', 'Guide does not exist.');
    }
    return guide;
  }
}

function buildGuideWhere(filters: any = {}) {
  const where: any = {};
  const keyword = normalizeOptionalString(
    filters.keyword || filters.query || filters.search,
  );
  if (keyword) {
    where.OR = [
      { name: { contains: keyword } },
      { phone: { contains: keyword } },
      { remarks: { contains: keyword } },
    ];
  }
  if (filters.isActive !== undefined && filters.isActive !== '') {
    where.isActive = normalizeBoolean(filters.isActive, 'isActive');
  }
  return where;
}

function buildGuideData(payload: any, creating: boolean) {
  const now = new Date();
  const data: any = {
    updatedAt: now,
  };

  assignRequiredString(data, 'name', payload?.name, creating, 'name', 80);
  assignRequiredString(data, 'phone', payload?.phone, creating, 'phone', 30);
  assignNullableString(data, 'remarks', payload?.remarks);
  if (payload?.isActive !== undefined) {
    data.isActive = normalizeBoolean(payload.isActive, 'isActive');
  }

  if (creating) {
    data.id = crypto.randomUUID();
    data.createdAt = now;
    data.isActive = data.isActive ?? true;
  }
  return data;
}

function assignRequiredString(
  data: any,
  key: string,
  value: unknown,
  required: boolean,
  fieldName: string,
  maxLength: number,
) {
  if (value === undefined && !required) {
    return;
  }
  const text = normalizeRequiredString(value, fieldName);
  if (text.length > maxLength) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be ${maxLength} characters or fewer.`,
    );
  }
  data[key] = text;
}

function assignNullableString(data: any, key: string, value: unknown) {
  if (value !== undefined) {
    data[key] = normalizeOptionalString(value);
  }
}

function normalizeRequiredString(value: unknown, fieldName: string) {
  const text = normalizeOptionalString(value);
  if (!text) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} is required.`,
    );
  }
  return text;
}

function normalizeOptionalString(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function normalizeBoolean(value: unknown, fieldName: string) {
  if (typeof value === 'boolean') {
    return value;
  }
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(text)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(text)) {
    return false;
  }
  throw createHttpError(
    400,
    'VALIDATION_FAILED',
    `${fieldName} must be a boolean.`,
  );
}

function normalizeGuidePagination(filters: any = {}) {
  const page = normalizePositiveInteger(filters.page, 'page', 1);
  const hasPageSize =
    filters.pageSize !== undefined &&
    filters.pageSize !== null &&
    filters.pageSize !== '';
  const hasLegacyLimit =
    filters.limit !== undefined &&
    filters.limit !== null &&
    filters.limit !== '';
  const pageSize = hasPageSize
    ? normalizePositiveInteger(filters.pageSize, 'pageSize', 20, 100)
    : hasLegacyLimit
      ? normalizePositiveInteger(filters.limit, 'limit', 20, 200)
      : 20;
  return { page, pageSize };
}

function normalizePositiveInteger(
  value: unknown,
  fieldName: string,
  fallback: number,
  maximum?: number,
) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 1) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be a positive number.`,
    );
  }
  const integerValue = Math.trunc(numberValue);
  return maximum === undefined
    ? integerValue
    : Math.min(integerValue, maximum);
}

function toGuideDto(guide: any) {
  return {
    id: guide.id,
    name: guide.name,
    phone: guide.phone,
    remarks: guide.remarks,
    isActive: Boolean(guide.isActive),
    createdAt: toIsoString(guide.createdAt),
    updatedAt: toIsoString(guide.updatedAt),
  };
}

function throwGuidePhoneConflict(guide: any): never {
  if (guide && !Boolean(guide.isActive)) {
    throw createHttpError(
      409,
      'GUIDE_DISABLED',
      'The guide using this phone number is disabled. Restore the existing guide instead.',
    );
  }
  throw createHttpError(
    409,
    'GUIDE_PHONE_EXISTS',
    'Guide phone already exists.',
  );
}

function isUniqueConstraintError(error: any) {
  return error?.code === 'P2002';
}

function toIsoString(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value ? String(value) : null;
}

function requireAnyRole(actor: any, roles: string[]) {
  if (
    !actor ||
    (!roles.includes(actor.role) &&
      !(actor.role === 'super_admin' && roles.includes('admin')))
  ) {
    throw createHttpError(
      403,
      'PERMISSION_DENIED',
      'You do not have permission to perform this action.',
    );
  }
}
