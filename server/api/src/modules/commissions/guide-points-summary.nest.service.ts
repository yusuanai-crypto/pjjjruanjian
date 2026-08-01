import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import { SettingsNestService } from '../settings/settings.nest.service';
import {
  allocateCentsByPersonalRatio,
  calculateStage7CommissionAndPoints,
  resolveSalesOrderPersonalAmountCents,
} from './commission-calculation.helper';
import { CommissionRecordsNestService } from './commission-records.nest.service';
import { TravelGroupFinanceSummaryNestService } from './travel-group-finance-summary.nest.service';

const READ_ROLES = ['admin', 'finance', 'boss'];
const WRITE_ROLES = ['admin', 'finance'];
const SWITCH_ROLES = ['admin', 'finance', 'boss'];
const GUIDE_POINTS_CALCULATION_VERSION = 'guide_points_v2_personal_split';
const DEFAULT_DAILY_RATE = '0.5000';
const DEFAULT_MONTHLY_RATE = '0.0000';
const EXPORT_MAX_ROWS = 5000;

@Injectable()
export class GuidePointsSummaryNestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsNestService,
    private readonly commissionRecordsService: CommissionRecordsNestService,
    private readonly travelGroupFinanceSummaryService: TravelGroupFinanceSummaryNestService,
    private readonly settingsService?: SettingsNestService,
  ) {}

  async listGuidePointsSummaries(actor: any, filters: any = {}) {
    requireAnyRole(actor, READ_ROLES);
    const summaries = await this.prisma.guidePointsSummary.findMany({
      where: await this.buildSummaryWhere(filters),
      include: guidePointsSummaryInclude(),
      orderBy: [
        { travelGroup: { visitDate: 'desc' } },
        { travelGroup: { groupNo: 'asc' } },
        { guideNameSnapshot: 'asc' },
      ],
      take: normalizeTake(filters?.limit),
    });
    return summaries.map((summary: any) =>
      toGuidePointsSummaryDto(summary, false),
    );
  }

  async getGuidePointsSummary(actor: any, id: string) {
    requireAnyRole(actor, READ_ROLES);
    const summary = await this.findVisibleSummaryOrThrow(id);
    return toGuidePointsSummaryDto(summary, true);
  }

  async exportGuidePointsSummariesXlsx(
    actor: any,
    filters: any = {},
    metadata: any = {},
  ) {
    requireAnyRole(actor, READ_ROLES);
    const exportLimit = normalizeExportLimit(filters?.limit);
    const summaries = await this.prisma.guidePointsSummary.findMany({
      where: await this.buildSummaryWhere(filters),
      include: guidePointsSummaryInclude(),
      orderBy: [
        { travelGroup: { visitDate: 'desc' } },
        { travelGroup: { groupNo: 'asc' } },
        { guideNameSnapshot: 'asc' },
      ],
      take: exportLimit + 1,
    });
    if (summaries.length > exportLimit) {
      throw createHttpError(
        400,
        'EXPORT_LIMIT_EXCEEDED',
        `Guide points export exceeds ${exportLimit} rows. Please narrow filters.`,
      );
    }

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'guide_points_summaries.export',
      entityType: 'guide_points_summary',
      entityId: 'guide_points_summaries.export',
      beforeData: null,
      afterData: {
        rowCount: summaries.length,
        filters: summarizeFilters(filters),
      },
      ipAddress: metadata.ipAddress || null,
    });

    const workbook = buildGuidePointsExportWorkbook(summaries);
    const xlsxData = await workbook.xlsx.writeBuffer();
    return {
      fileName: `guide-points-${fileTimestamp(new Date())}.xlsx`,
      buffer: Buffer.from(xlsxData as any),
      rowCount: summaries.length,
    };
  }

  async updateSalesOrderPointsDestination(
    actor: any,
    orderId: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, SWITCH_ROLES);
    const id = normalizeRequiredString(orderId, 'orderId');

    return this.prisma.$transaction(async (tx: any) => {
      const current = await tx.salesOrder.findUnique({
        where: { id },
        include: {
          travelGroup: true,
          personalPointsGuide: true,
          afterSalesOrders: {
            select: {
              refundAmountCents: true,
              personalPointsRefundAmountCents: true,
              financeConfirmed: true,
            },
          },
        },
      });
      if (!current) {
        throw createHttpError(
          404,
          'SALES_ORDER_NOT_FOUND',
          '销售订单不存在。',
        );
      }
      if (!current.travelGroupId || !current.travelGroup) {
        throw createHttpError(
          400,
          'GUIDE_POINTS_TRAVEL_GROUP_REQUIRED',
          '只有已关联旅行团的订单才能切换积分归属。',
        );
      }

      const personalAmountCents = normalizePersonalAmountCents(
        payload,
        current,
      );
      const destination =
        personalAmountCents > 0 ? 'GUIDE_PERSONAL' : 'TRAVEL_AGENCY';
      assertPointsDestinationMatchesAmount(payload, destination);
      const currentDestination = normalizePointsDestination(
        current.pointsDestination || 'TRAVEL_AGENCY',
      );
      const currentPersonalAmountCents =
        resolveSalesOrderPersonalAmountCents(current);
      const target = await resolveTargetPointsDestination(
        tx,
        current,
        destination,
        payload,
      );
      const destinationChanged = currentDestination !== destination;
      const personalAmountChanged =
        currentPersonalAmountCents !== personalAmountCents;
      const guideChanged =
        normalizeOptionalString(current.personalPointsGuideId) !==
        target.personalPointsGuideId;
      const dailyRateChanged =
        normalizeRateText(current.personalDailyRebateRate) !==
        target.personalDailyRebateRate;
      const monthlyRateChanged =
        normalizeRateText(current.personalMonthlyRebateRate) !==
        target.personalMonthlyRebateRate;

      if (
        !destinationChanged &&
        !personalAmountChanged &&
        !guideChanged &&
        !dailyRateChanged &&
        !monthlyRateChanged
      ) {
        return {
          changed: false,
          salesOrderId: current.id,
          travelGroupId: current.travelGroupId,
          guideId: current.personalPointsGuideId,
        };
      }
      assertRefundAllocationsFitPersonalSplit(
        current.afterSalesOrders,
        Number(current.totalAmountCents || 0),
        personalAmountCents,
      );

      const ordinarySummary =
        await tx.travelGroupFinanceSummary.findUnique({
          where: { travelGroupId: current.travelGroupId },
        });
      if (personalAmountChanged) {
        assertOrdinarySummaryCanChange(ordinarySummary);
      }

      const affectedGuideIds = uniqueStrings([
        currentPersonalAmountCents > 0
          ? current.personalPointsGuideId
          : null,
        personalAmountCents > 0
          ? target.personalPointsGuideId
          : null,
      ]);
      const affectedGuideSummaries = affectedGuideIds.length
        ? await tx.guidePointsSummary.findMany({
            where: {
              travelGroupId: current.travelGroupId,
              guideId: { in: affectedGuideIds },
            },
          })
        : [];
      if (personalAmountChanged || guideChanged) {
        for (const summary of affectedGuideSummaries) {
          assertGuideSummaryCanChange(summary);
        }
      } else {
        const currentGuideSummary = affectedGuideSummaries[0] || null;
        assertRatesCanChange(
          currentGuideSummary,
          dailyRateChanged,
          monthlyRateChanged,
        );
      }

      const now = new Date();
      const updated = await tx.salesOrder.update({
        where: { id: current.id },
        data: {
          pointsDestination: destination,
          personalAmountCents,
          personalPointsGuideId: target.personalPointsGuideId,
          personalGuideNameSnapshot: target.personalGuideNameSnapshot,
          personalDailyRebateRate: target.personalDailyRebateRate,
          personalMonthlyRebateRate: target.personalMonthlyRebateRate,
          ...(personalAmountChanged || guideChanged
            ? {
                pointsDestinationChangedById: actor.id,
                pointsDestinationChangedAt: now,
              }
            : {}),
          ...(dailyRateChanged || monthlyRateChanged
            ? {
                personalRatesUpdatedById: actor.id,
                personalRatesUpdatedAt: now,
              }
            : {}),
          updatedById: actor.id,
          updatedAt: now,
        },
        include: {
          travelGroup: true,
          personalPointsGuide: true,
        },
      });

      const recalculation =
        await this.commissionRecordsService.recalculateSalesOrderRecords(
          current.id,
          {
            prisma: tx,
            actor,
            ipAddress: metadata.ipAddress || null,
            trigger: 'sales_order_points_destination_change',
          },
        );
      const ordinaryRefresh =
        await this.travelGroupFinanceSummaryService.refreshTravelGroupFinanceSummary(
          current.travelGroupId,
          {
            prisma: tx,
            actor,
            ipAddress: metadata.ipAddress || null,
            syncCompatibilityFields: false,
          },
        );
      const guideRefresh =
        await this.refreshGuidePointsSummariesForTravelGroup(
          current.travelGroupId,
          {
            prisma: tx,
            actor,
            ipAddress: metadata.ipAddress || null,
          },
        );

      await this.operationLogsService.appendLog(
        {
          userId: actor.id,
          action:
            destination === 'GUIDE_PERSONAL'
              ? 'sales_orders.points_destination.guide_personal'
              : 'sales_orders.points_destination.travel_agency',
          entityType: 'sales_order',
          entityId: current.id,
          beforeData: summarizeOrderPointsDestination(current),
          afterData: summarizeOrderPointsDestination(updated),
          requestSummary: {
            destinationChanged,
            personalAmountChanged,
            guideChanged,
            dailyRateChanged,
            monthlyRateChanged,
          },
          ipAddress: metadata.ipAddress || null,
        },
        tx,
      );

      return {
        changed: true,
        salesOrderId: current.id,
        travelGroupId: current.travelGroupId,
        guideId: updated.personalPointsGuideId,
        recalculation,
        ordinaryRefresh,
        guideRefresh,
      };
    });
  }

  async updateGuidePersonalOrderRates(
    actor: any,
    orderId: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, WRITE_ROLES);
    const id = normalizeRequiredString(orderId, 'orderId');
    return this.prisma.$transaction(async (tx: any) => {
      const current = await tx.salesOrder.findUnique({
        where: { id },
        include: {
          travelGroup: true,
          personalPointsGuide: true,
        },
      });
      if (!current) {
        throw createHttpError(
          404,
          'SALES_ORDER_NOT_FOUND',
          '销售订单不存在。',
        );
      }
      if (
        normalizePointsDestination(current.pointsDestination) !==
          'GUIDE_PERSONAL' ||
        !current.travelGroupId ||
        !current.personalPointsGuideId
      ) {
        throw createHttpError(
          400,
          'GUIDE_PERSONAL_ORDER_REQUIRED',
          '只有走个人的订单才能修改个人日返和月返比例。',
        );
      }
      const dailyRate =
        payload?.dailyRebateRate === undefined
          ? normalizeRateText(current.personalDailyRebateRate)
          : normalizeRate(payload.dailyRebateRate, 'dailyRebateRate');
      const monthlyRate =
        payload?.monthlyRebateRate === undefined
          ? normalizeRateText(current.personalMonthlyRebateRate)
          : normalizeRate(payload.monthlyRebateRate, 'monthlyRebateRate');
      if (
        payload?.dailyRebateRate === undefined &&
        payload?.monthlyRebateRate === undefined
      ) {
        throw createHttpError(
          400,
          'VALIDATION_FAILED',
          '至少需要提供一个要修改的比例。',
        );
      }
      const dailyRateChanged =
        dailyRate !== normalizeRateText(current.personalDailyRebateRate);
      const monthlyRateChanged =
        monthlyRate !== normalizeRateText(current.personalMonthlyRebateRate);
      if (!dailyRateChanged && !monthlyRateChanged) {
        return {
          changed: false,
          salesOrderId: current.id,
          travelGroupId: current.travelGroupId,
          guideId: current.personalPointsGuideId,
        };
      }
      const summary = await tx.guidePointsSummary.findUnique({
        where: {
          travelGroupId_guideId: {
            travelGroupId: current.travelGroupId,
            guideId: current.personalPointsGuideId,
          },
        },
      });
      assertRatesCanChange(summary, dailyRateChanged, monthlyRateChanged);

      const now = new Date();
      const updated = await tx.salesOrder.update({
        where: { id: current.id },
        data: {
          personalDailyRebateRate: dailyRate,
          personalMonthlyRebateRate: monthlyRate,
          personalRatesUpdatedById: actor.id,
          personalRatesUpdatedAt: now,
          updatedById: actor.id,
          updatedAt: now,
        },
        include: {
          travelGroup: true,
          personalPointsGuide: true,
        },
      });
      const recalculation =
        await this.commissionRecordsService.recalculateSalesOrderRecords(
          current.id,
          {
            prisma: tx,
            actor,
            ipAddress: metadata.ipAddress || null,
            trigger: 'guide_personal_order_rate_change',
          },
        );
      await this.travelGroupFinanceSummaryService.refreshTravelGroupFinanceSummary(
        current.travelGroupId,
        {
          prisma: tx,
          actor,
          ipAddress: metadata.ipAddress || null,
          syncCompatibilityFields: false,
        },
      );
      const guideRefresh =
        await this.refreshGuidePointsSummariesForTravelGroup(
          current.travelGroupId,
          {
            prisma: tx,
            actor,
            ipAddress: metadata.ipAddress || null,
          },
        );
      await this.operationLogsService.appendLog(
        {
          userId: actor.id,
          action: 'guide_points_orders.rates.update',
          entityType: 'sales_order',
          entityId: current.id,
          beforeData: summarizeOrderPointsDestination(current),
          afterData: summarizeOrderPointsDestination(updated),
          ipAddress: metadata.ipAddress || null,
        },
        tx,
      );
      return {
        changed: true,
        salesOrderId: current.id,
        travelGroupId: current.travelGroupId,
        guideId: current.personalPointsGuideId,
        recalculation,
        guideRefresh,
      };
    });
  }

  async setGuidePointsPaymentStatus(
    actor: any,
    id: string,
    pointsType: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, WRITE_ROLES);
    const summaryId = normalizeRequiredString(id, 'id');
    const type = normalizePointsType(pointsType);
    const isPaid = normalizeRequiredBoolean(
      payload?.isPaid ?? payload?.paid ?? payload?.confirm,
      'isPaid',
    );
    return this.prisma.$transaction(async (tx: any) => {
      const current = await tx.guidePointsSummary.findUnique({
        where: { id: summaryId },
        include: guidePointsSummaryInclude(),
      });
      if (!current) {
        throw createHttpError(
          404,
          'GUIDE_POINTS_SUMMARY_NOT_FOUND',
          '导游积分汇总不存在。',
        );
      }
      const now = new Date();
      const paidFacts = readGuidePaidFacts(current);
      if (type === 'daily') {
        paidFacts.paidDailyPointsCents = isPaid
          ? toInteger(current.totalDailyPointsCents)
          : 0;
      } else {
        paidFacts.paidMonthlyPointsCents = isPaid
          ? toInteger(current.totalMonthlyPointsCents)
          : 0;
      }
      const dailyPaid =
        type === 'daily' ? isPaid : Boolean(current.dailyPointsPaid);
      const monthlyPaid =
        type === 'monthly' ? isPaid : Boolean(current.monthlyPointsPaid);
      paidFacts.dailyPointsPaid = dailyPaid;
      paidFacts.monthlyPointsPaid = monthlyPaid;
      paidFacts.dailyPointsPaidAt =
        type === 'daily'
          ? isPaid
            ? now.toISOString()
            : null
          : dateString(current.dailyPointsPaidAt);
      paidFacts.monthlyPointsPaidAt =
        type === 'monthly'
          ? isPaid
            ? now.toISOString()
            : null
          : dateString(current.monthlyPointsPaidAt);
      const amounts = paymentAmounts(
        current.totalDailyPointsCents,
        current.totalMonthlyPointsCents,
        paidFacts,
      );
      const updated = await tx.guidePointsSummary.update({
        where: { id: current.id },
        data: {
          ...(type === 'daily'
            ? {
                dailyPointsPaid: isPaid,
                dailyPointsPaidById: isPaid ? actor.id : null,
                dailyPointsPaidAt: isPaid ? now : null,
              }
            : {
                monthlyPointsPaid: isPaid,
                monthlyPointsPaidById: isPaid ? actor.id : null,
                monthlyPointsPaidAt: isPaid ? now : null,
              }),
          ...persistedPaymentAmounts(amounts),
          sourceSnapshot: mergeGuidePaidFacts(
            current.sourceSnapshot,
            paidFacts,
          ),
          updatedById: actor.id,
          updatedAt: now,
        },
        include: guidePointsSummaryInclude(),
      });
      await this.operationLogsService.appendLog(
        {
          userId: actor.id,
          action: `guide_points_summaries.${type}_payment.${
            isPaid ? 'enable' : 'disable'
          }`,
          entityType: 'guide_points_summary',
          entityId: current.id,
          beforeData: summarizeGuideSummary(current),
          afterData: summarizeGuideSummary(updated),
          ipAddress: metadata.ipAddress || null,
        },
        tx,
      );
      return toGuidePointsSummaryDto(updated, true);
    });
  }

  async updateGuidePointsSummary(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, WRITE_ROLES);
    const summaryId = normalizeRequiredString(id, 'id');
    if (payload?.notes === undefined) {
      throw createHttpError(
        400,
        'VALIDATION_FAILED',
        'notes is required.',
      );
    }
    const current = await this.findVisibleSummaryOrThrow(summaryId);
    const updated = await this.prisma.guidePointsSummary.update({
      where: { id: current.id },
      data: {
        notes: normalizeOptionalString(payload.notes),
        updatedById: actor.id,
        updatedAt: new Date(),
      },
      include: guidePointsSummaryInclude(),
    });
    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'guide_points_summaries.update',
      entityType: 'guide_points_summary',
      entityId: current.id,
      beforeData: summarizeGuideSummary(current),
      afterData: summarizeGuideSummary(updated),
      ipAddress: metadata.ipAddress || null,
    });
    return toGuidePointsSummaryDto(updated, true);
  }

  async refreshGuidePointsSummariesForTravelGroup(
    travelGroupId: string,
    options: any = {},
  ) {
    const groupId = normalizeRequiredString(travelGroupId, 'travelGroupId');
    const prisma = options.prisma || this.prisma;
    const actor = options.actor || null;
    const travelGroup = await prisma.travelGroup.findUnique({
      where: { id: groupId },
    });
    if (!travelGroup) {
      throw createHttpError(
        404,
        'TRAVEL_GROUP_NOT_FOUND',
        '旅行团不存在。',
      );
    }
    const [
      orders,
      existingSummaries,
      salesDeductionRules,
      agencyDeductionRules,
      agencyRebateRules,
      commissionRules,
      travelAgencies,
    ] = await Promise.all([
      prisma.salesOrder.findMany({
        where: {
          travelGroupId: groupId,
          personalAmountCents: { gt: 0 },
          orderType: { notIn: ['AFTER_SALES', 'BUYBACK'] },
          OR: [
            { workflowStatus: null },
            { workflowStatus: { in: ['APPROVED', 'COMPLETED'] } },
          ],
        },
        include: guidePointsOrderCalculationInclude(),
        orderBy: [{ orderDate: 'asc' }, { orderNo: 'asc' }],
      }),
      prisma.guidePointsSummary.findMany({
        where: { travelGroupId: groupId },
      }),
      prisma.salesDeductionRule.findMany({ where: { isActive: true } }),
      prisma.agencyDeductionRule.findMany({ where: { isActive: true } }),
      prisma.agencyRebateRule.findMany({ where: { isActive: true } }),
      prisma.commissionRule.findMany({ where: { isActive: true } }),
      prisma.travelAgency.findMany(),
    ]);

    const ordersByGuide = new Map<string, any[]>();
    for (const order of orders) {
      const guideId = normalizeOptionalString(order.personalPointsGuideId);
      if (!guideId) {
        continue;
      }
      const values = ordersByGuide.get(guideId) || [];
      values.push(order);
      ordersByGuide.set(guideId, values);
    }
    const currentByGuide = new Map(
      existingSummaries.map((summary: any) => [summary.guideId, summary]),
    );
    const guideIds = uniqueStrings([
      ...ordersByGuide.keys(),
      ...currentByGuide.keys(),
    ]);
    const refreshed: any[] = [];

    for (const guideId of guideIds) {
      const guideOrders = ordersByGuide.get(guideId) || [];
      const current: any = currentByGuide.get(guideId) || null;
      const calculations = guideOrders.map((salesOrder: any) => ({
        salesOrder,
        calculation: calculateStage7CommissionAndPoints({
          salesOrder,
          salesDeductionRules,
          agencyDeductionRules,
          agencyRebateRules,
          commissionRules,
          travelAgencies,
        }),
      }));
      const data = buildGuideSummaryData({
        travelGroup,
        guideId,
        orders: guideOrders,
        calculations,
        current,
        actor,
      });
      const summary = current
        ? await prisma.guidePointsSummary.update({
            where: { id: current.id },
            data: {
              ...data,
              updatedAt: new Date(),
            },
          })
        : await prisma.guidePointsSummary.create({
            data: {
              id: crypto.randomUUID(),
              travelGroupId: groupId,
              guideId,
              ...data,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
      refreshed.push(summary);
      if (!current || guideSummaryAmountsChanged(current, summary)) {
        await this.operationLogsService.appendLog(
          {
            userId: actor?.id || null,
            action: 'guide_points_summaries.refresh',
            entityType: 'guide_points_summary',
            entityId: summary.id,
            beforeData: current ? summarizeGuideSummary(current) : null,
            afterData: summarizeGuideSummary(summary),
            ipAddress: options.ipAddress || null,
          },
          prisma,
        );
      }
    }
    return {
      travelGroupId: groupId,
      summaries: refreshed.map((summary) => summarizeGuideSummary(summary)),
    };
  }

  private async buildSummaryWhere(filters: any = {}) {
    const clauses: any[] = [{ orderCount: { gt: 0 } }];
    const summaryId = normalizeOptionalString(filters?.id);
    if (summaryId) {
      clauses.push({ id: summaryId });
    }
    const travelGroupId = normalizeOptionalString(filters?.travelGroupId);
    if (travelGroupId) {
      clauses.push({ travelGroupId });
    }
    const guideId = normalizeOptionalString(filters?.guideId);
    if (guideId) {
      clauses.push({ guideId });
    }
    const guideName = normalizeOptionalString(filters?.guideName);
    if (guideName) {
      clauses.push({ guideNameSnapshot: { contains: guideName } });
    }
    const dateRange = buildDateRange(filters?.dateFrom, filters?.dateTo);
    if (dateRange) {
      clauses.push({ travelGroup: { is: { visitDate: dateRange } } });
    }
    const query = normalizeOptionalString(filters?.query);
    if (query) {
      clauses.push({
        OR: [
          { guideNameSnapshot: { contains: query } },
          { travelGroup: { is: { groupNo: { contains: query } } } },
          {
            travelGroup: {
              is: { travelAgency: { contains: query } },
            },
          },
        ],
      });
    }
    if (await this.onlyShowMarkedRecords()) {
      clauses.push({ travelGroup: { is: { financeMark: true } } });
    }
    return andWhere(...clauses);
  }

  private async findVisibleSummaryOrThrow(id: string) {
    const summaryId = normalizeRequiredString(id, 'id');
    const summary = await this.prisma.guidePointsSummary.findFirst({
      where: await this.buildSummaryWhere({ id: summaryId }),
      include: guidePointsSummaryInclude(),
    });
    if (!summary) {
      throw createHttpError(
        404,
        'GUIDE_POINTS_SUMMARY_NOT_FOUND',
        '导游积分汇总不存在。',
      );
    }
    return summary;
  }

  private async onlyShowMarkedRecords() {
    if (!this.settingsService?.getGlobalMarkQuery) {
      return false;
    }
    const settings = await this.settingsService.getGlobalMarkQuery();
    return Boolean(settings.onlyShowMarkedRecords);
  }
}

async function resolveTargetPointsDestination(
  prisma: any,
  current: any,
  destination: string,
  payload: any,
) {
  if (destination === 'TRAVEL_AGENCY') {
    return {
      personalPointsGuideId: null,
      personalGuideNameSnapshot: null,
      personalDailyRebateRate: null,
      personalMonthlyRebateRate: null,
    };
  }
  const guideId =
    normalizeOptionalString(payload?.guideId) ||
    normalizeOptionalString(current.personalPointsGuideId) ||
    normalizeOptionalString(current.travelGroup?.guideId);
  if (!guideId) {
    throw createHttpError(
      400,
      'GUIDE_POINTS_GUIDE_REQUIRED',
      '请选择个人积分收款导游。',
    );
  }
  const guide = await prisma.guide.findUnique({ where: { id: guideId } });
  if (!guide || !guide.isActive) {
    throw createHttpError(
      400,
      'GUIDE_POINTS_GUIDE_INVALID',
      '个人积分收款导游必须是有效的导游档案。',
    );
  }
  const alreadyPersonal =
    normalizePointsDestination(current.pointsDestination) ===
    'GUIDE_PERSONAL';
  return {
    personalPointsGuideId: guide.id,
    personalGuideNameSnapshot: guide.name,
    personalDailyRebateRate:
      payload?.dailyRebateRate === undefined
        ? alreadyPersonal
          ? normalizeRateText(
              current.personalDailyRebateRate,
              DEFAULT_DAILY_RATE,
            )
          : DEFAULT_DAILY_RATE
        : normalizeRate(payload.dailyRebateRate, 'dailyRebateRate'),
    personalMonthlyRebateRate:
      payload?.monthlyRebateRate === undefined
        ? alreadyPersonal
          ? normalizeRateText(
              current.personalMonthlyRebateRate,
              DEFAULT_MONTHLY_RATE,
            )
          : DEFAULT_MONTHLY_RATE
        : normalizeRate(payload.monthlyRebateRate, 'monthlyRebateRate'),
  };
}

function buildGuideSummaryData(input: any) {
  const calculations = input.calculations || [];
  const current = input.current || null;
  const orders = input.orders || [];
  const firstOrder = orders[0] || null;
  const totalSalesAmountCents = sumCalculation(
    calculations,
    'personalAmountCents',
  );
  const confirmedRefundAmountCents = sumCalculation(
    calculations,
    'personalRefundAmountCents',
  );
  const effectiveSalesAmountCents = sumCalculation(
    calculations,
    'personalEffectiveAmountCents',
  );
  const totalLiquorCostDeductionCents = sumCalculation(
    calculations,
    'personalAgencyDeductionAmountCents',
  );
  const totalNetAmountCents = sumCalculation(
    calculations,
    'personalAgencyBaseAmountCents',
  );
  const totalDailyPointsCents = sumCalculation(
    calculations,
    'personalDailyRebateCents',
  );
  const totalMonthlyPointsCents = sumCalculation(
    calculations,
    'personalMonthlyRebateCents',
  );
  const totalCashOnDeliveryCents = orders.reduce(
    (sum: number, order: any) => {
      const personalAmountCents = toInteger(order.personalAmountCents);
      return (
        sum +
        allocateCentsByPersonalRatio(
          getSalesOrderCollectOnDeliveryAmountCents(order),
          order.totalAmountCents,
          personalAmountCents,
        ).personalAmountCents
      );
    },
    0,
  );
  const paidFacts = readGuidePaidFacts(current);
  const amounts = paymentAmounts(
    totalDailyPointsCents,
    totalMonthlyPointsCents,
    paidFacts,
  );
  const orderSnapshots = calculations.map((entry: any) =>
    buildGuideOrderSnapshot(entry.salesOrder, entry.calculation),
  );
  const afterSalesImpact = buildGuideAfterSalesImpact(
    orderSnapshots,
    current,
  );
  const sourceSnapshot = {
    calculationVersion: GUIDE_POINTS_CALCULATION_VERSION,
    travelGroup: {
      id: input.travelGroup.id,
      groupNo: input.travelGroup.groupNo || null,
      visitDate: dateString(input.travelGroup.visitDate),
      travelAgency: input.travelGroup.travelAgency || null,
      guideId: input.guideId,
      guideName:
        firstOrder?.personalGuideNameSnapshot ||
        firstOrder?.personalPointsGuide?.name ||
        current?.guideNameSnapshot ||
        null,
    },
    orderIds: orders.map((order: any) => order.id),
    orders: orderSnapshots,
    afterSalesImpact,
    paidFacts,
    amounts: {
      totalSalesAmountCents,
      confirmedRefundAmountCents,
      effectiveSalesAmountCents,
      totalLiquorCostDeductionCents,
      totalNetAmountCents,
      totalDailyPointsCents,
      totalMonthlyPointsCents,
      ...amounts,
    },
  };
  return {
    guideNameSnapshot:
      firstOrder?.personalGuideNameSnapshot ||
      firstOrder?.personalPointsGuide?.name ||
      current?.guideNameSnapshot ||
      '未知导游',
    orderCount: orders.length,
    totalSalesAmountCents,
    totalCashOnDeliveryCents,
    totalPaidDepositCents:
      totalSalesAmountCents - totalCashOnDeliveryCents,
    confirmedRefundAmountCents,
    effectiveSalesAmountCents,
    totalLiquorCostDeductionCents,
    totalNetAmountCents,
    totalDailyPointsCents,
    totalMonthlyPointsCents,
    ...persistedPaymentAmounts(amounts),
    dailyPointsPaid: Boolean(current?.dailyPointsPaid),
    dailyPointsPaidById: current?.dailyPointsPaid
      ? current.dailyPointsPaidById || null
      : null,
    dailyPointsPaidAt: current?.dailyPointsPaid
      ? current.dailyPointsPaidAt || null
      : null,
    monthlyPointsPaid: Boolean(current?.monthlyPointsPaid),
    monthlyPointsPaidById: current?.monthlyPointsPaid
      ? current.monthlyPointsPaidById || null
      : null,
    monthlyPointsPaidAt: current?.monthlyPointsPaid
      ? current.monthlyPointsPaidAt || null
      : null,
    notes: current?.notes || null,
    calculationVersion: GUIDE_POINTS_CALCULATION_VERSION,
    sourceSnapshot,
    updatedById: input.actor?.id || null,
  };
}

function buildGuideOrderSnapshot(salesOrder: any, calculation: any) {
  const amounts = calculation.pointsSplit;
  return {
    id: salesOrder.id,
    orderNo: salesOrder.orderNo || null,
    orderDate: dateString(salesOrder.orderDate),
    customerName: salesOrder.customerName || null,
    status: String(salesOrder.status || '').toLowerCase(),
    totalAmountCents: toInteger(amounts.totalAmountCents),
    personalAmountCents: toInteger(amounts.personalAmountCents),
    normalAmountCents: toInteger(amounts.normalAmountCents),
    grossAmountCents: toInteger(amounts.personalAmountCents),
    confirmedRefundAmountCents: toInteger(
      amounts.personalRefundAmountCents,
    ),
    personalRefundAmountCents: toInteger(
      amounts.personalRefundAmountCents,
    ),
    normalRefundAmountCents: toInteger(amounts.normalRefundAmountCents),
    personalEffectiveAmountCents: toInteger(
      amounts.personalEffectiveAmountCents,
    ),
    normalEffectiveAmountCents: toInteger(
      amounts.normalEffectiveAmountCents,
    ),
    effectiveAmountCents: toInteger(
      amounts.personalEffectiveAmountCents,
    ),
    liquorCostDeductionCents: toInteger(
      amounts.personalAgencyDeductionAmountCents,
    ),
    netAmountCents: toInteger(amounts.personalAgencyBaseAmountCents),
    guideId: salesOrder.personalPointsGuideId || null,
    guideName:
      salesOrder.personalGuideNameSnapshot ||
      salesOrder.personalPointsGuide?.name ||
      null,
    dailyRebateRate: normalizeRateText(
      salesOrder.personalDailyRebateRate,
    ),
    dailyPointsCents: toInteger(amounts.personalDailyRebateCents),
    monthlyRebateRate: normalizeRateText(
      salesOrder.personalMonthlyRebateRate,
    ),
    monthlyPointsCents: toInteger(amounts.personalMonthlyRebateCents),
    afterSalesOrders: (
      calculation.sourceSnapshot?.afterSalesOrders || []
    ).map((order: any) => ({
      id: order.id || null,
      afterSalesNo: order.afterSalesNo || null,
      status: String(order.status || '').toLowerCase(),
      refundAmountCents: toInteger(order.refundAmountCents),
      personalPointsRefundAmountCents: toInteger(
        order.personalPointsRefundAmountCents,
      ),
      normalPointsRefundAmountCents:
        toInteger(order.refundAmountCents) -
        toInteger(order.personalPointsRefundAmountCents),
      financeConfirmed: Boolean(order.financeConfirmed),
      financeConfirmedAt: dateString(order.financeConfirmedAt),
      createdAt: dateString(order.createdAt),
      updatedAt: dateString(order.updatedAt),
    })),
    warningCodes: (calculation.warnings || []).map(
      (warning: any) => warning.code,
    ),
  };
}

function buildGuideAfterSalesImpact(orders: any[], current: any) {
  const afterSalesOrders = orders.flatMap((order: any) =>
    (order.afterSalesOrders || []).map((afterSales: any) => ({
      ...afterSales,
      salesOrderId: order.id,
    })),
  );
  const pendingRefunds = afterSalesOrders.filter(
    (order: any) =>
      !order.financeConfirmed && toInteger(order.refundAmountCents) > 0,
  );
  const paidTimes = [
    current?.dailyPointsPaid
      ? timestamp(current.dailyPointsPaidAt)
      : null,
    current?.monthlyPointsPaid
      ? timestamp(current.monthlyPointsPaidAt)
      : null,
  ].filter((value): value is number => value !== null);
  const afterPaid = afterSalesOrders.filter((order: any) => {
    if (paidTimes.length === 0 || toInteger(order.refundAmountCents) <= 0) {
      return false;
    }
    const createdAt = timestamp(order.createdAt);
    return (
      createdAt === null ||
      paidTimes.some((paidAt) => createdAt > paidAt)
    );
  });
  const confirmedRefunds = afterSalesOrders.filter(
    (order: any) =>
      order.financeConfirmed && toInteger(order.refundAmountCents) > 0,
  );
  return {
    afterSalesOrderIds: afterSalesOrders
      .map((order: any) => order.id)
      .filter(Boolean),
    pendingRefundAmountCents: pendingRefunds.reduce(
      (sum: number, order: any) =>
        sum + toInteger(order.refundAmountCents),
      0,
    ),
    confirmedRefundAmountCents: confirmedRefunds.reduce(
      (sum: number, order: any) =>
        sum + toInteger(order.refundAmountCents),
      0,
    ),
    status:
      afterPaid.length > 0
        ? 'after_points_paid_requires_finance'
        : pendingRefunds.length > 0
          ? 'refund_pending_confirmation'
          : confirmedRefunds.length > 0
            ? 'refund_adjusted'
            : afterSalesOrders.length > 0
              ? 'after_sales_processing'
              : 'none',
  };
}

function assertOrdinarySummaryCanChange(summary: any) {
  if (!summary) {
    return;
  }
  if (summary.dailyRebatePaid || summary.monthlyRebatePaid) {
    throw createHttpError(
      409,
      'ORDINARY_POINTS_ALREADY_PAID',
      '受影响的普通积分汇总已标记日返或月返已返，请先取消对应的已返状态后再切换。',
    );
  }
}

function assertGuideSummaryCanChange(summary: any) {
  if (!summary) {
    return;
  }
  if (summary.dailyPointsPaid || summary.monthlyPointsPaid) {
    throw createHttpError(
      409,
      'GUIDE_POINTS_ALREADY_PAID',
      '受影响的导游积分汇总已标记日返或月返已返，请先取消对应的已返状态后再切换或更换收款导游。',
    );
  }
}

function assertRatesCanChange(
  summary: any,
  dailyRateChanged: boolean,
  monthlyRateChanged: boolean,
) {
  if (dailyRateChanged && summary?.dailyPointsPaid) {
    throw createHttpError(
      409,
      'GUIDE_DAILY_POINTS_ALREADY_PAID',
      '该导游积分汇总的日返已标记已返，请先取消日返已返状态后再修改日返比例。',
    );
  }
  if (monthlyRateChanged && summary?.monthlyPointsPaid) {
    throw createHttpError(
      409,
      'GUIDE_MONTHLY_POINTS_ALREADY_PAID',
      '该导游积分汇总的月返已标记已返，请先取消月返已返状态后再修改月返比例。',
    );
  }
}

function guidePointsSummaryInclude() {
  return {
    travelGroup: true,
    guide: true,
    dailyPointsPaidBy: {
      select: { id: true, name: true, username: true },
    },
    monthlyPointsPaidBy: {
      select: { id: true, name: true, username: true },
    },
    updatedBy: {
      select: { id: true, name: true, username: true },
    },
  };
}

function guidePointsOrderCalculationInclude() {
  return {
    items: { orderBy: { sortOrder: 'asc' } },
    paymentDetails: {
      select: {
        amountCents: true,
        paymentMethodCategorySnapshot: true,
      },
      orderBy: { sortOrder: 'asc' },
    },
    salesUser: { include: { leader: true } },
    outreachUser: true,
    travelGroup: true,
    personalPointsGuide: true,
    afterSalesOrders: { orderBy: { createdAt: 'asc' } },
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

function toGuidePointsSummaryDto(summary: any, includeOrders: boolean) {
  const snapshot = isPlainObject(summary.sourceSnapshot)
    ? summary.sourceSnapshot
    : {};
  const paidFacts = readGuidePaidFacts(summary);
  const amounts = paymentAmounts(
    summary.totalDailyPointsCents,
    summary.totalMonthlyPointsCents,
    paidFacts,
  );
  return {
    id: summary.id,
    travelGroupId: summary.travelGroupId,
    guideId: summary.guideId,
    guideNameSnapshot: summary.guideNameSnapshot,
    guide: summary.guide
      ? {
          id: summary.guide.id,
          name: summary.guide.name,
          phone: summary.guide.phone,
          isActive: Boolean(summary.guide.isActive),
        }
      : null,
    travelGroup: summary.travelGroup
      ? {
          id: summary.travelGroup.id,
          groupNo: summary.travelGroup.groupNo,
          visitDate: dateString(summary.travelGroup.visitDate),
          travelAgency: summary.travelGroup.travelAgency || null,
          guideId: summary.travelGroup.guideId || null,
          guideName: summary.travelGroup.guideName || null,
          licensePlate: summary.travelGroup.licensePlate || null,
          guestCount: toInteger(summary.travelGroup.guestCount),
          tasterName: summary.travelGroup.tasterName || null,
        }
      : null,
    orderCount: toInteger(summary.orderCount),
    totalSalesAmountCents: toInteger(summary.totalSalesAmountCents),
    totalCashOnDeliveryCents: toInteger(
      summary.totalCashOnDeliveryCents,
    ),
    totalPaidDepositCents: toInteger(summary.totalPaidDepositCents),
    confirmedRefundAmountCents: toInteger(
      summary.confirmedRefundAmountCents,
    ),
    effectiveSalesAmountCents: toInteger(
      summary.effectiveSalesAmountCents,
    ),
    totalLiquorCostDeductionCents: toInteger(
      summary.totalLiquorCostDeductionCents,
    ),
    totalNetAmountCents: toInteger(summary.totalNetAmountCents),
    totalDailyPointsCents: toInteger(summary.totalDailyPointsCents),
    totalMonthlyPointsCents: toInteger(summary.totalMonthlyPointsCents),
    ...amounts,
    dailyPointsPaid: Boolean(summary.dailyPointsPaid),
    dailyPointsPaidById: summary.dailyPointsPaidById || null,
    dailyPointsPaidBy: publicUser(summary.dailyPointsPaidBy),
    dailyPointsPaidAt: dateString(summary.dailyPointsPaidAt),
    monthlyPointsPaid: Boolean(summary.monthlyPointsPaid),
    monthlyPointsPaidById: summary.monthlyPointsPaidById || null,
    monthlyPointsPaidBy: publicUser(summary.monthlyPointsPaidBy),
    monthlyPointsPaidAt: dateString(summary.monthlyPointsPaidAt),
    notes: summary.notes || null,
    afterSalesImpact:
      isPlainObject(snapshot.afterSalesImpact)
        ? snapshot.afterSalesImpact
        : { status: 'none' },
    calculationVersion: summary.calculationVersion || null,
    ...(includeOrders
      ? {
          orders: Array.isArray(snapshot.orders)
            ? snapshot.orders
            : [],
          sourceSnapshot: snapshot,
        }
      : {}),
    updatedBy: publicUser(summary.updatedBy),
    createdAt: dateString(summary.createdAt),
    updatedAt: dateString(summary.updatedAt),
  };
}

function summarizeOrderPointsDestination(order: any) {
  const totalAmountCents = toInteger(order.totalAmountCents);
  const personalAmountCents =
    resolveSalesOrderPersonalAmountCents(order);
  return {
    id: order.id,
    orderNo: order.orderNo || null,
    travelGroupId: order.travelGroupId || null,
    pointsDestination: normalizePointsDestination(
      order.pointsDestination || 'TRAVEL_AGENCY',
    ),
    totalAmountCents,
    personalAmountCents,
    normalAmountCents: totalAmountCents - personalAmountCents,
    personalPointsGuideId: order.personalPointsGuideId || null,
    personalGuideNameSnapshot:
      order.personalGuideNameSnapshot || null,
    personalDailyRebateRate:
      order.personalDailyRebateRate === null ||
      order.personalDailyRebateRate === undefined
        ? null
        : normalizeRateText(order.personalDailyRebateRate),
    personalMonthlyRebateRate:
      order.personalMonthlyRebateRate === null ||
      order.personalMonthlyRebateRate === undefined
        ? null
        : normalizeRateText(order.personalMonthlyRebateRate),
    pointsDestinationChangedById:
      order.pointsDestinationChangedById || null,
    pointsDestinationChangedAt: dateString(
      order.pointsDestinationChangedAt,
    ),
    personalRatesUpdatedById: order.personalRatesUpdatedById || null,
    personalRatesUpdatedAt: dateString(order.personalRatesUpdatedAt),
  };
}

function summarizeGuideSummary(summary: any) {
  if (!summary) {
    return null;
  }
  return {
    id: summary.id,
    travelGroupId: summary.travelGroupId,
    guideId: summary.guideId,
    guideNameSnapshot: summary.guideNameSnapshot,
    orderCount: toInteger(summary.orderCount),
    totalSalesAmountCents: toInteger(summary.totalSalesAmountCents),
    confirmedRefundAmountCents: toInteger(
      summary.confirmedRefundAmountCents,
    ),
    effectiveSalesAmountCents: toInteger(
      summary.effectiveSalesAmountCents,
    ),
    totalLiquorCostDeductionCents: toInteger(
      summary.totalLiquorCostDeductionCents,
    ),
    totalNetAmountCents: toInteger(summary.totalNetAmountCents),
    totalDailyPointsCents: toInteger(summary.totalDailyPointsCents),
    totalMonthlyPointsCents: toInteger(summary.totalMonthlyPointsCents),
    paidPointsCents: toInteger(summary.paidPointsCents),
    unpaidPointsCents: toInteger(summary.unpaidPointsCents),
    dailyPointsPaid: Boolean(summary.dailyPointsPaid),
    dailyPointsPaidById: summary.dailyPointsPaidById || null,
    dailyPointsPaidAt: dateString(summary.dailyPointsPaidAt),
    monthlyPointsPaid: Boolean(summary.monthlyPointsPaid),
    monthlyPointsPaidById: summary.monthlyPointsPaidById || null,
    monthlyPointsPaidAt: dateString(summary.monthlyPointsPaidAt),
    notes: summary.notes || null,
    updatedById: summary.updatedById || null,
    updatedAt: dateString(summary.updatedAt),
  };
}

const GUIDE_SUMMARY_AMOUNT_FIELDS = [
  'orderCount',
  'totalSalesAmountCents',
  'totalCashOnDeliveryCents',
  'totalPaidDepositCents',
  'confirmedRefundAmountCents',
  'effectiveSalesAmountCents',
  'totalLiquorCostDeductionCents',
  'totalNetAmountCents',
  'totalDailyPointsCents',
  'totalMonthlyPointsCents',
  'paidPointsCents',
  'unpaidPointsCents',
];

function guideSummaryAmountsChanged(before: any, after: any) {
  return GUIDE_SUMMARY_AMOUNT_FIELDS.some(
    (field) => toInteger(before?.[field]) !== toInteger(after?.[field]),
  );
}

function readGuidePaidFacts(summary: any) {
  const snapshot = isPlainObject(summary?.sourceSnapshot)
    ? summary.sourceSnapshot
    : {};
  const existing = isPlainObject(snapshot.paidFacts)
    ? snapshot.paidFacts
    : {};
  const dailyPaid = Boolean(summary?.dailyPointsPaid);
  const monthlyPaid = Boolean(summary?.monthlyPointsPaid);
  return {
    paidDailyPointsCents: dailyPaid
      ? Math.max(
          0,
          toInteger(
            existing.paidDailyPointsCents ??
              summary?.totalDailyPointsCents ??
              0,
          ),
        )
      : 0,
    paidMonthlyPointsCents: monthlyPaid
      ? Math.max(
          0,
          toInteger(
            existing.paidMonthlyPointsCents ??
              summary?.totalMonthlyPointsCents ??
              0,
          ),
        )
      : 0,
    dailyPointsPaid: dailyPaid,
    monthlyPointsPaid: monthlyPaid,
    dailyPointsPaidAt: dateString(summary?.dailyPointsPaidAt),
    monthlyPointsPaidAt: dateString(summary?.monthlyPointsPaidAt),
  };
}

function paymentAmounts(
  totalDailyPointsCents: unknown,
  totalMonthlyPointsCents: unknown,
  paidFacts: any,
) {
  const dailyTotal = Math.max(0, toInteger(totalDailyPointsCents));
  const monthlyTotal = Math.max(0, toInteger(totalMonthlyPointsCents));
  const paidDailyPointsCents = paidFacts.dailyPointsPaid
    ? Math.max(0, toInteger(paidFacts.paidDailyPointsCents))
    : 0;
  const paidMonthlyPointsCents = paidFacts.monthlyPointsPaid
    ? Math.max(0, toInteger(paidFacts.paidMonthlyPointsCents))
    : 0;
  return {
    paidPointsCents:
      paidDailyPointsCents + paidMonthlyPointsCents,
    unpaidPointsCents:
      Math.max(0, dailyTotal - paidDailyPointsCents) +
      Math.max(0, monthlyTotal - paidMonthlyPointsCents),
    paidDailyPointsCents,
    unpaidDailyPointsCents: Math.max(
      0,
      dailyTotal - paidDailyPointsCents,
    ),
    paidMonthlyPointsCents,
    unpaidMonthlyPointsCents: Math.max(
      0,
      monthlyTotal - paidMonthlyPointsCents,
    ),
  };
}

function persistedPaymentAmounts(amounts: any) {
  return {
    paidPointsCents: toInteger(amounts?.paidPointsCents),
    unpaidPointsCents: toInteger(amounts?.unpaidPointsCents),
  };
}

function mergeGuidePaidFacts(sourceSnapshot: any, paidFacts: any) {
  return {
    ...(isPlainObject(sourceSnapshot) ? sourceSnapshot : {}),
    paidFacts,
  };
}

function sumCalculation(calculations: any[], field: string) {
  return calculations.reduce(
    (sum: number, entry: any) =>
      sum + toInteger(entry.calculation?.pointsSplit?.[field]),
    0,
  );
}

function buildGuidePointsExportWorkbook(summaries: any[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'jiangjiu-api';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet('导游积分表');
  worksheet.columns = [
    { header: '团号', key: 'groupNo', width: 20 },
    { header: '日期', key: 'visitDate', width: 14 },
    { header: '旅行社', key: 'travelAgency', width: 24 },
    { header: '收款导游', key: 'guideName', width: 18 },
    { header: '订单数', key: 'orderCount', width: 10 },
    { header: '销售额', key: 'sales', width: 14 },
    { header: '已确认退款', key: 'refund', width: 16 },
    { header: '有效销售额', key: 'effective', width: 16 },
    { header: '扣酒成本', key: 'deduction', width: 14 },
    { header: '上单金额', key: 'net', width: 14 },
    { header: '日返积分', key: 'daily', width: 14 },
    { header: '日返状态', key: 'dailyStatus', width: 14 },
    { header: '月返积分', key: 'monthly', width: 14 },
    { header: '月返状态', key: 'monthlyStatus', width: 14 },
    { header: '备注', key: 'notes', width: 28 },
  ];
  for (const key of [
    'sales',
    'refund',
    'effective',
    'deduction',
    'net',
    'daily',
    'monthly',
  ]) {
    const column = worksheet.getColumn(key);
    column.numFmt = '0.00';
  }
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: worksheet.columns.length },
  };
  worksheet.getRow(1).font = { bold: true };
  for (const summary of summaries) {
    worksheet.addRow({
      groupNo: summary.travelGroup?.groupNo || '',
      visitDate: dateString(summary.travelGroup?.visitDate)?.slice(0, 10) || '',
      travelAgency: summary.travelGroup?.travelAgency || '',
      guideName: summary.guideNameSnapshot || '',
      orderCount: toInteger(summary.orderCount),
      sales: centsToYuan(summary.totalSalesAmountCents),
      refund: centsToYuan(summary.confirmedRefundAmountCents),
      effective: centsToYuan(summary.effectiveSalesAmountCents),
      deduction: centsToYuan(summary.totalLiquorCostDeductionCents),
      net: centsToYuan(summary.totalNetAmountCents),
      daily: centsToYuan(summary.totalDailyPointsCents),
      dailyStatus: summary.dailyPointsPaid ? '已返' : '未返',
      monthly: centsToYuan(summary.totalMonthlyPointsCents),
      monthlyStatus: summary.monthlyPointsPaid ? '已返' : '未返',
      notes: summary.notes || '',
    });
  }
  return workbook;
}

function normalizePersonalAmountCents(payload: any, current: any) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(
      400,
      'PERSONAL_AMOUNT_INVALID',
      '请求体必须是对象。',
    );
  }
  const totalAmountCents = Number(current?.totalAmountCents || 0);
  if (Object.prototype.hasOwnProperty.call(payload, 'personalAmountCents')) {
    const value = payload.personalAmountCents;
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      throw createHttpError(
        400,
        'PERSONAL_AMOUNT_INVALID',
        '走个人金额必须使用整数分。',
      );
    }
    if (value < 0 || value > totalAmountCents) {
      throw createHttpError(
        400,
        'PERSONAL_AMOUNT_OUT_OF_RANGE',
        '走个人金额必须在 0 到订单总额之间。',
      );
    }
    return value;
  }
  const legacyDestination =
    payload.pointsDestination ?? payload.destination;
  if (legacyDestination === undefined || legacyDestination === null) {
    throw createHttpError(
      400,
      'PERSONAL_AMOUNT_REQUIRED',
      '新客户端必须提交调整后的走个人金额 personalAmountCents。',
    );
  }
  return normalizePointsDestination(legacyDestination) === 'GUIDE_PERSONAL'
    ? totalAmountCents
    : 0;
}

