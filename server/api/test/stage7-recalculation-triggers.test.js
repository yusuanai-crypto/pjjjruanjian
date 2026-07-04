const assert = require('node:assert/strict');
const test = require('node:test');

const {
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

const TEST_PASSWORD = 'Password123';
const PRODUCT_NAME = 'stage7 smoke sauce A';
const TRAVEL_GROUP_ID = 'tg-stage7-recalc';
const SALES_USER_ID = 'usr-stage7-recalc-sales';
const OUTREACH_USER_ID = 'usr-stage7-recalc-outreach';
const TASTER_USER_ID = 'usr-stage7-recalc-taster';

test('contract: stage7 recalculation runs after sales order creation', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const createdOrder = await createStage7Order(baseUrl, admin.token);

    const generateLogs = await operationLogs(
      baseUrl,
      admin.token,
      'commission_records.generate',
    );
    const orderGenerateLogs = generateLogs.filter(
      (log) => log.afterData.salesOrderId === createdOrder.id,
    );
    assert.equal(orderGenerateLogs.length, 5);
    assert.equal(
      orderGenerateLogs.find(
        (log) => log.afterData.targetType === 'SALES_COMMISSION',
      ).afterData.amountCents,
      3600,
    );

    const triggerLogs = await operationLogs(
      baseUrl,
      admin.token,
      'commission_records.recalculate.trigger',
    );
    const createTrigger = triggerLogs.find(
      (log) =>
        log.entityId === createdOrder.id &&
        log.afterData.trigger === 'sales_order_create',
    );
    assert.ok(createTrigger);
    assert.equal(createTrigger.afterData.generatedRecordCount, 5);
    assert.deepEqual(createTrigger.afterData.warningCodes, [
      'travel_agency_id_not_matched',
    ]);

    const summaryLogs = await operationLogs(
      baseUrl,
      admin.token,
      'travel_group_finance_summaries.refresh',
    );
    assert.ok(
      summaryLogs.some(
        (log) => log.afterData.travelGroupId === TRAVEL_GROUP_ID,
      ),
    );
  }, {
    prisma: buildStage7RecalculationPrisma(),
  });
});

test('contract: stage7 recalculation runs after sales order amount and item changes', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const createdOrder = await createStage7Order(baseUrl, admin.token);

    const updated = await requestJson(
      baseUrl,
      `/api/sales-orders/${createdOrder.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          items: [
            {
              productName: PRODUCT_NAME,
              quantity: 3,
              unitPriceCents: 100000,
              deliveryType: 'shipping',
            },
          ],
        },
      },
    );
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.data.salesOrder.totalAmountCents, 300000);

    const recalcLogs = await operationLogs(
      baseUrl,
      admin.token,
      'commission_records.recalculate',
    );
    const salesRecalc = recalcLogs.find(
      (log) =>
        log.afterData.salesOrderId === createdOrder.id &&
        log.afterData.targetType === 'SALES_COMMISSION' &&
        log.afterData.amountCents === 5400,
    );
    assert.ok(salesRecalc);
    assert.equal(salesRecalc.beforeData.amountCents, 3600);

    const triggerLogs = await operationLogs(
      baseUrl,
      admin.token,
      'commission_records.recalculate.trigger',
    );
    const updateTrigger = triggerLogs.find(
      (log) =>
        log.entityId === createdOrder.id &&
        log.afterData.trigger === 'sales_order_update',
    );
    assert.ok(updateTrigger);
    assert.equal(updateTrigger.afterData.updatedRecordCount, 5);
  }, {
    prisma: buildStage7RecalculationPrisma(),
  });
});

test('contract: attribution and travel group changes zero stale automatic records', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const createdOrder = await createStage7Order(baseUrl, admin.token);

    const updated = await requestJson(
      baseUrl,
      `/api/sales-orders/${createdOrder.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          outreachUserId: null,
          travelGroupId: 'tg-stage7-recalc-next',
        },
      },
    );
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.data.salesOrder.outreachUserId, null);
    assert.equal(
      updated.body.data.salesOrder.travelGroupId,
      'tg-stage7-recalc-next',
    );

    const recalcLogs = await operationLogs(
      baseUrl,
      admin.token,
      'commission_records.recalculate',
    );
    const zeroedOutreach = recalcLogs.find(
      (log) =>
        log.afterData.salesOrderId === createdOrder.id &&
        log.afterData.targetType === 'OUTREACH_COMMISSION' &&
        log.afterData.amountCents === 0,
    );
    assert.ok(zeroedOutreach);
    assert.equal(zeroedOutreach.beforeData.targetUserId, OUTREACH_USER_ID);

    const triggerLogs = await operationLogs(
      baseUrl,
      admin.token,
      'commission_records.recalculate.trigger',
    );
    const updateTrigger = triggerLogs.find(
      (log) =>
        log.entityId === createdOrder.id &&
        log.afterData.trigger === 'sales_order_update' &&
        log.afterData.warningCodes.includes('missing_outreach_user'),
    );
    assert.ok(updateTrigger);
    assert.deepEqual(updateTrigger.afterData.travelGroupIds.sort(), [
      TRAVEL_GROUP_ID,
      'tg-stage7-recalc-next',
    ]);
  }, {
    prisma: buildStage7RecalculationPrisma(),
  });
});

