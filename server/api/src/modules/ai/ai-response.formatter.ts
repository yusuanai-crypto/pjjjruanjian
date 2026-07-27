import { Injectable } from '@nestjs/common';

import {
  AiPromptBuildInput,
  AiPromptModelInput,
  sanitizeAiPromptInput,
} from './ai-prompt.builder';

type SanitizedToolResult = AiPromptModelInput['toolResults'][number];

interface CollectedMetric {
  key: string;
  label: string;
  value: string | number | boolean;
  text: string;
}

export const AI_HISTORY_HIDDEN_ANSWER =
  '这条历史回答含有不适合直接展示的内容，已隐藏。请重新询问销售额、退款、排名、客户订单、售后或物流等经营问题。';

const BUSINESS_ONLY_REFUSAL =
  '我只负责经营数据查询，不能提供你要的内容。你可以问销售额、退款、排名、客户订单、售后或物流。';

const RESTRICTED_REQUEST_PATTERN =
  /(程序代码|源代码|代码块|行内代码|编程|脚本|函数|网页标签|接口地址|接口路径|内部字段|内部标识|原始数据|原始格式|配置内容|配置文件|系统提示|提示词|开发者模式|越狱|忽略.{0,12}(规则|限制|要求|指令)|绕过.{0,12}(规则|限制|检查)|数据库|数据表|\b(?:sql|select|insert|update|delete|drop|alter|truncate|join|where|json|xml|yaml|html|css|python|javascript|java|dart|curl|powershell|bash|shell)\b)/i;

