import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildGlobalSalesOrderMarkScope as buildSharedGlobalSalesOrderMarkScope,
  buildGlobalTravelGroupMarkScope as buildSharedGlobalTravelGroupMarkScope,
} from '../analytics/analytics-scope.helper';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import { SettingsNestService } from '../settings/settings.nest.service';
import { calculateStage7CommissionAndPoints } from './commission-calculation.helper';

const AUTO_TARGET_TYPES = [
  'SALES_COMMISSION',
  'OUTREACH_COMMISSION',
  'LEADER_COMMISSION',
  'AGENCY_DAILY_REBATE',
  'AGENCY_MONTHLY_REBATE',
];
const WRITE_COMMISSION_ROLES = ['admin', 'finance'];
const READ_ALL_COMMISSION_ROLES = ['admin', 'finance', 'boss'];
const TASTER_COMMISSION_TARGET_TYPE = 'TASTER_COMMISSION';
const ORDER_MANUAL_COMMISSION_TARGET_TYPE = 'ORDER_MANUAL_COMMISSION';
const COMMISSION_RECORD_EXPORT_MAX_ROWS = 5000;
const COMMISSION_TARGET_TYPES = [
  ...AUTO_TARGET_TYPES,
  TASTER_COMMISSION_TARGET_TYPE,
  ORDER_MANUAL_COMMISSION_TARGET_TYPE,
];
const MANUAL_TASTER_RULE_SNAPSHOT = {
  targetType: TASTER_COMMISSION_TARGET_TYPE,
  manualInput: true,
  ruleSource: 'finance_manual_input',
};

