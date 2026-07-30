const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SpecialOrdersNestService,
} = require('../src/modules/special-orders/special-orders.nest.service');

test('special-order self scope returns 404 instead of revealing another creator order', async () => {
  const prisma = {
    salesOrder: {
      async findUnique() {
        return {
          id: 'special-order-owned-by-another-user',
          orderType: 'INTERNAL',
          workflowStatus: 'DRAFT',
          workflowVersion: 0,
          createdById: 'sales-owner',
        };
      },
    },
  };
  const service = new SpecialOrdersNestService(prisma, {}, {}, {});

  await assert.rejects(
    service.get(
      { id: 'sales-other', role: 'sales' },
      'special-order-owned-by-another-user',
    ),
    (error) =>
      error.statusCode === 404 &&
      error.code === 'SPECIAL_ORDER_NOT_FOUND',
  );
});

test('roles outside the special-order matrix are rejected before repository access', async () => {
  let repositoryRead = false;
  const prisma = {
    salesOrder: {
      async findUnique() {
        repositoryRead = true;
        return null;
      },
    },
  };
  const service = new SpecialOrdersNestService(prisma, {}, {}, {});

  await assert.rejects(
    service.get({ id: 'finance-user', role: 'finance' }, 'any-order'),
    (error) =>
      error.statusCode === 403 &&
      error.code === 'SPECIAL_ORDER_PERMISSION_DENIED',
  );
  assert.equal(repositoryRead, false);
});
