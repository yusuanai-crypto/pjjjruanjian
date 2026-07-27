const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

test('contract: stage7 commission record list supports filters and summary fields', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);

    const result = await requestJson(
      baseUrl,
      '/api/commission-records?targetType=sales_commission&targetUserId=usr-stage7-query-sales&salesOrderId=so-stage7-marked&travelGroupId=tg-stage7-marked&isConfirmed=false&manualInput=false&dateFrom=2026-07-01&dateTo=2026-07-01&query=SO-STAGE7-MARKED&limit=5',
      {
        token: admin.token,
      },
    );

    assert.equal(result.response.status, 200);
    const records = result.body.data.commissionRecords;
    assert.equal(records.length, 1);
    assert.equal(records[0].id, 'rec-stage7-query-sales');
    assert.equal(records[0].salesOrderNo, 'SO-STAGE7-MARKED');
    assert.equal(records[0].salesOrder.orderNo, 'SO-STAGE7-MARKED');
    assert.equal(records[0].travelGroup.groupNo, 'TG-STAGE7-MARKED');
    assert.equal(records[0].customer.name, 'Stage7 Query Marked Customer');
    assert.equal(records[0].targetUser.id, 'usr-stage7-query-sales');
    assert.equal(records[0].baseAmountCents, 90000);
    assert.equal(records[0].amountCents, 1800);
    assert.equal(records[0].pointsCents, 0);
    assert.equal(records[0].isConfirmed, false);
    assert.match(records[0].calculationNoteSummary, /stage7 query sales/);

    const agencyResult = await requestJson(
      baseUrl,
      '/api/commission-records?targetType=agency_daily_rebate&agencyId=agency-stage7-query&limit=10',
      {
        token: admin.token,
      },
    );
    assert.equal(agencyResult.response.status, 200);
    assert.deepEqual(recordIds(agencyResult.body.data.commissionRecords), [
      'rec-stage7-query-agency',
    ]);
    assert.equal(
      agencyResult.body.data.commissionRecords[0].agency.name,
      'Stage7 Query Agency',
    );
    assert.equal(agencyResult.body.data.commissionRecords[0].pointsCents, 3000);
  }, {
    prisma: buildCommissionRecordsQueryPrisma(),
  });
});

test('contract: stage7 commission record detail returns sanitized source snapshot', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);

    const result = await requestJson(
      baseUrl,
      '/api/commission-records/rec-stage7-query-sales',
      {
        token: admin.token,
      },
    );

    assert.equal(result.response.status, 200);
    const record = result.body.data.commissionRecord;
    assert.equal(record.id, 'rec-stage7-query-sales');
    assert.equal(record.sourceSnapshot.salesOrder.orderNo, 'SO-STAGE7-MARKED');
    assert.equal(record.sourceSnapshot.salesOrder.customerPhone, undefined);
    assert.equal(record.sourceSnapshot.unsafeToken, undefined);
    assert.equal(record.sourceSnapshot.password, undefined);
    assert.equal(record.sourceSnapshot.shippingAddress, undefined);
    assert.equal(JSON.stringify(record.sourceSnapshot).includes('secret-token'), false);
    assert.equal(JSON.stringify(record.sourceSnapshot).includes('Password123'), false);

    const orphan = await requestJson(
      baseUrl,
      '/api/commission-records/rec-stage7-query-orphan',
      {
        token: admin.token,
      },
    );
    assertErrorContract(orphan, 404, 'COMMISSION_RECORD_NOT_FOUND');
  }, {
    prisma: buildCommissionRecordsQueryPrisma(),
  });
});

test('contract: stage7 commission record list enforces role permissions', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const finance = await login(baseUrl, 'stage7-query-finance', 'Password123');
    const boss = await login(baseUrl, 'stage7-query-boss', 'Password123');

    for (const session of [admin, finance, boss]) {
      for (const pathName of [
        '/api/commission-records',
        '/api/commission-records/rec-stage7-query-sales',
      ]) {
        const allowed = await requestJson(baseUrl, pathName, {
          token: session.token,
        });
        assert.equal(allowed.response.status, 200);
      }
      const exportStatus = await requestStatus(
        baseUrl,
        '/api/commission-records/export?limit=20',
        {
          token: session.token,
        },
      );
      assert.equal(exportStatus, 200);
    }

    for (const username of [
      'stage7-query-sales',
      'stage7-query-warehouse',
      'stage7-query-after-sales',
      'stage7-query-front-desk',
      'stage7-query-taster-a',
    ]) {
      const session = await login(baseUrl, username, 'Password123');
      for (const pathName of [
        '/api/commission-records',
        '/api/commission-records/rec-stage7-query-sales',
        '/api/commission-records/export',
      ]) {
        const denied = await requestJson(baseUrl, pathName, {
          token: session.token,
        });
        assertErrorContract(denied, 403, 'PERMISSION_DENIED');
      }
    }
  }, {
    prisma: buildCommissionRecordsQueryPrisma(),
  });
});

