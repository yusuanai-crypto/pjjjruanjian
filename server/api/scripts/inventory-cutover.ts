#!/usr/bin/env node
/**
 * 第 11 阶段库存上线切换脚本 — CLI 入口
 *
 * 用法：
 *   ts-node scripts/inventory-cutover.ts <step> [options]
 *
 * 步骤：
 *   inventory-preflight              只读预检
 *   inventory-warehouse-bootstrap    创建仓库和配置
 *   inventory-product-mode-plan      商品模式切换
 *   inventory-serialized-warehouse-plan  逐瓶仓库规划
 *   inventory-opening-import-plan    期初库存导入
 *   inventory-open-orders-cutover    开放订单占用
 *   inventory-open-after-sales-plan  开放售后规划
 *   inventory-rebuild-verify         余额重建校验
 *   inventory-cutover-rollback-report  回滚报告
 *
 * 选项：
 *   --apply                        执行写入（默认 dry-run）
 *   --env <env>                    目标环境（local/test/staging，禁止 production）
 *   --backup-confirm               确认已备份
 *   --maintenance-freeze           维护写入冻结已启用
 *   --manifest-hash <hash>         dry-run 的 inputHash，apply 时必须一致
 *   --warehouses-json <path>       仓库配置 JSON
 *   --product-modes-json <path>    商品模式切换计划 JSON
 *   --opening-items-json <path>    期初库存 JSON
 *   --go-live-at <iso>             库存启用时间点
 *   --run-id <id>                  指定 runId（用于回滚报告）
 *   --help                         显示帮助
 */

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import {
  CutoverStep,
  CutoverOptions,
  generateRunId,
  calculateInputHash,
  validateApplyPreconditions,
  formatResult,
  inventoryPreflight,
  inventoryWarehouseBootstrap,
  inventoryProductModePlan,
  inventorySerializedWarehousePlan,
  inventoryOpeningImportPlan,
  inventoryOpenOrdersCutover,
  inventoryOpenAfterSalesPlan,
  inventoryRebuildVerify,
  inventoryCutoverRollbackReport,
} from './inventory-cutover-lib';

const VALID_STEPS: CutoverStep[] = [
  'inventory-preflight',
  'inventory-warehouse-bootstrap',
  'inventory-product-mode-plan',
  'inventory-serialized-warehouse-plan',
  'inventory-opening-import-plan',
  'inventory-open-orders-cutover',
  'inventory-open-after-sales-plan',
  'inventory-rebuild-verify',
  'inventory-cutover-rollback-report',
];

function parseArgs(argv: string[]): { step: string; options: Record<string, string | boolean> } {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }
  const step = args[0];
  const options: Record<string, string | boolean> = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        options[key] = next;
        i++;
      } else {
        options[key] = true;
      }
    }
  }
  return { step, options };
}

function printHelp(): void {
  console.log(`
第 11 阶段库存上线切换脚本

用法: ts-node scripts/inventory-cutover.ts <step> [options]

步骤:
  inventory-preflight              只读预检（migration/enum/孤儿/逐瓶完整性）
  inventory-warehouse-bootstrap    创建仓库和库存配置
  inventory-product-mode-plan      商品模式 NONE→QUANTITY 切换
  inventory-serialized-warehouse-plan  逐瓶仓库规划和 ALLOCATED 分类
  inventory-opening-import-plan    期初库存导入（人工输入）
  inventory-open-orders-cutover    开放邮寄订单一次性占用
  inventory-open-after-sales-plan  开放售后规划
  inventory-rebuild-verify         余额/批次/流水/逐瓶交叉校验
  inventory-cutover-rollback-report  回滚报告（草稿可撤销，POSTED 只输出计划）

选项:
  --apply                        执行写入（默认 dry-run 零写入）
  --env <env>                    目标环境（local/test/staging，禁止 production）
  --backup-confirm               确认已备份
  --maintenance-freeze           维护写入冻结已启用
  --manifest-hash <hash>         dry-run 的 inputHash，apply 时必须一致
  --warehouses-json <path>       仓库配置 JSON 文件路径
  --product-modes-json <path>    商品模式切换计划 JSON 文件路径
  --opening-items-json <path>    期初库存 JSON 文件路径
  --go-live-at <iso>             库存启用时间点（ISO 8601）
  --run-id <id>                  指定 runId（用于回滚报告）

安全:
  - 默认 dry-run，零写入
  - apply 需要环境确认、备份确认、维护冻结、manifest hash 一致
  - 禁止连接生产环境
  - 禁止打印密码/令牌/连接串
  - POSTED 流水后不得 down migration
`);
}

