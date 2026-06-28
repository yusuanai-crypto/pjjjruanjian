const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildTravelGroupNoPrefix,
  generateTravelGroupNo,
  withGeneratedTravelGroupNo,
} = require('../src/modules/business-data/travel-group-no.helper');

test('unit: travel group number formats visitDate as TGyyyyMMddNNN', async () => {
  const delegate = createGroupNoDelegate([]);

  assert.equal(buildTravelGroupNoPrefix('2026-06-27'), 'TG20260627');
  assert.equal(await generateTravelGroupNo(delegate, '2026-06-27'), 'TG20260627001');
  assert.equal(await generateTravelGroupNo(delegate, new Date('2026-06-28T00:00:00.000Z')), 'TG20260628001');
});

test('unit: travel group number increments independently for different visit dates', async () => {
  const delegate = createGroupNoDelegate([
    'TG20260627001',
    'TG20260627002',
    'TG20260628001',
  ]);

  assert.equal(await generateTravelGroupNo(delegate, '2026-06-27'), 'TG20260627003');
  assert.equal(await generateTravelGroupNo(delegate, '2026-06-28'), 'TG20260628002');
  assert.equal(await generateTravelGroupNo(delegate, '2026-06-29'), 'TG20260629001');
});

test('unit: travel group number uses max existing serial and ignores non-matching legacy numbers', async () => {
  const delegate = createGroupNoDelegate([
    'GZ-0627-999',
    'TG20260627001',
    'TG202606270009',
    'TG20260627010',
    'TG20260627ABC',
    'TG20260628099',
  ]);

  assert.equal(await generateTravelGroupNo(delegate, '2026-06-27'), 'TG20260627011');
});

test('unit: travel group number helper retries once after unique groupNo conflict', async () => {
  const delegate = createGroupNoDelegate(['TG20260627001']);
  const attempts = [];

  const created = await withGeneratedTravelGroupNo(delegate, '2026-06-27', async (groupNo, attempt) => {
    attempts.push(groupNo);
    if (attempt === 0) {
      delegate.insert(groupNo);
      const error = new Error('Unique constraint failed on groupNo');
      error.code = 'P2002';
      error.meta = {
        target: ['groupNo'],
      };
      throw error;
    }
    delegate.insert(groupNo);
    return {
      groupNo,
    };
  });

  assert.deepEqual(attempts, ['TG20260627002', 'TG20260627003']);
  assert.deepEqual(created, {
    groupNo: 'TG20260627003',
  });
});

test('unit: travel group number helper does not retry unrelated errors', async () => {
  const delegate = createGroupNoDelegate([]);
  let attempts = 0;

  await assert.rejects(
    () =>
      withGeneratedTravelGroupNo(delegate, '2026-06-27', async () => {
        attempts += 1;
        throw new Error('database is unavailable');
      }),
    /database is unavailable/,
  );
  assert.equal(attempts, 1);
});

function createGroupNoDelegate(initialGroupNos) {
  const groupNos = [...initialGroupNos];
  return {
    async findMany({ where }) {
      const prefix = where.groupNo.startsWith;
      return groupNos
        .filter((groupNo) => groupNo.startsWith(prefix))
        .sort()
        .reverse()
        .map((groupNo) => ({ groupNo }));
    },
    insert(groupNo) {
      groupNos.push(groupNo);
    },
  };
}
