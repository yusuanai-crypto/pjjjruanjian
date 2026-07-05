import { Injectable } from '@nestjs/common';

import {
  ANALYTICS_DATE_RANGE_PRESETS,
  ANALYTICS_TIMEZONE,
  normalizeAnalyticsDateRange,
  type AnalyticsDateRangePreset,
  type NormalizedAnalyticsDateRange,
} from '../analytics/analytics-date-range.helper';
import { classifyUnsafeQuestion } from './ai-policy.service';

export const AI_DATE_RANGE_PRESETS = ANALYTICS_DATE_RANGE_PRESETS;
export const AI_TIMEZONE = ANALYTICS_TIMEZONE;
export const AI_DEFAULT_LOOKUP_LIMIT = 20;

export const AI_INTENTS = [
  'analytics_overview',
  'analytics_trend',
  'taster_ranking',
  'taster_detail',
  'finance_summary',
  'commission_query',
  'refund_query',
  'customer_order_lookup',
  'after_sales_lookup',
  'logistics_lookup',
  'management_suggestion',
  'unsafe_write_request',
  'permission_denied',
  'out_of_scope',
] as const;

export type AiIntent = (typeof AI_INTENTS)[number];
export type AiDateRangePreset = AnalyticsDateRangePreset;
export type AiDateRange = NormalizedAnalyticsDateRange;

export interface AiIntentParseOptions {
  now?: Date;
  defaultLimit?: number;
}

export interface AiIntentParseResult {
  intent: AiIntent;
  dateRange: AiDateRange | null;
  limit: number | null;
  timezone: typeof ANALYTICS_TIMEZONE;
  matchedKeywords: string[];
  warnings: string[];
}

interface IntentRule {
  intent: AiIntent;
  keywords: string[];
  patterns: RegExp[];
}

interface IntentMatch {
  intent: AiIntent;
  matchedKeywords: string[];
}

interface DatePresetMatch {
  preset: AiDateRangePreset;
  matchedKeyword: string;
}

const THIS_MONTH_DEFAULT_INTENTS = new Set<AiIntent>([
  'analytics_overview',
  'analytics_trend',
  'taster_ranking',
  'taster_detail',
  'finance_summary',
  'commission_query',
  'refund_query',
  'management_suggestion',
]);

const LOOKUP_LIMIT_INTENTS = new Set<AiIntent>([
  'customer_order_lookup',
  'after_sales_lookup',
  'logistics_lookup',
]);

const SQL_REQUEST_PATTERN =
  /(\bsql\b|\bselect\b|\binsert\b|\bupdate\b|\bdelete\b|\bdrop\b|\balter\b|\btruncate\b|\bjoin\b|\bwhere\b|写\s*sql|生成\s*sql|执行\s*sql|跑\s*sql|查库|数据库连接|连接数据库|数据表|任意\s*sql)/i;

const WRITE_REQUEST_PATTERN =
  /(修改|改成|改为|更改|更新|删除|删掉|新增|创建|录入|写入|导入|批量导入|重算|重新计算|刷新|关闭全局|恢复全局|change|update|delete|insert|create|patch|post|write|recalculate|confirm|import|(?:帮我|请|把|将|给我|直接).{0,20}(确认|取消确认|结算|发货|打包|标记))/i;

const PERMISSION_REQUEST_PATTERN =
  /(绕过权限|越权|无权限|不管权限|忽略权限|所有员工密码|员工密码|账号密码|密码明文|敏感账号|api\s*key|access\s*token|密钥|管理员权限|老板权限|看别人看不到|全部客户手机号|导出全部客户|全量客户资料)/i;

const DATE_ONLY_PATTERN =
  /(\d{4})[年/\-.](\d{1,2})[月/\-.](\d{1,2})(?:日)?/g;

