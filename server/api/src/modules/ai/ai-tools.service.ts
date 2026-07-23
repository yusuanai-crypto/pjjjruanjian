import { Injectable, Optional } from '@nestjs/common';

import { createHttpError } from '../../common/errors';
import { AnalyticsNestService } from '../analytics/analytics.nest.service';
import { BusinessDataNestService } from '../business-data/business-data.nest.service';
import { CommissionRecordsNestService } from '../commissions/commission-records.nest.service';
import { TravelGroupFinanceSummaryNestService } from '../commissions/travel-group-finance-summary.nest.service';
import { CustomersNestService } from '../customers/customers.nest.service';
import { SettingsNestService } from '../settings/settings.nest.service';
import {
  AiPolicyService,
  type AiPolicyDecision,
} from './ai-policy.service';

export const AI_TOOL_NAMES = [
  'analytics.overview',
  'analytics.tasterRankings',
  'analytics.tasterDetail',
  'analytics.trends',
  'finance.summary',
  'commission.query',
  'travelGroup.financeSummary',
  'refund.query',
  'customer.lookup',
  'customer.orderLookup',
  'afterSales.lookup',
  'logistics.lookup',
  'commission.ruleExplain',
] as const;

export type AiToolName = (typeof AI_TOOL_NAMES)[number];

export interface AiToolInput {
  actor: {
    userId?: string | null;
    role: string;
  };
  range?: {
    preset?: string;
    dateFrom?: string;
    dateTo?: string;
  } | null;
  filters?: Record<string, unknown> | null;
  limit?: number | null;
}

export interface AiToolSourceSummary {
  rowCount: number;
  dateFrom?: string;
  dateTo?: string;
  globalMarkedFilterEnabled: boolean;
  scopeDescription: string;
}

export interface AiToolResult {
  toolName: AiToolName;
  data: unknown;
  sourceSummary: AiToolSourceSummary;
  warnings: string[];
}

export interface AiToolDefinition {
  toolName: AiToolName;
  intent: string;
  readOnly: true;
  description: string;
  execute: (input: AiToolInput) => Promise<AiToolResult> | AiToolResult;
}

type InternalToolDefinition = AiToolDefinition;

const TOOL_INTENTS: Record<AiToolName, string> = {
  'analytics.overview': 'analytics_overview',
  'analytics.tasterRankings': 'taster_ranking',
  'analytics.tasterDetail': 'taster_detail',
  'analytics.trends': 'analytics_trend',
  'finance.summary': 'finance_summary',
  'commission.query': 'commission_query',
  'travelGroup.financeSummary': 'travel_group_finance_query',
  'refund.query': 'refund_query',
  'customer.lookup': 'customer_lookup',
  'customer.orderLookup': 'customer_order_lookup',
  'afterSales.lookup': 'after_sales_lookup',
  'logistics.lookup': 'logistics_lookup',
  'commission.ruleExplain': 'commission_rule_explain',
};

const TOOL_DESCRIPTIONS: Record<AiToolName, string> = {
  'analytics.overview': 'Read-only analytics overview summary.',
  'analytics.tasterRankings': 'Read-only taster ranking summary.',
  'analytics.tasterDetail': 'Read-only taster ranking detail.',
  'analytics.trends': 'Read-only analytics trend points.',
  'finance.summary': 'Read-only finance summary.',
  'commission.query': 'Read-only commission records query.',
  'travelGroup.financeSummary': 'Read-only travel group points summary.',
  'refund.query': 'Read-only refund summary query.',
  'customer.lookup': 'Read-only customer lookup.',
  'customer.orderLookup': 'Read-only customer order lookup.',
  'afterSales.lookup': 'Read-only after-sales lookup.',
  'logistics.lookup': 'Read-only logistics lookup.',
  'commission.ruleExplain': 'Read-only commission rule explanation.',
};

const DANGEROUS_TOOL_NAMES = [
  'rawSql',
  'databaseQuery',
  'writeOrder',
  'updateCustomer',
  'exportAnalytics',
  'exportOrders',
  'exportCommissions',
  'recalculateCommission',
  'refreshTravelGroupFinanceSummary',
  'confirmRefund',
  'confirmCommission',
  'confirmAgencyDeduction',
  'transitionAfterSalesStatus',
  'updateFinanceMark',
  'updateFinanceFields',
  'updateWarehouseFields',
  'patchSalesOrder',
  'patchAfterSalesOrder',
] as const;

const DANGEROUS_TOOL_PATTERN =
  /(sql|database|querydatabase|write|update|delete|insert|create|patch|post|export|recalculate|refresh|confirm|transition|status|mark|financefield|warehousefield)/i;
const AI_TASTER_RANKING_DEFAULT_LIMIT = 10;
const AI_TASTER_RANKING_MAX_LIMIT = 50;
const AI_TASTER_DETAIL_LOOKUP_LIMIT = 200;
const AI_FINANCE_QUERY_DEFAULT_LIMIT = 20;
const AI_FINANCE_QUERY_MAX_LIMIT = 50;
const AI_FINANCE_SUMMARY_LOOKUP_LIMIT = 200;
const AI_CUSTOMER_LOOKUP_DEFAULT_LIMIT = 10;
const AI_CUSTOMER_LOOKUP_MAX_LIMIT = 50;
const AI_PRIVACY_WARNING =
  'Customer phones are masked and full addresses are omitted in AI tool output.';
const AI_TASTER_RANKING_SORT_FIELDS = [
  'netSalesAmountCents',
  'totalGroupCount',
  'totalGuestCount',
  'averageSalesPerGroupCents',
  'averageSalesPerGuestCents',
  'noOrderRate',
] as const;

@Injectable()
export class AiToolsService {
  private readonly tools = new Map<AiToolName, InternalToolDefinition>();

  constructor(
    private readonly policyService: AiPolicyService,
    @Optional() private readonly analyticsService?: AnalyticsNestService,
    @Optional() private readonly settingsService?: SettingsNestService,
    @Optional() private readonly businessDataService?: BusinessDataNestService,
    @Optional()
    private readonly commissionRecordsService?: CommissionRecordsNestService,
    @Optional()
    private readonly travelGroupFinanceSummaryService?: TravelGroupFinanceSummaryNestService,
    @Optional() private readonly customersService?: CustomersNestService,
  ) {
    for (const toolName of AI_TOOL_NAMES) {
      this.registerTool(this.buildDefaultToolDefinition(toolName));
    }
  }

  listToolNames(): AiToolName[] {
    return [...this.tools.keys()];
  }

  listToolDefinitions(): Array<Omit<AiToolDefinition, 'execute'>> {
    return [...this.tools.values()].map((definition) => ({
      toolName: definition.toolName,
      intent: definition.intent,
      readOnly: definition.readOnly,
      description: definition.description,
    }));
  }

  getToolDefinition(
    toolName: string,
  ): Omit<AiToolDefinition, 'execute'> | null {
    const definition = this.tools.get(normalizeToolName(toolName));
    if (!definition) {
      return null;
    }
    return {
      toolName: definition.toolName,
      intent: definition.intent,
      readOnly: definition.readOnly,
      description: definition.description,
    };
  }

  registerTool(definition: AiToolDefinition): void {
    validateToolDefinition(definition);
    this.tools.set(definition.toolName, definition);
  }

  async executeTool(
    toolName: string,
    input: AiToolInput,
  ): Promise<AiToolResult> {
    const definition = this.tools.get(normalizeToolName(toolName));
    if (!definition) {
      throw createHttpError(
        400,
        'AI_TOOL_NOT_REGISTERED',
        'AI tool is not registered.',
      );
    }

    const decision = this.policyService.evaluateRequest(input?.actor, {
      intent: definition.intent,
    });
    if (!decision.allowed) {
      throwPolicyError(decision);
    }

    const result = await definition.execute(input);
    return normalizeToolResult(definition.toolName, result, decision);
  }

