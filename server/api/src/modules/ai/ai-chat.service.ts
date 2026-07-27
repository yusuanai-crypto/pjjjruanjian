import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import {
  createHttpError,
  isExpectedHttpError,
} from '../../common/errors';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  sanitizeAiText,
  sanitizeAuditData,
} from '../operation-logs/audit-data-sanitizer';
import { AiConfigService } from './ai-config';
import { AiIntentService, type AiIntentParseResult } from './ai-intent.service';
import {
  AiModelClient,
  type AiModelGenerateResult,
} from './ai-model.client';
import {
  AiPolicyService,
  type AiPolicyDecision,
} from './ai-policy.service';
import { AiPromptBuilder } from './ai-prompt.builder';
import {
  AiResponseFormatter,
  formatHistoricalAiAnswer,
  sanitizeAiUserWarnings,
} from './ai-response.formatter';
import {
  AiToolsService,
  type AiToolInput,
  type AiToolName,
  type AiToolResult,
} from './ai-tools.service';

export interface AiChatRequestBody {
  question?: unknown;
  conversationId?: unknown;
}

export interface AiChatResponse {
  answer: string;
  intent: string;
  range: AiIntentParseResult['dateRange'];
  sourceSummary: AiChatSourceSummary[];
  warnings: string[];
}

export interface AiChatSourceSummary {
  toolName: string;
  rowCount: number;
  dateFrom?: string;
  dateTo?: string;
  globalMarkedFilterEnabled: boolean;
  scopeDescription: string;
}

export interface AiChatHistoryQuery {
  page?: unknown;
  pageSize?: unknown;
  conversationId?: unknown;
  intent?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
}

