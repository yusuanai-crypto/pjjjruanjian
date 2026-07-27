import { Inject, Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import {
  TODO_REMINDERS_RECONCILER,
  TodoRemindersReconciler,
} from '../todo-reminders/todo-reminders.tokens';
import {
  requireInventoryRead,
  requireInventoryStocktakeApprove,
  requireInventoryStocktakeWrite,
  normalizedInventoryRole,
} from './inventory-access.policy';
import { InventoryAccountingService } from './inventory-accounting.service';
import {
  calculateInventoryRequestHash,
  canonicalJson,
  normalizedBusinessKey,
  optionalBoundedString,
  requiredId,
} from './inventory-command.policy';
import {
  actorId,
  actorName,
  actorRole,
  InventoryPrismaRepository,
} from './inventory.prisma.repository';
import { SerializedInventoryAccountingAdapter } from './serialized-inventory-accounting.adapter';

const MAX_CONCURRENCY_ATTEMPTS = 3;
const SERIALIZED_SNAPSHOT_STATUSES = [
  'PENDING_COST',
  'AVAILABLE',
  'ALLOCATED',
  'RESERVED',
  'UNAVAILABLE',
];

@Injectable()
export class InventoryStocktakeService {
  constructor(
    private readonly repository: InventoryPrismaRepository,
    private readonly accounting: InventoryAccountingService,
    private readonly serializedAdapter: SerializedInventoryAccountingAdapter,
    private readonly operationLogs: OperationLogsNestService,
    @Inject(TODO_REMINDERS_RECONCILER)
    private readonly todoReminders: TodoRemindersReconciler,
  ) {}

  async list(actor: any, query: any = {}) {
    requireInventoryRead(actor);
    const page = positivePage(query?.page, 1);
    const pageSize = Math.min(100, positivePage(query?.pageSize, 20));
    const where: any = {};
    if (query?.warehouseId) {
      where.warehouseId = requiredId(query.warehouseId, 'warehouseId');
    }
    if (query?.productId) {
      where.productId = requiredId(query.productId, 'productId');
    }
    if (query?.status) {
      where.status = normalizedStatus(query.status);
    }
    const database: any = this.repository.root();
    const [rows, total] = await Promise.all([
      database.stocktake.findMany({
        where,
        include: stocktakeInclude(false),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      database.stocktake.count({ where }),
    ]);
    return {
      data: rows.map((row: any) => projectStocktake(row, actor)),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async get(actor: any, id: string) {
    requireInventoryRead(actor);
    const row = await (this.repository.root() as any).stocktake.findUnique({
      where: { id: requiredId(id, 'stocktakeId') },
      include: stocktakeInclude(canReadSerializedScans(actor)),
    });
    if (!row) {
      throw notFoundError();
    }
    return projectStocktake(row, actor);
  }

  async create(actor: any, input: any, metadata: any = {}) {
    requireInventoryStocktakeWrite(actor);
    assertAllowedFields(input, [
      'warehouseId',
      'productId',
      'sourceKey',
      'idempotencyKey',
      'requestHash',
    ]);
    const warehouseId = requiredId(input?.warehouseId, 'warehouseId');
    const productId = requiredId(input?.productId, 'productId');
    const envelope = stocktakeEnvelope('STOCKTAKE_CREATE', input, {
      warehouseId,
      productId,
    });
    const outcome = await this.executeCommand(
      'STOCKTAKE_CREATE',
      actor,
      envelope,
      metadata,
      async (transaction, receipt) => {
        const [warehouse, product] = await Promise.all([
          this.repository.findWarehouse(transaction, warehouseId),
          this.repository.findProduct(transaction, productId),
        ]);
        if (!warehouse?.isActive) {
          throw createHttpError(
            404,
            'INVENTORY_WAREHOUSE_NOT_FOUND',
            'The active inventory warehouse does not exist.',
          );
        }
        if (!product?.isActive) {
          throw createHttpError(
            404,
            'INVENTORY_PRODUCT_NOT_FOUND',
            'The active inventory product does not exist.',
          );
        }
        if (product.inventoryTrackingMode === 'NONE') {
          throw createHttpError(
            409,
            'INVENTORY_TRACKING_DISABLED',
            'A NONE product cannot be stocktaken.',
          );
        }
        const stocktake = await transaction.stocktake.create({
          data: {
            stocktakeNo: stocktakeNumber(receipt.id),
            warehouseId,
            productId,
            trackingModeSnapshot: product.inventoryTrackingMode,
            status: 'DRAFT',
            activeKey: activeStocktakeKey(warehouseId, productId),
            sourceKey: envelope.sourceKey,
            idempotencyKey: envelope.idempotencyKey,
            requestHash: envelope.requestHash,
            createdById: actorId(actor),
            updatedById: actorId(actor),
          },
        });
        await transaction.stocktakeLine.create({
          data: { stocktakeId: stocktake.id, lineNo: 1 },
        });
        return commandResult(
          stocktake.id,
          null,
          {
            status: 'DRAFT',
            warehouseId,
            productId,
          },
          'inventory.stocktake.created',
          null,
          {
            stocktakeId: stocktake.id,
            status: 'draft',
            warehouseId,
            productId,
            trackingMode: product.inventoryTrackingMode,
          },
        );
      },
    );
    return {
      stocktake: await this.get(actor, outcome.stocktakeId),
      replayed: outcome.replayed,
    };
  }

  async submit(
    actor: any,
    stocktakeId: string,
    input: any,
    metadata: any = {},
  ) {
    requireInventoryStocktakeWrite(actor);
    assertAllowedFields(input, [
      'reason',
      'countedOnHandQty',
      'countedUnavailableQty',
      'scans',
      'sourceKey',
      'idempotencyKey',
      'requestHash',
    ]);
    const id = requiredId(stocktakeId, 'stocktakeId');
    const reason = requiredReason(input?.reason, 'reason');
    const normalizedInputScans = normalizeSubmittedScans(input?.scans);
    const envelope = stocktakeEnvelope('STOCKTAKE_SUBMIT', input, {
      stocktakeId: id,
      reason,
      countedOnHandQty: input?.countedOnHandQty ?? null,
      countedUnavailableQty: input?.countedUnavailableQty ?? null,
      scans: normalizedInputScans,
    });
    const outcome = await this.executeCommand(
      'STOCKTAKE_SUBMIT',
      actor,
      envelope,
      metadata,
      async (transaction) => {
        const stocktake = await loadStocktake(transaction, id, true);
        if (stocktake.status !== 'DRAFT') {
          throw invalidStateError(
            'Only a draft stocktake can be submitted.',
          );
        }
        const stock = await this.repository.findStock(
          transaction,
          stocktake.warehouseId,
          stocktake.productId,
        );
        const snapshot = stockSnapshot(stock);
        let countedOnHandQty: number;
        let countedUnavailableQty: number;
        let fingerprint: string | null = null;
        let scanFacts: any[] = [];
        if (stocktake.trackingModeSnapshot === 'QUANTITY') {
          if (input?.scans !== undefined) {
            throw validationError(
              'scans is only valid for a SERIALIZED stocktake.',
            );
          }
          countedOnHandQty = nonNegativeInteger(
            input?.countedOnHandQty,
            'countedOnHandQty',
          );
          countedUnavailableQty = nonNegativeInteger(
            input?.countedUnavailableQty,
            'countedUnavailableQty',
          );
          if (countedUnavailableQty > countedOnHandQty) {
            throw validationError(
              'countedUnavailableQty cannot exceed countedOnHandQty.',
            );
          }
        } else if (stocktake.trackingModeSnapshot === 'SERIALIZED') {
          if (
            input?.countedOnHandQty !== undefined ||
            input?.countedUnavailableQty !== undefined
          ) {
            throw validationError(
              'Serialized stocktake totals are derived from bottle scans.',
            );
          }
          scanFacts = await buildSerializedScanFacts(
            transaction,
            stocktake,
            normalizedInputScans,
            envelope.sourceKey,
          );
          countedOnHandQty = scanFacts.filter(
            (fact) => fact.matchStatus === 'MATCHED',
          ).length;
          countedUnavailableQty = scanFacts.filter(
            (fact) =>
              fact.matchStatus === 'MATCHED' &&
              fact.countedCondition === 'UNAVAILABLE',
          ).length;
          fingerprint = serializedFingerprint(scanFacts);
        } else {
          throw createHttpError(
            409,
            'INVENTORY_TRACKING_DISABLED',
            'A NONE product cannot be stocktaken.',
          );
        }
        await transaction.stocktakeLine.update({
          where: { stocktakeId: id },
          data: {
            snapshotStockVersion: snapshot.version,
            snapshotLastMovementId: snapshot.lastMovementId,
            snapshotOnHandQty: snapshot.onHandQty,
            snapshotUnavailableQty: snapshot.unavailableQty,
            snapshotSerializedFingerprint: fingerprint,
            countedOnHandQty,
            countedUnavailableQty,
            onHandDifferenceQty:
              countedOnHandQty - snapshot.onHandQty,
            unavailableDifferenceQty:
              countedUnavailableQty - snapshot.unavailableQty,
          },
        });
        for (const [index, fact] of scanFacts.entries()) {
          await transaction.stocktakeSerializedScan.create({
            data: {
              ...fact,
              stocktakeId: id,
              lineNo: index + 1,
            },
          });
        }
        const now = new Date();
        const changed = await transaction.stocktake.updateMany({
          where: {
            id,
            status: 'DRAFT',
            version: stocktake.version,
            activeKey: activeStocktakeKey(
              stocktake.warehouseId,
              stocktake.productId,
            ),
          },
          data: {
            status: 'SUBMITTED',
            submitSourceKey: envelope.sourceKey,
            submitIdempotencyKey: envelope.idempotencyKey,
            submitRequestHash: envelope.requestHash,
            reason,
            submittedById: actorId(actor),
            submittedByNameSnapshot: actorName(actor),
            submittedByRoleSnapshot: actorRole(actor),
            submittedAt: now,
            updatedById: actorId(actor),
            version: { increment: 1 },
          },
        });
        assertSingleUpdate(changed);
        return commandResult(
          id,
          null,
          {
            status: 'SUBMITTED',
            snapshot,
            countedOnHandQty,
            countedUnavailableQty,
          },
          'inventory.stocktake.submitted',
          { stocktakeId: id, status: 'draft' },
          {
            stocktakeId: id,
            status: 'submitted',
            snapshot,
            countedOnHandQty,
            countedUnavailableQty,
            scanSummary: summarizeScans(scanFacts),
          },
        );
      },
    );
    await this.todoReminders?.safeReconcileSource(
      'STOCKTAKE',
      outcome.stocktakeId,
    );
    return {
      stocktake: await this.get(actor, outcome.stocktakeId),
      replayed: outcome.replayed,
    };
  }

  async approve(
    actor: any,
    stocktakeId: string,
    input: any,
    metadata: any = {},
  ) {
    requireInventoryStocktakeApprove(actor);
    assertAllowedFields(input, [
      'sourceKey',
      'idempotencyKey',
      'requestHash',
    ]);
    const id = requiredId(stocktakeId, 'stocktakeId');
    const envelope = stocktakeEnvelope('STOCKTAKE_APPROVE', input, {
      stocktakeId: id,
    });
    const outcome = await this.executeCommand(
      'STOCKTAKE_APPROVE',
      actor,
      envelope,
      metadata,
      async (transaction) => {
        const stocktake = await loadStocktake(transaction, id, true);
        if (stocktake.status !== 'SUBMITTED') {
          throw invalidStateError(
            'Only a submitted stocktake can be approved.',
          );
        }
        assertSubmittedSnapshot(stocktake.line);
        const current = stockSnapshot(
          await this.repository.findStock(
            transaction,
            stocktake.warehouseId,
            stocktake.productId,
          ),
        );
        assertStockSnapshotUnchanged(stocktake.line, current);
        const childReceiptIds: string[] = [];
        let quantityDocumentId: string | null = null;
        let unavailableDocumentId: string | null = null;
        if (stocktake.trackingModeSnapshot === 'QUANTITY') {
          const results = await this.applyQuantityStocktake(
            transaction,
            actor,
            stocktake,
            envelope,
            metadata,
          );
          quantityDocumentId = results.quantityDocumentId;
          unavailableDocumentId = results.unavailableDocumentId;
          childReceiptIds.push(...results.commandReceiptIds);
        } else if (stocktake.trackingModeSnapshot === 'SERIALIZED') {
          assertSerializedSnapshotMatchesAggregate(stocktake);
          const result =
            await this.serializedAdapter.postStocktakeInTransaction(
              transaction,
              actor,
              {
                stocktakeId: id,
                warehouseId: stocktake.warehouseId,
                productId: stocktake.productId,
                sourceKey: childKey(envelope.sourceKey, 'serialized-post'),
                idempotencyKey: childKey(
                  envelope.idempotencyKey,
                  'serialized-post',
                ),
                reason: stocktake.reason,
              },
              metadata,
            );
          quantityDocumentId = result.documentId ?? null;
          if (result.commandReceiptId) {
            childReceiptIds.push(result.commandReceiptId);
          }
        }
        const now = new Date();
        await this.operationLogs.appendLog(
          {
            userId: actorId(actor),
            actorNameSnapshot: actorName(actor),
            actorRoleSnapshot: actorRole(actor),
            action: 'inventory.stocktake.approved',
            module: 'inventory',
            operationType: 'REVIEW',
            entityType: 'stocktake',
            entityId: id,
            beforeData: { stocktakeId: id, status: 'submitted' },
            afterData: {
              stocktakeId: id,
              status: 'approved',
              onHandDifferenceQty:
                stocktake.line.onHandDifferenceQty,
              unavailableDifferenceQty:
                stocktake.line.unavailableDifferenceQty,
            },
            requestSummary: {
              sourceKey: envelope.sourceKey,
              idempotencyKey: envelope.idempotencyKey,
            },
            requestId: boundedTraceId(metadata?.requestId),
            ipAddress: boundedIp(metadata?.ipAddress),
          },
          transaction,
        );
        const changed = await transaction.stocktake.updateMany({
          where: {
            id,
            status: 'SUBMITTED',
            version: stocktake.version,
            activeKey: activeStocktakeKey(
              stocktake.warehouseId,
              stocktake.productId,
            ),
          },
          data: {
            status: 'POSTED',
            activeKey: null,
            approveSourceKey: envelope.sourceKey,
            approveIdempotencyKey: envelope.idempotencyKey,
            approveRequestHash: envelope.requestHash,
            approvedById: actorId(actor),
            approvedByNameSnapshot: actorName(actor),
            approvedByRoleSnapshot: actorRole(actor),
            approvedAt: now,
            postedById: actorId(actor),
            postedByNameSnapshot: actorName(actor),
            postedByRoleSnapshot: actorRole(actor),
            postedAt: now,
            quantityDocumentId,
            unavailableDocumentId,
            updatedById: actorId(actor),
            version: { increment: 1 },
          },
        });
        assertSingleUpdate(changed);
        return {
          ...commandResult(
            id,
            quantityDocumentId ?? unavailableDocumentId,
            {
              status: 'POSTED',
              quantityDocumentId,
              unavailableDocumentId,
              commandReceiptIds: childReceiptIds,
            },
            'inventory.stocktake.posted',
            { stocktakeId: id, status: 'submitted' },
            {
              stocktakeId: id,
              status: 'posted',
              onHandDifferenceQty:
                stocktake.line.onHandDifferenceQty,
              unavailableDifferenceQty:
                stocktake.line.unavailableDifferenceQty,
              quantityDocumentId,
              unavailableDocumentId,
            },
          ),
          commandReceiptIds: childReceiptIds,
        };
      },
    );
    await this.accounting.dispatchCommittedReceipts(
      outcome.commandReceiptIds || [],
    );
    await this.todoReminders?.safeReconcileSource(
      'STOCKTAKE',
      outcome.stocktakeId,
    );
    return {
      stocktake: await this.get(actor, outcome.stocktakeId),
      replayed: outcome.replayed,
    };
  }

  async reject(
    actor: any,
    stocktakeId: string,
    input: any,
    metadata: any = {},
  ) {
    requireInventoryStocktakeApprove(actor);
    assertAllowedFields(input, [
      'reason',
      'sourceKey',
      'idempotencyKey',
      'requestHash',
    ]);
    const id = requiredId(stocktakeId, 'stocktakeId');
    const reason = requiredReason(input?.reason, 'reason');
    const envelope = stocktakeEnvelope('STOCKTAKE_REJECT', input, {
      stocktakeId: id,
      reason,
    });
    const outcome = await this.executeCommand(
      'STOCKTAKE_REJECT',
      actor,
      envelope,
      metadata,
      async (transaction) => {
        const stocktake = await loadStocktake(transaction, id, false);
        if (stocktake.status !== 'SUBMITTED') {
          throw invalidStateError(
            'Only a submitted stocktake can be rejected.',
          );
        }
        const now = new Date();
        const changed = await transaction.stocktake.updateMany({
          where: {
            id,
            status: 'SUBMITTED',
            version: stocktake.version,
          },
          data: {
            status: 'REJECTED',
            activeKey: null,
            rejectSourceKey: envelope.sourceKey,
            rejectIdempotencyKey: envelope.idempotencyKey,
            rejectRequestHash: envelope.requestHash,
            rejectionReason: reason,
            rejectedById: actorId(actor),
            rejectedByNameSnapshot: actorName(actor),
            rejectedByRoleSnapshot: actorRole(actor),
            rejectedAt: now,
            updatedById: actorId(actor),
            version: { increment: 1 },
          },
        });
        assertSingleUpdate(changed);
        return commandResult(
          id,
          null,
          { status: 'REJECTED' },
          'inventory.stocktake.rejected',
          { stocktakeId: id, status: 'submitted' },
          {
            stocktakeId: id,
            status: 'rejected',
            reason,
          },
        );
      },
    );
    await this.todoReminders?.safeReconcileSource(
      'STOCKTAKE',
      outcome.stocktakeId,
    );
    return {
      stocktake: await this.get(actor, outcome.stocktakeId),
      replayed: outcome.replayed,
    };
  }

  async reverse(
    actor: any,
    stocktakeId: string,
    input: any,
    metadata: any = {},
  ) {
    requireInventoryStocktakeApprove(actor);
    assertAllowedFields(input, [
      'reason',
      'sourceKey',
      'idempotencyKey',
      'requestHash',
    ]);
    const id = requiredId(stocktakeId, 'stocktakeId');
    const reason = requiredReason(input?.reason, 'reason');
    const envelope = stocktakeEnvelope('STOCKTAKE_REVERSE', input, {
      stocktakeId: id,
      reason,
    });
    const outcome = await this.executeCommand(
      'STOCKTAKE_REVERSE',
      actor,
      envelope,
      metadata,
      async (transaction) => {
        const stocktake = await loadStocktake(transaction, id, true);
        if (stocktake.status !== 'POSTED') {
          throw invalidStateError(
            'Only a posted stocktake can be reversed.',
          );
        }
        const childReceiptIds: string[] = [];
        if (stocktake.trackingModeSnapshot === 'SERIALIZED') {
          if (stocktake.quantityDocumentId) {
            const result =
              await this.serializedAdapter.reverseStocktakeInTransaction(
                transaction,
                actor,
                {
                  stocktakeId: id,
                  warehouseId: stocktake.warehouseId,
                  productId: stocktake.productId,
                  documentId: stocktake.quantityDocumentId,
                  sourceKey: childKey(
                    envelope.sourceKey,
                    'serialized-reverse',
                  ),
                  idempotencyKey: childKey(
                    envelope.idempotencyKey,
                    'serialized-reverse',
                  ),
                  reason,
                },
                metadata,
              );
            if (result.commandReceiptId) {
              childReceiptIds.push(result.commandReceiptId);
            }
          }
        } else {
          const documentIds = [
            stocktake.unavailableDocumentId,
            stocktake.quantityDocumentId,
          ].filter(Boolean);
          for (const [index, documentId] of documentIds.entries()) {
            const sourceKey = childKey(
              envelope.sourceKey,
              `document-${index + 1}`,
            );
            const idempotencyKey = childKey(
              envelope.idempotencyKey,
              `document-${index + 1}`,
            );
            const childInput: any = {
              documentId,
              documentScope: 'STOCKTAKE',
              reason,
              sourceId: id,
              sourceKey,
              idempotencyKey,
            };
            childInput.requestHash = calculateInventoryRequestHash(
              'REVERSE',
              childInput,
            );
            const result =
              await this.accounting.executeAutomaticInTransaction(
                'REVERSE',
                actor,
                childInput,
                transaction,
                metadata,
              );
            childReceiptIds.push(result.commandReceiptId);
          }
        }
        const now = new Date();
        const changed = await transaction.stocktake.updateMany({
          where: {
            id,
            status: 'POSTED',
            version: stocktake.version,
          },
          data: {
            status: 'REVERSED',
            reverseSourceKey: envelope.sourceKey,
            reverseIdempotencyKey: envelope.idempotencyKey,
            reverseRequestHash: envelope.requestHash,
            reversalReason: reason,
            reversedById: actorId(actor),
            reversedByNameSnapshot: actorName(actor),
            reversedByRoleSnapshot: actorRole(actor),
            reversedAt: now,
            updatedById: actorId(actor),
            version: { increment: 1 },
          },
        });
        assertSingleUpdate(changed);
        return {
          ...commandResult(
            id,
            null,
            {
              status: 'REVERSED',
              commandReceiptIds: childReceiptIds,
            },
            'inventory.stocktake.reversed',
            { stocktakeId: id, status: 'posted' },
            {
              stocktakeId: id,
              status: 'reversed',
              reason,
            },
          ),
          commandReceiptIds: childReceiptIds,
        };
      },
    );
    await this.accounting.dispatchCommittedReceipts(
      outcome.commandReceiptIds || [],
    );
    await this.todoReminders?.safeReconcileSource(
      'STOCKTAKE',
      outcome.stocktakeId,
    );
    return {
      stocktake: await this.get(actor, outcome.stocktakeId),
      replayed: outcome.replayed,
    };
  }

  private async applyQuantityStocktake(
    transaction: any,
    actor: any,
    stocktake: any,
    envelope: any,
    metadata: any,
  ) {
    const onHandDelta = Number(stocktake.line.onHandDifferenceQty || 0);
    const unavailableDelta = Number(
      stocktake.line.unavailableDifferenceQty || 0,
    );
    const commandReceiptIds: string[] = [];
    let quantityDocumentId: string | null = null;
    let unavailableDocumentId: string | null = null;
    const applyUnavailable = async (delta: number) => {
      if (delta === 0) return;
      const commandType =
        delta > 0 ? 'MARK_UNAVAILABLE' : 'RESTORE_AVAILABLE';
      const input: any = {
        warehouseId: stocktake.warehouseId,
        productId: stocktake.productId,
        quantity: Math.abs(delta),
        reason: stocktake.reason,
        sourceId: stocktake.id,
        sourceKey: childKey(envelope.sourceKey, 'unavailable'),
        idempotencyKey: childKey(
          envelope.idempotencyKey,
          'unavailable',
        ),
      };
      input.requestHash = calculateInventoryRequestHash(
        commandType,
        input,
      );
      const result =
        await this.accounting.executeAutomaticInTransaction(
          commandType,
          actor,
          input,
          transaction,
          metadata,
        );
      unavailableDocumentId = result.documentId;
      commandReceiptIds.push(result.commandReceiptId);
    };
    const applyOnHand = async () => {
      if (onHandDelta === 0) return;
      const commandType = onHandDelta > 0 ? 'INBOUND' : 'OUTBOUND';
      const input: any = {
        warehouseId: stocktake.warehouseId,
        productId: stocktake.productId,
        quantity: Math.abs(onHandDelta),
        kind: onHandDelta > 0 ? 'STOCK_GAIN' : 'STOCK_LOSS',
        reason: stocktake.reason,
        sourceId: stocktake.id,
        sourceKey: childKey(envelope.sourceKey, 'quantity'),
        idempotencyKey: childKey(
          envelope.idempotencyKey,
          'quantity',
        ),
      };
      if (onHandDelta > 0) {
        input.condition = 'SALEABLE';
      }
      input.requestHash = calculateInventoryRequestHash(
        commandType,
        input,
      );
      const result =
        await this.accounting.executeAutomaticInTransaction(
          commandType,
          actor,
          input,
          transaction,
          metadata,
        );
      quantityDocumentId = result.documentId;
      commandReceiptIds.push(result.commandReceiptId);
    };
    if (unavailableDelta < 0) {
      await applyUnavailable(unavailableDelta);
    }
    await applyOnHand();
    if (unavailableDelta > 0) {
      await applyUnavailable(unavailableDelta);
    }
    return {
      commandReceiptIds,
      quantityDocumentId,
      unavailableDocumentId,
    };
  }

  private async executeCommand(
    commandType: string,
    actor: any,
    envelope: any,
    metadata: any,
    work: (transaction: any, receipt: any) => Promise<any>,
  ) {
    for (let attempt = 1; attempt <= MAX_CONCURRENCY_ATTEMPTS; attempt += 1) {
      try {
        const result = await this.repository.runInTransaction(
          async (transaction) => {
            const existing = await this.repository.findCommandReceipt(
              envelope.idempotencyKey,
              transaction,
            );
            if (existing) {
              return replayReceipt(existing, envelope.requestHash);
            }
            const receipt = await this.repository.createCommandReceipt(
              transaction,
              {
                sourceKey: envelope.sourceKey,
                idempotencyKey: envelope.idempotencyKey,
                commandType,
                requestHash: envelope.requestHash,
                status: 'PROCESSING',
                actorUserId: actorId(actor),
                actorNameSnapshot: actorName(actor),
                actorRoleSnapshot: actorRole(actor),
                requestId: boundedTraceId(metadata?.requestId),
              },
            );
            const outcome = await work(transaction, receipt);
            await this.operationLogs.appendLog(
              {
                userId: actorId(actor),
                actorNameSnapshot: actorName(actor),
                actorRoleSnapshot: actorRole(actor),
                action: outcome.auditAction,
                module: 'inventory',
                operationType: 'UPDATE',
                entityType: 'stocktake',
                entityId: outcome.stocktakeId,
                beforeData: outcome.auditBefore,
                afterData: outcome.auditAfter,
                requestSummary: {
                  sourceKey: envelope.sourceKey,
                  idempotencyKey: envelope.idempotencyKey,
                },
                requestId: boundedTraceId(metadata?.requestId),
                ipAddress: boundedIp(metadata?.ipAddress),
              },
              transaction,
            );
            const snapshot = {
              stocktakeId: outcome.stocktakeId,
              resultDocumentId: outcome.resultDocumentId,
              ...outcome.resultSnapshot,
              commandReceiptIds: outcome.commandReceiptIds || [],
            };
            await this.repository.completeCommandReceipt(
              transaction,
              receipt.id,
              outcome.resultDocumentId,
              snapshot,
            );
            return {
              ...snapshot,
              commandReceiptId: receipt.id,
              replayed: false,
            };
          },
        );
        return result;
      } catch (error: any) {
        if (error?.code === 'P2002') {
          const receipt = await this.repository.findCommandReceipt(
            envelope.idempotencyKey,
          );
          if (receipt) {
            return replayReceipt(receipt, envelope.requestHash);
          }
          const sourceReceipt =
            await this.repository.findCommandReceiptBySourceKey(
              envelope.sourceKey,
            );
          if (sourceReceipt) {
            throw createHttpError(
              409,
              'INVENTORY_SOURCE_KEY_CONFLICT',
              'The normalized sourceKey was already used by another inventory fact.',
            );
          }
          throw createHttpError(
            409,
            'INVENTORY_STOCKTAKE_ACTIVE_EXISTS',
            'An active stocktake already exists for this warehouse and product, or a business key was reused.',
          );
        }
        if (
          error?.code === 'P2034' &&
          attempt < MAX_CONCURRENCY_ATTEMPTS
        ) {
          continue;
        }
        throw error;
      }
    }
    throw concurrencyError();
  }
}

async function loadStocktake(
  transaction: any,
  id: string,
  includeScans: boolean,
) {
  const stocktake = await transaction.stocktake.findUnique({
    where: { id },
    include: {
      line: true,
      serializedScans: includeScans
        ? {
            include: {
              serializedUnit: true,
              actionMovement: true,
            },
            orderBy: [{ lineNo: 'asc' }, { id: 'asc' }],
          }
        : false,
    },
  });
  if (!stocktake) throw notFoundError();
  return stocktake;
}

async function buildSerializedScanFacts(
  transaction: any,
  stocktake: any,
  scans: any[],
  sourceKey: string,
) {
  const expectedUnits = await transaction.serializedInventoryUnit.findMany({
    where: {
      warehouseId: stocktake.warehouseId,
      productId: stocktake.productId,
      status: { in: SERIALIZED_SNAPSHOT_STATUSES },
    },
    orderBy: [
      { normalizedLogisticsCode: 'asc' },
      { id: 'asc' },
    ],
  });
  const normalizedCodes = scans.map((scan) => scan.normalizedLogisticsCode);
  const foundUnits =
    normalizedCodes.length === 0
      ? []
      : await transaction.serializedInventoryUnit.findMany({
          where: {
            normalizedLogisticsCode: { in: normalizedCodes },
          },
        });
  const byCode = new Map(
    foundUnits.map((unit: any) => [
      unit.normalizedLogisticsCode,
      unit,
    ]),
  );
  const expectedById = new Map(
    expectedUnits.map((unit: any) => [unit.id, unit]),
  );
  const scannedExpectedIds = new Set<string>();
  const facts = scans.map((scan, index) => {
    const unit: any = byCode.get(scan.normalizedLogisticsCode);
    const matchesTarget =
      unit &&
      unit.productId === stocktake.productId &&
      unit.warehouseId === stocktake.warehouseId &&
      expectedById.has(unit.id) &&
      unit.status !== 'ALLOCATED';
    if (unit && expectedById.has(unit.id)) {
      scannedExpectedIds.add(unit.id);
    }
    const conflict = unit && !matchesTarget;
    return {
      sourceKey: scanFactKey(sourceKey, scan.normalizedLogisticsCode),
      serializedUnitId: unit?.id ?? null,
      scannedLogisticsCodeSnapshot: scan.logisticsCode,
      normalizedLogisticsCodeSnapshot: scan.normalizedLogisticsCode,
      matchStatus: conflict
        ? 'CONFLICT'
        : matchesTarget
          ? 'MATCHED'
          : 'UNKNOWN',
      expectedWarehouseId: unit?.warehouseId ?? null,
      expectedUnitStatus: unit?.status ?? null,
      expectedUnitVersion:
        unit?.version === undefined ? null : Number(unit.version),
      countedCondition: matchesTarget ? scan.condition : null,
      inputOrder: index,
    };
  });
  for (const unit of expectedUnits) {
    if (scannedExpectedIds.has(unit.id)) continue;
    const code =
      unit.normalizedLogisticsCode ||
      `missing-unit:${unit.id.toLocaleLowerCase('en-US')}`;
    facts.push({
      sourceKey: scanFactKey(sourceKey, code),
      serializedUnitId: unit.id,
      scannedLogisticsCodeSnapshot:
        unit.logisticsCode || `[missing:${unit.id}]`,
      normalizedLogisticsCodeSnapshot: code,
      matchStatus: 'MISSING',
      expectedWarehouseId: unit.warehouseId,
      expectedUnitStatus: unit.status,
      expectedUnitVersion: Number(unit.version),
      countedCondition: null,
      inputOrder: facts.length,
    });
  }
  return facts
    .sort((left, right) => left.inputOrder - right.inputOrder)
    .map(({ inputOrder: _inputOrder, ...fact }) => fact);
}

function normalizeSubmittedScans(value: unknown) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw validationError('scans must be an array.');
  }
  const seen = new Set<string>();
  return value.map((entry: any, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw validationError(`scans[${index}] must be an object.`);
    }
    const logisticsCode = normalizedString(entry.logisticsCode);
    if (!logisticsCode || logisticsCode.length > 160) {
      throw validationError(
        `scans[${index}].logisticsCode is required.`,
      );
    }
    const normalizedLogisticsCode = logisticsCode.toLocaleLowerCase('en-US');
    if (seen.has(normalizedLogisticsCode)) {
      throw createHttpError(
        409,
        'INVENTORY_STOCKTAKE_DUPLICATE_SCAN',
        'The same bottle code cannot be scanned twice.',
      );
    }
    seen.add(normalizedLogisticsCode);
    const condition = String(entry.condition || '')
      .trim()
      .toUpperCase();
    if (!['SALEABLE', 'UNAVAILABLE'].includes(condition)) {
      throw validationError(
        `scans[${index}].condition must be SALEABLE or UNAVAILABLE.`,
      );
    }
    return {
      logisticsCode,
      normalizedLogisticsCode,
      condition,
    };
  });
}

function stocktakeEnvelope(
  commandType: string,
  input: any,
  payload: Record<string, unknown>,
) {
  const sourceKey = normalizedBusinessKey(input?.sourceKey, 'sourceKey');
  const idempotencyKey = normalizedBusinessKey(
    input?.idempotencyKey,
    'idempotencyKey',
  );
  const hashPayload = {
    commandType,
    sourceKey,
    idempotencyKey,
    ...payload,
  };
  const requestHash = crypto
    .createHash('sha256')
    .update(canonicalJson(hashPayload))
    .digest('hex');
  if (
    typeof input?.requestHash !== 'string' ||
    input.requestHash.trim().toLowerCase() !== requestHash
  ) {
    throw createHttpError(
      400,
      'INVENTORY_REQUEST_HASH_MISMATCH',
      'requestHash does not match the normalized stocktake command.',
    );
  }
  return { sourceKey, idempotencyKey, requestHash };
}

function stocktakeInclude(includeScans: boolean) {
  return {
    warehouse: {
      select: { id: true, code: true, name: true, isActive: true },
    },
    product: {
      select: {
        id: true,
        name: true,
        unit: true,
        inventoryTrackingMode: true,
      },
    },
    line: true,
    serializedScans: includeScans
      ? {
          select: {
            id: true,
            lineNo: true,
            scannedLogisticsCodeSnapshot: true,
            matchStatus: true,
            countedCondition: true,
            expectedUnitStatus: true,
            actionMovementId: true,
          },
          orderBy: [{ lineNo: 'asc' }, { id: 'asc' }],
        }
      : false,
  };
}

function projectStocktake(row: any, actor: any) {
  const projected: any = {
    id: row.id,
    stocktakeNo: row.stocktakeNo,
    status: row.status,
    warehouse: row.warehouse,
    product: row.product,
    trackingMode: row.trackingModeSnapshot,
    active: Boolean(row.activeKey),
    reason: row.reason,
    rejectionReason: row.rejectionReason,
    reversalReason: row.reversalReason,
    line: row.line
      ? {
          snapshotStockVersion: row.line.snapshotStockVersion,
          snapshotLastMovementId: row.line.snapshotLastMovementId,
          snapshotOnHandQty: row.line.snapshotOnHandQty,
          snapshotUnavailableQty: row.line.snapshotUnavailableQty,
          countedOnHandQty: row.line.countedOnHandQty,
          countedUnavailableQty: row.line.countedUnavailableQty,
          onHandDifferenceQty: row.line.onHandDifferenceQty,
          unavailableDifferenceQty:
            row.line.unavailableDifferenceQty,
        }
      : null,
    submittedByName: row.submittedByNameSnapshot,
    submittedByRole: row.submittedByRoleSnapshot,
    submittedAt: row.submittedAt,
    approvedByName: row.approvedByNameSnapshot,
    approvedByRole: row.approvedByRoleSnapshot,
    approvedAt: row.approvedAt,
    rejectedByName: row.rejectedByNameSnapshot,
    rejectedByRole: row.rejectedByRoleSnapshot,
    rejectedAt: row.rejectedAt,
    postedByName: row.postedByNameSnapshot,
    postedByRole: row.postedByRoleSnapshot,
    postedAt: row.postedAt,
    reversedByName: row.reversedByNameSnapshot,
    reversedByRole: row.reversedByRoleSnapshot,
    reversedAt: row.reversedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (canReadSerializedScans(actor) && Array.isArray(row.serializedScans)) {
    projected.serializedScans = row.serializedScans;
  }
  return projected;
}

function canReadSerializedScans(actor: any) {
  return ['super_admin', 'admin', 'warehouse', 'boss'].includes(
    normalizedInventoryRole(actor),
  );
}

function assertStockSnapshotUnchanged(line: any, current: any) {
  if (
    Number(line.snapshotStockVersion) !== current.version ||
    (line.snapshotLastMovementId || null) !==
      (current.lastMovementId || null) ||
    Number(line.snapshotOnHandQty) !== current.onHandQty ||
    Number(line.snapshotUnavailableQty) !== current.unavailableQty
  ) {
    throw createHttpError(
      409,
      'INVENTORY_STOCKTAKE_SNAPSHOT_STALE',
      'Inventory changed after submission. Start a new stocktake instead of applying the old difference.',
    );
  }
}

function assertSerializedSnapshotMatchesAggregate(stocktake: any) {
  const scans = stocktake.serializedScans || [];
  const expected = scans.filter((scan: any) =>
    ['MATCHED', 'MISSING'].includes(scan.matchStatus),
  );
  const expectedUnavailable = expected.filter((scan: any) =>
    ['PENDING_COST', 'UNAVAILABLE'].includes(scan.expectedUnitStatus),
  ).length;
  if (
    expected.length !== Number(stocktake.line.snapshotOnHandQty) ||
    expectedUnavailable !==
      Number(stocktake.line.snapshotUnavailableQty)
  ) {
    throw createHttpError(
      409,
      'INVENTORY_STOCKTAKE_SERIALIZED_AGGREGATE_MISMATCH',
      'Serialized units and the warehouse stock snapshot are inconsistent. Reconcile them before approval.',
    );
  }
}

function assertSubmittedSnapshot(line: any) {
  if (
    !line ||
    line.snapshotStockVersion === null ||
    line.snapshotOnHandQty === null ||
    line.snapshotUnavailableQty === null ||
    line.countedOnHandQty === null ||
    line.countedUnavailableQty === null
  ) {
    throw createHttpError(
      409,
      'INVENTORY_STOCKTAKE_SNAPSHOT_MISSING',
      'The submitted stocktake does not contain a complete inventory snapshot.',
    );
  }
}

function stockSnapshot(stock: any) {
  return {
    version: Number(stock?.version || 0),
    lastMovementId: stock?.lastMovementId ?? null,
    onHandQty: Number(stock?.onHandQty || 0),
    unavailableQty: Number(stock?.unavailableQty || 0),
  };
}

function commandResult(
  stocktakeId: string,
  resultDocumentId: string | null,
  resultSnapshot: any,
  auditAction: string,
  auditBefore: any,
  auditAfter: any,
) {
  return {
    stocktakeId,
    resultDocumentId,
    resultSnapshot,
    auditAction,
    auditBefore,
    auditAfter,
  };
}

function replayReceipt(receipt: any, requestHash: string) {
  if (receipt.requestHash !== requestHash) {
    throw createHttpError(
      409,
      'INVENTORY_IDEMPOTENCY_KEY_CONFLICT',
      'The idempotency key was already used with different normalized content.',
    );
  }
  if (receipt.status !== 'SUCCEEDED' || !receipt.resultSnapshot) {
    throw createHttpError(
      409,
      'INVENTORY_COMMAND_IN_PROGRESS',
      'The stocktake command is already being processed.',
    );
  }
  return {
    ...(receipt.resultSnapshot as any),
    commandReceiptId: receipt.id,
    replayed: true,
  };
}

function stocktakeNumber(receiptId: string) {
  return `STK-${receiptId.replace(/-/g, '').slice(0, 24).toUpperCase()}`;
}

function activeStocktakeKey(warehouseId: string, productId: string) {
  return `${warehouseId}:${productId}`;
}

function childKey(parent: string, suffix: string) {
  const tail = crypto
    .createHash('sha256')
    .update(suffix)
    .digest('hex')
    .slice(0, 16);
  return `${parent.slice(0, 125)}:${tail}`;
}

function scanFactKey(parent: string, code: string) {
  return childKey(parent, `scan:${code}`);
}

function serializedFingerprint(facts: any[]) {
  const snapshot = facts
    .filter((fact) => fact.serializedUnitId)
    .map((fact) => ({
      unitId: fact.serializedUnitId,
      warehouseId: fact.expectedWarehouseId,
      status: fact.expectedUnitStatus,
      version: fact.expectedUnitVersion,
    }))
    .sort((left, right) => left.unitId.localeCompare(right.unitId));
  return crypto
    .createHash('sha256')
    .update(canonicalJson(snapshot))
    .digest('hex');
}

function summarizeScans(facts: any[]) {
  return facts.reduce(
    (summary, fact) => {
      summary[String(fact.matchStatus).toLowerCase()] += 1;
      return summary;
    },
    { matched: 0, missing: 0, unknown: 0, conflict: 0 },
  );
}

function assertAllowedFields(input: any, allowed: string[]) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('The stocktake command body must be an object.');
  }
  const fields = new Set(allowed);
  const unsupported = Object.keys(input).find((key) => !fields.has(key));
  if (unsupported) {
    throw validationError(`Unsupported stocktake field: ${unsupported}.`);
  }
}

function normalizedStatus(value: unknown) {
  const status = normalizedString(value).toUpperCase();
  if (
    ![
      'DRAFT',
      'SUBMITTED',
      'APPROVED',
      'REJECTED',
      'POSTED',
      'REVERSED',
    ].includes(status)
  ) {
    throw validationError('Unsupported stocktake status.');
  }
  return status;
}

function nonNegativeInteger(value: unknown, field: string) {
  const parsed =
    typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw validationError(`${field} must be a non-negative integer.`);
  }
  return parsed;
}

