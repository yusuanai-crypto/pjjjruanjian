const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ExcelJS = require('exceljs');

const {
  assertErrorContract,
  assertOperationLogContract,
  login,
  requestJson,
  withNestApiServer,
} = require('./helpers/phase1-api');
const { getRoleMenus } = require('../src/modules/auth/roles');
const {
  formatShanghaiDate,
  parseDateOnly,
} = require('../src/modules/business-data/sales-order-shipping-date.helper');
const {
  calculateOrderProfitFees,
  isSameShanghaiNaturalDay,
} = require('../src/modules/analytics/profit-tax-service-fee.helper');

const TEST_PASSWORD = 'Password123';

test('unit: finance role menu includes after-sales orders', () => {
  const financeMenuIds = getRoleMenus('finance').map((menu) => menu.id);
  assert.equal(financeMenuIds.includes('after_sales_orders'), true);
});

test('unit: refund confirmation uses the Asia/Shanghai midnight boundary', () => {
  const orderDate = '2026-07-30T00:00:00.000Z';
  assert.equal(
    isSameShanghaiNaturalDay(
      orderDate,
      '2026-07-30T15:59:59.000Z',
    ),
    true,
  );
  assert.equal(
    isSameShanghaiNaturalDay(
      orderDate,
      '2026-07-30T16:00:00.000Z',
    ),
    false,
  );
});