test('contract: after-sales finance confirm and cancel recalculate stage7 amounts', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const afterSales = await login(
      baseUrl,
      'stage7-recalc-after-sales',
      TEST_PASSWORD,
    );
    const finance = await login(
      baseUrl,
      'stage7-recalc-finance',
      TEST_PASSWORD,
    );
    const createdOrder = await createStage7Order(baseUrl, admin.token);

    const createdAfterSales = await requestJson(baseUrl, '/api/after-sales-orders', {
      method: 'POST',
      token: afterSales.token,
      body: {
        salesOrderId: createdOrder.id,
        issueType: 'quality_issue',
        actionType: 'refund',
        description: 'stage7 smoke unconfirmed refund',
        refundAmountCents: 50000,
        status: 'waiting_refund',
        notes: 'stage7 smoke pending finance confirm',
      },
    });
    assert.equal(createdAfterSales.response.status, 201);
    const afterSalesOrder = createdAfterSales.body.data.afterSalesOrder;

    let triggerLogs = await operationLogs(
      baseUrl,
      admin.token,
      'commission_records.recalculate.trigger',
    );
    const unconfirmedTrigger = triggerLogs.find(
      (log) =>
        log.afterData.afterSalesOrderId === afterSalesOrder.id &&
        log.afterData.trigger === 'after_sales_order_status_sync',
    );
    assert.ok(unconfirmedTrigger);
    assert.ok(
      unconfirmedTrigger.afterData.warningCodes.includes(
        'unconfirmed_after_sales_refund',
      ),
    );

    const confirmed = await requestJson(
      baseUrl,
      `/api/after-sales-orders/${afterSalesOrder.id}/finance-confirm`,
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          financeConfirmed: true,
        },
      },
    );
    assert.equal(confirmed.response.status, 200);

    let recalcLogs = await operationLogs(
      baseUrl,
      admin.token,
      'commission_records.recalculate',
    );
    const confirmedSalesRecalc = recalcLogs.find(
      (log) =>
        log.afterData.salesOrderId === createdOrder.id &&
        log.afterData.targetType === 'SALES_COMMISSION' &&
        log.afterData.confirmedRefundAmountCents === 50000 &&
        log.afterData.amountCents === 2600,
    );
    assert.ok(confirmedSalesRecalc);

    const cancelled = await requestJson(
      baseUrl,
      `/api/after-sales-orders/${afterSalesOrder.id}/finance-confirm`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          financeConfirmed: false,
        },
      },
    );
    assert.equal(cancelled.response.status, 200);

    recalcLogs = await operationLogs(
      baseUrl,
      admin.token,
      'commission_records.recalculate',
    );
    const restoredSalesRecalc = recalcLogs.find(
      (log) =>
        log.afterData.salesOrderId === createdOrder.id &&
        log.afterData.targetType === 'SALES_COMMISSION' &&
        log.beforeData.confirmedRefundAmountCents === 50000 &&
        log.afterData.confirmedRefundAmountCents === 0 &&
        log.afterData.amountCents === 3600,
    );
    assert.ok(restoredSalesRecalc);

    triggerLogs = await operationLogs(
      baseUrl,
      admin.token,
      'commission_records.recalculate.trigger',
    );
    assert.ok(
      triggerLogs.some(
        (log) =>
          log.entityId === afterSalesOrder.id &&
          log.afterData.trigger === 'after_sales_finance_confirm',
      ),
    );
    assert.ok(
      triggerLogs.some(
        (log) =>
          log.entityId === afterSalesOrder.id &&
          log.afterData.trigger === 'after_sales_finance_unconfirm',
      ),
    );
  }, {
    prisma: buildStage7RecalculationPrisma(),
  });
});

