import { Injectable } from '@nestjs/common';

import { createHttpError } from '../../common/errors';
import { normalizeRole } from './ai-policy.service';

export interface AiChatTemplate {
  id: string;
  title: string;
  question: string;
  intent: string;
  roleScopes: string[];
}

const ROLE_TEMPLATE_GROUPS: Record<string, AiChatTemplate[]> = {
  super_admin: buildManagementTemplates(),
  admin: buildManagementTemplates(),
  boss: buildManagementTemplates(),
  finance: [
    {
      id: 'finance_refund_amount',
      title: '退款金额',
      question: '本月已确认退款金额是多少？',
      intent: 'refund_query',
      roleScopes: ['finance'],
    },
    {
      id: 'finance_logistics_fee',
      title: '物流费用',
      question: '本月物流费用是多少？',
      intent: 'finance_summary',
      roleScopes: ['finance'],
    },
    {
      id: 'finance_commission',
      title: '销售提成',
      question: '本月销售提成总额是多少？',
      intent: 'commission_query',
      roleScopes: ['finance'],
    },
    {
      id: 'finance_points',
      title: '旅行团积分',
      question: '某个旅行团返积分情况怎么样？',
      intent: 'finance_summary',
      roleScopes: ['finance'],
    },
    {
      id: 'finance_reconciliation',
      title: '财务核对',
      question: '本月财务核对情况怎么样？',
      intent: 'finance_summary',
      roleScopes: ['finance'],
    },
  ],
  after_sales: [
    {
      id: 'after_sales_customer_orders',
      title: '客户订单',
      question: '电话 138 开头客户买过什么酒？',
      intent: 'customer_order_lookup',
      roleScopes: ['after_sales'],
    },
    {
      id: 'after_sales_history',
      title: '售后历史',
      question: '某订单有没有售后记录？',
      intent: 'after_sales_lookup',
      roleScopes: ['after_sales'],
    },
    {
      id: 'after_sales_logistics_no',
      title: '物流单号',
      question: '某物流单号对应哪一个订单？',
      intent: 'logistics_lookup',
      roleScopes: ['after_sales'],
    },
  ],
};

@Injectable()
export class AiTemplatesService {
  listTemplates(actorOrRole: any): AiChatTemplate[] {
    const role = normalizeRole(actorOrRole);
    const templates = ROLE_TEMPLATE_GROUPS[role];
    if (!templates) {
      throw createHttpError(
        403,
        'AI_ROLE_NOT_ALLOWED',
        'This role cannot use the stage 9 AI assistant.',
      );
    }
    return templates.map(cloneTemplate);
  }
}

function buildManagementTemplates(): AiChatTemplate[] {
  const managementRoleScopes = ['super_admin', 'admin', 'boss'];
  return [
    {
      id: 'management_sales_amount',
      title: '销售额',
      question: '今天销售额是多少？',
      intent: 'analytics_overview',
      roleScopes: managementRoleScopes,
    },
    {
      id: 'management_taster_ranking',
      title: '品鉴师排名',
      question: '本月哪个品鉴师排名第一？',
      intent: 'taster_ranking',
      roleScopes: managementRoleScopes,
    },
    {
      id: 'management_no_order_rate',
      title: '打蛋率',
      question: '近 10 天打蛋率是多少？',
      intent: 'analytics_overview',
      roleScopes: managementRoleScopes,
    },
    {
      id: 'management_refund_amount',
      title: '退单金额',
      question: '本月退单金额是多少？',
      intent: 'refund_query',
      roleScopes: managementRoleScopes,
    },
    {
      id: 'management_suggestion',
      title: '经营建议',
      question: '最近经营情况有什么风险？',
      intent: 'management_suggestion',
      roleScopes: managementRoleScopes,
    },
  ];
}

function cloneTemplate(template: AiChatTemplate): AiChatTemplate {
  return {
    ...template,
    roleScopes: [...template.roleScopes],
  };
}