test('contract: stage7 taster can only list own taster commission records through me', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const taster = await login(baseUrl, 'stage7-query-taster-a', 'Password123');

    const result = await requestJson(
      baseUrl,
      '/api/commission-records/me?targetUserId=usr-stage7-query-taster-b&limit=20',
      {
        token: taster.token,
      },
    );

    assert.equal(result.response.status, 200);
    assert.deepEqual(recordIds(result.body.data.commissionRecords), [
      'rec-stage7-query-taster-marked',
      'rec-stage7-query-taster-unmarked',
    ]);
    for (const record of result.body.data.commissionRecords) {
      assert.equal(record.targetType, 'taster_commission');
      assert.equal(record.targetUser.id, 'usr-stage7-query-taster-a');
    }

    const blockedSessions = [admin];
    for (const username of [
      'stage7-query-finance',
      'stage7-query-boss',
      'stage7-query-sales',
      'stage7-query-warehouse',
      'stage7-query-after-sales',
      'stage7-query-front-desk',
    ]) {
      blockedSessions.push(await login(baseUrl, username, 'Password123'));
    }
    for (const session of blockedSessions) {
      const denied = await requestJson(baseUrl, '/api/commission-records/me', {
        token: session.token,
      });
      assertErrorContract(denied, 403, 'PERMISSION_DENIED');
    }
  }, {
    prisma: buildCommissionRecordsQueryPrisma(),
  });
});

test('contract: stage7 commission record queries obey global mark filtering', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const boss = await login(baseUrl, 'stage7-query-boss', 'Password123');
    const taster = await login(baseUrl, 'stage7-query-taster-a', 'Password123');

    const openList = await requestJson(
      baseUrl,
      '/api/commission-records?limit=50',
      {
        token: boss.token,
      },
    );
    assert.equal(openList.response.status, 200);
    assert.deepEqual(recordIds(openList.body.data.commissionRecords), [
      'rec-stage7-query-agency',
      'rec-stage7-query-sales',
      'rec-stage7-query-taster-marked',
      'rec-stage7-query-taster-other',
      'rec-stage7-query-taster-unmarked',
      'rec-stage7-query-unmarked-customer',
      'rec-stage7-query-unmarked-group',
    ]);

    for (const recordId of [
      'rec-stage7-query-unmarked-customer',
      'rec-stage7-query-unmarked-group',
    ]) {
      const visible = await requestJson(
        baseUrl,
        `/api/commission-records/${recordId}`,
        {
          token: boss.token,
        },
      );
      assert.equal(visible.response.status, 200);
    }

    const openTasterMe = await requestJson(
      baseUrl,
      '/api/commission-records/me?limit=20',
      {
        token: taster.token,
      },
    );
    assert.equal(openTasterMe.response.status, 200);
    assert.deepEqual(recordIds(openTasterMe.body.data.commissionRecords), [
      'rec-stage7-query-taster-marked',
      'rec-stage7-query-taster-unmarked',
    ]);

    const enabled = await requestJson(
      baseUrl,
      '/api/settings/global-mark-query/enable',
      {
        method: 'POST',
        token: admin.token,
      },
    );
    assert.equal(enabled.response.status, 200);
    assert.equal(enabled.body.data.settings.onlyShowMarkedRecords, true);

    const result = await requestJson(baseUrl, '/api/commission-records?limit=50', {
      token: boss.token,
    });

    assert.equal(result.response.status, 200);
    assert.deepEqual(recordIds(result.body.data.commissionRecords), [
      'rec-stage7-query-agency',
      'rec-stage7-query-sales',
      'rec-stage7-query-taster-marked',
      'rec-stage7-query-taster-other',
      'rec-stage7-query-unmarked-group',
    ]);

    const hidden = await requestJson(
      baseUrl,
      '/api/commission-records/rec-stage7-query-unmarked-customer',
      {
        token: boss.token,
      },
    );
    assertErrorContract(hidden, 404, 'COMMISSION_RECORD_NOT_FOUND');

    const hiddenGroup = await requestJson(
      baseUrl,
      '/api/commission-records/rec-stage7-query-unmarked-group',
      {
        token: boss.token,
      },
    );
    assert.equal(hiddenGroup.response.status, 200);

    const scopedTasterMe = await requestJson(
      baseUrl,
      '/api/commission-records/me?limit=20',
      {
        token: taster.token,
      },
    );
    assert.equal(scopedTasterMe.response.status, 200);
    assert.deepEqual(recordIds(scopedTasterMe.body.data.commissionRecords), [
      'rec-stage7-query-taster-marked',
    ]);
  }, {
    prisma: buildCommissionRecordsQueryPrisma(),
  });
});

