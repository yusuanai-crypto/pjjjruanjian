const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  assertErrorContract,
  assertOperationLogContract,
  login,
  requestJson,
  withNestApiServer,
} = require('./helpers/phase1-api');
const { getRoleMenus } = require('../src/modules/auth/roles');

const TEST_PASSWORD = 'Password123';

test('unit: finance role menu includes after-sales orders', () => {
  const financeMenuIds = getRoleMenus('finance').map((menu) => menu.id);
  assert.equal(financeMenuIds.includes('after_sales_orders'), true);
});

test('contract: after-sales order creation validates payload and writes an operation log', async () => {
  await withNestApiServer(async (baseUrl) => {
    const admin = await login(baseUrl, 'admin');
    const afterSales = await login(baseUrl, 'after_sales_user', TEST_PASSWORD);

    const created = await requestJson(baseUrl, '/api/after-sales-orders', {
      method: 'POST',
      token: afterSales.token,
      body: {
        salesOrderId: 'so_after_sales_owner',
        issueType: 'logistics_damage',
        actionType: 'refund',
        description: 'smoke test customer reports logistics damage',
        resolution: 'smoke test negotiated refund',
        refundAmountCents: 1200,
        status: 'waiting_refund',
        notes: 'smoke test after sales create',
      },
    });

    assert.equal(created.response.status, 201);
    assert.deepEqual(Object.keys(created.body).sort(), ['data']);
    const order = created.body.data.afterSalesOrder;
    assertAfterSalesOrderContract(order);
    assert.match(order.afterSalesNo, /^AS\d{11}$/);
    assert.equal(order.salesOrderId, 'so_after_sales_owner');
    assert.equal(order.customerId, 'cust_after_sales_marked');
    assert.equal(order.issueType, 'logistics_damage');
    assert.equal(order.actionType, 'refund');
    assert.equal(order.status, 'waiting_refund');
    assert.equal(order.refundAmountCents, 1200);
    assert.equal(order.financeConfirmed, false);
    assert.equal(order.salesOrder.orderNo, 'SO-AFTER-SALES-OWNER');
    assert.equal(order.salesOrder.status, 'partial_refund');
    assert.equal(order.customer.name, 'After Sales Smoke Marked Customer');

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?entityType=after_sales_order',
      {
        token: admin.token,
      },
    );
    assert.equal(logs.response.status, 200);
    const createLog = logs.body.data.logs.find(
      (log) =>
        log.action === 'after_sales_orders.create' &&
        log.entityId === order.id,
    );
    assert.ok(createLog);
    assertPhase6OperationLog(createLog, {
      action: 'after_sales_orders.create',
      entityType: 'after_sales_order',
      entityId: order.id,
      userId: 'usr_after_sales',
      beforeData: null,
    });
    assert.equal(createLog.afterData.afterSalesNo, order.afterSalesNo);
  }, createAfterSalesTestOptions());
});

test('contract: after-sales order creation rejects missing orders and invalid required fields', async () => {
  await withNestApiServer(async (baseUrl) => {
    const afterSales = await login(baseUrl, 'after_sales_user', TEST_PASSWORD);

    const missingOrder = await requestJson(baseUrl, '/api/after-sales-orders', {
      method: 'POST',
      token: afterSales.token,
      body: {
        salesOrderId: 'missing-sales-order',
        issueType: 'quality_issue',
        actionType: 'refund',
        description: 'smoke test missing order',
      },
    });
    assertErrorContract(missingOrder, 404, 'SALES_ORDER_NOT_FOUND');

    const missingRequired = await requestJson(
      baseUrl,
      '/api/after-sales-orders',
      {
        method: 'POST',
        token: afterSales.token,
        body: {
          salesOrderId: 'so_after_sales_owner',
          actionType: 'refund',
          description: 'smoke test missing issue type',
        },
      },
    );
    assertErrorContract(missingRequired, 400, 'VALIDATION_FAILED');

    const invalidRefund = await requestJson(
      baseUrl,
      '/api/after-sales-orders',
      {
        method: 'POST',
        token: afterSales.token,
        body: {
          salesOrderId: 'so_after_sales_owner',
          issueType: 'quality_issue',
          actionType: 'refund',
          description: 'smoke test invalid refund amount',
          refundAmountCents: -1,
        },
      },
    );
    assertErrorContract(invalidRefund, 400, 'VALIDATION_FAILED');
  }, createAfterSalesTestOptions());
});

test('contract: after-sales order list supports documented filters', async () => {
  await withNestApiServer(async (baseUrl) => {
    const finance = await login(baseUrl, 'finance_user', TEST_PASSWORD);

    const filtered = await requestJson(
      baseUrl,
      '/api/after-sales-orders?status=waiting_refund&issueType=quality_issue&actionType=refund&financeConfirmed=false&keyword=bottle&dateFrom=2026-07-01&dateTo=2026-07-01&limit=10',
      {
        token: finance.token,
      },
    );
    assert.equal(filtered.response.status, 200);
    assert.deepEqual(
      filtered.body.data.afterSalesOrders.map((order) => order.afterSalesNo),
      ['AS20260701001'],
    );

    const query = await requestJson(
      baseUrl,
      '/api/after-sales-orders?query=SO-AFTER-SALES-OTHER',
      {
        token: finance.token,
      },
    );
    assert.equal(query.response.status, 200);
    assert.deepEqual(
      query.body.data.afterSalesOrders.map((order) => order.afterSalesNo),
      ['AS20260702002', 'AS20260702003'],
    );

    const byCustomer = await requestJson(
      baseUrl,
      '/api/after-sales-orders?customerId=cust_after_sales_marked&salesOrderId=so_after_sales_owner',
      {
        token: finance.token,
      },
    );
    assert.equal(byCustomer.response.status, 200);
    assert.deepEqual(
      byCustomer.body.data.afterSalesOrders.map((order) => order.afterSalesNo),
      ['AS20260701004', 'AS20260701003', 'AS20260701001'],
    );
  }, createAfterSalesTestOptions());
});

test('contract: after-sales order detail enforces role and sales ownership permissions', async () => {
  await withNestApiServer(async (baseUrl) => {
    const salesOwner = await login(baseUrl, 'sales_owner', TEST_PASSWORD);
    const boss = await login(baseUrl, 'boss_user', TEST_PASSWORD);
    const warehouse = await login(baseUrl, 'warehouse_user', TEST_PASSWORD);
    const frontDesk = await login(baseUrl, 'front_desk_user', TEST_PASSWORD);
    const taster = await login(baseUrl, 'taster_user', TEST_PASSWORD);

    const salesList = await requestJson(baseUrl, '/api/after-sales-orders', {
      token: salesOwner.token,
    });
    assert.equal(salesList.response.status, 200);
    assert.deepEqual(
      salesList.body.data.afterSalesOrders.map((order) => order.afterSalesNo),
      ['AS20260701004', 'AS20260701003', 'AS20260701001'],
    );

    const ownedDetail = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_owner_refund',
      {
        token: salesOwner.token,
      },
    );
    assert.equal(ownedDetail.response.status, 200);
    assert.equal(
      ownedDetail.body.data.afterSalesOrder.afterSalesNo,
      'AS20260701001',
    );

    const otherDetail = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_other_resend',
      {
        token: salesOwner.token,
      },
    );
    assertErrorContract(otherDetail, 404, 'SALES_ORDER_NOT_FOUND');

    const bossList = await requestJson(baseUrl, '/api/after-sales-orders', {
      token: boss.token,
    });
    assertErrorContract(bossList, 403, 'PERMISSION_DENIED');

    const bossDetail = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_other_resend',
      {
        token: boss.token,
      },
    );
    assertErrorContract(bossDetail, 403, 'PERMISSION_DENIED');

    const warehouseList = await requestJson(baseUrl, '/api/after-sales-orders', {
      token: warehouse.token,
    });
    assert.equal(warehouseList.response.status, 200);
    assert.equal(warehouseList.body.data.afterSalesOrders.length > 0, true);

    const warehouseDetail = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_owner_refund',
      {
        token: warehouse.token,
      },
    );
    assert.equal(warehouseDetail.response.status, 200);
    assert.equal(
      warehouseDetail.body.data.afterSalesOrder.afterSalesNo,
      'AS20260701001',
    );

    const warehouseCreate = await requestJson(baseUrl, '/api/after-sales-orders', {
      method: 'POST',
      token: warehouse.token,
      body: {
        salesOrderId: 'so_after_sales_owner',
        issueType: 'quality_issue',
        actionType: 'record_only',
        description: 'smoke test warehouse cannot create after sales',
      },
    });
    assertErrorContract(warehouseCreate, 403, 'PERMISSION_DENIED');

    const salesCreate = await requestJson(baseUrl, '/api/after-sales-orders', {
      method: 'POST',
      token: salesOwner.token,
      body: {
        salesOrderId: 'so_after_sales_owner',
        issueType: 'quality_issue',
        actionType: 'record_only',
        description: 'smoke test sales cannot create after sales',
      },
    });
    assertErrorContract(salesCreate, 403, 'PERMISSION_DENIED');

    for (const token of [frontDesk.token, taster.token]) {
      const list = await requestJson(baseUrl, '/api/after-sales-orders', {
        token,
      });
      assertErrorContract(list, 403, 'PERMISSION_DENIED');

      const detail = await requestJson(
        baseUrl,
        '/api/after-sales-orders/as_owner_refund',
        {
          token,
        },
      );
      assertErrorContract(detail, 403, 'PERMISSION_DENIED');

      const create = await requestJson(baseUrl, '/api/after-sales-orders', {
        method: 'POST',
        token,
        body: {
          salesOrderId: 'so_after_sales_owner',
          issueType: 'quality_issue',
          actionType: 'record_only',
          description: 'smoke test unauthorized role cannot create after sales',
        },
      });
      assertErrorContract(create, 403, 'PERMISSION_DENIED');
    }
  }, createAfterSalesTestOptions());
});

