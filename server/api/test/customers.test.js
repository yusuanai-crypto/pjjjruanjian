const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  createUser,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

test('contract: customer APIs enforce permissions, scope, finance marks, and global filtering', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const missingToken = await requestJson(baseUrl, '/api/customers');
      assertErrorContract(missingToken, 401, 'AUTH_TOKEN_REQUIRED');

      const admin = await login(baseUrl);
      const sales = await login(baseUrl, 'customer-sales', 'Password123');
      const otherSales = await login(baseUrl, 'customer-other-sales', 'Password123');

      await createUser(baseUrl, admin.token, {
        name: 'Customer Finance',
        username: 'customer-finance',
        password: 'Password123',
        role: 'finance',
      });
      await createUser(baseUrl, admin.token, {
        name: 'Customer After Sales',
        username: 'customer-after-sales',
        password: 'Password123',
        role: 'after_sales',
      });
      await createUser(baseUrl, admin.token, {
        name: 'Customer Boss',
        username: 'customer-boss',
        password: 'Password123',
        role: 'boss',
      });
      await createUser(baseUrl, admin.token, {
        name: 'Customer Front Desk',
        username: 'customer-front-desk',
        password: 'Password123',
        role: 'front_desk',
      });
      await createUser(baseUrl, admin.token, {
        name: 'Customer Warehouse',
        username: 'customer-warehouse',
        password: 'Password123',
        role: 'warehouse',
      });
      await createUser(baseUrl, admin.token, {
        name: 'Customer Taster',
        username: 'customer-taster',
        password: 'Password123',
        role: 'taster',
      });

      const finance = await login(baseUrl, 'customer-finance', 'Password123');
      const afterSales = await login(baseUrl, 'customer-after-sales', 'Password123');
      const boss = await login(baseUrl, 'customer-boss', 'Password123');
      const frontDesk = await login(baseUrl, 'customer-front-desk', 'Password123');
      const warehouse = await login(baseUrl, 'customer-warehouse', 'Password123');
      const taster = await login(baseUrl, 'customer-taster', 'Password123');

      for (const blocked of [warehouse, taster]) {
        const list = await requestJson(baseUrl, '/api/customers', {
          token: blocked.token,
        });
        assertErrorContract(list, 403, 'PERMISSION_DENIED');
      }

      const created = await requestJson(baseUrl, '/api/customers', {
        method: 'POST',
        token: sales.token,
        body: {
          name: 'Test Customer Created By Sales',
          phone: '13700000001',
          province: 'Guizhou',
          city: 'Guiyang',
          district: 'Nanming',
          address: 'Sales Test Address 1',
          notes: 'test customer created by sales',
        },
      });
      assert.equal(created.response.status, 201);
      assertCustomerContract(created.body.data.customer);
      assert.equal(created.body.data.customer.financeMark, false);
      assert.equal(created.body.data.customer.createdById, sales.user.id);

      const afterSalesCreated = await requestJson(baseUrl, '/api/customers', {
        method: 'POST',
        token: afterSales.token,
        body: {
          name: 'Test Customer Created By After Sales',
          phone: '13700000002',
          notes: 'test customer created by after sales',
        },
      });
      assert.equal(afterSalesCreated.response.status, 201);

      const financeCreate = await requestJson(baseUrl, '/api/customers', {
        method: 'POST',
        token: finance.token,
        body: {
          name: 'Finance Cannot Create',
        },
      });
      assertErrorContract(financeCreate, 403, 'PERMISSION_DENIED');

      const salesList = await requestJson(baseUrl, '/api/customers', {
        token: sales.token,
      });
      assert.equal(salesList.response.status, 200);
      assert.deepEqual(customerNames(salesList.body.data.customers), [
        'Seed Related Customer',
        'Test Customer Created By Sales',
      ]);
      for (const customer of salesList.body.data.customers) {
        assertCustomerContract(customer);
        assert.equal('recentOrders' in customer, false);
      }

      const otherSalesList = await requestJson(baseUrl, '/api/customers', {
        token: otherSales.token,
      });
      assert.equal(otherSalesList.response.status, 200);
      assert.deepEqual(customerNames(otherSalesList.body.data.customers), [
        'Seed Hidden Customer',
      ]);

      const adminKeywordList = await requestJson(
        baseUrl,
        '/api/customers?keyword=Marked',
        {
          token: admin.token,
        },
      );
      assert.equal(adminKeywordList.response.status, 200);
      assert.deepEqual(customerNames(adminKeywordList.body.data.customers), [
        'Seed Marked Customer',
      ]);

      const adminQueryList = await requestJson(
        baseUrl,
        '/api/customers?query=After%20Sales',
        {
          token: admin.token,
        },
      );
      assert.equal(adminQueryList.response.status, 200);
      assert.deepEqual(customerNames(adminQueryList.body.data.customers), [
        'Test Customer Created By After Sales',
      ]);

      const phoneList = await requestJson(
        baseUrl,
        '/api/customers?phone=13900000002',
        {
          token: admin.token,
        },
      );
      assert.equal(phoneList.response.status, 200);
      assert.deepEqual(customerNames(phoneList.body.data.customers), [
        'Seed Marked Customer',
      ]);

      const markedList = await requestJson(
        baseUrl,
        '/api/customers?financeMark=true',
        {
          token: admin.token,
        },
      );
      assert.equal(markedList.response.status, 200);
      assert.deepEqual(customerNames(markedList.body.data.customers), [
        'Seed Marked Customer',
      ]);

      const limitedList = await requestJson(baseUrl, '/api/customers?limit=1', {
        token: admin.token,
      });
      assert.equal(limitedList.response.status, 200);
      assert.equal(limitedList.body.data.customers.length, 1);

      const detail = await requestJson(baseUrl, '/api/customers/cust_related', {
        token: admin.token,
      });
      assert.equal(detail.response.status, 200);
      assertCustomerContract(detail.body.data.customer, true);
      assert.equal(detail.body.data.customer.recentOrders.length, 1);
      assertOrderSummaryContract(detail.body.data.customer.recentOrders[0]);
      assert.equal(detail.body.data.customer.recentOrders[0].orderNo, 'SO-CUST-RELATED');
      assert.equal(detail.body.data.customer.recentOrders[0].packingStatus, 'pending');
      assert.equal(
        detail.body.data.customer.recentOrders[0]
          .cashOnDeliveryAmountCents,
        2500,
      );
      assert.equal(
        detail.body.data.customer.recentOrders[0].tasterCommissionCents,
        4500,
      );
      assert.deepEqual(
        detail.body.data.customer.recentOrders[0].tasterCommission,
        {
          recordId: 'cr_customer_order_taster',
          amountCents: 4500,
          isConfirmed: false,
          confirmedById: null,
          confirmedByName: null,
          confirmedAt: null,
        },
      );

      const salesDetail = await requestJson(baseUrl, '/api/customers/cust_related', {
        token: sales.token,
      });
      assert.equal(salesDetail.response.status, 200);
      assert.equal(salesDetail.body.data.customer.recentOrders.length, 1);

      const salesBlockedDetail = await requestJson(
        baseUrl,
        '/api/customers/cust_hidden',
        {
          token: sales.token,
        },
      );
      assertErrorContract(salesBlockedDetail, 404, 'CUSTOMER_NOT_FOUND');

      const updated = await requestJson(
        baseUrl,
        `/api/customers/${created.body.data.customer.id}`,
        {
          method: 'PATCH',
          token: sales.token,
          body: {
            city: 'Zunyi',
            notes: 'updated by sales test',
          },
        },
      );
      assert.equal(updated.response.status, 200);
      assert.equal(updated.body.data.customer.city, 'Zunyi');
      assert.equal(updated.body.data.customer.notes, 'updated by sales test');
      assert.equal(updated.body.data.customer.updatedById, sales.user.id);

      const bossPatch = await requestJson(
        baseUrl,
        `/api/customers/${created.body.data.customer.id}`,
        {
          method: 'PATCH',
          token: boss.token,
          body: {
            notes: 'boss cannot patch',
          },
        },
      );
      assertErrorContract(bossPatch, 403, 'PERMISSION_DENIED');

      const financeMarkViaBasePatch = await requestJson(
        baseUrl,
        `/api/customers/${created.body.data.customer.id}`,
        {
          method: 'PATCH',
          token: admin.token,
          body: {
            financeMark: true,
          },
        },
      );
      assertErrorContract(financeMarkViaBasePatch, 403, 'FIELD_PERMISSION_DENIED');

      const marked = await requestJson(
        baseUrl,
        `/api/customers/${created.body.data.customer.id}/finance-mark`,
        {
          method: 'PATCH',
          token: finance.token,
          body: {
            financeMark: true,
          },
        },
      );
      assert.equal(marked.response.status, 200);
      assert.equal(marked.body.data.customer.financeMark, true);
      assert.equal(marked.body.data.customer.markedById, finance.user.id);
      assert.equal(typeof marked.body.data.customer.markedAt, 'string');
      const markedAt = marked.body.data.customer.markedAt;

      const updatedAfterMark = await requestJson(
        baseUrl,
        `/api/customers/${created.body.data.customer.id}`,
        {
          method: 'PATCH',
          token: finance.token,
          body: {
            notes: 'updated after customer finance mark',
          },
        },
      );
      assert.equal(updatedAfterMark.response.status, 200);
      assert.equal(updatedAfterMark.body.data.customer.financeMark, true);
      assert.equal(updatedAfterMark.body.data.customer.markedById, finance.user.id);
      assert.equal(updatedAfterMark.body.data.customer.markedAt, markedAt);

      for (const blocked of [boss, frontDesk, sales, warehouse, afterSales, taster]) {
        const blockedMark = await requestJson(
          baseUrl,
          `/api/customers/${created.body.data.customer.id}/finance-mark`,
          {
            method: 'PATCH',
            token: blocked.token,
            body: {
              financeMark: false,
            },
          },
        );
        assertErrorContract(blockedMark, 403, 'PERMISSION_DENIED');
      }

      const unmarked = await requestJson(
        baseUrl,
        `/api/customers/${created.body.data.customer.id}/finance-mark`,
        {
          method: 'PATCH',
          token: admin.token,
          body: {
            financeMark: false,
          },
        },
      );
      assert.equal(unmarked.response.status, 200);
      assert.equal(unmarked.body.data.customer.financeMark, false);
      assert.equal(unmarked.body.data.customer.markedById, admin.user.id);
      assert.equal(typeof unmarked.body.data.customer.markedAt, 'string');
      assert.equal(unmarked.body.data.customer.markedAt >= markedAt, true);

      const unmarkedList = await requestJson(
        baseUrl,
        '/api/customers?financeMark=false',
        {
          token: admin.token,
        },
      );
      assert.equal(unmarkedList.response.status, 200);
      const unmarkedListedCustomer = unmarkedList.body.data.customers.find(
        (customer) => customer.id === created.body.data.customer.id,
      );
      assert.ok(unmarkedListedCustomer);
      assert.equal(unmarkedListedCustomer.financeMark, false);
      assert.equal(unmarkedListedCustomer.markedById, admin.user.id);

      const warehouseCreate = await requestJson(baseUrl, '/api/customers', {
        method: 'POST',
        token: warehouse.token,
        body: {
          name: 'Warehouse Cannot Create',
        },
      });
      assertErrorContract(warehouseCreate, 403, 'PERMISSION_DENIED');

      await requestJson(baseUrl, '/api/settings/global-mark-query/enable', {
        method: 'POST',
        token: admin.token,
      });

      const globalMarkedList = await requestJson(baseUrl, '/api/customers', {
        token: admin.token,
      });
      assert.equal(globalMarkedList.response.status, 200);
      assert.deepEqual(customerNames(globalMarkedList.body.data.customers), [
        'Seed Marked Customer',
      ]);

      const hiddenByGlobal = await requestJson(
        baseUrl,
        '/api/customers/cust_related',
        {
          token: admin.token,
        },
      );
      assertErrorContract(hiddenByGlobal, 404, 'CUSTOMER_NOT_FOUND');

      const visibleByGlobal = await requestJson(
        baseUrl,
        '/api/customers/cust_marked',
        {
          token: admin.token,
        },
      );
      assert.equal(visibleByGlobal.response.status, 200);
      assert.equal(visibleByGlobal.body.data.customer.financeMark, true);

      await requestJson(baseUrl, '/api/settings/global-mark-query/restore', {
        method: 'POST',
        token: admin.token,
      });

      const logs = await requestJson(
        baseUrl,
        '/api/operation-logs?entityType=customer',
        {
          token: admin.token,
        },
      );
      assert.equal(logs.response.status, 200);
      const writeActions = new Set([
        'customers.create',
        'customers.finance_mark.disable',
        'customers.finance_mark.enable',
        'customers.update',
      ]);
      const writeLogs = logs.body.data.logs.filter(
        (log) => log.result === 'SUCCESS' && writeActions.has(log.action),
      );
      const actions = writeLogs.map((log) => log.action).sort();
      assert.deepEqual(actions, [
        'customers.create',
        'customers.create',
        'customers.finance_mark.disable',
        'customers.finance_mark.enable',
        'customers.update',
        'customers.update',
      ]);
      assert.equal(
        logs.body.data.logs.some(
          (log) =>
            log.action === 'customers.list' && log.result === 'SUCCESS',
        ),
        true,
      );
      assert.equal(
        logs.body.data.logs.some((log) => log.result === 'FAILURE'),
        true,
      );
      const updateLogs = writeLogs.filter(
        (log) => log.action === 'customers.update',
      );
      assert.equal(updateLogs.length, 2);
      assert.equal(
        updateLogs.some(
          (log) =>
            log.beforeData.notes === 'test customer created by sales' &&
            log.afterData.notes === 'updated by sales test',
        ),
        true,
      );
      assert.equal(
        updateLogs.some(
          (log) =>
            log.beforeData.financeMark === true &&
            log.afterData.financeMark === true &&
            log.afterData.notes === 'updated after customer finance mark',
        ),
        true,
      );
      const markLog = logs.body.data.logs.find(
        (log) => log.action === 'customers.finance_mark.enable',
      );
      assert.equal(markLog.beforeData.financeMark, false);
      assert.equal(markLog.afterData.financeMark, true);
      const unmarkLog = logs.body.data.logs.find(
        (log) => log.action === 'customers.finance_mark.disable',
      );
      assert.equal(unmarkLog.beforeData.financeMark, true);
      assert.equal(unmarkLog.afterData.financeMark, false);
      assert.equal(unmarkLog.afterData.markedById, admin.user.id);
      assert.equal(typeof unmarkLog.afterData.markedAt, 'string');
    },
    {
      prisma: {
        users: [
          {
            id: 'usr_customer_sales',
            name: 'Customer Sales',
            username: 'customer-sales',
            password: 'Password123',
            role: 'sales',
          },
          {
            id: 'usr_customer_other_sales',
            name: 'Customer Other Sales',
            username: 'customer-other-sales',
            password: 'Password123',
            role: 'sales',
          },
          {
            id: 'usr_customer_order_taster',
            name: 'Customer Order Taster',
            username: 'customer-order-taster',
            password: 'Password123',
            role: 'taster',
          },
        ],
        travelGroups: [
          {
            id: 'tg_customer_related',
            groupNo: 'TG-CUSTOMER-RELATED',
            visitDate: '2026-06-24',
            tasterId: 'usr_customer_order_taster',
            tasterName: 'Customer Order Taster',
          },
        ],
        customers: [
          {
            id: 'cust_related',
            name: 'Seed Related Customer',
            phone: '13900000001',
            address: 'Related Seed Address',
            createdById: 'usr_admin',
          },
          {
            id: 'cust_marked',
            name: 'Seed Marked Customer',
            phone: '13900000002',
            address: 'Marked Seed Address',
            financeMark: true,
            markedById: 'usr_admin',
            markedAt: '2026-06-24T08:00:00.000Z',
            createdById: 'usr_admin',
          },
          {
            id: 'cust_hidden',
            name: 'Seed Hidden Customer',
            phone: '13900000003',
            address: 'Hidden Seed Address',
            createdById: 'usr_customer_other_sales',
          },
        ],
        salesOrders: [
          {
            id: 'ord_cust_related',
            orderNo: 'SO-CUST-RELATED',
            orderType: 'TRAVEL_GROUP',
            travelGroupId: 'tg_customer_related',
            customerId: 'cust_related',
            customerName: 'Seed Related Customer',
            customerPhone: '13900000001',
            orderDate: '2026-06-24',
            totalAmountCents: 12000,
            cashOnDeliveryAmountCents: 9999,
            paymentDetails: [
              {
                paymentMethodId:
                  '00000000-0000-4000-8000-000000000001',
                amountCents: 9500,
              },
              {
                paymentMethodId:
                  '00000000-0000-4000-8000-000000000005',
                amountCents: 2500,
              },
            ],
            packingStatus: 'PENDING',
            logisticsNo: 'TEST-LOGISTICS-001',
            salesUserId: 'usr_customer_sales',
            createdById: 'usr_admin',
          },
          {
            id: 'ord_cust_hidden',
            orderNo: 'SO-CUST-HIDDEN',
            orderType: 'TRAVEL_GROUP',
            customerId: 'cust_hidden',
            customerName: 'Seed Hidden Customer',
            customerPhone: '13900000003',
            orderDate: '2026-06-24',
            totalAmountCents: 8000,
            salesUserId: 'usr_customer_other_sales',
            createdById: 'usr_customer_other_sales',
          },
        ],
        commissionRecords: [
          {
            id: 'cr_customer_order_taster',
            salesOrderId: 'ord_cust_related',
            travelGroupId: 'tg_customer_related',
            targetType: 'TASTER_COMMISSION',
            targetUserId: 'usr_customer_order_taster',
            amountCents: 4500,
            manualInput: true,
          },
          {
            id: 'cr_customer_legacy_group_taster',
            salesOrderId: null,
            travelGroupId: 'tg_customer_related',
            targetType: 'TASTER_COMMISSION',
            targetUserId: 'usr_customer_order_taster',
            amountCents: 9999,
            manualInput: true,
          },
        ],
      },
    },
  );
});