const FORBIDDEN_ANSWER_PATTERNS = [
  /```|~~~/,
  /`[^`\r\n]+`/,
  /<\/?[a-z][^>]*>/i,
  /https?:\/\/|\/(?:api|v\d+)\/[a-z0-9_./{}:-]+/i,
  /\b(?:select\s+.+\s+from|insert\s+into|update\s+\w+\s+set|delete\s+from|create\s+table|drop\s+table|alter\s+table)\b/is,
  /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=/,
  /\bfunction\s+[A-Za-z_$][\w$]*\s*\(|\bdef\s+[A-Za-z_]\w*\s*\(/i,
  /\bclass\s+[A-Za-z_$][\w$]*\s*(?:\{|extends\b)/,
  /\b(?:console\.log|print|system\.out\.println)\s*\(/i,
  /=>\s*(?:\{|[A-Za-z_$])/,
  /^\s*[A-Z][A-Z0-9_]{2,}\s*=/m,
  /^\s*[\[{][^]*[}\]]\s*$/s,
  /["'][A-Za-z_][A-Za-z0-9_]*["']\s*:/,
  /^\s*[A-Za-z][A-Za-z0-9_]*\s*:\s*(?:["'\d[{\-]|true|false|null)/im,
  /^(?:[A-Za-z][A-Za-z0-9_]*,){1,}[A-Za-z][A-Za-z0-9_]*\s*$/m,
  /^\s*\|.+\|\s*$/m,
  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/i,
  /\b[a-z]+(?:[A-Z][a-z0-9]*)+\b/,
  /\b(?:analytics|finance|customer|afterSales|logistics|commission)\.[A-Za-z]/,
  /\b(?:api(?:\s*key)?|access\s*token|mock|provider|json|xml|yaml|html|css|python|javascript|java|dart|curl|powershell|bash|shell|sql)\b/i,
  /(后端|接口(?:地址|路径|返回)?|模型|工具调用|数据工具|内部字段|内部英文标识|配置(?:内容|文件|错误|项|参数)?|数据库|数据表|程序代码|源代码|代码块|行内代码|网页标签|原始数据格式|第\s*\d+\s*阶段|返回\s*\d*\s*行|返回行数)/i,
];

@Injectable()
export class AiResponseFormatter {
  formatAnswer(input: AiPromptBuildInput): string {
    return formatAiResponse(input);
  }

  formatRefusal(input: AiPromptBuildInput, reason?: string): string {
    return formatAiRefusal(input, reason);
  }

  ensureCompliantAnswer(
    answer: unknown,
    input: AiPromptBuildInput,
  ): string {
    return ensureCompliantAiAnswer(answer, input);
  }
}

export function formatAiResponse(input: AiPromptBuildInput): string {
  const modelInput = sanitizeAiPromptInput(input);
  const intent = modelInput.intent;

  if (
    isRestrictedAiContentRequest(modelInput.question) ||
    intent === 'unsafe_write_request' ||
    intent === 'out_of_scope'
  ) {
    return BUSINESS_ONLY_REFUSAL;
  }

  if (intent === 'permission_denied') {
    return formatAiRefusal(modelInput);
  }

  const rangeText = buildRangeText(modelInput);
  const calculationText = buildCalculationText(modelInput);
  const warnings = collectWarnings(modelInput);

  if (!hasUsableData(modelInput.toolResults)) {
    return [
      '目前无法给出准确结果。',
      rangeText,
      calculationText,
      buildMissingDataGuidance(modelInput.intent),
      formatWarnings(warnings),
    ]
      .filter(Boolean)
      .join('\n');
  }

  const metrics = collectKeyMetrics(modelInput.toolResults);
  const rowCounts = collectRowCounts(modelInput.toolResults);
  const conclusion = metrics.length
    ? `查到的结果是：${metrics.map((metric) => metric.text).join('，')}。`
    : rowCounts.length
      ? formatRowCountConclusion(rowCounts)
      : '已经找到符合条件的经营记录。';

  return [
    conclusion,
    rangeText,
    calculationText,
    formatWarnings(warnings),
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatAiRefusal(
  input: AiPromptBuildInput,
  _reason?: string,
): string {
  const modelInput = sanitizeAiPromptInput(input);
  if (modelInput.intent === 'permission_denied') {
    return '当前账号不能查看这类数据。你可以询问自己有权查看的销售额、退款、客户订单、售后或物流。';
  }
  return BUSINESS_ONLY_REFUSAL;
}

export function ensureCompliantAiAnswer(
  answer: unknown,
  input: AiPromptBuildInput,
): string {
  const modelInput = sanitizeAiPromptInput(input);
  if (
    isRestrictedAiContentRequest(modelInput.question) ||
    modelInput.intent === 'unsafe_write_request' ||
    modelInput.intent === 'out_of_scope' ||
    modelInput.intent === 'permission_denied' ||
    !hasUsableData(modelInput.toolResults)
  ) {
    return formatAiResponse(modelInput);
  }

  const text = String(answer ?? '').trim();
  if (
    text &&
    isAiUserFacingAnswerCompliant(text) &&
    hasRequiredBusinessContext(text, modelInput)
  ) {
    return text;
  }
  return formatAiResponse(modelInput);
}

export function formatHistoricalAiAnswer(answer: unknown): string {
  const text = String(answer ?? '').trim();
  if (!text || !isAiUserFacingAnswerCompliant(text)) {
    return AI_HISTORY_HIDDEN_ANSWER;
  }
  return text;
}

export function isAiUserFacingAnswerCompliant(answer: unknown): boolean {
  const text = String(answer ?? '').trim();
  if (!text || !/[\u3400-\u9fff]/u.test(text)) {
    return false;
  }
  return !FORBIDDEN_ANSWER_PATTERNS.some((pattern) => pattern.test(text));
}

export function isRestrictedAiContentRequest(question: unknown): boolean {
  return RESTRICTED_REQUEST_PATTERN.test(String(question ?? '').trim());
}

export function sanitizeAiUserWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const results = value
    .map((item) => toUserFriendlyWarning(String(item ?? '').trim()))
    .filter((item): item is string => Boolean(item));
  return Array.from(new Set(results));
}

function buildRangeText(modelInput: AiPromptModelInput): string {
  const range = modelInput.dateRange;
  if (range?.dateFrom && range?.dateTo) {
    return `统计时间是 ${range.dateFrom} 至 ${range.dateTo}，范围是当前账号可以查看的数据。`;
  }

  const sourceRange = modelInput.toolResults.find(
    (result) => result.sourceSummary?.dateFrom && result.sourceSummary?.dateTo,
  )?.sourceSummary;
  if (sourceRange?.dateFrom && sourceRange?.dateTo) {
    return `统计时间是 ${sourceRange.dateFrom} 至 ${sourceRange.dateTo}，范围是当前账号可以查看的数据。`;
  }

  if (isLookupIntent(modelInput.intent)) {
    return '统计范围是当前账号可以查看、且符合你所给条件的记录。';
  }
  return '统计范围是当前账号可以查看的经营数据。';
}

function hasRequiredBusinessContext(
  answer: string,
  modelInput: AiPromptModelInput,
): boolean {
  if (!/(统计|查询)/.test(answer)) {
    return false;
  }
  if (!/(计算|减去|比例|采用|根据|只按|记录)/.test(answer)) {
    return false;
  }
  const range = modelInput.dateRange;
  if (range?.dateFrom && !answer.includes(range.dateFrom)) {
    return false;
  }
  if (range?.dateTo && !answer.includes(range.dateTo)) {
    return false;
  }
  return true;
}

function buildCalculationText(modelInput: AiPromptModelInput): string {
  const metrics = collectKeyMetrics(modelInput.toolResults);
  const keys = new Set(metrics.map((metric) => metric.key));
  const explanations: string[] = [];

  if (keys.has('netSalesAmountCents')) {
    explanations.push('净销售额是销售金额减去已确认退款后的金额');
  }
  if (keys.has('noOrderRate')) {
    explanations.push(
      '打蛋率是没有有效订单的接待团数，占全部接待团数的比例',
    );
  }

  if (isFinanceIntent(modelInput.intent)) {
    explanations.push(
      '退款按是否确认分开统计，提成和积分采用已经生成的记录',
    );
  } else if (isLookupIntent(modelInput.intent)) {
    explanations.push(
      '这次只查看记录，不会改动内容；手机号会隐藏部分数字，完整地址不会出现在回答中',
    );
  } else if (!explanations.length) {
    explanations.push('结果只按现有经营记录计算，不补猜缺少的数字');
  }

  return `计算时，${Array.from(new Set(explanations)).join('；')}。`;
}

function buildMissingDataGuidance(intent: string): string {
  if (isLookupIntent(intent)) {
    return '请补充客户姓名、手机号后四位、订单号、售后单号或物流单号后再问。';
  }
  return '请补充要查询的时间范围和经营指标后再问。';
}

function isFinanceIntent(intent: string): boolean {
  return (
    intent === 'finance_summary' ||
    intent === 'refund_query' ||
    intent === 'commission_query' ||
    intent === 'travel_group_finance_query'
  );
}

function isLookupIntent(intent: string): boolean {
  return (
    intent === 'customer_lookup' ||
    intent === 'customer_order_lookup' ||
    intent === 'after_sales_lookup' ||
    intent === 'logistics_lookup'
  );
}

function hasUsableData(toolResults: SanitizedToolResult[]): boolean {
  return toolResults.some((result) => {
    if (
      typeof result.sourceSummary?.rowCount === 'number' &&
      result.sourceSummary.rowCount > 0
    ) {
      return true;
    }
    return hasNonEmptyData(result.data);
  });
}

function hasNonEmptyData(value: unknown): boolean {
  if (value === null || typeof value === 'undefined') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(hasNonEmptyData);
  }
  return value !== '';
}

function collectKeyMetrics(
  value: unknown,
): CollectedMetric[] {
  const metrics: CollectedMetric[] = [];
  collectMetrics(value, metrics, new Set<string>());
  return metrics.slice(0, 12);
}

function collectMetrics(
  value: unknown,
  metrics: CollectedMetric[],
  seenKeys: Set<string>,
) {
  if (metrics.length >= 12 || value === null || typeof value === 'undefined') {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 5)) {
      collectMetrics(item, metrics, seenKeys);
    }
    return;
  }
  if (typeof value !== 'object') {
    return;
  }

  for (const [key, nestedValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (metrics.length >= 12) {
      break;
    }
    const label = METRIC_LABELS[key];
    if (label && isMetricValue(nestedValue)) {
      const dedupeKey = `${key}:${String(nestedValue)}`;
      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        metrics.push({
          key,
          label,
          value: nestedValue,
          text: `${label} ${formatMetricValue(key, nestedValue)}`,
        });
      }
      continue;
    }
    if (shouldRecurseMetricKey(key)) {
      collectMetrics(nestedValue, metrics, seenKeys);
    }
  }
}

const METRIC_LABELS: Record<string, string> = {
  grossSalesAmountCents: '出单销售额',
  totalSalesAmountCents: '销售额',
  salesAmountCents: '销售额',
  refundAmountCents: '已确认退款金额',
  confirmedRefundAmountCents: '已确认退款金额',
  pendingRefundAmountCents: '待确认退款金额',
  netSalesAmountCents: '净销售额',
  totalGroupCount: '旅行团数',
  groupCount: '旅行团数',
  totalGuestCount: '接待人数',
  guestCount: '接待人数',
  averageSales: '平均销售额',
  averageSalesCents: '平均销售额',
  averageSalesPerGroupCents: '团均销售额',
  averageSalesPerGuestCents: '客均销售额',
  noOrderRate: '打蛋率',
  confirmedRefundCount: '已确认退款单数',
  pendingRefundCount: '待确认退款单数',
  logisticsFeeCents: '物流费用',
  commissionAmountCents: '提成金额',
  totalCommissionAmountCents: '提成金额',
  pointsCents: '积分金额',
  totalPointsCents: '积分金额',
  orderCount: '订单数',
  matchedOrderCount: '匹配订单数',
  customerCount: '客户数',
  matchedCustomerCount: '匹配客户数',
  afterSalesCount: '售后单数',
  afterSalesOrderCount: '售后单数',
  missingLogisticsNoCount: '缺少物流单号数量',
};

function shouldRecurseMetricKey(key: string): boolean {
  return (
    key === 'summary' ||
    key === 'data' ||
    key === 'totals' ||
    key === 'metrics' ||
    key === 'refunds' ||
    key === 'logistics' ||
    key === 'commission' ||
    key === 'points' ||
    key === 'customers' ||
    key === 'orders' ||
    key === 'afterSales' ||
    key === 'rankings' ||
    key === 'records' ||
    key === 'trends' ||
    key === 'toolResults'
  );
}

function isMetricValue(value: unknown): value is string | number | boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function formatMetricValue(key: string, value: string | number | boolean) {
  if (typeof value === 'number') {
    if (key.endsWith('Cents') || key === 'averageSales') {
      return `${(value / 100).toFixed(2)} 元`;
    }
    if (key.endsWith('Rate')) {
      const percent = Math.abs(value) <= 1 ? value * 100 : value;
      return `${percent.toFixed(2)}%`;
    }
  }
  return String(value);
}

function collectRowCounts(toolResults: SanitizedToolResult[]): number[] {
  return toolResults
    .map((result) => result.sourceSummary?.rowCount)
    .filter(
      (value): value is number =>
        typeof value === 'number' && Number.isFinite(value) && value >= 0,
    );
}

function formatRowCountConclusion(rowCounts: number[]): string {
  if (rowCounts.length === 1) {
    return `已找到 ${rowCounts[0]} 条记录。`;
  }
  return `各项查询分别找到 ${rowCounts.join('、')} 条记录。`;
}

function collectWarnings(modelInput: AiPromptModelInput): string[] {
  const warnings = sanitizeAiUserWarnings([
    ...modelInput.warnings,
    ...modelInput.toolResults.flatMap((result) => result.warnings),
  ]);
  const markedEnabled =
    modelInput.policy?.globalMarkedFilterEnabled ||
    modelInput.toolResults.some(
      (result) => result.sourceSummary?.globalMarkedFilterEnabled,
    );
  if (markedEnabled) {
    warnings.push('目前只统计已标记的数据。');
  }
  return Array.from(new Set(warnings.filter(Boolean)));
}

function formatWarnings(warnings: string[]): string {
  if (!warnings.length) {
    return '';
  }
  return `请注意，${warnings.join('；')}`;
}

function toUserFriendlyWarning(value: string): string | null {
  if (!value) {
    return null;
  }
  if (/(已标记|标记数据|标记信息)/.test(value)) {
    return '目前只统计已标记的数据。';
  }
  if (/(权限|无权|不可查看|角色)/.test(value)) {
    return '当前账号不能查看这类数据。';
  }
  if (/(手机号|地址|脱敏|隐私|敏感)/.test(value)) {
    return '个人信息已按规则隐藏。';
  }
  if (/(未指定时间|不限时间|限制.*(?:数量|行数)|返回行数)/.test(value)) {
    return '没有指定时间，已按当前条件查找，并限制展示数量。';
  }
  if (/(只读|修改.*业务|删除.*业务|新增.*业务|重算|导出|超出.*范围)/.test(value)) {
    return '我只负责经营数据查询。你可以问销售额、退款、排名、客户订单、售后或物流。';
  }
  if (
    /(暂时不可用|失败|异常|超时|模型|接口|后端|工具|服务商|密钥|配置|provider|mock|api)/i.test(
      value,
    )
  ) {
    return '暂时无法完成查询，请稍后再试。';
  }
  if (isAiUserFacingAnswerCompliant(value)) {
    return value;
  }
  return '查询结果可能不完整，请结合页面中的经营记录核对。';
}
