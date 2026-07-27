import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import { InventoryAccountingService } from './inventory-accounting.service';
import {
  calculateInventoryRequestHash,
  canonicalJson,
  normalizedBusinessKey,
  optionalBoundedString,
} from './inventory-command.policy';
import { InventoryPostCommitService } from './inventory-post-commit.service';
import {
  actorId,
  actorName,
  actorRole,
  InventoryPrismaRepository,
} from './inventory.prisma.repository';
import { SerializedInventoryAccountingAdapter } from './serialized-inventory-accounting.adapter';

const RECEIPT_WRITE_ROLES = new Set([
  'super_admin',
  'admin',
  'warehouse',
]);
const RECEIPT_READ_ROLES = new Set([
  'super_admin',
  'admin',
  'warehouse',
  'finance',
  'boss',
  'after_sales',
]);
const RECEIPT_DETAIL_ROLES = new Set([
  'super_admin',
  'admin',
  'warehouse',
]);
const MAX_WRITE_ATTEMPTS = 3;

type ReceiptAction = 'CREATE' | 'POST' | 'REVERSE' | 'FULFILL';

@Injectable()
export class AfterSalesInventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: InventoryPrismaRepository,
    private readonly accountingService: InventoryAccountingService,
    private readonly serializedAdapter: SerializedInventoryAccountingAdapter,
    private readonly operationLogsService: OperationLogsNestService,
    private readonly postCommitService: InventoryPostCommitService,
  ) {}

  async listReceipts(actor: any, afterSalesOrderId: string) {
    requireRole(actor, RECEIPT_READ_ROLES);
    const order = await (this.prisma as any).afterSalesOrder.findUnique({
      where: { id: requiredString(afterSalesOrderId, 'afterSalesOrderId') },
      select: { id: true },
    });
    if (!order) {
      throw notFound('AFTER_SALES_ORDER_NOT_FOUND', 'After-sales order does not exist.');
    }
    const receipts = await (this.prisma as any).afterSalesReceipt.findMany({
      where: { afterSalesOrderId: order.id },
      include: receiptInclude(),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return receipts.map((receipt: any) => receiptDto(receipt, actor));
  }

  async createReceipt(
    actor: any,
    afterSalesOrderId: string,
    rawInput: any,
    metadata: any = {},
  ) {
    requireRole(actor, RECEIPT_WRITE_ROLES);
    const input = normalizeCreateInput(afterSalesOrderId, rawInput);
    const envelope = receiptEnvelope('CREATE', rawInput, input);
    const replay = await this.findCreateReplay(
      envelope.idempotencyKey,
      envelope.requestHash,
      actor,
    );
    if (replay) {
      return { afterSalesReceipt: replay, replayed: true };
    }
    try {
      const created = await this.repository.runInTransaction(async (tx) => {
        const afterSalesOrder = await tx.afterSalesOrder.findUnique({
          where: { id: input.afterSalesOrderId },
          include: {
            items: true,
            salesOrder: {
              select: { id: true, orderType: true },
            },
          },
        });
        if (!afterSalesOrder) {
          throw notFound(
            'AFTER_SALES_ORDER_NOT_FOUND',
            'After-sales order does not exist.',
          );
        }
        if (String(afterSalesOrder.salesOrder?.orderType) === 'AFTER_SALES') {
          throw conflict(
            'AFTER_SALES_SOURCE_ORDER_INVALID',
            'A financial after-sales sales order cannot be used as the physical return source.',
          );
        }
        const warehouse = await tx.warehouse.findUnique({
          where: { id: input.warehouseId },
          select: { id: true, isActive: true },
        });
        if (!warehouse?.isActive) {
          throw notFound(
            'INVENTORY_WAREHOUSE_NOT_FOUND',
            'The active receipt warehouse does not exist.',
          );
        }
        const itemById = new Map(
          (afterSalesOrder.items || []).map((item: any) => [item.id, item]),
        );
        const receipt = await tx.afterSalesReceipt.create({
          data: {
            afterSalesOrderId: afterSalesOrder.id,
            warehouseId: warehouse.id,
            status: 'DRAFT',
            sourceKey: envelope.sourceKey,
            idempotencyKey: envelope.idempotencyKey,
            requestHash: envelope.requestHash,
            notes: input.notes,
            version: 0,
            createdById: actorId(actor),
            updatedById: actorId(actor),
          },
        });
        for (const line of input.lines) {
          const afterSalesItem: any = itemById.get(
            line.afterSalesOrderItemId,
          );
          if (!afterSalesItem) {
            throw conflict(
              'AFTER_SALES_RECEIPT_ITEM_MISMATCH',
              'A receipt line does not belong to this after-sales order.',
            );
          }
          assertReturnableItem(afterSalesItem);
          const product = afterSalesItem.productId
            ? await tx.product.findUnique({
                where: { id: afterSalesItem.productId },
                select: {
                  id: true,
                  inventoryTrackingMode: true,
                },
              })
            : null;
          await validateReceiptLineScope(
            tx,
            line,
            product,
            warehouse.id,
          );
          const createdLine = await tx.afterSalesReceiptLine.create({
            data: {
              receiptId: receipt.id,
              afterSalesOrderItemId: afterSalesItem.id,
              lineNo: line.lineNo,
              receivedQty: line.receivedQty,
              condition: line.condition,
              inventoryBatchId: line.inventoryBatchId,
              exceptionReason: line.exceptionReason,
              notes: line.notes,
              version: 0,
            },
          });
          if (product?.inventoryTrackingMode === 'SERIALIZED') {
            for (const scan of line.serializedUnits) {
              const classification = await classifySerializedScan(
                tx,
                afterSalesOrder.salesOrder.id,
                product.id,
                scan,
              );
              await tx.afterSalesReceiptSerializedUnit.create({
                data: {
                  receiptLineId: createdLine.id,
                  originalSerializedUnitId: classification.unit?.id ?? null,
                  scannedLogisticsCodeSnapshot: scan.scannedLogisticsCode,
                  normalizedScannedLogisticsCode:
                    scan.normalizedScannedLogisticsCode,
                  matchStatus: classification.status,
                  activeOriginalUnitKey: null,
                  previousWarehouseId: null,
                  previousStatus: null,
                  inventoryMovementId: null,
                },
              });
            }
          }
        }
        const loaded = await loadReceipt(tx, receipt.id);
        await this.operationLogsService.appendLog(
          {
            userId: actorId(actor),
            actorNameSnapshot: actorName(actor),
            actorRoleSnapshot: actorRole(actor),
            action: 'after_sales_receipts.create',
            module: 'inventory',
            operationType: 'CREATE',
            entityType: 'after_sales_receipt',
            entityId: receipt.id,
            beforeData: null,
            afterData: receiptAuditSnapshot(loaded),
            requestSummary: {
              sourceKey: envelope.sourceKey,
              idempotencyKey: envelope.idempotencyKey,
            },
            requestId: boundedTraceId(metadata?.requestId),
            ipAddress: boundedIp(metadata?.ipAddress),
          },
          tx,
        );
        return loaded;
      });
      return {
        afterSalesReceipt: receiptDto(created, actor),
        replayed: false,
      };
    } catch (error: any) {
      const replay = await this.findCreateReplay(
        envelope.idempotencyKey,
        envelope.requestHash,
        actor,
      );
      if (replay) {
        return { afterSalesReceipt: replay, replayed: true };
      }
      throw mapReceiptWriteError(error);
    }
  }

  async postReceipt(
    actor: any,
    receiptId: string,
    rawInput: any,
    metadata: any = {},
  ) {
    requireRole(actor, RECEIPT_WRITE_ROLES);
    const input = normalizeLifecycleInput(receiptId, rawInput, false);
    const envelope = receiptEnvelope('POST', rawInput, input);
    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
      const commandReceiptIds: string[] = [];
      try {
        const posted = await this.repository.runInTransaction(async (tx) => {
          const receipt = await loadReceipt(tx, input.receiptId);
          if (!receipt) {
            throw notFound(
              'AFTER_SALES_RECEIPT_NOT_FOUND',
              'The after-sales receipt does not exist.',
            );
          }
          const replay = lifecycleReplay(
            receipt,
            'POST',
            envelope,
            actor,
          );
          if (replay) {
            return { receipt, replayed: true };
          }
          if (receipt.status !== 'DRAFT') {
            throw conflict(
              'AFTER_SALES_RECEIPT_NOT_DRAFT',
              'Only a draft receipt can be posted.',
            );
          }
          const claimed = await tx.afterSalesReceipt.updateMany({
            where: {
              id: receipt.id,
              version: receipt.version,
              status: 'DRAFT',
            },
            data: {
              status: 'POSTED',
              postSourceKey: envelope.sourceKey,
              postIdempotencyKey: envelope.idempotencyKey,
              postRequestHash: envelope.requestHash,
              confirmedById: actorId(actor),
              confirmedByNameSnapshot: actorName(actor),
              confirmedByRoleSnapshot: actorRole(actor),
              confirmedAt: new Date(),
              updatedById: actorId(actor),
              version: { increment: 1 },
            },
          });
          if (Number(claimed?.count || 0) !== 1) {
            throw concurrentReceiptError();
          }
          await claimReceivedQuantities(
            tx,
            receipt.lines,
            1,
          );
          const businessAt = input.businessAt ?? new Date();
          for (const line of [...receipt.lines].sort(receiptLineComparator)) {
            const item = line.afterSalesOrderItem;
            const product = item.product;
            if (!product) {
              if (line.condition !== 'EXCEPTION') {
                throw conflict(
                  'AFTER_SALES_RECEIPT_PRODUCT_MISSING',
                  'A receipt line without a current product can only be posted as an exception.',
                );
              }
              continue;
            }
            if (product.inventoryTrackingMode === 'NONE') {
              if (line.condition !== 'EXCEPTION') {
                throw conflict(
                  'INVENTORY_TRACKING_DISABLED',
                  'Inventory tracking is disabled for the returned product.',
                );
              }
              continue;
            }
            if (product.inventoryTrackingMode === 'QUANTITY') {
              if (line.condition === 'EXCEPTION') {
                continue;
              }
              const sourceKey = childBusinessKey(
                envelope.sourceKey,
                `line:${line.id}:return`,
              );
              const command: any = {
                sourceKey,
                idempotencyKey: childBusinessKey(
                  envelope.idempotencyKey,
                  `line:${line.id}:return`,
                ),
                sourceId: receipt.id,
                warehouseId: receipt.warehouseId,
                productId: product.id,
                quantity: Number(line.receivedQty),
                kind: 'CUSTOMER_RETURN',
                condition: line.condition,
                batchId: line.inventoryBatchId ?? undefined,
                businessAt,
                reason:
                  line.exceptionReason ??
                  'Actual after-sales goods received by warehouse.',
              };
              command.requestHash = calculateInventoryRequestHash(
                'INBOUND',
                command,
              );
              const result =
                await this.accountingService.executeAutomaticInTransaction(
                  'INBOUND',
                  actor,
                  command,
                  tx,
                  metadata,
                );
              if (result.commandReceiptId) {
                commandReceiptIds.push(result.commandReceiptId);
              }
              continue;
            }
            if (product.inventoryTrackingMode === 'SERIALIZED') {
              for (const serializedFact of line.serializedUnits || []) {
                const classification = await classifySerializedScan(
                  tx,
                  receipt.afterSalesOrder.salesOrder.id,
                  product.id,
                  {
                    originalSerializedUnitId:
                      serializedFact.originalSerializedUnitId,
                    scannedLogisticsCode:
                      serializedFact.scannedLogisticsCodeSnapshot,
                    normalizedScannedLogisticsCode:
                      serializedFact.normalizedScannedLogisticsCode,
                  },
                );
                if (line.condition === 'EXCEPTION') {
                  await tx.afterSalesReceiptSerializedUnit.update({
                    where: { id: serializedFact.id },
                    data: {
                      originalSerializedUnitId:
                        classification.unit?.id ?? null,
                      matchStatus:
                        classification.status === 'MATCHED'
                          ? 'CONFLICT'
                          : classification.status,
                      activeOriginalUnitKey: null,
                      previousWarehouseId: null,
                      previousStatus: null,
                      inventoryMovementId: null,
                    },
                  });
                  continue;
                }
                if (
                  classification.status !== 'MATCHED' ||
                  !classification.unit
                ) {
                  throw conflict(
                    'AFTER_SALES_SERIALIZED_MATCH_REQUIRED',
                    'An unknown or conflicting bottle must be posted as an exception and cannot restore inventory.',
                  );
                }
                const unitSourceKey = childBusinessKey(
                  envelope.sourceKey,
                  `serialized:${serializedFact.id}:return`,
                );
                const result =
                  await this.serializedAdapter.returnAfterSalesUnitInTransaction(
                    tx,
                    actor,
                    {
                      receiptId: receipt.id,
                      receiptLineId: line.id,
                      serializedReceiptUnitId: serializedFact.id,
                      sourceSalesOrderId:
                        receipt.afterSalesOrder.salesOrder.id,
                      warehouseId: receipt.warehouseId,
                      productId: product.id,
                      unitId: classification.unit.id,
                      normalizedScannedLogisticsCode:
                        serializedFact.normalizedScannedLogisticsCode,
                      condition: line.condition,
                      sourceKey: unitSourceKey,
                      reason:
                        line.exceptionReason ??
                        'Actual serialized after-sales bottle received.',
                    },
                    metadata,
                  );
                if (result.commandReceiptId) {
                  commandReceiptIds.push(result.commandReceiptId);
                }
                await tx.afterSalesReceiptSerializedUnit.update({
                  where: { id: serializedFact.id },
                  data: {
                    originalSerializedUnitId: classification.unit.id,
                    matchStatus: 'MATCHED',
                    activeOriginalUnitKey: classification.unit.id,
                    previousWarehouseId: result.previousWarehouseId,
                    previousStatus: result.previousStatus,
                    inventoryMovementId: result.inventoryMovementId,
                  },
                });
              }
            }
          }
          const loaded = await loadReceipt(tx, receipt.id);
          await this.operationLogsService.appendLog(
            {
              userId: actorId(actor),
              actorNameSnapshot: actorName(actor),
              actorRoleSnapshot: actorRole(actor),
              action: 'after_sales_receipts.post',
              module: 'inventory',
              operationType: 'STATUS_CHANGE',
              entityType: 'after_sales_receipt',
              entityId: receipt.id,
              beforeData: receiptAuditSnapshot(receipt),
              afterData: receiptAuditSnapshot(loaded),
              requestSummary: {
                sourceKey: envelope.sourceKey,
                idempotencyKey: envelope.idempotencyKey,
              },
              requestId: boundedTraceId(metadata?.requestId),
              ipAddress: boundedIp(metadata?.ipAddress),
            },
            tx,
          );
          return { receipt: loaded, replayed: false };
        });
        for (const commandReceiptId of new Set(commandReceiptIds)) {
          await this.postCommitService.dispatchForReceipt(commandReceiptId);
        }
        return {
          afterSalesReceipt: receiptDto(posted.receipt, actor),
          replayed: posted.replayed,
        };
      } catch (error: any) {
        const replay = await this.findLifecycleReplay(
          input.receiptId,
          'POST',
          envelope,
          actor,
        );
        if (replay) {
          return { afterSalesReceipt: replay, replayed: true };
        }
        if (isRetryable(error) && attempt < MAX_WRITE_ATTEMPTS) {
          continue;
        }
        throw mapReceiptWriteError(error);
      }
    }
    throw concurrentReceiptError();
  }

  async reverseReceipt(
    actor: any,
    receiptId: string,
    rawInput: any,
    metadata: any = {},
  ) {
    requireRole(actor, RECEIPT_WRITE_ROLES);
    const input = normalizeLifecycleInput(receiptId, rawInput, true);
    const envelope = receiptEnvelope('REVERSE', rawInput, input);
    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
      const commandReceiptIds: string[] = [];
      try {
        const reversed = await this.repository.runInTransaction(async (tx) => {
          const receipt = await loadReceipt(tx, input.receiptId);
          if (!receipt) {
            throw notFound(
              'AFTER_SALES_RECEIPT_NOT_FOUND',
              'The after-sales receipt does not exist.',
            );
          }
          const replay = lifecycleReplay(
            receipt,
            'REVERSE',
            envelope,
            actor,
          );
          if (replay) {
            return { receipt, replayed: true };
          }
          if (receipt.status !== 'POSTED') {
            throw conflict(
              'AFTER_SALES_RECEIPT_NOT_POSTED',
              'Only a posted receipt can be reversed.',
            );
          }
          const claimed = await tx.afterSalesReceipt.updateMany({
            where: {
              id: receipt.id,
              version: receipt.version,
              status: 'POSTED',
            },
            data: {
              status: 'REVERSED',
              reverseSourceKey: envelope.sourceKey,
              reverseIdempotencyKey: envelope.idempotencyKey,
              reverseRequestHash: envelope.requestHash,
              reversalReason: input.reason,
              reversedById: actorId(actor),
              reversedByNameSnapshot: actorName(actor),
              reversedByRoleSnapshot: actorRole(actor),
              reversedAt: new Date(),
              updatedById: actorId(actor),
              version: { increment: 1 },
            },
          });
          if (Number(claimed?.count || 0) !== 1) {
            throw concurrentReceiptError();
          }
          await claimReceivedQuantities(tx, receipt.lines, -1);
          for (const line of receipt.lines) {
            for (const serializedFact of line.serializedUnits || []) {
              if (
                !serializedFact.activeOriginalUnitKey ||
                !serializedFact.originalSerializedUnitId ||
                !serializedFact.previousWarehouseId
              ) {
                continue;
              }
              await this.serializedAdapter.restoreAfterSalesReturnedUnitInTransaction(
                tx,
                actor,
                {
                  unitId: serializedFact.originalSerializedUnitId,
                  receiptWarehouseId: receipt.warehouseId,
                  previousWarehouseId: serializedFact.previousWarehouseId,
                  currentCondition: line.condition,
                },
              );
            }
          }
          const documents = await tx.inventoryDocument.findMany({
            where: {
              sourceId: receipt.id,
              type: 'CUSTOMER_RETURN',
              status: 'POSTED',
              sourceType: {
                in: ['inbound', 'serialized_after_sales_return'],
              },
            },
            orderBy: [{ businessAt: 'asc' }, { id: 'asc' }],
          });
          if (documents.length === 0) {
            const inventoryBearingLines = receipt.lines.some(
              (line: any) => line.condition !== 'EXCEPTION',
            );
            if (inventoryBearingLines) {
              throw conflict(
                'AFTER_SALES_RECEIPT_INVENTORY_FACT_MISSING',
                'The posted receipt is missing its inventory return facts.',
              );
            }
          }
          for (const document of documents) {
            const sourceKey = childBusinessKey(
              envelope.sourceKey,
              `document:${document.id}:reverse`,
            );
            const command: any = {
              sourceKey,
              idempotencyKey: childBusinessKey(
                envelope.idempotencyKey,
                `document:${document.id}:reverse`,
              ),
              documentId: document.id,
              documentScope: 'AFTER_SALES_RECEIPT',
              sourceId: receipt.id,
              businessAt: input.businessAt ?? new Date(),
              reason: input.reason,
            };
            command.requestHash = calculateInventoryRequestHash(
              'REVERSE',
              command,
            );
            const result =
              await this.accountingService.executeAutomaticInTransaction(
                'REVERSE',
                actor,
                command,
                tx,
                metadata,
              );
            if (result.commandReceiptId) {
              commandReceiptIds.push(result.commandReceiptId);
            }
          }
          await tx.afterSalesReceiptSerializedUnit.updateMany({
            where: {
              receiptLine: { receiptId: receipt.id },
              activeOriginalUnitKey: { not: null },
            },
            data: { activeOriginalUnitKey: null },
          });
          const loaded = await loadReceipt(tx, receipt.id);
          await this.operationLogsService.appendLog(
            {
              userId: actorId(actor),
              actorNameSnapshot: actorName(actor),
              actorRoleSnapshot: actorRole(actor),
              action: 'after_sales_receipts.reverse',
              module: 'inventory',
              operationType: 'STATUS_CHANGE',
              entityType: 'after_sales_receipt',
              entityId: receipt.id,
              beforeData: receiptAuditSnapshot(receipt),
              afterData: receiptAuditSnapshot(loaded),
              requestSummary: {
                sourceKey: envelope.sourceKey,
                idempotencyKey: envelope.idempotencyKey,
              },
              requestId: boundedTraceId(metadata?.requestId),
              ipAddress: boundedIp(metadata?.ipAddress),
            },
            tx,
          );
          return { receipt: loaded, replayed: false };
        });
        for (const commandReceiptId of new Set(commandReceiptIds)) {
          await this.postCommitService.dispatchForReceipt(commandReceiptId);
        }
        return {
          afterSalesReceipt: receiptDto(reversed.receipt, actor),
          replayed: reversed.replayed,
        };
      } catch (error: any) {
        const replay = await this.findLifecycleReplay(
          input.receiptId,
          'REVERSE',
          envelope,
          actor,
        );
        if (replay) {
          return { afterSalesReceipt: replay, replayed: true };
        }
        if (isRetryable(error) && attempt < MAX_WRITE_ATTEMPTS) {
          continue;
        }
        throw mapReceiptWriteError(error);
      }
    }
    throw concurrentReceiptError();
  }

  async fulfillReplacement(
    actor: any,
    afterSalesOrderId: string,
    rawInput: any,
    metadata: any = {},
  ) {
    requireRole(actor, RECEIPT_WRITE_ROLES);
    const input = normalizeFulfillmentInput(afterSalesOrderId, rawInput);
    const envelope = receiptEnvelope('FULFILL', rawInput, input);
    const commandReceiptIds: string[] = [];
    try {
      const result = await this.repository.runInTransaction(async (tx) => {
        const existing = await this.repository.findCommandReceipt(
          envelope.idempotencyKey,
          tx,
        );
        if (existing) {
          return commandReceiptReplay(existing, envelope.requestHash);
        }
        const afterSalesOrder = await tx.afterSalesOrder.findUnique({
          where: { id: input.afterSalesOrderId },
          include: {
            items: {
              include: { product: true },
            },
            salesOrder: {
              select: {
                id: true,
                orderType: true,
              },
            },
          },
        });
        if (!afterSalesOrder) {
          throw notFound(
            'AFTER_SALES_ORDER_NOT_FOUND',
            'After-sales order does not exist.',
          );
        }
        if (!['RESEND', 'EXCHANGE'].includes(afterSalesOrder.actionType)) {
          throw conflict(
            'AFTER_SALES_FULFILLMENT_ACTION_INVALID',
            'Only RESEND or EXCHANGE after-sales orders can create replacement fulfillment.',
          );
        }
        if (
          !afterSalesOrder.salesOrder ||
          afterSalesOrder.salesOrder.orderType === 'AFTER_SALES'
        ) {
          throw conflict(
            'AFTER_SALES_SOURCE_ORDER_INVALID',
            'The financial negative after-sales order is never a physical fulfillment source.',
          );
        }
        const warehouse = await tx.warehouse.findUnique({
          where: { id: input.warehouseId },
          select: { id: true, isActive: true },
        });
        if (!warehouse?.isActive) {
          throw notFound(
            'INVENTORY_WAREHOUSE_NOT_FOUND',
            'The active fulfillment warehouse does not exist.',
          );
        }
        const parentReceipt = await this.repository.createCommandReceipt(tx, {
          sourceKey: envelope.sourceKey,
          idempotencyKey: envelope.idempotencyKey,
          commandType: 'AFTER_SALES_FULFILLMENT',
          requestHash: envelope.requestHash,
          status: 'PROCESSING',
          actorUserId: actorId(actor),
          actorNameSnapshot: actorName(actor),
          actorRoleSnapshot: actorRole(actor),
          requestId: boundedTraceId(metadata?.requestId),
        });
        const itemById = new Map(
          afterSalesOrder.items.map((item: any) => [item.id, item]),
        );
        const fulfilledLines = [];
        for (const line of input.lines) {
          const item: any = itemById.get(line.afterSalesOrderItemId);
          if (!item || !item.product) {
            throw conflict(
              'AFTER_SALES_FULFILLMENT_ITEM_MISMATCH',
              'A replacement line does not belong to this after-sales order or has no product.',
            );
          }
          if (line.quantity > Number(item.quantity || 0)) {
            throw conflict(
              'AFTER_SALES_FULFILLMENT_QUANTITY_EXCEEDED',
              'Replacement fulfillment cannot exceed the after-sales item quantity.',
            );
          }
          if (item.product.inventoryTrackingMode === 'NONE') {
            fulfilledLines.push({
              afterSalesOrderItemId: item.id,
              trackingMode: 'NONE',
              requestedQty: line.quantity,
              reservedQty: 0,
              outboundQty: 0,
            });
            continue;
          }
          const inventoryLineKey = childBusinessKey(
            `after-sales-fulfillment:${afterSalesOrder.id}`,
            item.id,
          );
          let reservation =
            await tx.inventoryReservation.findUnique({
              where: {
                salesOrderId_inventoryLineKey: {
                  salesOrderId: afterSalesOrder.salesOrder.id,
                  inventoryLineKey,
                },
              },
            });
          if (
            reservation &&
            reservation.warehouseId !== warehouse.id
          ) {
            throw conflict(
              'AFTER_SALES_FULFILLMENT_WAREHOUSE_IMMUTABLE',
              'A replacement fulfillment warehouse cannot change after inventory demand exists.',
            );
          }
          const currentTarget = reservation
            ? Number(reservation.requestedQty || 0)
            : 0;
          if (line.quantity < currentTarget) {
            throw conflict(
              'AFTER_SALES_FULFILLMENT_QUANTITY_IMMUTABLE',
              'Replacement demand cannot be reduced through this command.',
            );
          }
          const reserveDelta = line.quantity - currentTarget;
          if (reserveDelta > 0) {
            const sourceKey = childBusinessKey(
              envelope.sourceKey,
              `item:${item.id}:reserve`,
            );
            const command: any = {
              sourceKey,
              idempotencyKey: childBusinessKey(
                envelope.idempotencyKey,
                `item:${item.id}:reserve`,
              ),
              sourceId: afterSalesOrder.id,
              warehouseId: warehouse.id,
              productId: item.product.id,
              salesOrderId: afterSalesOrder.salesOrder.id,
              salesOrderItemId: null,
              inventoryLineKey,
              quantity: reserveDelta,
              reason: 'Independent after-sales replacement fulfillment.',
            };
            command.requestHash = calculateInventoryRequestHash(
              'RESERVE',
              command,
            );
            const reserved =
              await this.accountingService.executeAutomaticInTransaction(
                'RESERVE',
                actor,
                command,
                tx,
                {
                  ...metadata,
                  inventoryOrderContext: {
                    salesOrderId: afterSalesOrder.salesOrder.id,
                    inventoryLineKey,
                  },
                },
              );
            commandReceiptIds.push(reserved.commandReceiptId);
            reservation =
              await tx.inventoryReservation.findUnique({
                where: {
                  salesOrderId_inventoryLineKey: {
                    salesOrderId: afterSalesOrder.salesOrder.id,
                    inventoryLineKey,
                  },
                },
              });
          }
          if (input.action === 'OUTBOUND') {
            const outboundDelta =
              line.quantity - Number(reservation?.outboundQty || 0);
            if (outboundDelta > 0) {
              if (item.product.inventoryTrackingMode === 'SERIALIZED') {
                const serialized =
                  await this.serializedAdapter.assignReservationUnitsInTransaction(
                    tx,
                    actor,
                    {
                      reservationId: reservation.id,
                      autoAssignCount: outboundDelta,
                      outbound: true,
                      sourceKey: childBusinessKey(
                        envelope.sourceKey,
                        `item:${item.id}:serialized-outbound`,
                      ),
                      reason:
                        'Independent serialized after-sales replacement fulfillment.',
                    },
                    metadata,
                  );
                commandReceiptIds.push(
                  ...serialized.commandReceiptIds,
                );
              } else {
                const sourceKey = childBusinessKey(
                  envelope.sourceKey,
                  `item:${item.id}:outbound`,
                );
                const command: any = {
                  sourceKey,
                  idempotencyKey: childBusinessKey(
                    envelope.idempotencyKey,
                    `item:${item.id}:outbound`,
                  ),
                  sourceId: afterSalesOrder.id,
                  warehouseId: warehouse.id,
                  productId: item.product.id,
                  reservationId: reservation.id,
                  quantity: outboundDelta,
                  kind: 'SALES_OUTBOUND',
                  reason:
                    'Independent after-sales replacement fulfillment.',
                };
                command.requestHash = calculateInventoryRequestHash(
                  'OUTBOUND',
                  command,
                );
                const outbound =
                  await this.accountingService.executeAutomaticInTransaction(
                    'OUTBOUND',
                    actor,
                    command,
                    tx,
                    metadata,
                  );
                commandReceiptIds.push(outbound.commandReceiptId);
              }
            }
          }
          reservation =
            await tx.inventoryReservation.findUnique({
              where: {
                salesOrderId_inventoryLineKey: {
                  salesOrderId: afterSalesOrder.salesOrder.id,
                  inventoryLineKey,
                },
              },
            });
          fulfilledLines.push({
            afterSalesOrderItemId: item.id,
            trackingMode: item.product.inventoryTrackingMode,
            requestedQty: Number(reservation?.requestedQty || 0),
            reservedQty: Number(reservation?.reservedQty || 0),
            assignedQty: Number(reservation?.assignedQty || 0),
            outboundQty: Number(reservation?.outboundQty || 0),
            pendingQty: Math.max(
              0,
              line.quantity - Number(reservation?.outboundQty || 0),
            ),
          });
        }
        const snapshot = {
          afterSalesOrderId: afterSalesOrder.id,
          sourceSalesOrderId: afterSalesOrder.salesOrder.id,
          action: input.action.toLowerCase(),
          warehouseId: warehouse.id,
          lines: fulfilledLines,
        };
        await this.repository.completeCommandReceipt(
          tx,
          parentReceipt.id,
          null,
          {
            commandReceiptId: parentReceipt.id,
            ...snapshot,
          },
        );
        await this.operationLogsService.appendLog(
          {
            userId: actorId(actor),
            actorNameSnapshot: actorName(actor),
            actorRoleSnapshot: actorRole(actor),
            action: 'after_sales_fulfillment.post',
            module: 'inventory',
            operationType: 'UPDATE',
            entityType: 'after_sales_order',
            entityId: afterSalesOrder.id,
            beforeData: null,
            afterData: snapshot,
            requestSummary: {
              sourceKey: envelope.sourceKey,
              idempotencyKey: envelope.idempotencyKey,
            },
            requestId: boundedTraceId(metadata?.requestId),
            ipAddress: boundedIp(metadata?.ipAddress),
          },
          tx,
        );
        return {
          commandReceiptId: parentReceipt.id,
          ...snapshot,
          replayed: false,
        };
      });
      for (const commandReceiptId of new Set(commandReceiptIds)) {
        await this.postCommitService.dispatchForReceipt(commandReceiptId);
      }
      return result;
    } catch (error: any) {
      const existing = await this.repository.findCommandReceipt(
        envelope.idempotencyKey,
      );
      if (existing) {
        return commandReceiptReplay(existing, envelope.requestHash);
      }
      throw mapReceiptWriteError(error);
    }
  }

  private async findCreateReplay(
    idempotencyKey: string,
    requestHash: string,
    actor: any,
  ) {
    const receipt = await (this.prisma as any).afterSalesReceipt.findUnique({
      where: { idempotencyKey },
      include: receiptInclude(),
    });
    if (!receipt) {
      return null;
    }
    if (receipt.requestHash !== requestHash) {
      throw idempotencyConflict();
    }
    return receiptDto(receipt, actor);
  }

  private async findLifecycleReplay(
    receiptId: string,
    action: 'POST' | 'REVERSE',
    envelope: any,
    actor: any,
  ) {
    const receipt = await (this.prisma as any).afterSalesReceipt.findUnique({
      where: { id: receiptId },
      include: receiptInclude(),
    });
    if (!receipt) {
      return null;
    }
    return lifecycleReplay(receipt, action, envelope, actor)
      ? receiptDto(receipt, actor)
      : null;
  }
}

