import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AgencyRuleRecalculationNestService } from '../commissions/agency-rule-recalculation.nest.service';
import { EmployeeCommissionRuleRecalculationNestService } from '../commissions/employee-commission-rule-recalculation.nest.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';

const READ_RULE_ROLES = ['admin', 'finance', 'boss'];
const WRITE_RULE_ROLES = ['admin', 'finance'];
const MAX_OPEN_ENDED_DATE = new Date('9999-12-31T00:00:00.000Z');
const AGENCY_DEDUCTION_MODE_EFFECTIVE_SALES_RATE = 'effective_sales_rate';
const AGENCY_DEDUCTION_MODE_MANUAL_PRODUCT_REFERENCE =
  'manual_product_reference';
const DEFAULT_AGENCY_DEDUCTION_RATE = '0.3000';

const COMMISSION_TARGET_TYPE_TO_PRISMA: any = {
  sales_commission: 'SALES_COMMISSION',
  outreach_commission: 'OUTREACH_COMMISSION',
  leader_commission: 'LEADER_COMMISSION',
  SALES_COMMISSION: 'SALES_COMMISSION',
  OUTREACH_COMMISSION: 'OUTREACH_COMMISSION',
  LEADER_COMMISSION: 'LEADER_COMMISSION',
};

const COMMISSION_TARGET_TYPE_FROM_PRISMA: any = {
  SALES_COMMISSION: 'sales_commission',
  OUTREACH_COMMISSION: 'outreach_commission',
  LEADER_COMMISSION: 'leader_commission',
};

type RuleKind =
  | 'commission'
  | 'salesDeduction'
  | 'agencyDeduction'
  | 'agencyRebate';

function isAgencyRuleKind(
  kind: RuleKind,
): kind is 'agencyDeduction' | 'agencyRebate' {
  return kind === 'agencyDeduction' || kind === 'agencyRebate';
}

const RULE_CONFIG: Record<string, any> = {
  commission: {
    delegate: 'commissionRule',
    collectionName: 'commissionRules',
    entityType: 'commission_rule',
    logPrefix: 'commission_rules',
    notFoundCode: 'COMMISSION_RULE_NOT_FOUND',
    overlapCode: 'RULE_EFFECTIVE_RANGE_OVERLAP',
    orderBy: { updatedAt: 'desc' },
    allowedFields: [
      'ruleName',
      'targetType',
      'rate',
      'effectiveFrom',
      'effectiveTo',
      'isActive',
      'notes',
    ],
    toDto: toCommissionRuleDto,
    buildWhere: buildCommissionRuleWhere,
    buildData: buildCommissionRuleData,
    dimensionKeys: (rule: any) => [`target:${rule.targetType}`],
  },
  salesDeduction: {
    delegate: 'salesDeductionRule',
    collectionName: 'salesDeductionRules',
    entityType: 'sales_deduction_rule',
    logPrefix: 'sales_deduction_rules',
    notFoundCode: 'SALES_DEDUCTION_RULE_NOT_FOUND',
    overlapCode: 'RULE_EFFECTIVE_RANGE_OVERLAP',
    orderBy: { updatedAt: 'desc' },
    allowedFields: [
      'productId',
      'deductionCostCents',
      'effectiveFrom',
      'effectiveTo',
      'isActive',
      'notes',
    ],
    toDto: toSalesDeductionRuleDto,
    buildWhere: buildSalesDeductionRuleWhere,
    buildData: buildSalesDeductionRuleData,
    dimensionKeys: (rule: any) => buildProductDimensionKeys(rule),
  },
  agencyDeduction: {
    delegate: 'agencyDeductionRule',
    collectionName: 'agencyDeductionRules',
    entityType: 'agency_deduction_rule',
    logPrefix: 'agency_deduction_rules',
    notFoundCode: 'AGENCY_DEDUCTION_RULE_NOT_FOUND',
    overlapCode: 'RULE_EFFECTIVE_RANGE_OVERLAP',
    orderBy: { updatedAt: 'desc' },
    allowedFields: [
      'agencyId',
      'agencyName',
      'calculationMode',
      'deductionRate',
      'productId',
      'deductionCostCents',
      'effectiveFrom',
      'effectiveTo',
      'isActive',
      'notes',
    ],
    toDto: toAgencyDeductionRuleDto,
    buildWhere: buildAgencyDeductionRuleWhere,
    buildData: buildAgencyDeductionRuleData,
    dimensionKeys: (rule: any) => buildAgencyDeductionDimensionKeys(rule),
  },
  agencyRebate: {
    delegate: 'agencyRebateRule',
    collectionName: 'agencyRebateRules',
    entityType: 'agency_rebate_rule',
    logPrefix: 'agency_rebate_rules',
    notFoundCode: 'AGENCY_REBATE_RULE_NOT_FOUND',
    overlapCode: 'RULE_EFFECTIVE_RANGE_OVERLAP',
    orderBy: { updatedAt: 'desc' },
    allowedFields: [
      'agencyId',
      'agencyName',
      'dailyRebateRate',
      'monthlyRebateRate',
      'totalRebateRate',
      'effectiveFrom',
      'effectiveTo',
      'isActive',
      'notes',
    ],
    toDto: toAgencyRebateRuleDto,
    buildWhere: buildAgencyRebateRuleWhere,
    buildData: buildAgencyRebateRuleData,
    dimensionKeys: (rule: any) => buildAgencyDimensionKeys(rule),
  },
};