  private buildDefaultToolDefinition(toolName: AiToolName): AiToolDefinition {
    if (toolName === 'analytics.overview' && this.analyticsService) {
      return this.buildAnalyticsOverviewToolDefinition();
    }
    if (toolName === 'analytics.tasterRankings' && this.analyticsService) {
      return this.buildAnalyticsTasterRankingsToolDefinition();
    }
    if (toolName === 'analytics.tasterDetail' && this.analyticsService) {
      return this.buildAnalyticsTasterDetailToolDefinition();
    }
    if (toolName === 'analytics.trends' && this.analyticsService) {
      return this.buildAnalyticsTrendsToolDefinition();
    }
    if (toolName === 'finance.summary' && this.businessDataService) {
      return this.buildFinanceSummaryToolDefinition();
    }
    if (toolName === 'refund.query' && this.businessDataService) {
      return this.buildRefundQueryToolDefinition();
    }
    if (toolName === 'commission.query' && this.commissionRecordsService) {
      return this.buildCommissionQueryToolDefinition();
    }
    if (
      toolName === 'travelGroup.financeSummary' &&
      this.travelGroupFinanceSummaryService
    ) {
      return this.buildTravelGroupFinanceSummaryToolDefinition();
    }
    if (toolName === 'customer.lookup' && this.customersService) {
      return this.buildCustomerLookupToolDefinition();
    }
    if (toolName === 'customer.orderLookup' && this.businessDataService) {
      return this.buildCustomerOrderLookupToolDefinition();
    }
    if (toolName === 'afterSales.lookup' && this.businessDataService) {
      return this.buildAfterSalesLookupToolDefinition();
    }
    if (toolName === 'logistics.lookup' && this.businessDataService) {
      return this.buildLogisticsLookupToolDefinition();
    }
    return buildMockToolDefinition(toolName);
  }

  private buildAnalyticsOverviewToolDefinition(): AiToolDefinition {
    return {
      toolName: 'analytics.overview',
      intent: TOOL_INTENTS['analytics.overview'],
      readOnly: true,
      description: TOOL_DESCRIPTIONS['analytics.overview'],
      execute: (input) => this.executeAnalyticsOverviewTool(input),
    };
  }

  private buildAnalyticsTasterRankingsToolDefinition(): AiToolDefinition {
    return {
      toolName: 'analytics.tasterRankings',
      intent: TOOL_INTENTS['analytics.tasterRankings'],
      readOnly: true,
      description: TOOL_DESCRIPTIONS['analytics.tasterRankings'],
      execute: (input) => this.executeAnalyticsTasterRankingsTool(input),
    };
  }

  private buildAnalyticsTasterDetailToolDefinition(): AiToolDefinition {
    return {
      toolName: 'analytics.tasterDetail',
      intent: TOOL_INTENTS['analytics.tasterDetail'],
      readOnly: true,
      description: TOOL_DESCRIPTIONS['analytics.tasterDetail'],
      execute: (input) => this.executeAnalyticsTasterDetailTool(input),
    };
  }

  private buildAnalyticsTrendsToolDefinition(): AiToolDefinition {
    return {
      toolName: 'analytics.trends',
      intent: TOOL_INTENTS['analytics.trends'],
      readOnly: true,
      description: TOOL_DESCRIPTIONS['analytics.trends'],
      execute: (input) => this.executeAnalyticsTrendsTool(input),
    };
  }

  private buildFinanceSummaryToolDefinition(): AiToolDefinition {
    return {
      toolName: 'finance.summary',
      intent: TOOL_INTENTS['finance.summary'],
      readOnly: true,
      description: TOOL_DESCRIPTIONS['finance.summary'],
      execute: (input) => this.executeFinanceSummaryTool(input),
    };
  }

  private buildRefundQueryToolDefinition(): AiToolDefinition {
    return {
      toolName: 'refund.query',
      intent: TOOL_INTENTS['refund.query'],
      readOnly: true,
      description: TOOL_DESCRIPTIONS['refund.query'],
      execute: (input) => this.executeRefundQueryTool(input),
    };
  }

  private buildCommissionQueryToolDefinition(): AiToolDefinition {
    return {
      toolName: 'commission.query',
      intent: TOOL_INTENTS['commission.query'],
      readOnly: true,
      description: TOOL_DESCRIPTIONS['commission.query'],
      execute: (input) => this.executeCommissionQueryTool(input),
    };
  }

  private buildTravelGroupFinanceSummaryToolDefinition(): AiToolDefinition {
    return {
      toolName: 'travelGroup.financeSummary',
      intent: TOOL_INTENTS['travelGroup.financeSummary'],
      readOnly: true,
      description: TOOL_DESCRIPTIONS['travelGroup.financeSummary'],
      execute: (input) => this.executeTravelGroupFinanceSummaryTool(input),
    };
  }

  private buildCustomerLookupToolDefinition(): AiToolDefinition {
    return {
      toolName: 'customer.lookup',
      intent: TOOL_INTENTS['customer.lookup'],
      readOnly: true,
      description: TOOL_DESCRIPTIONS['customer.lookup'],
      execute: (input) => this.executeCustomerLookupTool(input),
    };
  }

  private buildCustomerOrderLookupToolDefinition(): AiToolDefinition {
    return {
      toolName: 'customer.orderLookup',
      intent: TOOL_INTENTS['customer.orderLookup'],
      readOnly: true,
      description: TOOL_DESCRIPTIONS['customer.orderLookup'],
      execute: (input) => this.executeCustomerOrderLookupTool(input),
    };
  }

  private buildAfterSalesLookupToolDefinition(): AiToolDefinition {
    return {
      toolName: 'afterSales.lookup',
      intent: TOOL_INTENTS['afterSales.lookup'],
      readOnly: true,
      description: TOOL_DESCRIPTIONS['afterSales.lookup'],
      execute: (input) => this.executeAfterSalesLookupTool(input),
    };
  }

  private buildLogisticsLookupToolDefinition(): AiToolDefinition {
    return {
      toolName: 'logistics.lookup',
      intent: TOOL_INTENTS['logistics.lookup'],
      readOnly: true,
      description: TOOL_DESCRIPTIONS['logistics.lookup'],
      execute: (input) => this.executeLogisticsLookupTool(input),
    };
  }

  private async executeAnalyticsOverviewTool(
    input: AiToolInput,
  ): Promise<AiToolResult> {
    const overview = await this.analyticsService!.getOverview(
      input.actor,
      buildAnalyticsQuery(input),
    );
    const metrics = toAiOverviewMetrics(overview?.metrics);
    const globalMarkedFilterEnabled =
      await this.getGlobalMarkedFilterEnabled();

    return {
      toolName: 'analytics.overview',
      data: {
        range: overview?.range ?? null,
        ...metrics,
      },
      sourceSummary: {
        rowCount: metrics.totalGroupCount,
        ...buildDateRangeSummary(overview?.range, input?.range),
        globalMarkedFilterEnabled,
        scopeDescription: '',
      },
      warnings: normalizeToolWarnings(overview?.warnings),
    };
  }

  private async executeAnalyticsTasterRankingsTool(
    input: AiToolInput,
  ): Promise<AiToolResult> {
    const rankingResult: any = await this.analyticsService!.listTasterRankings(
      input.actor,
      buildTasterRankingsQuery(input),
    );
    const rankings = Array.isArray(rankingResult?.rankings)
      ? rankingResult.rankings.map(toAiTasterRankingRow)
      : [];
    const globalMarkedFilterEnabled =
      await this.getGlobalMarkedFilterEnabled();

    return {
      toolName: 'analytics.tasterRankings',
      data: {
        range: rankingResult?.range ?? null,
        rankings,
      },
      sourceSummary: {
        rowCount: rankings.length,
        ...buildDateRangeSummary(rankingResult?.range, input?.range),
        globalMarkedFilterEnabled,
        scopeDescription: '',
      },
      warnings: collectRankingWarnings(rankings),
    };
  }

  private async executeAnalyticsTasterDetailTool(
    input: AiToolInput,
  ): Promise<AiToolResult> {
    const tasterId = extractTasterId(input);
    const detailResult: any =
      await this.analyticsService!.getTasterRankingDetail(
        input.actor,
        tasterId,
        buildTasterDetailQuery(input),
      );
    const summary = toAiTasterRankingRow(detailResult?.summary);
    const globalMarkedFilterEnabled =
      await this.getGlobalMarkedFilterEnabled();
    const sourceCounts = {
      travelGroupCount: Array.isArray(detailResult?.travelGroups)
        ? detailResult.travelGroups.length
        : 0,
      orderCount: Array.isArray(detailResult?.orders)
        ? detailResult.orders.length
        : 0,
      afterSalesOrderCount: Array.isArray(detailResult?.afterSalesOrders)
        ? detailResult.afterSalesOrders.length
        : 0,
    };

    return {
      toolName: 'analytics.tasterDetail',
      data: {
        range: detailResult?.range ?? null,
        taster: {
          id: nullableString(detailResult?.taster?.id),
          name: nullableString(detailResult?.taster?.name),
        },
        summary,
        sourceCounts,
        sourceIds: {
          travelGroupIds: compactIdList(detailResult?.travelGroups),
          orderIds: compactIdList(detailResult?.orders),
          afterSalesOrderIds: compactIdList(detailResult?.afterSalesOrders),
        },
      },
      sourceSummary: {
        rowCount: sourceCounts.travelGroupCount,
        ...buildDateRangeSummary(detailResult?.range, input?.range),
        globalMarkedFilterEnabled,
        scopeDescription: '',
      },
      warnings: normalizeToolWarnings(detailResult?.warnings),
    };
  }