@Injectable()
export class CommissionRecordsNestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsNestService,
    private readonly settingsService: SettingsNestService,
  ) {}

  async listCommissionRecords(actor: any, filters: any = {}) {
    requireAnyRole(actor, READ_ALL_COMMISSION_ROLES);
    const where = await this.buildCommissionRecordQueryWhere(filters);
    const records = await this.prisma.commissionRecord.findMany({
      where,
      include: getCommissionRecordListInclude(),
      orderBy: {
        createdAt: 'desc',
      },
      take: normalizeTake(filters?.limit),
    });
    return records.map(toCommissionRecordListDto);
  }

  async getCommissionRecord(actor: any, id: string) {
    requireAnyRole(actor, READ_ALL_COMMISSION_ROLES);
    const recordId = normalizeRequiredString(id, 'id');
    const where = await this.buildCommissionRecordQueryWhere({
      id: recordId,
    });
    const record = await this.prisma.commissionRecord.findFirst({
      where,
      include: getCommissionRecordDetailInclude(),
    });
    if (!record) {
      throw createHttpError(
        404,
        'COMMISSION_RECORD_NOT_FOUND',
        'Commission record does not exist.',
      );
    }
    return toCommissionRecordDetailDto(record);
  }

  async exportCommissionRecordsXlsx(
    actor: any,
    filters: any = {},
    metadata: any = {},
  ) {
    requireAnyRole(actor, READ_ALL_COMMISSION_ROLES);
    const exportLimit = normalizeExportLimit(
      filters?.limit,
      COMMISSION_RECORD_EXPORT_MAX_ROWS,
    );
    const records = await this.prisma.commissionRecord.findMany({
      where: await this.buildCommissionRecordQueryWhere(filters),
      include: getCommissionRecordExportInclude(),
      orderBy: {
        createdAt: 'desc',
      },
      take: exportLimit + 1,
    });
    if (records.length > exportLimit) {
      throw createHttpError(
        400,
        'EXPORT_LIMIT_EXCEEDED',
        `Commission record export exceeds ${exportLimit} rows. Please narrow filters.`,
      );
    }

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'commission_records.export',
      entityType: 'commission_record',
      entityId: 'commission_records.export',
      beforeData: null,
      afterData: {
        filters: summarizeExportFilters(filters),
        rowCount: records.length,
      },
      ipAddress: metadata.ipAddress || null,
    });

    const workbook = buildCommissionRecordsExportWorkbook(records);
    const xlsxData = await workbook.xlsx.writeBuffer();
    return {
      fileName: buildCommissionRecordsExportFileName(),
      buffer: Buffer.from(xlsxData as any),
      rowCount: records.length,
    };
  }

  async listMyTasterCommissionRecords(actor: any, filters: any = {}) {
    requireAnyRole(actor, ['taster']);
    const where = await this.buildCommissionRecordQueryWhere({
      ...filters,
      targetType: TASTER_COMMISSION_TARGET_TYPE,
      targetUserId: actor.id,
    });
    const records = await this.prisma.commissionRecord.findMany({
      where,
      include: getCommissionRecordListInclude(),
      orderBy: {
        createdAt: 'desc',
      },
      take: normalizeTake(filters?.limit),
    });
    return records.map(toCommissionRecordListDto);
  }

  async preflightEmployeeCommissionAssignments(actor: any, filters: any = {}) {
    requireAnyRole(actor, ['admin']);
    const [orders, rules] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where: {
          orderType: { not: 'BUYBACK' },
          status: { in: ['VALID', 'PARTIAL_REFUND'] },
          OR: [
            { workflowStatus: null },
            { workflowStatus: { in: ['APPROVED', 'COMPLETED'] } },
          ],
        },
        select: {
          id: true,
          orderNo: true,
          orderDate: true,
          salesUserId: true,
          outreachUserId: true,
          salesUser: { select: { leaderId: true } },
        },
        orderBy: [{ orderDate: 'asc' }, { orderNo: 'asc' }],
      }),
      this.prisma.commissionRule.findMany({
        where: { isActive: true },
        select: {
          targetType: true,
          effectiveFrom: true,
          effectiveTo: true,
        },
      }),
    ]);
    const problems = orders
      .map((order: any) => {
        const activeTargets = activeEmployeeRuleTargetsForDate(
          rules,
          order.orderDate,
        );
        return {
          salesOrderId: order.id,
          orderNo: order.orderNo,
          orderDate: toDateOnly(order.orderDate),
          missingSalesUser: !order.salesUserId,
          missingOutreachUser:
            activeTargets.has('OUTREACH_COMMISSION') &&
            !order.outreachUserId,
          missingLeader:
            activeTargets.has('LEADER_COMMISSION') &&
            Boolean(order.salesUserId) &&
            !order.salesUser?.leaderId,
        };
      })
      .filter(
        (row: any) =>
          row.missingSalesUser ||
          row.missingOutreachUser ||
          row.missingLeader,
      );
    const sampleLimit = Math.min(
      200,
      Math.max(1, Number(filters?.limit || 50)),
    );
    return {
      readOnly: true,
      orderCount: orders.length,
      affectedOrderCount: problems.length,
      missingSalesUserCount: problems.filter(
        (row: any) => row.missingSalesUser,
      ).length,
      missingOutreachUserCount: problems.filter(
        (row: any) => row.missingOutreachUser,
      ).length,
      missingLeaderCount: problems.filter((row: any) => row.missingLeader)
        .length,
      orders: problems.slice(0, sampleLimit),
      truncated: problems.length > sampleLimit,
    };
  }

  async repairEmployeeCommissionAssignments(
    actor: any,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin']);
    const assignments = Array.isArray(payload?.assignments)
      ? payload.assignments
      : null;
    if (!assignments || assignments.length === 0 || assignments.length > 200) {
      throw createHttpError(
        400,
        'VALIDATION_FAILED',
        'assignments must contain between 1 and 200 explicit assignments.',
      );
    }
    const results: any[] = [];
    for (const assignment of assignments) {
      const salesOrderId = normalizeRequiredString(
        assignment?.salesOrderId,
        'salesOrderId',
      );
      try {
        const result = await this.prisma.$transaction(async (tx: any) => {
          const current = await tx.salesOrder.findUnique({
            where: { id: salesOrderId },
            select: {
              id: true,
              orderNo: true,
              orderDate: true,
              orderType: true,
              workflowStatus: true,
              salesUserId: true,
              outreachUserId: true,
            },
          });
          if (!current) {
            throw createHttpError(
              404,
              'SALES_ORDER_NOT_FOUND',
              'Sales order does not exist.',
            );
          }
          if (!isCommissionEligibleSalesOrder(current)) {
            throw createHttpError(
              400,
              'SALES_ORDER_NOT_COMMISSION_ELIGIBLE',
              'Only commission-eligible non-buyback orders can have employee commission assignments repaired.',
            );
          }
          const salesUserId = normalizeRequiredString(
            assignment?.salesUserId,
            'salesUserId',
          );
          if (!Object.prototype.hasOwnProperty.call(assignment, 'outreachUserId')) {
            throw createHttpError(
              400,
              'VALIDATION_FAILED',
              'outreachUserId must be supplied explicitly; use null only when no outreach rule applies.',
            );
          }
          const outreachUserId = normalizeOptionalString(
            assignment?.outreachUserId,
          );
          const salesUser = await findActiveSalesAssignee(
            tx,
            salesUserId,
            'salesUserId',
          );
          if (outreachUserId) {
            await findActiveSalesAssignee(
              tx,
              outreachUserId,
              'outreachUserId',
            );
          }
          const rules = await tx.commissionRule.findMany({
            where: { isActive: true },
            select: {
              targetType: true,
              effectiveFrom: true,
              effectiveTo: true,
            },
          });
          const activeTargets = activeEmployeeRuleTargetsForDate(
            rules,
            current.orderDate,
          );
          if (
            activeTargets.has('OUTREACH_COMMISSION') &&
            !outreachUserId
          ) {
            throw createHttpError(
              400,
              'MISSING_OUTREACH_USER',
              'An outreach user is required for the order date.',
            );
          }
          const updated = await tx.salesOrder.update({
            where: { id: salesOrderId },
            data: {
              salesUserId,
              outreachUserId,
              updatedById: actor.id,
              updatedAt: new Date(),
            },
          });
          const recalculation = await this.recalculateSalesOrderRecords(
            salesOrderId,
            {
              prisma: tx,
              actor,
              ipAddress: metadata.ipAddress || null,
              targetTypes: [
                'SALES_COMMISSION',
                'OUTREACH_COMMISSION',
                'LEADER_COMMISSION',
              ],
            },
          );
          await this.operationLogsService.appendLog(
            {
              userId: actor.id,
              action: 'commission_assignments.repair',
              entityType: 'sales_order',
              entityId: salesOrderId,
              beforeData: {
                salesUserId: current.salesUserId,
                outreachUserId: current.outreachUserId,
              },
              afterData: {
                salesUserId: updated.salesUserId,
                outreachUserId: updated.outreachUserId,
                orderDate: toDateOnly(current.orderDate),
              },
              ipAddress: metadata.ipAddress || null,
            },
            tx,
          );
          return {
            salesOrderId,
            orderNo: current.orderNo,
            success: true,
            leaderMissing:
              activeTargets.has('LEADER_COMMISSION') && !salesUser.leaderId,
            recalculation,
          };
        });
        results.push(result);
      } catch (error: any) {
        results.push({
          salesOrderId,
          success: false,
          error: error?.message || 'Repair failed.',
        });
      }
    }
    return {
      orderCount: assignments.length,
      successCount: results.filter((result) => result.success).length,
      failureCount: results.filter((result) => !result.success).length,
      results,
    };
  }

  async recalculateSalesOrderRecords(
    salesOrderId: string,
    options: any = {},
  ): Promise<any> {
    const orderId = normalizeRequiredString(salesOrderId, 'salesOrderId');
    const prisma = options.prisma || this.prisma;
    const actor = options.actor || null;

    const salesOrder = await this.loadSalesOrderForCalculation(prisma, orderId);
    const requestedTargetTypes = normalizeRecalculationTargetTypes(
      options.targetTypes,
    );
    const skippedTargetTypes = new Set(
      normalizeRecalculationTargetTypes(options.skipTargetTypes, []),
    );
    if (!isCommissionEligibleSalesOrder(salesOrder)) {
      return {
        salesOrderId: orderId,
        records: [],
        generatedRecords: [],
        updatedRecords: [],
        unchangedRecords: [],
        warnings: [
          {
            code: 'sales_order_not_commission_eligible',
            message:
              salesOrder.orderType === 'BUYBACK'
                ? '回购单不产生销售提成、积分或返点。'
                : '未审核生效的特殊订单不产生销售提成、积分或返点。',
          },
        ],
        requestedTargetTypes,
        skippedTargetTypes: Array.from(skippedTargetTypes),
        calculation: {
          calculationVersion: 'ineligible-sales-order',
          amounts: {},
          calculationNote: 'Sales commission calculation was skipped.',
        },
      };
    }
    const [
      salesDeductionRules,
      agencyDeductionRules,
      agencyRebateRules,
      commissionRules,
      travelAgencies,
    ] = await Promise.all([
      prisma.salesDeductionRule.findMany({ where: { isActive: true } }),
      prisma.agencyDeductionRule.findMany({ where: { isActive: true } }),
      prisma.agencyRebateRule.findMany({ where: { isActive: true } }),
      prisma.commissionRule.findMany({ where: { isActive: true } }),
      prisma.travelAgency.findMany(),
    ]);

    const calculation = calculateStage7CommissionAndPoints({
      salesOrder,
      salesDeductionRules,
      agencyDeductionRules,
      agencyRebateRules,
      commissionRules,
      travelAgencies,
      allowLatestAgencyRebateRuleFallback:
        options.allowLatestAgencyRebateRuleFallback === true,
    });
    const activeTargetTypes = requestedTargetTypes.filter(
      (targetType) => !skippedTargetTypes.has(targetType),
    );
    const lines = [
      ...calculation.commissionLines,
      ...calculation.agencyRebateLines,
    ].filter((line) => activeTargetTypes.includes(line.targetType));
    const lineTargetTypes = new Set(lines.map((line) => line.targetType));
    const generatedRecords: any[] = [];
    const updatedRecords: any[] = [];
    const unchangedRecords: any[] = [];

    for (const line of lines) {
      const businessKey = buildCommissionRecordBusinessKey(line);
      const current = await findExistingCommissionRecord(
        prisma,
        businessKey,
        line,
      );
      const data = buildCommissionRecordData(
        line,
        calculation,
        actor,
        current,
      );

      if (!current) {
        const created = await prisma.commissionRecord.create({
          data: {
            id: crypto.randomUUID(),
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
            createdById: actor?.id || null,
            updatedById: actor?.id || null,
          },
        });
        generatedRecords.push(toCommissionRecordDto(created));
        await this.appendRecordLog(
          prisma,
          actor,
          'commission_records.generate',
          null,
          created,
          options,
        );
        continue;
      }

      if (!hasCommissionRecordChanged(current, data)) {
        unchangedRecords.push(toCommissionRecordDto(current));
        continue;
      }

      const updated = await prisma.commissionRecord.update({
        where: {
          id: current.id,
        },
        data: {
          ...data,
          updatedAt: new Date(),
          updatedById: actor?.id || null,
        },
      });
      updatedRecords.push(toCommissionRecordDto(updated));

      if (hasCommissionRecordAmountChanged(current, updated)) {
        await this.appendRecordLog(
          prisma,
          actor,
          'commission_records.recalculate',
          current,
          updated,
          options,
        );
      }
    }

    const staleRecords = await prisma.commissionRecord.findMany({
      where: {
        salesOrderId: orderId,
        manualInput: false,
        targetType: {
          in: activeTargetTypes,
        },
      },
    });
    for (const current of staleRecords) {
      if (lineTargetTypes.has(current.targetType)) {
        continue;
      }
      const data = buildStaleCommissionRecordData(
        current,
        calculation,
        actor,
      );
      if (!hasCommissionRecordChanged(current, data)) {
        unchangedRecords.push(toCommissionRecordDto(current));
        continue;
      }
      const updated = await prisma.commissionRecord.update({
        where: {
          id: current.id,
        },
        data: {
          ...data,
          updatedAt: new Date(),
          updatedById: actor?.id || null,
        },
      });
      updatedRecords.push(toCommissionRecordDto(updated));
      if (hasCommissionRecordAmountChanged(current, updated)) {
        await this.appendRecordLog(
          prisma,
          actor,
          'commission_records.recalculate',
          current,
          updated,
          options,
        );
      }
    }

    return {
      salesOrderId: orderId,
      records: [
        ...generatedRecords,
        ...updatedRecords,
        ...unchangedRecords,
      ],
      generatedRecords,
      updatedRecords,
      unchangedRecords,
      warnings: calculation.warnings,
      requestedTargetTypes,
      skippedTargetTypes: Array.from(skippedTargetTypes),
      calculation: {
        calculationVersion: calculation.calculationVersion,
        amounts: calculation.amounts,
        calculationNote: calculation.calculationNote,
      },
    };
  }

  async updateTasterManualAmount(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, WRITE_COMMISSION_ROLES);
    const prisma = metadata.prisma || this.prisma;
    const amountCents = normalizeNonNegativeInteger(
      payload?.amountCents,
      'amountCents',
    );
    const current = await this.findTasterManualRecordForAmountUpdate(
      prisma,
      id,
      payload,
    );
    const salesOrderId = current
      ? normalizeRequiredString(current.salesOrderId, 'salesOrderId')
      : normalizeRequiredString(payload?.salesOrderId, 'salesOrderId');
    const context = await this.loadTasterManualOrderContext(
      prisma,
      salesOrderId,
    );
    assertTasterManualPayloadMatchesOrder(payload, context);

    if (!current) {
      let created: any;
      try {
        created = await prisma.commissionRecord.create({
          data: buildTasterManualCreateData({
            amountCents,
            actor,
            payload,
            context,
          }),
        });
      } catch (error) {
        if (!isOrderTasterManualUniqueConstraintError(error)) {
          throw error;
        }
        const concurrentRecord =
          await this.findOrderTasterManualRecord(prisma, context);
        if (!concurrentRecord) {
          throw error;
        }
        const updated = await prisma.commissionRecord.update({
          where: {
            id: concurrentRecord.id,
          },
          data: buildTasterManualUpdateData({
            amountCents,
            actor,
            payload,
            context,
            current: concurrentRecord,
          }),
        });
        await this.appendRecordLog(
          prisma,
          actor,
          'commission_records.taster_manual_amount.update',
          concurrentRecord,
          updated,
          metadata,
        );
        return toCommissionRecordDto(updated);
      }
      await this.appendRecordLog(
        prisma,
        actor,
        'commission_records.taster_manual_amount.create',
        null,
        created,
        metadata,
      );
      return toCommissionRecordDto(created);
    }

    assertTasterManualRecord(current);
    assertTasterManualRecordMatchesOrder(current, context);
    const updated = await prisma.commissionRecord.update({
      where: {
        id: current.id,
      },
      data: buildTasterManualUpdateData({
        amountCents,
        actor,
        payload,
        context,
        current,
      }),
    });
    await this.appendRecordLog(
      prisma,
      actor,
      'commission_records.taster_manual_amount.update',
      current,
      updated,
      metadata,
    );
    return toCommissionRecordDto(updated);
  }

  async confirmTasterCommissionRecord(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, WRITE_COMMISSION_ROLES);
    const prisma = metadata.prisma || this.prisma;
    const recordId = normalizeRequiredString(id, 'id');
    const isConfirmed = normalizeRequiredBoolean(
      payload?.isConfirmed ?? payload?.confirmed ?? payload?.confirm,
      'isConfirmed',
    );
    const current = await prisma.commissionRecord.findUnique({
      where: {
        id: recordId,
      },
    });
    if (!current) {
      throw createHttpError(
        404,
        'COMMISSION_RECORD_NOT_FOUND',
        'Commission record does not exist.',
      );
    }
    assertTasterManualRecord(current);
    const context = await this.loadTasterManualOrderContext(
      prisma,
      normalizeRequiredString(current.salesOrderId, 'salesOrderId'),
    );
    assertTasterManualPayloadMatchesOrder(payload, context);
    assertTasterManualRecordMatchesOrder(current, context);
    const now = new Date();
    const updated = await prisma.commissionRecord.update({
      where: {
        id: current.id,
      },
      data: {
        isConfirmed,
        confirmedById: isConfirmed ? actor.id : null,
        confirmedAt: isConfirmed ? now : null,
        updatedAt: now,
        updatedById: actor.id,
        sourceSnapshot: buildTasterManualSourceSnapshot({
          context,
          actor,
          amountCents: toInteger(current.amountCents),
          payload,
          current,
          operation: isConfirmed
            ? 'confirm_taster_commission'
            : 'cancel_taster_commission_confirm',
          operatedAt: now,
        }),
      },
    });
    await this.appendRecordLog(
      prisma,
      actor,
      isConfirmed
        ? 'commission_records.confirm.enable'
        : 'commission_records.confirm.disable',
      current,
      updated,
      metadata,
    );
    return toCommissionRecordDto(updated);
  }

  async markTasterManualAdjustmentPending(
    travelGroupIds: string[],
    options: any = {},
  ) {
    const groupIds = uniqueStrings(travelGroupIds);
    if (groupIds.length === 0) {
      return {
        records: [],
        recordIds: [],
      };
    }
    const prisma = options.prisma || this.prisma;
    const actor = options.actor || null;
    const records = await prisma.commissionRecord.findMany({
      where: {
        travelGroupId: {
          in: groupIds,
        },
        targetType: TASTER_COMMISSION_TARGET_TYPE,
        manualInput: true,
      },
    });
    const updatedRecords: any[] = [];
    for (const current of records) {
      const pendingAdjustment = buildTasterManualPendingAdjustment(
        current,
        options,
      );
      const sourceSnapshot = mergeSourceSnapshotPendingAdjustment(
        current.sourceSnapshot,
        pendingAdjustment,
      );
      const updated = await prisma.commissionRecord.update({
        where: {
          id: current.id,
        },
        data: {
          sourceSnapshot,
          updatedAt: new Date(),
          updatedById: actor?.id || null,
        },
      });
      updatedRecords.push(toCommissionRecordDto(updated));
      await this.operationLogsService.appendLog(
        {
          userId: actor?.id || null,
          action: 'commission_records.taster_manual_adjustment.remind',
          entityType: 'commission_record',
          entityId: current.id,
          beforeData: summarizeTasterManualPendingAdjustment(current),
          afterData: summarizeTasterManualPendingAdjustment(updated),
          ipAddress: options.ipAddress || null,
        },
        prisma,
      );
    }
    return {
      records: updatedRecords,
      recordIds: updatedRecords.map((record) => record.id),
    };
  }

  private async buildCommissionRecordQueryWhere(filters: any = {}) {
    const globalSalesOrderScope = await this.buildGlobalSalesOrderMarkScope();
    const globalGroupScope = await this.buildGlobalGroupMarkScope();
    const clauses: any[] = [
      buildCommissionRecordOrdinaryScope(
        globalSalesOrderScope,
        globalGroupScope,
      ),
      { isActive: { not: false } },
    ];

    const recordId = normalizeOptionalString(filters?.id);
    if (recordId) {
      clauses.push({
        id: recordId,
      });
    }

    const targetType = normalizeCommissionTargetTypeFilter(filters?.targetType);
    if (targetType) {
      clauses.push({
        targetType,
      });
    }

    for (const fieldName of [
      'targetUserId',
      'agencyId',
      'travelGroupId',
      'salesOrderId',
    ]) {
      const value = normalizeOptionalString(filters?.[fieldName]);
      if (value) {
        clauses.push({
          [fieldName]: value,
        });
      }
    }

    const isConfirmed = normalizeOptionalBooleanFilter(
      filters?.isConfirmed,
      'isConfirmed',
    );
    if (isConfirmed !== null) {
      clauses.push({
        isConfirmed,
      });
    }

    const manualInput = normalizeOptionalBooleanFilter(
      filters?.manualInput,
      'manualInput',
    );
    if (manualInput !== null) {
      clauses.push({
        manualInput,
      });
    }

    const dateRange = buildDateRange(filters?.dateFrom, filters?.dateTo);
    if (dateRange) {
      clauses.push({
        OR: [
          {
            salesOrder: {
              is: {
                orderDate: dateRange,
              },
            },
          },
          {
            salesOrderId: null,
            travelGroup: {
              is: {
                visitDate: dateRange,
              },
            },
          },
        ],
      });
    }

    const query = normalizeOptionalString(filters?.query);
    if (query) {
      clauses.push(buildCommissionRecordSearchWhere(query));
    }

    return andWhere(...clauses);
  }

  private async buildGlobalGroupMarkScope() {
    return buildSharedGlobalTravelGroupMarkScope(
      await this.onlyShowMarkedRecords(),
    );
  }

  private async buildGlobalSalesOrderMarkScope() {
    return buildSharedGlobalSalesOrderMarkScope(
      await this.onlyShowMarkedRecords(),
    );
  }

  private async onlyShowMarkedRecords() {
    if (!this.settingsService?.getGlobalMarkQuery) {
      return false;
    }
    const settings = await this.settingsService.getGlobalMarkQuery();
    return Boolean(settings.onlyShowMarkedRecords);
  }

  private async loadSalesOrderForCalculation(prisma: any, salesOrderId: string) {
    const salesOrder = await prisma.salesOrder.findUnique({
      where: {
        id: salesOrderId,
      },
      include: {
        items: {
          orderBy: {
            sortOrder: 'asc',
          },
        },
        salesUser: {
          include: {
            leader: true,
          },
        },
        outreachUser: true,
        travelGroup: true,
        afterSalesOrders: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!salesOrder) {
      throw createHttpError(
        404,
        'SALES_ORDER_NOT_FOUND',
        'Sales order does not exist.',
      );
    }
    return salesOrder;
  }

  private async findTasterManualRecordForAmountUpdate(
    prisma: any,
    id: string,
    payload: any,
  ) {
    const recordId = normalizeOptionalString(id);
    const shouldFindById =
      recordId &&
      !['new', 'create', 'manual', 'taster'].includes(
        recordId.toLowerCase(),
      );
    if (shouldFindById) {
      const current = await prisma.commissionRecord.findUnique({
        where: {
          id: recordId,
        },
      });
      if (!current) {
        throw createHttpError(
          404,
          'COMMISSION_RECORD_NOT_FOUND',
          'Commission record does not exist.',
        );
      }
      return current;
    }

    const salesOrderId = normalizeRequiredString(
      payload?.salesOrderId,
      'salesOrderId',
    );
    const context = await this.loadTasterManualOrderContext(
      prisma,
      salesOrderId,
    );
    return prisma.commissionRecord.findFirst({
      where: {
        salesOrderId,
        targetType: TASTER_COMMISSION_TARGET_TYPE,
        targetUserId: context.taster.id,
        manualInput: true,
      },
    });
  }

  private async loadTasterManualOrderContext(
    prisma: any,
    salesOrderId: string,
  ) {
    const orderId = normalizeRequiredString(salesOrderId, 'salesOrderId');
    const salesOrder = await prisma.salesOrder.findUnique({
      where: {
        id: orderId,
      },
      include: {
        travelGroup: {
          include: {
            taster: true,
          },
        },
      },
    });
    if (!salesOrder) {
      throw createHttpError(
        404,
        'SALES_ORDER_NOT_FOUND',
        'Sales order does not exist.',
      );
    }
    if (!isCommissionEligibleSalesOrder(salesOrder)) {
      throw createHttpError(
        400,
        'SALES_ORDER_COMMISSION_INELIGIBLE',
        'Buyback and non-effective workflow orders cannot receive taster commission.',
      );
    }
    const travelGroup = salesOrder.travelGroup;
    if (!salesOrder.travelGroupId || !travelGroup) {
      throw createHttpError(
        400,
        'SALES_ORDER_TASTER_NOT_AVAILABLE',
        'Sales order must reference a travel group before entering taster commission.',
      );
    }
    const taster = travelGroup.taster;
    if (!travelGroup.tasterId || !taster) {
      throw createHttpError(
        400,
        'SALES_ORDER_TASTER_NOT_AVAILABLE',
        'Sales order travel group has no associated taster.',
      );
    }
    if (normalizeRole(taster.role) !== 'taster' || !taster.isActive) {
      throw createHttpError(
        400,
        'VALIDATION_FAILED',
        'tasterId must reference an active taster user.',
      );
    }
    return {
      salesOrder,
      travelGroup,
      taster,
    };
  }

  private async findOrderTasterManualRecord(prisma: any, context: any) {
    return prisma.commissionRecord.findFirst({
      where: {
        salesOrderId: context.salesOrder.id,
        targetType: TASTER_COMMISSION_TARGET_TYPE,
        targetUserId: context.taster.id,
        manualInput: true,
      },
    });
  }

  private async appendRecordLog(
    prisma: any,
    actor: any,
    action: string,
    beforeRecord: any,
    afterRecord: any,
    options: any,
  ) {
    await this.operationLogsService.appendLog(
      {
        userId: actor?.id || null,
        action,
        entityType: 'commission_record',
        entityId: afterRecord.id,
        beforeData: beforeRecord ? summarizeCommissionRecord(beforeRecord) : null,
        afterData: summarizeCommissionRecord(afterRecord),
        ipAddress: options.ipAddress || null,
      },
      prisma,
    );
  }
}

function normalizeRecalculationTargetTypes(
  value: unknown,
  fallback: string[] = AUTO_TARGET_TYPES,
) {
  if (value === undefined || value === null) {
    return [...fallback];
  }
  if (!Array.isArray(value)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'targetTypes must be an array.',
    );
  }
  const result = Array.from(
    new Set(
      value
        .map((item) => normalizeOptionalString(item)?.toUpperCase())
        .filter(
          (item): item is string =>
            Boolean(item) && AUTO_TARGET_TYPES.includes(item),
        ),
    ),
  );
  if (result.length !== value.length) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'targetTypes contains an unsupported value.',
    );
  }
  return result;
}