function assertPointsDestinationMatchesAmount(
  payload: any,
  derivedDestination: string,
) {
  const provided = payload?.pointsDestination ?? payload?.destination;
  if (provided === undefined || provided === null) {
    return;
  }
  if (normalizePointsDestination(provided) !== derivedDestination) {
    throw createHttpError(
      400,
      'POINTS_DESTINATION_AMOUNT_CONFLICT',
      'pointsDestination 与 personalAmountCents 不一致。',
    );
  }
}

function assertRefundAllocationsFitPersonalSplit(
  afterSalesOrders: any[],
  totalAmountCents: number,
  personalAmountCents: number,
) {
  let refundAmountCents = 0;
  let personalRefundAmountCents = 0;
  for (const order of Array.isArray(afterSalesOrders)
    ? afterSalesOrders
    : []) {
    const refund = Number(order?.refundAmountCents || 0);
    const personalRefund = Number(
      order?.personalPointsRefundAmountCents || 0,
    );
    if (
      !Number.isSafeInteger(refund) ||
      !Number.isSafeInteger(personalRefund) ||
      refund < 0 ||
      personalRefund < 0 ||
      personalRefund > refund
    ) {
      throw createHttpError(
        409,
        'PERSONAL_REFUND_ALLOCATION_INVALID',
        '现有售后退款的积分归属分配无效，请先修正退款分配。',
      );
    }
    refundAmountCents += refund;
    personalRefundAmountCents += personalRefund;
  }
  const normalRefundAmountCents =
    refundAmountCents - personalRefundAmountCents;
  const normalAmountCents = totalAmountCents - personalAmountCents;
  if (
    personalRefundAmountCents > personalAmountCents ||
    normalRefundAmountCents > normalAmountCents
  ) {
    throw createHttpError(
      409,
      'PERSONAL_REFUND_ALLOCATION_EXCEEDS_SPLIT',
      '现有退款分配超过调整后的走个人或正常金额，不能保存本次调整。',
    );
  }
}

