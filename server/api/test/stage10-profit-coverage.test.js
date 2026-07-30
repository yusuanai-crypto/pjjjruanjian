const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  createUser,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

const PASSWORD = 'Password123';

test('contract: finance and analytics profit endpoints expose complete partial and unavailable coverage', async () => {
  await withProfitServer(async (baseUrl) => {
    const admin = await login(baseUrl);

    const complete = await financeSummary(baseUrl, admin.token, '2026-07-01');
    assert.equal(complete.costCoverageStatus, 'complete');
    assert.equal(complete.effectiveSalesAmountCents, 10000);
    assert.equal(complete.actualProductCostCents, 3000);
    assert.equal(complete.grossProfitCents, 7000);
    assert.equal(complete.grossMarginCents, 7000);
    assert.equal(complete.costCoverageRate, 1);
    assert.equal(complete.estimatedGrossProfitCents, null);
    assert.equal(complete.coveredLineCount, 1);
    assert.equal(complete.uncoveredLineCount, 0);
    assert.equal(complete.coveredOrderCount, 1);
    assert.equal(complete.uncoveredOrderCount, 0);
    assert.equal(complete.salesDeductionCostCents, 111);
    assert.equal(complete.agencyDeductionCostCents, 222);
    assert.equal(complete.costBreakdown.mixedForGrossProfit, false);

    const partial = await financeSummary(baseUrl, admin.token, '2026-07-02');
    assert.equal(partial.costCoverageStatus, 'partial');
    assert.equal(partial.grossProfitCents, null);
    assert.equal(partial.grossMarginCents, null);
    assert.equal(partial.costCoverageRate, 0.5);
    assert.equal(partial.estimatedGrossProfitCents, null);
    assert.equal(partial.actualProductCostCents, 3000);
    assert.equal(partial.coveredLineCount, 1);
    assert.equal(partial.uncoveredLineCount, 1);
    assert.equal(partial.costGapAmountCents, 10000);
    assert.match(partial.costCoverageWarning, /无法输出完整精确毛利/);
    assert.ok(
      partial.warnings.some(
        (warning) => warning.code === 'ACTUAL_COST_COVERAGE_PARTIAL',
      ),
    );

    const unavailable = await financeSummary(baseUrl, admin.token, '2026-07-03');
    assert.equal(unavailable.costCoverageStatus, 'unavailable');
    assert.equal(unavailable.grossProfitCents, null);
    assert.equal(unavailable.costCoverageRate, 0);
    assert.equal(unavailable.actualProductCostCents, 0);
    assert.equal(unavailable.coveredLineCount, 0);
    assert.equal(unavailable.uncoveredLineCount, 1);
    assert.equal(unavailable.costGapAmountCents, 10000);
    assert.match(unavailable.costCoverageWarning, /没有可用的实际成本快照/);

    const analytics = await requestJson(
      baseUrl,
      '/api/analytics/profit-overview?preset=custom&dateFrom=2026-07-02&dateTo=2026-07-02',
      { token: admin.token },
    );
    assert.equal(analytics.response.status, 200);
    assert.equal(analytics.body.data.summary.costCoverageStatus, 'partial');
    assert.equal(analytics.body.data.summary.grossProfitCents, null);
    assert.equal(analytics.body.data.summary.costGapAmountCents, 10000);
  });
});

test('contract: finance order profit uses snapshots and marks refund net profit as estimate', async () => {
  await withProfitServer(async (baseUrl) => {
    const admin = await login(baseUrl);

    const detail = await requestJson(
      baseUrl,
      '/api/finance/orders/profit-complete/profit',
      { token: admin.token },
    );
    assert.equal(detail.response.status, 200);
    const orderProfit = detail.body.data.orderProfit;
    assert.equal(orderProfit.costCoverageStatus, 'complete');
    assert.equal(orderProfit.actualProductCostCents, 3000);
    assert.equal(orderProfit.salesDeductionCostCents, 111);
    assert.equal(orderProfit.agencyDeductionCostCents, 222);
    assert.equal(orderProfit.grossProfitCents, 7000);
    assert.equal(orderProfit.items[0].actualCostSubtotalCents, 3000);
    assert.equal(orderProfit.items[0].grossProfitCents, 7000);
    assert.equal('currentProductCostCents' in orderProfit, false);

    const refund = await requestJson(
      baseUrl,
      '/api/finance/orders/profit-refund/profit',
      { token: admin.token },
    );
    assert.equal(refund.response.status, 200);
    const refundProfit = refund.body.data.orderProfit;
    assert.equal(refundProfit.effectiveSalesAmountCents, 8000);
    assert.equal(refundProfit.actualProductCostCents, 3000);
    assert.equal(refundProfit.grossProfitCents, null);
    assert.equal(refundProfit.estimatedGrossProfitCents, 5000);
    assert.equal(refundProfit.estimatedGrossMarginCents, 5000);
    assert.equal(refundProfit.grossProfitIsEstimated, true);
    assert.equal(refundProfit.refundCostReversalApplied, false);
    assert.ok(
      refundProfit.warnings.some(
        (warning) => warning.code === 'REFUND_COST_REVERSAL_UNAVAILABLE',
      ),
    );
    assert.match(
      refundProfit.warnings.find(
        (warning) => warning.code === 'REFUND_COST_REVERSAL_UNAVAILABLE',
      ).message,
      /未自动冲回商品成本.*估算/,
    );
  });
});

