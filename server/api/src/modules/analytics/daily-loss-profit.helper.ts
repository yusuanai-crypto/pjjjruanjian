export const DAILY_LOSS_COST_WARNING =
  'PRODUCT_ACTUAL_COST_UNAVAILABLE';

export type DailyLossCostCoverageStatus =
  | 'available'
  | 'unavailable';

export interface DailyLossProfitWarning {
  code: typeof DAILY_LOSS_COST_WARNING;
  message: string;
}

export interface DailyLossProfitItem {
  date: string;
  productId: string | null;
  productName: string;
  tastingRoomNo: string;
  operatorId: string | null;
  operatorName: string;
  lossQuantity: number;
  unit: string;
  estimatedProfitLossCents: number | null;
  costCoverageStatus: DailyLossCostCoverageStatus;
  warnings: DailyLossProfitWarning[];
}

export interface DailyLossProfitSummary {
  rowCount: number;
  totalLossQuantity: number;
  calculableLossQuantity: number;
  unpricedLossQuantity: number;
  estimatedProfitLossCents: number | null;
  knownEstimatedProfitLossCents: number;
  incompleteRowCount: number;
  costCoverageStatus: 'complete' | 'incomplete';
}

export interface DailyLossProfitResult {
  summary: DailyLossProfitSummary;
  items: DailyLossProfitItem[];
}

type AggregatedLoss = Omit<
  DailyLossProfitItem,
  | 'estimatedProfitLossCents'
  | 'costCoverageStatus'
  | 'warnings'
>;

export function buildDailyLossProfitResult(input: {
  travelGroups?: any[];
  productActualCosts?: any[];
}): DailyLossProfitResult {
  const aggregates = aggregateRecordedDailyLossItems(
    input?.travelGroups || [],
  );
  const costsByProductId = groupCostsByProduct(
    input?.productActualCosts || [],
  );
  const items = aggregates.map((row) =>
    priceDailyLossRow(row, costsByProductId),
  );
  sortDailyLossProfitItems(items);
  return {
    summary: summarizeDailyLossProfitItems(items),
    items,
  };
}

export function aggregateRecordedDailyLossItems(
  travelGroups: any[],
): AggregatedLoss[] {
  const grouped = new Map<string, AggregatedLoss>();
  for (const group of travelGroups || []) {
    if (
      String(group?.lossStatus || '').trim().toUpperCase() !==
      'RECORDED'
    ) {
      continue;
    }
    const date = toShanghaiDateOnly(group?.visitDate);
    if (!date) {
      continue;
    }
    const tastingItems = Array.isArray(group?.tastingItems)
      ? group.tastingItems
      : [];
    for (const item of tastingItems) {
      const quantity = toNonNegativeInteger(item?.quantity);
      if (quantity <= 0) {
        continue;
      }
      const productId = optionalString(item?.productId);
      const productName =
        optionalString(item?.productName) || '未命名商品';
      const tastingRoomNo =
        optionalString(group?.tastingRoomNo) || '未填写';
      const operatorId =
        optionalString(group?.lossConfirmedById) ||
        optionalString(group?.lossConfirmedBy?.id);
      const operatorName =
        optionalString(group?.lossConfirmedBy?.name) ||
        optionalString(group?.lossConfirmedBy?.username) ||
        '未知操作员';
      const unit = optionalString(item?.unit) || '未填写';
      const key = JSON.stringify([
        date,
        productId,
        productName,
        tastingRoomNo,
        operatorId,
        operatorName,
      ]);
      const current = grouped.get(key);
      if (current) {
        current.lossQuantity += quantity;
      } else {
        grouped.set(key, {
          date,
          productId,
          productName,
          tastingRoomNo,
          operatorId,
          operatorName,
          lossQuantity: quantity,
          unit,
        });
      }
    }
  }
  return [...grouped.values()];
}

