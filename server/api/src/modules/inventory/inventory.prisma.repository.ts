import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export type InventoryTransaction = any;

@Injectable()
export class InventoryPrismaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async runInTransaction<T>(
    work: (transaction: InventoryTransaction) => Promise<T>,
  ): Promise<T> {
    return await this.prisma.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 15_000,
    });
  }

  async findCommandReceipt(idempotencyKey: string, db: any = this.prisma) {
    return await db.inventoryCommandReceipt.findUnique({
      where: { idempotencyKey },
    });
  }

  async findCommandReceiptBySourceKey(
    sourceKey: string,
    db: any = this.prisma,
  ) {
    return await db.inventoryCommandReceipt.findUnique({
      where: { sourceKey },
    });
  }

  async createCommandReceipt(transaction: any, data: any) {
    return await transaction.inventoryCommandReceipt.create({ data });
  }

  async completeCommandReceipt(
    transaction: any,
    id: string,
    resultDocumentId: string | null,
    resultSnapshot: any,
  ) {
    return await transaction.inventoryCommandReceipt.update({
      where: { id },
      data: {
        status: 'SUCCEEDED',
        resultDocumentId,
        resultSnapshot,
        completedAt: new Date(),
        errorCode: null,
      },
    });
  }

  async findProduct(transaction: any, id: string) {
    return await transaction.product.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        unit: true,
        isActive: true,
        inventoryTrackingMode: true,
      },
    });
  }

  async findWarehouse(transaction: any, id: string) {
    return await transaction.warehouse.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        isActive: true,
      },
    });
  }

  async findInventoryConfiguration(transaction: any) {
    return await transaction.inventoryConfiguration.findUnique({
      where: { singletonKey: 'INVENTORY' },
      select: {
        id: true,
        singletonKey: true,
        goLiveAt: true,
        policyVersion: true,
        maintenanceMode: true,
      },
    });
  }

  async findStock(
    transaction: any,
    warehouseId: string,
    productId: string,
  ) {
    return await transaction.warehouseProductStock.findUnique({
      where: {
        warehouseId_productId: {
          warehouseId,
          productId,
        },
      },
    });
  }

  async getOrCreateStock(
    transaction: any,
    warehouseId: string,
    productId: string,
  ) {
    const existing = await this.findStock(
      transaction,
      warehouseId,
      productId,
    );
    if (existing) {
      return existing;
    }
    return await transaction.warehouseProductStock.create({
      data: {
        warehouseId,
        productId,
      },
    });
  }

  async updateStockWithVersion(
    transaction: any,
    stock: any,
    delta: InventoryStockDelta,
    lastMovementId: string,
  ) {
    return await transaction.warehouseProductStock.updateMany({
      where: {
        id: stock.id,
        version: stock.version,
      },
      data: {
        onHandQty: { increment: delta.onHandDelta },
        reservedQty: { increment: delta.reservedDelta },
        unavailableQty: { increment: delta.unavailableDelta },
        inTransitQty: { increment: delta.inTransitDelta },
        version: { increment: 1 },
        lastMovementId,
      },
    });
  }

  async findBatch(transaction: any, id: string) {
    return await transaction.inventoryBatch.findUnique({
      where: { id },
    });
  }

  async findBatchBySourceLineKey(
    transaction: any,
    sourceLineKey: string,
  ) {
    return await transaction.inventoryBatch.findUnique({
      where: { sourceLineKey },
      select: {
        id: true,
        sourceLineKey: true,
      },
    });
  }

  async findBatchByOpeningEntryKey(
    transaction: any,
    openingEntryKey: string,
  ) {
    return await transaction.inventoryBatch.findUnique({
      where: { openingEntryKey },
      select: {
        id: true,
        openingEntryKey: true,
      },
    });
  }

  async createBatch(transaction: any, data: any) {
    return await transaction.inventoryBatch.create({ data });
  }

  async updateBatchWithVersion(
    transaction: any,
    batch: any,
    delta: InventoryBatchDelta,
  ) {
    return await transaction.inventoryBatch.updateMany({
      where: {
        id: batch.id,
        version: batch.version,
      },
      data: {
        receivedQty: { increment: delta.receivedDelta },
        remainingQty: { increment: delta.remainingDelta },
        unavailableQty: { increment: delta.unavailableDelta },
        version: { increment: 1 },
      },
    });
  }

  async updateBatchCostWithVersion(
    transaction: any,
    batch: any,
    data: {
      purchaseUnitCostCents: number;
      unavailableDelta: number;
      actorUserId: string | null;
      actorName: string | null;
      actorRole: string | null;
      completedAt: Date | null;
      updatedById: string | null;
    },
  ) {
    return await transaction.inventoryBatch.updateMany({
      where: {
        id: batch.id,
        version: batch.version,
      },
      data: {
        purchaseUnitCostCents: data.purchaseUnitCostCents,
        costStatus: 'COMPLETE',
        unavailableQty: { increment: data.unavailableDelta },
        costCompletedById: data.actorUserId,
        costCompletedByName: data.actorName,
        costCompletedByRole: data.actorRole,
        costCompletedAt: data.completedAt,
        updatedById: data.updatedById,
        version: { increment: 1 },
      },
    });
  }

  async findReservation(transaction: any, id: string) {
    return await transaction.inventoryReservation.findUnique({
      where: { id },
    });
  }

  async findReservationByOrderLine(
    transaction: any,
    salesOrderId: string,
    inventoryLineKey: string,
  ) {
    return await transaction.inventoryReservation.findUnique({
      where: {
        salesOrderId_inventoryLineKey: {
          salesOrderId,
          inventoryLineKey,
        },
      },
    });
  }

  async createReservation(transaction: any, data: any) {
    return await transaction.inventoryReservation.create({ data });
  }

  async updateReservationWithVersion(
    transaction: any,
    reservation: any,
    data: any,
  ) {
    return await transaction.inventoryReservation.updateMany({
      where: {
        id: reservation.id,
        version: reservation.version,
      },
      data: {
        ...data,
        version: { increment: 1 },
      },
    });
  }

  async createDocument(transaction: any, data: any) {
    return await transaction.inventoryDocument.create({ data });
  }

  async createDocumentLine(transaction: any, data: any) {
    return await transaction.inventoryDocumentLine.create({ data });
  }

  async setDocumentLineBatch(
    transaction: any,
    documentLineId: string,
    batchId: string,
  ) {
    return await transaction.inventoryDocumentLine.update({
      where: { id: documentLineId },
      data: { batchId },
    });
  }

  async createMovement(transaction: any, data: any) {
    return await transaction.inventoryMovement.create({ data });
  }

  async createTransfer(transaction: any, data: any) {
    return await transaction.inventoryTransfer.create({ data });
  }

  async createTransferLine(transaction: any, data: any) {
    return await transaction.inventoryTransferLine.create({ data });
  }

  async findTransfer(transaction: any, id: string) {
    return await transaction.inventoryTransfer.findUnique({
      where: { id },
      include: {
        fromWarehouse: {
          select: { id: true, code: true, name: true, isActive: true },
        },
        toWarehouse: {
          select: { id: true, code: true, name: true, isActive: true },
        },
        lines: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                unit: true,
                isActive: true,
                inventoryTrackingMode: true,
              },
            },
          },
          orderBy: [{ lineNo: 'asc' }, { id: 'asc' }],
        },
        receipts: {
          where: { status: 'POSTED' },
          select: { id: true },
        },
      },
    });
  }

  async updateTransferWithVersion(
    transaction: any,
    transfer: any,
    data: any,
  ) {
    return await transaction.inventoryTransfer.updateMany({
      where: {
        id: transfer.id,
        version: transfer.version,
      },
      data: {
        ...data,
        version: { increment: 1 },
      },
    });
  }

  async updateTransferLineWithVersion(
    transaction: any,
    line: any,
    data: any,
  ) {
    return await transaction.inventoryTransferLine.updateMany({
      where: {
        id: line.id,
        version: line.version,
      },
      data: {
        ...data,
        version: { increment: 1 },
      },
    });
  }

  async createTransferReceipt(transaction: any, data: any) {
    return await transaction.inventoryTransferReceipt.create({ data });
  }

  async createTransferReceiptLine(transaction: any, data: any) {
    return await transaction.inventoryTransferReceiptLine.create({
      data,
    });
  }

  async findTransferReceipt(transaction: any, id: string) {
    return await transaction.inventoryTransferReceipt.findUnique({
      where: { id },
      include: {
        reversedByReceipt: {
          select: { id: true },
        },
        lines: {
          include: {
            transferLine: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    unit: true,
                    inventoryTrackingMode: true,
                  },
                },
              },
            },
          },
          orderBy: [{ lineNo: 'asc' }, { id: 'asc' }],
        },
        transfer: {
          include: {
            fromWarehouse: {
              select: {
                id: true,
                code: true,
                name: true,
                isActive: true,
              },
            },
            toWarehouse: {
              select: {
                id: true,
                code: true,
                name: true,
                isActive: true,
              },
            },
            lines: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    unit: true,
                    inventoryTrackingMode: true,
                  },
                },
              },
              orderBy: [{ lineNo: 'asc' }, { id: 'asc' }],
            },
          },
        },
      },
    });
  }

  async updateTransferReceiptWithVersion(
    transaction: any,
    receipt: any,
    data: any,
  ) {
    return await transaction.inventoryTransferReceipt.updateMany({
      where: {
        id: receipt.id,
        version: receipt.version,
      },
      data: {
        ...data,
        version: { increment: 1 },
      },
    });
  }

  async findDocumentForReversal(transaction: any, id: string) {
    return await transaction.inventoryDocument.findUnique({
      where: { id },
      include: {
        reversedByDocument: {
          select: { id: true },
        },
        lines: {
          orderBy: { lineNo: 'asc' },
          include: {
            movements: {
              orderBy: [{ businessAt: 'asc' }, { id: 'asc' }],
            },
          },
        },
      },
    });
  }

  async markDocumentReversed(
    transaction: any,
    documentId: string,
    actor: any,
    reversedAt: Date,
  ) {
    return await transaction.inventoryDocument.update({
      where: { id: documentId },
      data: {
        status: 'REVERSED',
        reversedById: actorId(actor),
        reversedByNameSnapshot: actorName(actor),
        reversedByRoleSnapshot: actorRole(actor),
        reversedAt,
        updatedById: actorId(actor),
      },
    });
  }

  async createPostCommitTask(transaction: any, data: any) {
    return await transaction.inventoryPostCommitTask.create({ data });
  }

  async findPostCommitTaskByReceipt(
    commandReceiptId: string,
    db: any = this.prisma,
  ) {
    return await db.inventoryPostCommitTask.findFirst({
      where: { commandReceiptId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async claimPostCommitTask(id: string) {
    const now = new Date();
    const claimed = await this.prisma.inventoryPostCommitTask.updateMany({
      where: {
        id,
        status: { in: ['PENDING', 'FAILED'] },
        nextAttemptAt: { lte: now },
      },
      data: {
        status: 'PROCESSING',
        attempts: { increment: 1 },
        lockedAt: now,
      },
    });
    if (claimed.count !== 1) {
      return null;
    }
    return await this.prisma.inventoryPostCommitTask.findUnique({
      where: { id },
    });
  }

  async completePostCommitTask(id: string) {
    return await this.prisma.inventoryPostCommitTask.update({
      where: { id },
      data: {
        status: 'SUCCEEDED',
        completedAt: new Date(),
        lockedAt: null,
        lastErrorCode: null,
      },
    });
  }

  async failPostCommitTask(
    id: string,
    lastErrorCode: string,
    nextAttemptAt: Date,
  ) {
    return await this.prisma.inventoryPostCommitTask.update({
      where: { id },
      data: {
        status: 'FAILED',
        lockedAt: null,
        lastErrorCode,
        nextAttemptAt,
      },
    });
  }

  async listDuePostCommitTasks(limit: number) {
    return await this.prisma.inventoryPostCommitTask.findMany({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        nextAttemptAt: { lte: new Date() },
      },
      select: { id: true },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
    });
  }

  async recoverStalePostCommitTasks(staleBefore: Date) {
    return await this.prisma.inventoryPostCommitTask.updateMany({
      where: {
        status: 'PROCESSING',
        lockedAt: { lte: staleBefore },
      },
      data: {
        status: 'FAILED',
        lockedAt: null,
        lastErrorCode: 'INVENTORY_POST_COMMIT_STALE_LOCK',
        nextAttemptAt: new Date(),
      },
    });
  }

  async listMovements(warehouseId: string, productId: string) {
    return await this.prisma.inventoryMovement.findMany({
      where: {
        warehouseId,
        productId,
      },
      include: {
        reversalOf: {
          select: {
            id: true,
            movementType: true,
          },
        },
      },
      orderBy: [{ businessAt: 'asc' }, { id: 'asc' }],
    });
  }

  async listBatches(warehouseId: string, productId: string) {
    return await this.prisma.inventoryBatch.findMany({
      where: {
        warehouseId,
        productId,
      },
      orderBy: [{ fifoAt: 'asc' }, { id: 'asc' }],
    });
  }

  async listBatchMovements(batchId: string) {
    return await this.prisma.inventoryMovement.findMany({
      where: { batchId },
      include: {
        reversalOf: {
          select: {
            id: true,
            movementType: true,
          },
        },
      },
      orderBy: [{ businessAt: 'asc' }, { id: 'asc' }],
    });
  }

  async countSerializedUnits(
    warehouseId: string,
    productId: string,
  ) {
    const groups = await this.prisma.serializedInventoryUnit.groupBy({
      by: ['status'],
      where: {
        warehouseId,
        productId,
      },
      _count: { _all: true },
    });
    return Object.fromEntries(
      groups.map((group: any) => [group.status, group._count._all]),
    );
  }

  async listSerializedConsistencyRows(
    warehouseId: string,
    productId: string,
  ) {
    const [units, reservations] = await Promise.all([
      this.prisma.serializedInventoryUnit.findMany({
        where: {
          warehouseId,
          productId,
        },
        select: {
          id: true,
          warehouseId: true,
          productId: true,
          status: true,
          purchaseCostCents: true,
          assignments: {
            select: {
              id: true,
              reservationId: true,
              status: true,
              activeUnitKey: true,
            },
            orderBy: [{ reservedAt: 'asc' }, { id: 'asc' }],
          },
          inventoryMovements: {
            select: {
              id: true,
              warehouseId: true,
              productId: true,
              reservationId: true,
              movementType: true,
              reversalOfMovementId: true,
              reversedByMovement: {
                select: { id: true },
              },
            },
            orderBy: [{ businessAt: 'asc' }, { id: 'asc' }],
          },
        },
        orderBy: { id: 'asc' },
      }),
      this.prisma.inventoryReservation.findMany({
        where: {
          warehouseId,
          productId,
        },
        select: {
          id: true,
          warehouseId: true,
          productId: true,
          assignedQty: true,
          outboundQty: true,
          assignments: {
            select: {
              id: true,
              serializedUnitId: true,
              status: true,
              activeUnitKey: true,
            },
          },
        },
        orderBy: { id: 'asc' },
      }),
    ]);
    return { units, reservations };
  }

  root() {
    return this.prisma;
  }
}

export interface InventoryStockDelta {
  onHandDelta: number;
  reservedDelta: number;
  unavailableDelta: number;
  inTransitDelta: number;
}

export interface InventoryBatchDelta {
  receivedDelta: number;
  remainingDelta: number;
  unavailableDelta: number;
}

export function actorId(actor: any) {
  const value = typeof actor?.id === 'string' ? actor.id.trim() : '';
  return value || null;
}

export function actorName(actor: any) {
  const value =
    typeof actor?.name === 'string'
      ? actor.name.trim()
      : typeof actor?.username === 'string'
        ? actor.username.trim()
        : '';
  return value.slice(0, 100) || null;
}

export function actorRole(actor: any) {
  const value =
    typeof actor?.role === 'string' ? actor.role.trim().toLowerCase() : '';
  return value.slice(0, 32) || null;
}