@Injectable()
export class CommissionRulesNestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsNestService,
    private readonly agencyRuleRecalculationService: AgencyRuleRecalculationNestService,
    private readonly employeeCommissionRuleRecalculationService: EmployeeCommissionRuleRecalculationNestService,
  ) {}

  async listCommissionRules(actor: any, filters: any = {}) {
    return this.listRules('commission', actor, filters);
  }

  async createCommissionRule(actor: any, payload: any, metadata: any = {}) {
    return this.createRule('commission', actor, payload, metadata);
  }

  async updateCommissionRule(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    return this.updateRule('commission', actor, id, payload, metadata);
  }

  async listSalesDeductionRules(actor: any, filters: any = {}) {
    return this.listRules('salesDeduction', actor, filters);
  }

  async createSalesDeductionRule(
    actor: any,
    payload: any,
    metadata: any = {},
  ) {
    return this.createRule('salesDeduction', actor, payload, metadata);
  }

  async updateSalesDeductionRule(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    return this.updateRule('salesDeduction', actor, id, payload, metadata);
  }

  async batchImportSalesDeductionRules(
    actor: any,
    payload: any,
    metadata: any = {},
  ) {
    return this.batchImportRules('salesDeduction', actor, payload, metadata);
  }

  async listAgencyDeductionRules(actor: any, filters: any = {}) {
    return this.listRules('agencyDeduction', actor, filters);
  }

  async createAgencyDeductionRule(
    actor: any,
    payload: any,
    metadata: any = {},
  ) {
    return this.createRule('agencyDeduction', actor, payload, metadata);
  }

  async updateAgencyDeductionRule(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    return this.updateRule('agencyDeduction', actor, id, payload, metadata);
  }

  async batchImportAgencyDeductionRules(
    actor: any,
    payload: any,
    metadata: any = {},
  ) {
    return this.batchImportRules('agencyDeduction', actor, payload, metadata);
  }

  async listAgencyRebateRules(actor: any, filters: any = {}) {
    return this.listRules('agencyRebate', actor, filters);
  }

  async createAgencyRebateRule(actor: any, payload: any, metadata: any = {}) {
    return this.createRule('agencyRebate', actor, payload, metadata);
  }

  async updateAgencyRebateRule(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    return this.updateRule('agencyRebate', actor, id, payload, metadata);
  }

  async batchImportAgencyRebateRules(
    actor: any,
    payload: any,
    metadata: any = {},
  ) {
    return this.batchImportRules('agencyRebate', actor, payload, metadata);
  }

  private async listRules(kind: RuleKind, actor: any, filters: any = {}) {
    requireAnyRole(
      actor,
      kind === 'salesDeduction' || kind === 'agencyDeduction'
        ? WRITE_RULE_ROLES
        : READ_RULE_ROLES,
    );
    const config = RULE_CONFIG[kind];
    const rules = await this.delegate(config).findMany({
      where: config.buildWhere(filters),
      orderBy: config.orderBy,
      take: normalizeTake(filters.limit, 100),
    });
    return rules.map(config.toDto);
  }

  private async createRule(
    kind: RuleKind,
    actor: any,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, WRITE_RULE_ROLES);
    const config = RULE_CONFIG[kind];
    const data = await this.buildCreateRuleData(kind, actor, payload);

    const created = await this.delegate(config).create({
      data,
    });
    const dto = config.toDto(created);
    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: `${config.logPrefix}.create`,
      entityType: config.entityType,
      entityId: created.id,
      beforeData: null,
      afterData: dto,
      ipAddress: metadata.ipAddress || null,
    });
    if (kind === 'commission') {
      const recalculation = await this.triggerEmployeeCommissionRecalculation(
        actor,
        {
          source: `${config.logPrefix}.create`,
          rules: [created],
          ruleIds: [created.id],
        },
        metadata,
      );
      return {
        ...dto,
        recalculation,
      };
    }
    if (!isAgencyRuleKind(kind)) {
      return dto;
    }
    const recalculation = await this.triggerAgencyRecalculation(
      actor,
      {
        source: `${config.logPrefix}.create`,
        ruleKind: kind,
        rules: [created],
        ruleIds: [created.id],
      },
      metadata,
    );
    return {
      ...dto,
      recalculation,
    };
  }

  private async batchImportRules(
    kind: RuleKind,
    actor: any,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, WRITE_RULE_ROLES);
    const config = RULE_CONFIG[kind];
    const rows = normalizeBatchRows(payload);
    const results: any[] = [];
    const createdIds: string[] = [];
    const createdRules: any[] = [];

    for (let index = 0; index < rows.length; index += 1) {
      const rowNumber = index + 1;
      try {
        const data = await this.buildCreateRuleData(kind, actor, rows[index]);
        const created = await this.delegate(config).create({
          data,
        });
        const dto = config.toDto(created);
        createdIds.push(created.id);
        createdRules.push(created);
        results.push({
          index,
          rowNumber,
          success: true,
          rule: dto,
        });
      } catch (error) {
        results.push({
          index,
          rowNumber,
          success: false,
          error: toImportRowError(error),
        });
      }
    }

    const successCount = results.filter((item) => item.success).length;
    const failureCount = results.length - successCount;
    const summary = {
      totalCount: results.length,
      successCount,
      failureCount,
      createdIdsSample: createdIds.slice(0, 50),
      failureSamples: results
        .filter((item) => !item.success)
        .slice(0, 20)
        .map((item) => ({
          index: item.index,
          rowNumber: item.rowNumber,
          code: item.error.code,
          message: item.error.message,
        })),
      truncated: {
        createdIds: createdIds.length > 50,
        failures: failureCount > 20,
      },
    };

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: `${config.logPrefix}.batch_import`,
      entityType: config.entityType,
      entityId: null,
      beforeData: null,
      afterData: summary,
      ipAddress: metadata.ipAddress || null,
    });

    const recalculation = isAgencyRuleKind(kind)
      ? await this.triggerAgencyRecalculation(
          actor,
          {
            source: `${config.logPrefix}.batch_import`,
            ruleKind: kind,
            rules: createdRules,
            ruleIds: createdIds,
          },
          metadata,
        )
      : null;
    return {
      ...summary,
      results,
      ...(recalculation ? { recalculation } : {}),
    };
  }

  private async buildCreateRuleData(kind: RuleKind, actor: any, payload: any) {
    const config = RULE_CONFIG[kind];
    assertAllowedFields(payload, config.allowedFields);
    const data = config.buildData(payload, true, actor);
    await this.attachTrustedProductSnapshot(kind, data);
    assertFinalEffectiveDateRange(data);
    await this.assertAgencyRuleMatchable(kind, data);
    await this.assertAgencyExists(data);
    await this.assertNoOverlappingActiveRule(kind, data);
    return data;
  }

  private async updateRule(
    kind: RuleKind,
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, WRITE_RULE_ROLES);
    const config = RULE_CONFIG[kind];
    const ruleId = normalizeRequiredString(id, 'id');
    assertAllowedFields(payload, config.allowedFields);

    const current = await this.findRuleOrThrow(config, ruleId);
    const data = config.buildData(payload, false, actor);
    await this.attachTrustedProductSnapshot(kind, data, current);
    const nextForValidation = {
      ...current,
      ...data,
    };
    assertFinalEffectiveDateRange(nextForValidation);
    await this.assertAgencyRuleMatchable(kind, nextForValidation);
    await this.assertAgencyExists(nextForValidation);
    await this.assertNoOverlappingActiveRule(
      kind,
      nextForValidation,
      ruleId,
    );

    const updated = await this.delegate(config).update({
      where: {
        id: ruleId,
      },
      data,
    });
    const dto = config.toDto(updated);
    const updateAction = resolveRuleUpdateLogAction(config, current, updated);
    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: updateAction,
      entityType: config.entityType,
      entityId: updated.id,
      beforeData: config.toDto(current),
      afterData: dto,
      ipAddress: metadata.ipAddress || null,
    });
    if (kind === 'commission') {
      const recalculation = await this.triggerEmployeeCommissionRecalculation(
        actor,
        {
          source: updateAction,
          rules: [current, updated],
          ruleIds: [updated.id],
        },
        metadata,
      );
      return {
        ...dto,
        recalculation,
      };
    }
    if (!isAgencyRuleKind(kind)) {
      return dto;
    }
    const recalculation = await this.triggerAgencyRecalculation(
      actor,
      {
        source: updateAction,
        ruleKind: kind,
        rules: [current, updated],
        ruleIds: [updated.id],
      },
      metadata,
    );
    return {
      ...dto,
      recalculation,
    };
  }

  private async triggerAgencyRecalculation(
    actor: any,
    input: {
      source: string;
      ruleKind: 'agencyDeduction' | 'agencyRebate';
      rules: any[];
      ruleIds: string[];
    },
    metadata: any,
  ) {
    try {
      return await this.agencyRuleRecalculationService.recalculateForAgencyRuleChange(
        actor,
        input,
        metadata,
      );
    } catch {
      const warning = {
        code: 'agency_rule_recalculation_failed',
        message: '规则已保存，但自动重算失败，请在积分表中手工执行“重新计算”。',
      };
      await this.operationLogsService.appendLog({
        userId: actor.id,
        action: 'commission_records.agency_scope.recalculate_failed',
        entityType: 'agency_rule_recalculation',
        entityId: input.ruleIds[0] || null,
        beforeData: null,
        afterData: {
          triggerSource: input.source,
          ruleKind: input.ruleKind,
          ruleIds: input.ruleIds.slice(0, 50),
          orderCount: 0,
          travelGroupCount: 0,
          successCount: 0,
          skippedCount: 0,
          warningSummary: {
            count: 1,
            codes: { [warning.code]: 1 },
            messageSamples: [warning.message],
          },
        },
        ipAddress: metadata.ipAddress || null,
      });
      return {
        source: input.source,
        agencyOnly: true,
        ruleIds: input.ruleIds,
        orderCount: 0,
        travelGroupCount: 0,
        successCount: 0,
        failureCount: 1,
        skippedCount: 0,
        skippedConfirmedCount: 0,
        skippedManualOverrideCount: 0,
        generatedCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        generatedRecords: [],
        updatedRecords: [],
        unchangedRecords: [],
        travelGroupFinanceSummaries: [],
        warnings: [warning],
      };
    }
  }

  private async triggerEmployeeCommissionRecalculation(
    actor: any,
    input: {
      source: string;
      rules: any[];
      ruleIds: string[];
    },
    metadata: any,
  ) {
    try {
      return await this.employeeCommissionRuleRecalculationService.recalculateForCommissionRuleChange(
        actor,
        input,
        metadata,
      );
    } catch {
      const targetTypes = Array.from(
        new Set(
          input.rules
            .map(
              (rule) =>
                COMMISSION_TARGET_TYPE_TO_PRISMA[
                  normalizeOptionalString(rule?.targetType) || ''
                ],
            )
            .filter(Boolean),
        ),
      );
      const warning = {
        code: 'employee_commission_rule_recalculation_failed',
        message:
          '提成规则已保存，但员工提成自动重算失败；请稍后重试重算并核对利润分析。',
      };
      await this.operationLogsService.appendLog({
        userId: actor.id,
        action: 'commission_records.employee_scope.recalculate_failed',
        entityType: 'employee_commission_rule_recalculation',
        entityId: input.ruleIds[0] || null,
        beforeData: null,
        afterData: {
          triggerSource: input.source,
          ruleIds: input.ruleIds.slice(0, 50),
          targetTypes,
          orderRange: summarizeCommissionRuleRanges(input.rules),
          orderCount: 0,
          successCount: 0,
          failureCount: 1,
          skippedCount: 0,
          generatedCount: 0,
          updatedCount: 0,
          unchangedCount: 0,
          warningSummary: {
            count: 1,
            codes: { [warning.code]: 1 },
            messageSamples: [warning.message],
            truncated: false,
          },
        },
        ipAddress: metadata.ipAddress || null,
      });
      return {
        source: input.source,
        ruleIds: input.ruleIds,
        targetTypes,
        orderCount: 0,
        successCount: 0,
        failureCount: 1,
        skippedCount: 0,
        generatedCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        generatedRecords: [],
        updatedRecords: [],
        unchangedRecords: [],
        orderRange: summarizeCommissionRuleRanges(input.rules),
        warnings: [warning],
      };
    }
  }

  private delegate(config: any) {
    return (this.prisma as any)[config.delegate];
  }

  private async findRuleOrThrow(config: any, id: string) {
    const rule = await this.delegate(config).findUnique({
      where: {
        id,
      },
    });
    if (!rule) {
      throw createHttpError(
        404,
        config.notFoundCode,
        'Rule does not exist.',
      );
    }
    return rule;
  }

  private async assertNoOverlappingActiveRule(
    kind: RuleKind,
    candidate: any,
    excludeId?: string,
  ) {
    if (!candidate.isActive) {
      return;
    }
    const config = RULE_CONFIG[kind];
    const rules = await this.delegate(config).findMany({
      where: {
        isActive: true,
      },
    });
    const overlappingRule = rules.find((rule: any) => {
      if (excludeId && rule.id === excludeId) {
        return false;
      }
      if (!rulesShareDimension(kind, candidate, rule, config)) {
        return false;
      }
      return intervalsOverlap(candidate, rule);
    });

    if (overlappingRule) {
      throw createHttpError(
        400,
        config.overlapCode,
        'Enabled rules in the same dimension cannot have overlapping effective date ranges.',
      );
    }
  }

  private async assertAgencyRuleMatchable(kind: RuleKind, rule: any) {
    if (kind !== 'agencyDeduction' && kind !== 'agencyRebate') {
      return;
    }
    if (!normalizeOptionalString(rule.agencyId) && !normalizeOptionalString(rule.agencyName)) {
      throw createHttpError(
        400,
        'VALIDATION_FAILED',
        'agencyId or agencyName is required.',
      );
    }
  }

  private async assertAgencyExists(rule: any) {
    const agencyId = normalizeOptionalString(rule.agencyId);
    if (!agencyId) {
      return;
    }
    const agency = await this.prisma.travelAgency.findUnique({
      where: {
        id: agencyId,
      },
    });
    if (!agency) {
      throw createHttpError(
        400,
        'VALIDATION_FAILED',
        'agencyId does not match an existing travel agency.',
      );
    }
  }

  private async attachTrustedProductSnapshot(
    kind: RuleKind,
    data: any,
    current?: any,
  ) {
    if (kind !== 'salesDeduction' && kind !== 'agencyDeduction') {
      return;
    }

    if (kind === 'agencyDeduction') {
      const nextMode = normalizeAgencyDeductionCalculationMode(
        data.calculationMode ?? current?.calculationMode,
        AGENCY_DEDUCTION_MODE_MANUAL_PRODUCT_REFERENCE,
      );
      if (nextMode === AGENCY_DEDUCTION_MODE_EFFECTIVE_SALES_RATE) {
        data.calculationMode = nextMode;
        data.productId = null;
        data.productName = '';
        data.deductionCostCents = 0;
        if (data.deductionRate === undefined) {
          data.deductionRate = DEFAULT_AGENCY_DEDUCTION_RATE;
        }
        return;
      }
    }

    const productId =
      kind === 'agencyDeduction'
        ? normalizeOptionalString(data.productId) ||
          normalizeOptionalString(current?.productId)
        : normalizeRequiredString(data.productId, 'productId');
    if (!productId) {
      throw createHttpError(
        400,
        'VALIDATION_FAILED',
        'productId is required.',
      );
    }

    if (kind === 'agencyDeduction' && data.productId === undefined && current) {
      return;
    }

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) {
      throw createHttpError(404, 'PRODUCT_NOT_FOUND', 'Product does not exist.');
    }
    const matchesExistingProduct = current
      ? normalizeOptionalString(current.productId) === productId ||
        (!normalizeOptionalString(current.productId) &&
          normalizeProductComparable(current.productName) ===
            normalizeProductComparable(product.name))
      : false;
    if (!product.isActive && !matchesExistingProduct) {
      throw createHttpError(
        400,
        'PRODUCT_INACTIVE',
        'Inactive products cannot be used to create or retarget deduction rules.',
      );
    }
    data.productId = product.id;
    data.productName = product.name;
  }
}