export function calculateAfterSalesReceiptRequestHash(
  action: ReceiptAction,
  input: any,
) {
  const sourceKey = normalizedBusinessKey(input?.sourceKey, 'sourceKey');
  const idempotencyKey = normalizedBusinessKey(
    input?.idempotencyKey,
    'idempotencyKey',
  );
  const payload = normalizeHashValue({
    ...input,
    sourceKey,
    idempotencyKey,
  }) as Record<string, unknown>;
  delete payload.requestHash;
  delete payload.requestId;
  return crypto
    .createHash('sha256')
    .update(
      canonicalJson({
        commandType: `AFTER_SALES_RECEIPT_${action}`,
        payload,
      }),
    )
    .digest('hex');
}

function normalizeCreateInput(afterSalesOrderId: string, raw: any) {
  assertPlainObject(raw);
  assertAllowedFields(raw, [
    'sourceKey',
    'idempotencyKey',
    'requestHash',
    'warehouseId',
    'notes',
    'lines',
  ]);
  const lines = Array.isArray(raw.lines) ? raw.lines : null;
  if (!lines || lines.length === 0) {
    throw validationError('lines must contain at least one receipt line.');
  }
  const seenLineNos = new Set<number>();
  return {
    afterSalesOrderId: requiredString(
      afterSalesOrderId,
      'afterSalesOrderId',
    ),
    warehouseId: requiredString(raw.warehouseId, 'warehouseId'),
    notes: optionalBoundedString(raw.notes, 'notes', 2_000),
    lines: lines.map((line: any, index: number) => {
      assertPlainObject(line, `lines[${index}]`);
      assertAllowedFields(line, [
        'afterSalesOrderItemId',
        'lineNo',
        'receivedQty',
        'condition',
        'inventoryBatchId',
        'exceptionReason',
        'notes',
        'serializedUnits',
      ]);
      const lineNo = positiveInteger(
        line.lineNo ?? index + 1,
        `lines[${index}].lineNo`,
      );
      if (seenLineNos.has(lineNo)) {
        throw validationError('Receipt lineNo values must be unique.');
      }
      seenLineNos.add(lineNo);
      const condition = normalizeCondition(
        line.condition,
        `lines[${index}].condition`,
      );
      const exceptionReason = optionalBoundedString(
        line.exceptionReason,
        `lines[${index}].exceptionReason`,
        500,
      );
      if (condition === 'EXCEPTION' && !exceptionReason) {
        throw validationError(
          `lines[${index}].exceptionReason is required for EXCEPTION.`,
        );
      }
      const serializedUnits =
        line.serializedUnits === undefined
          ? []
          : normalizeSerializedScans(
              line.serializedUnits,
              `lines[${index}].serializedUnits`,
            );
      return {
        afterSalesOrderItemId: requiredString(
          line.afterSalesOrderItemId,
          `lines[${index}].afterSalesOrderItemId`,
        ),
        lineNo,
        receivedQty: positiveInteger(
          line.receivedQty,
          `lines[${index}].receivedQty`,
        ),
        condition,
        inventoryBatchId: optionalString(
          line.inventoryBatchId,
          `lines[${index}].inventoryBatchId`,
        ),
        exceptionReason,
        notes: optionalBoundedString(
          line.notes,
          `lines[${index}].notes`,
          2_000,
        ),
        serializedUnits,
      };
    }),
  };
}

