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
    const taster = await createUser(baseUrl, admin.token, {
      name: 'Business Taster',
      username: 'business-taster',
      password: 'Password123',
      role: 'taster',
    });
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
        tastingRoomNo: 'Business Room',
        tasterId: taster.id,
        groupType: 'business',
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
    assert.equal(createdGroup.body.data.travelGroup.travelAgency, guide.travelAgency);
    assert.equal(createdGroup.body.data.travelGroup.guideName, guide.name);
    assert.equal(createdGroup.body.data.travelGroup.guidePhone, guide.phone);
    assert.equal(createdGroup.body.data.travelGroup.travelAgencyInfoSent, true);
    assertTravelGroupDtoCore(createdGroup.body.data.travelGroup);
    assert.deepEqual(createdGroup.body.data.travelGroup.tastingItems, []);
    assert.equal(createdGroup.body.data.travelGroup.tasterSummary, null);
    assert.equal(createdGroup.body.data.travelGroup.tasterSummaryAt, null);
    assert.equal(createdGroup.body.data.travelGroup.pendingStatus, 'pending_taster');
    assert.ok(createdGroup.body.data.travelGroup.pendingReasons.includes('no_order_and_missing_taster_summary'));

    const groupList = await requestJson(baseUrl, '/api/travel-groups?dateFrom=2026-06-23&dateTo=2026-06-23', {
      token: admin.token,
    });
    assert.equal(groupList.response.status, 200);
    assert.equal(groupList.body.data.travelGroups.length, 1);
    assertTravelGroupDtoCore(groupList.body.data.travelGroups[0]);
    assert.deepEqual(groupList.body.data.travelGroups[0].tastingItems, []);

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
    assert.deepEqual(groupNos(pendingGroupList.body.data.pendingTravelGroups), [createdGroup.body.data.travelGroup.groupNo]);

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
    const guide = await createGuideFixture(baseUrl, admin.token, {
      name: 'Snapshot Guide',
      phone: '13910000002',
      travelAgency: 'Snapshot Agency',
    });
    const frontDesk = await login(baseUrl, frontDeskUser.username, 'Password123');
    const sales = await login(baseUrl, salesUser.username, 'Password123');

    const validBody = (overrides = {}) => ({
      groupNo: 'CLIENT-SHOULD-BE-IGNORED',
      visitDate: '2026-06-25',
      travelAgency: 'Client Input Agency',
      licensePlate: 'GZA88888',
      guideId: guide.id,
      guestCount: 16,
      tastingRoomNo: 'Room 8',
      tasterId: taster.id,
      groupType: 'standard',
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
      token: frontDesk.token,
      body: validBody(),
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.data.travelGroup.groupNo, 'TG20260625001');
    assert.notEqual(created.body.data.travelGroup.groupNo, 'CLIENT-SHOULD-BE-IGNORED');
    assert.equal(created.body.data.travelGroup.guideId, guide.id);
    assert.equal(created.body.data.travelGroup.guideName, guide.name);
    assert.equal(created.body.data.travelGroup.guidePhone, guide.phone);
    assert.equal(created.body.data.travelGroup.travelAgency, guide.travelAgency);
    assert.equal(created.body.data.travelGroup.tasterId, taster.id);
    assert.equal(created.body.data.travelGroup.tasterName, taster.name);
    assertTravelGroupDtoCore(created.body.data.travelGroup);
    assert.equal(created.body.data.travelGroup.pendingStatus, 'pending_taster');
    assert.ok(created.body.data.travelGroup.pendingReasons.includes('no_order_and_missing_taster_summary'));
    assert.equal(created.body.data.travelGroup.tasterSummary, null);
    assert.equal(created.body.data.travelGroup.tasterSummaryAt, null);
    assert.deepEqual(
      created.body.data.travelGroup.tastingItems.map((item) => item.productName),
      ['Tasting Product B', 'Tasting Product A'],
    );

    const second = await requestJson(baseUrl, '/api/travel-groups', {
      method: 'POST',
      token: admin.token,
      body: validBody(),
    });
    assert.equal(second.response.status, 201);
    assert.equal(second.body.data.travelGroup.groupNo, 'TG20260625002');

    const missingRequired = await requestJson(baseUrl, '/api/travel-groups', {
      method: 'POST',
      token: admin.token,
      body: validBody({ tastingRoomNo: '' }),
    });
    assertErrorContract(missingRequired, 400, 'VALIDATION_FAILED');

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

    const salesCreate = await requestJson(baseUrl, '/api/travel-groups', {
      method: 'POST',
      token: sales.token,
      body: validBody(),
    });
    assertErrorContract(salesCreate, 403, 'PERMISSION_DENIED');

    const detail = await requestJson(baseUrl, `/api/travel-groups/${created.body.data.travelGroup.id}`, {
      token: admin.token,
    });
    assert.equal(detail.response.status, 200);
    assertTravelGroupDtoCore(detail.body.data.travelGroup);
    assert.deepEqual(
      detail.body.data.travelGroup.tastingItems.map((item) => [item.productName, item.quantity, item.sortOrder]),
      [
        ['Tasting Product B', 1, 1],
        ['Tasting Product A', 2, 2],
      ],
    );

    const logs = await requestJson(baseUrl, '/api/operation-logs?action=travel_groups.create', {
      token: admin.token,
    });
    assert.equal(logs.response.status, 200);
    assert.equal(logs.body.data.logs.length, 2);
    assert.deepEqual(
      logs.body.data.logs[0].afterData.tastingItems.map((item) => item.productName),
      ['Tasting Product B', 'Tasting Product A'],
    );
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
    const frontDesk = await login(baseUrl, frontDeskUser.username, 'Password123');
    const sales = await login(baseUrl, salesUser.username, 'Password123');
    const finance = await login(baseUrl, financeUser.username, 'Password123');
    const tasterOne = await login(baseUrl, tasterOneUser.username, 'Password123');
    const tasterTwo = await login(baseUrl, tasterTwoUser.username, 'Password123');
    const warehouse = await login(baseUrl, warehouseUser.username, 'Password123');
    const afterSales = await login(baseUrl, afterSalesUser.username, 'Password123');

    const group = await createScopedTravelGroup(baseUrl, frontDesk.token, {
      tasterId: tasterOneUser.id,
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
      token: sales.token,
      body: {
        orderNo: 'SO-PATCH-SALES',
        orderType: 'travel_group',
        travelGroupId: group.id,
        customerName: 'Patch Customer',
        orderDate: '2026-06-25',
        totalAmountCents: 8800,
      },
    });
    assert.equal(relatedOrder.response.status, 201);

    const adminGuide = await createGuideFixture(baseUrl, admin.token, {
      name: 'Patch Admin Guide',
      phone: '13920000001',
      travelAgency: 'Patch Admin Agency',
    });
    const adminPatch = await requestJson(baseUrl, `/api/travel-groups/${group.id}`, {
      method: 'PATCH',
      token: admin.token,
      body: {
        guideId: adminGuide.id,
        tasterId: tasterTwoUser.id,
        guestCount: 21,
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
    });
    assert.equal(adminPatch.response.status, 200);
    assert.equal(adminPatch.body.data.travelGroup.guideId, adminGuide.id);
    assert.equal(adminPatch.body.data.travelGroup.guideName, adminGuide.name);
    assert.equal(adminPatch.body.data.travelGroup.travelAgency, adminGuide.travelAgency);
    assert.equal(adminPatch.body.data.travelGroup.tasterId, tasterTwoUser.id);
    assert.equal(adminPatch.body.data.travelGroup.tasterName, tasterTwoUser.name);
    assert.deepEqual(
      adminPatch.body.data.travelGroup.tastingItems.map((item) => item.productName),
      ['Patch Admin Item'],
    );

    const frontDeskGuide = await createGuideFixture(baseUrl, frontDesk.token, {
      name: 'Patch Front Desk Guide',
      phone: '13920000002',
      travelAgency: 'Patch Front Desk Agency',
    });
    const frontDeskPatch = await requestJson(baseUrl, `/api/travel-groups/${group.id}`, {
      method: 'PATCH',
      token: frontDesk.token,
      body: {
        guideId: frontDeskGuide.id,
        travelAgency: 'Client Agency Should Not Win',
        arrivalTime: '09:45',
        tastingItems: [
          {
            productName: 'Patch Front Desk Item',
            quantity: 2,
            unit: 'bottle',
            sortOrder: 1,
          },
        ],
      },
    });
    assert.equal(frontDeskPatch.response.status, 200);
    assert.equal(frontDeskPatch.body.data.travelGroup.guideName, frontDeskGuide.name);
    assert.equal(frontDeskPatch.body.data.travelGroup.travelAgency, frontDeskGuide.travelAgency);
    assert.equal(frontDeskPatch.body.data.travelGroup.arrivalTime, '09:45');
    assert.deepEqual(
      frontDeskPatch.body.data.travelGroup.tastingItems.map((item) => item.productName),
      ['Patch Front Desk Item'],
    );

    const frontDeskDenied = await requestJson(baseUrl, `/api/travel-groups/${group.id}`, {
      method: 'PATCH',
      token: frontDesk.token,
      body: {
        departureTime: '12:00',
      },
    });
    assertErrorContract(frontDeskDenied, 403, 'FIELD_PERMISSION_DENIED');

    const salesPatch = await requestJson(baseUrl, `/api/travel-groups/${group.id}`, {
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
    });
    assert.equal(salesPatch.response.status, 200);
    assert.equal(salesPatch.body.data.travelGroup.guestCount, 22);
    assert.equal(salesPatch.body.data.travelGroup.departureTime, '12:20');
    assert.equal(salesPatch.body.data.travelGroup.remarks, 'sales note');
    assert.deepEqual(
      salesPatch.body.data.travelGroup.tastingItems.map((item) => item.productName),
      ['Patch Sales Item', 'Patch Sales Item B'],
    );

    const salesDenied = await requestJson(baseUrl, `/api/travel-groups/${group.id}`, {
      method: 'PATCH',
      token: sales.token,
      body: {
        visitDate: '2026-06-26',
      },
    });
    assertErrorContract(salesDenied, 403, 'FIELD_PERMISSION_DENIED');

    const tasterPatch = await requestJson(baseUrl, `/api/travel-groups/${group.id}`, {
      method: 'PATCH',
      token: tasterTwo.token,
      body: {
        guestCount: 23,
        tasterSummary: 'Guests preferred sauce aroma.',
        wineDetails: 'Tasted product notes.',
      },
    });
    assert.equal(tasterPatch.response.status, 200);
    assert.equal(tasterPatch.body.data.travelGroup.guestCount, 23);
    assert.equal(tasterPatch.body.data.travelGroup.tasterSummary, 'Guests preferred sauce aroma.');
    assert.equal(typeof tasterPatch.body.data.travelGroup.tasterSummaryAt, 'string');
    assert.equal(tasterPatch.body.data.travelGroup.wineDetails, 'Tasted product notes.');

    const tasterDenied = await requestJson(baseUrl, `/api/travel-groups/${group.id}`, {
      method: 'PATCH',
      token: tasterTwo.token,
      body: {
        remarks: 'taster should not edit generic remarks',
      },
    });
    assertErrorContract(tasterDenied, 403, 'FIELD_PERMISSION_DENIED');

    const tasterWrongGroup = await requestJson(baseUrl, `/api/travel-groups/${group.id}`, {
      method: 'PATCH',
      token: tasterOne.token,
      body: {
        guestCount: 24,
      },
    });
    assertErrorContract(tasterWrongGroup, 404, 'TRAVEL_GROUP_NOT_FOUND');

    const financePatch = await requestJson(baseUrl, `/api/travel-groups/${group.id}`, {
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
    });
    assert.equal(financePatch.response.status, 200);
    assert.equal(financePatch.body.data.travelGroup.liquorCostDeductionCents, 500);
    assert.equal(financePatch.body.data.travelGroup.returnedPoints, 3);
    assert.equal(financePatch.body.data.travelGroup.travelAgencyInfoSent, true);
    assert.equal(financePatch.body.data.travelGroup.remarks, 'finance note');

    const financeDenied = await requestJson(baseUrl, `/api/travel-groups/${group.id}`, {
      method: 'PATCH',
      token: finance.token,
      body: {
        financeMark: true,
      },
    });
    assertErrorContract(financeDenied, 403, 'FIELD_PERMISSION_DENIED');

    for (const actor of [boss, warehouse, afterSales]) {
      const denied = await requestJson(baseUrl, `/api/travel-groups/${group.id}`, {
        method: 'PATCH',
        token: actor.token,
        body: {
          guestCount: 99,
        },
      });
      assertErrorContract(denied, 403, 'PERMISSION_DENIED');
    }

    await setTravelGroupFinanceMark(baseUrl, admin.token, group.id, true);
    const postMarkPatch = await requestJson(baseUrl, `/api/travel-groups/${group.id}`, {
      method: 'PATCH',
      token: finance.token,
      body: {
        points: 66,
        remarks: 'post mark finance edit',
      },
    });
    assert.equal(postMarkPatch.response.status, 200);
    assert.equal(postMarkPatch.body.data.travelGroup.financeMark, true);
    assert.equal(postMarkPatch.body.data.travelGroup.points, 66);

    const logs = await requestJson(baseUrl, '/api/operation-logs?action=travel_groups.update', {
      token: admin.token,
    });
    assert.equal(logs.response.status, 200);
    const postMarkLog = logs.body.data.logs.find(
      (log) => log.entityId === group.id && log.afterData?.remarks === 'post mark finance edit',
    );
    assert.ok(postMarkLog);
    assert.equal(postMarkLog.beforeData.financeMark, true);
    assert.equal(postMarkLog.afterData.financeMark, true);
    assert.equal(postMarkLog.beforeData.points, 10);
    assert.equal(postMarkLog.afterData.points, 66);
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
    const frontDesk = await login(baseUrl, frontDeskUser.username, 'Password123');
    const sales = await login(baseUrl, salesUser.username, 'Password123');
    const taster = await login(baseUrl, tasterUser.username, 'Password123');
    const warehouse = await login(baseUrl, warehouseUser.username, 'Password123');
    const afterSales = await login(baseUrl, afterSalesUser.username, 'Password123');

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

    const beforeDetail = await requestJson(baseUrl, `/api/travel-groups/${group.id}`, {
      token: admin.token,
    });
    assert.equal(beforeDetail.response.status, 200);
    const before = beforeDetail.body.data.travelGroup;
    assert.equal(before.financeMark, false);

    const deniedActors = [boss, frontDesk, sales, taster, warehouse, afterSales];
    for (const actor of deniedActors) {
      const denied = await requestJson(baseUrl, `/api/travel-groups/${group.id}/finance-mark`, {
        method: 'PATCH',
        token: actor.token,
        body: {
          financeMark: true,
        },
      });
      assertErrorContract(denied, 403, 'PERMISSION_DENIED');
    }

    const adminMark = await requestJson(baseUrl, `/api/travel-groups/${group.id}/finance-mark`, {
      method: 'PATCH',
      token: admin.token,
      body: {
        financeMark: true,
        guestCount: 99,
        remarks: 'should not be updated by finance mark',
      },
    });
    assert.equal(adminMark.response.status, 200);
    assert.equal(adminMark.body.data.travelGroup.financeMark, true);
    assert.equal(adminMark.body.data.travelGroup.markedById, admin.user.id);
    assert.equal(typeof adminMark.body.data.travelGroup.markedAt, 'string');
    assert.equal(adminMark.body.data.travelGroup.guestCount, before.guestCount);
    assert.equal(adminMark.body.data.travelGroup.remarks, before.remarks);
    assert.deepEqual(
      adminMark.body.data.travelGroup.tastingItems.map((item) => item.productName),
      ['Finance Mark Item'],
    );

    const markedDetail = await requestJson(baseUrl, `/api/travel-groups/${group.id}`, {
      token: admin.token,
    });
    assert.equal(markedDetail.response.status, 200);
    assert.equal(markedDetail.body.data.travelGroup.financeMark, true);
    assert.equal(markedDetail.body.data.travelGroup.markedById, admin.user.id);

    const markedList = await requestJson(baseUrl, '/api/travel-groups?financeMark=true', {
      token: admin.token,
    });
    assert.equal(markedList.response.status, 200);
    assert.deepEqual(groupNos(markedList.body.data.travelGroups), [group.groupNo]);

    const financeUnmark = await requestJson(baseUrl, `/api/travel-groups/${group.id}/finance-mark`, {
      method: 'PATCH',
      token: finance.token,
      body: {
        financeMark: false,
      },
    });
    assert.equal(financeUnmark.response.status, 200);
    assert.equal(financeUnmark.body.data.travelGroup.financeMark, false);
    assert.equal(financeUnmark.body.data.travelGroup.markedById, null);
    assert.equal(financeUnmark.body.data.travelGroup.markedAt, null);
    assert.equal(financeUnmark.body.data.travelGroup.guestCount, before.guestCount);
    assert.equal(financeUnmark.body.data.travelGroup.guideName, before.guideName);

    const unmarkedList = await requestJson(baseUrl, '/api/travel-groups?financeMark=false', {
      token: admin.token,
    });
    assert.equal(unmarkedList.response.status, 200);
    assert.deepEqual(groupNos(unmarkedList.body.data.travelGroups), [group.groupNo]);

    const enableLogs = await requestJson(baseUrl, '/api/operation-logs?action=travel_groups.finance_mark.enable', {
      token: admin.token,
    });
    assert.equal(enableLogs.response.status, 200);
    const enableLog = enableLogs.body.data.logs.find((log) => log.entityId === group.id);
    assert.ok(enableLog);
    assert.equal(enableLog.beforeData.financeMark, false);
    assert.equal(enableLog.afterData.financeMark, true);
    assert.equal(enableLog.afterData.markedById, admin.user.id);
    assert.equal(enableLog.afterData.guestCount, before.guestCount);
    assert.deepEqual(
      enableLog.afterData.tastingItems.map((item) => item.productName),
      ['Finance Mark Item'],
    );

    const disableLogs = await requestJson(baseUrl, '/api/operation-logs?action=travel_groups.finance_mark.disable', {
      token: admin.token,
    });
    assert.equal(disableLogs.response.status, 200);
    const disableLog = disableLogs.body.data.logs.find((log) => log.entityId === group.id);
    assert.ok(disableLog);
    assert.equal(disableLog.beforeData.financeMark, true);
    assert.equal(disableLog.afterData.financeMark, false);
    assert.equal(disableLog.afterData.markedById, null);
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

    const tasterOne = await login(baseUrl, tasterOneUser.username, 'Password123');
    const groupOne = await createScopedTravelGroup(baseUrl, admin.token, {
      tasterId: tasterOneUser.id,
    });
    const groupTwo = await createScopedTravelGroup(baseUrl, admin.token, {
      tasterId: tasterTwoUser.id,
    });

    await setTravelGroupFinanceMark(baseUrl, admin.token, groupOne.id, true);

    const tasterSubmit = await requestJson(baseUrl, `/api/travel-groups/${groupOne.id}/taster-summary`, {
      method: 'POST',
      token: tasterOne.token,
      body: {
        tasterSummary: 'Taster own summary.',
      },
    });
    assert.equal(tasterSubmit.response.status, 201);
    assert.equal(tasterSubmit.body.data.travelGroup.tasterSummary, 'Taster own summary.');
    assert.equal(typeof tasterSubmit.body.data.travelGroup.tasterSummaryAt, 'string');
    assert.equal(tasterSubmit.body.data.travelGroup.financeMark, true);
    assert.equal(tasterSubmit.body.data.travelGroup.markedById, admin.user.id);

    const tasterDenied = await requestJson(baseUrl, `/api/travel-groups/${groupTwo.id}/taster-summary`, {
      method: 'POST',
      token: tasterOne.token,
      body: {
        tasterSummary: 'Wrong group summary.',
      },
    });
    assertErrorContract(tasterDenied, 404, 'TRAVEL_GROUP_NOT_FOUND');

    const adminSubmit = await requestJson(baseUrl, `/api/travel-groups/${groupOne.id}/taster-summary`, {
      method: 'POST',
      token: admin.token,
      body: {
        tasterSummary: 'Admin revised summary.',
      },
    });
    assert.equal(adminSubmit.response.status, 201);
    assert.equal(adminSubmit.body.data.travelGroup.tasterSummary, 'Admin revised summary.');
    assert.equal(adminSubmit.body.data.travelGroup.financeMark, true);
    assert.equal(adminSubmit.body.data.travelGroup.markedById, admin.user.id);

    const detail = await requestJson(baseUrl, `/api/travel-groups/${groupOne.id}`, {
      token: admin.token,
    });
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.data.travelGroup.tasterSummary, 'Admin revised summary.');
    assert.equal(typeof detail.body.data.travelGroup.tasterSummaryAt, 'string');
    assert.equal(detail.body.data.travelGroup.financeMark, true);

    const logs = await requestJson(baseUrl, '/api/operation-logs?action=travel_groups.taster_summary.upsert', {
      token: admin.token,
    });
    assert.equal(logs.response.status, 200);
    const groupLogs = logs.body.data.logs.filter((log) => log.entityId === groupOne.id);
    assert.equal(groupLogs.length, 2);
    assert.equal(groupLogs[0].beforeData.tasterSummary, null);
    assert.equal(groupLogs[0].afterData.tasterSummary, 'Taster own summary.');
    assert.equal(groupLogs[0].beforeData.financeMark, true);
    assert.equal(groupLogs[0].afterData.financeMark, true);
    assert.equal(groupLogs[1].beforeData.tasterSummary, 'Taster own summary.');
    assert.equal(groupLogs[1].afterData.tasterSummary, 'Admin revised summary.');
    assert.equal(groupLogs[1].afterData.financeMark, true);
  });
});

