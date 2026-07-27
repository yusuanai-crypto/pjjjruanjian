import { Injectable } from '@nestjs/common';

import { createHttpError } from '../../common/errors';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import {
  assertRestrictedBalancesNonNegative,
  calculateStockMetrics,
  canonicalJson,
  InventoryCommandType,
  normalizeInventoryCommandEnvelope,
  normalizedBusinessKey,
  optionalBoundedString,
  optionalBusinessDate,
  optionalId,
  optionalNonNegativeInteger,
  positiveQuantity,
  requiredId,
} from './inventory-command.policy';
import { InventoryPostCommitService } from './inventory-post-commit.service';
import {
  actorId,
  actorName,
  actorRole,
  InventoryBatchDelta,
  InventoryPrismaRepository,
  InventoryStockDelta,
} from './inventory.prisma.repository';
import { SerializedInventoryAccountingAdapter } from './serialized-inventory-accounting.adapter';
import * as crypto from 'node:crypto';

const WRITE_ROLES = new Set(['super_admin', 'admin', 'warehouse']);
const REBUILD_READ_ROLES = new Set([
  'super_admin',
  'admin',
]);
const ADMIN_ROLES = new Set(['super_admin', 'admin']);
const COST_WRITE_ROLES = new Set([
  'super_admin',
  'admin',
  'finance',
]);
const BUSINESS_INBOUND_KINDS = new Set([
  'OPENING',
  'PURCHASE_RECEIPT',
  'OTHER_IN',
]);
const MAX_CONCURRENCY_ATTEMPTS = 3;

const ZERO_STOCK_DELTA: InventoryStockDelta = {
  onHandDelta: 0,
  reservedDelta: 0,
  unavailableDelta: 0,
  inTransitDelta: 0,
};

@Injectable()
export class InventoryAccountingService {
  constructor(
    private readonly repository: InventoryPrismaRepository,
    private readonly operationLogsService: OperationLogsNestService,
    private readonly postCommitService: InventoryPostCommitService,
    private readonly serializedAdapter: SerializedInventoryAccountingAdapter,
  ) {}

  inbound(actor: any, input: any, metadata: any = {}) {
    return this.execute('INBOUND', actor, input, metadata);
  }

  businessInbound(actor: any, input: any, metadata: any = {}) {
    requireRole(actor, WRITE_ROLES);
    assertBusinessInboundInput(actor, input);
    return this.execute('INBOUND', actor, input, metadata);
  }

  reserve(actor: any, input: any, metadata: any = {}) {
    return this.execute('RESERVE', actor, input, metadata);
  }

  release(actor: any, input: any, metadata: any = {}) {
    return this.execute('RELEASE', actor, input, metadata);
  }

  outbound(actor: any, input: any, metadata: any = {}) {
    return this.execute('OUTBOUND', actor, input, metadata);
  }

  transferOut(actor: any, input: any, metadata: any = {}) {
    return this.execute('TRANSFER_OUT', actor, input, metadata);
  }

  transferIn(actor: any, input: any, metadata: any = {}) {
    return this.execute('TRANSFER_IN', actor, input, metadata);
  }

  markUnavailable(actor: any, input: any, metadata: any = {}) {
    return this.execute('MARK_UNAVAILABLE', actor, input, metadata);
  }

  restoreAvailable(actor: any, input: any, metadata: any = {}) {
    return this.execute('RESTORE_AVAILABLE', actor, input, metadata);
  }

  updateBatchCost(actor: any, input: any, metadata: any = {}) {
    return this.execute('UPDATE_BATCH_COST', actor, input, metadata);
  }

  reverse(actor: any, input: any, metadata: any = {}) {
    return this.execute('REVERSE', actor, input, metadata);
  }

  reverseInbound(actor: any, input: any, metadata: any = {}) {
    return this.execute(
      'REVERSE',
      actor,
      {
        ...input,
        documentScope: 'INBOUND_ONLY',
      },
      metadata,
    );
  }

  async executeAutomaticInTransaction(
    commandType: InventoryCommandType,
    actor: any,
    input: any,
    transaction: any,
    metadata: any = {},
  ) {
    if (
      ![
        'INBOUND',
        'RESERVE',
        'RELEASE',
        'OUTBOUND',
        'MARK_UNAVAILABLE',
        'RESTORE_AVAILABLE',
        'REVERSE',
      ].includes(commandType)
    ) {
      throw createHttpError(
        400,
        'INVENTORY_AUTOMATIC_COMMAND_FORBIDDEN',
        'Unsupported automatic inventory command.',
      );
    }
    assertAllowedCommandFields(commandType, input);
    const envelope = normalizeInventoryCommandEnvelope(
      commandType,
      input,
    );
    const replay = await this.resolveIdempotentReplay(
      envelope.idempotencyKey,
      envelope.requestHash,
      transaction,
    );
    if (replay) {
      return replay;
    }
    try {
      const receipt =
        await this.repository.createCommandReceipt(transaction, {
          sourceKey: envelope.sourceKey,
          idempotencyKey: envelope.idempotencyKey,
          commandType,
          requestHash: envelope.requestHash,
          status: 'PROCESSING',
          actorUserId: actorId(actor),
          actorNameSnapshot: actorName(actor),
          actorRoleSnapshot: actorRole(actor),
          requestId: boundedTraceId(metadata?.requestId),
        });
      const outcome = await this.applyCommand(
        transaction,
        commandType,
        actor,
        input,
        envelope,
        receipt,
      );
      await this.operationLogsService.appendLog(
        {
          userId: actorId(actor),
          actorNameSnapshot: actorName(actor),
          actorRoleSnapshot: actorRole(actor),
          action: `inventory.${commandType.toLowerCase()}.posted`,
          module: 'inventory',
          operationType: 'UPDATE',
          entityType: 'inventory_document',
          entityId: outcome.documentId,
          beforeData: null,
          afterData: buildRoleSafeAuditSnapshot(
            commandType,
            outcome,
          ),
          requestSummary: {
            sourceKey: envelope.sourceKey,
            idempotencyKey: envelope.idempotencyKey,
          },
          requestId: boundedTraceId(metadata?.requestId),
          ipAddress: optionalBoundedString(
            metadata?.ipAddress,
            'ipAddress',
            45,
          ),
        },
        transaction,
      );
      const postCommitTask =
        await this.repository.createPostCommitTask(transaction, {
          sourceKey: `${envelope.sourceKey}:post-commit`,
          commandReceiptId: receipt.id,
          taskType: 'REFRESH_INVENTORY_DERIVED_STATE',
          payload: {
            commandReceiptId: receipt.id,
            documentId: outcome.documentId,
            warehouseProductPairs:
              uniqueWarehouseProductPairs([
                ...outcome.stockChanges,
                ...outcome.batchChanges,
              ]),
            inventoryOrderContext:
              safeInventoryOrderContext(
                metadata?.inventoryOrderContext,
              ),
          },
          status: 'PENDING',
        });
      const resultSnapshot = {
        commandReceiptId: receipt.id,
        documentId: outcome.documentId,
        documentNo: outcome.documentNo,
        movementIds: outcome.movementIds,
        stockChanges: outcome.stockChanges,
        batchChanges: outcome.batchChanges,
        reservation: outcome.reservation,
        reversalOfDocumentId:
          outcome.reversalOfDocumentId ?? null,
        postCommitTaskId: postCommitTask.id,
      };
      await this.repository.completeCommandReceipt(
        transaction,
        receipt.id,
        outcome.documentId,
        resultSnapshot,
      );
      return {
        ...resultSnapshot,
        replayed: false,
      };
    } catch (error) {
      throw mapInventoryWriteError(error);
    }
  }

  async dispatchCommittedReceipts(receiptIds: string[]) {
    for (const receiptId of Array.from(new Set(receiptIds))) {
      if (receiptId) {
        await this.postCommitService.dispatchForReceipt(receiptId);
      }
    }
  }

  createTransfer(actor: any, input: any, metadata: any = {}) {
    requireRole(actor, WRITE_ROLES);
    assertTransferCreateInput(input);
    return this.executeTransferCommand(
      'TRANSFER_CREATE',
      actor,
      input,
      metadata,
      (transaction, envelope, receipt) =>
        this.applyTransferCreate(
          transaction,
          actor,
          input,
          envelope,
          receipt,
        ),
    );
  }

  confirmTransferOutbound(
    actor: any,
    input: any,
    metadata: any = {},
  ) {
    requireRole(actor, WRITE_ROLES);
    assertTransferActionInput(input, 'transferId', false);
    return this.executeTransferCommand(
      'TRANSFER_CONFIRM_OUTBOUND',
      actor,
      input,
      metadata,
      (transaction, envelope, receipt) =>
        this.applyTransferOutboundConfirmation(
          transaction,
          actor,
          input,
          envelope,
          receipt,
        ),
    );
  }

  receiveTransfer(actor: any, input: any, metadata: any = {}) {
    requireRole(actor, WRITE_ROLES);
    assertTransferReceiptInput(input);
    return this.executeTransferCommand(
      'TRANSFER_RECEIVE',
      actor,
      input,
      metadata,
      (transaction, envelope, receipt) =>
        this.applyTransferReceipt(
          transaction,
          actor,
          input,
          envelope,
          receipt,
        ),
    );
  }

  reverseTransferReceipt(
    actor: any,
    input: any,
    metadata: any = {},
  ) {
    requireRole(actor, WRITE_ROLES);
    assertTransferActionInput(input, 'receiptId', true);
    return this.executeTransferCommand(
      'TRANSFER_RECEIPT_REVERSE',
      actor,
      input,
      metadata,
      (transaction, envelope, receipt) =>
        this.applyTransferReceiptReversal(
          transaction,
          actor,
          input,
          envelope,
          receipt,
        ),
    );
  }

  reverseTransferOutbound(
    actor: any,
    input: any,
    metadata: any = {},
  ) {
    requireRole(actor, WRITE_ROLES);
    assertTransferActionInput(input, 'transferId', true);
    return this.executeTransferCommand(
      'TRANSFER_OUTBOUND_REVERSE',
      actor,
      input,
      metadata,
      (transaction, envelope, receipt) =>
        this.applyTransferOutboundReversal(
          transaction,
          actor,
          input,
          envelope,
          receipt,
        ),
    );
  }

  businessMarkUnavailable(
    actor: any,
    input: any,
    metadata: any = {},
  ) {
    requiredCorrectionReason(input?.reason);
    return this.markUnavailable(actor, input, metadata);
  }

  businessRestoreAvailable(
    actor: any,
    input: any,
    metadata: any = {},
  ) {
    requiredCorrectionReason(input?.reason);
    return this.restoreAvailable(actor, input, metadata);
  }

