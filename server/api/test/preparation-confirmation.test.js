const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createApp } = require('../src/app');
const {
  createPreparationConfirmationRepository,
} = require('../src/modules/preparation-confirmation/preparation-confirmation.repository');
const {
  createPreparationConfirmationService,
} = require('../src/modules/preparation-confirmation/preparation-confirmation.service');

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

  assert.equal(items.length, 10);
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
  assert.equal(summary.progressPercent, 10);
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

test('serves list and update interfaces over HTTP', async () => {
  const service = createTestService();
  const server = http.createServer(
    createApp({
      preparationConfirmationService: service,
    }),
  );

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const updateResponse = await fetch(`${baseUrl}/api/preparation-confirmation/items/order-fields`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'in_review',
        owner: 'finance',
        notes: 'Checking order amount and logistics fields.',
      }),
    });
    assert.equal(updateResponse.status, 200);
    const updateBody = await updateResponse.json();
    assert.equal(updateBody.data.item.status, 'in_review');

    const listResponse = await fetch(`${baseUrl}/api/preparation-confirmation/items?status=in_review`);
    assert.equal(listResponse.status, 200);
    const listBody = await listResponse.json();
    assert.equal(listBody.data.items.length, 1);
    assert.equal(listBody.data.items[0].id, 'order-fields');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
