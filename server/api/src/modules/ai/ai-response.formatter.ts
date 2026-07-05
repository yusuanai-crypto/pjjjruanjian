import { Injectable } from '@nestjs/common';

import {
  AiPromptBuildInput,
  AiPromptModelInput,
  sanitizeAiPromptInput,
} from './ai-prompt.builder';

type SanitizedToolResult = AiPromptModelInput['toolResults'][number];

@Injectable()
export class AiResponseFormatter {
  formatAnswer(input: AiPromptBuildInput): string {
    return formatAiResponse(input);
  }

  formatRefusal(input: AiPromptBuildInput, reason?: string): string {
    return formatAiRefusal(input, reason);
  }
}

export function formatAiResponse(input: AiPromptBuildInput): string {
  const modelInput = sanitizeAiPromptInput(input);
  const intent = modelInput.intent;

  if (intent === 'unsafe_write_request') {
    return formatAiRefusal(
      modelInput,
      '我不能直接修改、删除或新增业务数据，也不能生成或执行 SQL。',
    );
  }

  if (intent === 'permission_denied') {
    return formatAiRefusal(
      modelInput,
      '你当前没有权限查看这个范围的数据。',
    );
  }

  if (intent === 'out_of_scope') {
    return formatAiRefusal(
      modelInput,
      '这个问题超出第 9 阶段 AI 数据助手的只读问数范围。',
    );
  }

  const rangeText = buildRangeText(modelInput);
  const scopeText = buildScopeText(modelInput);
  const dataPolicyText = buildDataPolicyText(modelInput);
  const warnings = collectWarnings(modelInput);

  if (!hasUsableData(modelInput.toolResults)) {
    return [
      `查询范围：${rangeText}；${scopeText}。`,
      `数据口径：${dataPolicyText}`,
      '数据不足：后端没有返回可用于回答的只读数据，因此我不能编造数字或下结论。',
      formatWarnings(warnings),
    ]
      .filter(Boolean)
      .join('\n');
  }

  const summaryLines = modelInput.toolResults
    .map((result) => summarizeToolResult(result))
    .filter(Boolean);

  return [
    `查询范围：${rangeText}；${scopeText}。`,
    `数据口径：${dataPolicyText}`,
    ...summaryLines,
    formatWarnings(warnings),
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatAiRefusal(
  input: AiPromptBuildInput,
  reason = '后端策略拒绝了这个请求。',
): string {
  const modelInput = sanitizeAiPromptInput(input);
  const scopeText = buildScopeText(modelInput);
  const warnings = collectWarnings(modelInput);

  return [
    reason,
    '我只能做受控只读查询、解释和建议，不能代替业务页面执行写入、确认、重算、导出、状态流转或原始 SQL。',
    `查询范围：未进入业务查询；${scopeText}。`,
    '数据口径：后端策略拒绝，未调用写入工具、导出工具、重算工具、数据库连接或原始 SQL。',
    formatWarnings(warnings),
  ]
    .filter(Boolean)
    .join('\n');
}

function summarizeToolResult(result: SanitizedToolResult): string {
  const rowText =
    typeof result.sourceSummary?.rowCount === 'number'
      ? `，返回 ${result.sourceSummary.rowCount} 行`
      : '';
  const sourceRange =
    result.sourceSummary?.dateFrom && result.sourceSummary?.dateTo
      ? `，数据范围 ${result.sourceSummary.dateFrom} 至 ${result.sourceSummary.dateTo}`
      : '';
  const metrics = collectKeyMetrics(result.data);
  const metricText = metrics.length
    ? `关键数据：${metrics.join('；')}。`
    : '关键数据：后端返回了结构化摘要，但没有可直接展开的核心数字。';

  return `${result.toolName}${rowText}${sourceRange}。${metricText}`;
}

function buildRangeText(modelInput: AiPromptModelInput): string {
  const range = modelInput.dateRange;
  if (range?.dateFrom && range?.dateTo) {
    const timezone = range.timezone || 'Asia/Shanghai';
    return `${range.dateFrom} 至 ${range.dateTo}（${timezone}）`;
  }
  if (range?.preset) {
    return `预设范围 ${range.preset}`;
  }

  const sourceRange = modelInput.toolResults.find(
    (result) => result.sourceSummary?.dateFrom && result.sourceSummary?.dateTo,
  )?.sourceSummary;
  if (sourceRange?.dateFrom && sourceRange?.dateTo) {
    return `${sourceRange.dateFrom} 至 ${sourceRange.dateTo}`;
  }

  if (isLookupIntent(modelInput.intent)) {
    return '当前查询条件；客户、订单、售后和物流类问题未说明时间时默认不限时间并限制返回条数';
  }

  return '当前后端工具返回范围';
}

function buildScopeText(modelInput: AiPromptModelInput): string {
  const policyScope = modelInput.policy?.scopeDescription;
  const sourceScope = modelInput.toolResults.find(
    (result) => result.sourceSummary?.scopeDescription,
  )?.sourceSummary?.scopeDescription;
  return policyScope || sourceScope || '当前登录用户可见范围';
}

function buildDataPolicyText(modelInput: AiPromptModelInput): string {
  const intent = modelInput.intent;
  if (
    intent === 'analytics_overview' ||
    intent === 'analytics_trend' ||
    intent === 'taster_ranking' ||
    intent === 'taster_detail' ||
    intent === 'management_suggestion'
  ) {
    return '复用第 8 阶段 analytics 只读口径；销售额、退款、净销售额、旅行团数、接待人数和打蛋率均来自后端工具；全局标记过滤由后端执行。';
  }
  if (
    intent === 'finance_summary' ||
    intent === 'refund_query' ||
    intent === 'commission_query' ||
    intent === 'travel_group_finance_query'
  ) {
    return '复用第 6、7 阶段财务、退款、提成和积分只读口径；提成和积分读取已生成记录，不触发重算；退款按确认状态区分。';
  }
  if (isLookupIntent(intent)) {
    return '复用客户、订单、售后和物流只读查询；手机号尽量脱敏，完整地址不进入 AI 回答；全局标记过滤由后端执行。';
  }
  return '仅基于后端工具返回的 sourceSummary、warnings 和结构化摘要，不补充后端未提供的数字。';
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

function collectKeyMetrics(value: unknown): string[] {
  const metrics: string[] = [];
  collectMetrics(value, metrics, new Set<string>());
  return metrics.slice(0, 12);
}

function collectMetrics(
  value: unknown,
  metrics: string[],
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
        metrics.push(`${label} ${formatMetricValue(key, nestedValue)}`);
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
    key === 'records'
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

function collectWarnings(modelInput: AiPromptModelInput): string[] {
  const warnings = [
    ...modelInput.warnings,
    ...modelInput.toolResults.flatMap((result) => result.warnings),
  ];
  const markedEnabled =
    modelInput.policy?.globalMarkedFilterEnabled ||
    modelInput.toolResults.some(
      (result) => result.sourceSummary?.globalMarkedFilterEnabled,
    );
  if (markedEnabled) {
    warnings.push('当前已开启只查询已标记信息，结果仅基于已标记数据。');
  }
  return Array.from(new Set(warnings.filter(Boolean)));
}

function formatWarnings(warnings: string[]): string {
  if (!warnings.length) {
    return '';
  }
  return `风险提示：${warnings.join('；')}`;
}