function normalizeBatchRows(payload: any) {
  const rows = Array.isArray(payload) ? payload : payload?.rules;
  if (!Array.isArray(rows)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'rules must be an array.',
    );
  }
  if (rows.length < 1) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'rules must contain at least one row.',
    );
  }
  if (rows.length > 500) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'rules cannot contain more than 500 rows.',
    );
  }
  return rows;
}

function toImportRowError(error: any) {
  return {
    code: error?.code || 'IMPORT_ROW_FAILED',
    message:
      typeof error?.message === 'string' && error.message
        ? error.message
        : 'Import row failed.',
  };
}

function buildCommissionRuleWhere(filters: any = {}) {
  const where: any = {};
  const targetType = normalizeOptionalString(filters.targetType);
  if (targetType) {
    where.targetType = normalizeCommissionRuleTargetType(targetType);
  }
  assignBooleanFilter(where, filters, 'isActive');
  const keyword = normalizeOptionalString(
    filters.keyword || filters.query || filters.search,
  );
  if (keyword) {
    where.OR = [
      { ruleName: { contains: keyword } },
      { notes: { contains: keyword } },
    ];
  }
  return where;
}

function buildSalesDeductionRuleWhere(filters: any = {}) {
  const where: any = {};
  const productId = normalizeOptionalString(filters.productId);
  if (productId) {
    where.productId = productId;
  }
  const productName = normalizeOptionalString(filters.productName);
  if (productName) {
    where.productName = {
      contains: productName,
    };
  }
  assignBooleanFilter(where, filters, 'isActive');
  return withKeywordWhere(where, filters, ['productName', 'notes']);
}