export function findEffectiveProductActualCost(
  costs: any[],
  productId: string | null,
  visitDate: string,
) {
  if (!productId) {
    return null;
  }
  const matching = (costs || [])
    .filter((cost) => {
      if (
        optionalString(cost?.productId) !== productId ||
        cost?.isActive !== true
      ) {
        return false;
      }
      const effectiveFrom = toShanghaiDateOnly(cost?.effectiveFrom);
      const effectiveTo = toShanghaiDateOnly(cost?.effectiveTo);
      return (
        Boolean(effectiveFrom) &&
        effectiveFrom! <= visitDate &&
        (!effectiveTo || effectiveTo >= visitDate)
      );
    })
    .sort((left, right) => {
      const dateComparison = String(
        toShanghaiDateOnly(right?.effectiveFrom) || '',
      ).localeCompare(
        String(toShanghaiDateOnly(left?.effectiveFrom) || ''),
      );
      if (dateComparison !== 0) {
        return dateComparison;
      }
      return String(left?.id || '').localeCompare(
        String(right?.id || ''),
      );
    });
  return matching[0] || null;
}

export function summarizeDailyLossProfitItems(
  items: DailyLossProfitItem[],
): DailyLossProfitSummary {
  let totalLossQuantity = 0;
  let calculableLossQuantity = 0;
  let unpricedLossQuantity = 0;
  let knownEstimatedProfitLossCents = 0;
  let incompleteRowCount = 0;
  for (const item of items || []) {
    totalLossQuantity += item.lossQuantity;
    if (item.estimatedProfitLossCents === null) {
      unpricedLossQuantity += item.lossQuantity;
      incompleteRowCount += 1;
    } else {
      calculableLossQuantity += item.lossQuantity;
      knownEstimatedProfitLossCents +=
        item.estimatedProfitLossCents;
    }
  }
  return {
    rowCount: items.length,
    totalLossQuantity,
    calculableLossQuantity,
    unpricedLossQuantity,
    estimatedProfitLossCents:
      incompleteRowCount > 0
        ? null
        : knownEstimatedProfitLossCents,
    knownEstimatedProfitLossCents,
    incompleteRowCount,
    costCoverageStatus:
      incompleteRowCount > 0 ? 'incomplete' : 'complete',
  };
}

export function sortDailyLossProfitItems(
  items: DailyLossProfitItem[],
) {
  items.sort((left, right) => {
    const dateComparison = right.date.localeCompare(left.date);
    if (dateComparison !== 0) {
      return dateComparison;
    }
    for (const [leftValue, rightValue] of [
      [left.productName, right.productName],
      [left.tastingRoomNo, right.tastingRoomNo],
      [left.operatorName, right.operatorName],
      [left.productId || '', right.productId || ''],
      [left.operatorId || '', right.operatorId || ''],
    ]) {
      const comparison = leftValue.localeCompare(
        rightValue,
        'zh-Hans-CN',
      );
      if (comparison !== 0) {
        return comparison;
      }
    }
    return 0;
  });
}

function priceDailyLossRow(
  row: AggregatedLoss,
  costsByProductId: Map<string, any[]>,
): DailyLossProfitItem {
  const effectiveCost = findEffectiveProductActualCost(
    row.productId
      ? costsByProductId.get(row.productId) || []
      : [],
    row.productId,
    row.date,
  );
  if (!effectiveCost) {
    return {
      ...row,
      estimatedProfitLossCents: null,
      costCoverageStatus: 'unavailable',
      warnings: [
        {
          code: DAILY_LOSS_COST_WARNING,
          message: row.productId
            ? '该商品在到店日期没有有效的实际成本。'
            : '该损耗商品未关联商品档案，无法取得实际成本。',
        },
      ],
    };
  }
  const unitCostCents = toInteger(effectiveCost?.costCents);
  return {
    ...row,
    estimatedProfitLossCents:
      row.lossQuantity * unitCostCents,
    costCoverageStatus: 'available',
    warnings: [],
  };
}

function groupCostsByProduct(costs: any[]) {
  const grouped = new Map<string, any[]>();
  for (const cost of costs || []) {
    const productId = optionalString(cost?.productId);
    if (!productId) {
      continue;
    }
    const rows = grouped.get(productId) || [];
    rows.push(cost);
    grouped.set(productId, rows);
  }
  return grouped;
}

function toShanghaiDateOnly(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
  ) {
    return value.trim();
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function toNonNegativeInteger(value: unknown) {
  return Math.max(0, toInteger(value));
}

function toInteger(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue)
    ? Math.trunc(numberValue)
    : 0;
}
