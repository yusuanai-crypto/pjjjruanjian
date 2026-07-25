import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import { calculateProductProfitSummary } from '../products/product-profit.helper';
import { SettingsNestService } from '../settings/settings.nest.service';
import {
  calculateAnalyticsMetrics,
  isEffectiveAnalyticsSalesOrder,
} from './analytics-calculation.helper';
import { normalizeAnalyticsDateRange } from './analytics-date-range.helper';
import {
  andWhere,
  buildAnalyticsAfterSalesOrderWhere,
  buildAnalyticsSalesOrderWhere,
  buildAnalyticsTravelGroupWhere,
} from './analytics-scope.helper';
import {
  buildSalesPerformanceDataset,
  isUnassignedSalesUserParam,
  SalesPerformanceDataset,
} from './analytics-sales-performance.helper';
import { calculateTravelGroupProfit } from './travel-group-profit.helper';

const ANALYTICS_READ_ROLES = ['admin', 'boss', 'finance', 'after_sales'];
const UNASSIGNED_TASTER_KEY = '__unassigned_taster__';
const UNASSIGNED_TASTER_NAME = '\u672a\u5206\u914d\u54c1\u9274\u5e08';
const GROSS_SALES_STATUS_VALUES = ['VALID', 'PARTIAL_REFUND', 'REFUNDED'];
const RANKING_SORT_FIELDS: Record<string, string> = {
  netSalesAmountCents: 'netSalesAmountCents',
  salesAmountCents: 'netSalesAmountCents',
  sales: 'netSalesAmountCents',
  totalGroupCount: 'totalGroupCount',
  groupCount: 'totalGroupCount',
  totalGuestCount: 'totalGuestCount',
  guestCount: 'totalGuestCount',
  averageSalesPerGroupCents: 'averageSalesPerGroupCents',
  averageSalesPerGuestCents: 'averageSalesPerGuestCents',
  noOrderRate: 'noOrderRate',
  conversionRate: 'conversionRate',
};
const TREND_METRICS = [
  'gross_sales',
  'refund',
  'net_sales',
  'groups',
  'guests',
  'no_order_rate',
];
const TREND_GRANULARITIES = ['day', 'month'];
const ANALYTICS_EXPORT_MAX_ROWS = 5000;

