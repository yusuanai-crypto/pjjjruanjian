import { Injectable } from '@nestjs/common';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import { CommissionRecordsNestService } from './commission-records.nest.service';
import { TravelGroupFinanceSummaryNestService } from './travel-group-finance-summary.nest.service';

const WRITE_ROLES = ['admin', 'finance'];
const AGENCY_TARGET_TYPES = [
  'AGENCY_DAILY_REBATE',
  'AGENCY_MONTHLY_REBATE',
];
const EMPLOYEE_TARGET_TYPES = [
  'SALES_COMMISSION',
  'OUTREACH_COMMISSION',
  'LEADER_COMMISSION',
];
const MAX_RECALCULATION_ORDERS = 5000;

@Injectable()
export class AgencyRuleRecalculationNestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commissionRecordsService: CommissionRecordsNestService,
    private readonly summaryService: TravelGroupFinanceSummaryNestService,
    private readonly operationLogsService: OperationLogsNestService,
  ) {}

  async recalculateForAgencyRuleChange(
    actor: any,
    input: {
      source: string;
      ruleKind: 'agencyDeduction' | 'agencyRebate';
      rules: any[];
      ruleIds?: string[];
    },
    metadata: any = {},
  ) {
    requireAnyRole(actor, WRITE_ROLES);
    const descriptors = await this.buildRuleScopeDescriptors(input.rules);
    return this.recalculateScope(
      actor,
      {
        source: normalizeRequiredString(input.source, 'source'),
        agencyOnly: true,
        descriptors,
        ruleIds: uniqueStrings(input.ruleIds || input.rules.map((rule) => rule?.id)),
        ruleKind: input.ruleKind,
      },
      metadata,
    );
  }

  async recalculateExplicit(actor: any, payload: any, metadata: any = {}) {
    requireAnyRole(actor, WRITE_ROLES);
    const scope = await this.buildExplicitScope(payload);
    return this.recalculateScope(
      actor,
      {
        ...scope,
        source: 'commission_records.recalculate.api',
        agencyOnly: payload?.agencyOnly === true,
        ruleIds: [],
        ruleKind: null,
      },
      metadata,
    );
  }

  private async recalculateScope(
    actor: any,
    scope: any,
    metadata: any,
  ) {
    const located = await this.findAffectedOrders(scope);
    const orders = located.orders;
    const warnings: any[] = [...located.warnings];
    const generatedRecords: any[] = [];
    const updatedRecords: any[] = [];
    const unchangedRecords: any[] = [];
    const refreshedSummaries: any[] = [];
    let successCount = 0;
    let failureCount = 0;
    let skippedConfirmedCount = 0;
    let skippedManualOverrideCount = 0;

    const grouped = groupOrdersByTravelGroup(orders);
    for (const [travelGroupId, groupOrders] of grouped.entries()) {
      const currentSummary = travelGroupId
        ? await this.prisma.travelGroupFinanceSummary.findUnique({
            where: { travelGroupId },
          })
        : null;
      const manualOverride = hasManualAgencyDeduction(currentSummary);
      const deductionConfirmed = Boolean(
        currentSummary?.agencyDeductionConfirmed,
      );
      const skipTargetTypes = new Set<string>();

      if (manualOverride) {
        skippedManualOverrideCount += groupOrders.length;
        skipTargetTypes.add('AGENCY_DAILY_REBATE');
        skipTargetTypes.add('AGENCY_MONTHLY_REBATE');
        warnings.push({
          code: 'manual_override',
          message: '该旅行团已人工维护扣酒成本，规则自动重算已跳过。',
          context: {
            travelGroupId,
            orderCount: groupOrders.length,
          },
        });
      } else if (deductionConfirmed) {
        skippedConfirmedCount += groupOrders.length;
        skipTargetTypes.add('AGENCY_DAILY_REBATE');
        skipTargetTypes.add('AGENCY_MONTHLY_REBATE');
        warnings.push({
          code: 'agency_deduction_confirmed',
          message: '该旅行团扣酒成本已确认，规则自动重算已跳过。',
          context: {
            travelGroupId,
            orderCount: groupOrders.length,
          },
        });
      } else {
        if (currentSummary?.dailyRebatePaid) {
          skippedConfirmedCount += groupOrders.length;
          skipTargetTypes.add('AGENCY_DAILY_REBATE');
          warnings.push({
            code: 'daily_rebate_paid',
            message: '该旅行团日返积分已返款，日返记录未被自动修改。',
            context: {
              travelGroupId,
              orderCount: groupOrders.length,
            },
          });
        }
        if (currentSummary?.monthlyRebatePaid) {
          skippedConfirmedCount += groupOrders.length;
          skipTargetTypes.add('AGENCY_MONTHLY_REBATE');
          warnings.push({
            code: 'monthly_rebate_paid',
            message: '该旅行团月返积分已返款，月返记录未被自动修改。',
            context: {
              travelGroupId,
              orderCount: groupOrders.length,
            },
          });
        }
      }

      const requestedTargetTypes = scope.agencyOnly
        ? AGENCY_TARGET_TYPES
        : [...EMPLOYEE_TARGET_TYPES, ...AGENCY_TARGET_TYPES];
      const activeAgencyTargetCount = AGENCY_TARGET_TYPES.filter(
        (targetType) => !skipTargetTypes.has(targetType),
      ).length;
      const activeRequestedTargetCount = requestedTargetTypes.filter(
        (targetType) => !skipTargetTypes.has(targetType),
      ).length;

      for (const order of groupOrders) {
        if (activeRequestedTargetCount === 0) {
          continue;
        }
        try {
          const result =
            await this.commissionRecordsService.recalculateSalesOrderRecords(
              order.id,
              {
                actor,
                ipAddress: metadata.ipAddress || null,
                targetTypes: requestedTargetTypes,
                skipTargetTypes: Array.from(skipTargetTypes),
                trigger: scope.source,
              },
            );
          generatedRecords.push(...result.generatedRecords);
          updatedRecords.push(...result.updatedRecords);
          unchangedRecords.push(...result.unchangedRecords);
          warnings.push(
            ...translateCalculationWarnings(result.warnings, order),
          );
          successCount += 1;
        } catch {
          failureCount += 1;
          warnings.push({
            code: 'order_recalculation_failed',
            message: '订单积分重算失败，请稍后重试或联系管理员。',
            context: {
              salesOrderId: order.id,
              travelGroupId,
            },
          });
        }
      }

      if (
        travelGroupId &&
        activeAgencyTargetCount > 0 &&
        groupOrders.length > 0
      ) {
        try {
          await this.summaryService.refreshTravelGroupFinanceSummary(
            travelGroupId,
            {
              actor,
              ipAddress: metadata.ipAddress || null,
            },
          );
          refreshedSummaries.push(
            await this.summaryService.getRecalculatedTravelGroupFinanceSummary(
              travelGroupId,
            ),
          );
        } catch {
          failureCount += 1;
          warnings.push({
            code: 'travel_group_summary_refresh_failed',
            message: '订单级积分已处理，但旅行团积分汇总刷新失败，请稍后重试。',
            context: {
              travelGroupId,
            },
          });
        }
      }
    }

    const normalizedWarnings = deduplicateWarnings(warnings);
    const skippedCount =
      skippedConfirmedCount + skippedManualOverrideCount + failureCount;
    const result = {
      source: scope.source,
      agencyOnly: Boolean(scope.agencyOnly),
      ruleIds: uniqueStrings(scope.ruleIds || []),
      orderCount: orders.length,
      travelGroupCount: Array.from(grouped.keys()).filter(Boolean).length,
      successCount,
      failureCount,
      skippedCount,
      skippedConfirmedCount,
      skippedManualOverrideCount,
      generatedCount: generatedRecords.length,
      updatedCount: updatedRecords.length,
      unchangedCount: unchangedRecords.length,
      generatedRecords,
      updatedRecords,
      unchangedRecords,
      travelGroupFinanceSummaries: refreshedSummaries,
      warnings: normalizedWarnings,
    };

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'commission_records.agency_scope.recalculate',
      entityType: 'agency_rule_recalculation',
      entityId: result.ruleIds[0] || summarizeScopeId(scope),
      beforeData: null,
      afterData: {
        triggerSource: result.source,
        ruleKind: scope.ruleKind || null,
        ruleIds: result.ruleIds,
        orderCount: result.orderCount,
        travelGroupCount: result.travelGroupCount,
        successCount: result.successCount,
        failureCount: result.failureCount,
        skippedCount: result.skippedCount,
        skippedConfirmedCount: result.skippedConfirmedCount,
        skippedManualOverrideCount: result.skippedManualOverrideCount,
        warningSummary: summarizeWarnings(normalizedWarnings),
      },
      ipAddress: metadata.ipAddress || null,
    });

    return result;
  }

  private async buildRuleScopeDescriptors(rules: any[]) {
    const normalizedRules = (rules || []).filter(Boolean);
    if (normalizedRules.length === 0) {
      return [];
    }
    const agencyIds = uniqueStrings(
      normalizedRules.map((rule) => rule.agencyId),
    );
    const agencies = agencyIds.length
      ? await this.prisma.travelAgency.findMany({
          where: {
            id: { in: agencyIds },
          },
          select: {
            id: true,
            name: true,
          },
        })
      : [];
    const agencyNamesById = new Map(
      agencies.map((agency: any) => [agency.id, agency.name]),
    );
    return normalizedRules.map((rule) => ({
      agencyId: normalizeOptionalString(rule.agencyId),
      agencyNames: uniqueStrings([
        rule.agencyName,
        agencyNamesById.get(rule.agencyId),
      ]),
      dateFrom: normalizeDateOnly(rule.effectiveFrom, 'effectiveFrom'),
      dateTo: rule.effectiveTo
        ? normalizeDateOnly(rule.effectiveTo, 'effectiveTo')
        : null,
    }));
  }

  private async buildExplicitScope(payload: any) {
    const salesOrderId = normalizeOptionalString(payload?.salesOrderId);
    const travelGroupId = normalizeOptionalString(payload?.travelGroupId);
    const travelGroupIds = uniqueStrings(payload?.travelGroupIds || []);
    if (travelGroupIds.length > 200) {
      throw createHttpError(
        400,
        'RECALCULATION_SCOPE_TOO_LARGE',
        'travelGroupIds cannot contain more than 200 items.',
      );
    }
    const directScopeCount = [
      Boolean(salesOrderId),
      Boolean(travelGroupId),
      travelGroupIds.length > 0,
    ].filter(Boolean).length;
    if (directScopeCount > 1) {
      throw createHttpError(
        400,
        'RECALCULATION_SCOPE_INVALID',
        'Use only one of salesOrderId, travelGroupId, or travelGroupIds.',
      );
    }
    if (salesOrderId || travelGroupId || travelGroupIds.length > 0) {
      return {
        salesOrderId,
        travelGroupIds: travelGroupId
          ? [travelGroupId]
          : travelGroupIds,
        descriptors: [],
      };
    }

    const agencyId = normalizeOptionalString(payload?.agencyId);
    const agencyName = normalizeOptionalString(payload?.agencyName);
    const dateFrom = normalizeDateOnly(payload?.dateFrom, 'dateFrom');
    const dateTo = normalizeDateOnly(payload?.dateTo, 'dateTo');
    if (!agencyId && !agencyName) {
      throw createHttpError(
        400,
        'RECALCULATION_SCOPE_REQUIRED',
        'salesOrderId, travelGroupId, travelGroupIds, or agency and date range is required.',
      );
    }
    if (dateTo.getTime() < dateFrom.getTime()) {
      throw createHttpError(
        400,
        'RECALCULATION_SCOPE_INVALID',
        'dateTo cannot be earlier than dateFrom.',
      );
    }
    let resolvedAgencyName = agencyName;
    if (agencyId) {
      const agency = await this.prisma.travelAgency.findUnique({
        where: { id: agencyId },
        select: { id: true, name: true },
      });
      if (!agency) {
        throw createHttpError(
          404,
          'TRAVEL_AGENCY_NOT_FOUND',
          'Travel agency does not exist.',
        );
      }
      resolvedAgencyName = agency.name;
    }
    return {
      salesOrderId: null,
      travelGroupIds: [],
      descriptors: [
        {
          agencyId,
          agencyNames: uniqueStrings([agencyName, resolvedAgencyName]),
          dateFrom,
          dateTo,
        },
      ],
    };
  }

  private async findAffectedOrders(scope: any) {
    if (scope.salesOrderId) {
      const order = await this.prisma.salesOrder.findUnique({
        where: { id: scope.salesOrderId },
        select: affectedOrderSelect(),
      });
      if (!order) {
        throw createHttpError(
          404,
          'SALES_ORDER_NOT_FOUND',
          'Sales order does not exist.',
        );
      }
      return { orders: [order], warnings: [] };
    }
    if (scope.travelGroupIds?.length) {
      const orders = await this.prisma.salesOrder.findMany({
        where: {
          travelGroupId: { in: scope.travelGroupIds },
        },
        select: affectedOrderSelect(),
        orderBy: [{ travelGroupId: 'asc' }, { orderDate: 'asc' }],
        take: MAX_RECALCULATION_ORDERS + 1,
      });
      assertOrderLimit(orders);
      return { orders, warnings: [] };
    }
    if (!scope.descriptors?.length) {
      return {
        orders: [],
        warnings: [
          {
            code: 'no_affected_scope',
            message: '规则操作没有产生可重算的旅行社或有效期范围。',
          },
        ],
      };
    }

    const agencyNames = uniqueStrings(
      scope.descriptors.flatMap((descriptor: any) => descriptor.agencyNames),
    );
    const candidates = await this.prisma.salesOrder.findMany({
      where: {
        travelGroup: {
          is: {
            OR: agencyNames.map((name) => ({
              travelAgency: { contains: name },
            })),
          },
        },
      },
      select: affectedOrderSelect(),
      orderBy: [{ travelGroupId: 'asc' }, { orderDate: 'asc' }],
      take: MAX_RECALCULATION_ORDERS + 1,
    });
    assertOrderLimit(candidates);
    const orders = candidates.filter((order: any) =>
      scope.descriptors.some((descriptor: any) =>
        orderMatchesDescriptor(order, descriptor),
      ),
    );
    const outOfRangeOrderCount = candidates.length - orders.length;
    return {
      orders,
      warnings:
        outOfRangeOrderCount > 0
          ? [
              {
                code: 'agency_rule_effective_date_not_matched',
                message: `该旅行社有 ${outOfRangeOrderCount} 笔订单的销售订单日期不在规则修改前或修改后的有效期内，未执行重算。`,
                context: { outOfRangeOrderCount },
              },
            ]
          : [],
    };
  }
}