function buildAgencyDeductionRuleWhere(filters: any = {}) {
  const where: any = {};
  const agencyId = normalizeOptionalString(filters.agencyId);
  if (agencyId) {
    where.agencyId = agencyId;
  }
  const agencyName = normalizeOptionalString(filters.agencyName);
  if (agencyName) {
    where.agencyName = {
      contains: agencyName,
    };
  }
  const calculationMode = normalizeOptionalString(filters.calculationMode);
  if (calculationMode) {
    where.calculationMode =
      normalizeAgencyDeductionCalculationMode(calculationMode);
  }
  const productId = normalizeOptionalString(filters.productId);
  if (productId) {
    where.productId = productId;
  }
  const productName = normalizeOptionalString(filters.productName);
  if (productName) {
    where.productName = {
      contains: productName,
    };
  }
  assignBooleanFilter(where, filters, 'isActive');
  return withKeywordWhere(where, filters, [
    'agencyName',
    'productName',
    'notes',
  ]);
}

function buildAgencyRebateRuleWhere(filters: any = {}) {
  const where: any = {};
  const agencyId = normalizeOptionalString(filters.agencyId);
  if (agencyId) {
    where.agencyId = agencyId;
  }
  const agencyName = normalizeOptionalString(filters.agencyName);
  if (agencyName) {
    where.agencyName = {
      contains: agencyName,
    };
  }
  assignBooleanFilter(where, filters, 'isActive');
  return withKeywordWhere(where, filters, ['agencyName', 'notes']);
}