test('contract: stage10 travel-group profit coverage includes snapshotted tax and payment fees', async () => {
  await withProfitServer(async (baseUrl) => {
    const admin = await login(baseUrl);
    const result = await requestJson(
      baseUrl,
      '/api/analytics/travel-group-profits?preset=custom&dateFrom=2026-07-20&dateTo=2026-07-20',
      { token: admin.token },
    );

    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.items.length, 1);
    const item = result.body.data.items[0];
    assert.equal(item.groupNo, 'TG-COVERAGE-FEES');
    assert.equal(item.effectiveSalesAmountCents, 9000);
    assert.equal(item.taxFeeCents, 90);
    assert.equal(item.paymentServiceFeeCents, 70);
    assert.equal(item.totalExpenseCents, 3660);
    assert.equal(item.estimatedProfitCents, 5340);
    assert.equal(
      JSON.stringify(item).includes('actualCostSubtotalCents'),
      false,
    );
    assert.equal(
      JSON.stringify(item).includes('Customer coverage-fees'),
      false,
    );
  });
});

test('contract: cost and profit endpoints reject boss, other roles, and anonymous callers', async () => {
  await withProfitServer(async (baseUrl) => {
    const anonymousPaths = [
      '/api/finance/profit-overview?dateFrom=2026-07-01&dateTo=2026-07-01',
      '/api/finance/orders/profit-complete/profit',
      '/api/analytics/profit-overview?preset=custom&dateFrom=2026-07-01&dateTo=2026-07-01',
    ];
    for (const path of anonymousPaths) {
      const anonymous = await requestJson(baseUrl, path);
      assertErrorContract(anonymous, 401, 'AUTH_TOKEN_REQUIRED');
    }

    const admin = await login(baseUrl);
    const finance = await createRoleSession(baseUrl, admin.token, 'finance');
    const boss = await createRoleSession(baseUrl, admin.token, 'boss');
    const sales = await createRoleSession(baseUrl, admin.token, 'sales');

    for (const path of anonymousPaths) {
      const allowed = await requestJson(baseUrl, path, { token: finance.token });
      assert.equal(allowed.response.status, 200);
      for (const deniedSession of [boss, sales]) {
        const denied = await requestJson(baseUrl, path, {
          token: deniedSession.token,
        });
        assertErrorContract(denied, 403, 'PERMISSION_DENIED');
      }
    }

    const bossOriginalAnalytics = await requestJson(baseUrl, '/api/analytics/overview', {
      token: boss.token,
    });
    assert.equal(bossOriginalAnalytics.response.status, 200);
    assert.equal(
      JSON.stringify(bossOriginalAnalytics.body).includes('costCoverageStatus'),
      false,
    );
  });
});

