const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const prismaDir = path.resolve(__dirname, '..', 'prisma');
const schema = fs.readFileSync(path.join(prismaDir, 'schema.prisma'), 'utf8');
const migration = fs.readFileSync(
  path.join(
    prismaDir,
    'migrations',
    '20260729000100_sales_order_payment_details',
    'migration.sql',
  ),
  'utf8',
);
const seed = fs.readFileSync(path.join(prismaDir, 'seed.ts'), 'utf8');

function prismaBlock(header) {
  const start = schema.indexOf(header);
  assert.notEqual(start, -1, `${header} should exist`);
  const end = schema.indexOf('\n}', start);
  assert.notEqual(end, -1, `${header} should be closed`);
  return schema.slice(start, end + 2);
}

test('payment models expose categories, snapshots, signed cents, audit relations, and lock state', () => {
  const category = prismaBlock('enum PaymentMethodCategory');
  const user = prismaBlock('model User');
  const order = prismaBlock('model SalesOrder');
  const method = prismaBlock('model PaymentMethod');
  const detail = prismaBlock('model SalesOrderPaymentDetail');
  const orderStatus = prismaBlock('enum SalesOrderStatus');

  assert.match(category, /\bDIRECT_RECEIPT\b/);
  assert.match(category, /\bCOLLECT_ON_DELIVERY\b/);
  assert.doesNotMatch(category, /\bAGENCY_COLLECTION\b/);

  for (const field of [
    'code',
    'name',
    'category',
    'isActive',
    'isDefault',
    'sortOrder',
    'createdById',
    'updatedById',
    'createdAt',
    'updatedAt',
  ]) {
    assert.match(method, new RegExp(`\\b${field}\\b`));
  }
  assert.match(method, /name\s+String\s+@unique/);
  assert.match(method, /@relation\("PaymentMethodCreatedBy"/);
  assert.match(method, /@relation\("PaymentMethodUpdatedBy"/);

  for (const field of [
    'salesOrderId',
    'paymentMethodId',
    'paymentMethodNameSnapshot',
    'paymentMethodCategorySnapshot',
    'amountCents',
    'sortOrder',
    'collectionConfirmed',
    'collectionConfirmedById',
    'collectionConfirmedAt',
  ]) {
    assert.match(detail, new RegExp(`\\b${field}\\b`));
  }
  assert.match(detail, /amountCents\s+Int\b/);
  assert.match(detail, /collectionConfirmed\s+Boolean\s+@default\(false\)/);
  assert.match(
    detail,
    /@relation\("SalesOrderPaymentDetailCollectionConfirmedBy"/,
  );
  assert.doesNotMatch(
    detail,
    /@@unique\(\[\s*salesOrderId\s*,\s*paymentMethodId\s*\]\)/,
  );

  for (const field of [
    'cashOnDeliveryAmountCents',
    'completedAt',
    'completedById',
    'paymentDetailsLocked',
    'paymentDetailsLockedAt',
    'paymentDetailsLockedById',
    'paymentDetailsUnlockedAt',
    'paymentDetailsUnlockedById',
  ]) {
    assert.match(order, new RegExp(`\\b${field}\\b`));
  }
  assert.match(order, /paymentDetailsLocked\s+Boolean\s+@default\(false\)/);
  assert.match(order, /@relation\("SalesOrderCompletedBy"/);
  assert.match(order, /@relation\("SalesOrderPaymentDetailsLockedBy"/);
  assert.match(order, /@relation\("SalesOrderPaymentDetailsUnlockedBy"/);
  assert.doesNotMatch(orderStatus, /\bCOMPLETED\b/);

  for (const relation of [
    'SalesOrderCompletedBy',
    'SalesOrderPaymentDetailsLockedBy',
    'SalesOrderPaymentDetailsUnlockedBy',
    'PaymentMethodCreatedBy',
    'PaymentMethodUpdatedBy',
    'SalesOrderPaymentDetailCollectionConfirmedBy',
  ]) {
    assert.match(user, new RegExp(`@relation\\("${relation}"\\)`));
  }
});

test('production migration initializes six stable methods and preserves repeated methods', () => {
  const expectedMethods = [
    ['shouqianba', '收钱吧'],
    ['boc_pos', '中行POS机'],
    ['ceb_pos', '光大POS机'],
    ['cash', '现金'],
    ['cash_on_delivery', '货到付款'],
    ['bank_transfer', '转账'],
  ];

  for (const [code, name] of expectedMethods) {
    assert.match(migration, new RegExp(`'${code}', '${name}'`));
  }
  assert.match(
    migration,
    /'shouqianba', '收钱吧', 'direct_receipt', true, 10, true/,
  );
  assert.match(
    migration,
    /'cash_on_delivery', '货到付款', 'collect_on_delivery'/,
  );
  assert.match(
    migration,
    /`category` ENUM\('direct_receipt', 'collect_on_delivery'\)/,
  );
  assert.match(
    migration,
    /UNIQUE INDEX `payment_methods_name_key`\(`name`\)/,
  );
  assert.doesNotMatch(
    migration,
    /UNIQUE(?:\s+INDEX)?[^;\n]*sales_order_id[^;\n]*payment_method_id/i,
  );
  assert.doesNotMatch(migration, /`amount_cents`[^,\n]*UNSIGNED/i);
});

test('production migration backfills every old order with a default row and adds COD only when non-zero', () => {
  const paymentDetailInserts = migration
    .split(';')
    .filter(
      (statement) =>
        statement.includes('INSERT INTO `sales_order_payment_details`') &&
        statement.includes('FROM `sales_orders`'),
    );
  assert.equal(paymentDetailInserts.length, 2);

  const directBackfill = paymentDetailInserts.find((statement) =>
    statement.includes(
      "'00000000-0000-4000-8000-000000000001'",
    ),
  );
  const codBackfill = paymentDetailInserts.find((statement) =>
    statement.includes(
      "'00000000-0000-4000-8000-000000000005'",
    ),
  );
  assert.ok(directBackfill);
  assert.ok(codBackfill);
  assert.match(
    directBackfill,
    /`total_amount_cents` - `cash_on_delivery_amount_cents`/,
  );
  assert.doesNotMatch(directBackfill, /\bWHERE\b/i);
  assert.match(
    codBackfill,
    /WHERE `cash_on_delivery_amount_cents` <> 0/,
  );
  assert.match(codBackfill, /'货到付款'[\s\S]*'collect_on_delivery'/);

  for (const foreignKey of [
    'sales_orders_completed_by_id_fkey',
    'sales_orders_payment_details_locked_by_id_fkey',
    'sales_orders_payment_details_unlocked_by_id_fkey',
    'payment_methods_created_by_id_fkey',
    'payment_methods_updated_by_id_fkey',
    'sales_order_payment_details_collection_confirmed_by_id_fkey',
  ]) {
    assert.match(migration, new RegExp(foreignKey));
  }
});

test('development seed idempotently upserts the same six methods and mirrors migration backfill semantics', () => {
  for (const code of [
    'shouqianba',
    'boc_pos',
    'ceb_pos',
    'cash',
    'cash_on_delivery',
    'bank_transfer',
  ]) {
    assert.match(seed, new RegExp(`code: '${code}'`));
  }
  assert.match(seed, /category: 'COLLECT_ON_DELIVERY'/);
  assert.match(seed, /await prisma\.paymentMethod\.upsert\(/);
  assert.match(seed, /where:\s*\{\s*code: method\.code/);
  assert.match(
    seed,
    /await upsertInitialPaymentMethods\(admin\.id, now\);[\s\S]*if \(!seedConfig\.createDemoUsers\)/,
  );
  assert.match(
    seed,
    /const details = \[\s*\{[\s\S]*paymentMethodNameSnapshot: '收钱吧'/,
  );
  assert.match(
    seed,
    /if \(cashOnDeliveryAmountCents !== 0\)[\s\S]*paymentMethodNameSnapshot: '货到付款'/,
  );
});
