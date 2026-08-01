const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SPECIAL_ORDER_CREATOR_ROLES,
  SPECIAL_ORDER_READ_ROLES,
  SPECIAL_ORDER_REVIEW_ROLES,
  canSpecialOrderTransition,
  claimSpecialOrderTransition,
  normalizeLogisticsCode,
  requestHash,
  requiredInteger,
  requiredReason,
  requireSpecialOrderRead,
} = require('../src/modules/special-orders/special-order.policy');

test('special-order role matrix grants only creators and reviewers', () => {
  assert.deepEqual(
    [...SPECIAL_ORDER_READ_ROLES].sort(),
    ['admin', 'after_sales', 'boss', 'finance', 'sales', 'super_admin'],
  );
  assert.deepEqual(
    [...SPECIAL_ORDER_CREATOR_ROLES].sort(),
    ['admin', 'after_sales', 'boss', 'finance', 'sales', 'super_admin'],
  );
  assert.deepEqual(
    [...SPECIAL_ORDER_REVIEW_ROLES].sort(),
    ['admin', 'boss', 'finance', 'super_admin'],
  );
  for (const role of ['warehouse', 'front_desk', 'taster']) {
    assert.throws(
      () => requireSpecialOrderRead({ id: `user-${role}`, role }),
      (error) =>
        error.statusCode === 403 &&
        error.code === 'SPECIAL_ORDER_PERMISSION_DENIED',
    );
  }
});

test('special-order workflow contains only the declared transitions', () => {
  const allowed = [
    ['DRAFT', 'PENDING'],
    ['DRAFT', 'CANCELLED'],
    ['PENDING', 'DRAFT'],
    ['PENDING', 'APPROVED'],
    ['PENDING', 'REJECTED'],
    ['REJECTED', 'PENDING'],
    ['REJECTED', 'CANCELLED'],
    ['APPROVED', 'COMPLETED'],
    ['APPROVED', 'PENDING'],
    ['COMPLETED', 'PENDING'],
    ['COMPLETED', 'CANCELLED'],
  ];
  for (const [from, to] of allowed) {
    assert.equal(canSpecialOrderTransition(from, to), true, `${from} -> ${to}`);
  }
  for (const [from, to] of [
    ['DRAFT', 'APPROVED'],
    ['REJECTED', 'APPROVED'],
    ['CANCELLED', 'PENDING'],
  ]) {
    assert.equal(canSpecialOrderTransition(from, to), false, `${from} -> ${to}`);
  }
});

test('optimistic workflow claim allows only one concurrent reviewer', async () => {
  const row = {
    id: 'order-1',
    workflowStatus: 'PENDING',
    workflowVersion: 4,
  };
  const delegate = {
    async updateMany({ where, data }) {
      await Promise.resolve();
      if (
        row.id !== where.id ||
        row.workflowStatus !== where.workflowStatus ||
        row.workflowVersion !== where.workflowVersion
      ) {
        return { count: 0 };
      }
      Object.assign(row, data);
      return { count: 1 };
    },
  };
  const claims = await Promise.allSettled([
    claimSpecialOrderTransition(delegate, {
      id: row.id,
      fromStatus: 'PENDING',
      toStatus: 'APPROVED',
      expectedVersion: 4,
    }),
    claimSpecialOrderTransition(delegate, {
      id: row.id,
      fromStatus: 'PENDING',
      toStatus: 'APPROVED',
      expectedVersion: 4,
    }),
  ]);
  assert.equal(claims.filter((result) => result.status === 'fulfilled').length, 1);
  const rejection = claims.find((result) => result.status === 'rejected');
  assert.equal(rejection.reason.statusCode, 409);
  assert.equal(rejection.reason.code, 'SPECIAL_ORDER_VERSION_CONFLICT');
  assert.equal(row.workflowStatus, 'APPROVED');
  assert.equal(row.workflowVersion, 5);
});

test('idempotency hashes are canonical and reused keys cannot hide input changes', () => {
  assert.equal(
    requestHash({ orderType: 'buyback', items: [{ quantity: 1 }] }),
    requestHash({ items: [{ quantity: 1 }], orderType: 'buyback' }),
  );
  assert.notEqual(
    requestHash({ orderType: 'buyback', items: [{ quantity: 1 }] }),
    requestHash({ orderType: 'buyback', items: [{ quantity: 2 }] }),
  );
});

test('quantity, negative adjustment reason, and logistics codes are strict', () => {
  assert.throws(
    () => requiredInteger(0, 'quantity', { nonZero: true }),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () => requiredReason('', 'adjustmentReason'),
    (error) => error.statusCode === 400,
  );
  assert.deepEqual(normalizeLogisticsCode(' mt 001 ', 'code'), {
    snapshot: 'mt 001',
    normalized: 'MT001',
  });
});