function buildCommissionRuleData(payload: any, creating: boolean, actor: any) {
  const now = new Date();
  const data: any = {
    updatedAt: now,
    updatedById: actor.id,
  };
  assignString(data, 'ruleName', payload?.ruleName, {
    fieldName: 'ruleName',
    maxLength: 120,
    required: creating,
  });
  if (payload?.targetType !== undefined || creating) {
    data.targetType = normalizeCommissionRuleTargetType(payload?.targetType);
  }
  assignDecimal(data, 'rate', payload?.rate, {
    fieldName: 'rate',
    required: creating,
  });
  assignDate(data, 'effectiveFrom', payload?.effectiveFrom, {
    fieldName: 'effectiveFrom',
    required: creating,
  });
  assignDate(data, 'effectiveTo', payload?.effectiveTo, {
    fieldName: 'effectiveTo',
    nullable: true,
  });
  assignBoolean(data, 'isActive', payload?.isActive, creating ? true : undefined);
  assignNullableText(data, 'notes', payload?.notes);
  assertEffectiveDateRange(data, payload, creating);

  if (creating) {
    data.id = crypto.randomUUID();
    data.createdAt = now;
    data.createdById = actor.id;
    data.isActive = data.isActive ?? true;
  }
  return data;
}

function buildSalesDeductionRuleData(
  payload: any,
  creating: boolean,
  actor: any,
) {
  const now = new Date();
  const data: any = {
    updatedAt: now,
    updatedById: actor.id,
  };
  assignString(data, 'productId', payload?.productId, {
    fieldName: 'productId',
    maxLength: 36,
    required: true,
  });
  assignNonNegativeInteger(
    data,
    'deductionCostCents',
    payload?.deductionCostCents,
    {
      fieldName: 'deductionCostCents',
      required: creating,
    },
  );
  assignDate(data, 'effectiveFrom', payload?.effectiveFrom, {
    fieldName: 'effectiveFrom',
    required: creating,
  });
  assignDate(data, 'effectiveTo', payload?.effectiveTo, {
    fieldName: 'effectiveTo',
    nullable: true,
  });
  assignBoolean(data, 'isActive', payload?.isActive, creating ? true : undefined);
  assignNullableText(data, 'notes', payload?.notes);
  assertEffectiveDateRange(data, payload, creating);

  if (creating) {
    data.id = crypto.randomUUID();
    data.createdAt = now;
    data.createdById = actor.id;
    data.isActive = data.isActive ?? true;
  }
  return data;
}