test('contract: pending travel groups are computed from travel group rules and preserve role scope', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);

      const missingTaster = await fetchPendingByGroupNo(baseUrl, admin.token, 'PEND-MISSING-TASTER');
      assert.equal(missingTaster.length, 1);
      assert.equal(missingTaster[0].pendingStatus, 'pending_front_desk');
      assert.deepEqual(missingTaster[0].pendingReasons, ['missing_taster']);

      const frontDeskAbnormal = await fetchPendingByGroupNo(baseUrl, admin.token, 'PEND-FRONT-ABNORMAL');
      assert.equal(frontDeskAbnormal.length, 1);
      assert.equal(frontDeskAbnormal[0].pendingStatus, 'abnormal');
      for (const reason of [
        'missing_guide_name',
        'missing_guide_phone',
        'missing_travel_agency',
        'missing_guest_count',
        'invalid_guest_count_zero',
      ]) {
        assert.ok(frontDeskAbnormal[0].pendingReasons.includes(reason), `expected ${reason}`);
      }

      const noOrderNoSummary = await fetchPendingByGroupNo(baseUrl, admin.token, 'PEND-NO-ORDER-SUMMARY');
      assert.equal(noOrderNoSummary.length, 1);
      assert.equal(noOrderNoSummary[0].pendingStatus, 'pending_taster');
      assert.deepEqual(noOrderNoSummary[0].pendingReasons, ['no_order_and_missing_taster_summary']);

      const financePending = await fetchPendingByGroupNo(baseUrl, admin.token, 'PEND-FINANCE-OLD');
      assert.equal(financePending.length, 1);
      assert.equal(financePending[0].pendingStatus, 'pending_finance');
      assert.deepEqual(financePending[0].pendingReasons, ['finance_unmarked_after_day_end']);

      const duplicateGroups = await fetchPendingByGroupNo(baseUrl, admin.token, 'PEND-DUPLICATE');
      assert.equal(duplicateGroups.length, 2);
      for (const group of duplicateGroups) {
        assert.equal(group.pendingStatus, 'abnormal');
        assert.deepEqual(group.pendingReasons, ['duplicate_group_no']);
      }

      const badTimes = await fetchPendingByGroupNo(baseUrl, admin.token, 'PEND-BAD-TIMES');
      assert.equal(badTimes.length, 1);
      assert.equal(badTimes[0].pendingStatus, 'abnormal');
      assert.deepEqual(badTimes[0].pendingReasons, ['departure_before_arrival']);

      const missingDepartureOnly = await fetchPendingByGroupNo(baseUrl, admin.token, 'PEND-MISSING-DEPARTURE-OK');
      assert.deepEqual(missingDepartureOnly, []);

      const withOrderNoDeparture = await fetchPendingByGroupNo(baseUrl, admin.token, 'PEND-ORDER-NO-DEPARTURE-OK');
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

      const frontDesk = await login(baseUrl, frontDeskUser.username, 'Password123');
      const taster = await login(baseUrl, tasterUser.username, 'Password123');
      const sales = await login(baseUrl, salesUser.username, 'Password123');

      const frontDeskGroup = await createScopedTravelGroup(baseUrl, frontDesk.token, {
        visitDate: '2099-01-03',
        tasterId: tasterUser.id,
      });
      const adminTasterGroup = await createScopedTravelGroup(baseUrl, admin.token, {
        visitDate: '2099-01-04',
        tasterId: tasterUser.id,
      });
      const otherTasterGroup = await createScopedTravelGroup(baseUrl, admin.token, {
        visitDate: '2099-01-05',
        tasterId: otherTasterUser.id,
      });
      const salesRelatedGroup = await createScopedTravelGroup(baseUrl, admin.token, {
        visitDate: '2000-01-01',
        tasterId: otherTasterUser.id,
      });
      await createScopedSalesOrder(baseUrl, sales.token, {
        orderNo: 'SO-PENDING-SALES-SCOPE',
        travelGroupId: salesRelatedGroup.id,
      });

      const frontDeskPending = await requestJson(baseUrl, '/api/pending-travel-groups', {
        token: frontDesk.token,
      });
      assert.equal(frontDeskPending.response.status, 200);
      assert.deepEqual(groupNos(frontDeskPending.body.data.pendingTravelGroups), [frontDeskGroup.groupNo]);

      const tasterPending = await requestJson(baseUrl, '/api/pending-travel-groups', {
        token: taster.token,
      });
      assert.equal(tasterPending.response.status, 200);
      assert.deepEqual(
        groupNos(tasterPending.body.data.pendingTravelGroups),
        groupNos([frontDeskGroup, adminTasterGroup]),
      );
      assert.equal(
        tasterPending.body.data.pendingTravelGroups.some((group) => group.groupNo === otherTasterGroup.groupNo),
        false,
      );

      const salesPending = await requestJson(baseUrl, '/api/pending-travel-groups', {
        token: sales.token,
      });
      assert.equal(salesPending.response.status, 200);
      assert.deepEqual(groupNos(salesPending.body.data.pendingTravelGroups), [salesRelatedGroup.groupNo]);
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
          },
          {
            id: 'seed-front-abnormal',
            groupNo: 'PEND-FRONT-ABNORMAL',
            visitDate: '2099-01-01',
            travelAgency: '',
            guideName: '',
            guidePhone: '',
            guestCount: 0,
            tasterId: 'seed-taster',
            tasterSummary: 'summary exists',
            tasterSummaryAt: '2099-01-01T08:00:00.000Z',
            financeMark: true,
          },
          {
            id: 'seed-no-order-summary',
            groupNo: 'PEND-NO-ORDER-SUMMARY',
            visitDate: '2099-01-01',
            tasterId: 'seed-taster',
            financeMark: true,
          },
          {
            id: 'seed-finance-old',
            groupNo: 'PEND-FINANCE-OLD',
            visitDate: '2000-01-01',
            tasterId: 'seed-taster',
            tasterSummary: 'summary exists',
            tasterSummaryAt: '2000-01-01T08:00:00.000Z',
            financeMark: false,
          },
          {
            id: 'seed-duplicate-a',
            groupNo: 'PEND-DUPLICATE',
            visitDate: '2099-01-01',
            tasterId: 'seed-taster',
            tasterSummary: 'summary exists',
            tasterSummaryAt: '2099-01-01T08:00:00.000Z',
            financeMark: true,
          },
          {
            id: 'seed-duplicate-b',
            groupNo: 'PEND-DUPLICATE',
            visitDate: '2099-01-01',
            tasterId: 'seed-taster',
            tasterSummary: 'summary exists',
            tasterSummaryAt: '2099-01-01T08:00:00.000Z',
            financeMark: true,
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
          },
          {
            id: 'seed-order-no-departure-ok',
            groupNo: 'PEND-ORDER-NO-DEPARTURE-OK',
            visitDate: '2099-01-01',
            tasterId: 'seed-taster',
            arrivalTime: '15:00',
            departureTime: null,
            financeMark: true,
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
      groupType: 'filter-alpha',
      guestCount: 8,
    });
    const groupBeta = await createScopedTravelGroup(baseUrl, admin.token, {
      visitDate: '2026-06-27',
      tasterId: tasterBeta.id,
      groupType: 'filter-beta',
      guestCount: 18,
    });
    const groupGamma = await createScopedTravelGroup(baseUrl, admin.token, {
      visitDate: '2026-06-27',
      tasterId: tasterAlpha.id,
      groupType: 'filter-alpha',
      guestCount: 28,
    });
    await setTravelGroupFinanceMark(baseUrl, admin.token, groupBeta.id, true);

    const dateFiltered = await requestJson(baseUrl, '/api/travel-groups?dateFrom=2026-06-27&dateTo=2026-06-27', {
      token: admin.token,
    });
    assert.equal(dateFiltered.response.status, 200);
    assert.deepEqual(groupNos(dateFiltered.body.data.travelGroups), groupNos([groupBeta, groupGamma]));

    const keywordFiltered = await requestJson(
      baseUrl,
      `/api/travel-groups?keyword=${encodeURIComponent(groupAlpha.groupNo.slice(-4))}`,
      {
        token: admin.token,
      },
    );
    assert.equal(keywordFiltered.response.status, 200);
    assert.deepEqual(groupNos(keywordFiltered.body.data.travelGroups), [groupAlpha.groupNo]);

    const groupNoFiltered = await requestJson(baseUrl, `/api/travel-groups?groupNo=${groupBeta.groupNo}`, {
      token: admin.token,
    });
    assert.equal(groupNoFiltered.response.status, 200);
    assert.deepEqual(groupNos(groupNoFiltered.body.data.travelGroups), [groupBeta.groupNo]);

    const guideFiltered = await requestJson(baseUrl, `/api/travel-groups?guideId=${groupGamma.guideId}`, {
      token: admin.token,
    });
    assert.equal(guideFiltered.response.status, 200);
    assert.deepEqual(groupNos(guideFiltered.body.data.travelGroups), [groupGamma.groupNo]);

    const tasterFiltered = await requestJson(baseUrl, `/api/travel-groups?tasterId=${tasterAlpha.id}`, {
      token: admin.token,
    });
    assert.equal(tasterFiltered.response.status, 200);
    assert.deepEqual(groupNos(tasterFiltered.body.data.travelGroups), groupNos([groupAlpha, groupGamma]));

    const typeFiltered = await requestJson(baseUrl, '/api/travel-groups?groupType=filter-beta', {
      token: admin.token,
    });
    assert.equal(typeFiltered.response.status, 200);
    assert.deepEqual(groupNos(typeFiltered.body.data.travelGroups), [groupBeta.groupNo]);

    const markedFiltered = await requestJson(baseUrl, '/api/travel-groups?financeMark=true', {
      token: admin.token,
    });
    assert.equal(markedFiltered.response.status, 200);
    assert.deepEqual(groupNos(markedFiltered.body.data.travelGroups), [groupBeta.groupNo]);

    const unmarkedFiltered = await requestJson(baseUrl, '/api/travel-groups?financeMark=false', {
      token: admin.token,
    });
    assert.equal(unmarkedFiltered.response.status, 200);
    assert.deepEqual(groupNos(unmarkedFiltered.body.data.travelGroups), groupNos([groupAlpha, groupGamma]));

    const pendingFiltered = await requestJson(baseUrl, '/api/travel-groups?pendingStatus=pending_taster', {
      token: admin.token,
    });
    assert.equal(pendingFiltered.response.status, 200);
    assert.deepEqual(groupNos(pendingFiltered.body.data.travelGroups), groupNos([groupAlpha, groupBeta, groupGamma]));

    const limited = await requestJson(baseUrl, '/api/travel-groups?limit=2', {
      token: admin.token,
    });
    assert.equal(limited.response.status, 200);
    assert.equal(limited.body.data.travelGroups.length, 2);
  });
});

