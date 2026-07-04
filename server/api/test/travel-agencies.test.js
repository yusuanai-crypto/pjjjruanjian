const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  assertOperationLogContract,
  createUser,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

test('contract: travel agency APIs support lookup and front desk creation', async () => {
  await withPhase1Server(async (baseUrl) => {
    const missingToken = await requestJson(baseUrl, '/api/travel-agencies');
    assertErrorContract(missingToken, 401, 'AUTH_TOKEN_REQUIRED');

    const admin = await login(baseUrl);
    await createUser(baseUrl, admin.token, {
      name: 'Agency Front Desk',
      username: 'agency-front-desk',
      password: 'Password123',
      role: 'front_desk',
    });
    await createUser(baseUrl, admin.token, {
      name: 'Agency Sales',
      username: 'agency-sales',
      password: 'Password123',
      role: 'sales',
    });
    await createUser(baseUrl, admin.token, {
      name: 'Agency Boss',
      username: 'agency-boss',
      password: 'Password123',
      role: 'boss',
    });

    const frontDesk = await login(baseUrl, 'agency-front-desk', 'Password123');
    const sales = await login(baseUrl, 'agency-sales', 'Password123');
    const boss = await login(baseUrl, 'agency-boss', 'Password123');

    const bossList = await requestJson(baseUrl, '/api/travel-agencies', {
      token: boss.token,
    });
    assertErrorContract(bossList, 403, 'PERMISSION_DENIED');

    const created = await requestJson(baseUrl, '/api/travel-agencies', {
      method: 'POST',
      token: admin.token,
      body: {
        name: '测试旅行社表',
        contactName: '测试联系人',
        contactPhone: '13800007777',
        notes: '用于旅行社表合同测试',
      },
    });
    assert.equal(created.response.status, 201);
    assertTravelAgencyContract(created.body.data.travelAgency);
    assert.equal(created.body.data.travelAgency.name, '测试旅行社表');

    const duplicate = await requestJson(baseUrl, '/api/travel-agencies', {
      method: 'POST',
      token: admin.token,
      body: {
        name: '测试旅行社表',
      },
    });
    assertErrorContract(duplicate, 409, 'TRAVEL_AGENCY_NAME_EXISTS');

    const frontDeskCreated = await requestJson(
      baseUrl,
      '/api/travel-agencies',
      {
        method: 'POST',
        token: frontDesk.token,
        body: {
          name: '前台新建旅行社表',
        },
      },
    );
    assert.equal(frontDeskCreated.response.status, 201);

    const salesList = await requestJson(
      baseUrl,
      '/api/travel-agencies?keyword=测试旅行社表',
      {
        token: sales.token,
      },
    );
    assert.equal(salesList.response.status, 200);
    assert.deepEqual(
      salesList.body.data.travelAgencies.map((agency) => agency.name),
      ['测试旅行社表'],
    );

    const salesCreate = await requestJson(baseUrl, '/api/travel-agencies', {
      method: 'POST',
      token: sales.token,
      body: {
        name: '销售不可建旅行社',
      },
    });
    assertErrorContract(salesCreate, 403, 'PERMISSION_DENIED');
  });
});

test('contract: travel agency PATCH updates base fields and writes operation logs', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    await createUser(baseUrl, admin.token, {
      name: 'Agency Finance',
      username: 'agency-finance',
      password: 'Password123',
      role: 'finance',
    });
    const finance = await login(baseUrl, 'agency-finance', 'Password123');

    const created = await requestJson(baseUrl, '/api/travel-agencies', {
      method: 'POST',
      token: admin.token,
      body: {
        name: '可编辑旅行社',
        contactName: '原联系人',
        contactPhone: '13800001111',
        notes: '更新前备注',
      },
    });
    assert.equal(created.response.status, 201);
    const agency = created.body.data.travelAgency;
    assertTravelAgencyContract(agency);

    const updated = await requestJson(
      baseUrl,
      `/api/travel-agencies/${agency.id}`,
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          name: '更新后旅行社',
          contactName: '财务联系人',
          contactPhone: '13800002222',
          notes: null,
        },
      },
    );
    assert.equal(updated.response.status, 200);
    assertTravelAgencyContract(updated.body.data.travelAgency);
    assert.equal(updated.body.data.travelAgency.id, agency.id);
    assert.equal(updated.body.data.travelAgency.name, '更新后旅行社');
    assert.equal(updated.body.data.travelAgency.contactName, '财务联系人');
    assert.equal(updated.body.data.travelAgency.contactPhone, '13800002222');
    assert.equal(updated.body.data.travelAgency.notes, null);

    const filtered = await requestJson(
      baseUrl,
      '/api/travel-agencies?keyword=更新后旅行社',
      {
        token: finance.token,
      },
    );
    assert.equal(filtered.response.status, 200);
    assert.deepEqual(
      filtered.body.data.travelAgencies.map((item) => item.id),
      [agency.id],
    );

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?entityType=travel_agency',
      {
        token: admin.token,
      },
    );
    assert.equal(logs.response.status, 200);
    const createLog = logs.body.data.logs.find(
      (item) =>
        item.action === 'travel_agencies.create' &&
        item.entityId === agency.id,
    );
    const updateLog = logs.body.data.logs.find(
      (item) =>
        item.action === 'travel_agencies.update' &&
        item.entityId === agency.id,
    );
    assert.ok(createLog);
    assert.ok(updateLog);
    assertOperationLogContract(createLog);
    assertOperationLogContract(updateLog);
    assert.equal(createLog.afterData.name, '可编辑旅行社');
    assert.equal(updateLog.beforeData.name, '可编辑旅行社');
    assert.equal(updateLog.beforeData.contactName, '原联系人');
    assert.equal(updateLog.afterData.name, '更新后旅行社');
    assert.equal(updateLog.afterData.contactName, '财务联系人');
    assert.equal(updateLog.afterData.notes, null);
  });
});

