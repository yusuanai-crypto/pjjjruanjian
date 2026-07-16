import { Injectable } from '@nestjs/common';

export type AiPolicyDecisionCode =
  | 'AI_ALLOWED'
  | 'AI_ROLE_NOT_ALLOWED'
  | 'AI_PERMISSION_DENIED'
  | 'AI_UNSAFE_WRITE_REQUEST'
  | 'AI_SQL_REQUEST_DENIED'
  | 'AI_OUT_OF_SCOPE';

export interface AiPolicyDecision {
  allowed: boolean;
  code: AiPolicyDecisionCode;
  intent: string;
  rejectionIntent: string | null;
  scopeDescription: string;
  reason: string | null;
  warnings: string[];
}

export interface AiPolicyInput {
  intent?: string | null;
  question?: string | null;
}

const AI_ALLOWED_ROLES = ['super_admin', 'admin', 'boss', 'finance', 'after_sales'];
const READ_ONLY_ANALYTICS_INTENTS = [
  'analytics_overview',
  'analytics_trend',
  'metric_explain',
  'taster_ranking',
  'taster_detail',
  'ranking_explain',
  'analytics_source_orders',
  'analytics_source_travel_groups',
  'analytics_source_after_sales',
];
const MANAGEMENT_INTENTS = ['management_suggestion'];
const FINANCE_INTENTS = [
  'finance_summary',
  'commission_query',
  'refund_query',
  'travel_group_finance_query',
  'points_query',
  'logistics_fee_query',
  'logistics_lookup',
  'commission_rule_explain',
  'reconciliation_lookup',
];
const AFTER_SALES_INTENTS = [
  'customer_lookup',
  'customer_order_lookup',
  'after_sales_lookup',
  'logistics_lookup',
];
const ADMIN_BOSS_INTENTS = [
  ...READ_ONLY_ANALYTICS_INTENTS,
  ...MANAGEMENT_INTENTS,
  ...FINANCE_INTENTS,
  ...AFTER_SALES_INTENTS,
];
const ROLE_INTENTS: Record<string, string[]> = {
  super_admin: ADMIN_BOSS_INTENTS,
  admin: ADMIN_BOSS_INTENTS,
  boss: ADMIN_BOSS_INTENTS,
  finance: [...READ_ONLY_ANALYTICS_INTENTS, ...FINANCE_INTENTS],
  after_sales: AFTER_SALES_INTENTS,
};
const DENY_INTENTS: Record<string, AiPolicyDecisionCode> = {
  unsafe_write_request: 'AI_UNSAFE_WRITE_REQUEST',
  permission_denied: 'AI_PERMISSION_DENIED',
  out_of_scope: 'AI_OUT_OF_SCOPE',
};

const WRITE_REQUEST_PATTERN =
  /(修改|改成|改为|更改|更新|删除|删掉|新增|创建|录入|写入|导入|批量导入|重算|重新计算|刷新|关闭全局|恢复全局|change|update|delete|insert|create|patch|post|write|recalculate|confirm|import|(?:帮我|请|把|将|给我|直接).{0,20}(确认|取消确认|结算|发货|打包|标记))/i;
const SQL_REQUEST_PATTERN =
  /(\bsql\b|\bselect\b|\binsert\b|\bupdate\b|\bdelete\b|\bdrop\b|\balter\b|\btruncate\b|\bjoin\b|\bwhere\b|写\s*sql|执行\s*sql|生成\s*sql|跑\s*sql|数据库连接|连接数据库|查库|数据表)/i;

@Injectable()
export class AiPolicyService {
  canUseAi(actorOrRole: any): boolean {
    const role = normalizeRole(actorOrRole);
    return AI_ALLOWED_ROLES.includes(role);
  }

  getAllowedIntents(actorOrRole: any): string[] {
    const role = normalizeRole(actorOrRole);
    return [...(ROLE_INTENTS[role] || [])];
  }

  canUseIntent(actorOrRole: any, intent: string | null | undefined): boolean {
    const normalizedIntent = normalizeIntent(intent);
    if (!this.canUseAi(actorOrRole)) {
      return false;
    }
    return this.getAllowedIntents(actorOrRole).includes(normalizedIntent);
  }

  getScopeDescription(actorOrRole: any): string {
    const role = normalizeRole(actorOrRole);
    return getScopeDescription(role);
  }