export interface AiChatHistoryResponse {
  items: AiChatHistoryItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AiChatHistoryItem {
  id: string;
  conversationId: string;
  question: string;
  answer: string;
  intent: string;
  dataScope: Record<string, unknown> | null;
  toolCalls: AiChatHistoryToolCall[];
  sourceSummary: AiChatSourceSummary[];
  warnings: string[];
  modelProvider: string | null;
  modelName: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number | null;
  errorCode: string | null;
  createdAt: string;
}

export interface AiChatHistoryToolCall {
  toolName: string;
  rowCount: number;
  globalMarkedFilterEnabled: boolean;
  warnings: string[];
}

export interface AiCapabilitiesResponse {
  enabled: boolean;
  role: string;
  roleAllowed: boolean;
  canUseAi: boolean;
  scopeDescription: string;
  allowedIntents: string[];
  tools: Array<{
    toolName: string;
    intent: string;
    readOnly: true;
    description: string;
  }>;
  limits: {
    maxQuestionLength: number;
    dailyLimitPerUser: number;
    historyRetentionDays: number;
    timeoutMs: number;
    historyPageSizeDefault: number;
    historyPageSizeMax: number;
  };
  model: {
    mockMode: boolean;
    provider: string | null;
    modelName: string | null;
    hasApiKey: boolean;
  };
  constraints: {
    readOnly: true;
    historyScope: 'self';
    canGenerateSql: false;
    canExecuteSql: false;
    canWriteBusinessData: false;
  };
}

interface AiChatExecutionState {
  actor: {
    id?: string | null;
    role: string;
  };
  question: string;
  conversationId: string;
  parsed: AiIntentParseResult;
  policy: AiPolicyDecision;
}

const INTENT_TOOL_MAP: Record<string, AiToolName[]> = {
  analytics_overview: ['analytics.overview'],
  analytics_trend: ['analytics.trends'],
  taster_ranking: ['analytics.tasterRankings'],
  taster_detail: ['analytics.tasterDetail'],
  finance_summary: ['finance.summary'],
  commission_query: ['commission.query'],
  refund_query: ['refund.query'],
  customer_lookup: ['customer.lookup'],
  customer_order_lookup: ['customer.orderLookup'],
  after_sales_lookup: ['afterSales.lookup'],
  logistics_lookup: ['logistics.lookup'],
  management_suggestion: [
    'analytics.overview',
    'analytics.trends',
    'analytics.tasterRankings',
    'refund.query',
  ],
};

const FALLBACK_MODEL_RESULT: Omit<AiModelGenerateResult, 'answer' | 'warnings'> =
  {
    modelProvider: 'fallback',
    modelName: 'template',
    promptTokens: null,
    completionTokens: null,
    latencyMs: 0,
  };

const HISTORY_DEFAULT_PAGE = 1;
const HISTORY_DEFAULT_PAGE_SIZE = 20;
const HISTORY_MAX_PAGE_SIZE = 50;

@Injectable()
export class AiChatService {
  constructor(
    private readonly configService: AiConfigService,
    private readonly intentService: AiIntentService,
    private readonly policyService: AiPolicyService,
    private readonly toolsService: AiToolsService,
    private readonly promptBuilder: AiPromptBuilder,
    private readonly modelClient: AiModelClient,
    private readonly responseFormatter: AiResponseFormatter,
    private readonly prisma: PrismaService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  async sendChat(actor: any, body: AiChatRequestBody): Promise<AiChatResponse> {
    try {
      return await this.executeChat(actor, body);
    } catch (error: any) {
      if (isExpectedHttpError(error)) {
        throw error;
      }
      throw createHttpError(
        500,
        'AI_CHAT_FAILED',
        'AI chat request failed.',
        { cause: error },
      );
    }
  }

  async listHistory(
    actor: any,
    query: AiChatHistoryQuery = {},
  ): Promise<AiChatHistoryResponse> {
    if (!this.policyService.canUseAi(actor)) {
      throw createHttpError(
        403,
        'AI_ROLE_NOT_ALLOWED',
        'This role cannot use the AI assistant in the first version.',
      );
    }

    const userId = normalizeActorId(actor);
    const page = parsePositiveIntegerQuery(
      query.page,
      HISTORY_DEFAULT_PAGE,
      Number.MAX_SAFE_INTEGER,
      'page',
    );
    const pageSize = parsePositiveIntegerQuery(
      query.pageSize,
      HISTORY_DEFAULT_PAGE_SIZE,
      HISTORY_MAX_PAGE_SIZE,
      'pageSize',
    );
    const where = buildHistoryWhere(userId, query);
    const delegate = (this.prisma as any).aiChatMessage;
    const total = await countAiChatMessages(delegate, where);
    const rows = await delegate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        conversationId: true,
        question: true,
        answer: true,
        intent: true,
        dataScope: true,
        toolCalls: true,
        sourceSummary: true,
        warnings: true,
        modelProvider: true,
        modelName: true,
        promptTokens: true,
        completionTokens: true,
        latencyMs: true,
        errorCode: true,
        createdAt: true,
      },
    });

