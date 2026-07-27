const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const databaseUrl = process.env.INVENTORY_TEST_DATABASE_URL;
const isolatedDatabaseConfirmed =
  process.env.INVENTORY_TEST_DATABASE_CONFIRMED === '1';
const databaseName = safeDatabaseName(databaseUrl);
const safeDatabaseNamePattern = /(test|testing|ci|local)/i;
const shouldRun = Boolean(
  databaseUrl &&
    isolatedDatabaseConfirmed &&
    databaseName &&
    safeDatabaseNamePattern.test(databaseName) &&
    !/(prod|production)/i.test(databaseName),
);

test(
  'mysql integration: two orders cannot reserve the same serialized unit concurrently',
  {
    skip: shouldRun
      ? false
      : 'requires a confirmed isolated test database whose name contains test/testing/ci/local',
  },
  async () => {
    const { Prisma, PrismaClient } = require('@prisma/client');
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

    const clients = [
      new PrismaClient({ datasources: { db: { url: databaseUrl } } }),
      new PrismaClient({ datasources: { db: { url: databaseUrl } } }),
    ];
    const adapters = clients.map((prisma) => {
      const repository = new InventoryPrismaRepository(prisma);
      return new SerializedInventoryAccountingAdapter(
        repository,
        new OperationLogsNestService(prisma),
        new InventoryPostCommitService(
          repository,
          new InventoryPostCommitProjector(),
        ),
      );
    });
    const suffix = crypto.randomUUID().replace(/-/g, '');
    const warehouseId = crypto.randomUUID();
    const productId = crypto.randomUUID();
    const unitId = crypto.randomUUID();
    const orderIds = [crypto.randomUUID(), crypto.randomUUID()];
    const itemIds = [crypto.randomUUID(), crypto.randomUUID()];
    const reservationIds = [crypto.randomUUID(), crypto.randomUUID()];
    const sourcePrefix = `mysql-serialized-${suffix}`;
    const actor = {
      id: null,
      name: 'Isolated serialized concurrency test',
      role: 'warehouse',
    };

    try {
      const prisma = clients[0];
      await prisma.warehouse.create({
        data: {
          id: warehouseId,
          code: `SER-${suffix.slice(0, 12)}`,
          normalizedCode: `ser-${suffix}`,
          name: `Serialized test ${suffix}`,
          normalizedName: `serializedtest${suffix}`,
          isActive: true,
          isDefault: false,
          activeDefaultKey: null,
        },
      });
      await prisma.product.create({
        data: {
          id: productId,
          name: `Serialized product ${suffix}`,
          normalizedName: `serializedproduct${suffix}`,
          unit: 'bottle',
          inventoryTrackingMode: 'SERIALIZED',
          isActive: true,
        },
      });
      await prisma.warehouseProductStock.create({
        data: {
          warehouseId,
          productId,
          onHandQty: 1,
          reservedQty: 2,
          unavailableQty: 0,
          inTransitQty: 0,
        },
      });
      for (let index = 0; index < 2; index += 1) {
        await prisma.salesOrder.create({
          data: {
            id: orderIds[index],
            orderNo: `SER-MYSQL-${suffix.slice(0, 16)}-${index + 1}`,
            orderType: 'DIRECT',
            customerName: 'Isolated test customer',
            orderDate: new Date('2026-07-27T00:00:00.000Z'),
            totalAmountCents: 1,
            packingStatus: 'PENDING',
            status: 'VALID',
            fulfillmentWarehouseId: warehouseId,
            inventoryAppliedAt: new Date(),
            inventoryPolicyVersion: 1,
            items: {
              create: {
                id: itemIds[index],
                inventoryLineKey: `${sourcePrefix}:line:${index + 1}`,
                productId,
                productName: `Serialized product ${suffix}`,
                unit: 'bottle',
                quantity: 1,
                unitPriceCents: 1,
                subtotalCents: 1,
                deliveryType: 'SHIPPING',
              },
            },
          },
        });
        await prisma.inventoryReservation.create({
          data: {
            id: reservationIds[index],
            sourceKey: `${sourcePrefix}:reservation:${index + 1}`,
            salesOrderId: orderIds[index],
            salesOrderItemId: itemIds[index],
            inventoryLineKey: `${sourcePrefix}:line:${index + 1}`,
            warehouseId,
            productId,
            requestedQty: 1,
            reservedQty: 1,
            assignedQty: 0,
            outboundQty: 0,
            status: 'RESERVED',
          },
        });
      }
      await prisma.serializedInventoryUnit.create({
        data: {
          id: unitId,
          productId,
          warehouseId,
          moutaiName: 'Concurrency bottle',
          normalizedMoutaiName: 'concurrencybottle',
          factoryDate: new Date('2026-01-01T00:00:00.000Z'),
          productionBatch: '00001',
          batchSerialNo: '000001',
          logisticsCode: `000${suffix}`,
          normalizedLogisticsCode: `000${suffix}`.toLowerCase(),
          purchaseCostCents: 1,
          status: 'AVAILABLE',
          version: 0,
        },
      });

      const attempts = adapters.map((adapter, index) =>
        clients[index].$transaction(
          async (transaction) =>
            await adapter.assignReservationUnitsInTransaction(
              transaction,
              actor,
              {
                reservationId: reservationIds[index],
                unitIds: [unitId],
                outbound: false,
                sourceKey: `${sourcePrefix}:assign:${index + 1}`,
              },
            ),
          {
            isolationLevel:
              Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 5_000,
            timeout: 15_000,
          },
        ),
      );
      const settled = await Promise.allSettled(attempts);
      assert.equal(
        settled.filter((result) => result.status === 'fulfilled')
          .length,
        1,
      );
      assert.equal(
        settled.filter((result) => result.status === 'rejected')
          .length,
        1,
      );

      const savedUnit =
        await prisma.serializedInventoryUnit.findUnique({
          where: { id: unitId },
        });
      const activeAssignments =
        await prisma.serializedInventoryAssignment.findMany({
          where: { activeUnitKey: unitId, status: 'RESERVED' },
        });
      assert.equal(savedUnit.status, 'RESERVED');
      assert.equal(savedUnit.version, 1);
      assert.equal(activeAssignments.length, 1);
      assert.equal(
        reservationIds.includes(activeAssignments[0].reservationId),
        true,
      );
    } finally {
      const prisma = clients[0];
      await prisma.operationLog.deleteMany({
        where: {
          module: 'inventory',
          entityId: unitId,
        },
      });
      await prisma.inventoryPostCommitTask.deleteMany({
        where: { sourceKey: { startsWith: sourcePrefix } },
      });
      await prisma.inventoryMovement.deleteMany({
        where: { sourceKey: { startsWith: sourcePrefix } },
      });
      await prisma.serializedInventoryAssignment.deleteMany({
        where: { sourceKey: { startsWith: sourcePrefix } },
      });
      await prisma.inventoryCommandReceipt.deleteMany({
        where: { sourceKey: { startsWith: sourcePrefix } },
      });
      await prisma.inventoryDocumentLine.deleteMany({
        where: {
          document: { sourceKey: { startsWith: sourcePrefix } },
        },
      });
      await prisma.inventoryDocument.deleteMany({
        where: { sourceKey: { startsWith: sourcePrefix } },
      });
      await prisma.inventoryReservation.deleteMany({
        where: { id: { in: reservationIds } },
      });
      await prisma.serializedInventoryUnit.deleteMany({
        where: { id: unitId },
      });
      await prisma.salesOrder.deleteMany({
        where: { id: { in: orderIds } },
      });
      await prisma.warehouseProductStock.deleteMany({
        where: { warehouseId, productId },
      });
      await prisma.product.deleteMany({ where: { id: productId } });
      await prisma.warehouse.deleteMany({ where: { id: warehouseId } });
      await Promise.all(clients.map((client) => client.$disconnect()));
    }
  },
);

function safeDatabaseName(url) {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  } catch {
    return null;
  }
}
