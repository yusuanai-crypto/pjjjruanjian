const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAfterSalesNoPrefix,
  generateAfterSalesNo,
  withGeneratedAfterSalesNo,
} = require('../src/modules/business-data/after-sales-order-no.helper');

test('unit: after-sales number formats createdAt as ASyyyyMMddNNN', async () => {
  const delegate = createAfterSalesNoDelegate([]);

  assert.equal(buildAfterSalesNoPrefix('2026-07-02'), 'AS20260702');
  assert.equal(await generateAfterSalesNo(delegate, '2026-07-02'), 'AS20260702001');
  assert.equal(
    await generateAfterSalesNo(
      delegate,
      new Date('2026-07-03T00:00:00.000Z'),
    ),
    'AS20260703001',
  );
});

test('unit: after-sales number can use current date when createdAt is omitted', async () => {
  const delegate = createAfterSalesNoDelegate([]);
  const todayPrefix = buildAfterSalesNoPrefix(new Date());

  assert.equal(await generateAfterSalesNo(delegate), `${todayPrefix}001`);
});

test('unit: after-sales number uses the Asia/Shanghai business date', () => {
  assert.equal(
    buildAfterSalesNoPrefix(new Date('2026-07-02T15:59:59.000Z')),
    'AS20260702',
  );
  assert.equal(
    buildAfterSalesNoPrefix(new Date('2026-07-02T16:00:00.000Z')),
    'AS20260703',
  );
});

test('unit: after-sales number increments independently for different dates', async () => {
  const delegate = createAfterSalesNoDelegate([
    'AS20260702001',
    'AS20260702002',
    'AS20260703001',
  ]);

  assert.equal(await generateAfterSalesNo(delegate, '2026-07-02'), 'AS20260702003');
  assert.equal(await generateAfterSalesNo(delegate, '2026-07-03'), 'AS20260703002');
  assert.equal(await generateAfterSalesNo(delegate, '2026-07-04'), 'AS20260704001');
});

test('unit: after-sales number uses max existing serial and ignores legacy numbers', async () => {
  const delegate = createAfterSalesNoDelegate([
    'AS-20260702-999',
    'AS20260702001',
    'AS20260702009',
    'AS20260702010',
    'AS20260702ABC',
    'AS20260703099',
  ]);

  assert.equal(await generateAfterSalesNo(delegate, '2026-07-02'), 'AS20260702011');
});

test('unit: after-sales number is unique across after-sales and sales-order tables', async () => {
  const afterSalesDelegate = createAfterSalesNoDelegate(['AS20260702001']);
  const salesOrderDelegate = createSalesOrderNoDelegate([
    'AS20260702002',
    'AS20260702007',
  ]);

  assert.equal(
    await generateAfterSalesNo(
      afterSalesDelegate,
      '2026-07-02',
      salesOrderDelegate,
    ),
    'AS20260702008',
  );
});

test('unit: after-sales number helper retries once after unique afterSalesNo conflict', async () => {
  const delegate = createAfterSalesNoDelegate(['AS20260702001']);
  const attempts = [];

  const created = await withGeneratedAfterSalesNo(
    delegate,
    '2026-07-02',
    async (afterSalesNo, attempt) => {
      attempts.push(afterSalesNo);
      if (attempt === 0) {
        delegate.insert(afterSalesNo);
        const error = new Error('Unique constraint failed on afterSalesNo');
        error.code = 'P2002';
        error.meta = {
          target: ['afterSalesNo'],
        };
        throw error;
      }
      delegate.insert(afterSalesNo);
      return {
        afterSalesNo,
      };
    },
  );

  assert.deepEqual(attempts, ['AS20260702002', 'AS20260702003']);
  assert.deepEqual(created, {
    afterSalesNo: 'AS20260702003',
  });
});

test('unit: after-sales number helper retries for database after_sales_no unique target', async () => {
  const delegate = createAfterSalesNoDelegate(['AS20260702001']);
  const attempts = [];

  const created = await withGeneratedAfterSalesNo(
    delegate,
    '2026-07-02',
    async (afterSalesNo, attempt) => {
      attempts.push(afterSalesNo);
      if (attempt === 0) {
        delegate.insert(afterSalesNo);
        const error = new Error('Unique constraint failed on after_sales_no');
        error.code = 'P2002';
        error.meta = {
          target: ['after_sales_no'],
        };
        throw error;
      }
      return {
        afterSalesNo,
      };
    },
  );

  assert.deepEqual(attempts, ['AS20260702002', 'AS20260702003']);
  assert.deepEqual(created, {
    afterSalesNo: 'AS20260702003',
  });
});

test('unit: after-sales number helper does not retry unrelated errors', async () => {
  const delegate = createAfterSalesNoDelegate([]);
  let attempts = 0;

  await assert.rejects(
    () =>
      withGeneratedAfterSalesNo(delegate, '2026-07-02', async () => {
        attempts += 1;
        throw new Error('database is unavailable');
      }),
    /database is unavailable/,
  );
  assert.equal(attempts, 1);
});

function createAfterSalesNoDelegate(initialAfterSalesNos) {
  const afterSalesNos = [...initialAfterSalesNos];
  return {
    async findMany({ where }) {
      const prefix = where.afterSalesNo.startsWith;
      return afterSalesNos
        .filter((afterSalesNo) => afterSalesNo.startsWith(prefix))
        .sort()
        .reverse()
        .map((afterSalesNo) => ({ afterSalesNo }));
    },
    insert(afterSalesNo) {
      afterSalesNos.push(afterSalesNo);
    },
  };
}

function createSalesOrderNoDelegate(initialOrderNos) {
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
  };
}
