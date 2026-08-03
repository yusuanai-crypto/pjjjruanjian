const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  assertOperationLogContract,
  createUser,
  login,
  requestJsonWithStage10ProductFixtures: requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');
const {
  buildShanghaiNaturalDayRange,
  formatShanghaiBusinessDate,
} = require('../src/modules/business-data/reconciliation-calculation.helper');

const SHANGHAI_TODAY = formatShanghaiBusinessDate(new Date());
const SHANGHAI_TOMORROW = shiftShanghaiBusinessDate(SHANGHAI_TODAY, 1);
const SHANGHAI_DAY_AFTER_TOMORROW = shiftShanghaiBusinessDate(
  SHANGHAI_TODAY,
  2,
);

test('contract: business data APIs persist travel groups, orders, reconciliation, and bonus awards', async () => {
  await withPhase1Server(async (baseUrl) => {
    const missingToken = await requestJson(baseUrl, '/api/travel-groups');
    assertErrorContract(missingToken, 401, 'AUTH_TOKEN_REQUIRED');

    const admin = await login(baseUrl);
    const taster = await createUser(baseUrl, admin.token, {
      name: 'Business Taster',
      username: 'business-taster',
      password: 'Password123',
      role: 'taster',
    });
    const financeUser = await createUser(baseUrl, admin.token, {
      name: 'Business Reconciliation Finance',
      username: 'business-reconciliation-finance',
      password: 'Password123',
      role: 'finance',
    });
    const finance = await login(
      baseUrl,
      financeUser.username,
      'Password123',
    );
    const guide = await createGuideFixture(baseUrl, admin.token, {
      name: 'Business Guide',
      phone: '13910000001',
      travelAgency: 'Business Snapshot Agency',
    });
    const createdGroup = await requestJson(baseUrl, '/api/travel-groups', {
      method: 'POST',
      token: admin.token,
      body: {
        groupNo: 'CLIENT-GROUP-NO-IGNORED',
        visitDate: '2026-06-23',
        travelAgency: 'Business Input Agency',
        licensePlate: 'GZA12345',
        guideId: guide.id,
        guestCount: 18,
        cigaretteFeeCents: 2050,
        tastingRoomNo: 'Business Room',
        tasterId: taster.id,
        groupType: '其他',
        arrivalTime: '09:00',
        salesAmountCents: 0,
        paidDepositCents: 10000,
        cashOnDeliveryCents: 0,
        liquorCostDeductionCents: 0,
        orderAmountCents: 0,
        points: 0,
        returnedPoints: 0,
        unreturnedPoints: 0,
        guideInfoSent: false,
        travelAgencyInfoSent: true,
      },
    });
    assert.equal(createdGroup.response.status, 201);
    assert.equal(createdGroup.body.data.travelGroup.groupNo, 'TG20260623001');
    assert.equal(
      createdGroup.body.data.travelGroup.travelAgency,
      'Business Input Agency',
    );
    assert.equal(createdGroup.body.data.travelGroup.guideName, guide.name);
    assert.equal(createdGroup.body.data.travelGroup.guidePhone, guide.phone);
    assert.equal(createdGroup.body.data.travelGroup.parkingFeeCents, 500);
    assert.equal(createdGroup.body.data.travelGroup.cigaretteFeeCents, 2050);
    assert.equal(createdGroup.body.data.travelGroup.travelAgencyInfoSent, true);
    assertTravelGroupDtoCore(createdGroup.body.data.travelGroup);
    assert.deepEqual(createdGroup.body.data.travelGroup.tastingItems, []);
    assert.equal(createdGroup.body.data.travelGroup.tasterSummary, null);
    assert.equal(createdGroup.body.data.travelGroup.tasterSummaryAt, null);
    assert.equal(
      createdGroup.body.data.travelGroup.pendingStatus,
      'pending_sales',
    );
    assert.ok(
      createdGroup.body.data.travelGroup.pendingReasons.includes(
        'missing_departure_time',
      ),
    );
    assert.ok(
      createdGroup.body.data.travelGroup.pendingReasons.includes(
        'loss_not_confirmed',
      ),
    );

    const groupList = await requestJson(
      baseUrl,
      '/api/travel-groups?dateFrom=2026-06-23&dateTo=2026-06-23',
      {
        token: admin.token,
      },
    );
    assert.equal(groupList.response.status, 200);
    assert.equal(groupList.body.data.travelGroups.length, 1);
    assertTravelGroupDtoCore(groupList.body.data.travelGroups[0]);
    assert.deepEqual(groupList.body.data.travelGroups[0].tastingItems, []);

    const createdPendingGroup = await requestJson(
      baseUrl,
      '/api/pending-travel-groups',
      {
        method: 'POST',
        token: admin.token,
        body: {
          groupNo: 'PD-TEST-001',
          visitDate: '2026-06-23',
          travelAgency: '待处理旅行社',
          guideName: '待处理导游',
          guidePhone: '13800003333',
          guestCount: 9,
          tastingRoomNo: '待处理馆',
          tasterName: '待处理品鉴师',
          groupType: '渠道团',
        },
      },
    );
    assert.equal(createdPendingGroup.response.status, 201);
    assert.equal(
      createdPendingGroup.body.data.pendingTravelGroup.groupNo,
      'PD-TEST-001',
    );

    const pendingGroupList = await requestJson(
      baseUrl,
      '/api/pending-travel-groups?dateFrom=2026-06-23&dateTo=2026-06-23',
      {
        token: admin.token,
      },
    );
    assert.equal(pendingGroupList.response.status, 200);
    assert.deepEqual(groupNos(pendingGroupList.body.data.pendingTravelGroups), [
      createdGroup.body.data.travelGroup.groupNo,
    ]);

    const pendingGroupDetail = await requestJson(
      baseUrl,
      `/api/pending-travel-groups/${createdPendingGroup.body.data.pendingTravelGroup.id}`,
      {
        token: admin.token,
      },
    );
    assert.equal(pendingGroupDetail.response.status, 200);
    assert.equal(
      pendingGroupDetail.body.data.pendingTravelGroup.groupNo,
      'PD-TEST-001',
    );

    const createdOrder = await requestJson(baseUrl, '/api/sales-orders', {
      method: 'POST',
      token: admin.token,
      body: {
        orderNo: 'SO-TEST-001',
        orderType: 'travel_group',
        travelGroupId: createdGroup.body.data.travelGroup.id,
        customer: {
          name: '测试客户',
          phone: '13900002222',
          province: '贵州省',
          city: '贵阳市',
          district: '观山湖区',
          address: '测试地址',
        },
        orderDate: '2026-06-23',
        cashOnDeliveryAmountCents: 5000,
        items: [
          {
            productName: '测试酒品',
            quantity: 2,
            unitPriceCents: 19900,
            deliveryType: 'shipping',
          },
        ],
      },
    });
    assert.equal(createdOrder.response.status, 201);
    assert.equal(createdOrder.body.data.salesOrder.orderType, 'travel_group');
    assert.equal(createdOrder.body.data.salesOrder.orderNo, 'SO20260623001');
    assert.notEqual(createdOrder.body.data.salesOrder.orderNo, 'SO-TEST-001');
    assert.equal(createdOrder.body.data.salesOrder.totalAmountCents, 39800);
    assert.equal(createdOrder.body.data.salesOrder.items.length, 1);

    const overview = await requestJson(
      baseUrl,
      '/api/finance/overview?dateFrom=2026-06-23&dateTo=2026-06-23',
      {
        token: admin.token,
      },
    );
    assert.equal(overview.response.status, 200);
    assert.equal(overview.body.data.overview.metrics.travelGroupCount, 1);
    assert.equal(overview.body.data.overview.metrics.salesAmountCents, 39800);
    assert.equal(
      overview.body.data.overview.recentOrders[0].orderNo,
      createdOrder.body.data.salesOrder.orderNo,
    );

    const emptyReconciliation = await requestJson(
      baseUrl,
      '/api/reconciliations/2026-06-23',
      {
        token: admin.token,
      },
    );
    assert.equal(emptyReconciliation.response.status, 200);
    assert.equal(
      emptyReconciliation.body.data.reconciliation.businessDate,
      '2026-06-23',
    );
    assert.equal(
      emptyReconciliation.body.data.reconciliation.actualTotalCents,
      0,
    );

    const savedReconciliation = await requestJson(
      baseUrl,
      '/api/reconciliations/2026-06-23',
      {
        method: 'PUT',
        token: finance.token,
        body: {
          backOfficeSalesCents: 10000,
          paymentMethods: [
            { name: '现金', amountCents: 20000 },
            { name: '微信', amountCents: 28500 },
          ],
        },
      },
    );
    assert.equal(savedReconciliation.response.status, 200);
    assert.equal(
      savedReconciliation.body.data.reconciliation.refundsCents,
      0,
    );
    assert.equal(
      savedReconciliation.body.data.reconciliation.receivableTotalCents,
      49800,
    );
    assert.equal(
      savedReconciliation.body.data.reconciliation.actualTotalCents,
      48500,
    );
    assert.equal(
      savedReconciliation.body.data.reconciliation.differenceCents,
      -1300,
    );

    const automaticFieldReconciliation = await requestJson(
      baseUrl,
      '/api/reconciliations/2026-06-23',
      {
        method: 'PUT',
        token: finance.token,
        body: {
          businessDate: '2026-06-23',
          refundsCents: 800,
        },
      },
    );
    assertErrorContract(
      automaticFieldReconciliation,
      403,
      'FIELD_PERMISSION_DENIED',
    );

    const createdBonus = await requestJson(
      baseUrl,
      '/api/strike-bonus-awards',
      {
        method: 'POST',
        token: admin.token,
        body: {
          bonusDate: '2026-06-23',
          travelAgency: '测试旅行社',
          guideName: '测试导游',
          tasterName: '测试品鉴师',
          roomNo: '测试馆',
          salesAmountCents: 39800,
          bonusAmountCents: 3000,
          tasterPaidDate: '2026-06-24',
        },
      },
    );
    assert.equal(createdBonus.response.status, 201);
    assert.equal(
      createdBonus.body.data.strikeBonusAward.bonusAmountCents,
      3000,
    );

    const bonusList = await requestJson(
      baseUrl,
      '/api/strike-bonus-awards?dateFrom=2026-06-23&dateTo=2026-06-23',
      {
        token: admin.token,
      },
    );
    assert.equal(bonusList.response.status, 200);
    assert.equal(bonusList.body.data.strikeBonusAwards.length, 1);
  });
});

test('contract: finance overview uses confirmed after-sales refunds and global mark filtering', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);

      const overview = await requestJson(
        baseUrl,
        '/api/finance/overview?dateFrom=2026-07-01&dateTo=2026-07-01',
        {
          token: admin.token,
        },
      );
      assert.equal(overview.response.status, 200);
      assertNoShippedFields(overview.body.data.overview);
      const metrics = overview.body.data.overview.metrics;
      assert.equal(metrics.grossSalesAmountCents, 34000);
      assert.equal(metrics.salesAmountCents, 34000);
      assert.equal(metrics.refundAmountCents, 2000);
      assert.equal(metrics.pendingAfterSalesRefundAmountCents, 1300);
      assert.equal(metrics.legacyRefundOrderAmountCents, 14000);
      assert.equal(metrics.netSalesAmountCents, 32000);
      assert.equal(metrics.logisticsFeeCents, 1260);
      assert.equal(metrics.pendingInvoiceCount, 4);
      assert.equal(metrics.pendingCustomerMarkCount, 1);
      assert.equal(metrics.pendingTravelGroupMarkCount, 1);
      assert.equal(metrics.pendingAfterSalesConfirmCount, 2);
      assert.equal(metrics.cashOnDeliveryAmountCents, 2800);
      assert.equal(Array.isArray(overview.body.data.overview.recentOrders), true);

      const enabled = await requestJson(
        baseUrl,
        '/api/settings/global-mark-query/enable',
        {
          method: 'POST',
          token: admin.token,
        },
      );
      assert.equal(enabled.response.status, 200);

      const markedOverview = await requestJson(
        baseUrl,
        '/api/finance/overview?dateFrom=2026-07-01&dateTo=2026-07-01',
        {
          token: admin.token,
        },
      );
      assert.equal(markedOverview.response.status, 200);
      assertNoShippedFields(markedOverview.body.data.overview);
      const markedMetrics = markedOverview.body.data.overview.metrics;
      assert.equal(markedMetrics.travelGroupCount, 1);
      assert.equal(markedMetrics.orderCount, 5);
      assert.equal(markedMetrics.grossSalesAmountCents, 27000);
      assert.equal(markedMetrics.refundAmountCents, 1500);
      assert.equal(markedMetrics.pendingAfterSalesRefundAmountCents, 1300);
      assert.equal(markedMetrics.legacyRefundOrderAmountCents, 14000);
      assert.equal(markedMetrics.netSalesAmountCents, 25500);
      assert.equal(markedMetrics.logisticsFeeCents, 1190);
      assert.equal(markedMetrics.pendingInvoiceCount, 3);
      assert.equal(markedMetrics.pendingCustomerMarkCount, 0);
      assert.equal(markedMetrics.pendingTravelGroupMarkCount, 0);
      assert.equal(markedMetrics.pendingAfterSalesConfirmCount, 2);
    },
    {
      prisma: createFinanceOverviewPrismaOptions(),
    },
  );
});

test('contract: finance workbench enforces roles and returns scoped pending buckets', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const boss = await login(baseUrl, 'finance_workbench_boss', 'Password123');
      const finance = await login(
        baseUrl,
        'finance_workbench_finance',
        'Password123',
      );
      const sales = await login(baseUrl, 'finance_workbench_sales', 'Password123');
      const warehouse = await login(
        baseUrl,
        'finance_workbench_warehouse',
        'Password123',
      );
      const afterSales = await login(
        baseUrl,
        'finance_workbench_after_sales',
        'Password123',
      );

      for (const token of [admin.token, finance.token]) {
        const allowed = await requestJson(
          baseUrl,
          '/api/finance/workbench?dateFrom=2026-07-01&dateTo=2026-07-01',
          {
            token,
          },
        );
        assert.equal(allowed.response.status, 200);
        assert.equal(typeof allowed.body.data.workbench.metrics, 'object');
      }

      const bossOverview = await requestJson(
        baseUrl,
        '/api/finance/overview?dateFrom=2026-07-01&dateTo=2026-07-01',
        {
          token: boss.token,
        },
      );
      assertErrorContract(bossOverview, 403, 'PERMISSION_DENIED');

      const bossReconciliationList = await requestJson(
        baseUrl,
        '/api/reconciliations?dateFrom=2026-07-01&dateTo=2026-07-01',
        {
          token: boss.token,
        },
      );
      assertErrorContract(bossReconciliationList, 403, 'PERMISSION_DENIED');

      const bossReconciliationDetail = await requestJson(
        baseUrl,
        '/api/reconciliations/2026-07-01',
        {
          token: boss.token,
        },
      );
      assertErrorContract(bossReconciliationDetail, 403, 'PERMISSION_DENIED');

      const bossStrikeBonusList = await requestJson(
        baseUrl,
        '/api/strike-bonus-awards?dateFrom=2026-07-01&dateTo=2026-07-01',
        {
          token: boss.token,
        },
      );
      assertErrorContract(bossStrikeBonusList, 403, 'PERMISSION_DENIED');

      for (const token of [
        boss.token,
        sales.token,
        warehouse.token,
        afterSales.token,
      ]) {
        const denied = await requestJson(
          baseUrl,
          '/api/finance/workbench?dateFrom=2026-07-01&dateTo=2026-07-01',
          {
            token,
          },
        );
        assertErrorContract(denied, 403, 'PERMISSION_DENIED');
      }

      const workbench = await requestJson(
        baseUrl,
        '/api/finance/workbench?dateFrom=2026-07-01&dateTo=2026-07-01&limit=20',
        {
          token: admin.token,
        },
      );
      assert.equal(workbench.response.status, 200);
      const data = workbench.body.data.workbench;
      assertNoShippedFields(data);
      assert.equal(data.metrics.netSalesAmountCents, 32000);
      assert.equal(data.recentOrders.length, 6);
      assert.deepEqual(
        data.pendingAfterSales
          .map((order) => order.id)
          .sort(),
        ['as_fin_pending_marked', 'as_fin_pending_unmarked_group'],
      );
      assert.deepEqual(
        data.pendingMarks.map((entry) => entry.type).sort(),
        ['customer', 'travel_group'],
      );
      const customerMark = data.pendingMarks.find(
        (entry) => entry.type === 'customer',
      );
      assert.equal(customerMark.customer.id, 'cust_fin_unmarked');
      assert.equal(customerMark.orderCount, 1);
      const groupMark = data.pendingMarks.find(
        (entry) => entry.type === 'travel_group',
      );
      assert.equal(groupMark.travelGroup.id, 'tg_fin_unmarked');
      assert.equal(groupMark.orderCount, 1);
      assert.deepEqual(
        data.pendingLogistics
          .map((entry) => entry.order.id)
          .sort(),
        [
          'so_fin_unmarked_customer',
          'so_fin_unmarked_group',
          'so_fin_valid_marked',
        ],
      );
      const validLogistics = data.pendingLogistics.find(
        (entry) => entry.order.id === 'so_fin_valid_marked',
      );
      assert.deepEqual(validLogistics.reasons.sort(), [
        'missing_logistics_no',
        'pending_invoice',
      ]);

      const filtered = await requestJson(
        baseUrl,
        '/api/finance/workbench?dateFrom=2026-07-01&dateTo=2026-07-01&query=PARTIAL-MARKED&limit=1',
        {
          token: admin.token,
        },
      );
      assert.equal(filtered.response.status, 200);
      assert.deepEqual(
        filtered.body.data.workbench.recentOrders.map((order) => order.id),
        ['so_fin_partial_marked'],
      );
      assert.deepEqual(
        filtered.body.data.workbench.pendingAfterSales.map(
          (order) => order.id,
        ),
        ['as_fin_pending_marked'],
      );

      const workbenchLogs = await requestJson(baseUrl, '/api/operation-logs', {
        token: admin.token,
      });
      assert.equal(workbenchLogs.response.status, 200);
      assert.equal(
        workbenchLogs.body.data.logs.some(
          (log) =>
            String(log.action || '').startsWith('finance.workbench') ||
            log.entityType === 'finance_workbench',
        ),
        true,
      );

      const enabled = await requestJson(
        baseUrl,
        '/api/settings/global-mark-query/enable',
        {
          method: 'POST',
          token: admin.token,
        },
      );
      assert.equal(enabled.response.status, 200);

      const marked = await requestJson(
        baseUrl,
        '/api/finance/workbench?dateFrom=2026-07-01&dateTo=2026-07-01&limit=20',
        {
          token: admin.token,
        },
      );
      assert.equal(marked.response.status, 200);
      const markedData = marked.body.data.workbench;
      assertNoShippedFields(markedData);
      assert.deepEqual(
        markedData.pendingAfterSales.map((order) => order.id).sort(),
        ['as_fin_pending_marked', 'as_fin_pending_unmarked_group'],
      );
      assert.deepEqual(markedData.pendingMarks, []);
      assert.deepEqual(
        markedData.pendingLogistics
          .map((entry) => entry.order.id)
          .sort(),
        ['so_fin_unmarked_group', 'so_fin_valid_marked'],
      );
      assert.equal(
        markedData.recentOrders.some(
          (order) => order.id === 'so_fin_unmarked_customer',
        ),
        false,
      );
      assert.equal(
        markedData.recentOrders.some(
          (order) => order.id === 'so_fin_unmarked_group',
        ),
        true,
      );
    },
    {
      prisma: createFinanceOverviewPrismaOptions(),
    },
  );
});

test('contract: warehouse order wrapper lists shipping orders and saves packing fields', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const warehouse = await login(
        baseUrl,
        'warehouse_wrapper_user',
        'Password123',
      );
      const boss = await login(baseUrl, 'warehouse_wrapper_boss', 'Password123');
      const finance = await login(
        baseUrl,
        'warehouse_wrapper_finance',
        'Password123',
      );
      const sales = await login(baseUrl, 'warehouse_wrapper_sales', 'Password123');

      const list = await requestJson(
        baseUrl,
        '/api/warehouse/orders?dateFrom=2026-07-04&dateTo=2026-07-04&limit=20',
        {
          token: warehouse.token,
        },
      );
      assert.equal(list.response.status, 200);
      assert.deepEqual(
        list.body.data.warehouseOrders.map((order) => order.id).sort(),
        [
          'so_wh_shipping_marked',
          'so_wh_shipping_packed',
          'so_wh_shipping_unmarked_customer',
          'so_wh_shipping_unmarked_group',
        ],
      );
      for (const order of list.body.data.warehouseOrders) {
        assertNoShippedFields(order);
      }
      assert.equal(
        list.body.data.warehouseOrders.some(
          (order) => order.id === 'so_wh_self_pickup',
        ),
        false,
      );

      const filtered = await requestJson(
        baseUrl,
        '/api/warehouse/orders?dateFrom=2026-07-04&dateTo=2026-07-04&packingStatus=packed&logisticsMethod=SF&query=PACKED',
        {
          token: warehouse.token,
        },
      );
      assert.equal(filtered.response.status, 200);
      assert.deepEqual(
        filtered.body.data.warehouseOrders.map((order) => order.id),
        ['so_wh_shipping_packed'],
      );

      const bossList = await requestJson(
        baseUrl,
        '/api/warehouse/orders?dateFrom=2026-07-04&dateTo=2026-07-04',
        {
          token: boss.token,
        },
      );
      assertErrorContract(bossList, 403, 'PERMISSION_DENIED');

      for (const token of [finance.token, sales.token]) {
        const denied = await requestJson(baseUrl, '/api/warehouse/orders', {
          token,
        });
        assertErrorContract(denied, 403, 'PERMISSION_DENIED');
      }

      const patched = await requestJson(
        baseUrl,
        '/api/warehouse/orders/so_wh_shipping_marked/packing',
        {
          method: 'PATCH',
          token: warehouse.token,
          body: {
            logisticsMethod: 'Yunda Smoke',
            packingStatus: 'packed',
            packageCount: 3,
            warehouseRemark: 'warehouse wrapper smoke packed',
            hasPackingMark: true,
          },
        },
      );
      assert.equal(patched.response.status, 200);
      assert.equal(patched.body.data.warehouseOrder.logisticsMethod, 'Yunda Smoke');
      assert.equal(patched.body.data.warehouseOrder.packingStatus, 'packed');
      assert.equal(patched.body.data.warehouseOrder.packageCount, 3);
      assert.equal(
        patched.body.data.warehouseOrder.warehouseRemark,
        'warehouse wrapper smoke packed',
      );
      assert.equal(patched.body.data.warehouseOrder.hasPackingMark, true);
      assert.equal(patched.body.data.warehouseOrder.financeMark, true);
      assertNoShippedFields(patched.body.data.warehouseOrder);

      const packingLogs = await requestJson(
        baseUrl,
        '/api/operation-logs?action=sales_orders.packing.update',
        {
          token: admin.token,
        },
      );
      assert.equal(packingLogs.response.status, 200);
      const packingLog = packingLogs.body.data.logs.find(
        (log) => log.entityId === 'so_wh_shipping_marked',
      );
      assert.ok(packingLog);
      assertBusinessOperationLog(packingLog, {
        action: 'sales_orders.packing.update',
        entityType: 'sales_order',
        entityId: 'so_wh_shipping_marked',
        userId: 'usr_warehouse_wrapper',
      });
      assert.equal(packingLog.beforeData.packingStatus, 'pending');
      assert.equal(packingLog.afterData.packingStatus, 'packed');
      assert.equal(packingLog.afterData.packageCount, 3);
      assert.equal(packingLog.beforeData.hasPackingMark, false);
      assert.equal(packingLog.afterData.hasPackingMark, true);
      assert.equal(packingLog.beforeData.financeMark, true);
      assert.equal(packingLog.afterData.financeMark, true);

      const unmarked = await requestJson(
        baseUrl,
        '/api/warehouse/orders/so_wh_shipping_marked/packing',
        {
          method: 'PATCH',
          token: warehouse.token,
          body: {
            hasPackingMark: false,
          },
        },
      );
      assert.equal(unmarked.response.status, 200);
      assert.equal(unmarked.body.data.warehouseOrder.hasPackingMark, false);
      assert.equal(unmarked.body.data.warehouseOrder.financeMark, true);

      const invalidPackingMark = await requestJson(
        baseUrl,
        '/api/warehouse/orders/so_wh_shipping_marked/packing',
        {
          method: 'PATCH',
          token: warehouse.token,
          body: {
            hasPackingMark: 'true',
          },
        },
      );
      assertErrorContract(invalidPackingMark, 400, 'VALIDATION_FAILED');

      const persisted = await requestJson(
        baseUrl,
        '/api/warehouse/orders?dateFrom=2026-07-04&dateTo=2026-07-04&limit=20',
        {
          token: warehouse.token,
        },
      );
      assert.equal(persisted.response.status, 200);
      const persistedOrder = persisted.body.data.warehouseOrders.find(
        (order) => order.id === 'so_wh_shipping_marked',
      );
      assert.ok(persistedOrder);
      assert.equal(persistedOrder.hasPackingMark, false);
      assert.equal(persistedOrder.financeMark, true);

      const updatedPackingLogs = await requestJson(
        baseUrl,
        '/api/operation-logs?action=sales_orders.packing.update',
        {
          token: admin.token,
        },
      );
      assert.equal(updatedPackingLogs.response.status, 200);
      assert.ok(
        updatedPackingLogs.body.data.logs.some(
          (log) =>
            log.entityId === 'so_wh_shipping_marked' &&
            log.beforeData.hasPackingMark === true &&
            log.afterData.hasPackingMark === false &&
            log.beforeData.financeMark === true &&
            log.afterData.financeMark === true,
        ),
      );

      const bossPatch = await requestJson(
        baseUrl,
        '/api/warehouse/orders/so_wh_shipping_marked/packing',
        {
          method: 'PATCH',
          token: boss.token,
          body: {
            packingStatus: 'packing',
          },
        },
      );
      assertErrorContract(bossPatch, 403, 'PERMISSION_DENIED');

      const deniedField = await requestJson(
        baseUrl,
        '/api/warehouse/orders/so_wh_shipping_marked/packing',
        {
          method: 'PATCH',
          token: warehouse.token,
          body: {
            logisticsFeeCents: 100,
          },
        },
      );
      assertErrorContract(deniedField, 403, 'FIELD_PERMISSION_DENIED');

      const selfPickupPatch = await requestJson(
        baseUrl,
        '/api/warehouse/orders/so_wh_self_pickup/packing',
        {
          method: 'PATCH',
          token: warehouse.token,
          body: {
            packingStatus: 'packed',
          },
        },
      );
      assertErrorContract(selfPickupPatch, 404, 'SALES_ORDER_NOT_FOUND');

      const enabled = await requestJson(
        baseUrl,
        '/api/settings/global-mark-query/enable',
        {
          method: 'POST',
          token: admin.token,
        },
      );
      assert.equal(enabled.response.status, 200);

      const markedList = await requestJson(
        baseUrl,
        '/api/warehouse/orders?dateFrom=2026-07-04&dateTo=2026-07-04&limit=20',
        {
          token: warehouse.token,
        },
      );
      assert.equal(markedList.response.status, 200);
      assert.deepEqual(
        markedList.body.data.warehouseOrders.map((order) => order.id).sort(),
        [
          'so_wh_shipping_marked',
          'so_wh_shipping_packed',
          'so_wh_shipping_unmarked_group',
        ],
      );

      const hiddenPatch = await requestJson(
        baseUrl,
        '/api/warehouse/orders/so_wh_shipping_unmarked_customer/packing',
        {
          method: 'PATCH',
          token: warehouse.token,
          body: {
            packingStatus: 'packed',
          },
        },
      );
      assertErrorContract(hiddenPatch, 404, 'SALES_ORDER_NOT_FOUND');
    },
    {
      prisma: createWarehouseOrdersPrismaOptions(),
    },
  );
});

