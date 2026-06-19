const fs = require('node:fs');
const path = require('node:path');

const { CHECKLIST_ITEMS } = require('./preparation-confirmation.items');

const DEFAULT_STORE_PATH = path.resolve(__dirname, '../../../data/preparation-confirmations.json');

function createPreparationConfirmationRepository(storePath = process.env.PHASE0_CONFIRMATION_STORE || DEFAULT_STORE_PATH) {
  return {
    readState() {
      ensureStore(storePath);
      const raw = fs.readFileSync(storePath, 'utf8');
      return normalizeState(JSON.parse(raw));
    },

    writeState(state) {
      fs.mkdirSync(path.dirname(storePath), { recursive: true });
      fs.writeFileSync(storePath, `${JSON.stringify(normalizeState(state), null, 2)}\n`, 'utf8');
    },
  };
}

function ensureStore(storePath) {
  if (fs.existsSync(storePath)) {
    return;
  }

  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(createDefaultState(), null, 2)}\n`, 'utf8');
}

function normalizeState(state) {
  const normalized = {
    items: {},
  };

  const existingItems = state && typeof state === 'object' && state.items ? state.items : {};
  for (const item of CHECKLIST_ITEMS) {
    normalized.items[item.id] = {
      status: existingItems[item.id]?.status || 'pending',
      owner: existingItems[item.id]?.owner || null,
      notes: existingItems[item.id]?.notes || '',
      evidenceLinks: Array.isArray(existingItems[item.id]?.evidenceLinks)
        ? existingItems[item.id].evidenceLinks
        : [],
      confirmedBy: existingItems[item.id]?.confirmedBy || null,
      confirmedAt: existingItems[item.id]?.confirmedAt || null,
      updatedAt: existingItems[item.id]?.updatedAt || null,
    };
  }

  return normalized;
}

function createDefaultState() {
  return normalizeState({
    items: {},
  });
}

module.exports = {
  createPreparationConfirmationRepository,
  createDefaultState,
};
