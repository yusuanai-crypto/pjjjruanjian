const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeAgencyName,
  planAgencyRebateRuleBackfill,
  backfillAgencyRebateRuleAgencyIds,
} = require('../scripts/backfill-agency-rebate-rule-agency-ids.ts');

test('unit: agency rebate backfill only plans unique normalized name matches', () => {
  const plan = planAgencyRebateRuleBackfill(
    [
      { id: 'bound', agencyId: 'agency-existing', agencyName: '不应覆盖' },
      { id: 'unique', agencyId: null, agencyName: ' 甲 旅行社 ' },
      { id: 'missing', agencyId: null, agencyName: '未建档旅行社' },
      { id: 'ambiguous', agencyId: null, agencyName: '乙旅行社' },
      { id: 'blank', agencyId: null, agencyName: '   ' },
    ],
    [
      { id: 'agency-a', name: '甲旅行社' },
      { id: 'agency-b-1', name: '乙旅行社' },
      { id: 'agency-b-2', name: '乙 旅行社' },
    ],
  );

  assert.equal(normalizeAgencyName(' 甲 旅行社 '), '甲旅行社');
  assert.equal(plan.alreadyBoundRuleCount, 1);
  assert.deepEqual(plan.updates, [
    {
      ruleId: 'unique',
      previousAgencyName: '甲 旅行社',
      agencyId: 'agency-a',
      agencyName: '甲旅行社',
    },
  ]);
  assert.deepEqual(
    plan.manualReview.map((item) => [item.ruleId, item.reason]),
    [
      ['missing', 'NO_MATCH'],
      ['ambiguous', 'AMBIGUOUS_MATCH'],
      ['blank', 'MISSING_AGENCY_NAME'],
    ],
  );
  assert.deepEqual(
    plan.manualReview.find((item) => item.ruleId === 'ambiguous').candidates,
    [
      { id: 'agency-b-1', name: '乙旅行社' },
      { id: 'agency-b-2', name: '乙 旅行社' },
    ],
  );
});

test('unit: agency rebate backfill is dry-run by default and apply never overwrites an id', async () => {
  const updates = [];
  const prisma = {
    $queryRawUnsafe: async () => [{ databaseName: 'jiangjiu_test' }],
    agencyRebateRule: {
      findMany: async () => [
        { id: 'legacy', agencyId: null, agencyName: '甲旅行社' },
        { id: 'bound', agencyId: 'agency-bound', agencyName: '甲旅行社' },
      ],
    },
    travelAgency: {
      findMany: async () => [{ id: 'agency-a', name: '甲旅行社' }],
    },
    $transaction: async (callback) =>
      callback({
        agencyRebateRule: {
          updateMany: async (input) => {
            updates.push(input);
            return { count: 1 };
          },
        },
      }),
  };

  const dryRun = await backfillAgencyRebateRuleAgencyIds(prisma, {
    now: new Date('2026-08-01T00:00:00.000Z'),
  });
  assert.equal(dryRun.mode, 'DRY_RUN');
  assert.equal(dryRun.uniqueMatchCount, 1);
  assert.equal(dryRun.appliedRuleCount, 0);
  assert.equal(updates.length, 0);

  await assert.rejects(
    backfillAgencyRebateRuleAgencyIds(prisma, {
      apply: true,
      environment: 'test',
      expectedDatabase: 'jiangjiu_test',
    }),
    /confirmed-backup/,
  );

  const applied = await backfillAgencyRebateRuleAgencyIds(prisma, {
    apply: true,
    environment: 'test',
    expectedDatabase: 'jiangjiu_test',
    backupConfirmed: true,
  });
  assert.equal(applied.appliedRuleCount, 1);
  assert.deepEqual(updates, [
    {
      where: { id: 'legacy', agencyId: null },
      data: { agencyId: 'agency-a', agencyName: '甲旅行社' },
    },
  ]);
});
