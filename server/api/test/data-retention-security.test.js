const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  executeRetentionCleanup,
} = require('../src/common/data-retention/retention-cleanup.service');
const {
  readRetentionPolicy,
} = require('../src/common/data-retention/retention-policy');
const {
  AiPromptBuilder,
} = require('../src/modules/ai/ai-prompt.builder');
const {
  MASKED_ADDRESS,
  sanitizeAuditDataWithReport,
} = require('../src/modules/operation-logs/audit-data-sanitizer');
const {
  OperationLogsNestService,
} = require('../src/modules/operation-logs/operation-log.nest.service');
const {
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

test('audit sanitizer removes secrets and bounds deep, cyclic, and oversized data', () => {
  const input = {
    password: 'test-password-value',
    authToken: 'test-token-value',
    verificationCode: '123456',
    短信验证码: '654321',
    cookie: 'session=test-cookie-value',
    apiKey: 'test-api-key-value',
    databaseUrl: 'mysql://test-user:test-password@db.invalid/test',
    连接字符串: 'redis://test-user:test-value@cache.invalid/0',
    customerPhone: '13800138000',
    联系电话: '13700000000',
    shippingAddress: '1 Test Street, Test City',
    家庭住址: '测试省测试市测试区测试路66号',
    tokenPresent: true,
    tokenFingerprint: 'abcdef987654',
    note:
      'Bearer test-bearer-value phone 13900000000 ' +
      'token=test-inline-token address: 2 Test Avenue;',
    items: ['one', 'two', 'three', 'four'],
    deep: {
      level1: {
        level2: {
          level3: {
            level4: 'must be bounded',
          },
        },
      },
    },
    huge: 'x'.repeat(1000),
  };
  input.self = input;

  const result = sanitizeAuditDataWithReport(input, {
    maxStringLength: 32,
    maxArrayLength: 2,
    maxObjectKeys: 20,
    maxDepth: 3,
    maxSerializedBytes: 4096,
  });
  const serialized = JSON.stringify(result.data);

  for (const forbidden of [
    'test-password-value',
    'test-token-value',
    '123456',
    '654321',
    'test-cookie-value',
    'test-api-key-value',
    'mysql://',
    'redis://',
    '13800138000',
    '13700000000',
    '13900000000',
    '1 Test Street',
    '测试省测试市测试区测试路66号',
    '2 Test Avenue',
    'test-bearer-value',
    'test-inline-token',
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.equal(result.data.items.length <= 2, true);
  assert.equal(result.data.tokenPresent, true);
  assert.equal(result.data.tokenFingerprint, 'abcdef987654');
  assert.equal(Buffer.byteLength(serialized, 'utf8') <= 4096, true);
  assert.equal(result.report.truncated, true);
  assert.equal(result.report.redactedCategories.includes('password'), true);
  assert.equal(result.report.redactedCategories.includes('token'), true);
  assert.equal(
    result.report.redactedCategories.includes('verification_code'),
    true,
  );
  assert.equal(result.report.redactedCategories.includes('phone'), true);
  assert.equal(result.report.redactedCategories.includes('address'), true);
  assert.equal(
    result.report.redactedCategories.includes('connection_string'),
    true,
  );
  assert.equal(result.report.limitations.includes('array_length'), true);
  assert.equal(result.report.limitations.includes('cycle'), true);

  const oversized = sanitizeAuditDataWithReport(
    {
      rows: Array.from({ length: 40 }, (_, index) => ({
        index,
        description: `safe-${index}-${'y'.repeat(100)}`,
      })),
    },
    {
      maxSerializedBytes: 256,
    },
  );
  assert.equal(
    Buffer.byteLength(JSON.stringify(oversized.data), 'utf8') <= 256,
    true,
  );
  assert.equal(oversized.report.limitations.includes('total_size'), true);
});

test('appendLog always sanitizes before and after data before persistence', async () => {
  let persisted;
  const prisma = {
    operationLog: {
      create: async ({ data }) => {
        persisted = data;
        return {
          ...data,
          createdAt: new Date('2026-07-20T00:00:00.000Z'),
        };
      },
    },
  };
  const service = new OperationLogsNestService(prisma);

  await service.appendLog({
    action: 'users.update',
    entityType: 'user',
    beforeData: {
      password: 'test-old-password',
      phone: '13800138000',
      address: 'Old complete address',
      displayName: 'Safe Name',
    },
    afterData: {
      token: 'test-session-token',
      phone: '13900000000',
      address: 'New complete address',
      displayName: 'Updated Safe Name',
    },
  });

  const serialized = JSON.stringify(persisted);
  for (const forbidden of [
    'test-old-password',
    'test-session-token',
    '13800138000',
    '13900000000',
    'Old complete address',
    'New complete address',
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.equal(persisted.beforeData.displayName, 'Safe Name');
  assert.equal(persisted.afterData.displayName, 'Updated Safe Name');
  assert.match(persisted.beforeData.phone, /^138\*{4}8000$/);
  assert.equal(persisted.beforeData.address, MASKED_ADDRESS);
  assert.deepEqual(
    persisted.sanitizationSummary.redactedCategories,
    ['address', 'password', 'phone', 'token'],
  );
});

test('retention configuration enforces bounded days and batch size', () => {
  assert.deepEqual(
    readRetentionPolicy({
      OPERATION_LOG_RETENTION_DAYS: '400',
      AI_HISTORY_RETENTION_DAYS: '40',
      RETENTION_CLEANUP_BATCH_SIZE: '25',
    }),
    {
      operationLogRetentionDays: 400,
      aiHistoryRetentionDays: 40,
      batchSize: 25,
    },
  );
  assert.throws(
    () =>
      readRetentionPolicy({
        OPERATION_LOG_RETENTION_DAYS: '29',
      }),
    (error) => error.code === 'DATA_RETENTION_CONFIG_INVALID',
  );
  assert.throws(
    () =>
      readRetentionPolicy({
        AI_HISTORY_RETENTION_DAYS: '3651',
      }),
    (error) => error.code === 'DATA_RETENTION_CONFIG_INVALID',
  );
  assert.throws(
    () =>
      readRetentionPolicy({
        RETENTION_CLEANUP_BATCH_SIZE: '1001',
      }),
    (error) => error.code === 'DATA_RETENTION_CONFIG_INVALID',
  );
});

test('retention cleanup is dry-run by default and apply deletes only expired rows in batches', async () => {
  const now = new Date('2026-07-20T00:00:00.000Z');
  const operationRows = [
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `operation-expired-${index}`,
      createdAt: new Date(`2026-06-${String(10 + index).padStart(2, '0')}T00:00:00.000Z`),
      payload: 'must never be logged',
    })),
    {
      id: 'operation-boundary',
      createdAt: new Date('2026-06-20T00:00:00.000Z'),
      payload: 'boundary content',
    },
    {
      id: 'operation-current',
      createdAt: new Date('2026-07-19T00:00:00.000Z'),
      payload: 'current content',
    },
  ];
  const aiRows = [
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `ai-expired-${index}`,
      createdAt: new Date(`2026-07-0${index + 1}T00:00:00.000Z`),
      question: 'private historical question',
    })),
    {
      id: 'ai-boundary',
      createdAt: new Date('2026-07-13T00:00:00.000Z'),
      question: 'boundary question',
    },
    {
      id: 'ai-current',
      createdAt: new Date('2026-07-19T00:00:00.000Z'),
      question: 'current question',
    },
  ];
  const operationArchives = [];
  const prisma = {
    operationLog: createCleanupDelegate(operationRows),
    operationLogArchive: createArchiveDelegate(operationArchives),
    aiChatMessage: createCleanupDelegate(aiRows),
  };
  const policy = {
    operationLogRetentionDays: 30,
    aiHistoryRetentionDays: 7,
    batchSize: 2,
  };

  const dryRun = await executeRetentionCleanup(prisma, {
    now,
    policy,
    taskId: 'retention-test-dry-run',
  });
  assert.equal(dryRun.mode, 'dry-run');
  assert.equal(dryRun.operationLogs.matchedCount, 5);
  assert.equal(dryRun.operationLogs.archivedCount, 0);
  assert.equal(dryRun.operationLogs.deletedCount, 0);
  assert.equal(dryRun.aiHistory.matchedCount, 3);
  assert.equal(dryRun.aiHistory.deletedCount, 0);
  assert.equal(operationRows.length, 7);
  assert.equal(aiRows.length, 5);

  const logs = [];
  const applied = await executeRetentionCleanup(prisma, {
    apply: true,
    now,
    policy,
    taskId: 'retention-test-apply',
    logger: {
      info: (entry) => logs.push(entry),
    },
  });
  assert.equal(applied.mode, 'apply');
  assert.equal(applied.operationLogs.deletedCount, 5);
  assert.equal(applied.operationLogs.archivedCount, 5);
  assert.equal(applied.operationLogs.failedCount, 0);
  assert.equal(applied.operationLogs.batches, 3);
  assert.equal(applied.aiHistory.deletedCount, 3);
  assert.equal(applied.aiHistory.batches, 2);
  assert.deepEqual(
    operationRows.map((row) => row.id).sort(),
    ['operation-boundary', 'operation-current'],
  );
  assert.equal(operationArchives.length, 5);
  assert.deepEqual(
    aiRows.map((row) => row.id).sort(),
    ['ai-boundary', 'ai-current'],
  );
  assert.equal(logs.length, 1);
  assert.equal(logs[0].includes('must never be logged'), false);
  assert.equal(logs[0].includes('private historical question'), false);
  assert.equal(logs[0].includes('retention-test-apply'), true);
});

