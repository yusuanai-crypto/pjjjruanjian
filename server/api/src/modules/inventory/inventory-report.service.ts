import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PassThrough } from 'node:stream';

import { createHttpError } from '../../common/errors';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import {
  canReadInventoryCost,
  requireInventoryRead,
} from './inventory-access.policy';
import {
  actorId,
  actorName,
  actorRole,
} from './inventory.prisma.repository';
import { InventoryQueryPrismaRepository } from './inventory-query.prisma.repository';

const FACT_PAGE_SIZE = 500;
const EXPORT_PAGE_SIZE = 500;
const MAX_EXPORT_ROWS = 100_000;
const REPORT_TYPES = new Set([
  'warehouse-balances',
  'period-summary',
  'movements',
  'sales-outbound',
  'purchase-inbound',
  'batch-balances',
  'alerts',
  'stocktake-variances',
  'transfers',
  'inventory-valuation',
]);
const TRACKING_MODES = new Set(['NONE', 'QUANTITY', 'SERIALIZED']);
const MOVEMENT_TYPES = new Set([
  'OPENING_IN',
  'PURCHASE_IN',
  'CUSTOMER_RETURN',
  'RESERVE',
  'RELEASE',
  'SALES_OUT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'TRANSFER_DIFFERENCE',
  'STOCK_GAIN',
  'STOCK_LOSS',
  'OTHER_IN',
  'OTHER_OUT',
  'UNAVAILABLE_IN',
  'UNAVAILABLE_OUT',
  'REVERSAL',
]);
const ALERT_TYPES = new Set([
  'LOW_STOCK',
  'NEGATIVE_AVAILABLE',
  'PENDING_COST',
  'ORDER_SHORTAGE',
  'TRANSFER_OVERDUE',
  'STOCKTAKE_APPROVAL',
]);
const ALERT_STATUSES = new Set(['ACTIVE', 'RESOLVED', 'CANCELLED']);
const STOCKTAKE_STATUSES = new Set([
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'POSTED',
  'REVERSED',
]);
const TRANSFER_STATUSES = new Set([
  'DRAFT',
  'OUTBOUND',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
  'REVERSED',
]);

type ReportColumn = {
  key: string;
  label: string;
  type: 'string' | 'integer' | 'money' | 'boolean' | 'datetime';
  width?: number;
};

@Injectable()
export class InventoryReportService {
  constructor(
    private readonly repository: InventoryQueryPrismaRepository,
    private readonly operationLogsService: OperationLogsNestService,
  ) {}

  async query(actor: any, reportTypeInput: unknown, input: any = {}) {
    return await this.queryInternal(actor, reportTypeInput, input);
  }

  async exportXlsx(
    actor: any,
    reportTypeInput: unknown,
    input: any = {},
    metadata: any = {},
  ) {
    requireInventoryRead(actor);
    const reportType = normalizeReportType(reportTypeInput);
    const first = await this.queryInternal(
      actor,
      reportType,
      { ...input, page: 1, pageSize: EXPORT_PAGE_SIZE },
      EXPORT_PAGE_SIZE,
    );
    if (first.pagination.total > MAX_EXPORT_ROWS) {
      throw createHttpError(
        422,
        'INVENTORY_REPORT_EXPORT_LIMIT_EXCEEDED',
        `Inventory report exports are limited to ${MAX_EXPORT_ROWS} rows.`,
      );
    }
    await this.operationLogsService.appendLog({
      userId: actorId(actor),
      actorNameSnapshot: actorName(actor),
      actorRoleSnapshot: actorRole(actor),
      module: 'inventory',
      action: 'inventory.report.export',
      entityType: 'inventory_report',
      entityId: reportType,
      beforeData: null,
      afterData: {
        reportType,
        format: 'xlsx',
        filters: first.filters,
        rowCount: first.pagination.total,
        columnKeys: first.columns.map(
          (column: ReportColumn) => column.key,
        ),
      },
      requestSummary: {
        reportType,
        filters: first.filters,
      },
      ipAddress: metadata.ipAddress || null,
      requestId: boundedTraceId(metadata.requestId),
    });

    const output = new PassThrough();
    const completion = this.writeWorkbookStream(
      output,
      actor,
      reportType,
      input,
      first,
    );
    completion.catch((error) => output.destroy(error));
    return {
      fileName: `inventory-${reportType}-${fileTimestamp(new Date())}.xlsx`,
      rowCount: first.pagination.total,
      stream: output,
      completion,
    };
  }

  private async queryInternal(
    actor: any,
    reportTypeInput: unknown,
    input: any,
    pageSizeOverride?: number,
  ) {
    requireInventoryRead(actor);
    const reportType = normalizeReportType(reportTypeInput);
    const includeCosts = canReadInventoryCost(actor);
    if (reportType === 'inventory-valuation' && !includeCosts) {
      throw createHttpError(
        403,
        'INVENTORY_COST_REPORT_FORBIDDEN',
        'This inventory valuation report requires inventory cost permission.',
      );
    }
    const filters = parseReportFilters(
      input,
      reportType,
      pageSizeOverride,
    );
    const columns = reportColumns(reportType, includeCosts);

    if (reportType === 'movements') {
      const { rows, total } =
        await this.repository.listReportMovementPage(
          filters,
          filters.page,
          filters.pageSize,
          includeCosts,
        );
      return reportResult(
        reportType,
        filters,
        columns,
        rows.map((row: any) =>
          projectRow(
            movementReportRow(row, includeCosts),
            columns,
          ),
        ),
        total,
      );
    }
    if (reportType === 'alerts') {
      const result = await this.alertReport(
        filters,
        columns,
        includeCosts,
      );
      return reportResult(
        reportType,
        filters,
        columns,
        result.rows,
        result.total,
      );
    }
    if (reportType === 'stocktake-variances') {
      const { rows, total } =
        await this.repository.listReportStocktakes(
          filters,
          filters.page,
          filters.pageSize,
        );
      return reportResult(
        reportType,
        filters,
        columns,
        rows.map((row: any) =>
          projectRow(stocktakeReportRow(row), columns),
        ),
        total,
      );
    }

    const rows = await this.buildAggregateReportRows(
      reportType,
      filters,
      includeCosts,
    );
    const projected = rows.map((row) => projectRow(row, columns));
    const offset = (filters.page - 1) * filters.pageSize;
    return reportResult(
      reportType,
      filters,
      columns,
      projected.slice(offset, offset + filters.pageSize),
      projected.length,
    );
  }

  private async buildAggregateReportRows(
    reportType: string,
    filters: any,
    includeCosts: boolean,
  ) {
    if (reportType === 'transfers') {
      return await this.transferReport(filters);
    }

    const aggregateFilters = {
      ...filters,
      dateFrom:
        [
          'warehouse-balances',
          'period-summary',
          'batch-balances',
          'inventory-valuation',
        ].includes(reportType)
          ? null
          : filters.dateFrom,
      dateTo:
        reportType === 'warehouse-balances' ||
        reportType === 'batch-balances' ||
        reportType === 'inventory-valuation'
          ? filters.asOf || filters.dateTo
          : filters.dateTo,
    };
    const stockSnapshots =
      await this.repository.listReportStocks(filters);
    const pairs = await this.loadMovementAggregate(
      aggregateFilters,
      stockSnapshots,
      filters,
      includeCosts,
    );

    switch (reportType) {
      case 'warehouse-balances':
        return balanceRows(pairs, includeCosts, filters);
      case 'period-summary':
        return periodRows(pairs, filters);
      case 'sales-outbound':
        return categorySummaryRows(pairs, 'sales', includeCosts);
      case 'purchase-inbound':
        return categorySummaryRows(
          pairs,
          'purchase',
          includeCosts,
        );
      case 'batch-balances':
        return await this.batchRows(
          filters,
          pairs,
          includeCosts,
        );
      case 'inventory-valuation':
        return valuationRows(pairs, filters);
      default:
        return [];
    }
  }

