const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

test('PATCH logistics company or tracking number clears old tracking cache', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);

      const numberChanged = await requestJson(
        baseUrl,
        '/api/sales-orders/order-logistics-no-change/finance',
        {
          method: 'PATCH',
          token: admin.token,
          body: {
            logisticsNo: 'SF-NEW-002',
          },
        },
      );
      assert.equal(numberChanged.response.status, 200);
      assertTrackingCacheCleared(numberChanged.body.data.salesOrder);

      const providerChanged = await requestJson(
        baseUrl,
        '/api/sales-orders/order-logistics-provider-change/packing',
        {
          method: 'PATCH',
          token: admin.token,
          body: {
            logisticsProviderCode: 'yunda',
            logisticsMethod: '韵达快递',
          },
        },
      );
      assert.equal(providerChanged.response.status, 200);
      assert.equal(
        providerChanged.body.data.salesOrder.logisticsProviderCode,
        'yunda',
      );
      assertTrackingCacheCleared(providerChanged.body.data.salesOrder);
    },
    {
      prisma: {
        salesOrders: [
          buildOrder({
            id: 'order-logistics-no-change',
            orderNo: 'SO-LOGISTICS-NO-CHANGE',
          }),
          buildOrder({
            id: 'order-logistics-provider-change',
            orderNo: 'SO-LOGISTICS-PROVIDER-CHANGE',
          }),
        ],
      },
    },
  );
});

test('shipping order may wait for a number but entering packed state requires provider and number', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);

      const waiting = await requestJson(
        baseUrl,
        '/api/sales-orders/order-logistics-waiting/packing',
        {
          method: 'PATCH',
          token: admin.token,
          body: {
            logisticsProviderCode: 'shunfeng',
            logisticsMethod: '顺丰速运',
            packingStatus: 'packing',
          },
        },
      );
      assert.equal(waiting.response.status, 200);
      assert.equal(waiting.body.data.salesOrder.logisticsNo, null);

      const prematurelyPacked = await requestJson(
        baseUrl,
        '/api/sales-orders/order-logistics-waiting/packing',
        {
          method: 'PATCH',
          token: admin.token,
          body: {
            packingStatus: 'packed',
          },
        },
      );
      assertErrorContract(
        prematurelyPacked,
        400,
        'SHIPPED_LOGISTICS_REQUIRED',
      );

      const numberAdded = await requestJson(
        baseUrl,
        '/api/sales-orders/order-logistics-waiting/finance',
        {
          method: 'PATCH',
          token: admin.token,
          body: {
            logisticsNo: 'SF-WAITING-001',
          },
        },
      );
      assert.equal(numberAdded.response.status, 200);

      const packed = await requestJson(
        baseUrl,
        '/api/sales-orders/order-logistics-waiting/packing',
        {
          method: 'PATCH',
          token: admin.token,
          body: {
            packingStatus: 'packed',
          },
        },
      );
      assert.equal(packed.response.status, 200);
      assert.equal(packed.body.data.salesOrder.packingStatus, 'packed');
    },
    {
      prisma: {
        salesOrders: [
          buildOrder({
            id: 'order-logistics-waiting',
            orderNo: 'SO-LOGISTICS-WAITING',
            logisticsProviderCode: null,
            logisticsMethod: null,
            logisticsNo: null,
            trackingState: null,
            trackingStateLabel: null,
            trackingLatestLocation: null,
            trackingLatestDescription: null,
            trackingEventAt: null,
            trackingCheckedAt: null,
          }),
        ],
      },
    },
  );
});

function assertTrackingCacheCleared(order) {
  assert.equal(order.trackingState, null);
  assert.equal(order.trackingStateLabel, null);
  assert.equal(order.trackingLatestLocation, null);
  assert.equal(order.trackingLatestDescription, null);
  assert.equal(order.trackingEventAt, null);
  assert.equal(order.trackingCheckedAt, null);
}

function buildOrder(overrides = {}) {
  return {
    orderType: 'EXTERNAL',
    customerName: '物流测试客户',
    customerPhone: '13812340000',
    orderDate: '2026-07-23T00:00:00.000Z',
    packingStatus: 'PENDING',
    logisticsProviderCode: 'shunfeng',
    logisticsMethod: '顺丰速运',
    logisticsNo: 'SF-OLD-001',
    trackingState: 'in_transit',
    trackingStateLabel: '运输中',
    trackingLatestLocation: '遵义市',
    trackingLatestDescription: '快件运输中',
    trackingEventAt: '2026-07-23T01:00:00.000Z',
    trackingCheckedAt: '2026-07-23T01:05:00.000Z',
    status: 'VALID',
    items: [
      {
        productName: '测试酒',
        quantity: 1,
        unitPriceCents: 10000,
        subtotalCents: 10000,
        deliveryType: 'SHIPPING',
        sortOrder: 1,
      },
    ],
    ...overrides,
  };
}
