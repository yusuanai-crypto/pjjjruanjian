import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import {
  readRetentionPolicy,
  type RetentionPolicy,
} from './retention-policy';

export interface RetentionCleanupOptions {
  apply?: boolean;
  now?: Date | (() => Date);
  policy?: RetentionPolicy;
  taskId?: string;
  logger?: {
    info?(entry: string): unknown;
    log?(entry: string): unknown;
  };
}

export interface RetentionCleanupTargetResult {
  cutoff: string;
  matchedCount: number;
  deletedCount: number;
  batches: number;
}

export interface OperationLogArchiveResult
  extends RetentionCleanupTargetResult {
  archivedCount: number;
  skippedCount: number;
  failedCount: number;
}

export interface RetentionCleanupResult {
  taskId: string;
  mode: 'dry-run' | 'apply';
  startedAt: string;
  finishedAt: string;
  operationLogs: OperationLogArchiveResult;
  aiHistory: RetentionCleanupTargetResult;
}

@Injectable()
export class RetentionCleanupService {
  private readonly policy: RetentionPolicy;

  constructor(private readonly prisma: PrismaService) {
    this.policy = readRetentionPolicy();
  }

  async run(
    options: Omit<RetentionCleanupOptions, 'policy'> = {},
  ): Promise<RetentionCleanupResult> {
    return executeRetentionCleanup(this.prisma, {
      ...options,
      policy: this.policy,
    });
  }
}

export async function executeRetentionCleanup(
  prisma: any,
  options: RetentionCleanupOptions = {},
): Promise<RetentionCleanupResult> {
  const policy = options.policy || readRetentionPolicy();
  const now = resolveNow(options.now);
  const startedAt = now.toISOString();
  const taskId = normalizeTaskId(options.taskId) || crypto.randomUUID();
  const apply = options.apply === true;
  const operationLogCutoff = subtractDays(
    now,
    policy.operationLogRetentionDays,
  );
  const aiHistoryCutoff = subtractDays(
    now,
    policy.aiHistoryRetentionDays,
  );

  const operationLogs = await archiveOperationLogs(
    prisma,
    operationLogCutoff,
    now,
    apply,
    policy.batchSize,
  );
  const aiHistory = await cleanupDelegate(
    prisma?.aiChatMessage,
    aiHistoryCutoff,
    apply,
    policy.batchSize,
  );
  const finishedAt = resolveNow(options.now).toISOString();
  const result: RetentionCleanupResult = {
    taskId,
    mode: apply ? 'apply' : 'dry-run',
    startedAt,
    finishedAt,
    operationLogs,
    aiHistory,
  };
  writeSummary(options.logger, result);
  return result;
}

async function archiveOperationLogs(
  prisma: any,
  cutoff: Date,
  archivedAt: Date,
  apply: boolean,
  batchSize: number,
): Promise<OperationLogArchiveResult> {
  assertCleanupDelegate(prisma?.operationLog);
  assertArchiveDelegate(prisma?.operationLogArchive);
  const where = {
    createdAt: {
      lt: cutoff,
    },
  };
  const matchedCount = await prisma.operationLog.count({ where });
  const base = {
    cutoff: cutoff.toISOString(),
    matchedCount,
    archivedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    deletedCount: 0,
    batches: 0,
  };
  if (!apply || matchedCount === 0) {
    return base;
  }

  while (true) {
    const rows = await prisma.operationLog.findMany({
      where,
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      take: batchSize,
    });
    if (rows.length === 0) {
      break;
    }
    base.batches += 1;
    try {
      const batch = await runTransaction(prisma, async (transaction: any) => {
        const copy = await transaction.operationLogArchive.createMany({
          data: rows.map((row: any) =>
            toArchiveRow(row, archivedAt),
          ),
          skipDuplicates: true,
        });
        const archivedRows =
          await transaction.operationLogArchive.findMany({
            where: {
              id: {
                in: rows.map((row: any) => row.id),
              },
            },
            select: {
              id: true,
            },
          });
        const archivedIds = archivedRows
          .map((row: any) => String(row?.id || '').trim())
          .filter(Boolean);
        const deletion =
          archivedIds.length === 0
            ? { count: 0 }
            : await transaction.operationLog.deleteMany({
                where: {
                  id: {
                    in: archivedIds,
                  },
                },
              });
        return {
          inserted: Math.max(0, Number(copy?.count || 0)),
          archivedIds: archivedIds.length,
          deleted: Math.max(0, Number(deletion?.count || 0)),
        };
      });
      base.archivedCount += batch.inserted;
      base.skippedCount += Math.max(0, rows.length - batch.inserted);
      base.deletedCount += batch.deleted;
      if (batch.archivedIds === 0 || batch.deleted === 0) {
        base.failedCount += rows.length;
        break;
      }
    } catch (_error) {
      // The transaction guarantees that no online row is deleted when the
      // archive copy fails. Only aggregate counts leave this boundary.
      base.failedCount += rows.length;
      break;
    }
  }
  return base;
}

