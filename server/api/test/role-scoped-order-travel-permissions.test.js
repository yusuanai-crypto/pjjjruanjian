const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  login,
  requestJsonWithStage10ProductFixtures: requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

const SALES_ONE_ID = 'usr_scope_sales_one';
const SALES_TWO_ID = 'usr_scope_sales_two';
const TASTER_RECEPTION_ID = 'usr_scope_taster_reception';
const TASTER_LIAISON_ID = 'usr_scope_taster_liaison';
const TASTER_OTHER_ID = 'usr_scope_taster_other';

test('contract: sales and taster reads use Beijing date scopes without createdBy or liaison fallback', async () => {
  const dates = shanghaiFixtureDates();
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const sales = await login(baseUrl, 'scope-sales-one', 'Password123');
      const taster = await login(
        baseUrl,
        'scope-taster-reception',
        'Password123',
      );
      const liaison = await login(
        baseUrl,
        'scope-taster-liaison',
        'Password123',
      );

      await requestJson(baseUrl, '/api/settings/global-mark-query/enable', {
        method: 'POST',
        token: admin.token,
      });

      const salesList = await requestJson(baseUrl, '/api/sales-orders', {
        token: sales.token,
      });
      assert.equal(salesList.response.status, 200);
      assert.deepEqual(
        salesList.body.data.salesOrders.map((order) => order.id),
        ['order-own-today'],
      );
      assert.equal(
        salesList.body.data.salesOrders[0].canEditByCurrentUser,
        true,
      );

      for (const id of [
        'order-own-yesterday',
        'order-created-by-only',
        'order-other-today',
      ]) {
        const detail = await requestJson(baseUrl, `/api/sales-orders/${id}`, {
          token: sales.token,
        });
        assertErrorContract(detail, 404, 'SALES_ORDER_NOT_FOUND');
      }

      const ownSheet = await requestJson(
        baseUrl,
        '/api/sales-orders/order-own-today/sales-sheet',
        { token: sales.token },
      );
      assert.equal(ownSheet.response.status, 200);
      const otherSheet = await requestJson(
        baseUrl,
        '/api/sales-orders/order-other-today/sales-sheet',
        { token: sales.token },
      );
      assertErrorContract(otherSheet, 404, 'SALES_ORDER_NOT_FOUND');
      const otherQr = await requestJson(
        baseUrl,
        '/api/sales-orders/order-other-today/qr-code',
        {
          method: 'DELETE',
          token: sales.token,
        },
      );
      assertErrorContract(otherQr, 404, 'SALES_ORDER_NOT_FOUND');

      const salesGroups = await requestJson(baseUrl, '/api/travel-groups', {
        token: sales.token,
      });
      assert.equal(salesGroups.response.status, 200);
      assert.deepEqual(
        new Set(salesGroups.body.data.travelGroups.map((group) => group.id)),
        new Set(['group-today-reception', 'group-today-liaison']),
      );
      assert.equal(
        salesGroups.body.data.travelGroups.every(
          (group) => group.canEditByCurrentUser === false,
        ),
        true,
      );
      assert.equal(
        salesGroups.body.data.travelGroups.every(
          (group) =>
            group.parkingFeeCents === 500 &&
            group.cigaretteFeeCents === 100,
        ),
        true,
      );
      const salesPastGroup = await requestJson(
        baseUrl,
        '/api/travel-groups/group-yesterday',
        { token: sales.token },
      );
      assertErrorContract(salesPastGroup, 404, 'TRAVEL_GROUP_NOT_FOUND');

      const tasterGroups = await requestJson(baseUrl, '/api/travel-groups', {
        token: taster.token,
      });
      assert.equal(tasterGroups.response.status, 200);
      assert.deepEqual(
        new Set(tasterGroups.body.data.travelGroups.map((group) => group.id)),
        new Set([
          'group-today-reception',
          'group-today-liaison',
          'group-future-reception',
        ]),
      );
      const tasterPastGroup = await requestJson(
        baseUrl,
        '/api/travel-groups/group-yesterday',
        { token: taster.token },
      );
      assertErrorContract(tasterPastGroup, 404, 'TRAVEL_GROUP_NOT_FOUND');

      const tasterOrders = await requestJson(baseUrl, '/api/sales-orders', {
        token: taster.token,
      });
      assert.equal(tasterOrders.response.status, 200);
      assert.deepEqual(
        new Set(tasterOrders.body.data.salesOrders.map((order) => order.id)),
        new Set([
          'order-own-today',
          'order-created-by-only',
          'order-future-reception',
        ]),
      );
      const liaisonOrders = await requestJson(baseUrl, '/api/sales-orders', {
        token: liaison.token,
      });
      assert.equal(liaisonOrders.response.status, 200);
      assert.deepEqual(liaisonOrders.body.data.salesOrders, []);
    },
    {
      prisma: buildScopeFixture(dates),
    },
  );
});