test('contract: after-sales order creation validates payload and writes an operation log', async () => {
  await withNestApiServer(async (baseUrl, { prisma }) => {
    const admin = await login(baseUrl, 'admin');
    const afterSales = await login(baseUrl, 'after_sales_user', TEST_PASSWORD);
    const [sourcePaymentDetail] =
      await prisma.salesOrderPaymentDetail.findMany({
        where: { salesOrderId: 'so_after_sales_owner' },
      });
    assert.ok(sourcePaymentDetail);

    const created = await requestJson(baseUrl, '/api/after-sales-orders', {
      method: 'POST',
      token: afterSales.token,
      body: {
        sourceSalesOrderId: 'so_after_sales_owner',
        refundPaymentDetailId: sourcePaymentDetail.id,
        issueType: 'logistics_damage',
        actionType: 'refund',
        description: 'smoke test customer reports logistics damage',
        resolution: 'smoke test negotiated refund',
        refundAmountCents: 1200,
        status: 'waiting_refund',
        notes: 'smoke test after sales create',
        items: [
          {
            sourceSalesOrderItemId: 'so_after_sales_owner_item_1',
            quantity: 1,
            totalPriceCents: 1200,
          },
        ],
      },
    });

    assert.equal(created.response.status, 201);
    assert.deepEqual(Object.keys(created.body).sort(), ['data']);
    const order = created.body.data.afterSalesOrder;
    assertAfterSalesOrderContract(order);
    assert.match(order.afterSalesNo, /^AS\d{11}$/);
    assert.equal(order.salesOrderId, 'so_after_sales_owner');
    assert.equal(order.sourceSalesOrderId, 'so_after_sales_owner');
    assert.equal(order.customerId, 'cust_after_sales_marked');
    assert.equal(order.issueType, 'logistics_damage');
    assert.equal(order.actionType, 'refund');
    assert.equal(order.status, 'waiting_refund');
    assert.equal(order.refundAmountCents, 1200);
    assert.equal(order.refundPaymentDetailId, sourcePaymentDetail.id);
    assert.equal(
      order.refundPaymentMethodNameSnapshot,
      sourcePaymentDetail.paymentMethodNameSnapshot,
    );
    assert.equal(order.refundOccurredAt, null);
    assert.equal(order.deductsPaymentServiceFee, false);
    assert.equal(order.financeConfirmed, false);
    assert.equal(order.salesOrder.orderNo, 'SO-AFTER-SALES-OWNER');
    assert.equal(order.salesOrder.status, 'valid');
    assert.equal(order.sourceSalesOrder.status, 'valid');
    assert.equal(order.afterSalesSalesOrder.orderType, 'after_sales');
    assert.equal(order.afterSalesSalesOrder.orderNo, order.afterSalesNo);
    assert.equal(order.afterSalesSalesOrder.sourceSalesOrderId, order.salesOrderId);
    assert.equal(order.afterSalesSalesOrder.totalAmountCents, 1200);
    assert.equal(order.afterSalesSalesOrder.paymentDetails.length, 1);
    assert.equal(
      order.afterSalesSalesOrder.paymentDetails[0].amountCents,
      1200,
    );
    assert.equal(
      order.afterSalesSalesOrder.paymentDetails[0]
        .paymentMethodCategorySnapshot,
      'direct_receipt',
    );
    assert.deepEqual(order.afterSalesSalesOrder.paymentSummary, {
      directReceiptAmountCents: 1200,
      collectOnDeliveryAmountCents: 0,
      confirmedCollectOnDeliveryAmountCents: 0,
      pendingCollectOnDeliveryAmountCents: 0,
      hasPendingCollectOnDelivery: false,
    });
    assert.equal(order.items.length, 1);
    assert.equal(
      order.items[0].sourceSalesOrderItemId,
      'so_after_sales_owner_item_1',
    );
    assert.equal(order.items[0].subtotalCents, 1200);
    assert.equal(order.items[0].returnRequired, false);
    assert.equal(order.items[0].expectedReturnQty, 0);
    assert.equal(order.items[0].postedReceivedQty, 0);
    assert.equal(order.items[0].remainingReturnQty, 0);
    assert.equal(order.items[0].returnProgressStatus, 'not_required');
    assert.equal(order.customer.name, 'After Sales Smoke Marked Customer');

    const unchangedSource = await prisma.salesOrder.findUnique({
      where: { id: 'so_after_sales_owner' },
      include: { items: true },
    });
    assert.equal(unchangedSource.status, 'VALID');
    assert.equal(unchangedSource.totalAmountCents, 99000);
    assert.equal(unchangedSource.items.length, 1);
    const adjustmentRecords = await prisma.commissionRecord.findMany({
      where: { afterSalesOrderId: order.id },
    });
    assert.equal(adjustmentRecords.length >= 2, true);
    assert.equal(
      adjustmentRecords.every(
        (record) =>
          record.amountCents <= 0 &&
          record.pointsCents <= 0 &&
          record.deductionAmountCents <= 0,
      ),
      true,
    );

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

test('contract: after-sales refund allocation validates integer and cumulative personal/normal bounds', async () => {
  await withNestApiServer(async (baseUrl) => {
    const afterSales = await login(
      baseUrl,
      'after_sales_user',
      TEST_PASSWORD,
    );
    const create = (refundAmountCents, personalPointsRefundAmountCents) =>
      requestJson(baseUrl, '/api/after-sales-orders', {
        method: 'POST',
        token: afterSales.token,
        body: {
          sourceSalesOrderId: 'so_after_sales_personal',
          issueType: 'quality_issue',
          actionType: 'refund',
          description: 'personal refund allocation contract',
          refundAmountCents,
          personalPointsRefundAmountCents,
          status: 'waiting_refund',
        },
      });

    const created = await create(2500, 1000);
    assert.equal(
      created.response.status,
      201,
      JSON.stringify(created.body),
    );
    assert.equal(
      created.body.data.afterSalesOrder
        .personalPointsRefundAmountCents,
      1000,
    );
    assert.equal(
      created.body.data.afterSalesOrder.normalPointsRefundAmountCents,
      1500,
    );
    assert.equal(
      created.body.data.afterSalesOrder.afterSalesSalesOrder
        .personalAmountCents,
      1000,
    );

    assertErrorContract(
      await create(1000, -1),
      400,
      'PERSONAL_REFUND_AMOUNT_OUT_OF_RANGE',
    );
    for (const value of [1.5, '100']) {
      const invalid = await create(1000, value);
      assertErrorContract(
        invalid,
        400,
        'PERSONAL_REFUND_AMOUNT_INVALID',
      );
    }
    assertErrorContract(
      await create(1000, 1001),
      400,
      'PERSONAL_REFUND_AMOUNT_OUT_OF_RANGE',
    );
    assertErrorContract(
      await create(2500, 2500),
      400,
      'PERSONAL_REFUND_AMOUNT_EXCEEDS_PERSONAL_TOTAL',
    );
    assertErrorContract(
      await create(6000, 0),
      400,
      'NORMAL_REFUND_AMOUNT_EXCEEDS_NORMAL_TOTAL',
    );
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

    const buybackSource = await requestJson(
      baseUrl,
      '/api/after-sales-orders',
      {
        method: 'POST',
        token: afterSales.token,
        body: {
          salesOrderId: 'so_after_sales_buyback',
          issueType: 'quality_issue',
          actionType: 'record_only',
          description: 'buyback cannot be used as a sales source',
        },
      },
    );
    assertErrorContract(
      buybackSource,
      400,
      'AFTER_SALES_SOURCE_ORDER_INVALID',
    );

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
          items: [
            {
              sourceSalesOrderItemId: 'so_after_sales_owner_item_1',
              quantity: 1,
              totalPriceCents: 1,
            },
          ],
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
          items: [
            {
              sourceSalesOrderItemId: 'so_after_sales_owner_item_1',
              quantity: 1,
              totalPriceCents: 1,
            },
          ],
        },
      },
    );
    assertErrorContract(invalidRefund, 400, 'VALIDATION_FAILED');
  }, createAfterSalesTestOptions());
});

test('contract: after-sales item validation enforces source membership, quantity and refund sum', async () => {
  await withNestApiServer(async (baseUrl) => {
    const afterSales = await login(baseUrl, 'after_sales_user', TEST_PASSWORD);
    const create = (body) =>
      requestJson(baseUrl, '/api/after-sales-orders', {
        method: 'POST',
        token: afterSales.token,
        body: {
          sourceSalesOrderId: 'so_after_sales_other',
          issueType: 'quality_issue',
          actionType: 'refund',
          description: 'item validation smoke test',
          ...body,
        },
      });

    const wrongSource = await create({
      refundAmountCents: 100,
      items: [
        {
          sourceSalesOrderItemId: 'so_after_sales_owner_item_1',
          quantity: 1,
          totalPriceCents: 100,
        },
      ],
    });
    assertErrorContract(
      wrongSource,
      400,
      'AFTER_SALES_ITEM_NOT_IN_SOURCE_ORDER',
    );

    const excessiveQuantity = await create({
      refundAmountCents: 200,
      items: [
        {
          sourceSalesOrderItemId: 'so_after_sales_other_item_1',
          quantity: 2,
          totalPriceCents: 200,
        },
      ],
    });
    assertErrorContract(
      excessiveQuantity,
      400,
      'AFTER_SALES_ITEM_QUANTITY_EXCEEDED',
    );

    const mismatchedRefund = await create({
      refundAmountCents: 199,
      items: [
        {
          sourceSalesOrderItemId: 'so_after_sales_other_item_1',
          quantity: 1,
          totalPriceCents: 200,
        },
      ],
    });
    assertErrorContract(
      mismatchedRefund,
      400,
      'AFTER_SALES_REFUND_AMOUNT_MISMATCH',
    );

    const recordOnly = await create({
      actionType: 'record_only',
      refundAmountCents: 0,
      items: [],
    });
    assert.equal(recordOnly.response.status, 201);
    assert.deepEqual(recordOnly.body.data.afterSalesOrder.items, []);
    assert.equal(
      recordOnly.body.data.afterSalesOrder.afterSalesSalesOrder
        .totalAmountCents,
      0,
    );
  }, createAfterSalesTestOptions());
});

test('contract: after-sales transaction rolls back generated order on partial failure', async () => {
  await withNestApiServer(
    async (baseUrl, { prisma }) => {
      const afterSales = await login(
        baseUrl,
        'after_sales_user',
        TEST_PASSWORD,
      );
      const failed = await requestJson(baseUrl, '/api/after-sales-orders', {
        method: 'POST',
        token: afterSales.token,
        body: {
          sourceSalesOrderId: 'so_after_sales_other',
          issueType: 'quality_issue',
          actionType: 'refund',
          description: 'transaction rollback smoke test',
          refundAmountCents: 100,
          items: [
            {
              sourceSalesOrderItemId: 'so_after_sales_other_item_1',
              quantity: 1,
              totalPriceCents: 100,
            },
          ],
        },
      });
      assert.equal(failed.response.status, 500);
      const generatedOrders = await prisma.salesOrder.findMany({
        where: { orderType: 'AFTER_SALES' },
      });
      assert.deepEqual(generatedOrders, []);
      const createdAfterSales = await prisma.afterSalesOrder.findMany({
        where: { description: 'transaction rollback smoke test' },
      });
      assert.deepEqual(createdAfterSales, []);
    },
    {
      ...createAfterSalesTestOptions(),
      prisma: {
        ...createAfterSalesTestOptions().prisma,
        failAfterSalesOrderCreateOnce: true,
      },
    },
  );
});

test('contract: finance rows expose and export after-sales as numeric negative entries', async () => {
  await withNestApiServer(async (baseUrl) => {
    const afterSales = await login(baseUrl, 'after_sales_user', TEST_PASSWORD);
    const finance = await login(baseUrl, 'finance_user', TEST_PASSWORD);
    const created = await requestJson(baseUrl, '/api/after-sales-orders', {
      method: 'POST',
      token: afterSales.token,
      body: {
        sourceSalesOrderId: 'so_after_sales_owner',
        issueType: 'quality_issue',
        actionType: 'refund',
        description: 'finance negative row smoke test',
        refundAmountCents: 1200,
        items: [
          {
            sourceSalesOrderItemId: 'so_after_sales_owner_item_1',
            quantity: 1,
            totalPriceCents: 1200,
          },
        ],
      },
    });
    assert.equal(created.response.status, 201);
    const afterSalesOrder = created.body.data.afterSalesOrder;

    const listed = await requestJson(
      baseUrl,
      '/api/travel-group-finance-summaries/finance-rows?limit=200',
      { token: finance.token },
    );
    assert.equal(listed.response.status, 200);
    const row = listed.body.data.financeRows.find(
      (item) => item.financeRowId === `after_sales:${afterSalesOrder.id}`,
    );
    assert.ok(row);
    assert.equal(row.rowKind, 'after_sales_adjustment');
    assert.equal(row.orderType, 'after_sales');
    assert.equal(row.afterSalesNo, afterSalesOrder.afterSalesNo);
    assert.equal(row.sourceSalesOrderNo, 'SO-AFTER-SALES-OWNER');
    assert.equal(row.totalSalesAmountCents, -1200);
    assert.equal(row.effectiveSalesAmountCents, -1200);
    assert.equal(row.financialAmountsReady, false);
    assert.equal(row.includedInFormalTotals, false);

    const exported = await fetch(
      `${baseUrl}/api/travel-group-finance-summaries/finance-rows/export`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${finance.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          financeRowIds: [row.financeRowId],
        }),
      },
    );
    assert.equal(exported.status, 200);
    assert.equal(
      exported.headers.get('content-type'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await exported.arrayBuffer());
    const worksheet = workbook.worksheets[0];
    const headers = worksheet.getRow(1).values;
    const salesColumn = headers.indexOf('销售额调整');
    const rowIdColumn = headers.indexOf('财务行ID');
    assert.equal(worksheet.getCell(2, rowIdColumn).value, row.financeRowId);
    assert.equal(typeof worksheet.getCell(2, salesColumn).value, 'number');
    assert.equal(worksheet.getCell(2, salesColumn).value, -12);
  }, createAfterSalesTestOptions());
});