function normalizeLifecycleInput(
  receiptId: string,
  raw: any,
  requireReason: boolean,
) {
  assertPlainObject(raw);
  assertAllowedFields(raw, [
    'sourceKey',
    'idempotencyKey',
    'requestHash',
    'businessAt',
    'reason',
  ]);
  const reason = optionalBoundedString(raw.reason, 'reason', 500);
  if (requireReason && !reason) {
    throw validationError('reason is required to reverse a receipt.');
  }
  return {
    receiptId: requiredString(receiptId, 'receiptId'),
    businessAt: optionalDate(raw.businessAt, 'businessAt'),
    reason,
  };
}

function normalizeFulfillmentInput(afterSalesOrderId: string, raw: any) {
  assertPlainObject(raw);
  assertAllowedFields(raw, [
    'sourceKey',
    'idempotencyKey',
    'requestHash',
    'warehouseId',
    'action',
    'lines',
  ]);
  const action = String(raw.action || '').trim().toUpperCase();
  if (!['RESERVE', 'OUTBOUND'].includes(action)) {
    throw validationError('action must be RESERVE or OUTBOUND.');
  }
  if (!Array.isArray(raw.lines) || raw.lines.length === 0) {
    throw validationError('lines must contain replacement items.');
  }
  const seen = new Set<string>();
  return {
    afterSalesOrderId: requiredString(
      afterSalesOrderId,
      'afterSalesOrderId',
    ),
    warehouseId: requiredString(raw.warehouseId, 'warehouseId'),
    action,
    lines: raw.lines.map((line: any, index: number) => {
      assertPlainObject(line, `lines[${index}]`);
      assertAllowedFields(line, [
        'afterSalesOrderItemId',
        'quantity',
      ]);
      const itemId = requiredString(
        line.afterSalesOrderItemId,
        `lines[${index}].afterSalesOrderItemId`,
      );
      if (seen.has(itemId)) {
        throw validationError('Replacement items cannot be duplicated.');
      }
      seen.add(itemId);
      return {
        afterSalesOrderItemId: itemId,
        quantity: positiveInteger(
          line.quantity,
          `lines[${index}].quantity`,
        ),
      };
    }),
  };
}