  private async executeAnalyticsTrendsTool(
    input: AiToolInput,
  ): Promise<AiToolResult> {
    const trendsResult: any = await this.analyticsService!.listTrends(
      input.actor,
      buildAnalyticsQuery(input),
    );
    const compactTrendPoints = Array.isArray(trendsResult?.trends)
      ? trendsResult.trends.map(toAiTrendPoint)
      : [];
    const globalMarkedFilterEnabled =
      await this.getGlobalMarkedFilterEnabled();

    return {
      toolName: 'analytics.trends',
      data: {
        range: trendsResult?.range ?? null,
        granularity: trendsResult?.granularity ?? null,
        metric: trendsResult?.metric ?? null,
        trends: compactTrendPoints,
      },
      sourceSummary: {
        rowCount: compactTrendPoints.length,
        ...buildDateRangeSummary(trendsResult?.range, input?.range),
        globalMarkedFilterEnabled,
        scopeDescription: '',
      },
      warnings: normalizeToolWarnings(trendsResult?.warnings),
    };
  }

  private async executeFinanceSummaryTool(
    input: AiToolInput,
  ): Promise<AiToolResult> {
    const query = buildFinanceWorkbenchQuery(input);
    const workbench: any = await this.businessDataService!.getFinanceWorkbench(
      input.actor,
      query,
    );
    const metrics = toAiFinanceMetrics(workbench?.metrics);
    const globalMarkedFilterEnabled =
      await this.getGlobalMarkedFilterEnabled();
    const warnings: string[] = [];

    const commissionRecords = this.commissionRecordsService
      ? await this.commissionRecordsService.listCommissionRecords(
          input.actor,
          buildCommissionQuery(input, {
            limit: AI_FINANCE_SUMMARY_LOOKUP_LIMIT,
          }),
        )
      : [];
    if (!this.commissionRecordsService) {
      warnings.push('Commission summary service is not available.');
    }

    const travelGroupFinanceSummaries =
      this.travelGroupFinanceSummaryService
        ? await this.travelGroupFinanceSummaryService.listTravelGroupFinanceSummaries(
            input.actor,
            buildTravelGroupFinanceSummaryQuery(input, {
              limit: AI_FINANCE_SUMMARY_LOOKUP_LIMIT,
            }),
          )
        : [];
    if (!this.travelGroupFinanceSummaryService) {
      warnings.push('Travel group finance summary service is not available.');
    }

    const pendingAfterSales = Array.isArray(workbench?.pendingAfterSales)
      ? workbench.pendingAfterSales.map(toAiRefundRow)
      : [];
    const pendingLogistics = Array.isArray(workbench?.pendingLogistics)
      ? workbench.pendingLogistics.map(toAiPendingLogisticsRow)
      : [];
    const commissionSummary = summarizeCommissionRecords(commissionRecords);
    const pointsSummary = summarizeTravelGroupFinanceSummaries(
      travelGroupFinanceSummaries,
    );

    addLimitWarning(
      warnings,
      'commission.query',
      commissionRecords.length,
      AI_FINANCE_SUMMARY_LOOKUP_LIMIT,
    );
    addLimitWarning(
      warnings,
      'travelGroup.financeSummary',
      travelGroupFinanceSummaries.length,
      AI_FINANCE_SUMMARY_LOOKUP_LIMIT,
    );

    return {
      toolName: 'finance.summary',
      data: {
        ...metrics,
        refunds: {
          confirmedRefundAmountCents: metrics.refundAmountCents,
          pendingRefundAmountCents:
            metrics.pendingAfterSalesRefundAmountCents,
          pendingRefundCount: metrics.pendingAfterSalesConfirmCount,
          pendingItems: pendingAfterSales,
        },
        logistics: {
          logisticsFeeCents: metrics.logisticsFeeCents,
          pendingItems: pendingLogistics,
        },
        commission: commissionSummary,
        points: pointsSummary,
      },
      sourceSummary: {
        rowCount:
          metrics.orderCount +
          commissionSummary.recordCount +
          pointsSummary.recordCount,
        ...buildDateRangeSummary(null, input?.range),
        globalMarkedFilterEnabled,
        scopeDescription: '',
      },
      warnings,
    };
  }

  private async executeRefundQueryTool(
    input: AiToolInput,
  ): Promise<AiToolResult> {
    const refunds = (
      await this.businessDataService!.listAfterSalesOrders(
        buildAiRefundReadActor(input.actor),
        buildRefundQuery(input),
      )
    )
      .filter((order: unknown) => toNumber((order as any)?.refundAmountCents) > 0)
      .map(toAiRefundRow);
    const globalMarkedFilterEnabled =
      await this.getGlobalMarkedFilterEnabled();
    const summary = summarizeRefundRows(refunds);

    return {
      toolName: 'refund.query',
      data: {
        summary,
        refunds,
      },
      sourceSummary: {
        rowCount: refunds.length,
        ...buildDateRangeSummary(null, input?.range),
        globalMarkedFilterEnabled,
        scopeDescription: '',
      },
      warnings: [],
    };
  }

  private async executeCommissionQueryTool(
    input: AiToolInput,
  ): Promise<AiToolResult> {
    const records = await this.commissionRecordsService!.listCommissionRecords(
      input.actor,
      buildCommissionQuery(input),
    );
    const compactRecords = records.map(toAiCommissionRecord);
    const globalMarkedFilterEnabled =
      await this.getGlobalMarkedFilterEnabled();

    return {
      toolName: 'commission.query',
      data: {
        summary: summarizeCommissionRecords(records),
        records: compactRecords,
      },
      sourceSummary: {
        rowCount: compactRecords.length,
        ...buildDateRangeSummary(null, input?.range),
        globalMarkedFilterEnabled,
        scopeDescription: '',
      },
      warnings: [],
    };
  }

  private async executeTravelGroupFinanceSummaryTool(
    input: AiToolInput,
  ): Promise<AiToolResult> {
    const filters = isRecord(input?.filters) ? input.filters : {};
    const travelGroupId = nullableString(filters.travelGroupId);
    const globalMarkedFilterEnabled =
      await this.getGlobalMarkedFilterEnabled();

    if (travelGroupId) {
      const summary =
        await this.travelGroupFinanceSummaryService!.getTravelGroupFinanceSummary(
          input.actor,
          travelGroupId,
        );
      const compactSummary = toAiTravelGroupFinanceSummary(summary);
      return {
        toolName: 'travelGroup.financeSummary',
        data: {
          summary: compactSummary,
          totals: summarizeTravelGroupFinanceSummaries([summary]),
          sourceCounts: getTravelGroupFinanceSourceCounts(summary),
        },
        sourceSummary: {
          rowCount: 1,
          ...buildDateRangeSummary(null, input?.range),
          globalMarkedFilterEnabled,
          scopeDescription: '',
        },
        warnings: [],
      };
    }

    const summaries =
      await this.travelGroupFinanceSummaryService!.listTravelGroupFinanceSummaries(
        input.actor,
        buildTravelGroupFinanceSummaryQuery(input),
      );
    return {
      toolName: 'travelGroup.financeSummary',
      data: {
        totals: summarizeTravelGroupFinanceSummaries(summaries),
        summaries: summaries.map(toAiTravelGroupFinanceSummary),
      },
      sourceSummary: {
        rowCount: summaries.length,
        ...buildDateRangeSummary(null, input?.range),
        globalMarkedFilterEnabled,
        scopeDescription: '',
      },
      warnings: [],
    };
  }

