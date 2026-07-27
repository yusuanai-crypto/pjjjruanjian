const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const databaseUrl = process.env.INVENTORY_TEST_DATABASE_URL;
const isolatedDatabaseConfirmed =
  process.env.INVENTORY_TEST_DATABASE_CONFIRMED === '1';
const shouldRun = Boolean(databaseUrl && isolatedDatabaseConfirmed);

test(
  'mysql integration: concurrent default-warehouse selection succeeds once',
  {
    skip: shouldRun
      ? false
      : 'requires INVENTORY_TEST_DATABASE_URL and INVENTORY_TEST_DATABASE_CONFIRMED=1',
  },
  async () => {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const warehouseIds = [crypto.randomUUID(), crypto.randomUUID()];

    try {
      const existingDefaultCount = await prisma.warehouse.count({
        where: { activeDefaultKey: 'ACTIVE_DEFAULT' },
      });
      assert.equal(
        existingDefaultCount,
        0,
        'the explicitly confirmed isolated database must not have a default warehouse',
      );

      await prisma.warehouse.createMany({
        data: warehouseIds.map((id, index) => ({
          id,
          code: `TEST-${suffix}-${index + 1}`,
          normalizedCode: `test-${suffix}-${index + 1}`,
          name: `并发默认仓测试 ${suffix}-${index + 1}`,
          normalizedName: `并发默认仓测试${suffix}-${index + 1}`,
          isActive: true,
          isDefault: false,
          activeDefaultKey: null,
        })),
      });

      const results = await Promise.allSettled(
        warehouseIds.map((id) =>
          prisma.warehouse.update({
            where: { id },
            data: {
              isActive: true,
              isDefault: true,
              activeDefaultKey: 'ACTIVE_DEFAULT',
            },
          }),
        ),
      );

      assert.equal(
        results.filter((result) => result.status === 'fulfilled').length,
        1,
      );
      const rejected = results.find((result) => result.status === 'rejected');
      assert.ok(rejected);
      assert.equal(rejected.reason?.code, 'P2002');
      assert.equal(
        await prisma.warehouse.count({
          where: {
            id: { in: warehouseIds },
            activeDefaultKey: 'ACTIVE_DEFAULT',
          },
        }),
        1,
      );
    } finally {
      await prisma.warehouse.updateMany({
        where: { id: { in: warehouseIds } },
        data: {
          isDefault: false,
          activeDefaultKey: null,
        },
      });
      await prisma.warehouse.deleteMany({
        where: { id: { in: warehouseIds } },
      });
      await prisma.$disconnect();
    }
  },
);