  private async loadMovementAggregate(
    factFilters: any,
    stockSnapshots: any[],
    aggregationFilters: any,
    includeCosts: boolean,
  ) {
    const pairs = createMovementAggregate(stockSnapshots);
    let cursorId: string | null = null;
    for (;;) {
      const rows =
        await this.repository.listReportMovementFacts(
          factFilters,
          cursorId,
          FACT_PAGE_SIZE,
          includeCosts,
        );
      applyMovementFacts(
        pairs,
        rows,
        aggregationFilters,
        includeCosts,
      );
      if (rows.length < FACT_PAGE_SIZE) {
        break;
      }
      cursorId = rows[rows.length - 1].id;
    }
    return pairs;
  }

  private async batchRows(
    filters: any,
    pairs: Map<string, any>,
    includeCosts: boolean,
  ) {
    const batches: any[] = [];
    let cursorId: string | null = null;
    for (;;) {
      const page = await this.repository.listReportBatches(
        filters,
        cursorId,
        FACT_PAGE_SIZE,
        includeCosts,
      );
      batches.push(...page);
      if (page.length < FACT_PAGE_SIZE) {
        break;
      }
      cursorId = page[page.length - 1].id;
    }
    return batches
      .map((batch) => {
        const pair = pairs.get(pairKey(batch.warehouseId, batch.productId));
        const movementRemainingQty = Number(
          pair?.batchBalances.get(batch.id) || 0,
        );
        const currentSnapshot = !filters.asOf && !filters.dateTo;
        const snapshotRemainingQty = Number(batch.remainingQty || 0);
        const snapshotConsistent = currentSnapshot
          ? movementRemainingQty === snapshotRemainingQty
          : null;
        const result: any = {
          warehouseCode: batch.warehouse?.code ?? '',
          warehouseName: batch.warehouse?.name ?? '',
          productName: batch.product?.name ?? '',
          trackingMode: lower(batch.product?.inventoryTrackingMode),
          supplierName: batch.supplierName ?? '',
          purchaseOrderNo: batch.purchaseOrderNo ?? '',
          productionBatch: batch.productionBatch ?? '',
          productionDate: toIso(batch.productionDate, true),
          receivedQty: Number(batch.receivedQty || 0),
          movementRemainingQty,
          snapshotRemainingQty,
          unavailableQty: Number(batch.unavailableQty || 0),
          snapshotConsistent,
          warning: snapshotConsistent === false
            ? '批次剩余快照与有效流水不一致，请执行重建校验。'
            : currentSnapshot
              ? ''
              : '历史时点仅按有效流水重建，当前批次快照不参与一致性判断。',
        };
        if (includeCosts) {
          const complete =
            upper(batch.costStatus) === 'COMPLETE' &&
            nonNegativeCost(batch.purchaseUnitCostCents) !== null;
          const positiveQty = Math.max(0, movementRemainingQty);
          const coveredQty = complete ? positiveQty : 0;
          const uncoveredQty = positiveQty - coveredQty;
          result.purchaseUnitCostCents = complete
            ? Number(batch.purchaseUnitCostCents)
            : null;
          result.coveredQty = coveredQty;
          result.uncoveredQty = uncoveredQty;
          result.coverageStatus = coverageStatus(
            positiveQty,
            coveredQty,
          );
          result.inventoryAmountCents = complete
            ? safeProduct(coveredQty, Number(batch.purchaseUnitCostCents))
            : null;
          if (uncoveredQty > 0) {
            result.warning = joinWarning(
              result.warning,
              `成本覆盖不完整：${uncoveredQty} 瓶没有已完成的批次进货成本，未伪造金额。`,
            );
          }
        }
        return result;
      })
      .sort(compareReportRows);
  }

  private async alertReport(
    filters: any,
    columns: ReportColumn[],
    includeCosts: boolean,
  ) {
    const [{ rows, total }, configs, stocks] = await Promise.all([
        this.repository.listReportAlertFacts(
          filters,
          filters.page,
          filters.pageSize,
        ),
        this.repository.listReportAlertConfigs(filters),
        this.repository.listReportStocks(filters),
      ]);
    const pairs = await this.loadMovementAggregate(
      {
        ...filters,
        dateFrom: null,
        dateTo: null,
        asOf: null,
        movementType: null,
      },
      stocks,
      filters,
      false,
    );
    const configMap = new Map(
      configs.map((config: any) => [
        pairKey(config.warehouseId, config.productId),
        config,
      ]),
    );
    return {
      total,
      rows: rows.map((row: any) => {
        const pair = pairs.get(pairKey(row.warehouseId, row.productId));
        const config: any = configMap.get(
          pairKey(row.warehouseId, row.productId),
        );
        const availableQty = pair
          ? pair.onHandQty - pair.reservedQty - pair.unavailableQty
          : 0;
        return projectRow(
          {
            alertType: lower(row.type),
            status: lower(row.status),
            warehouseCode: row.warehouse?.code ?? '',
            warehouseName: row.warehouse?.name ?? '',
            productName: row.product?.name ?? '',
            trackingMode: lower(row.product?.inventoryTrackingMode),
            availableQty,
            shortageQty: Math.max(0, -availableQty),
            minimumAvailableQty: config?.enabled
              ? Number(config.minimumAvailableQty || 0)
              : null,
            firstDetectedAt: toIso(row.firstDetectedAt),
            lastDetectedAt: toIso(row.lastDetectedAt),
            resolvedAt: toIso(row.resolvedAt),
          },
          columns,
        );
      }),
    };
  }

  private async transferReport(filters: any) {
    const transfers: any[] = [];
    let cursorId: string | null = null;
    for (;;) {
      const page = await this.repository.listReportTransfers(
        filters,
        cursorId,
        FACT_PAGE_SIZE,
      );
      transfers.push(...page);
      if (page.length < FACT_PAGE_SIZE) {
        break;
      }
      cursorId = page[page.length - 1].id;
    }
    const pairs = await this.loadMovementAggregate(
      {
        ...filters,
        dateFrom: null,
        dateTo: null,
        asOf: null,
        movementType: null,
      },
      [],
      filters,
      false,
    );
    const companyByProduct = new Map<string, number>();
    for (const pair of pairs.values()) {
      companyByProduct.set(
        pair.productId,
        safeAdd(
          companyByProduct.get(pair.productId) || 0,
          safeAdd(pair.onHandQty, pair.inTransitQty),
        ),
      );
    }
    const rows: any[] = [];
    for (const transfer of transfers) {
      const receiptFacts = transferReceiptFacts(transfer.receipts || []);
      for (const line of transfer.lines || []) {
        const received = receiptFacts.get(line.id) || {
          receivedQty: 0,
          unavailableQty: 0,
          differenceQty: 0,
        };
        const outboundQty = Number(line.outboundQty || 0);
        const remainingInTransitQty = Math.max(
          0,
          outboundQty -
            received.receivedQty -
            received.differenceQty,
        );
        rows.push({
          transferNo: transfer.transferNo,
          status: lower(transfer.status),
          fromWarehouseCode: transfer.fromWarehouse?.code ?? '',
          fromWarehouseName: transfer.fromWarehouse?.name ?? '',
          toWarehouseCode: transfer.toWarehouse?.code ?? '',
          toWarehouseName: transfer.toWarehouse?.name ?? '',
          productName: line.product?.name ?? '',
          trackingMode: lower(line.product?.inventoryTrackingMode),
          plannedQty: Number(line.plannedQty || 0),
          outboundQty,
          receivedQty: received.receivedQty,
          unavailableReceivedQty: received.unavailableQty,
          differenceQty: received.differenceQty,
          remainingInTransitQty,
          companyTotalQty: companyByProduct.get(line.productId) || 0,
          outboundAt: toIso(transfer.outboundAt),
          createdAt: toIso(transfer.createdAt),
          warning:
            remainingInTransitQty > 0
              ? `仍有 ${remainingInTransitQty} 瓶调拨在途。`
              : '',
        });
      }
    }
    return rows.sort(compareReportRows);
  }