  private async executeCustomerLookupTool(
    input: AiToolInput,
  ): Promise<AiToolResult> {
    const filters = isRecord(input?.filters) ? input.filters : {};
    const customerId =
      nullableString(filters.customerId) || nullableString(filters.id);
    const warnings = [AI_PRIVACY_WARNING];
    const globalMarkedFilterEnabled =
      await this.getGlobalMarkedFilterEnabled();

    const customers = customerId
      ? [await this.customersService!.getCustomer(input.actor, customerId)]
      : await this.customersService!.listCustomers(
          input.actor,
          buildCustomerLookupQuery(input),
        );
    const orderMatches =
      this.businessDataService && !customerId
        ? await this.businessDataService.listSalesOrders(
            input.actor,
            buildOrderLookupQuery(input),
          )
        : [];
    const compactCustomers = mergeAiCustomers([
      ...customers.map(toAiCustomerSummary),
      ...orderMatches.map((order: unknown) =>
        toAiCustomerSummary(
          isRecord(order) && isRecord(order.customer) ? order.customer : order,
        ),
      ),
    ]);
    const orders = orderMatches.map((order: unknown) =>
      toAiOrderSummary(order),
    );

    addLimitWarning(
      warnings,
      'customer.lookup',
      compactCustomers.length,
      AI_CUSTOMER_LOOKUP_MAX_LIMIT,
    );

    return {
      toolName: 'customer.lookup',
      data: {
        customers: compactCustomers,
        matchedOrders: orders,
        sourceCounts: {
          customerCount: compactCustomers.length,
          matchedOrderCount: orders.length,
        },
      },
      sourceSummary: {
        rowCount: compactCustomers.length + orders.length,
        ...buildDateRangeSummary(null, input?.range),
        globalMarkedFilterEnabled,
        scopeDescription: '',
      },
      warnings,
    };
  }

  private async executeCustomerOrderLookupTool(
    input: AiToolInput,
  ): Promise<AiToolResult> {
    const orders = await this.businessDataService!.listSalesOrders(
      input.actor,
      buildOrderLookupQuery(input),
    );
    const afterSalesOrders =
      await this.businessDataService!.listAfterSalesOrders(
        input.actor,
        buildAfterSalesLookupQuery(input),
      );
    const compactAfterSales = afterSalesOrders.map(toAiAfterSalesSummary);
    const compactOrders = orders.map((order: unknown) =>
      toAiOrderSummary(order, {
        afterSalesOrders: compactAfterSales.filter(
          (afterSales) =>
            afterSales.salesOrderId &&
            afterSales.salesOrderId === nullableString((order as any)?.id),
        ),
      }),
    );
    const globalMarkedFilterEnabled =
      await this.getGlobalMarkedFilterEnabled();

    return {
      toolName: 'customer.orderLookup',
      data: {
        summary: summarizeOrderRows(compactOrders),
        orders: compactOrders,
        afterSales: compactAfterSales,
      },
      sourceSummary: {
        rowCount: compactOrders.length + compactAfterSales.length,
        ...buildDateRangeSummary(null, input?.range),
        globalMarkedFilterEnabled,
        scopeDescription: '',
      },
      warnings: [AI_PRIVACY_WARNING],
    };
  }

  private async executeAfterSalesLookupTool(
    input: AiToolInput,
  ): Promise<AiToolResult> {
    const afterSalesOrders =
      await this.businessDataService!.listAfterSalesOrders(
        input.actor,
        buildAfterSalesLookupQuery(input),
      );
    const compactAfterSales = afterSalesOrders.map(toAiAfterSalesSummary);
    const globalMarkedFilterEnabled =
      await this.getGlobalMarkedFilterEnabled();

    return {
      toolName: 'afterSales.lookup',
      data: {
        summary: summarizeAfterSalesRows(compactAfterSales),
        afterSales: compactAfterSales,
      },
      sourceSummary: {
        rowCount: compactAfterSales.length,
        ...buildDateRangeSummary(null, input?.range),
        globalMarkedFilterEnabled,
        scopeDescription: '',
      },
      warnings: [AI_PRIVACY_WARNING],
    };
  }

  private async executeLogisticsLookupTool(
    input: AiToolInput,
  ): Promise<AiToolResult> {
    const orders = await this.businessDataService!.listSalesOrders(
      input.actor,
      buildLogisticsLookupQuery(input),
    );
    const logisticsRows = orders.map(toAiLogisticsSummary);
    const globalMarkedFilterEnabled =
      await this.getGlobalMarkedFilterEnabled();

    return {
      toolName: 'logistics.lookup',
      data: {
        summary: summarizeLogisticsRows(logisticsRows),
        logistics: logisticsRows,
      },
      sourceSummary: {
        rowCount: logisticsRows.length,
        ...buildDateRangeSummary(null, input?.range),
        globalMarkedFilterEnabled,
        scopeDescription: '',
      },
      warnings: [AI_PRIVACY_WARNING],
    };
  }

  private async getGlobalMarkedFilterEnabled(): Promise<boolean> {
    if (!this.settingsService) {
      return false;
    }
    const settings = await this.settingsService.getGlobalMarkQuery();
    return Boolean(settings?.onlyShowMarkedRecords);
  }
}

function buildMockToolDefinition(toolName: AiToolName): AiToolDefinition {
  return {
    toolName,
    intent: TOOL_INTENTS[toolName],
    readOnly: true,
    description: TOOL_DESCRIPTIONS[toolName],
    execute: (input) => ({
      toolName,
      data: null,
      sourceSummary: {
        rowCount: 0,
        ...(input?.range?.dateFrom ? { dateFrom: input.range.dateFrom } : {}),
        ...(input?.range?.dateTo ? { dateTo: input.range.dateTo } : {}),
        globalMarkedFilterEnabled: false,
        scopeDescription: '',
      },
      warnings: [
        'Stage 9 AI tool registry is ready; this tool is not connected to business data yet.',
      ],
    }),
  };
}

function buildAnalyticsQuery(input: AiToolInput): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  const filters = isRecord(input?.filters) ? input.filters : {};
  copyAllowedQueryFields(query, filters);

  if (input?.range?.preset) {
    query.preset = input.range.preset;
  }
  if (input?.range?.dateFrom) {
    query.dateFrom = input.range.dateFrom;
  }
  if (input?.range?.dateTo) {
    query.dateTo = input.range.dateTo;
  }
  return query;
}

function buildTasterRankingsQuery(input: AiToolInput): Record<string, unknown> {
  const query = buildAnalyticsQuery(input);
  const filters = isRecord(input?.filters) ? input.filters : {};
  copyTasterRankingQueryFields(query, filters);
  query.limit = normalizeAiLimit(
    input?.limit ?? filters.limit ?? AI_TASTER_RANKING_DEFAULT_LIMIT,
    AI_TASTER_RANKING_DEFAULT_LIMIT,
    AI_TASTER_RANKING_MAX_LIMIT,
  );
  return query;
}

function buildTasterDetailQuery(input: AiToolInput): Record<string, unknown> {
  const query = buildAnalyticsQuery(input);
  const filters = isRecord(input?.filters) ? input.filters : {};
  copyTasterRankingQueryFields(query, filters);
  query.limit = AI_TASTER_DETAIL_LOOKUP_LIMIT;
  return query;
}

function buildFinanceWorkbenchQuery(
  input: AiToolInput,
): Record<string, unknown> {
  const query = buildBusinessDataQuery(input);
  query.limit = normalizeAiLimit(
    input?.limit ?? AI_FINANCE_QUERY_DEFAULT_LIMIT,
    AI_FINANCE_QUERY_DEFAULT_LIMIT,
    AI_FINANCE_QUERY_MAX_LIMIT,
  );
  return query;
}

function buildRefundQuery(input: AiToolInput): Record<string, unknown> {
  const query = buildBusinessDataQuery(input);
  const filters = isRecord(input?.filters) ? input.filters : {};
  for (const key of [
    'status',
    'issueType',
    'actionType',
    'salesOrderId',
    'customerId',
    'financeConfirmed',
  ]) {
    const value = filters[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      query[key] = value;
    }
  }
  query.limit = normalizeAiLimit(
    input?.limit ?? filters.limit ?? AI_FINANCE_QUERY_DEFAULT_LIMIT,
    AI_FINANCE_QUERY_DEFAULT_LIMIT,
    AI_FINANCE_QUERY_MAX_LIMIT,
  );
  return query;
}

function buildCommissionQuery(
  input: AiToolInput,
  options: { limit?: number } = {},
): Record<string, unknown> {
  const query = buildBusinessDataQuery(input);
  const filters = isRecord(input?.filters) ? input.filters : {};
  for (const key of [
    'id',
    'targetType',
    'targetUserId',
    'agencyId',
    'travelGroupId',
    'salesOrderId',
    'isConfirmed',
    'manualInput',
  ]) {
    const value = filters[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      query[key] = value;
    }
  }
  query.limit =
    options.limit ??
    normalizeAiLimit(
      input?.limit ?? filters.limit ?? AI_FINANCE_QUERY_DEFAULT_LIMIT,
      AI_FINANCE_QUERY_DEFAULT_LIMIT,
      AI_FINANCE_QUERY_MAX_LIMIT,
    );
  return query;
}

