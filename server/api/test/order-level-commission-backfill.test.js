const assert = require('node:assert/strict');
const test = require('node:test');

const {
  backfillOrderLevelCommissions,
} = require('../scripts/backfill-order-level-commissions');

test('migration: order-level commission backfill is dry-run safe, preserves amounts, and is idempotent', async () => {
  const prisma = backfillPrisma([
    record('outreach-assigned', 'OUTREACH_COMMISSION', 'user-outreach', 700),
    record('outreach-order-level', 'OUTREACH_COMMISSION', null, 500, 2),
    record('leader-assigned', 'LEADER_COMMISSION', 'user-leader', 200),
  ]);
  const now = new Date('2026-08-02T01:02:03.000Z');

  const dryRun = await backfillOrderLevelCommissions(prisma, { now });
  assert.equal(dryRun.mode, 'DRY_RUN');
  assert.equal(dryRun.scannedRecordCount, 3);
  assert.equal(dryRun.affectedScopeCount, 2);
  assert.equal(dryRun.affectedOrderCount, 1);
  assert.equal(dryRun.duplicateRecords.length, 1);
  assert.deepEqual(dryRun.amountDifferences, [
    {
      salesOrderId: 'order-1',
      orderNo: 'SO-1',
      targetType: 'OUTREACH_COMMISSION',
      activeRecordCount: 2,
      activeTotalCents: 1200,
      canonicalAmountCents: 500,
      differenceCents: 700,
    },
  ]);
  assert.equal(prisma.__updateCount, 0);

  const applied = await backfillOrderLevelCommissions(prisma, {
    apply: true,
    now,
  });
  assert.equal(applied.mode, 'APPLY');
  assert.equal(applied.appliedScopeCount, 2);
  assert.equal(prisma.__updateCount, 3);

  const outreachCanonical = prisma.__records.find(
    (item) => item.id === 'outreach-order-level',
  );
  assert.equal(outreachCanonical.targetUserId, null);
  assert.equal(outreachCanonical.amountCents, 500);
  assert.equal(
    outreachCanonical.automaticScopeKey,
    'sales-order:order-1:OUTREACH_COMMISSION:automatic',
  );
  assert.equal(outreachCanonical.isActive, true);
  assert.equal(
    outreachCanonical.sourceSnapshot.orderLevelCommissionMigration.action,
    'canonicalized_order_level_accrual',
  );

  const outreachDuplicate = prisma.__records.find(
    (item) => item.id === 'outreach-assigned',
  );
  assert.equal(outreachDuplicate.amountCents, 700);
  assert.equal(outreachDuplicate.targetUserId, 'user-outreach');
  assert.equal(outreachDuplicate.isActive, false);
  assert.equal(
    outreachDuplicate.sourceSnapshot.orderLevelCommissionMigration.action,
    'duplicate_deactivated',
  );

  const leader = prisma.__records.find(
    (item) => item.id === 'leader-assigned',
  );
  assert.equal(leader.targetUserId, null);
  assert.equal(leader.amountCents, 200);
  assert.equal(
    leader.automaticScopeKey,
    'sales-order:order-1:LEADER_COMMISSION:automatic',
  );

  const repeated = await backfillOrderLevelCommissions(prisma, {
    apply: true,
    now: new Date('2026-08-03T01:02:03.000Z'),
  });
  assert.equal(repeated.affectedScopeCount, 0);
  assert.equal(repeated.appliedScopeCount, 0);
  assert.equal(prisma.__updateCount, 3);
});

function record(id, targetType, targetUserId, amountCents, day = 1) {
  return {
    id,
    salesOrderId: 'order-1',
    targetType,
    targetUserId,
    automaticScopeKey: null,
    amountCents,
    manualInput: false,
    isActive: true,
    deactivatedAt: null,
    sourceSnapshot: { original: id },
    createdAt: new Date(`2026-07-0${day}T00:00:00.000Z`),
    salesOrder: { orderNo: 'SO-1' },
  };
}

function backfillPrisma(seed) {
  const records = seed.map((item) => structuredClone(item));
  let updateCount = 0;
  const delegate = {
    findMany: async ({ where } = {}) =>
      records
        .filter((item) => matches(item, where || {}))
        .map((item) => structuredClone(item)),
    update: async ({ where, data }) => {
      const item = records.find((candidate) => candidate.id === where.id);
      if (!item) throw new Error(`missing record ${where.id}`);
      Object.assign(item, structuredClone(data));
      updateCount += 1;
      return structuredClone(item);
    },
  };
  return {
    commissionRecord: delegate,
    $transaction: async (run) => run({ commissionRecord: delegate }),
    get __records() {
      return records;
    },
    get __updateCount() {
      return updateCount;
    },
  };
}

function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && Array.isArray(value.in)) {
      return value.in.includes(row[key]);
    }
    if (value && typeof value === 'object' && value.not !== undefined) {
      return row[key] !== value.not;
    }
    return row[key] === value;
  });
}