  private async writeWorkbookStream(
    output: PassThrough,
    actor: any,
    reportType: string,
    input: any,
    first: any,
  ) {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: output,
      useStyles: true,
      useSharedStrings: true,
    });
    const worksheet = workbook.addWorksheet('库存报表', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    worksheet.columns = first.columns.map((column: ReportColumn) => ({
      header: column.label,
      key: column.key,
      width: column.width || 16,
    }));
    const header = worksheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E78' },
    };
    header.commit();
    let exported = 0;
    let page = 1;
    let current = first;
    while (exported < first.pagination.total) {
      for (const row of current.rows) {
        const safe: any = {};
        for (const column of first.columns as ReportColumn[]) {
          safe[column.key] = excelCellValue(row[column.key]);
        }
        worksheet.addRow(safe).commit();
        exported += 1;
      }
      page += 1;
      if (exported >= first.pagination.total) {
        break;
      }
      current = await this.queryInternal(
        actor,
        reportType,
        { ...input, page, pageSize: EXPORT_PAGE_SIZE },
        EXPORT_PAGE_SIZE,
      );
      assertSameColumns(first.columns, current.columns);
      if (current.rows.length === 0) {
        throw createHttpError(
          409,
          'INVENTORY_REPORT_EXPORT_DATA_CHANGED',
          'Inventory report data changed while the export was running.',
        );
      }
    }
    worksheet.commit();
    await workbook.commit();
  }
}

function createMovementAggregate(stockSnapshots: any[]) {
  const pairs = new Map<string, any>();
  for (const stock of stockSnapshots) {
    const pair = getPair(pairs, stock);
    pair.snapshot = stock;
  }
  return pairs;
}

function applyMovementFacts(
  pairs: Map<string, any>,
  facts: any[],
  filters: any,
  includeCosts: boolean,
) {
  for (const fact of facts) {
    const pair = getPair(pairs, fact);
    const onHandDelta = integer(fact.onHandDelta);
    const reservedDelta = integer(fact.reservedDelta);
    const unavailableDelta = integer(fact.unavailableDelta);
    const inTransitDelta = integer(fact.inTransitDelta);
    pair.onHandQty = safeAdd(pair.onHandQty, onHandDelta);
    pair.reservedQty = safeAdd(pair.reservedQty, reservedDelta);
    pair.unavailableQty = safeAdd(
      pair.unavailableQty,
      unavailableDelta,
    );
    pair.inTransitQty = safeAdd(pair.inTransitQty, inTransitDelta);

    const businessAt = new Date(fact.businessAt).getTime();
    if (filters.dateFrom && businessAt < filters.dateFrom.getTime()) {
      pair.openingOnHandQty = safeAdd(
        pair.openingOnHandQty,
        onHandDelta,
      );
      pair.openingInTransitQty = safeAdd(
        pair.openingInTransitQty,
        inTransitDelta,
      );
    } else if (
      (!filters.dateFrom ||
        businessAt >= filters.dateFrom.getTime()) &&
      (!filters.dateTo || businessAt <= filters.dateTo.getTime())
    ) {
      pair.periodOnHandDelta = safeAdd(
        pair.periodOnHandDelta,
        onHandDelta,
      );
      pair.periodInTransitDelta = safeAdd(
        pair.periodInTransitDelta,
        inTransitDelta,
      );
      pair.inboundQty = safeAdd(
        pair.inboundQty,
        Math.max(0, onHandDelta),
      );
      pair.outboundQty = safeAdd(
        pair.outboundQty,
        Math.max(0, -onHandDelta),
      );
      pair.transferIntoTransitQty = safeAdd(
        pair.transferIntoTransitQty,
        Math.max(0, inTransitDelta),
      );
      pair.transferOutOfTransitQty = safeAdd(
        pair.transferOutOfTransitQty,
        Math.max(0, -inTransitDelta),
      );
    }

    if (fact.batchId) {
      pair.batchBalances.set(
        fact.batchId,
        safeAdd(
          pair.batchBalances.get(fact.batchId) || 0,
          onHandDelta,
        ),
      );
    }
    if (fact.serializedUnitId) {
      pair.unitBalances.set(
        fact.serializedUnitId,
        safeAdd(
          pair.unitBalances.get(fact.serializedUnitId) || 0,
          onHandDelta,
        ),
      );
    }

    if (includeCosts) {
      const unitCost = movementUnitCost(fact);
      if (fact.batchId) {
        pair.batchCosts.set(fact.batchId, unitCost);
      }
      if (fact.serializedUnitId) {
        pair.unitCosts.set(fact.serializedUnitId, unitCost);
      }
      if (inTransitDelta !== 0) {
        const lotKey = fact.batchId
          ? `batch:${fact.batchId}`
          : fact.serializedUnitId
            ? `unit:${fact.serializedUnitId}`
            : `cost:${unitCost ?? 'uncovered'}`;
        const lot = pair.transitLots.get(lotKey) || {
          qty: 0,
          unitCost,
        };
        lot.qty = safeAdd(lot.qty, inTransitDelta);
        if (lot.unitCost === null && unitCost !== null) {
          lot.unitCost = unitCost;
        }
        pair.transitLots.set(lotKey, lot);
      }
    }

    const effectiveType = upper(
      fact.movementType === 'REVERSAL'
        ? fact.reversalOf?.movementType
        : fact.movementType,
    );
    if (effectiveType === 'SALES_OUT') {
      accumulateCategory(
        pair.sales,
        -onHandDelta,
        includeCosts ? fact : null,
      );
    }
    if (effectiveType === 'PURCHASE_IN') {
      accumulateCategory(
        pair.purchase,
        onHandDelta,
        includeCosts ? fact : null,
      );
    }
  }
}

