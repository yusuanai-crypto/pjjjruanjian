const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  login,
  requestJsonWithStage10ProductFixtures: requestJson,
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

test('contract: creating a 30 percent agency deduction rule recalculates existing orders and summary', async () => {
  const prisma = buildStage7RecalculationPrisma();
  prisma.agencyDeductionRules = [];

  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const createdOrder = await createStage7Order(baseUrl, admin.token);

    const createdRule = await requestJson(
      baseUrl,
      '/api/agency-deduction-rules',
      {
        method: 'POST',
        token: admin.token,
        body: {
          agencyName: 'stage7 smoke agency',
          calculationMode: 'effective_sales_rate',
          deductionRate: '0.3000',
          effectiveFrom: '2026-01-01',
        },
      },
    );

    assert.equal(
      createdRule.response.status,
      201,
      JSON.stringify(createdRule.body),
    );
    const recalculation = createdRule.body.data.recalculation;
    assert.equal(
      recalculation.orderCount,
      1,
      JSON.stringify(recalculation),
    );
    assert.equal(recalculation.successCount, 1);
    assert.deepEqual(
      recalculation.updatedRecords.map((record) => record.targetType).sort(),
      ['agency_daily_rebate', 'agency_monthly_rebate'],
    );
    const daily = recalculation.updatedRecords.find(
      (record) => record.targetType === 'agency_daily_rebate',
    );
    const monthly = recalculation.updatedRecords.find(
      (record) => record.targetType === 'agency_monthly_rebate',
    );
    assert.equal(daily.salesOrderId, createdOrder.id);
    assert.equal(daily.deductionAmountCents, 60000);
    assert.equal(daily.baseAmountCents, 140000);
    assert.equal(daily.pointsCents, 4200);
    assert.equal(monthly.deductionAmountCents, 60000);
    assert.equal(monthly.baseAmountCents, 140000);
    assert.equal(monthly.pointsCents, 2800);

    const summary = recalculation.travelGroupFinanceSummaries[0];
    assert.equal(summary.totalSalesAmountCents, 200000);
    assert.equal(summary.totalAgencyDeductionCents, 60000);
    assert.equal(summary.totalAgencyNetAmountCents, 140000);
    assert.equal(summary.totalDailyRebateCents, 4200);
    assert.equal(summary.totalMonthlyRebateCents, 2800);

    const aggregateLogs = await operationLogs(
      baseUrl,
      admin.token,
      'commission_records.agency_scope.recalculate',
    );
    const aggregateLog = aggregateLogs.find(
      (log) =>
        log.afterData.triggerSource === 'agency_deduction_rules.create' &&
        log.afterData.orderCount === 1,
    );
    assert.ok(aggregateLog);
    assert.equal(aggregateLog.afterData.travelGroupCount, 1);
    assert.equal(aggregateLog.afterData.successCount, 1);
    assert.equal(aggregateLog.afterData.skippedCount, 0);
  }, {
    prisma,
  });
});

