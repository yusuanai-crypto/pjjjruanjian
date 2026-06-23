#!/usr/bin/env node
'use strict';

require('dotenv/config');

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SETTING_KEYS = {
  onlyShowMarkedRecords: 'only_show_marked_records',
  restoreRequired: 'marked_records_restore_required',
  openedBy: 'global_mark_query_opened_by',
  openedAt: 'global_mark_query_opened_at',
  restoredBy: 'global_mark_query_restored_by',
  restoredAt: 'global_mark_query_restored_at',
  updatedAt: 'global_mark_query_updated_at',
};

const PRISMA_ROLE_BY_LEGACY_ROLE = {
  admin: 'ADMIN',
  boss: 'BOSS',
  front_desk: 'FRONT_DESK',
  sales: 'SALES',
  finance: 'FINANCE',
  warehouse: 'WAREHOUSE',
  after_sales: 'AFTER_SALES',
  taster: 'TASTER',
};

const REPORT_KEYS = ['users', 'systemSettings', 'operationLogs'];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const report = createReport();
  const startedAt = new Date();

  try {
    const usersJson = readJson(options.usersFile, 'users.json', report.users);
    const settingsJson = readJson(options.settingsFile, 'system-settings.json', report.systemSettings);
    const logsJson = readJson(options.logsFile, 'operation-logs.json', report.operationLogs);

    if (usersJson) {
      await migrateUsers(prisma, normalizeUsers(usersJson, report.users), options, report, startedAt);
    }

    if (settingsJson) {
      await migrateSystemSettings(
        prisma,
        normalizeSystemSettings(settingsJson, startedAt, report.systemSettings),
        options,
        report,
      );
    }

    if (logsJson) {
      await migrateOperationLogs(
        prisma,
        normalizeOperationLogs(logsJson, startedAt, report.operationLogs),
        options,
        report,
      );
    }

    printReport(report, options);
    if (totalFailed(report) > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

function parseArgs(args) {
  const dataDirDefault = path.resolve(__dirname, '../data');
  const options = {
    dataDir: dataDirDefault,
    usersFile: path.join(dataDirDefault, 'users.json'),
    settingsFile: path.join(dataDirDefault, 'system-settings.json'),
    logsFile: path.join(dataDirDefault, 'operation-logs.json'),
    updateExistingUsers: false,
    updateExistingSettings: false,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split('=');
    const nextValue = () => inlineValue ?? args[++index];

    switch (name) {
      case '--data-dir': {
        const dataDir = path.resolve(nextValue());
        options.dataDir = dataDir;
        options.usersFile = path.join(dataDir, 'users.json');
        options.settingsFile = path.join(dataDir, 'system-settings.json');
        options.logsFile = path.join(dataDir, 'operation-logs.json');
        break;
      }
      case '--users-file':
        options.usersFile = path.resolve(nextValue());
        break;
      case '--settings-file':
        options.settingsFile = path.resolve(nextValue());
        break;
      case '--logs-file':
        options.logsFile = path.resolve(nextValue());
        break;
      case '--update-existing-users':
        options.updateExistingUsers = true;
        break;
      case '--update-existing-settings':
        options.updateExistingSettings = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  npm.cmd run migrate:legacy-json
  npm.cmd run migrate:legacy-json -- --data-dir D:\\backup\\jiangjiu-data
  npm.cmd run migrate:legacy-json -- --update-existing-users --update-existing-settings

Options:
  --data-dir <path>              Directory containing users.json, system-settings.json, operation-logs.json.
  --users-file <path>            Override users.json path.
  --settings-file <path>         Override system-settings.json path.
  --logs-file <path>             Override operation-logs.json path.
  --update-existing-users        Explicitly update existing users only when username is the same.
  --update-existing-settings     Explicitly update existing system_settings with legacy values.
  --dry-run                      Read JSON and database state, but do not write to MySQL.
  --help                         Show this help.
`);
}

function createReport() {
  return {
    users: createCount(),
    systemSettings: createCount(),
    operationLogs: createCount(),
    warnings: [],
  };
}

function createCount() {
  return {
    imported: 0,
    skipped: 0,
    failed: 0,
    skips: [],
    errors: [],
  };
}

function readJson(filePath, label, count) {
  try {
    if (!fs.existsSync(filePath)) {
      count.skipped += 1;
      count.skips.push(`${label}: File not found`);
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    count.failed += 1;
    count.errors.push(`${label}: ${error.message}`);
    return null;
  }
}

function normalizeUsers(input, count) {
  const rows = Array.isArray(input) ? input : input?.users;
  if (!Array.isArray(rows)) {
    count.failed += 1;
    count.errors.push('users.json must be an array or an object with a users array.');
    return [];
  }

  const normalized = [];
  rows.forEach((user, index) => {
    try {
      const username = normalizeUsername(user.username);
      const role = toPrismaRole(user.role);
      const createdAt = parseDate(user.createdAt ?? user.created_at, new Date());
      const updatedAt = parseDate(user.updatedAt ?? user.updated_at, createdAt);

      normalized.push({
        sourceIndex: index,
        id: requiredString(user.id, 'id'),
        name: normalizeName(user.name, username),
        username,
        passwordHash: requiredString(user.passwordHash ?? user.password_hash, 'passwordHash'),
        role,
        phone: nullableString(user.phone),
        leaderId: nullableString(user.leaderId ?? user.leader_id),
        isActive: normalizeBoolean(user.isActive ?? user.is_active, true),
        createdAt,
        updatedAt,
      });
    } catch (error) {
      count.failed += 1;
      count.errors.push(`user #${index}: ${error.message}`);
    }
  });
  return normalized;
}

async function migrateUsers(prisma, users, options, report) {
  const seenIds = new Set();
  const seenUsernames = new Set();
  const leaderUpdates = [];

  for (const user of users) {
    try {
      validateUniqueSourceUser(user, seenIds, seenUsernames);

      const existingById = await prisma.user.findUnique({ where: { id: user.id } });
      const existingByUsername = await prisma.user.findUnique({ where: { username: user.username } });
      const existing = existingById || existingByUsername;

      if (existingById && existingByUsername && existingById.id !== existingByUsername.id) {
        throw new Error(
          `User conflict for source #${user.sourceIndex}: id ${user.id} and username ${user.username} match different database users.`,
        );
      }

      if (!existing) {
        if (!options.dryRun) {
          await prisma.user.create({
            data: toUserWrite(user, { includeLeaderId: false }),
          });
        }
        report.users.imported += 1;
        leaderUpdates.push({ userId: user.id, leaderId: user.leaderId, username: user.username });
        continue;
      }

      if (existing.username !== user.username) {
        throw new Error(
          `User conflict for source #${user.sourceIndex}: database id ${user.id} already belongs to username ${existing.username}.`,
        );
      }

      if (!options.updateExistingUsers) {
        report.users.skipped += 1;
        continue;
      }

      if (existing.role === 'ADMIN' && existing.username !== user.username) {
        report.users.skipped += 1;
        report.warnings.push(
          `Skipped existing admin ${existing.id}: username does not match legacy username ${user.username}.`,
        );
        continue;
      }

      if (!options.dryRun) {
        await prisma.user.update({
          where: { id: existing.id },
          data: toUserWrite(user, { includeLeaderId: false, keepDatabaseId: true }),
        });
      }
      report.users.imported += 1;
      leaderUpdates.push({ userId: existing.id, leaderId: user.leaderId, username: user.username });

      if (existing.id !== user.id) {
        report.warnings.push(
          `Updated existing username ${user.username} but kept database id ${existing.id}; legacy id ${user.id} was not applied.`,
        );
      }
    } catch (error) {
      report.users.failed += 1;
      report.users.errors.push(error.message);
    }
  }

  await applyLeaderUpdates(prisma, leaderUpdates, options, report);
}

function validateUniqueSourceUser(user, seenIds, seenUsernames) {
  if (seenIds.has(user.id)) {
    throw new Error(`Duplicate user id in users.json: ${user.id}`);
  }
  if (seenUsernames.has(user.username)) {
    throw new Error(`Duplicate username in users.json: ${user.username}`);
  }
  seenIds.add(user.id);
  seenUsernames.add(user.username);
}

async function applyLeaderUpdates(prisma, leaderUpdates, options, report) {
  for (const update of leaderUpdates) {
    if (!update.leaderId) {
      continue;
    }

    const leader = await prisma.user.findUnique({ where: { id: update.leaderId } });
    if (!leader) {
      report.warnings.push(
        `User ${update.username} imported without leaderId ${update.leaderId}: leader does not exist in users.`,
      );
      continue;
    }

    if (!options.dryRun) {
      await prisma.user.update({
        where: { id: update.userId },
        data: { leaderId: update.leaderId },
      });
    }
  }
}

function toUserWrite(user, options = {}) {
  const data = {
    name: user.name,
    username: user.username,
    passwordHash: user.passwordHash,
    role: user.role,
    phone: user.phone,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };

  if (!options.keepDatabaseId) {
    data.id = user.id;
  }

  if (options.includeLeaderId) {
    data.leaderId = user.leaderId;
  }

  return data;
}

function normalizeSystemSettings(input, startedAt, count) {
  if (Array.isArray(input?.settings)) {
    const normalized = [];
    input.settings.forEach((setting, index) => {
      try {
        normalized.push({
          sourceIndex: index,
          settingKey: requiredString(setting.settingKey ?? setting.setting_key, 'settingKey'),
          settingValue: stringifySettingValue(setting.settingValue ?? setting.setting_value ?? ''),
          updatedBy: nullableString(setting.updatedBy ?? setting.updated_by),
          updatedAt: parseDate(setting.updatedAt ?? setting.updated_at, startedAt),
        });
      } catch (error) {
        count.failed += 1;
        count.errors.push(`setting #${index}: ${error.message}`);
      }
    });
    return normalized;
  }

  const settings = input?.globalMarkQuery ?? input?.global_mark_query ?? input;
  if (!settings || typeof settings !== 'object') {
    count.failed += 1;
    count.errors.push('system-settings.json must contain a globalMarkQuery object or a settings array.');
    return [];
  }

  const updatedBy = nullableString(settings.restoredBy ?? settings.restored_by ?? settings.openedBy ?? settings.opened_by);
  const updatedAt = parseDate(
    settings.updatedAt ?? settings.updated_at ?? settings.restoredAt ?? settings.restored_at ?? settings.openedAt ?? settings.opened_at,
    startedAt,
  );

  return [
    {
      settingKey: SETTING_KEYS.onlyShowMarkedRecords,
      settingValue: String(normalizeBoolean(settings.onlyShowMarkedRecords ?? settings.only_show_marked_records, false)),
      updatedBy,
      updatedAt,
    },
    {
      settingKey: SETTING_KEYS.restoreRequired,
      settingValue: String(normalizeBoolean(settings.restoreRequired ?? settings.restore_required, false)),
      updatedBy,
      updatedAt,
    },
    {
      settingKey: SETTING_KEYS.openedBy,
      settingValue: stringifySettingValue(settings.openedBy ?? settings.opened_by ?? ''),
      updatedBy,
      updatedAt,
    },
    {
      settingKey: SETTING_KEYS.openedAt,
      settingValue: stringifySettingValue(settings.openedAt ?? settings.opened_at ?? ''),
      updatedBy,
      updatedAt,
    },
    {
      settingKey: SETTING_KEYS.restoredBy,
      settingValue: stringifySettingValue(settings.restoredBy ?? settings.restored_by ?? ''),
      updatedBy,
      updatedAt,
    },
    {
      settingKey: SETTING_KEYS.restoredAt,
      settingValue: stringifySettingValue(settings.restoredAt ?? settings.restored_at ?? ''),
      updatedBy,
      updatedAt,
    },
    {
      settingKey: SETTING_KEYS.updatedAt,
      settingValue: stringifySettingValue(settings.updatedAt ?? settings.updated_at ?? ''),
      updatedBy,
      updatedAt,
    },
  ];
}

async function migrateSystemSettings(prisma, settings, options, report) {
  for (const setting of settings) {
    try {
      const updatedBy = await existingUserIdOrNull(prisma, setting.updatedBy, report);
      const existing = await prisma.systemSetting.findUnique({
        where: { settingKey: setting.settingKey },
      });

      const data = {
        settingKey: setting.settingKey,
        settingValue: setting.settingValue,
        updatedBy,
        updatedAt: setting.updatedAt,
      };

      if (!existing) {
        if (!options.dryRun) {
          await prisma.systemSetting.create({ data });
        }
        report.systemSettings.imported += 1;
        continue;
      }

      if (!options.updateExistingSettings || isSameSetting(existing, data)) {
        report.systemSettings.skipped += 1;
        continue;
      }

      if (!options.dryRun) {
        await prisma.systemSetting.update({
          where: { settingKey: setting.settingKey },
          data,
        });
      }
      report.systemSettings.imported += 1;
    } catch (error) {
      report.systemSettings.failed += 1;
      report.systemSettings.errors.push(`${setting.settingKey || 'unknown setting'}: ${error.message}`);
    }
  }
}

function isSameSetting(existing, data) {
  return (
    existing.settingValue === data.settingValue &&
    (existing.updatedBy || null) === (data.updatedBy || null) &&
    normalizeDateValue(existing.updatedAt) === normalizeDateValue(data.updatedAt)
  );
}

function normalizeOperationLogs(input, startedAt, count) {
  const rows = Array.isArray(input) ? input : input?.logs;
  if (!Array.isArray(rows)) {
    count.failed += 1;
    count.errors.push('operation-logs.json must be an array or an object with a logs array.');
    return [];
  }

  const normalizedLogs = [];
  rows.forEach((log, index) => {
    try {
      const normalized = {
        sourceIndex: index,
        id: nullableString(log.id),
        userId: nullableString(log.userId ?? log.user_id),
        action: requiredString(log.action, 'action'),
        entityType: requiredString(log.entityType ?? log.entity_type, 'entityType'),
        entityId: nullableString(log.entityId ?? log.entity_id),
        beforeData: log.beforeData ?? log.before_data ?? null,
        afterData: log.afterData ?? log.after_data ?? null,
        ipAddress: nullableString(log.ipAddress ?? log.ip_address),
        createdAt: parseDate(log.createdAt ?? log.created_at, startedAt),
      };

      normalized.id = normalized.id || createStableLegacyLogId(normalized, index);
      normalizedLogs.push(normalized);
    } catch (error) {
      count.failed += 1;
      count.errors.push(`log #${index}: ${error.message}`);
    }
  });
  return normalizedLogs;
}

async function migrateOperationLogs(prisma, logs, options, report) {
  const seenIds = new Set();

  for (const log of logs) {
    try {
      if (seenIds.has(log.id)) {
        throw new Error(`Duplicate operation log id in operation-logs.json: ${log.id}`);
      }
      seenIds.add(log.id);

      const existing = await prisma.operationLog.findUnique({ where: { id: log.id } });
      if (existing) {
        report.operationLogs.skipped += 1;
        continue;
      }

      const userId = await existingUserIdOrNull(prisma, log.userId, report);
      if (!options.dryRun) {
        await prisma.operationLog.create({
          data: {
            id: log.id,
            userId,
            action: log.action,
            entityType: log.entityType,
            entityId: log.entityId,
            beforeData: log.beforeData,
            afterData: log.afterData,
            ipAddress: log.ipAddress,
            createdAt: log.createdAt,
          },
        });
      }
      report.operationLogs.imported += 1;
    } catch (error) {
      report.operationLogs.failed += 1;
      report.operationLogs.errors.push(`log #${log.sourceIndex}: ${error.message}`);
    }
  }
}

async function existingUserIdOrNull(prisma, userId, report) {
  if (!userId) {
    return null;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user) {
    return userId;
  }

  report.warnings.push(`Referenced user ${userId} does not exist; imported related row with NULL user reference.`);
  return null;
}

function toPrismaRole(role) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const prismaRole = PRISMA_ROLE_BY_LEGACY_ROLE[normalizedRole];
  if (!prismaRole) {
    throw new Error(`Unsupported user role: ${role}`);
  }
  return prismaRole;
}

