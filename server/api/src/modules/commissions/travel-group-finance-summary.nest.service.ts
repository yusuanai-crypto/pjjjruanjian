import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildGlobalTravelGroupMarkScope as buildSharedGlobalTravelGroupMarkScope,
} from '../analytics/analytics-scope.helper';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import { SettingsNestService } from '../settings/settings.nest.service';
import {
  allocateCentsByPersonalRatio,
  calculateSalesOrderPointsSplit,
} from './commission-calculation.helper';

const CALCULATION_VERSION = 'stage7_v2_personal_split';
const AGENCY_DAILY_REBATE = 'AGENCY_DAILY_REBATE';
const AGENCY_MONTHLY_REBATE = 'AGENCY_MONTHLY_REBATE';
const READ_SUMMARY_ROLES = ['admin', 'finance', 'boss'];
const WRITE_SUMMARY_ROLES = ['admin', 'finance'];
const TRAVEL_GROUP_FINANCE_SUMMARY_EXPORT_MAX_ROWS = 5000;
const FINANCE_ROW_FETCH_MAX_ROWS =
  TRAVEL_GROUP_FINANCE_SUMMARY_EXPORT_MAX_ROWS + 1;
const SELECTED_TRAVEL_GROUP_FINANCE_SUMMARY_EXPORT_MAX_ROWS = 200;