  private async executeTransferCommand(
    commandType:
      | 'TRANSFER_CREATE'
      | 'TRANSFER_CONFIRM_OUTBOUND'
      | 'TRANSFER_RECEIVE'
      | 'TRANSFER_RECEIPT_REVERSE'
      | 'TRANSFER_OUTBOUND_REVERSE',
    actor: any,
    input: any,
    metadata: any,
    apply: (
      transaction: any,
      envelope: any,
      receipt: any,
    ) => Promise<TransferCommandOutcome>,
  ) {
    const envelope = normalizeInventoryCommandEnvelope(
      commandType,
      input,
    );
    const replay = await this.resolveIdempotentReplay(
      envelope.idempotencyKey,
      envelope.requestHash,
    );
    if (replay) {
      return replay;
    }
    for (
      let attempt = 1;
      attempt <= MAX_CONCURRENCY_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const result = await this.repository.runInTransaction(
          async (transaction) => {
            const receipt =
              await this.repository.createCommandReceipt(transaction, {
                sourceKey: envelope.sourceKey,
                idempotencyKey: envelope.idempotencyKey,
                commandType,
                requestHash: envelope.requestHash,
                status: 'PROCESSING',
                actorUserId: actorId(actor),
                actorNameSnapshot: actorName(actor),
                actorRoleSnapshot: actorRole(actor),
                requestId: boundedTraceId(metadata?.requestId),
              });
            const outcome = await apply(
              transaction,
              envelope,
              receipt,
            );
            await this.operationLogsService.appendLog(
              {
                userId: actorId(actor),
                actorNameSnapshot: actorName(actor),
                actorRoleSnapshot: actorRole(actor),
                action: transferAuditAction(commandType),
                module: 'inventory',
                operationType:
                  commandType === 'TRANSFER_CREATE'
                    ? 'CREATE'
                    : 'UPDATE',
                entityType:
                  commandType === 'TRANSFER_RECEIPT_REVERSE'
                    ? 'inventory_transfer_receipt'
                    : 'inventory_transfer',
                entityId:
                  outcome.receiptId ?? outcome.transferId,
                beforeData: outcome.auditBefore ?? null,
                afterData: outcome.auditAfter,
                requestSummary: {
                  sourceKey: envelope.sourceKey,
                  idempotencyKey: envelope.idempotencyKey,
                },
                requestId: boundedTraceId(metadata?.requestId),
                ipAddress: optionalBoundedString(
                  metadata?.ipAddress,
                  'ipAddress',
                  45,
                ),
              },
              transaction,
            );
            let postCommitTask: any = null;
            if (outcome.stockChanges.length > 0) {
              postCommitTask =
                await this.repository.createPostCommitTask(transaction, {
                  sourceKey: `${envelope.sourceKey}:post-commit`,
                  commandReceiptId: receipt.id,
                  taskType: 'REFRESH_INVENTORY_DERIVED_STATE',
                  payload: {
                    commandReceiptId: receipt.id,
                    documentIds: outcome.documentIds,
                    warehouseProductPairs:
                      uniqueWarehouseProductPairs(
                        outcome.stockChanges,
                      ),
                  },
                  status: 'PENDING',
                });
            }
            const resultSnapshot = {
              commandReceiptId: receipt.id,
              transferId: outcome.transferId,
              receiptId: outcome.receiptId ?? null,
              documentIds: outcome.documentIds,
              movementIds: outcome.movementIds,
              stockChanges: outcome.stockChanges,
              transfer: outcome.transfer,
              postCommitTaskId: postCommitTask?.id ?? null,
            };
            await this.repository.completeCommandReceipt(
              transaction,
              receipt.id,
              outcome.documentIds[0] ?? null,
              resultSnapshot,
            );
            return resultSnapshot;
          },
        );
        if (result.postCommitTaskId) {
          await this.postCommitService.dispatchForReceipt(
            result.commandReceiptId,
          );
        }
        return {
          ...result,
          replayed: false,
        };
      } catch (error) {
        const replayAfterConflict =
          await this.resolveIdempotentReplay(
            envelope.idempotencyKey,
            envelope.requestHash,
          );
        if (replayAfterConflict) {
          return replayAfterConflict;
        }
        if (
          isRetryableConcurrencyError(error) &&
          attempt < MAX_CONCURRENCY_ATTEMPTS
        ) {
          continue;
        }
        throw mapInventoryWriteError(error);
      }
    }
    throw concurrentUpdateError();
  }

  async rebuildCheck(actor: any, input: any) {
    requireRole(actor, REBUILD_READ_ROLES);
    const warehouseId = requiredId(input?.warehouseId, 'warehouseId');
    const productId = requiredId(input?.productId, 'productId');
    const root = this.repository.root();
    const [product, stock, movements, batches, serializedSummary] =
      await Promise.all([
        this.repository.findProduct(root, productId),
        this.repository.findStock(root, warehouseId, productId),
        this.repository.listMovements(warehouseId, productId),
        this.repository.listBatches(warehouseId, productId),
        this.repository.countSerializedUnits(warehouseId, productId),
      ]);
    const expectedStock = movements.reduce(
      (sum: any, movement: any) => ({
        onHandQty: sum.onHandQty + movement.onHandDelta,
        reservedQty: sum.reservedQty + movement.reservedDelta,
        unavailableQty:
          sum.unavailableQty + movement.unavailableDelta,
        inTransitQty: sum.inTransitQty + movement.inTransitDelta,
      }),
      {
        onHandQty: 0,
        reservedQty: 0,
        unavailableQty: 0,
        inTransitQty: 0,
      },
    );
    const actualStock = {
      onHandQty: stock?.onHandQty ?? 0,
      reservedQty: stock?.reservedQty ?? 0,
      unavailableQty: stock?.unavailableQty ?? 0,
      inTransitQty: stock?.inTransitQty ?? 0,
    };
    const batchChecks = [];
    for (const batch of batches) {
      const batchMovements = await this.repository.listBatchMovements(
        batch.id,
      );
      const expectedBatch = rebuildBatch(batchMovements);
      const actualBatch = {
        receivedQty: batch.receivedQty,
        remainingQty: batch.remainingQty,
        unavailableQty: batch.unavailableQty,
      };
      batchChecks.push({
        batchId: batch.id,
        expected: expectedBatch,
        actual: actualBatch,
        delta: numericDelta(expectedBatch, actualBatch),
        consistent: numericEqual(expectedBatch, actualBatch),
      });
    }
    const stockDelta = numericDelta(expectedStock, actualStock);
    const serializedConsistency =
      product?.inventoryTrackingMode === 'SERIALIZED'
        ? rebuildSerializedConsistency(
            await this.repository.listSerializedConsistencyRows(
              warehouseId,
              productId,
            ),
            actualStock,
          )
        : null;
    return {
      warehouseId,
      productId,
      movementCount: movements.length,
      stock: {
        expected: calculateStockMetrics(expectedStock),
        actual: calculateStockMetrics(actualStock),
        delta: stockDelta,
        consistent: numericEqual(expectedStock, actualStock),
        snapshotVersion: stock?.version ?? null,
        snapshotLastMovementId: stock?.lastMovementId ?? null,
        expectedLastMovementId:
          movements.length > 0 ? movements[movements.length - 1].id : null,
      },
      batches: batchChecks,
      serializedSummary,
      serializedConsistency,
      consistent:
        numericEqual(expectedStock, actualStock) &&
        batchChecks.every((batch) => batch.consistent) &&
        (serializedConsistency?.consistent ?? true),
    };
  }

  async repairPreview(actor: any, input: any) {
    requireRole(actor, ADMIN_ROLES);
    const check = await this.rebuildCheck(actor, input);
    const preview = {
      warehouseId: check.warehouseId,
      productId: check.productId,
      stockPatch: check.stock.consistent
        ? null
        : {
            ...check.stock.expected,
            version: check.stock.snapshotVersion,
            lastMovementId: check.stock.expectedLastMovementId,
          },
      batchPatches: check.batches
        .filter((batch) => !batch.consistent)
        .map((batch) => ({
          batchId: batch.batchId,
          ...batch.expected,
        })),
    };
    return {
      ...check,
      repairPreview: preview,
      checksum: crypto
        .createHash('sha256')
        .update(canonicalJson(preview))
        .digest('hex'),
      writeApplied: false,
    };
  }

  private async execute(
    commandType: InventoryCommandType,
    actor: any,
    input: any,
    metadata: any,
  ) {
    requireRole(
      actor,
      commandType === 'UPDATE_BATCH_COST'
        ? COST_WRITE_ROLES
        : WRITE_ROLES,
    );
    assertAllowedCommandFields(commandType, input);
    const envelope = normalizeInventoryCommandEnvelope(commandType, input);
    for (
      let attempt = 1;
      attempt <= MAX_CONCURRENCY_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const result = await this.repository.runInTransaction(
          async (transaction) => {
            const receipt =
              await this.repository.createCommandReceipt(transaction, {
                sourceKey: envelope.sourceKey,
                idempotencyKey: envelope.idempotencyKey,
                commandType,
                requestHash: envelope.requestHash,
                status: 'PROCESSING',
                actorUserId: actorId(actor),
                actorNameSnapshot: actorName(actor),
                actorRoleSnapshot: actorRole(actor),
                requestId: boundedTraceId(metadata?.requestId),
              });
            const outcome = await this.applyCommand(
              transaction,
              commandType,
              actor,
              input,
              envelope,
              receipt,
            );
            await this.operationLogsService.appendLog(
              {
                userId: actorId(actor),
                actorNameSnapshot: actorName(actor),
                actorRoleSnapshot: actorRole(actor),
                action:
                  commandType === 'REVERSE'
                    ? 'inventory.reversal.posted'
                    : commandType === 'UPDATE_BATCH_COST'
                      ? 'inventory.batch_cost.updated'
                    : `inventory.${commandType.toLowerCase()}.posted`,
                module: 'inventory',
                operationType: 'UPDATE',
                entityType: 'inventory_document',
                entityId: outcome.documentId,
                beforeData: outcome.auditBefore ?? null,
                afterData:
                  outcome.auditAfter ??
                  buildRoleSafeAuditSnapshot(
                    commandType,
                    outcome,
                  ),
                requestSummary: {
                  sourceKey: envelope.sourceKey,
                  idempotencyKey: envelope.idempotencyKey,
                },
                requestId: boundedTraceId(metadata?.requestId),
                ipAddress: optionalBoundedString(
                  metadata?.ipAddress,
                  'ipAddress',
                  45,
                ),
              },
              transaction,
            );
            const postCommitTask =
              await this.repository.createPostCommitTask(transaction, {
                sourceKey: `${envelope.sourceKey}:post-commit`,
                commandReceiptId: receipt.id,
                taskType: 'REFRESH_INVENTORY_DERIVED_STATE',
                payload: {
                  commandReceiptId: receipt.id,
                  documentId: outcome.documentId,
                  warehouseProductPairs:
                    uniqueWarehouseProductPairs([
                      ...outcome.stockChanges,
                      ...outcome.batchChanges,
                    ]),
                },
                status: 'PENDING',
              });
            const resultSnapshot = {
              commandReceiptId: receipt.id,
              documentId: outcome.documentId,
              documentNo: outcome.documentNo,
              movementIds: outcome.movementIds,
              stockChanges: outcome.stockChanges,
              batchChanges: outcome.batchChanges,
              reservation: outcome.reservation,
              reversalOfDocumentId:
                outcome.reversalOfDocumentId ?? null,
              batchCostChange:
                outcome.batchCostChange ?? null,
              postCommitTaskId: postCommitTask.id,
            };
            await this.repository.completeCommandReceipt(
              transaction,
              receipt.id,
              outcome.documentId,
              resultSnapshot,
            );
            return resultSnapshot;
          },
        );
        await this.postCommitService.dispatchForReceipt(
          result.commandReceiptId,
        );
        return {
          ...result,
          replayed: false,
        };
      } catch (error) {
        const replay = await this.resolveIdempotentReplay(
          envelope.idempotencyKey,
          envelope.requestHash,
        );
        if (replay) {
          await this.postCommitService.dispatchForReceipt(
            replay.commandReceiptId,
          );
          return replay;
        }
        if (
          isRetryableConcurrencyError(error) &&
          attempt < MAX_CONCURRENCY_ATTEMPTS
        ) {
          continue;
        }
        throw mapInventoryWriteError(error);
      }
    }
    throw concurrentUpdateError();
  }

  private async resolveIdempotentReplay(
    idempotencyKey: string,
    requestHash: string,
    database?: any,
  ) {
    const receipt =
      await this.repository.findCommandReceipt(
        idempotencyKey,
        database,
      );
    if (!receipt) {
      return null;
    }
    if (receipt.requestHash !== requestHash) {
      throw createHttpError(
        409,
        'INVENTORY_IDEMPOTENCY_KEY_CONFLICT',
        'The idempotency key was already used for different command content.',
      );
    }
    if (receipt.status !== 'SUCCEEDED' || !receipt.resultSnapshot) {
      throw createHttpError(
        409,
        'INVENTORY_COMMAND_IN_PROGRESS',
        'The inventory command is still being processed.',
      );
    }
    return {
      ...(receipt.resultSnapshot as any),
      replayed: true,
    };
  }

  private applyCommand(
    transaction: any,
    commandType: InventoryCommandType,
    actor: any,
    input: any,
    envelope: any,
    receipt: any,
  ): Promise<CommandOutcome> {
    switch (commandType) {
      case 'INBOUND':
        return this.applyInbound(
          transaction,
          actor,
          input,
          envelope,
          receipt,
        );
      case 'RESERVE':
        return this.applyReserve(
          transaction,
          actor,
          input,
          envelope,
          receipt,
        );
      case 'RELEASE':
        return this.applyRelease(
          transaction,
          actor,
          input,
          envelope,
          receipt,
        );
      case 'OUTBOUND':
        return this.applyOutbound(
          transaction,
          actor,
          input,
          envelope,
          receipt,
        );
      case 'TRANSFER_OUT':
        return this.applyTransferOut(
          transaction,
          actor,
          input,
          envelope,
          receipt,
        );
      case 'TRANSFER_IN':
        return this.applyTransferIn(
          transaction,
          actor,
          input,
          envelope,
          receipt,
        );
      case 'MARK_UNAVAILABLE':
      case 'RESTORE_AVAILABLE':
        return this.applyUnavailableChange(
          transaction,
          commandType,
          actor,
          input,
          envelope,
          receipt,
        );
      case 'UPDATE_BATCH_COST':
        return this.applyBatchCostUpdate(
          transaction,
          actor,
          input,
          envelope,
          receipt,
        );
      case 'REVERSE':
        return this.applyReversal(
          transaction,
          actor,
          input,
          envelope,
          receipt,
        );
    }
  }

  private async applyTransferCreate(
    transaction: any,
    actor: any,
    input: any,
    envelope: any,
    receipt: any,
  ): Promise<TransferCommandOutcome> {
    const fromWarehouse = await this.loadActiveWarehouse(
      transaction,
      requiredId(input.fromWarehouseId, 'fromWarehouseId'),
    );
    const toWarehouse = await this.loadActiveWarehouse(
      transaction,
      requiredId(input.toWarehouseId, 'toWarehouseId'),
    );
    assertDifferentWarehouses(fromWarehouse.id, toWarehouse.id);
    const normalizedLines = normalizeTransferCreateLines(input.lines);
    const productIds = new Set<string>();
    const preparedLines = [];
    for (const [index, line] of normalizedLines.entries()) {
      if (productIds.has(line.productId)) {
        throw createHttpError(
          409,
          'INVENTORY_TRANSFER_PRODUCT_DUPLICATE',
          'A product can appear only once in a transfer.',
        );
      }
      productIds.add(line.productId);
      const product = await this.loadTransferProduct(
        transaction,
        line.productId,
      );
      let serializedUnitIds: string[] | null = null;
      if (product.inventoryTrackingMode === 'SERIALIZED') {
        serializedUnitIds =
          this.serializedAdapter.validateTransferContract(
            line.unitIds,
            line.plannedQty,
            `lines[${index}].unitIds`,
          );
      } else if (line.unitIds !== null) {
        throw validationError(
          `lines[${index}].unitIds is only valid for SERIALIZED products.`,
        );
      }
      preparedLines.push({
        ...line,
        product,
        serializedUnitIds,
      });
    }
    const transfer = await this.repository.createTransfer(
      transaction,
      {
        transferNo: transferNumber(receipt.id),
        sourceKey: envelope.sourceKey,
        fromWarehouseId: fromWarehouse.id,
        toWarehouseId: toWarehouse.id,
        status: 'DRAFT',
        notes: optionalBoundedString(
          input.notes,
          'notes',
          2_000,
        ),
        version: 0,
        createdById: actorId(actor),
        updatedById: actorId(actor),
      },
    );
    const createdLines = [];
    for (const [index, line] of preparedLines.entries()) {
      createdLines.push(
        await this.repository.createTransferLine(transaction, {
          transferId: transfer.id,
          lineNo: index + 1,
          sourceLineKey: line.sourceLineKey,
          productId: line.product.id,
          trackingModeSnapshot:
            line.product.inventoryTrackingMode,
          plannedQty: line.plannedQty,
          outboundQty: 0,
          receivedQty: 0,
          unavailableQty: 0,
          differenceQty: 0,
          serializedUnitIds: line.serializedUnitIds,
          notes: line.notes,
          version: 0,
        }),
      );
    }
    const snapshot = transferSnapshot(
      {
        ...transfer,
        fromWarehouse,
        toWarehouse,
      },
      createdLines.map((line, index) => ({
        ...line,
        product: preparedLines[index].product,
      })),
    );
    return {
      transferId: transfer.id,
      receiptId: null,
      documentIds: [],
      movementIds: [],
      stockChanges: [],
      transfer: snapshot,
      auditAfter: transferAuditSnapshot(snapshot),
    };
  }

  private async applyTransferOutboundConfirmation(
    transaction: any,
    actor: any,
    input: any,
    envelope: any,
    receipt: any,
  ): Promise<TransferCommandOutcome> {
    const transfer = await this.loadTransferForMutation(
      transaction,
      requiredId(input.transferId, 'transferId'),
    );
    if (transfer.status !== 'DRAFT') {
      throw createHttpError(
        409,
        'INVENTORY_TRANSFER_NOT_DRAFT',
        'Only a draft transfer can be confirmed outbound.',
      );
    }
    await this.loadActiveWarehouse(
      transaction,
      transfer.fromWarehouseId,
    );
    await this.loadActiveWarehouse(
      transaction,
      transfer.toWarehouseId,
    );
    const businessAt = commandBusinessAt(input);
    const document = await this.createTransferDocumentHeader(
      transaction,
      actor,
      receipt,
      envelope,
      {
        type: 'TRANSFER_OUT',
        warehouseId: transfer.fromWarehouseId,
        fromWarehouseId: transfer.fromWarehouseId,
        toWarehouseId: transfer.toWarehouseId,
        sourceId: transfer.id,
        businessAt,
        reason: commandReason(input),
      },
    );
    const sortedLines = [...transfer.lines].sort(
      transferLineComparator,
    );
    const stockByProduct = new Map<string, any>();
    for (const line of sortedLines) {
      stockByProduct.set(
        line.productId,
        await this.repository.getOrCreateStock(
          transaction,
          transfer.fromWarehouseId,
          line.productId,
        ),
      );
    }
    const movements = [];
    const stockChanges = [];
    const projectedLines = [];
    for (const line of transfer.lines) {
      const documentLine =
        await this.repository.createDocumentLine(transaction, {
          documentId: document.id,
          lineNo: line.lineNo,
          productId: line.productId,
          batchId: null,
          quantity: line.plannedQty,
          condition: 'SALEABLE',
          productNameSnapshot: line.product.name,
          unitSnapshot: line.product.unit,
          purchaseUnitCostCents: null,
          notes: line.notes,
        });
      const serialized =
        line.trackingModeSnapshot === 'SERIALIZED' ||
        line.product.inventoryTrackingMode === 'SERIALIZED';
      const lineMovements = [];
      if (serialized) {
        const unitIds = this.serializedAdapter.validateTransferContract(
          line.serializedUnitIds,
          line.plannedQty,
          `transfer.lines[${line.lineNo}].serializedUnitIds`,
        );
        const units: any[] =
          await this.serializedAdapter.transitionTransferOutboundInTransaction(
            transaction,
            actor,
            {
              unitIds,
              productId: line.productId,
              fromWarehouseId: transfer.fromWarehouseId,
            },
          );
        for (const [unitIndex, unit] of units.entries()) {
          lineMovements.push(
            await this.createMovement(
              transaction,
              actor,
              envelope,
              { ...document, line: documentLine },
              {
                sourceKey: `${envelope.sourceKey}:line:${line.lineNo}:unit:${unitIndex + 1}:out`,
                warehouseId: transfer.fromWarehouseId,
                product: line.product,
                serializedUnitId: unit.id,
                movementType: 'TRANSFER_OUT',
                onHandDelta: -1,
                inTransitDelta: 1,
                purchaseUnitCostCents: unit.purchaseCostCents,
              },
            ),
          );
        }
      } else {
        lineMovements.push(
          await this.createMovement(
            transaction,
            actor,
            envelope,
            { ...document, line: documentLine },
            {
              sourceKey: `${envelope.sourceKey}:line:${line.lineNo}:out`,
              warehouseId: transfer.fromWarehouseId,
              product: line.product,
              movementType: 'TRANSFER_OUT',
              onHandDelta: -line.plannedQty,
              inTransitDelta: line.plannedQty,
            },
          ),
        );
      }
      movements.push(...lineMovements);
      stockChanges.push(
        await this.applyStockSnapshot(
          transaction,
          stockByProduct.get(line.productId),
          {
            ...ZERO_STOCK_DELTA,
            onHandDelta: -line.plannedQty,
            inTransitDelta: line.plannedQty,
          },
          lineMovements[lineMovements.length - 1].id,
        ),
      );
      const changed =
        await this.repository.updateTransferLineWithVersion(
          transaction,
          line,
          {
            outboundQty: { increment: line.plannedQty },
          },
        );
      if (changed.count !== 1) {
        throw concurrentUpdateError();
      }
      projectedLines.push({
        ...line,
        outboundQty: line.plannedQty,
        version: line.version + 1,
      });
    }
    const updated =
      await this.repository.updateTransferWithVersion(
        transaction,
        transfer,
        {
          status: 'OUTBOUND',
          outboundDocumentId: document.id,
          outboundSourceKey: envelope.sourceKey,
          outboundIdempotencyKey: envelope.idempotencyKey,
          outboundRequestHash: envelope.requestHash,
          outboundById: actorId(actor),
          outboundByName: actorName(actor),
          outboundByRole: actorRole(actor),
          outboundAt: new Date(),
          updatedById: actorId(actor),
        },
      );
    if (updated.count !== 1) {
      throw concurrentUpdateError();
    }
    const before = transferSnapshot(transfer, transfer.lines);
    const after = transferSnapshot(
      {
        ...transfer,
        status: 'OUTBOUND',
        outboundDocumentId: document.id,
        outboundAt: new Date(),
        version: transfer.version + 1,
      },
      projectedLines,
      stockChanges,
    );
    return {
      transferId: transfer.id,
      receiptId: null,
      documentIds: [document.id],
      movementIds: movements.map((movement) => movement.id),
      stockChanges,
      transfer: after,
      auditBefore: transferAuditSnapshot(before),
      auditAfter: transferAuditSnapshot(after),
    };
  }

  private async applyTransferReceipt(
    transaction: any,
    actor: any,
    input: any,
    envelope: any,
    commandReceipt: any,
  ): Promise<TransferCommandOutcome> {
    const transfer = await this.loadTransferForMutation(
      transaction,
      requiredId(input.transferId, 'transferId'),
    );
    if (
      !['OUTBOUND', 'PARTIALLY_RECEIVED'].includes(
        transfer.status,
      )
    ) {
      throw createHttpError(
        409,
        'INVENTORY_TRANSFER_NOT_RECEIVABLE',
        'Only an outbound or partially received transfer can be received.',
      );
    }
    await this.loadActiveWarehouse(
      transaction,
      transfer.fromWarehouseId,
    );
    await this.loadActiveWarehouse(
      transaction,
      transfer.toWarehouseId,
    );
    const requestedLines = normalizeTransferReceiptLines(input.lines);
    const transferLineById = new Map(
      transfer.lines.map((line: any) => [line.id, line]),
    );
    const prepared = requestedLines.map((line, index) => {
      const current: any = transferLineById.get(
        line.transferLineId,
      );
      if (!current) {
        throw createHttpError(
          409,
          'INVENTORY_TRANSFER_LINE_MISMATCH',
          `lines[${index}] does not belong to this transfer.`,
        );
      }
      const remaining =
        current.outboundQty -
        current.receivedQty -
        current.differenceQty;
      if (line.receivedQty + line.differenceQty > remaining) {
        throw createHttpError(
          409,
          'INVENTORY_TRANSFER_RECEIPT_EXCEEDS_OUTBOUND',
          'The receipt would exceed the remaining outbound quantity.',
        );
      }
      const serialized =
        current.trackingModeSnapshot === 'SERIALIZED' ||
        current.product.inventoryTrackingMode === 'SERIALIZED';
      if (serialized) {
        const unitIds = line.unitIds ?? [];
        const unavailableUnitIds =
          line.unavailableUnitIds ?? [];
        const differenceUnitIds =
          line.differenceUnitIds ?? [];
        if (unitIds.length !== line.receivedQty) {
          throw validationError(
            `lines[${index}].unitIds count must equal receivedQty for a serialized product.`,
          );
        }
        if (
          unavailableUnitIds.length !== line.unavailableQty
        ) {
          throw validationError(
            `lines[${index}].unavailableUnitIds count must equal unavailableQty for a serialized product.`,
          );
        }
        if (
          differenceUnitIds.length !== line.differenceQty
        ) {
          throw validationError(
            `lines[${index}].differenceUnitIds count must equal differenceQty for a serialized product.`,
          );
        }
      } else if (
        line.unitIds !== null ||
        line.unavailableUnitIds !== null ||
        line.differenceUnitIds !== null
      ) {
        throw validationError(
          `lines[${index}] unit ID fields are only valid for SERIALIZED products.`,
        );
      }
      return {
        ...line,
        current,
        serialized,
      };
    });
    const totalReceived = prepared.reduce(
      (sum, line) => sum + line.receivedQty,
      0,
    );
    const totalDifference = prepared.reduce(
      (sum, line) => sum + line.differenceQty,
      0,
    );
    const businessAt = commandBusinessAt(input);
    const document = await this.createTransferDocumentHeader(
      transaction,
      actor,
      commandReceipt,
      envelope,
      {
        type:
          totalReceived === 0 && totalDifference > 0
            ? 'TRANSFER_DIFFERENCE'
            : 'TRANSFER_IN',
        warehouseId: transfer.toWarehouseId,
        fromWarehouseId: transfer.fromWarehouseId,
        toWarehouseId: transfer.toWarehouseId,
        sourceId: transfer.id,
        businessAt,
        reason:
          totalDifference > 0
            ? requiredCorrectionReason(input.reason)
            : commandReason(input),
      },
    );
    const transferReceipt =
      await this.repository.createTransferReceipt(transaction, {
        receiptNo: transferReceiptNumber(commandReceipt.id),
        transferId: transfer.id,
        warehouseId: transfer.toWarehouseId,
        sourceKey: envelope.sourceKey,
        idempotencyKey: envelope.idempotencyKey,
        requestHash: envelope.requestHash,
        status: 'POSTED',
        resultDocumentId: document.id,
        confirmedById: actorId(actor),
        confirmedByNameSnapshot: actorName(actor),
        confirmedByRoleSnapshot: actorRole(actor),
        confirmedAt: new Date(),
        notes: optionalBoundedString(
          input.notes,
          'notes',
          2_000,
        ),
        version: 0,
      });
    const stockKeys = prepared
      .flatMap((line) => [
        {
          warehouseId: transfer.fromWarehouseId,
          productId: line.current.productId,
        },
        {
          warehouseId: transfer.toWarehouseId,
          productId: line.current.productId,
        },
      ])
      .sort(stockKeyComparator);
    const stockByKey = new Map<string, any>();
    for (const key of stockKeys) {
      const mapKey = `${key.warehouseId}\u0000${key.productId}`;
      if (!stockByKey.has(mapKey)) {
        stockByKey.set(
          mapKey,
          await this.repository.getOrCreateStock(
            transaction,
            key.warehouseId,
            key.productId,
          ),
        );
      }
    }
    const movements = [];
    const stockChanges = [];
    const projectedLineById = new Map(
      transfer.lines.map((line: any) => [line.id, { ...line }]),
    );
    for (const [index, line] of prepared.entries()) {
      const current = line.current;
      const documentLine =
        await this.repository.createDocumentLine(transaction, {
          documentId: document.id,
          lineNo: index + 1,
          productId: current.productId,
          batchId: null,
          quantity: line.receivedQty + line.differenceQty,
          condition:
            line.receivedQty > 0 &&
            line.unavailableQty === line.receivedQty
              ? 'UNAVAILABLE'
              : 'SALEABLE',
          productNameSnapshot: current.product.name,
          unitSnapshot: current.product.unit,
          purchaseUnitCostCents: null,
          notes: line.notes,
        });
      const sourceMovements = [];
      let serializedTransition: any = null;
      if (line.serialized) {
        serializedTransition =
          await this.serializedAdapter.transitionTransferReceiptInTransaction(
            transaction,
            actor,
            {
              receivedUnitIds: line.unitIds,
              unavailableUnitIds: line.unavailableUnitIds,
              differenceUnitIds: line.differenceUnitIds,
              productId: current.productId,
              fromWarehouseId: transfer.fromWarehouseId,
              toWarehouseId: transfer.toWarehouseId,
              transferUnitIds: this.serializedAdapter.validateTransferContract(
                current.serializedUnitIds,
                current.plannedQty,
                `transfer.lines[${current.lineNo}].serializedUnitIds`,
              ),
            },
          );
        for (const [unitIndex, unit] of (
          serializedTransition.receivedUnits || []
        ).entries()) {
          sourceMovements.push(
            await this.createMovement(
              transaction,
              actor,
              envelope,
              { ...document, line: documentLine },
              {
                sourceKey: `${envelope.sourceKey}:line:${index + 1}:unit:${unitIndex + 1}:source-receive`,
                warehouseId: transfer.fromWarehouseId,
                product: current.product,
                serializedUnitId: unit.id,
                movementType: 'TRANSFER_IN',
                inTransitDelta: -1,
                purchaseUnitCostCents: unit.purchaseCostCents,
              },
            ),
          );
        }
        for (const [unitIndex, unit] of (
          serializedTransition.differenceUnits || []
        ).entries()) {
          sourceMovements.push(
            await this.createMovement(
              transaction,
              actor,
              envelope,
              { ...document, line: documentLine },
              {
                sourceKey: `${envelope.sourceKey}:line:${index + 1}:unit:${unitIndex + 1}:difference`,
                warehouseId: transfer.fromWarehouseId,
                product: current.product,
                serializedUnitId: unit.id,
                movementType: 'TRANSFER_DIFFERENCE',
                inTransitDelta: -1,
                purchaseUnitCostCents: unit.purchaseCostCents,
              },
            ),
          );
        }
      } else {
        if (line.receivedQty > 0) {
          sourceMovements.push(
            await this.createMovement(
              transaction,
              actor,
              envelope,
              { ...document, line: documentLine },
              {
                sourceKey: `${envelope.sourceKey}:line:${index + 1}:source-receive`,
                warehouseId: transfer.fromWarehouseId,
                product: current.product,
                movementType: 'TRANSFER_IN',
                inTransitDelta: -line.receivedQty,
              },
            ),
          );
        }
        if (line.differenceQty > 0) {
          sourceMovements.push(
            await this.createMovement(
              transaction,
              actor,
              envelope,
              { ...document, line: documentLine },
              {
                sourceKey: `${envelope.sourceKey}:line:${index + 1}:difference`,
                warehouseId: transfer.fromWarehouseId,
                product: current.product,
                movementType: 'TRANSFER_DIFFERENCE',
                inTransitDelta: -line.differenceQty,
              },
            ),
          );
        }
      }
      movements.push(...sourceMovements);
      const sourceStock = stockByKey.get(
        `${transfer.fromWarehouseId}\u0000${current.productId}`,
      );
      const closedTransitQty =
        line.receivedQty + line.differenceQty;
      if (sourceStock.inTransitQty < closedTransitQty) {
        throw createHttpError(
          409,
          'INVENTORY_TRANSFER_RECEIPT_EXCEEDS_TRANSIT',
          'The receipt would make the transfer in-transit quantity negative.',
        );
      }
      stockChanges.push(
        await this.applyStockSnapshot(
          transaction,
          sourceStock,
          {
            ...ZERO_STOCK_DELTA,
            inTransitDelta: -closedTransitQty,
          },
          sourceMovements[sourceMovements.length - 1].id,
        ),
      );
      if (line.receivedQty > 0) {
        const targetMovements = [];
        if (line.serialized) {
          const unavailableIds = new Set(line.unavailableUnitIds);
          for (const [unitIndex, unit] of (
            serializedTransition.receivedUnits || []
          ).entries()) {
            targetMovements.push(
              await this.createMovement(
                transaction,
                actor,
                envelope,
                { ...document, line: documentLine },
                {
                  sourceKey: `${envelope.sourceKey}:line:${index + 1}:unit:${unitIndex + 1}:target`,
                  warehouseId: transfer.toWarehouseId,
                  product: current.product,
                  serializedUnitId: unit.id,
                  movementType: 'TRANSFER_IN',
                  onHandDelta: 1,
                  unavailableDelta: unavailableIds.has(unit.id)
                    ? 1
                    : 0,
                  purchaseUnitCostCents: unit.purchaseCostCents,
                },
              ),
            );
          }
        } else {
          targetMovements.push(
            await this.createMovement(
              transaction,
              actor,
              envelope,
              { ...document, line: documentLine },
              {
                sourceKey: `${envelope.sourceKey}:line:${index + 1}:target`,
                warehouseId: transfer.toWarehouseId,
                product: current.product,
                movementType: 'TRANSFER_IN',
                onHandDelta: line.receivedQty,
                unavailableDelta: line.unavailableQty,
              },
            ),
          );
        }
        movements.push(...targetMovements);
        stockChanges.push(
          await this.applyStockSnapshot(
            transaction,
            stockByKey.get(
              `${transfer.toWarehouseId}\u0000${current.productId}`,
            ),
            {
              ...ZERO_STOCK_DELTA,
              onHandDelta: line.receivedQty,
              unavailableDelta: line.unavailableQty,
            },
            targetMovements[targetMovements.length - 1].id,
          ),
        );
      }
      await this.repository.createTransferReceiptLine(
        transaction,
        {
          receiptId: transferReceipt.id,
          transferLineId: current.id,
          lineNo: index + 1,
          receivedQty: line.receivedQty,
          unavailableQty: line.unavailableQty,
          differenceQty: line.differenceQty,
          serializedUnitIds: line.serialized
            ? {
                received: line.unitIds,
                unavailable: line.unavailableUnitIds,
                difference: line.differenceUnitIds,
              }
            : null,
          notes: line.notes,
        },
      );
      const changed =
        await this.repository.updateTransferLineWithVersion(
          transaction,
          current,
          {
            receivedQty: { increment: line.receivedQty },
            unavailableQty: {
              increment: line.unavailableQty,
            },
            differenceQty: {
              increment: line.differenceQty,
            },
          },
        );
      if (changed.count !== 1) {
        throw concurrentUpdateError();
      }
      projectedLineById.set(current.id, {
        ...current,
        receivedQty:
          current.receivedQty + line.receivedQty,
        unavailableQty:
          current.unavailableQty + line.unavailableQty,
        differenceQty:
          current.differenceQty + line.differenceQty,
        version: current.version + 1,
      });
    }
    const projectedLines = transfer.lines.map((line: any) =>
      projectedLineById.get(line.id),
    );
    const nextStatus = transferStatusForLines(projectedLines);
    const updated =
      await this.repository.updateTransferWithVersion(
        transaction,
        transfer,
        {
          status: nextStatus,
          updatedById: actorId(actor),
        },
      );
    if (updated.count !== 1) {
      throw concurrentUpdateError();
    }
    const before = transferSnapshot(transfer, transfer.lines);
    const after = transferSnapshot(
      {
        ...transfer,
        status: nextStatus,
        version: transfer.version + 1,
      },
      projectedLines,
      stockChanges,
    );
    return {
      transferId: transfer.id,
      receiptId: transferReceipt.id,
      documentIds: [document.id],
      movementIds: movements.map((movement) => movement.id),
      stockChanges,
      transfer: after,
      auditBefore: transferAuditSnapshot(before),
      auditAfter: {
        ...transferAuditSnapshot(after),
        receipt: {
          id: transferReceipt.id,
          receivedQty: totalReceived,
          differenceQty: totalDifference,
        },
      },
    };
  }

  private async applyTransferReceiptReversal(
    transaction: any,
    actor: any,
    input: any,
    envelope: any,
    commandReceipt: any,
  ): Promise<TransferCommandOutcome> {
    const originalReceipt =
      await this.repository.findTransferReceipt(
        transaction,
        requiredId(input.receiptId, 'receiptId'),
      );
    if (!originalReceipt) {
      throw createHttpError(
        404,
        'INVENTORY_TRANSFER_RECEIPT_NOT_FOUND',
        'The transfer receipt does not exist.',
      );
    }
    if (
      originalReceipt.status !== 'POSTED' ||
      originalReceipt.reversedByReceipt
    ) {
      throw createHttpError(
        409,
        'INVENTORY_TRANSFER_RECEIPT_ALREADY_REVERSED',
        'The transfer receipt has already been reversed.',
      );
    }
    const reason = requiredCorrectionReason(input.reason);
    const transfer = originalReceipt.transfer;
    for (const receiptLine of originalReceipt.lines) {
      const serialized = serializedReceiptUnitSnapshot(
        receiptLine.serializedUnitIds,
      );
      if (
        serialized.received.length > 0 ||
        serialized.difference.length > 0
      ) {
        await this.serializedAdapter.reverseTransferReceiptUnitsInTransaction(
          transaction,
          actor,
          {
            receivedUnitIds: serialized.received,
            unavailableUnitIds: serialized.unavailable,
            differenceUnitIds: serialized.difference,
            fromWarehouseId: transfer.fromWarehouseId,
            toWarehouseId: transfer.toWarehouseId,
          },
        );
      }
    }
    const reversal = await this.applyReversal(
      transaction,
      actor,
      {
        documentId: originalReceipt.resultDocumentId,
        documentScope: 'TRANSFER_RECEIPT',
        reason,
        businessAt: input.businessAt,
      },
      envelope,
      commandReceipt,
    );
    const currentLineById = new Map(
      transfer.lines.map((line: any) => [line.id, line]),
    );
    const projectedLineById = new Map(
      transfer.lines.map((line: any) => [line.id, { ...line }]),
    );
    for (const receiptLine of originalReceipt.lines) {
      const current: any = currentLineById.get(
        receiptLine.transferLineId,
      );
      if (
        !current ||
        current.receivedQty < receiptLine.receivedQty ||
        current.unavailableQty <
          receiptLine.unavailableQty ||
        current.differenceQty < receiptLine.differenceQty
      ) {
        throw createHttpError(
          409,
          'INVENTORY_TRANSFER_RECEIPT_REVERSAL_CONFLICT',
          'The transfer cumulative snapshot cannot reverse this receipt.',
        );
      }
      const changed =
        await this.repository.updateTransferLineWithVersion(
          transaction,
          current,
          {
            receivedQty: {
              increment: -receiptLine.receivedQty,
            },
            unavailableQty: {
              increment: -receiptLine.unavailableQty,
            },
            differenceQty: {
              increment: -receiptLine.differenceQty,
            },
          },
        );
      if (changed.count !== 1) {
        throw concurrentUpdateError();
      }
      projectedLineById.set(current.id, {
        ...current,
        receivedQty:
          current.receivedQty - receiptLine.receivedQty,
        unavailableQty:
          current.unavailableQty -
          receiptLine.unavailableQty,
        differenceQty:
          current.differenceQty -
          receiptLine.differenceQty,
        version: current.version + 1,
      });
    }
    const reversalReceipt =
      await this.repository.createTransferReceipt(transaction, {
        receiptNo: transferReceiptNumber(commandReceipt.id),
        transferId: transfer.id,
        warehouseId: transfer.toWarehouseId,
        sourceKey: envelope.sourceKey,
        idempotencyKey: envelope.idempotencyKey,
        requestHash: envelope.requestHash,
        status: 'POSTED',
        resultDocumentId: reversal.documentId,
        confirmedById: actorId(actor),
        confirmedByNameSnapshot: actorName(actor),
        confirmedByRoleSnapshot: actorRole(actor),
        confirmedAt: new Date(),
        reversalOfReceiptId: originalReceipt.id,
        notes: reason,
        version: 0,
      });
    for (const receiptLine of originalReceipt.lines) {
      await this.repository.createTransferReceiptLine(
        transaction,
        {
          receiptId: reversalReceipt.id,
          transferLineId: receiptLine.transferLineId,
          lineNo: receiptLine.lineNo,
          receivedQty: receiptLine.receivedQty,
          unavailableQty: receiptLine.unavailableQty,
          differenceQty: receiptLine.differenceQty,
          serializedUnitIds: receiptLine.serializedUnitIds,
          notes: reason,
        },
      );
    }
    const receiptUpdated =
      await this.repository.updateTransferReceiptWithVersion(
        transaction,
        originalReceipt,
        { status: 'REVERSED' },
      );
    if (receiptUpdated.count !== 1) {
      throw concurrentUpdateError();
    }
    const projectedLines = transfer.lines.map((line: any) =>
      projectedLineById.get(line.id),
    );
    const nextStatus = transferStatusForLines(projectedLines);
    const transferUpdated =
      await this.repository.updateTransferWithVersion(
        transaction,
        transfer,
        {
          status: nextStatus,
          updatedById: actorId(actor),
        },
      );
    if (transferUpdated.count !== 1) {
      throw concurrentUpdateError();
    }
    const before = transferSnapshot(transfer, transfer.lines);
    const after = transferSnapshot(
      {
        ...transfer,
        status: nextStatus,
        version: transfer.version + 1,
      },
      projectedLines,
      reversal.stockChanges,
    );
    return {
      transferId: transfer.id,
      receiptId: reversalReceipt.id,
      documentIds: [reversal.documentId],
      movementIds: reversal.movementIds,
      stockChanges: reversal.stockChanges,
      transfer: after,
      auditBefore: transferAuditSnapshot(before),
      auditAfter: {
        ...transferAuditSnapshot(after),
        reversedReceiptId: originalReceipt.id,
        reversalReceiptId: reversalReceipt.id,
      },
    };
  }

  private async applyTransferOutboundReversal(
    transaction: any,
    actor: any,
    input: any,
    envelope: any,
    commandReceipt: any,
  ): Promise<TransferCommandOutcome> {
    const transfer = await this.loadTransferForMutation(
      transaction,
      requiredId(input.transferId, 'transferId'),
    );
    if (
      transfer.status !== 'OUTBOUND' ||
      transfer.lines.some(
        (line: any) =>
          line.receivedQty > 0 || line.differenceQty > 0,
      )
    ) {
      throw createHttpError(
        409,
        'INVENTORY_TRANSFER_OUTBOUND_REVERSAL_BLOCKED',
        'Outbound transfer can only be reversed before receiving, or after every receipt and difference fact has been individually reversed.',
      );
    }
    const reason = requiredCorrectionReason(input.reason);
    for (const line of transfer.lines) {
      if (
        line.trackingModeSnapshot === 'SERIALIZED' ||
        line.product.inventoryTrackingMode === 'SERIALIZED'
      ) {
        await this.serializedAdapter.reverseTransferOutboundUnitsInTransaction(
          transaction,
          actor,
          {
            unitIds:
              this.serializedAdapter.validateTransferContract(
                line.serializedUnitIds,
                line.outboundQty,
                `transfer.lines[${line.lineNo}].serializedUnitIds`,
              ),
            fromWarehouseId: transfer.fromWarehouseId,
            productId: line.productId,
          },
        );
      }
    }
    const reversal = await this.applyReversal(
      transaction,
      actor,
      {
        documentId: transfer.outboundDocumentId,
        documentScope: 'TRANSFER_OUTBOUND',
        reason,
        businessAt: input.businessAt,
      },
      envelope,
      commandReceipt,
    );
    const projectedLines = [];
    for (const line of transfer.lines) {
      const changed =
        await this.repository.updateTransferLineWithVersion(
          transaction,
          line,
          {
            outboundQty: { increment: -line.outboundQty },
          },
        );
      if (changed.count !== 1) {
        throw concurrentUpdateError();
      }
      projectedLines.push({
        ...line,
        outboundQty: 0,
        version: line.version + 1,
      });
    }
    const updated =
      await this.repository.updateTransferWithVersion(
        transaction,
        transfer,
        {
          status: 'REVERSED',
          updatedById: actorId(actor),
        },
      );
    if (updated.count !== 1) {
      throw concurrentUpdateError();
    }
    const before = transferSnapshot(transfer, transfer.lines);
    const after = transferSnapshot(
      {
        ...transfer,
        status: 'REVERSED',
        version: transfer.version + 1,
      },
      projectedLines,
      reversal.stockChanges,
    );
    return {
      transferId: transfer.id,
      receiptId: null,
      documentIds: [reversal.documentId],
      movementIds: reversal.movementIds,
      stockChanges: reversal.stockChanges,
      transfer: after,
      auditBefore: transferAuditSnapshot(before),
      auditAfter: transferAuditSnapshot(after),
    };
  }

  private async loadTransferForMutation(
    transaction: any,
    id: string,
  ) {
    const transfer = await this.repository.findTransfer(
      transaction,
      id,
    );
    if (!transfer) {
      throw createHttpError(
        404,
        'INVENTORY_TRANSFER_NOT_FOUND',
        'The inventory transfer does not exist.',
      );
    }
    return transfer;
  }

  private async loadTransferProduct(
    transaction: any,
    id: string,
  ) {
    const product = await this.repository.findProduct(transaction, id);
    if (!product || !product.isActive) {
      throw createHttpError(
        404,
        'INVENTORY_PRODUCT_NOT_FOUND',
        'The inventory product does not exist or is inactive.',
      );
    }
    if (product.inventoryTrackingMode === 'NONE') {
      throw createHttpError(
        409,
        'INVENTORY_TRACKING_DISABLED',
        'Inventory tracking is disabled for this product.',
      );
    }
    return product;
  }

  private createTransferDocumentHeader(
    transaction: any,
    actor: any,
    receipt: any,
    envelope: any,
    input: any,
  ) {
    return this.repository.createDocument(transaction, {
      documentNo: documentNumber(receipt.id),
      type: input.type,
      status: 'POSTED',
      warehouseId: input.warehouseId,
      fromWarehouseId: input.fromWarehouseId,
      toWarehouseId: input.toWarehouseId,
      sourceType: receipt.commandType.toLowerCase(),
      sourceId: input.sourceId,
      sourceKey: envelope.sourceKey,
      requestHash: envelope.requestHash,
      businessAt: input.businessAt,
      postedById: actorId(actor),
      postedByNameSnapshot: actorName(actor),
      postedByRoleSnapshot: actorRole(actor),
      postedAt: new Date(),
      reason: input.reason ?? null,
      createdById: actorId(actor),
      updatedById: actorId(actor),
    });
  }

  private async applyInbound(
    transaction: any,
    actor: any,
    input: any,
    envelope: any,
    receipt: any,
  ) {
    const quantity = positiveQuantity(input.quantity);
    const kind = normalizeInboundKind(input.kind);
    const businessAt = commandBusinessAt(input);
    const warehouse = await this.loadActiveWarehouse(
      transaction,
      requiredId(input.warehouseId, 'warehouseId'),
    );
    const product = await this.loadQuantityProduct(
      transaction,
      requiredId(input.productId, 'productId'),
    );
    const stock = await this.repository.getOrCreateStock(
      transaction,
      warehouse.id,
      product.id,
    );
    const existingBatchId = optionalId(input.batchId, 'batchId');
    let batch = existingBatchId
      ? await this.loadMatchingBatch(
          transaction,
          existingBatchId,
          warehouse.id,
          product.id,
        )
      : null;
    const newBatchInput = input.batch;
    if (newBatchInput && existingBatchId) {
      throw validationError('batch and batchId cannot both be supplied.');
    }
    assertCostWriteAllowed(actor, newBatchInput);
    const purchaseUnitCostCents =
      optionalNonNegativeInteger(
        newBatchInput?.purchaseUnitCostCents,
        'batch.purchaseUnitCostCents',
      ) ?? batch?.purchaseUnitCostCents ?? null;
    const unavailable =
      purchaseUnitCostCents === null &&
      Boolean(newBatchInput || batch)
        ? quantity
        : typeof input.condition === 'string' &&
            input.condition.trim().toUpperCase() === 'UNAVAILABLE'
          ? quantity
          : 0;
    let sourceLineKey: string | null = null;
    let openingEntryKey: string | null = null;
    if (newBatchInput) {
      sourceLineKey = normalizedBusinessKey(
        newBatchInput.sourceLineKey ??
          `${envelope.sourceKey}:batch`,
        'batch.sourceLineKey',
      );
      const existingSourceLine =
        await this.repository.findBatchBySourceLineKey(
          transaction,
          sourceLineKey,
        );
      if (existingSourceLine) {
        throw createHttpError(
          409,
          'INVENTORY_SOURCE_LINE_KEY_CONFLICT',
          'The inbound source line already identifies another inventory batch.',
        );
      }
    }
    if (kind.documentType === 'OPENING') {
      openingEntryKey = openingKey(warehouse.id, product.id);
      await this.assertOpeningWorkflow(
        transaction,
        businessAt,
        openingEntryKey,
      );
    }
    const document = await this.createPostedDocument(
      transaction,
      actor,
      receipt,
      envelope,
      {
        type: kind.documentType,
        warehouseId: warehouse.id,
        product,
        quantity,
        condition: unavailable > 0 ? 'UNAVAILABLE' : 'SALEABLE',
        businessAt,
        reason: commandReason(input),
        sourceId: commandSourceId(input),
        notes: optionalBoundedString(
          input.notes,
          'notes',
          2_000,
        ),
        attachmentMetadata: normalizeAttachmentMetadata(
          input.attachmentMetadata,
        ),
        purchaseUnitCostCents,
      },
    );
    if (newBatchInput) {
      batch = await this.repository.createBatch(transaction, {
        warehouseId: warehouse.id,
        productId: product.id,
        sourceDocumentLineId: document.line.id,
        sourceLineKey,
        openingEntryKey,
        supplierName: optionalBoundedString(
          newBatchInput.supplierName,
          'batch.supplierName',
          160,
        ),
        purchaseOrderNo: optionalBoundedString(
          newBatchInput.purchaseOrderNo,
          'batch.purchaseOrderNo',
          80,
        ),
        productionBatch: optionalBoundedString(
          newBatchInput.productionBatch,
          'batch.productionBatch',
          80,
        ),
        productionDate: optionalBusinessDate(
          newBatchInput.productionDate,
          'batch.productionDate',
        ),
        receivedQty: 0,
        remainingQty: 0,
        unavailableQty: 0,
        purchaseUnitCostCents:
          document.purchaseUnitCostCents,
        costStatus:
          document.purchaseUnitCostCents === null
            ? 'PENDING'
            : 'COMPLETE',
        costCompletedById:
          document.purchaseUnitCostCents === null ? null : actorId(actor),
        costCompletedByName:
          document.purchaseUnitCostCents === null ? null : actorName(actor),
        costCompletedByRole:
          document.purchaseUnitCostCents === null ? null : actorRole(actor),
        costCompletedAt:
          document.purchaseUnitCostCents === null ? null : new Date(),
        fifoAt:
          optionalBusinessDate(
            newBatchInput.fifoAt,
            'batch.fifoAt',
          ) ?? document.businessAt,
        version: 0,
        createdById: actorId(actor),
        updatedById: actorId(actor),
      });
      await this.repository.setDocumentLineBatch(
        transaction,
        document.line.id,
        batch.id,
      );
    }
    const movement = await this.createMovement(
      transaction,
      actor,
      envelope,
      document,
      {
        sourceKey: `${envelope.sourceKey}:movement`,
        warehouseId: warehouse.id,
        product,
        batchId: batch?.id ?? null,
        movementType: kind.movementType,
        onHandDelta: quantity,
        unavailableDelta: unavailable,
        purchaseUnitCostCents:
          document.purchaseUnitCostCents,
      },
    );
    const stockChange = await this.applyStockSnapshot(
      transaction,
      stock,
      {
        ...ZERO_STOCK_DELTA,
        onHandDelta: quantity,
        unavailableDelta: unavailable,
      },
      movement.id,
    );
    const batchChanges = batch
      ? [
          await this.applyBatchSnapshot(transaction, batch, {
            receivedDelta: quantity,
            remainingDelta: quantity,
            unavailableDelta: unavailable,
          }),
        ]
      : [];
    return outcomeFrom(document, [movement], [stockChange], {
      batchChanges,
    });
  }

  private async assertOpeningWorkflow(
    transaction: any,
    businessAt: Date,
    openingEntryKey: string,
  ) {
    const configuration =
      await this.repository.findInventoryConfiguration(transaction);
    if (!configuration?.goLiveAt) {
      throw createHttpError(
        409,
        'INVENTORY_OPENING_WORKFLOW_NOT_CONFIGURED',
        'Opening inventory requires a configured inventory go-live time.',
      );
    }
    if (!configuration.maintenanceMode) {
      throw createHttpError(
        409,
        'INVENTORY_OPENING_WORKFLOW_NOT_ACTIVE',
        'Opening inventory is only available while inventory maintenance mode is active.',
      );
    }
    if (businessAt.getTime() > configuration.goLiveAt.getTime()) {
      throw createHttpError(
        409,
        'INVENTORY_OPENING_AFTER_GO_LIVE',
        'Opening inventory cannot be posted after the configured go-live time.',
      );
    }
    const existing =
      await this.repository.findBatchByOpeningEntryKey(
        transaction,
        openingEntryKey,
      );
    if (existing) {
      throw createHttpError(
        409,
        'INVENTORY_OPENING_ALREADY_EXISTS',
        'Opening inventory already exists for this warehouse and product.',
      );
    }
  }

  private async applyReserve(
    transaction: any,
    actor: any,
    input: any,
    envelope: any,
    receipt: any,
  ) {
    const quantity = positiveQuantity(input.quantity);
    const warehouse = await this.loadActiveWarehouse(
      transaction,
      requiredId(input.warehouseId, 'warehouseId'),
    );
    const product = await this.loadReservableProduct(
      transaction,
      requiredId(input.productId, 'productId'),
    );
    const salesOrderId = requiredId(
      input.salesOrderId,
      'salesOrderId',
    );
    const inventoryLineKey = normalizedBusinessKey(
      input.inventoryLineKey,
      'inventoryLineKey',
    );
    const stock = await this.repository.getOrCreateStock(
      transaction,
      warehouse.id,
      product.id,
    );
    let reservation =
      await this.repository.findReservationByOrderLine(
        transaction,
        salesOrderId,
        inventoryLineKey,
      );
    if (reservation) {
      assertReservationMatches(
        reservation,
        warehouse.id,
        product.id,
      );
    } else {
      reservation = await this.repository.createReservation(
        transaction,
        {
          sourceKey: `${envelope.sourceKey}:reservation`,
          salesOrderId,
          salesOrderItemId: optionalId(
            input.salesOrderItemId,
            'salesOrderItemId',
          ),
          inventoryLineKey,
          warehouseId: warehouse.id,
          productId: product.id,
          requestedQty: 0,
          reservedQty: 0,
          assignedQty: 0,
          outboundQty: 0,
          status: 'OPEN',
          version: 0,
        },
      );
    }
    const document = await this.createPostedDocument(
      transaction,
      actor,
      receipt,
      envelope,
      {
        type: 'RESERVATION_ADJUSTMENT',
        warehouseId: warehouse.id,
        product,
        quantity,
        businessAt: commandBusinessAt(input),
        reason: commandReason(input),
        sourceId: commandSourceId(input) ?? salesOrderId,
      },
    );
    const movement = await this.createMovement(
      transaction,
      actor,
      envelope,
      document,
      {
        sourceKey: `${envelope.sourceKey}:movement`,
        warehouseId: warehouse.id,
        product,
        reservationId: reservation.id,
        movementType: 'RESERVE',
        reservedDelta: quantity,
      },
    );
    const stockChange = await this.applyStockSnapshot(
      transaction,
      stock,
      {
        ...ZERO_STOCK_DELTA,
        reservedDelta: quantity,
      },
      movement.id,
    );
    const reservationResult =
      await this.applyReservationSnapshot(transaction, reservation, {
        requestedQty: reservation.requestedQty + quantity,
        reservedQty: reservation.reservedQty + quantity,
        assignedQty: reservation.assignedQty,
        outboundQty: reservation.outboundQty,
        status: 'RESERVED',
        releasedAt: null,
      });
    return outcomeFrom(document, [movement], [stockChange], {
      reservation: reservationResult,
    });
  }

  private async applyRelease(
    transaction: any,
    actor: any,
    input: any,
    envelope: any,
    receipt: any,
  ) {
    const quantity = positiveQuantity(input.quantity);
    const reservation = await this.loadReservation(
      transaction,
      requiredId(input.reservationId, 'reservationId'),
    );
    if (reservation.reservedQty < quantity) {
      throw createHttpError(
        409,
        'INVENTORY_RESERVATION_INSUFFICIENT',
        'The reservation does not contain enough quantity to release.',
      );
    }
    const [warehouse, product, stock] = await Promise.all([
      this.loadActiveWarehouse(transaction, reservation.warehouseId),
      this.loadReservableProduct(transaction, reservation.productId),
      this.repository.getOrCreateStock(
        transaction,
        reservation.warehouseId,
        reservation.productId,
      ),
    ]);
    const document = await this.createPostedDocument(
      transaction,
      actor,
      receipt,
      envelope,
      {
        type: 'RESERVATION_ADJUSTMENT',
        warehouseId: warehouse.id,
        product,
        quantity,
        businessAt: commandBusinessAt(input),
        reason: commandReason(input),
        sourceId: commandSourceId(input) ?? reservation.salesOrderId,
      },
    );
    const movement = await this.createMovement(
      transaction,
      actor,
      envelope,
      document,
      {
        sourceKey: `${envelope.sourceKey}:movement`,
        warehouseId: warehouse.id,
        product,
        reservationId: reservation.id,
        movementType: 'RELEASE',
        reservedDelta: -quantity,
      },
    );
    const stockChange = await this.applyStockSnapshot(
      transaction,
      stock,
      {
        ...ZERO_STOCK_DELTA,
        reservedDelta: -quantity,
      },
      movement.id,
    );
    const nextReserved = reservation.reservedQty - quantity;
    const reservationResult =
      await this.applyReservationSnapshot(transaction, reservation, {
        requestedQty: Math.max(
          reservation.outboundQty + nextReserved,
          reservation.requestedQty - quantity,
        ),
        reservedQty: nextReserved,
        assignedQty: reservation.assignedQty,
        outboundQty: reservation.outboundQty,
        status:
          nextReserved === 0
            ? 'RELEASED'
            : 'PARTIAL',
        releasedAt: nextReserved === 0 ? new Date() : null,
      });
    return outcomeFrom(document, [movement], [stockChange], {
      reservation: reservationResult,
    });
  }

  private async applyOutbound(
    transaction: any,
    actor: any,
    input: any,
    envelope: any,
    receipt: any,
  ) {
    const quantity = positiveQuantity(input.quantity);
    const warehouse = await this.loadActiveWarehouse(
      transaction,
      requiredId(input.warehouseId, 'warehouseId'),
    );
    const product = await this.loadQuantityProduct(
      transaction,
      requiredId(input.productId, 'productId'),
    );
    const stock = await this.repository.getOrCreateStock(
      transaction,
      warehouse.id,
      product.id,
    );
    const reservationId = optionalId(
      input.reservationId,
      'reservationId',
    );
    const reservation = reservationId
      ? await this.loadReservation(transaction, reservationId)
      : null;
    if (reservation) {
      assertReservationMatches(
        reservation,
        warehouse.id,
        product.id,
      );
      if (reservation.reservedQty < quantity) {
        throw createHttpError(
          409,
          'INVENTORY_RESERVATION_INSUFFICIENT',
          'The reservation does not contain enough quantity to consume.',
        );
      }
    }
    const batchId = optionalId(input.batchId, 'batchId');
    const batch = batchId
      ? await this.loadMatchingBatch(
          transaction,
          batchId,
          warehouse.id,
          product.id,
        )
      : null;
    if (batch && batch.remainingQty < quantity) {
      throw createHttpError(
        409,
        'INVENTORY_BATCH_INSUFFICIENT',
        'The selected batch does not contain enough remaining quantity.',
      );
    }
    if (
      batch &&
      batch.remainingQty - batch.unavailableQty < quantity
    ) {
      throw createHttpError(
        409,
        'INVENTORY_BATCH_SALEABLE_INSUFFICIENT',
        'The selected batch does not contain enough saleable quantity.',
      );
    }
    const kind = normalizeOutboundKind(input.kind);
    const document = await this.createPostedDocument(
      transaction,
      actor,
      receipt,
      envelope,
      {
        type: kind.documentType,
        warehouseId: warehouse.id,
        product,
        quantity,
        batchId: batch?.id ?? null,
        businessAt: commandBusinessAt(input),
        reason: commandReason(input),
        sourceId: commandSourceId(input),
        purchaseUnitCostCents:
          batch?.purchaseUnitCostCents ?? null,
      },
    );
    const movement = await this.createMovement(
      transaction,
      actor,
      envelope,
      document,
      {
        sourceKey: `${envelope.sourceKey}:movement`,
        warehouseId: warehouse.id,
        product,
        batchId: batch?.id ?? null,
        reservationId: reservation?.id ?? null,
        movementType: kind.movementType,
        onHandDelta: -quantity,
        reservedDelta: reservation ? -quantity : 0,
        purchaseUnitCostCents:
          batch?.purchaseUnitCostCents ?? null,
      },
    );
    const stockChange = await this.applyStockSnapshot(
      transaction,
      stock,
      {
        ...ZERO_STOCK_DELTA,
        onHandDelta: -quantity,
        reservedDelta: reservation ? -quantity : 0,
      },
      movement.id,
    );
    const batchChanges = batch
      ? [
          await this.applyBatchSnapshot(transaction, batch, {
            receivedDelta: 0,
            remainingDelta: -quantity,
            unavailableDelta: 0,
          }),
        ]
      : [];
    const reservationResult = reservation
      ? await this.applyReservationSnapshot(transaction, reservation, {
          requestedQty: reservation.requestedQty,
          reservedQty: reservation.reservedQty - quantity,
          assignedQty: reservation.assignedQty,
          outboundQty: reservation.outboundQty + quantity,
          status:
            reservation.reservedQty === quantity
              ? 'CONSUMED'
              : 'PARTIAL',
          consumedAt:
            reservation.reservedQty === quantity
              ? new Date()
              : null,
        })
      : null;
    return outcomeFrom(document, [movement], [stockChange], {
      batchChanges,
      reservation: reservationResult,
    });
  }

  private async applyUnavailableChange(
    transaction: any,
    commandType: 'MARK_UNAVAILABLE' | 'RESTORE_AVAILABLE',
    actor: any,
    input: any,
    envelope: any,
    receipt: any,
  ) {
    const quantity = positiveQuantity(input.quantity);
    const reason = commandReason(input);
    const warehouse = await this.loadActiveWarehouse(
      transaction,
      requiredId(input.warehouseId, 'warehouseId'),
    );
    const product = await this.loadQuantityProduct(
      transaction,
      requiredId(input.productId, 'productId'),
    );
    const stock = await this.repository.getOrCreateStock(
      transaction,
      warehouse.id,
      product.id,
    );
    const batchId = optionalId(input.batchId, 'batchId');
    const batch = batchId
      ? await this.loadMatchingBatch(
          transaction,
          batchId,
          warehouse.id,
          product.id,
        )
      : null;
    if (
      commandType === 'RESTORE_AVAILABLE' &&
      batch?.costStatus === 'PENDING'
    ) {
      throw createHttpError(
        409,
        'INVENTORY_PENDING_COST_RESTORE_FORBIDDEN',
        'A pending-cost batch can only become saleable through the inventory cost completion command.',
      );
    }
    const direction = commandType === 'MARK_UNAVAILABLE' ? 1 : -1;
    if (
      direction > 0 &&
      batch &&
      batch.unavailableQty + quantity > batch.remainingQty
    ) {
      throw createHttpError(
        409,
        'INVENTORY_BATCH_UNAVAILABLE_EXCEEDS_REMAINING',
        'Batch unavailable quantity cannot exceed its remaining quantity.',
      );
    }
    if (
      direction < 0 &&
      batch &&
      batch.unavailableQty < quantity
    ) {
      throw createHttpError(
        409,
        'INVENTORY_BATCH_UNAVAILABLE_QTY_NEGATIVE',
        'The batch does not contain enough unavailable quantity to restore.',
      );
    }
    const document = await this.createPostedDocument(
      transaction,
      actor,
      receipt,
      envelope,
      {
        type: 'UNAVAILABLE_ADJUSTMENT',
        warehouseId: warehouse.id,
        product,
        quantity,
        batchId: batch?.id ?? null,
        condition:
          direction > 0 ? 'UNAVAILABLE' : 'SALEABLE',
        businessAt: commandBusinessAt(input),
        reason,
        sourceId: commandSourceId(input),
      },
    );
    const movement = await this.createMovement(
      transaction,
      actor,
      envelope,
      document,
      {
        sourceKey: `${envelope.sourceKey}:movement`,
        warehouseId: warehouse.id,
        product,
        batchId: batch?.id ?? null,
        movementType:
          direction > 0 ? 'UNAVAILABLE_IN' : 'UNAVAILABLE_OUT',
        unavailableDelta: direction * quantity,
      },
    );
    const stockChange = await this.applyStockSnapshot(
      transaction,
      stock,
      {
        ...ZERO_STOCK_DELTA,
        unavailableDelta: direction * quantity,
      },
      movement.id,
    );
    const batchChanges = batch
      ? [
          await this.applyBatchSnapshot(transaction, batch, {
            receivedDelta: 0,
            remainingDelta: 0,
            unavailableDelta: direction * quantity,
          }),
        ]
      : [];
    return outcomeFrom(document, [movement], [stockChange], {
      batchChanges,
    });
  }

  private async applyBatchCostUpdate(
    transaction: any,
    actor: any,
    input: any,
    envelope: any,
    receipt: any,
  ): Promise<CommandOutcome> {
    const batch = await this.loadBatch(
      transaction,
      requiredId(input.batchId, 'batchId'),
    );
    const purchaseUnitCostCents =
      optionalNonNegativeInteger(
        input.purchaseUnitCostCents,
        'purchaseUnitCostCents',
      );
    if (purchaseUnitCostCents === null) {
      throw validationError('purchaseUnitCostCents is required.');
    }
    const reason = requiredCorrectionReason(input.reason);
    if (
      batch.costStatus === 'COMPLETE' &&
      batch.purchaseUnitCostCents === purchaseUnitCostCents
    ) {
      throw createHttpError(
        409,
        'INVENTORY_BATCH_COST_UNCHANGED',
        'The batch purchase cost is already set to this value.',
      );
    }
    const product = await this.loadQuantityProductForCost(
      transaction,
      batch.productId,
    );
    await this.loadActiveWarehouse(transaction, batch.warehouseId);
    const stock = await this.repository.getOrCreateStock(
      transaction,
      batch.warehouseId,
      batch.productId,
    );
    const releasedUnavailableQty =
      batch.costStatus === 'PENDING' ? batch.unavailableQty : 0;
    if (stock.unavailableQty < releasedUnavailableQty) {
      throw createHttpError(
        409,
        'INVENTORY_BATCH_STOCK_SNAPSHOT_MISMATCH',
        'The stock snapshot cannot release the pending-cost batch quantity.',
      );
    }
    const document = await this.createPostedDocument(
      transaction,
      actor,
      receipt,
      envelope,
      {
        type: 'UNAVAILABLE_ADJUSTMENT',
        warehouseId: batch.warehouseId,
        product,
        quantity: Math.max(batch.receivedQty, 1),
        batchId: batch.id,
        condition: 'SALEABLE',
        businessAt: commandBusinessAt(input),
        reason,
        sourceId: batch.id,
        purchaseUnitCostCents,
        notes:
          batch.costStatus === 'PENDING'
            ? 'Pending batch cost completed.'
            : 'Batch purchase cost maintained.',
      },
    );
    const movements = [];
    const stockChanges = [];
    if (releasedUnavailableQty > 0) {
      const movement = await this.createMovement(
        transaction,
        actor,
        envelope,
        document,
        {
          sourceKey: `${envelope.sourceKey}:movement`,
          warehouseId: batch.warehouseId,
          product,
          batchId: batch.id,
          movementType: 'UNAVAILABLE_OUT',
          unavailableDelta: -releasedUnavailableQty,
          purchaseUnitCostCents,
        },
      );
      movements.push(movement);
      stockChanges.push(
        await this.applyStockSnapshot(
          transaction,
          stock,
          {
            ...ZERO_STOCK_DELTA,
            unavailableDelta: -releasedUnavailableQty,
          },
          movement.id,
        ),
      );
    }
    const updated =
      await this.repository.updateBatchCostWithVersion(
        transaction,
        batch,
        {
          purchaseUnitCostCents,
          unavailableDelta: -releasedUnavailableQty,
          actorUserId:
            batch.costStatus === 'PENDING'
              ? actorId(actor)
              : batch.costCompletedById,
          actorName:
            batch.costStatus === 'PENDING'
              ? actorName(actor)
              : batch.costCompletedByName,
          actorRole:
            batch.costStatus === 'PENDING'
              ? actorRole(actor)
              : batch.costCompletedByRole,
          completedAt:
            batch.costStatus === 'PENDING'
              ? new Date()
              : batch.costCompletedAt,
          updatedById: actorId(actor),
        },
      );
    if (updated.count !== 1) {
      throw concurrentUpdateError();
    }
    const batchChange = {
      batchId: batch.id,
      warehouseId: batch.warehouseId,
      productId: batch.productId,
      before: {
        receivedQty: batch.receivedQty,
        remainingQty: batch.remainingQty,
        unavailableQty: batch.unavailableQty,
        costStatus: batch.costStatus,
      },
      delta: {
        receivedDelta: 0,
        remainingDelta: 0,
        unavailableDelta: -releasedUnavailableQty,
      },
      after: {
        receivedQty: batch.receivedQty,
        remainingQty: batch.remainingQty,
        unavailableQty:
          batch.unavailableQty - releasedUnavailableQty,
        costStatus: 'COMPLETE',
        version: batch.version + 1,
      },
    };
    return outcomeFrom(document, movements, stockChanges, {
      batchChanges: [batchChange],
      batchCostChange: {
        batchId: batch.id,
        costStatus: 'COMPLETE',
        purchaseUnitCostCents,
        releasedUnavailableQty,
      },
      auditBefore: {
        batchId: batch.id,
        pricingState: batch.costStatus,
        purchaseUnitPriceCents: batch.purchaseUnitCostCents,
        version: batch.version,
      },
      auditAfter: {
        batchId: batch.id,
        pricingState: 'COMPLETE',
        purchaseUnitPriceCents: purchaseUnitCostCents,
        releasedUnavailableQty,
        version: batch.version + 1,
      },
    });
  }

  private async applyTransferOut(
    transaction: any,
    actor: any,
    input: any,
    envelope: any,
    receipt: any,
  ) {
    const quantity = positiveQuantity(input.quantity);
    const fromWarehouse = await this.loadActiveWarehouse(
      transaction,
      requiredId(input.fromWarehouseId, 'fromWarehouseId'),
    );
    const toWarehouse = await this.loadActiveWarehouse(
      transaction,
      requiredId(input.toWarehouseId, 'toWarehouseId'),
    );
    assertDifferentWarehouses(fromWarehouse.id, toWarehouse.id);
    const product = await this.loadQuantityProduct(
      transaction,
      requiredId(input.productId, 'productId'),
    );
    const stock = await this.repository.getOrCreateStock(
      transaction,
      fromWarehouse.id,
      product.id,
    );
    const batchId = optionalId(input.batchId, 'batchId');
    const batch = batchId
      ? await this.loadMatchingBatch(
          transaction,
          batchId,
          fromWarehouse.id,
          product.id,
        )
      : null;
    if (batch && batch.remainingQty < quantity) {
      throw createHttpError(
        409,
        'INVENTORY_BATCH_INSUFFICIENT',
        'The selected batch does not contain enough remaining quantity.',
      );
    }
    const document = await this.createPostedDocument(
      transaction,
      actor,
      receipt,
      envelope,
      {
        type: 'TRANSFER_OUT',
        warehouseId: fromWarehouse.id,
        fromWarehouseId: fromWarehouse.id,
        toWarehouseId: toWarehouse.id,
        product,
        quantity,
        batchId: batch?.id ?? null,
        businessAt: commandBusinessAt(input),
        reason: commandReason(input),
        sourceId: commandSourceId(input),
      },
    );
    const movement = await this.createMovement(
      transaction,
      actor,
      envelope,
      document,
      {
        sourceKey: `${envelope.sourceKey}:movement`,
        warehouseId: fromWarehouse.id,
        product,
        batchId: batch?.id ?? null,
        movementType: 'TRANSFER_OUT',
        onHandDelta: -quantity,
        inTransitDelta: quantity,
      },
    );
    const stockChange = await this.applyStockSnapshot(
      transaction,
      stock,
      {
        ...ZERO_STOCK_DELTA,
        onHandDelta: -quantity,
        inTransitDelta: quantity,
      },
      movement.id,
    );
    const batchChanges = batch
      ? [
          await this.applyBatchSnapshot(transaction, batch, {
            receivedDelta: 0,
            remainingDelta: -quantity,
            unavailableDelta: 0,
          }),
        ]
      : [];
    return outcomeFrom(document, [movement], [stockChange], {
      batchChanges,
    });
  }

  private async applyTransferIn(
    transaction: any,
    actor: any,
    input: any,
    envelope: any,
    receipt: any,
  ) {
    const quantity = positiveQuantity(input.quantity);
    const fromWarehouse = await this.loadActiveWarehouse(
      transaction,
      requiredId(input.fromWarehouseId, 'fromWarehouseId'),
    );
    const toWarehouse = await this.loadActiveWarehouse(
      transaction,
      requiredId(input.toWarehouseId, 'toWarehouseId'),
    );
    assertDifferentWarehouses(fromWarehouse.id, toWarehouse.id);
    const product = await this.loadQuantityProduct(
      transaction,
      requiredId(input.productId, 'productId'),
    );
    const stockKeys = [
      { warehouseId: fromWarehouse.id, productId: product.id },
      { warehouseId: toWarehouse.id, productId: product.id },
    ].sort(stockKeyComparator);
    const stockByWarehouse = new Map<string, any>();
    for (const key of stockKeys) {
      stockByWarehouse.set(
        key.warehouseId,
        await this.repository.getOrCreateStock(
          transaction,
          key.warehouseId,
          key.productId,
        ),
      );
    }
    const sourceStock = stockByWarehouse.get(fromWarehouse.id);
    if (sourceStock.inTransitQty < quantity) {
      throw createHttpError(
        409,
        'INVENTORY_IN_TRANSIT_QTY_NEGATIVE',
        'The source warehouse does not contain enough in-transit quantity.',
      );
    }
    const document = await this.createPostedDocument(
      transaction,
      actor,
      receipt,
      envelope,
      {
        type: 'TRANSFER_IN',
        warehouseId: toWarehouse.id,
        fromWarehouseId: fromWarehouse.id,
        toWarehouseId: toWarehouse.id,
        product,
        quantity,
        businessAt: commandBusinessAt(input),
        reason: commandReason(input),
        sourceId: commandSourceId(input),
      },
    );
    const sourceMovement = await this.createMovement(
      transaction,
      actor,
      envelope,
      document,
      {
        sourceKey: `${envelope.sourceKey}:movement:source`,
        warehouseId: fromWarehouse.id,
        product,
        movementType: 'TRANSFER_IN',
        inTransitDelta: -quantity,
      },
    );
    const targetMovement = await this.createMovement(
      transaction,
      actor,
      envelope,
      document,
      {
        sourceKey: `${envelope.sourceKey}:movement:target`,
        warehouseId: toWarehouse.id,
        product,
        movementType: 'TRANSFER_IN',
        onHandDelta: quantity,
      },
    );
    const changes = [];
    for (const key of stockKeys) {
      const isSource = key.warehouseId === fromWarehouse.id;
      changes.push(
        await this.applyStockSnapshot(
          transaction,
          stockByWarehouse.get(key.warehouseId),
          {
            ...ZERO_STOCK_DELTA,
            onHandDelta: isSource ? 0 : quantity,
            inTransitDelta: isSource ? -quantity : 0,
          },
          isSource ? sourceMovement.id : targetMovement.id,
        ),
      );
    }
    return outcomeFrom(
      document,
      [sourceMovement, targetMovement],
      changes,
    );
  }

  private async applyReversal(
    transaction: any,
    actor: any,
    input: any,
    envelope: any,
    receipt: any,
  ) {
    const reason = requiredCorrectionReason(input.reason);
    const original = await this.repository.findDocumentForReversal(
      transaction,
      requiredId(input.documentId, 'documentId'),
    );
    if (!original) {
      throw createHttpError(
        404,
        'INVENTORY_DOCUMENT_NOT_FOUND',
        'The inventory document does not exist.',
      );
    }
    if (original.type === 'REVERSAL') {
      throw createHttpError(
        409,
        'INVENTORY_REVERSAL_CHAIN_FORBIDDEN',
        'A reversal document cannot itself be reversed.',
      );
    }
    if (
      input.documentScope === 'INBOUND_ONLY' &&
      !BUSINESS_INBOUND_KINDS.has(original.type)
    ) {
      throw createHttpError(
        409,
        'INVENTORY_DOCUMENT_SCOPE_MISMATCH',
        'Only opening, purchase receipt, and other inbound documents can be reversed through this endpoint.',
      );
    }
    const transferDocumentScope =
      original.type === 'TRANSFER_OUT'
        ? 'TRANSFER_OUTBOUND'
        : ['TRANSFER_IN', 'TRANSFER_DIFFERENCE'].includes(
              original.type,
            )
          ? 'TRANSFER_RECEIPT'
          : null;
    if (
      transferDocumentScope &&
      input.documentScope !== transferDocumentScope
    ) {
      throw createHttpError(
        409,
        'INVENTORY_TRANSFER_REVERSAL_COMMAND_REQUIRED',
        'Transfer facts must be reversed through the matching transfer command.',
      );
    }
    if (original.reversedByDocument) {
      throw createHttpError(
        409,
        'INVENTORY_DOCUMENT_ALREADY_REVERSED',
        'The inventory document has already been reversed.',
      );
    }
    if (original.status !== 'POSTED') {
      throw createHttpError(
        409,
        'INVENTORY_DOCUMENT_NOT_REVERSIBLE',
        'Only a posted inventory document can be reversed.',
      );
    }
    const originalMovements = original.lines.flatMap(
      (line: any) => line.movements,
    );
    if (originalMovements.length === 0) {
      throw createHttpError(
        409,
        'INVENTORY_DOCUMENT_HAS_NO_MOVEMENTS',
        'The inventory document has no movements to reverse.',
      );
    }
    if (
      originalMovements.some(
        (movement: any) => movement.serializedUnitId,
      ) &&
      ![
        'TRANSFER_OUTBOUND',
        'TRANSFER_RECEIPT',
        'AFTER_SALES_RECEIPT',
      ].includes(input.documentScope)
    ) {
      throw createHttpError(
        409,
        'INVENTORY_SERIALIZED_REVERSAL_COMMAND_REQUIRED',
        'Serialized inventory facts must be corrected through the matching per-unit domain command.',
      );
    }
    if (
      input.documentScope === 'AFTER_SALES_RECEIPT' &&
      (original.type !== 'CUSTOMER_RETURN' ||
        !['inbound', 'serialized_after_sales_return'].includes(
          String(original.sourceType || ''),
        ))
    ) {
      throw createHttpError(
        409,
        'INVENTORY_DOCUMENT_SCOPE_MISMATCH',
        'Only a customer-return fact owned by an after-sales receipt can be reversed through this command.',
      );
    }
    const stockMap = new Map<string, any>();
    const stockKeys = uniqueKeys(
      originalMovements.map((movement: any) => ({
        warehouseId: movement.warehouseId,
        productId: movement.productId,
      })),
    ).sort(stockKeyComparator);
    for (const key of stockKeys) {
      stockMap.set(
        stockMapKey(key.warehouseId, key.productId),
        await this.repository.getOrCreateStock(
          transaction,
          key.warehouseId,
          key.productId,
        ),
      );
    }
    const batchMap = new Map<string, any>();
    const reservationMap = new Map<string, any>();
    for (const movement of originalMovements) {
      if (movement.batchId && !batchMap.has(movement.batchId)) {
        batchMap.set(
          movement.batchId,
          await this.loadBatch(transaction, movement.batchId),
        );
      }
      if (
        movement.reservationId &&
        !reservationMap.has(movement.reservationId)
      ) {
        reservationMap.set(
          movement.reservationId,
          await this.loadReservation(
            transaction,
            movement.reservationId,
          ),
        );
      }
    }
    if (BUSINESS_INBOUND_KINDS.has(original.type)) {
      for (const movement of originalMovements) {
        if (!movement.batchId || movement.unavailableDelta <= 0) {
          continue;
        }
        const currentBatch = batchMap.get(movement.batchId);
        if (
          currentBatch &&
          currentBatch.unavailableQty < movement.unavailableDelta
        ) {
          throw createHttpError(
            409,
            'INVENTORY_INBOUND_COST_DEPENDENCY_EXISTS',
            'Reverse the batch cost-completion adjustment before reversing this inbound document.',
          );
        }
      }
    }
    const businessAt = commandBusinessAt(input);
    const reversalDocument =
      await this.repository.createDocument(transaction, {
        documentNo: documentNumber(receipt.id),
        type: 'REVERSAL',
        status: 'POSTED',
        warehouseId: original.warehouseId,
        fromWarehouseId: original.fromWarehouseId,
        toWarehouseId: original.toWarehouseId,
        sourceType: 'inventory_reverse',
        sourceId: original.id,
        sourceKey: envelope.sourceKey,
        requestHash: envelope.requestHash,
        businessAt,
        postedById: actorId(actor),
        postedByNameSnapshot: actorName(actor),
        postedByRoleSnapshot: actorRole(actor),
        postedAt: new Date(),
        reversalOfDocumentId: original.id,
        reason,
        createdById: actorId(actor),
        updatedById: actorId(actor),
      });
    const reversalLineByOriginal = new Map<string, any>();
    for (const [index, originalLine] of original.lines.entries()) {
      const reversalLine =
        await this.repository.createDocumentLine(transaction, {
          documentId: reversalDocument.id,
          lineNo: index + 1,
          productId: originalLine.productId,
          batchId: originalLine.batchId,
          quantity: originalLine.quantity,
          condition: originalLine.condition,
          productNameSnapshot: originalLine.productNameSnapshot,
          unitSnapshot: originalLine.unitSnapshot,
          purchaseUnitCostCents:
            originalLine.purchaseUnitCostCents,
          notes: `Reversal of line ${originalLine.id}`,
        });
      reversalLineByOriginal.set(originalLine.id, reversalLine);
    }
    const reversalMovements = [];
    for (const [index, movement] of originalMovements.entries()) {
      const reversalMovement =
        await this.repository.createMovement(transaction, {
          sourceKey: `${envelope.sourceKey}:movement:${index + 1}`,
          documentLineId: reversalLineByOriginal.get(
            movement.documentLineId,
          ).id,
          warehouseId: movement.warehouseId,
          productId: movement.productId,
          batchId: movement.batchId,
          serializedUnitId: movement.serializedUnitId,
          reservationId: movement.reservationId,
          movementType: 'REVERSAL',
          onHandDelta: -movement.onHandDelta,
          reservedDelta: -movement.reservedDelta,
          unavailableDelta: -movement.unavailableDelta,
          inTransitDelta: -movement.inTransitDelta,
          businessAt,
          operatorUserId: actorId(actor),
          operatorNameSnapshot: actorName(actor),
          operatorRoleSnapshot: actorRole(actor),
          productNameSnapshot: movement.productNameSnapshot,
          unitSnapshot: movement.unitSnapshot,
          purchaseUnitCostCents:
            movement.purchaseUnitCostCents,
          reason,
          reversalOfMovementId: movement.id,
        });
      reversalMovements.push(reversalMovement);
    }
    const stockChanges = [];
    for (const key of stockKeys) {
      const relevant = originalMovements.filter(
        (movement: any) =>
          movement.warehouseId === key.warehouseId &&
          movement.productId === key.productId,
      );
      const delta = sumStockDeltas(
        relevant.map((movement: any) => ({
          onHandDelta: -movement.onHandDelta,
          reservedDelta: -movement.reservedDelta,
          unavailableDelta: -movement.unavailableDelta,
          inTransitDelta: -movement.inTransitDelta,
        })),
      );
      const lastMovement = [...reversalMovements]
        .reverse()
        .find(
          (movement) =>
            movement.warehouseId === key.warehouseId &&
            movement.productId === key.productId,
        );
      stockChanges.push(
        await this.applyStockSnapshot(
          transaction,
          stockMap.get(stockMapKey(key.warehouseId, key.productId)),
          delta,
          lastMovement.id,
        ),
      );
    }
    const batchChanges = [];
    for (const [batchId, batch] of batchMap) {
      const movements = originalMovements.filter(
        (movement: any) => movement.batchId === batchId,
      );
      batchChanges.push(
        await this.applyBatchSnapshot(
          transaction,
          batch,
          sumBatchReversalDeltas(movements),
        ),
      );
    }
    let reservationResult = null;
    for (const [reservationId, reservation] of reservationMap) {
      const movements = originalMovements.filter(
        (movement: any) =>
          movement.reservationId === reservationId,
      );
      const next = reverseReservationSnapshot(
        reservation,
        movements,
      );
      reservationResult =
        await this.applyReservationSnapshot(
          transaction,
          reservation,
          next,
        );
    }
    await this.repository.markDocumentReversed(
      transaction,
      original.id,
      actor,
      businessAt,
    );
    return {
      documentId: reversalDocument.id,
      documentNo: reversalDocument.documentNo,
      movementIds: reversalMovements.map(
        (movement) => movement.id,
      ),
      stockChanges,
      batchChanges,
      reservation: reservationResult,
      reversalOfDocumentId: original.id,
    };
  }

  private async createPostedDocument(
    transaction: any,
    actor: any,
    receipt: any,
    envelope: any,
    input: any,
  ) {
    const document = await this.repository.createDocument(transaction, {
      documentNo: documentNumber(receipt.id),
      type: input.type,
      status: 'POSTED',
      warehouseId: input.warehouseId ?? null,
      fromWarehouseId: input.fromWarehouseId ?? null,
      toWarehouseId: input.toWarehouseId ?? null,
      sourceType: receipt.commandType.toLowerCase(),
      sourceId: input.sourceId ?? null,
      sourceKey: envelope.sourceKey,
      requestHash: envelope.requestHash,
      businessAt: input.businessAt,
      postedById: actorId(actor),
      postedByNameSnapshot: actorName(actor),
      postedByRoleSnapshot: actorRole(actor),
      postedAt: new Date(),
      reason: input.reason ?? null,
      attachmentMetadata: input.attachmentMetadata ?? undefined,
      createdById: actorId(actor),
      updatedById: actorId(actor),
    });
    const line = await this.repository.createDocumentLine(transaction, {
      documentId: document.id,
      lineNo: 1,
      productId: input.product.id,
      batchId: input.batchId ?? null,
      quantity: input.quantity,
      condition: input.condition ?? 'SALEABLE',
      productNameSnapshot: input.product.name,
      unitSnapshot: input.product.unit,
      purchaseUnitCostCents:
        input.purchaseUnitCostCents ?? null,
      notes: input.notes ?? null,
    });
    return {
      ...document,
      line,
      product: input.product,
      purchaseUnitCostCents:
        input.purchaseUnitCostCents ?? null,
    };
  }

  private createMovement(
    transaction: any,
    actor: any,
    _envelope: any,
    document: any,
    input: any,
  ) {
    const delta = {
      onHandDelta: input.onHandDelta ?? 0,
      reservedDelta: input.reservedDelta ?? 0,
      unavailableDelta: input.unavailableDelta ?? 0,
      inTransitDelta: input.inTransitDelta ?? 0,
    };
    if (Object.values(delta).every((value) => value === 0)) {
      throw validationError(
        'An inventory movement must change at least one balance.',
      );
    }
    return this.repository.createMovement(transaction, {
      sourceKey: input.sourceKey,
      documentLineId: document.line.id,
      warehouseId: input.warehouseId,
      productId: input.product.id,
      batchId: input.batchId ?? null,
      serializedUnitId: input.serializedUnitId ?? null,
      reservationId: input.reservationId ?? null,
      movementType: input.movementType,
      ...delta,
      businessAt: document.businessAt,
      operatorUserId: actorId(actor),
      operatorNameSnapshot: actorName(actor),
      operatorRoleSnapshot: actorRole(actor),
      productNameSnapshot: input.product.name,
      unitSnapshot: input.product.unit,
      purchaseUnitCostCents:
        input.purchaseUnitCostCents ?? null,
      reason: document.reason,
      reversalOfMovementId:
        input.reversalOfMovementId ?? null,
    });
  }

  private async applyStockSnapshot(
    transaction: any,
    stock: any,
    delta: InventoryStockDelta,
    movementId: string,
  ) {
    const next = {
      onHandQty: safeQuantitySum(
        stock.onHandQty,
        delta.onHandDelta,
      ),
      reservedQty: safeQuantitySum(
        stock.reservedQty,
        delta.reservedDelta,
      ),
      unavailableQty: safeQuantitySum(
        stock.unavailableQty,
        delta.unavailableDelta,
      ),
      inTransitQty: safeQuantitySum(
        stock.inTransitQty,
        delta.inTransitDelta,
      ),
    };
    assertRestrictedBalancesNonNegative(next);
    const updated = await this.repository.updateStockWithVersion(
      transaction,
      stock,
      delta,
      movementId,
    );
    if (updated.count !== 1) {
      throw concurrentUpdateError();
    }
    return {
      warehouseId: stock.warehouseId,
      productId: stock.productId,
      before: calculateStockMetrics({
        onHandQty: stock.onHandQty,
        reservedQty: stock.reservedQty,
        unavailableQty: stock.unavailableQty,
        inTransitQty: stock.inTransitQty,
      }),
      delta,
      after: {
        ...calculateStockMetrics(next),
        version: stock.version + 1,
        lastMovementId: movementId,
      },
    };
  }

  private async applyBatchSnapshot(
    transaction: any,
    batch: any,
    delta: InventoryBatchDelta,
  ) {
    const next = {
      receivedQty: safeQuantitySum(
        batch.receivedQty,
        delta.receivedDelta,
      ),
      remainingQty: safeQuantitySum(
        batch.remainingQty,
        delta.remainingDelta,
      ),
      unavailableQty: safeQuantitySum(
        batch.unavailableQty,
        delta.unavailableDelta,
      ),
    };
    if (
      next.receivedQty < 0 ||
      next.remainingQty < 0 ||
      next.unavailableQty < 0 ||
      next.remainingQty > next.receivedQty ||
      next.unavailableQty > next.remainingQty
    ) {
      throw createHttpError(
        409,
        'INVENTORY_BATCH_SNAPSHOT_INVALID',
        'The command conflicts with the current batch snapshot.',
      );
    }
    const updated = await this.repository.updateBatchWithVersion(
      transaction,
      batch,
      delta,
    );
    if (updated.count !== 1) {
      throw concurrentUpdateError();
    }
    return {
      batchId: batch.id,
      warehouseId: batch.warehouseId,
      productId: batch.productId,
      before: {
        receivedQty: batch.receivedQty,
        remainingQty: batch.remainingQty,
        unavailableQty: batch.unavailableQty,
      },
      delta,
      after: {
        ...next,
        version: batch.version + 1,
      },
    };
  }

  private async applyReservationSnapshot(
    transaction: any,
    reservation: any,
    next: any,
  ) {
    for (const field of [
      'requestedQty',
      'reservedQty',
      'assignedQty',
      'outboundQty',
    ]) {
      if (!Number.isSafeInteger(next[field]) || next[field] < 0) {
        throw createHttpError(
          409,
          'INVENTORY_RESERVATION_SNAPSHOT_INVALID',
          'The command conflicts with the current reservation snapshot.',
        );
      }
    }
    const updated =
      await this.repository.updateReservationWithVersion(
        transaction,
        reservation,
        next,
      );
    if (updated.count !== 1) {
      throw concurrentUpdateError();
    }
    return {
      id: reservation.id,
      salesOrderId: reservation.salesOrderId,
      inventoryLineKey: reservation.inventoryLineKey,
      warehouseId: reservation.warehouseId,
      productId: reservation.productId,
      requestedQty: next.requestedQty,
      reservedQty: next.reservedQty,
      assignedQty: next.assignedQty,
      outboundQty: next.outboundQty,
      status: next.status,
      version: reservation.version + 1,
    };
  }

  private async loadQuantityProduct(transaction: any, productId: string) {
    const product = await this.repository.findProduct(
      transaction,
      productId,
    );
    if (!product || !product.isActive) {
      throw createHttpError(
        404,
        'INVENTORY_PRODUCT_NOT_FOUND',
        'The active inventory product does not exist.',
      );
    }
    if (product.inventoryTrackingMode === 'SERIALIZED') {
      this.serializedAdapter.rejectQuantityCommand();
    }
    if (product.inventoryTrackingMode !== 'QUANTITY') {
      throw createHttpError(
        409,
        'INVENTORY_TRACKING_DISABLED',
        'The product is not enabled for quantity inventory tracking.',
      );
    }
    return product;
  }

  private async loadReservableProduct(
    transaction: any,
    productId: string,
  ) {
    const product = await this.repository.findProduct(
      transaction,
      productId,
    );
    if (!product || !product.isActive) {
      throw createHttpError(
        404,
        'INVENTORY_PRODUCT_NOT_FOUND',
        'The active inventory product does not exist.',
      );
    }
    if (
      product.inventoryTrackingMode !== 'QUANTITY' &&
      product.inventoryTrackingMode !== 'SERIALIZED'
    ) {
      throw createHttpError(
        409,
        'INVENTORY_TRACKING_DISABLED',
        'The product is not enabled for inventory reservation.',
      );
    }
    return product;
  }

  private async loadQuantityProductForCost(
    transaction: any,
    productId: string,
  ) {
    const product = await this.repository.findProduct(
      transaction,
      productId,
    );
    if (!product) {
      throw createHttpError(
        404,
        'INVENTORY_PRODUCT_NOT_FOUND',
        'The inventory product does not exist.',
      );
    }
    if (product.inventoryTrackingMode === 'SERIALIZED') {
      this.serializedAdapter.rejectQuantityCommand();
    }
    if (product.inventoryTrackingMode !== 'QUANTITY') {
      throw createHttpError(
        409,
        'INVENTORY_TRACKING_DISABLED',
        'The product is not enabled for quantity inventory tracking.',
      );
    }
    return product;
  }

  private async loadActiveWarehouse(
    transaction: any,
    warehouseId: string,
  ) {
    const warehouse = await this.repository.findWarehouse(
      transaction,
      warehouseId,
    );
    if (!warehouse || !warehouse.isActive) {
      throw createHttpError(
        404,
        'INVENTORY_WAREHOUSE_NOT_FOUND',
        'The active warehouse does not exist.',
      );
    }
    return warehouse;
  }

  private async loadMatchingBatch(
    transaction: any,
    batchId: string,
    warehouseId: string,
    productId: string,
  ) {
    const batch = await this.loadBatch(transaction, batchId);
    if (
      batch.warehouseId !== warehouseId ||
      batch.productId !== productId
    ) {
      throw createHttpError(
        409,
        'INVENTORY_BATCH_SCOPE_MISMATCH',
        'The batch does not belong to the requested warehouse and product.',
      );
    }
    return batch;
  }

  private async loadBatch(transaction: any, batchId: string) {
    const batch = await this.repository.findBatch(
      transaction,
      batchId,
    );
    if (!batch) {
      throw createHttpError(
        404,
        'INVENTORY_BATCH_NOT_FOUND',
        'The inventory batch does not exist.',
      );
    }
    return batch;
  }

  private async loadReservation(transaction: any, reservationId: string) {
    const reservation = await this.repository.findReservation(
      transaction,
      reservationId,
    );
    if (!reservation) {
      throw createHttpError(
        404,
        'INVENTORY_RESERVATION_NOT_FOUND',
        'The inventory reservation does not exist.',
      );
    }
    return reservation;
  }
}

