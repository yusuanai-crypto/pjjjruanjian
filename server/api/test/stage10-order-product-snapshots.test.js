const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  createUser,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

test('contract: sales order items snapshot active products and date-effective actual costs', async () => {
  await withPhase1Server(async (baseUrl, { prisma }) => {
    const stores = prisma.__store;
    const admin = await login(baseUrl);
    const product = await createProduct(baseUrl, admin.token, 'Snapshot Product', 'case');
    const oldCost = await createActualCost(baseUrl, admin.token, product.id, {
      costCents: 800,
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-06-30',
    });
    const currentCost = await createActualCost(baseUrl, admin.token, product.id, {
      costCents: 1000,
      effectiveFrom: '2026-07-01',
    });

    const missingProductId = await createOrder(baseUrl, admin.token, {
      orderDate: '2026-07-15',
      items: [{ productName: product.name, quantity: 1, unitPriceCents: 10000 }],
    });
    assertErrorContract(missingProductId, 400, 'VALIDATION_FAILED');

    const noCostProduct = await createProduct(baseUrl, admin.token, 'No Cost Product');
    const missingCost = await createOrder(baseUrl, admin.token, {
      orderDate: '2026-07-15',
      items: [{ productId: noCostProduct.id, quantity: 1, unitPriceCents: 10000 }],
    });
    assertErrorContract(missingCost, 400, 'PRODUCT_ACTUAL_COST_NOT_EFFECTIVE');
    assert.match(missingCost.body.error.message, /该商品在订单日期没有有效实际成本/);

    const inactiveProduct = await createProduct(baseUrl, admin.token, 'Inactive Order Product');
    await setProductActive(baseUrl, admin.token, inactiveProduct.id, false);
    const inactive = await createOrder(baseUrl, admin.token, {
      orderDate: '2026-07-15',
      items: [{ productId: inactiveProduct.id, quantity: 1, unitPriceCents: 10000 }],
    });
    assertErrorContract(inactive, 400, 'PRODUCT_INACTIVE');

    const created = await createOrder(baseUrl, admin.token, {
      orderDate: '2026-07-15',
      items: [
        {
          productId: product.id,
          productName: 'client name must be ignored',
          unit: 'client unit',
          quantity: 2,
          unitPriceCents: 10000,
          subtotalCents: 25000,
          deliveryType: 'shipping',
        },
      ],
    });
    assert.equal(created.response.status, 201);
    const order = created.body.data.salesOrder;
    assert.equal(order.items[0].productId, product.id);
    assert.equal(order.items[0].productName, 'Snapshot Product');
    assert.equal(order.items[0].unit, 'case');
    assert.equal(order.totalAmountCents, 25000);
    assert.equal(order.items[0].subtotalCents, 25000);
    let storedItem = findStoredOrderItem(stores, order.id);
    assert.deepEqual(costSnapshot(storedItem), {
      actualUnitCostCents: 1000,
      actualCostSubtotalCents: 2000,
      grossProfitCents: 23000,
    });

    const changedCost = await requestJson(
      baseUrl,
      `/api/product-actual-costs/${currentCost.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: { costCents: 2500 },
      },
    );
    assert.equal(changedCost.response.status, 200);

    const remarkOnly = await requestJson(baseUrl, `/api/sales-orders/${order.id}`, {
      method: 'PATCH',
      token: admin.token,
      body: { remark: 'cost snapshot must stay unchanged' },
    });
    assert.equal(remarkOnly.response.status, 200);
    storedItem = findStoredOrderItem(stores, order.id);
    assert.equal(storedItem.actualUnitCostCents, 1000);

    const priceOnly = await requestJson(baseUrl, `/api/sales-orders/${order.id}`, {
      method: 'PATCH',
      token: admin.token,
      body: {
        items: [
          {
            id: order.items[0].id,
            productId: product.id,
            quantity: 2,
            unitPriceCents: 12000,
            deliveryType: 'shipping',
          },
        ],
      },
    });
    assert.equal(priceOnly.response.status, 200);
    storedItem = findStoredOrderItem(stores, order.id);
    assert.deepEqual(costSnapshot(storedItem), {
      actualUnitCostCents: 1000,
      actualCostSubtotalCents: 2000,
      grossProfitCents: 22000,
    });

    const quantityChanged = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          items: [
            {
              id: order.items[0].id,
              productId: product.id,
              quantity: 3,
              unitPriceCents: 12000,
              deliveryType: 'shipping',
            },
          ],
        },
      },
    );
    assert.equal(quantityChanged.response.status, 200);
    storedItem = findStoredOrderItem(stores, order.id);
    assert.deepEqual(costSnapshot(storedItem), {
      actualUnitCostCents: 2500,
      actualCostSubtotalCents: 7500,
      grossProfitCents: 28500,
    });

    const backdated = await requestJson(baseUrl, `/api/sales-orders/${order.id}`, {
      method: 'PATCH',
      token: admin.token,
      body: { orderDate: '2026-06-15' },
    });
    assert.equal(backdated.response.status, 200);
    storedItem = findStoredOrderItem(stores, order.id);
    assert.deepEqual(costSnapshot(storedItem), {
      actualUnitCostCents: 800,
      actualCostSubtotalCents: 2400,
      grossProfitCents: 33600,
    });

    await requestJson(baseUrl, `/api/product-actual-costs/${oldCost.id}`, {
      method: 'PATCH',
      token: admin.token,
      body: { costCents: 5000 },
    });
    await requestJson(baseUrl, `/api/sales-orders/${order.id}`, {
      method: 'PATCH',
      token: admin.token,
      body: { customer: { name: 'Updated Snapshot Customer' } },
    });
    storedItem = findStoredOrderItem(stores, order.id);
    assert.equal(storedItem.actualUnitCostCents, 800);

    await setProductActive(baseUrl, admin.token, product.id, false);
    const historicalRemarkAfterDisable = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: { remark: 'disabled product history remains editable' },
      },
    );
    assert.equal(historicalRemarkAfterDisable.response.status, 200);
    assert.equal(findStoredOrderItem(stores, order.id).actualUnitCostCents, 800);
  });
});

test('contract: tasting items require active productId but never require or write costs', async () => {
  await withPhase1Server(async (baseUrl, { prisma }) => {
    const stores = prisma.__store;
    const admin = await login(baseUrl);
    const taster = await createUser(baseUrl, admin.token, {
      name: 'Stage10 Taster',
      username: 'stage10-tasting-taster',
      password: 'Password123',
      role: 'taster',
    });
    const guideResult = await requestJson(baseUrl, '/api/guides', {
      method: 'POST',
      token: admin.token,
      body: {
        name: 'Stage10 Guide',
        phone: '13900001234',
      },
    });
    assert.equal(guideResult.response.status, 201);
    const product = await createProduct(baseUrl, admin.token, 'Tasting Snapshot Product', 'cup');

    const missingProductId = await createTravelGroup(baseUrl, admin.token, {
      guideId: guideResult.body.data.guide.id,
      tasterId: taster.id,
      tastingItems: [{ productName: product.name, quantity: 1, unit: 'cup' }],
    });
    assertErrorContract(missingProductId, 400, 'VALIDATION_FAILED');

    const created = await createTravelGroup(baseUrl, admin.token, {
      guideId: guideResult.body.data.guide.id,
      tasterId: taster.id,
      tastingItems: [
        {
          productId: product.id,
          productName: 'spoofed tasting name',
          unit: 'spoofed unit',
          quantity: 2,
        },
      ],
    });
    assert.equal(created.response.status, 201);
    const group = created.body.data.travelGroup;
    assert.equal(group.tastingItems[0].productId, product.id);
    assert.equal(group.tastingItems[0].productName, product.name);
    assert.equal(group.tastingItems[0].unit, 'cup');
    const storedTastingItem = stores.travelGroupTastingItems.find(
      (item) => item.travelGroupId === group.id,
    );
    assert.equal('actualUnitCostCents' in storedTastingItem, false);
    assert.equal('grossProfitCents' in storedTastingItem, false);

    await setProductActive(baseUrl, admin.token, product.id, false);
    const inactiveEdit = await requestJson(baseUrl, `/api/travel-groups/${group.id}`, {
      method: 'PATCH',
      token: admin.token,
      body: {
        tastingItems: [{ productId: product.id, quantity: 1 }],
      },
    });
    assertErrorContract(inactiveEdit, 400, 'PRODUCT_INACTIVE');
  });
});

test('contract: historical order and tasting rows with null product or cost remain queryable', async () => {
  await withPhase1Server(
    async (baseUrl, { prisma }) => {
      const stores = prisma.__store;
      stores.travelGroupTastingItems.push({
        id: 'historical-tasting-null-product',
        travelGroupId: 'historical-group-null-product',
        productId: null,
        productName: 'Historical Tasting Name',
        quantity: 1,
        unit: 'cup',
        note: null,
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const admin = await login(baseUrl);
      const order = await requestJson(baseUrl, '/api/sales-orders/historical-order-null-cost', {
        token: admin.token,
      });
      assert.equal(order.response.status, 200);
      assert.equal(order.body.data.salesOrder.items[0].productId, null);
      assert.equal(order.body.data.salesOrder.items[0].unit, null);

      const historicalProduct = await createProduct(
        baseUrl,
        admin.token,
        'Historical Product Name',
        'bottle',
      );
      const priceOnlyHistoricalEdit = await requestJson(
        baseUrl,
        '/api/sales-orders/historical-order-null-cost',
        {
          method: 'PATCH',
          token: admin.token,
          body: {
            items: [
              {
                id: 'historical-item-null-cost',
                productId: historicalProduct.id,
                quantity: 1,
                unitPriceCents: 12000,
                deliveryType: 'shipping',
              },
            ],
          },
        },
      );
      assert.equal(priceOnlyHistoricalEdit.response.status, 200);
      const historicalStoredItem = stores.salesOrderItems.find(
        (item) => item.id === 'historical-item-null-cost',
      );
      assert.equal(historicalStoredItem.actualUnitCostCents, null);
      assert.equal(historicalStoredItem.actualCostSubtotalCents, null);
      assert.equal(historicalStoredItem.grossProfitCents, null);

      const group = await requestJson(
        baseUrl,
        '/api/travel-groups/historical-group-null-product',
        { token: admin.token },
      );
      assert.equal(group.response.status, 200);
      assert.equal(group.body.data.travelGroup.tastingItems[0].productId, null);
      assert.equal(group.body.data.travelGroup.tastingItems[0].productName, 'Historical Tasting Name');
    },
    {
      prisma: {
        salesOrders: [
          {
            id: 'historical-order-null-cost',
            orderNo: 'SO-HISTORICAL-NULL-COST',
            orderType: 'EXTERNAL',
            orderDate: '2025-01-01',
            customerName: 'Historical Customer',
            items: [
              {
                id: 'historical-item-null-cost',
                productId: null,
                productName: 'Historical Product Name',
                unit: null,
                quantity: 1,
                unitPriceCents: 10000,
                subtotalCents: 10000,
                actualUnitCostCents: null,
                actualCostSubtotalCents: null,
                grossProfitCents: null,
              },
            ],
          },
        ],
        travelGroups: [
          {
            id: 'historical-group-null-product',
            groupNo: 'TG-HISTORICAL-NULL-PRODUCT',
          },
        ],
      },
    },
  );
});

async function createProduct(baseUrl, token, name, unit = 'bottle') {
  const result = await requestJson(baseUrl, '/api/products', {
    method: 'POST',
    token,
    body: { name, unit },
  });
  assert.equal(result.response.status, 201);
  return result.body.data.product;
}

async function createActualCost(baseUrl, token, productId, body) {
  const result = await requestJson(baseUrl, `/api/products/${productId}/actual-costs`, {
    method: 'POST',
    token,
    body,
  });
  assert.equal(result.response.status, 201);
  return result.body.data.actualCost;
}

function setProductActive(baseUrl, token, productId, isActive) {
  return requestJson(baseUrl, `/api/products/${productId}/status`, {
    method: 'PATCH',
    token,
    body: { isActive },
  });
}

function createOrder(baseUrl, token, overrides) {
  return requestJson(baseUrl, '/api/sales-orders', {
    method: 'POST',
    token,
    body: {
      orderType: 'external',
      orderDate: overrides.orderDate,
      customer: {
        name: 'Snapshot Customer',
        phone: '13900009999',
      },
      items: overrides.items.map((item) => ({
        deliveryType: 'shipping',
        ...item,
      })),
    },
  });
}

function createTravelGroup(baseUrl, token, overrides) {
  return requestJson(baseUrl, '/api/travel-groups', {
    method: 'POST',
    token,
    body: {
      visitDate: '2026-07-15',
      travelAgency: 'Stage10 Agency',
      licensePlate: 'STAGE10',
      guideId: overrides.guideId,
      guestCount: 2,
      tastingRoomNo: 'Stage10 Room',
      tasterId: overrides.tasterId,
      groupType: 'test',
      tastingItems: overrides.tastingItems,
    },
  });
}

function findStoredOrderItem(stores, salesOrderId) {
  const item = stores.salesOrderItems.find(
    (candidate) => candidate.salesOrderId === salesOrderId,
  );
  assert.ok(item);
  return item;
}

function costSnapshot(item) {
  return {
    actualUnitCostCents: item.actualUnitCostCents,
    actualCostSubtotalCents: item.actualCostSubtotalCents,
    grossProfitCents: item.grossProfitCents,
  };
}
