const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const prismaDir = path.resolve(__dirname, '..', 'prisma');
const schemaPath = path.join(prismaDir, 'schema.prisma');
const migrationDir = path.join(
  prismaDir,
  'migrations',
  '20260711000100_stage10_product_cost_schema',
);
const migrationPath = path.join(migrationDir, 'migration.sql');

function readSchema() {
  return fs.readFileSync(schemaPath, 'utf8');
}

function readMigration() {
  return fs.readFileSync(migrationPath, 'utf8');
}

function extractModel(source, name) {
  const header = `model ${name} {`;
  const start = source.indexOf(header);
  assert.notEqual(start, -1, `${header} should exist`);
  const end = source.indexOf('\n}', start);
  assert.notEqual(end, -1, `${header} should close`);
  return source.slice(start, end + 2);
}

function assertProductRelation(block, modelName) {
  assert.match(
    block,
    new RegExp(
      `product\\s+Product\\?\\s+@relation\\(fields: \\[productId\\], references: \\[id\\], onDelete: SetNull\\)`,
    ),
    `${modelName} should use a nullable Product relation with SetNull`,
  );
}

test('schema: stage 10 product and actual cost models expose required fields', () => {
  const schema = readSchema();
  const product = extractModel(schema, 'Product');
  const actualCost = extractModel(schema, 'ProductActualCost');
  const user = extractModel(schema, 'User');

  assert.match(product, /id\s+String\s+@id\s+@default\(uuid\(\)\)\s+@db\.Char\(36\)/);
  assert.match(product, /name\s+String\s+@unique\s+@db\.VarChar\(160\)/);
  assert.match(
    product,
    /normalizedName\s+String\s+@unique\s+@map\("normalized_name"\)\s+@db\.VarChar\(160\)/,
  );
  assert.match(product, /unit\s+String\s+@db\.VarChar\(20\)/);
  assert.match(product, /isActive\s+Boolean\s+@default\(true\)\s+@map\("is_active"\)/);
  assert.match(product, /notes\s+String\?\s+@db\.Text/);
  assert.match(product, /createdById\s+String\?/);
  assert.match(product, /updatedById\s+String\?/);
  assert.match(product, /createdAt\s+DateTime\s+@default\(now\(\)\)/);
  assert.match(product, /updatedAt\s+DateTime\s+@updatedAt/);
  assert.doesNotMatch(product, /\bsortOrder\b/);
  assert.match(product, /actualCosts\s+ProductActualCost\[\]/);
  assert.match(product, /@@index\(\[isActive\]\)/);
  assert.match(product, /@@index\(\[unit\]\)/);

  assert.match(actualCost, /id\s+String\s+@id\s+@default\(uuid\(\)\)\s+@db\.Char\(36\)/);
  assert.match(actualCost, /productId\s+String\s+@map\("product_id"\)\s+@db\.Char\(36\)/);
  assert.match(actualCost, /costCents\s+Int\s+@map\("cost_cents"\)/);
  assert.match(actualCost, /effectiveFrom\s+DateTime\s+@map\("effective_from"\)\s+@db\.Date/);
  assert.match(actualCost, /effectiveTo\s+DateTime\?\s+@map\("effective_to"\)\s+@db\.Date/);
  assert.match(actualCost, /isActive\s+Boolean\s+@default\(true\)\s+@map\("is_active"\)/);
  assert.match(actualCost, /notes\s+String\?\s+@db\.Text/);
  assert.match(actualCost, /createdById\s+String\?/);
  assert.match(actualCost, /updatedById\s+String\?/);
  assert.match(actualCost, /createdAt\s+DateTime\s+@default\(now\(\)\)/);
  assert.match(actualCost, /updatedAt\s+DateTime\s+@updatedAt/);
  assert.match(
    actualCost,
    /product\s+Product\s+@relation\(fields: \[productId\], references: \[id\], onDelete: Restrict\)/,
  );
  assert.match(actualCost, /@@index\(\[productId, isActive, effectiveFrom\]\)/);
  assert.match(actualCost, /@@index\(\[productId, isActive, effectiveTo\]\)/);

  for (const field of [
    'createdProducts',
    'updatedProducts',
    'createdProductActualCosts',
    'updatedProductActualCosts',
  ]) {
    assert.match(user, new RegExp(`\\b${field}\\b`));
  }
});