function createWarehouseOrdersPrismaOptions() {
  return {
    users: [
      {
        id: 'usr_warehouse_wrapper',
        username: 'warehouse_wrapper_user',
        name: 'warehouse wrapper smoke warehouse',
        password: 'Password123',
        role: 'warehouse',
      },
      {
        id: 'usr_warehouse_wrapper_boss',
        username: 'warehouse_wrapper_boss',
        name: 'warehouse wrapper smoke boss',
        password: 'Password123',
        role: 'boss',
      },
      {
        id: 'usr_warehouse_wrapper_finance',
        username: 'warehouse_wrapper_finance',
        name: 'warehouse wrapper smoke finance',
        password: 'Password123',
        role: 'finance',
      },
      {
        id: 'usr_warehouse_wrapper_sales',
        username: 'warehouse_wrapper_sales',
        name: 'warehouse wrapper smoke sales',
        password: 'Password123',
        role: 'sales',
      },
    ],
    customers: [
      {
        id: 'cust_wh_marked',
        name: 'Warehouse Wrapper Smoke Marked Customer',
        phone: '13800009001',
        financeMark: true,
      },
      {
        id: 'cust_wh_unmarked',
        name: 'Warehouse Wrapper Smoke Unmarked Customer',
        phone: '13800009002',
        financeMark: false,
      },
      {
        id: 'cust_wh_group',
        name: 'Warehouse Wrapper Smoke Group Customer',
        phone: '13800009003',
        financeMark: true,
      },
    ],
    travelGroups: [
      {
        id: 'tg_wh_unmarked',
        groupNo: 'TG-WH-SMOKE-UNMARKED',
        visitDate: '2026-07-04T00:00:00.000Z',
        travelAgency: 'warehouse wrapper smoke unmarked agency',
        financeMark: false,
      },
    ],
    salesOrders: [
      createWarehouseOrderSeed({
        id: 'so_wh_shipping_marked',
        orderNo: 'SO-WH-SHIPPING-MARKED',
        customerId: 'cust_wh_marked',
        customerName: 'Warehouse Wrapper Smoke Marked Customer',
        packingStatus: 'PENDING',
        logisticsNo: 'YD-WH-SMOKE-MARKED',
      }),
      createWarehouseOrderSeed({
        id: 'so_wh_shipping_packed',
        orderNo: 'SO-WH-SHIPPING-PACKED',
        customerId: 'cust_wh_marked',
        customerName: 'Warehouse Wrapper Smoke Marked Customer',
        packingStatus: 'PACKED',
        logisticsMethod: 'SF Smoke',
        logisticsNo: 'SF-WH-SMOKE-PACKED',
        packageCount: 1,
      }),
      createWarehouseOrderSeed({
        id: 'so_wh_self_pickup',
        orderNo: 'SO-WH-SELF-PICKUP',
        customerId: 'cust_wh_marked',
        customerName: 'Warehouse Wrapper Smoke Marked Customer',
        packingStatus: 'PENDING',
        items: [
          {
            productName: 'Warehouse Wrapper Smoke Pickup Wine',
            quantity: 1,
            unitPriceCents: 1000,
            deliveryType: 'SELF_PICKUP',
          },
        ],
      }),
      createWarehouseOrderSeed({
        id: 'so_wh_shipping_unmarked_customer',
        orderNo: 'SO-WH-UNMARKED-CUSTOMER',
        customerId: 'cust_wh_unmarked',
        customerName: 'Warehouse Wrapper Smoke Unmarked Customer',
        packingStatus: 'PACKING',
        financeMark: false,
      }),
      createWarehouseOrderSeed({
        id: 'so_wh_shipping_unmarked_group',
        orderNo: 'SO-WH-UNMARKED-GROUP',
        orderType: 'TRAVEL_GROUP',
        travelGroupId: 'tg_wh_unmarked',
        customerId: 'cust_wh_group',
        customerName: 'Warehouse Wrapper Smoke Group Customer',
        packingStatus: 'ABNORMAL',
      }),
    ],
  };
}

function createWarehouseOrderSeed(overrides = {}) {
  return {
    orderType: 'EXTERNAL',
    orderDate: '2026-07-04T00:00:00.000Z',
    status: 'VALID',
    totalAmountCents: 1000,
    packingStatus: 'PENDING',
    financeMark: true,
    hasPackingMark: false,
    warehouseRemark: 'warehouse wrapper smoke seed',
    createdAt: '2026-07-04T08:00:00.000Z',
    updatedAt: '2026-07-04T08:00:00.000Z',
    items: [
      {
        productName: 'Warehouse Wrapper Smoke Shipping Wine',
        quantity: 1,
        unitPriceCents: 1000,
        deliveryType: 'SHIPPING',
      },
    ],
    ...overrides,
  };
}

function createFinanceOverviewPrismaOptions() {
  return {
    users: [
      {
        id: 'usr_finance_workbench_boss',
        username: 'finance_workbench_boss',
        name: 'finance workbench smoke boss',
        password: 'Password123',
        role: 'boss',
      },
      {
        id: 'usr_finance_workbench_finance',
        username: 'finance_workbench_finance',
        name: 'finance workbench smoke finance',
        password: 'Password123',
        role: 'finance',
      },
      {
        id: 'usr_finance_workbench_sales',
        username: 'finance_workbench_sales',
        name: 'finance workbench smoke sales',
        password: 'Password123',
        role: 'sales',
      },
      {
        id: 'usr_finance_workbench_warehouse',
        username: 'finance_workbench_warehouse',
        name: 'finance workbench smoke warehouse',
        password: 'Password123',
        role: 'warehouse',
      },
      {
        id: 'usr_finance_workbench_after_sales',
        username: 'finance_workbench_after_sales',
        name: 'finance workbench smoke after sales',
        password: 'Password123',
        role: 'after_sales',
      },
    ],
    customers: [
      {
        id: 'cust_fin_marked',
        name: 'Finance Overview Smoke Marked Customer',
        phone: '13800008001',
        financeMark: true,
      },
      {
        id: 'cust_fin_unmarked',
        name: 'Finance Overview Smoke Unmarked Customer',
        phone: '13800008002',
        financeMark: false,
      },
      {
        id: 'cust_fin_marked_group',
        name: 'Finance Overview Smoke Marked Group Customer',
        phone: '13800008003',
        financeMark: true,
      },
    ],
    travelGroups: [
      {
        id: 'tg_fin_marked',
        groupNo: 'TG-FIN-MARKED',
        visitDate: '2026-07-01T00:00:00.000Z',
        travelAgency: 'finance overview smoke marked agency',
        financeMark: true,
      },
      {
        id: 'tg_fin_unmarked',
        groupNo: 'TG-FIN-UNMARKED',
        visitDate: '2026-07-01T00:00:00.000Z',
        travelAgency: 'finance overview smoke unmarked agency',
        financeMark: false,
      },
    ],
    salesOrders: [
      createFinanceOverviewOrderSeed({
        id: 'so_fin_valid_marked',
        orderNo: 'SO-FIN-VALID-MARKED',
        customerId: 'cust_fin_marked',
        customerName: 'Finance Overview Smoke Marked Customer',
        totalAmountCents: 10000,
        cashOnDeliveryAmountCents: 1000,
        logisticsFeeCents: 500,
        invoiceRequired: true,
      }),
      createFinanceOverviewOrderSeed({
        id: 'so_fin_partial_marked',
        orderNo: 'SO-FIN-PARTIAL-MARKED',
        orderType: 'TRAVEL_GROUP',
        travelGroupId: 'tg_fin_marked',
        customerId: 'cust_fin_marked',
        customerName: 'Finance Overview Smoke Marked Customer',
        status: 'PARTIAL_REFUND',
        totalAmountCents: 8000,
        cashOnDeliveryAmountCents: 200,
        logisticsNo: 'SF-SMOKE-PARTIAL-MARKED',
        logisticsFeeCents: 300,
      }),
      createFinanceOverviewOrderSeed({
        id: 'so_fin_refunded_marked',
        orderNo: 'SO-FIN-REFUNDED-MARKED',
        customerId: 'cust_fin_marked',
        customerName: 'Finance Overview Smoke Marked Customer',
        status: 'REFUNDED',
        totalAmountCents: 6000,
        logisticsFeeCents: 200,
        invoiceRequired: true,
      }),
      createFinanceOverviewOrderSeed({
        id: 'so_fin_cancelled_marked',
        orderNo: 'SO-FIN-CANCELLED-MARKED',
        customerId: 'cust_fin_marked',
        customerName: 'Finance Overview Smoke Marked Customer',
        status: 'CANCELLED',
        totalAmountCents: 4000,
        logisticsFeeCents: 100,
      }),
      createFinanceOverviewOrderSeed({
        id: 'so_fin_unmarked_customer',
        orderNo: 'SO-FIN-UNMARKED-CUSTOMER',
        customerId: 'cust_fin_unmarked',
        customerName: 'Finance Overview Smoke Unmarked Customer',
        totalAmountCents: 7000,
        cashOnDeliveryAmountCents: 700,
        logisticsFeeCents: 70,
        invoiceRequired: true,
        financeMark: false,
      }),
      createFinanceOverviewOrderSeed({
        id: 'so_fin_unmarked_group',
        orderNo: 'SO-FIN-UNMARKED-GROUP',
        orderType: 'TRAVEL_GROUP',
        travelGroupId: 'tg_fin_unmarked',
        customerId: 'cust_fin_marked_group',
        customerName: 'Finance Overview Smoke Marked Group Customer',
        totalAmountCents: 9000,
        cashOnDeliveryAmountCents: 900,
        logisticsFeeCents: 90,
        invoiceRequired: true,
      }),
      createFinanceOverviewOrderSeed({
        id: 'so_fin_buyback_approved',
        orderNo: 'SO-FIN-BUYBACK-APPROVED',
        orderType: 'BUYBACK',
        workflowStatus: 'APPROVED',
        workflowVersion: 2,
        customerId: 'cust_fin_marked',
        customerName: 'Finance Overview Smoke Marked Customer',
        totalAmountCents: 999000,
        logisticsFeeCents: 99900,
        invoiceRequired: true,
      }),
      createFinanceOverviewOrderSeed({
        id: 'so_fin_internal_pending',
        orderNo: 'SO-FIN-INTERNAL-PENDING',
        orderType: 'INTERNAL',
        workflowStatus: 'PENDING',
        workflowVersion: 1,
        customerId: 'cust_fin_marked',
        customerName: 'Finance Overview Smoke Marked Customer',
        totalAmountCents: 888000,
        logisticsFeeCents: 88800,
        invoiceRequired: true,
      }),
    ],
    afterSalesOrders: [
      createFinanceOverviewAfterSalesSeed({
        id: 'as_fin_confirmed_marked',
        afterSalesNo: 'AS20260701001',
        salesOrderId: 'so_fin_valid_marked',
        customerId: 'cust_fin_marked',
        refundAmountCents: 1500,
        financeConfirmed: true,
      }),
      createFinanceOverviewAfterSalesSeed({
        id: 'as_fin_pending_marked',
        afterSalesNo: 'AS20260701002',
        salesOrderId: 'so_fin_partial_marked',
        customerId: 'cust_fin_marked',
        refundAmountCents: 700,
        financeConfirmed: false,
      }),
      createFinanceOverviewAfterSalesSeed({
        id: 'as_fin_confirmed_unmarked_customer',
        afterSalesNo: 'AS20260701003',
        salesOrderId: 'so_fin_unmarked_customer',
        customerId: 'cust_fin_unmarked',
        refundAmountCents: 500,
        financeConfirmed: true,
      }),
      createFinanceOverviewAfterSalesSeed({
        id: 'as_fin_pending_unmarked_group',
        afterSalesNo: 'AS20260701004',
        salesOrderId: 'so_fin_unmarked_group',
        customerId: 'cust_fin_marked_group',
        refundAmountCents: 600,
        financeConfirmed: false,
      }),
      createFinanceOverviewAfterSalesSeed({
        id: 'as_fin_no_refund',
        afterSalesNo: 'AS20260701005',
        salesOrderId: 'so_fin_valid_marked',
        customerId: 'cust_fin_marked',
        refundAmountCents: 0,
        financeConfirmed: false,
      }),
      createFinanceOverviewAfterSalesSeed({
        id: 'as_fin_outside_date',
        afterSalesNo: 'AS20260702001',
        salesOrderId: 'so_fin_valid_marked',
        customerId: 'cust_fin_marked',
        refundAmountCents: 999,
        financeConfirmed: true,
        createdAt: '2026-07-02T00:00:00.000Z',
      }),
    ],
  };
}

function createFinanceOverviewOrderSeed(overrides = {}) {
  return {
    orderType: 'EXTERNAL',
    orderDate: '2026-07-01T00:00:00.000Z',
    status: 'VALID',
    packingStatus: 'PACKED',
    invoiceIssued: false,
    financeMark: true,
    createdAt: '2026-07-01T08:00:00.000Z',
    updatedAt: '2026-07-01T08:00:00.000Z',
    items: [
      {
        productName: 'Finance Overview Smoke Wine',
        quantity: 1,
        unitPriceCents: 1000,
        deliveryType: 'SHIPPING',
      },
    ],
    ...overrides,
  };
}

function createFinanceOverviewAfterSalesSeed(overrides = {}) {
  return {
    issueType: 'QUALITY_ISSUE',
    actionType: 'REFUND',
    description: 'finance overview smoke test refund',
    status: 'WAITING_REFUND',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

test('contract: sales order creation generates orderNo from orderDate and ignores client orderNo', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);

    const first = await createGeneratedSalesOrder(baseUrl, admin.token, {
      orderNo: 'CLIENT-SHOULD-BE-IGNORED-1',
      orderDate: '2026-06-29',
    });
    const second = await createGeneratedSalesOrder(baseUrl, admin.token, {
      orderNo: 'CLIENT-SHOULD-BE-IGNORED-2',
      orderDate: '2026-06-29',
    });
    const nextDay = await createGeneratedSalesOrder(baseUrl, admin.token, {
      orderNo: 'CLIENT-SHOULD-BE-IGNORED-3',
      orderDate: '2026-06-30',
    });

    assert.equal(first.orderNo, 'SO20260629001');
    assert.equal(second.orderNo, 'SO20260629002');
    assert.equal(nextDay.orderNo, 'SO20260630001');
  });
});

test('contract: sales order creation retries once after generated orderNo conflict', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);

      const order = await createGeneratedSalesOrder(baseUrl, admin.token, {
        orderDate: '2026-06-29',
      });

      assert.equal(order.orderNo, 'SO20260629002');
    },
    {
      prisma: {
        failSalesOrderCreateOrderNoOnce: true,
      },
    },
  );
});

test('contract: sales order creation uses existing customer snapshots and sales ownership', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const salesUser = await createUser(baseUrl, admin.token, {
        name: 'Order Scope Sales',
        username: 'order-scope-sales',
        password: 'Password123',
        role: 'sales',
      });
      const sales = await login(baseUrl, salesUser.username, 'Password123');
      const group = await createScopedTravelGroup(baseUrl, admin.token, {
        visitDate: SHANGHAI_TODAY,
      });

      const created = await requestJson(baseUrl, '/api/sales-orders', {
        method: 'POST',
        token: sales.token,
        body: {
          orderNo: 'CLIENT-ORDER-NO-IGNORED',
          orderType: 'travel_group',
          travelGroupId: group.id,
          customerId: 'cust_existing_order',
          salesUserId: 'usr_admin',
          orderDate: '2026-06-29',
          salesFormNo: 'FORM-TEST-001',
          totalAmountCents: 999999,
          cashOnDeliveryAmountCents: 600,
          paymentDetails: [
            {
              paymentMethodId:
                '00000000-0000-4000-8000-000000000001',
              amountCents: 2400,
            },
            {
              paymentMethodId:
                '00000000-0000-4000-8000-000000000005',
              amountCents: 600,
            },
          ],
          paymentDetails: [
            {
              paymentMethodId:
                '00000000-0000-4000-8000-000000000001',
              amountCents: 2400,
            },
            {
              paymentMethodId:
                '00000000-0000-4000-8000-000000000005',
              amountCents: 600,
            },
          ],
          invoiceRequired: true,
          items: [
            {
              productName: 'Existing Customer Product',
              quantity: 2,
              unitPriceCents: 1500,
              deliveryType: 'shipping',
              notes: 'shipping note',
              sortOrder: 7,
            },
          ],
        },
      });
      assert.equal(created.response.status, 201);
      const order = created.body.data.salesOrder;
      assert.equal(order.orderNo, 'SO20260629001');
      assert.equal(order.customerId, 'cust_existing_order');
      assert.equal(order.customerName, 'Existing Order Customer');
      assert.equal(order.customerPhone, '13900008888');
      assert.equal(order.province, '贵州省');
      assert.equal(order.city, '贵阳市');
      assert.equal(order.district, '南明区');
      assert.equal(order.address, 'Existing Snapshot Address');
      assert.equal(order.customer.name, 'Existing Order Customer');
      assert.equal(order.customer.financeMark, true);
      assert.equal(order.salesUserId, salesUser.id);
      assert.equal(order.totalAmountCents, 3000);
      assert.equal(order.deliverySummary, 'shipping');
      assert.equal(order.packingStatus, 'pending');
      assert.equal(order.invoiceRequired, true);
      assert.equal(order.items[0].subtotalCents, 3000);
      assert.equal(order.items[0].deliveryType, 'shipping');
      assert.equal(order.items[0].notes, 'shipping note');
      assert.equal(order.items[0].sortOrder, 7);
      assertSalesOrderDtoPhase4(order);

      const orderDetail = await requestJson(
        baseUrl,
        `/api/sales-orders/${order.id}`,
        {
          token: admin.token,
        },
      );
      assert.equal(orderDetail.response.status, 200);
      assertSalesOrderDtoPhase4(orderDetail.body.data.salesOrder);
      assertSalesOrderDtoStableEqual(orderDetail.body.data.salesOrder, order);

      const orderList = await requestJson(baseUrl, '/api/sales-orders', {
        token: admin.token,
      });
      assert.equal(orderList.response.status, 200);
      const listedOrder = orderList.body.data.salesOrders.find(
        (item) => item.id === order.id,
      );
      assert.ok(listedOrder);
      assertSalesOrderDtoPhase4(listedOrder);
      assertSalesOrderDtoStableEqual(
        listedOrder,
        orderDetail.body.data.salesOrder,
      );

      const groupDetail = await requestJson(
        baseUrl,
        `/api/travel-groups/${group.id}`,
        {
          token: admin.token,
        },
      );
      assert.equal(groupDetail.response.status, 200);
      assert.equal(groupDetail.body.data.travelGroup.status, 'ordered');
      assert.equal(groupDetail.body.data.travelGroup.salesAmountCents, 3000);
      assert.equal(groupDetail.body.data.travelGroup.orderAmountCents, 3000);
      assert.equal(
        groupDetail.body.data.travelGroup.cashOnDeliveryCents,
        600,
      );

      const salesLogs = await requestJson(
        baseUrl,
        '/api/operation-logs?action=sales_orders.create',
        {
          token: admin.token,
        },
      );
      assert.equal(salesLogs.response.status, 200);
      assert.equal(salesLogs.body.data.logs.length, 1);
      assert.equal(
        salesLogs.body.data.logs[0].afterData.customerId,
        'cust_existing_order',
      );
      assertSalesOrderDtoPhase4(salesLogs.body.data.logs[0].afterData);
      assert.equal(
        salesLogs.body.data.logs[0].afterData.deliverySummary,
        'shipping',
      );

      const customerLogs = await requestJson(
        baseUrl,
        '/api/operation-logs?action=customers.create',
        {
          token: admin.token,
        },
      );
      assert.equal(customerLogs.response.status, 200);
      assert.equal(customerLogs.body.data.logs.length, 0);
    },
    {
      prisma: {
        customers: [
          {
            id: 'cust_existing_order',
            name: 'Existing Order Customer',
            phone: '13900008888',
            province: '贵州省',
            city: '贵阳市',
            district: '南明区',
            address: 'Existing Snapshot Address',
            financeMark: true,
          },
        ],
      },
    },
  );
});

test('contract: sales order creation can create a new unmarked customer in the same transaction', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);

    const created = await requestJson(baseUrl, '/api/sales-orders', {
      method: 'POST',
      token: admin.token,
      body: {
        orderType: 'external',
        orderDate: '2026-06-29',
        customer: {
          name: 'New Order Customer',
          phone: '13900007777',
          province: '四川省',
          city: '成都市',
          district: '武侯区',
          address: 'New Snapshot Address',
          financeMark: true,
          notes: 'new customer note',
        },
        totalAmountCents: 999999,
        items: [
          {
            productName: 'Self Pickup Product',
            quantity: 3,
            unitPriceCents: 2000,
            deliveryType: 'self_pickup',
          },
        ],
      },
    });
    assert.equal(created.response.status, 201);
    const order = created.body.data.salesOrder;
    assert.equal(order.orderNo, 'SO20260629001');
    assert.equal(typeof order.customerId, 'string');
    assert.equal(order.customerName, 'New Order Customer');
    assert.equal(order.customer.financeMark, false);
    assert.equal(order.totalAmountCents, 6000);
    assert.equal(order.deliverySummary, 'self_pickup');
    assert.equal(order.packingStatus, 'packed');
    assert.equal(order.items[0].deliveryType, 'self_pickup');
    assert.equal(order.items[0].subtotalCents, 6000);
    assertSalesOrderDtoPhase4(order);

    const customerLogs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=customers.create',
      {
        token: admin.token,
      },
    );
    assert.equal(customerLogs.response.status, 200);
    assert.equal(customerLogs.body.data.logs.length, 1);
    assert.equal(
      customerLogs.body.data.logs[0].afterData.financeMark,
      false,
    );
    assert.equal(
      customerLogs.body.data.logs[0].afterData.id,
      order.customerId,
    );

    const salesLogs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=sales_orders.create',
      {
        token: admin.token,
      },
    );
    assert.equal(salesLogs.response.status, 200);
    assert.equal(salesLogs.body.data.logs.length, 1);
    assert.equal(
      salesLogs.body.data.logs[0].afterData.totalAmountCents,
      6000,
    );
    assert.equal(
      salesLogs.body.data.logs[0].afterData.deliverySummary,
      'self_pickup',
    );
    assertSalesOrderDtoPhase4(salesLogs.body.data.logs[0].afterData);
  });
});

test('contract: sales order DTO summarizes mixed delivery items consistently', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);

    const created = await requestJson(baseUrl, '/api/sales-orders', {
      method: 'POST',
      token: admin.token,
      body: {
        orderType: 'external',
        orderDate: '2026-06-29',
        customer: {
          name: 'Mixed Delivery Customer',
          phone: '13900005555',
        },
        items: [
          {
            productName: 'Mixed Shipping Product',
            quantity: 1,
            unitPriceCents: 2500,
            deliveryType: 'shipping',
            notes: 'ship item',
            sortOrder: 2,
          },
          {
            productName: 'Mixed Pickup Product',
            quantity: 2,
            unitPriceCents: 1500,
            deliveryType: 'self_pickup',
            notes: 'pickup item',
            sortOrder: 1,
          },
        ],
      },
    });
    assert.equal(created.response.status, 201);
    const order = created.body.data.salesOrder;
    assertSalesOrderDtoPhase4(order);
    assert.equal(order.deliverySummary, 'mixed');
    assert.equal(order.packingStatus, 'pending');
    assert.equal(order.totalAmountCents, 5500);
    assert.deepEqual(
      order.items.map((item) => item.deliveryType).sort(),
      ['self_pickup', 'shipping'],
    );
    assert.deepEqual(
      order.items
        .map((item) => item.subtotalCents)
        .sort((left, right) => left - right),
      [2500, 3000],
    );

    const detail = await requestJson(baseUrl, `/api/sales-orders/${order.id}`, {
      token: admin.token,
    });
    assert.equal(detail.response.status, 200);
    assertSalesOrderDtoPhase4(detail.body.data.salesOrder);
    assertSalesOrderDtoStableEqual(detail.body.data.salesOrder, order);

    const list = await requestJson(baseUrl, '/api/sales-orders', {
      token: admin.token,
    });
    assert.equal(list.response.status, 200);
    const listedOrder = list.body.data.salesOrders.find(
      (item) => item.id === order.id,
    );
    assert.ok(listedOrder);
    assertSalesOrderDtoStableEqual(listedOrder, detail.body.data.salesOrder);
  });
});

test('contract: sales order DTO exposes entry amount and taster commission summary', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);

      const detail = await requestJson(
        baseUrl,
        '/api/sales-orders/so_metrics_order_dto',
        {
          token: admin.token,
        },
      );
      assert.equal(detail.response.status, 200);
      const order = detail.body.data.salesOrder;
      assertSalesOrderDtoPhase4(order);
      assert.equal(order.entryAmountCents, 123400);
      assert.equal(order.tasterCommissionCents, 8000);
      assert.deepEqual(order.tasterCommission, {
        recordId: 'cr_metrics_order_taster',
        amountCents: 8000,
        isConfirmed: true,
        confirmedById: 'usr_metrics_finance',
        confirmedByName: 'Metrics Finance',
        confirmedAt: '2026-07-05T08:00:00.000Z',
      });
      assert.equal(order.tasterId, 'usr_metrics_taster');
      assert.equal(order.tasterName, 'Metrics Taster');

      const list = await requestJson(baseUrl, '/api/sales-orders', {
        token: admin.token,
      });
      assert.equal(list.response.status, 200);
      const listedOrder = list.body.data.salesOrders.find(
        (item) => item.id === 'so_metrics_order_dto',
      );
      assert.ok(listedOrder);
      assert.equal(listedOrder.entryAmountCents, 123400);
      assert.equal(listedOrder.tasterCommissionCents, 8000);
      assert.deepEqual(listedOrder.tasterCommission, order.tasterCommission);
      assert.equal(listedOrder.tasterName, 'Metrics Taster');
      assertSalesOrderDtoStableEqual(listedOrder, order);
    },
    {
      prisma: {
        users: [
          {
            id: 'usr_metrics_taster',
            name: 'Metrics Taster',
            username: 'metrics-taster',
            role: 'taster',
          },
          {
            id: 'usr_metrics_finance',
            name: 'Metrics Finance',
            username: 'metrics-finance',
            role: 'finance',
          },
        ],
        travelGroups: [
          {
            id: 'tg_metrics_order_dto',
            groupNo: 'TG-METRICS-ORDER-DTO',
            visitDate: '2026-07-04T00:00:00.000Z',
            travelAgency: 'Metrics Agency',
            tasterId: 'usr_metrics_taster',
            tasterName: 'Metrics Taster',
          },
        ],
        salesOrders: [
          {
            id: 'so_metrics_order_dto',
            orderNo: 'SO-METRICS-ORDER-DTO',
            orderType: 'TRAVEL_GROUP',
            travelGroupId: 'tg_metrics_order_dto',
            orderDate: '2026-07-04T00:00:00.000Z',
            customerName: 'Metrics Customer',
            totalAmountCents: 123400,
            items: [
              {
                productName: 'Metrics Product',
                quantity: 1,
                unitPriceCents: 123400,
                deliveryType: 'SHIPPING',
              },
            ],
          },
        ],
        commissionRecords: [
          {
            id: 'cr_metrics_order_taster',
            salesOrderId: 'so_metrics_order_dto',
            travelGroupId: 'tg_metrics_order_dto',
            targetType: 'TASTER_COMMISSION',
            targetUserId: 'usr_metrics_taster',
            amountCents: 8000,
            manualInput: true,
            isConfirmed: true,
            confirmedById: 'usr_metrics_finance',
            confirmedAt: '2026-07-05T08:00:00.000Z',
          },
          {
            id: 'cr_metrics_group_taster',
            travelGroupId: 'tg_metrics_order_dto',
            targetType: 'TASTER_COMMISSION',
            amountCents: 1200,
            manualInput: true,
          },
          {
            id: 'cr_metrics_sales_ignored',
            salesOrderId: 'so_metrics_order_dto',
            travelGroupId: 'tg_metrics_order_dto',
            targetType: 'SALES_COMMISSION',
            amountCents: 999999,
          },
        ],
      },
    },
  );
});

test('contract: sales order DTO keeps legacy snapshots without customer relation', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);

      const detail = await requestJson(
        baseUrl,
        '/api/sales-orders/legacy_sales_order_dto',
        {
          token: admin.token,
        },
      );
      assert.equal(detail.response.status, 200);
      const order = detail.body.data.salesOrder;
      assertSalesOrderDtoPhase4(order);
      assert.equal(order.customerId, null);
      assert.equal(order.customer, null);
      assert.equal(order.customerName, 'Legacy Snapshot Customer');
      assert.equal(order.customerPhone, '13900004444');
      assert.equal(order.province, 'Legacy Province');
      assert.equal(order.city, 'Legacy City');
      assert.equal(order.district, 'Legacy District');
      assert.equal(order.address, 'Legacy Address');
      assert.equal(order.deliverySummary, null);
      assert.deepEqual(order.items, []);

      const list = await requestJson(baseUrl, '/api/sales-orders', {
        token: admin.token,
      });
      assert.equal(list.response.status, 200);
      assert.equal(list.body.data.salesOrders.length, 1);
      assertSalesOrderDtoStableEqual(list.body.data.salesOrders[0], order);

      const enabled = await requestJson(
        baseUrl,
        '/api/settings/global-mark-query/enable',
        {
          method: 'POST',
          token: admin.token,
        },
      );
      assert.equal(enabled.response.status, 200);

      const hiddenList = await requestJson(baseUrl, '/api/sales-orders', {
        token: admin.token,
      });
      assert.equal(hiddenList.response.status, 200);
      assert.deepEqual(hiddenList.body.data.salesOrders, []);

      const hiddenDetail = await requestJson(
        baseUrl,
        '/api/sales-orders/legacy_sales_order_dto',
        {
          token: admin.token,
        },
      );
      assertErrorContract(hiddenDetail, 404, 'SALES_ORDER_NOT_FOUND');
    },
    {
      prisma: {
        salesOrders: [
          {
            id: 'legacy_sales_order_dto',
            orderNo: 'SO-LEGACY-DTO',
            orderType: 'EXTERNAL',
            customerId: null,
            customerName: 'Legacy Snapshot Customer',
            customerPhone: '13900004444',
            province: 'Legacy Province',
            city: 'Legacy City',
            district: 'Legacy District',
            address: 'Legacy Address',
            orderDate: '2026-06-28',
            totalAmountCents: 12300,
            cashOnDeliveryAmountCents: 0,
            packingStatus: 'PACKED',
            status: 'VALID',
          },
        ],
      },
    },
  );
});