function readJsonFile(path: string): any {
  try {
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    console.error(`无法读取 JSON 文件 ${path}: ${String(e).split('\n')[0]}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const { step, options: opts } = parseArgs(process.argv);

  if (!VALID_STEPS.includes(step as CutoverStep)) {
    console.error(`未知步骤: ${step}\n有效步骤: ${VALID_STEPS.join(', ')}`);
    process.exit(1);
  }

  const dryRun = !opts['apply'];
  const runId = (opts['run-id'] as string) || generateRunId();

  // 构建 options
  const cutoverOptions: CutoverOptions = {
    dryRun,
    apply: !!opts['apply'],
    env: (opts['env'] as string) || 'local',
    backupConfirmed: !!opts['backup-confirm'],
    maintenanceFreeze: !!opts['maintenance-freeze'],
    manifestHash: (opts['manifest-hash'] as string) || null,
    goLiveAt: (opts['go-live-at'] as string) || undefined,
    runId,
  };

  // 读取 JSON 配置
  if (opts['warehouses-json']) {
    cutoverOptions.warehouses = readJsonFile(opts['warehouses-json'] as string);
  }
  if (opts['product-modes-json']) {
    cutoverOptions.productModePlans = readJsonFile(opts['product-modes-json'] as string);
  }
  if (opts['opening-items-json']) {
    cutoverOptions.openingItems = readJsonFile(opts['opening-items-json'] as string);
  }

  // 计算 inputHash（用于追踪和 manifest 一致性校验）
  const inputHash = calculateInputHash({
    step,
    runId,
    warehouses: cutoverOptions.warehouses,
    productModePlans: cutoverOptions.productModePlans,
    openingItems: cutoverOptions.openingItems,
    goLiveAt: cutoverOptions.goLiveAt,
  });

  // apply 安全检查
  if (!dryRun) {
    const errors = validateApplyPreconditions(cutoverOptions, inputHash);
    if (errors.length > 0) {
      console.error('apply 前置条件不满足，拒绝写入:');
      for (const err of errors) {
        console.error(`  - ${err}`);
      }
      process.exit(1);
    }
    console.log(`[apply 模式] 环境=${cutoverOptions.env}, 备份已确认, 维护冻结已启用, manifest hash 一致`);
  } else {
    console.log(`[dry-run 模式] 零写入。inputHash=${inputHash.slice(0, 16)}...`);
  }

  // 初始化 Prisma Client（不打印连接串）
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL 未设置。请提供隔离测试库连接串。');
    process.exit(1);
  }
  if (databaseUrl.includes('production') || databaseUrl.includes('prod')) {
    console.error('检测到生产环境连接串，拒绝执行。');
    process.exit(1);
  }

  const prisma = new PrismaClient({
    log: ['error'],
  });

  try {
    let result;
    switch (step as CutoverStep) {
      case 'inventory-preflight':
        result = await inventoryPreflight(prisma, runId, inputHash, dryRun);
        break;
      case 'inventory-warehouse-bootstrap':
        result = await inventoryWarehouseBootstrap(prisma, cutoverOptions, runId, inputHash);
        break;
      case 'inventory-product-mode-plan':
        result = await inventoryProductModePlan(prisma, cutoverOptions, runId, inputHash);
        break;
      case 'inventory-serialized-warehouse-plan':
        result = await inventorySerializedWarehousePlan(prisma, cutoverOptions, runId, inputHash);
        break;
      case 'inventory-opening-import-plan':
        result = await inventoryOpeningImportPlan(prisma, cutoverOptions, runId, inputHash);
        break;
      case 'inventory-open-orders-cutover':
        result = await inventoryOpenOrdersCutover(prisma, cutoverOptions, runId, inputHash);
        break;
      case 'inventory-open-after-sales-plan':
        result = await inventoryOpenAfterSalesPlan(prisma, cutoverOptions, runId, inputHash);
        break;
      case 'inventory-rebuild-verify':
        result = await inventoryRebuildVerify(prisma, runId, inputHash, dryRun);
        break;
      case 'inventory-cutover-rollback-report':
        result = await inventoryCutoverRollbackReport(prisma, { runId: cutoverOptions.runId }, runId, inputHash, dryRun);
        break;
      default:
        console.error(`未实现的步骤: ${step}`);
        process.exit(1);
    }

    console.log(formatResult(result));

    if (result.conflict > 0) {
      console.error(`\n⚠ 有 ${result.conflict} 个冲突，请处理后再继续。`);
      process.exit(2);
    }
  } catch (e) {
    console.error(`执行失败: ${String(e).split('\n')[0]}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`未捕获异常: ${String(e).split('\n')[0]}`);
  process.exit(1);
});