const DATE_PRESET_RULES: Array<{
  preset: AiDateRangePreset;
  keywords: string[];
  patterns: RegExp[];
}> = [
  {
    preset: 'last_10_days',
    keywords: ['近 10 天', '近10天', '最近 10 天', '最近10天', '过去 10 天', 'last_10_days'],
    patterns: [
      /近\s*10\s*天/,
      /最近\s*10\s*天/,
      /过去\s*10\s*天/,
      /近十天/,
      /最近十天/,
      /过去十天/,
      /\blast[_\s-]?10[_\s-]?days\b/i,
    ],
  },
  {
    preset: 'last_month',
    keywords: ['上个月', '上月', 'last_month'],
    patterns: [/上个?月/, /\blast[_\s-]?month\b/i],
  },
  {
    preset: 'this_year',
    keywords: ['本年', '今年', '本年度', 'this_year'],
    patterns: [/本年/, /今年/, /本年度/, /\bthis[_\s-]?year\b/i],
  },
  {
    preset: 'yesterday',
    keywords: ['昨天', '昨日', 'yesterday'],
    patterns: [/昨天/, /昨日/, /\byesterday\b/i],
  },
  {
    preset: 'today',
    keywords: ['今天', '今日', '当天', 'today'],
    patterns: [/今天/, /今日/, /当天/, /\btoday\b/i],
  },
  {
    preset: 'this_month',
    keywords: ['本月', '这个月', '当月', 'this_month'],
    patterns: [/本月/, /这个月/, /当月/, /\bthis[_\s-]?month\b/i],
  },
];

const INTENT_RULES: IntentRule[] = [
  {
    intent: 'management_suggestion',
    keywords: ['经营建议', '建议', '风险', '需要关注', '怎么改善', '怎么办', '异常'],
    patterns: [
      /(经营|销售|退款|打蛋率|品鉴师|业绩).*(建议|风险|改善|关注|异常)/,
      /(建议|风险|改善|关注|异常).*(经营|销售|退款|打蛋率|品鉴师|业绩)/,
      /经营情况.*(怎么样|如何|摘要|总结)/,
    ],
  },
  {
    intent: 'logistics_lookup',
    keywords: ['物流', '快递', '运单', '物流单号', '发货', '配送'],
    patterns: [/物流/, /快递/, /运单/, /物流单号/, /发货/, /配送/],
  },
  {
    intent: 'after_sales_lookup',
    keywords: ['售后', '售后记录', '售后历史', '退过单', '售后问题'],
    patterns: [/售后/, /售后记录/, /售后历史/, /退过单/, /售后问题/],
  },
  {
    intent: 'commission_query',
    keywords: ['提成', '佣金', '销售提成', '品鉴师提成'],
    patterns: [/提成/, /佣金/, /销售提成/, /品鉴师提成/],
  },
  {
    intent: 'refund_query',
    keywords: ['退款', '退单', '已确认退款', '待确认退款', '退款金额'],
    patterns: [/退款/, /退单/, /已确认退款/, /待确认退款/, /退款金额/],
  },
  {
    intent: 'finance_summary',
    keywords: ['财务', '核对', '物流费', '费用', '积分', '财务摘要'],
    patterns: [/财务/, /核对/, /物流费/, /费用/, /积分/, /财务摘要/],
  },
  {
    intent: 'taster_detail',
    keywords: ['品鉴师', '明细', '详情', '为什么', '原因', '下降', '某个品鉴师'],
    patterns: [
      /品鉴师.*(明细|详情|为什么|原因|下降|升高|个人|单人|某个)/,
      /(明细|详情|为什么|原因|下降|升高|个人|单人|某个).*品鉴师/,
    ],
  },
  {
    intent: 'taster_ranking',
    keywords: ['品鉴师', '排名', '排行', '第一', '最高', '最低'],
    patterns: [
      /品鉴师.*(排名|排行|第[一二三四五六七八九十0-9]+|最高|最低|top\s*\d*)/,
      /(排名|排行|第[一二三四五六七八九十0-9]+|最高|最低|top\s*\d*).*品鉴师/,
    ],
  },
  {
    intent: 'analytics_trend',
    keywords: ['趋势', '走势', '变化', '按天', '按月', '环比'],
    patterns: [/趋势/, /走势/, /变化/, /按天/, /按月/, /环比/, /同比/],
  },
  {
    intent: 'analytics_overview',
    keywords: [
      '销售额',
      '销售',
      '营收',
      '净销售',
      '订单数',
      '打蛋率',
      '接待',
      '团均',
      '人均',
      '经营看板',
    ],
    patterns: [
      /销售额/,
      /销售/,
      /营收/,
      /净销售/,
      /订单数/,
      /打蛋率/,
      /接待/,
      /团均/,
      /人均/,
      /经营看板/,
      /经营统计/,
      /数据看板/,
    ],
  },
  {
    intent: 'customer_order_lookup',
    keywords: ['客户', '订单', '买过', '购买', '下单', '手机号', '电话', '订单号'],
    patterns: [
      /客户.*(订单|买过|购买|下单|消费|酒|手机号|电话)/,
      /(订单|买过|购买|下单|消费|酒|手机号|电话).*客户/,
      /订单号/,
      /订单/,
    ],
  },
];

