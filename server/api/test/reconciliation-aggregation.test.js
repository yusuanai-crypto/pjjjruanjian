const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BOOTSTRAP_ADMIN_PASSWORD,
  assertErrorContract,
  createUser,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

test('reconciliation aggregates order types, confirmed refunds, manual receipts, and review state', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      await createUser(baseUrl, admin.token, {
        name: 'Reconciliation Finance',
        username: 'reconciliation-finance',
        password: BOOTSTRAP_ADMIN_PASSWORD,
        role: 'finance',
      });
      const finance = await login(
        baseUrl,
        'reconciliation-finance',
        BOOTSTRAP_ADMIN_PASSWORD,
      );

      const initial = await requestJson(
        baseUrl,
        '/api/reconciliations/2026-06-23',
        { token: finance.token },
      );
      assert.equal(initial.response.status, 200);
      assert.deepEqual(
        pickAmounts(initial.body.data.reconciliation),
        {
          travelGroupSalesCents: 100000,
          backOfficeSalesCents: 0,
          buybackCents: 20000,
          externalSalesCents: 30000,
          internalPurchaseCents: 40000,
          afterSalesCents: 50000,
          refundsCents: 15000,
          receivableTotalCents: 225000,
          actualTotalCents: 0,
          differenceCents: -225000,
        },
      );
      assert.equal(initial.body.data.reconciliation.timezone, 'Asia/Shanghai');
      assert.equal(initial.body.data.reconciliation.status, 'pending_review');
      assert.equal('otherReceivableCents' in initial.body.data.reconciliation, false);

      const reviewBeforeFinanceSubmission = await requestJson(
        baseUrl,
        '/api/reconciliations/2026-06-23/review',
        { method: 'POST', token: admin.token },
      );
      assertErrorContract(
        reviewBeforeFinanceSubmission,
        409,
        'RECONCILIATION_NOT_SUBMITTED',
      );

      const adminManualWrite = await requestJson(
        baseUrl,
        '/api/reconciliations/2026-06-23',
        {
          method: 'PUT',
          token: admin.token,
          body: { backOfficeSalesCents: 6000, paymentMethods: [] },
        },
      );
      assertErrorContract(adminManualWrite, 403, 'PERMISSION_DENIED');

      const automaticFieldWrite = await requestJson(
        baseUrl,
        '/api/reconciliations/2026-06-23',
        {
          method: 'PUT',
          token: finance.token,
          body: {
            travelGroupSalesCents: 1,
            backOfficeSalesCents: 6000,
            paymentMethods: [],
          },
        },
      );
      assertErrorContract(
        automaticFieldWrite,
        403,
        'FIELD_PERMISSION_DENIED',
      );

      const saved = await requestJson(
        baseUrl,
        '/api/reconciliations/2026-06-23',
        {
          method: 'PUT',
          token: finance.token,
          body: {
            backOfficeSalesCents: 6000,
            notes: 'finance entered receipts',
            paymentMethods: [
              { name: 'cash', amountCents: 100000, sortOrder: 1 },
              { name: 'wechat', amountCents: 130000, sortOrder: 2 },
            ],
          },
        },
      );
      assert.equal(saved.response.status, 200);
      assert.deepEqual(pickAmounts(saved.body.data.reconciliation), {
        travelGroupSalesCents: 100000,
        backOfficeSalesCents: 6000,
        buybackCents: 20000,
        externalSalesCents: 30000,
        internalPurchaseCents: 40000,
        afterSalesCents: 50000,
        refundsCents: 15000,
        receivableTotalCents: 231000,
        actualTotalCents: 230000,
        differenceCents: -1000,
      });
      assert.equal(saved.body.data.reconciliation.reviewStatus, 'pending_review');

      const financeReview = await requestJson(
        baseUrl,
        '/api/reconciliations/2026-06-23/review',
        { method: 'POST', token: finance.token },
      );
      assertErrorContract(financeReview, 403, 'PERMISSION_DENIED');

      const reviewed = await requestJson(
        baseUrl,
        '/api/reconciliations/2026-06-23/review',
        { method: 'POST', token: admin.token },
      );
      assert.equal(reviewed.response.status, 201);
      assert.equal(reviewed.body.data.reconciliation.reviewStatus, 'reviewed');
      assert.equal(reviewed.body.data.reconciliation.status, 'difference');
      assert.equal(reviewed.body.data.reconciliation.reviewedById, 'usr_admin');
      assert.equal(
        reviewed.body.data.reconciliation.reviewedByName,
        admin.user.name,
      );
      assert.equal(typeof reviewed.body.data.reconciliation.reviewedAt, 'string');

      const changedManual = await requestJson(
        baseUrl,
        '/api/reconciliations/2026-06-23',
        {
          method: 'PUT',
          token: finance.token,
          body: {
            backOfficeSalesCents: 5000,
            paymentMethods: [
              { name: 'cash', amountCents: 100000, sortOrder: 1 },
              { name: 'wechat', amountCents: 130000, sortOrder: 2 },
            ],
          },
        },
      );
      assert.equal(changedManual.response.status, 200);
      assert.equal(
        changedManual.body.data.reconciliation.reviewStatus,
        'pending_review',
      );
      assert.equal(changedManual.body.data.reconciliation.status, 'pending_review');

      const range = await requestJson(
        baseUrl,
        '/api/reconciliations?dateFrom=2026-06-23&dateTo=2026-06-24',
        { token: admin.token },
      );
      assert.equal(range.response.status, 200);
      assert.equal(range.body.data.reconciliations.length, 2);
      assert.equal(range.body.data.reconciliations[0].businessDate, '2026-06-23');
      assert.equal(range.body.data.reconciliations[1].businessDate, '2026-06-24');
      assert.equal(range.body.data.reconciliations[1].refundsCents, 9000);
      assert.equal(range.body.data.reconciliations[1].travelGroupSalesCents, 0);
    },
    {
      prisma: {
        salesOrders: [
          order('travel-valid', 'TRAVEL_GROUP', 'VALID', 100000),
          order('buyback-partial', 'BUYBACK', 'PARTIAL_REFUND', 20000),
          order('external-refunded', 'EXTERNAL', 'REFUNDED', 30000),
          order('internal-valid', 'INTERNAL', 'VALID', 40000),
          order('after-sales-valid', 'AFTER_SALES', 'VALID', 50000),
          order('cancelled', 'TRAVEL_GROUP', 'CANCELLED', 90000),
          order('other-date', 'TRAVEL_GROUP', 'VALID', 70000, '2026-06-22'),
        ],
        afterSalesOrders: [
          refund('refund-start', 10000, true, '2026-06-22T16:00:00.000Z'),
          refund('refund-end', 5000, true, '2026-06-23T15:59:59.000Z'),
          refund('refund-unconfirmed', 7000, false, '2026-06-23T08:00:00.000Z'),
          refund('refund-next-day', 9000, true, '2026-06-23T16:00:00.000Z'),
        ],
      },
    },
  );
});

function order(id, orderType, status, totalAmountCents, orderDate = '2026-06-23') {
  return {
    id,
    orderNo: `SO-${id}`,
    orderType,
    status,
    orderDate,
    customerName: 'Reconciliation Customer',
    totalAmountCents,
  };
}

function refund(id, refundAmountCents, financeConfirmed, createdAt) {
  return {
    id,
    afterSalesNo: `AS-${id}`,
    salesOrderId: 'travel-valid',
    refundAmountCents,
    financeConfirmed,
    createdAt,
  };
}

function pickAmounts(record) {
  return {
    travelGroupSalesCents: record.travelGroupSalesCents,
    backOfficeSalesCents: record.backOfficeSalesCents,
    buybackCents: record.buybackCents,
    externalSalesCents: record.externalSalesCents,
    internalPurchaseCents: record.internalPurchaseCents,
    afterSalesCents: record.afterSalesCents,
    refundsCents: record.refundsCents,
    receivableTotalCents: record.receivableTotalCents,
    actualTotalCents: record.actualTotalCents,
    differenceCents: record.differenceCents,
  };
}
