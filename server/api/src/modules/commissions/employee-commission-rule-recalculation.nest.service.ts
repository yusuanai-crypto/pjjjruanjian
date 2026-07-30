import { Injectable } from '@nestjs/common';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import { CommissionRecordsNestService } from './commission-records.nest.service';

const WRITE_ROLES = ['admin', 'finance'];
const MAX_RECALCULATION_ORDERS = 5000;
const COMMISSION_RULE_TARGET_TYPES: Record<string, string> = {
  sales_commission: 'SALES_COMMISSION',
  outreach_commission: 'OUTREACH_COMMISSION',
  leader_commission: 'LEADER_COMMISSION',
  SALES_COMMISSION: 'SALES_COMMISSION',
  OUTREACH_COMMISSION: 'OUTREACH_COMMISSION',
  LEADER_COMMISSION: 'LEADER_COMMISSION',
};

@Injectable()
export class EmployeeCommissionRuleRecalculationNestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commissionRecordsService: CommissionRecordsNestService,
    private readonly operationLogsService: OperationLogsNestService,
  ) {}

  async recalculateForCommissionRuleChange(
    actor: any,
    input: {
      source: string;
      rules: any[];
      ruleIds?: string[];
    },
    metadata: any = {},
  ) {
    requireAnyRole(actor, WRITE_ROLES);
    const source = normalizeRequiredString(input.source, 'source');
    const descriptors = buildRuleScopeDescriptors(input.rules);
    const targetTypes = uniqueStrings(
      descriptors.map((descriptor) => descriptor.targetType),
    );
    const ruleIds = uniqueStrings(
      input.ruleIds || input.rules.map((rule) => rule?.id),
    );
    const orders = await this.findAffectedOrders(descriptors);
    const generatedRecords: any[] = [];
    const updatedRecords: any[] = [];
    const unchangedRecords: any[] = [];
    const warnings: any[] = [];
    let successCount = 0;
    let failureCount = 0;
    let skippedCount = 0;

    for (const order of orders) {
      try {
        const result =
          await this.commissionRecordsService.recalculateSalesOrderRecords(
            order.id,
            {
              actor,
              ipAddress: metadata.ipAddress || null,
              targetTypes,
              trigger: source,
            },
          );
        generatedRecords.push(...result.generatedRecords);
        updatedRecords.push(...result.updatedRecords);
        unchangedRecords.push(...result.unchangedRecords);
        const translatedWarnings = translateCalculationWarnings(
          result.warnings,
          order,
          targetTypes,
        );
        warnings.push(...translatedWarnings);
        if (hasSkippedEmployeeTarget(translatedWarnings)) {
          skippedCount += 1;
        }
        successCount += 1;
      } catch (error) {
        failureCount += 1;
        warnings.push({
          code: 'order_recalculation_failed',
          message: '该订单的员工提成重算失败，其他订单已继续处理，请稍后重试。',
          context: {
            salesOrderId: order.id,
            travelGroupId: normalizeOptionalString(order.travelGroupId),
            errorCode: normalizeOptionalString((error as any)?.code),
          },
        });
      }
    }

    const normalizedWarnings = deduplicateWarnings(warnings);
    const result = {
      source,
      ruleIds,
      targetTypes,
      orderCount: orders.length,
      successCount,
      failureCount,
      skippedCount,
      generatedCount: generatedRecords.length,
      updatedCount: updatedRecords.length,
      unchangedCount: unchangedRecords.length,
      generatedRecords,
      updatedRecords,
      unchangedRecords,
      orderRange: summarizeOrderRange(descriptors, orders),
      warnings: normalizedWarnings,
    };

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'commission_records.employee_scope.recalculate',
      entityType: 'employee_commission_rule_recalculation',
      entityId: ruleIds[0] || 'employee-commission-date-scope',
      beforeData: null,
      afterData: {
        triggerSource: source,
        ruleIds,
        targetTypes,
        orderRange: result.orderRange,
        orderCount: result.orderCount,
        successCount: result.successCount,
        failureCount: result.failureCount,
        skippedCount: result.skippedCount,
        generatedCount: result.generatedCount,
        updatedCount: result.updatedCount,
        unchangedCount: result.unchangedCount,
        warningSummary: summarizeWarnings(normalizedWarnings),
      },
      ipAddress: metadata.ipAddress || null,
    });

    return result;
  }

  private async findAffectedOrders(descriptors: any[]) {
    if (descriptors.length === 0) {
      return [];
    }
    const orders = await this.prisma.salesOrder.findMany({
      where: {
        orderType: { notIn: ['AFTER_SALES', 'BUYBACK'] },
        AND: [
          {
            OR: descriptors.map((descriptor) => ({
              orderDate: {
                gte: descriptor.dateFrom,
                ...(descriptor.dateTo ? { lte: descriptor.dateTo } : {}),
              },
            })),
          },
          {
            OR: [
              { workflowStatus: null },
              { workflowStatus: { in: ['APPROVED', 'COMPLETED'] } },
            ],
          },
        ],
      },
      select: {
        id: true,
        orderDate: true,
        travelGroupId: true,
      },
      orderBy: [{ orderDate: 'asc' }, { id: 'asc' }],
      take: MAX_RECALCULATION_ORDERS + 1,
    });
    if (orders.length > MAX_RECALCULATION_ORDERS) {
      throw createHttpError(
        400,
        'RECALCULATION_SCOPE_TOO_LARGE',
        `Employee commission recalculation scope exceeds ${MAX_RECALCULATION_ORDERS} orders.`,
      );
    }
    return orders;
  }
}

