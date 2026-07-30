const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  createUser,
  login,
  requestJson,
  requestJsonWithStage10ProductFixtures,
  withPhase1Server,
} = require('./helpers/phase1-api');

const SHOUQIANBA_ID = '00000000-0000-4000-8000-000000000001';
const CASH_ID = '00000000-0000-4000-8000-000000000004';
const COD_ID = '00000000-0000-4000-8000-000000000005';

test('payment method maintenance is finance/admin only, ordered, soft-disable-only, and single-default', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const salesUser = await createUser(baseUrl, admin.token, {
      name: 'Payment Sales',
      username: 'payment-sales',
      password: 'Password123',
      role: 'sales',
    });
    const sales = await login(baseUrl, salesUser.username, 'Password123');

    const listed = await requestJson(baseUrl, '/api/payment-methods', {
      token: sales.token,
    });
    assert.equal(listed.response.status, 200);
    assert.deepEqual(
      listed.body.data.paymentMethods.map((method) => method.name),
      ['收钱吧', '中行POS机', '光大POS机', '现金', '货到付款', '转账'],
    );
    assert.equal(listed.body.data.paymentMethods[0].isDefault, true);

    const denied = await requestJson(baseUrl, '/api/payment-methods', {
      method: 'POST',
      token: sales.token,
      body: {
        name: '销售不可新增',
        category: 'direct_receipt',
      },
    });
    assertErrorContract(denied, 403, 'PERMISSION_DENIED');

    const created = await requestJson(baseUrl, '/api/payment-methods', {
      method: 'POST',
      token: admin.token,
      body: {
        name: '测试聚合支付',
        category: 'direct_receipt',
        sortOrder: 5,
      },
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.data.paymentMethod.isActive, true);

    const madeDefault = await requestJson(
      baseUrl,
      `/api/payment-methods/${created.body.data.paymentMethod.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: { isDefault: true },
      },
    );
    assert.equal(madeDefault.response.status, 200);
    assert.equal(madeDefault.body.data.paymentMethod.isDefault, true);

    const all = await requestJson(
      baseUrl,
      '/api/payment-methods?includeInactive=true',
      { token: admin.token },
    );
    assert.equal(
      all.body.data.paymentMethods.filter((method) => method.isDefault).length,
      1,
    );
    assert.equal(
      all.body.data.paymentMethods.find((method) => method.id === SHOUQIANBA_ID)
        .isDefault,
      false,
    );

    const deleteAttempt = await requestJson(
      baseUrl,
      `/api/payment-methods/${created.body.data.paymentMethod.id}`,
      {
        method: 'DELETE',
        token: admin.token,
      },
    );
    assert.equal(deleteAttempt.response.status, 404);
  });
});

test('finance marking snapshots tax rate, payment fee rate, and payment amount', async () => {
  await withPhase1Server(async (baseUrl, { prisma }) => {
    const admin = await login(baseUrl);
    const updatedMethod = await requestJson(
      baseUrl,
      `/api/payment-methods/${SHOUQIANBA_ID}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          serviceFeeRate: '0.006',
        },
      },
    );
    assert.equal(updatedMethod.response.status, 200);

    const created = await requestJsonWithStage10ProductFixtures(
      baseUrl,
      '/api/sales-orders',
      {
        method: 'POST',
        token: admin.token,
        body: {
          orderType: 'external',
          orderDate: '2026-07-29',
          customer: { name: 'Profit Fee Snapshot Customer' },
          items: [
            {
              productName: 'Profit Fee Snapshot Product',
              quantity: 1,
              unitPriceCents: 10000,
              subtotalCents: 10000,
              deliveryType: 'self_pickup',
            },
          ],
        },
      },
    );
    assert.equal(created.response.status, 201);
    const orderId = created.body.data.salesOrder.id;

    const marked = await requestJson(
      baseUrl,
      `/api/sales-orders/${orderId}/finance-mark`,
      {
        method: 'PATCH',
        token: admin.token,
        body: { financeMark: true },
      },
    );
    assert.equal(marked.response.status, 200);

    const storedOrder = await prisma.salesOrder.findUnique({
      where: { id: orderId },
    });
    const storedDetails =
      await prisma.salesOrderPaymentDetail.findMany({
        where: { salesOrderId: orderId },
      });
    assert.equal(storedOrder.taxRateSnapshot, '0.01');
    assert.ok(storedOrder.profitFeeSnapshottedAt);
    assert.equal(
      storedOrder.profitFeeSnapshottedById,
      'usr_admin',
    );
    assert.equal(storedDetails.length, 1);
    assert.equal(
      storedDetails[0].serviceFeeRateSnapshot,
      '0.006000',
    );
    assert.equal(
      storedDetails[0].serviceFeeBaseAmountSnapshotCents,
      10000,
    );
  });
});