function getPair(pairs: Map<string, any>, row: any) {
  const key = pairKey(row.warehouseId, row.productId);
  let pair = pairs.get(key);
  if (!pair) {
    pair = {
      key,
      warehouseId: row.warehouseId,
      productId: row.productId,
      warehouseCode: row.warehouse?.code ?? '',
      warehouseName: row.warehouse?.name ?? '',
      productName: row.product?.name ?? row.productNameSnapshot ?? '',
      unit: row.product?.unit ?? row.unitSnapshot ?? '瓶',
      trackingMode: lower(row.product?.inventoryTrackingMode),
      onHandQty: 0,
      reservedQty: 0,
      unavailableQty: 0,
      inTransitQty: 0,
      openingOnHandQty: 0,
      openingInTransitQty: 0,
      periodOnHandDelta: 0,
      periodInTransitDelta: 0,
      inboundQty: 0,
      outboundQty: 0,
      transferIntoTransitQty: 0,
      transferOutOfTransitQty: 0,
      batchBalances: new Map<string, number>(),
      unitBalances: new Map<string, number>(),
      batchCosts: new Map<string, number | null>(),
      unitCosts: new Map<string, number | null>(),
      transitLots: new Map<string, any>(),
      sales: { quantity: 0, coveredQty: 0, amountCents: 0 },
      purchase: { quantity: 0, coveredQty: 0, amountCents: 0 },
      snapshot: null,
    };
    pairs.set(key, pair);
  }
  return pair;
}

function balanceRows(
  pairs: Map<string, any>,
  includeCosts: boolean,
  filters: any,
) {
  const rows: any[] = [];
  for (const pair of pairs.values()) {
    const availableQty =
      pair.onHandQty - pair.reservedQty - pair.unavailableQty;
    const historical = Boolean(filters.asOf || filters.dateTo);
    const snapshotConsistent = historical
      ? null
      : stockSnapshotConsistent(pair);
    const valuation = includeCosts ? valuePair(pair) : null;
    const result: any = {
      _productId: pair.productId,
      scope: 'warehouse',
      warehouseCode: pair.warehouseCode,
      warehouseName: pair.warehouseName,
      productName: pair.productName,
      trackingMode: pair.trackingMode,
      onHandQty: pair.onHandQty,
      reservedQty: pair.reservedQty,
      unavailableQty: pair.unavailableQty,
      inTransitQty: pair.inTransitQty,
      availableQty,
      shortageQty: Math.max(0, -availableQty),
      companyTotalQty: safeAdd(pair.onHandQty, pair.inTransitQty),
      snapshotConsistent,
      warning: historical
        ? joinWarning(
            quantityWarning(pair, true),
            '历史时点按有效流水重建，当前余额快照不参与一致性判断。',
          )
        : quantityWarning(pair, snapshotConsistent),
    };
    if (valuation) {
      Object.assign(result, valuation);
      result.warning = joinWarning(result.warning, valuation.warning);
    }
    rows.push(result);
  }
  const companyRows = companyBalanceRows(rows, includeCosts);
  const companyTotals = new Map(
    companyRows.map((row) => [row._productId, row.companyTotalQty]),
  );
  for (const row of rows) {
    row.companyTotalQty = companyTotals.get(row._productId) || 0;
  }
  return [...rows, ...companyRows].sort(compareReportRows);
}

function companyBalanceRows(rows: any[], includeCosts: boolean) {
  const groups = new Map<string, any>();
  for (const row of rows) {
    let group = groups.get(row._productId);
    if (!group) {
      group = {
        _productId: row._productId,
        scope: 'company',
        warehouseCode: '',
        warehouseName: '全公司',
        productName: row.productName,
        trackingMode: row.trackingMode,
        onHandQty: 0,
        reservedQty: 0,
        unavailableQty: 0,
        inTransitQty: 0,
        availableQty: 0,
        shortageQty: 0,
        companyTotalQty: 0,
        snapshotConsistent: true,
        warning: '',
        coveredQty: 0,
        uncoveredQty: 0,
        inventoryAmountCents: 0,
      };
      groups.set(row._productId, group);
    }
    for (const key of [
      'onHandQty',
      'reservedQty',
      'unavailableQty',
      'inTransitQty',
      'availableQty',
      'companyTotalQty',
    ]) {
      group[key] = safeAdd(group[key], row[key]);
    }
    group.shortageQty = Math.max(0, -group.availableQty);
    group.snapshotConsistent =
      row.snapshotConsistent === null ||
      group.snapshotConsistent === null
        ? null
        : group.snapshotConsistent !== false &&
          row.snapshotConsistent !== false;
    group.warning = joinWarning(group.warning, row.warning);
    if (includeCosts) {
      group.coveredQty = safeAdd(
        group.coveredQty,
        row.coveredQty || 0,
      );
      group.uncoveredQty = safeAdd(
        group.uncoveredQty,
        row.uncoveredQty || 0,
      );
      group.inventoryAmountCents = safeAdd(
        group.inventoryAmountCents,
        row.inventoryAmountCents || 0,
      );
    }
  }
  for (const group of groups.values()) {
    if (includeCosts) {
      group.coverageStatus = coverageStatus(
        Math.max(0, group.companyTotalQty),
        group.coveredQty,
      );
      if (
        group.coveredQty === 0 &&
        group.companyTotalQty !== 0
      ) {
        group.inventoryAmountCents = null;
      }
    }
  }
  return [...groups.values()];
}

function periodRows(pairs: Map<string, any>, filters: any) {
  const rows: any[] = [];
  for (const pair of pairs.values()) {
    const closingOnHandQty = safeAdd(
      pair.openingOnHandQty,
      pair.periodOnHandDelta,
    );
    const closingInTransitQty = safeAdd(
      pair.openingInTransitQty,
      pair.periodInTransitDelta,
    );
    rows.push({
      _productId: pair.productId,
      scope: 'warehouse',
      warehouseCode: pair.warehouseCode,
      warehouseName: pair.warehouseName,
      productName: pair.productName,
      trackingMode: pair.trackingMode,
      periodFrom: filters.dateFromText,
      periodTo: filters.dateToText,
      openingOnHandQty: pair.openingOnHandQty,
      inboundQty: pair.inboundQty,
      outboundQty: pair.outboundQty,
      openingInTransitQty: pair.openingInTransitQty,
      transferIntoTransitQty: pair.transferIntoTransitQty,
      transferOutOfTransitQty: pair.transferOutOfTransitQty,
      closingOnHandQty,
      closingInTransitQty,
      companyTotalQty: safeAdd(closingOnHandQty, closingInTransitQty),
      warning:
        closingOnHandQty < 0
          ? '期末账面库存为负，请仓库处理缺货。'
          : '',
    });
  }
  const company = new Map<string, any>();
  for (const row of rows) {
    let group = company.get(row._productId);
    if (!group) {
      group = {
        ...row,
        scope: 'company',
        warehouseCode: '',
        warehouseName: '全公司',
        openingOnHandQty: 0,
        inboundQty: 0,
        outboundQty: 0,
        openingInTransitQty: 0,
        transferIntoTransitQty: 0,
        transferOutOfTransitQty: 0,
        closingOnHandQty: 0,
        closingInTransitQty: 0,
        companyTotalQty: 0,
        warning: '',
      };
      company.set(row._productId, group);
    }
    for (const key of [
      'openingOnHandQty',
      'inboundQty',
      'outboundQty',
      'openingInTransitQty',
      'transferIntoTransitQty',
      'transferOutOfTransitQty',
      'closingOnHandQty',
      'closingInTransitQty',
      'companyTotalQty',
    ]) {
      group[key] = safeAdd(group[key], row[key]);
    }
    group.warning = joinWarning(group.warning, row.warning);
  }
  const companyRows = [...company.values()];
  const companyTotals = new Map(
    companyRows.map((row) => [row._productId, row.companyTotalQty]),
  );
  for (const row of rows) {
    row.companyTotalQty = companyTotals.get(row._productId) || 0;
  }
  return [...rows, ...companyRows].sort(compareReportRows);
}