test('contract: sales order list supports phase 4 filters and role scopes', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    await configureDefaultPaymentMethodServiceFeeRate(
      baseUrl,
      admin.token,
    );
    const salesUser = await createUser(baseUrl, admin.token, {
      name: 'Order Filter Sales',
      username: 'order-filter-sales',
      password: 'Password123',
      role: 'sales',
    });
    const warehouseUser = await createUser(baseUrl, admin.token, {
      name: 'Order Filter Warehouse',
      username: 'order-filter-warehouse',
      password: 'Password123',
      role: 'warehouse',
    });
    const tasterUser = await createUser(baseUrl, admin.token, {
      name: 'Order Filter Taster',
      username: 'order-filter-taster',
      password: 'Password123',
      role: 'taster',
    });
    const afterSalesUser = await createUser(baseUrl, admin.token, {
      name: 'Order Filter After Sales',
      username: 'order-filter-after-sales',
      password: 'Password123',
      role: 'after_sales',
    });
    const sales = await login(baseUrl, salesUser.username, 'Password123');
    const warehouse = await login(
      baseUrl,
      warehouseUser.username,
      'Password123',
    );
    const taster = await login(baseUrl, tasterUser.username, 'Password123');
    const afterSales = await login(
      baseUrl,
      afterSalesUser.username,
      'Password123',
    );

    const group = await createScopedTravelGroup(baseUrl, admin.token, {
      visitDate: SHANGHAI_TODAY,
      travelAgency: 'Filter Travel Agency',
      tasterId: tasterUser.id,
    });
    const markedCustomer = await createCustomerFixture(baseUrl, admin.token, {
      name: 'Filter Marked Customer',
      phone: '13900001001',
      province: 'Guizhou',
      city: 'Guiyang',
      district: 'Guanshanhu',
      address: 'Filter Shipping Address',
    });
    await setCustomerFinanceMark(
      baseUrl,
      admin.token,
      markedCustomer.id,
      true,
    );
    const unmarkedCustomer = await createCustomerFixture(baseUrl, admin.token, {
      name: 'Filter Unmarked Customer',
      phone: '13900001002',
      address: 'Filter Pickup Address',
    });

    const shippingCreated = await requestJson(baseUrl, '/api/sales-orders', {
      method: 'POST',
      token: admin.token,
      body: {
        orderType: 'travel_group',
        travelGroupId: group.id,
        customerId: markedCustomer.id,
        salesUserId: salesUser.id,
        orderDate: '2026-06-29',
        salesFormNo: 'FORM-FILTER-001',
        items: [
          {
            productName: 'Filter Shipping Product',
            quantity: 1,
            unitPriceCents: 12000,
            deliveryType: 'shipping',
          },
        ],
      },
    });
    assert.equal(shippingCreated.response.status, 201);
    const shippingOrder = shippingCreated.body.data.salesOrder;
    await setSalesOrderFinanceMark(baseUrl, admin.token, shippingOrder.id, true);

    const pickupCreated = await requestJson(baseUrl, '/api/sales-orders', {
      method: 'POST',
      token: admin.token,
      body: {
        orderType: 'external',
        customerId: unmarkedCustomer.id,
        orderDate: '2026-06-30',
        salesFormNo: 'FORM-FILTER-002',
        items: [
          {
            productName: 'Filter Pickup Product',
            quantity: 1,
            unitPriceCents: 8000,
            deliveryType: 'self_pickup',
          },
        ],
      },
    });
    assert.equal(pickupCreated.response.status, 201);
    const pickupOrder = pickupCreated.body.data.salesOrder;

    const listOrderNos = async (query, token = admin.token) => {
      const result = await requestJson(baseUrl, `/api/sales-orders?${query}`, {
        token,
      });
      assert.equal(result.response.status, 200);
      return orderNos(result.body.data.salesOrders);
    };

    assert.deepEqual(
      await listOrderNos('dateFrom=2026-06-29&dateTo=2026-06-29'),
      [shippingOrder.orderNo],
    );
    assert.deepEqual(
      await listOrderNos(`keyword=${encodeURIComponent(group.groupNo)}`),
      [shippingOrder.orderNo],
    );
    assert.deepEqual(
      await listOrderNos('query=13900001001'),
      [shippingOrder.orderNo],
    );
    assert.deepEqual(
      await listOrderNos(`customerId=${markedCustomer.id}`),
      [shippingOrder.orderNo],
    );
    assert.deepEqual(
      await listOrderNos('customerPhone=13900001002'),
      [pickupOrder.orderNo],
    );
    assert.deepEqual(
      await listOrderNos(`travelGroupId=${group.id}`),
      [shippingOrder.orderNo],
    );
    assert.deepEqual(await listOrderNos('orderType=travel_group'), [
      shippingOrder.orderNo,
    ]);
    assert.deepEqual(await listOrderNos('status=valid'), [
      pickupOrder.orderNo,
      shippingOrder.orderNo,
    ].sort());
    assert.deepEqual(await listOrderNos('deliveryType=shipping'), [
      shippingOrder.orderNo,
    ]);
    assert.deepEqual(await listOrderNos('packingStatus=pending'), [
      shippingOrder.orderNo,
    ]);
    assert.deepEqual(await listOrderNos('financeMark=true'), [
      shippingOrder.orderNo,
    ]);
    assert.deepEqual(await listOrderNos('customerFinanceMark=true'), [
      shippingOrder.orderNo,
    ]);
    assert.deepEqual(await listOrderNos(`salesUserId=${salesUser.id}`), [
      shippingOrder.orderNo,
    ]);
    assert.equal((await listOrderNos('limit=1')).length, 1);

    assert.deepEqual(await listOrderNos('', sales.token), [
      shippingOrder.orderNo,
    ]);
    assert.deepEqual(await listOrderNos('', warehouse.token), [
      shippingOrder.orderNo,
    ]);
    assert.deepEqual(await listOrderNos('', afterSales.token), [
      pickupOrder.orderNo,
      shippingOrder.orderNo,
    ].sort());

    const salesVisibleDetail = await requestJson(
      baseUrl,
      `/api/sales-orders/${shippingOrder.id}`,
      {
        token: sales.token,
      },
    );
    assert.equal(salesVisibleDetail.response.status, 200);
    assert.equal(salesVisibleDetail.body.data.salesOrder.id, shippingOrder.id);

    const salesHiddenDetail = await requestJson(
      baseUrl,
      `/api/sales-orders/${pickupOrder.id}`,
      {
        token: sales.token,
      },
    );
    assertErrorContract(salesHiddenDetail, 404, 'SALES_ORDER_NOT_FOUND');

    const afterSalesVisibleDetail = await requestJson(
      baseUrl,
      `/api/sales-orders/${pickupOrder.id}`,
      {
        token: afterSales.token,
      },
    );
    assert.equal(afterSalesVisibleDetail.response.status, 200);
    assert.equal(
      afterSalesVisibleDetail.body.data.salesOrder.id,
      pickupOrder.id,
    );

    const warehouseHiddenDetail = await requestJson(
      baseUrl,
      `/api/sales-orders/${pickupOrder.id}`,
      {
        token: warehouse.token,
      },
    );
    assertErrorContract(
      warehouseHiddenDetail,
      404,
      'SALES_ORDER_NOT_FOUND',
    );

    const liaisonOnlyGroup = await createScopedTravelGroup(baseUrl, admin.token, {
      visitDate: SHANGHAI_TODAY,
      travelAgency: 'Filter Liaison Only Agency',
      liaisonTasterId: tasterUser.id,
    });
    const liaisonOnlyOrder = await requestJson(baseUrl, '/api/sales-orders', {
      method: 'POST',
      token: admin.token,
      body: {
        orderType: 'travel_group',
        travelGroupId: liaisonOnlyGroup.id,
        customerId: markedCustomer.id,
        orderDate: '2026-06-29',
        salesFormNo: 'FORM-FILTER-LIAISON',
        items: [
          {
            productName: 'Filter Liaison Product',
            quantity: 1,
            unitPriceCents: 6000,
            deliveryType: 'shipping',
          },
        ],
      },
    });
    assert.equal(liaisonOnlyOrder.response.status, 201);

    const tasterList = await requestJson(baseUrl, '/api/sales-orders', {
      token: taster.token,
    });
    assert.equal(tasterList.response.status, 200);
    assert.deepEqual(orderNos(tasterList.body.data.salesOrders), [
      shippingOrder.orderNo,
    ]);
    const tasterListedOrder = tasterList.body.data.salesOrders[0];
    assert.equal(tasterListedOrder.entryAmountCents, 0);
    assert.equal(tasterListedOrder.tasterCommissionCents, 0);
    assert.equal(tasterListedOrder.financeRemark, null);
    assert.equal(tasterListedOrder.financeMark, false);
    assert.equal(tasterListedOrder.markedById, null);
    assert.equal(tasterListedOrder.markedAt, null);
    assert.equal(tasterListedOrder.customer.financeMark, false);
    assert.equal(tasterListedOrder.customer.markedById, null);
    assert.equal(tasterListedOrder.customer.markedAt, null);

    const tasterSensitiveFilterList = await requestJson(
      baseUrl,
      '/api/sales-orders?financeMark=false&customerFinanceMark=false',
      {
        token: taster.token,
      },
    );
    assert.equal(tasterSensitiveFilterList.response.status, 200);
    assert.deepEqual(
      orderNos(tasterSensitiveFilterList.body.data.salesOrders),
      [shippingOrder.orderNo],
    );

    const tasterOwnDetail = await requestJson(
      baseUrl,
      `/api/sales-orders/${shippingOrder.id}`,
      {
        token: taster.token,
      },
    );
    assert.equal(tasterOwnDetail.response.status, 200);
    assert.equal(tasterOwnDetail.body.data.salesOrder.id, shippingOrder.id);
    assert.equal(tasterOwnDetail.body.data.salesOrder.entryAmountCents, 0);
    assert.equal(
      tasterOwnDetail.body.data.salesOrder.tasterCommissionCents,
      0,
    );
    assert.equal(tasterOwnDetail.body.data.salesOrder.financeMark, false);
    assert.equal(
      tasterOwnDetail.body.data.salesOrder.customer.financeMark,
      false,
    );
    const tasterExternalDetail = await requestJson(
      baseUrl,
      `/api/sales-orders/${pickupOrder.id}`,
      {
        token: taster.token,
      },
    );
    assertErrorContract(tasterExternalDetail, 404, 'SALES_ORDER_NOT_FOUND');
    const tasterLiaisonOnlyDetail = await requestJson(
      baseUrl,
      `/api/sales-orders/${liaisonOnlyOrder.body.data.salesOrder.id}`,
      {
        token: taster.token,
      },
    );
    assertErrorContract(tasterLiaisonOnlyDetail, 404, 'SALES_ORDER_NOT_FOUND');
  });
});

test('contract: sales order patch enforces field permissions, replaces items, updates customers, and refreshes travel group summaries', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const salesAlphaUser = await createUser(baseUrl, admin.token, {
      name: 'Order Patch Sales Alpha',
      username: 'order-patch-sales-alpha',
      password: 'Password123',
      role: 'sales',
    });
    const salesBetaUser = await createUser(baseUrl, admin.token, {
      name: 'Order Patch Sales Beta',
      username: 'order-patch-sales-beta',
      password: 'Password123',
      role: 'sales',
    });
    const financeUser = await createUser(baseUrl, admin.token, {
      name: 'Order Patch Finance',
      username: 'order-patch-finance',
      password: 'Password123',
      role: 'finance',
    });
    const warehouseUser = await createUser(baseUrl, admin.token, {
      name: 'Order Patch Warehouse',
      username: 'order-patch-warehouse',
      password: 'Password123',
      role: 'warehouse',
    });
    const bossUser = await createUser(baseUrl, admin.token, {
      name: 'Order Patch Boss',
      username: 'order-patch-boss',
      password: 'Password123',
      role: 'boss',
    });
    const tasterUser = await createUser(baseUrl, admin.token, {
      name: 'Order Patch Taster',
      username: 'order-patch-taster',
      password: 'Password123',
      role: 'taster',
    });
    const afterSalesUser = await createUser(baseUrl, admin.token, {
      name: 'Order Patch After Sales',
      username: 'order-patch-after-sales',
      password: 'Password123',
      role: 'after_sales',
    });
    const salesAlpha = await login(
      baseUrl,
      salesAlphaUser.username,
      'Password123',
    );
    const salesBeta = await login(
      baseUrl,
      salesBetaUser.username,
      'Password123',
    );
    const finance = await login(baseUrl, financeUser.username, 'Password123');
    const warehouse = await login(
      baseUrl,
      warehouseUser.username,
      'Password123',
    );
    const boss = await login(baseUrl, bossUser.username, 'Password123');
    const taster = await login(baseUrl, tasterUser.username, 'Password123');
    const afterSales = await login(
      baseUrl,
      afterSalesUser.username,
      'Password123',
    );

    const groupA = await createScopedTravelGroup(baseUrl, admin.token, {
      visitDate: '2026-06-29',
      travelAgency: 'Patch Travel Agency A',
    });
    const groupB = await createScopedTravelGroup(baseUrl, admin.token, {
      visitDate: '2026-06-30',
      travelAgency: 'Patch Travel Agency B',
    });
    const customerA = await createCustomerFixture(baseUrl, admin.token, {
      name: 'Patch Customer A',
      phone: '13900002000',
      province: 'Guizhou',
      city: 'Guiyang',
      district: 'Nanming',
      address: 'Patch Address A',
    });
    const customerB = await createCustomerFixture(baseUrl, admin.token, {
      name: 'Patch Customer B',
      phone: '13900002002',
      province: 'Sichuan',
      city: 'Chengdu',
      district: 'Wuhou',
      address: 'Patch Address B',
    });

    const created = await requestJson(baseUrl, '/api/sales-orders', {
      method: 'POST',
      token: admin.token,
      body: {
        orderType: 'travel_group',
        travelGroupId: groupA.id,
        customerId: customerA.id,
        salesUserId: salesAlphaUser.id,
        orderDate: '2026-06-29',
        cashOnDeliveryAmountCents: 1000,
        paymentDetails: [
          {
            paymentMethodId:
              '00000000-0000-4000-8000-000000000001',
            amountCents: 9000,
          },
          {
            paymentMethodId:
              '00000000-0000-4000-8000-000000000005',
            amountCents: 1000,
          },
        ],
        paymentDetails: [
          {
            paymentMethodId:
              '00000000-0000-4000-8000-000000000001',
            amountCents: 9000,
          },
          {
            paymentMethodId:
              '00000000-0000-4000-8000-000000000005',
            amountCents: 1000,
          },
        ],
        items: [
          {
            productName: 'Patch Initial Product',
            quantity: 1,
            unitPriceCents: 10000,
            deliveryType: 'shipping',
          },
        ],
      },
    });
    assert.equal(created.response.status, 201);
    const originalOrder = created.body.data.salesOrder;
    assert.equal(originalOrder.salesUserId, salesAlphaUser.id);

    const initialGroupA = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupA.id}`,
      {
        token: admin.token,
      },
    );
    assert.equal(initialGroupA.response.status, 200);
    assert.equal(initialGroupA.body.data.travelGroup.status, 'ordered');
    assert.equal(initialGroupA.body.data.travelGroup.salesAmountCents, 10000);
    assert.equal(initialGroupA.body.data.travelGroup.orderAmountCents, 10000);
    assert.equal(
      initialGroupA.body.data.travelGroup.cashOnDeliveryCents,
      1000,
    );

    const salesPatch = await requestJson(
      baseUrl,
      `/api/sales-orders/${originalOrder.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          salesFormNo: 'PATCH-FORM-001',
          orderType: 'travel_group',
          orderDate: '2026-06-30',
          salesUserId: salesAlphaUser.id,
          outreachUserId: salesAlphaUser.id,
          customer: {
            name: 'Patch Customer Updated',
            phone: '13900002001',
            province: 'Guizhou',
            city: 'Guiyang',
            district: 'Yunyan',
            address: 'Patch Updated Address',
            notes: 'patch note',
          },
          cashOnDeliveryAmountCents: 2500,
          paymentDetails: [
            {
              paymentMethodId:
                '00000000-0000-4000-8000-000000000001',
              amountCents: 14500,
            },
            {
              paymentMethodId:
                '00000000-0000-4000-8000-000000000005',
              amountCents: 2500,
            },
          ],
          paymentDetails: [
            {
              paymentMethodId:
                '00000000-0000-4000-8000-000000000001',
              amountCents: 14500,
            },
            {
              paymentMethodId:
                '00000000-0000-4000-8000-000000000005',
              amountCents: 2500,
            },
          ],
          invoiceRequired: true,
          remark: 'sales patch remark',
          status: 'partial_refund',
          items: [
            {
              productName: 'Patch Product A',
              quantity: 2,
              unitPriceCents: 7000,
              deliveryType: 'shipping',
              notes: 'first',
              sortOrder: 2,
            },
            {
              productName: 'Patch Product B',
              quantity: 1,
              unitPriceCents: 3000,
              deliveryType: 'self_pickup',
              notes: 'second',
              sortOrder: 1,
            },
          ],
        },
      },
    );
    assert.equal(salesPatch.response.status, 200);
    const salesPatchedOrder = salesPatch.body.data.salesOrder;
    assert.equal(salesPatchedOrder.salesFormNo, 'PATCH-FORM-001');
    assert.equal(salesPatchedOrder.orderType, 'travel_group');
    assert.equal(salesPatchedOrder.orderDate, '2026-06-30');
    assert.equal(salesPatchedOrder.salesUserId, salesAlphaUser.id);
    assert.equal(salesPatchedOrder.outreachUserId, salesAlphaUser.id);
    assert.equal(salesPatchedOrder.status, 'partial_refund');
    assert.equal(salesPatchedOrder.customerId, customerA.id);
    assert.equal(salesPatchedOrder.customerName, 'Patch Customer Updated');
    assert.equal(salesPatchedOrder.customerPhone, '13900002001');
    assert.equal(salesPatchedOrder.address, 'Patch Updated Address');
    assert.equal(salesPatchedOrder.customer.financeMark, false);
    assert.equal(salesPatchedOrder.totalAmountCents, 17000);
    assert.equal(salesPatchedOrder.cashOnDeliveryAmountCents, 2500);
    assert.equal(salesPatchedOrder.invoiceRequired, true);
    assert.equal(salesPatchedOrder.remark, 'sales patch remark');
    assert.equal(salesPatchedOrder.deliverySummary, 'mixed');
    assert.deepEqual(
      salesPatchedOrder.items.map((item) => item.productName).sort(),
      ['Patch Product A', 'Patch Product B'],
    );
    assert.equal(
      salesPatchedOrder.items.find((item) => item.productName === 'Patch Product A')
        .subtotalCents,
      14000,
    );
    assert.equal(
      salesPatchedOrder.items.find((item) => item.productName === 'Patch Product B')
        .deliveryType,
      'self_pickup',
    );
    assert.equal(
      salesPatchedOrder.items.find((item) => item.productName === 'Patch Product B')
        .sortOrder,
      1,
    );

    const patchedGroupA = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupA.id}`,
      {
        token: admin.token,
      },
    );
    assert.equal(patchedGroupA.response.status, 200);
    assert.equal(patchedGroupA.body.data.travelGroup.status, 'ordered');
    assert.equal(patchedGroupA.body.data.travelGroup.salesAmountCents, 17000);
    assert.equal(patchedGroupA.body.data.travelGroup.orderAmountCents, 17000);
    assert.equal(
      patchedGroupA.body.data.travelGroup.cashOnDeliveryCents,
      2500,
    );

    const customerUpdateLogs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=customers.update',
      {
        token: admin.token,
      },
    );
    assert.equal(customerUpdateLogs.response.status, 200);
    assert.equal(customerUpdateLogs.body.data.logs.length, 1);
    assert.equal(
      customerUpdateLogs.body.data.logs[0].beforeData.name,
      'Patch Customer A',
    );
    assert.equal(
      customerUpdateLogs.body.data.logs[0].afterData.name,
      'Patch Customer Updated',
    );

    const salesCannotPatchWarehouseField = await requestJson(
      baseUrl,
      `/api/sales-orders/${originalOrder.id}`,
      {
        method: 'PATCH',
        token: salesAlpha.token,
        body: {
          logisticsNo: 'NOPE',
        },
      },
    );
    assertErrorContract(
      salesCannotPatchWarehouseField,
      403,
      'PERMISSION_DENIED',
    );

    const salesCannotPatchCustomerMark = await requestJson(
      baseUrl,
      `/api/sales-orders/${originalOrder.id}`,
      {
        method: 'PATCH',
        token: salesAlpha.token,
        body: {
          customer: {
            financeMark: true,
          },
        },
      },
    );
    assertErrorContract(
      salesCannotPatchCustomerMark,
      403,
      'PERMISSION_DENIED',
    );

    const salesFinancePatch = await requestJson(
      baseUrl,
      `/api/sales-orders/${originalOrder.id}/finance`,
      {
        method: 'PATCH',
        token: salesAlpha.token,
        body: {
          logisticsNo: 'SF-SALES-001',
          logisticsFeeCents: 1800,
          invoiceIssued: true,
          financeRemark: 'sales finance fields',
          status: 'valid',
        },
      },
    );
    assertErrorContract(salesFinancePatch, 403, 'PERMISSION_DENIED');

    const salesPackingPatch = await requestJson(
      baseUrl,
      `/api/sales-orders/${originalOrder.id}/packing`,
      {
        method: 'PATCH',
        token: salesAlpha.token,
        body: {
          logisticsMethod: 'SF Express',
          packingStatus: 'packed',
          packageCount: 3,
          warehouseRemark: 'sales packing fields',
        },
      },
    );
    assertErrorContract(salesPackingPatch, 403, 'PERMISSION_DENIED');

    const otherSalesPatch = await requestJson(
      baseUrl,
      `/api/sales-orders/${originalOrder.id}`,
      {
        method: 'PATCH',
        token: salesBeta.token,
        body: {
          remark: 'should not update',
        },
      },
    );
    assertErrorContract(otherSalesPatch, 403, 'PERMISSION_DENIED');

    const otherSalesFinancePatch = await requestJson(
      baseUrl,
      `/api/sales-orders/${originalOrder.id}/finance`,
      {
        method: 'PATCH',
        token: salesBeta.token,
        body: {
          logisticsNo: 'SHOULD-NOT-UPDATE',
        },
      },
    );
    assertErrorContract(
      otherSalesFinancePatch,
      403,
      'PERMISSION_DENIED',
    );

    const otherSalesPackingPatch = await requestJson(
      baseUrl,
      `/api/sales-orders/${originalOrder.id}/packing`,
      {
        method: 'PATCH',
        token: salesBeta.token,
        body: {
          packageCount: 9,
        },
      },
    );
    assertErrorContract(
      otherSalesPackingPatch,
      403,
      'PERMISSION_DENIED',
    );

    for (const token of [
      warehouse.token,
      boss.token,
      taster.token,
      afterSales.token,
    ]) {
      const forbidden = await requestJson(
        baseUrl,
        `/api/sales-orders/${originalOrder.id}`,
        {
          method: 'PATCH',
          token,
          body: {
            remark: 'not allowed',
          },
        },
      );
      assertErrorContract(forbidden, 403, 'PERMISSION_DENIED');
    }

    const financePatch = await requestJson(
      baseUrl,
      `/api/sales-orders/${originalOrder.id}`,
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          customerId: customerB.id,
          travelGroupId: groupB.id,
          salesUserId: salesBetaUser.id,
          cashOnDeliveryAmountCents: 3500,
          paymentDetails: [
            {
              paymentMethodId:
                '00000000-0000-4000-8000-000000000001',
              amountCents: 7500,
            },
            {
              paymentMethodId:
                '00000000-0000-4000-8000-000000000005',
              amountCents: 3500,
            },
          ],
          remark: 'finance moved order',
          items: [
            {
              productName: 'Finance Patch Product',
              quantity: 1,
              unitPriceCents: 11000,
              deliveryType: 'shipping',
            },
          ],
        },
      },
    );
    assert.equal(financePatch.response.status, 200);
    const financePatchedOrder = financePatch.body.data.salesOrder;
    assert.equal(financePatchedOrder.customerId, customerB.id);
    assert.equal(financePatchedOrder.travelGroupId, groupB.id);
    assert.equal(financePatchedOrder.salesUserId, salesBetaUser.id);
    assert.equal(financePatchedOrder.totalAmountCents, 11000);
    assert.equal(financePatchedOrder.cashOnDeliveryAmountCents, 3500);
    assert.equal(financePatchedOrder.remark, 'finance moved order');

    const adminPatch = await requestJson(
      baseUrl,
      `/api/sales-orders/${originalOrder.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          customerId: customerB.id,
          travelGroupId: groupB.id,
          status: 'partial_refund',
          salesUserId: salesBetaUser.id,
          cashOnDeliveryAmountCents: 4000,
          paymentDetails: [
            {
              paymentMethodId:
                '00000000-0000-4000-8000-000000000001',
              amountCents: 14000,
            },
            {
              paymentMethodId:
                '00000000-0000-4000-8000-000000000005',
              amountCents: 4000,
            },
          ],
          remark: 'admin moved order',
          items: [
            {
              productName: 'Admin Patch Product',
              quantity: 2,
              unitPriceCents: 9000,
              deliveryType: 'shipping',
            },
          ],
        },
      },
    );
    assert.equal(adminPatch.response.status, 200);
    const adminPatchedOrder = adminPatch.body.data.salesOrder;
    assert.equal(adminPatchedOrder.customerId, customerB.id);
    assert.equal(adminPatchedOrder.customerName, 'Patch Customer B');
    assert.equal(adminPatchedOrder.customerPhone, '13900002002');
    assert.equal(adminPatchedOrder.address, 'Patch Address B');
    assert.equal(adminPatchedOrder.travelGroupId, groupB.id);
    assert.equal(adminPatchedOrder.status, 'partial_refund');
    assert.equal(adminPatchedOrder.salesUserId, salesBetaUser.id);
    assert.equal(adminPatchedOrder.totalAmountCents, 18000);
    assert.equal(adminPatchedOrder.cashOnDeliveryAmountCents, 4000);
    assert.deepEqual(
      adminPatchedOrder.items.map((item) => item.productName),
      ['Admin Patch Product'],
    );

    const movedGroupA = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupA.id}`,
      {
        token: admin.token,
      },
    );
    assert.equal(movedGroupA.response.status, 200);
    assert.equal(movedGroupA.body.data.travelGroup.status, 'unmarked');
    assert.equal(movedGroupA.body.data.travelGroup.salesAmountCents, 0);
    assert.equal(movedGroupA.body.data.travelGroup.orderAmountCents, 0);
    assert.equal(movedGroupA.body.data.travelGroup.cashOnDeliveryCents, 0);

    const movedGroupB = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupB.id}`,
      {
        token: admin.token,
      },
    );
    assert.equal(movedGroupB.response.status, 200);
    assert.equal(movedGroupB.body.data.travelGroup.status, 'ordered');
    assert.equal(movedGroupB.body.data.travelGroup.salesAmountCents, 18000);
    assert.equal(movedGroupB.body.data.travelGroup.orderAmountCents, 18000);
    assert.equal(movedGroupB.body.data.travelGroup.cashOnDeliveryCents, 4000);

    const cancelled = await requestJson(
      baseUrl,
      `/api/sales-orders/${originalOrder.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          status: 'cancelled',
        },
      },
    );
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.body.data.salesOrder.status, 'cancelled');

    const cancelledGroupB = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupB.id}`,
      {
        token: admin.token,
      },
    );
    assert.equal(cancelledGroupB.response.status, 200);
    assert.equal(cancelledGroupB.body.data.travelGroup.status, 'unmarked');
    assert.equal(cancelledGroupB.body.data.travelGroup.salesAmountCents, 0);
    assert.equal(cancelledGroupB.body.data.travelGroup.orderAmountCents, 0);
    assert.equal(cancelledGroupB.body.data.travelGroup.cashOnDeliveryCents, 0);

    const orderUpdateLogs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=sales_orders.update&result=SUCCESS',
      {
        token: admin.token,
      },
    );
    assert.equal(orderUpdateLogs.response.status, 200);
    assert.equal(orderUpdateLogs.body.data.logs.length, 4);
    assert.ok(
      orderUpdateLogs.body.data.logs.some(
        (log) => log.afterData.status === 'cancelled',
      ),
    );
    assert.ok(
      orderUpdateLogs.body.data.logs.some(
        (log) =>
          log.beforeData.totalAmountCents === 10000 &&
          log.afterData.totalAmountCents === 17000,
      ),
    );
  });
});