@Injectable()
export class AnalyticsNestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsNestService,
    private readonly settingsService: SettingsNestService,
  ) {}

  async getOverview(actor: any, query: any = {}) {
    requireAnyRole(actor, ANALYTICS_READ_ROLES);

    const range = normalizeAnalyticsDateRange({
      preset: query?.preset,
      dateFrom: query?.dateFrom,
      dateTo: query?.dateTo,
    });
    const dateRange = {
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
    };
    const { onlyShowMarkedRecords } =
      await this.settingsService.getGlobalMarkQuery();
    const groupFilter = buildTravelGroupFilter(query);
    const salesOrderGroupFilter = groupFilter
      ? { travelGroup: { is: groupFilter } }
      : null;
    const afterSalesGroupFilter = salesOrderGroupFilter
      ? { salesOrder: { is: salesOrderGroupFilter } }
      : null;
    const salesOrderWhere = buildAnalyticsSalesOrderWhere({
      onlyShowMarkedRecords,
      dateRange,
      baseWhere: salesOrderGroupFilter,
    });
    const afterSalesOrderWhere = buildAnalyticsAfterSalesOrderWhere({
      onlyShowMarkedRecords,
      dateRange,
      baseWhere: afterSalesGroupFilter,
    });
    const travelGroupWhere = buildAnalyticsTravelGroupWhere({
      onlyShowMarkedRecords,
      dateRange,
      baseWhere: groupFilter,
    });

    const [salesOrders, afterSalesOrders, travelGroups] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where: salesOrderWhere,
        include: getSalesOrderAnalyticsInclude(),
        orderBy: {
          orderDate: 'asc',
        },
      }),
      this.prisma.afterSalesOrder.findMany({
        where: afterSalesOrderWhere,
        orderBy: {
          createdAt: 'asc',
        },
      }),
      this.prisma.travelGroup.findMany({
        where: travelGroupWhere,
        orderBy: {
          visitDate: 'asc',
        },
      }),
    ]);
    const travelGroupIds = travelGroups
      .map((group: any) => normalizeOptionalString(group.id))
      .filter(Boolean);
    const groupSalesOrders = travelGroupIds.length
      ? await this.prisma.salesOrder.findMany({
          where: buildAnalyticsSalesOrderWhere({
            onlyShowMarkedRecords,
            baseWhere: {
              travelGroupId: {
                in: travelGroupIds,
              },
            },
          }),
          include: getSalesOrderAnalyticsInclude(),
          orderBy: {
            orderDate: 'asc',
          },
        })
      : [];
    const calculated = calculateAnalyticsMetrics({
      salesOrders,
      afterSalesOrders,
      travelGroups,
      groupSalesOrders,
    });

    // Stage 8 overview uses SalesOrder.orderDate for sales metrics,
    // AfterSalesOrder.createdAt for refund metrics, and TravelGroup.visitDate
    // for reception, per-group, per-guest, and no-order-rate metrics.
    return {
      range,
      metrics: calculated.metrics,
      warnings: calculated.warnings,
    };
  }

  async listSalesPerformance(actor: any, query: any = {}) {
    requireAnyRole(actor, ['admin', 'boss']);
    const result = await this.buildSalesPerformanceReadResult(query);
    return {
      range: result.range,
      salesPerformance: result.dataset.records,
    };
  }

  async getSalesPerformanceDetail(
    actor: any,
    salesUserIdParam: string,
    query: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'boss']);
    const result = await this.buildSalesPerformanceReadResult(query);
    const normalizedParam = normalizeOptionalString(salesUserIdParam);
    if (!normalizedParam) {
      throw createHttpError(
        400,
        'VALIDATION_FAILED',
        'salesUserId is required.',
      );
    }
    const salesUserId = isUnassignedSalesUserParam(normalizedParam)
      ? null
      : normalizedParam;
    const summary = result.dataset.records.find(
      (record) => record.salesUserId === salesUserId,
    );
    if (!summary) {
      throw createHttpError(
        404,
        'ANALYTICS_SALES_USER_NOT_FOUND',
        'No sales performance data exists for this sales user in the selected range.',
      );
    }

    return {
      range: result.range,
      salesUser: {
        id: summary.salesUserId,
        name: summary.salesUserName,
        isActive: summary.isActive,
        isUnassigned: summary.isUnassigned,
      },
      summary,
      orders: result.dataset.orders.filter(
        (order) => order.salesUserId === salesUserId,
      ),
    };
  }

  async exportSalesPerformanceXlsx(
    actor: any,
    query: any = {},
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'boss']);
    const result = await this.buildSalesPerformanceReadResult(query);
    const summaryRowCount = result.dataset.records.length;
    const detailRowCount = result.dataset.orders.length;
    const rowCount = summaryRowCount + detailRowCount;
    assertExportRowLimit(rowCount);

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'analytics.sales_performance.export',
      entityType: 'analytics_sales_performance',
      entityId: 'analytics.sales_performance.export',
      beforeData: null,
      afterData: {
        filters: summarizeExportFilters(query),
        rowCount,
        summaryRowCount,
        detailRowCount,
        rowCounts: {
          summary: summaryRowCount,
          details: detailRowCount,
        },
      },
      ipAddress: metadata.ipAddress || null,
    });

    const workbook = buildSalesPerformanceExportWorkbook(result.dataset);
    const xlsxData = await workbook.xlsx.writeBuffer();
    return {
      fileName: buildSalesPerformanceExportFileName(),
      buffer: Buffer.from(xlsxData as any),
      rowCount,
      rowCounts: {
        summary: summaryRowCount,
        details: detailRowCount,
      },
    };
  }

  async getProfitOverview(actor: any, query: any = {}) {
    requireAnyRole(actor, ['admin', 'finance']);
    const context = await this.buildAnalyticsReadContext(query);
    const salesOrderGroupFilter = context.groupFilter
      ? { travelGroup: { is: context.groupFilter } }
      : null;
    const orders = await this.prisma.salesOrder.findMany({
      where: buildAnalyticsSalesOrderWhere({
        onlyShowMarkedRecords: context.onlyShowMarkedRecords,
        dateRange: context.dateRange,
        baseWhere: salesOrderGroupFilter,
      }),
      include: getSalesOrderProfitAnalyticsInclude(),
      orderBy: { orderDate: 'asc' },
    });
    return {
      range: context.range,
      summary: calculateProductProfitSummary(orders),
    };
  }

  async listTravelGroupProfits(actor: any, query: any = {}) {
    requireAnyRole(actor, ['admin', 'boss']);
    const range = normalizeAnalyticsDateRange({
      preset: query?.preset,
      dateFrom: query?.dateFrom,
      dateTo: query?.dateTo,
    });
    const { onlyShowMarkedRecords } =
      await this.settingsService.getGlobalMarkQuery();
    const travelGroups = await this.prisma.travelGroup.findMany({
      where: buildAnalyticsTravelGroupWhere({
        onlyShowMarkedRecords,
        dateRange: {
          dateFrom: range.dateFrom,
          dateTo: range.dateTo,
        },
        baseWhere: buildTravelGroupProfitSearchFilter(query?.query),
      }),
      orderBy: {
        visitDate: 'desc',
      },
    });
    const travelGroupIds = travelGroups
      .map((group: any) => normalizeOptionalString(group?.id))
      .filter(Boolean);
    const salesOrders = travelGroupIds.length
      ? await this.prisma.salesOrder.findMany({
          where: buildAnalyticsSalesOrderWhere({
            onlyShowMarkedRecords,
            baseWhere: {
              travelGroupId: {
                in: travelGroupIds,
              },
            },
          }),
          include: getSalesOrderProfitAnalyticsInclude(),
          orderBy: {
            orderDate: 'asc',
          },
        })
      : [];
    const salesOrderIds = salesOrders
      .map((order: any) => normalizeOptionalString(order?.id))
      .filter(Boolean);
    const [commissionRecords, financeSummaries] = travelGroupIds.length
      ? await Promise.all([
          this.prisma.commissionRecord.findMany({
            where: {
              OR: [
                {
                  travelGroupId: {
                    in: travelGroupIds,
                  },
                },
                ...(salesOrderIds.length
                  ? [
                      {
                        salesOrderId: {
                          in: salesOrderIds,
                        },
                      },
                    ]
                  : []),
              ],
            },
          }),
          this.prisma.travelGroupFinanceSummary.findMany({
            where: {
              travelGroupId: {
                in: travelGroupIds,
              },
            },
          }),
        ])
      : [[], []];
    const ordersByTravelGroupId = groupRowsBy(
      salesOrders,
      (order: any) => normalizeOptionalString(order?.travelGroupId),
    );
    const commissionRecordsByTravelGroupId = groupCommissionRecordsByTravelGroup(
      commissionRecords,
      salesOrders,
    );
    const financeSummaryByTravelGroupId = new Map(
      financeSummaries
        .map((summary: any) => [
          normalizeOptionalString(summary?.travelGroupId),
          summary,
        ])
        .filter(([travelGroupId]) => Boolean(travelGroupId)) as Array<
        [string, any]
      >,
    );
    const status = normalizeTravelGroupProfitStatus(query?.status);
    const rows = travelGroups
      .map((travelGroup: any) => {
        const travelGroupId = normalizeOptionalString(travelGroup?.id) || '';
        return calculateTravelGroupProfit({
          travelGroup,
          salesOrders: ordersByTravelGroupId.get(travelGroupId) || [],
          commissionRecords:
            commissionRecordsByTravelGroupId.get(travelGroupId) || [],
          financeSummary:
            financeSummaryByTravelGroupId.get(travelGroupId) || null,
        });
      })
      .filter((row: any) => !status || row.calculationStatus === status);
    sortTravelGroupProfitRows(
      rows,
      normalizeTravelGroupProfitSortBy(query?.sortBy),
      normalizeSortDirection(query?.sortDirection),
    );
    const page = normalizePositivePage(query?.page);
    const pageSize = normalizeTravelGroupProfitPageSize(query?.pageSize);
    const total = rows.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;

    return {
      range: {
        preset: range.preset,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
      },
      summary: buildTravelGroupProfitSummary(rows),
      items: rows.slice(start, start + pageSize).map(toTravelGroupProfitDto),
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
    };
  }

  async exportOverviewXlsx(
    actor: any,
    query: any = {},
    metadata: any = {},
  ) {
    requireAnyRole(actor, ANALYTICS_READ_ROLES);

    const [overview, sourceOrders, sourceTravelGroups, sourceAfterSales] =
      await Promise.all([
        this.getOverview(actor, query),
        this.listSourceOrders(actor, { ...query, source: 'sales' }),
        this.listSourceTravelGroups(actor, query),
        this.listSourceAfterSales(actor, { ...query, source: 'refund' }),
      ]);
    const metricRows = buildOverviewMetricExportRows(overview);
    const rowCounts = {
      metrics: metricRows.length,
      orders: sourceOrders.orders.length,
      travelGroups: sourceTravelGroups.travelGroups.length,
      afterSalesOrders: sourceAfterSales.afterSalesOrders.length,
    };
    const rowCount = sumBy(Object.values(rowCounts), (value) => Number(value));
    assertExportRowLimit(rowCount);

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'analytics.overview.export',
      entityType: 'analytics_overview',
      entityId: 'analytics.overview.export',
      beforeData: null,
      afterData: {
        filters: summarizeExportFilters(query),
        rowCount,
        rowCounts,
      },
      ipAddress: metadata.ipAddress || null,
    });

    const workbook = buildAnalyticsOverviewExportWorkbook({
      overview,
      orders: sourceOrders.orders,
      travelGroups: sourceTravelGroups.travelGroups,
      afterSalesOrders: sourceAfterSales.afterSalesOrders,
      metricRows,
    });
    const xlsxData = await workbook.xlsx.writeBuffer();
    return {
      fileName: buildAnalyticsOverviewExportFileName(),
      buffer: Buffer.from(xlsxData as any),
      rowCount,
      rowCounts,
    };
  }

  async exportTasterRankingsXlsx(
    actor: any,
    query: any = {},
    metadata: any = {},
  ) {
    requireAnyRole(actor, ANALYTICS_READ_ROLES);

    const rankingsResult = await this.listTasterRankings(actor, query);
    const context = await this.buildAnalyticsReadContext(query);
    const travelGroups = await this.prisma.travelGroup.findMany({
      where: buildAnalyticsTravelGroupWhere({
        onlyShowMarkedRecords: context.onlyShowMarkedRecords,
        dateRange: context.dateRange,
        baseWhere: context.groupFilter,
      }),
      orderBy: {
        visitDate: 'asc',
      },
    });
    const groupSalesOrders = await this.findSalesOrdersForTravelGroups(
      travelGroups,
      context.onlyShowMarkedRecords,
    );
    const detailRows = buildTasterRankingDetailExportRows(
      rankingsResult.rankings,
      travelGroups,
      groupSalesOrders,
    );
    const rowCounts = {
      rankings: rankingsResult.rankings.length,
      details: detailRows.length,
    };
    const rowCount = rowCounts.rankings + rowCounts.details;
    assertExportRowLimit(rowCount);

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'analytics.taster_rankings.export',
      entityType: 'analytics_taster_ranking',
      entityId: 'analytics.taster_rankings.export',
      beforeData: null,
      afterData: {
        filters: summarizeExportFilters(query),
        rowCount,
        rowCounts,
      },
      ipAddress: metadata.ipAddress || null,
    });

    const workbook = buildAnalyticsTasterRankingsExportWorkbook({
      range: rankingsResult.range,
      rankings: rankingsResult.rankings,
      details: detailRows,
    });
    const xlsxData = await workbook.xlsx.writeBuffer();
    return {
      fileName: buildAnalyticsTasterRankingsExportFileName(),
      buffer: Buffer.from(xlsxData as any),
      rowCount,
      rowCounts,
    };
  }

  async listTrends(actor: any, query: any = {}) {
    requireAnyRole(actor, ANALYTICS_READ_ROLES);

    const context = await this.buildAnalyticsReadContext(query);
    const granularity = normalizeTrendGranularity(query?.granularity);
    const metric = normalizeTrendMetric(query?.metric);
    const trends = buildEmptyTrendPoints(
      context.range.dateFrom,
      context.range.dateTo,
      metric,
      granularity,
    );

    if (metric === 'gross_sales' || metric === 'net_sales') {
      const salesOrderGroupFilter = context.groupFilter
        ? { travelGroup: { is: context.groupFilter } }
        : null;
      const salesOrders = await this.prisma.salesOrder.findMany({
        where: buildAnalyticsSalesOrderWhere({
          onlyShowMarkedRecords: context.onlyShowMarkedRecords,
          dateRange: context.dateRange,
          baseWhere: andWhere(salesOrderGroupFilter, {
            status: {
              in: GROSS_SALES_STATUS_VALUES,
            },
          }),
        }),
        include: getSalesOrderAnalyticsInclude(),
        orderBy: {
          orderDate: 'asc',
        },
      });
      for (const order of salesOrders) {
        const point = findTrendPointForDate(
          trends,
          toDateOnly(order?.orderDate),
        );
        if (!point) {
          continue;
        }
        const amounts = summarizeOrderAmounts(order);
        point.grossSalesAmountCents += amounts.grossSalesAmountCents;
        point.refundAmountCents += amounts.refundAmountCents;
        point.pendingRefundAmountCents += amounts.pendingRefundAmountCents;
      }
      finalizeMoneyTrendPoints(trends, metric);
    } else if (metric === 'refund') {
      const afterSalesGroupFilter = context.groupFilter
        ? { salesOrder: { is: { travelGroup: { is: context.groupFilter } } } }
        : null;
      const afterSalesOrders = await this.prisma.afterSalesOrder.findMany({
        where: buildAnalyticsAfterSalesOrderWhere({
          onlyShowMarkedRecords: context.onlyShowMarkedRecords,
          dateRange: context.dateRange,
          baseWhere: afterSalesGroupFilter,
        }),
        include: getAfterSalesAnalyticsInclude(),
        orderBy: {
          createdAt: 'asc',
        },
      });
      for (const afterSalesOrder of afterSalesOrders) {
        const refundAmountCents = Number(
          afterSalesOrder?.refundAmountCents || 0,
        );
        if (refundAmountCents <= 0) {
          continue;
        }
        const point = findTrendPointForDate(
          trends,
          toDateOnly(afterSalesOrder?.createdAt),
        );
        if (!point) {
          continue;
        }
        if (afterSalesOrder?.financeConfirmed) {
          point.refundAmountCents += refundAmountCents;
        } else {
          point.pendingRefundAmountCents += refundAmountCents;
        }
      }
      finalizeMoneyTrendPoints(trends, metric);
    } else {
      const travelGroups = await this.prisma.travelGroup.findMany({
        where: buildAnalyticsTravelGroupWhere({
          onlyShowMarkedRecords: context.onlyShowMarkedRecords,
          dateRange: context.dateRange,
          baseWhere: context.groupFilter,
        }),
        orderBy: {
          visitDate: 'asc',
        },
      });
      const groupSalesOrders = await this.findSalesOrdersForTravelGroups(
        travelGroups,
        context.onlyShowMarkedRecords,
      );
      for (const point of trends) {
        const periodGroups = travelGroups.filter((group: any) =>
          isDateInTrendPeriod(toDateOnly(group?.visitDate), point),
        );
        applyGroupMetricsToTrendPoint(
          point,
          periodGroups,
          groupSalesOrders,
          metric,
        );
      }
    }

    return {
      range: context.range,
      granularity,
      metric,
      trends,
    };
  }

  async listTasterRankings(actor: any, query: any = {}) {
    requireAnyRole(actor, ANALYTICS_READ_ROLES);

    const range = normalizeAnalyticsDateRange({
      preset: query?.preset,
      dateFrom: query?.dateFrom,
      dateTo: query?.dateTo,
    });
    const dateRange = {
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
    };
    const { onlyShowMarkedRecords } =
      await this.settingsService.getGlobalMarkQuery();
    const groupFilter = buildTravelGroupFilter(query);
    const travelGroupWhere = buildAnalyticsTravelGroupWhere({
      onlyShowMarkedRecords,
      dateRange,
      baseWhere: groupFilter,
    });

    const travelGroups = await this.prisma.travelGroup.findMany({
      where: travelGroupWhere,
      orderBy: {
        visitDate: 'asc',
      },
    });
    const travelGroupIds = travelGroups
      .map((group: any) => normalizeOptionalString(group.id))
      .filter(Boolean);
    const groupSalesOrders = travelGroupIds.length
      ? await this.prisma.salesOrder.findMany({
          where: buildAnalyticsSalesOrderWhere({
            onlyShowMarkedRecords,
            baseWhere: {
              travelGroupId: {
                in: travelGroupIds,
              },
            },
          }),
          include: getSalesOrderAnalyticsInclude(),
          orderBy: {
            orderDate: 'asc',
          },
        })
      : [];

    return {
      range,
      rankings: buildTasterRankingRows(
        travelGroups,
        groupSalesOrders,
        query,
      ),
    };
  }

  async getTasterRankingDetail(
    actor: any,
    tasterIdParam: string,
    query: any = {},
  ) {
    requireAnyRole(actor, ANALYTICS_READ_ROLES);

    const context = await this.buildAnalyticsReadContext(query);
    const rankingTravelGroups = await this.prisma.travelGroup.findMany({
      where: buildAnalyticsTravelGroupWhere({
        onlyShowMarkedRecords: context.onlyShowMarkedRecords,
        dateRange: context.dateRange,
        baseWhere: context.groupFilter,
      }),
      orderBy: {
        visitDate: 'asc',
      },
    });
    const rankingGroupSalesOrders = await this.findSalesOrdersForTravelGroups(
      rankingTravelGroups,
      context.onlyShowMarkedRecords,
    );
    const rankings = buildTasterRankingRows(
      rankingTravelGroups,
      rankingGroupSalesOrders,
      query,
    );
    const target = normalizeTasterTarget(tasterIdParam);
    const summary = rankings.find((row) =>
      matchesTasterTarget(row.tasterId, target),
    );
    if (!summary) {
      throw createHttpError(
        404,
        'ANALYTICS_TASTER_NOT_FOUND',
        'No analytics data exists for this taster in the selected range.',
      );
    }

    const travelGroups = rankingTravelGroups.filter((group: any) =>
      matchesTravelGroupTasterTarget(group, target),
    );
    const travelGroupIds = new Set(
      travelGroups
        .map((group: any) => normalizeOptionalString(group.id))
        .filter(Boolean),
    );
    const salesOrders = rankingGroupSalesOrders.filter((order: any) =>
      travelGroupIds.has(normalizeOptionalString(order.travelGroupId) || ''),
    );
    const orderById = buildOrderById(salesOrders);
    const afterSalesOrders = salesOrders.flatMap((order: any) =>
      getOrderAfterSalesOrders(order),
    );

    return {
      range: context.range,
      taster: {
        id: summary.tasterId,
        name: summary.tasterName,
      },
      summary,
      travelGroups: travelGroups.map((group: any) =>
        toSourceTravelGroupDto(group, salesOrders),
      ),
      orders: salesOrders.map(toSourceOrderDto),
      afterSalesOrders: afterSalesOrders.map((order: any) =>
        toSourceAfterSalesOrderDto(
          order,
          orderById.get(normalizeOptionalString(order.salesOrderId) || ''),
        ),
      ),
      warnings: summary.warnings,
    };
  }

  async listSourceOrders(actor: any, query: any = {}) {
    requireAnyRole(actor, ANALYTICS_READ_ROLES);

    const context = await this.buildAnalyticsReadContext(query);
    const source = normalizeAnalyticsSource(query?.source || query?.metric, 'sales');
    const orders = await this.findSourceOrders(context, source);
    return {
      range: context.range,
      source,
      orders: orders.map(toSourceOrderDto),
    };
  }

  async listSourceTravelGroups(actor: any, query: any = {}) {
    requireAnyRole(actor, ANALYTICS_READ_ROLES);

    const context = await this.buildAnalyticsReadContext(query);
    const travelGroups = await this.prisma.travelGroup.findMany({
      where: buildAnalyticsTravelGroupWhere({
        onlyShowMarkedRecords: context.onlyShowMarkedRecords,
        dateRange: context.dateRange,
        baseWhere: context.groupFilter,
      }),
      orderBy: {
        visitDate: 'asc',
      },
    });
    const groupSalesOrders = await this.findSalesOrdersForTravelGroups(
      travelGroups,
      context.onlyShowMarkedRecords,
    );
    const onlyNoEffective = normalizeBoolean(query?.noEffectiveOrder);
    const filteredGroups = onlyNoEffective
      ? travelGroups.filter((group: any) =>
          isNoEffectiveTravelGroup(group, groupSalesOrders),
        )
      : travelGroups;

    return {
      range: context.range,
      travelGroups: filteredGroups.map((group: any) =>
        toSourceTravelGroupDto(group, groupSalesOrders),
      ),
    };
  }

  async listSourceAfterSales(actor: any, query: any = {}) {
    requireAnyRole(actor, ANALYTICS_READ_ROLES);

    const context = await this.buildAnalyticsReadContext(query);
    const source = normalizeAnalyticsSource(query?.source || query?.metric, 'refund');
    let afterSalesOrders: any[] = [];
    let orderById = new Map<string, any>();
    if (source === 'group_scoped' || source === 'taster') {
      const travelGroups = await this.prisma.travelGroup.findMany({
        where: buildAnalyticsTravelGroupWhere({
          onlyShowMarkedRecords: context.onlyShowMarkedRecords,
          dateRange: context.dateRange,
          baseWhere: context.groupFilter,
        }),
        orderBy: {
          visitDate: 'asc',
        },
      });
      const salesOrders = await this.findSalesOrdersForTravelGroups(
        travelGroups,
        context.onlyShowMarkedRecords,
      );
      orderById = buildOrderById(salesOrders);
      afterSalesOrders = salesOrders.flatMap((order: any) =>
        getOrderAfterSalesOrders(order),
      );
    } else {
      const afterSalesGroupFilter = context.groupFilter
        ? { salesOrder: { is: { travelGroup: { is: context.groupFilter } } } }
        : null;
      afterSalesOrders = await this.prisma.afterSalesOrder.findMany({
        where: buildAnalyticsAfterSalesOrderWhere({
          onlyShowMarkedRecords: context.onlyShowMarkedRecords,
          dateRange: context.dateRange,
          baseWhere: afterSalesGroupFilter,
        }),
        include: getAfterSalesAnalyticsInclude(),
        orderBy: {
          createdAt: 'asc',
        },
      });
      orderById = buildOrderById(
        afterSalesOrders
          .map((order: any) => order.salesOrder)
          .filter(Boolean),
      );
    }

    return {
      range: context.range,
      source,
      afterSalesOrders: afterSalesOrders
        .filter((order: any) => Number(order?.refundAmountCents || 0) > 0)
        .map((order: any) =>
          toSourceAfterSalesOrderDto(
            order,
            orderById.get(normalizeOptionalString(order.salesOrderId) || ''),
          ),
        ),
    };
  }

  private async buildAnalyticsReadContext(query: any = {}) {
    const range = normalizeAnalyticsDateRange({
      preset: query?.preset,
      dateFrom: query?.dateFrom,
      dateTo: query?.dateTo,
    });
    const { onlyShowMarkedRecords } =
      await this.settingsService.getGlobalMarkQuery();
    return {
      range,
      dateRange: {
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
      },
      onlyShowMarkedRecords,
      groupFilter: buildTravelGroupFilter(query),
    };
  }

  private async buildSalesPerformanceReadResult(query: any = {}) {
    const range = normalizeAnalyticsDateRange({
      preset: query?.preset,
      dateFrom: query?.dateFrom,
      dateTo: query?.dateTo,
    });
    const dateRange = {
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
    };
    const { onlyShowMarkedRecords } =
      await this.settingsService.getGlobalMarkQuery();
    const [salesUsers, salesOrders, afterSalesOrders] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          role: 'SALES',
        },
        orderBy: {
          name: 'asc',
        },
      }),
      this.prisma.salesOrder.findMany({
        where: buildAnalyticsSalesOrderWhere({
          onlyShowMarkedRecords,
          dateRange,
          baseWhere: {
            status: {
              in: GROSS_SALES_STATUS_VALUES,
            },
          },
        }),
        include: getSalesPerformanceSalesOrderInclude(),
        orderBy: {
          orderDate: 'asc',
        },
      }),
      this.prisma.afterSalesOrder.findMany({
        where: buildAnalyticsAfterSalesOrderWhere({
          onlyShowMarkedRecords,
          dateRange,
          baseWhere: {
            financeConfirmed: true,
            refundAmountCents: {
              gt: 0,
            },
          },
        }),
        include: getSalesPerformanceAfterSalesInclude(),
        orderBy: {
          createdAt: 'asc',
        },
      }),
    ]);
    return {
      range,
      dataset: buildSalesPerformanceDataset({
        salesUsers,
        salesOrders,
        afterSalesOrders,
        sortBy: query?.sortBy,
        sortDirection: query?.sortDirection,
      }),
    };
  }

  private async findSalesOrdersForTravelGroups(
    travelGroups: any[],
    onlyShowMarkedRecords: boolean,
  ) {
    const travelGroupIds = travelGroups
      .map((group: any) => normalizeOptionalString(group.id))
      .filter(Boolean);
    if (travelGroupIds.length === 0) {
      return [];
    }
    return this.prisma.salesOrder.findMany({
      where: buildAnalyticsSalesOrderWhere({
        onlyShowMarkedRecords,
        baseWhere: {
          travelGroupId: {
            in: travelGroupIds,
          },
        },
      }),
      include: getSalesOrderAnalyticsInclude(),
      orderBy: {
        orderDate: 'asc',
      },
    });
  }

  private async findSourceOrders(context: any, source: string) {
    if (source === 'refund') {
      const afterSalesGroupFilter = context.groupFilter
        ? { salesOrder: { is: { travelGroup: { is: context.groupFilter } } } }
        : null;
      const afterSalesOrders = (
        await this.prisma.afterSalesOrder.findMany({
          where: buildAnalyticsAfterSalesOrderWhere({
            onlyShowMarkedRecords: context.onlyShowMarkedRecords,
            dateRange: context.dateRange,
            baseWhere: afterSalesGroupFilter,
          }),
          include: getAfterSalesAnalyticsInclude(),
          orderBy: {
            createdAt: 'asc',
          },
        })
      ).filter((order: any) => Number(order?.refundAmountCents || 0) > 0);
      const salesOrderIds = [
        ...new Set(
          afterSalesOrders
            .map((order: any) => normalizeOptionalString(order.salesOrderId))
            .filter(Boolean),
        ),
      ];
      if (salesOrderIds.length === 0) {
        return [];
      }
      const afterSalesBySalesOrderId = groupAfterSalesBySalesOrderId(
        afterSalesOrders,
      );
      const orders = await this.prisma.salesOrder.findMany({
        where: buildAnalyticsSalesOrderWhere({
          onlyShowMarkedRecords: context.onlyShowMarkedRecords,
          baseWhere: {
            id: {
              in: salesOrderIds,
            },
          },
        }),
        include: getSalesOrderAnalyticsInclude(),
        orderBy: {
          orderDate: 'asc',
        },
      });
      return orders.map((order: any) => ({
        ...order,
        afterSalesOrders:
          afterSalesBySalesOrderId.get(normalizeOptionalString(order.id) || '') ||
          [],
      }));
    }

    if (source === 'group_scoped' || source === 'taster') {
      const travelGroups = await this.prisma.travelGroup.findMany({
        where: buildAnalyticsTravelGroupWhere({
          onlyShowMarkedRecords: context.onlyShowMarkedRecords,
          dateRange: context.dateRange,
          baseWhere: context.groupFilter,
        }),
        orderBy: {
          visitDate: 'asc',
        },
      });
      return this.findSalesOrdersForTravelGroups(
        travelGroups,
        context.onlyShowMarkedRecords,
      );
    }

    const salesOrderGroupFilter = context.groupFilter
      ? { travelGroup: { is: context.groupFilter } }
      : null;
    return this.prisma.salesOrder.findMany({
      where: buildAnalyticsSalesOrderWhere({
        onlyShowMarkedRecords: context.onlyShowMarkedRecords,
        dateRange: context.dateRange,
        baseWhere: andWhere(salesOrderGroupFilter, {
          status: {
            in: GROSS_SALES_STATUS_VALUES,
          },
        }),
      }),
      include: getSalesOrderAnalyticsInclude(),
      orderBy: {
        orderDate: 'asc',
      },
    });
  }
}

