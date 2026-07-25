const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  assertOperationLogContract,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

test('contract: stage7 taster manual commission can be created and updated by finance', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const finance = await login(
      baseUrl,
      'stage7-taster-manual-finance',
      'Password123',
    );

    const created = await requestJson(
      baseUrl,
      '/api/commission-records/new/manual-amount',
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          salesOrderId: 'so-stage7-taster-manual-1',
          amountCents: 12345,
          calculationNote: 'stage7 test taster manual create',
        },
      },
    );
    assert.equal(created.response.status, 200);
    assertTasterManualRecord(created.body.data.commissionRecord, {
      amountCents: 12345,
      isConfirmed: false,
    });
    assert.equal(
      created.body.data.commissionRecord.sourceSnapshot.travelGroup.id,
      'tg-stage7-taster-manual',
    );
    assert.equal(
      created.body.data.commissionRecord.sourceSnapshot.taster.id,
      'usr-stage7-taster',
    );
    assert.equal(
      created.body.data.commissionRecord.sourceSnapshot.operatedBy.id,
      finance.user.id,
    );
    assert.equal(
      created.body.data.commissionRecord.salesOrderId,
      'so-stage7-taster-manual-1',
    );

    const secondOrder = await requestJson(
      baseUrl,
      '/api/commission-records/new/manual-amount',
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          salesOrderId: 'so-stage7-taster-manual-2',
          amountCents: 6789,
        },
      },
    );
    assert.equal(secondOrder.response.status, 200);
    assert.equal(secondOrder.body.data.commissionRecord.amountCents, 6789);
    assert.equal(
      secondOrder.body.data.commissionRecord.salesOrderId,
      'so-stage7-taster-manual-2',
    );
    assert.notEqual(
      secondOrder.body.data.commissionRecord.id,
      created.body.data.commissionRecord.id,
    );

    const repeatedCreate = await requestJson(
      baseUrl,
      '/api/commission-records/new/manual-amount',
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          salesOrderId: 'so-stage7-taster-manual-1',
          amountCents: 12345,
        },
      },
    );
    assert.equal(repeatedCreate.response.status, 200);
    assert.equal(
      repeatedCreate.body.data.commissionRecord.id,
      created.body.data.commissionRecord.id,
    );

    const updated = await requestJson(
      baseUrl,
      `/api/commission-records/${created.body.data.commissionRecord.id}/manual-amount`,
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          amountCents: 23456,
          note: 'stage7 test taster manual update',
        },
      },
    );
    assert.equal(updated.response.status, 200);
    assertTasterManualRecord(updated.body.data.commissionRecord, {
      amountCents: 23456,
      isConfirmed: false,
    });
    assert.equal(
      updated.body.data.commissionRecord.sourceSnapshot.operation,
      'update_taster_manual_commission',
    );
    assert.equal(
      secondOrder.body.data.commissionRecord.amountCents,
      6789,
    );
    const listed = await requestJson(
      baseUrl,
      '/api/commission-records?targetType=taster_commission&manualInput=true',
      { token: finance.token },
    );
    assert.equal(listed.response.status, 200);
    assert.equal(listed.body.data.commissionRecords.length, 2);

    const createLogs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=commission_records.taster_manual_amount.create',
      {
        token: admin.token,
      },
    );
    assert.equal(createLogs.response.status, 200);
    const createdLog = createLogs.body.data.logs.find(
      (log) => log.entityId === created.body.data.commissionRecord.id,
    );
    assert.ok(createdLog);
    assertStage7TasterLog(createdLog, {
      action: 'commission_records.taster_manual_amount.create',
      userId: finance.user.id,
    });
    assert.equal(createdLog.beforeData, null);
    assert.equal(createdLog.afterData.amountCents, 12345);

    const updateLogs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=commission_records.taster_manual_amount.update',
      {
        token: admin.token,
      },
    );
    const updatedLog = updateLogs.body.data.logs.find(
      (log) =>
        log.entityId === created.body.data.commissionRecord.id &&
        log.afterData?.amountCents === 23456,
    );
    assert.ok(updatedLog);
    assertStage7TasterLog(updatedLog, {
      action: 'commission_records.taster_manual_amount.update',
      userId: finance.user.id,
    });
    assert.equal(updatedLog.beforeData.amountCents, 12345);
    assert.equal(updatedLog.afterData.amountCents, 23456);
  }, {
    prisma: buildTasterManualPrisma(),
  });
});

