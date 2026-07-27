const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SAME_DAY_SHIPPING_WARNING,
  formatDateOnly,
  isSameShanghaiNaturalDay,
  resolveSubmissionShippingDate,
} = require('../src/modules/business-data/sales-order-shipping-date.helper');
const {
  backfillSalesOrderShippingDates,
} = require('../scripts/backfill-sales-order-shipping-dates');

function resolve(payload, isoTimestamp) {
  return resolveSubmissionShippingDate(payload, new Date(isoTimestamp));
}

test('submission default is the next Shanghai natural day', () => {
  const result = resolve({}, '2026-07-27T04:00:00.000Z');

  assert.equal(formatDateOnly(result.shippingDate), '2026-07-28');
  assert.equal(result.source, 'SYSTEM_DEFAULT');
  assert.equal(result.manuallySpecified, false);
});

test('an untouched cross-day draft is recalculated from the actual submission day', () => {
  const result = resolve(
    {
      shippingDate: '2026-07-28',
      shippingDateManuallySpecified: false,
    },
    '2026-07-28T04:00:00.000Z',
  );

  assert.equal(formatDateOnly(result.shippingDate), '2026-07-29');
  assert.equal(result.source, 'SYSTEM_DEFAULT');
});

test('a manually selected future date is preserved', () => {
  const result = resolve(
    {
      shippingDate: '2026-08-15',
      shippingDateManuallySpecified: true,
    },
    '2026-07-27T04:00:00.000Z',
  );

  assert.equal(formatDateOnly(result.shippingDate), '2026-08-15');
  assert.equal(result.source, 'USER_SPECIFIED');
});

test('a manual date before the actual submission day is rejected', () => {
  assert.throws(
    () =>
      resolve(
        {
          shippingDate: '2026-07-27',
          shippingDateManuallySpecified: true,
        },
        '2026-07-27T16:30:00.000Z',
      ),
    (error) =>
      error?.statusCode === 400 &&
      error?.code === 'SHIPPING_DATE_BEFORE_SUBMISSION',
  );
});

test('same-day shipping is accepted and exposes the required warning text', () => {
  const result = resolve(
    {
      shippingDate: '2026-07-27',
      shippingDateManuallySpecified: true,
    },
    '2026-07-27T04:00:00.000Z',
  );

  assert.equal(formatDateOnly(result.shippingDate), '2026-07-27');
  assert.equal(
    isSameShanghaiNaturalDay(
      result.shippingDate,
      new Date('2026-07-27T04:00:00.000Z'),
    ),
    true,
  );
  assert.equal(
    SAME_DAY_SHIPPING_WARNING,
    '该订单计划当天发货，请确认仓库可及时处理。',
  );
});

test('Shanghai date arithmetic crosses month and year without skipping weekends', () => {
  const monthEnd = resolve({}, '2026-07-31T15:59:59.000Z');
  const yearEnd = resolve({}, '2026-12-31T15:59:59.000Z');
  const weekend = resolve({}, '2026-07-31T04:00:00.000Z');

  assert.equal(formatDateOnly(monthEnd.shippingDate), '2026-08-01');
  assert.equal(formatDateOnly(yearEnd.shippingDate), '2027-01-01');
  assert.equal(formatDateOnly(weekend.shippingDate), '2026-08-01');
});

test('historical backfill only fills null values and is repeatable', async () => {
  const rows = [
    {
      id: 'a',
      createdAt: new Date('2026-07-27T04:00:00.000Z'),
      shippingDate: null,
      shippingDateSource: null,
      shippingDateBackfillBatchId: null,
    },
    {
      id: 'b',
      createdAt: new Date('2026-07-27T04:00:00.000Z'),
      shippingDate: new Date('2026-08-20T00:00:00.000Z'),
      shippingDateSource: 'USER_SPECIFIED',
      shippingDateBackfillBatchId: null,
    },
  ];
  const prisma = {
    salesOrder: {
      async findMany({ where, take }) {
        return rows
          .filter(
            (row) =>
              row.shippingDate === null &&
              (!where.id?.gt || row.id > where.id.gt),
          )
          .sort((left, right) => left.id.localeCompare(right.id))
          .slice(0, take)
          .map(({ id, createdAt }) => ({ id, createdAt }));
      },
      async updateMany({ where, data }) {
        const row = rows.find(
          (candidate) =>
            candidate.id === where.id && candidate.shippingDate === null,
        );
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
  };

  const first = await backfillSalesOrderShippingDates(prisma, {
    batchId: 'shipping-date-test',
    batchSize: 1,
  });
  const second = await backfillSalesOrderShippingDates(prisma, {
    batchId: 'shipping-date-test-repeat',
    batchSize: 1,
  });

  assert.equal(first.updated, 1);
  assert.equal(second.updated, 0);
  assert.equal(formatDateOnly(rows[0].shippingDate), '2026-07-28');
  assert.equal(rows[0].shippingDateSource, 'MIGRATION');
  assert.equal(rows[0].shippingDateBackfillBatchId, 'shipping-date-test');
  assert.equal(formatDateOnly(rows[1].shippingDate), '2026-08-20');
  assert.equal(rows[1].shippingDateSource, 'USER_SPECIFIED');
});