test('schema: existing product references remain nullable historical links with SetNull', () => {
  const schema = readSchema();

  for (const modelName of [
    'SalesOrderItem',
    'TravelGroupTastingItem',
    'SalesDeductionRule',
    'AgencyDeductionRule',
  ]) {
    const block = extractModel(schema, modelName);
    assert.match(
      block,
      /productId\s+String\?\s+@map\("product_id"\)\s+@db\.Char\(36\)/,
    );
    assert.match(block, /productName\s+String/);
    assertProductRelation(block, modelName);
    assert.match(block, /@@index\(\[productId\]\)/);
  }
});

test('schema: sales order actual cost fields are nullable historical snapshots', () => {
  const salesOrderItem = extractModel(readSchema(), 'SalesOrderItem');

  assert.match(salesOrderItem, /unit\s+String\?\s+@db\.VarChar\(20\)/);
  assert.match(
    salesOrderItem,
    /actualUnitCostCents\s+Int\?\s+@map\("actual_unit_cost_cents"\)/,
  );
  assert.match(
    salesOrderItem,
    /actualCostSubtotalCents\s+Int\?\s+@map\("actual_cost_subtotal_cents"\)/,
  );
  assert.match(
    salesOrderItem,
    /grossProfitCents\s+Int\?\s+@map\("gross_profit_cents"\)/,
  );
});

test('migration: creates stage 10 tables, constraints, indexes and SetNull foreign keys', () => {
  assert.equal(fs.existsSync(migrationPath), true);
  const migration = readMigration();

  assert.match(migration, /CREATE TABLE `products`/);
  assert.match(migration, /CREATE TABLE `product_actual_costs`/);
  assert.match(migration, /`name` VARCHAR\(160\) NOT NULL/);
  assert.match(migration, /`normalized_name` VARCHAR\(160\) NOT NULL/);
  assert.match(migration, /UNIQUE INDEX `products_name_key`\(`name`\)/);
  assert.match(
    migration,
    /UNIQUE INDEX `products_normalized_name_key`\(`normalized_name`\)/,
  );
  assert.match(migration, /products_name_trim_chk/);
  assert.match(migration, /product_actual_costs_cost_non_negative_chk/);
  assert.match(migration, /product_actual_costs_date_range_chk/);

  for (const table of [
    'sales_order_items',
    'travel_group_tasting_items',
    'sales_deduction_rules',
    'agency_deduction_rules',
  ]) {
    const tick = String.fromCharCode(96);
    assert.match(
      migration,
      new RegExp(
        `ALTER TABLE ${tick}${table}${tick}[\\s\\S]*?ADD COLUMN ${tick}product_id${tick} CHAR\\(36\\) NULL`,
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `${tick}${table}_product_id_fkey${tick}[\\s\\S]*?ON DELETE SET NULL`,
      ),
    );
  }

  for (const column of [
    'unit',
    'actual_unit_cost_cents',
    'actual_cost_subtotal_cents',
    'gross_profit_cents',
  ]) {
    assert.match(
      migration,
      new RegExp(
        `ADD COLUMN ${String.fromCharCode(96)}${column}${String.fromCharCode(96)} [^\\n]+ NULL`,
      ),
    );
  }

  assert.match(migration, /product_actual_costs_no_active_overlap_insert/);
  assert.match(migration, /product_actual_costs_no_active_overlap_update/);
  assert.match(migration, /SIGNAL SQLSTATE '45000'/);
  assert.match(migration, /existing\.`product_id` = NEW\.`product_id`/);
  assert.match(migration, /existing\.`is_active` = 1/);
  assert.match(migration, /COALESCE\(existing\.`effective_to`, '9999-12-31'\)/);

  assert.doesNotMatch(migration, /^\s*(UPDATE|DELETE|DROP)\s+/im);
  assert.doesNotMatch(
    migration,
    /ADD COLUMN `(?:actual_unit_cost_cents|actual_cost_subtotal_cents|gross_profit_cents)` INTEGER NOT NULL/,
  );
});
