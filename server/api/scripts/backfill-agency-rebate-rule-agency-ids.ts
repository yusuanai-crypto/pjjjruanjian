import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

type BackfillOptions = {
  apply?: boolean;
  environment?: string;
  expectedDatabase?: string;
  backupConfirmed?: boolean;
  now?: Date;
};

type AgencyCandidate = {
  id: string;
  name: string;
};

type RebateRuleInput = {
  id: string;
  agencyId?: string | null;
  agencyName?: string | null;
};

export type AgencyRebateBackfillPlan = {
  updates: Array<{
    ruleId: string;
    previousAgencyName: string;
    agencyId: string;
    agencyName: string;
  }>;
  manualReview: Array<{
    ruleId: string;
    agencyName: string | null;
    normalizedAgencyName: string;
    reason: 'MISSING_AGENCY_NAME' | 'NO_MATCH' | 'AMBIGUOUS_MATCH';
    candidates: AgencyCandidate[];
  }>;
  alreadyBoundRuleCount: number;
};

export function normalizeAgencyName(value: unknown) {
  return String(value ?? '')
    .trim()
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase();
}

export function planAgencyRebateRuleBackfill(
  rules: RebateRuleInput[],
  agencies: AgencyCandidate[],
): AgencyRebateBackfillPlan {
  const agenciesByName = new Map<string, AgencyCandidate[]>();
  for (const agency of agencies) {
    const normalizedName = normalizeAgencyName(agency.name);
    if (!normalizedName) continue;
    const candidates = agenciesByName.get(normalizedName) || [];
    candidates.push({ id: agency.id, name: agency.name });
    agenciesByName.set(normalizedName, candidates);
  }

  const updates: AgencyRebateBackfillPlan['updates'] = [];
  const manualReview: AgencyRebateBackfillPlan['manualReview'] = [];
  let alreadyBoundRuleCount = 0;

  for (const rule of rules) {
    if (String(rule.agencyId ?? '').trim()) {
      alreadyBoundRuleCount += 1;
      continue;
    }
    const previousAgencyName = String(rule.agencyName ?? '').trim();
    const normalizedAgencyName = normalizeAgencyName(previousAgencyName);
    const candidates = normalizedAgencyName
      ? agenciesByName.get(normalizedAgencyName) || []
      : [];
    if (!normalizedAgencyName || candidates.length !== 1) {
      manualReview.push({
        ruleId: rule.id,
        agencyName: previousAgencyName || null,
        normalizedAgencyName,
        reason: !normalizedAgencyName
          ? 'MISSING_AGENCY_NAME'
          : candidates.length === 0
            ? 'NO_MATCH'
            : 'AMBIGUOUS_MATCH',
        candidates,
      });
      continue;
    }
    updates.push({
      ruleId: rule.id,
      previousAgencyName,
      agencyId: candidates[0].id,
      agencyName: candidates[0].name,
    });
  }

  return { updates, manualReview, alreadyBoundRuleCount };
}

export async function backfillAgencyRebateRuleAgencyIds(
  prisma: any,
  options: BackfillOptions = {},
) {
  const apply = options.apply === true;
  const databaseRows = (await prisma.$queryRawUnsafe(
    'SELECT DATABASE() AS databaseName',
  )) as Array<{ databaseName?: string | null }>;
  const databaseName = String(databaseRows[0]?.databaseName ?? '').trim();
  if (!databaseName) {
    throw new Error('无法确认当前数据库名称，已中止。');
  }
  if (apply) {
    if (!options.environment?.trim()) {
      throw new Error('apply 模式必须提供 --environment <环境名称>。');
    }
    if (!options.expectedDatabase?.trim()) {
      throw new Error('apply 模式必须提供 --database <目标数据库名>。');
    }
    if (options.expectedDatabase.trim() !== databaseName) {
      throw new Error(
        `目标数据库不一致：确认值为“${options.expectedDatabase}”，实际连接为“${databaseName}”。`,
      );
    }
    if (options.backupConfirmed !== true) {
      throw new Error('apply 模式必须提供 --confirmed-backup，确认已完成可恢复备份。');
    }
  }

  const [rules, agencies] = await Promise.all([
    prisma.agencyRebateRule.findMany({
      select: { id: true, agencyId: true, agencyName: true },
      orderBy: { id: 'asc' },
    }),
    prisma.travelAgency.findMany({
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    }),
  ]);
  const plan = planAgencyRebateRuleBackfill(rules, agencies);
  let appliedRuleCount = 0;

  if (apply && plan.updates.length > 0) {
    await prisma.$transaction(async (tx: any) => {
      for (const update of plan.updates) {
        const result = await tx.agencyRebateRule.updateMany({
          where: { id: update.ruleId, agencyId: null },
          data: {
            agencyId: update.agencyId,
            agencyName: update.agencyName,
          },
        });
        if (result.count !== 1) {
          throw new Error(
            `规则 ${update.ruleId} 在执行期间已变化，事务已回滚，请重新 dry-run。`,
          );
        }
        appliedRuleCount += 1;
      }
    });
  }

  return {
    reportVersion: 1,
    generatedAt: (options.now || new Date()).toISOString(),
    mode: apply ? 'APPLY' : 'DRY_RUN',
    environment: options.environment?.trim() || null,
    databaseName,
    scannedRuleCount: rules.length,
    alreadyBoundRuleCount: plan.alreadyBoundRuleCount,
    uniqueMatchCount: plan.updates.length,
    appliedRuleCount,
    manualReviewCount: plan.manualReview.length,
    plannedUpdates: plan.updates,
    manualReview: plan.manualReview,
    safety: {
      existingAgencyIdsOverwritten: 0,
      rulesDeleted: 0,
      commissionRecordsDeleted: 0,
      financeSummariesDeleted: 0,
    },
  };
}

function parseArgs(argv: string[]) {
  const options: {
    apply: boolean;
    backupConfirmed: boolean;
    environment?: string;
    expectedDatabase?: string;
    reportPath?: string;
    help: boolean;
  } = { apply: false, backupConfirmed: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--confirmed-backup') options.backupConfirmed = true;
    else if (arg === '--environment') options.environment = argv[++index];
    else if (arg === '--database') options.expectedDatabase = argv[++index];
    else if (arg === '--report') options.reportPath = argv[++index];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`
旅行社返点历史规则 agencyId 安全回填

默认 dry-run（零写入）：
  npm run backfill:agency-rebate-rule-agency-ids -- --environment staging --database jiangjiu --report .tmp/agency-rebate-backfill.json

确认目标环境并完成可恢复备份后才可 apply：
  npm run backfill:agency-rebate-rule-agency-ids -- --apply --environment staging --database jiangjiu --confirmed-backup --report .tmp/agency-rebate-backfill-applied.json

参数：
  --dry-run             只扫描和输出报告（默认）
  --apply               执行唯一匹配项回填
  --environment <name>  目标环境标识；apply 必填
  --database <name>     预期数据库名；apply 必须与实际连接一致
  --confirmed-backup    确认已完成可恢复备份；apply 必填
  --report <path>       可选，将完整人工处理清单写入 JSON
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const prisma = new PrismaClient();
  try {
    const report = await backfillAgencyRebateRuleAgencyIds(prisma, {
      apply: args.apply,
      environment: args.environment,
      expectedDatabase: args.expectedDatabase,
      backupConfirmed: args.backupConfirmed,
    });
    const output = `${JSON.stringify(report, null, 2)}\n`;
    console.log(output);
    if (args.reportPath) {
      const reportPath = resolve(args.reportPath);
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(reportPath, output, 'utf8');
      console.log(`报告已写入：${reportPath}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