function affectedOrderSelect() {
  return {
    id: true,
    orderDate: true,
    travelGroupId: true,
    travelGroup: {
      select: {
        id: true,
        travelAgency: true,
      },
    },
  };
}

function orderMatchesDescriptor(order: any, descriptor: any) {
  const orderAgencyName = normalizeComparable(order.travelGroup?.travelAgency);
  if (
    !descriptor.agencyNames.some(
      (name: string) => normalizeComparable(name) === orderAgencyName,
    )
  ) {
    return false;
  }
  const orderDate = normalizeDateOnly(order.orderDate, 'orderDate');
  return (
    orderDate.getTime() >= descriptor.dateFrom.getTime() &&
    (!descriptor.dateTo ||
      orderDate.getTime() <= descriptor.dateTo.getTime())
  );
}

function groupOrdersByTravelGroup(orders: any[]) {
  const grouped = new Map<string | null, any[]>();
  for (const order of orders) {
    const key = normalizeOptionalString(order.travelGroupId);
    const group = grouped.get(key) || [];
    group.push(order);
    grouped.set(key, group);
  }
  return grouped;
}

function hasManualAgencyDeduction(summary: any) {
  return (
    isPlainObject(summary?.sourceSnapshot?.agencyDeduction) &&
    summary.sourceSnapshot.agencyDeduction.mode === 'manual'
  );
}

