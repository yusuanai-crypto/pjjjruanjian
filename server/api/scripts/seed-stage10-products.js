#!/usr/bin/env node
'use strict';

require('dotenv/config');

const { PrismaClient } = require('@prisma/client');
const {
  printStage10ProductSeedReport,
  seedStage10ProductsAndBackfill,
} = require('../prisma/stage10-product-seed');

async function main() {
  const prisma = new PrismaClient();
  try {
    const admin = await prisma.user.findUnique({
      where: { username: 'admin' },
      select: { id: true },
    });
    const report = await seedStage10ProductsAndBackfill(prisma, {
      actorUserId: admin?.id || null,
    });
    printStage10ProductSeedReport(report);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { main };