test('contract: after-sales orders obey global mark filtering and do not expose shipped fields', async () => {
  await withNestApiServer(
    async (baseUrl) => {
      const admin = await login(baseUrl, 'admin');

      const beforeEnable = await requestJson(
        baseUrl,
        '/api/after-sales-orders?limit=20',
        {
          token: admin.token,
        },
      );
      assert.equal(beforeEnable.response.status, 200);
      assert.deepEqual(
        beforeEnable.body.data.afterSalesOrders.map((order) => order.id).sort(),
        [
          'as_global_marked',
          'as_global_unmarked_customer',
          'as_global_unmarked_group',
        ],
      );
      for (const order of beforeEnable.body.data.afterSalesOrders) {
        assertNoShippedFields(order);
      }

      const enabled = await requestJson(
        baseUrl,
        '/api/settings/global-mark-query/enable',
        {
          method: 'POST',
          token: admin.token,
        },
      );
      assert.equal(enabled.response.status, 200);

      const afterEnable = await requestJson(
        baseUrl,
        '/api/after-sales-orders?limit=20',
        {
          token: admin.token,
        },
      );
      assert.equal(afterEnable.response.status, 200);
      assert.deepEqual(
        afterEnable.body.data.afterSalesOrders.map((order) => order.id),
        ['as_global_marked'],
      );
      assertNoShippedFields(afterEnable.body.data.afterSalesOrders[0]);

      const visibleDetail = await requestJson(
        baseUrl,
        '/api/after-sales-orders/as_global_marked',
        {
          token: admin.token,
        },
      );
      assert.equal(visibleDetail.response.status, 200);
      assertNoShippedFields(visibleDetail.body.data.afterSalesOrder);

      const hiddenCustomerDetail = await requestJson(
        baseUrl,
        '/api/after-sales-orders/as_global_unmarked_customer',
        {
          token: admin.token,
        },
      );
      assertErrorContract(hiddenCustomerDetail, 404, 'SALES_ORDER_NOT_FOUND');

      const hiddenGroupDetail = await requestJson(
        baseUrl,
        '/api/after-sales-orders/as_global_unmarked_group',
        {
          token: admin.token,
        },
      );
      assertErrorContract(hiddenGroupDetail, 404, 'SALES_ORDER_NOT_FOUND');
    },
    createAfterSalesGlobalMarkTestOptions(),
  );
});

test('contract: PATCH /api/after-sales-orders/:id updates base fields and writes before/after logs', async () => {
  await withNestApiServer(async (baseUrl) => {
    const admin = await login(baseUrl, 'admin');
    const afterSales = await login(baseUrl, 'after_sales_user', TEST_PASSWORD);

    const patched = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_owner_refund',
      {
        method: 'PATCH',
        token: afterSales.token,
        body: {
          issueType: 'logistics_damage',
          actionType: 'exchange',
          description: 'smoke test updated logistics damage description',
          resolution: 'smoke test updated exchange resolution',
          refundAmountCents: 1500,
          notes: 'smoke test updated after sales notes',
        },
      },
    );
    assert.equal(patched.response.status, 200);
    const order = patched.body.data.afterSalesOrder;
    assertAfterSalesOrderContract(order);
    assert.equal(order.afterSalesNo, 'AS20260701001');
    assert.equal(order.issueType, 'logistics_damage');
    assert.equal(order.actionType, 'exchange');
    assert.equal(order.description, 'smoke test updated logistics damage description');
    assert.equal(order.resolution, 'smoke test updated exchange resolution');
    assert.equal(order.refundAmountCents, 1500);
    assert.equal(order.notes, 'smoke test updated after sales notes');
    assert.equal(order.status, 'waiting_refund');
    assert.equal(order.salesOrder.status, 'partial_refund');
    assert.equal(order.financeConfirmed, false);

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?entityType=after_sales_order',
      {
        token: admin.token,
      },
    );
    assert.equal(logs.response.status, 200);
    const updateLog = logs.body.data.logs.find(
      (log) =>
        log.action === 'after_sales_orders.update' &&
        log.entityId === 'as_owner_refund',
    );
    assert.ok(updateLog);
    assertPhase6OperationLog(updateLog, {
      action: 'after_sales_orders.update',
      entityType: 'after_sales_order',
      entityId: 'as_owner_refund',
      userId: 'usr_after_sales',
    });
    assert.equal(updateLog.beforeData.issueType, 'quality_issue');
    assert.equal(updateLog.beforeData.actionType, 'refund');
    assert.equal(updateLog.beforeData.refundAmountCents, 1000);
    assert.equal(updateLog.beforeData.status, 'waiting_refund');
    assert.equal(updateLog.afterData.issueType, 'logistics_damage');
    assert.equal(updateLog.afterData.actionType, 'exchange');
    assert.equal(updateLog.afterData.refundAmountCents, 1500);
    assert.equal(updateLog.afterData.status, 'waiting_refund');
  }, createAfterSalesTestOptions());
});