function receiptEnvelope(
  action: ReceiptAction,
  raw: any,
  normalizedContent: any,
) {
  const sourceKey = normalizedBusinessKey(raw?.sourceKey, 'sourceKey');
  const idempotencyKey = normalizedBusinessKey(
    raw?.idempotencyKey,
    'idempotencyKey',
  );
  const requestHash = String(raw?.requestHash || '')
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(requestHash)) {
    throw validationError(
      'requestHash must be a lowercase SHA-256 hexadecimal string.',
    );
  }
  const calculated = calculateAfterSalesReceiptRequestHash(action, {
    ...normalizedContent,
    sourceKey,
    idempotencyKey,
  });
  if (calculated !== requestHash) {
    throw createHttpError(
      400,
      'INVENTORY_REQUEST_HASH_MISMATCH',
      'requestHash does not match the normalized after-sales inventory command.',
    );
  }
  return { sourceKey, idempotencyKey, requestHash };
}

async function validateReceiptLineScope(
  tx: any,
  line: any,
  product: any,
  warehouseId: string,
) {
  const mode = product?.inventoryTrackingMode ?? 'NONE';
  if (mode === 'SERIALIZED') {
    if (line.inventoryBatchId) {
      throw validationError(
        'inventoryBatchId is not accepted for serialized receipt lines.',
      );
    }
    if (line.serializedUnits.length !== line.receivedQty) {
      throw validationError(
        'serializedUnits count must equal receivedQty for a serialized product.',
      );
    }
    return;
  }
  if (line.serializedUnits.length > 0) {
    throw validationError(
      'serializedUnits are only accepted for serialized products.',
    );
  }
  if (line.inventoryBatchId) {
    const batch = await tx.inventoryBatch.findUnique({
      where: { id: line.inventoryBatchId },
      select: {
        id: true,
        warehouseId: true,
        productId: true,
      },
    });
    if (
      !batch ||
      batch.warehouseId !== warehouseId ||
      batch.productId !== product?.id
    ) {
      throw conflict(
        'AFTER_SALES_RECEIPT_BATCH_MISMATCH',
        'The selected batch does not belong to the receipt warehouse and product.',
      );
    }
  }
  if (
    (mode === 'NONE' || !product) &&
    line.condition !== 'EXCEPTION'
  ) {
    throw conflict(
      'INVENTORY_TRACKING_DISABLED',
      'A product without inventory tracking can only be recorded as a receipt exception.',
    );
  }
}

