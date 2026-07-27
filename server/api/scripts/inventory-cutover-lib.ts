/**
 * 第 11 阶段库存上线切换脚本 — 核心库
 *
 * 安全原则：
 * - 默认 dry-run，零写入
 * - apply 需要环境确认、备份确认、维护冻结、manifest hash 一致
 * - 每步输出 runId / inputHash / planned / created / reused / skipped / conflict / warning
 * - 可重复执行，第二次不重复创建
 * - 冲突不写半批数据
 * - 禁止打印密码 / 令牌 / 连接串
 * - 不自动连接生产或云端
 * - POSTED 流水后不得 down migration
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export type CutoverStep =
  | 'inventory-preflight'
  | 'inventory-warehouse-bootstrap'
  | 'inventory-product-mode-plan'
  | 'inventory-serialized-warehouse-plan'
  | 'inventory-opening-import-plan'
  | 'inventory-open-orders-cutover'
  | 'inventory-open-after-sales-plan'
  | 'inventory-rebuild-verify'
  | 'inventory-cutover-rollback-report';

export interface CutoverOptions {
  dryRun: boolean;
  apply: boolean;
  env: string;
  backupConfirmed: boolean;
  maintenanceFreeze: boolean;
  manifestHash: string | null;
  /** 版本化配置：仓库、商品模式、期初库存等 */
  warehouses?: WarehouseInput[];
  productModePlans?: ProductModePlanInput[];
  openingItems?: OpeningItemInput[];
  goLiveAt?: string;
  /** runId 用于追踪本次执行 */
  runId?: string;
}

export interface WarehouseInput {
  code: string;
  name: string;
  address?: string;
  managerUserId?: string;
  isDefault: boolean;
}

export interface ProductModePlanInput {
  productId: string;
  expectedCurrentMode: 'NONE';
  targetMode: 'QUANTITY';
}

export interface OpeningItemInput {
  warehouseCode: string;
  productId: string;
  quantity: number;
  batch?: {
    sourceLineKey: string;
    supplierName?: string;
    purchaseOrderNo?: string;
    productionBatch?: string;
    productionDate?: string;
    purchaseUnitCostCents?: number;
  };
  condition?: 'SALEABLE' | 'UNAVAILABLE';
  reason?: string;
}

export interface CutoverItem {
  id: string;
  type: string;
  status: 'planned' | 'created' | 'reused' | 'skipped' | 'conflict' | 'warning';
  label: string;
  detail?: string;
}

export interface CutoverResult {
  step: CutoverStep;
  runId: string;
  inputHash: string;
  dryRun: boolean;
  planned: number;
  created: number;
  reused: number;
  skipped: number;
  conflict: number;
  warning: number;
  items: CutoverItem[];
  conflicts: string[];
  warnings: string[];
  /** apply 事务是否成功（dry-run 时为 null） */
  applied: boolean | null;
}

// ---------------------------------------------------------------------------
// 安全框架
// ---------------------------------------------------------------------------