test('contract: PATCH /api/after-sales-orders/:id/status transitions status and writes handling logs', async () => {
  await withNestApiServer(async (baseUrl) => {
    const admin = await login(baseUrl, 'admin');
    const afterSales = await login(baseUrl, 'after_sales_user', TEST_PASSWORD);

    const waitingReceive = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_other_resend/status',
      {
        method: 'PATCH',
        token: afterSales.token,
        body: {
          status: 'waiting_receive',
        },
      },
    );
    assert.equal(waitingReceive.response.status, 200);
    const waitingReceiveOrder = waitingReceive.body.data.afterSalesOrder;
    assertAfterSalesOrderContract(waitingReceiveOrder);
    assert.equal(waitingReceiveOrder.status, 'waiting_receive');
    assert.equal(waitingReceiveOrder.handledById, 'usr_after_sales');
    assert.ok(Date.parse(waitingReceiveOrder.handledAt));
    assert.equal(waitingReceiveOrder.completedAt, null);
    assert.equal(waitingReceiveOrder.salesOrder.status, 'valid');

    const warehouseConfirmed = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_other_resend/warehouse-confirm',
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          note: 'smoke test warehouse received goods',
        },
      },
    );
    assert.equal(warehouseConfirmed.response.status, 200);
    assert.equal(
      warehouseConfirmed.body.data.afterSalesOrder.status,
      'waiting_refund',
    );
    assert.equal(
      warehouseConfirmed.body.data.afterSalesOrder.warehouseConfirmedById,
      'usr_admin',
    );
    assert.ok(
      Date.parse(
        warehouseConfirmed.body.data.afterSalesOrder.warehouseConfirmedAt,
      ),
    );

    const completed = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_other_resend/status',
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          status: 'completed',
          notes: 'smoke test completed via status endpoint',
        },
      },
    );
    assert.equal(completed.response.status, 200);
    const completedOrder = completed.body.data.afterSalesOrder;
    assert.equal(completedOrder.status, 'completed');
    assert.equal(completedOrder.handledById, 'usr_admin');
    assert.ok(Date.parse(completedOrder.handledAt));
    assert.ok(Date.parse(completedOrder.completedAt));
    assert.equal(
      completedOrder.notes,
      'smoke test completed via status endpoint',
    );
    assert.equal(completedOrder.salesOrder.status, 'valid');

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?entityType=after_sales_order',
      {
        token: admin.token,
      },
    );
    assert.equal(logs.response.status, 200);
    const statusLogs = logs.body.data.logs.filter(
      (log) =>
        [
          'after_sales_orders.status.update',
          'after_sales_orders.warehouse_confirm',
        ].includes(log.action) &&
        log.entityId === 'as_other_resend',
    );
    assert.equal(statusLogs.length, 3);

    const waitingReceiveLog = statusLogs.find(
      (log) => log.afterData.status === 'waiting_receive',
    );
    assert.ok(waitingReceiveLog);
    assertPhase6OperationLog(waitingReceiveLog, {
      action: 'after_sales_orders.status.update',
      entityType: 'after_sales_order',
      entityId: 'as_other_resend',
      userId: 'usr_after_sales',
    });
    assert.equal(waitingReceiveLog.beforeData.status, 'waiting_resend');
    assert.equal(waitingReceiveLog.afterData.handledById, 'usr_after_sales');

    const warehouseLog = statusLogs.find(
      (log) => log.action === 'after_sales_orders.warehouse_confirm',
    );
    assert.ok(warehouseLog);
    assertPhase6OperationLog(warehouseLog, {
      action: 'after_sales_orders.warehouse_confirm',
      entityType: 'after_sales_order',
      entityId: 'as_other_resend',
      userId: 'usr_admin',
    });
    assert.equal(warehouseLog.beforeData.status, 'waiting_receive');
    assert.equal(warehouseLog.afterData.status, 'waiting_refund');
    assert.equal(warehouseLog.afterData.warehouseConfirmedById, 'usr_admin');

    const completedLog = statusLogs.find(
      (log) => log.afterData.status === 'completed',
    );
    assert.ok(completedLog);
    assertPhase6OperationLog(completedLog, {
      action: 'after_sales_orders.status.update',
      entityType: 'after_sales_order',
      entityId: 'as_other_resend',
      userId: 'usr_admin',
    });
    assert.equal(completedLog.beforeData.status, 'waiting_refund');
    assert.equal(completedLog.afterData.handledById, 'usr_admin');
    assert.ok(completedLog.afterData.completedAt);
  }, createAfterSalesTestOptions());
});

test('contract: PATCH /api/after-sales-orders/:id/status validates status payload and roles', async () => {
  await withNestApiServer(async (baseUrl) => {
    const afterSales = await login(baseUrl, 'after_sales_user', TEST_PASSWORD);
    const finance = await login(baseUrl, 'finance_user', TEST_PASSWORD);
    const boss = await login(baseUrl, 'boss_user', TEST_PASSWORD);
    const salesOwner = await login(baseUrl, 'sales_owner', TEST_PASSWORD);
    const warehouse = await login(baseUrl, 'warehouse_user', TEST_PASSWORD);
    const frontDesk = await login(baseUrl, 'front_desk_user', TEST_PASSWORD);
    const taster = await login(baseUrl, 'taster_user', TEST_PASSWORD);

    const invalidStatus = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_owner_refund/status',
      {
        method: 'PATCH',
        token: afterSales.token,
        body: {
          status: 'invalid_status',
        },
      },
    );
    assertErrorContract(invalidStatus, 400, 'INVALID_AFTER_SALES_STATUS');

    const completedWithoutContent = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_owner_refund/status',
      {
        method: 'PATCH',
        token: afterSales.token,
        body: {
          status: 'completed',
          resolution: '',
          notes: '',
        },
      },
    );
    assertErrorContract(completedWithoutContent, 400, 'VALIDATION_FAILED');

    for (const token of [
      finance.token,
      boss.token,
      salesOwner.token,
      warehouse.token,
      frontDesk.token,
      taster.token,
    ]) {
      const denied = await requestJson(
        baseUrl,
        '/api/after-sales-orders/as_owner_refund/status',
        {
          method: 'PATCH',
          token,
          body: {
            status: 'waiting_resend',
          },
        },
      );
      assertErrorContract(denied, 403, 'PERMISSION_DENIED');
    }
  }, createAfterSalesTestOptions());
});

test('contract: warehouse confirms waiting receive or waiting resend only', async () => {
  await withNestApiServer(async (baseUrl) => {
    const warehouse = await login(baseUrl, 'warehouse_user', TEST_PASSWORD);
    const admin = await login(baseUrl, 'admin');
    const finance = await login(baseUrl, 'finance_user', TEST_PASSWORD);
    const afterSales = await login(baseUrl, 'after_sales_user', TEST_PASSWORD);

    const receive = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_waiting_receive/warehouse-confirm',
      {
        method: 'PATCH',
        token: warehouse.token,
        body: {
          warehouseConfirmNote: 'received return goods',
        },
      },
    );
    assert.equal(receive.response.status, 200);
    assert.equal(receive.body.data.afterSalesOrder.status, 'waiting_refund');
    assert.equal(
      receive.body.data.afterSalesOrder.warehouseConfirmedById,
      'usr_warehouse',
    );
    assert.ok(
      Date.parse(receive.body.data.afterSalesOrder.warehouseConfirmedAt),
    );
    assert.equal(
      receive.body.data.afterSalesOrder.warehouseConfirmNote,
      'received return goods',
    );

    const resend = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_other_resend/warehouse-confirm',
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          note: 'resent missing item',
        },
      },
    );
    assert.equal(resend.response.status, 200);
    assert.equal(resend.body.data.afterSalesOrder.status, 'waiting_refund');
    assert.equal(
      resend.body.data.afterSalesOrder.warehouseConfirmedById,
      'usr_admin',
    );

    const invalidStatus = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_owner_refund/warehouse-confirm',
      {
        method: 'PATCH',
        token: warehouse.token,
      },
    );
    assertErrorContract(
      invalidStatus,
      400,
      'AFTER_SALES_WAREHOUSE_CONFIRM_STATUS_INVALID',
    );

    for (const token of [finance.token, afterSales.token]) {
      const denied = await requestJson(
        baseUrl,
        '/api/after-sales-orders/as_waiting_receive/warehouse-confirm',
        {
          method: 'PATCH',
          token,
        },
      );
      assertErrorContract(denied, 403, 'PERMISSION_DENIED');
    }
  }, createAfterSalesTestOptions());
});