async function classifySerializedScan(
  tx: any,
  sourceSalesOrderId: string,
  productId: string,
  scan: any,
) {
  let unit = null;
  if (scan.originalSerializedUnitId) {
    unit = await tx.serializedInventoryUnit.findUnique({
      where: { id: scan.originalSerializedUnitId },
      include: serializedSourceAssignmentInclude(),
    });
  } else {
    unit = await tx.serializedInventoryUnit.findUnique({
      where: {
        normalizedLogisticsCode:
          scan.normalizedScannedLogisticsCode,
      },
      include: serializedSourceAssignmentInclude(),
    });
  }
  if (!unit) {
    return { status: 'UNKNOWN', unit: null };
  }
  const belongsToSourceOrder = (unit.assignments || []).some(
    (assignment: any) =>
      assignment.reservation?.salesOrderId === sourceSalesOrderId &&
      assignment.reservation?.productId === productId,
  );
  if (
    unit.productId !== productId ||
    unit.normalizedLogisticsCode !==
      scan.normalizedScannedLogisticsCode ||
    unit.status !== 'OUTBOUND' ||
    !unit.warehouseId ||
    !belongsToSourceOrder
  ) {
    return { status: 'CONFLICT', unit };
  }
  return { status: 'MATCHED', unit };
}