  evaluateRequest(actorOrRole: any, input: AiPolicyInput = {}): AiPolicyDecision {
    const role = normalizeRole(actorOrRole);
    const intent = normalizeIntent(input.intent);
    const scopeDescription = getScopeDescription(role);
    const unsafeQuestionCode = classifyUnsafeQuestion(input.question);
    const explicitDenyCode = DENY_INTENTS[intent] || null;
    const deniedCode = unsafeQuestionCode || explicitDenyCode;

    if (deniedCode) {
      return buildDeniedDecision({
        code: deniedCode,
        intent,
        scopeDescription,
      });
    }

    if (!this.canUseAi(role)) {
      return buildDeniedDecision({
        code: 'AI_ROLE_NOT_ALLOWED',
        intent,
        scopeDescription,
      });
    }

    if (!this.canUseIntent(role, intent)) {
      return buildDeniedDecision({
        code: 'AI_PERMISSION_DENIED',
        intent,
        scopeDescription,
      });
    }

    return {
      allowed: true,
      code: 'AI_ALLOWED',
      intent,
      rejectionIntent: null,
      scopeDescription,
      reason: null,
      warnings: [],
    };
  }
}

export function normalizeRole(actorOrRole: any): string {
  const value =
    typeof actorOrRole === 'string' ? actorOrRole : actorOrRole?.role || '';
  return String(value).trim().toLowerCase();
}

export function normalizeIntent(intent: string | null | undefined): string {
  const value = String(intent || '').trim();
  return value || 'unknown';
}

export function classifyUnsafeQuestion(
  question: string | null | undefined,
): AiPolicyDecisionCode | null {
  const normalized = String(question || '').trim();
  if (!normalized) {
    return null;
  }
  if (WRITE_REQUEST_PATTERN.test(normalized)) {
    return 'AI_UNSAFE_WRITE_REQUEST';
  }
  if (SQL_REQUEST_PATTERN.test(normalized)) {
    return 'AI_SQL_REQUEST_DENIED';
  }
  return null;
}

function buildDeniedDecision({
  code,
  intent,
  scopeDescription,
}: {
  code: AiPolicyDecisionCode;
  intent: string;
  scopeDescription: string;
}): AiPolicyDecision {
  return {
    allowed: false,
    code,
    intent,
    rejectionIntent: getRejectionIntent(code),
    scopeDescription,
    reason: getRejectionReason(code),
    warnings: [getRejectionReason(code)],
  };
}

function getRejectionIntent(code: AiPolicyDecisionCode): string | null {
  if (code === 'AI_UNSAFE_WRITE_REQUEST') {
    return 'unsafe_write_request';
  }
  if (code === 'AI_PERMISSION_DENIED' || code === 'AI_ROLE_NOT_ALLOWED') {
    return 'permission_denied';
  }
  if (code === 'AI_SQL_REQUEST_DENIED' || code === 'AI_OUT_OF_SCOPE') {
    return 'out_of_scope';
  }
  return null;
}

function getRejectionReason(code: AiPolicyDecisionCode): string {
  const reasons: Record<AiPolicyDecisionCode, string> = {
    AI_ALLOWED: '',
    AI_ROLE_NOT_ALLOWED: '该角色第一版不可使用 AI 助手。',
    AI_PERMISSION_DENIED: '当前角色没有权限使用该 AI 意图。',
    AI_UNSAFE_WRITE_REQUEST: 'AI 只能做受控只读查询、解释和建议，不能直接修改业务数据。',
    AI_SQL_REQUEST_DENIED: 'AI 不能生成、执行 SQL，也不能直接连接数据库。',
    AI_OUT_OF_SCOPE: '该请求超出第 9 阶段 AI 数据助手第一版范围。',
  };
  return reasons[code];
}

function getScopeDescription(role: string): string {
  const descriptions: Record<string, string> = {
    admin:
      '管理员可在 AI 中读取第一版允许的全局业务数据，仍受角色权限和全局标记过滤约束。',
    boss:
      '老板可读取经营看板、排名、趋势、客户订单和财务摘要，并可请求经营建议；仍受全局标记过滤约束。',
    finance:
      '财务可读取退款、物流费用、提成、积分、财务核对和只读统计数据；不包含经营建议。',
    after_sales:
      '售后可读取客户订单、售后历史和物流单号等售后相关数据。',
    warehouse: '库管第一版不可使用 AI 助手。',
    sales: '销售第一版不可使用 AI 助手。',
    taster: '品鉴师第一版不可使用 AI 助手。',
    front_desk: '前台第一版不可使用 AI 助手。',
  };
  return descriptions[role] || '该角色第一版不可使用 AI 助手。';
}