test('contract: after-sales refund and cancel changes sync sales order status and travel group summaries', async () => {
  await withNestApiServer(async (baseUrl) => {
    const admin = await login(baseUrl, 'admin');
    const afterSales = await login(baseUrl, 'after_sales_user', TEST_PASSWORD);

    const partialRefund = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_partial_refund/status',
      {
        method: 'PATCH',
        token: afterSales.token,
        body: {
          status: 'waiting_refund',
        },
      },
    );
    assert.equal(partialRefund.response.status, 200);
    assert.equal(
      partialRefund.body.data.afterSalesOrder.salesOrder.status,
      'partial_refund',
    );
    assert.equal(
      partialRefund.body.data.afterSalesOrder.salesOrder.totalAmountCents,
      10000,
    );

    const partialGroup = await requestJson(
      baseUrl,
      '/api/travel-groups/tg_after_sales_partial',
      {
        token: admin.token,
      },
    );
    assert.equal(partialGroup.response.status, 200);
    assert.equal(partialGroup.body.data.travelGroup.status, 'ordered');
    assert.equal(partialGroup.body.data.travelGroup.salesAmountCents, 10000);
    assert.equal(partialGroup.body.data.travelGroup.orderSummary.orderCount, 1);
    assert.equal(
      partialGroup.body.data.travelGroup.orderSummary.totalAmountCents,
      10000,
    );

    const fullRefund = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_full_refund/status',
      {
        method: 'PATCH',
        token: afterSales.token,
        body: {
          status: 'completed',
          notes: 'smoke test full refund completed',
        },
      },
    );
    assert.equal(fullRefund.response.status, 200);
    assert.equal(
      fullRefund.body.data.afterSalesOrder.salesOrder.status,
      'refunded',
    );
    assert.equal(
      fullRefund.body.data.afterSalesOrder.salesOrder.totalAmountCents,
      3000,
    );

    const fullGroup = await requestJson(
      baseUrl,
      '/api/travel-groups/tg_after_sales_full',
      {
        token: admin.token,
      },
    );
    assert.equal(fullGroup.response.status, 200);
    assert.equal(fullGroup.body.data.travelGroup.status, 'unmarked');
    assert.equal(fullGroup.body.data.travelGroup.salesAmountCents, 0);
    assert.equal(fullGroup.body.data.travelGroup.orderSummary.orderCount, 0);

    const cancelled = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_cancel_order/status',
      {
        method: 'PATCH',
        token: afterSales.token,
        body: {
          status: 'completed',
          notes: 'smoke test cancellation completed',
        },
      },
    );
    assert.equal(cancelled.response.status, 200);
    assert.equal(
      cancelled.body.data.afterSalesOrder.salesOrder.status,
      'cancelled',
    );

    const cancelledGroup = await requestJson(
      baseUrl,
      '/api/travel-groups/tg_after_sales_cancel',
      {
        token: admin.token,
      },
    );
    assert.equal(cancelledGroup.response.status, 200);
    assert.equal(cancelledGroup.body.data.travelGroup.status, 'unmarked');
    assert.equal(cancelledGroup.body.data.travelGroup.orderSummary.orderCount, 0);

    const resend = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_resend_no_refund/status',
      {
        method: 'PATCH',
        token: afterSales.token,
        body: {
          status: 'completed',
          notes: 'smoke test resend completed without refund',
        },
      },
    );
    assert.equal(resend.response.status, 200);
    assert.equal(resend.body.data.afterSalesOrder.salesOrder.status, 'valid');
    assert.equal(
      resend.body.data.afterSalesOrder.salesOrder.totalAmountCents,
      7000,
    );

    const salesLogs = await requestJson(
      baseUrl,
      '/api/operation-logs?entityType=sales_order',
      {
        token: admin.token,
      },
    );
    assert.equal(salesLogs.response.status, 200);
    const findStatusLog = (entityId, status) =>
      salesLogs.body.data.logs.find(
        (log) =>
          log.action === 'sales_orders.status.update' &&
          log.entityId === entityId &&
          log.afterData.status === status,
      );
    assertPhase6OperationLog(
      findStatusLog('so_after_sales_partial', 'partial_refund'),
      {
        action: 'sales_orders.status.update',
        entityType: 'sales_order',
        entityId: 'so_after_sales_partial',
        userId: 'usr_after_sales',
      },
    );
    assert.equal(
      findStatusLog('so_after_sales_partial', 'partial_refund').beforeData
        .status,
      'valid',
    );
    assert.equal(
      findStatusLog('so_after_sales_full', 'refunded').beforeData.status,
      'valid',
    );
    assert.equal(
      findStatusLog('so_after_sales_cancel', 'cancelled').beforeData.status,
      'valid',
    );
    assert.equal(
      salesLogs.body.data.logs.some(
        (log) =>
          log.action === 'sales_orders.status.update' &&
          log.entityId === 'so_after_sales_resend',
      ),
      false,
    );

    const afterSalesLogs = await requestJson(
      baseUrl,
      '/api/operation-logs?entityType=after_sales_order',
      {
        token: admin.token,
      },
    );
    assert.equal(afterSalesLogs.response.status, 200);
    const partialAfterSalesLog = afterSalesLogs.body.data.logs.find(
      (log) =>
        log.action === 'after_sales_orders.status.update' &&
        log.entityId === 'as_partial_refund',
    );
    assert.ok(partialAfterSalesLog);
    assertPhase6OperationLog(partialAfterSalesLog, {
      action: 'after_sales_orders.status.update',
      entityType: 'after_sales_order',
      entityId: 'as_partial_refund',
      userId: 'usr_after_sales',
    });
    assert.equal(
      partialAfterSalesLog.afterData.salesOrder.status,
      'partial_refund',
    );
  }, createAfterSalesTestOptions());
});

test('contract: after-sales status rejects cumulative refund above sales order total', async () => {
  await withNestApiServer(async (baseUrl) => {
    const admin = await login(baseUrl, 'admin');
    const afterSales = await login(baseUrl, 'after_sales_user', TEST_PASSWORD);

    const denied = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_over_refund_new/status',
      {
        method: 'PATCH',
        token: afterSales.token,
        body: {
          status: 'waiting_refund',
        },
      },
    );
    assertErrorContract(
      denied,
      400,
      'AFTER_SALES_REFUND_EXCEEDS_ORDER_TOTAL',
    );

    const detail = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_over_refund_new',
      {
        token: admin.token,
      },
    );
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.data.afterSalesOrder.status, 'negotiating');
    assert.equal(detail.body.data.afterSalesOrder.salesOrder.status, 'valid');

    const salesLogs = await requestJson(
      baseUrl,
      '/api/operation-logs?entityType=sales_order',
      {
        token: admin.token,
      },
    );
    assert.equal(salesLogs.response.status, 200);
    assert.equal(
      salesLogs.body.data.logs.some(
        (log) => log.entityId === 'so_after_sales_over_refund',
      ),
      false,
    );
  }, createAfterSalesTestOptions());
});