@Injectable()
export class TravelGroupFinanceSummaryNestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsNestService,
    private readonly settingsService?: SettingsNestService,
  ) {}

  async listTravelGroupFinanceSummaries(actor: any, filters: any = {}) {
    requireAnyRole(actor, READ_SUMMARY_ROLES);
    return this.findTravelGroupFinanceSummaryRows(filters);
  }

  private async findTravelGroupFinanceSummaryRows(
    filters: any,
    maxRows = 200,
  ) {
    const travelGroups = await this.prisma.travelGroup.findMany({
      where: await this.buildTravelGroupQueryWhere(filters),
      include: getTravelGroupWithFinanceSummaryInclude(),
      orderBy: [
        {
          visitDate: 'desc',
        },
        {
          groupNo: 'asc',
        },
      ],
      take: normalizeTake(filters?.limit, 50, maxRows),
    });
    return travelGroups.map((travelGroup: any) =>
      toTravelGroupFinanceSummaryListDto(
        buildDisplayFinanceSummary(travelGroup),
      ),
    );
  }

  async listFinanceRows(actor: any, filters: any = {}) {
    requireAnyRole(actor, READ_SUMMARY_ROLES);
    const take = normalizeTake(
      filters?.limit,
      50,
      FINANCE_ROW_FETCH_MAX_ROWS,
    );
    const originalRows = (
      await this.findTravelGroupFinanceSummaryRows(
        {
          ...filters,
          limit: take,
        },
        FINANCE_ROW_FETCH_MAX_ROWS,
      )
    ).map(toTravelGroupSummaryFinanceRowDto);
    const afterSalesWhere = await this.buildAfterSalesFinanceRowWhere(
      filters,
    );
    const afterSalesOrders = await this.prisma.afterSalesOrder.findMany({
      where: afterSalesWhere,
      include: {
        salesOrder: {
          include: {
            travelGroup: true,
          },
        },
        afterSalesSalesOrder: true,
      },
      orderBy: [
        {
          afterSalesSalesOrder: {
            orderDate: 'desc',
          },
        },
        {
          createdAt: 'desc',
        },
      ],
      take,
    });
    return [
      ...originalRows,
      ...afterSalesOrders.map(toAfterSalesFinanceRowDto),
    ]
      .sort(compareFinanceRows)
      .slice(0, take);
  }

  async exportFinanceRowsXlsx(
    actor: any,
    filters: any = {},
    metadata: any = {},
  ) {
    requireAnyRole(actor, READ_SUMMARY_ROLES);
    const limit = normalizeExportLimit(
      filters?.limit,
      TRAVEL_GROUP_FINANCE_SUMMARY_EXPORT_MAX_ROWS,
    );
    const rows = await this.listFinanceRows(actor, {
      ...filters,
      limit: limit + 1,
    });
    if (rows.length > limit) {
      throw createHttpError(
        400,
        'EXPORT_LIMIT_EXCEEDED',
        `Finance row export exceeds ${limit} rows. Please narrow filters.`,
      );
    }
    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'finance_rows.export',
      entityType: 'finance_row',
      entityId: 'finance_rows.export',
      beforeData: null,
      afterData: {
        filters: summarizeExportFilters(filters),
        rowCount: rows.length,
      },
      ipAddress: metadata.ipAddress || null,
    });
    return buildFinanceRowsExportResult(rows);
  }

  async exportSelectedFinanceRowsXlsx(
    actor: any,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, READ_SUMMARY_ROLES);
    const financeRowIds = normalizeSelectedFinanceRowIds(
      payload?.financeRowIds,
    );
    const visibleRows = await this.listFinanceRows(actor, {
      limit: TRAVEL_GROUP_FINANCE_SUMMARY_EXPORT_MAX_ROWS,
    });
    const selected = visibleRows.filter((row: any) =>
      financeRowIds.includes(row.financeRowId),
    );
    if (selected.length !== financeRowIds.length) {
      throw createHttpError(
        404,
        'FINANCE_ROW_NOT_FOUND',
        'One or more selected finance rows do not exist or are not visible.',
      );
    }
    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'finance_rows.export_selected',
      entityType: 'finance_row',
      entityId: 'finance_rows.export_selected',
      beforeData: null,
      afterData: {
        financeRowIds,
        rowCount: selected.length,
      },
      ipAddress: metadata.ipAddress || null,
    });
    return buildFinanceRowsExportResult(selected);
  }

  async getTravelGroupFinanceSummary(actor: any, travelGroupId: string) {
    requireAnyRole(actor, READ_SUMMARY_ROLES);
    const travelGroup =
      await this.findTravelGroupWithSummaryVisibleForApi(travelGroupId);
    return toTravelGroupFinanceSummaryDetailDto(
      buildDisplayFinanceSummary(travelGroup),
    );
  }

  async exportTravelGroupFinanceSummariesXlsx(
    actor: any,
    filters: any = {},
    metadata: any = {},
  ) {
    requireAnyRole(actor, READ_SUMMARY_ROLES);
    const exportLimit = normalizeExportLimit(
      filters?.limit,
      TRAVEL_GROUP_FINANCE_SUMMARY_EXPORT_MAX_ROWS,
    );
    const travelGroups = await this.prisma.travelGroup.findMany({
      where: await this.buildTravelGroupQueryWhere(filters),
      include: getTravelGroupWithFinanceSummaryInclude(),
      orderBy: [
        {
          visitDate: 'desc',
        },
        {
          groupNo: 'asc',
        },
      ],
      take: exportLimit + 1,
    });
    if (travelGroups.length > exportLimit) {
      throw createHttpError(
        400,
        'EXPORT_LIMIT_EXCEEDED',
        `Travel group finance summary export exceeds ${exportLimit} rows. Please narrow filters.`,
      );
    }

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'travel_group_finance_summaries.export',
      entityType: 'travel_group_finance_summary',
      entityId: 'travel_group_finance_summaries.export',
      beforeData: null,
      afterData: {
        filters: summarizeExportFilters(filters),
        rowCount: travelGroups.length,
      },
      ipAddress: metadata.ipAddress || null,
    });

    const summaries = travelGroups.map((travelGroup: any) =>
      buildDisplayFinanceSummary(travelGroup),
    );
    const workbook =
      buildTravelGroupFinanceSummariesExportWorkbook(summaries);
    const xlsxData = await workbook.xlsx.writeBuffer();
    return {
      fileName: buildTravelGroupFinanceSummariesExportFileName(),
      buffer: Buffer.from(xlsxData as any),
      rowCount: summaries.length,
    };
  }

  async exportSelectedTravelGroupFinanceSummariesXlsx(
    actor: any,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, READ_SUMMARY_ROLES);
    const travelGroupIds = normalizeSelectedTravelGroupIds(
      payload?.travelGroupIds,
    );
    const travelGroups = await this.prisma.travelGroup.findMany({
      where: andWhere(
        {
          id: {
            in: travelGroupIds,
          },
        },
        await this.buildTravelGroupQueryWhere(),
      ),
      include: getTravelGroupWithFinanceSummaryInclude(),
      orderBy: [
        {
          visitDate: 'desc',
        },
        {
          groupNo: 'asc',
        },
      ],
    });
    const summaries = travelGroups.map((travelGroup: any) =>
      buildDisplayFinanceSummary(travelGroup),
    );

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'travel_group_finance_summaries.export_selected',
      entityType: 'travel_group_finance_summary',
      entityId: 'travel_group_finance_summaries.export_selected',
      beforeData: null,
      afterData: {
        mode: 'selected',
        selectionCount: travelGroupIds.length,
        rowCount: summaries.length,
      },
      ipAddress: metadata.ipAddress || null,
    });

    const workbook =
      buildSelectedTravelGroupFinanceSummariesExportWorkbook(summaries);
    const xlsxData = await workbook.xlsx.writeBuffer();
    return {
      fileName: buildSelectedTravelGroupFinanceSummariesExportFileName(),
      buffer: Buffer.from(xlsxData as any),
      rowCount: summaries.length,
    };
  }

  async updateTravelGroupFinanceSummary(
    actor: any,
    travelGroupId: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, WRITE_SUMMARY_ROLES);
    const current = await this.findSummaryVisibleForApi(travelGroupId);
    const data = buildTravelGroupFinanceSummaryUpdateData(
      current,
      payload,
      actor,
    );
    const updated = await this.prisma.travelGroupFinanceSummary.update({
      where: {
        id: current.id,
      },
      data,
      include: getTravelGroupFinanceSummaryDetailInclude(),
    });

    await this.syncTravelGroupCompatibilityFields(
      this.prisma,
      current.travelGroupId,
      updated,
      actor,
    );

    if (hasSummaryEditableChanged(current, updated)) {
      await this.operationLogsService.appendLog({
        userId: actor.id,
        action: 'travel_group_finance_summaries.update',
        entityType: 'travel_group_finance_summary',
        entityId: updated.id,
        beforeData: summarizeFinanceSummary(current),
        afterData: summarizeFinanceSummary(updated),
        ipAddress: metadata.ipAddress || null,
      });
    }

    return toTravelGroupFinanceSummaryDetailDto(updated);
  }

  async confirmAgencyDeduction(
    actor: any,
    travelGroupId: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, WRITE_SUMMARY_ROLES);
    const current = await this.findSummaryVisibleForApi(travelGroupId);
    const isConfirmed = normalizeRequiredBoolean(
      payload?.isConfirmed ?? payload?.confirmed ?? payload?.confirm,
      'isConfirmed',
    );
    const now = new Date();
    const updated = await this.prisma.travelGroupFinanceSummary.update({
      where: {
        id: current.id,
      },
      data: {
        agencyDeductionConfirmed: isConfirmed,
        agencyDeductionConfirmedById: isConfirmed ? actor.id : null,
        agencyDeductionConfirmedAt: isConfirmed ? now : null,
        updatedById: actor.id,
        updatedAt: now,
      },
      include: getTravelGroupFinanceSummaryDetailInclude(),
    });

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: isConfirmed
        ? 'travel_group_finance_summaries.agency_deduction_confirm.enable'
        : 'travel_group_finance_summaries.agency_deduction_confirm.disable',
      entityType: 'travel_group_finance_summary',
      entityId: updated.id,
      beforeData: summarizeFinanceSummary(current),
      afterData: summarizeFinanceSummary(updated),
      ipAddress: metadata.ipAddress || null,
    });

    return toTravelGroupFinanceSummaryDetailDto(updated);
  }

  async updateAgencyDeduction(
    actor: any,
    travelGroupId: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, WRITE_SUMMARY_ROLES);
    const current = await this.findSummaryVisibleForApi(travelGroupId);
    const totalAgencyDeductionCents = normalizeRequiredNonNegativeInteger(
      payload?.totalAgencyDeductionCents,
      'totalAgencyDeductionCents',
    );
    const effectiveSalesAmountCents = toInteger(
      current.effectiveSalesAmountCents,
    );
    if (totalAgencyDeductionCents > effectiveSalesAmountCents) {
      throw createHttpError(
        400,
        'VALIDATION_FAILED',
        'totalAgencyDeductionCents cannot exceed effectiveSalesAmountCents.',
      );
    }

    const agencyRebateRecords = await this.loadAgencyRebateRecords(
      this.prisma,
      current.travelGroupId,
    );
    const agencyRecordSummary = summarizeAgencyRebateRecords(
      agencyRebateRecords,
    );
    const rebateCalculation = buildManualAgencyRebateCalculation(
      agencyRecordSummary,
      totalAgencyDeductionCents,
    );
    const paymentState = buildRefreshRebatePaymentState({
      current,
      totalDailyRebateCents: rebateCalculation.totalDailyRebateCents,
      totalMonthlyRebateCents: rebateCalculation.totalMonthlyRebateCents,
    });
    const now = new Date();
    const amountChanged =
      toInteger(current.totalAgencyDeductionCents) !==
      totalAgencyDeductionCents;
    const nextAmounts = {
      totalAgencyDeductionCents,
      totalAgencyNetAmountCents:
        effectiveSalesAmountCents - totalAgencyDeductionCents,
      totalDailyRebateCents: rebateCalculation.totalDailyRebateCents,
      totalMonthlyRebateCents: rebateCalculation.totalMonthlyRebateCents,
      paidRebateCents: paymentState.paidRebateCents,
      unpaidRebateCents: paymentState.unpaidRebateCents,
    };
    const updated = await this.prisma.travelGroupFinanceSummary.update({
      where: {
        id: current.id,
      },
      data: {
        ...nextAmounts,
        ...(amountChanged
          ? {
              agencyDeductionConfirmed: false,
              agencyDeductionConfirmedById: null,
              agencyDeductionConfirmedAt: null,
            }
          : {}),
        sourceSnapshot: buildManualAgencyDeductionSourceSnapshot(
          current.sourceSnapshot,
          nextAmounts,
          rebateCalculation,
          paymentState.rebatePaidFacts,
          actor,
          now,
        ),
        updatedById: actor.id,
        updatedAt: now,
      },
      include: getTravelGroupFinanceSummaryDetailInclude(),
    });

    await this.syncTravelGroupCompatibilityFields(
      this.prisma,
      current.travelGroupId,
      updated,
      actor,
    );

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'travel_group_finance_summaries.agency_deduction.update',
      entityType: 'travel_group_finance_summary',
      entityId: updated.id,
      beforeData: summarizeAgencyDeductionChange(current),
      afterData: summarizeAgencyDeductionChange(updated),
      ipAddress: metadata.ipAddress || null,
    });

    return toTravelGroupFinanceSummaryDetailDto(updated);
  }

  async setRebatePaymentStatus(
    actor: any,
    travelGroupId: string,
    rebateType: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, WRITE_SUMMARY_ROLES);
    const current = await this.findSummaryVisibleForApi(travelGroupId);
    const normalizedRebateType = normalizeRebatePaymentType(rebateType);
    const isPaid = normalizeRequiredBoolean(
      payload?.isPaid ?? payload?.paid ?? payload?.confirm,
      'isPaid',
    );
    const now = new Date();
    const nextDailyPaid =
      normalizedRebateType === 'daily'
        ? isPaid
        : Boolean(current.dailyRebatePaid);
    const nextMonthlyPaid =
      normalizedRebateType === 'monthly'
        ? isPaid
        : Boolean(current.monthlyRebatePaid);
    const currentSourceSnapshot: any = current?.sourceSnapshot;
    const currentPaidFacts = isPlainObject(
      currentSourceSnapshot?.rebatePaidFacts,
    )
      ? currentSourceSnapshot.rebatePaidFacts
      : {};
    const rebatePaidFacts = {
      paidDailyRebateCents: nextDailyPaid
        ? normalizedRebateType === 'daily' && isPaid
          ? toInteger(current.totalDailyRebateCents)
          : toInteger(
              currentPaidFacts.paidDailyRebateCents ??
                current.totalDailyRebateCents,
            )
        : 0,
      paidMonthlyRebateCents: nextMonthlyPaid
        ? normalizedRebateType === 'monthly' && isPaid
          ? toInteger(current.totalMonthlyRebateCents)
          : toInteger(
              currentPaidFacts.paidMonthlyRebateCents ??
                current.totalMonthlyRebateCents,
            )
        : 0,
      dailyRebatePaid: nextDailyPaid,
      monthlyRebatePaid: nextMonthlyPaid,
      dailyRebatePaidAt:
        normalizedRebateType === 'daily'
          ? isPaid
            ? now.toISOString()
            : null
          : normalizeDateString(current.dailyRebatePaidAt),
      monthlyRebatePaidAt:
        normalizedRebateType === 'monthly'
          ? isPaid
            ? now.toISOString()
            : null
          : normalizeDateString(current.monthlyRebatePaidAt),
    };
    const paidRebateCents =
      rebatePaidFacts.paidDailyRebateCents +
      rebatePaidFacts.paidMonthlyRebateCents;
    const unpaidRebateCents =
      Math.max(
        0,
        toInteger(current.totalDailyRebateCents) -
          rebatePaidFacts.paidDailyRebateCents,
      ) +
      Math.max(
        0,
        toInteger(current.totalMonthlyRebateCents) -
          rebatePaidFacts.paidMonthlyRebateCents,
      );
    const updated = await this.prisma.travelGroupFinanceSummary.update({
      where: {
        id: current.id,
      },
      data: {
        ...(normalizedRebateType === 'daily'
          ? {
              dailyRebatePaid: isPaid,
              dailyRebatePaidById: isPaid ? actor.id : null,
              dailyRebatePaidAt: isPaid ? now : null,
            }
          : {
              monthlyRebatePaid: isPaid,
              monthlyRebatePaidById: isPaid ? actor.id : null,
              monthlyRebatePaidAt: isPaid ? now : null,
            }),
        paidRebateCents,
        unpaidRebateCents,
        sourceSnapshot: mergeRebatePaidFactsIntoSourceSnapshot(
          current.sourceSnapshot,
          rebatePaidFacts,
        ),
        updatedById: actor.id,
        updatedAt: now,
      },
      include: getTravelGroupFinanceSummaryDetailInclude(),
    });

    await this.syncTravelGroupCompatibilityFields(
      this.prisma,
      current.travelGroupId,
      updated,
      actor,
    );

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: `travel_group_finance_summaries.${normalizedRebateType}_rebate_payment.${
        isPaid ? 'enable' : 'disable'
      }`,
      entityType: 'travel_group_finance_summary',
      entityId: updated.id,
      beforeData: summarizeFinanceSummary(current),
      afterData: summarizeFinanceSummary(updated),
      ipAddress: metadata.ipAddress || null,
    });

    return toTravelGroupFinanceSummaryDetailDto(updated);
  }

  async refreshTravelGroupFinanceSummaryForApi(
    actor: any,
    travelGroupId: string,
    metadata: any = {},
  ) {
    requireAnyRole(actor, WRITE_SUMMARY_ROLES);
    await this.assertTravelGroupVisibleForApi(travelGroupId);
    const result = await this.refreshTravelGroupFinanceSummary(travelGroupId, {
      ...metadata,
      actor,
    });
    const summary = await this.findSummaryVisibleForApi(travelGroupId);
    return {
      travelGroupFinanceSummary:
        toTravelGroupFinanceSummaryDetailDto(summary),
      amountChanged: result.amountChanged,
      agencyDeductionConfirmationReset:
        result.agencyDeductionConfirmationReset,
    };
  }

  async refreshTravelGroupFinanceSummary(
    travelGroupId: string,
    options: any = {},
  ) {
    const groupId = normalizeRequiredString(travelGroupId, 'travelGroupId');
    const prisma = options.prisma || this.prisma;
    const actor = options.actor || null;

    const travelGroup = await prisma.travelGroup.findUnique({
      where: {
        id: groupId,
      },
    });
    if (!travelGroup) {
      throw createHttpError(
        404,
        'TRAVEL_GROUP_NOT_FOUND',
        'Travel group does not exist.',
      );
    }

    const [salesOrders, agencyRebateRecords, current] = await Promise.all([
      this.loadSalesOrders(prisma, groupId),
      this.loadAgencyRebateRecords(prisma, groupId),
      prisma.travelGroupFinanceSummary.findUnique({
        where: {
          travelGroupId: groupId,
        },
      }),
    ]);

    const calculation = buildTravelGroupFinanceCalculation({
      travelGroup,
      salesOrders,
      agencyRebateRecords,
      current,
    });
    const data = {
      ...calculation.summaryData,
      updatedById: actor?.id || null,
    };

    const summary = current
      ? await prisma.travelGroupFinanceSummary.update({
          where: {
            id: current.id,
          },
          data: {
            ...data,
            updatedAt: new Date(),
          },
        })
      : await prisma.travelGroupFinanceSummary.create({
          data: {
            id: crypto.randomUUID(),
            travelGroupId: groupId,
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });

    if (options.syncCompatibilityFields !== false) {
      await this.syncTravelGroupCompatibilityFields(
        prisma,
        groupId,
        summary,
        actor,
      );
    }

    if (!current || hasSummaryAmountChanged(current, summary)) {
      await this.operationLogsService.appendLog(
        {
          userId: actor?.id || null,
          action: 'travel_group_finance_summaries.refresh',
          entityType: 'travel_group_finance_summary',
          entityId: summary.id,
          beforeData: current ? summarizeFinanceSummary(current) : null,
          afterData: summarizeFinanceSummary(summary),
          ipAddress: options.ipAddress || null,
        },
        prisma,
      );
    }

    return {
      travelGroupId: groupId,
      summary: toTravelGroupFinanceSummaryDto(summary),
      amountChanged: current ? hasSummaryAmountChanged(current, summary) : true,
      agencyDeductionConfirmationReset:
        Boolean(current?.agencyDeductionConfirmed) &&
        !summary.agencyDeductionConfirmed,
      sourceSnapshot: summary.sourceSnapshot || null,
    };
  }

  async getRecalculatedTravelGroupFinanceSummary(travelGroupId: string) {
    const groupId = normalizeRequiredString(travelGroupId, 'travelGroupId');
    const summary = await this.prisma.travelGroupFinanceSummary.findUnique({
      where: {
        travelGroupId: groupId,
      },
      include: getTravelGroupFinanceSummaryDetailInclude(),
    });
    if (!summary) {
      throw createHttpError(
        404,
        'TRAVEL_GROUP_FINANCE_SUMMARY_NOT_FOUND',
        'Travel group finance summary does not exist.',
      );
    }
    return toTravelGroupFinanceSummaryDetailDto(summary);
  }

  private loadSalesOrders(prisma: any, travelGroupId: string) {
    return prisma.salesOrder.findMany({
      where: {
        travelGroupId,
        orderType: {
          notIn: ['AFTER_SALES', 'BUYBACK'],
        },
        OR: [
          { workflowStatus: null },
          { workflowStatus: { in: ['APPROVED', 'COMPLETED'] } },
        ],
      },
      include: {
        items: {
          orderBy: {
            sortOrder: 'asc',
          },
        },
        paymentDetails: {
          select: {
            amountCents: true,
            paymentMethodCategorySnapshot: true,
          },
          orderBy: {
            sortOrder: 'asc',
          },
        },
        afterSalesOrders: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
      orderBy: {
        orderDate: 'asc',
      },
    });
  }

  private loadAgencyRebateRecords(prisma: any, travelGroupId: string) {
    return prisma.commissionRecord.findMany({
      where: {
        travelGroupId,
        afterSalesOrderId: null,
        targetType: {
          in: [AGENCY_DAILY_REBATE, AGENCY_MONTHLY_REBATE],
        },
        isActive: { not: false },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  private async syncTravelGroupCompatibilityFields(
    prisma: any,
    travelGroupId: string,
    summary: any,
    actor: any,
  ) {
    // These fields are legacy compatibility fields for existing travel group
    // finance screens; TravelGroupFinanceSummary remains the stage 7 authority.
    const paymentAmounts = deriveSummaryRebatePaymentAmounts(summary);
    await prisma.travelGroup.update({
      where: {
        id: travelGroupId,
      },
      data: {
        guideInfoSent: Boolean(summary.guideInfoSent),
        travelAgencyInfoSent: Boolean(summary.travelAgencyInfoSent),
        salesAmountCents: toInteger(summary.totalSalesAmountCents),
        paidDepositCents: toInteger(summary.totalPaidDepositCents),
        cashOnDeliveryCents: toInteger(summary.totalCashOnDeliveryCents),
        points:
          toInteger(summary.totalDailyRebateCents) +
          toInteger(summary.totalMonthlyRebateCents),
        returnedPoints: paymentAmounts.paidRebateCents,
        unreturnedPoints: paymentAmounts.unpaidRebateCents,
        liquorCostDeductionCents: toInteger(
          summary.totalAgencyDeductionCents,
        ),
        orderAmountCents: toInteger(summary.totalAgencyNetAmountCents),
        updatedById: actor?.id || null,
      },
    });
  }

  private async buildTravelGroupQueryWhere(filters: any = {}) {
    const clauses: any[] = [
      (await this.buildGlobalGroupMarkScope()) || {},
    ];

    const travelGroupId = normalizeOptionalString(filters?.travelGroupId);
    if (travelGroupId) {
      clauses.push({ id: travelGroupId });
    }

    const agencyDeductionConfirmed = normalizeOptionalBooleanFilter(
      filters?.agencyDeductionConfirmed,
      'agencyDeductionConfirmed',
    );
    if (agencyDeductionConfirmed === true) {
      clauses.push({
        financeSummary: {
          is: {
            agencyDeductionConfirmed: true,
          },
        },
      });
    } else if (agencyDeductionConfirmed === false) {
      clauses.push({
        OR: [
          {
            financeSummary: {
              is: null,
            },
          },
          {
            financeSummary: {
              is: {
                agencyDeductionConfirmed: false,
              },
            },
          },
        ],
      });
    }

    const dateRange = buildDateRange(filters?.dateFrom, filters?.dateTo);
    if (dateRange) {
      clauses.push({
        visitDate: dateRange,
      });
    }

    const agencyName = normalizeOptionalString(filters?.agencyName);
    if (agencyName) {
      clauses.push({
        travelAgency: {
          contains: agencyName,
        },
      });
    }

    const guideName = normalizeOptionalString(filters?.guideName);
    if (guideName) {
      clauses.push({
        guideName: {
          contains: guideName,
        },
      });
    }

    const query = normalizeOptionalString(filters?.query);
    if (query) {
      clauses.push(buildTravelGroupSummarySearchWhere(query));
    }

    return andWhere(...clauses);
  }

  private async buildAfterSalesFinanceRowWhere(filters: any = {}) {
    const travelGroupClauses: any[] = [
      (await this.buildGlobalGroupMarkScope()) || {},
    ];
    const travelGroupId = normalizeOptionalString(filters?.travelGroupId);
    if (travelGroupId) {
      travelGroupClauses.push({
        id: travelGroupId,
      });
    }
    const agencyName = normalizeOptionalString(filters?.agencyName);
    if (agencyName) {
      travelGroupClauses.push({
        travelAgency: {
          contains: agencyName,
        },
      });
    }
    const guideName = normalizeOptionalString(filters?.guideName);
    if (guideName) {
      travelGroupClauses.push({
        guideName: {
          contains: guideName,
        },
      });
    }

    const clauses: any[] = [
      {
        salesOrder: {
          is: {
            travelGroup: {
              is: andWhere(...travelGroupClauses),
            },
          },
        },
      },
    ];
    const dateRange = buildDateRange(filters?.dateFrom, filters?.dateTo);
    if (dateRange) {
      clauses.push({
        afterSalesSalesOrder: {
          is: {
            orderDate: dateRange,
          },
        },
      });
    }
    const query = normalizeOptionalString(filters?.query);
    if (query) {
      clauses.push({
        OR: [
          {
            afterSalesNo: {
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
                travelGroup: {
                  is: {
                    groupNo: {
                      contains: query,
                    },
                  },
                },
              },
            },
          },
        ],
      });
    }
    return andWhere(...clauses);
  }

  private async findTravelGroupWithSummaryVisibleForApi(
    travelGroupId: string,
  ) {
    const groupId = normalizeRequiredString(travelGroupId, 'travelGroupId');
    const travelGroup = await this.prisma.travelGroup.findUnique({
      where: {
        id: groupId,
      },
      include: getTravelGroupWithFinanceSummaryInclude(),
    });
    if (
      !travelGroup ||
      ((await this.onlyShowMarkedRecords()) && !travelGroup.financeMark)
    ) {
      throw createHttpError(
        404,
        'TRAVEL_GROUP_NOT_FOUND',
        'Travel group does not exist.',
      );
    }
    return travelGroup;
  }

  private async findSummaryVisibleForApi(travelGroupId: string) {
    const groupId = normalizeRequiredString(travelGroupId, 'travelGroupId');
    const summary = await this.prisma.travelGroupFinanceSummary.findFirst({
      where: andWhere(
        {
          travelGroupId: groupId,
        },
        {
          travelGroup: {
            is: (await this.buildGlobalGroupMarkScope()) || {},
          },
        },
      ),
      include: getTravelGroupFinanceSummaryDetailInclude(),
    });
    if (!summary) {
      throw createHttpError(
        404,
        'TRAVEL_GROUP_FINANCE_SUMMARY_NOT_FOUND',
        'Travel group finance summary does not exist.',
      );
    }
    return summary;
  }

  private async assertTravelGroupVisibleForApi(travelGroupId: string) {
    const groupId = normalizeRequiredString(travelGroupId, 'travelGroupId');
    const travelGroup = await this.prisma.travelGroup.findUnique({
      where: {
        id: groupId,
      },
    });
    if (
      !travelGroup ||
      ((await this.onlyShowMarkedRecords()) && !travelGroup.financeMark)
    ) {
      throw createHttpError(
        404,
        'TRAVEL_GROUP_NOT_FOUND',
        'Travel group does not exist.',
      );
    }
    return travelGroup;
  }

  private async buildGlobalGroupMarkScope() {
    return buildSharedGlobalTravelGroupMarkScope(
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
}

export function buildTravelGroupFinanceCalculation(input: {
  travelGroup: any;
  salesOrders: any[];
  agencyRebateRecords: any[];
  current: any;
}) {
  const salesOrders = (input.salesOrders || []).filter(
    isTravelAgencyPointsOrder,
  );
  const travelAgencyOrderIds = new Set(
    salesOrders
      .map((order: any) => normalizeOptionalString(order?.id))
      .filter(Boolean),
  );
  const agencyRebateRecords = (input.agencyRebateRecords || []).filter(
    (record: any) => {
      const salesOrderId = normalizeOptionalString(record?.salesOrderId);
      return !salesOrderId || travelAgencyOrderIds.has(salesOrderId);
    },
  );
  const orderSummaries = salesOrders.map(summarizeSalesOrderForFinance);
  const agencyRecordSummary = summarizeAgencyRebateRecords(
    agencyRebateRecords,
  );
  const totalSalesAmountCents = sumBy(orderSummaries, 'totalAmountCents');
  const totalCashOnDeliveryCents = sumBy(
    orderSummaries,
    'cashOnDeliveryAmountCents',
  );
  const totalPaidDepositCents =
    totalSalesAmountCents - totalCashOnDeliveryCents;
  const manualAgencyDeduction =
    salesOrders.length > 0 ? getManualAgencyDeduction(input.current) : null;
  const totalAgencyDeductionCents = manualAgencyDeduction
    ? toInteger(input.current.totalAgencyDeductionCents)
    : agencyRecordSummary.totalAgencyDeductionCents;
  const manualRebateCalculation = manualAgencyDeduction
    ? buildManualAgencyRebateCalculation(
        agencyRecordSummary,
        totalAgencyDeductionCents,
      )
    : null;
  const totalDailyRebateCents = manualRebateCalculation
    ? manualRebateCalculation.totalDailyRebateCents
    : sumBy(agencyRecordSummary.dailyRecords, 'pointsCents');
  const totalMonthlyRebateCents = manualRebateCalculation
    ? manualRebateCalculation.totalMonthlyRebateCents
    : sumBy(agencyRecordSummary.monthlyRecords, 'pointsCents');
  const confirmedRefundAmountCents = sumBy(
    orderSummaries,
    'confirmedRefundAmountCents',
  );
  const effectiveSalesAmountCents = sumBy(
    orderSummaries,
    'effectiveAmountCents',
  );
  const afterSalesImpact = summarizeAfterSalesImpact(
    orderSummaries,
    input.current,
  );
  const paymentState = buildRefreshRebatePaymentState({
    current: input.current,
    totalDailyRebateCents,
    totalMonthlyRebateCents,
  });
  const nextAmounts = {
    totalSalesAmountCents,
    totalCashOnDeliveryCents,
    totalPaidDepositCents,
    confirmedRefundAmountCents,
    effectiveSalesAmountCents,
    totalAgencyDeductionCents,
    totalAgencyNetAmountCents:
      Math.max(0, effectiveSalesAmountCents - totalAgencyDeductionCents),
    totalDailyRebateCents,
    totalMonthlyRebateCents,
    paidRebateCents: paymentState.paidRebateCents,
    unpaidRebateCents: paymentState.unpaidRebateCents,
  };
  const shouldResetAgencyDeductionConfirmation =
    Boolean(input.current?.agencyDeductionConfirmed) &&
    hasSummaryAmountChanged(input.current, nextAmounts);
  const sourceSnapshot = buildSourceSnapshot({
    travelGroup: input.travelGroup,
    orderSummaries,
    agencyRecordSummary,
    amounts: nextAmounts,
    agencyDeduction: manualAgencyDeduction,
    manualRebateCalculation,
    afterSalesImpact,
    rebatePaidFacts: paymentState.rebatePaidFacts,
  });

  return {
    summaryData: {
      ...nextAmounts,
      agencyDeductionConfirmed: shouldResetAgencyDeductionConfirmation
        ? false
        : Boolean(input.current?.agencyDeductionConfirmed),
      agencyDeductionConfirmedById: shouldResetAgencyDeductionConfirmation
        ? null
        : input.current?.agencyDeductionConfirmedById || null,
      agencyDeductionConfirmedAt: shouldResetAgencyDeductionConfirmation
        ? null
        : input.current?.agencyDeductionConfirmedAt || null,
      dailyRebatePaid: Boolean(input.current?.dailyRebatePaid),
      dailyRebatePaidById: input.current?.dailyRebatePaid
        ? input.current?.dailyRebatePaidById || null
        : null,
      dailyRebatePaidAt: input.current?.dailyRebatePaid
        ? input.current?.dailyRebatePaidAt || null
        : null,
      monthlyRebatePaid: Boolean(input.current?.monthlyRebatePaid),
      monthlyRebatePaidById: input.current?.monthlyRebatePaid
        ? input.current?.monthlyRebatePaidById || null
        : null,
      monthlyRebatePaidAt: input.current?.monthlyRebatePaid
        ? input.current?.monthlyRebatePaidAt || null
        : null,
      notes: input.current?.notes || null,
      guideInfoSent: Boolean(
        input.current ? input.current.guideInfoSent : input.travelGroup?.guideInfoSent,
      ),
      travelAgencyInfoSent: Boolean(
        input.current
          ? input.current.travelAgencyInfoSent
          : input.travelGroup?.travelAgencyInfoSent,
      ),
      calculationVersion: CALCULATION_VERSION,
      sourceSnapshot,
    },
  };
}

function isTravelAgencyPointsOrder(order: any) {
  const split = calculateSalesOrderPointsSplit(order);
  return (
    !['AFTER_SALES', 'BUYBACK'].includes(
      normalizeEnumText(order?.orderType || 'TRAVEL_GROUP'),
    ) &&
    (!order?.workflowStatus ||
      ['APPROVED', 'COMPLETED'].includes(
        normalizeEnumText(order.workflowStatus),
      )) &&
    split.normalAmountCents > 0
  );
}

function summarizeSalesOrderForFinance(order: any) {
  const afterSalesOrders = order.afterSalesOrders || [];
  const summarizedAfterSalesOrders = afterSalesOrders.map(summarizeRefund);
  const confirmedRefunds = afterSalesOrders
    .filter(
      (item: any) =>
        item.financeConfirmed && toInteger(item.refundAmountCents) > 0,
    )
    .map(summarizeRefund);
  const unconfirmedRefunds = afterSalesOrders
    .filter((item: any) => !item.financeConfirmed && toInteger(item.refundAmountCents) > 0)
    .map(summarizeRefund);
  const split = calculateSalesOrderPointsSplit(order);
  const totalAmountCents = split.normalAmountCents;
  const cashOnDeliveryAmountCents = allocateCentsByPersonalRatio(
    getSalesOrderCollectOnDeliveryAmountCents(order),
    split.totalAmountCents,
    split.personalAmountCents,
  ).normalAmountCents;

  return {
    id: order.id,
    orderNo: order.orderNo || null,
    orderDate: normalizeDateString(order.orderDate),
    status: normalizeEnumText(order.status),
    orderTotalAmountCents: split.totalAmountCents,
    personalAmountCents: split.personalAmountCents,
    normalAmountCents: split.normalAmountCents,
    totalAmountCents,
    cashOnDeliveryAmountCents,
    paidDepositCents: totalAmountCents - cashOnDeliveryAmountCents,
    confirmedRefundAmountCents: split.normalRefundAmountCents,
    personalRefundAmountCents: split.personalRefundAmountCents,
    normalRefundAmountCents: split.normalRefundAmountCents,
    personalEffectiveAmountCents: split.personalEffectiveAmountCents,
    normalEffectiveAmountCents: split.normalEffectiveAmountCents,
    effectiveAmountCents: isFullyRefundedOrCancelled(order.status)
      ? 0
      : split.normalEffectiveAmountCents,
    afterSalesOrders: summarizedAfterSalesOrders,
    confirmedRefunds,
    unconfirmedRefundSummary: {
      count: unconfirmedRefunds.length,
      refundAmountCents: sumBy(unconfirmedRefunds, 'refundAmountCents'),
      refunds: unconfirmedRefunds,
    },
    items: (order.items || []).map((item: any) => ({
      id: item.id,
      productName: item.productName || null,
      quantity: toInteger(item.quantity),
      unitPriceCents: toInteger(item.unitPriceCents),
      subtotalCents: toInteger(item.subtotalCents),
      sortOrder: toInteger(item.sortOrder),
    })),
  };
}

function getSalesOrderCollectOnDeliveryAmountCents(order: any) {
  const paymentDetails = Array.isArray(order?.paymentDetails)
    ? order.paymentDetails
    : [];
  if (paymentDetails.length === 0) {
    return toInteger(order?.cashOnDeliveryAmountCents);
  }
  return paymentDetails
    .filter((detail: any) =>
      isCollectOnDeliveryPaymentCategory(
        detail?.paymentMethodCategorySnapshot,
      ),
    )
    .reduce(
      (sum: number, detail: any) => sum + toInteger(detail?.amountCents),
      0,
    );
}

function isCollectOnDeliveryPaymentCategory(value: unknown) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return (
    normalized === 'collect_on_delivery' ||
    normalized === 'agency_collection'
  );
}

function summarizeRefund(afterSalesOrder: any) {
  return {
    id: afterSalesOrder.id,
    afterSalesNo: afterSalesOrder.afterSalesNo || null,
    actionType: normalizeEnumText(afterSalesOrder.actionType),
    status: normalizeEnumText(afterSalesOrder.status),
    refundAmountCents: toInteger(afterSalesOrder.refundAmountCents),
    personalPointsRefundAmountCents: toInteger(
      afterSalesOrder.personalPointsRefundAmountCents,
    ),
    normalPointsRefundAmountCents:
      toInteger(afterSalesOrder.refundAmountCents) -
      toInteger(afterSalesOrder.personalPointsRefundAmountCents),
    financeConfirmed: Boolean(afterSalesOrder.financeConfirmed),
    financeConfirmedAt: normalizeDateString(
      afterSalesOrder.financeConfirmedAt,
    ),
    createdAt: normalizeDateString(afterSalesOrder.createdAt),
    updatedAt: normalizeDateString(afterSalesOrder.updatedAt),
  };
}

function summarizeAfterSalesImpact(
  orderSummaries: any[],
  currentSummary: any,
) {
  const afterSalesOrders = (orderSummaries || []).flatMap(
    (order: any) =>
      (order.afterSalesOrders || []).map((afterSalesOrder: any) => ({
        ...afterSalesOrder,
        salesOrderId: order.id || null,
      })),
  );
  const activeAfterSalesOrders = afterSalesOrders.filter(
    (order: any) => normalizeEnumText(order.status) !== 'COMPLETED',
  );
  const pendingRefunds = afterSalesOrders.filter(
    (order: any) =>
      !order.financeConfirmed && toInteger(order.refundAmountCents) > 0,
  );
  const confirmedRefunds = afterSalesOrders.filter(
    (order: any) =>
      order.financeConfirmed && toInteger(order.refundAmountCents) > 0,
  );
  const latestAfterSalesOrder = [...afterSalesOrders].sort(
    (left: any, right: any) =>
      afterSalesSortTime(right) - afterSalesSortTime(left),
  )[0] || null;
  const paidAtTimes = [
    currentSummary?.dailyRebatePaid
      ? dateTimeValue(currentSummary?.dailyRebatePaidAt)
      : null,
    currentSummary?.monthlyRebatePaid
      ? dateTimeValue(currentSummary?.monthlyRebatePaidAt)
      : null,
  ].filter((value): value is number => value !== null);
  const hasPaidRebate =
    Boolean(currentSummary?.dailyRebatePaid) ||
    Boolean(currentSummary?.monthlyRebatePaid);
  const afterPaidRefunds = afterSalesOrders.filter((order: any) => {
    if (!hasPaidRebate || toInteger(order.refundAmountCents) <= 0) {
      return false;
    }
    if (paidAtTimes.length === 0) {
      return true;
    }
    const createdAt = dateTimeValue(order.createdAt);
    return (
      createdAt !== null &&
      paidAtTimes.some((paidAt) => createdAt > paidAt)
    );
  });
  const pendingAfterSalesRefundAmountCents = sumBy(
    pendingRefunds,
    'refundAmountCents',
  );
  const afterSalesImpactStatus = afterPaidRefunds.length > 0
    ? 'after_rebate_paid_requires_finance'
    : pendingRefunds.length > 0
      ? 'refund_pending_confirmation'
      : confirmedRefunds.length > 0
        ? 'refund_adjusted'
        : afterSalesOrders.length > 0
          ? 'after_sales_processing'
          : 'none';

  return {
    afterSalesOrderIds: afterSalesOrders
      .map((order: any) => normalizeOptionalString(order.id))
      .filter(Boolean),
    activeAfterSalesOrderIds: activeAfterSalesOrders
      .map((order: any) => normalizeOptionalString(order.id))
      .filter(Boolean),
    pendingAfterSalesRefundOrderIds: pendingRefunds
      .map((order: any) => normalizeOptionalString(order.id))
      .filter(Boolean),
    confirmedAfterSalesRefundOrderIds: confirmedRefunds
      .map((order: any) => normalizeOptionalString(order.id))
      .filter(Boolean),
    afterRebatePaidAfterSalesOrderIds: afterPaidRefunds
      .map((order: any) => normalizeOptionalString(order.id))
      .filter(Boolean),
    afterSalesCount: afterSalesOrders.length,
    activeAfterSalesCount: activeAfterSalesOrders.length,
    pendingAfterSalesRefundCount: pendingRefunds.length,
    pendingAfterSalesRefundAmountCents,
    confirmedAfterSalesRefundCount: confirmedRefunds.length,
    confirmedAfterSalesRefundAmountCents: sumBy(
      confirmedRefunds,
      'refundAmountCents',
    ),
    latestAfterSalesNo: latestAfterSalesOrder?.afterSalesNo || null,
    latestAfterSalesStatus: latestAfterSalesOrder?.status || null,
    afterSalesImpactStatus,
  };
}

function afterSalesSortTime(order: any) {
  return (
    dateTimeValue(order?.updatedAt) ??
    dateTimeValue(order?.createdAt) ??
    0
  );
}

function dateTimeValue(value: unknown) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function buildRefreshRebatePaymentState(input: {
  current: any;
  totalDailyRebateCents: number;
  totalMonthlyRebateCents: number;
}) {
  const current = input.current || null;
  const existingFacts = isPlainObject(current?.sourceSnapshot?.rebatePaidFacts)
    ? current.sourceSnapshot.rebatePaidFacts
    : {};
  const dailyRebatePaid = Boolean(current?.dailyRebatePaid);
  const monthlyRebatePaid = Boolean(current?.monthlyRebatePaid);
  const paidDailyRebateCents = dailyRebatePaid
    ? resolvePreviouslyPaidRebateCents({
        snapshotAmount: existingFacts.paidDailyRebateCents,
        currentTotalAmount: current?.totalDailyRebateCents,
        currentPaidAmount: current?.paidRebateCents,
        otherRebatePaid: monthlyRebatePaid,
        nextTotalAmount: input.totalDailyRebateCents,
      })
    : 0;
  const paidMonthlyRebateCents = monthlyRebatePaid
    ? resolvePreviouslyPaidRebateCents({
        snapshotAmount: existingFacts.paidMonthlyRebateCents,
        currentTotalAmount: current?.totalMonthlyRebateCents,
        currentPaidAmount: current?.paidRebateCents,
        otherRebatePaid: dailyRebatePaid,
        nextTotalAmount: input.totalMonthlyRebateCents,
      })
    : 0;
  const unpaidDailyRebateCents = dailyRebatePaid
    ? Math.max(0, input.totalDailyRebateCents - paidDailyRebateCents)
    : input.totalDailyRebateCents;
  const unpaidMonthlyRebateCents = monthlyRebatePaid
    ? Math.max(0, input.totalMonthlyRebateCents - paidMonthlyRebateCents)
    : input.totalMonthlyRebateCents;
  return {
    paidRebateCents:
      paidDailyRebateCents + paidMonthlyRebateCents,
    unpaidRebateCents:
      unpaidDailyRebateCents + unpaidMonthlyRebateCents,
    rebatePaidFacts: {
      paidDailyRebateCents,
      paidMonthlyRebateCents,
      dailyRebatePaid,
      monthlyRebatePaid,
      dailyRebatePaidAt: normalizeDateString(current?.dailyRebatePaidAt),
      monthlyRebatePaidAt: normalizeDateString(current?.monthlyRebatePaidAt),
    },
  };
}

function resolvePreviouslyPaidRebateCents(input: {
  snapshotAmount: unknown;
  currentTotalAmount: unknown;
  currentPaidAmount: unknown;
  otherRebatePaid: boolean;
  nextTotalAmount: unknown;
}) {
  if (
    input.snapshotAmount !== undefined &&
    input.snapshotAmount !== null
  ) {
    return Math.max(0, toInteger(input.snapshotAmount));
  }
  const currentTotalAmount = Math.max(
    0,
    toInteger(input.currentTotalAmount),
  );
  if (currentTotalAmount > 0) {
    return currentTotalAmount;
  }
  const currentPaidAmount = Math.max(
    0,
    toInteger(input.currentPaidAmount),
  );
  if (!input.otherRebatePaid && currentPaidAmount > 0) {
    return currentPaidAmount;
  }
  return Math.max(0, toInteger(input.nextTotalAmount));
}

function summarizeAgencyRebateRecords(records: any[]) {
  const dailyRecords = records
    .filter((record) => normalizeEnumText(record.targetType) === AGENCY_DAILY_REBATE)
    .map(summarizeAgencyRebateRecord);
  const monthlyRecords = records
    .filter((record) => normalizeEnumText(record.targetType) === AGENCY_MONTHLY_REBATE)
    .map(summarizeAgencyRebateRecord);
  const perOrderRecords = pickOneAgencyRecordPerOrder([
    ...dailyRecords,
    ...monthlyRecords,
  ]);

  return {
    dailyRecords,
    monthlyRecords,
    perOrderRecords,
    totalAgencyDeductionCents: sumBy(perOrderRecords, 'deductionAmountCents'),
    totalAgencyNetAmountCents: sumBy(perOrderRecords, 'baseAmountCents'),
    ruleSnapshots: buildRuleSnapshotSummary([...dailyRecords, ...monthlyRecords]),
  };
}

function getManualAgencyDeduction(current: any) {
  const marker = current?.sourceSnapshot?.agencyDeduction;
  return isPlainObject(marker) && marker.mode === 'manual' ? marker : null;
}

function buildManualAgencyRebateCalculation(
  agencyRecordSummary: any,
  totalAgencyDeductionCents: number,
) {
  const daily = calculateAllocatedRebate(
    agencyRecordSummary.dailyRecords || [],
    totalAgencyDeductionCents,
  );
  const monthly = calculateAllocatedRebate(
    agencyRecordSummary.monthlyRecords || [],
    totalAgencyDeductionCents,
  );
  return {
    allocationMethod: 'gross_sales_proportional_largest_remainder',
    totalDailyRebateCents: daily.totalRebateCents,
    totalMonthlyRebateCents: monthly.totalRebateCents,
    dailyAllocations: daily.allocations,
    monthlyAllocations: monthly.allocations,
  };
}

function calculateAllocatedRebate(records: any[], deductionCents: number) {
  const candidates = (records || []).map((record: any, index: number) => ({
    record,
    index,
    effectiveAmountCents: Math.max(
      0,
      toInteger(record.grossAmountCents),
    ),
    allocatedDeductionCents: 0,
    remainder: BigInt(0),
  }));
  const totalEffectiveAmountCents = candidates.reduce(
    (total: number, item: any) => total + item.effectiveAmountCents,
    0,
  );
  const allocatableDeductionCents = Math.min(
    Math.max(0, toInteger(deductionCents)),
    totalEffectiveAmountCents,
  );

  if (totalEffectiveAmountCents > 0 && allocatableDeductionCents > 0) {
    const denominator = BigInt(totalEffectiveAmountCents);
    let allocated = 0;
    for (const item of candidates) {
      const numerator =
        BigInt(allocatableDeductionCents) * BigInt(item.effectiveAmountCents);
      item.allocatedDeductionCents = Number(numerator / denominator);
      item.remainder = numerator % denominator;
      allocated += item.allocatedDeductionCents;
    }
    let remainderCents = allocatableDeductionCents - allocated;
    const remainderOrder = [...candidates].sort((left, right) => {
      if (left.remainder !== right.remainder) {
        return left.remainder > right.remainder ? -1 : 1;
      }
      return left.index - right.index;
    });
    for (const item of remainderOrder) {
      if (remainderCents <= 0) {
        break;
      }
      if (item.allocatedDeductionCents < item.effectiveAmountCents) {
        item.allocatedDeductionCents += 1;
        remainderCents -= 1;
      }
    }
  }

  const allocations = candidates.map((item: any) => {
    const netBaseAmountCents = Math.max(
      0,
      item.effectiveAmountCents - item.allocatedDeductionCents,
    );
    return {
      recordId: item.record.id || null,
      salesOrderId: item.record.salesOrderId || null,
      effectiveAmountCents: item.effectiveAmountCents,
      allocatedDeductionCents: item.allocatedDeductionCents,
      netBaseAmountCents,
      rateSnapshot: item.record.rateSnapshot || null,
      rebateCents: multiplyCentsByRate(
        netBaseAmountCents,
        item.record.rateSnapshot,
      ),
    };
  });
  return {
    allocations,
    totalRebateCents: sumBy(allocations, 'rebateCents'),
  };
}

function buildManualAgencyDeductionSourceSnapshot(
  sourceSnapshot: any,
  amounts: any,
  rebateCalculation: any,
  rebatePaidFacts: any,
  actor: any,
  now: Date,
) {
  const current = isPlainObject(sourceSnapshot) ? sourceSnapshot : {};
  const currentAmounts = isPlainObject(current.amounts) ? current.amounts : {};
  return {
    ...current,
    agencyDeduction: {
      mode: 'manual',
      allocationMethod: rebateCalculation.allocationMethod,
      updatedById: actor.id,
      updatedAt: now.toISOString(),
    },
    manualRebateCalculation: rebateCalculation,
    rebatePaidFacts,
    amounts: {
      ...currentAmounts,
      ...amounts,
    },
  };
}

function mergeRebatePaidFactsIntoSourceSnapshot(
  sourceSnapshot: any,
  rebatePaidFacts: any,
) {
  return {
    ...(isPlainObject(sourceSnapshot) ? sourceSnapshot : {}),
    rebatePaidFacts,
  };
}

function summarizeAgencyRebateRecord(record: any) {
  return {
    id: record.id,
    salesOrderId: record.salesOrderId || null,
    travelGroupId: record.travelGroupId || null,
    targetType: normalizeEnumText(record.targetType),
    agencyRebateRuleId: record.agencyRebateRuleId || null,
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
    pointsCents: toInteger(record.pointsCents),
    grossRateRebateCents: multiplyCentsByRate(
      toInteger(record.grossAmountCents),
      record.rateSnapshot,
    ),
    calculationVersion: record.calculationVersion || null,
    ruleSnapshot: record.ruleSnapshot || null,
    sourceSnapshot: summarizeRecordSourceSnapshot(record.sourceSnapshot),
  };
}

function pickOneAgencyRecordPerOrder(records: any[]) {
  const result = new Map<string, any>();
  for (const record of records) {
    const key = record.salesOrderId || `record:${record.id}`;
    const current = result.get(key);
    if (!current || agencyRecordPriority(record) < agencyRecordPriority(current)) {
      result.set(key, record);
    }
  }
  return Array.from(result.values());
}

function agencyRecordPriority(record: any) {
  return normalizeEnumText(record.targetType) === AGENCY_DAILY_REBATE ? 0 : 1;
}

function buildRuleSnapshotSummary(records: any[]) {
  const rebateRules = uniqueById(
    records
      .map((record) => ({
        id: record.agencyRebateRuleId || null,
        agencyId: record.agencyId || null,
        agencyName: record.agencyName || null,
        targetType: record.targetType,
        rateSnapshot: record.rateSnapshot || null,
        ruleSnapshot: record.ruleSnapshot?.agencyRebateRules || null,
      }))
      .filter((rule) => rule.id || rule.agencyId || rule.agencyName),
  );
  const agencyDeductionRules = uniqueById(
    records.flatMap((record) =>
      Array.isArray(record.ruleSnapshot?.agencyDeductionRules)
        ? record.ruleSnapshot.agencyDeductionRules
        : [],
    ),
  );

  return {
    agencyRebateRules: rebateRules,
    agencyDeductionRules,
  };
}

function summarizeRecordSourceSnapshot(sourceSnapshot: any) {
  if (!sourceSnapshot || typeof sourceSnapshot !== 'object') {
    return null;
  }
  return {
    businessKey: sourceSnapshot.businessKey || null,
    travelAgencyMatch: sourceSnapshot.travelAgencyMatch || null,
    afterSalesOrderIds: sourceSnapshot.afterSalesOrderIds || [],
    confirmedRefunds: sourceSnapshot.confirmedRefunds || [],
    unconfirmedRefundSummary:
      sourceSnapshot.unconfirmedRefundSummary || null,
    salesOrder: sourceSnapshot.salesOrder || null,
  };
}

function buildSourceSnapshot(input: {
  travelGroup: any;
  orderSummaries: any[];
  agencyRecordSummary: any;
  amounts: any;
  agencyDeduction?: any;
  manualRebateCalculation?: any;
  afterSalesImpact: any;
  rebatePaidFacts: any;
}) {
  return {
    calculationVersion: CALCULATION_VERSION,
    travelGroup: {
      id: input.travelGroup.id,
      groupNo: input.travelGroup.groupNo || null,
      visitDate: normalizeDateString(input.travelGroup.visitDate),
      agencyId: resolveAgencyIdFromRecordSummary(
        input.agencyRecordSummary,
      ),
      travelAgency: normalizeNullableString(input.travelGroup.travelAgency),
      guideName: input.travelGroup.guideName || null,
      guidePhone: input.travelGroup.guidePhone || null,
      guideId: input.travelGroup.guideId || null,
      tasterId: input.travelGroup.tasterId || null,
      tasterName: input.travelGroup.tasterName || null,
      financeMark: Boolean(input.travelGroup.financeMark),
    },
    orders: input.orderSummaries,
    confirmedRefunds: input.orderSummaries.flatMap(
      (order) => order.confirmedRefunds,
    ),
    unconfirmedRefundSummary: {
      count: input.orderSummaries.reduce(
        (total, order) => total + order.unconfirmedRefundSummary.count,
        0,
      ),
      refundAmountCents: input.orderSummaries.reduce(
        (total, order) =>
          total + order.unconfirmedRefundSummary.refundAmountCents,
        0,
      ),
    },
    afterSalesOrderIds: input.afterSalesImpact.afterSalesOrderIds,
    afterSalesCount: input.afterSalesImpact.afterSalesCount,
    activeAfterSalesCount: input.afterSalesImpact.activeAfterSalesCount,
    pendingAfterSalesRefundCount:
      input.afterSalesImpact.pendingAfterSalesRefundCount,
    pendingAfterSalesRefundAmountCents:
      input.afterSalesImpact.pendingAfterSalesRefundAmountCents,
    latestAfterSalesNo: input.afterSalesImpact.latestAfterSalesNo,
    latestAfterSalesStatus: input.afterSalesImpact.latestAfterSalesStatus,
    afterSalesImpactStatus: input.afterSalesImpact.afterSalesImpactStatus,
    afterSalesImpact: input.afterSalesImpact,
    rebatePaidFacts: input.rebatePaidFacts,
    agencyRebateRecords: {
      daily: input.agencyRecordSummary.dailyRecords,
      monthly: input.agencyRecordSummary.monthlyRecords,
      perOrderForDeductionAndNet:
        input.agencyRecordSummary.perOrderRecords.map((record: any) => ({
          id: record.id,
          salesOrderId: record.salesOrderId || null,
          targetType: record.targetType,
          baseAmountCents: record.baseAmountCents,
          deductionAmountCents: record.deductionAmountCents,
        })),
    },
    ruleSummary: input.agencyRecordSummary.ruleSnapshots,
    agencyDeduction: input.agencyDeduction || null,
    manualRebateCalculation: input.manualRebateCalculation || null,
    amounts: input.amounts,
  };
}

function hasSummaryAmountChanged(before: any, after: any) {
  return SUMMARY_AMOUNT_FIELDS.some(
    (field) => toInteger(before?.[field]) !== toInteger(after?.[field]),
  );
}

const SUMMARY_AMOUNT_FIELDS = [
  'totalSalesAmountCents',
  'totalCashOnDeliveryCents',
  'totalPaidDepositCents',
  'confirmedRefundAmountCents',
  'effectiveSalesAmountCents',
  'totalAgencyDeductionCents',
  'totalAgencyNetAmountCents',
  'totalDailyRebateCents',
  'totalMonthlyRebateCents',
  'paidRebateCents',
  'unpaidRebateCents',
];

const SUMMARY_EDITABLE_FIELDS = [
  'dailyRebatePaid',
  'dailyRebatePaidById',
  'dailyRebatePaidAt',
  'monthlyRebatePaid',
  'monthlyRebatePaidById',
  'monthlyRebatePaidAt',
  'paidRebateCents',
  'unpaidRebateCents',
  'notes',
  'guideInfoSent',
  'travelAgencyInfoSent',
];

function hasSummaryEditableChanged(before: any, after: any) {
  return SUMMARY_EDITABLE_FIELDS.some(
    (field) => !valuesEqualForSummary(before?.[field], after?.[field]),
  );
}

function summarizeFinanceSummary(summary: any) {
  const paymentAmounts = deriveSummaryRebatePaymentAmounts(summary);
  const splitPaymentAmounts = deriveSummaryRebateSplitAmounts(summary);
  return {
    id: summary.id,
    travelGroupId: summary.travelGroupId,
    totalSalesAmountCents: toInteger(summary.totalSalesAmountCents),
    totalCashOnDeliveryCents: toInteger(
      summary.totalCashOnDeliveryCents,
    ),
    totalPaidDepositCents: toInteger(summary.totalPaidDepositCents),
    confirmedRefundAmountCents: toInteger(
      summary.confirmedRefundAmountCents,
    ),
    effectiveSalesAmountCents: toInteger(summary.effectiveSalesAmountCents),
    totalAgencyDeductionCents: toInteger(
      summary.totalAgencyDeductionCents,
    ),
    agencyDeductionConfirmed: Boolean(summary.agencyDeductionConfirmed),
    agencyDeductionConfirmedById:
      summary.agencyDeductionConfirmedById || null,
    agencyDeductionConfirmedAt: normalizeDateString(
      summary.agencyDeductionConfirmedAt,
    ),
    totalAgencyNetAmountCents: toInteger(summary.totalAgencyNetAmountCents),
    totalDailyRebateCents: toInteger(summary.totalDailyRebateCents),
    totalMonthlyRebateCents: toInteger(summary.totalMonthlyRebateCents),
    paidRebateCents: paymentAmounts.paidRebateCents,
    unpaidRebateCents: paymentAmounts.unpaidRebateCents,
    ...splitPaymentAmounts,
    dailyRebatePaid: Boolean(summary.dailyRebatePaid),
    dailyRebatePaidById: summary.dailyRebatePaidById || null,
    dailyRebatePaidAt: normalizeDateString(summary.dailyRebatePaidAt),
    monthlyRebatePaid: Boolean(summary.monthlyRebatePaid),
    monthlyRebatePaidById: summary.monthlyRebatePaidById || null,
    monthlyRebatePaidAt: normalizeDateString(summary.monthlyRebatePaidAt),
    notes: summary.notes || null,
    guideInfoSent: Boolean(summary.guideInfoSent),
    travelAgencyInfoSent: Boolean(summary.travelAgencyInfoSent),
    calculationVersion: summary.calculationVersion || null,
  };
}

function summarizeAgencyDeductionChange(summary: any) {
  return {
    travelGroupId: summary.travelGroupId,
    totalSalesAmountCents: toInteger(summary.totalSalesAmountCents),
    totalAgencyDeductionCents: toInteger(
      summary.totalAgencyDeductionCents,
    ),
    totalAgencyNetAmountCents: toInteger(summary.totalAgencyNetAmountCents),
    totalDailyRebateCents: toInteger(summary.totalDailyRebateCents),
    totalMonthlyRebateCents: toInteger(summary.totalMonthlyRebateCents),
    paidRebateCents: toInteger(summary.paidRebateCents),
    unpaidRebateCents: toInteger(summary.unpaidRebateCents),
    agencyDeductionConfirmed: Boolean(summary.agencyDeductionConfirmed),
    agencyDeductionConfirmedById:
      summary.agencyDeductionConfirmedById || null,
    agencyDeductionConfirmedAt: normalizeDateString(
      summary.agencyDeductionConfirmedAt,
    ),
  };
}

function getTravelGroupFinanceSummaryListInclude(): any {
  return {
    travelGroup: true,
    agencyDeductionConfirmedBy: true,
    dailyRebatePaidBy: true,
    monthlyRebatePaidBy: true,
    updatedBy: true,
  };
}

function getTravelGroupFinanceSummaryDetailInclude(): any {
  return getTravelGroupFinanceSummaryListInclude();
}

function getTravelGroupWithFinanceSummaryInclude(): any {
  return {
    financeSummary: {
      include: {
        agencyDeductionConfirmedBy: true,
        dailyRebatePaidBy: true,
        monthlyRebatePaidBy: true,
        updatedBy: true,
      },
    },
  };
}

function buildDisplayFinanceSummary(travelGroup: any) {
  const financeSummary = travelGroup?.financeSummary || null;
  if (financeSummary) {
    return {
      ...financeSummary,
      travelGroup,
      summaryExists: true,
    };
  }
  return {
    id: null,
    travelGroupId: travelGroup.id,
    travelGroup,
    totalSalesAmountCents: 0,
    totalCashOnDeliveryCents: 0,
    totalPaidDepositCents: 0,
    confirmedRefundAmountCents: 0,
    effectiveSalesAmountCents: 0,
    totalAgencyDeductionCents: 0,
    agencyDeductionConfirmed: false,
    agencyDeductionConfirmedById: null,
    agencyDeductionConfirmedBy: null,
    agencyDeductionConfirmedAt: null,
    totalAgencyNetAmountCents: 0,
    totalDailyRebateCents: 0,
    totalMonthlyRebateCents: 0,
    paidRebateCents: 0,
    unpaidRebateCents: 0,
    dailyRebatePaid: false,
    dailyRebatePaidById: null,
    dailyRebatePaidBy: null,
    dailyRebatePaidAt: null,
    monthlyRebatePaid: false,
    monthlyRebatePaidById: null,
    monthlyRebatePaidBy: null,
    monthlyRebatePaidAt: null,
    notes: null,
    guideInfoSent: false,
    travelAgencyInfoSent: false,
    calculationVersion: null,
    sourceSnapshot: null,
    updatedById: null,
    updatedBy: null,
    createdAt: null,
    updatedAt: null,
    summaryExists: false,
  };
}

const TRAVEL_GROUP_FINANCE_SUMMARY_EXPORT_COLUMNS = [
  { header: '团号', key: 'travelGroup', width: 20 },
  { header: '日期', key: 'visitDate', width: 14 },
  { header: '旅行社', key: 'travelAgency', width: 24 },
  { header: '导游', key: 'guideName', width: 16 },
  { header: '车牌', key: 'licensePlate', width: 14 },
  { header: '人数', key: 'guestCount', width: 10 },
  { header: '品鉴师', key: 'tasterName', width: 16 },
  { header: '销售额', key: 'totalSalesYuan', width: 14 },
  { header: '货到付款', key: 'cashOnDeliveryYuan', width: 14 },
  { header: '已付定金', key: 'paidDepositYuan', width: 14 },
  { header: '扣酒成本', key: 'totalAgencyDeductionYuan', width: 14 },
  { header: '扣酒确认状态', key: 'agencyDeductionConfirmed', width: 14 },
  { header: '上单金额', key: 'totalAgencyNetYuan', width: 14 },
  { header: '积分/日返积分', key: 'dailyRebateYuan', width: 16 },
  { header: '已返积分', key: 'dailyRebatePaid', width: 14 },
  { header: '未返积分', key: 'dailyUnpaidRebateYuan', width: 14 },
  { header: '月返积分', key: 'monthlyRebateYuan', width: 14 },
  { header: '已返月返积分', key: 'monthlyRebatePaid', width: 16 },
  { header: '未返月返积分', key: 'monthlyUnpaidRebateYuan', width: 16 },
  { header: '备注', key: 'notes', width: 30 },
  { header: '导游信息是否发送', key: 'guideInfoSent', width: 18 },
  { header: '旅行社信息是否发送', key: 'travelAgencyInfoSent', width: 20 },
];

const TRAVEL_GROUP_FINANCE_SUMMARY_EXPORT_AMOUNT_KEYS = new Set([
  'totalSalesYuan',
  'cashOnDeliveryYuan',
  'paidDepositYuan',
  'totalAgencyDeductionYuan',
  'totalAgencyNetYuan',
  'dailyRebateYuan',
  'dailyUnpaidRebateYuan',
  'monthlyRebateYuan',
  'monthlyUnpaidRebateYuan',
]);

function buildTravelGroupFinanceSummariesExportWorkbook(summaries: any[]) {
  return buildTravelGroupFinanceSummariesWorkbook({
    worksheetName: '返积分汇总',
    columns: TRAVEL_GROUP_FINANCE_SUMMARY_EXPORT_COLUMNS,
    amountKeys: TRAVEL_GROUP_FINANCE_SUMMARY_EXPORT_AMOUNT_KEYS,
    rows: summaries.map(toTravelGroupFinanceSummaryExportRow),
  });
}

const SELECTED_TRAVEL_GROUP_FINANCE_SUMMARY_EXPORT_COLUMNS = [
  { header: '团号', key: 'travelGroup', width: 20 },
  { header: '日期', key: 'visitDate', width: 14 },
  { header: '旅行社', key: 'travelAgency', width: 24 },
  { header: '导游', key: 'guideName', width: 16 },
  { header: '车牌', key: 'licensePlate', width: 14 },
  { header: '人数', key: 'guestCount', width: 10 },
  { header: '品鉴师', key: 'tasterName', width: 16 },
  { header: '销售额', key: 'totalSalesYuan', width: 14 },
  { header: '已确认退款', key: 'confirmedRefundYuan', width: 16 },
  { header: '有效销售额', key: 'effectiveSalesYuan', width: 16 },
  { header: '货到付款', key: 'cashOnDeliveryYuan', width: 14 },
  { header: '已付定金', key: 'paidDepositYuan', width: 14 },
  { header: '扣酒成本', key: 'totalAgencyDeductionYuan', width: 14 },
  { header: '上单金额', key: 'totalAgencyNetYuan', width: 14 },
  { header: '积分/日返积分', key: 'dailyRebateYuan', width: 16 },
  { header: '已返积分', key: 'paidDailyRebateYuan', width: 14 },
  { header: '未返积分', key: 'unpaidDailyRebateYuan', width: 14 },
  { header: '日返状态', key: 'dailyRebateStatus', width: 14 },
  { header: '月返积分', key: 'monthlyRebateYuan', width: 14 },
  { header: '已返月返积分', key: 'paidMonthlyRebateYuan', width: 16 },
  { header: '未返月返积分', key: 'unpaidMonthlyRebateYuan', width: 16 },
  { header: '月返状态', key: 'monthlyRebateStatus', width: 14 },
  { header: '售后影响', key: 'afterSalesImpact', width: 28 },
  { header: '导游信息是否发送', key: 'guideInfoSent', width: 18 },
  { header: '旅行社信息是否发送', key: 'travelAgencyInfoSent', width: 20 },
  { header: '状态', key: 'status', width: 16 },
  { header: '备注', key: 'notes', width: 30 },
];

const SELECTED_TRAVEL_GROUP_FINANCE_SUMMARY_EXPORT_AMOUNT_KEYS = new Set([
  'totalSalesYuan',
  'confirmedRefundYuan',
  'effectiveSalesYuan',
  'cashOnDeliveryYuan',
  'paidDepositYuan',
  'totalAgencyDeductionYuan',
  'totalAgencyNetYuan',
  'dailyRebateYuan',
  'paidDailyRebateYuan',
  'unpaidDailyRebateYuan',
  'monthlyRebateYuan',
  'paidMonthlyRebateYuan',
  'unpaidMonthlyRebateYuan',
]);

function buildSelectedTravelGroupFinanceSummariesExportWorkbook(
  summaries: any[],
) {
  return buildTravelGroupFinanceSummariesWorkbook({
    worksheetName: '积分表所选信息',
    columns: SELECTED_TRAVEL_GROUP_FINANCE_SUMMARY_EXPORT_COLUMNS,
    amountKeys:
      SELECTED_TRAVEL_GROUP_FINANCE_SUMMARY_EXPORT_AMOUNT_KEYS,
    rows: summaries.map(toSelectedTravelGroupFinanceSummaryExportRow),
  });
}

function buildTravelGroupFinanceSummariesWorkbook(options: {
  worksheetName: string;
  columns: any[];
  amountKeys: Set<string>;
  rows: any[];
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'jiangjiu-api';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet(options.worksheetName);
  worksheet.columns = options.columns;
  for (const column of worksheet.columns) {
    if (
      column.key &&
      options.amountKeys.has(String(column.key))
    ) {
      column.numFmt = '0.00';
    }
    column.alignment = { vertical: 'top', wrapText: true };
  }
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: {
      row: 1,
      column: options.columns.length,
    },
  };
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).alignment = {
    vertical: 'middle',
    horizontal: 'center',
  };

  for (const row of options.rows) {
    worksheet.addRow(row);
  }

  return workbook;
}

function toTravelGroupFinanceSummaryExportRow(summary: any) {
  const travelGroup = summary.travelGroup || {};
  return {
    travelGroup: travelGroup.groupNo || '',
    visitDate: toDateOnly(travelGroup.visitDate),
    travelAgency: travelGroup.travelAgency || '',
    guideName: travelGroup.guideName || '',
    licensePlate: travelGroup.licensePlate || '',
    guestCount: toInteger(travelGroup.guestCount),
    tasterName: travelGroup.tasterName || '',
    totalSalesYuan: centsToYuanNumber(summary.totalSalesAmountCents),
    cashOnDeliveryYuan: centsToYuanNumber(
      summary.totalCashOnDeliveryCents,
    ),
    paidDepositYuan: centsToYuanNumber(summary.totalPaidDepositCents),
    totalAgencyDeductionYuan: centsToYuanNumber(
      summary.totalAgencyDeductionCents,
    ),
    agencyDeductionConfirmed: booleanLabel(
      summary.agencyDeductionConfirmed,
    ),
    totalAgencyNetYuan: centsToYuanNumber(
      summary.totalAgencyNetAmountCents,
    ),
    dailyRebateYuan: centsToYuanNumber(summary.totalDailyRebateCents),
    dailyRebatePaid: booleanLabel(summary.dailyRebatePaid),
    dailyUnpaidRebateYuan: centsToYuanNumber(
      summary.dailyRebatePaid ? 0 : summary.totalDailyRebateCents,
    ),
    monthlyRebateYuan: centsToYuanNumber(summary.totalMonthlyRebateCents),
    monthlyRebatePaid: booleanLabel(summary.monthlyRebatePaid),
    monthlyUnpaidRebateYuan: centsToYuanNumber(
      summary.monthlyRebatePaid ? 0 : summary.totalMonthlyRebateCents,
    ),
    notes: summary.notes || '',
    guideInfoSent: booleanLabel(summary.guideInfoSent),
    travelAgencyInfoSent: booleanLabel(summary.travelAgencyInfoSent),
  };
}

function toSelectedTravelGroupFinanceSummaryExportRow(summary: any) {
  const travelGroup = summary.travelGroup || {};
  const splitPaymentAmounts = deriveSummaryRebateSplitAmounts(summary);
  return {
    travelGroup: travelGroup.groupNo || '',
    visitDate: toDateOnly(travelGroup.visitDate),
    travelAgency: travelGroup.travelAgency || '',
    guideName: travelGroup.guideName || '',
    licensePlate: travelGroup.licensePlate || '',
    guestCount: toInteger(travelGroup.guestCount),
    tasterName: travelGroup.tasterName || '',
    totalSalesYuan: pointsTableSourceCentsToYuanNumber(
      summary.totalSalesAmountCents,
    ),
    confirmedRefundYuan: pointsTableSourceCentsToYuanNumber(
      summary.confirmedRefundAmountCents,
    ),
    effectiveSalesYuan: pointsTableSourceCentsToYuanNumber(
      summary.effectiveSalesAmountCents,
    ),
    cashOnDeliveryYuan: pointsTableSourceCentsToYuanNumber(
      summary.totalCashOnDeliveryCents,
    ),
    paidDepositYuan: pointsTableSourceCentsToYuanNumber(
      summary.totalPaidDepositCents,
    ),
    totalAgencyDeductionYuan: pointsTableSourceCentsToYuanNumber(
      summary.totalAgencyDeductionCents,
    ),
    totalAgencyNetYuan: pointsTableSourceCentsToYuanNumber(
      summary.totalAgencyNetAmountCents,
    ),
    dailyRebateYuan: pointsTableSourceCentsToYuanNumber(
      summary.totalDailyRebateCents,
    ),
    paidDailyRebateYuan: pointsTableSourceCentsToYuanNumber(
      splitPaymentAmounts.paidDailyRebateCents,
    ),
    unpaidDailyRebateYuan: pointsTableSourceCentsToYuanNumber(
      splitPaymentAmounts.unpaidDailyRebateCents,
    ),
    dailyRebateStatus: booleanLabel(summary.dailyRebatePaid),
    monthlyRebateYuan: pointsTableSourceCentsToYuanNumber(
      summary.totalMonthlyRebateCents,
    ),
    paidMonthlyRebateYuan: pointsTableSourceCentsToYuanNumber(
      splitPaymentAmounts.paidMonthlyRebateCents,
    ),
    unpaidMonthlyRebateYuan: pointsTableSourceCentsToYuanNumber(
      splitPaymentAmounts.unpaidMonthlyRebateCents,
    ),
    monthlyRebateStatus: booleanLabel(summary.monthlyRebatePaid),
    afterSalesImpact: selectedExportAfterSalesImpactLabel(summary),
    guideInfoSent: booleanLabel(summary.guideInfoSent),
    travelAgencyInfoSent: booleanLabel(summary.travelAgencyInfoSent),
    status: selectedExportSummaryStatus(summary),
    notes: summary.notes || '',
  };
}

function buildTravelGroupSummarySearchWhere(query: string) {
  return {
    OR: [
      {
        groupNo: {
          contains: query,
        },
      },
      {
        travelAgency: {
          contains: query,
        },
      },
      {
        guideName: {
          contains: query,
        },
      },
      {
        tasterName: {
          contains: query,
        },
      },
      {
        financeSummary: {
          is: {
            notes: {
              contains: query,
            },
          },
        },
      },
    ],
  };
}

function buildTravelGroupFinanceSummaryUpdateData(
  current: any,
  payload: any,
  actor: any,
) {
  const paymentAmounts = buildRebatePaymentAmounts({
    totalDailyRebateCents: current.totalDailyRebateCents,
    totalMonthlyRebateCents: current.totalMonthlyRebateCents,
    dailyRebatePaid: current.dailyRebatePaid,
    monthlyRebatePaid: current.monthlyRebatePaid,
  });
  const data: any = {
    ...paymentAmounts,
    updatedById: actor.id,
    updatedAt: new Date(),
  };
  let hasEditableField = false;

  if (
    payload?.paidRebateCents !== undefined ||
    payload?.unpaidRebateCents !== undefined ||
    payload?.paidDailyRebateCents !== undefined ||
    payload?.unpaidDailyRebateCents !== undefined ||
    payload?.paidMonthlyRebateCents !== undefined ||
    payload?.unpaidMonthlyRebateCents !== undefined ||
    payload?.dailyRebatePaid !== undefined ||
    payload?.monthlyRebatePaid !== undefined
  ) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'Rebate payment status must be changed with the rebate payment endpoint.',
    );
  }
  if (payload?.notes !== undefined) {
    data.notes = normalizeOptionalString(payload.notes);
    hasEditableField = true;
  }
  if (payload?.guideInfoSent !== undefined) {
    data.guideInfoSent = normalizeRequiredBoolean(
      payload.guideInfoSent,
      'guideInfoSent',
    );
    hasEditableField = true;
  }
  if (payload?.travelAgencyInfoSent !== undefined) {
    data.travelAgencyInfoSent = normalizeRequiredBoolean(
      payload.travelAgencyInfoSent,
      'travelAgencyInfoSent',
    );
    hasEditableField = true;
  }
  if (!hasEditableField) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'At least one editable field is required.',
    );
  }
  return data;
}

