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

test('today travel group menu is exposed only to front desk', () => {
  const frontDeskMenu = getRoleMenus('front_desk').find(
    (item) => item.id === 'today_travel_groups',
  );
  assert.ok(frontDeskMenu);
  assert.equal(frontDeskMenu.title, '今日旅行团');

  for (const role of [
    'super_admin',
    'admin',
    'boss',
    'sales',
    'finance',
    'warehouse',
    'after_sales',
    'taster',
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

test('contract: front desk today endpoint filters dates, sorts by arrival time and id, and returns only display fields', async () => {
  const dates = shanghaiFixtureDates();
  await withPhase1Server(
    async (baseUrl) => {
      const missingToken = await requestJson(
        baseUrl,
        '/api/travel-groups/today',
      );
      assertErrorContract(missingToken, 401, 'AUTH_TOKEN_REQUIRED');

      const admin = await login(baseUrl);
      const adminResult = await requestJson(
        baseUrl,
        '/api/travel-groups/today',
        { token: admin.token },
      );
      assertErrorContract(adminResult, 403, 'PERMISSION_DENIED');

      const sales = await login(baseUrl, 'today-sales', 'Password123');
      const salesResult = await requestJson(
        baseUrl,
        '/api/travel-groups/today',
        { token: sales.token },
      );
      assertErrorContract(salesResult, 403, 'PERMISSION_DENIED');

      const frontDesk = await login(
        baseUrl,
        'today-front-desk',
        'Password123',
      );
      const result = await requestJson(
        baseUrl,
        '/api/travel-groups/today',
        { token: frontDesk.token },
      );
      assert.equal(result.response.status, 200);
      assert.deepEqual(Object.keys(result.body.data), ['travelGroups']);
      assert.deepEqual(
        result.body.data.travelGroups.map((group) => group.licensePlate),
        ['贵A0800', '贵A0900A', '贵A0900B', null],
      );
      for (const group of result.body.data.travelGroups) {
        assert.deepEqual(Object.keys(group).sort(), [
          'cigaretteFeeCents',
          'licensePlate',
          'tasterName',
          'tastingRoomNo',
        ]);
      }
      assert.deepEqual(result.body.data.travelGroups[0], {
        licensePlate: '贵A0800',
        tasterName: '早班品鉴师',
        tastingRoomNo: 'A08',
        cigaretteFeeCents: 2050,
      });
      assert.deepEqual(result.body.data.travelGroups.at(-1), {
        licensePlate: null,
        tasterName: null,
        tastingRoomNo: null,
        cigaretteFeeCents: null,
      });
    },
    {
      prisma: {
        users: [
          user('today-front-desk', 'front_desk'),
          user('today-sales', 'sales'),
        ],
        travelGroups: [
          group('yesterday', dates.yesterday, '23:59', '贵A昨天'),
          group('today-early', dates.today, '08:00', '贵A0800', {
            tasterName: '早班品鉴师',
            tastingRoomNo: 'A08',
            cigaretteFeeCents: 2050,
          }),
          group('today-same-b', dates.today, '09:00', '贵A0900B'),
          group('today-same-a', dates.today, '09:00', '贵A0900A'),
          group('today-empty', dates.today, '10:00', null, {
            tasterName: null,
            tastingRoomNo: null,
            cigaretteFeeCents: null,
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
