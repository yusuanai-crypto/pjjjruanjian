import { Injectable } from '@nestjs/common';

import { createHttpError } from '../../common/errors';

export interface AiConfig {
  enabled: boolean;
  mockMode: boolean;
  provider: string | null;
  apiKey: string | null;
  baseUrl: string | null;
  model: string | null;
  timeoutMs: number;
  maxQuestionLength: number;
  dailyLimitPerUser: number;
  historyRetentionDays: number;
}

export interface SafeAiConfig {
  enabled: boolean;
  mockMode: boolean;
  provider: string | null;
  hasApiKey: boolean;
  baseUrl: string | null;
  model: string | null;
  timeoutMs: number;
  maxQuestionLength: number;
  dailyLimitPerUser: number;
  historyRetentionDays: number;
}

const DEFAULT_AI_TIMEOUT_MS = 20_000;
const DEFAULT_AI_MAX_QUESTION_LENGTH = 500;
const DEFAULT_AI_DAILY_LIMIT_PER_USER = 100;
const DEFAULT_AI_HISTORY_RETENTION_DAYS = 180;

export function readAiConfig(
  env: Record<string, string | undefined> = process.env,
): AiConfig {
  return {
    enabled: parseBooleanEnv(env.AI_ENABLED, false, 'AI_ENABLED'),
    mockMode: parseBooleanEnv(env.AI_MOCK_MODE, true, 'AI_MOCK_MODE'),
    provider: normalizeOptionalString(env.AI_PROVIDER),
    apiKey: normalizeOptionalString(env.AI_API_KEY),
    baseUrl: normalizeOptionalString(env.AI_BASE_URL),
    model: normalizeOptionalString(env.AI_MODEL),
    timeoutMs: parsePositiveIntegerEnv(
      env.AI_TIMEOUT_MS,
      DEFAULT_AI_TIMEOUT_MS,
      'AI_TIMEOUT_MS',
    ),
    maxQuestionLength: parsePositiveIntegerEnv(
      env.AI_MAX_QUESTION_LENGTH,
      DEFAULT_AI_MAX_QUESTION_LENGTH,
      'AI_MAX_QUESTION_LENGTH',
    ),
    dailyLimitPerUser: parsePositiveIntegerEnv(
      env.AI_DAILY_LIMIT_PER_USER,
      DEFAULT_AI_DAILY_LIMIT_PER_USER,
      'AI_DAILY_LIMIT_PER_USER',
    ),
    historyRetentionDays: parsePositiveIntegerEnv(
      env.AI_HISTORY_RETENTION_DAYS,
      DEFAULT_AI_HISTORY_RETENTION_DAYS,
      'AI_HISTORY_RETENTION_DAYS',
    ),
  };
}

export function toSafeAiConfig(config: AiConfig): SafeAiConfig {
  return {
    enabled: config.enabled,
    mockMode: config.mockMode,
    provider: config.provider,
    hasApiKey: Boolean(config.apiKey),
    baseUrl: config.baseUrl,
    model: config.model,
    timeoutMs: config.timeoutMs,
    maxQuestionLength: config.maxQuestionLength,
    dailyLimitPerUser: config.dailyLimitPerUser,
    historyRetentionDays: config.historyRetentionDays,
  };
}

@Injectable()
export class AiConfigService {
  getConfig(): AiConfig {
    return readAiConfig();
  }

  getSafeConfig(): SafeAiConfig {
    return toSafeAiConfig(this.getConfig());
  }
}

function normalizeOptionalString(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseBooleanEnv(
  value: string | undefined,
  defaultValue: boolean,
  envName: string,
): boolean {
  const normalized = normalizeOptionalString(value);
  if (normalized === null) {
    return defaultValue;
  }
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized.toLowerCase())) {
    return true;
  }
  if (['false', '0', 'no', 'n', 'off'].includes(normalized.toLowerCase())) {
    return false;
  }
  throw createHttpError(
    500,
    'AI_CONFIG_INVALID',
    `${envName} must be true or false.`,
  );
}

function parsePositiveIntegerEnv(
  value: string | undefined,
  defaultValue: number,
  envName: string,
): number {
  const normalized = normalizeOptionalString(value);
  if (normalized === null) {
    return defaultValue;
  }
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw createHttpError(
      500,
      'AI_CONFIG_INVALID',
      `${envName} must be a positive integer.`,
    );
  }
  return parsed;
}