function toTravelGroupFinanceSummaryListDto(summary: any) {
  const paymentAmounts = deriveSummaryRebatePaymentAmounts(summary);
  const splitPaymentAmounts = deriveSummaryRebateSplitAmounts(summary);
  const afterSalesImpact = readAfterSalesImpactFields(
    summary.sourceSnapshot,
  );
  return {
    id: summary.id,
    summaryExists: summary.summaryExists !== false,
    travelGroupId: summary.travelGroupId,
    travelGroup: summarizeTravelGroup(
      summary.travelGroup,
      summary.sourceSnapshot,
    ),
    totalSalesAmountCents: toInteger(summary.totalSalesAmountCents),
    totalCashOnDeliveryCents: toInteger(
      summary.totalCashOnDeliveryCents,
    ),
    totalPaidDepositCents: toInteger(summary.totalPaidDepositCents),
    confirmedRefundAmountCents: toInteger(
      summary.confirmedRefundAmountCents,
    ),
    effectiveSalesAmountCents: toInteger(summary.effectiveSalesAmountCents),
    ...afterSalesImpact,
    totalAgencyDeductionCents: toInteger(
      summary.totalAgencyDeductionCents,
    ),
    agencyDeductionConfirmed: Boolean(summary.agencyDeductionConfirmed),
    agencyDeductionConfirmedById:
      summary.agencyDeductionConfirmedById || null,
    agencyDeductionConfirmedBy: summarizePublicUser(
      summary.agencyDeductionConfirmedBy,
    ),
    agencyDeductionConfirmedAt: normalizeDateString(
      summary.agencyDeductionConfirmedAt,
    ),
    totalAgencyNetAmountCents: toInteger(summary.totalAgencyNetAmountCents),
    totalDailyRebateCents: toInteger(summary.totalDailyRebateCents),
    totalMonthlyRebateCents: toInteger(summary.totalMonthlyRebateCents),
    paidRebateCents: paymentAmounts.paidRebateCents,
    unpaidRebateCents: paymentAmounts.unpaidRebateCents,
    ...splitPaymentAmounts,
    dailyRebatePaid: Boolean(summary.dailyRebatePaid),
    dailyRebatePaidById: summary.dailyRebatePaidById || null,
    dailyRebatePaidBy: summarizePublicUser(summary.dailyRebatePaidBy),
    dailyRebatePaidAt: normalizeDateString(summary.dailyRebatePaidAt),
    monthlyRebatePaid: Boolean(summary.monthlyRebatePaid),
    monthlyRebatePaidById: summary.monthlyRebatePaidById || null,
    monthlyRebatePaidBy: summarizePublicUser(summary.monthlyRebatePaidBy),
    monthlyRebatePaidAt: normalizeDateString(summary.monthlyRebatePaidAt),
    notes: summary.notes || null,
    guideInfoSent: Boolean(summary.guideInfoSent),
    travelAgencyInfoSent: Boolean(summary.travelAgencyInfoSent),
    calculationVersion: summary.calculationVersion || null,
    updatedBy: summarizePublicUser(summary.updatedBy),
    createdAt: normalizeDateString(summary.createdAt),
    updatedAt: normalizeDateString(summary.updatedAt),
  };
}