function translateCalculationWarnings(warnings: any[], order: any) {
  const result: any[] = [];
  for (const warning of warnings || []) {
    const context = {
      salesOrderId: order.id,
      travelGroupId: order.travelGroupId || null,
      ...(isPlainObject(warning?.context) ? warning.context : {}),
    };
    switch (warning?.code) {
      case 'missing_agency_deduction_rule':
        result.push({
          code: 'missing_agency_deduction_rule',
          message: '未找到该销售订单日期生效的旅行社扣酒规则，扣酒成本按 0 计算。',
          context,
        });
        break;
      case 'missing_agency_rebate_rule':
        result.push(
          {
            code: 'missing_agency_daily_rebate_rule',
            message: '未找到该销售订单日期生效的日返规则，日返积分按 0 计算。',
            context,
          },
          {
            code: 'missing_agency_monthly_rebate_rule',
            message: '未找到该销售订单日期生效的月返规则，月返积分按 0 计算。',
            context,
          },
        );
        break;
      default:
        if (
          warning?.code === 'travel_agency_id_not_matched' ||
          warning?.code === 'missing_travel_agency'
        ) {
          result.push({
            code: warning.code,
            message: '订单旅行社信息无法匹配，旅行社积分可能按 0 计算。',
            context,
          });
        }
    }
  }
  return result;
}

