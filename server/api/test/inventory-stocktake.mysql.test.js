const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const databaseUrl = process.env.INVENTORY_TEST_DATABASE_URL;
const isolatedDatabaseConfirmed =
  process.env.INVENTORY_TEST_DATABASE_CONFIRMED === '1';
const shouldRun = Boolean(databaseUrl && isolatedDatabaseConfirmed);

test(
  'mysql integration: concurrent active stocktakes for one warehouse-product have one winner',
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
    const suffix = crypto.randomUUID().replace(/-/g, '');
    const warehouseId = crypto.randomUUID();
    const productId = crypto.randomUUID();
    const activeKey = `${warehouseId}:${productId}`;

    try {
      await prisma.warehouse.create({
        data: {
          id: warehouseId,
          code: `STK-${suffix.slice(0, 12)}`,
          normalizedCode: `stk-${suffix}`,
          name: `Stocktake MySQL ${suffix}`,
          normalizedName: `stocktakemysql${suffix}`,
          isActive: true,
          isDefault: false,
          activeDefaultKey: null,
        },
      });
      await prisma.product.create({
        data: {
          id: productId,
          name: `Stocktake MySQL product ${suffix}`,
          normalizedName: `stocktakemysqlproduct${suffix}`,
          unit: 'bottle',
          inventoryTrackingMode: 'QUANTITY',
          isActive: true,
        },
      });

      const results = await Promise.allSettled(
        [1, 2].map((index) =>
          prisma.stocktake.create({
            data: {
              stocktakeNo: `STK-MYSQL-${suffix.slice(0, 16)}-${index}`,
              warehouseId,
              productId,
              trackingModeSnapshot: 'QUANTITY',
              status: 'DRAFT',
              activeKey,
              sourceKey: `stocktake:mysql:${suffix}:${index}`,
              idempotencyKey: `stocktake:mysql:${suffix}:${index}:idem`,
              requestHash: crypto
                .createHash('sha256')
                .update(`${suffix}:${index}`)
                .digest('hex'),
            },
          }),
        ),
      );
      assert.equal(
        results.filter((result) => result.status === 'fulfilled').length,
        1,
      );
      const rejected = results.find(
        (result) => result.status === 'rejected',
      );
      assert.equal(rejected.reason?.code, 'P2002');
      assert.equal(
        await prisma.stocktake.count({
          where: { warehouseId, productId, activeKey },
        }),
        1,
      );
    } finally {
      await prisma.stocktake.deleteMany({
        where: { warehouseId, productId },
      });
      await prisma.product.deleteMany({ where: { id: productId } });
      await prisma.warehouse.deleteMany({ where: { id: warehouseId } });
      await prisma.$disconnect();
    }
  },
);