test('finance marking rejects any missing payment-method fee rate atomically', async () => {
  await withPhase1Server(async (baseUrl, { prisma }) => {
    const admin = await login(baseUrl);
    const configuredMethod = await requestJson(
      baseUrl,
      `/api/payment-methods/${SHOUQIANBA_ID}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: { serviceFeeRate: '0.006000' },
      },
    );
    assert.equal(configuredMethod.response.status, 200);

    const created = await requestJsonWithStage10ProductFixtures(
      baseUrl,
      '/api/sales-orders',
      {
        method: 'POST',
        token: admin.token,
        body: {
          orderType: 'external',
          orderDate: '2026-07-29',
          customer: { name: 'Missing Fee Rate Customer' },
          items: [
            {
              productName: 'Missing Fee Rate Product',
              quantity: 1,
              unitPriceCents: 10000,
              deliveryType: 'self_pickup',
            },
          ],
          paymentDetails: [
            {
              paymentMethodId: SHOUQIANBA_ID,
              amountCents: 6000,
            },
            {
              paymentMethodId: CASH_ID,
              amountCents: 4000,
            },
          ],
        },
      },
    );
    assert.equal(created.response.status, 201);
    const orderId = created.body.data.salesOrder.id;

    const rejected = await requestJson(
      baseUrl,
      `/api/sales-orders/${orderId}/finance-mark`,
      {
        method: 'PATCH',
        token: admin.token,
        body: { financeMark: true },
      },
    );
    assertErrorContract(
      rejected,
      409,
      'PAYMENT_METHOD_SERVICE_FEE_RATE_REQUIRED',
    );

    const storedOrder = await prisma.salesOrder.findUnique({
      where: { id: orderId },
    });
    const storedDetails =
      await prisma.salesOrderPaymentDetail.findMany({
        where: { salesOrderId: orderId },
        orderBy: { sortOrder: 'asc' },
      });
    assert.equal(storedOrder.financeMark, false);
    assert.equal(storedOrder.taxRateSnapshot ?? null, null);
    assert.equal(storedOrder.profitFeeSnapshottedAt ?? null, null);
    assert.equal(storedOrder.profitFeeSnapshottedById ?? null, null);
    assert.deepEqual(
      storedDetails.map((detail) => ({
        rate: detail.serviceFeeRateSnapshot ?? null,
        base: detail.serviceFeeBaseAmountSnapshotCents ?? null,
      })),
      [
        { rate: null, base: null },
        { rate: null, base: null },
      ],
    );

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=sales_orders.finance_mark.enable',
      { token: admin.token },
    );
    assert.equal(logs.response.status, 200);
    assert.equal(logs.body.data.logs.length, 0);
  });
});

test('finance marking snapshots mixed payments idempotently, protects them, and refreshes only after unmarking', async () => {
  await withPhase1Server(async (baseUrl, { prisma }) => {
    const superAdmin = await login(baseUrl);
    const financeUser = await createUser(
      baseUrl,
      superAdmin.token,
      {
        name: 'Snapshot Finance',
        username: 'snapshot-finance',
        password: 'Password123',
        role: 'finance',
      },
    );
    const salesUser = await createUser(baseUrl, superAdmin.token, {
      name: 'Snapshot Sales',
      username: 'snapshot-sales',
      password: 'Password123',
      role: 'sales',
    });
    const finance = await login(
      baseUrl,
      financeUser.username,
      'Password123',
    );
    const sales = await login(
      baseUrl,
      salesUser.username,
      'Password123',
    );

    for (const [methodId, serviceFeeRate] of [
      [SHOUQIANBA_ID, '0.006000'],
      [COD_ID, '0'],
    ]) {
      const updated = await requestJson(
        baseUrl,
        `/api/payment-methods/${methodId}`,
        {
          method: 'PATCH',
          token: superAdmin.token,
          body: { serviceFeeRate },
        },
      );
      assert.equal(updated.response.status, 200);
    }

    const created = await requestJsonWithStage10ProductFixtures(
      baseUrl,
      '/api/sales-orders',
      {
        method: 'POST',
        token: superAdmin.token,
        body: {
          orderType: 'external',
          orderDate: '2026-07-29',
          salesUserId: salesUser.id,
          customer: { name: 'Mixed Fee Snapshot Customer' },
          items: [
            {
              productName: 'Mixed Fee Snapshot Product',
              quantity: 1,
              unitPriceCents: 10000,
              deliveryType: 'self_pickup',
            },
          ],
          paymentDetails: [
            {
              paymentMethodId: SHOUQIANBA_ID,
              amountCents: 6000,
            },
            {
              paymentMethodId: COD_ID,
              amountCents: 4000,
            },
          ],
        },
      },
    );
    assert.equal(created.response.status, 201);
    const orderId = created.body.data.salesOrder.id;

    const denied = await requestJson(
      baseUrl,
      `/api/sales-orders/${orderId}/finance-mark`,
      {
        method: 'PATCH',
        token: sales.token,
        body: { financeMark: true },
      },
    );
    assertErrorContract(denied, 403, 'PERMISSION_DENIED');

    const marked = await requestJson(
      baseUrl,
      `/api/sales-orders/${orderId}/finance-mark`,
      {
        method: 'PATCH',
        token: finance.token,
        body: { financeMark: true },
      },
    );
    assert.equal(marked.response.status, 200);
    const firstSnapshot = marked.body.data.salesOrder;
    assert.equal(firstSnapshot.financeMark, true);
    assert.equal(firstSnapshot.taxRateSnapshot, '0.01');
    assert.ok(firstSnapshot.profitFeeSnapshottedAt);
    assert.equal(
      firstSnapshot.profitFeeSnapshottedById,
      financeUser.id,
    );
    assert.equal(firstSnapshot.markedById, financeUser.id);
    assert.deepEqual(
      firstSnapshot.paymentDetails.map((detail) => ({
        methodId: detail.paymentMethodId,
        rate: detail.serviceFeeRateSnapshot,
        base: detail.serviceFeeBaseAmountSnapshotCents,
        confirmed: detail.agencyCollectionConfirmed,
      })),
      [
        {
          methodId: SHOUQIANBA_ID,
          rate: '0.006000',
          base: 6000,
          confirmed: false,
        },
        {
          methodId: COD_ID,
          rate: '0.000000',
          base: 4000,
          confirmed: false,
        },
      ],
    );

    const salesRead = await requestJson(
      baseUrl,
      `/api/sales-orders/${orderId}`,
      { token: sales.token },
    );
    assert.equal(salesRead.response.status, 200);
    const salesOrder = salesRead.body.data.salesOrder;
    for (const field of [
      'taxRateSnapshot',
      'profitFeeSnapshottedAt',
      'profitFeeSnapshottedById',
    ]) {
      assert.equal(Object.hasOwn(salesOrder, field), false);
    }
    for (const detail of salesOrder.paymentDetails) {
      assert.equal(
        Object.hasOwn(detail, 'serviceFeeRateSnapshot'),
        false,
      );
      assert.equal(
        Object.hasOwn(
          detail,
          'serviceFeeBaseAmountSnapshotCents',
        ),
        false,
      );
    }

    for (const [methodId, serviceFeeRate] of [
      [SHOUQIANBA_ID, '0.009000'],
      [COD_ID, '0.001000'],
    ]) {
      const updated = await requestJson(
        baseUrl,
        `/api/payment-methods/${methodId}`,
        {
          method: 'PATCH',
          token: superAdmin.token,
          body: { serviceFeeRate },
        },
      );
      assert.equal(updated.response.status, 200);
    }

    const repeated = await requestJson(
      baseUrl,
      `/api/sales-orders/${orderId}/finance-mark`,
      {
        method: 'PATCH',
        token: superAdmin.token,
        body: { financeMark: true },
      },
    );
    assert.equal(repeated.response.status, 200);
    assert.equal(
      repeated.body.data.salesOrder.profitFeeSnapshottedAt,
      firstSnapshot.profitFeeSnapshottedAt,
    );
    assert.equal(
      repeated.body.data.salesOrder.profitFeeSnapshottedById,
      financeUser.id,
    );
    assert.equal(
      repeated.body.data.salesOrder.markedAt,
      firstSnapshot.markedAt,
    );
    assert.equal(
      repeated.body.data.salesOrder.markedById,
      financeUser.id,
    );
    assert.deepEqual(
      repeated.body.data.salesOrder.paymentDetails.map(
        (detail) => detail.serviceFeeRateSnapshot,
      ),
      ['0.006000', '0.000000'],
    );

    for (const path of [
      `/api/sales-orders/${orderId}/payment-details`,
      `/api/sales-orders/${orderId}`,
    ]) {
      const protectedUpdate = await requestJson(baseUrl, path, {
        method: 'PATCH',
        token: superAdmin.token,
        body: {
          paymentDetails: [
            {
              id: firstSnapshot.paymentDetails[0].id,
              paymentMethodId: SHOUQIANBA_ID,
              amountCents: 5000,
            },
            {
              id: firstSnapshot.paymentDetails[1].id,
              paymentMethodId: COD_ID,
              amountCents: 5000,
            },
          ],
        },
      });
      assertErrorContract(
        protectedUpdate,
        409,
        'PAYMENT_DETAILS_FINANCE_MARKED',
      );
    }

    const stillSnapshotted =
      await prisma.salesOrderPaymentDetail.findMany({
        where: { salesOrderId: orderId },
        orderBy: { sortOrder: 'asc' },
      });
    assert.deepEqual(
      stillSnapshotted.map((detail) => ({
        amount: detail.amountCents,
        rate: detail.serviceFeeRateSnapshot,
        base: detail.serviceFeeBaseAmountSnapshotCents,
      })),
      [
        { amount: 6000, rate: '0.006000', base: 6000 },
        { amount: 4000, rate: '0.000000', base: 4000 },
      ],
    );

    const unmarked = await requestJson(
      baseUrl,
      `/api/sales-orders/${orderId}/finance-mark`,
      {
        method: 'PATCH',
        token: superAdmin.token,
        body: { financeMark: false },
      },
    );
    assert.equal(unmarked.response.status, 200);
    assert.equal(unmarked.body.data.salesOrder.financeMark, false);
    assert.deepEqual(
      unmarked.body.data.salesOrder.paymentDetails.map(
        (detail) => detail.serviceFeeRateSnapshot,
      ),
      ['0.006000', '0.000000'],
    );

    const remarked = await requestJson(
      baseUrl,
      `/api/sales-orders/${orderId}/finance-mark`,
      {
        method: 'PATCH',
        token: superAdmin.token,
        body: { financeMark: true },
      },
    );
    assert.equal(remarked.response.status, 200);
    assert.equal(
      remarked.body.data.salesOrder.profitFeeSnapshottedById,
      'usr_admin',
    );
    assert.deepEqual(
      remarked.body.data.salesOrder.paymentDetails.map((detail) => ({
        rate: detail.serviceFeeRateSnapshot,
        base: detail.serviceFeeBaseAmountSnapshotCents,
      })),
      [
        { rate: '0.009000', base: 6000 },
        { rate: '0.001000', base: 4000 },
      ],
    );

    const enableLogs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=sales_orders.finance_mark.enable',
      { token: superAdmin.token },
    );
    assert.equal(enableLogs.response.status, 200);
    assert.equal(enableLogs.body.data.logs.length, 2);
    const latestEnableLog = enableLogs.body.data.logs.find(
      (log) =>
        log.entityId === orderId &&
        log.afterData?.paymentDetails?.some(
          (detail) =>
            detail.serviceFeeRateSnapshot === '0.009000',
        ),
    );
    assert.ok(latestEnableLog);
    assert.equal(latestEnableLog.afterData.taxRateSnapshot, '0.01');
    assert.equal(
      latestEnableLog.afterData.profitFeeSnapshottedById,
      'usr_admin',
    );
    assert.deepEqual(
      latestEnableLog.afterData.paymentDetails.map((detail) => ({
        rate: detail.serviceFeeRateSnapshot,
        base: detail.serviceFeeBaseAmountSnapshotCents,
      })),
      [
        { rate: '0.009000', base: 6000 },
        { rate: '0.001000', base: 4000 },
      ],
    );

    const disableLogs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=sales_orders.finance_mark.disable',
      { token: superAdmin.token },
    );
    assert.equal(disableLogs.response.status, 200);
    assert.equal(disableLogs.body.data.logs.length, 1);
    assert.equal(
      disableLogs.body.data.logs[0].afterData.financeMark,
      false,
    );
    assert.deepEqual(
      disableLogs.body.data.logs[0].afterData.paymentDetails.map(
        (detail) => detail.serviceFeeRateSnapshot,
      ),
      ['0.006000', '0.000000'],
    );
  });
});

test('sales order creation defaults to 收钱吧 and enforces exact signed payment totals from server-calculated items', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const createOrder = (
      suffix,
      { paymentDetails, cashOnDeliveryAmountCents } = {},
    ) =>
      requestJsonWithStage10ProductFixtures(
        baseUrl,
        '/api/sales-orders',
        {
          method: 'POST',
          token: admin.token,
          body: {
            orderType: 'external',
            orderDate: '2026-07-29',
            customer: { name: `Payment Customer ${suffix}` },
            items: [
              {
                productName: `Payment Product ${suffix}`,
                quantity: 1,
                unitPriceCents: 7000,
                subtotalCents: 7000,
                deliveryType: 'self_pickup',
              },
            ],
            ...(paymentDetails === undefined
              ? {}
              : { paymentDetails }),
            ...(cashOnDeliveryAmountCents === undefined
              ? {}
              : { cashOnDeliveryAmountCents }),
            totalAmountCents: 1,
          },
        },
      );

    const defaulted = await createOrder('default');
    assert.equal(defaulted.response.status, 201);
    assert.equal(defaulted.body.data.salesOrder.totalAmountCents, 7000);
    assert.equal(defaulted.body.data.salesOrder.cashOnDeliveryAmountCents, 0);
    assert.deepEqual(
      defaulted.body.data.salesOrder.paymentDetails.map((detail) => ({
        name: detail.paymentMethodNameSnapshot,
        amount: detail.amountCents,
      })),
      [{ name: '收钱吧', amount: 7000 }],
    );
    assert.deepEqual(
      defaulted.body.data.salesOrder.paymentSummary,
      {
        directReceiptAmountCents: 7000,
        collectOnDeliveryAmountCents: 0,
        confirmedCollectOnDeliveryAmountCents: 0,
        pendingCollectOnDeliveryAmountCents: 0,
        hasPendingCollectOnDelivery: false,
      },
    );
    assert.equal(defaulted.body.data.salesOrder.paymentStatus, 'received');
    assert.equal(defaulted.body.data.salesOrder.paymentStatusLabel, '已到账');

    const legacy = await createOrder('legacy', {
      cashOnDeliveryAmountCents: 2000,
    });
    assert.equal(legacy.response.status, 201);
    assert.deepEqual(
      legacy.body.data.salesOrder.paymentDetails.map((detail) => ({
        methodId: detail.paymentMethodId,
        category: detail.paymentMethodCategorySnapshot,
        amount: detail.amountCents,
      })),
      [
        {
          methodId: SHOUQIANBA_ID,
          category: 'direct_receipt',
          amount: 5000,
        },
        {
          methodId: COD_ID,
          category: 'collect_on_delivery',
          amount: 2000,
        },
      ],
    );
    assert.equal(
      legacy.body.data.salesOrder.cashOnDeliveryAmountCents,
      2000,
    );
    assert.deepEqual(legacy.body.data.salesOrder.paymentSummary, {
      directReceiptAmountCents: 5000,
      collectOnDeliveryAmountCents: 2000,
      confirmedCollectOnDeliveryAmountCents: 0,
      pendingCollectOnDeliveryAmountCents: 2000,
      hasPendingCollectOnDelivery: true,
    });
    assert.equal(legacy.body.data.salesOrder.paymentStatusLabel, '代收款');

    const repeatedAndSigned = await createOrder('signed', {
      cashOnDeliveryAmountCents: 999999,
      paymentDetails: [
        { paymentMethodId: CASH_ID, amountCents: 8000 },
        { paymentMethodId: CASH_ID, amountCents: 0 },
        { paymentMethodId: SHOUQIANBA_ID, amountCents: -1000 },
      ],
    });
    assert.equal(repeatedAndSigned.response.status, 201);
    assert.deepEqual(
      repeatedAndSigned.body.data.salesOrder.paymentDetails.map(
        (detail) => detail.amountCents,
      ),
      [8000, 0, -1000],
    );
    assert.equal(
      repeatedAndSigned.body.data.salesOrder.paymentDetailsSummary,
      '现金 ¥80；现金 ¥0；收钱吧 -¥10',
    );
    assert.equal(
      repeatedAndSigned.body.data.salesOrder.cashOnDeliveryAmountCents,
      0,
    );

    const mismatch = await createOrder('mismatch', {
      paymentDetails: [
        { paymentMethodId: SHOUQIANBA_ID, amountCents: 6999 },
      ],
    });
    assertErrorContract(mismatch, 400, 'PAYMENT_TOTAL_MISMATCH');

    const empty = await createOrder('empty', { paymentDetails: [] });
    assertErrorContract(empty, 400, 'PAYMENT_DETAILS_REQUIRED');

    const listed = await requestJson(baseUrl, '/api/sales-orders', {
      token: admin.token,
    });
    const listedSigned = listed.body.data.salesOrders.find(
      (order) => order.id === repeatedAndSigned.body.data.salesOrder.id,
    );
    assert.ok(listedSigned);
    assert.deepEqual(
      listedSigned.paymentSummary,
      repeatedAndSigned.body.data.salesOrder.paymentSummary,
    );
    assert.equal(listedSigned.paymentDetails.length, 3);

    const detailed = await requestJson(
      baseUrl,
      `/api/sales-orders/${repeatedAndSigned.body.data.salesOrder.id}`,
      { token: admin.token },
    );
    assert.equal(detailed.response.status, 200);
    assert.deepEqual(
      detailed.body.data.salesOrder.paymentDetails,
      repeatedAndSigned.body.data.salesOrder.paymentDetails,
    );
  });
});

test('sales order updates preserve historical inactive details, reject new inactive methods, and roll back item total mismatches', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const created = await requestJsonWithStage10ProductFixtures(
      baseUrl,
      '/api/sales-orders',
      {
        method: 'POST',
        token: admin.token,
        body: {
          orderType: 'external',
          orderDate: '2026-07-29',
          customer: { name: 'Payment Update Customer' },
          items: [
            {
              productName: 'Payment Update Product',
              quantity: 1,
              unitPriceCents: 7000,
              deliveryType: 'self_pickup',
            },
          ],
          paymentDetails: [
            { paymentMethodId: CASH_ID, amountCents: 7000 },
          ],
        },
      },
    );
    assert.equal(created.response.status, 201);
    let order = created.body.data.salesOrder;
    const historicalDetail = order.paymentDetails[0];

    const renamed = await requestJson(
      baseUrl,
      `/api/payment-methods/${CASH_ID}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: { name: 'Cash Renamed' },
      },
    );
    assert.equal(renamed.response.status, 200);

    const disabled = await requestJson(
      baseUrl,
      `/api/payment-methods/${CASH_ID}/disable`,
      {
        method: 'PATCH',
        token: admin.token,
      },
    );
    assert.equal(disabled.response.status, 200);

    const preserved = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          paymentDetails: [
            {
              id: historicalDetail.id,
              paymentMethodId: CASH_ID,
              amountCents: 7000,
            },
          ],
        },
      },
    );
    assert.equal(preserved.response.status, 200);
    assert.equal(
      preserved.body.data.salesOrder.paymentDetails[0]
        .paymentMethodNameSnapshot,
      historicalDetail.paymentMethodNameSnapshot,
    );

    const readdedInactive = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          paymentDetails: [
            { paymentMethodId: CASH_ID, amountCents: 7000 },
          ],
        },
      },
    );
    assertErrorContract(
      readdedInactive,
      409,
      'PAYMENT_METHOD_INACTIVE',
    );

    const legacyUpdated = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: { cashOnDeliveryAmountCents: 2000 },
      },
    );
    assert.equal(legacyUpdated.response.status, 200);
    order = legacyUpdated.body.data.salesOrder;
    assert.deepEqual(
      order.paymentDetails.map((detail) => ({
        methodId: detail.paymentMethodId,
        amount: detail.amountCents,
      })),
      [
        { methodId: CASH_ID, amount: 5000 },
        { methodId: COD_ID, amount: 2000 },
      ],
    );

    const explicitWins = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          cashOnDeliveryAmountCents: 6000,
          paymentDetails: [
            {
              paymentMethodId: SHOUQIANBA_ID,
              amountCents: 7000,
            },
          ],
        },
      },
    );
    assert.equal(explicitWins.response.status, 200);
    order = explicitWins.body.data.salesOrder;
    assert.equal(order.cashOnDeliveryAmountCents, 0);
    assert.deepEqual(
      order.paymentDetails.map((detail) => detail.paymentMethodId),
      [SHOUQIANBA_ID],
    );

    const changedItems = order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      quantity: 2,
      unitPriceCents: item.unitPriceCents,
      deliveryType: item.deliveryType,
      notes: item.notes,
      sortOrder: item.sortOrder,
    }));
    const mismatch = await requestJsonWithStage10ProductFixtures(
      baseUrl,
      `/api/sales-orders/${order.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: { items: changedItems },
      },
    );
    assertErrorContract(mismatch, 400, 'PAYMENT_TOTAL_MISMATCH');

    const afterRollback = await requestJson(
      baseUrl,
      `/api/sales-orders/${order.id}`,
      { token: admin.token },
    );
    assert.equal(afterRollback.response.status, 200);
    assert.equal(afterRollback.body.data.salesOrder.totalAmountCents, 7000);
    assert.equal(afterRollback.body.data.salesOrder.items[0].quantity, 1);
    assert.equal(
      afterRollback.body.data.salesOrder.paymentDetails[0].amountCents,
      7000,
    );

    const changedTogether = await requestJsonWithStage10ProductFixtures(
      baseUrl,
      `/api/sales-orders/${order.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          items: changedItems,
          paymentDetails: [
            {
              paymentMethodId: SHOUQIANBA_ID,
              amountCents: 14000,
            },
          ],
        },
      },
    );
    assert.equal(changedTogether.response.status, 200);
    assert.equal(
      changedTogether.body.data.salesOrder.totalAmountCents,
      14000,
    );

    const inactiveCreate = await requestJsonWithStage10ProductFixtures(
      baseUrl,
      '/api/sales-orders',
      {
        method: 'POST',
        token: admin.token,
        body: {
          orderType: 'external',
          orderDate: '2026-07-29',
          customer: { name: 'Inactive Payment Customer' },
          items: [
            {
              productName: 'Inactive Payment Product',
              quantity: 1,
              unitPriceCents: 7000,
              deliveryType: 'self_pickup',
            },
          ],
          paymentDetails: [
            { paymentMethodId: CASH_ID, amountCents: 7000 },
          ],
        },
      },
    );
    assertErrorContract(
      inactiveCreate,
      409,
      'PAYMENT_METHOD_INACTIVE',
    );
  });
});