function buildTravelGroupFinanceSummaryQuery(
  input: AiToolInput,
  options: { limit?: number } = {},
): Record<string, unknown> {
  const query = buildBusinessDataQuery(input);
  const filters = isRecord(input?.filters) ? input.filters : {};
  for (const key of ['travelGroupId', 'agencyDeductionConfirmed']) {
    const value = filters[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      query[key] = value;
    }
  }
  query.limit =
    options.limit ??
    normalizeAiLimit(
      input?.limit ?? filters.limit ?? AI_FINANCE_QUERY_DEFAULT_LIMIT,
      AI_FINANCE_QUERY_DEFAULT_LIMIT,
      AI_FINANCE_QUERY_MAX_LIMIT,
    );
  return query;
}

function buildCustomerLookupQuery(
  input: AiToolInput,
): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  const filters = isRecord(input?.filters) ? input.filters : {};
  const searchText = buildLookupSearchText(filters);
  if (searchText) {
    query.query = searchText;
  }
  const phone =
    nullableString(filters.phone) || nullableString(filters.customerPhone);
  if (phone) {
    query.phone = phone;
  }
  query.limit = normalizeAiLimit(
    input?.limit ?? filters.limit ?? AI_CUSTOMER_LOOKUP_DEFAULT_LIMIT,
    AI_CUSTOMER_LOOKUP_DEFAULT_LIMIT,
    AI_CUSTOMER_LOOKUP_MAX_LIMIT,
  );
  return query;
}

function buildOrderLookupQuery(input: AiToolInput): Record<string, unknown> {
  const query = buildBusinessDataQuery(input);
  const filters = isRecord(input?.filters) ? input.filters : {};
  applyLookupSearchText(query, filters);
  copyLookupFilterFields(query, filters, [
    'status',
    'orderType',
    'deliveryType',
    'packingStatus',
    'logisticsMethod',
    'salesUserId',
  ]);
  const customerPhone =
    nullableString(filters.customerPhone) || nullableString(filters.phone);
  if (customerPhone) {
    query.customerPhone = customerPhone;
  }
  query.limit = normalizeAiLimit(
    input?.limit ?? filters.limit ?? AI_CUSTOMER_LOOKUP_DEFAULT_LIMIT,
    AI_CUSTOMER_LOOKUP_DEFAULT_LIMIT,
    AI_CUSTOMER_LOOKUP_MAX_LIMIT,
  );
  return query;
}

function buildAfterSalesLookupQuery(
  input: AiToolInput,
): Record<string, unknown> {
  const query = buildBusinessDataQuery(input);
  const filters = isRecord(input?.filters) ? input.filters : {};
  applyLookupSearchText(query, filters);
  copyLookupFilterFields(query, filters, [
    'status',
    'issueType',
    'actionType',
    'salesOrderId',
    'customerId',
    'financeConfirmed',
  ]);
  query.limit = normalizeAiLimit(
    input?.limit ?? filters.limit ?? AI_CUSTOMER_LOOKUP_DEFAULT_LIMIT,
    AI_CUSTOMER_LOOKUP_DEFAULT_LIMIT,
    AI_CUSTOMER_LOOKUP_MAX_LIMIT,
  );
  return query;
}

function buildLogisticsLookupQuery(
  input: AiToolInput,
): Record<string, unknown> {
  const query = buildOrderLookupQuery(input);
  const filters = isRecord(input?.filters) ? input.filters : {};
  if (!query.deliveryType && filters.includeNonShipping !== true) {
    query.deliveryType = 'shipping';
  }
  return query;
}

function buildBusinessDataQuery(input: AiToolInput): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  const filters = isRecord(input?.filters) ? input.filters : {};
  for (const key of [
    'query',
    'keyword',
    'search',
    'customerId',
    'travelGroupId',
  ]) {
    const value = filters[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      query[key] = value;
    }
  }
  if (input?.range?.dateFrom) {
    query.dateFrom = input.range.dateFrom;
  }
  if (input?.range?.dateTo) {
    query.dateTo = input.range.dateTo;
  }
  return query;
}

function applyLookupSearchText(
  query: Record<string, unknown>,
  filters: Record<string, unknown>,
) {
  if (query.query || query.keyword || query.search) {
    return;
  }
  const searchText = buildLookupSearchText(filters);
  if (searchText) {
    query.query = searchText;
  }
}

function buildLookupSearchText(
  filters: Record<string, unknown>,
): string | null {
  for (const key of [
    'query',
    'keyword',
    'search',
    'phone',
    'customerPhone',
    'customerName',
    'name',
    'orderNo',
    'salesOrderNo',
    'afterSalesNo',
    'logisticsNo',
  ]) {
    const value = nullableString(filters[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function copyLookupFilterFields(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      target[key] = value;
    }
  }
}

function copyAllowedQueryFields(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
) {
  for (const key of [
    'groupType',
    'tasterId',
    'travelAgency',
    'metric',
    'granularity',
  ]) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      target[key] = value;
    }
  }
}

function copyTasterRankingQueryFields(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
) {
  const sortBy = nullableString(source.sortBy);
  if (sortBy) {
    assertAiTasterRankingSortBy(sortBy);
    target.sortBy = sortBy;
  }
  const sortDirection = nullableString(source.sortDirection);
  if (sortDirection) {
    target.sortDirection = sortDirection;
  }
}

function toAiOverviewMetrics(metrics: unknown) {
  const source = isRecord(metrics) ? metrics : {};
  const averageSalesPerGroupCents = toNumber(
    source.averageSalesPerGroupCents,
  );
  const averageSalesPerGuestCents = toNumber(
    source.averageSalesPerGuestCents,
  );
  return {
    grossSalesAmountCents: toNumber(source.grossSalesAmountCents),
    refundAmountCents: toNumber(source.refundAmountCents),
    pendingRefundAmountCents: toNumber(source.pendingRefundAmountCents),
    netSalesAmountCents: toNumber(source.netSalesAmountCents),
    totalGroupCount: toNumber(source.totalGroupCount),
    totalGuestCount: toNumber(source.totalGuestCount),
    groupScopedNetSalesAmountCents: toNumber(
      source.groupScopedNetSalesAmountCents,
    ),
    averageSalesPerGroupCents,
    averageSalesPerGuestCents,
    averageSales: {
      perGroupCents: averageSalesPerGroupCents,
      perGuestCents: averageSalesPerGuestCents,
    },
    noEffectiveOrderGroupCount: toNumber(source.noEffectiveOrderGroupCount),
    conversionGroupCount: toNumber(source.conversionGroupCount),
    noOrderRate: toNumber(source.noOrderRate),
    conversionRate: toNumber(source.conversionRate),
  };
}

function toAiTasterRankingRow(row: unknown) {
  const source = isRecord(row) ? row : {};
  return {
    rank: toNumber(source.rank),
    tasterId: nullableString(source.tasterId),
    tasterName: nullableString(source.tasterName) || '',
    totalGroupCount: toNumber(source.totalGroupCount),
    totalGuestCount: toNumber(source.totalGuestCount),
    grossSalesAmountCents: toNumber(source.grossSalesAmountCents),
    refundAmountCents: toNumber(source.refundAmountCents),
    netSalesAmountCents: toNumber(source.netSalesAmountCents),
    averageSalesPerGroupCents: toNumber(source.averageSalesPerGroupCents),
    averageSalesPerGuestCents: toNumber(source.averageSalesPerGuestCents),
    noEffectiveOrderGroupCount: toNumber(source.noEffectiveOrderGroupCount),
    conversionGroupCount: toNumber(source.conversionGroupCount),
    noOrderRate: toNumber(source.noOrderRate),
    conversionRate: toNumber(source.conversionRate),
    warnings: normalizeToolWarnings(source.warnings),
  };
}

function toAiTrendPoint(point: unknown) {
  const source = isRecord(point) ? point : {};
  return {
    periodStart: nullableString(source.periodStart),
    periodEnd: nullableString(source.periodEnd),
    metricValue: toNumber(source.metricValue),
    grossSalesAmountCents: toNumber(source.grossSalesAmountCents),
    refundAmountCents: toNumber(source.refundAmountCents),
    pendingRefundAmountCents: toNumber(source.pendingRefundAmountCents),
    netSalesAmountCents: toNumber(source.netSalesAmountCents),
    totalGroupCount: toNumber(source.totalGroupCount),
    totalGuestCount: toNumber(source.totalGuestCount),
    groupScopedNetSalesAmountCents: toNumber(
      source.groupScopedNetSalesAmountCents,
    ),
    noEffectiveOrderGroupCount: toNumber(source.noEffectiveOrderGroupCount),
    conversionGroupCount: toNumber(source.conversionGroupCount),
    noOrderRate: toNumber(source.noOrderRate),
    conversionRate: toNumber(source.conversionRate),
  };
}

