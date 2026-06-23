const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_STORE_PATH = path.resolve(__dirname, '../../../data/system-settings.json');

function createSystemSettingsRepository(storePath = process.env.PHASE1_SETTINGS_STORE || DEFAULT_STORE_PATH) {
  return {
    getGlobalMarkQuery() {
      return readState(storePath).globalMarkQuery;
    },

    saveGlobalMarkQuery(settings) {
      const state = readState(storePath);
      state.globalMarkQuery = normalizeGlobalMarkQuery(settings);
      writeState(storePath, state);
      return state.globalMarkQuery;
    },
  };
}

function readState(storePath) {
  ensureStore(storePath);
  const raw = fs.readFileSync(storePath, 'utf8');
  return normalizeState(JSON.parse(raw));
}

function writeState(storePath, state) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(normalizeState(state), null, 2)}\n`, 'utf8');
}

function ensureStore(storePath) {
  if (fs.existsSync(storePath)) {
    return;
  }
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(createDefaultState(), null, 2)}\n`, 'utf8');
}

function createDefaultState() {
  return {
    globalMarkQuery: {
      onlyShowMarkedRecords: false,
      restoreRequired: false,
      openedBy: null,
      openedAt: null,
      restoredBy: null,
      restoredAt: null,
      updatedAt: null,
    },
  };
}

function normalizeState(state) {
  return {
    globalMarkQuery: normalizeGlobalMarkQuery(state?.globalMarkQuery || state?.global_mark_query || {}),
  };
}

function normalizeGlobalMarkQuery(settings) {
  return {
    onlyShowMarkedRecords: Boolean(settings.onlyShowMarkedRecords ?? settings.only_show_marked_records ?? false),
    restoreRequired: Boolean(settings.restoreRequired ?? settings.restore_required ?? false),
    openedBy: settings.openedBy || settings.opened_by || null,
    openedAt: settings.openedAt || settings.opened_at || null,
    restoredBy: settings.restoredBy || settings.restored_by || null,
    restoredAt: settings.restoredAt || settings.restored_at || null,
    updatedAt: settings.updatedAt || settings.updated_at || null,
  };
}

module.exports = {
  createSystemSettingsRepository,
};