function buildAgencyDeductionRuleData(
  payload: any,
  creating: boolean,
  actor: any,
) {
  const now = new Date();
  const data: any = {
    updatedAt: now,
    updatedById: actor.id,
  };
  assignNullableString(data, 'agencyId', payload?.agencyId, 'agencyId', 36);
  assignNullableString(
    data,
    'agencyName',
    payload?.agencyName,
    'agencyName',
    120,
  );
  if (payload?.calculationMode !== undefined || creating) {
    data.calculationMode = normalizeAgencyDeductionCalculationMode(
      payload?.calculationMode,
      AGENCY_DEDUCTION_MODE_MANUAL_PRODUCT_REFERENCE,
    );
  }
  assignDecimal(data, 'deductionRate', payload?.deductionRate, {
    fieldName: 'deductionRate',
  });
  if (creating && data.deductionRate === undefined) {
    data.deductionRate = DEFAULT_AGENCY_DEDUCTION_RATE;
  }

  if (data.calculationMode === AGENCY_DEDUCTION_MODE_EFFECTIVE_SALES_RATE) {
    data.productId = null;
    data.productName = '';
    data.deductionCostCents = 0;
  } else {
    assignString(data, 'productId', payload?.productId, {
      fieldName: 'productId',
      maxLength: 36,
      required: creating,
    });
    assignNonNegativeInteger(
      data,
      'deductionCostCents',
      payload?.deductionCostCents,
      {
        fieldName: 'deductionCostCents',
        required: creating,
      },
    );
  }

  assignDate(data, 'effectiveFrom', payload?.effectiveFrom, {
    fieldName: 'effectiveFrom',
    required: creating,
  });
  assignDate(data, 'effectiveTo', payload?.effectiveTo, {
    fieldName: 'effectiveTo',
    nullable: true,
  });
  assignBoolean(data, 'isActive', payload?.isActive, creating ? true : undefined);
  assignNullableText(data, 'notes', payload?.notes);
  assertEffectiveDateRange(data, payload, creating);

  if (creating) {
    data.id = crypto.randomUUID();
    data.createdAt = now;
    data.createdById = actor.id;
    data.isActive = data.isActive ?? true;
  }
  return data;
}

function buildAgencyRebateRuleData(payload: any, creating: boolean, actor: any) {
  const now = new Date();
  const data: any = {
    updatedAt: now,
    updatedById: actor.id,
  };
  assignNullableString(data, 'agencyId', payload?.agencyId, 'agencyId', 36);
  assignNullableString(
    data,
    'agencyName',
    payload?.agencyName,
    'agencyName',
    120,
  );
  assignDecimal(data, 'dailyRebateRate', payload?.dailyRebateRate, {
    fieldName: 'dailyRebateRate',
    required: creating,
  });
  assignDecimal(data, 'monthlyRebateRate', payload?.monthlyRebateRate, {
    fieldName: 'monthlyRebateRate',
    required: creating,
  });
  assignDecimal(data, 'totalRebateRate', payload?.totalRebateRate, {
    fieldName: 'totalRebateRate',
    nullable: true,
  });
  assignDate(data, 'effectiveFrom', payload?.effectiveFrom, {
    fieldName: 'effectiveFrom',
    required: creating,
  });
  assignDate(data, 'effectiveTo', payload?.effectiveTo, {
    fieldName: 'effectiveTo',
    nullable: true,
  });
  assignBoolean(data, 'isActive', payload?.isActive, creating ? true : undefined);
  assignNullableText(data, 'notes', payload?.notes);
  assertEffectiveDateRange(data, payload, creating);

  if (creating) {
    data.id = crypto.randomUUID();
    data.createdAt = now;
    data.createdById = actor.id;
    data.isActive = data.isActive ?? true;
  }
  return data;
}

function toCommissionRuleDto(rule: any) {
  return {
    id: rule.id,
    ruleName: rule.ruleName,
    targetType:
      COMMISSION_TARGET_TYPE_FROM_PRISMA[rule.targetType] || rule.targetType,
    rate: decimalToFixed(rule.rate),
    effectiveFrom: toDateOnly(rule.effectiveFrom),
    effectiveTo: toDateOnly(rule.effectiveTo),
    isActive: Boolean(rule.isActive),
    notes: rule.notes || null,
    createdById: rule.createdById || null,
    updatedById: rule.updatedById || null,
    createdAt: toIsoString(rule.createdAt),
    updatedAt: toIsoString(rule.updatedAt),
  };
}

function toSalesDeductionRuleDto(rule: any) {
  return {
    id: rule.id,
    productId: rule.productId || null,
    productName: rule.productName,
    deductionCostCents: Number(rule.deductionCostCents || 0),
    effectiveFrom: toDateOnly(rule.effectiveFrom),
    effectiveTo: toDateOnly(rule.effectiveTo),
    isActive: Boolean(rule.isActive),
    notes: rule.notes || null,
    createdById: rule.createdById || null,
    updatedById: rule.updatedById || null,
    createdAt: toIsoString(rule.createdAt),
    updatedAt: toIsoString(rule.updatedAt),
  };
}

function toAgencyDeductionRuleDto(rule: any) {
  return {
    id: rule.id,
    agencyId: rule.agencyId || null,
    agencyName: rule.agencyName || null,
    calculationMode: normalizeAgencyDeductionCalculationMode(
      rule.calculationMode,
      AGENCY_DEDUCTION_MODE_MANUAL_PRODUCT_REFERENCE,
    ),
    deductionRate: decimalToFixed(
      rule.deductionRate ?? DEFAULT_AGENCY_DEDUCTION_RATE,
    ),
    productId: rule.productId || null,
    productName: rule.productName || '',
    deductionCostCents: Number(rule.deductionCostCents || 0),
    effectiveFrom: toDateOnly(rule.effectiveFrom),
    effectiveTo: toDateOnly(rule.effectiveTo),
    isActive: Boolean(rule.isActive),
    notes: rule.notes || null,
    createdById: rule.createdById || null,
    updatedById: rule.updatedById || null,
    createdAt: toIsoString(rule.createdAt),
    updatedAt: toIsoString(rule.updatedAt),
  };
}

function toAgencyRebateRuleDto(rule: any) {
  return {
    id: rule.id,
    agencyId: rule.agencyId || null,
    agencyName: rule.agencyName || null,
    dailyRebateRate: decimalToFixed(rule.dailyRebateRate),
    monthlyRebateRate: decimalToFixed(rule.monthlyRebateRate),
    totalRebateRate:
      rule.totalRebateRate === null || rule.totalRebateRate === undefined
        ? null
        : decimalToFixed(rule.totalRebateRate),
    effectiveFrom: toDateOnly(rule.effectiveFrom),
    effectiveTo: toDateOnly(rule.effectiveTo),
    isActive: Boolean(rule.isActive),
    notes: rule.notes || null,
    createdById: rule.createdById || null,
    updatedById: rule.updatedById || null,
    createdAt: toIsoString(rule.createdAt),
    updatedAt: toIsoString(rule.updatedAt),
  };
}