function normalizePointsDestination(value: unknown) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase();
  if (['TRAVEL_AGENCY', 'GUIDE_PERSONAL'].includes(normalized)) {
    return normalized;
  }
  throw createHttpError(
    400,
    'POINTS_DESTINATION_INVALID',
    'pointsDestination 必须是 TRAVEL_AGENCY 或 GUIDE_PERSONAL。',
  );
}

function normalizeRate(value: unknown, fieldName: string) {
  const text =
    value && typeof value === 'object' && 'toString' in value
      ? (value as any).toString().trim()
      : String(value ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be a decimal between 0 and 1.`,
    );
  }
  const [integerPart, fractionPart = ''] = text.split('.');
  const scale = BigInt(10) ** BigInt(fractionPart.length);
  const scaled =
    BigInt(integerPart || '0') * scale + BigInt(fractionPart || '0');
  if (scaled < BigInt(0) || scaled > scale) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be between 0 and 1.`,
    );
  }
  const rounded =
    (scaled * BigInt(10000) + scale / BigInt(2)) / scale;
  return `${rounded / BigInt(10000)}.${String(
    rounded % BigInt(10000),
  ).padStart(4, '0')}`;
}

function normalizeRateText(
  value: unknown,
  fallback = DEFAULT_MONTHLY_RATE,
) {
  if (value === undefined || value === null) {
    return fallback;
  }
  try {
    return normalizeRate(value, 'rate');
  } catch {
    return fallback;
  }
}

