import { Injectable } from '@nestjs/common';

import { createHttpError } from '../../common/errors';
import { AiConfig, AiConfigService } from './ai-config';
import { buildAiPromptMessages } from './ai-prompt.builder';
import { formatAiResponse } from './ai-response.formatter';

export interface AiModelToolResult {
  toolName: string;
  data?: unknown;
  sourceSummary?: {
    rowCount?: number;
    dateFrom?: string;
    dateTo?: string;
    globalMarkedFilterEnabled?: boolean;
    scopeDescription?: string;
  };
  warnings?: string[];
}

export interface AiModelGenerateInput {
  question?: string;
  userRole?: string;
  intent?: string | null;
  dateRange?: {
    preset?: string;
    dateFrom?: string;
    dateTo?: string;
    timezone?: string;
  };
  policy?: {
    globalMarkedFilterEnabled?: boolean;
    scopeDescription?: string;
  };
  toolResults?: AiModelToolResult[];
  warnings?: string[];
}

export interface AiModelGenerateResult {
  answer: string;
  modelProvider: string;
  modelName: string;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number;
  warnings: string[];
}

export interface AiModelGenerateOptions {
  config?: AiConfig;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const MOCK_PROVIDER = 'mock';
const MOCK_MODEL_NAME = 'jiangjiu-ai-mock';

@Injectable()
export class AiModelClient {
  constructor(private readonly configService: AiConfigService) {}

  async generateAnswer(
    input: AiModelGenerateInput,
    options: AiModelGenerateOptions = {},
  ): Promise<AiModelGenerateResult> {
    const config = options.config ?? this.configService.getConfig();
    const now = options.now ?? Date.now;
    const startedAt = now();

    assertAiEnabled(config);

    if (config.mockMode) {
      return generateMockAnswer(input, {
        startedAt,
        now,
      });
    }

    assertProviderConfig(config);

    return this.generateWithProvider(input, config, {
      startedAt,
      now,
      fetchImpl: options.fetchImpl,
    });
  }

  private async generateWithProvider(
    input: AiModelGenerateInput,
    config: AiConfig,
    options: {
      startedAt: number;
      now: () => number;
      fetchImpl?: typeof fetch;
    },
  ): Promise<AiModelGenerateResult> {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw createHttpError(
        503,
        'AI_PROVIDER_UNAVAILABLE',
        'AI provider HTTP client is unavailable.',
      );
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => {
      controller.abort();
    }, config.timeoutMs);

    try {
      const response = await fetchImpl(resolveProviderUrl(config), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildProviderPayload(input, config)),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw createHttpError(
          502,
          'AI_PROVIDER_REQUEST_FAILED',
          `AI provider request failed with status ${response.status}.`,
        );
      }

      const payload = await response.json();
      const answer = extractProviderAnswer(payload);
      if (!answer) {
        throw createHttpError(
          502,
          'AI_PROVIDER_RESPONSE_INVALID',
          'AI provider response did not include an answer.',
        );
      }

      return {
        answer,
        modelProvider: config.provider || 'custom',
        modelName: config.model || 'unknown',
        promptTokens: readTokenCount(payload, 'prompt_tokens'),
        completionTokens: readTokenCount(payload, 'completion_tokens'),
        latencyMs: Math.max(0, options.now() - options.startedAt),
        warnings: normalizeWarnings(input.warnings),
      };
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw createHttpError(
          504,
          'AI_MODEL_TIMEOUT',
          'AI provider request timed out.',
        );
      }
      if (error?.code && error?.statusCode) {
        throw error;
      }
      throw createHttpError(
        502,
        'AI_PROVIDER_REQUEST_FAILED',
        'AI provider request failed.',
      );
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

export function assertAiEnabled(config: AiConfig) {
  if (!config.enabled) {
    throw createHttpError(
      503,
      'AI_DISABLED',
      'AI data assistant is disabled.',
    );
  }
}

export function generateMockAnswer(
  input: AiModelGenerateInput,
  options: { startedAt?: number; now?: () => number } = {},
): AiModelGenerateResult {
  const now = options.now ?? Date.now;
  const startedAt = options.startedAt ?? now();
  const warnings = collectWarnings(input);
  const prompt = buildAiPromptMessages(input);
  const answer = formatAiResponse({
    ...input,
    intent: normalizeIntent(input.intent),
    warnings,
  });

  return {
    answer,
    modelProvider: MOCK_PROVIDER,
    modelName: MOCK_MODEL_NAME,
    promptTokens: estimateTokens(prompt.userPrompt),
    completionTokens: estimateTokens(answer),
    latencyMs: Math.max(0, now() - startedAt),
    warnings,
  };
}

function assertProviderConfig(config: AiConfig) {
  if (!config.apiKey) {
    throw createHttpError(
      503,
      'AI_PROVIDER_API_KEY_REQUIRED',
      'AI provider API key is not configured.',
    );
  }
  if (!config.baseUrl) {
    throw createHttpError(
      503,
      'AI_PROVIDER_BASE_URL_REQUIRED',
      'AI provider base URL is not configured.',
    );
  }
  if (!config.model) {
    throw createHttpError(
      503,
      'AI_PROVIDER_MODEL_REQUIRED',
      'AI provider model is not configured.',
    );
  }
}

function resolveProviderUrl(config: AiConfig): string {
  const baseUrl = config.baseUrl as string;
  if (/\/chat\/completions\/?$/.test(baseUrl)) {
    return baseUrl;
  }
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

function buildProviderPayload(input: AiModelGenerateInput, config: AiConfig) {
  return {
    model: config.model,
    messages: buildAiPromptMessages(input).messages,
    temperature: 0.2,
  };
}

function extractProviderAnswer(payload: any): string | null {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) {
    return content.trim();
  }
  const text = payload?.choices?.[0]?.text;
  if (typeof text === 'string' && text.trim()) {
    return text.trim();
  }
  if (typeof payload?.answer === 'string' && payload.answer.trim()) {
    return payload.answer.trim();
  }
  return null;
}

function readTokenCount(payload: any, key: string): number | null {
  const direct = payload?.usage?.[key];
  if (Number.isInteger(direct)) {
    return direct;
  }
  return null;
}

function collectWarnings(input: AiModelGenerateInput): string[] {
  const warnings = [
    ...normalizeWarnings(input.warnings),
    ...(Array.isArray(input.toolResults)
      ? input.toolResults.flatMap((result) => normalizeWarnings(result.warnings))
      : []),
  ];
  return Array.from(new Set(warnings));
}

function normalizeWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeString(item))
    .filter((item): item is string => Boolean(item));
}

function normalizeIntent(value: unknown): string {
  return normalizeString(value) || 'unknown';
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function estimateTokens(value: string): number {
  if (!value) {
    return 0;
  }
  return Math.max(1, Math.ceil(value.length / 4));
}