async function requestStatus(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  await response.arrayBuffer();
  return response.status;
}

function recordIds(records) {
  return records.map((record) => record.id).sort();
}

function buildCommissionRecordsQueryPrisma() {
  return {
    users: [
      user('usr-stage7-query-finance', 'stage7-query-finance', 'finance'),
      user('usr-stage7-query-boss', 'stage7-query-boss', 'boss'),
      user('usr-stage7-query-sales', 'stage7-query-sales', 'sales'),
      user('usr-stage7-query-warehouse', 'stage7-query-warehouse', 'warehouse'),
      user(
        'usr-stage7-query-after-sales',
        'stage7-query-after-sales',
        'after_sales',
      ),
      user(
        'usr-stage7-query-front-desk',
        'stage7-query-front-desk',
        'front_desk',
      ),
      user('usr-stage7-query-taster-a', 'stage7-query-taster-a', 'taster'),
      user('usr-stage7-query-taster-b', 'stage7-query-taster-b', 'taster'),
    ],
    customers: [
      {
        id: 'cust-stage7-query-marked',
        name: 'Stage7 Query Marked Customer',
        phone: '10000000001',
        financeMark: true,
      },
      {
        id: 'cust-stage7-query-unmarked',
        name: 'Stage7 Query Unmarked Customer',
        phone: '10000000002',
        financeMark: false,
      },
    ],
    travelGroups: [
      {
        id: 'tg-stage7-marked',
        groupNo: 'TG-STAGE7-MARKED',
        visitDate: '2026-07-01',
        travelAgency: 'Stage7 Query Agency',
        tasterId: 'usr-stage7-query-taster-a',
        tasterName: 'Stage7 Query Taster A',
        financeMark: true,
      },
      {
        id: 'tg-stage7-unmarked',
        groupNo: 'TG-STAGE7-UNMARKED',
        visitDate: '2026-07-02',
        travelAgency: 'Stage7 Query Unmarked Agency',
        tasterId: 'usr-stage7-query-taster-a',
        tasterName: 'Stage7 Query Taster A',
        financeMark: false,
      },
      {
        id: 'tg-stage7-other-marked',
        groupNo: 'TG-STAGE7-OTHER-MARKED',
        visitDate: '2026-07-03',
        travelAgency: 'Stage7 Query Other Agency',
        tasterId: 'usr-stage7-query-taster-b',
        tasterName: 'Stage7 Query Taster B',
        financeMark: true,
      },
    ],
    salesOrders: [
      salesOrder({
        id: 'so-stage7-marked',
        orderNo: 'SO-STAGE7-MARKED',
        customerId: 'cust-stage7-query-marked',
        travelGroupId: 'tg-stage7-marked',
        orderDate: '2026-07-01',
        salesUserId: 'usr-stage7-query-sales',
        customerName: 'Stage7 Query Marked Customer',
        financeMark: true,
      }),
      salesOrder({
        id: 'so-stage7-unmarked-customer',
        orderNo: 'SO-STAGE7-UNMARKED-CUSTOMER',
        customerId: 'cust-stage7-query-marked',
        travelGroupId: 'tg-stage7-marked',
        orderDate: '2026-07-01',
        salesUserId: 'usr-stage7-query-sales',
        customerName: 'Stage7 Query Unmarked Customer',
        financeMark: false,
      }),
      salesOrder({
        id: 'so-stage7-unmarked-group',
        orderNo: 'SO-STAGE7-UNMARKED-GROUP',
        customerId: 'cust-stage7-query-marked',
        travelGroupId: 'tg-stage7-unmarked',
        orderDate: '2026-07-02',
        salesUserId: 'usr-stage7-query-sales',
        customerName: 'Stage7 Query Marked Customer',
        financeMark: true,
      }),
    ],
    commissionRecords: [
      commissionRecord({
        id: 'rec-stage7-query-sales',
        salesOrderId: 'so-stage7-marked',
        travelGroupId: 'tg-stage7-marked',
        targetType: 'SALES_COMMISSION',
        targetUserId: 'usr-stage7-query-sales',
        baseAmountCents: 90000,
        amountCents: 1800,
        calculationNote: 'stage7 query sales calculation smoke',
        sourceSnapshot: {
          salesOrder: {
            id: 'so-stage7-marked',
            orderNo: 'SO-STAGE7-MARKED',
            orderDate: '2026-07-01',
            customerPhone: '10000000001',
          },
          travelGroup: {
            id: 'tg-stage7-marked',
            groupNo: 'TG-STAGE7-MARKED',
          },
          unsafeToken: 'secret-token',
          password: 'Password123',
          shippingAddress: 'stage7 hidden address',
        },
      }),
      commissionRecord({
        id: 'rec-stage7-query-agency',
        salesOrderId: 'so-stage7-marked',
        travelGroupId: 'tg-stage7-marked',
        targetType: 'AGENCY_DAILY_REBATE',
        agencyId: 'agency-stage7-query',
        agencyName: 'Stage7 Query Agency',
        baseAmountCents: 90000,
        amountCents: 3000,
        pointsCents: 3000,
        calculationNote: 'stage7 query agency daily rebate smoke',
      }),
      commissionRecord({
        id: 'rec-stage7-query-unmarked-customer',
        salesOrderId: 'so-stage7-unmarked-customer',
        travelGroupId: 'tg-stage7-marked',
        targetType: 'SALES_COMMISSION',
        targetUserId: 'usr-stage7-query-sales',
        calculationNote: 'stage7 query hidden unmarked customer',
      }),
      commissionRecord({
        id: 'rec-stage7-query-unmarked-group',
        salesOrderId: 'so-stage7-unmarked-group',
        travelGroupId: 'tg-stage7-unmarked',
        targetType: 'SALES_COMMISSION',
        targetUserId: 'usr-stage7-query-sales',
        calculationNote: 'stage7 query hidden unmarked group',
      }),
      commissionRecord({
        id: 'rec-stage7-query-taster-marked',
        travelGroupId: 'tg-stage7-marked',
        targetType: 'TASTER_COMMISSION',
        targetUserId: 'usr-stage7-query-taster-a',
        amountCents: 8000,
        manualInput: true,
        calculationNote: 'stage7 query taster marked smoke',
      }),
      commissionRecord({
        id: 'rec-stage7-query-taster-unmarked',
        travelGroupId: 'tg-stage7-unmarked',
        targetType: 'TASTER_COMMISSION',
        targetUserId: 'usr-stage7-query-taster-a',
        amountCents: 7000,
        manualInput: true,
        calculationNote: 'stage7 query taster unmarked smoke',
      }),
      commissionRecord({
        id: 'rec-stage7-query-taster-other',
        travelGroupId: 'tg-stage7-other-marked',
        targetType: 'TASTER_COMMISSION',
        targetUserId: 'usr-stage7-query-taster-b',
        amountCents: 6000,
        manualInput: true,
        calculationNote: 'stage7 query taster other smoke',
      }),
      commissionRecord({
        id: 'rec-stage7-query-orphan',
        targetType: 'SALES_COMMISSION',
        targetUserId: 'usr-stage7-query-sales',
        amountCents: 1,
        calculationNote: 'stage7 query orphan hidden smoke',
      }),
    ],
  };
}

function user(id, username, role) {
  return {
    id,
    username,
    name: `Stage7 Query ${role}`,
    password: 'Password123',
    role,
  };
}

function salesOrder(overrides) {
  return {
    totalAmountCents: 100000,
    status: 'VALID',
    customerPhone: '10000000003',
    ...overrides,
  };
}

function commissionRecord(overrides) {
  return {
    grossAmountCents: 100000,
    confirmedRefundAmountCents: 10000,
    baseAmountCents: 90000,
    deductionAmountCents: 0,
    rateSnapshot: '0.0200',
    amountCents: 0,
    pointsCents: 0,
    manualInput: false,
    isConfirmed: false,
    calculationVersion: 'stage7_v1',
    ruleSnapshot: {
      source: 'stage7 query test rule',
    },
    sourceSnapshot: {
      source: 'stage7 query test source',
    },
    ...overrides,
  };
}