test('contract: finance refund confirmation requires and stores proof attachments', async () => {
  await withTemporaryRefundProofStorage(async (storageRoot) => {
    await withNestApiServer(
      async (baseUrl) => {
        const admin = await login(baseUrl, 'admin');
        const finance = await login(baseUrl, 'finance_user', TEST_PASSWORD);

        const legacyNoProof = await requestJson(
          baseUrl,
          '/api/after-sales-orders/as_owner_refund/finance-confirm',
          {
            method: 'PATCH',
            token: finance.token,
            body: {
              financeConfirmed: true,
            },
          },
        );
        assertErrorContract(legacyNoProof, 400, 'REFUND_PROOF_FILE_REQUIRED');

        const noProof = await uploadRefundProofs(
          baseUrl,
          finance.token,
          'as_owner_refund',
          [],
        );
        assertErrorContract(noProof, 400, 'REFUND_PROOF_FILE_REQUIRED');

        const confirmed = await uploadRefundProofs(
          baseUrl,
          finance.token,
          'as_owner_refund',
          [
            {
              content: Buffer.from([
                0x89,
                0x50,
                0x4e,
                0x47,
                0x0d,
                0x0a,
                0x1a,
                0x0a,
              ]),
              name: 'refund-proof.png',
              type: 'image/png',
            },
          ],
        );
        assert.equal(confirmed.response.status, 201);
        const confirmedOrder = confirmed.body.data.afterSalesOrder;
        assertAfterSalesOrderContract(confirmedOrder);
        assert.equal(confirmedOrder.financeConfirmed, true);
        assert.equal(confirmedOrder.financeConfirmedById, 'usr_finance');
        assert.ok(Date.parse(confirmedOrder.financeConfirmedAt));
        assert.equal(confirmedOrder.updatedById, 'usr_finance');
        assert.equal(confirmedOrder.refundProofAttachments.length, 1);
        assert.equal(
          confirmedOrder.refundProofAttachments[0].originalName,
          'refund-proof.png',
        );
        assert.equal(
          confirmedOrder.refundProofAttachments[0].contentType,
          'image/png',
        );
        assertNoStorageLocation(confirmedOrder);

        const downloaded = await downloadRefundProof(
          baseUrl,
          finance.token,
          'as_owner_refund',
          confirmedOrder.refundProofAttachments[0].id,
        );
        assert.equal(downloaded.response.status, 200);
        assert.equal(
          downloaded.response.headers.get('content-type'),
          'image/png',
        );
        assert.equal(downloaded.buffer[0], 0x89);

        const cancelled = await requestJson(
          baseUrl,
          '/api/after-sales-orders/as_owner_refund/finance-confirm',
          {
            method: 'PATCH',
            token: admin.token,
            body: {
              financeConfirmed: false,
            },
          },
        );
        assert.equal(cancelled.response.status, 200);
        const cancelledOrder = cancelled.body.data.afterSalesOrder;
        assert.equal(cancelledOrder.financeConfirmed, false);
        assert.equal(cancelledOrder.financeConfirmedById, null);
        assert.equal(cancelledOrder.financeConfirmedAt, null);
        assert.equal(cancelledOrder.refundProofAttachments.length, 0);
        assert.equal(cancelledOrder.updatedById, 'usr_admin');

        const logs = await requestJson(
          baseUrl,
          '/api/operation-logs?entityType=after_sales_order',
          {
            token: admin.token,
          },
        );
        assert.equal(logs.response.status, 200);
        const confirmLog = logs.body.data.logs.find(
          (log) =>
            log.action === 'after_sales_orders.finance_refund_confirm' &&
            log.entityId === 'as_owner_refund',
        );
        assert.ok(confirmLog);
        assertPhase6OperationLog(confirmLog, {
          action: 'after_sales_orders.finance_refund_confirm',
          entityType: 'after_sales_order',
          entityId: 'as_owner_refund',
          userId: 'usr_finance',
        });
        assert.equal(confirmLog.beforeData.financeConfirmed, false);
        assert.equal(confirmLog.afterData.financeConfirmed, true);
        assert.equal(confirmLog.afterData.financeConfirmedById, 'usr_finance');
        assert.equal(confirmLog.afterData.refundProofAttachments.length, 1);
        assertNoStorageLocation(confirmLog);

        const cancelLog = logs.body.data.logs.find(
          (log) =>
            log.action === 'after_sales_orders.finance_confirm.disable' &&
            log.entityId === 'as_owner_refund',
        );
        assert.ok(cancelLog);
        assertPhase6OperationLog(cancelLog, {
          action: 'after_sales_orders.finance_confirm.disable',
          entityType: 'after_sales_order',
          entityId: 'as_owner_refund',
          userId: 'usr_admin',
        });
        assert.equal(cancelLog.beforeData.financeConfirmed, true);
        assert.equal(cancelLog.afterData.financeConfirmed, false);
        assert.equal(cancelLog.afterData.financeConfirmedById, null);
        assert.equal(cancelLog.afterData.refundProofAttachments.length, 0);
      },
      {
        ...createAfterSalesTestOptions(),
        env: { TRAVEL_GROUP_ATTACHMENT_DIR: storageRoot },
      },
    );
  });
});

test('contract: PATCH /api/after-sales-orders/:id/finance-confirm validates roles and refund amount', async () => {
  await withNestApiServer(async (baseUrl) => {
    const finance = await login(baseUrl, 'finance_user', TEST_PASSWORD);
    const afterSales = await login(baseUrl, 'after_sales_user', TEST_PASSWORD);
    const boss = await login(baseUrl, 'boss_user', TEST_PASSWORD);
    const salesOwner = await login(baseUrl, 'sales_owner', TEST_PASSWORD);
    const warehouse = await login(baseUrl, 'warehouse_user', TEST_PASSWORD);
    const frontDesk = await login(baseUrl, 'front_desk_user', TEST_PASSWORD);
    const taster = await login(baseUrl, 'taster_user', TEST_PASSWORD);

    for (const token of [
      afterSales.token,
      boss.token,
      salesOwner.token,
      warehouse.token,
      frontDesk.token,
      taster.token,
    ]) {
      const denied = await requestJson(
        baseUrl,
        '/api/after-sales-orders/as_owner_refund/finance-confirm',
        {
          method: 'PATCH',
          token,
          body: {
            financeConfirmed: true,
          },
        },
      );
      assertErrorContract(denied, 403, 'PERMISSION_DENIED');
    }

    const noRefund = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_other_resend/finance-confirm',
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          financeConfirmed: true,
        },
      },
    );
    assertErrorContract(noRefund, 400, 'AFTER_SALES_REFUND_NOT_REQUIRED');
  }, createAfterSalesTestOptions());
});

test('contract: refund proof upload guards reject before multipart parsing', async () => {
  await withNestApiServer(
    async (baseUrl, { stores }) => {
      const sales = await login(
        baseUrl,
        'sales_owner',
        TEST_PASSWORD,
      );
      const pathName =
        '/api/after-sales-orders/not-read/finance-refund-confirm';

      const unauthenticated = await requestMalformedRefundMultipart(
        baseUrl,
        pathName,
      );
      assertErrorContract(
        unauthenticated,
        401,
        'AUTH_TOKEN_REQUIRED',
      );

      const unauthorized = await requestMalformedRefundMultipart(
        baseUrl,
        pathName,
        sales.token,
      );
      assertErrorContract(unauthorized, 403, 'PERMISSION_DENIED');
      assert.deepEqual(
        await fs.readdir(stores.attachmentTempDir),
        [],
      );
    },
    createAfterSalesTestOptions(),
  );
});

test('contract: completed status requires warehouse and finance proof prerequisites', async () => {
  await withTemporaryRefundProofStorage(async (storageRoot) => {
    await withNestApiServer(
      async (baseUrl, { stores }) => {
        const afterSales = await login(
          baseUrl,
          'after_sales_user',
          TEST_PASSWORD,
        );
        const finance = await login(baseUrl, 'finance_user', TEST_PASSWORD);

        const noWarehouse = await requestJson(
          baseUrl,
          '/api/after-sales-orders/as_other_resend/status',
          {
            method: 'PATCH',
            token: afterSales.token,
            body: {
              status: 'completed',
              notes: 'attempt direct completion without warehouse confirm',
            },
          },
        );
        assertErrorContract(
          noWarehouse,
          400,
          'AFTER_SALES_WAREHOUSE_CONFIRM_REQUIRED',
        );

        const noFinance = await requestJson(
          baseUrl,
          '/api/after-sales-orders/as_owner_refund/status',
          {
            method: 'PATCH',
            token: afterSales.token,
            body: {
              status: 'completed',
              notes: 'attempt completion without finance confirm',
            },
          },
        );
        assertErrorContract(
          noFinance,
          400,
          'AFTER_SALES_FINANCE_CONFIRM_REQUIRED',
        );

        const noProof = await requestJson(
          baseUrl,
          '/api/after-sales-orders/as_finance_confirmed_no_proof/status',
          {
            method: 'PATCH',
            token: afterSales.token,
            body: {
              status: 'completed',
              notes: 'attempt completion without refund proof',
            },
          },
        );
        assertErrorContract(
          noProof,
          400,
          'AFTER_SALES_FINANCE_CONFIRM_REQUIRED',
        );

        const confirmed = await uploadRefundProofs(
          baseUrl,
          finance.token,
          'as_owner_refund',
          [
            {
              content: Buffer.from('%PDF-smoke'),
              name: 'refund-proof.pdf',
              type: 'application/pdf',
            },
          ],
        );
        assert.equal(confirmed.response.status, 201);
        assert.deepEqual(
          await fs.readdir(stores.attachmentTempDir),
          [],
        );

        const completed = await requestJson(
          baseUrl,
          '/api/after-sales-orders/as_owner_refund/status',
          {
            method: 'PATCH',
            token: afterSales.token,
            body: {
              status: 'completed',
              notes: 'finance refund proof confirmed',
            },
          },
        );
        assert.equal(completed.response.status, 200);
        assert.equal(
          completed.body.data.afterSalesOrder.status,
          'completed',
        );
        assert.equal(
          completed.body.data.afterSalesOrder.financeConfirmed,
          true,
        );
        assert.equal(
          completed.body.data.afterSalesOrder.refundProofAttachments.length,
          1,
        );
      },
      {
        ...createAfterSalesTestOptions(),
        env: { TRAVEL_GROUP_ATTACHMENT_DIR: storageRoot },
      },
    );
  });
});