test('contract: stage7 taster manual amount update resets confirmation', async () => {
  await withPhase1Server(async (baseUrl) => {
    const finance = await login(
      baseUrl,
      'stage7-taster-manual-finance',
      'Password123',
    );

    const updated = await requestJson(
      baseUrl,
      '/api/commission-records/rec-stage7-confirmed-taster/manual-amount',
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          amountCents: 34567,
        },
      },
    );

    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.data.commissionRecord.amountCents, 34567);
    assert.equal(updated.body.data.commissionRecord.isConfirmed, false);
    assert.equal(updated.body.data.commissionRecord.confirmedById, null);
    assert.equal(updated.body.data.commissionRecord.confirmedAt, null);
  }, {
    prisma: buildTasterManualPrisma({
      commissionRecords: [
        confirmedTasterCommissionRecord(),
      ],
    }),
  });
});

test('contract: concurrent order-level taster commission requests reuse one record', async () => {
  await withPhase1Server(async (baseUrl) => {
    const finance = await login(
      baseUrl,
      'stage7-taster-manual-finance',
      'Password123',
    );
    const results = await Promise.all([
      requestJson(
        baseUrl,
        '/api/commission-records/new/manual-amount',
        {
          method: 'PATCH',
          token: finance.token,
          body: {
            salesOrderId: 'so-stage7-taster-manual-1',
            amountCents: 1111,
          },
        },
      ),
      requestJson(
        baseUrl,
        '/api/commission-records/new/manual-amount',
        {
          method: 'PATCH',
          token: finance.token,
          body: {
            salesOrderId: 'so-stage7-taster-manual-1',
            amountCents: 2222,
          },
        },
      ),
    ]);
    assert.deepEqual(
      results.map((result) => result.response.status),
      [200, 200],
    );
    assert.equal(
      results[0].body.data.commissionRecord.id,
      results[1].body.data.commissionRecord.id,
    );

    const listed = await requestJson(
      baseUrl,
      '/api/commission-records?salesOrderId=so-stage7-taster-manual-1&manualInput=true',
      { token: finance.token },
    );
    assert.equal(listed.response.status, 200);
    assert.equal(listed.body.data.commissionRecords.length, 1);
  }, {
    prisma: buildTasterManualPrisma(),
  });
});

test('contract: stage7 taster manual commission can be confirmed and unconfirmed by finance', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const finance = await login(
      baseUrl,
      'stage7-taster-manual-finance',
      'Password123',
    );

    const confirmed = await requestJson(
      baseUrl,
      '/api/commission-records/rec-stage7-taster/confirm',
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          isConfirmed: true,
        },
      },
    );
    assert.equal(confirmed.response.status, 200);
    assert.equal(confirmed.body.data.commissionRecord.isConfirmed, true);
    assert.equal(
      confirmed.body.data.commissionRecord.confirmedById,
      finance.user.id,
    );
    assert.ok(confirmed.body.data.commissionRecord.confirmedAt);

    const unconfirmed = await requestJson(
      baseUrl,
      '/api/commission-records/rec-stage7-taster/confirm',
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          isConfirmed: false,
        },
      },
    );
    assert.equal(unconfirmed.response.status, 200);
    assert.equal(unconfirmed.body.data.commissionRecord.isConfirmed, false);
    assert.equal(unconfirmed.body.data.commissionRecord.confirmedById, null);
    assert.equal(unconfirmed.body.data.commissionRecord.confirmedAt, null);

    const enableLogs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=commission_records.confirm.enable',
      {
        token: admin.token,
      },
    );
    assert.equal(enableLogs.response.status, 200);
    const enableLog = enableLogs.body.data.logs.find(
      (log) => log.entityId === 'rec-stage7-taster',
    );
    assert.ok(enableLog);
    assertStage7TasterLog(enableLog, {
      action: 'commission_records.confirm.enable',
      userId: finance.user.id,
    });
    assert.equal(enableLog.beforeData.isConfirmed, false);
    assert.equal(enableLog.afterData.isConfirmed, true);

    const disableLogs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=commission_records.confirm.disable',
      {
        token: admin.token,
      },
    );
    assert.equal(disableLogs.response.status, 200);
    const disableLog = disableLogs.body.data.logs.find(
      (log) => log.entityId === 'rec-stage7-taster',
    );
    assert.ok(disableLog);
    assertStage7TasterLog(disableLog, {
      action: 'commission_records.confirm.disable',
      userId: finance.user.id,
    });
    assert.equal(disableLog.beforeData.isConfirmed, true);
    assert.equal(disableLog.afterData.isConfirmed, false);
  }, {
    prisma: buildTasterManualPrisma({
      commissionRecords: [
        tasterCommissionRecord(),
      ],
    }),
  });
});

