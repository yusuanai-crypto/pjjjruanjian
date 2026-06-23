const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { withNestApiServer } = require('./helpers/phase1-api');
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

test('serves list and update interfaces over HTTP', async () => {
  await withNestApiServer(async (baseUrl) => {
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
  });
});