test('contract: PATCH /api/after-sales-orders/:id enforces field and role permissions', async () => {
  await withNestApiServer(async (baseUrl) => {
    const admin = await login(baseUrl, 'admin');
    const afterSales = await login(baseUrl, 'after_sales_user', TEST_PASSWORD);
    const finance = await login(baseUrl, 'finance_user', TEST_PASSWORD);
    const boss = await login(baseUrl, 'boss_user', TEST_PASSWORD);
    const salesOwner = await login(baseUrl, 'sales_owner', TEST_PASSWORD);
    const warehouse = await login(baseUrl, 'warehouse_user', TEST_PASSWORD);
    const frontDesk = await login(baseUrl, 'front_desk_user', TEST_PASSWORD);
    const taster = await login(baseUrl, 'taster_user', TEST_PASSWORD);

    const adminPatch = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_other_resend',
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          notes: 'smoke test admin updated notes',
        },
      },
    );
    assert.equal(adminPatch.response.status, 200);
    assert.equal(
      adminPatch.body.data.afterSalesOrder.notes,
      'smoke test admin updated notes',
    );

    for (const token of [
      finance.token,
      boss.token,
      salesOwner.token,
      warehouse.token,
      frontDesk.token,
      taster.token,
    ]) {
      const denied = await requestJson(
        baseUrl,
        '/api/after-sales-orders/as_owner_refund',
        {
          method: 'PATCH',
          token,
          body: {
            description: 'smoke test read-only role cannot update',
          },
        },
      );
      assertErrorContract(denied, 403, 'PERMISSION_DENIED');
    }

    const deniedStatus = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_owner_refund',
      {
        method: 'PATCH',
        token: afterSales.token,
        body: {
          status: 'completed',
        },
      },
    );
    assertErrorContract(deniedStatus, 403, 'FIELD_PERMISSION_DENIED');

    const deniedFinanceConfirm = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_owner_refund',
      {
        method: 'PATCH',
        token: afterSales.token,
        body: {
          financeConfirmed: true,
        },
      },
    );
    assertErrorContract(deniedFinanceConfirm, 403, 'FIELD_PERMISSION_DENIED');

    const invalidRefund = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_owner_refund',
      {
        method: 'PATCH',
        token: afterSales.token,
        body: {
          refundAmountCents: -1,
        },
      },
    );
    assertErrorContract(invalidRefund, 400, 'VALIDATION_FAILED');
  }, createAfterSalesTestOptions());
});