test('contract: after-sales order list supports documented filters', async () => {
  await withNestApiServer(async (baseUrl) => {
    const admin = await login(baseUrl, 'admin');
    const afterSales = await login(baseUrl, 'after_sales_user', TEST_PASSWORD);
    const finance = await login(baseUrl, 'finance_user', TEST_PASSWORD);

    const allOrders = await requestJson(baseUrl, '/api/after-sales-orders', {
      token: admin.token,
    });
    assert.equal(allOrders.response.status, 200);
    assert.equal(
      allOrders.body.data.afterSalesOrders.some(
        (order) => order.status === 'completed',
      ),
      true,
    );

    for (const token of [admin.token, afterSales.token]) {
      const unfinished = await requestJson(
        baseUrl,
        '/api/after-sales-orders?unfinished=true&limit=200',
        { token },
      );
      assert.equal(unfinished.response.status, 200);
      assert.equal(unfinished.body.data.afterSalesOrders.length > 0, true);
      assert.equal(
        unfinished.body.data.afterSalesOrders.every(
          (order) => order.status !== 'completed',
        ),
        true,
      );
      assert.equal(
        unfinished.body.data.afterSalesOrders.some(
          (order) => order.afterSalesNo === 'AS20260701003',
        ),
        false,
      );
    }

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

    const exactCompleted = await requestJson(
      baseUrl,
      '/api/after-sales-orders?status=completed',
      {
        token: admin.token,
      },
    );
    assert.equal(exactCompleted.response.status, 200);
    assert.equal(exactCompleted.body.data.afterSalesOrders.length > 0, true);
    assert.equal(
      exactCompleted.body.data.afterSalesOrders.every(
        (order) => order.status === 'completed',
      ),
      true,
    );

    const conflictingFilters = await requestJson(
      baseUrl,
      '/api/after-sales-orders?unfinished=true&status=completed',
      {
        token: admin.token,
      },
    );
    assert.equal(conflictingFilters.response.status, 200);
    assert.deepEqual(conflictingFilters.body.data.afterSalesOrders, []);

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
        afterEnable.body.data.afterSalesOrders.map((order) => order.id).sort(),
        ['as_global_marked', 'as_global_unmarked_group'],
      );
      for (const order of afterEnable.body.data.afterSalesOrders) {
        assertNoShippedFields(order);
      }

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
      assert.equal(hiddenGroupDetail.response.status, 200);
      assertNoShippedFields(hiddenGroupDetail.body.data.afterSalesOrder);
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
          description: 'smoke test updated logistics damage description',
          resolution: 'smoke test updated exchange resolution',
          notes: 'smoke test updated after sales notes',
        },
      },
    );
    assert.equal(patched.response.status, 200);
    const order = patched.body.data.afterSalesOrder;
    assertAfterSalesOrderContract(order);
    assert.equal(order.afterSalesNo, 'AS20260701001');
    assert.equal(order.issueType, 'logistics_damage');
    assert.equal(order.actionType, 'refund');
    assert.equal(order.description, 'smoke test updated logistics damage description');
    assert.equal(order.resolution, 'smoke test updated exchange resolution');
    assert.equal(order.refundAmountCents, 1000);
    assert.equal(order.notes, 'smoke test updated after sales notes');
    assert.equal(order.status, 'waiting_refund');
    assert.equal(order.salesOrder.status, 'valid');
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
    assert.equal(updateLog.afterData.actionType, 'refund');
    assert.equal(updateLog.afterData.refundAmountCents, 1000);
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