interface CommandOutcome {
  documentId: string;
  documentNo: string;
  movementIds: string[];
  stockChanges: any[];
  batchChanges: any[];
  reservation: any | null;
  reversalOfDocumentId?: string | null;
  batchCostChange?: any | null;
  auditBefore?: any | null;
  auditAfter?: any | null;
}

interface TransferCommandOutcome {
  transferId: string;
  receiptId: string | null;
  documentIds: string[];
  movementIds: string[];
  stockChanges: any[];
  transfer: any;
  auditBefore?: any | null;
  auditAfter: any;
}

function outcomeFrom(
  document: any,
  movements: any[],
  stockChanges: any[],
  extra: Partial<CommandOutcome> = {},
): CommandOutcome {
  return {
    documentId: document.id,
    documentNo: document.documentNo,
    movementIds: movements.map((movement) => movement.id),
    stockChanges,
    batchChanges: extra.batchChanges ?? [],
    reservation: extra.reservation ?? null,
    reversalOfDocumentId:
      extra.reversalOfDocumentId ?? null,
    batchCostChange: extra.batchCostChange ?? null,
    auditBefore: extra.auditBefore ?? null,
    auditAfter: extra.auditAfter ?? null,
  };
}

function assertTransferCreateInput(input: any) {
  assertTransferObject(input);
  assertAllowedTransferFields(input, [
    'sourceKey',
    'idempotencyKey',
    'requestHash',
    'fromWarehouseId',
    'toWarehouseId',
    'notes',
    'lines',
  ]);
  requiredId(input.fromWarehouseId, 'fromWarehouseId');
  requiredId(input.toWarehouseId, 'toWarehouseId');
  normalizeTransferCreateLines(input.lines);
}