test('travel group cash-on-delivery summary uses payment detail snapshots instead of the compatibility column', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const detail = await requestJson(
        baseUrl,
        '/api/travel-groups/payment-summary-group',
        { token: admin.token },
      );
      assert.equal(detail.response.status, 200);
      assert.equal(
        detail.body.data.travelGroup.orderSummary
          .cashOnDeliveryAmountCents,
        1200,
      );

      const list = await requestJson(baseUrl, '/api/travel-groups', {
        token: admin.token,
      });
      const listed = list.body.data.travelGroups.find(
        (group) => group.id === 'payment-summary-group',
      );
      assert.ok(listed);
      assert.equal(
        listed.orderSummary.cashOnDeliveryAmountCents,
        1200,
      );
    },
    {
      prisma: {
        travelGroups: [
          {
            id: 'payment-summary-group',
            groupNo: 'TG-PAYMENT-SUMMARY',
            visitDate: '2026-07-29',
            travelAgency: 'Payment Summary Agency',
            status: 'ORDERED',
          },
        ],
        salesOrders: [
          {
            id: 'payment-summary-order',
            orderNo: 'SO-PAYMENT-SUMMARY',
            orderType: 'TRAVEL_GROUP',
            travelGroupId: 'payment-summary-group',
            orderDate: '2026-07-29',
            totalAmountCents: 7000,
            cashOnDeliveryAmountCents: 6999,
            status: 'VALID',
            paymentDetails: [
              {
                id: 'payment-summary-direct',
                paymentMethodId: SHOUQIANBA_ID,
                paymentMethodNameSnapshot: '收钱吧',
                paymentMethodCategorySnapshot: 'DIRECT_RECEIPT',
                amountCents: 5800,
                sortOrder: 0,
              },
              {
                id: 'payment-summary-cod',
                paymentMethodId: COD_ID,
                paymentMethodNameSnapshot: '货到付款',
                paymentMethodCategorySnapshot:
                  'COLLECT_ON_DELIVERY',
                amountCents: 1200,
                sortOrder: 1,
              },
            ],
          },
        ],
      },
    },
  );
});