function toAiFinanceMetrics(metrics: unknown) {
  const source = isRecord(metrics) ? metrics : {};
  return {
    travelGroupCount: toNumber(source.travelGroupCount),
    orderCount: toNumber(source.orderCount),
    grossSalesAmountCents: toNumber(
      source.grossSalesAmountCents ?? source.salesAmountCents,
    ),
    salesAmountCents: toNumber(source.salesAmountCents),
    refundAmountCents: toNumber(source.refundAmountCents),
    pendingAfterSalesRefundAmountCents: toNumber(
      source.pendingAfterSalesRefundAmountCents,
    ),
    legacyRefundOrderAmountCents: toNumber(
      source.legacyRefundOrderAmountCents,
    ),
    netSalesAmountCents: toNumber(source.netSalesAmountCents),
    logisticsFeeCents: toNumber(source.logisticsFeeCents),
    pendingInvoiceCount: toNumber(source.pendingInvoiceCount),
    pendingCustomerMarkCount: toNumber(source.pendingCustomerMarkCount),
    pendingTravelGroupMarkCount: toNumber(
      source.pendingTravelGroupMarkCount,
    ),
    pendingAfterSalesConfirmCount: toNumber(
      source.pendingAfterSalesConfirmCount,
    ),
    cashOnDeliveryAmountCents: toNumber(source.cashOnDeliveryAmountCents),
  };
}

function toAiRefundRow(row: unknown) {
  const source = isRecord(row) ? row : {};
  const salesOrder = isRecord(source.salesOrder) ? source.salesOrder : {};
  const travelGroup = isRecord(salesOrder.travelGroup)
    ? salesOrder.travelGroup
    : {};
  return {
    id: nullableString(source.id),
    afterSalesNo: nullableString(source.afterSalesNo),
    salesOrderId: nullableString(source.salesOrderId),
    salesOrderNo: nullableString(salesOrder.orderNo),
    travelGroupId: nullableString(salesOrder.travelGroupId),
    travelGroupNo: nullableString(travelGroup.groupNo),
    issueType: nullableString(source.issueType),
    actionType: nullableString(source.actionType),
    status: nullableString(source.status),
    refundAmountCents: toNumber(source.refundAmountCents),
    financeConfirmed: Boolean(source.financeConfirmed),
    financeConfirmedAt: nullableString(source.financeConfirmedAt),
    createdAt: nullableString(source.createdAt),
  };
}

function summarizeRefundRows(rows: Array<ReturnType<typeof toAiRefundRow>>) {
  const confirmed = rows.filter((row) => row.financeConfirmed);
  const pending = rows.filter((row) => !row.financeConfirmed);
  return {
    refundCount: rows.length,
    confirmedRefundCount: confirmed.length,
    pendingRefundCount: pending.length,
    confirmedRefundAmountCents: sumNumbers(
      confirmed,
      'refundAmountCents',
    ),
    pendingRefundAmountCents: sumNumbers(pending, 'refundAmountCents'),
  };
}

function toAiPendingLogisticsRow(row: unknown) {
  const source = isRecord(row) ? row : {};
  const order = isRecord(source.order) ? source.order : source;
  return {
    id: nullableString(order.id),
    orderNo: nullableString(order.orderNo),
    logisticsNo: nullableString(order.logisticsNo),
    logisticsFeeCents: toNumber(order.logisticsFeeCents),
    reasons: Array.isArray(source.reasons)
      ? source.reasons.map((reason) => String(reason))
      : [],
  };
}

function toAiCustomerSummary(value: unknown) {
  const source = isRecord(value) ? value : {};
  const phone = nullableString(source.phone ?? source.customerPhone);
  return {
    id: nullableString(source.customerId ?? source.id),
    name: nullableString(source.name ?? source.customerName),
    phoneMasked: maskPhone(phone),
    region: {
      province: nullableString(source.province),
      city: nullableString(source.city),
      district: nullableString(source.district),
    },
    financeMark:
      source.financeMark === undefined ? null : Boolean(source.financeMark),
    recentOrderCount: Array.isArray(source.recentOrders)
      ? source.recentOrders.length
      : 0,
    recentOrders: Array.isArray(source.recentOrders)
      ? source.recentOrders.map((order) => toAiOrderSummary(order)).slice(0, 5)
      : [],
  };
}

function mergeAiCustomers(
  customers: Array<ReturnType<typeof toAiCustomerSummary>>,
) {
  const merged = new Map<string, ReturnType<typeof toAiCustomerSummary>>();
  for (const customer of customers) {
    const key =
      customer.id ||
      `${customer.name || ''}:${customer.phoneMasked || ''}` ||
      `customer-${merged.size}`;
    if (!key.trim() || merged.has(key)) {
      continue;
    }
    merged.set(key, customer);
  }
  return [...merged.values()];
}

function toAiOrderSummary(
  row: unknown,
  options: {
    afterSalesOrders?: Array<ReturnType<typeof toAiAfterSalesSummary>>;
  } = {},
) {
  const source = isRecord(row) ? row : {};
  const afterSalesOrders = options.afterSalesOrders || [];
  return {
    id: nullableString(source.id),
    orderNo: nullableString(source.orderNo),
    orderType: nullableString(source.orderType),
    orderDate: nullableString(source.orderDate),
    status: nullableString(source.status),
    customer: toAiCustomerSummary(
      isRecord(source.customer) ? source.customer : source,
    ),
    travelGroup: toAiTravelGroupSummary(source.travelGroup),
    totalAmountCents: toNumber(source.totalAmountCents),
    cashOnDeliveryAmountCents: toNumber(source.cashOnDeliveryAmountCents),
    deliverySummary: nullableString(source.deliverySummary),
    logistics: {
      method: nullableString(source.logisticsMethod),
      no: nullableString(source.logisticsNo),
      feeCents: toNumber(source.logisticsFeeCents),
      packingStatus: nullableString(source.packingStatus),
      packageCount: toNumber(source.packageCount),
      invoiceRequired: Boolean(source.invoiceRequired),
      invoiceIssued: Boolean(source.invoiceIssued),
    },
    products: summarizeOrderItems(source.items),
    afterSalesSummary: summarizeAfterSalesRows(afterSalesOrders),
    financeMark:
      source.financeMark === undefined ? null : Boolean(source.financeMark),
    createdAt: nullableString(source.createdAt),
  };
}

function toAiAfterSalesSummary(row: unknown) {
  const source = isRecord(row) ? row : {};
  const salesOrder = isRecord(source.salesOrder) ? source.salesOrder : {};
  return {
    id: nullableString(source.id),
    afterSalesNo: nullableString(source.afterSalesNo),
    salesOrderId: nullableString(source.salesOrderId),
    salesOrderNo: nullableString(salesOrder.orderNo),
    customer: toAiCustomerSummary(
      isRecord(source.customer)
        ? source.customer
        : isRecord(salesOrder.customer)
          ? salesOrder.customer
          : salesOrder,
    ),
    order: {
      id: nullableString(salesOrder.id),
      orderNo: nullableString(salesOrder.orderNo),
      orderDate: nullableString(salesOrder.orderDate),
      status: nullableString(salesOrder.status),
      totalAmountCents: toNumber(salesOrder.totalAmountCents),
      logisticsNo: nullableString(salesOrder.logisticsNo),
      logisticsFeeCents: toNumber(salesOrder.logisticsFeeCents),
    },
    issueType: nullableString(source.issueType),
    actionType: nullableString(source.actionType),
    status: nullableString(source.status),
    refundAmountCents: toNumber(source.refundAmountCents),
    financeConfirmed: Boolean(source.financeConfirmed),
    financeConfirmedAt: nullableString(source.financeConfirmedAt),
    handledAt: nullableString(source.handledAt),
    completedAt: nullableString(source.completedAt),
    createdAt: nullableString(source.createdAt),
  };
}