function positivePage(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw validationError('Pagination values must be positive integers.');
  }
  return parsed;
}

function requiredReason(value: unknown, field: string) {
  const reason = optionalBoundedString(value, field, 500);
  if (!reason) throw validationError(`${field} is required.`);
  return reason;
}

function normalizedString(value: unknown) {
  return typeof value === 'string' ? value.normalize('NFKC').trim() : '';
}

function boundedTraceId(value: unknown) {
  const normalized = normalizedString(value);
  return normalized ? normalized.slice(0, 64) : null;
}

function boundedIp(value: unknown) {
  const normalized = normalizedString(value);
  return normalized ? normalized.slice(0, 45) : null;
}

function assertSingleUpdate(result: any) {
  if (Number(result?.count || 0) !== 1) throw concurrencyError();
}

function validationError(message: string) {
  return createHttpError(
    400,
    'INVENTORY_STOCKTAKE_VALIDATION_FAILED',
    message,
  );
}

function invalidStateError(message: string) {
  return createHttpError(
    409,
    'INVENTORY_STOCKTAKE_STATE_CONFLICT',
    message,
  );
}

function notFoundError() {
  return createHttpError(
    404,
    'INVENTORY_STOCKTAKE_NOT_FOUND',
    'The stocktake does not exist.',
  );
}

function concurrencyError() {
  return createHttpError(
    409,
    'INVENTORY_CONCURRENT_UPDATE',
    'Inventory changed concurrently. Refresh and retry.',
  );
}