function deduplicateWarnings(warnings: any[]) {
  const seen = new Set<string>();
  const result: any[] = [];
  for (const warning of warnings || []) {
    const normalized = {
      code: normalizeOptionalString(warning?.code) || 'recalculation_warning',
      message:
        normalizeOptionalString(warning?.message) || '重算产生待处理提示。',
      ...(isPlainObject(warning?.context)
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

function summarizeScopeId(scope: any) {
  if (scope.salesOrderId) {
    return `salesOrder:${scope.salesOrderId}`;
  }
  if (scope.travelGroupIds?.length === 1) {
    return `travelGroup:${scope.travelGroupIds[0]}`;
  }
  if (scope.travelGroupIds?.length > 1) {
    return `travelGroups:${scope.travelGroupIds.length}`;
  }
  return 'agency-date-scope';
}

function assertOrderLimit(orders: any[]) {
  if (orders.length > MAX_RECALCULATION_ORDERS) {
    throw createHttpError(
      400,
      'RECALCULATION_SCOPE_TOO_LARGE',
      `Recalculation scope exceeds ${MAX_RECALCULATION_ORDERS} orders.`,
    );
  }
}

function requireAnyRole(actor: any, roles: string[]) {
  if (
    !actor ||
    (!roles.includes(actor.role) &&
      !(actor.role === 'super_admin' && roles.includes('admin')))
  ) {
    throw createHttpError(403, 'PERMISSION_DENIED', 'Permission denied.');
  }
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

function normalizeComparable(value: unknown) {
  return String(normalizeOptionalString(value) || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function normalizeDateOnly(value: unknown, fieldName: string) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
  }
  const text = normalizeRequiredString(value, fieldName);
  const dateText = text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be YYYY-MM-DD.`,
    );
  }
  const date = new Date(`${dateText}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== dateText
  ) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be a valid date.`,
    );
  }
  return date;
}

function uniqueStrings(values: unknown) {
  const source = Array.isArray(values) ? values : [];
  return Array.from(
    new Set(
      source
        .map(normalizeOptionalString)
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function isPlainObject(value: any) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
