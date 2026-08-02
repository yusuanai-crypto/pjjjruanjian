import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

const ORDER_LEVEL_TARGETS = [
  'OUTREACH_COMMISSION',
  'LEADER_COMMISSION',
] as const;

type BackfillOptions = { apply?: boolean; now?: Date };

export async function backfillOrderLevelCommissions(
  prisma: any,
  options: BackfillOptions = {},
) {
  const apply = options.apply === true;
  const now = options.now || new Date();
  const records = await prisma.commissionRecord.findMany({
    where: {
      manualInput: false,
      isActive: true,
      salesOrderId: { not: null },
      targetType: { in: [...ORDER_LEVEL_TARGETS] },
    },
    select: {
      id: true,
      salesOrderId: true,
      targetType: true,
      targetUserId: true,
      automaticScopeKey: true,
      amountCents: true,
      sourceSnapshot: true,
      createdAt: true,
      salesOrder: { select: { orderNo: true } },
    },
    orderBy: [{ salesOrderId: 'asc' }, { targetType: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
  const groups = groupByScope(records);
  const affectedOrders = new Set<string>();
  const duplicateRecords: any[] = [];
  const amountDifferences: any[] = [];
  let affectedScopeCount = 0;
  let appliedScopeCount = 0;

  for (const values of groups.values()) {
    const canonical = chooseCanonical(values);
    const scopeKey = automaticScopeKey(canonical);
    const duplicates = values.filter((record) => record.id !== canonical.id);
    const activeTotalCents = values.reduce(
      (sum, record) => sum + integerCents(record.amountCents),
      0,
    );
    const canonicalAmountCents = integerCents(canonical.amountCents);
    const needsChange =
      duplicates.length > 0 ||
      canonical.targetUserId != null ||
      canonical.automaticScopeKey !== scopeKey ||
      !hasCanonicalMigrationAudit(canonical.sourceSnapshot, scopeKey);
    if (!needsChange) continue;
    affectedScopeCount += 1;
    affectedOrders.add(String(canonical.salesOrderId));
    for (const duplicate of duplicates) {
      duplicateRecords.push({
        salesOrderId: String(canonical.salesOrderId),
        orderNo: String(canonical.salesOrder?.orderNo || ''),
        targetType: String(canonical.targetType),
        canonicalRecordId: String(canonical.id),
        duplicateRecordId: String(duplicate.id),
        duplicateAmountCents: integerCents(duplicate.amountCents),
      });
    }
    if (activeTotalCents !== canonicalAmountCents) {
      amountDifferences.push({
        salesOrderId: String(canonical.salesOrderId),
        orderNo: String(canonical.salesOrder?.orderNo || ''),
        targetType: String(canonical.targetType),
        activeRecordCount: values.length,
        activeTotalCents,
        canonicalAmountCents,
        differenceCents: activeTotalCents - canonicalAmountCents,
      });
    }
    if (!apply) continue;
    await prisma.$transaction(async (tx: any) => {
      const current = await tx.commissionRecord.findMany({
        where: {
          salesOrderId: canonical.salesOrderId,
          targetType: canonical.targetType,
          manualInput: false,
          isActive: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      if (current.length === 0) return;
      const currentCanonical = chooseCanonical(current);
      for (const duplicate of current.filter(
        (record: any) => record.id !== currentCanonical.id,
      )) {
        await tx.commissionRecord.update({
          where: { id: duplicate.id },
          data: {
            automaticScopeKey: null,
            isActive: false,
            deactivatedAt: now,
            sourceSnapshot: withMigrationAudit(
              duplicate.sourceSnapshot,
              now,
              scopeKey,
              currentCanonical.id,
              'duplicate_deactivated',
            ),
            updatedAt: now,
          },
        });
      }
      await tx.commissionRecord.update({
        where: { id: currentCanonical.id },
        data: {
          targetUserId: null,
          automaticScopeKey: scopeKey,
          isActive: true,
          deactivatedAt: null,
          sourceSnapshot: withMigrationAudit(
            currentCanonical.sourceSnapshot,
            now,
            scopeKey,
            currentCanonical.id,
            'canonicalized_order_level_accrual',
          ),
          updatedAt: now,
        },
      });
    });
    appliedScopeCount += 1;
  }

  return {
    reportVersion: 1,
    generatedAt: now.toISOString(),
    mode: apply ? 'APPLY' : 'DRY_RUN',
    scannedRecordCount: records.length,
    affectedScopeCount,
    affectedOrderCount: affectedOrders.size,
    appliedScopeCount,
    affectedOrderIds: [...affectedOrders].sort(),
    duplicateRecords,
    amountDifferences,
    rollback:
      '应用回滚只需停止写入 automatic_scope_key；数据库字段与已失效历史记录应保留。若业务确认需要恢复单条旧记录，请依据 sourceSnapshot.orderLevelCommissionMigration 审计信息人工恢复 is_active，禁止批量删除或覆盖金额。',
  };
}

function groupByScope(records: any[]) {
  const result = new Map<string, any[]>();
  for (const record of records) {
    const key = `${record.salesOrderId}\u0000${record.targetType}`;
    result.set(key, [...(result.get(key) || []), record]);
  }
  return result;
}

function chooseCanonical(records: any[]) {
  return (
    records.find((record) => record.automaticScopeKey) ||
    records.find((record) => record.targetUserId == null) ||
    records[0]
  );
}

function automaticScopeKey(record: any) {
  return `sales-order:${record.salesOrderId}:${record.targetType}:automatic`;
}

function withMigrationAudit(
  snapshot: any,
  migratedAt: Date,
  scopeKey: string,
  canonicalRecordId: string,
  action: string,
) {
  return {
    ...(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? snapshot
      : { previousSourceSnapshot: snapshot ?? null }),
    orderLevelCommissionMigration: {
      version: 1,
      migratedAt: migratedAt.toISOString(),
      scopeKey,
      canonicalRecordId,
      action,
    },
  };
}

function hasCanonicalMigrationAudit(snapshot: any, scopeKey: string) {
  const audit = snapshot?.orderLevelCommissionMigration;
  return (
    audit?.version === 1 &&
    audit?.scopeKey === scopeKey &&
    audit?.action === 'canonicalized_order_level_accrual'
  );
}

function integerCents(value: unknown) {
  const numberValue = Number(value || 0);
  if (!Number.isSafeInteger(numberValue)) {
    throw new TypeError('amountCents must be a safe integer.');
  }
  return numberValue;
}

function parseArgs(args: string[]) {
  const apply = args.includes('--apply');
  const unknown = args.filter(
    (arg) => !['--apply', '--dry-run', '--help', '-h'].includes(arg),
  );
  if (unknown.length > 0) throw new Error(`Unknown option: ${unknown[0]}`);
  return { apply, help: args.includes('--help') || args.includes('-h') };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      'Usage: npm run backfill:order-level-commissions -- [--dry-run|--apply]\n',
    );
    return;
  }
  const prisma = new PrismaClient();
  try {
    const report = await backfillOrderLevelCommissions(prisma, options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
