const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  login,
  requestJson: rawRequestJson,
  requestJsonWithStage10ProductFixtures: requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

const SALES_ONE_ID = 'usr_scope_sales_one';
const SALES_TWO_ID = 'usr_scope_sales_two';
const TASTER_RECEPTION_ID = 'usr_scope_taster_reception';
const TASTER_LIAISON_ID = 'usr_scope_taster_liaison';
const TASTER_OTHER_ID = 'usr_scope_taster_other';

test('contract: sales and taster retain their own data scopes under global mark filtering', async () => {
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
        new Set(salesList.body.data.salesOrders.map((order) => order.id)),
        new Set(['order-own-today', 'order-own-unmarked-group']),
      );
      assert.equal(
        salesList.body.data.salesOrders[0].canEditByCurrentUser,
        true,
      );

      for (const id of [
        'order-own-yesterday',
        'order-own-unmarked',
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
        new Set([
          'group-yesterday',
          'group-today-reception',
          'group-today-liaison',
        ]),
      );
      assert.equal(
        salesGroups.body.data.travelGroups.every(
          (group) => group.canEditByCurrentUser === true,
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
      assert.equal(salesPastGroup.response.status, 200);
      assert.equal(
        salesPastGroup.body.data.travelGroup.pendingStatus,
        'pending_sales',
      );

      const tasterGroups = await requestJson(baseUrl, '/api/travel-groups', {
        token: taster.token,
      });
      assert.equal(tasterGroups.response.status, 200);
      assert.deepEqual(
        new Set(tasterGroups.body.data.travelGroups.map((group) => group.id)),
        new Set([
          'group-yesterday',
          'group-today-reception',
          'group-future-reception',
        ]),
      );
      const tasterPastGroup = await requestJson(
        baseUrl,
        '/api/travel-groups/group-yesterday',
        { token: taster.token },
      );
      assert.equal(tasterPastGroup.response.status, 200);

      const tasterOrders = await requestJson(baseUrl, '/api/sales-orders', {
        token: taster.token,
      });
      assert.equal(tasterOrders.response.status, 200);
      assert.deepEqual(
        new Set(tasterOrders.body.data.salesOrders.map((order) => order.id)),
        new Set([
          'order-own-today',
          'order-own-unmarked-group',
          'order-created-by-only',
          'order-future-reception',
        ]),
      );
      const tasterUnmarkedOrder = await requestJson(
        baseUrl,
        '/api/sales-orders/order-own-unmarked',
        { token: taster.token },
      );
      assertErrorContract(
        tasterUnmarkedOrder,
        404,
        'SALES_ORDER_NOT_FOUND',
      );
      const tasterUnmarkedGroup = await requestJson(
        baseUrl,
        '/api/travel-groups/group-global-unmarked',
        { token: taster.token },
      );
      assertErrorContract(
        tasterUnmarkedGroup,
        404,
        'TRAVEL_GROUP_NOT_FOUND',
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

test('contract: taster travel group list, detail, orders, and writes share the supplement lifecycle permission matrix', async () => {
  const dates = shanghaiFixtureDates();
  const travelGroups = [
    group('matrix-past-reception', dates.yesterday, TASTER_RECEPTION_ID),
    group(
      'matrix-past-liaison-only',
      dates.yesterday,
      TASTER_OTHER_ID,
      TASTER_LIAISON_ID,
    ),
    {
      ...group(
        'matrix-past-liaison-completed',
        dates.yesterday,
        TASTER_OTHER_ID,
        TASTER_LIAISON_ID,
      ),
      departureTime: '16:00',
      lossStatus: 'NO_LOSS',
    },
    {
      ...group(
        'matrix-today-public-null',
        dates.today,
        TASTER_OTHER_ID,
        TASTER_LIAISON_ID,
      ),
      arrivalTime: null,
    },
    {
      ...group(
        'matrix-today-public-empty',
        dates.today,
        TASTER_OTHER_ID,
        TASTER_LIAISON_ID,
      ),
      arrivalTime: '',
    },
    group(
      'matrix-today-arrived-hidden',
      dates.today,
      TASTER_OTHER_ID,
      TASTER_LIAISON_ID,
    ),
    group('matrix-today-reception', dates.today, TASTER_RECEPTION_ID),
    group(
      'matrix-today-liaison',
      dates.today,
      TASTER_OTHER_ID,
      TASTER_RECEPTION_ID,
    ),
    group(
      'matrix-future-liaison',
      dates.tomorrow,
      TASTER_OTHER_ID,
      TASTER_RECEPTION_ID,
    ),
    group(
      'matrix-future-reception',
      dates.tomorrow,
      TASTER_RECEPTION_ID,
      TASTER_OTHER_ID,
    ),
    group(
      'matrix-future-public',
      dates.tomorrow,
      TASTER_OTHER_ID,
      TASTER_LIAISON_ID,
    ),
  ];

  await withPhase1Server(
    async (baseUrl) => {
      const reception = await login(
        baseUrl,
        'scope-taster-reception',
        'Password123',
      );
      const liaison = await login(
        baseUrl,
        'scope-taster-liaison',
        'Password123',
      );

      const list = await requestJson(baseUrl, '/api/travel-groups', {
        token: reception.token,
      });
      assert.equal(list.response.status, 200);
      const listedById = new Map(
        list.body.data.travelGroups.map((travelGroup) => [
          travelGroup.id,
          travelGroup,
        ]),
      );
      assert.deepEqual(
        new Set(listedById.keys()),
        new Set([
          'matrix-past-reception',
          'matrix-today-public-null',
          'matrix-today-public-empty',
          'matrix-today-reception',
          'matrix-today-liaison',
          'matrix-future-liaison',
          'matrix-future-reception',
          'matrix-future-public',
        ]),
      );
      for (const id of [
        'matrix-past-reception',
        'matrix-today-reception',
        'matrix-today-liaison',
        'matrix-future-liaison',
        'matrix-future-reception',
      ]) {
        assert.equal(listedById.get(id).canEditByCurrentUser, true, id);
      }
      for (const id of [
        'matrix-today-public-null',
        'matrix-today-public-empty',
        'matrix-future-public',
      ]) {
        assert.equal(listedById.get(id).canEditByCurrentUser, false, id);
      }

      for (const id of listedById.keys()) {
        const detail = await requestJson(
          baseUrl,
          `/api/travel-groups/${id}`,
          { token: reception.token },
        );
        assert.equal(detail.response.status, 200, id);
        assert.equal(
          detail.body.data.travelGroup.canEditByCurrentUser,
          listedById.get(id).canEditByCurrentUser,
          id,
        );
      }

      const pastLiaisonOnly = await requestJson(
        baseUrl,
        '/api/travel-groups/matrix-past-liaison-only',
        { token: liaison.token },
      );
      assert.equal(pastLiaisonOnly.response.status, 200);
      assert.equal(
        pastLiaisonOnly.body.data.travelGroup.canEditByCurrentUser,
        true,
      );
      const completedPastLiaison = await requestJson(
        baseUrl,
        '/api/travel-groups/matrix-past-liaison-completed',
        { token: liaison.token },
      );
      assertErrorContract(
        completedPastLiaison,
        404,
        'TRAVEL_GROUP_NOT_FOUND',
      );
      const arrivedPublic = await requestJson(
        baseUrl,
        '/api/travel-groups/matrix-today-arrived-hidden',
        { token: reception.token },
      );
      assertErrorContract(
        arrivedPublic,
        404,
        'TRAVEL_GROUP_NOT_FOUND',
      );

      for (const id of [
        'matrix-past-reception',
        'matrix-today-reception',
        'matrix-today-liaison',
        'matrix-future-liaison',
        'matrix-future-reception',
      ]) {
        const edited = await requestJson(
          baseUrl,
          `/api/travel-groups/${id}`,
          {
            method: 'PATCH',
            token: reception.token,
            body: { remarks: `editable ${id}` },
          },
        );
        assert.equal(edited.response.status, 200, id);
      }

      const futureSummary = await requestJson(
        baseUrl,
        '/api/travel-groups/matrix-future-liaison/taster-summary',
        {
          method: 'POST',
          token: reception.token,
          body: { tasterSummary: 'future liaison summary' },
        },
      );
      assert.equal(futureSummary.response.status, 201);
      const futureForbiddenField = await requestJson(
        baseUrl,
        '/api/travel-groups/matrix-future-liaison',
        {
          method: 'PATCH',
          token: reception.token,
          body: { visitDate: dates.today },
        },
      );
      assertErrorContract(
        futureForbiddenField,
        403,
        'FIELD_PERMISSION_DENIED',
      );

      for (const id of [
        'matrix-today-public-null',
        'matrix-future-public',
      ]) {
        const denied = await requestJson(
          baseUrl,
          `/api/travel-groups/${id}`,
          {
            method: 'PATCH',
            token: reception.token,
            body: { remarks: `denied ${id}` },
          },
        );
        assertErrorContract(denied, 403, 'PERMISSION_DENIED');
      }

      const publicFutureDetail = await requestJson(
        baseUrl,
        '/api/travel-groups/matrix-future-public',
        { token: reception.token },
      );
      assert.equal(publicFutureDetail.response.status, 200);
      assert.deepEqual(
        publicFutureDetail.body.data.travelGroup.salesOrders,
        [],
      );
      assert.equal(
        publicFutureDetail.body.data.travelGroup.orderSummary.orderCount,
        0,
      );
    },
    {
      prisma: {
        users: fixtureUsers(),
        travelGroups,
        salesOrders: [
          order(
            'matrix-public-future-order',
            'matrix-future-public',
            SALES_ONE_ID,
            SALES_ONE_ID,
            dates.todayCreatedAt,
          ),
        ],
      },
    },
  );
});

test('contract: taster edit capability follows supplement state across dates and relationships', async () => {
  const dates = shanghaiFixtureDates();
  const dateCases = [
    ['past', dates.yesterday],
    ['today', dates.today],
    ['future', dates.tomorrow],
  ];
  const supplementCases = [
    ['empty-pending', null, 'PENDING', true],
    ['departure-pending', '16:00', 'PENDING', true],
    ['empty-recorded', null, 'RECORDED', true],
    ['empty-no-loss', null, 'NO_LOSS', true],
    ['departure-recorded', '16:00', 'RECORDED', false],
    ['departure-no-loss', '16:00', 'NO_LOSS', false],
  ];
  const travelGroups = [];
  for (const [dateKey, visitDate] of dateCases) {
    for (const [stateKey, departureTime, lossStatus] of supplementCases) {
      for (const relationship of ['reception', 'liaison', 'unrelated']) {
        const id = `lifecycle-${dateKey}-${relationship}-${stateKey}`;
        const assignment =
          relationship === 'reception'
            ? [TASTER_RECEPTION_ID, TASTER_OTHER_ID]
            : relationship === 'liaison'
              ? [TASTER_OTHER_ID, TASTER_RECEPTION_ID]
              : [TASTER_OTHER_ID, TASTER_LIAISON_ID];
        travelGroups.push({
          ...group(id, visitDate, assignment[0], assignment[1]),
          arrivalTime: relationship === 'unrelated' ? null : '09:00',
          departureTime,
          lossStatus,
        });
      }
    }
  }

  await withPhase1Server(
    async (baseUrl) => {
      const taster = await login(
        baseUrl,
        'scope-taster-reception',
        'Password123',
      );
      const list = await requestJson(
        baseUrl,
        '/api/travel-groups?limit=100',
        { token: taster.token },
      );
      assert.equal(list.response.status, 200);
      const listedById = new Map(
        list.body.data.travelGroups.map((travelGroup) => [
          travelGroup.id,
          travelGroup,
        ]),
      );

      for (const [dateKey] of dateCases) {
        for (const [stateKey, , , incomplete] of supplementCases) {
          for (const relationship of ['reception', 'liaison', 'unrelated']) {
            const id = `lifecycle-${dateKey}-${relationship}-${stateKey}`;
            const historicalLiaisonHidden =
              dateKey === 'past' && relationship === 'liaison' && !incomplete;
            const historicalUnrelatedHidden =
              dateKey === 'past' && relationship === 'unrelated';
            if (historicalLiaisonHidden || historicalUnrelatedHidden) {
              assert.equal(listedById.has(id), false, id);
              continue;
            }
            assert.equal(listedById.has(id), true, id);
            assert.equal(
              listedById.get(id).canEditByCurrentUser,
              relationship !== 'unrelated' && incomplete,
              id,
            );
            const detail = await requestJson(
              baseUrl,
              `/api/travel-groups/${id}`,
              { token: taster.token },
            );
            assert.equal(detail.response.status, 200, id);
            assert.equal(
              detail.body.data.travelGroup.canEditByCurrentUser,
              listedById.get(id).canEditByCurrentUser,
              id,
            );
          }
        }
      }

      for (const [dateKey] of dateCases) {
        for (const [stateKey, , , incomplete] of supplementCases) {
          const id = `lifecycle-${dateKey}-reception-${stateKey}`;
          const patch = await requestJson(
            baseUrl,
            `/api/travel-groups/${id}`,
            {
              method: 'PATCH',
              token: taster.token,
              body: { remarks: `patched ${id}` },
            },
          );
          if (incomplete) {
            assert.equal(patch.response.status, 200, id);
          } else {
            assertErrorContract(
              patch,
              403,
              'TRAVEL_GROUP_TASTER_EDIT_CLOSED',
            );
          }
        }
      }

      const completedSummary = await requestJson(
        baseUrl,
        '/api/travel-groups/lifecycle-today-liaison-departure-recorded/taster-summary',
        {
          method: 'POST',
          token: taster.token,
          body: { tasterSummary: 'must be rejected after completion' },
        },
      );
      assertErrorContract(
        completedSummary,
        403,
        'TRAVEL_GROUP_TASTER_EDIT_CLOSED',
      );

      const unrelatedPatch = await requestJson(
        baseUrl,
        '/api/travel-groups/lifecycle-today-unrelated-empty-pending',
        {
          method: 'PATCH',
          token: taster.token,
          body: { remarks: 'unrelated write must fail' },
        },
      );
      assertErrorContract(unrelatedPatch, 403, 'PERMISSION_DENIED');
    },
    {
      prisma: {
        users: fixtureUsers(),
        travelGroups,
      },
    },
  );
});

test('contract: transaction scope blocks a taster write when sales completes the supplement after the initial read', async () => {
  const dates = shanghaiFixtureDates();
  await withPhase1Server(
    async (baseUrl, { prisma }) => {
      const sales = await login(baseUrl, 'scope-sales-one', 'Password123');
      const taster = await login(
        baseUrl,
        'scope-taster-reception',
        'Password123',
      );
      const originalTransaction = prisma.$transaction.bind(prisma);
      let salesCompletionInjected = false;
      let salesCompletionResponse;
      prisma.$transaction = async (operations) => {
        if (!salesCompletionInjected && typeof operations === 'function') {
          salesCompletionInjected = true;
          salesCompletionResponse = await requestJson(
            baseUrl,
            '/api/travel-groups/group-supplement-race',
            {
              method: 'PATCH',
              token: sales.token,
              body: {
                departureTime: '16:30',
                lossStatus: 'NO_LOSS',
              },
            },
          );
        }
        return originalTransaction(operations);
      };

      const tasterWrite = await requestJson(
        baseUrl,
        '/api/travel-groups/group-supplement-race',
        {
          method: 'PATCH',
          token: taster.token,
          body: { remarks: 'must not cross the sales completion boundary' },
        },
      );
      assert.equal(salesCompletionInjected, true);
      assert.equal(salesCompletionResponse.response.status, 200);
      assertErrorContract(
        tasterWrite,
        403,
        'TRAVEL_GROUP_TASTER_EDIT_CLOSED',
      );

      const detail = await requestJson(
        baseUrl,
        '/api/travel-groups/group-supplement-race',
        { token: taster.token },
      );
      assert.equal(detail.response.status, 200);
      assert.equal(detail.body.data.travelGroup.departureTime, '16:30');
      assert.equal(detail.body.data.travelGroup.lossStatus, 'NO_LOSS');
      assert.equal(detail.body.data.travelGroup.remarks, null);
      assert.equal(
        detail.body.data.travelGroup.canEditByCurrentUser,
        false,
      );
    },
    {
      prisma: {
        users: fixtureUsers(),
        travelGroups: [
          group(
            'group-supplement-race',
            dates.today,
            TASTER_RECEPTION_ID,
          ),
        ],
      },
    },
  );
});

test('contract: sales keeps one edit while assigned tasters can edit without a limit', async () => {
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
      const otherTaster = await login(
        baseUrl,
        'scope-taster-other',
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

      for (let index = 1; index <= 3; index += 1) {
        const receptionEdit = await requestJson(
          baseUrl,
          '/api/travel-groups/group-taster-shared',
          {
            method: 'PATCH',
            token: taster.token,
            body: {
              guestCount: 20 + index,
              remarks: `reception edit ${index}`,
            },
          },
        );
        assert.equal(receptionEdit.response.status, 200);
        assert.equal(receptionEdit.body.data.travelGroup.tasterEditCount, 2);
        assert.equal(receptionEdit.body.data.travelGroup.tasterEditLimit, null);
        assert.equal(
          receptionEdit.body.data.travelGroup.tasterEditRemaining,
          null,
        );
        assert.equal(
          receptionEdit.body.data.travelGroup.tasterEditUnlimited,
          true,
        );
        assert.equal(
          receptionEdit.body.data.travelGroup.canEditByCurrentUser,
          true,
        );
      }

      for (let index = 1; index <= 2; index += 1) {
        const liaisonSummary = await requestJson(
          baseUrl,
          '/api/travel-groups/group-taster-shared/taster-summary',
          {
            method: 'POST',
            token: liaison.token,
            body: { tasterSummary: `liaison summary ${index}` },
          },
        );
        assert.equal(liaisonSummary.response.status, 201);
        assert.equal(liaisonSummary.body.data.travelGroup.tasterEditCount, 2);
        assert.equal(
          liaisonSummary.body.data.travelGroup.tasterEditUnlimited,
          true,
        );
        assert.equal(
          liaisonSummary.body.data.travelGroup.canEditByCurrentUser,
          true,
        );
      }

      const liaisonEdit = await requestJson(
        baseUrl,
        '/api/travel-groups/group-taster-shared',
        {
          method: 'PATCH',
          token: liaison.token,
          body: { expectedArrivalTime: '10:30' },
        },
      );
      assert.equal(liaisonEdit.response.status, 200);
      assert.equal(liaisonEdit.body.data.travelGroup.tasterEditCount, 2);

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
      assert.deepEqual(concurrentTasterStatuses.sort(), [200, 201]);

      const futureEdit = await requestJson(
        baseUrl,
        '/api/travel-groups/group-future-reception',
        {
          method: 'PATCH',
          token: taster.token,
          body: { remarks: 'future reception allowed' },
        },
      );
      assert.equal(futureEdit.response.status, 200);
      const unrelatedEdit = await requestJson(
        baseUrl,
        '/api/travel-groups/group-taster-shared',
        {
          method: 'PATCH',
          token: otherTaster.token,
          body: { remarks: 'unrelated denied' },
        },
      );
      assertErrorContract(
        unrelatedEdit,
        404,
        'TRAVEL_GROUP_NOT_FOUND',
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

test('contract: staged front-desk completion gates orders and sales confirms loss explicitly', async () => {
  const dates = shanghaiFixtureDates();
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const frontDesk = await login(
        baseUrl,
        'scope-front-desk',
        'Password123',
      );
      const sales = await login(baseUrl, 'scope-sales-one', 'Password123');
      const orderBody = {
        orderType: 'travel_group',
        travelGroupId: 'group-incomplete',
        orderDate: dates.today,
        customer: { name: '分阶段补录客户' },
        items: [
          {
            productName: '订单商品',
            quantity: 1,
            unitPriceCents: 100,
            deliveryType: 'self_pickup',
          },
        ],
      };

      const blockedOrder = await requestJson(baseUrl, '/api/sales-orders', {
        method: 'POST',
        token: admin.token,
        body: orderBody,
      });
      assertErrorContract(
        blockedOrder,
        409,
        'TRAVEL_GROUP_FRONT_DESK_INFO_INCOMPLETE',
      );
      assert.deepEqual(
        blockedOrder.body.error.missingFields,
        [
          'licensePlate',
          'guestCount',
          'cigaretteFeeCents',
          'tastingRoomNo',
          'tasterId',
          'arrivalTime',
          'groupType',
        ],
      );

      const firstPartialSave = await requestJson(
        baseUrl,
        '/api/travel-groups/group-incomplete',
        {
          method: 'PATCH',
          token: frontDesk.token,
          body: { licensePlate: '贵A88888' },
        },
      );
      assert.equal(firstPartialSave.response.status, 200);
      assert.equal(
        firstPartialSave.body.data.travelGroup.pendingStatus,
        'pending_front_desk',
      );
      assert.equal(
        firstPartialSave.body.data.travelGroup.pendingReasons.includes(
          'missing_license_plate',
        ),
        false,
      );

      const completedFrontDesk = await requestJson(
        baseUrl,
        '/api/travel-groups/group-incomplete',
        {
          method: 'PATCH',
          token: frontDesk.token,
          body: {
            guestCount: 12,
            cigaretteFeeCents: 100,
            tastingRoomNo: 'A08',
            tasterId: TASTER_RECEPTION_ID,
            arrivalTime: '09:00',
            groupType: '其他',
          },
        },
      );
      assert.equal(completedFrontDesk.response.status, 200);
      assert.equal(
        completedFrontDesk.body.data.travelGroup.pendingStatus,
        'pending_sales',
      );

      const createdOrder = await requestJson(baseUrl, '/api/sales-orders', {
        method: 'POST',
        token: admin.token,
        body: orderBody,
      });
      assert.equal(createdOrder.response.status, 201);

      const frontDeskLossDenied = await requestJson(
        baseUrl,
        '/api/travel-groups/group-incomplete',
        {
          method: 'PATCH',
          token: frontDesk.token,
          body: {
            tastingItems: [
              {
                productName: '罐装酒',
                quantity: 1,
                unit: '瓶',
              },
            ],
          },
        },
      );
      assertErrorContract(
        frontDeskLossDenied,
        403,
        'FIELD_PERMISSION_DENIED',
      );

      const salesFrontFieldDenied = await requestJson(
        baseUrl,
        '/api/travel-groups/group-incomplete',
        {
          method: 'PATCH',
          token: sales.token,
          body: { licensePlate: '贵A99999' },
        },
      );
      assertErrorContract(
        salesFrontFieldDenied,
        403,
        'FIELD_PERMISSION_DENIED',
      );

      const recordedLoss = await rawRequestJson(
        baseUrl,
        '/api/travel-groups/group-incomplete',
        {
          method: 'PATCH',
          token: sales.token,
          body: {
            departureTime: '16:00',
            tastingItems: [
              {
                productName: '罐装酒',
                quantity: 2,
                unit: '瓶',
              },
            ],
          },
        },
      );
      assert.equal(recordedLoss.response.status, 200);
      assert.equal(recordedLoss.body.data.travelGroup.lossStatus, 'RECORDED');
      assert.equal(
        recordedLoss.body.data.travelGroup.lossConfirmedById,
        SALES_ONE_ID,
      );
      assert.equal(
        typeof recordedLoss.body.data.travelGroup.lossConfirmedAt,
        'string',
      );
      assert.deepEqual(
        recordedLoss.body.data.travelGroup.tastingItems.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unit: item.unit,
        })),
        [
          {
            productId: null,
            productName: '罐装酒',
            quantity: 2,
            unit: '瓶',
          },
        ],
      );

      const noLoss = await requestJson(
        baseUrl,
        '/api/travel-groups/group-no-loss',
        {
          method: 'PATCH',
          token: sales.token,
          body: {
            departureTime: '16:00',
            lossStatus: 'NO_LOSS',
          },
        },
      );
      assert.equal(noLoss.response.status, 200);
      assert.equal(noLoss.body.data.travelGroup.lossStatus, 'NO_LOSS');
      assert.equal(
        noLoss.body.data.travelGroup.lossConfirmedById,
        SALES_ONE_ID,
      );

      const emptyUnconfirmed = await requestJson(
        baseUrl,
        '/api/travel-groups/group-empty-unconfirmed',
        {
          method: 'PATCH',
          token: sales.token,
          body: {
            departureTime: '16:00',
            tastingItems: [],
          },
        },
      );
      assert.equal(emptyUnconfirmed.response.status, 200);
      assert.equal(
        emptyUnconfirmed.body.data.travelGroup.lossStatus,
        'PENDING',
      );
      assert.equal(
        emptyUnconfirmed.body.data.travelGroup.pendingStatus,
        'pending_sales',
      );
      assert.ok(
        emptyUnconfirmed.body.data.travelGroup.pendingReasons.includes(
          'loss_not_confirmed',
        ),
      );

      const pastPending = await requestJson(
        baseUrl,
        '/api/travel-groups/group-past-pending',
        { token: sales.token },
      );
      assert.equal(pastPending.response.status, 200);
      const completedPast = await requestJson(
        baseUrl,
        '/api/travel-groups/group-past-pending',
        {
          method: 'PATCH',
          token: sales.token,
          body: {
            departureTime: '16:00',
            lossStatus: 'NO_LOSS',
          },
        },
      );
      assert.equal(completedPast.response.status, 200);
      const hiddenPast = await requestJson(
        baseUrl,
        '/api/travel-groups/group-past-pending',
        { token: sales.token },
      );
      assertErrorContract(hiddenPast, 404, 'TRAVEL_GROUP_NOT_FOUND');
    },
    {
      prisma: {
        users: [
          ...fixtureUsers(),
          user('usr_scope_front_desk', 'scope-front-desk', 'front_desk'),
        ],
        travelGroups: [
          {
            ...group(
              'group-incomplete',
              dates.today,
              TASTER_RECEPTION_ID,
            ),
            licensePlate: null,
            guestCount: 0,
            cigaretteFeeCents: null,
            tastingRoomNo: null,
            tasterId: null,
            arrivalTime: null,
            groupType: null,
          },
          group('group-no-loss', dates.today, TASTER_RECEPTION_ID),
          group(
            'group-empty-unconfirmed',
            dates.today,
            TASTER_RECEPTION_ID,
          ),
          group(
            'group-past-pending',
            dates.yesterday,
            TASTER_RECEPTION_ID,
          ),
        ],
      },
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
      {
        ...group(
          'group-global-unmarked',
          dates.today,
          TASTER_RECEPTION_ID,
        ),
        financeMark: false,
      },
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
      order(
        'order-own-unmarked',
        'group-today-reception',
        SALES_ONE_ID,
        SALES_ONE_ID,
        dates.todayCreatedAt,
        false,
      ),
      order(
        'order-own-unmarked-group',
        'group-global-unmarked',
        SALES_ONE_ID,
        SALES_ONE_ID,
        dates.todayCreatedAt,
      ),
    ],
  };
}

function buildLimitFixture(dates) {
  return {
    users: fixtureUsers(),
    travelGroups: [
      {
        ...group(
          'group-taster-shared',
          dates.today,
          TASTER_RECEPTION_ID,
          TASTER_LIAISON_ID,
        ),
        tasterEditCount: 2,
      },
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
    licensePlate: '贵A12345',
    guestCount: 10,
    tastingRoomNo: 'A01',
    arrivalTime: '09:00',
    groupType: '其他',
    financeMark: true,
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
  financeMark = true,
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
    financeMark,
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