function toAiLogisticsSummary(row: unknown) {
  const source = isRecord(row) ? row : {};
  return {
    salesOrderId: nullableString(source.id),
    salesOrderNo: nullableString(source.orderNo),
    orderDate: nullableString(source.orderDate),
    status: nullableString(source.status),
    customer: toAiCustomerSummary(
      isRecord(source.customer) ? source.customer : source,
    ),
    travelGroup: toAiTravelGroupSummary(source.travelGroup),
    deliverySummary: nullableString(source.deliverySummary),
    logisticsMethod: nullableString(source.logisticsMethod),
    logisticsNo: nullableString(source.logisticsNo),
    logisticsFeeCents: toNumber(source.logisticsFeeCents),
    packingStatus: nullableString(source.packingStatus),
    packageCount: toNumber(source.packageCount),
    invoiceRequired: Boolean(source.invoiceRequired),
    invoiceIssued: Boolean(source.invoiceIssued),
  };
}

function toAiTravelGroupSummary(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }
  return {
    id: nullableString(value.id),
    groupNo: nullableString(value.groupNo),
    visitDate: nullableString(value.visitDate),
    travelAgency: nullableString(value.travelAgency),
    tasterId: nullableString(value.tasterId),
    tasterName: nullableString(value.tasterName),
    financeMark:
      value.financeMark === undefined ? null : Boolean(value.financeMark),
  };
}

function summarizeOrderItems(items: unknown) {
  const rows = Array.isArray(items) ? items : [];
  return {
    itemCount: rows.length,
    items: rows.slice(0, 10).map((item) => {
      const source = isRecord(item) ? item : {};
      return {
        productName: nullableString(source.productName),
        quantity: toNumber(source.quantity),
        subtotalCents: toNumber(source.subtotalCents),
        deliveryType: nullableString(source.deliveryType),
      };
    }),
  };
}

function summarizeOrderRows(
  orders: Array<ReturnType<typeof toAiOrderSummary>>,
) {
  return {
    orderCount: orders.length,
    totalAmountCents: sumNumbers(orders, 'totalAmountCents'),
    cashOnDeliveryAmountCents: sumNumbers(
      orders,
      'cashOnDeliveryAmountCents',
    ),
    logisticsFeeCents: orders.reduce(
      (total, order) => total + toNumber(order.logistics?.feeCents),
      0,
    ),
    afterSalesCount: orders.reduce(
      (total, order) =>
        total + toNumber(order.afterSalesSummary?.afterSalesCount),
      0,
    ),
    refundAmountCents: orders.reduce(
      (total, order) =>
        total + toNumber(order.afterSalesSummary?.refundAmountCents),
      0,
    ),
  };
}

function summarizeAfterSalesRows(
  rows: Array<ReturnType<typeof toAiAfterSalesSummary>>,
) {
  const byStatus: Record<string, number> = {};
  for (const row of rows || []) {
    const status = row.status || 'unknown';
    byStatus[status] = (byStatus[status] || 0) + 1;
  }
  return {
    afterSalesCount: rows.length,
    refundAmountCents: sumNumbers(rows, 'refundAmountCents'),
    confirmedRefundAmountCents: sumNumbers(
      rows.filter((row) => row.financeConfirmed),
      'refundAmountCents',
    ),
    pendingRefundAmountCents: sumNumbers(
      rows.filter((row) => !row.financeConfirmed),
      'refundAmountCents',
    ),
    byStatus: Object.entries(byStatus).map(([status, count]) => ({
      status,
      count,
    })),
  };
}

function summarizeLogisticsRows(
  rows: Array<ReturnType<typeof toAiLogisticsSummary>>,
) {
  return {
    orderCount: rows.length,
    logisticsFeeCents: sumNumbers(rows, 'logisticsFeeCents'),
    missingLogisticsNoCount: rows.filter((row) => !row.logisticsNo).length,
    missingLogisticsFeeCount: rows.filter(
      (row) => toNumber(row.logisticsFeeCents) === 0,
    ).length,
    pendingInvoiceCount: rows.filter(
      (row) => row.invoiceRequired && !row.invoiceIssued,
    ).length,
  };
}

function toAiCommissionRecord(record: unknown) {
  const source = isRecord(record) ? record : {};
  return {
    id: nullableString(source.id),
    salesOrderId: nullableString(source.salesOrderId),
    salesOrderNo: nullableString(source.salesOrderNo),
    travelGroupId: nullableString(source.travelGroupId),
    travelGroupNo: nullableString(
      isRecord(source.travelGroup) ? source.travelGroup.groupNo : null,
    ),
    targetType: nullableString(source.targetType),
    targetUser: toAiPublicUser(source.targetUser),
    agency: toAiAgency(source.agency) || {
      id: nullableString(source.agencyId),
      name: nullableString(source.agencyName),
    },
    grossAmountCents: toNumber(source.grossAmountCents),
    confirmedRefundAmountCents: toNumber(
      source.confirmedRefundAmountCents,
    ),
    baseAmountCents: toNumber(source.baseAmountCents),
    deductionAmountCents: toNumber(source.deductionAmountCents),
    amountCents: toNumber(source.amountCents),
    pointsCents: toNumber(source.pointsCents),
    manualInput: Boolean(source.manualInput),
    isConfirmed: Boolean(source.isConfirmed),
    confirmedAt: nullableString(source.confirmedAt),
    calculationVersion: nullableString(source.calculationVersion),
    createdAt: nullableString(source.createdAt),
  };
}

function summarizeCommissionRecords(records: unknown[]) {
  const compactRecords = (records || []).map(toAiCommissionRecord);
  const confirmedRecords = compactRecords.filter((record) => record.isConfirmed);
  const pendingRecords = compactRecords.filter((record) => !record.isConfirmed);
  const byTargetType: Record<string, any> = {};
  for (const record of compactRecords) {
    const targetType = record.targetType || 'unknown';
    const current = byTargetType[targetType] || {
      targetType,
      recordCount: 0,
      amountCents: 0,
      pointsCents: 0,
    };
    current.recordCount += 1;
    current.amountCents += record.amountCents;
    current.pointsCents += record.pointsCents;
    byTargetType[targetType] = current;
  }
  return {
    recordCount: compactRecords.length,
    totalAmountCents: sumNumbers(compactRecords, 'amountCents'),
    confirmedAmountCents: sumNumbers(confirmedRecords, 'amountCents'),
    pendingAmountCents: sumNumbers(pendingRecords, 'amountCents'),
    totalPointsCents: sumNumbers(compactRecords, 'pointsCents'),
    confirmedCount: confirmedRecords.length,
    pendingCount: pendingRecords.length,
    byTargetType: Object.values(byTargetType),
  };
}

function toAiTravelGroupFinanceSummary(summary: unknown) {
  const source = isRecord(summary) ? summary : {};
  const travelGroup = isRecord(source.travelGroup) ? source.travelGroup : {};
  return {
    id: nullableString(source.id),
    travelGroupId: nullableString(source.travelGroupId),
    travelGroup: {
      id: nullableString(travelGroup.id),
      groupNo: nullableString(travelGroup.groupNo),
      visitDate: nullableString(travelGroup.visitDate),
      travelAgency: nullableString(travelGroup.travelAgency),
      guideName: nullableString(travelGroup.guideName),
      tasterId: nullableString(travelGroup.tasterId),
      tasterName: nullableString(travelGroup.tasterName),
      financeMark:
        travelGroup.financeMark === undefined
          ? null
          : Boolean(travelGroup.financeMark),
    },
    totalSalesAmountCents: toNumber(source.totalSalesAmountCents),
    confirmedRefundAmountCents: toNumber(
      source.confirmedRefundAmountCents,
    ),
    effectiveSalesAmountCents: toNumber(source.effectiveSalesAmountCents),
    totalAgencyDeductionCents: toNumber(
      source.totalAgencyDeductionCents,
    ),
    agencyDeductionConfirmed: Boolean(source.agencyDeductionConfirmed),
    totalAgencyNetAmountCents: toNumber(
      source.totalAgencyNetAmountCents,
    ),
    totalDailyRebateCents: toNumber(source.totalDailyRebateCents),
    totalMonthlyRebateCents: toNumber(source.totalMonthlyRebateCents),
    paidRebateCents: toNumber(source.paidRebateCents),
    unpaidRebateCents: toNumber(source.unpaidRebateCents),
    guideInfoSent: Boolean(source.guideInfoSent),
    travelAgencyInfoSent: Boolean(source.travelAgencyInfoSent),
    calculationVersion: nullableString(source.calculationVersion),
    updatedAt: nullableString(source.updatedAt),
  };
}

