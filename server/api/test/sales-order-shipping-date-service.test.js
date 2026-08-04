const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BusinessDataNestService,
} = require('../src/modules/business-data/business-data.nest.service');

function buildOrder(overrides = {}) {
  return {
    id: 'order-1',
    orderNo: 'SO-20260727-001',
    orderType: 'EXTERNAL',
    orderDate: new Date('2026-07-27T00:00:00.000Z'),
    shippingDateMode: 'SCHEDULED',
    shippingDate: new Date('2026-07-28T00:00:00.000Z'),
    shippingDateSource: 'SYSTEM_DEFAULT',
    shippingDateBackfillBatchId: null,
    createdAt: new Date('2026-07-27T04:00:00.000Z'),
    updatedAt: new Date('2026-07-27T04:00:00.000Z'),
    packingStatus: 'PENDING',
    status: 'PENDING_PAYMENT',
    salesUserId: 'sales-1',
    customerName: '测试客户',
    customerPhone: '13800000000',
    totalAmountCents: 10000,
    cashOnDeliveryAmountCents: 0,
    items: [],
    travelGroup: null,
    customer: null,
    financeMark: false,
    ...overrides,
  };
}

function buildService(order, options = {}) {
  const logs = [];
  const tx = {
    salesOrder: {
      async findUnique({ where }) {
        return where.id === order.id ? order : null;
      },
      async updateMany({ where, data }) {
        if (options.onUpdateMany) {
          return options.onUpdateMany({ order, where, data });
        }
        if (
          where.id !== order.id ||
          (where.packingStatus?.not === 'PACKED' &&
            order.packingStatus === 'PACKED')
        ) {
          return { count: 0 };
        }
        Object.assign(order, data);
        return { count: 1 };
      },
    },
  };
  const prisma = {
    ...tx,
    async $transaction(callback) {
      return callback(tx);
    },
  };
  const operationLogs = {
    async appendLog(entry) {
      logs.push({
        ...entry,
        createdAt: new Date(),
      });
    },
  };
  const settings = {
    async getGlobalMarkQuery() {
      return { onlyShowMarkedRecords: false };
    },
  };
  const service = new BusinessDataNestService(
    prisma,
    operationLogs,
    settings,
    {},
    {},
    {},
    {},
    {},
  );
  return { service, logs };
}

test('sales, finance, after-sales and warehouse can update before outbound and each change is audited', async () => {
  const order = buildOrder();
  const { service, logs } = buildService(order);
  const actors = [
    { id: 'sales-1', role: 'sales' },
    { id: 'finance-1', role: 'finance' },
    { id: 'after-sales-1', role: 'after_sales' },
    { id: 'warehouse-1', role: 'warehouse' },
  ];

  for (const [index, actor] of actors.entries()) {
    const shippingDate = `2026-08-0${index + 1}`;
    const result = await service.updateSalesOrderShippingDate(
      actor,
      order.id,
      {
        shippingDate,
        reason: `角色验证 ${actor.role}`,
      },
      { ipAddress: '127.0.0.1' },
    );
    assert.equal(result.shippingDate, shippingDate);
    assert.equal(result.canEditShippingDate, true);
  }

  assert.equal(logs.length, actors.length);
  for (const [index, log] of logs.entries()) {
    assert.equal(log.action, 'sales_orders.shipping_date.update');
    assert.equal(log.entityId, order.id);
    assert.equal(log.userId, actors[index].id);
    assert.equal(log.actorRoleSnapshot, actors[index].role);
    assert.equal(log.beforeData.orderNo, order.orderNo);
    assert.equal(log.afterData.orderNo, order.orderNo);
    assert.equal(log.beforeData.shippingDateMode, 'scheduled');
    assert.equal(log.afterData.shippingDateMode, 'scheduled');
    assert.equal(log.afterData.reason, `角色验证 ${actors[index].role}`);
    assert.ok(log.beforeData.shippingDate);
    assert.ok(log.afterData.shippingDate);
    assert.ok(log.createdAt instanceof Date);
  }
});