function resolveRuleUpdateLogAction(config: any, current: any, updated: any) {
  if (Boolean(current?.isActive) && !Boolean(updated?.isActive)) {
    return `${config.logPrefix}.disable`;
  }
  return `${config.logPrefix}.update`;
}

function buildAgencyDimensionKeys(rule: any, suffix?: string) {
  const keys: string[] = [];
  const tail = suffix ? `|${suffix}` : '';
  if (normalizeOptionalString(rule.agencyId)) {
    keys.push(`agency_id:${normalizeOptionalString(rule.agencyId)}${tail}`);
  }
  if (normalizeOptionalString(rule.agencyName)) {
    keys.push(`agency_name:${normalizeComparable(rule.agencyName)}${tail}`);
  }
  return keys;
}

function buildProductDimensionKeys(rule: any) {
  const productId = normalizeOptionalString(rule.productId);
  if (productId) {
    return [`product_id:${productId}`];
  }
  const productName = normalizeProductComparable(rule.productName);
  return productName ? [`product_name:${productName}`] : [];
}

function buildAgencyProductDimensionKeys(rule: any) {
  const productKeys = buildProductDimensionKeys(rule);
  return productKeys.flatMap((productKey) =>
    buildAgencyDimensionKeys(rule, productKey),
  );
}

function buildAgencyDeductionDimensionKeys(rule: any) {
  const mode = normalizeAgencyDeductionCalculationMode(
    rule.calculationMode,
    AGENCY_DEDUCTION_MODE_MANUAL_PRODUCT_REFERENCE,
  );
  if (mode === AGENCY_DEDUCTION_MODE_EFFECTIVE_SALES_RATE) {
    return buildAgencyDimensionKeys(rule, `mode:${mode}`);
  }
  const productKeys = buildProductDimensionKeys(rule);
  return productKeys.flatMap((productKey) =>
    buildAgencyDimensionKeys(rule, `mode:${mode}|${productKey}`),
  );
}

function rulesShareDimension(
  kind: RuleKind,
  left: any,
  right: any,
  config: any,
) {
  if (kind === 'salesDeduction') {
    return referencesMatch(
      left.productId,
      right.productId,
      left.productName,
      right.productName,
      normalizeProductComparable,
    );
  }
  if (kind === 'agencyDeduction') {
    const leftMode = normalizeAgencyDeductionCalculationMode(
      left.calculationMode,
      AGENCY_DEDUCTION_MODE_MANUAL_PRODUCT_REFERENCE,
    );
    const rightMode = normalizeAgencyDeductionCalculationMode(
      right.calculationMode,
      AGENCY_DEDUCTION_MODE_MANUAL_PRODUCT_REFERENCE,
    );
    if (leftMode !== rightMode) {
      return false;
    }
    const sameAgency = referencesMatch(
      left.agencyId,
      right.agencyId,
      left.agencyName,
      right.agencyName,
    );
    if (leftMode === AGENCY_DEDUCTION_MODE_EFFECTIVE_SALES_RATE) {
      return sameAgency;
    }
    return (
      sameAgency &&
      referencesMatch(
        left.productId,
        right.productId,
        left.productName,
        right.productName,
        normalizeProductComparable,
      )
    );
  }
  const leftKeys = new Set(config.dimensionKeys(left));
  return config
    .dimensionKeys(right)
    .some((key: string) => leftKeys.has(key));
}

function referencesMatch(
  leftId: unknown,
  rightId: unknown,
  leftName: unknown,
  rightName: unknown,
  normalizeName: (value: unknown) => string = normalizeComparable,
) {
  const normalizedLeftId = normalizeOptionalString(leftId);
  const normalizedRightId = normalizeOptionalString(rightId);
  if (normalizedLeftId && normalizedRightId) {
    return normalizedLeftId === normalizedRightId;
  }
  const normalizedLeftName = normalizeName(leftName);
  const normalizedRightName = normalizeName(rightName);
  return Boolean(
    normalizedLeftName && normalizedLeftName === normalizedRightName,
  );
}

function intervalsOverlap(left: any, right: any) {
  const leftStart = normalizeDateForCompare(left.effectiveFrom);
  const leftEnd = left.effectiveTo
    ? normalizeDateForCompare(left.effectiveTo)
    : MAX_OPEN_ENDED_DATE;
  const rightStart = normalizeDateForCompare(right.effectiveFrom);
  const rightEnd = right.effectiveTo
    ? normalizeDateForCompare(right.effectiveTo)
    : MAX_OPEN_ENDED_DATE;
  return leftStart.getTime() <= rightEnd.getTime() && rightStart.getTime() <= leftEnd.getTime();
}

function assertEffectiveDateRange(data: any, payload: any, creating: boolean) {
  if (!creating && payload?.effectiveFrom === undefined && payload?.effectiveTo === undefined) {
    return;
  }
  if (data.effectiveFrom && data.effectiveTo && data.effectiveTo < data.effectiveFrom) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'effectiveTo cannot be earlier than effectiveFrom.',
    );
  }
}

function assertFinalEffectiveDateRange(rule: any) {
  if (rule.effectiveFrom && rule.effectiveTo && rule.effectiveTo < rule.effectiveFrom) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'effectiveTo cannot be earlier than effectiveFrom.',
    );
  }
}

function assertAllowedFields(payload: any, allowedFields: string[]) {
  const keys = Object.keys(payload || {});
  const allowed = new Set(allowedFields);
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `Unsupported field: ${unknown[0]}.`,
    );
  }
}

