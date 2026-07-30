const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const apiRoot = path.join(__dirname, '..');
const schema = fs.readFileSync(
  path.join(apiRoot, 'prisma', 'schema.prisma'),
  'utf8',
);
const migration = fs.readFileSync(
  path.join(
    apiRoot,
    'prisma',
    'migrations',
    '20260729000500_profit_tax_payment_service_fees',
    'migration.sql',
  ),
  'utf8',
);

test('schema: profit tax and payment service fee snapshots remain nullable and related', () => {
  const paymentMethod = prismaBlock('model PaymentMethod {');
  const salesOrder = prismaBlock('model SalesOrder {');
  const paymentDetail = prismaBlock(
    'model SalesOrderPaymentDetail {',
  );
  const afterSalesOrder = prismaBlock('model AfterSalesOrder {');

  assert.match(
    paymentMethod,
    /serviceFeeRate\s+Decimal\?\s+@map\("service_fee_rate"\)\s+@db\.Decimal\(10,\s*6\)/,
  );
  assert.match(
    salesOrder,
    /taxRateSnapshot\s+Decimal\?\s+@map\("tax_rate_snapshot"\)/,
  );
  assert.match(
    salesOrder,
    /profitFeeSnapshottedBy\s+User\?\s+@relation\("SalesOrderProfitFeeSnapshottedBy"/,
  );
  assert.match(
    paymentDetail,
    /serviceFeeRateSnapshot\s+Decimal\?/,
  );
  assert.match(
    paymentDetail,
    /serviceFeeBaseAmountSnapshotCents\s+Int\?/,
  );
  assert.match(
    afterSalesOrder,
    /refundPaymentDetail\s+SalesOrderPaymentDetail\?\s+@relation\("AfterSalesRefundPaymentDetail"[\s\S]*onDelete:\s*SetNull/,
  );
  assert.match(afterSalesOrder, /@@index\(\[refundPaymentDetailId\]\)/);
  assert.match(
    afterSalesOrder,
    /@@index\(\[salesOrderId,\s*financeConfirmed,\s*refundOccurredAt\]/,
  );
});

test('migration: fee data is expand-only and does not guess historical rates', () => {
  assert.match(
    migration,
    /ADD COLUMN `service_fee_rate` DECIMAL\(10,\s*6\) NULL/,
  );
  assert.match(
    migration,
    /ADD COLUMN `service_fee_rate_snapshot` DECIMAL\(10,\s*6\) NULL/,
  );
  assert.match(
    migration,
    /ADD COLUMN `service_fee_base_amount_snapshot_cents` INTEGER NULL/,
  );
  assert.match(
    migration,
    /after_sales_orders_refund_payment_detail_id_fkey/,
  );
  assert.doesNotMatch(migration, /^\s*UPDATE\s+/im);
  assert.doesNotMatch(
    migration,
    /service_fee_rate[^;\n]*(?:DEFAULT\s+0|SET\s+0)/i,
  );
});

function prismaBlock(start) {
  const startIndex = schema.indexOf(start);
  assert.notEqual(startIndex, -1, `${start} must exist`);
  const endIndex = schema.indexOf('\n}', startIndex);
  assert.notEqual(endIndex, -1, `${start} must end`);
  return schema.slice(startIndex, endIndex + 2);
}
