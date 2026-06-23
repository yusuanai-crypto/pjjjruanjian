const fs = require('node:fs');
const path = require('node:path');

const { hashPassword } = require('../auth/password');

const DEFAULT_STORE_PATH = path.resolve(__dirname, '../../../data/users.json');
const BOOTSTRAP_ADMIN_PASSWORD = 'Admin@123456';

function createUserRepository(storePath = process.env.PHASE1_USER_STORE || DEFAULT_STORE_PATH) {
  return {
    listUsers() {
      return readState(storePath).users;
    },

    findById(id) {
      return readState(storePath).users.find((user) => user.id === id) || null;
    },

    findByUsername(username) {
      const normalizedUsername = normalizeUsername(username);
      return readState(storePath).users.find((user) => user.username === normalizedUsername) || null;
    },

    saveUser(user) {
      const state = readState(storePath);
      const existingIndex = state.users.findIndex((item) => item.id === user.id);
      if (existingIndex >= 0) {
        state.users[existingIndex] = normalizeUser(user);
      } else {
        state.users.push(normalizeUser(user));
      }
      writeState(storePath, state);
      return normalizeUser(user);
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
  const now = new Date().toISOString();
  return {
    users: [
      {
        id: 'usr_admin',
        name: '系统管理员',
        username: 'admin',
        passwordHash: hashPassword(BOOTSTRAP_ADMIN_PASSWORD),
        role: 'admin',
        phone: null,
        leaderId: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

function normalizeState(state) {
  const users = Array.isArray(state?.users) ? state.users : [];
  return {
    users: users.map(normalizeUser),
  };
}

function normalizeUser(user) {
  const now = new Date().toISOString();
  return {
    id: String(user.id),
    name: String(user.name || '').trim(),
    username: normalizeUsername(user.username),
    passwordHash: String(user.passwordHash || user.password_hash || ''),
    role: String(user.role || ''),
    phone: user.phone ? String(user.phone).trim() : null,
    leaderId: user.leaderId || user.leader_id || null,
    isActive: user.isActive !== undefined ? Boolean(user.isActive) : Boolean(user.is_active ?? true),
    createdAt: user.createdAt || user.created_at || now,
    updatedAt: user.updatedAt || user.updated_at || now,
  };
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

module.exports = {
  BOOTSTRAP_ADMIN_PASSWORD,
  createUserRepository,
  normalizeUsername,
};