function assertCustomerContract(customer, includeRecentOrders = false) {
  const keys = [
    'address',
    'city',
    'createdAt',
    'createdById',
    'district',
    'financeMark',
    'id',
    'markedAt',
    'markedById',
    'name',
    'notes',
    'phone',
    'province',
    'updatedAt',
    'updatedById',
  ];
  if (includeRecentOrders) {
    keys.push('recentOrders');
  }
  assert.deepEqual(Object.keys(customer).sort(), keys.sort());
  assert.equal(typeof customer.id, 'string');
  assert.equal(typeof customer.name, 'string');
  assert.equal(typeof customer.financeMark, 'boolean');
  assert.equal(typeof customer.createdAt, 'string');
  assert.equal(typeof customer.updatedAt, 'string');
  if (includeRecentOrders) {
    assert.equal(Array.isArray(customer.recentOrders), true);
  }
}

function assertOrderSummaryContract(order) {
  assert.deepEqual(Object.keys(order).sort(), [
    'cashOnDeliveryAmountCents',
    'createdAt',
    'customerName',
    'customerPhone',
    'deliverySummary',
    'financeMark',
    'id',
    'logisticsNo',
    'orderDate',
    'orderNo',
    'orderType',
    'packingStatus',
    'salesUserId',
    'status',
    'tasterCommission',
    'tasterCommissionCents',
    'totalAmountCents',
    'travelGroup',
    'travelGroupId',
    'updatedAt',
  ]);
  assert.equal(typeof order.id, 'string');
  assert.equal(typeof order.orderNo, 'string');
  assert.equal(typeof order.totalAmountCents, 'number');
  assert.equal(typeof order.financeMark, 'boolean');
}

function customerNames(customers) {
  return customers.map((customer) => customer.name).sort();
}