    return {
      items: rows.map(toHistoryItem),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  getCapabilities(actor: any): AiCapabilitiesResponse {
    const config = this.configService.getConfig();
    const role = normalizeRoleForRecord(actor?.role);
    const roleAllowed = this.policyService.canUseAi(actor);
    const allowedIntents = roleAllowed
      ? this.policyService.getAllowedIntents(actor)
      : [];
    const tools = roleAllowed
      ? this.toolsService
          .listToolDefinitions()
          .filter((tool) => this.policyService.canUseIntent(actor, tool.intent))
      : [];

    return {
      enabled: config.enabled,
      role,
      roleAllowed,
      canUseAi: config.enabled && roleAllowed,
      scopeDescription: this.policyService.getScopeDescription(actor),
      allowedIntents,
      tools,
      limits: {
        maxQuestionLength: config.maxQuestionLength,
        dailyLimitPerUser: config.dailyLimitPerUser,
        historyRetentionDays: config.historyRetentionDays,
        timeoutMs: config.timeoutMs,
        historyPageSizeDefault: HISTORY_DEFAULT_PAGE_SIZE,
        historyPageSizeMax: HISTORY_MAX_PAGE_SIZE,
      },
      model: {
        mockMode: config.mockMode,
        provider: config.provider,
        modelName: config.model,
        hasApiKey: Boolean(config.apiKey),
      },
      constraints: {
        readOnly: true,
        historyScope: 'self',
        canGenerateSql: false,
        canExecuteSql: false,
        canWriteBusinessData: false,
      },
    };
  }

  private async executeChat(
    actor: any,
    body: AiChatRequestBody,
  ): Promise<AiChatResponse> {
    const config = this.configService.getConfig();
    if (!config.enabled) {
      throw createHttpError(
        503,
        'AI_DISABLED',
        'AI data assistant is disabled.',
      );
    }

    const question = normalizeQuestion(body?.question);
    if (!question) {
      throw createHttpError(
        400,
        'AI_QUESTION_REQUIRED',
        'question is required.',
      );
    }
    if (question.length > config.maxQuestionLength) {
      throw createHttpError(
        400,
        'AI_QUESTION_TOO_LONG',
        `question must be ${config.maxQuestionLength} characters or fewer.`,
      );
    }

    if (!this.policyService.canUseAi(actor)) {
      throw createHttpError(
        403,
        'AI_ROLE_NOT_ALLOWED',
        'This role cannot use the AI assistant in the first version.',
      );
    }

    await this.rateLimitService.enforceAi({
      userId: normalizeActorId(actor),
      dailyLimit: config.dailyLimitPerUser,
    });

    const parsed = this.intentService.parseQuestion(question);
    const policy = this.policyService.evaluateRequest(actor, {
      intent: parsed.intent,
      question,
    });
    const state: AiChatExecutionState = {
      actor: {
        id: actor?.id ?? actor?.userId ?? null,
        role: String(actor?.role || ''),
      },
      question,
      conversationId: normalizeConversationId(body?.conversationId),
      parsed,
      policy,
    };

    if (!policy.allowed) {
      return this.buildAndSavePolicyRefusal(state);
    }

    const toolNames = selectToolsForIntent(parsed.intent);
    const toolInput = buildToolInput(state);
    let toolResults: AiToolResult[] = [];
    let warnings = [...parsed.warnings, ...policy.warnings];
    let errorCode: string | null = null;

    try {
      toolResults = await executeTools(this.toolsService, toolNames, toolInput);
    } catch (error: any) {
      errorCode = safeAiErrorCode(error, 'AI_TOOL_FAILED');
      warnings = appendWarning(
        warnings,
        '数据工具暂时不可用，已返回模板化回答。',
      );
      const fallbackAnswer = this.responseFormatter.formatAnswer(
        buildModelInput(state, [], warnings),
      );
      await this.saveChatMessage(state, {
        answer: fallbackAnswer,
        toolResults: [],
        warnings,
        modelResult: {
          ...FALLBACK_MODEL_RESULT,
          answer: fallbackAnswer,
          warnings,
        },
        errorCode,
      });
      return buildResponse(state, fallbackAnswer, [], warnings);
    }

    warnings = appendWarnings(
      warnings,
      toolResults.flatMap((result) => result.warnings || []),
    );

    const modelInput = buildModelInput(state, toolResults, warnings);
    this.promptBuilder.buildMessages(modelInput);

    let modelResult: AiModelGenerateResult;
    try {
      modelResult = await this.modelClient.generateAnswer(modelInput);
      warnings = appendWarnings(warnings, modelResult.warnings);
    } catch (error: any) {
      errorCode = safeAiErrorCode(error, 'AI_MODEL_FAILED');
      warnings = appendWarning(
        warnings,
        'AI 模型暂时不可用，已使用模板化回答。',
      );
      const fallbackAnswer = this.responseFormatter.formatAnswer({
        ...modelInput,
        warnings,
      });
      modelResult = {
        ...FALLBACK_MODEL_RESULT,
        answer: fallbackAnswer,
        warnings,
      };
    }

    const answer = this.responseFormatter.ensureCompliantAnswer(
      modelResult.answer,
      modelInput,
    );
    modelResult = {
      ...modelResult,
      answer,
    };

    await this.saveChatMessage(state, {
      answer,
      toolResults,
      warnings,
      modelResult,
      errorCode,
    });

    return buildResponse(state, answer, toolResults, warnings);
  }

  private async buildAndSavePolicyRefusal(
    state: AiChatExecutionState,
  ): Promise<AiChatResponse> {
    const intent = state.policy.rejectionIntent || state.parsed.intent;
    const warnings = sanitizeAiUserWarnings(
      appendWarnings(state.parsed.warnings, state.policy.warnings),
    );
    const answer = this.responseFormatter.formatRefusal(
      {
        userRole: state.actor.role,
        intent,
        question: sanitizeAiHistoryText(state.question),
        dateRange: state.parsed.dateRange || undefined,
        policy: {
          globalMarkedFilterEnabled: false,
          scopeDescription: state.policy.scopeDescription,
        },
        toolResults: [],
        warnings,
      },
      getRefusalReason(state.policy.code),
    );
    const modelResult: AiModelGenerateResult = {
      answer,
      modelProvider: 'policy',
      modelName: 'policy_refusal',
      promptTokens: null,
      completionTokens: null,
      latencyMs: 0,
      warnings,
    };

    await this.saveChatMessage(
      {
        ...state,
        parsed: {
          ...state.parsed,
          intent: intent as any,
        },
      },
      {
        answer,
        toolResults: [],
        warnings,
        modelResult,
        errorCode: state.policy.code,
      },
    );

    return {
      answer,
      intent,
      range: state.parsed.dateRange,
      sourceSummary: [],
      warnings,
    };
  }

  private async saveChatMessage(
    state: AiChatExecutionState,
    input: {
      answer: string;
      toolResults: AiToolResult[];
      warnings: string[];
      modelResult: AiModelGenerateResult;
      errorCode: string | null;
    },
  ) {
    try {
      const sanitizedQuestion = sanitizeAiHistoryText(state.question);
      const complianceInput = buildModelInput(
        state,
        input.toolResults,
        input.warnings,
      );
      const sanitizedAnswer = sanitizeAiHistoryText(
        this.responseFormatter.ensureCompliantAnswer(
          input.answer,
          complianceInput,
        ),
        8000,
      );
      const sanitizedWarnings = sanitizeAiUserWarnings(input.warnings);
      await (this.prisma as any).aiChatMessage.create({
        data: {
          conversationId: state.conversationId,
          userId: state.actor.id,
          userRole: normalizeRoleForRecord(state.actor.role),
          question: sanitizedQuestion,
          answer: sanitizedAnswer,
          intent: state.parsed.intent,
          dataScope: sanitizeAuditData({
            range: state.parsed.dateRange,
            policy: {
              code: state.policy.code,
              scopeDescription: state.policy.scopeDescription,
            },
          }),
          toolCalls: sanitizeAuditData(
            input.toolResults.map((result) => ({
              toolName: result.toolName,
              rowCount: result.sourceSummary?.rowCount ?? 0,
              globalMarkedFilterEnabled: Boolean(
                result.sourceSummary?.globalMarkedFilterEnabled,
              ),
              warnings: (result.warnings || []).map((warning) =>
                sanitizeAiHistoryText(warning),
              ),
            })),
          ),
          sourceSummary: sanitizeAuditData(
            buildSourceSummary(input.toolResults),
          ),
          warnings: sanitizeAuditData(sanitizedWarnings),
          modelProvider: input.modelResult.modelProvider,
          modelName: input.modelResult.modelName,
          promptTokens: input.modelResult.promptTokens,
          completionTokens: input.modelResult.completionTokens,
          latencyMs: input.modelResult.latencyMs,
          errorCode: input.errorCode,
        },
      });
    } catch (_error) {
      throw createHttpError(
        500,
        'AI_CHAT_RECORD_SAVE_FAILED',
        'AI chat message could not be saved.',
      );
    }
  }
}

function selectToolsForIntent(intent: string): AiToolName[] {
  return INTENT_TOOL_MAP[intent] || [];
}

async function executeTools(
  toolsService: AiToolsService,
  toolNames: AiToolName[],
  input: AiToolInput,
): Promise<AiToolResult[]> {
  const results: AiToolResult[] = [];
  for (const toolName of toolNames) {
    results.push(await toolsService.executeTool(toolName, input));
  }
  return results;
}

function buildToolInput(state: AiChatExecutionState): AiToolInput {
  const filters = buildFiltersFromQuestion(state.question, state.parsed.intent);
  return {
    actor: {
      userId: state.actor.id,
      role: state.actor.role,
    },
    range: state.parsed.dateRange
      ? {
          preset: state.parsed.dateRange.preset,
          dateFrom: state.parsed.dateRange.dateFrom,
          dateTo: state.parsed.dateRange.dateTo,
        }
      : null,
    filters,
    limit: state.parsed.limit,
  };
}

function buildFiltersFromQuestion(
  question: string,
  intent: string,
): Record<string, unknown> {
  if (
    intent === 'customer_lookup' ||
    intent === 'customer_order_lookup' ||
    intent === 'after_sales_lookup' ||
    intent === 'logistics_lookup'
  ) {
    const identifiers = extractLookupIdentifiers(question);
    const query =
      (intent === 'logistics_lookup' && identifiers.logisticsNo) ||
      (intent === 'after_sales_lookup' && identifiers.afterSalesNo) ||
      identifiers.orderNo ||
      identifiers.phone ||
      identifiers.logisticsNo ||
      identifiers.afterSalesNo ||
      question;
    return {
      query,
      ...identifiers,
    };
  }
  return {};
}

function extractLookupIdentifiers(question: string): Record<string, string> {
  const normalized = String(question || '').normalize('NFKC');
  const result: Record<string, string> = {};
  const phone = normalized.match(/\b1[3-9]\d{2,9}\b/)?.[0];
  const orderNo = normalized.match(/\bSO[A-Z0-9_-]*\d[A-Z0-9_-]*\b/i)?.[0];
  const afterSalesNo = normalized.match(/\bAS[A-Z0-9_-]*\d[A-Z0-9_-]*\b/i)?.[0];
  const logisticsNo = normalized.match(
    /\b(?:SF|YT|YD|ANE|JD|ZTO|STO|YTO|EMS)[A-Z0-9_-]{4,}\b/i,
  )?.[0];

  if (phone) {
    result.phone = phone;
    result.customerPhone = phone;
  }
  if (orderNo) {
    result.orderNo = orderNo;
    result.salesOrderNo = orderNo;
  }
  if (afterSalesNo) {
    result.afterSalesNo = afterSalesNo;
  }
  if (logisticsNo) {
    result.logisticsNo = logisticsNo;
  }
  return result;
}

function buildModelInput(
  state: AiChatExecutionState,
  toolResults: AiToolResult[],
  warnings: string[],
) {
  return {
    userRole: state.actor.role,
    intent: state.parsed.intent,
    question: sanitizeAiHistoryText(state.question),
    dateRange: state.parsed.dateRange || undefined,
    policy: {
      globalMarkedFilterEnabled: toolResults.some(
        (result) => result.sourceSummary?.globalMarkedFilterEnabled,
      ),
      scopeDescription: state.policy.scopeDescription,
    },
    toolResults,
    warnings,
  };
}

function buildResponse(
  state: AiChatExecutionState,
  answer: string,
  toolResults: AiToolResult[],
  warnings: string[],
): AiChatResponse {
  return {
    answer,
    intent: state.parsed.intent,
    range: state.parsed.dateRange,
    sourceSummary: buildSourceSummary(toolResults),
    warnings: sanitizeAiUserWarnings(warnings),
  };
}

function buildSourceSummary(toolResults: AiToolResult[]): AiChatSourceSummary[] {
  return toolResults.map((result) => ({
    toolName: result.toolName,
    rowCount: result.sourceSummary?.rowCount ?? 0,
    ...(result.sourceSummary?.dateFrom
      ? { dateFrom: result.sourceSummary.dateFrom }
      : {}),
    ...(result.sourceSummary?.dateTo
      ? { dateTo: result.sourceSummary.dateTo }
      : {}),
    globalMarkedFilterEnabled: Boolean(
      result.sourceSummary?.globalMarkedFilterEnabled,
    ),
    scopeDescription: result.sourceSummary?.scopeDescription || '',
  }));
}

function normalizeQuestion(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim();
}

function normalizeConversationId(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) {
    return cryptoRandomId();
  }
  return text.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || cryptoRandomId();
}

