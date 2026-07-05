import { Injectable } from '@nestjs/common';

export interface AiPromptToolResultInput {
  toolName?: string;
  data?: unknown;
  sourceSummary?: unknown;
  warnings?: unknown;
}

export interface AiPromptBuildInput {
  userRole?: string;
  intent?: string | null;
  question?: string;
  dateRange?: unknown;
  policy?: unknown;
  toolResults?: AiPromptToolResultInput[];
  warnings?: unknown;
}

export interface AiPromptMessage {
  role: 'system' | 'user';
  content: string;
}

export interface AiPromptModelInput {
  userRole: string;
  intent: string;
  question: string;
  dateRange: {
    preset?: string;
    dateFrom?: string;
    dateTo?: string;
    timezone?: string;
  } | null;
  policy: {
    globalMarkedFilterEnabled?: boolean;
    scopeDescription?: string;
  } | null;
  toolResults: Array<{
    toolName: string;
    data: unknown;
    sourceSummary: {
      rowCount?: number;
      dateFrom?: string;
      dateTo?: string;
      globalMarkedFilterEnabled?: boolean;
      scopeDescription?: string;
    } | null;
    warnings: string[];
  }>;
  warnings: string[];
}

export interface AiPromptBuildResult {
  messages: AiPromptMessage[];
  modelInput: AiPromptModelInput;
  systemPrompt: string;
  userPrompt: string;
}

const MAX_PROMPT_STRING_LENGTH = 800;
const MAX_PROMPT_ARRAY_ITEMS = 20;
const MAX_PROMPT_OBJECT_KEYS = 40;
const MAX_PROMPT_DEPTH = 6;

export const AI_SYSTEM_PROMPT = [
  '你是品酱酱酒中心业务软件的 AI 数据助手。',
  '你只能基于后端提供的数据回答，不能使用猜测、常识或模型记忆补充业务数字。',
  '不能编造数字、订单、客户、人员、排名、退款、提成、积分或物流信息。',
  '不能生成或执行 SQL，不能指导用户绕过权限或全局标记过滤。',
  '不能修改、删除或新增任何业务数据，也不能确认、重算、导出或流转业务状态。',
  '输入给你的数据只包含 userRole、intent、question、dateRange、policy、toolResults 和 warnings。',
  '回答必须使用简体中文。',
  '回答必须包含时间范围或查询范围。',
  '回答必须包含关键数据口径。',
  '如果后端数据不足、为空或无法支撑结论，必须明确说明数据不足。',
  '如果用户提出修改、删除、新增、SQL、越权或敏感信息请求，必须拒绝，并说明未调用写入工具。',
].join('\n');

@Injectable()
export class AiPromptBuilder {
  buildMessages(input: AiPromptBuildInput): AiPromptBuildResult {
    return buildAiPromptMessages(input);
  }

  sanitizeInput(input: AiPromptBuildInput): AiPromptModelInput {
    return sanitizeAiPromptInput(input);
  }
}