function normalizePointsType(value: unknown) {
  const type = String(value || '').trim().toLowerCase();
  if (type === 'daily' || type === 'monthly') {
    return type;
  }
  throw createHttpError(
    400,
    'VALIDATION_FAILED',
    'pointsType must be daily or monthly.',
  );
}

function normalizeRequiredBoolean(value: unknown, fieldName: string) {
  if (typeof value === 'boolean') {
    return value;
  }
  throw createHttpError(
    400,
    'VALIDATION_FAILED',
    `${fieldName} must be a boolean.`,
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

function uniqueStrings(values: Iterable<unknown>) {
  return Array.from(
    new Set(
      Array.from(values)
        .map(normalizeOptionalString)
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function buildDateRange(dateFrom: unknown, dateTo: unknown) {
  const from = normalizeOptionalString(dateFrom);
  const to = normalizeOptionalString(dateTo);
  if (!from && !to) {
    return null;
  }
  const range: any = {};
  if (from) {
    range.gte = parseDate(from, false);
  }
  if (to) {
    range.lte = parseDate(to, true);
  }
  return range;
}

function parseDate(value: string, endOfDay: boolean) {
  const text = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'date must be YYYY-MM-DD.',
    );
  }
  const date = new Date(
    `${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`,
  );
  if (Number.isNaN(date.getTime())) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'date is invalid.',
    );
  }
  return date;
}

function normalizeTake(value: unknown) {
  const numberValue = Number(value || 100);
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    return 100;
  }
  return Math.min(numberValue, 500);
}