function buildCommissionRecordBusinessKey(line: any) {
  const where: any = {
    salesOrderId: line.salesOrderId,
    targetType: line.targetType,
    manualInput: false,
  };
  if (line.targetUserId) {
    where.targetUserId = line.targetUserId;
    return where;
  }
  if (line.agencyId) {
    where.agencyId = line.agencyId;
    return where;
  }
  where.agencyId = null;
  where.agencyName = line.agencyName || null;
  return where;
}

async function findExistingCommissionRecord(
  prisma: any,
  businessKey: any,
  line: any,
) {
  const current = await prisma.commissionRecord.findFirst({
    where: businessKey,
  });
  if (current) {
    return current;
  }
  if (!AUTO_TARGET_TYPES.includes(line.targetType)) {
    return null;
  }
  return prisma.commissionRecord.findFirst({
    where: {
      salesOrderId: line.salesOrderId,
      targetType: line.targetType,
      manualInput: false,
    },
  });
}

function buildCommissionRecordData(
  line: any,
  calculation: any,
  actor: any,
  current: any = null,
) {
  const ruleSnapshot = {
    targetType: line.targetType,
    primaryRuleId: line.commissionRuleId || line.agencyRebateRuleId || null,
    ...calculation.ruleSnapshot,
  };
  const sourceSnapshot = {
    targetType: line.targetType,
    businessKey: buildCommissionRecordBusinessKey(line),
    ...calculation.sourceSnapshot,
  };

  return {
    salesOrderId: line.salesOrderId || null,
    travelGroupId: line.travelGroupId || null,
    afterSalesOrderId: null,
    commissionRuleId: line.commissionRuleId || null,
    agencyRebateRuleId: line.agencyRebateRuleId || null,
    targetType: line.targetType,
    targetUserId: line.targetUserId || null,
    agencyId: line.agencyId || null,
    agencyName: line.agencyName || null,
    grossAmountCents: toInteger(line.grossAmountCents),
    confirmedRefundAmountCents: toInteger(
      line.confirmedRefundAmountCents,
    ),
    baseAmountCents: toInteger(line.baseAmountCents),
    deductionAmountCents: toInteger(line.deductionAmountCents),
    rateSnapshot: normalizeNullableRate(line.rateSnapshot),
    amountCents: toInteger(line.amountCents),
    pointsCents: toInteger(line.pointsCents),
    manualInput: false,
    isConfirmed: Boolean(current?.isConfirmed),
    confirmedById: current?.confirmedById || null,
    confirmedAt: current?.confirmedAt || null,
    calculationVersion: line.calculationVersion,
    calculationNote: calculation.calculationNote,
    ruleSnapshot,
    sourceSnapshot,
    updatedById: actor?.id || null,
  };
}