test('contract: business data role scopes hide other users travel groups and sales orders', async () => {
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
    const tasterAlpha = await login(baseUrl, 'scope-taster-alpha', 'Password123');
    const tasterBeta = await login(baseUrl, 'scope-taster-beta', 'Password123');
    const warehouse = await login(baseUrl, 'scope-warehouse', 'Password123');
    const afterSales = await login(baseUrl, 'scope-after-sales', 'Password123');

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
    assert.deepEqual(groupNos(alphaTasterGroups.body.data.travelGroups), [groupAlpha.groupNo]);

    const betaTasterGroups = await requestJson(baseUrl, '/api/travel-groups', {
      token: tasterBeta.token,
    });
    assert.equal(betaTasterGroups.response.status, 200);
    assert.deepEqual(groupNos(betaTasterGroups.body.data.travelGroups), [groupBeta.groupNo]);

    const tasterBlockedDetail = await requestJson(baseUrl, `/api/travel-groups/${groupBeta.id}`, {
      token: tasterAlpha.token,
    });
    assertErrorContract(tasterBlockedDetail, 404, 'TRAVEL_GROUP_NOT_FOUND');

    const alphaSalesGroups = await requestJson(baseUrl, '/api/travel-groups', {
      token: salesAlpha.token,
    });
    assert.equal(alphaSalesGroups.response.status, 200);
    assert.deepEqual(groupNos(alphaSalesGroups.body.data.travelGroups), [groupAlpha.groupNo]);

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

    const adminGroupDetail = await requestJson(baseUrl, `/api/travel-groups/${groupAlpha.id}`, {
      token: admin.token,
    });
    assert.equal(adminGroupDetail.response.status, 200);
    assertTravelGroupDetailDto(adminGroupDetail.body.data.travelGroup);
    assert.equal(adminGroupDetail.body.data.travelGroup.guide.id, groupAlpha.guideId);
    assert.equal(adminGroupDetail.body.data.travelGroup.taster.id, tasterAlphaUser.id);
    assert.deepEqual(orderNos(adminGroupDetail.body.data.travelGroup.salesOrders), [
      'SO-SCOPE-ASSIGNED',
      'SO-SCOPE-CREATED',
    ]);
    assert.equal(adminGroupDetail.body.data.travelGroup.orderSummary.orderCount, 2);
    assert.equal(adminGroupDetail.body.data.travelGroup.orderSummary.totalAmountCents, 20000);

    const bossGroupDetail = await requestJson(baseUrl, `/api/travel-groups/${groupAlpha.id}`, {
      token: boss.token,
    });
    assert.equal(bossGroupDetail.response.status, 200);
    assertTravelGroupDetailDto(bossGroupDetail.body.data.travelGroup);

    const bossPatch = await requestJson(baseUrl, `/api/travel-groups/${groupAlpha.id}`, {
      method: 'PATCH',
      token: boss.token,
      body: {
        remarks: 'boss should not edit',
      },
    });
    assertErrorContract(bossPatch, 403, 'PERMISSION_DENIED');

    const financeGroupDetail = await requestJson(baseUrl, `/api/travel-groups/${groupAlpha.id}`, {
      token: finance.token,
    });
    assert.equal(financeGroupDetail.response.status, 200);
    assertTravelGroupDetailDto(financeGroupDetail.body.data.travelGroup);

    const salesAllowedGroupDetail = await requestJson(baseUrl, `/api/travel-groups/${groupAlpha.id}`, {
      token: salesAlpha.token,
    });
    assert.equal(salesAllowedGroupDetail.response.status, 200);
    assertTravelGroupDetailDto(salesAllowedGroupDetail.body.data.travelGroup);

    const tasterAllowedGroupDetail = await requestJson(baseUrl, `/api/travel-groups/${groupAlpha.id}`, {
      token: tasterAlpha.token,
    });
    assert.equal(tasterAllowedGroupDetail.response.status, 200);
    assertTravelGroupDetailDto(tasterAllowedGroupDetail.body.data.travelGroup);

    const groupFrontDesk = await createScopedTravelGroup(baseUrl, frontDesk.token, {
      tasterId: tasterAlphaUser.id,
    });
    const frontDeskGroups = await requestJson(baseUrl, '/api/travel-groups', {
      token: frontDesk.token,
    });
    assert.equal(frontDeskGroups.response.status, 200);
    assert.deepEqual(groupNos(frontDeskGroups.body.data.travelGroups), [groupFrontDesk.groupNo]);

    const frontDeskOwnDetail = await requestJson(baseUrl, `/api/travel-groups/${groupFrontDesk.id}`, {
      token: frontDesk.token,
    });
    assert.equal(frontDeskOwnDetail.response.status, 200);
    assertTravelGroupDetailDto(frontDeskOwnDetail.body.data.travelGroup);

    const frontDeskBlockedDetail = await requestJson(baseUrl, `/api/travel-groups/${groupAlpha.id}`, {
      token: frontDesk.token,
    });
    assertErrorContract(frontDeskBlockedDetail, 404, 'TRAVEL_GROUP_NOT_FOUND');

    const warehouseGroups = await requestJson(baseUrl, '/api/travel-groups', {
      token: warehouse.token,
    });
    assertErrorContract(warehouseGroups, 403, 'PERMISSION_DENIED');

    const afterSalesGroups = await requestJson(baseUrl, '/api/travel-groups', {
      token: afterSales.token,
    });
    assertErrorContract(afterSalesGroups, 403, 'PERMISSION_DENIED');
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
    assert.deepEqual(groupNos(beforeEnableGroups.body.data.travelGroups), groupNos([markedGroup, unmarkedGroup]));

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
    assert.deepEqual(groupNos(markedGroupsOnly.body.data.travelGroups), [markedGroup.groupNo]);

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
    assert.deepEqual(groupNos(restoredGroups.body.data.travelGroups), groupNos([markedGroup, unmarkedGroup]));

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

let fixtureSequence = 0;

async function createGuideFixture(baseUrl, token, overrides = {}) {
  fixtureSequence += 1;
  const result = await requestJson(baseUrl, '/api/guides', {
    method: 'POST',
    token,
    body: {
      name: overrides.name || `Guide Fixture ${fixtureSequence}`,
      phone: overrides.phone || `13910${String(fixtureSequence).padStart(6, '0')}`,
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
      licensePlate: overrides.licensePlate || `GZA${String(fixtureSequence).padStart(5, '0')}`,
      guideId: guide.id,
      guestCount: overrides.guestCount ?? 12,
      tastingRoomNo: overrides.tastingRoomNo || 'Scope Room',
      tasterId: taster.id,
      groupType: overrides.groupType || 'scope',
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

async function fetchPendingByGroupNo(baseUrl, token, groupNo) {
  const result = await requestJson(baseUrl, `/api/pending-travel-groups?groupNo=${encodeURIComponent(groupNo)}`, {
    token,
  });
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
    'guestCount',
    'tastingRoomNo',
    'tasterName',
    'arrivalTime',
    'groupType',
    'departureTime',
    'remarks',
    'status',
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
    'tastingItems',
    'guide',
    'taster',
    'salesOrders',
    'orderSummary',
    'pendingStatus',
    'pendingReasons',
  ]) {
    assert.ok(Object.hasOwn(group, key), `travel group DTO should include ${key}`);
  }
  assert.equal(typeof group.groupNo, 'string');
  assert.equal(typeof group.visitDate, 'string');
  assert.equal(typeof group.guestCount, 'number');
  assert.equal(typeof group.financeMark, 'boolean');
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
  assert.equal(typeof group.guide.travelAgency, 'string');
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