function normalizeActorId(actor: any): string {
  const userId = String(actor?.id ?? actor?.userId ?? '').trim();
  if (!userId) {
    throw createHttpError(
      401,
      'AUTH_TOKEN_INVALID',
      'Current user identity is invalid.',
    );
  }
  return userId;
}

function cryptoRandomId(): string {
  return randomUUID();
}

function normalizeRoleForRecord(value: unknown): string {
  return String(value || '').trim().toLowerCase() || 'unknown';
}

function appendWarnings(base: string[], next: unknown[]): string[] {
  return uniqueStrings([
    ...base,
    ...next.filter((item): item is string => typeof item === 'string'),
  ]);
}

function appendWarning(base: string[], warning: string): string[] {
  return appendWarnings(base, [warning]);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => String(value || '').trim()).filter(Boolean)),
  );
}

function buildHistoryWhere(userId: string, query: AiChatHistoryQuery) {
  const where: Record<string, unknown> = { userId };
  const conversationId = normalizeOptionalQueryString(query.conversationId, 64);
  const intent = normalizeOptionalQueryString(query.intent, 80);
  const dateFrom = parseDateBoundary(query.dateFrom, 'start', 'dateFrom');
  const dateTo = parseDateBoundary(query.dateTo, 'end', 'dateTo');

  if (conversationId) {
    where.conversationId = conversationId;
  }
  if (intent) {
    where.intent = intent;
  }
  if (dateFrom || dateTo) {
    if (dateFrom && dateTo && dateFrom.getTime() > dateTo.getTime()) {
      throw createHttpError(
        400,
        'AI_HISTORY_QUERY_INVALID',
        'dateFrom must be before or equal to dateTo.',
      );
    }
    where.createdAt = {
      ...(dateFrom ? { gte: dateFrom } : {}),
      ...(dateTo ? { lte: dateTo } : {}),
    };
  }

  return where;
}

