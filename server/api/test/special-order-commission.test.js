const assert = require('node:assert/strict');
const test = require('node:test');

const {
  multiplyCentsByRate,
  SpecialOrderCommissionService,
} = require('../src/modules/commissions/special-order-commission.service');

test('manual order commissions calculate in integer cents with half-up rounding', () => {
  assert.equal(multiplyCentsByRate(10_001, 0.1234), 1_234);
  assert.equal(multiplyCentsByRate(1, 0.5), 1);
  assert.equal(multiplyCentsByRate(10_000, 1.5), 15_000);
});

test('manual order commission maintenance is restricted to finance, boss and administrators', () => {
  const service = new SpecialOrderCommissionService({}, {});

  for (const role of ['finance', 'boss', 'admin', 'super_admin']) {
    assert.equal(service.canMaintain({ role }), true, role);
  }
  for (const role of ['sales', 'after_sales', 'warehouse']) {
    assert.equal(service.canMaintain({ role }), false, role);
  }
});

test('legacy external orders without a workflow marker never enter special commission recalculation', async () => {
  const service = new SpecialOrderCommissionService({}, {});
  const result = await service.applyAfterSalesInTransaction(
    {},
    {
      salesOrderId: 'legacy-order',
      salesOrder: { orderType: 'EXTERNAL', workflowStatus: null },
    },
    { id: 'finance-1', role: 'finance' },
  );

  assert.deepEqual(result, { recordIds: [] });
});

test('one partial refund recalculates every recipient once with distinct ledger keys', async () => {
  const records = [
    {
      id: 'commission-a',
      rateSnapshot: 0.1,
      baseAmountCents: 10_000,
      amountCents: 1_000,
      recipientType: 'EMPLOYEE',
      recipientNameSnapshot: '员工甲',
    },
    {
      id: 'commission-b',
      rateSnapshot: 0.2,
      baseAmountCents: 10_000,
      amountCents: 2_000,
      recipientType: 'OTHER',
      recipientNameSnapshot: '外部乙',
    },
  ];
  const updates = [];
  const adjustments = [];
  const tx = {
    salesOrder: {
      async findUnique() {
        return {
          id: 'special-order-1',
          orderType: 'INTERNAL',
          workflowStatus: 'COMPLETED',
          status: 'VALID',
          orderNo: 'SOI20260801001',
          orderDate: new Date('2026-08-01T00:00:00.000Z'),
          totalAmountCents: 10_000,
          afterSalesOrders: [
            {
              id: 'refund-1',
              refundAmountCents: 2_000,
              financeConfirmed: true,
            },
          ],
        };
      },
    },
    commissionRecord: {
      async findMany() {
        return records;
      },
      async update({ where, data }) {
        updates.push({ id: where.id, data });
        const current = records.find((record) => record.id === where.id);
        return { ...current, ...data };
      },
    },
    commissionAdjustment: {
      async findUnique() {
        return null;
      },
      async create({ data }) {
        adjustments.push(data);
        return data;
      },
    },
  };
  const service = new SpecialOrderCommissionService({}, {});

  const result = await service.recalculateOrderInTransaction(
    tx,
    'special-order-1',
    { id: 'finance-1', name: '财务', role: 'finance' },
    { operationKey: 'refund:refund-1', adjustmentType: 'REFUND' },
  );

  assert.deepEqual(result.recordIds, ['commission-a', 'commission-b']);
  assert.deepEqual(
    updates.map((update) => update.data.amountCents),
    [800, 1_600],
  );
  assert.deepEqual(
    adjustments.map((adjustment) => adjustment.operationKey),
    [
      'refund:refund-1:commission-a',
      'refund:refund-1:commission-b',
    ],
  );
  assert.deepEqual(
    adjustments.map((adjustment) => adjustment.adjustmentAmountCents),
    [200, 400],
  );
});
