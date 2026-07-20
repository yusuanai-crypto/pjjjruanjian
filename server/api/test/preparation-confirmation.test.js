const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createApp } = require('../src/app');
const { hashPassword } = require('../src/modules/auth/password');
const {
  TEST_AUTH_TOKEN_SECRET,
  assertErrorContract,
  login,
  requestJson,
  withNestApiServer,
} = require('./helpers/phase1-api');
const {
  createPreparationConfirmationRepository,
} = require('../src/modules/preparation-confirmation/preparation-confirmation.repository');
const {
  createPreparationConfirmationService,
} = require('../src/modules/preparation-confirmation/preparation-confirmation.service');

const TEST_PASSWORD = 'test-only-preparation-password';

function createTestService() {
  const storePath = path.join(
    os.tmpdir(),
    `jiangjiu-phase0-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
  const repository = createPreparationConfirmationRepository(storePath);
  return createPreparationConfirmationService(repository);
}

test('lists all default phase 0 confirmation items', () => {
  const service = createTestService();
  const items = service.listItems();

  assert.equal(items.length, 11);
  assert.equal(items[0].id, 'roles-permissions');
  assert.equal(items.every((item) => item.status === 'pending'), true);
});

test('updates an item to confirmed and includes it in summary progress', () => {
  const service = createTestService();
  const item = service.updateItem('roles-permissions', {
    status: 'confirmed',
    owner: 'project-owner',
    confirmedBy: 'admin',
    notes: 'Role table checked with PRD.',
    evidenceLinks: ['docs/01_PRD.md'],
  });

  assert.equal(item.status, 'confirmed');
  assert.equal(item.confirmedBy, 'admin');
  assert.equal(item.evidenceLinks[0], 'docs/01_PRD.md');

  const summary = service.getSummary();
  assert.equal(summary.confirmed, 1);
  assert.equal(summary.progressPercent, 9);
  assert.equal(summary.readyForNextStage, false);
});

test('rejects unknown confirmation item ids', () => {
  const service = createTestService();

  assert.throws(
    () => service.updateItem('missing-item', { status: 'confirmed', confirmedBy: 'admin' }),
    /does not exist/,
  );
});

test('reports blocked items in summary', () => {
  const service = createTestService();
  service.updateItem('infrastructure-accounts', {
    status: 'blocked',
    owner: 'operations',
    notes: 'Waiting for Apple developer account.',
  });

  const summary = service.getSummary();
  assert.equal(summary.blocked, 1);
  assert.equal(summary.blockers[0].id, 'infrastructure-accounts');
});

test('Nest preparation confirmation endpoints require authentication', async () => {
  await withPreparationNestServer(async (baseUrl) => {
    for (const path of [
      '/api/preparation-confirmation/items',
      '/api/preparation-confirmation/summary',
    ]) {
      const result = await requestJson(baseUrl, path);
      assertErrorContract(result, 401, 'AUTH_TOKEN_REQUIRED');
    }

    const update = await requestJson(
      baseUrl,
      '/api/preparation-confirmation/items/order-fields',
      {
        method: 'PUT',
        body: {
          status: 'in_review',
        },
      },
    );
    assertErrorContract(update, 401, 'AUTH_TOKEN_REQUIRED');
  });
});

test('Nest preparation confirmation endpoints reject ordinary employees', async () => {
  await withPreparationNestServer(async (baseUrl) => {
    const employee = await login(
      baseUrl,
      'preparation-sales',
      TEST_PASSWORD,
    );

    for (const path of [
      '/api/preparation-confirmation/items',
      '/api/preparation-confirmation/summary',
    ]) {
      const result = await requestJson(baseUrl, path, {
        token: employee.token,
      });
      assertErrorContract(result, 403, 'ADMIN_REQUIRED');
    }

    const update = await requestJson(
      baseUrl,
      '/api/preparation-confirmation/items/order-fields',
      {
        method: 'PUT',
        token: employee.token,
        body: {
          status: 'in_review',
        },
      },
    );
    assertErrorContract(update, 403, 'ADMIN_REQUIRED');
  });
});

test('Nest admin and super admin can read and update preparation confirmation', async () => {
  await withPreparationNestServer(async (baseUrl) => {
    const superAdmin = await login(baseUrl);
    const admin = await login(
      baseUrl,
      'preparation-admin',
      TEST_PASSWORD,
    );

    const superAdminList = await requestJson(
      baseUrl,
      '/api/preparation-confirmation/items',
      {
        token: superAdmin.token,
      },
    );
    assert.equal(superAdminList.response.status, 200);
    assert.equal(superAdminList.body.data.items.length, 11);

    const superAdminUpdate = await requestJson(
      baseUrl,
      '/api/preparation-confirmation/items/order-fields',
      {
        method: 'PUT',
        token: superAdmin.token,
        body: {
          status: 'in_review',
          owner: 'finance',
          notes: 'Checking order amount and logistics fields.',
        },
      },
    );
    assert.equal(superAdminUpdate.response.status, 200);
    assert.equal(superAdminUpdate.body.data.item.status, 'in_review');

    const adminUpdate = await requestJson(
      baseUrl,
      '/api/preparation-confirmation/items/roles-permissions',
      {
        method: 'PUT',
        token: admin.token,
        body: {
          status: 'blocked',
          owner: 'operations',
        },
      },
    );
    assert.equal(adminUpdate.response.status, 200);
    assert.equal(adminUpdate.body.data.item.status, 'blocked');

    const adminSummary = await requestJson(
      baseUrl,
      '/api/preparation-confirmation/summary',
      {
        token: admin.token,
      },
    );
    assert.equal(adminSummary.response.status, 200);
    assert.equal(adminSummary.body.data.inReview, 1);
    assert.equal(adminSummary.body.data.blocked, 1);
  });
});

test('authenticated preparation updates keep stable item and status validation', async () => {
  await withPreparationNestServer(async (baseUrl) => {
    const admin = await login(
      baseUrl,
      'preparation-admin',
      TEST_PASSWORD,
    );

    const invalidItem = await requestJson(
      baseUrl,
      '/api/preparation-confirmation/items/missing-item',
      {
        method: 'PUT',
        token: admin.token,
        body: {
          status: 'in_review',
        },
      },
    );
    assertErrorContract(invalidItem, 404, 'ITEM_NOT_FOUND');

    const invalidStatus = await requestJson(
      baseUrl,
      '/api/preparation-confirmation/items/order-fields',
      {
        method: 'PUT',
        token: admin.token,
        body: {
          status: 'not-a-status',
        },
      },
    );
    assertErrorContract(invalidStatus, 400, 'INVALID_STATUS');
  });
});

test('legacy preparation confirmation routes cannot bypass authentication', async () => {
  await withLegacyApiServer(async (baseUrl) => {
    const missingGet = await requestJson(
      baseUrl,
      '/api/preparation-confirmation/items',
    );
    assertErrorContract(missingGet, 401, 'AUTH_TOKEN_REQUIRED');

    const missingPut = await requestJson(
      baseUrl,
      '/api/preparation-confirmation/items/order-fields',
      {
        method: 'PUT',
        body: {
          status: 'not-a-status',
        },
      },
    );
    assertErrorContract(missingPut, 401, 'AUTH_TOKEN_REQUIRED');

    const employee = await login(
      baseUrl,
      'legacy-preparation-sales',
      TEST_PASSWORD,
    );
    const deniedGet = await requestJson(
      baseUrl,
      '/api/preparation-confirmation/summary',
      {
        token: employee.token,
      },
    );
    assertErrorContract(deniedGet, 403, 'ADMIN_REQUIRED');

    const deniedPut = await requestJson(
      baseUrl,
      '/api/preparation-confirmation/items/order-fields',
      {
        method: 'PUT',
        token: employee.token,
        body: {
          status: 'in_review',
        },
      },
    );
    assertErrorContract(deniedPut, 403, 'ADMIN_REQUIRED');

    const admin = await login(
      baseUrl,
      'legacy-preparation-admin',
      TEST_PASSWORD,
    );
    const allowed = await requestJson(
      baseUrl,
      '/api/preparation-confirmation/items/order-fields',
      {
        method: 'PUT',
        token: admin.token,
        body: {
        status: 'in_review',
        owner: 'finance',
        notes: 'Checking order amount and logistics fields.',
        },
      },
    );
    assert.equal(allowed.response.status, 200);
    assert.equal(allowed.body.data.item.status, 'in_review');
  });
});

function withPreparationNestServer(run) {
  return withNestApiServer(run, {
    prisma: {
      users: [
        {
          id: 'usr_preparation_admin',
          name: 'Preparation Admin',
          username: 'preparation-admin',
          password: TEST_PASSWORD,
          role: 'admin',
        },
        {
          id: 'usr_preparation_sales',
          name: 'Preparation Sales',
          username: 'preparation-sales',
          password: TEST_PASSWORD,
          role: 'sales',
        },
      ],
    },
  });
}

async function withLegacyApiServer(run) {
  const now = new Date().toISOString();
  const users = [
    createLegacyUser({
      id: 'usr_legacy_preparation_admin',
      name: 'Legacy Preparation Admin',
      username: 'legacy-preparation-admin',
      role: 'admin',
      now,
    }),
    createLegacyUser({
      id: 'usr_legacy_preparation_sales',
      name: 'Legacy Preparation Sales',
      username: 'legacy-preparation-sales',
      role: 'sales',
      now,
    }),
  ];
  const userRepository = {
    listUsers: () => users,
    findById: (id) => users.find((user) => user.id === id) || null,
    findByUsername: (username) =>
      users.find((user) => user.username === String(username).toLowerCase()) ||
      null,
    saveUser: (nextUser) => {
      const index = users.findIndex((user) => user.id === nextUser.id);
      users[index] = nextUser;
      return nextUser;
    },
  };
  const operationLogRepository = {
    appendLog: () => undefined,
    listLogs: () => [],
  };
  const app = createApp({
    userRepository,
    operationLogRepository,
    settingsRepository: {},
    preparationConfirmationService: createTestService(),
    tokenSecret: TEST_AUTH_TOKEN_SECRET,
  });
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function createLegacyUser({ id, name, username, role, now }) {
  return {
    id,
    name,
    username,
    passwordHash: hashPassword(TEST_PASSWORD),
    role,
    phone: null,
    leaderId: null,
    isActive: true,
    mustChangePassword: false,
    tokenVersion: 0,
    statusReason: null,
    statusChangedAt: null,
    statusChangedBy: null,
    createdAt: now,
    updatedAt: now,
  };
}