test('contract: sales edit and taster edits atomically share their limits', async () => {
  const dates = shanghaiFixtureDates();
  await withPhase1Server(
    async (baseUrl) => {
      const sales = await login(baseUrl, 'scope-sales-one', 'Password123');
      const taster = await login(
        baseUrl,
        'scope-taster-reception',
        'Password123',
      );
      const liaison = await login(
        baseUrl,
        'scope-taster-liaison',
        'Password123',
      );

      const invalidSalesEdit = await requestJson(
        baseUrl,
        '/api/sales-orders/order-sales-invalid/sales-edit',
        {
          method: 'PATCH',
          token: sales.token,
          body: { salesUserId: SALES_TWO_ID },
        },
      );
      assertErrorContract(invalidSalesEdit, 403, 'FIELD_PERMISSION_DENIED');
      const unchanged = await requestJson(
        baseUrl,
        '/api/sales-orders/order-sales-invalid',
        { token: sales.token },
      );
      assert.equal(unchanged.body.data.salesOrder.salesEditCount, 0);

      const firstSalesEdit = await requestJson(
        baseUrl,
        '/api/sales-orders/order-sales-edit/sales-edit',
        {
          method: 'PATCH',
          token: sales.token,
          body: {
            remark: 'first and only sales edit',
            logisticsMethod: '自提',
            logisticsProviderCode: 'self_carry',
            packingStatus: 'packed',
            packageCount: 1,
          },
        },
      );
      assert.equal(firstSalesEdit.response.status, 200);
      assert.equal(firstSalesEdit.body.data.salesOrder.salesEditCount, 1);
      assert.equal(firstSalesEdit.body.data.salesOrder.salesEditRemaining, 0);
      assert.equal(
        firstSalesEdit.body.data.salesOrder.canEditByCurrentUser,
        false,
      );
      const secondSalesEdit = await requestJson(
        baseUrl,
        '/api/sales-orders/order-sales-edit/sales-edit',
        {
          method: 'PATCH',
          token: sales.token,
          body: { remark: 'must fail' },
        },
      );
      assertErrorContract(
        secondSalesEdit,
        409,
        'SALES_ORDER_EDIT_LIMIT_REACHED',
      );

      const concurrentSales = await Promise.all([
        requestJson(
          baseUrl,
          '/api/sales-orders/order-sales-concurrent/sales-edit',
          {
            method: 'PATCH',
            token: sales.token,
            body: { remark: 'concurrent A' },
          },
        ),
        requestJson(
          baseUrl,
          '/api/sales-orders/order-sales-concurrent/sales-edit',
          {
            method: 'PATCH',
            token: sales.token,
            body: { remark: 'concurrent B' },
          },
        ),
      ]);
      assert.deepEqual(
        concurrentSales.map((result) => result.response.status).sort(),
        [200, 409],
      );

      const receptionEdit = await requestJson(
        baseUrl,
        '/api/travel-groups/group-taster-shared',
        {
          method: 'PATCH',
          token: taster.token,
          body: { guestCount: 21, expectedArrivalTime: '10:30' },
        },
      );
      assert.equal(receptionEdit.response.status, 200);
      assert.equal(receptionEdit.body.data.travelGroup.tasterEditCount, 1);
      const liaisonSummary = await requestJson(
        baseUrl,
        '/api/travel-groups/group-taster-shared/taster-summary',
        {
          method: 'POST',
          token: liaison.token,
          body: { tasterSummary: 'shared second edit' },
        },
      );
      assert.equal(liaisonSummary.response.status, 201);
      assert.equal(liaisonSummary.body.data.travelGroup.tasterEditCount, 2);
      assert.equal(liaisonSummary.body.data.travelGroup.tasterEditRemaining, 0);
      const thirdEdit = await requestJson(
        baseUrl,
        '/api/travel-groups/group-taster-shared',
        {
          method: 'PATCH',
          token: taster.token,
          body: { remarks: 'third edit' },
        },
      );
      assertErrorContract(
        thirdEdit,
        409,
        'TRAVEL_GROUP_TASTER_EDIT_LIMIT_REACHED',
      );

      const concurrentTaster = await Promise.all([
        requestJson(
          baseUrl,
          '/api/travel-groups/group-taster-last-slot',
          {
            method: 'PATCH',
            token: taster.token,
            body: { remarks: 'last slot A' },
          },
        ),
        requestJson(
          baseUrl,
          '/api/travel-groups/group-taster-last-slot/taster-summary',
          {
            method: 'POST',
            token: liaison.token,
            body: { tasterSummary: 'last slot B' },
          },
        ),
      ]);
      const concurrentTasterStatuses = concurrentTaster.map(
        (result) => result.response.status,
      );
      assert.equal(
        concurrentTasterStatuses.filter((status) => status === 409).length,
        1,
      );
      assert.equal(
        concurrentTasterStatuses.filter((status) =>
          [200, 201].includes(status),
        ).length,
        1,
      );

      const futureEdit = await requestJson(
        baseUrl,
        '/api/travel-groups/group-future-reception',
        {
          method: 'PATCH',
          token: taster.token,
          body: { remarks: 'future denied' },
        },
      );
      assertErrorContract(
        futureEdit,
        403,
        'TRAVEL_GROUP_EDIT_DATE_NOT_ALLOWED',
      );
      const forbiddenField = await requestJson(
        baseUrl,
        '/api/travel-groups/group-taster-forbidden',
        {
          method: 'PATCH',
          token: taster.token,
          body: { cigaretteFeeCents: 500 },
        },
      );
      assertErrorContract(forbiddenField, 403, 'FIELD_PERMISSION_DENIED');
      const forbiddenUnchanged = await requestJson(
        baseUrl,
        '/api/travel-groups/group-taster-forbidden',
        { token: taster.token },
      );
      assert.equal(
        forbiddenUnchanged.body.data.travelGroup.tasterEditCount,
        0,
      );
    },
    {
      prisma: buildLimitFixture(dates),
    },
  );
});