function categorySummaryRows(
  pairs: Map<string, any>,
  category: 'sales' | 'purchase',
  includeCosts: boolean,
) {
  const rows: any[] = [];
  for (const pair of pairs.values()) {
    const summary = pair[category];
    if (summary.quantity === 0) {
      continue;
    }
    const quantity = Math.max(0, summary.quantity);
    const coveredQty = Math.max(
      0,
      Math.min(quantity, summary.coveredQty),
    );
    const uncoveredQty = Math.max(0, quantity - coveredQty);
    const result: any = {
      warehouseCode: pair.warehouseCode,
      warehouseName: pair.warehouseName,
      productName: pair.productName,
      trackingMode: pair.trackingMode,
      quantity,
      warning: '',
    };
    if (includeCosts) {
      result.coverageStatus = coverageStatus(quantity, coveredQty);
      result.coveredQty = coveredQty;
      result.uncoveredQty = uncoveredQty;
      result.inventoryAmountCents =
        coveredQty === 0 ? null : Math.max(0, summary.amountCents);
      result.warning =
        uncoveredQty > 0
          ? `成本覆盖不完整：${uncoveredQty} 瓶没有有效批次或逐瓶成本，未伪造金额。`
          : '';
    }
    rows.push(result);
  }
  return rows.sort(compareReportRows);
}

function valuationRows(pairs: Map<string, any>, filters: any) {
  const rows = [...pairs.values()].map((pair) => {
      const valuation = valuePair(pair);
      return {
        _productId: pair.productId,
        scope: 'warehouse',
        warehouseCode: pair.warehouseCode,
        warehouseName: pair.warehouseName,
        productName: pair.productName,
        trackingMode: pair.trackingMode,
        onHandQty: pair.onHandQty,
        inTransitQty: pair.inTransitQty,
        companyInventoryQty: safeAdd(
          pair.onHandQty,
          pair.inTransitQty,
        ),
        coverageStatus: valuation.coverageStatus,
        coveredQty: valuation.coveredQty,
        uncoveredQty: valuation.uncoveredQty,
        inventoryAmountCents: valuation.inventoryAmountCents,
        warning: joinWarning(
          filters.asOf || filters.dateTo
            ? joinWarning(
                quantityWarning(pair, true),
                '历史时点按有效流水重建，当前余额快照不参与一致性判断。',
              )
            : quantityWarning(pair, stockSnapshotConsistent(pair)),
          valuation.warning,
        ),
      };
    });
  const company = new Map<string, any>();
  for (const row of rows) {
    let group = company.get(row._productId);
    if (!group) {
      group = {
        _productId: row._productId,
        scope: 'company',
        warehouseCode: '',
        warehouseName: '全公司',
        productName: row.productName,
        trackingMode: row.trackingMode,
        onHandQty: 0,
        inTransitQty: 0,
        companyInventoryQty: 0,
        coverageStatus: 'not_applicable',
        coveredQty: 0,
        uncoveredQty: 0,
        inventoryAmountCents: 0,
        warning: '',
      };
      company.set(row._productId, group);
    }
    for (const key of [
      'onHandQty',
      'inTransitQty',
      'companyInventoryQty',
      'coveredQty',
      'uncoveredQty',
    ]) {
      group[key] = safeAdd(group[key], row[key] || 0);
    }
    group.inventoryAmountCents = safeAdd(
      group.inventoryAmountCents,
      row.inventoryAmountCents || 0,
    );
    group.warning = joinWarning(group.warning, row.warning);
  }
  for (const group of company.values()) {
    group.coverageStatus =
      group.companyInventoryQty < 0
        ? 'none'
        : coverageStatus(
            Math.max(0, group.companyInventoryQty),
            group.coveredQty,
          );
    if (group.coveredQty === 0 && group.companyInventoryQty > 0) {
      group.inventoryAmountCents = null;
    }
  }
  return [...rows, ...company.values()].sort(compareReportRows);
}

function valuePair(pair: any) {
  const companyInventoryQty = safeAdd(
    pair.onHandQty,
    pair.inTransitQty,
  );
  const positiveQty = Math.max(0, companyInventoryQty);
  const lots: Array<{ qty: number; unitCost: number }> = [];
  if (pair.trackingMode === 'quantity') {
    for (const [id, quantity] of pair.batchBalances) {
      const unitCost = pair.batchCosts.get(id);
      if (quantity > 0 && unitCost !== null && unitCost !== undefined) {
        lots.push({ qty: quantity, unitCost });
      }
    }
  } else if (pair.trackingMode === 'serialized') {
    for (const [id, quantity] of pair.unitBalances) {
      const unitCost = pair.unitCosts.get(id);
      if (quantity > 0 && unitCost !== null && unitCost !== undefined) {
        lots.push({ qty: quantity, unitCost });
      }
    }
  }
  for (const lot of pair.transitLots.values()) {
    if (
      lot.qty > 0 &&
      lot.unitCost !== null &&
      lot.unitCost !== undefined
    ) {
      lots.push({ qty: lot.qty, unitCost: lot.unitCost });
    }
  }
  let remaining = positiveQty;
  let coveredQty = 0;
  let inventoryAmountCents = 0;
  for (const lot of lots) {
    if (remaining <= 0) {
      break;
    }
    const allocated = Math.min(remaining, lot.qty);
    coveredQty = safeAdd(coveredQty, allocated);
    inventoryAmountCents = safeAdd(
      inventoryAmountCents,
      safeProduct(allocated, lot.unitCost),
    );
    remaining -= allocated;
  }
  const uncoveredQty =
    companyInventoryQty < 0
      ? Math.abs(companyInventoryQty)
      : Math.max(0, positiveQty - coveredQty);
  let warning = '';
  if (companyInventoryQty < 0) {
    warning =
      `库存为负 ${Math.abs(companyInventoryQty)} 瓶，无法形成完整库存金额；未使用 ProductActualCost 补造成本。`;
  } else if (uncoveredQty > 0) {
    warning =
      `成本覆盖不完整：${uncoveredQty} 瓶属于待补成本、无批次或无逐瓶成本，未伪造金额。`;
  }
  return {
    coverageStatus:
      companyInventoryQty < 0
        ? 'none'
        : coverageStatus(positiveQty, coveredQty),
    coveredQty,
    uncoveredQty,
    inventoryAmountCents:
      companyInventoryQty < 0 ||
      (coveredQty === 0 && positiveQty > 0)
        ? null
        : inventoryAmountCents,
    warning,
  };
}