function normalizeExportLimit(value: unknown) {
  const numberValue = Number(value || EXPORT_MAX_ROWS);
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    return EXPORT_MAX_ROWS;
  }
  return Math.min(numberValue, EXPORT_MAX_ROWS);
}

function andWhere(...clauses: any[]) {
  const values = clauses.filter(
    (clause) => clause && Object.keys(clause).length > 0,
  );
  if (values.length === 0) {
    return {};
  }
  if (values.length === 1) {
    return values[0];
  }
  return { AND: values };
}

function publicUser(user: any) {
  return user
    ? {
        id: user.id,
        name: user.name || null,
        username: user.username || null,
      }
    : null;
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
      '当前角色无权修改订单走个人金额。',
    );
  }
}

function toInteger(value: unknown) {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : 0;
}

function dateString(value: unknown) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : String(value);
}

function timestamp(value: unknown) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function centsToYuan(value: unknown) {
  return Number((toInteger(value) / 100).toFixed(2));
}

function isPlainObject(value: any) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function summarizeFilters(filters: any) {
  return {
    dateFrom: normalizeOptionalString(filters?.dateFrom),
    dateTo: normalizeOptionalString(filters?.dateTo),
    travelGroupId: normalizeOptionalString(filters?.travelGroupId),
    guideId: normalizeOptionalString(filters?.guideId),
    guideName: normalizeOptionalString(filters?.guideName),
    query: normalizeOptionalString(filters?.query),
  };
}

function fileTimestamp(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    '-',
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join('');
}