test('contract: boss and after-sales are order read-only and sales cannot use legacy writes', async () => {
  const dates = shanghaiFixtureDates();
  await withPhase1Server(
    async (baseUrl) => {
      const actors = [
        await login(baseUrl, 'scope-sales-one', 'Password123'),
        await login(baseUrl, 'scope-boss', 'Password123'),
        await login(baseUrl, 'scope-after-sales', 'Password123'),
      ];
      const paths = [
        '/api/sales-orders/order-own-today',
        '/api/sales-orders/order-own-today/finance',
        '/api/sales-orders/order-own-today/packing',
        '/api/sales-orders/order-own-today/status',
      ];
      for (const actor of actors) {
        for (const path of paths) {
          const denied = await requestJson(baseUrl, path, {
            method: 'PATCH',
            token: actor.token,
            body: path.endsWith('/status')
              ? { status: 'cancelled' }
              : { remark: 'denied' },
          });
          assertErrorContract(denied, 403, 'PERMISSION_DENIED');
        }
      }

      const afterSalesCreate = await requestJson(
        baseUrl,
        '/api/sales-orders',
        {
          method: 'POST',
          token: actors[2].token,
          body: {},
        },
      );
      assertErrorContract(afterSalesCreate, 403, 'PERMISSION_DENIED');
      const bossCreate = await requestJson(baseUrl, '/api/sales-orders', {
        method: 'POST',
        token: actors[1].token,
        body: {},
      });
      assertErrorContract(bossCreate, 403, 'PERMISSION_DENIED');

      const salesCreate = await requestJson(baseUrl, '/api/sales-orders', {
        method: 'POST',
        token: actors[0].token,
        body: {
          orderType: 'travel_group',
          travelGroupId: 'group-today-reception',
          orderDate: dates.today,
          salesUserId: SALES_TWO_ID,
          customer: {
            name: 'sales forced owner customer',
          },
          items: [
            {
              productName: 'sales forced owner product',
              quantity: 1,
              unitPriceCents: 100,
              deliveryType: 'self_pickup',
            },
          ],
        },
      });
      assert.equal(salesCreate.response.status, 201);
      assert.equal(
        salesCreate.body.data.salesOrder.salesUserId,
        SALES_ONE_ID,
      );
      const pastGroupCreate = await requestJson(
        baseUrl,
        '/api/sales-orders',
        {
          method: 'POST',
          token: actors[0].token,
          body: {
            orderType: 'travel_group',
            travelGroupId: 'group-yesterday',
            orderDate: dates.today,
            customer: { name: 'past group denied customer' },
            items: [
              {
                productName: 'sales forced owner product',
                quantity: 1,
                unitPriceCents: 100,
                deliveryType: 'self_pickup',
              },
            ],
          },
        },
      );
      assertErrorContract(
        pastGroupCreate,
        403,
        'SALES_ORDER_TRAVEL_GROUP_DATE_NOT_ALLOWED',
      );
    },
    {
      prisma: buildScopeFixture(dates),
    },
  );
});