function toTravelGroupSummaryFinanceRowDto(summary: any) {
  return {
    ...summary,
    financeRowId: `travel_group:${summary.travelGroupId}`,
    rowId: `travel_group:${summary.travelGroupId}`,
    rowKind: 'travel_group_summary',
    orderType: 'travel_group',
    afterSalesNo: null,
    sourceSalesOrderNo: null,
    afterSalesStatus: null,
    deductionCalculationMode: null,
    agencyDeductionAdjustmentCents: null,
    financialEffectStatus: null,
    financeConfirmed: true,
    financialAmountsReady: true,
    includedInFormalTotals: true,
    financeDate: summary.travelGroup?.visitDate || null,
  };
}

function toAfterSalesFinanceRowDto(order: any) {
  const sourceSalesOrder = order.salesOrder || {};
  const generatedOrder = order.afterSalesSalesOrder || {};
  const travelGroup = sourceSalesOrder.travelGroup || null;
  const refundAmountCents = Math.max(
    0,
    toInteger(order.refundAmountCents),
  );
  const deductionCents =
    order.agencyDeductionAdjustmentCents === null ||
    order.agencyDeductionAdjustmentCents === undefined
      ? null
      : Math.max(0, toInteger(order.agencyDeductionAdjustmentCents));
  const financialAmountsReady = deductionCents !== null;
  const baseAdjustmentCents = financialAmountsReady
    ? -(refundAmountCents - deductionCents)
    : 0;
  const dailyRebateCents = financialAmountsReady
    ? multiplyFinanceCentsByRate(
        baseAdjustmentCents,
        order.dailyRebateRate,
      )
    : 0;
  const monthlyRebateCents = financialAmountsReady
    ? multiplyFinanceCentsByRate(
        baseAdjustmentCents,
        order.monthlyRebateRate,
      )
    : 0;
  const financeRowId = `after_sales:${order.id}`;
  return {
    id: order.id,
    summaryExists: true,
    financeRowId,
    rowId: financeRowId,
    rowKind: 'after_sales_adjustment',
    orderType: 'after_sales',
    travelGroupId: sourceSalesOrder.travelGroupId || null,
    travelGroup: summarizeTravelGroup(travelGroup, null),
    financeDate: normalizeDateString(generatedOrder.orderDate),
    afterSalesNo: order.afterSalesNo,
    sourceSalesOrderNo: sourceSalesOrder.orderNo || null,
    afterSalesStatus: normalizeEnumText(order.status).toLowerCase(),
    deductionCalculationMode:
      order.deductionCalculationMode || 'manual_product_reference',
    agencyDeductionAdjustmentCents: deductionCents,
    sourceAgencyDeductionCents: Math.max(
      0,
      toInteger(order.sourceAgencyDeductionCents),
    ),
    financialEffectStatus: normalizeEnumText(
      order.financialEffectStatus,
    ).toLowerCase(),
    financeConfirmed: Boolean(order.financeConfirmed),
    financialAmountsReady,
    includedInFormalTotals:
      Boolean(order.financeConfirmed) && financialAmountsReady,
    totalSalesAmountCents: -refundAmountCents,
    totalCashOnDeliveryCents: 0,
    totalPaidDepositCents: -refundAmountCents,
    confirmedRefundAmountCents: order.financeConfirmed
      ? -refundAmountCents
      : 0,
    effectiveSalesAmountCents: -refundAmountCents,
    totalAgencyDeductionCents: financialAmountsReady
      ? -deductionCents
      : 0,
    agencyDeductionConfirmed:
      Boolean(order.financeConfirmed) && financialAmountsReady,
    agencyDeductionConfirmedById:
      order.financeConfirmedById || null,
    agencyDeductionConfirmedBy: null,
    agencyDeductionConfirmedAt: normalizeDateString(
      order.financeConfirmedAt,
    ),
    totalAgencyNetAmountCents: baseAdjustmentCents,
    totalDailyRebateCents: dailyRebateCents,
    totalMonthlyRebateCents: monthlyRebateCents,
    paidRebateCents: 0,
    unpaidRebateCents: dailyRebateCents + monthlyRebateCents,
    paidDailyRebateCents: 0,
    unpaidDailyRebateCents: dailyRebateCents,
    paidMonthlyRebateCents: 0,
    unpaidMonthlyRebateCents: monthlyRebateCents,
    dailyRebatePaid: false,
    dailyRebatePaidById: null,
    dailyRebatePaidBy: null,
    dailyRebatePaidAt: null,
    monthlyRebatePaid: false,
    monthlyRebatePaidById: null,
    monthlyRebatePaidBy: null,
    monthlyRebatePaidAt: null,
    notes: order.notes || null,
    guideInfoSent: false,
    travelAgencyInfoSent: false,
    calculationVersion: 'after_sales_v1',
    afterSalesImpactStatus: normalizeEnumText(
      order.financialEffectStatus,
    ).toLowerCase(),
    pendingAfterSalesRefundCount: order.financeConfirmed ? 0 : 1,
    pendingAfterSalesRefundAmountCents: order.financeConfirmed
      ? 0
      : refundAmountCents,
    confirmedAfterSalesRefundCount: order.financeConfirmed ? 1 : 0,
    confirmedAfterSalesRefundAmountCents: order.financeConfirmed
      ? refundAmountCents
      : 0,
    afterSalesRequiresFinance: !order.financeConfirmed,
    updatedBy: null,
    createdAt: normalizeDateString(order.createdAt),
    updatedAt: normalizeDateString(order.updatedAt),
  };
}

