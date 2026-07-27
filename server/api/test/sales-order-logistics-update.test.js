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

test('shipping order enters packed with a provider before finance adds the tracking number', async () => {
  await withPhase1Server(
    async (baseUrl, { prisma }) => {
      const admin = await login(baseUrl);

      const packed = await requestJson(
        baseUrl,
        '/api/sales-orders/order-logistics-waiting/packing',
        {
          method: 'PATCH',
          token: admin.token,
          body: {
            logisticsProviderCode: 'shunfeng',
            logisticsMethod: '顺丰速运',
            packingStatus: 'packed',
          },
        },
      );
      assert.equal(packed.response.status, 200);
      assert.equal(packed.body.data.salesOrder.packingStatus, 'packed');
      assert.equal(packed.body.data.salesOrder.logisticsNo, null);

      const workbench = await requestJson(
        baseUrl,
        '/api/finance/workbench?dateFrom=2026-07-23&dateTo=2026-07-23&limit=20',
        {
          token: admin.token,
        },
      );
      assert.equal(workbench.response.status, 200);
      const pendingLogistics =
        workbench.body.data.workbench.pendingLogistics.find(
          (entry) => entry.order.id === 'order-logistics-waiting',
        );
      assert.ok(pendingLogistics);
      assert.ok(
        pendingLogistics.reasons.includes('missing_logistics_no'),
      );

      await prisma.salesOrder.update({
        where: { id: 'order-logistics-waiting' },
        data: {
          trackingState: 'in_transit',
          trackingStateLabel: '运输中',
          trackingLatestLocation: '遵义市',
          trackingLatestDescription: '旧缓存',
          trackingEventAt: new Date('2026-07-23T01:00:00.000Z'),
          trackingCheckedAt: new Date('2026-07-23T01:05:00.000Z'),
        },
      });

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
      assert.equal(
        numberAdded.body.data.salesOrder.logisticsNo,
        'SF-WAITING-001',
      );
      assertTrackingCacheCleared(numberAdded.body.data.salesOrder);
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

test('shipping order cannot enter packed without a logistics provider', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const result = await requestJson(
        baseUrl,
        '/api/sales-orders/order-provider-required/packing',
        {
          method: 'PATCH',
          token: admin.token,
          body: {
            packingStatus: 'packed',
          },
        },
      );

      assertErrorContract(
        result,
        400,
        'SHIPPED_LOGISTICS_PROVIDER_REQUIRED',
      );
      assert.equal(
        result.body.error.message,
        '邮寄订单进入已打包状态前必须选择物流公司。',
      );
    },
    {
      prisma: {
        salesOrders: [
          buildOrder({
            id: 'order-provider-required',
            orderNo: 'SO-PROVIDER-REQUIRED',
            logisticsProviderCode: null,
            logisticsMethod: null,
            logisticsNo: null,
          }),
        ],
      },
    },
  );
});

test('legacy 客户自提 alias enters packed without a tracking number', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const result = await requestJson(
        baseUrl,
        '/api/sales-orders/order-customer-self-carry/packing',
        {
          method: 'PATCH',
          token: admin.token,
          body: {
            packingStatus: 'packed',
          },
        },
      );

      assert.equal(result.response.status, 200);
      assert.equal(result.body.data.salesOrder.packingStatus, 'packed');
      assert.equal(
        result.body.data.salesOrder.logisticsProviderCode,
        'self_carry',
      );
      assert.equal(result.body.data.salesOrder.logisticsNo, null);
    },
    {
      prisma: {
        salesOrders: [
          buildOrder({
            id: 'order-customer-self-carry',
            orderNo: 'SO-CUSTOMER-SELF-CARRY',
            logisticsProviderCode: null,
            logisticsMethod: '客户自提',
            logisticsNo: null,
          }),
        ],
      },
    },
  );
});

test('finance may keep an originally empty packed tracking number empty', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const result = await requestJson(
        baseUrl,
        '/api/sales-orders/order-packed-without-number/finance',
        {
          method: 'PATCH',
          token: admin.token,
          body: {
            logisticsNo: '',
          },
        },
      );

      assert.equal(result.response.status, 200);
      assert.equal(result.body.data.salesOrder.packingStatus, 'packed');
      assert.equal(result.body.data.salesOrder.logisticsNo, null);
    },
    {
      prisma: {
        salesOrders: [
          buildOrder({
            id: 'order-packed-without-number',
            orderNo: 'SO-PACKED-WITHOUT-NUMBER',
            packingStatus: 'PACKED',
            logisticsNo: null,
          }),
        ],
      },
    },
  );
});

test('finance still cannot explicitly clear an existing packed tracking number', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const result = await requestJson(
        baseUrl,
        '/api/sales-orders/order-packed-with-number/finance',
        {
          method: 'PATCH',
          token: admin.token,
          body: {
            logisticsNo: '',
          },
        },
      );

      assertErrorContract(
        result,
        400,
        'PACKED_LOGISTICS_NO_CANNOT_BE_CLEARED',
      );
      assert.equal(
        result.body.error.message,
        '已打包订单已有物流单号，不能清空。',
      );
    },
    {
      prisma: {
        salesOrders: [
          buildOrder({
            id: 'order-packed-with-number',
            orderNo: 'SO-PACKED-WITH-NUMBER',
            packingStatus: 'PACKED',
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
