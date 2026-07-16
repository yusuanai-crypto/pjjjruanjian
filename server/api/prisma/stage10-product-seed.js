'use strict';

const {
  STAGE10_INITIAL_PRODUCTS,
  STAGE10_PRODUCT_CATALOG_GO_LIVE_DATE,
  STAGE10_PRODUCT_SOURCE_WORKBOOK,
  normalizeProductName,
  validateStage10InitialProducts,
} = require('./stage10-product-seed-data');

const BACKFILL_TARGETS = Object.freeze([
  { model: 'SalesOrderItem', delegate: 'salesOrderItem' },
  { model: 'TravelGroupTastingItem', delegate: 'travelGroupTastingItem' },
  { model: 'SalesDeductionRule', delegate: 'salesDeductionRule' },
  { model: 'AgencyDeductionRule', delegate: 'agencyDeductionRule' },
]);

async function seedStage10ProductsAndBackfill(prisma, options = {}) {
  validateStage10InitialProducts();
  const now = validDate(options.now) || new Date();
  const goLiveDateText =
    options.goLiveDate || STAGE10_PRODUCT_CATALOG_GO_LIVE_DATE;
  const goLiveDate = parseDateOnly(goLiveDateText, 'goLiveDate');
  const actorUserId = options.actorUserId || null;
  const execute = async (client) =>
    seedAndBackfill(client, {
      actorUserId,
      goLiveDate,
      goLiveDateText,
      now,
    });

  if (options.transaction === false || typeof prisma.$transaction !== 'function') {
    return execute(prisma);
  }
  return prisma.$transaction((tx) => execute(tx), {
    maxWait: 10000,
    timeout: 120000,
  });
}

async function seedAndBackfill(prisma, context) {
  const warnings = [];
  const report = {
    sourceWorkbook: STAGE10_PRODUCT_SOURCE_WORKBOOK,
    goLiveDate: context.goLiveDateText,
    products: { expected: 16, created: 0, reused: 0, skipped: 0 },
    actualCosts: { expected: 16, created: 0, updated: 0, reused: 0, skipped: 0 },
    matched: 0,
    skipped: 0,
    warnings,
    tables: {},
  };

  const productBySeedId = new Map();
  for (const source of STAGE10_INITIAL_PRODUCTS) {
    const existing = await prisma.product.findUnique({
      where: { normalizedName: source.normalizedName },
      select: { id: true, name: true, normalizedName: true, unit: true },
    });
    if (existing) {
      if (existing.name !== source.name || existing.unit !== source.unit) {
        report.products.skipped += 1;
        warnings.push(
          warning('PRODUCT_SEED_EXISTING_CONFLICT', {
            productName: source.name,
            recordId: existing.id,
            message: '已有商品的名称或单位与版本化首批数据不一致，未覆盖。',
          }),
        );
        continue;
      }
      productBySeedId.set(source.id, existing);
      report.products.reused += 1;
      continue;
    }
    try {
      const product = await prisma.product.create({
        data: {
          id: source.id,
          name: source.name,
          normalizedName: source.normalizedName,
          unit: source.unit,
          isActive: true,
          notes: `首批商品；来源：${STAGE10_PRODUCT_SOURCE_WORKBOOK}`,
          createdById: context.actorUserId,
          updatedById: context.actorUserId,
          createdAt: context.now,
          updatedAt: context.now,
        },
        select: { id: true, name: true, normalizedName: true, unit: true },
      });
      productBySeedId.set(source.id, product);
      report.products.created += 1;
    } catch (error) {
      report.products.skipped += 1;
      warnings.push(
        warning('PRODUCT_SEED_CONFLICT', {
          productName: source.name,
          message: `商品初始化冲突，未猜测处理：${errorMessage(error)}`,
        }),
      );
    }
  }

  for (const source of STAGE10_INITIAL_PRODUCTS) {
    const product = productBySeedId.get(source.id);
    if (!product) {
      report.actualCosts.skipped += 1;
      warnings.push(
        warning('ACTUAL_COST_PRODUCT_MISSING', {
          productName: source.name,
          message: '商品未成功初始化，实际成本已跳过。',
        }),
      );
      continue;
    }
    const existingById = await prisma.productActualCost.findUnique({
      where: { id: source.actualCostId },
      select: {
        id: true,
        productId: true,
        costCents: true,
        effectiveFrom: true,
        effectiveTo: true,
        isActive: true,
      },
    });
    if (existingById && existingById.productId !== product.id) {
      report.actualCosts.skipped += 1;
      warnings.push(
        warning('ACTUAL_COST_ID_CONFLICT', {
          productName: source.name,
          message: `成本种子 ID 已属于其他商品：${source.actualCostId}`,
        }),
      );
      continue;
    }
    if (existingById) {
      const isExpected =
        existingById.costCents === source.costCents &&
        sameDateOnly(existingById.effectiveFrom, context.goLiveDate) &&
        existingById.effectiveTo === null &&
        existingById.isActive === true;
      if (isExpected) {
        report.actualCosts.reused += 1;
      } else {
        report.actualCosts.skipped += 1;
        warnings.push(
          warning('ACTUAL_COST_SEED_EXISTING_CONFLICT', {
            productName: source.name,
            recordId: existingById.id,
            message: '已有首批成本记录与版本化数据不一致，未覆盖。',
          }),
        );
      }
      continue;
    }

    const overlaps = await prisma.productActualCost.findMany({
      where: {
        productId: product.id,
        isActive: true,
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: context.goLiveDate } },
        ],
      },
      select: {
        id: true,
        costCents: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
    });
    const equivalent = overlaps.filter(
      (row) =>
        row.costCents === source.costCents &&
        sameDateOnly(row.effectiveFrom, context.goLiveDate) &&
        row.effectiveTo === null,
    );
    if (overlaps.length > 0) {
      if (overlaps.length === 1 && equivalent.length === 1) {
        report.actualCosts.reused += 1;
        continue;
      }
      report.actualCosts.skipped += 1;
      warnings.push(
        warning('ACTUAL_COST_RANGE_CONFLICT', {
          productName: source.name,
          message: `存在 ${overlaps.length} 条启用成本与正式启用日区间冲突，未猜测处理。`,
        }),
      );
      continue;
    }

    const costData = {
      productId: product.id,
      costCents: source.costCents,
      effectiveFrom: context.goLiveDate,
      effectiveTo: null,
      isActive: true,
      notes: `首批商品实际成本；来源：${STAGE10_PRODUCT_SOURCE_WORKBOOK}`,
      updatedById: context.actorUserId,
      updatedAt: context.now,
    };
    await prisma.productActualCost.create({
      data: {
        id: source.actualCostId,
        ...costData,
        createdById: context.actorUserId,
        createdAt: context.now,
      },
    });
    report.actualCosts.created += 1;
  }

  const backfill = await backfillHistoricalProductIds(prisma);
  report.matched = backfill.matched;
  report.skipped = backfill.skipped;
  report.tables = backfill.tables;
  warnings.push(...backfill.warnings);
  return report;
}

