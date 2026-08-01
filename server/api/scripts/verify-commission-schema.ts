import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT
       EXISTS(
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = DATABASE()
            AND table_name = 'sales_orders'
            AND column_name = 'workflow_status'
       ) AS workflowStatusAvailable,
       EXISTS(
         SELECT 1 FROM _prisma_migrations
          WHERE migration_name = '20260729000200_special_orders_workflow'
            AND finished_at IS NOT NULL
            AND rolled_back_at IS NULL
       ) AS requiredMigrationApplied,
       (
         SELECT COUNT(*) FROM _prisma_migrations
          WHERE finished_at IS NULL AND rolled_back_at IS NULL
       ) AS failedMigrationCount`,
  );
  const status = rows[0] || {};
  if (
    Number(status.workflowStatusAvailable) !== 1 ||
    Number(status.requiredMigrationApplied) !== 1 ||
    Number(status.failedMigrationCount) !== 0
  ) {
    throw new Error(
      'Commission schema precheck failed: deploy all Prisma migrations, including 20260729000200_special_orders_workflow, before starting the API.',
    );
  }
  process.stdout.write('Commission schema precheck passed.\n');
}

main()
  .catch((error) => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