test('contract: travel agency PATCH validates roles and payload', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    await createUser(baseUrl, admin.token, {
      name: 'Agency Patch Finance',
      username: 'agency-patch-finance',
      password: 'Password123',
      role: 'finance',
    });
    await createUser(baseUrl, admin.token, {
      name: 'Agency Patch Front Desk',
      username: 'agency-patch-front-desk',
      password: 'Password123',
      role: 'front_desk',
    });
    await createUser(baseUrl, admin.token, {
      name: 'Agency Patch Sales',
      username: 'agency-patch-sales',
      password: 'Password123',
      role: 'sales',
    });
    await createUser(baseUrl, admin.token, {
      name: 'Agency Patch Boss',
      username: 'agency-patch-boss',
      password: 'Password123',
      role: 'boss',
    });
    const finance = await login(
      baseUrl,
      'agency-patch-finance',
      'Password123',
    );
    const frontDesk = await login(
      baseUrl,
      'agency-patch-front-desk',
      'Password123',
    );
    const sales = await login(baseUrl, 'agency-patch-sales', 'Password123');
    const boss = await login(baseUrl, 'agency-patch-boss', 'Password123');

    const created = await requestJson(baseUrl, '/api/travel-agencies', {
      method: 'POST',
      token: admin.token,
      body: {
        name: '权限校验旅行社',
      },
    });
    assert.equal(created.response.status, 201);
    const agencyId = created.body.data.travelAgency.id;

    const duplicateSource = await requestJson(baseUrl, '/api/travel-agencies', {
      method: 'POST',
      token: admin.token,
      body: {
        name: '重复名称旅行社',
      },
    });
    assert.equal(duplicateSource.response.status, 201);

    const financePatch = await requestJson(
      baseUrl,
      `/api/travel-agencies/${agencyId}`,
      {
        method: 'PATCH',
        token: finance.token,
        body: {
          notes: '财务允许编辑基础信息',
        },
      },
    );
    assert.equal(financePatch.response.status, 200);
    assert.equal(
      financePatch.body.data.travelAgency.notes,
      '财务允许编辑基础信息',
    );

    const missingToken = await requestJson(
      baseUrl,
      `/api/travel-agencies/${agencyId}`,
      {
        method: 'PATCH',
        body: {
          notes: '无 token 不可编辑',
        },
      },
    );
    assertErrorContract(missingToken, 401, 'AUTH_TOKEN_REQUIRED');

    for (const token of [frontDesk.token, sales.token, boss.token]) {
      const denied = await requestJson(
        baseUrl,
        `/api/travel-agencies/${agencyId}`,
        {
          method: 'PATCH',
          token,
          body: {
            notes: '无权限编辑',
          },
        },
      );
      assertErrorContract(denied, 403, 'PERMISSION_DENIED');
    }

    const duplicateName = await requestJson(
      baseUrl,
      `/api/travel-agencies/${agencyId}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          name: '重复名称旅行社',
        },
      },
    );
    assertErrorContract(duplicateName, 409, 'TRAVEL_AGENCY_NAME_EXISTS');

    const blankName = await requestJson(
      baseUrl,
      `/api/travel-agencies/${agencyId}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          name: '   ',
        },
      },
    );
    assertErrorContract(blankName, 400, 'VALIDATION_FAILED');

    const longName = await requestJson(
      baseUrl,
      `/api/travel-agencies/${agencyId}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          name: '超'.repeat(121),
        },
      },
    );
    assertErrorContract(longName, 400, 'VALIDATION_FAILED');

    const longContactName = await requestJson(
      baseUrl,
      `/api/travel-agencies/${agencyId}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          contactName: 'A'.repeat(81),
        },
      },
    );
    assertErrorContract(longContactName, 400, 'VALIDATION_FAILED');

    const unsupportedField = await requestJson(
      baseUrl,
      `/api/travel-agencies/${agencyId}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          isActive: false,
        },
      },
    );
    assertErrorContract(unsupportedField, 400, 'VALIDATION_FAILED');
  });
});

function assertTravelAgencyContract(agency) {
  assert.deepEqual(Object.keys(agency).sort(), [
    'contactName',
    'contactPhone',
    'createdAt',
    'id',
    'name',
    'notes',
    'updatedAt',
  ]);
  assert.equal(typeof agency.id, 'string');
  assert.equal(typeof agency.name, 'string');
  assert.equal(typeof agency.createdAt, 'string');
  assert.equal(typeof agency.updatedAt, 'string');
}
