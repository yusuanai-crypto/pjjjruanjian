const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  createUser,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');
const {
  formatShanghaiBusinessDate,
} = require('../src/modules/business-data/reconciliation-calculation.helper');

const PASSWORD = 'Password123';

test('travel group not-entered endpoint enforces roles, state, idempotency, audit, and todo recalculation', async () => {
  await withPhase1Server(async (baseUrl) => {
    const superAdmin = await login(baseUrl);
    const actors = {};
    for (const role of [
      'admin',
      'boss',
      'front_desk',
      'sales',
      'finance',
      'warehouse',
      'after_sales',
      'taster',
    ]) {
      const user = await createUser(baseUrl, superAdmin.token, {
        name: `Not Entered ${role}`,
        username: `not-entered-${role}`,
        password: PASSWORD,
        role,
      });
      actors[role] = {
        user,
        ...(await login(baseUrl, user.username, PASSWORD)),
      };
    }
    const otherTasterUser = await createUser(baseUrl, superAdmin.token, {
      name: 'Not Entered Other Taster',
      username: 'not-entered-other-taster',
      password: PASSWORD,
      role: 'taster',
    });
    const otherTaster = {
      user: otherTasterUser,
      ...(await login(baseUrl, otherTasterUser.username, PASSWORD)),
    };
    const guide = await createGuide(baseUrl, superAdmin.token);

    const confirmActors = [
      superAdmin,
      actors.admin,
      actors.boss,
      actors.front_desk,
    ];
    const confirmedGroups = [];
    for (const [index, actor] of confirmActors.entries()) {
      const group = await createPendingEntryGroup(
        baseUrl,
        superAdmin.token,
        guide.id,
        { travelAgency: `Confirm Agency ${index}` },
      );
      const confirmed = await setNotEntered(
        baseUrl,
        actor.token,
        group.id,
        true,
      );
      assert.equal(confirmed.response.status, 200);
      assert.equal(confirmed.body.data.travelGroup.entryStatus, 'not_entered');
      assert.equal(
        confirmed.body.data.travelGroup.notEnteredConfirmedById,
        actor.user.id,
      );
      assert.equal(
        confirmed.body.data.travelGroup.notEnteredConfirmedBy.id,
        actor.user.id,
      );
      assert.equal(
        confirmed.body.data.travelGroup.notEnteredConfirmedBy.name,
        actor.user.name,
      );
      assert.equal(
        confirmed.body.data.travelGroup.notEnteredConfirmedBy.username,
        actor.user.username,
      );
      assert.ok(
        Number.isFinite(
          Date.parse(
            confirmed.body.data.travelGroup.notEnteredConfirmedAt,
          ),
        ),
      );
      confirmedGroups.push(group);
    }

    const liaisonGroup = await createPendingEntryGroup(
      baseUrl,
      superAdmin.token,
      guide.id,
      {
        travelAgency: 'Liaison Taster Agency',
        liaisonTasterId: actors.taster.user.id,
      },
    );
    const liaisonConfirmed = await setNotEntered(
      baseUrl,
      actors.taster.token,
      liaisonGroup.id,
      true,
    );
    assert.equal(liaisonConfirmed.response.status, 200);
    assert.equal(
      liaisonConfirmed.body.data.travelGroup.notEnteredConfirmedById,
      actors.taster.user.id,
    );

    const deniedGroup = await createPendingEntryGroup(
      baseUrl,
      superAdmin.token,
      guide.id,
      {
        travelAgency: 'Denied Agency',
        liaisonTasterId: actors.taster.user.id,
      },
    );
    const deniedOtherTaster = await setNotEntered(
      baseUrl,
      otherTaster.token,
      deniedGroup.id,
      true,
    );
    assertErrorContract(
      deniedOtherTaster,
      403,
      'TRAVEL_GROUP_NOT_ENTERED_LIAISON_REQUIRED',
    );
    for (const actor of [
      actors.sales,
      actors.finance,
      actors.warehouse,
      actors.after_sales,
    ]) {
      const denied = await setNotEntered(
        baseUrl,
        actor.token,
        deniedGroup.id,
        true,
      );
      assertErrorContract(denied, 403, 'PERMISSION_DENIED');
    }

    const enteredGroup = await createPendingEntryGroup(
      baseUrl,
      superAdmin.token,
      guide.id,
      {
        travelAgency: 'Already Entered Agency',
        arrivalTime: '09:15',
      },
    );
    const enteredConflict = await setNotEntered(
      baseUrl,
      actors.front_desk.token,
      enteredGroup.id,
      true,
    );
    assertErrorContract(
      enteredConflict,
      409,
      'TRAVEL_GROUP_ALREADY_ENTERED',
    );

    const strictBodyGroup = await createPendingEntryGroup(
      baseUrl,
      superAdmin.token,
      guide.id,
      { travelAgency: 'Strict Body Agency' },
    );
    const strictBody = await requestJson(
      baseUrl,
      `/api/travel-groups/${strictBodyGroup.id}/not-entered`,
      {
        method: 'PATCH',
        token: actors.admin.token,
        body: { confirmed: true, unexpected: true },
      },
    );
    assertErrorContract(strictBody, 400, 'VALIDATION_FAILED');

    const idempotentGroup = confirmedGroups[3];
    const repeated = await setNotEntered(
      baseUrl,
      actors.front_desk.token,
      idempotentGroup.id,
      true,
    );
    assert.equal(repeated.response.status, 200);
    const idempotentLogs = await operationLogs(
      baseUrl,
      superAdmin.token,
      'travel_groups.not_entered.confirm',
      idempotentGroup.id,
    );
    assert.equal(idempotentLogs.length, 1);
    assert.equal(idempotentLogs[0].action, 'travel_groups.not_entered.confirm');
    assert.equal(idempotentLogs[0].beforeData.entryStatus, 'pending_entry');
    assert.equal(idempotentLogs[0].afterData.entryStatus, 'not_entered');
    assert.equal(
      idempotentLogs[0].afterData.notEnteredConfirmedById,
      actors.front_desk.user.id,
    );

    const arrivalConflict = await requestJson(
      baseUrl,
      `/api/travel-groups/${liaisonGroup.id}`,
      {
        method: 'PATCH',
        token: actors.admin.token,
        body: { arrivalTime: '10:30' },
      },
    );
    assertErrorContract(
      arrivalConflict,
      409,
      'TRAVEL_GROUP_NOT_ENTERED_REVOKE_REQUIRED',
    );

    for (const actor of [
      superAdmin,
      actors.admin,
      actors.boss,
      actors.taster,
    ]) {
      const deniedRevoke = await setNotEntered(
        baseUrl,
        actor.token,
        liaisonGroup.id,
        false,
      );
      assertErrorContract(deniedRevoke, 403, 'PERMISSION_DENIED');
    }
    const revoked = await setNotEntered(
      baseUrl,
      actors.front_desk.token,
      liaisonGroup.id,
      false,
    );
    assert.equal(revoked.response.status, 200);
    assert.equal(revoked.body.data.travelGroup.entryStatus, 'pending_entry');
    assert.equal(
      revoked.body.data.travelGroup.notEnteredConfirmedAt,
      null,
    );
    assert.equal(
      revoked.body.data.travelGroup.notEnteredConfirmedById,
      null,
    );
    assert.equal(revoked.body.data.travelGroup.notEnteredConfirmedBy, null);
    const revokeLogs = await operationLogs(
      baseUrl,
      superAdmin.token,
      'travel_groups.not_entered.revoke',
      liaisonGroup.id,
    );
    assert.equal(revokeLogs.length, 1);
    assert.equal(revokeLogs[0].beforeData.entryStatus, 'not_entered');
    assert.equal(revokeLogs[0].afterData.entryStatus, 'pending_entry');

    const todoGroup = await createPendingEntryGroup(
      baseUrl,
      superAdmin.token,
      guide.id,
      { travelAgency: 'Todo Recalculation Agency' },
    );
    assert.ok(
      todoGroup.pendingReasons.includes('missing_arrival_time'),
    );
    const todoConfirmed = await setNotEntered(
      baseUrl,
      actors.front_desk.token,
      todoGroup.id,
      true,
    );
    assert.equal(todoConfirmed.body.data.travelGroup.pendingStatus, null);
    assert.deepEqual(
      todoConfirmed.body.data.travelGroup.pendingReasons,
      [],
    );
    const todoRevoked = await setNotEntered(
      baseUrl,
      actors.front_desk.token,
      todoGroup.id,
      false,
    );
    assert.notEqual(todoRevoked.body.data.travelGroup.pendingStatus, null);
    assert.ok(
      todoRevoked.body.data.travelGroup.pendingReasons.includes(
        'missing_arrival_time',
      ),
    );
  });
});