function getSalesOrderAnalyticsInclude() {
  return {
    customer: true,
    travelGroup: true,
    items: true,
    afterSalesOrders: true,
  };
}

function getSalesPerformanceSalesOrderInclude() {
  return {
    salesUser: true,
  };
}

function getSalesPerformanceAfterSalesInclude() {
  return {
    salesOrder: {
      include: getSalesPerformanceSalesOrderInclude(),
    },
  };
}

function getSalesOrderProfitAnalyticsInclude() {
  return {
    items: true,
    afterSalesOrders: true,
    commissionRecords: true,
  };
}

function buildTravelGroupProfitSearchFilter(value: unknown) {
  const query = normalizeOptionalString(value);
  if (!query) {
    return null;
  }
  return {
    OR: [
      { groupNo: { contains: query } },
      { travelAgency: { contains: query } },
      { guideName: { contains: query } },
      { tasterName: { contains: query } },
    ],
  };
}

function groupRowsBy<T>(
  rows: T[],
  keyOf: (row: T) => string | null,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) {
      continue;
    }
    grouped.set(key, [...(grouped.get(key) || []), row]);
  }
  return grouped;
}

function groupCommissionRecordsByTravelGroup(
  commissionRecords: any[],
  salesOrders: any[],
) {
  const travelGroupIdBySalesOrderId = new Map(
    salesOrders
      .map((order: any) => [
        normalizeOptionalString(order?.id),
        normalizeOptionalString(order?.travelGroupId),
      ])
      .filter(
        ([salesOrderId, travelGroupId]) =>
          Boolean(salesOrderId) && Boolean(travelGroupId),
      ) as Array<[string, string]>,
  );
  return groupRowsBy(commissionRecords, (record: any) => {
    const directTravelGroupId = normalizeOptionalString(record?.travelGroupId);
    if (directTravelGroupId) {
      return directTravelGroupId;
    }
    const salesOrderId = normalizeOptionalString(record?.salesOrderId);
    return salesOrderId
      ? travelGroupIdBySalesOrderId.get(salesOrderId) || null
      : null;
  });
}

