const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const prismaDir = path.resolve(__dirname, '..', 'prisma');
const migrationsDir = path.join(prismaDir, 'migrations');

function readPrismaFile(relativePath) {
  return fs.readFileSync(path.join(prismaDir, relativePath), 'utf8');
}

function readMigration(name) {
  return fs.readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8');
}

test('smoke: Prisma schema exposes phase 2 business models and scope fields', () => {
  const schema = readPrismaFile('schema.prisma');

  for (const model of [
    'TravelGroup',
    'GuideCarriedGroup',
    'PendingTravelGroup',
    'SalesOrder',
    'SalesOrderItem',
    'DailyReconciliation',
    'ReconciliationPaymentMethod',
    'StrikeBonusAward',
  ]) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
  }

  for (const field of [
    'tasterId',
    'salesUserId',
    'financeMark',
    'markedById',
    'markedAt',
    'refundsCents',
  ]) {
    assert.match(schema, new RegExp(`\\b${field}\\b`));
  }
});

test('smoke: phase 2 Prisma migrations create and evolve business tables', () => {
  assert.equal(fs.existsSync(path.join(migrationsDir, '20260623000100_business_data_mysql', 'migration.sql')), true);
  assert.equal(fs.existsSync(path.join(migrationsDir, '20260624000100_business_data_role_scopes', 'migration.sql')), true);
  assert.equal(fs.existsSync(path.join(migrationsDir, '20260624000200_business_data_finance_marks', 'migration.sql')), true);

  const businessDataMigration = readMigration('20260623000100_business_data_mysql');
  for (const table of [
    'travel_groups',
    'guide_carried_groups',
    'pending_travel_groups',
    'sales_orders',
    'sales_order_items',
    'daily_reconciliations',
    'reconciliation_payment_methods',
    'strike_bonus_awards',
  ]) {
    assert.match(businessDataMigration, new RegExp(`CREATE TABLE \`${table}\``));
  }

  const roleScopesMigration = readMigration('20260624000100_business_data_role_scopes');
  assert.match(roleScopesMigration, /ADD COLUMN `taster_id`/);
  assert.match(roleScopesMigration, /ADD COLUMN `sales_user_id`/);
  assert.match(roleScopesMigration, /sales_orders_sales_user_id_fkey/);

  const financeMarksMigration = readMigration('20260624000200_business_data_finance_marks');
  assert.match(financeMarksMigration, /ADD COLUMN `finance_mark`/);
  assert.match(financeMarksMigration, /ADD COLUMN `marked_by`/);
  assert.match(financeMarksMigration, /ADD COLUMN `marked_at`/);
  assert.match(financeMarksMigration, /sales_orders_marked_by_fkey/);
});
