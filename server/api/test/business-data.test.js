const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  createUser,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

test('contract: business data APIs persist travel groups, orders, reconciliation, and bonus awards', async () => {
  await withPhase1Server(async (baseUrl) => {
    const missingToken = await requestJson(baseUrl, '/api/travel-groups');
    assertErrorContract(missingToken, 401, 'AUTH_TOKEN_REQUIRED');

    const admin = await login(baseUrl);
    const createdGroup = await requestJson(baseUrl, '/api/travel-groups', {
      method: 'POST',
      token: admin.token,
      body: {
        groupNo: 'GZ-TEST-001',
        visitDate: '2026-06-23',
        travelAgency: '测试旅行社',
        guideName: '测试导游',
        guidePhone: '13800001111',
        guestCount: 18,
        tastingRoomNo: '测试馆',
        tasterName: '测试品鉴师',
        groupType: 'KB团',
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
    assert.equal(createdGroup.body.data.travelGroup.groupNo, 'GZ-TEST-001');
    assert.equal(createdGroup.body.data.travelGroup.travelAgencyInfoSent, true);

    const duplicateGroup = await requestJson(baseUrl, '/api/travel-groups', {
      method: 'POST',
      token: admin.token,
      body: {
        groupNo: 'GZ-TEST-001',
        visitDate: '2026-06-23',
      },
    });
    assertErrorContract(duplicateGroup, 409, 'GROUP_NO_EXISTS');

    const groupList = await requestJson(baseUrl, '/api/travel-groups?dateFrom=2026-06-23&dateTo=2026-06-23', {
      token: admin.token,
    });
    assert.equal(groupList.response.status, 200);
    assert.equal(groupList.body.data.travelGroups.length, 1);

    const createdPendingGroup = await requestJson(baseUrl, '/api/pending-travel-groups', {
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
    });
    assert.equal(createdPendingGroup.response.status, 201);
    assert.equal(createdPendingGroup.body.data.pendingTravelGroup.groupNo, 'PD-TEST-001');

    const pendingGroupList = await requestJson(
      baseUrl,
      '/api/pending-travel-groups?dateFrom=2026-06-23&dateTo=2026-06-23',
      {
        token: admin.token,
      },
    );
    assert.equal(pendingGroupList.response.status, 200);
    assert.deepEqual(groupNos(pendingGroupList.body.data.pendingTravelGroups), ['PD-TEST-001']);

    const pendingGroupDetail = await requestJson(
      baseUrl,
      `/api/pending-travel-groups/${createdPendingGroup.body.data.pendingTravelGroup.id}`,
      {
        token: admin.token,
      },
    );
    assert.equal(pendingGroupDetail.response.status, 200);
    assert.equal(pendingGroupDetail.body.data.pendingTravelGroup.groupNo, 'PD-TEST-001');

    const createdOrder = await requestJson(baseUrl, '/api/sales-orders', {
      method: 'POST',
      token: admin.token,
      body: {
        orderNo: 'SO-TEST-001',
        orderType: 'travel_group',
        travelGroupId: createdGroup.body.data.travelGroup.id,
        customerName: '测试客户',
        customerPhone: '13900002222',
        province: '贵州省',
        city: '贵阳市',
        district: '观山湖区',
        address: '测试地址',
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
    assert.equal(createdOrder.body.data.salesOrder.totalAmountCents, 39800);
    assert.equal(createdOrder.body.data.salesOrder.items.length, 1);

    const overview = await requestJson(baseUrl, '/api/finance/overview?dateFrom=2026-06-23&dateTo=2026-06-23', {
      token: admin.token,
    });
    assert.equal(overview.response.status, 200);
    assert.equal(overview.body.data.overview.metrics.travelGroupCount, 1);
    assert.equal(overview.body.data.overview.metrics.salesAmountCents, 39800);
    assert.equal(overview.body.data.overview.recentOrders[0].orderNo, 'SO-TEST-001');

    const emptyReconciliation = await requestJson(baseUrl, '/api/reconciliations/2026-06-23', {
      token: admin.token,
    });
    assert.equal(emptyReconciliation.response.status, 200);
    assert.equal(emptyReconciliation.body.data.reconciliation.businessDate, '2026-06-23');
    assert.equal(emptyReconciliation.body.data.reconciliation.actualTotalCents, 0);

    const savedReconciliation = await requestJson(baseUrl, '/api/reconciliations/2026-06-23', {
      method: 'PUT',
      token: admin.token,
      body: {
        travelGroupSalesCents: 39800,
        backOfficeSalesCents: 10000,
        buybackCents: 0,
        externalSalesCents: 0,
        internalPurchaseCents: 0,
        afterSalesCents: 0,
        refundsCents: 800,
        otherReceivableCents: 0,
        paymentMethods: [
          { name: '现金', amountCents: 20000 },
          { name: '微信', amountCents: 28500 },
        ],
      },
    });
    assert.equal(savedReconciliation.response.status, 200);
    assert.equal(savedReconciliation.body.data.reconciliation.refundsCents, 800);
    assert.equal(savedReconciliation.body.data.reconciliation.receivableTotalCents, 49000);
    assert.equal(savedReconciliation.body.data.reconciliation.actualTotalCents, 48500);
    assert.equal(savedReconciliation.body.data.reconciliation.differenceCents, -500);

    const negativeRefundsReconciliation = await requestJson(baseUrl, '/api/reconciliations/2026-06-23', {
      method: 'PUT',
      token: admin.token,
      body: {
        businessDate: '2026-06-23',
        refundsCents: -800,
      },
    });
    assertErrorContract(negativeRefundsReconciliation, 400, 'VALIDATION_FAILED');

    const createdBonus = await requestJson(baseUrl, '/api/strike-bonus-awards', {
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
    });
    assert.equal(createdBonus.response.status, 201);
    assert.equal(createdBonus.body.data.strikeBonusAward.bonusAmountCents, 3000);

    const bonusList = await requestJson(baseUrl, '/api/strike-bonus-awards?dateFrom=2026-06-23&dateTo=2026-06-23', {
      token: admin.token,
    });
    assert.equal(bonusList.response.status, 200);
    assert.equal(bonusList.body.data.strikeBonusAwards.length, 1);
  });
});

test('contract: business data role scopes hide other users travel groups and sales orders', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
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

    const salesAlpha = await login(baseUrl, 'scope-sales-alpha', 'Password123');
    const salesBeta = await login(baseUrl, 'scope-sales-beta', 'Password123');
    const tasterAlpha = await login(baseUrl, 'scope-taster-alpha', 'Password123');
    const tasterBeta = await login(baseUrl, 'scope-taster-beta', 'Password123');

    const groupAlpha = await createScopedTravelGroup(baseUrl, admin.token, {
      groupNo: 'GZ-SCOPE-A',
      tasterId: tasterAlphaUser.id,
      tasterName: tasterAlphaUser.name,
    });
    const groupBeta = await createScopedTravelGroup(baseUrl, admin.token, {
      groupNo: 'GZ-SCOPE-B',
      tasterId: tasterBetaUser.id,
      tasterName: tasterBetaUser.name,
    });

    const createdByAlpha = await createScopedSalesOrder(baseUrl, salesAlpha.token, {
      orderNo: 'SO-SCOPE-CREATED',
      travelGroupId: groupAlpha.id,
    });
    const assignedToAlpha = await createScopedSalesOrder(baseUrl, admin.token, {
      orderNo: 'SO-SCOPE-ASSIGNED',
      travelGroupId: groupAlpha.id,
      salesUserId: salesAlphaUser.id,
    });
    const createdByBeta = await createScopedSalesOrder(baseUrl, salesBeta.token, {
      orderNo: 'SO-SCOPE-BETA',
      travelGroupId: groupBeta.id,
    });

    assert.equal(createdByAlpha.salesUserId, salesAlphaUser.id);
    assert.equal(assignedToAlpha.salesUserId, salesAlphaUser.id);
    assert.equal(createdByBeta.salesUserId, salesBetaUser.id);

    const alphaTasterGroups = await requestJson(baseUrl, '/api/travel-groups', {
      token: tasterAlpha.token,
    });
    assert.equal(alphaTasterGroups.response.status, 200);
    assert.deepEqual(groupNos(alphaTasterGroups.body.data.travelGroups), ['GZ-SCOPE-A']);

    const betaTasterGroups = await requestJson(baseUrl, '/api/travel-groups', {
      token: tasterBeta.token,
    });
    assert.equal(betaTasterGroups.response.status, 200);
    assert.deepEqual(groupNos(betaTasterGroups.body.data.travelGroups), ['GZ-SCOPE-B']);

    const tasterBlockedDetail = await requestJson(baseUrl, `/api/travel-groups/${groupBeta.id}`, {
      token: tasterAlpha.token,
    });
    assertErrorContract(tasterBlockedDetail, 404, 'TRAVEL_GROUP_NOT_FOUND');

    const alphaSalesGroups = await requestJson(baseUrl, '/api/travel-groups', {
      token: salesAlpha.token,
    });
    assert.equal(alphaSalesGroups.response.status, 200);
    assert.deepEqual(groupNos(alphaSalesGroups.body.data.travelGroups), ['GZ-SCOPE-A']);

    const salesBlockedGroupDetail = await requestJson(baseUrl, `/api/travel-groups/${groupBeta.id}`, {
      token: salesAlpha.token,
    });
    assertErrorContract(salesBlockedGroupDetail, 404, 'TRAVEL_GROUP_NOT_FOUND');

    const alphaOrders = await requestJson(baseUrl, '/api/sales-orders', {
      token: salesAlpha.token,
    });
    assert.equal(alphaOrders.response.status, 200);
    assert.deepEqual(orderNos(alphaOrders.body.data.salesOrders), ['SO-SCOPE-ASSIGNED', 'SO-SCOPE-CREATED']);

    const betaOrders = await requestJson(baseUrl, '/api/sales-orders', {
      token: salesBeta.token,
    });
    assert.equal(betaOrders.response.status, 200);
    assert.deepEqual(orderNos(betaOrders.body.data.salesOrders), ['SO-SCOPE-BETA']);

    const assignedDetail = await requestJson(baseUrl, `/api/sales-orders/${assignedToAlpha.id}`, {
      token: salesAlpha.token,
    });
    assert.equal(assignedDetail.response.status, 200);
    assert.equal(assignedDetail.body.data.salesOrder.orderNo, 'SO-SCOPE-ASSIGNED');

    const salesBlockedOrderDetail = await requestJson(baseUrl, `/api/sales-orders/${createdByBeta.id}`, {
      token: salesAlpha.token,
    });
    assertErrorContract(salesBlockedOrderDetail, 404, 'SALES_ORDER_NOT_FOUND');

    const betaBlockedAssignedDetail = await requestJson(baseUrl, `/api/sales-orders/${assignedToAlpha.id}`, {
      token: salesBeta.token,
    });
    assertErrorContract(betaBlockedAssignedDetail, 404, 'SALES_ORDER_NOT_FOUND');

    const adminOrders = await requestJson(baseUrl, '/api/sales-orders', {
      token: admin.token,
    });
    assert.equal(adminOrders.response.status, 200);
    assert.deepEqual(orderNos(adminOrders.body.data.salesOrders), [
      'SO-SCOPE-ASSIGNED',
      'SO-SCOPE-BETA',
      'SO-SCOPE-CREATED',
    ]);
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
          customerName: 'Rollback Customer',
          customerPhone: '13900001111',
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

      const groupDetail = await requestJson(baseUrl, `/api/travel-groups/${group.id}`, {
        token: admin.token,
      });
      assert.equal(groupDetail.response.status, 200);
      assert.equal(groupDetail.body.data.travelGroup.status, 'unmarked');
      assert.equal(groupDetail.body.data.travelGroup.salesAmountCents, 0);
      assert.equal(groupDetail.body.data.travelGroup.orderAmountCents, 0);
      assert.equal(groupDetail.body.data.travelGroup.cashOnDeliveryCents, 0);

      const logs = await requestJson(baseUrl, '/api/operation-logs?action=sales_orders.create', {
        token: admin.token,
      });
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

    const markedGroup = await createScopedTravelGroup(baseUrl, admin.token, {
      groupNo: 'GZ-MARK-YES',
    });
    const unmarkedGroup = await createScopedTravelGroup(baseUrl, admin.token, {
      groupNo: 'GZ-MARK-NO',
    });

    const markedOrder = await createScopedSalesOrder(baseUrl, admin.token, {
      orderNo: 'SO-MARK-YES',
      travelGroupId: markedGroup.id,
    });
    const unmarkedOrder = await createScopedSalesOrder(baseUrl, admin.token, {
      orderNo: 'SO-MARK-ORDER-NO',
      travelGroupId: markedGroup.id,
    });
    const markedOrderWithUnmarkedGroup = await createScopedSalesOrder(baseUrl, admin.token, {
      orderNo: 'SO-MARK-GROUP-NO',
      travelGroupId: unmarkedGroup.id,
    });

    await setTravelGroupFinanceMark(baseUrl, admin.token, markedGroup.id, true);
    await setSalesOrderFinanceMark(baseUrl, admin.token, markedOrder.id, true);
    await setSalesOrderFinanceMark(baseUrl, admin.token, markedOrderWithUnmarkedGroup.id, true);

    const beforeEnableGroups = await requestJson(baseUrl, '/api/travel-groups', {
      token: admin.token,
    });
    assert.equal(beforeEnableGroups.response.status, 200);
    assert.deepEqual(groupNos(beforeEnableGroups.body.data.travelGroups), ['GZ-MARK-NO', 'GZ-MARK-YES']);

    const beforeEnableOrders = await requestJson(baseUrl, '/api/sales-orders', {
      token: admin.token,
    });
    assert.equal(beforeEnableOrders.response.status, 200);
    assert.deepEqual(orderNos(beforeEnableOrders.body.data.salesOrders), [
      'SO-MARK-GROUP-NO',
      'SO-MARK-ORDER-NO',
      'SO-MARK-YES',
    ]);

    const enabled = await requestJson(baseUrl, '/api/settings/global-mark-query/enable', {
      method: 'POST',
      token: admin.token,
    });
    assert.equal(enabled.response.status, 200);
    assert.equal(enabled.body.data.settings.onlyShowMarkedRecords, true);

    const markedGroupsOnly = await requestJson(baseUrl, '/api/travel-groups', {
      token: admin.token,
    });
    assert.equal(markedGroupsOnly.response.status, 200);
    assert.deepEqual(groupNos(markedGroupsOnly.body.data.travelGroups), ['GZ-MARK-YES']);

    const hiddenGroupDetail = await requestJson(baseUrl, `/api/travel-groups/${unmarkedGroup.id}`, {
      token: admin.token,
    });
    assertErrorContract(hiddenGroupDetail, 404, 'TRAVEL_GROUP_NOT_FOUND');

    const markedOrdersOnly = await requestJson(baseUrl, '/api/sales-orders', {
      token: admin.token,
    });
    assert.equal(markedOrdersOnly.response.status, 200);
    assert.deepEqual(orderNos(markedOrdersOnly.body.data.salesOrders), ['SO-MARK-YES']);

    const hiddenUnmarkedOrderDetail = await requestJson(baseUrl, `/api/sales-orders/${unmarkedOrder.id}`, {
      token: admin.token,
    });
    assertErrorContract(hiddenUnmarkedOrderDetail, 404, 'SALES_ORDER_NOT_FOUND');

    const hiddenUnmarkedGroupOrderDetail = await requestJson(
      baseUrl,
      `/api/sales-orders/${markedOrderWithUnmarkedGroup.id}`,
      {
        token: admin.token,
      },
    );
    assertErrorContract(hiddenUnmarkedGroupOrderDetail, 404, 'SALES_ORDER_NOT_FOUND');

    const markedOverview = await requestJson(baseUrl, '/api/finance/overview?dateFrom=2026-06-24&dateTo=2026-06-24', {
      token: admin.token,
    });
    assert.equal(markedOverview.response.status, 200);
    assert.equal(markedOverview.body.data.overview.metrics.travelGroupCount, 1);
    assert.equal(markedOverview.body.data.overview.metrics.orderCount, 1);
    assert.equal(markedOverview.body.data.overview.metrics.salesAmountCents, 10000);

    const restored = await requestJson(baseUrl, '/api/settings/global-mark-query/restore', {
      method: 'POST',
      token: admin.token,
    });
    assert.equal(restored.response.status, 200);
    assert.equal(restored.body.data.settings.onlyShowMarkedRecords, false);

    const restoredGroups = await requestJson(baseUrl, '/api/travel-groups', {
      token: admin.token,
    });
    assert.equal(restoredGroups.response.status, 200);
    assert.deepEqual(groupNos(restoredGroups.body.data.travelGroups), ['GZ-MARK-NO', 'GZ-MARK-YES']);

    const restoredOrders = await requestJson(baseUrl, '/api/sales-orders', {
      token: admin.token,
    });
    assert.equal(restoredOrders.response.status, 200);
    assert.deepEqual(orderNos(restoredOrders.body.data.salesOrders), [
      'SO-MARK-GROUP-NO',
      'SO-MARK-ORDER-NO',
      'SO-MARK-YES',
    ]);
  });
});

async function createScopedTravelGroup(baseUrl, token, overrides) {
  const result = await requestJson(baseUrl, '/api/travel-groups', {
    method: 'POST',
    token,
    body: {
      groupNo: overrides.groupNo,
      visitDate: '2026-06-24',
      travelAgency: 'Scope Agency',
      guideName: 'Scope Guide',
      guestCount: 12,
      tasterId: overrides.tasterId,
      tasterName: overrides.tasterName,
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
    customerName: 'Scope Customer',
    customerPhone: '13900009999',
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

async function setTravelGroupFinanceMark(baseUrl, token, id, financeMark) {
  const result = await requestJson(baseUrl, `/api/travel-groups/${id}/finance-mark`, {
    method: 'PATCH',
    token,
    body: {
      financeMark,
    },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.travelGroup.financeMark, financeMark);
  return result.body.data.travelGroup;
}

async function setSalesOrderFinanceMark(baseUrl, token, id, financeMark) {
  const result = await requestJson(baseUrl, `/api/sales-orders/${id}/finance-mark`, {
    method: 'PATCH',
    token,
    body: {
      financeMark,
    },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.salesOrder.financeMark, financeMark);
  return result.body.data.salesOrder;
}

function groupNos(groups) {
  return groups.map((group) => group.groupNo).sort();
}

function orderNos(orders) {
  return orders.map((order) => order.orderNo).sort();
}