function normalizeTravelGroupProfitStatus(value: unknown) {
  const status = normalizeOptionalString(value)?.toLowerCase();
  if (!status || status === 'all') {
    return null;
  }
  if (['complete', 'estimated', 'incomplete', 'no_sales'].includes(status)) {
    return status;
  }
  throw createHttpError(
    400,
    'VALIDATION_FAILED',
    'status must be complete, estimated, incomplete, or no_sales.',
  );
}

function normalizeTravelGroupProfitSortBy(value: unknown) {
  const sortBy = normalizeOptionalString(value) || 'visitDate';
  if (
    [
      'visitDate',
      'effectiveSalesAmountCents',
      'estimatedProfitCents',
      'estimatedProfitRate',
    ].includes(sortBy)
  ) {
    return sortBy;
  }
  throw createHttpError(
    400,
    'VALIDATION_FAILED',
    'sortBy must be visitDate, effectiveSalesAmountCents, estimatedProfitCents, or estimatedProfitRate.',
  );
}

function sortTravelGroupProfitRows(
  rows: any[],
  sortBy: string,
  sortDirection: string,
) {
  const multiplier = sortDirection === 'asc' ? 1 : -1;
  rows.sort((left, right) => {
    const leftValue = left?.[sortBy];
    const rightValue = right?.[sortBy];
    if (leftValue === null || leftValue === undefined) {
      return rightValue === null || rightValue === undefined ? 0 : 1;
    }
    if (rightValue === null || rightValue === undefined) {
      return -1;
    }
    const comparison =
      typeof leftValue === 'string' || typeof rightValue === 'string'
        ? String(leftValue).localeCompare(String(rightValue))
        : Number(leftValue) - Number(rightValue);
    if (comparison !== 0) {
      return comparison * multiplier;
    }
    const visitDateComparison = String(right?.visitDate || '').localeCompare(
      String(left?.visitDate || ''),
    );
    if (visitDateComparison !== 0) {
      return visitDateComparison;
    }
    return String(left?.groupNo || '').localeCompare(
      String(right?.groupNo || ''),
      'zh-Hans-CN',
    );
  });
}

function normalizePositivePage(value: unknown) {
  const text = normalizeOptionalString(value);
  if (!text) {
    return 1;
  }
  const page = Number(text);
  if (!Number.isInteger(page) || page < 1) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'page must be a positive integer.',
    );
  }
  return page;
}

function normalizeTravelGroupProfitPageSize(value: unknown) {
  const text = normalizeOptionalString(value);
  if (!text) {
    return 50;
  }
  const pageSize = Number(text);
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'pageSize must be a positive integer.',
    );
  }
  return Math.min(pageSize, 200);
}

function buildTravelGroupProfitSummary(rows: any[]) {
  const incompleteGroupCount = rows.filter(
    (row) => row.calculationStatus === 'incomplete',
  ).length;
  const effectiveSalesAmountCents = sumBy(
    rows,
    (row) => Number(row.effectiveSalesAmountCents || 0),
  );
  const knownEstimatedProfitCents = sumBy(
    rows.filter((row) => row.estimatedProfitCents !== null),
    (row) => Number(row.estimatedProfitCents || 0),
  );
  const estimatedProfitCents =
    incompleteGroupCount > 0 ? null : knownEstimatedProfitCents;
  return {
    groupCount: rows.length,
    completeGroupCount: rows.filter(
      (row) => row.calculationStatus === 'complete',
    ).length,
    estimatedGroupCount: rows.filter(
      (row) => row.calculationStatus === 'estimated',
    ).length,
    incompleteGroupCount,
    noSalesGroupCount: rows.filter(
      (row) => row.calculationStatus === 'no_sales',
    ).length,
    effectiveSalesAmountCents,
    actualProductCostCents: sumBy(
      rows,
      (row) => Number(row.actualProductCostCents || 0),
    ),
    totalExpenseCents: sumBy(
      rows,
      (row) => Number(row.totalExpenseCents || 0),
    ),
    estimatedProfitCents,
    knownEstimatedProfitCents,
    estimatedProfitRate:
      estimatedProfitCents === null || effectiveSalesAmountCents === 0
        ? null
        : estimatedProfitCents / effectiveSalesAmountCents,
  };
}

function toTravelGroupProfitDto(row: any) {
  return {
    travelGroupId: String(row.travelGroupId || ''),
    groupNo: String(row.groupNo || ''),
    visitDate: String(row.visitDate || ''),
    travelAgency: String(row.travelAgency || ''),
    guideName: String(row.guideName || ''),
    tasterName: String(row.tasterName || ''),
    guestCount: Number(row.guestCount || 0),
    orderCount: Number(row.orderCount || 0),
    effectiveSalesAmountCents: Number(row.effectiveSalesAmountCents || 0),
    confirmedRefundAmountCents: Number(row.confirmedRefundAmountCents || 0),
    pendingRefundAmountCents: Number(row.pendingRefundAmountCents || 0),
    actualProductCostCents: Number(row.actualProductCostCents || 0),
    logisticsFeeCents: Number(row.logisticsFeeCents || 0),
    parkingFeeCents: Number(row.parkingFeeCents || 0),
    cigaretteFeeCents:
      row.cigaretteFeeCents === null || row.cigaretteFeeCents === undefined
        ? null
        : Number(row.cigaretteFeeCents),
    salesCommissionCents: Number(row.salesCommissionCents || 0),
    leaderCommissionCents: Number(row.leaderCommissionCents || 0),
    outreachCommissionCents: Number(row.outreachCommissionCents || 0),
    employeeCommissionCents: Number(row.employeeCommissionCents || 0),
    tasterCommissionCents: Number(row.tasterCommissionCents || 0),
    dailyAgencyRebateCents: Number(row.dailyAgencyRebateCents || 0),
    monthlyAgencyRebateCents: Number(row.monthlyAgencyRebateCents || 0),
    totalExpenseCents: Number(row.totalExpenseCents || 0),
    estimatedProfitCents:
      row.estimatedProfitCents === null
        ? null
        : Number(row.estimatedProfitCents),
    estimatedProfitRate:
      row.estimatedProfitRate === null
        ? null
        : Number(row.estimatedProfitRate),
    calculationStatus: String(row.calculationStatus || ''),
    warnings: (Array.isArray(row.warnings) ? row.warnings : []).map(
      (warning: any) => ({
        code: String(warning?.code || ''),
        message: String(warning?.message || warning?.code || ''),
      }),
    ),
  };
}

function getAfterSalesAnalyticsInclude() {
  return {
    salesOrder: {
      include: {
        customer: true,
        travelGroup: true,
        items: true,
      },
    },
    customer: true,
  };
}

function buildTravelGroupFilter(query: any) {
  const clauses = [];
  const groupType = normalizeOptionalString(query?.groupType);
  const tasterFilter = buildTasterWhereFilter(query?.tasterId);
  const travelAgency = normalizeOptionalString(query?.travelAgency);
  if (groupType) {
    clauses.push({ groupType });
  }
  if (tasterFilter) {
    clauses.push(tasterFilter);
  }
  if (travelAgency) {
    clauses.push({
      travelAgency: {
        contains: travelAgency,
      },
    });
  }
  return clauses.length ? andWhere(...clauses) : null;
}