function multiplyFinanceCentsByRate(cents: number, rateValue: unknown) {
  const rateUnits = Math.round(Number(rateValue || 0) * 10000);
  if (!Number.isSafeInteger(cents) || !Number.isSafeInteger(rateUnits)) {
    return 0;
  }
  const sign = cents < 0 ? -1 : 1;
  return (
    sign *
    Number(
      (BigInt(Math.abs(cents)) * BigInt(Math.max(0, rateUnits)) + 5000n) /
        10000n,
    )
  );
}

function compareFinanceRows(left: any, right: any) {
  const leftTime = dateTimeValue(left.financeDate) || 0;
  const rightTime = dateTimeValue(right.financeDate) || 0;
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return String(left.financeRowId).localeCompare(
    String(right.financeRowId),
  );
}

async function buildFinanceRowsExportResult(rows: any[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Jiangjiu';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet('统一积分财务行');
  worksheet.columns = [
    { header: '财务行ID', key: 'financeRowId', width: 45 },
    { header: '行类型', key: 'rowKind', width: 20 },
    { header: '订单类型', key: 'orderType', width: 16 },
    { header: '日期', key: 'financeDate', width: 14 },
    { header: '团号', key: 'groupNo', width: 20 },
    { header: '售后单号', key: 'afterSalesNo', width: 20 },
    { header: '关联原订单号', key: 'sourceSalesOrderNo', width: 22 },
    { header: '售后状态', key: 'afterSalesStatus', width: 18 },
    { header: '财务影响状态', key: 'financialEffectStatus', width: 20 },
    { header: '旅行社', key: 'travelAgency', width: 24 },
    { header: '导游', key: 'guideName', width: 16 },
    { header: '车牌', key: 'licensePlate', width: 16 },
    { header: '销售额调整', key: 'salesAmountYuan', width: 16 },
    { header: '扣酒成本调整', key: 'deductionYuan', width: 18 },
    { header: '上单金额调整', key: 'netAmountYuan', width: 18 },
    { header: '日返积分调整', key: 'dailyPointsYuan', width: 18 },
    { header: '月返积分调整', key: 'monthlyPointsYuan', width: 18 },
    { header: '已计入正式合计', key: 'includedInFormalTotals', width: 18 },
  ];
  for (const row of rows) {
    const group = row.travelGroup || {};
    worksheet.addRow({
      financeRowId: row.financeRowId,
      rowKind: row.rowKind,
      orderType: row.orderType,
      financeDate: row.financeDate || group.visitDate || '',
      groupNo: group.groupNo || '',
      afterSalesNo: row.afterSalesNo || '',
      sourceSalesOrderNo: row.sourceSalesOrderNo || '',
      afterSalesStatus: row.afterSalesStatus || '',
      financialEffectStatus: row.financialEffectStatus || '',
      travelAgency: group.travelAgency || '',
      guideName: group.guideName || '',
      licensePlate: group.licensePlate || '',
      salesAmountYuan: centsToYuanNumber(row.totalSalesAmountCents),
      deductionYuan:
        row.rowKind === 'after_sales_adjustment' &&
        row.agencyDeductionAdjustmentCents === null
          ? null
          : centsToYuanNumber(row.totalAgencyDeductionCents),
      netAmountYuan:
        row.financialAmountsReady === false
          ? null
          : centsToYuanNumber(row.totalAgencyNetAmountCents),
      dailyPointsYuan:
        row.financialAmountsReady === false
          ? null
          : centsToYuanNumber(row.totalDailyRebateCents),
      monthlyPointsYuan:
        row.financialAmountsReady === false
          ? null
          : centsToYuanNumber(row.totalMonthlyRebateCents),
      includedInFormalTotals: row.includedInFormalTotals ? '是' : '否',
    });
  }
  for (const key of [
    'salesAmountYuan',
    'deductionYuan',
    'netAmountYuan',
    'dailyPointsYuan',
    'monthlyPointsYuan',
  ]) {
    const column = worksheet.getColumn(key);
    column.numFmt = '0.00;[Red]-0.00';
  }
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: 'A1',
    to: 'R1',
  };
  const xlsxData = await workbook.xlsx.writeBuffer();
  return {
    fileName: `finance-rows-${formatFileNameTimestamp(new Date())}.xlsx`,
    buffer: Buffer.from(xlsxData as any),
    rowCount: rows.length,
  };
}

