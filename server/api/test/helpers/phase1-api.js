const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

const { Test } = require('@nestjs/testing');
const { AppModule } = require('../../src/app.module');
const { ApiExceptionFilter } = require('../../src/common/filters/api-exception.filter');
const { ApiResponseInterceptor } = require('../../src/common/interceptors/api-response.interceptor');
const { RequestValidationPipe } = require('../../src/common/pipes/request-validation.pipe');
const { hashPassword } = require('../../src/modules/auth/password');
const { BOOTSTRAP_ADMIN_PASSWORD } = require('../../src/modules/users/users.repository');
const { PrismaService } = require('../../src/prisma/prisma.service');

function createTestStores() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    phase0StorePath: path.join(os.tmpdir(), `jiangjiu-phase0-${suffix}.json`),
    userStorePath: path.join(os.tmpdir(), `jiangjiu-users-${suffix}.json`),
    settingsStorePath: path.join(os.tmpdir(), `jiangjiu-settings-${suffix}.json`),
    operationLogStorePath: path.join(os.tmpdir(), `jiangjiu-logs-${suffix}.json`),
    tokenSecret: `test-secret-${suffix}`,
  };
}

async function withPhase1Server(run) {
  await withNestApiServer(run);
}

async function withNestApiServer(run) {
  const stores = createTestStores();
  const previousEnv = {
    PHASE0_CONFIRMATION_STORE: process.env.PHASE0_CONFIRMATION_STORE,
    PHASE1_USER_STORE: process.env.PHASE1_USER_STORE,
    PHASE1_SETTINGS_STORE: process.env.PHASE1_SETTINGS_STORE,
    PHASE1_OPERATION_LOG_STORE: process.env.PHASE1_OPERATION_LOG_STORE,
    AUTH_TOKEN_SECRET: process.env.AUTH_TOKEN_SECRET,
    PRISMA_CONNECT_ON_BOOT: process.env.PRISMA_CONNECT_ON_BOOT,
  };

  process.env.PHASE0_CONFIRMATION_STORE = stores.phase0StorePath;
  process.env.PHASE1_USER_STORE = stores.userStorePath;
  process.env.PHASE1_SETTINGS_STORE = stores.settingsStorePath;
  process.env.PHASE1_OPERATION_LOG_STORE = stores.operationLogStorePath;
  process.env.AUTH_TOKEN_SECRET = stores.tokenSecret;
  process.env.PRISMA_CONNECT_ON_BOOT = 'false';

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PrismaService)
    .useValue(createInMemoryPrisma())
    .compile();

  const app = moduleFixture.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.useGlobalPipes(new RequestValidationPipe());
  await app.listen(0);
  const server = app.getHttpServer();
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await run(baseUrl);
  } finally {
    await app.close();
    restoreEnv(previousEnv);
  }
}