test('operation log archive is idempotent when an archive row already exists', async () => {
  const now = new Date('2026-07-20T00:00:00.000Z');
  const online = [
    {
      id: 'already-archived',
      action: 'customers.read',
      entityType: 'customer',
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
    },
  ];
  const archives = [
    {
      ...online[0],
      archivedAt: now,
    },
  ];
  const prisma = {
    operationLog: createCleanupDelegate(online),
    operationLogArchive: createArchiveDelegate(archives),
    aiChatMessage: createCleanupDelegate([]),
  };
  const policy = {
    operationLogRetentionDays: 30,
    aiHistoryRetentionDays: 7,
    batchSize: 10,
  };

  const first = await executeRetentionCleanup(prisma, {
    apply: true,
    now,
    policy,
  });
  assert.equal(first.operationLogs.archivedCount, 0);
  assert.equal(first.operationLogs.skippedCount, 1);
  assert.equal(first.operationLogs.deletedCount, 1);
  assert.equal(first.operationLogs.failedCount, 0);
  assert.equal(online.length, 0);
  assert.equal(archives.length, 1);

  const second = await executeRetentionCleanup(prisma, {
    apply: true,
    now,
    policy,
  });
  assert.equal(second.operationLogs.matchedCount, 0);
  assert.equal(second.operationLogs.archivedCount, 0);
  assert.equal(archives.length, 1);
});