function toTravelGroupFinanceSummaryDetailDto(summary: any) {
  return {
    ...toTravelGroupFinanceSummaryListDto(summary),
    sourceSnapshot: summarizeSourceSnapshotForApi(summary.sourceSnapshot),
  };
}

function toTravelGroupFinanceSummaryDto(summary: any) {
  const paymentAmounts = deriveSummaryRebatePaymentAmounts(summary);
  const splitPaymentAmounts = deriveSummaryRebateSplitAmounts(summary);
  const afterSalesImpact = readAfterSalesImpactFields(
    summary.sourceSnapshot,
  );
  return {
    id: summary.id,
    summaryExists: summary.summaryExists !== false,
    travelGroupId: summary.travelGroupId,
    totalSalesAmountCents: toInteger(summary.totalSalesAmountCents),
    totalCashOnDeliveryCents: toInteger(
      summary.totalCashOnDeliveryCents,
    ),
    totalPaidDepositCents: toInteger(summary.totalPaidDepositCents),
    confirmedRefundAmountCents: toInteger(
      summary.confirmedRefundAmountCents,
    ),
    effectiveSalesAmountCents: toInteger(summary.effectiveSalesAmountCents),
    ...afterSalesImpact,
    totalAgencyDeductionCents: toInteger(
      summary.totalAgencyDeductionCents,
    ),
    agencyDeductionConfirmed: Boolean(summary.agencyDeductionConfirmed),
    agencyDeductionConfirmedById:
      summary.agencyDeductionConfirmedById || null,
    agencyDeductionConfirmedAt: normalizeDateString(
      summary.agencyDeductionConfirmedAt,
    ),
    totalAgencyNetAmountCents: toInteger(summary.totalAgencyNetAmountCents),
    totalDailyRebateCents: toInteger(summary.totalDailyRebateCents),
    totalMonthlyRebateCents: toInteger(summary.totalMonthlyRebateCents),
    paidRebateCents: paymentAmounts.paidRebateCents,
    unpaidRebateCents: paymentAmounts.unpaidRebateCents,
    ...splitPaymentAmounts,
    dailyRebatePaid: Boolean(summary.dailyRebatePaid),
    dailyRebatePaidById: summary.dailyRebatePaidById || null,
    dailyRebatePaidAt: normalizeDateString(summary.dailyRebatePaidAt),
    monthlyRebatePaid: Boolean(summary.monthlyRebatePaid),
    monthlyRebatePaidById: summary.monthlyRebatePaidById || null,
    monthlyRebatePaidAt: normalizeDateString(summary.monthlyRebatePaidAt),
    notes: summary.notes || null,
    guideInfoSent: Boolean(summary.guideInfoSent),
    travelAgencyInfoSent: Boolean(summary.travelAgencyInfoSent),
    calculationVersion: summary.calculationVersion || null,
    sourceSnapshot: summary.sourceSnapshot || null,
    updatedById: summary.updatedById || null,
    createdAt: normalizeDateString(summary.createdAt),
    updatedAt: normalizeDateString(summary.updatedAt),
  };
}