function buildTasterRankingRows(
  travelGroups: any[],
  groupSalesOrders: any[],
  query: any,
) {
  const buckets = new Map<string, any>();
  for (const group of travelGroups) {
    const tasterId = normalizeOptionalString(group?.tasterId);
    const key = tasterId || UNASSIGNED_TASTER_KEY;
    const tasterName = resolveTasterName(group, tasterId);
    const bucket = buckets.get(key) || {
      key,
      tasterId,
      tasterName,
      travelGroups: [],
    };
    if (
      tasterId &&
      bucket.tasterName === tasterId &&
      tasterName !== tasterId
    ) {
      bucket.tasterName = tasterName;
    }
    bucket.travelGroups.push(group);
    buckets.set(key, bucket);
  }

  const rows = [...buckets.values()].map((bucket) => {
    const groupIds = new Set(
      bucket.travelGroups
        .map((group: any) => normalizeOptionalString(group.id))
        .filter(Boolean),
    );
    const salesOrders = groupSalesOrders.filter((order: any) =>
      groupIds.has(normalizeOptionalString(order.travelGroupId) || ''),
    );
    const afterSalesOrders = salesOrders.flatMap((order: any) =>
      Array.isArray(order.afterSalesOrders) ? order.afterSalesOrders : [],
    );
    const calculated = calculateAnalyticsMetrics({
      salesOrders,
      afterSalesOrders,
      travelGroups: bucket.travelGroups,
      groupSalesOrders: salesOrders,
    });
    const metrics = calculated.metrics;
    return {
      tasterId: bucket.tasterId,
      tasterName: bucket.tasterName,
      rank: 0,
      totalGroupCount: metrics.totalGroupCount,
      totalGuestCount: metrics.totalGuestCount,
      grossSalesAmountCents: metrics.grossSalesAmountCents,
      refundAmountCents: metrics.refundAmountCents,
      netSalesAmountCents: metrics.netSalesAmountCents,
      averageSalesPerGroupCents: metrics.averageSalesPerGroupCents,
      averageSalesPerGuestCents: metrics.averageSalesPerGuestCents,
      noEffectiveOrderGroupCount: metrics.noEffectiveOrderGroupCount,
      conversionGroupCount: metrics.conversionGroupCount,
      noOrderRate: metrics.noOrderRate,
      conversionRate: metrics.conversionRate,
      warnings: calculated.warnings,
    };
  });

  const sortBy = normalizeRankingSortBy(query?.sortBy);
  const sortDirection = normalizeSortDirection(query?.sortDirection);
  const directionMultiplier = sortDirection === 'asc' ? 1 : -1;
  const sorted = rows.sort((left, right) => {
    const diff =
      (Number(left[sortBy] || 0) - Number(right[sortBy] || 0)) *
      directionMultiplier;
    if (diff !== 0) {
      return diff;
    }
    const groupDiff = right.totalGroupCount - left.totalGroupCount;
    if (groupDiff !== 0) {
      return groupDiff;
    }
    return String(left.tasterName || '').localeCompare(
      String(right.tasterName || ''),
      'zh-Hans-CN',
    );
  });
  return sorted
    .slice(0, normalizeLimit(query?.limit))
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }));
}

function buildEmptyTrendPoints(
  dateFrom: string,
  dateTo: string,
  metric: string,
  granularity: string,
) {
  return buildTrendPeriods(dateFrom, dateTo, granularity).map((period) => {
    const point = {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      metricValue: 0,
      grossSalesAmountCents: 0,
      refundAmountCents: 0,
      pendingRefundAmountCents: 0,
      netSalesAmountCents: 0,
      totalGroupCount: 0,
      totalGuestCount: 0,
      groupScopedNetSalesAmountCents: 0,
      noEffectiveOrderGroupCount: 0,
      conversionGroupCount: 0,
      noOrderRate: 0,
      conversionRate: 0,
    };
    setTrendMetricValue(point, metric);
    return point;
  });
}

function buildTrendPeriods(
  dateFrom: string,
  dateTo: string,
  granularity: string,
) {
  const periods: Array<{ periodStart: string; periodEnd: string }> = [];
  if (granularity === 'month') {
    let cursor = startOfMonthDateOnly(dateFrom);
    while (compareDateOnly(cursor, dateTo) <= 0) {
      const monthEnd = endOfMonthDateOnly(cursor);
      periods.push({
        periodStart: maxDateOnly(cursor, dateFrom),
        periodEnd: minDateOnly(monthEnd, dateTo),
      });
      cursor = addMonthsDateOnly(cursor, 1);
    }
    return periods;
  }

  let cursor = dateFrom;
  while (compareDateOnly(cursor, dateTo) <= 0) {
    periods.push({
      periodStart: cursor,
      periodEnd: cursor,
    });
    cursor = addDaysDateOnly(cursor, 1);
  }
  return periods;
}

function findTrendPointForDate(points: any[], dateOnly: string | null) {
  if (!dateOnly) {
    return null;
  }
  return (
    points.find((point) => isDateInTrendPeriod(dateOnly, point)) || null
  );
}

function isDateInTrendPeriod(dateOnly: string | null, period: any) {
  return (
    Boolean(dateOnly) &&
    compareDateOnly(dateOnly as string, period.periodStart) >= 0 &&
    compareDateOnly(dateOnly as string, period.periodEnd) <= 0
  );
}

function finalizeMoneyTrendPoints(points: any[], metric: string) {
  for (const point of points) {
    point.netSalesAmountCents = Math.max(
      0,
      point.grossSalesAmountCents - point.refundAmountCents,
    );
    setTrendMetricValue(point, metric);
  }
}

function applyGroupMetricsToTrendPoint(
  point: any,
  travelGroups: any[],
  groupSalesOrders: any[],
  metric: string,
) {
  const travelGroupIds = new Set(
    travelGroups
      .map((group: any) => normalizeOptionalString(group?.id))
      .filter(Boolean),
  );
  const periodSalesOrders = groupSalesOrders.filter((order: any) =>
    travelGroupIds.has(normalizeOptionalString(order?.travelGroupId) || ''),
  );
  const afterSalesOrders = periodSalesOrders.flatMap((order: any) =>
    getOrderAfterSalesOrders(order),
  );
  const calculated = calculateAnalyticsMetrics({
    travelGroups,
    groupSalesOrders: periodSalesOrders,
    afterSalesOrders,
  });
  const metrics = calculated.metrics;
  point.totalGroupCount = metrics.totalGroupCount;
  point.totalGuestCount = metrics.totalGuestCount;
  point.refundAmountCents = metrics.refundAmountCents;
  point.pendingRefundAmountCents = metrics.pendingRefundAmountCents;
  point.groupScopedNetSalesAmountCents = metrics.groupScopedNetSalesAmountCents;
  point.netSalesAmountCents = metrics.groupScopedNetSalesAmountCents;
  point.grossSalesAmountCents =
    metrics.groupScopedNetSalesAmountCents + metrics.refundAmountCents;
  point.noEffectiveOrderGroupCount = metrics.noEffectiveOrderGroupCount;
  point.conversionGroupCount = metrics.conversionGroupCount;
  point.noOrderRate = metrics.noOrderRate;
  point.conversionRate = metrics.conversionRate;
  setTrendMetricValue(point, metric);
}

function setTrendMetricValue(point: any, metric: string) {
  if (metric === 'gross_sales') {
    point.metricValue = point.grossSalesAmountCents;
    return;
  }
  if (metric === 'refund') {
    point.metricValue = point.refundAmountCents;
    return;
  }
  if (metric === 'net_sales') {
    point.metricValue = point.netSalesAmountCents;
    return;
  }
  if (metric === 'groups') {
    point.metricValue = point.totalGroupCount;
    return;
  }
  if (metric === 'guests') {
    point.metricValue = point.totalGuestCount;
    return;
  }
  point.metricValue = point.noOrderRate;
}

const ANALYTICS_METRIC_EXPORT_COLUMNS = [
  { header: '指标', key: 'metricName', width: 24 },
  { header: '字段', key: 'field', width: 32 },
  { header: '值', key: 'value', width: 18 },
  { header: '单位', key: 'unit', width: 12 },
  { header: '口径说明', key: 'source', width: 48 },
];

const ANALYTICS_ORDER_EXPORT_COLUMNS = [
  { header: '订单号', key: 'orderNo', width: 22 },
  { header: '订单日期', key: 'orderDate', width: 14 },
  { header: '订单状态', key: 'status', width: 16 },
  { header: '客户', key: 'customerName', width: 20 },
  { header: '客户标记', key: 'customerFinanceMark', width: 12 },
  { header: '旅行团号', key: 'travelGroupNo', width: 22 },
  { header: '到店日期', key: 'travelGroupVisitDate', width: 14 },
  { header: '旅行团标记', key: 'travelGroupFinanceMark', width: 14 },
  { header: '品鉴师', key: 'tasterName', width: 18 },
  { header: '团型', key: 'groupType', width: 16 },
  { header: '旅行社', key: 'travelAgency', width: 24 },
  { header: '原始出单金额(分)', key: 'grossSalesAmountCents', width: 18 },
  { header: '已确认退款(分)', key: 'refundAmountCents', width: 18 },
  { header: '待确认退款(分)', key: 'pendingRefundAmountCents', width: 18 },
  { header: '净销售额(分)', key: 'netSalesAmountCents', width: 18 },
  { header: '有效订单金额(分)', key: 'effectiveAmountCents', width: 18 },
  { header: '计入出单', key: 'contributesToGrossSales', width: 12 },
  { header: '计入有效订单', key: 'contributesToEffectiveOrder', width: 14 },
  { header: '酒品明细', key: 'itemsSummary', width: 36 },
  { header: '售后单ID', key: 'afterSalesOrderIds', width: 32 },
];

const ANALYTICS_TRAVEL_GROUP_EXPORT_COLUMNS = [
  { header: '旅行团号', key: 'groupNo', width: 22 },
  { header: '到店日期', key: 'visitDate', width: 14 },
  { header: '人数', key: 'guestCount', width: 10 },
  { header: '品鉴师', key: 'tasterName', width: 18 },
  { header: '品鉴师ID', key: 'tasterId', width: 24 },
  { header: '团型', key: 'groupType', width: 16 },
  { header: '旅行社', key: 'travelAgency', width: 24 },
  { header: '旅行团标记', key: 'financeMark', width: 14 },
  { header: '无有效订单', key: 'noEffectiveOrder', width: 14 },
  { header: '团关联原始金额(分)', key: 'grossSalesAmountCents', width: 20 },
  { header: '团关联退款(分)', key: 'refundAmountCents', width: 18 },
  { header: '团关联净销售额(分)', key: 'netSalesAmountCents', width: 20 },
  { header: '订单ID', key: 'salesOrderIds', width: 32 },
  { header: 'warnings', key: 'warnings', width: 36 },
];

const ANALYTICS_AFTER_SALES_EXPORT_COLUMNS = [
  { header: '售后单号', key: 'afterSalesNo', width: 24 },
  { header: '订单号', key: 'salesOrderNo', width: 22 },
  { header: '创建时间', key: 'createdAt', width: 24 },
  { header: '退款金额(分)', key: 'refundAmountCents', width: 18 },
  { header: '财务已确认', key: 'financeConfirmed', width: 14 },
  { header: '确认时间', key: 'financeConfirmedAt', width: 24 },
  { header: '售后状态', key: 'status', width: 16 },
  { header: '问题类型', key: 'issueType', width: 16 },
  { header: '处理类型', key: 'actionType', width: 16 },
  { header: '客户', key: 'customerName', width: 20 },
  { header: '旅行团号', key: 'travelGroupNo', width: 22 },
  { header: '品鉴师', key: 'tasterName', width: 18 },
];