@Injectable()
export class AiIntentService {
  parseQuestion(
    question: string | null | undefined,
    options: AiIntentParseOptions = {},
  ): AiIntentParseResult {
    const match = identifyAiIntent(question);
    const dateRange = resolveAiDateRange(question, match.intent, options);
    const warnings = buildWarnings(match.intent, dateRange);

    return {
      intent: match.intent,
      dateRange,
      limit: resolveLimit(match.intent, options),
      timezone: ANALYTICS_TIMEZONE,
      matchedKeywords: match.matchedKeywords,
      warnings,
    };
  }
}

export function identifyAiIntent(
  question: string | null | undefined,
): IntentMatch {
  const normalized = normalizeQuestion(question);
  if (!normalized) {
    return { intent: 'out_of_scope', matchedKeywords: [] };
  }

  if (
    WRITE_REQUEST_PATTERN.test(normalized) ||
    classifyUnsafeQuestion(question) === 'AI_UNSAFE_WRITE_REQUEST'
  ) {
    return { intent: 'unsafe_write_request', matchedKeywords: ['write'] };
  }
  if (SQL_REQUEST_PATTERN.test(normalized)) {
    return { intent: 'out_of_scope', matchedKeywords: ['SQL'] };
  }
  if (classifyUnsafeQuestion(question) === 'AI_SQL_REQUEST_DENIED') {
    return { intent: 'out_of_scope', matchedKeywords: ['SQL'] };
  }
  if (PERMISSION_REQUEST_PATTERN.test(normalized)) {
    return { intent: 'permission_denied', matchedKeywords: ['permission'] };
  }

  const englishMatch = identifyEnglishIntent(normalized);
  if (englishMatch) {
    return englishMatch;
  }

  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return {
        intent: rule.intent,
        matchedKeywords: collectMatchedKeywords(normalized, rule.keywords),
      };
    }
  }

  return { intent: 'out_of_scope', matchedKeywords: [] };
}

function identifyEnglishIntent(normalized: string): IntentMatch | null {
  const englishRules: Array<{
    intent: AiIntent;
    keyword: string;
    pattern: RegExp;
  }> = [
    {
      intent: 'management_suggestion',
      keyword: 'business risk',
      pattern: /\b(management\s+suggestion|business\s+risk)\b/i,
    },
    {
      intent: 'logistics_lookup',
      keyword: 'logistics',
      pattern: /\b(logistics|tracking)\b/i,
    },
    {
      intent: 'after_sales_lookup',
      keyword: 'after sales',
      pattern: /\bafter\s+sales\b/i,
    },
    {
      intent: 'commission_query',
      keyword: 'commission',
      pattern: /\bcommission\b/i,
    },
    {
      intent: 'refund_query',
      keyword: 'refund',
      pattern: /\brefund\b/i,
    },
    {
      intent: 'finance_summary',
      keyword: 'finance summary',
      pattern: /\bfinance\s+summary\b/i,
    },
    {
      intent: 'taster_detail',
      keyword: 'taster detail',
      pattern: /\btaster\b.*\b(detail|why|drop|decline)\b/i,
    },
    {
      intent: 'taster_ranking',
      keyword: 'taster ranking',
      pattern: /\btaster\b.*\b(rank|ranking|top)\b/i,
    },
    {
      intent: 'analytics_trend',
      keyword: 'trend',
      pattern: /\btrend\b/i,
    },
    {
      intent: 'analytics_overview',
      keyword: 'sales amount',
      pattern: /\b(sales\s+amount|revenue|sales\s+overview)\b/i,
    },
    {
      intent: 'customer_order_lookup',
      keyword: 'customer order',
      pattern: /\b(customer|order)\b/i,
    },
  ];

  const match = englishRules.find((rule) => rule.pattern.test(normalized));
  if (!match) {
    return null;
  }
  return {
    intent: match.intent,
    matchedKeywords: [match.keyword],
  };
}