function buildStaleCommissionRecordData(
  current: any,
  calculation: any,
  actor: any,
) {
  const isAgencyRecord = [
    'AGENCY_DAILY_REBATE',
    'AGENCY_MONTHLY_REBATE',
  ].includes(current.targetType);
  const sourceSnapshot = {
    ...(isPlainObject(calculation.sourceSnapshot)
      ? calculation.sourceSnapshot
      : {}),
    targetType: current.targetType,
    staleRecord: {
      id: current.id,
      targetType: current.targetType,
      targetUserId: current.targetUserId || null,
      agencyId: current.agencyId || null,
      agencyName: current.agencyName || null,
      zeroedBecause: 'current_calculation_has_no_matching_auto_line',
    },
  };
  const ruleSnapshot = {
    targetType: current.targetType,
    zeroedBecause: 'current_calculation_has_no_matching_auto_line',
    ...calculation.ruleSnapshot,
  };
  return {
    salesOrderId: current.salesOrderId || null,
    travelGroupId:
      normalizeOptionalString(calculation.sourceSnapshot?.salesOrder?.travelGroupId) ||
      current.travelGroupId ||
      null,
    afterSalesOrderId: null,
    commissionRuleId: null,
    agencyRebateRuleId: null,
    targetType: current.targetType,
    targetUserId: current.targetUserId || null,
    agencyId: current.agencyId || null,
    agencyName: current.agencyName || null,
    grossAmountCents: toInteger(calculation.amounts.grossAmountCents),
    confirmedRefundAmountCents: toInteger(
      calculation.amounts.confirmedRefundAmountCents,
    ),
    baseAmountCents: 0,
    deductionAmountCents: isAgencyRecord
      ? toInteger(calculation.amounts.agencyDeductionAmountCents)
      : toInteger(calculation.amounts.salesDeductionAmountCents),
    rateSnapshot: current.rateSnapshot || null,
    amountCents: 0,
    pointsCents: 0,
    manualInput: false,
    isConfirmed: Boolean(current?.isConfirmed),
    confirmedById: current?.confirmedById || null,
    confirmedAt: current?.confirmedAt || null,
    calculationVersion: calculation.calculationVersion,
    calculationNote: `${calculation.calculationNote}; stale auto record zeroed`,
    ruleSnapshot,
    sourceSnapshot,
    updatedById: actor?.id || null,
  };
}

function buildTasterManualCreateData(options: {
  amountCents: number;
  actor: any;
  payload: any;
  context: any;
}) {
  const now = new Date();
  const sourceSnapshot = buildTasterManualSourceSnapshot({
    ...options,
    current: null,
    operation: 'create_taster_manual_commission',
    operatedAt: now,
  });
  return {
    id: crypto.randomUUID(),
    salesOrderId: options.context.salesOrder.id,
    travelGroupId: options.context.travelGroup.id,
    afterSalesOrderId: null,
    commissionRuleId: null,
    agencyRebateRuleId: null,
    targetType: TASTER_COMMISSION_TARGET_TYPE,
    targetUserId: options.context.taster.id,
    agencyId: null,
    agencyName: null,
    grossAmountCents: 0,
    confirmedRefundAmountCents: 0,
    baseAmountCents: 0,
    deductionAmountCents: 0,
    rateSnapshot: null,
    amountCents: options.amountCents,
    pointsCents: 0,
    manualInput: true,
    isConfirmed: false,
    confirmedById: null,
    confirmedAt: null,
    calculationVersion: 'stage7_v1',
    calculationNote: buildTasterManualCalculationNote(options.payload),
    ruleSnapshot: MANUAL_TASTER_RULE_SNAPSHOT,
    sourceSnapshot,
    createdById: options.actor.id,
    updatedById: options.actor.id,
    createdAt: now,
    updatedAt: now,
  };
}