function normalizeUsername(username) {
  const normalized = String(username || '').trim().toLowerCase();
  if (!normalized) {
    throw new Error('username is required.');
  }
  return normalized;
}

function normalizeName(name, username) {
  return String(name || username || '').trim();
}

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }

  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(text)) {
    return true;
  }
  if (['false', '0', 'no', 'n'].includes(text)) {
    return false;
  }
  return Boolean(value);
}

function requiredString(value, fieldName) {
  const text = String(value || '').trim();
  if (!text) {
    throw new Error(`${fieldName} is required.`);
  }
  return text;
}

function nullableString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function stringifySettingValue(value) {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}

function parseDate(value, fallback) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return truncateToSecond(value);
  }
  if (value !== undefined && value !== null && value !== '') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return truncateToSecond(date);
    }
  }
  return truncateToSecond(fallback);
}

function normalizeDateValue(value) {
  if (!value) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : truncateToSecond(date).toISOString();
}

function truncateToSecond(date) {
  const normalized = new Date(date);
  normalized.setMilliseconds(0);
  return normalized;
}

function createStableLegacyLogId(log, index) {
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ ...log, sourceIndex: index }))
    .digest('hex');
  return `legacy_${hash.slice(0, 29)}`;
}

function printReport(report, options) {
  const mode = options.dryRun ? 'DRY RUN - no database writes' : 'MIGRATION COMPLETE';
  console.log(`\n${mode}`);
  console.log('Legacy JSON to MySQL migration report');

  for (const key of REPORT_KEYS) {
    const count = report[key];
    console.log(
      `${key}: imported=${count.imported}, skipped=${count.skipped}, failed=${count.failed}`,
    );
    for (const error of count.errors) {
      console.log(`  ERROR ${error}`);
    }
    for (const skip of count.skips) {
      console.log(`  SKIP ${skip}`);
    }
  }

  if (report.warnings.length > 0) {
    console.log('warnings:');
    for (const warning of report.warnings) {
      console.log(`  WARN ${warning}`);
    }
  }
}

function totalFailed(report) {
  return REPORT_KEYS.reduce((sum, key) => sum + report[key].failed, 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