test('contract: sales order finance patch updates finance fields and rejects unauthorized changes', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const financeUser = await createUser(baseUrl, admin.token, {
      name: 'Order Finance Patch Finance',
      username: 'order-finance-patch-finance',
      password: 'Password123',
      role: 'finance',
    });
    const bossUser = await createUser(baseUrl, admin.token, {
      name: 'Order Finance Patch Boss',
      username: 'order-finance-patch-boss',
      password: 'Password123',
      role: 'boss',
    });
    const frontDeskUser = await createUser(baseUrl, admin.token, {
      name: 'Order Finance Patch Front Desk',
      username: 'order-finance-patch-front-desk',
      password: 'Password123',
      role: 'front_desk',
    });
    const salesUser = await createUser(baseUrl, admin.token, {
      name: 'Order Finance Patch Sales',
      username: 'order-finance-patch-sales',
      password: 'Password123',
      role: 'sales',
    });
    const warehouseUser = await createUser(baseUrl, admin.token, {
      name: 'Order Finance Patch Warehouse',
      username: 'order-finance-patch-warehouse',
      password: 'Password123',
      role: 'warehouse',
    });
    const afterSalesUser = await createUser(baseUrl, admin.token, {
      name: 'Order Finance Patch After Sales',
      username: 'order-finance-patch-after-sales',
      password: 'Password123',
      role: 'after_sales',
    });
    const tasterUser = await createUser(baseUrl, admin.token, {
      name: 'Order Finance Patch Taster',
      username: 'order-finance-patch-taster',
      password: 'Password123',
      role: 'taster',
    });
    const finance = await login(
      baseUrl,
      financeUser.username,
      'Password123',
    );
    const boss = await login(baseUrl, bossUser.username, 'Password123');
    const frontDesk = await login(
      baseUrl,
      frontDeskUser.username,
      'Password123',
    );
    const sales = await login(baseUrl, salesUser.username, 'Password123');
    const warehouse = await login(
      baseUrl,
      warehouseUser.username,
      'Password123',
    );
    const afterSales = await login(
      baseUrl,
      afterSalesUser.username,
      'Password123',
    );
    const taster = await login(baseUrl, tasterUser.username, 'Password123');

    const group = await createScopedTravelGroup(baseUrl, admin.token, {
      visitDate: '2026-06-29',
      travelAgency: 'Order Finance Patch Agency',
    });
    const customer = await createCustomerFixture(baseUrl, admin.token, {
      name: 'Order Finance Patch Customer',
      phone: '13900003000',
      province: 'Guizhou',
      city: 'Guiyang',
      district: 'Nanming',
      address: 'Order Finance Patch Address',
    });
    const created = await requestJson(baseUrl, '/api/sales-orders', {
      method: 'POST',
      token: admin.token,
      body: {
        orderType: 'travel_group',
        travelGroupId: group.id,
        customerId: customer.id,
        orderDate: '2026-06-29',
        items: [
          {
            productName: 'Order Finance Patch Product',
            quantity: 1,
            unitPriceCents: 12000,
            deliveryType: 'shipping',
          },
        ],
      },
    });
    assert.equal(created.response.status, 201);
    const order = created.body.data.salesOrder;

    const initialGroup = await requestJson(
      baseUrl,
      `/api/travel-groups/${group.id}`,
      {
        token: admin.token,
      },
    );
    assert.equal(initialGroup.response.status, 200);
    assert.equal(initialGroup.body.data.travelGroup.status, 'ordered');
    assert.equal(initialGroup.body.data.travelGroup.salesAmountCents, 12000);
    assert.equal(initialGroup.body.data.travelGroup.orderAmountCents, 12000);

    const financePatch = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}/finance`,
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          logisticsNo: 'SF-FIN-001',
          logisticsFeeCents: 1888,
          invoiceIssued: true,
          financeRemark: 'finance checked test',
          status: 'cancelled',
        },
      },
    );
    assert.equal(financePatch.response.status, 200);
    const financePatchedOrder = financePatch.body.data.salesOrder;
    assertSalesOrderDtoPhase4(financePatchedOrder);
    assert.equal(financePatchedOrder.id, order.id);
    assert.equal(financePatchedOrder.customer.id, customer.id);
    assert.equal(financePatchedOrder.travelGroup.id, group.id);
    assert.equal(financePatchedOrder.logisticsNo, 'SF-FIN-001');
    assert.equal(financePatchedOrder.logisticsFeeCents, 1888);
    assert.equal(financePatchedOrder.invoiceIssued, true);
    assert.equal(financePatchedOrder.financeRemark, 'finance checked test');
    assert.equal(financePatchedOrder.status, 'cancelled');
    assert.equal(financePatchedOrder.totalAmountCents, 12000);
    assert.deepEqual(
      financePatchedOrder.items.map((item) => item.productName),
      ['Order Finance Patch Product'],
    );

    const cancelledGroup = await requestJson(
      baseUrl,
      `/api/travel-groups/${group.id}`,
      {
        token: admin.token,
      },
    );
    assert.equal(cancelledGroup.response.status, 200);
    assert.equal(cancelledGroup.body.data.travelGroup.status, 'unmarked');
    assert.equal(cancelledGroup.body.data.travelGroup.salesAmountCents, 0);
    assert.equal(cancelledGroup.body.data.travelGroup.orderAmountCents, 0);

    const adminPatch = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}/finance`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          logisticsNo: null,
          logisticsFeeCents: 0,
          invoiceIssued: false,
          financeRemark: null,
          status: 'partial_refund',
        },
      },
    );
    assert.equal(adminPatch.response.status, 200);
    const adminPatchedOrder = adminPatch.body.data.salesOrder;
    assertSalesOrderDtoPhase4(adminPatchedOrder);
    assert.equal(adminPatchedOrder.logisticsNo, null);
    assert.equal(adminPatchedOrder.logisticsFeeCents, 0);
    assert.equal(adminPatchedOrder.invoiceIssued, false);
    assert.equal(adminPatchedOrder.financeRemark, null);
    assert.equal(adminPatchedOrder.status, 'partial_refund');

    const partialRefundGroup = await requestJson(
      baseUrl,
      `/api/travel-groups/${group.id}`,
      {
        token: admin.token,
      },
    );
    assert.equal(partialRefundGroup.response.status, 200);
    assert.equal(partialRefundGroup.body.data.travelGroup.status, 'ordered');
    assert.equal(
      partialRefundGroup.body.data.travelGroup.salesAmountCents,
      12000,
    );
    assert.equal(
      partialRefundGroup.body.data.travelGroup.orderAmountCents,
      12000,
    );

    const salesForbidden = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}/finance`,
      {
        method: 'PATCH',
        token: sales.token,
        body: {
          logisticsNo: 'NOPE',
        },
      },
    );
    assertErrorContract(salesForbidden, 403, 'PERMISSION_DENIED');

    for (const token of [
      boss.token,
      frontDesk.token,
      warehouse.token,
      afterSales.token,
      taster.token,
    ]) {
      const forbidden = await requestJson(
        baseUrl,
        `/api/sales-orders/${order.id}/finance`,
        {
          method: 'PATCH',
          token,
          body: {
            logisticsNo: 'NOPE',
          },
        },
      );
      assertErrorContract(forbidden, 403, 'PERMISSION_DENIED');
    }

    const forbiddenFields = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}/finance`,
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          customerId: customer.id,
          items: [],
          packingStatus: 'packed',
        },
      },
    );
    assertErrorContract(forbiddenFields, 403, 'FIELD_PERMISSION_DENIED');

    const negativeFee = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}/finance`,
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          logisticsFeeCents: -1,
        },
      },
    );
    assertErrorContract(negativeFee, 400, 'VALIDATION_FAILED');

    const invalidInvoiceIssued = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}/finance`,
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          invoiceIssued: 'maybe',
        },
      },
    );
    assertErrorContract(invalidInvoiceIssued, 400, 'VALIDATION_FAILED');

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=sales_orders.finance.update&result=SUCCESS',
      {
        token: admin.token,
      },
    );
    assert.equal(logs.response.status, 200);
    assert.equal(logs.body.data.logs.length, 2);
    assert.ok(
      logs.body.data.logs.some(
        (log) =>
          log.beforeData.logisticsFeeCents === 0 &&
          log.afterData.logisticsFeeCents === 1888 &&
          log.afterData.invoiceIssued === true &&
          log.afterData.status === 'cancelled',
      ),
    );
    assert.ok(
      logs.body.data.logs.some(
        (log) =>
          log.beforeData.status === 'cancelled' &&
          log.afterData.logisticsFeeCents === 0 &&
          log.afterData.invoiceIssued === false &&
          log.afterData.status === 'partial_refund',
      ),
    );
    for (const log of logs.body.data.logs) {
      assertSalesOrderDtoPhase4(log.afterData);
    }
  });
});

test('contract: sales order packing patch updates warehouse fields and rejects unauthorized changes', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const warehouseUser = await createUser(baseUrl, admin.token, {
      name: 'Order Packing Patch Warehouse',
      username: 'order-packing-patch-warehouse',
      password: 'Password123',
      role: 'warehouse',
    });
    const salesUser = await createUser(baseUrl, admin.token, {
      name: 'Order Packing Patch Sales',
      username: 'order-packing-patch-sales',
      password: 'Password123',
      role: 'sales',
    });
    const financeUser = await createUser(baseUrl, admin.token, {
      name: 'Order Packing Patch Finance',
      username: 'order-packing-patch-finance',
      password: 'Password123',
      role: 'finance',
    });
    const afterSalesUser = await createUser(baseUrl, admin.token, {
      name: 'Order Packing Patch After Sales',
      username: 'order-packing-patch-after-sales',
      password: 'Password123',
      role: 'after_sales',
    });
    const bossUser = await createUser(baseUrl, admin.token, {
      name: 'Order Packing Patch Boss',
      username: 'order-packing-patch-boss',
      password: 'Password123',
      role: 'boss',
    });
    const tasterUser = await createUser(baseUrl, admin.token, {
      name: 'Order Packing Patch Taster',
      username: 'order-packing-patch-taster',
      password: 'Password123',
      role: 'taster',
    });
    const warehouse = await login(
      baseUrl,
      warehouseUser.username,
      'Password123',
    );
    const sales = await login(baseUrl, salesUser.username, 'Password123');
    const finance = await login(
      baseUrl,
      financeUser.username,
      'Password123',
    );
    const afterSales = await login(
      baseUrl,
      afterSalesUser.username,
      'Password123',
    );
    const boss = await login(baseUrl, bossUser.username, 'Password123');
    const taster = await login(baseUrl, tasterUser.username, 'Password123');

    const order = await createGeneratedSalesOrder(baseUrl, admin.token, {
      orderDate: '2026-06-29',
      customer: {
        name: 'Order Packing Patch Customer',
        phone: '13900003100',
      },
      items: [
        {
          productName: 'Order Packing Patch Product',
          quantity: 1,
          unitPriceCents: 15000,
          deliveryType: 'shipping',
        },
      ],
    });
    assert.equal(order.packingStatus, 'pending');
    assert.equal(order.packageCount, 0);
    assert.equal(order.hasPackingMark, false);
    assert.equal(order.totalAmountCents, 15000);
    assert.equal(order.status, 'valid');

    const warehousePatch = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}/packing`,
      {
        method: 'PATCH',
        token: warehouse.token,
        body: {
          logisticsMethod: 'Yunda test',
          packingStatus: 'packing',
          packageCount: 3,
          warehouseRemark: 'warehouse packing test',
          hasPackingMark: true,
        },
      },
    );
    assert.equal(warehousePatch.response.status, 200);
    const warehousePatchedOrder = warehousePatch.body.data.salesOrder;
    assertSalesOrderDtoPhase4(warehousePatchedOrder);
    assert.equal(warehousePatchedOrder.id, order.id);
    assert.equal(warehousePatchedOrder.logisticsMethod, 'Yunda test');
    assert.equal(warehousePatchedOrder.packingStatus, 'packing');
    assert.equal(warehousePatchedOrder.packageCount, 3);
    assert.equal(
      warehousePatchedOrder.warehouseRemark,
      'warehouse packing test',
    );
    assert.equal(warehousePatchedOrder.totalAmountCents, 15000);
    assert.equal(warehousePatchedOrder.status, 'valid');
    assert.equal(warehousePatchedOrder.hasPackingMark, true);
    assert.equal(warehousePatchedOrder.financeMark, false);
    assert.equal(warehousePatchedOrder.logisticsNo, null);
    assert.equal(warehousePatchedOrder.logisticsFeeCents, 0);

    const adminFinancePatch = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}/finance`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          logisticsNo: 'SF-ADMIN-TEST-001',
        },
      },
    );
    assert.equal(adminFinancePatch.response.status, 200);

    const adminPatch = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}/packing`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          logisticsMethod: 'SF admin test',
          packingStatus: 'packed',
          packageCount: 0,
          warehouseRemark: null,
          hasPackingMark: false,
        },
      },
    );
    assert.equal(adminPatch.response.status, 200);
    const adminPatchedOrder = adminPatch.body.data.salesOrder;
    assertSalesOrderDtoPhase4(adminPatchedOrder);
    assert.equal(adminPatchedOrder.logisticsMethod, 'SF admin test');
    assert.equal(adminPatchedOrder.packingStatus, 'packed');
    assert.equal(adminPatchedOrder.packageCount, 0);
    assert.equal(adminPatchedOrder.warehouseRemark, null);
    assert.equal(adminPatchedOrder.hasPackingMark, false);
    assert.equal(adminPatchedOrder.financeMark, false);

    const financePatch = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}/packing`,
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          logisticsMethod: 'Finance logistics test',
          packingStatus: 'abnormal',
          packageCount: 4,
          warehouseRemark: 'finance packing correction',
        },
      },
    );
    assert.equal(financePatch.response.status, 200);
    const financePatchedOrder = financePatch.body.data.salesOrder;
    assertSalesOrderDtoPhase4(financePatchedOrder);
    assert.equal(financePatchedOrder.logisticsMethod, 'Finance logistics test');
    assert.equal(financePatchedOrder.packingStatus, 'abnormal');
    assert.equal(financePatchedOrder.packageCount, 4);
    assert.equal(
      financePatchedOrder.warehouseRemark,
      'finance packing correction',
    );

    const salesForbidden = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}/packing`,
      {
        method: 'PATCH',
        token: sales.token,
        body: {
          packingStatus: 'packed',
        },
      },
    );
    assertErrorContract(salesForbidden, 403, 'PERMISSION_DENIED');

    for (const token of [afterSales.token, boss.token, taster.token]) {
      const forbidden = await requestJson(
        baseUrl,
        `/api/sales-orders/${order.id}/packing`,
        {
          method: 'PATCH',
          token,
          body: {
            packingStatus: 'packed',
          },
        },
      );
      assertErrorContract(forbidden, 403, 'PERMISSION_DENIED');
    }

    const forbiddenFields = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}/packing`,
      {
        method: 'PATCH',
        token: warehouse.token,
        body: {
          totalAmountCents: 1,
          customerId: order.customerId,
          status: 'cancelled',
          financeMark: true,
          logisticsNo: 'NOPE',
        },
      },
    );
    assertErrorContract(forbiddenFields, 403, 'FIELD_PERMISSION_DENIED');

    const invalidPackingStatus = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}/packing`,
      {
        method: 'PATCH',
        token: warehouse.token,
        body: {
          packingStatus: 'done',
        },
      },
    );
    assertErrorContract(invalidPackingStatus, 400, 'INVALID_PACKING_STATUS');

    const negativePackageCount = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}/packing`,
      {
        method: 'PATCH',
        token: warehouse.token,
        body: {
          packageCount: -1,
        },
      },
    );
    assertErrorContract(negativePackageCount, 400, 'VALIDATION_FAILED');

    const invalidPackingMark = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}/packing`,
      {
        method: 'PATCH',
        token: warehouse.token,
        body: {
          hasPackingMark: 1,
        },
      },
    );
    assertErrorContract(invalidPackingMark, 400, 'VALIDATION_FAILED');

    const persistedOrder = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}`,
      {
        token: admin.token,
      },
    );
    assert.equal(persistedOrder.response.status, 200);
    assert.equal(
      persistedOrder.body.data.salesOrder.hasPackingMark,
      financePatchedOrder.hasPackingMark,
    );
    assert.equal(persistedOrder.body.data.salesOrder.hasPackingMark, false);
    assert.equal(persistedOrder.body.data.salesOrder.financeMark, false);

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=sales_orders.packing.update&result=SUCCESS',
      {
        token: admin.token,
      },
    );
    assert.equal(logs.response.status, 200);
    assert.equal(logs.body.data.logs.length, 3);
    assert.ok(
      logs.body.data.logs.some(
        (log) =>
          log.beforeData.packingStatus === 'pending' &&
          log.afterData.packingStatus === 'packing' &&
          log.afterData.packageCount === 3 &&
          log.beforeData.hasPackingMark === false &&
          log.afterData.hasPackingMark === true,
      ),
    );
    assert.ok(
      logs.body.data.logs.some(
        (log) =>
          log.beforeData.packingStatus === 'packing' &&
          log.afterData.packingStatus === 'packed' &&
          log.afterData.packageCount === 0 &&
          log.beforeData.hasPackingMark === true &&
          log.afterData.hasPackingMark === false,
      ),
    );
    assert.ok(
      logs.body.data.logs.some(
        (log) =>
          log.beforeData.packingStatus === 'packed' &&
          log.afterData.packingStatus === 'abnormal' &&
          log.afterData.packageCount === 4,
      ),
    );
    for (const log of logs.body.data.logs) {
      assertSalesOrderDtoPhase4(log.beforeData);
      assertSalesOrderDtoPhase4(log.afterData);
      assert.equal(log.beforeData.financeMark, false);
      assert.equal(log.afterData.financeMark, false);
    }
  });
});