async function backfillHistoricalProductIds(prisma) {
  const warnings = [];
  const products = await prisma.product.findMany({
    select: { id: true, name: true, normalizedName: true },
    orderBy: { id: 'asc' },
  });
  const productIndex = buildProductIndex(products, warnings);
  const report = { matched: 0, skipped: 0, warnings, tables: {} };

  for (const target of BACKFILL_TARGETS) {
    const delegate = prisma[target.delegate];
    const rows = await delegate.findMany({
      where: { productId: null },
      select: { id: true, productName: true },
      orderBy: { id: 'asc' },
    });
    const tableReport = { scanned: rows.length, matched: 0, skipped: 0 };
    report.tables[target.model] = tableReport;

    for (const row of rows) {
      const normalizedName = normalizeProductName(row.productName);
      const candidates = normalizedName
        ? productIndex.get(normalizedName) || []
        : [];
      if (candidates.length !== 1) {
        tableReport.skipped += 1;
        report.skipped += 1;
        warnings.push(
          warning(
            candidates.length === 0
              ? 'HISTORICAL_PRODUCT_NOT_MATCHED'
              : 'HISTORICAL_PRODUCT_AMBIGUOUS',
            {
              model: target.model,
              recordId: row.id,
              productName: row.productName,
              message:
                candidates.length === 0
                  ? '规范化名称未匹配商品，未回填 productId。'
                  : `规范化名称匹配到 ${candidates.length} 个商品，未猜测回填。`,
            },
          ),
        );
        continue;
      }

      const updateResult = await delegate.updateMany({
        where: { id: row.id, productId: null },
        data: { productId: candidates[0].id },
      });
      if (Number(updateResult?.count || 0) !== 1) {
        tableReport.skipped += 1;
        report.skipped += 1;
        warnings.push(
          warning('HISTORICAL_PRODUCT_CONCURRENT_CHANGE', {
            model: target.model,
            recordId: row.id,
            productName: row.productName,
            message: '记录在回填时已发生变化，未覆盖现有 productId。',
          }),
        );
        continue;
      }
      tableReport.matched += 1;
      report.matched += 1;
    }
  }
  return report;
}

function buildProductIndex(products, warnings = []) {
  const index = new Map();
  for (const product of products || []) {
    const normalizedFromName = normalizeProductName(product.name);
    const storedNormalized = normalizeProductName(product.normalizedName);
    if (!normalizedFromName || normalizedFromName !== storedNormalized) {
      warnings.push(
        warning('PRODUCT_NORMALIZATION_CONFLICT', {
          productName: product.name,
          recordId: product.id,
          message: '商品 name 与 normalizedName 不一致，已排除自动回填。',
        }),
      );
      continue;
    }
    const candidates = index.get(storedNormalized) || [];
    candidates.push(product);
    index.set(storedNormalized, candidates);
  }
  return index;
}

function parseDateOnly(value, fieldName) {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${fieldName} must use YYYY-MM-DD.`);
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error(`${fieldName} is not a valid date.`);
  }
  return date;
}

function sameDateOnly(left, right) {
  return validDate(left)?.toISOString().slice(0, 10) ===
    validDate(right)?.toISOString().slice(0, 10);
}

function validDate(value) {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function warning(code, details) {
  return { code, ...details };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function printStage10ProductSeedReport(report, logger = console) {
  logger.log(
    [
      `stage10Products=${report.products.created + report.products.reused}`,
      `stage10ActualCosts=${report.actualCosts.created + report.actualCosts.updated + report.actualCosts.reused}`,
      `matched=${report.matched}`,
      `skipped=${report.skipped}`,
      `warnings=${report.warnings.length}`,
      `goLiveDate=${report.goLiveDate}`,
    ].join(', '),
  );
  for (const item of report.warnings) {
    logger.warn(`WARN ${JSON.stringify(item)}`);
  }
}

module.exports = {
  BACKFILL_TARGETS,
  backfillHistoricalProductIds,
  buildProductIndex,
  parseDateOnly,
  printStage10ProductSeedReport,
  seedStage10ProductsAndBackfill,
};