function summarizeTravelGroupFinanceSummaries(summaries: unknown[]) {
  const compactSummaries = (summaries || []).map(
    toAiTravelGroupFinanceSummary,
  );
  return {
    recordCount: compactSummaries.length,
    totalSalesAmountCents: sumNumbers(
      compactSummaries,
      'totalSalesAmountCents',
    ),
    confirmedRefundAmountCents: sumNumbers(
      compactSummaries,
      'confirmedRefundAmountCents',
    ),
    effectiveSalesAmountCents: sumNumbers(
      compactSummaries,
      'effectiveSalesAmountCents',
    ),
    totalAgencyDeductionCents: sumNumbers(
      compactSummaries,
      'totalAgencyDeductionCents',
    ),
    totalAgencyNetAmountCents: sumNumbers(
      compactSummaries,
      'totalAgencyNetAmountCents',
    ),
    totalDailyRebateCents: sumNumbers(
      compactSummaries,
      'totalDailyRebateCents',
    ),
    totalMonthlyRebateCents: sumNumbers(
      compactSummaries,
      'totalMonthlyRebateCents',
    ),
    paidRebateCents: sumNumbers(compactSummaries, 'paidRebateCents'),
    unpaidRebateCents: sumNumbers(compactSummaries, 'unpaidRebateCents'),
  };
}

function getTravelGroupFinanceSourceCounts(summary: unknown) {
  const source = isRecord(summary) ? summary : {};
  const snapshot = isRecord(source.sourceSnapshot)
    ? source.sourceSnapshot
    : {};
  const agencyRebateRecords = isRecord(snapshot.agencyRebateRecords)
    ? snapshot.agencyRebateRecords
    : {};
  return {
    orderCount: toNumber(snapshot.orderCount),
    dailyRebateRecordCount: toNumber(agencyRebateRecords.dailyCount),
    monthlyRebateRecordCount: toNumber(agencyRebateRecords.monthlyCount),
  };
}

function toAiPublicUser(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }
  return {
    id: nullableString(value.id),
    name: nullableString(value.name),
    role: nullableString(value.role),
  };
}

function toAiAgency(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }
  return {
    id: nullableString(value.id),
    name: nullableString(value.name),
  };
}

function addLimitWarning(
  warnings: string[],
  toolName: AiToolName,
  rowCount: number,
  limit: number,
) {
  if (rowCount >= limit) {
    warnings.push(
      `${toolName} summary reached the AI read limit of ${limit}; narrow the date range for a complete summary.`,
    );
  }
}

function buildDateRangeSummary(
  analyticsRange: unknown,
  inputRange: AiToolInput['range'],
) {
  const sourceRange = isRecord(analyticsRange) ? analyticsRange : {};
  const summary: { dateFrom?: string; dateTo?: string } = {};
  const dateFrom = nullableString(sourceRange.dateFrom) || inputRange?.dateFrom;
  const dateTo = nullableString(sourceRange.dateTo) || inputRange?.dateTo;
  if (dateFrom) {
    summary.dateFrom = dateFrom;
  }
  if (dateTo) {
    summary.dateTo = dateTo;
  }
  return summary;
}

function normalizeToolWarnings(warnings: unknown): string[] {
  if (!Array.isArray(warnings)) {
    return [];
  }
  return warnings
    .map((warning) => {
      if (typeof warning === 'string') {
        return warning.trim();
      }
      if (!isRecord(warning)) {
        return '';
      }
      const code = nullableString(warning.code);
      const message = nullableString(warning.message);
      return [code, message].filter(Boolean).join(': ');
    })
    .filter(Boolean);
}

function collectRankingWarnings(
  rankings: Array<ReturnType<typeof toAiTasterRankingRow>>,
): string[] {
  return [
    ...new Set(rankings.flatMap((ranking) => ranking.warnings || [])),
  ];
}

function extractTasterId(input: AiToolInput): string {
  const filters = isRecord(input?.filters) ? input.filters : {};
  const tasterId = nullableString(filters.tasterId);
  if (!tasterId) {
    throw createHttpError(
      400,
      'AI_TASTER_ID_REQUIRED',
      'tasterId is required for analytics.tasterDetail.',
    );
  }
  return tasterId;
}

function compactIdList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => (isRecord(item) ? nullableString(item.id) : null))
        .filter((item): item is string => Boolean(item))
        .slice(0, 20)
    : [];
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toNumber(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function sumNumbers(items: any[], fieldName: string): number {
  return (items || []).reduce(
    (total, item) => total + toNumber(item?.[fieldName]),
    0,
  );
}

function nullableString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function maskPhone(value: string | null): string | null {
  const text = nullableString(value);
  if (!text) {
    return null;
  }
  const digits = text.replace(/\D/g, '');
  if (digits.length >= 11) {
    return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
  }
  if (digits.length >= 7) {
    return `${digits.slice(0, 3)}***${digits.slice(-2)}`;
  }
  if (digits.length >= 3) {
    return `${digits.slice(0, 2)}***`;
  }
  return '***';
}

function normalizeAiLimit(
  value: unknown,
  defaultValue: number,
  maxValue: number,
): number {
  const text = nullableString(value);
  if (!text) {
    return defaultValue;
  }
  const limit = Number(text);
  if (!Number.isInteger(limit) || limit < 1) {
    throw createHttpError(
      400,
      'AI_INVALID_LIMIT',
      'AI tool limit must be a positive integer.',
    );
  }
  return Math.min(limit, maxValue);
}

function assertAiTasterRankingSortBy(sortBy: string) {
  if (
    AI_TASTER_RANKING_SORT_FIELDS.includes(
      sortBy as (typeof AI_TASTER_RANKING_SORT_FIELDS)[number],
    )
  ) {
    return;
  }
  throw createHttpError(
    400,
    'AI_INVALID_TASTER_RANKING_SORT_BY',
    `sortBy must be one of: ${AI_TASTER_RANKING_SORT_FIELDS.join(', ')}.`,
  );
}

function validateToolDefinition(definition: AiToolDefinition) {
  const rawName = String(definition?.toolName || '');
  assertSafeToolName(rawName);

  if (!AI_TOOL_NAMES.includes(rawName as AiToolName)) {
    throw createHttpError(
      400,
      'AI_TOOL_NOT_WHITELISTED',
      'AI tool is not in the stage 9 read-only whitelist.',
    );
  }

  if (definition.readOnly !== true) {
    throw createHttpError(
      400,
      'AI_TOOL_MUST_BE_READ_ONLY',
      'AI tools must be registered as read-only.',
    );
  }

  if (typeof definition.execute !== 'function') {
    throw createHttpError(
      400,
      'AI_TOOL_EXECUTOR_REQUIRED',
      'AI tool executor is required.',
    );
  }
}

function normalizeToolResult(
  toolName: AiToolName,
  result: AiToolResult,
  decision: AiPolicyDecision,
): AiToolResult {
  return {
    toolName,
    data: result?.data ?? null,
    sourceSummary: {
      rowCount: Number.isInteger(result?.sourceSummary?.rowCount)
        ? result.sourceSummary.rowCount
        : 0,
      ...(result?.sourceSummary?.dateFrom
        ? { dateFrom: result.sourceSummary.dateFrom }
        : {}),
      ...(result?.sourceSummary?.dateTo
        ? { dateTo: result.sourceSummary.dateTo }
        : {}),
      globalMarkedFilterEnabled: Boolean(
        result?.sourceSummary?.globalMarkedFilterEnabled,
      ),
      scopeDescription: decision.scopeDescription,
    },
    warnings: Array.isArray(result?.warnings) ? result.warnings : [],
  };
}

function assertSafeToolName(toolName: string) {
  const compact = toolName.replace(/[\s_.:-]+/g, '');
  const isExplicitDanger = DANGEROUS_TOOL_NAMES.some(
    (name) => name.toLowerCase() === toolName.toLowerCase(),
  );
  if (isExplicitDanger || DANGEROUS_TOOL_PATTERN.test(compact)) {
    throw createHttpError(
      400,
      'AI_TOOL_FORBIDDEN',
      'Dangerous AI tools cannot be registered.',
    );
  }
}

function normalizeToolName(toolName: string): AiToolName {
  return String(toolName || '') as AiToolName;
}

function buildAiRefundReadActor(actor: AiToolInput['actor']) {
  const role = String(actor?.role || '').trim().toLowerCase();
  return {
    id: actor?.userId ?? null,
    role: role === 'boss' ? 'admin' : role,
  };
}

function throwPolicyError(decision: AiPolicyDecision): never {
  const statusCode =
    decision.code === 'AI_UNSAFE_WRITE_REQUEST' ||
    decision.code === 'AI_SQL_REQUEST_DENIED' ||
    decision.code === 'AI_OUT_OF_SCOPE'
      ? 400
      : 403;
  throw createHttpError(
    statusCode,
    decision.code,
    decision.reason || 'AI tool execution is not allowed.',
  );
}