function serializedSourceAssignmentInclude() {
  return {
    assignments: {
      where: { status: 'OUTBOUND' },
      include: {
        reservation: {
          select: {
            salesOrderId: true,
            productId: true,
          },
        },
      },
    },
  };
}

async function claimReceivedQuantities(
  tx: any,
  lines: any[],
  direction: 1 | -1,
) {
  const grouped = new Map<string, { item: any; quantity: number }>();
  for (const line of lines) {
    const current = grouped.get(line.afterSalesOrderItemId);
    if (current) {
      current.quantity += Number(line.receivedQty);
    } else {
      grouped.set(line.afterSalesOrderItemId, {
        item: line.afterSalesOrderItem,
        quantity: Number(line.receivedQty),
      });
    }
  }
  for (const { item, quantity } of grouped.values()) {
    assertReturnableItem(item);
    const next =
      Number(item.postedReceivedQty || 0) + direction * quantity;
    if (
      next < 0 ||
      next > Number(item.expectedReturnQty || 0)
    ) {
      throw conflict(
        direction > 0
          ? 'AFTER_SALES_RECEIPT_QUANTITY_EXCEEDED'
          : 'AFTER_SALES_RECEIPT_REVERSAL_QUANTITY_INVALID',
        direction > 0
          ? 'Posted receipts would exceed the expected return quantity.'
          : 'The receipt return snapshot cannot be reversed safely.',
      );
    }
    const changed = await tx.afterSalesOrderItem.updateMany({
      where: {
        id: item.id,
        returnVersion: Number(item.returnVersion || 0),
        returnRequired: true,
        postedReceivedQty: Number(item.postedReceivedQty || 0),
      },
      data: {
        postedReceivedQty: { increment: direction * quantity },
        returnVersion: { increment: 1 },
      },
    });
    if (Number(changed?.count || 0) !== 1) {
      throw concurrentReceiptError();
    }
  }
}