const ANALYTICS_RANKING_EXPORT_COLUMNS = [
  { header: '排名', key: 'rank', width: 10 },
  { header: '品鉴师ID', key: 'tasterId', width: 24 },
  { header: '品鉴师', key: 'tasterName', width: 18 },
  { header: '接待团数', key: 'totalGroupCount', width: 14 },
  { header: '接待人数', key: 'totalGuestCount', width: 14 },
  { header: '原始出单金额(分)', key: 'grossSalesAmountCents', width: 20 },
  { header: '已确认退款(分)', key: 'refundAmountCents', width: 18 },
  { header: '净销售额(分)', key: 'netSalesAmountCents', width: 18 },
  { header: '团均销售额(分)', key: 'averageSalesPerGroupCents', width: 18 },
  { header: '人均销售额(分)', key: 'averageSalesPerGuestCents', width: 18 },
  { header: '无有效订单团数', key: 'noEffectiveOrderGroupCount', width: 18 },
  { header: '转化团数', key: 'conversionGroupCount', width: 14 },
  { header: '打蛋率', key: 'noOrderRate', width: 14 },
  { header: '转化率', key: 'conversionRate', width: 14 },
  { header: 'warnings', key: 'warnings', width: 36 },
];

const ANALYTICS_TASTER_DETAIL_EXPORT_COLUMNS = [
  { header: '排名', key: 'rank', width: 10 },
  { header: '品鉴师ID', key: 'tasterId', width: 24 },
  { header: '品鉴师', key: 'tasterName', width: 18 },
  { header: '旅行团号', key: 'groupNo', width: 22 },
  { header: '到店日期', key: 'visitDate', width: 14 },
  { header: '人数', key: 'guestCount', width: 10 },
  { header: '团型', key: 'groupType', width: 16 },
  { header: '旅行社', key: 'travelAgency', width: 24 },
  { header: '无有效订单', key: 'noEffectiveOrder', width: 14 },
  { header: '订单号', key: 'orderNo', width: 22 },
  { header: '订单日期', key: 'orderDate', width: 14 },
  { header: '订单状态', key: 'status', width: 16 },
  { header: '原始出单金额(分)', key: 'grossSalesAmountCents', width: 20 },
  { header: '已确认退款(分)', key: 'refundAmountCents', width: 18 },
  { header: '待确认退款(分)', key: 'pendingRefundAmountCents', width: 18 },
  { header: '净销售额(分)', key: 'netSalesAmountCents', width: 18 },
  { header: '售后单ID', key: 'afterSalesOrderIds', width: 32 },
  { header: 'warnings', key: 'warnings', width: 36 },
];

const SALES_PERFORMANCE_SUMMARY_EXPORT_COLUMNS = [
  { header: '销售ID', key: 'salesUserId', width: 24 },
  { header: '销售人员', key: 'salesUserName', width: 18 },
  { header: '状态', key: 'status', width: 14 },
  { header: '出单数', key: 'orderCount', width: 12 },
  { header: '出单销售额(分)', key: 'grossSalesAmountCents', width: 18 },
  { header: '退单销售额(分)', key: 'refundAmountCents', width: 18 },
  { header: '总销售额(分)', key: 'netSalesAmountCents', width: 18 },
  {
    header: '单均销售额(分/单)',
    key: 'averageSalesPerOrderCents',
    width: 20,
  },
];

const SALES_PERFORMANCE_DETAIL_EXPORT_COLUMNS = [
  { header: '销售ID', key: 'salesUserId', width: 24 },
  { header: '销售人员', key: 'salesUserName', width: 18 },
  { header: '订单ID', key: 'id', width: 24 },
  { header: '订单号', key: 'orderNo', width: 22 },
  { header: '订单日期', key: 'orderDate', width: 14 },
  { header: '客户', key: 'customerName', width: 20 },
  { header: '订单状态', key: 'status', width: 16 },
  { header: '本期出单销售额(分)', key: 'grossSalesAmountCents', width: 22 },
  { header: '本期退单销售额(分)', key: 'refundAmountCents', width: 22 },
  { header: '本期总销售额(分)', key: 'netSalesAmountCents', width: 20 },
  { header: '计入出单数', key: 'contributesToOrderCount', width: 14 },
  { header: '本期售后单ID', key: 'afterSalesOrderIds', width: 36 },
];

function buildAnalyticsOverviewExportWorkbook(input: {
  overview: any;
  metricRows?: any[];
  orders: any[];
  travelGroups: any[];
  afterSalesOrders: any[];
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'jiangjiu-api';
  workbook.created = new Date();

  addWorksheet(
    workbook,
    '指标摘要',
    ANALYTICS_METRIC_EXPORT_COLUMNS,
    input.metricRows || buildOverviewMetricExportRows(input.overview),
  );
  addWorksheet(
    workbook,
    '订单明细',
    ANALYTICS_ORDER_EXPORT_COLUMNS,
    input.orders.map(toAnalyticsOrderExportRow),
  );
  addWorksheet(
    workbook,
    '旅行团明细',
    ANALYTICS_TRAVEL_GROUP_EXPORT_COLUMNS,
    input.travelGroups.map(toAnalyticsTravelGroupExportRow),
  );
  addWorksheet(
    workbook,
    '售后退款明细',
    ANALYTICS_AFTER_SALES_EXPORT_COLUMNS,
    input.afterSalesOrders.map(toAnalyticsAfterSalesExportRow),
  );
  return workbook;
}

function buildAnalyticsTasterRankingsExportWorkbook(input: {
  range: any;
  rankings: any[];
  details: any[];
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'jiangjiu-api';
  workbook.created = new Date();
  addWorksheet(
    workbook,
    '排名摘要',
    ANALYTICS_RANKING_EXPORT_COLUMNS,
    input.rankings.map(toAnalyticsRankingExportRow),
  );
  addWorksheet(
    workbook,
    '品鉴师明细',
    ANALYTICS_TASTER_DETAIL_EXPORT_COLUMNS,
    input.details,
  );
  return workbook;
}

function buildSalesPerformanceExportWorkbook(
  dataset: SalesPerformanceDataset,
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'jiangjiu-api';
  workbook.created = new Date();
  const salesUserNameByKey = new Map(
    dataset.records.map((record) => [
      record.salesUserId || '__unassigned_sales_user__',
      record.salesUserName,
    ]),
  );
  addWorksheet(
    workbook,
    '销售汇总',
    SALES_PERFORMANCE_SUMMARY_EXPORT_COLUMNS,
    dataset.records.map((record) => ({
      salesUserId: record.salesUserId || '',
      salesUserName: record.salesUserName,
      status: record.isUnassigned
        ? '未分配'
        : record.isActive
          ? '在职'
          : '停用',
      orderCount: record.orderCount,
      grossSalesAmountCents: record.grossSalesAmountCents,
      refundAmountCents: record.refundAmountCents,
      netSalesAmountCents: record.netSalesAmountCents,
      averageSalesPerOrderCents:
        record.averageSalesPerOrderCents === null
          ? ''
          : record.averageSalesPerOrderCents,
    })),
  );
  addWorksheet(
    workbook,
    '订单贡献明细',
    SALES_PERFORMANCE_DETAIL_EXPORT_COLUMNS,
    dataset.orders.map((order) => ({
      salesUserId: order.salesUserId || '',
      salesUserName:
        salesUserNameByKey.get(
          order.salesUserId || '__unassigned_sales_user__',
        ) || '',
      id: order.id,
      orderNo: order.orderNo,
      orderDate: order.orderDate || '',
      customerName: order.customerName,
      status: order.status,
      grossSalesAmountCents: order.grossSalesAmountCents,
      refundAmountCents: order.refundAmountCents,
      netSalesAmountCents: order.netSalesAmountCents,
      contributesToOrderCount: booleanLabel(order.contributesToOrderCount),
      afterSalesOrderIds: formatIdList(order.afterSalesOrderIds),
    })),
  );
  return workbook;
}

function addWorksheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: any[],
  rows: any[],
) {
  const worksheet = workbook.addWorksheet(name);
  worksheet.columns = columns;
  for (const column of worksheet.columns) {
    column.alignment = { vertical: 'top', wrapText: true };
  }
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).alignment = {
    vertical: 'middle',
    horizontal: 'center',
  };
  for (const row of rows) {
    worksheet.addRow(row);
  }
  return worksheet;
}

function buildOverviewMetricExportRows(overview: any) {
  const metrics = overview?.metrics || {};
  return [
    metricRow('原始出单销售额', 'grossSalesAmountCents', metrics.grossSalesAmountCents, '分', 'SalesOrder.orderDate'),
    metricRow('已确认退款金额', 'refundAmountCents', metrics.refundAmountCents, '分', 'AfterSalesOrder.createdAt 且 financeConfirmed=true'),
    metricRow('待确认退款金额', 'pendingRefundAmountCents', metrics.pendingRefundAmountCents, '分', 'AfterSalesOrder.createdAt 且 financeConfirmed=false'),
    metricRow('净销售额', 'netSalesAmountCents', metrics.netSalesAmountCents, '分', '原始出单销售额 - 已确认退款金额'),
    metricRow('接待团数', 'totalGroupCount', metrics.totalGroupCount, '团', 'TravelGroup.visitDate'),
    metricRow('接待人数', 'totalGuestCount', metrics.totalGuestCount, '人', 'TravelGroup.visitDate'),
    metricRow('团范围净销售额', 'groupScopedNetSalesAmountCents', metrics.groupScopedNetSalesAmountCents, '分', 'TravelGroup.visitDate 范围内关联订单'),
    metricRow('团均销售额', 'averageSalesPerGroupCents', metrics.averageSalesPerGroupCents, '分/团', '团范围净销售额 / 接待团数'),
    metricRow('人均销售额', 'averageSalesPerGuestCents', metrics.averageSalesPerGuestCents, '分/人', '团范围净销售额 / 接待人数'),
    metricRow('无有效订单团数', 'noEffectiveOrderGroupCount', metrics.noEffectiveOrderGroupCount, '团', '无 valid/partial_refund 且有效金额>0 的订单'),
    metricRow('转化团数', 'conversionGroupCount', metrics.conversionGroupCount, '团', '接待团数 - 无有效订单团数'),
    metricRow('打蛋率', 'noOrderRate', metrics.noOrderRate, '比例', '无有效订单团数 / 接待团数'),
    metricRow('转化率', 'conversionRate', metrics.conversionRate, '比例', '转化团数 / 接待团数'),
    metricRow('warnings', 'warnings', formatWarningCodes(overview?.warnings), '', '统计风险提示'),
  ];
}

function metricRow(
  metricName: string,
  field: string,
  value: unknown,
  unit: string,
  source: string,
) {
  return {
    metricName,
    field,
    value: value === undefined || value === null ? '' : value,
    unit,
    source,
  };
}