test('completion locks payment details, admin controls lock state, and agency confirmation bypasses the lock', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const financeUser = await createUser(baseUrl, admin.token, {
        name: 'Payment Finance',
        username: 'payment-finance',
        password: 'Password123',
        role: 'finance',
      });
      const finance = await login(
        baseUrl,
        financeUser.username,
        'Password123',
      );
      const orderAdminUser = await createUser(baseUrl, admin.token, {
        name: 'Payment Order Admin',
        username: 'payment-order-admin',
        password: 'Password123',
        role: 'admin',
      });
      const orderAdmin = await login(
        baseUrl,
        orderAdminUser.username,
        'Password123',
      );

      const completed = await requestJson(
        baseUrl,
        '/api/sales-orders/payment-order/completion',
        {
          method: 'PATCH',
          token: finance.token,
          body: { completed: true },
        },
      );
      assert.equal(completed.response.status, 200);
      assert.equal(completed.body.data.salesOrder.isCompleted, true);
      assert.equal(
        completed.body.data.salesOrder.paymentDetailsLocked,
        true,
      );
      assert.equal(completed.body.data.salesOrder.status, 'valid');
      assert.deepEqual(completed.body.data.salesOrder.paymentSummary, {
        directReceiptAmountCents: 7000,
        collectOnDeliveryAmountCents: 3000,
        confirmedCollectOnDeliveryAmountCents: 0,
        pendingCollectOnDeliveryAmountCents: 3000,
        hasPendingCollectOnDelivery: true,
      });
      assert.equal(
        completed.body.data.salesOrder.paymentStatusLabel,
        '代收款',
      );
      assert.deepEqual(
        completed.body.data.salesOrder.paymentDetails.map(
          (detail) => detail.paymentMethodNameSnapshot,
        ),
        ['收钱吧旧名称', '货到付款旧名称'],
      );

      const lockedUpdate = await requestJson(
        baseUrl,
        '/api/sales-orders/payment-order/payment-details',
        {
          method: 'PATCH',
          token: finance.token,
          body: {
            paymentDetails: [
              { paymentMethodId: SHOUQIANBA_ID, amountCents: 10000 },
            ],
          },
        },
      );
      assertErrorContract(lockedUpdate, 409, 'PAYMENT_DETAILS_LOCKED');

      const lockedGeneralUpdate = await requestJson(
        baseUrl,
        '/api/sales-orders/payment-order',
        {
          method: 'PATCH',
          token: finance.token,
          body: {
            paymentDetails: [
              {
                id: 'payment-direct',
                paymentMethodId: SHOUQIANBA_ID,
                amountCents: 7000,
              },
              {
                id: 'payment-cod',
                paymentMethodId: COD_ID,
                amountCents: 3000,
              },
            ],
          },
        },
      );
      assertErrorContract(
        lockedGeneralUpdate,
        409,
        'PAYMENT_DETAILS_LOCKED',
      );

      const financeUnlock = await requestJson(
        baseUrl,
        '/api/sales-orders/payment-order/payment-details-lock',
        {
          method: 'PATCH',
          token: finance.token,
          body: { locked: false },
        },
      );
      assertErrorContract(financeUnlock, 403, 'PERMISSION_DENIED');

      const confirmed = await requestJson(
        baseUrl,
        '/api/sales-orders/payment-order/payment-details/payment-cod/agency-confirmation',
        {
          method: 'PATCH',
          token: finance.token,
          body: { confirmed: true },
        },
      );
      assert.equal(confirmed.response.status, 200);
      assert.equal(
        confirmed.body.data.salesOrder.paymentDetails.find(
          (detail) => detail.id === 'payment-cod',
        ).agencyCollectionConfirmed,
        true,
      );
      assert.equal(
        confirmed.body.data.salesOrder.paymentDetails.find(
          (detail) => detail.id === 'payment-cod',
        ).agencyCollectionConfirmedByName,
        'Payment Finance',
      );
      assert.equal(
        confirmed.body.data.salesOrder.paymentSummary
          .confirmedCollectOnDeliveryAmountCents,
        3000,
      );
      assert.equal(
        confirmed.body.data.salesOrder.paymentSummary
          .pendingCollectOnDeliveryAmountCents,
        0,
      );
      assert.equal(
        confirmed.body.data.salesOrder.paymentStatusLabel,
        '已到账',
      );

      const confirmedAt = confirmed.body.data.salesOrder.paymentDetails.find(
        (detail) => detail.id === 'payment-cod',
      ).agencyCollectionConfirmedAt;
      const repeatedConfirmation = await requestJson(
        baseUrl,
        '/api/sales-orders/payment-order/payment-details/payment-cod/agency-confirmation',
        {
          method: 'PATCH',
          token: finance.token,
          body: { confirmed: true },
        },
      );
      assert.equal(repeatedConfirmation.response.status, 200);
      assert.equal(
        repeatedConfirmation.body.data.salesOrder.paymentDetails.find(
          (detail) => detail.id === 'payment-cod',
        ).agencyCollectionConfirmedAt,
        confirmedAt,
      );

      const confirmationLogs = await requestJson(
        baseUrl,
        '/api/operation-logs?action=sales_orders.agency_collection.confirm',
        { token: admin.token },
      );
      assert.equal(confirmationLogs.response.status, 200);
      assert.equal(confirmationLogs.body.data.logs.length, 1);

      const directConfirmation = await requestJson(
        baseUrl,
        '/api/sales-orders/payment-order/payment-details/payment-direct/agency-confirmation',
        {
          method: 'PATCH',
          token: finance.token,
          body: { confirmed: true },
        },
      );
      assertErrorContract(
        directConfirmation,
        400,
        'PAYMENT_DETAIL_NOT_AGENCY_COLLECTION',
      );

      const unlocked = await requestJson(
        baseUrl,
        '/api/sales-orders/payment-order/payment-details-lock',
        {
          method: 'PATCH',
          token: orderAdmin.token,
          body: { locked: false },
        },
      );
      assert.equal(unlocked.response.status, 200);
      assert.equal(unlocked.body.data.salesOrder.paymentDetailsLocked, false);
      assert.equal(
        unlocked.body.data.salesOrder.paymentDetailsUnlockedById,
        orderAdminUser.id,
      );
      assert.ok(unlocked.body.data.salesOrder.paymentDetailsUnlockedAt);

      const mismatch = await requestJson(
        baseUrl,
        '/api/sales-orders/payment-order/payment-details',
        {
          method: 'PATCH',
          token: finance.token,
          body: {
            paymentDetails: [
              { paymentMethodId: SHOUQIANBA_ID, amountCents: 9999 },
            ],
          },
        },
      );
      assertErrorContract(mismatch, 400, 'PAYMENT_TOTAL_MISMATCH');

      const replaced = await requestJson(
        baseUrl,
        '/api/sales-orders/payment-order/payment-details',
        {
          method: 'PATCH',
          token: finance.token,
          body: {
            paymentDetails: [
              {
                id: 'payment-direct',
                paymentMethodId: SHOUQIANBA_ID,
                amountCents: 6000,
              },
              {
                id: 'payment-cod',
                paymentMethodId: COD_ID,
                amountCents: 4000,
              },
            ],
          },
        },
      );
      assert.equal(replaced.response.status, 200);
      assert.equal(
        replaced.body.data.salesOrder.cashOnDeliveryAmountCents,
        4000,
      );
      assert.equal(
        replaced.body.data.salesOrder.paymentDetails.find(
          (detail) => detail.id === 'payment-cod',
        ).agencyCollectionConfirmed,
        false,
      );
      assert.equal(
        replaced.body.data.salesOrder.paymentSummary
          .pendingCollectOnDeliveryAmountCents,
        4000,
      );
      assert.equal(
        replaced.body.data.salesOrder.paymentStatusLabel,
        '代收款',
      );

      const resetLogs = await requestJson(
        baseUrl,
        '/api/operation-logs?action=sales_orders.agency_collection.confirmation_reset',
        { token: admin.token },
      );
      assert.equal(resetLogs.response.status, 200);
      assert.equal(resetLogs.body.data.logs.length, 1);
      assert.equal(
        resetLogs.body.data.logs[0].beforeData
          .agencyCollectionConfirmed,
        true,
      );
      assert.equal(
        resetLogs.body.data.logs[0].afterData
          .agencyCollectionConfirmed,
        false,
      );

      const reconfirmed = await requestJson(
        baseUrl,
        '/api/sales-orders/payment-order/payment-details/payment-cod/agency-confirmation',
        {
          method: 'PATCH',
          token: finance.token,
          body: { confirmed: true },
        },
      );
      assert.equal(reconfirmed.response.status, 200);

      const methodChanged = await requestJson(
        baseUrl,
        '/api/sales-orders/payment-order/payment-details',
        {
          method: 'PATCH',
          token: finance.token,
          body: {
            paymentDetails: [
              {
                id: 'payment-direct',
                paymentMethodId: SHOUQIANBA_ID,
                amountCents: 6000,
              },
              {
                id: 'payment-cod',
                paymentMethodId: CASH_ID,
                amountCents: 4000,
              },
            ],
          },
        },
      );
      assert.equal(methodChanged.response.status, 200);
      assert.equal(
        methodChanged.body.data.salesOrder.paymentDetails.find(
          (detail) => detail.id === 'payment-cod',
        ).agencyCollectionConfirmed,
        false,
      );
      assert.equal(
        methodChanged.body.data.salesOrder.paymentSummary
          .collectOnDeliveryAmountCents,
        0,
      );
      assert.equal(
        methodChanged.body.data.salesOrder.paymentStatusLabel,
        '已到账',
      );

      const methodResetLogs = await requestJson(
        baseUrl,
        '/api/operation-logs?action=sales_orders.agency_collection.confirmation_reset',
        { token: admin.token },
      );
      assert.equal(methodResetLogs.response.status, 200);
      assert.equal(methodResetLogs.body.data.logs.length, 2);

      const relocked = await requestJson(
        baseUrl,
        '/api/sales-orders/payment-order/payment-details-lock',
        {
          method: 'PATCH',
          token: orderAdmin.token,
          body: { locked: true },
        },
      );
      assert.equal(relocked.response.status, 200);
      assert.equal(relocked.body.data.salesOrder.paymentDetailsLocked, true);
      assert.equal(
        relocked.body.data.salesOrder.paymentDetailsLockedById,
        orderAdminUser.id,
      );
      assert.equal(
        relocked.body.data.salesOrder.paymentDetailsUnlockedAt,
        null,
      );
    },
    {
      prisma: {
        salesOrders: [
          {
            id: 'payment-order',
            orderNo: 'SO-PAYMENT-1',
            orderType: 'EXTERNAL',
            orderDate: '2026-07-29',
            totalAmountCents: 10000,
            cashOnDeliveryAmountCents: 3000,
            paymentDetails: [
              {
                id: 'payment-direct',
                paymentMethodId: SHOUQIANBA_ID,
                paymentMethodNameSnapshot: '收钱吧旧名称',
                paymentMethodCategorySnapshot: 'DIRECT_RECEIPT',
                amountCents: 7000,
                sortOrder: 0,
              },
              {
                id: 'payment-cod',
                paymentMethodId: COD_ID,
                paymentMethodNameSnapshot: '货到付款旧名称',
                paymentMethodCategorySnapshot: 'COLLECT_ON_DELIVERY',
                amountCents: 3000,
                sortOrder: 1,
              },
            ],
            status: 'VALID',
          },
        ],
      },
    },
  );
});