async function countAiChatMessages(delegate: any, where: Record<string, unknown>) {
  if (!delegate || typeof delegate.findMany !== 'function') {
    throw createHttpError(
      500,
      'AI_CHAT_HISTORY_UNAVAILABLE',
      'AI chat history store is not available.',
    );
  }
  if (typeof delegate.count === 'function') {
    return delegate.count({ where });
  }
  return (await delegate.findMany({ where })).length;
}

function toHistoryItem(row: any): AiChatHistoryItem {
  const storedAnswer = sanitizeAiHistoryText(row?.answer, 8000);
  return {
    id: String(row?.id || ''),
    conversationId: String(row?.conversationId || ''),
    question: sanitizeAiHistoryText(row?.question),
    answer: formatHistoricalAiAnswer(storedAnswer),
    intent: String(row?.intent || ''),
    dataScope: sanitizeHistoryDataScope(row?.dataScope),
    toolCalls: sanitizeHistoryToolCalls(row?.toolCalls),
    sourceSummary: sanitizeHistorySourceSummary(row?.sourceSummary),
    warnings: sanitizeAiUserWarnings(normalizeStringList(row?.warnings)),
    modelProvider: nullableString(row?.modelProvider),
    modelName: nullableString(row?.modelName),
    promptTokens: nullableNumber(row?.promptTokens),
    completionTokens: nullableNumber(row?.completionTokens),
    latencyMs: nullableNumber(row?.latencyMs),
    errorCode: nullableString(row?.errorCode),
    createdAt: toIsoDateTime(row?.createdAt),
  };
}