function movementReportRow(row: any, includeCosts: boolean) {
  const effectiveType = lower(
    row.movementType === 'REVERSAL'
      ? row.reversalOf?.movementType
      : row.movementType,
  );
  const result: any = {
    businessAt: toIso(row.businessAt),
    documentNo: row.documentLine?.document?.documentNo ?? '',
    warehouseCode: row.warehouse?.code ?? '',
    warehouseName: row.warehouse?.name ?? '',
    productName: row.product?.name ?? row.productNameSnapshot ?? '',
    trackingMode: lower(row.product?.inventoryTrackingMode),
    movementType: lower(row.movementType),
    effectiveMovementType: effectiveType,
    onHandDelta: integer(row.onHandDelta),
    reservedDelta: integer(row.reservedDelta),
    unavailableDelta: integer(row.unavailableDelta),
    inTransitDelta: integer(row.inTransitDelta),
    purchaseOrderNo: row.batch?.purchaseOrderNo ?? '',
    productionBatch: row.batch?.productionBatch ?? '',
    operatorName: row.operatorNameSnapshot ?? '',
    reason: row.reason ?? '',
    warning: '',
  };
  if (includeCosts) {
    const quantity = Math.abs(integer(row.onHandDelta));
    const unitCost = movementUnitCost(row);
    result.purchaseUnitCostCents = unitCost;
    result.coveredQty = unitCost === null ? 0 : quantity;
    result.uncoveredQty = unitCost === null ? quantity : 0;
    result.coverageStatus = coverageStatus(
      quantity,
      result.coveredQty,
    );
    result.inventoryAmountCents =
      unitCost === null || quantity === 0
        ? null
        : safeProduct(quantity, unitCost);
    if (quantity > 0 && unitCost === null) {
      result.warning =
        '该流水没有有效批次或逐瓶成本覆盖，未伪造金额。';
    }
  }
  return result;
}

function stocktakeReportRow(row: any) {
  return {
    stocktakeNo: row.stocktakeNo,
    status: lower(row.status),
    warehouseCode: row.warehouse?.code ?? '',
    warehouseName: row.warehouse?.name ?? '',
    productName: row.product?.name ?? '',
    trackingMode: lower(row.trackingModeSnapshot),
    snapshotOnHandQty: nullableInteger(row.line?.snapshotOnHandQty),
    countedOnHandQty: nullableInteger(row.line?.countedOnHandQty),
    onHandDifferenceQty: nullableInteger(
      row.line?.onHandDifferenceQty,
    ),
    snapshotUnavailableQty: nullableInteger(
      row.line?.snapshotUnavailableQty,
    ),
    countedUnavailableQty: nullableInteger(
      row.line?.countedUnavailableQty,
    ),
    unavailableDifferenceQty: nullableInteger(
      row.line?.unavailableDifferenceQty,
    ),
    reason:
      row.reversalReason ||
      row.rejectionReason ||
      row.reason ||
      '',
    submittedAt: toIso(row.submittedAt),
    approvedAt: toIso(row.approvedAt),
    postedAt: toIso(row.postedAt),
    createdAt: toIso(row.createdAt),
  };
}

function reportColumns(
  reportType: string,
  includeCosts: boolean,
): ReportColumn[] {
  const base: Record<string, ReportColumn[]> = {
    'warehouse-balances': [
      column('scope', '范围'),
      column('warehouseCode', '仓库编号'),
      column('warehouseName', '仓库'),
      column('productName', '商品'),
      column('trackingMode', '库存模式'),
      integerColumn('onHandQty', '账面现存'),
      integerColumn('reservedQty', '已占用'),
      integerColumn('unavailableQty', '不可售'),
      integerColumn('inTransitQty', '调拨在途'),
      integerColumn('availableQty', '实际可售'),
      integerColumn('shortageQty', '短缺'),
      integerColumn('companyTotalQty', '公司总量'),
      booleanColumn('snapshotConsistent', '快照一致'),
      column('warning', '提示', 42),
    ],
    'period-summary': [
      column('scope', '范围'),
      column('warehouseCode', '仓库编号'),
      column('warehouseName', '仓库'),
      column('productName', '商品'),
      column('trackingMode', '库存模式'),
      column('periodFrom', '期间开始'),
      column('periodTo', '期间结束'),
      integerColumn('openingOnHandQty', '期初现存'),
      integerColumn('inboundQty', '期间入库'),
      integerColumn('outboundQty', '期间出库'),
      integerColumn('openingInTransitQty', '期初在途'),
      integerColumn('transferIntoTransitQty', '期间进入在途'),
      integerColumn('transferOutOfTransitQty', '期间离开在途'),
      integerColumn('closingOnHandQty', '期末现存'),
      integerColumn('closingInTransitQty', '期末在途'),
      integerColumn('companyTotalQty', '公司总量'),
      column('warning', '提示', 42),
    ],
    movements: [
      datetimeColumn('businessAt', '业务时间'),
      column('documentNo', '库存单号'),
      column('warehouseCode', '仓库编号'),
      column('warehouseName', '仓库'),
      column('productName', '商品'),
      column('trackingMode', '库存模式'),
      column('movementType', '流水类型'),
      column('effectiveMovementType', '归属业务类型'),
      integerColumn('onHandDelta', '现存变化'),
      integerColumn('reservedDelta', '占用变化'),
      integerColumn('unavailableDelta', '不可售变化'),
      integerColumn('inTransitDelta', '在途变化'),
      column('purchaseOrderNo', '采购单号'),
      column('productionBatch', '生产批次'),
      column('operatorName', '操作人'),
      column('reason', '原因', 30),
      column('warning', '提示', 42),
    ],
    'sales-outbound': categoryColumns('销售出库数量'),
    'purchase-inbound': categoryColumns('采购入库数量'),
    'batch-balances': [
      column('warehouseCode', '仓库编号'),
      column('warehouseName', '仓库'),
      column('productName', '商品'),
      column('trackingMode', '库存模式'),
      column('supplierName', '供应商'),
      column('purchaseOrderNo', '采购单号'),
      column('productionBatch', '生产批次'),
      column('productionDate', '生产日期'),
      integerColumn('receivedQty', '入库数量'),
      integerColumn('movementRemainingQty', '流水重建剩余'),
      integerColumn('snapshotRemainingQty', '批次快照剩余'),
      integerColumn('unavailableQty', '不可售数量'),
      booleanColumn('snapshotConsistent', '快照一致'),
      column('warning', '提示', 42),
    ],
    alerts: [
      column('alertType', '预警类型'),
      column('status', '状态'),
      column('warehouseCode', '仓库编号'),
      column('warehouseName', '仓库'),
      column('productName', '商品'),
      column('trackingMode', '库存模式'),
      integerColumn('availableQty', '实际可售'),
      integerColumn('shortageQty', '短缺'),
      integerColumn('minimumAvailableQty', '最低库存'),
      datetimeColumn('firstDetectedAt', '首次发现'),
      datetimeColumn('lastDetectedAt', '最近发现'),
      datetimeColumn('resolvedAt', '恢复时间'),
    ],
    'stocktake-variances': [
      column('stocktakeNo', '盘点单号'),
      column('status', '状态'),
      column('warehouseCode', '仓库编号'),
      column('warehouseName', '仓库'),
      column('productName', '商品'),
      column('trackingMode', '库存模式'),
      integerColumn('snapshotOnHandQty', '账面现存'),
      integerColumn('countedOnHandQty', '实盘现存'),
      integerColumn('onHandDifferenceQty', '现存差异'),
      integerColumn('snapshotUnavailableQty', '账面不可售'),
      integerColumn('countedUnavailableQty', '实盘不可售'),
      integerColumn('unavailableDifferenceQty', '不可售差异'),
      column('reason', '原因', 30),
      datetimeColumn('submittedAt', '提交时间'),
      datetimeColumn('approvedAt', '审批时间'),
      datetimeColumn('postedAt', '生效时间'),
      datetimeColumn('createdAt', '创建时间'),
    ],
    transfers: [
      column('transferNo', '调拨单号'),
      column('status', '状态'),
      column('fromWarehouseCode', '调出仓编号'),
      column('fromWarehouseName', '调出仓'),
      column('toWarehouseCode', '调入仓编号'),
      column('toWarehouseName', '调入仓'),
      column('productName', '商品'),
      column('trackingMode', '库存模式'),
      integerColumn('plannedQty', '计划数量'),
      integerColumn('outboundQty', '已调出'),
      integerColumn('receivedQty', '已实收'),
      integerColumn('unavailableReceivedQty', '实收不可售'),
      integerColumn('differenceQty', '差异数量'),
      integerColumn('remainingInTransitQty', '剩余在途'),
      integerColumn('companyTotalQty', '公司总量'),
      datetimeColumn('outboundAt', '调出时间'),
      datetimeColumn('createdAt', '创建时间'),
      column('warning', '提示', 42),
    ],
    'inventory-valuation': [
      column('scope', '范围'),
      column('warehouseCode', '仓库编号'),
      column('warehouseName', '仓库'),
      column('productName', '商品'),
      column('trackingMode', '库存模式'),
      integerColumn('onHandQty', '账面现存'),
      integerColumn('inTransitQty', '调拨在途'),
      integerColumn('companyInventoryQty', '计价库存数量'),
      column('coverageStatus', '成本覆盖状态'),
      integerColumn('coveredQty', '已覆盖数量'),
      integerColumn('uncoveredQty', '未覆盖数量'),
      moneyColumn('inventoryAmountCents', '库存金额（分）'),
      column('warning', '提示', 48),
    ],
  };
  const result = [...base[reportType]];
  if (
    includeCosts &&
    [
      'warehouse-balances',
      'movements',
      'sales-outbound',
      'purchase-inbound',
      'batch-balances',
    ].includes(reportType)
  ) {
    const warningIndex = result.findIndex(
      (item) => item.key === 'warning',
    );
    const costColumns =
      reportType === 'movements' || reportType === 'batch-balances'
        ? [
            moneyColumn(
              'purchaseUnitCostCents',
              '采购单价（分）',
            ),
            column('coverageStatus', '成本覆盖状态'),
            integerColumn('coveredQty', '已覆盖数量'),
            integerColumn('uncoveredQty', '未覆盖数量'),
            moneyColumn('inventoryAmountCents', '库存金额（分）'),
          ]
        : [
            column('coverageStatus', '成本覆盖状态'),
            integerColumn('coveredQty', '已覆盖数量'),
            integerColumn('uncoveredQty', '未覆盖数量'),
            moneyColumn('inventoryAmountCents', '库存金额（分）'),
          ];
    result.splice(
      warningIndex < 0 ? result.length : warningIndex,
      0,
      ...costColumns,
    );
  }
  return result;
}