test('contract: updating and disabling an agency rebate rule recalculates unconfirmed records', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    await createStage7Order(baseUrl, admin.token);

    const updatedRule = await requestJson(
      baseUrl,
      '/api/agency-rebate-rules/rule-stage7-agency-rebate',
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          dailyRebateRate: '0.0400',
          monthlyRebateRate: '0.0100',
        },
      },
    );

    assert.equal(updatedRule.response.status, 200);
    const updatedRecalculation = updatedRule.body.data.recalculation;
    assert.equal(updatedRecalculation.orderCount, 1);
    assert.equal(updatedRecalculation.successCount, 1);
    const updatedDaily = updatedRecalculation.updatedRecords.find(
      (record) => record.targetType === 'agency_daily_rebate',
    );
    const updatedMonthly = updatedRecalculation.updatedRecords.find(
      (record) => record.targetType === 'agency_monthly_rebate',
    );
    assert.equal(updatedDaily.baseAmountCents, 170000);
    assert.equal(updatedDaily.pointsCents, 6800);
    assert.equal(updatedMonthly.pointsCents, 1700);
    assert.equal(
      updatedRecalculation.travelGroupFinanceSummaries[0]
        .totalDailyRebateCents,
      6800,
    );
    assert.equal(
      updatedRecalculation.travelGroupFinanceSummaries[0]
        .totalMonthlyRebateCents,
      1700,
    );

    const disabledRule = await requestJson(
      baseUrl,
      '/api/agency-rebate-rules/rule-stage7-agency-rebate',
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          isActive: false,
        },
      },
    );

    assert.equal(disabledRule.response.status, 200);
    const disabledRecalculation = disabledRule.body.data.recalculation;
    assert.equal(disabledRecalculation.orderCount, 1);
    assert.equal(disabledRecalculation.successCount, 1);
    assert.equal(
      disabledRecalculation.updatedRecords
        .filter((record) =>
          [
            'agency_daily_rebate',
            'agency_monthly_rebate',
          ].includes(record.targetType),
        )
        .every((record) => record.pointsCents === 0),
      true,
    );
    assert.equal(
      disabledRecalculation.warnings.some(
        (warning) => warning.code === 'missing_agency_daily_rebate_rule',
      ),
      true,
    );
    assert.equal(
      disabledRecalculation.warnings.some(
        (warning) => warning.code === 'missing_agency_monthly_rebate_rule',
      ),
      true,
    );
    const disabledSummary =
      disabledRecalculation.travelGroupFinanceSummaries[0];
    assert.equal(disabledSummary.totalDailyRebateCents, 0);
    assert.equal(disabledSummary.totalMonthlyRebateCents, 0);
  }, {
    prisma: buildStage7RecalculationPrisma(),
  });
});

test('contract: batch importing an agency rule recalculates only that agency', async () => {
  const prisma = buildStage7RecalculationPrisma();
  prisma.agencyDeductionRules = [];
  prisma.travelGroups.push({
    id: 'tg-stage7-recalc-other-agency',
    groupNo: 'TG-STAGE7-RECALC-OTHER',
    visitDate: '2026-07-03T00:00:00.000Z',
    travelAgency: 'stage7 other agency',
    tasterId: TASTER_USER_ID,
    tasterName: 'stage7 smoke taster',
    liquorCostDeductionCents: 0,
    status: 'UNMARKED',
  });

  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const matchingOrder = await createStage7Order(baseUrl, admin.token);
    const otherOrder = await createStage7Order(baseUrl, admin.token, {
      travelGroupId: 'tg-stage7-recalc-other-agency',
      orderDate: '2026-07-03',
    });

    const imported = await requestJson(
      baseUrl,
      '/api/agency-deduction-rules/batch-import',
      {
        method: 'POST',
        token: admin.token,
        body: {
          rules: [
            {
              agencyName: 'stage7 smoke agency',
              calculationMode: 'effective_sales_rate',
              deductionRate: '0.3000',
              effectiveFrom: '2026-01-01',
            },
          ],
        },
      },
    );

    assert.equal(imported.response.status, 201);
    assert.equal(imported.body.data.importResult.successCount, 1);
    const recalculation = imported.body.data.recalculation;
    assert.equal(recalculation.orderCount, 1);
    assert.equal(recalculation.successCount, 1);
    assert.equal(
      recalculation.updatedRecords.every(
        (record) => record.salesOrderId === matchingOrder.id,
      ),
      true,
    );
    assert.equal(
      recalculation.updatedRecords.some(
        (record) => record.salesOrderId === otherOrder.id,
      ),
      false,
    );
  }, {
    prisma,
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
  await withTemporaryRefundProofStorage(async (storageRoot) => {
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

      const createdAfterSales = await requestJson(
        baseUrl,
        '/api/after-sales-orders',
        {
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
        },
      );
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

      const confirmed = await uploadRefundProofs(
        baseUrl,
        finance.token,
        afterSalesOrder.id,
        [
          {
            content: Buffer.from([
              0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            ]),
            name: 'stage7-refund-proof.png',
            type: 'image/png',
          },
        ],
      );
      assert.equal(confirmed.response.status, 201);

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
      let summary = await getTravelGroupFinanceSummary(
        baseUrl,
        admin.token,
        TRAVEL_GROUP_ID,
      );
      assert.equal(summary.pendingAfterSalesRefundAmountCents, 0);
      assert.equal(summary.confirmedRefundAmountCents, 50000);
      assert.equal(summary.effectiveSalesAmountCents, 150000);
      assert.equal(summary.totalAgencyNetAmountCents, 120000);
      assert.equal(summary.totalDailyRebateCents, 3600);
      assert.equal(summary.totalMonthlyRebateCents, 2400);
      assert.equal(summary.afterSalesImpactStatus, 'refund_adjusted');

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
      summary = await getTravelGroupFinanceSummary(
        baseUrl,
        admin.token,
        TRAVEL_GROUP_ID,
      );
      assert.equal(summary.pendingAfterSalesRefundAmountCents, 50000);
      assert.equal(summary.confirmedRefundAmountCents, 0);
      assert.equal(summary.effectiveSalesAmountCents, 200000);
      assert.equal(summary.totalDailyRebateCents, 5100);
      assert.equal(summary.totalMonthlyRebateCents, 3400);
      assert.equal(
        summary.afterSalesImpactStatus,
        'refund_pending_confirmation',
      );

      triggerLogs = await operationLogs(
        baseUrl,
        admin.token,
        'commission_records.recalculate.trigger',
      );
      assert.ok(
        triggerLogs.some(
          (log) =>
            log.entityId === afterSalesOrder.id &&
            log.afterData.trigger === 'after_sales_finance_refund_confirm',
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
      env: { TRAVEL_GROUP_ATTACHMENT_DIR: storageRoot },
      prisma: buildStage7RecalculationPrisma(),
    });
  });
});