function assertTransferActionInput(
  input: any,
  idField: 'transferId' | 'receiptId',
  reasonRequired: boolean,
) {
  assertTransferObject(input);
  assertAllowedTransferFields(input, [
    'sourceKey',
    'idempotencyKey',
    'requestHash',
    idField,
    'businessAt',
    'reason',
  ]);
  requiredId(input[idField], idField);
  if (reasonRequired) {
    requiredCorrectionReason(input.reason);
  } else {
    commandReason(input);
  }
  commandBusinessAt(input);
}

function assertTransferReceiptInput(input: any) {
  assertTransferObject(input);
  assertAllowedTransferFields(input, [
    'sourceKey',
    'idempotencyKey',
    'requestHash',
    'transferId',
    'businessAt',
    'reason',
    'notes',
    'lines',
  ]);
  requiredId(input.transferId, 'transferId');
  commandBusinessAt(input);
  normalizeTransferReceiptLines(input.lines);
}

function assertTransferObject(input: any) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError(
      'The inventory transfer command body must be an object.',
    );
  }
}

function assertAllowedTransferFields(
  input: Record<string, unknown>,
  allowedFields: string[],
) {
  const allowed = new Set(allowedFields);
  const unsupported = Object.keys(input).find(
    (key) => !allowed.has(key),
  );
  if (unsupported) {
    throw validationError(
      `Unsupported inventory transfer field: ${unsupported}.`,
    );
  }
}