test('contract: after-sales status changes never mutate source sales orders or travel-group totals', async () => {
  await withNestApiServer(async (baseUrl) => {
    const admin = await login(baseUrl, 'admin');
    const afterSales = await login(baseUrl, 'after_sales_user', TEST_PASSWORD);

    const cases = [
      ['as_partial_refund', 'waiting_refund', 'valid', 10000],
      ['as_full_refund', 'completed', 'valid', 3000],
      ['as_cancel_order', 'completed', 'valid', 6000],
      ['as_resend_no_refund', 'completed', 'valid', 7000],
    ];
    for (const [id, status, sourceStatus, totalAmountCents] of cases) {
      const response = await requestJson(
        baseUrl,
        `/api/after-sales-orders/${id}/status`,
        {
          method: 'PATCH',
          token: afterSales.token,
          body: {
            status,
            notes: `smoke test ${id} status transition`,
          },
        },
      );
      assert.equal(response.response.status, 200);
      assert.equal(
        response.body.data.afterSalesOrder.salesOrder.status,
        sourceStatus,
      );
      assert.equal(
        response.body.data.afterSalesOrder.salesOrder.totalAmountCents,
        totalAmountCents,
      );
    }

    for (const travelGroupId of [
      'tg_after_sales_partial',
      'tg_after_sales_full',
      'tg_after_sales_cancel',
    ]) {
      const group = await requestJson(
        baseUrl,
        `/api/travel-groups/${travelGroupId}`,
        { token: admin.token },
      );
      assert.equal(group.response.status, 200);
      assert.equal(group.body.data.travelGroup.status, 'unmarked');
      assert.equal(group.body.data.travelGroup.salesAmountCents, 0);
      assert.equal(group.body.data.travelGroup.orderSummary.orderCount, 1);
    }

    const salesLogs = await requestJson(
      baseUrl,
      '/api/operation-logs?entityType=sales_order',
      {
        token: admin.token,
      },
    );
    assert.equal(salesLogs.response.status, 200);
    assert.equal(
      salesLogs.body.data.logs.some((log) =>
        [
          'so_after_sales_partial',
          'so_after_sales_full',
          'so_after_sales_cancel',
          'so_after_sales_resend',
        ].includes(log.entityId),
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
      'valid',
    );
  }, createAfterSalesTestOptions());
});

test('contract: after-sales creation rejects cumulative refund above source order total', async () => {
  await withNestApiServer(async (baseUrl) => {
    const admin = await login(baseUrl, 'admin');
    const afterSales = await login(baseUrl, 'after_sales_user', TEST_PASSWORD);

    const denied = await requestJson(
      baseUrl,
      '/api/after-sales-orders',
      {
        method: 'POST',
        token: afterSales.token,
        body: {
          sourceSalesOrderId: 'so_after_sales_over_refund',
          issueType: 'quality_issue',
          actionType: 'refund',
          description: 'new refund exceeds cumulative source total',
          refundAmountCents: 300,
          items: [
            {
              sourceSalesOrderItemId: 'so_after_sales_over_refund_item_1',
              quantity: 1,
              totalPriceCents: 300,
            },
          ],
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

test('contract: same-day refund confirmation exposes safe payment options and rejects missing, forged, or overdrawn allocations before storage', async () => {
  await withTemporaryRefundProofStorage(async (storageRoot) => {
    await withNestApiServer(
      async (baseUrl, { prisma, stores }) => {
        const finance = await login(
          baseUrl,
          'finance_user',
          TEST_PASSWORD,
        );
        const afterSales = await login(
          baseUrl,
          'after_sales_user',
          TEST_PASSWORD,
        );
        const [sourcePaymentDetail] =
          await prisma.salesOrderPaymentDetail.findMany({
            where: { salesOrderId: 'so_after_sales_owner' },
          });
        assert.ok(sourcePaymentDetail);
        const today = parseDateOnly(formatShanghaiDate(new Date()));
        const confirmationTime = new Date();
        await prisma.salesOrder.update({
          where: { id: 'so_after_sales_owner' },
          data: {
            orderDate: today,
          },
        });
        await prisma.salesOrderPaymentDetail.update({
          where: { id: sourcePaymentDetail.id },
          data: {
            amountCents: 5000,
          },
        });
        await prisma.afterSalesOrder.update({
          where: { id: 'as_owner_completed' },
          data: {
            refundPaymentDetailId: sourcePaymentDetail.id,
            refundPaymentMethodNameSnapshot:
              sourcePaymentDetail.paymentMethodNameSnapshot,
            refundOccurredAt: confirmationTime,
            deductsPaymentServiceFee: true,
          },
        });
        const sourceWithRefunds = await prisma.salesOrder.findUnique({
          where: { id: 'so_after_sales_owner' },
          include: {
            afterSalesOrders: true,
          },
        });
        const allocatedSibling =
          sourceWithRefunds.afterSalesOrders.find(
            (order) => order.id === 'as_owner_completed',
          );
        assert.equal(allocatedSibling.financeConfirmed, true);
        assert.equal(
          allocatedSibling.refundPaymentDetailId,
          sourcePaymentDetail.id,
        );
        assert.equal(
          isSameShanghaiNaturalDay(
            sourceWithRefunds.orderDate,
            allocatedSibling.refundOccurredAt,
          ),
          true,
        );

        const financeDetail = await requestJson(
          baseUrl,
          '/api/after-sales-orders/as_owner_refund',
          { token: finance.token },
        );
        assert.equal(financeDetail.response.status, 200);
        const financeOrder =
          financeDetail.body.data.afterSalesOrder;
        assert.equal(financeOrder.refundTimingStatus, 'same_day');
        assert.equal(financeOrder.isSameDayRefund, true);
        assert.equal(
          financeOrder.requiresRefundPaymentDetail,
          true,
        );
        const paymentOption =
          financeOrder.refundPaymentDetailOptions.find(
            (option) => option.id === sourcePaymentDetail.id,
          );
        assert.deepEqual(paymentOption, {
          id: sourcePaymentDetail.id,
          paymentMethodNameSnapshot:
            sourcePaymentDetail.paymentMethodNameSnapshot,
          originalAmountCents: 5000,
          confirmedSameDayRefundAmountCents: 2000,
          remainingRefundableAmountCents: 3000,
        });
        assert.equal(
          Object.keys(paymentOption).some((key) =>
            /customer|phone|address/i.test(key),
          ),
          false,
        );

        const nonFinanceDetail = await requestJson(
          baseUrl,
          '/api/after-sales-orders/as_owner_refund',
          { token: afterSales.token },
        );
        assert.equal(nonFinanceDetail.response.status, 200);
        assert.equal(
          Object.hasOwn(
            nonFinanceDetail.body.data.afterSalesOrder,
            'refundPaymentDetailOptions',
          ),
          false,
        );

        const missing = await uploadRefundProofs(
          baseUrl,
          finance.token,
          'as_owner_refund',
          [validRefundProofFile('missing-selection.png')],
        );
        assertErrorContract(
          missing,
          409,
          'SAME_DAY_REFUND_PAYMENT_DETAIL_REQUIRED',
        );

        const forged = await uploadRefundProofs(
          baseUrl,
          finance.token,
          'as_owner_refund',
          [validRefundProofFile('forged-selection.png')],
          { refundPaymentDetailId: 'forged-payment-detail' },
        );
        assertErrorContract(
          forged,
          409,
          'REFUND_PAYMENT_DETAIL_INVALID',
        );

        await prisma.afterSalesOrder.update({
          where: { id: 'as_owner_refund' },
          data: {
            refundAmountCents: 3001,
          },
        });
        const excessive = await uploadRefundProofs(
          baseUrl,
          finance.token,
          'as_owner_refund',
          [validRefundProofFile('overdrawn.png')],
          { refundPaymentDetailId: sourcePaymentDetail.id },
        );
        assertErrorContract(
          excessive,
          409,
          'REFUND_AMOUNT_EXCEEDS_PAYMENT_DETAIL_BALANCE',
        );

        const stored = await prisma.afterSalesOrder.findUnique({
          where: { id: 'as_owner_refund' },
        });
        assert.equal(stored.financeConfirmed, false);
        assert.equal(stored.refundOccurredAt ?? null, null);
        assert.equal(stored.deductsPaymentServiceFee, false);
        assert.deepEqual(await fs.readdir(storageRoot), []);
        assert.deepEqual(
          await fs.readdir(stores.attachmentTempDir),
          [],
        );
      },
      {
        ...createAfterSalesTestOptions(),
        env: { TRAVEL_GROUP_ATTACHMENT_DIR: storageRoot },
      },
    );
  });
});

test('contract: finance refund confirmation requires and stores proof attachments', async () => {
  await withTemporaryRefundProofStorage(async (storageRoot) => {
    await withNestApiServer(
      async (baseUrl, { prisma }) => {
        const admin = await login(baseUrl, 'admin');
        const finance = await login(baseUrl, 'finance_user', TEST_PASSWORD);
        const [sourcePaymentDetail] =
          await prisma.salesOrderPaymentDetail.findMany({
            where: { salesOrderId: 'so_after_sales_owner' },
          });
        assert.ok(sourcePaymentDetail);
        await prisma.salesOrder.update({
          where: { id: 'so_after_sales_owner' },
          data: {
            orderDate: parseDateOnly(formatShanghaiDate(new Date())),
          },
        });
        await prisma.afterSalesOrder.update({
          where: { id: 'as_owner_refund' },
          data: {
            refundPaymentDetailId: sourcePaymentDetail.id,
            refundPaymentMethodNameSnapshot:
              sourcePaymentDetail.paymentMethodNameSnapshot,
          },
        });

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
          { refundPaymentDetailId: sourcePaymentDetail.id },
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
          { refundPaymentDetailId: sourcePaymentDetail.id },
        );
        assert.equal(confirmed.response.status, 201);
        const confirmedOrder = confirmed.body.data.afterSalesOrder;
        assertAfterSalesOrderContract(confirmedOrder);
        assert.equal(confirmedOrder.financeConfirmed, true);
        assert.equal(confirmedOrder.financeConfirmedById, 'usr_finance');
        assert.ok(Date.parse(confirmedOrder.financeConfirmedAt));
        assert.ok(Date.parse(confirmedOrder.refundOccurredAt));
        assert.equal(
          confirmedOrder.refundPaymentDetailId,
          sourcePaymentDetail.id,
        );
        assert.equal(confirmedOrder.deductsPaymentServiceFee, true);
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
        const firstRefundOccurredAt =
          confirmedOrder.refundOccurredAt;
        const firstProofId =
          confirmedOrder.refundProofAttachments[0].id;

        const repeated = await uploadRefundProofs(
          baseUrl,
          finance.token,
          'as_owner_refund',
          [validRefundProofFile('duplicate-proof.png')],
          { refundPaymentDetailId: sourcePaymentDetail.id },
        );
        assert.equal(repeated.response.status, 201);
        assert.equal(
          repeated.body.data.afterSalesOrder.refundOccurredAt,
          firstRefundOccurredAt,
        );
        assert.deepEqual(
          repeated.body.data.afterSalesOrder.refundProofAttachments.map(
            (attachment) => attachment.id,
          ),
          [firstProofId],
        );
        assert.equal((await fs.readdir(storageRoot)).length, 1);

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
        assert.equal(cancelledOrder.refundOccurredAt, null);
        assert.equal(cancelledOrder.refundPaymentDetailId, null);
        assert.equal(
          cancelledOrder.refundPaymentMethodNameSnapshot,
          null,
        );
        assert.equal(
          cancelledOrder.deductsPaymentServiceFee,
          false,
        );
        assert.equal(cancelledOrder.refundProofAttachments.length, 0);
        assert.equal(cancelledOrder.updatedById, 'usr_admin');
        assert.deepEqual(await fs.readdir(storageRoot), []);

        const ignoredAfterCancellation = calculateOrderProfitFees({
          financeMark: true,
          status: 'VALID',
          orderDate: parseDateOnly(formatShanghaiDate(new Date())),
          totalAmountCents: 5000,
          taxRateSnapshot: '0.01',
          paymentDetails: [
            {
              id: sourcePaymentDetail.id,
              paymentMethodId: sourcePaymentDetail.paymentMethodId,
              paymentMethodNameSnapshot:
                sourcePaymentDetail.paymentMethodNameSnapshot,
              serviceFeeRateSnapshot: '0.01',
              serviceFeeBaseAmountSnapshotCents: 5000,
            },
          ],
          afterSalesOrders: [
            await prisma.afterSalesOrder.findUnique({
              where: { id: 'as_owner_refund' },
            }),
          ],
        });
        assert.equal(
          ignoredAfterCancellation.paymentDetails[0]
            .sameDayRefundAmountCents,
          0,
        );
        assert.equal(
          ignoredAfterCancellation.paymentServiceFeeCents,
          50,
        );

        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        await prisma.salesOrder.update({
          where: { id: 'so_after_sales_owner' },
          data: {
            orderDate: parseDateOnly(
              formatShanghaiDate(yesterday),
            ),
          },
        });
        const reconfirmed = await uploadRefundProofs(
          baseUrl,
          finance.token,
          'as_owner_refund',
          [validRefundProofFile('cross-day-proof.png')],
        );
        assert.equal(reconfirmed.response.status, 201);
        assert.equal(
          reconfirmed.body.data.afterSalesOrder.refundTimingStatus,
          'cross_day',
        );
        assert.equal(
          reconfirmed.body.data.afterSalesOrder.refundPaymentDetailId,
          null,
        );
        assert.equal(
          reconfirmed.body.data.afterSalesOrder
            .refundPaymentMethodNameSnapshot,
          null,
        );
        assert.equal(
          reconfirmed.body.data.afterSalesOrder
            .deductsPaymentServiceFee,
          false,
        );
        assert.ok(
          Date.parse(
            reconfirmed.body.data.afterSalesOrder.refundOccurredAt,
          ),
        );

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

test('contract: finance refund confirmation cleans temporary and permanent proof files when the database transaction fails', async () => {
  await withTemporaryRefundProofStorage(async (storageRoot) => {
    await withNestApiServer(
      async (baseUrl, { prisma, stores }) => {
        const finance = await login(
          baseUrl,
          'finance_user',
          TEST_PASSWORD,
        );
        const failed = await uploadRefundProofs(
          baseUrl,
          finance.token,
          'as_owner_refund',
          [validRefundProofFile('transaction-failure.png')],
        );
        assertErrorContract(failed, 500, 'INTERNAL_ERROR');
        assert.deepEqual(await fs.readdir(storageRoot), []);
        assert.deepEqual(
          await fs.readdir(stores.attachmentTempDir),
          [],
        );
        const persisted = await prisma.afterSalesOrder.findUnique({
          where: { id: 'as_owner_refund' },
        });
        assert.equal(persisted.financeConfirmed, false);
        assert.deepEqual(persisted.refundProofAttachments, []);
        assert.equal(persisted.refundOccurredAt ?? null, null);
      },
      {
        ...createAfterSalesTestOptions(),
        prisma: {
          ...createAfterSalesTestOptions().prisma,
          failAfterSalesOrderUpdateOnce: true,
        },
        env: { TRAVEL_GROUP_ATTACHMENT_DIR: storageRoot },
      },
    );
  });
});

test('contract: finance can fill manual after-sales liquor cost but cannot override rate mode', async () => {
  await withNestApiServer(async (baseUrl, { prisma }) => {
    const finance = await login(baseUrl, 'finance_user', TEST_PASSWORD);
    const afterSales = await login(baseUrl, 'after_sales_user', TEST_PASSWORD);

    const deniedRole = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_waiting_receive/agency-deduction',
      {
        method: 'PATCH',
        token: afterSales.token,
        body: { agencyDeductionAdjustmentCents: 100 },
      },
    );
    assertErrorContract(deniedRole, 403, 'PERMISSION_DENIED');

    const excessive = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_waiting_receive/agency-deduction',
      {
        method: 'PATCH',
        token: finance.token,
        body: { agencyDeductionAdjustmentCents: 501 },
      },
    );
    assertErrorContract(
      excessive,
      400,
      'AFTER_SALES_DEDUCTION_EXCEEDS_REFUND',
    );

    const updated = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_waiting_receive/agency-deduction',
      {
        method: 'PATCH',
        token: finance.token,
        body: { agencyDeductionAdjustmentCents: 100 },
      },
    );
    assert.equal(updated.response.status, 200);
    assert.equal(
      updated.body.data.afterSalesOrder.agencyDeductionAdjustmentCents,
      100,
    );
    const records = await prisma.commissionRecord.findMany({
      where: { afterSalesOrderId: 'as_waiting_receive' },
    });
    assert.equal(records.length >= 2, true);
    assert.equal(records.every((record) => record.pointsCents <= 0), true);

    const automatic = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_partial_refund/agency-deduction',
      {
        method: 'PATCH',
        token: finance.token,
        body: { agencyDeductionAdjustmentCents: 100 },
      },
    );
    assertErrorContract(
      automatic,
      400,
      'AFTER_SALES_DEDUCTION_NOT_MANUAL',
    );
  }, createAfterSalesTestOptions());
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
              content: Buffer.from(
                '%PDF-1.4\n1 0 obj\n<<>>\nendobj\n' +
                  'trailer\n<<>>\nstartxref\n9\n%%EOF\n',
              ),
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
    assertErrorContract(invalidRefund, 403, 'FIELD_PERMISSION_DENIED');
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
        createSalesOrderSeed({
          id: 'so_after_sales_personal',
          orderNo: 'SO-AFTER-SALES-PERSONAL',
          customerId: 'cust_after_sales_other',
          customerName: 'After Sales Personal Split Customer',
          customerPhone: '13800007002',
          totalAmountCents: 10000,
          personalAmountCents: 3000,
          pointsDestination: 'GUIDE_PERSONAL',
          salesUserId: 'usr_sales_other',
          createdById: 'usr_sales_other',
        }),
        createSalesOrderSeed({
          id: 'so_after_sales_buyback',
          orderNo: 'SO-AFTER-SALES-BUYBACK',
          orderType: 'BUYBACK',
          customerId: 'cust_after_sales_link',
          customerName: 'After Sales Smoke Link Customer',
          totalAmountCents: 5000,
          salesUserId: 'usr_sales_owner',
          createdById: 'usr_sales_owner',
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
          agencyDeductionAdjustmentCents: 100,
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
          deductionCalculationMode: 'effective_sales_rate',
          sourceAgencyDeductionCents: 1000,
          agencyDeductionAdjustmentCents: 300,
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
          customerId: 'cust_as_global_unmarked',
          customerName: 'After Sales Global Smoke Unmarked Customer',
          customerPhone: '13800007102',
          orderDate: '2026-07-05T00:00:00.000Z',
          totalAmountCents: 1000,
        }),
        createSalesOrderSeed({
          id: 'so_as_global_unmarked_customer',
          orderNo: 'SO-AS-GLOBAL-UNMARKED-CUSTOMER',
          customerId: 'cust_as_global_marked',
          customerName: 'After Sales Global Smoke Marked Customer',
          customerPhone: '13800007101',
          orderDate: '2026-07-05T00:00:00.000Z',
          totalAmountCents: 1000,
          financeMark: false,
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

function validRefundProofFile(name = 'refund-proof.png') {
  return {
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
    name,
    type: 'image/png',
  };
}

async function uploadRefundProofs(
  baseUrl,
  token,
  afterSalesOrderId,
  files,
  fields = {},
) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) {
      form.append(name, String(value));
    }
  }
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
  const items = overrides.items || [
    {
      id: `${overrides.id}_item_1`,
      productName: 'Smoke Test Wine',
      quantity: 1,
      unitPriceCents: overrides.totalAmountCents ?? 99000,
      deliveryType: 'SHIPPING',
    },
  ];
  return {
    orderType: 'EXTERNAL',
    orderDate: '2026-07-01T00:00:00.000Z',
    totalAmountCents: 99000,
    packingStatus: 'PACKED',
    financeMark: true,
    ...overrides,
    items,
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
  const expectedKeys = [
    'actionType',
    'afterSalesNo',
    'afterSalesSalesOrder',
    'afterSalesSalesOrderId',
    'agencyDeductionAdjustmentCents',
    'agencyDeductionRate',
    'agencyDeductionRuleId',
    'agencyRebateRuleId',
    'calculationDate',
    'completedAt',
    'createdAt',
    'createdById',
    'customer',
    'customerId',
    'dailyRebateRate',
    'deductionCalculationMode',
    'deductsPaymentServiceFee',
    'description',
    'financeConfirmed',
    'financeConfirmedAt',
    'financeConfirmedById',
    'financialEffectStatus',
    'handledAt',
    'handledById',
    'id',
    'issueType',
    'items',
    'monthlyRebateRate',
    'normalPointsRefundAmountCents',
    'notes',
    'personalPointsRefundAmountCents',
    'refundAmountCents',
    'refundOccurredAt',
    'refundPaymentDetailId',
    'refundPaymentMethodNameSnapshot',
    'refundProofAttachments',
    'resolution',
    'salesOrder',
    'salesOrderId',
    'sourceAgencyDeductionCents',
    'sourceSalesOrder',
    'sourceSalesOrderId',
    'status',
    'updatedAt',
    'updatedById',
    'warehouseConfirmNote',
    'warehouseConfirmedAt',
    'warehouseConfirmedById',
  ];
  if (Object.hasOwn(order, 'refundTimingStatus')) {
    expectedKeys.push(
      'isSameDayRefund',
      'refundPaymentDetailOptions',
      'refundTimingStatus',
      'requiresRefundPaymentDetail',
    );
  }
  assert.deepEqual(Object.keys(order).sort(), expectedKeys.sort());
  assert.equal(typeof order.id, 'string');
  assert.equal(typeof order.afterSalesNo, 'string');
  assert.equal(typeof order.salesOrderId, 'string');
  assert.equal(typeof order.sourceSalesOrderId, 'string');
  assert.equal(typeof order.issueType, 'string');
  assert.equal(typeof order.actionType, 'string');
  assert.equal(typeof order.description, 'string');
  assert.equal(typeof order.refundAmountCents, 'number');
  assert.equal(typeof order.deductsPaymentServiceFee, 'boolean');
  if (Object.hasOwn(order, 'refundTimingStatus')) {
    assert.equal(typeof order.isSameDayRefund, 'boolean');
    assert.equal(typeof order.requiresRefundPaymentDetail, 'boolean');
    assert.equal(Array.isArray(order.refundPaymentDetailOptions), true);
  }
  assert.equal(typeof order.status, 'string');
  assert.equal(typeof order.financeConfirmed, 'boolean');
  assert.equal(Array.isArray(order.refundProofAttachments), true);
  assert.equal(Array.isArray(order.items), true);
  assert.equal(typeof order.createdAt, 'string');
  assert.equal(typeof order.updatedAt, 'string');
  assertNoShippedFields(order);
  assertNoStorageLocation(order);
  const serialized = JSON.stringify(order);
  for (const internalField of [
    'fulfillmentWarehouseId',
    'inventoryAppliedAt',
    'inventoryPolicyVersion',
    'inventoryVersion',
    'inventoryLineKey',
    'onHandQty',
    'availableQty',
    'shortageQty',
    'purchaseUnitCostCents',
    'inventoryAmountCents',
  ]) {
    assert.equal(
      serialized.includes(internalField),
      false,
      `after-sales DTO must not expose ${internalField}`,
    );
  }
}