function withProfitServer(run) {
  return withPhase1Server(run, {
    prisma: {
      travelGroups: [
        {
          id: 'coverage-fees-group',
          groupNo: 'TG-COVERAGE-FEES',
          visitDate: '2026-07-20',
          travelAgency: 'Coverage Agency',
          guideName: 'Coverage Guide',
          tasterName: 'Coverage Taster',
          guestCount: 10,
          financeMark: true,
          parkingFeeCents: 500,
          cigaretteFeeCents: 0,
        },
      ],
      salesOrders: [
        orderSeed('profit-complete', '2026-07-01', [
          itemSeed('complete-line', 10000, 3000),
        ]),
        orderSeed('profit-partial', '2026-07-02', [
          itemSeed('partial-covered-line', 10000, 3000),
          itemSeed('partial-uncovered-line', 10000, null),
        ]),
        orderSeed('profit-unavailable', '2026-07-03', [
          itemSeed('unavailable-line', 10000, null),
        ]),
        orderSeed('profit-refund', '2026-07-04', [
          itemSeed('refund-line', 10000, 3000),
        ]),
        orderSeed(
          'coverage-fees',
          '2026-07-20',
          [itemSeed('coverage-fees-line', 10000, 3000)],
          {
            travelGroupId: 'coverage-fees-group',
            financeMark: true,
            taxRateSnapshot: '0.010000',
            paymentDetails: [
              paymentSeed(
                'coverage-wallet',
                'coverage-wallet-method',
                '收钱吧',
                6000,
                '0.006000',
              ),
              paymentSeed(
                'coverage-card',
                'coverage-card-method',
                '银行卡',
                4000,
                '0.010000',
              ),
            ],
          },
        ),
      ],
      afterSalesOrders: [
        {
          id: 'profit-refund-after-sales',
          afterSalesNo: 'AS-PROFIT-REFUND',
          salesOrderId: 'profit-refund',
          customerId: null,
          issueType: 'OTHER',
          actionType: 'REFUND',
          description: 'confirmed refund without item quantities',
          refundAmountCents: 2000,
          status: 'COMPLETED',
          financeConfirmed: true,
          createdAt: '2026-07-04T10:00:00.000Z',
        },
        {
          id: 'coverage-fees-refund',
          afterSalesNo: 'AS-COVERAGE-FEES',
          salesOrderId: 'coverage-fees',
          customerId: null,
          issueType: 'OTHER',
          actionType: 'REFUND',
          description: 'same-day fee allocation',
          refundAmountCents: 1000,
          status: 'COMPLETED',
          financeConfirmed: true,
          refundPaymentDetailId: 'coverage-wallet',
          refundPaymentMethodNameSnapshot: '收钱吧',
          refundOccurredAt: '2026-07-20T12:00:00.000Z',
          deductsPaymentServiceFee: true,
          createdAt: '2026-07-20T12:00:00.000Z',
        },
      ],
      commissionRecords: [
        {
          id: 'profit-sales-deduction-record',
          salesOrderId: 'profit-complete',
          targetType: 'SALES_COMMISSION',
          deductionAmountCents: 111,
        },
        {
          id: 'profit-agency-deduction-record',
          salesOrderId: 'profit-complete',
          targetType: 'AGENCY_DAILY_REBATE',
          deductionAmountCents: 222,
        },
      ],
      travelGroupFinanceSummaries: [
        {
          id: 'coverage-fees-summary',
          travelGroupId: 'coverage-fees-group',
          totalDailyRebateCents: 0,
          totalMonthlyRebateCents: 0,
        },
      ],
    },
  });
}

function orderSeed(id, orderDate, items, overrides = {}) {
  return {
    id,
    orderNo: `SO-${id.toUpperCase()}`,
    orderType: 'EXTERNAL',
    customerName: `Customer ${id}`,
    orderDate,
    status: 'VALID',
    totalAmountCents: items.reduce(
      (sum, item) => sum + item.subtotalCents,
      0,
    ),
    ...overrides,
    items,
  };
}

function itemSeed(id, subtotalCents, actualCostSubtotalCents) {
  return {
    id,
    productId: `product-${id}`,
    productName: `Product ${id}`,
    unit: 'bottle',
    quantity: 1,
    unitPriceCents: subtotalCents,
    subtotalCents,
    actualUnitCostCents: actualCostSubtotalCents,
    actualCostSubtotalCents,
    grossProfitCents:
      actualCostSubtotalCents === null
        ? null
        : subtotalCents - actualCostSubtotalCents,
    deliveryType: 'SHIPPING',
  };
}

function paymentSeed(
  id,
  paymentMethodId,
  paymentMethodNameSnapshot,
  amountCents,
  serviceFeeRateSnapshot,
) {
  return {
    id,
    paymentMethodId,
    paymentMethodNameSnapshot,
    amountCents,
    serviceFeeRateSnapshot,
    serviceFeeBaseAmountSnapshotCents: amountCents,
  };
}

async function financeSummary(baseUrl, token, date) {
  const result = await requestJson(
    baseUrl,
    `/api/finance/profit-overview?dateFrom=${date}&dateTo=${date}`,
    { token },
  );
  assert.equal(result.response.status, 200);
  return result.body.data.profitOverview;
}

async function createRoleSession(baseUrl, adminToken, role) {
  const username = `profit-${role}`;
  await createUser(baseUrl, adminToken, {
    name: `Profit ${role}`,
    username,
    password: PASSWORD,
    role,
  });
  return login(baseUrl, username, PASSWORD);
}