function normalizeTransferCreateLines(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw validationError(
      'lines must contain at least one transfer product line.',
    );
  }
  if (value.length > 100) {
    throw validationError(
      'A transfer cannot contain more than 100 product lines.',
    );
  }
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw validationError(`lines[${index}] must be an object.`);
    }
    const line = raw as Record<string, unknown>;
    assertAllowedTransferFields(line, [
      'sourceLineKey',
      'productId',
      'plannedQty',
      'notes',
      'unitIds',
    ]);
    return {
      sourceLineKey: normalizedBusinessKey(
        line.sourceLineKey,
        `lines[${index}].sourceLineKey`,
      ),
      productId: requiredId(
        line.productId,
        `lines[${index}].productId`,
      ),
      plannedQty: positiveQuantity(
        line.plannedQty,
        `lines[${index}].plannedQty`,
      ),
      notes: optionalBoundedString(
        line.notes,
        `lines[${index}].notes`,
        2_000,
      ),
      unitIds:
        line.unitIds === undefined || line.unitIds === null
          ? null
          : line.unitIds,
    };
  });
}

function normalizeTransferReceiptLines(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw validationError(
      'lines must contain at least one transfer receipt line.',
    );
  }
  if (value.length > 100) {
    throw validationError(
      'A transfer receipt cannot contain more than 100 lines.',
    );
  }
  const seen = new Set<string>();
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw validationError(`lines[${index}] must be an object.`);
    }
    const line = raw as Record<string, unknown>;
    assertAllowedTransferFields(line, [
      'transferLineId',
      'receivedQty',
      'unavailableQty',
      'differenceQty',
      'unitIds',
      'unavailableUnitIds',
      'differenceUnitIds',
      'notes',
    ]);
    const transferLineId = requiredId(
      line.transferLineId,
      `lines[${index}].transferLineId`,
    );
    if (seen.has(transferLineId)) {
      throw validationError(
        'A transfer receipt cannot repeat the same transfer line.',
      );
    }
    seen.add(transferLineId);
    const receivedQty = nonNegativeBottleCount(
      line.receivedQty,
      `lines[${index}].receivedQty`,
    );
    const unavailableQty = nonNegativeBottleCount(
      line.unavailableQty,
      `lines[${index}].unavailableQty`,
    );
    const differenceQty = nonNegativeBottleCount(
      line.differenceQty,
      `lines[${index}].differenceQty`,
    );
    if (receivedQty + differenceQty <= 0) {
      throw validationError(
        `lines[${index}] must receive or close at least one bottle.`,
      );
    }
    if (unavailableQty > receivedQty) {
      throw validationError(
        `lines[${index}].unavailableQty cannot exceed receivedQty.`,
      );
    }
    const notes = optionalBoundedString(
      line.notes,
      `lines[${index}].notes`,
      2_000,
    );
    if (differenceQty > 0 && !notes) {
      throw validationError(
        `lines[${index}].notes is required when differenceQty is positive.`,
      );
    }
    return {
      transferLineId,
      receivedQty,
      unavailableQty,
      differenceQty,
      unitIds:
        line.unitIds === undefined || line.unitIds === null
          ? null
          : normalizeSerializedReceiptUnitIds(
              line.unitIds,
              `lines[${index}].unitIds`,
            ),
      unavailableUnitIds:
        line.unavailableUnitIds === undefined ||
        line.unavailableUnitIds === null
          ? null
          : normalizeSerializedReceiptUnitIds(
              line.unavailableUnitIds,
              `lines[${index}].unavailableUnitIds`,
            ),
      differenceUnitIds:
        line.differenceUnitIds === undefined ||
        line.differenceUnitIds === null
          ? null
          : normalizeSerializedReceiptUnitIds(
              line.differenceUnitIds,
              `lines[${index}].differenceUnitIds`,
            ),
      notes,
    };
  });
}

