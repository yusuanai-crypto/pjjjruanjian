const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  createUser,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

test('contract: guide APIs enforce permissions and persist guide lifecycle', async () => {
  await withPhase1Server(async (baseUrl) => {
    const missingToken = await requestJson(baseUrl, '/api/guides');
    assertErrorContract(missingToken, 401, 'AUTH_TOKEN_REQUIRED');

    const admin = await login(baseUrl);
    await createUser(baseUrl, admin.token, {
      name: 'Guide Front Desk',
      username: 'guide-front-desk',
      password: 'Password123',
      role: 'front_desk',
    });
    await createUser(baseUrl, admin.token, {
      name: 'Guide Sales',
      username: 'guide-sales',
      password: 'Password123',
      role: 'sales',
    });
    await createUser(baseUrl, admin.token, {
      name: 'Guide Finance',
      username: 'guide-finance',
      password: 'Password123',
      role: 'finance',
    });
    await createUser(baseUrl, admin.token, {
      name: 'Guide Boss',
      username: 'guide-boss',
      password: 'Password123',
      role: 'boss',
    });

    const frontDesk = await login(baseUrl, 'guide-front-desk', 'Password123');
    const sales = await login(baseUrl, 'guide-sales', 'Password123');
    const finance = await login(baseUrl, 'guide-finance', 'Password123');
    const boss = await login(baseUrl, 'guide-boss', 'Password123');

    const bossList = await requestJson(baseUrl, '/api/guides', {
      token: boss.token,
    });
    assertErrorContract(bossList, 403, 'PERMISSION_DENIED');

    const created = await requestJson(baseUrl, '/api/guides', {
      method: 'POST',
      token: admin.token,
      body: {
        name: '测试导游',
        phone: '13800001234',
        travelAgency: '测试旅行社',
        remarks: '初始备注',
      },
    });
    assert.equal(created.response.status, 201);
    assertGuideContract(created.body.data.guide);
    assert.equal(created.body.data.guide.name, '测试导游');
    assert.equal(created.body.data.guide.isActive, true);

    const duplicate = await requestJson(baseUrl, '/api/guides', {
      method: 'POST',
      token: admin.token,
      body: {
        name: '重复导游',
        phone: '13800001234',
        travelAgency: '重复旅行社',
      },
    });
    assertErrorContract(duplicate, 409, 'GUIDE_PHONE_EXISTS');

    const second = await requestJson(baseUrl, '/api/guides', {
      method: 'POST',
      token: frontDesk.token,
      body: {
        name: '备用导游',
        phone: '13800005678',
        travelAgency: '备用旅行社',
      },
    });
    assert.equal(second.response.status, 201);

    const salesList = await requestJson(baseUrl, '/api/guides?keyword=测试', {
      token: sales.token,
    });
    assert.equal(salesList.response.status, 200);
    assert.deepEqual(guidePhones(salesList.body.data.guides), ['13800001234']);

    const financeDetail = await requestJson(
      baseUrl,
      `/api/guides/${created.body.data.guide.id}`,
      {
        token: finance.token,
      },
    );
    assert.equal(financeDetail.response.status, 200);
    assert.equal(financeDetail.body.data.guide.phone, '13800001234');

    const salesCreate = await requestJson(baseUrl, '/api/guides', {
      method: 'POST',
      token: sales.token,
      body: {
        name: '销售不可建',
        phone: '13800009999',
        travelAgency: '销售旅行社',
      },
    });
    assertErrorContract(salesCreate, 403, 'PERMISSION_DENIED');

    const updated = await requestJson(
      baseUrl,
      `/api/guides/${created.body.data.guide.id}`,
      {
        method: 'PATCH',
        token: frontDesk.token,
        body: {
          name: '更新导游',
          phone: '13800002222',
          travelAgency: '更新旅行社',
          remarks: '更新备注',
        },
      },
    );
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.data.guide.name, '更新导游');
    assert.equal(updated.body.data.guide.phone, '13800002222');
    assert.equal(updated.body.data.guide.travelAgency, '更新旅行社');

    const duplicatePatch = await requestJson(
      baseUrl,
      `/api/guides/${created.body.data.guide.id}`,
      {
        method: 'PATCH',
        token: frontDesk.token,
        body: {
          phone: second.body.data.guide.phone,
        },
      },
    );
    assertErrorContract(duplicatePatch, 409, 'GUIDE_PHONE_EXISTS');

    const salesPatch = await requestJson(
      baseUrl,
      `/api/guides/${created.body.data.guide.id}`,
      {
        method: 'PATCH',
        token: sales.token,
        body: {
          remarks: '销售不可改',
        },
      },
    );
    assertErrorContract(salesPatch, 403, 'PERMISSION_DENIED');

    const frontDeskDisable = await requestJson(
      baseUrl,
      `/api/guides/${created.body.data.guide.id}/disable`,
      {
        method: 'POST',
        token: frontDesk.token,
      },
    );
    assertErrorContract(frontDeskDisable, 403, 'PERMISSION_DENIED');

    const disabled = await requestJson(
      baseUrl,
      `/api/guides/${created.body.data.guide.id}/disable`,
      {
        method: 'POST',
        token: admin.token,
      },
    );
    assert.equal(disabled.response.status, 200);
    assert.equal(disabled.body.data.guide.isActive, false);

    const inactiveList = await requestJson(
      baseUrl,
      '/api/guides?isActive=false',
      {
        token: admin.token,
      },
    );
    assert.equal(inactiveList.response.status, 200);
    assert.deepEqual(guidePhones(inactiveList.body.data.guides), [
      '13800002222',
    ]);

    const activeList = await requestJson(baseUrl, '/api/guides?isActive=true', {
      token: admin.token,
    });
    assert.equal(activeList.response.status, 200);
    assert.deepEqual(guidePhones(activeList.body.data.guides), ['13800005678']);

    const agencyList = await requestJson(
      baseUrl,
      '/api/guides?travelAgency=更新旅行社',
      {
        token: admin.token,
      },
    );
    assert.equal(agencyList.response.status, 200);
    assert.deepEqual(guidePhones(agencyList.body.data.guides), ['13800002222']);

    const optionalAgencyGuide = await requestJson(baseUrl, '/api/guides', {
      method: 'POST',
      token: frontDesk.token,
      body: {
        name: '无旅行社导游',
        phone: '13800006666',
      },
    });
    assert.equal(optionalAgencyGuide.response.status, 201);
    assert.equal(optionalAgencyGuide.body.data.guide.travelAgency, null);

    const enabled = await requestJson(
      baseUrl,
      `/api/guides/${created.body.data.guide.id}/enable`,
      {
        method: 'POST',
        token: admin.token,
      },
    );
    assert.equal(enabled.response.status, 200);
    assert.equal(enabled.body.data.guide.isActive, true);

    const missingGuide = await requestJson(
      baseUrl,
      '/api/guides/missing-guide-id',
      {
        token: admin.token,
      },
    );
    assertErrorContract(missingGuide, 404, 'GUIDE_NOT_FOUND');

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?entityType=guide',
      {
        token: admin.token,
      },
    );
    assert.equal(logs.response.status, 200);
    const actions = logs.body.data.logs.map((log) => log.action).sort();
    assert.deepEqual(actions, [
      'guides.create',
      'guides.create',
      'guides.create',
      'guides.disable',
      'guides.enable',
      'guides.update',
    ]);
  });
});

function assertGuideContract(guide) {
  assert.deepEqual(Object.keys(guide).sort(), [
    'createdAt',
    'id',
    'isActive',
    'name',
    'phone',
    'remarks',
    'travelAgency',
    'updatedAt',
  ]);
  assert.equal(typeof guide.id, 'string');
  assert.equal(typeof guide.name, 'string');
  assert.equal(typeof guide.phone, 'string');
  assert.ok(
    typeof guide.travelAgency === 'string' || guide.travelAgency === null,
  );
  assert.equal(typeof guide.isActive, 'boolean');
  assert.equal(typeof guide.createdAt, 'string');
  assert.equal(typeof guide.updatedAt, 'string');
}

function guidePhones(guides) {
  return guides.map((guide) => guide.phone).sort();
}
