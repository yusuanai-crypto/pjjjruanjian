const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildSalesOrderNoPrefix,
  generateOrderNo,
  generateSalesOrderNo,
  withGeneratedSalesOrderNo,
} = require('../src/modules/business-data/sales-order-no.helper');

test('unit: sales order number formats orderDate as SOyyyyMMddNNN', async () => {
  const delegate = createOrderNoDelegate([]);

  assert.equal(buildSalesOrderNoPrefix('2026-06-29'), 'SO20260629');
  assert.equal(await generateSalesOrderNo(delegate, '2026-06-29'), 'SO20260629001');
  assert.equal(await generateSalesOrderNo(delegate, new Date('2026-06-30T00:00:00.000Z')), 'SO20260630001');
});

test('unit: special order numbers reuse the generator with a type marker', async () => {
  const delegate = createOrderNoDelegate([]);

  assert.equal(buildSalesOrderNoPrefix('2026-08-01', 'INTERNAL'), 'SOI20260801');
  assert.equal(buildSalesOrderNoPrefix('2026-08-01', 'EXTERNAL'), 'SOE20260801');
  assert.equal(buildSalesOrderNoPrefix('2026-08-01', 'BUYBACK'), 'SOB20260801');
  assert.equal(
    await generateSalesOrderNo(delegate, '2026-08-01', 'INTERNAL'),
    'SOI20260801001',
  );
});

test('unit: sales order number increments independently for different order dates', async () => {
  const delegate = createOrderNoDelegate([
    'SO20260629001',
    'SO20260629002',
    'SO20260630001',
  ]);

  assert.equal(await generateSalesOrderNo(delegate, '2026-06-29'), 'SO20260629003');
  assert.equal(await generateSalesOrderNo(delegate, '2026-06-30'), 'SO20260630002');
  assert.equal(await generateSalesOrderNo(delegate, '2026-07-01'), 'SO20260701001');
});

test('unit: sales order number uses max existing serial and ignores legacy numbers', async () => {
  const delegate = createOrderNoDelegate([
    'SO-20260629-999',
    'SO20260629001',
    'SO20260629009',
    'SO20260629010',
    'SO20260629ABC',
    'SO20260630099',
  ]);

  assert.equal(await generateSalesOrderNo(delegate, '2026-06-29'), 'SO20260629011');
});

test('unit: generateOrderNo compatibility alias uses the date-based helper', async () => {
  const delegate = createOrderNoDelegate(['SO20260629001']);

  assert.equal(await generateOrderNo(delegate, '2026-06-29'), 'SO20260629002');
});

test('unit: sales order number helper retries once after unique orderNo conflict', async () => {
  const delegate = createOrderNoDelegate(['SO20260629001']);
  const attempts = [];

  const created = await withGeneratedSalesOrderNo(delegate, '2026-06-29', async (orderNo, attempt) => {
    attempts.push(orderNo);
    if (attempt === 0) {
      delegate.insert(orderNo);
      const error = new Error('Unique constraint failed on orderNo');
      error.code = 'P2002';
      error.meta = {
        target: ['orderNo'],
      };
      throw error;
    }
    delegate.insert(orderNo);
    return {
      orderNo,
    };
  });

  assert.deepEqual(attempts, ['SO20260629002', 'SO20260629003']);
  assert.deepEqual(created, {
    orderNo: 'SO20260629003',
  });
});

test('unit: sales order number helper retries for database order_no unique target', async () => {
  const delegate = createOrderNoDelegate(['SO20260629001']);
  const attempts = [];

  const created = await withGeneratedSalesOrderNo(delegate, '2026-06-29', async (orderNo, attempt) => {
    attempts.push(orderNo);
    if (attempt === 0) {
      delegate.insert(orderNo);
      const error = new Error('Unique constraint failed on order_no');
      error.code = 'P2002';
      error.meta = {
        target: ['order_no'],
      };
      throw error;
    }
    return {
      orderNo,
    };
  });

  assert.deepEqual(attempts, ['SO20260629002', 'SO20260629003']);
  assert.deepEqual(created, {
    orderNo: 'SO20260629003',
  });
});

test('unit: sales order number helper does not retry unrelated errors', async () => {
  const delegate = createOrderNoDelegate([]);
  let attempts = 0;

  await assert.rejects(
    () =>
      withGeneratedSalesOrderNo(delegate, '2026-06-29', async () => {
        attempts += 1;
        throw new Error('database is unavailable');
      }),
    /database is unavailable/,
  );
  assert.equal(attempts, 1);
});

function createOrderNoDelegate(initialOrderNos) {
  const orderNos = [...initialOrderNos];
  return {
    async findMany({ where }) {
      const prefix = where.orderNo.startsWith;
      return orderNos
        .filter((orderNo) => orderNo.startsWith(prefix))
        .sort()
        .reverse()
        .map((orderNo) => ({ orderNo }));
    },
    insert(orderNo) {
      orderNos.push(orderNo);
    },
  };
}