function normalizeSerializedReceiptUnitIds(
  value: unknown,
  field: string,
) {
  if (!Array.isArray(value)) {
    throw validationError(`${field} must be an array.`);
  }
  const ids = value.map((id, index) =>
    requiredId(id, `${field}[${index}]`),
  );
  if (new Set(ids).size !== ids.length) {
    throw validationError(`${field} cannot contain duplicate unit IDs.`);
  }
  return ids;
}

function serializedReceiptUnitSnapshot(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { received: [], unavailable: [], difference: [] };
  }
  const snapshot = value as Record<string, unknown>;
  const safeIds = (candidate: unknown) =>
    Array.isArray(candidate)
      ? candidate.filter(
          (id): id is string =>
            typeof id === 'string' && id.trim().length > 0,
        )
      : [];
  return {
    received: safeIds(snapshot.received),
    unavailable: safeIds(snapshot.unavailable),
    difference: safeIds(snapshot.difference),
  };
}

function nonNegativeBottleCount(value: unknown, field: string) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  const parsed =
    typeof value === 'number'
      ? value
      : Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw validationError(
      `${field} must be a non-negative integer bottle count.`,
    );
  }
  return parsed;
}

function transferStatusForLines(lines: any[]) {
  const remaining = lines.reduce(
    (sum, line) =>
      sum +
      line.outboundQty -
      line.receivedQty -
      line.differenceQty,
    0,
  );
  if (remaining > 0) {
    return lines.some(
      (line) => line.receivedQty > 0 || line.differenceQty > 0,
    )
      ? 'PARTIALLY_RECEIVED'
      : 'OUTBOUND';
  }
  const totalReceived = lines.reduce(
    (sum, line) => sum + line.receivedQty,
    0,
  );
  return totalReceived > 0 ? 'RECEIVED' : 'CANCELLED';
}