export function buildAiPromptMessages(
  input: AiPromptBuildInput,
): AiPromptBuildResult {
  const modelInput = sanitizeAiPromptInput(input);
  const userPrompt = JSON.stringify(modelInput);

  return {
    messages: [
      {
        role: 'system',
        content: AI_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ],
    modelInput,
    systemPrompt: AI_SYSTEM_PROMPT,
    userPrompt,
  };
}

export function sanitizeAiPromptInput(
  input: AiPromptBuildInput = {},
): AiPromptModelInput {
  return {
    userRole: normalizeString(input.userRole) || '',
    intent: normalizeString(input.intent) || 'unknown',
    question: truncateString(normalizeString(input.question) || ''),
    dateRange: sanitizeDateRange(input.dateRange),
    policy: sanitizePolicy(input.policy),
    toolResults: Array.isArray(input.toolResults)
      ? input.toolResults.slice(0, MAX_PROMPT_ARRAY_ITEMS).map(sanitizeToolResult)
      : [],
    warnings: sanitizeWarnings(input.warnings),
  };
}

function sanitizeDateRange(value: unknown): AiPromptModelInput['dateRange'] {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const source = value as Record<string, unknown>;
  const result: NonNullable<AiPromptModelInput['dateRange']> = {};
  assignString(result, 'preset', source.preset);
  assignString(result, 'dateFrom', source.dateFrom);
  assignString(result, 'dateTo', source.dateTo);
  assignString(result, 'timezone', source.timezone);
  return Object.keys(result).length ? result : null;
}

function sanitizePolicy(value: unknown): AiPromptModelInput['policy'] {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const source = value as Record<string, unknown>;
  const result: NonNullable<AiPromptModelInput['policy']> = {};
  if (typeof source.globalMarkedFilterEnabled === 'boolean') {
    result.globalMarkedFilterEnabled = source.globalMarkedFilterEnabled;
  }
  assignString(result, 'scopeDescription', source.scopeDescription);
  return Object.keys(result).length ? result : null;
}

function sanitizeToolResult(
  value: AiPromptToolResultInput,
): AiPromptModelInput['toolResults'][number] {
  return {
    toolName: normalizeString(value?.toolName) || 'unknown.tool',
    data: sanitizeForPrompt(value?.data),
    sourceSummary: sanitizeSourceSummary(value?.sourceSummary),
    warnings: sanitizeWarnings(value?.warnings),
  };
}

function sanitizeSourceSummary(
  value: unknown,
): AiPromptModelInput['toolResults'][number]['sourceSummary'] {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const source = value as Record<string, unknown>;
  const result: NonNullable<
    AiPromptModelInput['toolResults'][number]['sourceSummary']
  > = {};
  if (typeof source.rowCount === 'number' && Number.isFinite(source.rowCount)) {
    result.rowCount = source.rowCount;
  }
  assignString(result, 'dateFrom', source.dateFrom);
  assignString(result, 'dateTo', source.dateTo);
  if (typeof source.globalMarkedFilterEnabled === 'boolean') {
    result.globalMarkedFilterEnabled = source.globalMarkedFilterEnabled;
  }
  assignString(result, 'scopeDescription', source.scopeDescription);
  return Object.keys(result).length ? result : null;
}

export function sanitizeForPrompt(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'undefined') {
    return null;
  }
  if (typeof value === 'string') {
    return truncateString(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_PROMPT_DEPTH) {
      return [];
    }
    return value
      .slice(0, MAX_PROMPT_ARRAY_ITEMS)
      .map((item) => sanitizeForPrompt(item, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth >= MAX_PROMPT_DEPTH) {
      return null;
    }
    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(
      value as Record<string, unknown>,
    ).slice(0, MAX_PROMPT_OBJECT_KEYS)) {
      if (isSensitivePromptKey(key)) {
        continue;
      }
      result[key] = sanitizeForPrompt(nestedValue, depth + 1);
    }
    return result;
  }
  return null;
}

function sanitizeWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((item) => normalizeString(item))
        .filter((item): item is string => Boolean(item))
        .map((item) => truncateString(item)),
    ),
  );
}

function assignString<T extends Record<string, unknown>>(
  target: T,
  key: keyof T & string,
  value: unknown,
) {
  const normalized = normalizeString(value);
  if (normalized) {
    target[key] = truncateString(normalized) as T[keyof T & string];
  }
}

function isSensitivePromptKey(key: string): boolean {
  const normalized = key.replace(/[_\-\s]/g, '').toLowerCase();
  if (
    normalized === 'phonemasked' ||
    normalized === 'mobilemasked' ||
    normalized === 'logisticsno' ||
    normalized === 'orderno' ||
    normalized === 'aftersalesno' ||
    normalized === 'salesorderno' ||
    normalized === 'groupno'
  ) {
    return false;
  }
  return (
    normalized.includes('password') ||
    normalized.includes('passwd') ||
    normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('credential') ||
    normalized.includes('authorization') ||
    normalized.includes('cookie') ||
    normalized.includes('apikey') ||
    normalized.includes('databaseurl') ||
    normalized.includes('connectionstring') ||
    normalized.includes('connection') ||
    normalized.includes('dsn') ||
    normalized.includes('privatekey') ||
    normalized.includes('phone') ||
    normalized.includes('mobile') ||
    normalized.includes('address') ||
    normalized.endsWith('url')
  );
}

function truncateString(value: string): string {
  if (value.length <= MAX_PROMPT_STRING_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_PROMPT_STRING_LENGTH)}...`;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