function buildTasterManualUpdateData(options: {
  amountCents: number;
  actor: any;
  payload: any;
  context: any;
  current: any;
}) {
  const now = new Date();
  return {
    amountCents: options.amountCents,
    pointsCents: 0,
    manualInput: true,
    isConfirmed: false,
    confirmedById: null,
    confirmedAt: null,
    calculationVersion: options.current.calculationVersion || 'stage7_v1',
    calculationNote: buildTasterManualCalculationNote(
      options.payload,
      options.current,
    ),
    ruleSnapshot: options.current.ruleSnapshot || MANUAL_TASTER_RULE_SNAPSHOT,
    sourceSnapshot: buildTasterManualSourceSnapshot({
      ...options,
      operation: 'update_taster_manual_commission',
      operatedAt: now,
    }),
    updatedAt: now,
    updatedById: options.actor.id,
  };
}

function buildTasterManualCalculationNote(payload: any, current?: any) {
  return (
    normalizeOptionalString(
      payload?.calculationNote ?? payload?.note ?? payload?.notes,
    ) ||
    normalizeOptionalString(current?.calculationNote) ||
    'stage7 taster manual commission'
  );
}

function buildTasterManualSourceSnapshot(options: {
  context: any;
  actor: any;
  amountCents: number;
  payload?: any;
  current?: any;
  operation: string;
  operatedAt: Date;
}) {
  return {
    sourceType: 'taster_manual_commission',
    manualInput: true,
    operation: options.operation,
    operatedAt: options.operatedAt.toISOString(),
    amountCents: options.amountCents,
    calculationVersion: 'stage7_v1',
    salesOrder: summarizeSalesOrderForTasterManual(
      options.context.salesOrder,
    ),
    travelGroup: summarizeTravelGroupForTasterManual(
      options.context.travelGroup,
    ),
    taster: summarizeUserForSnapshot(options.context.taster),
    operatedBy: summarizeActorForSnapshot(options.actor),
    previousRecord: options.current
      ? {
          id: options.current.id,
          amountCents: toInteger(options.current.amountCents),
          isConfirmed: Boolean(options.current.isConfirmed),
          confirmedById: options.current.confirmedById || null,
          confirmedAt: toIsoString(options.current.confirmedAt),
        }
      : null,
    note:
      normalizeOptionalString(
        options.payload?.calculationNote ??
          options.payload?.note ??
          options.payload?.notes,
      ) || null,
  };
}

function buildTasterManualPendingAdjustment(record: any, options: any = {}) {
  const triggeredAt = options.triggeredAt
    ? new Date(options.triggeredAt)
    : new Date();
  return {
    pending: true,
    reason: 'stage7_order_or_after_sales_recalculated',
    trigger: options.trigger || null,
    salesOrderId: options.salesOrderId || record.salesOrderId || null,
    afterSalesOrderId: options.afterSalesOrderId || null,
    travelGroupId: record.travelGroupId || null,
    orderStatus: options.orderStatus || null,
    warningCodes: (options.warnings || []).map((warning: any) => warning.code),
    triggeredAt: triggeredAt.toISOString(),
  };
}

function mergeSourceSnapshotPendingAdjustment(
  sourceSnapshot: any,
  pendingAdjustment: any,
) {
  if (isPlainObject(sourceSnapshot)) {
    return {
      ...sourceSnapshot,
      pendingAdjustment,
    };
  }
  return {
    previousSourceSnapshot: sourceSnapshot ?? null,
    pendingAdjustment,
  };
}

function summarizeTasterManualPendingAdjustment(record: any) {
  return {
    id: record.id,
    salesOrderId: record.salesOrderId || null,
    travelGroupId: record.travelGroupId || null,
    targetType: record.targetType,
    targetUserId: record.targetUserId || null,
    amountCents: toInteger(record.amountCents),
    manualInput: Boolean(record.manualInput),
    isConfirmed: Boolean(record.isConfirmed),
    pendingAdjustment:
      isPlainObject(record.sourceSnapshot) &&
      isPlainObject(record.sourceSnapshot.pendingAdjustment)
        ? record.sourceSnapshot.pendingAdjustment
        : null,
  };
}

function summarizeTravelGroupForTasterManual(travelGroup: any) {
  return {
    id: travelGroup.id,
    groupNo: travelGroup.groupNo || null,
    visitDate: toDateOnly(travelGroup.visitDate),
    travelAgency: normalizeOptionalString(travelGroup.travelAgency),
    guideName: travelGroup.guideName || null,
    tasterId: travelGroup.tasterId || null,
    tasterName: travelGroup.tasterName || null,
    financeMark:
      travelGroup.financeMark === undefined
        ? null
        : Boolean(travelGroup.financeMark),
  };
}

function summarizeSalesOrderForTasterManual(salesOrder: any) {
  return {
    id: salesOrder.id,
    orderNo: salesOrder.orderNo || null,
    orderDate: toDateOnly(salesOrder.orderDate),
    travelGroupId: salesOrder.travelGroupId || null,
    customerName: salesOrder.customerName || null,
    status: targetStatusToApi(salesOrder.status),
  };
}

function summarizeUserForSnapshot(user: any) {
  return {
    id: user.id,
    name: user.name || null,
    username: user.username || null,
    role: normalizeRole(user.role),
    isActive: user.isActive === undefined ? null : Boolean(user.isActive),
  };
}

function summarizeActorForSnapshot(actor: any) {
  return actor
    ? {
        id: actor.id,
        name: actor.name || null,
        username: actor.username || null,
        role: actor.role || null,
      }
    : null;
}

function hasCommissionRecordChanged(current: any, next: any) {
  return RECORD_COMPARE_FIELDS.some(
    (field) => !valuesEqualForRecord(current[field], next[field]),
  );
}

function hasCommissionRecordAmountChanged(beforeRecord: any, afterRecord: any) {
  return AMOUNT_COMPARE_FIELDS.some(
    (field) => !valuesEqualForRecord(beforeRecord[field], afterRecord[field]),
  );
}

const RECORD_COMPARE_FIELDS = [
  'salesOrderId',
  'travelGroupId',
  'afterSalesOrderId',
  'commissionRuleId',
  'agencyRebateRuleId',
  'targetType',
  'targetUserId',
  'agencyId',
  'agencyName',
  'grossAmountCents',
  'confirmedRefundAmountCents',
  'baseAmountCents',
  'deductionAmountCents',
  'rateSnapshot',
  'amountCents',
  'pointsCents',
  'manualInput',
  'isConfirmed',
  'calculationVersion',
  'calculationNote',
  'ruleSnapshot',
  'sourceSnapshot',
];

const AMOUNT_COMPARE_FIELDS = [
  'grossAmountCents',
  'confirmedRefundAmountCents',
  'baseAmountCents',
  'deductionAmountCents',
  'rateSnapshot',
  'amountCents',
  'pointsCents',
];

function valuesEqualForRecord(left: any, right: any) {
  if (left instanceof Date || right instanceof Date) {
    return normalizeDateString(left) === normalizeDateString(right);
  }
  if (isRateLike(left) || isRateLike(right)) {
    return normalizeNullableRate(left) === normalizeNullableRate(right);
  }
  if (isObjectLike(left) || isObjectLike(right)) {
    return stableStringify(left ?? null) === stableStringify(right ?? null);
  }
  return (left ?? null) === (right ?? null);
}

function summarizeCommissionRecord(record: any) {
  return {
    id: record.id,
    salesOrderId: record.salesOrderId || null,
    travelGroupId: record.travelGroupId || null,
    targetType: record.targetType,
    targetUserId: record.targetUserId || null,
    agencyId: record.agencyId || null,
    agencyName: record.agencyName || null,
    commissionRuleId: record.commissionRuleId || null,
    agencyRebateRuleId: record.agencyRebateRuleId || null,
    grossAmountCents: toInteger(record.grossAmountCents),
    confirmedRefundAmountCents: toInteger(
      record.confirmedRefundAmountCents,
    ),
    baseAmountCents: toInteger(record.baseAmountCents),
    deductionAmountCents: toInteger(record.deductionAmountCents),
    rateSnapshot: normalizeNullableRate(record.rateSnapshot),
    amountCents: toInteger(record.amountCents),
    pointsCents: toInteger(record.pointsCents),
    manualInput: Boolean(record.manualInput),
    isConfirmed: Boolean(record.isConfirmed),
    confirmedById: record.confirmedById || null,
    confirmedAt: toIsoString(record.confirmedAt),
    calculationVersion: record.calculationVersion || null,
  };
}

function getCommissionRecordListInclude(): any {
  return {
    salesOrder: {
      include: {
        customer: true,
        travelGroup: true,
      },
    },
    travelGroup: true,
    targetUser: true,
    agency: true,
    confirmedBy: true,
    adjustments: {
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    },
  };
}

function getCommissionRecordDetailInclude(): any {
  return {
    ...getCommissionRecordListInclude(),
    afterSalesOrder: true,
  };
}

function getCommissionRecordExportInclude(): any {
  return {
    salesOrder: {
      include: {
        customer: true,
        travelGroup: true,
        salesUser: {
          include: {
            leader: true,
          },
        },
        outreachUser: true,
      },
    },
    travelGroup: {
      include: {
        taster: true,
      },
    },
    targetUser: true,
    agency: true,
    confirmedBy: true,
  };
}