function buildRuleScopeDescriptors(rules: any[]) {
  return (rules || []).filter(Boolean).map((rule) => ({
    targetType: normalizeCommissionTargetType(rule.targetType),
    dateFrom: normalizeDateOnly(rule.effectiveFrom, 'effectiveFrom'),
    dateTo: rule.effectiveTo
      ? normalizeDateOnly(rule.effectiveTo, 'effectiveTo')
      : null,
  }));
}

function normalizeCommissionTargetType(value: unknown) {
  const text = normalizeRequiredString(value, 'targetType');
  const targetType = COMMISSION_RULE_TARGET_TYPES[text];
  if (!targetType) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'Commission rule targetType is invalid.',
    );
  }
  return targetType;
}

function translateCalculationWarnings(
  warnings: any[],
  order: any,
  targetTypes: string[],
) {
  const result: any[] = [];
  const context = {
    salesOrderId: order.id,
    travelGroupId: normalizeOptionalString(order.travelGroupId),
    orderDate: toDateOnly(order.orderDate),
  };
  for (const warning of warnings || []) {
    switch (warning?.code) {
      case 'missing_outreach_user':
        if (targetTypes.includes('OUTREACH_COMMISSION')) {
          result.push({
            code: warning.code,
            message: '订单未配置外联人员，外联提成未计算；系统不会自动猜测外联人员。',
            context,
          });
        }
        break;
      case 'missing_leader':
        if (targetTypes.includes('LEADER_COMMISSION')) {
          result.push({
            code: warning.code,
            message: '订单销售人员未配置组长，组长提成未计算；系统不会自动猜测组长人员。',
            context: {
              ...context,
              salesUserId: normalizeOptionalString(warning?.context?.salesUserId),
            },
          });
        }
        break;
      case 'missing_sales_user':
        if (targetTypes.includes('SALES_COMMISSION')) {
          result.push({
            code: warning.code,
            message: '订单未配置销售人员，销售提成未计算。',
            context,
          });
        }
        break;
      case 'missing_commission_rule': {
        const missingTargetType = normalizeOptionalString(
          warning?.context?.targetType,
        )?.toUpperCase();
        if (missingTargetType && targetTypes.includes(missingTargetType)) {
          result.push({
            code: warning.code,
            message: `${employeeTargetLabel(missingTargetType)}在订单日期没有生效规则，相应提成未计算。`,
            context: {
              ...context,
              targetType: missingTargetType,
              ruleDate:
                normalizeOptionalString(warning?.context?.date) ||
                context.orderDate,
            },
          });
        }
        break;
      }
      default:
        break;
    }
  }
  return result;
}

function employeeTargetLabel(targetType: string) {
  switch (targetType) {
    case 'OUTREACH_COMMISSION':
      return '外联提成';
    case 'LEADER_COMMISSION':
      return '组长提成';
    default:
      return '销售提成';
  }
}

function hasSkippedEmployeeTarget(warnings: any[]) {
  return warnings.some((warning) =>
    [
      'missing_outreach_user',
      'missing_leader',
      'missing_sales_user',
      'missing_commission_rule',
    ].includes(warning.code),
  );
}

function summarizeOrderRange(descriptors: any[], orders: any[]) {
  const orderTimes = orders
    .map((order) => normalizeDateOnly(order.orderDate, 'orderDate').getTime())
    .filter(Number.isFinite);
  return {
    requestedRanges: descriptors.map((descriptor) => ({
      targetType: descriptor.targetType,
      dateFrom: toDateOnly(descriptor.dateFrom),
      dateTo: descriptor.dateTo ? toDateOnly(descriptor.dateTo) : null,
    })),
    matchedDateFrom:
      orderTimes.length > 0 ? toDateOnly(new Date(Math.min(...orderTimes))) : null,
    matchedDateTo:
      orderTimes.length > 0 ? toDateOnly(new Date(Math.max(...orderTimes))) : null,
  };
}

function deduplicateWarnings(warnings: any[]) {
  const seen = new Set<string>();
  const result: any[] = [];
  for (const warning of warnings || []) {
    const normalized = {
      code: normalizeOptionalString(warning?.code) || 'recalculation_warning',
      message:
        normalizeOptionalString(warning?.message) || '员工提成重算产生待处理提示。',
      ...(warning?.context && typeof warning.context === 'object'
        ? { context: warning.context }
        : {}),
    };
    const key = JSON.stringify(normalized);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function summarizeWarnings(warnings: any[]) {
  const counts: Record<string, number> = {};
  for (const warning of warnings) {
    counts[warning.code] = (counts[warning.code] || 0) + 1;
  }
  return {
    count: warnings.length,
    codes: counts,
    messageSamples: warnings.slice(0, 10).map((warning) => warning.message),
    truncated: warnings.length > 10,
  };
}

function uniqueStrings(values: unknown[]) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map(normalizeOptionalString)
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function normalizeDateOnly(value: unknown, fieldName: string) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }
  const text = normalizeRequiredString(value, fieldName);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be a valid date.`,
    );
  }
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be a valid date.`,
    );
  }
  return date;
}

function toDateOnly(value: unknown) {
  return normalizeDateOnly(value, 'date').toISOString().slice(0, 10);
}

function normalizeRequiredString(value: unknown, fieldName: string) {
  const text = normalizeOptionalString(value);
  if (!text) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} is required.`,
    );
  }
  return text;
}

function normalizeOptionalString(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function requireAnyRole(actor: any, roles: string[]) {
  if (
    !actor ||
    (!roles.includes(actor.role) &&
      !(actor.role === 'super_admin' && roles.includes('admin')))
  ) {
    throw createHttpError(
      403,
      'PERMISSION_DENIED',
      'You do not have permission to recalculate employee commissions.',
    );
  }
}
