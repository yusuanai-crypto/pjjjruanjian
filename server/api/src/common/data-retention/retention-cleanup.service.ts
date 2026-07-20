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

export interface RetentionCleanupResult {
  taskId: string;
  mode: 'dry-run' | 'apply';
  startedAt: string;
  finishedAt: string;
  operationLogs: RetentionCleanupTargetResult;
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

  const operationLogs = await cleanupDelegate(
    prisma?.operationLog,
    operationLogCutoff,
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