const COMMISSION_RECORD_EXPORT_COLUMNS = [
  { header: '日期', key: 'date', width: 14 },
  { header: '订单号', key: 'orderNo', width: 20 },
  { header: '旅行团', key: 'travelGroup', width: 20 },
  { header: '客户', key: 'customer', width: 20 },
  { header: '销售', key: 'sales', width: 16 },
  { header: '外联', key: 'outreach', width: 16 },
  { header: '组长', key: 'leader', width: 16 },
  { header: '品鉴师', key: 'taster', width: 16 },
  { header: '旅行社', key: 'agency', width: 24 },
  { header: 'targetType', key: 'targetType', width: 22 },
  { header: '订单类型', key: 'orderType', width: 14 },
  { header: '对象类型', key: 'recipientType', width: 14 },
  { header: '提成对象', key: 'recipientName', width: 18 },
  { header: '来源类型', key: 'sourceType', width: 18 },
  { header: '原始金额', key: 'grossAmountYuan', width: 14 },
  { header: '已确认退款', key: 'confirmedRefundYuan', width: 14 },
  { header: '基础金额', key: 'baseAmountYuan', width: 14 },
  { header: '扣减成本', key: 'deductionAmountYuan', width: 14 },
  { header: '比例', key: 'rateSnapshot', width: 12 },
  { header: '提成金额', key: 'amountYuan', width: 14 },
  { header: '原提成金额', key: 'originalAmountYuan', width: 14 },
  { header: '冲减金额', key: 'adjustmentAmountYuan', width: 14 },
  { header: '归属日期', key: 'attributionDate', width: 14 },
  { header: '调整记录', key: 'adjustmentLog', width: 42 },
  { header: '积分金额', key: 'pointsYuan', width: 14 },
  { header: '确认状态', key: 'confirmedStatus', width: 12 },
  { header: '确认人', key: 'confirmedBy', width: 16 },
  { header: '确认时间', key: 'confirmedAt', width: 24 },
  { header: '计算说明', key: 'calculationNote', width: 40 },
];

const COMMISSION_RECORD_EXPORT_AMOUNT_KEYS = new Set([
  'grossAmountYuan',
  'confirmedRefundYuan',
  'baseAmountYuan',
  'deductionAmountYuan',
  'amountYuan',
  'originalAmountYuan',
  'adjustmentAmountYuan',
  'pointsYuan',
]);

function buildCommissionRecordsExportWorkbook(records: any[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'jiangjiu-api';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet('提成积分明细');
  worksheet.columns = COMMISSION_RECORD_EXPORT_COLUMNS;
  for (const column of worksheet.columns) {
    if (
      column.key &&
      COMMISSION_RECORD_EXPORT_AMOUNT_KEYS.has(String(column.key))
    ) {
      column.numFmt = '0.00';
    }
    column.alignment = { vertical: 'top', wrapText: true };
  }
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: COMMISSION_RECORD_EXPORT_COLUMNS.length },
  };
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).alignment = {
    vertical: 'middle',
    horizontal: 'center',
  };

  for (const record of records) {
    worksheet.addRow(toCommissionRecordExportRow(record));
  }

  return workbook;
}

function toCommissionRecordExportRow(record: any) {
  const salesOrder = record.salesOrder || null;
  const travelGroup = record.travelGroup || salesOrder?.travelGroup || null;
  const targetType = targetTypeToApi(record.targetType);

  return {
    date: toDateOnly(
      salesOrder?.orderDate || travelGroup?.visitDate || record.createdAt,
    ),
    orderNo: salesOrder?.orderNo || '',
    travelGroup: travelGroup?.groupNo || '',
    customer: salesOrder?.customer?.name || salesOrder?.customerName || '',
    sales: salesOrder?.salesUser?.name || '',
    outreach: salesOrder?.outreachUser?.name || '',
    leader: salesOrder?.salesUser?.leader?.name || '',
    taster: getCommissionRecordTasterName(record, travelGroup, targetType),
    agency: record.agencyName || record.agency?.name || travelGroup?.travelAgency || '',
    targetType: targetType || '',
    orderType: String(salesOrder?.orderType || '').toLowerCase(),
    recipientType: String(record.recipientType || '').toLowerCase(),
    recipientName:
      record.recipientNameSnapshot || record.targetUser?.name || '',
    sourceType: String(record.sourceType || '').toLowerCase(),
    grossAmountYuan: centsToYuanNumber(record.grossAmountCents),
    confirmedRefundYuan: centsToYuanNumber(
      record.confirmedRefundAmountCents,
    ),
    baseAmountYuan: centsToYuanNumber(record.baseAmountCents),
    deductionAmountYuan: centsToYuanNumber(record.deductionAmountCents),
    rateSnapshot: normalizeNullableRate(record.rateSnapshot) || '',
    amountYuan: centsToYuanNumber(record.amountCents),
    originalAmountYuan: centsToYuanNumber(
      record.originalAmountCents ?? record.amountCents,
    ),
    adjustmentAmountYuan: centsToYuanNumber(
      record.adjustmentAmountCents,
    ),
    attributionDate: toDateOnly(record.attributionDate),
    adjustmentLog: (record.adjustments || [])
      .map(
        (item: any) =>
          `${toIsoString(item.createdAt) || ''} ${item.adjustmentType || ''} ${item.adjustmentAmountCents || 0}`,
      )
      .join('\n'),
    pointsYuan: centsToYuanNumber(record.pointsCents),
    confirmedStatus: booleanLabel(record.isConfirmed),
    confirmedBy: record.confirmedBy?.name || '',
    confirmedAt: toIsoString(record.confirmedAt) || '',
    calculationNote: record.calculationNote || '',
  };
}

function getCommissionRecordTasterName(
  record: any,
  travelGroup: any,
  targetType: string | null,
) {
  if (targetType === 'taster_commission') {
    return record.targetUser?.name || travelGroup?.tasterName || '';
  }
  return travelGroup?.taster?.name || travelGroup?.tasterName || '';
}

function buildCommissionRecordOrdinaryScope(
  globalSalesOrderScope: any,
  globalGroupScope: any,
) {
  return {
    OR: [
      {
        salesOrderId: {
          not: null,
        },
        salesOrder: {
          is: globalSalesOrderScope || {},
        },
      },
      {
        salesOrderId: null,
        travelGroupId: {
          not: null,
        },
        targetType: TASTER_COMMISSION_TARGET_TYPE,
        manualInput: true,
        travelGroup: {
          is: globalGroupScope || {},
        },
      },
    ],
  };
}

function buildCommissionRecordSearchWhere(query: string) {
  return {
    OR: [
      {
        agencyName: {
          contains: query,
        },
      },
      {
        calculationNote: {
          contains: query,
        },
      },
      {
        recipientNameSnapshot: {
          contains: query,
        },
      },
      {
        salesOrder: {
          is: {
            orderNo: {
              contains: query,
            },
          },
        },
      },
      {
        salesOrder: {
          is: {
            customerName: {
              contains: query,
            },
          },
        },
      },
      {
        salesOrder: {
          is: {
            customer: {
              is: {
                name: {
                  contains: query,
                },
              },
            },
          },
        },
      },
      {
        travelGroup: {
          is: {
            groupNo: {
              contains: query,
            },
          },
        },
      },
      {
        travelGroup: {
          is: {
            travelAgency: {
              contains: query,
            },
          },
        },
      },
      {
        targetUser: {
          is: {
            name: {
              contains: query,
            },
          },
        },
      },
      {
        targetUser: {
          is: {
            username: {
              contains: query,
            },
          },
        },
      },
      {
        agency: {
          is: {
            name: {
              contains: query,
            },
          },
        },
      },
    ],
  };
}

function toCommissionRecordListDto(record: any) {
  const sourceSnapshot = record.sourceSnapshot || null;
  const salesOrder = summarizeSalesOrderForCommission(
    record.salesOrder,
    sourceSnapshot,
  );
  const travelGroup = summarizeTravelGroupForCommission(
    record.travelGroup || record.salesOrder?.travelGroup,
    sourceSnapshot,
  );

  return {
    id: record.id,
    salesOrderId: record.salesOrderId || null,
    travelGroupId: record.travelGroupId || null,
    targetType: targetTypeToApi(record.targetType),
    targetUserId: record.targetUserId || null,
    recipientType: record.recipientType
      ? String(record.recipientType).toLowerCase()
      : null,
    recipientName:
      record.recipientNameSnapshot || record.targetUser?.name || null,
    sourceType: record.sourceType
      ? String(record.sourceType).toLowerCase()
      : null,
    agencyId: record.agencyId || null,
    agencyName: record.agencyName || record.agency?.name || null,
    salesOrderNo: salesOrder?.orderNo || null,
    salesOrder,
    travelGroup,
    customer: summarizeCustomerForCommission(record.salesOrder),
    targetUser: summarizePublicUser(record.targetUser),
    agency: summarizeAgencyForCommission(record),
    grossAmountCents: toInteger(record.grossAmountCents),
    confirmedRefundAmountCents: toInteger(
      record.confirmedRefundAmountCents,
    ),
    baseAmountCents: toInteger(record.baseAmountCents),
    deductionAmountCents: toInteger(record.deductionAmountCents),
    rateSnapshot: normalizeNullableRate(record.rateSnapshot),
    amountCents: toInteger(record.amountCents),
    originalAmountCents: toInteger(
      record.originalAmountCents ?? record.amountCents,
    ),
    adjustmentAmountCents: toInteger(record.adjustmentAmountCents),
    attributionDate: toDateOnly(record.attributionDate),
    isActive: record.isActive !== false,
    adjustments: summarizeCommissionAdjustments(record.adjustments),
    pointsCents: toInteger(record.pointsCents),
    manualInput: Boolean(record.manualInput),
    isConfirmed: Boolean(record.isConfirmed),
    confirmedBy: summarizePublicUser(record.confirmedBy),
    confirmedAt: toIsoString(record.confirmedAt),
    calculationVersion: record.calculationVersion || null,
    calculationNoteSummary: summarizeText(record.calculationNote, 160),
    createdAt: toIsoString(record.createdAt),
    updatedAt: toIsoString(record.updatedAt),
  };
}