function sanitizeHistoryToolCalls(value: unknown): AiChatHistoryToolCall[] {
  const rows = Array.isArray(value) ? value : [];
  return rows.map((item) => {
    const source = isRecord(item) ? item : {};
    return {
      toolName: String(source.toolName || ''),
      rowCount: safeInteger(source.rowCount),
      globalMarkedFilterEnabled: Boolean(source.globalMarkedFilterEnabled),
      warnings: sanitizeAiUserWarnings(normalizeStringList(source.warnings)),
    };
  });
}

function sanitizeHistorySourceSummary(value: unknown): AiChatSourceSummary[] {
  const rows = Array.isArray(value) ? value : [];
  return rows.map((item) => {
    const source = isRecord(item) ? item : {};
    return {
      toolName: String(source.toolName || ''),
      rowCount: safeInteger(source.rowCount),
      ...(source.dateFrom ? { dateFrom: String(source.dateFrom) } : {}),
      ...(source.dateTo ? { dateTo: String(source.dateTo) } : {}),
      globalMarkedFilterEnabled: Boolean(source.globalMarkedFilterEnabled),
      scopeDescription: source.scopeDescription
        ? '当前账号可以查看的数据'
        : '',
    };
  });
}

function sanitizeHistoryDataScope(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }
  const result: Record<string, unknown> = {};
  if (isRecord(value.range)) {
    result.range = {
      ...(value.range.preset ? { preset: String(value.range.preset) } : {}),
      ...(value.range.dateFrom ? { dateFrom: String(value.range.dateFrom) } : {}),
      ...(value.range.dateTo ? { dateTo: String(value.range.dateTo) } : {}),
      ...(value.range.timezone ? { timezone: String(value.range.timezone) } : {}),
    };
  }
  if (isRecord(value.policy)) {
    result.policy = {
      ...(value.policy.code ? { code: String(value.policy.code) } : {}),
      ...(value.policy.scopeDescription
        ? {
            scopeDescription: sanitizeAiHistoryText(
              value.policy.scopeDescription,
            ),
          }
        : {}),
    };
  }
  return Object.keys(result).length > 0 ? result : null;
}