function assertReturnableItem(item: any) {
  if (
    !item?.returnRequired ||
    Number(item.expectedReturnQty || 0) <= 0
  ) {
    throw conflict(
      'AFTER_SALES_RETURN_NOT_REQUIRED',
      'This after-sales item does not require a physical return.',
    );
  }
}

async function loadReceipt(db: any, receiptId: string) {
  return await db.afterSalesReceipt.findUnique({
    where: { id: receiptId },
    include: receiptInclude(),
  });
}

function receiptInclude() {
  return {
    warehouse: {
      select: { id: true, code: true, name: true },
    },
    afterSalesOrder: {
      select: {
        id: true,
        afterSalesNo: true,
        actionType: true,
        salesOrder: {
          select: { id: true, orderType: true },
        },
      },
    },
    lines: {
      include: {
        afterSalesOrderItem: {
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
        inventoryBatch: {
          select: {
            id: true,
            productionBatch: true,
          },
        },
        serializedUnits: {
          include: {
            originalUnit: {
              select: {
                id: true,
                logisticsCode: true,
              },
            },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: [{ lineNo: 'asc' }, { id: 'asc' }],
    },
  };
}

function receiptDto(receipt: any, actor: any) {
  const detailed = RECEIPT_DETAIL_ROLES.has(normalizedRole(actor));
  return {
    id: receipt.id,
    afterSalesOrderId: receipt.afterSalesOrderId,
    afterSalesNo: receipt.afterSalesOrder?.afterSalesNo ?? null,
    warehouse: {
      id: receipt.warehouse?.id ?? receipt.warehouseId,
      code: receipt.warehouse?.code ?? null,
      name: receipt.warehouse?.name ?? null,
    },
    status: String(receipt.status).toLowerCase(),
    notes: receipt.notes ?? null,
    reversalReason: receipt.reversalReason ?? null,
    confirmedAt: isoOrNull(receipt.confirmedAt),
    reversedAt: isoOrNull(receipt.reversedAt),
    createdAt: isoOrNull(receipt.createdAt),
    updatedAt: isoOrNull(receipt.updatedAt),
    lines: (receipt.lines || []).map((line: any) => ({
      id: line.id,
      lineNo: Number(line.lineNo),
      afterSalesOrderItemId: line.afterSalesOrderItemId,
      productId: line.afterSalesOrderItem?.productId ?? null,
      productName: line.afterSalesOrderItem?.productName ?? null,
      receivedQty: Number(line.receivedQty),
      condition: String(line.condition).toLowerCase(),
      exceptionReason: line.exceptionReason ?? null,
      batch: line.inventoryBatch
        ? {
            id: line.inventoryBatch.id,
            productionBatch:
              line.inventoryBatch.productionBatch ?? null,
          }
        : null,
      serializedSummary: summarizeSerializedFacts(
        line.serializedUnits || [],
      ),
      ...(detailed
        ? {
            serializedUnits: (line.serializedUnits || []).map(
              (fact: any) => ({
                id: fact.id,
                originalSerializedUnitId:
                  fact.originalSerializedUnitId ?? null,
                scannedLogisticsCode:
                  fact.scannedLogisticsCodeSnapshot,
                matchStatus: String(fact.matchStatus).toLowerCase(),
              }),
            ),
          }
        : {}),
    })),
  };
}

function summarizeSerializedFacts(facts: any[]) {
  return facts.reduce(
    (summary, fact) => {
      const status = String(fact.matchStatus).toUpperCase();
      summary.total += 1;
      if (status === 'MATCHED') summary.matched += 1;
      else if (status === 'UNKNOWN') summary.unknown += 1;
      else summary.conflict += 1;
      return summary;
    },
    { total: 0, matched: 0, unknown: 0, conflict: 0 },
  );
}

function receiptAuditSnapshot(receipt: any) {
  return {
    receiptId: receipt.id,
    afterSalesOrderId: receipt.afterSalesOrderId,
    warehouseId: receipt.warehouseId,
    status: String(receipt.status).toLowerCase(),
    lines: (receipt.lines || []).map((line: any) => ({
      afterSalesOrderItemId: line.afterSalesOrderItemId,
      receivedQty: Number(line.receivedQty),
      condition: String(line.condition).toLowerCase(),
      serializedSummary: summarizeSerializedFacts(
        line.serializedUnits || [],
      ),
    })),
  };
}

function lifecycleReplay(
  receipt: any,
  action: 'POST' | 'REVERSE',
  envelope: any,
  actor: any,
) {
  const prefix = action === 'POST' ? 'post' : 'reverse';
  const existingKey = receipt[`${prefix}IdempotencyKey`];
  if (!existingKey) {
    return null;
  }
  if (
    existingKey !== envelope.idempotencyKey ||
    receipt[`${prefix}RequestHash`] !== envelope.requestHash
  ) {
    if (existingKey === envelope.idempotencyKey) {
      throw idempotencyConflict();
    }
    return null;
  }
  receiptDto(receipt, actor);
  return true;
}

function commandReceiptReplay(receipt: any, requestHash: string) {
  if (receipt.requestHash !== requestHash) {
    throw idempotencyConflict();
  }
  if (receipt.status !== 'SUCCEEDED' || !receipt.resultSnapshot) {
    throw conflict(
      'INVENTORY_COMMAND_IN_PROGRESS',
      'The after-sales fulfillment command is still being processed.',
    );
  }
  return {
    ...(receipt.resultSnapshot as any),
    replayed: true,
  };
}

function receiptLineComparator(left: any, right: any) {
  return (
    String(left.afterSalesOrderItem?.productId || '').localeCompare(
      String(right.afterSalesOrderItem?.productId || ''),
    ) || Number(left.lineNo) - Number(right.lineNo)
  );
}

function normalizeSerializedScans(value: any, field: string) {
  if (!Array.isArray(value)) {
    throw validationError(`${field} must be an array.`);
  }
  const seen = new Set<string>();
  return value.map((scan, index) => {
    assertPlainObject(scan, `${field}[${index}]`);
    assertAllowedFields(scan, [
      'originalSerializedUnitId',
      'scannedLogisticsCode',
    ]);
    const scannedLogisticsCode = requiredString(
      scan.scannedLogisticsCode,
      `${field}[${index}].scannedLogisticsCode`,
      160,
    );
    const normalizedScannedLogisticsCode =
      normalizeLogisticsCode(scannedLogisticsCode);
    if (seen.has(normalizedScannedLogisticsCode)) {
      throw validationError(
        `${field} cannot contain duplicate logistics codes.`,
      );
    }
    seen.add(normalizedScannedLogisticsCode);
    return {
      originalSerializedUnitId: optionalString(
        scan.originalSerializedUnitId,
        `${field}[${index}].originalSerializedUnitId`,
      ),
      scannedLogisticsCode,
      normalizedScannedLogisticsCode,
    };
  });
}

function normalizeCondition(value: any, field: string) {
  const condition = String(value || '').trim().toUpperCase();
  if (!['SALEABLE', 'UNAVAILABLE', 'EXCEPTION'].includes(condition)) {
    throw validationError(
      `${field} must be SALEABLE, UNAVAILABLE, or EXCEPTION.`,
    );
  }
  return condition;
}

function normalizeLogisticsCode(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
}

function childBusinessKey(parent: string, suffix: string) {
  const digest = crypto
    .createHash('sha256')
    .update(suffix)
    .digest('hex')
    .slice(0, 32);
  return normalizedBusinessKey(
    `${parent.slice(0, 105)}:${digest}`,
    'childBusinessKey',
  );
}

function normalizeHashValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value.normalize('NFKC').trim();
  if (Array.isArray(value)) return value.map(normalizeHashValue);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested !== undefined) {
        result[key] = normalizeHashValue(nested);
      }
    }
    return result;
  }
  return value;
}

