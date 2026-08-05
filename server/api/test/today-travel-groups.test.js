const assert = require('node:assert/strict');
const test = require('node:test');

const { getRoleMenus } = require('../src/modules/auth/roles');
const {
  buildShanghaiTodayDatabaseRange,
} = require('../src/modules/business-data/front-desk-travel-group-read-policy.helper');
const {
  assertErrorContract,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

test('today travel group menu is exposed only to the allowed role matrix', () => {
  for (const role of [
    'super_admin',
    'admin',
    'boss',
    'front_desk',
    'sales',
    'taster',
  ]) {
    const menu = getRoleMenus(role).find(
      (item) => item.id === 'today_travel_groups',
    );
    assert.ok(menu, role);
    assert.equal(menu.title, '今日旅行团');
  }

  for (const role of [
    'finance',
    'warehouse',
    'after_sales',
  ]) {
    assert.equal(
      getRoleMenus(role).some((item) => item.id === 'today_travel_groups'),
      false,
      role,
    );
  }
});

test('today database range follows the Asia/Shanghai natural-day boundary and uses an exclusive end', () => {
  const beforeMidnight = buildShanghaiTodayDatabaseRange(
    new Date('2026-08-04T15:59:59.999Z'),
  );
  assert.equal(beforeMidnight.start.toISOString(), '2026-08-04T00:00:00.000Z');
  assert.equal(beforeMidnight.end.toISOString(), '2026-08-05T00:00:00.000Z');

  const atMidnight = buildShanghaiTodayDatabaseRange(
    new Date('2026-08-04T16:00:00.000Z'),
  );
  assert.equal(atMidnight.start.toISOString(), '2026-08-05T00:00:00.000Z');
  assert.equal(atMidnight.end.toISOString(), '2026-08-06T00:00:00.000Z');
});

test('contract: allowed roles receive only today display fields in entered-first stable order', async () => {
  const dates = shanghaiFixtureDates();
  await withPhase1Server(
    async (baseUrl) => {
      const missingToken = await requestJson(
        baseUrl,
        '/api/travel-groups/today',
      );
      assertErrorContract(missingToken, 401, 'AUTH_TOKEN_REQUIRED');

      const allowedAccounts = [
        ['super_admin', 'today-super-admin'],
        ['admin', null],
        ['boss', 'today-boss'],
        ['front_desk', 'today-front-desk'],
        ['sales', 'today-sales'],
        ['taster', 'today-taster'],
      ];
      const expectedGroupNos = [
        'entered-0800',
        'entered-0900-a',
        'entered-0900-b',
        'pending-0700',
        'pending-1000-a',
        'pending-1000-b',
        'pending-no-time',
      ];
      let result;
      for (const [role, username] of allowedAccounts) {
        const session = username
          ? await login(baseUrl, username, 'Password123')
          : await login(baseUrl);
        const roleResult = await requestJson(
          baseUrl,
          '/api/travel-groups/today',
          { token: session.token },
        );
        assert.equal(roleResult.response.status, 200, role);
        assert.deepEqual(
          roleResult.body.data.travelGroups.map((group) => group.groupNo),
          expectedGroupNos,
          role,
        );
        result ||= roleResult;
      }

      for (const [role, username] of [
        ['finance', 'today-finance'],
        ['warehouse', 'today-warehouse'],
        ['after_sales', 'today-after-sales'],
      ]) {
        const session = await login(baseUrl, username, 'Password123');
        const forbidden = await requestJson(
          baseUrl,
          '/api/travel-groups/today',
          { token: session.token },
        );
        assertErrorContract(forbidden, 403, 'PERMISSION_DENIED');
      }

      assert.deepEqual(Object.keys(result.body.data), ['travelGroups']);
      assert.deepEqual(
        result.body.data.travelGroups.map((group) => group.groupNo),
        expectedGroupNos,
      );
      for (const group of result.body.data.travelGroups) {
        assert.deepEqual(Object.keys(group).sort(), [
          'arrivalTime',
          'cigaretteFeeCents',
          'expectedArrivalTime',
          'groupNo',
          'licensePlate',
          'tasterName',
          'tastingRoomNo',
        ]);
      }
      assert.deepEqual(result.body.data.travelGroups[0], {
        arrivalTime: '08:00',
        licensePlate: '贵A0800',
        tasterName: '早班品鉴师',
        tastingRoomNo: 'A08',
        cigaretteFeeCents: 2050,
        groupNo: 'entered-0800',
        expectedArrivalTime: '07:45',
      });
      assert.deepEqual(result.body.data.travelGroups.at(-1), {
        arrivalTime: null,
        licensePlate: null,
        tasterName: null,
        tastingRoomNo: null,
        cigaretteFeeCents: null,
        groupNo: 'pending-no-time',
        expectedArrivalTime: null,
      });
    },
    {
      prisma: {
        users: [
          user('today-super-admin', 'super_admin'),
          user('today-boss', 'boss'),
          user('today-front-desk', 'front_desk'),
          user('today-sales', 'sales'),
          user('today-taster', 'taster'),
          user('today-finance', 'finance'),
          user('today-warehouse', 'warehouse'),
          user('today-after-sales', 'after_sales'),
        ],
        travelGroups: [
          group('yesterday', dates.yesterday, '23:59', '贵A昨天'),
          group('entered-0800', dates.today, '08:00', '贵A0800', {
            tasterName: '早班品鉴师',
            tastingRoomNo: 'A08',
            cigaretteFeeCents: 2050,
            expectedArrivalTime: '07:45',
          }),
          group('entered-0900-b', dates.today, '09:00', '贵A0900B'),
          group('entered-0900-a', dates.today, '09:00', '贵A0900A'),
          group('pending-1000-b', dates.today, null, '贵A1000B', {
            expectedArrivalTime: '10:00',
          }),
          group('pending-0700', dates.today, '', '贵A0700', {
            expectedArrivalTime: '07:00',
          }),
          group('pending-1000-a', dates.today, null, '贵A1000A', {
            expectedArrivalTime: '10:00',
          }),
          group('pending-no-time', dates.today, null, null, {
            tasterName: null,
            tastingRoomNo: null,
            cigaretteFeeCents: null,
            expectedArrivalTime: null,
          }),
          group('tomorrow-cross-midnight', dates.tomorrow, '00:01', '贵A明天'),
          group('future', dates.future, '12:00', '贵A未来'),
        ],
      },
    },
  );
});

function user(username, role) {
  return {
    id: `usr-${username}`,
    name: username,
    username,
    password: 'Password123',
    role,
  };
}

function group(id, visitDate, arrivalTime, licensePlate, overrides = {}) {
  return {
    id,
    groupNo: id,
    visitDate,
    arrivalTime,
    licensePlate,
    tasterName: '默认品鉴师',
    tastingRoomNo: 'A01',
    cigaretteFeeCents: 100,
    financeMark: true,
    ...overrides,
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
  const atOffset = (days) =>
    new Date(todayUtc + days * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  return {
    yesterday: atOffset(-1),
    today,
    tomorrow: atOffset(1),
    future: atOffset(7),
  };
}