test('sales completion reuses the existing sales ownership scope', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const ownerUser = await createUser(baseUrl, admin.token, {
      name: 'Completion Owner',
      username: 'completion-owner',
      password: 'Password123',
      role: 'sales',
    });
    const otherUser = await createUser(baseUrl, admin.token, {
      name: 'Completion Other',
      username: 'completion-other',
      password: 'Password123',
      role: 'sales',
    });
    const owner = await login(
      baseUrl,
      ownerUser.username,
      'Password123',
    );
    const other = await login(
      baseUrl,
      otherUser.username,
      'Password123',
    );
    const created = await requestJsonWithStage10ProductFixtures(
      baseUrl,
      '/api/sales-orders',
      {
        method: 'POST',
        token: owner.token,
        body: {
          orderType: 'external',
          orderDate: '2026-07-29',
          customer: { name: 'Completion Scope Customer' },
          items: [
            {
              productName: 'Completion Scope Product',
              quantity: 1,
              unitPriceCents: 5000,
              deliveryType: 'self_pickup',
            },
          ],
        },
      },
    );
    assert.equal(created.response.status, 201);
    const orderId = created.body.data.salesOrder.id;

    const overreach = await requestJson(
      baseUrl,
      `/api/sales-orders/${orderId}/completion`,
      {
        method: 'PATCH',
        token: other.token,
        body: { completed: true },
      },
    );
    assertErrorContract(overreach, 404, 'SALES_ORDER_NOT_FOUND');

    const completed = await requestJson(
      baseUrl,
      `/api/sales-orders/${orderId}/completion`,
      {
        method: 'PATCH',
        token: owner.token,
        body: { completed: true },
      },
    );
    assert.equal(completed.response.status, 200);
    assert.equal(completed.body.data.salesOrder.isCompleted, true);
    assert.equal(
      completed.body.data.salesOrder.completedById,
      ownerUser.id,
    );
    assert.equal(
      completed.body.data.salesOrder.paymentDetailsLocked,
      true,
    );
  });
});