function toCommissionRecordDetailDto(record: any) {
  return {
    ...toCommissionRecordDto(record),
    salesOrder: summarizeSalesOrderForCommission(
      record.salesOrder,
      record.sourceSnapshot,
    ),
    travelGroup: summarizeTravelGroupForCommission(
      record.travelGroup || record.salesOrder?.travelGroup,
      record.sourceSnapshot,
    ),
    customer: summarizeCustomerForCommission(record.salesOrder),
    targetUser: summarizePublicUser(record.targetUser),
    agency: summarizeAgencyForCommission(record),
    confirmedBy: summarizePublicUser(record.confirmedBy),
    calculationNoteSummary: summarizeText(record.calculationNote, 160),
    ruleSnapshot: scrubSensitiveJson(record.ruleSnapshot || null),
    sourceSnapshot: scrubSensitiveJson(record.sourceSnapshot || null),
  };
}

function summarizeSalesOrderForCommission(order: any, sourceSnapshot: any) {
  const snapshotOrder = isPlainObject(sourceSnapshot?.salesOrder)
    ? sourceSnapshot.salesOrder
    : null;
  if (!order && !snapshotOrder) {
    return null;
  }
  return {
    id: order?.id || snapshotOrder?.id || null,
    orderNo: order?.orderNo || snapshotOrder?.orderNo || null,
    orderDate: toDateOnly(order?.orderDate || snapshotOrder?.orderDate),
    orderType: String(order?.orderType || snapshotOrder?.orderType || '')
      .trim()
      .toLowerCase() || null,
    status: targetStatusToApi(order?.status || snapshotOrder?.status),
    customerName:
      normalizeOptionalString(order?.customerName) ||
      normalizeOptionalString(snapshotOrder?.customerName),
  };
}

function summarizeTravelGroupForCommission(group: any, sourceSnapshot: any) {
  const snapshotGroup = isPlainObject(sourceSnapshot?.travelGroup)
    ? sourceSnapshot.travelGroup
    : null;
  if (!group && !snapshotGroup) {
    return null;
  }
  return {
    id: group?.id || snapshotGroup?.id || null,
    groupNo: group?.groupNo || snapshotGroup?.groupNo || null,
    visitDate: toDateOnly(group?.visitDate || snapshotGroup?.visitDate),
    travelAgency:
      normalizeOptionalString(group?.travelAgency) ||
      normalizeOptionalString(snapshotGroup?.travelAgency),
    tasterId: group?.tasterId || snapshotGroup?.tasterId || null,
    tasterName:
      normalizeOptionalString(group?.tasterName) ||
      normalizeOptionalString(snapshotGroup?.tasterName),
    financeMark:
      group?.financeMark === undefined
        ? snapshotGroup?.financeMark ?? null
        : Boolean(group.financeMark),
  };
}

function summarizeCustomerForCommission(order: any) {
  if (!order) {
    return null;
  }
  const customer = order.customer || null;
  return {
    id: order.customerId || customer?.id || null,
    name: customer?.name || order.customerName || null,
  };
}

function summarizeAgencyForCommission(record: any) {
  if (!record.agencyId && !record.agencyName && !record.agency) {
    return null;
  }
  return {
    id: record.agencyId || record.agency?.id || null,
    name: record.agencyName || record.agency?.name || null,
  };
}

function summarizePublicUser(user: any) {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    name: user.name || null,
    username: user.username || null,
    role: normalizeRole(user.role),
  };
}

function summarizeCommissionAdjustments(adjustments: any) {
  return (Array.isArray(adjustments) ? adjustments : []).map((item: any) => ({
    id: item.id,
    adjustmentType: String(item.adjustmentType || '').toLowerCase(),
    afterSalesOrderId: item.afterSalesOrderId || null,
    previousEffectiveBaseAmountCents: toInteger(
      item.previousEffectiveBaseAmountCents,
    ),
    effectiveBaseAmountCents: toInteger(item.effectiveBaseAmountCents),
    previousEffectiveAmountCents: toInteger(
      item.previousEffectiveAmountCents,
    ),
    adjustmentAmountCents: toInteger(item.adjustmentAmountCents),
    effectiveAmountCents: toInteger(item.effectiveAmountCents),
    refundAmountCents: toInteger(item.refundAmountCents),
    actorName: item.actorNameSnapshot || null,
    actorRole: item.actorRoleSnapshot || null,
    reason: item.reason || null,
    createdAt: toIsoString(item.createdAt),
  }));
}

function summarizeText(value: unknown, maxLength: number) {
  const text = normalizeOptionalString(value);
  if (!text) {
    return null;
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function toCommissionRecordDto(record: any) {
  return {
    id: record.id,
    salesOrderId: record.salesOrderId || null,
    travelGroupId: record.travelGroupId || null,
    afterSalesOrderId: record.afterSalesOrderId || null,
    commissionRuleId: record.commissionRuleId || null,
    agencyRebateRuleId: record.agencyRebateRuleId || null,
    targetType: targetTypeToApi(record.targetType),
    targetUserId: record.targetUserId || null,
    recipientType: record.recipientType
      ? String(record.recipientType).toLowerCase()
      : null,
    recipientName: record.recipientNameSnapshot || null,
    sourceType: record.sourceType
      ? String(record.sourceType).toLowerCase()
      : null,
    agencyId: record.agencyId || null,
    agencyName: record.agencyName || null,
    grossAmountCents: toInteger(record.grossAmountCents),
    confirmedRefundAmountCents: toInteger(
      record.confirmedRefundAmountCents,
    ),
    baseAmountCents: toInteger(record.baseAmountCents),
    deductionAmountCents: toInteger(record.deductionAmountCents),
    rateSnapshot: normalizeNullableRate(record.rateSnapshot),
    amountCents: toInteger(record.amountCents),
    originalAmountCents: toInteger(
      record.originalAmountCents ?? record.amountCents,
    ),
    adjustmentAmountCents: toInteger(record.adjustmentAmountCents),
    attributionDate: toDateOnly(record.attributionDate),
    isActive: record.isActive !== false,
    manualVersion: toInteger(record.manualVersion),
    adjustments: summarizeCommissionAdjustments(record.adjustments),
    pointsCents: toInteger(record.pointsCents),
    manualInput: Boolean(record.manualInput),
    isConfirmed: Boolean(record.isConfirmed),
    confirmedById: record.confirmedById || null,
    confirmedAt: toIsoString(record.confirmedAt),
    calculationVersion: record.calculationVersion || null,
    calculationNote: record.calculationNote || null,
    ruleSnapshot: record.ruleSnapshot || null,
    sourceSnapshot: record.sourceSnapshot || null,
    createdById: record.createdById || null,
    updatedById: record.updatedById || null,
    createdAt: toIsoString(record.createdAt),
    updatedAt: toIsoString(record.updatedAt),
  };
}

function assertTasterManualRecord(record: any) {
  if (
    normalizeTargetType(record.targetType) !== TASTER_COMMISSION_TARGET_TYPE ||
    !record.manualInput
  ) {
    throw createHttpError(
      400,
      'COMMISSION_RECORD_NOT_TASTER_MANUAL',
      'Only manual taster commission records can be changed here.',
    );
  }
}

function assertTasterManualPayloadMatchesOrder(payload: any, context: any) {
  const payloadSalesOrderId = normalizeOptionalString(payload?.salesOrderId);
  if (
    payloadSalesOrderId &&
    payloadSalesOrderId !== context.salesOrder.id
  ) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'salesOrderId does not match the commission record order.',
    );
  }
  const payloadTravelGroupId = normalizeOptionalString(payload?.travelGroupId);
  if (
    payloadTravelGroupId &&
    payloadTravelGroupId !== context.travelGroup.id
  ) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'travelGroupId does not match the sales order travel group.',
    );
  }
  const payloadTasterId = normalizeOptionalString(payload?.tasterId);
  if (payloadTasterId && payloadTasterId !== context.taster.id) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'tasterId does not match the travel group taster.',
    );
  }
}