function transferSnapshot(
  transfer: any,
  lines: any[],
  stockChanges: any[] = [],
) {
  return {
    id: transfer.id,
    transferNo: transfer.transferNo,
    sourceKey: transfer.sourceKey,
    fromWarehouse: transfer.fromWarehouse
      ? {
          id: transfer.fromWarehouse.id,
          code: transfer.fromWarehouse.code,
          name: transfer.fromWarehouse.name,
        }
      : { id: transfer.fromWarehouseId },
    toWarehouse: transfer.toWarehouse
      ? {
          id: transfer.toWarehouse.id,
          code: transfer.toWarehouse.code,
          name: transfer.toWarehouse.name,
        }
      : { id: transfer.toWarehouseId },
    status: String(transfer.status).toLowerCase(),
    outboundDocumentId: transfer.outboundDocumentId ?? null,
    outboundAt: transfer.outboundAt
      ? new Date(transfer.outboundAt).toISOString()
      : null,
    notes: transfer.notes ?? null,
    version: Number(transfer.version ?? 0),
    lines: lines.map((line) => {
      const sourceChange = stockChanges.find(
        (change) =>
          change.warehouseId === transfer.fromWarehouseId &&
          change.productId === line.productId,
      );
      const remainingInTransitQty = Math.max(
        0,
        line.outboundQty -
          line.receivedQty -
          line.differenceQty,
      );
      return {
        id: line.id,
        lineNo: Number(line.lineNo),
        sourceLineKey: line.sourceLineKey,
        productId: line.productId,
        productName:
          line.product?.name ?? line.productName ?? null,
        trackingMode:
          line.trackingModeSnapshot ??
          line.product?.inventoryTrackingMode ??
          null,
        plannedQty: Number(line.plannedQty),
        outboundQty: Number(line.outboundQty),
        receivedQty: Number(line.receivedQty),
        unavailableQty: Number(line.unavailableQty ?? 0),
        differenceQty: Number(line.differenceQty),
        remainingInTransitQty,
        serializedUnitIds:
          line.serializedUnitIds ?? null,
        serializedUnitCount: Array.isArray(
          line.serializedUnitIds,
        )
          ? line.serializedUnitIds.length
          : 0,
        notes: line.notes ?? null,
        shortageWarning: Boolean(
          sourceChange?.after?.shortageQty > 0,
        ),
        sourceShortageQty:
          sourceChange?.after?.shortageQty ?? 0,
        version: Number(line.version ?? 0),
      };
    }),
  };
}

function transferAuditSnapshot(snapshot: any) {
  return {
    transferId: snapshot.id,
    transferNo: snapshot.transferNo,
    fromWarehouseId: snapshot.fromWarehouse.id,
    toWarehouseId: snapshot.toWarehouse.id,
    status: snapshot.status,
    lines: snapshot.lines.map((line: any) => ({
      transferLineId: line.id,
      productId: line.productId,
      plannedQty: line.plannedQty,
      outboundQty: line.outboundQty,
      receivedQty: line.receivedQty,
      unavailableQty: line.unavailableQty,
      differenceQty: line.differenceQty,
      remainingInTransitQty: line.remainingInTransitQty,
      serializedUnitCount: line.serializedUnitCount,
      shortageWarning: line.shortageWarning,
    })),
  };
}

function transferAuditAction(commandType: string) {
  const actions: Record<string, string> = {
    TRANSFER_CREATE: 'inventory.transfer.created',
    TRANSFER_CONFIRM_OUTBOUND:
      'inventory.transfer.outbound_confirmed',
    TRANSFER_RECEIVE: 'inventory.transfer.receipt_confirmed',
    TRANSFER_RECEIPT_REVERSE:
      'inventory.transfer.receipt_reversed',
    TRANSFER_OUTBOUND_REVERSE:
      'inventory.transfer.outbound_reversed',
  };
  return actions[commandType] ?? 'inventory.transfer.updated';
}

function transferLineComparator(left: any, right: any) {
  return (
    String(left.productId).localeCompare(
      String(right.productId),
    ) || Number(left.lineNo) - Number(right.lineNo)
  );
}

function transferNumber(receiptId: string) {
  const compact = receiptId
    .replace(/-/g, '')
    .slice(0, 20)
    .toUpperCase();
  return `TRF-${compact}`;
}

function transferReceiptNumber(receiptId: string) {
  const compact = receiptId
    .replace(/-/g, '')
    .slice(0, 20)
    .toUpperCase();
  return `TRR-${compact}`;
}

function normalizeInboundKind(value: unknown) {
  const kind =
    typeof value === 'string'
      ? value.trim().toUpperCase()
      : 'OTHER_IN';
  const mapping: Record<string, any> = {
    OPENING: {
      documentType: 'OPENING',
      movementType: 'OPENING_IN',
    },
    PURCHASE_RECEIPT: {
      documentType: 'PURCHASE_RECEIPT',
      movementType: 'PURCHASE_IN',
    },
    CUSTOMER_RETURN: {
      documentType: 'CUSTOMER_RETURN',
      movementType: 'CUSTOMER_RETURN',
    },
    STOCK_GAIN: {
      documentType: 'STOCK_GAIN',
      movementType: 'STOCK_GAIN',
    },
    OTHER_IN: {
      documentType: 'OTHER_IN',
      movementType: 'OTHER_IN',
    },
  };
  if (!mapping[kind]) {
    throw validationError('Unsupported inbound kind.');
  }
  return mapping[kind];
}

function assertAllowedCommandFields(
  commandType: InventoryCommandType,
  input: any,
) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('The inventory command body must be an object.');
  }
  const common = [
    'sourceKey',
    'idempotencyKey',
    'requestHash',
    'businessAt',
    'reason',
    'sourceId',
  ];
  const specific: Record<InventoryCommandType, string[]> = {
    INBOUND: [
      'warehouseId',
      'productId',
      'quantity',
      'kind',
      'condition',
      'batchId',
      'batch',
      'notes',
      'attachmentMetadata',
    ],
    RESERVE: [
      'warehouseId',
      'productId',
      'salesOrderId',
      'salesOrderItemId',
      'inventoryLineKey',
      'quantity',
    ],
    RELEASE: ['reservationId', 'quantity'],
    OUTBOUND: [
      'warehouseId',
      'productId',
      'quantity',
      'kind',
      'reservationId',
      'batchId',
    ],
    TRANSFER_OUT: [
      'fromWarehouseId',
      'toWarehouseId',
      'productId',
      'quantity',
      'batchId',
    ],
    TRANSFER_IN: [
      'fromWarehouseId',
      'toWarehouseId',
      'productId',
      'quantity',
    ],
    TRANSFER_CREATE: [
      'fromWarehouseId',
      'toWarehouseId',
      'notes',
      'lines',
    ],
    TRANSFER_CONFIRM_OUTBOUND: [
      'transferId',
    ],
    TRANSFER_RECEIVE: [
      'transferId',
      'notes',
      'lines',
    ],
    TRANSFER_RECEIPT_REVERSE: [
      'receiptId',
    ],
    TRANSFER_OUTBOUND_REVERSE: [
      'transferId',
    ],
    MARK_UNAVAILABLE: [
      'warehouseId',
      'productId',
      'quantity',
      'batchId',
    ],
    RESTORE_AVAILABLE: [
      'warehouseId',
      'productId',
      'quantity',
      'batchId',
    ],
    UPDATE_BATCH_COST: [
      'batchId',
      'purchaseUnitCostCents',
    ],
    REVERSE: ['documentId', 'documentScope'],
  };
  const allowed = new Set([...common, ...specific[commandType]]);
  const unsupported = Object.keys(input).find((key) => !allowed.has(key));
  if (unsupported) {
    throw validationError(`Unsupported inventory field: ${unsupported}.`);
  }
  if (input.batch !== undefined) {
    if (
      !input.batch ||
      typeof input.batch !== 'object' ||
      Array.isArray(input.batch)
    ) {
      throw validationError('batch must be an object.');
    }
    const batchFields = new Set([
      'sourceLineKey',
      'supplierName',
      'purchaseOrderNo',
      'productionBatch',
      'productionDate',
      'purchaseUnitCostCents',
      'fifoAt',
    ]);
    const unsupportedBatch = Object.keys(input.batch).find(
      (key) => !batchFields.has(key),
    );
    if (unsupportedBatch) {
      throw validationError(
        `Unsupported inventory batch field: ${unsupportedBatch}.`,
      );
    }
  }
  if (input.condition !== undefined) {
    const condition =
      typeof input.condition === 'string'
        ? input.condition.trim().toUpperCase()
        : '';
    if (!['SALEABLE', 'UNAVAILABLE'].includes(condition)) {
      throw validationError(
        'condition must be SALEABLE or UNAVAILABLE.',
      );
    }
  }
  if (input.attachmentMetadata !== undefined) {
    normalizeAttachmentMetadata(input.attachmentMetadata);
  }
  if (
    input.documentScope !== undefined &&
    ![
      'INBOUND_ONLY',
      'TRANSFER_OUTBOUND',
      'TRANSFER_RECEIPT',
      'AFTER_SALES_RECEIPT',
      'STOCKTAKE',
    ].includes(input.documentScope)
  ) {
    throw validationError('Unsupported inventory document scope.');
  }
}

function normalizeOutboundKind(value: unknown) {
  const kind =
    typeof value === 'string'
      ? value.trim().toUpperCase()
      : 'OTHER_OUT';
  const mapping: Record<string, any> = {
    SALES_OUTBOUND: {
      documentType: 'SALES_OUTBOUND',
      movementType: 'SALES_OUT',
    },
    STOCK_LOSS: {
      documentType: 'STOCK_LOSS',
      movementType: 'STOCK_LOSS',
    },
    OTHER_OUT: {
      documentType: 'OTHER_OUT',
      movementType: 'OTHER_OUT',
    },
  };
  if (!mapping[kind]) {
    throw validationError('Unsupported outbound kind.');
  }
  return mapping[kind];
}