test('contract: cancelled orders zero automatic records and remind manual taster adjustment', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const finance = await login(
      baseUrl,
      'stage7-recalc-finance',
      TEST_PASSWORD,
    );
    const createdOrder = await createStage7Order(baseUrl, admin.token);

    const manual = await requestJson(
      baseUrl,
      '/api/commission-records/new/manual-amount',
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          travelGroupId: TRAVEL_GROUP_ID,
          tasterId: TASTER_USER_ID,
          amountCents: 9999,
          calculationNote: 'stage7 smoke taster manual before cancel',
        },
      },
    );
    assert.equal(manual.response.status, 200);
    const manualRecordId = manual.body.data.commissionRecord.id;

    const cancelled = await requestJson(
      baseUrl,
      `/api/sales-orders/${createdOrder.id}/status`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          status: 'cancelled',
          statusReason: 'stage7 smoke cancelled order',
        },
      },
    );
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.body.data.salesOrder.status, 'cancelled');

    const recalcLogs = await operationLogs(
      baseUrl,
      admin.token,
      'commission_records.recalculate',
    );
    const zeroedSales = recalcLogs.find(
      (log) =>
        log.afterData.salesOrderId === createdOrder.id &&
        log.afterData.targetType === 'SALES_COMMISSION' &&
        log.afterData.amountCents === 0,
    );
    assert.ok(zeroedSales);
    const zeroedDailyRebate = recalcLogs.find(
      (log) =>
        log.afterData.salesOrderId === createdOrder.id &&
        log.afterData.targetType === 'AGENCY_DAILY_REBATE' &&
        log.afterData.pointsCents === 0,
    );
    assert.ok(zeroedDailyRebate);

    const remindLogs = await operationLogs(
      baseUrl,
      admin.token,
      'commission_records.taster_manual_adjustment.remind',
    );
    const remindLog = remindLogs.find((log) => log.entityId === manualRecordId);
    assert.ok(remindLog);
    assert.equal(remindLog.beforeData.amountCents, 9999);
    assert.equal(remindLog.afterData.amountCents, 9999);
    assert.equal(remindLog.afterData.pendingAdjustment.pending, true);
    assert.equal(
      remindLog.afterData.pendingAdjustment.trigger,
      'sales_order_status_update',
    );
  }, {
    prisma: buildStage7RecalculationPrisma(),
  });
});

