import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const columns = await prisma.$queryRawUnsafe<any[]>(
    `SELECT column_name AS columnName
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'sales_orders'
        AND column_name = 'workflow_status'`,
  );
  const workflowStatusAvailable = columns.length > 0;
  const workflowFilter = workflowStatusAvailable
    ? "AND (so.workflow_status IS NULL OR so.workflow_status IN ('approved', 'completed'))"
    : '';
  const [counts] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT
       COUNT(*) AS orderCount,
       SUM(so.sales_user_id IS NULL) AS missingSalesUserCount,
       SUM(
         so.outreach_user_id IS NULL AND EXISTS (
           SELECT 1 FROM commission_rules cr
            WHERE cr.is_active = 1
              AND cr.target_type = 'outreach_commission'
              AND cr.effective_from <= so.order_date
              AND (cr.effective_to IS NULL OR cr.effective_to >= so.order_date)
         )
       ) AS missingOutreachUserCount,
       SUM(
         so.sales_user_id IS NOT NULL
         AND su.leader_id IS NULL
         AND EXISTS (
           SELECT 1 FROM commission_rules cr
            WHERE cr.is_active = 1
              AND cr.target_type = 'leader_commission'
              AND cr.effective_from <= so.order_date
              AND (cr.effective_to IS NULL OR cr.effective_to >= so.order_date)
         )
       ) AS missingLeaderCount
     FROM sales_orders so
     LEFT JOIN users su ON su.id = so.sales_user_id
     WHERE so.order_type <> 'buyback'
       AND so.status IN ('valid', 'partial_refund')
       ${workflowFilter}`,
  );
  const migrationRows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT migration_name AS migrationName, finished_at AS finishedAt,
            rolled_back_at AS rolledBackAt
       FROM _prisma_migrations
      WHERE migration_name = '20260729000200_special_orders_workflow'`,
  );
  const requiredMigrationApplied = migrationRows.some(
    (row) => row.finishedAt && !row.rolledBackAt,
  );
  const failedMigrations = await prisma.$queryRawUnsafe<any[]>(
    `SELECT migration_name AS migrationName
       FROM _prisma_migrations
      WHERE finished_at IS NULL AND rolled_back_at IS NULL
      ORDER BY started_at ASC`,
  );
  const output = {
    readOnly: true,
    database: process.env.DATABASE_URL ? 'configured' : 'missing DATABASE_URL',
    workflowStatusAvailable,
    requiredMigrationApplied,
    failedMigrations: failedMigrations.map((row) => row.migrationName),
    orderCount: Number(counts?.orderCount || 0),
    missingSalesUserCount: Number(counts?.missingSalesUserCount || 0),
    missingOutreachUserCount: Number(counts?.missingOutreachUserCount || 0),
    missingLeaderCount: Number(counts?.missingLeaderCount || 0),
    warnings: [
      ...(!workflowStatusAvailable
        ? [
            'workflow_status is unavailable; the preflight excluded no pending/rejected special orders. Deploy all Prisma migrations before repair.',
          ]
        : []),
      ...(!requiredMigrationApplied
        ? ['Required migration 20260729000200_special_orders_workflow is not applied.']
        : []),
      ...(failedMigrations.length > 0
        ? ['Prisma has an unresolved failed migration; do not run assignment repair.']
        : []),
    ],
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