function createAfterSalesTestOptions() {
  return {
    prisma: {
      users: [
        createUserSeed('usr_sales_owner', 'sales_owner', 'sales'),
        createUserSeed('usr_sales_other', 'sales_other', 'sales'),
        createUserSeed('usr_after_sales', 'after_sales_user', 'after_sales'),
        createUserSeed('usr_finance', 'finance_user', 'finance'),
        createUserSeed('usr_boss', 'boss_user', 'boss'),
        createUserSeed('usr_warehouse', 'warehouse_user', 'warehouse'),
        createUserSeed('usr_front_desk', 'front_desk_user', 'front_desk'),
        createUserSeed('usr_taster', 'taster_user', 'taster'),
      ],
      customers: [
        {
          id: 'cust_after_sales_marked',
          name: 'After Sales Smoke Marked Customer',
          phone: '13800007001',
          province: 'Guizhou',
          city: 'Guiyang',
          district: 'Yunyan',
          address: 'smoke test marked customer address',
          financeMark: true,
        },
        {
          id: 'cust_after_sales_other',
          name: 'After Sales Smoke Other Customer',
          phone: '13800007002',
          address: 'smoke test other customer address',
          financeMark: true,
        },
        {
          id: 'cust_after_sales_link',
          name: 'After Sales Smoke Link Customer',
          phone: '13800007003',
          address: 'smoke test link customer address',
          financeMark: true,
        },
      ],
      travelGroups: [
        {
          id: 'tg_after_sales_marked',
          groupNo: 'TG-AFTER-SALES-MARKED',
          travelAgency: 'smoke test marked agency',
          financeMark: true,
        },
        {
          id: 'tg_after_sales_partial',
          groupNo: 'TG-AFTER-SALES-PARTIAL',
          travelAgency: 'smoke test partial refund agency',
          financeMark: true,
        },
        {
          id: 'tg_after_sales_full',
          groupNo: 'TG-AFTER-SALES-FULL',
          travelAgency: 'smoke test full refund agency',
          financeMark: true,
        },
        {
          id: 'tg_after_sales_cancel',
          groupNo: 'TG-AFTER-SALES-CANCEL',
          travelAgency: 'smoke test cancel agency',
          financeMark: true,
        },
        {
          id: 'tg_after_sales_over_refund',
          groupNo: 'TG-AFTER-SALES-OVER-REFUND',
          travelAgency: 'smoke test over refund agency',
          financeMark: true,
        },
      ],
      salesOrders: [
        createSalesOrderSeed({
          id: 'so_after_sales_owner',
          orderNo: 'SO-AFTER-SALES-OWNER',
          customerId: 'cust_after_sales_marked',
          customerName: 'After Sales Smoke Marked Customer',
          customerPhone: '13800007001',
          travelGroupId: 'tg_after_sales_marked',
          salesUserId: 'usr_sales_owner',
          createdById: 'usr_sales_owner',
        }),
        createSalesOrderSeed({
          id: 'so_after_sales_other',
          orderNo: 'SO-AFTER-SALES-OTHER',
          customerId: 'cust_after_sales_other',
          customerName: 'After Sales Smoke Other Customer',
          customerPhone: '13800007002',
          salesUserId: 'usr_sales_other',
          createdById: 'usr_sales_other',
        }),
        createSalesOrderSeed({
          id: 'so_after_sales_partial',
          orderNo: 'SO-AFTER-SALES-PARTIAL',
          orderType: 'TRAVEL_GROUP',
          travelGroupId: 'tg_after_sales_partial',
          customerId: 'cust_after_sales_link',
          customerName: 'After Sales Smoke Link Customer',
          customerPhone: '13800007003',
          totalAmountCents: 10000,
          salesUserId: 'usr_sales_other',
          createdById: 'usr_sales_other',
        }),
        createSalesOrderSeed({
          id: 'so_after_sales_full',
          orderNo: 'SO-AFTER-SALES-FULL',
          orderType: 'TRAVEL_GROUP',
          travelGroupId: 'tg_after_sales_full',
          customerId: 'cust_after_sales_link',
          customerName: 'After Sales Smoke Link Customer',
          customerPhone: '13800007003',
          totalAmountCents: 3000,
          salesUserId: 'usr_sales_other',
          createdById: 'usr_sales_other',
        }),
        createSalesOrderSeed({
          id: 'so_after_sales_cancel',
          orderNo: 'SO-AFTER-SALES-CANCEL',
          orderType: 'TRAVEL_GROUP',
          travelGroupId: 'tg_after_sales_cancel',
          customerId: 'cust_after_sales_link',
          customerName: 'After Sales Smoke Link Customer',
          customerPhone: '13800007003',
          totalAmountCents: 6000,
          salesUserId: 'usr_sales_other',
          createdById: 'usr_sales_other',
        }),
        createSalesOrderSeed({
          id: 'so_after_sales_resend',
          orderNo: 'SO-AFTER-SALES-RESEND',
          customerId: 'cust_after_sales_link',
          customerName: 'After Sales Smoke Link Customer',
          customerPhone: '13800007003',
          totalAmountCents: 7000,
          salesUserId: 'usr_sales_other',
          createdById: 'usr_sales_other',
        }),
        createSalesOrderSeed({
          id: 'so_after_sales_over_refund',
          orderNo: 'SO-AFTER-SALES-OVER-REFUND',
          orderType: 'TRAVEL_GROUP',
          travelGroupId: 'tg_after_sales_over_refund',
          customerId: 'cust_after_sales_link',
          customerName: 'After Sales Smoke Link Customer',
          customerPhone: '13800007003',
          totalAmountCents: 1000,
          salesUserId: 'usr_sales_other',
          createdById: 'usr_sales_other',
        }),
      ],
      afterSalesOrders: [
        createAfterSalesSeed({
          id: 'as_owner_refund',
          afterSalesNo: 'AS20260701001',
          salesOrderId: 'so_after_sales_owner',
          customerId: 'cust_after_sales_marked',
          issueType: 'QUALITY_ISSUE',
          actionType: 'REFUND',
          description: 'smoke test bottle seal issue refund',
          refundAmountCents: 1000,
          status: 'WAITING_REFUND',
          financeConfirmed: false,
          createdAt: '2026-07-01T00:00:00.000Z',
        }),
        createAfterSalesSeed({
          id: 'as_other_resend',
          afterSalesNo: 'AS20260702002',
          salesOrderId: 'so_after_sales_other',
          customerId: 'cust_after_sales_other',
          issueType: 'MISSING_ITEM',
          actionType: 'RESEND',
          description: 'smoke test missing item resend',
          status: 'WAITING_RESEND',
          createdAt: '2026-07-02T00:00:00.000Z',
        }),
        createAfterSalesSeed({
          id: 'as_waiting_receive',
          afterSalesNo: 'AS20260702003',
          salesOrderId: 'so_after_sales_other',
          customerId: 'cust_after_sales_other',
          issueType: 'CUSTOMER_RETURN',
          actionType: 'RETURN_REFUND',
          description: 'smoke test waiting receive return',
          refundAmountCents: 500,
          status: 'WAITING_RECEIVE',
          createdAt: '2026-07-02T00:00:00.000Z',
        }),
        createAfterSalesSeed({
          id: 'as_owner_completed',
          afterSalesNo: 'AS20260701003',
          salesOrderId: 'so_after_sales_owner',
          customerId: 'cust_after_sales_marked',
          issueType: 'CUSTOMER_RETURN',
          actionType: 'RETURN_REFUND',
          description: 'smoke test completed return refund',
          refundAmountCents: 2000,
          status: 'COMPLETED',
          financeConfirmed: true,
          financeConfirmedById: 'usr_finance',
          financeConfirmedAt: '2026-07-01T01:00:00.000Z',
          refundProofAttachments: [refundProofSeed('11111111-1111-4111-8111-111111111111')],
          completedAt: '2026-07-01T00:00:00.000Z',
          createdAt: '2026-07-01T00:00:00.001Z',
        }),
        createAfterSalesSeed({
          id: 'as_finance_confirmed_no_proof',
          afterSalesNo: 'AS20260701004',
          salesOrderId: 'so_after_sales_owner',
          customerId: 'cust_after_sales_marked',
          issueType: 'QUALITY_ISSUE',
          actionType: 'REFUND',
          description: 'smoke test finance confirmed without proof',
          refundAmountCents: 600,
          status: 'WAITING_REFUND',
          financeConfirmed: true,
          financeConfirmedById: 'usr_finance',
          financeConfirmedAt: '2026-07-01T01:10:00.000Z',
          createdAt: '2026-07-01T00:00:00.002Z',
        }),
        createAfterSalesSeed({
          id: 'as_partial_refund',
          afterSalesNo: 'AS20260703001',
          salesOrderId: 'so_after_sales_partial',
          customerId: 'cust_after_sales_link',
          issueType: 'QUALITY_ISSUE',
          actionType: 'REFUND',
          description: 'smoke test partial refund linkage',
          refundAmountCents: 3000,
          status: 'NEGOTIATING',
          createdAt: '2026-07-03T00:00:00.000Z',
        }),
        createAfterSalesSeed({
          id: 'as_full_refund',
          afterSalesNo: 'AS20260703002',
          salesOrderId: 'so_after_sales_full',
          customerId: 'cust_after_sales_link',
          issueType: 'CUSTOMER_RETURN',
          actionType: 'RETURN_REFUND',
          description: 'smoke test full refund linkage',
          refundAmountCents: 3000,
          status: 'NEGOTIATING',
          financeConfirmed: true,
          financeConfirmedById: 'usr_finance',
          financeConfirmedAt: '2026-07-03T01:00:00.000Z',
          refundProofAttachments: [refundProofSeed('22222222-2222-4222-8222-222222222222')],
          createdAt: '2026-07-03T00:00:00.001Z',
        }),
        createAfterSalesSeed({
          id: 'as_cancel_order',
          afterSalesNo: 'AS20260703003',
          salesOrderId: 'so_after_sales_cancel',
          customerId: 'cust_after_sales_link',
          issueType: 'OTHER',
          actionType: 'CANCEL_ORDER',
          description: 'smoke test cancel order linkage',
          refundAmountCents: 0,
          status: 'NEGOTIATING',
          createdAt: '2026-07-03T00:00:00.002Z',
        }),
        createAfterSalesSeed({
          id: 'as_resend_no_refund',
          afterSalesNo: 'AS20260703004',
          salesOrderId: 'so_after_sales_resend',
          customerId: 'cust_after_sales_link',
          issueType: 'MISSING_ITEM',
          actionType: 'RESEND',
          description: 'smoke test resend no refund linkage',
          refundAmountCents: 0,
          status: 'WAITING_RESEND',
          warehouseConfirmedById: 'usr_warehouse',
          warehouseConfirmedAt: '2026-07-03T01:10:00.000Z',
          warehouseConfirmNote: 'seed warehouse confirmed resend',
          createdAt: '2026-07-03T00:00:00.003Z',
        }),
        createAfterSalesSeed({
          id: 'as_over_refund_existing',
          afterSalesNo: 'AS20260703005',
          salesOrderId: 'so_after_sales_over_refund',
          customerId: 'cust_after_sales_link',
          issueType: 'QUALITY_ISSUE',
          actionType: 'REFUND',
          description: 'smoke test existing refund before over refund',
          refundAmountCents: 800,
          status: 'COMPLETED',
          financeConfirmed: true,
          financeConfirmedById: 'usr_finance',
          financeConfirmedAt: '2026-07-03T01:20:00.000Z',
          refundProofAttachments: [refundProofSeed('33333333-3333-4333-8333-333333333333')],
          completedAt: '2026-07-03T00:00:00.004Z',
          createdAt: '2026-07-03T00:00:00.004Z',
        }),
        createAfterSalesSeed({
          id: 'as_over_refund_new',
          afterSalesNo: 'AS20260703006',
          salesOrderId: 'so_after_sales_over_refund',
          customerId: 'cust_after_sales_link',
          issueType: 'QUALITY_ISSUE',
          actionType: 'REFUND',
          description: 'smoke test new refund over total',
          refundAmountCents: 300,
          status: 'NEGOTIATING',
          createdAt: '2026-07-03T00:00:00.005Z',
        }),
      ],
    },
  };
}

