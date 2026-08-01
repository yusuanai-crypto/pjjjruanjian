import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

const REQUIRED_MIGRATIONS = [
  '20260727000100_guide_personal_points',
  '20260729000400_partial_personal_points_split',
] as const;

const REQUIRED_COLUMNS = [
  'sales_orders.personal_amount_cents',
  'after_sales_orders.personal_points_refund_amount_cents',
] as const;

const REQUIRED_CONSTRAINTS = [
  'sales_orders_personal_amount_bounds_chk',
  'sales_orders_points_destination_amount_chk',
  'after_sales_orders_personal_refund_bounds_chk',
  'sales_orders_personal_points_guide_id_fkey',
  'guide_points_summaries_group_guide_key',
  'guide_points_summaries_travel_group_id_fkey',
  'guide_points_summaries_guide_id_fkey',
] as const;

const REQUIRED_INDEXES = [
  'sales_orders_personal_amount_cents_idx',
  'after_sales_orders_personal_refund_idx',
] as const;

const ALTERNATIVE_PERSONAL_GROUP_INDEXES = [
  'sales_orders_travel_group_personal_amount_idx',
  'sales_orders_travel_group_id_personal_amount_cents_idx',
] as const;

type MigrationRow = {
  migrationName: string;
  finishedAt: Date | null;
  rolledBackAt: Date | null;
  appliedStepsCount: number;
  hasLogs: number | bigint;
};

type NamedRow = { name: string };
type ColumnRow = { tableName: string; columnName: string };

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }
  const parsedUrl = new URL(databaseUrl);
  const database = parsedUrl.pathname.replace(/^\//, '');
  if (parsedUrl.protocol !== 'mysql:' || !parsedUrl.hostname || !database) {
    throw new Error('DATABASE_URL must identify a MySQL database.');
  }

  const prisma = new PrismaClient();
  try {
    const migrations = await prisma.$queryRawUnsafe<MigrationRow[]>(`
      SELECT migration_name AS migrationName,
             finished_at AS finishedAt,
             rolled_back_at AS rolledBackAt,
             applied_steps_count AS appliedStepsCount,
             CASE WHEN logs IS NULL OR logs = '' THEN 0 ELSE 1 END AS hasLogs
      FROM _prisma_migrations
      WHERE migration_name IN (
        '20260727000100_guide_personal_points',
        '20260729000400_partial_personal_points_split'
      )
      ORDER BY migration_name
    `);
    const columns = await prisma.$queryRawUnsafe<ColumnRow[]>(`
      SELECT table_name AS tableName, column_name AS columnName
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND (
          (table_name = 'sales_orders'
            AND column_name = 'personal_amount_cents')
          OR
          (table_name = 'after_sales_orders'
            AND column_name = 'personal_points_refund_amount_cents')
        )
    `);
    const guideTables = await prisma.$queryRawUnsafe<NamedRow[]>(`
      SELECT table_name AS name
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = 'guide_points_summaries'
    `);
    const constraints = await prisma.$queryRawUnsafe<NamedRow[]>(`
      SELECT constraint_name AS name
      FROM information_schema.table_constraints
      WHERE constraint_schema = DATABASE()
        AND constraint_name IN (
          'sales_orders_personal_amount_bounds_chk',
          'sales_orders_points_destination_amount_chk',
          'after_sales_orders_personal_refund_bounds_chk',
          'sales_orders_personal_points_guide_id_fkey',
          'guide_points_summaries_group_guide_key',
          'guide_points_summaries_travel_group_id_fkey',
          'guide_points_summaries_guide_id_fkey'
        )
    `);
    const indexes = await prisma.$queryRawUnsafe<NamedRow[]>(`
      SELECT DISTINCT index_name AS name
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND index_name IN (
          'sales_orders_personal_amount_cents_idx',
          'sales_orders_travel_group_personal_amount_idx',
          'sales_orders_travel_group_id_personal_amount_cents_idx',
          'after_sales_orders_personal_refund_idx'
        )
    `);
    let prismaRuntimeProbe = 'ok';
    try {
      await prisma.salesOrder.findFirst({
        select: { personalAmountCents: true },
      });
    } catch (error) {
      prismaRuntimeProbe =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : 'UNKNOWN';
    }

    const migrationMap = new Map(
      migrations.map((row) => [row.migrationName, row]),
    );
    const columnNames = new Set(
      columns.map((row) => `${row.tableName}.${row.columnName}`),
    );
    const constraintNames = new Set(constraints.map((row) => row.name));
    const indexNames = new Set(indexes.map((row) => row.name));

    const missingMigrations = REQUIRED_MIGRATIONS.filter((name) => {
      const row = migrationMap.get(name);
      return !row || !row.finishedAt || row.rolledBackAt !== null;
    });
    const migrationsWithLogs = migrations
      .filter((row) => Number(row.hasLogs) !== 0)
      .map((row) => row.migrationName);
    const missingColumns = REQUIRED_COLUMNS.filter(
      (name) => !columnNames.has(name),
    );
    const missingConstraints = REQUIRED_CONSTRAINTS.filter(
      (name) => !constraintNames.has(name),
    );
    const missingIndexes: string[] = REQUIRED_INDEXES.filter(
      (name) => !indexNames.has(name),
    );
    if (
      !ALTERNATIVE_PERSONAL_GROUP_INDEXES.some((name) =>
        indexNames.has(name),
      )
    ) {
      missingIndexes.push('sales_orders.<travel_group_personal_amount_index>');
    }
    const guidePointsSummariesExists = guideTables.length === 1;
    const ok =
      missingMigrations.length === 0 &&
      missingColumns.length === 0 &&
      missingConstraints.length === 0 &&
      missingIndexes.length === 0 &&
      guidePointsSummariesExists &&
      prismaRuntimeProbe === 'ok';

    console.log(
      JSON.stringify(
        {
          target: {
            protocol: parsedUrl.protocol,
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || '3306',
            database,
          },
          migrations: migrations.map((row) => ({
            name: row.migrationName,
            finished: Boolean(row.finishedAt),
            rolledBack: Boolean(row.rolledBackAt),
            appliedStepsCount: Number(row.appliedStepsCount),
            hasLogs: Number(row.hasLogs) !== 0,
          })),
          guidePointsSummariesExists,
          missingMigrations,
          migrationsWithLogs,
          missingColumns,
          missingConstraints,
          missingIndexes,
          prismaRuntimeProbe,
          ok,
        },
        null,
        2,
      ),
    );
    if (!ok) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'SCHEMA_INSPECTION_FAILED';
  console.error(
    JSON.stringify({
      ok: false,
      code,
      message: 'Guide points schema inspection failed; inspect server logs by requestId.',
    }),
  );
  process.exitCode = 1;
});