test('contract: negotiating after-sales refreshes pending points impact once without changing amounts', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const afterSales = await login(
      baseUrl,
      'stage7-recalc-after-sales',
      TEST_PASSWORD,
    );
    const createdOrder = await createStage7Order(baseUrl, admin.token);

    const createdAfterSales = await requestJson(
      baseUrl,
      '/api/after-sales-orders',
      {
        method: 'POST',
        token: afterSales.token,
        body: {
          salesOrderId: createdOrder.id,
          issueType: 'quality_issue',
          actionType: 'refund',
          description: 'stage7 negotiating pending refund regression',
          refundAmountCents: 50000,
          status: 'negotiating',
        },
      },
    );
    assert.equal(createdAfterSales.response.status, 201);
    assert.equal(
      createdAfterSales.body.data.afterSalesOrder.salesOrder.status,
      'valid',
    );
    assert.equal(
      createdAfterSales.body.data.commissionAndPointsImpact
        .pendingAfterSalesRefundAmountCents,
      50000,
    );

    const triggerLogs = await operationLogs(
      baseUrl,
      admin.token,
      'commission_records.recalculate.trigger',
    );
    const afterSalesTriggers = triggerLogs.filter(
      (log) =>
        log.afterData.afterSalesOrderId ===
        createdAfterSales.body.data.afterSalesOrder.id,
    );
    assert.equal(afterSalesTriggers.length, 1);
    assert.equal(
      afterSalesTriggers[0].afterData.trigger,
      'after_sales_create',
    );
    assert.equal(
      afterSalesTriggers[0].afterData.pendingAfterSalesRefundAmountCents,
      50000,
    );

    const summary = await getTravelGroupFinanceSummary(
      baseUrl,
      admin.token,
      TRAVEL_GROUP_ID,
    );
    assert.equal(summary.confirmedRefundAmountCents, 0);
    assert.equal(summary.effectiveSalesAmountCents, 200000);
    assert.equal(summary.totalDailyRebateCents, 5100);
    assert.equal(summary.totalMonthlyRebateCents, 3400);
    assert.equal(summary.afterSalesCount, 1);
    assert.equal(summary.activeAfterSalesCount, 1);
    assert.equal(summary.pendingAfterSalesRefundCount, 1);
    assert.equal(summary.pendingAfterSalesRefundAmountCents, 50000);
    assert.equal(summary.afterSalesImpactStatus, 'refund_pending_confirmation');
    const summaryList = await listTravelGroupFinanceSummaries(
      baseUrl,
      admin.token,
    );
    const listedSummary = summaryList.find(
      (item) => item.travelGroupId === TRAVEL_GROUP_ID,
    );
    assert.ok(listedSummary);
    assert.equal(listedSummary.afterSalesCount, 1);
    assert.equal(listedSummary.pendingAfterSalesRefundAmountCents, 50000);
    assert.equal(
      listedSummary.afterSalesImpactStatus,
      'refund_pending_confirmation',
    );

    const commissionRecords = await listOrderCommissionRecords(
      baseUrl,
      admin.token,
      createdOrder.id,
    );
    assert.equal(commissionRecords.length, 5);
  }, {
    prisma: buildStage7RecalculationPrisma(),
  });
});

