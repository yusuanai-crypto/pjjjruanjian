const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const databaseUrl = process.env.INVENTORY_TEST_DATABASE_URL;
const isolatedDatabaseConfirmed =
  process.env.INVENTORY_TEST_DATABASE_CONFIRMED === '1';
const shouldRun = Boolean(databaseUrl && isolatedDatabaseConfirmed);

test(
  'mysql integration: concurrent inventory commands do not lose updates and posted movements are immutable',
  {
    skip: shouldRun
      ? false
      : 'requires INVENTORY_TEST_DATABASE_URL and INVENTORY_TEST_DATABASE_CONFIRMED=1',
  },
  async () => {
    const { PrismaClient } = require('@prisma/client');
    const {
      InventoryAccountingService,
    } = require('../src/modules/inventory/inventory-accounting.service');
    const {
      calculateInventoryRequestHash,
    } = require('../src/modules/inventory/inventory-command.policy');
    const {
      InventoryPostCommitProjector,
      InventoryPostCommitService,
    } = require('../src/modules/inventory/inventory-post-commit.service');
    const {
      InventoryPrismaRepository,
    } = require('../src/modules/inventory/inventory.prisma.repository');
    const {
      SerializedInventoryAccountingAdapter,
    } = require('../src/modules/inventory/serialized-inventory-accounting.adapter');
    const {
      OperationLogsNestService,
    } = require('../src/modules/operation-logs/operation-log.nest.service');

    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    const repository = new InventoryPrismaRepository(prisma);
    const postCommit = new InventoryPostCommitService(
      repository,
      new InventoryPostCommitProjector(),
    );
    const service = new InventoryAccountingService(
      repository,
      new OperationLogsNestService(prisma),
      postCommit,
      new SerializedInventoryAccountingAdapter(),
    );
    const actor = {
      id: null,
      name: 'Isolated MySQL inventory test',
      role: 'admin',
    };
    const suffix = crypto.randomUUID().replace(/-/g, '');
    const warehouseId = crypto.randomUUID();
    const productId = crypto.randomUUID();

    try {
      await prisma.warehouse.create({
        data: {
          id: warehouseId,
          code: `INV-${suffix.slice(0, 12)}`,
          normalizedCode: `inv-${suffix}`,
          name: `Inventory integration ${suffix}`,
          normalizedName: `inventoryintegration${suffix}`,
          isActive: true,
          isDefault: false,
          activeDefaultKey: null,
        },
      });
      await prisma.product.create({
        data: {
          id: productId,
          name: `Inventory integration product ${suffix}`,
          normalizedName: `inventoryintegrationproduct${suffix}`,
          unit: 'bottle',
          inventoryTrackingMode: 'QUANTITY',
          isActive: true,
        },
      });

      const payloads = [1, 2].map((index) => {
        const body = {
          sourceKey: `mysql:${suffix}:source:${index}`,
          idempotencyKey: `mysql:${suffix}:idem:${index}`,
          warehouseId,
          productId,
          quantity: 1,
        };
        return {
          ...body,
          requestHash: calculateInventoryRequestHash('INBOUND', body),
        };
      });
      const results = await Promise.all(
        payloads.map((body) => service.inbound(actor, body)),
      );
      assert.equal(results.length, 2);
      const stock = await prisma.warehouseProductStock.findUnique({
        where: {
          warehouseId_productId: {
            warehouseId,
            productId,
          },
        },
      });
      assert.equal(stock.onHandQty, 2);
      assert.equal(stock.version, 2);

      const movement = await prisma.inventoryMovement.findFirst({
        where: {
          warehouseId,
          productId,
        },
        orderBy: { createdAt: 'asc' },
      });
      await assert.rejects(
        prisma.inventoryMovement.update({
          where: { id: movement.id },
          data: { onHandDelta: 999 },
        }),
      );
      await assert.rejects(
        prisma.inventoryMovement.delete({
          where: { id: movement.id },
        }),
      );
    } finally {
      await prisma.$disconnect();
    }
  },
);
