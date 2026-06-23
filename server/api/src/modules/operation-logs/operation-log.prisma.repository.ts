export function createPrismaOperationLogRepository(prisma: any) {
  return {
    async appendLog(log: any) {
      const created = await prisma.operationLog.create({
        data: {
          id: log.id,
          userId: log.userId || null,
          action: log.action,
          entityType: log.entityType,
          entityId: log.entityId || null,
          beforeData: log.beforeData ?? null,
          afterData: log.afterData ?? null,
          ipAddress: log.ipAddress || null,
          createdAt: log.createdAt ? new Date(log.createdAt) : new Date(),
        },
      });
      return toAppLog(created);
    },

    async listLogs(filters: any = {}) {
      const logs = await prisma.operationLog.findMany({
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
    },
  };
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