test('contract: zero-refund resend marks after-sales processing without changing points', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const afterSales = await login(
      baseUrl,
      'stage7-recalc-after-sales',
      TEST_PASSWORD,
    );
    const createdOrder = await createStage7Order(baseUrl, admin.token);
    await createAfterSales(baseUrl, afterSales.token, {
      salesOrderId: createdOrder.id,
      actionType: 'resend',
      refundAmountCents: 0,
      status: 'waiting_resend',
      description: 'stage7 zero refund resend impact',
    });

    const summary = await getTravelGroupFinanceSummary(
      baseUrl,
      admin.token,
      TRAVEL_GROUP_ID,
    );
    assert.equal(summary.confirmedRefundAmountCents, 0);
    assert.equal(summary.effectiveSalesAmountCents, 200000);
    assert.equal(summary.pendingAfterSalesRefundAmountCents, 0);
    assert.equal(summary.afterSalesCount, 1);
    assert.equal(summary.activeAfterSalesCount, 1);
    assert.equal(summary.afterSalesImpactStatus, 'after_sales_processing');
    assert.equal(summary.totalDailyRebateCents, 5100);
    assert.equal(summary.totalMonthlyRebateCents, 3400);
  }, {
    prisma: buildStage7RecalculationPrisma(),
  });
});

test('contract: multiple after-sales changes accumulate snapshot impact without duplicate records', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const afterSales = await login(
      baseUrl,
      'stage7-recalc-after-sales',
      TEST_PASSWORD,
    );
    const createdOrder = await createStage7Order(baseUrl, admin.token);
    const refund = await createAfterSales(baseUrl, afterSales.token, {
      salesOrderId: createdOrder.id,
      actionType: 'refund',
      refundAmountCents: 20000,
      status: 'negotiating',
      description: 'stage7 first pending refund',
    });
    await createAfterSales(baseUrl, afterSales.token, {
      salesOrderId: createdOrder.id,
      actionType: 'resend',
      refundAmountCents: 0,
      status: 'waiting_resend',
      description: 'stage7 zero refund resend',
    });

    const updatedRefund = await requestJson(
      baseUrl,
      `/api/after-sales-orders/${refund.id}`,
      {
        method: 'PATCH',
        token: afterSales.token,
        body: {
          refundAmountCents: 35000,
        },
      },
    );
    assert.equal(updatedRefund.response.status, 200);

    let summary = await getTravelGroupFinanceSummary(
      baseUrl,
      admin.token,
      TRAVEL_GROUP_ID,
    );
    assert.equal(summary.afterSalesCount, 2);
    assert.equal(summary.activeAfterSalesCount, 2);
    assert.equal(summary.pendingAfterSalesRefundCount, 1);
    assert.equal(summary.pendingAfterSalesRefundAmountCents, 35000);
    assert.equal(summary.totalDailyRebateCents, 5100);

    const waitingRefund = await requestJson(
      baseUrl,
      `/api/after-sales-orders/${refund.id}/status`,
      {
        method: 'PATCH',
        token: afterSales.token,
        body: {
          status: 'waiting_refund',
        },
      },
    );
    assert.equal(waitingRefund.response.status, 200);
    summary = await getTravelGroupFinanceSummary(
      baseUrl,
      admin.token,
      TRAVEL_GROUP_ID,
    );
    assert.equal(summary.pendingAfterSalesRefundAmountCents, 35000);
    assert.equal(summary.latestAfterSalesNo, refund.afterSalesNo);
    assert.equal(summary.latestAfterSalesStatus, 'waiting_refund');

    const commissionRecords = await listOrderCommissionRecords(
      baseUrl,
      admin.token,
      createdOrder.id,
    );
    assert.equal(commissionRecords.length, 5);
    const triggerLogs = await operationLogs(
      baseUrl,
      admin.token,
      'commission_records.recalculate.trigger',
    );
    for (const afterSalesOrderId of [
      refund.id,
      waitingRefund.body.data.afterSalesOrder.id,
    ]) {
      assert.ok(
        triggerLogs.some(
          (log) => log.afterData.afterSalesOrderId === afterSalesOrderId,
        ),
      );
    }
  }, {
    prisma: buildStage7RecalculationPrisma(),
  });
});

