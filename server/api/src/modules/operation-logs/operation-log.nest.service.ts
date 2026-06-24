import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class OperationLogsNestService {
  constructor(private readonly prisma: PrismaService) {}

  async appendLog(log: any, prisma: any = this.prisma) {
    const created = await prisma.operationLog.create({
      data: {
        id: log.id || crypto.randomUUID(),
        userId: log.userId || null,
        action: String(log.action || '').trim(),
        entityType: String(log.entityType || '').trim(),
        entityId: log.entityId || null,
        beforeData: log.beforeData ?? null,
        afterData: log.afterData ?? null,
        ipAddress: log.ipAddress || null,
        createdAt: log.createdAt ? new Date(log.createdAt) : new Date(),
      },
    });
    return toAppLog(created);
  }

  async listLogs(filters: any = {}) {
    const logs = await this.prisma.operationLog.findMany({
      where: {
        ...(filters.action ? { action: filters.action } : {}),
        ...(filters.entityType ? { entityType: filters.entityType } : {}),
        ...(filters.userId ? { userId: filters.userId } : {}),
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
    return logs.map(toAppLog);
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