test('operation log archive failure rolls back its copy and preserves online rows', async () => {
  const now = new Date('2026-07-20T00:00:00.000Z');
  const online = [
    {
      id: 'archive-failure',
      action: 'customers.update',
      entityType: 'customer',
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
    },
  ];
  const archives = [];
  const operationLog = createCleanupDelegate(online);
  const archiveDelegate = createArchiveDelegate(archives);
  archiveDelegate.createMany = async ({ data }) => {
    archives.push({ ...data[0] });
    throw new Error('simulated archive storage failure');
  };
  const prisma = {
    operationLog,
    operationLogArchive: archiveDelegate,
    aiChatMessage: createCleanupDelegate([]),
    $transaction: async (callback) => {
      const onlineSnapshot = online.map((row) => ({ ...row }));
      const archiveSnapshot = archives.map((row) => ({ ...row }));
      try {
        return await callback(prisma);
      } catch (error) {
        online.splice(0, online.length, ...onlineSnapshot);
        archives.splice(0, archives.length, ...archiveSnapshot);
        throw error;
      }
    },
  };

  const result = await executeRetentionCleanup(prisma, {
    apply: true,
    now,
    policy: {
      operationLogRetentionDays: 30,
      aiHistoryRetentionDays: 7,
      batchSize: 10,
    },
  });
  assert.equal(result.operationLogs.failedCount, 1);
  assert.equal(result.operationLogs.deletedCount, 0);
  assert.equal(online.length, 1);
  assert.equal(archives.length, 0);
});