function summarizeTravelGroup(group: any, sourceSnapshot: any = null) {
  if (!group) {
    return null;
  }
  return {
    id: group.id,
    groupNo: group.groupNo || null,
    visitDate: normalizeDateString(group.visitDate),
    agencyId: resolveAgencyIdFromSourceSnapshot(sourceSnapshot),
    travelAgency: normalizeNullableString(group.travelAgency),
    guideId: group.guideId || null,
    guideName: group.guideName || null,
    guidePhone: group.guidePhone || null,
    licensePlate: group.licensePlate || null,
    guestCount: toInteger(group.guestCount),
    tasterId: group.tasterId || null,
    tasterName: group.tasterName || null,
    financeMark:
      group.financeMark === undefined ? null : Boolean(group.financeMark),
  };
}

function resolveAgencyIdFromRecordSummary(recordSummary: any) {
  const records = [
    ...(recordSummary?.dailyRecords || []),
    ...(recordSummary?.monthlyRecords || []),
    ...(recordSummary?.perOrderRecords || []),
  ];
  const agencyIds = normalizeIdList(
    records.map((record: any) => record?.agencyId),
  );
  return agencyIds.length === 1 ? agencyIds[0] : null;
}

function resolveAgencyIdFromSourceSnapshot(sourceSnapshot: any) {
  if (!isPlainObject(sourceSnapshot)) {
    return null;
  }
  const snapshotAgencyId = normalizeOptionalString(
    sourceSnapshot.travelGroup?.agencyId,
  );
  if (snapshotAgencyId) {
    return snapshotAgencyId;
  }
  const recordGroups = sourceSnapshot.agencyRebateRecords;
  const records = [
    ...(Array.isArray(recordGroups?.daily) ? recordGroups.daily : []),
    ...(Array.isArray(recordGroups?.monthly) ? recordGroups.monthly : []),
    ...(Array.isArray(recordGroups?.perOrderForDeductionAndNet)
      ? recordGroups.perOrderForDeductionAndNet
      : []),
  ];
  const agencyIds = normalizeIdList(
    records.map((record: any) => record?.agencyId),
  );
  return agencyIds.length === 1 ? agencyIds[0] : null;
}

