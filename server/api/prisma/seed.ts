import 'dotenv/config';

const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../src/modules/auth/password');

const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin@123456';

  const admin = await prisma.user.upsert({
    where: {
      username: 'admin',
    },
    update: {
      name: '系统管理员',
      role: 'ADMIN',
      isActive: true,
      updatedAt: now,
    },
    create: {
      id: 'usr_admin',
      name: '系统管理员',
      username: 'admin',
      passwordHash: hashPassword(adminPassword),
      role: 'ADMIN',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  });

  await upsertSetting('only_show_marked_records', 'false', admin.id, now);
  await upsertSetting('marked_records_restore_required', 'false', admin.id, now);

  await prisma.operationLog.create({
    data: {
      userId: admin.id,
      action: 'seed.phase1',
      entityType: 'system',
      entityId: 'phase1',
      afterData: {
        defaultAdmin: admin.username,
        settings: ['only_show_marked_records', 'marked_records_restore_required'],
      },
      createdAt: now,
    },
  });
}

async function upsertSetting(settingKey: string, settingValue: string, updatedBy: string, updatedAt: Date) {
  await prisma.systemSetting.upsert({
    where: {
      settingKey,
    },
    update: {
      settingValue,
      updatedBy,
      updatedAt,
    },
    create: {
      settingKey,
      settingValue,
      updatedBy,
      updatedAt,
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