function parsePositiveIntegerQuery(
  value: unknown,
  defaultValue: number,
  maxValue: number,
  fieldName: string,
): number {
  const text = normalizeOptionalQueryString(value, 20);
  if (!text) {
    return defaultValue;
  }
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw createHttpError(
      400,
      'AI_HISTORY_QUERY_INVALID',
      `${fieldName} must be a positive integer.`,
    );
  }
  return Math.min(parsed, maxValue);
}

function parseDateBoundary(
  value: unknown,
  boundary: 'start' | 'end',
  fieldName: string,
): Date | null {
  const text = normalizeOptionalQueryString(value, 40);
  if (!text) {
    return null;
  }
  const exactDateMatch = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const parsed = exactDateMatch
    ? new Date(
        `${text}T${boundary === 'start' ? '00:00:00.000' : '23:59:59.999'}+08:00`,
      )
    : new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    throw createHttpError(
      400,
      'AI_HISTORY_QUERY_INVALID',
      `${fieldName} must be a valid date.`,
    );
  }
  return parsed;
}

function normalizeOptionalQueryString(
  value: unknown,
  maxLength: number,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return normalizeOptionalQueryString(value[0], maxLength);
  }
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? uniqueStrings(
        value.map((item) =>
          sanitizeAiHistoryText(
            typeof item === 'string' ? item : String(item),
          ),
        ),
      )
    : [];
}

function sanitizeAiHistoryText(
  value: unknown,
  maxLength = 2048,
): string {
  return sanitizeAiText(String(value ?? ''), { maxLength });
}

function nullableString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function nullableNumber(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function safeInteger(value: unknown): number {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue >= 0 ? numberValue : 0;
}

function toIsoDateTime(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeAiErrorCode(error: any, fallback: string): string {
  const code = typeof error?.code === 'string' ? error.code : '';
  return code.startsWith('AI_') ? code : fallback;
}

function getRefusalReason(code: string): string {
  if (code === 'AI_SQL_REQUEST_DENIED') {
    return '我不能生成或执行 SQL，也不能直接连接数据库。';
  }
  if (code === 'AI_UNSAFE_WRITE_REQUEST') {
    return '我不能直接修改、删除或新增业务数据。';
  }
  if (code === 'AI_PERMISSION_DENIED') {
    return '你当前没有权限查看这个范围的数据。';
  }
  if (code === 'AI_ROLE_NOT_ALLOWED') {
    return '你当前角色不能使用第 9 阶段第一版 AI 助手。';
  }
  return '这个问题超出第 9 阶段 AI 数据助手的只读问数范围。';
}