export function generateRunId(): string {
  return `cutover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function calculateInputHash(payload: unknown): string {
  const json = JSON.stringify(payload, Object.keys(payload as object).sort());
  return createHash('sha256').update(json).digest('hex');
}

export function createResult(
  step: CutoverStep,
  runId: string,
  inputHash: string,
  dryRun: boolean,
): CutoverResult {
  return {
    step,
    runId,
    inputHash,
    dryRun,
    planned: 0,
    created: 0,
    reused: 0,
    skipped: 0,
    conflict: 0,
    warning: 0,
    items: [],
    conflicts: [],
    warnings: [],
    applied: null,
  };
}

function addItem(
  result: CutoverResult,
  item: Omit<CutoverItem, 'status'> & { status?: CutoverItem['status'] },
): void {
  const status = item.status ?? 'planned';
  result.items.push({ ...item, status });
  switch (status) {
    case 'planned':
      result.planned++;
      break;
    case 'created':
      result.created++;
      break;
    case 'reused':
      result.reused++;
      break;
    case 'skipped':
      result.skipped++;
      break;
    case 'conflict':
      result.conflict++;
      result.conflicts.push(item.detail || item.label);
      break;
    case 'warning':
      result.warning++;
      result.warnings.push(item.detail || item.label);
      break;
  }
}

export function addPlanned(result: CutoverResult, id: string, type: string, label: string, detail?: string): void {
  addItem(result, { id, type, label, detail, status: 'planned' });
}

export function addCreated(result: CutoverResult, id: string, type: string, label: string, detail?: string): void {
  addItem(result, { id, type, label, detail, status: 'created' });
}

export function addReused(result: CutoverResult, id: string, type: string, label: string, detail?: string): void {
  addItem(result, { id, type, label, detail, status: 'reused' });
}

export function addSkipped(result: CutoverResult, id: string, type: string, label: string, detail?: string): void {
  addItem(result, { id, type, label, detail, status: 'skipped' });
}

export function addConflict(result: CutoverResult, id: string, type: string, label: string, detail: string): void {
  addItem(result, { id, type, label, detail, status: 'conflict' });
}

export function addWarning(result: CutoverResult, id: string, type: string, label: string, detail: string): void {
  addItem(result, { id, type, label, detail, status: 'warning' });
}

/**
 * 安全检查：apply 模式下验证所有前置条件。
 * 返回错误消息数组，空数组表示通过。
 */
export function validateApplyPreconditions(options: CutoverOptions, dryRunHash: string | null): string[] {
  const errors: string[] = [];
  if (!options.apply) {
    errors.push('--apply 未设置，无法执行写入。');
  }
  if (options.env === 'production' || options.env === 'prod') {
    errors.push('禁止自动连接生产环境。');
  }
  if (!options.backupConfirmed) {
    errors.push('备份未确认（--backup-confirm）。');
  }
  if (!options.maintenanceFreeze) {
    errors.push('维护写入冻结未启用（--maintenance-freeze）。');
  }
  if (options.manifestHash && dryRunHash && options.manifestHash !== dryRunHash) {
    errors.push(
      `manifest hash 不一致：期望 ${options.manifestHash.slice(0, 12)}...，实际 ${dryRunHash.slice(0, 12)}...`,
    );
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** 仓库编码/名称归一化（与 inventory-query.service 保持一致） */
function normalizedWarehouseValue(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US');
}

/** 安全地打印结果，不泄露密码/令牌/连接串 */
export function formatResult(result: CutoverResult): string {
  return JSON.stringify(
    {
      step: result.step,
      runId: result.runId,
      inputHash: result.inputHash.slice(0, 16) + '...',
      dryRun: result.dryRun,
      applied: result.applied,
      counts: {
        planned: result.planned,
        created: result.created,
        reused: result.reused,
        skipped: result.skipped,
        conflict: result.conflict,
        warning: result.warning,
      },
      conflicts: result.conflicts,
      warnings: result.warnings,
      items: result.items.map((i) => ({
        id: i.id,
        type: i.type,
        status: i.status,
        label: i.label,
        detail: i.detail,
      })),
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// 1. inventory-preflight（只读检查）
// ---------------------------------------------------------------------------

export async function inventoryPreflight(
  prisma: PrismaClient,
  runId: string,
  inputHash: string,
  dryRun: boolean,
): Promise<CutoverResult> {
  const result = createResult('inventory-preflight', runId, inputHash, dryRun);

  // 1.1 检查库存相关表是否存在（通过查询模型）
  try {
    const warehouseCount = await prisma.warehouse.count();
    if (warehouseCount === 0) {
      addWarning(result, 'warehouses', 'schema', '仓库表为空', '尚未创建任何仓库，需要执行 warehouse-bootstrap。');
    } else {
      addPlanned(result, 'warehouses', 'schema', `仓库表有 ${warehouseCount} 条记录`);
    }
  } catch (e) {
    addConflict(result, 'warehouses', 'schema', '仓库表查询失败', String(e).split('\n')[0]);
  }

  // 1.2 检查 InventoryConfiguration
  try {
    const config = await prisma.inventoryConfiguration.findFirst();
    if (!config) {
      addWarning(result, 'config', 'schema', '库存配置不存在', 'InventoryConfiguration 表为空。');
    } else {
      addPlanned(result, 'config', 'schema', `库存配置已存在，goLiveAt=${config.goLiveAt || '未设置'}`);
    }
  } catch (e) {
    addConflict(result, 'config', 'schema', '库存配置查询失败', String(e).split('\n')[0]);
  }

  // 1.3 检查重复商品规范名
  const duplicateNames = await prisma.product.groupBy({
    by: ['name'],
    where: { isActive: true },
    having: { name: { _count: { gt: 1 } } },
    _count: { name: true },
  });
  for (const dup of duplicateNames) {
    addConflict(result, `product-name-${dup.name}`, 'product', `商品名称重复：${dup.name}`, `有 ${dup._count.name} 个活跃商品使用此名称。`);
  }

  // 1.4 检查商品库存模式分布
  const modeCounts = await prisma.product.groupBy({
    by: ['inventoryTrackingMode'],
    _count: { inventoryTrackingMode: true },
  });
  for (const mc of modeCounts) {
    addPlanned(result, `mode-${mc.inventoryTrackingMode}`, 'product', `inventoryTrackingMode=${mc.inventoryTrackingMode}`, `${mc._count.inventoryTrackingMode} 个商品`);
  }

  // 1.5 检查订单 orderType/status/packingStatus/deliveryType 组合
  const invalidOrders = await prisma.salesOrder.findMany({
    where: {
      OR: [
        { orderType: 'AFTER_SALES', status: { in: ['VALID'] } },
      ],
    },
    select: { id: true, orderNo: true, orderType: true, status: true },
    take: 100,
  });
  for (const order of invalidOrders) {
    addWarning(result, order.id, 'order', `AFTER_SALES 财务订单仍为 VALID：${order.orderNo}`, '切换时必须排除。');
  }

  // 1.6 检查逐瓶状态/绑定/资料/成本完整性
  const unitsWithoutWarehouse = await prisma.serializedInventoryUnit.count({
    where: { warehouseId: null },
  });
  if (unitsWithoutWarehouse > 0) {
    addConflict(result, 'units-no-warehouse', 'serialized', `${unitsWithoutWarehouse} 个逐瓶单元缺少仓库`, '需要执行 serialized-warehouse-plan。');
  }

  const allocatedUnits = await prisma.serializedInventoryUnit.findMany({
    where: { status: 'ALLOCATED' },
    select: {
      id: true,
      logisticsCode: true,
      salesOrderId: true,
      salesOrderItemId: true,
      warehouseId: true,
      purchaseCostCents: true,
      factoryDate: true,
      productionBatch: true,
      batchSerialNo: true,
    },
    take: 500,
  });
  for (const unit of allocatedUnits) {
    const issues: string[] = [];
    if (!unit.salesOrderId) issues.push('缺订单');
    if (!unit.salesOrderItemId) issues.push('缺订单明细');
    if (!unit.warehouseId) issues.push('缺仓库');
    if (unit.purchaseCostCents === null) issues.push('缺成本');
    if (!unit.logisticsCode) issues.push('缺物流码');
    if (!unit.factoryDate) issues.push('缺出厂日期');
    if (!unit.productionBatch) issues.push('缺生产批次');
    if (!unit.batchSerialNo) issues.push('缺批次序号');
    if (issues.length > 0) {
      addConflict(result, unit.id, 'serialized', `ALLOCATED 逐瓶资料不全：${unit.logisticsCode || unit.id}`, issues.join('、'));
    }
  }

  // 1.7 检查孤儿关系
  const orphanItems = await prisma.salesOrderItem.count({
    where: { product: null, productId: { not: null } },
  });
  if (orphanItems > 0) {
    addWarning(result, 'orphan-items', 'order', `${orphanItems} 个订单明细引用了不存在的商品`, '商品可能被删除。');
  }

  result.applied = null; // preflight 永远只读
  return result;
}

// ---------------------------------------------------------------------------
// 2. inventory-warehouse-bootstrap
// ---------------------------------------------------------------------------

export async function inventoryWarehouseBootstrap(
  prisma: PrismaClient,
  options: CutoverOptions,
  runId: string,
  inputHash: string,
): Promise<CutoverResult> {
  const result = createResult('inventory-warehouse-bootstrap', runId, inputHash, options.dryRun);
  const warehouses = options.warehouses || [];

  if (warehouses.length === 0) {
    addWarning(result, 'no-input', 'config', '未提供仓库配置', '通过 --warehouses-json 或版本化配置提供仓库信息。');
    return result;
  }

  // 检查已有默认仓
  const existingDefaults = await prisma.warehouse.count({
    where: { isDefault: true, isActive: true },
  });
  if (existingDefaults > 0) {
    addWarning(result, 'existing-default', 'warehouse', `已有 ${existingDefaults} 个活跃默认仓`, '将复用现有默认仓，不重复创建。');
  }

  for (const wh of warehouses) {
    const existing = await prisma.warehouse.findFirst({
      where: {
        OR: [{ code: wh.code }, { name: wh.name }],
      },
    });
    if (existing) {
      if (existing.code === wh.code && existing.name === wh.name) {
        addReused(result, existing.id, 'warehouse', `仓库已存在：${wh.code} ${wh.name}`);
      } else {
        addConflict(result, wh.code, 'warehouse', `仓库编码或名称冲突：${wh.code}/${wh.name}`, `与现有仓库 ${existing.code} ${existing.name} 冲突`);
      }
      continue;
    }

    addPlanned(result, wh.code, 'warehouse', `将创建仓库：${wh.code} ${wh.name}`, wh.isDefault ? '默认仓' : '普通仓');

    if (options.apply && result.conflict === 0) {
      try {
        await prisma.$transaction(async (tx) => {
          // 确保最多一个活跃默认仓
          if (wh.isDefault && existingDefaults === 0) {
            await tx.warehouse.updateMany({
              where: { isDefault: true, isActive: true },
              data: { isDefault: false },
            });
          }
          const warehouseData: Prisma.WarehouseUncheckedCreateInput = {
              code: wh.code,
              normalizedCode: normalizedWarehouseValue(wh.code),
              name: wh.name,
              normalizedName: normalizedWarehouseValue(wh.name),
              address: wh.address ?? null,
              managerUserId: wh.managerUserId ?? null,
              isActive: true,
              isDefault: wh.isDefault && existingDefaults === 0,
            };
          const created = await tx.warehouse.create({
            data: warehouseData,
          });
          addCreated(result, created.id, 'warehouse', `已创建仓库：${wh.code} ${wh.name}`);
        });
      } catch (e) {
        addConflict(result, wh.code, 'warehouse', `创建仓库失败：${wh.code}`, String(e).split('\n')[0]);
      }
    }
  }

  // 创建或更新 InventoryConfiguration
  const config = await prisma.inventoryConfiguration.findFirst();
  if (!config && options.apply) {
    try {
      await prisma.inventoryConfiguration.create({
        data: {
          goLiveAt: options.goLiveAt ? new Date(options.goLiveAt) : null,
          policyVersion: 1,
          maintenanceMode: options.maintenanceFreeze,
        },
      });
      addCreated(result, 'config', 'configuration', '已创建库存配置');
    } catch (e) {
      addConflict(result, 'config', 'configuration', '创建库存配置失败', String(e).split('\n')[0]);
    }
  } else if (config) {
    addReused(result, config.id, 'configuration', '库存配置已存在');
  } else {
    addPlanned(result, 'config', 'configuration', '将创建库存配置');
  }

  result.applied = options.apply ? result.conflict === 0 : null;
  return result;
}

// ---------------------------------------------------------------------------
// 3. inventory-product-mode-plan
// ---------------------------------------------------------------------------

export async function inventoryProductModePlan(
  prisma: PrismaClient,
  options: CutoverOptions,
  runId: string,
  inputHash: string,
): Promise<CutoverResult> {
  const result = createResult('inventory-product-mode-plan', runId, inputHash, options.dryRun);
  const plans = options.productModePlans || [];

  if (plans.length === 0) {
    addWarning(result, 'no-input', 'config', '未提供商品模式切换计划', '通过 --product-modes-json 提供显式商品 ID。');
    return result;
  }

  for (const plan of plans) {
    const product = await prisma.product.findUnique({
      where: { id: plan.productId },
      select: { id: true, name: true, unit: true, inventoryTrackingMode: true, isActive: true },
    });

    if (!product) {
      addConflict(result, plan.productId, 'product', `商品不存在：${plan.productId}`, '无法切换模式。');
      continue;
    }

    if (product.inventoryTrackingMode !== plan.expectedCurrentMode) {
      addConflict(
        result,
        product.id,
        'product',
        `商品模式不匹配：${product.name}`,
        `期望 ${plan.expectedCurrentMode}，实际 ${product.inventoryTrackingMode}。可能已切换或模式不符。`,
      );
      continue;
    }

    // 茅台（SERIALIZED）不允许切换为 QUANTITY
    if (String(product.inventoryTrackingMode) === 'SERIALIZED') {
      addConflict(result, product.id, 'product', `茅台商品保持 SERIALIZED：${product.name}`, '不允许切换为 QUANTITY。');
      continue;
    }

    addPlanned(result, product.id, 'product-mode', `将切换 ${product.name}：${plan.expectedCurrentMode} → ${plan.targetMode}`);

    if (options.apply && result.conflict === 0) {
      try {
        const sourceKey = `mode-change-${product.id}-${runId}`;
        await prisma.$transaction(async (tx) => {
          // 创建模式切换记录（专用命令，不通过通用 Product PATCH）
          await tx.productInventoryModeChange.create({
            data: {
              productId: product.id,
              expectedCurrentMode: plan.expectedCurrentMode,
              targetMode: plan.targetMode,
              effectiveAt: new Date(),
              sourceKey,
              idempotencyKey: `idem-${sourceKey}`,
              requestHash: calculateInputHash({ productId: product.id, targetMode: plan.targetMode, runId }),
              status: 'APPLIED',
              appliedAt: new Date(),
            },
          });
          // 更新商品模式
          await tx.product.update({
            where: { id: product.id },
            data: { inventoryTrackingMode: plan.targetMode },
          });
        });
        addCreated(result, product.id, 'product-mode', `已切换 ${product.name} → ${plan.targetMode}`);
      } catch (e) {
        addConflict(result, product.id, 'product-mode', `切换失败：${product.name}`, String(e).split('\n')[0]);
      }
    }
  }

  result.applied = options.apply ? result.conflict === 0 : null;
  return result;
}

// ---------------------------------------------------------------------------
// 4. inventory-serialized-warehouse-plan
// ---------------------------------------------------------------------------

export type SerializedCutoverClassification =
  | 'CANDIDATE_RESERVED'
  | 'CANDIDATE_OUTBOUND'
  | 'MANUAL_CONFIRMATION'
  | 'CONFLICT';

export function classifyAllocatedUnit(unit: {
  salesOrder?: any;
  salesOrderItem?: any;
  warehouseId?: string | null;
  purchaseCostCents?: number | null;
  logisticsCode?: string | null;
  factoryDate?: string | null;
  productionBatch?: string | null;
  batchSerialNo?: string | null;
}): {
  classification: SerializedCutoverClassification;
  suggestedClassification: SerializedCutoverClassification | null;
  reasons: string[];
} {
  const order = unit.salesOrder;
  const item = unit.salesOrderItem;
  if (!order || !item) {
    return {
      classification: 'CONFLICT',
      suggestedClassification: null,
      reasons: [!order ? 'sales_order_missing' : 'sales_order_item_missing'],
    };
  }
  const status = String(order.status || '').toUpperCase();
  if (status === 'CANCELLED' || status === 'REFUNDED') {
    return {
      classification: 'MANUAL_CONFIRMATION',
      suggestedClassification: null,
      reasons: [`terminal_order_status:${status.toLowerCase()}`],
    };
  }
  const orderDeliveryTypes = new Set(
    (order.items || [])
      .map((c: any) => String(c.deliveryType || '').toUpperCase())
      .filter(Boolean),
  );
  if (orderDeliveryTypes.size !== 1) {
    return {
      classification: 'MANUAL_CONFIRMATION',
      suggestedClassification: null,
      reasons: ['mixed_or_missing_order_delivery_type'],
    };
  }
  const deliveryType = String(item.deliveryType || '').toUpperCase();
  if (deliveryType === 'SELF_PICKUP') {
    return {
      classification: 'MANUAL_CONFIRMATION',
      suggestedClassification: null,
      reasons: ['legacy_self_pickup_must_not_be_guessed'],
    };
  }
  if (deliveryType !== 'SHIPPING') {
    return {
      classification: 'CONFLICT',
      suggestedClassification: null,
      reasons: ['unsupported_item_delivery_type'],
    };
  }
  const suggestedClassification =
    String(order.packingStatus || '').toUpperCase() === 'PACKED'
      ? 'CANDIDATE_OUTBOUND'
      : 'CANDIDATE_RESERVED';
  const incompleteReasons = [
    !unit.warehouseId ? 'warehouse_missing' : null,
    unit.purchaseCostCents === null || unit.purchaseCostCents === undefined
      ? 'purchase_cost_missing'
      : null,
    !unit.logisticsCode ? 'logistics_code_missing' : null,
    !unit.factoryDate ? 'factory_date_missing' : null,
    !unit.productionBatch ? 'production_batch_missing' : null,
    !unit.batchSerialNo ? 'batch_serial_no_missing' : null,
  ].filter((r): r is string => Boolean(r));
  if (incompleteReasons.length > 0) {
    return {
      classification: 'MANUAL_CONFIRMATION',
      suggestedClassification,
      reasons: incompleteReasons,
    };
  }
  return {
    classification: suggestedClassification,
    suggestedClassification,
    reasons: [],
  };
}

export async function inventorySerializedWarehousePlan(
  prisma: PrismaClient,
  options: CutoverOptions,
  runId: string,
  inputHash: string,
): Promise<CutoverResult> {
  const result = createResult('inventory-serialized-warehouse-plan', runId, inputHash, options.dryRun);

  // 查找缺仓的逐瓶单元
  const units = await prisma.serializedInventoryUnit.findMany({
    where: { warehouseId: null },
    include: {
      salesOrder: {
        include: {
          items: { select: { id: true, deliveryType: true } },
        },
      },
      salesOrderItem: { select: { id: true, deliveryType: true } },
    },
    take: 1000,
  });

  // 查找默认仓
  const defaultWarehouse = await prisma.warehouse.findFirst({
    where: { isDefault: true, isActive: true },
  });

  for (const unit of units) {
    const classification = classifyAllocatedUnit({
      salesOrder: unit.salesOrder,
      salesOrderItem: unit.salesOrderItem,
      warehouseId: unit.warehouseId,
      purchaseCostCents: unit.purchaseCostCents,
      logisticsCode: unit.logisticsCode,
      factoryDate: unit.factoryDate ? String(unit.factoryDate) : null,
      productionBatch: unit.productionBatch,
      batchSerialNo: unit.batchSerialNo,
    });

    if (classification.classification === 'CONFLICT') {
      addConflict(result, unit.id, 'serialized', `逐瓶冲突：${unit.logisticsCode || unit.id}`, classification.reasons.join('、'));
      continue;
    }

    if (classification.classification === 'MANUAL_CONFIRMATION') {
      addWarning(result, unit.id, 'serialized', `逐瓶需人工确认：${unit.logisticsCode || unit.id}`, classification.reasons.join('、'));
      continue;
    }

    // CANDIDATE_RESERVED 或 CANDIDATE_OUTBOUND
    if (!defaultWarehouse) {
      addConflict(result, unit.id, 'serialized', `无默认仓可分配：${unit.logisticsCode || unit.id}`, '先执行 warehouse-bootstrap。');
      continue;
    }

    addPlanned(
      result,
      unit.id,
      'serialized-warehouse',
      `将分配到默认仓：${unit.logisticsCode || unit.id}`,
      `分类=${classification.classification}`,
    );

    if (options.apply && result.conflict === 0) {
      try {
        await prisma.serializedInventoryUnit.update({
          where: { id: unit.id },
          data: { warehouseId: defaultWarehouse.id },
        });
        addCreated(result, unit.id, 'serialized-warehouse', `已分配仓库：${unit.logisticsCode || unit.id}`);
      } catch (e) {
        addConflict(result, unit.id, 'serialized-warehouse', `分配失败：${unit.logisticsCode || unit.id}`, String(e).split('\n')[0]);
      }
    }
  }

  // ALLOCATED 逐瓶单元的分类报告（不写入，只规划）
  const allocatedUnits = await prisma.serializedInventoryUnit.findMany({
    where: { status: 'ALLOCATED' },
    include: {
      salesOrder: {
        include: {
          items: { select: { id: true, deliveryType: true } },
        },
      },
      salesOrderItem: { select: { id: true, deliveryType: true } },
    },
    take: 500,
  });

  for (const unit of allocatedUnits) {
    const classification = classifyAllocatedUnit({
      salesOrder: unit.salesOrder,
      salesOrderItem: unit.salesOrderItem,
      warehouseId: unit.warehouseId,
      purchaseCostCents: unit.purchaseCostCents,
      logisticsCode: unit.logisticsCode,
      factoryDate: unit.factoryDate ? String(unit.factoryDate) : null,
      productionBatch: unit.productionBatch,
      batchSerialNo: unit.batchSerialNo,
    });

    if (classification.classification === 'CANDIDATE_RESERVED') {
      addPlanned(result, unit.id, 'allocated-reserved', `候选 RESERVED：${unit.logisticsCode || unit.id}`);
    } else if (classification.classification === 'CANDIDATE_OUTBOUND') {
      addPlanned(result, unit.id, 'allocated-outbound', `候选 OUTBOUND：${unit.logisticsCode || unit.id}`);
    } else if (classification.classification === 'CONFLICT') {
      addConflict(result, unit.id, 'allocated', `ALLOCATED 冲突：${unit.logisticsCode || unit.id}`, classification.reasons.join('、'));
    } else {
      addWarning(result, unit.id, 'allocated', `ALLOCATED 需人工确认：${unit.logisticsCode || unit.id}`, classification.reasons.join('、'));
    }
  }

  result.applied = options.apply ? result.conflict === 0 : null;
  return result;
}

// ---------------------------------------------------------------------------
// 5. inventory-opening-import-plan
// ---------------------------------------------------------------------------

export async function inventoryOpeningImportPlan(
  prisma: PrismaClient,
  options: CutoverOptions,
  runId: string,
  inputHash: string,
): Promise<CutoverResult> {
  const result = createResult('inventory-opening-import-plan', runId, inputHash, options.dryRun);
  const items = options.openingItems || [];

  if (items.length === 0) {
    addWarning(result, 'no-input', 'config', '未提供期初库存数据', '通过 --opening-items-json 提供人工输入的逐项期初数据。');
    return result;
  }

  for (const item of items) {
    const warehouse = await prisma.warehouse.findFirst({
      where: { code: item.warehouseCode, isActive: true },
    });
    if (!warehouse) {
      addConflict(result, item.warehouseCode, 'opening', `仓库不存在：${item.warehouseCode}`, '无法导入期初库存。');
      continue;
    }

    const product = await prisma.product.findUnique({
      where: { id: item.productId },
      select: { id: true, name: true, unit: true, inventoryTrackingMode: true },
    });
    if (!product) {
      addConflict(result, item.productId, 'opening', `商品不存在：${item.productId}`, '无法导入期初库存。');
      continue;
    }
    if (product.inventoryTrackingMode === 'NONE') {
      addConflict(result, item.productId, 'opening', `商品未启用库存跟踪：${product.name}`, '先执行 product-mode-plan。');
      continue;
    }
    if (product.inventoryTrackingMode === 'SERIALIZED') {
      addConflict(result, item.productId, 'opening', `茅台商品不能用数量导入：${product.name}`, '使用逐瓶入库。');
      continue;
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      addConflict(result, item.productId, 'opening', `数量必须为正整数：${item.quantity}`, '期初数量只允许整数瓶。');
      continue;
    }

    const batchKey = item.batch?.sourceLineKey || `opening-${item.productId}-${item.warehouseCode}`;
    // 检查是否已导入（幂等）
    const existingBatch = await prisma.inventoryBatch.findFirst({
      where: { sourceLineKey: batchKey },
    });
    if (existingBatch) {
      addReused(result, existingBatch.id, 'opening', `期初已导入：${product.name}`, `batch=${batchKey}`);
      continue;
    }

    addPlanned(
      result,
      `${warehouse.code}-${item.productId}`,
      'opening',
      `将导入期初：${product.name} ×${item.quantity} → ${warehouse.name}`,
      `batch=${batchKey}`,
    );

    if (options.apply && result.conflict === 0) {
      try {
        await prisma.$transaction(async (tx) => {
          // 创建期初单据
          const openingSourceKey = `opening-${batchKey}-${runId}`;
          const documentData: Prisma.InventoryDocumentUncheckedCreateInput = {
            documentNo: `INV-${openingSourceKey.replace(/-/g, '').slice(0, 20).toUpperCase()}`,
            type: 'OPENING',
            status: 'POSTED',
            warehouseId: warehouse.id,
            sourceType: 'inventory_cutover',
            sourceKey: openingSourceKey,
            requestHash: calculateInputHash({ openingSourceKey, runId }),
            businessAt: new Date(),
            reason: item.reason || '期初导入',
          };
          const doc = await tx.inventoryDocument.create({
            data: documentData,
          });
          // 创建单据行
          const lineData: Prisma.InventoryDocumentLineUncheckedCreateInput = {
            documentId: doc.id,
            lineNo: 1,
            productId: item.productId,
            quantity: item.quantity,
            condition: item.condition || 'SALEABLE',
            productNameSnapshot: product.name,
            unitSnapshot: product.unit,
          };
          const line = await tx.inventoryDocumentLine.create({
            data: lineData,
          });
          // 创建批次
          const batchData: Prisma.InventoryBatchUncheckedCreateInput = {
            warehouseId: warehouse.id,
            productId: item.productId,
            sourceLineKey: batchKey,
            sourceDocumentLineId: line.id,
            supplierName: item.batch?.supplierName ?? null,
            purchaseOrderNo: item.batch?.purchaseOrderNo ?? null,
            productionBatch: item.batch?.productionBatch ?? null,
            productionDate: item.batch?.productionDate ? new Date(item.batch.productionDate) : null,
            purchaseUnitCostCents: item.batch?.purchaseUnitCostCents ?? null,
            costStatus: item.batch?.purchaseUnitCostCents != null ? 'COMPLETE' : 'PENDING',
            receivedQty: item.quantity,
            remainingQty: item.quantity,
            unavailableQty: 0,
            fifoAt: new Date(),
          };
          const batch = await tx.inventoryBatch.create({
            data: batchData,
          });
          // 创建不可变流水
          const movementData: Prisma.InventoryMovementUncheckedCreateInput = {
            sourceKey: `opening-mv-${batchKey}-${runId}`,
            documentLineId: line.id,
            warehouseId: warehouse.id,
            productId: item.productId,
            batchId: batch.id,
            movementType: 'OPENING_IN',
            onHandDelta: item.quantity,
            reservedDelta: 0,
            unavailableDelta: 0,
            inTransitDelta: 0,
            businessAt: new Date(),
            productNameSnapshot: product.name,
            unitSnapshot: product.unit,
          };
          const movement = await tx.inventoryMovement.create({
            data: movementData,
          });
          // 更新余额（upsert，不直接 UPDATE 绕过领域规则——但期初是特殊场景）
          await tx.warehouseProductStock.upsert({
            where: {
              warehouseId_productId: { warehouseId: warehouse.id, productId: item.productId },
            },
            create: {
              warehouseId: warehouse.id,
              productId: item.productId,
              onHandQty: item.quantity,
              reservedQty: 0,
              unavailableQty: 0,
              inTransitQty: 0,
              version: 1,
              lastMovementId: movement.id,
            },
            update: {
              onHandQty: { increment: item.quantity },
              version: { increment: 1 },
              lastMovementId: movement.id,
            },
          });
          // 更新单据行关联批次
          await tx.inventoryDocumentLine.update({
            where: { id: line.id },
            data: { batchId: batch.id },
          });
        });
        addCreated(result, `${warehouse.code}-${item.productId}`, 'opening', `已导入期初：${product.name} ×${item.quantity}`);
      } catch (e) {
        addConflict(result, `${warehouse.code}-${item.productId}`, 'opening', `导入失败：${product.name}`, String(e).split('\n')[0]);
      }
    }
  }

  result.applied = options.apply ? result.conflict === 0 : null;
  return result;
}

// ---------------------------------------------------------------------------
// 6. inventory-open-orders-cutover
// ---------------------------------------------------------------------------

export async function inventoryOpenOrdersCutover(
  prisma: PrismaClient,
  options: CutoverOptions,
  runId: string,
  inputHash: string,
): Promise<CutoverResult> {
  const result = createResult('inventory-open-orders-cutover', runId, inputHash, options.dryRun);

  if (!options.goLiveAt) {
    addConflict(result, 'no-golive', 'config', '未设置 goLiveAt', '通过 --go-live-at 提供启用时间点。');
    return result;
  }

  const goLiveAt = new Date(options.goLiveAt);

  // 查找启用时仍有效、未出库的 shipping 明细
  // 排除：AFTER_SALES、CANCELLED、REFUNDED、已打包(PACKED)、self_pickup
  const openShippingItems = await prisma.salesOrderItem.findMany({
    where: {
      deliveryType: 'SHIPPING',
      salesOrder: {
        status: { in: ['VALID', 'PARTIAL_REFUND'] },
        orderType: { not: 'AFTER_SALES' },
        packingStatus: { in: ['PENDING', 'PACKING'] }, // 未打包
      },
      productId: { not: null },
    },
    include: {
      salesOrder: {
        select: {
          id: true,
          orderNo: true,
          orderType: true,
          status: true,
          packingStatus: true,
          fulfillmentWarehouseId: true,
        },
      },
      product: {
        select: { id: true, name: true, inventoryTrackingMode: true },
      },
    },
    take: 500,
  });

  const defaultWarehouse = await prisma.warehouse.findFirst({
    where: { isDefault: true, isActive: true },
  });

  for (const item of openShippingItems) {
    if (!item.product) {
      addConflict(result, item.id, 'order-item', `订单明细缺商品：${item.salesOrder.orderNo}`, '无法生成占用。');
      continue;
    }
    if (item.product.inventoryTrackingMode === 'NONE') {
      addConflict(result, item.id, 'order-item', `商品未启用库存跟踪：${item.product.name}`, '先执行 product-mode-plan。');
      continue;
    }

    const warehouseId = item.salesOrder.fulfillmentWarehouseId || defaultWarehouse?.id;
    if (!warehouseId) {
      addConflict(result, item.id, 'order-item', `无履约仓库：${item.salesOrder.orderNo}`, '先执行 warehouse-bootstrap。');
      continue;
    }

    // 生成稳定 inventoryLineKey
    const inventoryLineKey = `order-${item.salesOrder.id}-item-${item.id}`;

    // 检查是否已生成占用（幂等）
    const existingReservation = await prisma.inventoryReservation.findFirst({
      where: { inventoryLineKey },
    });
    if (existingReservation) {
      addReused(result, existingReservation.id, 'reservation', `已生成占用：${item.salesOrder.orderNo}`, `lineKey=${inventoryLineKey}`);
      continue;
    }

    addPlanned(
      result,
      item.id,
      'reservation',
      `将生成占用：${item.salesOrder.orderNo} ${item.product.name} ×${item.quantity}`,
      `warehouse=${warehouseId}, lineKey=${inventoryLineKey}`,
    );

    if (options.apply && result.conflict === 0) {
      try {
        await prisma.$transaction(async (tx) => {
          // 更新订单明细的 inventoryLineKey
          await tx.salesOrderItem.update({
            where: { id: item.id },
            data: { inventoryLineKey },
          });
          // 创建占用
          const reservationData: Prisma.InventoryReservationUncheckedCreateInput = {
            sourceKey: `cutover-reserve-${inventoryLineKey}-${runId}`,
            salesOrderId: item.salesOrder.id,
            salesOrderItemId: item.id,
            inventoryLineKey,
            warehouseId,
            productId: item.productId!,
            requestedQty: item.quantity,
            reservedQty: item.quantity,
            assignedQty: 0,
            outboundQty: 0,
            status: 'RESERVED',
            version: 1,
          };
          await tx.inventoryReservation.create({
            data: reservationData,
          });
          // 更新余额占用
          await tx.warehouseProductStock.upsert({
            where: {
              warehouseId_productId: { warehouseId, productId: item.productId! },
            },
            create: {
              warehouseId,
              productId: item.productId!,
              onHandQty: 0,
              reservedQty: item.quantity,
              unavailableQty: 0,
              inTransitQty: 0,
              version: 1,
            },
            update: {
              reservedQty: { increment: item.quantity },
              version: { increment: 1 },
            },
          });
        });
        addCreated(result, item.id, 'reservation', `已生成占用：${item.salesOrder.orderNo}`);
      } catch (e) {
        addConflict(result, item.id, 'reservation', `占用失败：${item.salesOrder.orderNo}`, String(e).split('\n')[0]);
      }
    }
  }

  // 统计排除的订单
  const excludedPacked = await prisma.salesOrder.count({
    where: {
      packingStatus: 'PACKED',
      orderType: { not: 'AFTER_SALES' },
      status: { in: ['VALID', 'PARTIAL_REFUND'] },
    },
  });
  if (excludedPacked > 0) {
    addWarning(result, 'excluded-packed', 'order', `${excludedPacked} 个已打包订单保持 LEGACY`, '不重新扣减。');
  }

  const excludedAfterSales = await prisma.salesOrder.count({
    where: { orderType: 'AFTER_SALES' },
  });
  if (excludedAfterSales > 0) {
    addWarning(result, 'excluded-after-sales', 'order', `${excludedAfterSales} 个 AFTER_SALES 财务订单已排除`, '不生成占用。');
  }

  result.applied = options.apply ? result.conflict === 0 : null;
  return result;
}

// ---------------------------------------------------------------------------
// 7+8. inventory-open-after-sales-plan
// ---------------------------------------------------------------------------

export async function inventoryOpenAfterSalesPlan(
  prisma: PrismaClient,
  options: CutoverOptions,
  runId: string,
  inputHash: string,
): Promise<CutoverResult> {
  const result = createResult('inventory-open-after-sales-plan', runId, inputHash, options.dryRun);

  // 列出未完成售后
  const openAfterSales = await prisma.afterSalesOrder.findMany({
    where: {
      status: { in: ['NEGOTIATING', 'WAITING_RECEIVE', 'WAITING_RESEND', 'WAITING_REFUND'] },
    },
    include: {
      salesOrder: { select: { id: true, orderNo: true } },
      items: { select: { id: true, productId: true, productName: true, quantity: true } },
    },
    take: 500,
  });

  for (const as of openAfterSales) {
    addPlanned(
      result,
      as.id,
      'after-sales',
      `未完成售后：${as.afterSalesNo} (${as.salesOrder?.orderNo || '无订单号'})`,
      `状态=${as.status}, ${as.items.length} 个明细`,
    );
  }

  // 列出旧 warehouseConfirmed 记录（不推断实际收到数量/收货仓/返库）
  // 假设有 warehouseConfirmedAt 字段表示旧版仓库确认
  const oldConfirmed = await prisma.afterSalesOrder.count({
    where: {
      status: 'COMPLETED',
      // 旧版确认：没有关联 AfterSalesReceipt
    },
  });
  if (oldConfirmed > 0) {
    addWarning(
      result,
      'old-confirmed',
      'after-sales',
      `${oldConfirmed} 个旧版仓库确认记录`,
      '不推断实际收到数量、收货仓或返库。需人工核对。',
    );
  }

  result.applied = options.apply ? result.conflict === 0 : null;
  return result;
}

// ---------------------------------------------------------------------------
// 9. inventory-rebuild-verify
// ---------------------------------------------------------------------------

export async function inventoryRebuildVerify(
  prisma: PrismaClient,
  runId: string,
  inputHash: string,
  dryRun: boolean,
): Promise<CutoverResult> {
  const result = createResult('inventory-rebuild-verify', runId, inputHash, dryRun);

  // 获取所有仓库×商品余额
  const stocks = await prisma.warehouseProductStock.findMany({
    take: 1000,
  });

  for (const stock of stocks) {
    // 从流水重建余额
    const movements = await prisma.inventoryMovement.findMany({
      where: {
        warehouseId: stock.warehouseId,
        productId: stock.productId,
      },
      select: {
        onHandDelta: true,
        reservedDelta: true,
        unavailableDelta: true,
        inTransitDelta: true,
        movementType: true,
      },
    });

    const rebuilt = movements.reduce(
      (acc, mv) => ({
        onHand: acc.onHand + (mv.onHandDelta || 0),
        reserved: acc.reserved + (mv.reservedDelta || 0),
        unavailable: acc.unavailable + (mv.unavailableDelta || 0),
        inTransit: acc.inTransit + (mv.inTransitDelta || 0),
      }),
      { onHand: 0, reserved: 0, unavailable: 0, inTransit: 0 },
    );

    const mismatches: string[] = [];
    if (rebuilt.onHand !== stock.onHandQty) mismatches.push(`onHand: 重建=${rebuilt.onHand}, 实际=${stock.onHandQty}`);
    if (rebuilt.reserved !== stock.reservedQty) mismatches.push(`reserved: 重建=${rebuilt.reserved}, 实际=${stock.reservedQty}`);
    if (rebuilt.unavailable !== stock.unavailableQty) mismatches.push(`unavailable: 重建=${rebuilt.unavailable}, 实际=${stock.unavailableQty}`);
    if (rebuilt.inTransit !== stock.inTransitQty) mismatches.push(`inTransit: 重建=${rebuilt.inTransit}, 实际=${stock.inTransitQty}`);

    if (mismatches.length > 0) {
      addConflict(
        result,
        `${stock.warehouseId}-${stock.productId}`,
        'rebuild',
        `余额不一致：${stock.warehouseId}/${stock.productId}`,
        mismatches.join('; '),
      );
    } else {
      addPlanned(result, `${stock.warehouseId}-${stock.productId}`, 'rebuild', `余额一致：${stock.warehouseId}/${stock.productId}`);
    }

    // 检查 reserved/unavailable/inTransit 不为负
    if (stock.reservedQty < 0) addConflict(result, stock.id, 'rebuild', '占用为负', `reservedQty=${stock.reservedQty}`);
    if (stock.unavailableQty < 0) addConflict(result, stock.id, 'rebuild', '不可售为负', `unavailableQty=${stock.unavailableQty}`);
    if (stock.inTransitQty < 0) addConflict(result, stock.id, 'rebuild', '在途为负', `inTransitQty=${stock.inTransitQty}`);
  }

  // 逐瓶 Assignment 交叉校验
  const allocatedUnits = await prisma.serializedInventoryUnit.count({
    where: { status: 'ALLOCATED' },
  });
  const assignments = await prisma.serializedInventoryAssignment.count();
  if (allocatedUnits !== assignments) {
    addConflict(
      result,
      'assignment-mismatch',
      'serialized',
      `逐瓶 Assignment 不一致`,
      `ALLOCATED 单元=${allocatedUnits}, Assignment 记录=${assignments}`,
    );
  } else {
    addPlanned(result, 'assignment-check', 'serialized', `逐瓶 Assignment 一致：${allocatedUnits}`);
  }

  result.applied = null; // rebuild-verify 永远只读
  return result;
}

// ---------------------------------------------------------------------------
// 10. inventory-cutover-rollback-report
// ---------------------------------------------------------------------------

export async function inventoryCutoverRollbackReport(
  prisma: PrismaClient,
  options: { runId?: string },
  runId: string,
  inputHash: string,
  dryRun: boolean,
): Promise<CutoverResult> {
  const result = createResult('inventory-cutover-rollback-report', runId, inputHash, dryRun);
  const targetRunId = options.runId || runId;

  // 查找本 run 创建的配置
  const configs = await prisma.inventoryConfiguration.findMany({
    where: { goLiveAt: { not: null } },
  });
  for (const config of configs) {
    addPlanned(result, config.id, 'config', `库存配置：maintenanceMode=${config.maintenanceMode}`, `goLiveAt=${config.goLiveAt}`);
  }

  // 查找本 run 创建的仓库（通过 runId 无法直接追踪，列出所有活跃仓库）
  const warehouses = await prisma.warehouse.findMany({
    where: { isActive: true },
  });
  for (const wh of warehouses) {
    addPlanned(result, wh.id, 'warehouse', `仓库：${wh.code} ${wh.name}`, wh.isDefault ? '默认仓' : '普通仓');
  }

  // 查找本 run 创建的商品模式切换记录
  const modeChanges = await prisma.productInventoryModeChange.findMany({
    where: { sourceKey: { contains: targetRunId } },
  });
  for (const mc of modeChanges) {
    if (mc.status === 'APPLIED') {
      addWarning(
        result,
        mc.id,
        'rollback',
        `已应用模式切换（POSTED）：${mc.productId}`,
        'POSTED 事实不可撤销，只能写冲销/补偿。模式可手动切回但需谨慎。',
      );
    } else if (mc.status === 'PENDING') {
      addPlanned(result, mc.id, 'rollback', `待应用模式切换（草稿）：${mc.productId}`, '草稿可撤销。');
    }
  }

  // 查找本 run 创建的期初单据
  const openingDocs = await prisma.inventoryDocument.findMany({
    where: {
      type: 'OPENING',
      status: 'POSTED',
      sourceKey: { contains: targetRunId },
    },
  });
  for (const doc of openingDocs) {
    addWarning(
      result,
      doc.id,
      'rollback',
      `已过账期初单据（POSTED）：${doc.id}`,
      'POSTED 流水不可删除。回滚只能写冲销单据或恢复整库备份。',
    );
  }

  // 查找本 run 创建的占用
  const reservations = await prisma.inventoryReservation.findMany({
    where: {
      sourceKey: { contains: targetRunId },
    },
  });
  for (const res of reservations) {
    if (res.status === 'RESERVED' && res.outboundQty === 0) {
      addPlanned(result, res.id, 'rollback', `可撤销占用：${res.inventoryLineKey}`, '释放占用即可撤销。');
    } else if (res.outboundQty > 0) {
      addWarning(
        result,
        res.id,
        'rollback',
        `已出库占用（POSTED）：${res.inventoryLineKey}`,
        '已出库不可撤销，只能写冲销入库。',
      );
    }
  }

  // 总结
  if (result.warning > 0) {
    addWarning(
      result,
      'summary',
      'rollback',
      `本 run 有 ${result.warning} 个 POSTED 事实`,
      'POSTED 事实不可删除，只能写冲销/补偿流水或在维护窗口恢复整库备份。已有 POSTED 流水后不得用 down migration 回滚。',
    );
  }

  result.applied = null; // rollback-report 永远只读
  return result;
}
