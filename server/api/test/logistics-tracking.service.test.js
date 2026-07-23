const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  Kuaidi100LogisticsProviderClient,
  mapKuaidi100State,
  normalizeKuaidi100Tracking,
} = require('../src/modules/business-data/kuaidi100-logistics-provider.client');
const {
  normalizeLogisticsProviderCode,
} = require('../src/modules/business-data/logistics-provider.helper');
const {
  LogisticsTrackingService,
} = require('../src/modules/business-data/logistics-tracking.service');

test('unit: maps the three supported carrier codes and legacy names', () => {
  assert.equal(normalizeLogisticsProviderCode('shunfeng'), 'shunfeng');
  assert.equal(normalizeLogisticsProviderCode(null, '顺丰速运'), 'shunfeng');
  assert.equal(normalizeLogisticsProviderCode(null, 'SF'), 'shunfeng');
  assert.equal(
    normalizeLogisticsProviderCode(null, '安能物流'),
    'annengwuliu',
  );
  assert.equal(normalizeLogisticsProviderCode(null, '韵达快递'), 'yunda');
  assert.equal(normalizeLogisticsProviderCode(null, '自提'), 'self_carry');
});

test('unit: self-carry and missing tracking numbers never query provider', async () => {
  let queryCount = 0;
  const service = buildService({
    client: {
      isConfigured: () => true,
      query: async () => {
        queryCount += 1;
      },
    },
  });

  const selfCarry = await service.resolveForSalesSheet(
    buildOrder({
      logisticsProviderCode: 'self_carry',
      logisticsMethod: '自带',
    }),
  );
  const missingNo = await service.resolveForSalesSheet(
    buildOrder({ logisticsNo: null }),
  );

  assert.equal(queryCount, 0);
  assert.equal(selfCarry.trackingMessage, '自带，无物流信息');
  assert.equal(missingNo.trackingMessage, '待寄出，运单号待录入');
});

test('unit: fresh 30-minute cache is reused without provider call', async (t) => {
  setTrackingEnv(t);
  let queryCount = 0;
  const service = buildService({
    client: {
      isConfigured: () => true,
      query: async () => {
        queryCount += 1;
      },
    },
  });
  const result = await service.resolveForSalesSheet(
    buildOrder({
      trackingState: 'in_transit',
      trackingStateLabel: '运输中',
      trackingCheckedAt: new Date(Date.now() - 29 * 60 * 1000),
    }),
  );

  assert.equal(queryCount, 0);
  assert.equal(result.cacheUsed, true);
  assert.equal(result.order.trackingState, 'in_transit');
});

test('unit: expired cache is refreshed and only normalized fields are saved', async (t) => {
  setTrackingEnv(t);
  let queryCount = 0;
  const updates = [];
  const service = buildService({
    updates,
    client: {
      isConfigured: () => true,
      query: async () => {
        queryCount += 1;
        return {
          state: 'out_for_delivery',
          stateLabel: '派送中',
          latestLocation: '贵阳市',
          latestDescription: '快件正在派送',
          eventAt: new Date('2026-07-23T01:00:00.000Z'),
          rawResponse: { mustNotPersist: true },
        };
      },
    },
  });
  const result = await service.resolveForSalesSheet(
    buildOrder({
      trackingCheckedAt: new Date(Date.now() - 31 * 60 * 1000),
    }),
  );

  assert.equal(queryCount, 1);
  assert.equal(result.order.trackingState, 'out_for_delivery');
  assert.equal(updates.length, 1);
  assert.deepEqual(Object.keys(updates[0].data).sort(), [
    'trackingCheckedAt',
    'trackingEventAt',
    'trackingLatestDescription',
    'trackingLatestLocation',
    'trackingState',
    'trackingStateLabel',
  ]);
  assert.equal(JSON.stringify(updates[0]).includes('mustNotPersist'), false);
});

test('unit: provider errors and missing configuration degrade safely', async (t) => {
  setTrackingEnv(t);
  const cachedService = buildService({
    client: {
      isConfigured: () => true,
      query: async () => {
        throw new Error('provider secret response');
      },
    },
  });
  const cached = await cachedService.resolveForSalesSheet(
    buildOrder({
      trackingState: 'in_transit',
      trackingStateLabel: '运输中',
      trackingCheckedAt: new Date(Date.now() - 31 * 60 * 1000),
    }),
  );
  assert.equal(cached.cacheUsed, true);
  assert.equal(cached.trackingMessage, '物流实时查询失败，当前显示最近缓存');

  const uncached = await cachedService.resolveForSalesSheet(buildOrder());
  assert.equal(uncached.cacheUsed, false);
  assert.equal(
    uncached.trackingMessage,
    '物流信息暂未查询到，请稍后刷新',
  );

  delete process.env.KUAIDI100_KEY;
  const unconfiguredService = buildService({
    client: {
      isConfigured: () => false,
      query: async () => {
        throw new Error('must not query');
      },
    },
  });
  const unconfigured =
    await unconfiguredService.resolveForSalesSheet(buildOrder());
  assert.equal(unconfigured.trackingMessage, '物流查询服务暂未配置');
});