function assertAllowedFields(value: any, allowed: string[]) {
  const allowedSet = new Set(allowed);
  const unsupported = Object.keys(value || {}).find(
    (key) => !allowedSet.has(key),
  );
  if (unsupported) {
    throw validationError(`Unsupported after-sales inventory field: ${unsupported}.`);
  }
}

function assertPlainObject(value: any, field = 'body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError(`${field} must be an object.`);
  }
}

function requiredString(
  value: any,
  field: string,
  maxLength = 191,
) {
  const normalized =
    typeof value === 'string' ? value.normalize('NFKC').trim() : '';
  if (!normalized || normalized.length > maxLength) {
    throw validationError(
      `${field} must be a non-empty string no longer than ${maxLength} characters.`,
    );
  }
  return normalized;
}

function optionalString(value: any, field: string) {
  if (value === undefined || value === null || value === '') return null;
  return requiredString(value, field);
}

function positiveInteger(value: any, field: string) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw validationError(`${field} must be a positive integer bottle count.`);
  }
  return parsed;
}

function optionalDate(value: any, field: string) {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw validationError(`${field} must be a valid date.`);
  }
  return date;
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
      'You do not have permission to access after-sales inventory receipts.',
    );
  }
}

function boundedTraceId(value: any) {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().slice(0, 64) || null
    : null;
}

function boundedIp(value: any) {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().slice(0, 45) || null
    : null;
}

function isoOrNull(value: any) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function idempotencyConflict() {
  return conflict(
    'INVENTORY_IDEMPOTENCY_KEY_CONFLICT',
    'The idempotency key was already used for different command content.',
  );
}

function concurrentReceiptError() {
  return conflict(
    'AFTER_SALES_RECEIPT_CONCURRENT_UPDATE',
    'The after-sales receipt changed concurrently. Refresh and retry.',
  );
}

function validationError(message: string) {
  return createHttpError(400, 'AFTER_SALES_RECEIPT_VALIDATION_FAILED', message);
}

function conflict(code: string, message: string) {
  return createHttpError(409, code, message);
}

function notFound(code: string, message: string) {
  return createHttpError(404, code, message);
}

function isRetryable(error: any) {
  return (
    error?.code === 'P2034' ||
    error?.code === 'AFTER_SALES_RECEIPT_CONCURRENT_UPDATE'
  );
}

function mapReceiptWriteError(error: any) {
  if (error?.status || error?.statusCode || error?.getStatus) {
    return error;
  }
  if (error?.code === 'P2002') {
    const target = Array.isArray(error?.meta?.target)
      ? error.meta.target.join(',')
      : String(error?.meta?.target || '');
    if (target.includes('active_original_unit_key')) {
      return conflict(
        'AFTER_SALES_SERIALIZED_UNIT_ALREADY_RECEIVED',
        'The same bottle already belongs to another effective after-sales receipt.',
      );
    }
    return conflict(
      'AFTER_SALES_RECEIPT_SOURCE_CONFLICT',
      'The receipt source or idempotency key already exists.',
    );
  }
  if (error?.code === 'P2034') {
    return concurrentReceiptError();
  }
  return error;
}
