import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { sanitizeOperationLogData } from './audit-data-sanitizer';
import { parseOperationLogPagination } from './operation-log-policy';

@Injectable()
export class OperationLogsNestService {
  constructor(private readonly prisma: PrismaService) {}

  async appendLog(log: any, prisma: any = this.prisma) {
    const sanitized = sanitizeOperationLogData(log);
    const created = await prisma.operationLog.create({
      data: {
        id: log.id || crypto.randomUUID(),
        userId: log.userId || null,
        action: String(log.action || '').trim(),
        entityType: String(log.entityType || '').trim(),
        entityId: log.entityId || null,
        beforeData: sanitized.beforeData,
        afterData: sanitized.afterData,
        sanitizationSummary: sanitized.sanitizationSummary,
        ipAddress: log.ipAddress || null,
        createdAt: log.createdAt ? new Date(log.createdAt) : new Date(),
      },
    });
    return toAppLog(created);
  }

  async listLogs(filters: any = {}) {
    const { page, pageSize } = parseOperationLogPagination(filters);
    const where = {
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.userId ? { userId: filters.userId } : {}),
    };
    const total = await this.prisma.operationLog.count({ where });
    const logs = await this.prisma.operationLog.findMany({
      where,
      orderBy: {
        createdAt: 'asc',
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      logs: logs.map(toAppLog),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}

function toAppLog(log: any) {
  return {
    id: log.id,
    userId: log.userId,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    beforeData: log.beforeData,
    afterData: log.afterData,
    ipAddress: log.ipAddress,
    createdAt: log.createdAt instanceof Date ? log.createdAt.toISOString() : String(log.createdAt),
  };
}