test('contract: sales order status patch updates effective order summaries and pending rules', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const afterSalesUser = await createUser(baseUrl, admin.token, {
      name: 'Order Status Patch After Sales',
      username: 'order-status-patch-after-sales',
      password: 'Password123',
      role: 'after_sales',
    });
    const financeUser = await createUser(baseUrl, admin.token, {
      name: 'Order Status Patch Finance',
      username: 'order-status-patch-finance',
      password: 'Password123',
      role: 'finance',
    });
    const salesUser = await createUser(baseUrl, admin.token, {
      name: 'Order Status Patch Sales',
      username: 'order-status-patch-sales',
      password: 'Password123',
      role: 'sales',
    });
    const warehouseUser = await createUser(baseUrl, admin.token, {
      name: 'Order Status Patch Warehouse',
      username: 'order-status-patch-warehouse',
      password: 'Password123',
      role: 'warehouse',
    });
    const bossUser = await createUser(baseUrl, admin.token, {
      name: 'Order Status Patch Boss',
      username: 'order-status-patch-boss',
      password: 'Password123',
      role: 'boss',
    });
    const tasterUser = await createUser(baseUrl, admin.token, {
      name: 'Order Status Patch Taster',
      username: 'order-status-patch-taster',
      password: 'Password123',
      role: 'taster',
    });
    const frontDeskUser = await createUser(baseUrl, admin.token, {
      name: 'Order Status Patch Front Desk',
      username: 'order-status-patch-front-desk',
      password: 'Password123',
      role: 'front_desk',
    });
    const afterSales = await login(
      baseUrl,
      afterSalesUser.username,
      'Password123',
    );
    const finance = await login(
      baseUrl,
      financeUser.username,
      'Password123',
    );
    const sales = await login(baseUrl, salesUser.username, 'Password123');
    const warehouse = await login(
      baseUrl,
      warehouseUser.username,
      'Password123',
    );
    const boss = await login(baseUrl, bossUser.username, 'Password123');
    const taster = await login(baseUrl, tasterUser.username, 'Password123');
    const frontDesk = await login(
      baseUrl,
      frontDeskUser.username,
      'Password123',
    );

    const group = await createScopedTravelGroup(baseUrl, admin.token, {
      visitDate: '2026-06-29',
      travelAgency: 'Order Status Patch Agency',
    });
    await setTravelGroupFinanceMark(baseUrl, admin.token, group.id, true);
    const customer = await createCustomerFixture(baseUrl, admin.token, {
      name: 'Order Status Patch Customer',
      phone: '13900003200',
    });
    const created = await requestJson(baseUrl, '/api/sales-orders', {
      method: 'POST',
      token: admin.token,
      body: {
        orderType: 'travel_group',
        travelGroupId: group.id,
        customerId: customer.id,
        orderDate: '2026-06-29',
        items: [
          {
            productName: 'Order Status Patch Product',
            quantity: 1,
            unitPriceCents: 21000,
            deliveryType: 'shipping',
          },
        ],
      },
    });
    assert.equal(created.response.status, 201);
    const order = created.body.data.salesOrder;
    assert.equal(order.status, 'valid');
    const pendingAfterCreate = await fetchPendingByGroupNo(
      baseUrl,
      admin.token,
      group.groupNo,
    );
    assert.equal(pendingAfterCreate.length, 1);
    assert.equal(pendingAfterCreate[0].pendingStatus, 'pending_sales');

    const partialRefund = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}/status`,
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          status: 'partial_refund',
          statusReason: 'partial refund reason test',
        },
      },
    );
    assert.equal(partialRefund.response.status, 200);
    assertSalesOrderDtoPhase4(partialRefund.body.data.salesOrder);
    assert.equal(partialRefund.body.data.salesOrder.status, 'partial_refund');
    assert.equal(
      partialRefund.body.data.salesOrder.remark,
      'partial refund reason test',
    );
    const partialGroup = await requestJson(
      baseUrl,
      `/api/travel-groups/${group.id}`,
      {
        token: admin.token,
      },
    );
    assert.equal(partialGroup.response.status, 200);
    assert.equal(partialGroup.body.data.travelGroup.status, 'ordered');
    assert.equal(partialGroup.body.data.travelGroup.salesAmountCents, 21000);
    assert.equal(partialGroup.body.data.travelGroup.orderSummary.orderCount, 1);
    assert.equal(
      (
        await fetchPendingByGroupNo(
          baseUrl,
          admin.token,
          group.groupNo,
        )
      )[0].pendingStatus,
      'pending_sales',
    );

    const refunded = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}/status`,
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          status: 'refunded',
          remark: 'refunded reason test',
        },
      },
    );
    assert.equal(refunded.response.status, 200);
    assert.equal(refunded.body.data.salesOrder.status, 'refunded');
    assert.equal(refunded.body.data.salesOrder.remark, 'refunded reason test');
    const refundedGroup = await requestJson(
      baseUrl,
      `/api/travel-groups/${group.id}`,
      {
        token: admin.token,
      },
    );
    assert.equal(refundedGroup.response.status, 200);
    assert.equal(refundedGroup.body.data.travelGroup.status, 'unmarked');
    assert.equal(refundedGroup.body.data.travelGroup.salesAmountCents, 0);
    assert.equal(refundedGroup.body.data.travelGroup.orderAmountCents, 0);
    assert.equal(refundedGroup.body.data.travelGroup.orderSummary.orderCount, 0);
    const pendingAfterRefund = await fetchPendingByGroupNo(
      baseUrl,
      admin.token,
      group.groupNo,
    );
    assert.equal(pendingAfterRefund.length, 1);
    assert.equal(pendingAfterRefund[0].pendingStatus, 'pending_sales');
    assert.ok(
      pendingAfterRefund[0].pendingReasons.includes('missing_departure_time'),
    );
    assert.ok(
      pendingAfterRefund[0].pendingReasons.includes('loss_not_confirmed'),
    );

    const cancelled = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}/status`,
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          status: 'cancelled',
          statusReason: 'cancelled reason test',
        },
      },
    );
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.body.data.salesOrder.status, 'cancelled');
    assert.equal(
      cancelled.body.data.salesOrder.remark,
      'cancelled reason test',
    );
    const pendingAfterCancel = await fetchPendingByGroupNo(
      baseUrl,
      admin.token,
      group.groupNo,
    );
    assert.equal(pendingAfterCancel.length, 1);
    assert.equal(pendingAfterCancel[0].pendingStatus, 'pending_sales');

    const financeRestore = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}/status`,
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          status: 'valid',
          remark: 'finance restored valid test',
        },
      },
    );
    assert.equal(financeRestore.response.status, 200);
    assert.equal(financeRestore.body.data.salesOrder.status, 'valid');
    assert.equal(
      (
        await fetchPendingByGroupNo(
          baseUrl,
          admin.token,
          group.groupNo,
        )
      )[0].pendingStatus,
      'pending_sales',
    );

    const adminPatch = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}/status`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          status: 'partial_refund',
          statusReason: 'admin partial reason test',
        },
      },
    );
    assert.equal(adminPatch.response.status, 200);
    assert.equal(adminPatch.body.data.salesOrder.status, 'partial_refund');
    assert.equal(
      adminPatch.body.data.salesOrder.remark,
      'admin partial reason test',
    );

    for (const token of [
      sales.token,
      warehouse.token,
      boss.token,
      taster.token,
      frontDesk.token,
      afterSales.token,
    ]) {
      const forbidden = await requestJson(
        baseUrl,
        `/api/sales-orders/${order.id}/status`,
        {
          method: 'PATCH',
          token,
          body: {
            status: 'cancelled',
          },
        },
      );
      assertErrorContract(forbidden, 403, 'PERMISSION_DENIED');
    }

    const forbiddenFields = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}/status`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          status: 'cancelled',
          totalAmountCents: 1,
        },
      },
    );
    assertErrorContract(forbiddenFields, 403, 'FIELD_PERMISSION_DENIED');

    const invalidStatus = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}/status`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          status: 'void',
        },
      },
    );
    assertErrorContract(invalidStatus, 400, 'INVALID_ORDER_STATUS');

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=sales_orders.status.update&result=SUCCESS',
      {
        token: admin.token,
      },
    );
    assert.equal(logs.response.status, 200);
    assert.equal(logs.body.data.logs.length, 5);
    assert.ok(
      logs.body.data.logs.some(
        (log) =>
          log.beforeData.status === 'valid' &&
          log.afterData.status === 'partial_refund' &&
          log.afterData.remark === 'partial refund reason test',
      ),
    );
    assert.ok(
      logs.body.data.logs.some(
        (log) =>
          log.beforeData.status === 'partial_refund' &&
          log.afterData.status === 'refunded',
      ),
    );
    assert.ok(
      logs.body.data.logs.some(
        (log) =>
          log.beforeData.status === 'refunded' &&
          log.afterData.status === 'cancelled',
      ),
    );
    for (const log of logs.body.data.logs) {
      assertSalesOrderDtoPhase4(log.afterData);
    }
  });
});

test('contract: sales order creation validates customer, travel group, items, and create roles', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const bossUser = await createUser(baseUrl, admin.token, {
      name: 'Order Create Boss',
      username: 'order-create-boss',
      password: 'Password123',
      role: 'boss',
    });
    const financeUser = await createUser(baseUrl, admin.token, {
      name: 'Order Create Finance',
      username: 'order-create-finance',
      password: 'Password123',
      role: 'finance',
    });
    const afterSalesUser = await createUser(baseUrl, admin.token, {
      name: 'Order Create After Sales',
      username: 'order-create-after-sales',
      password: 'Password123',
      role: 'after_sales',
    });
    const boss = await login(baseUrl, bossUser.username, 'Password123');
    const finance = await login(baseUrl, financeUser.username, 'Password123');
    const afterSales = await login(
      baseUrl,
      afterSalesUser.username,
      'Password123',
    );

    const validFinanceOrder = await createGeneratedSalesOrder(
      baseUrl,
      finance.token,
      {
        orderDate: '2026-06-29',
      },
    );
    assert.equal(validFinanceOrder.orderNo, 'SO20260629001');
    const afterSalesCreate = await requestJson(baseUrl, '/api/sales-orders', {
      method: 'POST',
      token: afterSales.token,
      body: buildValidSalesOrderCreateBody({
        orderDate: '2026-06-30',
      }),
    });
    assertErrorContract(afterSalesCreate, 403, 'PERMISSION_DENIED');

    const bossCreate = await requestJson(baseUrl, '/api/sales-orders', {
      method: 'POST',
      token: boss.token,
      body: buildValidSalesOrderCreateBody(),
    });
    assertErrorContract(bossCreate, 403, 'PERMISSION_DENIED');

    const missingCustomer = await requestJson(baseUrl, '/api/sales-orders', {
      method: 'POST',
      token: admin.token,
      body: {
        orderType: 'external',
        orderDate: '2026-06-29',
        items: buildValidOrderItems(),
      },
    });
    assertErrorContract(missingCustomer, 400, 'CUSTOMER_REQUIRED');

    const missingTravelGroup = await requestJson(baseUrl, '/api/sales-orders', {
      method: 'POST',
      token: admin.token,
      body: buildValidSalesOrderCreateBody({
        orderType: 'travel_group',
        travelGroupId: undefined,
      }),
    });
    assertErrorContract(missingTravelGroup, 400, 'VALIDATION_FAILED');

    const unknownTravelGroup = await requestJson(baseUrl, '/api/sales-orders', {
      method: 'POST',
      token: admin.token,
      body: buildValidSalesOrderCreateBody({
        orderType: 'travel_group',
        travelGroupId: 'missing-travel-group-id',
      }),
    });
    assertErrorContract(unknownTravelGroup, 404, 'TRAVEL_GROUP_NOT_FOUND');

    const missingCustomerId = await requestJson(baseUrl, '/api/sales-orders', {
      method: 'POST',
      token: admin.token,
      body: buildValidSalesOrderCreateBody({
        customerId: 'missing-customer-id',
        customer: undefined,
      }),
    });
    assertErrorContract(missingCustomerId, 404, 'CUSTOMER_NOT_FOUND');

    const emptyItems = await requestJson(baseUrl, '/api/sales-orders', {
      method: 'POST',
      token: admin.token,
      body: buildValidSalesOrderCreateBody({
        items: [],
      }),
    });
    assertErrorContract(emptyItems, 400, 'VALIDATION_FAILED');

    const zeroQuantity = await requestJson(baseUrl, '/api/sales-orders', {
      method: 'POST',
      token: admin.token,
      body: buildValidSalesOrderCreateBody({
        items: [
          {
            productName: 'Invalid Quantity Product',
            quantity: 0,
            unitPriceCents: 1000,
            deliveryType: 'shipping',
          },
        ],
      }),
    });
    assertErrorContract(zeroQuantity, 400, 'VALIDATION_FAILED');

    const negativePrice = await requestJson(baseUrl, '/api/sales-orders', {
      method: 'POST',
      token: admin.token,
      body: buildValidSalesOrderCreateBody({
        items: [
          {
            productName: 'Invalid Price Product',
            quantity: 1,
            unitPriceCents: -1,
            deliveryType: 'shipping',
          },
        ],
      }),
    });
    assertErrorContract(negativePrice, 400, 'VALIDATION_FAILED');

    const invalidDelivery = await requestJson(baseUrl, '/api/sales-orders', {
      method: 'POST',
      token: admin.token,
      body: buildValidSalesOrderCreateBody({
        items: [
          {
            productName: 'Invalid Delivery Product',
            quantity: 1,
            unitPriceCents: 1000,
            deliveryType: 'drone',
          },
        ],
      }),
    });
    assertErrorContract(invalidDelivery, 400, 'INVALID_DELIVERY_TYPE');
  });
});

test('contract: travel group creation uses generated numbers, snapshots, tasting items, and role validation', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const frontDeskUser = await createUser(baseUrl, admin.token, {
      name: 'Travel Create Front Desk',
      username: 'travel-create-front-desk',
      password: 'Password123',
      role: 'front_desk',
    });
    const salesUser = await createUser(baseUrl, admin.token, {
      name: 'Travel Create Sales',
      username: 'travel-create-sales',
      password: 'Password123',
      role: 'sales',
    });
    const taster = await createUser(baseUrl, admin.token, {
      name: 'Travel Create Taster',
      username: 'travel-create-taster',
      password: 'Password123',
      role: 'taster',
    });
    const liaisonTaster = await createUser(baseUrl, admin.token, {
      name: 'Travel Create Liaison Taster',
      username: 'travel-create-liaison-taster',
      password: 'Password123',
      role: 'taster',
    });
    const guide = await createGuideFixture(baseUrl, admin.token, {
      name: 'Snapshot Guide',
      phone: '13910000002',
      travelAgency: 'Snapshot Agency',
    });
    const frontDesk = await login(
      baseUrl,
      frontDeskUser.username,
      'Password123',
    );
    const sales = await login(baseUrl, salesUser.username, 'Password123');

    const validBody = (overrides = {}) => ({
      groupNo: 'CLIENT-SHOULD-BE-IGNORED',
      visitDate: '2026-06-25',
      travelAgency: 'Client Input Agency',
      licensePlate: 'GZA88888',
      guideId: guide.id,
      guestCount: 16,
      cigaretteFeeCents: 2050,
      tastingRoomNo: 'Room 8',
      tasterId: taster.id,
      liaisonTasterId: liaisonTaster.id,
      groupType: '其他',
      arrivalTime: '09:00',
      sourceRegion: '华东地区',
      ageInfo: '35-55岁',
      mentionedFeitian: false,
      previousStopOrderStatus: '自定义前站文本',
      keyCustomerInfo: '重点客户王女士',
      expectedArrivalTime: '08:05',
      tastingItems: [
        {
          productName: 'Tasting Product A',
          quantity: 2,
          unit: 'bottle',
          note: 'first round',
          sortOrder: 2,
        },
        {
          productName: 'Tasting Product B',
          quantity: 1,
          unit: 'bottle',
          sortOrder: 1,
        },
      ],
      ...overrides,
    });

    const created = await requestJson(baseUrl, '/api/travel-groups', {
      method: 'POST',
      token: admin.token,
      body: validBody(),
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.data.travelGroup.groupNo, 'TG20260625001');
    assert.notEqual(
      created.body.data.travelGroup.groupNo,
      'CLIENT-SHOULD-BE-IGNORED',
    );
    assert.equal(created.body.data.travelGroup.guideId, guide.id);
    assert.equal(created.body.data.travelGroup.guideName, guide.name);
    assert.equal(created.body.data.travelGroup.guidePhone, guide.phone);
    assert.equal(created.body.data.travelGroup.parkingFeeCents, 500);
    assert.equal(created.body.data.travelGroup.cigaretteFeeCents, 2050);
    assert.equal(
      created.body.data.travelGroup.travelAgency,
      'Client Input Agency',
    );
    assert.equal(created.body.data.travelGroup.tasterId, taster.id);
    assert.equal(created.body.data.travelGroup.tasterName, taster.name);
    assert.equal(
      created.body.data.travelGroup.liaisonTasterId,
      liaisonTaster.id,
    );
    assert.equal(
      created.body.data.travelGroup.liaisonTasterName,
      liaisonTaster.name,
    );
    assert.equal(created.body.data.travelGroup.sourceRegion, '华东地区');
    assert.equal(created.body.data.travelGroup.ageInfo, '35-55岁');
    assert.equal(created.body.data.travelGroup.mentionedFeitian, false);
    assert.equal(
      created.body.data.travelGroup.previousStopOrderStatus,
      '自定义前站文本',
    );
    assert.equal(
      created.body.data.travelGroup.keyCustomerInfo,
      '重点客户王女士',
    );
    assert.equal(created.body.data.travelGroup.keyCustomerPhotos, null);
    assert.equal(created.body.data.travelGroup.guestInfoAttachments, null);
    assert.equal(created.body.data.travelGroup.expectedArrivalTime, '08:05');
    assertTravelGroupDtoCore(created.body.data.travelGroup);
    assert.equal(created.body.data.travelGroup.pendingStatus, 'pending_sales');
    assert.ok(
      created.body.data.travelGroup.pendingReasons.includes(
        'missing_departure_time',
      ),
    );
    assert.equal(created.body.data.travelGroup.tasterSummary, null);
    assert.equal(created.body.data.travelGroup.tasterSummaryAt, null);
    assert.deepEqual(
      created.body.data.travelGroup.tastingItems.map(
        (item) => item.productName,
      ),
      ['Tasting Product B', 'Tasting Product A'],
    );

    const second = await requestJson(baseUrl, '/api/travel-groups', {
      method: 'POST',
      token: frontDesk.token,
      body: validBody({
        expectedArrivalTime: undefined,
        tastingItems: undefined,
      }),
    });
    assert.equal(second.response.status, 201);
    assert.equal(second.body.data.travelGroup.groupNo, 'TG20260625002');

    const frontDeskExpectedArrivalTimeDenied = await requestJson(
      baseUrl,
      '/api/travel-groups',
      {
        method: 'POST',
        token: frontDesk.token,
        body: validBody({ expectedArrivalTime: '08:30' }),
      },
    );
    assertErrorContract(
      frontDeskExpectedArrivalTimeDenied,
      403,
      'FIELD_PERMISSION_DENIED',
    );

    const minimal = await requestJson(baseUrl, '/api/travel-groups', {
      method: 'POST',
      token: admin.token,
      body: {
        visitDate: '2026-06-26',
        travelAgency: 'Minimal Agency',
        guideId: guide.id,
        cigaretteFeeCents: 100,
      },
    });
    assert.equal(minimal.response.status, 201);
    assert.equal(minimal.body.data.travelGroup.groupNo, 'TG20260626001');
    assert.equal(minimal.body.data.travelGroup.guestCount, 0);
    assert.equal(minimal.body.data.travelGroup.parkingFeeCents, 500);
    assert.equal(minimal.body.data.travelGroup.cigaretteFeeCents, 100);
    for (const field of [
      'licensePlate',
      'tastingRoomNo',
      'tasterId',
      'liaisonTasterId',
      'arrivalTime',
      'groupType',
      'sourceRegion',
      'ageInfo',
      'mentionedFeitian',
      'previousStopOrderStatus',
      'keyCustomerInfo',
      'keyCustomerPhotos',
      'guestInfoAttachments',
      'expectedArrivalTime',
    ]) {
      assert.equal(minimal.body.data.travelGroup[field], null);
    }

    const missingRequired = await requestJson(baseUrl, '/api/travel-groups', {
      method: 'POST',
      token: admin.token,
      body: validBody({ travelAgency: '' }),
    });
    assertErrorContract(missingRequired, 400, 'VALIDATION_FAILED');

    const missingCigaretteFee = await requestJson(
      baseUrl,
      '/api/travel-groups',
      {
        method: 'POST',
        token: admin.token,
        body: validBody({ cigaretteFeeCents: undefined }),
      },
    );
    assert.equal(missingCigaretteFee.response.status, 201);
    assert.equal(
      missingCigaretteFee.body.data.travelGroup.cigaretteFeeCents,
      null,
    );

    for (const cigaretteFeeCents of [0, -1, 20.5]) {
      const invalidCigaretteFee = await requestJson(
        baseUrl,
        '/api/travel-groups',
        {
          method: 'POST',
          token: admin.token,
          body: validBody({ cigaretteFeeCents }),
        },
      );
      assertErrorContract(invalidCigaretteFee, 400, 'VALIDATION_FAILED');
    }

    const forgedParkingFee = await requestJson(
      baseUrl,
      '/api/travel-groups',
      {
        method: 'POST',
        token: admin.token,
        body: validBody({ parkingFeeCents: 1 }),
      },
    );
    assertErrorContract(forgedParkingFee, 403, 'FIELD_PERMISSION_DENIED');

    const missingVisitDate = await requestJson(baseUrl, '/api/travel-groups', {
      method: 'POST',
      token: admin.token,
      body: validBody({ visitDate: '' }),
    });
    assertErrorContract(missingVisitDate, 400, 'VALIDATION_FAILED');

    const missingGuide = await requestJson(baseUrl, '/api/travel-groups', {
      method: 'POST',
      token: admin.token,
      body: validBody({ guideId: 'missing-guide-id' }),
    });
    assertErrorContract(missingGuide, 404, 'GUIDE_NOT_FOUND');

    const invalidTaster = await requestJson(baseUrl, '/api/travel-groups', {
      method: 'POST',
      token: admin.token,
      body: validBody({ tasterId: salesUser.id }),
    });
    assertErrorContract(invalidTaster, 400, 'INVALID_TASTER');

    const invalidLiaisonTaster = await requestJson(
      baseUrl,
      '/api/travel-groups',
      {
        method: 'POST',
        token: admin.token,
        body: validBody({ liaisonTasterId: salesUser.id }),
      },
    );
    assertErrorContract(
      invalidLiaisonTaster,
      400,
      'INVALID_LIAISON_TASTER',
    );

    const invalidExpectedArrivalTime = await requestJson(
      baseUrl,
      '/api/travel-groups',
      {
        method: 'POST',
        token: admin.token,
        body: validBody({ expectedArrivalTime: '8:05' }),
      },
    );
    assertErrorContract(
      invalidExpectedArrivalTime,
      400,
      'VALIDATION_FAILED',
    );

    const directAttachmentMetadata = await requestJson(
      baseUrl,
      '/api/travel-groups',
      {
        method: 'POST',
        token: admin.token,
        body: validBody({ keyCustomerPhotos: [{ id: 'forged' }] }),
      },
    );
    assertErrorContract(
      directAttachmentMetadata,
      403,
      'FIELD_PERMISSION_DENIED',
    );

    const salesCreate = await requestJson(baseUrl, '/api/travel-groups', {
      method: 'POST',
      token: sales.token,
      body: validBody(),
    });
    assertErrorContract(salesCreate, 403, 'PERMISSION_DENIED');

    const detail = await requestJson(
      baseUrl,
      `/api/travel-groups/${created.body.data.travelGroup.id}`,
      {
        token: admin.token,
      },
    );
    assert.equal(detail.response.status, 200);
    assertTravelGroupDtoCore(detail.body.data.travelGroup);
    assert.equal(
      detail.body.data.travelGroup.liaisonTaster.username,
      liaisonTaster.username,
    );
    assert.deepEqual(
      detail.body.data.travelGroup.tastingItems.map((item) => [
        item.productName,
        item.quantity,
        item.sortOrder,
      ]),
      [
        ['Tasting Product B', 1, 1],
        ['Tasting Product A', 2, 2],
      ],
    );

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=travel_groups.create&result=SUCCESS',
      {
        token: admin.token,
      },
    );
    assert.equal(logs.response.status, 200);
    assert.equal(logs.body.data.logs.length, 4);
    const createdLog = logs.body.data.logs.find(
      (log) => log.entityId === created.body.data.travelGroup.id,
    );
    assert.ok(createdLog);
    assert.deepEqual(
      createdLog.afterData.tastingItems.map((item) => item.productName),
      ['Tasting Product B', 'Tasting Product A'],
    );
  });
});

test('contract: travel group guest breakdown is validated, derived, patch-safe, and legacy compatible', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const guide = await createGuideFixture(baseUrl, admin.token, {
      name: 'Guest Breakdown Guide',
      phone: '13910000088',
      travelAgency: 'Guest Breakdown Agency',
    });
    const createBody = (overrides = {}) => ({
      visitDate: '2026-08-01',
      travelAgency: 'Guest Breakdown Agency',
      guideId: guide.id,
      cigaretteFeeCents: 100,
      ...overrides,
    });
    const create = (body) =>
      requestJson(baseUrl, '/api/travel-groups', {
        method: 'POST',
        token: admin.token,
        body,
      });

    const split = await create(
      createBody({
        adultCount: 10,
        childCount: 3,
        guestCount: 999,
      }),
    );
    assert.equal(split.response.status, 201);
    assert.equal(split.body.data.travelGroup.adultCount, 10);
    assert.equal(split.body.data.travelGroup.childCount, 3);
    assert.equal(split.body.data.travelGroup.guestCount, 13);

    const adultsOnly = await create(createBody({ adultCount: 7 }));
    assert.equal(adultsOnly.response.status, 201);
    assert.equal(adultsOnly.body.data.travelGroup.adultCount, 7);
    assert.equal(adultsOnly.body.data.travelGroup.childCount, 0);
    assert.equal(adultsOnly.body.data.travelGroup.guestCount, 7);

    const childrenOnly = await create(createBody({ childCount: 4 }));
    assert.equal(childrenOnly.response.status, 201);
    assert.equal(childrenOnly.body.data.travelGroup.adultCount, 0);
    assert.equal(childrenOnly.body.data.travelGroup.childCount, 4);
    assert.equal(childrenOnly.body.data.travelGroup.guestCount, 4);

    const blankCounts = await create(
      createBody({
        adultCount: null,
        childCount: '',
      }),
    );
    assert.equal(blankCounts.response.status, 201);
    assert.equal(blankCounts.body.data.travelGroup.adultCount, 0);
    assert.equal(blankCounts.body.data.travelGroup.childCount, 0);
    assert.equal(blankCounts.body.data.travelGroup.guestCount, 0);

    const legacy = await create(createBody({ guestCount: 6 }));
    assert.equal(legacy.response.status, 201);
    assert.equal(legacy.body.data.travelGroup.adultCount, 6);
    assert.equal(legacy.body.data.travelGroup.childCount, 0);
    assert.equal(legacy.body.data.travelGroup.guestCount, 6);

    for (const invalidCounts of [
      { adultCount: -1, childCount: 0 },
      { adultCount: 1.5, childCount: 0 },
      { adultCount: 'invalid', childCount: 0 },
      { adultCount: 0, childCount: -1 },
      { adultCount: 0, childCount: 1.5 },
      { adultCount: 0, childCount: 'invalid' },
    ]) {
      const invalid = await create(createBody(invalidCounts));
      assertErrorContract(invalid, 400, 'VALIDATION_FAILED');
    }

    const adultPatch = await requestJson(
      baseUrl,
      `/api/travel-groups/${split.body.data.travelGroup.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          adultCount: 12,
        },
      },
    );
    assert.equal(adultPatch.response.status, 200);
    assert.equal(adultPatch.body.data.travelGroup.adultCount, 12);
    assert.equal(adultPatch.body.data.travelGroup.childCount, 3);
    assert.equal(adultPatch.body.data.travelGroup.guestCount, 15);

    const childPatch = await requestJson(
      baseUrl,
      `/api/travel-groups/${split.body.data.travelGroup.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          childCount: 5,
        },
      },
    );
    assert.equal(childPatch.response.status, 200);
    assert.equal(childPatch.body.data.travelGroup.adultCount, 12);
    assert.equal(childPatch.body.data.travelGroup.childCount, 5);
    assert.equal(childPatch.body.data.travelGroup.guestCount, 17);

    const legacyPatch = await requestJson(
      baseUrl,
      `/api/travel-groups/${split.body.data.travelGroup.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          guestCount: 9,
        },
      },
    );
    assert.equal(legacyPatch.response.status, 200);
    assert.equal(legacyPatch.body.data.travelGroup.adultCount, 9);
    assert.equal(legacyPatch.body.data.travelGroup.childCount, 0);
    assert.equal(legacyPatch.body.data.travelGroup.guestCount, 9);
  });
});