export function resolveAiDateRange(
  question: string | null | undefined,
  intent: AiIntent,
  options: AiIntentParseOptions = {},
): AiDateRange | null {
  if (
    intent === 'unsafe_write_request' ||
    intent === 'permission_denied' ||
    intent === 'out_of_scope'
  ) {
    return null;
  }

  const customRange = parseCustomDateRange(question);
  if (customRange) {
    return normalizeAnalyticsDateRange(
      {
        preset: 'custom',
        dateFrom: customRange.dateFrom,
        dateTo: customRange.dateTo,
      },
      { now: options.now },
    );
  }

  const presetMatch = matchDatePreset(question);
  if (presetMatch) {
    return normalizeAnalyticsDateRange(
      { preset: presetMatch.preset },
      { now: options.now },
    );
  }

  if (THIS_MONTH_DEFAULT_INTENTS.has(intent)) {
    return normalizeAnalyticsDateRange(
      { preset: 'this_month' },
      { now: options.now },
    );
  }

  return null;
}

export function matchDatePreset(
  question: string | null | undefined,
): DatePresetMatch | null {
  const normalized = normalizeQuestion(question);
  if (!normalized) {
    return null;
  }

  for (const rule of DATE_PRESET_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return {
        preset: rule.preset,
        matchedKeyword:
          collectMatchedKeywords(normalized, rule.keywords)[0] || rule.preset,
      };
    }
  }

  return null;
}

function parseCustomDateRange(
  question: string | null | undefined,
): { dateFrom: string; dateTo: string } | null {
  const normalized = normalizeQuestion(question);
  if (!normalized) {
    return null;
  }

  const matches = [...normalized.matchAll(DATE_ONLY_PATTERN)];
  if (matches.length < 2) {
    return null;
  }

  return {
    dateFrom: formatDateMatch(matches[0]),
    dateTo: formatDateMatch(matches[1]),
  };
}

function formatDateMatch(match: RegExpMatchArray): string {
  return [
    match[1].padStart(4, '0'),
    match[2].padStart(2, '0'),
    match[3].padStart(2, '0'),
  ].join('-');
}

function resolveLimit(
  intent: AiIntent,
  options: AiIntentParseOptions,
): number | null {
  if (!LOOKUP_LIMIT_INTENTS.has(intent)) {
    return null;
  }
  const configured = Number(options.defaultLimit);
  if (Number.isInteger(configured) && configured > 0) {
    return configured;
  }
  return AI_DEFAULT_LOOKUP_LIMIT;
}

function buildWarnings(intent: AiIntent, dateRange: AiDateRange | null) {
  if (LOOKUP_LIMIT_INTENTS.has(intent) && !dateRange) {
    return ['未指定时间范围，查询类意图默认不限时间，但必须限制返回行数。'];
  }
  return [];
}

function collectMatchedKeywords(normalized: string, keywords: string[]) {
  const hits = keywords.filter((keyword) =>
    normalized.includes(keyword.toLowerCase()),
  );
  return hits.length ? hits : keywords.slice(0, 1);
}

function normalizeQuestion(question: string | null | undefined): string {
  return String(question || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
