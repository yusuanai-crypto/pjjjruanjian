const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const apiRoot = path.resolve(__dirname, '..');

test('special-order schema is additive, workflow-specific, and indexed', () => {
  const schema = fs.readFileSync(
    path.join(apiRoot, 'prisma', 'schema.prisma'),
    'utf8',
  );

  for (const token of [
    'enum SpecialOrderWorkflowStatus',
    'model SpecialOrderWorkflowEvent',
    'model SpecialOrderAttachment',
    'model SpecialOrderSettlement',
    'model SpecialOrderPayment',
    'workflowStatus',
    'workflowVersion',
    'warehouseId',
    'listUnitPriceCents',
    'adjustmentReason',
    'inventoryCondition',
    'sales_orders_special_creator_type_status_idx',
  ]) {
    assert.equal(schema.includes(token), true, token);
  }
});

test('special-order migration does not guess a historical workflow status', () => {
  const migration = fs.readFileSync(
    path.join(
      apiRoot,
      'prisma',
      'migrations',
      '20260729000200_special_orders_workflow',
      'migration.sql',
    ),
    'utf8',
  );

  assert.match(
    migration,
    /ADD COLUMN `workflow_status`[\s\S]* NULL/,
  );
  assert.equal(/\bUPDATE\s+`?sales_orders`?/i.test(migration), false);
  assert.equal(/\bINSERT\s+INTO\s+`?sales_orders`?/i.test(migration), false);
  assert.match(
    migration,
    /CREATE TRIGGER `special_order_workflow_events_no_update`/,
  );
  assert.match(
    migration,
    /CREATE TRIGGER `special_order_workflow_events_no_delete`/,
  );
});

test('payment and special-order migrations use the RDS collation', () => {
  const paymentMigration = fs.readFileSync(
    path.join(
      apiRoot,
      'prisma',
      'migrations',
      '20260729000100_sales_order_payment_details',
      'migration.sql',
    ),
    'utf8',
  );
  const specialOrderMigration = fs.readFileSync(
    path.join(
      apiRoot,
      'prisma',
      'migrations',
      '20260729000200_special_orders_workflow',
      'migration.sql',
    ),
    'utf8',
  );

  assert.doesNotMatch(paymentMigration, /utf8mb4_unicode_ci/);
  assert.doesNotMatch(specialOrderMigration, /utf8mb4_unicode_ci/);
  assert.match(paymentMigration, /COLLATE utf8mb4_0900_ai_ci/);
  assert.match(specialOrderMigration, /COLLATE utf8mb4_0900_ai_ci/);
});

test('special-order CHECK columns use restrictive foreign-key actions', () => {
  const migration = fs.readFileSync(
    path.join(
      apiRoot,
      'prisma',
      'migrations',
      '20260729000200_special_orders_workflow',
      'migration.sql',
    ),
    'utf8',
  );

  assert.match(
    migration,
    /DROP FOREIGN KEY `sales_orders_customer_id_fkey`[\s\S]*FOREIGN KEY \(`customer_id`\)[\s\S]*ON DELETE RESTRICT ON UPDATE RESTRICT/,
  );
  assert.match(
    migration,
    /DROP FOREIGN KEY `sales_orders_source_sales_order_id_fkey`[\s\S]*FOREIGN KEY \(`source_sales_order_id`\)[\s\S]*ON DELETE RESTRICT ON UPDATE RESTRICT/,
  );
  assert.match(
    migration,
    /DROP FOREIGN KEY `sales_orders_source_sales_order_id_fkey`;\s+ALTER TABLE `sales_orders`\s+ADD CONSTRAINT `sales_orders_customer_id_fkey`/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \(`internal_employee_id`\)[^\n]*ON DELETE RESTRICT ON UPDATE RESTRICT/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \(`sales_order_id`\) REFERENCES `sales_orders`\(`id`\) ON DELETE RESTRICT ON UPDATE RESTRICT/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \(`reversed_by_id`\)[^\n]*ON DELETE RESTRICT ON UPDATE RESTRICT/,
  );
});