async function createGuide(baseUrl, token) {
  const result = await requestJson(baseUrl, '/api/guides', {
    method: 'POST',
    token,
    body: {
      name: 'Not Entered Guide',
      phone: '13929000001',
      travelAgency: 'Not Entered Guide Agency',
    },
  });
  assert.equal(result.response.status, 201);
  return result.body.data.guide;
}

async function createPendingEntryGroup(
  baseUrl,
  token,
  guideId,
  overrides = {},
) {
  const result = await requestJson(baseUrl, '/api/travel-groups', {
    method: 'POST',
    token,
    body: {
      visitDate: formatShanghaiBusinessDate(new Date()),
      travelAgency: 'Not Entered Agency',
      guideId,
      guestCount: 8,
      tastingRoomNo: 'A01',
      groupType: '其他',
      ...overrides,
    },
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.body.data.travelGroup.entryStatus,
    overrides.arrivalTime ? 'entered' : 'pending_entry');
  return result.body.data.travelGroup;
}

function setNotEntered(baseUrl, token, groupId, confirmed) {
  return requestJson(
    baseUrl,
    `/api/travel-groups/${groupId}/not-entered`,
    {
      method: 'PATCH',
      token,
      body: { confirmed },
    },
  );
}

async function operationLogs(baseUrl, token, action, entityId) {
  const result = await requestJson(
    baseUrl,
    `/api/operation-logs?action=${encodeURIComponent(action)}&entityId=${encodeURIComponent(entityId)}&pageSize=100`,
    { token },
  );
  assert.equal(result.response.status, 200);
  return result.body.data.logs;
}