function assignString(data: any, key: string, value: unknown, options: any) {
  if (value === undefined && !options.required) {
    return;
  }
  const text = normalizeRequiredString(value, options.fieldName);
  if (text.length > options.maxLength) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${options.fieldName} must be ${options.maxLength} characters or fewer.`,
    );
  }
  data[key] = text;
}

function assignNullableString(
  data: any,
  key: string,
  value: unknown,
  fieldName: string,
  maxLength: number,
) {
  if (value === undefined) {
    return;
  }
  const text = normalizeOptionalString(value);
  if (text && text.length > maxLength) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be ${maxLength} characters or fewer.`,
    );
  }
  data[key] = text;
}

function assignNullableText(data: any, key: string, value: unknown) {
  if (value !== undefined) {
    data[key] = normalizeOptionalString(value);
  }
}

function assignNonNegativeInteger(
  data: any,
  key: string,
  value: unknown,
  options: any,
) {
  if (value === undefined && !options.required) {
    return;
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || !Number.isInteger(numberValue)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${options.fieldName} must be an integer.`,
    );
  }
  if (numberValue < 0) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${options.fieldName} cannot be negative.`,
    );
  }
  data[key] = numberValue;
}

function assignDecimal(data: any, key: string, value: unknown, options: any) {
  if (value === undefined && !options.required) {
    return;
  }
  if ((value === null || value === '') && options.nullable) {
    data[key] = null;
    return;
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${options.fieldName} must be a number.`,
    );
  }
  if (numberValue < 0) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${options.fieldName} cannot be negative.`,
    );
  }
  data[key] = numberValue.toFixed(4);
}

function assignDate(data: any, key: string, value: unknown, options: any) {
  if (value === undefined && !options.required) {
    return;
  }
  if ((value === null || value === '') && options.nullable) {
    data[key] = null;
    return;
  }
  data[key] = normalizeDateOnly(value, options.fieldName);
}

function assignBoolean(
  data: any,
  key: string,
  value: unknown,
  defaultValue?: boolean,
) {
  if (value === undefined) {
    if (defaultValue !== undefined) {
      data[key] = defaultValue;
    }
    return;
  }
  data[key] = normalizeBoolean(value, key);
}

function assignBooleanFilter(where: any, filters: any, key: string) {
  if (filters[key] !== undefined && filters[key] !== '') {
    where[key] = normalizeBoolean(filters[key], key);
  }
}

function withKeywordWhere(where: any, filters: any, fields: string[]) {
  const keyword = normalizeOptionalString(
    filters.keyword || filters.query || filters.search,
  );
  if (!keyword) {
    return where;
  }
  return {
    ...where,
    OR: fields.map((field) => ({
      [field]: {
        contains: keyword,
      },
    })),
  };
}

function normalizeCommissionRuleTargetType(value: unknown) {
  const text = normalizeRequiredString(value, 'targetType');
  const targetType = COMMISSION_TARGET_TYPE_TO_PRISMA[text];
  if (!targetType) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'targetType is invalid.',
    );
  }
  return targetType;
}

function normalizeAgencyDeductionCalculationMode(
  value: unknown,
  fallback?: string,
) {
  const text = normalizeOptionalString(value);
  if (!text) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'calculationMode is invalid.',
    );
  }
  if (
    text === AGENCY_DEDUCTION_MODE_EFFECTIVE_SALES_RATE ||
    text === AGENCY_DEDUCTION_MODE_MANUAL_PRODUCT_REFERENCE
  ) {
    return text;
  }
  throw createHttpError(
    400,
    'VALIDATION_FAILED',
    'calculationMode is invalid.',
  );
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
  return String(normalizeOptionalString(value) || '').toLowerCase();
}

function normalizeProductComparable(value: unknown) {
  return String(normalizeOptionalString(value) || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function normalizeBoolean(value: unknown, fieldName: string) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true' || value === '1' || value === 1) {
    return true;
  }
  if (value === 'false' || value === '0' || value === 0) {
    return false;
  }
  throw createHttpError(
    400,
    'VALIDATION_FAILED',
    `${fieldName} must be a boolean.`,
  );
}

function normalizeDateOnly(value: unknown, fieldName: string) {
  const text = normalizeRequiredString(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be YYYY-MM-DD.`,
    );
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be a valid date.`,
    );
  }
  return date;
}

function normalizeDateForCompare(value: unknown) {
  if (value instanceof Date) {
    return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
  }
  return normalizeDateOnly(
    String(value).slice(0, 10),
    'effective date',
  );
}

function normalizeTake(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw createHttpError(400, 'VALIDATION_FAILED', 'limit must be a number.');
  }
  return Math.min(Math.max(Math.trunc(numberValue), 1), 200);
}

function decimalToFixed(value: unknown) {
  const numberValue = Number(
    value && typeof value === 'object' && 'toString' in value
      ? (value as any).toString()
      : value,
  );
  return Number.isFinite(numberValue) ? numberValue.toFixed(4) : '0.0000';
}

function toDateOnly(value: unknown) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
}

function summarizeCommissionRuleRanges(rules: any[]) {
  return (rules || []).filter(Boolean).map((rule) => ({
    targetType:
      COMMISSION_TARGET_TYPE_TO_PRISMA[
        normalizeOptionalString(rule.targetType) || ''
      ] || null,
    dateFrom: rule.effectiveFrom ? toDateOnly(rule.effectiveFrom) : null,
    dateTo: rule.effectiveTo ? toDateOnly(rule.effectiveTo) : null,
  }));
}

function toIsoString(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value ? String(value) : null;
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
      'You do not have permission to perform this action.',
    );
  }
}