test('contract: travel group patch enforces role fields, snapshots, tasting item replacement, and post-mark logs', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const bossUser = await createUser(baseUrl, admin.token, {
      name: 'Patch Boss',
      username: 'patch-boss',
      password: 'Password123',
      role: 'boss',
    });
    const frontDeskUser = await createUser(baseUrl, admin.token, {
      name: 'Patch Front Desk',
      username: 'patch-front-desk',
      password: 'Password123',
      role: 'front_desk',
    });
    const salesUser = await createUser(baseUrl, admin.token, {
      name: 'Patch Sales',
      username: 'patch-sales',
      password: 'Password123',
      role: 'sales',
    });
    const financeUser = await createUser(baseUrl, admin.token, {
      name: 'Patch Finance',
      username: 'patch-finance',
      password: 'Password123',
      role: 'finance',
    });
    const tasterOneUser = await createUser(baseUrl, admin.token, {
      name: 'Patch Taster One',
      username: 'patch-taster-one',
      password: 'Password123',
      role: 'taster',
    });
    const tasterTwoUser = await createUser(baseUrl, admin.token, {
      name: 'Patch Taster Two',
      username: 'patch-taster-two',
      password: 'Password123',
      role: 'taster',
    });
    const warehouseUser = await createUser(baseUrl, admin.token, {
      name: 'Patch Warehouse',
      username: 'patch-warehouse',
      password: 'Password123',
      role: 'warehouse',
    });
    const afterSalesUser = await createUser(baseUrl, admin.token, {
      name: 'Patch After Sales',
      username: 'patch-after-sales',
      password: 'Password123',
      role: 'after_sales',
    });

    const boss = await login(baseUrl, bossUser.username, 'Password123');
    const frontDesk = await login(
      baseUrl,
      frontDeskUser.username,
      'Password123',
    );
    const sales = await login(baseUrl, salesUser.username, 'Password123');
    const finance = await login(baseUrl, financeUser.username, 'Password123');
    const tasterOne = await login(
      baseUrl,
      tasterOneUser.username,
      'Password123',
    );
    const tasterTwo = await login(
      baseUrl,
      tasterTwoUser.username,
      'Password123',
    );
    assert.equal(tasterTwo.user.id, tasterTwoUser.id);
    const warehouse = await login(
      baseUrl,
      warehouseUser.username,
      'Password123',
    );
    const afterSales = await login(
      baseUrl,
      afterSalesUser.username,
      'Password123',
    );

    const group = await createScopedTravelGroup(baseUrl, admin.token, {
      tasterId: tasterOneUser.id,
      visitDate: SHANGHAI_TODAY,
      tastingItems: [
        {
          productName: 'Patch Initial A',
          quantity: 1,
          unit: 'bottle',
          sortOrder: 1,
        },
        {
          productName: 'Patch Initial B',
          quantity: 1,
          unit: 'bottle',
          sortOrder: 2,
        },
      ],
    });

    const relatedOrder = await requestJson(baseUrl, '/api/sales-orders', {
      method: 'POST',
      token: admin.token,
      body: {
        orderNo: 'SO-PATCH-SALES',
        orderType: 'travel_group',
        travelGroupId: group.id,
        customer: {
          name: 'Patch Customer',
        },
        orderDate: '2026-06-25',
        totalAmountCents: 8800,
        items: [
          {
            productName: 'Patch Product',
            quantity: 1,
            unitPriceCents: 8800,
            deliveryType: 'self_pickup',
          },
        ],
      },
    });
    assert.equal(relatedOrder.response.status, 201);

    const adminGuide = await createGuideFixture(baseUrl, admin.token, {
      name: 'Patch Admin Guide',
      phone: '13920000001',
      travelAgency: 'Patch Admin Agency',
    });
    const adminPatch = await requestJson(
      baseUrl,
      `/api/travel-groups/${group.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          guideId: adminGuide.id,
          tasterId: tasterTwoUser.id,
          liaisonTasterId: tasterOneUser.id,
          guestCount: 21,
          sourceRegion: '更新客源地',
          ageInfo: '40岁左右',
          mentionedFeitian: true,
          previousStopOrderStatus: '任意自定义文本',
          keyCustomerInfo: '更新后的重点客户',
          expectedArrivalTime: '10:15',
          cigaretteFeeCents: 2500,
          salesAmountCents: 12000,
          tasterSummary: 'admin summary',
          tastingItems: [
            {
              productName: 'Patch Admin Item',
              quantity: 3,
              unit: 'bottle',
              sortOrder: 1,
            },
          ],
        },
      },
    );
    assert.equal(adminPatch.response.status, 200);
    assert.equal(adminPatch.body.data.travelGroup.guideId, adminGuide.id);
    assert.equal(adminPatch.body.data.travelGroup.guideName, adminGuide.name);
    assert.equal(
      adminPatch.body.data.travelGroup.travelAgency,
      group.travelAgency,
    );
    assert.equal(adminPatch.body.data.travelGroup.tasterId, tasterTwoUser.id);
    assert.equal(
      adminPatch.body.data.travelGroup.tasterName,
      tasterTwoUser.name,
    );
    assert.equal(
      adminPatch.body.data.travelGroup.liaisonTasterId,
      tasterOneUser.id,
    );
    assert.equal(
      adminPatch.body.data.travelGroup.liaisonTasterName,
      tasterOneUser.name,
    );
    assert.equal(adminPatch.body.data.travelGroup.sourceRegion, '更新客源地');
    assert.equal(adminPatch.body.data.travelGroup.ageInfo, '40岁左右');
    assert.equal(adminPatch.body.data.travelGroup.mentionedFeitian, true);
    assert.equal(
      adminPatch.body.data.travelGroup.previousStopOrderStatus,
      '任意自定义文本',
    );
    assert.equal(
      adminPatch.body.data.travelGroup.keyCustomerInfo,
      '更新后的重点客户',
    );
    assert.equal(adminPatch.body.data.travelGroup.keyCustomerPhotos, null);
    assert.equal(adminPatch.body.data.travelGroup.guestInfoAttachments, null);
    assert.equal(
      adminPatch.body.data.travelGroup.expectedArrivalTime,
      '10:15',
    );
    assert.equal(adminPatch.body.data.travelGroup.cigaretteFeeCents, 2500);
    assert.deepEqual(
      adminPatch.body.data.travelGroup.tastingItems.map(
        (item) => item.productName,
      ),
      ['Patch Admin Item'],
    );

    const frontDeskGuide = await createGuideFixture(baseUrl, frontDesk.token, {
      name: 'Patch Front Desk Guide',
      phone: '13920000002',
      travelAgency: 'Patch Front Desk Agency',
    });
    const frontDeskTastingItemsDenied = await requestJson(
      baseUrl,
      `/api/travel-groups/${group.id}`,
      {
        method: 'PATCH',
        token: frontDesk.token,
        body: {
          tastingItems: [
            {
              productName: 'Patch Front Desk Item',
              quantity: 2,
              unit: 'bottle',
              sortOrder: 1,
            },
          ],
        },
      },
    );
    assertErrorContract(
      frontDeskTastingItemsDenied,
      403,
      'FIELD_PERMISSION_DENIED',
    );

    const frontDeskPatch = await requestJson(
      baseUrl,
      `/api/travel-groups/${group.id}`,
      {
        method: 'PATCH',
        token: frontDesk.token,
        body: {
          visitDate: SHANGHAI_TODAY,
          guideId: frontDeskGuide.id,
          travelAgency: 'Client Agency Should Win',
          liaisonTasterId: null,
          mentionedFeitian: false,
          previousStopOrderStatus: '熊猫',
          adultCount: 20,
          childCount: 2,
          arrivalTime: '09:45',
          cigaretteFeeCents: 3000,
        },
      },
    );
    assert.equal(frontDeskPatch.response.status, 200);
    assert.equal(
      frontDeskPatch.body.data.travelGroup.guideName,
      frontDeskGuide.name,
    );
    assert.equal(
      frontDeskPatch.body.data.travelGroup.travelAgency,
      'Client Agency Should Win',
    );
    assert.equal(
      frontDeskPatch.body.data.travelGroup.visitDate,
      SHANGHAI_TODAY,
    );
    assert.equal(frontDeskPatch.body.data.travelGroup.groupNo, group.groupNo);
    assert.equal(frontDeskPatch.body.data.travelGroup.liaisonTasterId, null);
    assert.equal(frontDeskPatch.body.data.travelGroup.liaisonTasterName, null);
    assert.equal(frontDeskPatch.body.data.travelGroup.mentionedFeitian, false);
    assert.equal(
      frontDeskPatch.body.data.travelGroup.previousStopOrderStatus,
      '熊猫',
    );
    assert.equal(frontDeskPatch.body.data.travelGroup.keyCustomerPhotos, null);
    assert.equal(frontDeskPatch.body.data.travelGroup.guestInfoAttachments, null);
    assert.equal(frontDeskPatch.body.data.travelGroup.expectedArrivalTime, '10:15');
    assert.equal(frontDeskPatch.body.data.travelGroup.arrivalTime, '09:45');
    assert.equal(frontDeskPatch.body.data.travelGroup.cigaretteFeeCents, 3000);
    assert.equal(frontDeskPatch.body.data.travelGroup.adultCount, 20);
    assert.equal(frontDeskPatch.body.data.travelGroup.childCount, 2);
    assert.equal(frontDeskPatch.body.data.travelGroup.guestCount, 22);
    assert.equal(
      frontDeskPatch.body.data.travelGroup.tasterId,
      tasterTwoUser.id,
    );
    assert.deepEqual(
      frontDeskPatch.body.data.travelGroup.tastingItems.map(
        (item) => item.productName,
      ),
      ['Patch Admin Item'],
    );

    const frontDeskExpectedArrivalTimeDenied = await requestJson(
      baseUrl,
      `/api/travel-groups/${group.id}`,
      {
        method: 'PATCH',
        token: frontDesk.token,
        body: {
          expectedArrivalTime: '10:30',
        },
      },
    );
    assertErrorContract(
      frontDeskExpectedArrivalTimeDenied,
      403,
      'FIELD_PERMISSION_DENIED',
    );

    const frontDeskDenied = await requestJson(
      baseUrl,
      `/api/travel-groups/${group.id}`,
      {
        method: 'PATCH',
        token: frontDesk.token,
        body: {
          departureTime: '12:00',
        },
      },
    );
    assertErrorContract(frontDeskDenied, 403, 'FIELD_PERMISSION_DENIED');

    const forgedParkingPatch = await requestJson(
      baseUrl,
      `/api/travel-groups/${group.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          parkingFeeCents: 1,
        },
      },
    );
    assertErrorContract(forgedParkingPatch, 403, 'FIELD_PERMISSION_DENIED');

    const clearedCigaretteFee = await requestJson(
      baseUrl,
      `/api/travel-groups/${group.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          cigaretteFeeCents: null,
        },
      },
    );
    assert.equal(clearedCigaretteFee.response.status, 200);
    assert.equal(
      clearedCigaretteFee.body.data.travelGroup.cigaretteFeeCents,
      null,
    );

    for (const cigaretteFeeCents of [-1, 20.5]) {
      const invalidCigarettePatch = await requestJson(
        baseUrl,
        `/api/travel-groups/${group.id}`,
        {
          method: 'PATCH',
          token: admin.token,
          body: {
            cigaretteFeeCents,
          },
        },
      );
      assertErrorContract(invalidCigarettePatch, 400, 'VALIDATION_FAILED');
    }

    const salesPatch = await requestJson(
      baseUrl,
      `/api/travel-groups/${group.id}`,
      {
        method: 'PATCH',
        token: sales.token,
        body: {
          guestCount: 22,
          departureTime: '12:20',
          remarks: 'sales note',
          tastingItems: [
            {
              productName: 'Patch Sales Item',
              quantity: 1,
              unit: 'bottle',
              sortOrder: 1,
            },
            {
              productName: 'Patch Sales Item B',
              quantity: 1,
              unit: 'glass',
              sortOrder: 2,
            },
          ],
        },
      },
    );
    assertErrorContract(salesPatch, 403, 'FIELD_PERMISSION_DENIED');

    const salesDenied = await requestJson(
      baseUrl,
      `/api/travel-groups/${group.id}`,
      {
        method: 'PATCH',
        token: sales.token,
        body: {
          visitDate: '2026-06-26',
        },
      },
    );
    assertErrorContract(salesDenied, 403, 'FIELD_PERMISSION_DENIED');

    const tasterPatch = await requestJson(
      baseUrl,
      `/api/travel-groups/${group.id}`,
      {
        method: 'PATCH',
        token: tasterTwo.token,
        body: {
          childCount: 3,
          tasterSummary: 'Guests preferred sauce aroma.',
          wineDetails: 'Tasted product notes.',
        },
      },
    );
    assert.equal(tasterPatch.response.status, 200);
    assert.equal(tasterPatch.body.data.travelGroup.adultCount, 20);
    assert.equal(tasterPatch.body.data.travelGroup.childCount, 3);
    assert.equal(tasterPatch.body.data.travelGroup.guestCount, 23);
    assert.equal(
      tasterPatch.body.data.travelGroup.tasterSummary,
      'Guests preferred sauce aroma.',
    );
    assert.equal(
      typeof tasterPatch.body.data.travelGroup.tasterSummaryAt,
      'string',
    );
    assert.equal(
      tasterPatch.body.data.travelGroup.wineDetails,
      'Tasted product notes.',
    );

    const tasterDenied = await requestJson(
      baseUrl,
      `/api/travel-groups/${group.id}`,
      {
        method: 'PATCH',
        token: tasterTwo.token,
        body: {
          cigaretteFeeCents: 4000,
        },
      },
    );
    assertErrorContract(tasterDenied, 403, 'FIELD_PERMISSION_DENIED');

    const tasterWrongGroup = await requestJson(
      baseUrl,
      `/api/travel-groups/${group.id}`,
      {
        method: 'PATCH',
        token: tasterOne.token,
        body: {
          guestCount: 24,
        },
      },
    );
    assertErrorContract(tasterWrongGroup, 404, 'TRAVEL_GROUP_NOT_FOUND');

    const financePatch = await requestJson(
      baseUrl,
      `/api/travel-groups/${group.id}`,
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          liquorCostDeductionCents: 500,
          points: 10,
          returnedPoints: 3,
          unreturnedPoints: 7,
          travelAgencyInfoSent: true,
          remarks: 'finance note',
        },
      },
    );
    assert.equal(financePatch.response.status, 200);
    assert.equal(
      financePatch.body.data.travelGroup.liquorCostDeductionCents,
      500,
    );
    assert.equal(financePatch.body.data.travelGroup.returnedPoints, 3);
    assert.equal(financePatch.body.data.travelGroup.travelAgencyInfoSent, true);
    assert.equal(financePatch.body.data.travelGroup.remarks, 'finance note');

    const financeDenied = await requestJson(
      baseUrl,
      `/api/travel-groups/${group.id}`,
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          cigaretteFeeCents: 4000,
        },
      },
    );
    assertErrorContract(financeDenied, 403, 'FIELD_PERMISSION_DENIED');

    for (const actor of [boss, warehouse, afterSales]) {
      const denied = await requestJson(
        baseUrl,
        `/api/travel-groups/${group.id}`,
        {
          method: 'PATCH',
          token: actor.token,
          body: {
            guestCount: 99,
          },
        },
      );
      assertErrorContract(denied, 403, 'PERMISSION_DENIED');
    }

    await setTravelGroupFinanceMark(baseUrl, admin.token, group.id, true);
    const postMarkPatch = await requestJson(
      baseUrl,
      `/api/travel-groups/${group.id}`,
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          points: 66,
          remarks: 'post mark finance edit',
        },
      },
    );
    assert.equal(postMarkPatch.response.status, 200);
    assert.equal(postMarkPatch.body.data.travelGroup.financeMark, true);
    assert.equal(postMarkPatch.body.data.travelGroup.points, 66);

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=travel_groups.update',
      {
        token: admin.token,
      },
    );
    assert.equal(logs.response.status, 200);
    const postMarkLog = logs.body.data.logs.find(
      (log) =>
        log.entityId === group.id &&
        log.afterData?.remarks === 'post mark finance edit',
    );
    assert.ok(postMarkLog);
    assert.equal(postMarkLog.beforeData.financeMark, true);
    assert.equal(postMarkLog.afterData.financeMark, true);
    assert.equal(postMarkLog.beforeData.points, 10);
    assert.equal(postMarkLog.afterData.points, 66);
    const cigaretteLog = logs.body.data.logs.find(
      (log) =>
        log.entityId === group.id &&
        log.beforeData?.cigaretteFeeCents === 2500 &&
        log.afterData?.cigaretteFeeCents === 3000,
    );
    assert.ok(cigaretteLog);
  });
});

test('contract: associated tasters can edit before sales supplement completion while all tasters can read future groups', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const primaryUser = await createUser(baseUrl, admin.token, {
      name: '同名品鉴师',
      username: 'relation-primary-taster',
      password: 'Password123',
      role: 'taster',
    });
    const liaisonUser = await createUser(baseUrl, admin.token, {
      name: '对接品鉴师',
      username: 'relation-liaison-taster',
      password: 'Password123',
      role: 'taster',
    });
    const unrelatedUser = await createUser(baseUrl, admin.token, {
      name: '同名品鉴师',
      username: 'relation-unrelated-taster',
      password: 'Password123',
      role: 'taster',
    });
    const primary = await login(
      baseUrl,
      primaryUser.username,
      'Password123',
    );
    const liaison = await login(
      baseUrl,
      liaisonUser.username,
      'Password123',
    );
    const unrelated = await login(
      baseUrl,
      unrelatedUser.username,
      'Password123',
    );

    const associatedGroup = await createScopedTravelGroup(
      baseUrl,
      admin.token,
      {
        visitDate: SHANGHAI_TODAY,
        travelAgency: 'Relationship Agency',
        tasterId: primaryUser.id,
        liaisonTasterId: liaisonUser.id,
      },
    );
    const otherGroup = await createScopedTravelGroup(baseUrl, admin.token, {
      visitDate: SHANGHAI_TOMORROW,
      tasterId: unrelatedUser.id,
    });
    const unassignedGuide = await createGuideFixture(baseUrl, admin.token, {
      name: 'Unassigned Group Guide',
      phone: '13930000001',
      travelAgency: 'Unassigned Guide Agency',
    });
    const unassignedResult = await requestJson(
      baseUrl,
      '/api/travel-groups',
      {
        method: 'POST',
        token: admin.token,
        body: {
          visitDate: SHANGHAI_DAY_AFTER_TOMORROW,
          travelAgency: 'Unassigned Agency',
          guideId: unassignedGuide.id,
          cigaretteFeeCents: 100,
        },
      },
    );
    assert.equal(unassignedResult.response.status, 201);
    const unassignedGroup = unassignedResult.body.data.travelGroup;

    for (const [session, expectedGroups] of [
      [primary, [associatedGroup, otherGroup, unassignedGroup]],
      [liaison, [associatedGroup, otherGroup, unassignedGroup]],
      [unrelated, [otherGroup, unassignedGroup]],
    ]) {
      const list = await requestJson(baseUrl, '/api/travel-groups', {
        token: session.token,
      });
      assert.equal(list.response.status, 200);
      assert.deepEqual(
        groupNos(list.body.data.travelGroups),
        groupNos(expectedGroups),
      );
    }

    const unrelatedDetail = await requestJson(
      baseUrl,
      `/api/travel-groups/${associatedGroup.id}`,
      {
        token: unrelated.token,
      },
    );
    assertErrorContract(
      unrelatedDetail,
      404,
      'TRAVEL_GROUP_NOT_FOUND',
    );

    const primaryPatch = await requestJson(
      baseUrl,
      `/api/travel-groups/${associatedGroup.id}`,
      {
        method: 'PATCH',
        token: primary.token,
        body: {
          licensePlate: '贵A56789',
          guestCount: 0,
          remarks: '接团品鉴师备注',
          wineDetails: '接团品鉴师酒品记录',
          tasterSummary: '接团品鉴师总结',
          sourceRegion: '华北',
          ageInfo: '40-60岁',
          mentionedFeitian: true,
          previousStopOrderStatus: '均单',
          keyCustomerInfo: '重点客户信息',
        },
      },
    );
    assert.equal(primaryPatch.response.status, 200);
    assert.equal(primaryPatch.body.data.travelGroup.licensePlate, '贵A56789');
    assert.equal(primaryPatch.body.data.travelGroup.guestCount, 0);
    assert.equal(
      primaryPatch.body.data.travelGroup.tasterSummary,
      '接团品鉴师总结',
    );
    assert.equal(primaryPatch.body.data.travelGroup.sourceRegion, '华北');
    assert.equal(primaryPatch.body.data.travelGroup.mentionedFeitian, true);
    assert.equal(primaryPatch.body.data.travelGroup.keyCustomerPhotos, null);
    assert.equal(primaryPatch.body.data.travelGroup.tasterEditCount, 0);
    assert.equal(primaryPatch.body.data.travelGroup.tasterEditLimit, null);
    assert.equal(primaryPatch.body.data.travelGroup.tasterEditRemaining, null);
    assert.equal(primaryPatch.body.data.travelGroup.tasterEditUnlimited, true);

    const replacementGuide = await createGuideFixture(baseUrl, admin.token, {
      name: 'Liaison Replacement Guide',
      phone: '13930000002',
      travelAgency: 'Must Not Replace Group Agency',
    });
    const liaisonPatch = await requestJson(
      baseUrl,
      `/api/travel-groups/${associatedGroup.id}`,
      {
        method: 'PATCH',
        token: liaison.token,
        body: {
          expectedArrivalTime: '10:20',
          remarks: '对接品鉴师备注',
        },
      },
    );
    assert.equal(liaisonPatch.response.status, 200);
    assert.equal(
      liaisonPatch.body.data.travelGroup.visitDate,
      SHANGHAI_TODAY,
    );
    assert.equal(liaisonPatch.body.data.travelGroup.groupNo, associatedGroup.groupNo);
    assert.equal(
      liaisonPatch.body.data.travelGroup.guideId,
      associatedGroup.guideId,
    );
    assert.equal(
      liaisonPatch.body.data.travelGroup.guideName,
      associatedGroup.guideName,
    );
    assert.equal(
      liaisonPatch.body.data.travelGroup.guidePhone,
      associatedGroup.guidePhone,
    );
    assert.equal(
      liaisonPatch.body.data.travelGroup.travelAgency,
      associatedGroup.travelAgency,
    );
    assert.equal(
      liaisonPatch.body.data.travelGroup.expectedArrivalTime,
      '10:20',
    );

    const thirdAssociatedPatch = await requestJson(
      baseUrl,
      `/api/travel-groups/${associatedGroup.id}`,
      {
        method: 'PATCH',
        token: primary.token,
        body: {
          remarks: '第三次关联品鉴师修改仍然成功',
        },
      },
    );
    assert.equal(thirdAssociatedPatch.response.status, 200);
    assert.equal(
      thirdAssociatedPatch.body.data.travelGroup.remarks,
      '第三次关联品鉴师修改仍然成功',
    );
    assert.equal(
      thirdAssociatedPatch.body.data.travelGroup.canEditByCurrentUser,
      true,
    );

    for (const body of [
      { visitDate: '2026-07-05' },
      { guideId: replacementGuide.id },
    ]) {
      const primaryExtraDenied = await requestJson(
        baseUrl,
        `/api/travel-groups/${associatedGroup.id}`,
        {
          method: 'PATCH',
          token: primary.token,
          body,
        },
      );
      assertErrorContract(
        primaryExtraDenied,
        403,
        'FIELD_PERMISSION_DENIED',
      );
    }

    for (const session of [primary, liaison]) {
      for (const body of [
        { tastingRoomNo: 'FORBIDDEN' },
        { arrivalTime: '11:30' },
        { groupType: 'FORBIDDEN' },
      ]) {
        const forbiddenOperationalField = await requestJson(
          baseUrl,
          `/api/travel-groups/${associatedGroup.id}`,
          {
            method: 'PATCH',
            token: session.token,
            body,
          },
        );
        assertErrorContract(
          forbiddenOperationalField,
          403,
          'FIELD_PERMISSION_DENIED',
        );
      }
    }

    for (const body of [
      { groupNo: 'FORGED-GROUP-NO' },
      { travelAgency: 'FORGED-AGENCY' },
      { tasterId: unrelatedUser.id },
      { liaisonTasterId: unrelatedUser.id },
      { tasterName: unrelatedUser.name },
      { liaisonTasterName: unrelatedUser.name },
      { financeMark: true },
      { salesAmountCents: 100 },
      { points: 1 },
    ]) {
      const forbiddenField = await requestJson(
        baseUrl,
        `/api/travel-groups/${associatedGroup.id}`,
        {
          method: 'PATCH',
          token: primary.token,
          body,
        },
      );
      assertErrorContract(forbiddenField, 403, 'FIELD_PERMISSION_DENIED');
    }

    const unrelatedDenied = await requestJson(
      baseUrl,
      `/api/travel-groups/${associatedGroup.id}`,
      {
        method: 'PATCH',
        token: unrelated.token,
        body: {
          remarks: '同名但无关联，不能修改',
        },
      },
    );
    assertErrorContract(
      unrelatedDenied,
      404,
      'TRAVEL_GROUP_NOT_FOUND',
    );

    const forgedAssociationDenied = await requestJson(
      baseUrl,
      `/api/travel-groups/${associatedGroup.id}`,
      {
        method: 'PATCH',
        token: unrelated.token,
        body: {
          tasterId: unrelatedUser.id,
          liaisonTasterId: unrelatedUser.id,
          tasterName: unrelatedUser.name,
          liaisonTasterName: unrelatedUser.name,
          remarks: '伪造关联不能修改',
        },
      },
    );
    assertErrorContract(
      forgedAssociationDenied,
      404,
      'TRAVEL_GROUP_NOT_FOUND',
    );
  });
});

test('contract: travel group finance mark endpoint is admin/finance only and preserves group data', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const financeUser = await createUser(baseUrl, admin.token, {
      name: 'Finance Mark Finance',
      username: 'finance-mark-finance',
      password: 'Password123',
      role: 'finance',
    });
    const bossUser = await createUser(baseUrl, admin.token, {
      name: 'Finance Mark Boss',
      username: 'finance-mark-boss',
      password: 'Password123',
      role: 'boss',
    });
    const frontDeskUser = await createUser(baseUrl, admin.token, {
      name: 'Finance Mark Front Desk',
      username: 'finance-mark-front-desk',
      password: 'Password123',
      role: 'front_desk',
    });
    const salesUser = await createUser(baseUrl, admin.token, {
      name: 'Finance Mark Sales',
      username: 'finance-mark-sales',
      password: 'Password123',
      role: 'sales',
    });
    const tasterUser = await createUser(baseUrl, admin.token, {
      name: 'Finance Mark Taster',
      username: 'finance-mark-taster',
      password: 'Password123',
      role: 'taster',
    });
    const warehouseUser = await createUser(baseUrl, admin.token, {
      name: 'Finance Mark Warehouse',
      username: 'finance-mark-warehouse',
      password: 'Password123',
      role: 'warehouse',
    });
    const afterSalesUser = await createUser(baseUrl, admin.token, {
      name: 'Finance Mark After Sales',
      username: 'finance-mark-after-sales',
      password: 'Password123',
      role: 'after_sales',
    });

    const finance = await login(baseUrl, financeUser.username, 'Password123');
    const boss = await login(baseUrl, bossUser.username, 'Password123');
    const frontDesk = await login(
      baseUrl,
      frontDeskUser.username,
      'Password123',
    );
    const sales = await login(baseUrl, salesUser.username, 'Password123');
    const taster = await login(baseUrl, tasterUser.username, 'Password123');
    const warehouse = await login(
      baseUrl,
      warehouseUser.username,
      'Password123',
    );
    const afterSales = await login(
      baseUrl,
      afterSalesUser.username,
      'Password123',
    );

    const group = await createScopedTravelGroup(baseUrl, admin.token, {
      tasterId: tasterUser.id,
      guestCount: 18,
      tastingItems: [
        {
          productName: 'Finance Mark Item',
          quantity: 1,
          unit: 'bottle',
          sortOrder: 1,
        },
      ],
    });

    const beforeDetail = await requestJson(
      baseUrl,
      `/api/travel-groups/${group.id}`,
      {
        token: admin.token,
      },
    );
    assert.equal(beforeDetail.response.status, 200);
    const before = beforeDetail.body.data.travelGroup;
    assert.equal(before.financeMark, false);

    const deniedActors = [
      boss,
      frontDesk,
      sales,
      taster,
      warehouse,
      afterSales,
    ];
    for (const actor of deniedActors) {
      const denied = await requestJson(
        baseUrl,
        `/api/travel-groups/${group.id}/finance-mark`,
        {
          method: 'PATCH',
          token: actor.token,
          body: {
            financeMark: true,
          },
        },
      );
      assertErrorContract(denied, 403, 'PERMISSION_DENIED');
    }

    const adminMark = await requestJson(
      baseUrl,
      `/api/travel-groups/${group.id}/finance-mark`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          financeMark: true,
          guestCount: 99,
          remarks: 'should not be updated by finance mark',
        },
      },
    );
    assert.equal(adminMark.response.status, 200);
    assert.equal(adminMark.body.data.travelGroup.financeMark, true);
    assert.equal(adminMark.body.data.travelGroup.markedById, admin.user.id);
    assert.equal(typeof adminMark.body.data.travelGroup.markedAt, 'string');
    assert.equal(adminMark.body.data.travelGroup.guestCount, before.guestCount);
    assert.equal(adminMark.body.data.travelGroup.remarks, before.remarks);
    assert.deepEqual(
      adminMark.body.data.travelGroup.tastingItems.map(
        (item) => item.productName,
      ),
      ['Finance Mark Item'],
    );

    const markedDetail = await requestJson(
      baseUrl,
      `/api/travel-groups/${group.id}`,
      {
        token: admin.token,
      },
    );
    assert.equal(markedDetail.response.status, 200);
    assert.equal(markedDetail.body.data.travelGroup.financeMark, true);
    assert.equal(markedDetail.body.data.travelGroup.markedById, admin.user.id);

    const markedList = await requestJson(
      baseUrl,
      '/api/travel-groups?financeMark=true',
      {
        token: admin.token,
      },
    );
    assert.equal(markedList.response.status, 200);
    assert.deepEqual(groupNos(markedList.body.data.travelGroups), [
      group.groupNo,
    ]);

    const financeUnmark = await requestJson(
      baseUrl,
      `/api/travel-groups/${group.id}/finance-mark`,
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          financeMark: false,
        },
      },
    );
    assert.equal(financeUnmark.response.status, 200);
    assert.equal(financeUnmark.body.data.travelGroup.financeMark, false);
    assert.equal(financeUnmark.body.data.travelGroup.markedById, finance.user.id);
    assert.equal(typeof financeUnmark.body.data.travelGroup.markedAt, 'string');
    assert.equal(
      financeUnmark.body.data.travelGroup.markedAt >=
        adminMark.body.data.travelGroup.markedAt,
      true,
    );
    assert.equal(
      financeUnmark.body.data.travelGroup.guestCount,
      before.guestCount,
    );
    assert.equal(
      financeUnmark.body.data.travelGroup.guideName,
      before.guideName,
    );

    const unmarkedList = await requestJson(
      baseUrl,
      '/api/travel-groups?financeMark=false',
      {
        token: admin.token,
      },
    );
    assert.equal(unmarkedList.response.status, 200);
    assert.deepEqual(groupNos(unmarkedList.body.data.travelGroups), [
      group.groupNo,
    ]);

    const enableLogs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=travel_groups.finance_mark.enable',
      {
        token: admin.token,
      },
    );
    assert.equal(enableLogs.response.status, 200);
    const enableLog = enableLogs.body.data.logs.find(
      (log) => log.entityId === group.id,
    );
    assert.ok(enableLog);
    assert.equal(enableLog.beforeData.financeMark, false);
    assert.equal(enableLog.afterData.financeMark, true);
    assert.equal(enableLog.afterData.markedById, admin.user.id);
    assert.equal(enableLog.afterData.guestCount, before.guestCount);
    assert.deepEqual(
      enableLog.afterData.tastingItems.map((item) => item.productName),
      ['Finance Mark Item'],
    );

    const disableLogs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=travel_groups.finance_mark.disable',
      {
        token: admin.token,
      },
    );
    assert.equal(disableLogs.response.status, 200);
    const disableLog = disableLogs.body.data.logs.find(
      (log) => log.entityId === group.id,
    );
    assert.ok(disableLog);
    assert.equal(disableLog.beforeData.financeMark, true);
    assert.equal(disableLog.afterData.financeMark, false);
    assert.equal(disableLog.afterData.markedById, finance.user.id);
    assert.equal(typeof disableLog.afterData.markedAt, 'string');
  });
});

test('contract: travel group taster summary endpoint scopes taster writes and preserves finance mark', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const tasterOneUser = await createUser(baseUrl, admin.token, {
      name: 'Summary Taster One',
      username: 'summary-taster-one',
      password: 'Password123',
      role: 'taster',
    });
    const tasterTwoUser = await createUser(baseUrl, admin.token, {
      name: 'Summary Taster Two',
      username: 'summary-taster-two',
      password: 'Password123',
      role: 'taster',
    });

    const tasterOne = await login(
      baseUrl,
      tasterOneUser.username,
      'Password123',
    );
    const groupOne = await createScopedTravelGroup(baseUrl, admin.token, {
      tasterId: tasterOneUser.id,
      visitDate: SHANGHAI_TODAY,
    });
    const groupTwo = await createScopedTravelGroup(baseUrl, admin.token, {
      tasterId: tasterTwoUser.id,
      visitDate: SHANGHAI_TODAY,
    });

    await setTravelGroupFinanceMark(baseUrl, admin.token, groupOne.id, true);

    const tasterSubmit = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupOne.id}/taster-summary`,
      {
        method: 'POST',
        token: tasterOne.token,
        body: {
          tasterSummary: 'Taster own summary.',
        },
      },
    );
    assert.equal(tasterSubmit.response.status, 201);
    assert.equal(
      tasterSubmit.body.data.travelGroup.tasterSummary,
      'Taster own summary.',
    );
    assert.equal(
      typeof tasterSubmit.body.data.travelGroup.tasterSummaryAt,
      'string',
    );
    assert.equal(tasterSubmit.body.data.travelGroup.financeMark, true);
    assert.equal(tasterSubmit.body.data.travelGroup.markedById, admin.user.id);

    const tasterDenied = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupTwo.id}/taster-summary`,
      {
        method: 'POST',
        token: tasterOne.token,
        body: {
          tasterSummary: 'Wrong group summary.',
        },
      },
    );
    assertErrorContract(tasterDenied, 404, 'TRAVEL_GROUP_NOT_FOUND');

    const adminSubmit = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupOne.id}/taster-summary`,
      {
        method: 'POST',
        token: admin.token,
        body: {
          tasterSummary: 'Admin revised summary.',
        },
      },
    );
    assert.equal(adminSubmit.response.status, 201);
    assert.equal(
      adminSubmit.body.data.travelGroup.tasterSummary,
      'Admin revised summary.',
    );
    assert.equal(adminSubmit.body.data.travelGroup.financeMark, true);
    assert.equal(adminSubmit.body.data.travelGroup.markedById, admin.user.id);

    const detail = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupOne.id}`,
      {
        token: admin.token,
      },
    );
    assert.equal(detail.response.status, 200);
    assert.equal(
      detail.body.data.travelGroup.tasterSummary,
      'Admin revised summary.',
    );
    assert.equal(typeof detail.body.data.travelGroup.tasterSummaryAt, 'string');
    assert.equal(detail.body.data.travelGroup.financeMark, true);

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=travel_groups.taster_summary.upsert&result=SUCCESS',
      {
        token: admin.token,
      },
    );
    assert.equal(logs.response.status, 200);
    const groupLogs = logs.body.data.logs
      .filter((log) => log.entityId === groupOne.id)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    assert.equal(groupLogs.length, 2);
    assert.equal(groupLogs[0].beforeData.tasterSummary, null);
    assert.equal(groupLogs[0].afterData.tasterSummary, 'Taster own summary.');
    assert.equal(groupLogs[0].beforeData.financeMark, true);
    assert.equal(groupLogs[0].afterData.financeMark, true);
    assert.equal(groupLogs[1].beforeData.tasterSummary, 'Taster own summary.');
    assert.equal(
      groupLogs[1].afterData.tasterSummary,
      'Admin revised summary.',
    );
    assert.equal(groupLogs[1].afterData.financeMark, true);
  });
});

test('contract: pending travel groups are computed from travel group rules and preserve role scope', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);

      const missingTaster = await fetchPendingByGroupNo(
        baseUrl,
        admin.token,
        'PEND-MISSING-TASTER',
      );
      assert.deepEqual(missingTaster, []);

      const missingCigaretteFee = await fetchPendingByGroupNo(
        baseUrl,
        admin.token,
        'PEND-MISSING-CIGARETTE',
      );
      assert.deepEqual(missingCigaretteFee, []);

      const frontDeskAbnormal = await fetchPendingByGroupNo(
        baseUrl,
        admin.token,
        'PEND-FRONT-ABNORMAL',
      );
      assert.equal(frontDeskAbnormal.length, 1);
      assert.equal(frontDeskAbnormal[0].pendingStatus, 'pending_front_desk');
      for (const reason of [
        'missing_license_plate',
        'missing_guest_count',
        'missing_cigarette_fee',
        'missing_tasting_room_no',
        'missing_taster',
        'missing_arrival_time',
        'missing_group_type',
      ]) {
        assert.ok(
          frontDeskAbnormal[0].pendingReasons.includes(reason),
          `expected ${reason}`,
        );
      }
      const zeroGuestCount = await fetchPendingByGroupNo(
        baseUrl,
        admin.token,
        'PEND-ZERO-GUEST-OK',
      );
      assert.equal(zeroGuestCount.length, 1);
      assert.equal(zeroGuestCount[0].pendingStatus, 'pending_front_desk');
      assert.ok(
        zeroGuestCount[0].pendingReasons.includes('missing_guest_count'),
      );

      const noOrderNoSummary = await fetchPendingByGroupNo(
        baseUrl,
        admin.token,
        'PEND-NO-ORDER-SUMMARY',
      );
      assert.equal(noOrderNoSummary.length, 1);
      assert.equal(noOrderNoSummary[0].pendingStatus, 'pending_taster');
      assert.deepEqual(noOrderNoSummary[0].pendingReasons, [
        'no_order_and_missing_taster_summary',
      ]);

      const financePending = await fetchPendingByGroupNo(
        baseUrl,
        admin.token,
        'PEND-FINANCE-OLD',
      );
      assert.equal(financePending.length, 1);
      assert.equal(financePending[0].pendingStatus, 'pending_finance');
      assert.deepEqual(financePending[0].pendingReasons, [
        'finance_unmarked_after_day_end',
      ]);

      const duplicateGroups = await fetchPendingByGroupNo(
        baseUrl,
        admin.token,
        'PEND-DUPLICATE',
      );
      assert.equal(duplicateGroups.length, 2);
      for (const group of duplicateGroups) {
        assert.equal(group.pendingStatus, 'abnormal');
        assert.deepEqual(group.pendingReasons, ['duplicate_group_no']);
      }

      const badTimes = await fetchPendingByGroupNo(
        baseUrl,
        admin.token,
        'PEND-BAD-TIMES',
      );
      assert.equal(badTimes.length, 1);
      assert.equal(badTimes[0].pendingStatus, 'abnormal');
      assert.deepEqual(badTimes[0].pendingReasons, [
        'departure_before_arrival',
      ]);

      const missingDepartureOnly = await fetchPendingByGroupNo(
        baseUrl,
        admin.token,
        'PEND-MISSING-DEPARTURE-OK',
      );
      assert.deepEqual(missingDepartureOnly, []);

      const withOrderNoDeparture = await fetchPendingByGroupNo(
        baseUrl,
        admin.token,
        'PEND-ORDER-NO-DEPARTURE-OK',
      );
      assert.deepEqual(withOrderNoDeparture, []);

      const tasterUser = await createUser(baseUrl, admin.token, {
        name: 'Pending Scope Taster',
        username: 'pending-scope-taster',
        password: 'Password123',
        role: 'taster',
      });
      const otherTasterUser = await createUser(baseUrl, admin.token, {
        name: 'Pending Scope Other Taster',
        username: 'pending-scope-other-taster',
        password: 'Password123',
        role: 'taster',
      });
      const frontDeskUser = await createUser(baseUrl, admin.token, {
        name: 'Pending Scope Front Desk',
        username: 'pending-scope-front-desk',
        password: 'Password123',
        role: 'front_desk',
      });
      const salesUser = await createUser(baseUrl, admin.token, {
        name: 'Pending Scope Sales',
        username: 'pending-scope-sales',
        password: 'Password123',
        role: 'sales',
      });

      const frontDesk = await login(
        baseUrl,
        frontDeskUser.username,
        'Password123',
      );
      const taster = await login(baseUrl, tasterUser.username, 'Password123');
      const sales = await login(baseUrl, salesUser.username, 'Password123');

      const frontDeskGroup = await createScopedTravelGroup(
        baseUrl,
        frontDesk.token,
        {
          visitDate: '2099-01-03',
          tasterId: tasterUser.id,
        },
      );
      const adminTasterGroup = await createScopedTravelGroup(
        baseUrl,
        admin.token,
        {
          visitDate: '2099-01-04',
          tasterId: tasterUser.id,
        },
      );
      const otherTasterGroup = await createScopedTravelGroup(
        baseUrl,
        admin.token,
        {
          visitDate: '2099-01-05',
          tasterId: otherTasterUser.id,
        },
      );
      const salesRelatedGroup = await createScopedTravelGroup(
        baseUrl,
        admin.token,
        {
          visitDate: SHANGHAI_TODAY,
          tasterId: otherTasterUser.id,
        },
      );
      await createScopedSalesOrder(baseUrl, sales.token, {
        orderNo: 'SO-PENDING-SALES-SCOPE',
        travelGroupId: salesRelatedGroup.id,
      });

      const frontDeskPending = await requestJson(
        baseUrl,
        '/api/pending-travel-groups',
        {
          token: frontDesk.token,
        },
      );
      assert.equal(frontDeskPending.response.status, 200);

      const adminPending = await requestJson(
        baseUrl,
        '/api/pending-travel-groups',
        {
          token: admin.token,
        },
      );
      assert.equal(adminPending.response.status, 200);
      assert.deepEqual(
        groupNos(frontDeskPending.body.data.pendingTravelGroups),
        groupNos(adminPending.body.data.pendingTravelGroups),
      );

      const tasterPending = await requestJson(
        baseUrl,
        '/api/pending-travel-groups',
        {
          token: taster.token,
        },
      );
      assert.equal(tasterPending.response.status, 200);
      assert.deepEqual(
        groupNos(tasterPending.body.data.pendingTravelGroups),
        groupNos(
          adminPending.body.data.pendingTravelGroups.filter(
            (group) =>
              group.tasterId === taster.user.id ||
              (group.liaisonTasterId === taster.user.id &&
                group.visitDate >= SHANGHAI_TODAY) ||
              group.visitDate > SHANGHAI_TODAY ||
              (group.visitDate === SHANGHAI_TODAY &&
                (group.arrivalTime === null || group.arrivalTime === '')),
          ),
        ),
      );
      assert.equal(
        tasterPending.body.data.pendingTravelGroups.some(
          (group) => group.groupNo === 'PEND-FINANCE-OLD',
        ),
        false,
      );
      assert.equal(
        tasterPending.body.data.pendingTravelGroups.some(
          (group) => group.groupNo === otherTasterGroup.groupNo,
        ),
        true,
      );

      const salesPending = await requestJson(
        baseUrl,
        '/api/pending-travel-groups',
        {
          token: sales.token,
        },
      );
      assert.equal(salesPending.response.status, 200);
      assert.ok(
        groupNos(salesPending.body.data.pendingTravelGroups).includes(
          salesRelatedGroup.groupNo,
        ),
      );
    },
    {
      prisma: {
        travelGroups: [
          {
            id: 'seed-missing-taster',
            groupNo: 'PEND-MISSING-TASTER',
            visitDate: '2099-01-01',
            tasterId: null,
            tasterName: null,
            tasterSummary: 'summary exists',
            tasterSummaryAt: '2099-01-01T08:00:00.000Z',
            financeMark: true,
            cigaretteFeeCents: 100,
          },
          {
            id: 'seed-missing-cigarette',
            groupNo: 'PEND-MISSING-CIGARETTE',
            visitDate: '2099-01-01',
            tasterId: 'seed-taster',
            tasterSummary: 'summary exists',
            tasterSummaryAt: '2099-01-01T08:00:00.000Z',
            financeMark: true,
            cigaretteFeeCents: null,
          },
          {
            id: 'seed-front-abnormal',
            groupNo: 'PEND-FRONT-ABNORMAL',
            visitDate: SHANGHAI_TODAY,
            licensePlate: '',
            guestCount: 0,
            tastingRoomNo: '',
            tasterId: null,
            arrivalTime: null,
            groupType: null,
            tasterSummary: 'summary exists',
            tasterSummaryAt: `${SHANGHAI_TODAY}T08:00:00.000Z`,
            financeMark: true,
            cigaretteFeeCents: null,
          },
          {
            id: 'seed-no-order-summary',
            groupNo: 'PEND-NO-ORDER-SUMMARY',
            visitDate: '2099-01-01',
            tasterId: 'seed-taster',
            financeMark: true,
            cigaretteFeeCents: 100,
          },
          {
            id: 'seed-zero-guest-ok',
            groupNo: 'PEND-ZERO-GUEST-OK',
            visitDate: SHANGHAI_TODAY,
            guestCount: 0,
            tasterId: 'seed-taster',
            liaisonTasterId: null,
            arrivalTime: '09:00',
            groupType: '其他',
            lossStatus: 'NO_LOSS',
            departureTime: '16:00',
            tasterSummary: 'summary exists',
            tasterSummaryAt: `${SHANGHAI_TODAY}T08:00:00.000Z`,
            financeMark: true,
            cigaretteFeeCents: 100,
          },
          {
            id: 'seed-finance-old',
            groupNo: 'PEND-FINANCE-OLD',
            visitDate: '2000-01-01',
            tasterId: 'seed-taster',
            arrivalTime: '09:00',
            groupType: '其他',
            lossStatus: 'NO_LOSS',
            departureTime: '16:00',
            tasterSummary: 'summary exists',
            tasterSummaryAt: '2000-01-01T08:00:00.000Z',
            financeMark: false,
            cigaretteFeeCents: 100,
          },
          {
            id: 'seed-duplicate-a',
            groupNo: 'PEND-DUPLICATE',
            visitDate: '2099-01-01',
            tasterId: 'seed-taster',
            tasterSummary: 'summary exists',
            tasterSummaryAt: '2099-01-01T08:00:00.000Z',
            financeMark: true,
            cigaretteFeeCents: 100,
          },
          {
            id: 'seed-duplicate-b',
            groupNo: 'PEND-DUPLICATE',
            visitDate: '2099-01-01',
            tasterId: 'seed-taster',
            tasterSummary: 'summary exists',
            tasterSummaryAt: '2099-01-01T08:00:00.000Z',
            financeMark: true,
            cigaretteFeeCents: 100,
          },
          {
            id: 'seed-bad-times',
            groupNo: 'PEND-BAD-TIMES',
            visitDate: '2099-01-01',
            tasterId: 'seed-taster',
            tasterSummary: 'summary exists',
            tasterSummaryAt: '2099-01-01T08:00:00.000Z',
            arrivalTime: '15:00',
            departureTime: '14:59',
            financeMark: true,
            cigaretteFeeCents: 100,
          },
          {
            id: 'seed-missing-departure-ok',
            groupNo: 'PEND-MISSING-DEPARTURE-OK',
            visitDate: '2099-01-01',
            tasterId: 'seed-taster',
            tasterSummary: 'summary exists',
            tasterSummaryAt: '2099-01-01T08:00:00.000Z',
            arrivalTime: '15:00',
            departureTime: null,
            financeMark: true,
            cigaretteFeeCents: 100,
          },
          {
            id: 'seed-order-no-departure-ok',
            groupNo: 'PEND-ORDER-NO-DEPARTURE-OK',
            visitDate: '2099-01-01',
            tasterId: 'seed-taster',
            arrivalTime: '15:00',
            departureTime: null,
            financeMark: true,
            cigaretteFeeCents: 100,
          },
        ],
        users: [
          {
            id: 'seed-taster',
            name: 'Seed Pending Taster',
            username: 'seed-pending-taster',
            password: 'Password123',
            role: 'taster',
          },
        ],
        salesOrders: [
          {
            orderNo: 'SO-PENDING-ORDER-NO-DEPARTURE',
            travelGroupId: 'seed-order-no-departure-ok',
            orderDate: '2099-01-01',
            totalAmountCents: 10000,
          },
        ],
      },
    },
  );
});

test('contract: travel group list supports filters and computed pending status parameter', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const tasterAlpha = await createUser(baseUrl, admin.token, {
      name: 'Filter Taster Alpha',
      username: 'filter-taster-alpha',
      password: 'Password123',
      role: 'taster',
    });
    const tasterBeta = await createUser(baseUrl, admin.token, {
      name: 'Filter Taster Beta',
      username: 'filter-taster-beta',
      password: 'Password123',
      role: 'taster',
    });

    const groupAlpha = await createScopedTravelGroup(baseUrl, admin.token, {
      visitDate: '2026-06-26',
      tasterId: tasterAlpha.id,
      liaisonTasterId: tasterBeta.id,
      travelAgency: 'Filter Agency Alpha',
      groupType: 'KB团',
      guestCount: 8,
      tastingRoomNo: '5',
      sourceRegion: '华东唯一客源地',
    });
    const groupBeta = await createScopedTravelGroup(baseUrl, admin.token, {
      visitDate: '2026-06-27',
      tasterId: tasterBeta.id,
      liaisonTasterId: tasterAlpha.id,
      travelAgency: 'Filter Agency Beta',
      groupType: 'AB团',
      guestCount: 18,
      tastingRoomNo: '15',
      previousStopOrderStatus: '熊猫',
    });
    const groupGamma = await createScopedTravelGroup(baseUrl, admin.token, {
      visitDate: '2026-06-27',
      tasterId: tasterAlpha.id,
      travelAgency: 'Filter Agency Alpha',
      groupType: 'KB团',
      guestCount: 28,
      tastingRoomNo: '50',
      keyCustomerInfo: '董事长重点接待',
    });
    await setTravelGroupFinanceMark(baseUrl, admin.token, groupBeta.id, true);

    const dateFiltered = await requestJson(
      baseUrl,
      '/api/travel-groups?dateFrom=2026-06-27&dateTo=2026-06-27',
      {
        token: admin.token,
      },
    );
    assert.equal(dateFiltered.response.status, 200);
    assert.deepEqual(
      groupNos(dateFiltered.body.data.travelGroups),
      groupNos([groupBeta, groupGamma]),
    );

    const keywordFiltered = await requestJson(
      baseUrl,
      `/api/travel-groups?keyword=${encodeURIComponent(groupAlpha.groupNo.slice(-4))}`,
      {
        token: admin.token,
      },
    );
    assert.equal(keywordFiltered.response.status, 200);
    assert.deepEqual(groupNos(keywordFiltered.body.data.travelGroups), [
      groupAlpha.groupNo,
    ]);

    for (const [keyword, expectedGroup] of [
      ['华东唯一客源地', groupAlpha],
      ['熊猫', groupBeta],
      ['董事长重点接待', groupGamma],
    ]) {
      const newFieldSearch = await requestJson(
        baseUrl,
        `/api/travel-groups?keyword=${encodeURIComponent(keyword)}`,
        {
          token: admin.token,
        },
      );
      assert.equal(newFieldSearch.response.status, 200);
      assert.deepEqual(groupNos(newFieldSearch.body.data.travelGroups), [
        expectedGroup.groupNo,
      ]);
    }

    const groupNoFiltered = await requestJson(
      baseUrl,
      `/api/travel-groups?groupNo=${groupBeta.groupNo}`,
      {
        token: admin.token,
      },
    );
    assert.equal(groupNoFiltered.response.status, 200);
    assert.deepEqual(groupNos(groupNoFiltered.body.data.travelGroups), [
      groupBeta.groupNo,
    ]);

    const guideFiltered = await requestJson(
      baseUrl,
      `/api/travel-groups?guideId=${groupGamma.guideId}`,
      {
        token: admin.token,
      },
    );
    assert.equal(guideFiltered.response.status, 200);
    assert.deepEqual(groupNos(guideFiltered.body.data.travelGroups), [
      groupGamma.groupNo,
    ]);

    const tasterFiltered = await requestJson(
      baseUrl,
      `/api/travel-groups?tasterId=${tasterAlpha.id}`,
      {
        token: admin.token,
      },
    );
    assert.equal(tasterFiltered.response.status, 200);
    assert.deepEqual(
      groupNos(tasterFiltered.body.data.travelGroups),
      groupNos([groupAlpha, groupGamma]),
    );

    for (const rawTastingRoomNo of ['5', '  5  ']) {
      const tastingRoomFiltered = await requestJson(
        baseUrl,
        `/api/travel-groups?tastingRoomNo=${encodeURIComponent(rawTastingRoomNo)}`,
        {
          token: admin.token,
        },
      );
      assert.equal(tastingRoomFiltered.response.status, 200);
      assert.deepEqual(
        groupNos(tastingRoomFiltered.body.data.travelGroups),
        [groupAlpha.groupNo],
      );
    }

    const liaisonTasterFiltered = await requestJson(
      baseUrl,
      `/api/travel-groups?liaisonTasterId=${tasterAlpha.id}`,
      {
        token: admin.token,
      },
    );
    assert.equal(liaisonTasterFiltered.response.status, 200);
    assert.deepEqual(groupNos(liaisonTasterFiltered.body.data.travelGroups), [
      groupBeta.groupNo,
    ]);

    const agencyFiltered = await requestJson(
      baseUrl,
      '/api/travel-groups?travelAgency=Filter%20Agency%20Alpha',
      {
        token: admin.token,
      },
    );
    assert.equal(agencyFiltered.response.status, 200);
    assert.deepEqual(
      groupNos(agencyFiltered.body.data.travelGroups),
      groupNos([groupAlpha, groupGamma]),
    );

    const typeFiltered = await requestJson(
      baseUrl,
      '/api/travel-groups?groupType=AB%E5%9B%A2',
      {
        token: admin.token,
      },
    );
    assert.equal(typeFiltered.response.status, 200);
    assert.deepEqual(groupNos(typeFiltered.body.data.travelGroups), [
      groupBeta.groupNo,
    ]);

    const markedFiltered = await requestJson(
      baseUrl,
      '/api/travel-groups?financeMark=true',
      {
        token: admin.token,
      },
    );
    assert.equal(markedFiltered.response.status, 200);
    assert.deepEqual(groupNos(markedFiltered.body.data.travelGroups), [
      groupBeta.groupNo,
    ]);

    const unmarkedFiltered = await requestJson(
      baseUrl,
      '/api/travel-groups?financeMark=false',
      {
        token: admin.token,
      },
    );
    assert.equal(unmarkedFiltered.response.status, 200);
    assert.deepEqual(
      groupNos(unmarkedFiltered.body.data.travelGroups),
      groupNos([groupAlpha, groupGamma]),
    );

    const pendingFiltered = await requestJson(
      baseUrl,
      '/api/travel-groups?pendingStatus=pending_sales',
      {
        token: admin.token,
      },
    );
    assert.equal(pendingFiltered.response.status, 200);
    assert.deepEqual(
      groupNos(pendingFiltered.body.data.travelGroups),
      groupNos([groupAlpha, groupBeta, groupGamma]),
    );

    const limited = await requestJson(baseUrl, '/api/travel-groups?limit=2', {
      token: admin.token,
    });
    assert.equal(limited.response.status, 200);
    assert.equal(limited.body.data.travelGroups.length, 2);
  });
});

test('contract: picker filters remain inside the taster travel group data scope', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const allowedTasterUser = await createUser(baseUrl, admin.token, {
      name: 'Picker Scope Allowed Taster',
      username: 'picker-scope-allowed-taster',
      password: 'Password123',
      role: 'taster',
    });
    const restrictedTasterUser = await createUser(baseUrl, admin.token, {
      name: 'Picker Scope Restricted Taster',
      username: 'picker-scope-restricted-taster',
      password: 'Password123',
      role: 'taster',
    });
    const allowedTaster = await login(
      baseUrl,
      allowedTasterUser.username,
      'Password123',
    );
    const allowedGroup = await createScopedTravelGroup(baseUrl, admin.token, {
      groupNo: 'GZ-PICKER-SCOPE-ALLOWED',
      visitDate: SHANGHAI_TODAY,
      arrivalTime: '09:00',
      tasterId: allowedTasterUser.id,
      tastingRoomNo: 'PICKER-SCOPE-ROOM',
    });
    await createScopedTravelGroup(baseUrl, admin.token, {
      groupNo: 'GZ-PICKER-SCOPE-RESTRICTED',
      visitDate: SHANGHAI_TODAY,
      arrivalTime: '09:00',
      tasterId: restrictedTasterUser.id,
      tastingRoomNo: 'PICKER-SCOPE-ROOM',
    });

    const roomFiltered = await requestJson(
      baseUrl,
      '/api/travel-groups?tastingRoomNo=PICKER-SCOPE-ROOM',
      {
        token: allowedTaster.token,
      },
    );
    assert.equal(roomFiltered.response.status, 200);
    assert.deepEqual(groupNos(roomFiltered.body.data.travelGroups), [
      allowedGroup.groupNo,
    ]);

    const restrictedTasterFiltered = await requestJson(
      baseUrl,
      `/api/travel-groups?tasterId=${restrictedTasterUser.id}`,
      {
        token: allowedTaster.token,
      },
    );
    assert.equal(restrictedTasterFiltered.response.status, 200);
    assert.deepEqual(
      groupNos(restrictedTasterFiltered.body.data.travelGroups),
      [],
    );
  });
});

test('contract: business data role scopes expose travel groups and keep sales order scopes', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const bossUser = await createUser(baseUrl, admin.token, {
      name: 'Scope Boss',
      username: 'scope-boss',
      password: 'Password123',
      role: 'boss',
    });
    const financeUser = await createUser(baseUrl, admin.token, {
      name: 'Scope Finance',
      username: 'scope-finance',
      password: 'Password123',
      role: 'finance',
    });
    const frontDeskUser = await createUser(baseUrl, admin.token, {
      name: 'Scope Front Desk',
      username: 'scope-front-desk',
      password: 'Password123',
      role: 'front_desk',
    });
    const salesAlphaUser = await createUser(baseUrl, admin.token, {
      name: 'Scope Sales Alpha',
      username: 'scope-sales-alpha',
      password: 'Password123',
      role: 'sales',
    });
    const salesBetaUser = await createUser(baseUrl, admin.token, {
      name: 'Scope Sales Beta',
      username: 'scope-sales-beta',
      password: 'Password123',
      role: 'sales',
    });
    const tasterAlphaUser = await createUser(baseUrl, admin.token, {
      name: 'Scope Taster Alpha',
      username: 'scope-taster-alpha',
      password: 'Password123',
      role: 'taster',
    });
    const tasterBetaUser = await createUser(baseUrl, admin.token, {
      name: 'Scope Taster Beta',
      username: 'scope-taster-beta',
      password: 'Password123',
      role: 'taster',
    });
    await createUser(baseUrl, admin.token, {
      name: 'Scope Warehouse',
      username: 'scope-warehouse',
      password: 'Password123',
      role: 'warehouse',
    });
    await createUser(baseUrl, admin.token, {
      name: 'Scope After Sales',
      username: 'scope-after-sales',
      password: 'Password123',
      role: 'after_sales',
    });

    const boss = await login(baseUrl, bossUser.username, 'Password123');
    const finance = await login(baseUrl, financeUser.username, 'Password123');
    const frontDesk = await login(baseUrl, 'scope-front-desk', 'Password123');
    const salesAlpha = await login(baseUrl, 'scope-sales-alpha', 'Password123');
    const salesBeta = await login(baseUrl, 'scope-sales-beta', 'Password123');
    const tasterAlpha = await login(
      baseUrl,
      'scope-taster-alpha',
      'Password123',
    );
    const tasterBeta = await login(baseUrl, 'scope-taster-beta', 'Password123');
    const warehouse = await login(baseUrl, 'scope-warehouse', 'Password123');
    const afterSales = await login(baseUrl, 'scope-after-sales', 'Password123');

    const groupAlpha = await createScopedTravelGroup(baseUrl, admin.token, {
      groupNo: 'GZ-SCOPE-A',
      visitDate: SHANGHAI_TODAY,
      tasterId: tasterAlphaUser.id,
      tasterName: tasterAlphaUser.name,
      tastingItems: [
        {
          productName: '罐装酒',
          quantity: 2,
          unit: '瓶',
          note: '接待品鉴',
        },
      ],
    });
    const groupBeta = await createScopedTravelGroup(baseUrl, admin.token, {
      groupNo: 'GZ-SCOPE-B',
      visitDate: SHANGHAI_TODAY,
      tasterId: tasterBetaUser.id,
      tasterName: tasterBetaUser.name,
      liaisonTasterId: tasterAlphaUser.id,
    });

    const createdByAlpha = await createScopedSalesOrder(
      baseUrl,
      salesAlpha.token,
      {
        orderNo: 'SO-SCOPE-CREATED',
        travelGroupId: groupAlpha.id,
      },
    );
    const assignedToAlpha = await createScopedSalesOrder(baseUrl, admin.token, {
      orderNo: 'SO-SCOPE-ASSIGNED',
      travelGroupId: groupAlpha.id,
      salesUserId: salesAlphaUser.id,
    });
    const createdByBeta = await createScopedSalesOrder(
      baseUrl,
      salesBeta.token,
      {
        orderNo: 'SO-SCOPE-BETA',
        travelGroupId: groupBeta.id,
      },
    );

    assert.equal(createdByAlpha.salesUserId, salesAlphaUser.id);
    assert.equal(assignedToAlpha.salesUserId, salesAlphaUser.id);
    assert.equal(createdByBeta.salesUserId, salesBetaUser.id);

    const alphaTasterGroups = await requestJson(baseUrl, '/api/travel-groups', {
      token: tasterAlpha.token,
    });
    assert.equal(alphaTasterGroups.response.status, 200);
    assert.deepEqual(
      groupNos(alphaTasterGroups.body.data.travelGroups),
      groupNos([groupAlpha, groupBeta]),
    );
    assert.deepEqual(
      alphaTasterGroups.body.data.travelGroups
        .find((group) => group.id === groupAlpha.id)
        .tastingItems.map((item) => [
          item.productName,
          item.quantity,
          item.unit,
          item.note,
        ]),
      [['罐装酒', 2, '瓶', '接待品鉴']],
    );

    const alphaReceptionGroups = await requestJson(
      baseUrl,
      `/api/travel-groups?tasterId=${tasterAlphaUser.id}`,
      {
        token: tasterAlpha.token,
      },
    );
    assert.equal(alphaReceptionGroups.response.status, 200);
    assert.deepEqual(groupNos(alphaReceptionGroups.body.data.travelGroups), [
      groupAlpha.groupNo,
    ]);

    const alphaLiaisonGroups = await requestJson(
      baseUrl,
      `/api/travel-groups?liaisonTasterId=${tasterAlphaUser.id}`,
      {
        token: tasterAlpha.token,
      },
    );
    assert.equal(alphaLiaisonGroups.response.status, 200);
    assert.deepEqual(groupNos(alphaLiaisonGroups.body.data.travelGroups), [
      groupBeta.groupNo,
    ]);

    const betaTasterGroups = await requestJson(baseUrl, '/api/travel-groups', {
      token: tasterBeta.token,
    });
    assert.equal(betaTasterGroups.response.status, 200);
    assert.deepEqual(groupNos(betaTasterGroups.body.data.travelGroups), [
      groupBeta.groupNo,
    ]);

    const liaisonTasterDetail = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupBeta.id}`,
      {
        token: tasterAlpha.token,
      },
    );
    assert.equal(liaisonTasterDetail.response.status, 200);
    assert.equal(
      liaisonTasterDetail.body.data.travelGroup.groupNo,
      groupBeta.groupNo,
    );

    const unrelatedTasterDetail = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupAlpha.id}`,
      {
        token: tasterBeta.token,
      },
    );
    assertErrorContract(
      unrelatedTasterDetail,
      404,
      'TRAVEL_GROUP_NOT_FOUND',
    );

    const deniedTastingItemsPatch = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupAlpha.id}`,
      {
        method: 'PATCH',
        token: tasterAlpha.token,
        body: { tastingItems: [] },
      },
    );
    assertErrorContract(
      deniedTastingItemsPatch,
      403,
      'FIELD_PERMISSION_DENIED',
    );

    const salesTastingItemsPatch = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupAlpha.id}`,
      {
        method: 'PATCH',
        token: salesAlpha.token,
        body: {
          tastingItems: [
            {
              productName: '罐装酒',
              quantity: 3,
              unit: '瓶',
              note: '销售维护',
            },
          ],
        },
      },
    );
    assert.equal(salesTastingItemsPatch.response.status, 200);
    assert.deepEqual(
      salesTastingItemsPatch.body.data.travelGroup.tastingItems.map(
        (item) => [item.productName, item.quantity, item.unit, item.note],
      ),
      [['罐装酒', 3, '瓶', '销售维护']],
    );

    const alphaSalesGroups = await requestJson(baseUrl, '/api/travel-groups', {
      token: salesAlpha.token,
    });
    assert.equal(alphaSalesGroups.response.status, 200);
    assert.deepEqual(
      groupNos(alphaSalesGroups.body.data.travelGroups),
      groupNos([groupAlpha, groupBeta]),
    );

    const salesOtherGroupDetail = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupBeta.id}`,
      {
        token: salesAlpha.token,
      },
    );
    assert.equal(salesOtherGroupDetail.response.status, 200);
    assertTravelGroupDetailDto(salesOtherGroupDetail.body.data.travelGroup);

    const alphaOrders = await requestJson(baseUrl, '/api/sales-orders', {
      token: salesAlpha.token,
    });
    assert.equal(alphaOrders.response.status, 200);
    assert.deepEqual(orderNos(alphaOrders.body.data.salesOrders), [
      assignedToAlpha.orderNo,
      createdByAlpha.orderNo,
    ].sort());

    const betaOrders = await requestJson(baseUrl, '/api/sales-orders', {
      token: salesBeta.token,
    });
    assert.equal(betaOrders.response.status, 200);
    assert.deepEqual(orderNos(betaOrders.body.data.salesOrders), [
      createdByBeta.orderNo,
    ]);

    const assignedDetail = await requestJson(
      baseUrl,
      `/api/sales-orders/${assignedToAlpha.id}`,
      {
        token: salesAlpha.token,
      },
    );
    assert.equal(assignedDetail.response.status, 200);
    assert.equal(
      assignedDetail.body.data.salesOrder.orderNo,
      assignedToAlpha.orderNo,
    );

    const salesBlockedOrderDetail = await requestJson(
      baseUrl,
      `/api/sales-orders/${createdByBeta.id}`,
      {
        token: salesAlpha.token,
      },
    );
    assertErrorContract(salesBlockedOrderDetail, 404, 'SALES_ORDER_NOT_FOUND');

    const betaBlockedAssignedDetail = await requestJson(
      baseUrl,
      `/api/sales-orders/${assignedToAlpha.id}`,
      {
        token: salesBeta.token,
      },
    );
    assertErrorContract(
      betaBlockedAssignedDetail,
      404,
      'SALES_ORDER_NOT_FOUND',
    );

    const adminOrders = await requestJson(baseUrl, '/api/sales-orders', {
      token: admin.token,
    });
    assert.equal(adminOrders.response.status, 200);
    assert.deepEqual(orderNos(adminOrders.body.data.salesOrders), [
      assignedToAlpha.orderNo,
      createdByAlpha.orderNo,
      createdByBeta.orderNo,
    ].sort());

    const adminGroupDetail = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupAlpha.id}`,
      {
        token: admin.token,
      },
    );
    assert.equal(adminGroupDetail.response.status, 200);
    assertTravelGroupDetailDto(adminGroupDetail.body.data.travelGroup);
    assert.equal(
      adminGroupDetail.body.data.travelGroup.guide.id,
      groupAlpha.guideId,
    );
    assert.equal(
      adminGroupDetail.body.data.travelGroup.taster.id,
      tasterAlphaUser.id,
    );
    assert.deepEqual(
      orderNos(adminGroupDetail.body.data.travelGroup.salesOrders),
      [assignedToAlpha.orderNo, createdByAlpha.orderNo].sort(),
    );
    assert.equal(
      adminGroupDetail.body.data.travelGroup.orderSummary.orderCount,
      2,
    );
    assert.equal(
      adminGroupDetail.body.data.travelGroup.orderSummary.totalAmountCents,
      20000,
    );

    const bossGroupDetail = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupAlpha.id}`,
      {
        token: boss.token,
      },
    );
    assert.equal(bossGroupDetail.response.status, 200);
    assertTravelGroupDetailDto(bossGroupDetail.body.data.travelGroup);

    const bossPatch = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupAlpha.id}`,
      {
        method: 'PATCH',
        token: boss.token,
        body: {
          remarks: 'boss should not edit',
        },
      },
    );
    assertErrorContract(bossPatch, 403, 'PERMISSION_DENIED');

    const financeGroupDetail = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupAlpha.id}`,
      {
        token: finance.token,
      },
    );
    assert.equal(financeGroupDetail.response.status, 200);
    assertTravelGroupDetailDto(financeGroupDetail.body.data.travelGroup);

    const salesAllowedGroupDetail = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupAlpha.id}`,
      {
        token: salesAlpha.token,
      },
    );
    assert.equal(salesAllowedGroupDetail.response.status, 200);
    assertTravelGroupDetailDto(salesAllowedGroupDetail.body.data.travelGroup);

    const tasterAllowedGroupDetail = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupAlpha.id}`,
      {
        token: tasterAlpha.token,
      },
    );
    assert.equal(tasterAllowedGroupDetail.response.status, 200);
    assertTravelGroupDetailDto(tasterAllowedGroupDetail.body.data.travelGroup);

    const groupFrontDesk = await createScopedTravelGroup(
      baseUrl,
      frontDesk.token,
      {
        tasterId: tasterAlphaUser.id,
        liaisonTasterId: tasterAlphaUser.id,
        visitDate: SHANGHAI_TODAY,
      },
    );
    const frontDeskGroups = await requestJson(baseUrl, '/api/travel-groups', {
      token: frontDesk.token,
    });
    assert.equal(frontDeskGroups.response.status, 200);
    assert.deepEqual(
      groupNos(frontDeskGroups.body.data.travelGroups),
      groupNos([groupAlpha, groupBeta, groupFrontDesk]),
    );

    const frontDeskOwnDetail = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupFrontDesk.id}`,
      {
        token: frontDesk.token,
      },
    );
    assert.equal(frontDeskOwnDetail.response.status, 200);
    assertTravelGroupDetailDto(frontDeskOwnDetail.body.data.travelGroup);

    const salesGroupsAfterFrontDeskCreate = await requestJson(
      baseUrl,
      '/api/travel-groups',
      {
        token: salesAlpha.token,
      },
    );
    assert.equal(salesGroupsAfterFrontDeskCreate.response.status, 200);
    assert.deepEqual(
      groupNos(salesGroupsAfterFrontDeskCreate.body.data.travelGroups),
      groupNos([groupAlpha, groupBeta, groupFrontDesk]),
    );

    const salesFrontDeskGroupDetail = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupFrontDesk.id}`,
      {
        token: salesAlpha.token,
      },
    );
    assert.equal(salesFrontDeskGroupDetail.response.status, 200);
    assertTravelGroupDetailDto(salesFrontDeskGroupDetail.body.data.travelGroup);

    const alphaReceptionAfterFrontDeskCreate = await requestJson(
      baseUrl,
      `/api/travel-groups?tasterId=${tasterAlphaUser.id}`,
      {
        token: tasterAlpha.token,
      },
    );
    assert.equal(alphaReceptionAfterFrontDeskCreate.response.status, 200);
    assert.deepEqual(
      groupNos(alphaReceptionAfterFrontDeskCreate.body.data.travelGroups),
      groupNos([groupAlpha, groupFrontDesk]),
    );

    const alphaLiaisonAfterFrontDeskCreate = await requestJson(
      baseUrl,
      `/api/travel-groups?liaisonTasterId=${tasterAlphaUser.id}`,
      {
        token: tasterAlpha.token,
      },
    );
    assert.equal(alphaLiaisonAfterFrontDeskCreate.response.status, 200);
    assert.deepEqual(
      groupNos(alphaLiaisonAfterFrontDeskCreate.body.data.travelGroups),
      groupNos([groupBeta, groupFrontDesk]),
    );

    const frontDeskOtherDetail = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupAlpha.id}`,
      {
        token: frontDesk.token,
      },
    );
    assert.equal(frontDeskOtherDetail.response.status, 200);
    assertTravelGroupDetailDto(frontDeskOtherDetail.body.data.travelGroup);

    for (const { role, session } of [
      { role: 'warehouse', session: warehouse },
      { role: 'after_sales', session: afterSales },
    ]) {
      const createAttempt = await requestJson(baseUrl, '/api/travel-groups', {
        method: 'POST',
        token: session.token,
        body: {
          visitDate: '2026-06-24',
          travelAgency: `Blocked ${role} Agency`,
          guideId: groupAlpha.guideId,
        },
      });
      assertErrorContract(createAttempt, 403, 'PERMISSION_DENIED');
    }

    const warehouseGroups = await requestJson(baseUrl, '/api/travel-groups', {
      token: warehouse.token,
    });
    assert.equal(warehouseGroups.response.status, 200);
    assert.deepEqual(
      groupNos(warehouseGroups.body.data.travelGroups),
      groupNos([groupAlpha, groupBeta, groupFrontDesk]),
    );

    const warehouseGroupDetail = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupAlpha.id}`,
      {
        token: warehouse.token,
      },
    );
    assert.equal(warehouseGroupDetail.response.status, 200);
    assertTravelGroupDetailDto(warehouseGroupDetail.body.data.travelGroup);

    const warehouseGroupPatch = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupAlpha.id}`,
      {
        method: 'PATCH',
        token: warehouse.token,
        body: {
          remarks: 'warehouse should not edit travel group',
        },
      },
    );
    assertErrorContract(warehouseGroupPatch, 403, 'PERMISSION_DENIED');

    const afterSalesGroups = await requestJson(baseUrl, '/api/travel-groups', {
      token: afterSales.token,
    });
    assert.equal(afterSalesGroups.response.status, 200);
    assert.deepEqual(
      groupNos(afterSalesGroups.body.data.travelGroups),
      groupNos([groupAlpha, groupBeta, groupFrontDesk]),
    );

    const afterSalesGroupDetail = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupBeta.id}`,
      {
        token: afterSales.token,
      },
    );
    assert.equal(afterSalesGroupDetail.response.status, 200);
    assertTravelGroupDetailDto(afterSalesGroupDetail.body.data.travelGroup);

    const afterSalesGroupPatch = await requestJson(
      baseUrl,
      `/api/travel-groups/${groupBeta.id}`,
      {
        method: 'PATCH',
        token: afterSales.token,
        body: {
          remarks: 'after sales should not edit travel group',
        },
      },
    );
    assertErrorContract(afterSalesGroupPatch, 403, 'PERMISSION_DENIED');
  });
});