function toAnalyticsOrderExportRow(order: any) {
  return {
    orderNo: order.orderNo || '',
    orderDate: order.orderDate || '',
    status: order.status || '',
    customerName: order.customerName || '',
    customerFinanceMark: markLabel(order.customerFinanceMark),
    travelGroupNo: order.travelGroupNo || '',
    travelGroupVisitDate: order.travelGroupVisitDate || '',
    travelGroupFinanceMark: markLabel(order.travelGroupFinanceMark),
    tasterName: order.tasterName || '',
    groupType: order.groupType || '',
    travelAgency: order.travelAgency || '',
    grossSalesAmountCents: Number(order.grossSalesAmountCents || 0),
    refundAmountCents: Number(order.refundAmountCents || 0),
    pendingRefundAmountCents: Number(order.pendingRefundAmountCents || 0),
    netSalesAmountCents: Number(order.netSalesAmountCents || 0),
    effectiveAmountCents: Number(order.effectiveAmountCents || 0),
    contributesToGrossSales: booleanLabel(order.contributesToGrossSales),
    contributesToEffectiveOrder: booleanLabel(order.contributesToEffectiveOrder),
    itemsSummary: formatOrderItems(order.items),
    afterSalesOrderIds: formatIdList(order.afterSalesOrderIds),
  };
}

function toAnalyticsTravelGroupExportRow(group: any) {
  return {
    groupNo: group.groupNo || '',
    visitDate: group.visitDate || '',
    guestCount: Number(group.guestCount || 0),
    tasterName: group.tasterName || '',
    tasterId: group.tasterId || '',
    groupType: group.groupType || '',
    travelAgency: group.travelAgency || '',
    financeMark: markLabel(group.financeMark),
    noEffectiveOrder: booleanLabel(group.noEffectiveOrder),
    grossSalesAmountCents: Number(group.grossSalesAmountCents || 0),
    refundAmountCents: Number(group.refundAmountCents || 0),
    netSalesAmountCents: Number(group.netSalesAmountCents || 0),
    salesOrderIds: formatIdList(group.salesOrderIds),
    warnings: formatWarningCodes(group.warnings),
  };
}

function toAnalyticsAfterSalesExportRow(afterSalesOrder: any) {
  return {
    afterSalesNo: afterSalesOrder.afterSalesNo || '',
    salesOrderNo: afterSalesOrder.salesOrderNo || '',
    createdAt: afterSalesOrder.createdAt || '',
    refundAmountCents: Number(afterSalesOrder.refundAmountCents || 0),
    financeConfirmed: booleanLabel(afterSalesOrder.financeConfirmed),
    financeConfirmedAt: afterSalesOrder.financeConfirmedAt || '',
    status: afterSalesOrder.status || '',
    issueType: afterSalesOrder.issueType || '',
    actionType: afterSalesOrder.actionType || '',
    customerName: afterSalesOrder.customerName || '',
    travelGroupNo: afterSalesOrder.travelGroupNo || '',
    tasterName: afterSalesOrder.tasterName || '',
  };
}

function toAnalyticsRankingExportRow(row: any) {
  return {
    rank: row.rank,
    tasterId: row.tasterId || '',
    tasterName: row.tasterName || '',
    totalGroupCount: Number(row.totalGroupCount || 0),
    totalGuestCount: Number(row.totalGuestCount || 0),
    grossSalesAmountCents: Number(row.grossSalesAmountCents || 0),
    refundAmountCents: Number(row.refundAmountCents || 0),
    netSalesAmountCents: Number(row.netSalesAmountCents || 0),
    averageSalesPerGroupCents: Number(row.averageSalesPerGroupCents || 0),
    averageSalesPerGuestCents: Number(row.averageSalesPerGuestCents || 0),
    noEffectiveOrderGroupCount: Number(row.noEffectiveOrderGroupCount || 0),
    conversionGroupCount: Number(row.conversionGroupCount || 0),
    noOrderRate: Number(row.noOrderRate || 0),
    conversionRate: Number(row.conversionRate || 0),
    warnings: formatWarningCodes(row.warnings),
  };
}

function buildTasterRankingDetailExportRows(
  rankings: any[],
  travelGroups: any[],
  groupSalesOrders: any[],
) {
  const groupsByTasterKey = groupTravelGroupsByTasterKey(travelGroups);
  return rankings.flatMap((ranking) => {
    const key = tasterBucketKey(ranking.tasterId);
    const groups = groupsByTasterKey.get(key) || [];
    return groups.flatMap((group: any) =>
      buildTasterTravelGroupExportRows(ranking, group, groupSalesOrders),
    );
  });
}

function buildTasterTravelGroupExportRows(
  ranking: any,
  group: any,
  groupSalesOrders: any[],
) {
  const groupDto = toSourceTravelGroupDto(group, groupSalesOrders);
  const groupOrders = groupSalesOrders
    .filter(
      (order: any) =>
        normalizeOptionalString(order.travelGroupId) ===
        normalizeOptionalString(group.id),
    )
    .map(toSourceOrderDto);
  if (groupOrders.length === 0) {
    return [
      toTasterDetailExportRow({
        ranking,
        group: groupDto,
        order: null,
      }),
    ];
  }
  return groupOrders.map((order: any) =>
    toTasterDetailExportRow({
      ranking,
      group: groupDto,
      order,
    }),
  );
}

function toTasterDetailExportRow(input: {
  ranking: any;
  group: any;
  order: any | null;
}) {
  const order = input.order || {};
  return {
    rank: input.ranking.rank,
    tasterId: input.ranking.tasterId || '',
    tasterName: input.ranking.tasterName || '',
    groupNo: input.group.groupNo || '',
    visitDate: input.group.visitDate || '',
    guestCount: Number(input.group.guestCount || 0),
    groupType: input.group.groupType || '',
    travelAgency: input.group.travelAgency || '',
    noEffectiveOrder: booleanLabel(input.group.noEffectiveOrder),
    orderNo: order.orderNo || '',
    orderDate: order.orderDate || '',
    status: order.status || '',
    grossSalesAmountCents: Number(order.grossSalesAmountCents || 0),
    refundAmountCents: Number(order.refundAmountCents || 0),
    pendingRefundAmountCents: Number(order.pendingRefundAmountCents || 0),
    netSalesAmountCents: Number(order.netSalesAmountCents || 0),
    afterSalesOrderIds: formatIdList(order.afterSalesOrderIds),
    warnings: formatWarningCodes(input.group.warnings),
  };
}

function groupTravelGroupsByTasterKey(travelGroups: any[]) {
  const grouped = new Map<string, any[]>();
  for (const group of travelGroups) {
    const key = tasterBucketKey(group?.tasterId);
    grouped.set(key, [...(grouped.get(key) || []), group]);
  }
  return grouped;
}

function tasterBucketKey(tasterId: unknown) {
  return normalizeOptionalString(tasterId) || UNASSIGNED_TASTER_KEY;
}

function formatOrderItems(items: any[]) {
  return (items || [])
    .map((item: any) => {
      const productName = normalizeOptionalString(item.productName) || '未命名酒品';
      const quantity = Number(item.quantity || 0);
      return `${productName} x ${quantity}`;
    })
    .join('；');
}

function formatIdList(values: any[]) {
  return (values || [])
    .map((value) => normalizeOptionalString(value))
    .filter(Boolean)
    .join(',');
}

function formatWarningCodes(warnings: any) {
  if (!Array.isArray(warnings)) {
    return '';
  }
  return warnings
    .map((warning) => normalizeOptionalString(warning?.code))
    .filter(Boolean)
    .join(',');
}

function booleanLabel(value: unknown) {
  return value ? '是' : '否';
}

function markLabel(value: unknown) {
  if (value === undefined || value === null) {
    return '';
  }
  return value ? '已标记' : '未标记';
}

function resolveTasterName(group: any, tasterId: string | null) {
  if (!tasterId) {
    return UNASSIGNED_TASTER_NAME;
  }
  return (
    normalizeOptionalString(group?.tasterName) ||
    normalizeOptionalString(group?.taster?.name) ||
    tasterId
  );
}

function buildTasterWhereFilter(value: unknown) {
  const text = normalizeOptionalString(value);
  if (!text) {
    return null;
  }
  return isUnassignedTasterValue(text) ? { tasterId: null } : { tasterId: text };
}

function normalizeTasterTarget(value: unknown) {
  const text = normalizeOptionalString(value);
  if (!text) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'tasterId is required.',
    );
  }
  if (isUnassignedTasterValue(text)) {
    return {
      tasterId: null,
      unassigned: true,
    };
  }
  return {
    tasterId: text,
    unassigned: false,
  };
}

function isUnassignedTasterValue(value: string) {
  const normalized = value.toLowerCase();
  return [
    UNASSIGNED_TASTER_KEY,
    'unassigned',
    'none',
    'null',
    'missing',
  ].includes(normalized);
}

function matchesTasterTarget(
  tasterId: string | null | undefined,
  target: { tasterId: string | null; unassigned: boolean },
) {
  const normalizedTasterId = normalizeOptionalString(tasterId);
  return target.unassigned
    ? !normalizedTasterId
    : normalizedTasterId === target.tasterId;
}

function matchesTravelGroupTasterTarget(
  group: any,
  target: { tasterId: string | null; unassigned: boolean },
) {
  return matchesTasterTarget(group?.tasterId, target);
}

function normalizeAnalyticsSource(value: unknown, defaultSource: string) {
  const text = normalizeOptionalString(value) || defaultSource;
  const normalized = text.toLowerCase();
  if (
    ['sales', 'refund', 'group_scoped', 'taster'].includes(normalized)
  ) {
    return normalized;
  }
  throw createHttpError(
    400,
    'VALIDATION_FAILED',
    'source must be sales, refund, group_scoped, or taster.',
  );
}

function toSourceOrderDto(order: any) {
  const amounts = summarizeOrderAmounts(order);
  const travelGroup = order?.travelGroup || null;
  const customer = order?.customer || null;
  return {
    id: order?.id || null,
    orderNo: order?.orderNo || null,
    orderDate: toDateOnly(order?.orderDate),
    status: order?.status || null,
    customerId: order?.customerId || null,
    customerName: order?.customerName || customer?.name || null,
    customerPhone: order?.customerPhone || customer?.phone || null,
    customerFinanceMark:
      customer?.financeMark === undefined ? null : Boolean(customer.financeMark),
    travelGroupId: order?.travelGroupId || null,
    travelGroupNo: travelGroup?.groupNo || null,
    travelGroupVisitDate: toDateOnly(travelGroup?.visitDate),
    travelGroupFinanceMark:
      travelGroup?.financeMark === undefined
        ? null
        : Boolean(travelGroup.financeMark),
    tasterId: travelGroup?.tasterId || null,
    tasterName: travelGroup
      ? resolveTasterName(travelGroup, normalizeOptionalString(travelGroup.tasterId))
      : null,
    groupType: travelGroup?.groupType || null,
    travelAgency: travelGroup?.travelAgency || null,
    totalAmountCents: Number(order?.totalAmountCents || 0),
    grossSalesAmountCents: amounts.grossSalesAmountCents,
    refundAmountCents: amounts.refundAmountCents,
    pendingRefundAmountCents: amounts.pendingRefundAmountCents,
    netSalesAmountCents: amounts.netSalesAmountCents,
    effectiveAmountCents: amounts.effectiveAmountCents,
    contributesToGrossSales: amounts.grossSalesAmountCents > 0,
    contributesToEffectiveOrder: amounts.effectiveAmountCents > 0,
    items: getOrderItems(order).map((item: any) => ({
      id: item?.id || null,
      productName: item?.productName || null,
      quantity: Number(item?.quantity || 0),
      unitPriceCents: Number(item?.unitPriceCents || 0),
      subtotalCents: Number(item?.subtotalCents || 0),
      deliveryType: item?.deliveryType || null,
    })),
    afterSalesOrderIds: getOrderAfterSalesOrders(order)
      .map((item: any) => item?.id)
      .filter(Boolean),
  };
}