test('contract: after-sales without travel group returns structured warnings', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const afterSales = await login(
      baseUrl,
      'stage7-recalc-after-sales',
      TEST_PASSWORD,
    );
    const createdOrder = await createStage7Order(baseUrl, admin.token, {
      orderType: 'external',
      travelGroupId: null,
    });
    const createdAfterSales = await createAfterSales(
      baseUrl,
      afterSales.token,
      {
        salesOrderId: createdOrder.id,
        actionType: 'record_only',
        refundAmountCents: 0,
        status: 'negotiating',
        description: 'stage7 missing travel group warning',
      },
    );

    assert.ok(
      createdAfterSales.warningCodes.includes('missing_travel_group'),
    );
    assert.ok(
      createdAfterSales.warningCodes.includes('missing_travel_agency'),
    );
    assert.equal(
      createdAfterSales.commissionAndPointsImpact.travelGroupIds.length,
      0,
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

async function withTemporaryRefundProofStorage(run) {
  const storageRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'jiangjiu-stage7-refund-proofs-'),
  );
  try {
    await run(storageRoot);
  } finally {
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
}

async function uploadRefundProofs(baseUrl, token, afterSalesOrderId, files) {
  const form = new FormData();
  for (const file of files) {
    form.append(
      'files',
      new Blob([file.content], { type: file.type }),
      file.name,
    );
  }
  const response = await fetch(
    `${baseUrl}/api/after-sales-orders/${afterSalesOrderId}/finance-refund-confirm`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );
  return { response, body: await response.json() };
}

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

async function createAfterSales(baseUrl, token, overrides = {}) {
  const result = await requestJson(baseUrl, '/api/after-sales-orders', {
    method: 'POST',
    token,
    body: {
      issueType: 'quality_issue',
      actionType: 'record_only',
      description: 'stage7 after-sales impact',
      refundAmountCents: 0,
      status: 'negotiating',
      ...overrides,
    },
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  return {
    ...result.body.data.afterSalesOrder,
    warningCodes: result.body.data.warningCodes || [],
    warnings: result.body.data.warnings || [],
    commissionAndPointsImpact:
      result.body.data.commissionAndPointsImpact || null,
  };
}

async function getTravelGroupFinanceSummary(
  baseUrl,
  token,
  travelGroupId,
) {
  const result = await requestJson(
    baseUrl,
    `/api/travel-group-finance-summaries/${travelGroupId}`,
    { token },
  );
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return result.body.data.travelGroupFinanceSummary;
}

async function listTravelGroupFinanceSummaries(baseUrl, token) {
  const result = await requestJson(
    baseUrl,
    '/api/travel-group-finance-summaries?limit=50',
    { token },
  );
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return result.body.data.travelGroupFinanceSummaries;
}

async function listOrderCommissionRecords(baseUrl, token, salesOrderId) {
  const result = await requestJson(
    baseUrl,
    `/api/commission-records?salesOrderId=${salesOrderId}&limit=50`,
    { token },
  );
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return result.body.data.commissionRecords;
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
        liquorCostDeductionCents: 30000,
        status: 'UNMARKED',
      },
      {
        id: 'tg-stage7-recalc-next',
        groupNo: 'TG-STAGE7-RECALC-NEXT',
        visitDate: '2026-07-02T00:00:00.000Z',
        travelAgency: 'stage7 smoke agency',
        tasterId: TASTER_USER_ID,
        tasterName: 'stage7 smoke taster',
        liquorCostDeductionCents: 30000,
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