test('contract: stage7 taster manual commission allows admin write role', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);

    const created = await requestJson(
      baseUrl,
      '/api/commission-records/new/manual-amount',
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          salesOrderId: 'so-stage7-taster-manual-1',
          amountCents: 45678,
          calculationNote: 'stage7 test admin taster manual create',
        },
      },
    );
    assert.equal(created.response.status, 200);

    const confirmed = await requestJson(
      baseUrl,
      `/api/commission-records/${created.body.data.commissionRecord.id}/confirm`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          isConfirmed: true,
        },
      },
    );
    assert.equal(confirmed.response.status, 200);
    assert.equal(confirmed.body.data.commissionRecord.isConfirmed, true);
    assert.equal(
      confirmed.body.data.commissionRecord.confirmedById,
      admin.user.id,
    );
  }, {
    prisma: buildTasterManualPrisma(),
  });
});

test('contract: stage7 taster manual commission rejects non-finance roles and negative amounts', async () => {
  await withPhase1Server(async (baseUrl) => {
    const finance = await login(
      baseUrl,
      'stage7-taster-manual-finance',
      'Password123',
    );

    for (const username of [
      'stage7-taster-manual-boss',
      'stage7-taster-manual-sales',
      'stage7-taster-manual-warehouse',
      'stage7-taster-manual-after-sales',
      'stage7-taster-manual-front-desk',
      'stage7-taster-manual-taster',
    ]) {
      const session = await login(baseUrl, username, 'Password123');
      const deniedManualAmount = await requestJson(
        baseUrl,
        '/api/commission-records/new/manual-amount',
        {
          method: 'PATCH',
          token: session.token,
          body: {
            salesOrderId: 'so-stage7-taster-manual-1',
            amountCents: 100,
          },
        },
      );
      assertErrorContract(deniedManualAmount, 403, 'PERMISSION_DENIED');

      const deniedConfirm = await requestJson(
        baseUrl,
        '/api/commission-records/rec-stage7-taster/confirm',
        {
          method: 'PATCH',
          token: session.token,
          body: {
            isConfirmed: true,
          },
        },
      );
      assertErrorContract(deniedConfirm, 403, 'PERMISSION_DENIED');
    }

    const negative = await requestJson(
      baseUrl,
      '/api/commission-records/new/manual-amount',
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          salesOrderId: 'so-stage7-taster-manual-1',
          amountCents: -1,
        },
      },
    );
    assertErrorContract(negative, 400, 'VALIDATION_FAILED');
  }, {
    prisma: buildTasterManualPrisma(),
  });
});

test('contract: stage7 taster manual commission rejects non-taster commission records', async () => {
  await withPhase1Server(async (baseUrl) => {
    const finance = await login(
      baseUrl,
      'stage7-taster-manual-finance',
      'Password123',
    );

    const result = await requestJson(
      baseUrl,
      '/api/commission-records/rec-stage7-sales/manual-amount',
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          amountCents: 12345,
        },
      },
    );
    assertErrorContract(
      result,
      400,
      'COMMISSION_RECORD_NOT_TASTER_MANUAL',
    );
  }, {
    prisma: buildTasterManualPrisma({
      commissionRecords: [
        {
          ...tasterCommissionRecord({
            id: 'rec-stage7-sales',
            targetType: 'SALES_COMMISSION',
          }),
          manualInput: false,
        },
      ],
    }),
  });
});

