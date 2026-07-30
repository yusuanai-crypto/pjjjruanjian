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