test('shipping mode switches in both directions, accepts a past date, and audits mode plus date', async () => {
  const order = buildOrder();
  const { service, logs } = buildService(order);
  const actor = { id: 'sales-1', role: 'sales' };

  const pending = await service.updateSalesOrderShippingDate(
    actor,
    order.id,
    {
      shippingDateMode: 'pending_customer_notice',
      reason: '等待客人确认',
    },
  );
  assert.equal(pending.shippingDateMode, 'pending_customer_notice');
  assert.equal(pending.shippingDate, null);
  assert.equal(order.shippingDateMode, 'PENDING_CUSTOMER_NOTICE');
  assert.equal(order.shippingDateSource, null);

  const scheduled = await service.updateSalesOrderShippingDate(
    actor,
    order.id,
    {
      shippingDateMode: 'scheduled',
      shippingDate: '2026-07-01',
      reason: '补录历史发货日期',
    },
  );
  assert.equal(scheduled.shippingDateMode, 'scheduled');
  assert.equal(scheduled.shippingDate, '2026-07-01');
  assert.equal(order.shippingDateMode, 'SCHEDULED');
  assert.equal(order.shippingDateSource, 'USER_SPECIFIED');

  assert.deepEqual(
    logs.map((log) => ({
      beforeMode: log.beforeData.shippingDateMode,
      beforeDate: log.beforeData.shippingDate,
      afterMode: log.afterData.shippingDateMode,
      afterDate: log.afterData.shippingDate,
    })),
    [
      {
        beforeMode: 'scheduled',
        beforeDate: '2026-07-28',
        afterMode: 'pending_customer_notice',
        afterDate: null,
      },
      {
        beforeMode: 'pending_customer_notice',
        beforeDate: null,
        afterMode: 'scheduled',
        afterDate: '2026-07-01',
      },
    ],
  );
});

test('an unrelated role cannot update the shipping date', async () => {
  const order = buildOrder();
  const { service, logs } = buildService(order);

  await assert.rejects(
    service.updateSalesOrderShippingDate(
      { id: 'boss-1', role: 'boss' },
      order.id,
      { shippingDate: '2026-08-01' },
    ),
    (error) =>
      error?.statusCode === 403 && error?.code === 'PERMISSION_DENIED',
  );
  assert.equal(logs.length, 0);
  assert.equal(order.shippingDate.toISOString().slice(0, 10), '2026-07-28');
});

test('an outbound order cannot be updated', async () => {
  const order = buildOrder({ packingStatus: 'PACKED' });
  const { service, logs } = buildService(order);

  await assert.rejects(
    service.updateSalesOrderShippingDate(
      { id: 'finance-1', role: 'finance' },
      order.id,
      { shippingDateMode: 'pending_customer_notice' },
    ),
    (error) =>
      error?.statusCode === 409 &&
      error?.code === 'SALES_ORDER_ALREADY_OUTBOUND' &&
      error?.message === '订单已出库，发货信息不可修改。',
  );
  assert.equal(logs.length, 0);
});

test('the conditional update prevents a shipping-date write that loses a race with outbound', async () => {
  const originalDate = new Date('2026-07-28T00:00:00.000Z');
  const order = buildOrder({ shippingDate: originalDate });
  const { service, logs } = buildService(order, {
    onUpdateMany: async () => {
      order.packingStatus = 'PACKED';
      return { count: 0 };
    },
  });

  await assert.rejects(
    service.updateSalesOrderShippingDate(
      { id: 'warehouse-1', role: 'warehouse' },
      order.id,
      { shippingDate: '2026-08-01' },
    ),
    (error) =>
      error?.statusCode === 409 &&
      error?.code === 'SALES_ORDER_ALREADY_OUTBOUND',
  );
  assert.equal(order.shippingDate, originalDate);
  assert.equal(logs.length, 0);
});