test('AI prompt and persisted history use a minimized question while internal request completes', async () => {
  const rawQuestion =
    'sales amount phone 13800138000 address: 2 Test Avenue; ' +
    '北京市朝阳区测试路88号 order SO202607200001 ' +
    'token=test-question-token';
  const prompt = new AiPromptBuilder().buildMessages({
    userRole: 'boss',
    intent: 'analytics_overview',
    question: rawQuestion,
    toolResults: [],
  });
  const promptText = JSON.stringify(prompt);
  for (const forbidden of [
    '13800138000',
    '2 Test Avenue',
    '北京市朝阳区测试路88号',
    'SO202607200001',
    'test-question-token',
  ]) {
    assert.equal(promptText.includes(forbidden), false);
  }

  await withPhase1Server(
    async (baseUrl, context) => {
      const boss = await login(
        baseUrl,
        'retention-history-boss',
        'Password123',
      );
      const response = await requestJson(baseUrl, '/api/ai/chat', {
        method: 'POST',
        token: boss.token,
        body: {
          question: rawQuestion,
          conversationId: 'retention-history-test',
        },
      });
      assert.equal(response.response.status, 201);

      const history = context.prisma.__store.aiChatMessages.find(
        (message) =>
          message.conversationId === 'retention-history-test',
      );
      assert.ok(history);
      const serialized = JSON.stringify(history);
      for (const forbidden of [
        '13800138000',
        '2 Test Avenue',
        '北京市朝阳区测试路88号',
        'SO202607200001',
        'test-question-token',
      ]) {
        assert.equal(serialized.includes(forbidden), false);
      }
      assert.equal(history.question.includes('138****8000'), true);
      assert.equal(history.question.includes(MASKED_ADDRESS), true);
      assert.equal(history.question.includes('SO-[MASKED]'), true);
    },
    {
      env: {
        AI_ENABLED: 'true',
        AI_MOCK_MODE: 'true',
      },
      prisma: {
        users: [
          {
            id: 'usr-retention-history-boss',
            name: 'Retention History Boss',
            username: 'retention-history-boss',
            password: 'Password123',
            role: 'boss',
          },
        ],
      },
    },
  );
});

test('schema migration records audit sanitization metadata without storing cleanup payloads', () => {
  const schema = fs.readFileSync(
    path.resolve(__dirname, '../prisma/schema.prisma'),
    'utf8',
  );
  const migration = fs.readFileSync(
    path.resolve(
      __dirname,
      '../prisma/migrations/20260720000400_audit_data_minimization/migration.sql',
    ),
    'utf8',
  );
  const cleanupScript = fs.readFileSync(
    path.resolve(__dirname, '../scripts/cleanup-retained-data.ts'),
    'utf8',
  );
  const archiveMigration = fs.readFileSync(
    path.resolve(
      __dirname,
      '../prisma/migrations/20260725000100_operation_log_audit_archive/migration.sql',
    ),
    'utf8',
  );

  assert.match(schema, /sanitizationSummary\s+Json\?/);
  assert.match(schema, /model OperationLogArchive/);
  assert.match(schema, /actorUsernameSnapshot\s+String\?/);
  assert.match(schema, /operationType\s+OperationLogType\?/);
  assert.match(migration, /sanitization_summary/);
  assert.match(archiveMigration, /CREATE TABLE `operation_log_archives`/);
  assert.doesNotMatch(
    archiveMigration,
    /FOREIGN KEY.*operation_log_archives/is,
  );
  assert.match(cleanupScript, /args\.includes\('--apply'\)/);
  assert.doesNotMatch(cleanupScript, /deleteMany\(\{\s*\}\)/);
});

function createCleanupDelegate(rows) {
  return {
    count: async ({ where } = {}) =>
      rows.filter((row) => matchesCleanupWhere(row, where)).length,
    findMany: async ({ where, take } = {}) =>
      rows
        .filter((row) => matchesCleanupWhere(row, where))
        .sort((left, right) => left.createdAt - right.createdAt)
        .slice(0, take || rows.length)
        .map((row) => ({ ...row })),
    deleteMany: async ({ where } = {}) => {
      const ids = new Set(where?.id?.in || []);
      let count = 0;
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (ids.has(rows[index].id)) {
          rows.splice(index, 1);
          count += 1;
        }
      }
      return { count };
    },
  };
}

function createArchiveDelegate(rows) {
  return {
    createMany: async ({ data, skipDuplicates } = {}) => {
      let count = 0;
      for (const row of data || []) {
        if (rows.some((item) => item.id === row.id)) {
          if (skipDuplicates) continue;
          throw new Error('duplicate archive id');
        }
        rows.push({ ...row });
        count += 1;
      }
      return { count };
    },
    findMany: async ({ where } = {}) => {
      const ids = new Set(where?.id?.in || []);
      return rows
        .filter((row) => ids.size === 0 || ids.has(row.id))
        .map((row) => ({ id: row.id }));
    },
  };
}

function matchesCleanupWhere(row, where = {}) {
  if (where.createdAt?.lt) {
    return row.createdAt.getTime() < where.createdAt.lt.getTime();
  }
  return true;
}
