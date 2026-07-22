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

const CALCULATION_VERSION = 'stage7_v1';
const AGENCY_DAILY_REBATE = 'AGENCY_DAILY_REBATE';
const AGENCY_MONTHLY_REBATE = 'AGENCY_MONTHLY_REBATE';
const READ_SUMMARY_ROLES = ['admin', 'finance', 'boss'];
const WRITE_SUMMARY_ROLES = ['admin', 'finance'];
const TRAVEL_GROUP_FINANCE_SUMMARY_EXPORT_MAX_ROWS = 5000;

@Injectable()
export class TravelGroupFinanceSummaryNestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsNestService,
    private readonly settingsService?: SettingsNestService,
  ) {}

  async listTravelGroupFinanceSummaries(actor: any, filters: any = {}) {
    requireAnyRole(actor, READ_SUMMARY_ROLES);
    const summaries = await this.prisma.travelGroupFinanceSummary.findMany({
      where: await this.buildSummaryQueryWhere(filters),
      include: getTravelGroupFinanceSummaryListInclude(),
      orderBy: {
        updatedAt: 'desc',
      },
      take: normalizeTake(filters?.limit),
    });
    return summaries.map(toTravelGroupFinanceSummaryListDto);
  }

  async getTravelGroupFinanceSummary(actor: any, travelGroupId: string) {
    requireAnyRole(actor, READ_SUMMARY_ROLES);
    const summary = await this.findSummaryVisibleForApi(travelGroupId);
    return toTravelGroupFinanceSummaryDetailDto(summary);
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
    const summaries = await this.prisma.travelGroupFinanceSummary.findMany({
      where: await this.buildSummaryQueryWhere(filters),
      include: getTravelGroupFinanceSummaryListInclude(),
      orderBy: {
        updatedAt: 'desc',
      },
      take: exportLimit + 1,
    });
    if (summaries.length > exportLimit) {
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
        rowCount: summaries.length,
      },
      ipAddress: metadata.ipAddress || null,
    });

    const workbook =
      buildTravelGroupFinanceSummariesExportWorkbook(summaries);
    const xlsxData = await workbook.xlsx.writeBuffer();
    return {
      fileName: buildTravelGroupFinanceSummariesExportFileName(),
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
    const totalSalesAmountCents = toInteger(current.totalSalesAmountCents);
    if (totalAgencyDeductionCents > totalSalesAmountCents) {
      throw createHttpError(
        400,
        'VALIDATION_FAILED',
        'totalAgencyDeductionCents cannot exceed totalSalesAmountCents.',
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
    const paymentAmounts = buildRebatePaymentAmounts({
      totalDailyRebateCents: rebateCalculation.totalDailyRebateCents,
      totalMonthlyRebateCents: rebateCalculation.totalMonthlyRebateCents,
      dailyRebatePaid: current.dailyRebatePaid,
      monthlyRebatePaid: current.monthlyRebatePaid,
    });
    const now = new Date();
    const amountChanged =
      toInteger(current.totalAgencyDeductionCents) !==
      totalAgencyDeductionCents;
    const nextAmounts = {
      totalAgencyDeductionCents,
      totalAgencyNetAmountCents:
        totalSalesAmountCents - totalAgencyDeductionCents,
      totalDailyRebateCents: rebateCalculation.totalDailyRebateCents,
      totalMonthlyRebateCents: rebateCalculation.totalMonthlyRebateCents,
      ...paymentAmounts,
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
    const paymentAmounts = buildRebatePaymentAmounts({
      totalDailyRebateCents: current.totalDailyRebateCents,
      totalMonthlyRebateCents: current.totalMonthlyRebateCents,
      dailyRebatePaid: nextDailyPaid,
      monthlyRebatePaid: nextMonthlyPaid,
    });
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
        paidRebateCents: paymentAmounts.paidRebateCents,
        unpaidRebateCents: paymentAmounts.unpaidRebateCents,
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

  private loadSalesOrders(prisma: any, travelGroupId: string) {
    return prisma.salesOrder.findMany({
      where: {
        travelGroupId,
      },
      include: {
        items: {
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
        targetType: {
          in: [AGENCY_DAILY_REBATE, AGENCY_MONTHLY_REBATE],
        },
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

  private async buildSummaryQueryWhere(filters: any = {}) {
    const clauses: any[] = [
      {
        travelGroup: {
          is: (await this.buildGlobalGroupMarkScope()) || {},
        },
      },
    ];

    const travelGroupId = normalizeOptionalString(filters?.travelGroupId);
    if (travelGroupId) {
      clauses.push({ travelGroupId });
    }

    const agencyDeductionConfirmed = normalizeOptionalBooleanFilter(
      filters?.agencyDeductionConfirmed,
      'agencyDeductionConfirmed',
    );
    if (agencyDeductionConfirmed !== null) {
      clauses.push({ agencyDeductionConfirmed });
    }

    const dateRange = buildDateRange(filters?.dateFrom, filters?.dateTo);
    if (dateRange) {
      clauses.push({
        travelGroup: {
          is: {
            visitDate: dateRange,
          },
        },
      });
    }

    const agencyName = normalizeOptionalString(filters?.agencyName);
    if (agencyName) {
      clauses.push({
        travelGroup: {
          is: {
            travelAgency: {
              contains: agencyName,
            },
          },
        },
      });
    }

    const guideName = normalizeOptionalString(filters?.guideName);
    if (guideName) {
      clauses.push({
        travelGroup: {
          is: {
            guideName: {
              contains: guideName,
            },
          },
        },
      });
    }

    const query = normalizeOptionalString(filters?.query);
    if (query) {
      clauses.push(buildSummarySearchWhere(query));
    }

    return andWhere(...clauses);
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

function buildTravelGroupFinanceCalculation(input: {
  travelGroup: any;
  salesOrders: any[];
  agencyRebateRecords: any[];
  current: any;
}) {
  const salesOrders = input.salesOrders || [];
  const agencyRebateRecords = input.agencyRebateRecords || [];
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
  const manualAgencyDeduction = getManualAgencyDeduction(input.current);
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
    : sumBy(agencyRecordSummary.dailyRecords, 'grossRateRebateCents');
  const totalMonthlyRebateCents = manualRebateCalculation
    ? manualRebateCalculation.totalMonthlyRebateCents
    : sumBy(agencyRecordSummary.monthlyRecords, 'grossRateRebateCents');
  const paymentAmounts = buildRebatePaymentAmounts({
    totalDailyRebateCents,
    totalMonthlyRebateCents,
    dailyRebatePaid: Boolean(input.current?.dailyRebatePaid),
    monthlyRebatePaid: Boolean(input.current?.monthlyRebatePaid),
  });
  const nextAmounts = {
    totalSalesAmountCents,
    totalCashOnDeliveryCents,
    totalPaidDepositCents,
    confirmedRefundAmountCents: sumBy(
      orderSummaries,
      'confirmedRefundAmountCents',
    ),
    effectiveSalesAmountCents: sumBy(
      orderSummaries,
      'effectiveAmountCents',
    ),
    totalAgencyDeductionCents,
    totalAgencyNetAmountCents:
      totalSalesAmountCents - totalAgencyDeductionCents,
    totalDailyRebateCents,
    totalMonthlyRebateCents,
    paidRebateCents: paymentAmounts.paidRebateCents,
    unpaidRebateCents: paymentAmounts.unpaidRebateCents,
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

function summarizeSalesOrderForFinance(order: any) {
  const afterSalesOrders = order.afterSalesOrders || [];
  const confirmedRefunds = afterSalesOrders
    .filter((item: any) => Boolean(item.financeConfirmed))
    .map(summarizeRefund);
  const unconfirmedRefunds = afterSalesOrders
    .filter((item: any) => !item.financeConfirmed && toInteger(item.refundAmountCents) > 0)
    .map(summarizeRefund);
  const confirmedRefundAmountCents = sumBy(
    confirmedRefunds,
    'refundAmountCents',
  );
  const totalAmountCents = toInteger(order.totalAmountCents);
  const cashOnDeliveryAmountCents = toInteger(
    order.cashOnDeliveryAmountCents,
  );

  return {
    id: order.id,
    orderNo: order.orderNo || null,
    orderDate: normalizeDateString(order.orderDate),
    status: normalizeEnumText(order.status),
    totalAmountCents,
    cashOnDeliveryAmountCents,
    paidDepositCents: totalAmountCents - cashOnDeliveryAmountCents,
    confirmedRefundAmountCents,
    effectiveAmountCents: isFullyRefundedOrCancelled(order.status)
      ? 0
      : Math.max(0, totalAmountCents - confirmedRefundAmountCents),
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

function summarizeRefund(afterSalesOrder: any) {
  return {
    id: afterSalesOrder.id,
    afterSalesNo: afterSalesOrder.afterSalesNo || null,
    actionType: normalizeEnumText(afterSalesOrder.actionType),
    status: normalizeEnumText(afterSalesOrder.status),
    refundAmountCents: toInteger(afterSalesOrder.refundAmountCents),
    financeConfirmed: Boolean(afterSalesOrder.financeConfirmed),
    financeConfirmedAt: normalizeDateString(
      afterSalesOrder.financeConfirmedAt,
    ),
    createdAt: normalizeDateString(afterSalesOrder.createdAt),
  };
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
    totalAgencyNetAmountCents:
      sumBy(perOrderRecords, 'grossAmountCents') -
      sumBy(perOrderRecords, 'deductionAmountCents'),
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
    grossAmountCents: Math.max(0, toInteger(record.grossAmountCents)),
    allocatedDeductionCents: 0,
    remainder: BigInt(0),
  }));
  const totalGrossAmountCents = candidates.reduce(
    (total: number, item: any) => total + item.grossAmountCents,
    0,
  );
  const allocatableDeductionCents = Math.min(
    Math.max(0, toInteger(deductionCents)),
    totalGrossAmountCents,
  );

  if (totalGrossAmountCents > 0 && allocatableDeductionCents > 0) {
    const denominator = BigInt(totalGrossAmountCents);
    let allocated = 0;
    for (const item of candidates) {
      const numerator =
        BigInt(allocatableDeductionCents) * BigInt(item.grossAmountCents);
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
      if (item.allocatedDeductionCents < item.grossAmountCents) {
        item.allocatedDeductionCents += 1;
        remainderCents -= 1;
      }
    }
  }

  const allocations = candidates.map((item: any) => {
    const netBaseAmountCents = Math.max(
      0,
      item.grossAmountCents - item.allocatedDeductionCents,
    );
    return {
      recordId: item.record.id || null,
      salesOrderId: item.record.salesOrderId || null,
      grossAmountCents: item.grossAmountCents,
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
    amounts: {
      ...currentAmounts,
      ...amounts,
    },
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
}) {
  return {
    calculationVersion: CALCULATION_VERSION,
    travelGroup: {
      id: input.travelGroup.id,
      groupNo: input.travelGroup.groupNo || null,
      visitDate: normalizeDateString(input.travelGroup.visitDate),
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
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'jiangjiu-api';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet('返积分汇总');
  worksheet.columns = TRAVEL_GROUP_FINANCE_SUMMARY_EXPORT_COLUMNS;
  for (const column of worksheet.columns) {
    if (
      column.key &&
      TRAVEL_GROUP_FINANCE_SUMMARY_EXPORT_AMOUNT_KEYS.has(String(column.key))
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
      column: TRAVEL_GROUP_FINANCE_SUMMARY_EXPORT_COLUMNS.length,
    },
  };
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).alignment = {
    vertical: 'middle',
    horizontal: 'center',
  };

  for (const summary of summaries) {
    worksheet.addRow(toTravelGroupFinanceSummaryExportRow(summary));
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

function buildSummarySearchWhere(query: string) {
  return {
    OR: [
      {
        notes: {
          contains: query,
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
        travelGroup: {
          is: {
            guideName: {
              contains: query,
            },
          },
        },
      },
      {
        travelGroup: {
          is: {
            tasterName: {
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
  return {
    id: summary.id,
    travelGroupId: summary.travelGroupId,
    travelGroup: summarizeTravelGroup(summary.travelGroup),
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

function toTravelGroupFinanceSummaryDetailDto(summary: any) {
  return {
    ...toTravelGroupFinanceSummaryListDto(summary),
    sourceSnapshot: summarizeSourceSnapshotForApi(summary.sourceSnapshot),
  };
}

function toTravelGroupFinanceSummaryDto(summary: any) {
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
    sourceSnapshot: summary.sourceSnapshot || null,
    updatedById: summary.updatedById || null,
    createdAt: normalizeDateString(summary.createdAt),
    updatedAt: normalizeDateString(summary.updatedAt),
  };
}

function summarizeTravelGroup(group: any) {
  if (!group) {
    return null;
  }
  return {
    id: group.id,
    groupNo: group.groupNo || null,
    visitDate: normalizeDateString(group.visitDate),
    travelAgency: normalizeNullableString(group.travelAgency),
    guideName: group.guideName || null,
    licensePlate: group.licensePlate || null,
    guestCount: toInteger(group.guestCount),
    tasterId: group.tasterId || null,
    tasterName: group.tasterName || null,
    financeMark:
      group.financeMark === undefined ? null : Boolean(group.financeMark),
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
  return {
    paidDailyRebateCents: dailyPaid ? totalDailyRebateCents : 0,
    unpaidDailyRebateCents: dailyPaid ? 0 : totalDailyRebateCents,
    paidMonthlyRebateCents: monthlyPaid ? totalMonthlyRebateCents : 0,
    unpaidMonthlyRebateCents: monthlyPaid ? 0 : totalMonthlyRebateCents,
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