function commandBusinessAt(input: any) {
  return optionalBusinessDate(input.businessAt, 'businessAt') ?? new Date();
}

function commandReason(input: any) {
  return optionalBoundedString(input.reason, 'reason', 500);
}

function requiredCorrectionReason(value: unknown) {
  const reason = optionalBoundedString(value, 'reason', 500);
  if (!reason) {
    throw validationError('reason is required for an inventory correction.');
  }
  return reason;
}

function commandSourceId(input: any) {
  return optionalBoundedString(input.sourceId, 'sourceId', 100);
}

function documentNumber(receiptId: string) {
  const compact = receiptId.replace(/-/g, '').slice(0, 20).toUpperCase();
  return `INV-${compact}`;
}

function assertCostWriteAllowed(actor: any, batchInput: any) {
  if (
    batchInput?.purchaseUnitCostCents !== undefined &&
    batchInput?.purchaseUnitCostCents !== null &&
    !ADMIN_ROLES.has(normalizedRole(actor))
  ) {
    throw createHttpError(
      403,
      'INVENTORY_COST_FIELD_FORBIDDEN',
      'This role cannot submit inventory purchase cost.',
    );
  }
}

function assertBusinessInboundInput(actor: any, input: any) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('The inventory command body must be an object.');
  }
  const kind =
    typeof input.kind === 'string'
      ? input.kind.trim().toUpperCase()
      : '';
  if (!BUSINESS_INBOUND_KINDS.has(kind)) {
    throw validationError(
      'kind must be OPENING, PURCHASE_RECEIPT, or OTHER_IN.',
    );
  }
  if (
    !input.batch ||
    typeof input.batch !== 'object' ||
    Array.isArray(input.batch)
  ) {
    throw validationError('A new inventory batch is required.');
  }
  if (input.batchId !== undefined && input.batchId !== null) {
    throw validationError(
      'Existing batches cannot be used for a business inbound document.',
    );
  }
  normalizedBusinessKey(
    input.batch.sourceLineKey,
    'batch.sourceLineKey',
  );
  assertCostWriteAllowed(actor, input.batch);
}

function openingKey(warehouseId: string, productId: string) {
  return normalizedBusinessKey(
    `opening:${warehouseId}:${productId}`,
    'openingEntryKey',
  );
}

function normalizeAttachmentMetadata(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Array.isArray(value) || value.length > 20) {
    throw validationError(
      'attachmentMetadata must be an array with no more than 20 items.',
    );
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw validationError(
        `attachmentMetadata[${index}] must be an object.`,
      );
    }
    const record = item as Record<string, unknown>;
    const allowed = new Set([
      'fileName',
      'contentType',
      'sizeBytes',
      'checksumSha256',
    ]);
    const unsupported = Object.keys(record).find(
      (key) => !allowed.has(key),
    );
    if (unsupported) {
      throw validationError(
        `Unsupported attachment metadata field: ${unsupported}.`,
      );
    }
    const fileName = optionalBoundedString(
      record.fileName,
      `attachmentMetadata[${index}].fileName`,
      255,
    );
    const contentType = optionalBoundedString(
      record.contentType,
      `attachmentMetadata[${index}].contentType`,
      120,
    );
    const sizeBytes = optionalNonNegativeInteger(
      record.sizeBytes,
      `attachmentMetadata[${index}].sizeBytes`,
    );
    const checksumSha256 = optionalBoundedString(
      record.checksumSha256,
      `attachmentMetadata[${index}].checksumSha256`,
      64,
    );
    if (
      checksumSha256 &&
      !/^[0-9a-f]{64}$/i.test(checksumSha256)
    ) {
      throw validationError(
        `attachmentMetadata[${index}].checksumSha256 must be a SHA-256 hexadecimal string.`,
      );
    }
    if (!fileName) {
      throw validationError(
        `attachmentMetadata[${index}].fileName is required.`,
      );
    }
    return {
      fileName,
      contentType,
      sizeBytes,
      checksumSha256: checksumSha256?.toLowerCase() ?? null,
    };
  });
}

function assertReservationMatches(
  reservation: any,
  warehouseId: string,
  productId: string,
) {
  if (
    reservation.warehouseId !== warehouseId ||
    reservation.productId !== productId
  ) {
    throw createHttpError(
      409,
      'INVENTORY_RESERVATION_SCOPE_MISMATCH',
      'The reservation does not belong to the requested warehouse and product.',
    );
  }
}

function assertDifferentWarehouses(from: string, to: string) {
  if (from === to) {
    throw validationError(
      'fromWarehouseId and toWarehouseId must be different.',
    );
  }
}

function safeQuantitySum(left: number, right: number) {
  const value = left + right;
  if (
    !Number.isSafeInteger(value) ||
    value < -2_147_483_648 ||
    value > 2_147_483_647
  ) {
    throw createHttpError(
      409,
      'INVENTORY_QUANTITY_OVERFLOW',
      'The inventory quantity exceeds the supported integer range.',
    );
  }
  return value;
}

function concurrentUpdateError() {
  return createHttpError(
    409,
    'INVENTORY_CONCURRENT_UPDATE',
    'Inventory changed concurrently. Please retry the command.',
  );
}

function validationError(message: string) {
  return createHttpError(
    400,
    'INVENTORY_VALIDATION_FAILED',
    message,
  );
}

function normalizedRole(actor: any) {
  return typeof actor?.role === 'string'
    ? actor.role.trim().toLowerCase()
    : '';
}

function requireRole(actor: any, roles: Set<string>) {
  if (!roles.has(normalizedRole(actor))) {
    throw createHttpError(
      403,
      'PERMISSION_DENIED',
      'You do not have permission to perform this inventory operation.',
    );
  }
}

function boundedTraceId(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }
  return value.normalize('NFKC').trim().slice(0, 64) || null;
}

function safeInventoryOrderContext(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const salesOrderId =
    typeof value.salesOrderId === 'string'
      ? value.salesOrderId.trim().slice(0, 100)
      : '';
  const inventoryLineKey =
    typeof value.inventoryLineKey === 'string'
      ? value.inventoryLineKey.trim().slice(0, 191)
      : '';
  if (!salesOrderId || !inventoryLineKey) {
    return null;
  }
  return {
    salesOrderId,
    inventoryLineKey,
  };
}

function buildRoleSafeAuditSnapshot(
  commandType: InventoryCommandType,
  outcome: CommandOutcome,
) {
  return {
    commandType,
    documentId: outcome.documentId,
    reversalOfDocumentId: outcome.reversalOfDocumentId ?? null,
    movementIds: outcome.movementIds,
    stockChanges: outcome.stockChanges.map((change) => ({
      warehouseId: change.warehouseId,
      productId: change.productId,
      delta: change.delta,
      availableQty: change.after.availableQty,
      shortageQty: change.after.shortageQty,
      version: change.after.version,
    })),
    batchIds: outcome.batchChanges.map((change) => change.batchId),
    reservationId: outcome.reservation?.id ?? null,
  };
}

function uniqueWarehouseProductPairs(stockChanges: any[]) {
  return uniqueKeys(
    stockChanges.map((change) => ({
      warehouseId: change.warehouseId,
      productId: change.productId,
    })),
  );
}

function uniqueKeys(keys: Array<{ warehouseId: string; productId: string }>) {
  const result = new Map<string, { warehouseId: string; productId: string }>();
  for (const key of keys) {
    result.set(stockMapKey(key.warehouseId, key.productId), key);
  }
  return [...result.values()];
}

function stockMapKey(warehouseId: string, productId: string) {
  return `${warehouseId}\u0000${productId}`;
}

function stockKeyComparator(
  left: { warehouseId: string; productId: string },
  right: { warehouseId: string; productId: string },
) {
  return stockMapKey(left.warehouseId, left.productId).localeCompare(
    stockMapKey(right.warehouseId, right.productId),
  );
}

function sumStockDeltas(deltas: InventoryStockDelta[]) {
  return deltas.reduce(
    (sum, delta) => ({
      onHandDelta: sum.onHandDelta + delta.onHandDelta,
      reservedDelta: sum.reservedDelta + delta.reservedDelta,
      unavailableDelta:
        sum.unavailableDelta + delta.unavailableDelta,
      inTransitDelta: sum.inTransitDelta + delta.inTransitDelta,
    }),
    { ...ZERO_STOCK_DELTA },
  );
}

function sumBatchReversalDeltas(movements: any[]): InventoryBatchDelta {
  return movements.reduce(
    (sum, movement) => {
      const reversesInbound = isInboundMovement(
        movement.movementType,
      );
      return {
        receivedDelta:
          sum.receivedDelta +
          (reversesInbound ? -movement.onHandDelta : 0),
        remainingDelta:
          sum.remainingDelta - movement.onHandDelta,
        unavailableDelta:
          sum.unavailableDelta - movement.unavailableDelta,
      };
    },
    {
      receivedDelta: 0,
      remainingDelta: 0,
      unavailableDelta: 0,
    },
  );
}

function reverseReservationSnapshot(
  reservation: any,
  movements: any[],
) {
  let requestedQty = reservation.requestedQty;
  let reservedQty = reservation.reservedQty;
  let outboundQty = reservation.outboundQty;
  for (const movement of movements) {
    if (movement.movementType === 'RESERVE') {
      requestedQty -= movement.reservedDelta;
      reservedQty -= movement.reservedDelta;
    } else if (movement.movementType === 'RELEASE') {
      requestedQty -= movement.reservedDelta;
      reservedQty -= movement.reservedDelta;
    } else if (movement.movementType === 'SALES_OUT') {
      reservedQty -= movement.reservedDelta;
      outboundQty += movement.onHandDelta;
    }
  }
  const status =
    reservedQty > 0
      ? 'RESERVED'
      : outboundQty > 0
        ? 'CONSUMED'
        : 'RELEASED';
  return {
    requestedQty,
    reservedQty,
    assignedQty: reservation.assignedQty,
    outboundQty,
    status,
    releasedAt: status === 'RELEASED' ? new Date() : null,
    consumedAt: status === 'CONSUMED' ? new Date() : null,
  };
}

function isInboundMovement(movementType: string) {
  return new Set([
    'OPENING_IN',
    'PURCHASE_IN',
    'CUSTOMER_RETURN',
    'STOCK_GAIN',
    'OTHER_IN',
    'TRANSFER_IN',
  ]).has(movementType);
}

function rebuildBatch(movements: any[]) {
  return movements.reduce(
    (sum, movement) => {
      const originalType =
        movement.movementType === 'REVERSAL'
          ? movement.reversalOf?.movementType
          : movement.movementType;
      const receivedDelta = isInboundMovement(originalType)
        ? movement.onHandDelta
        : 0;
      return {
        receivedQty: sum.receivedQty + receivedDelta,
        remainingQty: sum.remainingQty + movement.onHandDelta,
        unavailableQty:
          sum.unavailableQty + movement.unavailableDelta,
      };
    },
    {
      receivedQty: 0,
      remainingQty: 0,
      unavailableQty: 0,
    },
  );
}

export function rebuildSerializedConsistency(
  rows: {
    units: any[];
    reservations: any[];
  },
  stock: {
    onHandQty: number;
    reservedQty: number;
    unavailableQty: number;
    inTransitQty: number;
  },
) {
  const issues: Array<{
    code: string;
    unitId?: string;
    reservationId?: string;
  }> = [];
  let unitOnHandQty = 0;
  let unitUnavailableQty = 0;
  let legacyAllocatedCount = 0;
  let activeAssignmentCount = 0;
  let outboundAssignmentCount = 0;

  for (const unit of rows.units) {
    const status = String(unit.status);
    const activeAssignments = (unit.assignments || []).filter(
      (assignment: any) => assignment.status === 'RESERVED',
    );
    const outboundAssignments = (unit.assignments || []).filter(
      (assignment: any) => assignment.status === 'OUTBOUND',
    );
    activeAssignmentCount += activeAssignments.length;
    outboundAssignmentCount += outboundAssignments.length;

    if (
      ['PENDING_COST', 'AVAILABLE', 'RESERVED', 'UNAVAILABLE'].includes(
        status,
      )
    ) {
      unitOnHandQty += 1;
    }
    if (['PENDING_COST', 'UNAVAILABLE'].includes(status)) {
      unitUnavailableQty += 1;
    }
    if (status === 'ALLOCATED') {
      legacyAllocatedCount += 1;
      issues.push({
        code: 'SERIALIZED_LEGACY_ALLOCATED_REQUIRES_CLASSIFICATION',
        unitId: unit.id,
      });
    }
    if (
      status !== 'ALLOCATED' &&
      (unit.inventoryMovements || []).length === 0
    ) {
      issues.push({
        code: 'SERIALIZED_UNIT_MOVEMENT_MISSING',
        unitId: unit.id,
      });
    }
    if (
      status === 'AVAILABLE' &&
      unit.purchaseCostCents === null
    ) {
      issues.push({
        code: 'SERIALIZED_AVAILABLE_COST_MISSING',
        unitId: unit.id,
      });
    }
    if (status === 'RESERVED') {
      if (activeAssignments.length !== 1) {
        issues.push({
          code: 'SERIALIZED_RESERVED_ACTIVE_ASSIGNMENT_COUNT',
          unitId: unit.id,
        });
      }
    } else if (activeAssignments.length !== 0) {
      issues.push({
        code: 'SERIALIZED_NON_RESERVED_HAS_ACTIVE_ASSIGNMENT',
        unitId: unit.id,
      });
    }
    for (const assignment of activeAssignments) {
      if (assignment.activeUnitKey !== unit.id) {
        issues.push({
          code: 'SERIALIZED_ACTIVE_UNIT_KEY_MISMATCH',
          unitId: unit.id,
          reservationId: assignment.reservationId,
        });
      }
    }
    for (const assignment of outboundAssignments) {
      const hasEffectiveSalesOut = (
        unit.inventoryMovements || []
      ).some(
        (movement: any) =>
          movement.movementType === 'SALES_OUT' &&
          movement.reservationId === assignment.reservationId &&
          !movement.reversedByMovement,
      );
      if (status !== 'OUTBOUND' || !hasEffectiveSalesOut) {
        issues.push({
          code:
            status !== 'OUTBOUND'
              ? 'SERIALIZED_OUTBOUND_ASSIGNMENT_UNIT_STATUS'
              : 'SERIALIZED_OUTBOUND_ASSIGNMENT_MOVEMENT_MISSING',
          unitId: unit.id,
          reservationId: assignment.reservationId,
        });
      }
      if (assignment.activeUnitKey !== null) {
        issues.push({
          code: 'SERIALIZED_OUTBOUND_ASSIGNMENT_STILL_ACTIVE',
          unitId: unit.id,
          reservationId: assignment.reservationId,
        });
      }
    }
  }

  let reservationAssignedQty = 0;
  let reservationOutboundQty = 0;
  for (const reservation of rows.reservations) {
    const assignmentAssignedQty = (
      reservation.assignments || []
    ).filter(
      (assignment: any) => assignment.status === 'RESERVED',
    ).length;
    const assignmentOutboundQty = (
      reservation.assignments || []
    ).filter(
      (assignment: any) => assignment.status === 'OUTBOUND',
    ).length;
    reservationAssignedQty += Number(reservation.assignedQty || 0);
    reservationOutboundQty += Number(reservation.outboundQty || 0);
    if (
      Number(reservation.assignedQty || 0) !==
      assignmentAssignedQty
    ) {
      issues.push({
        code: 'SERIALIZED_RESERVATION_ASSIGNED_SNAPSHOT_MISMATCH',
        reservationId: reservation.id,
      });
    }
    if (
      Number(reservation.outboundQty || 0) !==
      assignmentOutboundQty
    ) {
      issues.push({
        code: 'SERIALIZED_RESERVATION_OUTBOUND_SNAPSHOT_MISMATCH',
        reservationId: reservation.id,
      });
    }
  }

  if (unitOnHandQty !== Number(stock.onHandQty || 0)) {
    issues.push({ code: 'SERIALIZED_UNIT_ON_HAND_STOCK_MISMATCH' });
  }
  if (
    unitUnavailableQty !== Number(stock.unavailableQty || 0)
  ) {
    issues.push({
      code: 'SERIALIZED_UNIT_UNAVAILABLE_STOCK_MISMATCH',
    });
  }

  return {
    unitCount: rows.units.length,
    legacyAllocatedCount,
    unitOnHandQty,
    unitUnavailableQty,
    activeAssignmentCount,
    outboundAssignmentCount,
    reservationAssignedQty,
    reservationOutboundQty,
    issues,
    consistent: issues.length === 0,
  };
}

function numericDelta(expected: any, actual: any) {
  return Object.fromEntries(
    Object.keys(expected).map((key) => [
      key,
      actual[key] - expected[key],
    ]),
  );
}

function numericEqual(expected: any, actual: any) {
  return Object.keys(expected).every(
    (key) => expected[key] === actual[key],
  );
}

function isRetryableConcurrencyError(error: any) {
  return (
    error?.code === 'P2002' ||
    error?.code === 'P2034' ||
    error?.code === 'INVENTORY_CONCURRENT_UPDATE'
  );
}

function mapInventoryWriteError(error: any) {
  if (error?.code === 'P2002') {
    const target = Array.isArray(error?.meta?.target)
      ? error.meta.target.join(',')
      : String(error?.meta?.target ?? '');
    if (target.includes('opening_entry_key')) {
      return createHttpError(
        409,
        'INVENTORY_OPENING_ALREADY_EXISTS',
        'Opening inventory already exists for this warehouse and product.',
      );
    }
    if (target.includes('source_line_key')) {
      return createHttpError(
        409,
        'INVENTORY_SOURCE_LINE_KEY_CONFLICT',
        'The source line already identifies another inventory fact.',
      );
    }
    return createHttpError(
      409,
      'INVENTORY_SOURCE_KEY_CONFLICT',
      'The inventory source key already identifies another fact.',
    );
  }
  if (
    error?.code === 'P2034' ||
    error?.code === 'INVENTORY_CONCURRENT_UPDATE'
  ) {
    return concurrentUpdateError();
  }
  return error;
}