test('contract: sales order creation rolls back when travel group summary update fails', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const group = await createScopedTravelGroup(baseUrl, admin.token, {
        groupNo: 'GZ-TX-ROLLBACK',
      });

      const failedOrder = await requestJson(baseUrl, '/api/sales-orders', {
        method: 'POST',
        token: admin.token,
        body: {
          orderNo: 'SO-TX-ROLLBACK',
          orderType: 'travel_group',
          travelGroupId: group.id,
          customer: {
            name: 'Rollback Customer',
            phone: '13900001111',
          },
          orderDate: '2026-06-24',
          cashOnDeliveryAmountCents: 3000,
          items: [
            {
              productName: 'Rollback Product',
              quantity: 2,
              unitPriceCents: 12000,
              deliveryType: 'shipping',
            },
          ],
        },
      });
      assertErrorContract(failedOrder, 500, 'INTERNAL_ERROR');

      const orders = await requestJson(baseUrl, '/api/sales-orders', {
        token: admin.token,
      });
      assert.equal(orders.response.status, 200);
      assert.deepEqual(orderNos(orders.body.data.salesOrders), []);

      const groupDetail = await requestJson(
        baseUrl,
        `/api/travel-groups/${group.id}`,
        {
          token: admin.token,
        },
      );
      assert.equal(groupDetail.response.status, 200);
      assert.equal(groupDetail.body.data.travelGroup.status, 'unmarked');
      assert.equal(groupDetail.body.data.travelGroup.salesAmountCents, 0);
      assert.equal(groupDetail.body.data.travelGroup.orderAmountCents, 0);
      assert.equal(groupDetail.body.data.travelGroup.cashOnDeliveryCents, 0);

      const logs = await requestJson(
        baseUrl,
        '/api/operation-logs?action=sales_orders.create&result=SUCCESS',
        {
          token: admin.token,
        },
      );
      assert.equal(logs.response.status, 200);
      assert.equal(logs.body.data.logs.length, 0);
    },
    {
      prisma: {
        failTravelGroupUpdateOnce: true,
      },
    },
  );
});