test('contract: order-level taster commission validates order relationships and amount range', async () => {
  await withPhase1Server(async (baseUrl) => {
    const finance = await login(
      baseUrl,
      'stage7-taster-manual-finance',
      'Password123',
    );

    for (const [body, expectedStatus] of [
      [{
        amountCents: 100,
      }, 400],
      [{
        salesOrderId: 'missing-sales-order',
        amountCents: 100,
      }, 404],
      [{
        salesOrderId: 'so-stage7-taster-manual-1',
        travelGroupId: 'wrong-travel-group',
        amountCents: 100,
      }, 400],
      [{
        salesOrderId: 'so-stage7-taster-manual-1',
        tasterId: 'wrong-taster',
        amountCents: 100,
      }, 400],
      [{
        salesOrderId: 'so-stage7-taster-manual-1',
        amountCents: 2147483648,
      }, 400],
      [{
        salesOrderId: 'so-stage7-without-taster',
        amountCents: 100,
      }, 400],
    ]) {
      const result = await requestJson(
        baseUrl,
        '/api/commission-records/new/manual-amount',
        {
          method: 'PATCH',
          token: finance.token,
          body,
        },
      );
      assert.equal(result.response.status, expectedStatus);
      assert.ok(result.body.error.code);
    }
  }, {
    prisma: buildTasterManualPrisma({
      travelGroups: [
        {
          id: 'tg-stage7-without-taster',
          groupNo: 'TG-STAGE7-WITHOUT-TASTER',
          visitDate: '2026-07-20',
          tasterId: null,
          tasterName: null,
        },
      ],
      salesOrders: [
        {
          id: 'so-stage7-without-taster',
          orderNo: 'SO-STAGE7-WITHOUT-TASTER',
          orderType: 'TRAVEL_GROUP',
          travelGroupId: 'tg-stage7-without-taster',
          customerName: 'No Taster Customer',
          orderDate: '2026-07-20',
          status: 'VALID',
        },
      ],
    }),
  });
});

function buildTasterManualPrisma(overrides = {}) {
  return {
    users: [
      {
        id: 'usr-stage7-finance',
        name: 'Stage7 Test Finance',
        username: 'stage7-taster-manual-finance',
        password: 'Password123',
        role: 'finance',
      },
      {
        id: 'usr-stage7-boss',
        name: 'Stage7 Test Boss',
        username: 'stage7-taster-manual-boss',
        password: 'Password123',
        role: 'boss',
      },
      {
        id: 'usr-stage7-sales',
        name: 'Stage7 Test Sales',
        username: 'stage7-taster-manual-sales',
        password: 'Password123',
        role: 'sales',
      },
      {
        id: 'usr-stage7-warehouse',
        name: 'Stage7 Test Warehouse',
        username: 'stage7-taster-manual-warehouse',
        password: 'Password123',
        role: 'warehouse',
      },
      {
        id: 'usr-stage7-after-sales',
        name: 'Stage7 Test After Sales',
        username: 'stage7-taster-manual-after-sales',
        password: 'Password123',
        role: 'after_sales',
      },
      {
        id: 'usr-stage7-front-desk',
        name: 'Stage7 Test Front Desk',
        username: 'stage7-taster-manual-front-desk',
        password: 'Password123',
        role: 'front_desk',
      },
      {
        id: 'usr-stage7-taster',
        name: 'Stage7 Test Taster',
        username: 'stage7-taster-manual-taster',
        password: 'Password123',
        role: 'taster',
      },
      ...(overrides.users || []),
    ],
    travelGroups: [
      {
        id: 'tg-stage7-taster-manual',
        groupNo: 'TG-STAGE7-TASTER-MANUAL',
        visitDate: '2026-07-20',
        travelAgency: 'Stage7 Test Agency',
        tasterId: 'usr-stage7-taster',
        tasterName: 'Stage7 Test Taster',
        financeMark: true,
      },
      ...(overrides.travelGroups || []),
    ],
    salesOrders: [
      {
        id: 'so-stage7-taster-manual-1',
        orderNo: 'SO-STAGE7-TASTER-MANUAL-1',
        orderType: 'TRAVEL_GROUP',
        travelGroupId: 'tg-stage7-taster-manual',
        customerName: 'Stage7 Customer One',
        orderDate: '2026-07-20',
        status: 'VALID',
      },
      {
        id: 'so-stage7-taster-manual-2',
        orderNo: 'SO-STAGE7-TASTER-MANUAL-2',
        orderType: 'TRAVEL_GROUP',
        travelGroupId: 'tg-stage7-taster-manual',
        customerName: 'Stage7 Customer Two',
        orderDate: '2026-07-20',
        status: 'VALID',
      },
      ...(overrides.salesOrders || []),
    ],
    commissionRecords: overrides.commissionRecords || [],
  };
}