function createInMemoryPrisma() {
  const now = new Date();
  const users = [
    {
      id: 'usr_admin',
      name: '系统管理员',
      username: 'admin',
      passwordHash: hashPassword(BOOTSTRAP_ADMIN_PASSWORD),
      role: 'ADMIN',
      phone: null,
      leaderId: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
  const systemSettings = [
    createSystemSetting('only_show_marked_records', 'false', null, now),
    createSystemSetting('marked_records_restore_required', 'false', null, now),
    createSystemSetting('global_mark_query_updated_at', now.toISOString(), null, now),
  ];
  const operationLogs = [];

  return {
    $connect: async () => undefined,
    $disconnect: async () => undefined,
    $transaction: async (operations) => Promise.all(operations),
    user: {
      findUnique: async ({ where }) => {
        const row = users.find((user) => matchesUnique(user, where));
        return row ? copyRow(row) : null;
      },
      findMany: async ({ where, orderBy } = {}) => {
        return sortRows(users.filter((user) => matchesWhere(user, where)).map(copyRow), orderBy);
      },
      create: async ({ data }) => {
        const row = {
          ...data,
          id: data.id || crypto.randomUUID(),
          createdAt: asDate(data.createdAt) || new Date(),
          updatedAt: asDate(data.updatedAt) || new Date(),
        };
        users.push(row);
        return copyRow(row);
      },
      update: async ({ where, data }) => {
        const index = users.findIndex((user) => matchesUnique(user, where));
        if (index < 0) {
          throw new Error('User not found in test Prisma store.');
        }
        users[index] = {
          ...users[index],
          ...data,
          updatedAt: asDate(data.updatedAt) || new Date(),
        };
        return copyRow(users[index]);
      },
    },
    systemSetting: {
      findMany: async ({ where, orderBy } = {}) => {
        return sortRows(systemSettings.filter((item) => matchesWhere(item, where)).map(copyRow), orderBy);
      },
      upsert: async ({ where, update, create }) => {
        const index = systemSettings.findIndex((item) => matchesUnique(item, where));
        if (index >= 0) {
          systemSettings[index] = {
            ...systemSettings[index],
            ...update,
            updatedAt: asDate(update.updatedAt) || new Date(),
          };
          return copyRow(systemSettings[index]);
        }

        const row = {
          ...create,
          id: create.id || crypto.randomUUID(),
          updatedAt: asDate(create.updatedAt) || new Date(),
        };
        systemSettings.push(row);
        return copyRow(row);
      },
    },
    operationLog: {
      create: async ({ data }) => {
        const row = {
          ...data,
          id: data.id || crypto.randomUUID(),
          createdAt: asDate(data.createdAt) || new Date(),
        };
        operationLogs.push(row);
        return copyRow(row);
      },
      findMany: async ({ where, orderBy } = {}) => {
        return sortRows(operationLogs.filter((log) => matchesWhere(log, where)).map(copyRow), orderBy);
      },
    },
  };
}

function createSystemSetting(settingKey, settingValue, updatedBy, updatedAt) {
  return {
    id: crypto.randomUUID(),
    settingKey,
    settingValue,
    updatedBy,
    updatedAt,
  };
}

function matchesUnique(row, where = {}) {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function matchesWhere(row, where = {}) {
  return Object.entries(where || {}).every(([key, value]) => {
    if (value && typeof value === 'object' && Array.isArray(value.in)) {
      return value.in.includes(row[key]);
    }
    return row[key] === value;
  });
}

function sortRows(rows, orderBy) {
  if (!orderBy) {
    return rows;
  }
  const [key, direction] = Object.entries(orderBy)[0] || [];
  if (!key) {
    return rows;
  }
  return rows.sort((left, right) => {
    const leftValue = left[key] instanceof Date ? left[key].getTime() : left[key];
    const rightValue = right[key] instanceof Date ? right[key].getTime() : right[key];
    if (leftValue === rightValue) {
      return 0;
    }
    const result = leftValue > rightValue ? 1 : -1;
    return direction === 'desc' ? -result : result;
  });
}

function copyRow(row) {
  return { ...row };
}

function asDate(value) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value : new Date(value);
}

function restoreEnv(previousEnv) {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function requestJson(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const body = await response.json();
  return {
    response,
    body,
  };
}

async function login(baseUrl, username = 'admin', password = BOOTSTRAP_ADMIN_PASSWORD) {
  const result = await requestJson(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: {
      username,
      password,
    },
  });
  assert.equal(result.response.status, 200);
  assertSessionContract(result.body.data);
  return result.body.data;
}

async function createUser(baseUrl, token, payload) {
  const result = await requestJson(baseUrl, '/api/users', {
    method: 'POST',
    token,
    body: payload,
  });
  assert.equal(result.response.status, 201);
  assert.deepEqual(Object.keys(result.body).sort(), ['data']);
  assertPublicUserContract(result.body.data.user);
  assert.equal(Array.isArray(result.body.data.permissions), true);
  assert.equal(Array.isArray(result.body.data.menus), true);
  return result.body.data.user;
}

function assertSessionContract(session) {
  assert.deepEqual(Object.keys(session).sort(), ['dataScope', 'expiresAt', 'menus', 'permissions', 'token', 'user']);
  assert.equal(typeof session.token, 'string');
  assert.match(session.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(typeof session.expiresAt, 'string');
  assert.doesNotThrow(() => new Date(session.expiresAt).toISOString());
  assertPublicUserContract(session.user);
  assert.equal(Array.isArray(session.permissions), true);
  assert.equal(Array.isArray(session.menus), true);
  assert.equal(typeof session.dataScope, 'object');
}

function assertCurrentUserContract(data) {
  assert.deepEqual(Object.keys(data).sort(), ['dataScope', 'menus', 'permissions', 'user']);
  assertPublicUserContract(data.user);
  assert.equal(Array.isArray(data.permissions), true);
  assert.equal(Array.isArray(data.menus), true);
  assert.equal(typeof data.dataScope, 'object');
}

function assertPublicUserContract(user) {
  assert.deepEqual(
    Object.keys(user).sort(),
    ['createdAt', 'id', 'isActive', 'leaderId', 'name', 'phone', 'role', 'updatedAt', 'username'],
  );
  assert.equal(typeof user.id, 'string');
  assert.equal(typeof user.name, 'string');
  assert.equal(typeof user.username, 'string');
  assert.equal(typeof user.role, 'string');
  assert.equal(typeof user.isActive, 'boolean');
  assert.equal(typeof user.createdAt, 'string');
  assert.equal(typeof user.updatedAt, 'string');
  assert.equal('passwordHash' in user, false);
}

function assertSettingsContract(settings) {
  assert.deepEqual(
    Object.keys(settings).sort(),
    ['onlyShowMarkedRecords', 'openedAt', 'openedBy', 'restoreRequired', 'restoredAt', 'restoredBy', 'updatedAt'],
  );
  assert.equal(typeof settings.onlyShowMarkedRecords, 'boolean');
  assert.equal(typeof settings.restoreRequired, 'boolean');
}

function assertOperationLogContract(log) {
  assert.deepEqual(
    Object.keys(log).sort(),
    ['action', 'afterData', 'beforeData', 'createdAt', 'entityId', 'entityType', 'id', 'ipAddress', 'userId'],
  );
  assert.equal(typeof log.id, 'string');
  assert.equal(typeof log.action, 'string');
  assert.equal(typeof log.entityType, 'string');
  assert.equal(typeof log.createdAt, 'string');
}

function assertErrorContract(result, statusCode, code) {
  assert.equal(result.response.status, statusCode);
  assert.deepEqual(Object.keys(result.body).sort(), ['error']);
  assert.deepEqual(Object.keys(result.body.error).sort(), ['code', 'message']);
  assert.equal(result.body.error.code, code);
  assert.equal(typeof result.body.error.message, 'string');
}

module.exports = {
  BOOTSTRAP_ADMIN_PASSWORD,
  assertCurrentUserContract,
  assertErrorContract,
  assertOperationLogContract,
  assertPublicUserContract,
  assertSessionContract,
  assertSettingsContract,
  createUser,
  login,
  requestJson,
  withNestApiServer,
  withPhase1Server,
};