test('contract: global mark query filters business lists and details until admin restore', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    await configureDefaultPaymentMethodServiceFeeRate(
      baseUrl,
      admin.token,
    );
    const sharedTaster = await createUser(baseUrl, admin.token, {
      name: 'Global Mark Shared Taster',
      username: 'global-mark-shared-taster',
      password: 'Password123',
      role: 'taster',
    });

    const markedGroup = await createScopedTravelGroup(baseUrl, admin.token, {
      groupNo: 'GZ-MARK-YES',
      tasterId: sharedTaster.id,
      tastingRoomNo: 'GLOBAL-MARK-ROOM',
    });
    const unmarkedGroup = await createScopedTravelGroup(baseUrl, admin.token, {
      groupNo: 'GZ-MARK-NO',
      tasterId: sharedTaster.id,
      tastingRoomNo: 'GLOBAL-MARK-ROOM',
    });

    const markedOrder = await createScopedSalesOrder(baseUrl, admin.token, {
      orderNo: 'SO-MARK-YES',
      travelGroupId: markedGroup.id,
      customerName: 'Unmarked Customer Visible Order',
      customerPhone: '13900009001',
    });
    const unmarkedOrder = await createScopedSalesOrder(baseUrl, admin.token, {
      orderNo: 'SO-MARK-ORDER-NO',
      travelGroupId: markedGroup.id,
      customerName: 'Marked Customer Hidden Order',
      customerPhone: '13900009002',
    });
    const markedOrderWithUnmarkedGroup = await createScopedSalesOrder(
      baseUrl,
      admin.token,
      {
        orderNo: 'SO-MARK-GROUP-NO',
        travelGroupId: unmarkedGroup.id,
        customerName: 'Unmarked Customer And Group Visible Order',
        customerPhone: '13900009003',
      },
    );

    await setTravelGroupFinanceMark(baseUrl, admin.token, markedGroup.id, true);
    await setCustomerFinanceMark(
      baseUrl,
      admin.token,
      unmarkedOrder.customerId,
      true,
    );
    await setSalesOrderFinanceMark(baseUrl, admin.token, markedOrder.id, true);
    await setSalesOrderFinanceMark(
      baseUrl,
      admin.token,
      markedOrderWithUnmarkedGroup.id,
      true,
    );

    const unchangedCustomer = await requestJson(
      baseUrl,
      `/api/customers/${markedOrder.customerId}`,
      { token: admin.token },
    );
    assert.equal(unchangedCustomer.response.status, 200);
    assert.equal(unchangedCustomer.body.data.customer.financeMark, false);

    const unchangedGroup = await requestJson(
      baseUrl,
      `/api/travel-groups/${unmarkedGroup.id}`,
      { token: admin.token },
    );
    assert.equal(unchangedGroup.response.status, 200);
    assert.equal(unchangedGroup.body.data.travelGroup.financeMark, false);

    const beforeEnableGroups = await requestJson(
      baseUrl,
      '/api/travel-groups',
      {
        token: admin.token,
      },
    );
    assert.equal(beforeEnableGroups.response.status, 200);
    assert.deepEqual(
      groupNos(beforeEnableGroups.body.data.travelGroups),
      groupNos([markedGroup, unmarkedGroup]),
    );

    const beforeEnableOrders = await requestJson(baseUrl, '/api/sales-orders', {
      token: admin.token,
    });
    assert.equal(beforeEnableOrders.response.status, 200);
    assert.deepEqual(orderNos(beforeEnableOrders.body.data.salesOrders), [
      markedOrder.orderNo,
      markedOrderWithUnmarkedGroup.orderNo,
      unmarkedOrder.orderNo,
    ].sort());

    const enabled = await requestJson(
      baseUrl,
      '/api/settings/global-mark-query/enable',
      {
        method: 'POST',
        token: admin.token,
      },
    );
    assert.equal(enabled.response.status, 200);
    assert.equal(enabled.body.data.settings.onlyShowMarkedRecords, true);

    const markedGroupsOnly = await requestJson(baseUrl, '/api/travel-groups', {
      token: admin.token,
    });
    assert.equal(markedGroupsOnly.response.status, 200);
    assert.deepEqual(groupNos(markedGroupsOnly.body.data.travelGroups), [
      markedGroup.groupNo,
    ]);

    for (const filter of [
      `tasterId=${encodeURIComponent(sharedTaster.id)}`,
      'tastingRoomNo=GLOBAL-MARK-ROOM',
    ]) {
      const markedFilteredGroups = await requestJson(
        baseUrl,
        `/api/travel-groups?${filter}`,
        {
          token: admin.token,
        },
      );
      assert.equal(markedFilteredGroups.response.status, 200);
      assert.deepEqual(
        groupNos(markedFilteredGroups.body.data.travelGroups),
        [markedGroup.groupNo],
      );
    }

    const hiddenGroupDetail = await requestJson(
      baseUrl,
      `/api/travel-groups/${unmarkedGroup.id}`,
      {
        token: admin.token,
      },
    );
    assertErrorContract(hiddenGroupDetail, 404, 'TRAVEL_GROUP_NOT_FOUND');

    const markedOrdersOnly = await requestJson(baseUrl, '/api/sales-orders', {
      token: admin.token,
    });
    assert.equal(markedOrdersOnly.response.status, 200);
    assert.deepEqual(orderNos(markedOrdersOnly.body.data.salesOrders), [
      markedOrder.orderNo,
      markedOrderWithUnmarkedGroup.orderNo,
    ].sort());

    for (const query of [
      markedOrder.orderNo,
      'Unmarked Customer Visible Order',
      '13900009001',
    ]) {
      const search = await requestJson(
        baseUrl,
        `/api/sales-orders?query=${encodeURIComponent(query)}`,
        { token: admin.token },
      );
      assert.equal(search.response.status, 200);
      assert.deepEqual(
        orderNos(search.body.data.salesOrders),
        [markedOrder.orderNo],
      );
    }

    for (const query of [
      unmarkedOrder.orderNo,
      'Marked Customer Hidden Order',
      '13900009002',
    ]) {
      const search = await requestJson(
        baseUrl,
        `/api/sales-orders?query=${encodeURIComponent(query)}`,
        { token: admin.token },
      );
      assert.equal(search.response.status, 200);
      assert.deepEqual(search.body.data.salesOrders, []);
    }

    const hiddenUnmarkedOrderDetail = await requestJson(
      baseUrl,
      `/api/sales-orders/${unmarkedOrder.id}`,
      {
        token: admin.token,
      },
    );
    assertErrorContract(
      hiddenUnmarkedOrderDetail,
      404,
      'SALES_ORDER_NOT_FOUND',
    );

    const visibleUnmarkedGroupOrderDetail = await requestJson(
      baseUrl,
      `/api/sales-orders/${markedOrderWithUnmarkedGroup.id}`,
      {
        token: admin.token,
      },
    );
    assert.equal(
      visibleUnmarkedGroupOrderDetail.response.status,
      200,
    );

    const markedGroupDetail = await requestJson(
      baseUrl,
      `/api/travel-groups/${markedGroup.id}`,
      { token: admin.token },
    );
    assert.equal(markedGroupDetail.response.status, 200);
    assert.deepEqual(
      orderNos(markedGroupDetail.body.data.travelGroup.salesOrders),
      [markedOrder.orderNo],
    );

    const markedOverview = await requestJson(
      baseUrl,
      '/api/finance/overview?dateFrom=2026-06-24&dateTo=2026-06-24',
      {
        token: admin.token,
      },
    );
    assert.equal(markedOverview.response.status, 200);
    assert.equal(markedOverview.body.data.overview.metrics.travelGroupCount, 1);
    assert.equal(markedOverview.body.data.overview.metrics.orderCount, 2);
    assert.equal(
      markedOverview.body.data.overview.metrics.salesAmountCents,
      20000,
    );

    const restored = await requestJson(
      baseUrl,
      '/api/settings/global-mark-query/restore',
      {
        method: 'POST',
        token: admin.token,
      },
    );
    assert.equal(restored.response.status, 200);
    assert.equal(restored.body.data.settings.onlyShowMarkedRecords, false);

    const restoredGroups = await requestJson(baseUrl, '/api/travel-groups', {
      token: admin.token,
    });
    assert.equal(restoredGroups.response.status, 200);
    assert.deepEqual(
      groupNos(restoredGroups.body.data.travelGroups),
      groupNos([markedGroup, unmarkedGroup]),
    );

    const restoredOrders = await requestJson(baseUrl, '/api/sales-orders', {
      token: admin.token,
    });
    assert.equal(restoredOrders.response.status, 200);
    assert.deepEqual(orderNos(restoredOrders.body.data.salesOrders), [
      markedOrder.orderNo,
      markedOrderWithUnmarkedGroup.orderNo,
      unmarkedOrder.orderNo,
    ].sort());
  });
});

let fixtureSequence = 0;

function buildValidSalesOrderCreateBody(overrides = {}) {
  return {
    orderType: 'external',
    orderDate: '2026-06-29',
    customer: {
      name: 'Valid Order Customer',
      phone: '13900006666',
    },
    items: buildValidOrderItems(),
    ...overrides,
  };
}

function buildValidOrderItems() {
  return [
    {
      productName: 'Valid Order Product',
      quantity: 1,
      unitPriceCents: 10000,
      deliveryType: 'shipping',
    },
  ];
}

function shiftShanghaiBusinessDate(businessDate, days) {
  const range = buildShanghaiNaturalDayRange(businessDate);
  return formatShanghaiBusinessDate(
    new Date(range.start.getTime() + days * 24 * 60 * 60 * 1000),
  );
}

async function createGeneratedSalesOrder(baseUrl, token, overrides = {}) {
  const result = await requestJson(baseUrl, '/api/sales-orders', {
    method: 'POST',
    token,
    body: {
      orderNo: overrides.orderNo,
      orderType: overrides.orderType || 'external',
      customerId: overrides.customerId,
      customer: overrides.customer || {
        name: overrides.customerName || 'Generated Customer',
        phone: overrides.customerPhone || '13900006666',
      },
      orderDate: overrides.orderDate || '2026-06-29',
      items: overrides.items || [
        {
          productName: 'Generated Product',
          quantity: 1,
          unitPriceCents: 10000,
          deliveryType: 'shipping',
        },
      ],
    },
  });
  assert.equal(result.response.status, 201);
  return result.body.data.salesOrder;
}

async function createGuideFixture(baseUrl, token, overrides = {}) {
  fixtureSequence += 1;
  const result = await requestJson(baseUrl, '/api/guides', {
    method: 'POST',
    token,
    body: {
      name: overrides.name || `Guide Fixture ${fixtureSequence}`,
      phone:
        overrides.phone || `13910${String(fixtureSequence).padStart(6, '0')}`,
      travelAgency: overrides.travelAgency || `Guide Agency ${fixtureSequence}`,
      remarks: overrides.remarks,
    },
  });
  assert.equal(result.response.status, 201);
  return result.body.data.guide;
}

async function createScopedTravelGroup(baseUrl, token, overrides = {}) {
  fixtureSequence += 1;
  const taster = overrides.tasterId
    ? { id: overrides.tasterId }
    : await createUser(baseUrl, token, {
        name: `Scope Taster ${fixtureSequence}`,
        username: `scope-taster-${fixtureSequence}`,
        password: 'Password123',
        role: 'taster',
      });
  const guide = await createGuideFixture(baseUrl, token, {
    name: `Scope Guide ${fixtureSequence}`,
    travelAgency: `Scope Snapshot Agency ${fixtureSequence}`,
  });
  const result = await requestJson(baseUrl, '/api/travel-groups', {
    method: 'POST',
    token,
    body: {
      groupNo: overrides.groupNo || `CLIENT-SCOPE-${fixtureSequence}`,
      visitDate: overrides.visitDate || '2026-06-24',
      travelAgency: overrides.travelAgency || 'Scope Input Agency',
      licensePlate:
        overrides.licensePlate ||
        `GZA${String(fixtureSequence).padStart(5, '0')}`,
      guideId: guide.id,
      guestCount: overrides.guestCount ?? 12,
      tastingRoomNo: overrides.tastingRoomNo || 'Scope Room',
      tasterId: taster.id,
      groupType: overrides.groupType || '其他',
      arrivalTime: overrides.arrivalTime ?? '09:00',
      sourceRegion: overrides.sourceRegion,
      ageInfo: overrides.ageInfo,
      mentionedFeitian: overrides.mentionedFeitian,
      previousStopOrderStatus: overrides.previousStopOrderStatus,
      keyCustomerInfo: overrides.keyCustomerInfo,
      liaisonTasterId: overrides.liaisonTasterId,
      expectedArrivalTime: overrides.expectedArrivalTime,
      cigaretteFeeCents: overrides.cigaretteFeeCents ?? 100,
      tastingItems: overrides.tastingItems,
    },
  });
  assert.equal(result.response.status, 201);
  return result.body.data.travelGroup;
}

async function createScopedSalesOrder(baseUrl, token, overrides) {
  const body = {
    orderNo: overrides.orderNo,
    orderType: 'travel_group',
    travelGroupId: overrides.travelGroupId,
    customer: {
      name: overrides.customerName || 'Scope Customer',
      phone: overrides.customerPhone || '13900009999',
    },
    orderDate: '2026-06-24',
    items: [
      {
        productName: 'Scope Product',
        quantity: 1,
        unitPriceCents: 10000,
        deliveryType: 'shipping',
      },
    ],
  };
  if (overrides.salesUserId !== undefined) {
    body.salesUserId = overrides.salesUserId;
  }

  const result = await requestJson(baseUrl, '/api/sales-orders', {
    method: 'POST',
    token,
    body,
  });
  assert.equal(result.response.status, 201);
  return result.body.data.salesOrder;
}

async function createCustomerFixture(baseUrl, token, overrides = {}) {
  const result = await requestJson(baseUrl, '/api/customers', {
    method: 'POST',
    token,
    body: {
      name: overrides.name || 'Customer Fixture',
      phone: overrides.phone,
      province: overrides.province,
      city: overrides.city,
      district: overrides.district,
      address: overrides.address,
      notes: overrides.notes,
    },
  });
  assert.equal(result.response.status, 201);
  return result.body.data.customer;
}

async function setCustomerFinanceMark(baseUrl, token, id, financeMark) {
  const result = await requestJson(
    baseUrl,
    `/api/customers/${id}/finance-mark`,
    {
      method: 'PATCH',
      token,
      body: {
        financeMark,
      },
    },
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.customer.financeMark, financeMark);
  return result.body.data.customer;
}

async function setTravelGroupFinanceMark(baseUrl, token, id, financeMark) {
  const result = await requestJson(
    baseUrl,
    `/api/travel-groups/${id}/finance-mark`,
    {
      method: 'PATCH',
      token,
      body: {
        financeMark,
      },
    },
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.travelGroup.financeMark, financeMark);
  return result.body.data.travelGroup;
}

async function setSalesOrderFinanceMark(baseUrl, token, id, financeMark) {
  const result = await requestJson(
    baseUrl,
    `/api/sales-orders/${id}/finance-mark`,
    {
      method: 'PATCH',
      token,
      body: {
        financeMark,
      },
    },
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.salesOrder.financeMark, financeMark);
  return result.body.data.salesOrder;
}

async function configureDefaultPaymentMethodServiceFeeRate(
  baseUrl,
  token,
) {
  const result = await requestJson(
    baseUrl,
    '/api/payment-methods/00000000-0000-4000-8000-000000000001',
    {
      method: 'PATCH',
      token,
      body: {
        serviceFeeRate: '0.000000',
      },
    },
  );
  assert.equal(result.response.status, 200);
}

function assertBusinessOperationLog(log, expected) {
  assertOperationLogContract(log);
  assert.equal(log.action, expected.action);
  assert.equal(log.entityType, expected.entityType);
  assert.equal(log.entityId, expected.entityId);
  assert.equal(log.userId, expected.userId);
  assert.equal(typeof log.ipAddress, 'string');
  assert.ok(log.ipAddress.length > 0);
  assert.ok(log.beforeData);
  assert.ok(log.afterData);
  assertNoSensitiveLogData(log);
}

function assertNoSensitiveLogData(value) {
  const serialized = JSON.stringify(value);
  assert.equal(/password|token/i.test(serialized), false);
}

function assertNoShippedFields(value) {
  const serialized = JSON.stringify(value);
  assert.equal(
    /shippedAt|shippedById|shipped_at|shipped_by_id/.test(serialized),
    false,
  );
}

function assertSalesOrderDtoPhase4(order) {
  for (const internalField of [
    'fulfillmentWarehouseId',
    'inventoryAppliedAt',
    'inventoryPolicyVersion',
    'inventoryVersion',
    'warehouseProductStock',
    'inventoryCost',
  ]) {
    assert.equal(
      Object.hasOwn(order, internalField),
      false,
      `ordinary sales order DTO must not expose ${internalField}`,
    );
  }
  for (const key of [
    'id',
    'orderNo',
    'orderType',
    'travelGroupId',
    'travelGroup',
    'customerId',
    'customer',
    'customerName',
    'customerPhone',
    'province',
    'city',
    'district',
    'address',
    'orderDate',
    'salesFormNo',
    'totalAmountCents',
    'entryAmountCents',
    'tasterCommissionCents',
    'tasterCommission',
    'tasterId',
    'tasterName',
    'cashOnDeliveryAmountCents',
    'deliverySummary',
    'logisticsMethod',
    'packingStatus',
    'packageCount',
    'warehouseRemark',
    'hasPackingMark',
    'logisticsNo',
    'logisticsFeeCents',
    'invoiceRequired',
    'invoiceIssued',
    'financeRemark',
    'status',
    'financeMark',
    'items',
  ]) {
    assert.ok(
      Object.hasOwn(order, key),
      `sales order DTO should include ${key}`,
    );
  }
  assertNoShippedFields(order);
  assert.equal(Array.isArray(order.items), true);
  if (order.customer !== null) {
    for (const key of ['id', 'name', 'phone', 'financeMark']) {
      assert.ok(
        Object.hasOwn(order.customer, key),
        `sales order customer DTO should include ${key}`,
      );
    }
  }
  for (const item of order.items) {
    for (const internalField of [
      'inventoryLineKey',
      'onHandQty',
      'availableQty',
      'shortageQty',
      'purchaseUnitCostCents',
      'inventoryAmountCents',
    ]) {
      assert.equal(
        Object.hasOwn(item, internalField),
        false,
        `ordinary sales order item DTO must not expose ${internalField}`,
      );
    }
    for (const key of [
      'id',
      'productName',
      'quantity',
      'unitPriceCents',
      'subtotalCents',
      'deliveryType',
      'notes',
      'sortOrder',
    ]) {
      assert.ok(
        Object.hasOwn(item, key),
        `sales order item DTO should include ${key}`,
      );
    }
  }
}

function assertSalesOrderDtoStableEqual(actual, expected) {
  for (const key of [
    'id',
    'orderNo',
    'orderType',
    'travelGroupId',
    'customerId',
    'customerName',
    'customerPhone',
    'province',
    'city',
    'district',
    'address',
    'orderDate',
    'salesFormNo',
    'totalAmountCents',
    'entryAmountCents',
    'tasterCommissionCents',
    'tasterCommission',
    'tasterId',
    'tasterName',
    'cashOnDeliveryAmountCents',
    'deliverySummary',
    'logisticsMethod',
    'packingStatus',
    'packageCount',
    'warehouseRemark',
    'hasPackingMark',
    'logisticsNo',
    'logisticsFeeCents',
    'invoiceRequired',
    'invoiceIssued',
    'financeRemark',
    'status',
    'financeMark',
    'salesUserId',
  ]) {
    assert.deepEqual(actual[key], expected[key], key);
  }
  assert.deepEqual(actual.customer, expected.customer, 'customer');
  assert.deepEqual(actual.items, expected.items, 'items');
  assert.equal(
    actual.travelGroup?.id || null,
    expected.travelGroup?.id || null,
  );
}

async function fetchPendingByGroupNo(baseUrl, token, groupNo) {
  const result = await requestJson(
    baseUrl,
    `/api/pending-travel-groups?groupNo=${encodeURIComponent(groupNo)}`,
    {
      token,
    },
  );
  assert.equal(result.response.status, 200);
  return result.body.data.pendingTravelGroups;
}

function assertTravelGroupDtoCore(group) {
  for (const key of [
    'groupNo',
    'visitDate',
    'travelAgency',
    'licensePlate',
    'guideName',
    'guidePhone',
    'adultCount',
    'childCount',
    'guestCount',
    'tastingRoomNo',
    'tasterName',
    'sourceRegion',
    'ageInfo',
    'mentionedFeitian',
    'previousStopOrderStatus',
    'keyCustomerInfo',
    'keyCustomerPhotos',
    'guestInfoAttachments',
    'liaisonTasterId',
    'liaisonTasterName',
    'liaisonTaster',
    'expectedArrivalTime',
    'arrivalTime',
    'groupType',
    'departureTime',
    'remarks',
    'status',
    'parkingFeeCents',
    'cigaretteFeeCents',
    'salesAmountCents',
    'paidDepositCents',
    'cashOnDeliveryCents',
    'liquorCostDeductionCents',
    'orderAmountCents',
    'points',
    'returnedPoints',
    'unreturnedPoints',
    'financeMark',
    'markedById',
    'markedAt',
    'guideId',
    'tasterId',
    'tasterSummary',
    'tasterSummaryAt',
    'tasterEditCount',
    'tasterEditLimit',
    'tasterEditRemaining',
    'tasterEditUnlimited',
    'tastingItems',
    'guide',
    'taster',
    'salesOrders',
    'orderSummary',
    'pendingStatus',
    'pendingReasons',
  ]) {
    assert.ok(
      Object.hasOwn(group, key),
      `travel group DTO should include ${key}`,
    );
  }
  assert.equal(typeof group.groupNo, 'string');
  assert.equal(typeof group.visitDate, 'string');
  assert.equal(typeof group.adultCount, 'number');
  assert.equal(typeof group.childCount, 'number');
  assert.equal(typeof group.guestCount, 'number');
  assert.equal(group.guestCount, group.adultCount + group.childCount);
  assert.equal(typeof group.parkingFeeCents, 'number');
  assert.ok(
    group.cigaretteFeeCents === null ||
      typeof group.cigaretteFeeCents === 'number',
  );
  assert.equal(typeof group.financeMark, 'boolean');
  assert.equal(typeof group.tasterEditCount, 'number');
  assert.equal(group.tasterEditLimit, null);
  assert.equal(group.tasterEditRemaining, null);
  assert.equal(group.tasterEditUnlimited, true);
  assert.equal(Array.isArray(group.tastingItems), true);
  assert.equal(Array.isArray(group.salesOrders), true);
  assert.equal(typeof group.orderSummary, 'object');
  assert.equal(Array.isArray(group.pendingReasons), true);
}

function assertTravelGroupDetailDto(group) {
  assertTravelGroupDtoCore(group);
  assert.equal(typeof group.guide, 'object');
  assert.equal(typeof group.guide.id, 'string');
  assert.equal(typeof group.guide.name, 'string');
  assert.equal(typeof group.guide.phone, 'string');
  assert.equal(typeof group.taster, 'object');
  assert.equal(typeof group.taster.id, 'string');
  assert.equal(typeof group.taster.name, 'string');
  assert.equal(typeof group.taster.username, 'string');
  assert.equal(typeof group.orderSummary.orderCount, 'number');
  assert.equal(typeof group.orderSummary.totalAmountCents, 'number');
  assert.equal(typeof group.orderSummary.cashOnDeliveryAmountCents, 'number');
}

function groupNos(groups) {
  return groups.map((group) => group.groupNo).sort();
}

function orderNos(orders) {
  return orders.map((order) => order.orderNo).sort();
}