test('unit: parses state, latest location, route fallback, and latest event', () => {
  const parsed = normalizeKuaidi100Tracking({
    status: '200',
    state: '0',
    data: [
      {
        statusCode: '5',
        status: '派件',
        context: '快件正在派送',
        time: '2026-07-23 10:30:00',
      },
    ],
    routeInfo: {
      cur: { name: '贵州,贵阳市,南明区' },
    },
  });
  assert.equal(parsed.state, 'out_for_delivery');
  assert.equal(parsed.stateLabel, '派送中');
  assert.equal(parsed.latestLocation, '贵州,贵阳市,南明区');
  assert.equal(parsed.latestDescription, '快件正在派送');
  assert.equal(parsed.eventAt.toISOString(), '2026-07-23T02:30:00.000Z');
  assert.equal(mapKuaidi100State('3'), 'signed');
  assert.equal(mapKuaidi100State('6'), 'returned');
  assert.equal(mapKuaidi100State('2'), 'exception');
});

test('unit: Kuaidi100 request signs form data and sends phone only for SF without logging secrets', async (t) => {
  setTrackingEnv(t, {
    KUAIDI100_CUSTOMER: 'customer-secret',
    KUAIDI100_KEY: 'key-secret',
  });
  const originalFetch = global.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const logs = [];
  let requestBody;
  global.fetch = async (_url, options) => {
    requestBody = String(options.body);
    return {
      ok: true,
      json: async () => ({
        status: '200',
        state: '1',
        data: [
          {
            statusCode: '1',
            context: '已揽收',
            time: '2026-07-23 09:00:00',
          },
        ],
      }),
    };
  };
  console.log = (...values) => logs.push(values.join(' '));
  console.error = (...values) => logs.push(values.join(' '));
  t.after(() => {
    global.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
  });

  const client = new Kuaidi100LogisticsProviderClient();
  await client.query({
    providerCode: 'shunfeng',
    logisticsNo: 'SF123456789',
    customerPhone: '13812340000',
  });

  const form = new URLSearchParams(requestBody);
  const param = JSON.parse(form.get('param'));
  const expectedSign = crypto
    .createHash('md5')
    .update(`${form.get('param')}key-secretcustomer-secret`)
    .digest('hex')
    .toUpperCase();
  assert.equal(param.phone, '13812340000');
  assert.equal(param.resultv2, '4');
  assert.equal(param.show, '0');
  assert.equal(param.order, 'desc');
  assert.equal(param.lang, 'zh');
  assert.equal(form.get('sign'), expectedSign);
  assert.equal(logs.join('\n').includes('13812340000'), false);
  assert.equal(logs.join('\n').includes('key-secret'), false);

  await client.query({
    providerCode: 'yunda',
    logisticsNo: 'YD123456789',
    customerPhone: '13812340000',
  });
  const yundaParam = JSON.parse(
    new URLSearchParams(requestBody).get('param'),
  );
  assert.equal('phone' in yundaParam, false);
});

test('unit: Kuaidi100 AbortController timeout becomes a safe provider error', async (t) => {
  setTrackingEnv(t, {
    LOGISTICS_TRACKING_TIMEOUT_MS: '10',
  });
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) =>
    await new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        reject(new Error('aborted'));
      });
    });
  t.after(() => {
    global.fetch = originalFetch;
  });

  const client = new Kuaidi100LogisticsProviderClient();
  await assert.rejects(
    client.query({
      providerCode: 'yunda',
      logisticsNo: 'YD123456789',
    }),
    /Logistics provider is unavailable/,
  );
});

function buildService({ client, updates = [] }) {
  return new LogisticsTrackingService(
    {
      salesOrder: {
        update: async (input) => {
          updates.push(input);
          return input;
        },
      },
    },
    client,
  );
}

function buildOrder(overrides = {}) {
  return {
    id: 'order-logistics-1',
    logisticsProviderCode: 'shunfeng',
    logisticsMethod: '顺丰速运',
    logisticsNo: 'SF123456789',
    customerPhone: '13812340000',
    trackingState: null,
    trackingStateLabel: null,
    trackingLatestLocation: null,
    trackingLatestDescription: null,
    trackingEventAt: null,
    trackingCheckedAt: null,
    ...overrides,
  };
}

function setTrackingEnv(t, overrides = {}) {
  const keys = [
    'LOGISTICS_TRACKING_PROVIDER',
    'KUAIDI100_CUSTOMER',
    'KUAIDI100_KEY',
    'LOGISTICS_TRACKING_TIMEOUT_MS',
    'LOGISTICS_TRACKING_CACHE_MINUTES',
  ];
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, {
    LOGISTICS_TRACKING_PROVIDER: 'kuaidi100',
    KUAIDI100_CUSTOMER: 'test-customer',
    KUAIDI100_KEY: 'test-key',
    LOGISTICS_TRACKING_CACHE_MINUTES: '30',
    ...overrides,
  });
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  });
}