function categoryColumns(quantityLabel: string): ReportColumn[] {
  return [
    column('warehouseCode', '仓库编号'),
    column('warehouseName', '仓库'),
    column('productName', '商品'),
    column('trackingMode', '库存模式'),
    integerColumn('quantity', quantityLabel),
    column('warning', '提示', 42),
  ];
}

function column(
  key: string,
  label: string,
  width = 16,
): ReportColumn {
  return { key, label, type: 'string', width };
}

function integerColumn(key: string, label: string): ReportColumn {
  return { key, label, type: 'integer', width: 14 };
}

function moneyColumn(key: string, label: string): ReportColumn {
  return { key, label, type: 'money', width: 18 };
}

function booleanColumn(key: string, label: string): ReportColumn {
  return { key, label, type: 'boolean', width: 12 };
}

function datetimeColumn(key: string, label: string): ReportColumn {
  return { key, label, type: 'datetime', width: 22 };
}

function parseReportFilters(
  input: any,
  reportType: string,
  pageSizeOverride?: number,
) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('Inventory report filters must be an object.');
  }
  const allowed = new Set([
    'warehouseId',
    'productId',
    'inventoryTrackingMode',
    'movementType',
    'alertType',
    'status',
    'dateFrom',
    'dateTo',
    'asOf',
    'page',
    'pageSize',
    'limit',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw validationError('Unsupported inventory report filter.');
  }
  const dateFrom = parseShanghaiBoundary(
    input.dateFrom,
    'dateFrom',
    false,
  );
  const dateTo = parseShanghaiBoundary(
    input.dateTo,
    'dateTo',
    true,
  );
  const asOf = parseShanghaiBoundary(input.asOf, 'asOf', true);
  if (dateFrom && dateTo && dateFrom.getTime() > dateTo.getTime()) {
    throw validationError('dateFrom cannot be later than dateTo.');
  }
  if (
    reportType === 'period-summary' &&
    (!dateFrom || !dateTo)
  ) {
    throw validationError(
      'dateFrom and dateTo are required for the period summary.',
    );
  }
  const statusValues =
    reportType === 'alerts'
      ? ALERT_STATUSES
      : reportType === 'stocktake-variances'
        ? STOCKTAKE_STATUSES
        : reportType === 'transfers'
          ? TRANSFER_STATUSES
          : null;
  return {
    warehouseId: optionalId(input.warehouseId),
    productId: optionalId(input.productId),
    inventoryTrackingMode: optionalEnum(
      input.inventoryTrackingMode,
      TRACKING_MODES,
      'inventoryTrackingMode',
    ),
    movementType:
      reportType === 'movements'
        ? optionalEnum(
            input.movementType,
            MOVEMENT_TYPES,
            'movementType',
          )
        : null,
    alertType:
      reportType === 'alerts'
        ? optionalEnum(input.alertType, ALERT_TYPES, 'alertType')
        : null,
    status: statusValues
      ? optionalEnum(input.status, statusValues, 'status')
      : null,
    dateFrom,
    dateTo,
    asOf,
    dateFromText: dateFrom ? dateOnlyShanghai(dateFrom) : null,
    dateToText: dateTo ? dateOnlyShanghai(dateTo) : null,
    asOfText: asOf ? toIso(asOf) : null,
    page: positiveInteger(input.page, 1, 1_000_000, 1),
    pageSize:
      pageSizeOverride ||
      positiveInteger(
        input.pageSize ?? input.limit,
        1,
        100,
        20,
      ),
  };
}

function reportResult(
  reportType: string,
  filters: any,
  columns: ReportColumn[],
  rows: any[],
  total: number,
) {
  return {
    reportType,
    factSource: 'inventory_movements',
    filters: safeFilterDto(filters),
    columns,
    rows,
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.ceil(total / filters.pageSize),
    },
  };
}

function safeFilterDto(filters: any) {
  return compactObject({
    warehouseId: filters.warehouseId,
    productId: filters.productId,
    inventoryTrackingMode: lowerOrNull(
      filters.inventoryTrackingMode,
    ),
    movementType: lowerOrNull(filters.movementType),
    alertType: lowerOrNull(filters.alertType),
    status: lowerOrNull(filters.status),
    dateFrom: filters.dateFromText,
    dateTo: filters.dateToText,
    asOf: filters.asOfText,
  });
}

function projectRow(row: any, columns: ReportColumn[]) {
  const result: any = {};
  for (const column of columns) {
    result[column.key] =
      row[column.key] === undefined ? null : row[column.key];
  }
  return result;
}

