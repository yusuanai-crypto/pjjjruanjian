#!/usr/bin/env node

require('dotenv/config');

const readline = require('node:readline');
const { Writable } = require('node:stream');
const { PrismaClient } = require('@prisma/client');

const { hashPassword } = require('../src/modules/auth/password');

const ADMIN_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

function parseUsername(argv) {
  const usernameIndex = argv.indexOf('--username');
  const rawUsername = usernameIndex >= 0 ? argv[usernameIndex + 1] : 'admin';
  const username = String(rawUsername || '').trim().toLowerCase();

  if (!username) {
    throw new Error('管理员用户名不能为空。');
  }
  if (usernameIndex >= 0 && !argv[usernameIndex + 1]) {
    throw new Error('--username 后必须提供管理员用户名。');
  }

  return username;
}

function readHiddenLine(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.reject(
      new Error('必须在交互式 SSH 终端中运行，密码不会通过命令行参数读取。'),
    );
  }

  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) {
        process.stdout.write(chunk, encoding);
      }
      callback();
    },
  });
  const terminal = readline.createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });

  process.stdout.write(prompt);
  muted = true;
  return new Promise((resolve) => {
    terminal.question('', (answer) => {
      muted = false;
      terminal.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function resetAdminPassword(prisma, input) {
  const now = new Date();
  const passwordHash = hashPassword(input.newPassword);

  return prisma.$transaction(async (transaction) => {
    const user = await transaction.user.findUnique({
      where: {
        username: input.username,
      },
      select: {
        id: true,
        username: true,
        role: true,
        isActive: true,
        deletedAt: true,
      },
    });

    if (!user || user.deletedAt) {
      throw new Error(`找不到可用账号：${input.username}`);
    }
    if (!ADMIN_ROLES.has(user.role)) {
      throw new Error(`拒绝操作：${input.username} 不是管理员账号。`);
    }

    await transaction.user.update({
      where: {
        id: user.id,
      },
      data: {
        passwordHash,
        mustChangePassword: false,
        tokenVersion: {
          increment: 1,
        },
        updatedAt: now,
      },
    });

    const revokedSessions = await transaction.refreshSession.updateMany({
      where: {
        userId: user.id,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
        revokeReason: 'server_password_reset',
        updatedAt: now,
      },
    });

    const revokedResetCodes = await transaction.smsVerificationCode.updateMany({
      where: {
        userId: user.id,
        activeKey: {
          not: null,
        },
        consumedAt: null,
      },
      data: {
        activeKey: null,
        consumedAt: now,
        updatedAt: now,
      },
    });

    await transaction.operationLog.create({
      data: {
        userId: null,
        actorNameSnapshot: '服务器运维人员',
        actorRoleSnapshot: 'server_operator',
        module: 'security',
        operationType: 'UPDATE',
        action: 'security.server_reset_admin_password',
        entityType: 'user',
        entityId: user.id,
        result: 'SUCCESS',
        afterData: {
          passwordChanged: true,
          sessionsRevoked: revokedSessions.count,
          resetCodesRevoked: revokedResetCodes.count,
        },
      },
    });

    return {
      username: user.username,
      role: user.role,
      isActive: user.isActive,
      revokedSessionCount: revokedSessions.count,
      revokedResetCodeCount: revokedResetCodes.count,
    };
  });
}

async function main() {
  const username = parseUsername(process.argv.slice(2));
  const newPassword = await readHiddenLine('请输入新密码（输入不会显示）：');
  const confirmation = await readHiddenLine('请再次输入新密码：');

  if (newPassword !== confirmation) {
    throw new Error('两次输入的新密码不一致，未修改数据库。');
  }

  const prisma = new PrismaClient();
  try {
    const result = await resetAdminPassword(prisma, {
      username,
      newPassword,
    });

    console.log(`管理员密码已修改：${result.username}（${result.role}）`);
    console.log(`已撤销登录会话：${result.revokedSessionCount}`);
    console.log(`已撤销短信重置码：${result.revokedResetCodeCount}`);
    if (!result.isActive) {
      console.warn('注意：该账号目前处于停用状态，修改密码不会自动启用账号。');
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`管理员密码修改失败：${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseUsername,
  resetAdminPassword,
};
