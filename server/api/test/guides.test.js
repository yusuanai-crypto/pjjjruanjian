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
    await createUser(baseUrl, admin.token, {
      name: 'Guide Taster',
      username: 'guide-taster',
      password: 'Password123',
      role: 'taster',
    });
    await createUser(baseUrl, admin.token, {
      name: 'Guide Warehouse',
      username: 'guide-warehouse',
      password: 'Password123',
      role: 'warehouse',
    });
    await createUser(baseUrl, admin.token, {
      name: 'Guide After Sales',
      username: 'guide-after-sales',
      password: 'Password123',
      role: 'after_sales',
    });

    const frontDesk = await login(baseUrl, 'guide-front-desk', 'Password123');
    const sales = await login(baseUrl, 'guide-sales', 'Password123');
    const finance = await login(baseUrl, 'guide-finance', 'Password123');
    const boss = await login(baseUrl, 'guide-boss', 'Password123');
    const taster = await login(baseUrl, 'guide-taster', 'Password123');
    const warehouse = await login(baseUrl, 'guide-warehouse', 'Password123');
    const afterSales = await login(
      baseUrl,
      'guide-after-sales',
      'Password123',
    );

    const created = await requestJson(baseUrl, '/api/guides', {
      method: 'POST',
      token: admin.token,
      body: {
        name: '测试导游',
        phone: '13800001234',
        remarks: '初始备注',
      },
    });
    assert.equal(created.response.status, 201);
    assertGuideContract(created.body.data.guide);
    assert.equal(created.body.data.guide.name, '测试导游');
    assert.equal(created.body.data.guide.isActive, true);

    const guideReadOnlySessions = [
      { role: 'boss', session: boss },
      { role: 'taster', session: taster },
      { role: 'warehouse', session: warehouse },
      { role: 'after_sales', session: afterSales },
    ];

    for (const { session } of guideReadOnlySessions) {
      const list = await requestJson(baseUrl, '/api/guides', {
        token: session.token,
      });
      assert.equal(list.response.status, 200);
      assert.deepEqual(guidePhones(list.body.data.guides), ['13800001234']);

      const detail = await requestJson(
        baseUrl,
        `/api/guides/${created.body.data.guide.id}`,
        {
          token: session.token,
        },
      );
      assert.equal(detail.response.status, 200);
      assert.equal(detail.body.data.guide.phone, '13800001234');
    }

    const duplicate = await requestJson(baseUrl, '/api/guides', {
      method: 'POST',
      token: admin.token,
      body: {
        name: '重复导游',
        phone: '13800001234',
      },
    });
    assertErrorContract(duplicate, 409, 'GUIDE_PHONE_EXISTS');

    const second = await requestJson(baseUrl, '/api/guides', {
      method: 'POST',
      token: frontDesk.token,
      body: {
        name: '备用导游',
        phone: '13800005678',
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
      },
    });
    assertErrorContract(salesCreate, 403, 'PERMISSION_DENIED');

    for (const [index, { role, session }] of guideReadOnlySessions.entries()) {
      const readOnlyCreate = await requestJson(baseUrl, '/api/guides', {
        method: 'POST',
        token: session.token,
        body: {
          name: `Blocked ${role} Guide`,
          phone: `1380000888${index}`,
        },
      });
      assertErrorContract(readOnlyCreate, 403, 'PERMISSION_DENIED');
    }

    const updated = await requestJson(
      baseUrl,
      `/api/guides/${created.body.data.guide.id}`,
      {
        method: 'PATCH',
        token: frontDesk.token,
        body: {
          name: '更新导游',
          phone: '13800002222',
          remarks: '更新备注',
        },
      },
    );
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.data.guide.name, '更新导游');
    assert.equal(updated.body.data.guide.phone, '13800002222');
    assert.equal(
      Object.hasOwn(updated.body.data.guide, 'travelAgency'),
      false,
    );

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

    for (const { role, session } of guideReadOnlySessions) {
      const readOnlyPatch = await requestJson(
        baseUrl,
        `/api/guides/${created.body.data.guide.id}`,
        {
          method: 'PATCH',
          token: session.token,
          body: {
            remarks: `Blocked ${role} update`,
          },
        },
      );
      assertErrorContract(readOnlyPatch, 403, 'PERMISSION_DENIED');

      const readOnlyDisable = await requestJson(
        baseUrl,
        `/api/guides/${created.body.data.guide.id}/disable`,
        {
          method: 'POST',
          token: session.token,
        },
      );
      assertErrorContract(readOnlyDisable, 403, 'PERMISSION_DENIED');

      const readOnlyEnable = await requestJson(
        baseUrl,
        `/api/guides/${created.body.data.guide.id}/enable`,
        {
          method: 'POST',
          token: session.token,
        },
      );
      assertErrorContract(readOnlyEnable, 403, 'PERMISSION_DENIED');
    }

    const frontDeskDisable = await requestJson(
      baseUrl,
      `/api/guides/${created.body.data.guide.id}/disable`,
      {
        method: 'POST',
        token: frontDesk.token,
      },
    );
    assert.equal(frontDeskDisable.response.status, 200);
    assert.equal(frontDeskDisable.body.data.guide.isActive, false);

    const frontDeskEnable = await requestJson(
      baseUrl,
      `/api/guides/${created.body.data.guide.id}/enable`,
      {
        method: 'POST',
        token: frontDesk.token,
      },
    );
    assert.equal(frontDeskEnable.response.status, 200);
    assert.equal(frontDeskEnable.body.data.guide.isActive, true);

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

    const duplicateDisabled = await requestJson(baseUrl, '/api/guides', {
      method: 'POST',
      token: frontDesk.token,
      body: {
        name: '不能重复创建已停用导游',
        phone: '13800002222',
      },
    });
    assertErrorContract(duplicateDisabled, 409, 'GUIDE_DISABLED');

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

    const remarksList = await requestJson(
      baseUrl,
      '/api/guides?keyword=更新备注',
      {
        token: admin.token,
      },
    );
    assert.equal(remarksList.response.status, 200);
    assert.deepEqual(guidePhones(remarksList.body.data.guides), ['13800002222']);

    const optionalAgencyGuide = await requestJson(baseUrl, '/api/guides', {
      method: 'POST',
      token: frontDesk.token,
      body: {
        name: '无旅行社导游',
        phone: '13800006666',
      },
    });
    assert.equal(optionalAgencyGuide.response.status, 201);
    assert.equal(
      Object.hasOwn(optionalAgencyGuide.body.data.guide, 'travelAgency'),
      false,
    );

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
    const writeActions = new Set([
      'guides.create',
      'guides.disable',
      'guides.enable',
      'guides.update',
    ]);
    const actions = logs.body.data.logs
      .filter(
        (log) => log.result === 'SUCCESS' && writeActions.has(log.action),
      )
      .map((log) => log.action)
      .sort();
    assert.deepEqual(actions, [
      'guides.create',
      'guides.create',
      'guides.create',
      'guides.disable',
      'guides.disable',
      'guides.enable',
      'guides.enable',
      'guides.update',
    ]);
    assert.equal(
      logs.body.data.logs.some(
        (log) => log.action === 'guides.list' && log.result === 'SUCCESS',
      ),
      true,
    );
    assert.equal(
      logs.body.data.logs.some((log) => log.result === 'FAILURE'),
      true,
    );
  });
});

