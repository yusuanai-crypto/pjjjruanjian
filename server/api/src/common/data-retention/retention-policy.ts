import { createHttpError } from '../errors';

export const DEFAULT_OPERATION_LOG_RETENTION_DAYS = 365;
export const MIN_OPERATION_LOG_RETENTION_DAYS = 30;
export const MAX_OPERATION_LOG_RETENTION_DAYS = 3650;
export const DEFAULT_AI_HISTORY_RETENTION_DAYS = 180;
export const MIN_AI_HISTORY_RETENTION_DAYS = 7;
export const MAX_AI_HISTORY_RETENTION_DAYS = 3650;
export const DEFAULT_RETENTION_CLEANUP_BATCH_SIZE = 500;
export const MAX_RETENTION_CLEANUP_BATCH_SIZE = 1000;

export interface RetentionPolicy {
  operationLogRetentionDays: number;
  aiHistoryRetentionDays: number;
  batchSize: number;
}

export function readRetentionPolicy(
  env: Record<string, string | undefined> = process.env,
): RetentionPolicy {
  return {
    operationLogRetentionDays: parseRetentionInteger(
      env.OPERATION_LOG_RETENTION_DAYS,
      DEFAULT_OPERATION_LOG_RETENTION_DAYS,
      MIN_OPERATION_LOG_RETENTION_DAYS,
      MAX_OPERATION_LOG_RETENTION_DAYS,
      'OPERATION_LOG_RETENTION_DAYS',
    ),
    aiHistoryRetentionDays: parseRetentionInteger(
      env.AI_HISTORY_RETENTION_DAYS,
      DEFAULT_AI_HISTORY_RETENTION_DAYS,
      MIN_AI_HISTORY_RETENTION_DAYS,
      MAX_AI_HISTORY_RETENTION_DAYS,
      'AI_HISTORY_RETENTION_DAYS',
    ),
    batchSize: parseRetentionInteger(
      env.RETENTION_CLEANUP_BATCH_SIZE,
      DEFAULT_RETENTION_CLEANUP_BATCH_SIZE,
      1,
      MAX_RETENTION_CLEANUP_BATCH_SIZE,
      'RETENTION_CLEANUP_BATCH_SIZE',
    ),
  };
}

export function parseRetentionInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  envName: string,
): number {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    return fallback;
  }
  const parsed = Number(normalized);
  if (
    !Number.isInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw createHttpError(
      500,
      'DATA_RETENTION_CONFIG_INVALID',
      `${envName} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return parsed;
}