function buildScopeFixture(dates) {
  return {
    users: fixtureUsers(),
    travelGroups: [
      group('group-yesterday', dates.yesterday, TASTER_RECEPTION_ID),
      group('group-today-reception', dates.today, TASTER_RECEPTION_ID),
      group(
        'group-today-liaison',
        dates.today,
        TASTER_OTHER_ID,
        TASTER_LIAISON_ID,
      ),
      group('group-future-reception', dates.tomorrow, TASTER_RECEPTION_ID),
    ],
    salesOrders: [
      order(
        'order-own-today',
        'group-today-reception',
        SALES_ONE_ID,
        SALES_TWO_ID,
        dates.todayCreatedAt,
      ),
      order(
        'order-own-yesterday',
        'group-yesterday',
        SALES_ONE_ID,
        SALES_ONE_ID,
        dates.yesterdayCreatedAt,
      ),
      order(
        'order-created-by-only',
        'group-today-reception',
        SALES_TWO_ID,
        SALES_ONE_ID,
        dates.todayCreatedAt,
      ),
      order(
        'order-other-today',
        'group-today-liaison',
        SALES_TWO_ID,
        SALES_TWO_ID,
        dates.todayCreatedAt,
      ),
      order(
        'order-future-reception',
        'group-future-reception',
        SALES_TWO_ID,
        SALES_TWO_ID,
        dates.todayCreatedAt,
      ),
    ],
  };
}

function buildLimitFixture(dates) {
  return {
    users: fixtureUsers(),
    travelGroups: [
      group(
        'group-taster-shared',
        dates.today,
        TASTER_RECEPTION_ID,
        TASTER_LIAISON_ID,
      ),
      {
        ...group(
          'group-taster-last-slot',
          dates.today,
          TASTER_RECEPTION_ID,
          TASTER_LIAISON_ID,
        ),
        tasterEditCount: 1,
      },
      group(
        'group-taster-forbidden',
        dates.today,
        TASTER_RECEPTION_ID,
        TASTER_LIAISON_ID,
      ),
      group('group-future-reception', dates.tomorrow, TASTER_RECEPTION_ID),
    ],
    salesOrders: [
      order(
        'order-sales-edit',
        'group-taster-shared',
        SALES_ONE_ID,
        SALES_ONE_ID,
        dates.todayCreatedAt,
      ),
      order(
        'order-sales-concurrent',
        'group-taster-shared',
        SALES_ONE_ID,
        SALES_ONE_ID,
        dates.todayCreatedAt,
      ),
      order(
        'order-sales-invalid',
        'group-taster-shared',
        SALES_ONE_ID,
        SALES_ONE_ID,
        dates.todayCreatedAt,
      ),
    ],
  };
}

function fixtureUsers() {
  return [
    user(SALES_ONE_ID, 'scope-sales-one', 'sales'),
    user(SALES_TWO_ID, 'scope-sales-two', 'sales'),
    user(TASTER_RECEPTION_ID, 'scope-taster-reception', 'taster'),
    user(TASTER_LIAISON_ID, 'scope-taster-liaison', 'taster'),
    user(TASTER_OTHER_ID, 'scope-taster-other', 'taster'),
    user('usr_scope_boss', 'scope-boss', 'boss'),
    user('usr_scope_after_sales', 'scope-after-sales', 'after_sales'),
  ];
}

function user(id, username, role) {
  return {
    id,
    name: username,
    username,
    password: 'Password123',
    role,
  };
}

function group(id, visitDate, tasterId, liaisonTasterId = null) {
  return {
    id,
    groupNo: id,
    visitDate,
    tasterId,
    liaisonTasterId,
    financeMark: false,
    parkingFeeCents: 500,
    cigaretteFeeCents: 100,
  };
}

function order(
  id,
  travelGroupId,
  salesUserId,
  createdById,
  createdAt,
) {
  return {
    id,
    orderNo: id,
    orderType: 'TRAVEL_GROUP',
    travelGroupId,
    orderDate: createdAt.slice(0, 10),
    salesUserId,
    createdById,
    createdAt,
    financeMark: false,
    customerName: id,
    packingStatus: 'PACKED',
    items: [],
  };
}

function shanghaiFixtureDates() {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const todayUtc = Date.parse(`${today}T00:00:00.000Z`);
  const dateAtOffset = (offset) =>
    new Date(todayUtc + offset * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  return {
    yesterday: dateAtOffset(-1),
    today,
    tomorrow: dateAtOffset(1),
    yesterdayCreatedAt: `${dateAtOffset(-1)}T04:00:00.000Z`,
    todayCreatedAt: `${today}T04:00:00.000Z`,
  };
}