function createAfterSalesGlobalMarkTestOptions() {
  return {
    prisma: {
      users: [
        createUserSeed('usr_after_sales', 'after_sales_user', 'after_sales'),
      ],
      customers: [
        {
          id: 'cust_as_global_marked',
          name: 'After Sales Global Smoke Marked Customer',
          phone: '13800007101',
          financeMark: true,
        },
        {
          id: 'cust_as_global_unmarked',
          name: 'After Sales Global Smoke Unmarked Customer',
          phone: '13800007102',
          financeMark: false,
        },
        {
          id: 'cust_as_global_group',
          name: 'After Sales Global Smoke Group Customer',
          phone: '13800007103',
          financeMark: true,
        },
      ],
      travelGroups: [
        {
          id: 'tg_as_global_unmarked',
          groupNo: 'TG-AS-GLOBAL-UNMARKED',
          travelAgency: 'after sales global smoke unmarked agency',
          financeMark: false,
        },
      ],
      salesOrders: [
        createSalesOrderSeed({
          id: 'so_as_global_marked',
          orderNo: 'SO-AS-GLOBAL-MARKED',
          customerId: 'cust_as_global_marked',
          customerName: 'After Sales Global Smoke Marked Customer',
          customerPhone: '13800007101',
          orderDate: '2026-07-05T00:00:00.000Z',
          totalAmountCents: 1000,
        }),
        createSalesOrderSeed({
          id: 'so_as_global_unmarked_customer',
          orderNo: 'SO-AS-GLOBAL-UNMARKED-CUSTOMER',
          customerId: 'cust_as_global_unmarked',
          customerName: 'After Sales Global Smoke Unmarked Customer',
          customerPhone: '13800007102',
          orderDate: '2026-07-05T00:00:00.000Z',
          totalAmountCents: 1000,
        }),
        createSalesOrderSeed({
          id: 'so_as_global_unmarked_group',
          orderNo: 'SO-AS-GLOBAL-UNMARKED-GROUP',
          orderType: 'TRAVEL_GROUP',
          travelGroupId: 'tg_as_global_unmarked',
          customerId: 'cust_as_global_group',
          customerName: 'After Sales Global Smoke Group Customer',
          customerPhone: '13800007103',
          orderDate: '2026-07-05T00:00:00.000Z',
          totalAmountCents: 1000,
        }),
      ],
      afterSalesOrders: [
        createAfterSalesSeed({
          id: 'as_global_marked',
          afterSalesNo: 'AS20260705001',
          salesOrderId: 'so_as_global_marked',
          customerId: 'cust_as_global_marked',
          description: 'smoke test marked after sales visible',
          createdAt: '2026-07-05T00:00:00.000Z',
        }),
        createAfterSalesSeed({
          id: 'as_global_unmarked_customer',
          afterSalesNo: 'AS20260705002',
          salesOrderId: 'so_as_global_unmarked_customer',
          customerId: 'cust_as_global_unmarked',
          description: 'smoke test unmarked customer hidden',
          createdAt: '2026-07-05T00:00:00.001Z',
        }),
        createAfterSalesSeed({
          id: 'as_global_unmarked_group',
          afterSalesNo: 'AS20260705003',
          salesOrderId: 'so_as_global_unmarked_group',
          customerId: 'cust_as_global_group',
          description: 'smoke test unmarked group hidden',
          createdAt: '2026-07-05T00:00:00.002Z',
        }),
      ],
    },
  };
}

async function withTemporaryRefundProofStorage(run) {
  const storageRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'jiangjiu-refund-proofs-'),
  );
  try {
    await run(storageRoot);
  } finally {
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
}

async function uploadRefundProofs(baseUrl, token, afterSalesOrderId, files) {
  const form = new FormData();
  for (const file of files) {
    form.append(
      'files',
      new Blob([file.content], { type: file.type }),
      file.name,
    );
  }
  const response = await fetch(
    `${baseUrl}/api/after-sales-orders/${afterSalesOrderId}/finance-refund-confirm`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );
  return { response, body: await response.json() };
}

async function requestMalformedRefundMultipart(
  baseUrl,
  pathName,
  token,
) {
  const headers = {
    'Content-Type': 'multipart/form-data; boundary=security-test',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: 'POST',
    headers,
    body: Buffer.from('--security-test\r\nbroken'),
  });
  return {
    response,
    body: await response.json(),
  };
}

async function downloadRefundProof(
  baseUrl,
  token,
  afterSalesOrderId,
  attachmentId,
) {
  const response = await fetch(
    `${baseUrl}/api/after-sales-orders/${afterSalesOrderId}/refund-proofs/${attachmentId}/download`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return { response, buffer: Buffer.from(await response.arrayBuffer()) };
}

function createUserSeed(id, username, role) {
  return {
    id,
    username,
    name: `${username} smoke user`,
    role,
    password: TEST_PASSWORD,
  };
}

function createSalesOrderSeed(overrides) {
  return {
    orderType: 'EXTERNAL',
    orderDate: '2026-07-01T00:00:00.000Z',
    totalAmountCents: 99000,
    packingStatus: 'PACKED',
    financeMark: true,
    items: [
      {
        productName: 'Smoke Test Wine',
        quantity: 1,
        unitPriceCents: 99000,
        deliveryType: 'SHIPPING',
      },
    ],
    ...overrides,
  };
}

function createAfterSalesSeed(overrides) {
  return {
    resolution: 'smoke test resolution',
    notes: 'smoke test notes',
    handledById: 'usr_after_sales',
    handledAt: '2026-07-01T00:00:00.000Z',
    createdById: 'usr_after_sales',
    updatedById: 'usr_after_sales',
    ...overrides,
  };
}

function refundProofSeed(id) {
  return {
    id,
    category: 'refund_proof',
    originalName: 'seed-refund-proof.png',
    contentType: 'image/png',
    size: 4,
    storageKey: id,
    uploadedById: 'usr_finance',
    uploadedAt: '2026-07-01T01:00:00.000Z',
  };
}

function assertPhase6OperationLog(log, expected) {
  assertOperationLogContract(log);
  assert.equal(log.action, expected.action);
  assert.equal(log.entityType, expected.entityType);
  assert.equal(log.entityId, expected.entityId);
  assert.equal(log.userId, expected.userId);
  assert.equal(typeof log.ipAddress, 'string');
  assert.ok(log.ipAddress.length > 0);
  if (Object.hasOwn(expected, 'beforeData')) {
    assert.deepEqual(log.beforeData, expected.beforeData);
  } else {
    assert.ok(log.beforeData);
  }
  assert.ok(log.afterData);
  assertNoSensitiveLogData(log);
}

function assertNoSensitiveLogData(value) {
  const serialized = JSON.stringify(value);
  assert.equal(/password|token/i.test(serialized), false);
}

function assertNoStorageLocation(value) {
  const serialized = JSON.stringify(value);
  assert.equal(/storageKey|storage_key|refund-proof-attachments|\.private/i.test(serialized), false);
}

function assertNoShippedFields(value) {
  const serialized = JSON.stringify(value);
  assert.equal(/shippedAt|shippedById|shipped_at|shipped_by_id/.test(serialized), false);
}

function assertAfterSalesOrderContract(order) {
  assert.deepEqual(Object.keys(order).sort(), [
    'actionType',
    'afterSalesNo',
    'completedAt',
    'createdAt',
    'createdById',
    'customer',
    'customerId',
    'description',
    'financeConfirmed',
    'financeConfirmedAt',
    'financeConfirmedById',
    'handledAt',
    'handledById',
    'id',
    'issueType',
    'notes',
    'refundAmountCents',
    'refundProofAttachments',
    'resolution',
    'salesOrder',
    'salesOrderId',
    'status',
    'updatedAt',
    'updatedById',
    'warehouseConfirmNote',
    'warehouseConfirmedAt',
    'warehouseConfirmedById',
  ]);
  assert.equal(typeof order.id, 'string');
  assert.equal(typeof order.afterSalesNo, 'string');
  assert.equal(typeof order.salesOrderId, 'string');
  assert.equal(typeof order.issueType, 'string');
  assert.equal(typeof order.actionType, 'string');
  assert.equal(typeof order.description, 'string');
  assert.equal(typeof order.refundAmountCents, 'number');
  assert.equal(typeof order.status, 'string');
  assert.equal(typeof order.financeConfirmed, 'boolean');
  assert.equal(Array.isArray(order.refundProofAttachments), true);
  assert.equal(typeof order.createdAt, 'string');
  assert.equal(typeof order.updatedAt, 'string');
  assertNoShippedFields(order);
  assertNoStorageLocation(order);
}