test('contract: guide list supports pagination, filters, stable order, and legacy limit', async () => {
  await withPhase1Server(async (baseUrl, { prisma }) => {
    const admin = await login(baseUrl);
    const fixedTime = new Date('2026-07-25T08:00:00.000Z');
    for (let index = 1; index <= 205; index += 1) {
      const suffix = String(index).padStart(4, '0');
      prisma.__store.guides.push({
        id: `guide-${suffix}`,
        name: index === 201 ? '远程搜索目标导游' : `导游 ${suffix}`,
        phone: `139${String(index).padStart(8, '0')}`,
        remarks: index === 201 ? '第201名以后仍可搜索' : `备注 ${suffix}`,
        isActive: index % 3 !== 0,
        createdAt: fixedTime,
        updatedAt: fixedTime,
      });
    }

    const defaultPage = await requestJson(baseUrl, '/api/guides', {
      token: admin.token,
    });
    assert.equal(defaultPage.response.status, 200);
    assert.equal(defaultPage.body.data.guides.length, 20);
    assert.deepEqual(defaultPage.body.data.pagination, {
      page: 1,
      pageSize: 20,
      total: 205,
      totalPages: 11,
    });
    assert.equal(defaultPage.body.data.guides[0].id, 'guide-0205');

    const secondPage = await requestJson(
      baseUrl,
      '/api/guides?page=2&pageSize=50',
      { token: admin.token },
    );
    assert.equal(secondPage.response.status, 200);
    assert.equal(secondPage.body.data.guides.length, 50);
    assert.deepEqual(secondPage.body.data.pagination, {
      page: 2,
      pageSize: 50,
      total: 205,
      totalPages: 5,
    });
    const repeatedSecondPage = await requestJson(
      baseUrl,
      '/api/guides?page=2&pageSize=50',
      { token: admin.token },
    );
    assert.deepEqual(
      repeatedSecondPage.body.data.guides.map((guide) => guide.id),
      secondPage.body.data.guides.map((guide) => guide.id),
    );

    const cappedPage = await requestJson(
      baseUrl,
      '/api/guides?page=1&pageSize=500',
      { token: admin.token },
    );
    assert.equal(cappedPage.body.data.guides.length, 100);
    assert.equal(cappedPage.body.data.pagination.pageSize, 100);
    assert.equal(cappedPage.body.data.pagination.totalPages, 3);

    const keywordPage = await requestJson(
      baseUrl,
      `/api/guides?keyword=${encodeURIComponent('第201名以后')}`,
      { token: admin.token },
    );
    assert.equal(keywordPage.body.data.guides.length, 1);
    assert.equal(keywordPage.body.data.guides[0].id, 'guide-0201');
    assert.equal(
      Object.hasOwn(keywordPage.body.data.guides[0], 'travelAgency'),
      false,
    );

    const inactivePage = await requestJson(
      baseUrl,
      '/api/guides?pageSize=100&isActive=false',
      { token: admin.token },
    );
    assert.equal(inactivePage.body.data.pagination.total, 68);
    assert.equal(
      inactivePage.body.data.guides.every((guide) => !guide.isActive),
      true,
    );

    const legacyLimit = await requestJson(baseUrl, '/api/guides?limit=200', {
      token: admin.token,
    });
    assert.equal(legacyLimit.response.status, 200);
    assert.equal(legacyLimit.body.data.guides.length, 200);
    assert.deepEqual(legacyLimit.body.data.pagination, {
      page: 1,
      pageSize: 200,
      total: 205,
      totalPages: 2,
    });

    const invalidPage = await requestJson(baseUrl, '/api/guides?page=0', {
      token: admin.token,
    });
    assertErrorContract(invalidPage, 400, 'VALIDATION_FAILED');
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
    'updatedAt',
  ]);
  assert.equal(typeof guide.id, 'string');
  assert.equal(typeof guide.name, 'string');
  assert.equal(typeof guide.phone, 'string');
  assert.equal(typeof guide.isActive, 'boolean');
  assert.equal(typeof guide.createdAt, 'string');
  assert.equal(typeof guide.updatedAt, 'string');
}

function guidePhones(guides) {
  return guides.map((guide) => guide.phone).sort();
}
