import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';

@Injectable()
export class TravelAgenciesNestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsNestService,
  ) {}

  async listTravelAgencies(actor: any, filters: any = {}) {
    requireAnyRole(actor, ['admin', 'front_desk', 'sales', 'finance']);
    const agencies = await this.prisma.travelAgency.findMany({
      where: buildTravelAgencyWhere(filters),
      orderBy: {
        name: 'asc',
      },
      take: normalizeTake(filters.limit, 100),
    });
    return agencies.map(toTravelAgencyDto);
  }

  async createTravelAgency(actor: any, payload: any, metadata: any = {}) {
    requireAnyRole(actor, ['admin', 'front_desk']);
    const data = buildTravelAgencyData(payload);
    const existing = await this.prisma.travelAgency.findUnique({
      where: {
        name: data.name,
      },
    });
    if (existing) {
      throw createHttpError(
        409,
        'TRAVEL_AGENCY_NAME_EXISTS',
        'Travel agency name already exists.',
      );
    }

    const created = await this.prisma.travelAgency.create({
      data,
    });
    const dto = toTravelAgencyDto(created);
    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'travel_agencies.create',
      entityType: 'travel_agency',
      entityId: created.id,
      afterData: dto,
      ipAddress: metadata.ipAddress || null,
    });
    return dto;
  }
}

function buildTravelAgencyWhere(filters: any = {}) {
  const where: any = {};
  const keyword = normalizeOptionalString(
    filters.keyword || filters.query || filters.search,
  );
  if (keyword) {
    where.OR = [
      { name: { contains: keyword } },
      { contactName: { contains: keyword } },
      { contactPhone: { contains: keyword } },
      { notes: { contains: keyword } },
    ];
  }
  return where;
}

function buildTravelAgencyData(payload: any) {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    name: normalizeLimitedRequiredString(payload?.name, 'name', 120),
    contactName: normalizeLimitedOptionalString(
      payload?.contactName,
      'contactName',
      80,
    ),
    contactPhone: normalizeLimitedOptionalString(
      payload?.contactPhone,
      'contactPhone',
      30,
    ),
    notes: normalizeOptionalString(payload?.notes),
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeLimitedRequiredString(
  value: unknown,
  fieldName: string,
  maxLength: number,
) {
  const text = normalizeOptionalString(value);
  if (!text) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} is required.`,
    );
  }
  if (text.length > maxLength) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be ${maxLength} characters or fewer.`,
    );
  }
  return text;
}

function normalizeLimitedOptionalString(
  value: unknown,
  fieldName: string,
  maxLength: number,
) {
  const text = normalizeOptionalString(value);
  if (text && text.length > maxLength) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be ${maxLength} characters or fewer.`,
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

function normalizeTake(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw createHttpError(400, 'VALIDATION_FAILED', 'limit must be a number.');
  }
  return Math.min(Math.max(Math.trunc(numberValue), 1), 200);
}

function toTravelAgencyDto(agency: any) {
  return {
    id: agency.id,
    name: agency.name,
    contactName: agency.contactName || null,
    contactPhone: agency.contactPhone || null,
    notes: agency.notes || null,
    createdAt: toIsoString(agency.createdAt),
    updatedAt: toIsoString(agency.updatedAt),
  };
}

function toIsoString(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value ? String(value) : null;
}

function requireAnyRole(actor: any, roles: string[]) {
  if (!actor || !roles.includes(actor.role)) {
    throw createHttpError(
      403,
      'PERMISSION_DENIED',
      'You do not have permission to perform this action.',
    );
  }
}