function transferReceiptFacts(receipts: any[]) {
  const result = new Map<string, any>();
  for (const receipt of receipts) {
    if (upper(receipt.status) === 'DRAFT') {
      continue;
    }
    const sign = receipt.reversalOfReceiptId ? -1 : 1;
    for (const line of receipt.lines || []) {
      const current = result.get(line.transferLineId) || {
        receivedQty: 0,
        unavailableQty: 0,
        differenceQty: 0,
      };
      current.receivedQty = safeAdd(
        current.receivedQty,
        sign * integer(line.receivedQty),
      );
      current.unavailableQty = safeAdd(
        current.unavailableQty,
        sign * integer(line.unavailableQty),
      );
      current.differenceQty = safeAdd(
        current.differenceQty,
        sign * integer(line.differenceQty),
      );
      result.set(line.transferLineId, current);
    }
  }
  return result;
}

function accumulateCategory(target: any, quantity: number, fact: any) {
  target.quantity = safeAdd(target.quantity, quantity);
  const unitCost = fact ? movementUnitCost(fact) : null;
  if (unitCost !== null) {
    target.coveredQty = safeAdd(target.coveredQty, quantity);
    target.amountCents = safeAdd(
      target.amountCents,
      safeProduct(quantity, unitCost),
    );
  }
}

function movementUnitCost(fact: any) {
  const batchCost =
    upper(fact.batch?.costStatus) === 'COMPLETE'
      ? nonNegativeCost(fact.batch?.purchaseUnitCostCents)
      : null;
  return (
    batchCost ??
    nonNegativeCost(fact.serializedUnit?.purchaseCostCents) ??
    nonNegativeCost(fact.purchaseUnitCostCents)
  );
}

function stockSnapshotConsistent(pair: any) {
  if (!pair.snapshot) {
    return (
      pair.onHandQty === 0 &&
      pair.reservedQty === 0 &&
      pair.unavailableQty === 0 &&
      pair.inTransitQty === 0
    );
  }
  return (
    integer(pair.snapshot.onHandQty) === pair.onHandQty &&
    integer(pair.snapshot.reservedQty) === pair.reservedQty &&
    integer(pair.snapshot.unavailableQty) === pair.unavailableQty &&
    integer(pair.snapshot.inTransitQty) === pair.inTransitQty
  );
}

function quantityWarning(pair: any, snapshotConsistent: boolean) {
  let warning = '';
  const available =
    pair.onHandQty - pair.reservedQty - pair.unavailableQty;
  if (available < 0) {
    warning = `实际可售为负 ${Math.abs(available)} 瓶，请仓库处理缺货。`;
  }
  if (!snapshotConsistent) {
    warning = joinWarning(
      warning,
      '余额快照与有效流水不一致，请执行重建校验。',
    );
  }
  return warning;
}

function coverageStatus(totalQty: number, coveredQty: number) {
  if (totalQty <= 0) {
    return 'not_applicable';
  }
  if (coveredQty <= 0) {
    return 'none';
  }
  return coveredQty >= totalQty ? 'full' : 'partial';
}

function normalizeReportType(value: unknown) {
  const normalized =
    typeof value === 'string'
      ? value.normalize('NFKC').trim().toLowerCase().replace(/_/g, '-')
      : '';
  if (!REPORT_TYPES.has(normalized)) {
    throw createHttpError(
      404,
      'INVENTORY_REPORT_NOT_FOUND',
      'The requested inventory report does not exist.',
    );
  }
  return normalized;
}

function optionalId(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw validationError('Inventory report identifiers must be strings.');
  }
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || normalized.length > 191) {
    throw validationError('Inventory report identifier is invalid.');
  }
  return normalized;
}

function optionalEnum(
  value: unknown,
  allowed: Set<string>,
  field: string,
) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const normalized = upper(value);
  if (!allowed.has(normalized)) {
    throw validationError(`${field} is invalid.`);
  }
  return normalized;
}

function parseShanghaiBoundary(
  value: unknown,
  field: string,
  endOfDay: boolean,
) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw validationError(`${field} must be a valid date.`);
  }
  const text = value.normalize('NFKC').trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(
        `${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+08:00`,
      )
    : new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw validationError(`${field} must be a valid date.`);
  }
  return date;
}

function dateOnlyShanghai(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function positiveInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const number = Number(value);
  if (
    !Number.isSafeInteger(number) ||
    number < minimum ||
    number > maximum
  ) {
    throw validationError('Inventory report pagination is invalid.');
  }
  return number;
}

function validationError(message: string) {
  return createHttpError(400, 'VALIDATION_ERROR', message);
}

function pairKey(warehouseId: string, productId: string) {
  return `${warehouseId}\u0000${productId}`;
}

function integer(value: unknown) {
  const result = Number(value || 0);
  if (!Number.isSafeInteger(result)) {
    throw createHttpError(
      500,
      'INVENTORY_REPORT_INTEGER_OVERFLOW',
      'Inventory report quantity exceeds the supported range.',
    );
  }
  return result;
}

function nullableInteger(value: unknown) {
  return value === null || value === undefined ? null : integer(value);
}

function nonNegativeCost(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    return null;
  }
  return result;
}

function safeAdd(left: number, right: number) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw createHttpError(
      500,
      'INVENTORY_REPORT_INTEGER_OVERFLOW',
      'Inventory report total exceeds the supported range.',
    );
  }
  return result;
}

function safeProduct(quantity: number, unitCost: number) {
  const result = quantity * unitCost;
  if (!Number.isSafeInteger(result)) {
    throw createHttpError(
      500,
      'INVENTORY_REPORT_AMOUNT_OVERFLOW',
      'Inventory report amount exceeds the supported range.',
    );
  }
  return result;
}

function lower(value: unknown) {
  return String(value || '').toLowerCase();
}

function lowerOrNull(value: unknown) {
  return value === null || value === undefined ? null : lower(value);
}

function upper(value: unknown) {
  return String(value || '').trim().toUpperCase();
}

function toIso(value: unknown, dateOnly = false) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return dateOnly ? date.toISOString().slice(0, 10) : date.toISOString();
}

function joinWarning(left: unknown, right: unknown) {
  const values = [left, right]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return [...new Set(values)].join('；');
}

function compareReportRows(left: any, right: any) {
  return [
    'scope',
    'warehouseCode',
    'fromWarehouseCode',
    'productName',
    'transferNo',
    'purchaseOrderNo',
    'productionBatch',
  ]
    .map((key) =>
      String(left[key] || '').localeCompare(
        String(right[key] || ''),
        'zh-CN',
      ),
    )
    .find((value) => value !== 0) || 0;
}

function compactObject(value: any) {
  const result: any = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== null && item !== undefined && item !== '') {
      result[key] = item;
    }
  }
  return result;
}

function excelCellValue(value: unknown) {
  if (typeof value !== 'string') {
    return value;
  }
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function assertSameColumns(
  expected: ReportColumn[],
  actual: ReportColumn[],
) {
  const expectedKeys = expected.map((column) => column.key).join('\u0000');
  const actualKeys = actual.map((column) => column.key).join('\u0000');
  if (expectedKeys !== actualKeys) {
    throw createHttpError(
      500,
      'INVENTORY_REPORT_COLUMN_DRIFT',
      'Inventory report columns changed while the export was running.',
    );
  }
}

function fileTimestamp(date: Date) {
  return date.toISOString().replace(/\D/g, '').slice(0, 14);
}

function boundedTraceId(value: unknown) {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().slice(0, 64) || null
    : null;
}