async function cleanupDelegate(
  delegate: any,
  cutoff: Date,
  apply: boolean,
  batchSize: number,
): Promise<RetentionCleanupTargetResult> {
  assertCleanupDelegate(delegate);
  const where = {
    createdAt: {
      lt: cutoff,
    },
  };
  const matchedCount = await delegate.count({ where });
  if (!apply || matchedCount === 0) {
    return {
      cutoff: cutoff.toISOString(),
      matchedCount,
      deletedCount: 0,
      batches: 0,
    };
  }

  let deletedCount = 0;
  let batches = 0;
  while (true) {
    const rows = await delegate.findMany({
      where,
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        id: true,
      },
      take: batchSize,
    });
    const ids = rows
      .map((row: any) => String(row?.id || '').trim())
      .filter(Boolean);
    if (ids.length === 0) {
      break;
    }
    const deletion = await delegate.deleteMany({
      where: {
        id: {
          in: ids,
        },
      },
    });
    const batchDeleted = Number(deletion?.count || 0);
    batches += 1;
    deletedCount += Math.max(0, batchDeleted);
    if (batchDeleted === 0) {
      break;
    }
  }

  return {
    cutoff: cutoff.toISOString(),
    matchedCount,
    deletedCount,
    batches,
  };
}

function toArchiveRow(row: any, archivedAt: Date) {
  return {
    id: row.id,
    userId: row.userId ?? null,
    actorNameSnapshot: row.actorNameSnapshot ?? null,
    actorUsernameSnapshot: row.actorUsernameSnapshot ?? null,
    actorRoleSnapshot: row.actorRoleSnapshot ?? null,
    module: row.module ?? null,
    operationType: row.operationType ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId ?? null,
    result: row.result ?? null,
    beforeData: row.beforeData ?? undefined,
    afterData: row.afterData ?? undefined,
    requestSummary: row.requestSummary ?? undefined,
    sanitizationSummary: row.sanitizationSummary ?? undefined,
    httpMethod: row.httpMethod ?? null,
    requestPath: row.requestPath ?? null,
    requestId: row.requestId ?? null,
    statusCode: row.statusCode ?? null,
    errorCode: row.errorCode ?? null,
    errorMessage: row.errorMessage ?? null,
    userAgent: row.userAgent ?? null,
    durationMs: row.durationMs ?? null,
    ipAddress: row.ipAddress ?? null,
    archivedAt,
    createdAt: row.createdAt,
  };
}

async function runTransaction(
  prisma: any,
  callback: (transaction: any) => Promise<any>,
) {
  if (typeof prisma?.$transaction === 'function') {
    return prisma.$transaction(callback);
  }
  return callback(prisma);
}

function assertCleanupDelegate(delegate: any) {
  if (
    !delegate ||
    typeof delegate.count !== 'function' ||
    typeof delegate.findMany !== 'function' ||
    typeof delegate.deleteMany !== 'function'
  ) {
    const error: any = new Error(
      'Retention cleanup storage delegate is unavailable.',
    );
    error.code = 'RETENTION_CLEANUP_STORE_UNAVAILABLE';
    throw error;
  }
}

function assertArchiveDelegate(delegate: any) {
  if (
    !delegate ||
    typeof delegate.createMany !== 'function' ||
    typeof delegate.findMany !== 'function'
  ) {
    const error: any = new Error(
      'Operation log archive storage delegate is unavailable.',
    );
    error.code = 'OPERATION_LOG_ARCHIVE_STORE_UNAVAILABLE';
    throw error;
  }
}

function subtractDays(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function resolveNow(value: RetentionCleanupOptions['now']): Date {
  const resolved =
    typeof value === 'function'
      ? value()
      : value instanceof Date
        ? value
        : new Date();
  const date = new Date(resolved.getTime());
  if (Number.isNaN(date.getTime())) {
    throw new Error('Retention cleanup clock is invalid.');
  }
  return date;
}

function normalizeTaskId(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(normalized)
    ? normalized
    : null;
}

function writeSummary(
  logger: RetentionCleanupOptions['logger'],
  result: RetentionCleanupResult,
) {
  if (!logger) {
    return;
  }
  const entry = JSON.stringify({
    event: 'retention_cleanup_completed',
    taskId: result.taskId,
    mode: result.mode,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    operationLogs: result.operationLogs,
    aiHistory: result.aiHistory,
  });
  if (typeof logger.info === 'function') {
    logger.info(entry);
  } else if (typeof logger.log === 'function') {
    logger.log(entry);
  }
}
