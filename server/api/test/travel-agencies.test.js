const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
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