function tasterCommissionRecord(overrides = {}) {
  return {
    id: overrides.id || 'rec-stage7-taster',
    salesOrderId:
      overrides.salesOrderId === undefined
        ? 'so-stage7-taster-manual-1'
        : overrides.salesOrderId,
    travelGroupId: 'tg-stage7-taster-manual',
    targetType: overrides.targetType || 'TASTER_COMMISSION',
    targetUserId: 'usr-stage7-taster',
    amountCents: overrides.amountCents ?? 12000,
    pointsCents: 0,
    manualInput: overrides.manualInput ?? true,
    isConfirmed: overrides.isConfirmed ?? false,
    confirmedById: overrides.confirmedById ?? null,
    confirmedAt: overrides.confirmedAt ?? null,
    calculationVersion: 'stage7_v1',
    calculationNote: 'stage7 test taster manual existing',
    ruleSnapshot: {
      targetType: 'TASTER_COMMISSION',
      manualInput: true,
      ruleSource: 'finance_manual_input',
    },
    sourceSnapshot: {
      sourceType: 'taster_manual_commission',
      manualInput: true,
      travelGroup: { id: 'tg-stage7-taster-manual' },
      taster: { id: 'usr-stage7-taster' },
    },
    createdById: 'usr-stage7-finance',
    updatedById: 'usr-stage7-finance',
  };
}

function confirmedTasterCommissionRecord() {
  return tasterCommissionRecord({
    id: 'rec-stage7-confirmed-taster',
    amountCents: 23000,
    isConfirmed: true,
    confirmedById: 'usr-stage7-finance',
    confirmedAt: '2026-07-21T10:00:00.000Z',
  });
}

function assertStage7TasterLog(log, expected) {
  assertOperationLogContract(log);
  assert.equal(log.action, expected.action);
  assert.equal(log.entityType, 'commission_record');
  assert.equal(log.userId, expected.userId);
  assert.equal(typeof log.entityId, 'string');
  assert.equal(typeof log.ipAddress, 'string');
  assert.ok(log.ipAddress.length > 0);
  const serialized = JSON.stringify(log);
  assert.equal(/Password123|secret-token|DATABASE_URL/i.test(serialized), false);
}

function assertTasterManualRecord(record, expected = {}) {
  assert.equal(record.targetType, 'taster_commission');
  assert.equal(record.salesOrderId, 'so-stage7-taster-manual-1');
  assert.equal(record.travelGroupId, 'tg-stage7-taster-manual');
  assert.equal(record.targetUserId, 'usr-stage7-taster');
  assert.equal(record.manualInput, true);
  assert.equal(record.amountCents, expected.amountCents);
  assert.equal(record.isConfirmed, expected.isConfirmed);
  assert.equal(record.confirmedById, null);
  assert.equal(record.confirmedAt, null);
  assert.equal(record.calculationVersion, 'stage7_v1');
  assert.equal(record.ruleSnapshot.ruleSource, 'finance_manual_input');
  assert.equal(record.sourceSnapshot.manualInput, true);
}