function toSourceTravelGroupDto(group: any, groupSalesOrders: any[]) {
  const salesOrders = groupSalesOrders.filter(
    (order: any) =>
      normalizeOptionalString(order.travelGroupId) ===
      normalizeOptionalString(group.id),
  );
  const calculated = calculateAnalyticsMetrics({
    travelGroups: [group],
    groupSalesOrders: salesOrders,
    afterSalesOrders: salesOrders.flatMap((order: any) =>
      getOrderAfterSalesOrders(order),
    ),
  });
  return {
    id: group?.id || null,
    groupNo: group?.groupNo || null,
    visitDate: toDateOnly(group?.visitDate),
    guestCount: Number(group?.guestCount || 0),
    tasterId: group?.tasterId || null,
    tasterName: resolveTasterName(group, normalizeOptionalString(group?.tasterId)),
    groupType: group?.groupType || null,
    travelAgency: group?.travelAgency || null,
    financeMark:
      group?.financeMark === undefined ? null : Boolean(group.financeMark),
    noEffectiveOrder: isNoEffectiveTravelGroup(group, salesOrders),
    grossSalesAmountCents:
      calculated.metrics.groupScopedNetSalesAmountCents +
      calculated.metrics.refundAmountCents,
    refundAmountCents: calculated.metrics.refundAmountCents,
    netSalesAmountCents: calculated.metrics.groupScopedNetSalesAmountCents,
    salesOrderIds: salesOrders
      .map((order: any) => order?.id)
      .filter(Boolean),
    warnings: calculated.warnings,
  };
}

function toSourceAfterSalesOrderDto(afterSalesOrder: any, fallbackOrder?: any) {
  const salesOrder = afterSalesOrder?.salesOrder || fallbackOrder || null;
  const travelGroup = salesOrder?.travelGroup || null;
  const customer = afterSalesOrder?.customer || salesOrder?.customer || null;
  return {
    id: afterSalesOrder?.id || null,
    afterSalesNo: afterSalesOrder?.afterSalesNo || null,
    salesOrderId: afterSalesOrder?.salesOrderId || salesOrder?.id || null,
    salesOrderNo: salesOrder?.orderNo || null,
    createdAt: toIsoString(afterSalesOrder?.createdAt),
    refundAmountCents: Number(afterSalesOrder?.refundAmountCents || 0),
    financeConfirmed: Boolean(afterSalesOrder?.financeConfirmed),
    financeConfirmedAt: toIsoString(afterSalesOrder?.financeConfirmedAt),
    status: afterSalesOrder?.status || null,
    issueType: afterSalesOrder?.issueType || null,
    actionType: afterSalesOrder?.actionType || null,
    description: afterSalesOrder?.description || null,
    customerId: afterSalesOrder?.customerId || salesOrder?.customerId || null,
    customerName: customer?.name || salesOrder?.customerName || null,
    travelGroupId: salesOrder?.travelGroupId || null,
    travelGroupNo: travelGroup?.groupNo || null,
    tasterId: travelGroup?.tasterId || null,
    tasterName: travelGroup
      ? resolveTasterName(travelGroup, normalizeOptionalString(travelGroup.tasterId))
      : null,
  };
}

function summarizeOrderAmounts(order: any) {
  const totalAmountCents = Number(order?.totalAmountCents || 0);
  const confirmedRefundAmountCents = sumBy(
    getOrderAfterSalesOrders(order),
    (item: any) =>
      item?.financeConfirmed ? Number(item?.refundAmountCents || 0) : 0,
  );
  const pendingRefundAmountCents = sumBy(
    getOrderAfterSalesOrders(order),
    (item: any) =>
      !item?.financeConfirmed ? Number(item?.refundAmountCents || 0) : 0,
  );
  const grossSalesAmountCents = GROSS_SALES_STATUS_VALUES.includes(
    normalizeOrderStatus(order?.status),
  )
    ? totalAmountCents
    : 0;
  return {
    grossSalesAmountCents,
    refundAmountCents: confirmedRefundAmountCents,
    pendingRefundAmountCents,
    netSalesAmountCents: Math.max(
      0,
      grossSalesAmountCents - confirmedRefundAmountCents,
    ),
    effectiveAmountCents: isEffectiveAnalyticsSalesOrder(order)
      ? Math.max(0, totalAmountCents - confirmedRefundAmountCents)
      : 0,
  };
}

function isNoEffectiveTravelGroup(group: any, groupSalesOrders: any[]) {
  const groupId = normalizeOptionalString(group?.id);
  const salesOrders = groupSalesOrders.filter(
    (order: any) => normalizeOptionalString(order.travelGroupId) === groupId,
  );
  return !salesOrders.some((order: any) =>
    isEffectiveAnalyticsSalesOrder(order),
  );
}

function groupAfterSalesBySalesOrderId(afterSalesOrders: any[]) {
  const grouped = new Map<string, any[]>();
  for (const afterSalesOrder of afterSalesOrders) {
    const salesOrderId = normalizeOptionalString(afterSalesOrder.salesOrderId);
    if (!salesOrderId) {
      continue;
    }
    grouped.set(salesOrderId, [
      ...(grouped.get(salesOrderId) || []),
      afterSalesOrder,
    ]);
  }
  return grouped;
}

function buildOrderById(orders: any[]) {
  const orderById = new Map<string, any>();
  for (const order of orders) {
    const id = normalizeOptionalString(order?.id);
    if (id) {
      orderById.set(id, order);
    }
  }
  return orderById;
}

function getOrderItems(order: any) {
  return Array.isArray(order?.items) ? order.items : [];
}

function getOrderAfterSalesOrders(order: any) {
  return Array.isArray(order?.afterSalesOrders) ? order.afterSalesOrders : [];
}

function normalizeBoolean(value: unknown) {
  const text = normalizeOptionalString(value);
  if (!text) {
    return false;
  }
  return ['true', '1', 'yes', 'y'].includes(text.toLowerCase());
}

function normalizeOrderStatus(value: unknown) {
  return String(value || 'VALID')
    .trim()
    .toUpperCase();
}

function toDateOnly(value: unknown) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function toIsoString(value: unknown) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function sumBy<T>(items: T[], mapper: (item: T) => number) {
  return items.reduce((sum, item) => sum + mapper(item), 0);
}

function compareDateOnly(left: string, right: string) {
  return left.localeCompare(right);
}

function maxDateOnly(left: string, right: string) {
  return compareDateOnly(left, right) >= 0 ? left : right;
}

function minDateOnly(left: string, right: string) {
  return compareDateOnly(left, right) <= 0 ? left : right;
}

function addDaysDateOnly(value: string, days: number) {
  const parts = parseDateOnlyParts(value);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return formatUtcDateOnly(date);
}

function addMonthsDateOnly(value: string, months: number) {
  const parts = parseDateOnlyParts(value);
  const date = new Date(Date.UTC(parts.year, parts.month - 1 + months, 1));
  return formatUtcDateOnly(date);
}

function startOfMonthDateOnly(value: string) {
  const parts = parseDateOnlyParts(value);
  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    '01',
  ].join('-');
}

function endOfMonthDateOnly(value: string) {
  const parts = parseDateOnlyParts(value);
  const date = new Date(Date.UTC(parts.year, parts.month, 0));
  return formatUtcDateOnly(date);
}

function parseDateOnlyParts(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return {
    year,
    month,
    day,
  };
}

function formatUtcDateOnly(date: Date) {
  return [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function normalizeRankingSortBy(value: unknown) {
  const text = normalizeOptionalString(value);
  if (!text) {
    return 'netSalesAmountCents';
  }
  const field = RANKING_SORT_FIELDS[text];
  if (!field) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'sortBy is invalid.',
    );
  }
  return field;
}

function normalizeTrendMetric(value: unknown) {
  const text = normalizeOptionalString(value);
  const metric = text ? text.toLowerCase() : 'net_sales';
  if (TREND_METRICS.includes(metric)) {
    return metric;
  }
  throw createHttpError(
    400,
    'VALIDATION_FAILED',
    'metric must be gross_sales, refund, net_sales, groups, guests, or no_order_rate.',
  );
}

function normalizeTrendGranularity(value: unknown) {
  const text = normalizeOptionalString(value);
  const granularity = text ? text.toLowerCase() : 'day';
  if (TREND_GRANULARITIES.includes(granularity)) {
    return granularity;
  }
  throw createHttpError(
    400,
    'VALIDATION_FAILED',
    'granularity must be day or month.',
  );
}

function normalizeSortDirection(value: unknown) {
  const text = normalizeOptionalString(value);
  if (!text) {
    return 'desc';
  }
  const normalized = text.toLowerCase();
  if (normalized === 'asc' || normalized === 'desc') {
    return normalized;
  }
  throw createHttpError(
    400,
    'VALIDATION_FAILED',
    'sortDirection must be asc or desc.',
  );
}

function normalizeLimit(value: unknown) {
  const text = normalizeOptionalString(value);
  if (!text) {
    return 50;
  }
  const limit = Number(text);
  if (!Number.isInteger(limit) || limit < 1) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'limit must be a positive integer.',
    );
  }
  return Math.min(limit, 200);
}

function assertExportRowLimit(rowCount: number) {
  if (rowCount > ANALYTICS_EXPORT_MAX_ROWS) {
    throw createHttpError(
      400,
      'EXPORT_LIMIT_EXCEEDED',
      `Analytics export exceeds ${ANALYTICS_EXPORT_MAX_ROWS} rows. Please narrow filters.`,
    );
  }
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

function buildAnalyticsOverviewExportFileName(date = new Date()) {
  return `analytics-overview-${formatFileNameTimestamp(date)}.xlsx`;
}

function buildAnalyticsTasterRankingsExportFileName(date = new Date()) {
  return `analytics-taster-rankings-${formatFileNameTimestamp(date)}.xlsx`;
}

function buildSalesPerformanceExportFileName(date = new Date()) {
  return `analytics-sales-performance-${formatFileNameTimestamp(date)}.xlsx`;
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
      'You do not have permission to perform this action.',
    );
  }
}
