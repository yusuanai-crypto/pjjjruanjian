const assert = require('node:assert/strict');
const test = require('node:test');

const {
  backfillSalesOrderCustomers,
} = require('../scripts/backfill-sales-order-customers');

test('sales order customer backfill creates customers and links old orders idempotently', async () => {
  const originalSnapshotName = 'Alice Snapshot';
  const { prisma, db } = createBackfillPrisma({
    orders: [
      createOrder({
        id: 'order_phone_1',
        customerName: originalSnapshotName,
        customerPhone: '138-0000-0001',
        province: 'P1',
        city: 'C1',
        district: 'D1',
        address: 'Address 1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      }),
      createOrder({
        id: 'order_phone_2',
        customerName: ' Alice Snapshot ',
        customerPhone: '13800000001',
        province: 'P2',
        city: 'C2',
        district: 'D2',
        address: 'Address 2',
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-04T00:00:00.000Z',
      }),
      createOrder({
        id: 'order_address_1',
        customerName: 'Bob Snapshot',
        customerPhone: null,
        province: 'P3',
        city: 'C3',
        district: 'D3',
        address: 'Address 3',
      }),
      createOrder({
        id: 'order_address_2',
        customerName: 'Bob Snapshot',
        customerPhone: '',
        province: 'P3',
        city: 'C3',
        district: 'D3',
        address: 'Address 3',
      }),
      createOrder({
        id: 'order_missing_address',
        customerName: 'No Address Snapshot',
        customerPhone: null,
        address: null,
      }),
    ],
  });

  const dryRunReport = await backfillSalesOrderCustomers(prisma);
  assert.equal(dryRunReport.dryRun, true);
  assert.equal(dryRunReport.ordersScanned, 5);
  assert.equal(dryRunReport.groupsPrepared, 2);
  assert.equal(dryRunReport.customersToCreate, 2);
  assert.equal(dryRunReport.customersCreated, 0);
  assert.equal(dryRunReport.ordersToLink, 4);
  assert.equal(dryRunReport.ordersLinked, 0);
  assert.equal(dryRunReport.groupsSkippedMissingAddress, 1);
  assert.equal(db.customers.length, 0);
  assert.equal(findOrder(db, 'order_phone_1').customerId, null);

  const applyReport = await backfillSalesOrderCustomers(prisma, {
    apply: true,
  });
  assert.equal(applyReport.dryRun, false);
  assert.equal(applyReport.customersToCreate, 2);
  assert.equal(applyReport.customersCreated, 2);
  assert.equal(applyReport.ordersToLink, 4);
  assert.equal(applyReport.ordersLinked, 4);
  assert.equal(db.customers.length, 2);

  const phoneCustomerId = findOrder(db, 'order_phone_1').customerId;
  assert.equal(findOrder(db, 'order_phone_2').customerId, phoneCustomerId);
  assert.equal(findOrder(db, 'order_phone_1').customerName, originalSnapshotName);
  const phoneCustomer = db.customers.find((customer) => customer.id === phoneCustomerId);
  assert.equal(phoneCustomer.phone, '13800000001');
  assert.equal(phoneCustomer.address, 'Address 2');
  assert.equal(phoneCustomer.financeMark, false);
  assert.equal(phoneCustomer.markedById, null);
  assert.equal(phoneCustomer.markedAt, null);

  const addressCustomerId = findOrder(db, 'order_address_1').customerId;
  assert.equal(findOrder(db, 'order_address_2').customerId, addressCustomerId);
  const addressCustomer = db.customers.find(
    (customer) => customer.id === addressCustomerId,
  );
  assert.equal(addressCustomer.name, 'Bob Snapshot');
  assert.equal(addressCustomer.phone, null);
  assert.equal(addressCustomer.financeMark, false);

  const repeatReport = await backfillSalesOrderCustomers(prisma, {
    apply: true,
  });
  assert.equal(repeatReport.customersCreated, 0);
  assert.equal(repeatReport.ordersLinked, 0);
  assert.equal(db.customers.length, 2);
});

test('sales order customer backfill reuses a single existing matching customer', async () => {
  const { prisma, db } = createBackfillPrisma({
    customers: [
      {
        id: 'customer_existing',
        name: 'Existing Snapshot',
        phone: '13900000001',
        province: null,
        city: null,
        district: null,
        address: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
    orders: [
      createOrder({
        id: 'order_reuse_existing',
        customerName: 'Existing Snapshot',
        customerPhone: '139 0000 0001',
      }),
    ],
  });

  const report = await backfillSalesOrderCustomers(prisma, {
    apply: true,
  });
  assert.equal(report.customersToCreate, 0);
  assert.equal(report.customersCreated, 0);
  assert.equal(report.customersReused, 1);
  assert.equal(report.ordersLinked, 1);
  assert.equal(db.customers.length, 1);
  assert.equal(findOrder(db, 'order_reuse_existing').customerId, 'customer_existing');
});

function createBackfillPrisma({ orders = [], customers = [] } = {}) {
  const db = {
    orders: orders.map(copyRow),
    customers: customers.map(copyRow),
  };

  const prisma = {
    $transaction: async (callback) => {
      const snapshot = {
        orders: db.orders.map(copyRow),
        customers: db.customers.map(copyRow),
      };
      try {
        return await callback(prisma);
      } catch (error) {
        db.orders.splice(0, db.orders.length, ...snapshot.orders);
        db.customers.splice(0, db.customers.length, ...snapshot.customers);
        throw error;
      }
    },
    salesOrder: {
      findMany: async ({ where } = {}) => {
        return db.orders
          .filter((order) => {
            if (!where || !Object.hasOwn(where, 'customerId')) {
              return true;
            }
            return (order.customerId ?? null) === where.customerId;
          })
          .sort(compareCreatedAt)
          .map(copyRow);
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const order of db.orders) {
          if (
            order.id === where.id &&
            (order.customerId ?? null) === where.customerId
          ) {
            Object.assign(order, data);
            count += 1;
          }
        }
        return {
          count,
        };
      },
    },
    customer: {
      findMany: async () => db.customers.sort(compareCreatedAt).map(copyRow),
      create: async ({ data }) => {
        if (db.customers.some((customer) => customer.id === data.id)) {
          throw new Error('Duplicate customer id in test fixture.');
        }
        const row = {
          ...data,
          createdAt: data.createdAt || new Date(),
          updatedAt: data.updatedAt || new Date(),
        };
        db.customers.push(row);
        return copyRow(row);
      },
    },
  };

  return {
    prisma,
    db,
  };
}

function createOrder(overrides = {}) {
  return {
    id: overrides.id,
    customerId: overrides.customerId ?? null,
    customerName: overrides.customerName || 'Customer Snapshot',
    customerPhone: Object.hasOwn(overrides, 'customerPhone')
      ? overrides.customerPhone
      : '13800000000',
    province: overrides.province ?? null,
    city: overrides.city ?? null,
    district: overrides.district ?? null,
    address: overrides.address ?? null,
    createdById: overrides.createdById ?? 'user_creator',
    updatedById: overrides.updatedById ?? 'user_updater',
    salesUserId: overrides.salesUserId ?? 'user_sales',
    createdAt: new Date(overrides.createdAt || '2026-01-01T00:00:00.000Z'),
    updatedAt: new Date(overrides.updatedAt || '2026-01-01T00:00:00.000Z'),
  };
}

function findOrder(db, id) {
  return db.orders.find((order) => order.id === id);
}

function copyRow(row) {
  return {
    ...row,
  };
}

function compareCreatedAt(left, right) {
  return (
    Number(new Date(left.createdAt)) - Number(new Date(right.createdAt)) ||
    String(left.id).localeCompare(String(right.id))
  );
}