function assertTasterManualRecordMatchesOrder(record: any, context: any) {
  if (
    record.salesOrderId !== context.salesOrder.id ||
    record.travelGroupId !== context.travelGroup.id ||
    record.targetUserId !== context.taster.id
  ) {
    throw createHttpError(
      409,
      'COMMISSION_RECORD_ORDER_MISMATCH',
      'Commission record is not the manual taster commission for this sales order.',
    );
  }
}

function isOrderTasterManualUniqueConstraintError(error: unknown) {
  if (!error || typeof error !== 'object' || (error as any).code !== 'P2002') {
    return false;
  }
  const target = (error as any).meta?.target;
  const targetText = Array.isArray(target) ? target.join(',') : String(target || '');
  return (
    targetText.includes('salesOrderId') ||
    targetText.includes('sales_order_id') ||
    targetText.includes('commission_records_order_target_user_manual_key')
  );
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

function normalizeRequiredString(value: unknown, fieldName: string) {
  const text = typeof value === 'string' ? value.trim() : String(value || '').trim();
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

function normalizeCommissionTargetTypeFilter(value: unknown) {
  const text = normalizeOptionalString(value);
  if (!text) {
    return null;
  }
  const targetType = text.toUpperCase();
  if (!COMMISSION_TARGET_TYPES.includes(targetType)) {
    throw createHttpError(
      400,
      'INVALID_COMMISSION_TARGET_TYPE',
      'targetType is invalid.',
    );
  }
  return targetType;
}

function normalizeOptionalBooleanFilter(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(text)) {
    return true;
  }
  if (['false', '0', 'no'].includes(text)) {
    return false;
  }
  throw createHttpError(
    400,
    'VALIDATION_FAILED',
    `${fieldName} must be a boolean.`,
  );
}

function normalizeTake(value: unknown, fallback = 50, max = 200) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const numberValue = Number(value);
  if (
    !Number.isFinite(numberValue) ||
    !Number.isInteger(numberValue) ||
    numberValue < 1
  ) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'limit must be a positive integer.',
    );
  }
  return Math.min(numberValue, max);
}

function normalizeExportLimit(value: unknown, max: number) {
  if (value === undefined || value === null || value === '') {
    return max;
  }
  const numberValue = Number(value);
  if (
    !Number.isFinite(numberValue) ||
    !Number.isInteger(numberValue) ||
    numberValue < 1
  ) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'limit must be a positive integer.',
    );
  }
  return Math.min(numberValue, max);
}

function buildDateRange(dateFrom: unknown, dateTo: unknown) {
  const from = parseDateBound(dateFrom, 'dateFrom', false);
  const to = parseDateBound(dateTo, 'dateTo', true);
  if (!from && !to) {
    return null;
  }
  if (from && to && from.getTime() > to.getTime()) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'dateTo cannot be earlier than dateFrom.',
    );
  }
  return {
    ...(from ? { gte: from } : {}),
    ...(to ? { lte: to } : {}),
  };
}

function parseDateBound(value: unknown, fieldName: string, endOfDay: boolean) {
  const text = normalizeOptionalString(value);
  if (!text) {
    return null;
  }
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const date = new Date(
    isDateOnly
      ? `${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
      : text,
  );
  if (Number.isNaN(date.getTime())) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be a valid date.`,
    );
  }
  return date;
}

function andWhere(...clauses: any[]) {
  const active = clauses.filter(
    (clause) => clause && Object.keys(clause).length > 0,
  );
  if (active.length === 0) {
    return {};
  }
  if (active.length === 1) {
    return active[0];
  }
  return {
    AND: active,
  };
}

function uniqueStrings(values: any[]) {
  return Array.from(
    new Set(
      (values || [])
        .map((value) => normalizeOptionalString(value))
        .filter(Boolean),
    ),
  );
}

function normalizeNonNegativeInteger(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === '') {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} is required.`,
    );
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || !Number.isInteger(numberValue)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be an integer.`,
    );
  }
  if (numberValue < 0) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} cannot be negative.`,
    );
  }
  if (numberValue > 2147483647) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} exceeds the supported amount range.`,
    );
  }
  return numberValue;
}

function normalizeRequiredBoolean(value: unknown, fieldName: string) {
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

function normalizeTargetType(value: unknown) {
  return String(value || '').trim().toUpperCase();
}

function targetTypeToApi(value: unknown) {
  const text = normalizeTargetType(value);
  return text ? text.toLowerCase() : null;
}

function targetStatusToApi(value: unknown) {
  const text = normalizeOptionalString(value);
  return text ? text.toLowerCase() : null;
}

function centsToYuanNumber(value: unknown) {
  return Number((toInteger(value) / 100).toFixed(2));
}

function booleanLabel(value: unknown) {
  return value ? '是' : '否';
}

function normalizeRole(value: unknown) {
  const text = String(value || '').trim();
  const map: Record<string, string> = {
    ADMIN: 'admin',
    BOSS: 'boss',
    FRONT_DESK: 'front_desk',
    SALES: 'sales',
    FINANCE: 'finance',
    WAREHOUSE: 'warehouse',
    AFTER_SALES: 'after_sales',
    TASTER: 'taster',
  };
  return map[text] || text.toLowerCase();
}

function isCommissionEligibleSalesOrder(order: any) {
  if (String(order?.orderType || '').toUpperCase() === 'BUYBACK') {
    return false;
  }
  const workflowStatus = String(order?.workflowStatus || '').toUpperCase();
  return (
    !workflowStatus ||
    workflowStatus === 'APPROVED' ||
    workflowStatus === 'COMPLETED'
  );
}

async function findActiveSalesAssignee(
  prisma: any,
  id: string,
  fieldName: string,
) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw createHttpError(
      404,
      'ASSIGNEE_NOT_FOUND',
      `${fieldName} does not reference an existing user.`,
    );
  }
  if (!user.isActive || String(user.role).toUpperCase() !== 'SALES') {
    throw createHttpError(
      400,
      'INVALID_ASSIGNEE',
      `${fieldName} must reference an active sales user.`,
    );
  }
  return user;
}

function activeEmployeeRuleTargetsForDate(rules: any[], value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  const time = date.getTime();
  return new Set(
    (Array.isArray(rules) ? rules : [])
      .filter((rule: any) => {
        const from = new Date(rule.effectiveFrom).getTime();
        const to = rule.effectiveTo
          ? new Date(rule.effectiveTo).getTime()
          : Number.POSITIVE_INFINITY;
        return Boolean(rule.isActive ?? true) && from <= time && time <= to;
      })
      .map((rule: any) => String(rule.targetType).toUpperCase()),
  );
}

function normalizeNullableRate(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const text =
    value && typeof value === 'object' && 'toString' in value
      ? (value as any).toString()
      : String(value);
  const numberValue = Number(text);
  return Number.isFinite(numberValue) ? numberValue.toFixed(4) : null;
}

function isRateLike(value: any) {
  if (value === undefined || value === null) {
    return false;
  }
  if (value instanceof Date || Array.isArray(value)) {
    return false;
  }
  if (typeof value === 'number') {
    return true;
  }
  if (typeof value === 'string') {
    return /^-?\d+(\.\d+)?$/.test(value.trim());
  }
  if (typeof value === 'object' && typeof value.toString === 'function') {
    const text = value.toString();
    return (
      value.toString !== Object.prototype.toString &&
      /^-?\d+(\.\d+)?$/.test(text)
    );
  }
  return false;
}

function isObjectLike(value: any) {
  return value !== null && typeof value === 'object' && !(value instanceof Date);
}

function isPlainObject(value: any) {
  return isObjectLike(value) && !Array.isArray(value);
}

function scrubSensitiveJson(value: any): any {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubSensitiveJson(item));
  }
  if (!isPlainObject(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isSensitiveSnapshotKey(key))
      .map(([key, nestedValue]) => [key, scrubSensitiveJson(nestedValue)]),
  );
}

function isSensitiveSnapshotKey(key: string) {
  return /password|token|secret|credential|phone|address/i.test(key);
}

function summarizeExportFilters(filters: any) {
  const result: any = {};
  for (const [key, value] of Object.entries(filters || {})) {
    if (isSensitiveExportFilterKey(key)) {
      continue;
    }
    if (value === undefined || value === null || value === '') {
      continue;
    }
    result[key] = String(value).slice(0, 200);
  }
  return result;
}

function isSensitiveExportFilterKey(key: string) {
  return /password|token|secret|credential|connection|database|dsn|url/i.test(
    key,
  );
}

function buildCommissionRecordsExportFileName(date = new Date()) {
  return `commission-records-${formatFileNameTimestamp(date)}.xlsx`;
}

function formatFileNameTimestamp(date: Date) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  const second = pad2(date.getSeconds());
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function stableStringify(value: any) {
  if (!isObjectLike(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function normalizeDateString(value: any) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value ? String(value) : null;
}

function toIsoString(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value ? String(value) : null;
}

function toDateOnly(value: unknown) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value).slice(0, 10)
    : date.toISOString().slice(0, 10);
}

function toInteger(value: unknown) {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : 0;
}

export const COMMISSION_RECORD_AUTO_TARGET_TYPES = AUTO_TARGET_TYPES;