function readAfterSalesImpactFields(sourceSnapshot: any) {
  const snapshot = isPlainObject(sourceSnapshot) ? sourceSnapshot : {};
  const nested = isPlainObject(snapshot.afterSalesImpact)
    ? snapshot.afterSalesImpact
    : {};
  const readValue = (fieldName: string) =>
    snapshot[fieldName] !== undefined
      ? snapshot[fieldName]
      : nested[fieldName];
  return {
    afterSalesCount: toInteger(readValue('afterSalesCount')),
    activeAfterSalesCount: toInteger(
      readValue('activeAfterSalesCount'),
    ),
    pendingAfterSalesRefundCount: toInteger(
      readValue('pendingAfterSalesRefundCount'),
    ),
    pendingAfterSalesRefundAmountCents: toInteger(
      readValue('pendingAfterSalesRefundAmountCents'),
    ),
    latestAfterSalesNo:
      normalizeOptionalString(readValue('latestAfterSalesNo')) || null,
    latestAfterSalesStatus:
      normalizeOptionalString(
        readValue('latestAfterSalesStatus'),
      )?.toLowerCase() || null,
    afterSalesImpactStatus:
      normalizeOptionalString(readValue('afterSalesImpactStatus')) || 'none',
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

function summarizeSourceSnapshotForApi(sourceSnapshot: any) {
  if (!isPlainObject(sourceSnapshot)) {
    return null;
  }
  const orders = Array.isArray(sourceSnapshot.orders)
    ? sourceSnapshot.orders.map((order: any) => ({
        id: order.id || null,
        orderNo: order.orderNo || null,
        orderDate: normalizeDateString(order.orderDate),
        status: order.status || null,
        totalAmountCents: toInteger(order.totalAmountCents),
        cashOnDeliveryAmountCents: toInteger(
          order.cashOnDeliveryAmountCents,
        ),
        paidDepositCents: toInteger(order.paidDepositCents),
        confirmedRefundAmountCents: toInteger(
          order.confirmedRefundAmountCents,
        ),
        effectiveAmountCents: toInteger(order.effectiveAmountCents),
        itemCount: Array.isArray(order.items) ? order.items.length : 0,
        confirmedRefundCount: Array.isArray(order.confirmedRefunds)
          ? order.confirmedRefunds.length
          : 0,
        unconfirmedRefundSummary: scrubSensitiveJson(
          order.unconfirmedRefundSummary || null,
        ),
      }))
    : [];
  const agencyRebateRecords = isPlainObject(
    sourceSnapshot.agencyRebateRecords,
  )
    ? sourceSnapshot.agencyRebateRecords
    : {};

  return {
    calculationVersion: sourceSnapshot.calculationVersion || null,
    travelGroup: scrubSensitiveJson(sourceSnapshot.travelGroup || null),
    amounts: scrubSensitiveJson(sourceSnapshot.amounts || null),
    ...readAfterSalesImpactFields(sourceSnapshot),
    afterSalesOrderIds: scrubSensitiveJson(
      sourceSnapshot.afterSalesOrderIds || [],
    ),
    afterSalesImpact: scrubSensitiveJson(
      sourceSnapshot.afterSalesImpact || null,
    ),
    rebatePaidFacts: scrubSensitiveJson(
      sourceSnapshot.rebatePaidFacts || null,
    ),
    orderCount: orders.length,
    orders,
    confirmedRefunds: scrubSensitiveJson(
      sourceSnapshot.confirmedRefunds || [],
    ),
    unconfirmedRefundSummary: scrubSensitiveJson(
      sourceSnapshot.unconfirmedRefundSummary || null,
    ),
    agencyRebateRecords: {
      dailyCount: Array.isArray(agencyRebateRecords.daily)
        ? agencyRebateRecords.daily.length
        : 0,
      monthlyCount: Array.isArray(agencyRebateRecords.monthly)
        ? agencyRebateRecords.monthly.length
        : 0,
      perOrderForDeductionAndNet: scrubSensitiveJson(
        agencyRebateRecords.perOrderForDeductionAndNet || [],
      ),
    },
    ruleSummary: scrubSensitiveJson(sourceSnapshot.ruleSummary || null),
    agencyDeduction: scrubSensitiveJson(
      sourceSnapshot.agencyDeduction || null,
    ),
    manualRebateCalculation: scrubSensitiveJson(
      sourceSnapshot.manualRebateCalculation || null,
    ),
  };
}

function uniqueById(items: any[]) {
  const seen = new Set<string>();
  const result: any[] = [];
  for (const item of items) {
    const key = item?.id
      ? `id:${item.id}`
      : stableStringify(item ?? null);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function sumBy(items: any[], fieldName: string) {
  return (items || []).reduce(
    (total, item) => total + toInteger(item?.[fieldName]),
    0,
  );
}

function normalizeRequiredString(value: unknown, fieldName: string) {
  const text =
    typeof value === 'string' ? value.trim() : String(value || '').trim();
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

function normalizeIdList(values: unknown[]) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map(normalizeOptionalString)
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function normalizeSelectedTravelGroupIds(value: unknown) {
  if (!Array.isArray(value)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'travelGroupIds must be an array.',
    );
  }
  const travelGroupIds = Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
  if (travelGroupIds.length === 0) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'travelGroupIds must contain at least one non-empty string.',
    );
  }
  if (
    travelGroupIds.length >
    SELECTED_TRAVEL_GROUP_FINANCE_SUMMARY_EXPORT_MAX_ROWS
  ) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `travelGroupIds cannot contain more than ${SELECTED_TRAVEL_GROUP_FINANCE_SUMMARY_EXPORT_MAX_ROWS} unique IDs.`,
    );
  }
  return travelGroupIds;
}

function normalizeSelectedFinanceRowIds(value: unknown) {
  if (!Array.isArray(value)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'financeRowIds must be an array.',
    );
  }
  const financeRowIds = Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
  if (financeRowIds.length === 0) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'financeRowIds must contain at least one non-empty string.',
    );
  }
  if (
    financeRowIds.length >
    SELECTED_TRAVEL_GROUP_FINANCE_SUMMARY_EXPORT_MAX_ROWS
  ) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `financeRowIds cannot contain more than ${SELECTED_TRAVEL_GROUP_FINANCE_SUMMARY_EXPORT_MAX_ROWS} unique IDs.`,
    );
  }
  return financeRowIds;
}

function normalizeNullableString(value: unknown) {
  const text =
    typeof value === 'string' ? value.trim() : String(value || '').trim();
  return text || null;
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

function normalizeRequiredNonNegativeInteger(
  value: unknown,
  fieldName: string,
) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be a non-negative integer.`,
    );
  }
  return value;
}

function normalizeOptionalBooleanFilter(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return normalizeRequiredBoolean(value, fieldName);
}

function normalizeRebatePaymentType(value: unknown) {
  const text = normalizeRequiredString(value, 'rebateType').toLowerCase();
  if (text === 'daily' || text === 'day' || text === 'daily_rebate') {
    return 'daily';
  }
  if (text === 'monthly' || text === 'month' || text === 'monthly_rebate') {
    return 'monthly';
  }
  throw createHttpError(
    400,
    'VALIDATION_FAILED',
    'rebateType must be daily or monthly.',
  );
}

function buildRebatePaymentAmounts(input: {
  totalDailyRebateCents: unknown;
  totalMonthlyRebateCents: unknown;
  dailyRebatePaid: unknown;
  monthlyRebatePaid: unknown;
}) {
  const totalDailyRebateCents = toInteger(input.totalDailyRebateCents);
  const totalMonthlyRebateCents = toInteger(input.totalMonthlyRebateCents);
  const dailyPaid = Boolean(input.dailyRebatePaid);
  const monthlyPaid = Boolean(input.monthlyRebatePaid);
  return {
    paidRebateCents:
      (dailyPaid ? totalDailyRebateCents : 0) +
      (monthlyPaid ? totalMonthlyRebateCents : 0),
    unpaidRebateCents:
      (dailyPaid ? 0 : totalDailyRebateCents) +
      (monthlyPaid ? 0 : totalMonthlyRebateCents),
  };
}

function deriveSummaryRebatePaymentAmounts(summary: any) {
  if (
    summary &&
    summary.paidRebateCents !== undefined &&
    summary.unpaidRebateCents !== undefined
  ) {
    return {
      paidRebateCents: Math.max(
        0,
        toInteger(summary.paidRebateCents),
      ),
      unpaidRebateCents: Math.max(
        0,
        toInteger(summary.unpaidRebateCents),
      ),
    };
  }
  return buildRebatePaymentAmounts({
    totalDailyRebateCents: summary?.totalDailyRebateCents,
    totalMonthlyRebateCents: summary?.totalMonthlyRebateCents,
    dailyRebatePaid: summary?.dailyRebatePaid,
    monthlyRebatePaid: summary?.monthlyRebatePaid,
  });
}

function deriveSummaryRebateSplitAmounts(summary: any) {
  const totalDailyRebateCents = toInteger(summary?.totalDailyRebateCents);
  const totalMonthlyRebateCents = toInteger(summary?.totalMonthlyRebateCents);
  const dailyPaid = Boolean(summary?.dailyRebatePaid);
  const monthlyPaid = Boolean(summary?.monthlyRebatePaid);
  const paidFacts = isPlainObject(summary?.sourceSnapshot?.rebatePaidFacts)
    ? summary.sourceSnapshot.rebatePaidFacts
    : {};
  const paidDailyRebateCents = dailyPaid
    ? Math.max(
        0,
        paidFacts.paidDailyRebateCents !== undefined
          ? toInteger(paidFacts.paidDailyRebateCents)
          : totalDailyRebateCents,
      )
    : 0;
  const paidMonthlyRebateCents = monthlyPaid
    ? Math.max(
        0,
        paidFacts.paidMonthlyRebateCents !== undefined
          ? toInteger(paidFacts.paidMonthlyRebateCents)
          : totalMonthlyRebateCents,
      )
    : 0;
  return {
    paidDailyRebateCents,
    unpaidDailyRebateCents: dailyPaid
      ? Math.max(0, totalDailyRebateCents - paidDailyRebateCents)
      : totalDailyRebateCents,
    paidMonthlyRebateCents,
    unpaidMonthlyRebateCents: monthlyPaid
      ? Math.max(0, totalMonthlyRebateCents - paidMonthlyRebateCents)
      : totalMonthlyRebateCents,
  };
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

function normalizeEnumText(value: unknown) {
  return String(value || '').trim().toUpperCase();
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

function isFullyRefundedOrCancelled(status: unknown) {
  const text = normalizeEnumText(status);
  return text === 'REFUNDED' || text === 'CANCELLED';
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

function multiplyCentsByRate(amountCents: number, rate: unknown) {
  const decimal = parseDecimalToScaledInteger(rate);
  const numerator = BigInt(amountCents) * BigInt(decimal.scaledValue);
  const denominator = BigInt(decimal.scale);
  const rounded =
    numerator >= 0
      ? (numerator + denominator / BigInt(2)) / denominator
      : (numerator - denominator / BigInt(2)) / denominator;
  return Number(rounded);
}

function parseDecimalToScaledInteger(value: unknown) {
  const text = normalizeNullableRate(value) || '0.0000';
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [integerPart, fractionPart = ''] = unsigned.split('.');
  const normalizedFraction = fractionPart.replace(/\D/g, '');
  const scale = 10 ** normalizedFraction.length;
  const scaledValue =
    Number(integerPart || 0) * scale + Number(normalizedFraction || 0);
  return {
    scaledValue: negative ? -scaledValue : scaledValue,
    scale: scale || 1,
  };
}

function normalizeDateString(value: any) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value ? String(value) : null;
}

function toInteger(value: unknown) {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : 0;
}

function centsToYuanNumber(value: unknown) {
  return Number((toInteger(value) / 100).toFixed(2));
}

function scalePointsTableSourceCents(value: unknown) {
  const sourceCents = toInteger(value);
  const sign = sourceCents < 0 ? -1 : 1;
  return sign * Math.trunc((Math.abs(sourceCents) + 50) / 100);
}

function pointsTableSourceCentsToYuanNumber(value: unknown) {
  return Number((scalePointsTableSourceCents(value) / 100).toFixed(2));
}

function formatPointsTableSourceCents(value: unknown) {
  const displayCents = scalePointsTableSourceCents(value);
  const sign = displayCents < 0 ? '-' : '';
  const absolute = Math.abs(displayCents);
  return `${sign}¥${Math.trunc(absolute / 100)}.${String(
    absolute % 100,
  ).padStart(2, '0')}`;
}

function selectedExportAfterSalesImpactLabel(summary: any) {
  const afterSalesImpact = readAfterSalesImpactFields(
    summary?.sourceSnapshot,
  );
  switch (afterSalesImpact.afterSalesImpactStatus) {
    case 'after_sales_processing':
      return '售后处理中';
    case 'refund_pending_confirmation':
      return `退款待确认 ${formatPointsTableSourceCents(
        afterSalesImpact.pendingAfterSalesRefundAmountCents,
      )}`;
    case 'refund_adjusted':
      return '已按退款调整';
    case 'after_rebate_paid_requires_finance':
      return '已返后发生售后，需财务处理';
    default:
      return '无';
  }
}

function selectedExportSummaryStatus(summary: any) {
  if (summary?.summaryExists === false) {
    return '未生成汇总';
  }
  const afterSalesImpactStatus = readAfterSalesImpactFields(
    summary?.sourceSnapshot,
  ).afterSalesImpactStatus;
  switch (afterSalesImpactStatus) {
    case 'after_rebate_paid_requires_finance':
      return '需财务处理';
    case 'refund_pending_confirmation':
      return '退款待确认';
    case 'after_sales_processing':
      return '售后处理中';
    default:
      return deriveSummaryRebatePaymentAmounts(summary).unpaidRebateCents === 0
        ? '已完成'
        : '待返';
  }
}

function booleanLabel(value: unknown) {
  return value ? '是' : '否';
}

function toDateOnly(value: unknown) {
  if (!value) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value).slice(0, 10)
    : date.toISOString().slice(0, 10);
}

function valuesEqualForSummary(left: any, right: any) {
  if (left instanceof Date || right instanceof Date) {
    return normalizeDateString(left) === normalizeDateString(right);
  }
  return (left ?? null) === (right ?? null);
}

function isPlainObject(value: any) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function buildTravelGroupFinanceSummariesExportFileName(date = new Date()) {
  return `travel-group-finance-summaries-${formatFileNameTimestamp(date)}.xlsx`;
}

function buildSelectedTravelGroupFinanceSummariesExportFileName(
  date = new Date(),
) {
  return `points-table-selected-${formatFileNameTimestamp(date)}.xlsx`;
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
  if (value === null || typeof value !== 'object') {
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