async function createStage7Order(baseUrl, token, overrides = {}) {
  const result = await requestJson(baseUrl, '/api/sales-orders', {
    method: 'POST',
    token,
    body: {
      orderType: 'travel_group',
      travelGroupId: TRAVEL_GROUP_ID,
      customer: {
        name: 'stage7 smoke customer',
      },
      orderDate: '2026-07-01',
      salesUserId: SALES_USER_ID,
      outreachUserId: OUTREACH_USER_ID,
      items: [
        {
          productName: PRODUCT_NAME,
          quantity: 2,
          unitPriceCents: 100000,
          deliveryType: 'shipping',
        },
      ],
      remark: 'stage7 smoke recalc order',
      ...overrides,
    },
  });
  assert.equal(result.response.status, 201);
  return result.body.data.salesOrder;
}

async function operationLogs(baseUrl, token, action) {
  const result = await requestJson(
    baseUrl,
    `/api/operation-logs?action=${encodeURIComponent(action)}`,
    {
      token,
    },
  );
  assert.equal(result.response.status, 200);
  return result.body.data.logs;
}

function buildStage7RecalculationPrisma() {
  return {
    users: [
      userSeed('usr-stage7-recalc-finance', 'stage7-recalc-finance', 'finance'),
      userSeed(
        'usr-stage7-recalc-after-sales',
        'stage7-recalc-after-sales',
        'after_sales',
      ),
      userSeed('usr-stage7-recalc-leader', 'stage7-recalc-leader', 'sales'),
      userSeed('usr-stage7-recalc-outreach', 'stage7-recalc-outreach', 'sales'),
      userSeed('usr-stage7-recalc-taster', 'stage7-recalc-taster', 'taster'),
      {
        ...userSeed('usr-stage7-recalc-sales', 'stage7-recalc-sales', 'sales'),
        leaderId: 'usr-stage7-recalc-leader',
      },
    ],
    travelGroups: [
      {
        id: TRAVEL_GROUP_ID,
        groupNo: 'TG-STAGE7-RECALC',
        visitDate: '2026-07-01T00:00:00.000Z',
        travelAgency: 'stage7 smoke agency',
        tasterId: TASTER_USER_ID,
        tasterName: 'stage7 smoke taster',
        status: 'UNMARKED',
      },
      {
        id: 'tg-stage7-recalc-next',
        groupNo: 'TG-STAGE7-RECALC-NEXT',
        visitDate: '2026-07-02T00:00:00.000Z',
        travelAgency: 'stage7 smoke agency',
        tasterId: TASTER_USER_ID,
        tasterName: 'stage7 smoke taster',
        status: 'UNMARKED',
      },
    ],
    commissionRules: [
      commissionRule('rule-stage7-sales', 'SALES_COMMISSION', '0.0200'),
      commissionRule('rule-stage7-outreach', 'OUTREACH_COMMISSION', '0.0080'),
      commissionRule('rule-stage7-leader', 'LEADER_COMMISSION', '0.0024'),
    ],
    salesDeductionRules: [
      {
        id: 'rule-stage7-sales-deduction',
        ruleName: 'stage7 smoke sales deduction',
        productName: PRODUCT_NAME,
        deductionCostCents: 10000,
        isActive: true,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
      },
    ],
    agencyDeductionRules: [
      {
        id: 'rule-stage7-agency-deduction',
        ruleName: 'stage7 smoke agency deduction',
        agencyId: null,
        agencyName: 'stage7 smoke agency',
        productName: PRODUCT_NAME,
        deductionCostCents: 15000,
        isActive: true,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
      },
    ],
    agencyRebateRules: [
      {
        id: 'rule-stage7-agency-rebate',
        ruleName: 'stage7 smoke agency rebate',
        agencyId: null,
        agencyName: 'stage7 smoke agency',
        dailyRebateRate: '0.0300',
        monthlyRebateRate: '0.0200',
        isActive: true,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
      },
    ],
  };
}

function userSeed(id, username, role) {
  return {
    id,
    username,
    name: `${username} test user`,
    role,
    password: TEST_PASSWORD,
  };
}

function commissionRule(id, targetType, rate) {
  return {
    id,
    ruleName: `${id} smoke rule`,
    targetType,
    rate,
    isActive: true,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  };
}
